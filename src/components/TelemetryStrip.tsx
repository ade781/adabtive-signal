import React, { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { ARCHETYPE_ORDER, ARCHETYPE_TRAITS } from '../engine/driverIntelligence';
import { CompiledTopology } from '../engine/topologyTypes';
import { ArmId, DriverArchetype, SignalState, SimStats } from '../engine/types';
import { evaluateLos } from '../utils/trafficMetrics';

interface TelemetryStripProps {
  stats: SimStats;
  signal: SignalState;
  armNames?: Partial<Record<ArmId, string>>;
  compiledTopology?: CompiledTopology;
  focusedArchetype?: DriverArchetype | null;
  onSelectArchetype?: (arch: DriverArchetype | null) => void;
}

const ARCHETYPE_CHIP_STYLES: Record<
  DriverArchetype,
  { idle: string; active: string; dot: string; activeBadge: string; activeBadgeSelected: string }
> = {
  defensive: {
    idle: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
    active: 'bg-emerald-700 text-white border-emerald-800 shadow-sm',
    dot: 'bg-emerald-500',
    activeBadge: 'bg-white text-emerald-800 border-emerald-200',
    activeBadgeSelected: 'bg-emerald-800 text-emerald-50 border-emerald-600',
  },
  commuter: {
    idle: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    active: 'bg-sky-700 text-white border-sky-800 shadow-sm',
    dot: 'bg-sky-500',
    activeBadge: 'bg-white text-sky-800 border-sky-200',
    activeBadgeSelected: 'bg-sky-800 text-sky-50 border-sky-600',
  },
  hurried: {
    idle: 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
    active: 'bg-rose-700 text-white border-rose-800 shadow-sm',
    dot: 'bg-rose-500',
    activeBadge: 'bg-white text-rose-800 border-rose-200',
    activeBadgeSelected: 'bg-rose-800 text-rose-50 border-rose-600',
  },
  courier: {
    idle: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
    active: 'bg-amber-600 text-white border-amber-700 shadow-sm',
    dot: 'bg-amber-500',
    activeBadge: 'bg-white text-amber-800 border-amber-200',
    activeBadgeSelected: 'bg-amber-700 text-amber-50 border-amber-500',
  },
  transit: {
    idle: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
    active: 'bg-indigo-700 text-white border-indigo-800 shadow-sm',
    dot: 'bg-indigo-500',
    activeBadge: 'bg-white text-indigo-800 border-indigo-200',
    activeBadgeSelected: 'bg-indigo-800 text-indigo-50 border-indigo-600',
  },
  logistics: {
    idle: 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200',
    active: 'bg-slate-800 text-white border-slate-900 shadow-sm',
    dot: 'bg-slate-500',
    activeBadge: 'bg-white text-slate-700 border-slate-300',
    activeBadgeSelected: 'bg-slate-900 text-slate-100 border-slate-700',
  },
};

const LOS_BADGE_CLASS: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  C: 'bg-amber-50 text-amber-700 border-amber-200',
  D: 'bg-amber-50 text-amber-700 border-amber-200',
  E: 'bg-rose-50 text-rose-700 border-rose-200',
  F: 'bg-rose-50 text-rose-700 border-rose-200',
  '-': 'bg-slate-100 text-slate-500 border-slate-200',
};

const ARM_SHORT: Record<string, string> = {
  north: 'U',
  east: 'T',
  south: 'S',
  west: 'B',
};

const ARM_FULL: Record<string, string> = {
  north: 'Utara',
  east: 'Timur',
  south: 'Selatan',
  west: 'Barat',
};

function MixBar({ motor, car, heavy }: { motor: number; car: number; heavy: number }) {
  const total = motor + car + heavy;
  if (total === 0) return <div className="w-full h-1 rounded-full bg-slate-100 mt-1.5" />;
  return (
    <div className="w-full h-1 rounded-full bg-slate-100 overflow-hidden flex mt-1.5">
      <div className="bg-amber-500 h-full" style={{ width: `${(motor / total) * 100}%` }} />
      <div className="bg-slate-800 h-full" style={{ width: `${(car / total) * 100}%` }} />
      <div className="bg-teal-600 h-full" style={{ width: `${(heavy / total) * 100}%` }} />
    </div>
  );
}

