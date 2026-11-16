import React, { useId, useRef, useState } from 'react';
import { Sliders, CarFront, TrafficCone, RotateCcw } from 'lucide-react';
import { ArmId, SimConfig } from '../engine/types';

interface ParameterInspectorProps {
  config: SimConfig;
  onChange: (partial: Partial<SimConfig>) => void;
  onResetDefaults: () => void;
}

type TabId = 'geometry' | 'traffic' | 'signal';

interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  patch: {
    motorRate: number;
    carRate: number;
    heavyRate: number;
    armWeights: Record<ArmId, number>;
  };
}

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

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'balanced',
    label: 'Seimbang',
    description: 'Arus merata di semua lengan',
    patch: {
      motorRate: 30,
      carRate: 22,
      heavyRate: 5,
      armWeights: { north: 1, east: 1, south: 1, west: 1 },
    },
  },
  {
    id: 'peak-ns',
    label: 'Jam Sibuk U-S',
    description: 'Koridor Utara-Selatan padat',
    patch: {
      motorRate: 56,
      carRate: 40,
      heavyRate: 8,
      armWeights: { north: 1.8, east: 0.5, south: 1.8, west: 0.5 },
    },
  },
  {
    id: 'asymmetric',
    label: 'Arus Timpang',
    description: 'Beban dominan Utara & Timur',
    patch: {
      motorRate: 44,
      carRate: 32,
      heavyRate: 7,
      armWeights: { north: 2.2, east: 1.3, south: 0.4, west: 0.5 },
    },
  },
  {
    id: 'heavy-corridor',
    label: 'Koridor Berat',
    description: 'Proporsi truk & bus tinggi',
    patch: {
      motorRate: 24,
      carRate: 26,
      heavyRate: 22,
      armWeights: { north: 1.3, east: 1.0, south: 1.3, west: 1.0 },
    },
  },
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
  if (
    config.motorRate !== patch.motorRate ||
    config.carRate !== patch.carRate ||
    config.heavyRate !== patch.heavyRate
  ) {
    return false;
  }
  return (['north', 'east', 'south', 'west'] as const).every(
    (arm) => Math.abs((armWeights[arm] ?? 1) - patch.armWeights[arm]) < 0.05
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
      onChange({ turnLeftPct: clamped, turnStraightPct: straight, turnRightPct: right });
    } else if (key === 'turnStraightPct') {
      const otherSum = config.turnLeftPct + config.turnRightPct;
      const left =
        otherSum > 0
          ? snap5((config.turnLeftPct / otherSum) * remaining)
          : snap5(remaining * 0.5);
      const right = remaining - left;
      onChange({ turnLeftPct: left, turnStraightPct: clamped, turnRightPct: right });
    } else {
      const otherSum = config.turnLeftPct + config.turnStraightPct;
      const left =
        otherSum > 0
          ? snap5((config.turnLeftPct / otherSum) * remaining)
          : snap5(remaining * 0.3);
      const straight = remaining - left;
      onChange({ turnLeftPct: left, turnStraightPct: straight, turnRightPct: clamped });
    }
  };

  const handleLanesChange = (lanes: number) => {
    onChange({
      lanesPerDirection: lanes,
      roadWidthPerDirection: +(lanes * config.laneWidth).toFixed(2),
    });
  };

  const handleLaneWidthChange = (lw: number) => {
    onChange({
      laneWidth: lw,
      roadWidthPerDirection: +(config.lanesPerDirection * lw).toFixed(2),
    });
  };

  const handleArmWeightChange = (arm: ArmId, val: number) => {
    onChange({
      armWeights: {
        ...armWeights,
        [arm]: +val.toFixed(1),
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
              onChange={(v) => onChange({ roadLength: v })}
              hint="Jarak pengamatan antrean sebelum garis henti"
            />
          </>
        )}

        {activeTab === 'traffic' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-700">Preset Skenario</span>
                <span className="text-[10px] font-mono text-slate-400">LIVE</span>
              </div>
              <div role="group" aria-label="Preset skenario lalu lintas" className="grid grid-cols-2 gap-1.5">
                {SCENARIO_PRESETS.map((preset) => {
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
                step={2}
                onChange={(v) => onChange({ motorRate: v })}
                accent="bg-amber-500"
              />
              <SliderField
                label="Mobil Penumpang"
                value={config.carRate}
                unit="kend/mnt"
                min={0}
                max={100}
                step={1}
                onChange={(v) => onChange({ carRate: v })}
                accent="bg-slate-800"
              />
              <SliderField
                label="Kendaraan Berat (Truk/Bus)"
                value={config.heavyRate}
                unit="kend/mnt"
                min={0}
                max={50}
                step={1}
                onChange={(v) => onChange({ heavyRate: v })}
                accent="bg-teal-600"
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
                  onClick={() => onChange({ adaptiveSignal: true })}
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
                  onClick={() => onChange({ adaptiveSignal: false })}
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
                  ? 'Hijau dapat diperpanjang/dipotong otomatis sesuai antrean.'
                  : 'Durasi lampu mengikuti angka tetap di bawah ini.'}
              </p>
            </div>

            <SliderField
              label="Durasi Lampu Hijau"
              value={config.greenDuration}
              unit="detik"
              min={5}
              max={60}
              step={1}
              onChange={(v) => onChange({ greenDuration: v })}
              hint="Berlaku per lengan (4-fase bebas konflik)"
            />
            <SliderField
              label="Durasi Lampu Kuning"
              value={config.yellowDuration}
              unit="detik"
              min={2}
              max={6}
              step={0.5}
              onChange={(v) => onChange({ yellowDuration: v })}
            />
            <SliderField
              label="Jeda Semua Merah (All-Red)"
              value={config.allRedDuration}
              unit="detik"
              min={0}
              max={5}
              step={0.5}
              onChange={(v) => onChange({ allRedDuration: v })}
              hint="Waktu pengosongan kotak simpang sebelum fase berikutnya"
            />

            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">
                {config.adaptiveSignal ? 'Durasi Dasar 1 Siklus (Adaptif Aktif)' : 'Total Durasi 1 Siklus Penuh'}
              </div>
              <div className="text-lg font-mono tabular-nums font-bold text-slate-900">
                {((config.greenDuration + config.yellowDuration + config.allRedDuration) * 4).toFixed(1)}s
              </div>
              <div className="text-[11px] text-slate-500">
                Urutan Fase: Utara → Timur → Selatan → Barat
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
