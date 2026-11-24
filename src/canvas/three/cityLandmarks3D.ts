import * as THREE from 'three';
import { getEffectiveRoadWidth } from '../../engine/geometry';
import { CompiledTopology, LandmarkItem } from '../../engine/topologyTypes';
import { SimConfig } from '../../engine/types';

export interface CityLandmarks3DResult {
  group: THREE.Group;
  streetLampEmissives: THREE.MeshStandardMaterial[];
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

interface AssetPool {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  matCache: Map<string, THREE.MeshStandardMaterial>;
  unitBox: THREE.BoxGeometry;
  unitCyl: THREE.CylinderGeometry;
  foliageIco: THREE.IcosahedronGeometry;
  regGeo: <T extends THREE.BufferGeometry>(g: T) => T;
  regMat: <T extends THREE.Material>(m: T) => T;
  stdMat: (
    key: string,
    color: number,
    opts?: {
      roughness?: number;
      metalness?: number;
      flatShading?: boolean;
      transparent?: boolean;
      opacity?: number;
      emissive?: number;
      emissiveIntensity?: number;
      side?: THREE.Side;
    }
  ) => THREE.MeshStandardMaterial;
}

type LandmarkBuilderFn = (
  pool: AssetPool,
  w: number,
  d: number,
  seed: number
) => THREE.Group;

function createAssetPool(): AssetPool {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const matCache = new Map<string, THREE.MeshStandardMaterial>();

  const regGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.add(g);
    return g;
  };
  const regMat = <T extends THREE.Material>(m: T): T => {
    materials.add(m);
    return m;
  };

  const unitBox = regGeo(new THREE.BoxGeometry(1, 1, 1));
  const unitCyl = regGeo(new THREE.CylinderGeometry(1, 1, 1, 14));
  const foliageIco = regGeo(new THREE.IcosahedronGeometry(1, 1));

  const stdMat: AssetPool['stdMat'] = (key, color, opts = {}) => {
    const existing = matCache.get(key);
    if (existing) return existing;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.78,
      metalness: opts.metalness ?? 0.06,
      flatShading: opts.flatShading ?? false,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      side: opts.side ?? THREE.FrontSide,
    });
    matCache.set(key, mat);
    regMat(mat);
    return mat;
  };

  return {
    geometries,
    materials,
    matCache,
    unitBox,
    unitCyl,
    foliageIco,
    regGeo,
    regMat,
    stdMat,
  };
}

