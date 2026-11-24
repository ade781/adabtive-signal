import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DriverArchetype, MapOverlayLayers, Vehicle } from '../../engine/types';
import { createSoftGlowBlobTexture } from './pbrTextures3D';
import { ARCHETYPE_HEX, normalizeGeometryForMerge } from './qualityConfig3D';

export type IndonesianVariantId =
  | 'skutik-harian'
  | 'skutik-harian-bonceng'
  | 'skutik-maxi'
  | 'ojol-kurir'
  | 'motor-sport'
  | 'motor-ev'
  | 'lmpv-indo'
  | 'lcgc-compact'
  | 'suv-besar'
  | 'sedan-eksekutif'
  | 'taksi-bluebird'
  | 'taksi-kuning'
  | 'angkot-ri'
  | 'pickup-l300'
  | 'blindvan-kurir'
  | 'ev-indo'
  | 'bus-brt'
  | 'bus-akap'
  | 'truk-canter'
  | 'truk-box'
  | 'truk-tangki'
  | 'truk-dump';

const ALL_VARIANTS: readonly IndonesianVariantId[] = [
  'skutik-harian',
  'skutik-harian-bonceng',
  'skutik-maxi',
  'ojol-kurir',
  'motor-sport',
  'motor-ev',
  'lmpv-indo',
  'lcgc-compact',
  'suv-besar',
  'sedan-eksekutif',
  'taksi-bluebird',
  'taksi-kuning',
  'angkot-ri',
  'pickup-l300',
  'blindvan-kurir',
  'ev-indo',
  'bus-brt',
  'bus-akap',
  'truk-canter',
  'truk-box',
  'truk-tangki',
  'truk-dump',
];

const VARIANT_CAPACITY: Record<IndonesianVariantId, number> = {
  'skutik-harian': 220,
  'skutik-harian-bonceng': 90,
  'skutik-maxi': 90,
  'ojol-kurir': 160,
  'motor-sport': 80,
  'motor-ev': 70,
  'lmpv-indo': 180,
  'lcgc-compact': 100,
  'suv-besar': 90,
  'sedan-eksekutif': 90,
  'taksi-bluebird': 60,
  'taksi-kuning': 40,
  'angkot-ri': 60,
  'pickup-l300': 60,
  'blindvan-kurir': 70,
  'ev-indo': 60,
  'bus-brt': 48,
  'bus-akap': 32,
  'truk-canter': 56,
  'truk-box': 48,
  'truk-tangki': 32,
  'truk-dump': 36,
};

const MAX_EFFECT_VEHICLES = 512;

// Atlas tile indices (8x8 grid on 512x512 canvas)
const T = {
  WHITE_PAINT: [0, 0] as const,
  SILVER_PAINT: [1, 0] as const,
  SLATE_PAINT: [2, 0] as const,
  BLACK_PAINT: [3, 0] as const,
  GLASS: [4, 0] as const,
  TIRE: [5, 0] as const,
  CHROME: [6, 0] as const,
  GRILLE: [7, 0] as const,

  OJOL_GREEN: [0, 1] as const,
  OJOL_ORANGE: [1, 1] as const,
  BLUEBIRD_BLUE: [2, 1] as const,
  CANTER_YELLOW: [3, 1] as const,
  ANGKOT_TEAL: [4, 1] as const,
  EV_MINT: [5, 1] as const,
  PERTAMINA_RED: [6, 1] as const,
  WOOD_BED: [7, 1] as const,

  BLUE_TARP: [0, 2] as const,
  NAVY_PAINT: [1, 2] as const,
  SPORT_RED: [2, 2] as const,
  DUMP_ORANGE: [3, 2] as const,
  HEADLIGHT: [4, 2] as const,
  TAILLIGHT: [5, 2] as const,
  RIDER_GEAR: [6, 2] as const,
  RIDER_JEANS: [7, 2] as const,

  PLATE_BLACK: [0, 3] as const,
  PLATE_WHITE: [1, 3] as const,
  PLATE_YELLOW: [2, 3] as const,
  PLATE_EV: [3, 3] as const,
  BRT_BODY: [4, 3] as const,
  BRT_FRONT: [5, 3] as const,
  AKAP_BODY: [6, 3] as const,
  TANKER_BODY: [7, 3] as const,
};

type TileCoord = readonly [number, number];

type BrtLiveryTheme = 'transjakarta' | 'transjogja' | 'tmb-bandung' | 'trans-semarang';

function resolveBrtLiveryTheme(environmentId?: string): BrtLiveryTheme {
  if (environmentId === 'giwangan-yogya' || environmentId === 'brimob-yogya') {
    return 'transjogja';
  }
  if (environmentId === 'laswi-bandung') {
    return 'tmb-bandung';
  }
  if (environmentId === 'lamper-semarang') {
    return 'trans-semarang';
  }
  return 'transjakarta';
}

function paintBrtTiles(
  albCtx: CanvasRenderingContext2D,
  rghCtx: CanvasRenderingContext2D,
  theme: BrtLiveryTheme
): void {
  const cell = 64;
  const bx = T.BRT_BODY[0] * cell;
  const by = T.BRT_BODY[1] * cell;
  const fx = T.BRT_FRONT[0] * cell;
  const fy = T.BRT_FRONT[1] * cell;

  let primary = '#1e3a8a'; // TransJakarta navy
  let secondary = '#f8fafc'; // White
  let accent = '#38bdf8'; // Sky blue swoosh
  if (theme === 'transjogja') {
    primary = '#eab308'; // TransJogja yellow
    secondary = '#15803d'; // Jogja green
    accent = '#facc15';
  } else if (theme === 'tmb-bandung') {
    primary = '#0284c7'; // TMB Bandung blue
    secondary = '#f97316'; // Vibrant orange
    accent = '#f8fafc';
  } else if (theme === 'trans-semarang') {
    primary = '#881337'; // Trans Semarang maroon
    secondary = '#f8fafc'; // White
    accent = '#fb7185';
  }

  // Side / body tile
  albCtx.fillStyle = secondary;
  albCtx.fillRect(bx, by, cell, cell);
  albCtx.fillStyle = primary;
  albCtx.fillRect(bx, by + 34, cell, 30);
  albCtx.fillStyle = accent;
  albCtx.fillRect(bx, by + 27, cell, 7);

  // Front / roof accent tile
  albCtx.fillStyle = primary;
  albCtx.fillRect(fx, fy, cell, cell);
  albCtx.fillStyle = accent;
  albCtx.fillRect(fx, fy + 44, cell, 10);
  albCtx.fillStyle = secondary;
  albCtx.fillRect(fx + 10, fy + 8, cell - 20, 10);

  rghCtx.fillStyle = 'rgb(62,62,62)';
  rghCtx.fillRect(bx, by, cell, cell);
  rghCtx.fillRect(fx, fy, cell, cell);
}

interface VehiclePbrAtlas {
  albedoCanvas: HTMLCanvasElement | null;
  roughnessCanvas: HTMLCanvasElement | null;
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  updateBrtLivery: (environmentId?: string) => void;
  dispose: () => void;
}

