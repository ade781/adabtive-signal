import { ARM_ORDER, getArmGreenDuration } from './constants';
import { getLaneWidth } from './geometry';
import {
  ArmDef,
  CompiledArmGeometry,
  CompiledMovementPath,
  CompiledTopology,
  ConflictZone,
  IntersectionTopology,
  IslandPolygon,
  MovementKind,
  MovementPermission,
  SignalPhaseDef,
  SignalPhasePreset,
  SplineSample,
} from './topologyTypes';
import { ArmId, Point2D, SimConfig } from './types';

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function normAngleDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

export function wrapAngleRad(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Intersect two 2D infinite lines: P1 + t*D1 and P2 + u*D2.
 * Returns null if nearly parallel.
 */
function intersectLines(p1: Point2D, d1: Point2D, p2: Point2D, d2: Point2D): { pt: Point2D; t: number; u: number } | null {
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

function sumWidths(arr: number[], count: number, fallback = 3.5): number[] {
  const res: number[] = [];
  for (let i = 0; i < count; i++) {
    const w = arr[i];
    res.push(Number.isFinite(w) && w >= 2.4 ? Math.min(5.0, w) : fallback);
  }
  return res;
}

function computeLaneCenters(widths: number[], halfMedian: number): number[] {
  const centers: number[] = [];
  let cursor = halfMedian;
  for (const w of widths) {
    centers.push(cursor + w * 0.5);
    cursor += w;
  }
  return centers;
}

/**
 * Builds standard signal phases for any N-arm topology according to the selected preset.
 */
export function buildSignalPhasesForTopology(
  arms: ArmDef[],
  preset: SignalPhasePreset,
  yellowDuration: number,
  allRedDuration: number,
  fallbackGreen = 18
): SignalPhaseDef[] {
  if (arms.length === 0) return [];
  const y = Math.max(1, yellowDuration);
  const ar = Math.max(0, allRedDuration);

  // Order arms cleanly (keep N->E->S->W when standard 4-arm)
  const ordered = [...arms];

  if (preset === '2-phase-simultaneous' && ordered.length === 4) {
    // Group opposite pairs (0 & 2 vs 1 & 3 based on sorted angles)
    const byAngle = [...ordered].sort((a, b) => normAngleDeg(a.angleDeg) - normAngleDeg(b.angleDeg));
    const pairA = [byAngle[0], byAngle[2]];
    const pairB = [byAngle[1], byAngle[3]];
    // Keep North-South first if standard arms exist
    const hasNorth = ordered.find((a) => a.id === 'north');
    const firstPair = hasNorth && pairB.some((a) => a.id === 'north') ? pairB : pairA;
    const secondPair = firstPair === pairA ? pairB : pairA;

    const makePairPhase = (idx: number, pair: ArmDef[]): SignalPhaseDef => {
      const green = Math.max(...pair.map((a) => a.baseGreenDuration ?? fallbackGreen));
      const permissions: MovementPermission[] = [];
      for (const arm of pair) {
        permissions.push({ armId: arm.id, movements: ['left', 'straight'], mode: 'protected' });
        permissions.push({ armId: arm.id, movements: ['right', 'uturn'], mode: 'permissive' });
      }
      return {
        id: `phase-2p-${idx}`,
        label: `${pair[0].label} & ${pair[1].label}`,
        permissions,
        baseGreen: green,
        yellowDuration: y,
        allRedDuration: ar,
      };
    };

    return [makePairPhase(1, firstPair), makePairPhase(2, secondPair)];
  }

  if (preset === '3-phase') {
    if (ordered.length === 3) {
      return ordered.map((arm, idx) => ({
        id: `phase-3p-${idx + 1}`,
        label: arm.label,
        permissions: [{ armId: arm.id, movements: ['left', 'straight', 'right', 'uturn'], mode: 'protected' }],
        baseGreen: arm.baseGreenDuration ?? fallbackGreen,
        yellowDuration: y,
        allRedDuration: ar,
      }));
    }
    if (ordered.length >= 4) {
      // Major opposing pair simultaneous + remaining arms individually split
      const byAngle = [...ordered].sort((a, b) => normAngleDeg(a.angleDeg) - normAngleDeg(b.angleDeg));
      const p0 = [byAngle[0], byAngle[2]];
      const rem = byAngle.filter((a) => a.id !== p0[0].id && a.id !== p0[1].id);
      const phases: SignalPhaseDef[] = [
        {
          id: 'phase-3p-main',
          label: `${p0[0].label} & ${p0[1].label}`,
          permissions: p0.flatMap((arm) => [
            { armId: arm.id, movements: ['left', 'straight'] as MovementKind[], mode: 'protected' as const },
            { armId: arm.id, movements: ['right', 'uturn'] as MovementKind[], mode: 'permissive' as const },
          ]),
          baseGreen: Math.max(...p0.map((a) => a.baseGreenDuration ?? fallbackGreen)),
          yellowDuration: y,
          allRedDuration: ar,
        },
      ];
      for (const arm of rem) {
        phases.push({
          id: `phase-3p-${arm.id}`,
          label: arm.label,
          permissions: [{ armId: arm.id, movements: ['left', 'straight', 'right', 'uturn'], mode: 'protected' }],
          baseGreen: arm.baseGreenDuration ?? fallbackGreen,
          yellowDuration: y,
          allRedDuration: ar,
        });
      }
      return phases;
    }
  }

  if (preset === '4-phase-protected-right' && ordered.length === 4) {
    // 2 opposing straight+left phases + 2 opposing protected right-turn arrow phases
    const byAngle = [...ordered].sort((a, b) => normAngleDeg(a.angleDeg) - normAngleDeg(b.angleDeg));
    const pairA = [byAngle[0], byAngle[2]];
    const pairB = [byAngle[1], byAngle[3]];
    const hasNorth = ordered.find((a) => a.id === 'north');
    const p1 = hasNorth && pairB.some((a) => a.id === 'north') ? pairB : pairA;
    const p2 = p1 === pairA ? pairB : pairA;

    const g1 = Math.max(...p1.map((a) => a.baseGreenDuration ?? fallbackGreen));
    const g2 = Math.max(...p2.map((a) => a.baseGreenDuration ?? fallbackGreen));
    const rightG1 = Math.max(8, Math.round(g1 * 0.55));
    const rightG2 = Math.max(8, Math.round(g2 * 0.55));

    return [
      {
        id: 'phase-pr-1-st',
        label: `${p1[0].label} & ${p1[1].label} (Lurus)`,
        permissions: p1.map((arm) => ({ armId: arm.id, movements: ['left', 'straight'], mode: 'protected' })),
        baseGreen: g1,
        yellowDuration: y,
        allRedDuration: ar,
      },
      {
        id: 'phase-pr-1-rt',
        label: `${p1[0].label} & ${p1[1].label} (Panah Kanan)`,
        permissions: p1.map((arm) => ({ armId: arm.id, movements: ['right', 'uturn'], mode: 'protected' })),
        baseGreen: rightG1,
        yellowDuration: y,
        allRedDuration: ar,
      },
      {
        id: 'phase-pr-2-st',
        label: `${p2[0].label} & ${p2[1].label} (Lurus)`,
        permissions: p2.map((arm) => ({ armId: arm.id, movements: ['left', 'straight'], mode: 'protected' })),
        baseGreen: g2,
        yellowDuration: y,
        allRedDuration: ar,
      },
      {
        id: 'phase-pr-2-rt',
        label: `${p2[0].label} & ${p2[1].label} (Panah Kanan)`,
        permissions: p2.map((arm) => ({ armId: arm.id, movements: ['right', 'uturn'], mode: 'protected' })),
        baseGreen: rightG2,
        yellowDuration: y,
        allRedDuration: ar,
      },
    ];
  }

  // Default: split phase (1 arm at a time — 100% compatible with classic 4-phase N->E->S->W and generalizes to N arms)
  return ordered.map((arm) => ({
    id: `phase-split-${arm.id}`,
    label: arm.label,
    permissions: [{ armId: arm.id, movements: ['left', 'straight', 'right', 'uturn'], mode: 'protected' }],
    baseGreen: arm.baseGreenDuration ?? fallbackGreen,
    yellowDuration: y,
    allRedDuration: ar,
  }));
}

const DEFAULT_4_ARM_ANGLES: Record<ArmId, number> = {
  north: 270,
  east: 0,
  south: 90,
  west: 180,
};

const DEFAULT_4_ARM_LABELS: Record<ArmId, string> = {
  north: 'Utara',
  east: 'Timur',
  south: 'Selatan',
  west: 'Barat',
};

/**
 * Converts a standard symmetric SimConfig into an equivalent IntersectionTopology
 * so existing presets, UI controls, and tests remain 100% backward compatible.
 */
export function simConfigToTopology(config: SimConfig): IntersectionTopology {
  if (config.customTopology && config.customTopology.arms.length >= 3) {
    const topo = config.customTopology;
    // Respect signal phase overrides from SimConfig if changed in Simulator
    const phasePreset = config.signalPhasePreset ?? topo.phasePreset;
    const phases =
      phasePreset === 'custom' && topo.phases.length > 0
        ? topo.phases.map((p) => ({
            ...p,
            yellowDuration: config.yellowDuration,
            allRedDuration: config.allRedDuration,
          }))
        : buildSignalPhasesForTopology(
            topo.arms,
            phasePreset,
            config.yellowDuration,
            config.allRedDuration,
            config.greenDuration
          );

    return {
      ...topo,
      phasePreset,
      phases,
      yellowBoxEnabled: config.yellowBoxEnabled ?? topo.yellowBoxEnabled,
    };
  }

  const lw = getLaneWidth(config);
  const lanes = Math.max(1, Math.min(4, Math.round(config.lanesPerDirection)));
  const laneWidths = Array.from({ length: lanes }, () => lw);
  // Keep medianWidth = 0 in classic 4-arm mode so geometry setback matches halfRoad + 2.0 exactly
  // (hasMedian acts as physical barrier preventing oncoming overtaking)
  const arms: ArmDef[] = ARM_ORDER.map((armId) => ({
    id: armId,
    label: config.armNames?.[armId]?.trim() || DEFAULT_4_ARM_LABELS[armId],
    angleDeg: DEFAULT_4_ARM_ANGLES[armId],
    length: config.roadLength,
    inLanes: lanes,
    outLanes: lanes,
    inLaneWidths: [...laneWidths],
    outLaneWidths: [...laneWidths],
    medianWidth: config.hasMedian ? 0.0 : 0.0,
    curbRadiusLeft: 2.2,
    leftTurnOnRed: config.leftTurnOnRed,
    motorBoxEnabled: config.motorBoxEnabled,
    demandWeight: config.armWeights?.[armId] ?? 1.0,
    baseGreenDuration: getArmGreenDuration(config, armId),
  }));

  const phasePreset: SignalPhasePreset = config.signalPhasePreset ?? '4-phase-split';
  const phases = buildSignalPhasesForTopology(
    arms,
    phasePreset,
    config.yellowDuration,
    config.allRedDuration,
    config.greenDuration
  );

  return {
    id: config.environmentId || 'standard-4-arm',
    name: config.scenarioName || 'Simpang 4 Standar',
    arms,
    phasePreset,
    phases,
    yellowBoxEnabled: config.yellowBoxEnabled ?? false,
  };
}

/**
 * Evaluates a cubic Bezier curve and its analytic first/second derivatives for exact heading & curvature.
 */
function evalCubicBezier(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ddx: number;
  ddy: number;
} {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const x = mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x;
  const y = mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y;
  const dx = 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
  const dy = 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);
  const ddx = 6 * mt * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x);
  const ddy = 6 * mt * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y);
  return { x, y, dx, dy, ddx, ddy };
}