function addBoxBottom(
  parent: THREE.Object3D,
  pool: AssetPool,
  w: number,
  h: number,
  d: number,
  x: number,
  yBottom: number,
  z: number,
  material: THREE.Material,
  castShadow = true,
  receiveShadow = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(pool.unitBox, material);
  mesh.scale.set(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
  mesh.position.set(x, yBottom + h * 0.5, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function addCylBottom(
  parent: THREE.Object3D,
  pool: AssetPool,
  rTop: number,
  rBot: number,
  h: number,
  radialSegments: number,
  x: number,
  yBottom: number,
  z: number,
  material: THREE.Material,
  castShadow = true,
  receiveShadow = true
): THREE.Mesh {
  const geo =
    Math.abs(rTop - rBot) < 1e-4 && radialSegments === 14
      ? pool.unitCyl
      : pool.regGeo(new THREE.CylinderGeometry(rTop, rBot, 1, radialSegments));
  const mesh = new THREE.Mesh(geo, material);
  if (geo === pool.unitCyl) {
    mesh.scale.set(rBot, Math.max(0.02, h), rBot);
  } else {
    mesh.scale.set(1, Math.max(0.02, h), 1);
  }
  mesh.position.set(x, yBottom + h * 0.5, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function addConeBottom(
  parent: THREE.Object3D,
  pool: AssetPool,
  radius: number,
  h: number,
  radialSegments: number,
  x: number,
  yBottom: number,
  z: number,
  material: THREE.Material,
  castShadow = true,
  receiveShadow = true
): THREE.Mesh {
  const geo = pool.regGeo(new THREE.ConeGeometry(radius, h, radialSegments));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, yBottom + h * 0.5, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

/**
 * Creates a crisp flat-shaded Javanese Limasan / Indonesian hipped roof geometry
 * whose ridge automatically aligns along the longer horizontal dimension.
 */
function createHippedRoofGeo(
  pool: AssetPool,
  w: number,
  d: number,
  h: number,
  ridgeRatio = 0.48
): THREE.BufferGeometry {
  const hw = w * 0.5;
  const hd = d * 0.5;
  const positions: number[] = [];

  const pushTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  if (w >= d) {
    const rh = Math.max(0.05, Math.min(hw - 0.1, hw * ridgeRatio));
    // Front (+Z), Right (+X), Back (-Z), Left (-X)
    pushTri(-hw, 0, hd, hw, 0, hd, rh, h, 0);
    pushTri(-hw, 0, hd, rh, h, 0, -rh, h, 0);
    pushTri(hw, 0, hd, hw, 0, -hd, rh, h, 0);
    pushTri(hw, 0, -hd, -hw, 0, -hd, -rh, h, 0);
    pushTri(hw, 0, -hd, -rh, h, 0, rh, h, 0);
    pushTri(-hw, 0, -hd, -hw, 0, hd, -rh, h, 0);
  } else {
    const rh = Math.max(0.05, Math.min(hd - 0.1, hd * ridgeRatio));
    pushTri(hw, 0, -hd, hw, 0, hd, 0, h, rh);
    pushTri(hw, 0, -hd, 0, h, rh, 0, h, -rh);
    pushTri(hw, 0, hd, -hw, 0, hd, 0, h, rh);
    pushTri(-hw, 0, hd, -hw, 0, -hd, 0, h, -rh);
    pushTri(-hw, 0, hd, 0, h, -rh, 0, h, rh);
    pushTri(-hw, 0, -hd, hw, 0, -hd, 0, h, -rh);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return pool.regGeo(geo);
}

function addHippedRoof(
  parent: THREE.Object3D,
  pool: AssetPool,
  w: number,
  d: number,
  h: number,
  ridgeRatio: number,
  x: number,
  yBottom: number,
  z: number,
  material: THREE.Material
): THREE.Mesh {
  const geo = createHippedRoofGeo(pool, w, d, h, ridgeRatio);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, yBottom, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addTorenAir(
  parent: THREE.Object3D,
  pool: AssetPool,
  x: number,
  yBottom: number,
  z: number,
  scale = 1
): void {
  const standMat = pool.stdMat('toren-stand', 0x64748b, { roughness: 0.7 });
  const tankMat = pool.stdMat('toren-blue', 0x0284c7, { roughness: 0.35, metalness: 0.15 });
  const capMat = pool.stdMat('toren-cap', 0x38bdf8, { roughness: 0.3 });
  addBoxBottom(parent, pool, 1.0 * scale, 0.35 * scale, 1.0 * scale, x, yBottom, z, standMat);
  addCylBottom(
    parent,
    pool,
    0.55 * scale,
    0.55 * scale,
    1.15 * scale,
    12,
    x,
    yBottom + 0.35 * scale,
    z,
    tankMat
  );
  addCylBottom(
    parent,
    pool,
    0.35 * scale,
    0.55 * scale,
    0.22 * scale,
    12,
    x,
    yBottom + 1.5 * scale,
    z,
    capMat
  );
}

function addParkedMicroCar(
  parent: THREE.Object3D,
  pool: AssetPool,
  x: number,
  yBottom: number,
  z: number,
  rotY: number,
  colorHex: number,
  keySuffix: string
): void {
  const g = new THREE.Group();
  g.position.set(x, yBottom, z);
  g.rotation.y = rotY;
  const bodyMat = pool.stdMat(`micro-car-${keySuffix}`, colorHex, { roughness: 0.4, metalness: 0.25 });
  const glassMat = pool.stdMat('micro-car-glass', 0x1e293b, { roughness: 0.2, metalness: 0.4 });
  const wheelMat = pool.stdMat('micro-car-tire', 0x0f172a, { roughness: 0.9 });

  addBoxBottom(g, pool, 1.65, 0.58, 3.6, 0, 0.12, 0, bodyMat);
  addBoxBottom(g, pool, 1.42, 0.46, 1.9, 0, 0.7, -0.1, glassMat);
  for (const wx of [-0.76, 0.76]) {
    for (const wz of [-1.05, 1.05]) {
      addBoxBottom(g, pool, 0.2, 0.32, 0.45, wx, 0, wz, wheelMat, false, true);
    }
  }
  parent.add(g);
}

// =============================================================================
// 19+ Indonesian Architectural Low-Poly Landmark Builders
// =============================================================================

function buildMasjidJami(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const minDim = Math.min(w, d);
  const marbleLight = pool.stdMat('masjid-marble-1', 0xf1f5f9, { roughness: 0.55 });
  const marbleDeck = pool.stdMat('masjid-marble-2', 0xe2e8f0, { roughness: 0.6 });
  const wallWhite = pool.stdMat('masjid-wall', 0xf8fafc, { roughness: 0.72 });
  const emerald = pool.stdMat('masjid-emerald', 0x059669, { roughness: 0.34, metalness: 0.18 });
  const tealDark = pool.stdMat('masjid-teal-dark', 0x065f46, { roughness: 0.45, metalness: 0.15 });
  const archGlass = pool.stdMat('masjid-arch-glass', 0x115e59, { roughness: 0.22, metalness: 0.35 });
  const goldMat = pool.stdMat('masjid-gold', 0xfbbf24, { roughness: 0.25, metalness: 0.75 });

  // Plaza apron (pelataran)
  addBoxBottom(g, pool, w * 0.96, 0.18, d * 0.96, 0, 0, 0, marbleLight, false, true);
  addBoxBottom(g, pool, w * 0.88, 0.08, d * 0.88, 0, 0.18, 0, marbleDeck, false, true);

  // Main prayer hall
  const hallW = w * 0.66;
  const hallD = d * 0.66;
  const hallH = Math.max(4.8, Math.min(6.8, minDim * 0.32));
  addBoxBottom(g, pool, hallW, hallH, hallD, 0, 0.26, 0, wallWhite);
  addBoxBottom(g, pool, hallW + 0.5, 0.45, hallD + 0.5, 0, 0.26 + hallH, 0, emerald);
  // Decorative perimeter arched window bands
  addBoxBottom(g, pool, hallW + 0.12, hallH * 0.46, hallD * 0.72, 0, 0.26 + hallH * 0.26, 0, archGlass, false, true);
  addBoxBottom(g, pool, hallW * 0.72, hallH * 0.46, hallD + 0.12, 0, 0.26 + hallH * 0.26, 0, archGlass, false, true);

  // Front entrance portico
  addBoxBottom(g, pool, hallW * 0.36, hallH * 0.65, d * 0.12, 0, 0.26, hallD * 0.5 + d * 0.05, wallWhite);
  addBoxBottom(g, pool, hallW * 0.4, 0.32, d * 0.14, 0, 0.26 + hallH * 0.65, hallD * 0.5 + d * 0.05, emerald);

  // Central drum & emerald dome (SphereGeometry hemisphere + finial spire)
  const domeBaseY = 0.26 + hallH + 0.45;
  const domeR = Math.max(2.6, minDim * 0.21);
  addCylBottom(g, pool, domeR * 1.05, domeR * 1.1, 1.1, 12, 0, domeBaseY, 0, wallWhite);
  addCylBottom(g, pool, domeR * 1.08, domeR * 1.08, 0.24, 16, 0, domeBaseY + 1.1, 0, goldMat, false, true);

  const domeGeo = pool.regGeo(new THREE.SphereGeometry(domeR, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5));
  const domeMesh = new THREE.Mesh(domeGeo, emerald);
  domeMesh.position.set(0, domeBaseY + 1.25, 0);
  domeMesh.castShadow = true;
  domeMesh.receiveShadow = true;
  g.add(domeMesh);

  // Finial spire atop main dome
  const spireBase = domeBaseY + 1.25 + domeR * 0.96;
  addCylBottom(g, pool, 0.12, 0.18, 1.5, 8, 0, spireBase, 0, goldMat);
  const orbGeo = pool.regGeo(new THREE.SphereGeometry(0.32, 10, 8));
  const orb = new THREE.Mesh(orbGeo, goldMat);
  orb.position.set(0, spireBase + 1.55, 0);
  g.add(orb);

  // 4 corner roof mini-domes
  const cornerR = Math.max(0.75, domeR * 0.26);
  const miniDomeGeo = pool.regGeo(new THREE.SphereGeometry(cornerR, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5));
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const cx = sx * (hallW * 0.42);
      const cz = sz * (hallD * 0.42);
      addCylBottom(g, pool, cornerR * 1.05, cornerR * 1.05, 0.65, 10, cx, domeBaseY, cz, wallWhite);
      const md = new THREE.Mesh(miniDomeGeo, tealDark);
      md.position.set(cx, domeBaseY + 0.65, cz);
      md.castShadow = true;
      g.add(md);
    }
  }

  // Tall signature Minaret Tower at front-right corner
  const mx = w * 0.39;
  const mz = d * 0.37;
  const minW = Math.max(1.6, minDim * 0.1);
  const shaftH = Math.max(11.5, minDim * 0.62);
  addBoxBottom(g, pool, minW * 1.35, 1.8, minW * 1.35, mx, 0.26, mz, wallWhite);
  addCylBottom(g, pool, minW * 0.48, minW * 0.58, shaftH, 8, mx, 2.06, mz, wallWhite);
  // Balcony collar & upper lantern
  const balcY = 2.06 + shaftH * 0.74;
  addCylBottom(g, pool, minW * 0.78, minW * 0.66, 0.48, 8, mx, balcY, mz, emerald);
  const topY = 2.06 + shaftH;
  addCylBottom(g, pool, minW * 0.76, minW * 0.76, 0.45, 8, mx, topY, mz, tealDark);
  addCylBottom(g, pool, minW * 0.42, minW * 0.42, 1.4, 8, mx, topY + 0.45, mz, archGlass);
  const minDomeGeo = pool.regGeo(new THREE.SphereGeometry(minW * 0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5));
  const minDome = new THREE.Mesh(minDomeGeo, emerald);
  minDome.position.set(mx, topY + 1.85, mz);
  minDome.castShadow = true;
  g.add(minDome);
  addConeBottom(g, pool, 0.14, 1.3, 8, mx, topY + 1.85 + minW * 0.48, mz, goldMat);

  return g;
}

function buildTerminalGiwangan(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const concreteApron = pool.stdMat('term-apron', 0xe2e8f0, { roughness: 0.75 });
  const yardAsphalt = pool.stdMat('term-asphalt', 0x475569, { roughness: 0.88 });
  const slateWall = pool.stdMat('term-slate', 0x1e293b, { roughness: 0.65 });
  const tealTrim = pool.stdMat('term-teal', 0x0f766e, { roughness: 0.45, metalness: 0.2 });
  const archSlate = pool.stdMat('term-arch-slate', 0x334155, { roughness: 0.42, metalness: 0.3 });
  const pillarMat = pool.stdMat('term-pillar', 0xcbd5e1, { roughness: 0.55, metalness: 0.2 });
  const glassMat = pool.stdMat('term-glass', 0x38bdf8, { roughness: 0.2, metalness: 0.45 });
  const stripeAmber = pool.stdMat('term-amber', 0xfbbf24, { roughness: 0.7 });
  const busWhite = pool.stdMat('term-bus-white', 0xf8fafc, { roughness: 0.45 });
  const busSky = pool.stdMat('term-bus-sky', 0x0284c7, { roughness: 0.4 });
  const busAmber = pool.stdMat('term-bus-amber', 0xd97706, { roughness: 0.45 });

  // Outer concrete apron + asphalt bus yard
  addBoxBottom(g, pool, w * 0.98, 0.14, d * 0.98, 0, 0, 0, concreteApron, false, true);
  addBoxBottom(g, pool, w * 0.9, 0.05, d * 0.56, 0, 0.14, d * 0.18, yardAsphalt, false, true);

  // Main terminal concourse hall on -Z half
  const hallW = w * 0.84;
  const hallD = d * 0.34;
  const hallZ = -d * 0.24;
  const hallH = 4.6;
  addBoxBottom(g, pool, hallW, hallH, hallD, 0, 0.14, hallZ, slateWall);
  addBoxBottom(g, pool, hallW * 0.94, hallH * 0.52, hallD + 0.14, 0, 1.1, hallZ, glassMat, false, true);
  addBoxBottom(g, pool, hallW + 0.8, 0.45, hallD + 0.8, 0, 0.14 + hallH, hallZ, tealTrim);

  // Multi-bay arched transit terminal roof (#1E293B / #0F766E)
  const bayCount = 4;
  const bayW = (hallW * 0.96) / bayCount;
  const archR = bayW * 0.46;
  const archGeo = pool.regGeo(
    new THREE.CylinderGeometry(archR, archR, hallD + 2.4, 12, 1, false, 0, Math.PI)
  );
  for (let i = 0; i < bayCount; i++) {
    const bx = -hallW * 0.48 + (i + 0.5) * bayW;
    const arch = new THREE.Mesh(archGeo, i % 2 === 0 ? tealTrim : archSlate);
    arch.rotation.z = Math.PI * 0.5;
    arch.rotation.y = Math.PI * 0.5;
    arch.scale.set(1, 1, 0.55);
    arch.position.set(bx, 0.14 + hallH + 0.42, hallZ + 0.3);
    arch.castShadow = true;
    arch.receiveShadow = true;
    g.add(arch);
  }

  // Forward concrete passenger platform canopy (+Z edge of concourse)
  const canopyZ = hallZ + hallD * 0.5 + d * 0.1;
  const canopyD = d * 0.18;
  addBoxBottom(g, pool, hallW * 0.94, 0.26, canopyD, 0, 0.14, canopyZ, concreteApron, false, true);
  for (let i = 0; i <= 4; i++) {
    const px = -hallW * 0.44 + (i / 4) * (hallW * 0.88);
    addCylBottom(g, pool, 0.18, 0.22, 3.6, 8, px, 0.4, canopyZ + canopyD * 0.32, pillarMat);
  }
  addBoxBottom(g, pool, hallW * 0.96, 0.35, canopyD + 1.0, 0, 3.95, canopyZ, tealTrim);
  addBoxBottom(g, pool, hallW * 0.96, 0.16, 0.35, 0, 4.3, canopyZ + canopyD * 0.5 + 0.3, slateWall);

  // Bus bay diagonal/lane stripes & stylized AKAP buses
  const busCount = 4;
  const baySpan = w * 0.78;
  const busZ = d * 0.26;
  const busD = Math.min(8.2, d * 0.34);
  const busMats = [busWhite, busSky, busAmber, busWhite];
  for (let i = 0; i <= busCount; i++) {
    const lx = -baySpan * 0.5 + (i / busCount) * baySpan;
    addBoxBottom(g, pool, 0.2, 0.03, busD + 1.2, lx, 0.19, busZ, stripeAmber, false, true);
  }
  for (let i = 0; i < busCount; i++) {
    const bx = -baySpan * 0.5 + ((i + 0.5) / busCount) * baySpan;
    const bMat = busMats[i % busMats.length];
    addBoxBottom(g, pool, 2.35, 2.7, busD * 0.85, bx, 0.22, busZ, bMat);
    addBoxBottom(g, pool, 2.4, 0.95, busD * 0.72, bx, 1.5, busZ + 0.15, glassMat, false, true);
    addBoxBottom(g, pool, 1.8, 0.25, 1.4, bx, 2.92, busZ - 0.5, pillarMat, false, true);
  }

  return g;
}

function buildSpbuPertamina(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const concretePad = pool.stdMat('spbu-pad', 0xe2e8f0, { roughness: 0.75 });
  const laneAsphalt = pool.stdMat('spbu-lane', 0x475569, { roughness: 0.88 });
  const wallWhite = pool.stdMat('spbu-white', 0xf8fafc, { roughness: 0.65 });
  const pertaminaRed = pool.stdMat('spbu-red', 0xdc2626, { roughness: 0.42, metalness: 0.15 });
  const pertaminaBlue = pool.stdMat('spbu-blue', 0x1d4ed8, { roughness: 0.42, metalness: 0.15 });
  const glassMat = pool.stdMat('spbu-glass', 0x7dd3fc, { roughness: 0.2, metalness: 0.4 });
  const islandMat = pool.stdMat('spbu-island', 0x94a3b8, { roughness: 0.7 });
  const pumpDark = pool.stdMat('spbu-pump', 0x1e293b, { roughness: 0.5 });

  // Concrete forecourt + drive-through asphalt strip
  addBoxBottom(g, pool, w * 0.96, 0.15, d * 0.96, 0, 0, 0, concretePad, false, true);
  addBoxBottom(g, pool, w * 0.86, 0.04, d * 0.48, 0, 0.15, d * 0.16, laneAsphalt, false, true);

  // Back convenience kiosk / office
  const kioskW = w * 0.78;
  const kioskD = d * 0.24;
  const kioskZ = -d * 0.3;
  addBoxBottom(g, pool, kioskW, 3.4, kioskD, 0, 0.15, kioskZ, wallWhite);
  addBoxBottom(g, pool, kioskW * 0.78, 1.8, 0.14, 0, 0.65, kioskZ + kioskD * 0.5, glassMat, false, true);
  addBoxBottom(g, pool, kioskW + 0.4, 0.55, kioskD + 0.4, 0, 3.55, kioskZ, pertaminaBlue);
  addBoxBottom(g, pool, kioskW + 0.45, 0.25, kioskD + 0.45, 0, 4.1, kioskZ, pertaminaRed);

  // Main Pertamina Fuel Canopy (+Z area)
  const canW = w * 0.78;
  const canD = d * 0.44;
  const canZ = d * 0.16;
  const canH = 4.9;
  const pillarOffsetsX = [-canW * 0.34, 0, canW * 0.34];
  for (const px of pillarOffsetsX) {
    addBoxBottom(g, pool, 0.42, canH, 0.42, px, 0.15, canZ, wallWhite);
    // Concrete pump island around pillar
    addBoxBottom(g, pool, 3.4, 0.22, 1.35, px, 0.15, canZ, islandMat, false, true);
    // Twin fuel dispenser pumps per island
    for (const side of [-1, 1] as const) {
      addBoxBottom(g, pool, 0.78, 1.55, 0.56, px + side * 0.95, 0.37, canZ, pertaminaRed);
      addBoxBottom(g, pool, 0.72, 0.45, 0.58, px + side * 0.95, 1.25, canZ, pumpDark, false, true);
    }
  }

  // Canopy roof deck + iconic red-white-blue fascia bands
  addBoxBottom(g, pool, canW, 0.38, canD, 0, 0.15 + canH, canZ, wallWhite);
  addBoxBottom(g, pool, canW + 0.24, 0.52, 0.28, 0, 0.15 + canH - 0.05, canZ + canD * 0.5, pertaminaRed);
  addBoxBottom(g, pool, canW + 0.24, 0.52, 0.28, 0, 0.15 + canH - 0.05, canZ - canD * 0.5, pertaminaBlue);
  addBoxBottom(g, pool, 0.26, 0.52, canD + 0.2, canW * 0.5, 0.15 + canH - 0.05, canZ, pertaminaRed);
  addBoxBottom(g, pool, 0.26, 0.52, canD + 0.2, -canW * 0.5, 0.15 + canH - 0.05, canZ, pertaminaBlue);
  // Roof stripe accent
  addBoxBottom(g, pool, canW * 0.9, 0.08, canD * 0.22, 0, 0.15 + canH + 0.38, canZ + canD * 0.26, pertaminaRed, false, true);
  addBoxBottom(g, pool, canW * 0.9, 0.08, canD * 0.22, 0, 0.15 + canH + 0.38, canZ - canD * 0.26, pertaminaBlue, false, true);

  // Pertamina Totem Sign at corner
  addBoxBottom(g, pool, 0.75, 5.4, 0.32, w * 0.42, 0.15, d * 0.36, wallWhite);
  addBoxBottom(g, pool, 0.82, 1.1, 0.36, w * 0.42, 4.4, d * 0.36, pertaminaRed);
  addBoxBottom(g, pool, 0.82, 0.8, 0.36, w * 0.42, 3.6, d * 0.36, pertaminaBlue);

  return g;
}

function buildMakoBrimob(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const yardMat = pool.stdMat('mako-yard', 0xcbd5e1, { roughness: 0.78 });
  const paradeMat = pool.stdMat('mako-parade', 0x94a3b8, { roughness: 0.85 });
  const khakiWall = pool.stdMat('mako-khaki', 0xd6d3c4, { roughness: 0.8 });
  const slateTrim = pool.stdMat('mako-slate', 0x334155, { roughness: 0.65 });
  const roofCrimson = pool.stdMat('mako-roof', 0x991b1b, { roughness: 0.72, flatShading: true });
  const roofCap = pool.stdMat('mako-roof-top', 0xb91c1c, { roughness: 0.68, flatShading: true });
  const glassDark = pool.stdMat('mako-glass', 0x1e293b, { roughness: 0.25, metalness: 0.35 });
  const poleMetal = pool.stdMat('mako-pole', 0xe2e8f0, { roughness: 0.3, metalness: 0.75 });
  const flagRed = pool.stdMat('mako-flag-red', 0xdc2626, { roughness: 0.6, side: THREE.DoubleSide });
  const flagWhite = pool.stdMat('mako-flag-white', 0xf8fafc, { roughness: 0.6, side: THREE.DoubleSide });

  // Compound slab & Parade ground (Lapangan Apel)
  addBoxBottom(g, pool, w * 0.96, 0.18, d * 0.96, 0, 0, 0, yardMat, false, true);
  addBoxBottom(g, pool, w * 0.78, 0.05, d * 0.4, 0, 0.18, d * 0.21, paradeMat, false, true);

  // Main HQ building (-Z half)
  const bW = w * 0.82;
  const bD = d * 0.36;
  const bZ = -d * 0.22;
  const bH = 5.4;
  addBoxBottom(g, pool, bW, 0.75, bD, 0, 0.18, bZ, slateTrim);
  addBoxBottom(g, pool, bW * 0.98, bH - 0.75, bD * 0.96, 0, 0.93, bZ, khakiWall);
  // 2 rows of dark institutional windows
  addBoxBottom(g, pool, bW * 0.86, 1.15, bD * 0.98, 0, 1.5, bZ, glassDark, false, true);
  addBoxBottom(g, pool, bW * 0.86, 1.15, bD * 0.98, 0, 3.6, bZ, glassDark, false, true);

  // Javanese Limasan/Joglo two-tier pitched roof
  const roofY = 0.18 + bH;
  addHippedRoof(g, pool, bW + 1.4, bD + 1.4, 2.0, 0.56, 0, roofY, bZ, roofCrimson);
  addHippedRoof(g, pool, bW * 0.52, bD * 0.62, 1.8, 0.2, 0, roofY + 1.2, bZ, roofCap);

  // Front Portico Entrance
  const portW = Math.min(6.4, bW * 0.3);
  const portD = Math.min(3.4, d * 0.16);
  const portZ = bZ + bD * 0.5 + portD * 0.45;
  addBoxBottom(g, pool, portW, 0.22, portD, 0, 0.18, portZ, slateTrim, false, true);
  for (const sx of [-1, 1] as const) {
    addBoxBottom(g, pool, 0.42, 3.3, 0.42, sx * (portW * 0.4), 0.4, portZ + portD * 0.34, slateTrim);
  }
  addBoxBottom(g, pool, portW + 0.6, 0.4, portD + 0.4, 0, 3.7, portZ, slateTrim);
  addHippedRoof(g, pool, portW + 0.6, portD + 0.4, 1.1, 0.35, 0, 4.1, portZ, roofCrimson);

  // Flagpole + Merah-Putih flag in parade ground
  const fx = 0;
  const fz = d * 0.08;
  addCylBottom(g, pool, 1.1, 1.25, 0.32, 14, fx, 0.18, fz, khakiWall, false, true);
  addCylBottom(g, pool, 0.08, 0.13, 10.6, 8, fx, 0.5, fz, poleMetal);
  addBoxBottom(g, pool, 2.1, 0.68, 0.06, fx + 1.08, 10.2, fz, flagRed);
  addBoxBottom(g, pool, 2.1, 0.68, 0.06, fx + 1.08, 9.52, fz, flagWhite);

  // Guard Post (Pos Jaga) at front corner
  addBoxBottom(g, pool, 3.2, 2.6, 2.8, w * 0.36, 0.18, d * 0.34, slateTrim);
  addHippedRoof(g, pool, 3.8, 3.4, 1.2, 0.25, w * 0.36, 2.78, d * 0.34, roofCrimson);

  return g;
}

function buildHelipadHospital(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const minDim = Math.min(w, d);
  const apronMat = pool.stdMat('hosp-apron', 0xe2e8f0, { roughness: 0.72 });
  const wallWhite = pool.stdMat('hosp-white', 0xf8fafc, { roughness: 0.68 });
  const skyGlass = pool.stdMat('hosp-sky-glass', 0x38bdf8, { roughness: 0.2, metalness: 0.45 });
  const slateTrim = pool.stdMat('hosp-slate', 0x64748b, { roughness: 0.55 });
  const padSlate = pool.stdMat('hosp-pad', 0x475569, { roughness: 0.78 });
  const redCross = pool.stdMat('hosp-red', 0xef4444, { roughness: 0.45 });
  const yellowRing = pool.stdMat('hosp-yellow', 0xfbbf24, { roughness: 0.5 });

  // Courtyard apron
  addBoxBottom(g, pool, w * 0.95, 0.16, d * 0.95, 0, 0, 0, apronMat, false, true);

  // Lower clinical podium + UGD ambulance entrance canopy
  const podW = w * 0.84;
  const podD = d * 0.82;
  addBoxBottom(g, pool, podW, 3.4, podD, 0, 0.16, 0, wallWhite);
  addBoxBottom(g, pool, podW * 0.92, 1.4, podD + 0.12, 0, 1.1, 0, skyGlass, false, true);
  // UGD ambulance bay canopy on +Z face
  addBoxBottom(g, pool, podW * 0.42, 0.36, d * 0.14, 0, 2.8, podD * 0.5 + d * 0.05, slateTrim);
  addBoxBottom(g, pool, 1.1, 0.34, 0.14, 0, 3.16, podD * 0.5 + d * 0.11, redCross, false, false);
  addBoxBottom(g, pool, 0.34, 1.1, 0.14, 0, 2.78, podD * 0.5 + d * 0.11, redCross, false, false);

  // Upper multi-story white & sky-glass hospital tower
  const towW = w * 0.68;
  const towD = d * 0.66;
  const stories = 3;
  const storyH = 2.9;
  const towBaseY = 3.56;
  const towTotalH = stories * storyH;
  addBoxBottom(g, pool, towW, towTotalH, towD, 0, towBaseY, -d * 0.04, wallWhite);

  for (let s = 0; s < stories; s++) {
    const wy = towBaseY + s * storyH + 0.75;
    addBoxBottom(g, pool, towW + 0.14, 1.35, towD * 0.84, 0, wy, -d * 0.04, skyGlass, false, true);
    addBoxBottom(g, pool, towW * 0.84, 1.35, towD + 0.14, 0, wy, -d * 0.04, skyGlass, false, true);
  }

  // Parapet crown & Rooftop Helipad Circle
  const roofY = towBaseY + towTotalH;
  addBoxBottom(g, pool, towW + 0.4, 0.45, towD + 0.4, 0, roofY, -d * 0.04, slateTrim);
  const padR = Math.max(3.2, Math.min(towW, towD) * 0.38);
  const padZ = -d * 0.04;
  addCylBottom(g, pool, padR, padR * 1.05, 0.32, 24, 0, roofY + 0.45, padZ, padSlate, false, true);

  // White outer safety ring + amber dashed ring accent
  const ringGeo = pool.regGeo(new THREE.RingGeometry(padR * 0.84, padR * 0.94, 28));
  const ringMesh = new THREE.Mesh(ringGeo, wallWhite);
  ringMesh.rotation.x = -Math.PI * 0.5;
  ringMesh.position.set(0, roofY + 0.78, padZ);
  ringMesh.receiveShadow = true;
  g.add(ringMesh);

  const innerRingGeo = pool.regGeo(new THREE.RingGeometry(padR * 0.68, padR * 0.74, 24));
  const innerRing = new THREE.Mesh(innerRingGeo, yellowRing);
  innerRing.rotation.x = -Math.PI * 0.5;
  innerRing.position.set(0, roofY + 0.785, padZ);
  g.add(innerRing);

  // Crisp rooftop 'H' bars
  const hSpan = padR * 0.76;
  const barW = Math.max(0.45, minDim * 0.032);
  addBoxBottom(g, pool, barW, 0.05, hSpan, -hSpan * 0.42, roofY + 0.77, padZ, wallWhite, false, false);
  addBoxBottom(g, pool, barW, 0.05, hSpan, hSpan * 0.42, roofY + 0.77, padZ, wallWhite, false, false);
  addBoxBottom(g, pool, hSpan * 0.84, 0.05, barW, 0, roofY + 0.77, padZ, wallWhite, false, false);

  // Rooftop Red-Cross medical beacon pad beside helipad
  const crossZ = padZ + padR + 1.4;
  if (crossZ + 1.2 < towD * 0.5) {
    addBoxBottom(g, pool, 2.2, 0.25, 2.2, 0, roofY + 0.45, crossZ, wallWhite, false, true);
    addBoxBottom(g, pool, 1.5, 0.06, 0.45, 0, roofY + 0.7, crossZ, redCross, false, false);
    addBoxBottom(g, pool, 0.45, 0.06, 1.5, 0, roofY + 0.7, crossZ, redCross, false, false);
  } else {
    // Place bold red-cross rooftop pavilion on the front podium terrace
    addBoxBottom(g, pool, 2.8, 0.6, 2.2, -towW * 0.36, 3.56, podD * 0.38, wallWhite);
    addBoxBottom(g, pool, 1.6, 0.08, 0.48, -towW * 0.36, 4.16, podD * 0.38, redCross, false, false);
    addBoxBottom(g, pool, 0.48, 0.08, 1.6, -towW * 0.36, 4.16, podD * 0.38, redCross, false, false);
  }

  return g;
}

function buildKampusWilis(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const lawnMat = pool.stdMat('kampus-lawn', 0x86efac, { roughness: 0.9 });
  const paveMat = pool.stdMat('kampus-pave', 0xe2e8f0, { roughness: 0.75 });
  const wallCream = pool.stdMat('kampus-wall', 0xfef3c7, { roughness: 0.78 });
  const colWhite = pool.stdMat('kampus-col', 0xf8fafc, { roughness: 0.65 });
  const roofTerra = pool.stdMat('kampus-roof', 0xb45309, { roughness: 0.72, flatShading: true });
  const roofBright = pool.stdMat('kampus-roof-2', 0xd97706, { roughness: 0.7, flatShading: true });
  const glassDark = pool.stdMat('kampus-glass', 0x334155, { roughness: 0.25, metalness: 0.3 });

  // Campus grounds & inner quad lawn
  addBoxBottom(g, pool, w * 0.96, 0.16, d * 0.96, 0, 0, 0, paveMat, false, true);
  addBoxBottom(g, pool, w * 0.46, 0.05, d * 0.56, 0, 0.16, d * 0.12, lawnMat, false, true);

  // U-shaped campus halls: North Wing (-Z), West Wing (-X), East Wing (+X)
  const wingH = 5.4;
  const nW = w * 0.84;
  const nD = d * 0.24;
  const nZ = -d * 0.3;
  addBoxBottom(g, pool, nW, wingH, nD, 0, 0.16, nZ, wallCream);
  addBoxBottom(g, pool, nW * 0.86, 1.1, nD + 0.12, 0, 3.2, nZ, glassDark, false, true);
  addHippedRoof(g, pool, nW + 1.2, nD + 1.2, 2.2, 0.65, 0, 0.16 + wingH, nZ, roofTerra);

  const sideW = w * 0.2;
  const sideD = d * 0.58;
  const sideZ = d * 0.12;
  for (const sx of [-1, 1] as const) {
    const cx = sx * (w * 0.32);
    addBoxBottom(g, pool, sideW, wingH * 0.88, sideD, cx, 0.16, sideZ, wallCream);
    addBoxBottom(g, pool, sideW + 0.12, 1.0, sideD * 0.8, cx, 2.7, sideZ, glassDark, false, true);
    addHippedRoof(g, pool, sideW + 1.0, sideD + 1.0, 1.9, 0.6, cx, 0.16 + wingH * 0.88, sideZ, roofBright);
  }

  // Colonnade pillars lining the inner courtyard & front academic veranda
  const colCount = 6;
  for (let i = 0; i < colCount; i++) {
    const px = -nW * 0.36 + (i / (colCount - 1)) * (nW * 0.72);
    addCylBottom(g, pool, 0.2, 0.22, 3.1, 8, px, 0.16, nZ + nD * 0.5 + 0.75, colWhite);
  }
  addBoxBottom(g, pool, nW * 0.76, 0.28, 1.4, 0, 3.26, nZ + nD * 0.5 + 0.6, roofTerra);

  for (let i = 0; i < 4; i++) {
    const pz = sideZ - sideD * 0.34 + (i / 3) * (sideD * 0.68);
    addCylBottom(g, pool, 0.18, 0.2, 2.9, 8, -w * 0.32 + sideW * 0.5 + 0.65, 0.16, pz, colWhite);
    addCylBottom(g, pool, 0.18, 0.2, 2.9, 8, w * 0.32 - sideW * 0.5 - 0.65, 0.16, pz, colWhite);
  }

  // Central courtyard shade gazebo/tree planter
  addCylBottom(g, pool, 1.8, 2.0, 0.28, 14, 0, 0.21, d * 0.14, paveMat, false, true);
  const tree = buildShadeTree(pool, 0.75, 0);
  tree.position.set(0, 0.48, d * 0.14);
  g.add(tree);

  return g;
}

function buildPasarTradisional(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const concreteMat = pool.stdMat('pasar-concrete', 0xcbd5e1, { roughness: 0.82 });
  const wallStall = pool.stdMat('pasar-wall', 0xf1f5f9, { roughness: 0.78 });
  const roofBlueZinc = pool.stdMat('pasar-zinc-blue', 0x0284c7, { roughness: 0.52, metalness: 0.25, flatShading: true });
  const roofTerra = pool.stdMat('pasar-terra', 0xc2410c, { roughness: 0.68, flatShading: true });
  const roofSlateTeal = pool.stdMat('pasar-teal', 0x0f766e, { roughness: 0.6, flatShading: true });
  const stallAmber = pool.stdMat('pasar-stall-amber', 0xf59e0b, { roughness: 0.7 });
  const colMat = pool.stdMat('pasar-col', 0x475569, { roughness: 0.7 });

  addBoxBottom(g, pool, w * 0.96, 0.15, d * 0.96, 0, 0, 0, concreteMat, false, true);

  // Back main market hall (tiered slate-blue corrugated pitched roof + vent clerestory)
  const nhW = w * 0.86;
  const nhD = d * 0.32;
  const nhZ = -d * 0.28;
  addBoxBottom(g, pool, nhW, 3.6, nhD, 0, 0.15, nhZ, wallStall);
  addHippedRoof(g, pool, nhW + 1.0, nhD + 1.0, 1.9, 0.65, 0, 3.75, nhZ, roofBlueZinc);
  // Tiered vent monitor roof
  addBoxBottom(g, pool, nhW * 0.56, 0.75, nhD * 0.34, 0, 5.05, nhZ, colMat);
  addHippedRoof(g, pool, nhW * 0.62, nhD * 0.42, 0.9, 0.7, 0, 5.8, nhZ, roofTerra);

  // Front-left terracotta hall & Front-right teal-slate hall (Los Pasar)
  const shW = w * 0.4;
  const shD = d * 0.42;
  const shZ = d * 0.2;
  const halls = [
    { x: -w * 0.23, roofMat: roofTerra },
    { x: w * 0.23, roofMat: roofSlateTeal },
  ];
  for (const hSpec of halls) {
    // Open market arcade columns & vendor awnings
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 0, 1] as const) {
        addBoxBottom(
          g,
          pool,
          0.32,
          3.1,
          0.32,
          hSpec.x + sx * (shW * 0.44),
          0.15,
          shZ + sz * (shD * 0.36),
          colMat
        );
      }
    }
    addBoxBottom(g, pool, shW * 0.84, 2.2, shD * 0.84, hSpec.x, 0.15, shZ, wallStall);
    addBoxBottom(g, pool, shW * 0.96, 0.35, 0.9, hSpec.x, 2.25, shZ + shD * 0.45, stallAmber);
    addHippedRoof(g, pool, shW + 0.9, shD + 0.9, 1.7, 0.55, hSpec.x, 3.25, shZ, hSpec.roofMat);
    // Upper tier monitor cap
    addHippedRoof(g, pool, shW * 0.52, shD * 0.52, 0.9, 0.45, hSpec.x, 4.6, shZ, hSpec.roofMat);
  }

  return g;
}

function buildRukoRow(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const parkMat = pool.stdMat('ruko-park', 0xcbd5e1, { roughness: 0.78 });
  const stripeMat = pool.stdMat('ruko-stripe', 0xf8fafc, { roughness: 0.7 });
  const wallCream = pool.stdMat('ruko-cream', 0xf1f5f9, { roughness: 0.75 });
  const windowBand = pool.stdMat('ruko-window', 0x1e293b, { roughness: 0.22, metalness: 0.4 });
  const glassFront = pool.stdMat('ruko-front', 0x38bdf8, { roughness: 0.25, metalness: 0.35 });

  const unitPalette = [
    { wall: 0xea580c, awn: 0xdc2626, key: 'terra' },
    { wall: 0x3b82f6, awn: 0x1d4ed8, key: 'blue' },
    { wall: 0xd97706, awn: 0xb45309, key: 'ochre' },
    { wall: 0x0d9488, awn: 0x0f766e, key: 'teal' },
  ];

  // Front parking apron (+Z)
  addBoxBottom(g, pool, w * 0.96, 0.14, d * 0.96, 0, 0, 0, parkMat, false, true);
  const unitCount = w >= 18 ? 4 : 3;
  for (let i = 1; i < unitCount + 1; i++) {
    const sx = -w * 0.4 + (i / (unitCount + 1)) * (w * 0.8);
    addBoxBottom(g, pool, 0.14, 0.03, d * 0.2, sx, 0.14, d * 0.34, stripeMat, false, true);
  }

  const rowW = w * 0.9;
  const gap = 0.22;
  const unitW = (rowW - gap * (unitCount - 1)) / unitCount;
  const unitD = d * 0.58;
  const unitZ = -d * 0.14;

  for (let i = 0; i < unitCount; i++) {
    const pal = unitPalette[i % unitPalette.length];
    const unitMat = pool.stdMat(`ruko-wall-${pal.key}`, pal.wall, { roughness: 0.74 });
    const awnMat = pool.stdMat(`ruko-awn-${pal.key}`, pal.awn, { roughness: 0.55 });
    const ux = -rowW * 0.5 + i * (unitW + gap) + unitW * 0.5;
    const floors = i % 2 === 0 ? 3 : 2;
    const h = floors === 3 ? 8.6 : 6.4;

    // Main shophouse volume
    addBoxBottom(g, pool, unitW, h, unitD, ux, 0.14, unitZ, wallCream);
    // Colored facade pilasters & parapet header
    addBoxBottom(g, pool, unitW + 0.08, 1.1, unitD * 0.92, ux, 0.14 + h - 1.0, unitZ, unitMat);
    // Ground floor storefront glass
    addBoxBottom(g, pool, unitW * 0.82, 2.3, 0.16, ux, 0.14, unitZ + unitD * 0.5, glassFront, false, true);
    // Projecting front shop awning on +Z face
    const awnMesh = addBoxBottom(
      g,
      pool,
      unitW * 0.94,
      0.24,
      1.35,
      ux,
      2.65,
      unitZ + unitD * 0.5 + 0.55,
      awnMat
    );
    awnMesh.rotation.x = 0.22;

    // Upper floor window bands
    addBoxBottom(g, pool, unitW * 0.76, 1.15, 0.16, ux, 3.6, unitZ + unitD * 0.5, windowBand, false, true);
    if (floors === 3) {
      addBoxBottom(g, pool, unitW * 0.76, 1.15, 0.16, ux, 5.8, unitZ + unitD * 0.5, windowBand, false, true);
    }

    // Sloped corrugated roof cap
    addHippedRoof(g, pool, unitW + 0.16, unitD + 0.24, 1.1, 0.6, ux, 0.14 + h, unitZ, awnMat);
    if (i === 1) {
      addTorenAir(g, pool, ux, 0.14 + h, unitZ - unitD * 0.2, 0.65);
    }
  }

  return g;
}

function buildGlassTower(pool: AssetPool, w: number, d: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const minDim = Math.min(w, d);
  const plazaMat = pool.stdMat('tower-plaza', 0xe2e8f0, { roughness: 0.65 });
  const podiumMat = pool.stdMat('tower-podium', 0x64748b, { roughness: 0.55, metalness: 0.2 });
  const glassCyan = pool.stdMat('tower-glass-cyan', 0x0284c7, {
    roughness: 0.2,
    metalness: 0.5,
  });
  const glassDark = pool.stdMat('tower-glass-slate', 0x1e293b, {
    roughness: 0.2,
    metalness: 0.45,
  });
  const mullionMat = pool.stdMat('tower-mullion', 0xcbd5e1, { roughness: 0.35, metalness: 0.4 });
  const spireMat = pool.stdMat('tower-spire', 0x94a3b8, { roughness: 0.3, metalness: 0.75 });

  // Granite plaza & entrance podium
  addBoxBottom(g, pool, w * 0.94, 0.2, d * 0.94, 0, 0, 0, plazaMat, false, true);
  const podH = 3.2;
  addBoxBottom(g, pool, w * 0.82, podH, d * 0.82, 0, 0.2, 0, podiumMat);
  addBoxBottom(g, pool, w * 0.45, 0.3, d * 0.16, 0, 2.5, d * 0.42, glassCyan, false, true);

  // Sleek reflective cyan/slate glass shaft
  const towW = w * 0.66;
  const towD = d * 0.66;
  const towH = 17.5 + (seed % 3) * 3.0;
  const shaftBase = 0.2 + podH;
  addBoxBottom(g, pool, towW, towH, towD, 0, shaftBase, 0, glassCyan);

  // Vertical curtain-wall mullions & floor spandrel bands
  const floors = Math.floor(towH / 2.8);
  for (let f = 1; f < floors; f++) {
    addBoxBottom(g, pool, towW + 0.16, 0.28, towD + 0.16, 0, shaftBase + f * 2.8, 0, glassDark, false, true);
  }
  const ribCount = 3;
  for (let r = 0; r < ribCount; r++) {
    const off = -towW * 0.3 + (r / (ribCount - 1)) * (towW * 0.6);
    addBoxBottom(g, pool, 0.28, towH, towD + 0.18, off, shaftBase, 0, mullionMat, false, true);
    const offZ = -towD * 0.3 + (r / (ribCount - 1)) * (towD * 0.6);
    addBoxBottom(g, pool, towW + 0.18, towH, 0.28, 0, shaftBase, offZ, mullionMat, false, true);
  }

  // Stepped crown & mechanical penthouse
  const crownY = shaftBase + towH;
  addBoxBottom(g, pool, towW * 0.84, 1.8, towD * 0.84, 0, crownY, 0, mullionMat);
  addBoxBottom(g, pool, towW * 0.48, 1.4, towD * 0.48, 0, crownY + 1.8, 0, glassDark);
  addCylBottom(g, pool, 0.08, 0.16, Math.max(2.4, minDim * 0.15), 6, 0, crownY + 3.2, 0, spireMat);

  return g;
}

function buildCommercialMall(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const apronMat = pool.stdMat('mall-apron', 0xcbd5e1, { roughness: 0.72 });
  const wallLight = pool.stdMat('mall-wall', 0xf1f5f9, { roughness: 0.7 });
  const parapetMat = pool.stdMat('mall-parapet', 0x94a3b8, { roughness: 0.62 });
  const claddingMat = pool.stdMat('mall-cladding', 0x334155, { roughness: 0.5, metalness: 0.25 });
  const atriumGlass = pool.stdMat('mall-atrium', 0x38bdf8, { roughness: 0.2, metalness: 0.45 });
  const planterGreen = pool.stdMat('mall-green', 0x16a34a, { roughness: 0.85, flatShading: true });
  const signDark = pool.stdMat('mall-sign-bg', 0x0f172a, { roughness: 0.4 });
  const signAccent = pool.stdMat('mall-sign-accent', 0xf59e0b, { roughness: 0.35 });

  // Perimeter plaza & main wide mall volume
  addBoxBottom(g, pool, w * 0.96, 0.18, d * 0.96, 0, 0, 0, apronMat, false, true);
  const mW = w * 0.88;
  const mD = d * 0.82;
  const mH = 7.4;
  addBoxBottom(g, pool, mW, mH, mD, 0, 0.18, 0, wallLight);
  addBoxBottom(g, pool, mW + 0.16, 1.8, mD * 0.72, 0, 1.4, 0, claddingMat, false, true);

  // Stepped upper roof deck + parapet
  const rY = 0.18 + mH;
  addBoxBottom(g, pool, mW + 0.3, 0.55, mD + 0.3, 0, rY, 0, parapetMat);
  addBoxBottom(g, pool, mW * 0.68, 1.25, mD * 0.64, 0, rY + 0.55, 0, wallLight);

  // Central glass atrium skylight
  addBoxBottom(g, pool, mW * 0.44, 1.1, mD * 0.42, 0, rY + 1.8, 0, atriumGlass, false, true);

  // Front drop-off entrance canopy (+Z)
  addBoxBottom(g, pool, mW * 0.38, 0.38, d * 0.12, 0, 3.3, mD * 0.5 + d * 0.04, claddingMat);
  addBoxBottom(g, pool, mW * 0.3, 0.2, d * 0.08, 0, 3.68, mD * 0.5 + d * 0.03, atriumGlass, false, false);

  // Rooftop signage pylon box facing front
  addBoxBottom(g, pool, mW * 0.36, 2.2, 0.75, 0, rY + 0.55, mD * 0.42, signDark);
  addBoxBottom(g, pool, mW * 0.32, 0.42, 0.82, 0, rY + 1.4, mD * 0.42, signAccent, false, false);

  // Rooftop HVAC chiller units & green terrace planter strips
  for (const sx of [-1, 1] as const) {
    addBoxBottom(g, pool, mW * 0.12, 0.9, mD * 0.22, sx * (mW * 0.39), rY + 0.55, -mD * 0.2, parapetMat);
    addBoxBottom(g, pool, mW * 0.12, 0.45, mD * 0.24, sx * (mW * 0.39), rY + 0.55, mD * 0.18, planterGreen);
  }

  return g;
}

function buildStadionCorner(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const minDim = Math.min(w, d);
  const plazaMat = pool.stdMat('stad-plaza', 0xcbd5e1, { roughness: 0.75 });
  const trackRed = pool.stdMat('stad-track', 0xb91c1c, { roughness: 0.8 });
  const pitchGreen = pool.stdMat('stad-pitch', 0x16a34a, { roughness: 0.85 });
  const lineWhite = pool.stdMat('stad-line', 0xf8fafc, { roughness: 0.7 });
  const bowlSlate = pool.stdMat('stad-bowl', 0x64748b, { roughness: 0.72 });
  const roofWhite = pool.stdMat('stad-roof', 0xf8fafc, { roughness: 0.55 });
  const mastSteel = pool.stdMat('stad-mast', 0x475569, { roughness: 0.45, metalness: 0.4 });
  const floodLamp = pool.stdMat('stad-flood', 0xfef9c3, {
    roughness: 0.25,
    emissive: 0xfde68a,
    emissiveIntensity: 0.25,
  });

  // Outer plaza
  addBoxBottom(g, pool, w * 0.96, 0.16, d * 0.96, 0, 0, 0, plazaMat, false, true);

  // Curved stadium bowl (cylindrical/elliptical outer concrete stands)
  const bowlR = minDim * 0.44;
  const bowlH = 3.8;
  const outerBowlGeo = pool.regGeo(new THREE.CylinderGeometry(bowlR, bowlR * 1.06, bowlH, 24, 1, true));
  const outerBowl = new THREE.Mesh(outerBowlGeo, bowlSlate);
  outerBowl.scale.set(w / minDim, 1, d / minDim);
  outerBowl.position.set(0, 0.16 + bowlH * 0.5, 0);
  outerBowl.castShadow = true;
  outerBowl.receiveShadow = true;
  g.add(outerBowl);

  // Running track & green football pitch inside bowl
  addCylBottom(g, pool, bowlR * 0.92, bowlR * 0.92, 0.12, 24, 0, 0.16, 0, trackRed, false, true);
  addBoxBottom(g, pool, w * 0.56, 0.08, d * 0.54, 0, 0.28, 0, pitchGreen, false, true);
  addBoxBottom(g, pool, 0.2, 0.03, d * 0.52, 0, 0.36, 0, lineWhite, false, true);
  const centerCircleGeo = pool.regGeo(new THREE.RingGeometry(minDim * 0.08, minDim * 0.095, 20));
  const centerCircle = new THREE.Mesh(centerCircleGeo, lineWhite);
  centerCircle.rotation.x = -Math.PI * 0.5;
  centerCircle.position.set(0, 0.37, 0);
  g.add(centerCircle);

  // Curved grandstand canopy roof along West & North arc
  const canopyArcGeo = pool.regGeo(
    new THREE.CylinderGeometry(bowlR * 1.08, bowlR * 1.08, 0.45, 20, 1, false, Math.PI * 0.45, Math.PI * 1.15)
  );
  const canopy = new THREE.Mesh(canopyArcGeo, roofWhite);
  canopy.scale.set(w / minDim, 1, d / minDim);
  canopy.position.set(0, 0.16 + bowlH + 1.35, 0);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  g.add(canopy);

  // Tiered seating ring lip
  const rimGeo = pool.regGeo(new THREE.TorusGeometry(bowlR * 0.98, 0.48, 6, 24));
  const rim = new THREE.Mesh(rimGeo, bowlSlate);
  rim.rotation.x = Math.PI * 0.5;
  rim.scale.set(w / minDim, d / minDim, 1);
  rim.position.set(0, 0.16 + bowlH * 0.72, 0);
  rim.castShadow = true;
  g.add(rim);

  // 4 corner floodlight towers
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const tx = sx * (w * 0.4);
      const tz = sz * (d * 0.4);
      const mastH = 12.5;
      addCylBottom(g, pool, 0.18, 0.32, mastH, 8, tx, 0.16, tz, mastSteel);
      const bank = addBoxBottom(g, pool, 2.2, 1.15, 0.35, tx, 0.16 + mastH, tz, mastSteel);
      bank.lookAt(0, 0, 0);
      const face = new THREE.Mesh(pool.unitBox, floodLamp);
      face.scale.set(1.9, 0.85, 0.08);
      face.position.set(0, 0, 0.2);
      bank.add(face);
    }
  }

  return g;
}

function buildParkPlaza(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const minDim = Math.min(w, d);
  const curbMat = pool.stdMat('park-curb', 0xcbd5e1, { roughness: 0.76 });
  const grassMat = pool.stdMat('park-grass', 0x22c55e, { roughness: 0.9 });
  const pathMat = pool.stdMat('park-path', 0xe2e8f0, { roughness: 0.72 });
  const waterMat = pool.stdMat('park-water', 0x0284c7, { roughness: 0.14, metalness: 0.25 });
  const fountainRim = pool.stdMat('park-fountain-rim', 0xf1f5f9, { roughness: 0.55 });
  const benchWood = pool.stdMat('park-bench-wood', 0x92400e, { roughness: 0.8 });

  // Stone border & green lawn
  addBoxBottom(g, pool, w * 0.96, 0.16, d * 0.96, 0, 0, 0, curbMat, false, true);
  addBoxBottom(g, pool, w * 0.88, 0.06, d * 0.88, 0, 0.16, 0, grassMat, false, true);

  // Cross walkways
  addBoxBottom(g, pool, w * 0.88, 0.04, Math.min(2.2, minDim * 0.12), 0, 0.22, 0, pathMat, false, true);
  addBoxBottom(g, pool, Math.min(2.2, minDim * 0.12), 0.04, d * 0.88, 0, 0.22, 0, pathMat, false, true);

  // Central plaza circle & decorative fountain water disc
  const plazaR = Math.max(2.4, minDim * 0.19);
  addCylBottom(g, pool, plazaR, plazaR, 0.12, 20, 0, 0.22, 0, fountainRim, false, true);
  addCylBottom(g, pool, plazaR * 0.68, plazaR * 0.68, 0.08, 20, 0, 0.34, 0, waterMat, false, true);
  addCylBottom(g, pool, plazaR * 0.2, plazaR * 0.28, 0.7, 12, 0, 0.34, 0, fountainRim);

  // 4 teak benches around central plaza
  const benchDist = plazaR * 1.15;
  for (const bx of [-benchDist, benchDist]) {
    addBoxBottom(g, pool, 0.55, 0.42, 1.7, bx, 0.24, 0, benchWood);
  }
  for (const bz of [-benchDist, benchDist]) {
    addBoxBottom(g, pool, 1.7, 0.42, 0.55, 0, 0.24, bz, benchWood);
  }

  // 4 shaded tropical corner trees inside the park
  const treeScale = Math.max(0.6, minDim * 0.038);
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const tree = buildShadeTree(pool, treeScale, (sx + sz) === 0 ? 1 : 0);
      tree.position.set(sx * (w * 0.28), 0.22, sz * (d * 0.28));
      g.add(tree);
    }
  }

  return g;
}

