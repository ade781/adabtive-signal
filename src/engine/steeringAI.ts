import { effClearanceWidth, getGlobalLat, SimVehicle } from './behaviors';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { sampleWithLateralOffset } from './geometry';
import { SpatialHashGrid } from './spatialHash';
import { CompiledArmGeometry, CompiledMovementPath } from './topologyTypes';
import { VehicleClass } from './types';

export const WHEELBASE_BY_CLASS: Record<VehicleClass, number> = {
  motor: 1.32,
  car: 2.7,
  heavy: 5.4,
};

export const BASE_LATERAL_ACCEL: Record<VehicleClass, number> = {
  motor: 2.45,
  car: 2.25,
  heavy: 1.4,
};

/**
 * Racing-game style curvature lookahead speed profiler.
 * Scans upcoming spline curvature across the vehicle's braking horizon and computes a smooth
 * cornering speed cap v = sqrt(a_lat_max(mu) / |kappa|) so vehicles brake BEFORE sharp apexes
 * and accelerate cleanly on corner exit.
 */
export function computeCurvatureTargetSpeed(
  v: SimVehicle,
  compiledPath: CompiledMovementPath | undefined,
  baseDesiredV: number,
  weather: WeatherPhysicsProfile
): number {
  if (!compiledPath) return baseDesiredV;

  const effDecel = Math.max(0.8, v.comfortDecel * weather.comfortDecelMult);
  const brakingHorizon = Math.min(34, Math.max(8, (v.speed * v.speed) / (2 * effDecel) + 6.0));
  const sNow = v.distanceAlongPath;
  const maxKappa = compiledPath.maxCurvatureInRange(sNow, sNow + brakingHorizon);
  if (maxKappa < 1e-3) return baseDesiredV;

  const aLatMax = BASE_LATERAL_ACCEL[v.vClass] * weather.lateralGripMult;
  const minCornerV = v.vClass === 'heavy' ? 3.4 : 4.0;
  const cornerV = Math.max(minCornerV, Math.sqrt(aLatMax / maxKappa));

  if (cornerV >= baseDesiredV) return baseDesiredV;

  // Smooth distance-based deceleration envelope into the turn apex
  const distToCurveStart = Math.max(0, compiledPath.stopLineDist - sNow);
  if (distToCurveStart > 0.5) {
    // Kinematic ramp: v_entry = sqrt(v_corner^2 + 2 * b_gentle * dist)
    const gentleB = effDecel * 0.72;
    const rampV = Math.sqrt(cornerV * cornerV + 2 * gentleB * distToCurveStart);
    return Math.min(baseDesiredV, rampV);
  }

  return Math.min(baseDesiredV, cornerV);
}

/**
 * GTA / Racing-style Pure Pursuit smooth lateral + bicycle yaw controller.
 * Computes smooth lateral motion toward `targetLateralOffset` constrained by vehicle wheelbase,
 * max steering angle, and steering rate limit, preventing unnatural jerky lane snaps.
 */
export function computePurePursuitLateralStep(
  v: SimVehicle,
  dt: number,
  weather: WeatherPhysicsProfile
): { nextLatVel: number; stepLat: number; steerAngle: number } {
  const latDiff = v.targetLateralOffset - v.lateralOffset;
  const returningFromOncoming =
    v.overtakeState === 'merge_back' ||
    v.overtakeState === 'abort' ||
    ((Boolean(v.crossingMarking) || v.lateralOffset < -0.75) &&
      Math.abs(v.targetLateralOffset) < Math.abs(v.lateralOffset) - 0.05);
  if (Math.abs(latDiff) <= 0.008 || (!returningFromOncoming && !v.isReversing && v.speed <= 0.25)) {
    const damped = v.lateralVelocity * Math.max(0, 1 - 12 * dt);
    return { nextLatVel: Math.abs(damped) < 0.01 ? 0 : damped, stepLat: 0, steerAngle: 0 };
  }

  // If forced to slow/stop while returning from the oncoming lane / crossing marking / reversing, allow low-speed evasive slide
  const effSpeed = returningFromOncoming || v.isReversing ? Math.max(v.speed, 2.4) : v.speed;
  const wheelbase = WHEELBASE_BY_CLASS[v.vClass];
  // Dynamic lookahead scales with speed (Pure Pursuit law: Ld = k * v + L_base)
  const lookahead = Math.max(
    v.vClass === 'motor' ? 2.2 : 3.2,
    Math.min(13.5, effSpeed * (v.vClass === 'heavy' ? 0.68 : 0.52) + wheelbase * 1.1)
  );

  // Target point relative to vehicle frame: (lookahead forward, latDiff leftward)
  const alpha = Math.atan2(-latDiff, lookahead); // CCW negative = leftward in Canvas Y-down
  const curvature = (2 * Math.sin(alpha)) / lookahead;
  const maxSteer = v.vClass === 'motor' ? 0.44 : v.vClass === 'car' ? 0.36 : 0.28;
  const desiredSteer = Math.max(-maxSteer, Math.min(maxSteer, Math.atan(curvature * wheelbase)));

  // Steering rate limiter (realistic steering wheel turn speed)
  const prevSteer = v.steerAngle ?? 0;
  const maxSteerRate = (v.vClass === 'motor' ? 3.2 : v.vClass === 'car' ? 2.4 : 1.5) * weather.friction;
  const steerDelta = Math.max(-maxSteerRate * dt, Math.min(maxSteerRate * dt, desiredSteer - prevSteer));
  const steerAngle = prevSteer + steerDelta;

  // Convert steering angle to lateral velocity capped by wet-road lateral grip
  const maxLatSpeed =
    Math.min(
      v.vClass === 'motor' ? 2.6 : v.vClass === 'car' ? 2.35 : 1.55,
      effSpeed * 0.58
    ) * Math.sqrt(weather.friction);
  const rawLatVel = -Math.sin(steerAngle) * Math.max(effSpeed, 1.5) * 1.35;
  // Blend with proportional damping near target so we never overshoot targetLateralOffset
  const propCap = Math.max(-maxLatSpeed, Math.min(maxLatSpeed, latDiff * 3.4));
  const desiredLatVel =
    Math.abs(latDiff) < 0.45
      ? propCap
      : Math.max(-maxLatSpeed, Math.min(maxLatSpeed, rawLatVel * 0.55 + propCap * 0.45));

  const maxLatAccel = (v.vClass === 'motor' ? 5.2 : 4.2) * weather.friction;
  const dvLat = desiredLatVel - v.lateralVelocity;
  const nextLatVel = v.lateralVelocity + Math.sign(dvLat) * Math.min(Math.abs(dvLat), maxLatAccel * dt);
  const stepLat = nextLatVel * dt;

  return { nextLatVel, stepLat, steerAngle };
}

