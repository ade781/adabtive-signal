import { effClearanceWidth, getGlobalLat, SimVehicle } from './behaviors';
import { DisciplineParams } from './conflictResolver';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { computeIidmAcceleration } from './longitudinalAI';
import { SpatialHashGrid } from './spatialHash';
import { CompiledMovementPath, CompiledTopology } from './topologyTypes';
import { SignalColor } from './types';

export interface OvertakeMetricsDelta {
  carOvertakes: number;
  oncomingOvertakes: number;
}

/**
 * Pure IIDM longitudinal acceleration helper used by MOBIL lane-change evaluation.
 */
function idmAccel(v: SimVehicle, desiredV: number, gap: number, leadSpeed: number, weather: WeatherPhysicsProfile): number {
  return computeIidmAcceleration({
    speed: v.speed,
    desiredSpeed: desiredV,
    gap,
    leadSpeed,
    maxAccel: v.maxAccel * v.accelFactor * weather.accelMult,
    comfortDecel: Math.max(0.8, v.comfortDecel * weather.comfortDecelMult),
    minGap: v.minGap * weather.minGapMult,
    timeHeadway: v.timeHeadway * weather.headwayMult,
  });
}

function getPoliteness(v: SimVehicle, discipline: DisciplineParams): number {
  const base = v.profile === 'aggressive' ? 0.06 : v.profile === 'normal' ? 0.24 : 0.55;
  return Math.max(0.02, Math.min(0.8, base * (0.65 + 0.55 * discipline.discipline)));
}

/**
 * Checks whether a candidate lane is valid for the vehicle's turn intent on its current leg.
 * On approach, turning vehicles can only move step-by-step toward their designated turn lane (MLC pre-sorting).
 */
function isLaneValidForVehicle(
  v: SimVehicle,
  candLane: number,
  curLane: number,
  laneCount: number,
  isOnExitLeg: boolean
): boolean {
  if (candLane < 0 || candLane >= laneCount) return false;
  if (isOnExitLeg) return true; // On exit leg, any outbound lane is valid for overtaking!
  if (v.turn === 'straight') return true;
  if (v.turn === 'left') return candLane > curLane;
  if (v.turn === 'right' || v.turn === 'uturn') return candLane < curLane;
  return false;
}

interface CandidateLaneScan {
  newLeader: SimVehicle | null;
  newLeaderGap: number;
  newFollower: SimVehicle | null;
  newFollowerGap: number;
  sideBlocked: boolean;
}

/**
 * Scans destination lane & swept corridor between curLane and candLane for side blockers,
 * immediate leader, and immediate follower.
 */
function scanCandidateLane(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  armGeom: CompiledTopology['armsById'][string],
  lw: number,
  curLane: number,
  candLane: number,
  laneCount: number,
  isOnApproach: boolean
): CandidateLaneScan {
  const activeArmId = isOnApproach ? v.originArm : v.destArm;
  const curCenter = isOnApproach
    ? (armGeom.inLaneCenters[curLane] ?? getGlobalLat(curLane, 0, lw))
    : (armGeom.outLaneCenters[curLane] ?? getGlobalLat(curLane, 0, lw));
  const candCenter = isOnApproach
    ? (armGeom.inLaneCenters[candLane] ?? getGlobalLat(candLane, 0, lw))
    : (armGeom.outLaneCenters[candLane] ?? getGlobalLat(candLane, 0, lw));
  const myEffW = effClearanceWidth(v);
  const myS = isOnApproach ? v.distanceAlongPath : v.distanceAlongPath - v.exitLineDist;

  let newLeader: SimVehicle | null = null;
  let newLeaderGap = Infinity;
  let newFollower: SimVehicle | null = null;
  let newFollowerGap = Infinity;
  let sideBlocked = false;

  for (const other of vehicles) {
    if (other.id === v.id) continue;
    const otherOnSameLeg = isOnApproach
      ? other.originArm === activeArmId && other.distanceAlongPath < other.stopLineDist + 2.0
      : other.destArm === activeArmId && other.distanceAlongPath >= other.exitLineDist - 2.0;
    if (!otherOnSameLeg) continue;

    const otherLane = isOnApproach ? other.laneIndex : (other.destLaneIndex ?? Math.min(other.laneIndex, laneCount - 1));
    const otherCenter = isOnApproach
      ? (armGeom.inLaneCenters[otherLane] ?? getGlobalLat(otherLane, 0, lw))
      : (armGeom.outLaneCenters[otherLane] ?? getGlobalLat(otherLane, 0, lw));
    const otherLat = otherCenter + other.lateralOffset;
    const otherTargetLat = otherCenter + other.targetLateralOffset;
    const minLatClear = (myEffW + effClearanceWidth(other)) * 0.5 + 0.28;

    const inTargetLane =
      Math.abs(otherLat - candCenter) < minLatClear || Math.abs(otherTargetLat - candCenter) < minLatClear;
    const movingLeft = candCenter > curCenter;
    const inSweepCorridor = movingLeft
      ? (otherLat > curCenter + 0.15 && otherLat < candCenter + minLatClear) ||
        (otherTargetLat > curCenter + 0.15 && otherTargetLat < candCenter + minLatClear)
      : (otherLat < curCenter - 0.15 && otherLat > candCenter - minLatClear) ||
        (otherTargetLat < curCenter - 0.15 && otherTargetLat > candCenter - minLatClear);

    if (!inTargetLane && !inSweepCorridor) continue;

    const otherS = isOnApproach ? other.distanceAlongPath : other.distanceAlongPath - other.exitLineDist;
    const halfSum = (v.length + other.length) * 0.5;
    const rel = otherS - myS;

    // Physical side-by-side clearance check (covers BOTH destination lane & swept lane-divider corridor!)
    const minSideFront = v.vClass === 'motor' ? 1.4 : 2.2;
    const minSideRear = v.vClass === 'motor' ? 1.4 : 2.2;
    if (rel > -(halfSum + minSideRear) && rel < halfSum + minSideFront) {
      sideBlocked = true;
      break;
    }
    if (!inTargetLane) continue;

    if (rel > 0) {
      const gap = rel - halfSum;
      if (gap < newLeaderGap) {
        newLeaderGap = gap;
        newLeader = other;
      }
    } else {
      const gap = -rel - halfSum;
      if (gap < newFollowerGap) {
        newFollowerGap = gap;
        newFollower = other;
      }
    }
  }

  return { newLeader, newLeaderGap, newFollower, newFollowerGap, sideBlocked };
}

