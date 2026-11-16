import {
  createPathCache,
  getDestArm,
  getEffectiveRoadWidth,
  getLaneWidth,
  getTurnRadius,
  PathCache,
  sampleWithLateralOffset,
  VehiclePath,
} from './geometry';
import {
  ArmId,
  CycleRecord,
  PhaseRecord,
  SignalColor,
  SimConfig,
  SimSnapshot,
  TurnIntent,
  Vehicle,
  VehicleClass,
} from './types';

export const DEFAULT_CONFIG: SimConfig = {
  laneWidth: 3.5,
  roadWidthPerDirection: 7.0,
  roadLength: 75,
  lanesPerDirection: 2,
  motorRate: 30,
  carRate: 22,
  heavyRate: 5,
  turnLeftPct: 25,
  turnStraightPct: 55,
  turnRightPct: 20,
  greenDuration: 15,
  yellowDuration: 3,
  allRedDuration: 1.5,
};

const ARM_ORDER: ArmId[] = ['north', 'east', 'south', 'west'];

const SPRITES: Record<VehicleClass, string[]> = {
  motor: [
    '/assets/vehicles/moto-commuter.svg',
    '/assets/vehicles/moto-scooter.svg',
    '/assets/vehicles/moto-sport.svg',
    '/assets/vehicles/moto-delivery-box.svg',
    '/assets/vehicles/moto-cruiser.svg',
    '/assets/vehicles/moto-ev-white.svg',
  ],
  car: [
    '/assets/vehicles/car-sedan-navy.svg',
    '/assets/vehicles/car-sedan-white.svg',
    '/assets/vehicles/car-suv-slate.svg',
    '/assets/vehicles/car-compact-teal.svg',
    '/assets/vehicles/car-taxi-yellow.svg',
    '/assets/vehicles/car-van-delivery.svg',
    '/assets/vehicles/car-pickup-slate.svg',
    '/assets/vehicles/car-ev-mint.svg',
    '/assets/vehicles/car-luxury-black.svg',
  ],
  heavy: [
    '/assets/vehicles/truck-box.svg',
    '/assets/vehicles/truck-heavy.svg',
    '/assets/vehicles/bus-city.svg',
    '/assets/vehicles/truck-dump.svg',
    '/assets/vehicles/truck-tanker.svg',
  ],
};

const VEHICLE_SPECS: Record<
  VehicleClass,
  { length: number; width: number; maxSpeed: number; maxAccel: number; comfortDecel: number; minGap: number; timeHeadway: number }
> = {
  motor: { length: 2.0, width: 0.85, maxSpeed: 13.8, maxAccel: 3.0, comfortDecel: 2.4, minGap: 1.0, timeHeadway: 0.85 },
  car: { length: 4.5, width: 1.85, maxSpeed: 13.5, maxAccel: 2.0, comfortDecel: 1.8, minGap: 2.0, timeHeadway: 1.15 },
  heavy: { length: 9.2, width: 2.5, maxSpeed: 10.2, maxAccel: 1.1, comfortDecel: 1.5, minGap: 3.0, timeHeadway: 1.8 },
};

type DriverProfile = 'cautious' | 'normal' | 'aggressive';

const PROFILE_MULT: Record<DriverProfile, { speed: number; accel: number }> = {
  cautious: { speed: 0.86, accel: 0.88 },
  normal: { speed: 1.0, accel: 1.0 },
  aggressive: { speed: 1.15, accel: 1.14 },
};

interface InternalVehicle extends Vehicle {
  path: VehiclePath;
  targetLateralOffset: number;
  lateralVelocity: number;
  speedFactor: number;
  accelFactor: number;
  profile: DriverProfile;
  reactionTimer: number;
}

interface Pass1Decision {
  v: InternalVehicle;
  nextSpeed: number;
  nextLateralOffset: number;
  nextLateralVelocity: number;
}

function normalizeConfig(raw: SimConfig): SimConfig {
  const lanes = Math.max(1, Math.min(4, Math.round(raw.lanesPerDirection)));
  const lw = Math.max(2.8, Math.min(4.2, +(raw.laneWidth ?? raw.roadWidthPerDirection / lanes).toFixed(2)));
  return {
    ...raw,
    lanesPerDirection: lanes,
    laneWidth: lw,
    roadWidthPerDirection: +(lanes * lw).toFixed(2),
  };
}