/**
 * Computes intent-aware world velocity (vx, vy) incorporating lateral steering motion
 * and upcoming curve turning tangent when approaching or inside a turning maneuver.
 */
function computeIntendedVelocity(v: SimVehicle, horizonSample: number): { vx: number; vy: number } {
  let effHeading = v.heading;
  if (
    v.compiledPath &&
    v.turn !== 'straight' &&
    v.speed > 1.2 &&
    v.distanceAlongPath > v.stopLineDist - 2.0 &&
    !v.hasExitedIntersection
  ) {
    const lookDist = Math.min(v.exitLineDist, v.distanceAlongPath + Math.max(1.2, v.speed * horizonSample * 0.6));
    const ahead = v.compiledPath.sample(lookDist);
    effHeading = ahead.heading;
  }
  const cosH = Math.cos(effHeading);
  const sinH = Math.sin(effHeading);
  // Canvas LHT outward-left normal of heading is (sin h, -cos h)
  const latVx = sinH * v.lateralVelocity * 0.75;
  const latVy = -cosH * v.lateralVelocity * 0.75;
  return {
    vx: cosH * v.speed + latVx,
    vy: sinH * v.speed + latVy,
  };
}

export interface LateralOffsetBounds {
  minOffsetDelta: number;
  maxOffsetDelta: number;
}

export interface PredictiveConflict2DResult {
  brakeGap: number;
  speedCap: number;
  evasiveLatDelta: number;
  evasiveUrgency: number;
}

export interface LateralDecisionLike {
  v: SimVehicle;
  nextLat: number;
  nextLatVel: number;
}

const EVASIVE_CLASS_SHARE: Record<VehicleClass, number> = {
  motor: 0.85,
  car: 0.55,
  heavy: 0.22,
};

interface SweptConflictDetails {
  willCollide: boolean;
  ttc: number;
  minDist: number;
  px: number;
  py: number;
  safeR: number;
  forwardAtT: number;
}

function computeSweptConflictDetails(
  a: SimVehicle,
  b: SimVehicle,
  maxHorizon: number
): SweptConflictDetails {
  const cosA = Math.cos(a.heading);
  const sinA = Math.sin(a.heading);

  const velA = computeIntendedVelocity(a, maxHorizon);
  const velB = computeIntendedVelocity(b, maxHorizon);

  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const vx = velB.vx - velA.vx;
  const vy = velB.vy - velA.vy;

  const v2 = vx * vx + vy * vy;
  let tStar = 0;
  if (v2 > 1e-4) {
    tStar = Math.max(0, Math.min(maxHorizon, -(rx * vx + ry * vy) / v2));
  }

  const px = rx + vx * tStar;
  const py = ry + vy * tStar;
  const minDist = Math.hypot(px, py);

  const aEffW = effClearanceWidth(a);
  const bEffW = effClearanceWidth(b);
  // Tight lateral-aware collision envelope so parallel lanes never false-trigger swept conflict
  const safeR = (aEffW + bEffW) * 0.5 + 0.45;

  // Check if B is genuinely ahead of A along A's heading at tStar and moving across A's path
  const forwardAtT = px * cosA + py * sinA;
  const willCollide =
    minDist < safeR &&
    forwardAtT > 0.2 &&
    forwardAtT < a.length * 0.5 + b.length * 0.5 + 3.0 &&
    tStar > 0.04;

  return { willCollide, ttc: tStar, minDist, px, py, safeR, forwardAtT };
}

/**
 * Intent-aware predictive swept-position check at horizons up to maxHorizon for proactive 2D collision avoidance.
 * Incorporates lateral velocity, lane-change/turning spline trajectory, and returns predicted time-to-conflict.
 */
export function predictSweptCollisionTTC(
  a: SimVehicle,
  b: SimVehicle,
  maxHorizon = 1.4
): { willCollide: boolean; ttc: number; minDist: number } {
  const res = computeSweptConflictDetails(a, b, maxHorizon);
  return { willCollide: res.willCollide, ttc: res.ttc, minDist: res.minDist };
}

