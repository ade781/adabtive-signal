import {
  assignReactionWave,
  effClearanceWidth,
  findBlockingLeader,
  getGlobalLat,
  SimVehicle,
  tryCarLaneChange,
  updateMotorcycleSeepage,
} from './behaviors';
import { ARM_ORDER, DEFAULT_CONFIG, DriverProfile, PROFILE_MULT, SPRITES, VEHICLE_SPECS } from './constants';
import {
  createPathCache,
  getDestArm,
  getEffectiveRoadWidth,
  getLaneWidth,
  getTurnRadius,
  PathCache,
  sampleWithLateralOffset,
} from './geometry';
import {
  ArmId,
  CycleRecord,
  PhaseRecord,
  SignalColor,
  SimConfig,
  SimSnapshot,
  TurnIntent,
  VehicleClass,
} from './types';

export { DEFAULT_CONFIG };

function normalizeConfig(raw: SimConfig): SimConfig {
  const lanes = Math.max(1, Math.min(4, Math.round(raw.lanesPerDirection)));
  const lw = Math.max(2.8, Math.min(4.2, +(raw.laneWidth ?? raw.roadWidthPerDirection / lanes).toFixed(2)));
  return { ...raw, lanesPerDirection: lanes, laneWidth: lw, roadWidthPerDirection: +(lanes * lw).toFixed(2) };
}

export class TrafficSimulation {
  private config: SimConfig;
  private pathCache: PathCache;
  private vehicles: SimVehicle[] = [];
  private nextVehicleId = 1;
  private armSpawnCursor = 0;

  private simTime = 0;
  private activeArmIndex = 0;
  private activeColor: SignalColor = 'green';
  private phaseRemaining = 0;
  private phaseElapsed = 0;
  private isAllRed = false;
  private cycleNumber = 1;
  private phaseCounter = 0;

