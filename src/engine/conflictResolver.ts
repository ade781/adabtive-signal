import { SimVehicle } from './behaviors';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { isOccludedByHeavyVehicle } from './perceptionAI';
import { SpatialHashGrid } from './spatialHash';
import { CompiledTopology, MovementSignalState } from './topologyTypes';

export interface DisciplineParams {
  discipline: number; // 0 (chaotic) .. 1 (strict)
  yellowBoxCompliance: number;
  stopLineCreepProb: number;
  stopLineCreepMeters: number;
  redLightRunMult: number;
  overtakeBoldness: number;
  markingCrossPropensity: number; // 0 (obeys solid lines) .. 1 (Indonesian-style marking crossing)
}

export function computeDisciplineParams(rawDiscipline?: number): DisciplineParams {
  const d = Math.max(0, Math.min(1, Number.isFinite(rawDiscipline) ? rawDiscipline! : 0.72));
  return {
    discipline: d,
    yellowBoxCompliance: 0.2 + 0.8 * d,
    // Keep stop-line creep strictly disabled at >= 0.65 so RHK pocket invariant holds at default (0.72)
    stopLineCreepProb: d < 0.65 ? (0.65 - d) * 1.15 : 0,
    stopLineCreepMeters: d < 0.65 ? 0.7 + (0.65 - d) * 2.4 : 0,
    redLightRunMult: 1.55 - 1.25 * d,
    overtakeBoldness: 1.32 - 0.52 * d,
    markingCrossPropensity: d < 0.85 ? Math.min(1, (0.85 - d) * 1.35 + 0.12) : 0,
  };
}

/**
 * Deterministic priority negotiation when two vehicles deadlock face-to-face or inside the box.
 * Returns 'yield' if `self` should back off / yield space to `blocker`, or 'proceed' if `self` holds priority.
 */
export function negotiateDeadlockPriority(self: SimVehicle, blocker: SimVehicle): 'yield' | 'proceed' {
  const selfInOncoming = Boolean(self.overtakeState && self.overtakeState !== 'none') || Boolean(self.crossingMarking);
  const blockerInOncoming = Boolean(blocker.overtakeState && blocker.overtakeState !== 'none') || Boolean(blocker.crossingMarking);
  // Offender crossing centerline always yields to lawful traffic in its own lane
  if (selfInOncoming && !blockerInOncoming) return 'yield';
  if (!selfInOncoming && blockerInOncoming) return 'proceed';

  // Smaller/nimbler vehicles yield to heavier vehicles (motor yields to car/heavy, car yields to heavy)
  const classRank: Record<SimVehicle['vClass'], number> = { motor: 1, car: 2, heavy: 3 };
  if (classRank[self.vClass] !== classRank[blocker.vClass]) {
    return classRank[self.vClass] < classRank[blocker.vClass] ? 'yield' : 'proceed';
  }

  // Vehicle further from clearing the intersection yields to the one closer to exiting
  const selfRem = self.exitLineDist - self.distanceAlongPath;
  const blockerRem = blocker.exitLineDist - blocker.distanceAlongPath;
  if (Math.abs(selfRem - blockerRem) > 0.8) {
    return selfRem > blockerRem ? 'yield' : 'proceed';
  }

  // Deterministic tiebreaker so both never pick the same action simultaneously
  return self.id > blocker.id ? 'yield' : 'proceed';
}

export interface ConflictYieldDecision {
  shouldYield: boolean;
  /** Distance gap to stop before conflict staging point */
  yieldGap: number;
  /** Optional speed cap while approaching yield point */
  speedCap: number;
  reason: 'none' | 'opposing-straight' | 'slip-merge' | 'uturn-yield' | 'yellow-box';
}

const CRITICAL_GAP_BASE: Record<SimVehicle['vClass'], number> = {
  motor: 2.35,
  car: 3.45,
  heavy: 4.85,
};

/**
 * Computes Phase 3 game-theoretic critical gap scaling combining:
 * - Social Value Orientation (SVO): prosocial drivers keep safer gaps, egoistic drivers accept tighter gaps
 * - Optional external caution multiplier (`gapCautiousMult`) and Motor Swarm Shield (`hasSwarmShield`)
 * - V2V connectedness (`isConnected`) for crisper arrival perception
 * - Dynamic Gap Decay over box/yield waiting time and driver frustration
 */