function buildCubicPath(opts: {
  key: string;
  originArmId: string;
  destArmId: string;
  movement: MovementKind;
  originLane: number;
  destLane: number;
  isSlipLane: boolean;
  isUTurn: boolean;
  startPt: Point2D;
  p0: Point2D;
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
  inDir: Point2D;
  outDir: Point2D;
  approachLen: number;
  exitLen: number;
}): CompiledMovementPath {
  const {
    key,
    originArmId,
    destArmId,
    movement,
    originLane,
    destLane,
    isSlipLane,
    isUTurn,
    startPt,
    p0,
    p1,
    p2,
    p3,
    inDir,
    outDir,
    approachLen,
    exitLen,
  } = opts;

  const inHeading = Math.atan2(inDir.y, inDir.x);
  const outHeading = Math.atan2(outDir.y, outDir.x);
  const stopLineDist = approachLen;

  const N = 40;
  const pts: Point2D[] = [];
  const headings: number[] = [];
  const curvatures: number[] = [];
  const cumLen: number[] = [0];
  let maxAbsKappa = 0;

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ev = evalCubicBezier(p0, p1, p2, p3, t);
    const speedMag = Math.hypot(ev.dx, ev.dy);
    const h = speedMag > 1e-5 ? Math.atan2(ev.dy, ev.dx) : i === 0 ? inHeading : outHeading;
    const kappa = speedMag > 1e-4 ? (ev.dx * ev.ddy - ev.dy * ev.ddx) / (speedMag * speedMag * speedMag) : 0;
    const clampedKappa = Math.max(-0.5, Math.min(0.5, kappa));

    pts.push({ x: ev.x, y: ev.y });
    headings.push(h);
    curvatures.push(clampedKappa);
    if (Math.abs(clampedKappa) > maxAbsKappa) maxAbsKappa = Math.abs(clampedKappa);
    if (i > 0) {
      cumLen.push(cumLen[i - 1] + Math.hypot(ev.x - pts[i - 1].x, ev.y - pts[i - 1].y));
    }
  }

  const curveLen = Math.max(0.5, cumLen[N]);
  const exitLineDist = stopLineDist + curveLen;
  const totalPathLength = exitLineDist + exitLen;
  const minRadius = maxAbsKappa > 1e-4 ? Math.max(2.6, 1 / maxAbsKappa) : Infinity;

  const sample = (dist: number): SplineSample => {
    const d = Math.max(0, Math.min(totalPathLength, dist));
    if (d <= stopLineDist) {
      return {
        x: startPt.x + inDir.x * d,
        y: startPt.y + inDir.y * d,
        heading: inHeading,
        curvature: 0,
      };
    }
    if (d >= exitLineDist) {
      const ed = d - exitLineDist;
      return {
        x: p3.x + outDir.x * ed,
        y: p3.y + outDir.y * ed,
        heading: outHeading,
        curvature: 0,
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
    const dh = wrapAngleRad(headings[hi] - headings[lo]);
    const heading = wrapAngleRad(headings[lo] + dh * alpha);
    const curvature = curvatures[lo] + (curvatures[hi] - curvatures[lo]) * alpha;
    return { x, y, heading, curvature };
  };

  const maxCurvatureInRange = (sStart: number, sEnd: number): number => {
    if (maxAbsKappa < 1e-4 || sEnd <= stopLineDist || sStart >= exitLineDist) return 0;
    const a = Math.max(0, sStart - stopLineDist);
    const b = Math.min(curveLen, sEnd - stopLineDist);
    let best = 0;
    for (let i = 0; i <= N; i++) {
      if (cumLen[i] >= a - 1.0 && cumLen[i] <= b + 1.0) {
        const k = Math.abs(curvatures[i]);
        if (k > best) best = k;
      }
    }
    return best;
  };

  return {
    key,
    originArmId,
    destArmId,
    movement,
    originLane,
    destLane,
    isSlipLane,
    isUTurn,
    stopLineDist,
    exitLineDist,
    totalPathLength,
    minRadius,
    curvePoints: pts,
    sample,
    maxCurvatureInRange,
  };
}

/**
 * Classifies turn movement in LHT given inbound travel angle and outbound exit angle (Y-down).
 * Cross product in Y-down:
 *   sin(out - in) < 0 => counter-clockwise => LEFT turn in Canvas 2D Y-down!
 *   sin(out - in) > 0 => clockwise => RIGHT turn in Canvas 2D Y-down!
 */
function classifyMovement(originAngleDeg: number, destAngleDeg: number, isLeftmost: boolean, isRightmost: boolean): MovementKind {
  // Inbound travel direction is originAngle + 180
  const inDirDeg = normAngleDeg(originAngleDeg + 180);
  const delta = wrapAngleRad(degToRad(destAngleDeg - inDirDeg)); // (-pi, pi]
  const absDeg = Math.abs((delta * 180) / Math.PI);
  if (absDeg <= 42) return 'straight';
  if (delta < 0) return 'left';
  if (delta > 0) return 'right';
  return isLeftmost ? 'left' : isRightmost ? 'right' : 'straight';
}

function getMovementPriorityRank(m: MovementKind): number {
  switch (m) {
    case 'straight':
      return 3;
    case 'left':
      return 2;
    case 'right':
      return 1;
    case 'uturn':
      return 0;
  }
}

/**
 * Compiles any N-arm IntersectionTopology (3-5 arms, arbitrary angles, asymmetric lane counts/widths,
 * physical medians, slip lanes + triangular islands, U-turn bays) into geometric primitives,
 * smooth curvature-annotated cubic splines, and precomputed conflict zones.
 */
export function compileTopology(topology: IntersectionTopology): CompiledTopology {
  const rawArms = topology.arms.slice(0, 5);
  const armOrder = rawArms.map((a) => a.id);

  // Sort copy clockwise in Canvas Y-down (increasing angleDeg: 0=E -> 90=S -> 180=W -> 270=N)
  const cwArms = [...rawArms].sort((a, b) => normAngleDeg(a.angleDeg) - normAngleDeg(b.angleDeg));
  const N = cwArms.length;

  // Step 1: Base vectors & lane widths per arm
  const prelim: Record<
    string,
    {
      def: ArmDef;
      angleRad: number;
      outDir: Point2D;
      inDir: Point2D;
      inLeftNormal: Point2D;
      inLaneWidths: number[];
      outLaneWidths: number[];
      inWidth: number;
      outWidth: number;
      halfMedian: number;
      inLaneCenters: number[];
      outLaneCenters: number[];
      leftNeighborArmId: string;
      rightNeighborArmId: string;
    }
  > = {};

  for (let i = 0; i < N; i++) {
    const def = cwArms[i];
    const angleRad = degToRad(normAngleDeg(def.angleDeg));
    const outDir: Point2D = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const inDir: Point2D = { x: -outDir.x, y: -outDir.y };
    // In Canvas Y-down, 90° CCW (left of travel inDir) is (inDir.y, -inDir.x) = (-outDir.y, outDir.x)
    const inLeftNormal: Point2D = { x: inDir.y, y: -inDir.x };

    const inLanes = Math.max(1, Math.min(4, Math.round(def.inLanes)));
    const outLanes = Math.max(1, Math.min(4, Math.round(def.outLanes)));
    const inLaneWidths = sumWidths(def.inLaneWidths, inLanes, 3.5);
    const outLaneWidths = sumWidths(def.outLaneWidths, outLanes, 3.5);
    const inWidth = inLaneWidths.reduce((s, w) => s + w, 0);
    const outWidth = outLaneWidths.reduce((s, w) => s + w, 0);
    const halfMedian = Math.max(0, Math.min(3.5, def.medianWidth || 0)) * 0.5;

    // Looking INWARD along arm i:
    // Left turn goes CCW (next arm clockwise in outDir order! Wait: check South=90° -> West=180° -> North=270° -> East=0°)
    // South(90°) inward = North(-90°). Left of North is West(180°), which is index + 1 in CW angle order!
    // Right of North is East(0°), which is index - 1 in CW angle order!
    const leftNeighbor = cwArms[(i + 1) % N];
    const rightNeighbor = cwArms[(i - 1 + N) % N];

    prelim[def.id] = {
      def: { ...def, inLanes, outLanes, inLaneWidths, outLaneWidths },
      angleRad,
      outDir,
      inDir,
      inLeftNormal,
      inLaneWidths,
      outLaneWidths,
      inWidth,
      outWidth,
      halfMedian,
      inLaneCenters: computeLaneCenters(inLaneWidths, halfMedian),
      outLaneCenters: computeLaneCenters(outLaneWidths, halfMedian),
      leftNeighborArmId: leftNeighbor.id,
      rightNeighborArmId: rightNeighbor.id,
    };
  }

  // Step 2: Analytic setback computation from adjacent arm outer-curb intersections
  // Between arm A (index i) and its leftNeighbor B (index i+1):
  //   Arm A's inbound outer-left curb is offset +(halfMedian + inWidth) along A.inLeftNormal
  //   Arm B's outbound outer-left curb (which faces arm A!) is offset -(halfMedian + outWidth) along B.inLeftNormal
  const setbacks: Record<string, number> = {};
  for (const a of cwArms) {
    const p = prelim[a.id];
    setbacks[a.id] = Math.max(p.halfMedian + Math.max(p.inWidth, p.outWidth) + 2.0, 5.5);
  }

  const cornerIntersections: Point2D[] = [];
  for (let i = 0; i < N; i++) {
    const a = prelim[cwArms[i].id];
    const b = prelim[cwArms[(i + 1) % N].id];

    const aOuterOff = a.halfMedian + a.inWidth + (a.def.curbFlareLeft ?? 0);
    const bOuterOff = b.halfMedian + b.outWidth;

    const pA: Point2D = { x: a.inLeftNormal.x * aOuterOff, y: a.inLeftNormal.y * aOuterOff };
    const pB: Point2D = { x: -b.inLeftNormal.x * bOuterOff, y: -b.inLeftNormal.y * bOuterOff };

    const inter = intersectLines(pA, a.outDir, pB, b.outDir);
    const filletMargin = Math.max(2.0, Math.min(8.0, (a.def.curbRadiusLeft || 2.2) * 0.65));
    if (inter && Number.isFinite(inter.t) && Number.isFinite(inter.u) && Math.hypot(inter.pt.x, inter.pt.y) < 42) {
      cornerIntersections.push(inter.pt);
      const needA = Math.max(0, inter.t) + filletMargin;
      const needB = Math.max(0, inter.u) + filletMargin;
      setbacks[a.def.id] = Math.max(setbacks[a.def.id], needA);
      setbacks[b.def.id] = Math.max(setbacks[b.def.id], needB);
    } else {
      // Nearly collinear (180° T-junction top bar): push setback safely beyond perpendicular road width
      const fallback = Math.max(aOuterOff, bOuterOff) + filletMargin;
      setbacks[a.def.id] = Math.max(setbacks[a.def.id], fallback);
      setbacks[b.def.id] = Math.max(setbacks[b.def.id], fallback);
      cornerIntersections.push({
        x: pA.x + a.outDir.x * fallback,
        y: pA.y + a.outDir.y * fallback,
      });
    }
  }

  // Clamp setbacks reasonably
  for (const id of Object.keys(setbacks)) {
    setbacks[id] = Math.max(5.0, Math.min(34.0, +setbacks[id].toFixed(2)));
  }

  // Step 3: Build CompiledArmGeometry including destination mapping and signal positions
  const armsById: Record<string, CompiledArmGeometry> = {};
  let maxExtentMeters = 60;

  for (const aDef of rawArms) {
    const p = prelim[aDef.id];
    const setback = setbacks[aDef.id];
    maxExtentMeters = Math.max(maxExtentMeters, setback + p.def.length);

    const destByMovement: Partial<Record<MovementKind, string>> = {};
    const movementByDest: Record<string, MovementKind> = {};

    // Always map leftNeighbor -> 'left' and rightNeighbor -> 'right' when N >= 3
    // And find best opposite arm for 'straight'
    let straightArmId: string | null = null;
    let bestStraightDelta = 52; // degrees tolerance from 180°
    for (const other of rawArms) {
      if (other.id === aDef.id) continue;
      const inDirDeg = normAngleDeg(aDef.angleDeg + 180);
      const diff = Math.abs((wrapAngleRad(degToRad(other.angleDeg - inDirDeg)) * 180) / Math.PI);
      if (diff < bestStraightDelta) {
        bestStraightDelta = diff;
        straightArmId = other.id;
      }
    }

    if (straightArmId) {
      destByMovement.straight = straightArmId;
      movementByDest[straightArmId] = 'straight';
    }
    if (p.leftNeighborArmId !== straightArmId) {
      destByMovement.left = p.leftNeighborArmId;
      movementByDest[p.leftNeighborArmId] = 'left';
    }
    if (p.rightNeighborArmId !== straightArmId && p.rightNeighborArmId !== destByMovement.left) {
      destByMovement.right = p.rightNeighborArmId;
      movementByDest[p.rightNeighborArmId] = 'right';
    }

    // Any extra arms (e.g. 5-arm intersection) are classified geometrically
    for (const other of rawArms) {
      if (other.id === aDef.id || movementByDest[other.id]) continue;
      const kind = classifyMovement(
        aDef.angleDeg,
        other.angleDeg,
        other.id === p.leftNeighborArmId,
        other.id === p.rightNeighborArmId
      );
      movementByDest[other.id] = kind;
      if (!destByMovement[kind]) destByMovement[kind] = other.id;
    }

    if (p.def.uTurnBay?.enabled) {
      destByMovement.uturn = aDef.id;
    }

    // Signal pole sits just outside the inbound left curb behind stop line
    const sigLat = p.halfMedian + p.inWidth + (p.def.curbFlareLeft ?? 0) + 2.7;
    const sigDist = setback + 2.7;
    const signalPos: Point2D = {
      x: p.outDir.x * sigDist + p.inLeftNormal.x * sigLat,
      y: p.outDir.y * sigDist + p.inLeftNormal.y * sigLat,
    };

    armsById[aDef.id] = {
      def: p.def,
      angleRad: p.angleRad,
      outDir: p.outDir,
      inDir: p.inDir,
      inLeftNormal: p.inLeftNormal,
      inWidth: p.inWidth,
      outWidth: p.outWidth,
      halfMedian: p.halfMedian,
      setback,
      inLaneCenters: p.inLaneCenters,
      outLaneCenters: p.outLaneCenters,
      leftNeighborArmId: p.leftNeighborArmId,
      rightNeighborArmId: p.rightNeighborArmId,
      straightArmId,
      destByMovement,
      movementByDest,
      signalPos,
    };
  }

  // Step 4: Build center junction polygon (ordered around (0,0) via cwArms)
  const centerPolygon: Point2D[] = [];
  for (let i = 0; i < N; i++) {
    const arm = armsById[cwArms[i].id];
    const inOuter = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0);
    const outOuter = arm.halfMedian + arm.outWidth;
    // Outbound edge point (facing rightNeighbor / previous CW arm)
    centerPolygon.push({
      x: arm.outDir.x * arm.setback - arm.inLeftNormal.x * outOuter,
      y: arm.outDir.y * arm.setback - arm.inLeftNormal.y * outOuter,
    });
    // Inbound edge point (facing leftNeighbor / next CW arm)
    centerPolygon.push({
      x: arm.outDir.x * arm.setback + arm.inLeftNormal.x * inOuter,
      y: arm.outDir.y * arm.setback + arm.inLeftNormal.y * inOuter,
    });
  }

  // Step 5: Build all movement splines + Slip Lanes + Triangular Islands + U-Turn bays
  const pathsByKey: Record<string, CompiledMovementPath> = {};
  const pathLookup: Record<string, Partial<Record<MovementKind, CompiledMovementPath[]>>> = {};
  const slipPathsByArm: Record<string, CompiledMovementPath> = {};
  const islands: IslandPolygon[] = [];

  for (const originId of armOrder) {
    const origin = armsById[originId];
    pathLookup[originId] = {};

    const movementsToBuild: MovementKind[] = ['left', 'straight', 'right'];
    for (const movement of movementsToBuild) {
      const destId = origin.destByMovement[movement];
      if (!destId) continue;
      const dest = armsById[destId];
      const list: CompiledMovementPath[] = [];

      for (let lane = 0; lane < origin.def.inLanes; lane++) {
        // Map inbound lane to destination lane cleanly while preserving parallel lane parity (and handling bottlenecks!)
        let destLane = Math.min(lane, dest.def.outLanes - 1);
        if (origin.def.inLanes === dest.def.outLanes) {
          destLane = lane;
        } else if (movement === 'left') {
          destLane = dest.def.outLanes - 1;
        } else if (movement === 'right') {
          destLane = 0;
        } else if (origin.def.inLanes > 1 && dest.def.outLanes > 1) {
          destLane = Math.min(
            dest.def.outLanes - 1,
            Math.round((lane / (origin.def.inLanes - 1)) * (dest.def.outLanes - 1))
          );
        }

        const inOff = origin.inLaneCenters[lane];
        const outOff = dest.outLaneCenters[destLane];

        const p0: Point2D = {
          x: origin.outDir.x * origin.setback + origin.inLeftNormal.x * inOff,
          y: origin.outDir.y * origin.setback + origin.inLeftNormal.y * inOff,
        };
        const p3: Point2D = {
          x: dest.outDir.x * dest.setback - dest.inLeftNormal.x * outOff,
          y: dest.outDir.y * dest.setback - dest.inLeftNormal.y * outOff,
        };
        const startPt: Point2D = {
          x: p0.x - origin.inDir.x * origin.def.length,
          y: p0.y - origin.inDir.y * origin.def.length,
        };

        // Compute smooth cubic Bezier control points P1 & P2 honoring entry/exit tangents
        const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
        const tangentInter = intersectLines(p0, origin.inDir, p3, dest.outDir);
        let p1: Point2D;
        let p2: Point2D;

        if (movement === 'straight' && Math.abs(wrapAngleRad(Math.atan2(origin.inDir.y, origin.inDir.x) - Math.atan2(dest.outDir.y, dest.outDir.x))) < 0.08) {
          const handle = chord * 0.35;
          p1 = { x: p0.x + origin.inDir.x * handle, y: p0.y + origin.inDir.y * handle };
          p2 = { x: p3.x - dest.outDir.x * handle, y: p3.y - dest.outDir.y * handle };
        } else if (tangentInter && tangentInter.t > 0.5 && tangentInter.u < -0.5 && tangentInter.t < chord * 1.4 && -tangentInter.u < chord * 1.4) {
          // Exact quadratic-equivalent cubic Bezier through tangent intersection (2/3 rule)
          const k = 0.66;
          p1 = { x: p0.x + origin.inDir.x * (tangentInter.t * k), y: p0.y + origin.inDir.y * (tangentInter.t * k) };
          p2 = { x: p3.x + dest.outDir.x * (tangentInter.u * k), y: p3.y + dest.outDir.y * (tangentInter.u * k) };
        } else {
          const handle = Math.max(3.5, chord * 0.42);
          p1 = { x: p0.x + origin.inDir.x * handle, y: p0.y + origin.inDir.y * handle };
          p2 = { x: p3.x - dest.outDir.x * handle, y: p3.y - dest.outDir.y * handle };
        }

        const key = `${originId}:${destId}:${lane}:main`;
        const compiled = buildCubicPath({
          key,
          originArmId: originId,
          destArmId: destId,
          movement,
          originLane: lane,
          destLane,
          isSlipLane: false,
          isUTurn: false,
          startPt,
          p0,
          p1,
          p2,
          p3,
          inDir: origin.inDir,
          outDir: dest.outDir,
          approachLen: origin.def.length,
          exitLen: dest.def.length,
        });
        pathsByKey[key] = compiled;
        list.push(compiled);
      }

      pathLookup[originId][movement] = list;
    }

    // Channelized Slip Lane + Triangular Splitter Island (e.g. Simpang Giwangan Jogja!)
    const leftDestId = origin.destByMovement.left;
    if (origin.def.slipLane?.enabled && leftDestId) {
      const dest = armsById[leftDestId];
      const slipW = Math.max(2.8, Math.min(4.5, origin.def.slipLane.width || 3.4));
      const islandSetback = Math.max(10, Math.min(30, origin.def.slipLane.islandSetback || 16));
      const leftLaneIdx = origin.def.inLanes - 1;
      const destOuterLane = dest.def.outLanes - 1;

      // Branch starts at outer lane centerline at (setback + islandSetback) from center
      const originOuterLat = origin.inLaneCenters[leftLaneIdx];
      const destOuterLat = dest.outLaneCenters[destOuterLane];
      const branchDist = origin.setback + islandSetback;
      const mergeDist = dest.setback + islandSetback * 0.9;

      // Slip lane swings OUTSIDE the main corner by ~slipW + 1.8m to leave space for the triangular island
      const p0: Point2D = {
        x: origin.outDir.x * branchDist + origin.inLeftNormal.x * (originOuterLat + slipW * 0.35),
        y: origin.outDir.y * branchDist + origin.inLeftNormal.y * (originOuterLat + slipW * 0.35),
      };
      const p3: Point2D = {
        x: dest.outDir.x * mergeDist - dest.inLeftNormal.x * (destOuterLat + slipW * 0.35),
        y: dest.outDir.y * mergeDist - dest.inLeftNormal.y * (destOuterLat + slipW * 0.35),
      };
      const startPt: Point2D = {
        x: p0.x - origin.inDir.x * Math.max(15, origin.def.length - islandSetback),
        y: p0.y - origin.inDir.y * Math.max(15, origin.def.length - islandSetback),
      };

      // Outer arc bulge away from origin so it clears the triangular splitter island cleanly
      const cornerDirX = origin.outDir.x + dest.outDir.x;
      const cornerDirY = origin.outDir.y + dest.outDir.y;
      const cornerLen = Math.hypot(cornerDirX, cornerDirY) || 1;
      const cornerUnit = { x: cornerDirX / cornerLen, y: cornerDirY / cornerLen };

      const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const handle = Math.max(4.5, chord * 0.38);
      const p1: Point2D = {
        x: p0.x + origin.inDir.x * handle * 0.65 + cornerUnit.x * (slipW * 0.75),
        y: p0.y + origin.inDir.y * handle * 0.65 + cornerUnit.y * (slipW * 0.75),
      };
      const p2: Point2D = {
        x: p3.x - dest.outDir.x * handle * 0.65 + cornerUnit.x * (slipW * 0.75),
        y: p3.y - dest.outDir.y * handle * 0.65 + cornerUnit.y * (slipW * 0.75),
      };

      const key = `${originId}:${leftDestId}:${leftLaneIdx}:slip`;
      const slipPath = buildCubicPath({
        key,
        originArmId: originId,
        destArmId: leftDestId,
        movement: 'left',
        originLane: leftLaneIdx,
        destLane: destOuterLane,
        isSlipLane: true,
        isUTurn: false,
        startPt,
        p0,
        p1,
        p2,
        p3,
        inDir: origin.inDir,
        outDir: dest.outDir,
        approachLen: Math.max(15, origin.def.length - islandSetback),
        exitLen: Math.max(15, dest.def.length - islandSetback * 0.9),
      });
      pathsByKey[key] = slipPath;
      slipPathsByArm[originId] = slipPath;

      // Triangular splitter island polygon sitting between main corner and inner edge of slip lane
      const vOriginStop: Point2D = {
        x: origin.outDir.x * (origin.setback + 1.2) + origin.inLeftNormal.x * (origin.halfMedian + origin.inWidth + 0.6),
        y: origin.outDir.y * (origin.setback + 1.2) + origin.inLeftNormal.y * (origin.halfMedian + origin.inWidth + 0.6),
      };
      const vOriginNose: Point2D = {
        x: origin.outDir.x * (branchDist - 2.2) + origin.inLeftNormal.x * (origin.halfMedian + origin.inWidth + 0.4),
        y: origin.outDir.y * (branchDist - 2.2) + origin.inLeftNormal.y * (origin.halfMedian + origin.inWidth + 0.4),
      };
      const vDestNose: Point2D = {
        x: dest.outDir.x * (mergeDist - 2.2) - dest.inLeftNormal.x * (dest.halfMedian + dest.outWidth + 0.4),
        y: dest.outDir.y * (mergeDist - 2.2) - dest.inLeftNormal.y * (dest.halfMedian + dest.outWidth + 0.4),
      };
      const vDestExit: Point2D = {
        x: dest.outDir.x * (dest.setback + 1.2) - dest.inLeftNormal.x * (dest.halfMedian + dest.outWidth + 0.6),
        y: dest.outDir.y * (dest.setback + 1.2) - dest.inLeftNormal.y * (dest.halfMedian + dest.outWidth + 0.6),
      };

      const polyPts = [vOriginNose, vOriginStop, vDestExit, vDestNose];
      const centroid: Point2D = {
        x: polyPts.reduce((s, pt) => s + pt.x, 0) / polyPts.length,
        y: polyPts.reduce((s, pt) => s + pt.y, 0) / polyPts.length,
      };
      islands.push({
        armId: originId,
        destArmId: leftDestId,
        points: polyPts,
        centroid,
        slipLaneCenterPts: slipPath.curvePoints,
        slipLaneWidth: slipW,
      });
    }

    // Pre-intersection U-turn bay spline
    if (origin.def.uTurnBay?.enabled) {
      const bayDist = Math.max(14, Math.min(origin.def.length - 12, origin.def.uTurnBay.distanceBeforeStop || 26));
      const turnDistFromCenter = origin.setback + bayDist;
      const inOff = origin.inLaneCenters[0];
      const outOff = origin.outLaneCenters[0];

      const p0: Point2D = {
        x: origin.outDir.x * turnDistFromCenter + origin.inLeftNormal.x * inOff,
        y: origin.outDir.y * turnDistFromCenter + origin.inLeftNormal.y * inOff,
      };
      const p3: Point2D = {
        x: origin.outDir.x * turnDistFromCenter - origin.inLeftNormal.x * outOff,
        y: origin.outDir.y * turnDistFromCenter - origin.inLeftNormal.y * outOff,
      };
      const startPt: Point2D = {
        x: p0.x - origin.inDir.x * Math.max(12, origin.def.length - bayDist),
        y: p0.y - origin.inDir.y * Math.max(12, origin.def.length - bayDist),
      };
      const uDepth = Math.max(4.5, (inOff + outOff) * 1.15);
      const p1: Point2D = { x: p0.x + origin.inDir.x * uDepth, y: p0.y + origin.inDir.y * uDepth };
      const p2: Point2D = { x: p3.x + origin.inDir.x * uDepth, y: p3.y + origin.inDir.y * uDepth };

      const key = `${originId}:${originId}:0:uturn`;
      const uPath = buildCubicPath({
        key,
        originArmId: originId,
        destArmId: originId,
        movement: 'uturn',
        originLane: 0,
        destLane: 0,
        isSlipLane: false,
        isUTurn: true,
        startPt,
        p0,
        p1,
        p2,
        p3,
        inDir: origin.inDir,
        outDir: origin.outDir,
        approachLen: Math.max(12, origin.def.length - bayDist),
        exitLen: Math.max(12, origin.def.length - bayDist),
      });
      pathsByKey[key] = uPath;
      pathLookup[originId].uturn = [uPath];
    }
  }

  // Step 6: Precompute geometric conflict zones between movement paths from different arms
  const conflictZones: ConflictZone[] = [];
  const conflictsByPathKey: Record<string, ConflictZone[]> = {};
  const allPaths = Object.values(pathsByKey);
  let conflictIdCounter = 1;

  for (let i = 0; i < allPaths.length; i++) {
    const pa = allPaths[i];
    if (pa.isUTurn) continue;
    for (let j = i + 1; j < allPaths.length; j++) {
      const pb = allPaths[j];
      if (pb.isUTurn || pa.originArmId === pb.originArmId) continue;

      // Coarse sample intersection check inside each curve
      let bestDist = Infinity;
      let bestSa = 0;
      let bestSb = 0;
      let bestPt: Point2D = { x: 0, y: 0 };

      const stepA = Math.max(1.0, (pa.exitLineDist - pa.stopLineDist) / 14);
      const stepB = Math.max(1.0, (pb.exitLineDist - pb.stopLineDist) / 14);
      for (let sa = pa.stopLineDist; sa <= pa.exitLineDist + 2.0; sa += stepA) {
        const ptA = pa.sample(sa);
        for (let sb = pb.stopLineDist; sb <= pb.exitLineDist + 2.0; sb += stepB) {
          const ptB = pb.sample(sb);
          const d = Math.hypot(ptA.x - ptB.x, ptA.y - ptB.y);
          if (d < bestDist) {
            bestDist = d;
            bestSa = sa;
            bestSb = sb;
            bestPt = { x: (ptA.x + ptB.x) * 0.5, y: (ptA.y + ptB.y) * 0.5 };
          }
        }
      }

      if (bestDist <= 2.35) {
        const isMerge = pa.destArmId === pb.destArmId;
        const armA = armsById[pa.originArmId];
        const armB = armsById[pb.originArmId];
        const isOppositeArms =
          armA.straightArmId === pb.originArmId || armB.straightArmId === pa.originArmId;
        const type: ConflictZone['type'] = isMerge
          ? 'merge'
          : isOppositeArms && (pa.movement === 'right' || pb.movement === 'right')
          ? 'opposing-turn'
          : 'crossing';

        const rankA = getMovementPriorityRank(pa.movement);
        const rankB = getMovementPriorityRank(pb.movement);
        const priority: ConflictZone['priority'] =
          pa.isSlipLane && !pb.isSlipLane
            ? 'B'
            : !pa.isSlipLane && pb.isSlipLane
            ? 'A'
            : rankA > rankB
            ? 'A'
            : rankB > rankA
            ? 'B'
            : 'equal';

        const zone: ConflictZone = {
          id: `cz-${conflictIdCounter++}`,
          pathKeyA: pa.key,
          pathKeyB: pb.key,
          originArmA: pa.originArmId,
          originArmB: pb.originArmId,
          movementA: pa.movement,
          movementB: pb.movement,
          sA: bestSa,
          sB: bestSb,
          point: bestPt,
          type,
          priority,
        };
        conflictZones.push(zone);
        (conflictsByPathKey[pa.key] ??= []).push(zone);
        (conflictsByPathKey[pb.key] ??= []).push(zone);
      }
    }
  }

  return {
    topology,
    armOrder,
    armsById,
    centerPolygon,
    islands,
    pathsByKey,
    pathLookup,
    slipPathsByArm,
    conflictZones,
    conflictsByPathKey,
    maxExtentMeters,
  };
}
