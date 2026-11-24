import React, { useMemo } from 'react';
import {
  ARCHETYPE_ORDER,
  ARCHETYPE_TRAITS,
  getDriverTraits,
} from '../engine/driverIntelligence';
import { CompiledTopology } from '../engine/topologyTypes';
import {
  DriverArchetype,
  MapOverlayLayers,
  SimConfig,
  SimSnapshot,
  Vehicle,
  VehicleIntentTag,
} from '../engine/types';

export const ARCHETYPE_COLORS: Record<DriverArchetype, string> = {
  defensive: '#10B981',
  commuter: '#0EA5E9',
  hurried: '#F43F5E',
  courier: '#F59E0B',
  transit: '#6366F1',
  logistics: '#475569',
};

const PHASE_PRESET_LABELS: Record<string, string> = {
  '4-phase-split': '4-Fase',
  '2-phase-simultaneous': '2-Fase Simultan',
  '3-phase': '3-Fase',
  '4-phase-protected-right': '4-Fase + Panah Kanan',
  custom: 'Fase Custom',
};

const INTENT_META: Record<VehicleIntentTag, { label: string; cls: string }> = {
  cruise: { label: 'Melaju Normal', cls: 'bg-slate-100 text-slate-700 ring-slate-300/60' },
  glosa: { label: 'GLOSA · Selaras Hijau', cls: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20' },
  rhk_pack: { label: 'Antre / Posisi RHK', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  peek: { label: 'Intip Blind-Spot', cls: 'bg-amber-50 text-amber-700 ring-amber-600/25' },
  yield: { label: 'Memberi Jalan (Yield)', cls: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  yellow_box: { label: 'Tahan Yellow Box', cls: 'bg-amber-50 text-amber-800 ring-amber-600/30' },
  overtake: { label: 'Menyalip Aktif', cls: 'bg-sky-50 text-sky-700 ring-sky-600/25' },
  handshake: { label: 'Negosiasi Kooperatif', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/25' },
  tailgate_yield: { label: 'Tekanan Ekor / Mengalah', cls: 'bg-rose-50 text-rose-700 ring-rose-600/25' },
  caution: { label: 'Pemulihan Hati-hati', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  dilemma_commit: { label: 'Zona Dilema Kuning', cls: 'bg-amber-50 text-amber-700 ring-amber-600/25' },
  reverse: { label: 'Mundur Pemulihan', cls: 'bg-orange-50 text-orange-700 ring-orange-600/25' },
};

const TURN_LABELS: Record<string, string> = {
  left: 'Belok Kiri',
  straight: 'Lurus',
  right: 'Belok Kanan',
  uturn: 'Putar Balik',
};

const CLASS_LABELS: Record<string, string> = {
  motor: 'Motor',
  car: 'Mobil',
  heavy: 'Kend. Berat',
};

const ARM_LABELS_SHORT: Record<string, string> = {
  north: 'Utara',
  east: 'Timur',
  south: 'Selatan',
  west: 'Barat',
};

function resolveIntentDisplay(v: Vehicle): { label: string; cls: string } {
  if (v.intentTag && INTENT_META[v.intentTag]) {
    return INTENT_META[v.intentTag];
  }
  if (v.isReversing) return INTENT_META.reverse;
  if (v.holdingYellowBox) return INTENT_META.yellow_box;
  if (v.overtakeState && v.overtakeState !== 'none') return INTENT_META.overtake;
  if (v.handshakePartnerId != null) return INTENT_META.handshake;
  if (v.isYielding) return INTENT_META.yield;
  if (v.occlusionPeekActive) return INTENT_META.peek;
  if ((v.cautionTimer ?? 0) > 0.2) return INTENT_META.caution;
  if (v.speed < 0.8) {
    return { label: 'Antre / Berhenti', cls: 'bg-slate-100 text-slate-700 ring-slate-300/60' };
  }
  return INTENT_META.cruise;
}

function formatArmLabel(
  armId: string,
  config: SimConfig,
  compiledTopology: CompiledTopology
): string {
  const customLabel = compiledTopology.armsById[armId]?.def.label;
  if (customLabel) return customLabel;
  if (config.armNames && armId in config.armNames) {
    const named = config.armNames[armId as keyof NonNullable<SimConfig['armNames']>];
    if (named) return named;
  }
  return ARM_LABELS_SHORT[armId] ?? armId;
}

export type Camera3DPreset = 'iso' | 'top' | 'street' | 'follow';

export interface MapHudOverlayProps {
  config: SimConfig;
  compiledTopology: CompiledTopology;
  liveSnap: SimSnapshot;
  resolvedLayers: MapOverlayLayers;
  focusedArchetype: DriverArchetype | null;
  onSelectArchetype?: (arch: DriverArchetype | null) => void;
  selectedVehicleId: number | null;
  onSelectVehicle?: (id: number | null) => void;
  showResetView?: boolean;
  resetViewLabel?: string;
  onResetView?: () => void;
  // Optional 3D camera controls
  is3D?: boolean;
  cameraPreset?: Camera3DPreset;
  onSelectCameraPreset?: (preset: Camera3DPreset) => void;
}

export const MapHudOverlay: React.FC<MapHudOverlayProps> = React.memo(({
  config,
  compiledTopology,
  liveSnap,
  resolvedLayers,
  focusedArchetype,
  onSelectArchetype,
  selectedVehicleId,
  onSelectVehicle,
  showResetView = false,
  resetViewLabel,
  onResetView,
  is3D = false,
  cameraPreset = 'iso',
  onSelectCameraPreset,
}) => {
  const phaseLabel = PHASE_PRESET_LABELS[config.signalPhasePreset ?? '4-phase-split'] ?? '4-Fase';
  const weatherMode = config.environment?.weather ?? 'clear';
  const customArms = config.customTopology?.arms;
  const hasLtor = customArms
    ? customArms.some((a) => a.leftTurnOnRed || a.slipLane?.enabled)
    : config.leftTurnOnRed;
  const hasRhk = customArms ? customArms.some((a) => a.motorBoxEnabled) : config.motorBoxEnabled;
  const hasMedianHud = customArms
    ? customArms.some((a) => a.medianWidth > 0.05)
    : config.hasMedian;
  const showHudPill = Boolean(
    config.scenarioName ||
      config.customTopology ||
      hasLtor ||
      hasRhk ||
      hasMedianHud ||
      config.yellowBoxEnabled ||
      (config.signalPhasePreset && config.signalPhasePreset !== '4-phase-split') ||
      weatherMode !== 'clear'
  );

  const anyOverlayActive =
    resolvedLayers.identity ||
    resolvedLayers.tacticalCues ||
    resolvedLayers.socialVectors ||
    resolvedLayers.emotionBars ||
    resolvedLayers.frictionHeatmap ||
    focusedArchetype !== null;

  const inspectedVehicle = useMemo(() => {
    if (selectedVehicleId === null) return null;
    const list = liveSnap.vehicles;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === selectedVehicleId) return list[i];
    }
    return null;
  }, [selectedVehicleId, liveSnap]);

  const inspectedTraits = useMemo(() => {
    if (!inspectedVehicle) return null;
    return getDriverTraits({
      profile: inspectedVehicle.profile ?? 'normal',
      archetype: inspectedVehicle.archetype,
      vClass: inspectedVehicle.vClass,
    });
  }, [inspectedVehicle]);

  return (
    <>
      {/* Top-Left Architectural Scenario HUD */}
      {showHudPill && (
        <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm max-w-[calc(100%-220px)]">
          {is3D && (
            <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
              3D
            </span>
          )}
          {(config.customTopology?.name || config.scenarioName) && (
            <span className="text-[11px] font-semibold text-slate-800">
              {config.customTopology?.name || config.scenarioName}
            </span>
          )}
          <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
            {phaseLabel}
          </span>
          {hasLtor && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              LTOR
            </span>
          )}
          {hasRhk && (
            <span className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-600/20">
              RHK
            </span>
          )}
          {config.yellowBoxEnabled && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/25">
              YELLOW BOX
            </span>
          )}
          {hasMedianHud && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-inset ring-slate-600/20">
              Median
            </span>
          )}
          {weatherMode !== 'clear' && (
            <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-700 ring-1 ring-inset ring-sky-600/20">
              {weatherMode === 'heavy-rain' ? 'Hujan Lebat' : 'Gerimis'}
            </span>
          )}
        </div>
      )}

      {/* 3D Camera Presets Bar (Top-Right beside compass) */}
      {is3D && onSelectCameraPreset && (
        <div className="pointer-events-auto absolute top-3 right-16 z-10 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow-sm">
          {(
            [
              { id: 'iso', label: 'Isometrik' },
              { id: 'top', label: 'Atas' },
              { id: 'street', label: 'Jalan' },
              ...(selectedVehicleId !== null ? [{ id: 'follow' as const, label: 'Ikuti' }] : []),
            ] as const
          ).map((cam) => {
            const active = cameraPreset === cam.id;
            return (
              <button
                key={cam.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectCameraPreset(cam.id)}
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors duration-100 ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {cam.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Top-Right Reset View Button */}
      {showResetView && onResetView && (
        <button
          type="button"
          onClick={onResetView}
          title="Kembalikan posisi kamera default"
          className="pointer-events-auto absolute top-16 right-3 z-10 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white/95 px-2 py-1 font-mono text-[10px] font-semibold text-slate-700 shadow-sm hover:bg-slate-100 hover:text-slate-900 transition-colors duration-100"
        >
          <span>Reset View</span>
          {resetViewLabel && <span className="text-slate-400">{resetViewLabel}</span>}
        </button>
      )}

      {/* Ide #12: Bottom-Left Click-to-Inspect AI Brain Card */}
      {selectedVehicleId !== null && (
        <div className="pointer-events-auto absolute bottom-11 left-3 z-10 w-[274px] max-w-[calc(100%-24px)] rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm text-slate-800">
          {inspectedVehicle && inspectedTraits ? (
            (() => {
              const arch = inspectedVehicle.archetype ?? inspectedTraits.archetype;
              const archColor = ARCHETYPE_COLORS[arch] ?? '#475569';
              const intent = resolveIntentDisplay(inspectedVehicle);
              const speedKmh = Math.round(inspectedVehicle.speed * 3.6);
              const maxKmh = Math.round(inspectedVehicle.maxSpeed * 3.6);
              const frustPct = Math.round(Math.min(1, Math.max(0, inspectedVehicle.frustration ?? 0)) * 100);
              const cautionSec = Math.max(0, inspectedVehicle.cautionTimer ?? 0);
              const cautionPct = Math.round(Math.min(1, cautionSec / 6.0) * 100);
              const rawSvo = inspectedVehicle.svoAngle;
              const svoDeg =
                rawSvo !== undefined
                  ? Math.round(Math.abs(rawSvo) > Math.PI ? rawSvo : (rawSvo * 180) / Math.PI)
                  : Math.round(inspectedTraits.politeness * 45);
              const originLbl = formatArmLabel(inspectedVehicle.originArm, config, compiledTopology);
              const destLbl = formatArmLabel(inspectedVehicle.destArm, config, compiledTopology);
              const turnLbl = TURN_LABELS[inspectedVehicle.turn] ?? inspectedVehicle.turn;

              return (
                <div className="space-y-2">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
                          style={{ backgroundColor: archColor }}
                        >
                          {ARCHETYPE_TRAITS[arch].shortBadge}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-900 truncate">
                          {CLASS_LABELS[inspectedVehicle.vClass] ?? inspectedVehicle.vClass}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          #{inspectedVehicle.id}
                        </span>
                        {inspectedVehicle.isConnected && (
                          <span className="rounded bg-cyan-50 px-1 py-0.5 font-mono text-[9px] font-bold text-cyan-700 ring-1 ring-inset ring-cyan-600/25">
                            V2V
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {ARCHETYPE_TRAITS[arch].label}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectVehicle?.(null)}
                      aria-label="Tutup inspektor kendaraan"
                      className="rounded px-1.5 py-0.5 text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors duration-100"
                    >
                      ×
                    </button>
                  </div>

                  {/* Active Intent Pill */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-slate-500">Niat AI</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${intent.cls}`}
                    >
                      {intent.label}
                    </span>
                  </div>

                  {/* Speed, Wait & Route */}
                  <div className="grid grid-cols-2 gap-1.5 rounded-md bg-slate-50 border border-slate-100 px-2 py-1.5">
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-slate-400">Kecepatan</div>
                      <div className="font-mono text-[11px] font-bold text-slate-800">
                        {speedKmh} <span className="text-[10px] font-normal text-slate-400">/ {maxKmh} km/j</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-slate-400">Waktu Tunggu</div>
                      <div className="font-mono text-[11px] font-bold text-slate-800">
                        {inspectedVehicle.waitingTime.toFixed(1)}s
                      </div>
                    </div>
                    <div className="col-span-2 pt-1 border-t border-slate-200/70 flex items-center justify-between gap-1.5">
                      <span className="text-[10px] text-slate-600 truncate" title={`${originLbl} → ${destLbl}`}>
                        {originLbl} → {destLbl}
                      </span>
                      <span className="shrink-0 rounded bg-white border border-slate-200 px-1 py-0.5 font-mono text-[9px] font-semibold text-slate-600">
                        {turnLbl}
                      </span>
                    </div>
                  </div>

                  {/* Frustration & Caution Meters */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-[10px] text-slate-500">Frustrasi</span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${frustPct}%`,
                            backgroundColor:
                              frustPct >= 75 ? '#F43F5E' : frustPct >= 48 ? '#F59E0B' : '#94A3B8',
                          }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-[10px] font-semibold text-slate-700">
                        {frustPct}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-[10px] text-slate-500">Hati-hati</span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${cautionPct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-[10px] font-semibold text-slate-700">
                        {cautionSec > 0.05 ? `${cautionSec.toFixed(1)}s` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Cognitive Trait Snapshot */}
                  <div className="grid grid-cols-4 gap-1 pt-1 border-t border-slate-100 text-center">
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[8.5px] uppercase text-slate-400">Risiko</div>
                      <div className="font-mono text-[10px] font-bold text-slate-700">
                        {inspectedTraits.riskTolerance.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[8.5px] uppercase text-slate-400">Sopan</div>
                      <div className="font-mono text-[10px] font-bold text-slate-700">
                        {inspectedTraits.politeness.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[8.5px] uppercase text-slate-400">Jarak</div>
                      <div className="font-mono text-[10px] font-bold text-slate-700">
                        {inspectedTraits.headwayMult.toFixed(2)}×
                      </div>
                    </div>
                    <div className="rounded bg-slate-50 py-1">
                      <div className="text-[8.5px] uppercase text-slate-400">SVO</div>
                      <div className="font-mono text-[10px] font-bold text-slate-700">
                        {svoDeg}°
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
              <span>Kendaraan #{selectedVehicleId} telah keluar simpang.</span>
              <button
                type="button"
                onClick={() => onSelectVehicle?.(null)}
                className="rounded px-1.5 py-0.5 text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors duration-100"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ide #4: Bottom-Right Interactive Driver Archetype Legend & Spotlight Filter */}
      {anyOverlayActive && (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm max-w-[390px]">
          {ARCHETYPE_ORDER.map((arch) => {
            const isActive = focusedArchetype === arch;
            const isMuted = focusedArchetype !== null && !isActive;
            return (
              <button
                key={arch}
                type="button"
                title={`Sorot: ${ARCHETYPE_TRAITS[arch].label}`}
                onClick={() => onSelectArchetype?.(isActive ? null : arch)}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors duration-100 ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : isMuted
                      ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                      : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: ARCHETYPE_COLORS[arch] }}
                />
                <span>{ARCHETYPE_TRAITS[arch].shortBadge}</span>
              </button>
            );
          })}
          {focusedArchetype !== null && (
            <button
              type="button"
              onClick={() => onSelectArchetype?.(null)}
              className="ml-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors duration-100"
            >
              Semua
            </button>
          )}
        </div>
      )}
    </>
  );
});
