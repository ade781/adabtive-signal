import React from 'react';
import { Play, Pause, RotateCcw, Grid, ZoomIn, ZoomOut } from 'lucide-react';
import { SignalState } from '../engine/types';

interface TopBarProps {
  running: boolean;
  onToggleRun: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  signal: SignalState;
  phaseDuration: number;
  simTime: number;
  zoom: number;
  showGrid: boolean;
  onToggleGrid: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
  speed,
  onSpeedChange,
  signal,
  phaseDuration,
  simTime,
  zoom,
  showGrid,
  onToggleGrid,
  onZoomIn,
  onZoomOut,
}) => {
  const pct = phaseDuration > 0 ? Math.max(0, Math.min(100, (signal.phaseRemaining / phaseDuration) * 100)) : 0;

  return (
    <header className="h-13 py-2 px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
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
          </div>
          <p className="text-[11px] text-slate-500 leading-none">
            Simulasi Simpang 4 · Lajur Kiri (ID)
          </p>
        </div>
      </div>

      {/* Playback & Speed Controls */}
      <div className="flex items-center gap-2">
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

        <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200 ml-1">
          {[1, 2, 5].map((s) => (
            <button
              key={s}
              type="button"
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

        <div className="hidden md:flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
          <button
            type="button"
            onClick={onZoomOut}
            disabled={zoom <= 0.6}
            className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono tabular-nums text-slate-600 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={zoom >= 2.2}
            className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleGrid}
            className={`p-1.5 rounded transition-colors duration-100 ${
              showGrid ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-100'
            }`}
            title="Toggle Blueprint Grid"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>
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
              {ARM_LABELS[signal.activeArm]}
            </span>
            <span>{Math.ceil(signal.phaseRemaining)}s</span>
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
