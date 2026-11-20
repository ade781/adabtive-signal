import { DriverProfile, QUEUE_SPEED_THRESHOLD } from './constants';
import { WeatherPhysicsProfile } from './environmentDynamics';
import { PathCache } from './geometry';
import { SpatialHashGrid } from './spatialHash';
import { predictSweptCollisionTTC } from './steeringAI';
import { CompiledMovementPath, CompiledTopology } from './topologyTypes';
import { SignalColor, SimConfig, Vehicle, VehicleClass } from './types';

export interface SimVehicle extends Vehicle {
  path: PathCache['north']['straight'][number];
  compiledPath?: CompiledMovementPath;
  pathKey?: string;
  targetLateralOffset: number;
  lateralVelocity: number;
  steerAngle?: number;
  speedFactor: number;
  accelFactor: number;
  profile: DriverProfile;
  reactionTimer: number;
  prevAccel?: number;
  boxWaitTime?: number;
  willRunRed?: boolean;
  yellowCommitted?: boolean;
  respectsYellowBox?: boolean;
  stopCreepMeters?: number;
  laneChangeCooldown?: number;
  overtakeTargetId?: number;
  overtakeTimer?: number;
}

export function getGlobalLat(laneIndex: number, lateralOffset: number, lw: number, laneCenters?: readonly number[]): number {
  if (laneCenters && laneIndex >= 0 && laneIndex < laneCenters.length) {
    return laneCenters[laneIndex] + lateralOffset;
  }
  return (laneIndex + 0.5) * lw + lateralOffset;
}

export function effClearanceWidth(v: { vClass: VehicleClass; width: number }): number {
  return v.vClass === 'motor' ? 0.72 : v.width;
}

export function canFilterSideBySide(vW: number, oW: number, roadW: number): boolean {
  return roadW >= (vW < 1 ? 0.72 : vW) + (oW < 1 ? 0.72 : oW) + 0.25;
}

export function assignReactionWave(
  vehicles: SimVehicle[],
  arm: string,
  lanes: number,
  reactionMult = 1.0
): void {
  for (let lane = 0; lane < lanes; lane++) {
    const queued = vehicles
      .filter(
        (v) =>
          v.originArm === arm &&
          v.laneIndex === lane &&
          !v.isSlipLane &&
          v.distanceAlongPath < v.stopLineDist &&
          v.speed < QUEUE_SPEED_THRESHOLD
      )
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
      const own = (base * scale + Math.min(5, rowIdx) * 0.04) * reactionMult;
      v.reactionTimer = rowIdx === 0 ? own : Math.max(prev + (sameRowSideBySide ? 0 : 0.04 * reactionMult), own);
      if (!sameRowSideBySide) {
        prev = v.reactionTimer;
        prevDist = v.distanceAlongPath;
      }
    }
  }
}