function buildParkPond(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const minDim = Math.min(w, d);
  const borderMat = pool.stdMat('pond-border', 0xa7f3d0, { roughness: 0.85 });
  const lawnMat = pool.stdMat('pond-lawn', 0x4ade80, { roughness: 0.9 });
  const bankMat = pool.stdMat('pond-bank', 0x94a3b8, { roughness: 0.78 });
  const waterMat = pool.stdMat('pond-water', 0x38bdf8, { roughness: 0.12, metalness: 0.28 });
  const deckWood = pool.stdMat('pond-deck', 0x92400e, { roughness: 0.78 });

  addBoxBottom(g, pool, w * 0.94, 0.14, d * 0.94, 0, 0, 0, borderMat, false, true);
  addBoxBottom(g, pool, w * 0.88, 0.06, d * 0.88, 0, 0.14, 0, lawnMat, false, true);

  // Decorative oval stone bank + reflective pond water disc
  const pondGeo = pool.regGeo(new THREE.CylinderGeometry(minDim * 0.32, minDim * 0.34, 0.14, 22));
  const bank = new THREE.Mesh(pondGeo, bankMat);
  bank.scale.set((w / minDim) * 1.05, 1, (d / minDim) * 0.85);
  bank.position.set(0, 0.2, 0);
  bank.receiveShadow = true;
  g.add(bank);

  const water = new THREE.Mesh(pondGeo, waterMat);
  water.scale.set((w / minDim) * 0.94, 0.7, (d / minDim) * 0.74);
  water.position.set(0, 0.24, 0);
  water.receiveShadow = true;
  g.add(water);

  // Wooden viewing jetty & bench
  addBoxBottom(g, pool, 2.4, 0.22, 1.8, -w * 0.24, 0.2, d * 0.2, deckWood);
  addBoxBottom(g, pool, 1.5, 0.4, 0.5, -w * 0.24, 0.42, d * 0.24, deckWood);

  // Corner trees
  const t1 = buildShadeTree(pool, 0.72, 0);
  t1.position.set(-w * 0.32, 0.2, -d * 0.3);
  g.add(t1);
  const t2 = buildShadeTree(pool, 0.65, 1);
  t2.position.set(w * 0.32, 0.2, d * 0.28);
  g.add(t2);

  return g;
}

