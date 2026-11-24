import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getEffectiveRoadWidth } from '../../engine/geometry';
import { CompiledTopology, LandmarkItem } from '../../engine/topologyTypes';
import { SignalColor, SimConfig } from '../../engine/types';
import {
  createIndonesianFacadePbr,
  createSoftGlowBlobTexture,
  createTerracottaRoofTexture,
  createTropicalFoliageTexture,
  FacadePbrSet,
  FacadeStyle,
} from './pbrTextures3D';
import {
  GraphicsQualityProfile3D,
  mergeStaticPartsByMaterial,
  normalizeGeometryForMerge,
  StaticMeshPart,
} from './qualityConfig3D';

export interface SignalPoleInput {
  armId: string;
  x: number;
  z: number;
  angleRad?: number;
}

export interface IndonesianCity3DResult {
  group: THREE.Group;
  streetLampEmissives: THREE.MeshStandardMaterial[];
  nightFacadeMats: THREE.MeshStandardMaterial[];
  lightPoolMat: THREE.MeshBasicMaterial;
  updateSignals: (signal: import('../../engine/types').SignalState, ambientDarkness?: number) => void;
  dispose: () => void;
}

interface CornerSpec {
  sx: -1 | 1;
  sy: -1 | 1;
  primary: string;
  secondary: string;
  tertiary: string;
  isPark: boolean;
  label?: string;
  riverEdge?: boolean;
  denseTrees?: boolean;
}

interface BoxBounds2D {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  rotY: number;
}

interface TreePlacement {
  x: number;
  z: number;
  isPalm: boolean;
  scale: number;
  rotY: number;
}

interface StreetlightPlacement {
  x: number;
  z: number;
  rotY: number;
  dirToRoadX: number;
  dirToRoadZ: number;
}

interface CityPalette {
  facades: Record<FacadeStyle, THREE.MeshStandardMaterial>;
  facadePbrs: FacadePbrSet[];
  terracotta: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  darkSlate: THREE.MeshStandardMaterial;
  accentRed: THREE.MeshStandardMaterial;
  accentBlue: THREE.MeshStandardMaterial;
  accentGreen: THREE.MeshStandardMaterial;
  accentGold: THREE.MeshStandardMaterial;
  whiteTrim: THREE.MeshStandardMaterial;
  safetyBand: THREE.MeshStandardMaterial;
}

interface CityBuildCtx {
  parts: StaticMeshPart[];
  tempGeos: THREE.BufferGeometry[];
  palette: CityPalette;
  staticShadows: boolean;
  unitBox: THREE.BoxGeometry;
  unitCyl: THREE.CylinderGeometry;
  unitDome: THREE.SphereGeometry;
  unitHip: THREE.ConeGeometry;
}

// Reusable scratch math objects (build-time only)
const _mat4Parent = new THREE.Matrix4();
const _mat4Local = new THREE.Matrix4();
const _mat4Combined = new THREE.Matrix4();
const _vecPos = new THREE.Vector3();
const _vecScale = new THREE.Vector3();
const _quatRot = new THREE.Quaternion();
const _eulerRot = new THREE.Euler();

function pushPart(
  ctx: CityBuildCtx,
  baseGeo: THREE.BufferGeometry,
  mat: THREE.Material,
  worldMatrix: THREE.Matrix4,
  castShadow = true,
  receiveShadow = true
): void {
  const g = baseGeo.clone();
  g.applyMatrix4(worldMatrix);
  ctx.tempGeos.push(g);
  ctx.parts.push({
    geometry: g,
    material: mat,
    castShadow: ctx.staticShadows && castShadow,
    receiveShadow: ctx.staticShadows && receiveShadow,
  });
}

function addLocalBox(
  ctx: CityBuildCtx,
  parentMat: THREE.Matrix4,
  cx: number,
  baseY: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  localRotY = 0,
  castShadow = true
): void {
  _vecPos.set(cx, baseY + h * 0.5, cz);
  _eulerRot.set(0, localRotY, 0);
  _quatRot.setFromEuler(_eulerRot);
  _vecScale.set(w, h, d);
  _mat4Local.compose(_vecPos, _quatRot, _vecScale);
  _mat4Combined.multiplyMatrices(parentMat, _mat4Local);
  pushPart(ctx, ctx.unitBox, mat, _mat4Combined, castShadow, true);
}

function addLocalCyl(
  ctx: CityBuildCtx,
  parentMat: THREE.Matrix4,
  cx: number,
  baseY: number,
  cz: number,
  radius: number,
  h: number,
  mat: THREE.Material,
  castShadow = true
): void {
  _vecPos.set(cx, baseY + h * 0.5, cz);
  _quatRot.identity();
  _vecScale.set(radius, h, radius);
  _mat4Local.compose(_vecPos, _quatRot, _vecScale);
  _mat4Combined.multiplyMatrices(parentMat, _mat4Local);
  pushPart(ctx, ctx.unitCyl, mat, _mat4Combined, castShadow, true);
}

function addLocalDome(
  ctx: CityBuildCtx,
  parentMat: THREE.Matrix4,
  cx: number,
  baseY: number,
  cz: number,
  radius: number,
  height: number,
  mat: THREE.Material
): void {
  _vecPos.set(cx, baseY, cz);
  _quatRot.identity();
  _vecScale.set(radius, height, radius);
  _mat4Local.compose(_vecPos, _quatRot, _vecScale);
  _mat4Combined.multiplyMatrices(parentMat, _mat4Local);
  pushPart(ctx, ctx.unitDome, mat, _mat4Combined, true, true);
}

function addLocalHipRoof(
  ctx: CityBuildCtx,
  parentMat: THREE.Matrix4,
  cx: number,
  baseY: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material
): void {
  _vecPos.set(cx, baseY + h * 0.5, cz);
  _eulerRot.set(0, Math.PI * 0.25, 0);
  _quatRot.setFromEuler(_eulerRot);
  _vecScale.set(w * Math.SQRT1_2, h, d * Math.SQRT1_2);
  _mat4Local.compose(_vecPos, _quatRot, _vecScale);
  _mat4Combined.multiplyMatrices(parentMat, _mat4Local);
  pushPart(ctx, ctx.unitHip, mat, _mat4Combined, true, true);
}

function makeWorldMatrix(cx: number, cz: number, rotRad: number): THREE.Matrix4 {
  _vecPos.set(cx, 0, cz);
  _eulerRot.set(0, -rotRad, 0);
  _quatRot.setFromEuler(_eulerRot);
  _vecScale.set(1, 1, 1);
  return _mat4Parent.clone().compose(_vecPos, _quatRot, _vecScale);
}

// =============================================================================
// Indonesian Architectural Landmark Builders (Merged into Shared Material Buckets)
// =============================================================================

