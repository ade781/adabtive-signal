import { SimVehicle } from './behaviors';
import { getArmGreenDuration, QUEUE_SPEED_THRESHOLD } from './constants';
import { ArmId, SimConfig, VehicleClass } from './types';

const ALL_ARMS: readonly ArmId[] = ['north', 'east', 'south', 'west'];
const APPROACH_WINDOW_M = 35;
const GAP_OUT_WINDOW_M = APPROACH_WINDOW_M;

// Indonesian PKJI 2023 / MKJI 1997 Passenger Car Unit (EMP/SMP) equivalents
const EMP_WEIGHT: Record<VehicleClass, number> = {
  motor: 0.25,
  car: 1.0,
  heavy: 1.5,
};

interface ArmMetrics {
  queued: number;
  approaching: number;
  nearStopLine: number;
  maxWait: number;
}

function measureArm(vehicles: readonly SimVehicle[], arm: ArmId): ArmMetrics {
  let queued = 0;
  let approaching = 0;
  let nearStopLine = 0;
  let maxWait = 0;

  for (const v of vehicles) {
    if (v.originArm !== arm || v.distanceAlongPath >= v.stopLineDist) continue;

    const emp = EMP_WEIGHT[v.vClass];
    const distToStop = v.stopLineDist - v.distanceAlongPath;
    if (v.speed < QUEUE_SPEED_THRESHOLD) {
      queued += emp;
      if (v.waitingTime > maxWait) maxWait = v.waitingTime;
    } else if (distToStop <= APPROACH_WINDOW_M) {
      approaching += emp;
    }

    if (distToStop <= GAP_OUT_WINDOW_M) {
      nearStopLine += emp;
    }
  }

  return { queued, approaching, nearStopLine, maxWait };
}

function getStarvationWait(config?: SimConfig): number {
  if (!config) return 60;
  const avgBaseGreen =
    ALL_ARMS.reduce((sum, arm) => sum + getArmGreenDuration(config, arm), 0) / ALL_ARMS.length;
  return Math.min(140, Math.max(45, Math.round(avgBaseGreen * 3.5)));
}

/**
 * Computes green phase bounds `[minGreen, maxGreen]` in seconds from simulation config.
 * `armGreenDurations?.[arm] ?? config.greenDuration` acts as `maxGreen`, while `minGreen`
 * is capped at 12s so long-cycle presets do not hold empty approaches.
 */
export function getAdaptiveGreenBounds(config: SimConfig, arm?: ArmId): { minGreen: number; maxGreen: number } {
  const baseGreen = arm ? getArmGreenDuration(config, arm) : config.greenDuration;
  const minGreen = Math.max(4, Math.min(baseGreen, Math.min(12, Math.round(baseGreen * 0.35))));
  const maxGreen = Math.max(minGreen, baseGreen);
  return { minGreen, maxGreen };
}

function scoreMetrics(m: ArmMetrics): number {
  return m.queued * 2 + m.approaching + Math.min(m.maxWait, 60) * 0.15;
}

/**
 * Computes the adaptive target green duration (seconds) for `activeArm`,
 * clamped between `minGreen` and `maxGreen` based on active vs. opposing arm demand.
 */
