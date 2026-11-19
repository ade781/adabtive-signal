import { computeAdaptiveGreenTarget, getAdaptiveGreenBounds, pickNextArmAdaptive } from './adaptiveController';
import { SimVehicle } from './behaviors';
import { ARM_ORDER, DEFAULT_CONFIG, QUEUE_SPEED_THRESHOLD } from './constants';
import { SCENARIO_PRESETS } from './presets';
import { TrafficSimulation } from './simulation';
import { ArmId, SimConfig, VehicleClass } from './types';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

let nextMockId = 1;
function makeMockVehicle(
  originArm: ArmId,
  vClass: VehicleClass,
  opts: {
    speed?: number;
    distToStop?: number;
    waitingTime?: number;
  } = {}
): SimVehicle {
  const stopLineDist = 75;
  const distToStop = opts.distToStop ?? 10;
  return {
    id: nextMockId++,
    vClass,
    spriteKey: '/assets/vehicles/car-sedan-navy.svg',
    originArm,
    destArm: 'south',
    turn: 'straight',
    laneIndex: 0,
    lateralOffset: 0,
    length: vClass === 'motor' ? 2.0 : vClass === 'heavy' ? 9.2 : 4.5,
    width: vClass === 'motor' ? 0.85 : vClass === 'heavy' ? 2.5 : 1.85,
    maxSpeed: 13.5,
    maxAccel: 2.8,
    comfortDecel: 2.8,
    minGap: 1.5,
    timeHeadway: 0.85,
    speed: opts.speed ?? 0,
    distanceAlongPath: stopLineDist - distToStop,
    totalPathLength: 160,
    stopLineDist,
    exitLineDist: 95,
    x: 0,
    y: 0,
    heading: 0,
    hasExitedIntersection: false,
    waitingTime: opts.waitingTime ?? 0,
    path: {
      turn: 'straight',
      stopLineDist,
      exitLineDist: 95,
      totalPathLength: 160,
      sample: () => ({ x: 0, y: 0, heading: 0 }),
    },
    targetLateralOffset: 0,
    lateralVelocity: 0,
    speedFactor: 1,
    accelFactor: 1,
    profile: 'normal',
    reactionTimer: 0,
  };
}

// 1. Adaptive Controller Edge Cases
{
  const config: SimConfig = {
    ...DEFAULT_CONFIG,
    greenDuration: 30,
    lanesPerDirection: 2,
    armGreenDurations: undefined,
  };
  const { minGreen, maxGreen } = getAdaptiveGreenBounds(config, 'north');

  // 1a. totalRedDemand === 0 and 0 < activeDemand < 1 (1-2 motorcycles on active arm, all red arms empty)
  const oneQueuedMotor = [makeMockVehicle('north', 'motor', { speed: 0, distToStop: 5 })];
  const twoApproachingMotors = [
    makeMockVehicle('north', 'motor', { speed: 8, distToStop: 15 }),
    makeMockVehicle('north', 'motor', { speed: 8, distToStop: 25 }),
  ];
  const targetOneMotor = computeAdaptiveGreenTarget(oneQueuedMotor, 'north', config);
  const targetTwoMotors = computeAdaptiveGreenTarget(twoApproachingMotors, 'north', config);
  assert(
    targetOneMotor === maxGreen,
    `[1a] Expected maxGreen (${maxGreen}s) for 1 queued motor when red arms empty, got ${targetOneMotor}s`
  );
  assert(
    targetTwoMotors === maxGreen,
    `[1a] Expected maxGreen (${maxGreen}s) for 2 approaching motors when red arms empty, got ${targetTwoMotors}s`
  );

  // 1b. Red-arm pressure: 1 heavily congested red arm vs 2 empty red arms (not diluted by / 3)
  const activeVehicles = [
    makeMockVehicle('north', 'car', { speed: 0, distToStop: 6 }),
    makeMockVehicle('north', 'car', { speed: 0, distToStop: 12 }),
  ]; // activeDemand = 4
  const concentratedRed = [
    ...activeVehicles,
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 6 }),
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 12 }),
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 18 }),
  ]; // east redScore = 6, south = 0, west = 0 -> maxRedDemand*0.7 = 4.2 > avgRed = 2
  const dilutedRed = [
    ...activeVehicles,
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 6 }),
    makeMockVehicle('south', 'car', { speed: 0, distToStop: 6 }),
    makeMockVehicle('west', 'car', { speed: 0, distToStop: 6 }),
  ]; // east = 2, south = 2, west = 2 -> avgRed = 2, maxRedDemand*0.7 = 1.4
  const targetConcentrated = computeAdaptiveGreenTarget(concentratedRed, 'north', config);
  const targetDiluted = computeAdaptiveGreenTarget(dilutedRed, 'north', config);
  assert(
    targetConcentrated < targetDiluted,
    `[1b] Expected concentrated single red-arm pressure (${targetConcentrated}s) < evenly diluted red-arm pressure (${targetDiluted}s)`
  );
  assert(
    targetConcentrated >= minGreen && targetConcentrated < maxGreen,
    `[1b] Expected targetConcentrated (${targetConcentrated}s) within [${minGreen}, ${maxGreen})`
  );

  // 1c. pickNextArmAdaptive anti-starvation when one arm has high wait time
  const starvationVehicles = [
    // East (index 1) has heavy queue but low wait time
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 6, waitingTime: 4 }),
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 12, waitingTime: 4 }),
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 18, waitingTime: 4 }),
    makeMockVehicle('east', 'car', { speed: 0, distToStop: 24, waitingTime: 4 }),
    // West (index 3) has only 1 motor, but waitingTime = 120s (exceeds starvation threshold)
    makeMockVehicle('west', 'motor', { speed: 0, distToStop: 5, waitingTime: 120 }),
  ];
  const nextIdx = pickNextArmAdaptive(starvationVehicles, 0, ARM_ORDER, config);
  assert(
    nextIdx === 3,
    `[1c] Expected pickNextArmAdaptive to prioritize starved west arm (index 3), got index ${nextIdx} (${ARM_ORDER[nextIdx]})`
  );

  console.log(
    `[PASS] 1. Adaptive Controller Edge Cases: emptyRedTarget=${targetOneMotor}s, concentrated=${targetConcentrated}s < diluted=${targetDiluted}s, starvedArm=${ARM_ORDER[nextIdx]}`
  );
}

