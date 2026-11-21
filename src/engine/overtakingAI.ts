import { effClearanceWidth, getGlobalLat, SimVehicle } from './behaviors';
import { DisciplineParams } from './conflictResolver';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { SpatialHashGrid } from './spatialHash';
import { CompiledMovementPath, CompiledTopology } from './topologyTypes';
import { SignalColor } from './types';

export interface OvertakeMetricsDelta {
  carOvertakes: number;
  oncomingOvertakes: number;
}

/**
 * Pure IDM longitudinal acceleration helper used by MOBIL lane-change evaluation.
 */
function idmAccel(v: SimVehicle, desiredV: number, gap: number, leadSpeed: number, weather: WeatherPhysicsProfile): number {
  const aEff = v.maxAccel * v.accelFactor * weather.accelMult;
  const bEff = Math.max(0.8, v.comfortDecel * weather.comfortDecelMult);
  const s0 = v.minGap * weather.minGapMult;
  const T = v.timeHeadway * weather.headwayMult;
  const freeTerm = Math.min(6, Math.pow(v.speed / Math.max(1, desiredV), 4));
  if (!Number.isFinite(gap)) {
    return aEff * (1 - freeTerm);
  }
  const dv = v.speed - leadSpeed;
  const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(aEff * bEff)));
  return aEff * (1 - freeTerm - Math.pow(sStar / Math.max(0.15, gap), 2));
}

function getPoliteness(v: SimVehicle, discipline: DisciplineParams): number {
  const base = v.profile === 'aggressive' ? 0.06 : v.profile === 'normal' ? 0.24 : 0.55;
  return Math.max(0.02, Math.min(0.8, base * (0.65 + 0.55 * discipline.discipline)));
}

/**
 * Checks whether a candidate lane is valid for the vehicle's turn intent on its current leg.
 */
function isLaneValidForVehicle(v: SimVehicle, candLane: number, laneCount: number, isOnExitLeg: boolean): boolean {
  if (candLane < 0 || candLane >= laneCount) return false;
  if (isOnExitLeg) return true; // On exit leg, any outbound lane is valid for overtaking!
  if (v.turn === 'straight') return true;
  // On approach, turning vehicles stay in their designated turn lane to avoid cutting across multiple lanes at the box
  if (v.turn === 'left') return candLane === laneCount - 1;
  if (v.turn === 'right' || v.turn === 'uturn') return candLane === 0;
  return false;
}