function computeCriticalGapModifiers(
  v: SimVehicle,
  includeQueueWait: boolean,
  options?: { hasSwarmShield?: boolean; gapCautiousMult?: number }
): number {
  const svoAngle = v.svoAngle ?? 0.35;
  const svoFactor = Math.max(0.84, Math.min(1.2, 0.94 + 0.16 * (svoAngle / (Math.PI / 4))));
  const gapCautiousMult = options?.gapCautiousMult ?? 1.0;
  const swarmShieldMult = options?.hasSwarmShield && v.vClass === 'motor' ? 0.86 : 1.0;
  const connectedMult = v.isConnected ? 0.9 : 1.0;

  const frustration = v.frustration ?? 0;
  const boxWait = v.boxWaitTime ?? 0;
  const queueWait = includeQueueWait ? (v.waitingTime ?? 0) : 0;
  const waitDecay = Math.min(
    0.26,
    Math.max(0, boxWait - 0.35) * 0.065 +
      frustration * 0.24 +
      Math.max(0, queueWait - 1.2) * 0.025
  );
  const dynamicGapDecay = Math.max(0.72, 1 - waitDecay);

  return svoFactor * gapCautiousMult * swarmShieldMult * connectedMult * dynamicGapDecay;
}

/**
 * Projects opponent arrival time over distance `d` using current acceleration intent
 * (`prevAccel` and `brakingHard`) and harmonic/average speed between current and projected velocity.
 */
function estimateKinematicArrivalTime(d: number, oppSpeed: number, other: SimVehicle): number {
  const dist = Math.max(0, d);
  const rawAccel = other.prevAccel ?? 0;
  const isDecelerating = Boolean(other.brakingHard) || rawAccel < -1.0;
  const oppAccel = other.brakingHard
    ? Math.min(-1.2, rawAccel)
    : Math.max(-2.8, Math.min(2.0, rawAccel));

  if (isDecelerating && oppAccel < -0.5) {
    const decelMag = Math.abs(oppAccel);
    const stopDist = (oppSpeed * oppSpeed) / (2 * decelMag);
    if (dist > stopDist && stopDist <= 24) {
      const tStop = oppSpeed / decelMag;
      const creepSpeed = Math.max(1.0, oppSpeed * 0.28);
      return tStop + (dist - stopDist) / creepSpeed;
    }
    const vProj = Math.sqrt(Math.max(0, oppSpeed * oppSpeed + 2 * oppAccel * Math.min(dist, 24)));
    const avgSpeed = Math.max(0.6, 0.5 * (oppSpeed + vProj));
    return dist / avgSpeed;
  }

  const vProj = Math.max(
    1.2,
    Math.sqrt(Math.max(0, oppSpeed * oppSpeed + 2 * oppAccel * Math.min(dist, 18)))
  );
  const avgSpeed = Math.max(1.2, 0.5 * (oppSpeed + vProj));
  return dist / avgSpeed;
}

/**
 * Evaluates right-of-way priority conflicts (No. 2 — straight vehicles take priority over crossing turns!)
 * including:
 * - Permissive right-turns yielding to oncoming straight traffic (2-phase simultaneous signals) with in-box staging
 * - Slip-lane left-turns yielding to merging through-traffic on destination arm
 * - Pre-intersection U-turns yielding to oncoming exit traffic on the same arm
 */
