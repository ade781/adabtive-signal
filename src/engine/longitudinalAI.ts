import type { SimVehicle } from './behaviors';
import { getDriverTraits } from './driverIntelligence';
import type { WeatherPhysicsProfile } from './environmentDynamics';
import type { PerceptionProfile } from './perceptionAI';
import type { SignalColor } from './types';

export interface IidmParams {
  speed: number;
  desiredSpeed: number;
  gap: number;
  leadSpeed: number;
  maxAccel: number;
  comfortDecel: number;
  minGap: number;
  timeHeadway: number;
  delta?: number;
}

export interface MultiAnticipationResult {
  effectiveLeadSpeed: number;
  anticipatedBrakeIntensity: number;
  shockwaveCap: number;
}

export interface GlosaAndDischargeResult {
  desiredSpeedCap: number;
  headwayMult: number;
  launchBoostScale: number;
  isGlosaCoasting: boolean;
}

/**
 * Treiber & Kesting (2013) Improved Intelligent Driver Model (IIDM).
 * Eliminates artificial deceleration near v0 while cruising in equilibrium and bounds
 * overspeed deceleration smoothly via comfortDecel.
 */
export function computeIidmAcceleration(params: IidmParams): number {
  const v = Number.isFinite(params.speed) ? Math.max(0, params.speed) : 0;
  const v0 = Number.isFinite(params.desiredSpeed) ? Math.max(0.5, params.desiredSpeed) : 0.5;
  const a = Number.isFinite(params.maxAccel) ? Math.max(0.2, params.maxAccel) : 0.2;
  const b = Number.isFinite(params.comfortDecel) ? Math.max(0.5, params.comfortDecel) : 0.5;
  const s0 = Number.isFinite(params.minGap) ? Math.max(0, params.minGap) : 0;
  const T = Number.isFinite(params.timeHeadway) ? Math.max(0, params.timeHeadway) : 0;
  const leadSpeed = Number.isFinite(params.leadSpeed) ? Math.max(0, params.leadSpeed) : 0;
  const rawDelta = params.delta ?? 4;
  const delta = Number.isFinite(rawDelta) ? Math.max(0.1, rawDelta) : 4;

  const aFree =
    v <= v0
      ? a * (1 - Math.pow(v / v0, delta))
      : -b * (1 - Math.pow(v0 / v, delta));

  if (!Number.isFinite(params.gap)) {
    return Number.isFinite(aFree) ? aFree : 0;
  }

  const gap = Math.max(0.05, params.gap);
  const sStar = s0 + Math.max(0, v * T + (v * (v - leadSpeed)) / (2 * Math.sqrt(a * b)));
  const z = sStar / gap;

  let accel: number;
  if (v <= v0) {
    if (z >= 1) {
      accel = a * (1 - z * z);
    } else if (aFree > 0.05) {
      accel = aFree * (1 - Math.pow(z, (2 * a) / aFree));
    } else {
      accel = aFree * (1 - z * z);
    }
  } else if (z >= 1) {
    accel = aFree + a * (1 - z * z);
  } else {
    accel = aFree;
  }

  return Number.isFinite(accel) ? accel : 0;
}

/**
 * Multi-anticipative car-following (1st + 2nd leader deceleration & upstream shockwave lookahead).
 * Strictly preserves safety: never raises effectiveLeadSpeed above the immediate leader speed.
 */
