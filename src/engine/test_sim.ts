import { createPathCache, getDestArm, getTurnRadius, sampleWithLateralOffset } from './geometry';
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
        (a.originArm === b.originArm || a.destArm === b.destArm) &&
        obbOverlap(a.x, a.y, a.heading, a.length * 0.85, aEffW * 0.85, b.x, b.y, b.heading, b.length * 0.85, bEffW * 0.85)
      ) {
        throw new Error(
          `[${label}] 2D Turning/Merge OBB Overlap between v#${a.id}(${a.vClass}, ${a.originArm}->${a.destArm}, d=${a.distanceAlongPath.toFixed(1)}) and v#${b.id}(${b.vClass}, ${b.originArm}->${b.destArm}, d=${b.distanceAlongPath.toFixed(1)})`
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

function runScenario(name: string, cfg: Partial<SimConfig>, seconds: number) {
  const sim = new TrafficSimulation(cfg);
  const dt = 0.05;
  const steps = Math.round(seconds / dt);
  for (let s = 0; s < steps; s++) {
    sim.step(dt);
    if (s % 20 === 0) checkSnapshotIntegrity(sim, name);
  }
  const snap = sim.getSnapshot();
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
for (let s = 0; s < 1200; s++) {
  mutSim.step(0.05);
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

  // Step through > 1 full adaptive cycle (4 * (~4-4.8s + 1s) <= 24s) and verify actual phase/cycle durations
  for (let s = 0; s < 560; s++) cfgSim.step(0.05);
  const statSnap = cfgSim.getSnapshot();
  assert(statSnap.stats.phaseHistory.length >= 4, `Expected >=4 phaseHistory records`);
  assert(statSnap.stats.cycleHistory.length >= 1, `Expected >=1 cycleHistory records`);
  assert(statSnap.stats.phaseHistory[0].greenDuration >= 3.9, `Expected actual phase duration ~4.0s, got ${statSnap.stats.phaseHistory[0].greenDuration}`);
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
  for (let s = 0; s < 2400; s++) {
    asymSim.step(0.05);
    if (s % 20 === 0) checkSnapshotIntegrity(asymSim, '8. Asymmetric Adaptive');
  }
  const snap = asymSim.getSnapshot();
  const northPhases = snap.stats.phaseHistory.filter((p) => p.arm === 'north').length;
  const southPhases = snap.stats.phaseHistory.filter((p) => p.arm === 'south').length;
  const zeroArmPhases = snap.stats.phaseHistory.filter((p) => p.arm === 'east' || p.arm === 'west').length;
  assert(northPhases > 0 && southPhases > 0, `[8. Asymmetric Adaptive] Expected north (${northPhases}) and south (${southPhases}) phases`);
  assert(northPhases + southPhases > zeroArmPhases, `[8. Asymmetric Adaptive] Expected active arms (${northPhases + southPhases}) > zero-weight arms (${zeroArmPhases})`);
  console.log(`[PASS] 8. Asymmetric Adaptive Arm Selection (north=${northPhases}, south=${southPhases}, zeroArms=${zeroArmPhases})`);
}

console.log('--- ALL TESTS PASSED ---');