export function evaluatePriorityConflictYield(
  v: SimVehicle,
  signalState: MovementSignalState,
  topology: CompiledTopology,
  spatialHash: SpatialHashGrid,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams,
  queryBuf: SimVehicle[],
  options?: { hasSwarmShield?: boolean; gapCautiousMult?: number }
): ConflictYieldDecision {
  const none: ConflictYieldDecision = { shouldYield: false, yieldGap: Infinity, speedCap: Infinity, reason: 'none' };

  const pathKey = v.pathKey;
  if (!pathKey) return none;

  const frustration = v.frustration ?? 0;

  // 1. Pre-intersection U-Turn yielding to oncoming exit stream on the same physical arm
  if (v.isUTurn && v.distanceAlongPath < v.stopLineDist + 2.5) {
    const frontBumper = v.distanceAlongPath + v.length * 0.5;
    const distToTurn = v.stopLineDist - frontBumper;
    if (distToTurn > -1.5 && distToTurn < 24) {
      const nearby = spatialHash.queryRadius(v.x, v.y, Math.min(48, weather.sightDistance), queryBuf);
      const gapModifiers = computeCriticalGapModifiers(v, true, options);
      const critGap = Math.max(
        1.3,
        CRITICAL_GAP_BASE[v.vClass] * weather.gapAcceptanceMult * (0.9 + 0.25 * discipline.discipline) * gapModifiers
      );
      const originArmGeom = topology.armsById[v.originArm];
      const oneLaneOpp = (originArmGeom?.def.inLanes ?? 1) <= 1;
      for (const other of nearby) {
        if (other.id === v.id) continue;
        // Opposing traffic exiting along v.originArm
        if (other.destArm !== v.originArm) continue;
        if (other.distanceAlongPath < other.exitLineDist - 4) continue;
        // Only yield to vehicles in the innermost lane (where U-turn merges) unless 1-lane road
        if (!oneLaneOpp && other.destLaneIndex !== undefined && other.destLaneIndex > 0) continue;
        if (isOccludedByHeavyVehicle(v, other, nearby)) continue;
        const dx = v.x - other.x;
        const dy = v.y - other.y;
        const forwardToMe = dx * Math.cos(other.heading) + dy * Math.sin(other.heading);
        if (forwardToMe < -other.length) continue; // Already passed us
        const oppSpeed = other.brakingHard ? Math.max(1.2, other.speed) : Math.max(2.0, other.speed);
        const tOppArrive = estimateKinematicArrivalTime(forwardToMe, oppSpeed, other);
        if (tOppArrive < critGap || forwardToMe < 9.0) {
          return {
            shouldYield: true,
            yieldGap: Math.max(0.15, distToTurn),
            speedCap: 5.0,
            reason: 'uturn-yield',
          };
        }
      }
    }
    return none;
  }

  // 2. Slip-lane merge yield onto destination arm (uses EXACT world-space merge point, works for any islandSetback!)
  if (v.isSlipLane && v.distanceAlongPath + v.length * 0.5 < v.exitLineDist - 0.8) {
    const armDef = topology.armsById[v.originArm]?.def;
    if (armDef?.slipLane?.yieldControl === 'yield') {
      const frontBumper = v.distanceAlongPath + v.length * 0.5;
      const distToMerge = v.exitLineDist - 5.2 - frontBumper;
      if (distToMerge > -3.8 && distToMerge < 22) {
        const mergePt = v.compiledPath?.sample(v.exitLineDist);
        if (mergePt) {
          const nearby = spatialHash.queryRadius(mergePt.x, mergePt.y, Math.min(42, weather.sightDistance), queryBuf);
          const gapModifiers = computeCriticalGapModifiers(v, true, options);
          const critGap = Math.max(
            1.15,
            CRITICAL_GAP_BASE[v.vClass] * 0.72 * weather.gapAcceptanceMult * gapModifiers
          );
          const destGeom = topology.armsById[v.destArm];
          const destOuterLane = Math.max(0, (destGeom?.def.outLanes ?? 1) - 1);
          for (const other of nearby) {
            if (other.id === v.id || other.originArm === v.originArm) continue;
            if (other.destArm !== v.destArm) continue;
            // Only yield to traffic in the outer destination lane where slip-lane merges
            if (destOuterLane > 0 && other.destLaneIndex !== undefined && other.destLaneIndex < destOuterLane - 0) {
              continue;
            }
            if (isOccludedByHeavyVehicle(v, other, nearby)) continue;
            // Exact world-space distance along other's heading to reach our slip-lane merge point
            const mdx = mergePt.x - other.x;
            const mdy = mergePt.y - other.y;
            const otherDistToMerge = mdx * Math.cos(other.heading) + mdy * Math.sin(other.heading);
            if (otherDistToMerge < -(other.length * 0.5 + 2.0) || otherDistToMerge > 34) continue;
            const oppSpeed = other.brakingHard ? Math.max(1.2, other.speed) : Math.max(2.0, other.speed);
            const tOppArrive = estimateKinematicArrivalTime(otherDistToMerge, oppSpeed, other);
            if (tOppArrive < critGap && (other.speed > 0.8 || Math.abs(otherDistToMerge) < 8.0)) {
              return {
                shouldYield: true,
                yieldGap: Math.max(0.05, distToMerge),
                speedCap: distToMerge <= 0 ? 0.5 : 5.2,
                reason: 'slip-merge',
              };
            }
          }
        }
      }
    }
    return none;
  }

  const frontBumper = v.distanceAlongPath + v.length * 0.5;
  // 3. Cooperative Courtesy Yield: if a conflicting cross-arm vehicle is trapped in the box (>= 2.2s,
  // or >= 1.6s near the center conflict zone for disciplined drivers), hold approaching vehicles
  // behind the stop line briefly so the box can clear.
  const distToStopLine = v.stopLineDist - frontBumper;
  const canBaseCourtesy = distToStopLine > 1.5 && distToStopLine < 12.0;
  const canDisciplinedCourtesy =
    discipline.discipline >= 0.6 && distToStopLine > 2.2 && distToStopLine < 13.0;
  if ((canBaseCourtesy || canDisciplinedCourtesy) && !v.isSlipLane && !v.isUTurn) {
    const nearbyBox = spatialHash.queryRadius(v.x, v.y, 42, queryBuf);
    for (const other of nearbyBox) {
      if (other.id === v.id || other.originArm === v.originArm) continue;
      if (other.isSlipLane || other.isUTurn) continue;
      if (
        !other.hasExitedIntersection &&
        other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.5
      ) {
        const wait = other.boxWaitTime ?? 0;
        const standardTrapped = canBaseCourtesy && wait >= 2.2;
        const disciplinedTrapped =
          canDisciplinedCourtesy &&
          wait >= 1.6 &&
          other.distanceAlongPath < other.exitLineDist - 1.5;
        if (standardTrapped || disciplinedTrapped) {
          return {
            shouldYield: true,
            yieldGap: Math.max(0.15, distToStopLine),
            speedCap: 4.5,
            reason: 'yellow-box',
          };
        }
      }
    }
  }

  // 4. Permissive turn (e.g. Right turn during 2-phase simultaneous green) yielding to higher-priority straight flow!
  if (signalState !== 'permissive-green') return none;
  if (v.turn !== 'right' && v.turn !== 'uturn') return none;

  const zones = topology.conflictsByPathKey[pathKey];
  if (!zones || zones.length === 0) return none;

  // Deadlock breaker: if vehicle has been waiting inside the box > 3.2s and opposing vehicle is also stopped, release
  const boxWait = v.boxWaitTime ?? 0;

  const nearby = spatialHash.queryRadius(v.x, v.y, Math.min(54, weather.sightDistance), queryBuf);
  const profileScale = v.profile === 'aggressive' ? 0.82 : v.profile === 'cautious' ? 1.18 : 1.0;
  const gapModifiers = computeCriticalGapModifiers(v, false, options);
  const critGap = Math.max(
    1.2,
    CRITICAL_GAP_BASE[v.vClass] *
      profileScale *
      weather.gapAcceptanceMult *
      (0.85 + 0.3 * discipline.discipline) *
      gapModifiers
  );
  // In-box creeping: waiting right-turners inch carefully toward turning arc while watching oncoming stream
  const creepOffset =
    boxWait > 0.8 || frustration > 0.25
      ? Math.min(1.35, boxWait * 0.24 + frustration * 0.75) * (0.6 + 0.4 * (1 - discipline.discipline))
      : 0;

  let closestYieldGap = Infinity;

  for (const cz of zones) {
    const amA = cz.pathKeyA === pathKey;
    // Only yield when the other movement has higher priority (e.g. straight > right)
    const otherHasPriority = amA ? cz.priority === 'B' : cz.priority === 'A';
    if (!otherHasPriority) continue;

    const myConflictS = amA ? cz.sA : cz.sB;
    const otherPathKey = amA ? cz.pathKeyB : cz.pathKeyA;
    const otherConflictS = amA ? cz.sB : cz.sA;
    const expectedOtherArm = amA ? cz.originArmB : cz.originArmA;
    const expectedOtherMovement = amA ? cz.movementB : cz.movementA;

    // Stage near box lip (creeping carefully toward the turning arc when waiting), never entering the opposing straight corridor
    const stagingS = Math.min(myConflictS - 2.15, v.stopLineDist + 0.6 + creepOffset);
    if (v.distanceAlongPath > stagingS + 1.5) continue;
    const gapToStaging = stagingS - frontBumper;
    if (gapToStaging < -0.6 || gapToStaging > 28.0) continue; // Already past staging or too far away

    // Scan nearby vehicles on the prioritized conflicting movement
    for (const other of nearby) {
      if (other.id === v.id) continue;
      if (other.originArm !== expectedOtherArm) continue;
      if (other.pathKey !== otherPathKey && other.turn !== expectedOtherMovement) continue;

      // Opposing Blinker Intent Reading (LHT):
      // Opposing left-turners exit to the opponent's left (= v's right side) before the intersection center.
      // Only skip if `other.turn === 'left'` wasn't supposed to share `otherPathKey` (non-merge),
      // or if an opposing straight vehicle past stop line is genuinely turning away from `cz.point`.
      if ((other.turn === 'left' || other.turnSignalActive === 'left') && other.originArm !== v.originArm) {
        if (other.turn === 'left' && expectedOtherMovement !== 'left' && other.pathKey !== otherPathKey) {
          continue;
        }
        if (other.turn === 'left' && cz.type !== 'merge' && other.destArm !== v.destArm) {
          continue;
        }
        const isLaneChanging = Boolean(other.pendingLaneChangeDir || other.laneChangeDir);
        if (
          other.turnSignalActive === 'left' &&
          !isLaneChanging &&
          other.distanceAlongPath > other.stopLineDist - 1.5
        ) {
          const toCzX = cz.point.x - other.x;
          const toCzY = cz.point.y - other.y;
          const distToCz = Math.hypot(toCzX, toCzY);
          if (distToCz > 1.5) {
            const headingDot =
              (toCzX * Math.cos(other.heading) + toCzY * Math.sin(other.heading)) / distToCz;
            if (headingDot < 0.65) {
              continue;
            }
          }
        }
      }

      const otherFront = other.distanceAlongPath + other.length * 0.5;
      const otherRear = other.distanceAlongPath - other.length * 0.5;
      // Already cleared the conflict zone
      if (otherRear > otherConflictS + 1.8) continue;
      if (isOccludedByHeavyVehicle(v, other, nearby)) continue;

      // Ignore stopped opposing vehicle far behind stop line on red (or deadlocked)
      const distOtherToConflict = otherConflictS - otherFront;
      if (distOtherToConflict > 46) continue;
      if (other.speed < 0.4 && distOtherToConflict > 6.0) continue;
      if (boxWait > 3.2 && other.speed < 0.35 && distOtherToConflict > 2.5) continue;

      // Project opponent arrival using current velocity and smooth deceleration intent
      const oppDecelerating = Boolean(other.brakingHard) || (other.prevAccel ?? 0) < -1.0;
      const baseOppMin =
        oppDecelerating || (other.speed < 2.6 && distOtherToConflict > 8.0)
          ? Math.max(1.1, other.speed * 0.95)
          : distOtherToConflict < 14
            ? 4.2
            : 2.5;
      const oppSpeed = Math.max(other.speed, baseOppMin);
      const tOppArrive = estimateKinematicArrivalTime(distOtherToConflict, oppSpeed, other);
      const tSelfClear = (Math.max(0, myConflictS - v.distanceAlongPath) + v.length + 2.3) / Math.max(4.0, v.speed + 2.4);

      if (distOtherToConflict < 3.5 || tOppArrive < Math.max(critGap * 0.72, tSelfClear + 0.75)) {
        if (gapToStaging < closestYieldGap) {
          closestYieldGap = Math.max(0.15, gapToStaging);
        }
      }
    }
  }

  if (Number.isFinite(closestYieldGap)) {
    return {
      shouldYield: true,
      yieldGap: closestYieldGap,
      speedCap: 6.2,
      reason: 'opposing-straight',
    };
  }

  return none;
}