function commitLaneChange(
  v: SimVehicle,
  topology: CompiledTopology,
  armGeom: CompiledTopology['armsById'][string],
  lw: number,
  curLane: number,
  targetLane: number,
  isOnApproach: boolean,
  dir: 'left' | 'right',
  cooldown: number,
  onCommit?: () => void
): boolean {
  if (isOnApproach) {
    const oldCenter = armGeom.inLaneCenters[curLane] ?? getGlobalLat(curLane, 0, lw);
    const newCenter = armGeom.inLaneCenters[targetLane] ?? getGlobalLat(targetLane, 0, lw);
    const paths = topology.pathLookup[v.originArm]?.[v.turn];
    const nextPath: CompiledMovementPath | undefined = paths?.[targetLane];
    if (!nextPath) return false;

    v.laneIndex = targetLane;
    v.destLaneIndex = nextPath.destLane;
    v.pathKey = nextPath.key;
    v.compiledPath = nextPath;
    v.path = {
      turn: v.turn === 'uturn' ? 'right' : v.turn,
      stopLineDist: nextPath.stopLineDist,
      exitLineDist: nextPath.exitLineDist,
      totalPathLength: nextPath.totalPathLength,
      sample: (d) => nextPath.sample(d),
    };
    v.stopLineDist = nextPath.stopLineDist;
    v.exitLineDist = nextPath.exitLineDist;
    v.totalPathLength = nextPath.totalPathLength;
    // Preserve continuous world lateral position and smoothly steer toward 0 offset in new lane
    v.lateralOffset += oldCenter - newCenter;
    v.targetLateralOffset = 0;
  } else {
    // Exit-leg overtake: shift targetLateralOffset relative to compiledPath's anchor destLane, and sync destLaneIndex
    const anchorLane = v.compiledPath?.destLane ?? v.destLaneIndex ?? 0;
    const curBaseCenter = armGeom.outLaneCenters[anchorLane] ?? getGlobalLat(anchorLane, 0, lw);
    const targetCenter = armGeom.outLaneCenters[targetLane] ?? getGlobalLat(targetLane, 0, lw);
    v.destLaneIndex = targetLane;
    v.targetLateralOffset = targetCenter - curBaseCenter;
  }

  v.laneChangeDir = dir;
  v.turnSignalActive = dir;
  v.pendingLaneChangeDir = null;
  v.signalLeadTimer = 0;
  v.laneChangeCooldown = cooldown;
  onCommit?.();
  return true;
}

function clearPendingLaneSignal(v: SimVehicle): void {
  if (v.pendingLaneChangeDir) {
    v.pendingLaneChangeDir = null;
    v.signalLeadTimer = 0;
    if (!v.laneChangeDir) {
      v.turnSignalActive = null;
    }
  }
}

/**
 * MOBIL (Minimizing Overall Braking Induced by Lane changes) + Proactive Queue Balancing + Toledo MLC Pre-Sorting.
 * Replaces the overly restrictive `tryCarLaneChange` so cars and motorcycles actively overtake
 * slower traffic on green, pre-sort into mandatory turn lanes, balance turn-friction queues, AND overtake on exit legs!
 */