function buildParkingLot(pool: AssetPool, w: number, d: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const curbMat = pool.stdMat('plot-curb', 0xcbd5e1, { roughness: 0.78 });
  const lotMat = pool.stdMat('plot-asphalt', 0x475569, { roughness: 0.88 });
  const stripeMat = pool.stdMat('plot-stripe', 0xf8fafc, { roughness: 0.7 });
  const stopMat = pool.stdMat('plot-stop', 0x94a3b8, { roughness: 0.75 });
  const boothMat = pool.stdMat('plot-booth', 0x1e293b, { roughness: 0.5 });

  addBoxBottom(g, pool, w * 0.96, 0.14, d * 0.96, 0, 0, 0, curbMat, false, true);
  addBoxBottom(g, pool, w * 0.9, 0.04, d * 0.88, 0, 0.14, 0, lotMat, false, true);

  // Parking bay stripes & wheel stops on top (-Z) and bottom (+Z) rows
  const bays = Math.max(3, Math.floor((w * 0.76) / 3.2));
  const baySpan = w * 0.76;
  const bayDepth = Math.min(4.6, d * 0.3);
  const rowZOffsets = [-d * 0.26, d * 0.26];
  const carColors = [0xf8fafc, 0x334155, 0x0f766e, 0x1e3a8a, 0x94a3b8];

  for (let rIdx = 0; rIdx < rowZOffsets.length; rIdx++) {
    const rz = rowZOffsets[rIdx];
    for (let i = 0; i <= bays; i++) {
      const lx = -baySpan * 0.5 + (i / bays) * baySpan;
      addBoxBottom(g, pool, 0.12, 0.03, bayDepth, lx, 0.18, rz, stripeMat, false, true);
    }
    for (let i = 0; i < bays; i++) {
      const cx = -baySpan * 0.5 + ((i + 0.5) / bays) * baySpan;
      const stopZ = rz + (rIdx === 0 ? -bayDepth * 0.36 : bayDepth * 0.36);
      addBoxBottom(g, pool, 1.5, 0.14, 0.24, cx, 0.18, stopZ, stopMat, false, true);

      // Deterministic static parked micro-cars in ~55% of bays
      if ((i * 3 + rIdx * 2 + seed) % 7 < 4) {
        const col = carColors[(i + rIdx + seed) % carColors.length];
        addParkedMicroCar(
          g,
          pool,
          cx,
          0.18,
          rz,
          rIdx === 0 ? 0 : Math.PI,
          col,
          String((i + rIdx + seed) % carColors.length)
        );
      }
    }
  }

  // Tiny parking attendant booth near edge
  addBoxBottom(g, pool, 1.8, 2.2, 1.8, -w * 0.38, 0.18, 0, boothMat);

  return g;
}

