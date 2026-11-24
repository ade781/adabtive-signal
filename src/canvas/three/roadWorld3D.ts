import * as THREE from 'three';
import { getEffectiveRoadWidth } from '../../engine/geometry';
import { MapBehavioralContext, resolveMapContext } from '../../engine/mapContextAI';
import { CompiledArmGeometry, CompiledTopology, IslandPolygon } from '../../engine/topologyTypes';
import { Point2D, SimConfig } from '../../engine/types';
import {
  createDashedLineTexture,
  createKanstinTexture,
  createKonblokPbr,
  createTropicalGrassTexture,
  createWeatheredAsphaltPbr,
} from './pbrTextures3D';
import {
  GraphicsQualityProfile3D,
  StaticMeshPart,
  disposeObject3D,
  mergeStaticPartsByMaterial,
} from './qualityConfig3D';

export interface SignalPolePosition3D {
  armId: string;
  x: number;
  z: number;
  angleRad: number;
  outZ: number;
}

export interface RoadWorld3DResult {
  group: THREE.Group;
  sigPositions: SignalPolePosition3D[];
  extentMeters: number;
  dispose: () => void;
}

interface RoadMaterials {
  grass: THREE.MeshStandardMaterial;
  parkGrass: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  konblok: THREE.MeshStandardMaterial;
  asphaltMain: THREE.MeshStandardMaterial;
  asphaltCenter: THREE.MeshStandardMaterial;
  kanstin: THREE.MeshStandardMaterial;
  medianConcrete: THREE.MeshStandardMaterial;
  medianTurf: THREE.MeshStandardMaterial;
  whiteSolid: THREE.MeshStandardMaterial;
  whiteDash: THREE.MeshStandardMaterial;
  yellowSolid: THREE.MeshStandardMaterial;
  yellowDash: THREE.MeshStandardMaterial;
  yellowBoxFill: THREE.MeshStandardMaterial;
  yellowBoxLine: THREE.MeshStandardMaterial;
  emeraldDash: THREE.MeshStandardMaterial;
  rhkRedFill: THREE.MeshStandardMaterial;
  rhkBorder: THREE.MeshStandardMaterial;
  busBayFill: THREE.MeshStandardMaterial;
  busBayDash: THREE.MeshStandardMaterial;
  busBayIndigo: THREE.MeshStandardMaterial;
  marketFill: THREE.MeshStandardMaterial;
  marketDash: THREE.MeshStandardMaterial;
  marketAmberDash: THREE.MeshStandardMaterial;
  cautionAmber: THREE.MeshStandardMaterial;
  cautionEmerald: THREE.MeshStandardMaterial;
  goreFill: THREE.MeshStandardMaterial;
  riverWater: THREE.MeshStandardMaterial;
  riverDeep: THREE.MeshStandardMaterial;
  riverWall: THREE.MeshStandardMaterial;
  bridgeParapet: THREE.MeshStandardMaterial;
  shrub: THREE.MeshStandardMaterial;
  dispose: () => void;
}

function resolveEnvironmentKey(config: SimConfig): string {
  if (config.environmentId && config.environmentId !== 'default') {
    return config.environmentId;
  }
  const name = (config.scenarioName ?? '').toLowerCase();
  if (name.includes('giwangan')) return 'giwangan-yogya';
  if (name.includes('brimob')) return 'brimob-yogya';
  if (name.includes('lamper')) return 'lamper-semarang';
  if (name.includes('sulawesi') || name.includes('banjarmasin')) return 'sulawesi-banjarmasin';
  if (name.includes('laswi')) return 'laswi-bandung';
  if (name.includes('bondowoso') || name.includes('retawu')) return 'bondowoso-malang';
  return 'default';
}

function getCautionZoneLabel(envId: string): string {
  if (envId === 'bondowoso-malang') return 'ZONA KAMPUS';
  if (envId === 'lamper-semarang') return 'ZONA RS';
  return 'ZONA TERTIB';
}

