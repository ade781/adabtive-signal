import { SimVehicle } from './behaviors';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { wrapAngleRad } from './topologyBuilder';
import { CompiledMovementPath } from './topologyTypes';
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
  const returningFromOncoming = v.overtakeState === 'merge_back' || v.overtakeState === 'abort';
  if (Math.abs(latDiff) <= 0.008 || (!returningFromOncoming && v.speed <= 0.25)) {
    const damped = v.lateralVelocity * Math.max(0, 1 - 12 * dt);
    return { nextLatVel: Math.abs(damped) < 0.01 ? 0 : damped, stepLat: 0, steerAngle: 0 };
  }

  // If forced to slow/stop while returning from the oncoming lane, still allow low-speed evasive slide back home
  const effSpeed = returningFromOncoming ? Math.max(v.speed, 2.2) : v.speed;
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
 * Predictive swept-position check at horizons t = 0.35s and 0.8s for proactive 2D collision avoidance.
 * Returns predicted time-to-conflict if two vehicles' trajectories will intersect dangerously close.
 */
export function predictSweptCollisionTTC(
  a: SimVehicle,
  b: SimVehicle,
  maxHorizon = 1.4
): { willCollide: boolean; ttc: number; minDist: number } {
  const cosA = Math.cos(a.heading);
  const sinA = Math.sin(a.heading);
  const cosB = Math.cos(b.heading);
  const sinB = Math.sin(b.heading);

  const vAx = cosA * a.speed;
  const vAy = sinA * a.speed;
  const vBx = cosB * b.speed;
  const vBy = sinB * b.speed;

  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const vx = vBx - vAx;
  const vy = vBy - vAy;

  const v2 = vx * vx + vy * vy;
  let tStar = 0;
  if (v2 > 1e-4) {
    tStar = Math.max(0, Math.min(maxHorizon, -(rx * vx + ry * vy) / v2));
  }

  const px = rx + vx * tStar;
  const py = ry + vy * tStar;
  const minDist = Math.hypot(px, py);

  const aEffW = a.vClass === 'motor' ? 0.72 : a.width;
  const bEffW = b.vClass === 'motor' ? 0.72 : b.width;
  // Tight lateral-aware collision envelope so parallel lanes never false-trigger swept conflict
  const safeR = (aEffW + bEffW) * 0.5 + 0.45;

  // Check if B is genuinely ahead of A along A's heading at tStar and moving across A's path
  const forwardAtT = px * cosA + py * sinA;
  const willCollide = minDist < safeR && forwardAtT > 0.2 && forwardAtT < a.length * 0.5 + b.length * 0.5 + 3.0 && tStar > 0.04;

  return { willCollide, ttc: tStar, minDist };
}

export function blendHeadingSmooth(current: number, target: number, maxRateRadPerSec: number, dt: number): number {
  const diff = wrapAngleRad(target - current);
  const step = Math.max(-maxRateRadPerSec * dt, Math.min(maxRateRadPerSec * dt, diff));
  return wrapAngleRad(current + step);
}
