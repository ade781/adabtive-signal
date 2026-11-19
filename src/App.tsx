import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getArmGreenDuration } from './engine/constants';
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

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Terjadi kesalahan runtime pada aplikasi.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Adaptive Signal ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-6 text-slate-900">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-5 space-y-3 shadow-sm">
            <div className="text-sm font-semibold text-rose-700">Terjadi Kesalahan Tampilan</div>
            <p className="text-xs text-slate-600 font-mono break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors duration-100"
            >
              Muat Ulang Tampilan
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ExportStatus {
  type: 'success' | 'warning' | 'error';
  message: string;
}

function AppContent() {
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
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const exportTimerRef = useRef<number | null>(null);

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
    sim.updateConfig({
      ...DEFAULT_CONFIG,
      armGreenDurations: undefined,
      armNames: undefined,
      environmentId: undefined,
      scenarioName: undefined,
      scenarioNotes: undefined,
    });
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
  const showExportToast = useCallback((status: ExportStatus) => {
    setExportStatus(status);
    if (exportTimerRef.current !== null) {
      window.clearTimeout(exportTimerRef.current);
    }
    exportTimerRef.current = window.setTimeout(() => {
      setExportStatus(null);
      exportTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (exportTimerRef.current !== null) {
        window.clearTimeout(exportTimerRef.current);
      }
    };
  }, []);

  const handleDownloadReport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const snapshot = sim.getSnapshot();
      const { exportSimulationReportXlsx } = await import('./utils/reportExporter');
      exportSimulationReportXlsx(snapshot);
      if (snapshot.stats.totalExitedAllTime === 0) {
        showExportToast({
          type: 'warning',
          message: 'Laporan .xlsx diunduh (belum ada kendaraan keluar)',
        });
      } else {
        showExportToast({
          type: 'success',
          message: 'Laporan .xlsx berhasil diunduh',
        });
      }
    } catch (err) {
      showExportToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal mengekspor laporan .xlsx',
      });
    } finally {
      setIsExporting(false);
    }
  }, [sim, isExporting, showExportToast]);

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
      ? getArmGreenDuration(uiSnapshot.config, uiSnapshot.signal.activeArm)
      : uiSnapshot.signal.activeColor === 'yellow'
      ? uiSnapshot.config.yellowDuration
      : Math.max(0.5, uiSnapshot.config.allRedDuration);

  return (
    <div className="min-h-screen lg:h-screen w-full flex flex-col bg-slate-50 text-slate-900 overflow-x-hidden">
      <MemoTopBar
        running={running}
        onToggleRun={handleToggleRun}
        onReset={handleReset}
        onDownloadReport={handleDownloadReport}
        isExporting={isExporting}
        speed={speed}
        onSpeedChange={setSpeed}
        signal={uiSnapshot.signal}
        config={inspectorConfig}
        phaseDuration={phaseDuration}
        simTime={uiSnapshot.stats.simTime}
        zoom={zoom}
        showGrid={showGrid}
        onToggleGrid={handleToggleGrid}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
      />

      <main className="flex-1 min-h-0 p-2.5 flex flex-col gap-2.5 overflow-y-auto">
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5">
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

        <MemoTelemetryStrip
          stats={uiSnapshot.stats}
          signal={uiSnapshot.signal}
          armNames={inspectorConfig.armNames}
        />
      </main>

      {exportStatus && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-medium shadow-sm ${
            exportStatus.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : exportStatus.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <span>{exportStatus.message}</span>
          <button
            type="button"
            onClick={() => setExportStatus(null)}
            aria-label="Tutup notifikasi"
            className="text-[11px] opacity-60 hover:opacity-100 px-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;
