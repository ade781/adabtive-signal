import React from 'react';
import { CompiledTopology } from '../engine/topologyTypes';
import { ArmId, SignalState, SimStats } from '../engine/types';
import { evaluateLos } from '../utils/trafficMetrics';

interface TelemetryStripProps {
  stats: SimStats;
  signal: SignalState;
  armNames?: Partial<Record<ArmId, string>>;
  compiledTopology?: CompiledTopology;
}

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

export const TelemetryStrip: React.FC<TelemetryStripProps> = ({ stats, signal, armNames, compiledTopology }) => {
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
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-mono tabular-nums font-bold text-slate-900">
              {stats.currentCycleExited.total}
            </span>
            <span className="text-[11px] text-slate-500">keluar</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 text-[9px] font-mono">
            <span className="px-1 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200" title="Jumlah mobil menyalip / pindah lajur (MOBIL)">
              Salip:{stats.carOvertakeCount ?? 0}
            </span>
            <span className="px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200" title="Manuver melewati marka tengah / bahu jalan">
              Marka:{stats.markingCrossCount ?? 0}
            </span>
            {(stats.reverseRecoveryCount ?? 0) > 0 && (
              <span className="px-1 py-0.5 rounded bg-orange-50 text-orange-800 border border-orange-200" title="Manuver mundur pemecah kebuntuan">
                Mundur:{stats.reverseRecoveryCount}
              </span>
            )}
          </div>
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
  );
};