function chooseDeadCenterEscapeSign(
  v: SimVehicle,
  dotHeading: number,
  effMinDelta: number,
  effMaxDelta: number,
  hasBounds: boolean
): number {
  const negRoom = hasBounds ? Math.max(0, -effMinDelta) : 0.85;
  const posRoom = hasBounds ? Math.max(0, effMaxDelta) : 0.85;
  if (negRoom < 0.08 && posRoom >= 0.12) return 1;
  if (posRoom < 0.08 && negRoom >= 0.12) return -1;

  // For opposing head-on alignments in LHT, both keeping to their own outward-left (+1) yields opposite world escapes
  if (dotHeading < -0.35 && posRoom >= 0.12) return 1;

  if (v.turn === 'left') return 1;
  if (v.turn === 'right' || v.turn === 'uturn') return -1;
  return v.id % 2 === 0 ? 1 : -1;
}

/**
 * Proactive 2D predictive collision scan for intersection box crossings, merges, and lane sweeps.
 * Combines intent-aware longitudinal braking with Hybrid ORCA / Asymmetric Velocity-Obstacle
 * 2D lateral evasion in LHT Canvas Y-down coordinates (+lateralOffset = outward-left normal).
 */
export function evaluatePredictiveConflict2D(
  v: SimVehicle,
  nearby: readonly SimVehicle[],
  weather: WeatherPhysicsProfile,
  bounds?: LateralOffsetBounds
): PredictiveConflict2DResult {
  let brakeGap = Infinity;
  let speedCap = Infinity;
  if (v.speed < 0.4 || v.isReversing) {
    return { brakeGap, speedCap, evasiveLatDelta: 0, evasiveUrgency: 0 };
  }

  const vNearOrInBox = v.distanceAlongPath > v.stopLineDist - 7.0 && !v.hasExitedIntersection;
  const vManeuvering =
    Boolean(v.laneChangeDir) ||
    Boolean(v.overtakeState && v.overtakeState !== 'none') ||
    Boolean(v.crossingMarking);

  if (!vNearOrInBox && !vManeuvering) {
    return { brakeGap, speedCap, evasiveLatDelta: 0, evasiveUrgency: 0 };
  }

  const cosV = Math.cos(v.heading);
  const sinV = Math.sin(v.heading);
  const baseHorizon = Math.min(1.35, 0.75 + v.speed * 0.04) * weather.reactionMult;
  const allowBraking = v.speed >= 1.1;

  const hasBounds = Boolean(bounds);
  const rawMinB = bounds ? Math.min(bounds.minOffsetDelta, bounds.maxOffsetDelta) : -0.85;
  const rawMaxB = bounds ? Math.max(bounds.minOffsetDelta, bounds.maxOffsetDelta) : 0.85;
  const effMinDelta = Math.max(-0.85, rawMinB);
  const effMaxDelta = Math.min(0.85, rawMaxB);

  let maxUrgency = 0;
  let posPush = 0;
  let negPush = 0;

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.isReversing) continue;

    const otherInBox = other.distanceAlongPath >= other.stopLineDist - 2.0 && !other.hasExitedIntersection;
    const minOtherSpeed = otherInBox && vNearOrInBox ? 0.4 : 0.7;
    if (other.speed < minOtherSpeed) continue;

    // Skip vehicles safely parallel in same-arm lanes unless one is changing lanes or crossing markings
    const sameArm = other.originArm === v.originArm;
    const otherHasIntentShift =
      Boolean(other.laneChangeDir) ||
      Math.abs(other.targetLateralOffset - other.lateralOffset) > 0.35;
    const otherManeuvering =
      otherHasIntentShift ||
      Boolean(other.overtakeState && other.overtakeState !== 'none') ||
      Boolean(other.crossingMarking);
    const inBoxMultiLane =
      v.distanceAlongPath > v.stopLineDist - 4.0 &&
      !v.hasExitedIntersection &&
      v.laneIndex !== other.laneIndex;
    if (sameArm && !vManeuvering && !otherManeuvering && v.turn === other.turn && !inBoxMultiLane) continue;

    // Skip diverging turners on approach already separating smoothly away toward their turn side
    if (
      sameArm &&
      v.distanceAlongPath < v.stopLineDist - 3.5 &&
      other.distanceAlongPath < other.stopLineDist - 3.5 &&
      v.turn !== other.turn &&
      !other.laneChangeDir &&
      Math.abs(other.lateralOffset - v.lateralOffset) > 0.55 &&
      Math.sign(other.lateralVelocity) === Math.sign(other.lateralOffset - v.lateralOffset)
    ) {
      continue;
    }

    // Avoid cross-arm false triggers for vehicles still comfortably behind their red stop line
    if (!sameArm && other.distanceAlongPath + other.length * 0.5 < other.stopLineDist - 1.5 && !other.isSlipLane) {
      continue;
    }

    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const fwd = dx * cosV + dy * sinV;
    if (fwd < -0.5 || fwd > 18.0) continue;

    const dot = cosV * Math.cos(other.heading) + sinV * Math.sin(other.heading);
    // For non-merging, non-maneuvering opposite streams, oncoming FSM/defensive yield already handles it
    if (dot < -0.55 && !vManeuvering && !otherManeuvering) continue;

    const scanHorizon = otherHasIntentShift ? Math.min(1.55, baseHorizon * 1.15) : baseHorizon;
    const pred = computeSweptConflictDetails(v, other, scanHorizon);
    const ttcBrakeCap = otherHasIntentShift ? 1.25 : 1.1;
    const hasSweptConflict = pred.willCollide && pred.ttc <= scanHorizon;

    const inBoxOrMerge =
      v.distanceAlongPath > v.stopLineDist - 4.0 ||
      other.distanceAlongPath > other.stopLineDist - 4.0 ||
      !sameArm ||
      v.destArm === other.destArm;
    const shearPred =
      !hasSweptConflict && scanHorizon < 1.35 && inBoxOrMerge
        ? computeSweptConflictDetails(v, other, 1.35)
        : pred;
    const isDiagonalOrShear =
      dot < 0.9 ||
      Boolean(v.laneChangeDir) ||
      otherHasIntentShift ||
      v.turn !== other.turn ||
      shearPred.minDist < shearPred.safeR - 0.1;
    const hasShearConflict =
      inBoxOrMerge &&
      isDiagonalOrShear &&
      shearPred.minDist < shearPred.safeR + 0.55 &&
      shearPred.ttc < 1.35 &&
      shearPred.ttc > 0.04 &&
      shearPred.forwardAtT > -v.length * 0.35;

    if (!hasSweptConflict && !hasShearConflict) continue;

    // Priority tiebreak: straight > right/left, non-maneuvering > maneuvering, closer to exit > farther
    const vPriorityBoost = (v.turn === 'straight' ? 2 : 0) + (vManeuvering ? -1 : 1);
    const oPriorityBoost = (other.turn === 'straight' ? 2 : 0) + (otherManeuvering ? -1 : 1);
    const vRem = v.exitLineDist - v.distanceAlongPath;
    const oRem = other.exitLineDist - other.distanceAlongPath;

    let yieldForBrake = true;
    if (vPriorityBoost > oPriorityBoost && other.speed < v.speed * 1.1) {
      yieldForBrake = false;
    } else if (vPriorityBoost === oPriorityBoost && vRem < oRem - 1.0) {
      yieldForBrake = false;
    }

    if (allowBraking && other.speed >= 0.7 && pred.willCollide && pred.ttc <= ttcBrakeCap && yieldForBrake) {
      const estGap = Math.max(0.3, fwd - (v.length + other.length) * 0.5 - 0.35);
      if (estGap < brakeGap) {
        brakeGap = estGap;
        speedCap = Math.min(speedCap, Math.max(1.8, pred.ttc * 4.5));
      }
    }

    // Hybrid ORCA lateral evasion vector in LHT (+lateralOffset = outward-left normal (sinV, -cosV))
    // Restrict same-arm approach evasion to genuine box entry (> stopLineDist - 2m) or active lane/overtake maneuvers
    const allowOrcaAgainstOther =
      !sameArm ||
      v.distanceAlongPath > v.stopLineDist - 2.0 ||
      v.hasExitedIntersection ||
      vManeuvering;
    if (!allowOrcaAgainstOther) continue;

    const activePred = hasSweptConflict ? pred : shearPred;
    const activeHorizon = hasSweptConflict ? scanHorizon : Math.max(scanHorizon, 1.35);
    const u = Math.max(0, Math.min(1, 1 - activePred.ttc / Math.max(0.1, activeHorizon)));
    if (u <= 0) continue;

    const latAtTStar = activePred.px * sinV - activePred.py * cosV;
    const escapeSign =
      Math.abs(latAtTStar) < 0.08
        ? chooseDeadCenterEscapeSign(v, dot, effMinDelta, effMaxDelta, hasBounds)
        : latAtTStar > 0
          ? -1
          : 1;

    let priorityWeight: number;
    if (vPriorityBoost > oPriorityBoost) {
      priorityWeight = 0.25;
    } else if (vPriorityBoost < oPriorityBoost || vManeuvering) {
      priorityWeight = vPriorityBoost < oPriorityBoost ? 1.0 : 0.9;
    } else if (vRem < oRem - 1.0) {
      priorityWeight = 0.35;
    } else if (oRem < vRem - 1.0) {
      priorityWeight = 0.95;
    } else {
      priorityWeight = 0.65;
    }

    const overlapSeverity = Math.max(0.15, activePred.safeR + 0.4 - activePred.minDist);
    const mag = Math.min(0.85, EVASIVE_CLASS_SHARE[v.vClass] * priorityWeight * u * overlapSeverity);

    if (u > maxUrgency) maxUrgency = u;
    if (escapeSign > 0) {
      if (mag > posPush) posPush = mag;
    } else {
      if (mag > negPush) negPush = mag;
    }
  }

  let evasiveLatDelta = 0;
  let evasiveUrgency = 0;
  if (maxUrgency > 0) {
    const rawDelta = Math.max(-0.85, Math.min(0.85, posPush - negPush));
    if (hasBounds) {
      // Never flip evasion sign into a blocked direction toward the threat
      if ((rawDelta > 0 && effMaxDelta <= 0) || (rawDelta < 0 && effMinDelta >= 0)) {
        evasiveLatDelta = 0;
      } else {
        evasiveLatDelta = Math.max(effMinDelta, Math.min(effMaxDelta, rawDelta));
      }
    } else {
      evasiveLatDelta = rawDelta;
    }

    if (Math.abs(evasiveLatDelta) < 1e-4) {
      evasiveLatDelta = 0;
      evasiveUrgency = 0;
    } else {
      evasiveUrgency = maxUrgency;
    }
  }

  return { brakeGap, speedCap, evasiveLatDelta, evasiveUrgency };
}