export function computeMultiAnticipativeLeader(
  v: SimVehicle,
  nearestGap: number,
  leadSpeed: number,
  blockingLeader: SimVehicle | null,
  secondGap: number,
  secondLeadSpeed: number,
  secondLeader: SimVehicle | null,
  weather: WeatherPhysicsProfile,
  perception?: Pick<PerceptionProfile, 'reactionScale' | 'multiLookaheadTau' | 'secondLeaderWeight'>
): MultiAnticipationResult {
  const baseLeadSpeed = Number.isNaN(leadSpeed) ? 0 : Math.max(0, leadSpeed);
  const vSpeed = Number.isFinite(v.speed) ? Math.max(0, v.speed) : 0;
  const reactionMult = Number.isFinite(weather.reactionMult) ? Math.max(0.5, weather.reactionMult) : 1.0;
  const traits = getDriverTraits(v);
  const lookaheadTau = perception?.multiLookaheadTau ?? traits.multiLookaheadTau;
  const secondWeightScale = perception?.secondLeaderWeight ?? traits.secondLeaderWeight;

  let effectiveLeadSpeed = baseLeadSpeed;
  let anticipatedBrakeIntensity = 0;
  let shockwaveCap = Infinity;

  // 1. Immediate leader deceleration anticipation on same or overlapping corridor
  if (
    blockingLeader !== null &&
    (blockingLeader.originArm === v.originArm || blockingLeader.destArm === v.destArm) &&
    Number.isFinite(nearestGap) &&
    nearestGap < 42
  ) {
    const rawLeaderPrev =
      blockingLeader.prevAccel !== undefined && Number.isFinite(blockingLeader.prevAccel)
        ? blockingLeader.prevAccel
        : blockingLeader.brakingHard
          ? -2.2
          : 0;
    const rawLeadAccel = Math.min(0, rawLeaderPrev);
    if (rawLeadAccel < -0.5 || blockingLeader.brakingHard) {
      const leadAccel = blockingLeader.brakingHard && rawLeadAccel >= -0.5 ? -2.2 : rawLeadAccel;
      const tau = lookaheadTau * reactionMult;
      const projSpeed = Math.max(0, effectiveLeadSpeed + leadAccel * tau);
      const w1 = Math.max(0, Math.min(1, 1 - Math.max(0, nearestGap) / 42));
      const blended = effectiveLeadSpeed + (projSpeed - effectiveLeadSpeed) * w1;
      effectiveLeadSpeed = Math.min(effectiveLeadSpeed, blended);

      const decelIntensity = Math.min(1, Math.abs(leadAccel) / 4.5);
      anticipatedBrakeIntensity = Math.max(anticipatedBrakeIntensity, w1 * decelIntensity);
    }
  }

  // 2. Continuous 2nd-leader coupling & smooth shockwave speed cap
  const secondPrevRaw =
    secondLeader !== null && secondLeader.prevAccel !== undefined && Number.isFinite(secondLeader.prevAccel)
      ? secondLeader.prevAccel
      : 0;
  if (
    secondLeader !== null &&
    Number.isFinite(secondGap) &&
    secondGap < 46 &&
    (secondLeadSpeed < vSpeed + 0.5 || secondPrevRaw < -0.9)
  ) {
    const secondAccel = Math.min(
      0,
      secondLeader.prevAccel !== undefined && Number.isFinite(secondLeader.prevAccel)
        ? secondLeader.prevAccel
        : secondLeader.brakingHard
          ? -2.2
          : 0
    );
    const safeSecondSpeed = Number.isFinite(secondLeadSpeed) ? Math.max(0, secondLeadSpeed) : 0;
    const secondProj = Math.max(0, safeSecondSpeed + secondAccel * (lookaheadTau + 0.05) * reactionMult);
    const blockingSpeed =
      blockingLeader !== null && Number.isFinite(blockingLeader.speed)
        ? Math.max(0, blockingLeader.speed)
        : effectiveLeadSpeed;

    if (secondProj < effectiveLeadSpeed && (blockingLeader === null || blockingSpeed > secondProj)) {
      const w2 = Math.max(0, Math.min(1, 1 - Math.max(0, secondGap) / 46));
      const urgency = secondAccel < -0.9 ? 0.65 : 0.45;
      const blend2 = Math.max(0, Math.min(0.84, urgency * w2 * secondWeightScale));
      const coupledSpeed = effectiveLeadSpeed + (secondProj - effectiveLeadSpeed) * blend2;
      effectiveLeadSpeed = Math.min(effectiveLeadSpeed, coupledSpeed);

      const effDecel = Math.max(0.8, v.comfortDecel * traits.comfortDecelMult * weather.comfortDecelMult);
      const safeDist = Math.max(1.0, Math.max(0, secondGap) - 1.5);
      const kinematicCap = Math.sqrt(secondProj * secondProj + 2 * effDecel * 0.72 * safeDist);
      shockwaveCap = Math.max(secondProj + 1.8, kinematicCap);

      const speedDropNorm = Math.min(
        1,
        Math.max(0, (baseLeadSpeed - secondProj) / Math.max(4.0, v.maxSpeed))
      );
      const secondDecelNorm = Math.min(1, Math.max(speedDropNorm, Math.abs(secondAccel) / 4.5));
      anticipatedBrakeIntensity = Math.max(anticipatedBrakeIntensity, w2 * secondDecelNorm);
    }
  }

  return {
    effectiveLeadSpeed,
    anticipatedBrakeIntensity,
    shockwaveCap,
  };
}