export function evaluateMobilLaneChange(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  topology: CompiledTopology,
  lw: number,
  light: SignalColor,
  desiredV: number,
  nearestGap: number,
  blockingLeader: SimVehicle | null,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams,
  onOvertake: () => void,
  dt?: number
): boolean {
  if (v.vClass === 'heavy' || v.isSlipLane || v.isUTurn) return false;
  if (v.overtakeState && v.overtakeState !== 'none') {
    clearPendingLaneSignal(v);
    return false;
  }
  if ((v.laneChangeCooldown ?? 0) > 0) {
    clearPendingLaneSignal(v);
    return false;
  }
  if (v.turn === 'straight' && !v.laneChangeDir && !v.pendingLaneChangeDir && v.turnSignalActive) {
    v.turnSignalActive = null;
  }
  if (Math.abs(v.lateralOffset - v.targetLateralOffset) > 0.35) {
    clearPendingLaneSignal(v);
    return false;
  }

  const isOnApproach = v.distanceAlongPath < v.stopLineDist - 12.0 && v.distanceAlongPath > 4.0;
  const isOnExit = v.distanceAlongPath > v.exitLineDist + 4.5 && v.distanceAlongPath < v.totalPathLength - 14.0;
  if (!isOnApproach && !isOnExit) {
    clearPendingLaneSignal(v);
    return false;
  }
  // On approach, motorcycles already use fine-grained Indonesian seepage/filtering with turn-lane conflict guards;
  // MOBIL handles cars on approach & exit, plus motorcycles on exit legs!
  if (isOnApproach && v.vClass === 'motor') return false;

  const activeArmId = isOnApproach ? v.originArm : v.destArm;
  const armGeom = topology.armsById[activeArmId];
  if (!armGeom) return false;

  const laneCount = isOnApproach ? armGeom.def.inLanes : armGeom.def.outLanes;
  if (laneCount < 2) return false;

  const curLane = isOnApproach ? v.laneIndex : (v.destLaneIndex ?? Math.min(v.laneIndex, laneCount - 1));
  const distToStop = v.stopLineDist - v.distanceAlongPath;

  // Mandatory Lane Change (MLC) Pre-Sorting toward designated turn lane
  const needMlcLeft = isOnApproach && v.turn === 'left' && curLane < laneCount - 1;
  const needMlcRight = isOnApproach && (v.turn === 'right' || v.turn === 'uturn') && curLane > 0;
  const mlcTargetLane = needMlcLeft ? curLane + 1 : needMlcRight ? curLane - 1 : -1;
  const isMlcTrigger = mlcTargetLane !== -1 && distToStop < 52.0;

  // Trigger 1: Blocked by a slower leader (moving overtake — works even at low speeds > 0.6 m/s!)
  const blockedBySlow =
    blockingLeader !== null &&
    nearestGap < 28.0 &&
    blockingLeader.speed < desiredV - 0.85;

  // Trigger 2: Proactive queue balancing when approaching red/slow queue (distToStop in [12m, 68m])
  const wantQueueBalance =
    isOnApproach &&
    (light === 'red' || (blockingLeader !== null && blockingLeader.speed < 2.2)) &&
    distToStop >= 12.0 &&
    distToStop <= 68.0 &&
    v.speed > 0.4;

  // Trigger 3 (Tier 2a Stuck Recovery): Stopped behind a stalled/stopped blocker mid-road
  const isMidRoadStuck =
    (v.stuckTimer ?? 0) >= 1.5 &&
    blockingLeader !== null &&
    blockingLeader.speed < 0.6 &&
    (!isOnApproach || distToStop > 18.0);

  if (!blockedBySlow && !wantQueueBalance && !isMidRoadStuck && !isMlcTrigger) {
    clearPendingLaneSignal(v);
    return false;
  }
  // Cars normally need rolling speed, unless recovering from a mid-road stopped blocker or pre-sorting under MLC
  const minSpeed = isMlcTrigger ? 0.4 : v.vClass === 'motor' ? 0.8 : 1.8;
  if (!isMidRoadStuck && v.speed < minSpeed) {
    clearPendingLaneSignal(v);
    return false;
  }

  const politeness = getPoliteness(v, discipline);
  const bSafe = (v.profile === 'aggressive' ? 4.4 : 3.5) * weather.comfortDecelMult;
  const accelThreshold = (v.vClass === 'motor' ? 0.14 : 0.16) * (1.25 - 0.35 * discipline.overtakeBoldness);

  const curLeadSpeed = blockingLeader ? blockingLeader.speed : desiredV;
  const aCur = idmAccel(v, desiredV, nearestGap, curLeadSpeed, weather);

  const curQueueAhead = wantQueueBalance
    ? countQueueInLane(vehicles, activeArmId, curLane, v.distanceAlongPath, true)
    : 0;

  let bestCandLane = -1;
  let bestScore = -Infinity;

  for (const candLane of [curLane - 1, curLane + 1]) {
    if (!isLaneValidForVehicle(v, candLane, curLane, laneCount, isOnExit)) continue;

    const scan = scanCandidateLane(v, vehicles, armGeom, lw, curLane, candLane, laneCount, isOnApproach);
    if (scan.sideBlocked) continue;

    // Require enough braking space behind new leader
    const minReqFrontGap = Math.max(
      2.4,
      v.minGap * 1.15 + Math.max(0, v.speed - (scan.newLeader?.speed ?? desiredV)) * 0.65
    );
    if (scan.newLeader && scan.newLeaderGap < minReqFrontGap) continue;

    // MOBIL Safety Criterion on new follower
    let followerDeltaA = 0;
    if (scan.newFollower) {
      const nfDesired =
        scan.newFollower.maxSpeed * scan.newFollower.speedFactor * weather.speedMult[scan.newFollower.vClass];
      const nfOldGap = scan.newLeader ? scan.newFollowerGap + v.length + scan.newLeaderGap : Infinity;
      const aNfOld = idmAccel(scan.newFollower, nfDesired, nfOldGap, scan.newLeader?.speed ?? nfDesired, weather);
      const aNfNew = idmAccel(scan.newFollower, nfDesired, scan.newFollowerGap, v.speed, weather);
      const dvRear = Math.max(0, scan.newFollower.speed - v.speed);
      const minRearKinematic = (dvRear * dvRear) / (2 * Math.max(1.5, bSafe)) + scan.newFollower.minGap + 0.8;
      if (aNfNew < -bSafe || scan.newFollowerGap < minRearKinematic) continue;
      followerDeltaA = aNfNew - aNfOld;
    }

    // MOBIL Incentive Criterion
    const aNew = idmAccel(v, desiredV, scan.newLeaderGap, scan.newLeader?.speed ?? desiredV, weather);
    let incentive = (aNew - aCur) + politeness * followerDeltaA;

    // Queue balance bonus when approaching red/stopped/high-friction queue
    if (wantQueueBalance) {
      const candQueue = countQueueInLane(vehicles, activeArmId, candLane, v.distanceAlongPath, true);
      if (candQueue + 1 < curQueueAhead) {
        incentive += (curQueueAhead - candQueue) * 0.45;
      }
    }

    // Toledo MLC rising utility incentive toward designated turn lane
    if (candLane === mlcTargetLane) {
      incentive += 2.0 + 3.2 * (1 - Math.min(1, Math.max(0, distToStop) / 55));
    }

    if (incentive > accelThreshold && incentive > bestScore) {
      bestScore = incentive;
      bestCandLane = candLane;
    }
  }

  if (bestCandLane === -1) {
    clearPendingLaneSignal(v);
    return false;
  }

  const dir: 'left' | 'right' = bestCandLane > curLane ? 'left' : 'right';
  const isUrgentMlc = bestCandLane === mlcTargetLane && distToStop < 20.0;

  // Pre-change blinker signaling window for disciplined drivers on discretionary changes
  if (!isMidRoadStuck && !isUrgentMlc && discipline.discipline >= 0.5 && (dt ?? 0) > 0) {
    if (v.pendingLaneChangeDir !== dir) {
      v.pendingLaneChangeDir = dir;
      v.turnSignalActive = dir;
      v.signalLeadTimer = 0.32;
      return false;
    }
    v.signalLeadTimer = Math.max(0, (v.signalLeadTimer ?? 0) - dt!);
    v.turnSignalActive = dir;
    if (v.signalLeadTimer > 0) {
      return false;
    }
  }

  const cooldown = v.vClass === 'motor' ? 1.4 : 2.2;
  return commitLaneChange(
    v,
    topology,
    armGeom,
    lw,
    curLane,
    bestCandLane,
    isOnApproach,
    dir,
    cooldown,
    v.vClass === 'car' ? onOvertake : undefined
  );
}

