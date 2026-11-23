import type { SimVehicle } from './behaviors';
import type { DisciplineParams } from './conflictResolver';
import { getDriverTraits } from './driverIntelligence';
import type { WeatherPhysicsProfile } from './environmentDynamics';
import { wrapAngleRad } from './topologyBuilder';
import type { SignalColor } from './types';

/**
 * Heterogeneous perception and reaction parameters distinguishing V2V/CAV
 * vehicles and specific human driver archetypes under varying weather and ambient darkness.
 */
export interface PerceptionProfile {
  isConnected: boolean;
  reactionScale: number;
  gapCautiousMult: number;
  caccHeadwayMult: number;
  canSeeThroughTrucks: boolean;
  multiLookaheadTau: number;
  secondLeaderWeight: number;
}

/**
 * Evaluates a vehicle's perception & car-following profile.
 * Connected vehicles gain V2V X-ray awareness through heavy trucks, faster actuation,
 * and tighter CACC platooning headways; human drivers differ by archetype traits.
 */
export function evaluateVehiclePerceptionProfile(
  v: SimVehicle,
  blockingLeader: SimVehicle | null,
  weather: WeatherPhysicsProfile,
  ambientDarkness: number
): PerceptionProfile {
  if (v.isConnected) {
    const cooperativePlatoon =
      blockingLeader !== null &&
      Boolean(blockingLeader.isConnected) &&
      (blockingLeader.originArm === v.originArm || blockingLeader.destArm === v.destArm);

    return {
      isConnected: true,
      reactionScale: 0.25,
      gapCautiousMult: 1.0,
      caccHeadwayMult: cooperativePlatoon ? 0.78 : 0.92,
      canSeeThroughTrucks: true,
      multiLookaheadTau: 0.35,
      secondLeaderWeight: 1.38,
    };
  }

  const traits = getDriverTraits(v);
  const rainFactor = Number.isFinite(weather.rainIntensity) ? Math.max(0, weather.rainIntensity) : 0;
  const darknessRaw = Number.isFinite(ambientDarkness) ? Math.max(0, ambientDarkness) : 0;
  const darknessFactor = Math.min(1, darknessRaw / 0.3);

  const risk = traits.riskTolerance;
  const cautionSlope = Math.max(0.02, 0.135 - 0.13 * risk);
  const baseCaution = 1.07 - 0.155 * risk;
  const gapCautiousMult = baseCaution + cautionSlope * (rainFactor + darknessFactor);

  return {
    isConnected: false,
    reactionScale: traits.reactionScale,
    gapCautiousMult,
    caccHeadwayMult: 1.0,
    canSeeThroughTrucks: false,
    multiLookaheadTau: traits.multiLookaheadTau,
    secondLeaderWeight: traits.secondLeaderWeight,
  };
}

/**
 * 2D angular line-of-sight occlusion test against heavy vehicles.
 * Preserves close-range safety (< 6.0m) and assumes connected vehicles share V2V awareness.
 */
export function isOccludedByHeavyVehicle(
  observer: SimVehicle,
  target: SimVehicle,
  nearby: readonly SimVehicle[]
): boolean {
  if (observer.isConnected || target.id === observer.id || target.vClass === 'heavy') {
    return false;
  }

  const dxTarget = target.x - observer.x;
  const dyTarget = target.y - observer.y;
  const targetDist = Math.hypot(dxTarget, dyTarget);
  if (!Number.isFinite(targetDist) || targetDist < 6.0) {
    return false;
  }

  const targetAngle = Math.atan2(dyTarget, dxTarget);

  for (let i = 0; i < nearby.length; i++) {
    const h = nearby[i];
    if (h.id === observer.id || h.id === target.id || h.vClass !== 'heavy') continue;

    const dxH = h.x - observer.x;
    const dyH = h.y - observer.y;
    const hDist = Math.hypot(dxH, dyH);
    if (!Number.isFinite(hDist) || hDist < 1.2 || hDist >= targetDist - 1.0) continue;

    const hAngle = Math.atan2(dyH, dxH);
    const halfWidth = Math.max(
      h.width * 0.5,
      Math.abs(Math.sin(h.heading - hAngle)) * h.length * 0.45
    );
    const halfSpan = Math.atan2(halfWidth, hDist) + 0.04;

    if (Math.abs(wrapAngleRad(targetAngle - hAngle)) <= halfSpan) {
      return true;
    }
  }

  return false;
}

