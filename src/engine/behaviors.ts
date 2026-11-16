import { PathCache } from './geometry';
import { DriverProfile } from './constants';
import { ArmId, SignalColor, SimConfig, Vehicle, VehicleClass } from './types';

export interface SimVehicle extends Vehicle {
  path: PathCache[ArmId][Vehicle['turn']][number];
  targetLateralOffset: number;
  lateralVelocity: number;
  speedFactor: number;
  accelFactor: number;
  profile: DriverProfile;
  reactionTimer: number;
  prevAccel?: number;
}

export function getGlobalLat(laneIndex: number, lateralOffset: number, lw: number): number {
  return (laneIndex + 0.5) * lw + lateralOffset;
}

export function effClearanceWidth(v: { vClass: VehicleClass; width: number }): number {
  return v.vClass === 'motor' ? 0.72 : v.width;
}

export function canFilterSideBySide(vW: number, oW: number, roadW: number): boolean {
  return roadW >= (vW < 1 ? 0.72 : vW) + (oW < 1 ? 0.72 : oW) + 0.25;
}

export function assignReactionWave(vehicles: SimVehicle[], arm: ArmId, lanes: number): void {
  for (let lane = 0; lane < lanes; lane++) {
    const queued = vehicles
      .filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist && v.speed < 1.2)
      .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);

    let prev = 0;
    for (let i = 0; i < queued.length; i++) {
      const v = queued[i];
      const base = v.vClass === 'motor' ? 0.04 : v.vClass === 'car' ? 0.1 : 0.18;
      const scale = v.profile === 'aggressive' ? 0.7 : v.profile === 'cautious' ? 1.2 : 1.0;
      const own = base * scale + Math.min(5, i) * 0.04;
      v.reactionTimer = i === 0 ? own : Math.max(prev + 0.04, own);
      prev = v.reactionTimer;
    }
  }
}