export const TelemetryStrip: React.FC<TelemetryStripProps> = ({
  stats,
  signal,
  armNames,
  compiledTopology,
  focusedArchetype = null,
  onSelectArchetype,
}) => {
  const [showDetailTable, setShowDetailTable] = useState(false);
  const hasExitedData = stats.totalExitedAllTime > 0;
  const losEval = evaluateLos(stats.avgWaitTime, stats.totalExitedAllTime);
  const los = {
    grade: losEval.grade,
    label: losEval.fullText,
    className: LOS_BADGE_CLASS[losEval.grade] ?? LOS_BADGE_CLASS['-'],
  };

  const phaseCount = signal.multiPhase?.phaseCount ?? 4;
  const activePhaseLabel = signal.multiPhase?.activePhaseLabel ?? ARM_FULL[signal.activeArm] ?? signal.activeArm;

  const armEntries =
    compiledTopology && compiledTopology.armOrder.length > 0
      ? compiledTopology.armOrder.map((id, idx) => ({
        id,
        short: ARM_SHORT[id] ?? `L${idx + 1}`,
        full: compiledTopology.armsById[id]?.def.label || ARM_FULL[id] || `Lengan ${idx + 1}`,
        count: stats.queueByArmId?.[id] ?? (stats.queueByArm[id as ArmId] ?? 0),
      }))
      : (['north', 'east', 'south', 'west'] as const).map((arm) => ({
        id: arm,
        short: ARM_SHORT[arm],
        full: armNames?.[arm]?.trim() ? `${ARM_FULL[arm]}: ${armNames[arm]}` : ARM_FULL[arm],
        count: stats.queueByArm[arm],
      }));

  const isDynamicTime = stats.environment && stats.environment.timeMode !== 'static';
  const displayedThroughput = isDynamicTime && stats.rollingThroughputPerHour !== undefined
    ? stats.rollingThroughputPerHour
    : stats.throughputPerHour;

  return (
    <div className="flex flex-col gap-2 shrink-0">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
        {/* Card 1: Per-Phase Exited */}
        <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 truncate">
              <img src="/assets/ui/icon-throughput.svg" alt="" className="w-3.5 h-3.5 opacity-75 shrink-0" />
              <span className="truncate">Fase ({activePhaseLabel})</span>
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
              1 FASE
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-mono tabular-nums font-bold text-slate-900">
              {stats.currentPhaseExited.total}
            </span>
            <span className="text-[11px] text-slate-500">kendaraan</span>
          </div>
          <MixBar
            motor={stats.currentPhaseExited.motor}
            car={stats.currentPhaseExited.car}
            heavy={stats.currentPhaseExited.heavy}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-600">
            <span>Motor <strong className="text-slate-900">{stats.currentPhaseExited.motor}</strong></span>
            <span>Mobil <strong className="text-slate-900">{stats.currentPhaseExited.car}</strong></span>
            <span>Berat <strong className="text-slate-900">{stats.currentPhaseExited.heavy}</strong></span>
          </div>
        </div>

        {/* Card 2: Per-Cycle Exited + Smart AI Activity Counters */}
        <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 truncate">
              <img src="/assets/ui/icon-cycle.svg" alt="" className="w-3.5 h-3.5 opacity-75 shrink-0" />
              Siklus #{signal.cycleNumber}
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
              {phaseCount} FASE
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-mono tabular-nums font-bold text-slate-900">
              {stats.currentCycleExited.total}
            </span>
            <span className="text-[11px] text-slate-500">keluar</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] font-mono tabular-nums">
            <span
              className="px-1 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200"
              title="Jumlah mobil menyalip / pindah lajur (MOBIL)"
            >
              Salip:{stats.carOvertakeCount ?? 0}
            </span>
            <span
              className="px-1 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"
              title="Manuver menyalip mengambil jalur lawan (jalan tanpa median)"
            >
              Lawan:{stats.oncomingOvertakeCount ?? 0}
            </span>
            <span
              className="px-1 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
              title="Konflik prioritas & manuver mengalah (Yield) di simpang"
            >
              Yield:{stats.yieldConflictCount ?? 0}
            </span>
            <span
              className="px-1 py-0.5 rounded bg-yellow-50 text-yellow-800 border border-yellow-300"
              title="Kendaraan menahan diri di luar kotak Yellow Box Junction"
            >
              YBox:{stats.yellowBoxHoldCount ?? 0}
            </span>
            <span
              className="px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
              title="Manuver melewati marka tengah / bahu jalan"
            >
              Marka:{stats.markingCrossCount ?? 0}
            </span>
            {(stats.reverseRecoveryCount ?? 0) > 0 && (
              <span
                className="px-1 py-0.5 rounded bg-orange-50 text-orange-800 border border-orange-200"
                title="Manuver mundur pemecah kebuntuan"
              >
                Mundur:{stats.reverseRecoveryCount}
              </span>
            )}
          </div>
          <MixBar
            motor={stats.currentCycleExited.motor}
            car={stats.currentCycleExited.car}
            heavy={stats.currentCycleExited.heavy}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-600">
            <span>Motor <strong className="text-slate-900">{stats.currentCycleExited.motor}</strong></span>
            <span>Mobil <strong className="text-slate-900">{stats.currentCycleExited.car}</strong></span>
            <span>Berat <strong className="text-slate-900">{stats.currentCycleExited.heavy}</strong></span>
          </div>
        </div>

        {/* Card 3: Active Queue (Dynamic 3-5 arms!) */}
        <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <img src="/assets/ui/icon-queue.svg" alt="" className="w-3.5 h-3.5 opacity-75 shrink-0" />
              Antrean Aktif
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${los.className}`}
                title={
                  hasExitedData
                    ? `Level of Service (PKJI/HCM): ${los.grade} — ${los.label} (rata-rata tunggu ${stats.avgWaitTime.toFixed(1)}s)`
                    : 'Level of Service (PKJI/HCM): Menunggu data kendaraan keluar'
                }
              >
                {hasExitedData ? `LOS ${los.grade}` : 'LOS —'}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-slate-500">
                ALL: <strong className="text-slate-800">{stats.totalExitedAllTime}</strong>
              </span>
            </div>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-mono tabular-nums font-bold text-slate-900">
                {stats.activeQueueCount}
              </span>
              <span className="text-[11px] text-slate-500">tertahan</span>
              {stats.boxStuckCount > 0 && (
                <span
                  className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"
                  title="Kendaraan terjebak di tengah kotak simpang"
                >
                  {stats.boxStuckCount} terjebak
                </span>
              )}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 text-right">
              <span>Wait: <strong className="text-slate-800">{stats.avgWaitTime.toFixed(1)}s</strong></span>
              <span className="mx-1 text-slate-300">|</span>
              <span title={isDynamicTime ? 'Throughput 60 detik terakhir (rolling)' : 'Proyeksi throughput kumulatif'}>
                <strong className="text-slate-800">{displayedThroughput}</strong>/jam
              </span>
            </div>
          </div>
          <div
            className="mt-2 grid gap-1 text-[11px] font-mono tabular-nums"
            style={{ gridTemplateColumns: `repeat(${Math.min(5, Math.max(3, armEntries.length))}, minmax(0, 1fr))` }}
          >
            {armEntries.map((entry) => (
              <div
                key={entry.id}
                title={entry.full}
                className="px-1 py-0.5 rounded bg-slate-50 border border-slate-200 text-center truncate"
              >
                <span className="text-slate-400">{entry.short}:</span>{' '}
                <strong className="text-slate-800">{entry.count}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Card 4: Recent History */}
        <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-start gap-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Riwayat Periode
            </span>
            <span className="text-[9px] font-mono text-slate-400">FASE / SIKLUS</span>
          </div>
          {stats.cycleHistory.length === 0 && stats.phaseHistory.length === 0 ? (
            <div className="text-[11px] text-slate-400 py-2">
              Menunggu 1 fase lampu selesai...
            </div>
          ) : (
            <div className="space-y-1 max-h-[120px] overflow-y-auto pr-1">
              {stats.cycleHistory.slice(0, 2).map((c) => (
                <div
                  key={`c-${c.cycleNumber}`}
                  className="flex items-center justify-between text-[11px] font-mono tabular-nums bg-slate-900 text-white px-2 py-0.5 rounded"
                >
                  <span>Siklus #{c.cycleNumber} ({c.totalDuration}s)</span>
                  <span className="font-semibold">{c.exitedTotal} keluar</span>
                </div>
              ))}
              {stats.phaseHistory.slice(0, 4).map((p) => (
                <div
                  key={`p-${p.phaseIndex}`}
                  className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded gap-2"
                >
                  <span className="truncate">
                    #{p.cycleNumber} {p.phaseLabel || ARM_FULL[p.arm]} ({p.greenDuration}s)
                  </span>
                  <span className="font-semibold shrink-0">
                    {p.exitedTotal}{' '}
                    <span className="text-slate-400 font-normal">
                      ({p.exitedMotor}M/{p.exitedCar}Mbl/{p.exitedHeavy}B)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      {stats.driverStats && (
        <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 flex flex-col gap-2 text-[10px] font-mono tabular-nums">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
                Profil Pengendara
              </span>
              {focusedArchetype && onSelectArchetype && (
                <button
                  type="button"
                  onClick={() => onSelectArchetype(null)}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 font-sans text-[10px] font-medium transition-colors duration-100"
                  title="Hapus filter sorotan tipe pengendara"
                >
                  <X className="w-2.5 h-2.5" />
                  Reset
                </button>
              )}
              <div
                role="group"
                aria-label="Filter sorotan tipe pengendara"
                className="flex flex-wrap items-center gap-1.5"
              >
                {ARCHETYPE_ORDER.map((arch) => {
                  const st = stats.driverStats?.[arch];
                  if (!st) return null;
                  const meta = ARCHETYPE_TRAITS[arch];
                  const style = ARCHETYPE_CHIP_STYLES[arch];
                  const isFocused = focusedArchetype === arch;
                  const isDimmed = focusedArchetype !== null && !isFocused;
                  return (
                    <button
                      key={arch}
                      type="button"
                      aria-pressed={isFocused}
                      onClick={() => onSelectArchetype?.(isFocused ? null : arch)}
                      title={`${meta.label}: ${st.activeCount} aktif · ${st.exited} keluar · tunggu ${st.avgWait.toFixed(1)}s · salip ${st.overtakes} · marka ${st.markingCrosses} (Klik untuk sorot di peta)`}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors duration-100 ${
                        isFocused ? style.active : style.idle
                      } ${isDimmed ? 'opacity-50 hover:opacity-100' : ''}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isFocused ? 'bg-white' : style.dot
                        }`}
                      />
                      <strong>{meta.shortBadge}</strong>
                      <span
                        className={`px-1 py-px rounded border text-[9px] leading-none ${
                          isFocused ? style.activeBadgeSelected : style.activeBadge
                        }`}
                      >
                        {st.activeCount} aktif
                      </span>
                      <span>{st.exited}</span>
                      <span className="opacity-80">({st.avgWait.toFixed(1)}s)</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              aria-expanded={showDetailTable}
              onClick={() => setShowDetailTable((v) => !v)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-sans text-[10px] font-medium shrink-0 transition-colors duration-100 ${
                showDetailTable
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>Detail 6 Tipe</span>
              {showDetailTable ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>

          {showDetailTable && (
            <div className="border-t border-slate-200 pt-2 overflow-x-auto">
              <table className="w-full text-left border-collapse text-[10px] font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-sans text-[9px] uppercase tracking-wider">
                    <th className="py-1 pr-2 font-semibold">Arketipe</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Aktif</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Keluar</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Tunggu</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Kecepatan</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Salip</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Marka</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Rem Keras</th>
                    <th className="py-1 px-1.5 text-right font-semibold">Yield / H-Shake</th>
                    <th className="py-1 pl-1.5 text-right font-semibold">Frustrasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ARCHETYPE_ORDER.map((arch) => {
                    const st = stats.driverStats?.[arch];
                    if (!st) return null;
                    const meta = ARCHETYPE_TRAITS[arch];
                    const style = ARCHETYPE_CHIP_STYLES[arch];
                    const isFocused = focusedArchetype === arch;
                    const avgKmh = ((st.avgSpeed ?? 0) * 3.6).toFixed(0);
                    const frustPct = Math.round((st.avgFrustration ?? 0) * 100);
                    return (
                      <tr
                        key={arch}
                        onClick={() => onSelectArchetype?.(isFocused ? null : arch)}
                        className={`cursor-pointer transition-colors duration-100 ${
                          isFocused ? 'bg-slate-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-1 pr-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                            <strong className="text-slate-900">{meta.shortBadge}</strong>
                            <span className="font-sans text-slate-600">{meta.label}</span>
                          </span>
                        </td>
                        <td className="py-1 px-1.5 text-right font-semibold text-slate-900">
                          {st.activeCount}
                        </td>
                        <td className="py-1 px-1.5 text-right text-slate-700">{st.exited}</td>
                        <td className="py-1 px-1.5 text-right text-slate-700">
                          {st.avgWait.toFixed(1)}s
                        </td>
                        <td className="py-1 px-1.5 text-right text-slate-700">
                          {avgKmh} km/h
                        </td>
                        <td className="py-1 px-1.5 text-right text-slate-700">{st.overtakes}</td>
                        <td className="py-1 px-1.5 text-right text-slate-700">
                          {st.markingCrosses}
                        </td>
                        <td className="py-1 px-1.5 text-right text-slate-700">
                          {st.hardBrakes ?? 0}
                        </td>
                        <td className="py-1 px-1.5 text-right text-slate-700">
                          {st.yieldsGiven ?? 0} / {st.handshakes ?? 0}
                        </td>
                        <td
                          className={`py-1 pl-1.5 text-right font-semibold ${
                            frustPct >= 60
                              ? 'text-rose-700'
                              : frustPct >= 35
                              ? 'text-amber-700'
                              : 'text-slate-700'
                          }`}
                        >
                          {frustPct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