/**
 * Yellow Box Junction Awareness (No. 8 — Anti-Gridlock):
 * Before entering the intersection box on green, checks whether there is enough physical space
 * beyond `exitLineDist` on `destArm` to receive the full vehicle length without stranding inside the box.
 */
export function shouldHoldForYellowBox(
  v: SimVehicle,
  yellowBoxEnabled: boolean,
  vehicles: readonly SimVehicle[],
  topology: CompiledTopology
): boolean {
  if (!yellowBoxEnabled) return false;
  if (v.isSlipLane || v.isUTurn) return false;
  if (v.respectsYellowBox === false) return false;

  const frontBumper = v.distanceAlongPath + v.length * 0.5;
  const distToStop = v.stopLineDist - frontBumper;
  // Evaluate only as vehicle approaches the stop line (not already inside box)
  if (distToStop < -0.1 || distToStop > 14.0) return false;

  const destArm = topology.armsById[v.destArm];
  if (!destArm) return false;

  const requiredSpace = v.length + 2.2;
  const checkWindow = requiredSpace + 5.5;
  let nearestBlockedExitDist = Infinity;

  for (const other of vehicles) {
    if (other.id === v.id) continue;
    if (other.destArm !== v.destArm) continue;
    // Consider vehicles on destination exit leg AND slow/stopped vehicles still inside box heading to same exit
    if (other.distanceAlongPath < other.stopLineDist + 0.5) continue;
    if (
      destArm.def.outLanes > 1 &&
      other.destLaneIndex !== undefined &&
      v.destLaneIndex !== undefined &&
      other.destLaneIndex !== v.destLaneIndex
    ) {
      continue;
    }
    const distPastExit = other.distanceAlongPath - other.exitLineDist - other.length * 0.5;
    if (distPastExit <= checkWindow && other.speed < 2.0) {
      if (distPastExit < nearestBlockedExitDist) {
        nearestBlockedExitDist = distPastExit;
      }
    }
  }

  return nearestBlockedExitDist < requiredSpace;
}

