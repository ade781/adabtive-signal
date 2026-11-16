import React, { useId, useState } from 'react';
import { Sliders, CarFront, TrafficCone, Lock, Pause, RotateCcw } from 'lucide-react';
import { SimConfig } from '../engine/types';

interface ParameterInspectorProps {
  config: SimConfig;
  running: boolean;
  onPause: () => void;
  onChange: (partial: Partial<SimConfig>) => void;
  onResetDefaults: () => void;
}

type TabId = 'geometry' | 'traffic' | 'signal';

function snap5(val: number): number {
  return Math.round(val / 5) * 5;
}

export const ParameterInspector: React.FC<ParameterInspectorProps> = ({
  config,
  running,
  onPause,
  onChange,
  onResetDefaults,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('geometry');

  const handleTurnChange = (key: 'turnLeftPct' | 'turnStraightPct' | 'turnRightPct', val: number) => {
    if (running) return;
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
    if (running) return;
    onChange({
      lanesPerDirection: lanes,
      roadWidthPerDirection: +(lanes * config.laneWidth).toFixed(2),
    });
  };

  const handleLaneWidthChange = (lw: number) => {
    if (running) return;
    onChange({
      laneWidth: lw,
      roadWidthPerDirection: +(config.lanesPerDirection * lw).toFixed(2),
    });
  };

  return (
    <aside className="w-full lg:w-[350px] bg-white border border-slate-200 rounded-lg flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Parameter Simulasi
        </span>
        {running ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
            <Lock className="w-3 h-3" />
            TERKUNCI
          </span>
        ) : (
          <button
            type="button"
            onClick={onResetDefaults}
            className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition-colors duration-100"
            title="Kembalikan parameter ke nilai awal"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Default
          </button>
        )}
      </div>

      {/* Lock Banner when running */}
      {running && (
        <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-600">
            Pause simulasi untuk mengubah parameter.
          </span>
          <button
            type="button"
            onClick={onPause}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-slate-900 text-white hover:bg-slate-800 shrink-0 transition-colors duration-100"
          >
            <Pause className="w-3 h-3" />
            Pause untuk Edit
          </button>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Kategori Parameter" className="grid grid-cols-3 border-b border-slate-200 bg-slate-50">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'geometry'}
          onClick={() => setActiveTab('geometry')}
          className={`py-2 px-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors duration-100 ${
            activeTab === 'geometry'
              ? 'border-slate-900 text-slate-900 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Jalan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'traffic'}
          onClick={() => setActiveTab('traffic')}
          className={`py-2 px-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors duration-100 ${
            activeTab === 'traffic'
              ? 'border-slate-900 text-slate-900 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CarFront className="w-3.5 h-3.5" />
          Kendaraan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'signal'}
          onClick={() => setActiveTab('signal')}
          className={`py-2 px-2 text-xs font-medium flex items-center justify-center gap-1.5 border-b-2 transition-colors duration-100 ${
            activeTab === 'signal'
              ? 'border-slate-900 text-slate-900 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <TrafficCone className="w-3.5 h-3.5" />
          Lampu
        </button>
      </div>

      {/* Tab Body */}
      <div className="p-3.5 space-y-4 overflow-y-auto flex-1">
        {activeTab === 'geometry' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-700">Jumlah Lajur (per arah)</span>
                <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                  {config.lanesPerDirection} lajur
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((l) => (
                  <button
                    key={l}
                    type="button"
                    disabled={running}
                    onClick={() => handleLanesChange(l)}
                    className={`py-1.5 text-xs font-mono font-medium rounded border transition-colors duration-100 disabled:cursor-not-allowed ${
                      config.lanesPerDirection === l
                        ? 'bg-slate-900 text-white border-slate-900 disabled:bg-slate-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-50'
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
              disabled={running}
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
              disabled={running}
              onChange={(v) => onChange({ roadLength: v })}
              hint="Jarak pengamatan antrean sebelum garis henti"
            />
          </>
        )}

        {activeTab === 'traffic' && (
          <>
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
              disabled={running}
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
              disabled={running}
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
              disabled={running}
              onChange={(v) => onChange({ heavyRate: v })}
              accent="bg-teal-600"
            />

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
                disabled={running}
                onChange={(v) => handleTurnChange('turnLeftPct', v)}
              />
              <SliderField
                label="Lurus"
                value={config.turnStraightPct}
                unit="%"
                min={0}
                max={100}
                step={5}
                disabled={running}
                onChange={(v) => handleTurnChange('turnStraightPct', v)}
              />
              <SliderField
                label="Belok Kanan"
                value={config.turnRightPct}
                unit="%"
                min={0}
                max={100}
                step={5}
                disabled={running}
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
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => onChange({ adaptiveSignal: true })}
                  className={`py-1.5 rounded text-xs font-medium border transition-colors duration-100 ${
                    config.adaptiveSignal
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Adaptif
                </button>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => onChange({ adaptiveSignal: false })}
                  className={`py-1.5 rounded text-xs font-medium border transition-colors duration-100 ${
                    !config.adaptiveSignal
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
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
              disabled={running}
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
              disabled={running}
              onChange={(v) => onChange({ yellowDuration: v })}
            />
            <SliderField
              label="Jeda Semua Merah (All-Red)"
              value={config.allRedDuration}
              unit="detik"
              min={0}
              max={5}
              step={0.5}
              disabled={running}
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
  disabled?: boolean;
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
  disabled,
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
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full h-1.5 bg-slate-200 rounded-lg appearance-none accent-slate-900 ${
          disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
        }`}
      />
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
};
