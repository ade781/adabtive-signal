import { exportSimulationReportXlsx } from '../utils/reportExporter';
import { type SimVehicle, assignReactionWave } from './behaviors';
import {
  computeDisciplineParams,
  evaluateBlinkerIntentPocket,
  evaluateZipperMergeGiveWay,
} from './conflictResolver';
import {
  ARCHETYPE_ORDER,
  ARCHETYPE_TRAITS,
  DRIVER_MIX_PRESETS,
  computeContextualBehaviorMod,
  getDriverTraits,
  resolveSpawnDriverIdentity,
} from './driverIntelligence';
import { DEFAULT_ENVIRONMENT, WEATHER_PROFILES, evaluateEnvironment } from './environmentDynamics';
import {
  computeIidmAcceleration,
  computeMultiAnticipativeLeader,
  evaluateGlosaAndPlatoonDischarge,
  smoothLongitudinalAccel,
} from './longitudinalAI';
import { evaluateMotorcycleCorridorTarget } from './motorcycleAI';
import { evaluateOcclusionPeekingCap, evaluateVehiclePerceptionProfile } from './perceptionAI';
import { DEFAULT_CONFIG, TrafficSimulation } from './simulation';
import { computeCurvatureTargetSpeed, computePurePursuitLateralStep } from './steeringAI';
import { compileTopology, simConfigToTopology } from './topologyBuilder';
import { SimConfig } from './types';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

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

function mkStub(id: number, overrides: Partial<SimVehicle>): SimVehicle {
  return {
    id,
    vClass: 'car',
    spriteKey: '/assets/vehicles/car-sedan-navy.svg',
    originArm: 'north',
    destArm: 'south',
    turn: 'straight',
    laneIndex: 0,
    destLaneIndex: 0,
    lateralOffset: 0,
    targetLateralOffset: 0,
    lateralVelocity: 0,
    steerAngle: 0,
    length: 4.5,
    width: 1.85,
    maxSpeed: 13.5,
    maxAccel: 2.8,
    comfortDecel: 2.8,
    minGap: 1.5,
    timeHeadway: 0.85,
    speed: 8.0,
    distanceAlongPath: 40,
    totalPathLength: 140,
    stopLineDist: 70,
    exitLineDist: 90,
    x: 0,
    y: 0,
    heading: 0,
    hasExitedIntersection: false,
    waitingTime: 0,
    speedFactor: 1,
    accelFactor: 1,
    profile: 'normal',
    reactionTimer: 0,
    svoAngle: 0.35,
    frustration: 0,
    path: {
      turn: 'straight',
      stopLineDist: 70,
      exitLineDist: 90,
      totalPathLength: 140,
      sample: () => ({ x: 0, y: 0, heading: 0 }),
    },
    ...overrides,
  };
}

function obbOverlap(
  ax: number,
  ay: number,
  aHead: number,
  aLen: number,
  aWid: number,
  bx: number,
  by: number,
  bHead: number,
  bLen: number,
  bWid: number
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const maxR = (aLen + bLen) * 0.5 + (aWid + bWid) * 0.5;
  if (dx * dx + dy * dy > maxR * maxR) return false;

  const cosA = Math.cos(aHead);
  const sinA = Math.sin(aHead);
  const cosB = Math.cos(bHead);
  const sinB = Math.sin(bHead);
  const axes = [
    [cosA, sinA],
    [-sinA, cosA],
    [cosB, sinB],
    [-sinB, cosB],
  ];
  for (const [ux, uy] of axes) {
    const centerProj = Math.abs(dx * ux + dy * uy);
    const aProj = Math.abs(cosA * ux + sinA * uy) * (aLen * 0.5) + Math.abs(-sinA * ux + cosA * uy) * (aWid * 0.5);
    const bProj = Math.abs(cosB * ux + sinB * uy) * (bLen * 0.5) + Math.abs(-sinB * ux + cosB * uy) * (bWid * 0.5);
    if (centerProj >= aProj + bProj) return false;
  }
  return true;
}

