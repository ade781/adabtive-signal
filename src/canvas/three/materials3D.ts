import * as THREE from 'three';
import type { DriverArchetype } from '../../engine/types';

/**
 * Canonical Swiss light-mode hex palette shared across 2D canvas and 3D WebGL renderers.
 * Hex values match `drawStaticRoad.ts` and `MapHudOverlay.tsx`.
 */
export const ARCHETYPE_HEX: Readonly<Record<DriverArchetype, string>> = Object.freeze({
  defensive: '#10B981',
  commuter: '#0EA5E9',
  hurried: '#F43F5E',
  courier: '#F59E0B',
  transit: '#6366F1',
  logistics: '#475569',
});

/**
 * Canonical Three.js `Color` instances for each driver archetype.
 * Call `.clone()` before mutating per-vehicle tinting.
 */
export const ARCHETYPE_THREE_COLORS: Readonly<Record<DriverArchetype, THREE.Color>> = Object.freeze({
  defensive: new THREE.Color(ARCHETYPE_HEX.defensive),
  commuter: new THREE.Color(ARCHETYPE_HEX.commuter),
  hurried: new THREE.Color(ARCHETYPE_HEX.hurried),
  courier: new THREE.Color(ARCHETYPE_HEX.courier),
  transit: new THREE.Color(ARCHETYPE_HEX.transit),
  logistics: new THREE.Color(ARCHETYPE_HEX.logistics),
});

/**
 * Architectural Swiss light-mode color tokens aligned with `drawStaticRoad.ts`.
 */
export const SWISS_PALETTE = Object.freeze({
  backdropGround: '#C9D3B8',
  grass: '#94AD74',
  parkGrass: '#7FA25E',
  soil: '#A88F6B',
  sidewalk: '#CFCBC2',
  yard: '#D7D2C7',
  yardBorder: '#B8B0A0',
  asphaltDry: '#373D47',
  asphaltCenterDry: '#2F353E',
  asphaltWet: '#282E38',
  asphaltCenterWet: '#222730',
  curbWhite: '#F8FAFC',
  curbSlate: '#1E293B',
  medianConcrete: '#CBD5E1',
  medianBorder: '#94A3B8',
  medianBush: '#22C55E',
  medianBushDeep: '#15803D',
  medianBushHighlight: '#86EFAC',
  riverBank: '#94A3B8',
  riverWater: '#38BDF8',
  riverDeep: '#0284C7',
  whiteLine: '#F8FAFC',
  yellowLine: '#FBBF24',
  yellowBox: '#FACC15',
  rhkRed: '#DC2626',
  emerald: '#10B981',
  indigo: '#6366F1',
  amber: '#F59E0B',
  terracotta: '#C2410C',
  orangeAccent: '#EA580C',
  slateInk: '#0F172A',
});

/** One full white + slate Indonesian kanstin curb cycle in world meters (1.5m + 1.5m). */
export const CURB_KANSTIN_CYCLE_METERS = 3.0;

/** One full amber + emerald diagonal caution stripe repeat cycle in world meters. */
export const CAUTION_STRIPE_CYCLE_METERS = 3.0;

export interface RoadMaterialSet {
  readonly isWet: boolean;
  readonly grass: THREE.MeshStandardMaterial;
  readonly parkGrass: THREE.MeshStandardMaterial;
  readonly soil: THREE.MeshStandardMaterial;
  readonly sidewalk: THREE.MeshStandardMaterial;
  readonly yard: THREE.MeshStandardMaterial;
  readonly asphalt: THREE.MeshStandardMaterial;
  readonly asphaltCenter: THREE.MeshStandardMaterial;
  readonly riverWater: THREE.MeshStandardMaterial;
  readonly curbKanstin: THREE.MeshStandardMaterial;
  readonly medianConcrete: THREE.MeshStandardMaterial;
  readonly medianBush: THREE.MeshStandardMaterial;
  readonly whiteLine: THREE.MeshStandardMaterial;
  readonly yellowLine: THREE.MeshStandardMaterial;
  readonly rhkFill: THREE.MeshStandardMaterial;
  readonly yellowBoxFill: THREE.MeshStandardMaterial;
  readonly yellowBoxStroke: THREE.MeshStandardMaterial;
  readonly emeraldGuide: THREE.MeshStandardMaterial;
  readonly busBayFill: THREE.MeshStandardMaterial;
  readonly cautionStripe: THREE.MeshStandardMaterial;
  readonly marketFill: THREE.MeshStandardMaterial;
  readonly paintedGore: THREE.MeshStandardMaterial;
  // Auxiliary architectural surfaces aligned with `drawStaticRoad.ts`
  readonly backdropGround: THREE.MeshStandardMaterial;
  readonly riverBank: THREE.MeshStandardMaterial;
  readonly riverDeep: THREE.MeshStandardMaterial;
  readonly yardBorder: THREE.MeshStandardMaterial;
  readonly laneDash: THREE.MeshStandardMaterial;
  readonly busBayStroke: THREE.MeshStandardMaterial;
  readonly marketStroke: THREE.MeshStandardMaterial;
  readonly medianBushDeep: THREE.MeshStandardMaterial;
  readonly medianBushHighlight: THREE.MeshStandardMaterial;
  dispose(): void;
}

