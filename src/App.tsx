import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, TrafficSimulation } from './engine/simulation';
import { SimConfig, SimSnapshot } from './engine/types';
import { IntersectionCanvas } from './canvas/IntersectionCanvas';
import { TopBar } from './components/TopBar';
import { ParameterInspector } from './components/ParameterInspector';
import { TelemetryStrip } from './components/TelemetryStrip';

const UI_THROTTLE_MS = 80;

const MemoTopBar = React.memo(TopBar);
const MemoParameterInspector = React.memo(ParameterInspector);
const MemoTelemetryStrip = React.memo(TelemetryStrip);

export function App() {
  const simRef = useRef<TrafficSimulation | null>(null);
  if (!simRef.current) {
    simRef.current = new TrafficSimulation();
  }

  const [snapshot, setSnapshot] = useState<SimSnapshot>(() => simRef.current!.getSnapshot());
  const [uiSnapshot, setUiSnapshot] = useState<SimSnapshot>(() => snapshot);
  const lastUiSyncRef = useRef<number>(0);

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  useEffect(() => {
    if (!running) {
      setUiSnapshot(simRef.current!.getSnapshot());
      return;
    }
    let rafId = 0;
    let lastTime = performance.now();
    lastUiSyncRef.current = lastTime;

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

      const next = sim.getSnapshot();
      setSnapshot(next);

      if (now - lastUiSyncRef.current >= UI_THROTTLE_MS) {
        lastUiSyncRef.current = now;
        setUiSnapshot(next);
      }

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
      const next = sim.getSnapshot();
      setSnapshot(next);
      setUiSnapshot(next);
    },
    [running]
  );

  const handleResetDefaults = useCallback(() => {
    if (running) return;
    const sim = simRef.current!;
    sim.updateConfig(DEFAULT_CONFIG);
    const next = sim.getSnapshot();
    setSnapshot(next);
    setUiSnapshot(next);
  }, [running]);

  const handleReset = useCallback(() => {
    const sim = simRef.current!;
    sim.reset();
    const next = sim.getSnapshot();
    setSnapshot(next);
    setUiSnapshot(next);
  }, []);

  const handleToggleRun = useCallback(() => setRunning((r) => !r), []);
  const handlePause = useCallback(() => setRunning(false), []);
  const handleToggleGrid = useCallback(() => setShowGrid((g) => !g), []);
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2))), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2))), []);

  const phaseDuration =
    uiSnapshot.signal.activeColor === 'green'
      ? uiSnapshot.config.greenDuration
      : uiSnapshot.signal.activeColor === 'yellow'
      ? uiSnapshot.config.yellowDuration
      : uiSnapshot.config.allRedDuration;

  return (
    <div className="min-h-screen lg:h-screen w-screen flex flex-col bg-slate-50 text-slate-900 lg:overflow-hidden">
      <MemoTopBar
        running={running}
        onToggleRun={handleToggleRun}
        onReset={handleReset}
        speed={speed}
        onSpeedChange={setSpeed}
        signal={uiSnapshot.signal}
        phaseDuration={phaseDuration}
        simTime={uiSnapshot.stats.simTime}
        zoom={zoom}
        showGrid={showGrid}
        onToggleGrid={handleToggleGrid}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
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
          <MemoParameterInspector
            config={uiSnapshot.config}
            running={running}
            onPause={handlePause}
            onChange={handleConfigChange}
            onResetDefaults={handleResetDefaults}
          />
        </div>

        <MemoTelemetryStrip stats={uiSnapshot.stats} signal={uiSnapshot.signal} />
      </main>
    </div>
  );
}

export default App;
