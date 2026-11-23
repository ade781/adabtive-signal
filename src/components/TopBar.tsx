import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Grid,
  ZoomIn,
  ZoomOut,
  Download,
  MapPin,
  PenTool,
  Activity,
  CloudRain,
  Sun,
  Clock,
  Layers,
  X,
} from 'lucide-react';
import { ARCHETYPE_TRAITS, MAP_OVERLAY_PRESETS } from '../engine/driverIntelligence';
import {
  DriverArchetype,
  EnvironmentTelemetry,
  MapOverlayLayers,
  SignalState,
  SimConfig,
} from '../engine/types';
import { AppView } from '../App';

interface TopBarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
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
  zoom: number;
  showGrid: boolean;
  onToggleGrid: () => void;
  overlayLayers: MapOverlayLayers;
  onChangeOverlayLayers: (layers: MapOverlayLayers) => void;
  focusedArchetype?: DriverArchetype | null;
  onSelectArchetype?: (arch: DriverArchetype | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

const OVERLAY_LAYER_ITEMS: ReadonlyArray<{
  key: keyof MapOverlayLayers;
  label: string;
  desc: string;
}> = [
  {
    key: 'identity',
    label: 'Identitas & Badge LOD',
    desc: 'Warna sasis & lencana tipe pengendara',
  },
  {
    key: 'tacticalCues',
    label: 'Keputusan Taktis AI',
    desc: 'Salip, Yield, Yellow Box, Peek, Wide-Swing, V2V',
  },
  {
    key: 'socialVectors',
    label: 'Vektor Interaksi Sosial',
    desc: 'Buntutan, Handshake, Cushion',
  },
  {
    key: 'emotionBars',
    label: 'Emosi & Pemulihan Stres',
    desc: 'Bar frustrasi >50% & pemulihan kehati-hatian',
  },
  {
    key: 'frictionHeatmap',
    label: 'Heatmap Gesekan Peta',
    desc: 'Titik panas rem keras, konflik & marka',
  },
];

const OVERLAY_PRESET_ITEMS: ReadonlyArray<{
  id: 'compact' | 'full' | 'off';
  label: string;
}> = [
  { id: 'compact', label: 'Ringkas' },
  { id: 'full', label: 'Penuh' },
  { id: 'off', label: 'Mati' },
];

function matchesOverlayPreset(a: MapOverlayLayers, b: MapOverlayLayers): boolean {
  return (
    a.identity === b.identity &&
    a.tacticalCues === b.tacticalCues &&
    a.socialVectors === b.socialVectors &&
    a.emotionBars === b.emotionBars &&
    a.frictionHeatmap === b.frictionHeatmap
  );
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
  activeView,
  onViewChange,
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
  zoom,
  showGrid,
  onToggleGrid,
  overlayLayers,
  onChangeOverlayLayers,
  focusedArchetype,
  onSelectArchetype,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}) => {
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const layerMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!layerMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (layerMenuRef.current && !layerMenuRef.current.contains(e.target as Node)) {
        setLayerMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLayerMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [layerMenuOpen]);

  useEffect(() => {
    if (activeView !== 'simulator' && layerMenuOpen) {
      setLayerMenuOpen(false);
    }
  }, [activeView, layerMenuOpen]);

  const activeLayerCount =
    (overlayLayers.identity ? 1 : 0) +
    (overlayLayers.tacticalCues ? 1 : 0) +
    (overlayLayers.socialVectors ? 1 : 0) +
    (overlayLayers.emotionBars ? 1 : 0) +
    (overlayLayers.frictionHeatmap ? 1 : 0);

  const displayRemaining = Math.max(0, signal.phaseRemaining);
  const pct = phaseDuration > 0 ? Math.max(0, Math.min(100, (displayRemaining / phaseDuration) * 100)) : 0;
  const activePhaseDisplay =
    signal.activeColor === 'red'
      ? 'All-Red'
      : signal.multiPhase && signal.multiPhase.activePhaseLabel && config.signalPhasePreset !== '4-phase-split'
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
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <p className="text-[11px] text-slate-500 leading-none">
                Simpang {armCount} · Lajur Kiri (ID)
              </p>
              {config.scenarioName && activeView === 'simulator' && (
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

        {/* Workspace Switcher: Simulasi | Draw */}
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
        </div>
      </div>

      {activeView === 'simulator' ? (
        <>
          {/* Playback & Speed Controls */}
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
              <div ref={layerMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setLayerMenuOpen((o) => !o)}
                  aria-label="Pengaturan Layer AI Peta"
                  aria-expanded={layerMenuOpen}
                  aria-haspopup="dialog"
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-colors duration-100 ${
                    layerMenuOpen || activeLayerCount > 0
                      ? 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                  title="Atur Layer Overlay AI Peta"
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>Layer AI</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        activeLayerCount > 0 ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}
                    />
                    {activeLayerCount}
                  </span>
                </button>

                {layerMenuOpen && (
                  <div
                    role="dialog"
                    aria-label="Pengaturan Layer AI Peta"
                    className="absolute right-0 top-full mt-1.5 z-40 w-[290px] bg-white border border-slate-200 rounded-lg shadow-md p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                        Layer AI Peta
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-slate-500">
                        {activeLayerCount}/5 aktif
                      </span>
                    </div>

                    <div
                      role="group"
                      aria-label="Preset Layer AI"
                      className="grid grid-cols-3 gap-1"
                    >
                      {OVERLAY_PRESET_ITEMS.map((preset) => {
                        const isActive = matchesOverlayPreset(
                          overlayLayers,
                          MAP_OVERLAY_PRESETS[preset.id]
                        );
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() =>
                              onChangeOverlayLayers({ ...MAP_OVERLAY_PRESETS[preset.id] })
                            }
                            className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors duration-100 ${
                              isActive
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-1.5 pt-1 border-t border-slate-100">
                      {OVERLAY_LAYER_ITEMS.map((item) => {
                        const checked = overlayLayers[item.key];
                        return (
                          <button
                            key={item.key}
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            onClick={() =>
                              onChangeOverlayLayers({
                                ...overlayLayers,
                                [item.key]: !checked,
                              })
                            }
                            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 text-left transition-colors duration-100"
                          >
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium text-slate-800 leading-tight">
                                {item.label}
                              </div>
                              <div className="text-[9px] text-slate-500 leading-tight mt-0.5">
                                {item.desc}
                              </div>
                            </div>
                            <span
                              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-100 ${
                                checked
                                  ? 'bg-indigo-700 border-indigo-700'
                                  : 'bg-slate-200 border-slate-300'
                              }`}
                            >
                              <span
                                className={`inline-block h-3 w-3 rounded-full bg-white transform transition-transform duration-100 ${
                                  checked ? 'translate-x-3.5' : 'translate-x-0.5'
                                }`}
                              />
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {focusedArchetype && onSelectArchetype && (
                      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-200 text-[10px]">
                        <span className="text-slate-600 truncate">
                          Sorotan:{' '}
                          <strong className="font-mono text-slate-900">
                            {ARCHETYPE_TRAITS[focusedArchetype].shortBadge}
                          </strong>{' '}
                          ({ARCHETYPE_TRAITS[focusedArchetype].label})
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectArchetype(null)}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 shrink-0 transition-colors duration-100"
                        >
                          <X className="w-2.5 h-2.5" />
                          Reset
                        </button>
                      </div>
                    )}

                    <p className="pt-2 border-t border-slate-100 text-[10px] text-slate-500 leading-snug">
                      Klik kendaraan di peta untuk AI Brain · Scroll zoom &amp; drag pan
                    </p>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onDownloadReport}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-60 disabled:cursor-wait transition-colors duration-100 ml-1"
              title="Download Laporan Evaluasi Excel (.xlsx)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExporting ? 'Mengekspor...' : 'Report .xlsx'}</span>
            </button>
          </div>

          {/* Active Cycle, Time/Weather Chip & Phase */}
          <div className="flex items-center gap-2 sm:gap-3">
            {environment && (environment.timeMode !== 'static' || environment.weather !== 'clear') && (
              <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-mono text-slate-700">
                {environment.weather === 'clear' ? (
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                ) : (
                  <CloudRain className="w-3.5 h-3.5 text-sky-600" />
                )}
                {environment.timeMode !== 'static' && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <strong>{environment.clockLabel}</strong>
                    <span className="text-slate-400">({Math.round(environment.demandMultiplier * 100)}%)</span>
                  </span>
                )}
                {environment.weather !== 'clear' && (
                  <span className="text-sky-700 font-semibold">
                    {environment.weather === 'heavy-rain' ? 'Hujan Lebat' : 'Gerimis'}
                  </span>
                )}
              </div>
            )}

            <div className="sm:hidden px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-[11px] font-mono tabular-nums font-semibold text-slate-700 whitespace-nowrap">
              {simTime.toFixed(1)}s · #{signal.cycleNumber}
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                Waktu Simulasi
              </div>
              <div className="text-xs font-mono tabular-nums font-semibold text-slate-800">
                {simTime.toFixed(1)}s · Siklus #{signal.cycleNumber}
              </div>
            </div>
            <div
              className={`px-2.5 py-1 rounded-md border text-xs font-mono tabular-nums font-semibold flex flex-col gap-1 min-w-[125px] max-w-[200px] ${
                COLOR_BADGE[signal.activeColor]
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${PROGRESS_BAR[signal.activeColor]}`} />
                  <span className="truncate">{activePhaseDisplay}</span>
                </span>
                <span className="shrink-0">
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
        </>
      ) : (
        <div className="text-xs text-slate-500 hidden md:block">
          Seret modul dari palet kiri ke lengan di kanvas · Putar sudut lengan bebas · Klik <strong className="text-emerald-700">Simulasikan Peta Ini</strong> untuk langsung menguji
        </div>
      )}
    </header>
  );
};
