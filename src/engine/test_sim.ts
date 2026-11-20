import { createPathCache, getDestArm, getTurnRadius, sampleWithLateralOffset } from './geometry';
import { SCENARIO_PRESETS } from './presets';
import { DEFAULT_CONFIG, TrafficSimulation } from './simulation';
import { ArmId, SimConfig, TurnIntent } from './types';

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

function checkSnapshotIntegrity(sim: TrafficSimulation, label: string) {
  const snap = sim.getSnapshot();
  const maxLane = snap.config.lanesPerDirection - 1;

  for (const v of snap.vehicles) {
    assert(Number.isFinite(v.x) && Number.isFinite(v.y), `[${label}] NaN position on vehicle ${v.id}`);
    assert(Number.isFinite(v.speed) && v.speed >= 0, `[${label}] Invalid speed ${v.speed} on vehicle ${v.id}`);
    assert(Number.isFinite(v.heading), `[${label}] NaN heading on vehicle ${v.id}`);
    assert(v.laneIndex >= 0 && v.laneIndex <= maxLane, `[${label}] Out-of-bounds laneIndex ${v.laneIndex} > ${maxLane}`);
  }

  const lw = snap.config.laneWidth;
  for (let i = 0; i < snap.vehicles.length; i++) {
    for (let j = i + 1; j < snap.vehicles.length; j++) {
      const a = snap.vehicles[i];
      const b = snap.vehicles[j];
      const aEffW = a.vClass === 'motor' ? 0.72 : a.width;
      const bEffW = b.vClass === 'motor' ? 0.72 : b.width;
      if (a.originArm === b.originArm && a.distanceAlongPath < a.stopLineDist && b.distanceAlongPath < b.stopLineDist) {
        const aLat = (a.laneIndex + 0.5) * lw + a.lateralOffset;
        const bLat = (b.laneIndex + 0.5) * lw + b.lateralOffset;
        const latSep = Math.abs(aLat - bLat);
        // True 2D check: if laterally separated beyond combined effective half-widths, they cannot overlap
        if (latSep >= (aEffW + bEffW) * 0.5 + 0.02) {
          continue;
        }
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const minExpected = (a.length + b.length) * 0.5;
        if (dist < minExpected * 0.85) {
          throw new Error(
            `[${label}] Overlap detected between v#${a.id}(${a.vClass}, turn=${a.turn}, d=${a.distanceAlongPath.toFixed(1)}, lat=${a.lateralOffset.toFixed(2)}) and v#${b.id}(${b.vClass}, turn=${b.turn}, d=${b.distanceAlongPath.toFixed(1)}, lat=${b.lateralOffset.toFixed(2)}) on ${a.originArm} lane ${a.laneIndex}: dist=${dist.toFixed(2)}m < ${minExpected.toFixed(2)}m`
          );
        }
      } else if (
        obbOverlap(a.x, a.y, a.heading, a.length * 0.85, aEffW * 0.85, b.x, b.y, b.heading, b.length * 0.85, bEffW * 0.85)
      ) {
        throw new Error(
          `[${label}] 2D Turning/Merge/Crossing OBB Overlap between v#${a.id}(${a.vClass}, ${a.originArm}->${a.destArm}, d=${a.distanceAlongPath.toFixed(1)}) and v#${b.id}(${b.vClass}, ${b.originArm}->${b.destArm}, d=${b.distanceAlongPath.toFixed(1)})`
        );
      }
    }
  }
}