/**
 * Combines a baseline lateral target with an ORCA evasive delta and clamps strictly inside road/lane bounds.
 */
export function computeSafeLateralTarget(
  v: SimVehicle,
  baseTargetLat: number,
  evasiveDelta: number,
  minLatBound: number,
  maxLatBound: number
): number {
  const lo = Math.min(minLatBound, maxLatBound);
  const hi = Math.max(minLatBound, maxLatBound);
  if (v.isReversing || v.speed < 0.4) {
    return Math.max(lo, Math.min(hi, baseTargetLat));
  }
  let effDelta = evasiveDelta;
  if ((v.overtakeState === 'merge_back' || v.overtakeState === 'abort') && effDelta < 0) {
    effDelta = 0;
  }
  return Math.max(lo, Math.min(hi, baseTargetLat + effDelta));
}

/**
 * Computes half-width projected along the lateral axis taking into account steerYaw from lateral velocity.
 */
function effYawedHalfWidth(v: SimVehicle, latVel: number): number {
  const halfW = effClearanceWidth(v) * 0.5;
  if (Math.abs(latVel) <= 0.05 || v.speed <= 0.1) return halfW;
  const speedScale = Math.min(1, v.speed / 1.5);
  const yaw = Math.max(-0.32, Math.min(0.32, Math.atan2(-latVel, Math.max(2.2, v.speed)))) * speedScale;
  return halfW * Math.cos(yaw) + v.length * 0.5 * Math.abs(Math.sin(yaw));
}