function buildBusShelter(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const len = Math.max(4.5, w);
  const depth = Math.max(2.0, d);
  const deckMat = pool.stdMat('halte-deck', 0xcbd5e1, { roughness: 0.72 });
  const tactileMat = pool.stdMat('halte-tactile', 0xfbbf24, { roughness: 0.7 });
  const frameIndigo = pool.stdMat('halte-indigo', 0x3730a3, { roughness: 0.42, metalness: 0.35 });
  const roofIndigo = pool.stdMat('halte-roof', 0x4f46e5, { roughness: 0.35, metalness: 0.25 });
  const glassPane = pool.stdMat('halte-glass', 0x38bdf8, {
    roughness: 0.15,
    metalness: 0.3,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const benchMat = pool.stdMat('halte-bench', 0xe2e8f0, { roughness: 0.5 });

  // Boarding platform + yellow safety edge
  addBoxBottom(g, pool, len, 0.2, depth, 0, 0, 0, deckMat, false, true);
  addBoxBottom(g, pool, len * 0.96, 0.03, 0.24, 0, 0.2, depth * 0.42, tactileMat, false, true);

  // Indigo steel posts & translucent glass windscreens (open toward +Z curb)
  const postCount = 3;
  for (let i = 0; i < postCount; i++) {
    const px = -len * 0.38 + (i / (postCount - 1)) * (len * 0.76);
    addBoxBottom(g, pool, 0.14, 2.45, 0.14, px, 0.2, -depth * 0.34, frameIndigo);
  }
  addBoxBottom(g, pool, len * 0.78, 2.0, 0.08, 0, 0.35, -depth * 0.34, glassPane, false, false);
  addBoxBottom(g, pool, 0.08, 2.0, depth * 0.52, -len * 0.38, 0.35, -depth * 0.08, glassPane, false, false);

  // Bench inside shelter
  addBoxBottom(g, pool, len * 0.56, 0.45, 0.46, 0, 0.2, -depth * 0.16, benchMat);

  // Sleek cantilevered indigo canopy roof
  const roof = addBoxBottom(g, pool, len * 0.9, 0.2, depth * 0.9, 0, 2.58, 0.06, roofIndigo);
  roof.rotation.x = -0.06;

  // Totem TMB / Halte signpost
  addBoxBottom(g, pool, 0.45, 3.0, 0.2, len * 0.44, 0.2, depth * 0.22, frameIndigo);

  return g;
}

function buildRoofHouse1(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const plinthMat = pool.stdMat('br1-plinth', 0xe2e8f0, { roughness: 0.76 });
  const wallMat = pool.stdMat('br1-wall', 0xf8fafc, { roughness: 0.78 });
  const winMat = pool.stdMat('br1-win', 0x334155, { roughness: 0.3, metalness: 0.25 });
  const roofTerra = pool.stdMat('br1-terra', 0xea580c, { roughness: 0.72, flatShading: true });
  const roofCrown = pool.stdMat('br1-crown', 0xc2410c, { roughness: 0.7, flatShading: true });

  addBoxBottom(g, pool, w * 0.92, 0.18, d * 0.92, 0, 0, 0, plinthMat, false, true);
  const bW = w * 0.8;
  const bD = d * 0.8;
  const bH = 3.8;
  addBoxBottom(g, pool, bW, bH, bD, 0, 0.18, 0, wallMat);
  addBoxBottom(g, pool, bW + 0.1, 1.1, bD * 0.65, 0, 1.35, 0, winMat, false, true);
  addBoxBottom(g, pool, bW * 0.65, 1.1, bD + 0.1, 0, 1.35, 0, winMat, false, true);

  // Hipped Indonesian genteng roof + flat utility crown with blue toren air
  addHippedRoof(g, pool, bW + 1.0, bD + 1.0, 2.3, 0.46, 0, 0.18 + bH, 0, roofTerra);
  addBoxBottom(g, pool, bW * 0.32, 0.35, bD * 0.32, bW * 0.24, 0.18 + bH + 0.35, bD * 0.22, roofCrown);
  addTorenAir(g, pool, bW * 0.25, 0.18 + bH + 0.7, bD * 0.23, 0.8);

  return g;
}

function buildRoofHouse2(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const courtMat = pool.stdMat('br2-court', 0xe2e8f0, { roughness: 0.78 });
  const wallMat = pool.stdMat('br2-wall', 0xfef3c7, { roughness: 0.78 });
  const winMat = pool.stdMat('br2-win', 0x334155, { roughness: 0.3, metalness: 0.25 });
  const roofOchre = pool.stdMat('br2-ochre', 0xd97706, { roughness: 0.7, flatShading: true });
  const roofTerra = pool.stdMat('br2-terra', 0xea580c, { roughness: 0.72, flatShading: true });

  addBoxBottom(g, pool, w * 0.92, 0.16, d * 0.92, 0, 0, 0, courtMat, false, true);

  // L-shaped building wings
  const h = 4.9;
  addBoxBottom(g, pool, w * 0.84, h, d * 0.38, 0, 0.16, -d * 0.23, wallMat);
  addBoxBottom(g, pool, w * 0.8, 1.1, d * 0.4, 0, 2.3, -d * 0.23, winMat, false, true);
  addHippedRoof(g, pool, w * 0.88, d * 0.42, 1.9, 0.58, 0, 0.16 + h, -d * 0.23, roofTerra);

  addBoxBottom(g, pool, w * 0.38, h, d * 0.48, -w * 0.23, 0.16, d * 0.18, wallMat);
  addHippedRoof(g, pool, w * 0.42, d * 0.52, 1.7, 0.55, -w * 0.23, 0.16 + h, d * 0.18, roofOchre);

  // Blue toren air & courtyard shrub
  addTorenAir(g, pool, -w * 0.24, 0.16 + h + 0.5, -d * 0.24, 0.78);
  const shrub = buildShadeTree(pool, 0.52, 0);
  shrub.position.set(w * 0.2, 0.16, d * 0.2);
  g.add(shrub);

  return g;
}

function buildRoofCommercial3(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const wallMat = pool.stdMat('br3-wall', 0xf1f5f9, { roughness: 0.72 });
  const parapetMat = pool.stdMat('br3-parapet', 0x94a3b8, { roughness: 0.65 });
  const winBand = pool.stdMat('br3-win', 0x334155, { roughness: 0.28, metalness: 0.3 });
  const skylight = pool.stdMat('br3-sky', 0x38bdf8, { roughness: 0.2, metalness: 0.45 });

  const bW = w * 0.86;
  const bD = d * 0.86;
  const bH = 8.4;
  addBoxBottom(g, pool, w * 0.94, 0.16, d * 0.94, 0, 0, 0, parapetMat, false, true);
  addBoxBottom(g, pool, bW, bH, bD, 0, 0.16, 0, wallMat);
  for (const fy of [1.8, 4.4, 6.6]) {
    addBoxBottom(g, pool, bW + 0.1, 1.1, bD * 0.78, 0, fy, 0, winBand, false, true);
    addBoxBottom(g, pool, bW * 0.78, 1.1, bD + 0.1, 0, fy, 0, winBand, false, true);
  }
  const rY = 0.16 + bH;
  addBoxBottom(g, pool, bW + 0.25, 0.5, bD + 0.25, 0, rY, 0, parapetMat);
  addBoxBottom(g, pool, bW * 0.45, 0.75, bD * 0.45, 0, rY + 0.5, 0, skylight, false, true);
  addBoxBottom(g, pool, bW * 0.22, 0.65, bD * 0.14, -bW * 0.24, rY + 0.5, -bD * 0.3, parapetMat);
  addTorenAir(g, pool, -bW * 0.3, rY + 0.5, bD * 0.3, 0.75);

  return g;
}

function buildTerraceGreen(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const wallMat = pool.stdMat('btg-wall', 0xf1f5f9, { roughness: 0.7 });
  const parapetMat = pool.stdMat('btg-parapet', 0x64748b, { roughness: 0.6 });
  const lawnMat = pool.stdMat('btg-lawn', 0x22c55e, { roughness: 0.88 });
  const teakMat = pool.stdMat('btg-teak', 0xb45309, { roughness: 0.78 });
  const glassMat = pool.stdMat('btg-glass', 0x38bdf8, { roughness: 0.2, metalness: 0.45 });

  const bW = w * 0.86;
  const bD = d * 0.86;
  const bH = 7.8;
  addBoxBottom(g, pool, w * 0.94, 0.16, d * 0.94, 0, 0, 0, parapetMat, false, true);
  addBoxBottom(g, pool, bW, bH, bD, 0, 0.16, 0, wallMat);
  addBoxBottom(g, pool, bW + 0.12, 1.35, bD * 0.8, 0, 2.2, 0, glassMat, false, true);
  addBoxBottom(g, pool, bW + 0.12, 1.35, bD * 0.8, 0, 5.2, 0, glassMat, false, true);

  // Rooftop garden lawn + teak decking cross + central skylight pavilion
  const rY = 0.16 + bH;
  addBoxBottom(g, pool, bW + 0.2, 0.42, bD + 0.2, 0, rY, 0, parapetMat);
  addBoxBottom(g, pool, bW * 0.86, 0.14, bD * 0.86, 0, rY + 0.42, 0, lawnMat, false, true);
  addBoxBottom(g, pool, bW * 0.86, 0.06, 1.4, 0, rY + 0.56, 0, teakMat, false, true);
  addBoxBottom(g, pool, 1.4, 0.06, bD * 0.86, 0, rY + 0.56, 0, teakMat, false, true);
  addBoxBottom(g, pool, bW * 0.36, 1.5, bD * 0.36, 0, rY + 0.62, 0, wallMat);
  addBoxBottom(g, pool, bW * 0.3, 0.55, bD * 0.3, 0, rY + 2.12, 0, glassMat, false, true);

  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const shrub = buildShadeTree(pool, 0.45, 1);
      shrub.position.set(sx * (bW * 0.32), rY + 0.56, sz * (bD * 0.32));
      g.add(shrub);
    }
  }

  return g;
}

