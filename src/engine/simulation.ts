import { pickNextArmAdaptive, shouldExtendGreenPhase } from './adaptiveController';
import {
  assignReactionWave,
  effClearanceWidth,
  findBlockingLeader,
  getGlobalLat,
  SimVehicle,
  tryCarLaneChange,
  updateMotorcycleSeepage,
} from './behaviors';
import { ARM_ORDER, DEFAULT_CONFIG, DriverProfile, getArmGreenDuration, PROFILE_MULT, QUEUE_SPEED_THRESHOLD, SPRITES, VEHICLE_SPECS } from './constants';
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeConfig(raw: SimConfig): SimConfig {
  const lanes = Math.max(1, Math.min(4, Math.round(raw.lanesPerDirection)));
  const lw = Math.max(2.8, Math.min(4.2, +(raw.laneWidth ?? raw.roadWidthPerDirection / lanes).toFixed(2)));
  const roadLength = Math.max(40, Math.min(200, Number.isFinite(raw.roadLength) ? raw.roadLength : DEFAULT_CONFIG.roadLength));
  const motorRate = Math.max(0, Number.isFinite(raw.motorRate) ? raw.motorRate : 0);
  const carRate = Math.max(0, Number.isFinite(raw.carRate) ? raw.carRate : 0);
  const heavyRate = Math.max(0, Number.isFinite(raw.heavyRate) ? raw.heavyRate : 0);
  const turnLeftPct = Math.max(0, Number.isFinite(raw.turnLeftPct) ? raw.turnLeftPct : 0);
  const turnStraightPct = Math.max(0, Number.isFinite(raw.turnStraightPct) ? raw.turnStraightPct : 0);
  const turnRightPct = Math.max(0, Number.isFinite(raw.turnRightPct) ? raw.turnRightPct : 0);
  const greenDuration = Math.max(3, Math.min(180, Number.isFinite(raw.greenDuration) ? raw.greenDuration : DEFAULT_CONFIG.greenDuration));
  const yellowDuration = Math.max(1, Number.isFinite(raw.yellowDuration) ? raw.yellowDuration : DEFAULT_CONFIG.yellowDuration);
  const allRedDuration = Math.max(0, Number.isFinite(raw.allRedDuration) ? raw.allRedDuration : DEFAULT_CONFIG.allRedDuration);
  const armGreenDurations: Record<ArmId, number> | undefined = raw.armGreenDurations
    ? {
        north: Math.max(3, Math.min(180, Number.isFinite(raw.armGreenDurations.north) ? raw.armGreenDurations.north : greenDuration)),
        east: Math.max(3, Math.min(180, Number.isFinite(raw.armGreenDurations.east) ? raw.armGreenDurations.east : greenDuration)),
        south: Math.max(3, Math.min(180, Number.isFinite(raw.armGreenDurations.south) ? raw.armGreenDurations.south : greenDuration)),
        west: Math.max(3, Math.min(180, Number.isFinite(raw.armGreenDurations.west) ? raw.armGreenDurations.west : greenDuration)),
      }
    : undefined;
  const rawWeights = raw.armWeights ?? DEFAULT_CONFIG.armWeights!;
  const armWeights: Record<ArmId, number> = {
    north: Math.max(0, Number.isFinite(rawWeights.north) ? rawWeights.north : 1),
    east: Math.max(0, Number.isFinite(rawWeights.east) ? rawWeights.east : 1),
    south: Math.max(0, Number.isFinite(rawWeights.south) ? rawWeights.south : 1),
    west: Math.max(0, Number.isFinite(rawWeights.west) ? rawWeights.west : 1),
  };
  return {
    ...raw,
    lanesPerDirection: lanes,
    laneWidth: lw,
    roadWidthPerDirection: +(lanes * lw).toFixed(2),
    roadLength,
    motorRate,
    carRate,
    heavyRate,
    turnLeftPct,
    turnStraightPct,
    turnRightPct,
    greenDuration,
    armGreenDurations,
    yellowDuration,
    allRedDuration,
    armWeights,
    leftTurnOnRed: Boolean(raw.leftTurnOnRed ?? DEFAULT_CONFIG.leftTurnOnRed),
    motorSwarmMode: Boolean(raw.motorSwarmMode ?? DEFAULT_CONFIG.motorSwarmMode),
    motorBoxEnabled: Boolean(raw.motorBoxEnabled ?? DEFAULT_CONFIG.motorBoxEnabled),
    hasMedian: Boolean(raw.hasMedian ?? DEFAULT_CONFIG.hasMedian),
  };
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
  private greenElapsed = 0;
  private isAllRed = false;
  private cycleNumber = 1;
  private phaseCounter = 0;
  private phasesInCycle = 0;
  private rng: () => number = mulberry32(1337);

  private spawnAccum = { motor: 0, car: 0, heavy: 0 };
  private currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };
  private currentCycleExited = { motor: 0, car: 0, heavy: 0, total: 0 };
  private currentCycleQueueSum = 0;
  private currentCycleQueueTime = 0;
  private currentCycleDuration = 0;
  private currentCycleGreenDuration = 0;
  private totalExitedAllTime = 0;
  private totalExitedWaitTime = 0;
  private exitedWaitCount = 0;
  private maxWaitTimeObserved = 0;
  private currentPhaseStartQueue = 0;
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
    this.phaseRemaining = getArmGreenDuration(this.config, ARM_ORDER[this.activeArmIndex]);
    this.phaseElapsed = 0;
    this.greenElapsed = 0;
    this.cycleNumber = 1;
    this.phaseCounter = 0;
    this.phasesInCycle = 0;
    this.rng = mulberry32(1337);
    this.spawnAccum = { motor: 0, car: 0, heavy: 0 };
    this.currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };
    this.currentCycleExited = { motor: 0, car: 0, heavy: 0, total: 0 };
    this.currentCycleQueueSum = 0;
    this.currentCycleQueueTime = 0;
    this.currentCycleDuration = 0;
    this.currentCycleGreenDuration = 0;
    this.totalExitedAllTime = 0;
    this.totalExitedWaitTime = 0;
    this.exitedWaitCount = 0;
    this.maxWaitTimeObserved = 0;
    this.currentPhaseStartQueue = 0;
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
          const maxLat = Math.max(0, lw * 0.5 - 0.42);
          v.lateralOffset = Math.max(-maxLat, Math.min(maxLat, v.lateralOffset));
          v.targetLateralOffset = Math.max(-maxLat, Math.min(maxLat, v.targetLateralOffset));
        }
        const oldStop = v.stopLineDist;
        const oldExit = v.exitLineDist;
        const oldTotal = v.totalPathLength;
        const newPath = this.pathCache[v.originArm][v.turn][v.laneIndex];
        let scaledDist: number;
        if (v.distanceAlongPath < oldStop) {
          const segRel = oldStop > 0 ? v.distanceAlongPath / oldStop : 0;
          scaledDist = Math.min(Math.max(0, newPath.stopLineDist - 0.5), segRel * newPath.stopLineDist);
        } else if (v.distanceAlongPath <= oldExit) {
          const oldBoxLen = Math.max(1e-3, oldExit - oldStop);
          const segRel = (v.distanceAlongPath - oldStop) / oldBoxLen;
          scaledDist = newPath.stopLineDist + segRel * (newPath.exitLineDist - newPath.stopLineDist);
        } else {
          const oldExitLen = Math.max(1e-3, oldTotal - oldExit);
          const segRel = (v.distanceAlongPath - oldExit) / oldExitLen;
          scaledDist = newPath.exitLineDist + segRel * (newPath.totalPathLength - newPath.exitLineDist);
        }
        v.path = newPath;
        v.stopLineDist = newPath.stopLineDist;
        v.exitLineDist = newPath.exitLineDist;
        v.totalPathLength = newPath.totalPathLength;
        v.distanceAlongPath = Math.max(0, Math.min(newPath.totalPathLength, scaledDist));
        const pt = sampleWithLateralOffset(newPath, v.distanceAlongPath, v.lateralOffset, 0, v.speed);
        v.x = pt.x; v.y = pt.y; v.heading = pt.heading;
      }

      if (this.config.lanesPerDirection < prev.lanesPerDirection || this.config.roadLength < prev.roadLength || this.config.laneWidth < prev.laneWidth) {
        const overflowIds = new Set<number>();
        for (const arm of ARM_ORDER) {
          for (let lane = 0; lane < this.config.lanesPerDirection; lane++) {
            const laneVehs = this.vehicles
              .filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist)
              .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
            const kept: SimVehicle[] = this.vehicles
              .filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath >= v.stopLineDist && v.distanceAlongPath < v.stopLineDist + 10.0)
              .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
            for (const cur of laneVehs) {
              const curLat = getGlobalLat(cur.laneIndex, cur.lateralOffset, lw);
              const curEffW = effClearanceWidth(cur);
              let blockingLead: SimVehicle | null = null;
              for (let k = kept.length - 1; k >= 0; k--) {
                const lead = kept[k];
                const leadLat = getGlobalLat(lead.laneIndex, lead.lateralOffset, lw);
                const pad = cur.vClass === 'motor' || lead.vClass === 'motor' ? 0.06 : 0.25;
                if (Math.abs(curLat - leadLat) < (curEffW + effClearanceWidth(lead)) * 0.5 + pad) {
                  blockingLead = lead;
                  break;
                }
              }
              if (blockingLead) {
                const halfSum = (blockingLead.length + cur.length) * 0.5;
                const maxDist = blockingLead.distanceAlongPath - (halfSum + cur.minGap);
                if (cur.distanceAlongPath > maxDist) {
                  if (maxDist < 0) {
                    overflowIds.add(cur.id);
                    continue;
                  }
                  cur.distanceAlongPath = maxDist;
                  cur.speed = Math.min(cur.speed, blockingLead.speed);
                  const pt = sampleWithLateralOffset(cur.path, cur.distanceAlongPath, cur.lateralOffset, 0, cur.speed);
                  cur.x = pt.x; cur.y = pt.y; cur.heading = pt.heading;
                } else {
                  const gap = blockingLead.distanceAlongPath - cur.distanceAlongPath - halfSum;
                  const safeSpeed = Math.sqrt(Math.max(0, blockingLead.speed * blockingLead.speed + 2 * 4.5 * Math.max(0, gap - cur.minGap)));
                  cur.speed = Math.min(cur.speed, safeSpeed);
                }
              }
              kept.push(cur);
            }
          }
        }
        if (overflowIds.size > 0) this.vehicles = this.vehicles.filter((v) => !overflowIds.has(v.id));

        // Also de-overlap vehicles that already exited onto the same destArm when lanes/road shrink
        const exitDropIds = new Set<number>();
        for (const arm of ARM_ORDER) {
          const exitedOnArm = this.vehicles
            .filter((v) => v.destArm === arm && v.distanceAlongPath >= v.stopLineDist)
            .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
          for (let i = 0; i < exitedOnArm.length; i++) {
            const a = exitedOnArm[i];
            if (exitDropIds.has(a.id)) continue;
            for (let j = i + 1; j < exitedOnArm.length; j++) {
              const b = exitedOnArm[j];
              if (exitDropIds.has(b.id)) continue;
              const aLat = getGlobalLat(a.laneIndex, a.lateralOffset, lw);
              const bLat = getGlobalLat(b.laneIndex, b.lateralOffset, lw);
              const minLatSep = (effClearanceWidth(a) + effClearanceWidth(b)) * 0.5 + 0.15;
              if (
                (a.originArm === b.originArm || (a.distanceAlongPath >= a.exitLineDist && b.distanceAlongPath >= b.exitLineDist)) &&
                Math.abs(aLat - bLat) >= minLatSep
              ) {
                continue;
              }
              const minSep = (a.length + b.length) * 0.5 + 0.5;
              if (Math.hypot(a.x - b.x, a.y - b.y) < minSep) {
                exitDropIds.add(b.id);
              }
            }
          }

          const boxOnOriginArm = this.vehicles
            .filter((v) => v.originArm === arm && v.distanceAlongPath >= v.stopLineDist && v.distanceAlongPath < v.exitLineDist)
            .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
          for (let i = 0; i < boxOnOriginArm.length; i++) {
            const a = boxOnOriginArm[i];
            if (exitDropIds.has(a.id)) continue;
            for (let j = i + 1; j < boxOnOriginArm.length; j++) {
              const b = boxOnOriginArm[j];
              if (exitDropIds.has(b.id)) continue;
              const aLat = getGlobalLat(a.laneIndex, a.lateralOffset, lw);
              const bLat = getGlobalLat(b.laneIndex, b.lateralOffset, lw);
              const minLatSep = (effClearanceWidth(a) + effClearanceWidth(b)) * 0.5 + 0.15;
              if (Math.abs(aLat - bLat) >= minLatSep) continue;
              const minSep = (a.length + b.length) * 0.5 + 0.5;
              if (Math.hypot(a.x - b.x, a.y - b.y) < minSep) {
                exitDropIds.add(b.id);
              }
            }
          }
        }
        if (exitDropIds.size > 0) this.vehicles = this.vehicles.filter((v) => !exitDropIds.has(v.id));
      }
    }

    const activeArmGreen = getArmGreenDuration(this.config, ARM_ORDER[this.activeArmIndex]);
    if (this.activeColor === 'green' && this.phaseRemaining > activeArmGreen) this.phaseRemaining = activeArmGreen;
    else if (this.activeColor === 'yellow' && this.phaseRemaining > this.config.yellowDuration) this.phaseRemaining = this.config.yellowDuration;
    else if (this.isAllRed && this.phaseRemaining > this.config.allRedDuration) this.phaseRemaining = this.config.allRedDuration;
  }

  public step(dt: number): void {
    if (!Number.isFinite(dt)) return;
    const clampedDt = Math.min(0.1, Math.max(0.001, dt));
    this.simTime += clampedDt;
    this.advanceSignals(clampedDt);
    this.spawnVehicles(clampedDt);
    this.updateVehicles(clampedDt);
    this.currentCycleQueueSum += this.countQueue() * clampedDt;
    this.currentCycleQueueTime += clampedDt;
  }

  private advanceSignals(dt: number): void {
    this.phaseRemaining -= dt;
    this.phaseElapsed += dt;

    if (this.activeColor === 'green') {
      this.greenElapsed += dt;
      const cutEarly =
        this.config.adaptiveSignal &&
        this.phaseRemaining > 0 &&
        !shouldExtendGreenPhase(this.vehicles, ARM_ORDER[this.activeArmIndex], this.phaseElapsed, this.config);

      if (this.phaseRemaining > 0 && !cutEarly) {
        return;
      }

      this.activeColor = 'yellow';
      this.phaseRemaining = Math.max(0.5, this.config.yellowDuration);
      return;
    }

    if (this.phaseRemaining > 0) return;

    const overflow = this.phaseRemaining;
    if (this.activeColor === 'yellow' && !this.isAllRed && this.config.allRedDuration > 0.05) {
      this.activeColor = 'red';
      this.isAllRed = true;
      this.phaseRemaining = this.config.allRedDuration + overflow;
      return;
    }

    const finishedArm = ARM_ORDER[this.activeArmIndex];
    this.phaseCounter += 1;
    this.currentCycleDuration += this.phaseElapsed;
    this.currentCycleGreenDuration += this.greenElapsed;
    this.phaseHistory.unshift({
      phaseIndex: this.phaseCounter,
      cycleNumber: this.cycleNumber,
      arm: finishedArm,
      greenDuration: Math.round(this.greenElapsed * 10) / 10,
      exitedMotor: this.currentPhaseExited.motor,
      exitedCar: this.currentPhaseExited.car,
      exitedHeavy: this.currentPhaseExited.heavy,
      exitedTotal: this.currentPhaseExited.total,
      queueAtStart: this.currentPhaseStartQueue,
      queueAtEnd: this.countQueueForArm(finishedArm),
    });
    if (this.phaseHistory.length > 200) this.phaseHistory.pop();
    this.currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };

    this.isAllRed = false;
    this.activeArmIndex = this.config.adaptiveSignal
      ? pickNextArmAdaptive(this.vehicles, this.activeArmIndex, ARM_ORDER, this.config)
      : (this.activeArmIndex + 1) % ARM_ORDER.length;

    this.phasesInCycle += 1;
    if (this.phasesInCycle >= ARM_ORDER.length) {
      const avgQ = this.currentCycleQueueTime > 0 ? this.currentCycleQueueSum / this.currentCycleQueueTime : 0;
      this.cycleHistory.unshift({
        cycleNumber: this.cycleNumber,
        totalDuration: Math.round(this.currentCycleDuration * 10) / 10,
        totalGreenDuration: Math.round(this.currentCycleGreenDuration * 10) / 10,
        exitedMotor: this.currentCycleExited.motor,
        exitedCar: this.currentCycleExited.car,
        exitedHeavy: this.currentCycleExited.heavy,
        exitedTotal: this.currentCycleExited.total,
        avgQueue: Math.round(avgQ * 10) / 10,
      });
      if (this.cycleHistory.length > 60) this.cycleHistory.pop();
      this.cycleNumber += 1;
      this.phasesInCycle = 0;
      this.currentCycleExited = { motor: 0, car: 0, heavy: 0, total: 0 };
      this.currentCycleQueueSum = 0;
      this.currentCycleQueueTime = 0;
      this.currentCycleDuration = 0;
      this.currentCycleGreenDuration = 0;
    }

    const nextArm = ARM_ORDER[this.activeArmIndex];
    this.activeColor = 'green';
    this.phaseRemaining = getArmGreenDuration(this.config, nextArm) + overflow;
    this.phaseElapsed = 0;
    this.greenElapsed = 0;
    this.currentPhaseStartQueue = this.countQueueForArm(nextArm);
    assignReactionWave(this.vehicles, nextArm, this.config.lanesPerDirection);
  }

  private pickTurnIntent(): TurnIntent {
    const sum = Math.max(0, this.config.turnLeftPct) + Math.max(0, this.config.turnStraightPct) + Math.max(0, this.config.turnRightPct);
    if (sum <= 0) return 'straight';
    const roll = this.rng() * sum;
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
    const startOffset = Math.floor(this.rng() * L);
    for (let i = 0; i < L; i++) {
      const lane = (startOffset + i) % L;
      const count = this.vehicles.filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist).length;
      if (count < bestCount) { bestCount = count; bestLane = lane; }
    }
    return bestLane;
  }

  private spawnVehicles(dt: number): void {
    const rates: [VehicleClass, number][] = [['motor', this.config.motorRate], ['car', this.config.carRate], ['heavy', this.config.heavyRate]];
    for (let i = rates.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [rates[i], rates[j]] = [rates[j], rates[i]];
    }
    for (const [cls, rate] of rates) {
      if (rate <= 0) continue;
      this.spawnAccum[cls] += (rate / 60) * dt;
      while (this.spawnAccum[cls] >= 1) {
        if (this.trySpawnOne(cls)) this.spawnAccum[cls] -= 1;
        else { this.spawnAccum[cls] = Math.min(this.spawnAccum[cls], 2); break; }
      }
    }
  }

  private pickWeightedArmOrder(): ArmId[] {
    const weights = this.config.armWeights ?? DEFAULT_CONFIG.armWeights!;
    const candidates: ArmId[] = [];
    for (let i = 0; i < ARM_ORDER.length; i++) {
      const arm = ARM_ORDER[(this.armSpawnCursor + i) % ARM_ORDER.length];
      if ((weights[arm] ?? 0) > 0) candidates.push(arm);
    }
    if (candidates.length <= 1) return candidates;
    const totalW = candidates.reduce((acc, arm) => acc + (weights[arm] ?? 0), 0);
    let roll = this.rng() * totalW;
    let firstIdx = 0;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[candidates[i]] ?? 0;
      if (roll <= 0) { firstIdx = i; break; }
    }
    return [...candidates.slice(firstIdx), ...candidates.slice(0, firstIdx)];
  }

  private trySpawnOne(vClass: VehicleClass): boolean {
    const turn = this.pickTurnIntent();
    const spec = VEHICLE_SPECS[vClass];
    const lw = getLaneWidth(this.config);

    let lateralOffset = 0;
    if (vClass === 'motor' && lw >= 3.1) {
      if (turn === 'left') lateralOffset = this.rng() < 0.9 ? lw * 0.24 : lw * 0.1;
      else if (turn === 'right') lateralOffset = this.rng() < 0.9 ? -lw * 0.24 : -lw * 0.1;
      else if (this.config.motorSwarmMode) {
        const cols = [-0.34 * lw, -0.11 * lw, 0.11 * lw, 0.34 * lw];
        lateralOffset = cols[Math.floor(this.rng() * cols.length)];
      } else {
        lateralOffset = this.rng() < 0.5 ? -lw * 0.27 : lw * 0.27;
      }
    } else if (vClass === 'car') {
      lateralOffset = (this.rng() - 0.5) * 0.16;
    }

    const myEffW = vClass === 'motor' ? 0.72 : spec.width;
    const minClearance =
      this.config.motorSwarmMode && vClass === 'motor'
        ? spec.length + spec.minGap + 1.8
        : spec.length + spec.minGap + 4.5;
    const armCandidates = this.pickWeightedArmOrder();

    for (const arm of armCandidates) {
      const laneIndex = this.pickLaneForTurn(arm, turn);
      const myGlobalLat = getGlobalLat(laneIndex, lateralOffset, lw);
      let nearestAheadSpeed = Infinity;
      let blocked = false;

      for (const other of this.vehicles) {
        if (other.originArm !== arm) continue;
        const latSep = Math.abs(myGlobalLat - getGlobalLat(other.laneIndex, other.lateralOffset, lw));
        const targetLatSep = Math.abs(myGlobalLat - getGlobalLat(other.laneIndex, other.targetLateralOffset, lw));
        if (Math.min(latSep, targetLatSep) < (myEffW + effClearanceWidth(other)) * 0.5 + 0.25) {
          if (other.distanceAlongPath < other.length * 0.5 + minClearance) {
            blocked = true;
            break;
          }
          if (other.distanceAlongPath < 25) nearestAheadSpeed = Math.min(nearestAheadSpeed, other.speed);
        }
      }
      if (blocked) continue;

      this.armSpawnCursor = (ARM_ORDER.indexOf(arm) + 1) % ARM_ORDER.length;
      const r = this.rng();
      const profile: DriverProfile = r < 0.22 ? 'cautious' : r < 0.72 ? 'normal' : 'aggressive';
      const pMult = PROFILE_MULT[profile];
      const path = this.pathCache[arm][turn][laneIndex];
      const speedFactor = pMult.speed * (0.95 + this.rng() * 0.1);
      const accelFactor = pMult.accel * (0.95 + this.rng() * 0.1);
      const initialSpeed = Math.min(spec.maxSpeed * speedFactor * 0.65, nearestAheadSpeed + 1.5);
      const startPt = sampleWithLateralOffset(path, 0, lateralOffset, 0, initialSpeed);
      const sprites = SPRITES[vClass];

      this.vehicles.push({
        id: this.nextVehicleId++,
        vClass,
        spriteKey: sprites[Math.floor(this.rng() * sprites.length)],
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
        prevAccel: 0,
        boxWaitTime: 0,
        willRunRed:
          vClass === 'motor'
            ? profile === 'aggressive' ? this.rng() < 0.85 : profile === 'normal' ? this.rng() < 0.50 : this.rng() < 0.15
            : vClass === 'car'
            ? profile === 'aggressive' ? this.rng() < 0.65 : profile === 'normal' ? this.rng() < 0.25 : this.rng() < 0.05
            : profile === 'aggressive' ? this.rng() < 0.20 : profile === 'normal' ? this.rng() < 0.05 : false,
        yellowCommitted: false,
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
    return false;
  }

  private getArmLight(arm: ArmId): SignalColor {
    return this.isAllRed ? 'red' : ARM_ORDER[this.activeArmIndex] === arm ? this.activeColor : 'red';
  }

  private isBoxOccupiedByOtherArm(arm: ArmId): boolean {
    for (const other of this.vehicles) {
      if (other.originArm === arm) continue;
      if (
        other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.5 &&
        other.distanceAlongPath - other.length * 0.5 < other.exitLineDist - 0.5
      ) {
        return true;
      }
    }
    return false;
  }

  private hasLeftTurnMergeConflict(v: SimVehicle): boolean {
    for (const other of this.vehicles) {
      if (other.id === v.id) continue;
      if (other.originArm === v.originArm) {
        // Wait if a same-lane vehicle ahead is still entering/clearing the stop-line zone
        if (
          other.laneIndex === v.laneIndex &&
          other.distanceAlongPath > v.distanceAlongPath &&
          other.distanceAlongPath < other.stopLineDist + 6.0
        ) {
          return true;
        }
        continue;
      }
      if (other.destArm !== v.destArm) continue;
      const inOrExitingMergeZone =
        other.distanceAlongPath + other.length * 0.5 > other.stopLineDist - 2.0 &&
        other.distanceAlongPath - other.length * 0.5 < other.exitLineDist + 4.0;
      if (inOrExitingMergeZone) return true;
      const otherLight = this.getArmLight(other.originArm);
      if (otherLight !== 'red' && other.distanceAlongPath < other.stopLineDist) {
        const otherDistToStop = other.stopLineDist - (other.distanceAlongPath + other.length * 0.5);
        if (otherDistToStop < Math.max(8.0, other.speed * 1.8)) return true;
      }
    }
    return false;
  }

  private shouldStopForYellow(v: SimVehicle, distToStop: number): boolean {
    if (v.yellowCommitted) return false;
    if (v.willRunRed && ((distToStop < 44.0 && v.speed > 1.5) || distToStop < 12.0)) {
      v.yellowCommitted = true;
      return false;
    }
    if (v.vClass !== 'heavy' && v.profile !== 'cautious' && distToStop < v.speed * (this.phaseRemaining + 0.45)) {
      v.yellowCommitted = true;
      return false;
    }
    const reactTime = v.profile === 'aggressive' ? 0.65 : v.profile === 'normal' ? 0.8 : 0.95;
    const brakeMult = v.profile === 'aggressive' ? 0.85 : v.profile === 'normal' ? 1.0 : 1.2;
    const comfortableStopDist =
      v.speed * reactTime + (v.speed * v.speed) / (2 * v.comfortDecel * brakeMult);
    // If already too close to stop comfortably, commit to clearing yellow instead of impossible hard brake
    if (distToStop < comfortableStopDist * 0.85) {
      v.yellowCommitted = true;
      return false;
    }
    return distToStop >= comfortableStopDist;
  }

  private updateVehicles(dt: number): void {
    const lw = getLaneWidth(this.config);
    const roadW = getEffectiveRoadWidth(this.config);
    const widthSpeedFactor = Math.max(0.84, Math.min(1.08, 0.84 + (lw - 2.8) * 0.1714));
    const widthHeadwayFactor = Math.max(0.92, Math.min(1.18, 1.18 - (lw - 2.8) * 0.1857));

    const decisions: {
      v: SimVehicle;
      nextSpeed: number;
      nextLat: number;
      nextLatVel: number;
      physicalGap: number;
      physicalLeadSpeed: number;
      hasBlockingLeader: boolean;
    }[] = [];

    for (const v of this.vehicles) {
      if (v.reactionTimer > 0) v.reactionTimer = Math.max(0, v.reactionTimer - dt);
      const light = this.getArmLight(v.originArm);
      if (light === 'green') v.yellowCommitted = false;

      let desiredV = v.maxSpeed * v.speedFactor * widthSpeedFactor;
      if (v.distanceAlongPath >= v.stopLineDist - 14 && v.distanceAlongPath <= v.exitLineDist) {
        const R = getTurnRadius(v.turn, v.laneIndex, this.config);
        if (Number.isFinite(R)) {
          const curveV = Math.max(4.0, Math.sqrt((v.vClass === 'heavy' ? 1.35 : 2.2) * R));
          if (v.distanceAlongPath < v.stopLineDist) {
            const ramp = Math.max(0, Math.min(1, (v.stopLineDist - v.distanceAlongPath) / 14));
            desiredV = Math.min(desiredV, curveV + (desiredV - curveV) * ramp);
          } else {
            desiredV = Math.min(desiredV, curveV);
          }
        }
      }

      let { nearestGap, leadSpeed, blockingLeader, isSqueezingPast } = findBlockingLeader(v, this.vehicles, lw);
      const physicalGap = nearestGap;
      const physicalLeadSpeed = leadSpeed;
      const hasBlockingLeader =
        !isSqueezingPast &&
        blockingLeader !== null &&
        ((blockingLeader.originArm === v.originArm &&
          (blockingLeader.laneIndex === v.laneIndex || blockingLeader.turn === v.turn)) ||
          blockingLeader.destArm === v.destArm);

      let stoppingForSignal = false;
      let canLTOR = false;
      const effectiveStopDist =
        this.config.motorBoxEnabled && v.vClass !== 'motor' ? v.stopLineDist - 3.5 : v.stopLineDist;
      const distToStop = effectiveStopDist - (v.distanceAlongPath + v.length * 0.5);
      const alreadyInBox = v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.25;
      if (v.distanceAlongPath < v.stopLineDist && !alreadyInBox) {
        const stopForYellow = light === 'yellow' && this.shouldStopForYellow(v, distToStop);
        if (light === 'yellow' && !stopForYellow && v.turn === 'straight') {
          desiredV *= 1.2;
        }
        canLTOR =
          this.config.leftTurnOnRed &&
          v.turn === 'left' &&
          light === 'red' &&
          !this.isBoxOccupiedByOtherArm(v.originArm) &&
          !this.hasLeftTurnMergeConflict(v);
        if (canLTOR && distToStop < 12) {
          desiredV = Math.min(desiredV, 6.0);
        }
        const canRunEarlyRed =
          light === 'red' &&
          this.isAllRed &&
          v.originArm === ARM_ORDER[this.activeArmIndex] &&
          Boolean(v.willRunRed || v.yellowCommitted) &&
          distToStop < 8.5 &&
          (v.speed > 2.0 || distToStop < 4.0) &&
          distToStop / Math.max(2.0, v.speed) < this.phaseRemaining &&
          !this.isBoxOccupiedByOtherArm(v.originArm);
        const minBoxHoldDist = (v.speed * v.speed) / (2 * v.comfortDecel * 1.4);
        const holdForOccupiedBox =
          light === 'green' &&
          this.phaseElapsed < 4.0 &&
          distToStop < 16.0 &&
          distToStop >= minBoxHoldDist &&
          this.isBoxOccupiedByOtherArm(v.originArm);
        if (((light === 'red' && !canRunEarlyRed && !canLTOR) || stopForYellow || holdForOccupiedBox) && distToStop < nearestGap) {
          nearestGap = Math.max(0.1, distToStop);
          leadSpeed = 0;
          stoppingForSignal = true;
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
        const candG = getGlobalLat(v.laneIndex, candLat, lw), curG = getGlobalLat(v.laneIndex, v.lateralOffset, lw);
        for (const other of this.vehicles) {
          if (other.id === v.id || other.originArm !== v.originArm) continue;
          const speedBuf = other.distanceAlongPath > v.distanceAlongPath ? Math.max(0, v.speed - other.speed) * 0.6 : 0;
          if (Math.abs(other.distanceAlongPath - v.distanceAlongPath) < (v.length + other.length) * 0.5 + 2.0 + speedBuf) {
            const otherG = getGlobalLat(other.laneIndex, other.lateralOffset + other.lateralVelocity * dt, lw);
            if (Math.abs(candG - otherG) < (myEffW + effClearanceWidth(other)) * 0.5 + 0.18 && Math.abs(candG - otherG) < Math.abs(curG - otherG)) {
              blocked = true; break;
            }
          }
        }
        if (blocked) nextLatVel = 0;
        else if (Math.abs(stepLat) >= Math.abs(latDiff)) { nextLat = v.targetLateralOffset; nextLatVel = 0; }
        else nextLat += stepLat;
      } else {
        nextLatVel *= Math.max(0, 1 - 10 * dt);
      }

      // Smooth urban IDM with continuous brake curve & jerk limiting + responsive launch
      let nextSpeed = v.speed;
      if (v.reactionTimer > 0 && light === 'green' && v.speed < 0.05) {
        nextSpeed = 0;
        v.prevAccel = 0;
      } else {
        if (v.speed < 0.15) v.prevAccel = Math.max(0, v.prevAccel ?? 0);
        const effAccel = v.maxAccel * v.accelFactor;
        const minGap = v.vClass === 'motor' && v.speed < 4.5 ? 0.65 : v.minGap;
        const headway = (v.vClass === 'motor' && v.speed < 4.5 ? 0.5 : v.timeHeadway) * widthHeadwayFactor;
        const dv = v.speed - leadSpeed;
        const sStar = minGap + Math.max(0, v.speed * headway + (v.speed * dv) / (2 * Math.sqrt(effAccel * v.comfortDecel)));
        const freeRatioPow4 = Math.min(8, Math.pow(v.speed / Math.max(1, desiredV), 4));
        const rawAccel = effAccel * (1 - freeRatioPow4 - (Number.isFinite(nearestGap) ? Math.pow(sStar / Math.max(0.05, nearestGap), 2) : 0));
        // Responsive launch from standstill when green and gap is open
        const canLaunch =
          v.speed < 2.5 &&
          nearestGap >= minGap * 0.9 &&
          (light === 'green' || v.distanceAlongPath >= v.stopLineDist || canLTOR) &&
          (leadSpeed > 0.05 || nearestGap > minGap * 1.2) &&
          (rawAccel > 0 || nearestGap > minGap * 2.5);
        const launchBoost = canLaunch ? effAccel * (0.78 * (1 - v.speed / 2.8)) : -Infinity;
        const closeT = Number.isFinite(nearestGap) ? Math.max(0, Math.min(1, (20 - nearestGap) / 16)) : 0;
        const maxEmergencyDecel = v.vClass === 'motor' ? 6.8 : 5.2;
        const brakeLimit = -(v.comfortDecel + (maxEmergencyDecel - v.comfortDecel) * closeT);
        const hardBrakeLimit =
          nearestGap < minGap * 0.65 && leadSpeed < v.speed - 0.5
            ? -Math.max(maxEmergencyDecel * 1.4, 8.8)
            : brakeLimit;
        const targetAccel = Math.max(launchBoost, Math.max(hardBrakeLimit, Math.min(effAccel, rawAccel)));

        const prevA = v.prevAccel ?? 0;
        const criticalStop = nearestGap < minGap * 0.9;
        const imminentStop = nearestGap < minGap * 1.2 || (stoppingForSignal && nearestGap < minGap * 1.5);
        const maxBrakeJerk = imminentStop ? -55.0 * dt : -14.0 * dt;
        const smoothedAccel =
          targetAccel < prevA && criticalStop
            ? targetAccel
            : prevA + Math.max(maxBrakeJerk, Math.min(18.0 * dt, targetAccel - prevA));
        v.prevAccel = smoothedAccel;
        const candidateSpeed = Math.max(0, v.speed + smoothedAccel * dt);
        nextSpeed =
          candidateSpeed > desiredV * 1.05
            ? Math.min(candidateSpeed, Math.max(desiredV * 1.05, v.speed - v.comfortDecel * dt))
            : candidateSpeed;
        if (nearestGap <= 0.1 && nextSpeed > leadSpeed) {
          nextSpeed = Math.max(0, leadSpeed);
        }
      }

      decisions.push({ v, nextSpeed, nextLat, nextLatVel, physicalGap, physicalLeadSpeed, hasBlockingLeader });
    }

    const toRemove = new Set<number>();
    for (const { v, nextSpeed, nextLat, nextLatVel, physicalGap, physicalLeadSpeed, hasBlockingLeader } of decisions) {
      v.speed = nextSpeed; v.lateralOffset = nextLat; v.lateralVelocity = nextLatVel;
      const minBuffer = 0.05;
      const rawAdvance = v.speed * dt;
      const maxAdvance =
        hasBlockingLeader && Number.isFinite(physicalGap)
          ? Math.max(0, physicalGap + Math.max(0, physicalLeadSpeed) * dt - minBuffer)
          : rawAdvance;
      v.distanceAlongPath += Math.min(rawAdvance, maxAdvance);
      if (v.speed < QUEUE_SPEED_THRESHOLD && v.distanceAlongPath < v.stopLineDist) v.waitingTime += dt;
      if (v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 && !v.hasExitedIntersection) {
        if (v.speed < 0.5) {
          v.boxWaitTime = (v.boxWaitTime ?? 0) + dt;
        } else if (v.speed >= 1.5) {
          v.boxWaitTime = 0;
        }
      } else {
        v.boxWaitTime = 0;
      }
      if (!v.hasExitedIntersection && v.distanceAlongPath >= v.exitLineDist) {
        v.hasExitedIntersection = true;
        this.totalExitedAllTime += 1;
        this.totalExitedWaitTime += v.waitingTime;
        this.exitedWaitCount += 1;
        if (v.waitingTime > this.maxWaitTimeObserved) this.maxWaitTimeObserved = v.waitingTime;
        this.currentPhaseExited[v.vClass] += 1; this.currentPhaseExited.total += 1;
        this.currentCycleExited[v.vClass] += 1; this.currentCycleExited.total += 1;
      }
      if (v.distanceAlongPath >= v.totalPathLength) toRemove.add(v.id);
      else {
        const pt = sampleWithLateralOffset(v.path, v.distanceAlongPath, v.lateralOffset, v.lateralVelocity, v.speed);
        v.x = pt.x; v.y = pt.y; v.heading = pt.heading;
      }
    }
    if (toRemove.size > 0) {
      this.vehicles = this.vehicles.filter((v) => !toRemove.has(v.id));
    }
  }

  private countQueue(): number {
    return this.vehicles.filter((v) => v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD).length;
  }

  private countQueueForArm(arm: ArmId): number {
    return this.vehicles.filter(
      (v) => v.originArm === arm && v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD
    ).length;
  }

  public getSnapshot(): SimSnapshot {
    const queueByArm: Record<ArmId, number> = { north: 0, east: 0, south: 0, west: 0 };
    let activeQueueCount = 0;
    let boxStuckCount = 0;
    for (const v of this.vehicles) {
      if (v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD) { queueByArm[v.originArm] += 1; activeQueueCount += 1; }
      if (v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 && !v.hasExitedIntersection && (v.boxWaitTime ?? 0) >= 2.0) {
        boxStuckCount += 1;
      }
    }
    const activeArm = ARM_ORDER[this.activeArmIndex];
    const avgWaitTime = this.exitedWaitCount > 0 ? +(this.totalExitedWaitTime / this.exitedWaitCount).toFixed(1) : 0;
    const maxWaitTime = +this.maxWaitTimeObserved.toFixed(1);
    const throughputPerHour = this.simTime > 1 ? Math.round((this.totalExitedAllTime / this.simTime) * 3600) : 0;
    return {
      config: { ...this.config },
      signal: {
        activeArm,
        activeColor: this.activeColor,
        phaseRemaining: Math.max(0, this.phaseRemaining),
        phaseElapsed: this.phaseElapsed,
        cycleNumber: this.cycleNumber,
        armLights: { north: this.getArmLight('north'), east: this.getArmLight('east'), south: this.getArmLight('south'), west: this.getArmLight('west') },
      },
      vehicles: this.vehicles.map(({ path: _p, targetLateralOffset: _t, lateralVelocity: _lv, speedFactor: _sf, accelFactor: _af, profile: _pr, reactionTimer: _rt, boxWaitTime: _bw, willRunRed: _wr, ...rest }) => rest),
      stats: {
        simTime: this.simTime,
        currentPhaseExited: { ...this.currentPhaseExited },
        currentCycleExited: { ...this.currentCycleExited },
        totalExitedAllTime: this.totalExitedAllTime,
        avgWaitTime,
        maxWaitTime,
        throughputPerHour,
        boxStuckCount,
        activeQueueCount,
        queueByArm,
        phaseHistory: [...this.phaseHistory],
        cycleHistory: [...this.cycleHistory],
      },
    };
  }
}