function testAll12LhtPaths() {
  const cfg: SimConfig = { ...DEFAULT_CONFIG, lanesPerDirection: 2, laneWidth: 3.5, roadWidthPerDirection: 7.0 };
  const cache = createPathCache(cfg);
  const arms: ArmId[] = ['north', 'east', 'south', 'west'];
  const turns: TurnIntent[] = ['left', 'straight', 'right'];

  for (const arm of arms) {
    const rLeft = getTurnRadius('left', 1, cfg);
    const rRight = getTurnRadius('right', 0, cfg);
    assert(rLeft < rRight, `Expected left radius (${rLeft}) < right radius (${rRight}) on ${arm}`);

    for (const turn of turns) {
      const path = cache[arm][turn][0];
      const s0 = sampleWithLateralOffset(path, path.stopLineDist, 0);
      const sIn = sampleWithLateralOffset(path, path.stopLineDist - 1, 0);
      const sExit = sampleWithLateralOffset(path, path.exitLineDist, 0);
      const sOut = sampleWithLateralOffset(path, path.exitLineDist + 1, 0);

      let dIn = Math.abs(s0.heading - sIn.heading);
      if (dIn > Math.PI) dIn = Math.PI * 2 - dIn;
      let dOut = Math.abs(sExit.heading - sOut.heading);
      if (dOut > Math.PI) dOut = Math.PI * 2 - dOut;

      assert(dIn < 0.08, `Entry heading discontinuity on ${arm}/${turn}: ${dIn}`);
      assert(dOut < 0.08, `Exit heading discontinuity on ${arm}/${turn}: ${dOut}`);

      const dest = getDestArm(arm, turn);
      if (dest === 'north') assert(sExit.x < 0 && sExit.y < 0, `LHT exit wrong for ${arm}/${turn}`);
      if (dest === 'south') assert(sExit.x > 0 && sExit.y > 0, `LHT exit wrong for ${arm}/${turn}`);
      if (dest === 'east') assert(sExit.x > 0 && sExit.y < 0, `LHT exit wrong for ${arm}/${turn}`);
      if (dest === 'west') assert(sExit.x < 0 && sExit.y > 0, `LHT exit wrong for ${arm}/${turn}`);
    }
  }
  console.log('[PASS] 12x LHT (Arm x Turn) Continuity & Radius Check');
}

function trackBoxStuck(sim: TrafficSimulation, dt: number, stuckTimers: Map<number, number>, label: string) {
  const snap = sim.getSnapshot();
  const activeIds = new Set<number>();
  for (const v of snap.vehicles) {
    activeIds.add(v.id);
    const insideBox = !v.isSlipLane && !v.isUTurn && v.distanceAlongPath + v.length * 0.5 > v.stopLineDist + 0.3 && !v.hasExitedIntersection;
    if (insideBox && v.speed < 0.1) {
      const t = (stuckTimers.get(v.id) ?? 0) + dt;
      stuckTimers.set(v.id, t);
      assert(t <= 5.0, `[${label}] Vehicle #${v.id} (${v.vClass}, ${v.originArm}->${v.destArm}) stuck inside box for ${t.toFixed(1)}s`);
    } else {
      stuckTimers.delete(v.id);
    }
  }
  for (const id of stuckTimers.keys()) {
    if (!activeIds.has(id)) stuckTimers.delete(id);
  }
}

function runScenario(name: string, cfg: Partial<SimConfig>, seconds: number) {
  const sim = new TrafficSimulation(cfg);
  const dt = 0.05;
  const steps = Math.round(seconds / dt);
  const stuckTimers = new Map<number, number>();
  for (let s = 0; s < steps; s++) {
    sim.step(dt);
    trackBoxStuck(sim, dt, stuckTimers, name);
    if (s % 20 === 0) checkSnapshotIntegrity(sim, name);
  }
  const snap = sim.getSnapshot();
  if (snap.config.adaptiveSignal) {
    for (const ph of snap.stats.phaseHistory) {
      assert(
        ph.greenDuration <= snap.config.greenDuration + 0.3,
        `[${name}] Adaptive greenDuration ${ph.greenDuration}s exceeded config.greenDuration (${snap.config.greenDuration}s) + 0.3s`
      );
    }
  }
  console.log(
    `[PASS] ${name}: simTime=${snap.stats.simTime.toFixed(1)}s | exited=${snap.stats.totalExitedAllTime} | phases=${snap.stats.phaseHistory.length} | cycles=${snap.stats.cycleHistory.length} | activeVehicles=${snap.vehicles.length}`
  );
  assert(snap.stats.totalExitedAllTime > 0, `[${name}] Expected >0 exited vehicles`);
  return sim;
}

