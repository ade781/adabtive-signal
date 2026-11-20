import { SimVehicle } from './behaviors';
import { getArmGreenDuration, QUEUE_SPEED_THRESHOLD } from './constants';
import { CompiledTopology, MovementKind, SignalPhaseDef } from './topologyTypes';
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

function measureArm(vehicles: readonly SimVehicle[], arm: string, allowedMovements?: Set<MovementKind>): ArmMetrics {
  let queued = 0;
  let approaching = 0;
  let nearStopLine = 0;
  let maxWait = 0;

  for (const v of vehicles) {
    if (v.originArm !== arm || v.distanceAlongPath >= v.stopLineDist) continue;
    if (v.isSlipLane) continue; // Slip-lane vehicles bypass the main traffic signal
    if (allowedMovements && !allowedMovements.has(v.turn)) continue;

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

function measureAllArms(vehicles: readonly SimVehicle[]): Record<ArmId, ArmMetrics> {
  return {
    north: measureArm(vehicles, 'north'),
    east: measureArm(vehicles, 'east'),
    south: measureArm(vehicles, 'south'),
    west: measureArm(vehicles, 'west'),
  };
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
  const minGreen = Math.max(3, Math.min(baseGreen, Math.min(12, Math.round(baseGreen * 0.35))));
  const maxGreen = Math.max(minGreen, baseGreen);
  return { minGreen, maxGreen };
}

export function getPhaseAdaptiveBounds(phase: SignalPhaseDef): { minGreen: number; maxGreen: number } {
  const baseGreen = Math.max(3, Math.min(180, phase.baseGreen));
  const minGreen =
    phase.minGreen !== undefined
      ? Math.max(3, Math.min(baseGreen, phase.minGreen))
      : Math.max(3, Math.min(baseGreen, Math.min(12, Math.round(baseGreen * 0.35))));
  return { minGreen, maxGreen: Math.max(minGreen, baseGreen) };
}

function scoreMetrics(m: ArmMetrics): number {
  return m.queued * 2 + m.approaching + Math.min(m.maxWait, 60) * 0.15;
}

function computeAdaptiveGreenTargetFromMetrics(
  armMetrics: Record<ArmId, ArmMetrics>,
  activeArm: ArmId,
  config: SimConfig
): number {
  const { minGreen, maxGreen } = getAdaptiveGreenBounds(config, activeArm);
  const active = armMetrics[activeArm];
  const activeDemand = active.queued * 2 + active.approaching;

  let totalRedDemand = 0;
  let maxRedDemand = 0;
  for (const arm of ALL_ARMS) {
    if (arm === activeArm) continue;
    const redScore = scoreMetrics(armMetrics[arm]);
    totalRedDemand += redScore;
    if (redScore > maxRedDemand) maxRedDemand = redScore;
  }

  if (activeDemand === 0 && totalRedDemand > 0) {
    return minGreen;
  }

  if (totalRedDemand === 0 && activeDemand > 0) {
    return maxGreen;
  }

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
 * Legacy 4-arm adaptive green target computation (kept exported for full test & API compatibility).
 */
export function computeAdaptiveGreenTarget(
  vehicles: readonly SimVehicle[],
  activeArm: ArmId,
  config: SimConfig
): number {
  return computeAdaptiveGreenTargetFromMetrics(measureAllArms(vehicles), activeArm, config);
}

/**
 * Legacy 4-arm extension decision (kept exported for compatibility).
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
  const armMetrics = measureAllArms(vehicles);
  const active = armMetrics[activeArm];
  let hasWaitingRedArm = false;
  let maxRedWait = 0;
  for (const arm of ALL_ARMS) {
    if (arm === activeArm) continue;
    const red = armMetrics[arm];
    if (red.maxWait > maxRedWait) maxRedWait = red.maxWait;
    if (red.queued > 0) {
      hasWaitingRedArm = true;
    }
  }

  if (maxRedWait >= starvationWait) {
    if (active.queued === 0 || (phaseElapsed >= Math.max(minGreen, Math.round(maxGreen * 0.75)) && maxRedWait > active.maxWait)) {
      return false;
    }
  }

  if (active.queued === 0 && active.approaching === 0 && active.nearStopLine === 0 && hasWaitingRedArm) {
    return false;
  }

  const target = computeAdaptiveGreenTargetFromMetrics(armMetrics, activeArm, config);
  return phaseElapsed < target;
}

/**
 * Legacy 4-arm next-arm selection (kept exported for compatibility).
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

// --- Phase-Aware Adaptive Controller (Supports 2/3/4/5-Phase, Protected Right-Turn, & N-Arm Topologies) ---

function measurePhase(vehicles: readonly SimVehicle[], phase: SignalPhaseDef): ArmMetrics {
  const movementsByArm = new Map<string, Set<MovementKind>>();
  for (const perm of phase.permissions) {
    let set = movementsByArm.get(perm.armId);
    if (!set) {
      set = new Set();
      movementsByArm.set(perm.armId, set);
    }
    for (const m of perm.movements) set.add(m);
  }

  let queued = 0;
  let approaching = 0;
  let nearStopLine = 0;
  let maxWait = 0;

  for (const [armId, moveSet] of movementsByArm.entries()) {
    const m = measureArm(vehicles, armId, moveSet);
    queued += m.queued;
    approaching += m.approaching;
    nearStopLine += m.nearStopLine;
    if (m.maxWait > maxWait) maxWait = m.maxWait;
  }

  return { queued, approaching, nearStopLine, maxWait };
}

function getPhaseStarvationWait(phases: readonly SignalPhaseDef[]): number {
  if (phases.length === 0) return 60;
  const avgGreen = phases.reduce((s, p) => s + p.baseGreen, 0) / phases.length;
  return Math.min(140, Math.max(45, Math.round(avgGreen * 3.5)));
}

export function shouldExtendPhaseAdaptive(
  vehicles: readonly SimVehicle[],
  phases: readonly SignalPhaseDef[],
  activePhaseIndex: number,
  phaseElapsed: number,
  topology: CompiledTopology
): boolean {
  const activePhase = phases[activePhaseIndex];
  if (!activePhase) return false;

  const { minGreen, maxGreen } = getPhaseAdaptiveBounds(activePhase);
  if (phaseElapsed < minGreen) return true;
  if (phaseElapsed >= maxGreen) return false;

  const starvationWait = getPhaseStarvationWait(phases);
  const active = measurePhase(vehicles, activePhase);

  let totalRedDemand = 0;
  let maxRedDemand = 0;
  let maxRedWait = 0;
  let hasWaitingRed = false;

  for (let i = 0; i < phases.length; i++) {
    if (i === activePhaseIndex) continue;
    const m = measurePhase(vehicles, phases[i]);
    if (m.maxWait > maxRedWait) maxRedWait = m.maxWait;
    if (m.queued > 0) hasWaitingRed = true;
    const redScore = scoreMetrics(m);
    totalRedDemand += redScore;
    if (redScore > maxRedDemand) maxRedDemand = redScore;
  }

  if (maxRedWait >= starvationWait) {
    if (active.queued === 0 || (phaseElapsed >= Math.max(minGreen, Math.round(maxGreen * 0.75)) && maxRedWait > active.maxWait)) {
      return false;
    }
  }

  if (active.queued === 0 && active.approaching === 0 && active.nearStopLine === 0 && hasWaitingRed) {
    return false;
  }

  const activeDemand = active.queued * 2 + active.approaching;
  if (activeDemand === 0 && totalRedDemand > 0) return phaseElapsed < minGreen;
  if (totalRedDemand === 0 && activeDemand > 0) return phaseElapsed < maxGreen;

  // Lane-normalized saturation capacity summing unique arms served by activePhase
  const uniqueArmIds = new Set(activePhase.permissions.map((p) => p.armId));
  let totalInLanes = 0;
  for (const armId of uniqueArmIds) {
    totalInLanes += topology.armsById[armId]?.def.inLanes ?? 2;
  }
  const saturationCap = 6 * Math.max(1, totalInLanes);
  const saturationRatio = Math.min(1, activeDemand / saturationCap);
  const otherCount = Math.max(1, phases.length - 1);
  const avgRedDemand = totalRedDemand / otherCount;
  const effectiveRedDemand = Math.max(avgRedDemand, maxRedDemand * 0.7);
  const pressureRatio = activeDemand / Math.max(1, activeDemand + effectiveRedDemand);
  const effectiveRatio = Math.max(saturationRatio, pressureRatio);
  const target = Math.min(maxGreen, Math.max(minGreen, Math.round(minGreen + (maxGreen - minGreen) * effectiveRatio)));

  return phaseElapsed < target;
}

export function pickNextPhaseAdaptive(
  vehicles: readonly SimVehicle[],
  phases: readonly SignalPhaseDef[],
  currentPhaseIndex: number
): number {
  const len = phases.length;
  if (len <= 1) return 0;

  const starvationWait = getPhaseStarvationWait(phases);
  const fallbackIndex = (currentPhaseIndex + 1) % len;
  let starvedIndex = -1;
  let maxStarvedWait = -1;
  let bestIndex = fallbackIndex;
  let bestScore = 0;

  for (let offset = 1; offset < len; offset++) {
    const idx = (currentPhaseIndex + offset) % len;
    const metrics = measurePhase(vehicles, phases[idx]);
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