// 1. Phase 1: Archetype Taxonomy, Fallback & Sprite Correlation
function testTaxonomyAndSpawnCorrelation() {
  for (const arch of ARCHETYPE_ORDER) {
    const t = ARCHETYPE_TRAITS[arch];
    assert(t.speedMult > 0.5 && t.headwayMult > 0.5 && t.steerRateMult > 0.5, `Invalid trait values on ${arch}`);
  }

  assert(getDriverTraits({ profile: 'cautious', vClass: 'car' }).archetype === 'defensive', 'Fallback cautious car');
  assert(getDriverTraits({ profile: 'cautious', vClass: 'heavy' }).archetype === 'transit', 'Fallback cautious heavy');
  assert(getDriverTraits({ profile: 'aggressive', vClass: 'car' }).archetype === 'hurried', 'Fallback aggressive car');

  const rng = mulberry32(42);
  const envState = evaluateEnvironment(0, DEFAULT_ENVIRONMENT);
  const courierCfg: SimConfig = {
    ...DEFAULT_CONFIG,
    driverProfileMix: DRIVER_MIX_PRESETS['courier-dense'].mix,
  };

  let courierMotors = 0;
  let deliveryBoxOnCourier = 0;
  let transitBusOk = 0;
  let logisticsTruckOk = 0;

  for (let i = 0; i < 200; i++) {
    const m = resolveSpawnDriverIdentity('motor', courierCfg, envState, rng);
    if (m.archetype === 'courier') {
      courierMotors++;
      if (m.spriteKey.includes('moto-delivery-box')) deliveryBoxOnCourier++;
    }
    const h = resolveSpawnDriverIdentity('heavy', courierCfg, envState, rng);
    if (h.archetype === 'transit') {
      assert(h.spriteKey.includes('bus-city'), `Expected bus-city sprite for transit, got ${h.spriteKey}`);
      transitBusOk++;
    } else if (h.archetype === 'logistics') {
      assert(h.spriteKey.includes('truck-'), `Expected truck sprite for logistics, got ${h.spriteKey}`);
      logisticsTruckOk++;
    }
  }

  assert(courierMotors > 40, `Expected >40 courier motors in courier-dense preset, got ${courierMotors}`);
  assert(
    deliveryBoxOnCourier / courierMotors >= 0.5,
    `Expected >=50% delivery-box sprites for courier motors, got ${deliveryBoxOnCourier}/${courierMotors}`
  );
  assert(transitBusOk > 0 && logisticsTruckOk > 0, 'Expected both transit buses and logistics trucks');
  console.log(
    `[PASS] Phase 1: Taxonomy & Sprite Correlation (couriers=${courierMotors}, boxSprites=${deliveryBoxOnCourier}, transit=${transitBusOk}, logistics=${logisticsTruckOk})`
  );
}

// 2. Phase 1: Longitudinal IIDM & Jerk Smoothing per Archetype
function testLongitudinalArchetypes() {
  const defTraits = ARCHETYPE_TRAITS.defensive;
  const hurTraits = ARCHETYPE_TRAITS.hurried;

  const defAccel = computeIidmAcceleration({
    speed: 11,
    desiredSpeed: 12,
    gap: 14,
    leadSpeed: 6,
    maxAccel: 2.8 * defTraits.accelMult,
    comfortDecel: 2.8 * defTraits.comfortDecelMult,
    minGap: 1.5 * defTraits.minGapMult,
    timeHeadway: 0.85 * defTraits.headwayMult,
    delta: defTraits.iidmDelta,
  });
  const hurAccel = computeIidmAcceleration({
    speed: 11,
    desiredSpeed: 12,
    gap: 14,
    leadSpeed: 6,
    maxAccel: 2.8 * hurTraits.accelMult,
    comfortDecel: 2.8 * hurTraits.comfortDecelMult,
    minGap: 1.5 * hurTraits.minGapMult,
    timeHeadway: 0.85 * hurTraits.headwayMult,
    delta: hurTraits.iidmDelta,
  });
  assert(defAccel < hurAccel, `Expected defensive driver to ease off earlier (${defAccel.toFixed(2)}) than hurried (${hurAccel.toFixed(2)})`);

  const defJerk = smoothLongitudinalAccel(0, -2.5, 10, 1.5, false, 0.05, defTraits.jerkMult);
  const hurJerk = smoothLongitudinalAccel(0, -2.5, 10, 1.5, false, 0.05, hurTraits.jerkMult);
  assert(Math.abs(defJerk) < Math.abs(hurJerk), `Expected smoother jerk on defensive (${defJerk}) vs hurried (${hurJerk})`);
  console.log('[PASS] Phase 1: Longitudinal IIDM & Jerk Calibration');
}

