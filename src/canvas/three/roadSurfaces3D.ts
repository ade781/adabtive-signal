import * as THREE from 'three';
import { getEffectiveRoadWidth } from '../../engine/geometry';
import { MapBehavioralContext, resolveMapContext } from '../../engine/mapContextAI';
import { CompiledArmGeometry, CompiledTopology, IslandPolygon } from '../../engine/topologyTypes';
import { Point2D, SimConfig } from '../../engine/types';

export interface SignalPolePosition3D {
  armId: string;
  x: number;
  z: number;
  angleRad: number;
  outZ: number;
}

export interface RoadSurfaces3DResult {
  group: THREE.Group;
  sigPositions: SignalPolePosition3D[];
  extentMeters: number;
  dispose: () => void;
}

interface CornerSpec {
  sx: -1 | 1;
  sy: -1 | 1;
  isPark: boolean;
  riverEdge?: boolean;
  denseTrees?: boolean;
}

interface ShrubSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
}

interface RiverConfig {
  active: boolean;
  riverX: number;
  riverW: number;
  bankWallW: number;
}

interface ResourceTracker {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  trackGeom: <T extends THREE.BufferGeometry>(g: T) => T;
  trackMat: <T extends THREE.Material>(m: T) => T;
  trackTex: <T extends THREE.Texture>(t: T) => T;
}

const ELEV = {
  riverBed: -0.45,
  riverWater: -0.18,
  riverShore: -0.175,
  ground: 0.0,
  grassPlot: 0.008,
  soilStrip: 0.012,
  yardBorder: 0.015,
  yard: 0.018,
  asphaltApron: 0.028,
  asphalt: 0.03,
  centerBox: 0.032,
  markingFill: 0.043,
  markingLine: 0.045,
  markingTop: 0.047,
  sidewalkHeight: 0.16,
  sidewalkMarking: 0.164,
  sidewalkBadge: 0.166,
  curbHeight: 0.18,
  curbHighlight: 0.183,
  islandGreenHeight: 0.195,
  medianHeight: 0.2,
  medianGrassHeight: 0.22,
} as const;

function createTracker(): ResourceTracker {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  return {
    geometries,
    materials,
    textures,
    trackGeom: <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    },
    trackMat: <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    },
    trackTex: <T extends THREE.Texture>(t: T): T => {
      textures.push(t);
      return t;
    },
  };
}

function resolveEnvironmentKey(config: SimConfig, compiledTopology?: CompiledTopology): string {
  const candidates = [
    config.environmentId && config.environmentId !== 'default' ? config.environmentId : '',
    config.scenarioName ?? '',
    compiledTopology?.topology.id ?? '',
    compiledTopology?.topology.name ?? '',
  ];
  for (const raw of candidates) {
    const s = raw.toLowerCase();
    if (!s || s === 'default') continue;
    if (s === 'giwangan-yogya' || s.includes('giwangan')) return 'giwangan-yogya';
    if (s === 'brimob-yogya' || s.includes('brimob')) return 'brimob-yogya';
    if (s === 'lamper-semarang' || s.includes('lamper')) return 'lamper-semarang';
    if (s === 'sulawesi-banjarmasin' || s.includes('sulawesi') || s.includes('banjarmasin')) {
      return 'sulawesi-banjarmasin';
    }
    if (s === 'laswi-bandung' || s.includes('laswi')) return 'laswi-bandung';
    if (s === 'bondowoso-malang' || s.includes('bondowoso') || s.includes('retawu')) {
      return 'bondowoso-malang';
    }
  }
  return 'default';
}

function getEnvironmentCorners(envKey: string): CornerSpec[] {
  switch (envKey) {
    case 'brimob-yogya':
      return [
        { sx: -1, sy: -1, isPark: false },
        { sx: 1, sy: -1, isPark: false },
        { sx: -1, sy: 1, isPark: false },
        { sx: 1, sy: 1, isPark: true, denseTrees: true },
      ];
    case 'lamper-semarang':
      return [
        { sx: -1, sy: -1, isPark: false },
        { sx: 1, sy: -1, isPark: false },
        { sx: -1, sy: 1, isPark: false },
        { sx: 1, sy: 1, isPark: false },
      ];
    case 'sulawesi-banjarmasin':
      return [
        { sx: -1, sy: -1, isPark: false },
        { sx: 1, sy: -1, isPark: true, riverEdge: true },
        { sx: -1, sy: 1, isPark: false },
        { sx: 1, sy: 1, isPark: false, riverEdge: true },
      ];
    case 'laswi-bandung':
      return [
        { sx: -1, sy: -1, isPark: false },
        { sx: 1, sy: -1, isPark: false },
        { sx: -1, sy: 1, isPark: false },
        { sx: 1, sy: 1, isPark: false },
      ];
    case 'bondowoso-malang':
      return [
        { sx: -1, sy: -1, isPark: false, denseTrees: true },
        { sx: 1, sy: -1, isPark: true, denseTrees: true },
        { sx: -1, sy: 1, isPark: false, denseTrees: true },
        { sx: 1, sy: 1, isPark: false, denseTrees: true },
      ];
    default:
      return [
        { sx: -1, sy: -1, isPark: false },
        { sx: 1, sy: -1, isPark: true },
        { sx: -1, sy: 1, isPark: false },
        { sx: 1, sy: 1, isPark: false },
      ];
  }
}

function getCautionZoneLabel(envId: string): string {
  if (envId === 'bondowoso-malang') return 'ZONA KAMPUS';
  if (envId === 'lamper-semarang') return 'ZONA RS';
  return 'ZONA TERTIB';
}

function normalizeAngle0To2Pi(rad: number): number {
  const twoPi = Math.PI * 2;
  const m = rad % twoPi;
  return m < 0 ? m + twoPi : m;
}

function dedupePoints(pts: Point2D[], minDist = 1e-3): Point2D[] {
  const out: Point2D[] = [];
  for (const pt of pts) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= minDist) {
      out.push(pt);
    }
  }
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < minDist) {
      out.pop();
    }
  }
  return out;
}

function signedPolygonArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function intersectLines2D(
  p1: Point2D,
  d1: Point2D,
  p2: Point2D,
  d2: Point2D
): { pt: Point2D; t: number; u: number } | null {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-4) return null;
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const t = (rx * d2.y - ry * d2.x) / denom;
  const u = (rx * d1.y - ry * d1.x) / denom;
  return {
    pt: { x: p1.x + t * d1.x, y: p1.y + t * d1.y },
    t,
    u,
  };
}

function buildArcPoints(cx: number, cy: number, r: number, a0: number, a1: number, steps = 8): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function makeRoundedRectPoints(cx: number, cy: number, w: number, h: number, radius: number): Point2D[] {
  const r = Math.max(0, Math.min(radius, w * 0.49, h * 0.49));
  const x0 = cx - w * 0.5;
  const x1 = cx + w * 0.5;
  const y0 = cy - h * 0.5;
  const y1 = cy + h * 0.5;
  if (r < 0.02) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }
  return dedupePoints([
    ...buildArcPoints(x1 - r, y0 + r, r, -Math.PI / 2, 0, 5),
    ...buildArcPoints(x1 - r, y1 - r, r, 0, Math.PI / 2, 5),
    ...buildArcPoints(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, 5),
    ...buildArcPoints(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, 5),
  ]);
}

/**
 * Converts 2D engine points (+X East, +Y South) into a THREE.Shape whose
 * rotateX(-PI/2) mapping lands cleanly at (pt.x, Y_up, pt.y).
 */
function pointsToShape(pts: Point2D[]): THREE.Shape | null {
  const clean = dedupePoints(pts);
  if (clean.length < 3 || Math.abs(signedPolygonArea(clean)) < 1e-4) return null;
  const shape = new THREE.Shape();
  shape.moveTo(clean[0].x, -clean[0].y);
  for (let i = 1; i < clean.length; i++) {
    shape.lineTo(clean[i].x, -clean[i].y);
  }
  shape.closePath();
  return shape;
}

function buildFlatPolygonGeometry(
  pts: Point2D[],
  y: number,
  tracker: ResourceTracker
): THREE.BufferGeometry | null {
  const shape = pointsToShape(pts);
  if (!shape) return null;
  const geom = new THREE.ShapeGeometry(shape, 12);
  geom.rotateX(-Math.PI / 2);
  if (y !== 0) geom.translate(0, y, 0);
  return tracker.trackGeom(geom);
}

function buildExtrudedPolygonGeometry(
  pts: Point2D[],
  height: number,
  yBase: number,
  tracker: ResourceTracker
): THREE.BufferGeometry | null {
  const shape = pointsToShape(pts);
  if (!shape) return null;
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geom.rotateX(-Math.PI / 2);
  if (yBase !== 0) geom.translate(0, yBase, 0);
  return tracker.trackGeom(geom);
}

/**
 * Builds a flat 2D ribbon mesh along a polyline in XZ (Y = y) with linear arc-length UVs.
 * Outward normal & vertex order strictly produce +Y upward normals.
 */
