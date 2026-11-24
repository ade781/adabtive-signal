import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Box,
  CarFront,
  CloudSun,
  Download,
  Grid,
  Layers,
  RotateCcw,
  Sliders,
  TrafficCone,
  ZoomIn,
} from 'lucide-react';
import { RenderDimension } from '../App';
import {
  ARCHETYPE_ORDER,
  ARCHETYPE_TRAITS,
  MAP_OVERLAY_PRESETS,
} from '../engine/driverIntelligence';
import {
  DriverArchetype,
  MapOverlayLayers,
  SimConfig,
  SimStats,
} from '../engine/types';
import { InspectorTabId, ParameterInspector } from './ParameterInspector';

type SettingsSectionId =
  | 'display'
  | 'geometry'
  | 'traffic'
  | 'signal'
  | 'environment'
  | 'analytics';

interface SettingsPageProps {
  config: SimConfig;
  onChangeConfig: (partial: Partial<SimConfig>) => void;
  onResetDefaults: () => void;
  onOpenInDraw: () => void;
  onBackToSimulator: () => void;
  onDownloadReport: () => void;
  isExporting?: boolean;
  stats: SimStats;
  renderDimension: RenderDimension;
  onRenderDimensionChange: (dimension: RenderDimension) => void;
  zoom: number;
  onZoomChange: (nextZoom: number) => void;
  onZoomReset: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  overlayLayers: MapOverlayLayers;
  onChangeOverlayLayers: (layers: MapOverlayLayers) => void;
  focusedArchetype: DriverArchetype | null;
  onSelectArchetype: (arch: DriverArchetype | null) => void;
}

const SECTIONS: ReadonlyArray<{
  id: SettingsSectionId;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'display',
    label: 'Tampilan & Layer Peta',
    desc: 'Mode 2D/3D, layer AI, grid & zoom',
    icon: Layers,
  },
  {
    id: 'geometry',
    label: 'Peta & Geometri Simpang',
    desc: 'Lajur, marka, median, RHK & nama jalan',
    icon: Sliders,
  },
  {
    id: 'traffic',
    label: 'Kecerdasan AI & Arus',
    desc: '6 tipe pengendara, V2V, preset & volume',
    icon: CarFront,
  },
  {
    id: 'signal',
    label: 'Lampu Lalu Lintas',
    desc: 'Adaptif, fase, LTOR & durasi',
    icon: TrafficCone,
  },
  {
    id: 'environment',
    label: 'Cuaca & Jam Sibuk',
    desc: 'Kurva NHPP 24 jam & fisika hujan',
    icon: CloudSun,
  },
  {
    id: 'analytics',
    label: 'Analitik 6 Tipe & Laporan',
    desc: 'Statistik per arketipe & ekspor Excel',
    icon: BarChart3,
  },
];

const OVERLAY_LAYER_ITEMS: ReadonlyArray<{
  key: keyof MapOverlayLayers;
  label: string;
  desc: string;
}> = [
  {
    key: 'identity',
    label: 'Identitas & Badge LOD',
    desc: 'Aksen kolong sasis & lencana tipe pengendara adaptif zoom',
  },
  {
    key: 'tacticalCues',
    label: 'Keputusan Taktis AI',
    desc: 'Busur salip, chevron yield, tahan Yellow Box, sight-cone peek, wide-swing, radar V2V',
  },
  {
    key: 'socialVectors',
    label: 'Vektor Interaksi Sosial',
    desc: 'Tekanan buntutan (tailgate), handshake pindah lajur & flanking cushion',
  },
  {
    key: 'emotionBars',
    label: 'Emosi & Pemulihan Stres',
    desc: 'Bar frustrasi (>50%) & indikator pemulihan pasca-insiden',
  },
  {
    key: 'frictionHeatmap',
    label: 'Heatmap Gesekan Peta',
    desc: 'Peta panas titik rem mendadak, konflik yield & pelanggaran marka',
  },
];