function buildPlanterBox(pool: AssetPool, w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const boxMat = pool.stdMat('planter-concrete', 0xcbd5e1, { roughness: 0.78 });
  const soilMat = pool.stdMat('planter-soil', 0x78350f, { roughness: 0.95 });
  const shrubDark = pool.stdMat('planter-shrub-1', 0x15803d, { roughness: 0.86, flatShading: true });
  const shrubLight = pool.stdMat('planter-shrub-2', 0x22c55e, { roughness: 0.84, flatShading: true });

  addBoxBottom(g, pool, w, 0.46, d, 0, 0, 0, boxMat);
  addBoxBottom(g, pool, w * 0.9, 0.08, d * 0.78, 0, 0.46, 0, soilMat, false, true);

  const count = Math.max(3, Math.round(w / 1.8));
  for (let i = 0; i < count; i++) {
    const px = -w * 0.38 + (i / Math.max(1, count - 1)) * (w * 0.76);
    const rad = Math.min(0.68, d * 0.35);
    const bush = new THREE.Mesh(pool.foliageIco, i % 2 === 0 ? shrubDark : shrubLight);
    bush.scale.set(rad * 1.1, rad * 0.9, rad);
    bush.position.set(px, 0.54 + rad * 0.65, 0);
    bush.castShadow = true;
    bush.receiveShadow = true;
    g.add(bush);
  }
  return g;
}

// =============================================================================
// Foliage & Streetlight Builders
// =============================================================================

