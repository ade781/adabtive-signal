import React, { useId, useRef, useState } from 'react';
import { Sliders, CarFront, TrafficCone, RotateCcw, MapPin } from 'lucide-react';
import { getArmGreenDuration } from '../engine/constants';
import { SCENARIO_PRESETS, ScenarioPreset } from '../engine/presets';
import { ArmId, SimConfig } from '../engine/types';

interface ParameterInspectorProps {
  config: SimConfig;
  onChange: (partial: Partial<SimConfig>) => void;
  onResetDefaults: () => void;
}

type TabId = 'geometry' | 'traffic' | 'signal';

const DEFAULT_ARM_WEIGHTS: Record<ArmId, number> = {
  north: 1,
  east: 1,
  south: 1,
  west: 1,
};

const ARM_ITEMS: { id: ArmId; label: string }[] = [
  { id: 'north', label: 'Utara' },
  { id: 'east', label: 'Timur' },
  { id: 'south', label: 'Selatan' },
  { id: 'west', label: 'Barat' },
];

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'geometry', label: 'Jalan', icon: Sliders },
  { id: 'traffic', label: 'Kendaraan', icon: CarFront },
  { id: 'signal', label: 'Lampu', icon: TrafficCone },
];

function snap5(val: number): number {
  return Math.round(val / 5) * 5;
}

function isPresetActive(
  config: SimConfig,
  armWeights: Record<ArmId, number>,
  preset: ScenarioPreset
): boolean {
  const { patch } = preset;
  if (patch.scenarioName) {
    return config.scenarioName === patch.scenarioName;
  }
  if (
    config.motorRate !== patch.motorRate ||
    config.carRate !== patch.carRate ||
    config.heavyRate !== patch.heavyRate
  ) {
    return false;
  }
  const targetWeights = patch.armWeights ?? DEFAULT_ARM_WEIGHTS;
  return (['north', 'east', 'south', 'west'] as const).every(
    (arm) => Math.abs((armWeights[arm] ?? 1) - targetWeights[arm]) < 0.05
  );
}