const OVERLAY_PRESET_ITEMS: ReadonlyArray<{
  id: 'compact' | 'full' | 'off';
  label: string;
  desc: string;
}> = [
  { id: 'compact', label: 'Ringkas', desc: 'Identitas, taktis & emosi penting' },
  { id: 'full', label: 'Penuh', desc: 'Semua 5 layer + vektor & heatmap' },
  { id: 'off', label: 'Mati', desc: 'Peta murni tanpa overlay AI' },
];

const ARCHETYPE_DOT_COLOR: Record<DriverArchetype, string> = {
  defensive: 'bg-emerald-500',
  commuter: 'bg-sky-500',
  hurried: 'bg-rose-500',
  courier: 'bg-amber-500',
  transit: 'bg-indigo-500',
  logistics: 'bg-slate-500',
};

function matchesOverlayPreset(a: MapOverlayLayers, b: MapOverlayLayers): boolean {
  return (
    a.identity === b.identity &&
    a.tacticalCues === b.tacticalCues &&
    a.socialVectors === b.socialVectors &&
    a.emotionBars === b.emotionBars &&
    a.frictionHeatmap === b.frictionHeatmap
  );
}

const INSPECTOR_TAB_MAP: Partial<Record<SettingsSectionId, InspectorTabId>> = {
  geometry: 'geometry',
  traffic: 'traffic',
  signal: 'signal',
  environment: 'environment',
};