function createIndonesianVehiclePbrAtlas(environmentId?: string): VehiclePbrAtlas {
  const size = 512;
  const cell = 64;
  let albCanvas: HTMLCanvasElement | null = null;
  let rghCanvas: HTMLCanvasElement | null = null;
  let albCtx: CanvasRenderingContext2D | null = null;
  let rghCtx: CanvasRenderingContext2D | null = null;

  if (typeof document !== 'undefined') {
    albCanvas = document.createElement('canvas');
    albCanvas.width = size;
    albCanvas.height = size;
    albCtx = albCanvas.getContext('2d');

    rghCanvas = document.createElement('canvas');
    rghCanvas.width = size;
    rghCanvas.height = size;
    rghCtx = rghCanvas.getContext('2d');
  }

  const fillTile = (tile: TileCoord, color: string, roughByte: number) => {
    if (!albCtx || !rghCtx) return;
    const x = tile[0] * cell;
    const y = tile[1] * cell;
    albCtx.fillStyle = color;
    albCtx.fillRect(x, y, cell, cell);
    rghCtx.fillStyle = `rgb(${roughByte},${roughByte},${roughByte})`;
    rghCtx.fillRect(x, y, cell, cell);
  };

  if (albCtx && rghCtx) {
    albCtx.fillStyle = '#cbd5e1';
    albCtx.fillRect(0, 0, size, size);
    rghCtx.fillStyle = 'rgb(64,64,64)';
    rghCtx.fillRect(0, 0, size, size);

    // Row 0: Neutral paints, glass, tires, chrome, grille
    fillTile(T.WHITE_PAINT, '#f1f5f9', 56);
    fillTile(T.SILVER_PAINT, '#cbd5e1', 50);
    fillTile(T.SLATE_PAINT, '#475569', 60);
    fillTile(T.BLACK_PAINT, '#1e293b', 56);

    // Tinted cabin glass (glossy)
    fillTile(T.GLASS, '#0f172a', 16);
    const gX = T.GLASS[0] * cell;
    const gY = T.GLASS[1] * cell;
    const gGrad = albCtx.createLinearGradient(gX, gY, gX + cell, gY + cell);
    gGrad.addColorStop(0, '#1e293b');
    gGrad.addColorStop(0.5, '#090f1d');
    gGrad.addColorStop(1, '#334155');
    albCtx.fillStyle = gGrad;
    albCtx.fillRect(gX + 2, gY + 2, cell - 4, cell - 4);

    // Tire rubber with subtle tread
    fillTile(T.TIRE, '#18181b', 218);
    const tX = T.TIRE[0] * cell;
    const tY = T.TIRE[1] * cell;
    albCtx.fillStyle = '#09090b';
    for (let i = 4; i < cell; i += 8) {
      albCtx.fillRect(tX, tY + i, cell, 3);
    }

    // Alloy / Chrome
    fillTile(T.CHROME, '#e2e8f0', 42);
    albCtx.fillStyle = '#94a3b8';
    albCtx.fillRect(T.CHROME[0] * cell + 20, T.CHROME[1] * cell + 20, 24, 24);

    // Grille slats
    fillTile(T.GRILLE, '#111827', 165);
    albCtx.fillStyle = '#374151';
    for (let i = 6; i < cell; i += 8) {
      albCtx.fillRect(T.GRILLE[0] * cell + 4, T.GRILLE[1] * cell + i, cell - 8, 3);
    }

    // Row 1: Indonesian iconic colors
    fillTile(T.OJOL_GREEN, '#16a34a', 88);
    fillTile(T.OJOL_ORANGE, '#ea580c', 88);
    fillTile(T.BLUEBIRD_BLUE, '#0284c7', 54);
    fillTile(T.CANTER_YELLOW, '#eab308', 62);

    // Angkot teal + white route stripe
    fillTile(T.ANGKOT_TEAL, '#0d9488', 68);
    albCtx.fillStyle = '#f8fafc';
    albCtx.fillRect(T.ANGKOT_TEAL[0] * cell, T.ANGKOT_TEAL[1] * cell + 26, cell, 12);
    albCtx.fillStyle = '#0284c7';
    albCtx.fillRect(T.ANGKOT_TEAL[0] * cell, T.ANGKOT_TEAL[1] * cell + 38, cell, 6);

    fillTile(T.EV_MINT, '#99f6e4', 52);
    fillTile(T.PERTAMINA_RED, '#dc2626', 58);

    // Wooden cargo bed planks
    fillTile(T.WOOD_BED, '#92400e', 198);
    albCtx.fillStyle = '#78350f';
    for (let i = 8; i < cell; i += 10) {
      albCtx.fillRect(T.WOOD_BED[0] * cell, T.WOOD_BED[1] * cell + i, cell, 2);
    }

    // Row 2: Tarp, extra paints, lamps, rider
    fillTile(T.BLUE_TARP, '#1d4ed8', 184);
    albCtx.fillStyle = '#1e40af';
    albCtx.fillRect(T.BLUE_TARP[0] * cell, T.BLUE_TARP[1] * cell + 18, cell, 6);
    albCtx.fillRect(T.BLUE_TARP[0] * cell, T.BLUE_TARP[1] * cell + 42, cell, 6);

    fillTile(T.NAVY_PAINT, '#1e3a8a', 56);
    fillTile(T.SPORT_RED, '#b91c1c', 54);
    fillTile(T.DUMP_ORANGE, '#d97706', 86);
    fillTile(T.HEADLIGHT, '#fef9c3', 24);
    fillTile(T.TAILLIGHT, '#7f1d1d', 36);
    fillTile(T.RIDER_GEAR, '#334155', 115);
    fillTile(T.RIDER_JEANS, '#1e3a5f', 180);

    // Row 3: Indonesian License Plates & Liveries
    const drawPlate = (tile: TileCoord, bg: string, fg: string, evBlueBottom: boolean) => {
      fillTile(tile, bg, 110);
      const px = tile[0] * cell;
      const py = tile[1] * cell;
      albCtx.strokeStyle = fg;
      albCtx.lineWidth = 3;
      albCtx.strokeRect(px + 5, py + 12, cell - 10, cell - 24);
      albCtx.fillStyle = fg;
      albCtx.fillRect(px + 12, py + 22, 10, 12);
      albCtx.fillRect(px + 26, py + 22, 16, 12);
      albCtx.fillRect(px + 45, py + 22, 8, 12);
      if (evBlueBottom) {
        albCtx.fillStyle = '#2563eb';
        albCtx.fillRect(px + 5, py + cell - 19, cell - 10, 7);
      }
    };

    drawPlate(T.PLATE_BLACK, '#09090b', '#f8fafc', false);
    drawPlate(T.PLATE_WHITE, '#f8fafc', '#09090b', false);
    drawPlate(T.PLATE_YELLOW, '#facc15', '#09090b', false);
    drawPlate(T.PLATE_EV, '#09090b', '#f8fafc', true);

    paintBrtTiles(albCtx, rghCtx, resolveBrtLiveryTheme(environmentId));

    // AKAP SHD bus livery (white + maroon/gold stripe)
    fillTile(T.AKAP_BODY, '#f8fafc', 56);
    albCtx.fillStyle = '#881337';
    albCtx.fillRect(T.AKAP_BODY[0] * cell, T.AKAP_BODY[1] * cell + 30, cell, 22);
    albCtx.fillStyle = '#f59e0b';
    albCtx.fillRect(T.AKAP_BODY[0] * cell, T.AKAP_BODY[1] * cell + 24, cell, 6);

    // Pertamina Tanker cylinder (white + bold red band)
    fillTile(T.TANKER_BODY, '#f8fafc', 54);
    albCtx.fillStyle = '#dc2626';
    albCtx.fillRect(T.TANKER_BODY[0] * cell, T.TANKER_BODY[1] * cell + 18, cell, 28);
  }

  let albedo: THREE.Texture;
  let roughness: THREE.Texture;
  if (albCanvas && rghCanvas) {
    const aTex = new THREE.CanvasTexture(albCanvas);
    aTex.colorSpace = THREE.SRGBColorSpace;
    aTex.anisotropy = 8;
    aTex.needsUpdate = true;
    albedo = aTex;

    const rTex = new THREE.CanvasTexture(rghCanvas);
    rTex.colorSpace = THREE.NoColorSpace;
    rTex.anisotropy = 8;
    rTex.needsUpdate = true;
    roughness = rTex;
  } else {
    albedo = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1, THREE.RGBAFormat);
    albedo.needsUpdate = true;
    roughness = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255]), 1, 1, THREE.RGBAFormat);
    roughness.needsUpdate = true;
  }

  let currentTheme = resolveBrtLiveryTheme(environmentId);

  return {
    albedoCanvas: albCanvas,
    roughnessCanvas: rghCanvas,
    albedo,
    roughness,
    updateBrtLivery: (envId?: string) => {
      const nextTheme = resolveBrtLiveryTheme(envId);
      if (nextTheme === currentTheme) return;
      currentTheme = nextTheme;
      if (albCtx && rghCtx) {
        paintBrtTiles(albCtx, rghCtx, nextTheme);
        albedo.needsUpdate = true;
        roughness.needsUpdate = true;
      }
    },
    dispose: () => {
      albedo.dispose();
      roughness.dispose();
    },
  };
}

function mapUvToTile(geo: THREE.BufferGeometry, tile: TileCoord): THREE.BufferGeometry {
  const g = normalizeGeometryForMerge(geo);
  const uv = g.getAttribute('uv');
  if (!uv) return g;
  const pad = 3 / 512;
  const cell = 64 / 512;
  const u0 = tile[0] * cell + pad;
  const u1 = (tile[0] + 1) * cell - pad;
  const v1 = 1 - (tile[1] * cell + pad);
  const v0 = 1 - ((tile[1] + 1) * cell - pad);
  const du = u1 - u0;
  const dv = v1 - v0;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
  }
  uv.needsUpdate = true;
  return g;
}

class VehicleGeoBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  box(
    lx: number,
    ly: number,
    lz: number,
    cx: number,
    cy: number,
    cz: number,
    tile: TileCoord,
    rotZ = 0
  ): this {
    const raw = new THREE.BoxGeometry(lx, ly, lz);
    if (rotZ !== 0) raw.rotateZ(rotZ);
    raw.translate(cx, cy, cz);
    this.parts.push(mapUvToTile(raw, tile));
    raw.dispose();
    return this;
  }

  wheel(cx: number, r: number, width: number, cz: number): this {
    const raw = new THREE.CylinderGeometry(r, r, width, 12);
    raw.rotateX(Math.PI * 0.5); // cylinder axis along Z
    raw.translate(cx, r, cz);
    this.parts.push(mapUvToTile(raw, T.TIRE));
    raw.dispose();

    const rim = new THREE.CylinderGeometry(r * 0.56, r * 0.56, width + 0.02, 10);
    rim.rotateX(Math.PI * 0.5);
    rim.translate(cx, r, cz);
    this.parts.push(mapUvToTile(rim, T.CHROME));
    rim.dispose();
    return this;
  }

  cylinderX(radius: number, length: number, cx: number, cy: number, cz: number, tile: TileCoord): this {
    const raw = new THREE.CylinderGeometry(radius, radius, length, 16);
    raw.rotateZ(Math.PI * 0.5); // axis along X
    raw.translate(cx, cy, cz);
    this.parts.push(mapUvToTile(raw, tile));
    raw.dispose();
    return this;
  }

  sphere(r: number, cx: number, cy: number, cz: number, tile: TileCoord): this {
    const raw = new THREE.SphereGeometry(r, 10, 8);
    raw.translate(cx, cy, cz);
    this.parts.push(mapUvToTile(raw, tile));
    raw.dispose();
    return this;
  }

  plates(frontX: number, frontY: number, rearX: number, rearY: number, w: number, h: number, tile: TileCoord): this {
    this.box(0.03, h, w, frontX, frontY, 0, tile);
    this.box(0.03, h, w, rearX, rearY, 0, tile);
    return this;
  }

  build(): THREE.BufferGeometry {
    const merged =
      this.parts.length === 1 ? this.parts[0] : mergeGeometries(this.parts, false);
    if (this.parts.length > 1) {
      for (let i = 0; i < this.parts.length; i++) this.parts[i].dispose();
    }
    this.parts.length = 0;
    return merged ?? new THREE.BoxGeometry(1, 1, 1);
  }
}

function addRider(
  b: VehicleGeoBuilder,
  seatX: number,
  seatY: number,
  jacketTile: TileCoord,
  helmetTile: TileCoord,
  lean = -0.18,
  isPillion = false
): void {
  // Legs / jeans
  b.box(0.28, 0.34, 0.34, seatX + (isPillion ? 0.04 : 0.12), seatY - 0.1, 0, T.RIDER_JEANS);
  // Torso
  b.box(0.24, 0.44, 0.36, seatX, seatY + 0.24, 0, jacketTile, lean);
  // Helmet
  b.sphere(0.145, seatX + (lean < -0.25 ? 0.08 : 0.02), seatY + 0.56, 0, helmetTile);
  // Visor
  b.box(0.06, 0.07, 0.22, seatX + 0.12 + (lean < -0.25 ? 0.06 : 0), seatY + 0.55, 0, T.GLASS);
}

