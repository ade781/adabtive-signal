import React from 'react';
import { PlusCircle, CornerUpLeft, Columns, Maximize2, Bike, RotateCcw, ArrowRightLeft, MapPin } from 'lucide-react';
import { STATIC_SAMPLING_BLUEPRINTS, StaticSamplingBlueprint } from '../engine/samplingBlueprints';
import { DrawModuleKind } from './drawStore';

interface DrawPaletteProps {
  activeTopologyId: string;
  selectedArmId: string | null;
  armCount: number;
  onApplyModule: (kind: DrawModuleKind) => void;
  onLoadBlueprint: (bp: StaticSamplingBlueprint) => void;
}

const MODULES: {
  kind: DrawModuleKind;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  accent: string;
}[] = [
  {
    kind: 'slip-lane',
    label: 'Pulau + Slip Lane',
    desc: 'Jalur khusus belok kiri jalan terus (ala Giwangan)',
    icon: CornerUpLeft,
    badge: 'LTOR',
    accent: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  },
  {
    kind: 'add-arm',
    label: 'Tambah Lengan',
    desc: 'Seret ke sudut bebas (3–5 lengan)',
    icon: PlusCircle,
    badge: '3–5',
    accent: 'text-sky-700 bg-sky-50 border-sky-200',
  },
  {
    kind: 'median',
    label: 'Median Fisik',
    desc: 'Toggle pemisah arah (off = boleh salip jalur lawan)',
    icon: Columns,
    badge: 'MED',
    accent: 'text-slate-700 bg-slate-100 border-slate-200',
  },
  {
    kind: 'flare',
    label: 'Pelebaran Belokan',
    desc: 'Perlebar mulut & radius tikungan sisi kiri',
    icon: Maximize2,
    badge: 'FLARE',
    accent: 'text-violet-700 bg-violet-50 border-violet-200',
  },
  {
    kind: 'bottleneck',
    label: 'Asimetri / Bottleneck',
    desc: 'Buat lajur masuk > lajur keluar',
    icon: ArrowRightLeft,
    badge: 'ASYM',
    accent: 'text-amber-700 bg-amber-50 border-amber-200',
  },
  {
    kind: 'uturn',
    label: 'Bukaan U-Turn',
    desc: 'Putar balik sebelum garis henti',
    icon: RotateCcw,
    badge: 'U-TURN',
    accent: 'text-orange-700 bg-orange-50 border-orange-200',
  },
  {
    kind: 'rhk',
    label: 'Kotak Motor (RHK)',
    desc: 'Ruang henti khusus sepeda motor',
    icon: Bike,
    badge: 'RHK',
    accent: 'text-rose-700 bg-rose-50 border-rose-200',
  },
];

export const DrawPalette: React.FC<DrawPaletteProps> = ({
  activeTopologyId,
  selectedArmId,
  armCount,
  onApplyModule,
  onLoadBlueprint,
}) => {
  const fieldLocations = STATIC_SAMPLING_BLUEPRINTS.filter((b) => b.category === 'field');
  const templates = STATIC_SAMPLING_BLUEPRINTS.filter((b) => b.category === 'template');

  return (
    <aside className="w-full lg:w-[270px] lg:min-h-0 bg-white border border-slate-200 rounded-lg flex flex-col shrink-0 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Palet Modular (Drag & Drop)
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Seret modul ke lengan di kanvas atau klik untuk menerapkan ke lengan terpilih.
        </p>
      </div>

      <div className="p-3 space-y-4 overflow-y-auto flex-1">
        {/* Draggable Modular Road Parts */}
        <div className="space-y-1.5">
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            const disabled = mod.kind === 'add-arm' && armCount >= 5;
            return (
              <div
                key={mod.kind}
                draggable={!disabled}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-draw-module', mod.kind);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => !disabled && onApplyModule(mod.kind)}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onKeyDown={(e) => {
                  if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onApplyModule(mod.kind);
                  }
                }}
                title={
                  disabled
                    ? 'Maksimal 5 lengan tercapai'
                    : selectedArmId
                    ? `Seret ke kanvas atau klik untuk menerapkan ke lengan terpilih`
                    : `Seret modul ${mod.label} ke kanvas`
                }
                className={`p-2 rounded-md border flex items-start gap-2.5 select-none transition-colors duration-100 ${
                  disabled
                    ? 'opacity-45 cursor-not-allowed bg-slate-50 border-slate-200'
                    : 'cursor-grab active:cursor-grabbing bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <div className={`p-1.5 rounded border shrink-0 ${mod.accent}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold text-slate-800 leading-tight">{mod.label}</span>
                    <span className="text-[9px] font-mono font-bold text-slate-400">{mod.badge}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{mod.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 6 Field Sampling Blueprints (including Simpang Giwangan equally) */}
        <div className="pt-3 border-t border-slate-200 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-emerald-600" />
              Lokasi Lapangan RI ({fieldLocations.length})
            </span>
            <span className="text-[9px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              STATIC
            </span>
          </div>
          {fieldLocations.map((bp) => {
            const active = activeTopologyId === bp.id;
            return (
              <button
                key={bp.id}
                type="button"
                onClick={() => onLoadBlueprint(bp)}
                className={`w-full px-2.5 py-1.5 rounded-md border text-left transition-colors duration-100 ${
                  active
                    ? 'bg-emerald-900 text-white border-emerald-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-[11px] font-semibold leading-tight">{bp.label}</div>
                <div className={`text-[10px] mt-0.5 truncate ${active ? 'text-emerald-200' : 'text-slate-500'}`}>
                  {bp.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {/* Multi-Arm Templates (No. 6) */}
        <div className="pt-3 border-t border-slate-200 space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-700 block">Template Bentuk Simpang</span>
          {templates.map((bp) => {
            const active = activeTopologyId === bp.id;
            return (
              <button
                key={bp.id}
                type="button"
                onClick={() => onLoadBlueprint(bp)}
                className={`w-full px-2.5 py-1.5 rounded-md border text-left transition-colors duration-100 ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-[11px] font-semibold leading-tight">{bp.label}</div>
                <div className={`text-[10px] mt-0.5 truncate ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                  {bp.subtitle}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