export class TrafficSimulation {
  private config: SimConfig;
  private pathCache: PathCache;
  private vehicles: InternalVehicle[] = [];
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

    const geomChanged =
      prev.lanesPerDirection !== this.config.lanesPerDirection ||
      prev.laneWidth !== this.config.laneWidth ||
      prev.roadLength !== this.config.roadLength;

    if (geomChanged) {
      this.pathCache = createPathCache(this.config);
      const maxLane = Math.max(0, this.config.lanesPerDirection - 1);
      const lw = getLaneWidth(this.config);

      for (const v of this.vehicles) {
        v.laneIndex = Math.min(v.laneIndex, maxLane);
        if (v.vClass !== 'motor' || lw < 2.8) {
          v.lateralOffset = 0;
          v.targetLateralOffset = 0;
          v.lateralVelocity = 0;
          v.laneChangeDir = null;
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
        v.x = pt.x;
        v.y = pt.y;
        v.heading = pt.heading;
      }

      if (this.config.lanesPerDirection < prev.lanesPerDirection || this.config.roadLength < prev.roadLength) {
        const overflowIds = new Set<number>();
        for (const arm of ARM_ORDER) {
          for (let lane = 0; lane < this.config.lanesPerDirection; lane++) {
            const laneVehs = this.vehicles
              .filter((v) => v.originArm === arm && v.laneIndex === lane)
              .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
            let prevAllowedDist = Infinity;
            for (let i = 0; i < laneVehs.length; i++) {
              const cur = laneVehs[i];
              if (i > 0) {
                const lead = laneVehs[i - 1];
                const minSep = (lead.length + cur.length) * 0.5 + cur.minGap;
                const targetDist = Math.min(cur.distanceAlongPath, prevAllowedDist - minSep);
                if (targetDist < 0) {
                  overflowIds.add(cur.id);
                  continue;
                }
                cur.distanceAlongPath = targetDist;
                cur.speed = Math.min(cur.speed, lead.speed);
                const pt = sampleWithLateralOffset(cur.path, cur.distanceAlongPath, cur.lateralOffset, 0, cur.speed);
                cur.x = pt.x;
                cur.y = pt.y;
                cur.heading = pt.heading;
              }
              prevAllowedDist = cur.distanceAlongPath;
            }
          }
        }
        if (overflowIds.size > 0) {
          this.vehicles = this.vehicles.filter((v) => !overflowIds.has(v.id));
        }
      }
    }

    if (this.activeColor === 'green' && this.phaseRemaining > this.config.greenDuration) {
      this.phaseRemaining = this.config.greenDuration;
    } else if (this.activeColor === 'yellow' && this.phaseRemaining > this.config.yellowDuration) {
      this.phaseRemaining = this.config.yellowDuration;
    } else if (this.isAllRed && this.phaseRemaining > this.config.allRedDuration) {
      this.phaseRemaining = this.config.allRedDuration;
    }
  }

  public step(dt: number): void {
    const clampedDt = Math.min(0.1, Math.max(0.001, dt));
    this.simTime += clampedDt;

    this.advanceSignals(clampedDt);
    this.spawnVehicles(clampedDt);
    this.updateVehicles(clampedDt);

    const queue = this.countQueue();
    this.currentCycleQueueSum += queue;
    this.currentCycleSteps += 1;
  }

  private assignStartUpReactionWave(arm: ArmId): void {
    // Group per lane and enforce monotonically non-decreasing reactionTimer front-to-back
    for (let lane = 0; lane < this.config.lanesPerDirection; lane++) {
      const queued = this.vehicles
        .filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist && v.speed < 1.2)
        .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);