/**
 * Fast per-vehicle lateral safety check against nearby traffic (both same-arm approach and 2D world space).
 */
export function isLateralMoveSafeAgainstNeighbors(
  v: SimVehicle,
  candGlobalLat: number,
  curGlobalLat: number,
  lw: number,
  laneCenters: readonly number[] | undefined,
  nearby: readonly SimVehicle[],
  dt: number,
  minClearPad?: number
): boolean {
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  const stepSigned = candGlobalLat - curGlobalLat;
  const candLatVel = dt > 1e-4 ? stepSigned / dt : v.lateralVelocity;
  const myYawHalfW = Math.max(effYawedHalfWidth(v, v.lateralVelocity), effYawedHalfWidth(v, candLatVel));
  const estHalfMedian = laneCenters && laneCenters.length > 0 ? Math.max(0, laneCenters[0] - lw * 0.5) : 0;

  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id) continue;

    if (
      other.originArm === v.originArm &&
      v.distanceAlongPath < v.stopLineDist - 0.5 &&
      other.distanceAlongPath < other.stopLineDist - 0.5
    ) {
      const speedBuf = other.distanceAlongPath > v.distanceAlongPath ? Math.max(0, v.speed - other.speed) * 0.6 : 0;
      const returningAcrossCenter = curGlobalLat < estHalfMedian + 0.25 && stepSigned > 0;
      const longBuf = returningAcrossCenter ? 0.45 : 2.2;
      if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + longBuf + speedBuf) {
        const otherG = getGlobalLat(
          other.laneIndex,
          other.lateralOffset + other.lateralVelocity * dt,
          lw,
          laneCenters
        );
        const defaultPad = v.vClass === 'motor' ? 0.18 : 0.42;
        const swingPad = returningAcrossCenter
          ? Math.min(0.04, minClearPad ?? 0.04)
          : minClearPad ?? defaultPad;
        const sumHalfW = myYawHalfW + effYawedHalfWidth(other, other.lateralVelocity);
        const tightParallelMotorPivot =
          v.vClass === 'motor' &&
          v.speed < 2.2 &&
          !returningAcrossCenter &&
          (!v.overtakeState || v.overtakeState === 'none') &&
          !v.crossingMarking &&
          Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + 0.35 &&
          Math.abs(curGlobalLat - otherG) < sumHalfW + 0.24;

        if (
          tightParallelMotorPivot ||
          (Math.abs(candGlobalLat - otherG) < sumHalfW + swingPad &&
            Math.abs(candGlobalLat - otherG) < Math.abs(curGlobalLat - otherG))
        ) {
          return false;
        }
      }
    } else {
      const cosO = Math.cos(other.heading);
      const sinO = Math.sin(other.heading);
      const dotHeading = cosH * cosO + sinH * sinO;
      if (dotHeading < 0.35 && !(dotHeading < -0.45 && stepSigned < 0)) continue;

      const dx = other.x - v.x;
      const dy = other.y - v.y;
      const fwd = dx * cosH + dy * sinH;
      const speedBuf = fwd > 0 ? Math.max(0, v.speed - other.speed) * 0.55 : 0;
      const oppExtra = dotHeading < -0.45 ? 1.4 : 0;
      if (Math.abs(fwd) < (v.length + other.length) * 0.5 + 1.8 + speedBuf + oppExtra) {
        const curOtherLat = dx * sinH - dy * cosH;
        const candOtherLat = curOtherLat - stepSigned;
        const oHalfW = effClearanceWidth(other) * 0.5;
        const otherHalfLat =
          other.isSlipLane || v.isSlipLane || dotHeading < 0.92
            ? Math.abs(-cosO * sinH + sinO * cosH) * (other.length * 0.5) +
            Math.abs(sinO * sinH + cosO * cosH) * oHalfW
            : effYawedHalfWidth(other, other.lateralVelocity);
        const minClear = myYawHalfW + otherHalfLat + (minClearPad ?? 0.22) + (dotHeading < -0.45 ? 0.25 : 0);
        if (Math.abs(candOtherLat) < minClear && Math.abs(candOtherLat) < Math.abs(curOtherLat)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Clamps a candidate local lateralOffset step against neighboring vehicles, falling back to half-step or zero-step.
 */
export function clampCandidateLateralStep(
  v: SimVehicle,
  candLat: number,
  curLat: number,
  lw: number,
  laneCenters: readonly number[] | undefined,
  nearby: readonly SimVehicle[],
  dt: number,
  minClearPad?: number
): { safeLat: number; blocked: boolean } {
  const curGlobalLat = getGlobalLat(v.laneIndex, curLat, lw, laneCenters);
  const candGlobalLat = getGlobalLat(v.laneIndex, candLat, lw, laneCenters);
  if (
    isLateralMoveSafeAgainstNeighbors(v, candGlobalLat, curGlobalLat, lw, laneCenters, nearby, dt, minClearPad)
  ) {
    return { safeLat: candLat, blocked: false };
  }

  const halfLat = curLat + (candLat - curLat) * 0.5;
  const halfGlobalLat = getGlobalLat(v.laneIndex, halfLat, lw, laneCenters);
  if (
    Math.abs(halfLat - curLat) > 1e-4 &&
    isLateralMoveSafeAgainstNeighbors(v, halfGlobalLat, curGlobalLat, lw, laneCenters, nearby, dt, minClearPad)
  ) {
    return { safeLat: halfLat, blocked: true };
  }

  return { safeLat: curLat, blocked: true };
}

function resolveArmBucketLateralGuard(
  bucket: LateralDecisionLike[],
  isApproach: boolean,
  lw: number,
  armsById: Record<string, CompiledArmGeometry>,
  dt: number,
  minClearPad: number
): void {
  if (bucket.length < 2) return;
  bucket.sort((a, b) => a.v.distanceAlongPath - b.v.distanceAlongPath);

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bucket.length; i++) {
      const da = bucket[i];
      const a = da.v;
      const armId = isApproach ? a.originArm : a.destArm;
      const armGeom = armsById[armId];
      const laneCenters = isApproach ? armGeom?.inLaneCenters : armGeom?.outLaneCenters;
      const halfMedian = armGeom?.halfMedian ?? 0;
      const laneIdxA = isApproach ? a.laneIndex : (a.destLaneIndex ?? a.laneIndex);
      const lwA = (isApproach ? armGeom?.def.inLaneWidths[laneIdxA] : armGeom?.def.outLaneWidths[laneIdxA]) ?? lw;

      for (let j = i + 1; j < bucket.length; j++) {
        const db = bucket[j];
        const b = db.v;
        // Bucket is sorted by distanceAlongPath; once gaps exceed max vehicle length + step margin, stop scanning
        if (b.distanceAlongPath - a.distanceAlongPath > (a.length + b.length) * 0.5 + 2.5) {
          break;
        }

        const sA = a.distanceAlongPath + (a.isReversing ? -a.speed : a.speed) * dt;
        const sB = b.distanceAlongPath + (b.isReversing ? -b.speed : b.speed) * dt;
        const overlapSpan = (a.length + b.length) * 0.5 + 0.35;
        if (
          Math.abs(a.distanceAlongPath - b.distanceAlongPath) >= overlapSpan &&
          Math.abs(sA - sB) >= overlapSpan
        ) {
          continue;
        }

        const laneIdxB = isApproach ? b.laneIndex : (b.destLaneIndex ?? b.laneIndex);
        const lwB = (isApproach ? armGeom?.def.inLaneWidths[laneIdxB] : armGeom?.def.outLaneWidths[laneIdxB]) ?? lw;

        const curLatA = getGlobalLat(laneIdxA, a.lateralOffset, lwA, laneCenters);
        const curLatB = getGlobalLat(laneIdxB, b.lateralOffset, lwB, laneCenters);
        const candLatA = getGlobalLat(laneIdxA, da.nextLat, lwA, laneCenters);
        const candLatB = getGlobalLat(laneIdxB, db.nextLat, lwB, laneCenters);

        const reqSep = effYawedHalfWidth(a, da.nextLatVel) + effYawedHalfWidth(b, db.nextLatVel) + minClearPad;
        const candSep = Math.abs(candLatA - candLatB);
        const curSep = Math.abs(curLatA - curLatB);
        if (candSep >= reqSep || candSep >= curSep) continue;

        const aIsLower =
          curLatA < curLatB - 1e-6 || (Math.abs(curLatA - curLatB) <= 1e-6 && a.id < b.id);
        const deltaA = da.nextLat - a.lateralOffset;
        const deltaB = db.nextLat - b.lateralOffset;
        const closeA = aIsLower ? Math.max(0, deltaA) : Math.max(0, -deltaA);
        const closeB = aIsLower ? Math.max(0, -deltaB) : Math.max(0, deltaB);
        const totalClose = closeA + closeB;
        if (totalClose <= 1e-6) continue;

        if (curSep >= reqSep) {
          const slack = curSep - reqSep;
          if (totalClose <= slack + 1e-6) continue;

          const aReturning = isApproach && curLatA < halfMedian + 0.25 && deltaA > 0;
          const bReturning = isApproach && curLatB < halfMedian + 0.25 && deltaB > 0;
          let allowedA: number;
          let allowedB: number;
          if (aReturning && !bReturning) {
            allowedA = Math.min(closeA, slack);
            allowedB = Math.max(0, slack - allowedA);
          } else if (bReturning && !aReturning) {
            allowedB = Math.min(closeB, slack);
            allowedA = Math.max(0, slack - allowedB);
          } else {
            const scale = slack / totalClose;
            allowedA = closeA * scale;
            allowedB = closeB * scale;
          }

          if (closeA > 0 && allowedA < closeA) {
            da.nextLat = a.lateralOffset + Math.sign(deltaA) * allowedA;
            da.nextLatVel = 0;
          }
          if (closeB > 0 && allowedB < closeB) {
            db.nextLat = b.lateralOffset + Math.sign(deltaB) * allowedB;
            db.nextLatVel = 0;
          }
        } else {
          // Already tighter than reqSep: block any inward closing step while allowing separation moves
          if (closeA > 0) {
            da.nextLat = a.lateralOffset;
            da.nextLatVel = 0;
          }
          if (closeB > 0) {
            db.nextLat = b.lateralOffset;
            db.nextLatVel = 0;
          }
        }
      }
    }
  }
}

/**
 * Post-decision pairwise lateral guard across all vehicles on the same approach arm or exit leg.
 * Prevents two longitudinally overlapping vehicles from converging laterally into an OBB overlap in one `dt` tick.
 */
export function resolvePairwiseLateralGuard(
  decisions: LateralDecisionLike[],
  lw: number,
  armsById: Record<string, CompiledArmGeometry>,
  dt: number,
  minClearPad = 0.14
): void {
  if (decisions.length < 2) return;

  const approachByArm = new Map<string, LateralDecisionLike[]>();
  const exitByArm = new Map<string, LateralDecisionLike[]>();

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    const v = d.v;
    if (v.isSlipLane || v.isUTurn) continue;

    if (v.distanceAlongPath < v.stopLineDist - 0.3) {
      let bucket = approachByArm.get(v.originArm);
      if (!bucket) {
        bucket = [];
        approachByArm.set(v.originArm, bucket);
      }
      bucket.push(d);
    } else if (v.hasExitedIntersection) {
      let bucket = exitByArm.get(v.destArm);
      if (!bucket) {
        bucket = [];
        exitByArm.set(v.destArm, bucket);
      }
      bucket.push(d);
    }
  }

  for (const bucket of approachByArm.values()) {
    resolveArmBucketLateralGuard(bucket, true, lw, armsById, dt, minClearPad);
  }
  for (const bucket of exitByArm.values()) {
    resolveArmBucketLateralGuard(bucket, false, lw, armsById, dt, minClearPad);
  }
}