export function findBlockingLeader(
  v: SimVehicle,
  vehicles: SimVehicle[],
  lw: number
): { nearestGap: number; leadSpeed: number; blockingLeader: SimVehicle | null; isSqueezingPast: boolean } {
  let nearestGap = Infinity;
  let leadSpeed = v.maxSpeed;
  let blockingLeader: SimVehicle | null = null;
  let isSqueezingPast = false;

  const myGlobalLat = getGlobalLat(v.laneIndex, v.lateralOffset, lw);
  const myEffW = effClearanceWidth(v);
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);

  for (const other of vehicles) {
    if (other.id === v.id) continue;
    const otherEffW = effClearanceWidth(other);
    const pad = v.vClass === 'motor' || other.vClass === 'motor' ? 0.06 : 0.3;
    const minLatNeed = (myEffW + otherEffW) * 0.5 + pad;

    if (v.distanceAlongPath < v.stopLineDist - 2.0 && other.originArm === v.originArm && other.distanceAlongPath < other.stopLineDist - 0.5) {
      if (other.distanceAlongPath <= v.distanceAlongPath) continue;
      const otherGlobalLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const latSep = Math.abs(myGlobalLat - otherGlobalLat);
      // Do not squeeze alongside a vehicle in the same lane with a different turn approaching the intersection
      const crossingTurnInLane =
        v.distanceAlongPath >= v.stopLineDist - 20.0 &&
        v.laneIndex === other.laneIndex &&
        v.turn !== other.turn;
      const tailSwingPad1 =
        other.vClass === 'heavy' && other.turn !== 'straight' && other.distanceAlongPath >= other.stopLineDist - 8.0
          ? 1.4
          : 0;
      if (latSep >= minLatNeed + tailSwingPad1 && !crossingTurnInLane) {
        if (v.vClass === 'motor' && latSep < minLatNeed + 0.45 && Math.abs(other.distanceAlongPath - v.distanceAlongPath) < 4.5) {
          isSqueezingPast = true;
        }
        continue;
      }
      const gapAlong = other.distanceAlongPath - v.distanceAlongPath - (other.length + v.length) * 0.5;
      if (gapAlong < nearestGap) {
        nearestGap = Math.max(0.05, gapAlong);
        leadSpeed = other.speed;
        blockingLeader = other;
      }
    } else if (
      other.originArm === v.originArm ||
      (other.destArm === v.destArm && (other.distanceAlongPath >= other.stopLineDist - 2.0 || v.distanceAlongPath >= v.stopLineDist - 14.0)) ||
      (v.distanceAlongPath >= v.stopLineDist - 1.5 && other.distanceAlongPath > other.stopLineDist + 0.5 && other.distanceAlongPath - other.length * 0.5 < other.exitLineDist)
    ) {
      // Same-arm, same-turn curve following: arc-length gap remains exact even across 90-degree Bezier bends
      if (other.originArm === v.originArm && other.turn === v.turn && other.distanceAlongPath > v.distanceAlongPath) {
        const rawLatSep = Math.abs(myGlobalLat - getGlobalLat(other.laneIndex, other.lateralOffset, lw));
        const isSameTurnLane = v.turn !== 'straight' && v.laneIndex === other.laneIndex;
        const latSep = isSameTurnLane ? rawLatSep * 0.25 : rawLatSep;
        if (latSep < minLatNeed + (isSameTurnLane ? 0.25 : 0)) {
          const arcGap = other.distanceAlongPath - v.distanceAlongPath - (other.length + v.length) * 0.5;
          if (arcGap < 45 && arcGap < nearestGap) {
            nearestGap = Math.max(0.05, arcGap);
            leadSpeed = other.speed;
            blockingLeader = other;
          }
          continue;
        }
      }

      const dx = other.x - v.x;
      const dy = other.y - v.y;
      if (dx * dx + dy * dy > 45 * 45) continue;

      const forwardProj = dx * cosH + dy * sinH;
      const latProj = Math.abs(-dx * sinH + dy * cosH);

      // Project other's oriented bounding box onto v's local forward & lateral axes
      const cosO = Math.cos(other.heading);
      const sinO = Math.sin(other.heading);
      const dotCos = cosO * cosH + sinO * sinH;
      const dotSin = -sinO * cosH + cosO * sinH;
      const otherProjLen = Math.abs(dotCos) * (other.length * 0.5) + Math.abs(dotSin) * (otherEffW * 0.5);
      const otherProjLat = Math.abs(-cosO * sinH + sinO * cosH) * (other.length * 0.5) + Math.abs(sinO * sinH + cosO * cosH) * (otherEffW * 0.5);

      const crossingTurnSameLane =
        v.distanceAlongPath < v.stopLineDist + 8.0 &&
        other.originArm === v.originArm &&
        v.laneIndex === other.laneIndex &&
        v.turn !== other.turn &&
        other.distanceAlongPath > v.distanceAlongPath;
      const tailSwingPad =
        other.vClass === 'heavy' &&
        other.turn !== 'straight' &&
        other.originArm === v.originArm &&
        other.distanceAlongPath >= other.stopLineDist - 4.0 &&
        other.distanceAlongPath <= other.exitLineDist
          ? 1.4
          : 0;
      if (!crossingTurnSameLane && latProj >= myEffW * 0.5 + otherProjLat + tailSwingPad + pad) continue;
      const gapAlong = forwardProj - (v.length * 0.5 + otherProjLen);
      if (forwardProj <= 0.1) continue;

      if (gapAlong < nearestGap) {
        const minGap = other.originArm !== v.originArm && gapAlong <= 0 && other.speed > 1.0 ? 0.25 : 0.05;
        nearestGap = Math.max(minGap, gapAlong);
        leadSpeed = other.speed;
        blockingLeader = other;
      }
    }
  }

  return { nearestGap, leadSpeed, blockingLeader, isSqueezingPast };
}