/**
 * Preventive Space-Time Box Anti-Gridlock (Phase 2):
 * Evaluates right before a vehicle crosses `stopLineDist` on green whether entering the box
 * would conflict with stalled cross-stream traffic on a conflict zone or trap the vehicle
 * behind saturated downstream traffic inside the box over a conflict zone.
 */
export function shouldHoldForConflictCorridor(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  topology: CompiledTopology,
  spatialHash: SpatialHashGrid,
  discipline: DisciplineParams,
  queryBuf: SimVehicle[]
): boolean {
  if (v.isSlipLane || v.isUTurn || !v.pathKey) return false;

  const frontBumper = v.distanceAlongPath + v.length * 0.5;
  const distToStop = v.stopLineDist - frontBumper;
  if (distToStop < -0.1 || distToStop > 14.0) return false;

  // Respect driver discipline so low-discipline chaotic scenarios still exhibit realistic push-ins
  if (v.respectsYellowBox === false && discipline.discipline < 0.55) return false;
  if (discipline.discipline < 0.4 && v.profile === 'aggressive') return false;

  const zones = topology.conflictsByPathKey[v.pathKey];
  if (!zones || zones.length === 0) return false;

  const queried = spatialHash.queryRadius(v.x, v.y, 46, queryBuf);
  const nearby = queried.length > 0 ? queried : vehicles;

  // a) Cross-stream stalled on one of v's conflict zones inside the box
  for (let z = 0; z < zones.length; z++) {
    const cz = zones[z];
    const amA = cz.pathKeyA === v.pathKey;
    const otherArm = amA ? cz.originArmB : cz.originArmA;
    const otherPathKey = amA ? cz.pathKeyB : cz.pathKeyA;
    const otherMovement = amA ? cz.movementB : cz.movementA;
    const otherConflictS = amA ? cz.sB : cz.sA;

    for (let i = 0; i < nearby.length; i++) {
      const other = nearby[i];
      if (other.id === v.id || other.originArm === v.originArm) continue;
      if (other.originArm !== otherArm || other.isSlipLane || other.isUTurn) continue;
      if (other.pathKey !== otherPathKey && other.turn !== otherMovement) continue;
      if (other.speed >= 0.75 || (other.boxWaitTime ?? 0) < 0.6) continue;

      const otherFront = other.distanceAlongPath + other.length * 0.5;
      const otherRear = other.distanceAlongPath - other.length * 0.5;
      if (otherFront >= otherConflictS - 3.2 && otherRear <= otherConflictS + 2.8) {
        return true;
      }
    }
  }

  // b) Same-movement / downstream box saturation trapping v on entry or over a conflict zone
  const destArmGeom = topology.armsById[v.destArm];
  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.isSlipLane || other.isUTurn) continue;
    if (other.speed >= 0.65) continue;

    const otherFront = other.distanceAlongPath + other.length * 0.5;
    const otherRear = other.distanceAlongPath - other.length * 0.5;
    if (otherFront <= other.stopLineDist + 0.3 || otherRear >= other.exitLineDist + 0.5) {
      continue;
    }

    const sameOriginAhead =
      other.originArm === v.originArm &&
      other.distanceAlongPath > v.distanceAlongPath &&
      (other.laneIndex === v.laneIndex || other.pathKey === v.pathKey);
    const sameDestLane =
      other.destArm === v.destArm &&
      (!destArmGeom ||
        destArmGeom.def.outLanes <= 1 ||
        other.destLaneIndex === undefined ||
        v.destLaneIndex === undefined ||
        other.destLaneIndex === v.destLaneIndex);

    if (!sameOriginAhead && !sameDestLane) continue;

    let projectedOtherRear: number;
    if (other.originArm === v.originArm) {
      projectedOtherRear = otherRear;
    } else {
      const distBeforeExit = other.exitLineDist - other.distanceAlongPath;
      if (distBeforeExit > 7.5) continue;
      projectedOtherRear = v.exitLineDist - distBeforeExit - other.length * 0.5;
    }

    if (projectedOtherRear - v.stopLineDist < v.length + 1.8) {
      return true;
    }

    if (other.destArm === v.destArm || other.distanceAlongPath - other.stopLineDist <= 7.5) {
      const vStoppedFront = projectedOtherRear - 0.6;
      const vStoppedRear = vStoppedFront - v.length;
      for (let z = 0; z < zones.length; z++) {
        const cz = zones[z];
        const myConflictS = cz.pathKeyA === v.pathKey ? cz.sA : cz.sB;
        if (vStoppedFront >= myConflictS - 1.6 && vStoppedRear <= myConflictS + 1.6) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Cooperative Zipper Merge & Give-Way (No. 3):
 * Rolling vehicles in the receiving lane gently open a 1-car pocket when an adjacent vehicle
 * is merging back from an oncoming pass / lane-change or waiting at a slip-lane exit merge.
 */
export function evaluateZipperMergeGiveWay(
  v: SimVehicle,
  nearby: readonly SimVehicle[],
  lw: number,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams
): { yieldGap: number; speedCap: number } {
  const none = { yieldGap: Infinity, speedCap: Infinity };
  if (v.isReversing || v.isSlipLane || v.isUTurn) return none;
  if (v.overtakeState && v.overtakeState !== 'none') return none;
  if (v.speed < 0.8) return none;
  // Never yield mid-box to let someone merge inside intersection
  if (v.distanceAlongPath > v.stopLineDist - 3.5 && !v.hasExitedIntersection) return none;

  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  let bestGap = Infinity;
  let bestCap = Infinity;

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.isReversing) continue;

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const fwd = dx * cosH + dy * sinH;
    // Outward-left normal in Canvas 2D Y-down is (sinH, -cosH)
    const latSigned = dx * sinH - dy * cosH;

    const cosO = Math.cos(other.heading);
    const sinO = Math.sin(other.heading);
    const sameHeading = cosH * cosO + sinH * sinO > 0.65;

    let shouldYield = false;
    if (sameHeading && (!v.hasExitedIntersection || (other.hasExitedIntersection && other.destArm === v.destArm))) {
      const sameLegApproach =
        !v.hasExitedIntersection && other.originArm === v.originArm && other.distanceAlongPath < other.stopLineDist - 3.0;
      const sameLegExit = v.hasExitedIntersection && other.hasExitedIntersection && other.destArm === v.destArm;
      if (sameLegApproach || sameLegExit) {
        const returningMerger =
          other.overtakeState === 'merge_back' ||
          other.overtakeState === 'abort' ||
          (Boolean(other.crossingMarking) && Math.abs(other.targetLateralOffset) < Math.abs(other.lateralOffset) - 0.12) ||
          (other.laneChangeDir !== null && Math.abs(other.targetLateralOffset - other.lateralOffset) > 0.25);
        const steeringTowardMe =
          latSigned * other.lateralVelocity < -0.05 ||
          (other.overtakeState === 'abort' && latSigned < 0);
        const minFwd = v.profile === 'aggressive' && other.overtakeState !== 'abort' ? 2.0 : 0.45;
        if (
          returningMerger &&
          steeringTowardMe &&
          Math.abs(latSigned) > 0.45 &&
          Math.abs(latSigned) < lw * 1.15 &&
          fwd >= minFwd &&
          fwd < 13.5 &&
          (v.profile !== 'aggressive' || other.overtakeState === 'abort' || discipline.discipline >= 0.45)
        ) {
          shouldYield = true;
        }
      }
    } else if (
      v.hasExitedIntersection &&
      other.isSlipLane &&
      other.destArm === v.destArm &&
      other.distanceAlongPath > other.exitLineDist - 12.0 &&
      (other.waitingTime ?? 0) > 1.8 &&
      Math.abs(latSigned) < lw * 1.35 &&
      fwd > 1.2 &&
      fwd < 14.0
    ) {
      shouldYield = true;
    }

    if (!shouldYield) continue;
    const gap = Math.max(0.85, fwd - (v.length + other.length) * 0.5 - 0.55);
    if (gap < bestGap) {
      bestGap = gap;
      const cap = Math.max(1.5, Math.min(v.maxSpeed * 0.68, other.speed + 0.85)) * weather.speedMult[v.vClass];
      bestCap = Math.min(bestCap, cap);
    }
  }

  return { yieldGap: bestGap, speedCap: bestCap };
}