// 2. CycleRecord totalGreenDuration & Long-Run History (> 200 phases)
{
  const sim = new TrafficSimulation({
    greenDuration: 8,
    yellowDuration: 1,
    allRedDuration: 0.5,
    adaptiveSignal: true,
    motorRate: 30,
    carRate: 20,
    heavyRate: 4,
  });

  // 210 phases * ~9.5s = ~1995s -> step 2200s at dt=0.1s
  for (let i = 0; i < 22000; i++) {
    sim.step(0.1);
  }

  const snap = sim.getSnapshot();
  assert(
    snap.stats.phaseHistory.length === 200,
    `[2] Expected phaseHistory capped at 200, got ${snap.stats.phaseHistory.length}`
  );
  assert(
    snap.stats.phaseHistory[0].phaseIndex > 200,
    `[2] Expected total phases > 200, got phaseIndex=${snap.stats.phaseHistory[0].phaseIndex}`
  );
  assert(
    snap.stats.cycleHistory.length > 0,
    `[2] Expected non-empty cycleHistory`
  );

  let verifiedMatchedCycles = 0;
  for (const cycle of snap.stats.cycleHistory) {
    const totalGreen = cycle.totalGreenDuration;
    assert(
      typeof totalGreen === 'number' &&
        Number.isFinite(totalGreen) &&
        totalGreen > 0,
      `[2] Cycle ${cycle.cycleNumber} invalid totalGreenDuration: ${totalGreen}`
    );
    assert(
      totalGreen! <= cycle.totalDuration + 0.05,
      `[2] Cycle ${cycle.cycleNumber} totalGreenDuration (${totalGreen}) > totalDuration (${cycle.totalDuration})`
    );

    const phasesInCycle = snap.stats.phaseHistory.filter((p) => p.cycleNumber === cycle.cycleNumber);
    if (phasesInCycle.length === 4) {
      const sumGreen = phasesInCycle.reduce((s, p) => s + p.greenDuration, 0);
      assert(
        Math.abs(sumGreen - totalGreen!) <= 0.4,
        `[2] Cycle ${cycle.cycleNumber} green sum (${sumGreen.toFixed(1)}) != totalGreenDuration (${totalGreen})`
      );
      verifiedMatchedCycles += 1;
    }
  }
  assert(verifiedMatchedCycles > 0, '[2] Expected at least one complete cycle in phaseHistory to cross-check');

  console.log(
    `[PASS] 2. CycleRecord & Long-Run History: latestPhase=${snap.stats.phaseHistory[0].phaseIndex}, phaseHistoryLen=${snap.stats.phaseHistory.length}, cycles=${snap.stats.cycleHistory.length}, matchedCycles=${verifiedMatchedCycles}`
  );
}