export interface LandmarkMaterialPalette {
  readonly wallWhite: THREE.MeshStandardMaterial;
  readonly wallCream: THREE.MeshStandardMaterial;
  readonly wallSandstone: THREE.MeshStandardMaterial;
  readonly wallSlate: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly concreteDark: THREE.MeshStandardMaterial;
  readonly roofTerracotta: THREE.MeshStandardMaterial;
  readonly roofSlate: THREE.MeshStandardMaterial;
  readonly roofLight: THREE.MeshStandardMaterial;
  readonly roofEmerald: THREE.MeshStandardMaterial;
  readonly roofRed: THREE.MeshStandardMaterial;
  readonly roofBlue: THREE.MeshStandardMaterial;
  readonly roofIndigo: THREE.MeshStandardMaterial;
  readonly roofGold: THREE.MeshStandardMaterial;
  readonly glassFacade: THREE.MeshStandardMaterial;
  readonly glassDark: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly darkMetal: THREE.MeshStandardMaterial;
  readonly foliagePrimary: THREE.MeshStandardMaterial;
  readonly foliageDeep: THREE.MeshStandardMaterial;
  readonly foliageLight: THREE.MeshStandardMaterial;
  readonly foliagePalm: THREE.MeshStandardMaterial;
  readonly trunk: THREE.MeshStandardMaterial;
  readonly plazaStone: THREE.MeshStandardMaterial;
  readonly pondWater: THREE.MeshStandardMaterial;
  readonly helipadPad: THREE.MeshStandardMaterial;
  readonly helipadMarking: THREE.MeshStandardMaterial;
  readonly lampGlow: THREE.MeshStandardMaterial;
  dispose(): void;
}

function createCanvasTexture(
  name: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  draw(ctx, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural alternating white (`#F8FAFC`) and slate (`#1E293B`) Indonesian kanstin curb texture.
 * U-axis represents one full 3.0m cycle (1.5m white, 1.5m slate) and tiles seamlessly via `RepeatWrapping`.
 */
function createCurbKanstinTexture(): THREE.CanvasTexture | null {
  return createCanvasTexture('tex:curbKanstin', 256, 64, (ctx, w, h) => {
    const half = w / 2;
    ctx.fillStyle = SWISS_PALETTE.curbWhite;
    ctx.fillRect(0, 0, half, h);
    ctx.fillStyle = SWISS_PALETTE.curbSlate;
    ctx.fillRect(half, 0, half, h);
  });
}

/**
 * Procedural seamless 45° alternating amber & emerald caution zone stripe texture.
 */
function createCautionStripeTexture(): THREE.CanvasTexture | null {
  return createCanvasTexture('tex:cautionStripe', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
    ctx.fillRect(0, 0, w, h);

    // Step = w / 2 ensures stripe color parity matches cleanly across wrap boundaries.
    const step = w / 2;
    ctx.lineWidth = 20;
    ctx.lineCap = 'square';
    for (let k = -2; k <= 3; k++) {
      const x = k * step;
      ctx.strokeStyle =
        Math.abs(k) % 2 === 0
          ? 'rgba(245, 158, 11, 0.86)'
          : 'rgba(16, 185, 129, 0.86)';
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + w, 0);
      ctx.stroke();
    }
  });
}

