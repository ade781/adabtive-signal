import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, TrafficSimulation } from './engine/simulation';
import { SimConfig, SimSnapshot } from './engine/types';
import { IntersectionCanvas } from './canvas/IntersectionCanvas';
import { TopBar } from './components/TopBar';
import { ParameterInspector } from './components/ParameterInspector';
import { TelemetryStrip } from './components/TelemetryStrip';

export function App() {
  const simRef = useRef<TrafficSimulation | null>(null);
  if (!simRef.current) {
    simRef.current = new TrafficSimulation();
  }

  const [snapshot, setSnapshot] = useState<SimSnapshot>(() => simRef.current!.getSnapshot());
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  useEffect(() => {
    if (!running) return;
    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const realDt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const sim = simRef.current!;
      const simDt = realDt * speed;
      const subSteps = Math.max(1, Math.ceil(simDt / 0.04));
      const stepDt = simDt / subSteps;
      for (let i = 0; i < subSteps; i++) {
        sim.step(stepDt);
      }

      setSnapshot(sim.getSnapshot());
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [running, speed]);

  const handleConfigChange = useCallback(
    (partial: Partial<SimConfig>) => {
      if (running) return;
      const sim = simRef.current!;
      sim.updateConfig(partial);
      setSnapshot(sim.getSnapshot());
    },
    [running]
  );

  const handleResetDefaults = useCallback(() => {
    if (running) return;
    const sim = simRef.current!;
    sim.updateConfig(DEFAULT_CONFIG);
    setSnapshot(sim.getSnapshot());
  }, [running]);

  const handleReset = useCallback(() => {
    const sim = simRef.current!;
    sim.reset();
    setSnapshot(sim.getSnapshot());
  }, []);

  const phaseDuration =
    snapshot.signal.activeColor === 'green'
      ? snapshot.config.greenDuration
      : snapshot.signal.activeColor === 'yellow'
      ? snapshot.config.yellowDuration
      : snapshot.config.allRedDuration;

  return (
    <div className="min-h-screen lg:h-screen w-screen flex flex-col bg-slate-50 text-slate-900 lg:overflow-hidden">
      <TopBar
        running={running}
        onToggleRun={() => setRunning((r) => !r)}
        onReset={handleReset}
        speed={speed}
        onSpeedChange={setSpeed}
        signal={snapshot.signal}
        phaseDuration={phaseDuration}
        simTime={snapshot.stats.simTime}
        zoom={zoom}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((g) => !g)}
        onZoomIn={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))}
        onZoomOut={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
      />

      <main className="flex-1 min-h-0 p-2.5 flex flex-col gap-2.5 lg:overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5 lg:overflow-hidden">
          <div className="flex-1 min-h-[340px] min-w-0">
            <IntersectionCanvas
              snapshot={snapshot}
              zoom={zoom}
              showGrid={showGrid}
            />
          </div>
          <ParameterInspector
            config={snapshot.config}
            running={running}
            onPause={() => setRunning(false)}
            onChange={handleConfigChange}
            onResetDefaults={handleResetDefaults}
          />
        </div>

        <TelemetryStrip stats={snapshot.stats} signal={snapshot.signal} />
      </main>
    </div>
  );
}

export default App;
