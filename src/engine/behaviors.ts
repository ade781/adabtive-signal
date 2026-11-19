import { PathCache } from './geometry';
import { DriverProfile, QUEUE_SPEED_THRESHOLD } from './constants';
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
  boxWaitTime?: number;
  willRunRed?: boolean;
  yellowCommitted?: boolean;
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
      .filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD)
      .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);

    let prev = 0;
    let prevDist = Infinity;
    let rowIdx = 0;
    for (let i = 0; i < queued.length; i++) {
      const v = queued[i];
      const sameRowSideBySide =
        i > 0 &&
        v.vClass === 'motor' &&
        Math.abs(prevDist - v.distanceAlongPath) < 1.2;
      if (i > 0 && !sameRowSideBySide) {
        rowIdx++;
      }
      const base = v.vClass === 'motor' ? 0.04 : v.vClass === 'car' ? 0.1 : 0.18;
      const scale = v.profile === 'aggressive' ? 0.7 : v.profile === 'cautious' ? 1.2 : 1.0;
      const own = base * scale + Math.min(5, rowIdx) * 0.04;
      v.reactionTimer = rowIdx === 0 ? own : Math.max(prev + (sameRowSideBySide ? 0 : 0.04), own);
      if (!sameRowSideBySide) {
        prev = v.reactionTimer;
        prevDist = v.distanceAlongPath;
      }
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

  const vInsideBox = v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 && !v.hasExitedIntersection;

  for (const other of vehicles) {
    if (other.id === v.id) continue;
    const otherEffW = effClearanceWidth(other);
    const pad = v.vClass === 'motor' || other.vClass === 'motor' ? 0.06 : 0.3;
    const minLatNeed = (myEffW + otherEffW) * 0.5 + pad;

    if (v.distanceAlongPath < v.stopLineDist - 2.0 && other.originArm === v.originArm && other.distanceAlongPath < other.stopLineDist - 0.5) {
      if (other.distanceAlongPath <= v.distanceAlongPath) continue;
      const otherGlobalLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const otherPredLat = getGlobalLat(other.laneIndex, other.lateralOffset + other.lateralVelocity * 0.25, lw);
      const latSep = Math.min(Math.abs(myGlobalLat - otherGlobalLat), Math.abs(myGlobalLat - otherPredLat));
      const turningAway =
        (other.turn === 'left' && otherGlobalLat >= myGlobalLat) ||
        (other.turn === 'right' && otherGlobalLat <= myGlobalLat) ||
        (v.turn === 'left' && myGlobalLat >= otherGlobalLat) ||
        (v.turn === 'right' && myGlobalLat <= otherGlobalLat);
      const longOverlap = other.distanceAlongPath - v.distanceAlongPath < (v.length + other.length) * 0.5;
      // Do not squeeze alongside a vehicle in the same lane with a different turn approaching the intersection
      const crossingTurnInLane =
        v.distanceAlongPath >= v.stopLineDist - 20.0 &&
        v.laneIndex === other.laneIndex &&
        v.turn !== other.turn &&
        !turningAway;
      const sameTurnTightCurve =
        v.distanceAlongPath >= v.stopLineDist - 12.0 &&
        v.laneIndex === other.laneIndex &&
        v.turn !== 'straight' &&
        v.turn === other.turn &&
        (v.vClass !== 'motor' || other.vClass !== 'motor');
      const tailSwingPad1 =
        other.vClass === 'heavy' &&
        other.turn !== 'straight' &&
        other.distanceAlongPath > other.stopLineDist - 4.0 &&
        other.speed > 0.2
          ? 0.85
          : 0;
      if (
        latSep >= minLatNeed + tailSwingPad1 &&
        ((!crossingTurnInLane && !sameTurnTightCurve) || (longOverlap && (!sameTurnTightCurve || other.distanceAlongPath - v.distanceAlongPath < 0.3)))
      ) {
        if (v.vClass === 'motor' && latSep < minLatNeed + 0.45 && Math.abs(other.distanceAlongPath - v.distanceAlongPath) < 4.5) {
          isSqueezingPast = true;
        }
        continue;
      }
      if (longOverlap && latSep >= minLatNeed + tailSwingPad1 && !sameTurnTightCurve) continue;
      const gapAlong = other.distanceAlongPath - v.distanceAlongPath - (other.length + v.length) * 0.5;
      if (gapAlong < nearestGap) {
        nearestGap = Math.max(0.05, gapAlong);
        leadSpeed = other.speed;
        blockingLeader = other;
      }
    } else if (
      other.originArm === v.originArm ||
      (other.destArm === v.destArm &&
        (vInsideBox
          ? other.distanceAlongPath >= other.exitLineDist - 2.0 ||
            other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.05
          : other.distanceAlongPath >= other.stopLineDist - 2.0 || v.distanceAlongPath >= v.stopLineDist - 14.0)) ||
      (vInsideBox
        ? other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.3 && other.distanceAlongPath - other.length * 0.5 < other.exitLineDist
        : v.distanceAlongPath >= v.stopLineDist - 15.0 &&
          other.distanceAlongPath >= other.stopLineDist - 0.5 &&
          other.distanceAlongPath - other.length * 0.5 < other.exitLineDist)
    ) {
      // Same-arm, same-turn curve following: arc-length gap remains exact even across 90-degree Bezier bends.
      // Also skip vehicles behind/beside on the same turn so they never fall through to rotated 2D OBB.
      if (other.originArm === v.originArm && other.turn === v.turn && other.laneIndex === v.laneIndex) {
        if (other.distanceAlongPath > v.distanceAlongPath) {
          const otherCurLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
          const otherPredLat = getGlobalLat(other.laneIndex, other.lateralOffset + other.lateralVelocity * 0.25, lw);
          const rawLatSep = Math.min(Math.abs(myGlobalLat - otherCurLat), Math.abs(myGlobalLat - otherPredLat));
          const turnScale =
            v.turn !== 'straight' && v.laneIndex === other.laneIndex
              ? v.vClass === 'motor' && other.vClass === 'motor'
                ? 0.35
                : 0.5
              : 1.0;
          const latSep = rawLatSep * turnScale;
          if (latSep < minLatNeed) {
            const arcGap = other.distanceAlongPath - v.distanceAlongPath - (other.length + v.length) * 0.5;
            if (arcGap < 45 && arcGap < nearestGap) {
              nearestGap = Math.max(0.05, arcGap);
              leadSpeed = other.speed;
              blockingLeader = other;
            }
          }
        }
        continue;
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

      const otherCurLatBox = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const turningAwayBox =
        other.originArm === v.originArm &&
        ((other.turn === 'left' && otherCurLatBox >= myGlobalLat) ||
          (other.turn === 'right' && otherCurLatBox <= myGlobalLat) ||
          (v.turn === 'left' && myGlobalLat >= otherCurLatBox) ||
          (v.turn === 'right' && myGlobalLat <= otherCurLatBox));
      const crossingTurnSameLane =
        v.distanceAlongPath < v.stopLineDist + 2.0 &&
        other.distanceAlongPath < other.stopLineDist + 4.0 &&
        other.originArm === v.originArm &&
        v.laneIndex === other.laneIndex &&
        v.turn !== other.turn &&
        (!turningAwayBox || Math.abs(otherCurLatBox - myGlobalLat) < minLatNeed + 0.3) &&
        other.distanceAlongPath > v.distanceAlongPath;
      const tailSwingPad =
        other.vClass === 'heavy' &&
        other.turn !== 'straight' &&
        other.originArm === v.originArm &&
        other.distanceAlongPath > other.stopLineDist - 4.0 &&
        other.distanceAlongPath <= other.exitLineDist
          ? 1.05
          : 0;
      const mergePad = other.originArm !== v.originArm && other.destArm === v.destArm ? Math.max(pad, 0.45) : pad;
      if (!crossingTurnSameLane && latProj >= myEffW * 0.5 + otherProjLat + tailSwingPad + mergePad) continue;
      const gapAlong = forwardProj - (v.length * 0.5 + otherProjLen);
      const minForwardProj =
        other.originArm === v.originArm && v.vClass === 'heavy' && v.turn !== 'straight' && v.distanceAlongPath > v.stopLineDist
          ? -v.length * 0.25
          : 0;
      if (forwardProj <= minForwardProj) continue;

      if (gapAlong < nearestGap) {
        const notOverlapping = gapAlong > 0 || latProj >= myEffW * 0.5 + otherProjLat - 0.05;
        if (
          vInsideBox &&
          notOverlapping &&
          other.originArm !== v.originArm &&
          other.destArm !== v.destArm &&
          v.speed < 0.8 &&
          other.speed < 0.4 &&
          ((v.boxWaitTime ?? 0) >= 1.0 || (other.boxWaitTime ?? 0) >= 1.0)
        ) {
          const vRem = v.exitLineDist - v.distanceAlongPath;
          const oRem = other.exitLineDist - other.distanceAlongPath;
          if (vRem < oRem - 0.5 || (Math.abs(vRem - oRem) <= 0.5 && v.id < other.id)) {
            continue;
          }
        }
        if (
          vInsideBox &&
          (v.boxWaitTime ?? 0) >= 0.8 &&
          other.originArm === v.originArm &&
          other.turn !== v.turn &&
          other.speed <= 0.4 &&
          (v.distanceAlongPath > other.distanceAlongPath + 0.1 ||
            (Math.abs(v.distanceAlongPath - other.distanceAlongPath) <= 0.1 && v.id > other.id))
        ) {
          continue;
        }
        nearestGap = Math.max(0.05, gapAlong);
        const crossYieldSpeed =
          other.originArm !== v.originArm && other.destArm === v.destArm
            ? Math.max(other.speed * 0.7, other.speed * dotCos)
            : other.originArm !== v.originArm && other.destArm !== v.destArm && other.speed > 2.5 && gapAlong > 2.0
            ? Math.max(other.speed * 0.45, other.speed * dotCos)
            : other.originArm !== v.originArm || other.turn !== v.turn
            ? Math.max(0, other.speed * dotCos)
            : other.speed;
        leadSpeed = crossYieldSpeed;
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

  if (v.turn !== 'straight' && v.distanceAlongPath >= v.stopLineDist - 5.0 && v.distanceAlongPath <= v.stopLineDist) {
    const centerLat = getGlobalLat(v.laneIndex, 0, lw);
    const bandMin = Math.min(myGlobalLat, centerLat);
    const bandMax = Math.max(myGlobalLat, centerLat);
    for (const other of vehicles) {
      if (other.id === v.id || other.originArm !== v.originArm) continue;
      const longDiff = other.distanceAlongPath - v.distanceAlongPath;
      const minRearNeed = longDiff < 0 && other.speed > v.speed ? Math.pow(other.speed - v.speed, 2) / (2 * other.comfortDecel) + 2.0 : 2.5;
      if (Math.abs(longDiff) < (v.length + other.length) * 0.5 + minRearNeed) {
        const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
        const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, lw);
        const minClear = (myEffW + effClearanceWidth(other)) * 0.5 + 0.35;
        if (
          (otherLat >= bandMin - minClear && otherLat <= bandMax + minClear) ||
          (otherTargetLat >= bandMin - minClear && otherTargetLat <= bandMax + minClear)
        ) {
          return;
        }
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

  const minLane = v.turn === 'straight' ? Math.max(0, v.laneIndex - 1) : v.laneIndex;
  const maxLane = v.turn === 'straight' ? Math.min(config.lanesPerDirection - 1, v.laneIndex + 1) : v.laneIndex;
  const minBound = Math.max(0.42, minLane * lw + 0.42);
  const maxBound = Math.min(roadW - 0.42, (maxLane + 1) * lw - 0.42);
  const leadEffW = effClearanceWidth(blockingLeader);
  const leadGlobalLat = getGlobalLat(blockingLeader.laneIndex, blockingLeader.lateralOffset, lw);

  const raw: number[] = [];
  if (v.turn === 'left') {
    // Left-turning motorcycles weave strictly along the left (outer/curb) side so they don't cut from the middle
    raw.push(leadGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12, maxBound);
  } else if (v.turn === 'right') {
    // Right-turning motorcycles weave strictly along the right (inner/median) side
    raw.push(leadGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12, minBound);
  } else {
    for (let l = Math.max(1, minLane); l <= maxLane; l++) raw.push(l * lw);
    raw.push(leadGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12, leadGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12, maxBound, minBound);
    if (config.motorSwarmMode) {
      for (let c = 0.42; c <= roadW - 0.42 + 1e-6; c += 0.85) {
        raw.push(c);
      }
    }
  }

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
      } else if (longDiff < 0 && other.speed > v.speed && (Math.abs(cand - otherLat) < pad || Math.abs(cand - otherTargetLat) < pad)) {
        const rearGap = -longDiff - halfSumLen;
        const dv = other.speed - v.speed;
        const kinStop = (dv * dv) / (2 * other.comfortDecel) + other.minGap;
        if (rearGap < Math.max(3.0, dv * 1.4, kinStop)) {
          clear = false; break;
        }
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
    let newLaneForwardGap = v.stopLineDist - v.distanceAlongPath;
    for (const other of vehicles) {
      if (other.id === v.id || other.originArm !== v.originArm) continue;
      const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, lw);
      const minLatClear = (v.width + effClearanceWidth(other)) * 0.5 + 0.35;
      if (Math.abs(otherLat - center) < minLatClear || Math.abs(otherTargetLat - center) < minLatClear) {
        const rel = other.distanceAlongPath - v.distanceAlongPath;
        const rearSafetyGap = Math.max(8.0, (other.speed - v.speed) * 1.8 + (v.length + other.length) * 0.5);
        if (rel > -rearSafetyGap && rel < 22.0) { clear = false; break; }
        if (rel > 0) {
          newLaneForwardGap = Math.min(newLaneForwardGap, rel - (v.length + other.length) * 0.5);
        }
      }
    }
    if (clear && newLaneForwardGap > nearestGap + 2.0) {
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