console.log('--- Running Adaptive Signal LHT Engine Stress Tests ---');
testAll12LhtPaths();

runScenario('1. Narrow 1-Lane (2.8m, 40m)', { laneWidth: 2.8, lanesPerDirection: 1, roadLength: 40, greenDuration: 10, yellowDuration: 2, allRedDuration: 0 }, 120);
runScenario('2. Wide 4-Lane (4.0m, 120m)', { laneWidth: 4.0, lanesPerDirection: 4, roadLength: 120, motorRate: 40, carRate: 28 }, 120);
runScenario('3. Heavy-Dominant Mix', { motorRate: 5, carRate: 5, heavyRate: 15, laneWidth: 3.5, lanesPerDirection: 2 }, 120);

const mutSim = runScenario('4a. Dynamic Pre-Mutation (4 lanes, 120m)', { laneWidth: 3.5, lanesPerDirection: 4, roadLength: 120 }, 60);
mutSim.updateConfig({ lanesPerDirection: 1, laneWidth: 3.0, roadLength: 45, allRedDuration: 0 });
const mutStuck = new Map<number, number>();
for (let s = 0; s < 1200; s++) {
  mutSim.step(0.05);
  trackBoxStuck(mutSim, 0.05, mutStuck, '4b. Dynamic Post-Mutation');
  if (s % 20 === 0) checkSnapshotIntegrity(mutSim, '4b. Dynamic Post-Mutation');
}
const finalSnap = mutSim.getSnapshot();
console.log(
  `[PASS] 4b. Dynamic Post-Mutation (1 lane, 45m): exited=${finalSnap.stats.totalExitedAllTime} | cycles=${finalSnap.stats.cycleHistory.length}`
);

// 5. Lane Width Mobility Impact Test (2.8m vs 4.0m under identical saturated demand)
const narrowSim = new TrafficSimulation({ laneWidth: 2.8, lanesPerDirection: 1, motorRate: 90, carRate: 45, heavyRate: 10, greenDuration: 15 });
const wideSim = new TrafficSimulation({ laneWidth: 4.0, lanesPerDirection: 1, motorRate: 90, carRate: 45, heavyRate: 10, greenDuration: 15 });
for (let s = 0; s < 2400; s++) {
  narrowSim.step(0.05);
  wideSim.step(0.05);
}
const narrowOut = narrowSim.getSnapshot().stats.totalExitedAllTime;
const wideOut = wideSim.getSnapshot().stats.totalExitedAllTime;
console.log(`[PASS] 5. Lane Width Mobility Impact (2.8m=${narrowOut} vs 4.0m=${wideOut} exited in 120s)`);
assert(wideOut > narrowOut, `Expected wide 4.0m lane (${wideOut}) > narrow 2.8m lane (${narrowOut})`);