// 3. Phase 2: Perception, Occlusion Blind-Spot, GLOSA & Asymmetric Courtesy
function testPerceptionAndNegotiation() {
  const clear = WEATHER_PROFILES.clear;
  const defCar = mkStub(1, { profile: 'cautious', archetype: 'defensive' });
  const hurCar = mkStub(2, { profile: 'aggressive', archetype: 'hurried' });
  const cavCar = mkStub(3, { isConnected: true });

  const pDef = evaluateVehiclePerceptionProfile(defCar, null, clear, 0);
  const pHur = evaluateVehiclePerceptionProfile(hurCar, null, clear, 0);
  const pCav = evaluateVehiclePerceptionProfile(cavCar, null, clear, 0);
  assert(pDef.reactionScale > pHur.reactionScale && pCav.reactionScale < pHur.reactionScale, 'Reaction hierarchy invalid');
  assert(pDef.secondLeaderWeight > pHur.secondLeaderWeight, 'Defensive driver should weight 2nd leader stronger');

  const lead1 = mkStub(10, { speed: 9, prevAccel: -0.2 });
  const lead2 = mkStub(11, { speed: 4, prevAccel: -2.4, brakingHard: true });
  const mDef = computeMultiAnticipativeLeader(defCar, 12, 9, lead1, 22, 4, lead2, clear, pDef);
  const mHur = computeMultiAnticipativeLeader(hurCar, 12, 9, lead1, 22, 4, lead2, clear, pHur);
  assert(mDef.effectiveLeadSpeed < mHur.effectiveLeadSpeed, 'Defensive multi-leader anticipation should lower effective lead speed more');

  // Heavy wide-swinging blind-spot peeking
  const heavyTurning = mkStub(20, {
    vClass: 'heavy',
    x: 5,
    y: 2.5,
    turn: 'left',
    wideSwingState: 'pre_swing',
    distanceAlongPath: 64,
    stopLineDist: 70,
  });
  const peekSelf = mkStub(21, {
    profile: 'cautious',
    archetype: 'defensive',
    x: 0,
    y: 0,
    distanceAlongPath: 60,
    stopLineDist: 70,
  });
  const peekRes = evaluateOcclusionPeekingCap(
    peekSelf,
    [peekSelf, heavyTurning],
    'green',
    clear,
    computeDisciplineParams(0.72)
  );
  assert(peekRes.isPeeking && peekRes.speedCap < 5.0, 'Expected blind-spot peeking speed cap beside wide-swinging heavy truck');

  // Asymmetric courtesy toward merging transit bus
  const defFollower = mkStub(30, { profile: 'cautious', archetype: 'defensive', svoAngle: 0.65, x: 0, y: 0, heading: 0, speed: 8 });
  const hurFollower = mkStub(31, { profile: 'aggressive', archetype: 'hurried', svoAngle: 0.1, x: 0, y: 0, heading: 0, speed: 8 });
  const mergingBus = mkStub(32, {
    vClass: 'heavy',
    profile: 'cautious',
    archetype: 'transit',
    x: 11,
    y: -3.2,
    heading: 0,
    laneIndex: 1,
    turnSignalActive: 'right',
    pendingLaneChangeDir: 'right',
    laneChangeDir: 'right',
    lateralVelocity: 0.6,
    targetLateralOffset: 0,
    lateralOffset: -1.5,
  });
  const zipDef = evaluateZipperMergeGiveWay(defFollower, [defFollower, mergingBus], 3.5, clear, computeDisciplineParams(0.55));
  const zipHur = evaluateZipperMergeGiveWay(hurFollower, [hurFollower, mergingBus], 3.5, clear, computeDisciplineParams(0.3));
  assert(Number.isFinite(zipDef.yieldGap), 'Defensive driver should open zipper pocket for merging transit bus');
  assert(Number.isFinite(zipHur.yieldGap), 'Even hurried driver should respect merging heavy bus');

  // Blinker pocket toward regular car: defensive grants, very egoistic hurried ignores
  const mergingCar = mkStub(33, {
    x: 10,
    y: -3.2,
    heading: 0,
    laneIndex: 1,
    turnSignalActive: 'right',
    pendingLaneChangeDir: 'right',
  });
  const pktDef = evaluateBlinkerIntentPocket(defFollower, [defFollower, mergingCar], 3.5, clear);
  const pktHur = evaluateBlinkerIntentPocket(hurFollower, [hurFollower, mergingCar], 3.5, clear);
  assert(Number.isFinite(pktDef.yieldGap) && !Number.isFinite(pktHur.yieldGap), 'Expected defensive to open blinker pocket while egoistic hurried refuses');

  // GLOSA eco-coasting grace & reaction wave
  const glosaDef = evaluateGlosaAndPlatoonDischarge(defCar, 'green', 2.0, 35, null, Infinity, false, false, clear, 12);
  const glosaHur = evaluateGlosaAndPlatoonDischarge(hurCar, 'green', 2.0, 35, null, Infinity, false, false, clear, 12);
  assert(glosaDef.isGlosaCoasting && !glosaHur.isGlosaCoasting, 'Expected defensive to eco-coast before green end while hurried commits');

  const queued = [
    mkStub(40, { vClass: 'motor', profile: 'aggressive', archetype: 'courier', distanceAlongPath: 67, speed: 0 }),
    mkStub(41, { vClass: 'motor', profile: 'cautious', archetype: 'defensive', distanceAlongPath: 64, speed: 0 }),
  ];
  assignReactionWave(queued, 'north', 1, 1.0);
  assert(queued[0].reactionTimer < queued[1].reactionTimer, 'Courier front row should react faster than defensive behind');
  console.log('[PASS] Phase 2: Social Perception, Blind-Spot Peeking, GLOSA & Courtesy');
}