// 3. Preset Invariants
{
  const validEnvIds = new Set([
    'default',
    'brimob-yogya',
    'lamper-semarang',
    'sulawesi-banjarmasin',
    'laswi-bandung',
    'bondowoso-malang',
  ]);

  assert(SCENARIO_PRESETS.length > 0, '[3] Expected non-empty SCENARIO_PRESETS');

  for (const preset of SCENARIO_PRESETS) {
    assert(
      typeof preset.patch.environmentId === 'string' && validEnvIds.has(preset.patch.environmentId),
      `[3] Preset "${preset.id}" has invalid environmentId: ${preset.patch.environmentId}`
    );

    const { turnLeftPct, turnStraightPct, turnRightPct, laneWidth, armNames } = preset.patch;
    if (turnLeftPct !== undefined || turnStraightPct !== undefined || turnRightPct !== undefined) {
      const sum = (turnLeftPct ?? 0) + (turnStraightPct ?? 0) + (turnRightPct ?? 0);
      assert(
        sum === 100,
        `[3] Preset "${preset.id}" turn percentages sum to ${sum}, expected 100`
      );
    }

    if (laneWidth !== undefined) {
      assert(
        Number.isFinite(laneWidth) && laneWidth > 0,
        `[3] Preset "${preset.id}" invalid laneWidth: ${laneWidth}`
      );
    }

    if (preset.category === 'field') {
      assert(
        typeof preset.source === 'string' && preset.source.trim().length > 0,
        `[3] Field preset "${preset.id}" missing source`
      );
      assert(
        typeof preset.city === 'string' && preset.city.trim().length > 0,
        `[3] Field preset "${preset.id}" missing city`
      );
      assert(
        typeof preset.landmarks === 'string' && preset.landmarks.trim().length > 0,
        `[3] Field preset "${preset.id}" missing landmarks`
      );
      assert(armNames !== undefined, `[3] Field preset "${preset.id}" missing armNames`);
      for (const arm of ARM_ORDER) {
        assert(
          typeof armNames![arm] === 'string' && armNames![arm].trim().length > 0,
          `[3] Field preset "${preset.id}" missing armNames.${arm}`
        );
      }
    }
  }

  console.log(`[PASS] 3. Preset Invariants: verified ${SCENARIO_PRESETS.length} presets`);
}

// 4. Empty Telemetry & waitingTime Threshold
{
  const sim = new TrafficSimulation({
    motorRate: 40,
    carRate: 30,
    heavyRate: 5,
    leftTurnOnRed: false,
    adaptiveSignal: false,
    greenDuration: 15,
  });

  const fresh = sim.getSnapshot();
  assert(fresh.stats.totalExitedAllTime === 0, `[4] Expected fresh totalExitedAllTime === 0, got ${fresh.stats.totalExitedAllTime}`);
  assert(fresh.stats.avgWaitTime === 0, `[4] Expected fresh avgWaitTime === 0, got ${fresh.stats.avgWaitTime}`);

  // Run until vehicles spawn and some creep at < QUEUE_SPEED_THRESHOLD (1.2 m/s) on red arms
  let observedCreepWait = false;
  for (let i = 0; i < 600; i++) {
    sim.step(0.05);
    const snap = sim.getSnapshot();
    const creeping = snap.vehicles.find(
      (v) => v.speed > 0.1 && v.speed < QUEUE_SPEED_THRESHOLD && v.distanceAlongPath < v.stopLineDist && v.waitingTime > 0
    );
    if (creeping) {
      observedCreepWait = true;
      break;
    }
  }
  assert(
    observedCreepWait,
    `[4] Expected vehicles creeping below QUEUE_SPEED_THRESHOLD (${QUEUE_SPEED_THRESHOLD} m/s) to accumulate waitingTime > 0`
  );

  // Run more so some vehicles exit, then reset and verify empty telemetry
  for (let i = 0; i < 400; i++) sim.step(0.05);
  assert(sim.getSnapshot().stats.totalExitedAllTime > 0, '[4] Expected vehicles to exit before reset');

  sim.reset();
  const afterReset = sim.getSnapshot();
  assert(afterReset.stats.totalExitedAllTime === 0, `[4] Expected reset totalExitedAllTime === 0, got ${afterReset.stats.totalExitedAllTime}`);
  assert(afterReset.stats.avgWaitTime === 0, `[4] Expected reset avgWaitTime === 0, got ${afterReset.stats.avgWaitTime}`);
  assert(afterReset.stats.maxWaitTime === 0, `[4] Expected reset maxWaitTime === 0, got ${afterReset.stats.maxWaitTime}`);
  assert(afterReset.stats.simTime === 0, `[4] Expected reset simTime === 0, got ${afterReset.stats.simTime}`);

  console.log('[PASS] 4. Empty Telemetry & waitingTime Threshold: fresh/reset zeros and creeping waitTime verified');
}

console.log('--- ALL ADAPTIVE & EXPORT TESTS PASSED ---');
