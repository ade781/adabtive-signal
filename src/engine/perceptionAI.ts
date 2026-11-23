import type { SimVehicle } from './behaviors';
import type { DisciplineParams } from './conflictResolver';
import type { WeatherPhysicsProfile } from './environmentDynamics';
import { wrapAngleRad } from './topologyBuilder';
import type { SignalColor } from './types';

/**
 * Heterogeneous perception and reaction parameters distinguishing V2V/CAV
 * vehicles from human drivers under varying weather and ambient darkness.
 */
export interface PerceptionProfile {
  isConnected: boolean;
  reactionScale: number;
  gapCautiousMult: number;
  caccHeadwayMult: number;
  canSeeThroughTrucks: boolean;
}

/**
 * Evaluates a vehicle's perception & car-following profile.
 * Connected vehicles gain V2V X-ray awareness through heavy trucks, faster actuation,
 * and tighter CACC platooning headways behind connected leaders on shared corridors.
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
    };
  }

  const rainFactor = Number.isFinite(weather.rainIntensity) ? Math.max(0, weather.rainIntensity) : 0;
  const darknessRaw = Number.isFinite(ambientDarkness) ? Math.max(0, ambientDarkness) : 0;
  const darknessFactor = Math.min(1, darknessRaw / 0.3);

  let gapCautiousMult = 0.95;
  if (v.profile === 'cautious') {
    gapCautiousMult = 1 + 0.1 * rainFactor + 0.1 * darknessFactor;
  } else if (v.profile === 'normal') {
    gapCautiousMult = 1 + 0.05 * rainFactor + 0.05 * darknessFactor;
  }

  return {
    isConnected: false,
    reactionScale: 1.0,
    gapCautiousMult,
    caccHeadwayMult: 1.0,
    canSeeThroughTrucks: false,
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

  const approachingConflict =
    Boolean(v.isSlipLane) ||
    Boolean(v.isUTurn) ||
    (light === 'green' && v.turn === 'right') ||
    v.overtakeState === 'pull_out';

  if (!approachingConflict) {
    return { isPeeking: false, speedCap: Infinity };
  }

  const distToStop = v.stopLineDist - v.distanceAlongPath;
  const inConflictWindow = v.isSlipLane
    ? v.distanceAlongPath >= v.exitLineDist - 14 && v.distanceAlongPath <= v.exitLineDist
    : distToStop >= -2.0 && distToStop <= 12.0;

  if (!inConflictWindow) {
    return { isPeeking: false, speedCap: Infinity };
  }

  if (v.profile === 'aggressive' && discipline.discipline < 0.45) {
    return { isPeeking: false, speedCap: Infinity };
  }

  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  let hasHeavyOccluder = false;

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.vClass !== 'heavy') continue;

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const fwd = dx * cosH + dy * sinH;
    const lat = Math.abs(dx * sinH - dy * cosH);

    if (fwd >= -2.0 && fwd <= 14.0 && lat < 5.5) {
      hasHeavyOccluder = true;
      break;
    }
  }

  if (!hasHeavyOccluder) {
    return { isPeeking: false, speedCap: Infinity };
  }

  const basePeek = v.profile === 'cautious' ? 4.2 : 5.2;
  const speedCap = Math.max(
    3.6,
    basePeek * weather.speedMult[v.vClass] * (0.9 + 0.2 * (1 - discipline.discipline))
  );

  return { isPeeking: true, speedCap };
}

/**
 * Extracts a vehicle's effective turn/lane-change blinker direction from explicit signals,
 * active lateral lane shifts, or upcoming intersection turn intent.
 */
export function getEffectiveBlinkerDir(v: SimVehicle): 'left' | 'right' | null {
  return (
    v.turnSignalActive ??
    v.laneChangeDir ??
    (v.turn === 'uturn'
      ? 'right'
      : v.turn !== 'straight' &&
          v.distanceAlongPath < v.exitLineDist &&
          v.distanceAlongPath > v.stopLineDist - 35
        ? v.turn
        : null)
  );
}