      let prevTimer = 0;
      for (let idx = 0; idx < queued.length; idx++) {
        const v = queued[idx];
        const baseDelay = v.vClass === 'motor' ? 0.16 : v.vClass === 'car' ? 0.40 : 0.65;
        const profileScale = v.profile === 'aggressive' ? 0.7 : v.profile === 'cautious' ? 1.2 : 1.0;
        const ownTimer = baseDelay * profileScale + Math.min(6, idx) * 0.12;
        v.reactionTimer = idx === 0 ? ownTimer : Math.max(prevTimer + 0.10, ownTimer);
        prevTimer = v.reactionTimer;
      }
    }
  }

  private advanceSignals(dt: number): void {
    this.phaseRemaining -= dt;
    this.phaseElapsed += dt;

    if (this.phaseRemaining > 0) return;

    const overflow = this.phaseRemaining; // <= 0

    if (this.activeColor === 'green') {
      this.activeColor = 'yellow';
      this.phaseRemaining = Math.max(0.5, this.config.yellowDuration) + overflow;
      return;
    }

    if (this.activeColor === 'yellow' && !this.isAllRed) {
      if (this.config.allRedDuration > 0.05) {
        this.activeColor = 'red';
        this.isAllRed = true;
        this.phaseRemaining = this.config.allRedDuration + overflow;
        return;
      }
    }

    this.phaseCounter += 1;
    const finishedArm = ARM_ORDER[this.activeArmIndex];
    this.phaseHistory.unshift({
      phaseIndex: this.phaseCounter,
      cycleNumber: this.cycleNumber,
      arm: finishedArm,
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
    this.assignStartUpReactionWave(ARM_ORDER[this.activeArmIndex]);
  }

  private pickTurnIntent(): TurnIntent {
    const l = Math.max(0, this.config.turnLeftPct);
    const s = Math.max(0, this.config.turnStraightPct);
    const r = Math.max(0, this.config.turnRightPct);
    const sum = l + s + r;
    if (sum <= 0) return 'straight';
    const roll = Math.random() * sum;
    if (roll < l) return 'left';
    if (roll < l + s) return 'straight';
    return 'right';
  }

  private pickLaneForTurn(arm: ArmId, turn: TurnIntent): number {
    const L = Math.max(1, this.config.lanesPerDirection);
    if (L === 1) return 0;
    if (turn === 'left') return L - 1;
    if (turn === 'right') return 0;

    let bestLane = 0;
    let bestCount = Infinity;
    const startOffset = Math.floor(Math.random() * L);
    for (let i = 0; i < L; i++) {
      const lane = (startOffset + i) % L;
      let count = 0;
      for (const v of this.vehicles) {
        if (v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist) {
          count += 1;
        }
      }
      if (count < bestCount) {
        bestCount = count;
        bestLane = lane;
      }
    }
    return bestLane;
  }

  private spawnVehicles(dt: number): void {
    const classes: { cls: VehicleClass; ratePerMin: number }[] = [
      { cls: 'motor', ratePerMin: this.config.motorRate },
      { cls: 'car', ratePerMin: this.config.carRate },
      { cls: 'heavy', ratePerMin: this.config.heavyRate },
    ];

    for (const { cls, ratePerMin } of classes) {
      if (ratePerMin <= 0) continue;
      this.spawnAccum[cls] += (ratePerMin / 60) * dt;
      while (this.spawnAccum[cls] >= 1) {
        if (this.trySpawnOne(cls)) {
          this.spawnAccum[cls] -= 1;
        } else {
          // Cap backlog to 2 so blocked arms don't dump a burst later
          this.spawnAccum[cls] = Math.min(this.spawnAccum[cls], 2);
          break;
        }
      }
    }
  }

  private getGlobalLat(laneIndex: number, lateralOffset: number, lw: number): number {
    return (laneIndex + 0.5) * lw + lateralOffset;
  }

  private canFilterSideBySide(vWidth: number, otherWidth: number, laneWidth: number): boolean {
    const effV = vWidth < 1.0 ? 0.72 : vWidth;
    const effO = otherWidth < 1.0 ? 0.72 : otherWidth;
    return laneWidth >= effV + effO + 0.25;
  }

  private getEffectiveClearanceWidth(v: { vClass: VehicleClass; width: number }): number {
    return v.vClass === 'motor' ? 0.72 : v.width;
  }

  private pickDriverProfile(): DriverProfile {
    const r = Math.random();
    if (r < 0.22) return 'cautious';
    if (r < 0.72) return 'normal';
    return 'aggressive';
  }

  private trySpawnOne(vClass: VehicleClass): boolean {
    const arm = ARM_ORDER[this.armSpawnCursor % ARM_ORDER.length];
    const turn = this.pickTurnIntent();
    const laneIndex = this.pickLaneForTurn(arm, turn);
    const spec = VEHICLE_SPECS[vClass];
    const lw = getLaneWidth(this.config);

    let lateralOffset = 0;
    if (vClass === 'motor' && lw >= 3.1) {
      lateralOffset = Math.random() < 0.5 ? -lw * 0.27 : lw * 0.27;
    } else if (vClass === 'car') {
      lateralOffset = (Math.random() - 0.5) * 0.16;
    }

    const myGlobalLat = this.getGlobalLat(laneIndex, lateralOffset, lw);
    const myEffW = vClass === 'motor' ? 0.72 : spec.width;
    const minClearance = spec.length + spec.minGap + 4.5;
    let nearestAheadSpeed = Infinity;
    for (const other of this.vehicles) {
      if (other.originArm !== arm) continue;
      const otherGlobalLat = this.getGlobalLat(other.laneIndex, other.lateralOffset, lw);
      const otherEffW = this.getEffectiveClearanceWidth(other);
      const latSep = Math.abs(myGlobalLat - otherGlobalLat);
      if (latSep < (myEffW + otherEffW) * 0.5 + 0.25) {
        if (other.distanceAlongPath < other.length * 0.5 + minClearance) {
          return false;
        }
        if (other.distanceAlongPath < 14) {
          nearestAheadSpeed = Math.min(nearestAheadSpeed, other.speed);
        }
      }
    }

    this.armSpawnCursor = (this.armSpawnCursor + 1) % ARM_ORDER.length;

    const profile = this.pickDriverProfile();
    const pMult = PROFILE_MULT[profile];
    const path = this.pathCache[arm][turn][laneIndex];
    const speedFactor = pMult.speed * (0.95 + Math.random() * 0.1);
    const accelFactor = pMult.accel * (0.95 + Math.random() * 0.1);
    const initialSpeed = Math.min(spec.maxSpeed * speedFactor * 0.65, nearestAheadSpeed + 1.5);
    const startPt = sampleWithLateralOffset(path, 0, lateralOffset, 0, initialSpeed);
    const sprites = SPRITES[vClass];
    const spriteKey = sprites[Math.floor(Math.random() * sprites.length)];

    this.vehicles.push({
      id: this.nextVehicleId++,
      vClass,
      spriteKey,
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
    if (this.isAllRed) return 'red';
    return ARM_ORDER[this.activeArmIndex] === arm ? this.activeColor : 'red';
  }

  private isIntersectionBoxOccupiedByOtherArm(myArm: ArmId): boolean {
    for (const other of this.vehicles) {
      if (other.originArm === myArm) continue;
      if (other.distanceAlongPath > other.stopLineDist + 0.5 && other.distanceAlongPath < other.exitLineDist) {
        return true;
      }
    }
    return false;
  }

  private updateVehicles(dt: number): void {
    const lw = getLaneWidth(this.config);
    const roadW = getEffectiveRoadWidth(this.config);

    // MKJI Lane Width Adjustment Factors (FC_w)
    const widthSpeedFactor = Math.max(0.84, Math.min(1.08, 0.84 + (lw - 2.8) * 0.1714));
    const widthHeadwayFactor = Math.max(0.92, Math.min(1.18, 1.18 - (lw - 2.8) * 0.1857));

    // PASS 1: Evaluate environment, steering, and IDM acceleration without mutating positions
    const decisions: Pass1Decision[] = [];

    for (const v of this.vehicles) {
      if (v.reactionTimer > 0) {
        v.reactionTimer = Math.max(0, v.reactionTimer - dt);
      }

      const light = this.getArmLight(v.originArm);
      const myGlobalLat = this.getGlobalLat(v.laneIndex, v.lateralOffset, lw);

      let desiredV = v.maxSpeed * v.speedFactor * widthSpeedFactor;
      if (v.distanceAlongPath >= v.stopLineDist - 4 && v.distanceAlongPath <= v.exitLineDist) {
        const R = getTurnRadius(v.turn, v.laneIndex, this.config);
        if (Number.isFinite(R)) {
          const centrip = v.vClass === 'heavy' ? 1.35 : 2.2;
          desiredV = Math.min(desiredV, Math.max(4.0, Math.sqrt(centrip * R)));
        }
      }

      let nearestGap = Infinity;
      let leadSpeed = desiredV;
      let blockingLeader: InternalVehicle | null = null;

      // 1. Stop-line braking
      const frontBumperDist = v.distanceAlongPath + v.length * 0.5;
      const distToStop = v.stopLineDist - frontBumperDist;
      if (distToStop > 0) {
        let shouldStop = light === 'red';
        if (light === 'yellow') {
          const aggr = v.profile === 'aggressive' ? 1.65 : 1.3;
          const comfortableStopDist = (v.speed * v.speed) / (2 * v.comfortDecel * aggr);
          shouldStop = distToStop > comfortableStopDist;
        } else if (light === 'green' && distToStop < 12 && this.isIntersectionBoxOccupiedByOtherArm(v.originArm)) {
          shouldStop = true;
        }
        if (shouldStop && distToStop < nearestGap) {
          nearestGap = Math.max(0.1, distToStop);
          leadSpeed = 0;
        }
      }

      // 2. Unified leader detection (approach + intersection box + exit segment, zero exitLineDist blind spot)
      let isSqueezingPast = false;
      const myEffW = this.getEffectiveClearanceWidth(v);
      const cosH = Math.cos(v.heading);
      const sinH = Math.sin(v.heading);

      for (const other of this.vehicles) {
        if (other.id === v.id) continue;

        const otherEffW = this.getEffectiveClearanceWidth(other);
        const pad = v.vClass === 'motor' || other.vClass === 'motor' ? 0.06 : 0.3;
        const minLatNeed = (myEffW + otherEffW) * 0.5 + pad;

        if (v.distanceAlongPath < v.stopLineDist && other.originArm === v.originArm && other.distanceAlongPath < other.stopLineDist + 2) {
          // Both on approach: use fast, exact lane globalLat separation
          if (other.distanceAlongPath <= v.distanceAlongPath) continue;
          const otherGlobalLat = this.getGlobalLat(other.laneIndex, other.lateralOffset, lw);
          const latSep = Math.abs(myGlobalLat - otherGlobalLat);
          if (latSep >= minLatNeed) {
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
        } else if (other.originArm === v.originArm || other.destArm === v.destArm) {
          // Crossing stop line, inside intersection box, or exiting into destArm:
          // Use 2D world-space forward/lateral projection so there is ZERO blind spot at exitLineDist!
          const dx = other.x - v.x;
          const dy = other.y - v.y;
          const forwardProj = dx * cosH + dy * sinH;
          if (forwardProj <= 0.1 || forwardProj > 45) continue;

          const latProj = Math.abs(-dx * sinH + dy * cosH);
          if (latProj >= minLatNeed) continue;

          const gapAlong = forwardProj - (other.length + v.length) * 0.5;
          if (gapAlong < nearestGap) {
            nearestGap = Math.max(0.05, gapAlong);
            leadSpeed = other.speed;
            blockingLeader = other;
          }
        }
      }

      if (v.vClass === 'motor' && isSqueezingPast && leadSpeed < 2.5) {
        desiredV = Math.min(desiredV, 4.8);
      }

      // 3A. Indonesian Motorcycle Proactive Overtake & Non-Lane-Based Seepage
      if (v.vClass === 'motor') {
        if (v.distanceAlongPath >= v.stopLineDist - 2.5) {
          let centerClear = true;
          for (const other of this.vehicles) {
            if (other.id === v.id || other.originArm !== v.originArm) continue;
            if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + 1.5) {
              const otherGlobalLat = this.getGlobalLat(other.laneIndex, other.lateralOffset, lw);
              const centerGlobalLat = this.getGlobalLat(v.laneIndex, 0, lw);
              const otherEffW = this.getEffectiveClearanceWidth(other);
              if (Math.abs(centerGlobalLat - otherGlobalLat) < (myEffW + otherEffW) * 0.5 + 0.15) {
                centerClear = false;
                break;
              }
            }
          }
          if (centerClear) {
            v.targetLateralOffset = 0;
          }
        } else if (
          blockingLeader &&
          nearestGap < 24.0 &&
          (blockingLeader.speed < desiredV - 0.8 || blockingLeader.speed < 3.5) &&
          this.canFilterSideBySide(v.width, blockingLeader.width, roadW)
        ) {
          const minBound = v.turn === 'straight' ? 0.42 : Math.max(0.42, v.laneIndex * lw - 0.6);
          const maxBound = v.turn === 'straight' ? roadW - 0.42 : Math.min(roadW - 0.42, (v.laneIndex + 1) * lw + 0.6);
          const leadEffW = this.getEffectiveClearanceWidth(blockingLeader);

          const rawCandidates: number[] = [];
          for (let l = 1; l < this.config.lanesPerDirection; l++) {
            rawCandidates.push(l * lw);
          }
          rawCandidates.push(
            myGlobalLat - (myEffW + leadEffW) * 0.5 - 0.12,
            myGlobalLat + (myEffW + leadEffW) * 0.5 + 0.12,
            maxBound,
            minBound
          );

          const candidates = rawCandidates.filter(
            (g) => g >= minBound && g <= maxBound && Math.abs(g - myGlobalLat) > 0.2
          );

          let bestCand: number | null = null;
          let bestForwardDist = -1;

          for (const candGlobalLat of candidates) {
            let clear = true;
            const bandMin = Math.min(myGlobalLat, candGlobalLat);
            const bandMax = Math.max(myGlobalLat, candGlobalLat);
            let forwardClearDist = v.stopLineDist - v.distanceAlongPath;

            for (const other of this.vehicles) {
              if (other.id === v.id || other.originArm !== v.originArm) continue;
              const otherGlobalLat = this.getGlobalLat(other.laneIndex, other.lateralOffset, lw);
              const otherEffW = this.getEffectiveClearanceWidth(other);
              const pad = (myEffW + otherEffW) * 0.5 + 0.12;
              const halfSumLen = (v.length + other.length) * 0.5;
              const longDiff = other.distanceAlongPath - v.distanceAlongPath;

              // Only check swept band against vehicles beside/overlapping us longitudinally (not a stopped leader directly ahead!)
              if (Math.abs(longDiff) < halfSumLen + 0.4) {
                if (otherGlobalLat >= bandMin - pad && otherGlobalLat <= bandMax + pad) {
                  clear = false;
                  break;
                }
              } else if (longDiff > 0 && longDiff < halfSumLen + 3.0) {
                // Vehicle just ahead: only require target corridor candGlobalLat to be clear!
                if (other.laneChangeDir != null && Math.abs(candGlobalLat - otherGlobalLat) < pad + 0.5) {
                  clear = false;
                  break;
                }
                if (Math.abs(candGlobalLat - otherGlobalLat) < pad) {
                  clear = false;
                  break;
                }
              } else if (longDiff > 0 && Math.abs(candGlobalLat - otherGlobalLat) < pad) {
                const gapAhead = longDiff - halfSumLen;
                if (gapAhead < forwardClearDist) {
                  forwardClearDist = gapAhead;
                }
              }
            }

            if (clear && forwardClearDist > bestForwardDist) {
              bestForwardDist = forwardClearDist;
              bestCand = candGlobalLat;
            }
          }

          if (bestCand !== null && bestForwardDist > nearestGap + 1.5) {
            if (v.turn === 'straight' && this.config.lanesPerDirection >= 2) {
              const targetLane = Math.max(
                0,
                Math.min(this.config.lanesPerDirection - 1, Math.floor(bestCand / lw))
              );
              if (targetLane !== v.laneIndex) {
                const oldLane = v.laneIndex;
                v.laneIndex = targetLane;
                v.path = this.pathCache[v.originArm][v.turn][targetLane];
                v.stopLineDist = v.path.stopLineDist;
                v.exitLineDist = v.path.exitLineDist;
                v.totalPathLength = v.path.totalPathLength;
                v.lateralOffset += (oldLane - targetLane) * lw;
              }
            }
            v.targetLateralOffset = bestCand - (v.laneIndex + 0.5) * lw;
          }
        }
      }

      // 3B. Tactical Car Lane Change (ONLY when green, >=25m from stop line, and target lane clear 22m ahead!)
      if (
        v.vClass === 'car' &&
        v.turn === 'straight' &&
        light === 'green' &&
        this.config.lanesPerDirection >= 2 &&
        v.distanceAlongPath < v.stopLineDist - 25 &&
        Math.abs(v.lateralOffset) < 0.25 &&
        blockingLeader &&
        nearestGap < 12.0 &&
        blockingLeader.speed < desiredV - 1.5 &&
        v.speed > 4.0
      ) {
        const adjLanes = [v.laneIndex - 1, v.laneIndex + 1].filter(
          (l) => l >= 0 && l < this.config.lanesPerDirection
        );
        for (const newLane of adjLanes) {
          const newLaneCenter = this.getGlobalLat(newLane, 0, lw);
          let laneClear = true;
          for (const other of this.vehicles) {
            if (other.id === v.id || other.originArm !== v.originArm) continue;
            const otherGlobalLat = this.getGlobalLat(other.laneIndex, other.lateralOffset, lw);
            const otherEffW = this.getEffectiveClearanceWidth(other);
            if (Math.abs(otherGlobalLat - newLaneCenter) < (v.width + otherEffW) * 0.5 + 0.35) {
              const relDist = other.distanceAlongPath - v.distanceAlongPath;
              if (relDist > -8.0 && relDist < 22.0) {
                laneClear = false;
                break;
              }
            }
          }
          if (laneClear) {
            const oldLane = v.laneIndex;
            v.laneIndex = newLane;
            v.path = this.pathCache[v.originArm][v.turn][newLane];
            v.stopLineDist = v.path.stopLineDist;
            v.exitLineDist = v.path.exitLineDist;
            v.totalPathLength = v.path.totalPathLength;
            v.lateralOffset += (oldLane - newLane) * lw;
            v.targetLateralOffset = 0;
            v.laneChangeDir = newLane > oldLane ? 'left' : 'right';
            break;
          }
        }
      }

      if (v.laneChangeDir && Math.abs(v.lateralOffset - v.targetLateralOffset) < 0.2) {
        v.laneChangeDir = null;
      }

      // 3C. Smooth S-Curve Lateral Velocity
      let nextLateralOffset = v.lateralOffset;
      let nextLateralVelocity = v.lateralVelocity;
      const latDiff = v.targetLateralOffset - v.lateralOffset;
      if (Math.abs(latDiff) > 0.01 && v.speed > 0.35) {
        const maxLatSpeed = Math.min(2.3, v.speed * 0.55);
        const desiredLatVel = Math.max(-maxLatSpeed, Math.min(maxLatSpeed, latDiff * 3.0));
        const latAccel = 4.5;
        const dvLat = desiredLatVel - nextLateralVelocity;
        nextLateralVelocity += Math.sign(dvLat) * Math.min(Math.abs(dvLat), latAccel * dt);
        const stepLat = nextLateralVelocity * dt;
        const candLatOff = Math.abs(stepLat) >= Math.abs(latDiff) ? v.targetLateralOffset : nextLateralOffset + stepLat;
        let lateralBlocked = false;
        if (v.vClass === 'motor' && Math.abs(candLatOff) < Math.abs(v.lateralOffset) || v.vClass === 'motor') {
          const candGlobal = this.getGlobalLat(v.laneIndex, candLatOff, lw);
          const curGlobal = this.getGlobalLat(v.laneIndex, v.lateralOffset, lw);
          for (const other of this.vehicles) {
            if (other.id === v.id || other.originArm !== v.originArm) continue;
            if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + 2.0) {
              const otherGlobal = this.getGlobalLat(other.laneIndex, other.lateralOffset, lw);
              const otherEffW = this.getEffectiveClearanceWidth(other);
              const minNeed = (myEffW + otherEffW) * 0.5 + 0.08;
              if (Math.abs(candGlobal - otherGlobal) < minNeed && Math.abs(candGlobal - otherGlobal) < Math.abs(curGlobal - otherGlobal)) {
                lateralBlocked = true;
                break;
              }
            }
          }
        }
        if (lateralBlocked) {
          nextLateralVelocity = 0;
        } else if (Math.abs(stepLat) >= Math.abs(latDiff)) {
          nextLateralOffset = v.targetLateralOffset;
          nextLateralVelocity = 0;
        } else {
          nextLateralOffset += stepLat;
        }
      } else {
        nextLateralVelocity *= Math.max(0, 1 - 10 * dt);
      }

      // 4. IDM longitudinal integration
      let nextSpeed = v.speed;
      if (v.reactionTimer > 0 && light === 'green') {
        nextSpeed = Math.max(0, v.speed - 2.0 * dt);
      } else {
        const effAccel = v.maxAccel * v.accelFactor;
        const dynamicMinGap = v.vClass === 'motor' && v.speed < 4.5 ? 0.65 : v.minGap;
        const dynamicHeadway =
          (v.vClass === 'motor' && v.speed < 4.5 ? 0.55 : v.timeHeadway) * widthHeadwayFactor;

        const dv = v.speed - leadSpeed;
        const sStar =
          dynamicMinGap +
          Math.max(0, v.speed * dynamicHeadway + (v.speed * dv) / (2 * Math.sqrt(effAccel * v.comfortDecel)));
        const freeTerm = Math.pow(v.speed / Math.max(1, desiredV), 4);
        const intTerm = Number.isFinite(nearestGap) ? Math.pow(sStar / Math.max(0.05, nearestGap), 2) : 0;
        const maxBrake = v.vClass === 'motor' ? -8.5 : -6.5;
        const accel = Math.max(maxBrake, Math.min(effAccel, effAccel * (1 - freeTerm - intTerm)));

        nextSpeed = Math.max(0, Math.min(desiredV * 1.05, v.speed + accel * dt));
      }

      decisions.push({ v, nextSpeed, nextLateralOffset, nextLateralVelocity });
    }

    // PASS 2: Commit state & integrate positions symmetrically
    const toRemove = new Set<number>();
    for (const d of decisions) {
      const { v, nextSpeed, nextLateralOffset, nextLateralVelocity } = d;
      v.speed = nextSpeed;
      v.lateralOffset = nextLateralOffset;
      v.lateralVelocity = nextLateralVelocity;
      v.distanceAlongPath += v.speed * dt;

      if (v.speed < 0.5 && v.distanceAlongPath < v.stopLineDist) {
        v.waitingTime += dt;
      }

      if (!v.hasExitedIntersection && v.distanceAlongPath >= v.exitLineDist) {
        v.hasExitedIntersection = true;
        this.totalExitedAllTime += 1;
        this.currentPhaseExited[v.vClass] += 1;
        this.currentPhaseExited.total += 1;
        this.currentCycleExited[v.vClass] += 1;
        this.currentCycleExited.total += 1;
      }

      if (v.distanceAlongPath >= v.totalPathLength) {
        toRemove.add(v.id);
      } else {
        const pt = sampleWithLateralOffset(
          v.path,
          v.distanceAlongPath,
          v.lateralOffset,
          v.lateralVelocity,
          v.speed
        );
        v.x = pt.x;
        v.y = pt.y;
        v.heading = pt.heading;
      }
    }

    if (toRemove.size > 0) {
      this.vehicles = this.vehicles.filter((v) => !toRemove.has(v.id));
    }
  }

  private countQueue(): number {
    let q = 0;
    for (const v of this.vehicles) {
      if (v.distanceAlongPath < v.stopLineDist && v.speed < 1.0) q += 1;
    }
    return q;
  }

  public getSnapshot(): SimSnapshot {
    const queueByArm: Record<ArmId, number> = { north: 0, east: 0, south: 0, west: 0 };
    let activeQueueCount = 0;
    for (const v of this.vehicles) {
      if (v.distanceAlongPath < v.stopLineDist && v.speed < 1.0) {
        queueByArm[v.originArm] += 1;
        activeQueueCount += 1;
      }
    }

    return {
      config: { ...this.config },
      signal: {
        activeArm: ARM_ORDER[this.activeArmIndex],
        activeColor: this.activeColor,
        phaseRemaining: Math.max(0, this.phaseRemaining),
        phaseElapsed: this.phaseElapsed,
        cycleNumber: this.cycleNumber,
        armLights: {
          north: this.getArmLight('north'),
          east: this.getArmLight('east'),
          south: this.getArmLight('south'),
          west: this.getArmLight('west'),
        },
      },
      vehicles: this.vehicles.map(
        ({
          path: _path,
          targetLateralOffset: _t,
          lateralVelocity: _lv,
          speedFactor: _sf,
          accelFactor: _af,
          profile: _p,
          reactionTimer: _rt,
          ...rest
        }) => rest
      ),
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
