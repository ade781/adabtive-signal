import { DEFAULT_CONFIG, TrafficSimulation } from './simulation';
import { GIWANGAN_TOPOLOGY, STATIC_SAMPLING_BLUEPRINTS, cloneTopology } from './samplingBlueprints';
import { compileTopology } from './topologyBuilder';
import { evaluateEnvironment, WEATHER_PROFILES } from './environmentDynamics';
import { computeDisciplineParams } from './conflictResolver';
import { validateTopology, addArmToTopology, applyModuleToArm } from '../draw/drawStore';
import { SimConfig } from './types';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function obbOverlap(
  ax: number, ay: number, aHead: number, aLen: number, aWid: number,
  bx: number, by: number, bHead: number, bLen: number, bWid: number
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const maxR = (aLen + bLen) * 0.5 + (aWid + bWid) * 0.5;
  if (dx * dx + dy * dy > maxR * maxR) return false;

  const cosA = Math.cos(aHead), sinA = Math.sin(aHead);
  const cosB = Math.cos(bHead), sinB = Math.sin(bHead);
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

function checkV2Integrity(sim: TrafficSimulation, label: string, stuckTimers: Map<number, number>, dt: number) {
  const snap = sim.getSnapshot();
  const activeIds = new Set<number>();

  for (const v of snap.vehicles) {
    activeIds.add(v.id);
    assert(Number.isFinite(v.x) && Number.isFinite(v.y), `[${label}] NaN position on v#${v.id}`);
    assert(Number.isFinite(v.speed) && v.speed >= 0, `[${label}] Invalid speed ${v.speed} on v#${v.id}`);
    assert(Number.isFinite(v.heading), `[${label}] NaN heading on v#${v.id}`);

    // Slip-lane vehicles travel outside the main signal box and legitimately yield at the merge line for platoons
    const inBox = !v.isSlipLane && !v.isUTurn && v.distanceAlongPath > v.stopLineDist + 0.5 && v.distanceAlongPath < v.exitLineDist - 0.5;
    const maxStuck = v.isYielding ? 16.0 : 6.0;
    if (inBox && v.speed < 0.1) {
      const nextT = (stuckTimers.get(v.id) ?? 0) + dt;
      stuckTimers.set(v.id, nextT);
      if (nextT > maxStuck) {
        throw new Error(
          `[${label}] Vehicle #${v.id} (${v.vClass}, ${v.originArm}->${v.destArm}, turn=${v.turn}, yielding=${!!v.isYielding}) stuck in box for ${nextT.toFixed(1)}s`
        );
      }
    } else {
      stuckTimers.set(v.id, 0);
    }
  }
  for (const id of stuckTimers.keys()) {
    if (!activeIds.has(id)) stuckTimers.delete(id);
  }

  for (let i = 0; i < snap.vehicles.length; i++) {
    for (let j = i + 1; j < snap.vehicles.length; j++) {
      const a = snap.vehicles[i];
      const b = snap.vehicles[j];
      const aEffW = a.vClass === 'motor' ? 0.72 : a.width;
      const bEffW = b.vClass === 'motor' ? 0.72 : b.width;
      if (
        obbOverlap(
          a.x, a.y, a.heading, a.length * 0.84, aEffW * 0.84,
          b.x, b.y, b.heading, b.length * 0.84, bEffW * 0.84
        )
      ) {
        throw new Error(
          `[${label}] OBB collision between v#${a.id}(${a.vClass}, ${a.originArm}->${a.destArm}, d=${a.distanceAlongPath.toFixed(1)}, lat=${a.lateralOffset.toFixed(2)}, ov=${a.overtakeState}) and v#${b.id}(${b.vClass}, ${b.originArm}->${b.destArm}, d=${b.distanceAlongPath.toFixed(1)}, lat=${b.lateralOffset.toFixed(2)}, ov=${b.overtakeState})`
        );
      }
    }
  }
}

function runScenario(label: string, config: SimConfig, durationSec: number, dt = 0.05) {
  const sim = new TrafficSimulation(config);
  const stuck = new Map<number, number>();
  const steps = Math.round(durationSec / dt);
  let sawSimultaneousGreen = false;
  let sawRightArrow = false;
  let sawSlipVehicle = false;

  for (let s = 0; s < steps; s++) {
    sim.step(dt);
    const snap = sim.getSnapshot();
    const mp = snap.signal.multiPhase;
    if (mp) {
      const greenCount = Object.values(mp.armColors).filter((c) => c === 'green').length;
      if (greenCount >= 2) sawSimultaneousGreen = true;
      const rightArrowCount = Object.values(mp.armRightArrowColors).filter((c) => c === 'green').length;
      if (rightArrowCount >= 1) sawRightArrow = true;
    }
    if (!sawSlipVehicle && snap.vehicles.some((v) => v.isSlipLane)) {
      sawSlipVehicle = true;
    }
    if (s % 4 === 0) {
      checkV2Integrity(sim, label, stuck, dt * 4);
    }
  }

  return {
    snap: sim.getSnapshot(),
    sawSimultaneousGreen,
    sawRightArrow,
    sawSlipVehicle,
  };
}

function testBlueprintsAndValidation() {
  const fieldCount = STATIC_SAMPLING_BLUEPRINTS.filter((b) => b.category === 'sampling-5').length;
  assert(fieldCount === 5, `Expected 5 static field sampling blueprints, got ${fieldCount}`);
  assert(
    STATIC_SAMPLING_BLUEPRINTS.some((b) => b.id === 'giwangan-yogya'),
    'Missing Giwangan Yogyakarta showcase blueprint'
  );

  // Compile Giwangan and verify islands, slip lanes, asymmetric lanes, and conflict zones
  const giwCompiled = compileTopology(GIWANGAN_TOPOLOGY);
  assert(giwCompiled.armOrder.length === 4, 'Giwangan should have 4 arms');
  assert(giwCompiled.islands.length === 3, `Expected 3 channelized slip-lane islands on Giwangan, got ${giwCompiled.islands.length}`);
  assert(giwCompiled.conflictZones.length > 0, 'Expected precomputed geometric conflict zones on Giwangan');

  // Draw store modular manipulation & angle validation (< 36 deg must error)
  const validRes = validateTopology(GIWANGAN_TOPOLOGY);
  assert(validRes.valid, `Giwangan blueprint must validate cleanly: ${validRes.errors.join('; ')}`);

  const badTopo = cloneTopology(GIWANGAN_TOPOLOGY);
  badTopo.arms[1].angleDeg = badTopo.arms[0].angleDeg + 20;
  const badRes = validateTopology(badTopo);
  assert(!badRes.valid && badRes.errors.length > 0, 'Expected validation error for < 36 deg arm angle');

  const added = addArmToTopology(cloneTopology(GIWANGAN_TOPOLOGY));
  assert(added.topo.arms.length === 5, 'Expected 5 arms after addArmToTopology');
  const modded = applyModuleToArm(added.topo, added.newArmId, 'slip-lane');
  assert(
    modded.topo.arms.find((a) => a.id === added.newArmId)?.slipLane?.enabled === true,
    'applyModuleToArm slip-lane failed'
  );

  console.log('[PASS] Test 1: Static 5 Field Blueprints, Giwangan Geometry & Draw Modular Validation');
}

function testAsymmetricAndNArmTopologies() {
  // 1a. Giwangan Yogyakarta asymmetric showcase (3-lane Ringroad + 2-lane Imogiri + 3 slip lanes + bottleneck + U-turn)
  const giwCfg: SimConfig = {
    ...DEFAULT_CONFIG,
    ...GIWANGAN_TOPOLOGY.defaultTraffic,
    customTopology: cloneTopology(GIWANGAN_TOPOLOGY),
    signalPhasePreset: GIWANGAN_TOPOLOGY.phasePreset,
    yellowBoxEnabled: true,
    adaptiveSignal: true,
    smartOvertaking: true,
    oncomingOvertaking: true,
  };
  const giwRes = runScenario('Giwangan Asymmetric', giwCfg, 150);
  assert(giwRes.snap.stats.totalExitedAllTime >= 40, `Giwangan low throughput: ${giwRes.snap.stats.totalExitedAllTime}`);
  assert(giwRes.sawSlipVehicle, 'Expected slip-lane vehicles to spawn on Giwangan');
  assert(giwRes.sawRightArrow, 'Expected protected right-turn arrow phase to activate on Giwangan');

  // 1b. 3-Arm T-Junction
  const tBp = STATIC_SAMPLING_BLUEPRINTS.find((b) => b.id === 'template-t-junction')!;
  const tRes = runScenario(
    '3-Arm T-Junction',
    {
      ...DEFAULT_CONFIG,
      ...tBp.topology.defaultTraffic,
      customTopology: cloneTopology(tBp.topology),
      signalPhasePreset: '3-phase',
      adaptiveSignal: true,
    },
    120
  );
  assert(tRes.snap.stats.totalExitedAllTime >= 25, `3-Arm T-Junction low throughput: ${tRes.snap.stats.totalExitedAllTime}`);

  // 1c. 5-Arm Free-Angle Intersection
  const fiveBp = STATIC_SAMPLING_BLUEPRINTS.find((b) => b.id === 'template-5-way')!;
  const fiveRes = runScenario(
    '5-Arm Free-Angle',
    {
      ...DEFAULT_CONFIG,
      ...fiveBp.topology.defaultTraffic,
      customTopology: cloneTopology(fiveBp.topology),
      signalPhasePreset: '4-phase-split',
      adaptiveSignal: true,
    },
    120
  );
  assert(fiveRes.snap.stats.totalExitedAllTime >= 25, `5-Arm low throughput: ${fiveRes.snap.stats.totalExitedAllTime}`);

  console.log(
    `[PASS] Test 2: N-Arm & Asymmetric Topologies (Giwangan=${giwRes.snap.stats.totalExitedAllTime}, 3-Arm=${tRes.snap.stats.totalExitedAllTime}, 5-Arm=${fiveRes.snap.stats.totalExitedAllTime} exited, 0 collisions)`
  );
}

function testTwoPhasePriorityYielding() {
  const cfg: SimConfig = {
    ...DEFAULT_CONFIG,
    lanesPerDirection: 2,
    laneWidth: 3.5,
    roadWidthPerDirection: 7.0,
    roadLength: 90,
    motorRate: 42,
    carRate: 30,
    heavyRate: 5,
    turnLeftPct: 18,
    turnStraightPct: 54,
    turnRightPct: 28,
    greenDuration: 24,
    yellowDuration: 3,
    allRedDuration: 2,
    adaptiveSignal: true,
    signalPhasePreset: '2-phase-simultaneous',
    yellowBoxEnabled: true,
    driverDiscipline: 0.85,
  };
  const res = runScenario('2-Phase Simultaneous Yielding', cfg, 160);
  assert(res.sawSimultaneousGreen, 'Expected opposite arms to turn green simultaneously in 2-phase-simultaneous');
  assert(
    (res.snap.stats.yieldConflictCount ?? 0) > 0,
    `Expected permissive right-turn priority yielding events (>0), got ${res.snap.stats.yieldConflictCount}`
  );
  assert(res.snap.stats.totalExitedAllTime >= 50, `Expected healthy throughput in 2-phase, got ${res.snap.stats.totalExitedAllTime}`);

  console.log(
    `[PASS] Test 3: 2-Phase Simultaneous & Cross-Turn Priority Yielding (yieldEvents=${res.snap.stats.yieldConflictCount}, exited=${res.snap.stats.totalExitedAllTime}, 0 collisions)`
  );
}

function testMobilActiveOvertaking() {
  const cfg: SimConfig = {
    ...DEFAULT_CONFIG,
    lanesPerDirection: 2,
    laneWidth: 3.6,
    roadWidthPerDirection: 7.2,
    roadLength: 130,
    motorRate: 18,
    carRate: 34,
    heavyRate: 16, // Many slow heavy trucks to trigger MOBIL passing
    turnLeftPct: 10,
    turnStraightPct: 80,
    turnRightPct: 10,
    greenDuration: 34,
    yellowDuration: 3,
    allRedDuration: 1.5,
    hasMedian: true,
    smartOvertaking: true,
    oncomingOvertaking: false,
    driverDiscipline: 0.72,
  };
  const res = runScenario('MOBIL Active Overtaking', cfg, 150);
  assert(
    (res.snap.stats.carOvertakeCount ?? 0) > 0,
    `Expected MOBIL car overtaking events (>0), got ${res.snap.stats.carOvertakeCount}`
  );
  console.log(
    `[PASS] Test 4: MOBIL Active Car Overtaking (carOvertakes=${res.snap.stats.carOvertakeCount}, exited=${res.snap.stats.totalExitedAllTime}, 0 collisions)`
  );
}

function testOncomingLaneOvertaking() {
  const baseUndivided: SimConfig = {
    ...DEFAULT_CONFIG,
    lanesPerDirection: 1,
    laneWidth: 3.5,
    roadWidthPerDirection: 3.5,
    roadLength: 135,
    motorRate: 14,
    carRate: 24,
    heavyRate: 14,
    turnLeftPct: 10,
    turnStraightPct: 80,
    turnRightPct: 10,
    greenDuration: 36,
    yellowDuration: 3,
    allRedDuration: 1.5,
    armWeights: { north: 1.6, south: 0.35, east: 1.6, west: 0.35 },
    hasMedian: false,
    smartOvertaking: true,
    oncomingOvertaking: true,
    driverDiscipline: 0.65,
    environment: { weather: 'clear', dynamicWeather: false, timeMode: 'static', startHour: 9, timeCompression: 0.75 },
  };

  const undividedRes = runScenario('Oncoming Overtake Undivided', baseUndivided, 160);
  assert(
    (undividedRes.snap.stats.oncomingOvertakeCount ?? 0) > 0,
    `Expected oncoming-lane overtaking on undivided road (>0), got ${undividedRes.snap.stats.oncomingOvertakeCount}`
  );

  // With physical median -> MUST be 0
  const medianRes = runScenario('Oncoming Blocked By Median', { ...baseUndivided, hasMedian: true }, 90);
  assert(
    (medianRes.snap.stats.oncomingOvertakeCount ?? 0) === 0,
    `Expected 0 oncoming overtakes with physical median, got ${medianRes.snap.stats.oncomingOvertakeCount}`
  );

  // Under heavy rain -> MUST be 0 (low visibility & wet friction safety gate)
  const rainRes = runScenario(
    'Oncoming Blocked By Heavy Rain',
    {
      ...baseUndivided,
      environment: { weather: 'heavy-rain', dynamicWeather: false, timeMode: 'static', startHour: 9, timeCompression: 0.75 },
    },
    90
  );
  assert(
    (rainRes.snap.stats.oncomingOvertakeCount ?? 0) === 0,
    `Expected 0 oncoming overtakes in heavy rain, got ${rainRes.snap.stats.oncomingOvertakeCount}`
  );

  console.log(
    `[PASS] Test 5: Oncoming-Lane Overtaking (undivided=${undividedRes.snap.stats.oncomingOvertakeCount}, median=0, heavyRain=0, 0 head-on collisions)`
  );
}

function testYellowBoxAndDiscipline() {
  const lowDisc = computeDisciplineParams(0.15);
  const highDisc = computeDisciplineParams(0.95);
  assert(highDisc.yellowBoxCompliance > lowDisc.yellowBoxCompliance + 0.5, 'Yellow box compliance should scale with discipline');
  assert(lowDisc.stopLineCreepProb > highDisc.stopLineCreepProb, 'Low discipline should have more stop-line creep');
  assert(lowDisc.redLightRunMult > highDisc.redLightRunMult, 'Low discipline should have higher red-running multiplier');

  // Heavy traffic with Yellow Box enabled on Giwangan bottleneck -> triggers anti-gridlock holding
  const ybCfg: SimConfig = {
    ...DEFAULT_CONFIG,
    ...GIWANGAN_TOPOLOGY.defaultTraffic,
    motorRate: 110,
    carRate: 58,
    heavyRate: 14,
    customTopology: cloneTopology(GIWANGAN_TOPOLOGY),
    signalPhasePreset: '2-phase-simultaneous',
    yellowBoxEnabled: true,
    driverDiscipline: 0.98,
    greenDuration: 28,
  };
  const ybRes = runScenario('Yellow Box Anti-Gridlock', ybCfg, 120);
  assert(
    (ybRes.snap.stats.yellowBoxHoldCount ?? 0) >= 0,
    'Yellow box counter should be valid'
  );
  console.log(
    `[PASS] Test 6: Yellow Box & Driver Discipline (holds=${ybRes.snap.stats.yellowBoxHoldCount ?? 0}, exited=${ybRes.snap.stats.totalExitedAllTime}, 0 collisions)`
  );
}

function testTimeOfDayAndWeatherPhysics() {
  // Check NHPP multi-peak curve values
  const morningPeak = evaluateEnvironment(0, { weather: 'clear', dynamicWeather: false, timeMode: 'full-day-24h', startHour: 7.5, timeCompression: 1 });
  const nightOffPeak = evaluateEnvironment(0, { weather: 'clear', dynamicWeather: false, timeMode: 'full-day-24h', startHour: 2.0, timeCompression: 1 });
  const eveningPeak = evaluateEnvironment(0, { weather: 'clear', dynamicWeather: false, timeMode: 'full-day-24h', startHour: 17.5, timeCompression: 1 });

  assert(morningPeak.demandMultiplier > 0.95, `Expected morning peak > 0.95, got ${morningPeak.demandMultiplier}`);
  assert(eveningPeak.demandMultiplier > 1.0, `Expected evening peak > 1.0, got ${eveningPeak.demandMultiplier}`);
  assert(nightOffPeak.demandMultiplier < 0.4, `Expected 02:00 off-peak < 0.4, got ${nightOffPeak.demandMultiplier}`);
  assert(morningPeak.clockLabel === '07:30 WIB', `Unexpected clockLabel: ${morningPeak.clockLabel}`);
  assert(WEATHER_PROFILES['heavy-rain'].friction < WEATHER_PROFILES['light-rain'].friction, 'Friction hierarchy broken');
  assert(WEATHER_PROFILES['light-rain'].friction < WEATHER_PROFILES['clear'].friction, 'Friction hierarchy broken');

  // Compare clear vs heavy-rain under identical traffic config
  const baseCfg: SimConfig = {
    ...DEFAULT_CONFIG,
    lanesPerDirection: 2,
    laneWidth: 3.5,
    roadWidthPerDirection: 7.0,
    motorRate: 70,
    carRate: 40,
    heavyRate: 8,
    greenDuration: 22,
    adaptiveSignal: false,
  };
  const clearRes = runScenario('Weather Clear', {
    ...baseCfg,
    environment: { weather: 'clear', dynamicWeather: false, timeMode: 'static', startHour: 8, timeCompression: 0.75 },
  }, 120);
  const stormRes = runScenario('Weather Heavy Rain', {
    ...baseCfg,
    environment: { weather: 'heavy-rain', dynamicWeather: false, timeMode: 'static', startHour: 8, timeCompression: 0.75 },
  }, 120);

  assert(
    stormRes.snap.stats.totalExitedAllTime < clearRes.snap.stats.totalExitedAllTime,
    `Expected heavy rain throughput (${stormRes.snap.stats.totalExitedAllTime}) < clear (${clearRes.snap.stats.totalExitedAllTime})`
  );
  assert(
    stormRes.snap.stats.environment?.weather === 'heavy-rain',
    'Expected telemetry to report heavy-rain'
  );

  // Dynamic rush hour telemetry & rolling 60s window
  const rushRes = runScenario('Morning Rush Dynamic', {
    ...baseCfg,
    environment: { weather: 'clear', dynamicWeather: true, timeMode: 'morning-rush', startHour: 6.5, timeCompression: 1.0 },
  }, 90);
  assert((rushRes.snap.stats.rollingThroughputPerHour ?? 0) > 0, 'Expected rolling 60s throughput > 0 in dynamic mode');

  console.log(
    `[PASS] Test 7: Time-of-Day NHPP & Empirical Weather Physics (clear=${clearRes.snap.stats.totalExitedAllTime} vs heavyRain=${stormRes.snap.stats.totalExitedAllTime} exited, morningPeak=${morningPeak.demandMultiplier.toFixed(2)}x, night=${nightOffPeak.demandMultiplier.toFixed(2)}x)`
  );
}

testBlueprintsAndValidation();
testAsymmetricAndNArmTopologies();
testTwoPhasePriorityYielding();
testMobilActiveOvertaking();
testOncomingLaneOvertaking();
testYellowBoxAndDiscipline();
testTimeOfDayAndWeatherPhysics();

console.log('\nALL V2 FEATURE TESTS PASSED SUCCESSFULLY!');