/**
 * Courtesy Keep-Left Shift (LHT): Heavy trucks and cautious drivers cruising slower than 84% of desired speed
 * yield the innermost fast lane (`laneIndex = 0` or inner lane) to an open outer-left lane (`curLane + 1`)
 * whenever a faster same-arm follower is closing within 22m.
 */
export function evaluateCourtesyLaneShift(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  topology: CompiledTopology,
  lw: number,
  light: SignalColor,
  desiredV: number,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams,
  onLaneChange?: () => void
): boolean {
  if (v.turn !== 'straight') return false;
  if (v.vClass !== 'heavy' && v.profile !== 'cautious') return false;
  if (v.isSlipLane || v.isUTurn) return false;
  if (v.overtakeState && v.overtakeState !== 'none') return false;
  if ((v.laneChangeCooldown ?? 0) > 0) return false;
  if (Math.abs(v.lateralOffset - v.targetLateralOffset) > 0.35) return false;

  const isOnApproach = v.distanceAlongPath > 8.0 && v.distanceAlongPath < v.stopLineDist - 22.0 && light === 'green';
  const isOnExit = v.distanceAlongPath > v.exitLineDist + 6.0 && v.distanceAlongPath < v.totalPathLength - 18.0;
  if (!isOnApproach && !isOnExit) return false;

  const activeArmId = isOnApproach ? v.originArm : v.destArm;
  const armGeom = topology.armsById[activeArmId];
  if (!armGeom) return false;

  const laneCount = isOnApproach ? armGeom.def.inLanes : armGeom.def.outLanes;
  if (laneCount < 2) return false;

  const curLane = isOnApproach ? v.laneIndex : (v.destLaneIndex ?? Math.min(v.laneIndex, laneCount - 1));
  const candLane = curLane + 1;
  if (candLane >= laneCount) return false;
  if (v.speed >= desiredV * 0.84 || v.speed < 0.3) return false;

  const myS = isOnApproach ? v.distanceAlongPath : v.distanceAlongPath - v.exitLineDist;
  let hasClosingFollower = false;

  for (const other of vehicles) {
    if (other.id === v.id || other.isSlipLane || other.isUTurn) continue;
    const sameLeg = isOnApproach
      ? other.originArm === activeArmId && other.laneIndex === curLane && other.distanceAlongPath < other.stopLineDist
      : other.destArm === activeArmId &&
        (other.destLaneIndex ?? Math.min(other.laneIndex, laneCount - 1)) === curLane &&
        other.distanceAlongPath >= other.exitLineDist;
    if (!sameLeg) continue;

    const otherS = isOnApproach ? other.distanceAlongPath : other.distanceAlongPath - other.exitLineDist;
    const deltaS = myS - otherS;
    if (deltaS > 0 && deltaS < 22.0 && other.speed > v.speed + 2.0) {
      hasClosingFollower = true;
      break;
    }
  }
  if (!hasClosingFollower) return false;

  const scan = scanCandidateLane(v, vehicles, armGeom, lw, curLane, candLane, laneCount, isOnApproach);
  if (scan.sideBlocked) return false;
  if (scan.newLeader && scan.newLeaderGap < 26.0) return false;

  if (scan.newFollower) {
    const bSafe = (v.profile === 'aggressive' ? 4.4 : 3.5) * weather.comfortDecelMult * (0.85 + 0.25 * discipline.discipline);
    const nfDesired =
      scan.newFollower.maxSpeed * scan.newFollower.speedFactor * weather.speedMult[scan.newFollower.vClass];
    const aNfNew = idmAccel(scan.newFollower, nfDesired, scan.newFollowerGap, v.speed, weather);
    const dvRear = Math.max(0, scan.newFollower.speed - v.speed);
    const minRearKinematic =
      (dvRear * dvRear) / (2 * Math.max(1.5, bSafe)) + scan.newFollower.minGap * weather.minGapMult + 0.8;
    if (aNfNew < -bSafe || scan.newFollowerGap < minRearKinematic) return false;
  }

  const cooldown = v.vClass === 'heavy' ? 3.0 : 2.4;
  return commitLaneChange(v, topology, armGeom, lw, curLane, candLane, isOnApproach, 'left', cooldown, onLaneChange);
}