function buildVariantGeometry(variant: IndonesianVariantId): THREE.BufferGeometry {
  const b = new VehicleGeoBuilder();

  switch (variant) {
    case 'skutik-harian':
    case 'skutik-harian-bonceng': {
      // Beat / Vario / Scoopy: length ~1.9m, width ~0.72m
      b.wheel(0.64, 0.24, 0.11, 0).wheel(-0.62, 0.24, 0.11, 0);
      b.box(0.88, 0.16, 0.34, -0.04, 0.28, 0, T.SLATE_PAINT); // step-through deck
      b.box(0.42, 0.52, 0.38, 0.54, 0.62, 0, T.BLACK_PAINT, -0.18); // front apron
      b.box(0.62, 0.26, 0.34, -0.38, 0.64, 0, T.SILVER_PAINT); // rear body
      b.box(0.14, 0.14, 0.66, 0.48, 0.96, 0, T.BLACK_PAINT); // handlebar
      b.box(0.05, 0.11, 0.2, 0.72, 0.66, 0, T.HEADLIGHT);
      b.box(0.05, 0.09, 0.18, -0.72, 0.66, 0, T.TAILLIGHT);
      b.plates(0.75, 0.48, -0.74, 0.48, 0.22, 0.1, T.PLATE_BLACK);
      addRider(b, -0.14, 0.74, T.RIDER_GEAR, T.BLACK_PAINT, -0.16);
      if (variant === 'skutik-harian-bonceng') {
        addRider(b, -0.52, 0.78, T.NAVY_PAINT, T.WHITE_PAINT, -0.1);
      }
      break;
    }

    case 'skutik-maxi': {
      // NMAX / PCX maxi scooter
      b.wheel(0.68, 0.26, 0.13, 0).wheel(-0.66, 0.26, 0.13, 0);
      b.box(1.06, 0.2, 0.44, -0.02, 0.3, 0, T.BLACK_PAINT);
      b.box(0.52, 0.58, 0.48, 0.58, 0.66, 0, T.SILVER_PAINT, -0.22); // wide fairing
      b.box(0.18, 0.3, 0.38, 0.64, 1.0, 0, T.GLASS, -0.35); // windshield
      b.box(0.74, 0.3, 0.42, -0.4, 0.66, 0, T.SILVER_PAINT);
      b.box(0.14, 0.14, 0.7, 0.48, 0.96, 0, T.CHROME);
      b.box(0.05, 0.12, 0.28, 0.82, 0.68, 0, T.HEADLIGHT);
      b.box(0.05, 0.1, 0.26, -0.82, 0.66, 0, T.TAILLIGHT);
      b.plates(0.84, 0.46, -0.82, 0.46, 0.24, 0.11, T.PLATE_WHITE);
      addRider(b, -0.16, 0.74, T.SLATE_PAINT, T.WHITE_PAINT, -0.14);
      break;
    }

    case 'ojol-kurir': {
      // Gojek / Grab green jacket + helmet + rear thermal box
      b.wheel(0.64, 0.24, 0.11, 0).wheel(-0.62, 0.24, 0.11, 0);
      b.box(0.92, 0.16, 0.36, -0.04, 0.28, 0, T.BLACK_PAINT);
      b.box(0.42, 0.52, 0.38, 0.54, 0.62, 0, T.BLACK_PAINT, -0.18);
      b.box(0.62, 0.26, 0.34, -0.38, 0.64, 0, T.OJOL_GREEN);
      b.box(0.14, 0.14, 0.66, 0.48, 0.96, 0, T.BLACK_PAINT);
      b.box(0.05, 0.11, 0.2, 0.72, 0.66, 0, T.HEADLIGHT);
      // Thermal delivery box on rear rack
      b.box(0.44, 0.42, 0.44, -0.66, 0.96, 0, T.OJOL_ORANGE);
      b.box(0.46, 0.08, 0.46, -0.66, 1.15, 0, T.OJOL_GREEN);
      b.plates(0.75, 0.48, -0.88, 0.54, 0.22, 0.1, T.PLATE_BLACK);
      addRider(b, -0.12, 0.74, T.OJOL_GREEN, T.OJOL_GREEN, -0.18);
      break;
    }

    case 'motor-sport': {
      // CBR / Vixion
      b.wheel(0.68, 0.27, 0.12, 0).wheel(-0.66, 0.27, 0.14, 0);
      b.box(0.95, 0.24, 0.32, 0.0, 0.42, 0, T.BLACK_PAINT);
      b.box(0.48, 0.32, 0.34, 0.22, 0.68, 0, T.SPORT_RED); // fuel tank
      b.box(0.46, 0.44, 0.38, 0.58, 0.68, 0, T.SPORT_RED, -0.28); // sport fairing
      b.box(0.18, 0.24, 0.32, 0.62, 0.94, 0, T.GLASS, -0.45);
      b.box(0.54, 0.18, 0.26, -0.46, 0.74, 0, T.SPORT_RED, 0.15); // tail cowl
      b.box(0.05, 0.1, 0.22, 0.8, 0.68, 0, T.HEADLIGHT);
      b.plates(0.82, 0.48, -0.78, 0.54, 0.22, 0.1, T.PLATE_BLACK);
      addRider(b, -0.14, 0.76, T.BLACK_PAINT, T.SPORT_RED, -0.38);
      break;
    }

    case 'motor-ev': {
      // White EV scooter + blue EV plate strip
      b.wheel(0.62, 0.23, 0.11, 0).wheel(-0.6, 0.23, 0.11, 0);
      b.box(0.88, 0.16, 0.36, -0.02, 0.28, 0, T.WHITE_PAINT);
      b.box(0.4, 0.52, 0.38, 0.52, 0.62, 0, T.WHITE_PAINT, -0.18);
      b.box(0.62, 0.26, 0.36, -0.36, 0.64, 0, T.WHITE_PAINT);
      b.box(0.14, 0.14, 0.64, 0.46, 0.94, 0, T.WHITE_PAINT);
      b.box(0.05, 0.08, 0.26, 0.7, 0.68, 0, T.EV_MINT);
      b.plates(0.73, 0.46, -0.72, 0.46, 0.22, 0.1, T.PLATE_EV);
      addRider(b, -0.14, 0.74, T.EV_MINT, T.WHITE_PAINT, -0.14);
      break;
    }

    case 'lmpv-indo': {
      // Avanza / Xpander / Xenia (length ~4.45m, width ~1.76m)
      b.wheel(1.42, 0.34, 0.22, -0.82).wheel(1.42, 0.34, 0.22, 0.82);
      b.wheel(-1.38, 0.34, 0.22, -0.82).wheel(-1.38, 0.34, 0.22, 0.82);
      b.box(4.36, 0.62, 1.74, 0, 0.62, 0, T.SILVER_PAINT); // lower body
      b.box(2.75, 0.56, 1.56, -0.36, 1.2, 0, T.SILVER_PAINT); // long MPV cabin
      b.box(2.55, 0.42, 1.6, -0.36, 1.18, 0, T.GLASS); // greenhouse glass
      b.box(0.08, 0.28, 1.15, 2.18, 0.58, 0, T.GRILLE);
      b.box(0.08, 0.16, 0.32, 2.18, 0.72, -0.64, T.HEADLIGHT);
      b.box(0.08, 0.16, 0.32, 2.18, 0.72, 0.64, T.HEADLIGHT);
      b.box(0.08, 0.18, 0.36, -2.18, 0.78, -0.62, T.TAILLIGHT);
      b.box(0.08, 0.18, 0.36, -2.18, 0.78, 0.62, T.TAILLIGHT);
      b.plates(2.21, 0.42, -2.21, 0.52, 0.44, 0.16, T.PLATE_WHITE);
      break;
    }

    case 'lcgc-compact': {
      // Brio / Agya (length ~3.75m, width ~1.68m)
      b.wheel(1.16, 0.31, 0.2, -0.78).wheel(1.16, 0.31, 0.2, 0.78);
      b.wheel(-1.14, 0.31, 0.2, -0.78).wheel(-1.14, 0.31, 0.2, 0.78);
      b.box(3.68, 0.58, 1.66, 0, 0.58, 0, T.WHITE_PAINT);
      b.box(2.15, 0.52, 1.48, -0.32, 1.12, 0, T.WHITE_PAINT);
      b.box(1.96, 0.4, 1.52, -0.32, 1.1, 0, T.GLASS);
      b.box(0.08, 0.24, 1.0, 1.84, 0.52, 0, T.GRILLE);
      b.box(0.08, 0.15, 0.28, 1.84, 0.66, -0.58, T.HEADLIGHT);
      b.box(0.08, 0.15, 0.28, 1.84, 0.66, 0.58, T.HEADLIGHT);
      b.box(0.08, 0.16, 0.3, -1.84, 0.72, -0.58, T.TAILLIGHT);
      b.box(0.08, 0.16, 0.3, -1.84, 0.72, 0.58, T.TAILLIGHT);
      b.plates(1.86, 0.4, -1.86, 0.48, 0.42, 0.15, T.PLATE_BLACK);
      break;
    }

    case 'suv-besar': {
      // Fortuner / Pajero Sport (length ~4.75m, width ~1.86m, tall stance)
      b.wheel(1.48, 0.39, 0.24, -0.88).wheel(1.48, 0.39, 0.24, 0.88);
      b.wheel(-1.42, 0.39, 0.24, -0.88).wheel(-1.42, 0.39, 0.24, 0.88);
      b.box(4.68, 0.72, 1.84, 0, 0.74, 0, T.BLACK_PAINT);
      b.box(2.8, 0.62, 1.64, -0.4, 1.38, 0, T.BLACK_PAINT);
      b.box(2.6, 0.44, 1.68, -0.4, 1.36, 0, T.GLASS);
      b.box(2.2, 0.06, 0.08, -0.4, 1.72, -0.62, T.CHROME); // roof rail
      b.box(2.2, 0.06, 0.08, -0.4, 1.72, 0.62, T.CHROME);
      b.box(0.08, 0.36, 1.24, 2.34, 0.72, 0, T.GRILLE);
      b.box(0.08, 0.16, 0.34, 2.34, 0.88, -0.68, T.HEADLIGHT);
      b.box(0.08, 0.16, 0.34, 2.34, 0.88, 0.68, T.HEADLIGHT);
      b.box(0.08, 0.18, 0.38, -2.34, 0.92, -0.66, T.TAILLIGHT);
      b.box(0.08, 0.18, 0.38, -2.34, 0.92, 0.66, T.TAILLIGHT);
      b.plates(2.37, 0.48, -2.37, 0.62, 0.46, 0.16, T.PLATE_BLACK);
      break;
    }

    case 'sedan-eksekutif': {
      // 3-box executive sedan
      b.wheel(1.42, 0.33, 0.22, -0.82).wheel(1.42, 0.33, 0.22, 0.82);
      b.wheel(-1.38, 0.33, 0.22, -0.82).wheel(-1.38, 0.33, 0.22, 0.82);
      b.box(4.56, 0.54, 1.78, 0, 0.56, 0, T.NAVY_PAINT);
      b.box(2.15, 0.5, 1.54, -0.14, 1.06, 0, T.NAVY_PAINT);
      b.box(1.94, 0.38, 1.58, -0.14, 1.05, 0, T.GLASS);
      b.box(0.08, 0.24, 1.1, 2.28, 0.52, 0, T.GRILLE);
      b.box(0.08, 0.14, 0.32, 2.28, 0.64, -0.64, T.HEADLIGHT);
      b.box(0.08, 0.14, 0.32, 2.28, 0.64, 0.64, T.HEADLIGHT);
      b.box(0.08, 0.15, 0.34, -2.28, 0.68, -0.62, T.TAILLIGHT);
      b.box(0.08, 0.15, 0.34, -2.28, 0.68, 0.62, T.TAILLIGHT);
      b.plates(2.3, 0.38, -2.3, 0.48, 0.44, 0.15, T.PLATE_WHITE);
      break;
    }

    case 'taksi-bluebird':
    case 'taksi-kuning': {
      const paint = variant === 'taksi-bluebird' ? T.BLUEBIRD_BLUE : T.CANTER_YELLOW;
      b.wheel(1.38, 0.33, 0.21, -0.8).wheel(1.38, 0.33, 0.21, 0.8);
      b.wheel(-1.36, 0.33, 0.21, -0.8).wheel(-1.36, 0.33, 0.21, 0.8);
      b.box(4.42, 0.54, 1.76, 0, 0.56, 0, paint);
      b.box(2.12, 0.5, 1.52, -0.14, 1.06, 0, paint);
      b.box(1.92, 0.38, 1.56, -0.14, 1.05, 0, T.GLASS);
      // Iconic taxi roof crown
      b.box(0.24, 0.16, 0.54, 0.05, 1.38, 0, T.WHITE_PAINT);
      b.box(0.26, 0.08, 0.42, 0.05, 1.4, 0, T.CANTER_YELLOW);
      b.box(0.08, 0.24, 1.08, 2.21, 0.52, 0, T.GRILLE);
      b.box(0.08, 0.14, 0.3, 2.21, 0.64, -0.62, T.HEADLIGHT);
      b.box(0.08, 0.14, 0.3, 2.21, 0.64, 0.62, T.HEADLIGHT);
      b.box(0.08, 0.15, 0.34, -2.21, 0.68, -0.6, T.TAILLIGHT);
      b.box(0.08, 0.15, 0.34, -2.21, 0.68, 0.6, T.TAILLIGHT);
      b.plates(2.23, 0.38, -2.23, 0.48, 0.44, 0.15, T.PLATE_YELLOW);
      break;
    }

    case 'angkot-ri': {
      // Iconic cab-over Carry/GranMax Angkot (short boxy length ~3.85m, tall roof)
      b.wheel(1.22, 0.3, 0.2, -0.76).wheel(1.22, 0.3, 0.2, 0.76);
      b.wheel(-1.22, 0.3, 0.2, -0.76).wheel(-1.22, 0.3, 0.2, 0.76);
      b.box(3.82, 0.68, 1.66, 0, 0.62, 0, T.ANGKOT_TEAL);
      b.box(3.66, 0.74, 1.6, -0.04, 1.32, 0, T.ANGKOT_TEAL);
      b.box(3.45, 0.48, 1.64, -0.02, 1.32, 0, T.GLASS);
      b.box(0.28, 0.14, 0.68, 1.4, 1.74, 0, T.WHITE_PAINT); // route sign on roof
      b.box(0.08, 0.22, 1.1, 1.91, 0.58, 0, T.GRILLE);
      b.box(0.08, 0.16, 0.28, 1.91, 0.7, -0.6, T.HEADLIGHT);
      b.box(0.08, 0.16, 0.28, 1.91, 0.7, 0.6, T.HEADLIGHT);
      b.plates(1.93, 0.4, -1.93, 0.48, 0.44, 0.15, T.PLATE_YELLOW);
      break;
    }

    case 'pickup-l300': {
      // Flat-nose L300 / Carry pickup with cargo boxes & blue tarp in rear bed
      b.wheel(1.36, 0.33, 0.21, -0.8).wheel(1.36, 0.33, 0.21, 0.8);
      b.wheel(-1.32, 0.33, 0.21, -0.8).wheel(-1.32, 0.33, 0.21, 0.8);
      b.box(4.32, 0.38, 1.76, 0, 0.5, 0, T.SLATE_PAINT); // chassis
      // Cab-over front
      b.box(1.56, 1.18, 1.72, 1.36, 1.16, 0, T.BLACK_PAINT);
      b.box(1.32, 0.48, 1.76, 1.46, 1.34, 0, T.GLASS);
      // Open rear bed + cargo + blue tarp
      b.box(2.58, 0.36, 1.78, -0.84, 0.86, 0, T.SLATE_PAINT);
      b.box(2.38, 0.56, 1.62, -0.84, 1.18, 0, T.BLUE_TARP);
      b.box(0.76, 0.44, 0.72, -0.42, 1.36, 0.32, T.WOOD_BED);
      b.box(0.08, 0.24, 1.16, 2.16, 0.58, 0, T.GRILLE);
      b.box(0.08, 0.16, 0.28, 2.16, 0.72, -0.64, T.HEADLIGHT);
      b.box(0.08, 0.16, 0.28, 2.16, 0.72, 0.64, T.HEADLIGHT);
      b.plates(2.18, 0.4, -2.15, 0.48, 0.44, 0.15, T.PLATE_BLACK);
      break;
    }

    case 'blindvan-kurir': {
      // Gran Max blind van / courier delivery van
      b.wheel(1.34, 0.32, 0.21, -0.8).wheel(1.34, 0.32, 0.21, 0.8);
      b.wheel(-1.32, 0.32, 0.21, -0.8).wheel(-1.32, 0.32, 0.21, 0.8);
      b.box(4.24, 0.66, 1.74, 0, 0.62, 0, T.WHITE_PAINT);
      b.box(4.06, 0.82, 1.7, -0.04, 1.34, 0, T.WHITE_PAINT);
      b.box(1.2, 0.5, 1.74, 1.36, 1.32, 0, T.GLASS); // front cab windows only
      b.box(2.4, 0.18, 1.73, -0.78, 1.06, 0, T.OJOL_ORANGE); // courier side stripe
      b.box(0.08, 0.24, 1.14, 2.12, 0.56, 0, T.GRILLE);
      b.box(0.08, 0.16, 0.28, 2.12, 0.7, -0.62, T.HEADLIGHT);
      b.box(0.08, 0.16, 0.28, 2.12, 0.7, 0.62, T.HEADLIGHT);
      b.plates(2.14, 0.4, -2.14, 0.48, 0.44, 0.15, T.PLATE_WHITE);
      break;
    }

    case 'ev-indo': {
      // Wuling Air EV / Ioniq 5 pastel EV with LED lightbar + blue EV plate
      b.wheel(1.26, 0.31, 0.2, -0.78).wheel(1.26, 0.31, 0.2, 0.78);
      b.wheel(-1.24, 0.31, 0.2, -0.78).wheel(-1.24, 0.31, 0.2, 0.78);
      b.box(3.92, 0.62, 1.7, 0, 0.6, 0, T.EV_MINT);
      b.box(2.48, 0.56, 1.54, -0.24, 1.18, 0, T.WHITE_PAINT); // floating white roof
      b.box(2.3, 0.42, 1.58, -0.24, 1.16, 0, T.GLASS);
      b.box(0.08, 0.1, 1.46, 1.96, 0.74, 0, T.HEADLIGHT); // full-width EV LED bar
      b.box(0.08, 0.1, 1.46, -1.96, 0.78, 0, T.TAILLIGHT);
      b.plates(1.98, 0.4, -1.98, 0.48, 0.44, 0.15, T.PLATE_EV);
      break;
    }

    case 'bus-brt': {
      // City-adaptive BRT Bus (TransJakarta / TransJogja / TMB Bandung / Trans Semarang)
      b.wheel(2.85, 0.5, 0.32, -1.1).wheel(2.85, 0.5, 0.32, 1.1);
      b.wheel(-2.75, 0.5, 0.32, -1.1).wheel(-2.75, 0.5, 0.32, 1.1);
      b.box(9.1, 1.05, 2.46, 0, 1.0, 0, T.BRT_BODY);
      b.box(8.95, 1.38, 2.42, 0, 2.2, 0, T.BRT_BODY);
      b.box(8.45, 0.92, 2.46, 0.18, 2.22, 0, T.GLASS);
      b.box(0.12, 0.5, 2.42, 4.52, 0.85, 0, T.BRT_FRONT);
      b.box(2.6, 0.24, 1.5, 0.2, 3.01, 0, T.WHITE_PAINT); // roof AC pod
      b.box(0.08, 0.22, 0.42, 4.56, 0.74, -0.88, T.HEADLIGHT);
      b.box(0.08, 0.22, 0.42, 4.56, 0.74, 0.88, T.HEADLIGHT);
      b.plates(4.58, 0.46, -4.58, 0.56, 0.54, 0.18, T.PLATE_YELLOW);
      break;
    }

    case 'bus-akap': {
      // High-deck SHD intercity bus
      b.wheel(2.9, 0.52, 0.32, -1.12).wheel(2.9, 0.52, 0.32, 1.12);
      b.wheel(-2.8, 0.52, 0.32, -1.12).wheel(-2.8, 0.52, 0.32, 1.12);
      b.box(9.2, 1.24, 2.48, 0, 1.1, 0, T.AKAP_BODY);
      b.box(9.06, 1.54, 2.44, 0, 2.48, 0, T.AKAP_BODY);
      b.box(8.56, 1.06, 2.48, 0.16, 2.48, 0, T.GLASS); // tall SHD glass
      b.box(2.8, 0.26, 1.56, 0, 3.38, 0, T.WHITE_PAINT); // roof AC pod
      b.box(0.08, 0.24, 0.44, 4.61, 0.8, -0.9, T.HEADLIGHT);
      b.box(0.08, 0.24, 0.44, 4.61, 0.8, 0.9, T.HEADLIGHT);
      b.plates(4.63, 0.48, -4.63, 0.58, 0.54, 0.18, T.PLATE_YELLOW);
      break;
    }

    case 'truk-canter': {
      // Iconic Indonesian Yellow Colt Diesel Canter + wooden/tarp cargo bed
      b.wheel(2.65, 0.46, 0.28, -1.04).wheel(2.65, 0.46, 0.28, 1.04);
      b.wheel(-2.35, 0.46, 0.28, -1.04).wheel(-2.35, 0.46, 0.28, 1.04);
      b.box(8.4, 0.4, 2.1, -0.1, 0.66, 0, T.SLATE_PAINT); // chassis
      b.box(2.2, 1.85, 2.26, 3.1, 1.66, 0, T.CANTER_YELLOW); // yellow cab-over
      b.box(1.6, 0.84, 2.3, 3.35, 1.98, 0, T.GLASS);
      b.box(0.1, 0.42, 1.65, 4.21, 1.12, 0, T.GRILLE);
      b.box(5.95, 1.25, 2.34, -1.18, 1.5, 0, T.WOOD_BED); // wooden cargo bed
      b.box(5.85, 0.78, 2.28, -1.18, 2.48, 0, T.BLUE_TARP); // tarp top
      b.box(0.08, 0.2, 0.36, 4.21, 0.92, -0.84, T.HEADLIGHT);
      b.box(0.08, 0.2, 0.36, 4.21, 0.92, 0.84, T.HEADLIGHT);
      b.plates(4.23, 0.58, -4.2, 0.58, 0.52, 0.18, T.PLATE_YELLOW);
      break;
    }

    case 'truk-box': {
      // White / silver box truck
      b.wheel(2.75, 0.48, 0.3, -1.08).wheel(2.75, 0.48, 0.3, 1.08);
      b.wheel(-2.45, 0.48, 0.3, -1.08).wheel(-2.45, 0.48, 0.3, 1.08);
      b.box(8.8, 0.42, 2.2, 0, 0.68, 0, T.SLATE_PAINT);
      b.box(2.25, 1.9, 2.32, 3.25, 1.72, 0, T.SILVER_PAINT);
      b.box(1.6, 0.86, 2.36, 3.5, 2.04, 0, T.GLASS);
      b.box(6.25, 2.36, 2.44, -1.25, 2.08, 0, T.WHITE_PAINT); // tall cargo box
      b.box(0.1, 0.44, 1.7, 4.38, 1.16, 0, T.GRILLE);
      b.box(0.08, 0.2, 0.38, 4.38, 0.92, -0.86, T.HEADLIGHT);
      b.box(0.08, 0.2, 0.38, 4.38, 0.92, 0.86, T.HEADLIGHT);
      b.plates(4.4, 0.58, -4.4, 0.6, 0.52, 0.18, T.PLATE_YELLOW);
      break;
    }

    case 'truk-tangki': {
      // Pertamina red-white cylindrical fuel tanker
      b.wheel(2.8, 0.48, 0.3, -1.08).wheel(2.8, 0.48, 0.3, 1.08);
      b.wheel(-2.5, 0.48, 0.3, -1.08).wheel(-2.5, 0.48, 0.3, 1.08);
      b.box(8.8, 0.42, 2.2, 0, 0.68, 0, T.SLATE_PAINT);
      b.box(2.25, 1.9, 2.32, 3.25, 1.72, 0, T.PERTAMINA_RED);
      b.box(1.6, 0.86, 2.36, 3.5, 2.04, 0, T.GLASS);
      b.cylinderX(1.08, 6.1, -1.15, 1.96, 0, T.TANKER_BODY); // red-white fuel cylinder
      b.box(0.1, 0.44, 1.7, 4.38, 1.16, 0, T.GRILLE);
      b.box(0.08, 0.2, 0.38, 4.38, 0.92, -0.86, T.HEADLIGHT);
      b.box(0.08, 0.2, 0.38, 4.38, 0.92, 0.86, T.HEADLIGHT);
      b.plates(4.4, 0.58, -4.32, 0.62, 0.52, 0.18, T.PLATE_YELLOW);
      break;
    }

    case 'truk-dump': {
      // Heavy dump truck
      b.wheel(2.75, 0.5, 0.32, -1.1).wheel(2.75, 0.5, 0.32, 1.1);
      b.wheel(-2.45, 0.5, 0.32, -1.1).wheel(-2.45, 0.5, 0.32, 1.1);
      b.box(8.7, 0.44, 2.24, 0, 0.72, 0, T.SLATE_PAINT);
      b.box(2.25, 1.95, 2.32, 3.2, 1.76, 0, T.DUMP_ORANGE);
      b.box(1.6, 0.86, 2.36, 3.45, 2.08, 0, T.GLASS);
      b.box(6.05, 1.55, 2.42, -1.2, 1.72, 0, T.SLATE_PAINT); // steel dump bed
      b.box(0.7, 0.28, 2.42, 1.5, 2.6, 0, T.SLATE_PAINT); // cab guard visor
      b.box(0.1, 0.44, 1.7, 4.33, 1.18, 0, T.GRILLE);
      b.box(0.08, 0.2, 0.38, 4.33, 0.94, -0.86, T.HEADLIGHT);
      b.box(0.08, 0.2, 0.38, 4.33, 0.94, 0.86, T.HEADLIGHT);
      b.plates(4.35, 0.58, -4.32, 0.62, 0.52, 0.18, T.PLATE_YELLOW);
      break;
    }
  }

  return b.build();
}

