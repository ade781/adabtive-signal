import { canFilterSideBySide, effClearanceWidth, getGlobalLat, type SimVehicle } from './behaviors';
import { type DisciplineParams } from './conflictResolver';
import { type WeatherPhysicsProfile } from './environmentDynamics';
import { type CompiledArmGeometry, type CompiledTopology } from './topologyTypes';
import { type SignalColor, type SimConfig } from './types';

export interface MotorcycleCorridorScore {
  targetGlobalLat: number;
  targetLane: number;
  isRhkPacking: boolean;
  crossingMarking: boolean;
}

export interface EvaluateMotorcycleCorridorParams {
  v: SimVehicle;
  vehicles: readonly SimVehicle[];
  config: SimConfig;
  topology: CompiledTopology;
  armGeom: CompiledArmGeometry;
  lw: number;
  roadW: number;
  light: SignalColor;
  desiredV: number;
  nearestGap: number;
  blockingLeader: SimVehicle | null;
  weather?: WeatherPhysicsProfile;
  hasPhysicalMedian: boolean;
  discipline?: DisciplineParams;
}

interface SameArmNeighbor {
  distAlong: number;
  longDiff: number;
  length: number;
  halfSumLen: number;
  lat: number;
  targetLat: number;
  effW: number;
  pad: number;
  speed: number;
  comfortDecel: number;
  minGap: number;
  isHeavy: boolean;
  turn: SimVehicle['turn'];
  wideSwingState: SimVehicle['wideSwingState'];
  stopLineDist: number;
  isWideTurningHeavy: boolean;
}

interface OpposingExitNeighbor {
  worldSideLat: number;
  padOpp: number;
}

// Module-level reusable scratch buffers & scalar slots to eliminate per-tick GC allocations.
const candBuf: number[] = [];
const gutterBuf: number[] = [];
const sameArmPool: SameArmNeighbor[] = [];
const oppExitPool: OpposingExitNeighbor[] = [];
let evalClear = true;
let evalForwardClear = 0;
let evalScore = -Infinity;

function clamp(val: number, lo: number, hi: number): number {
  return val < lo ? lo : val > hi ? hi : val;
}

function pushCandidate(val: number, minBound: number, maxBound: number): void {
  if (val < minBound - 1e-4 || val > maxBound + 1e-4) return;
  const c = clamp(val, minBound, maxBound);
  for (let i = 0; i < candBuf.length; i++) {
    if (Math.abs(candBuf[i] - c) < 0.08) return;
  }
  candBuf.push(c);
}

function borrowSameArmRecord(idx: number): SameArmNeighbor {
  if (idx < sameArmPool.length) return sameArmPool[idx];
  const rec: SameArmNeighbor = {
    distAlong: 0,
    longDiff: 0,
    length: 0,
    halfSumLen: 0,
    lat: 0,
    targetLat: 0,
    effW: 0,
    pad: 0,
    speed: 0,
    comfortDecel: 0,
    minGap: 0,
    isHeavy: false,
    turn: 'straight',
    wideSwingState: undefined,
    stopLineDist: 0,
    isWideTurningHeavy: false,
  };
  sameArmPool.push(rec);
  return rec;
}

function borrowOppExitRecord(idx: number): OpposingExitNeighbor {
  if (idx < oppExitPool.length) return oppExitPool[idx];
  const rec: OpposingExitNeighbor = { worldSideLat: 0, padOpp: 0 };
  oppExitPool.push(rec);
  return rec;
}

function resolveTargetLane(
  candLat: number,
  v: SimVehicle,
  inLanes: number,
  halfMedian: number,
  armLw: number,
  armGeom: CompiledArmGeometry,
  topology: CompiledTopology
): number {
  if (v.turn !== 'straight' || inLanes < 2) return v.laneIndex;
  let targetLane = v.laneIndex;
  if (candLat < halfMedian) {
    targetLane = 0;
  } else {
    let cursor = halfMedian;
    for (let l = 0; l < inLanes; l++) {
      cursor += armGeom.def.inLaneWidths[l] ?? armLw;
      if (candLat <= cursor || l === inLanes - 1) {
        targetLane = l;
        break;
      }
    }
  }
  if (targetLane === v.laneIndex) return targetLane;
  const nextCompiled = topology.pathLookup[v.originArm]?.[v.turn]?.[targetLane];
  return nextCompiled ? targetLane : v.laneIndex;
}

