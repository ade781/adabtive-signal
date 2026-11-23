import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Sliders,
  CarFront,
  TrafficCone,
  CloudSun,
  RotateCcw,
  MapPin,
  PenTool,
} from 'lucide-react';
import { getArmGreenDuration } from '../engine/constants';
import {
  ARCHETYPE_ORDER,
  ARCHETYPE_TRAITS,
  DRIVER_MIX_PRESETS,
  normalizeDriverProfileMix,
} from '../engine/driverIntelligence';
import { sampleDemandCurve, WEATHER_PROFILES } from '../engine/environmentDynamics';
import { MAP_CONTEXTS } from '../engine/mapContextAI';
import { SCENARIO_PRESETS, ScenarioPreset } from '../engine/presets';
import { cloneTopology } from '../engine/samplingBlueprints';
import { SignalPhasePreset, TimeOfDayMode, WeatherCondition } from '../engine/topologyTypes';
import { ArchetypeStat, ArmId, DriverArchetype, DriverProfileMix, SimConfig } from '../engine/types';

export type InspectorTabId = 'geometry' | 'traffic' | 'signal' | 'environment';

interface ParameterInspectorProps {
  config: SimConfig;
  onChange: (partial: Partial<SimConfig>) => void;
  onResetDefaults: () => void;
  onOpenInDraw?: () => void;
  driverStats?: Record<DriverArchetype, ArchetypeStat>;
  variant?: 'sidebar' | 'settings';
  forcedTab?: InspectorTabId;
}

const ARCHETYPE_BAR_STYLE: Record<
  DriverArchetype,
  { bg: string; dot: string; text: string }
> = {
  defensive: { bg: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  commuter: { bg: 'bg-sky-500', dot: 'bg-sky-500', text: 'text-sky-700' },
  hurried: { bg: 'bg-rose-500', dot: 'bg-rose-500', text: 'text-rose-700' },
  courier: { bg: 'bg-amber-500', dot: 'bg-amber-500', text: 'text-amber-700' },
  transit: { bg: 'bg-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-700' },
  logistics: { bg: 'bg-slate-500', dot: 'bg-slate-500', text: 'text-slate-700' },
};

function isSameDriverMix(a: DriverProfileMix, b: DriverProfileMix): boolean {
  const na = normalizeDriverProfileMix(a);
  const nb = normalizeDriverProfileMix(b);
  return (
    na.cautiousPct === nb.cautiousPct &&
    na.normalPct === nb.normalPct &&
    na.aggressivePct === nb.aggressivePct &&
    Math.abs((na.courierShare ?? 0.42) - (nb.courierShare ?? 0.42)) < 0.015
  );
}

type TabId = InspectorTabId;

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
  { id: 'traffic', label: 'AI & Arus', icon: CarFront },
  { id: 'signal', label: 'Lampu', icon: TrafficCone },
  { id: 'environment', label: 'Cuaca/Jam', icon: CloudSun },
];

const PHASE_PRESETS: { id: SignalPhasePreset; label: string; desc: string }[] = [
  { id: '4-phase-split', label: '4-Fase Split', desc: '1 lengan hijau bergantian' },
  { id: '2-phase-simultaneous', label: '2-Fase Simultan', desc: 'U+S & T+B bareng (belok kanan yield lurus)' },
  { id: '3-phase', label: '3-Fase', desc: '1 koridor simultan + 2 lengan terpisah' },
  { id: '4-phase-protected-right', label: '4-Fase + Panah', desc: 'Fase khusus panah belok kanan' },
];

const TIME_MODES: { id: TimeOfDayMode; label: string; desc: string }[] = [
  { id: 'static', label: 'Konstan (100%)', desc: 'Laju kedatangan tetap sepanjang simulasi' },
  { id: 'morning-rush', label: 'Jam Sibuk Pagi', desc: '06:15 → 09:00 WIB (lonjakan tajam motor/komuter)' },
  { id: 'evening-rush', label: 'Jam Sibuk Sore', desc: '15:45 → 19:00 WIB (puncak lebar pulang kerja + balik arah)' },
  { id: 'full-day-24h', label: 'Siklus 24 Jam', desc: 'Fluktuasi penuh pagi-siang-sore-malam (truk naik malam)' },
];