const RENDER_DIMENSION_OPTIONS: ReadonlyArray<{
  id: RenderDimension;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: '2d',
    label: '2D Datar',
    desc: 'Top-down presisi & blueprint',
    Icon: Layers,
  },
  {
    id: '3d',
    label: '3D Interaktif',
    desc: 'Perspektif & kamera bebas',
    Icon: Box,
  },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({
  config,
  onChangeConfig,
  onResetDefaults,
  onOpenInDraw,
  onBackToSimulator,
  onDownloadReport,
  isExporting = false,
  stats,
  renderDimension,
  onRenderDimensionChange,
  zoom,
  onZoomChange,
  onZoomReset,
  showGrid,
  onToggleGrid,
  overlayLayers,
  onChangeOverlayLayers,
  focusedArchetype,
  onSelectArchetype,
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('display');
  const inspectorTab = INSPECTOR_TAB_MAP[activeSection];

  const activeLayerCount =
    (overlayLayers.identity ? 1 : 0) +
    (overlayLayers.tacticalCues ? 1 : 0) +
    (overlayLayers.socialVectors ? 1 : 0) +
    (overlayLayers.emotionBars ? 1 : 0) +
    (overlayLayers.frictionHeatmap ? 1 : 0);

  return (
    <main className="flex-1 min-h-0 bg-slate-50 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Page Header */}
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Pusat Pengaturan & Fitur Simulasi
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Seluruh kontrol tampilan peta, layer AI pengendara, geometri simpang, sinyal, cuaca, dan analitik terpusat di sini agar layar utama tetap bersih.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResetDefaults}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors duration-100"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Default
            </button>
            <button
              type="button"
              onClick={onDownloadReport}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-colors duration-100"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? 'Mengekspor...' : 'Report .xlsx'}
            </button>
            <button
              type="button"
              onClick={onBackToSimulator}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors duration-100"
            >
              <Activity className="w-3.5 h-3.5" />
              Kembali ke Simulasi
            </button>
          </div>
        </div>

        {/* 2-Column Settings Body */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Category Navigation */}
          <nav
            aria-label="Kategori Pengaturan"
            className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-2 space-y-1"
          >
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const active = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-md border transition-colors duration-100 ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-transparent hover:bg-slate-50'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      active ? 'text-white' : 'text-slate-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-tight">{sec.label}</div>
                    <div
                      className={`text-[10px] mt-0.5 leading-snug ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {sec.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Right Content Panel */}
          <div className="lg:col-span-9 min-w-0 space-y-4">
            {activeSection === 'display' && (
              <div className="space-y-4">
                {/* Layer AI Peta */}
                <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Layer Visualisasi Kecerdasan Pengendara di Peta
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Pilih seberapa detail informasi AI yang ditampilkan langsung di atas kanvas simulasi.
                      </p>
                    </div>
                    <span className="text-xs font-mono tabular-nums px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {activeLayerCount}/5 layer aktif
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {OVERLAY_PRESET_ITEMS.map((preset) => {
                      const active = matchesOverlayPreset(
                        overlayLayers,
                        MAP_OVERLAY_PRESETS[preset.id]
                      );
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            onChangeOverlayLayers({ ...MAP_OVERLAY_PRESETS[preset.id] })
                          }
                          className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors duration-100 ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <div className="text-xs font-semibold">{preset.label}</div>
                          <div
                            className={`text-[11px] mt-0.5 ${
                              active ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {preset.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
                    {OVERLAY_LAYER_ITEMS.map((item) => {
                      const checked = overlayLayers[item.key];
                      return (
                        <label
                          key={item.key}
                          className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-50 cursor-pointer transition-colors duration-100"
                        >
                          <div>
                            <div className="text-xs font-semibold text-slate-800">{item.label}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{item.desc}</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              onChangeOverlayLayers({
                                ...overlayLayers,
                                [item.key]: e.target.checked,
                              })
                            }
                            className="mt-0.5 w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0 transition-colors duration-100"
                          />
                        </label>
                      );
                    })}
                  </div>
                </section>

                {/* Viewport, Grid & Sorotan Arketipe */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Kanvas, Zoom & Grid Blueprint
                    </h3>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <Box className="w-3.5 h-3.5 text-slate-500" />
                          Mode Tampilan Peta
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-slate-900">
                          {renderDimension === '3d' ? '3D Interaktif' : '2D Datar'}
                        </span>
                      </div>
                      <div
                        role="group"
                        aria-label="Mode Tampilan Peta"
                        className="grid grid-cols-2 gap-2"
                      >
                        {RENDER_DIMENSION_OPTIONS.map(({ id, label, desc, Icon }) => {
                          const active = renderDimension === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => onRenderDimensionChange(id)}
                              className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors duration-100 ${
                                active
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <Icon
                                className={`w-4 h-4 mt-0.5 shrink-0 ${
                                  active ? 'text-white' : 'text-slate-500'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold leading-tight">{label}</div>
                                <div
                                  className={`text-[10px] mt-0.5 leading-snug ${
                                    active ? 'text-slate-300' : 'text-slate-500'
                                  }`}
                                >
                                  {desc}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <ZoomIn className="w-3.5 h-3.5 text-slate-500" />
                          Tingkat Zoom Peta
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            {Math.round(zoom * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={onZoomReset}
                            className="px-2 py-0.5 text-[11px] rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors duration-100"
                          >
                            Reset 100%
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0.6}
                        max={2.4}
                        step={0.1}
                        value={zoom}
                        onChange={(e) => onZoomChange(parseFloat(e.target.value))}
                        className="w-full accent-slate-900 cursor-pointer transition-colors duration-100"
                      />
                      <p className="text-[11px] text-slate-500">
                        Di peta utama Anda juga bisa langsung scroll mouse untuk zoom dan drag untuk menggeser peta.
                      </p>
                    </div>

                    <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Grid className="w-4 h-4 text-slate-600" />
                        <div>
                          <div className="text-xs font-semibold text-slate-800">
                            Blueprint Grid (10m)
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Tampilkan garis kisi skala meter di latar peta
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={showGrid}
                        onChange={onToggleGrid}
                        className="w-4 h-4 accent-slate-900 rounded cursor-pointer transition-colors duration-100"
                      />
                    </label>
                  </section>

                  <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Sorotan Tipe Pengendara (Spotlight)
                      </h3>
                      {focusedArchetype && (
                        <button
                          type="button"
                          onClick={() => onSelectArchetype(null)}
                          className="text-[11px] font-medium text-indigo-700 hover:underline transition-colors duration-100"
                        >
                          Tampilkan Semua
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Pilih satu tipe untuk menonjolkan perilakunya di peta dan meredupkan tipe lainnya.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {ARCHETYPE_ORDER.map((arch) => {
                        const meta = ARCHETYPE_TRAITS[arch];
                        const active = focusedArchetype === arch;
                        return (
                          <button
                            key={arch}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onSelectArchetype(active ? null : arch)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors duration-100 ${
                              active
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${ARCHETYPE_DOT_COLOR[arch]}`}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-mono font-semibold leading-none">
                                {meta.shortBadge}
                              </div>
                              <div
                                className={`text-[10px] truncate mt-0.5 ${
                                  active ? 'text-slate-300' : 'text-slate-500'
                                }`}
                              >
                                {meta.label}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {inspectorTab && (
              <ParameterInspector
                variant="settings"
                forcedTab={inspectorTab}
                config={config}
                onChange={onChangeConfig}
                onResetDefaults={onResetDefaults}
                onOpenInDraw={onOpenInDraw}
                driverStats={stats.driverStats}
              />
            )}

            {activeSection === 'analytics' && (
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Analitik Perilaku 6 Tipe Pengendara
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Klik baris mana pun untuk mengaktifkan Spotlight Filter tipe tersebut di peta.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums">
                    <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                      Salip: {stats.carOvertakeCount ?? 0}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                      Lawan: {stats.oncomingOvertakeCount ?? 0}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Yield: {stats.yieldConflictCount ?? 0}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-800 border border-yellow-300">
                      YBox: {stats.yellowBoxHoldCount ?? 0}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                      Marka: {stats.markingCrossCount ?? 0}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-800 border border-orange-200">
                      Mundur: {stats.reverseRecoveryCount ?? 0}
                    </span>
                  </div>
                </div>

                {stats.driverStats ? (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-sans text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="py-2 px-3">Arketipe</th>
                          <th className="py-2 px-2 text-right">Aktif</th>
                          <th className="py-2 px-2 text-right">Keluar</th>
                          <th className="py-2 px-2 text-right">Tunggu</th>
                          <th className="py-2 px-2 text-right">Kecepatan</th>
                          <th className="py-2 px-2 text-right">Salip</th>
                          <th className="py-2 px-2 text-right">Marka</th>
                          <th className="py-2 px-2 text-right">Rem Keras</th>
                          <th className="py-2 px-2 text-right">Yield / H-Shake</th>
                          <th className="py-2 px-3 text-right">Frustrasi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ARCHETYPE_ORDER.map((arch) => {
                          const st = stats.driverStats?.[arch];
                          if (!st) return null;
                          const meta = ARCHETYPE_TRAITS[arch];
                          const isFocused = focusedArchetype === arch;
                          const avgSpeedKmh = ((st.avgSpeed ?? 0) * 3.6).toFixed(0);
                          const avgFrustPct = Math.round((st.avgFrustration ?? 0) * 100);
                          return (
                            <tr
                              key={arch}
                              onClick={() => onSelectArchetype(isFocused ? null : arch)}
                              className={`border-b border-slate-100 last:border-b-0 cursor-pointer transition-colors duration-100 ${
                                isFocused ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2 px-3 font-sans">
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${ARCHETYPE_DOT_COLOR[arch]}`}
                                  />
                                  <span className="font-mono font-semibold text-slate-900">
                                    {meta.shortBadge}
                                  </span>
                                  <span className="text-slate-600">{meta.label}</span>
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-slate-800">{st.activeCount}</td>
                              <td className="py-2 px-2 text-right font-semibold text-slate-900">
                                {st.exited}
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {st.avgWait.toFixed(1)}s
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {avgSpeedKmh} km/h
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">{st.overtakes}</td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {st.markingCrosses}
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {st.hardBrakes ?? 0}
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {st.yieldsGiven ?? 0} / {st.handshakes ?? 0}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <span
                                  className={
                                    avgFrustPct >= 55
                                      ? 'text-rose-700 font-semibold'
                                      : avgFrustPct >= 30
                                      ? 'text-amber-700'
                                      : 'text-slate-700'
                                  }
                                >
                                  {avgFrustPct}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Menunggu data simulasi per tipe pengendara...
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};