function buildShadeTree(pool: AssetPool, scale = 1, variant = 0): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = pool.stdMat('tree-trunk', 0x78350f, { roughness: 0.92 });
  const pitMat = pool.stdMat('tree-pit', 0x57534e, { roughness: 0.95 });
  const gDark = pool.stdMat('tree-green-dark', 0x15803d, { roughness: 0.86, flatShading: true });
  const gMid = pool.stdMat('tree-green-mid', 0x16a34a, { roughness: 0.85, flatShading: true });
  const gBright = pool.stdMat('tree-green-bright', 0x22c55e, { roughness: 0.84, flatShading: true });

  const trunkH = 2.4 * scale;
  addCylBottom(g, pool, 0.42 * scale, 0.48 * scale, 0.1, 10, 0, 0, 0, pitMat, false, true);
  addCylBottom(g, pool, 0.14 * scale, 0.24 * scale, trunkH, 7, 0, 0.08, 0, trunkMat);

  const clusters =
    variant % 2 === 0
      ? [
          { x: 0, y: 2.85, z: 0, r: 1.48, mat: gMid },
          { x: -0.78, y: 2.35, z: 0.55, r: 1.05, mat: gDark },
          { x: 0.72, y: 2.5, z: -0.48, r: 1.12, mat: gBright },
          { x: 0.18, y: 3.45, z: 0.15, r: 0.92, mat: gBright },
        ]
      : [
          { x: 0, y: 2.95, z: 0, r: 1.42, mat: gDark },
          { x: 0.78, y: 2.45, z: 0.52, r: 1.08, mat: gMid },
          { x: -0.68, y: 2.6, z: -0.55, r: 1.02, mat: gBright },
        ];

  for (const c of clusters) {
    const m = new THREE.Mesh(pool.foliageIco, c.mat);
    m.scale.set(c.r * scale, c.r * 0.84 * scale, c.r * scale);
    m.position.set(c.x * scale, c.y * scale, c.z * scale);
    m.rotation.set(variant * 0.4, c.x * 0.7, c.z * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function buildPalmTree(pool: AssetPool, scale = 1, seed = 0): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = pool.stdMat('palm-trunk', 0x92400e, { roughness: 0.9 });
  const cocoMat = pool.stdMat('palm-coco', 0x451a03, { roughness: 0.85 });
  const frondDark = pool.stdMat('palm-frond-dark', 0x15803d, { roughness: 0.82, flatShading: true });
  const frondBright = pool.stdMat('palm-frond-bright', 0x22c55e, { roughness: 0.8, flatShading: true });

  // Slightly angled 2-segment coconut palm trunk
  const s1 = addCylBottom(g, pool, 0.16 * scale, 0.24 * scale, 3.4 * scale, 7, 0, 0, 0, trunkMat);
  s1.rotation.z = 0.06;
  const s2 = addCylBottom(
    g,
    pool,
    0.11 * scale,
    0.16 * scale,
    3.2 * scale,
    7,
    -0.22 * scale,
    3.3 * scale,
    0,
    trunkMat
  );
  s2.rotation.z = -0.05;

  const crownX = -0.14 * scale;
  const crownY = 6.45 * scale;
  // Coconut cluster
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const coco = new THREE.Mesh(pool.foliageIco, cocoMat);
    coco.scale.setScalar(0.18 * scale);
    coco.position.set(crownX + Math.cos(a) * 0.18 * scale, crownY - 0.15 * scale, Math.sin(a) * 0.18 * scale);
    g.add(coco);
  }

  // 8 arching tropical palm fronds (lower & upper tiers)
  const frondGeo = pool.regGeo(new THREE.ConeGeometry(0.42 * scale, 2.35 * scale, 4));
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + (seed % 5) * 0.35;
    const upper = i % 2 === 0;
    const pivot = new THREE.Group();
    pivot.position.set(crownX, crownY, 0);
    pivot.rotation.y = angle;

    const blade = new THREE.Mesh(frondGeo, upper ? frondBright : frondDark);
    blade.scale.set(0.95, 1, 0.26);
    blade.rotation.z = upper ? -1.18 : -1.42;
    blade.position.set(1.12 * scale, upper ? 0.26 * scale : 0.05 * scale, 0);
    blade.castShadow = true;
    blade.receiveShadow = true;
    pivot.add(blade);
    g.add(pivot);
  }

  return g;
}

function buildStreetlight(
  pool: AssetPool,
  lampEmissiveMat: THREE.MeshStandardMaterial
): THREE.Group {
  const g = new THREE.Group();
  const poleMat = pool.stdMat('lamp-pole', 0x64748b, { roughness: 0.42, metalness: 0.55 });
  const baseMat = pool.stdMat('lamp-base', 0x334155, { roughness: 0.5, metalness: 0.45 });

  // Base flange + tapered pole
  addCylBottom(g, pool, 0.14, 0.2, 0.45, 8, 0, 0, 0, baseMat);
  addCylBottom(g, pool, 0.065, 0.11, 5.75, 8, 0, 0.45, 0, poleMat);

  // Angled mast arm extending along local +X toward roadway
  const arm = addBoxBottom(g, pool, 1.75, 0.09, 0.09, 0.82, 6.08, 0, poleMat);
  arm.rotation.z = 0.14;

  // Sleek luminaire housing + emissive warm-amber lens underneath
  addBoxBottom(g, pool, 0.72, 0.14, 0.36, 1.66, 6.24, 0, baseMat);
  addBoxBottom(g, pool, 0.58, 0.06, 0.28, 1.66, 6.18, 0, lampEmissiveMat, false, false);

  return g;
}

// =============================================================================
// AssetKey Normalization & Landmark Dispatcher
// =============================================================================

function normalizeAssetKey(assetKey: string): string {
  const file = assetKey.split('/').pop() ?? assetKey;
  return file.replace(/\.svg$/i, '').trim().toLowerCase();
}

const LANDMARK_BUILDERS: Record<string, LandmarkBuilderFn> = {
  'landmark-masjid-jami': (pool, w, d) => buildMasjidJami(pool, w, d),
  'landmark-terminal-giwangan': (pool, w, d) => buildTerminalGiwangan(pool, w, d),
  'landmark-spbu-pertamina': (pool, w, d) => buildSpbuPertamina(pool, w, d),
  'landmark-mako-brimob': (pool, w, d) => buildMakoBrimob(pool, w, d),
  'helipad-roof': (pool, w, d) => buildHelipadHospital(pool, w, d),
  'landmark-kampus-wilis': (pool, w, d) => buildKampusWilis(pool, w, d),
  'landmark-pasar-tradisional': (pool, w, d) => buildPasarTradisional(pool, w, d),
  'landmark-ruko-row': (pool, w, d) => buildRukoRow(pool, w, d),
  'building-tower-glass': (pool, w, d, seed) => buildGlassTower(pool, w, d, seed),
  'building-commercial-mall': (pool, w, d) => buildCommercialMall(pool, w, d),
  'landmark-stadion-corner': (pool, w, d) => buildStadionCorner(pool, w, d),
  'park-plaza': (pool, w, d) => buildParkPlaza(pool, w, d),
  'park-pond': (pool, w, d) => buildParkPond(pool, w, d),
  'parking-lot-top': (pool, w, d, seed) => buildParkingLot(pool, w, d, seed),
  'bus-shelter-top': (pool, w, d) => buildBusShelter(pool, w, d),
  'building-roof-1': (pool, w, d) => buildRoofHouse1(pool, w, d),
  'building-roof-2': (pool, w, d) => buildRoofHouse2(pool, w, d),
  'building-roof-3': (pool, w, d) => buildRoofCommercial3(pool, w, d),
  'building-terrace-green': (pool, w, d) => buildTerraceGreen(pool, w, d),
  'planter-box-long': (pool, w, d) => buildPlanterBox(pool, w, d),
  'tree-palm-top': (pool, w, d, seed) => buildPalmTree(pool, Math.max(0.75, Math.min(w, d) * 0.2), seed),
};

function buildLandmarkInstance(
  pool: AssetPool,
  assetKey: string,
  w: number,
  d: number,
  x2D: number,
  y2D: number,
  rotationRad: number,
  seed: number
): { mesh: THREE.Group; bounds: BoxBounds2D } {
  const key = normalizeAssetKey(assetKey);
  const builder = LANDMARK_BUILDERS[key] ?? LANDMARK_BUILDERS['building-roof-3'];
  const mesh = builder(pool, Math.max(2, w), Math.max(2, d), seed);
  // Exact 2D->3D coordinate mapping: X3D = x2D, Z3D = y2D, Y3D = up
  mesh.position.set(x2D, 0, y2D);
  mesh.rotation.y = -rotationRad;
  return {
    mesh,
    bounds: {
      cx: x2D,
      cz: y2D,
      halfX: w * 0.5 + 1.4,
      halfZ: d * 0.5 + 1.4,
      rotY: -rotationRad,
    },
  };
}

// =============================================================================
// Spatial Collision Guards (Prevents Foliage/Lamps Clipping Roads or Buildings)
// =============================================================================

function isInsideLandmarkBounds(x: number, z: number, boxes: BoxBounds2D[]): boolean {
  for (const b of boxes) {
    const dx = x - b.cx;
    const dz = z - b.cz;
    const c = Math.cos(-b.rotY);
    const s = Math.sin(-b.rotY);
    // Inverse rotate into box local XZ
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    if (Math.abs(lx) < b.halfX && Math.abs(lz) < b.halfZ) {
      return true;
    }
  }
  return false;
}

function isInsideCustomRoadway(x: number, y: number, compiled: CompiledTopology): boolean {
  const r = Math.hypot(x, y);
  if (r < 9) return true;
  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const proj = x * arm.outDir.x + y * arm.outDir.y;
    const lat = x * arm.inLeftNormal.x + y * arm.inLeftNormal.y;
    if (proj >= arm.setback - 3.5 && proj <= arm.setback + arm.def.length + 3) {
      const inEdge = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0) + 1.0;
      const outEdge = arm.halfMedian + arm.outWidth + 1.0;
      if (lat > -outEdge && lat < inEdge) {
        return true;
      }
    }
  }
  return false;
}

// =============================================================================
// Environment Resolution & Standard 4-Arm Corner Specs (Synced with drawStaticRoad)
// =============================================================================

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
        { sx: -1, sy: -1, primary: 'landmark-ruko-row', secondary: 'parking-lot-top', tertiary: 'building-roof-1', isPark: false, label: 'Ruko & Pertokoan' },
        { sx: 1, sy: -1, primary: 'landmark-mako-brimob', secondary: 'parking-lot-top', tertiary: 'building-roof-2', isPark: false, label: 'Pos / Kompleks Brimob' },
        { sx: -1, sy: 1, primary: 'landmark-spbu-pertamina', secondary: 'parking-lot-top', tertiary: 'landmark-ruko-row', isPark: false, label: 'SPBU Giwangan' },
        { sx: 1, sy: 1, primary: 'landmark-terminal-giwangan', secondary: 'bus-shelter-top', tertiary: 'building-roof-3', isPark: false, label: 'Terminal Giwangan' },
      ];
    case 'brimob-yogya':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/landmark-mako-brimob.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: false, label: 'Mako Brimob Baciro' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-pasar-tradisional.svg', secondary: '/assets/infra/city/landmark-ruko-row.svg', tertiary: '/assets/infra/city/building-roof-1.svg', isPark: false, label: 'Taru Martani & Ruko' },
        { sx: -1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-roof-3.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Ruko Gondosuli' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-stadion-corner.svg', secondary: '/assets/infra/city/park-plaza.svg', tertiary: '/assets/infra/city/building-terrace-green.svg', isPark: true, label: 'Kawasan Mandala Krida', denseTrees: true },
      ];
    case 'lamper-semarang':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/landmark-ruko-row.svg', isPark: false, label: 'Eks Lotte Mart Majapahit' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: false, label: 'Ruko Jl. Gajah Raya' },
        { sx: -1, sy: 1, primary: '/assets/infra/city/helipad-roof.svg', secondary: '/assets/infra/city/building-tower-glass.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Kawasan RS Bhayangkara' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-roof-1.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: false, label: 'Ruko Lamper Tengah' },
      ];
    case 'sulawesi-banjarmasin':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/landmark-pasar-tradisional.svg', secondary: '/assets/infra/city/landmark-ruko-row.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Pasar Lama' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-masjid-jami.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: true, label: 'Kawasan Masjid Jami', riverEdge: true },
        { sx: -1, sy: 1, primary: '/assets/infra/city/building-roof-1.svg', secondary: '/assets/infra/city/building-roof-3.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: false, label: 'Kampung Bugis' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/park-plaza.svg', tertiary: '/assets/infra/city/building-roof-1.svg', isPark: false, label: 'Tepi Sungai & Jembatan', riverEdge: true },
      ];
    case 'laswi-bandung':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/building-tower-glass.svg', secondary: '/assets/infra/city/helipad-roof.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Koridor Laswi' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-spbu-pertamina.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'SPBU & Halte TMB' },
        { sx: -1, sy: 1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-tower-glass.svg', isPark: false, label: 'Kawasan Trans Studio' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/building-terrace-green.svg', secondary: '/assets/infra/city/park-plaza.svg', tertiary: '/assets/infra/city/landmark-ruko-row.svg', isPark: false, label: 'Pelajar Pejuang 45' },
      ];
    case 'bondowoso-malang':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/landmark-kampus-wilis.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-terrace-green.svg', isPark: false, label: 'Kampus Widya Karya', denseTrees: true },
        { sx: 1, sy: -1, primary: '/assets/infra/city/park-plaza.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: true, label: 'Taman Jl. Retawu', denseTrees: true },
        { sx: -1, sy: 1, primary: '/assets/infra/city/landmark-pasar-tradisional.svg', secondary: '/assets/infra/city/landmark-ruko-row.svg', tertiary: '/assets/infra/city/building-roof-1.svg', isPark: false, label: 'Pasar Buku Wilis', denseTrees: true },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: false, label: 'Sentra Kuliner & Kafe', denseTrees: true },
      ];
    default:
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/building-tower-glass.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/helipad-roof.svg', isPark: false },
        { sx: 1, sy: -1, primary: '/assets/infra/city/park-plaza.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: true },
        { sx: -1, sy: 1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-roof-3.svg', isPark: false },
        { sx: 1, sy: 1, primary: '/assets/infra/city/building-roof-1.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: false },
      ];
  }
}

