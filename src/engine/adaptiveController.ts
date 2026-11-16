import { SimVehicle } from './behaviors';
import { ArmId, SimConfig } from './types';

const ALL_ARMS: readonly ArmId[] = ['north', 'east', 'south', 'west'];
const APPROACH_WINDOW_M = 35;
const GAP_OUT_WINDOW_M = 20;
const QUEUE_SPEED_THRESHOLD = 1.5;
const STARVATION_WAIT_S = 30;

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

    const distToStop = v.stopLineDist - v.distanceAlongPath;
    if (v.speed < QUEUE_SPEED_THRESHOLD) {
      queued++;
      if (v.waitingTime > maxWait) maxWait = v.waitingTime;
    } else if (distToStop <= APPROACH_WINDOW_M) {
      approaching++;
    }

    if (distToStop <= GAP_OUT_WINDOW_M) {
      nearStopLine++;
    }
  }

  return { queued, approaching, nearStopLine, maxWait };
}

/**
 * Computes green phase bounds `[minGreen, maxGreen]` in seconds from simulation config.
 */
export function getAdaptiveGreenBounds(config: SimConfig): { minGreen: number; maxGreen: number } {
  const minGreen = Math.max(4, Math.round(config.greenDuration * 0.5));
  const maxGreen = Math.max(minGreen, Math.min(45, config.greenDuration * 1.6));
  return { minGreen, maxGreen };
}

function scoreMetrics(m: ArmMetrics): number {
  return m.queued * 2 + m.approaching + Math.min(m.maxWait, 60) * 0.15;
}

/**
 * Scores an arm's traffic demand from queued vehicles, approaching vehicles, and max waiting time.
 */
export function getArmDemandScore(vehicles: readonly SimVehicle[], arm: ArmId): number {
  return scoreMetrics(measureArm(vehicles, arm));
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
  const { minGreen, maxGreen } = getAdaptiveGreenBounds(config);
  const active = measureArm(vehicles, activeArm);
  const activeDemand = active.queued * 2 + active.approaching;

  let maxRedQueue = 0;
  let totalRedDemand = 0;
  for (const arm of ALL_ARMS) {
    if (arm === activeArm) continue;
    const red = measureArm(vehicles, arm);
    if (red.queued > maxRedQueue) maxRedQueue = red.queued;
    totalRedDemand += red.queued * 2 + red.approaching;
  }

  if (activeDemand === 0 && totalRedDemand > 0) {
    return minGreen;
  }

  const avgRedDemand = totalRedDemand / (ALL_ARMS.length - 1);
  const pressureRatio = activeDemand / Math.max(1, activeDemand + avgRedDemand);
  const rawTarget = config.greenDuration * (0.65 + pressureRatio * 0.95);

  if (maxRedQueue === 0 && activeDemand > 0) {
    return Math.min(maxGreen, Math.max(minGreen, Math.round(config.greenDuration * 1.3)));
  }

  return Math.min(maxGreen, Math.max(minGreen, Math.round(rawTarget)));
}

/**
 * Determines whether the current green phase on `activeArm` should continue,
 * enforcing `minGreen`, `maxGreen`, and early gap-out when the active approach clears
 * while other arms have waiting queues.
 */
export function shouldExtendGreenPhase(
  vehicles: readonly SimVehicle[],
  activeArm: ArmId,
  phaseElapsed: number,
  config: SimConfig
): boolean {
  const { minGreen, maxGreen } = getAdaptiveGreenBounds(config);

  if (phaseElapsed < minGreen) return true;
  if (phaseElapsed >= maxGreen) return false;

  const active = measureArm(vehicles, activeArm);
  const hasWaitingRedArm = ALL_ARMS.some(
    (arm) => arm !== activeArm && measureArm(vehicles, arm).queued > 0
  );

  // Gap-out: active approach near stop line is clear while another arm is waiting
  if (active.queued === 0 && active.nearStopLine === 0 && hasWaitingRedArm) {
    return false;
  }

  const target = computeAdaptiveGreenTarget(vehicles, activeArm, config);
  return phaseElapsed < target;
}

/**
 * Picks the next arm index in `armOrder` using demand-aware selection with
 * round-robin tie-breaking and anti-starvation priority for long-waiting queues.
 */
export function pickNextArmAdaptive(
  vehicles: readonly SimVehicle[],
  currentArmIndex: number,
  armOrder: readonly ArmId[]
): number {
  const len = armOrder.length;
  if (len === 0) return 0;

  const fallbackIndex = (currentArmIndex + 1) % len;
  let starvedIndex = -1;
  let bestIndex = fallbackIndex;
  let bestScore = 0;

  for (let offset = 1; offset <= len; offset++) {
    const idx = (currentArmIndex + offset) % len;
    const arm = armOrder[idx];
    const metrics = measureArm(vehicles, arm);

    if (starvedIndex === -1 && metrics.maxWait >= STARVATION_WAIT_S) {
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
