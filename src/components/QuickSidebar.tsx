import React from 'react';
import { MapPin, Settings, SlidersHorizontal, TrafficCone, CarFront, Layers } from 'lucide-react';
import { DRIVER_MIX_PRESETS, MAP_OVERLAY_PRESETS } from '../engine/driverIntelligence';
import { MAP_CONTEXTS } from '../engine/mapContextAI';
import { SCENARIO_PRESETS, ScenarioPreset } from '../engine/presets';
import { cloneTopology } from '../engine/samplingBlueprints';
import { DriverProfileMix, MapOverlayLayers, SimConfig } from '../engine/types';

interface QuickSidebarProps {
  config: SimConfig;
  onChange: (partial: Partial<SimConfig>) => void;
  overlayLayers: MapOverlayLayers;
  onChangeOverlayLayers: (layers: MapOverlayLayers) => void;
  onOpenSettings: () => void;
}

const MIX_PRESET_KEYS = Object.keys(DRIVER_MIX_PRESETS) as Array<
  Exclude<NonNullable<DriverProfileMix['preset']>, 'custom'>
>;

function matchesOverlayPreset(a: MapOverlayLayers, b: MapOverlayLayers): boolean {
  return (
    a.identity === b.identity &&
    a.tacticalCues === b.tacticalCues &&
    a.socialVectors === b.socialVectors &&
    a.emotionBars === b.emotionBars &&
    a.frictionHeatmap === b.frictionHeatmap
  );
}