/**
 * Turn-friction aware weighted queue impedance score in an approach lane.
 * Weights queued vehicles (1.0), slow-rolling vehicles (+0.4), heavy trucks (+1.2),
 * and permissive right-turners / U-turners (+1.6) that stall intersection discharge.
 */
function countQueueInLane(
  vehicles: readonly SimVehicle[],
  armId: string,
  lane: number,
  myS: number,
  isApproach: boolean
): number {
  let score = 0;
  for (const o of vehicles) {
    if (!isApproach || o.isSlipLane) continue;
    if (
      o.originArm === armId &&
      o.laneIndex === lane &&
      o.distanceAlongPath > myS &&
      o.distanceAlongPath < o.stopLineDist + 2.5
    ) {
      if (o.speed < 2.2) {
        score += 1.0;
      } else if (o.speed < 5.0) {
        score += 0.4;
      } else {
        continue;
      }
      if (o.vClass === 'heavy') score += 1.2;
      if (o.turn === 'right' || o.turn === 'uturn' || o.turnSignalActive === 'right') score += 1.6;
    }
  }
  return score;
}

/**
 * 5-Stage Oncoming-Lane Overtaking FSM (No. 4 — Menyalip sampai memakan jalur lawan jika memungkinkan!).
 * Stages: 'none' -> 'pull_out' -> 'passing' -> 'merge_back' | 'abort' -> 'none'.
 * Strictly forbidden when road has a physical median, during heavy rain, or near the intersection stop line.
 * Uses 2D Spatial Hash Grid to perceive oncoming exit-leg traffic, supports 2-vehicle convoy overtaking,
 * kinetic Point-of-No-Return (PONR) commit vs abort, and defensive yielding.
 */