export function updateMotorcycleSeepage(
  v: SimVehicle,
  vehicles: SimVehicle[],
  config: SimConfig,
  pathCache: PathCache,
  lw: number,
  roadW: number,
  desiredV: number,
  nearestGap: number,
  blockingLeader: SimVehicle | null
): void {
  const myEffW = effClearanceWidth(v);
  const myGlobalLat = getGlobalLat(v.laneIndex, v.lateralOffset, lw);

  const recenterDist = v.turn === 'straight' ? v.stopLineDist - 2.5 : v.stopLineDist - 5.0;
  if (v.distanceAlongPath >= recenterDist) {
    for (const other of vehicles) {
      if (other.id === v.id || other.originArm !== v.originArm) continue;
      if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + 2.5) {
        const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
        const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, lw);
        const centerLat = getGlobalLat(v.laneIndex, 0, lw);
        const minClear = (myEffW + effClearanceWidth(other)) * 0.5 + 0.35;
        if (Math.abs(centerLat - otherLat) < minClear || Math.abs(centerLat - otherTargetLat) < minClear) return;
      }
    }
    v.targetLateralOffset = 0;
    return;
  }

  if (
    !blockingLeader ||
    nearestGap >= 24.0 ||
    (v.distanceAlongPath >= v.stopLineDist - 20.0 && v.laneIndex === blockingLeader.laneIndex && v.turn !== blockingLeader.turn) ||
    (blockingLeader.speed >= desiredV - 0.8 && blockingLeader.speed >= 3.5) ||
    !canFilterSideBySide(v.width, blockingLeader.width, roadW)
  ) {
    return;
  }

  const minBound = v.turn === 'straight' ? 0.42 : Math.max(0.42, v.laneIndex * lw + 0.42);
  const maxBound = v.turn === 'straight' ? roadW - 0.42 : Math.min(roadW - 0.42, (v.laneIndex + 1) * lw - 0.42);
  const leadEffW = effClearanceWidth(blockingLeader);

  const raw: number[] = [];
  if (v.turn === 'straight') {
    for (let l = 1; l < config.lanesPerDirection; l++) raw.push(l * lw);
  }
  raw.push(myGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12, myGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12, maxBound, minBound);

  let bestCand: number | null = null;
  let bestForwardDist = -1;

  for (const cand of raw) {
    if (cand < minBound || cand > maxBound || Math.abs(cand - myGlobalLat) <= 0.2) continue;
    let clear = true;
    const bandMin = Math.min(myGlobalLat, cand);
    const bandMax = Math.max(myGlobalLat, cand);
    let forwardClear = v.stopLineDist - v.distanceAlongPath;

    for (const other of vehicles) {
      if (other.id === v.id || other.originArm !== v.originArm) continue;
      const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, lw);
      const pad = (myEffW + effClearanceWidth(other)) * 0.5 + 0.12;
      const halfSumLen = (v.length + other.length) * 0.5;
      const longDiff = other.distanceAlongPath - v.distanceAlongPath;

      if (Math.abs(longDiff) < halfSumLen + 1.2) {
        if (
          (otherLat >= bandMin - pad && otherLat <= bandMax + pad) ||
          (otherTargetLat >= bandMin - pad && otherTargetLat <= bandMax + pad)
        ) {
          clear = false; break;
        }
      } else if (longDiff > 0 && (Math.abs(cand - otherLat) < pad || Math.abs(cand - otherTargetLat) < pad)) {
        const gap = longDiff - halfSumLen;
        if (gap < 4.5 || (v.speed > other.speed + 1.5 && gap < (v.speed - other.speed) * 1.4)) {
          clear = false; break;
        }
        forwardClear = Math.min(forwardClear, gap);
      }
    }

    if (clear && forwardClear > bestForwardDist) {
      bestForwardDist = forwardClear;
      bestCand = cand;
    }
  }

  if (bestCand !== null && bestForwardDist > nearestGap + 1.5) {
    if (v.turn === 'straight' && config.lanesPerDirection >= 2) {
      const targetLane = Math.max(0, Math.min(config.lanesPerDirection - 1, Math.floor(bestCand / lw)));
      if (targetLane !== v.laneIndex) {
        const old = v.laneIndex;
        v.laneIndex = targetLane;
        v.path = pathCache[v.originArm][v.turn][targetLane];
        v.stopLineDist = v.path.stopLineDist;
        v.exitLineDist = v.path.exitLineDist;
        v.totalPathLength = v.path.totalPathLength;
        v.lateralOffset += (old - targetLane) * lw;
      }
    }
    v.targetLateralOffset = bestCand - (v.laneIndex + 0.5) * lw;
  }
}

export function tryCarLaneChange(
  v: SimVehicle,
  vehicles: SimVehicle[],
  config: SimConfig,
  pathCache: PathCache,
  lw: number,
  light: SignalColor,
  desiredV: number,
  nearestGap: number,
  blockingLeader: SimVehicle | null
): void {
  if (
    v.vClass !== 'car' || v.turn !== 'straight' || light !== 'green' || config.lanesPerDirection < 2 ||
    v.distanceAlongPath >= v.stopLineDist - 25 || Math.abs(v.lateralOffset) >= 0.25 ||
    !blockingLeader || nearestGap >= 12.0 || blockingLeader.speed >= desiredV - 1.5 || v.speed <= 4.0
  ) {
    return;
  }

  for (const newLane of [v.laneIndex - 1, v.laneIndex + 1]) {
    if (newLane < 0 || newLane >= config.lanesPerDirection) continue;
    const center = getGlobalLat(newLane, 0, lw);
    let clear = true;
    for (const other of vehicles) {
      if (other.id === v.id || other.originArm !== v.originArm) continue;
      const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, lw);
      const minLatClear = (v.width + effClearanceWidth(other)) * 0.5 + 0.35;
      if (Math.abs(otherLat - center) < minLatClear || Math.abs(otherTargetLat - center) < minLatClear) {
        const rel = other.distanceAlongPath - v.distanceAlongPath;
        if (rel > -8.0 && rel < 22.0) { clear = false; break; }
      }
    }
    if (clear) {
      const old = v.laneIndex;
      v.laneIndex = newLane;
      v.path = pathCache[v.originArm][v.turn][newLane];
      v.stopLineDist = v.path.stopLineDist;
      v.exitLineDist = v.path.exitLineDist;
      v.totalPathLength = v.path.totalPathLength;
      v.lateralOffset += (old - newLane) * lw;
      v.targetLateralOffset = 0;
      v.laneChangeDir = newLane > old ? 'left' : 'right';
      return;
    }
  }
}