export const ParameterInspector: React.FC<ParameterInspectorProps> = ({
  config,
  onChange,
  onResetDefaults,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('geometry');
  const tabsId = useId();
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    geometry: null,
    traffic: null,
    signal: null,
  });

  const armWeights = config.armWeights ?? DEFAULT_ARM_WEIGHTS;
  const activePreset = SCENARIO_PRESETS.find((p) => isPresetActive(config, armWeights, p));
  const landmarkItems = activePreset?.landmarks
    ? activePreset.landmarks.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const handleManualChange = (partial: Partial<SimConfig>) => {
    onChange({
      ...partial,
      scenarioName: undefined,
      scenarioNotes: undefined,
    });
  };

  const handleArmNameChange = (arm: ArmId, value: string) => {
    const current = config.armNames ?? { north: '', east: '', south: '', west: '' };
    const next: Record<ArmId, string> = {
      north: current.north ?? '',
      east: current.east ?? '',
      south: current.south ?? '',
      west: current.west ?? '',
      [arm]: value,
    };
    const hasAny = Object.values(next).some((v) => v.trim().length > 0);
    onChange({
      armNames: hasAny ? next : undefined,
    });
  };

  const handleTurnChange = (key: 'turnLeftPct' | 'turnStraightPct' | 'turnRightPct', val: number) => {
    const clamped = snap5(Math.max(0, Math.min(100, val)));
    const remaining = 100 - clamped;
    if (key === 'turnLeftPct') {
      const otherSum = config.turnStraightPct + config.turnRightPct;
      const straight =
        otherSum > 0
          ? snap5((config.turnStraightPct / otherSum) * remaining)
          : snap5(remaining * 0.7);
      const right = remaining - straight;
      handleManualChange({ turnLeftPct: clamped, turnStraightPct: straight, turnRightPct: right });
    } else if (key === 'turnStraightPct') {
      const otherSum = config.turnLeftPct + config.turnRightPct;
      const left =
        otherSum > 0
          ? snap5((config.turnLeftPct / otherSum) * remaining)
          : snap5(remaining * 0.5);
      const right = remaining - left;
      handleManualChange({ turnLeftPct: left, turnStraightPct: clamped, turnRightPct: right });
    } else {
      const otherSum = config.turnLeftPct + config.turnStraightPct;
      const left =
        otherSum > 0
          ? snap5((config.turnLeftPct / otherSum) * remaining)
          : snap5(remaining * 0.3);
      const straight = remaining - left;
      handleManualChange({ turnLeftPct: left, turnStraightPct: straight, turnRightPct: clamped });
    }
  };

  const handleLanesChange = (lanes: number) => {
    handleManualChange({
      lanesPerDirection: lanes,
      roadWidthPerDirection: +(lanes * config.laneWidth).toFixed(2),
    });
  };

  const handleLaneWidthChange = (lw: number) => {
    handleManualChange({
      laneWidth: lw,
      roadWidthPerDirection: +(config.lanesPerDirection * lw).toFixed(2),
    });
  };

  const handleArmWeightChange = (arm: ArmId, val: number) => {
    handleManualChange({
      armWeights: {
        ...armWeights,
        [arm]: +val.toFixed(1),
      },
    });
  };

  const handleArmGreenChange = (arm: ArmId, val: number) => {
    const current: Record<ArmId, number> = {
      north: getArmGreenDuration(config, 'north'),
      east: getArmGreenDuration(config, 'east'),
      south: getArmGreenDuration(config, 'south'),
      west: getArmGreenDuration(config, 'west'),
    };
    handleManualChange({
      armGreenDurations: {
        ...current,
        [arm]: Math.round(val),
      },
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % TABS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = TABS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  return (
    <aside className="w-full lg:w-[350px] bg-white border border-slate-200 rounded-lg flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Parameter Simulasi
        </span>
        <button
          type="button"
          onClick={onResetDefaults}
          className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors duration-100"
          title="Kembalikan parameter ke nilai awal"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          Default
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Kategori Parameter" className="grid grid-cols-3 border-b border-slate-200 bg-slate-50">
        {TABS.map((tab, idx) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              id={`${tabsId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={`py-2 px-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors duration-100 ${
                selected
                  ? 'border-slate-900 text-slate-900 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div
        id={`${tabsId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${activeTab}`}
        className="p-3.5 space-y-4 overflow-y-auto flex-1"
      >
        {activeTab === 'geometry' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-700">Jumlah Lajur (per arah)</span>
                <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                  {config.lanesPerDirection} lajur
                </span>
              </div>
              <div role="group" aria-label="Jumlah lajur per arah" className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={config.lanesPerDirection === l}
                    onClick={() => handleLanesChange(l)}
                    className={`py-1.5 text-xs font-mono font-medium rounded border transition-colors duration-100 ${
                      config.lanesPerDirection === l
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <SliderField
              label="Lebar per Lajur"
              value={config.laneWidth}
              unit="m"
              min={2.8}
              max={4.2}
              step={0.1}
              onChange={handleLaneWidthChange}
              hint="Mempengaruhi kecepatan (MKJI) & ruang salip motor"
            />

            <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  Lebar Jalan (Kesatuan Lajur)
                </div>
                <div className="text-xs font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  1 Arah: {(config.lanesPerDirection * config.laneWidth).toFixed(1)} m
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-400 font-mono">2 ARAH</div>
                <div className="text-xs font-mono tabular-nums font-semibold text-slate-700 mt-0.5">
                  {(config.lanesPerDirection * config.laneWidth * 2).toFixed(1)} m
                </div>
              </div>
            </div>

            <SliderField
              label="Panjang Ruas Pendekat"
              value={config.roadLength}
              unit="m"
              min={40}
              max={200}
              step={5}
              onChange={(v) => handleManualChange({ roadLength: v })}
              hint="Jarak pengamatan antrean sebelum garis henti"
            />

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <span className="text-xs font-semibold text-slate-700 block">
                Kelengkapan Geometrik (RI)
              </span>
              <ToggleField
                label="Median Tengah Fisik"
                description="Pemisah fisik antar arah pada lengan pendekat"
                checked={config.hasMedian}
                onToggle={() => handleManualChange({ hasMedian: !config.hasMedian })}
              />
              <ToggleField
                label="Kotak Khusus Motor (RHK)"
                description="Ruang henti khusus motor di depan garis henti"
                checked={config.motorBoxEnabled}
                onToggle={() => handleManualChange({ motorBoxEnabled: !config.motorBoxEnabled })}
              />
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Nama Ruas Jalan (Opsional)</span>
                {config.armNames && (
                  <button
                    type="button"
                    onClick={() => onChange({ armNames: undefined })}
                    className="text-[10px] font-mono text-slate-500 hover:text-slate-900 underline"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {ARM_ITEMS.map((arm) => (
                  <label key={arm.id} className="block">
                    <span className="text-[10px] font-medium text-slate-500 block mb-0.5">
                      {arm.label}
                    </span>
                    <input
                      type="text"
                      value={config.armNames?.[arm.id] ?? ''}
                      onChange={(e) => handleArmNameChange(arm.id, e.target.value)}
                      placeholder={`Jl. ${arm.label}`}
                      className="w-full px-2 py-1 text-[11px] rounded border border-slate-200 bg-white text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-slate-400 transition-colors duration-100"
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'traffic' && (
          <>
            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-emerald-600" />
                    Data Lapangan Nyata (RI)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    RISET
                  </span>
                </div>
                <div role="group" aria-label="Preset data lapangan nyata" className="grid grid-cols-1 gap-1.5">
                  {SCENARIO_PRESETS.filter((p) => p.category === 'field').map((preset) => {
                    const active = isPresetActive(config, armWeights, preset);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(preset.patch)}
                        title={preset.source ?? preset.description}
                        className={`px-2.5 py-1.5 rounded text-left border transition-colors duration-100 ${
                          active
                            ? 'bg-emerald-900 text-white border-emerald-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold leading-tight">{preset.label}</span>
                          {preset.source && (
                            <span className={`text-[9px] font-mono truncate max-w-[110px] ${active ? 'text-emerald-200' : 'text-slate-400'}`}>
                              {preset.source.split('—')[0].trim()}
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-[10px] leading-tight mt-0.5 truncate ${
                            active ? 'text-emerald-100' : 'text-slate-500'
                          }`}
                        >
                          {preset.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">Preset Sintetis</span>
                  <span className="text-[10px] font-mono text-slate-400">LIVE</span>
                </div>
                <div role="group" aria-label="Preset skenario sintetis" className="grid grid-cols-2 gap-1.5">
                  {SCENARIO_PRESETS.filter((p) => p.category === 'synthetic').map((preset) => {
                    const active = isPresetActive(config, armWeights, preset);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(preset.patch)}
                        title={preset.description}
                        className={`px-2 py-1.5 rounded text-left border transition-colors duration-100 ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-[11px] font-semibold leading-tight">{preset.label}</div>
                        <div
                          className={`text-[10px] leading-tight mt-0.5 truncate ${
                            active ? 'text-slate-300' : 'text-slate-400'
                          }`}
                        >
                          {preset.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {activePreset && (activePreset.city || landmarkItems.length > 0) && (
              <div className="p-2.5 rounded-md bg-emerald-50/70 border border-emerald-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-emerald-600" />
                    Konteks Lokasi Peta
                  </span>
                  {activePreset.city && (
                    <span className="text-[10px] font-mono font-semibold text-emerald-700">
                      {activePreset.city}
                    </span>
                  )}
                </div>
                {landmarkItems.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {landmarkItems.map((lm) => (
                      <span
                        key={lm}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white text-emerald-800 border border-emerald-200"
                      >
                        {lm}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="text-[11px] text-slate-500">
                Laju kedatangan total di seluruh 4 lengan simpang (kendaraan/menit).
              </div>
              <SliderField
                label="Sepeda Motor"
                value={config.motorRate}
                unit="kend/mnt"
                min={0}
                max={150}
                step={1}
                onChange={(v) => handleManualChange({ motorRate: v })}
                accent="bg-amber-500"
              />
              <SliderField
                label="Mobil Penumpang"
                value={config.carRate}
                unit="kend/mnt"
                min={0}
                max={100}
                step={1}
                onChange={(v) => handleManualChange({ carRate: v })}
                accent="bg-slate-800"
              />
              <SliderField
                label="Kendaraan Berat (Truk/Bus)"
                value={config.heavyRate}
                unit="kend/mnt"
                min={0}
                max={50}
                step={0.1}
                onChange={(v) => handleManualChange({ heavyRate: v })}
                accent="bg-teal-600"
              />
              <ToggleField
                label="Mode Swarm Motor (3–4 Kolom)"
                description="Motor menyelip & menumpuk 3–4 kolom di antara antrean mobil"
                checked={config.motorSwarmMode}
                onToggle={() => handleManualChange({ motorSwarmMode: !config.motorSwarmMode })}
              />
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Bobot Permintaan per Lengan</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">0.2x – 2.5x</span>
              </div>
              {ARM_ITEMS.map((arm) => (
                <SliderField
                  key={arm.id}
                  label={arm.label}
                  value={+(armWeights[arm.id] ?? 1).toFixed(1)}
                  unit="x"
                  min={0.2}
                  max={2.5}
                  step={0.1}
                  onChange={(v) => handleArmWeightChange(arm.id, v)}
                />
              ))}
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Rasio Arah Belok (LHT)</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">Total 100%</span>
              </div>
              <SliderField
                label="Belok Kiri"
                value={config.turnLeftPct}
                unit="%"
                min={0}
                max={100}
                step={5}
                onChange={(v) => handleTurnChange('turnLeftPct', v)}
              />
              <SliderField
                label="Lurus"
                value={config.turnStraightPct}
                unit="%"
                min={0}
                max={100}
                step={5}
                onChange={(v) => handleTurnChange('turnStraightPct', v)}
              />
              <SliderField
                label="Belok Kanan"
                value={config.turnRightPct}
                unit="%"
                min={0}
                max={100}
                step={5}
                onChange={(v) => handleTurnChange('turnRightPct', v)}
              />
            </div>
          </>
        )}

        {activeTab === 'signal' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-700">Mode Kontrol Sinyal</span>
                <span className="text-[11px] font-mono font-semibold text-slate-900">
                  {config.adaptiveSignal ? 'Adaptif' : 'Fixed-Time'}
                </span>
              </div>
              <div role="group" aria-label="Mode kontrol sinyal" className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={config.adaptiveSignal}
                  onClick={() => handleManualChange({ adaptiveSignal: true })}
                  className={`py-1.5 rounded text-xs font-medium border transition-colors duration-100 ${
                    config.adaptiveSignal
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Adaptif
                </button>
                <button
                  type="button"
                  aria-pressed={!config.adaptiveSignal}
                  onClick={() => handleManualChange({ adaptiveSignal: false })}
                  className={`py-1.5 rounded text-xs font-medium border transition-colors duration-100 ${
                    !config.adaptiveSignal
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Fixed-Time
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {config.adaptiveSignal
                  ? 'Hijau otomatis menyesuaikan antrean (maks. sesuai Durasi Hijau).'
                  : 'Durasi lampu mengikuti angka tetap di bawah ini.'}
              </p>
            </div>

            <ToggleField
              label="Belok Kiri Langsung (LTOR)"
              description="Arus belok kiri boleh jalan terus saat lampu merah"
              checked={config.leftTurnOnRed}
              onToggle={() => handleManualChange({ leftTurnOnRed: !config.leftTurnOnRed })}
            />

            <SliderField
              label="Durasi Lampu Hijau Dasar"
              value={config.greenDuration}
              unit="detik"
              min={5}
              max={150}
              step={1}
              onChange={(v) => handleManualChange({ greenDuration: v, armGreenDurations: undefined })}
              hint="Berlaku global (reset durasi per lengan)"
            />
            <div className="pt-2 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Durasi Hijau per Lengan</span>
                {config.armGreenDurations && (
                  <button
                    type="button"
                    onClick={() => handleManualChange({ armGreenDurations: undefined })}
                    className="text-[10px] font-mono text-slate-500 hover:text-slate-900 underline"
                  >
                    Samakan
                  </button>
                )}
              </div>
              {ARM_ITEMS.map((arm) => (
                <SliderField
                  key={arm.id}
                  label={`Hijau ${arm.label}`}
                  value={getArmGreenDuration(config, arm.id)}
                  unit="s"
                  min={5}
                  max={150}
                  step={1}
                  onChange={(v) => handleArmGreenChange(arm.id, v)}
                />
              ))}
            </div>
            <SliderField
              label="Durasi Lampu Kuning"
              value={config.yellowDuration}
              unit="detik"
              min={2}
              max={6}
              step={0.5}
              onChange={(v) => handleManualChange({ yellowDuration: v })}
            />
            <SliderField
              label="Jeda Semua Merah (All-Red)"
              value={config.allRedDuration}
              unit="detik"
              min={0}
              max={5}
              step={0.5}
              onChange={(v) => handleManualChange({ allRedDuration: v })}
              hint="Waktu pengosongan kotak simpang sebelum fase berikutnya"
            />

            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">
                {config.adaptiveSignal ? 'Durasi Dasar 1 Siklus (Adaptif Aktif)' : 'Total Durasi 1 Siklus Penuh'}
              </div>
              <div className="text-lg font-mono tabular-nums font-bold text-slate-900">
                {(['north', 'east', 'south', 'west'] as const)
                  .reduce((sum, arm) => sum + getArmGreenDuration(config, arm) + config.yellowDuration + config.allRedDuration, 0)
                  .toFixed(1)}s
              </div>
              <div className="text-[11px] text-slate-500">
                {config.adaptiveSignal
                  ? 'Urutan Fase: Dinamis (berdasarkan antrean)'
                  : 'Urutan Fase: Utara → Timur → Selatan → Barat'}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

interface SliderFieldProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
  hint?: string;
  accent?: string;
}

const SliderField: React.FC<SliderFieldProps> = ({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
  hint,
  accent,
}) => {
  const inputId = useId();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={inputId} className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
          {accent && <span className={`w-2 h-2 rounded-full ${accent}`} />}
          {label}
        </label>
        <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
          {value} {unit}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none accent-slate-900 cursor-pointer"
      />
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
};

interface ToggleFieldProps {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}

const ToggleField: React.FC<ToggleFieldProps> = ({ label, description, checked, onToggle }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-2.5 p-2 rounded-md border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 text-left transition-colors duration-100"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-800 leading-tight">{label}</div>
        {description && (
          <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{description}</div>
        )}
      </div>
      <span
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-100 ${
          checked ? 'bg-slate-900 border-slate-900' : 'bg-slate-200 border-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform duration-100 ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
};