function resolveIndonesianVariant(v: Vehicle): IndonesianVariantId {
  const key = v.spriteKey;
  if (v.vClass === 'motor') {
    if (key.includes('delivery-box')) return 'ojol-kurir';
    if (key.includes('ev-white')) return 'motor-ev';
    if (key.includes('sport')) return 'motor-sport';
    if (key.includes('cruiser')) return 'skutik-maxi';
    if (v.archetype === 'courier' && v.id % 2 === 0) return 'ojol-kurir';
    return v.id % 4 === 0 ? 'skutik-harian-bonceng' : 'skutik-harian';
  }
  if (v.vClass === 'heavy') {
    if (key.includes('bus-city') || v.archetype === 'transit') {
      return v.id % 4 === 0 ? 'bus-akap' : 'bus-brt';
    }
    if (key.includes('tanker')) return 'truk-tangki';
    if (key.includes('dump')) return 'truk-dump';
    if (key.includes('box')) return 'truk-box';
    return 'truk-canter';
  }
  // Car class
  if (key.includes('taxi')) return v.id % 5 === 0 ? 'taksi-kuning' : 'taksi-bluebird';
  if (key.includes('ev-mint')) return 'ev-indo';
  if (key.includes('van-delivery')) return 'blindvan-kurir';
  if (key.includes('pickup')) return 'pickup-l300';
  if (key.includes('suv')) return 'suv-besar';
  if (key.includes('luxury')) return v.id % 2 === 0 ? 'suv-besar' : 'sedan-eksekutif';
  if (key.includes('compact')) return v.id % 3 === 0 ? 'angkot-ri' : 'lcgc-compact';
  if (key.includes('sedan-white')) return v.id % 4 === 0 ? 'sedan-eksekutif' : 'lmpv-indo';
  return v.id % 3 === 0 ? 'sedan-eksekutif' : 'lmpv-indo';
}

function createHeadlightConeTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(new Uint8Array([255, 240, 200, 128]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
  const w = 128;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    // Fan pointing toward +U (right side of canvas -> +X in world after plane rotation)
    const grad = ctx.createRadialGradient(8, 64, 2, 72, 64, 114);
    grad.addColorStop(0.0, 'rgba(254, 243, 199, 0.72)');
    grad.addColorStop(0.45, 'rgba(253, 224, 71, 0.30)');
    grad.addColorStop(1.0, 'rgba(253, 224, 71, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(4, 52);
    ctx.lineTo(126, 6);
    ctx.lineTo(126, 122);
    ctx.lineTo(4, 76);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createArchetypeRingTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 128]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(12, 18, size - 24, size - 36, 28);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.roundRect(12, 18, size - 24, size - 36, 28);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Module-level zero-GC scratch objects
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _color = new THREE.Color();

export class IndonesianFleet3D {
  private readonly root = new THREE.Group();
  private readonly atlas: VehiclePbrAtlas;
  private readonly sharedMat: THREE.MeshStandardMaterial;
  private readonly variantMeshes = new Map<IndonesianVariantId, THREE.InstancedMesh>();
  private readonly variantGeos: THREE.BufferGeometry[] = [];
  private readonly variantCounts = new Map<IndonesianVariantId, number>();

  // 5 Global Dynamic Effect InstancedMeshes
  private readonly contactShadows: THREE.InstancedMesh;
  private readonly brakeReverseLights: THREE.InstancedMesh;
  private readonly blinkers: THREE.InstancedMesh;
  private readonly headlightCones: THREE.InstancedMesh;
  private readonly archetypeRings: THREE.InstancedMesh;

  private readonly effectGeos: THREE.BufferGeometry[] = [];
  private readonly effectMats: THREE.Material[] = [];
  private readonly effectTexs: THREE.Texture[] = [];

  constructor(scene: THREE.Scene, environmentId?: string) {
    this.root.name = 'IndonesianFleet3D';
    scene.add(this.root);

    this.atlas = createIndonesianVehiclePbrAtlas(environmentId);
    this.sharedMat = new THREE.MeshStandardMaterial({
      map: this.atlas.albedo,
      roughnessMap: this.atlas.roughness,
      roughness: 1.0,
      metalness: 0.18,
      envMapIntensity: 0.9,
    });

    for (let i = 0; i < ALL_VARIANTS.length; i++) {
      const id = ALL_VARIANTS[i];
      const geo = buildVariantGeometry(id);
      const cap = VARIANT_CAPACITY[id];
      const im = new THREE.InstancedMesh(geo, this.sharedMat, cap);
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = false;
      im.frustumCulled = false;
      im.name = `fleet_${id}`;
      // Initialize instanceColor buffer so setColorAt works immediately
      _color.setHex(0xffffff);
      for (let c = 0; c < cap; c++) {
        im.setColorAt(c, _color);
      }
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.root.add(im);
      this.variantMeshes.set(id, im);
      this.variantGeos.push(geo);
      this.variantCounts.set(id, 0);
    }

    // 1. Contact Shadows (soft AO blob under tires y = 0.042m)
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const shadowTex = createSoftGlowBlobTexture('rgba(8,12,20,0.62)', 'rgba(8,12,20,0)');
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.contactShadows = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_EFFECT_VEHICLES);
    this.contactShadows.count = 0;
    this.contactShadows.frustumCulled = false;
    this.contactShadows.renderOrder = 2;
    this.root.add(this.contactShadows);

    // 2. Brake / Reverse Lights
    const brakeGeo = new THREE.BoxGeometry(1, 1, 1);
    const brakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.brakeReverseLights = new THREE.InstancedMesh(brakeGeo, brakeMat, MAX_EFFECT_VEHICLES * 2);
    this.brakeReverseLights.count = 0;
    this.brakeReverseLights.frustumCulled = false;
    _color.setHex(0xffffff);
    for (let i = 0; i < MAX_EFFECT_VEHICLES * 2; i++) {
      this.brakeReverseLights.setColorAt(i, _color);
    }
    if (this.brakeReverseLights.instanceColor) this.brakeReverseLights.instanceColor.needsUpdate = true;
    this.root.add(this.brakeReverseLights);

    // 3. Blinkers (front + rear amber spheres at -Z / +Z, plus 4-corner hazard flash)
    const blinkerGeo = new THREE.SphereGeometry(0.085, 8, 6);
    const blinkerMat = new THREE.MeshBasicMaterial({ color: 0xffb703, toneMapped: false });
    this.blinkers = new THREE.InstancedMesh(blinkerGeo, blinkerMat, MAX_EFFECT_VEHICLES * 4);
    this.blinkers.count = 0;
    this.blinkers.frustumCulled = false;
    this.root.add(this.blinkers);

    // 4. Headlight Cones (warm translucent ground cones when headlightsOn)
    const coneGeo = new THREE.PlaneGeometry(1, 1);
    coneGeo.rotateX(-Math.PI * 0.5);
    coneGeo.translate(0.5, 0, 0); // pivot at vehicle nose (+X)
    const coneTex = createHeadlightConeTexture();
    const coneMat = new THREE.MeshBasicMaterial({
      map: coneTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.headlightCones = new THREE.InstancedMesh(coneGeo, coneMat, MAX_EFFECT_VEHICLES);
    this.headlightCones.count = 0;
    this.headlightCones.frustumCulled = false;
    this.headlightCones.renderOrder = 3;
    this.root.add(this.headlightCones);

    // 5. Archetype Rings (under-chassis archetype glow capsule + selected vehicle cyan reticle)
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI * 0.5);
    const ringTex = createArchetypeRingTexture();
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTex,
      transparent: true,
      depthWrite: false,
    });
    this.archetypeRings = new THREE.InstancedMesh(ringGeo, ringMat, MAX_EFFECT_VEHICLES + 4);
    this.archetypeRings.count = 0;
    this.archetypeRings.frustumCulled = false;
    this.archetypeRings.renderOrder = 4;
    _color.setHex(0xffffff);
    for (let i = 0; i < MAX_EFFECT_VEHICLES + 4; i++) {
      this.archetypeRings.setColorAt(i, _color);
    }
    if (this.archetypeRings.instanceColor) this.archetypeRings.instanceColor.needsUpdate = true;
    this.root.add(this.archetypeRings);

    this.effectGeos.push(shadowGeo, brakeGeo, blinkerGeo, coneGeo, ringGeo);
    this.effectMats.push(shadowMat, brakeMat, blinkerMat, coneMat, ringMat);
    this.effectTexs.push(shadowTex, coneTex, ringTex);
  }

  setEnvironmentId(environmentId?: string): void {
    this.atlas.updateBrtLivery(environmentId);
  }

  syncFrame(
    vehicles: readonly Vehicle[],
    simTime: number,
    headlightsOn: boolean,
    layers: MapOverlayLayers,
    focusedArchetype: DriverArchetype | null,
    selectedVehicleId: number | null
  ): void {
    for (let i = 0; i < ALL_VARIANTS.length; i++) {
      this.variantCounts.set(ALL_VARIANTS[i], 0);
    }

    let shadowIdx = 0;
    let brakeIdx = 0;
    let blinkerIdx = 0;
    let coneIdx = 0;
    let ringIdx = 0;

    const blinkOn = Math.floor(simTime * 3.2) % 2 === 0;
    const count = vehicles.length;

    for (let i = 0; i < count; i++) {
      const v = vehicles[i];
      const variant = resolveIndonesianVariant(v);
      const im = this.variantMeshes.get(variant);
      const vIdx = this.variantCounts.get(variant) ?? 0;

      const rotY = -v.heading;
      _euler.set(0, rotY, 0, 'YXZ');
      _quat.setFromEuler(_euler);

      const isDimmed = focusedArchetype !== null && (v.archetype ?? 'commuter') !== focusedArchetype;

      if (im && vIdx < im.instanceMatrix.count) {
        _pos.set(v.x, 0, v.y);
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        im.setMatrixAt(vIdx, _mat4);
        _color.setHex(isDimmed ? 0x525b68 : 0xffffff);
        im.setColorAt(vIdx, _color);
        this.variantCounts.set(variant, vIdx + 1);
      }

      // 1. Contact shadow
      if (shadowIdx < MAX_EFFECT_VEHICLES) {
        _pos.set(v.x, 0.042, v.y);
        _scale.set(v.length * 1.16, 1, v.width * 1.28);
        _mat4.compose(_pos, _quat, _scale);
        this.contactShadows.setMatrixAt(shadowIdx++, _mat4);
      }

      const cosH = Math.cos(v.heading);
      const sinH = Math.sin(v.heading);
      const halfL = v.length * 0.48;
      const halfW = v.width * 0.42;
      const lightY = v.vClass === 'motor' ? 0.66 : v.vClass === 'heavy' ? 0.94 : 0.74;

      // 2. Brake / Reverse lights
      const isIdleSlow = v.speed < 1.2 && !v.brakingHard && !v.isReversing;
      if ((v.brakingHard || v.isReversing || isIdleSlow) && brakeIdx + 1 < MAX_EFFECT_VEHICLES * 2) {
        const rearX = v.x - halfL * cosH;
        const rearZ = v.y - halfL * sinH;
        const barW = v.brakingHard ? (v.vClass === 'motor' ? 0.36 : 0.46) : v.vClass === 'motor' ? 0.2 : 0.3;
        const barH = v.brakingHard ? 0.16 : 0.1;
        _color.setHex(v.isReversing ? 0xf8fafc : v.brakingHard ? 0xff1e38 : 0x991b1b);

        if (v.vClass === 'motor') {
          _pos.set(rearX, lightY, rearZ);
          _scale.set(0.08, barH, barW);
          _mat4.compose(_pos, _quat, _scale);
          this.brakeReverseLights.setMatrixAt(brakeIdx, _mat4);
          this.brakeReverseLights.setColorAt(brakeIdx, _color);
          brakeIdx++;
        } else {
          const offZ = halfW * 0.72;
          // Left (-Z)
          _pos.set(rearX - offZ * sinH, lightY, rearZ + offZ * cosH);
          _scale.set(0.08, barH, barW);
          _mat4.compose(_pos, _quat, _scale);
          this.brakeReverseLights.setMatrixAt(brakeIdx, _mat4);
          this.brakeReverseLights.setColorAt(brakeIdx, _color);
          brakeIdx++;
          // Right (+Z)
          _pos.set(rearX + offZ * sinH, lightY, rearZ - offZ * cosH);
          _mat4.compose(_pos, _quat, _scale);
          this.brakeReverseLights.setMatrixAt(brakeIdx, _mat4);
          this.brakeReverseLights.setColorAt(brakeIdx, _color);
          brakeIdx++;
        }
      }

      // 3. Blinkers (left/right turn/lane change, or 4-corner hazard on reverse/yellowBox)
      if (blinkOn && blinkerIdx + 4 <= MAX_EFFECT_VEHICLES * 4) {
        const hazard = Boolean(v.isReversing || v.holdingYellowBox);
        const leftOn = hazard || v.turnSignal === 'left' || v.laneChangeDir === 'left';
        const rightOn = hazard || v.turnSignal === 'right' || v.laneChangeDir === 'right';
        if (leftOn || rightOn) {
          const bScale = v.vClass === 'heavy' ? 1.35 : v.vClass === 'motor' ? 0.75 : 1.0;
          _scale.set(bScale, bScale, bScale);
          const sideZ = v.vClass === 'motor' ? 0.22 : halfW * 0.88;
          const fx = v.x + halfL * cosH;
          const fz = v.y + halfL * sinH;
          const rx = v.x - halfL * cosH;
          const rz = v.y - halfL * sinH;

          // Local -Z in world = (+sinH, -cosH)
          if (leftOn) {
            _pos.set(fx + sideZ * sinH, lightY, fz - sideZ * cosH);
            _mat4.compose(_pos, _quat, _scale);
            this.blinkers.setMatrixAt(blinkerIdx++, _mat4);

            _pos.set(rx + sideZ * sinH, lightY, rz - sideZ * cosH);
            _mat4.compose(_pos, _quat, _scale);
            this.blinkers.setMatrixAt(blinkerIdx++, _mat4);
          }
          // Local +Z in world = (-sinH, +cosH)
          if (rightOn) {
            _pos.set(fx - sideZ * sinH, lightY, fz + sideZ * cosH);
            _mat4.compose(_pos, _quat, _scale);
            this.blinkers.setMatrixAt(blinkerIdx++, _mat4);

            _pos.set(rx - sideZ * sinH, lightY, rz + sideZ * cosH);
            _mat4.compose(_pos, _quat, _scale);
            this.blinkers.setMatrixAt(blinkerIdx++, _mat4);
          }
        }
      }

      // 4. Headlight cones
      if (headlightsOn && coneIdx < MAX_EFFECT_VEHICLES) {
        const noseX = v.x + halfL * cosH;
        const noseZ = v.y + halfL * sinH;
        const coneLen = v.vClass === 'heavy' ? 11.5 : v.vClass === 'car' ? 8.5 : 5.2;
        const coneWid = v.vClass === 'heavy' ? 5.2 : v.vClass === 'car' ? 4.2 : 2.6;
        _pos.set(noseX, 0.055, noseZ);
        _scale.set(coneLen, 1, coneWid);
        _mat4.compose(_pos, _quat, _scale);
        this.headlightCones.setMatrixAt(coneIdx++, _mat4);
      }

      // 5. Archetype rings + selected vehicle cyan reticle
      if (layers.identity && ringIdx < MAX_EFFECT_VEHICLES) {
        _pos.set(v.x, 0.048, v.y);
        _scale.set(v.length * 1.15, 1, v.width * 1.32);
        _mat4.compose(_pos, _quat, _scale);
        this.archetypeRings.setMatrixAt(ringIdx, _mat4);
        const archHex = ARCHETYPE_HEX[v.archetype ?? 'commuter'];
        _color.setHex(archHex);
        if (isDimmed) _color.multiplyScalar(0.32);
        this.archetypeRings.setColorAt(ringIdx, _color);
        ringIdx++;
      }

      if (selectedVehicleId !== null && v.id === selectedVehicleId && ringIdx < MAX_EFFECT_VEHICLES + 4) {
        const pulse = 1.0 + 0.06 * Math.sin(simTime * 6.0);
        _pos.set(v.x, 0.062, v.y);
        _scale.set(v.length * 1.28 * pulse, 1, v.width * 1.48 * pulse);
        _mat4.compose(_pos, _quat, _scale);
        this.archetypeRings.setMatrixAt(ringIdx, _mat4);
        _color.setHex(0x22d3ee);
        this.archetypeRings.setColorAt(ringIdx, _color);
        ringIdx++;
      }
    }

    // Commit variant InstancedMesh counts & GPU flags
    for (let i = 0; i < ALL_VARIANTS.length; i++) {
      const id = ALL_VARIANTS[i];
      const im = this.variantMeshes.get(id);
      if (!im) continue;
      const c = this.variantCounts.get(id) ?? 0;
      im.count = c;
      if (c > 0) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }

    // Commit 5 global effect InstancedMeshes
    this.contactShadows.count = shadowIdx;
    if (shadowIdx > 0) this.contactShadows.instanceMatrix.needsUpdate = true;

    this.brakeReverseLights.count = brakeIdx;
    if (brakeIdx > 0) {
      this.brakeReverseLights.instanceMatrix.needsUpdate = true;
      if (this.brakeReverseLights.instanceColor) this.brakeReverseLights.instanceColor.needsUpdate = true;
    }

    this.blinkers.count = blinkerIdx;
    if (blinkerIdx > 0) this.blinkers.instanceMatrix.needsUpdate = true;

    this.headlightCones.count = coneIdx;
    if (coneIdx > 0) this.headlightCones.instanceMatrix.needsUpdate = true;

    this.archetypeRings.count = ringIdx;
    if (ringIdx > 0) {
      this.archetypeRings.instanceMatrix.needsUpdate = true;
      if (this.archetypeRings.instanceColor) this.archetypeRings.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Zero-allocation world-space ray vs oriented bounding box (OBB) intersection.
   */
  pickVehicleByRay(
    ray: THREE.Ray,
    vehicles: readonly Vehicle[],
    focusedArchetype: DriverArchetype | null
  ): number | null {
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const dx = ray.direction.x;
    const dy = ray.direction.y;
    const dz = ray.direction.z;

    let bestId: number | null = null;
    let bestT = Infinity;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (focusedArchetype !== null && (v.archetype ?? 'commuter') !== focusedArchetype) {
        continue;
      }

      const h = v.vClass === 'heavy' ? 3.35 : v.vClass === 'motor' ? 1.45 : 1.75;
      const hx = v.length * 0.56;
      const hz = v.width * 0.62;

      const cosH = Math.cos(v.heading);
      const sinH = Math.sin(v.heading);

      // Transform ray origin & direction into vehicle local space
      const relX = ox - v.x;
      const relZ = oz - v.y;
      const lox = relX * cosH + relZ * sinH;
      const loz = -relX * sinH + relZ * cosH;

      const ldx = dx * cosH + dz * sinH;
      const ldz = -dx * sinH + dz * cosH;

      // Slab intersection against [-hx, hx] x [0, h] x [-hz, hz]
      let tmin = -Infinity;
      let tmax = Infinity;

      if (Math.abs(ldx) < 1e-8) {
        if (lox < -hx || lox > hx) continue;
      } else {
        const inv = 1 / ldx;
        let t1 = (-hx - lox) * inv;
        let t2 = (hx - lox) * inv;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      if (Math.abs(dy) < 1e-8) {
        if (oy < 0 || oy > h) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (0 - oy) * inv;
        let t2 = (h - oy) * inv;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      if (Math.abs(ldz) < 1e-8) {
        if (loz < -hz || loz > hz) continue;
      } else {
        const inv = 1 / ldz;
        let t1 = (-hz - loz) * inv;
        let t2 = (hz - loz) * inv;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      const tHit = tmin >= 0 ? tmin : tmax;
      if (tHit >= 0 && tHit < bestT) {
        bestT = tHit;
        bestId = v.id;
      }
    }

    return bestId;
  }

  getVehiclePosition(vehicleId: number, vehicles: readonly Vehicle[], out: THREE.Vector3): boolean {
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.id === vehicleId) {
        out.set(v.x, 0, v.y);
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const im of this.variantMeshes.values()) {
      im.dispose();
    }
    this.variantMeshes.clear();
    for (let i = 0; i < this.variantGeos.length; i++) {
      this.variantGeos[i].dispose();
    }
    this.variantGeos.length = 0;

    this.contactShadows.dispose();
    this.brakeReverseLights.dispose();
    this.blinkers.dispose();
    this.headlightCones.dispose();
    this.archetypeRings.dispose();

    for (let i = 0; i < this.effectGeos.length; i++) this.effectGeos[i].dispose();
    for (let i = 0; i < this.effectMats.length; i++) this.effectMats[i].dispose();
    for (let i = 0; i < this.effectTexs.length; i++) this.effectTexs[i].dispose();

    this.sharedMat.dispose();
    this.atlas.dispose();
  }
}