export function computeAdaptiveGreenTarget(
  vehicles: readonly SimVehicle[],
  activeArm: ArmId,
  config: SimConfig
): number {
  const { minGreen, maxGreen } = getAdaptiveGreenBounds(config, activeArm);
  const active = measureArm(vehicles, activeArm);
  const activeDemand = active.queued * 2 + active.approaching;

  let totalRedDemand = 0;
  let maxRedDemand = 0;
  for (const arm of ALL_ARMS) {
    if (arm === activeArm) continue;
    const redScore = scoreMetrics(measureArm(vehicles, arm));
    totalRedDemand += redScore;
    if (redScore > maxRedDemand) maxRedDemand = redScore;
  }

  if (activeDemand === 0 && totalRedDemand > 0) {
    return minGreen;
  }

  if (totalRedDemand === 0 && activeDemand > 0) {
    return maxGreen;
  }

  // Scale target by active arm's own lane-normalized discharge demand so symmetric heavy
  // traffic still uses full green capacity instead of cutting every phase to ~50%.
  const saturationCap = 6 * Math.max(1, config.lanesPerDirection);
  const saturationRatio = Math.min(1, activeDemand / saturationCap);
  const avgRedDemand = totalRedDemand / (ALL_ARMS.length - 1);
  const effectiveRedDemand = Math.max(avgRedDemand, maxRedDemand * 0.7);
  const pressureRatio = activeDemand / Math.max(1, activeDemand + effectiveRedDemand);
  const effectiveRatio = Math.max(saturationRatio, pressureRatio);
  const rawTarget = minGreen + (maxGreen - minGreen) * effectiveRatio;

  return Math.min(maxGreen, Math.max(minGreen, Math.round(rawTarget)));
}

/**
 * Determines whether the current green phase on `activeArm` should continue,
 * enforcing `[minGreen, maxGreen]` bounds, anti-starvation yield, and early gap-out
 * when the active approach clears while other arms have waiting queues.
 */
export function shouldExtendGreenPhase(
  vehicles: readonly SimVehicle[],
  activeArm: ArmId,
  phaseElapsed: number,
  config: SimConfig
): boolean {
  const { minGreen, maxGreen } = getAdaptiveGreenBounds(config, activeArm);
  if (phaseElapsed < minGreen) return true;
  if (phaseElapsed >= maxGreen) return false;

  const starvationWait = getStarvationWait(config);
  const active = measureArm(vehicles, activeArm);
  let hasWaitingRedArm = false;
  let maxRedWait = 0;
  for (const arm of ALL_ARMS) {
    if (arm === activeArm) continue;
    const red = measureArm(vehicles, arm);
    if (red.maxWait > maxRedWait) maxRedWait = red.maxWait;
    if (red.queued > 0) {
      hasWaitingRedArm = true;
    }
  }

  // Only cut active green early for starvation if active queue is clear,
  // or after 75% of maxGreen when an opposing arm has waited longer than active.
  if (maxRedWait >= starvationWait) {
    if (active.queued === 0 || (phaseElapsed >= Math.max(minGreen, Math.round(maxGreen * 0.75)) && maxRedWait > active.maxWait)) {
      return false;
    }
  }

  // Gap-out: active approach window is clear while another arm is waiting
  if (active.queued === 0 && active.approaching === 0 && active.nearStopLine === 0 && hasWaitingRedArm) {
    return false;
  }

  const target = computeAdaptiveGreenTarget(vehicles, activeArm, config);
  return phaseElapsed < target;
}

/**
 * Picks the next arm index in `armOrder` using demand-aware selection with
 * round-robin tie-breaking and anti-starvation priority for the longest-waiting queue.
 */
export function pickNextArmAdaptive(
  vehicles: readonly SimVehicle[],
  currentArmIndex: number,
  armOrder: readonly ArmId[],
  config?: SimConfig
): number {
  const len = armOrder.length;
  if (len === 0) return 0;

  const starvationWait = getStarvationWait(config);
  const fallbackIndex = (currentArmIndex + 1) % len;
  let starvedIndex = -1;
  let maxStarvedWait = -1;
  let bestIndex = fallbackIndex;
  let bestScore = 0;

  for (let offset = 1; offset < len; offset++) {
    const idx = (currentArmIndex + offset) % len;
    const arm = armOrder[idx];
    const metrics = measureArm(vehicles, arm);

    if (metrics.maxWait >= starvationWait && metrics.maxWait > maxStarvedWait) {
      maxStarvedWait = metrics.maxWait;
      starvedIndex = idx;
    }

    const score = scoreMetrics(metrics);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  }

  if (starvedIndex !== -1) return starvedIndex;
  return bestScore > 0 ? bestIndex : fallbackIndex;
}