/**
 * SVO-Weighted Game-Theoretic Courtesy Yielding (Phase 3):
 * Prosocial straight vehicles approaching during `permissive-green` (or a shared merge)
 * smoothly yield space before the stop line—without slam braking—for cross-turning
 * (`right` / `uturn`) vehicles already staged inside or at the box lip.
 */
export function evaluateSvoCourtesyYield(
  v: SimVehicle,
  signalState: MovementSignalState,
  nearby: readonly SimVehicle[],
  topology: CompiledTopology,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams
): { shouldYield: boolean; speedCap: number; yieldGap: number } {
  const none = { shouldYield: false, speedCap: Infinity, yieldGap: Infinity };
  if (signalState !== 'permissive-green' && signalState !== 'protected-green') return none;
  if (v.turn !== 'straight' || v.isSlipLane || v.isUTurn || !v.pathKey) return none;
  if (v.isReversing || (v.overtakeState && v.overtakeState !== 'none')) return none;
  if (v.distanceAlongPath >= v.stopLineDist - 2.0) return none;

  const svoAngle = v.svoAngle ?? 0.35;
  if (Math.sin(svoAngle) < 0.32) return none;

  const frontBumper = v.distanceAlongPath + v.length * 0.5;
  const distToStop = v.stopLineDist - frontBumper;
  if (distToStop <= 0.5 || distToStop >= 24.0) return none;

  const effComfortDecel = Math.max(0.8, v.comfortDecel * weather.comfortDecelMult);
  const reactTime = 0.75 * weather.reactionMult * (1.05 - 0.15 * discipline.discipline);
  const comfortStopDist = v.speed * reactTime + (v.speed * v.speed) / (2 * effComfortDecel);
  if (distToStop <= comfortStopDist * 0.95) return none;

  const zones = topology.conflictsByPathKey[v.pathKey];
  if (!zones || zones.length === 0) return none;

  for (let z = 0; z < zones.length; z++) {
    const cz = zones[z];
    if (signalState === 'protected-green' && cz.type !== 'merge') continue;

    const amA = cz.pathKeyA === v.pathKey;
    const myConflictS = amA ? cz.sA : cz.sB;
    if (myConflictS < v.stopLineDist - 2.0) continue;

    const expectedOtherArm = amA ? cz.originArmB : cz.originArmA;
    const otherPathKey = amA ? cz.pathKeyB : cz.pathKeyA;
    const expectedOtherMovement = amA ? cz.movementB : cz.movementA;
    const otherConflictS = amA ? cz.sB : cz.sA;

    for (let i = 0; i < nearby.length; i++) {
      const other = nearby[i];
      if (other.id === v.id || other.originArm === v.originArm) continue;
      if (other.isSlipLane || other.hasExitedIntersection) continue;
      if (other.turn !== 'right' && other.turn !== 'uturn') continue;

      const isWaitingCrossTurn =
        (other.boxWaitTime ?? 0) >= 0.9 || (other.frustration ?? 0) >= 0.35;
      if (!isWaitingCrossTurn || other.speed > 2.5) continue;

      const otherFront = other.distanceAlongPath + other.length * 0.5;
      const otherRear = other.distanceAlongPath - other.length * 0.5;
      if (otherFront < other.stopLineDist - 1.5) continue;

      const matchesZone =
        other.originArm === expectedOtherArm &&
        (other.pathKey === otherPathKey || other.turn === expectedOtherMovement);
      const nearZoneByS =
        matchesZone &&
        otherRear <= otherConflictS + 1.8 &&
        Math.abs(otherConflictS - otherFront) <= 14.0;
      const nearZoneByPoint =
        (matchesZone || other.turn === 'uturn') &&
        Math.hypot(other.x - cz.point.x, other.y - cz.point.y) <= 14.0;

      if (nearZoneByS || nearZoneByPoint) {
        return {
          shouldYield: true,
          speedCap: Math.max(4.4, 5.8 * weather.speedMult[v.vClass]),
          yieldGap: Math.max(0.5, distToStop),
        };
      }
    }
  }

  return none;
}

