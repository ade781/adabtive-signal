import {
  pickNextArmAdaptive,
  pickNextPhaseAdaptive,
  shouldExtendGreenPhase,
  shouldExtendPhaseAdaptive,
} from './adaptiveController';
import {
  assignReactionWave,
  effClearanceWidth,
  findBlockingLeader,
  getGlobalLat,
  SimVehicle,
} from './behaviors';
import {
  computeDisciplineParams,
  DisciplineParams,
  evaluateBlinkerIntentPocket,
  evaluatePriorityConflictYield,
  evaluateSvoCourtesyYield,
  evaluateZipperMergeGiveWay,
  negotiateDeadlockPriority,
  shouldHoldForConflictCorridor,
  shouldHoldForYellowBox,
} from './conflictResolver';
import {
  ARM_ORDER,
  DEFAULT_CONFIG,
  getArmGreenDuration,
  QUEUE_SPEED_THRESHOLD,
  VEHICLE_SPECS,
} from './constants';
import {
  ARCHETYPE_ORDER,
  computeContextualBehaviorMod,
  getDriverTraits,
  normalizeDriverProfileMix,
  resolveSpawnDriverIdentity,
} from './driverIntelligence';
import { DEFAULT_ENVIRONMENT, EnvironmentState, evaluateEnvironment } from './environmentDynamics';
import { getEffectiveRoadWidth, getLaneWidth, sampleWithLateralOffset } from './geometry';
import {
  computeIidmAcceleration,
  computeMultiAnticipativeLeader,
  evaluateGlosaAndPlatoonDischarge,
  smoothLongitudinalAccel,
} from './longitudinalAI';
import {
  evaluateMapContextMod,
  MapBehavioralContext,
  resolveMapContext,
  SpatialFrictionGrid,
} from './mapContextAI';
import { evaluateMotorcycleCorridorTarget, hasMotorSwarmPlatoonShield } from './motorcycleAI';
import {
  evaluateCourtesyLaneShift,
  evaluateDefensiveYieldForOncomingOvertaker,
  evaluateMobilLaneChange,
  updateOncomingOvertakeFSM,
} from './overtakingAI';
import {
  evaluateOcclusionPeekingCap,
  evaluateVehiclePerceptionProfile,
  getEffectiveBlinkerDir,
} from './perceptionAI';
import { SpatialHashGrid } from './spatialHash';
import {
  clampCandidateLateralStep,
  computeCurvatureTargetSpeed,
  computeHeavyWideTurnTargetOffset,
  computePurePursuitLateralStep,
  computeSafeLateralTarget,
  enforceParallelLateralSeparation,
  evaluatePredictiveConflict2D,
  resolvePairwiseLateralGuard,
} from './steeringAI';
import { compileTopology, simConfigToTopology } from './topologyBuilder';
import {
  CompiledMovementPath,
  CompiledTopology,
  MovementKind,
  MovementSignalState,
  SignalPhaseDef,
} from './topologyTypes';
import {
  ArchetypeStat,
  ArmId,
  CycleRecord,
  DriverArchetype,
  PhaseRecord,
  SignalColor,
  SimConfig,
  SimSnapshot,
  VehicleClass,
  VehicleIntentTag,
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
  const uTurnPct = Math.max(0, Math.min(30, Number.isFinite(raw.uTurnPct) ? raw.uTurnPct! : 0));
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
    uTurnPct,
    greenDuration,
    armGreenDurations,
    yellowDuration,
    allRedDuration,
    armWeights,
    signalPhasePreset: raw.signalPhasePreset ?? '4-phase-split',
    leftTurnOnRed: Boolean(raw.leftTurnOnRed ?? DEFAULT_CONFIG.leftTurnOnRed),
    motorSwarmMode: Boolean(raw.motorSwarmMode ?? DEFAULT_CONFIG.motorSwarmMode),
    motorBoxEnabled: Boolean(raw.motorBoxEnabled ?? DEFAULT_CONFIG.motorBoxEnabled),
    hasMedian: Boolean(raw.hasMedian ?? DEFAULT_CONFIG.hasMedian),
    yellowBoxEnabled: Boolean(raw.yellowBoxEnabled ?? DEFAULT_CONFIG.yellowBoxEnabled),
    driverDiscipline: Math.max(0, Math.min(1, Number.isFinite(raw.driverDiscipline) ? raw.driverDiscipline! : 0.72)),
    driverProfileMix: raw.driverProfileMix
      ? normalizeDriverProfileMix(raw.driverProfileMix)
      : { ...DEFAULT_CONFIG.driverProfileMix! },
    smartOvertaking: raw.smartOvertaking !== false,
    oncomingOvertaking: raw.oncomingOvertaking !== false,
    connectedVehicleRatio: Math.max(0, Math.min(1, Number.isFinite(raw.connectedVehicleRatio) ? raw.connectedVehicleRatio! : 0)),
    environment: raw.environment ? { ...DEFAULT_ENVIRONMENT, ...raw.environment } : { ...DEFAULT_ENVIRONMENT },
  };
}

function toLegacyArmId(armId: string): ArmId {
  if (armId === 'north' || armId === 'east' || armId === 'south' || armId === 'west') {
    return armId;
  }
  return 'north';
}

function makeVehiclePathWrapper(compiled: CompiledMovementPath): SimVehicle['path'] {
  return {
    turn: compiled.movement === 'uturn' ? 'right' : compiled.movement,
    stopLineDist: compiled.stopLineDist,
    exitLineDist: compiled.exitLineDist,
    totalPathLength: compiled.totalPathLength,
    sample: (d: number) => compiled.sample(d),
  };
}

export class TrafficSimulation {
  private config: SimConfig;
  private compiledTopology: CompiledTopology;
  private phases: SignalPhaseDef[] = [];
  private spatialHash = new SpatialHashGrid(10);
  private queryBufA: SimVehicle[] = [];
  private queryBufB: SimVehicle[] = [];

  private vehicles: SimVehicle[] = [];
  private nextVehicleId = 1;
  private armSpawnCursor = 0;

  private simTime = 0;
  private activePhaseIndex = 0;
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

  // v2 telemetry counters & rolling 60s window
  private rollingExits: { t: number; wait: number }[] = [];
  private carOvertakeCount = 0;
  private oncomingOvertakeCount = 0;
  private yieldConflictCount = 0;
  private yellowBoxHoldCount = 0;
  private reverseRecoveryCount = 0;
  private markingCrossCount = 0;
  private archetypeStats: Record<
    DriverArchetype,
    {
      exited: number;
      totalWait: number;
      overtakes: number;
      markingCrosses: number;
      hardBrakes: number;
      yieldsGiven: number;
      yellowBoxHolds: number;
      tailgateYields: number;
      handshakes: number;
      frustrationSum: number;
      frustrationSamples: number;
      speedSum: number;
      speedSamples: number;
    }
  > = {
    defensive: { exited: 0, totalWait: 0, overtakes: 0, markingCrosses: 0, hardBrakes: 0, yieldsGiven: 0, yellowBoxHolds: 0, tailgateYields: 0, handshakes: 0, frustrationSum: 0, frustrationSamples: 0, speedSum: 0, speedSamples: 0 },
    commuter: { exited: 0, totalWait: 0, overtakes: 0, markingCrosses: 0, hardBrakes: 0, yieldsGiven: 0, yellowBoxHolds: 0, tailgateYields: 0, handshakes: 0, frustrationSum: 0, frustrationSamples: 0, speedSum: 0, speedSamples: 0 },
    hurried: { exited: 0, totalWait: 0, overtakes: 0, markingCrosses: 0, hardBrakes: 0, yieldsGiven: 0, yellowBoxHolds: 0, tailgateYields: 0, handshakes: 0, frustrationSum: 0, frustrationSamples: 0, speedSum: 0, speedSamples: 0 },
    courier: { exited: 0, totalWait: 0, overtakes: 0, markingCrosses: 0, hardBrakes: 0, yieldsGiven: 0, yellowBoxHolds: 0, tailgateYields: 0, handshakes: 0, frustrationSum: 0, frustrationSamples: 0, speedSum: 0, speedSamples: 0 },
    transit: { exited: 0, totalWait: 0, overtakes: 0, markingCrosses: 0, hardBrakes: 0, yieldsGiven: 0, yellowBoxHolds: 0, tailgateYields: 0, handshakes: 0, frustrationSum: 0, frustrationSamples: 0, speedSum: 0, speedSamples: 0 },
    logistics: { exited: 0, totalWait: 0, overtakes: 0, markingCrosses: 0, hardBrakes: 0, yieldsGiven: 0, yellowBoxHolds: 0, tailgateYields: 0, handshakes: 0, frustrationSum: 0, frustrationSamples: 0, speedSum: 0, speedSamples: 0 },
  };
  private envState: EnvironmentState = evaluateEnvironment(0, DEFAULT_ENVIRONMENT);
  private mapContext: MapBehavioralContext = resolveMapContext(DEFAULT_CONFIG);
  private frictionGrid = new SpatialFrictionGrid(28, 90);

  constructor(initialConfig?: Partial<SimConfig>) {
    this.config = normalizeConfig({ ...DEFAULT_CONFIG, ...initialConfig });
    this.compiledTopology = compileTopology(simConfigToTopology(this.config));
    this.phases = this.compiledTopology.topology.phases;
    this.mapContext = resolveMapContext(this.config);
    this.reset();
  }

  public getCompiledTopology(): CompiledTopology {
    return this.compiledTopology;
  }

  private isClassic4ArmSplit(): boolean {
    return (
      !this.config.customTopology &&
      (this.config.signalPhasePreset ?? '4-phase-split') === '4-phase-split' &&
      this.phases.length === 4 &&
      this.compiledTopology.armOrder.length === 4
    );
  }

  private getPhaseGreenDuration(phaseIdx: number): number {
    const ph = this.phases[phaseIdx];
    if (!ph) return this.config.greenDuration;
    if (this.isClassic4ArmSplit()) {
      return getArmGreenDuration(this.config, ARM_ORDER[phaseIdx % 4]);
    }
    return Math.max(3, Math.min(180, ph.baseGreen));
  }

  public reset(): void {
    this.vehicles = [];
    this.nextVehicleId = 1;
    this.armSpawnCursor = 0;
    this.simTime = 0;
    this.activePhaseIndex = 0;
    this.activeColor = 'green';
    this.isAllRed = false;
    this.phaseRemaining = this.getPhaseGreenDuration(0);
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
    this.rollingExits = [];
    this.carOvertakeCount = 0;
    this.oncomingOvertakeCount = 0;
    this.yieldConflictCount = 0;
    this.yellowBoxHoldCount = 0;
    this.reverseRecoveryCount = 0;
    this.markingCrossCount = 0;
    for (const arch of ARCHETYPE_ORDER) {
      const st = this.archetypeStats[arch];
      st.exited = 0;
      st.totalWait = 0;
      st.overtakes = 0;
      st.markingCrosses = 0;
      st.hardBrakes = 0;
      st.yieldsGiven = 0;
      st.yellowBoxHolds = 0;
      st.tailgateYields = 0;
      st.handshakes = 0;
      st.frustrationSum = 0;
      st.frustrationSamples = 0;
      st.speedSum = 0;
      st.speedSamples = 0;
    }
    this.envState = evaluateEnvironment(0, this.config.environment);
    this.mapContext = resolveMapContext(this.config);
    this.frictionGrid.reset(Math.max(55, Math.ceil(this.compiledTopology.maxExtentMeters)));
    this.spatialHash.clear();
  }

