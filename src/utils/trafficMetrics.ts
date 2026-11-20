import { SignalPhasePreset } from '../engine/topologyTypes';

export interface LosEvaluation {
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | '-';
  label: string;
  fullText: string;
  colorClass: string;
}

/**
 * Unified PKJI / HCM Level of Service (LOS) evaluator shared by TelemetryStrip & Excel reportExporter.
 */
export function evaluateLos(avgWaitTime: number, totalExited: number): LosEvaluation {
  if (totalExited === 0) {
    return { grade: '-', label: 'LOS -', fullText: 'Belum ada data (0 kend keluar)', colorClass: 'text-slate-400' };
  }
  if (avgWaitTime <= 5) return { grade: 'A', label: 'LOS A', fullText: 'A (Sangat Baik)', colorClass: 'text-emerald-600' };
  if (avgWaitTime <= 15) return { grade: 'B', label: 'LOS B', fullText: 'B (Baik)', colorClass: 'text-emerald-600' };
  if (avgWaitTime <= 25) return { grade: 'C', label: 'LOS C', fullText: 'C (Cukup)', colorClass: 'text-amber-600' };
  if (avgWaitTime <= 40) return { grade: 'D', label: 'LOS D', fullText: 'D (Mendekati Jenuh)', colorClass: 'text-amber-700' };
  if (avgWaitTime <= 60) return { grade: 'E', label: 'LOS E', fullText: 'E (Jenuh)', colorClass: 'text-rose-600' };
  return { grade: 'F', label: 'LOS F', fullText: 'F (Sangat Jenuh / Macet)', colorClass: 'text-rose-700' };
}

export const PHASE_PRESET_LABELS: Record<SignalPhasePreset, string> = {
  '4-phase-split': '4-Fase Split',
  '2-phase-simultaneous': '2-Fase Serentak',
  '3-phase': '3-Fase',
  '4-phase-protected-right': '4-Fase + Panah Kanan',
  custom: 'Fase Custom',
};
