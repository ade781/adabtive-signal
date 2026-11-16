import { ArmId, Point2D, SimConfig, TurnIntent } from './types';

export interface PathSample {
  x: number;
  y: number;
  heading: number; // radians: 0 = +X (East), Math.PI/2 = +Y (South), -Math.PI/2 = -Y (North), Math.PI = -X (West)
}

export interface VehiclePath {
  turn: TurnIntent;
  stopLineDist: number;
  exitLineDist: number;
  totalPathLength: number;
  sample: (dist: number) => PathSample;
}

export type PathCache = Record<ArmId, Record<TurnIntent, VehiclePath[]>>;

const ARMS: ArmId[] = ['north', 'east', 'south', 'west'];
const TURNS: TurnIntent[] = ['left', 'straight', 'right'];

const DEST_ARM_LHT: Record<ArmId, Record<TurnIntent, ArmId>> = {
  south: { left: 'west', straight: 'north', right: 'east' },
  north: { left: 'east', straight: 'south', right: 'west' },
  west: { left: 'north', straight: 'east', right: 'south' },
  east: { left: 'south', straight: 'west', right: 'north' },
};

export function getDestArm(origin: ArmId, turn: TurnIntent): ArmId {
  return DEST_ARM_LHT[origin][turn];
}

export function getLaneWidth(config: SimConfig): number {
  if (Number.isFinite(config.laneWidth) && config.laneWidth >= 2.5) {
    return config.laneWidth;
  }
  return config.roadWidthPerDirection / Math.max(1, config.lanesPerDirection);
}

export function getEffectiveRoadWidth(config: SimConfig): number {
  return Math.max(1, config.lanesPerDirection) * getLaneWidth(config);
}

/**
 * Distance from centerline (0) to the center of laneIndex (0 = innermost near median, L-1 = outermost near curb)
 * plus optional lateralOffset (for motorcycle filtering within a lane).
 */
export function getLaneOffset(laneIndex: number, lateralOffset: number, config: SimConfig): number {
  const lw = getLaneWidth(config);
  const clampedLane = Math.max(0, Math.min(config.lanesPerDirection - 1, laneIndex));
  return (clampedLane + 0.5) * lw + lateralOffset;
}

export function getApproachStopPoint(
  origin: ArmId,
  offset: number,
  halfBox: number
): { p0: Point2D; dir: Point2D } {
  switch (origin) {
    case 'south':
      return { p0: { x: -offset, y: halfBox }, dir: { x: 0, y: -1 } };
    case 'north':
      return { p0: { x: offset, y: -halfBox }, dir: { x: 0, y: 1 } };
    case 'west':
      return { p0: { x: -halfBox, y: -offset }, dir: { x: 1, y: 0 } };
    case 'east':
      return { p0: { x: halfBox, y: offset }, dir: { x: -1, y: 0 } };
  }
}

export function getExitBoxPoint(
  dest: ArmId,
  offset: number,
  halfBox: number
): { p2: Point2D; dir: Point2D } {
  switch (dest) {
    case 'north':
      return { p2: { x: -offset, y: -halfBox }, dir: { x: 0, y: -1 } };
    case 'south':
      return { p2: { x: offset, y: halfBox }, dir: { x: 0, y: 1 } };
    case 'east':
      return { p2: { x: halfBox, y: -offset }, dir: { x: 1, y: 0 } };
    case 'west':
      return { p2: { x: -halfBox, y: offset }, dir: { x: -1, y: 0 } };
  }
}

export function getTurnRadius(
  turn: TurnIntent,
  laneIndex: number,
  config: SimConfig
): number {
  if (turn === 'straight') return Infinity;
  const halfBox = getEffectiveRoadWidth(config) + 2.0;
  const clampedLane = Math.max(0, Math.min(config.lanesPerDirection - 1, laneIndex));
  const offset = getLaneOffset(clampedLane, 0, config);
  const rawR = turn === 'left' ? halfBox - offset : halfBox + offset;
  return Math.max(3.2, 0.78 * rawR);
}

/**
 * Builds an arc-length-parameterized centerline path for (originArm, turn, laneIndex).
 */