function buildLandmarkGeometry(
  ctx: CityBuildCtx,
  assetKey: string,
  w: number,
  d: number,
  cx: number,
  cz: number,
  rotRad: number,
  seed: number
): BoxBounds2D {
  const m = makeWorldMatrix(cx, cz, rotRad);
  const key = assetKey.toLowerCase();
  const p = ctx.palette;

  if (key.includes('masjid')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.22, d, p.concrete, 0, false);
    const hw = w * 0.62;
    const hd = d * 0.62;
    addLocalBox(ctx, m, 0, 0.22, 0, hw, 5.2, hd, p.facades.institutional);
    addLocalHipRoof(ctx, m, 0, 5.42, 0, hw * 1.06, 2.2, hd * 1.06, p.terracotta);
    addLocalDome(ctx, m, 0, 7.1, 0, Math.min(hw, hd) * 0.34, 3.8, p.accentGreen);
    addLocalCyl(ctx, m, 0, 10.9, 0, 0.16, 1.4, p.accentGold);
    // Menara (minaret)
    const mx = -w * 0.36;
    const mz = -d * 0.32;
    addLocalBox(ctx, m, mx, 0.22, mz, 2.6, 2.0, 2.6, p.whiteTrim);
    addLocalCyl(ctx, m, mx, 2.22, mz, 0.95, 11.5, p.facades.institutional);
    addLocalCyl(ctx, m, mx, 11.6, mz, 1.35, 0.45, p.accentGold);
    addLocalDome(ctx, m, mx, 13.7, mz, 1.05, 1.8, p.accentGreen);
    addLocalCyl(ctx, m, mx, 15.5, mz, 0.1, 1.1, p.accentGold);
  } else if (key.includes('terminal')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.18, d, p.darkSlate, 0, false);
    addLocalBox(ctx, m, 0, 0.18, -d * 0.22, w * 0.86, 5.4, d * 0.36, p.facades.institutional);
    addLocalHipRoof(ctx, m, 0, 5.58, -d * 0.22, w * 0.9, 2.1, d * 0.4, p.terracotta);
    // 3 sawtooth bus bay canopies
    for (let i = -1; i <= 1; i++) {
      const bx = i * (w * 0.27);
      addLocalBox(ctx, m, bx, 0.18, d * 0.18, w * 0.22, 0.3, d * 0.36, p.concrete, 0, false);
      addLocalBox(ctx, m, bx, 3.6, d * 0.18, w * 0.24, 0.35, d * 0.38, p.accentBlue);
      addLocalCyl(ctx, m, bx - w * 0.08, 0.48, d * 0.18, 0.16, 3.12, p.whiteTrim);
      addLocalCyl(ctx, m, bx + w * 0.08, 0.48, d * 0.18, 0.16, 3.12, p.whiteTrim);
    }
    // Control tower
    addLocalBox(ctx, m, w * 0.34, 5.58, -d * 0.22, 3.2, 4.2, 3.2, p.facades['glass-tower']);
  } else if (key.includes('spbu')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.16, d, p.concrete, 0, false);
    // Iconic Pertamina Red-White-Blue Canopy
    const cw = w * 0.68;
    const cd = d * 0.48;
    addLocalBox(ctx, m, 0, 4.5, d * 0.08, cw, 0.75, cd, p.accentRed);
    addLocalBox(ctx, m, 0, 5.25, d * 0.08, cw * 1.01, 0.24, cd * 1.01, p.whiteTrim);
    addLocalBox(ctx, m, 0, 5.49, d * 0.08, cw * 1.02, 0.22, cd * 1.02, p.accentBlue);
    for (const sx of [-0.24, 0.24]) {
      for (const sz of [-0.08, 0.24]) {
        addLocalCyl(ctx, m, w * sx, 0.16, d * sz, 0.22, 4.34, p.whiteTrim);
      }
      // Fuel dispenser islands
      addLocalBox(ctx, m, w * sx, 0.16, d * 0.08, 1.4, 1.6, 3.2, p.accentRed);
    }
    // Bright Store office at rear
    addLocalBox(ctx, m, 0, 0.16, -d * 0.32, w * 0.56, 3.8, d * 0.24, p.facades.ruko);
  } else if (key.includes('brimob')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.2, d, p.concrete, 0, false);
    addLocalBox(ctx, m, 0, 0.2, -d * 0.1, w * 0.76, 5.8, d * 0.48, p.facades.institutional);
    // Joglo tiered terracotta roof
    addLocalHipRoof(ctx, m, 0, 6.0, -d * 0.1, w * 0.82, 2.2, d * 0.54, p.terracotta);
    addLocalHipRoof(ctx, m, 0, 7.8, -d * 0.1, w * 0.42, 2.4, d * 0.3, p.terracotta);
    // Guardhouse & flagpole
    addLocalBox(ctx, m, w * 0.28, 0.2, d * 0.32, 3.2, 3.0, 2.8, p.whiteTrim);
    addLocalHipRoof(ctx, m, w * 0.28, 3.2, d * 0.32, 3.6, 1.1, 3.2, p.accentRed);
    addLocalCyl(ctx, m, -w * 0.28, 0.2, d * 0.3, 0.09, 9.5, p.whiteTrim);
  } else if (key.includes('helipad')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.2, d, p.concrete, 0, false);
    const bh = 11.5;
    addLocalBox(ctx, m, 0, 0.2, 0, w * 0.78, bh, d * 0.74, p.facades.institutional);
    // Ambulance bay canopy
    addLocalBox(ctx, m, 0, 3.2, d * 0.4, w * 0.38, 0.35, 3.2, p.accentRed);
    // Helipad deck
    const r = Math.min(w, d) * 0.28;
    addLocalCyl(ctx, m, 0, bh + 0.2, 0, r, 0.35, p.darkSlate);
    addLocalCyl(ctx, m, 0, bh + 0.55, 0, r * 0.86, 0.06, p.accentGold);
    addLocalCyl(ctx, m, 0, bh + 0.58, 0, r * 0.74, 0.06, p.darkSlate);
    // Crisp White 'H'
    const hLen = r * 0.78;
    const hBar = r * 0.18;
    addLocalBox(ctx, m, -r * 0.24, bh + 0.62, 0, hBar, 0.08, hLen, p.whiteTrim);
    addLocalBox(ctx, m, r * 0.24, bh + 0.62, 0, hBar, 0.08, hLen, p.whiteTrim);
    addLocalBox(ctx, m, 0, bh + 0.62, 0, r * 0.48, 0.08, hBar, p.whiteTrim);
  } else if (key.includes('kampus')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.16, d, p.accentGreen, 0, false);
    addLocalBox(ctx, m, 0, 0.16, -d * 0.2, w * 0.82, 6.4, d * 0.36, p.facades.institutional);
    addLocalHipRoof(ctx, m, 0, 6.56, -d * 0.2, w * 0.86, 2.4, d * 0.4, p.terracotta);
    // Side wings
    addLocalBox(ctx, m, -w * 0.3, 0.16, d * 0.14, w * 0.22, 5.2, d * 0.38, p.facades.institutional);
    addLocalBox(ctx, m, w * 0.3, 0.16, d * 0.14, w * 0.22, 5.2, d * 0.38, p.facades.institutional);
    addLocalHipRoof(ctx, m, -w * 0.3, 5.36, d * 0.14, w * 0.25, 1.6, d * 0.42, p.terracotta);
    addLocalHipRoof(ctx, m, w * 0.3, 5.36, d * 0.14, w * 0.25, 1.6, d * 0.42, p.terracotta);
  } else if (key.includes('pasar')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.18, d, p.concrete, 0, false);
    // Twin market halls with tiered terracotta roofs & awnings
    for (const sz of [-d * 0.2, d * 0.18]) {
      addLocalBox(ctx, m, 0, 0.18, sz, w * 0.84, 4.2, d * 0.3, p.facades.market);
      addLocalHipRoof(ctx, m, 0, 4.38, sz, w * 0.9, 2.1, d * 0.36, p.terracotta);
    }
    addLocalBox(ctx, m, 0, 2.4, d * 0.38, w * 0.78, 0.2, 2.0, p.accentBlue);
  } else if (key.includes('ruko')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.16, d, p.concrete, 0, false);
    const units = w >= 18 ? 3 : 2;
    const uw = (w * 0.86) / units;
    for (let i = 0; i < units; i++) {
      const ux = -w * 0.43 + uw * (i + 0.5);
      const h = 8.4 + ((seed + i) % 2) * 1.4;
      addLocalBox(ctx, m, ux, 0.16, 0, uw - 0.35, h, d * 0.66, p.facades.ruko);
      addLocalBox(ctx, m, ux, h + 0.16, 0, uw - 0.15, 0.45, d * 0.7, p.terracotta);
      // Ground floor shop canopy
      addLocalBox(ctx, m, ux, 3.1, d * 0.38, uw - 0.3, 0.22, 1.6, i % 2 === 0 ? p.accentBlue : p.accentRed);
      // Iconic Indonesian Blue Water Tank (Toren Air Biru) on roof!
      const tx = ux + uw * 0.2;
      const tz = -d * 0.15;
      addLocalBox(ctx, m, tx, h + 0.61, tz, 1.1, 0.8, 1.1, p.darkSlate);
      addLocalCyl(ctx, m, tx, h + 1.41, tz, 0.56, 1.35, p.accentBlue);
      addLocalCyl(ctx, m, tx, h + 2.76, tz, 0.42, 0.2, p.darkSlate);
    }
  } else if (key.includes('mall')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.18, d, p.concrete, 0, false);
    addLocalBox(ctx, m, 0, 0.18, 0, w * 0.84, 9.5, d * 0.76, p.facades.institutional);
    addLocalBox(ctx, m, 0, 1.2, d * 0.39, w * 0.36, 7.8, 1.8, p.facades['glass-tower']);
    addLocalBox(ctx, m, 0, 4.2, d * 0.45, w * 0.42, 0.4, 2.6, p.accentBlue);
    addLocalBox(ctx, m, -w * 0.2, 9.68, 0, 3.6, 1.4, 3.6, p.darkSlate);
    addLocalBox(ctx, m, w * 0.22, 9.68, -d * 0.1, 2.8, 1.1, 2.8, p.darkSlate);
  } else if (key.includes('tower')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.2, d, p.concrete, 0, false);
    addLocalBox(ctx, m, 0, 0.2, 0, w * 0.8, 4.8, d * 0.78, p.facades.institutional);
    const towerH = 18 + (seed % 3) * 4.5;
    addLocalBox(ctx, m, 0, 5.0, 0, w * 0.56, towerH, d * 0.54, p.facades['glass-tower']);
    addLocalBox(ctx, m, 0, 5.0 + towerH, 0, w * 0.42, 1.6, d * 0.4, p.accentBlue);
    addLocalCyl(ctx, m, 0, 6.6 + towerH, 0, 0.12, 4.2, p.whiteTrim);
  } else if (key.includes('stadion')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.18, d, p.concrete, 0, false);
    addLocalBox(ctx, m, 0, 0.18, 0, w * 0.6, 0.2, d * 0.56, p.accentGreen, 0, false);
    // Grandstand tiers
    addLocalBox(ctx, m, 0, 0.18, -d * 0.36, w * 0.86, 6.2, d * 0.18, p.whiteTrim);
    addLocalBox(ctx, m, 0, 6.38, -d * 0.32, w * 0.88, 0.45, d * 0.26, p.accentBlue);
    addLocalBox(ctx, m, -w * 0.38, 0.18, 0, w * 0.14, 4.4, d * 0.62, p.whiteTrim);
    addLocalBox(ctx, m, w * 0.38, 0.18, 0, w * 0.14, 4.4, d * 0.62, p.whiteTrim);
    // Floodlight pylons
    for (const sx of [-0.42, 0.42]) {
      for (const sz of [-0.42, 0.42]) {
        addLocalCyl(ctx, m, w * sx, 0.18, d * sz, 0.22, 12.5, p.darkSlate);
        addLocalBox(ctx, m, w * sx, 12.6, d * sz, 1.4, 0.8, 0.5, p.whiteTrim);
      }
    }
  } else if (key.includes('bus-shelter') || key.includes('halte')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.45, d, p.concrete, 0, false);
    addLocalBox(ctx, m, 0, 2.75, 0, w * 0.96, 0.2, d * 0.92, p.accentBlue);
    addLocalBox(ctx, m, 0, 2.95, 0, w * 0.8, 0.28, d * 0.35, p.whiteTrim);
    for (const px of [-w * 0.38, 0, w * 0.38]) {
      addLocalCyl(ctx, m, px, 0.45, -d * 0.32, 0.09, 2.3, p.darkSlate);
      addLocalCyl(ctx, m, px, 0.45, d * 0.32, 0.09, 2.3, p.darkSlate);
    }
  } else if (key.includes('park-pond')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.14, d, p.accentGreen, 0, false);
    addLocalCyl(ctx, m, 0, 0.14, 0, Math.min(w, d) * 0.34, 0.12, p.accentBlue, false);
  } else if (key.includes('park-plaza') || key.includes('planter')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.22, d, p.concrete, 0, false);
    addLocalBox(ctx, m, 0, 0.22, 0, w * 0.78, 0.28, d * 0.72, p.accentGreen, 0, false);
  } else if (key.includes('parking')) {
    addLocalBox(ctx, m, 0, 0, 0, w, 0.1, d, p.darkSlate, 0, false);
    for (let i = -2; i <= 2; i++) {
      addLocalBox(ctx, m, i * (w * 0.18), 0.11, -d * 0.22, 0.18, 0.04, d * 0.32, p.whiteTrim, 0, false);
      addLocalBox(ctx, m, i * (w * 0.18), 0.11, d * 0.22, 0.18, 0.04, d * 0.32, p.whiteTrim, 0, false);
    }
  } else {
    // Generic Indonesian building-roof-1/2/3 & building-terrace-green
    addLocalBox(ctx, m, 0, 0, 0, w, 0.16, d, p.concrete, 0, false);
    const h = 6.2 + (seed % 3) * 2.2;
    const style: FacadeStyle = key.includes('terrace') ? 'institutional' : 'ruko';
    addLocalBox(ctx, m, 0, 0.16, 0, w * 0.76, h, d * 0.72, p.facades[style]);
    if (key.includes('terrace')) {
      addLocalBox(ctx, m, 0, h + 0.16, 0, w * 0.68, 0.35, d * 0.64, p.accentGreen);
    } else {
      addLocalHipRoof(ctx, m, 0, h + 0.16, 0, w * 0.82, 2.4, d * 0.78, p.terracotta);
    }
    addLocalCyl(ctx, m, w * 0.24, h + 0.2, -d * 0.2, 0.5, 1.1, p.accentBlue);
  }

  return {
    cx,
    cz,
    halfX: w * 0.56,
    halfZ: d * 0.56,
    rotY: -rotRad,
  };
}