// 6. Config Clamping, Rescaling StopLine Guard & Actual Phase/Cycle Duration Recording
{
  const cfgSim = new TrafficSimulation({ greenDuration: 1, yellowDuration: 0, allRedDuration: -2, lanesPerDirection: 2, laneWidth: 3.5, roadLength: 100 });
  const initSnap = cfgSim.getSnapshot();
  assert(initSnap.config.greenDuration === 3, `Expected greenDuration clamped to 3, got ${initSnap.config.greenDuration}`);
  assert(initSnap.config.yellowDuration === 1, `Expected yellowDuration clamped to 1, got ${initSnap.config.yellowDuration}`);
  assert(initSnap.config.allRedDuration === 0, `Expected allRedDuration clamped to 0, got ${initSnap.config.allRedDuration}`);

  cfgSim.updateConfig({ greenDuration: 2, yellowDuration: 0.2, allRedDuration: -1 });
  const updSnap = cfgSim.getSnapshot();
  assert(updSnap.config.greenDuration === 3, `Expected updated greenDuration clamped to 3`);
  assert(updSnap.config.yellowDuration === 1, `Expected updated yellowDuration clamped to 1`);
  assert(updSnap.config.allRedDuration === 0, `Expected updated allRedDuration clamped to 0`);

  // Step through > 1 full adaptive cycle (4 * (3.0s + 1.0s) = 16s) and verify actual phase/cycle durations
  for (let s = 0; s < 560; s++) cfgSim.step(0.05);
  const statSnap = cfgSim.getSnapshot();
  assert(statSnap.stats.phaseHistory.length >= 4, `Expected >=4 phaseHistory records`);
  assert(statSnap.stats.cycleHistory.length >= 1, `Expected >=1 cycleHistory records`);
  assert(
    statSnap.stats.phaseHistory[0].greenDuration >= 2.9 && statSnap.stats.phaseHistory[0].greenDuration <= 3.3,
    `Expected actual phase duration ~3.0s, got ${statSnap.stats.phaseHistory[0].greenDuration}`
  );
  assert(statSnap.stats.cycleHistory[0].totalDuration >= 15.8, `Expected actual cycle duration ~16.0s, got ${statSnap.stats.cycleHistory[0].totalDuration}`);

  // Verify turning motor spawn offsets never cross to wrong side
  for (const v of statSnap.vehicles) {
    if (v.vClass === 'motor' && v.distanceAlongPath < 5) {
      if (v.turn === 'left') assert(v.lateralOffset >= -1e-6, `Left-turning motor spawned with negative offset ${v.lateralOffset}`);
      if (v.turn === 'right') assert(v.lateralOffset <= 1e-6, `Right-turning motor spawned with positive offset ${v.lateralOffset}`);
    }
  }
  console.log('[PASS] 6. Config Clamping, Actual Phase/Cycle Duration & Motor Turn Offset');
}

// 7. Non-Adaptive (Fixed-Time) Mode holds greenDuration
{
  const fixedSim = new TrafficSimulation({
    adaptiveSignal: false,
    greenDuration: 10,
    yellowDuration: 2,
    allRedDuration: 1,
    motorRate: 20,
    carRate: 15,
    heavyRate: 3,
  });
  // Step 5.0s: should still be green on north
  for (let s = 0; s < 100; s++) fixedSim.step(0.05);
  const midSnap = fixedSim.getSnapshot();
  assert(midSnap.signal.activeArm === 'north' && midSnap.signal.activeColor === 'green', `[7. Fixed-Time] Expected north green at t=5s, got ${midSnap.signal.activeArm}/${midSnap.signal.activeColor}`);

  // Step through 60s (multiple full phases)
  for (let s = 0; s < 1100; s++) {
    fixedSim.step(0.05);
    if (s % 20 === 0) checkSnapshotIntegrity(fixedSim, '7. Fixed-Time');
  }
  const endSnap = fixedSim.getSnapshot();
  assert(endSnap.stats.phaseHistory.length >= 4, `[7. Fixed-Time] Expected >=4 phases, got ${endSnap.stats.phaseHistory.length}`);
  for (const ph of endSnap.stats.phaseHistory) {
    assert(ph.greenDuration >= 9.9 && ph.greenDuration <= 10.2, `[7. Fixed-Time] Expected greenDuration ~10.0s, got ${ph.greenDuration}`);
  }
  console.log('[PASS] 7. Fixed-Time Mode holds configured greenDuration');
}