// 4. Phase 3: Motorcycle Corridor, Steering Kinematics & Curvature Speed
function testSpatialAndSteering() {
  const topo = compileTopology(simConfigToTopology(DEFAULT_CONFIG));
  const armGeom = topo.armsById['north'];
  const clear = WEATHER_PROFILES.clear;
  const heavyLeader = mkStub(50, {
    vClass: 'heavy',
    length: 9.2,
    width: 2.5,
    laneIndex: 0,
    distanceAlongPath: 58,
    stopLineDist: 70,
    speed: 0.4,
  });
  const courierMoto = mkStub(51, {
    vClass: 'motor',
    length: 2.0,
    width: 0.85,
    profile: 'aggressive',
    archetype: 'courier',
    laneIndex: 0,
    lateralOffset: 0,
    targetLateralOffset: 0,
    distanceAlongPath: 50,
    stopLineDist: 70,
    speed: 5.0,
    frustration: 0.5,
  });
  const defMoto = mkStub(52, {
    ...courierMoto,
    id: 52,
    profile: 'cautious',
    archetype: 'defensive',
  });

  const corrCourier = evaluateMotorcycleCorridorTarget({
    v: courierMoto,
    vehicles: [courierMoto, heavyLeader],
    config: DEFAULT_CONFIG,
    topology: topo,
    armGeom,
    lw: 3.5,
    roadW: 7.0,
    light: 'red',
    desiredV: 13,
    nearestGap: 2.4,
    blockingLeader: heavyLeader,
    weather: clear,
    hasPhysicalMedian: false,
    discipline: computeDisciplineParams(0.55),
  });
  const corrDef = evaluateMotorcycleCorridorTarget({
    v: defMoto,
    vehicles: [defMoto, heavyLeader],
    config: DEFAULT_CONFIG,
    topology: topo,
    armGeom,
    lw: 3.5,
    roadW: 7.0,
    light: 'red',
    desiredV: 11,
    nearestGap: 2.4,
    blockingLeader: heavyLeader,
    weather: clear,
    hasPhysicalMedian: false,
    discipline: computeDisciplineParams(0.55),
  });
  assert(corrCourier !== null && corrDef !== null, 'Expected both motorcycles to evaluate valid RHK corridors');
  assert(!corrDef!.crossingMarking, 'Defensive motor should avoid crossing markings');

  // Steering Pure Pursuit & Curvature Cornering
  const turnPath = topo.pathLookup['north']?.right?.[0];
  assert(Boolean(turnPath), 'Expected compiled right-turn path');
  const defCornerV = computeCurvatureTargetSpeed(
    mkStub(60, { profile: 'cautious', archetype: 'defensive', distanceAlongPath: turnPath!.stopLineDist - 2 }),
    turnPath,
    13,
    clear
  );
  const hurCornerV = computeCurvatureTargetSpeed(
    mkStub(61, { profile: 'aggressive', archetype: 'hurried', distanceAlongPath: turnPath!.stopLineDist - 2 }),
    turnPath,
    13,
    clear
  );
  assert(defCornerV < hurCornerV, `Expected defensive corner speed (${defCornerV.toFixed(2)}) < hurried (${hurCornerV.toFixed(2)})`);

  const stepDef = computePurePursuitLateralStep(
    mkStub(62, { profile: 'cautious', archetype: 'defensive', targetLateralOffset: 1.4, speed: 8 }),
    0.05,
    clear
  );
  const stepKur = computePurePursuitLateralStep(
    mkStub(63, { vClass: 'motor', profile: 'aggressive', archetype: 'courier', targetLateralOffset: 1.4, speed: 8 }),
    0.05,
    clear
  );
  assert(Math.abs(stepKur.steerAngle) > Math.abs(stepDef.steerAngle), 'Courier should steer sharper than defensive');
  console.log('[PASS] Phase 3: Motorcycle Corridor, Curvature Comfort & Pure Pursuit Steering');
}