// =============================================================================
// Organic Instanced Tree & PJU Geometry Builders
// =============================================================================

function buildShadeTreeGeos(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunkParts: THREE.BufferGeometry[] = [];
  const mainStem = new THREE.CylinderGeometry(0.18, 0.32, 3.6, 8);
  mainStem.translate(0, 1.8, 0);
  trunkParts.push(normalizeGeometryForMerge(mainStem));
  mainStem.dispose();

  const b1 = new THREE.CylinderGeometry(0.09, 0.16, 2.2, 7);
  b1.rotateZ(0.46);
  b1.translate(-0.45, 3.4, 0.15);
  trunkParts.push(normalizeGeometryForMerge(b1));
  b1.dispose();

  const b2 = new THREE.CylinderGeometry(0.09, 0.16, 2.2, 7);
  b2.rotateZ(-0.42);
  b2.rotateY(1.2);
  b2.translate(0.42, 3.35, -0.2);
  trunkParts.push(normalizeGeometryForMerge(b2));
  b2.dispose();

  const trunk = mergeGeometries(trunkParts, false) ?? new THREE.CylinderGeometry(0.2, 0.3, 3.5, 8);
  for (const g of trunkParts) g.dispose();

  // Crossed & layered alpha-tested leaf cards for lush organic Angsana/Trembesi crown
  const canopyParts: THREE.BufferGeometry[] = [];
  const cardConfigs: Array<[number, number, number, number, number, number]> = [
    [0, 4.9, 0, 0, 0, 4.8],
    [0, 5.1, 0, 0, Math.PI * 0.33, 4.6],
    [0, 5.0, 0, 0, Math.PI * 0.66, 4.6],
    [0, 4.5, 0, Math.PI * 0.5, 0, 4.9],
    [0, 5.8, 0, Math.PI * 0.42, 0.4, 3.8],
    [0, 5.6, 0, -Math.PI * 0.38, -0.5, 3.9],
  ];
  for (const [x, y, z, rx, ry, size] of cardConfigs) {
    const card = new THREE.PlaneGeometry(size, size);
    card.rotateX(rx);
    card.rotateY(ry);
    card.translate(x, y, z);
    canopyParts.push(normalizeGeometryForMerge(card));
    card.dispose();
  }
  const canopy = mergeGeometries(canopyParts, false) ?? new THREE.PlaneGeometry(4, 4);
  for (const g of canopyParts) g.dispose();

  return { trunk, canopy };
}

