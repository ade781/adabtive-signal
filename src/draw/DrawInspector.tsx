import React from 'react';
import { Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ArmDef, IntersectionTopology, SignalPhasePreset } from '../engine/topologyTypes';
import { TopologyValidation } from './drawStore';

interface DrawInspectorProps {
  topology: IntersectionTopology;
  selectedArmId: string | null;
  validation: TopologyValidation;
  onSelectArm: (armId: string) => void;
  onUpdateTopologyMeta: (patch: Partial<IntersectionTopology>) => void;
  onChangePhasePreset: (preset: SignalPhasePreset) => void;
  onUpdateArm: (armId: string, patch: Partial<ArmDef>) => void;
  onRemoveArm: (armId: string) => void;
}

const PHASE_OPTIONS: { id: SignalPhasePreset; label: string; desc: string }[] = [
  { id: '4-phase-split', label: 'Split per Lengan', desc: '1 lengan hijau bergantian (aman untuk 3–5 lengan)' },
  { id: '2-phase-simultaneous', label: '2-Fase Simultan', desc: 'Arah berlawanan hijau bareng (belok kanan yield lurus)' },
  { id: '3-phase', label: '3-Fase', desc: 'Cocok untuk pertigaan atau 1 koridor utama simultan' },
  { id: '4-phase-protected-right', label: '4-Fase + Panah Kanan', desc: 'Fase khusus belok kanan terlindungi (ala simpang besar)' },
];