  public updateConfig(partial: Partial<SimConfig>): void {
    const prev = this.config;
    this.config = normalizeConfig({ ...this.config, ...partial });
    this.mapContext = resolveMapContext(this.config);

    const customTopologyChanged =
      partial.customTopology !== undefined && partial.customTopology !== prev.customTopology;
    const prevTopologyId = prev.customTopology?.id ?? 'standard';
    const nextTopologyId = this.config.customTopology?.id ?? 'standard';

    // Recompile topology whenever geometry, phases, or customTopology change
    const geometryChanged =
      customTopologyChanged ||
      prevTopologyId !== nextTopologyId ||
      prev.lanesPerDirection !== this.config.lanesPerDirection ||
      prev.laneWidth !== this.config.laneWidth ||
      prev.roadLength !== this.config.roadLength ||
      prev.hasMedian !== this.config.hasMedian ||
      prev.leftTurnOnRed !== this.config.leftTurnOnRed ||
      prev.motorBoxEnabled !== this.config.motorBoxEnabled ||
      prev.signalPhasePreset !== this.config.signalPhasePreset ||
      prev.greenDuration !== this.config.greenDuration ||
      prev.yellowDuration !== this.config.yellowDuration ||
      prev.allRedDuration !== this.config.allRedDuration ||
      prev.armGreenDurations !== this.config.armGreenDurations ||
      prev.armWeights !== this.config.armWeights ||
      prev.armNames !== this.config.armNames;

    if (geometryChanged) {
      this.compiledTopology = compileTopology(simConfigToTopology(this.config));
      this.phases = this.compiledTopology.topology.phases;
      if (this.activePhaseIndex >= this.phases.length) {
        this.activePhaseIndex = 0;
      }
      const nextExtent = Math.max(55, Math.ceil(this.compiledTopology.maxExtentMeters));
      if (Math.abs(this.frictionGrid.extentMeters - nextExtent) > 5) {
        this.frictionGrid.reset(nextExtent);
      }
    }

    // If customTopology changed structure completely, do a clean reset
    if (customTopologyChanged || prevTopologyId !== nextTopologyId) {
      this.reset();
      return;
    }

    // Live rescaling for standard 4-arm parametric updates (preserves running vehicles smoothly)
    if (
      !this.config.customTopology &&
      (prev.lanesPerDirection !== this.config.lanesPerDirection ||
        prev.laneWidth !== this.config.laneWidth ||
        prev.roadLength !== this.config.roadLength)
    ) {
      const maxLane = Math.max(0, this.config.lanesPerDirection - 1);
      const lw = getLaneWidth(this.config);

      for (const v of this.vehicles) {
        v.laneIndex = Math.min(v.laneIndex, maxLane);
        v.overtakeState = 'none';
        v.overtakeTargetId = undefined;
        if (v.vClass !== 'motor') {
          v.lateralOffset = 0;
          v.targetLateralOffset = 0;
          v.lateralVelocity = 0;
          v.laneChangeDir = null;
        } else {
          const maxLat = Math.max(0, lw * 0.5 - 0.42);
          const minInnerClear =
            !this.config.hasMedian &&
              this.config.lanesPerDirection === 1 &&
              lw <= 3.3 &&
              v.distanceAlongPath >= v.stopLineDist - 14.0
              ? 1.02
              : 0.42;
          const minLat = Math.min(maxLat, -(lw * 0.5 - minInnerClear));
          v.lateralOffset = Math.max(minLat, Math.min(maxLat, v.lateralOffset));
          v.targetLateralOffset = Math.max(minLat, Math.min(maxLat, v.targetLateralOffset));
        }
        const oldStop = v.stopLineDist;
        const oldExit = v.exitLineDist;
        const oldTotal = v.totalPathLength;
        const newCompiled = this.compiledTopology.pathLookup[v.originArm]?.[v.turn]?.[v.laneIndex];
        if (!newCompiled) continue;
        let scaledDist: number;
        if (v.distanceAlongPath < oldStop) {
          const segRel = oldStop > 0 ? v.distanceAlongPath / oldStop : 0;
          const safeApproachCap = Math.max(0, newCompiled.stopLineDist - (v.length * 0.5 + 0.45));
          scaledDist = Math.min(safeApproachCap, segRel * newCompiled.stopLineDist);
        } else if (v.distanceAlongPath <= oldExit) {
          const oldBoxLen = Math.max(1e-3, oldExit - oldStop);
          const segRel = (v.distanceAlongPath - oldStop) / oldBoxLen;
          scaledDist = newCompiled.stopLineDist + segRel * (newCompiled.exitLineDist - newCompiled.stopLineDist);
        } else {
          const oldExitLen = Math.max(1e-3, oldTotal - oldExit);
          const segRel = (v.distanceAlongPath - oldExit) / oldExitLen;
          scaledDist = newCompiled.exitLineDist + segRel * (newCompiled.totalPathLength - newCompiled.exitLineDist);
        }
        v.compiledPath = newCompiled;
        v.pathKey = newCompiled.key;
        v.destLaneIndex = newCompiled.destLane;
        v.path = makeVehiclePathWrapper(newCompiled);
        v.stopLineDist = newCompiled.stopLineDist;
        v.exitLineDist = newCompiled.exitLineDist;
        v.totalPathLength = newCompiled.totalPathLength;
        v.distanceAlongPath = Math.max(0, Math.min(newCompiled.totalPathLength, scaledDist));
        const pt = sampleWithLateralOffset(v.path, v.distanceAlongPath, v.lateralOffset, 0, v.speed);
        v.x = pt.x;
        v.y = pt.y;
        v.heading = pt.heading;
      }

      // De-overlap when shrinking lanes, width, or road length
      if (
        this.config.lanesPerDirection < prev.lanesPerDirection ||
        this.config.roadLength < prev.roadLength ||
        this.config.laneWidth < prev.laneWidth
      ) {
        const overflowIds = new Set<number>();
        for (const arm of ARM_ORDER) {
          for (let lane = 0; lane < this.config.lanesPerDirection; lane++) {
            const laneVehs = this.vehicles
              .filter((v) => v.originArm === arm && v.laneIndex === lane && v.distanceAlongPath < v.stopLineDist)
              .sort((a, b) => b.distanceAlongPath - a.distanceAlongPath);
            const kept: SimVehicle[] = this.vehicles
              .filter(
                (v) =>
                  v.originArm === arm &&
                  v.laneIndex === lane &&
                  v.distanceAlongPath >= v.stopLineDist &&
                  v.distanceAlongPath < v.stopLineDist + 10.0
              )
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
                  cur.x = pt.x;
                  cur.y = pt.y;
                  cur.heading = pt.heading;
                } else {
                  const gap = blockingLead.distanceAlongPath - cur.distanceAlongPath - halfSum;
                  const effBrake = 4.5 * this.envState.weather.comfortDecelMult;
                  const safeSpeed = Math.sqrt(Math.max(0, blockingLead.speed * blockingLead.speed + 2 * effBrake * Math.max(0, gap - cur.minGap)));
                  cur.speed = Math.min(cur.speed, safeSpeed);
                }
              }
              kept.push(cur);
            }
          }
        }
        if (overflowIds.size > 0) this.vehicles = this.vehicles.filter((v) => !overflowIds.has(v.id));

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
              if (Math.hypot(a.x - b.x, a.y - b.y) < minSep) exitDropIds.add(b.id);
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
              if (Math.hypot(a.x - b.x, a.y - b.y) < minSep) exitDropIds.add(b.id);
            }
          }
        }
        if (exitDropIds.size > 0) this.vehicles = this.vehicles.filter((v) => !exitDropIds.has(v.id));
        enforceParallelLateralSeparation(
          this.vehicles,
          lw,
          this.compiledTopology.armsById,
          this.spatialHash,
          this.queryBufB
        );
      }
    }

    const activeGreen = this.getPhaseGreenDuration(this.activePhaseIndex);
    if (this.activeColor === 'green' && this.phaseRemaining > activeGreen) this.phaseRemaining = activeGreen;
    else if (this.activeColor === 'yellow' && this.phaseRemaining > this.config.yellowDuration) this.phaseRemaining = this.config.yellowDuration;
    else if (this.isAllRed && this.phaseRemaining > this.config.allRedDuration) this.phaseRemaining = this.config.allRedDuration;
  }

  public step(dt: number): void {
    if (!Number.isFinite(dt)) return;
    const clampedDt = Math.min(0.1, Math.max(0.001, dt));
    // Sub-step internally only when an active oncoming pass is underway at large dt > 0.06s
    let hasOncomingPass = false;
    if (clampedDt > 0.06) {
      for (let i = 0; i < this.vehicles.length; i++) {
        const ov = this.vehicles[i].overtakeState;
        if (ov && ov !== 'none') {
          hasOncomingPass = true;
          break;
        }
      }
    }
    const subSteps = hasOncomingPass ? 2 : 1;
    const subDt = clampedDt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      this.simTime += subDt;
      this.envState = evaluateEnvironment(this.simTime, this.config.environment);
      this.frictionGrid.decay(subDt);
      this.advanceSignals(subDt);
      this.spawnVehicles(subDt);
      this.updateVehicles(subDt);
      this.currentCycleQueueSum += this.countQueue() * subDt;
      this.currentCycleQueueTime += subDt;
    }

    // Prune rolling 60s telemetry window
    const cutoff = this.simTime - 60;
    while (this.rollingExits.length > 0 && this.rollingExits[0].t < cutoff) {
      this.rollingExits.shift();
    }
  }

  private advanceSignals(dt: number): void {
    this.phaseRemaining -= dt;
    this.phaseElapsed += dt;

    const activePhase = this.phases[this.activePhaseIndex];

    if (this.activeColor === 'green') {
      this.greenElapsed += dt;
      let cutEarly = false;
      if (this.config.adaptiveSignal && this.phaseRemaining > 0) {
        const activeArmsNow = this.getActivePhaseArmSet();
        const midOncomingOvertake = this.vehicles.some(
          (v) => activeArmsNow.has(v.originArm) && v.distanceAlongPath < v.stopLineDist && v.overtakeState && v.overtakeState !== 'none'
        );
        if (!midOncomingOvertake) {
          if (this.isClassic4ArmSplit()) {
            cutEarly = !shouldExtendGreenPhase(this.vehicles, ARM_ORDER[this.activePhaseIndex], this.phaseElapsed, this.config);
          } else {
            cutEarly = !shouldExtendPhaseAdaptive(
              this.vehicles,
              this.phases,
              this.activePhaseIndex,
              this.phaseElapsed,
              this.compiledTopology
            );
          }
        }
      }

      if (this.phaseRemaining > 0 && !cutEarly) {
        return;
      }

      this.activeColor = 'yellow';
      const yDur = activePhase?.yellowDuration ?? this.config.yellowDuration;
      this.phaseRemaining = Math.max(0.5, yDur);
      return;
    }

    if (this.phaseRemaining > 0) return;

    const overflow = this.phaseRemaining;
    const arDur = activePhase?.allRedDuration ?? this.config.allRedDuration;
    if (this.activeColor === 'yellow' && !this.isAllRed && arDur > 0.05) {
      this.activeColor = 'red';
      this.isAllRed = true;
      this.phaseRemaining = arDur + overflow;
      return;
    }

    const finishedPrimaryArmId = activePhase?.permissions[0]?.armId ?? ARM_ORDER[this.activePhaseIndex % 4];
    const finishedArmLegacy = toLegacyArmId(finishedPrimaryArmId);
    const finishedArms = new Set((activePhase?.permissions ?? []).map((p) => p.armId));
    let queueAtEnd = 0;
    for (const aId of finishedArms) queueAtEnd += this.countQueueForArm(aId);

    this.phaseCounter += 1;
    this.currentCycleDuration += this.phaseElapsed;
    this.currentCycleGreenDuration += this.greenElapsed;
    this.phaseHistory.unshift({
      phaseIndex: this.phaseCounter,
      cycleNumber: this.cycleNumber,
      arm: finishedArmLegacy,
      phaseArmIds: Array.from(finishedArms),
      phaseLabel: activePhase?.label,
      greenDuration: Math.round(this.greenElapsed * 10) / 10,
      exitedMotor: this.currentPhaseExited.motor,
      exitedCar: this.currentPhaseExited.car,
      exitedHeavy: this.currentPhaseExited.heavy,
      exitedTotal: this.currentPhaseExited.total,
      queueAtStart: this.currentPhaseStartQueue,
      queueAtEnd,
    });
    if (this.phaseHistory.length > 200) this.phaseHistory.pop();
    this.currentPhaseExited = { motor: 0, car: 0, heavy: 0, total: 0 };

    this.isAllRed = false;
    if (this.config.adaptiveSignal) {
      this.activePhaseIndex = this.isClassic4ArmSplit()
        ? pickNextArmAdaptive(this.vehicles, this.activePhaseIndex, ARM_ORDER, this.config)
        : pickNextPhaseAdaptive(this.vehicles, this.phases, this.activePhaseIndex);
    } else {
      this.activePhaseIndex = (this.activePhaseIndex + 1) % Math.max(1, this.phases.length);
    }

    this.phasesInCycle += 1;
    if (this.phasesInCycle >= Math.max(1, this.phases.length)) {
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

    const nextPhase = this.phases[this.activePhaseIndex];
    this.activeColor = 'green';
    this.phaseRemaining = this.getPhaseGreenDuration(this.activePhaseIndex) + overflow;
    this.phaseElapsed = 0;
    this.greenElapsed = 0;

    const nextArms = new Set((nextPhase?.permissions ?? []).map((p) => p.armId));
    let startQ = 0;
    for (const aId of nextArms) {
      startQ += this.countQueueForArm(aId);
      const lanes = this.compiledTopology.armsById[aId]?.def.inLanes ?? this.config.lanesPerDirection;
      assignReactionWave(this.vehicles, aId, lanes, this.envState.weather.reactionMult, this.rng);
    }
    this.currentPhaseStartQueue = startQ;
  }

  private pickMovementForArm(armId: string): MovementKind {
    const armGeom = this.compiledTopology.armsById[armId];
    if (!armGeom) return 'straight';

    const avail: { kind: MovementKind; weight: number }[] = [];
    if (armGeom.destByMovement.left && this.config.turnLeftPct > 0) {
      avail.push({ kind: 'left', weight: this.config.turnLeftPct });
    }
    if (armGeom.destByMovement.straight && this.config.turnStraightPct > 0) {
      avail.push({ kind: 'straight', weight: this.config.turnStraightPct });
    }
    if (armGeom.destByMovement.right && this.config.turnRightPct > 0) {
      avail.push({ kind: 'right', weight: this.config.turnRightPct });
    }
    const uPct = this.config.uTurnPct ?? (armGeom.def.uTurnBay?.enabled ? 4 : 0);
    if (armGeom.destByMovement.uturn && uPct > 0) {
      avail.push({ kind: 'uturn', weight: uPct });
    }

    if (avail.length === 0) {
      const anyKey = Object.keys(armGeom.destByMovement)[0] as MovementKind | undefined;
      return anyKey ?? 'straight';
    }
    const sum = avail.reduce((s, a) => s + a.weight, 0);
    let roll = this.rng() * sum;
    for (const a of avail) {
      roll -= a.weight;
      if (roll <= 0) return a.kind;
    }
    return avail[avail.length - 1].kind;
  }

  private pickLaneForTurn(
    armId: string,
    turn: MovementKind,
    vClass?: VehicleClass,
    archetype?: string
  ): number {
    const armGeom = this.compiledTopology.armsById[armId];
    const L = Math.max(1, armGeom?.def.inLanes ?? this.config.lanesPerDirection);
    if (L === 1) return 0;
    if (turn === 'left') return L - 1;
    if (turn === 'right' || turn === 'uturn') return 0;

    // Queue- & heavy-impedance-aware dynamic lane selection for straight traffic with archetype lane preference
    const laneScores = new Array<number>(L).fill(0);
    for (const v of this.vehicles) {
      if (v.originArm !== armId || v.isSlipLane || v.distanceAlongPath >= v.stopLineDist) continue;
      if (v.laneIndex < 0 || v.laneIndex >= L) continue;
      let cost = v.vClass === 'heavy' ? 2.8 : v.vClass === 'car' ? 1.2 : 0.45;
      if (v.turn === 'right' || v.turn === 'uturn') cost += 1.6;
      if (v.speed < 1.5) cost += 1.4;
      else if (v.speed < 4.5) cost += 0.5;
      if (v.vClass === 'heavy' && v.speed < 5.5) cost += 2.2;
      if (v.distanceAlongPath < 18.0) cost += 1.5;
      laneScores[v.laneIndex] += cost;
    }

    const spawnTraits = vClass
      ? getDriverTraits({
          vClass,
          archetype: archetype as DriverArchetype | undefined,
          profile:
            archetype === 'defensive' || archetype === 'transit'
              ? 'cautious'
              : archetype === 'hurried' || archetype === 'courier'
                ? 'aggressive'
                : 'normal',
        })
      : undefined;
    const curbAff = spawnTraits?.curbLaneAffinity ?? 1.0;
    const isBusBayArm = archetype === 'transit' && this.mapContext.busBayArms.includes(armId);

    let bestLane = 0;
    let bestScore = Infinity;
    const startOffset = Math.floor(this.rng() * L);
    for (let i = 0; i < L; i++) {
      const lane = (startOffset + i) % L;
      // Fix heavy lane bug: in LHT, heavy vehicles (BUS/TRK) strongly prefer the outer left curb lane (L - 1)
      const heavyCruiseBias =
        vClass === 'heavy' && lane === L - 1
          ? -0.55 * curbAff - (isBusBayArm ? 0.5 : 0)
          : vClass === 'heavy' && lane === 0
            ? 0.35
            : 0;
      const archetypeBias =
        lane === L - 1 && curbAff > 1.05
          ? -0.55 * (curbAff - 0.8)
          : lane === 0 && curbAff < 0.85
            ? -0.45 * (1.2 - curbAff)
            : 0;
      const score = laneScores[lane] + heavyCruiseBias + archetypeBias + this.rng() * 0.2;
      if (score < bestScore) {
        bestScore = score;
        bestLane = lane;
      }
    }
    return bestLane;
  }

  private spawnVehicles(dt: number): void {
    const env = this.envState;
    const rates: [VehicleClass, number][] = [
      ['motor', this.config.motorRate * env.demandMultiplier * env.classMultipliers.motor],
      ['car', this.config.carRate * env.demandMultiplier * env.classMultipliers.car],
      ['heavy', this.config.heavyRate * env.demandMultiplier * env.classMultipliers.heavy],
    ];
    for (let i = rates.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [rates[i], rates[j]] = [rates[j], rates[i]];
    }
    for (const [cls, rate] of rates) {
      if (rate <= 0) continue;
      this.spawnAccum[cls] += (rate / 60) * dt;
      while (this.spawnAccum[cls] >= 1) {
        if (this.trySpawnOne(cls)) this.spawnAccum[cls] -= 1;
        else {
          this.spawnAccum[cls] = Math.min(this.spawnAccum[cls], 2);
          break;
        }
      }
    }
  }

  private getEffectiveArmWeight(armId: string): number {
    const base = this.config.customTopology
      ? (this.compiledTopology.armsById[armId]?.def.demandWeight ?? 1)
      : (this.config.armWeights?.[toLegacyArmId(armId)] ?? 1);
    if (base <= 0) return 0;
    const tidal = this.envState.tidalShift;
    if (Math.abs(tidal) < 1e-3) return base;
    // Morning positive tidal boosts north/west (inbound city); evening negative boosts south/east
    const armGeom = this.compiledTopology.armsById[armId];
    const dirSign = armGeom ? Math.sin(armGeom.angleRad - Math.PI / 4) : 0;
    return Math.max(0.1, base * (1 - tidal * dirSign));
  }

  private pickWeightedArmOrder(): string[] {
    const order = this.compiledTopology.armOrder;
    const candidates: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const armId = order[(this.armSpawnCursor + i) % order.length];
      if (this.getEffectiveArmWeight(armId) > 0) candidates.push(armId);
    }
    if (candidates.length <= 1) return candidates;
    const totalW = candidates.reduce((acc, armId) => acc + this.getEffectiveArmWeight(armId), 0);
    let roll = this.rng() * totalW;
    let firstIdx = 0;
    for (let i = 0; i < candidates.length; i++) {
      roll -= this.getEffectiveArmWeight(candidates[i]);
      if (roll <= 0) {
        firstIdx = i;
        break;
      }
    }
    return [...candidates.slice(firstIdx), ...candidates.slice(0, firstIdx)];
  }

  private trySpawnOne(vClass: VehicleClass): boolean {
    const spec = VEHICLE_SPECS[vClass];
    const discipline = computeDisciplineParams(this.config.driverDiscipline);
    const armCandidates = this.pickWeightedArmOrder();
    const myEffW = vClass === 'motor' ? 0.72 : spec.width;
    const minClearance =
      this.config.motorSwarmMode && vClass === 'motor'
        ? spec.length + spec.minGap + 1.8
        : spec.length + spec.minGap + 4.5;

    const { profile, archetype, spriteKey } = resolveSpawnDriverIdentity(
      vClass,
      this.config,
      this.envState,
      this.rng
    );

    for (const armId of armCandidates) {
      const armGeom = this.compiledTopology.armsById[armId];
      if (!armGeom) continue;

      const turn = this.pickMovementForArm(armId);
      const useSlipLane = turn === 'left' && Boolean(this.compiledTopology.slipPathsByArm[armId]);
      const laneIndex = useSlipLane
        ? armGeom.def.inLanes - 1
        : this.pickLaneForTurn(armId, turn, vClass, archetype);
      const compiledPath: CompiledMovementPath | undefined = useSlipLane
        ? this.compiledTopology.slipPathsByArm[armId]
        : this.compiledTopology.pathLookup[armId]?.[turn]?.[laneIndex];
      if (!compiledPath) continue;

      const lw = armGeom.def.inLaneWidths[laneIndex] ?? getLaneWidth(this.config);
      let lateralOffset = 0;
      if (vClass === 'motor' && !useSlipLane) {
        if (lw >= 3.1) {
          if (turn === 'left') lateralOffset = this.rng() < 0.9 ? lw * 0.24 : lw * 0.1;
          else if (turn === 'right' || turn === 'uturn') lateralOffset = this.rng() < 0.9 ? -lw * 0.24 : -lw * 0.1;
          else if (this.config.motorSwarmMode) {
            const cols = [-0.34 * lw, -0.11 * lw, 0.11 * lw, 0.34 * lw];
            lateralOffset = cols[Math.floor(this.rng() * cols.length)];
          } else {
            lateralOffset = this.rng() < 0.5 ? -lw * 0.27 : lw * 0.27;
          }
        } else if (this.config.motorSwarmMode && lw >= 2.8) {
          if (turn === 'left') lateralOffset = 0.52;
          else if (turn === 'right' || turn === 'uturn') lateralOffset = -0.52;
          else lateralOffset = this.rng() < 0.5 ? -0.52 : 0.52;
        }
      } else if (vClass === 'car') {
        lateralOffset = (this.rng() - 0.5) * 0.16;
      }

      const myGlobalLat = getGlobalLat(laneIndex, lateralOffset, lw, armGeom.inLaneCenters);
      let nearestAheadSpeed = Infinity;
      let blocked = false;

      for (const other of this.vehicles) {
        if (other.originArm !== armId) continue;
        const otherLat = getGlobalLat(other.laneIndex, other.lateralOffset, lw, armGeom.inLaneCenters);
        const otherTargetLat = getGlobalLat(other.laneIndex, other.targetLateralOffset, lw, armGeom.inLaneCenters);
        if (Math.min(Math.abs(myGlobalLat - otherLat), Math.abs(myGlobalLat - otherTargetLat)) < (myEffW + effClearanceWidth(other)) * 0.5 + 0.25) {
          if (other.distanceAlongPath < other.length * 0.5 + minClearance) {
            blocked = true;
            break;
          }
          if (other.distanceAlongPath < 25) nearestAheadSpeed = Math.min(nearestAheadSpeed, other.speed);
        }
      }
      if (blocked) continue;

      const idxInOrder = this.compiledTopology.armOrder.indexOf(armId);
      this.armSpawnCursor = (Math.max(0, idxInOrder) + 1) % this.compiledTopology.armOrder.length;
      const traits = getDriverTraits({ profile, archetype, vClass });
      const speedFactor = traits.speedMult * (0.95 + this.rng() * 0.1);
      const accelFactor = traits.accelMult * (0.95 + this.rng() * 0.1);
      const weatherSpeed = this.envState.weather.speedMult[vClass];
      const initialSpeed = Math.min(spec.maxSpeed * speedFactor * weatherSpeed * 0.65, nearestAheadSpeed + 1.5);
      const pathWrapper = makeVehiclePathWrapper(compiledPath);
      const startPt = sampleWithLateralOffset(pathWrapper, 0, lateralOffset, 0, initialSpeed);

      const classRedCap = vClass === 'motor' ? 0.92 : vClass === 'car' ? 0.75 : 0.25;
      const baseRunRedProb = Math.min(classRedCap, traits.riskTolerance * classRedCap * 1.1);

      const zoneDiscBoost = this.mapContext.cautionArms.includes(armId) ? this.mapContext.zoneDisciplineBoost : 0;
      const effYellowBoxCompliance = Math.max(
        0.05,
        Math.min(0.99, (discipline.yellowBoxCompliance + zoneDiscBoost) * traits.yellowBoxComplianceMult)
      );
      const respectsYellowBox = this.rng() < effYellowBoxCompliance;
      // Strictly 0 when discipline >= 0.65 so RHK pocket invariant remains clean
      const stopCreepMeters =
        discipline.discipline < 0.65 &&
        discipline.stopLineCreepProb > 0 &&
        this.rng() < Math.min(0.95, discipline.stopLineCreepProb * (0.65 + 0.35 * traits.stopCreepBias))
          ? discipline.stopLineCreepMeters * traits.stopCreepBias * (0.5 + 0.5 * this.rng())
          : 0;

      const svoDeg =
        archetype === 'defensive'
          ? 26 + this.rng() * 19
          : archetype === 'transit'
            ? 24 + this.rng() * 18
            : archetype === 'logistics'
              ? 18 + this.rng() * 18
              : archetype === 'commuter'
                ? 12 + this.rng() * 20
                : archetype === 'courier'
                  ? 6 + this.rng() * 14
                  : this.rng() * 14;
      const svoAngle = (svoDeg * Math.PI) / 180;
      const isConnected = this.rng() < (this.config.connectedVehicleRatio ?? 0);

      this.vehicles.push({
        id: this.nextVehicleId++,
        vClass,
        spriteKey,
        originArm: armId,
        destArm: compiledPath.destArmId,
        turn,
        laneIndex,
        destLaneIndex: compiledPath.destLane,
        lateralOffset,
        targetLateralOffset: lateralOffset,
        lateralVelocity: 0,
        steerAngle: 0,
        speedFactor,
        accelFactor,
        profile,
        archetype,
        tailgatePressure: 0,
        reactionTimer: 0,
        prevAccel: 0,
        boxWaitTime: 0,
        stuckTimer: 0,
        reverseTimer: 0,
        reverseCooldown: 0,
        frustration: 0,
        isReversing: false,
        crossingMarking: false,
        markedCrossCounted: false,
        svoAngle,
        isConnected,
        turnSignalActive: null,
        signalLeadTimer: 0,
        pendingLaneChangeDir: null,
        wideSwingState: 'none',
        occlusionPeekActive: false,
        cautionTimer: 0,
        redWaitTime: 0,
        flankingHazard: 0,
        yieldTargetId: undefined,
        leaderId: undefined,
        handshakePartnerId: undefined,
        rhkAnticipating: false,
        intentTag: 'cruise',
        hardBrakeCounted: false,
        yieldCounted: false,
        yellowBoxCounted: false,
        tailgateYieldCounted: false,
        handshakeCounted: false,
        willRunRed: this.rng() < Math.min(0.95, baseRunRedProb * discipline.redLightRunMult),
        yellowCommitted: false,
        respectsYellowBox,
        stopCreepMeters,
        laneChangeCooldown: 0.6,
        overtakeState: 'none',
        isSlipLane: useSlipLane,
        isUTurn: compiledPath.isUTurn,
        laneChangeDir: null,
        ...spec,
        speed: initialSpeed,
        distanceAlongPath: 0,
        totalPathLength: compiledPath.totalPathLength,
        stopLineDist: compiledPath.stopLineDist,
        exitLineDist: compiledPath.exitLineDist,
        x: startPt.x,
        y: startPt.y,
        heading: startPt.heading,
        hasExitedIntersection: false,
        waitingTime: 0,
        path: pathWrapper,
        compiledPath,
        pathKey: compiledPath.key,
      });
      return true;
    }
    return false;
  }

  private getMovementSignal(armId: string, movement: MovementKind, isSlipLane?: boolean): MovementSignalState {
    if (isSlipLane) return 'slip-yield';
    if (this.isAllRed) return 'red';
    const activePhase = this.phases[this.activePhaseIndex];
    if (!activePhase) return 'red';
    for (const perm of activePhase.permissions) {
      if (perm.armId === armId && perm.movements.includes(movement)) {
        if (this.activeColor === 'yellow') return 'yellow';
        return perm.mode === 'protected' ? 'protected-green' : 'permissive-green';
      }
    }
    return 'red';
  }

  private getArmDisplayColor(armId: string): SignalColor {
    if (this.isAllRed) return 'red';
    const activePhase = this.phases[this.activePhaseIndex];
    if (!activePhase) return 'red';
    const hasStraightOrAll = activePhase.permissions.some(
      (p) => p.armId === armId && (p.movements.includes('straight') || p.movements.includes('left'))
    );
    if (hasStraightOrAll) return this.activeColor;
    return 'red';
  }

  private getArmRightArrowColor(armId: string): SignalColor | undefined {
    const usesProtectedRight = this.phases.some((ph) =>
      ph.permissions.some((p) => p.armId === armId && p.movements.includes('right') && !p.movements.includes('straight'))
    );
    if (!usesProtectedRight) return undefined;
    if (this.isAllRed) return 'red';
    const activePhase = this.phases[this.activePhaseIndex];
    if (!activePhase) return 'red';
    const hasRight = activePhase.permissions.some((p) => p.armId === armId && p.movements.includes('right'));
    return hasRight ? this.activeColor : 'red';
  }

  private getActivePhaseArmSet(): Set<string> {
    const s = new Set<string>();
    const ph = this.phases[this.activePhaseIndex];
    if (ph) {
      for (const p of ph.permissions) s.add(p.armId);
    }
    return s;
  }

  /**
   * Checks if the intersection box is occupied by vehicles from arms NOT participating in the same active phase.
   * This allows 2-phase simultaneous N+S / E+W movements without deadlocking each other!
   */
  private isBoxOccupiedByConflictingArm(armId: string): boolean {
    const activeArms = this.getActivePhaseArmSet();
    const myArmInActivePhase = activeArms.has(armId) && !this.isAllRed;
    for (const other of this.vehicles) {
      if (other.originArm === armId || other.isSlipLane || other.isUTurn) continue;
      if (myArmInActivePhase && activeArms.has(other.originArm)) continue;
      if (
        other.distanceAlongPath + other.length * 0.5 > other.stopLineDist + 0.5 &&
        other.distanceAlongPath - other.length * 0.5 < other.exitLineDist - 0.5
      ) {
        return true;
      }
    }
    return false;
  }

  private hasLeftTurnMergeConflict(v: SimVehicle, ltorGapMult = 1.0): boolean {
    for (const other of this.vehicles) {
      if (other.id === v.id) continue;
      if (other.originArm === v.originArm) {
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
      const otherSig = this.getMovementSignal(other.originArm, other.turn, other.isSlipLane);
      if (otherSig !== 'red' && other.distanceAlongPath < other.stopLineDist) {
        const otherDistToStop = other.stopLineDist - (other.distanceAlongPath + other.length * 0.5);
        const gapHorizonSec = (v.speed < 2.2 ? 3.2 : 1.8) * ltorGapMult;
        const minMergeDist = (v.speed < 2.2 ? 14.0 : 8.0) * ltorGapMult;
        if (otherDistToStop < Math.max(minMergeDist, other.speed * gapHorizonSec)) return true;
      }
    }
    return false;
  }

  private applyMotorcycleSeepage(
    v: SimVehicle,
    lw: number,
    roadW: number,
    desiredV: number,
    nearestGap: number,
    blockingLeader: SimVehicle | null,
    hasPhysicalMedian: boolean,
    discipline: DisciplineParams,
    light: SignalColor
  ): boolean {
    if (v.isReversing) return false;
    if (v.overtakeState && v.overtakeState !== 'none') return false;
    if (v.isSlipLane || v.isUTurn) return false;

    const armGeom = this.compiledTopology.armsById[v.originArm];
    if (!armGeom) return false;

    const res = evaluateMotorcycleCorridorTarget({
      v,
      vehicles: this.vehicles,
      config: this.config,
      topology: this.compiledTopology,
      armGeom,
      lw,
      roadW,
      light,
      desiredV,
      nearestGap,
      blockingLeader,
      weather: this.envState.weather,
      ambientDarkness: this.envState.ambientDarkness,
      hasPhysicalMedian,
      discipline,
    });
    if (!res) return false;

    const armLw = armGeom.def.inLaneWidths[v.laneIndex] ?? lw;
    const laneCenters = armGeom.inLaneCenters;
    if (res.targetLane !== v.laneIndex && v.turn === 'straight' && armGeom.def.inLanes >= 2) {
      const old = v.laneIndex;
      const nextCompiled = this.compiledTopology.pathLookup[v.originArm]?.[v.turn]?.[res.targetLane];
      if (nextCompiled) {
        const oldCenter = laneCenters[old] ?? getGlobalLat(old, 0, armLw);
        const newCenter = laneCenters[res.targetLane] ?? getGlobalLat(res.targetLane, 0, armLw);
        v.laneIndex = res.targetLane;
        v.destLaneIndex = nextCompiled.destLane;
        v.pathKey = nextCompiled.key;
        v.compiledPath = nextCompiled;
        v.path = makeVehiclePathWrapper(nextCompiled);
        v.stopLineDist = nextCompiled.stopLineDist;
        v.exitLineDist = nextCompiled.exitLineDist;
        v.totalPathLength = nextCompiled.totalPathLength;
        v.lateralOffset += oldCenter - newCenter;
        v.laneChangeDir = res.targetLane > old ? 'left' : 'right';
      }
    }

    const activeCenter = laneCenters[v.laneIndex] ?? getGlobalLat(v.laneIndex, 0, armLw);
    v.targetLateralOffset = res.targetGlobalLat - activeCenter;
    v.crossingMarking = res.crossingMarking;
    return res.isRhkPacking;
  }

  private shouldStopForYellow(
    v: SimVehicle,
    distToStop: number,
    blockingLeader: SimVehicle | null,
    physicalGap: number,
    discipline: DisciplineParams
  ): boolean {
    if (v.yellowCommitted) return false;
    const weather = this.envState.weather;
    const traits = getDriverTraits(v);
    const effComfortDecel = Math.max(
      0.8,
      v.comfortDecel * traits.comfortDecelMult * weather.comfortDecelMult
    );
    const tailgate = v.tailgatePressure ?? 0;

    // Ide #11: Yellow/Red Runner Contagion (when discipline < 0.65 and close leader within 8m is running)
    const leaderRunning =
      discipline.discipline < 0.65 &&
      traits.runnerContagionSens > 0 &&
      blockingLeader !== null &&
      blockingLeader.originArm === v.originArm &&
      physicalGap < 8.0 &&
      Boolean(blockingLeader.yellowCommitted || blockingLeader.willRunRed) &&
      blockingLeader.speed > 2.5;
    const contagionBoost = leaderRunning ? 1 + 0.35 * traits.runnerContagionSens : 1.0;
    const commitBias = traits.yellowCommitBias * contagionBoost;

    const dynamicFrustRun =
      (v.frustration ?? 0) >= 0.58 &&
      traits.riskTolerance >= 0.45 &&
      weather.friction >= 0.72 &&
      distToStop < 24.0 * Math.min(1.3, commitBias);
    const tailgatePush =
      v.vClass !== 'heavy' &&
      tailgate > 0.58 &&
      distToStop < 19.0 &&
      v.speed > 5.0 &&
      weather.friction >= 0.72 &&
      traits.riskTolerance >= 0.3;

    if ((v.willRunRed || dynamicFrustRun) && ((distToStop < 44.0 && v.speed > 1.5) || distToStop < 12.0)) {
      v.yellowCommitted = true;
      return false;
    }
    if (tailgatePush) {
      v.yellowCommitted = true;
      return false;
    }
    if (
      commitBias >= 0.92 &&
      (v.vClass !== 'heavy' || traits.archetype === 'logistics') &&
      distToStop < v.speed * (this.phaseRemaining + 0.45 * commitBias)
    ) {
      v.yellowCommitted = true;
      return false;
    }
    if (
      leaderRunning &&
      traits.runnerContagionSens >= 0.3 &&
      weather.friction >= 0.72 &&
      distToStop < 16.0 * (0.7 + 0.5 * traits.runnerContagionSens) &&
      v.speed > 3.5
    ) {
      v.yellowCommitted = true;
      return false;
    }
    const reactTime = 0.8 * traits.reactionScale * weather.reactionMult;
    const brakeMult = Math.max(0.75, Math.min(1.28, 1.32 - 0.34 * commitBias));
    const comfortableStopDist =
      v.speed * reactTime + (v.speed * v.speed) / (2 * effComfortDecel * brakeMult);
    if (distToStop < comfortableStopDist * (0.76 + 0.14 * commitBias)) {
      v.yellowCommitted = true;
      return false;
    }
    return distToStop >= comfortableStopDist;
  }

  private updateVehicles(dt: number): void {
    // Rebuild 2D spatial hash once per sub-step for fast 360° & bidirectional perception
    this.spatialHash.rebuild(this.vehicles);

    const lwDefault = getLaneWidth(this.config);
    const roadWDefault = getEffectiveRoadWidth(this.config);
    const weather = this.envState.weather;
    const discipline = computeDisciplineParams(this.config.driverDiscipline);
    const yellowBoxEnabled = Boolean(this.config.yellowBoxEnabled || this.compiledTopology.topology.yellowBoxEnabled);
    const activeArmSet = this.getActivePhaseArmSet();
    const crossArmYellowSoon = this.activeColor === 'yellow' && !this.isAllRed && this.phaseRemaining <= 1.2;
    let anyActiveOncomingOvertaker = false;
    for (let i = 0; i < this.vehicles.length; i++) {
      const ov = this.vehicles[i].overtakeState;
      if (ov === 'pull_out' || ov === 'passing' || ov === 'merge_back') {
        anyActiveOncomingOvertaker = true;
        break;
      }
    }

    const decisions: {
      v: SimVehicle;
      nextSpeed: number;
      nextLat: number;
      nextLatVel: number;
      nextSteerAngle: number;
      physicalGap: number;
      physicalLeadSpeed: number;
      hasBlockingLeader: boolean;
      sameArmBlocked: boolean;
      nearestRearGap: number;
      nextCrossingMarking: boolean;
    }[] = [];

    for (const v of this.vehicles) {
      if (v.reactionTimer > 0) v.reactionTimer = Math.max(0, v.reactionTimer - (v.isConnected ? dt * 4.0 : dt));
      if (v.laneChangeCooldown && v.laneChangeCooldown > 0) {
        v.laneChangeCooldown = Math.max(0, v.laneChangeCooldown - dt);
      }
      if (v.reverseCooldown && v.reverseCooldown > 0) {
        v.reverseCooldown = Math.max(0, v.reverseCooldown - dt);
      }
      if (v.cautionTimer && v.cautionTimer > 0) {
        v.cautionTimer = Math.max(0, v.cautionTimer - dt);
      }

      const wasBrakingHard = Boolean(v.brakingHard);
      const wasAbortOvertake = v.overtakeState === 'abort';
      const wasReversing = Boolean(v.isReversing);

      const armGeom = this.compiledTopology.armsById[v.originArm];
      const lw = armGeom?.def.inLaneWidths[v.laneIndex] ?? lwDefault;
      const roadW = armGeom?.inWidth ?? roadWDefault;
      const widthSpeedFactor = Math.max(0.84, Math.min(1.08, 0.84 + (lw - 2.8) * 0.1714));
      const widthHeadwayFactor = Math.max(0.92, Math.min(1.18, 1.18 - (lw - 2.8) * 0.1857));

      const movSig = this.getMovementSignal(v.originArm, v.turn, v.isSlipLane);
      const light: SignalColor =
        movSig === 'protected-green' || movSig === 'permissive-green' || movSig === 'slip-yield'
          ? 'green'
          : movSig === 'yellow'
            ? 'yellow'
            : 'red';
      const frontBumper = v.distanceAlongPath + v.length * 0.5;
      const armMotorBox = armGeom ? armGeom.def.motorBoxEnabled : this.config.motorBoxEnabled;
      const armLTOR = armGeom ? armGeom.def.leftTurnOnRed : this.config.leftTurnOnRed;
      const rhkStopDist = v.stopLineDist - 3.5;
      const creepBonus = !armMotorBox && v.stopCreepMeters ? v.stopCreepMeters : 0;
      const stopSetback = creepBonus > 0 ? 0 : 0.25;
      const effectiveStopDist =
        armMotorBox && v.vClass !== 'motor' && !v.isSlipLane && frontBumper <= rhkStopDist + 0.5
          ? rhkStopDist
          : v.stopLineDist + creepBonus - stopSetback;
      const distToStop = effectiveStopDist - frontBumper;
      if (light === 'green' && frontBumper <= v.stopLineDist + 0.3 + creepBonus) {
        v.yellowCommitted = false;
      }
      if (
        !v.isSlipLane &&
        !v.isUTurn &&
        (light === 'green' || light === 'yellow') &&
        frontBumper > v.stopLineDist + 0.3 + creepBonus &&
        v.speed >= 0.25
      ) {
        v.yellowCommitted = true;
      }

      // 1. Base Desired Speed scaled by driver profile, lane width, & contextual weather adaptation
      const vTraits = getDriverTraits(v);
      const ctxBehavior = computeContextualBehaviorMod(
        vTraits,
        weather,
        this.envState.ambientDarkness
      );

      // Ide #6: Red-light attention drift tracking & cross-yellow RHK launch anticipation
      if (light === 'red' && !v.isSlipLane && !v.isUTurn && v.distanceAlongPath < v.stopLineDist) {
        if (v.speed < QUEUE_SPEED_THRESHOLD) {
          v.redWaitTime = (v.redWaitTime ?? 0) + dt;
        }
        if (
          crossArmYellowSoon &&
          !activeArmSet.has(v.originArm) &&
          v.speed < QUEUE_SPEED_THRESHOLD &&
          distToStop >= -0.3 &&
          distToStop <= 6.5 &&
          vTraits.crossYellowAnticipation >= 0.7
        ) {
          v.rhkAnticipating = true;
        } else if (!crossArmYellowSoon && !this.isAllRed) {
          v.rhkAnticipating = false;
        }
      } else if (light === 'green') {
        v.redWaitTime = 0;
        v.rhkAnticipating = false;
      }

      let desiredV =
        v.maxSpeed *
        v.speedFactor *
        widthSpeedFactor *
        Math.min(1.0, weather.speedMult[v.vClass] * ctxBehavior.speedWeatherGrace);

      // Post-incident cognitive memory speed moderation (-6% while cautionTimer > 0)
      if ((v.cautionTimer ?? 0) > 0) {
        desiredV *= 0.94;
      }

      // Racing-game style curvature lookahead speed cap (brakes BEFORE sharp apexes!)
      desiredV = computeCurvatureTargetSpeed(v, v.compiledPath, desiredV, weather);

      // 2. Perception via 2D Spatial Hash Grid (2-vehicle lookahead) — fills this.queryBufA once!
      let {
        nearestGap,
        leadSpeed,
        blockingLeader,
        isSqueezingPast,
        secondGap,
        secondLeadSpeed,
        secondLeader,
      } = findBlockingLeader(
        v,
        this.vehicles,
        lw,
        this.compiledTopology,
        this.spatialHash,
        weather,
        this.queryBufA
      );
      v.leaderId = blockingLeader ? blockingLeader.id : undefined;
      const physicalGap = nearestGap;
      const physicalLeadSpeed = leadSpeed;
      const vInsideBox = frontBumper > v.stopLineDist + 0.05 && !v.hasExitedIntersection;
      const hasBlockingLeader =
        !isSqueezingPast &&
        blockingLeader !== null &&
        ((blockingLeader.originArm === v.originArm &&
          (blockingLeader.laneIndex === v.laneIndex || blockingLeader.turn === v.turn)) ||
          blockingLeader.destArm === v.destArm ||
          Boolean(v.overtakeState && v.overtakeState !== 'none') ||
          Boolean(blockingLeader.overtakeState && blockingLeader.overtakeState !== 'none') ||
          (vInsideBox && blockingLeader.originArm !== v.originArm && blockingLeader.destArm !== v.destArm));

      // Zero-GC single-pass reuse of this.queryBufA for:
      // (a) Straightaway Tailgate Pressure (Ide #9), (b) Defensive Flanking Cushion (Ide #11),
      // and (c) Undivided-Road Oncoming Detection (Ide #13)
      const cosH = Math.cos(v.heading);
      const sinH = Math.sin(v.heading);
      const myEffW = effClearanceWidth(v);
      let maxTailgatePressure = 0;
      let maxFlankingHazard = 0;
      let flankingAwaySign = 0;
      let hasOncomingNear = false;
      const checkFlanking =
        vTraits.flankingCushionMult >= 1.0 &&
        !v.hasExitedIntersection &&
        !v.isSlipLane &&
        !v.isUTurn &&
        v.distanceAlongPath < v.stopLineDist - 2.0;
      const nearbyA = this.queryBufA;

      for (let i = 0; i < nearbyA.length; i++) {
        const other = nearbyA[i];
        if (other.id === v.id) continue;
        const dx = other.x - v.x;
        const dy = other.y - v.y;
        const fwd = dx * cosH + dy * sinH;
        // Outward-left normal in Canvas 2D Y-down is (sinH, -cosH)
        const latSigned = dx * sinH - dy * cosH;
        const absLat = Math.abs(latSigned);

        if (other.originArm === v.originArm) {
          // (a) Tailgate pressure from close same-lane follower
          if (
            !other.isSlipLane &&
            !other.isUTurn &&
            fwd < -0.2 &&
            other.distanceAlongPath < v.distanceAlongPath &&
            absLat <= (myEffW + effClearanceWidth(other)) * 0.5 + 0.65
          ) {
            const rearGap = Math.max(0.2, -fwd - (v.length + other.length) * 0.5);
            if (rearGap < 10.0 && other.speed >= Math.max(1.5, v.speed - 0.5)) {
              const oTraits = getDriverTraits(other);
              const impatience = 0.55 + 0.45 * oTraits.riskTolerance + 0.35 * (other.frustration ?? 0);
              const closingFactor = Math.max(
                0,
                Math.min(1, ((other.speed - Math.max(0, v.speed - 1.8)) / 5.0 + (10.0 - rearGap) / 11.5) * impatience)
              );
              if (closingFactor > maxTailgatePressure) maxTailgatePressure = closingFactor;
            }
          }

          // (b) Defensive flanking cushion beside marking-crossing or overtaking neighbor
          if (
            checkFlanking &&
            absLat > 0.3 &&
            absLat < 1.9 &&
            Math.abs(other.distanceAlongPath - v.distanceAlongPath) < 5.5 &&
            (Boolean(other.crossingMarking) || Boolean(other.overtakeState && other.overtakeState !== 'none'))
          ) {
            const hazard = Math.min(1, (1 - absLat / 1.9) * 0.65 + 0.35);
            if (hazard > maxFlankingHazard) {
              maxFlankingHazard = hazard;
              flankingAwaySign = latSigned > 0 ? -1 : 1;
            }
          }
        } else if (!hasOncomingNear && fwd > -2.0 && fwd < 38.0 && absLat < roadW + 4.0) {
          const dotH = cosH * Math.cos(other.heading) + sinH * Math.sin(other.heading);
          if (dotH < -0.45) {
            hasOncomingNear = true;
          }
        }
      }

      v.tailgatePressure = Math.min(1, maxTailgatePressure);
      v.flankingHazard = maxFlankingHazard;
      if (maxFlankingHazard > 0) {
        desiredV *= 1 - 0.06 * maxFlankingHazard;
      }

      const hasPhysicalMedian = this.config.hasMedian || (armGeom?.def.medianWidth ?? 0) > 0.05;
      const blockedByHeavyAhead =
        blockingLeader !== null && blockingLeader.vClass === 'heavy' && physicalGap < 18.0;
      const mapMod = evaluateMapContextMod(
        v,
        vTraits,
        this.mapContext,
        armGeom,
        hasPhysicalMedian,
        hasOncomingNear,
        blockedByHeavyAhead
      );
      desiredV *= mapMod.zoneSpeedScale;

      // 3. Signal control, LTOR (per-arm!), RHK pocket, Yellow Box Awareness, & Right-of-Way Priority Yielding
      let stoppingForSignal = false;
      let canLTOR = false;
      const wasYielding = Boolean(v.isYielding);
      const wasHoldingYB = Boolean(v.holdingYellowBox);
      v.isYielding = false;
      v.holdingYellowBox = false;
      v.yieldTargetId = undefined;
      if (!v.laneChangeDir && !v.pendingLaneChangeDir && (!v.overtakeState || v.overtakeState === 'none')) {
        v.handshakePartnerId = undefined;
        v.handshakeCounted = false;
      }

      const alreadyInBox =
        v.distanceAlongPath >= v.stopLineDist ||
        (frontBumper > v.stopLineDist + 0.25 && (v.speed >= 0.6 || Boolean(v.yellowCommitted)));

      let stopForYellowFlag = false;
      if (!v.isSlipLane && !v.isUTurn && v.distanceAlongPath < v.stopLineDist && !alreadyInBox) {
        const stopForYellow =
          light === 'yellow' && this.shouldStopForYellow(v, distToStop, blockingLeader, physicalGap, discipline);
        stopForYellowFlag = stopForYellow;
        if (light === 'yellow' && !stopForYellow && v.turn === 'straight') {
          desiredV *= 1.18;
        }
        canLTOR =
          armLTOR &&
          v.turn === 'left' &&
          light === 'red' &&
          !this.isBoxOccupiedByConflictingArm(v.originArm) &&
          !this.hasLeftTurnMergeConflict(v, mapMod.ltorGapMult);
        if (canLTOR && frontBumper > v.stopLineDist + 0.25 && v.speed >= 0.35) {
          v.yellowCommitted = true;
        }
        if (canLTOR && distToStop < 14) {
          const ltorCap = distToStop < 8.0 ? mapMod.ltorSpeedCap : mapMod.ltorSpeedCap * 1.3;
          desiredV = Math.min(desiredV, ltorCap * weather.speedMult[v.vClass]);
        }

        const canRunEarlyRed =
          light === 'red' &&
          this.isAllRed &&
          activeArmSet.has(v.originArm) &&
          Boolean(v.willRunRed || v.yellowCommitted) &&
          distToStop < 8.5 &&
          (v.speed > 2.0 || distToStop < 4.0) &&
          distToStop / Math.max(2.0, v.speed) < this.phaseRemaining &&
          !this.isBoxOccupiedByConflictingArm(v.originArm);

        const effComfortDecel = Math.max(0.8, v.comfortDecel * weather.comfortDecelMult);
        const minBoxHoldDist = (v.speed * v.speed) / (2 * effComfortDecel * 1.4);
        const holdForOccupiedBox =
          light === 'green' &&
          this.phaseElapsed < 14.0 &&
          distToStop < 16.0 &&
          distToStop >= minBoxHoldDist &&
          this.isBoxOccupiedByConflictingArm(v.originArm);

        // Yellow Box Junction Awareness (No. 8) + Preventive Space-Time Box Conflict Corridor Check (Phase 2)
        const holdYellowBox =
          light === 'green' &&
          distToStop >= Math.max(0.15, minBoxHoldDist * 0.65) &&
          shouldHoldForYellowBox(v, yellowBoxEnabled, this.vehicles, this.compiledTopology);
        const holdConflictCorridor =
          !holdYellowBox &&
          light === 'green' &&
          distToStop >= Math.max(0.15, minBoxHoldDist * 0.65) &&
          shouldHoldForConflictCorridor(
            v,
            this.vehicles,
            this.compiledTopology,
            this.spatialHash,
            discipline,
            this.queryBufB
          );
        if (holdYellowBox || holdConflictCorridor) {
          v.holdingYellowBox = true;
        }

        if (
          ((light === 'red' && !canRunEarlyRed && !canLTOR) ||
            stopForYellow ||
            holdForOccupiedBox ||
            holdYellowBox ||
            holdConflictCorridor) &&
          distToStop < nearestGap
        ) {
          nearestGap = Math.max(0.1, distToStop);
          leadSpeed = 0;
          stoppingForSignal = true;
          if ((holdYellowBox || holdConflictCorridor) && !wasHoldingYB) {
            this.yellowBoxHoldCount += 1;
            this.archetypeStats[vTraits.archetype].yellowBoxHolds += 1;
          }
        }
      }

      // 4. Perception Profile, Occlusion Peeking, SVO Courtesy & Right-of-Way Priority Yielding
      const perception = evaluateVehiclePerceptionProfile(
        v,
        blockingLeader,
        weather,
        this.envState.ambientDarkness
      );
      // Ide #7: Archetype-specific turn signal onset horizon
      if (!v.laneChangeDir && !v.pendingLaneChangeDir && (!v.overtakeState || v.overtakeState === 'none')) {
        v.turnSignalActive =
          v.distanceAlongPath < v.exitLineDist && v.distanceAlongPath > v.stopLineDist - vTraits.signalOnsetDist
            ? v.turn === 'uturn'
              ? 'right'
              : v.turn === 'left' || v.turn === 'right'
                ? v.turn
                : null
            : null;
      }

      const nearbyConflict = this.spatialHash.queryRadius(
        v.x,
        v.y,
        Math.min(26, weather.sightDistance),
        this.queryBufB
      );
      const hasSwarmShield =
        v.vClass === 'motor' ? hasMotorSwarmPlatoonShield(v, '', nearbyConflict) : false;

      const peek = evaluateOcclusionPeekingCap(v, nearbyConflict, light, weather, discipline);
      v.occlusionPeekActive = peek.isPeeking;
      if (peek.isPeeking) {
        desiredV = Math.min(desiredV, peek.speedCap);
      }

      const yieldDecision = evaluatePriorityConflictYield(
        v,
        movSig,
        this.compiledTopology,
        this.spatialHash,
        weather,
        discipline,
        this.queryBufB,
        {
          hasSwarmShield,
          gapCautiousMult: perception.gapCautiousMult,
        }
      );
      if (yieldDecision.shouldYield) {
        v.isYielding = true;
        v.yieldTargetId = yieldDecision.targetId;
        desiredV = Math.min(desiredV, yieldDecision.speedCap * weather.speedMult[v.vClass]);
        if (yieldDecision.yieldGap < nearestGap) {
          nearestGap = Math.max(0.1, yieldDecision.yieldGap);
          leadSpeed = 0;
          stoppingForSignal = true;
          if (!wasYielding) {
            this.yieldConflictCount += 1;
          }
        }
      } else {
        const nearbySvo = this.spatialHash.queryRadius(v.x, v.y, Math.min(28, weather.sightDistance), this.queryBufB);
        const svoYield = evaluateSvoCourtesyYield(
          v,
          movSig,
          nearbySvo,
          this.compiledTopology,
          weather,
          discipline
        );
        if (svoYield.shouldYield) {
          v.isYielding = true;
          v.yieldTargetId = svoYield.targetId;
          desiredV = Math.min(desiredV, svoYield.speedCap);
          if (svoYield.yieldGap < nearestGap) {
            nearestGap = Math.max(0.1, svoYield.yieldGap);
            leadSpeed = 0;
            stoppingForSignal = true;
          }
        }
      }

      // 5. Defensive yielding, Hybrid ORCA predictive 2D collision avoidance & box-clearing urgency
      const vBoxCheck = v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 && !v.hasExitedIntersection;
      if (vBoxCheck && (light === 'yellow' || light === 'red') && !v.isYielding) {
        desiredV *= 1.24;
      }

      let orcaEvasiveLatDelta = 0;
      const activeArmGeom =
        v.distanceAlongPath < v.stopLineDist
          ? armGeom
          : this.compiledTopology.armsById[v.destArm];
      const activeLaneIdx =
        v.distanceAlongPath < v.stopLineDist ? v.laneIndex : (v.destLaneIndex ?? 0);
      const myCenterLat =
        v.distanceAlongPath < v.stopLineDist
          ? (armGeom?.inLaneCenters[activeLaneIdx] ?? getGlobalLat(activeLaneIdx, 0, lw))
          : (activeArmGeom?.outLaneCenters[activeLaneIdx] ?? getGlobalLat(activeLaneIdx, 0, lw));
      const roadWidthActive =
        v.distanceAlongPath < v.stopLineDist
          ? (activeArmGeom?.inWidth ?? roadW)
          : (activeArmGeom?.outWidth ?? roadW);
      const activeHalfMed = activeArmGeom?.halfMedian ?? (this.config.hasMedian ? 0.5 : 0);
      const effHalfW = effClearanceWidth(v) * 0.5 + 0.15;
      const inBoxNow = v.distanceAlongPath > v.stopLineDist - 1.0 && !v.hasExitedIntersection;
      const inOncomingNow = Boolean(v.overtakeState && v.overtakeState !== 'none');
      const curGlobalEst = myCenterLat + v.lateralOffset;
      const minGlobalBound = Math.min(
        curGlobalEst,
        inBoxNow || inOncomingNow
          ? Math.min(curGlobalEst - 1.25, activeHalfMed + effHalfW)
          : activeHalfMed > 0.05 || v.vClass === 'heavy'
            ? activeHalfMed + effHalfW
            : 0.25 + effHalfW
      );
      const maxGlobalBound = Math.max(
        curGlobalEst,
        inBoxNow ? curGlobalEst + 1.25 : activeHalfMed + roadWidthActive - effHalfW
      );

      if (!v.isReversing) {
        const nearby2D = this.spatialHash.queryRadius(v.x, v.y, Math.min(24, weather.sightDistance), this.queryBufB);
        const pred2D = evaluatePredictiveConflict2D(v, nearby2D, weather, {
          minOffsetDelta: minGlobalBound - curGlobalEst,
          maxOffsetDelta: maxGlobalBound - curGlobalEst,
        });
        if (pred2D.brakeGap < nearestGap) {
          nearestGap = Math.max(0.15, pred2D.brakeGap);
          leadSpeed = Math.min(leadSpeed, pred2D.speedCap);
          desiredV = Math.min(desiredV, pred2D.speedCap);
        }
        orcaEvasiveLatDelta = pred2D.evasiveLatDelta;
      }

      if (anyActiveOncomingOvertaker) {
        const defensive = evaluateDefensiveYieldForOncomingOvertaker(v, this.spatialHash, this.queryBufB);
        if (Number.isFinite(defensive.speedCap)) {
          desiredV = Math.min(desiredV, defensive.speedCap);
          if (defensive.defensiveShiftLeft > 0 && (!v.overtakeState || v.overtakeState === 'none')) {
            const maxShift = Math.max(0, lw * 0.5 - effClearanceWidth(v) * 0.5 - 0.15);
            v.targetLateralOffset = Math.min(maxShift, v.targetLateralOffset + defensive.defensiveShiftLeft * dt * 2.5);
          }
        }
      }

      // 6. Tactical Overtaking: Motor Seepage + MOBIL Lane Change (No. 3) + Oncoming-Lane Overtaking FSM (No. 4)
      if (v.vClass === 'motor' && isSqueezingPast && leadSpeed < 2.5) {
        desiredV = Math.min(desiredV, 4.8 * weather.speedMult.motor);
      }

      if (v.vClass === 'heavy' && !v.isReversing) {
        const wasWide = v.wideSwingState === 'pre_swing' || v.wideSwingState === 'turning';
        const nearbyHeavy = this.spatialHash.queryRadius(v.x, v.y, 18, this.queryBufB);
        const wide = computeHeavyWideTurnTargetOffset(v, armGeom, nearbyHeavy, lw);
        v.wideSwingState = wide.state;
        if (wide.state !== 'none' || wasWide) {
          v.targetLateralOffset = wide.wideOffset;
        }
      }

      // Ide #11 Defensive Flanking Cushion + Ide #13 Undivided-road curb/peek lateral offset
      if (
        v.vClass !== 'motor' &&
        !v.isReversing &&
        !v.isSlipLane &&
        !v.isUTurn &&
        !v.laneChangeDir &&
        (!v.overtakeState || v.overtakeState === 'none') &&
        (v.wideSwingState === undefined || v.wideSwingState === 'none') &&
        v.distanceAlongPath < v.stopLineDist
      ) {
        const availHalf = Math.max(0, (lw - v.width) * 0.5 - 0.18);
        const flankShift =
          maxFlankingHazard > 0
            ? flankingAwaySign * Math.min(0.18, 0.14 * maxFlankingHazard * vTraits.flankingCushionMult)
            : 0;
        const desiredSubtleLat =
          distToStop > 5.0
            ? Math.max(-availHalf, Math.min(availHalf, mapMod.undividedLateralShift + flankShift))
            : 0;
        if (Math.abs(desiredSubtleLat) > 1e-3 || Math.abs(v.targetLateralOffset) <= availHalf + 0.05) {
          v.targetLateralOffset = desiredSubtleLat;
        }
      }

      let isRhkPacking = false;
      if (v.vClass === 'motor') {
        isRhkPacking = this.applyMotorcycleSeepage(
          v,
          lw,
          roadW,
          desiredV,
          nearestGap,
          blockingLeader,
          hasPhysicalMedian,
          discipline,
          light
        );
      }

      let didMobilChange = false;
      let didTailgateYield = false;
      const creditOvertakeArch = () => {
        this.archetypeStats[vTraits.archetype].overtakes += 1;
      };
      if (this.config.smartOvertaking !== false) {
        didMobilChange = evaluateMobilLaneChange(
          v,
          this.vehicles,
          this.compiledTopology,
          lw,
          light,
          desiredV,
          nearestGap,
          blockingLeader,
          weather,
          discipline,
          () => {
            this.carOvertakeCount += 1;
            creditOvertakeArch();
          },
          dt,
          () => {
            this.archetypeStats[vTraits.archetype].handshakes += 1;
          }
        );
      }

      if (!didMobilChange && (!v.overtakeState || v.overtakeState === 'none')) {
        didMobilChange = evaluateCourtesyLaneShift(
          v,
          this.vehicles,
          this.compiledTopology,
          lw,
          light,
          desiredV,
          weather,
          discipline,
          v.vClass === 'car'
            ? () => {
              this.carOvertakeCount += 1;
              creditOvertakeArch();
            }
            : undefined,
          () => {
            didTailgateYield = true;
            this.archetypeStats[vTraits.archetype].tailgateYields += 1;
          },
          mapMod.busCurbPull
        );
      }

      if (!didMobilChange && this.config.oncomingOvertaking !== false) {
        const oncomingRes = updateOncomingOvertakeFSM(
          v,
          this.vehicles,
          this.compiledTopology,
          this.spatialHash,
          hasPhysicalMedian,
          light,
          this.phaseRemaining,
          desiredV,
          nearestGap,
          blockingLeader,
          weather,
          discipline,
          dt,
          this.queryBufB,
          () => {
            this.oncomingOvertakeCount += 1;
            creditOvertakeArch();
            this.frictionGrid.recordEvent(v.x, v.y, vTraits.archetype, 1.1);
          }
        );
        desiredV *= oncomingRes.speedBoost;
        if (oncomingRes.forceYieldToOncoming) {
          desiredV = Math.min(desiredV, 4.0);
        }
      }

      // Hold/slow vehicle near stop line ONLY if genuinely across the centerline into oncoming lane so it merges back before box
      const curGlobalLat = getGlobalLat(v.laneIndex, v.lateralOffset, lw, armGeom?.inLaneCenters);
      const stillAcrossCenter = curGlobalLat < (armGeom?.halfMedian ?? 0) - 0.05;
      if (
        !v.isSlipLane &&
        !v.isUTurn &&
        stillAcrossCenter &&
        v.distanceAlongPath < v.stopLineDist &&
        v.distanceAlongPath >= v.stopLineDist - 12.0
      ) {
        desiredV = Math.min(desiredV, 4.2);
        if (v.distanceAlongPath >= v.stopLineDist - 4.0 && (!v.overtakeState || v.overtakeState === 'none')) {
          const stopHoldGap = Math.max(0.1, v.stopLineDist - frontBumper - 0.5);
          if (stopHoldGap < nearestGap) {
            nearestGap = stopHoldGap;
            leadSpeed = 0;
          }
        }
      }

      if (v.laneChangeDir && (!v.overtakeState || v.overtakeState === 'none') && Math.abs(v.lateralOffset - v.targetLateralOffset) < 0.2) {
        v.laneChangeDir = null;
        if (!v.pendingLaneChangeDir && v.turn === 'straight') {
          v.turnSignalActive = null;
        }
      }

      // 6b. GLOSA Green-End Anticipation, Platoon Start-up Discharge, Multi-Leader Shockwave & Zipper Give-Way
      let glosaHeadwayMult = 1.0;
      let glosaLaunchBoostScale = 1.0;
      let isGlosaCoasting = false;
      if (!v.isReversing && (!v.overtakeState || v.overtakeState === 'none')) {
        const glosa = evaluateGlosaAndPlatoonDischarge(
          v,
          light,
          this.phaseRemaining,
          distToStop,
          blockingLeader,
          physicalGap,
          canLTOR,
          stopForYellowFlag,
          weather,
          desiredV
        );
        if (glosa.desiredSpeedCap < desiredV) {
          desiredV = glosa.desiredSpeedCap;
        }
        glosaHeadwayMult = glosa.headwayMult;
        glosaLaunchBoostScale = glosa.launchBoostScale;
        isGlosaCoasting = glosa.isGlosaCoasting;

        // Cooperative Zipper Merge & Blinker Intent Pocket Opening
        const nearbyZip = this.spatialHash.queryRadius(v.x, v.y, 16, this.queryBufB);
        const zipper = evaluateZipperMergeGiveWay(v, nearbyZip, lw, weather, discipline);
        if (zipper.yieldGap < nearestGap) {
          nearestGap = zipper.yieldGap;
          leadSpeed = Math.min(leadSpeed, zipper.speedCap);
          desiredV = Math.min(desiredV, zipper.speedCap);
          v.isYielding = true;
          if (zipper.requester && !zipper.requester.handshakeCounted && zipper.requester.laneChangeDir) {
            zipper.requester.handshakeCounted = true;
            this.archetypeStats[getDriverTraits(zipper.requester).archetype].handshakes += 1;
          }
        }
        const blinkerPocket = evaluateBlinkerIntentPocket(v, nearbyZip, lw, weather);
        if (blinkerPocket.yieldGap < nearestGap) {
          nearestGap = blinkerPocket.yieldGap;
          leadSpeed = Math.min(leadSpeed, blinkerPocket.speedCap);
          desiredV = Math.min(desiredV, blinkerPocket.speedCap);
          v.isYielding = true;
          if (
            blinkerPocket.requester &&
            !blinkerPocket.requester.handshakeCounted &&
            blinkerPocket.requester.laneChangeDir
          ) {
            blinkerPocket.requester.handshakeCounted = true;
            this.archetypeStats[getDriverTraits(blinkerPocket.requester).archetype].handshakes += 1;
          }
        }
      }

      // Edge-triggered yield telemetry & geospatial friction recording
      if (v.isYielding && !wasYielding) {
        this.archetypeStats[vTraits.archetype].yieldsGiven += 1;
        this.frictionGrid.recordEvent(v.x, v.y, vTraits.archetype, 0.55);
      }

      const multiLead = !v.isReversing
        ? computeMultiAnticipativeLeader(
          v,
          nearestGap,
          leadSpeed,
          blockingLeader,
          secondGap,
          secondLeadSpeed,
          secondLeader,
          weather,
          perception
        )
        : { effectiveLeadSpeed: leadSpeed, anticipatedBrakeIntensity: 0, shockwaveCap: Infinity };
      if (multiLead.shockwaveCap < desiredV) {
        desiredV = Math.min(desiredV, multiLead.shockwaveCap);
      }
      const effectiveLeadSpeed = Math.min(leadSpeed, multiLead.effectiveLeadSpeed);

      // 7. Pure Pursuit / Stanley Smooth Lateral Controller + Hybrid ORCA Evasion & Pairwise Guard
      const savedBaseTarget = v.targetLateralOffset;
      const hasOrcaDelta = !v.isReversing && Math.abs(orcaEvasiveLatDelta) > 1e-4;
      if (hasOrcaDelta) {
        const minLocalLat = Math.min(savedBaseTarget, minGlobalBound - myCenterLat);
        const maxLocalLat = Math.max(savedBaseTarget, maxGlobalBound - myCenterLat);
        v.targetLateralOffset = computeSafeLateralTarget(
          v,
          savedBaseTarget,
          orcaEvasiveLatDelta,
          minLocalLat,
          maxLocalLat
        );
      }

      let nextLat = v.lateralOffset;
      const steerStep = computePurePursuitLateralStep(v, dt, weather);
      let nextLatVel = steerStep.nextLatVel;
      const nextSteerAngle = steerStep.steerAngle;
      const latDiff = v.targetLateralOffset - v.lateralOffset;

      if (Math.abs(steerStep.stepLat) > 1e-5) {
        const candLat =
          Math.abs(steerStep.stepLat) >= Math.abs(latDiff)
            ? v.targetLateralOffset
            : nextLat + steerStep.stepLat;
        const nearbyLat = this.spatialHash.queryRadius(v.x, v.y, 16, this.queryBufB);
        const guarded = clampCandidateLateralStep(
          v,
          candLat,
          v.lateralOffset,
          lw,
          armGeom?.inLaneCenters,
          nearbyLat,
          dt
        );
        if (guarded.blocked) {
          nextLat = guarded.safeLat;
          nextLatVel = Math.abs(guarded.safeLat - v.lateralOffset) > 1e-5 ? (guarded.safeLat - v.lateralOffset) / dt : 0;
        } else if (Math.abs(steerStep.stepLat) >= Math.abs(latDiff)) {
          nextLat = v.targetLateralOffset;
          nextLatVel = 0;
        } else {
          nextLat = candLat;
        }
      }

      if (hasOrcaDelta) {
        v.targetLateralOffset = savedBaseTarget;
      }

      // 8. Reverse Gear Clearance Scan, Anti-Stuck Reverse Trigger & Improved IDM (IIDM)
      let nearestRearGap = Infinity;
      const checkReverseCandidate =
        Boolean(v.isReversing) ||
        (((v.boxWaitTime ?? 0) >= 2.0 || (v.stuckTimer ?? 0) >= 2.0 || v.overtakeState === 'abort' || v.overtakeState === 'merge_back') &&
          (v.reverseCooldown ?? 0) <= 0 &&
          v.distanceAlongPath > 3.2);

      if (checkReverseCandidate) {
        const myEffW = effClearanceWidth(v);
        const cosH = Math.cos(v.heading);
        const sinH = Math.sin(v.heading);
        const nearbyRear = this.spatialHash.queryRadius(v.x, v.y, 14, this.queryBufB);
        for (let i = 0; i < nearbyRear.length; i++) {
          const other = nearbyRear[i];
          if (other.id === v.id) continue;
          const dx = other.x - v.x;
          const dy = other.y - v.y;
          const fwd = dx * cosH + dy * sinH;
          if (fwd >= -0.05) continue; // Only check behind us
          const lat = Math.abs(-dx * sinH + dy * cosH);
          const cosO = Math.cos(other.heading);
          const sinO = Math.sin(other.heading);
          const otherEffW = effClearanceWidth(other);
          const otherProjLen = Math.abs(cosO * cosH + sinO * sinH) * (other.length * 0.5) + Math.abs(-sinO * cosH + cosO * sinH) * (otherEffW * 0.5);
          const otherProjLat = Math.abs(-cosO * sinH + sinO * cosH) * (other.length * 0.5) + Math.abs(sinO * sinH + cosO * cosH) * (otherEffW * 0.5);
          if (lat < myEffW * 0.5 + otherProjLat + 0.35) {
            const rearGap = -fwd - (v.length * 0.5 + otherProjLen);
            if (rearGap < nearestRearGap) {
              nearestRearGap = rearGap;
            }
          }
        }
      }

      const isQueuedBehindRed =
        v.distanceAlongPath < v.stopLineDist &&
        light === 'red' &&
        blockingLeader !== null &&
        blockingLeader.originArm === v.originArm &&
        (!blockingLeader.overtakeState || blockingLeader.overtakeState === 'none') &&
        !blockingLeader.crossingMarking;

      if (!v.isReversing && checkReverseCandidate) {
        const minRearSpace = v.vClass === 'motor' ? 1.45 : 2.5;
        const trappedOncomingAbort =
          ((v.overtakeState === 'abort' || v.overtakeState === 'merge_back' || Boolean(v.crossingMarking)) &&
            v.lateralOffset < -0.5 &&
            (v.speed < 0.75 || physicalGap < 1.3) &&
            blockingLeader !== null &&
            blockingLeader.destArm === v.originArm);
        const deadlockedInBoxOrHeadOn =
          ((v.boxWaitTime ?? 0) >= 2.1 || (v.stuckTimer ?? 0) >= 2.1) &&
          physicalGap < 0.85 &&
          blockingLeader !== null &&
          !blockingLeader.isReversing &&
          (blockingLeader.originArm !== v.originArm ||
            Boolean(blockingLeader.overtakeState && blockingLeader.overtakeState !== 'none')) &&
          negotiateDeadlockPriority(v, blockingLeader) === 'yield';
        const generalFreezeRecovery =
          (v.stuckTimer ?? 0) >= 3.2 &&
          !stoppingForSignal &&
          !isQueuedBehindRed &&
          !v.isYielding &&
          !v.holdingYellowBox &&
          physicalGap < 0.55 &&
          blockingLeader !== null &&
          !blockingLeader.isReversing;

        if ((trappedOncomingAbort || deadlockedInBoxOrHeadOn || generalFreezeRecovery) && nearestRearGap >= minRearSpace) {
          v.isReversing = true;
          v.reverseTimer = trappedOncomingAbort ? 1.5 : 1.15;
          v.prevAccel = 0;
          this.reverseRecoveryCount += 1;
          if (!v.overtakeState || v.overtakeState === 'none') {
            // Subtle evasive steering offset while backing out so next forward attempt avoids the same pin
            const dirNudge = v.turn === 'right' ? -0.32 : 0.32;
            const maxLaneDrift = Math.max(0.25, lw * 0.32);
            v.targetLateralOffset = Math.max(-maxLaneDrift, Math.min(maxLaneDrift, v.lateralOffset + dirNudge));
          }
        }
      }

      let nextSpeed = v.speed;
      if (v.isReversing) {
        v.reverseTimer = (v.reverseTimer ?? 0) - dt;
        const clearedForward =
          (!v.overtakeState || v.overtakeState === 'none') &&
          physicalGap > 2.6 &&
          (v.reverseTimer ?? 0) < 0.65;
        if ((v.reverseTimer ?? 0) <= 0 || v.distanceAlongPath <= 1.2 || nearestRearGap <= 0.45 || clearedForward) {
          v.isReversing = false;
          v.reverseTimer = 0;
          v.reverseCooldown = 2.6;
          nextSpeed = 0;
          v.prevAccel = 0;
          v.brakingHard = false;
          v.stuckTimer = 0;
          v.boxWaitTime = 0;
        } else {
          const maxRev = (v.vClass === 'motor' ? 1.45 : v.vClass === 'car' ? 1.85 : 1.3) * weather.speedMult[v.vClass];
          const safeRev = Number.isFinite(nearestRearGap) ? Math.max(0.35, (nearestRearGap - 0.35) * 1.8) : maxRev;
          nextSpeed = Math.min(maxRev, safeRev);
          v.prevAccel = 0;
          v.brakingHard = false;
        }
      } else if (v.reactionTimer > 0 && light === 'green' && v.speed < 0.05) {
        nextSpeed = 0;
        v.prevAccel = 0;
        v.brakingHard = false;
      } else {
        if (v.speed < 0.15) v.prevAccel = Math.max(0, v.prevAccel ?? 0);
        const traits = vTraits;
        // Local herd effect: steady commuters adapt headway slightly to leader archetype
        let herdHeadwayMult = 1.0;
        if (
          traits.archetype === 'commuter' &&
          blockingLeader !== null &&
          blockingLeader.originArm === v.originArm &&
          Number.isFinite(nearestGap) &&
          nearestGap < 18.0
        ) {
          const leadArch = getDriverTraits(blockingLeader).archetype;
          if ((leadArch === 'hurried' || leadArch === 'courier') && blockingLeader.speed > 2.5) {
            herdHeadwayMult = 0.94;
          } else if (leadArch === 'defensive' || leadArch === 'transit') {
            herdHeadwayMult = 1.07;
          }
        }
        const effAccel = v.maxAccel * v.accelFactor * weather.accelMult;
        const effComfortDecel = Math.max(
          0.8,
          v.comfortDecel * traits.comfortDecelMult * weather.comfortDecelMult
        );
        const minGap =
          (v.vClass === 'motor' && v.speed < 4.5 ? 0.65 : v.minGap) *
          traits.minGapMult *
          weather.minGapMult;
        const cautionHeadwayMult =
          (v.cautionTimer ?? 0) > 0 &&
          (traits.archetype === 'defensive' ||
            traits.archetype === 'transit' ||
            traits.archetype === 'logistics' ||
            traits.archetype === 'commuter')
            ? 1.15
            : 1.0;
        const frustNow = v.frustration ?? 0;
        const frustHeadwayMult =
          frustNow > 0.2 && traits.frustrationMobilSensitivity >= 0.5
            ? Math.max(0.88, 1 - 0.12 * frustNow * traits.frustrationMobilSensitivity)
            : 1.0;
        const headway =
          (v.vClass === 'motor' && v.speed < 4.5 ? 0.5 : v.timeHeadway) *
          traits.headwayMult *
          ctxBehavior.headwayCautionBoost *
          herdHeadwayMult *
          cautionHeadwayMult *
          frustHeadwayMult *
          widthHeadwayFactor *
          weather.headwayMult *
          glosaHeadwayMult *
          perception.caccHeadwayMult;
        const rawAccel = computeIidmAcceleration({
          speed: v.speed,
          desiredSpeed: desiredV,
          gap: nearestGap,
          leadSpeed: effectiveLeadSpeed,
          maxAccel: effAccel,
          comfortDecel: effComfortDecel,
          minGap,
          timeHeadway: headway,
          delta: traits.iidmDelta,
        });

        const canLaunch =
          v.speed < 2.5 &&
          nearestGap >= minGap * 0.9 &&
          (light === 'green' || alreadyInBox || canLTOR || v.isSlipLane) &&
          (effectiveLeadSpeed > 0.05 || nearestGap > minGap * 1.2) &&
          (rawAccel > 0 || nearestGap > minGap * 2.5);
        const launchBoost = canLaunch
          ? effAccel * (0.78 * glosaLaunchBoostScale * (1 - v.speed / 2.8))
          : -Infinity;
        const closeT = Number.isFinite(nearestGap) ? Math.max(0, Math.min(1, (20 - nearestGap) / 16)) : 0;
        const maxEmergencyDecel = (v.vClass === 'motor' ? 6.8 : 5.2) * weather.emergencyDecelMult;
        const brakeLimit = -(effComfortDecel + (maxEmergencyDecel - effComfortDecel) * closeT);
        const hardBrakeLimit =
          nearestGap < minGap * 0.65 && effectiveLeadSpeed < v.speed - 0.5
            ? -Math.max(maxEmergencyDecel * 1.4, 8.8 * weather.emergencyDecelMult)
            : brakeLimit;
        const targetAccel = Math.max(launchBoost, Math.max(hardBrakeLimit, Math.min(effAccel, rawAccel)));

        const prevA = v.prevAccel ?? 0;
        const smoothedAccel = smoothLongitudinalAccel(
          prevA,
          targetAccel,
          nearestGap,
          minGap,
          stoppingForSignal,
          dt,
          traits.jerkMult
        );
        v.prevAccel = smoothedAccel;
        v.brakingHard = smoothedAccel < -effComfortDecel * 0.65;

        const candidateSpeed = Math.max(0, v.speed + smoothedAccel * dt);
        nextSpeed =
          candidateSpeed > desiredV * 1.05
            ? Math.min(candidateSpeed, Math.max(desiredV * 1.05, v.speed - effComfortDecel * dt))
            : candidateSpeed;
        if (physicalGap <= 0.1 && nextSpeed > physicalLeadSpeed) {
          nextSpeed = Math.max(0, physicalLeadSpeed);
        }
      }

      // Tier 3b In-Box Cooperative Creep: prevent permanent 0 m/s freeze inside the intersection box
      // Only creep when already genuinely committed inside the box (never creep across a red signal!)
      if (
        !v.isReversing &&
        !stoppingForSignal &&
        alreadyInBox &&
        vInsideBox &&
        (v.boxWaitTime ?? 0) >= 3.2 &&
        nextSpeed < 0.6 &&
        physicalGap > 0.15 &&
        (!blockingLeader || blockingLeader.originArm !== v.originArm)
      ) {
        nextSpeed = 1.05;
      }

      // Post-incident cognitive memory (Ide #3): hard braking, abort overtake, or fresh reverse
      const freshHardBrake = Boolean(v.brakingHard) && !wasBrakingHard && v.speed > 2.5;
      const freshAbort = v.overtakeState === 'abort' && !wasAbortOvertake;
      const freshReverse = Boolean(v.isReversing) && !wasReversing;
      if (freshHardBrake || freshAbort || freshReverse) {
        v.cautionTimer = Math.max(v.cautionTimer ?? 0, vTraits.postIncidentCautionSec);
        v.frustration = Math.min(1, (v.frustration ?? 0) + vTraits.postIncidentFrustSpike);
      }
      if (v.brakingHard && !v.hardBrakeCounted && v.speed > 2.0) {
        this.archetypeStats[vTraits.archetype].hardBrakes += 1;
        this.frictionGrid.recordEvent(v.x, v.y, vTraits.archetype, 0.9);
        v.hardBrakeCounted = true;
      } else if (!v.brakingHard) {
        v.hardBrakeCounted = false;
      }

      // Dynamic driver frustration escalation & mid-road stuck tracking (archetype-calibrated)
      const frustTraits = vTraits;
      if (!v.isReversing && v.speed < 0.9 && !vInsideBox) {
        const baseRate = stoppingForSignal || v.isYielding || v.holdingYellowBox ? 0.035 : 0.14;
        const heavyPenaltyMult =
          blockingLeader?.vClass === 'heavy' && v.vClass !== 'heavy' && frustTraits.archetype !== 'defensive'
            ? 1.25
            : 1.0;
        v.frustration = Math.min(1, (v.frustration ?? 0) + dt * baseRate * frustTraits.frustrationGrowMult * heavyPenaltyMult);
      } else if (v.speed >= 3.0) {
        v.frustration = Math.max(0, (v.frustration ?? 0) - dt * 0.18 * frustTraits.frustrationDecayMult);
      }

      // Ide #8: Tactical telemetry intentTag classification
      let intentTag: VehicleIntentTag = 'cruise';
      if (v.isReversing) {
        intentTag = 'reverse';
      } else if (v.overtakeState && v.overtakeState !== 'none') {
        intentTag = 'overtake';
      } else if (v.holdingYellowBox) {
        intentTag = 'yellow_box';
      } else if (v.handshakePartnerId !== undefined && (v.pendingLaneChangeDir || v.laneChangeDir)) {
        intentTag = 'handshake';
      } else if (
        didTailgateYield ||
        (v.laneChangeDir === 'left' && (v.tailgatePressure ?? 0) > 0.45 && vTraits.tailgateYieldSens >= 0.75)
      ) {
        intentTag = 'tailgate_yield';
      } else if (v.isYielding) {
        intentTag = 'yield';
      } else if (v.occlusionPeekActive) {
        intentTag = 'peek';
      } else if (light === 'yellow' && v.yellowCommitted && v.distanceAlongPath < v.stopLineDist) {
        intentTag = 'dilemma_commit';
      } else if (isGlosaCoasting) {
        intentTag = 'glosa';
      } else if (isRhkPacking || v.rhkAnticipating) {
        intentTag = 'rhk_pack';
      } else if ((v.cautionTimer ?? 0) > 0) {
        intentTag = 'caution';
      }
      v.intentTag = intentTag;

      // Ide #15: Running per-archetype frustration & speed telemetry accumulators
      const archStat = this.archetypeStats[vTraits.archetype];
      archStat.frustrationSum += v.frustration ?? 0;
      archStat.frustrationSamples += 1;
      archStat.speedSum += nextSpeed;
      archStat.speedSamples += 1;

      if (!v.isReversing && v.speed < 0.5 && !stoppingForSignal && !isQueuedBehindRed && !v.isYielding && !v.holdingYellowBox && !vInsideBox) {
        v.stuckTimer = (v.stuckTimer ?? 0) + dt;
      } else if (v.speed >= 1.2 || stoppingForSignal || isQueuedBehindRed || v.isYielding || v.holdingYellowBox || v.isReversing) {
        v.stuckTimer = 0;
      }

      decisions.push({
        v,
        nextSpeed,
        nextLat,
        nextLatVel,
        nextSteerAngle,
        physicalGap,
        physicalLeadSpeed,
        hasBlockingLeader,
        sameArmBlocked: blockingLeader?.originArm === v.originArm,
        nearestRearGap,
        nextCrossingMarking: false,
      });
    }

    // Post-decision pairwise lateral guard prevents simultaneous converging steps into OBB overlap
    resolvePairwiseLateralGuard(decisions, lwDefault, this.compiledTopology.armsById, dt, 0.14);

    const toRemove = new Set<number>();
    for (const {
      v,
      nextSpeed,
      nextLat,
      nextLatVel,
      nextSteerAngle,
      physicalGap,
      physicalLeadSpeed,
      hasBlockingLeader,
      sameArmBlocked,
      nearestRearGap,
    } of decisions) {
      const armGeom = this.compiledTopology.armsById[v.originArm];
      const lw = armGeom?.def.inLaneWidths[v.laneIndex] ?? lwDefault;
      const nextGlobalLat = getGlobalLat(v.laneIndex, nextLat, lw, armGeom?.inLaneCenters);
      const inOncomingPass = Boolean(v.overtakeState && v.overtakeState !== 'none');
      const isCrossCenterAnywhere = armGeom ? nextGlobalLat < armGeom.halfMedian + 0.16 : nextGlobalLat < 0.16;
      const isOnShoulderApproach =
        v.distanceAlongPath < v.stopLineDist - 1.5 &&
        (armGeom ? nextGlobalLat > armGeom.halfMedian + armGeom.inWidth - 0.16 : false);
      const nextCrossingMarking = inOncomingPass || isCrossCenterAnywhere || isOnShoulderApproach;
      if (nextCrossingMarking && !v.markedCrossCounted) {
        this.markingCrossCount += 1;
        const crossArch = getDriverTraits(v).archetype;
        this.archetypeStats[crossArch].markingCrosses += 1;
        this.frictionGrid.recordEvent(v.x, v.y, crossArch, 0.65);
        v.markedCrossCounted = true;
      } else if (!nextCrossingMarking) {
        v.markedCrossCounted = false;
      }

      v.speed = nextSpeed;
      v.lateralOffset = nextLat;
      v.lateralVelocity = nextLatVel;
      v.steerAngle = nextSteerAngle;
      v.crossingMarking = nextCrossingMarking;

      const minBuffer = 0.05;
      if (v.isReversing) {
        const rawBack = Math.min(
          v.speed * dt,
          Number.isFinite(nearestRearGap) ? Math.max(0, nearestRearGap - 0.25) : v.speed * dt,
          Math.max(0, v.distanceAlongPath - 0.5)
        );
        v.distanceAlongPath -= rawBack;
      } else {
        const rawAdvance = v.speed * dt;
        const inBoxCreepOverride =
          v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 &&
          !v.hasExitedIntersection &&
          (v.boxWaitTime ?? 0) >= 3.5 &&
          physicalGap > 0.15 &&
          !sameArmBlocked;
        const maxAdvance =
          hasBlockingLeader && Number.isFinite(physicalGap) && !inBoxCreepOverride
            ? Math.max(0, physicalGap + Math.max(0, physicalLeadSpeed) * dt - minBuffer)
            : rawAdvance;
        v.distanceAlongPath += Math.min(rawAdvance, maxAdvance);
      }

      if (v.speed < QUEUE_SPEED_THRESHOLD && v.distanceAlongPath < v.stopLineDist) v.waitingTime += dt;
      if (v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 && !v.hasExitedIntersection) {
        if (!v.isReversing && v.speed < 0.5) {
          v.boxWaitTime = (v.boxWaitTime ?? 0) + dt;
        } else if (v.speed >= 1.5 || v.isReversing) {
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
        const exitArch = getDriverTraits(v).archetype;
        this.archetypeStats[exitArch].exited += 1;
        this.archetypeStats[exitArch].totalWait += v.waitingTime;
        this.rollingExits.push({ t: this.simTime, wait: v.waitingTime });
        if (v.waitingTime > this.maxWaitTimeObserved) this.maxWaitTimeObserved = v.waitingTime;
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
          v.isReversing ? -v.lateralVelocity : v.lateralVelocity,
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
    enforceParallelLateralSeparation(
      this.vehicles,
      lwDefault,
      this.compiledTopology.armsById,
      this.spatialHash,
      this.queryBufB
    );
  }

  private countQueue(): number {
    return this.vehicles.filter((v) => v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD).length;
  }

  private countQueueForArm(armId: string): number {
    return this.vehicles.filter(
      (v) => v.originArm === armId && v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD
    ).length;
  }

  public getSnapshot(): SimSnapshot {
    const queueByArm: Record<ArmId, number> = { north: 0, east: 0, south: 0, west: 0 };
    const queueByArmId: Record<string, number> = {};
    for (const id of this.compiledTopology.armOrder) queueByArmId[id] = 0;

    const activeByArch: Record<DriverArchetype, number> = {
      defensive: 0,
      commuter: 0,
      hurried: 0,
      courier: 0,
      transit: 0,
      logistics: 0,
    };
    let activeQueueCount = 0;
    let boxStuckCount = 0;
    for (const v of this.vehicles) {
      activeByArch[getDriverTraits(v).archetype] += 1;
      if (v.distanceAlongPath < v.stopLineDist && v.speed < QUEUE_SPEED_THRESHOLD) {
        queueByArmId[v.originArm] = (queueByArmId[v.originArm] ?? 0) + 1;
        if (v.originArm === 'north' || v.originArm === 'east' || v.originArm === 'south' || v.originArm === 'west') {
          queueByArm[v.originArm] += 1;
        }
        activeQueueCount += 1;
      }
      if (
        !v.isSlipLane &&
        !v.isUTurn &&
        v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.05 &&
        !v.hasExitedIntersection &&
        (v.boxWaitTime ?? 0) >= 2.0
      ) {
        boxStuckCount += 1;
      }
    }

    const activePhase = this.phases[this.activePhaseIndex];
    const primaryArmId = activePhase?.permissions[0]?.armId ?? ARM_ORDER[this.activePhaseIndex % 4];
    const activeArm = toLegacyArmId(primaryArmId);

    const armColors: Record<string, SignalColor> = {};
    const armRightArrowColors: Record<string, SignalColor | undefined> = {};
    for (const armId of this.compiledTopology.armOrder) {
      armColors[armId] = this.getArmDisplayColor(armId);
      armRightArrowColors[armId] = this.getArmRightArrowColor(armId);
    }

    const avgWaitTime = this.exitedWaitCount > 0 ? +(this.totalExitedWaitTime / this.exitedWaitCount).toFixed(1) : 0;
    const maxWaitTime = +this.maxWaitTimeObserved.toFixed(1);
    const throughputPerHour = this.simTime > 1 ? Math.round((this.totalExitedAllTime / this.simTime) * 3600) : 0;

    // Rolling 60s window metrics for non-stationary Time-of-Day curves
    const rollingWindowSec = Math.min(60, Math.max(1, this.simTime));
    const rollingThroughputPerHour =
      this.simTime > 2 ? Math.round((this.rollingExits.length / rollingWindowSec) * 3600) : throughputPerHour;
    const rollingAvgWaitTime =
      this.rollingExits.length > 0
        ? +(this.rollingExits.reduce((s, r) => s + r.wait, 0) / this.rollingExits.length).toFixed(1)
        : avgWaitTime;

    return {
      config: { ...this.config },
      signal: {
        activeArm,
        activeColor: this.activeColor,
        phaseRemaining: Math.max(0, this.phaseRemaining),
        phaseElapsed: this.phaseElapsed,
        cycleNumber: this.cycleNumber,
        armLights: {
          north: armColors.north ?? 'red',
          east: armColors.east ?? 'red',
          south: armColors.south ?? 'red',
          west: armColors.west ?? 'red',
        },
        multiPhase: {
          activePhaseIndex: this.activePhaseIndex,
          activePhaseLabel: activePhase?.label ?? activeArm,
          phaseCount: this.phases.length,
          armColors,
          armRightArrowColors,
        },
      },
      vehicles: this.vehicles.map((v) => {
        const {
          path: _p,
          compiledPath: _cp,
          pathKey: _pk,
          targetLateralOffset: _t,
          lateralVelocity: _lv,
          steerAngle: _sa,
          speedFactor: _sf,
          accelFactor: _af,
          reactionTimer: _rt,
          prevAccel: _pa,
          boxWaitTime: _bw,
          willRunRed: _wr,
          yellowCommitted: _yc,
          respectsYellowBox: _ryb,
          stopCreepMeters: _scm,
          laneChangeCooldown: _lcc,
          overtakeTimer: _ot,
          stuckTimer: _st,
          reverseTimer: _rtm,
          reverseCooldown: _rcd,
          reverseSteerDir: _rsd,
          markedCrossCounted: _mcc,
          turnSignalActive: _tsa,
          signalLeadTimer: _slt,
          redWaitTime: _rwt,
          hardBrakeCounted: _hbc,
          yieldCounted: _ycnt,
          yellowBoxCounted: _ybc,
          tailgateYieldCounted: _tyc,
          handshakeCounted: _hsc,
          speedAccum: _sacc,
          speedSamples: _ssmp,
          frustrationAccum: _facc,
          frustrationSamples: _fsmp,
          ...rest
        } = v;
        return {
          ...rest,
          archetype: getDriverTraits(v).archetype,
          frustration: +(v.frustration ?? 0).toFixed(2),
          turnSignal: getEffectiveBlinkerDir(v),
          occlusionPeekActive: Boolean(v.occlusionPeekActive),
          wideSwingState: v.wideSwingState ?? 'none',
          tailgatePressure: +(v.tailgatePressure ?? 0).toFixed(2),
          cautionTimer: +(v.cautionTimer ?? 0).toFixed(2),
          pendingLaneChangeDir: v.pendingLaneChangeDir ?? null,
          overtakeTargetId: v.overtakeTargetId,
          yieldTargetId: v.yieldTargetId,
          leaderId: v.leaderId,
          handshakePartnerId: v.handshakePartnerId,
          flankingHazard: +(v.flankingHazard ?? 0).toFixed(2),
          rhkAnticipating: Boolean(v.rhkAnticipating),
          svoAngle: v.svoAngle !== undefined ? +v.svoAngle.toFixed(3) : undefined,
          intentTag: v.intentTag ?? 'cruise',
        };
      }),
      stats: {
        simTime: this.simTime,
        currentPhaseExited: { ...this.currentPhaseExited },
        currentCycleExited: { ...this.currentCycleExited },
        totalExitedAllTime: this.totalExitedAllTime,
        avgWaitTime,
        maxWaitTime,
        throughputPerHour,
        rollingThroughputPerHour,
        rollingAvgWaitTime,
        boxStuckCount,
        activeQueueCount,
        queueByArm,
        queueByArmId,
        carOvertakeCount: this.carOvertakeCount,
        oncomingOvertakeCount: this.oncomingOvertakeCount,
        yieldConflictCount: this.yieldConflictCount,
        yellowBoxHoldCount: this.yellowBoxHoldCount,
        reverseRecoveryCount: this.reverseRecoveryCount,
        markingCrossCount: this.markingCrossCount,
        driverStats: ARCHETYPE_ORDER.reduce((acc, arch) => {
          const st = this.archetypeStats[arch];
          acc[arch] = {
            exited: st.exited,
            totalWait: +st.totalWait.toFixed(1),
            avgWait: st.exited > 0 ? +(st.totalWait / st.exited).toFixed(1) : 0,
            overtakes: st.overtakes,
            markingCrosses: st.markingCrosses,
            activeCount: activeByArch[arch],
            hardBrakes: st.hardBrakes,
            yieldsGiven: st.yieldsGiven,
            yellowBoxHolds: st.yellowBoxHolds,
            tailgateYields: st.tailgateYields,
            handshakes: st.handshakes,
            avgFrustration:
              st.frustrationSamples > 0 ? +(st.frustrationSum / st.frustrationSamples).toFixed(2) : 0,
            avgSpeed: st.speedSamples > 0 ? +(st.speedSum / st.speedSamples).toFixed(2) : 0,
          };
          return acc;
        }, {} as Record<DriverArchetype, ArchetypeStat>),
        environment: {
          timeMode: this.envState.timeMode,
          clockHour: this.envState.clockHour,
          clockLabel: this.envState.clockLabel,
          periodLabel: this.envState.periodLabel,
          demandMultiplier: +this.envState.demandMultiplier.toFixed(2),
          weather: this.envState.weather.condition,
          weatherLabel: this.envState.weather.label,
          friction: this.envState.weather.friction,
          rainIntensity: this.envState.weather.rainIntensity,
          ambientDarkness: this.envState.ambientDarkness,
        },
        phaseHistory: [...this.phaseHistory],
        cycleHistory: [...this.cycleHistory],
      },
      frictionGrid: this.frictionGrid.toSnapshot(),
    };
  }
}
