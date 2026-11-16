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
  const [sim] = useState(() => new TrafficSimulation());
  const snapshotRef = useRef<SimSnapshot>(sim.getSnapshot());
  const [uiSnapshot, setUiSnapshot] = useState<SimSnapshot>(() => snapshotRef.current);
  const [inspectorConfig, setInspectorConfig] = useState<SimConfig>(() => snapshotRef.current.config);
  const [drawTick, setDrawTick] = useState(0);
  const lastUiSyncRef = useRef<number>(0);

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  useEffect(() => {
    if (!running) {
      snapshotRef.current = sim.getSnapshot();
      setUiSnapshot(snapshotRef.current);
      setDrawTick((t) => t + 1);
      return;
    }
    let rafId = 0;
    let lastTime = performance.now();
    lastUiSyncRef.current = lastTime;

    const tick = (now: number) => {
      const realDt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const simDt = realDt * speed;
      const subSteps = Math.max(1, Math.ceil(simDt / 0.04));
      const stepDt = simDt / subSteps;
      for (let i = 0; i < subSteps; i++) {
        sim.step(stepDt);
      }

      snapshotRef.current = sim.getSnapshot();

      if (now - lastUiSyncRef.current >= UI_THROTTLE_MS) {
        lastUiSyncRef.current = now;
        setUiSnapshot(snapshotRef.current);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [running, speed, sim]);

  const handleConfigChange = useCallback(
    (partial: Partial<SimConfig>) => {
      sim.updateConfig(partial);
      snapshotRef.current = sim.getSnapshot();
      setUiSnapshot(snapshotRef.current);
      setInspectorConfig(snapshotRef.current.config);
      setDrawTick((t) => t + 1);
    },
    [sim]
  );

  const handleResetDefaults = useCallback(() => {
    sim.updateConfig(DEFAULT_CONFIG);
    snapshotRef.current = sim.getSnapshot();
    setUiSnapshot(snapshotRef.current);
    setInspectorConfig(snapshotRef.current.config);
    setDrawTick((t) => t + 1);
  }, [sim]);

  const handleReset = useCallback(() => {
    sim.reset();
    snapshotRef.current = sim.getSnapshot();
    setUiSnapshot(snapshotRef.current);
    setDrawTick((t) => t + 1);
  }, [sim]);

  const handleToggleRun = useCallback(() => setRunning((r) => !r), []);
  const handleToggleGrid = useCallback(() => setShowGrid((g) => !g), []);
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(2.2, +(z + 0.1).toFixed(1))), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1))), []);
  const handleZoomReset = useCallback(() => setZoom(1), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.code === 'Space') {
        if (target?.closest('button, [role="tab"], a')) {
          return;
        }
        e.preventDefault();
        setRunning((r) => !r);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleReset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleReset]);

  const phaseDuration =
    uiSnapshot.signal.activeColor === 'green'
      ? (uiSnapshot.signal.adaptiveTarget ?? uiSnapshot.config.greenDuration)
      : uiSnapshot.signal.activeColor === 'yellow'
      ? uiSnapshot.config.yellowDuration
      : uiSnapshot.config.allRedDuration;

  return (
    <div className="min-h-screen lg:h-screen w-full flex flex-col bg-slate-50 text-slate-900 lg:overflow-hidden">
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
        onZoomReset={handleZoomReset}
      />

      <main className="flex-1 min-h-0 p-2.5 flex flex-col gap-2.5 lg:overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5 lg:overflow-hidden">
          <div className="flex-1 min-h-[340px] min-w-0">
            <IntersectionCanvas
              snapshotRef={snapshotRef}
              config={inspectorConfig}
              running={running}
              drawTick={drawTick}
              zoom={zoom}
              showGrid={showGrid}
            />
          </div>
          <MemoParameterInspector
            config={inspectorConfig}
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