// 8. Adaptive Mode with Asymmetric armWeights exercises pickNextArmAdaptive
{
  const asymSim = new TrafficSimulation({
    adaptiveSignal: true,
    greenDuration: 10,
    yellowDuration: 2,
    allRedDuration: 1,
    motorRate: 45,
    carRate: 30,
    heavyRate: 5,
    armWeights: { north: 5, east: 0, south: 2, west: 0 },
  });
  const asymStuck = new Map<number, number>();
  for (let s = 0; s < 2400; s++) {
    asymSim.step(0.05);
    trackBoxStuck(asymSim, 0.05, asymStuck, '8. Asymmetric Adaptive');
    if (s % 20 === 0) checkSnapshotIntegrity(asymSim, '8. Asymmetric Adaptive');
  }
  const snap = asymSim.getSnapshot();
  for (const ph of snap.stats.phaseHistory) {
    assert(
      ph.greenDuration <= snap.config.greenDuration + 0.3,
      `[8. Asymmetric Adaptive] Adaptive greenDuration ${ph.greenDuration}s exceeded config.greenDuration (${snap.config.greenDuration}s) + 0.3s`
    );
  }
  const northPhases = snap.stats.phaseHistory.filter((p) => p.arm === 'north').length;
  const southPhases = snap.stats.phaseHistory.filter((p) => p.arm === 'south').length;
  const zeroArmPhases = snap.stats.phaseHistory.filter((p) => p.arm === 'east' || p.arm === 'west').length;
  assert(northPhases > 0 && southPhases > 0, `[8. Asymmetric Adaptive] Expected north (${northPhases}) and south (${southPhases}) phases`);
  assert(northPhases + southPhases > zeroArmPhases, `[8. Asymmetric Adaptive] Expected active arms (${northPhases + southPhases}) > zero-weight arms (${zeroArmPhases})`);
  console.log(`[PASS] 8. Asymmetric Adaptive Arm Selection (north=${northPhases}, south=${southPhases}, zeroArms=${zeroArmPhases})`);
}

// 9. Per-Arm Green Durations & Real-World Field Preset (Brimob Yogyakarta)
{
  const brimob = SCENARIO_PRESETS.find((p) => p.id === 'brimob-yogya');
  assert(!!brimob, 'Expected brimob-yogya preset to exist');
  const fieldSim = new TrafficSimulation({
    ...brimob!.patch,
    adaptiveSignal: false,
  });
  const fieldStuck = new Map<number, number>();
  for (let s = 0; s < 2400; s++) {
    fieldSim.step(0.05);
    trackBoxStuck(fieldSim, 0.05, fieldStuck, '9. Brimob Yogya Fixed-Time');
    if (s % 40 === 0) checkSnapshotIntegrity(fieldSim, '9. Brimob Yogya Fixed-Time');
  }
  const snap = fieldSim.getSnapshot();
  assert(snap.stats.phaseHistory.length >= 4, `[9. Brimob Yogya] Expected >=4 phases, got ${snap.stats.phaseHistory.length}`);
  assert(snap.stats.throughputPerHour > 0, `[9. Brimob Yogya] Expected positive throughputPerHour`);
  assert(snap.stats.avgWaitTime >= 0, `[9. Brimob Yogya] Expected valid avgWaitTime`);
  for (const ph of snap.stats.phaseHistory) {
    const expected = brimob!.patch.armGreenDurations![ph.arm];
    assert(
      Math.abs(ph.greenDuration - expected) <= 0.3,
      `[9. Brimob Yogya] Expected ${ph.arm} greenDuration ~${expected}s, got ${ph.greenDuration}s`
    );
    assert(Number.isFinite(ph.queueAtStart) && Number.isFinite(ph.queueAtEnd), `[9. Brimob Yogya] Expected queueAtStart/queueAtEnd`);
  }
  console.log(
    `[PASS] 9. Field Preset (Brimob Yogya): exited=${snap.stats.totalExitedAllTime} | throughput=${snap.stats.throughputPerHour}/h | avgWait=${snap.stats.avgWaitTime}s`
  );
}