function createMaterialTracker() {
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackTexture = <T extends THREE.Texture | null>(tex: T): T => {
    if (tex) textures.push(tex);
    return tex;
  };

  const make = (
    name: string,
    params: THREE.MeshStandardMaterialParameters
  ): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial({ ...params, name });
    materials.push(mat);
    return mat;
  };

  const dispose = (): void => {
    for (let i = 0; i < materials.length; i++) {
      materials[i].dispose();
    }
    for (let i = 0; i < textures.length; i++) {
      textures[i].dispose();
    }
  };

  return { trackTexture, make, dispose };
}

/**
 * Builds the complete architectural road & surface material set for 3D rendering.
 * Wet weather transitions asphalt and painted road markings from dry matte to subtly glossy.
 */
export function createRoadMaterials3D(isWet: boolean): RoadMaterialSet {
  const { trackTexture, make, dispose } = createMaterialTracker();

  const curbTex = trackTexture(createCurbKanstinTexture());
  const cautionTex = trackTexture(createCautionStripeTexture());

  const asphaltRoughness = isWet ? 0.26 : 0.90;
  const asphaltMetalness = isWet ? 0.15 : 0.04;
  const asphaltEnvIntensity = isWet ? 1.25 : 0.45;
  const paintRoughness = isWet ? 0.35 : 0.65;
  const markingOffset = {
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  };

  return {
    isWet,
    backdropGround: make('road:backdropGround', {
      color: SWISS_PALETTE.backdropGround,
      roughness: 0.96,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    grass: make('road:grass', {
      color: SWISS_PALETTE.grass,
      roughness: 0.94,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    parkGrass: make('road:parkGrass', {
      color: SWISS_PALETTE.parkGrass,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    soil: make('road:soil', {
      color: SWISS_PALETTE.soil,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    sidewalk: make('road:sidewalk', {
      color: SWISS_PALETTE.sidewalk,
      roughness: isWet ? 0.56 : 0.86,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    yard: make('road:yard', {
      color: SWISS_PALETTE.yard,
      roughness: isWet ? 0.58 : 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    yardBorder: make('road:yardBorder', {
      color: SWISS_PALETTE.yardBorder,
      roughness: 0.86,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    asphalt: make('road:asphalt', {
      color: isWet ? SWISS_PALETTE.asphaltWet : SWISS_PALETTE.asphaltDry,
      roughness: asphaltRoughness,
      metalness: asphaltMetalness,
      envMapIntensity: asphaltEnvIntensity,
      side: THREE.DoubleSide,
    }),
    asphaltCenter: make('road:asphaltCenter', {
      color: isWet ? SWISS_PALETTE.asphaltCenterWet : SWISS_PALETTE.asphaltCenterDry,
      roughness: isWet ? 0.23 : 0.88,
      metalness: isWet ? 0.17 : 0.05,
      envMapIntensity: asphaltEnvIntensity,
      side: THREE.DoubleSide,
    }),
    riverBank: make('road:riverBank', {
      color: SWISS_PALETTE.riverBank,
      roughness: 0.82,
      metalness: 0.04,
    }),
    riverWater: make('road:riverWater', {
      color: SWISS_PALETTE.riverWater,
      roughness: isWet ? 0.12 : 0.16,
      metalness: 0.14,
      envMapIntensity: 1.2,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    }),
    riverDeep: make('road:riverDeep', {
      color: SWISS_PALETTE.riverDeep,
      roughness: isWet ? 0.14 : 0.18,
      metalness: 0.12,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
    curbKanstin: make('road:curbKanstin', {
      color: curbTex ? '#FFFFFF' : SWISS_PALETTE.medianConcrete,
      map: curbTex,
      roughness: isWet ? 0.42 : 0.78,
      metalness: 0.04,
    }),
    medianConcrete: make('road:medianConcrete', {
      color: SWISS_PALETTE.medianConcrete,
      roughness: isWet ? 0.48 : 0.82,
      metalness: 0.04,
    }),
    medianBush: make('road:medianBush', {
      color: SWISS_PALETTE.medianBush,
      roughness: 0.86,
      metalness: 0.0,
    }),
    medianBushDeep: make('road:medianBushDeep', {
      color: SWISS_PALETTE.medianBushDeep,
      roughness: 0.88,
      metalness: 0.0,
    }),
    medianBushHighlight: make('road:medianBushHighlight', {
      color: SWISS_PALETTE.medianBushHighlight,
      roughness: 0.82,
      metalness: 0.0,
    }),
    whiteLine: make('road:whiteLine', {
      color: SWISS_PALETTE.whiteLine,
      roughness: paintRoughness,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    laneDash: make('road:laneDash', {
      color: SWISS_PALETTE.whiteLine,
      roughness: paintRoughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    yellowLine: make('road:yellowLine', {
      color: SWISS_PALETTE.yellowLine,
      roughness: paintRoughness,
      metalness: 0.02,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    rhkFill: make('road:rhkFill', {
      color: SWISS_PALETTE.rhkRed,
      roughness: isWet ? 0.34 : 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    yellowBoxFill: make('road:yellowBoxFill', {
      color: SWISS_PALETTE.yellowBox,
      roughness: isWet ? 0.36 : 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    yellowBoxStroke: make('road:yellowBoxStroke', {
      color: SWISS_PALETTE.yellowBox,
      roughness: paintRoughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    emeraldGuide: make('road:emeraldGuide', {
      color: SWISS_PALETTE.emerald,
      roughness: paintRoughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    busBayFill: make('road:busBayFill', {
      color: SWISS_PALETTE.indigo,
      roughness: isWet ? 0.36 : 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    busBayStroke: make('road:busBayStroke', {
      color: SWISS_PALETTE.amber,
      roughness: paintRoughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    cautionStripe: make('road:cautionStripe', {
      color: cautionTex ? '#FFFFFF' : SWISS_PALETTE.amber,
      map: cautionTex,
      roughness: isWet ? 0.38 : 0.72,
      metalness: 0.0,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    marketFill: make('road:marketFill', {
      color: SWISS_PALETTE.terracotta,
      roughness: isWet ? 0.38 : 0.74,
      metalness: 0.02,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    marketStroke: make('road:marketStroke', {
      color: SWISS_PALETTE.orangeAccent,
      roughness: paintRoughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    paintedGore: make('road:paintedGore', {
      color: SWISS_PALETTE.yellowBox,
      roughness: isWet ? 0.38 : 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...markingOffset,
    }),
    dispose,
  };
}

/**
 * Shared Swiss architectural maquette palette for Indonesian landmarks, buildings,
 * street furniture, and vegetation.
 */
export function createLandmarkMaterialPalette(): LandmarkMaterialPalette {
  const { make, dispose } = createMaterialTracker();

  return {
    wallWhite: make('landmark:wallWhite', {
      color: '#F8FAFC',
      roughness: 0.82,
      metalness: 0.02,
    }),
    wallCream: make('landmark:wallCream', {
      color: '#F1EFEA',
      roughness: 0.85,
      metalness: 0.02,
    }),
    wallSandstone: make('landmark:wallSandstone', {
      color: '#E2DDD2',
      roughness: 0.88,
      metalness: 0.02,
    }),
    wallSlate: make('landmark:wallSlate', {
      color: '#475569',
      roughness: 0.76,
      metalness: 0.08,
    }),
    concrete: make('landmark:concrete', {
      color: '#CBD5E1',
      roughness: 0.86,
      metalness: 0.04,
    }),
    concreteDark: make('landmark:concreteDark', {
      color: '#64748B',
      roughness: 0.82,
      metalness: 0.06,
    }),
    roofTerracotta: make('landmark:roofTerracotta', {
      color: '#C25E44',
      roughness: 0.78,
      metalness: 0.04,
    }),
    roofSlate: make('landmark:roofSlate', {
      color: '#334155',
      roughness: 0.62,
      metalness: 0.18,
    }),
    roofLight: make('landmark:roofLight', {
      color: '#E2E8F0',
      roughness: 0.75,
      metalness: 0.06,
    }),
    roofEmerald: make('landmark:roofEmerald', {
      color: '#059669',
      roughness: 0.42,
      metalness: 0.16,
    }),
    roofRed: make('landmark:roofRed', {
      color: '#DC2626',
      roughness: 0.45,
      metalness: 0.14,
    }),
    roofBlue: make('landmark:roofBlue', {
      color: '#0284C7',
      roughness: 0.45,
      metalness: 0.14,
    }),
    roofIndigo: make('landmark:roofIndigo', {
      color: '#4F46E5',
      roughness: 0.48,
      metalness: 0.18,
    }),
    roofGold: make('landmark:roofGold', {
      color: '#D97706',
      roughness: 0.30,
      metalness: 0.65,
    }),
    glassFacade: make('landmark:glassFacade', {
      color: '#7DD3FC',
      roughness: 0.12,
      metalness: 0.26,
      envMapIntensity: 1.25,
      transparent: true,
      opacity: 0.78,
    }),
    glassDark: make('landmark:glassDark', {
      color: '#0F172A',
      roughness: 0.15,
      metalness: 0.32,
      envMapIntensity: 1.15,
    }),
    steel: make('landmark:steel', {
      color: '#94A3B8',
      roughness: 0.34,
      metalness: 0.76,
    }),
    darkMetal: make('landmark:darkMetal', {
      color: '#1E293B',
      roughness: 0.42,
      metalness: 0.68,
    }),
    foliagePrimary: make('landmark:foliagePrimary', {
      color: '#22C55E',
      roughness: 0.88,
      metalness: 0.0,
    }),
    foliageDeep: make('landmark:foliageDeep', {
      color: '#15803D',
      roughness: 0.90,
      metalness: 0.0,
    }),
    foliageLight: make('landmark:foliageLight', {
      color: '#86EFAC',
      roughness: 0.84,
      metalness: 0.0,
    }),
    foliagePalm: make('landmark:foliagePalm', {
      color: '#4D7C0F',
      roughness: 0.86,
      metalness: 0.0,
    }),
    trunk: make('landmark:trunk', {
      color: '#785A3C',
      roughness: 0.92,
      metalness: 0.0,
    }),
    plazaStone: make('landmark:plazaStone', {
      color: '#D6D3CD',
      roughness: 0.86,
      metalness: 0.02,
    }),
    pondWater: make('landmark:pondWater', {
      color: '#38BDF8',
      roughness: 0.14,
      metalness: 0.14,
      transparent: true,
      opacity: 0.85,
    }),
    helipadPad: make('landmark:helipadPad', {
      color: '#475569',
      roughness: 0.78,
      metalness: 0.06,
    }),
    helipadMarking: make('landmark:helipadMarking', {
      color: '#FACC15',
      roughness: 0.55,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    lampGlow: make('landmark:lampGlow', {
      color: '#FEF3C7',
      emissive: '#FDE68A',
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.05,
    }),
    dispose,
  };
}

function collectMaterialTextures(material: THREE.Material, out: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) {
      out.add(value);
    }
  }
  if (material instanceof THREE.ShaderMaterial && material.uniforms) {
    for (const uniform of Object.values(material.uniforms)) {
      const val = uniform?.value;
      if (val instanceof THREE.Texture) {
        out.add(val);
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (item instanceof THREE.Texture) {
            out.add(item);
          }
        }
      }
    }
  }
}

/**
 * Cleanly traverses a Three.js `Object3D` (Group, Mesh, InstancedMesh, Scene) and disposes
 * all owned `BufferGeometry`, `Material` (single or array), and `Texture` GPU resources.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instancedMeshes: THREE.InstancedMesh[] = [];

  root.traverse((obj) => {
    if (obj instanceof THREE.Scene) {
      if (obj.background instanceof THREE.Texture) textures.add(obj.background);
      if (obj.environment instanceof THREE.Texture) textures.add(obj.environment);
    }

    if (obj instanceof THREE.InstancedMesh) {
      instancedMeshes.push(obj);
      if (obj.morphTexture instanceof THREE.Texture) {
        textures.add(obj.morphTexture);
      }
    }

    // THREE.Sprite shares a module-level singleton geometry in Three.js; skip disposing it.
    if (!(obj instanceof THREE.Sprite) && 'geometry' in obj) {
      const geom = (obj as { geometry?: unknown }).geometry;
      if (geom instanceof THREE.BufferGeometry) {
        geometries.add(geom);
      }
    }

    if ('material' in obj) {
      const rawMat = (obj as { material?: unknown }).material;
      if (Array.isArray(rawMat)) {
        for (let i = 0; i < rawMat.length; i++) {
          const m = rawMat[i];
          if (m instanceof THREE.Material) {
            materials.add(m);
            collectMaterialTextures(m, textures);
          }
        }
      } else if (rawMat instanceof THREE.Material) {
        materials.add(rawMat);
        collectMaterialTextures(rawMat, textures);
      }
    }
  });

  for (const im of instancedMeshes) {
    im.dispose();
  }
  for (const geom of geometries) {
    geom.dispose();
  }
  for (const tex of textures) {
    tex.dispose();
  }
  for (const mat of materials) {
    mat.dispose();
  }
}