function buildPalmTreeGeos(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunkParts: THREE.BufferGeometry[] = [];
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const seg = new THREE.CylinderGeometry(0.11 + (3 - i) * 0.025, 0.13 + (3 - i) * 0.03, 1.85, 7);
    const lean = i * 0.14;
    seg.rotateZ(-0.06 * i);
    seg.translate(lean, 0.9 + i * 1.75, 0);
    trunkParts.push(normalizeGeometryForMerge(seg));
    seg.dispose();
  }
  const trunk = mergeGeometries(trunkParts, false) ?? new THREE.CylinderGeometry(0.12, 0.22, 6.8, 7);
  for (const g of trunkParts) g.dispose();

  const crownParts: THREE.BufferGeometry[] = [];
  const frondCount = 7;
  for (let i = 0; i < frondCount; i++) {
    const ang = (i / frondCount) * Math.PI * 2;
    const frond = new THREE.PlaneGeometry(2.8, 1.7);
    frond.rotateX(-Math.PI * 0.32);
    frond.translate(0, 0, 1.25);
    frond.rotateY(ang);
    frond.translate(0.42, 7.15, 0);
    crownParts.push(normalizeGeometryForMerge(frond));
    frond.dispose();
  }
  const crown = mergeGeometries(crownParts, false) ?? new THREE.PlaneGeometry(3, 3);
  for (const g of crownParts) g.dispose();

  return { trunk, crown };
}

function buildPjuGeos(): { pole: THREE.BufferGeometry; head: THREE.BufferGeometry; pool: THREE.BufferGeometry } {
  const poleParts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.18, 0.24, 0.45, 8);
  base.translate(0, 0.225, 0);
  poleParts.push(normalizeGeometryForMerge(base));
  base.dispose();

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.45, 0),
    new THREE.Vector3(0, 5.2, 0),
    new THREE.Vector3(0.25, 6.1, 0),
    new THREE.Vector3(1.15, 6.45, 0),
    new THREE.Vector3(2.1, 6.32, 0),
  ]);
  const armTube = new THREE.TubeGeometry(curve, 16, 0.065, 7, false);
  poleParts.push(normalizeGeometryForMerge(armTube));
  armTube.dispose();

  const housing = new THREE.BoxGeometry(0.56, 0.12, 0.28);
  housing.translate(2.15, 6.34, 0);
  poleParts.push(normalizeGeometryForMerge(housing));
  housing.dispose();

  const pole = mergeGeometries(poleParts, false) ?? new THREE.CylinderGeometry(0.08, 0.12, 6, 8);
  for (const g of poleParts) g.dispose();

  const head = new THREE.BoxGeometry(0.46, 0.08, 0.22);
  head.translate(2.15, 6.26, 0);

  const pool = new THREE.PlaneGeometry(11.5, 11.5);
  pool.rotateX(-Math.PI * 0.5);

  return { pole, head, pool };
}

// =============================================================================
// Environment & Bounds Helpers
// =============================================================================

function isInsideLandmarkBounds(x: number, z: number, bounds: BoxBounds2D[]): boolean {
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    const dx = x - b.cx;
    const dz = z - b.cz;
    const cos = Math.cos(-b.rotY);
    const sin = Math.sin(-b.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) < b.halfX + 1.5 && Math.abs(lz) < b.halfZ + 1.5) return true;
  }
  return false;
}

function isInsideCustomRoadway(x: number, y: number, compiled: CompiledTopology): boolean {
  if (Math.hypot(x, y) < 12) return true;
  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const proj = x * arm.outDir.x + y * arm.outDir.y;
    const lat = x * arm.inLeftNormal.x + y * arm.inLeftNormal.y;
    if (proj >= arm.setback - 3.5 && proj <= arm.setback + arm.def.length + 3) {
      const inEdge = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0) + 1.0;
      const outEdge = arm.halfMedian + arm.outWidth + 1.0;
      if (lat > -outEdge && lat < inEdge) return true;
    }
  }
  return false;
}

function resolveEnvironmentKey(config: SimConfig): string {
  if (config.environmentId && config.environmentId !== 'default') {
    return config.environmentId;
  }
  const name = (config.scenarioName ?? '').toLowerCase();
  if (name.includes('giwangan')) return 'giwangan-yogya';
  if (name.includes('brimob')) return 'brimob-yogya';
  if (name.includes('lamper')) return 'lamper-semarang';
  if (name.includes('sulawesi')) return 'sulawesi-banjarmasin';
  if (name.includes('laswi')) return 'laswi-bandung';
  if (name.includes('bondowoso') || name.includes('retawu')) return 'bondowoso-malang';
  return 'default';
}

function getEnvironmentCorners(envKey: string): CornerSpec[] {
  switch (envKey) {
    case 'giwangan-yogya':
      return [
        { sx: -1, sy: -1, primary: 'landmark-ruko-row', secondary: 'parking-lot-top', tertiary: 'building-roof-1', isPark: false },
        { sx: 1, sy: -1, primary: 'landmark-mako-brimob', secondary: 'parking-lot-top', tertiary: 'building-roof-2', isPark: false },
        { sx: -1, sy: 1, primary: 'landmark-spbu-pertamina', secondary: 'parking-lot-top', tertiary: 'landmark-ruko-row', isPark: false },
        { sx: 1, sy: 1, primary: 'landmark-terminal-giwangan', secondary: 'bus-shelter-top', tertiary: 'building-roof-3', isPark: false },
      ];
    case 'brimob-yogya':
      return [
        { sx: -1, sy: -1, primary: 'landmark-mako-brimob', secondary: 'parking-lot-top', tertiary: 'building-roof-2', isPark: false },
        { sx: 1, sy: -1, primary: 'landmark-pasar-tradisional', secondary: 'landmark-ruko-row', tertiary: 'building-roof-1', isPark: false },
        { sx: -1, sy: 1, primary: 'landmark-ruko-row', secondary: 'building-roof-3', tertiary: 'parking-lot-top', isPark: false },
        { sx: 1, sy: 1, primary: 'landmark-stadion-corner', secondary: 'park-plaza', tertiary: 'building-terrace-green', isPark: true, denseTrees: true },
      ];
    case 'lamper-semarang':
      return [
        { sx: -1, sy: -1, primary: 'building-commercial-mall', secondary: 'parking-lot-top', tertiary: 'landmark-ruko-row', isPark: false },
        { sx: 1, sy: -1, primary: 'landmark-ruko-row', secondary: 'building-terrace-green', tertiary: 'building-roof-2', isPark: false },
        { sx: -1, sy: 1, primary: 'helipad-roof', secondary: 'building-tower-glass', tertiary: 'parking-lot-top', isPark: false },
        { sx: 1, sy: 1, primary: 'landmark-ruko-row', secondary: 'building-roof-1', tertiary: 'park-plaza', isPark: false },
      ];
    case 'sulawesi-banjarmasin':
      return [
        { sx: -1, sy: -1, primary: 'landmark-pasar-tradisional', secondary: 'landmark-ruko-row', tertiary: 'parking-lot-top', isPark: false },
        { sx: 1, sy: -1, primary: 'landmark-masjid-jami', secondary: 'park-pond', tertiary: 'park-plaza', isPark: true, riverEdge: true },
        { sx: -1, sy: 1, primary: 'building-roof-1', secondary: 'building-roof-3', tertiary: 'building-roof-2', isPark: false },
        { sx: 1, sy: 1, primary: 'landmark-ruko-row', secondary: 'park-plaza', tertiary: 'building-roof-1', isPark: false, riverEdge: true },
      ];
    case 'laswi-bandung':
      return [
        { sx: -1, sy: -1, primary: 'building-tower-glass', secondary: 'helipad-roof', tertiary: 'parking-lot-top', isPark: false },
        { sx: 1, sy: -1, primary: 'landmark-spbu-pertamina', secondary: 'building-terrace-green', tertiary: 'parking-lot-top', isPark: false },
        { sx: -1, sy: 1, primary: 'building-commercial-mall', secondary: 'parking-lot-top', tertiary: 'building-tower-glass', isPark: false },
        { sx: 1, sy: 1, primary: 'building-terrace-green', secondary: 'park-plaza', tertiary: 'landmark-ruko-row', isPark: false },
      ];
    case 'bondowoso-malang':
      return [
        { sx: -1, sy: -1, primary: 'landmark-kampus-wilis', secondary: 'parking-lot-top', tertiary: 'building-terrace-green', isPark: false, denseTrees: true },
        { sx: 1, sy: -1, primary: 'park-plaza', secondary: 'park-pond', tertiary: 'building-roof-2', isPark: true, denseTrees: true },
        { sx: -1, sy: 1, primary: 'landmark-pasar-tradisional', secondary: 'landmark-ruko-row', tertiary: 'building-roof-1', isPark: false, denseTrees: true },
        { sx: 1, sy: 1, primary: 'landmark-ruko-row', secondary: 'building-terrace-green', tertiary: 'park-plaza', isPark: false, denseTrees: true },
      ];
    default:
      return [
        { sx: -1, sy: -1, primary: 'building-tower-glass', secondary: 'building-terrace-green', tertiary: 'helipad-roof', isPark: false },
        { sx: 1, sy: -1, primary: 'park-plaza', secondary: 'park-pond', tertiary: 'building-roof-2', isPark: true },
        { sx: -1, sy: 1, primary: 'building-commercial-mall', secondary: 'parking-lot-top', tertiary: 'building-roof-3', isPark: false },
        { sx: 1, sy: 1, primary: 'building-roof-1', secondary: 'building-terrace-green', tertiary: 'park-plaza', isPark: false },
      ];
  }
}

