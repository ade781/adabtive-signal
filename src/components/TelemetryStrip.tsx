import React from 'react';
import { SignalState, SimStats } from '../engine/types';

interface TelemetryStripProps {
  stats: SimStats;
  signal: SignalState;
}

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
  if (total === 0) {
    return <div className="w-full h-1 rounded-full bg-slate-100 mt-1.5" />;
  }
  return (
    <div className="w-full h-1 rounded-full bg-slate-100 overflow-hidden flex mt-1.5">
      <div className="bg-amber-500 h-full" style={{ width: `${(motor / total) * 100}%` }} />
      <div className="bg-slate-800 h-full" style={{ width: `${(car / total) * 100}%` }} />
      <div className="bg-teal-600 h-full" style={{ width: `${(heavy / total) * 100}%` }} />
    </div>
  );
}

export const TelemetryStrip: React.FC<TelemetryStripProps> = ({ stats, signal }) => {
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
      {/* Card 1: Per-Phase Exited (1x Lampu Hijau Lengan Aktif) */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 truncate">
            <img src="/assets/ui/icon-throughput.svg" alt="" className="w-3.5 h-3.5 opacity-75 shrink-0" />
            Keluar Fase ({ARM_FULL[signal.activeArm]})
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
        <div className="mt-1.5 flex items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-600">
          <span>Motor <strong className="text-slate-900">{stats.currentPhaseExited.motor}</strong></span>
          <span>Mobil <strong className="text-slate-900">{stats.currentPhaseExited.car}</strong></span>
          <span>Berat <strong className="text-slate-900">{stats.currentPhaseExited.heavy}</strong></span>
        </div>
      </div>

      {/* Card 2: Per-Cycle Exited (1 Siklus Penuh 4 Lengan) */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 truncate">
            <img src="/assets/ui/icon-cycle.svg" alt="" className="w-3.5 h-3.5 opacity-75 shrink-0" />
            Keluar Siklus #{signal.cycleNumber}
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
            4 ARAH
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-mono tabular-nums font-bold text-slate-900">
            {stats.currentCycleExited.total}
          </span>
          <span className="text-[11px] text-slate-500">total keluar</span>
        </div>
        <MixBar
          motor={stats.currentCycleExited.motor}
          car={stats.currentCycleExited.car}
          heavy={stats.currentCycleExited.heavy}
        />
        <div className="mt-1.5 flex items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-600">
          <span>Motor <strong className="text-slate-900">{stats.currentCycleExited.motor}</strong></span>
          <span>Mobil <strong className="text-slate-900">{stats.currentCycleExited.car}</strong></span>
          <span>Berat <strong className="text-slate-900">{stats.currentCycleExited.heavy}</strong></span>
        </div>
      </div>

      {/* Card 3: Active Queue */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <img src="/assets/ui/icon-queue.svg" alt="" className="w-3.5 h-3.5 opacity-75 shrink-0" />
            Antrean Aktif
          </span>
          <span className="text-[10px] font-mono tabular-nums text-slate-500">
            ALL: <strong className="text-slate-800">{stats.totalExitedAllTime}</strong>
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-mono tabular-nums font-bold text-slate-900">
            {stats.activeQueueCount}
          </span>
          <span className="text-[11px] text-slate-500">tertahan</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-[11px] font-mono tabular-nums">
          {(['north', 'east', 'south', 'west'] as const).map((arm) => (
            <div key={arm} className="px-1 py-0.5 rounded bg-slate-50 border border-slate-200 text-center">
              <span className="text-slate-400">{ARM_SHORT[arm]}:</span>{' '}
              <strong className="text-slate-800">{stats.queueByArm[arm]}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Card 4: Recent History (Per Phase & Per Cycle) */}
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
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
          <div className="space-y-1 max-h-[82px] overflow-y-auto pr-1">
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
                className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded"
              >
                <span>
                  #{p.cycleNumber} {ARM_FULL[p.arm]} ({p.greenDuration}s)
                </span>
                <span className="font-semibold">
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