/**
 * Blinker Intent Pocket Opening (Phase 3):
 * Cooperative or V2V-connected vehicles smoothly open a 1-car zipper pocket when an
 * adjacent same-leg vehicle ahead signals intent (`turnSignalActive`, `pendingLaneChangeDir`,
 * or `laneChangeDir`) to change lanes into `v`'s lane.
 */
export function evaluateBlinkerIntentPocket(
  v: SimVehicle,
  nearby: readonly SimVehicle[],
  lw: number,
  weather: WeatherPhysicsProfile
): { yieldGap: number; speedCap: number } {
  const none = { yieldGap: Infinity, speedCap: Infinity };
  if (v.isReversing || v.isSlipLane || v.isUTurn) return none;
  if (v.overtakeState && v.overtakeState !== 'none') return none;
  if (v.speed < 0.8) return none;
  if (v.distanceAlongPath > v.stopLineDist - 3.5 && !v.hasExitedIntersection) return none;

  const svoAngle = v.svoAngle ?? 0.35;
  if (Math.sin(svoAngle) < 0.24 && !v.isConnected) return none;

  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  let bestGap = Infinity;
  let bestCap = Infinity;

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.isReversing || other.isSlipLane || other.isUTurn) continue;

    const sameApproach =
      !v.hasExitedIntersection &&
      !other.hasExitedIntersection &&
      other.originArm === v.originArm &&
      other.distanceAlongPath < other.stopLineDist;
    const sameExit =
      v.hasExitedIntersection &&
      other.hasExitedIntersection &&
      other.destArm === v.destArm;
    if (!sameApproach && !sameExit) continue;

    const cosO = Math.cos(other.heading);
    const sinO = Math.sin(other.heading);
    if (cosH * cosO + sinH * sinO <= 0.65) continue;

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const fwd = dx * cosH + dy * sinH;
    if (fwd < 1.0 || fwd > 14.0) continue;

    // In Canvas 2D Y-down LHT, outward-left normal is (sinH, -cosH) -> latSigned > 0 means other is to v's LEFT
    const latSigned = dx * sinH - dy * cosH;
    const absLat = Math.abs(latSigned);
    if (absLat < 0.55 || absLat > lw * 1.15) continue;

    const sig = other.turnSignalActive ?? other.pendingLaneChangeDir ?? other.laneChangeDir;
    if (!sig) continue;
    const pointingTowardMe = (latSigned > 0 && sig === 'right') || (latSigned < 0 && sig === 'left');
    if (!pointingTowardMe) continue;

    const gap = Math.max(1.0, fwd - (v.length + other.length) * 0.5 - 0.6);
    if (gap < bestGap) {
      bestGap = gap;
      const cap =
        Math.max(2.2, Math.min(v.maxSpeed * 0.72, other.speed + 1.0)) * weather.speedMult[v.vClass];
      bestCap = Math.min(bestCap, cap);
    }
  }

  return { yieldGap: bestGap, speedCap: bestCap };
}