// =============================================================================
// Traffic Signal Gantry Static Parts + Instanced Lenses
// =============================================================================

const CARDINAL_ANGLE_RAD: Record<string, number> = {
  east: 0,
  south: Math.PI * 0.5,
  west: Math.PI,
  north: -Math.PI * 0.5,
};

function resolvePoleAngleRad(pole: SignalPoleInput): number {
  if (typeof pole.angleRad === 'number' && Number.isFinite(pole.angleRad)) {
    return pole.angleRad;
  }
  const cardinal = CARDINAL_ANGLE_RAD[pole.armId];
  if (cardinal !== undefined) return cardinal;
  if (pole.x === 0 && pole.z === 0) return 0;
  return Math.atan2(pole.z, pole.x) - Math.PI * 0.25;
}

function createRightTurnArrowGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.055, -0.082);
  shape.lineTo(-0.02, -0.082);
  shape.lineTo(-0.02, 0.025);
  shape.lineTo(0.028, 0.025);
  shape.lineTo(0.028, 0.002);
  shape.lineTo(0.092, 0.0415);
  shape.lineTo(0.028, 0.081);
  shape.lineTo(0.028, 0.058);
  shape.lineTo(-0.038, 0.058);
  shape.lineTo(-0.055, 0.041);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 1);
}

const SIGNAL_ORDER: readonly SignalColor[] = ['red', 'yellow', 'green'];
const LENS_Y_OFFSETS: Record<SignalColor, number> = {
  red: 0.34,
  yellow: 0,
  green: -0.34,
};

const ACTIVE_LENS_RGB: Record<SignalColor, THREE.Color> = {
  red: new THREE.Color('#ff4d4d'),
  yellow: new THREE.Color('#fde047'),
  green: new THREE.Color('#34d399'),
};
const INACTIVE_LENS_RGB: Record<SignalColor, THREE.Color> = {
  red: new THREE.Color('#2a0b0d'),
  yellow: new THREE.Color('#2b1e06'),
  green: new THREE.Color('#07261c'),
};
const ARROW_ACTIVE_RGB: Record<SignalColor, THREE.Color> = {
  green: new THREE.Color('#6ee7b7'),
  yellow: new THREE.Color('#fef08a'),
  red: new THREE.Color('#fca5a5'),
};

// =============================================================================
// Main Builder Entry Point
// =============================================================================