// =============================================================================
// Main Builder Entry Point
// =============================================================================

/**
 * Builds stylized Indonesian low-poly 3D landmarks, roadside foliage, emissive
 * streetlights, and optional 10m blueprint grid for the active intersection scene.
 */
export function buildCityLandmarks3D(
  config: SimConfig,
  compiledTopology: CompiledTopology,
  showGrid: boolean
): CityLandmarks3DResult {
  const pool = createAssetPool();
  const root = new THREE.Group();
  root.name = 'city-landmarks-3d';

  const lampEmissiveMat = pool.stdMat('streetlight-lamp-head', 0xfef3c7, {
    roughness: 0.3,
    metalness: 0.1,
    emissive: 0xffb347,
    emissiveIntensity: 0.18,
  });
  const streetLampEmissives: THREE.MeshStandardMaterial[] = [lampEmissiveMat];
  const landmarkBounds: BoxBounds2D[] = [];

  const placeStreetlight = (x2D: number, y2D: number, dirToRoadX: number, dirToRoadY: number) => {
    const lamp = buildStreetlight(pool, lampEmissiveMat);
    lamp.position.set(x2D, 0, y2D);
    lamp.rotation.y = Math.atan2(-dirToRoadY, dirToRoadX);
    root.add(lamp);
  };

  const placeTree = (x2D: number, y2D: number, isPalm: boolean, scale: number, seed: number) => {
    const tree = isPalm
      ? buildPalmTree(pool, scale, seed)
      : buildShadeTree(pool, scale, seed);
    tree.position.set(x2D, 0, y2D);
    root.add(tree);
  };

  const isCustomTopo = Boolean(config.customTopology && compiledTopology);
  const envKey = resolveEnvironmentKey(config);

  if (isCustomTopo) {
    // 1A. Custom / N-Arm / Giwangan Topology Landmarks
    const explicitLandmarks: LandmarkItem[] = compiledTopology.topology.landmarks ?? [];
    for (let i = 0; i < explicitLandmarks.length; i++) {
      const lm = explicitLandmarks[i];
      const built = buildLandmarkInstance(
        pool,
        lm.assetKey,
        lm.width,
        lm.height,
        lm.x,
        lm.y,
        lm.rotationRad || 0,
        i + 1
      );
      root.add(built.mesh);
      landmarkBounds.push(built.bounds);
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

    // Sector trees + fallback sector buildings if no explicit landmarks
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
          const bx = ux * (minDist + 10);
          const by = uy * (minDist + 10);
          const built = buildLandmarkInstance(
            pool,
            fallbackAssets[i % fallbackAssets.length],
            21,
            15,
            bx,
            by,
            midAngle + Math.PI * 0.25,
            i + 3
          );
          root.add(built.mesh);
          landmarkBounds.push(built.bounds);
        }

        const treeOffsets = [minDist - 5, minDist + 22, minDist + 46];
        for (let tIdx = 0; tIdx < treeOffsets.length; tIdx++) {
          const r = treeOffsets[tIdx];
          const tx = ux * r + (tIdx % 2 === 0 ? -uy : uy) * 6;
          const ty = uy * r + (tIdx % 2 === 0 ? ux : -ux) * 6;
          if (
            !isInsideLandmarkBounds(tx, ty, landmarkBounds) &&
            !isInsideCustomRoadway(tx, ty, compiledTopology)
          ) {
            placeTree(tx, ty, tIdx === 1, 1.0 + (tIdx % 2) * 0.14, i * 7 + tIdx);
          }
        }
      }
    }

    // Arm streetlights along inbound & outbound sidewalks
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
        // Inbound outer sidewalk lamp
        const ix = arm.outDir.x * dist + arm.inLeftNormal.x * inLat;
        const iy = arm.outDir.y * dist + arm.inLeftNormal.y * inLat;
        if (!isInsideLandmarkBounds(ix, iy, landmarkBounds) && !isInsideCustomRoadway(ix, iy, compiledTopology)) {
          placeStreetlight(ix, iy, -arm.inLeftNormal.x, -arm.inLeftNormal.y);
        }
        // Outbound outer sidewalk lamp
        const ox = arm.outDir.x * dist - arm.inLeftNormal.x * outLat;
        const oy = arm.outDir.y * dist - arm.inLeftNormal.y * outLat;
        if (!isInsideLandmarkBounds(ox, oy, landmarkBounds) && !isInsideCustomRoadway(ox, oy, compiledTopology)) {
          placeStreetlight(ox, oy, arm.inLeftNormal.x, arm.inLeftNormal.y);
        }
      }
    }
  } else {
    // 1B. Standard 4-Arm Quadrant Landmarks, Foliage & Streetlights
    const halfRoad = getEffectiveRoadWidth(config);
    const sidewalkW = 3.4;
    const corners = getEnvironmentCorners(envKey);
    const bSize = Math.min(26, Math.max(14, config.roadLength * 0.32));
    const sSize = bSize * 0.85;

    for (let cIdx = 0; cIdx < corners.length; cIdx++) {
      const c = corners[cIdx];
      const bx = c.sx * (halfRoad + sidewalkW);
      const by = c.sy * (halfRoad + sidewalkW);

      // Primary landmark
      const pX = c.sx < 0 ? bx - 5.5 - bSize : bx + 5.5;
      const pY = c.sy < 0 ? by - 5.5 - bSize : by + 5.5;
      const primaryBuilt = buildLandmarkInstance(
        pool,
        c.primary,
        bSize,
        bSize,
        pX + bSize * 0.5,
        pY + bSize * 0.5,
        0,
        cIdx + 1
      );
      root.add(primaryBuilt.mesh);
      landmarkBounds.push(primaryBuilt.bounds);

      // Secondary & tertiary buildings when roadLength >= 55
      if (config.roadLength >= 55) {
        const sX = c.sx < 0 ? bx - 5.5 - bSize - sSize - 4 : bx + 5.5 + bSize + 4;
        const sY = c.sy < 0 ? by - 5.5 - sSize : by + 5.5;
        const secBuilt = buildLandmarkInstance(
          pool,
          c.secondary,
          sSize,
          sSize,
          sX + sSize * 0.5,
          sY + sSize * 0.5,
          0,
          cIdx + 5
        );
        root.add(secBuilt.mesh);
        landmarkBounds.push(secBuilt.bounds);

        const tLabelOffset = c.label ? 4.8 : 0;
        const tX = c.sx < 0 ? bx - 5.5 - sSize : bx + 5.5;
        const tY = c.sy < 0 ? by - 5.5 - bSize - sSize - 4 - tLabelOffset : by + 5.5 + bSize + 4 + tLabelOffset;
        const terBuilt = buildLandmarkInstance(
          pool,
          c.tertiary,
          sSize,
          sSize,
          tX + sSize * 0.5,
          tY + sSize * 0.5,
          0,
          cIdx + 9
        );
        root.add(terBuilt.mesh);
        landmarkBounds.push(terBuilt.bounds);
      }

      // Planter box along vertical avenue edge
      const planterBuilt = buildLandmarkInstance(
        pool,
        'planter-box-long',
        9,
        2.4,
        bx + c.sx * 1.4,
        by + c.sy * 20,
        Math.PI * 0.5,
        cIdx
      );
      root.add(planterBuilt.mesh);

      // Halte Bus / TMB Shelter on Laswi or diagonal corners
      if (config.roadLength >= 65 && (c.sx * c.sy > 0 || envKey === 'laswi-bandung')) {
        const shelterRot = c.sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
        const shelterBuilt = buildLandmarkInstance(
          pool,
          'bus-shelter-top',
          6.4,
          2.8,
          bx + c.sx * -1.6,
          by + c.sy * 28,
          shelterRot,
          cIdx + 13
        );
        root.add(shelterBuilt.mesh);
      }

      // Streetlights matching 2D coordinates + extra downstream lamps on long avenues
      placeStreetlight(bx + c.sx * -1.4, by + c.sy * 16, -c.sx, 0);
      placeStreetlight(bx + c.sx * 16, by + c.sy * -1.4, 0, -c.sy);
      if (config.roadLength >= 75) {
        placeStreetlight(bx + c.sx * -1.4, by + c.sy * 44, -c.sx, 0);
        placeStreetlight(bx + c.sx * 44, by + c.sy * -1.4, 0, -c.sy);
      }
      if (config.roadLength >= 105) {
        placeStreetlight(bx + c.sx * -1.4, by + c.sy * 72, -c.sx, 0);
        placeStreetlight(bx + c.sx * 72, by + c.sy * -1.4, 0, -c.sy);
      }

      // Tropical shade trees & palm trees along corners and avenues
      const preferShade = c.sx * c.sy > 0 || Boolean(c.denseTrees);
      placeTree(bx + c.sx * 1.3, by + c.sy * 10, !preferShade, 1.05, cIdx * 3);
      placeTree(bx + c.sx * 10, by + c.sy * 1.3, !preferShade, 1.0, cIdx * 3 + 1);
      placeTree(bx + c.sx * 1.3, by + c.sy * 24, false, 1.12, cIdx * 5 + 1);

      if (c.denseTrees) {
        placeTree(bx + c.sx * 24, by + c.sy * 1.3, false, 1.1, cIdx * 5 + 2);
        placeTree(bx + c.sx * 1.3, by + c.sy * 32, false, 0.96, cIdx * 7 + 1);
        placeTree(bx + c.sx * 32, by + c.sy * 1.3, false, 1.04, cIdx * 7 + 2);
        // Additional lush inner-grove shade trees outside building footprints
        const groveCandidates: Array<[number, number]> = [
          [bx + c.sx * (bSize + 10), by + c.sy * (bSize + 10)],
          [bx + c.sx * 4.2, by + c.sy * (bSize + 11)],
        ];
        for (let gIdx = 0; gIdx < groveCandidates.length; gIdx++) {
          const [gx, gy] = groveCandidates[gIdx];
          if (!isInsideLandmarkBounds(gx, gy, landmarkBounds)) {
            placeTree(gx, gy, false, 1.15, cIdx * 11 + gIdx);
          }
        }
      }

      if (config.roadLength >= 90) {
        placeTree(bx + c.sx * 1.3, by + c.sy * 38, !preferShade, 1.08, cIdx * 9 + 1);
        placeTree(bx + c.sx * 38, by + c.sy * 1.3, !preferShade, 1.06, cIdx * 9 + 2);
      }
    }
  }

  // 4. Optional 10m Blueprint Grid at y = 0.015m
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
      pool.regMat(gm);
    }
    pool.regGeo(grid.geometry);
    root.add(grid);
  }

  const dispose = () => {
    root.clear();
    for (const g of pool.geometries) {
      g.dispose();
    }
    for (const m of pool.materials) {
      m.dispose();
    }
    pool.geometries.clear();
    pool.materials.clear();
    pool.matCache.clear();
  };

  return {
    group: root,
    streetLampEmissives,
    dispose,
  };
}