function createRoadMaterials(
  isWet: boolean,
  isHeavyRain: boolean
): RoadMaterials {
  const asphaltPbr = createWeatheredAsphaltPbr(isWet, isHeavyRain);
  const konblokPbr = createKonblokPbr();
  const kanstinTex = createKanstinTexture();
  const tropicalGrassTex = createTropicalGrassTexture();

  const whiteDashTex = createDashedLineTexture('rgba(248, 250, 252, 0.85)', 0.47);
  const yellowDashTex = createDashedLineTexture('#FBBF24', 0.52);
  const emeraldDashTex = createDashedLineTexture('rgba(16, 185, 129, 0.88)', 0.57);
  const busBayDashTex = createDashedLineTexture('rgba(245, 158, 11, 0.92)', 0.6);
  const marketDashTex = createDashedLineTexture('rgba(234, 88, 12, 0.9)', 0.57);
  const marketAmberDashTex = createDashedLineTexture('rgba(245, 158, 11, 0.8)', 0.41);

  const trackedMats: THREE.Material[] = [];
  const track = <T extends THREE.Material>(m: T): T => {
    trackedMats.push(m);
    return m;
  };

  const markingOffset = {
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  };

  const grass = track(
    new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      map: tropicalGrassTex,
      roughness: 0.94,
      metalness: 0.0,
    })
  );

  const parkGrass = track(
    new THREE.MeshStandardMaterial({
      color: '#EEF5E6',
      map: tropicalGrassTex,
      roughness: 0.94,
      metalness: 0.0,
    })
  );

  const soil = track(
    new THREE.MeshStandardMaterial({
      color: '#A88F6B',
      roughness: 0.96,
      metalness: 0.0,
    })
  );

  const konblok = track(
    new THREE.MeshStandardMaterial({
      map: konblokPbr.albedo,
      bumpMap: konblokPbr.bump,
      bumpScale: 0.03,
      roughness: isWet ? 0.55 : 0.86,
      metalness: 0.02,
    })
  );

  const asphaltMain = track(
    new THREE.MeshStandardMaterial({
      map: asphaltPbr.albedo,
      bumpMap: asphaltPbr.bump,
      bumpScale: isWet ? 0.02 : 0.04,
      roughnessMap: asphaltPbr.roughness,
      roughness: isWet ? 0.72 : 0.92,
      metalness: isWet ? 0.14 : 0.04,
      envMapIntensity: isWet ? 1.35 : 0.75,
    })
  );

  const asphaltCenter = track(
    new THREE.MeshStandardMaterial({
      color: isWet ? '#CBD5E1' : '#E2E8F0',
      map: asphaltPbr.albedo,
      bumpMap: asphaltPbr.bump,
      bumpScale: isWet ? 0.018 : 0.035,
      roughnessMap: asphaltPbr.roughness,
      roughness: isWet ? 0.68 : 0.9,
      metalness: isWet ? 0.16 : 0.05,
      envMapIntensity: isWet ? 1.4 : 0.8,
    })
  );

  const kanstin = track(
    new THREE.MeshStandardMaterial({
      map: kanstinTex,
      roughness: 0.78,
      metalness: 0.04,
    })
  );

  const medianConcrete = track(
    new THREE.MeshStandardMaterial({
      color: '#CBD5E1',
      roughness: 0.82,
      metalness: 0.04,
    })
  );

  const medianTurf = track(
    new THREE.MeshStandardMaterial({
      color: '#22C55E',
      roughness: 0.88,
      metalness: 0.0,
    })
  );

  const whiteSolid = track(
    new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      roughness: 0.6,
      metalness: 0.02,
      ...markingOffset,
    })
  );

  const whiteDash = track(
    new THREE.MeshStandardMaterial({
      map: whiteDashTex,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.62,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const yellowSolid = track(
    new THREE.MeshStandardMaterial({
      color: '#FBBF24',
      roughness: 0.58,
      metalness: 0.02,
      ...markingOffset,
    })
  );

  const yellowDash = track(
    new THREE.MeshStandardMaterial({
      map: yellowDashTex,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.6,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const yellowBoxFill = track(
    new THREE.MeshStandardMaterial({
      color: '#FACC15',
      transparent: true,
      opacity: 0.13,
      roughness: 0.7,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const yellowBoxLine = track(
    new THREE.MeshStandardMaterial({
      color: '#FACC15',
      transparent: true,
      opacity: 0.82,
      roughness: 0.55,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const emeraldDash = track(
    new THREE.MeshStandardMaterial({
      map: emeraldDashTex,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.6,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const rhkRedFill = track(
    new THREE.MeshStandardMaterial({
      color: '#DC2626',
      transparent: true,
      opacity: 0.36,
      roughness: 0.65,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const rhkBorder = track(
    new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      transparent: true,
      opacity: 0.86,
      roughness: 0.55,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const busBayFill = track(
    new THREE.MeshStandardMaterial({
      color: '#6366F1',
      transparent: true,
      opacity: 0.2,
      roughness: 0.68,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const busBayDash = track(
    new THREE.MeshStandardMaterial({
      map: busBayDashTex,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.6,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const busBayIndigo = track(
    new THREE.MeshStandardMaterial({
      color: '#6366F1',
      roughness: 0.58,
      ...markingOffset,
    })
  );

  const marketFill = track(
    new THREE.MeshStandardMaterial({
      color: '#C2410C',
      transparent: true,
      opacity: 0.22,
      roughness: 0.75,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const marketDash = track(
    new THREE.MeshStandardMaterial({
      map: marketDashTex,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.65,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const marketAmberDash = track(
    new THREE.MeshStandardMaterial({
      map: marketAmberDashTex,
      transparent: true,
      alphaTest: 0.15,
      roughness: 0.65,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const cautionAmber = track(
    new THREE.MeshStandardMaterial({
      color: '#F59E0B',
      roughness: 0.62,
      ...markingOffset,
    })
  );

  const cautionEmerald = track(
    new THREE.MeshStandardMaterial({
      color: '#10B981',
      roughness: 0.62,
      ...markingOffset,
    })
  );

  const goreFill = track(
    new THREE.MeshStandardMaterial({
      color: '#FACC15',
      transparent: true,
      opacity: 0.18,
      roughness: 0.68,
      depthWrite: false,
      ...markingOffset,
    })
  );

  const riverWater = track(
    new THREE.MeshStandardMaterial({
      color: '#38BDF8',
      roughness: 0.14,
      metalness: 0.28,
      envMapIntensity: 1.5,
    })
  );

  const riverDeep = track(
    new THREE.MeshStandardMaterial({
      color: '#0284C7',
      roughness: 0.12,
      metalness: 0.3,
      envMapIntensity: 1.5,
    })
  );

  const riverWall = track(
    new THREE.MeshStandardMaterial({
      color: '#94A3B8',
      roughness: 0.85,
      metalness: 0.05,
    })
  );

  const bridgeParapet = track(
    new THREE.MeshStandardMaterial({
      color: '#E2E8F0',
      roughness: 0.72,
      metalness: 0.08,
    })
  );

  const shrub = track(
    new THREE.MeshStandardMaterial({
      color: '#15803D',
      roughness: 0.85,
      metalness: 0.0,
    })
  );

  return {
    grass,
    parkGrass,
    soil,
    konblok,
    asphaltMain,
    asphaltCenter,
    kanstin,
    medianConcrete,
    medianTurf,
    whiteSolid,
    whiteDash,
    yellowSolid,
    yellowDash,
    yellowBoxFill,
    yellowBoxLine,
    emeraldDash,
    rhkRedFill,
    rhkBorder,
    busBayFill,
    busBayDash,
    busBayIndigo,
    marketFill,
    marketDash,
    marketAmberDash,
    cautionAmber,
    cautionEmerald,
    goreFill,
    riverWater,
    riverDeep,
    riverWall,
    bridgeParapet,
    shrub,
    dispose: () => {
      asphaltPbr.dispose();
      konblokPbr.dispose();
      kanstinTex.dispose();
      tropicalGrassTex.dispose();
      whiteDashTex.dispose();
      yellowDashTex.dispose();
      emeraldDashTex.dispose();
      busBayDashTex.dispose();
      marketDashTex.dispose();
      marketAmberDashTex.dispose();
      for (const m of trackedMats) {
        m.dispose();
      }
    },
  };
}

/**
 * Applies world-space planar (X, Z) UVs so PBR asphalt & konblok textures
 * tile seamlessly across boxes, shapes, and rotated arms without stretching.
 */
function applyWorldPlanarUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  if (!pos) return geo;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = pos.getX(i);
    uvs[i * 2 + 1] = pos.getZ(i);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

/**
 * Builds a flat 2D polygon geometry in XZ plane at height `y` (or extruded upward by `extrudeHeight`).
 * Uses `shape.moveTo(pt.x, -pt.y)` + `rotateX(-Math.PI / 2)` so X3D = pt.x, Z3D = pt.y.
 */
function createPolygonGeo(
  points: readonly Point2D[],
  yBase: number,
  extrudeHeight = 0,
  planarUV = true
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (i === 0) shape.moveTo(pt.x, -pt.y);
    else shape.lineTo(pt.x, -pt.y);
  }
  shape.closePath();

  const geo =
    extrudeHeight > 0.001
      ? new THREE.ExtrudeGeometry(shape, {
          depth: extrudeHeight,
          bevelEnabled: false,
          curveSegments: 8,
        })
      : new THREE.ShapeGeometry(shape, 8);

  geo.rotateX(-Math.PI / 2);
  if (yBase !== 0) {
    geo.translate(0, yBase, 0);
  }
  if (planarUV) {
    applyWorldPlanarUVs(geo);
  }
  return geo;
}

/**
 * Builds a flat horizontal quad on the XZ plane in arm-local or world coordinates.
 * (x0..x1 along X, z0..z1 along Z, at height y).
 */
function createFlatRectGeo(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  planarUV = false
): THREE.BufferGeometry {
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  const geo = new THREE.PlaneGeometry(Math.max(0.01, w), Math.max(0.01, d));
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) * 0.5, y, (z0 + z1) * 0.5);
  if (planarUV) {
    applyWorldPlanarUVs(geo);
  }
  return geo;
}

/**
 * Builds a 3D box with exact bounds [x0..x1] x [y0..y1] x [z0..z1].
 */
function createBoundsBoxGeo(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  planarUV = false
): THREE.BufferGeometry {
  const w = Math.max(0.01, Math.abs(x1 - x0));
  const h = Math.max(0.01, Math.abs(y1 - y0));
  const d = Math.max(0.01, Math.abs(z1 - z0));
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
  if (planarUV) {
    applyWorldPlanarUVs(geo);
  }
  return geo;
}

/**
 * Builds a flat ribbon strip along a 2D polyline in XZ plane at height `y`.
 * UVs: u = cumulativeDistance / cycleMeters, v = 0..1 across width.
 */
function createRibbonStripGeo(
  pts: readonly Point2D[],
  width: number,
  y: number,
  cycleMeters = 1.0
): THREE.BufferGeometry {
  if (pts.length < 2) return new THREE.BufferGeometry();
  const halfW = width * 0.5;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let cumDist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) {
      cumDist += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    }
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular normal in 2D
    const nx = -dy / len;
    const ny = dx / len;

    positions.push(p.x + nx * halfW, y, p.y + ny * halfW);
    positions.push(p.x - nx * halfW, y, p.y - ny * halfW);
    normals.push(0, 1, 0, 0, 1, 0);
    const u = cumDist / Math.max(0.1, cycleMeters);
    uvs.push(u, 0, u, 1);

    if (i < pts.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds a raised 3D kanstin curb box strip along a 2D polyline in XZ plane.
 * UVs are mapped along the curb length (cycle = 3.0m for alternating white/black blocks).
 */
function createRaisedCurbStripGeo(
  pts: readonly Point2D[],
  width: number,
  yBottom: number,
  yTop: number,
  cycleMeters = 3.0
): THREE.BufferGeometry {
  if (pts.length < 2) return new THREE.BufferGeometry();
  const halfW = width * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Build per-segment boxes so normals and UVs are crisp on every face
  let cumDist = 0;
  let vertOffset = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-4) continue;
    const dx = (b.x - a.x) / segLen;
    const dy = (b.y - a.y) / segLen;
    const nx = -dy;
    const ny = dx;

    const u0 = cumDist / cycleMeters;
    const u1 = (cumDist + segLen) / cycleMeters;
    cumDist += segLen;

    const axL = a.x + nx * halfW;
    const azL = a.y + ny * halfW;
    const axR = a.x - nx * halfW;
    const azR = a.y - ny * halfW;
    const bxL = b.x + nx * halfW;
    const bzL = b.y + ny * halfW;
    const bxR = b.x - nx * halfW;
    const bzR = b.y - ny * halfW;

    // Top face
    positions.push(
      axL, yTop, azL,
      axR, yTop, azR,
      bxL, yTop, bzL,
      bxR, yTop, bzR
    );
    uvs.push(u0, 0.2, u0, 0.8, u1, 0.2, u1, 0.8);
    indices.push(vertOffset, vertOffset + 1, vertOffset + 2, vertOffset + 1, vertOffset + 3, vertOffset + 2);
    vertOffset += 4;

    // Left side face (+n)
    positions.push(
      axL, yBottom, azL,
      axL, yTop, azL,
      bxL, yBottom, bzL,
      bxL, yTop, bzL
    );
    uvs.push(u0, 0.9, u0, 0.1, u1, 0.9, u1, 0.1);
    indices.push(vertOffset, vertOffset + 1, vertOffset + 2, vertOffset + 1, vertOffset + 3, vertOffset + 2);
    vertOffset += 4;

    // Right side face (-n)
    positions.push(
      axR, yTop, azR,
      axR, yBottom, azR,
      bxR, yTop, bzR,
      bxR, yBottom, bzR
    );
    uvs.push(u0, 0.1, u0, 0.9, u1, 0.1, u1, 0.9);
    indices.push(vertOffset, vertOffset + 1, vertOffset + 2, vertOffset + 1, vertOffset + 3, vertOffset + 2);
    vertOffset += 4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a crisp CanvasTexture badge for road/sidewalk labels (RHK, HALTE / BUS, ZONA KAMPUS, etc.).
 */
function createLabelMaterial(
  text: string,
  opts: {
    bg: string;
    fg: string;
    border?: string;
    font?: string;
    widthPx?: number;
    heightPx?: number;
  }
): { material: THREE.MeshBasicMaterial; texture: THREE.Texture } {
  const w = opts.widthPx ?? 256;
  const h = opts.heightPx ?? 64;
  let tex: THREE.Texture;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      if (opts.bg !== 'transparent') {
        ctx.fillStyle = opts.bg;
        ctx.beginPath();
        ctx.roundRect(4, 4, w - 8, h - 8, 12);
        ctx.fill();
      }
      if (opts.border) {
        ctx.strokeStyle = opts.border;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(4, 4, w - 8, h - 8, 12);
        ctx.stroke();
      }
      ctx.fillStyle = opts.fg;
      ctx.font = opts.font ?? '700 28px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 1);
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  } else {
    tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
  }

  const material = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  return { material, texture: tex };
}

function createLaneArrowGeo(
  x: number,
  z: number,
  rotY: number,
  mode: 'straight' | 'left' | 'right',
  y: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.2);
  shape.lineTo(0.48, 0.35);
  shape.lineTo(0.18, 0.35);
  shape.lineTo(0.18, -1.1);
  shape.lineTo(-0.18, -1.1);
  shape.lineTo(-0.18, 0.35);
  shape.lineTo(-0.48, 0.35);
  shape.closePath();

  const mainGeo = new THREE.ShapeGeometry(shape);
  mainGeo.rotateX(-Math.PI / 2);

  if (mode !== 'straight') {
    const s = mode === 'left' ? -1 : 1;
    const branch = new THREE.Shape();
    branch.moveTo(s * 0.18, -0.2);
    branch.lineTo(s * 0.75, -0.2);
    branch.lineTo(s * 0.75, -0.48);
    branch.lineTo(s * 1.25, -0.05);
    branch.lineTo(s * 0.75, 0.38);
    branch.lineTo(s * 0.75, 0.1);
    branch.lineTo(s * 0.18, 0.1);
    branch.closePath();
    const bGeo = new THREE.ShapeGeometry(branch);
    bGeo.rotateX(-Math.PI / 2);

    // Combine into non-indexed BufferGeometry
    const g1 = mainGeo.index ? mainGeo.toNonIndexed() : mainGeo;
    const g2 = bGeo.index ? bGeo.toNonIndexed() : bGeo;
    const p1 = g1.getAttribute('position');
    const p2 = g2.getAttribute('position');
    const combined = new Float32Array((p1.count + p2.count) * 3);
    combined.set(p1.array as Float32Array, 0);
    combined.set(p2.array as Float32Array, p1.count * 3);
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(combined, 3));
    out.computeVertexNormals();
    mainGeo.dispose();
    bGeo.dispose();
    if (g1 !== mainGeo) g1.dispose();
    if (g2 !== bGeo) g2.dispose();

    out.rotateY(rotY);
    out.translate(x, y, z);
    return out;
  }

  mainGeo.rotateY(rotY);
  mainGeo.translate(x, y, z);
  return mainGeo;
}

class RoadBuilderContext {
  readonly parts: StaticMeshPart[] = [];
  readonly tempGeos: THREE.BufferGeometry[] = [];
  readonly shrubMatrices: THREE.Matrix4[] = [];
  readonly labelCache = new Map<string, { material: THREE.MeshBasicMaterial; texture: THREE.Texture }>();

  constructor(readonly mats: RoadMaterials, readonly mapCtx: MapBehavioralContext) {}

  addPart(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    opts: { castShadow?: boolean; receiveShadow?: boolean; renderOrder?: number } = {}
  ): THREE.BufferGeometry {
    this.tempGeos.push(geo);
    this.parts.push({
      geometry: geo,
      material,
      castShadow: opts.castShadow,
      receiveShadow: opts.receiveShadow,
      renderOrder: opts.renderOrder,
    });
    return geo;
  }

  getLabelMat(
    key: string,
    text: string,
    opts: { bg: string; fg: string; border?: string; font?: string; widthPx?: number; heightPx?: number }
  ): THREE.MeshBasicMaterial {
    let entry = this.labelCache.get(key);
    if (!entry) {
      entry = createLabelMaterial(text, opts);
      this.labelCache.set(key, entry);
    }
    return entry.material;
  }

  addShrub(x: number, y: number, z: number, scale: number): void {
    const m = new THREE.Matrix4();
    m.makeScale(scale, scale * 0.85, scale);
    m.setPosition(x, y, z);
    this.shrubMatrices.push(m);
  }

  disposeLabels(): void {
    for (const entry of this.labelCache.values()) {
      entry.texture.dispose();
      entry.material.dispose();
    }
    this.labelCache.clear();
  }
}

function addYellowBox3D(bc: RoadBuilderContext, halfW: number, halfH: number): void {
  const inset = 0.6;
  const w = Math.max(2, (halfW - inset) * 2);
  const h = Math.max(2, (halfH - inset) * 2);
  const x0 = -w * 0.5;
  const x1 = w * 0.5;
  const z0 = -h * 0.5;
  const z1 = h * 0.5;
  const y = 0.042;

  bc.addPart(createFlatRectGeo(x0, z0, x1, z1, y), bc.mats.yellowBoxFill, {
    receiveShadow: true,
    renderOrder: 1,
  });

  // Outer perimeter lines
  const lw = 0.24;
  bc.addPart(createRibbonStripGeo([{ x: x0, y: z0 }, { x: x1, y: z0 }], lw, y + 0.002), bc.mats.yellowBoxLine, {
    renderOrder: 2,
  });
  bc.addPart(createRibbonStripGeo([{ x: x1, y: z0 }, { x: x1, y: z1 }], lw, y + 0.002), bc.mats.yellowBoxLine, {
    renderOrder: 2,
  });
  bc.addPart(createRibbonStripGeo([{ x: x1, y: z1 }, { x: x0, y: z1 }], lw, y + 0.002), bc.mats.yellowBoxLine, {
    renderOrder: 2,
  });
  bc.addPart(createRibbonStripGeo([{ x: x0, y: z1 }, { x: x0, y: z0 }], lw, y + 0.002), bc.mats.yellowBoxLine, {
    renderOrder: 2,
  });

  // Diagonal X-markings
  bc.addPart(createRibbonStripGeo([{ x: x0, y: z0 }, { x: x1, y: z1 }], lw, y + 0.003), bc.mats.yellowBoxLine, {
    renderOrder: 2,
  });
  bc.addPart(createRibbonStripGeo([{ x: x1, y: z0 }, { x: x0, y: z1 }], lw, y + 0.003), bc.mats.yellowBoxLine, {
    renderOrder: 2,
  });
}

function addArmContextMarkings3D(
  bc: RoadBuilderContext,
  p: {
    armId: string;
    armAngleRad: number;
    stopX: number;
    armEnd: number;
    curbY: number;
    curbFlare?: number;
    slipSetback: number;
  }
): void {
  const { armId, armAngleRad, stopX, armEnd, curbY, curbFlare = 0, slipSetback } = p;
  if (bc.mapCtx.id === 'default') return;

  const hasBusBay = bc.mapCtx.busBayArms.includes(armId);
  const hasCaution = bc.mapCtx.cautionArms.includes(armId);
  const hasMarket = bc.mapCtx.marketArms.includes(armId);
  if (!hasBusBay && !hasCaution && !hasMarket) return;

  const rotY = -armAngleRad;
  const safeUpstreamMin = slipSetback > 0 ? Math.max(22, slipSetback + 5) : 16;

  let norm = armAngleRad % (Math.PI * 2);
  if (norm > Math.PI) norm -= Math.PI * 2;
  if (norm <= -Math.PI) norm += Math.PI * 2;
  const flipText = norm > Math.PI / 2 || norm <= -Math.PI / 2;

  // 1. Bus Shelter / Terminal Bay Markings (HALTE / BUS)
  if (hasBusBay) {
    const x0 = stopX + safeUpstreamMin;
    const x1 = Math.min(armEnd - 2.5, x0 + 18);
    if (x1 - x0 >= 7) {
      const bayDepth = 1.15;
      const taper = 1.6;
      const zOuter = curbY - 0.06;
      const zInner = curbY - bayDepth;

      const bayPoly: Point2D[] = [
        { x: x0, y: zOuter },
        { x: x0 + taper, y: zInner },
        { x: x1 - taper, y: zInner },
        { x: x1, y: zOuter },
      ];
      bc.addPart(
        createPolygonGeo(bayPoly, 0.043, 0, false).rotateY(rotY),
        bc.mats.busBayFill,
        { renderOrder: 1 }
      );

      bc.addPart(
        createRibbonStripGeo(bayPoly, 0.22, 0.045, 2.1).rotateY(rotY),
        bc.mats.busBayDash,
        { renderOrder: 2 }
      );

      bc.addPart(
        createRibbonStripGeo(
          [
            { x: x0 + 0.5, y: zOuter - 0.04 },
            { x: x1 - 0.5, y: zOuter - 0.04 },
          ],
          0.16,
          0.046
        ).rotateY(rotY),
        bc.mats.busBayIndigo,
        { renderOrder: 2 }
      );

      const labelMat = bc.getLabelMat('HALTE_BUS', 'HALTE / BUS', {
        bg: 'transparent',
        fg: '#FEF3C7',
        font: '700 34px "JetBrains Mono", monospace',
        widthPx: 320,
        heightPx: 64,
      });
      const labelGeo = new THREE.PlaneGeometry(5.6, 1.1);
      labelGeo.rotateX(-Math.PI / 2);
      if (flipText) labelGeo.rotateY(Math.PI);
      labelGeo.translate((x0 + x1) * 0.5, 0.048, (zInner + zOuter) * 0.5);
      labelGeo.rotateY(rotY);
      bc.addPart(labelGeo, labelMat, { renderOrder: 3 });
    }
  }

  // 2. Market Friction Curb Edge
  if (hasMarket) {
    const x0 = stopX + (slipSetback > 0 ? Math.max(20, slipSetback + 4) : 12);
    const x1 = Math.min(armEnd - 2.5, x0 + 24);
    if (x1 - x0 >= 6) {
      bc.addPart(
        createFlatRectGeo(x0, curbY - 0.58, x1, curbY - 0.06, 0.043).rotateY(rotY),
        bc.mats.marketFill,
        { renderOrder: 1 }
      );
      bc.addPart(
        createRibbonStripGeo(
          [
            { x: x0, y: curbY - 0.56 },
            { x: x1, y: curbY - 0.56 },
          ],
          0.2,
          0.045,
          2.0
        ).rotateY(rotY),
        bc.mats.marketDash,
        { renderOrder: 2 }
      );
      bc.addPart(
        createRibbonStripGeo(
          [
            { x: x0 + 0.4, y: curbY - 0.14 },
            { x: x1 - 0.4, y: curbY - 0.14 },
          ],
          0.12,
          0.045,
          1.6
        ).rotateY(rotY),
        bc.mats.marketAmberDash,
        { renderOrder: 2 }
      );
    }
  }

  // 3. Campus / Hospital / Enforcement Caution Sidewalk Border Accent
  if (hasCaution) {
    const x0 = stopX + (slipSetback > 0 ? Math.max(22, slipSetback + 5) : 14);
    const x1 = Math.min(armEnd - 2.5, x0 + 18);
    if (x1 - x0 >= 6) {
      const bandZ = curbY + curbFlare * 0.55 + 0.46;
      const bandH = 0.74;
      let stripeIdx = 0;
      for (let sx = x0 + 0.4; sx < x1 - 0.6; sx += 1.5) {
        const mat = stripeIdx % 2 === 0 ? bc.mats.cautionAmber : bc.mats.cautionEmerald;
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: sx, y: bandZ + bandH },
              { x: sx + 0.62, y: bandZ },
            ],
            0.22,
            0.168
          ).rotateY(rotY),
          mat,
          { renderOrder: 2 }
        );
        stripeIdx++;
      }

      const label = getCautionZoneLabel(bc.mapCtx.id);
      const borderCol =
        bc.mapCtx.id === 'bondowoso-malang'
          ? '#10B981'
          : bc.mapCtx.id === 'lamper-semarang'
          ? '#F59E0B'
          : '#0EA5E9';
      const labelMat = bc.getLabelMat(`ZONE_${label}`, label, {
        bg: 'rgba(255,255,255,0.94)',
        fg: '#0F172A',
        border: borderCol,
        font: '700 28px "JetBrains Mono", monospace',
        widthPx: 256,
        heightPx: 56,
      });
      const labelGeo = new THREE.PlaneGeometry(5.2, 1.15);
      labelGeo.rotateX(-Math.PI / 2);
      if (flipText) labelGeo.rotateY(Math.PI);
      labelGeo.translate((x0 + x1) * 0.5, 0.17, bandZ + bandH + 0.82);
      labelGeo.rotateY(rotY);
      bc.addPart(labelGeo, labelMat, { renderOrder: 3 });
    }
  }
}

function buildPhysicalMedian3D(
  bc: RoadBuilderContext,
  x0: number,
  len: number,
  mW: number,
  armAngleRad: number,
  staticShadows: boolean
): void {
  if (len <= 0.8) return;
  const rotY = -armAngleRad;
  const x1 = x0 + len;
  const halfM = mW * 0.5;

  // Raised concrete median base (height 0.18m)
  bc.addPart(
    createBoundsBoxGeo(x0, 0.0, -halfM, x1, 0.18, halfM).rotateY(rotY),
    bc.mats.medianConcrete,
    { castShadow: staticShadows, receiveShadow: true }
  );

  // Green landscaped turf top
  const turfHalf = Math.max(0.1, mW * 0.28);
  bc.addPart(
    createBoundsBoxGeo(x0 + 0.35, 0.18, -turfHalf, x1 - 0.35, 0.21, turfHalf).rotateY(rotY),
    bc.mats.medianTurf,
    { receiveShadow: true }
  );

  // Ornamental shrubs placed along median via InstancedMesh
  const cosA = Math.cos(armAngleRad);
  const sinA = Math.sin(armAngleRad);
  const shrubScale = Math.min(0.45, Math.max(0.24, mW * 0.32));
  for (let d = x0 + 2.2; d < x1 - 1.5; d += 4.0) {
    const wx = d * cosA;
    const wz = d * sinA;
    bc.addShrub(wx, 0.21 + shrubScale * 0.55, wz, shrubScale);
  }
}

function buildCustomTopologyRoadWorld3D(
  bc: RoadBuilderContext,
  compiled: CompiledTopology,
  staticShadows: boolean
): SignalPolePosition3D[] {
  const sigPositions: SignalPolePosition3D[] = [];
  const groundSize = Math.max(compiled.maxExtentMeters * 5, 960);
  const groundHalf = groundSize * 0.5;

  // 0. Huge horizon tropical grass ground plane (960m x 960m+)
  bc.addPart(
    createBoundsBoxGeo(-groundHalf, -0.08, -groundHalf, groundHalf, 0.0, groundHalf, true),
    bc.mats.grass,
    { receiveShadow: true }
  );

  // 1. Sidewalk apron under arms (konblok, height = 0.16m, ~3.0m wide hugging road edges)
  for (const armId of compiled.armOrder) {
    const arm: CompiledArmGeometry = compiled.armsById[armId];
    const inOuter = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0);
    const outOuter = arm.halfMedian + arm.outWidth;
    const totalLen = arm.setback + arm.def.length + 6;
    const sidewalk = 3.0;
    const rotY = -arm.angleRad;

    bc.addPart(
      createBoundsBoxGeo(0, 0.0, -(outOuter + sidewalk), totalLen, 0.16, inOuter + sidewalk, true).rotateY(rotY),
      bc.mats.konblok,
      { receiveShadow: true }
    );
  }

  // 2. Slip-lane sidewalk apron + integrated asphalt channel polygon
  for (const isl of compiled.islands) {
    if (isl.outerBoundaryPts.length >= 6) {
      // Sidewalk apron underneath slip channel
      bc.addPart(
        createPolygonGeo(isl.outerBoundaryPts, 0.0, 0.14, true),
        bc.mats.konblok,
        { receiveShadow: true }
      );
      // Slip asphalt channel
      bc.addPart(
        createPolygonGeo(isl.outerBoundaryPts, 0.032, 0, true),
        bc.mats.asphaltMain,
        { receiveShadow: true }
      );
    } else if (isl.slipLaneCenterPts.length >= 2) {
      bc.addPart(
        createRibbonStripGeo(isl.slipLaneCenterPts, isl.slipLaneWidth + 1.4, 0.15),
        bc.mats.konblok,
        { receiveShadow: true }
      );
      bc.addPart(
        applyWorldPlanarUVs(createRibbonStripGeo(isl.slipLaneCenterPts, isl.slipLaneWidth, 0.032)),
        bc.mats.asphaltMain,
        { receiveShadow: true }
      );
    }
  }

  // 3. Center junction polygon asphalt
  if (compiled.centerPolygon.length >= 3) {
    bc.addPart(
      createPolygonGeo(compiled.centerPolygon, 0.031, 0, true),
      bc.mats.asphaltCenter,
      { receiveShadow: true }
    );
  }

  // 4. Arm asphalt, kanstin curbs, flared approaches, medians, lane markings, stop lines, RHK, arrows
  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const inOuter = arm.halfMedian + arm.inWidth;
    const flare = arm.def.curbFlareLeft ?? 0;
    const outOuter = arm.halfMedian + arm.outWidth;
    const armEnd = arm.setback + arm.def.length;
    const rotY = -arm.angleRad;

    // Main carriageway polygon (including optional curb flare on +Z inbound side)
    const roadPts: Point2D[] = [
      { x: arm.setback - 0.5, y: -outOuter },
      { x: armEnd, y: -outOuter },
      { x: armEnd, y: inOuter },
    ];
    if (flare > 0.05) {
      const flareStart = Math.min(armEnd - 4, arm.setback + 24);
      roadPts.push(
        { x: flareStart, y: inOuter },
        { x: arm.setback + 4, y: inOuter + flare },
        { x: arm.setback - 0.5, y: inOuter + flare }
      );
    } else {
      roadPts.push({ x: arm.setback - 0.5, y: inOuter });
    }
    bc.addPart(
      applyWorldPlanarUVs(createPolygonGeo(roadPts, 0.03, 0, false).rotateY(rotY)),
      bc.mats.asphaltMain,
      { receiveShadow: true }
    );

    // Raised 3D black-and-white Indonesian kanstin curbs (height = 0.18m)
    bc.addPart(
      createRaisedCurbStripGeo(
        [
          { x: arm.setback, y: -outOuter - 0.19 },
          { x: armEnd, y: -outOuter - 0.19 },
        ],
        0.38,
        0.0,
        0.18,
        3.0
      ).rotateY(rotY),
      bc.mats.kanstin,
      { castShadow: staticShadows, receiveShadow: true }
    );

    const inCurbPts: Point2D[] = [{ x: armEnd, y: inOuter + 0.19 }];
    if (flare > 0.05) {
      const flareStart = Math.min(armEnd - 4, arm.setback + 24);
      inCurbPts.push(
        { x: flareStart, y: inOuter + 0.19 },
        { x: arm.setback + 4, y: inOuter + flare + 0.19 },
        { x: arm.setback, y: inOuter + flare + 0.19 }
      );
    } else {
      inCurbPts.push({ x: arm.setback, y: inOuter + 0.19 });
    }
    bc.addPart(
      createRaisedCurbStripGeo(inCurbPts, 0.38, 0.0, 0.18, 3.0).rotateY(rotY),
      bc.mats.kanstin,
      { castShadow: staticShadows, receiveShadow: true }
    );

    // Physical center median OR double yellow / dashed yellow centerline
    const medianStart = arm.setback + 0.8;
    const medianLen = Math.max(0, armEnd - medianStart);
    const uTurnBay = arm.def.uTurnBay;
    if (arm.def.medianWidth > 0.05 && medianLen > 0) {
      const mW = Math.max(0.55, arm.def.medianWidth);
      if (uTurnBay?.enabled) {
        const bayX = arm.setback + uTurnBay.distanceBeforeStop;
        const gapHalf = 4.2;
        buildPhysicalMedian3D(bc, medianStart, Math.max(0, bayX - gapHalf - medianStart), mW, arm.angleRad, staticShadows);
        buildPhysicalMedian3D(bc, bayX + gapHalf, Math.max(0, armEnd - (bayX + gapHalf)), mW, arm.angleRad, staticShadows);

        // U-turn bay subtle pavement cue
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: bayX - gapHalf, y: 0 },
              { x: bayX + gapHalf, y: 0 },
            ],
            0.18,
            0.044,
            1.5
          ).rotateY(rotY),
          bc.mats.yellowDash,
          { renderOrder: 2 }
        );
      } else {
        buildPhysicalMedian3D(bc, medianStart, medianLen, mW, arm.angleRad, staticShadows);
      }
    } else {
      const noPassEnd = Math.min(armEnd, arm.setback + 28);
      for (const s of [-0.16, 0.16]) {
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: arm.setback, y: s },
              { x: noPassEnd, y: s },
            ],
            0.2,
            0.044
          ).rotateY(rotY),
          bc.mats.yellowSolid,
          { renderOrder: 2 }
        );
      }
      if (armEnd > noPassEnd) {
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: noPassEnd, y: 0 },
              { x: armEnd, y: 0 },
            ],
            0.2,
            0.044,
            4.6
          ).rotateY(rotY),
          bc.mats.yellowDash,
          { renderOrder: 2 }
        );
      }
    }

    // Dashed lane dividers for inbound (+Z) and outbound (-Z)
    let curIn = arm.halfMedian;
    for (let l = 0; l < arm.def.inLanes - 1; l++) {
      curIn += arm.def.inLaneWidths[l];
      bc.addPart(
        createRibbonStripGeo(
          [
            { x: arm.setback, y: curIn },
            { x: armEnd, y: curIn },
          ],
          0.16,
          0.044,
          3.4
        ).rotateY(rotY),
        bc.mats.whiteDash,
        { renderOrder: 2 }
      );
    }
    let curOut = arm.halfMedian;
    for (let l = 0; l < arm.def.outLanes - 1; l++) {
      curOut += arm.def.outLaneWidths[l];
      bc.addPart(
        createRibbonStripGeo(
          [
            { x: arm.setback, y: -curOut },
            { x: armEnd, y: -curOut },
          ],
          0.16,
          0.044,
          3.4
        ).rotateY(rotY),
        bc.mats.whiteDash,
        { renderOrder: 2 }
      );
    }

    // Solid white Stop Line
    bc.addPart(
      createFlatRectGeo(arm.setback, arm.halfMedian, arm.setback + 0.48, arm.halfMedian + arm.inWidth + flare, 0.045).rotateY(rotY),
      bc.mats.whiteSolid,
      { renderOrder: 2 }
    );

    // Emerald Exit Counting Line
    bc.addPart(
      createRibbonStripGeo(
        [
          { x: arm.setback, y: -arm.halfMedian },
          { x: arm.setback, y: -outOuter },
        ],
        0.24,
        0.045,
        1.4
      ).rotateY(rotY),
      bc.mats.emeraldDash,
      { renderOrder: 2 }
    );

    // RHK Red Motor Box
    if (arm.def.motorBoxEnabled) {
      const rhkDepth = 4.4;
      const rx = arm.setback + 0.5;
      const rz = arm.halfMedian + 0.14;
      const rw = Math.max(0.5, arm.inWidth - 0.28);

      bc.addPart(
        createFlatRectGeo(rx, rz, rx + rhkDepth, rz + rw, 0.043).rotateY(rotY),
        bc.mats.rhkRedFill,
        { renderOrder: 1 }
      );
      const borderPts: Point2D[] = [
        { x: rx, y: rz },
        { x: rx + rhkDepth, y: rz },
        { x: rx + rhkDepth, y: rz + rw },
        { x: rx, y: rz + rw },
        { x: rx, y: rz },
      ];
      bc.addPart(
        createRibbonStripGeo(borderPts, 0.15, 0.045).rotateY(rotY),
        bc.mats.rhkBorder,
        { renderOrder: 2 }
      );

      const rhkMat = bc.getLabelMat('RHK', 'RHK', {
        bg: 'transparent',
        fg: 'rgba(255,255,255,0.88)',
        font: '700 44px "JetBrains Mono", monospace',
        widthPx: 160,
        heightPx: 64,
      });
      const rhkPlane = new THREE.PlaneGeometry(2.6, 1.05);
      rhkPlane.rotateX(-Math.PI / 2);
      rhkPlane.rotateY(Math.PI / 2);
      rhkPlane.translate(rx + rhkDepth * 0.5, 0.047, rz + rw * 0.5);
      rhkPlane.rotateY(rotY);
      bc.addPart(rhkPlane, rhkMat, { renderOrder: 3 });
    }

    // LHT Lane Arrows
    for (let l = 0; l < arm.def.inLanes; l++) {
      const zOff = arm.inLaneCenters[l];
      const mode: 'straight' | 'left' | 'right' =
        arm.def.inLanes === 1
          ? 'straight'
          : l === arm.def.inLanes - 1
          ? 'left'
          : l === 0
          ? 'right'
          : 'straight';
      bc.addPart(
        createLaneArrowGeo(arm.setback + 6.5, zOff, Math.PI / 2, mode, 0.044).rotateY(rotY),
        bc.mats.whiteSolid,
        { renderOrder: 2 }
      );
    }

    // Map-aware Bus Bay, Caution Zone & Market Edge markings
    addArmContextMarkings3D(bc, {
      armId,
      armAngleRad: arm.angleRad,
      stopX: arm.setback,
      armEnd,
      curbY: inOuter,
      curbFlare: flare,
      slipSetback: arm.def.slipLane?.enabled ? arm.def.slipLane.islandSetback : 0,
    });

    sigPositions.push({
      armId,
      x: arm.signalPos.x,
      z: arm.signalPos.y,
      angleRad: arm.angleRad,
      outZ: outOuter,
    });
  }

  // 5. Slip-lane channelization separators (triangle-island, curb-divider, painted-gore)
  for (const isl of compiled.islands) {
    buildIsland3D(bc, isl, staticShadows);
  }

  // 6. Yellow Box Junction marking in center
  if (compiled.topology.yellowBoxEnabled && compiled.centerPolygon.length >= 3) {
    const xs = compiled.centerPolygon.map((p) => p.x);
    const ys = compiled.centerPolygon.map((p) => p.y);
    const halfW = Math.min(12, Math.max(4, (Math.max(...xs) - Math.min(...xs)) * 0.34));
    const halfH = Math.min(12, Math.max(4, (Math.max(...ys) - Math.min(...ys)) * 0.34));
    addYellowBox3D(bc, halfW, halfH);
  }

  return sigPositions;
}

function buildIsland3D(bc: RoadBuilderContext, isl: IslandPolygon, staticShadows: boolean): void {
  if (isl.slipLaneCenterPts.length >= 2) {
    bc.addPart(
      createRibbonStripGeo(isl.slipLaneCenterPts, 0.18, 0.044, 2.4),
      bc.mats.emeraldDash,
      { renderOrder: 2 }
    );

    const last = isl.slipLaneCenterPts[isl.slipLaneCenterPts.length - 1];
    const prev = isl.slipLaneCenterPts[isl.slipLaneCenterPts.length - 2];
    const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const hw = isl.slipLaneWidth * 0.44;
    bc.addPart(
      createRibbonStripGeo(
        [
          { x: last.x - nx * hw, y: last.y - ny * hw },
          { x: last.x + nx * hw, y: last.y + ny * hw },
        ],
        0.24,
        0.045,
        0.8
      ),
      bc.mats.whiteDash,
      { renderOrder: 2 }
    );
  }

  if (isl.style === 'curb-divider' && isl.innerEdgePts.length >= 2) {
    bc.addPart(
      createRaisedCurbStripGeo(isl.innerEdgePts, Math.max(0.35, isl.separatorThickness), 0.0, 0.18, 1.8),
      bc.mats.kanstin,
      { castShadow: staticShadows, receiveShadow: true }
    );
    return;
  }

  if (isl.style === 'painted-gore' && isl.points.length >= 3) {
    bc.addPart(createPolygonGeo(isl.points, 0.043, 0, false), bc.mats.goreFill, { renderOrder: 1 });
    const loopPts = [...isl.points, isl.points[0]];
    bc.addPart(createRibbonStripGeo(loopPts, 0.2, 0.045), bc.mats.whiteSolid, { renderOrder: 2 });
    return;
  }

  // Default: Full triangular splitter island with raised kanstin curb & green landscaped core
  if (isl.points.length < 3) return;
  bc.addPart(
    createPolygonGeo(isl.points, 0.0, 0.16, false),
    bc.mats.medianConcrete,
    { castShadow: staticShadows, receiveShadow: true }
  );

  const loopPts = [...isl.points, isl.points[0]];
  bc.addPart(
    createRaisedCurbStripGeo(loopPts, 0.34, 0.0, 0.18, 2.2),
    bc.mats.kanstin,
    { castShadow: staticShadows, receiveShadow: true }
  );

  const innerPts = isl.points.map((pt) => ({
    x: isl.centroid.x + (pt.x - isl.centroid.x) * 0.6,
    y: isl.centroid.y + (pt.y - isl.centroid.y) * 0.6,
  }));
  bc.addPart(createPolygonGeo(innerPts, 0.165, 0.02, false), bc.mats.medianTurf, { receiveShadow: true });

  // Place a central ornamental shrub on the splitter island
  bc.addShrub(isl.centroid.x, 0.36, isl.centroid.y, 0.38);
}

function buildStandard4ArmRoadWorld3D(
  bc: RoadBuilderContext,
  config: SimConfig,
  staticShadows: boolean
): { sigPositions: SignalPolePosition3D[]; extentMeters: number } {
  const halfRoad = getEffectiveRoadWidth(config);
  const halfBox = halfRoad + 2.0;
  const armLen = halfBox + config.roadLength;
  const sidewalkW = 3.0;
  const envKey = resolveEnvironmentKey(config);
  const isBanjarmasin = envKey === 'sulawesi-banjarmasin';
  const isParkNE = envKey === 'sulawesi-banjarmasin' || envKey === 'bondowoso-malang' || envKey === 'default';
  const isParkSE = envKey === 'brimob-yogya';

  const extent = armLen + 36;
  const bw = config.roadLength + 24;

  // River dimensions for Banjarmasin east corners
  const bxEast = halfRoad + sidewalkW;
  const riverOffset = Math.max(42, config.roadLength * 0.56);
  const riverX = bxEast + riverOffset;
  const riverW = Math.max(12, bw - riverOffset);

  // 0. Huge horizon tropical grass ground plane (960m x 960m+)
  const groundSize = Math.max(extent * 5, 960);
  const groundHalf = groundSize * 0.5;
  if (isBanjarmasin) {
    bc.addPart(
      createBoundsBoxGeo(-groundHalf, -0.08, -groundHalf, riverX - 1.6, 0.0, groundHalf, true),
      bc.mats.grass,
      { receiveShadow: true }
    );
    bc.addPart(
      createBoundsBoxGeo(riverX + riverW, -0.08, -groundHalf, groundHalf, 0.0, groundHalf, true),
      bc.mats.grass,
      { receiveShadow: true }
    );
  } else {
    bc.addPart(
      createBoundsBoxGeo(-groundHalf, -0.08, -groundHalf, groundHalf, 0.0, groundHalf, true),
      bc.mats.grass,
      { receiveShadow: true }
    );
  }

  // 1. Corner grass plots, proportional sidewalks (konblok 0.16m hugging road edges only), soil strips, and Banjarmasin east river
  const corners: Array<{ sx: -1 | 1; sy: -1 | 1; isPark: boolean; riverEdge: boolean }> = [
    { sx: -1, sy: -1, isPark: false, riverEdge: false },
    { sx: 1, sy: -1, isPark: isParkNE, riverEdge: isBanjarmasin },
    { sx: -1, sy: 1, isPark: false, riverEdge: false },
    { sx: 1, sy: 1, isPark: isParkSE, riverEdge: isBanjarmasin },
  ];

  for (const c of corners) {
    const bx = c.sx * (halfRoad + sidewalkW);
    const bz = c.sy * (halfRoad + sidewalkW);
    const rx0 = c.sx < 0 ? bx - bw : bx;
    const rx1 = c.sx < 0 ? bx : bx + bw;
    const rz0 = c.sy < 0 ? bz - bw : bz;
    const rz1 = c.sy < 0 ? bz : bz + bw;

    // Sidewalk strips (konblok 0.16m) strictly hugging the two road edges of this quadrant (~3.0m wide)
    const nsX0 = c.sx < 0 ? -(halfRoad + sidewalkW) : halfRoad;
    const nsX1 = c.sx < 0 ? -halfRoad : halfRoad + sidewalkW;
    const nsZ0 = c.sy < 0 ? -armLen : halfRoad;
    const nsZ1 = c.sy < 0 ? -halfRoad : armLen;
    bc.addPart(
      createBoundsBoxGeo(nsX0, 0.0, nsZ0, nsX1, 0.16, nsZ1, true),
      bc.mats.konblok,
      { receiveShadow: true }
    );

    const ewX0 = c.sx < 0 ? -armLen : halfRoad + sidewalkW;
    const ewX1 =
      c.sx < 0
        ? -(halfRoad + sidewalkW)
        : c.riverEdge
        ? Math.max(halfRoad + sidewalkW, riverX - 1.6)
        : armLen;
    const ewZ0 = c.sy < 0 ? -(halfRoad + sidewalkW) : halfRoad;
    const ewZ1 = c.sy < 0 ? -halfRoad : halfRoad + sidewalkW;
    if (ewX1 - ewX0 > 0.1) {
      bc.addPart(
        createBoundsBoxGeo(ewX0, 0.0, ewZ0, ewX1, 0.16, ewZ1, true),
        bc.mats.konblok,
        { receiveShadow: true }
      );
    }

    // Grass plot
    const grassEnd = c.riverEdge ? riverX - 1.6 : rx1;
    bc.addPart(
      createBoundsBoxGeo(rx0, 0.0, rz0, grassEnd, 0.01, rz1, true),
      c.isPark ? bc.mats.parkGrass : bc.mats.grass,
      { receiveShadow: true }
    );

    // Soil strips bordering sidewalks
    const soilStrip = 2.6;
    const sx0 = c.sx < 0 ? bx - soilStrip : bx;
    const sx1 = c.sx < 0 ? bx : bx + soilStrip;
    bc.addPart(createBoundsBoxGeo(sx0, 0.0, rz0, sx1, 0.015, rz1), bc.mats.soil, { receiveShadow: true });

    const sz0 = c.sy < 0 ? bz - soilStrip : bz;
    const sz1 = c.sy < 0 ? bz : bz + soilStrip;
    bc.addPart(
      createBoundsBoxGeo(rx0, 0.0, sz0, c.riverEdge ? Math.min(rx1, riverX - 1.6) : rx1, 0.015, sz1),
      bc.mats.soil,
      { receiveShadow: true }
    );

    // Banjarmasin East River embankment & water channel
    if (c.riverEdge) {
      bc.addPart(
        createBoundsBoxGeo(riverX - 1.6, -0.2, rz0, riverX, 0.22, rz1),
        bc.mats.riverWall,
        { castShadow: staticShadows, receiveShadow: true }
      );
      bc.addPart(
        createFlatRectGeo(riverX, rz0, riverX + riverW, rz1, -0.18),
        bc.mats.riverWater,
        { receiveShadow: true }
      );
      bc.addPart(
        createFlatRectGeo(riverX + riverW * 0.25, rz0, riverX + riverW * 0.75, rz1, -0.17),
        bc.mats.riverDeep,
        { receiveShadow: true }
      );
    }
  }

  // Banjarmasin East river section under the East road arm + bridge parapets
  if (isBanjarmasin) {
    const bridgeZ = halfRoad + sidewalkW;
    bc.addPart(
      createFlatRectGeo(riverX, -bridgeZ, riverX + riverW, bridgeZ, -0.18),
      bc.mats.riverWater,
      { receiveShadow: true }
    );
    bc.addPart(
      createFlatRectGeo(riverX + riverW * 0.25, -bridgeZ, riverX + riverW * 0.75, bridgeZ, -0.17),
      bc.mats.riverDeep,
      { receiveShadow: true }
    );
    // Bridge side parapets along North and South edges of East arm over the river
    for (const sz of [-1, 1] as const) {
      bc.addPart(
        createBoundsBoxGeo(riverX - 1.5, 0.16, sz * (halfRoad + 0.35) - 0.18, riverX + riverW + 1.5, 0.95, sz * (halfRoad + 0.35) + 0.18),
        bc.mats.bridgeParapet,
        { castShadow: staticShadows, receiveShadow: true }
      );
    }
  }

  // 2. Asphalt road arms + center junction
  bc.addPart(
    createFlatRectGeo(-halfRoad, -armLen, halfRoad, -halfBox, 0.03, true),
    bc.mats.asphaltMain,
    { receiveShadow: true }
  );
  bc.addPart(
    createFlatRectGeo(-halfRoad, halfBox, halfRoad, armLen, 0.03, true),
    bc.mats.asphaltMain,
    { receiveShadow: true }
  );
  bc.addPart(
    createFlatRectGeo(-armLen, -halfRoad, -halfBox, halfRoad, 0.03, true),
    bc.mats.asphaltMain,
    { receiveShadow: true }
  );
  bc.addPart(
    createFlatRectGeo(halfBox, -halfRoad, armLen, halfRoad, 0.03, true),
    bc.mats.asphaltMain,
    { receiveShadow: true }
  );
  // Center junction box
  bc.addPart(
    createFlatRectGeo(-halfBox, -halfBox, halfBox, halfBox, 0.031, true),
    bc.mats.asphaltCenter,
    { receiveShadow: true }
  );

  // 3. Yellow Box Junction marking
  if (config.yellowBoxEnabled) {
    addYellowBox3D(bc, halfRoad, halfRoad);
  }

  // 4. Indonesian black-and-white kanstin curbs (height = 0.18m) around all 4 corners
  const filletR = 2.2;
  const filletSteps = 6;
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      const cOff = halfRoad + 0.19;
      // Exact quarter-circle arc around (sx*(cOff+filletR), sy*(cOff+filletR))
      const pts: Point2D[] = [{ x: sx * cOff, y: sy * armLen }];
      for (let i = 0; i <= filletSteps; i++) {
        const ang = (i / filletSteps) * (Math.PI * 0.5);
        pts.push({
          x: sx * (cOff + filletR - filletR * Math.cos(ang)),
          y: sy * (cOff + filletR - filletR * Math.sin(ang)),
        });
      }
      pts.push({ x: sx * armLen, y: sy * cOff });

      bc.addPart(
        createRaisedCurbStripGeo(pts, 0.4, 0.0, 0.18, 3.0),
        bc.mats.kanstin,
        { castShadow: staticShadows, receiveShadow: true }
      );
    }
  }

  // 5. Center median OR double-yellow + dashed-yellow centerlines
  const stdAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  if (config.hasMedian) {
    const medianStart = halfBox + 0.8;
    const medianLen = Math.max(0, armLen - medianStart);
    if (medianLen > 0) {
      for (const ang of stdAngles) {
        buildPhysicalMedian3D(bc, medianStart, medianLen, 0.76, ang, staticShadows);
      }
    }
  } else {
    const noPassEnd = Math.min(armLen, halfBox + 28);
    for (const ang of stdAngles) {
      const rotY = -ang;
      for (const s of [-0.18, 0.18]) {
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: halfBox, y: s },
              { x: noPassEnd, y: s },
            ],
            0.22,
            0.044
          ).rotateY(rotY),
          bc.mats.yellowSolid,
          { renderOrder: 2 }
        );
      }
      if (armLen > noPassEnd) {
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: noPassEnd, y: 0 },
              { x: armLen, y: 0 },
            ],
            0.22,
            0.044,
            4.6
          ).rotateY(rotY),
          bc.mats.yellowDash,
          { renderOrder: 2 }
        );
      }
    }
  }

  // 6. Dashed lane dividers, Stop Lines, RHK, Emerald Exit Lines, Lane Arrows, Map Context Markings
  const L = Math.max(1, config.lanesPerDirection);
  const lw = halfRoad / L;
  const stdArmDefs: Array<{ id: 'east' | 'south' | 'west' | 'north'; angleRad: number }> = [
    { id: 'east', angleRad: 0 },
    { id: 'south', angleRad: Math.PI / 2 },
    { id: 'west', angleRad: Math.PI },
    { id: 'north', angleRad: -Math.PI / 2 },
  ];

  const sigPositions: SignalPolePosition3D[] = [];

  for (const a of stdArmDefs) {
    const rotY = -a.angleRad;

    // Dashed lane dividers
    for (let l = 1; l < L; l++) {
      const off = l * lw;
      for (const s of [-1, 1]) {
        bc.addPart(
          createRibbonStripGeo(
            [
              { x: halfBox, y: s * off },
              { x: armLen, y: s * off },
            ],
            0.16,
            0.044,
            3.4
          ).rotateY(rotY),
          bc.mats.whiteDash,
          { renderOrder: 2 }
        );
      }
    }

    // Solid white Stop Line (+Z inbound side)
    bc.addPart(
      createFlatRectGeo(halfBox, 0, halfBox + 0.45, halfRoad, 0.045).rotateY(rotY),
      bc.mats.whiteSolid,
      { renderOrder: 2 }
    );

    // Emerald Exit Counting Line (-Z outbound side)
    bc.addPart(
      createRibbonStripGeo(
        [
          { x: halfBox, y: 0 },
          { x: halfBox, y: -halfRoad },
        ],
        0.24,
        0.045,
        1.4
      ).rotateY(rotY),
      bc.mats.emeraldDash,
      { renderOrder: 2 }
    );

    // RHK Red Motor Box
    if (config.motorBoxEnabled) {
      const rhkDepth = 4.5;
      const innerMargin = config.hasMedian ? 0.5 : 0.12;
      const rx = halfBox + 0.45;
      const rz = innerMargin;
      const rw = Math.max(0.5, halfRoad - 0.12 - innerMargin);

      bc.addPart(
        createFlatRectGeo(rx, rz, rx + rhkDepth, rz + rw, 0.043).rotateY(rotY),
        bc.mats.rhkRedFill,
        { renderOrder: 1 }
      );
      const borderPts: Point2D[] = [
        { x: rx, y: rz },
        { x: rx + rhkDepth, y: rz },
        { x: rx + rhkDepth, y: rz + rw },
        { x: rx, y: rz + rw },
        { x: rx, y: rz },
      ];
      bc.addPart(
        createRibbonStripGeo(borderPts, 0.16, 0.045).rotateY(rotY),
        bc.mats.rhkBorder,
        { renderOrder: 2 }
      );

      const rhkMat = bc.getLabelMat('RHK', 'RHK', {
        bg: 'transparent',
        fg: 'rgba(255,255,255,0.88)',
        font: '700 44px "JetBrains Mono", monospace',
        widthPx: 160,
        heightPx: 64,
      });
      const rhkPlane = new THREE.PlaneGeometry(2.6, 1.05);
      rhkPlane.rotateX(-Math.PI / 2);
      rhkPlane.rotateY(Math.PI / 2);
      rhkPlane.translate(rx + rhkDepth * 0.5, 0.047, rz + rw * 0.5);
      rhkPlane.rotateY(rotY);
      bc.addPart(rhkPlane, rhkMat, { renderOrder: 3 });
    }

    // LHT Lane Arrows
    for (let l = 0; l < L; l++) {
      const zOff = (l + 0.5) * lw;
      const mode: 'straight' | 'left' | 'right' = L === 1 ? 'straight' : l === L - 1 ? 'left' : l === 0 ? 'right' : 'straight';
      bc.addPart(
        createLaneArrowGeo(halfBox + 6.0, zOff, Math.PI / 2, mode, 0.044).rotateY(rotY),
        bc.mats.whiteSolid,
        { renderOrder: 2 }
      );
    }

    // Map-aware Bus Bay, Caution Zone & Market Edge markings
    addArmContextMarkings3D(bc, {
      armId: a.id,
      armAngleRad: a.angleRad,
      stopX: halfBox,
      armEnd: armLen,
      curbY: halfRoad,
      slipSetback: 0,
    });

    // Signal pole position outside inbound left curb behind stop line
    const cosA = Math.cos(a.angleRad);
    const sinA = Math.sin(a.angleRad);
    const inLeftX = -sinA;
    const inLeftY = cosA;
    const sigDist = halfBox + 2.7;
    const sigLat = halfRoad + 2.7;
    sigPositions.push({
      armId: a.id,
      x: cosA * sigDist + inLeftX * sigLat,
      z: sinA * sigDist + inLeftY * sigLat,
      angleRad: a.angleRad,
      outZ: halfRoad,
    });
  }

  return { sigPositions, extentMeters: extent };
}