export function buildIndonesianCity3D(
  config: SimConfig,
  compiledTopology: CompiledTopology,
  sigPositions: SignalPoleInput[],
  showGrid: boolean,
  quality: GraphicsQualityProfile3D
): IndonesianCity3DResult {
  const group = new THREE.Group();
  group.name = 'indonesian-city-3d';

  const trackedGeos: THREE.BufferGeometry[] = [];
  const trackedMats: THREE.Material[] = [];
  const trackedTexs: THREE.Texture[] = [];

  // 1. Create shared PBR materials
  const facadeStyles: FacadeStyle[] = ['ruko', 'glass-tower', 'institutional', 'market'];
  const facadePbrs: FacadePbrSet[] = [];
  const facades = {} as Record<FacadeStyle, THREE.MeshStandardMaterial>;
  const nightFacadeMats: THREE.MeshStandardMaterial[] = [];

  for (const style of facadeStyles) {
    const pbr = createIndonesianFacadePbr(style);
    facadePbrs.push(pbr);
    const mat = new THREE.MeshStandardMaterial({
      map: pbr.albedo,
      emissiveMap: pbr.emissive,
      emissive: new THREE.Color(0xffcf75),
      emissiveIntensity: 0.0,
      roughnessMap: pbr.roughness,
      roughness: 0.85,
      metalness: style === 'glass-tower' ? 0.32 : 0.06,
    });
    facades[style] = mat;
    nightFacadeMats.push(mat);
    trackedMats.push(mat);
  }

  const terracottaTex = createTerracottaRoofTexture();
  trackedTexs.push(terracottaTex);
  const terracotta = new THREE.MeshStandardMaterial({
    map: terracottaTex,
    roughness: 0.78,
    metalness: 0.04,
  });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd4d0c7, roughness: 0.9, metalness: 0.02 });
  const darkSlate = new THREE.MeshStandardMaterial({ color: 0x263244, roughness: 0.48, metalness: 0.55 });
  const accentRed = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.52, metalness: 0.12 });
  const accentBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4, metalness: 0.22 });
  const accentGreen = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.78, metalness: 0.04 });
  const accentGold = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.35, metalness: 0.45 });
  const whiteTrim = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.68, metalness: 0.05 });
  const safetyBand = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.45,
    metalness: 0.2,
    emissive: 0x713f12,
    emissiveIntensity: 0.12,
  });

  trackedMats.push(
    terracotta,
    concrete,
    darkSlate,
    accentRed,
    accentBlue,
    accentGreen,
    accentGold,
    whiteTrim,
    safetyBand
  );

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const unitDome = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const unitHip = new THREE.ConeGeometry(1, 1, 4);

  const ctx: CityBuildCtx = {
    parts: [],
    tempGeos: [],
    palette: {
      facades,
      facadePbrs,
      terracotta,
      concrete,
      darkSlate,
      accentRed,
      accentBlue,
      accentGreen,
      accentGold,
      whiteTrim,
      safetyBand,
    },
    staticShadows: quality.staticShadows,
    unitBox,
    unitCyl,
    unitDome,
    unitHip,
  };

  // 2. Collect Landmarks, Trees & Streetlights
  const landmarkBounds: BoxBounds2D[] = [];
  const treeSpots: TreePlacement[] = [];
  const lampSpots: StreetlightPlacement[] = [];

  const queueTree = (x: number, z: number, isPalm: boolean, scale: number, seed: number) => {
    if (treeSpots.length >= quality.maxTrees) return;
    treeSpots.push({ x, z, isPalm, scale, rotY: ((seed * 1.618) % 1) * Math.PI * 2 });
  };

  const queueLamp = (x: number, z: number, dirX: number, dirZ: number) => {
    lampSpots.push({
      x,
      z,
      rotY: Math.atan2(-dirZ, dirX),
      dirToRoadX: dirX,
      dirToRoadZ: dirZ,
    });
  };

  const isCustomTopo = Boolean(config.customTopology && compiledTopology);
  const envKey = resolveEnvironmentKey(config);

  if (isCustomTopo) {
    const explicitLandmarks: LandmarkItem[] = compiledTopology.topology.landmarks ?? [];
    for (let i = 0; i < explicitLandmarks.length; i++) {
      const lm = explicitLandmarks[i];
      landmarkBounds.push(
        buildLandmarkGeometry(ctx, lm.assetKey, lm.width, lm.height, lm.x, lm.y, lm.rotationRad || 0, i + 1)
      );
    }

    const cwArms = [...compiledTopology.armOrder]
      .map((id) => compiledTopology.armsById[id])
      .sort((a, b) => a.angleRad - b.angleRad);
    const n = cwArms.length;
    const fallbackAssets = [
      'building-roof-1',
      'building-commercial-mall',
      'park-plaza',
      'landmark-ruko-row',
      'building-terrace-green',
    ];

    if (n >= 3) {
      for (let i = 0; i < n; i++) {
        const a = cwArms[i];
        const b = cwArms[(i + 1) % n];
        let diff = b.angleRad - a.angleRad;
        if (diff <= 0) diff += Math.PI * 2;
        const midAngle = a.angleRad + diff * 0.5;
        const ux = Math.cos(midAngle);
        const uy = Math.sin(midAngle);
        const maxW = Math.max(a.inWidth + a.outWidth, b.inWidth + b.outWidth);
        const minDist = Math.max(a.setback, b.setback) + maxW + 18;

        if (explicitLandmarks.length === 0) {
          landmarkBounds.push(
            buildLandmarkGeometry(
              ctx,
              fallbackAssets[i % fallbackAssets.length],
              21,
              15,
              ux * (minDist + 10),
              uy * (minDist + 10),
              midAngle + Math.PI * 0.25,
              i + 3
            )
          );
        }

        const treeOffsets = [minDist - 5, minDist + 22, minDist + 46];
        for (let tIdx = 0; tIdx < treeOffsets.length; tIdx++) {
          const r = treeOffsets[tIdx];
          const tx = ux * r + (tIdx % 2 === 0 ? -uy : uy) * 6;
          const tz = uy * r + (tIdx % 2 === 0 ? ux : -ux) * 6;
          if (!isInsideLandmarkBounds(tx, tz, landmarkBounds) && !isInsideCustomRoadway(tx, tz, compiledTopology)) {
            queueTree(tx, tz, tIdx === 1, 1.0 + (tIdx % 2) * 0.14, i * 7 + tIdx);
          }
        }
      }
    }

    for (let aIdx = 0; aIdx < cwArms.length; aIdx++) {
      const arm = cwArms[aIdx];
      const inLat = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0) + 1.5;
      const outLat = arm.halfMedian + arm.outWidth + 1.5;
      const slipClear = arm.def.slipLane?.enabled ? (arm.def.slipLane.islandSetback || 16) + 10 : 14;
      const lampDists = [arm.setback + slipClear];
      if (arm.def.length >= 60) lampDists.push(arm.setback + Math.max(slipClear + 22, 42));
      if (arm.def.length >= 95) lampDists.push(arm.setback + 74);

      for (const dist of lampDists) {
        if (dist > arm.setback + arm.def.length - 6) continue;
        const ix = arm.outDir.x * dist + arm.inLeftNormal.x * inLat;
        const iz = arm.outDir.y * dist + arm.inLeftNormal.y * inLat;
        if (!isInsideLandmarkBounds(ix, iz, landmarkBounds) && !isInsideCustomRoadway(ix, iz, compiledTopology)) {
          queueLamp(ix, iz, -arm.inLeftNormal.x, -arm.inLeftNormal.y);
        }
        const ox = arm.outDir.x * dist - arm.inLeftNormal.x * outLat;
        const oz = arm.outDir.y * dist - arm.inLeftNormal.y * outLat;
        if (!isInsideLandmarkBounds(ox, oz, landmarkBounds) && !isInsideCustomRoadway(ox, oz, compiledTopology)) {
          queueLamp(ox, oz, arm.inLeftNormal.x, arm.inLeftNormal.y);
        }
      }
    }
  } else {
    const halfRoad = getEffectiveRoadWidth(config);
    const sidewalkW = 3.4;
    const corners = getEnvironmentCorners(envKey);
    const bSize = Math.min(26, Math.max(14, config.roadLength * 0.32));
    const sSize = bSize * 0.85;

    for (let cIdx = 0; cIdx < corners.length; cIdx++) {
      const c = corners[cIdx];
      const bx = c.sx * (halfRoad + sidewalkW);
      const bz = c.sy * (halfRoad + sidewalkW);

      const pX = c.sx < 0 ? bx - 5.5 - bSize : bx + 5.5;
      const pZ = c.sy < 0 ? bz - 5.5 - bSize : bz + 5.5;
      landmarkBounds.push(
        buildLandmarkGeometry(ctx, c.primary, bSize, bSize, pX + bSize * 0.5, pZ + bSize * 0.5, 0, cIdx + 1)
      );

      if (config.roadLength >= 55) {
        const sX = c.sx < 0 ? bx - 5.5 - bSize - sSize - 4 : bx + 5.5 + bSize + 4;
        const sZ = c.sy < 0 ? bz - 5.5 - sSize : bz + 5.5;
        landmarkBounds.push(
          buildLandmarkGeometry(ctx, c.secondary, sSize, sSize, sX + sSize * 0.5, sZ + sSize * 0.5, 0, cIdx + 5)
        );

        const tX = c.sx < 0 ? bx - 5.5 - sSize : bx + 5.5;
        const tZ = c.sy < 0 ? bz - 5.5 - bSize - sSize - 4 : bz + 5.5 + bSize + 4;
        landmarkBounds.push(
          buildLandmarkGeometry(ctx, c.tertiary, sSize, sSize, tX + sSize * 0.5, tZ + sSize * 0.5, 0, cIdx + 9)
        );
      }

      buildLandmarkGeometry(ctx, 'planter-box-long', 9, 2.4, bx + c.sx * 1.4, bz + c.sy * 20, Math.PI * 0.5, cIdx);

      if (config.roadLength >= 65 && (c.sx * c.sy > 0 || envKey === 'laswi-bandung')) {
        const shelterRot = c.sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        buildLandmarkGeometry(ctx, 'bus-shelter-top', 6.4, 2.8, bx + c.sx * -1.6, bz + c.sy * 28, shelterRot, cIdx + 13);
      }

      queueLamp(bx + c.sx * -1.4, bz + c.sy * 16, -c.sx, 0);
      queueLamp(bx + c.sx * 16, bz + c.sy * -1.4, 0, -c.sy);
      if (config.roadLength >= 75) {
        queueLamp(bx + c.sx * -1.4, bz + c.sy * 44, -c.sx, 0);
        queueLamp(bx + c.sx * 44, bz + c.sy * -1.4, 0, -c.sy);
      }
      if (config.roadLength >= 105) {
        queueLamp(bx + c.sx * -1.4, bz + c.sy * 72, -c.sx, 0);
        queueLamp(bx + c.sx * 72, bz + c.sy * -1.4, 0, -c.sy);
      }

      const preferShade = c.sx * c.sy > 0 || Boolean(c.denseTrees);
      queueTree(bx + c.sx * 1.3, bz + c.sy * 10, !preferShade, 1.05, cIdx * 3);
      queueTree(bx + c.sx * 10, bz + c.sy * 1.3, !preferShade, 1.0, cIdx * 3 + 1);
      queueTree(bx + c.sx * 1.3, bz + c.sy * 24, false, 1.12, cIdx * 5 + 1);

      if (c.denseTrees) {
        queueTree(bx + c.sx * 24, bz + c.sy * 1.3, false, 1.1, cIdx * 5 + 2);
        queueTree(bx + c.sx * 1.3, bz + c.sy * 32, false, 0.96, cIdx * 7 + 1);
        queueTree(bx + c.sx * 32, bz + c.sy * 1.3, false, 1.04, cIdx * 7 + 2);
        const gx = bx + c.sx * (bSize + 10);
        const gz = bz + c.sy * (bSize + 10);
        if (!isInsideLandmarkBounds(gx, gz, landmarkBounds)) {
          queueTree(gx, gz, false, 1.15, cIdx * 11);
        }
      }

      if (config.roadLength >= 90) {
        queueTree(bx + c.sx * 1.3, bz + c.sy * 38, !preferShade, 1.08, cIdx * 9 + 1);
        queueTree(bx + c.sx * 38, bz + c.sy * 1.3, !preferShade, 1.06, cIdx * 9 + 2);
      }
    }
  }

  // 3. Static Traffic Signal Gantry Poles (Merged with City Static Parts!)
  const cantileverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 5.2, 0),
    new THREE.Vector3(0.04, 5.56, 0),
    new THREE.Vector3(0.36, 5.8, 0),
    new THREE.Vector3(0.95, 5.84, 0),
    new THREE.Vector3(3.4, 5.82, 0),
  ]);
  const cantileverGeo = new THREE.TubeGeometry(cantileverCurve, 20, 0.076, 8, false);
  const lensMatrixList: Array<{ armId: string; color: SignalColor; matrix: THREE.Matrix4 }> = [];
  const arrowMatrixList: Array<{ armId: string; matrix: THREE.Matrix4 }> = [];

  for (let i = 0; i < sigPositions.length; i++) {
    const pole = sigPositions[i];
    const angleRad = resolvePoleAngleRad(pole);
    const poleRotY = Math.PI * 0.5 - angleRad;
    const poleMat = new THREE.Matrix4().compose(
      new THREE.Vector3(pole.x, 0, pole.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, poleRotY, 0)),
      new THREE.Vector3(1, 1, 1)
    );

    // Plinth, mast, safety band, control box, cantilever arm & 3-aspect housing
    addLocalBox(ctx, poleMat, 0, 0, 0, 0.68, 0.14, 0.68, concrete);
    addLocalCyl(ctx, poleMat, 0, 0.14, 0, 0.26, 0.4, concrete);
    addLocalBox(ctx, poleMat, 0, 0.54, 0, 0.38, 0.04, 0.38, darkSlate);
    addLocalCyl(ctx, poleMat, 0, 0.58, 0, 0.105, 4.78, darkSlate);
    addLocalCyl(ctx, poleMat, 0, 1.0, 0, 0.116, 0.12, safetyBand);
    addLocalBox(ctx, poleMat, -0.15, 1.37, 0, 0.18, 0.36, 0.24, darkSlate);
    pushPart(ctx, cantileverGeo, darkSlate, poleMat, true, true);

    // Hanger & 3-aspect main housing at x = 2.85, y = 4.92
    addLocalCyl(ctx, poleMat, 2.85, 5.46, 0, 0.034, 0.48, darkSlate);
    addLocalBox(ctx, poleMat, 2.85, 4.38, 0, 0.4, 1.08, 0.26, darkSlate);

    for (const cKey of SIGNAL_ORDER) {
      const ly = 4.92 + LENS_Y_OFFSETS[cKey];
      const lMat = new THREE.Matrix4().compose(
        new THREE.Vector3(2.85, ly, 0.135),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1)
      );
      lensMatrixList.push({
        armId: pole.armId,
        color: cKey,
        matrix: new THREE.Matrix4().multiplyMatrices(poleMat, lMat),
      });
    }

    // Optional right-turn arrow housing at x = 3.3, y = 4.6
    addLocalBox(ctx, poleMat, 3.08, 4.58, 0, 0.28, 0.06, 0.06, darkSlate);
    addLocalBox(ctx, poleMat, 3.32, 4.39, 0, 0.38, 0.42, 0.24, darkSlate);
    const aMat = new THREE.Matrix4().compose(
      new THREE.Vector3(3.32, 4.6, 0.128),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1)
    );
    arrowMatrixList.push({
      armId: pole.armId,
      matrix: new THREE.Matrix4().multiplyMatrices(poleMat, aMat),
    });
  }
  cantileverGeo.dispose();

  // Merge ALL building + static signal pole parts by material (~10-12 draw calls total!)
  mergeStaticPartsByMaterial(ctx.parts, group, trackedGeos);

  // Dispose temporary intermediate geometries now that merged buffers are created
  for (let i = 0; i < ctx.tempGeos.length; i++) ctx.tempGeos[i].dispose();
  unitBox.dispose();
  unitCyl.dispose();
  unitDome.dispose();
  unitHip.dispose();

  // 4. Instanced Organic Tropical Trees & Palms (4 draw calls total)
  const foliageTex = createTropicalFoliageTexture();
  trackedTexs.push(foliageTex);

  const barkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 0.92, metalness: 0.02 });
  const leafCardMat = new THREE.MeshStandardMaterial({
    map: foliageTex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0.02,
  });
  trackedMats.push(barkMat, leafCardMat);

  const shadeTrees = treeSpots.filter((t) => !t.isPalm);
  const palmTrees = treeSpots.filter((t) => t.isPalm);
  const instDummy = new THREE.Object3D();

  if (shadeTrees.length > 0) {
    const { trunk, canopy } = buildShadeTreeGeos();
    trackedGeos.push(trunk, canopy);
    const trunkMesh = new THREE.InstancedMesh(trunk, barkMat, shadeTrees.length);
    const canopyMesh = new THREE.InstancedMesh(canopy, leafCardMat, shadeTrees.length);
    trunkMesh.castShadow = quality.staticShadows;
    canopyMesh.castShadow = quality.staticShadows;
    canopyMesh.receiveShadow = quality.staticShadows;

    for (let i = 0; i < shadeTrees.length; i++) {
      const t = shadeTrees[i];
      instDummy.position.set(t.x, 0, t.z);
      instDummy.rotation.set(0, t.rotY, 0);
      instDummy.scale.setScalar(t.scale);
      instDummy.updateMatrix();
      trunkMesh.setMatrixAt(i, instDummy.matrix);
      canopyMesh.setMatrixAt(i, instDummy.matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    group.add(trunkMesh, canopyMesh);
  }

  if (palmTrees.length > 0) {
    const { trunk, crown } = buildPalmTreeGeos();
    trackedGeos.push(trunk, crown);
    const pTrunkMesh = new THREE.InstancedMesh(trunk, barkMat, palmTrees.length);
    const pCrownMesh = new THREE.InstancedMesh(crown, leafCardMat, palmTrees.length);
    pTrunkMesh.castShadow = quality.staticShadows;
    pCrownMesh.castShadow = quality.staticShadows;

    for (let i = 0; i < palmTrees.length; i++) {
      const t = palmTrees[i];
      instDummy.position.set(t.x, 0, t.z);
      instDummy.rotation.set(0, t.rotY, 0);
      instDummy.scale.setScalar(t.scale);
      instDummy.updateMatrix();
      pTrunkMesh.setMatrixAt(i, instDummy.matrix);
      pCrownMesh.setMatrixAt(i, instDummy.matrix);
    }
    pTrunkMesh.instanceMatrix.needsUpdate = true;
    pCrownMesh.instanceMatrix.needsUpdate = true;
    group.add(pTrunkMesh, pCrownMesh);
  }

  // 5. Instanced Streetlights (PJU) + Warm Night Light Pools (3 draw calls total)
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    roughness: 0.3,
    metalness: 0.1,
    emissive: 0xffb347,
    emissiveIntensity: 0.18,
  });
  const streetLampEmissives: THREE.MeshStandardMaterial[] = [lampHeadMat];

  const glowTex = createSoftGlowBlobTexture('rgba(255, 205, 110, 0.88)', 'rgba(255, 180, 70, 0.0)');
  trackedTexs.push(glowTex);
  const lightPoolMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  trackedMats.push(lampHeadMat, lightPoolMat);

  if (lampSpots.length > 0) {
    const { pole, head, pool } = buildPjuGeos();
    trackedGeos.push(pole, head, pool);

    const poleInst = new THREE.InstancedMesh(pole, darkSlate, lampSpots.length);
    const headInst = new THREE.InstancedMesh(head, lampHeadMat, lampSpots.length);
    const poolInst = new THREE.InstancedMesh(pool, lightPoolMat, lampSpots.length);
    poleInst.castShadow = quality.staticShadows;
    poolInst.renderOrder = 2;

    for (let i = 0; i < lampSpots.length; i++) {
      const s = lampSpots[i];
      instDummy.position.set(s.x, 0, s.z);
      instDummy.rotation.set(0, s.rotY, 0);
      instDummy.scale.set(1, 1, 1);
      instDummy.updateMatrix();
      poleInst.setMatrixAt(i, instDummy.matrix);
      headInst.setMatrixAt(i, instDummy.matrix);

      instDummy.position.set(s.x + s.dirToRoadX * 2.15, 0.04, s.z + s.dirToRoadZ * 2.15);
      instDummy.rotation.set(0, 0, 0);
      instDummy.updateMatrix();
      poolInst.setMatrixAt(i, instDummy.matrix);
    }
    poleInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    poolInst.instanceMatrix.needsUpdate = true;
    group.add(poleInst, headInst, poolInst);
  }

  // 6. Instanced Emissive Signal Lenses & Right-Turn Arrows (2 draw calls total, 0 allocs/frame)
  const lensGeo = new THREE.CircleGeometry(0.118, 20);
  const lensMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  trackedGeos.push(lensGeo);
  trackedMats.push(lensMat);

  const lensInst =
    lensMatrixList.length > 0
      ? new THREE.InstancedMesh(lensGeo, lensMat, lensMatrixList.length)
      : null;
  if (lensInst) {
    for (let i = 0; i < lensMatrixList.length; i++) {
      lensInst.setMatrixAt(i, lensMatrixList[i].matrix);
      lensInst.setColorAt(i, INACTIVE_LENS_RGB[lensMatrixList[i].color]);
    }
    lensInst.instanceMatrix.needsUpdate = true;
    if (lensInst.instanceColor) lensInst.instanceColor.needsUpdate = true;
    group.add(lensInst);
  }

  const arrowGeo = createRightTurnArrowGeometry();
  const arrowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  trackedGeos.push(arrowGeo);
  trackedMats.push(arrowMat);

  const arrowInst =
    arrowMatrixList.length > 0
      ? new THREE.InstancedMesh(arrowGeo, arrowMat, arrowMatrixList.length)
      : null;
  const zeroScaleMat = new THREE.Matrix4().makeScale(0, 0, 0);
  if (arrowInst) {
    for (let i = 0; i < arrowMatrixList.length; i++) {
      arrowInst.setMatrixAt(i, zeroScaleMat);
      arrowInst.setColorAt(i, ARROW_ACTIVE_RGB.green);
    }
    arrowInst.instanceMatrix.needsUpdate = true;
    if (arrowInst.instanceColor) arrowInst.instanceColor.needsUpdate = true;
    group.add(arrowInst);
  }

  // 7. Optional 10m Blueprint Grid at y = 0.015m
  if (showGrid) {
    const halfBox = getEffectiveRoadWidth(config) + 2.0;
    const worldHalfExtent = isCustomTopo
      ? Math.max(80, compiledTopology.maxExtentMeters)
      : Math.max(80, halfBox + config.roadLength + 24);
    let divisions = Math.ceil((worldHalfExtent * 2) / 10);
    if (divisions % 2 !== 0) divisions += 1;
    const gridSize = divisions * 10;

    const grid = new THREE.GridHelper(gridSize, divisions, 0x64748b, 0x78866b);
    grid.position.y = 0.015;
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const gm of gridMats) {
      gm.transparent = true;
      gm.opacity = 0.28;
      gm.depthWrite = false;
      trackedMats.push(gm);
    }
    trackedGeos.push(grid.geometry);
    group.add(grid);
  }

  // Pre-allocated scratch color for zero-allocation updateSignals
  const _scratchColor = new THREE.Color();
  let disposed = false;

  function updateSignals(signal: import('../../engine/types').SignalState, ambientDarkness = 0): void {
    if (disposed) return;
    const darkness = Math.max(0, Math.min(1, ambientDarkness));
    const boost = 1.0 + darkness * 0.45;

    const armColors = signal.multiPhase?.armColors as Record<string, SignalColor | undefined> | undefined;
    const armLights = signal.armLights as Record<string, SignalColor | undefined> | undefined;
    const arrowColors = signal.multiPhase?.armRightArrowColors;

    if (lensInst) {
      for (let i = 0; i < lensMatrixList.length; i++) {
        const entry = lensMatrixList[i];
        const activeColor: SignalColor =
          armColors?.[entry.armId] ??
          armLights?.[entry.armId] ??
          (entry.armId === signal.activeArm ? signal.activeColor : 'red');

        if (entry.color === activeColor) {
          _scratchColor.copy(ACTIVE_LENS_RGB[entry.color]).multiplyScalar(boost);
          lensInst.setColorAt(i, _scratchColor);
        } else {
          lensInst.setColorAt(i, INACTIVE_LENS_RGB[entry.color]);
        }
      }
      if (lensInst.instanceColor) lensInst.instanceColor.needsUpdate = true;
    }

    if (arrowInst) {
      let matrixDirty = false;
      for (let i = 0; i < arrowMatrixList.length; i++) {
        const entry = arrowMatrixList[i];
        const rightColor = arrowColors?.[entry.armId];
        if (rightColor === undefined) {
          arrowInst.setMatrixAt(i, zeroScaleMat);
          matrixDirty = true;
        } else {
          arrowInst.setMatrixAt(i, entry.matrix);
          _scratchColor.copy(ARROW_ACTIVE_RGB[rightColor]).multiplyScalar(boost);
          arrowInst.setColorAt(i, _scratchColor);
          matrixDirty = true;
        }
      }
      if (matrixDirty) arrowInst.instanceMatrix.needsUpdate = true;
      if (arrowInst.instanceColor) arrowInst.instanceColor.needsUpdate = true;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    group.clear();
    for (let i = 0; i < facadePbrs.length; i++) facadePbrs[i].dispose();
    for (let i = 0; i < trackedTexs.length; i++) trackedTexs[i].dispose();
    for (let i = 0; i < trackedMats.length; i++) trackedMats[i].dispose();
    for (let i = 0; i < trackedGeos.length; i++) trackedGeos[i].dispose();
    trackedTexs.length = 0;
    trackedMats.length = 0;
    trackedGeos.length = 0;
  }

  return {
    group,
    streetLampEmissives,
    nightFacadeMats,
    lightPoolMat,
    updateSignals,
    dispose,
  };
}