export const DrawInspector: React.FC<DrawInspectorProps> = ({
  topology,
  selectedArmId,
  validation,
  onSelectArm,
  onUpdateTopologyMeta,
  onChangePhasePreset,
  onUpdateArm,
  onRemoveArm,
}) => {
  const selectedArm = topology.arms.find((a) => a.id === selectedArmId) ?? topology.arms[0];

  const handleLaneWidthChange = (side: 'in' | 'out', idx: number, val: number) => {
    if (!selectedArm) return;
    const arr = side === 'in' ? [...selectedArm.inLaneWidths] : [...selectedArm.outLaneWidths];
    arr[idx] = val;
    onUpdateArm(selectedArm.id, side === 'in' ? { inLaneWidths: arr } : { outLaneWidths: arr });
  };

  return (
    <aside className="w-full lg:w-[340px] lg:min-h-0 bg-white border border-slate-200 rounded-lg flex flex-col shrink-0 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Inspektor Geometri & Fase
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
          {topology.arms.length} Lengan
        </span>
      </div>

      <div className="p-3.5 space-y-4 overflow-y-auto flex-1">
        {/* Validation Banner */}
        {validation.errors.length > 0 ? (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-[11px] text-rose-800 space-y-1">
            <div className="font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Geometri Perlu Diperbaiki
            </div>
            {validation.errors.map((err, i) => (
              <div key={i} className="text-[10px]">• {err}</div>
            ))}
          </div>
        ) : (
          <div className="p-2 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
            <span>Topologi valid & siap disimulasikan ({topology.phases.length} fase sinyal).</span>
          </div>
        )}

        {/* Map Name & Global Options */}
        <div className="space-y-2">
          <label className="block">
            <span className="text-[11px] font-medium text-slate-600 block mb-1">Nama Peta Simpang</span>
            <input
              type="text"
              value={topology.name}
              onChange={(e) => onUpdateTopologyMeta({ name: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-500 transition-colors duration-100"
            />
          </label>

          <button
            type="button"
            role="switch"
            aria-checked={topology.yellowBoxEnabled}
            onClick={() => onUpdateTopologyMeta({ yellowBoxEnabled: !topology.yellowBoxEnabled })}
            className="w-full flex items-center justify-between p-2 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-colors duration-100"
          >
            <div>
              <div className="text-xs font-medium text-slate-800">Marka Yellow Box Junction</div>
              <div className="text-[10px] text-slate-500">Kendaraan pintar menahan diri saat jalur keluar penuh</div>
            </div>
            <span
              className={`inline-flex h-4 w-7 items-center rounded-full border transition-colors duration-100 ${
                topology.yellowBoxEnabled ? 'bg-amber-500 border-amber-600' : 'bg-slate-200 border-slate-300'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white transform transition-transform duration-100 ${
                  topology.yellowBoxEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </div>

        {/* Signal Phase Plan Preset (No. 7) */}
        <div className="pt-3 border-t border-slate-200 space-y-1.5">
          <span className="text-xs font-semibold text-slate-700 block">Skema Fase Lampu Lalu Lintas</span>
          <div className="grid grid-cols-2 gap-1.5">
            {PHASE_OPTIONS.map((opt) => {
              const disabled =
                (opt.id === '2-phase-simultaneous' || opt.id === '4-phase-protected-right') &&
                topology.arms.length !== 4;
              const active = topology.phasePreset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChangePhasePreset(opt.id)}
                  title={disabled ? 'Khusus untuk simpang 4 lengan' : opt.desc}
                  className={`p-1.5 rounded border text-left transition-colors duration-100 ${
                    disabled
                      ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400'
                      : active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-[11px] font-semibold leading-tight">{opt.label}</div>
                </button>
              );
            })}
          </div>
          <div className="p-2 rounded bg-slate-50 border border-slate-200 space-y-1">
            {topology.phases.map((ph, idx) => (
              <div key={ph.id} className="flex items-center justify-between text-[10px] font-mono text-slate-600">
                <span className="truncate">
                  F{idx + 1}: {ph.label}
                </span>
                <span className="text-slate-900 font-semibold shrink-0 ml-1">{ph.baseGreen}s</span>
              </div>
            ))}
          </div>
        </div>

        {/* Arm Selector Tabs */}
        <div className="pt-3 border-t border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Properti Lengan Jalan</span>
            {selectedArm && topology.arms.length > 3 && (
              <button
                type="button"
                onClick={() => onRemoveArm(selectedArm.id)}
                className="inline-flex items-center gap-1 text-[10px] text-rose-600 hover:text-rose-800 font-medium"
              >
                <Trash2 className="w-3 h-3" /> Hapus Lengan
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {topology.arms.map((arm, idx) => (
              <button
                key={arm.id}
                type="button"
                onClick={() => onSelectArm(arm.id)}
                className={`px-2 py-1 rounded text-[11px] font-mono font-medium border transition-colors duration-100 ${
                  selectedArm?.id === arm.id
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                #{idx + 1} {arm.angleDeg}°
              </button>
            ))}
          </div>

          {selectedArm && (
            <div className="space-y-3 pt-1">
              <label className="block">
                <span className="text-[10px] font-medium text-slate-500 block mb-0.5">Nama Ruas Lengan</span>
                <input
                  type="text"
                  value={selectedArm.label}
                  onChange={(e) => onUpdateArm(selectedArm.id, { label: e.target.value })}
                  className="w-full px-2 py-1 text-xs rounded border border-slate-200 bg-white text-slate-800 focus:outline-none focus:border-slate-500 transition-colors duration-100"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                    <span>Sudut</span>
                    <strong className="font-mono">{selectedArm.angleDeg}°</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={selectedArm.angleDeg}
                    onChange={(e) => onUpdateArm(selectedArm.id, { angleDeg: Number(e.target.value) })}
                    className="w-full h-1.5 accent-sky-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                    <span>Panjang</span>
                    <strong className="font-mono">{selectedArm.length}m</strong>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={180}
                    step={5}
                    value={selectedArm.length}
                    onChange={(e) => onUpdateArm(selectedArm.id, { length: Number(e.target.value) })}
                    className="w-full h-1.5 accent-slate-800"
                  />
                </div>
              </div>

              {/* Asymmetric Inbound vs Outbound Lane Counts (No. 1 & No. 6) */}
              <div className="grid grid-cols-2 gap-2 p-2 rounded bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-[10px] font-semibold text-emerald-700 block mb-1">
                    Lajur Masuk ({selectedArm.inLanes})
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onUpdateArm(selectedArm.id, { inLanes: n })}
                        className={`py-1 text-[11px] font-mono rounded border transition-colors duration-100 ${
                          selectedArm.inLanes === n
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-amber-700 block mb-1">
                    Lajur Keluar ({selectedArm.outLanes})
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => onUpdateArm(selectedArm.id, { outLanes: n })}
                        className={`py-1 text-[11px] font-mono rounded border transition-colors duration-100 ${
                          selectedArm.outLanes === n
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Per-Lane Widths (Asymmetric individual lane widths!) */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold text-slate-600 block">
                  Lebar Individual Lajur Masuk (m)
                </span>
                <div className="space-y-1">
                  {selectedArm.inLaneWidths.map((w, idx) => (
                    <div key={`in-${idx}`} className="flex items-center gap-2 text-[10px]">
                      <span className="font-mono text-slate-500 w-12">L{idx + 1}</span>
                      <input
                        type="range"
                        min={2.6}
                        max={4.6}
                        step={0.1}
                        value={w}
                        onChange={(e) => handleLaneWidthChange('in', idx, Number(e.target.value))}
                        className="flex-1 h-1.5 accent-emerald-600"
                      />
                      <span className="font-mono font-semibold text-slate-800 w-9 text-right">{w.toFixed(1)}m</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                    <span>Median Fisik</span>
                    <strong className="font-mono">{selectedArm.medianWidth > 0 ? `${selectedArm.medianWidth}m` : 'Tanpa'}</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3.0}
                    step={0.2}
                    value={selectedArm.medianWidth}
                    onChange={(e) => onUpdateArm(selectedArm.id, { medianWidth: Number(e.target.value) })}
                    className="w-full h-1.5 accent-slate-800"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-600 mb-0.5">
                    <span>Pelebaran / Flare</span>
                    <strong className="font-mono">+{selectedArm.curbFlareLeft ?? 0}m</strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={3.5}
                    step={0.2}
                    value={selectedArm.curbFlareLeft ?? 0}
                    onChange={(e) => onUpdateArm(selectedArm.id, { curbFlareLeft: Number(e.target.value) })}
                    className="w-full h-1.5 accent-violet-600"
                  />
                </div>
              </div>

              {/* Slip Lane (Belok Kiri Jalan Terus + Pulau Segitiga) */}
              <div className="p-2.5 rounded-md border border-emerald-200 bg-emerald-50/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-emerald-900">
                    Jalur Khusus Belok Kiri (Slip Lane)
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedArm.slipLane?.enabled)}
                    onChange={(e) =>
                      onUpdateArm(selectedArm.id, {
                        leftTurnOnRed: e.target.checked ? true : selectedArm.leftTurnOnRed,
                        slipLane: {
                          enabled: e.target.checked,
                          width: selectedArm.slipLane?.width ?? 3.5,
                          islandSetback: selectedArm.slipLane?.islandSetback ?? 18,
                          yieldControl: selectedArm.slipLane?.yieldControl ?? 'yield',
                        },
                      })
                    }
                    className="accent-emerald-600"
                  />
                </div>
                {selectedArm.slipLane?.enabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="flex justify-between text-[10px] text-emerald-800">
                        <span>Lebar Kanal</span>
                        <strong className="font-mono">{selectedArm.slipLane.width.toFixed(1)}m</strong>
                      </div>
                      <input
                        type="range"
                        min={2.8}
                        max={4.5}
                        step={0.1}
                        value={selectedArm.slipLane.width}
                        onChange={(e) =>
                          onUpdateArm(selectedArm.id, {
                            slipLane: { ...selectedArm.slipLane!, width: Number(e.target.value) },
                          })
                        }
                        className="w-full h-1.5 accent-emerald-600"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-emerald-800">
                        <span>Panjang Pulau</span>
                        <strong className="font-mono">{selectedArm.slipLane.islandSetback}m</strong>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={30}
                        step={1}
                        value={selectedArm.slipLane.islandSetback}
                        onChange={(e) =>
                          onUpdateArm(selectedArm.id, {
                            slipLane: { ...selectedArm.slipLane!, islandSetback: Number(e.target.value) },
                          })
                        }
                        className="w-full h-1.5 accent-violet-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Per-Arm Flags & Demand */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <label className="flex items-center gap-1.5 p-1.5 rounded border border-slate-200 bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedArm.leftTurnOnRed}
                    onChange={(e) => onUpdateArm(selectedArm.id, { leftTurnOnRed: e.target.checked })}
                    className="accent-emerald-600"
                  />
                  <span>Belok Kiri Langsung</span>
                </label>
                <label className="flex items-center gap-1.5 p-1.5 rounded border border-slate-200 bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedArm.motorBoxEnabled}
                    onChange={(e) => onUpdateArm(selectedArm.id, { motorBoxEnabled: e.target.checked })}
                    className="accent-rose-600"
                  />
                  <span>Kotak Motor RHK</span>
                </label>
                <label className="flex items-center gap-1.5 p-1.5 rounded border border-slate-200 bg-slate-50 cursor-pointer col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedArm.uTurnBay?.enabled)}
                    onChange={(e) =>
                      onUpdateArm(selectedArm.id, {
                        uTurnBay: {
                          enabled: e.target.checked,
                          distanceBeforeStop: selectedArm.uTurnBay?.distanceBeforeStop ?? 32,
                        },
                      })
                    }
                    className="accent-orange-600"
                  />
                  <span>Bukaan Putar Balik (U-Turn) sebelum simpang</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>Bobot Arus</span>
                    <strong className="font-mono">{selectedArm.demandWeight.toFixed(1)}x</strong>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={2.5}
                    step={0.1}
                    value={selectedArm.demandWeight}
                    onChange={(e) => onUpdateArm(selectedArm.id, { demandWeight: Number(e.target.value) })}
                    className="w-full h-1.5 accent-slate-800"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>Hijau Dasar</span>
                    <strong className="font-mono">{selectedArm.baseGreenDuration ?? 22}s</strong>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={90}
                    step={1}
                    value={selectedArm.baseGreenDuration ?? 22}
                    onChange={(e) => onUpdateArm(selectedArm.id, { baseGreenDuration: Number(e.target.value) })}
                    className="w-full h-1.5 accent-emerald-600"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