export function findBlockingLeader(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  lw: number,
  topology?: CompiledTopology,
  spatialHash?: SpatialHashGrid,
  weather?: WeatherPhysicsProfile,
  queryBuf?: SimVehicle[]
): { nearestGap: number; leadSpeed: number; blockingLeader: SimVehicle | null; isSqueezingPast: boolean } {
  let nearestGap = Infinity;
  let leadSpeed = v.maxSpeed;
  let blockingLeader: SimVehicle | null = null;
  let isSqueezingPast = false;

  const originArmGeom = topology?.armsById[v.originArm];
  const myLaneCenters = originArmGeom?.inLaneCenters;
  const myGlobalLat = getGlobalLat(v.laneIndex, v.lateralOffset, lw, myLaneCenters);
  const myEffW = effClearanceWidth(v);
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  const sightDist = weather?.sightDistance ?? 48;

  const vInsideBox = v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 && !v.hasExitedIntersection;
  const vInOncomingPass = Boolean(v.overtakeState && v.overtakeState !== 'none');

  // Use spatial hash for O(k) nearby scan when available; fallback to full vehicles scan
  const candidates: readonly SimVehicle[] =
    spatialHash && queryBuf ? spatialHash.queryRadius(v.x, v.y, sightDist, queryBuf) : vehicles;

  for (let i = 0; i < candidates.length; i++) {
    const other = candidates[i];
    if (other.id === v.id) continue;

    const otherEffW = effClearanceWidth(other);
    const pad = v.vClass === 'motor' || other.vClass === 'motor' ? 0.06 : 0.3;
    const minLatNeed = (myEffW + otherEffW) * 0.5 + pad;
    const otherInOncoming = Boolean(other.overtakeState && other.overtakeState !== 'none');

    // Fast 1D approach-lane check (same originArm, both upstream of stopLine, neither crossing centerline)
    if (
      !v.isSlipLane &&
      !other.isSlipLane &&
      !vInOncomingPass &&
      !otherInOncoming &&
      v.distanceAlongPath < v.stopLineDist - 2.0 &&
      other.originArm === v.originArm &&
      other.distanceAlongPath < other.stopLineDist - 0.5
    ) {
      if (other.distanceAlongPath <= v.distanceAlongPath) continue;
      const otherGlobalLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw, myLaneCenters);
      const otherPredLat = getGlobalLat(other.laneIndex, other.lateralOffset + other.lateralVelocity * 0.25, lw, myLaneCenters);
      const myPredLat = getGlobalLat(
        v.laneIndex,
        v.vClass !== 'motor' ? v.targetLateralOffset : v.lateralOffset + v.lateralVelocity * 0.25,
        lw,
        myLaneCenters
      );
      const latSep = Math.min(
        Math.abs(myGlobalLat - otherGlobalLat),
        Math.abs(myGlobalLat - otherPredLat),
        Math.abs(myPredLat - otherGlobalLat),
        Math.abs(myPredLat - otherPredLat)
      );
      const turningAway =
        (other.turn === 'left' && otherGlobalLat >= myGlobalLat) ||
        (other.turn === 'right' && otherGlobalLat <= myGlobalLat) ||
        (v.turn === 'left' && myGlobalLat >= otherGlobalLat) ||
        (v.turn === 'right' && myGlobalLat <= otherGlobalLat);
      const longOverlap = other.distanceAlongPath - v.distanceAlongPath < (v.length + other.length) * 0.5;
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
        ((!crossingTurnInLane && !sameTurnTightCurve) ||
          (longOverlap && (!sameTurnTightCurve || other.distanceAlongPath - v.distanceAlongPath < 0.3)))
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
      continue;
    }

    // 2D OBB check applies for:
    // - Vehicles near/inside box or on exit leg
    // - Slip-lane & U-turn vehicles
    // - Vehicles actively performing or facing oncoming-lane overtaking!
    const needs2DCheck =
      vInOncomingPass ||
      otherInOncoming ||
      v.isSlipLane ||
      other.isSlipLane ||
      v.isUTurn ||
      other.isUTurn ||
      other.originArm === v.originArm ||
      (other.destArm === v.destArm &&
        (vInsideBox
          ? other.distanceAlongPath >= other.exitLineDist - 2.0 ||
          other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.05
          : other.distanceAlongPath >= other.stopLineDist - 2.0 || v.distanceAlongPath >= v.stopLineDist - 14.0)) ||
      (vInsideBox
        ? other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.3 &&
        other.distanceAlongPath - other.length * 0.5 < other.exitLineDist
        : v.distanceAlongPath >= v.stopLineDist - 15.0 &&
        other.distanceAlongPath >= other.stopLineDist - 0.5 &&
        other.distanceAlongPath - other.length * 0.5 < other.exitLineDist);

    if (!needs2DCheck) continue;

    // Same-arm, same-turn, same-lane exact arc-length curve following (unless overtaking into oncoming lane)
    if (
      !vInOncomingPass &&
      !otherInOncoming &&
      other.originArm === v.originArm &&
      other.turn === v.turn &&
      other.laneIndex === v.laneIndex &&
      Boolean(other.isSlipLane) === Boolean(v.isSlipLane)
    ) {
      if (other.distanceAlongPath > v.distanceAlongPath) {
        const otherCurLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw, myLaneCenters);
        const otherPredLat = getGlobalLat(other.laneIndex, other.lateralOffset + other.lateralVelocity * 0.25, lw, myLaneCenters);
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
    if (dx * dx + dy * dy > sightDist * sightDist) continue;

    const forwardProj = dx * cosH + dy * sinH;
    const latProj = Math.abs(-dx * sinH + dy * cosH);

    // Main-road traffic has strict right-of-way over a slip-lane vehicle whose front bumper is still behind its merge yield line
    if (
      !v.isSlipLane &&
      other.isSlipLane &&
      other.distanceAlongPath + other.length * 0.5 < other.exitLineDist - 0.8 &&
      (other.isYielding || other.speed < 0.8) &&
      latProj > (myEffW + otherEffW) * 0.5 + 0.15
    ) {
      continue;
    }

    // Project other's oriented bounding box onto v's local forward & lateral axes
    const cosO = Math.cos(other.heading);
    const sinO = Math.sin(other.heading);
    const dotCos = cosO * cosH + sinO * sinH;
    const dotSin = -sinO * cosH + cosO * sinH;
    const otherProjLen = Math.abs(dotCos) * (other.length * 0.5) + Math.abs(dotSin) * (otherEffW * 0.5);
    const otherProjLat = Math.abs(-cosO * sinH + sinO * cosH) * (other.length * 0.5) + Math.abs(sinO * sinH + cosO * cosH) * (otherEffW * 0.5);

    const otherCurLatBox = getGlobalLat(other.laneIndex, other.lateralOffset, lw, myLaneCenters);
    const turningAwayBox =
      other.originArm === v.originArm &&
      ((other.turn === 'left' && otherCurLatBox >= myGlobalLat) ||
        (other.turn === 'right' && otherCurLatBox <= myGlobalLat) ||
        (v.turn === 'left' && myGlobalLat >= otherCurLatBox) ||
        (v.turn === 'right' && myGlobalLat <= otherCurLatBox));
    const crossingTurnSameLane =
      !vInOncomingPass &&
      !otherInOncoming &&
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
    const sameArmBottleneckMerge =
      other.originArm === v.originArm &&
      other.destArm === v.destArm &&
      other.laneIndex !== v.laneIndex &&
      other.destLaneIndex !== undefined &&
      other.destLaneIndex === v.destLaneIndex &&
      v.distanceAlongPath > v.stopLineDist - 6.0 &&
      !v.hasExitedIntersection;
    const mergePad =
      (other.originArm !== v.originArm && other.destArm === v.destArm) || sameArmBottleneckMerge
        ? Math.max(pad, sameArmBottleneckMerge ? 0.95 : 0.45)
        : pad;

    // Predictive swept collision check strictly for MOVING cross-traffic inside/entering the intersection box
    let sweptConflict = false;
    const otherInsideBox =
      other.distanceAlongPath + other.length * 0.5 > other.stopLineDist - 1.0 &&
      other.distanceAlongPath - other.length * 0.5 < other.exitLineDist;
    if (
      vInsideBox &&
      otherInsideBox &&
      other.originArm !== v.originArm &&
      other.speed > 1.2 &&
      Math.abs(dotCos) < 0.65 &&
      forwardProj > 0.5 &&
      forwardProj < 14
    ) {
      const pred = predictSweptCollisionTTC(v, other, 0.85);
      if (pred.willCollide && pred.ttc < 0.8) {
        sweptConflict = true;
      }
    }

    if (!crossingTurnSameLane && !sweptConflict && latProj >= myEffW * 0.5 + otherProjLat + tailSwingPad + mergePad) {
      continue;
    }

    const gapAlong = forwardProj - (v.length * 0.5 + otherProjLen);
    const minForwardProj =
      other.originArm === v.originArm && v.vClass === 'heavy' && v.turn !== 'straight' && v.distanceAlongPath > v.stopLineDist
        ? -v.length * 0.25
        : 0;
    if (forwardProj <= minForwardProj) continue;

    if (gapAlong < nearestGap) {
      const notOverlapping = gapAlong > -0.35 || latProj >= myEffW * 0.5 + otherProjLat - 0.1;
      if (
        (vInsideBox || v.hasExitedIntersection) &&
        notOverlapping &&
        other.originArm !== v.originArm &&
        v.speed < 0.8 &&
        other.speed < 0.4 &&
        ((v.boxWaitTime ?? 0) >= 0.9 || (other.boxWaitTime ?? 0) >= 0.9)
      ) {
        // Non-slip main traffic has priority over slip-lane mergers that haven't merged past their yield line yet
        if (!v.isSlipLane && other.isSlipLane && other.distanceAlongPath + other.length * 0.5 < other.exitLineDist - 0.3) {
          continue;
        }
        const vRem = v.exitLineDist - v.distanceAlongPath;
        const oRem = other.exitLineDist - other.distanceAlongPath;
        if (vRem < oRem - 0.5 || (Math.abs(vRem - oRem) <= 0.5 && v.id < other.id)) {
          continue;
        }
      }
      if (
        vInsideBox &&
        notOverlapping &&
        (v.boxWaitTime ?? 0) >= 0.8 &&
        other.originArm === v.originArm &&
        (other.turn !== v.turn || other.laneIndex !== v.laneIndex) &&
        other.speed <= 0.4 &&
        (v.distanceAlongPath > other.distanceAlongPath + 0.1 ||
          (Math.abs(v.distanceAlongPath - other.distanceAlongPath) <= 0.1 && v.id > other.id))
      ) {
        continue;
      }
      nearestGap = Math.max(0.05, gapAlong);
      const crossYieldSpeed =
        dotCos < -0.45
          ? 0 // Opposing vehicle in our corridor: treat as zero/head-on hazard!
          : other.originArm !== v.originArm && other.destArm === v.destArm
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

  return { nearestGap, leadSpeed, blockingLeader, isSqueezingPast };
}

export function updateMotorcycleSeepage(
  v: SimVehicle,
  vehicles: readonly SimVehicle[],
  config: SimConfig,
  topology: CompiledTopology,
  lw: number,
  roadW: number,
  desiredV: number,
  nearestGap: number,
  blockingLeader: SimVehicle | null,
  weather?: WeatherPhysicsProfile
): void {
  if (v.overtakeState && v.overtakeState !== 'none') return;
  if (v.isSlipLane || v.isUTurn) return;

  const armGeom = topology.armsById[v.originArm];
  if (!armGeom) return;

  const inLanes = armGeom.def.inLanes;
  const laneCenters = armGeom.inLaneCenters;
  const halfMedian = armGeom.halfMedian;
  const armInWidth = armGeom.inWidth;
  const armLw = armGeom.def.inLaneWidths[v.laneIndex] ?? lw;
  const seepageScale = weather?.seepageScale ?? 1.0;

  const myEffW = effClearanceWidth(v);
  const myGlobalLat = getGlobalLat(v.laneIndex, v.lateralOffset, armLw, laneCenters);

  // Re-center turning motorcycles smoothly just before stop line
  if (v.turn !== 'straight' && v.distanceAlongPath >= v.stopLineDist - 5.0 && v.distanceAlongPath <= v.stopLineDist) {
    const centerLat = getGlobalLat(v.laneIndex, 0, armLw, laneCenters);
    const bandMin = Math.min(myGlobalLat, centerLat);
    const bandMax = Math.max(myGlobalLat, centerLat);
    for (const other of vehicles) {
      if (other.id === v.id || other.originArm !== v.originArm) continue;
      const longDiff = other.distanceAlongPath - v.distanceAlongPath;
      const minRearNeed =
        longDiff < 0 && other.speed > v.speed
          ? Math.pow(other.speed - v.speed, 2) / (2 * other.comfortDecel) + 2.0
          : 2.5;
      if (Math.abs(longDiff) < (v.length + other.length) * 0.5 + minRearNeed) {
        const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, armLw, laneCenters);
        const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, armLw, laneCenters);
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

  // Heavy rain suppresses tight motorcycle weaving
  const maxTriggerGap = 24.0 * seepageScale;
  if (
    seepageScale < 0.45 && v.speed > 3.5 ||
    !blockingLeader ||
    nearestGap >= maxTriggerGap ||
    (v.distanceAlongPath >= v.stopLineDist - 20.0 && v.laneIndex === blockingLeader.laneIndex && v.turn !== blockingLeader.turn) ||
    (blockingLeader.speed >= desiredV - 0.8 && blockingLeader.speed >= 3.5) ||
    !canFilterSideBySide(
      v.width,
      blockingLeader.width,
      v.turn === 'straight' && inLanes >= 2 ? armInWidth : armLw
    )
  ) {
    return;
  }

  const minLane = v.turn === 'straight' ? Math.max(0, v.laneIndex - 1) : v.laneIndex;
  const maxLane = v.turn === 'straight' ? Math.min(inLanes - 1, v.laneIndex + 1) : v.laneIndex;
  const minLaneEdge = halfMedian + armGeom.def.inLaneWidths.slice(0, minLane).reduce((s, w) => s + w, 0);
  const maxLaneEdge = halfMedian + armGeom.def.inLaneWidths.slice(0, maxLane + 1).reduce((s, w) => s + w, 0);
  const minBound = Math.max(halfMedian + 0.42, minLaneEdge + 0.42);
  const maxBound = Math.min(halfMedian + Math.max(roadW, armInWidth) - 0.42, maxLaneEdge - 0.42);
  const leadEffW = effClearanceWidth(blockingLeader);
  const leadGlobalLat = getGlobalLat(blockingLeader.laneIndex, blockingLeader.lateralOffset, armLw, laneCenters);

  const weatherPadExtra = (1 - seepageScale) * 0.25;
  const raw: number[] = [];
  if (v.turn === 'left') {
    raw.push(leadGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12 + weatherPadExtra, maxBound);
  } else if (v.turn === 'right') {
    raw.push(leadGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12 - weatherPadExtra, minBound);
  } else {
    let divider = halfMedian;
    for (let l = 0; l < inLanes - 1; l++) {
      divider += armGeom.def.inLaneWidths[l];
      if (l + 1 >= minLane && l + 1 <= maxLane) raw.push(divider);
    }
    raw.push(
      leadGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12 - weatherPadExtra,
      leadGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12 + weatherPadExtra,
      maxBound,
      minBound
    );
    if (config.motorSwarmMode && seepageScale >= 0.6) {
      for (let c = halfMedian + 0.42; c <= halfMedian + armInWidth - 0.42 + 1e-6; c += 0.85) {
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
      const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, armLw, laneCenters);
      const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, armLw, laneCenters);
      const pad = (myEffW + effClearanceWidth(other)) * 0.5 + 0.12 + weatherPadExtra;
      const halfSumLen = (v.length + other.length) * 0.5;
      const longDiff = other.distanceAlongPath - v.distanceAlongPath;

      if (Math.abs(longDiff) < halfSumLen + 1.2) {
        if (
          (otherLat >= bandMin - pad && otherLat <= bandMax + pad) ||
          (otherTargetLat >= bandMin - pad && otherTargetLat <= bandMax + pad)
        ) {
          clear = false;
          break;
        }
      } else if (longDiff > 0 && (Math.abs(cand - otherLat) < pad || Math.abs(cand - otherTargetLat) < pad)) {
        const gap = longDiff - halfSumLen;
        if (gap < 4.5 || (v.speed > other.speed + 1.5 && gap < (v.speed - other.speed) * 1.4)) {
          clear = false;
          break;
        }
        forwardClear = Math.min(forwardClear, gap);
      } else if (longDiff < 0 && other.speed > v.speed && (Math.abs(cand - otherLat) < pad || Math.abs(cand - otherTargetLat) < pad)) {
        const rearGap = -longDiff - halfSumLen;
        const dv = other.speed - v.speed;
        const effOtherDecel = Math.max(1.0, other.comfortDecel * (weather?.comfortDecelMult ?? 1.0));
        const kinStop = (dv * dv) / (2 * effOtherDecel) + other.minGap;
        if (rearGap < Math.max(3.0, dv * 1.4, kinStop)) {
          clear = false;
          break;
        }
      }
    }

    if (clear && forwardClear > bestForwardDist) {
      bestForwardDist = forwardClear;
      bestCand = cand;
    }
  }

  if (bestCand !== null && bestForwardDist > nearestGap + 1.5) {
    if (v.turn === 'straight' && inLanes >= 2) {
      // Find which lane owns bestCand
      let targetLane = v.laneIndex;
      let cursor = halfMedian;
      for (let l = 0; l < inLanes; l++) {
        cursor += armGeom.def.inLaneWidths[l];
        if (bestCand <= cursor || l === inLanes - 1) {
          targetLane = l;
          break;
        }
      }
      if (targetLane !== v.laneIndex) {
        const old = v.laneIndex;
        const nextCompiled = topology.pathLookup[v.originArm]?.[v.turn]?.[targetLane];
        if (nextCompiled) {
          const oldCenter = laneCenters[old];
          const newCenter = laneCenters[targetLane];
          v.laneIndex = targetLane;
          v.destLaneIndex = nextCompiled.destLane;
          v.pathKey = nextCompiled.key;
          v.compiledPath = nextCompiled;
          v.path = {
            turn: 'straight',
            stopLineDist: nextCompiled.stopLineDist,
            exitLineDist: nextCompiled.exitLineDist,
            totalPathLength: nextCompiled.totalPathLength,
            sample: (d) => nextCompiled.sample(d),
          };
          v.stopLineDist = nextCompiled.stopLineDist;
          v.exitLineDist = nextCompiled.exitLineDist;
          v.totalPathLength = nextCompiled.totalPathLength;
          v.lateralOffset += oldCenter - newCenter;
          v.laneChangeDir = targetLane > old ? 'left' : 'right';
        }
      }
    }
    v.targetLateralOffset = bestCand - laneCenters[v.laneIndex];
  }
}