const WEATHER_OPTIONS: { id: WeatherCondition; label: string; sub: string }[] = [
  { id: 'clear', label: 'Cerah', sub: 'μ 1.00 · 55m' },
  { id: 'light-rain', label: 'Gerimis', sub: 'μ 0.78 · 36m' },
  { id: 'heavy-rain', label: 'Hujan Lebat', sub: 'μ 0.58 · 24m' },
];

function isPresetActive(
  config: SimConfig,
  armWeights: Record<ArmId, number>,
  preset: ScenarioPreset
): boolean {
  if (preset.patch.customTopology) {
    return config.customTopology?.id === preset.patch.customTopology.id;
  }
  if (config.customTopology) return false;
  const { patch } = preset;
  if (patch.scenarioName) {
    if (config.scenarioName === patch.scenarioName) {
      return true;
    }
    const isBalancedDefault =
      preset.id === 'balanced' &&
      !config.scenarioName &&
      (!config.environmentId || config.environmentId === 'default');
    if (!isBalancedDefault) {
      return false;
    }
  }
  if (
    config.motorRate !== patch.motorRate ||
    config.carRate !== patch.carRate ||
    config.heavyRate !== patch.heavyRate
  ) {
    return false;
  }
  if (
    (patch.turnLeftPct !== undefined && config.turnLeftPct !== patch.turnLeftPct) ||
    (patch.turnStraightPct !== undefined && config.turnStraightPct !== patch.turnStraightPct) ||
    (patch.turnRightPct !== undefined && config.turnRightPct !== patch.turnRightPct)
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
  onOpenInDraw,
  driverStats,
  variant = 'sidebar',
  forcedTab,
}) => {
  const [internalTab, setInternalTab] = useState<TabId>('geometry');
  const activeTab = forcedTab ?? internalTab;
  const setActiveTab = setInternalTab;
  const tabsId = useId();
  const tabPanelRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    geometry: null,
    traffic: null,
    signal: null,
    environment: null,
  });

  useEffect(() => {
    if (tabPanelRef.current) {
      tabPanelRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const armWeights = config.armWeights ?? DEFAULT_ARM_WEIGHTS;
  const activePreset = SCENARIO_PRESETS.find((p) => isPresetActive(config, armWeights, p));
  const landmarkItems = activePreset?.landmarks
    ? activePreset.landmarks.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const envConfig = config.environment ?? { weather: 'clear', dynamicWeather: false, timeMode: 'static' };
  const activeWeatherProfile = WEATHER_PROFILES[envConfig.weather];
  const demandCurvePts = useMemo(() => sampleDemandCurve(envConfig.timeMode, 28), [envConfig.timeMode]);

  const handleManualChange = (partial: Partial<SimConfig>) => {
    onChange({
      ...partial,
      scenarioName: config.customTopology ? config.scenarioName : undefined,
      scenarioNotes: config.customTopology ? config.scenarioNotes : undefined,
      environmentId: config.customTopology ? config.environmentId : undefined,
    });
  };

  const handleApplyPreset = (preset: ScenarioPreset) => {
    const mapContext = preset.category === 'field' ? MAP_CONTEXTS[preset.id] : undefined;
    onChange({
      ...preset.patch,
      ...(mapContext ? { driverProfileMix: { ...mapContext.recommendedMix } } : {}),
      customTopology: preset.patch.customTopology ? cloneTopology(preset.patch.customTopology) : undefined,
      signalPhasePreset: preset.patch.signalPhasePreset ?? '4-phase-split',
      yellowBoxEnabled: preset.patch.yellowBoxEnabled ?? false,
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
    const clamped = Math.round(Math.max(0, Math.min(100, val)));
    const remaining = 100 - clamped;
    if (key === 'turnLeftPct') {
      const otherSum = config.turnStraightPct + config.turnRightPct;
      const straight =
        otherSum > 0
          ? Math.round((config.turnStraightPct / otherSum) * remaining)
          : Math.round(remaining * 0.7);
      const right = remaining - straight;
      handleManualChange({ turnLeftPct: clamped, turnStraightPct: straight, turnRightPct: right });
    } else if (key === 'turnStraightPct') {
      const otherSum = config.turnLeftPct + config.turnRightPct;
      const left =
        otherSum > 0
          ? Math.round((config.turnLeftPct / otherSum) * remaining)
          : Math.round(remaining * 0.5);
      const right = remaining - left;
      handleManualChange({ turnLeftPct: left, turnStraightPct: clamped, turnRightPct: right });
    } else {
      const otherSum = config.turnLeftPct + config.turnStraightPct;
      const left =
        otherSum > 0
          ? Math.round((config.turnLeftPct / otherSum) * remaining)
          : Math.round(remaining * 0.3);
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
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = TABS.length - 1;
    else return;
    e.preventDefault();
    const nextTab = TABS[nextIndex];
    setActiveTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const disciplinePct = Math.round((config.driverDiscipline ?? 0.72) * 100);
  const connectedPct = Math.round((config.connectedVehicleRatio ?? 0) * 100);
  const profileMix = normalizeDriverProfileMix(config.driverProfileMix);
  const activeFieldContext =
    config.environmentId && config.environmentId !== 'default'
      ? MAP_CONTEXTS[config.environmentId]
      : undefined;
  const mixDiffersFromMap = Boolean(
    activeFieldContext && !isSameDriverMix(profileMix, activeFieldContext.recommendedMix)
  );
  const totalActiveVehicles = driverStats
    ? ARCHETYPE_ORDER.reduce((sum, arch) => sum + (driverStats[arch]?.activeCount ?? 0), 0)
    : 0;

  const handleProfileMixChange = (
    key: 'cautiousPct' | 'normalPct' | 'aggressivePct',
    val: number
  ) => {
    const clamped = Math.round(Math.max(0, Math.min(100, val)));
    const remaining = 100 - clamped;
    let nextMix: DriverProfileMix;
    if (key === 'cautiousPct') {
      const otherSum = profileMix.normalPct + profileMix.aggressivePct;
      const normalPct =
        otherSum > 0
          ? Math.round((profileMix.normalPct / otherSum) * remaining)
          : Math.round(remaining * 0.65);
      nextMix = {
        ...profileMix,
        cautiousPct: clamped,
        normalPct,
        aggressivePct: Math.max(0, remaining - normalPct),
        preset: 'custom',
      };
    } else if (key === 'normalPct') {
      const otherSum = profileMix.cautiousPct + profileMix.aggressivePct;
      const cautiousPct =
        otherSum > 0
          ? Math.round((profileMix.cautiousPct / otherSum) * remaining)
          : Math.round(remaining * 0.45);
      nextMix = {
        ...profileMix,
        cautiousPct,
        normalPct: clamped,
        aggressivePct: Math.max(0, remaining - cautiousPct),
        preset: 'custom',
      };
    } else {
      const otherSum = profileMix.cautiousPct + profileMix.normalPct;
      const cautiousPct =
        otherSum > 0
          ? Math.round((profileMix.cautiousPct / otherSum) * remaining)
          : Math.round(remaining * 0.3);
      nextMix = {
        ...profileMix,
        cautiousPct,
        normalPct: Math.max(0, remaining - cautiousPct),
        aggressivePct: clamped,
        preset: 'custom',
      };
    }
    onChange({ driverProfileMix: nextMix });
  };

  const isSettingsMode = variant === 'settings';

  return (
    <aside
      className={
        isSettingsMode
          ? 'w-full bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden'
          : 'w-full lg:w-[355px] lg:min-h-0 bg-white border border-slate-200 rounded-lg flex flex-col shrink-0 overflow-hidden'
      }
    >
      {/* Header */}
      {!isSettingsMode && (
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
      )}

      {/* 4 Tabs */}
      {!forcedTab && (
        <div role="tablist" aria-label="Kategori Parameter" className="grid grid-cols-4 border-b border-slate-200 bg-slate-50">
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
                className={`py-2 px-1 text-[11px] font-medium flex flex-col items-center justify-center gap-0.5 border-b-2 transition-colors duration-100 ${selected
                    ? 'border-slate-900 text-slate-900 bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Tab Body */}
      <div
        ref={tabPanelRef}
        id={`${tabsId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${activeTab}`}
        className={isSettingsMode ? 'p-5 space-y-4' : 'p-3.5 space-y-4 overflow-y-auto flex-1'}
      >
        {activeTab === 'geometry' && (
          <>
            {/* Custom Draw Topology Banner OR Quick Draw Launch */}
            {config.customTopology ? (
              <div className="p-2.5 rounded-md bg-sky-50 border border-sky-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-sky-900">
                    Peta Custom Aktif ({config.customTopology.arms.length} Lengan)
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white text-sky-700 border border-sky-200">
                    DRAW
                  </span>
                </div>
                <p className="text-[10px] text-sky-800 leading-snug">
                  {config.customTopology.name} — geometri lengan, sudut, slip-lane, dan lebar asimetris diatur dari halaman Draw.
                </p>
                <div className="flex items-center gap-1.5">
                  {onOpenInDraw && (
                    <button
                      type="button"
                      onClick={onOpenInDraw}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-sky-600 text-white hover:bg-sky-700 transition-colors duration-100"
                    >
                      <PenTool className="w-3 h-3" /> Edit di Draw
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        customTopology: undefined,
                        scenarioName: undefined,
                        scenarioNotes: undefined,
                        environmentId: undefined,
                        signalPhasePreset: '4-phase-split',
                      })
                    }
                    className="px-2 py-1 rounded text-[11px] font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors duration-100"
                  >
                    Simpang 4 Standar
                  </button>
                </div>
              </div>
            ) : (
              onOpenInDraw && (
                <button
                  type="button"
                  onClick={onOpenInDraw}
                  className="w-full p-2 rounded-md border border-sky-200 bg-sky-50/70 hover:bg-sky-50 text-left transition-colors duration-100 flex items-center justify-between"
                >
                  <div>
                    <div className="text-[11px] font-semibold text-sky-900 flex items-center gap-1">
                      <PenTool className="w-3 h-3 text-sky-600" />
                      Buka &amp; Edit di Draw
                    </div>
                    <div className="text-[9px] text-sky-700 mt-0.5">Ubah sudut, lebar asimetris, sekat &amp; pulau</div>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white text-sky-700 border border-sky-200">
                    DRAW
                  </span>
                </button>
              )
            )}

            {!config.customTopology && (
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
                        className={`py-1.5 text-xs font-mono font-medium rounded border transition-colors duration-100 ${config.lanesPerDirection === l
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
                  hint="Mempengaruhi kecepatan (PKJI) & ruang salip"
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
              </>
            )}

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <span className="text-xs font-semibold text-slate-700 block">
                Kelengkapan Geometrik & Marka (RI)
              </span>
              <ToggleField
                label="Marka Yellow Box Junction"
                description="Anti-kunci simpang: kendaraan disiplin menahan diri saat jalur keluar penuh"
                checked={Boolean(config.yellowBoxEnabled)}
                onToggle={() => handleManualChange({ yellowBoxEnabled: !config.yellowBoxEnabled })}
              />
              {!config.customTopology && (
                <>
                  <ToggleField
                    label="Median Tengah Fisik"
                    description="Aktif = penghalang fisik; Nonaktif = boleh menyalip jalur lawan"
                    checked={config.hasMedian}
                    onToggle={() => handleManualChange({ hasMedian: !config.hasMedian })}
                  />
                  <ToggleField
                    label="Kotak Khusus Motor (RHK)"
                    description="Ruang henti khusus motor di depan garis henti"
                    checked={config.motorBoxEnabled}
                    onToggle={() => handleManualChange({ motorBoxEnabled: !config.motorBoxEnabled })}
                  />
                </>
              )}
            </div>

            {!config.customTopology && (
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
            )}
          </>
        )}

        {activeTab === 'traffic' && (
          <>
            {/* Smart GTA/Racing Vehicle AI Controls (No. 2, 3, 4, 8) */}
            <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Kecerdasan AI Kendaraan (v2)</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  GTA / MOBIL
                </span>
              </div>

              <SliderField
                label="Kedisiplinan Pengemudi"
                value={disciplinePct}
                unit="%"
                min={0}
                max={100}
                step={2}
                onChange={(v) => onChange({ driverDiscipline: +(v / 100).toFixed(2) })}
                hint={
                  disciplinePct >= 75
                    ? 'Tertib: patuh Yellow Box, jarang menerobos kuning/merah'
                    : disciplinePct >= 45
                      ? 'Realistis RI: seimbang antara agresif & patuh'
                      : 'Chaotic: agresif salip, nekat terobos, sering serobot garis henti'
                }
              />

              <ToggleField
                label="Salip-Menyalip Aktif (MOBIL)"
                description="Mobil & motor aktif pindah lajur menyalip kendaraan lambat & antrean"
                checked={config.smartOvertaking !== false}
                onToggle={() => onChange({ smartOvertaking: config.smartOvertaking === false })}
              />

              <ToggleField
                label="Salip Makan Jalur Lawan"
                description="Otomatis di jalan tanpa median jika celah arus berlawanan aman"
                checked={config.oncomingOvertaking !== false}
                onToggle={() => onChange({ oncomingOvertaking: config.oncomingOvertaking === false })}
              />

              <div className="pt-2 border-t border-slate-200">
                <SliderField
                  label="Rasio Kendaraan Terkoneksi (V2V / CAV)"
                  value={connectedPct}
                  unit="%"
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) => onChange({ connectedVehicleRatio: +(v / 100).toFixed(2) })}
                  accent="bg-cyan-600"
                  hint="Persepsi X-ray tembus truk/bus & iring-iringan CACC lebih rapat"
                />
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700">Komposisi Tipe Pengendara</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                    {profileMix.cautiousPct}/{profileMix.normalPct}/{profileMix.aggressivePct}%
                  </span>
                </div>

                {activeFieldContext && mixDiffersFromMap && (
                  <div className="p-2 rounded-md border border-emerald-200 bg-emerald-50 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold text-emerald-900 leading-tight">
                          Profil berbeda dari karakter peta aktif
                        </div>
                        <div className="text-[9px] text-emerald-800 leading-snug mt-0.5 truncate">
                          {activeFieldContext.label}
                        </div>
                      </div>
                      <span className="text-[9px] font-mono tabular-nums text-emerald-800 bg-white px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">
                        {activeFieldContext.recommendedMix.cautiousPct}/
                        {activeFieldContext.recommendedMix.normalPct}/
                        {activeFieldContext.recommendedMix.aggressivePct}%
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          driverProfileMix: { ...activeFieldContext.recommendedMix },
                        })
                      }
                      className="w-full px-2 py-1 rounded text-[10px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800 transition-colors duration-100"
                    >
                      Sesuaikan Profil Peta
                    </button>
                  </div>
                )}

                {activeFieldContext && !mixDiffersFromMap && (
                  <div className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50/70 flex items-center justify-between gap-2 text-[9px] text-emerald-800">
                    <span className="truncate">Tersinkron: {activeFieldContext.label}</span>
                    <span className="font-mono font-semibold shrink-0">PETA</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1">
                  {(
                    Object.keys(DRIVER_MIX_PRESETS) as Array<keyof typeof DRIVER_MIX_PRESETS>
                  ).map((presetKey) => {
                    const item = DRIVER_MIX_PRESETS[presetKey];
                    const active = profileMix.preset === presetKey;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange({ driverProfileMix: { ...item.mix } })}
                        title={item.desc}
                        className={`px-2 py-1 rounded text-left border transition-colors duration-100 ${active
                            ? 'bg-indigo-700 text-white border-indigo-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                      >
                        <div className="text-[10px] font-semibold leading-tight truncate">{item.label}</div>
                      </button>
                    );
                  })}
                </div>
                <SliderField
                  label="Hati-hati / Defensif"
                  value={profileMix.cautiousPct}
                  unit="%"
                  min={0}
                  max={100}
                  step={2}
                  onChange={(v) => handleProfileMixChange('cautiousPct', v)}
                  accent="bg-emerald-500"
                />
                <SliderField
                  label="Komuter Normal"
                  value={profileMix.normalPct}
                  unit="%"
                  min={0}
                  max={100}
                  step={2}
                  onChange={(v) => handleProfileMixChange('normalPct', v)}
                  accent="bg-sky-500"
                />
                <SliderField
                  label="Agresif / Terburu"
                  value={profileMix.aggressivePct}
                  unit="%"
                  min={0}
                  max={100}
                  step={2}
                  onChange={(v) => handleProfileMixChange('aggressivePct', v)}
                  accent="bg-rose-500"
                />
                <SliderField
                  label="Proporsi Kurir / Ojol (dari Agresif)"
                  value={Math.round((profileMix.courierShare ?? 0.42) * 100)}
                  unit="%"
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) =>
                    onChange({
                      driverProfileMix: {
                        ...profileMix,
                        courierShare: +(v / 100).toFixed(2),
                        preset: 'custom',
                      },
                    })
                  }
                  accent="bg-amber-500"
                  hint="Motor kurir aktif mencari celah RHK & lajur depan"
                />

                {/* Live Distribution Bar (closed-loop feedback from active vehicles on map) */}
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-slate-700">Distribusi Aktif di Peta</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {totalActiveVehicles} kend
                    </span>
                  </div>
                  <div
                    className="h-2 w-full rounded-full bg-slate-200 overflow-hidden flex"
                    aria-label="Distribusi arketipe pengendara aktif di peta"
                  >
                    {totalActiveVehicles > 0 &&
                      ARCHETYPE_ORDER.map((arch) => {
                        const count = driverStats?.[arch]?.activeCount ?? 0;
                        if (count <= 0) return null;
                        const pct = (count / totalActiveVehicles) * 100;
                        const meta = ARCHETYPE_TRAITS[arch];
                        return (
                          <div
                            key={arch}
                            className={`h-full ${ARCHETYPE_BAR_STYLE[arch].bg}`}
                            style={{ width: `${pct}%` }}
                            title={`${meta.label}: ${count} aktif (${Math.round(pct)}%)`}
                          />
                        );
                      })}
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px] font-mono tabular-nums">
                    {ARCHETYPE_ORDER.map((arch) => {
                      const count = driverStats?.[arch]?.activeCount ?? 0;
                      const meta = ARCHETYPE_TRAITS[arch];
                      const style = ARCHETYPE_BAR_STYLE[arch];
                      return (
                        <div
                          key={arch}
                          title={meta.label}
                          className="flex items-center justify-between px-1.5 py-0.5 rounded bg-white border border-slate-200"
                        >
                          <span className={`inline-flex items-center gap-1 ${style.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                            <span>{meta.shortBadge}</span>
                          </span>
                          <strong className="text-slate-900">{count}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Field Presets (6 Sampling RI) */}
            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-emerald-600" />
                    Lokasi Lapangan Nyata (RI)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    STATIC
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
                        onClick={() => handleApplyPreset(preset)}
                        title={preset.source ?? preset.description}
                        className={`px-2.5 py-1.5 rounded text-left border transition-colors duration-100 ${active
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
                        <div className={`text-[10px] leading-tight mt-0.5 truncate ${active ? 'text-emerald-100' : 'text-slate-500'}`}>
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
                        onClick={() => handleApplyPreset(preset)}
                        title={preset.description}
                        className={`px-2 py-1.5 rounded text-left border transition-colors duration-100 ${active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                      >
                        <div className="text-[11px] font-semibold leading-tight">{preset.label}</div>
                        <div className={`text-[10px] leading-tight mt-0.5 truncate ${active ? 'text-slate-300' : 'text-slate-400'}`}>
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
                    <span className="text-[10px] font-mono font-semibold text-emerald-700">{activePreset.city}</span>
                  )}
                </div>
                {landmarkItems.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {landmarkItems.map((lm) => (
                      <span key={lm} className="text-[10px] px-1.5 py-0.5 rounded bg-white text-emerald-800 border border-emerald-200">
                        {lm}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="text-[11px] text-slate-500">
                Laju kedatangan dasar total di seluruh lengan simpang (kendaraan/menit).
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

            {!config.customTopology && (
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
            )}

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
                step={1}
                onChange={(v) => handleTurnChange('turnLeftPct', v)}
              />
              <SliderField
                label="Lurus"
                value={config.turnStraightPct}
                unit="%"
                min={0}
                max={100}
                step={1}
                onChange={(v) => handleTurnChange('turnStraightPct', v)}
              />
              <SliderField
                label="Belok Kanan"
                value={config.turnRightPct}
                unit="%"
                min={0}
                max={100}
                step={1}
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
                  className={`py-1.5 rounded text-xs font-medium border transition-colors duration-100 ${config.adaptiveSignal
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
                  className={`py-1.5 rounded text-xs font-medium border transition-colors duration-100 ${!config.adaptiveSignal
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  Fixed-Time
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {config.adaptiveSignal
                  ? 'Hijau otomatis menyesuaikan antrean per fase (maks. sesuai Durasi Hijau).'
                  : 'Durasi lampu mengikuti angka tetap per fase di bawah ini.'}
              </p>
            </div>

            {/* Flexible Signal Phase Plan (No. 7) */}
            <div className="pt-2 border-t border-slate-200 space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 block">Skema Fase Lampu (Multi-Fase)</span>
              <div className="grid grid-cols-2 gap-1.5">
                {PHASE_PRESETS.map((p) => {
                  const armCount = config.customTopology?.arms.length ?? 4;
                  const disabled =
                    (p.id === '2-phase-simultaneous' || p.id === '4-phase-protected-right') && armCount !== 4;
                  const active = (config.signalPhasePreset ?? '4-phase-split') === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange({ signalPhasePreset: p.id })}
                      title={disabled ? 'Khusus simpang 4 lengan' : p.desc}
                      className={`p-2 rounded border text-left transition-colors duration-100 ${disabled
                          ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400'
                          : active
                            ? 'bg-indigo-700 text-white border-indigo-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <div className="text-[11px] font-semibold leading-tight">{p.label}</div>
                      <div className={`text-[9px] mt-0.5 leading-snug ${active ? 'text-indigo-100' : 'text-slate-500'}`}>
                        {p.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
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

            {!config.customTopology && (
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
            )}

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
          </>
        )}

        {activeTab === 'environment' && (
          <>
            {/* Time-of-Day NHPP Demand Profile (No. 11) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Profil Arus Berbasis Waktu (PHF)</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                  PKJI / NHPP
                </span>
              </div>

              <div className="space-y-1.5">
                {TIME_MODES.map((tm) => {
                  const active = envConfig.timeMode === tm.id;
                  return (
                    <button
                      key={tm.id}
                      type="button"
                      onClick={() => onChange({ environment: { ...envConfig, timeMode: tm.id } })}
                      className={`w-full p-2 rounded-md border text-left transition-colors duration-100 ${active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <div className="text-[11px] font-semibold">{tm.label}</div>
                      <div className={`text-[10px] mt-0.5 ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                        {tm.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Lightweight SVG Demand Curve Preview */}
              <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                  <span>Kurva Fluktuasi Permintaan</span>
                  <span className="font-mono">0.2x – 1.48x</span>
                </div>
                <svg viewBox="0 0 220 56" className="w-full h-14 overflow-visible" aria-hidden="true">
                  <line x1="0" y1="28" x2="220" y2="28" stroke="#CBD5E1" strokeDasharray="3 3" strokeWidth="1" />
                  <polyline
                    fill="none"
                    stroke="#0F172A"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    points={demandCurvePts
                      .map((pt, i) => {
                        const x = (i / Math.max(1, demandCurvePts.length - 1)) * 220;
                        const y = 52 - (Math.min(1.5, pt.mult) / 1.55) * 46;
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      })
                      .join(' ')}
                  />
                </svg>
              </div>
            </div>

            {/* Weather Physics (No. 11) */}
            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Kondisi Cuaca & Fisika Aspal</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                  FHWA / HCM
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {WEATHER_OPTIONS.map((w) => {
                  const active = envConfig.weather === w.id && !envConfig.dynamicWeather;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() =>
                        onChange({
                          environment: { ...envConfig, weather: w.id, dynamicWeather: false },
                        })
                      }
                      className={`p-2 rounded-md border text-center transition-colors duration-100 ${active
                          ? 'bg-sky-700 text-white border-sky-700'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <div className="text-[11px] font-semibold">{w.label}</div>
                      <div className={`text-[9px] font-mono mt-0.5 ${active ? 'text-sky-100' : 'text-slate-400'}`}>
                        {w.sub}
                      </div>
                    </button>
                  );
                })}
              </div>

              <ToggleField
                label="Cuaca Dinamis Otomatis"
                description="Berubah otomatis tiap 45–60s: Cerah → Gerimis → Hujan Lebat"
                checked={Boolean(envConfig.dynamicWeather)}
                onToggle={() =>
                  onChange({
                    environment: { ...envConfig, dynamicWeather: !envConfig.dynamicWeather },
                  })
                }
              />

              {/* Empirical Physics Summary Card */}
              <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1 text-[10px] font-mono text-slate-600">
                <div className="font-sans text-[11px] font-semibold text-slate-800 mb-1">
                  Dampak Aktif: {activeWeatherProfile.label}
                </div>
                <div className="flex justify-between">
                  <span>Friksi Ban (μ) / Deselerasi</span>
                  <strong className="text-slate-900">
                    {activeWeatherProfile.friction.toFixed(2)} / {Math.round(activeWeatherProfile.comfortDecelMult * 100)}%
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Kecepatan Motor / Mobil</span>
                  <strong className="text-slate-900">
                    {Math.round(activeWeatherProfile.speedMult.motor * 100)}% / {Math.round(activeWeatherProfile.speedMult.car * 100)}%
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Time Headway (T) / Gap (s₀)</span>
                  <strong className="text-slate-900">
                    {activeWeatherProfile.headwayMult.toFixed(2)}× / {activeWeatherProfile.minGapMult.toFixed(2)}×
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Jarak Pandang / Salip Lawan</span>
                  <strong className={activeWeatherProfile.allowOncomingOvertake ? 'text-emerald-700' : 'text-rose-700'}>
                    {activeWeatherProfile.sightDistance}m / {activeWeatherProfile.allowOncomingOvertake ? 'Boleh' : 'Tutup'}
                  </strong>
                </div>
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
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-100 ${checked ? 'bg-slate-900 border-slate-900' : 'bg-slate-200 border-slate-300'
          }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transform transition-transform duration-100 ${checked ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
        />
      </span>
    </button>
  );
};