function resampleVehiclePose(v: SimVehicle): void {
  if (!v.path) return;
  const pt = sampleWithLateralOffset(
    v.path,
    v.distanceAlongPath,
    v.lateralOffset,
    v.isReversing ? -v.lateralVelocity : v.lateralVelocity,
    v.speed
  );
  v.x = pt.x;
  v.y = pt.y;
  v.heading = pt.heading;
}

/**
 * Post-step symmetric lateral separation helper for same-arm pre-stop vehicles with longitudinal overlap.
 * Gently nudges overlapping parallel vehicles apart within approach carriageway bounds.
 */
export function enforceParallelLateralSeparation(
  vehicles: SimVehicle[],
  lw: number,
  armsById: Record<string, CompiledArmGeometry>,
  spatialHash: SpatialHashGrid,
  queryBuf: SimVehicle[]
): void {
  if (vehicles.length < 2) return;

  for (let pass = 0; pass < 2; pass++) {
    let anyAdjusted = false;
    spatialHash.rebuild(vehicles);

    for (let i = 0; i < vehicles.length; i++) {
      const a = vehicles[i];
      if (a.isSlipLane || a.isUTurn || a.isReversing) continue;
      if (a.distanceAlongPath >= a.stopLineDist - 0.25) continue;

      const armGeom = armsById[a.originArm];
      if (!armGeom) continue;

      const roadMin = armGeom.halfMedian + 0.38;
      const roadMax = armGeom.halfMedian + armGeom.inWidth - 0.38;
      if (roadMax <= roadMin + 0.1) continue;

      const laneCenters = armGeom.inLaneCenters;
      const lwA = armGeom.def.inLaneWidths[a.laneIndex] ?? lw;
      const effWA = effClearanceWidth(a);

      spatialHash.queryRadius(a.x, a.y, Math.max(10.5, a.length + 7.5), queryBuf);

      for (let j = 0; j < queryBuf.length; j++) {
        const b = queryBuf[j];
        if (b.id <= a.id) continue;
        if (b.originArm !== a.originArm || b.isSlipLane || b.isUTurn || b.isReversing) continue;
        if (b.distanceAlongPath >= b.stopLineDist - 0.25) continue;

        if (Math.abs(a.distanceAlongPath - b.distanceAlongPath) >= (a.length + b.length) * 0.5 * 0.88) {
          continue;
        }

        const lwB = armGeom.def.inLaneWidths[b.laneIndex] ?? lw;
        const latA = getGlobalLat(a.laneIndex, a.lateralOffset, lwA, laneCenters);
        const latB = getGlobalLat(b.laneIndex, b.lateralOffset, lwB, laneCenters);
        const latSep = Math.abs(latA - latB);
        const centerSlack =
          a.laneIndex !== b.laneIndex && laneCenters[a.laneIndex] !== undefined && laneCenters[b.laneIndex] !== undefined
            ? Math.abs((laneCenters[a.laneIndex] - laneCenters[b.laneIndex]) - (a.laneIndex - b.laneIndex) * lw)
            : 0;
        const reqSep = (effWA + effClearanceWidth(b)) * 0.5 + 0.06 + centerSlack;
        if (latSep >= reqSep) continue;

        const deficit = reqSep - latSep;
        const targetPush = Math.min(deficit, 0.36);

        const aIsLower =
          latA < latB - 1e-4 ||
          (Math.abs(latA - latB) <= 1e-4 &&
            (a.laneIndex < b.laneIndex || (a.laneIndex === b.laneIndex && a.id < b.id)));

        const roomA = aIsLower ? Math.max(0, latA - roadMin) : Math.max(0, roadMax - latA);
        const roomB = aIsLower ? Math.max(0, roadMax - latB) : Math.max(0, latB - roadMin);

        const wA = a.vClass === 'motor' ? 1.0 : a.vClass === 'car' ? 0.65 : 0.25;
        const wB = b.vClass === 'motor' ? 1.0 : b.vClass === 'car' ? 0.65 : 0.25;
        const totalW = wA + wB;

        let magA = Math.min(roomA, targetPush * (wA / totalW));
        let magB = Math.min(roomB, targetPush * (wB / totalW));
        const rem = targetPush - (magA + magB);
        if (rem > 1e-5) {
          const extraA = Math.min(roomA - magA, rem);
          magA += extraA;
          const rem2 = rem - extraA;
          if (rem2 > 1e-5) {
            magB += Math.min(roomB - magB, rem2);
          }
        }

        const shiftA = aIsLower ? -magA : magA;
        const shiftB = aIsLower ? magB : -magB;

        if (Math.abs(shiftA) > 1e-5) {
          a.lateralOffset += shiftA;
          if (Math.sign(a.lateralVelocity) !== Math.sign(shiftA)) a.lateralVelocity = 0;
          resampleVehiclePose(a);
          anyAdjusted = true;
        }
        if (Math.abs(shiftB) > 1e-5) {
          b.lateralOffset += shiftB;
          if (Math.sign(b.lateralVelocity) !== Math.sign(shiftB)) b.lateralVelocity = 0;
          resampleVehiclePose(b);
          anyAdjusted = true;
        }
      }
    }

    if (!anyAdjusted) break;
  }
}

