import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Download,
  MapPin,
  PenTool,
  Activity,
  CloudRain,
  Sun,
  Clock,
  Settings,
  Box,
  Layers,
} from 'lucide-react';
import {
  EnvironmentTelemetry,
  SignalState,
  SimConfig,
} from '../engine/types';
import { AppView, RenderDimension } from '../App';

interface TopBarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  renderDimension: RenderDimension;
  onRenderDimensionChange: (dimension: RenderDimension) => void;
  running: boolean;
  onToggleRun: () => void;
  onReset: () => void;
  onDownloadReport: () => void;
  isExporting?: boolean;
  speed: number;
  onSpeedChange: (s: number) => void;
  signal: SignalState;
  config: SimConfig;
  phaseDuration: number;
  simTime: number;
  environment?: EnvironmentTelemetry;
}

const ARM_LABELS: Record<string, string> = {
  north: 'Utara',
  east: 'Timur',
  south: 'Selatan',
  west: 'Barat',
};

const COLOR_BADGE: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
};

const PROGRESS_BAR: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-rose-500',
};

const DIMENSION_OPTIONS: ReadonlyArray<{
  id: RenderDimension;
  label: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: '2d', label: '2D', title: 'Tampilan Peta 2D Top-Down', Icon: Layers },
  { id: '3d', label: '3D', title: 'Tampilan Peta 3D Interaktif', Icon: Box },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onViewChange,
  renderDimension,
  onRenderDimensionChange,
  running,
  onToggleRun,
  onReset,
  onDownloadReport,
  isExporting = false,
  speed,
  onSpeedChange,
  signal,
  config,
  phaseDuration,
  simTime,
  environment,
}) => {
  const displayRemaining = Math.max(0, signal.phaseRemaining);
  const pct =
    phaseDuration > 0
      ? Math.max(0, Math.min(100, (displayRemaining / phaseDuration) * 100))
      : 0;
  const activePhaseDisplay =
    signal.activeColor === 'red'
      ? 'All-Red'
      : signal.multiPhase &&
        signal.multiPhase.activePhaseLabel &&
        config.signalPhasePreset !== '4-phase-split'
      ? signal.multiPhase.activePhaseLabel
      : signal.multiPhase?.activePhaseLabel && config.customTopology
      ? signal.multiPhase.activePhaseLabel
      : ARM_LABELS[signal.activeArm] ?? signal.activeArm;

  const armCount = config.customTopology?.arms.length ?? 4;

  return (
    <header className="relative z-30 min-h-[52px] py-2 px-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
      {/* Brand + View Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <img
            src="/assets/ui/logo-adaptive-signal.svg"
            alt="Adaptive Signal"
            className="w-7 h-7"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-slate-900">
                Adaptive Signal
              </h1>
              {activeView === 'simulator' && (
                <span
                  className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                    running
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {running ? 'RUNNING' : 'PAUSED'}
                </span>
              )}
              {activeView === 'draw' && (
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
                  DRAW STUDIO
                </span>
              )}
              {activeView === 'settings' && (
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
                  SETTING
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <p className="text-[11px] text-slate-500 leading-none">
                Simpang {armCount} · Lajur Kiri (ID)
              </p>
              {config.scenarioName && activeView !== 'draw' && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[210px] truncate"
                  title={config.scenarioName}
                >
                  <MapPin className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{config.scenarioName}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Clean Workspace Switcher: Simulasi | Draw | Setting */}
        <div
          role="tablist"
          aria-label="Halaman Aplikasi"
          className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'simulator'}
            onClick={() => onViewChange('simulator')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors duration-100 ${
              activeView === 'simulator'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Simulasi
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'draw'}
            onClick={() => onViewChange('draw')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors duration-100 ${
              activeView === 'draw'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            Draw
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'settings'}
            onClick={() => onViewChange('settings')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors duration-100 ${
              activeView === 'settings'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Setting
          </button>
        </div>
      </div>

      {activeView === 'simulator' && (
        <>
          {/* Clean Playback & Speed Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleRun}
              title={running ? 'Jeda Simulasi (Space)' : 'Jalankan Simulasi (Space)'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors duration-100 ${
                running
                  ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                  : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {running ? 'Pause' : 'Play'}
            </button>

            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors duration-100"
              title="Reset Simulasi (R)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>

            <div
              role="group"
              aria-label="Kecepatan simulasi"
              className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200 ml-1"
            >
              {[1, 2, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  onClick={() => onSpeedChange(s)}
                  className={`px-2 py-1 text-[11px] font-mono font-medium rounded transition-colors duration-100 ${
                    speed === s
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            <div
              role="group"
              aria-label="Mode tampilan peta"
              className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200 ml-1"
            >
              {DIMENSION_OPTIONS.map(({ id, label, title, Icon }) => {
                const active = renderDimension === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onRenderDimensionChange(id)}
                    title={title}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-semibold rounded transition-colors duration-100 ${
                      active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onDownloadReport}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-wait transition-colors duration-100 ml-1"
              title="Unduh Laporan Excel (.xlsx) untuk Evaluasi Lapangan"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? 'Mengekspor...' : 'Report .xlsx'}
            </button>
          </div>

          {/* Environment, Timer & Active Phase Indicator */}
          <div className="flex flex-wrap items-center gap-3">
            {environment && (environment.timeMode !== 'static' || environment.weather !== 'clear') && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-200 bg-slate-50 text-[11px] font-mono tabular-nums"
                title={`${environment.periodLabel} · Cuaca: ${environment.weatherLabel} · Gesekan μ=${environment.friction.toFixed(2)}`}
              >
                <Clock className="w-3 h-3 text-slate-500" />
                <span className="font-semibold text-slate-800">{environment.clockLabel}</span>
                <span className="text-slate-400">·</span>
                <span className="text-indigo-700 font-semibold">
                  {Math.round(environment.demandMultiplier * 100)}%
                </span>
                {environment.weather !== 'clear' ? (
                  <span className="inline-flex items-center gap-0.5 text-sky-700 ml-0.5">
                    <CloudRain className="w-3 h-3" />
                    {environment.weather === 'heavy-rain' ? 'Lebat' : 'Gerimis'}
                  </span>
                ) : (
                  <Sun className="w-3 h-3 text-amber-500 ml-0.5" />
                )}
              </div>
            )}

            <div className="text-right">
              <div className="text-xs font-mono tabular-nums text-slate-700">
                t = <span className="font-semibold text-slate-900">{simTime.toFixed(1)}s</span>
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                Siklus #{signal.cycleNumber}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`px-2.5 py-1 rounded-md border text-xs font-medium flex items-center gap-1.5 ${
                  COLOR_BADGE[signal.activeColor]
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    signal.activeColor === 'green'
                      ? 'bg-emerald-500'
                      : signal.activeColor === 'yellow'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                />
                <span>{activePhaseDisplay}</span>
                <span className="font-mono tabular-nums font-semibold">
                  {displayRemaining.toFixed(1)}s
                </span>
              </div>

              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-colors duration-100 ${PROGRESS_BAR[signal.activeColor]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {activeView === 'draw' && (
        <div className="text-xs text-slate-500">
          Mode Editor Peta — Desain geometri simpang bebas & uji langsung ke Simulasi
        </div>
      )}

      {activeView === 'settings' && (
        <div className="text-xs text-slate-500">
          Pengaturan terpadu — Peta, AI Pengendara, Layer Visual, Lampu & Analitik
        </div>
      )}
    </header>
  );
};