export const QuickSidebar: React.FC<QuickSidebarProps> = ({
  config,
  onChange,
  overlayLayers,
  onChangeOverlayLayers,
  onOpenSettings,
}) => {
  const activePresetId =
    SCENARIO_PRESETS.find((p) => {
      if (p.patch.customTopology) {
        return config.customTopology?.id === p.patch.customTopology.id;
      }
      if (config.customTopology) return false;
      if (p.patch.scenarioName && config.scenarioName === p.patch.scenarioName) return true;
      return (
        p.id === 'balanced' &&
        !config.scenarioName &&
        (!config.environmentId || config.environmentId === 'default')
      );
    })?.id ?? '';

  const applyPreset = (preset: ScenarioPreset) => {
    const patch = preset.patch;
    const isField = preset.category === 'field';
    const mapMix = isField ? MAP_CONTEXTS[preset.id]?.recommendedMix : undefined;
    onChange({
      ...patch,
      customTopology: patch.customTopology ? cloneTopology(patch.customTopology) : undefined,
      armGreenDurations: patch.armGreenDurations ? { ...patch.armGreenDurations } : undefined,
      armWeights: patch.armWeights ? { ...patch.armWeights } : undefined,
      armNames: patch.armNames ? { ...patch.armNames } : undefined,
      ...(mapMix ? { driverProfileMix: { ...mapMix } } : {}),
    });
  };

  const activeMixPreset = config.driverProfileMix?.preset ?? 'balanced';
  const disciplinePct = Math.round((config.driverDiscipline ?? 0.72) * 100);

  return (
    <aside className="w-full lg:w-[292px] lg:min-h-0 bg-white border border-slate-200 rounded-lg flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
          Kontrol Cepat
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:text-indigo-900 px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors duration-100"
        >
          <Settings className="w-3 h-3" />
          Lengkap
        </button>
      </div>

      <div className="p-3.5 space-y-4 overflow-y-auto flex-1">
        {/* 1. Peta / Skenario */}
        <section className="space-y-1.5">
          <label
            htmlFor="quick-preset-select"
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
            Peta Simpang
          </label>
          <select
            id="quick-preset-select"
            value={activePresetId}
            onChange={(e) => {
              const found = SCENARIO_PRESETS.find((p) => p.id === e.target.value);
              if (found) applyPreset(found);
            }}
            className="w-full px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-400 transition-colors duration-100"
          >
            {!activePresetId && (
              <option value="" disabled>
                {config.scenarioName || 'Konfigurasi Kustom'}
              </option>
            )}
            <optgroup label="Peta Lapangan Indonesia">
              {SCENARIO_PRESETS.filter((p) => p.category === 'field').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Skenario Sintetis">
              {SCENARIO_PRESETS.filter((p) => p.category === 'synthetic').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          </select>
        </section>

        {/* 2. Kontrol Lampu Esensial */}
        <section className="space-y-2 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <TrafficCone className="w-3.5 h-3.5 text-amber-600" />
              Sinyal Lampu
            </span>
            <span className="text-[10px] font-mono tabular-nums text-slate-500">
              Hijau {config.greenDuration}s
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={!config.adaptiveSignal}
              onClick={() => onChange({ adaptiveSignal: false })}
              className={`py-1.5 px-2 rounded-md text-xs font-medium border transition-colors duration-100 ${
                !config.adaptiveSignal
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Fixed-Time
            </button>
            <button
              type="button"
              aria-pressed={config.adaptiveSignal}
              onClick={() => onChange({ adaptiveSignal: true })}
              className={`py-1.5 px-2 rounded-md text-xs font-medium border transition-colors duration-100 ${
                config.adaptiveSignal
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Adaptif AI
            </button>
          </div>

          <input
            type="range"
            aria-label="Durasi Lampu Hijau"
            min={5}
            max={90}
            step={1}
            value={config.greenDuration}
            onChange={(e) => onChange({ greenDuration: parseInt(e.target.value, 10) })}
            className="w-full accent-slate-900 cursor-pointer transition-colors duration-100"
          />

          <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
            <span>Belok Kiri Langsung (LTOR)</span>
            <input
              type="checkbox"
              checked={config.leftTurnOnRed}
              onChange={(e) => onChange({ leftTurnOnRed: e.target.checked })}
              className="w-3.5 h-3.5 accent-slate-900 rounded cursor-pointer transition-colors duration-100"
            />
          </label>
        </section>

        {/* 3. Volume & Profil Pengendara Inti */}
        <section className="space-y-2.5 pt-3 border-t border-slate-100">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <CarFront className="w-3.5 h-3.5 text-sky-600" />
            Arus & Pengendara
          </span>

          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-slate-600">Motor</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {config.motorRate}/mnt
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={150}
                step={2}
                value={config.motorRate}
                onChange={(e) => onChange({ motorRate: parseInt(e.target.value, 10) })}
                className="w-full accent-amber-500 cursor-pointer transition-colors duration-100"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-slate-600">Mobil</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {config.carRate}/mnt
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={config.carRate}
                onChange={(e) => onChange({ carRate: parseInt(e.target.value, 10) })}
                className="w-full accent-slate-800 cursor-pointer transition-colors duration-100"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-slate-600">Truk / Bus</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {config.heavyRate}/mnt
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={config.heavyRate}
                onChange={(e) => onChange({ heavyRate: parseInt(e.target.value, 10) })}
                className="w-full accent-teal-600 cursor-pointer transition-colors duration-100"
              />
            </div>
          </div>

          <div className="pt-1 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-600">Kedisiplinan</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {disciplinePct}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={2}
              value={disciplinePct}
              onChange={(e) =>
                onChange({ driverDiscipline: +(parseInt(e.target.value, 10) / 100).toFixed(2) })
              }
              className="w-full accent-indigo-600 cursor-pointer transition-colors duration-100"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="quick-driver-mix" className="block text-[11px] text-slate-600">
              Profil Pengendara
            </label>
            <select
              id="quick-driver-mix"
              value={activeMixPreset}
              onChange={(e) => {
                const key = e.target.value as Exclude<
                  NonNullable<DriverProfileMix['preset']>,
                  'custom'
                >;
                const preset = DRIVER_MIX_PRESETS[key];
                if (preset) {
                  onChange({ driverProfileMix: { ...preset.mix } });
                }
              }}
              className="w-full px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-slate-400 transition-colors duration-100"
            >
              {MIX_PRESET_KEYS.map((key) => (
                <option key={key} value={key}>
                  {DRIVER_MIX_PRESETS[key].label}
                </option>
              ))}
              {activeMixPreset === 'custom' && <option value="custom">Kustom (dari Setting)</option>}
            </select>
          </div>
        </section>

        {/* 4. Mode Visual Layer Peta */}
        <section className="space-y-2 pt-3 border-t border-slate-100">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            Layer AI Peta
          </span>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { id: 'compact', label: 'Ringkas' },
                { id: 'full', label: 'Penuh' },
                { id: 'off', label: 'Mati' },
              ] as const
            ).map((item) => {
              const active = matchesOverlayPreset(overlayLayers, MAP_OVERLAY_PRESETS[item.id]);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChangeOverlayLayers({ ...MAP_OVERLAY_PRESETS[item.id] })}
                  className={`py-1 px-2 rounded text-[11px] font-medium border transition-colors duration-100 ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
};