/**
 * Wide-Turn Off-Tracking & Pre-Swing Kinematics (Phase 4) for long heavy vehicles (bus/truck).
 * Gently swings away from the turn apex 2-15m before the stop line when adjacent lateral space is clear
 * to increase effective turning radius and reduce curb/inner-corner off-tracking, then tapers cleanly
 * back to lane center inside the turning arc.
 */
export function computeHeavyWideTurnTargetOffset(
  v: SimVehicle,
  armGeom: CompiledArmGeometry | undefined,
  nearby: readonly SimVehicle[],
  lw: number
): { wideOffset: number; state: 'none' | 'pre_swing' | 'turning' } {
  if (v.vClass !== 'heavy' || v.isSlipLane || v.isUTurn || (v.turn !== 'left' && v.turn !== 'right')) {
    return { wideOffset: 0, state: 'none' };
  }
  if (v.hasExitedIntersection || v.distanceAlongPath >= v.exitLineDist) {
    return { wideOffset: 0, state: 'none' };
  }

  const distToStop = v.stopLineDist - v.distanceAlongPath;
  if (v.distanceAlongPath >= v.stopLineDist - 1.0) {
    return { wideOffset: 0, state: 'turning' };
  }
  if (distToStop > 16.0 || !armGeom) {
    return { wideOffset: 0, state: 'none' };
  }

  const armLw = armGeom.def.inLaneWidths[v.laneIndex] ?? lw;
  const laneCenter = armGeom.inLaneCenters[v.laneIndex] ?? getGlobalLat(v.laneIndex, 0, armLw);
  const myHalfW = effClearanceWidth(v) * 0.5 + 0.18;
  const minGlobal = armGeom.halfMedian + myHalfW;
  const maxGlobal = armGeom.halfMedian + armGeom.inWidth - myHalfW;
  if (maxGlobal <= minGlobal + 0.25) {
    return { wideOffset: 0, state: 'none' };
  }

  // Left turn (curb-hugging in LHT) swings slightly inward (-); Right turn swings slightly outward (+)
  const swingDir = v.turn === 'left' ? -1 : 1;
  const desiredSwingMag = armGeom.def.inLanes >= 2 ? 0.52 : 0.36;
  const ramp =
    distToStop > 4.0
      ? Math.max(0, Math.min(1, (16.0 - distToStop) / 10.0))
      : Math.max(0.25, (distToStop - 1.0) / 3.0);
  const rawGlobalTarget = laneCenter + swingDir * desiredSwingMag * ramp;
  const clampedGlobal = Math.max(minGlobal, Math.min(maxGlobal, rawGlobalTarget));
  const candOffset = clampedGlobal - laneCenter;
  if (Math.abs(candOffset) < 0.08) {
    return { wideOffset: 0, state: 'none' };
  }

  // Verify no nearby same-arm vehicle occupies the swing-out corridor
  const bandMin = Math.min(laneCenter + v.lateralOffset, clampedGlobal);
  const bandMax = Math.max(laneCenter + v.lateralOffset, clampedGlobal);
  for (let i = 0; i < nearby.length; i++) {
    const other = nearby[i];
    if (other.id === v.id || other.originArm !== v.originArm) continue;
    if (other.distanceAlongPath >= other.stopLineDist + 1.0) continue;
    if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) > (v.length + other.length) * 0.5 + 3.5) {
      continue;
    }
    const oLw = armGeom.def.inLaneWidths[other.laneIndex] ?? lw;
    const oGlobal = getGlobalLat(other.laneIndex, other.lateralOffset, oLw, armGeom.inLaneCenters);
    const minSep = (effClearanceWidth(v) + effClearanceWidth(other)) * 0.5 + 0.32;
    if (oGlobal >= bandMin - minSep && oGlobal <= bandMax + minSep) {
      // Keep current partial swing if already shifted, otherwise abort pre-swing cleanly
      return { wideOffset: 0, state: 'none' };
    }
  }

  return { wideOffset: candOffset, state: 'pre_swing' };
}