// 10. LTOR (Belok Kiri Langsung) & Motor Swarm Mode
{
  const ltorBase: Partial<SimConfig> = {
    adaptiveSignal: false,
    greenDuration: 20,
    yellowDuration: 2,
    allRedDuration: 1,
    motorRate: 30,
    carRate: 20,
    heavyRate: 0,
    turnLeftPct: 100,
    turnStraightPct: 0,
    turnRightPct: 0,
    armWeights: { north: 0, east: 1, south: 0, west: 0 },
  };
  const ltorOn = new TrafficSimulation({ ...ltorBase, leftTurnOnRed: true });
  const ltorOff = new TrafficSimulation({ ...ltorBase, leftTurnOnRed: false });
  for (let s = 0; s < 400; s++) {
    ltorOn.step(0.05);
    ltorOff.step(0.05);
    if (s % 10 === 0) checkSnapshotIntegrity(ltorOn, '10a. LTOR On');
  }
  const ltorOnSnap = ltorOn.getSnapshot();
  const ltorOffSnap = ltorOff.getSnapshot();
  assert(
    ltorOnSnap.stats.totalExitedAllTime > 0,
    `[10a. LTOR] Expected left-turning vehicles to clear during red when leftTurnOnRed=true, got ${ltorOnSnap.stats.totalExitedAllTime}`
  );
  assert(
    ltorOffSnap.stats.totalExitedAllTime === 0,
    `[10a. LTOR] Expected 0 exited during red when leftTurnOnRed=false, got ${ltorOffSnap.stats.totalExitedAllTime}`
  );

  const brimob = SCENARIO_PRESETS.find((p) => p.id === 'brimob-yogya')!;
  const swarmOn = new TrafficSimulation({ ...brimob.patch, motorRate: 140, adaptiveSignal: false, motorSwarmMode: true });
  const swarmOff = new TrafficSimulation({ ...brimob.patch, motorRate: 140, adaptiveSignal: false, motorSwarmMode: false });
  const swarmStuck = new Map<number, number>();
  for (let s = 0; s < 2400; s++) {
    swarmOn.step(0.05);
    swarmOff.step(0.05);
    trackBoxStuck(swarmOn, 0.05, swarmStuck, '10b. Motor Swarm On');
    if (s % 40 === 0) checkSnapshotIntegrity(swarmOn, '10b. Motor Swarm On');
  }
  const swarmOnSnap = swarmOn.getSnapshot();
  const swarmOffSnap = swarmOff.getSnapshot();
  assert(
    swarmOnSnap.stats.throughputPerHour > swarmOffSnap.stats.throughputPerHour,
    `[10b. Motor Swarm] Expected motorSwarmMode=true (${swarmOnSnap.stats.throughputPerHour}/h) > motorSwarmMode=false (${swarmOffSnap.stats.throughputPerHour}/h)`
  );
  console.log(
    `[PASS] 10. LTOR & Motor Swarm: LTOR_on=${ltorOnSnap.stats.totalExitedAllTime} vs LTOR_off=${ltorOffSnap.stats.totalExitedAllTime} | Swarm_on=${swarmOnSnap.stats.throughputPerHour}/h vs Swarm_off=${swarmOffSnap.stats.throughputPerHour}/h`
  );
}

// 11. All 6 Real-World RI Field Presets (Fixed & Adaptive)
{
  const fieldPresets = SCENARIO_PRESETS.filter((p) => p.category === 'field');
  assert(fieldPresets.length === 6, `[11. RI Field Presets] Expected 6 field presets, got ${fieldPresets.length}`);
  for (const preset of fieldPresets) {
    for (const adaptive of [false, true]) {
      const label = `11. ${preset.id} (${adaptive ? 'adaptive' : 'fixed'})`;
      const sim = new TrafficSimulation({ ...preset.patch, adaptiveSignal: adaptive });
      const stuck = new Map<number, number>();
      for (let s = 0; s < 1200; s++) {
        sim.step(0.05);
        trackBoxStuck(sim, 0.05, stuck, label);
        if (s % 40 === 0) checkSnapshotIntegrity(sim, label);
      }
      const snap = sim.getSnapshot();
      assert(snap.stats.totalExitedAllTime > 0, `[${label}] Expected exited > 0, got ${snap.stats.totalExitedAllTime}`);
      assert(Number.isFinite(snap.stats.avgWaitTime), `[${label}] avgWaitTime not finite`);
    }
  }
  console.log(`[PASS] 11. All 6 Real-World RI Field Presets verified (Fixed & Adaptive, 0 collisions)`);
}