export function buildVehiclePath(
  origin: ArmId,
  turn: TurnIntent,
  laneIndex: number,
  lateralOffset: number,
  config: SimConfig
): VehiclePath {
  const halfBox = getEffectiveRoadWidth(config) + 2.0;
  const approachLen = Math.max(20, config.roadLength);
  const exitLen = Math.max(20, config.roadLength);
  const offset = getLaneOffset(laneIndex, lateralOffset, config);
  const dest = getDestArm(origin, turn);

  const { p0, dir: inDir } = getApproachStopPoint(origin, offset, halfBox);
  const { p2, dir: outDir } = getExitBoxPoint(dest, offset, halfBox);

  const startPt: Point2D = {
    x: p0.x - inDir.x * approachLen,
    y: p0.y - inDir.y * approachLen,
  };

  const inHeading = Math.atan2(inDir.y, inDir.x);
  const outHeading = Math.atan2(outDir.y, outDir.x);
  const stopLineDist = approachLen;

  if (turn === 'straight') {
    const boxLen = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    const exitLineDist = stopLineDist + boxLen;
    const totalPathLength = exitLineDist + exitLen;

    return {
      turn,
      stopLineDist,
      exitLineDist,
      totalPathLength,
      sample: (dist: number): PathSample => {
        const d = Math.max(0, Math.min(totalPathLength, dist));
        return {
          x: startPt.x + inDir.x * d,
          y: startPt.y + inDir.y * d,
          heading: inHeading,
        };
      },
    };
  }

  const p1: Point2D =
    origin === 'north' || origin === 'south'
      ? { x: p0.x, y: p2.y }
      : { x: p2.x, y: p0.y };

  const N = 32;
  const pts: Point2D[] = [];
  const headings: number[] = [];
  const cumLen: number[] = [0];

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
    const dx = 2 * mt * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const dy = 2 * mt * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    const h = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : i === 0 ? inHeading : outHeading;

    pts.push({ x, y });
    headings.push(h);
    if (i > 0) {
      cumLen.push(cumLen[i - 1] + Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y));
    }
  }

  const curveLen = cumLen[N];
  const exitLineDist = stopLineDist + curveLen;
  const totalPathLength = exitLineDist + exitLen;

  return {
    turn,
    stopLineDist,
    exitLineDist,
    totalPathLength,
    sample: (dist: number): PathSample => {
      const d = Math.max(0, Math.min(totalPathLength, dist));
      if (d <= stopLineDist) {
        return {
          x: startPt.x + inDir.x * d,
          y: startPt.y + inDir.y * d,
          heading: inHeading,
        };
      }
      if (d >= exitLineDist) {
        const ed = d - exitLineDist;
        return {
          x: p2.x + outDir.x * ed,
          y: p2.y + outDir.y * ed,
          heading: outHeading,
        };
      }
      const targetS = d - stopLineDist;
      let lo = 0;
      let hi = N;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (cumLen[mid] <= targetS) lo = mid;
        else hi = mid;
      }
      const segLen = Math.max(1e-6, cumLen[hi] - cumLen[lo]);
      const alpha = (targetS - cumLen[lo]) / segLen;
      const x = pts[lo].x + (pts[hi].x - pts[lo].x) * alpha;
      const y = pts[lo].y + (pts[hi].y - pts[lo].y) * alpha;

      let dh = headings[hi] - headings[lo];
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const heading = headings[lo] + dh * alpha;

      return { x, y, heading };
    },
  };
}

/**
 * Pre-computes all centerline paths for every (arm, turn, laneIndex) once per config.
 */
export function createPathCache(config: SimConfig): PathCache {
  const L = Math.max(1, Math.round(config.lanesPerDirection));
  const cache = {} as PathCache;
  for (const arm of ARMS) {
    cache[arm] = {} as Record<TurnIntent, VehiclePath[]>;
    for (const turn of TURNS) {
      cache[arm][turn] = [];
      for (let lane = 0; lane < L; lane++) {
        cache[arm][turn].push(buildVehiclePath(arm, turn, lane, 0, config));
      }
    }
  }
  return cache;
}

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Samples a cached centerline path and applies LHT outward lateral offset
 * (+lateralOffset = outward toward curb, -lateralOffset = inward toward median).
 */
export function sampleWithLateralOffset(
  path: VehiclePath,
  dist: number,
  lateralOffset: number,
  lateralVel = 0,
  speed = 0
): PathSample {
  const base = path.sample(dist);
  let steerYaw = 0;
  if (Math.abs(lateralVel) > 0.02 && speed > 0) {
    const speedScale = Math.min(1, speed / 0.4);
    steerYaw =
      Math.max(-0.38, Math.min(0.38, Math.atan2(-lateralVel, Math.max(1.2, speed)))) *
      speedScale;
  }
  const heading = wrapAngle(base.heading + steerYaw);
  if (Math.abs(lateralOffset) < 1e-4) {
    return steerYaw !== 0 ? { ...base, heading } : base;
  }

  // Smooth cosine taper on turning paths inside [stopLineDist, exitLineDist] to avoid sharp apex cuts
  let taper = 1.0;
  if ((path.turn === 'left' || path.turn === 'right') && dist > path.stopLineDist && dist < path.exitLineDist) {
    const span = path.exitLineDist - path.stopLineDist;
    if (span > 1e-6) {
      const w = (dist - path.stopLineDist) / span;
      taper = 1.0 - 0.65 * 0.5 * (1 - Math.cos(Math.PI * 2 * w));
    }
  }
  const effOffset = lateralOffset * taper;

  // In Canvas 2D (+X East, +Y South), outward-left of heading vector (cos h, sin h) is (sin h, -cos h)
  return {
    x: base.x + Math.sin(base.heading) * effOffset,
    y: base.y - Math.cos(base.heading) * effOffset,
    heading,
  };
}