/**
 * Evaluates Red/Stopped-Queue Eco-Approach gliding, GLOSA green-end coasting,
 * and coordinated platoon start-up discharge boost.
 */
export function evaluateGlosaAndPlatoonDischarge(
  v: SimVehicle,
  light: SignalColor,
  phaseRemaining: number,
  distToStop: number,
  blockingLeader: SimVehicle | null,
  physicalGap: number,
  canLTOR: boolean,
  stopForYellow: boolean,
  weather: WeatherPhysicsProfile,
  baseDesiredV: number
): GlosaAndDischargeResult {
  const vSpeed = Number.isFinite(v.speed) ? Math.max(0, v.speed) : 0;
  const safePhysicalGap = Number.isFinite(physicalGap) ? Math.max(0, physicalGap) : Infinity;
  const traits = getDriverTraits(v);
  const effDecel = Math.max(0.8, v.comfortDecel * traits.comfortDecelMult * weather.comfortDecelMult);
  const reactionMult = Number.isFinite(weather.reactionMult) ? Math.max(0.5, weather.reactionMult) : 1.0;

  let desiredSpeedCap = Infinity;
  let headwayMult = 1.0;
  let launchBoostScale = 1.0;
  let isGlosaCoasting = false;

  // 1. Red / Yellow-Stop / Stopped-Queue Eco-Approach (archetype-scaled coasting distance & slope)
  const hasStoppedSameArmQueue =
    blockingLeader !== null &&
    blockingLeader.originArm === v.originArm &&
    blockingLeader.distanceAlongPath < v.stopLineDist &&
    blockingLeader.speed < 1.0 &&
    safePhysicalGap < 42.0;
  const ecoWindowMax = 66.0 + 12.0 * traits.glosaCoastingBias;

  if (
    !v.isSlipLane &&
    !v.isUTurn &&
    distToStop > 14.0 &&
    distToStop < ecoWindowMax &&
    !canLTOR &&
    !v.willRunRed &&
    (light === 'red' || stopForYellow || hasStoppedSameArmQueue)
  ) {
    const glideAnchorDist = Math.max(0, Math.min(distToStop, safePhysicalGap) - 3.5);
    const decelFraction = traits.glosaCoastingBias >= 1.15 ? 0.42 : traits.glosaCoastingBias <= 0.8 ? 0.56 : 0.48;
    const ecoCap = Math.max(4.4, Math.sqrt(Math.max(0, 2 * effDecel * decelFraction * glideAnchorDist)));
    desiredSpeedCap = Math.min(desiredSpeedCap, ecoCap);
  }

  // 2. GLOSA Green-End Anticipation
  if (
    light === 'green' &&
    !v.isSlipLane &&
    !v.isUTurn &&
    !v.willRunRed &&
    v.distanceAlongPath < v.stopLineDist &&
    distToStop > 14.0 &&
    distToStop < 75.0 &&
    Number.isFinite(phaseRemaining) &&
    phaseRemaining < 8.0
  ) {
    const safeBaseDesiredV = Number.isFinite(baseDesiredV) ? Math.max(0.5, baseDesiredV) : Math.max(0.5, v.maxSpeed);
    const vCruise = Math.max(3.0, Math.min(safeBaseDesiredV, Math.max(vSpeed, safeBaseDesiredV * 0.92)));
    const estArrival = distToStop / vCruise;
    const grace = 0.25 + traits.riskTolerance * 1.45;
    const comfortableStopDist = vSpeed * 0.85 * traits.reactionScale * reactionMult + (vSpeed * vSpeed) / (2 * effDecel);

    if (estArrival > Math.max(0, phaseRemaining) + grace && distToStop > comfortableStopDist * 1.1) {
      const glosaDecelFrac = traits.glosaCoastingBias >= 1.15 ? 0.4 : 0.45;
      const glosaCap = Math.max(4.0, Math.sqrt(Math.max(0, 2 * effDecel * glosaDecelFrac * Math.max(0, distToStop - 3.0))));
      desiredSpeedCap = Math.min(desiredSpeedCap, glosaCap);
      isGlosaCoasting = true;
    }
  }

  // 3. Platoon Start-up Discharge Boost
  const leaderPrevAccel =
    blockingLeader !== null && blockingLeader.prevAccel !== undefined && Number.isFinite(blockingLeader.prevAccel)
      ? blockingLeader.prevAccel
      : 0;
  if (
    (light === 'green' || v.distanceAlongPath >= v.stopLineDist) &&
    vSpeed < 7.5 &&
    blockingLeader !== null &&
    blockingLeader.originArm === v.originArm &&
    (blockingLeader.speed > vSpeed + 0.25 || leaderPrevAccel > 0.45)
  ) {
    const speedT = Math.max(0, Math.min(1, vSpeed / 7.5));
    const baseTight = 0.85 + 0.09 * speedT;
    const weatherScale = Math.min(1.12, reactionMult);
    headwayMult = Math.max(0.84, Math.min(1.0, baseTight * weatherScale));
    if (vSpeed < 2.8) {
      launchBoostScale = 1.03 + 0.11 * traits.riskTolerance;
    }
  }

  return {
    desiredSpeedCap,
    headwayMult,
    launchBoostScale,
    isGlosaCoasting,
  };
}