export function buildRoadWorld3D(
  config: SimConfig,
  compiledTopology: CompiledTopology | undefined,
  quality: GraphicsQualityProfile3D
): RoadWorld3DResult {
  const group = new THREE.Group();
  group.name = 'RoadWorld3D';

  const weather = config.environment?.weather ?? 'clear';
  const isWet = weather !== 'clear';
  const isHeavyRain = weather === 'heavy-rain';

  let mapCtx = resolveMapContext(config);
  if (mapCtx.id === 'default' && compiledTopology) {
    mapCtx = resolveMapContext({
      environmentId: compiledTopology.topology.id,
      scenarioName: compiledTopology.topology.name,
    });
  }

  const mats = createRoadMaterials(isWet, isHeavyRain);
  const bc = new RoadBuilderContext(mats, mapCtx);

  let sigPositions: SignalPolePosition3D[] = [];
  let extentMeters = 120;

  if (config.customTopology && compiledTopology) {
    sigPositions = buildCustomTopologyRoadWorld3D(bc, compiledTopology, quality.staticShadows);
    extentMeters = compiledTopology.maxExtentMeters;
  } else {
    const res = buildStandard4ArmRoadWorld3D(bc, config, quality.staticShadows);
    sigPositions = res.sigPositions;
    extentMeters = res.extentMeters;
  }

  const trackedGeos: THREE.BufferGeometry[] = [];
  mergeStaticPartsByMaterial(bc.parts, group, trackedGeos);

  // Dispose temporary pre-merge geometries
  for (let i = 0; i < bc.tempGeos.length; i++) {
    bc.tempGeos[i].dispose();
  }

  // Single InstancedMesh for all median & island ornamental shrubs (1 draw call total!)
  let shrubMesh: THREE.InstancedMesh | null = null;
  let shrubGeo: THREE.BufferGeometry | null = null;
  if (bc.shrubMatrices.length > 0) {
    shrubGeo = new THREE.IcosahedronGeometry(1.0, 1);
    shrubMesh = new THREE.InstancedMesh(shrubGeo, mats.shrub, bc.shrubMatrices.length);
    for (let i = 0; i < bc.shrubMatrices.length; i++) {
      shrubMesh.setMatrixAt(i, bc.shrubMatrices[i]);
    }
    shrubMesh.instanceMatrix.needsUpdate = true;
    shrubMesh.castShadow = quality.staticShadows;
    shrubMesh.receiveShadow = true;
    shrubMesh.matrixAutoUpdate = false;
    shrubMesh.updateMatrix();
    group.add(shrubMesh);
  }

  const dispose = () => {
    disposeObject3D(group);
    for (const g of trackedGeos) g.dispose();
    if (shrubGeo) shrubGeo.dispose();
    bc.disposeLabels();
    mats.dispose();
  };

  return {
    group,
    sigPositions,
    extentMeters,
    dispose,
  };
}