// 5. Phase 4: Contextual Weather, Herd Coupling, Comparative Simulation & Excel Export
async function testPhase4IntegrationAndExport() {
  const storm = WEATHER_PROFILES['heavy-rain'];
  const ctxHur = computeContextualBehaviorMod(ARCHETYPE_TRAITS.hurried, storm, 0.2);
  const ctxKur = computeContextualBehaviorMod(ARCHETYPE_TRAITS.courier, storm, 0.2);
  assert(ctxHur.seepageWeatherScale < ctxKur.seepageWeatherScale, 'Expected distinct storm adaptation between hurried and courier');

  const commonCfg: SimConfig = {
    ...DEFAULT_CONFIG,
    lanesPerDirection: 2,
    laneWidth: 3.5,
    roadWidthPerDirection: 7.0,
    roadLength: 95,
    motorRate: 48,
    carRate: 30,
    heavyRate: 8,
    greenDuration: 20,
    yellowDuration: 3,
    allRedDuration: 1.5,
    driverDiscipline: 0.55,
    smartOvertaking: true,
    oncomingOvertaking: true,
  };

  const runMix = (label: string, presetKey: 'orderly' | 'courier-dense') => {
    const sim = new TrafficSimulation({
      ...commonCfg,
      driverProfileMix: DRIVER_MIX_PRESETS[presetKey].mix,
    });
    const stuck = new Map<number, number>();
    for (let s = 0; s < 2400; s++) {
      sim.step(0.05);
      if (s % 4 === 0) {
        const snap = sim.getSnapshot();
        for (let i = 0; i < snap.vehicles.length; i++) {
          const a = snap.vehicles[i];
          assert(a.archetype !== undefined, `[${label}] Missing archetype on snapshot vehicle #${a.id}`);
          assert(typeof a.frustration === 'number', `[${label}] Missing frustration on snapshot vehicle #${a.id}`);
          const inBox = !a.isSlipLane && !a.isUTurn && a.distanceAlongPath > a.stopLineDist + 0.5 && a.distanceAlongPath < a.exitLineDist - 0.5;
          if (inBox && a.speed < 0.1) {
            const t = (stuck.get(a.id) ?? 0) + 0.2;
            stuck.set(a.id, t);
            assert(t <= 14.0, `[${label}] Vehicle #${a.id} stuck in box ${t.toFixed(1)}s`);
          } else {
            stuck.set(a.id, 0);
          }
          for (let j = i + 1; j < snap.vehicles.length; j++) {
            const b = snap.vehicles[j];
            const aw = a.vClass === 'motor' ? 0.72 : a.width;
            const bw = b.vClass === 'motor' ? 0.72 : b.width;
            if (obbOverlap(a.x, a.y, a.heading, a.length * 0.84, aw * 0.84, b.x, b.y, b.heading, b.length * 0.84, bw * 0.84)) {
              throw new Error(`[${label}] OBB overlap between v#${a.id}(${a.archetype}) and v#${b.id}(${b.archetype})`);
            }
          }
        }
      }
    }
    return sim.getSnapshot();
  };

  const orderlySnap = runMix('Orderly Mix', 'orderly');
  const courierSnap = runMix('Courier-Dense Mix', 'courier-dense');

  assert(orderlySnap.stats.totalExitedAllTime >= 40, `Low orderly throughput: ${orderlySnap.stats.totalExitedAllTime}`);
  assert(courierSnap.stats.totalExitedAllTime >= 40, `Low courier throughput: ${courierSnap.stats.totalExitedAllTime}`);

  const sumArchExited = (snap: typeof orderlySnap) =>
    ARCHETYPE_ORDER.reduce((acc, arch) => acc + (snap.stats.driverStats?.[arch]?.exited ?? 0), 0);

  assert(
    sumArchExited(orderlySnap) === orderlySnap.stats.totalExitedAllTime,
    'Orderly driverStats exited sum mismatch'
  );
  assert(
    sumArchExited(courierSnap) === courierSnap.stats.totalExitedAllTime,
    'Courier driverStats exited sum mismatch'
  );
  assert(
    (courierSnap.stats.driverStats?.courier.exited ?? 0) > (orderlySnap.stats.driverStats?.courier.exited ?? 0),
    'Expected more courier exits in courier-dense mix than orderly mix'
  );
  assert(
    (courierSnap.stats.markingCrossCount ?? 0) > (orderlySnap.stats.markingCrossCount ?? 0),
    `Expected more marking crosses in courier-dense (${courierSnap.stats.markingCrossCount}) vs orderly (${orderlySnap.stats.markingCrossCount})`
  );

  // Verify Excel report export with driverStats
  const loadNodeModule = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<Record<string, (...args: unknown[]) => unknown>>;
  const fs = await loadNodeModule('node:fs');
  const os = await loadNodeModule('node:os');
  const path = await loadNodeModule('node:path');
  const proc = (globalThis as { process?: { cwd: () => string; chdir: (dir: string) => void } }).process;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-signal-driver-export-')) as string;
  const prevCwd = proc?.cwd();
  try {
    if (proc) proc.chdir(tmpDir);
    assert(exportSimulationReportXlsx(courierSnap) === true, 'Excel export failed with driverStats');
  } finally {
    if (proc && prevCwd) proc.chdir(prevCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(
    `[PASS] Phase 4: Integration, Archetype Stats & Export (orderlyExited=${orderlySnap.stats.totalExitedAllTime}, courierExited=${courierSnap.stats.totalExitedAllTime}, courierCross=${courierSnap.stats.markingCrossCount} > orderlyCross=${orderlySnap.stats.markingCrossCount}, 0 collisions)`
  );
  console.log('\nALL DRIVER INTELLIGENCE PHASES 1-4 TESTS PASSED!');
}

testTaxonomyAndSpawnCorrelation();
testLongitudinalArchetypes();
testPerceptionAndNegotiation();
testSpatialAndSteering();
void testPhase4IntegrationAndExport().catch((err) => {
  console.error(err);
  const proc = (globalThis as { process?: { exit: (code: number) => void } }).process;
  if (proc) proc.exit(1);
});