export function updateOncomingOvertakeFSM(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  topology: CompiledTopology,
  spatialHash: SpatialHashGrid,
  hasPhysicalMedian: boolean,
  light: SignalColor,
  phaseRemaining: number,
  desiredV: number,
  nearestGap: number,
  blockingLeader: SimVehicle | null,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams,
  dt: number,
  queryBuf: SimVehicle[],
  onStartOncomingOvertake: () => void
): { speedBoost: number; forceYieldToOncoming: boolean } {
  const result = { speedBoost: 1.0, forceYieldToOncoming: false };

  if (v.vClass === 'heavy' || v.isSlipLane || v.isUTurn) return result;

  const state = v.overtakeState ?? 'none';
  if (v.overtakeTimer !== undefined && v.overtakeTimer > 0) {
    v.overtakeTimer = Math.max(0, v.overtakeTimer - dt);
  }

  const isOnApproach = v.distanceAlongPath < v.stopLineDist - 12.0 && v.distanceAlongPath > 6.0;
  const isOnExit = v.distanceAlongPath > v.exitLineDist + 8.0 && v.distanceAlongPath < v.totalPathLength - 22.0;
  const activeArmId = isOnApproach ? v.originArm : v.destArm;
  const armGeom = topology.armsById[activeArmId];
  if (!armGeom) {
    if (state !== 'none') {
      v.overtakeState = 'none';
      v.overtakeTargetId = undefined;
      v.targetLateralOffset = 0;
      v.turnSignalActive = null;
    }
    return result;
  }

  const armHasMedian = hasPhysicalMedian || armGeom.def.medianWidth > 0.05;
  const myLaneCenter = isOnApproach
    ? armGeom.inLaneCenters[v.laneIndex] ?? 1.75
    : armGeom.outLaneCenters[v.destLaneIndex ?? 0] ?? 1.75;
  const oppInnerCenter = isOnApproach
    ? armGeom.outLaneCenters[0] ?? 1.75
    : armGeom.inLaneCenters[0] ?? 1.75;
  // Negative lateral offset moves rightward across centerline (0) into the oncoming innermost lane!
  const oncomingTargetLat = -(myLaneCenter + Math.min(oppInnerCenter, 1.9));
  const outLanesCount = Math.max(1, armGeom.def.outLanes);
  const myOutLane = v.destLaneIndex ?? Math.min(v.laneIndex, outLanesCount - 1);

  const toMyFrameS = (u: SimVehicle): number =>
    isOnApproach ? u.distanceAlongPath : u.distanceAlongPath - u.exitLineDist + v.exitLineDist;

  const isSameLaneOnLeg = (other: SimVehicle): boolean =>
    isOnApproach
      ? other.originArm === v.originArm && other.laneIndex === v.laneIndex && other.distanceAlongPath < other.stopLineDist
      : other.destArm === v.destArm &&
        (other.destLaneIndex ?? Math.min(other.laneIndex, outLanesCount - 1)) === myOutLane &&
        other.distanceAlongPath >= other.exitLineDist;

  // Helper: scan oncoming vehicles along the same physical corridor via Spatial Hash
  const findNearestOncoming = (): { dist: number; closingSpeed: number; opp: SimVehicle | null } => {
    const sight = Math.min(62, weather.sightDistance);
    const nearby = spatialHash.queryRadius(v.x, v.y, sight, queryBuf);
    const cosH = Math.cos(v.heading);
    const sinH = Math.sin(v.heading);

    let nearestDist = Infinity;
    let closingSpeed = 12.0;
    let nearestOpp: SimVehicle | null = null;

    for (const other of nearby) {
      if (other.id === v.id) continue;
      // Check if heading is roughly opposite (dot < -0.5)
      const dot = cosH * Math.cos(other.heading) + sinH * Math.sin(other.heading);
      if (dot > -0.45) continue;

      const dx = other.x - v.x;
      const dy = other.y - v.y;
      const forwardDist = dx * cosH + dy * sinH;
      if (forwardDist < -v.length * 0.5) continue; // Already passed behind us

      const latDist = Math.abs(-dx * sinH + dy * cosH);
      // Corridor width covering both our lane and oncoming lane
      if (latDist > armGeom.inWidth + armGeom.outWidth + 1.5) continue;

      const bumperDist = Math.max(0.1, forwardDist - (v.length + other.length) * 0.5);
      if (bumperDist < nearestDist) {
        nearestDist = bumperDist;
        closingSpeed = Math.max(4.0, v.speed + Math.max(other.speed, 6.0));
        nearestOpp = other;
      }
    }
    return { dist: nearestDist, closingSpeed, opp: nearestOpp };
  };

  // --- STATE: NONE (Evaluate whether to initiate oncoming-lane overtake) ---
  if (state === 'none') {
    if (armHasMedian || !weather.allowOncomingOvertake) return result;
    // Oncoming-lane overtaking occurs on 1-lane undivided roads (cars & motors), or 2-lane undivided for cars when blocked
    if (armGeom.def.inLanes > 2) return result;
    if (armGeom.def.inLanes >= 2 && v.vClass === 'motor') return result;
    if (armGeom.def.length < 45) return result; // Need enough straight stretch to pass and return safely
    if (!isOnApproach && !isOnExit) return result;
    const distToStop = v.stopLineDist - v.distanceAlongPath;
    if (isOnApproach && distToStop < 38.0) return result;
    // On approach legs, ONLY pull into the oncoming lane when our signal is GREEN with ample time left (>= 6.5s)
    // so the vehicle finishes passing & merges back cleanly BEFORE the light turns yellow/red!
    if (isOnApproach && (light !== 'green' || phaseRemaining < 6.5)) return result;
    if (isOnExit && (v.distanceAlongPath < v.exitLineDist + 14.0 || v.totalPathLength - v.distanceAlongPath < 26.0)) return result;
    if (isOnApproach && v.laneIndex !== 0) return result; // Must be in innermost lane next to centerline
    if (isOnApproach && v.turn === 'left') return result; // Don't cross right into oncoming if turning left soon
    if ((v.overtakeTimer ?? 0) > 0) return result;

    if (!blockingLeader) return result;
    if (blockingLeader.originArm !== v.originArm && isOnApproach) return result;
    if (nearestGap > 18.0 || nearestGap < 0.8) return result;

    // Tier 2b: Allow bypassing a stationary mid-road blocker once stuckTimer >= 1.8s
    const isMidRoadStaticBypass =
      blockingLeader.speed < 1.2 &&
      (v.stuckTimer ?? 0) >= 1.8 &&
      (isOnExit || (isOnApproach && distToStop > 32.0 && light === 'green'));
    if (isOnApproach && blockingLeader.speed < 1.2 && !isMidRoadStaticBypass) return result;
    const speedDeficit = desiredV - blockingLeader.speed;
    const baseDeficit = v.profile === 'aggressive' ? 1.8 : v.profile === 'normal' ? 2.5 : 3.6;
    const minDeficit = baseDeficit / Math.max(0.7, discipline.overtakeBoldness);
    if (speedDeficit < minDeficit) return result;

    // Check return gap ahead of blockingLeader in our lane so we don't get trapped in oncoming lane
    // Also reject if there is a stopped/slow queue building ahead of the leader on approach!
    const neededReturnGap = v.length + 5.2;
    const leaderS = toMyFrameS(blockingLeader);
    const leaderFrontS = leaderS + blockingLeader.length * 0.5;
    let aheadOfLeaderGap = isOnApproach
      ? v.stopLineDist - leaderFrontS - 10.0
      : v.totalPathLength - leaderFrontS - 8.0;
    let convoyLead: SimVehicle | null = null;

    for (const other of vehicles) {
      if (other.id === v.id || other.id === blockingLeader.id) continue;
      if (!isSameLaneOnLeg(other)) continue;
      const otherS = toMyFrameS(other);
      const gapAhead = otherS - leaderS - (other.length + blockingLeader.length) * 0.5;
      if (isOnApproach && gapAhead > 0 && gapAhead < 32.0 && other.speed < 2.2) {
        return result; // Stopped/slow queue ahead -> nowhere to tuck back in!
      }
      if (gapAhead > 0 && gapAhead < aheadOfLeaderGap) {
        aheadOfLeaderGap = gapAhead;
        convoyLead = other;
      }
    }

    let overtakeTarget: SimVehicle = blockingLeader;
    let isConvoyPass = false;
    let convoyEndS = leaderFrontS;

    if (aheadOfLeaderGap < neededReturnGap) {
      // Check if we can safely overtake the entire 2-vehicle convoy in one continuous pass
      if (!convoyLead || convoyLead.speed >= desiredV - 1.6 || (!isOnExit && light !== 'green')) {
        return result;
      }
      convoyEndS = toMyFrameS(convoyLead) + convoyLead.length * 0.5;
      let aheadOfConvoyGap = isOnApproach
        ? v.stopLineDist - convoyEndS - 10.0
        : v.totalPathLength - convoyEndS - 8.0;

      for (const other of vehicles) {
        if (other.id === v.id || other.id === blockingLeader.id || other.id === convoyLead.id) continue;
        if (!isSameLaneOnLeg(other)) continue;
        const otherS = toMyFrameS(other);
        const gapAheadConvoy = otherS - other.length * 0.5 - convoyEndS;
        if (isOnApproach && gapAheadConvoy > 0 && gapAheadConvoy < 32.0 && other.speed < 2.2) {
          return result;
        }
        if (gapAheadConvoy > 0 && gapAheadConvoy < aheadOfConvoyGap) {
          aheadOfConvoyGap = gapAheadConvoy;
        }
      }
      if (aheadOfConvoyGap < neededReturnGap) return result;

      overtakeTarget = convoyLead;
      isConvoyPass = true;
    }

    // Estimate passing time, kinematic passing distance, and oncoming TTC safety envelope
    const refTargetSpeed = isConvoyPass
      ? Math.max(blockingLeader.speed, overtakeTarget.speed)
      : blockingLeader.speed;
    const passSpeed = Math.min(desiredV * 1.18, refTargetSpeed + 5.5);
    const relPassSpeed = Math.max(2.6, passSpeed - refTargetSpeed);
    const passDist = isConvoyPass
      ? convoyEndS - (v.distanceAlongPath - v.length * 0.5) + 4.5
      : nearestGap + v.length + blockingLeader.length + 4.5;
    const tPass = passDist / relPassSpeed;
    // Kinematic AASHTO/PKJI runway check: ensure we have enough road before the intersection/end to finish passing AND merge back!
    const myRunwayNeeded = passSpeed * (tPass + 1.1);
    if (isOnApproach && distToStop < myRunwayNeeded + 22.0) return result;
    if (isOnExit && v.totalPathLength - v.distanceAlongPath < myRunwayNeeded + 10.0) return result;
    const safetyMargin =
      (v.profile === 'aggressive' ? 1.55 : v.profile === 'normal' ? 2.15 : 2.8) *
      weather.gapAcceptanceMult *
      (0.82 + 0.36 * discipline.discipline);

    const oncoming = findNearestOncoming();
    const requiredClearDist = (passSpeed + 11.5) * (tPass + safetyMargin);
    const actualTTC = oncoming.dist / oncoming.closingSpeed;
    if (
      (oncoming.dist < Math.min(weather.sightDistance * 0.92, requiredClearDist) && actualTTC < tPass + safetyMargin) ||
      (isConvoyPass && actualTTC < tPass + safetyMargin)
    ) {
      return result;
    }

    // Also ensure no other same-direction vehicle is already overtaking right beside us
    const sideNearby = spatialHash.queryRadius(v.x, v.y, 12, queryBuf);
    for (const other of sideNearby) {
      if (other.id === v.id || other.id === blockingLeader.id || other.id === overtakeTarget.id) continue;
      if (other.overtakeState && other.overtakeState !== 'none') return result;
    }

    // COMMIT TO PULL_OUT!
    v.overtakeState = 'pull_out';
    v.overtakeTargetId = overtakeTarget.id;
    v.targetLateralOffset = oncomingTargetLat;
    v.laneChangeDir = 'right'; // In LHT, overtaking into oncoming lane moves RIGHT across centerline
    v.turnSignalActive = 'right';
    onStartOncomingOvertake();
    result.speedBoost = 1.16;
    return result;
  }

  // Locate the overtaken target vehicle
  const target = vehicles.find((o) => o.id === v.overtakeTargetId) ?? null;
  const oncoming = findNearestOncoming();
  const approachingNoPassZone =
    isOnApproach && (v.stopLineDist - v.distanceAlongPath < 24.0 || light !== 'green');

  // --- STATE: PULL_OUT ---
  if (state === 'pull_out') {
    v.targetLateralOffset = oncomingTargetLat;
    v.laneChangeDir = 'right';
    v.turnSignalActive = 'right';
    result.speedBoost = 1.18;

    const suddenThreat =
      oncoming.dist < 26.0 || oncoming.dist / oncoming.closingSpeed < 2.2 || approachingNoPassZone || armHasMedian;
    if (suddenThreat || !target) {
      v.overtakeState = 'abort';
      v.targetLateralOffset = 0;
      v.laneChangeDir = 'left';
      v.turnSignalActive = 'left';
      result.speedBoost = 0.85;
      return result;
    }

    // Reached oncoming lane clearance -> enter PASSING
    if (Math.abs(v.lateralOffset - oncomingTargetLat) < 0.55) {
      v.overtakeState = 'passing';
    }
    return result;
  }

  // --- STATE: PASSING ---
  if (state === 'passing') {
    v.targetLateralOffset = oncomingTargetLat;
    result.speedBoost = 1.2;

    if (!target) {
      v.overtakeState = 'merge_back';
      v.targetLateralOffset = 0;
      v.laneChangeDir = 'left';
      v.turnSignalActive = 'left';
      return result;
    }

    const targetS = toMyFrameS(target);
    const passedClearance = v.distanceAlongPath - targetS - (v.length + target.length) * 0.5;
    if (passedClearance >= 2.2 || approachingNoPassZone) {
      v.overtakeState = 'merge_back';
      v.targetLateralOffset = 0;
      v.laneChangeDir = 'left';
      v.turnSignalActive = 'left';
      return result;
    }

    // Kinetic Point-of-No-Return (PONR): compare time-to-complete burst pass vs time-to-abort back behind target
    const oncomingTTC = oncoming.dist / oncoming.closingSpeed;
    if (oncomingTTC < 2.2 || oncoming.dist < 24.0) {
      const remPassDist = Math.max(
        0,
        targetS + target.length * 0.5 + 1.8 - (v.distanceAlongPath - v.length * 0.5)
      );
      const burstSpeed = Math.min(desiredV * 1.28, target.speed + 7.0);
      const tCommit = remPassDist / Math.max(2.2, burstSpeed - target.speed) + 0.85;
      const effDecel = Math.max(1.2, v.comfortDecel * weather.comfortDecelMult);
      const tAbort = Math.max(0.35, Math.max(0, v.speed - target.speed) / effDecel) + 0.9;

      if (
        v.distanceAlongPath >= targetS - target.length * 0.15 &&
        tCommit < tAbort &&
        oncomingTTC > tCommit + 0.4
      ) {
        result.speedBoost = 1.28;
        return result;
      } else if (
        (oncomingTTC < 1.9 || oncoming.dist < 20.0) &&
        v.distanceAlongPath < targetS + target.length * 0.25
      ) {
        v.overtakeState = 'abort';
        v.targetLateralOffset = 0;
        v.laneChangeDir = 'left';
        v.turnSignalActive = 'left';
        result.speedBoost = 0.78;
        return result;
      }
    }

    return result;
  }

  // --- STATE: MERGE_BACK ---
  if (state === 'merge_back') {
    v.targetLateralOffset = 0;
    v.laneChangeDir = 'left';
    v.turnSignalActive = 'left';
    // If still in oncoming lane near stop line and side-blocked, slow down so we can tuck cleanly back behind adjacent vehicle
    if (isOnApproach && v.stopLineDist - v.distanceAlongPath < 24.0 && v.lateralOffset < -0.5) {
      result.speedBoost = 0.65;
      result.forceYieldToOncoming = true;
    } else {
      result.speedBoost = 1.08;
    }
    if (Math.abs(v.lateralOffset) < 0.25) {
      v.overtakeState = 'none';
      v.overtakeTargetId = undefined;
      v.laneChangeDir = null;
      v.turnSignalActive = null;
      v.overtakeTimer = 3.5;
    }
    return result;
  }

  // --- STATE: ABORT ---
  if (state === 'abort') {
    v.targetLateralOffset = 0;
    v.laneChangeDir = 'left';
    v.turnSignalActive = 'left';
    result.speedBoost = 0.75;
    result.forceYieldToOncoming = oncoming.dist < 18.0;
    if (Math.abs(v.lateralOffset) < 0.25) {
      v.overtakeState = 'none';
      v.overtakeTargetId = undefined;
      v.laneChangeDir = null;
      v.turnSignalActive = null;
      v.overtakeTimer = 4.5;
    }
    return result;
  }

  return result;
}