function buildFlatRibbonGeometry(
  rawPts: Point2D[],
  width: number,
  y: number,
  uPeriodMeters: number,
  tracker: ResourceTracker
): THREE.BufferGeometry | null {
  const pts = dedupePoints(rawPts, 1e-3);
  if (pts.length < 2) return null;

  const hw = width * 0.5;
  const n = pts.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  let cumS = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      cumS += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.y - prev.y;
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;

    // Miter normal in XZ: right-side normal N = (-tz, tx)
    let nx = -tz;
    let nz = tx;
    let miterScale = 1;
    if (i > 0 && i < n - 1) {
      const dx1 = pts[i].x - pts[i - 1].x;
      const dz1 = pts[i].y - pts[i - 1].y;
      const l1 = Math.hypot(dx1, dz1) || 1;
      const n1x = -dz1 / l1;
      const n1z = dx1 / l1;
      const dot = nx * n1x + nz * n1z;
      if (dot > 0.35) {
        miterScale = Math.min(1.8, 1 / dot);
      }
    }

    const ox = nx * hw * miterScale;
    const oz = nz * hw * miterScale;
    const baseV = i * 2;

    // Left/inner vertex (P - N*hw)
    positions[baseV * 3] = pts[i].x - ox;
    positions[baseV * 3 + 1] = y;
    positions[baseV * 3 + 2] = pts[i].y - oz;
    normals[baseV * 3] = 0;
    normals[baseV * 3 + 1] = 1;
    normals[baseV * 3 + 2] = 0;
    uvs[baseV * 2] = cumS / uPeriodMeters;
    uvs[baseV * 2 + 1] = 0;

    // Right/outer vertex (P + N*hw)
    positions[(baseV + 1) * 3] = pts[i].x + ox;
    positions[(baseV + 1) * 3 + 1] = y;
    positions[(baseV + 1) * 3 + 2] = pts[i].y + oz;
    normals[(baseV + 1) * 3] = 0;
    normals[(baseV + 1) * 3 + 1] = 1;
    normals[(baseV + 1) * 3 + 2] = 0;
    uvs[(baseV + 1) * 2] = cumS / uPeriodMeters;
    uvs[(baseV + 1) * 2 + 1] = 1;

    if (i < n - 1) {
      const a = baseV;
      const b = baseV + 1;
      const c = baseV + 3;
      const d = baseV + 2;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return tracker.trackGeom(geom);
}

/**
 * Builds a 3D raised curb strip along a 2D polyline with exact outward normals and
 * arc-length UVs so alternating white/black kanstin blocks wrap smoothly around bends.
 */
function buildCurbStripGeometry(
  rawPts: Point2D[],
  width: number,
  height: number,
  yBase: number,
  uPeriodMeters: number,
  closed: boolean,
  tracker: ResourceTracker
): THREE.BufferGeometry | null {
  const clean = dedupePoints(rawPts, 1e-3);
  if (clean.length < (closed ? 3 : 2)) return null;

  const pts = closed ? [...clean, clean[0]] : clean;
  const segCount = pts.length - 1;
  const hw = width * 0.5;
  const yTop = yBase + height;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushVert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return idx;
  };

  // Precompute mitered cross-section inner/outer XZ vertices at each point
  const innerX = new Float64Array(pts.length);
  const innerZ = new Float64Array(pts.length);
  const outerX = new Float64Array(pts.length);
  const outerZ = new Float64Array(pts.length);
  const cumU = new Float64Array(pts.length);

  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      cumU[i] = cumU[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / uPeriodMeters;
    }

    const pPrev =
      i === 0 ? (closed ? pts[pts.length - 2] : pts[0]) : pts[i - 1];
    const pNext =
      i === pts.length - 1 ? (closed ? pts[1] : pts[pts.length - 1]) : pts[i + 1];

    let d1x = pts[i].x - pPrev.x;
    let d1z = pts[i].y - pPrev.y;
    const l1 = Math.hypot(d1x, d1z);
    if (l1 > 1e-6) {
      d1x /= l1;
      d1z /= l1;
    }

    let d2x = pNext.x - pts[i].x;
    let d2z = pNext.y - pts[i].y;
    const l2 = Math.hypot(d2x, d2z);
    if (l2 > 1e-6) {
      d2x /= l2;
      d2z /= l2;
    }

    let nx: number;
    let nz: number;
    let scale = 1;
    if (l1 > 1e-6 && l2 > 1e-6) {
      const n1x = -d1z;
      const n1z = d1x;
      const n2x = -d2z;
      const n2z = d2x;
      let mx = n1x + n2x;
      let mz = n1z + n2z;
      const mLen = Math.hypot(mx, mz);
      if (mLen > 1e-4) {
        mx /= mLen;
        mz /= mLen;
        const dot = mx * n1x + mz * n1z;
        scale = dot > 0.35 ? Math.min(2.0, 1 / dot) : 1;
        nx = mx;
        nz = mz;
      } else {
        nx = n1x;
        nz = n1z;
      }
    } else if (l2 > 1e-6) {
      nx = -d2z;
      nz = d2x;
    } else {
      nx = -d1z;
      nz = d1x;
    }

    innerX[i] = pts[i].x - nx * hw * scale;
    innerZ[i] = pts[i].y - nz * hw * scale;
    outerX[i] = pts[i].x + nx * hw * scale;
    outerZ[i] = pts[i].y + nz * hw * scale;
  }

  for (let i = 0; i < segCount; i++) {
    const ax0 = innerX[i];
    const az0 = innerZ[i];
    const bx0 = outerX[i];
    const bz0 = outerZ[i];
    const dx0 = innerX[i + 1];
    const dz0 = innerZ[i + 1];
    const cx0 = outerX[i + 1];
    const cz0 = outerZ[i + 1];

    const u0 = cumU[i];
    const u1 = cumU[i + 1];

    const segDx = pts[i + 1].x - pts[i].x;
    const segDz = pts[i + 1].y - pts[i].y;
    const segLen = Math.hypot(segDx, segDz) || 1;
    const snx = -segDz / segLen;
    const snz = segDx / segLen;

    // Top face (+Y)
    const tA = pushVert(ax0, yTop, az0, 0, 1, 0, u0, 0.25);
    const tB = pushVert(bx0, yTop, bz0, 0, 1, 0, u0, 0.75);
    const tC = pushVert(cx0, yTop, cz0, 0, 1, 0, u1, 0.75);
    const tD = pushVert(dx0, yTop, dz0, 0, 1, 0, u1, 0.25);
    indices.push(tA, tB, tD, tB, tC, tD);

    // Outer face (+N)
    const oB0 = pushVert(bx0, yBase, bz0, snx, 0, snz, u0, 0.95);
    const oC0 = pushVert(cx0, yBase, cz0, snx, 0, snz, u1, 0.95);
    const oB1 = pushVert(bx0, yTop, bz0, snx, 0, snz, u0, 0.05);
    const oC1 = pushVert(cx0, yTop, cz0, snx, 0, snz, u1, 0.05);
    indices.push(oB0, oC0, oB1, oC0, oC1, oB1);

    // Inner face (-N)
    const iA0 = pushVert(ax0, yBase, az0, -snx, 0, -snz, u0, 0.95);
    const iD0 = pushVert(dx0, yBase, dz0, -snx, 0, -snz, u1, 0.95);
    const iA1 = pushVert(ax0, yTop, az0, -snx, 0, -snz, u0, 0.05);
    const iD1 = pushVert(dx0, yTop, dz0, -snx, 0, -snz, u1, 0.05);
    indices.push(iA0, iA1, iD0, iD0, iA1, iD1);
  }

  if (!closed) {
    const sDx = pts[1].x - pts[0].x;
    const sDz = pts[1].y - pts[0].y;
    const sLen = Math.hypot(sDx, sDz) || 1;
    const stx = sDx / sLen;
    const stz = sDz / sLen;

    const sA0 = pushVert(innerX[0], yBase, innerZ[0], -stx, 0, -stz, 0, 0);
    const sB0 = pushVert(outerX[0], yBase, outerZ[0], -stx, 0, -stz, 0, 1);
    const sA1 = pushVert(innerX[0], yTop, innerZ[0], -stx, 0, -stz, 0, 0);
    const sB1 = pushVert(outerX[0], yTop, outerZ[0], -stx, 0, -stz, 0, 1);
    indices.push(sA0, sB0, sA1, sB0, sB1, sA1);

    const last = pts.length - 1;
    const eDx = pts[last].x - pts[last - 1].x;
    const eDz = pts[last].y - pts[last - 1].y;
    const eLen = Math.hypot(eDx, eDz) || 1;
    const etx = eDx / eLen;
    const etz = eDz / eLen;

    const eD0 = pushVert(innerX[last], yBase, innerZ[last], etx, 0, etz, cumU[last], 0);
    const eC0 = pushVert(outerX[last], yBase, outerZ[last], etx, 0, etz, cumU[last], 1);
    const eD1 = pushVert(innerX[last], yTop, innerZ[last], etx, 0, etz, cumU[last], 0);
    const eC1 = pushVert(outerX[last], yTop, outerZ[last], etx, 0, etz, cumU[last], 1);
    indices.push(eC0, eD0, eC1, eD0, eD1, eC1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return tracker.trackGeom(geom);
}

function buildLaneArrowGeometry(mode: 'straight' | 'left' | 'right', tracker: ResourceTracker): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // 2D points (ax, ay) mapped via (ax, -ay) so rotateX(-PI/2) aims tip along -Z
  const stem: Point2D[] = [
    { x: 0, y: -1.2 },
    { x: 0.48, y: -0.35 },
    { x: 0.18, y: -0.35 },
    { x: 0.18, y: 1.1 },
    { x: -0.18, y: 1.1 },
    { x: -0.18, y: -0.35 },
    { x: -0.48, y: -0.35 },
  ];
  shape.moveTo(stem[0].x, -stem[0].y);
  for (let i = 1; i < stem.length; i++) shape.lineTo(stem[i].x, -stem[i].y);
  shape.closePath();

  const shapes: THREE.Shape[] = [shape];
  if (mode !== 'straight') {
    const s = mode === 'left' ? -1 : 1;
    const branch = new THREE.Shape();
    const bPts: Point2D[] = [
      { x: s * 0.18, y: 0.2 },
      { x: s * 0.75, y: 0.2 },
      { x: s * 0.75, y: 0.48 },
      { x: s * 1.25, y: 0.05 },
      { x: s * 0.75, y: -0.38 },
      { x: s * 0.75, y: -0.1 },
      { x: s * 0.18, y: -0.1 },
    ];
    branch.moveTo(bPts[0].x, -bPts[0].y);
    for (let i = 1; i < bPts.length; i++) branch.lineTo(bPts[i].x, -bPts[i].y);
    branch.closePath();
    shapes.push(branch);
  }

  const geom = new THREE.ShapeGeometry(shapes, 4);
  geom.rotateX(-Math.PI / 2);
  return tracker.trackGeom(geom);
}

function makeFallbackTex(tracker: ResourceTracker, r = 255, g = 255, b = 255, a = 255): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tracker.trackTex(tex);
}

function makeKanstinTexture(tracker: ResourceTracker): THREE.Texture {
  if (typeof document === 'undefined') return makeFallbackTex(tracker, 248, 250, 252, 255);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(128, 0, 128, 32);

    // Subtle concrete block seams & bevel shading
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.fillRect(0, 0, 256, 3);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.fillRect(0, 28, 256, 4);
    ctx.fillRect(126, 0, 3, 32);
    ctx.fillRect(253, 0, 3, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tracker.trackTex(tex);
}

function makeDashedLineTexture(
  color: string,
  dashRatio: number,
  tracker: ResourceTracker
): THREE.Texture {
  if (typeof document === 'undefined') return makeFallbackTex(tracker, 255, 255, 255, 255);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 16);
    const dashW = Math.max(4, Math.round(128 * dashRatio));
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, dashW, 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tracker.trackTex(tex);
}

function makeAsphaltGrainTexture(tracker: ResourceTracker): THREE.Texture {
  if (typeof document === 'undefined') return makeFallbackTex(tracker, 240, 240, 240, 255);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#EFEFEF';
    ctx.fillRect(0, 0, 128, 128);
    // Deterministic subtle aggregate speckle
    let seed = 1337;
    const nextRand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(nextRand() * 128);
      const y = Math.floor(nextRand() * 128);
      const shade = 224 + Math.floor(nextRand() * 31);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.22, 0.22);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tracker.trackTex(tex);
}

function makeKonblokTexture(tracker: ResourceTracker): THREE.Texture {
  if (typeof document === 'undefined') return makeFallbackTex(tracker, 247, 246, 243, 255);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#F7F6F3';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(120, 113, 108, 0.22)';
    ctx.lineWidth = 2;
    for (let y = 0; y < 128; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
      const offset = (y / 32) % 2 === 0 ? 0 : 32;
      for (let x = offset; x < 128; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 32);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.55, 0.55);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tracker.trackTex(tex);
}

function makeDiagonalStripeTexture(
  colorA: string,
  colorB: string,
  repeatPerMeter: number,
  tracker: ResourceTracker
): THREE.Texture {
  if (typeof document === 'undefined') return makeFallbackTex(tracker, 245, 158, 11, 255);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = colorA;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = colorB;
    ctx.lineWidth = 28;
    for (let x = -128; x <= 256; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 128, 0);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatPerMeter, repeatPerMeter);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tracker.trackTex(tex);
}

function makeTextBadgeTexture(
  text: string,
  opts: {
    widthPx?: number;
    heightPx?: number;
    bgColor?: string;
    borderColor?: string;
    textColor: string;
    font: string;
    rhkIcon?: boolean;
    ltorArrow?: boolean;
  },
  tracker: ResourceTracker
): THREE.Texture {
  if (typeof document === 'undefined') return makeFallbackTex(tracker, 255, 255, 255, 200);
  const w = opts.widthPx ?? 256;
  const h = opts.heightPx ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    if (opts.bgColor) {
      ctx.fillStyle = opts.bgColor;
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, 16);
      ctx.fill();
    }
    if (opts.borderColor) {
      ctx.strokeStyle = opts.borderColor;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, 16);
      ctx.stroke();
    }
    if (opts.rhkIcon) {
      ctx.fillStyle = opts.textColor;
      ctx.fillRect(w * 0.5 - 24, h * 0.22, 48, 10);
      ctx.fillRect(w * 0.5 - 8, h * 0.22, 16, 42);
    }
    if (opts.ltorArrow) {
      ctx.strokeStyle = opts.textColor;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.62, h * 0.44);
      ctx.lineTo(w * 0.62, h * 0.28);
      ctx.quadraticCurveTo(w * 0.62, h * 0.2, w * 0.36, h * 0.2);
      ctx.stroke();
      ctx.fillStyle = opts.textColor;
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.2);
      ctx.lineTo(w * 0.42, h * 0.12);
      ctx.lineTo(w * 0.42, h * 0.28);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = opts.textColor;
    ctx.font = opts.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textY = opts.rhkIcon ? h * 0.72 : opts.ltorArrow ? h * 0.72 : h * 0.52;
    ctx.fillText(text, w * 0.5, textY);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tracker.trackTex(tex);
}

interface MaterialBank {
  ground: THREE.MeshStandardMaterial;
  grassPark: THREE.MeshStandardMaterial;
  grassPlot: THREE.MeshStandardMaterial;
  soilStrip: THREE.MeshStandardMaterial;
  yard: THREE.MeshStandardMaterial;
  yardBorder: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  asphaltCenter: THREE.MeshStandardMaterial;
  kanstin: THREE.MeshStandardMaterial;
  kanstinIsland: THREE.MeshStandardMaterial;
  medianConcrete: THREE.MeshStandardMaterial;
  medianConcreteBorder: THREE.MeshStandardMaterial;
  medianGrass: THREE.MeshStandardMaterial;
  shrubDark: THREE.MeshStandardMaterial;
  shrubLight: THREE.MeshStandardMaterial;
  whiteSolid: THREE.MeshStandardMaterial;
  whiteDash: THREE.MeshStandardMaterial;
  yellowSolid: THREE.MeshStandardMaterial;
  yellowDash: THREE.MeshStandardMaterial;
  yellowDashTight: THREE.MeshStandardMaterial;
  yellowBoxFill: THREE.MeshStandardMaterial;
  yellowBoxLine: THREE.MeshStandardMaterial;
  rhkFill: THREE.MeshStandardMaterial;
  rhkBorder: THREE.MeshStandardMaterial;
  emeraldDash: THREE.MeshStandardMaterial;
  slipGuideDash: THREE.MeshStandardMaterial;
  yieldWhiteDash: THREE.MeshStandardMaterial;
  paintedGore: THREE.MeshStandardMaterial;
  busBayFill: THREE.MeshStandardMaterial;
  busBayDash: THREE.MeshStandardMaterial;
  busBayCurb: THREE.MeshStandardMaterial;
  marketWash: THREE.MeshStandardMaterial;
  marketDash: THREE.MeshStandardMaterial;
  marketGuide: THREE.MeshStandardMaterial;
  cautionBase: THREE.MeshStandardMaterial;
  cautionStripes: THREE.MeshStandardMaterial;
  riverBed: THREE.MeshStandardMaterial;
  riverWater: THREE.MeshStandardMaterial;
  riverShore: THREE.MeshStandardMaterial;
  riverBank: THREE.MeshStandardMaterial;
  bridgeDeck: THREE.MeshStandardMaterial;
  bridgeRail: THREE.MeshStandardMaterial;
  kanstinTex: THREE.Texture;
}