/**
 * Jerk-bounded comfort acceleration smoothing with imminent-stop ramp and critical-gap override.
 */
export function smoothLongitudinalAccel(
  prevAccel: number,
  targetAccel: number,
  nearestGap: number,
  minGap: number,
  stoppingForSignal: boolean,
  dt: number,
  jerkScale = 1.0
): number {
  const prevA = Number.isFinite(prevAccel) ? prevAccel : 0;
  const targetA = Number.isFinite(targetAccel) ? targetAccel : 0;
  const safeMinGap = Number.isFinite(minGap) ? Math.max(0, minGap) : 0;
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const safeJerk = Number.isFinite(jerkScale) && jerkScale > 0 ? jerkScale : 1.0;

  const criticalStop = nearestGap < safeMinGap * 0.9;
  if (targetA < prevA && criticalStop) {
    return targetA;
  }

  const imminentStop =
    nearestGap < safeMinGap * 1.2 ||
    (stoppingForSignal && nearestGap < Math.max(safeMinGap * 1.5, 4.2));
  const maxBrakeJerk = imminentStop ? -55.0 * safeDt : -14.0 * safeJerk * safeDt;
  const maxAccelJerk = 18.0 * safeJerk * safeDt;

  return prevA + Math.max(maxBrakeJerk, Math.min(maxAccelJerk, targetA - prevA));
}