/**
 * Defensive Yielding for vehicles facing an active oncoming overtaker in their corridor (GTA-style smart reaction!).
 * Gently slows down and nudges slightly left toward the curb so head-on collisions never occur.
 */
export function evaluateDefensiveYieldForOncomingOvertaker(
  v: SimVehicle,
  spatialHash: SpatialHashGrid,
  queryBuf: SimVehicle[]
): { speedCap: number; defensiveShiftLeft: number } {
  if (v.overtakeState && v.overtakeState !== 'none') return { speedCap: Infinity, defensiveShiftLeft: 0 };

  const nearby = spatialHash.queryRadius(v.x, v.y, 34, queryBuf);
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);

  for (const other of nearby) {
    if (other.id === v.id) continue;
    if (other.overtakeState !== 'pull_out' && other.overtakeState !== 'passing' && other.overtakeState !== 'merge_back') {
      continue;
    }
    const dot = cosH * Math.cos(other.heading) + sinH * Math.sin(other.heading);
    if (dot > -0.45) continue;

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const forward = dx * cosH + dy * sinH;
    const lat = Math.abs(-dx * sinH + dy * cosH);
    if (forward > 0 && forward < 32 && lat < 3.4) {
      return {
        speedCap: forward < 14 ? 3.5 : 6.5,
        defensiveShiftLeft: v.vClass === 'heavy' ? 0.15 : 0.38,
      };
    }
  }

  return { speedCap: Infinity, defensiveShiftLeft: 0 };
}