function createMaterialBank(wetAsphalt: boolean, tracker: ResourceTracker): MaterialBank {
  const asphaltTex = makeAsphaltGrainTexture(tracker);
  const konblokTex = makeKonblokTexture(tracker);
  const kanstinTex = makeKanstinTexture(tracker);
  const whiteDashTex = makeDashedLineTexture('#F8FAFC', 1.6 / 3.4, tracker);
  const yellowDashTex = makeDashedLineTexture('#FBBF24', 2.4 / 4.6, tracker);
  const yellowDashTightTex = makeDashedLineTexture('#FBBF24', 0.8 / 1.5, tracker);
  const emeraldDashTex = makeDashedLineTexture('#10B981', 0.8 / 1.4, tracker);
  const slipDashTex = makeDashedLineTexture('#10B981', 1.1 / 2.4, tracker);
  const yieldDashTex = makeDashedLineTexture('#FFFFFF', 0.45 / 0.8, tracker);
  const busBayDashTex = makeDashedLineTexture('#F59E0B', 1.25 / 2.1, tracker);
  const marketDashTex = makeDashedLineTexture('#EA580C', 1.15 / 2.0, tracker);
  const marketGuideTex = makeDashedLineTexture('#F59E0B', 0.65 / 1.6, tracker);
  const goreStripeTex = makeDiagonalStripeTexture('rgba(250, 204, 21, 0.14)', 'rgba(250, 204, 21, 0.72)', 0.45, tracker);
  const cautionStripeTex = makeDiagonalStripeTexture('rgba(245, 158, 11, 0.82)', 'rgba(16, 185, 129, 0.82)', 0.8, tracker);

  const mkStd = (params: THREE.MeshStandardMaterialParameters) =>
    tracker.trackMat(new THREE.MeshStandardMaterial(params));

  const mkMarking = (params: THREE.MeshStandardMaterialParameters) =>
    tracker.trackMat(
      new THREE.MeshStandardMaterial({
        roughness: 0.75,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        ...params,
      })
    );

  return {
    kanstinTex,
    ground: mkStd({ color: '#B7C6A5', roughness: 0.95, metalness: 0.0 }),
    grassPark: mkStd({ color: '#7FA25E', roughness: 0.94, metalness: 0.0 }),
    grassPlot: mkStd({ color: '#89A669', roughness: 0.94, metalness: 0.0 }),
    soilStrip: mkStd({ color: '#A88F6B', roughness: 0.96, metalness: 0.0 }),
    yard: mkStd({ color: '#D7D2C7', roughness: 0.88, metalness: 0.02 }),
    yardBorder: mkStd({ color: '#B8B0A0', roughness: 0.9, metalness: 0.02 }),
    sidewalk: mkStd({ color: '#CFCBC2', map: konblokTex, roughness: 0.86, metalness: 0.02 }),
    asphalt: mkStd({
      color: wetAsphalt ? '#282E38' : '#373D47',
      map: asphaltTex,
      roughness: wetAsphalt ? 0.28 : 0.88,
      metalness: wetAsphalt ? 0.14 : 0.04,
    }),
    asphaltCenter: mkStd({
      color: wetAsphalt ? '#222730' : '#2F353E',
      map: asphaltTex,
      roughness: wetAsphalt ? 0.26 : 0.88,
      metalness: wetAsphalt ? 0.15 : 0.04,
    }),
    kanstin: mkStd({ map: kanstinTex, roughness: 0.78, metalness: 0.04 }),
    kanstinIsland: mkStd({ map: kanstinTex, roughness: 0.78, metalness: 0.04 }),
    medianConcrete: mkStd({ color: '#CBD5E1', roughness: 0.82, metalness: 0.04 }),
    medianConcreteBorder: mkStd({ color: '#94A3B8', roughness: 0.84, metalness: 0.04 }),
    medianGrass: mkStd({ color: '#22C55E', roughness: 0.9, metalness: 0.0 }),
    shrubDark: mkStd({ color: '#15803D', roughness: 0.88, metalness: 0.0 }),
    shrubLight: mkStd({ color: '#86EFAC', roughness: 0.85, metalness: 0.0 }),
    whiteSolid: mkMarking({ color: '#FFFFFF' }),
    whiteDash: mkMarking({ map: whiteDashTex, transparent: true, opacity: 0.64, alphaTest: 0.05 }),
    yellowSolid: mkMarking({ color: '#FBBF24' }),
    yellowDash: mkMarking({ map: yellowDashTex, transparent: true, opacity: 0.95, alphaTest: 0.05 }),
    yellowDashTight: mkMarking({ map: yellowDashTightTex, transparent: true, opacity: 0.82, alphaTest: 0.05 }),
    yellowBoxFill: mkMarking({ color: '#FACC15', transparent: true, opacity: 0.14, depthWrite: false }),
    yellowBoxLine: mkMarking({ color: '#FACC15', transparent: true, opacity: 0.86 }),
    rhkFill: mkMarking({ color: '#DC2626', transparent: true, opacity: 0.28, depthWrite: false }),
    rhkBorder: mkMarking({ color: '#FFFFFF', transparent: true, opacity: 0.88 }),
    emeraldDash: mkMarking({ map: emeraldDashTex, transparent: true, opacity: 0.72, alphaTest: 0.05 }),
    slipGuideDash: mkMarking({ map: slipDashTex, transparent: true, opacity: 0.64, alphaTest: 0.05 }),
    yieldWhiteDash: mkMarking({ map: yieldDashTex, transparent: true, opacity: 0.88, alphaTest: 0.05 }),
    paintedGore: mkMarking({ map: goreStripeTex, transparent: true, opacity: 0.92, depthWrite: false }),
    busBayFill: mkMarking({ color: '#6366F1', transparent: true, opacity: 0.2, depthWrite: false }),
    busBayDash: mkMarking({ map: busBayDashTex, transparent: true, opacity: 0.9, alphaTest: 0.05 }),
    busBayCurb: mkMarking({ color: '#6366F1', transparent: true, opacity: 0.88 }),
    marketWash: mkMarking({ color: '#C2410C', transparent: true, opacity: 0.2, depthWrite: false }),
    marketDash: mkMarking({ map: marketDashTex, transparent: true, opacity: 0.86, alphaTest: 0.05 }),
    marketGuide: mkMarking({ map: marketGuideTex, transparent: true, opacity: 0.78, alphaTest: 0.05 }),
    cautionBase: mkMarking({ color: '#0F172A', transparent: true, opacity: 0.08, depthWrite: false }),
    cautionStripes: mkMarking({ map: cautionStripeTex, transparent: true, opacity: 0.9, depthWrite: false }),
    riverBed: mkStd({ color: '#1E3A5F', roughness: 0.95, metalness: 0.0 }),
    riverWater: mkStd({
      color: '#0284C7',
      roughness: 0.14,
      metalness: 0.22,
      transparent: true,
      opacity: 0.88,
    }),
    riverShore: mkStd({
      color: '#38BDF8',
      roughness: 0.18,
      metalness: 0.15,
      transparent: true,
      opacity: 0.72,
    }),
    riverBank: mkStd({ color: '#94A3B8', roughness: 0.84, metalness: 0.05 }),
    bridgeDeck: mkStd({ color: '#64748B', roughness: 0.82, metalness: 0.08 }),
    bridgeRail: mkStd({ color: '#E2E8F0', roughness: 0.55, metalness: 0.28 }),
  };
}

function addBoxMesh(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  tracker: ResourceTracker,
  shadow: { cast?: boolean; receive?: boolean } = {}
): THREE.Mesh {
  const geom = tracker.trackGeom(new THREE.BoxGeometry(w, h, d));
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = Boolean(shadow.cast);
  mesh.receiveShadow = Boolean(shadow.receive);
  parent.add(mesh);
  return mesh;
}