/**
 * Phase 4 2D Potential-Field Motorcycle Corridor & RHK Reservoir Evaluator.
 *
 * Evaluates lateral target candidates in LHT arm-global coordinates (`0` = road centerline,
 * `+` along `inLeftNormal` toward outer left curb) balancing forward clearance, RHK pocket
 * packing, heavy-vehicle pinch & wide-turn blind-zone avoidance, cross-lane convergence tax,
 * and hysteresis stability while preserving strict undivided-road & oncoming safety bounds.
 */
export function evaluateMotorcycleCorridorTarget(
  params: EvaluateMotorcycleCorridorParams
): MotorcycleCorridorScore | null {
  const {
    v,
    vehicles,
    config,
    topology,
    armGeom,
    lw,
    roadW,
    light,
    desiredV,
    nearestGap,
    blockingLeader,
    weather,
    hasPhysicalMedian,
    discipline,
  } = params;

  if (v.vClass !== 'motor') return null;
  if (v.isReversing) return null;
  if (v.overtakeState && v.overtakeState !== 'none') return null;
  if (v.isSlipLane || v.isUTurn) return null;

  const inLanes = armGeom.def.inLanes;
  const laneCenters = armGeom.inLaneCenters;
  const halfMedian = armGeom.halfMedian;
  const armInWidth = armGeom.inWidth > 0 ? armGeom.inWidth : roadW;
  const armLw = armGeom.def.inLaneWidths[v.laneIndex] ?? lw;
  const myLaneCenter = laneCenters[v.laneIndex] ?? getGlobalLat(v.laneIndex, 0, armLw, laneCenters);
  const myGlobalLat = getGlobalLat(v.laneIndex, v.lateralOffset, armLw, laneCenters);
  const myTargetLat = getGlobalLat(v.laneIndex, v.targetLateralOffset, armLw, laneCenters);
  const myEffW = effClearanceWidth(v);

  // Past stop line: only pull back if straddling near centerline; never weave inside intersection box.
  if (v.distanceAlongPath >= v.stopLineDist) {
    if (myGlobalLat < halfMedian + 0.44) {
      const safeLat = Math.max(halfMedian + 0.44, myLaneCenter);
      return {
        targetGlobalLat: safeLat,
        targetLane: v.laneIndex,
        isRhkPacking: false,
        crossingMarking: false,
      };
    }
    return null;
  }

  const seepageScale = weather?.seepageScale ?? 1.0;
  const weatherPadExtra = (1 - seepageScale) * 0.25;
  const armHasMedian = hasPhysicalMedian || armGeom.def.medianWidth > 0.05;
  const frustration = v.frustration ?? 0;
  const discVal = discipline?.discipline ?? 0.72;
  const markingPropensity = Math.max(
    discipline?.markingCrossPropensity ?? 0.25,
    frustration * (1 - 0.72 * discVal)
  );

  // Single pass over vehicles to measure oncoming risk, queues, RHK state, and cache arm neighbors.
  let nearestOncomingDist = Infinity;
  let nearestOncomingTTC = Infinity;
  let oncomingIsHeavy = false;
  let hasPackedQueueAhead = false;
  let queueAheadNearStop = false;
  let hasFrontQueueInRhk = false;
  let hasSlowLeaderAhead = false;
  let sameArmCount = 0;
  let oppExitCount = 0;

  const scanOncoming = !armHasMedian && v.distanceAlongPath < v.stopLineDist - 4.0;
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  const checkPackedRange = v.distanceAlongPath >= v.stopLineDist - 36.0;

  for (let i = 0; i < vehicles.length; i++) {
    const other = vehicles[i];
    if (other.id === v.id) continue;

    if (other.originArm !== v.originArm) {
      if (scanOncoming) {
        const headingIntoMyArm =
          other.destArm === v.originArm && other.distanceAlongPath > other.stopLineDist - 18.0;
        const dot = cosH * Math.cos(other.heading) + sinH * Math.sin(other.heading);
        if (dot <= -0.45 || headingIntoMyArm) {
          const dx = other.x - v.x;
          const dy = other.y - v.y;
          const fwd = dx * cosH + dy * sinH;
          if (fwd >= -v.length * 0.5 && fwd <= 64.0) {
            const lat = Math.abs(-dx * sinH + dy * cosH);
            if (lat <= armInWidth + armGeom.outWidth + (headingIntoMyArm ? 6.0 : 1.2)) {
              const gap = Math.max(0.1, fwd - (v.length + other.length) * 0.5);
              const closing = Math.max(4.5, v.speed + Math.max(other.speed, 6.0));
              if (gap < nearestOncomingDist) {
                nearestOncomingDist = gap;
                nearestOncomingTTC = gap / closing;
                oncomingIsHeavy = other.vClass === 'heavy';
              }
            }
          }
        }
      }

      if (other.destArm === v.originArm && other.distanceAlongPath >= other.exitLineDist - 4.0) {
        const distOpp = Math.hypot(other.x - v.x, other.y - v.y);
        if (distOpp < 28.0) {
          const otherOutCenter =
            armGeom.outLaneCenters[other.destLaneIndex ?? 0] ??
            (armGeom.def.outLaneWidths[0] ?? armLw) * 0.5;
          const rec = borrowOppExitRecord(oppExitCount++);
          rec.worldSideLat = -(halfMedian + otherOutCenter + other.lateralOffset);
          rec.padOpp = (myEffW + effClearanceWidth(other)) * 0.5 + 0.35;
        }
      }
      continue;
    }

    // Ignore slip-lane vehicles that have already branched past stopLineDist - 2m.
    if (other.isSlipLane && other.distanceAlongPath > other.stopLineDist - 2.0) continue;

    if (other.distanceAlongPath > v.distanceAlongPath) {
      if (other.distanceAlongPath < v.stopLineDist) {
        if (other.distanceAlongPath >= v.stopLineDist - 20.0 && other.speed < 0.6 && checkPackedRange) {
          hasPackedQueueAhead = true;
        }
        if (other.distanceAlongPath >= v.stopLineDist - 18.0 && other.speed < 1.2) {
          queueAheadNearStop = true;
        }
      }
      if (
        !other.isSlipLane &&
        other.distanceAlongPath <= v.stopLineDist + 2.0 &&
        other.speed < 2.5
      ) {
        hasSlowLeaderAhead = true;
      }
      if (
        other.distanceAlongPath < v.stopLineDist + 0.5 &&
        other.distanceAlongPath + other.length * 0.5 >= v.stopLineDist - 6.5 &&
        other.speed < 2.5
      ) {
        hasFrontQueueInRhk = true;
      }
    }

    const otherLw = armGeom.def.inLaneWidths[other.laneIndex] ?? armLw;
    const heavyTailPad =
      other.vClass === 'heavy' &&
      other.turn !== 'straight' &&
      other.distanceAlongPath > other.stopLineDist - 12.0
        ? 0.75
        : 0;
    const otherEffW = effClearanceWidth(other);
    const rec = borrowSameArmRecord(sameArmCount++);
    rec.distAlong = other.distanceAlongPath;
    rec.longDiff = other.distanceAlongPath - v.distanceAlongPath;
    rec.length = other.length;
    rec.halfSumLen = (v.length + other.length) * 0.5;
    rec.lat = getGlobalLat(other.laneIndex, other.lateralOffset, otherLw, laneCenters);
    rec.targetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, otherLw, laneCenters);
    rec.effW = otherEffW;
    rec.pad = (myEffW + otherEffW) * 0.5 + 0.12 + weatherPadExtra + heavyTailPad;
    rec.speed = other.speed;
    rec.comfortDecel = other.comfortDecel;
    rec.minGap = other.minGap;
    rec.isHeavy = other.vClass === 'heavy';
    rec.turn = other.turn;
    rec.wideSwingState = other.wideSwingState;
    rec.stopLineDist = other.stopLineDist;
    rec.isWideTurningHeavy =
      rec.isHeavy &&
      (other.wideSwingState === 'turning' ||
        other.wideSwingState === 'pre_swing' ||
        (other.turn !== 'straight' && other.distanceAlongPath > other.stopLineDist - 14.0));
  }

  // Safety Guard 1: Tuck back from centerline on oncoming threat, red queue, or narrow 1-lane stop approach.
  const reqClearDist = oncomingIsHeavy ? 48.0 : 34.0;
  const narrowUndividedInnerPad =
    !armHasMedian && inLanes === 1 && armInWidth <= 3.3 && v.distanceAlongPath >= v.stopLineDist - 14.0
      ? 1.02
      : 0.42;

  if (
    myGlobalLat < halfMedian + narrowUndividedInnerPad &&
    (armHasMedian ||
      !(weather?.allowOncomingOvertake ?? true) ||
      config.oncomingOvertaking === false ||
      nearestOncomingDist < reqClearDist ||
      nearestOncomingTTC < 3.2 ||
      v.distanceAlongPath >= v.stopLineDist - 22.0 ||
      hasPackedQueueAhead)
  ) {
    const safeInnerTarget = Math.max(
      halfMedian + narrowUndividedInnerPad + 0.04,
      myLaneCenter
    );
    return {
      targetGlobalLat: safeInnerTarget,
      targetLane: v.laneIndex,
      isRhkPacking: false,
      crossingMarking: false,
    };
  }

  // Safety Guard 2: Tuck back from outer shoulder before curb fillet.
  if (myGlobalLat > halfMedian + armInWidth - 0.35 && v.distanceAlongPath >= v.stopLineDist - 8.0) {
    const safeOuterTarget = Math.min(
      halfMedian + armInWidth - 0.44,
      laneCenters[v.laneIndex] ?? halfMedian + armInWidth - armLw * 0.5
    );
    return {
      targetGlobalLat: safeOuterTarget,
      targetLane: v.laneIndex,
      isRhkPacking: false,
      crossingMarking: false,
    };
  }

  const rhkActive =
    armGeom.def.motorBoxEnabled &&
    v.turn !== 'uturn' &&
    v.distanceAlongPath >= v.stopLineDist - 28.0 &&
    v.distanceAlongPath < v.stopLineDist - 0.5 &&
    (light === 'red' || hasFrontQueueInRhk);

  // Safety Guard 3: Re-center turning motorcycles safely before stop line when not packing into RHK.
  if (
    !rhkActive &&
    v.turn !== 'straight' &&
    v.distanceAlongPath >= v.stopLineDist - 9.0 &&
    v.distanceAlongPath <= v.stopLineDist
  ) {
    const bandMin = Math.min(myGlobalLat, myLaneCenter);
    const bandMax = Math.max(myGlobalLat, myLaneCenter);
    for (let i = 0; i < sameArmCount; i++) {
      const other = sameArmPool[i];
      const minRearNeed =
        other.longDiff < 0 && other.speed > v.speed
          ? Math.pow(other.speed - v.speed, 2) / (2 * Math.max(0.8, other.comfortDecel)) + 2.0
          : 2.5;
      if (Math.abs(other.longDiff) < other.halfSumLen + minRearNeed) {
        const minClear = (myEffW + other.effW) * 0.5 + 0.35;
        if (
          (other.lat >= bandMin - minClear && other.lat <= bandMax + minClear) ||
          (other.targetLat >= bandMin - minClear && other.targetLat <= bandMax + minClear)
        ) {
          return null;
        }
      }
    }
    return {
      targetGlobalLat: myLaneCenter,
      targetLane: v.laneIndex,
      isRhkPacking: false,
      crossingMarking: false,
    };
  }

  // Heavy rain suppresses tight fast weaving.
  if (seepageScale < 0.45 && v.speed > 3.5) return null;

  const minLane = v.turn === 'straight' ? Math.max(0, v.laneIndex - 1) : v.laneIndex;
  const maxLane = v.turn === 'straight' ? Math.min(inLanes - 1, v.laneIndex + 1) : v.laneIndex;

  let minLaneEdge = halfMedian;
  for (let l = 0; l < minLane; l++) {
    minLaneEdge += armGeom.def.inLaneWidths[l] ?? armLw;
  }
  let maxLaneEdge = minLaneEdge;
  for (let l = minLane; l <= maxLane; l++) {
    maxLaneEdge += armGeom.def.inLaneWidths[l] ?? armLw;
  }

  const allowCenterCross =
    config.motorSwarmMode &&
    !armHasMedian &&
    (weather?.allowOncomingOvertake ?? true) &&
    config.oncomingOvertaking !== false &&
    markingPropensity >= 0.22 &&
    v.distanceAlongPath > 6.5 &&
    v.distanceAlongPath < v.stopLineDist - 22.0 &&
    v.turn !== 'left' &&
    (v.laneIndex === 0 || v.turn === 'straight') &&
    ((blockingLeader !== null && blockingLeader.speed < 2.5 && nearestGap < 9.0) || frustration >= 0.35);

  const solidRedQueueNearStop =
    v.distanceAlongPath >= v.stopLineDist - 36.0 &&
    (queueAheadNearStop || (light === 'red' && (hasPackedQueueAhead || hasFrontQueueInRhk)));
  const canCrossCenterHere =
    allowCenterCross &&
    !solidRedQueueNearStop &&
    !oncomingIsHeavy &&
    nearestOncomingDist > 40.0 &&
    nearestOncomingTTC > 3.5;

  const maxCrossByWidth =
    armInWidth < 3.1 ? 0.22 : Math.min(0.42, (armGeom.def.outLaneWidths[0] ?? armLw) * 0.14);
  const centerCrossDepth = canCrossCenterHere
    ? Math.min(0.45, Math.max(0.18, maxCrossByWidth) * (0.7 + 0.35 * markingPropensity))
    : 0;

  const canUseShoulder =
    config.motorSwarmMode &&
    v.distanceAlongPath > 5.0 &&
    v.distanceAlongPath < v.stopLineDist - 8.5 &&
    seepageScale >= 0.55 &&
    markingPropensity >= 0.18 &&
    (v.turn === 'straight' || v.turn === 'left') &&
    maxLane === inLanes - 1;
  const shoulderExtra = canUseShoulder ? Math.min(0.6, markingPropensity * 0.58) : 0;

  // Check triggers: reactive blocking leader, anticipatory long-range queue filtering, or RHK packing.
  const effFilterWidth =
    (v.turn === 'straight' && inLanes >= 2 ? armInWidth : armLw) +
    (canCrossCenterHere && minLane === 0 ? centerCrossDepth : 0) +
    (canUseShoulder ? shoulderExtra : 0);
  const reactiveTrigger =
    blockingLeader !== null &&
    nearestGap < 24.0 * seepageScale &&
    !(blockingLeader.speed >= desiredV - 0.8 && blockingLeader.speed >= 3.5) &&
    canFilterSideBySide(v.width, blockingLeader.width, effFilterWidth);

  const anticipatoryTrigger =
    config.motorSwarmMode &&
    v.distanceAlongPath < v.stopLineDist - 4.0 &&
    v.distanceAlongPath > 6.0 &&
    seepageScale >= 0.45 &&
    (light === 'red' || v.stopLineDist - v.distanceAlongPath < 56.0) &&
    hasSlowLeaderAhead;

  if (!reactiveTrigger && !anticipatoryTrigger && !rhkActive) return null;

  const rightTurnEdgePad = Math.max(
    narrowUndividedInnerPad,
    v.turn === 'right' && v.distanceAlongPath >= v.stopLineDist - 14.0 && minLane === 0 ? 0.72 : 0.42
  );
  const minBound =
    canCrossCenterHere && minLane === 0
      ? halfMedian - centerCrossDepth
      : Math.max(halfMedian + rightTurnEdgePad, minLaneEdge + 0.42);
  const maxBound = canUseShoulder
    ? halfMedian + armInWidth + shoulderExtra - 0.38
    : Math.min(halfMedian + armInWidth - 0.42, maxLaneEdge - 0.42);

  if (minBound >= maxBound - 0.05) return null;

  // Build candidate corridor positions and gutter coordinates (zero allocations).
  candBuf.length = 0;
  gutterBuf.length = 0;

  gutterBuf.push(halfMedian + 0.52);
  let divCursor = halfMedian;
  for (let l = 0; l < inLanes - 1; l++) {
    divCursor += armGeom.def.inLaneWidths[l] ?? armLw;
    gutterBuf.push(divCursor);
    if (l + 1 >= minLane && l + 1 <= maxLane) {
      pushCandidate(divCursor, minBound, maxBound);
      pushCandidate(divCursor - 0.28, minBound, maxBound);
      pushCandidate(divCursor + 0.28, minBound, maxBound);
    }
  }
  gutterBuf.push(halfMedian + armInWidth - 0.52);

  // Sample across [minBound, maxBound] with ~0.65m spacing plus edges & lane centers.
  for (let c = minBound; c <= maxBound + 1e-6; c += 0.65) {
    pushCandidate(c, minBound, maxBound);
  }
  pushCandidate(minBound, minBound, maxBound);
  pushCandidate(maxBound, minBound, maxBound);

  for (let l = minLane; l <= maxLane; l++) {
    const lc = laneCenters[l];
    if (lc !== undefined) pushCandidate(lc, minBound, maxBound);
  }

  if (blockingLeader && blockingLeader.originArm === v.originArm) {
    const leadLw = armGeom.def.inLaneWidths[blockingLeader.laneIndex] ?? armLw;
    const leadEffW = effClearanceWidth(blockingLeader);
    const leadGlobalLat = getGlobalLat(
      blockingLeader.laneIndex,
      blockingLeader.lateralOffset,
      leadLw,
      laneCenters
    );
    pushCandidate(leadGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12 - weatherPadExtra, minBound, maxBound);
    pushCandidate(leadGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12 + weatherPadExtra, minBound, maxBound);
  }

  if (canCrossCenterHere && minLane === 0) {
    pushCandidate(halfMedian - 0.18, minBound, maxBound);
    pushCandidate(halfMedian - Math.min(0.65, centerCrossDepth * 0.7), minBound, maxBound);
    pushCandidate(halfMedian - centerCrossDepth, minBound, maxBound);
  }
  if (canUseShoulder) {
    pushCandidate(halfMedian + armInWidth + shoulderExtra * 0.55, minBound, maxBound);
  }
  pushCandidate(myGlobalLat, minBound, maxBound);

  if (candBuf.length === 0) return null;

  const distToStop = Math.max(0, v.stopLineDist - v.distanceAlongPath);
  const stopProximity = 1.0 - Math.min(1.0, distToStop / 32.0);
  const preferredTurnGlobalLat =
    v.turn === 'left'
      ? clamp(halfMedian + armInWidth - 0.55, minBound, maxBound)
      : v.turn === 'right'
        ? clamp(halfMedian + Math.max(rightTurnEdgePad, 0.55), minBound, maxBound)
        : clamp(myLaneCenter, minBound, maxBound);
  const crossLaneWeight = v.turn === 'straight' ? 0.9 : 2.8;
  const distToRhkRear = Math.max(0, v.stopLineDist - 3.8 - (v.distanceAlongPath + v.length * 0.5));
  const maxApproachForward = Math.max(0, v.stopLineDist - v.distanceAlongPath);
  const rhkComfortSpeed = v.speed < 3.5;

  const evaluateCandidate = (cand: number, isCurrentBaseline: boolean): void => {
    let clear = true;
    let forwardClear = maxApproachForward;
    const movingSideways = !isCurrentBaseline && Math.abs(cand - myGlobalLat) > 0.05;
    const needsMergeCheck = !isCurrentBaseline && Math.abs(cand - myGlobalLat) > 0.35;

    if (cand < halfMedian + 0.3) {
      for (let i = 0; i < oppExitCount; i++) {
        const opp = oppExitPool[i];
        if (Math.abs(cand - opp.worldSideLat) < opp.padOpp) {
          clear = false;
          break;
        }
      }
    }

    let frontRowBusy = false;
    let secondRowBusy = false;
    let pinchPenalty = 0;
    let wideTurnPenalty = 0;
    let heavyInnerPinch = false;
    let heavyOuterPinch = false;

    if (clear) {
      for (let i = 0; i < sameArmCount; i++) {
        const other = sameArmPool[i];
        const latOverlap =
          Math.abs(cand - other.lat) < other.pad || Math.abs(cand - other.targetLat) < other.pad;

        if (Math.abs(other.longDiff) < other.halfSumLen + 1.2) {
          if (!movingSideways) {
            if (latOverlap) {
              clear = false;
            }
          } else {
            const crossesLat =
              (cand > myGlobalLat && other.lat >= myGlobalLat - 0.05 && other.lat <= cand + other.pad) ||
              (cand < myGlobalLat && other.lat <= myGlobalLat + 0.05 && other.lat >= cand - other.pad);
            const crossesTarget =
              (cand > myGlobalLat &&
                other.targetLat >= myGlobalLat - 0.05 &&
                other.targetLat <= cand + other.pad) ||
              (cand < myGlobalLat &&
                other.targetLat <= myGlobalLat + 0.05 &&
                other.targetLat >= cand - other.pad);
            if (latOverlap || crossesLat || crossesTarget) {
              clear = false;
              break;
            }
          }
        } else if (other.longDiff > 0 && latOverlap) {
          const gap = other.longDiff - other.halfSumLen;
          if (needsMergeCheck) {
            const minMergeGap =
              rhkActive && rhkComfortSpeed && other.speed < 1.5
                ? Math.max(1.2, v.minGap + 0.4)
                : 4.5;
            if (
              gap < minMergeGap ||
              (v.speed > other.speed + 1.5 && gap < (v.speed - other.speed) * 1.4)
            ) {
              clear = false;
              break;
            }
          }
          if (gap < forwardClear) {
            forwardClear = Math.max(0, gap);
          }
        } else if (other.longDiff < 0 && other.speed > v.speed && latOverlap && needsMergeCheck) {
          const rearGap = -other.longDiff - other.halfSumLen;
          const dv = other.speed - v.speed;
          const effOtherDecel = Math.max(1.0, other.comfortDecel * (weather?.comfortDecelMult ?? 1.0));
          const kinStop = (dv * dv) / (2 * effOtherDecel) + other.minGap;
          if (rearGap < Math.max(3.0, dv * 1.4, kinStop)) {
            clear = false;
            break;
          }
        }

        if (rhkActive && latOverlap && other.speed < 2.5 && other.distAlong >= v.distanceAlongPath - 0.8) {
          const oFront = other.distAlong + other.length * 0.5;
          const oRear = other.distAlong - other.length * 0.5;
          if (oFront > v.stopLineDist - 1.9 && oRear < v.stopLineDist + 0.35) {
            frontRowBusy = true;
          } else if (oFront > v.stopLineDist - 3.2 && oFront <= v.stopLineDist - 1.9) {
            secondRowBusy = true;
          }
        }

        if (other.isHeavy) {
          const edgeLatGap = Math.abs(cand - other.lat) - (myEffW + other.effW) * 0.5;
          const bumperLongGap = Math.abs(other.longDiff) - other.halfSumLen;

          if (bumperLongGap <= 2.5 && edgeLatGap < 1.45) {
            const closeness = 1.0 - Math.max(0, edgeLatGap) / 1.45;
            pinchPenalty += 5.5 + 8.5 * closeness;
            if (other.lat < cand) heavyInnerPinch = true;
            else heavyOuterPinch = true;
          } else if (other.longDiff > 0 && bumperLongGap <= 16.0 && edgeLatGap < 1.45) {
            const closeness = 1.0 - Math.max(0, edgeLatGap) / 1.45;
            const distDecay = 1.0 - (bumperLongGap - 2.5) / 13.5;
            pinchPenalty += (3.0 + 4.5 * closeness) * distDecay;
            if (bumperLongGap <= 8.0) {
              if (other.lat < cand) heavyInnerPinch = true;
              else heavyOuterPinch = true;
            }
          }

          if (
            other.isWideTurningHeavy &&
            other.longDiff >= -(other.halfSumLen + 2.5) &&
            other.longDiff <= other.halfSumLen + 14.0
          ) {
            const isInnerTurnSide =
              (other.turn === 'left' && cand >= other.lat - 0.2) ||
              ((other.turn === 'right' || other.turn === 'uturn') && cand <= other.lat + 0.2);
            if (isInnerTurnSide) {
              const latZone = Math.max(0, 1.0 - Math.max(0, edgeLatGap) / 3.0);
              const stateMult =
                other.wideSwingState === 'turning'
                  ? 1.35
                  : other.wideSwingState === 'pre_swing'
                    ? 1.15
                    : 1.0;
              wideTurnPenalty += (18.0 + 10.0 * latZone) * stateMult;
            }
          }
        }
      }
    }

    if (!clear && !isCurrentBaseline) {
      evalClear = false;
      evalForwardClear = 0;
      evalScore = -Infinity;
      return;
    }

    if (heavyInnerPinch && heavyOuterPinch) {
      pinchPenalty += 22.0;
    }

    let score = Math.min(45.0, Math.max(0, forwardClear));

    if (rhkActive) {
      const reachesRhk = forwardClear >= distToRhkRear - 0.3;
      if (reachesRhk) {
        if (!frontRowBusy && !secondRowBusy) score += 5.0;
        else if (!frontRowBusy) score += 3.5;
        else if (!secondRowBusy) score += 1.8;
      }
      if (v.turn === 'straight') {
        let minGutterDist = Infinity;
        for (let g = 0; g < gutterBuf.length; g++) {
          const d = Math.abs(cand - gutterBuf[g]);
          if (d < minGutterDist) minGutterDist = d;
        }
        score += 0.65 * Math.exp(-(minGutterDist * minGutterDist) / 0.14);
      }
    }

    score -= pinchPenalty + wideTurnPenalty;
    score -= crossLaneWeight * stopProximity * Math.abs(cand - preferredTurnGlobalLat);

    // Discourage gratuitous marking crossing when inside-lane corridors remain viable.
    if (cand < halfMedian + 0.18) {
      score -= 1.8 * (1.15 - 0.45 * markingPropensity);
    } else if (cand > halfMedian + armInWidth - 0.18) {
      score -= 1.0 * (1.15 - 0.45 * markingPropensity);
    }

    if (Math.abs(cand - myGlobalLat) < 0.35) {
      score += 0.8;
    }

    evalClear = clear;
    evalForwardClear = forwardClear;
    evalScore = score;
  };

  evaluateCandidate(myGlobalLat, true);
  const baselineClear = evalClear;
  const baselineForwardClear = evalForwardClear;
  const baselineScore = evalScore;

  const currentInBounds = myGlobalLat >= minBound - 0.02 && myGlobalLat <= maxBound + 0.02;
  const currentCorridorBlocked =
    !baselineClear ||
    !currentInBounds ||
    baselineForwardClear < 4.5 ||
    (blockingLeader !== null &&
      nearestGap < 6.0 &&
      blockingLeader.speed < Math.max(2.5, desiredV - 0.8));

  let bestCand: number | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < candBuf.length; i++) {
    const cand = candBuf[i];
    evaluateCandidate(cand, false);
    if (!evalClear) continue;
    if (evalScore > bestScore) {
      bestScore = evalScore;
      bestCand = cand;
    }
  }

  if (bestCand === null) return null;

  const beatsCurrent = currentCorridorBlocked
    ? !baselineClear || !currentInBounds || bestScore > baselineScore + 0.15
    : bestScore > baselineScore + 1.2;

  if (!beatsCurrent) return null;

  const targetLane = resolveTargetLane(bestCand, v, inLanes, halfMedian, armLw, armGeom, topology);
  const abortStaleTarget =
    Math.abs(myTargetLat - myGlobalLat) > 0.35 && Math.abs(bestCand - myTargetLat) > 0.35;
  if (Math.abs(bestCand - myGlobalLat) <= 0.2 && targetLane === v.laneIndex && !abortStaleTarget) {
    return null;
  }

  return {
    targetGlobalLat: bestCand,
    targetLane,
    isRhkPacking: rhkActive,
    crossingMarking: bestCand < halfMedian + 0.18 || bestCand > halfMedian + armInWidth - 0.18,
  };
}