/**
 * MOBIL (Minimizing Overall Braking Induced by Lane changes) + Proactive Queue Balancing (No. 3).
 * Replaces the overly restrictive `tryCarLaneChange` so cars and motorcycles actively overtake
 * slower traffic on green, balance queues while approaching red, AND overtake on exit legs!
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
  onOvertake: () => void
): boolean {
  if (v.vClass === 'heavy') return false;
  if (v.isSlipLane || v.isUTurn) return false;
  if (v.overtakeState && v.overtakeState !== 'none') return false;
  if ((v.laneChangeCooldown ?? 0) > 0) return false;
  if (Math.abs(v.lateralOffset - v.targetLateralOffset) > 0.35) return false;

  const isOnApproach = v.distanceAlongPath < v.stopLineDist - 12.0 && v.distanceAlongPath > 4.0;
  const isOnExit = v.distanceAlongPath > v.exitLineDist + 4.5 && v.distanceAlongPath < v.totalPathLength - 14.0;
  if (!isOnApproach && !isOnExit) return false;
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

  // Trigger 1: Blocked by a slower leader (moving overtake — works even at low speeds > 0.6 m/s!)
  const blockedBySlow =
    blockingLeader !== null &&
    nearestGap < 28.0 &&
    blockingLeader.speed < desiredV - 1.15;

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

  if (!blockedBySlow && !wantQueueBalance && !isMidRoadStuck) return false;
  // Cars normally need rolling speed, unless recovering from a mid-road stopped blocker
  if (!isMidRoadStuck && v.speed < (v.vClass === 'motor' ? 0.8 : 1.8)) return false;

  const politeness = getPoliteness(v, discipline);
  const bSafe = (v.profile === 'aggressive' ? 4.4 : 3.5) * weather.comfortDecelMult;
  const accelThreshold = (v.vClass === 'motor' ? 0.16 : 0.22) * (1.25 - 0.35 * discipline.overtakeBoldness);

  const curLeadSpeed = blockingLeader ? blockingLeader.speed : desiredV;
  const aCur = idmAccel(v, desiredV, nearestGap, curLeadSpeed, weather);

  const curQueueAhead = wantQueueBalance
    ? countQueueInLane(vehicles, activeArmId, curLane, v.distanceAlongPath, true)
    : 0;

  let bestCandLane = -1;
  let bestScore = -Infinity;

  for (const candLane of [curLane - 1, curLane + 1]) {
    if (!isLaneValidForVehicle(v, candLane, laneCount, isOnExit)) continue;

    const curCenter = isOnApproach
      ? (armGeom.inLaneCenters[curLane] ?? getGlobalLat(curLane, 0, lw))
      : (armGeom.outLaneCenters[curLane] ?? getGlobalLat(curLane, 0, lw));
    const candCenter = isOnApproach
      ? armGeom.inLaneCenters[candLane]
      : armGeom.outLaneCenters[candLane];
    const myEffW = effClearanceWidth(v);

    // Find immediate new leader and new follower in candidate lane
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

      const inTargetLane = Math.abs(otherLat - candCenter) < minLatClear || Math.abs(otherTargetLat - candCenter) < minLatClear;
      const movingLeft = candCenter > curCenter;
      const inSweepCorridor = movingLeft
        ? (otherLat > curCenter + 0.15 && otherLat < candCenter + minLatClear) ||
          (otherTargetLat > curCenter + 0.15 && otherTargetLat < candCenter + minLatClear)
        : (otherLat < curCenter - 0.15 && otherLat > candCenter - minLatClear) ||
          (otherTargetLat < curCenter - 0.15 && otherTargetLat > candCenter - minLatClear);

      if (!inTargetLane && !inSweepCorridor) {
        continue;
      }

      const myS = isOnApproach ? v.distanceAlongPath : v.distanceAlongPath - v.exitLineDist;
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

    if (sideBlocked) continue;

    // Require enough braking space behind new leader
    const minReqFrontGap = Math.max(2.4, v.minGap * 1.15 + Math.max(0, v.speed - (newLeader?.speed ?? desiredV)) * 0.65);
    if (newLeader && newLeaderGap < minReqFrontGap) continue;

    // MOBIL Safety Criterion on new follower
    let followerDeltaA = 0;
    if (newFollower) {
      const nfDesired = newFollower.maxSpeed * newFollower.speedFactor * weather.speedMult[newFollower.vClass];
      const nfOldGap = newLeader ? newFollowerGap + v.length + newLeaderGap : Infinity;
      const aNfOld = idmAccel(newFollower, nfDesired, nfOldGap, newLeader?.speed ?? nfDesired, weather);
      const aNfNew = idmAccel(newFollower, nfDesired, newFollowerGap, v.speed, weather);
      const dvRear = Math.max(0, newFollower.speed - v.speed);
      const minRearKinematic = (dvRear * dvRear) / (2 * Math.max(1.5, bSafe)) + newFollower.minGap + 0.8;
      if (aNfNew < -bSafe || newFollowerGap < minRearKinematic) continue;
      followerDeltaA = aNfNew - aNfOld;
    }

    // MOBIL Incentive Criterion
    const aNew = idmAccel(v, desiredV, newLeaderGap, newLeader?.speed ?? desiredV, weather);
    let incentive = (aNew - aCur) + politeness * followerDeltaA;

    // Queue balance bonus when approaching red/stopped queue
    if (wantQueueBalance) {
      const candQueue = countQueueInLane(vehicles, activeArmId, candLane, v.distanceAlongPath, true);
      if (candQueue + 1 < curQueueAhead) {
        incentive += (curQueueAhead - candQueue) * 0.45;
      }
    }

    if (incentive > accelThreshold && incentive > bestScore) {
      bestScore = incentive;
      bestCandLane = candLane;
    }
  }

  if (bestCandLane === -1) return false;

  // Commit lane change smoothly!
  if (isOnApproach) {
    const oldCenter = armGeom.inLaneCenters[curLane] ?? getGlobalLat(curLane, 0, lw);
    const newCenter = armGeom.inLaneCenters[bestCandLane] ?? getGlobalLat(bestCandLane, 0, lw);
    const paths = topology.pathLookup[v.originArm]?.[v.turn];
    const nextPath: CompiledMovementPath | undefined = paths?.[bestCandLane];
    if (!nextPath) return false;

    v.laneIndex = bestCandLane;
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
    v.laneChangeDir = bestCandLane > curLane ? 'left' : 'right';
  } else {
    // Exit-leg overtake: shift targetLateralOffset relative to compiledPath's anchor destLane, and sync destLaneIndex
    const anchorLane = v.compiledPath?.destLane ?? v.destLaneIndex ?? 0;
    const curBaseCenter = armGeom.outLaneCenters[anchorLane] ?? getGlobalLat(anchorLane, 0, lw);
    const targetCenter = armGeom.outLaneCenters[bestCandLane] ?? getGlobalLat(bestCandLane, 0, lw);
    v.destLaneIndex = bestCandLane;
    v.targetLateralOffset = targetCenter - curBaseCenter;
    v.laneChangeDir = bestCandLane > curLane ? 'left' : 'right';
  }

  v.laneChangeCooldown = v.vClass === 'motor' ? 1.4 : 2.2;
  if (v.vClass === 'car') onOvertake();
  return true;
}

function countQueueInLane(
  vehicles: readonly SimVehicle[],
  armId: string,
  lane: number,
  myS: number,
  isApproach: boolean
): number {
  let count = 0;
  for (const o of vehicles) {
    if (isApproach) {
      if (o.originArm === armId && o.laneIndex === lane && o.distanceAlongPath > myS && o.distanceAlongPath < o.stopLineDist && o.speed < 2.2) {
        count++;
      }
    }
  }
  return count;
}

/**
 * 5-Stage Oncoming-Lane Overtaking FSM (No. 4 — Menyalip sampai memakan jalur lawan jika memungkinkan!).
 * Stages: 'none' -> 'pull_out' -> 'passing' -> 'merge_back' | 'abort' -> 'none'.
 * Strictly forbidden when road has a physical median, during heavy rain, or near the intersection stop line.
 * Uses 2D Spatial Hash Grid to perceive oncoming exit-leg traffic and supports real-time ABORT + defensive yielding.
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
    // On approach legs, ONLY pull into the oncoming lane when our signal is GREEN with ample time left (>= 7.5s)
    // so the vehicle finishes passing & merges back cleanly BEFORE the light turns yellow/red!
    if (isOnApproach && (light !== 'green' || phaseRemaining < 7.5)) return result;
    if (isOnExit && (v.distanceAlongPath < v.exitLineDist + 14.0 || v.totalPathLength - v.distanceAlongPath < 28.0)) return result;
    if (isOnApproach && v.laneIndex !== 0) return result; // Must be in innermost lane next to centerline
    if (isOnApproach && v.turn === 'left') return result; // Don't cross right into oncoming if turning left soon
    if ((v.overtakeTimer ?? 0) > 0) return result;

    if (!blockingLeader) return result;
    if (blockingLeader.originArm !== v.originArm && isOnApproach) return result;
    if (nearestGap > 18.0 || nearestGap < 1.0) return result;

    // Tier 2b: Allow bypassing a stationary mid-road blocker once stuckTimer >= 1.8s
    const isMidRoadStaticBypass =
      blockingLeader.speed < 1.2 &&
      (v.stuckTimer ?? 0) >= 1.8 &&
      (isOnExit || (isOnApproach && distToStop > 32.0 && light === 'green'));
    if (isOnApproach && !isMidRoadStaticBypass && distToStop < 48.0) return result;
    if (isOnApproach && blockingLeader.speed < 1.2 && !isMidRoadStaticBypass) return result;
    const speedDeficit = desiredV - blockingLeader.speed;
    const baseDeficit = v.profile === 'aggressive' ? 1.8 : v.profile === 'normal' ? 2.5 : 3.6;
    const minDeficit = baseDeficit / Math.max(0.7, discipline.overtakeBoldness);
    if (speedDeficit < minDeficit) return result;

    // Check return gap ahead of blockingLeader in our lane so we don't get trapped in oncoming lane
    // Also reject if there is a stopped/slow queue building ahead of the leader on approach!
    const neededReturnGap = v.length + 5.2;
    let aheadOfLeaderGap = isOnApproach
      ? v.stopLineDist - (blockingLeader.distanceAlongPath + blockingLeader.length * 0.5) - 10.0
      : v.totalPathLength - (blockingLeader.distanceAlongPath + blockingLeader.length * 0.5) - 8.0;

    for (const other of vehicles) {
      if (other.id === v.id || other.id === blockingLeader.id) continue;
      const sameLeg = isOnApproach
        ? other.originArm === v.originArm && other.laneIndex === v.laneIndex && other.distanceAlongPath < other.stopLineDist
        : other.destArm === v.destArm && other.distanceAlongPath >= other.exitLineDist;
      if (!sameLeg) continue;
      const gapAhead =
        other.distanceAlongPath -
        blockingLeader.distanceAlongPath -
        (other.length + blockingLeader.length) * 0.5;
      if (isOnApproach && gapAhead > 0 && gapAhead < 32.0 && other.speed < 2.2) {
        return result; // Stopped/slow queue ahead -> nowhere to tuck back in!
      }
      if (gapAhead > 0 && gapAhead < aheadOfLeaderGap) {
        aheadOfLeaderGap = gapAhead;
      }
    }
    if (aheadOfLeaderGap < neededReturnGap) return result;

    // Estimate passing time, kinematic passing distance, and oncoming TTC safety envelope
    const passSpeed = Math.min(desiredV * 1.18, blockingLeader.speed + 5.5);
    const relPassSpeed = Math.max(2.6, passSpeed - blockingLeader.speed);
    const passDist = nearestGap + v.length + blockingLeader.length + 4.5;
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
    if (oncoming.dist < Math.min(weather.sightDistance * 0.92, requiredClearDist) && actualTTC < tPass + safetyMargin) {
      return result;
    }

    // Also ensure no other same-direction vehicle is already overtaking right beside us
    const sideNearby = spatialHash.queryRadius(v.x, v.y, 12, queryBuf);
    for (const other of sideNearby) {
      if (other.id === v.id || other.id === blockingLeader.id) continue;
      if (other.overtakeState && other.overtakeState !== 'none') return result;
    }

    // COMMIT TO PULL_OUT!
    v.overtakeState = 'pull_out';
    v.overtakeTargetId = blockingLeader.id;
    v.targetLateralOffset = oncomingTargetLat;
    v.laneChangeDir = 'right'; // In LHT, overtaking into oncoming lane moves RIGHT across centerline
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
    result.speedBoost = 1.18;

    const suddenThreat = oncoming.dist < 26.0 || oncoming.dist / oncoming.closingSpeed < 2.2 || approachingNoPassZone || armHasMedian;
    if (suddenThreat || !target) {
      v.overtakeState = 'abort';
      v.targetLateralOffset = 0;
      v.laneChangeDir = 'left';
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
      return result;
    }

    const passedClearance = v.distanceAlongPath - target.distanceAlongPath - (v.length + target.length) * 0.5;
    if (passedClearance >= 2.2 || approachingNoPassZone) {
      v.overtakeState = 'merge_back';
      v.targetLateralOffset = 0;
      v.laneChangeDir = 'left';
      return result;
    }

    // Abort if sudden oncoming vehicle appears AND we haven't passed leader's midpoint yet
    const oncomingTTC = oncoming.dist / oncoming.closingSpeed;
    if ((oncomingTTC < 1.9 || oncoming.dist < 20.0) && v.distanceAlongPath < target.distanceAlongPath) {
      v.overtakeState = 'abort';
      v.targetLateralOffset = 0;
      v.laneChangeDir = 'left';
      result.speedBoost = 0.78;
      return result;
    }

    return result;
  }

  // --- STATE: MERGE_BACK ---
  if (state === 'merge_back') {
    v.targetLateralOffset = 0;
    v.laneChangeDir = 'left';
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
      v.overtakeTimer = 3.5;
    }
    return result;
  }

  // --- STATE: ABORT ---
  if (state === 'abort') {
    v.targetLateralOffset = 0;
    v.laneChangeDir = 'left';
    result.speedBoost = 0.75;
    result.forceYieldToOncoming = oncoming.dist < 18.0;
    if (Math.abs(v.lateralOffset) < 0.25) {
      v.overtakeState = 'none';
      v.overtakeTargetId = undefined;
      v.laneChangeDir = null;
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
