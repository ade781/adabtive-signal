import { SimVehicle } from './behaviors';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { SpatialHashGrid } from './spatialHash';
import { CompiledTopology, MovementSignalState } from './topologyTypes';

export interface DisciplineParams {
  discipline: number; // 0 (chaotic) .. 1 (strict)
  yellowBoxCompliance: number;
  stopLineCreepProb: number;
  stopLineCreepMeters: number;
  redLightRunMult: number;
  overtakeBoldness: number;
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
  };
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
  queryBuf: SimVehicle[]
): ConflictYieldDecision {
  const none: ConflictYieldDecision = { shouldYield: false, yieldGap: Infinity, speedCap: Infinity, reason: 'none' };

  const pathKey = v.pathKey;
  if (!pathKey) return none;

  // 1. Pre-intersection U-Turn yielding to oncoming exit stream on the same physical arm
  if (v.isUTurn && v.distanceAlongPath < v.stopLineDist + 2.5) {
    const frontBumper = v.distanceAlongPath + v.length * 0.5;
    const distToTurn = v.stopLineDist - frontBumper;
    if (distToTurn > -1.5 && distToTurn < 24) {
      const nearby = spatialHash.queryRadius(v.x, v.y, Math.min(48, weather.sightDistance), queryBuf);
      const critGap = CRITICAL_GAP_BASE[v.vClass] * weather.gapAcceptanceMult * (0.9 + 0.25 * discipline.discipline);
      const originArmGeom = topology.armsById[v.originArm];
      const oneLaneOpp = (originArmGeom?.def.inLanes ?? 1) <= 1;
      for (const other of nearby) {
        if (other.id === v.id) continue;
        // Opposing traffic exiting along v.originArm
        if (other.destArm !== v.originArm) continue;
        if (other.distanceAlongPath < other.exitLineDist - 4) continue;
        // Only yield to vehicles in the innermost lane (where U-turn merges) unless 1-lane road
        if (!oneLaneOpp && other.destLaneIndex !== undefined && other.destLaneIndex > 0) continue;
        const dx = v.x - other.x;
        const dy = v.y - other.y;
        const forwardToMe = dx * Math.cos(other.heading) + dy * Math.sin(other.heading);
        if (forwardToMe < -other.length) continue; // Already passed us
        const ttc = forwardToMe / Math.max(2.0, other.speed);
        if (ttc < critGap || forwardToMe < 10.0) {
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
      const distToMerge = v.exitLineDist - 4.5 - frontBumper;
      if (distToMerge > -0.4 && distToMerge < 22) {
        const mergePt = v.compiledPath?.sample(v.exitLineDist);
        if (mergePt) {
          const nearby = spatialHash.queryRadius(mergePt.x, mergePt.y, Math.min(42, weather.sightDistance), queryBuf);
          const critGap = CRITICAL_GAP_BASE[v.vClass] * 0.72 * weather.gapAcceptanceMult;
          const destGeom = topology.armsById[v.destArm];
          const destOuterLane = Math.max(0, (destGeom?.def.outLanes ?? 1) - 1);
          for (const other of nearby) {
            if (other.id === v.id || other.originArm === v.originArm) continue;
            if (other.destArm !== v.destArm) continue;
            // Only yield to traffic in the outer destination lane where slip-lane merges
            if (destOuterLane > 0 && other.destLaneIndex !== undefined && other.destLaneIndex < destOuterLane - 0) {
              continue;
            }
            // Exact world-space distance along other's heading to reach our slip-lane merge point
            const mdx = mergePt.x - other.x;
            const mdy = mergePt.y - other.y;
            const otherDistToMerge = mdx * Math.cos(other.heading) + mdy * Math.sin(other.heading);
            if (otherDistToMerge < -(other.length * 0.5 + 2.0) || otherDistToMerge > 34) continue;
            const ttc = Math.max(0, otherDistToMerge) / Math.max(2.0, other.speed);
            if (ttc < critGap && (other.speed > 0.8 || Math.abs(otherDistToMerge) < 8.0)) {
              return {
                shouldYield: true,
                yieldGap: Math.max(0.15, distToMerge),
                speedCap: 5.2,
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
  // 3. Cooperative Courtesy Yield: if a conflicting cross-arm vehicle is trapped in the box (>= 2.2s),
  // hold approaching vehicles behind the stop line briefly so the box can clear (only if comfortably before stop line).
  const distToStopLine = v.stopLineDist - frontBumper;
  if (distToStopLine > 1.5 && distToStopLine < 12.0 && !v.isSlipLane && !v.isUTurn) {
    const nearbyBox = spatialHash.queryRadius(v.x, v.y, 26, queryBuf);
    for (const other of nearbyBox) {
      if (other.id === v.id || other.originArm === v.originArm) continue;
      if (
        !other.hasExitedIntersection &&
        other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.5 &&
        (other.boxWaitTime ?? 0) >= 2.2
      ) {
        return {
          shouldYield: true,
          yieldGap: Math.max(0.15, distToStopLine),
          speedCap: 4.5,
          reason: 'yellow-box',
        };
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
  const critGap =
    CRITICAL_GAP_BASE[v.vClass] *
    profileScale *
    weather.gapAcceptanceMult *
    (0.85 + 0.3 * discipline.discipline);

  let closestYieldGap = Infinity;

  for (const cz of zones) {
    const amA = cz.pathKeyA === pathKey;
    // Only yield when the other movement has higher priority (e.g. straight > right)
    const otherHasPriority = amA ? cz.priority === 'B' : cz.priority === 'A';
    if (!otherHasPriority) continue;

    const myConflictS = amA ? cz.sA : cz.sB;
    const otherPathKey = amA ? cz.pathKeyB : cz.pathKeyA;
    const otherConflictS = amA ? cz.sB : cz.sA;

    // Stage just at the box entry lip (or safely before the conflict point) so waiting right-turners
    // NEVER park deep inside the opposing straight corridor and deadlock with oncoming traffic!
    const stagingS = Math.min(myConflictS - 2.6, v.stopLineDist + 0.6);
    if (v.distanceAlongPath > stagingS + 1.5) continue;
    const gapToStaging = stagingS - frontBumper;
    if (gapToStaging < -0.6 || gapToStaging > 28.0) continue; // Already past staging or too far away

    // Scan nearby vehicles on the prioritized conflicting movement
    for (const other of nearby) {
      if (other.id === v.id) continue;
      const sameOtherArm = other.originArm === (amA ? cz.originArmB : cz.originArmA);
      if (!sameOtherArm) continue;
      if (other.pathKey !== otherPathKey && other.turn !== (amA ? cz.movementB : cz.movementA)) continue;

      const otherFront = other.distanceAlongPath + other.length * 0.5;
      const otherRear = other.distanceAlongPath - other.length * 0.5;
      // Already cleared the conflict zone
      if (otherRear > otherConflictS + 1.8) continue;

      // Ignore stopped opposing vehicle far behind stop line on red (or deadlocked)
      const distOtherToConflict = otherConflictS - otherFront;
      if (distOtherToConflict > 46) continue;
      if (other.speed < 0.4 && distOtherToConflict > 6.0) continue;
      if (boxWait > 3.2 && other.speed < 0.35 && distOtherToConflict > 2.5) continue;

      // Estimate time for oncoming straight vehicle to reach conflict vs time for us to clear it
      const oppSpeed = Math.max(other.speed, distOtherToConflict < 14 ? 4.5 : 2.5);
      const tOppArrive = Math.max(0, distOtherToConflict) / oppSpeed;
      const tSelfClear = (Math.max(0, myConflictS - v.distanceAlongPath) + v.length + 2.5) / Math.max(3.8, v.speed + 2.2);

      if (distOtherToConflict < 3.5 || tOppArrive < Math.max(critGap * 0.72, tSelfClear + 0.9)) {
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