function addPlaneXZMesh(
  parent: THREE.Object3D,
  w: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  tracker: ResourceTracker,
  receiveShadow = false
): THREE.Mesh {
  const geom = tracker.trackGeom(new THREE.PlaneGeometry(w, d));
  geom.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function addYellowBox3D(
  parent: THREE.Object3D,
  halfW: number,
  halfH: number,
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  const inset = 0.6;
  const w = Math.max(2, (halfW - inset) * 2);
  const h = Math.max(2, (halfH - inset) * 2);
  const x0 = -w * 0.5;
  const z0 = -h * 0.5;
  const lineW = 0.24;

  addPlaneXZMesh(parent, w, h, 0, ELEV.markingFill, 0, mats.yellowBoxFill, tracker);

  // Outer perimeter frame
  const perimeter: Point2D[] = [
    { x: x0, y: z0 },
    { x: x0 + w, y: z0 },
    { x: x0 + w, y: z0 + h },
    { x: x0, y: z0 + h },
    { x: x0, y: z0 },
  ];
  const frameGeom = buildFlatRibbonGeometry(perimeter, lineW, ELEV.markingLine, 1, tracker);
  if (frameGeom) parent.add(new THREE.Mesh(frameGeom, mats.yellowBoxLine));

  // Diagonal criss-cross lines
  const diag1 = buildFlatRibbonGeometry(
    [
      { x: x0, y: z0 },
      { x: x0 + w, y: z0 + h },
    ],
    lineW,
    ELEV.markingTop,
    1,
    tracker
  );
  if (diag1) parent.add(new THREE.Mesh(diag1, mats.yellowBoxLine));

  const diag2 = buildFlatRibbonGeometry(
    [
      { x: x0 + w, y: z0 },
      { x: x0, y: z0 + h },
    ],
    lineW,
    ELEV.markingTop,
    1,
    tracker
  );
  if (diag2) parent.add(new THREE.Mesh(diag2, mats.yellowBoxLine));
}

function addRhkBox3D(
  parent: THREE.Object3D,
  rx: number,
  rz: number,
  depthX: number,
  widthZ: number,
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  if (depthX < 0.5 || widthZ < 0.5) return;
  const cx = rx + depthX * 0.5;
  const cz = rz + widthZ * 0.5;
  addPlaneXZMesh(parent, depthX, widthZ, cx, ELEV.markingFill, cz, mats.rhkFill, tracker);

  const framePts: Point2D[] = [
    { x: rx, y: rz },
    { x: rx + depthX, y: rz },
    { x: rx + depthX, y: rz + widthZ },
    { x: rx, y: rz + widthZ },
    { x: rx, y: rz },
  ];
  const frameGeom = buildFlatRibbonGeometry(framePts, 0.16, ELEV.markingLine, 1, tracker);
  if (frameGeom) parent.add(new THREE.Mesh(frameGeom, mats.rhkBorder));

  const tex = makeTextBadgeTexture(
    'RHK',
    {
      widthPx: 256,
      heightPx: 256,
      textColor: 'rgba(255,255,255,0.85)',
      font: '700 68px "JetBrains Mono", monospace',
      rhkIcon: true,
    },
    tracker
  );
  const decalMat = tracker.trackMat(
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.75,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  const size = Math.min(3.2, depthX * 0.78, widthZ * 0.82);
  const mesh = addPlaneXZMesh(parent, size, size, cx, ELEV.markingTop, cz, decalMat, tracker);
  // Rotate so icon & RHK text face inbound driver moving along -X_local
  mesh.rotation.y = Math.PI / 2;
}

function addArmContextMarkings3D(
  armGroup: THREE.Group,
  p: {
    armId: string;
    armAngleRad: number;
    stopX: number;
    armEnd: number;
    curbZ: number;
    curbFlare?: number;
    slipSetback: number;
    mapCtx: MapBehavioralContext;
  },
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  const { armId, armAngleRad, stopX, armEnd, curbZ, curbFlare = 0, slipSetback, mapCtx } = p;
  if (mapCtx.id === 'default') return;

  const hasBusBay = mapCtx.busBayArms.includes(armId);
  const hasCaution = mapCtx.cautionArms.includes(armId);
  const hasMarket = mapCtx.marketArms.includes(armId);
  if (!hasBusBay && !hasCaution && !hasMarket) return;

  const safeUpstreamMin = slipSetback > 0 ? Math.max(22, slipSetback + 5) : 16;

  // Normalize angle to check upright orientation for painted text
  let norm = armAngleRad % (Math.PI * 2);
  if (norm > Math.PI) norm -= Math.PI * 2;
  if (norm <= -Math.PI) norm += Math.PI * 2;
  const flipText = norm > Math.PI / 2 || norm <= -Math.PI / 2;

  // 1. Bus Shelter / Terminal Bay Markings
  if (hasBusBay) {
    const x0 = stopX + safeUpstreamMin;
    const x1 = Math.min(armEnd - 2.5, x0 + 18);
    if (x1 - x0 >= 7) {
      const bayDepth = 1.15;
      const taper = 1.6;
      const zOuter = curbZ - 0.06;
      const zInner = curbZ - bayDepth;

      const bayPts: Point2D[] = [
        { x: x0, y: zOuter },
        { x: x0 + taper, y: zInner },
        { x: x1 - taper, y: zInner },
        { x: x1, y: zOuter },
      ];
      const bayGeom = buildFlatPolygonGeometry(bayPts, ELEV.markingFill, tracker);
      if (bayGeom) armGroup.add(new THREE.Mesh(bayGeom, mats.busBayFill));

      const dashGeom = buildFlatRibbonGeometry(bayPts, 0.22, ELEV.markingLine, 2.1, tracker);
      if (dashGeom) armGroup.add(new THREE.Mesh(dashGeom, mats.busBayDash));

      const curbBar = buildFlatRibbonGeometry(
        [
          { x: x0 + 0.5, y: zOuter - 0.04 },
          { x: x1 - 0.5, y: zOuter - 0.04 },
        ],
        0.16,
        ELEV.markingTop,
        1,
        tracker
      );
      if (curbBar) armGroup.add(new THREE.Mesh(curbBar, mats.busBayCurb));

      const halteTex = makeTextBadgeTexture(
        'HALTE / BUS',
        {
          widthPx: 384,
          heightPx: 64,
          textColor: 'rgba(254, 243, 199, 0.94)',
          font: '700 40px "JetBrains Mono", monospace',
        },
        tracker
      );
      const halteMat = tracker.trackMat(
        new THREE.MeshStandardMaterial({
          map: halteTex,
          transparent: true,
          roughness: 0.72,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      const labelMesh = addPlaneXZMesh(
        armGroup,
        7.5,
        1.1,
        (x0 + x1) * 0.5,
        ELEV.markingTop,
        (zInner + zOuter) * 0.5,
        halteMat,
        tracker
      );
      if (flipText) labelMesh.rotation.y = Math.PI;
    }
  }

  // 2. Market Friction Curb Edge
  if (hasMarket) {
    const x0 = stopX + (slipSetback > 0 ? Math.max(20, slipSetback + 4) : 12);
    const x1 = Math.min(armEnd - 2.5, x0 + 24);
    if (x1 - x0 >= 6) {
      const len = x1 - x0;
      addPlaneXZMesh(
        armGroup,
        len,
        0.54,
        x0 + len * 0.5,
        ELEV.markingFill,
        curbZ - 0.31,
        mats.marketWash,
        tracker
      );
      const dashGeom = buildFlatRibbonGeometry(
        [
          { x: x0, y: curbZ - 0.56 },
          { x: x1, y: curbZ - 0.56 },
        ],
        0.2,
        ELEV.markingLine,
        2.0,
        tracker
      );
      if (dashGeom) armGroup.add(new THREE.Mesh(dashGeom, mats.marketDash));

      const guideGeom = buildFlatRibbonGeometry(
        [
          { x: x0 + 0.4, y: curbZ - 0.14 },
          { x: x1 - 0.4, y: curbZ - 0.14 },
        ],
        0.12,
        ELEV.markingTop,
        1.6,
        tracker
      );
      if (guideGeom) armGroup.add(new THREE.Mesh(guideGeom, mats.marketGuide));
    }
  }

  // 3. Campus / Hospital / Enforcement Caution Sidewalk Accent
  if (hasCaution) {
    const x0 = stopX + (slipSetback > 0 ? Math.max(22, slipSetback + 5) : 14);
    const x1 = Math.min(armEnd - 2.5, x0 + 18);
    if (x1 - x0 >= 6) {
      const bandZ = curbZ + curbFlare * 0.55 + 0.46;
      const bandH = 0.74;
      const len = x1 - x0;
      const label = getCautionZoneLabel(mapCtx.id);

      addPlaneXZMesh(
        armGroup,
        len,
        bandH,
        x0 + len * 0.5,
        ELEV.sidewalkMarking - 0.001,
        bandZ + bandH * 0.5,
        mats.cautionBase,
        tracker
      );
      const cautionPoly: Point2D[] = [
        { x: x0, y: bandZ },
        { x: x1, y: bandZ },
        { x: x1, y: bandZ + bandH },
        { x: x0, y: bandZ + bandH },
      ];
      const cautionGeom = buildFlatPolygonGeometry(cautionPoly, ELEV.sidewalkMarking, tracker);
      if (cautionGeom) armGroup.add(new THREE.Mesh(cautionGeom, mats.cautionStripes));

      const borderCol =
        mapCtx.id === 'bondowoso-malang'
          ? 'rgba(16, 185, 129, 0.82)'
          : mapCtx.id === 'lamper-semarang'
            ? 'rgba(245, 158, 11, 0.85)'
            : 'rgba(14, 165, 233, 0.75)';
      const badgeTex = makeTextBadgeTexture(
        label,
        {
          widthPx: 320,
          heightPx: 72,
          bgColor: 'rgba(255, 255, 255, 0.94)',
          borderColor: borderCol,
          textColor: '#0F172A',
          font: '700 36px "JetBrains Mono", monospace',
        },
        tracker
      );
      const badgeMat = tracker.trackMat(
        new THREE.MeshStandardMaterial({
          map: badgeTex,
          transparent: true,
          roughness: 0.7,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      const badgeMesh = addPlaneXZMesh(
        armGroup,
        5.8,
        1.3,
        (x0 + x1) * 0.5,
        ELEV.sidewalkBadge,
        bandZ + bandH + 0.86,
        badgeMat,
        tracker
      );
      if (flipText) badgeMesh.rotation.y = Math.PI;
    }
  }
}

function addMedianSegment3D(
  armGroup: THREE.Group,
  x0: number,
  len: number,
  medianW: number,
  armAngleRad: number,
  shrubs: ShrubSpot[],
  shrubSpacing: number,
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  if (len <= 0.8) return;
  const mW = Math.max(0.55, medianW);
  const cx = x0 + len * 0.5;

  const basePts = makeRoundedRectPoints(cx, 0, len, mW, Math.min(0.45, mW * 0.5));
  const baseGeom = buildExtrudedPolygonGeometry(basePts, ELEV.medianHeight, 0, tracker);
  if (baseGeom) {
    const mesh = new THREE.Mesh(baseGeom, mats.medianConcrete);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    armGroup.add(mesh);
  }

  const grassLen = Math.max(0.2, len - 0.7);
  const grassW = mW * 0.56;
  const grassPts = makeRoundedRectPoints(cx, 0, grassLen, grassW, Math.min(0.28, grassW * 0.5));
  const grassGeom = buildExtrudedPolygonGeometry(
    grassPts,
    ELEV.medianGrassHeight - ELEV.medianHeight,
    ELEV.medianHeight,
    tracker
  );
  if (grassGeom) {
    const mesh = new THREE.Mesh(grassGeom, mats.medianGrass);
    mesh.receiveShadow = true;
    armGroup.add(mesh);
  }

  const cosA = Math.cos(armAngleRad);
  const sinA = Math.sin(armAngleRad);
  const shrubScale = Math.max(0.28, Math.min(0.48, mW * 0.34));
  for (let d = x0 + 2.0; d < x0 + len - 1.5; d += shrubSpacing) {
    // Arm local (d, 0) -> world (d * cosA, d * sinA)
    shrubs.push({
      x: d * cosA,
      y: ELEV.medianGrassHeight,
      z: d * sinA,
      scale: shrubScale,
    });
  }
}

function addShrubInstances(
  parent: THREE.Group,
  shrubs: ShrubSpot[],
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  if (shrubs.length === 0) return;

  const baseGeom = tracker.trackGeom(new THREE.IcosahedronGeometry(1, 1));
  const topGeom = tracker.trackGeom(new THREE.IcosahedronGeometry(0.45, 1));
  const baseInst = new THREE.InstancedMesh(baseGeom, mats.shrubDark, shrubs.length);
  const topInst = new THREE.InstancedMesh(topGeom, mats.shrubLight, shrubs.length);
  baseInst.castShadow = true;
  baseInst.receiveShadow = true;
  topInst.castShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < shrubs.length; i++) {
    const s = shrubs[i];
    dummy.position.set(s.x, s.y + s.scale * 0.65, s.z);
    dummy.scale.set(s.scale, s.scale * 0.85, s.scale);
    dummy.rotation.y = (i * 1.17) % (Math.PI * 2);
    dummy.updateMatrix();
    baseInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(s.x - s.scale * 0.16, s.y + s.scale * 1.08, s.z - s.scale * 0.14);
    dummy.scale.setScalar(s.scale * 0.92);
    dummy.updateMatrix();
    topInst.setMatrixAt(i, dummy.matrix);
  }
  baseInst.instanceMatrix.needsUpdate = true;
  topInst.instanceMatrix.needsUpdate = true;

  parent.add(baseInst, topInst);
}

/**
 * Builds the Banjarmasin east river channel (y = -0.18m), concrete embankments,
 * riverbed, and structural bridges wherever an east / north-east arm crosses the channel.
 */
function buildBanjarmasinRiverAndBridges(
  parent: THREE.Group,
  river: RiverConfig,
  groundHalf: number,
  bridges: Array<{ centerZ: number; roadHalfWidth: number; angleRad: number; crossX: number }>,
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  const { riverX, riverW, bankWallW } = river;
  const riverMidX = riverX + riverW * 0.5;
  const spanLen = groundHalf * 2;

  // Riverbed & water sheets
  addPlaneXZMesh(parent, riverW + 2.4, spanLen, riverMidX, ELEV.riverBed, 0, mats.riverBed, tracker, true);
  addPlaneXZMesh(parent, riverW, spanLen, riverMidX, ELEV.riverWater, 0, mats.riverWater, tracker, true);

  // Shallow bright cyan shore strips along west & east riverbanks
  const shoreW = Math.min(3.5, riverW * 0.18);
  addPlaneXZMesh(parent, shoreW, spanLen, riverX + shoreW * 0.5, ELEV.riverShore, 0, mats.riverShore, tracker);
  addPlaneXZMesh(
    parent,
    shoreW,
    spanLen,
    riverX + riverW - shoreW * 0.5,
    ELEV.riverShore,
    0,
    mats.riverShore,
    tracker
  );

  // Embankment wall segments leaving openings wherever a bridge crosses the river
  const gaps = bridges
    .map((b) => ({
      minZ: b.centerZ - b.roadHalfWidth - 0.35,
      maxZ: b.centerZ + b.roadHalfWidth + 0.35,
    }))
    .sort((a, b) => a.minZ - b.minZ);

  const wallIntervals: Array<{ z0: number; z1: number }> = [];
  let cursorZ = -groundHalf;
  for (const g of gaps) {
    if (g.minZ > cursorZ + 0.2) {
      wallIntervals.push({ z0: cursorZ, z1: Math.min(groundHalf, g.minZ) });
    }
    cursorZ = Math.max(cursorZ, g.maxZ);
  }
  if (cursorZ < groundHalf - 0.2) {
    wallIntervals.push({ z0: cursorZ, z1: groundHalf });
  }

  const wallH = 0.22 - ELEV.riverBed;
  const wallCenterY = ELEV.riverBed + wallH * 0.5;
  for (const iv of wallIntervals) {
    const segLen = iv.z1 - iv.z0;
    const midZ = (iv.z0 + iv.z1) * 0.5;
    // West concrete embankment
    addBoxMesh(parent, bankWallW, wallH, segLen, riverX - bankWallW * 0.5, wallCenterY, midZ, mats.riverBank, tracker, {
      cast: true,
      receive: true,
    });
    // East concrete embankment
    addBoxMesh(
      parent,
      bankWallW,
      wallH,
      segLen,
      riverX + riverW + bankWallW * 0.5,
      wallCenterY,
      midZ,
      mats.riverBank,
      tracker,
      { cast: true, receive: true }
    );
  }

  // Structural bridges over the river channel
  for (const b of bridges) {
    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.set(b.crossX, 0, b.centerZ);
    bridgeGroup.rotation.y = -b.angleRad;

    const cosA = Math.max(0.35, Math.abs(Math.cos(b.angleRad)));
    const bridgeLen = (riverW + 4.4) / cosA;
    const totalW = b.roadHalfWidth * 2;
    const roadOnlyW = Math.max(4, totalW - 4.4);
    const swWidth = (totalW - roadOnlyW) * 0.5;

    // Structural underside girder slab (below asphalt y=0.03)
    addBoxMesh(bridgeGroup, bridgeLen, 0.26, totalW + 0.4, 0, -0.105, 0, mats.bridgeDeck, tracker, {
      cast: true,
      receive: true,
    });

    // Bridge side pedestrian decks
    if (swWidth > 0.3) {
      for (const side of [-1, 1] as const) {
        const sz = side * (roadOnlyW * 0.5 + swWidth * 0.5);
        addBoxMesh(bridgeGroup, bridgeLen, 0.16, swWidth, 0, 0.095, sz, mats.sidewalk, tracker, {
          cast: true,
          receive: true,
        });
      }
    }

    // Bridge concrete parapet & guardrail posts along both sides
    for (const side of [-1, 1] as const) {
      const rz = side * (b.roadHalfWidth - 0.16);
      // Low concrete curb parapet
      addBoxMesh(bridgeGroup, bridgeLen, 0.28, 0.28, 0, 0.31, rz, mats.riverBank, tracker, {
        cast: true,
        receive: true,
      });
      // Top metal handrail
      addBoxMesh(bridgeGroup, bridgeLen, 0.08, 0.12, 0, 0.96, rz, mats.bridgeRail, tracker, { cast: true });
      // Mid metal rail
      addBoxMesh(bridgeGroup, bridgeLen, 0.06, 0.09, 0, 0.66, rz, mats.bridgeRail, tracker, { cast: true });
      // Vertical posts every 3.5m
      for (let px = -bridgeLen * 0.48; px <= bridgeLen * 0.48 + 0.1; px += 3.5) {
        addBoxMesh(bridgeGroup, 0.16, 0.58, 0.18, px, 0.68, rz, mats.bridgeRail, tracker, { cast: true });
      }
    }

    // River piers supporting the bridge
    for (const pierFrac of [-0.22, 0.22]) {
      const px = pierFrac * bridgeLen;
      for (const side of [-1, 1] as const) {
        addBoxMesh(
          bridgeGroup,
          1.1,
          0.55,
          1.1,
          px,
          ELEV.riverBed + 0.22,
          side * (b.roadHalfWidth * 0.72),
          mats.riverBank,
          tracker,
          { cast: true, receive: true }
        );
      }
    }

    parent.add(bridgeGroup);
  }
}

/**
 * Branch A: Standard 4-Arm Intersection (matching drawStaticRoadLayer 1:1).
 */
function buildStandard4ArmRoad(
  parent: THREE.Group,
  config: SimConfig,
  envKey: string,
  mapCtx: MapBehavioralContext,
  mats: MaterialBank,
  tracker: ResourceTracker
): { sigPositions: SignalPolePosition3D[]; extentMeters: number } {
  const halfRoad = getEffectiveRoadWidth(config);
  const halfBox = halfRoad + 2.0;
  const armLen = halfBox + config.roadLength;
  const sidewalkW = 3.4;
  const filletR = 2.2;
  const extentMeters = armLen;
  const groundHalf = Math.max(extentMeters * 1.9, 240);

  const riverOffset = Math.max(42, config.roadLength * 0.56);
  const bxEast = halfRoad + sidewalkW;
  const bw = config.roadLength + 24;
  const riverX = bxEast + riverOffset;
  const riverW = Math.min(26, Math.max(16, armLen - riverX - 8 > 8 ? armLen - riverX - 8 : 22));
  const river: RiverConfig = {
    active: envKey === 'sulawesi-banjarmasin',
    riverX,
    riverW,
    bankWallW: 1.6,
  };

  // 1. Base tropical grass ground plane (split around Banjarmasin river channel if active)
  if (river.active) {
    const leftW = river.riverX + groundHalf;
    addPlaneXZMesh(
      parent,
      leftW,
      groundHalf * 2,
      -groundHalf + leftW * 0.5,
      ELEV.ground,
      0,
      mats.ground,
      tracker,
      true
    );
    const eastStart = river.riverX + river.riverW;
    const rightW = Math.max(20, groundHalf - eastStart);
    addPlaneXZMesh(
      parent,
      rightW,
      groundHalf * 2,
      eastStart + rightW * 0.5,
      ELEV.ground,
      0,
      mats.ground,
      tracker,
      true
    );
  } else {
    addPlaneXZMesh(parent, groundHalf * 2, groundHalf * 2, 0, ELEV.ground, 0, mats.ground, tracker, true);
  }

  // 2. Corner sidewalks, grass plots, soil strips & compound yards
  const corners = getEnvironmentCorners(envKey);
  const swArmReach = armLen + 4;
  for (const c of corners) {
    const bx = c.sx * (halfRoad + sidewalkW);
    const bz = c.sy * (halfRoad + sidewalkW);

    // Build corner L-shaped sidewalk around rounded road fillet
    const buildCornerSidewalk = (eastMaxX: number) => {
      const cxArc = c.sx * (halfRoad + filletR);
      const czArc = c.sy * (halfRoad + filletR);
      // Compute clean 2D points around the rounded corner from arm Z to arm X
      const ptZInner = { x: c.sx * halfRoad, y: c.sy * (halfRoad + filletR) };
      const ptXInner = { x: c.sx * (halfRoad + filletR), y: c.sy * halfRoad };
      const angZ = Math.atan2(ptZInner.y - czArc, ptZInner.x - cxArc);
      let angX = Math.atan2(ptXInner.y - czArc, ptXInner.x - cxArc);
      let diff = angX - angZ;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      angX = angZ + diff;
      const arcPts = buildArcPoints(cxArc, czArc, filletR, angZ, angX, 8);

      const xEnd = c.sx < 0 ? c.sx * swArmReach : Math.min(swArmReach, eastMaxX);
      const swPts: Point2D[] = [
        { x: c.sx * halfRoad, y: c.sy * swArmReach },
        { x: bx, y: c.sy * swArmReach },
        { x: bx, y: bz },
        { x: xEnd, y: bz },
        { x: xEnd, y: c.sy * halfRoad },
        ...arcPts.slice().reverse(),
      ];
      const swGeom = buildExtrudedPolygonGeometry(swPts, ELEV.sidewalkHeight, 0, tracker);
      if (swGeom) {
        const m = new THREE.Mesh(swGeom, mats.sidewalk);
        m.receiveShadow = true;
        m.castShadow = true;
        parent.add(m);
      }
    };

    if (river.active && c.riverEdge) {
      buildCornerSidewalk(river.riverX - 0.1);
      // East bank sidewalk past the river bridge
      const eastBankStart = river.riverX + river.riverW + 0.1;
      if (swArmReach > eastBankStart + 1) {
        const eSwW = swArmReach - eastBankStart;
        addBoxMesh(
          parent,
          eSwW,
          ELEV.sidewalkHeight,
          sidewalkW,
          eastBankStart + eSwW * 0.5,
          ELEV.sidewalkHeight * 0.5,
          c.sy * (halfRoad + sidewalkW * 0.5),
          mats.sidewalk,
          tracker,
          { cast: true, receive: true }
        );
      }
    } else {
      buildCornerSidewalk(swArmReach);
    }

    // Corner grass plots, soil strips, and compound yards
    const plotMinX = c.sx < 0 ? bx - bw : bx;
    const plotMaxX = c.sx < 0 ? bx : c.riverEdge && river.active ? river.riverX - river.bankWallW : bx + bw;
    const plotW = Math.max(0, plotMaxX - plotMinX);
    const plotCenterZ = c.sy < 0 ? bz - bw * 0.5 : bz + bw * 0.5;

    const grassMat = c.isPark ? mats.grassPark : mats.grassPlot;
    if (plotW > 1) {
      addPlaneXZMesh(
        parent,
        plotW,
        bw,
        plotMinX + plotW * 0.5,
        ELEV.grassPlot,
        plotCenterZ,
        grassMat,
        tracker,
        true
      );
    }

    // Far east bank grass plot beyond Banjarmasin river
    if (c.riverEdge && river.active) {
      const farMinX = river.riverX + river.riverW + river.bankWallW;
      const farMaxX = bx + bw;
      if (farMaxX > farMinX + 2) {
        addPlaneXZMesh(
          parent,
          farMaxX - farMinX,
          bw,
          (farMinX + farMaxX) * 0.5,
          ELEV.grassPlot,
          plotCenterZ,
          grassMat,
          tracker,
          true
        );
      }
    }

    // Soil border strip inside grass plot
    const soilStrip = 2.6;
    addPlaneXZMesh(
      parent,
      soilStrip,
      bw,
      c.sx < 0 ? bx - soilStrip * 0.5 : bx + soilStrip * 0.5,
      ELEV.soilStrip,
      plotCenterZ,
      mats.soilStrip,
      tracker,
      true
    );
    const horizSoilW = Math.max(0, plotW - soilStrip);
    if (horizSoilW > 0.5) {
      addPlaneXZMesh(
        parent,
        horizSoilW,
        soilStrip,
        c.sx < 0 ? plotMinX + horizSoilW * 0.5 : bx + soilStrip + horizSoilW * 0.5,
        ELEV.soilStrip,
        c.sy < 0 ? bz - soilStrip * 0.5 : bz + soilStrip * 0.5,
        mats.soilStrip,
        tracker,
        true
      );
    }

    // Compound yard pad for non-park corners
    if (!c.isPark) {
      const bSize = Math.min(26, Math.max(14, config.roadLength * 0.32));
      const yardPad = 2.5;
      const yardW = bSize * 2.05;
      const yardX = c.sx < 0 ? bx - soilStrip - yardPad - yardW : bx + soilStrip + yardPad;
      const yardZ = c.sy < 0 ? bz - soilStrip - yardPad - yardW : bz + soilStrip + yardPad;
      const maxXAllowed = c.riverEdge && river.active ? river.riverX - river.bankWallW - 1.0 : Infinity;
      const clippedW = Math.max(0, Math.min(yardW, maxXAllowed - yardX));
      if (clippedW > 4) {
        const ycx = yardX + clippedW * 0.5;
        const ycz = yardZ + yardW * 0.5;
        const borderPts = makeRoundedRectPoints(ycx, ycz, clippedW + 0.5, yardW + 0.5, 1.3);
        const borderGeom = buildFlatPolygonGeometry(borderPts, ELEV.yardBorder, tracker);
        if (borderGeom) {
          const m = new THREE.Mesh(borderGeom, mats.yardBorder);
          m.receiveShadow = true;
          parent.add(m);
        }
        const yardPts = makeRoundedRectPoints(ycx, ycz, clippedW, yardW, 1.2);
        const yardGeom = buildFlatPolygonGeometry(yardPts, ELEV.yard, tracker);
        if (yardGeom) {
          const m = new THREE.Mesh(yardGeom, mats.yard);
          m.receiveShadow = true;
          parent.add(m);
        }
      }
    }
  }

  // 3. Banjarmasin river channel & East bridge
  if (river.active) {
    buildBanjarmasinRiverAndBridges(
      parent,
      river,
      groundHalf,
      [{ centerZ: 0, roadHalfWidth: halfRoad + sidewalkW, angleRad: 0, crossX: river.riverX + river.riverW * 0.5 }],
      mats,
      tracker
    );
  }

  // 4. Road asphalt (non-overlapping arms + center box + 4 corner fillets)
  const armSpan = armLen - halfRoad;
  const armMid = halfRoad + armSpan * 0.5;
  addPlaneXZMesh(parent, halfRoad * 2, armSpan, 0, ELEV.asphalt, -armMid, mats.asphalt, tracker, true); // North
  addPlaneXZMesh(parent, halfRoad * 2, armSpan, 0, ELEV.asphalt, armMid, mats.asphalt, tracker, true); // South
  addPlaneXZMesh(parent, armSpan, halfRoad * 2, -armMid, ELEV.asphalt, 0, mats.asphalt, tracker, true); // West
  addPlaneXZMesh(parent, armSpan, halfRoad * 2, armMid, ELEV.asphalt, 0, mats.asphalt, tracker, true); // East
  addPlaneXZMesh(parent, halfRoad * 2, halfRoad * 2, 0, ELEV.centerBox, 0, mats.asphaltCenter, tracker, true);

  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      const cxArc = sx * (halfRoad + filletR);
      const czArc = sy * (halfRoad + filletR);
      const pZ = { x: sx * halfRoad, y: sy * (halfRoad + filletR) };
      const pX = { x: sx * (halfRoad + filletR), y: sy * halfRoad };
      const angZ = Math.atan2(pZ.y - czArc, pZ.x - cxArc);
      let angX = Math.atan2(pX.y - czArc, pX.x - cxArc);
      let diff = angX - angZ;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      angX = angZ + diff;
      const arcPts = buildArcPoints(cxArc, czArc, filletR, angZ, angX, 10);
      const filletPts: Point2D[] = [{ x: sx * halfRoad, y: sy * halfRoad }, ...arcPts];
      const filletGeom = buildFlatPolygonGeometry(filletPts, ELEV.asphalt, tracker);
      if (filletGeom) {
        const m = new THREE.Mesh(filletGeom, mats.asphalt);
        m.receiveShadow = true;
        parent.add(m);
      }

      // Indonesian black-and-white kanstin curb along the rounded corner & arms
      const buildCurbSegment = (pts: Point2D[]) => {
        const cGeom = buildCurbStripGeometry(pts, 0.38, ELEV.curbHeight, 0, 3.0, false, tracker);
        if (cGeom) {
          const m = new THREE.Mesh(cGeom, mats.kanstin);
          m.castShadow = true;
          m.receiveShadow = true;
          parent.add(m);
        }
      };

      const curbArcPts = buildArcPoints(cxArc, czArc, filletR - 0.18, angZ, angX, 8);
      if (river.active && sx > 0) {
        // West of river bridge + corner
        const westPts: Point2D[] = [
          { x: sx * (halfRoad + 0.18), y: sy * armLen },
          ...curbArcPts,
          { x: river.riverX - 0.3, y: sy * (halfRoad + 0.18) },
        ];
        buildCurbSegment(westPts);
        // East of river bridge
        const eastStart = river.riverX + river.riverW + 0.3;
        if (armLen > eastStart + 0.5) {
          buildCurbSegment([
            { x: eastStart, y: sy * (halfRoad + 0.18) },
            { x: armLen, y: sy * (halfRoad + 0.18) },
          ]);
        }
      } else {
        const fullCurbPts: Point2D[] = [
          { x: sx * (halfRoad + 0.18), y: sy * armLen },
          ...curbArcPts,
          { x: sx * armLen, y: sy * (halfRoad + 0.18) },
        ];
        buildCurbSegment(fullCurbPts);
      }
    }
  }

  // 5. Yellow Box Junction
  if (config.yellowBoxEnabled) {
    addYellowBox3D(parent, halfRoad, halfRoad, mats, tracker);
  }

  // 6. Per-arm markings, medians, stop lines, RHK, LTOR, lane arrows & MapContext markings
  const shrubs: ShrubSpot[] = [];
  const lw = halfRoad / Math.max(1, config.lanesPerDirection);
  const L = Math.max(1, Math.round(config.lanesPerDirection));
  const armDefs: Array<{ id: 'east' | 'south' | 'west' | 'north'; angleRad: number }> = [
    { id: 'east', angleRad: 0 },
    { id: 'south', angleRad: Math.PI / 2 },
    { id: 'west', angleRad: Math.PI },
    { id: 'north', angleRad: -Math.PI / 2 },
  ];

  const arrowGeoms = {
    straight: buildLaneArrowGeometry('straight', tracker),
    left: buildLaneArrowGeometry('left', tracker),
    right: buildLaneArrowGeometry('right', tracker),
  };

  const ltorTex = config.leftTurnOnRed
    ? makeTextBadgeTexture(
        'LTOR',
        {
          widthPx: 128,
          heightPx: 160,
          bgColor: 'rgba(16, 185, 129, 0.22)',
          borderColor: '#10B981',
          textColor: '#047857',
          font: '700 32px "JetBrains Mono", monospace',
          ltorArrow: true,
        },
        tracker
      )
    : null;
  const ltorMat = ltorTex
    ? tracker.trackMat(
        new THREE.MeshStandardMaterial({
          map: ltorTex,
          transparent: true,
          roughness: 0.72,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      )
    : null;

  const arrowMat = tracker.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      transparent: true,
      opacity: 0.45,
      roughness: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );

  for (const a of armDefs) {
    const armGroup = new THREE.Group();
    armGroup.rotation.y = -a.angleRad;
    parent.add(armGroup);

    // Physical center median OR double-solid + dashed yellow centerline
    if (config.hasMedian) {
      const medianStart = halfBox + 0.8;
      const medianLen = Math.max(0, armLen - medianStart);
      addMedianSegment3D(armGroup, medianStart, medianLen, 0.76, a.angleRad, shrubs, 3.8, mats, tracker);
    } else {
      const noPassEnd = Math.min(armLen, halfBox + 28);
      const npLen = Math.max(0, noPassEnd - halfBox);
      if (npLen > 0.2) {
        const cx = halfBox + npLen * 0.5;
        addPlaneXZMesh(armGroup, npLen, 0.2, cx, ELEV.markingLine, -0.18, mats.yellowSolid, tracker);
        addPlaneXZMesh(armGroup, npLen, 0.2, cx, ELEV.markingLine, 0.18, mats.yellowSolid, tracker);
      }
      if (armLen > noPassEnd + 0.5) {
        const dashGeom = buildFlatRibbonGeometry(
          [
            { x: noPassEnd, y: 0 },
            { x: armLen, y: 0 },
          ],
          0.2,
          ELEV.markingLine,
          4.6,
          tracker
        );
        if (dashGeom) armGroup.add(new THREE.Mesh(dashGeom, mats.yellowDash));
      }
    }

    // Dashed white lane dividers (inbound +Z, outbound -Z)
    for (let l = 1; l < L; l++) {
      const off = l * lw;
      for (const side of [-1, 1] as const) {
        const divGeom = buildFlatRibbonGeometry(
          [
            { x: halfBox, y: side * off },
            { x: armLen, y: side * off },
          ],
          0.16,
          ELEV.markingLine,
          3.4,
          tracker
        );
        if (divGeom) armGroup.add(new THREE.Mesh(divGeom, mats.whiteDash));
      }
    }

    // Solid white stop line (inbound side +Z_local)
    addPlaneXZMesh(
      armGroup,
      0.48,
      halfRoad,
      halfBox + 0.24,
      ELEV.markingLine,
      halfRoad * 0.5,
      mats.whiteSolid,
      tracker
    );

    // Emerald dashed exit counting line (outbound side -Z_local)
    const exitGeom = buildFlatRibbonGeometry(
      [
        { x: halfBox, y: 0 },
        { x: halfBox, y: -halfRoad },
      ],
      0.24,
      ELEV.markingLine,
      1.4,
      tracker
    );
    if (exitGeom) armGroup.add(new THREE.Mesh(exitGeom, mats.emeraldDash));

    // RHK Motor Box behind stop line
    if (config.motorBoxEnabled) {
      const rhkDepth = 4.5;
      const innerMargin = config.hasMedian ? 0.5 : 0.12;
      const rw = Math.max(0.5, halfRoad - 0.12 - innerMargin);
      addRhkBox3D(armGroup, halfBox + 0.45, innerMargin, rhkDepth, rw, mats, tracker);
    }

    // LHT Lane Arrows on inbound lanes
    for (let l = 0; l < L; l++) {
      const off = (l + 0.5) * lw;
      const mode: 'straight' | 'left' | 'right' =
        L === 1 ? 'straight' : l === L - 1 ? 'left' : l === 0 ? 'right' : 'straight';
      const arrow = new THREE.Mesh(arrowGeoms[mode], arrowMat);
      arrow.position.set(halfBox + 6.0, ELEV.markingTop, off);
      arrow.rotation.y = Math.PI / 2;
      armGroup.add(arrow);
    }

    // LTOR badge near outer left curb
    if (ltorMat) {
      const badge = addPlaneXZMesh(
        armGroup,
        2.8,
        2.3,
        halfBox + 8.8,
        ELEV.sidewalkBadge,
        halfRoad + 1.45,
        ltorMat,
        tracker
      );
      badge.rotation.y = Math.PI / 2;
    }

    // Map-aware contextual markings (Bus Bay, Market Friction, Caution Zone)
    addArmContextMarkings3D(
      armGroup,
      {
        armId: a.id,
        armAngleRad: a.angleRad,
        stopX: halfBox,
        armEnd: armLen,
        curbZ: halfRoad,
        slipSetback: 0,
        mapCtx,
      },
      mats,
      tracker
    );
  }

  addShrubInstances(parent, shrubs, mats, tracker);

  // Match IntersectionCanvas.tsx signal pole positions 1:1
  const sigPositions: SignalPolePosition3D[] = [
    { armId: 'north', x: halfRoad + 2.7, z: -halfBox - 2.7, angleRad: -Math.PI / 2, outZ: -1 },
    { armId: 'south', x: -halfRoad - 2.7, z: halfBox + 2.7, angleRad: Math.PI / 2, outZ: 1 },
    { armId: 'west', x: -halfBox - 2.7, z: -halfRoad - 2.7, angleRad: Math.PI, outZ: -1 },
    { armId: 'east', x: halfBox + 2.7, z: halfRoad + 2.7, angleRad: 0, outZ: 1 },
  ];

  return { sigPositions, extentMeters };
}

function buildSplitterIsland3D(
  parent: THREE.Group,
  isl: IslandPolygon,
  shrubs: ShrubSpot[],
  mats: MaterialBank,
  tracker: ResourceTracker
): void {
  // Slip-lane centerline emerald guide + merge yield line
  if (isl.slipLaneCenterPts.length >= 2) {
    const guideGeom = buildFlatRibbonGeometry(
      isl.slipLaneCenterPts,
      0.18,
      ELEV.markingLine,
      2.4,
      tracker
    );
    if (guideGeom) parent.add(new THREE.Mesh(guideGeom, mats.slipGuideDash));

    const last = isl.slipLaneCenterPts[isl.slipLaneCenterPts.length - 1];
    const prev = isl.slipLaneCenterPts[isl.slipLaneCenterPts.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular across the slip exit
    const nx = -dy / len;
    const ny = dx / len;
    const hw = isl.slipLaneWidth * 0.44;
    const yieldGeom = buildFlatRibbonGeometry(
      [
        { x: last.x - nx * hw, y: last.y - ny * hw },
        { x: last.x + nx * hw, y: last.y + ny * hw },
      ],
      0.24,
      ELEV.markingTop,
      0.8,
      tracker
    );
    if (yieldGeom) parent.add(new THREE.Mesh(yieldGeom, mats.yieldWhiteDash));
  }

  // Style 1: Compact narrow curb divider (e.g. Giwangan West)
  if (isl.style === 'curb-divider' && isl.innerEdgePts.length >= 2) {
    const curbGeom = buildCurbStripGeometry(
      isl.innerEdgePts,
      isl.separatorThickness,
      ELEV.curbHeight,
      0,
      1.8,
      false,
      tracker
    );
    if (curbGeom) {
      const m = new THREE.Mesh(curbGeom, mats.kanstinIsland);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
    }

    const warnTopGeom = buildFlatRibbonGeometry(
      isl.innerEdgePts,
      Math.max(0.08, isl.separatorThickness * 0.24),
      ELEV.curbHighlight,
      1,
      tracker
    );
    if (warnTopGeom) parent.add(new THREE.Mesh(warnTopGeom, mats.yellowBoxLine));

    const warnBaseGeom = buildFlatRibbonGeometry(
      isl.innerEdgePts,
      isl.separatorThickness + 0.16,
      ELEV.markingLine,
      1,
      tracker
    );
    if (warnBaseGeom) parent.add(new THREE.Mesh(warnBaseGeom, mats.yellowBoxFill));
    return;
  }

  // Style 2: Painted chevron gore (flat marking)
  if (isl.style === 'painted-gore' && isl.points.length >= 3) {
    const goreGeom = buildFlatPolygonGeometry(isl.points, ELEV.markingFill, tracker);
    if (goreGeom) parent.add(new THREE.Mesh(goreGeom, mats.paintedGore));

    const closedOutline = [...isl.points, isl.points[0]];
    const outlineGeom = buildFlatRibbonGeometry(closedOutline, 0.2, ELEV.markingTop, 1, tracker);
    if (outlineGeom) parent.add(new THREE.Mesh(outlineGeom, mats.whiteSolid));
    return;
  }

  // Style 3: Full raised triangular splitter island with kanstin perimeter & green landscaped core
  if (isl.points.length < 3) return;
  const baseGeom = buildExtrudedPolygonGeometry(isl.points, ELEV.sidewalkHeight, 0, tracker);
  if (baseGeom) {
    const m = new THREE.Mesh(baseGeom, mats.medianConcrete);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  }

  const curbGeom = buildCurbStripGeometry(isl.points, 0.34, ELEV.curbHeight, 0, 2.2, true, tracker);
  if (curbGeom) {
    const m = new THREE.Mesh(curbGeom, mats.kanstinIsland);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
  }

  const greenCorePts = isl.points.map((pt) => ({
    x: isl.centroid.x + (pt.x - isl.centroid.x) * 0.6,
    y: isl.centroid.y + (pt.y - isl.centroid.y) * 0.6,
  }));
  const greenGeom = buildExtrudedPolygonGeometry(
    greenCorePts,
    ELEV.islandGreenHeight - ELEV.sidewalkHeight,
    ELEV.sidewalkHeight,
    tracker
  );
  if (greenGeom) {
    const m = new THREE.Mesh(greenGeom, mats.medianGrass);
    m.receiveShadow = true;
    parent.add(m);
  }

  shrubs.push({
    x: isl.centroid.x,
    y: ELEV.islandGreenHeight,
    z: isl.centroid.y,
    scale: 0.42,
  });
}

function buildCustomTopologyRoad(
  parent: THREE.Group,
  compiled: CompiledTopology,
  envKey: string,
  mapCtx: MapBehavioralContext,
  mats: MaterialBank,
  tracker: ResourceTracker
): { sigPositions: SignalPolePosition3D[]; extentMeters: number } {
  const extentMeters = compiled.maxExtentMeters;
  const groundHalf = Math.max(extentMeters * 1.9, 240);
  const sidewalkW = 2.6;

  // Check if Banjarmasin river applies to custom topology
  const eastCandidate =
    compiled.armsById.east ??
    compiled.armOrder
      .map((id) => compiled.armsById[id])
      .find((a) => a.outDir.x > 0.6);
  const riverX = eastCandidate
    ? eastCandidate.setback + Math.max(38, eastCandidate.def.length * 0.52)
    : 64;
  const riverW = 24;
  const river: RiverConfig = {
    active: envKey === 'sulawesi-banjarmasin',
    riverX,
    riverW,
    bankWallW: 1.6,
  };

  // 1. Base tropical grass plane
  if (river.active) {
    const leftW = river.riverX + groundHalf;
    addPlaneXZMesh(
      parent,
      leftW,
      groundHalf * 2,
      -groundHalf + leftW * 0.5,
      ELEV.ground,
      0,
      mats.ground,
      tracker,
      true
    );
    const eastStart = river.riverX + river.riverW;
    const rightW = Math.max(20, groundHalf - eastStart);
    addPlaneXZMesh(
      parent,
      rightW,
      groundHalf * 2,
      eastStart + rightW * 0.5,
      ELEV.ground,
      0,
      mats.ground,
      tracker,
      true
    );

    // Bridges for east / north-east arms crossing the river
    const riverMidX = river.riverX + river.riverW * 0.5;
    const crossingArms = compiled.armOrder
      .map((id) => compiled.armsById[id])
      .filter((a) => a.outDir.x > 0.25 && a.setback + a.def.length > river.riverX + 2);
    const bridges = crossingArms.map((a) => {
      const distAtRiver = riverMidX / a.outDir.x;
      const crossZ = a.outDir.y * distAtRiver;
      const halfW = Math.max(a.halfMedian + a.inWidth, a.halfMedian + a.outWidth) + sidewalkW;
      return {
        centerZ: crossZ,
        roadHalfWidth: halfW,
        angleRad: a.angleRad,
        crossX: riverMidX,
      };
    });
    buildBanjarmasinRiverAndBridges(parent, river, groundHalf, bridges, mats, tracker);
  } else {
    addPlaneXZMesh(parent, groundHalf * 2, groundHalf * 2, 0, ELEV.ground, 0, mats.ground, tracker, true);
  }

  // Landmark paved compound aprons (e.g. Terminal Giwangan, SPBU, Pos Brimob, Ruko)
  const landmarks = compiled.topology.landmarks ?? [];
  for (const lm of landmarks) {
    const apronW = lm.width * 1.12;
    const apronH = lm.height * 1.16;
    const rot = lm.rotationRad || 0;
    const apronGroup = new THREE.Group();
    apronGroup.position.set(lm.x, 0, lm.y);
    apronGroup.rotation.y = -rot;

    const borderPts = makeRoundedRectPoints(0, 0, apronW + 0.45, apronH + 0.45, 1.5);
    const borderGeom = buildFlatPolygonGeometry(borderPts, ELEV.yardBorder, tracker);
    if (borderGeom) {
      const m = new THREE.Mesh(borderGeom, mats.yardBorder);
      m.receiveShadow = true;
      apronGroup.add(m);
    }

    const yardPts = makeRoundedRectPoints(0, 0, apronW, apronH, 1.4);
    const yardGeom = buildFlatPolygonGeometry(yardPts, ELEV.yard, tracker);
    if (yardGeom) {
      const m = new THREE.Mesh(yardGeom, mats.yard);
      m.receiveShadow = true;
      apronGroup.add(m);
    }
    parent.add(apronGroup);
  }

  const cwArms: CompiledArmGeometry[] = [...compiled.armOrder]
    .map((id) => compiled.armsById[id])
    .sort((a, b) => normalizeAngle0To2Pi(a.angleRad) - normalizeAngle0To2Pi(b.angleRad));

  const islandByArm: Record<string, IslandPolygon> = {};
  const islandByDest: Record<string, IslandPolygon> = {};
  for (const isl of compiled.islands) {
    islandByArm[isl.armId] = isl;
    islandByDest[isl.destArmId] = isl;
  }

  // 2. Slip-lane asphalt channels & curved outer sidewalks
  for (const isl of compiled.islands) {
    if (isl.outerBoundaryPts.length >= 6) {
      const slipAsphaltGeom = buildFlatPolygonGeometry(isl.outerBoundaryPts, ELEV.asphalt, tracker);
      if (slipAsphaltGeom) {
        const m = new THREE.Mesh(slipAsphaltGeom, mats.asphalt);
        m.receiveShadow = true;
        parent.add(m);
      }

      // Outer curved sidewalk & kanstin curb along the outer edge of the slip lane
      const halfPts = Math.floor(isl.outerBoundaryPts.length / 2);
      const outerEdgePts = isl.outerBoundaryPts.slice(0, halfPts);
      if (outerEdgePts.length >= 2) {
        const curbPts: Point2D[] = [];
        for (let i = 0; i < outerEdgePts.length; i++) {
          const prev = outerEdgePts[Math.max(0, i - 1)];
          const next = outerEdgePts[Math.min(outerEdgePts.length - 1, i + 1)];
          const tx = next.x - prev.x;
          const ty = next.y - prev.y;
          const tLen = Math.hypot(tx, ty) || 1;
          const ox = ty / tLen;
          const oy = -tx / tLen;
          curbPts.push({
            x: outerEdgePts[i].x + ox * 0.18,
            y: outerEdgePts[i].y + oy * 0.18,
          });
        }
        const swPtsFull = [...outerEdgePts];
        for (let i = outerEdgePts.length - 1; i >= 0; i--) {
          const prev = outerEdgePts[Math.max(0, i - 1)];
          const next = outerEdgePts[Math.min(outerEdgePts.length - 1, i + 1)];
          const tx = next.x - prev.x;
          const ty = next.y - prev.y;
          const tLen = Math.hypot(tx, ty) || 1;
          swPtsFull.push({
            x: outerEdgePts[i].x + (ty / tLen) * sidewalkW,
            y: outerEdgePts[i].y + (-tx / tLen) * sidewalkW,
          });
        }
        const swGeom = buildExtrudedPolygonGeometry(swPtsFull, ELEV.sidewalkHeight, 0, tracker);
        if (swGeom) {
          const m = new THREE.Mesh(swGeom, mats.sidewalk);
          m.castShadow = true;
          m.receiveShadow = true;
          parent.add(m);
        }
        const curbGeom = buildCurbStripGeometry(curbPts, 0.36, ELEV.curbHeight, 0, 3.0, false, tracker);
        if (curbGeom) {
          const m = new THREE.Mesh(curbGeom, mats.kanstin);
          m.castShadow = true;
          m.receiveShadow = true;
          parent.add(m);
        }
      }
    } else if (isl.slipLaneCenterPts.length >= 2) {
      const slipRibbon = buildFlatRibbonGeometry(
        isl.slipLaneCenterPts,
        isl.slipLaneWidth,
        ELEV.asphalt,
        1,
        tracker
      );
      if (slipRibbon) {
        const m = new THREE.Mesh(slipRibbon, mats.asphalt);
        m.receiveShadow = true;
        parent.add(m);
      }
    }
  }

  // 3. Center junction box polygon
  if (compiled.centerPolygon.length >= 3) {
    const centerGeom = buildFlatPolygonGeometry(compiled.centerPolygon, ELEV.centerBox, tracker);
    if (centerGeom) {
      const m = new THREE.Mesh(centerGeom, mats.asphaltCenter);
      m.receiveShadow = true;
      parent.add(m);
    }
  }

  // 4. Corner sidewalk wedges & corner kanstin curbs between adjacent arms (where no slip lane occupies the corner)
  const inCornerOffset: Record<string, number> = {};
  const outCornerOffset: Record<string, number> = {};
  for (const id of compiled.armOrder) {
    inCornerOffset[id] = 0;
    outCornerOffset[id] = 0;
  }

  for (let i = 0; i < cwArms.length; i++) {
    const a = cwArms[i];
    const b = cwArms[(i + 1) % cwArms.length];
    const slipIsl = islandByArm[a.def.id];
    if (slipIsl && slipIsl.destArmId === b.def.id) {
      // Corner is occupied by slip lane & splitter island; leave sidewalk clear between branch & merge!
      continue;
    }

    const aInOuter = a.halfMedian + a.inWidth + (a.def.curbFlareLeft ?? 0);
    const bOutOuter = b.halfMedian + b.outWidth;
    const A0: Point2D = {
      x: a.outDir.x * a.setback + a.inLeftNormal.x * aInOuter,
      y: a.outDir.y * a.setback + a.inLeftNormal.y * aInOuter,
    };
    const B0: Point2D = {
      x: b.outDir.x * b.setback - b.inLeftNormal.x * bOutOuter,
      y: b.outDir.y * b.setback - b.inLeftNormal.y * bOutOuter,
    };
    const A0Out: Point2D = {
      x: A0.x + a.inLeftNormal.x * sidewalkW,
      y: A0.y + a.inLeftNormal.y * sidewalkW,
    };
    const B0Out: Point2D = {
      x: B0.x - b.inLeftNormal.x * sidewalkW,
      y: B0.y - b.inLeftNormal.y * sidewalkW,
    };

    const inter = intersectLines2D(A0Out, a.outDir, B0Out, b.outDir);
    let cornerPoly: Point2D[];
    if (inter && inter.t > 0 && inter.u > 0 && inter.t < 15 && inter.u < 15) {
      inCornerOffset[a.def.id] = inter.t;
      outCornerOffset[b.def.id] = inter.u;
      cornerPoly = [
        A0,
        { x: A0.x + a.outDir.x * inter.t, y: A0.y + a.outDir.y * inter.t },
        inter.pt,
        { x: B0.x + b.outDir.x * inter.u, y: B0.y + b.outDir.y * inter.u },
        B0,
      ];
    } else {
      cornerPoly = [A0, A0Out, B0Out, B0];
    }

    const cornerSwGeom = buildExtrudedPolygonGeometry(cornerPoly, ELEV.sidewalkHeight, 0, tracker);
    if (cornerSwGeom) {
      const m = new THREE.Mesh(cornerSwGeom, mats.sidewalk);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
    }

    // Continuous kanstin curb along the centerPolygon corner chord [A0 -> B0]
    const chordDx = B0.x - A0.x;
    const chordDy = B0.y - A0.y;
    const chordLen = Math.hypot(chordDx, chordDy);
    if (chordLen > 0.3) {
      // Push outward away from origin by 0.18m so curb inner face aligns with [A0, B0]
      let outNx = chordDy / chordLen;
      let outNy = -chordDx / chordLen;
      const midX = (A0.x + B0.x) * 0.5;
      const midY = (A0.y + B0.y) * 0.5;
      if (outNx * midX + outNy * midY < 0) {
        outNx = -outNx;
        outNy = -outNy;
      }
      const curbGeom = buildCurbStripGeometry(
        [
          { x: A0.x + outNx * 0.18, y: A0.y + outNy * 0.18 },
          { x: B0.x + outNx * 0.18, y: B0.y + outNy * 0.18 },
        ],
        0.36,
        ELEV.curbHeight,
        0,
        3.0,
        false,
        tracker
      );
      if (curbGeom) {
        const m = new THREE.Mesh(curbGeom, mats.kanstin);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
      }
    }
  }

  // 5. Arm asphalt, sidewalks, kanstin curbs, medians, markings, RHK, arrows & MapContext
  const shrubs: ShrubSpot[] = [];
  const arrowGeoms = {
    straight: buildLaneArrowGeometry('straight', tracker),
    left: buildLaneArrowGeometry('left', tracker),
    right: buildLaneArrowGeometry('right', tracker),
  };
  const customArrowMat = tracker.trackMat(
    new THREE.MeshStandardMaterial({
      color: '#F8FAFC',
      transparent: true,
      opacity: 0.46,
      roughness: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );

  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const inOuter = arm.halfMedian + arm.inWidth;
    const flare = arm.def.curbFlareLeft ?? 0;
    const outOuter = arm.halfMedian + arm.outWidth;
    const armEnd = arm.setback + arm.def.length;
    const flareStart = Math.min(armEnd - 4, arm.setback + 24);

    const armGroup = new THREE.Group();
    armGroup.rotation.y = -arm.angleRad;
    parent.add(armGroup);

    // Main carriageway polygon
    const roadPts: Point2D[] = [
      { x: arm.setback - 0.1, y: -outOuter },
      { x: armEnd, y: -outOuter },
      { x: armEnd, y: inOuter },
    ];
    if (flare > 0.05) {
      roadPts.push(
        { x: flareStart, y: inOuter },
        { x: arm.setback + 4, y: inOuter + flare },
        { x: arm.setback - 0.1, y: inOuter + flare }
      );
    } else {
      roadPts.push({ x: arm.setback - 0.1, y: inOuter });
    }
    const roadGeom = buildFlatPolygonGeometry(roadPts, ELEV.asphalt, tracker);
    if (roadGeom) {
      const m = new THREE.Mesh(roadGeom, mats.asphalt);
      m.receiveShadow = true;
      armGroup.add(m);
    }

    // Slip-lane entry/exit asphalt apron flares so slip channel blends smoothly into main carriageway
    const outSlip = islandByArm[armId];
    if (outSlip && outSlip.outerBoundaryPts.length >= 6) {
      const islSetback = Math.max(10, Math.min(30, arm.def.slipLane?.islandSetback || 16));
      const branchDist = arm.setback + islSetback;
      const apronPts: Point2D[] = [
        { x: branchDist + 6, y: inOuter - 0.2 },
        { x: branchDist - 0.5, y: inOuter + flare + (arm.def.slipLane?.width ?? 3.4) },
        { x: branchDist - 0.5, y: inOuter - 0.2 },
      ];
      const apronGeom = buildFlatPolygonGeometry(apronPts, ELEV.asphaltApron, tracker);
      if (apronGeom) {
        const m = new THREE.Mesh(apronGeom, mats.asphalt);
        m.receiveShadow = true;
        armGroup.add(m);
      }
    }

    // Outbound sidewalk strip (-Z_local)
    const incomingSlip = islandByDest[armId];
    const mergeClearDist = incomingSlip
      ? arm.setback +
        Math.max(10, Math.min(30, compiled.armsById[incomingSlip.armId]?.def.slipLane?.islandSetback || 16)) *
          1.15 +
        2.0
      : arm.setback;
    const outSwStart = Math.max(arm.setback + (outCornerOffset[armId] ?? 0), mergeClearDist);
    const swEnd = armEnd + 4;
    if (swEnd > outSwStart + 0.5) {
      const outSwLen = swEnd - outSwStart;
      addBoxMesh(
        armGroup,
        outSwLen,
        ELEV.sidewalkHeight,
        sidewalkW,
        outSwStart + outSwLen * 0.5,
        ELEV.sidewalkHeight * 0.5,
        -(outOuter + sidewalkW * 0.5),
        mats.sidewalk,
        tracker,
        { cast: true, receive: true }
      );
    }

    // Outbound kanstin curb (-Z_local)
    const outCurbStart = incomingSlip ? mergeClearDist : arm.setback;
    if (armEnd > outCurbStart + 0.4) {
      const outCurbGeom = buildCurbStripGeometry(
        [
          { x: outCurbStart, y: -(outOuter + 0.18) },
          { x: armEnd, y: -(outOuter + 0.18) },
        ],
        0.38,
        ELEV.curbHeight,
        0,
        3.0,
        false,
        tracker
      );
      if (outCurbGeom) {
        const m = new THREE.Mesh(outCurbGeom, mats.kanstin);
        m.castShadow = true;
        m.receiveShadow = true;
        armGroup.add(m);
      }
    }

    // Inbound sidewalk strip & kanstin curb (+Z_local)
    const branchClearDist = outSlip
      ? arm.setback + Math.max(10, Math.min(30, arm.def.slipLane?.islandSetback || 16)) + 2.0
      : arm.setback;
    const inSwStart = Math.max(arm.setback + (inCornerOffset[armId] ?? 0), branchClearDist);

    const buildInboundCurbAndSidewalk = () => {
      if (swEnd <= inSwStart + 0.5) return;
      if (flare > 0.05 && inSwStart < flareStart) {
        const yAtStart =
          inSwStart <= arm.setback + 4
            ? inOuter + flare
            : inOuter + flare * (1 - (inSwStart - (arm.setback + 4)) / Math.max(1, flareStart - (arm.setback + 4)));
        const swPoly: Point2D[] = [{ x: inSwStart, y: yAtStart }];
        if (inSwStart < arm.setback + 4) {
          swPoly.push({ x: arm.setback + 4, y: inOuter + flare });
        }
        swPoly.push(
          { x: flareStart, y: inOuter },
          { x: swEnd, y: inOuter },
          { x: swEnd, y: inOuter + sidewalkW },
          { x: flareStart, y: inOuter + sidewalkW },
          ...(inSwStart < arm.setback + 4 ? [{ x: arm.setback + 4, y: inOuter + flare + sidewalkW }] : []),
          { x: inSwStart, y: yAtStart + sidewalkW }
        );
        const swGeom = buildExtrudedPolygonGeometry(swPoly, ELEV.sidewalkHeight, 0, tracker);
        if (swGeom) {
          const m = new THREE.Mesh(swGeom, mats.sidewalk);
          m.castShadow = true;
          m.receiveShadow = true;
          armGroup.add(m);
        }
      } else {
        const inSwLen = swEnd - inSwStart;
        addBoxMesh(
          armGroup,
          inSwLen,
          ELEV.sidewalkHeight,
          sidewalkW,
          inSwStart + inSwLen * 0.5,
          ELEV.sidewalkHeight * 0.5,
          inOuter + sidewalkW * 0.5,
          mats.sidewalk,
          tracker,
          { cast: true, receive: true }
        );
      }

      const inCurbStart = outSlip ? branchClearDist : arm.setback;
      if (armEnd > inCurbStart + 0.4) {
        const curbPts: Point2D[] = [];
        if (flare > 0.05 && inCurbStart < flareStart) {
          const yAtStart =
            inCurbStart <= arm.setback + 4
              ? inOuter + flare
              : inOuter +
                flare * (1 - (inCurbStart - (arm.setback + 4)) / Math.max(1, flareStart - (arm.setback + 4)));
          curbPts.push({ x: inCurbStart, y: yAtStart + 0.18 });
          if (inCurbStart < arm.setback + 4) {
            curbPts.push({ x: arm.setback + 4, y: inOuter + flare + 0.18 });
          }
          curbPts.push({ x: flareStart, y: inOuter + 0.18 }, { x: armEnd, y: inOuter + 0.18 });
        } else {
          curbPts.push({ x: inCurbStart, y: inOuter + 0.18 }, { x: armEnd, y: inOuter + 0.18 });
        }
        const inCurbGeom = buildCurbStripGeometry(curbPts, 0.38, ELEV.curbHeight, 0, 3.0, false, tracker);
        if (inCurbGeom) {
          const m = new THREE.Mesh(inCurbGeom, mats.kanstin);
          m.castShadow = true;
          m.receiveShadow = true;
          armGroup.add(m);
        }
      }
    };
    buildInboundCurbAndSidewalk();

    // Physical center median OR double-solid + dashed yellow centerline
    const medianStart = arm.setback + 0.8;
    const medianLen = Math.max(0, armEnd - medianStart);
    const uTurnBay = arm.def.uTurnBay;
    if (arm.def.medianWidth > 0.05 && medianLen > 0) {
      if (uTurnBay?.enabled) {
        const bayX = arm.setback + uTurnBay.distanceBeforeStop;
        const gapHalf = 4.2;
        addMedianSegment3D(
          armGroup,
          medianStart,
          Math.max(0, bayX - gapHalf - medianStart),
          arm.def.medianWidth,
          arm.angleRad,
          shrubs,
          4.2,
          mats,
          tracker
        );
        addMedianSegment3D(
          armGroup,
          bayX + gapHalf,
          Math.max(0, armEnd - (bayX + gapHalf)),
          arm.def.medianWidth,
          arm.angleRad,
          shrubs,
          4.2,
          mats,
          tracker
        );

        // U-turn bay subtle pavement cue
        const uGuide = buildFlatRibbonGeometry(
          [
            { x: bayX - gapHalf, y: 0 },
            { x: bayX + gapHalf, y: 0 },
          ],
          0.18,
          ELEV.markingLine,
          1.5,
          tracker
        );
        if (uGuide) armGroup.add(new THREE.Mesh(uGuide, mats.yellowDashTight));
      } else {
        addMedianSegment3D(
          armGroup,
          medianStart,
          medianLen,
          arm.def.medianWidth,
          arm.angleRad,
          shrubs,
          4.2,
          mats,
          tracker
        );
      }
    } else {
      const noPassEnd = Math.min(armEnd, arm.setback + 28);
      const npLen = Math.max(0, noPassEnd - arm.setback);
      if (npLen > 0.2) {
        const cx = arm.setback + npLen * 0.5;
        addPlaneXZMesh(armGroup, npLen, 0.2, cx, ELEV.markingLine, -0.16, mats.yellowSolid, tracker);
        addPlaneXZMesh(armGroup, npLen, 0.2, cx, ELEV.markingLine, 0.16, mats.yellowSolid, tracker);
      }
      if (armEnd > noPassEnd + 0.5) {
        const dashGeom = buildFlatRibbonGeometry(
          [
            { x: noPassEnd, y: 0 },
            { x: armEnd, y: 0 },
          ],
          0.2,
          ELEV.markingLine,
          4.6,
          tracker
        );
        if (dashGeom) armGroup.add(new THREE.Mesh(dashGeom, mats.yellowDash));
      }
    }

    // Dashed white lane dividers (inbound +Z, outbound -Z)
    let curIn = arm.halfMedian;
    for (let l = 0; l < arm.def.inLanes - 1; l++) {
      curIn += arm.def.inLaneWidths[l];
      const divGeom = buildFlatRibbonGeometry(
        [
          { x: arm.setback, y: curIn },
          { x: armEnd, y: curIn },
        ],
        0.16,
        ELEV.markingLine,
        3.4,
        tracker
      );
      if (divGeom) armGroup.add(new THREE.Mesh(divGeom, mats.whiteDash));
    }
    let curOut = arm.halfMedian;
    for (let l = 0; l < arm.def.outLanes - 1; l++) {
      curOut += arm.def.outLaneWidths[l];
      const divGeom = buildFlatRibbonGeometry(
        [
          { x: arm.setback, y: -curOut },
          { x: armEnd, y: -curOut },
        ],
        0.16,
        ELEV.markingLine,
        3.4,
        tracker
      );
      if (divGeom) armGroup.add(new THREE.Mesh(divGeom, mats.whiteDash));
    }

    // Solid white stop line (inbound side +Z_local)
    const stopW = arm.inWidth + flare;
    addPlaneXZMesh(
      armGroup,
      0.48,
      stopW,
      arm.setback + 0.24,
      ELEV.markingLine,
      arm.halfMedian + stopW * 0.5,
      mats.whiteSolid,
      tracker
    );

    // Emerald dashed exit counting line (outbound side -Z_local)
    const exitGeom = buildFlatRibbonGeometry(
      [
        { x: arm.setback, y: -arm.halfMedian },
        { x: arm.setback, y: -outOuter },
      ],
      0.24,
      ELEV.markingLine,
      1.4,
      tracker
    );
    if (exitGeom) armGroup.add(new THREE.Mesh(exitGeom, mats.emeraldDash));

    // RHK Motor Box behind stop line
    if (arm.def.motorBoxEnabled) {
      addRhkBox3D(
        armGroup,
        arm.setback + 0.5,
        arm.halfMedian + 0.14,
        4.4,
        Math.max(0.5, arm.inWidth - 0.28),
        mats,
        tracker
      );
    }

    // LHT Lane Arrows on inbound lanes
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
      const arrow = new THREE.Mesh(arrowGeoms[mode], customArrowMat);
      arrow.position.set(arm.setback + 6.5, ELEV.markingTop, zOff);
      arrow.rotation.y = Math.PI / 2;
      armGroup.add(arrow);
    }

    // Per-arm LTOR / SLIP badge on outer left side
    if (arm.def.leftTurnOnRed || arm.def.slipLane?.enabled) {
      const badgeLabel = arm.def.slipLane?.enabled ? 'SLIP' : 'LTOR';
      const slipExtra = arm.def.slipLane?.enabled ? arm.def.slipLane.width + 2.4 : 0;
      const badgeTex = makeTextBadgeTexture(
        badgeLabel,
        {
          widthPx: 144,
          heightPx: 96,
          bgColor: 'rgba(16, 185, 129, 0.24)',
          borderColor: '#10B981',
          textColor: '#047857',
          font: '700 42px "JetBrains Mono", monospace',
        },
        tracker
      );
      const badgeMat = tracker.trackMat(
        new THREE.MeshStandardMaterial({
          map: badgeTex,
          transparent: true,
          roughness: 0.72,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      const badgeMesh = addPlaneXZMesh(
        armGroup,
        2.6,
        1.8,
        arm.setback + 9.2,
        ELEV.sidewalkBadge,
        inOuter + flare + 1.5 + slipExtra,
        badgeMat,
        tracker
      );
      let norm = arm.angleRad % (Math.PI * 2);
      if (norm > Math.PI) norm -= Math.PI * 2;
      if (norm <= -Math.PI) norm += Math.PI * 2;
      if (norm > Math.PI / 2 || norm <= -Math.PI / 2) {
        badgeMesh.rotation.y = Math.PI;
      }
    }

    // Map-aware contextual markings
    addArmContextMarkings3D(
      armGroup,
      {
        armId,
        armAngleRad: arm.angleRad,
        stopX: arm.setback,
        armEnd,
        curbZ: inOuter,
        curbFlare: flare,
        slipSetback: arm.def.slipLane?.enabled ? arm.def.slipLane.islandSetback : 0,
        mapCtx,
      },
      mats,
      tracker
    );
  }

  // 6. Slip-lane channelization separators (curb-divider, painted-gore, triangle-island)
  for (const isl of compiled.islands) {
    buildSplitterIsland3D(parent, isl, shrubs, mats, tracker);
  }

  addShrubInstances(parent, shrubs, mats, tracker);

  // 7. Yellow Box Junction marking in center
  if (compiled.topology.yellowBoxEnabled && compiled.centerPolygon.length >= 3) {
    const xs = compiled.centerPolygon.map((p) => p.x);
    const ys = compiled.centerPolygon.map((p) => p.y);
    const halfW = Math.min(12, Math.max(4, (Math.max(...xs) - Math.min(...xs)) * 0.34));
    const halfH = Math.min(12, Math.max(4, (Math.max(...ys) - Math.min(...ys)) * 0.34));
    addYellowBox3D(parent, halfW, halfH, mats, tracker);
  }

  // 8. Signal pole positions matching IntersectionCanvas.tsx
  const sigPositions: SignalPolePosition3D[] = compiled.armOrder.map((armId) => {
    const arm = compiled.armsById[armId];
    return {
      armId,
      x: arm.signalPos.x,
      z: arm.signalPos.y,
      angleRad: arm.angleRad,
      outZ: arm.outDir.y,
    };
  });

  return { sigPositions, extentMeters };
}

export function buildRoadSurfaces3D(
  config: SimConfig,
  compiledTopology: CompiledTopology
): RoadSurfaces3DResult {
  const group = new THREE.Group();
  group.name = 'RoadSurfaces3D';

  const tracker = createTracker();
  const wetAsphalt = (config.environment?.weather ?? 'clear') !== 'clear';
  const envKey = resolveEnvironmentKey(config, compiledTopology);

  let mapCtx = resolveMapContext(config);
  if (mapCtx.id === 'default' && compiledTopology) {
    mapCtx = resolveMapContext({
      environmentId: compiledTopology.topology.id,
      scenarioName: compiledTopology.topology.name,
    });
  }

  const mats = createMaterialBank(wetAsphalt, tracker);
  const isCustomTopo = Boolean(config.customTopology && compiledTopology);

  const built = isCustomTopo
    ? buildCustomTopologyRoad(group, compiledTopology, envKey, mapCtx, mats, tracker)
    : buildStandard4ArmRoad(group, config, envKey, mapCtx, mats, tracker);

  const dispose = () => {
    group.clear();
    for (const g of tracker.geometries) g.dispose();
    for (const m of tracker.materials) m.dispose();
    for (const t of tracker.textures) t.dispose();
    tracker.geometries.length = 0;
    tracker.materials.length = 0;
    tracker.textures.length = 0;
  };

  return {
    group,
    sigPositions: built.sigPositions,
    extentMeters: built.extentMeters,
    dispose,
  };
}