/**
 * Swarm Platoon Shielding: allows following motorcycles to piggyback inside a moving platoon
 * already crossing past the stop line into a conflict zone, reducing fragmented gap hesitation.
 */
export function hasMotorSwarmPlatoonShield(
  v: SimVehicle,
  conflictOriginArm: string,
  nearby: readonly SimVehicle[]
): boolean {
  if (v.vClass !== 'motor' || v.isReversing) return false;
  if (conflictOriginArm && conflictOriginArm === v.originArm) return false;

  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (
      other.id === v.id ||
      other.vClass !== 'motor' ||
      other.isReversing ||
      other.originArm !== v.originArm ||
      other.speed < 2.8 ||
      other.hasExitedIntersection
    ) {
      continue;
    }

    const alongDiff = other.distanceAlongPath - v.distanceAlongPath;
    if (alongDiff < 0 || alongDiff > 4.0) continue;
    if (other.distanceAlongPath < other.stopLineDist - 1.0) continue;

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const latDist = Math.abs(-dx * sinH + dy * cosH);
    if (latDist >= 1.7) continue;

    if (other.turn === v.turn) return true;
    const headingDiff = Math.abs(
      Math.atan2(Math.sin(other.heading - v.heading), Math.cos(other.heading - v.heading))
    );
    if (headingDiff <= 0.45) return true;
  }

  return false;
}