  private spawnAccum = { motor: 0, car: 0, heavy: 0 };
  private currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };
  private currentCycleExited = { motor: 0, car: 0, heavy: 0, total: 0 };
  private currentCycleQueueSum = 0;
  private currentCycleSteps = 0;
  private totalExitedAllTime = 0;
  private phaseHistory: PhaseRecord[] = [];
  private cycleHistory: CycleRecord[] = [];

  constructor(initialConfig?: Partial<SimConfig>) {
    this.config = normalizeConfig({ ...DEFAULT_CONFIG, ...initialConfig });
    this.pathCache = createPathCache(this.config);
    this.reset();
  }

  public reset(): void {
    this.vehicles = [];
    this.nextVehicleId = 1;
    this.armSpawnCursor = 0;
    this.simTime = 0;
    this.activeArmIndex = 0;
    this.activeColor = 'green';
    this.isAllRed = false;
    this.phaseRemaining = Math.max(1, this.config.greenDuration);
    this.phaseElapsed = 0;
    this.cycleNumber = 1;
    this.phaseCounter = 0;
    this.spawnAccum = { motor: 0, car: 0, heavy: 0 };
    this.currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };
    this.currentCycleExited = { motor: 0, car: 0, heavy: 0, total: 0 };
    this.currentCycleQueueSum = 0;
    this.currentCycleSteps = 0;
    this.totalExitedAllTime = 0;
    this.phaseHistory = [];
    this.cycleHistory = [];
  }

  public updateConfig(partial: Partial<SimConfig>): void {
    const prev = this.config;
    this.config = normalizeConfig({ ...this.config, ...partial });

    if (prev.lanesPerDirection !== this.config.lanesPerDirection || prev.laneWidth !== this.config.laneWidth || prev.roadLength !== this.config.roadLength) {
      this.pathCache = createPathCache(this.config);
      const maxLane = Math.max(0, this.config.lanesPerDirection - 1);
      const lw = getLaneWidth(this.config);

      for (const v of this.vehicles) {
        v.laneIndex = Math.min(v.laneIndex, maxLane);
        if (v.vClass !== 'motor' || lw < 2.8) {
          v.lateralOffset = 0; v.targetLateralOffset = 0; v.lateralVelocity = 0; v.laneChangeDir = null;
        } else {
          const maxLat = lw * 0.27;
          v.lateralOffset = Math.max(-maxLat, Math.min(maxLat, v.lateralOffset));
          v.targetLateralOffset = Math.max(-maxLat, Math.min(maxLat, v.targetLateralOffset));
        }
        const newPath = this.pathCache[v.originArm][v.turn][v.laneIndex];
        const rel = v.totalPathLength > 0 ? v.distanceAlongPath / v.totalPathLength : 0;
        v.path = newPath;
        v.stopLineDist = newPath.stopLineDist;
        v.exitLineDist = newPath.exitLineDist;
        v.totalPathLength = newPath.totalPathLength;
        v.distanceAlongPath = Math.max(0, Math.min(newPath.totalPathLength, rel * newPath.totalPathLength));
        const pt = sampleWithLateralOffset(newPath, v.distanceAlongPath, v.lateralOffset, 0, v.speed);
        v.x = pt.x; v.y = pt.y; v.heading = pt.heading;
      }

      if (this.config.lanesPerDirection < prev.lanesPerDirection || this.config.roadLength < prev.roadLength) {
        const overflowIds = new Set<number>();
        for (const arm of ARM_ORDER) {
          for (let lane = 0; lane < this.config.lanesPerDirection; lane++) {
            const laneVehs = this.vehicles.filter((v) => v.originArm === arm && v.laneIndex === lane).sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
            let prevAllowed = Infinity;
            for (let i = 0; i < laneVehs.length; i++) {
              const cur = laneVehs[i];
              if (i > 0) {
                const lead = laneVehs[i - 1];
                const targetDist = Math.min(cur.distanceAlongPath, prevAllowed - ((lead.length + cur.length) * 0.5 + cur.minGap));
                if (targetDist < 0) { overflowIds.add(cur.id); continue; }
                cur.distanceAlongPath = targetDist;
                cur.speed = Math.min(cur.speed, lead.speed);
                const pt = sampleWithLateralOffset(cur.path, cur.distanceAlongPath, cur.lateralOffset, 0, cur.speed);
                cur.x = pt.x; cur.y = pt.y; cur.heading = pt.heading;
              }
              prevAllowed = cur.distanceAlongPath;
            }
          }
        }
        if (overflowIds.size > 0) this.vehicles = this.vehicles.filter((v) => !overflowIds.has(v.id));
      }
    }

    if (this.activeColor === 'green' && this.phaseRemaining > this.config.greenDuration) this.phaseRemaining = this.config.greenDuration;
    else if (this.activeColor === 'yellow' && this.phaseRemaining > this.config.yellowDuration) this.phaseRemaining = this.config.yellowDuration;
    else if (this.isAllRed && this.phaseRemaining > this.config.allRedDuration) this.phaseRemaining = this.config.allRedDuration;
  }

  public step(dt: number): void {
    const clampedDt = Math.min(0.1, Math.max(0.001, dt));
    this.simTime += clampedDt;
    this.advanceSignals(clampedDt);
    this.spawnVehicles(clampedDt);
    this.updateVehicles(clampedDt);
    this.currentCycleQueueSum += this.countQueue();
    this.currentCycleSteps += 1;
  }

  private advanceSignals(dt: number): void {
    this.phaseRemaining -= dt;
    this.phaseElapsed += dt;
    if (this.phaseRemaining > 0) return;

    const overflow = this.phaseRemaining;
    if (this.activeColor === 'green') {
      this.activeColor = 'yellow';
      this.phaseRemaining = Math.max(0.5, this.config.yellowDuration) + overflow;
      return;
    }
    if (this.activeColor === 'yellow' && !this.isAllRed && this.config.allRedDuration > 0.05) {
      this.activeColor = 'red';
      this.isAllRed = true;
      this.phaseRemaining = this.config.allRedDuration + overflow;
      return;
    }

    this.phaseCounter += 1;
    this.phaseHistory.unshift({
      phaseIndex: this.phaseCounter,
      cycleNumber: this.cycleNumber,
      arm: ARM_ORDER[this.activeArmIndex],
      greenDuration: this.config.greenDuration,
      exitedMotor: this.currentPhaseExited.motor,
      exitedCar: this.currentPhaseExited.car,
      exitedHeavy: this.currentPhaseExited.heavy,
      exitedTotal: this.currentPhaseExited.total,
    });
    if (this.phaseHistory.length > 24) this.phaseHistory.pop();
    this.currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };

    this.isAllRed = false;
    this.activeArmIndex = (this.activeArmIndex + 1) % ARM_ORDER.length;

    if (this.activeArmIndex === 0) {
      const avgQ = this.currentCycleSteps > 0 ? this.currentCycleQueueSum / this.currentCycleSteps : 0;
      const effAllRed = this.config.allRedDuration > 0.05 ? this.config.allRedDuration : 0;
      const cycleDur = (this.config.greenDuration + this.config.yellowDuration + effAllRed) * 4;
      this.cycleHistory.unshift({
        cycleNumber: this.cycleNumber,
        totalDuration: Math.round(cycleDur * 10) / 10,
        exitedMotor: this.currentCycleExited.motor,
        exitedCar: this.currentCycleExited.car,
        exitedHeavy: this.currentCycleExited.heavy,
        exitedTotal: this.currentCycleExited.total,
        avgQueue: Math.round(avgQ * 10) / 10,
      });
      if (this.cycleHistory.length > 16) this.cycleHistory.pop();
      this.cycleNumber += 1;
      this.currentCycleExited = { motor: 0, car: 0, heavy: 0, total: 0 };
      this.currentCycleQueueSum = 0;
      this.currentCycleSteps = 0;
    }

    this.activeColor = 'green';
    this.phaseRemaining = Math.max(1, this.config.greenDuration) + overflow;
    this.phaseElapsed = 0;
    assignReactionWave(this.vehicles, ARM_ORDER[this.activeArmIndex], this.config.lanesPerDirection);
  }

  private pickTurnIntent(): TurnIntent {
    const sum = Math.max(0, this.config.turnLeftPct) + Math.max(0, this.config.turnStraightPct) + Math.max(0, this.config.turnRightPct);
    if (sum <= 0) return 'straight';
    const roll = Math.random() * sum;
    if (roll < Math.max(0, this.config.turnLeftPct)) return 'left';
    if (roll < Math.max(0, this.config.turnLeftPct) + Math.max(0, this.config.turnStraightPct)) return 'straight';
    return 'right';
  }

  private pickLaneForTurn(arm: ArmId, turn: TurnIntent): number {
    const L = Math.max(1, this.config.lanesPerDirection);
    if (L === 1) return 0;
    if (turn === 'left') return L - 1;
    if (turn === 'right') return 0;
    let bestLane = 0, bestCount = Infinity;
    const startOffset = Math.floor(Math.random() * L);
    for (let i = 0; i < L; i++) {
      const lane = (startOffset + i) % L;
      const count = this.vehicles.filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist).length;
      if (count < bestCount) { bestCount = count; bestLane = lane; }
    }
    return bestLane;
  }

  private spawnVehicles(dt: number): void {
    const rates: [VehicleClass, number][] = [['motor', this.config.motorRate], ['car', this.config.carRate], ['heavy', this.config.heavyRate]];
    for (const [cls, rate] of rates) {
      if (rate <= 0) continue;
      this.spawnAccum[cls] += (rate / 60) * dt;
      while (this.spawnAccum[cls] >= 1) {
        if (this.trySpawnOne(cls)) this.spawnAccum[cls] -= 1;
        else { this.spawnAccum[cls] = Math.min(this.spawnAccum[cls], 2); break; }
      }
    }
  }

  private trySpawnOne(vClass: VehicleClass): boolean {
    const arm = ARM_ORDER[this.armSpawnCursor % ARM_ORDER.length];
    const turn = this.pickTurnIntent();
    const laneIndex = this.pickLaneForTurn(arm, turn);
    const spec = VEHICLE_SPECS[vClass];
    const lw = getLaneWidth(this.config);

    let lateralOffset = 0;
    if (vClass === 'motor' && lw >= 3.1) lateralOffset = Math.random() < 0.5 ? -lw * 0.27 : lw * 0.27;
    else if (vClass === 'car') lateralOffset = (Math.random() - 0.5) * 0.16;

    const myGlobalLat = getGlobalLat(laneIndex, lateralOffset, lw);
    const myEffW = vClass === 'motor' ? 0.72 : spec.width;
    const minClearance = spec.length + spec.minGap + 4.5;
    let nearestAheadSpeed = Infinity;

    for (const other of this.vehicles) {
      if (other.originArm !== arm) continue;
      const latSep = Math.abs(myGlobalLat - getGlobalLat(other.laneIndex, other.lateralOffset, lw));
      if (latSep < (myEffW + effClearanceWidth(other)) * 0.5 + 0.25) {
        if (other.distanceAlongPath < other.length * 0.5 + minClearance) return false;
        if (other.distanceAlongPath < 14) nearestAheadSpeed = Math.min(nearestAheadSpeed, other.speed);
      }
    }

    this.armSpawnCursor = (this.armSpawnCursor + 1) % ARM_ORDER.length;
    const r = Math.random();
    const profile: DriverProfile = r < 0.22 ? 'cautious' : r < 0.72 ? 'normal' : 'aggressive';
    const pMult = PROFILE_MULT[profile];
    const path = this.pathCache[arm][turn][laneIndex];
    const speedFactor = pMult.speed * (0.95 + Math.random() * 0.1);
    const accelFactor = pMult.accel * (0.95 + Math.random() * 0.1);
    const initialSpeed = Math.min(spec.maxSpeed * speedFactor * 0.65, nearestAheadSpeed + 1.5);
    const startPt = sampleWithLateralOffset(path, 0, lateralOffset, 0, initialSpeed);
    const sprites = SPRITES[vClass];

    this.vehicles.push({
      id: this.nextVehicleId++,
      vClass,
      spriteKey: sprites[Math.floor(Math.random() * sprites.length)],
      originArm: arm,
      destArm: getDestArm(arm, turn),
      turn,
      laneIndex,
      lateralOffset,
      targetLateralOffset: lateralOffset,
      lateralVelocity: 0,
      speedFactor,
      accelFactor,
      profile,
      reactionTimer: 0,
      laneChangeDir: null,
      ...spec,
      speed: initialSpeed,
      distanceAlongPath: 0,
      totalPathLength: path.totalPathLength,
      stopLineDist: path.stopLineDist,
      exitLineDist: path.exitLineDist,
      x: startPt.x,
      y: startPt.y,
      heading: startPt.heading,
      hasExitedIntersection: false,
      waitingTime: 0,
      path,
    });
    return true;
  }

  private getArmLight(arm: ArmId): SignalColor {
    return this.isAllRed ? 'red' : ARM_ORDER[this.activeArmIndex] === arm ? this.activeColor : 'red';
  }

  private isBoxOccupiedByOtherArm(myArm: ArmId): boolean {
    return this.vehicles.some((o) => o.originArm !== myArm && o.distanceAlongPath > o.stopLineDist + 2.0 && o.distanceAlongPath < o.exitLineDist - 2.0);
  }

  private updateVehicles(dt: number): void {
    const lw = getLaneWidth(this.config);
    const roadW = getEffectiveRoadWidth(this.config);
    const widthSpeedFactor = Math.max(0.84, Math.min(1.08, 0.84 + (lw - 2.8) * 0.1714));
    const widthHeadwayFactor = Math.max(0.92, Math.min(1.18, 1.18 - (lw - 2.8) * 0.1857));

    const decisions: { v: SimVehicle; nextSpeed: number; nextLat: number; nextLatVel: number }[] = [];

    for (const v of this.vehicles) {
      if (v.reactionTimer > 0) v.reactionTimer = Math.max(0, v.reactionTimer - dt);
      const light = this.getArmLight(v.originArm);

      let desiredV = v.maxSpeed * v.speedFactor * widthSpeedFactor;
      if (v.distanceAlongPath >= v.stopLineDist - 4 && v.distanceAlongPath <= v.exitLineDist) {
        const R = getTurnRadius(v.turn, v.laneIndex, this.config);
        if (Number.isFinite(R)) desiredV = Math.min(desiredV, Math.max(4.0, Math.sqrt((v.vClass === 'heavy' ? 1.35 : 2.2) * R)));
      }

      let { nearestGap, leadSpeed, blockingLeader, isSqueezingPast } = findBlockingLeader(v, this.vehicles, lw);

      const distToStop = v.stopLineDist - (v.distanceAlongPath + v.length * 0.5);
      if (distToStop > 0) {
        const stopForYellow = light === 'yellow' && distToStop > (v.speed * v.speed) / (2 * v.comfortDecel * (v.profile === 'aggressive' ? 1.65 : 1.3));
        const stopForBox = light === 'green' && distToStop < 12 && this.isBoxOccupiedByOtherArm(v.originArm);
        if ((light === 'red' || stopForYellow || stopForBox) && distToStop < nearestGap) {
          nearestGap = Math.max(0.1, distToStop);
          leadSpeed = 0;
        }
      }

      if (v.vClass === 'motor' && isSqueezingPast && leadSpeed < 2.5) desiredV = Math.min(desiredV, 4.8);
      if (v.vClass === 'motor') updateMotorcycleSeepage(v, this.vehicles, this.config, this.pathCache, lw, roadW, desiredV, nearestGap, blockingLeader);
      tryCarLaneChange(v, this.vehicles, this.config, this.pathCache, lw, light, desiredV, nearestGap, blockingLeader);
      if (v.laneChangeDir && Math.abs(v.lateralOffset - v.targetLateralOffset) < 0.2) v.laneChangeDir = null;

      let nextLat = v.lateralOffset, nextLatVel = v.lateralVelocity;
      const latDiff = v.targetLateralOffset - v.lateralOffset;
      if (Math.abs(latDiff) > 0.01 && v.speed > 0.35) {
        const maxLat = Math.min(2.3, v.speed * 0.55);
        const dvLat = Math.max(-maxLat, Math.min(maxLat, latDiff * 3.0)) - nextLatVel;
        nextLatVel += Math.sign(dvLat) * Math.min(Math.abs(dvLat), 4.5 * dt);
        const stepLat = nextLatVel * dt;
        const candLat = Math.abs(stepLat) >= Math.abs(latDiff) ? v.targetLateralOffset : nextLat + stepLat;
        const myEffW = effClearanceWidth(v);

        let blocked = false;
        if (v.vClass === 'motor') {
          const candG = getGlobalLat(v.laneIndex, candLat, lw), curG = getGlobalLat(v.laneIndex, v.lateralOffset, lw);
          for (const other of this.vehicles) {
            if (other.id === v.id || other.originArm !== v.originArm) continue;
            if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + 2.0) {
              const otherG = getGlobalLat(other.laneIndex, other.lateralOffset, lw);
              if (Math.abs(candG - otherG) < (myEffW + effClearanceWidth(other)) * 0.5 + 0.08 && Math.abs(candG - otherG) < Math.abs(curG - otherG)) {
                blocked = true; break;
              }
            }
          }
        }
        if (blocked) nextLatVel = 0;
        else if (Math.abs(stepLat) >= Math.abs(latDiff)) { nextLat = v.targetLateralOffset; nextLatVel = 0; }
        else nextLat += stepLat;
      } else {
        nextLatVel *= Math.max(0, 1 - 10 * dt);
      }

      // Smooth urban IDM: soft coasting at >10m gap, firm braking only when close
      let nextSpeed = v.speed;
      if (v.reactionTimer > 0 && light === 'green') {
        nextSpeed = Math.max(0, v.speed - 1.5 * dt);
      } else {
        const effAccel = v.maxAccel * v.accelFactor;
        const minGap = v.vClass === 'motor' && v.speed < 4.5 ? 0.65 : v.minGap;
        const headway = (v.vClass === 'motor' && v.speed < 4.5 ? 0.5 : v.timeHeadway) * widthHeadwayFactor;
        const dv = v.speed - leadSpeed;
        const sStar = minGap + Math.max(0, v.speed * headway + (v.speed * dv) / (2 * Math.sqrt(effAccel * v.comfortDecel)));
        const rawAccel = effAccel * (1 - Math.pow(v.speed / Math.max(1, desiredV), 4) - (Number.isFinite(nearestGap) ? Math.pow(sStar / Math.max(0.05, nearestGap), 2) : 0));
        // Prevent IDM v=0 deadlock when light is green and gap is around minGap
        const launchBoost =
          light === 'green' && v.speed < 1.0 && leadSpeed > 0.2 && nearestGap >= minGap * 1.05
            ? 0.45 * effAccel
            : -Infinity;
        const brakeLimit = nearestGap > 22 ? -v.comfortDecel : v.vClass === 'motor' ? -7.5 : -5.5;
        const clampedAccel = Math.max(launchBoost, Math.max(brakeLimit, Math.min(effAccel, rawAccel)));
        nextSpeed = Math.max(0, Math.min(desiredV * 1.05, v.speed + clampedAccel * dt));
      }

      decisions.push({ v, nextSpeed, nextLat, nextLatVel });
    }

    const toRemove = new Set<number>();
    for (const { v, nextSpeed, nextLat, nextLatVel } of decisions) {
      v.speed = nextSpeed; v.lateralOffset = nextLat; v.lateralVelocity = nextLatVel;
      v.distanceAlongPath += v.speed * dt;
      if (v.speed < 0.5 && v.distanceAlongPath < v.stopLineDist) v.waitingTime += dt;
      if (!v.hasExitedIntersection && v.distanceAlongPath >= v.exitLineDist) {
        v.hasExitedIntersection = true;
        this.totalExitedAllTime += 1;
        this.currentPhaseExited[v.vClass] += 1; this.currentPhaseExited.total += 1;
        this.currentCycleExited[v.vClass] += 1; this.currentCycleExited.total += 1;
      }
      if (v.distanceAlongPath >= v.totalPathLength) toRemove.add(v.id);
      else {
        const pt = sampleWithLateralOffset(v.path, v.distanceAlongPath, v.lateralOffset, v.lateralVelocity, v.speed);
        v.x = pt.x; v.y = pt.y; v.heading = pt.heading;
      }
    }
    if (toRemove.size > 0) this.vehicles = this.vehicles.filter((v) => !toRemove.has(v.id));
  }

  private countQueue(): number {
    return this.vehicles.filter((v) => v.distanceAlongPath < v.stopLineDist && v.speed < 1.0).length;
  }

  public getSnapshot(): SimSnapshot {
    const queueByArm: Record<ArmId, number> = { north: 0, east: 0, south: 0, west: 0 };
    let activeQueueCount = 0;
    for (const v of this.vehicles) {
      if (v.distanceAlongPath < v.stopLineDist && v.speed < 1.0) { queueByArm[v.originArm] += 1; activeQueueCount += 1; }
    }
    return {
      config: { ...this.config },
      signal: {
        activeArm: ARM_ORDER[this.activeArmIndex],
        activeColor: this.activeColor,
        phaseRemaining: Math.max(0, this.phaseRemaining),
        phaseElapsed: this.phaseElapsed,
        cycleNumber: this.cycleNumber,
        armLights: { north: this.getArmLight('north'), east: this.getArmLight('east'), south: this.getArmLight('south'), west: this.getArmLight('west') },
      },
      vehicles: this.vehicles.map(({ path: _p, targetLateralOffset: _t, lateralVelocity: _lv, speedFactor: _sf, accelFactor: _af, profile: _pr, reactionTimer: _rt, ...rest }) => rest),
      stats: {
        simTime: this.simTime,
        currentPhaseExited: { ...this.currentPhaseExited },
        currentCycleExited: { ...this.currentCycleExited },
        totalExitedAllTime: this.totalExitedAllTime,
        activeQueueCount,
        queueByArm,
        phaseHistory: [...this.phaseHistory],
        cycleHistory: [...this.cycleHistory],
      },
    };
  }
}