// 12. RHK (motorBoxEnabled) Stop-Line Pocket Check
{
  const sim = new TrafficSimulation({
    adaptiveSignal: false,
    greenDuration: 25,
    yellowDuration: 2,
    allRedDuration: 1,
    lanesPerDirection: 2,
    motorRate: 30,
    carRate: 40,
    heavyRate: 0,
    turnLeftPct: 0,
    turnStraightPct: 100,
    turnRightPct: 0,
    motorBoxEnabled: true,
    armWeights: { north: 0, east: 1, south: 0, west: 0 },
  });
  for (let s = 0; s < 350; s++) {
    sim.step(0.05);
  }
  const snap = sim.getSnapshot();
  const eastCarsStopped = snap.vehicles.filter(
    (v) => v.originArm === 'east' && v.vClass === 'car' && v.speed < 0.5 && v.distanceAlongPath < v.stopLineDist
  );
  for (const car of eastCarsStopped) {
    const frontBumper = car.distanceAlongPath + car.length * 0.5;
    assert(
      frontBumper <= car.stopLineDist - 2.8,
      `[12. RHK] Expected stopped car front bumper (${frontBumper.toFixed(2)}) <= stopLineDist - 2.8 (${(car.stopLineDist - 2.8).toFixed(2)})`
    );
  }
  console.log(`[PASS] 12. RHK (motorBoxEnabled): ${eastCarsStopped.length} stopped cars held behind RHK pocket`);
}

// 13. Reset Determinism, Zero Spawn, Extreme dt & Upward Config Expansion
{
  const simA = new TrafficSimulation({ lanesPerDirection: 2, roadLength: 75 });
  for (let s = 0; s < 300; s++) simA.step(0.05);
  const run1 = simA.getSnapshot();
  simA.reset();
  for (let s = 0; s < 300; s++) simA.step(0.05);
  const run2 = simA.getSnapshot();
  assert(
    run1.stats.totalExitedAllTime === run2.stats.totalExitedAllTime &&
      run1.vehicles.length === run2.vehicles.length,
    `[13a. Reset Determinism] Mismatch: run1=${run1.stats.totalExitedAllTime}/${run1.vehicles.length} vs run2=${run2.stats.totalExitedAllTime}/${run2.vehicles.length}`
  );

  const zeroSim = new TrafficSimulation({ motorRate: 0, carRate: 0, heavyRate: 0 });
  zeroSim.step(0);
  zeroSim.step(-1);
  zeroSim.step(Number.NaN);
  for (let s = 0; s < 100; s++) zeroSim.step(0.05);
  const zSnap = zeroSim.getSnapshot();
  assert(zSnap.vehicles.length === 0 && zSnap.stats.totalExitedAllTime === 0, `[13b. Zero Spawn/Extreme dt] Expected 0 vehicles`);

  const expandSim = new TrafficSimulation({ lanesPerDirection: 1, roadLength: 60, motorRate: 40, carRate: 25 });
  for (let s = 0; s < 300; s++) expandSim.step(0.05);
  expandSim.updateConfig({ lanesPerDirection: 3, roadLength: 120 });
  const expandStuck = new Map<number, number>();
  for (let s = 0; s < 300; s++) {
    expandSim.step(0.05);
    trackBoxStuck(expandSim, 0.05, expandStuck, '13c. Expand Config');
    if (s % 25 === 0) checkSnapshotIntegrity(expandSim, '13c. Expand Config');
  }
  console.log(`[PASS] 13. Reset Determinism, Zero Spawn, Extreme dt & Upward Config Expansion`);
}

console.log('--- ALL TESTS PASSED ---');