/**
 * Computes a cautious peeking speed cap for human drivers approaching a conflict or merge
 * when an adjacent or leading heavy vehicle blocks lateral sightlines.
 */
export function evaluateOcclusionPeekingCap(
  v: SimVehicle,
  nearby: readonly SimVehicle[],
  light: SignalColor,
  weather: WeatherPhysicsProfile,
  discipline: DisciplineParams
): { isPeeking: boolean; speedCap: number } {
  if (v.isConnected || v.isReversing || v.vClass === 'heavy') {
    return { isPeeking: false, speedCap: Infinity };
  }

  const traits = getDriverTraits(v);
  const approachingConflict =
    Boolean(v.isSlipLane) ||
    Boolean(v.isUTurn) ||
    (light === 'green' && v.turn === 'right') ||
    v.overtakeState === 'pull_out';

  const distToStop = v.stopLineDist - v.distanceAlongPath;
  const inConflictWindow = v.isSlipLane
    ? v.distanceAlongPath >= v.exitLineDist - 14 && v.distanceAlongPath <= v.exitLineDist
    : distToStop >= -2.0 && distToStop <= 14.0;

  if (!inConflictWindow && !approachingConflict) {
    return { isPeeking: false, speedCap: Infinity };
  }

  if (traits.riskTolerance > 0.78 && discipline.discipline < 0.45 && !inConflictWindow) {
    return { isPeeking: false, speedCap: Infinity };
  }

  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  let hasHeavyOccluder = false;
  let hasWideTurningHeavy = false;

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.vClass !== 'heavy') continue;

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const fwd = dx * cosH + dy * sinH;
    const lat = Math.abs(dx * sinH - dy * cosH);

    if (fwd >= -2.0 && fwd <= 14.0 && lat < 5.5) {
      hasHeavyOccluder = true;
      const turningOrSwinging =
        other.wideSwingState === 'pre_swing' ||
        other.wideSwingState === 'turning' ||
        (other.turn !== 'straight' && other.distanceAlongPath > other.stopLineDist - 18.0);
      if (turningOrSwinging && other.originArm === v.originArm && lat < 4.4 && fwd > -2.5 && fwd < 11.5) {
        hasWideTurningHeavy = true;
        break;
      }
    }
  }

  if (!hasWideTurningHeavy && (!approachingConflict || !inConflictWindow || !hasHeavyOccluder)) {
    return { isPeeking: false, speedCap: Infinity };
  }

  if (hasWideTurningHeavy && traits.riskTolerance > 0.8 && discipline.discipline < 0.4) {
    return { isPeeking: false, speedCap: Infinity };
  }

  const basePeek = hasWideTurningHeavy ? 4.4 : 4.05 + 1.35 * traits.riskTolerance;
  const speedCap = Math.max(
    3.4,
    basePeek *
    traits.occlusionPeekMult *
    weather.speedMult[v.vClass] *
    (0.9 + 0.18 * (1 - discipline.discipline))
  );

  return { isPeeking: true, speedCap };
}

/**
 * Extracts a vehicle's effective turn/lane-change blinker direction from explicit signals,
 * active lateral lane shifts, or upcoming intersection turn intent.
 */
export function getEffectiveBlinkerDir(v: SimVehicle): 'left' | 'right' | null {
  const signalOnset = getDriverTraits(v).signalOnsetDist;
  return (
    v.turnSignalActive ??
    v.laneChangeDir ??
    (v.turn === 'uturn'
      ? 'right'
      : v.turn !== 'straight' &&
        v.distanceAlongPath < v.exitLineDist &&
        v.distanceAlongPath > v.stopLineDist - signalOnset
        ? v.turn
        : null)
  );
}
