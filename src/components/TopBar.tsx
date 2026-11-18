import React from 'react';
import { Play, Pause, RotateCcw, Grid, ZoomIn, ZoomOut, Download, MapPin } from 'lucide-react';
import { SignalState, SimConfig } from '../engine/types';

interface TopBarProps {
  running: boolean;
  onToggleRun: () => void;
  onReset: () => void;
  onDownloadReport: () => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  signal: SignalState;
  config: SimConfig;
  phaseDuration: number;
  simTime: number;
  zoom: number;
  showGrid: boolean;
  onToggleGrid: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
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

export const TopBar: React.FC<TopBarProps> = ({
  running,
  onToggleRun,
  onReset,
  onDownloadReport,
  speed,
  onSpeedChange,
  signal,
  config,
  phaseDuration,
  simTime,
  zoom,
  showGrid,
  onToggleGrid,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}) => {
  const displayRemaining = Math.max(0, signal.phaseRemaining);
  const pct = phaseDuration > 0 ? Math.max(0, Math.min(100, (displayRemaining / phaseDuration) * 100)) : 0;

  return (
    <header className="min-h-[52px] py-2 px-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
      {/* Brand */}
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
            <span
              className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                running
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {running ? 'RUNNING' : 'PAUSED'}
            </span>
            {config.leftTurnOnRed && (
              <span
                className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200"
                title="Belok Kiri Langsung (LTOR) aktif"
              >
                LTOR
              </span>
            )}
            {config.motorSwarmMode && (
              <span
                className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200"
                title="Mode Swarm Motor 3-4 Kolom aktif"
              >
                SWARM
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <p className="text-[11px] text-slate-500 leading-none">
              Simulasi Simpang 4 · Lajur Kiri (ID)
            </p>
            {config.scenarioName && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[220px] truncate"
                title={config.scenarioName}
              >
                <MapPin className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{config.scenarioName}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Playback & Speed Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleRun}
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
          title="Reset Simulasi"
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

        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
          <button
            type="button"
            onClick={onZoomOut}
            disabled={zoom <= 0.6}
            aria-label="Zoom Out"
            className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomReset}
            aria-label="Reset Zoom ke 100%"
            title="Klik untuk reset ke 100%"
            className="text-[11px] font-mono tabular-nums text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded px-1 py-0.5 w-11 text-center transition-colors duration-100"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={zoom >= 2.2}
            aria-label="Zoom In"
            className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleGrid}
            aria-label="Toggle Blueprint Grid"
            aria-pressed={showGrid}
            className={`p-1.5 rounded transition-colors duration-100 ${
              showGrid ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-100'
            }`}
            title="Toggle Blueprint Grid"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onDownloadReport}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors duration-100 ml-1"
          title="Download Laporan Evaluasi Excel (.xlsx)"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Report .xlsx</span>
        </button>
      </div>

      {/* Active Cycle & Phase */}
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
            Waktu Simulasi
          </div>
          <div className="text-xs font-mono tabular-nums font-semibold text-slate-800">
            {simTime.toFixed(1)}s · Siklus #{signal.cycleNumber}
          </div>
        </div>
        <div
          className={`px-2.5 py-1 rounded-md border text-xs font-mono tabular-nums font-semibold flex flex-col gap-1 min-w-[110px] ${
            COLOR_BADGE[signal.activeColor]
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PROGRESS_BAR[signal.activeColor]}`} />
              {signal.activeColor === 'red' ? 'All-Red' : ARM_LABELS[signal.activeArm]}
            </span>
            <span>
              {Math.ceil(displayRemaining)}s
            </span>
          </div>
          <div className="w-full h-1 rounded-full bg-white/70 overflow-hidden">
            <div
              className={`h-full ${PROGRESS_BAR[signal.activeColor]}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </header>
  );
};
