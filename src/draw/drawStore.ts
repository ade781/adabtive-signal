import { buildSignalPhasesForTopology } from '../engine/topologyBuilder';
import { ArmDef, IntersectionTopology, SignalPhasePreset } from '../engine/topologyTypes';

export type DrawModuleKind =
  | 'add-arm'
  | 'slip-lane'
  | 'median'
  | 'flare'
  | 'rhk'
  | 'uturn'
  | 'bottleneck';

export interface TopologyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function normDeg(d: number): number {
  const m = Math.round(d) % 360;
  return m < 0 ? m + 360 : m;
}

export function rebuildPhases(topo: IntersectionTopology, preset?: SignalPhasePreset): IntersectionTopology {
  const nextPreset = preset ?? topo.phasePreset;
  const baseGreen = topo.defaultTraffic?.greenDuration ?? 22;
  const yellow = topo.defaultTraffic?.yellowDuration ?? 3;
  const allRed = topo.defaultTraffic?.allRedDuration ?? 1.5;
  return {
    ...topo,
    phasePreset: nextPreset,
    phases: buildSignalPhasesForTopology(topo.arms, nextPreset, yellow, allRed, baseGreen),
  };
}

export function findLargestGapAngle(arms: ArmDef[]): number {
  if (arms.length === 0) return 0;
  const sorted = [...arms].map((a) => normDeg(a.angleDeg)).sort((a, b) => a - b);
  let bestGap = -1;
  let bestMid = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = normDeg(a + gap * 0.5);
    }
  }
  return bestMid;
}

export function addArmToTopology(topo: IntersectionTopology, angleDeg?: number): { topo: IntersectionTopology; newArmId: string } {
  if (topo.arms.length >= 5) return { topo, newArmId: topo.arms[topo.arms.length - 1].id };
  const angle = angleDeg !== undefined ? normDeg(angleDeg) : findLargestGapAngle(topo.arms);
  const existingIds = new Set(topo.arms.map((a) => a.id));
  let idx = topo.arms.length + 1;
  while (existingIds.has(`arm-${idx}`)) idx++;
  const newArmId = `arm-${idx}`;

  const newArm: ArmDef = {
    id: newArmId,
    label: `Jl. Lengan ${idx}`,
    angleDeg: angle,
    length: 100,
    inLanes: 2,
    outLanes: 2,
    inLaneWidths: [3.4, 3.4],
    outLaneWidths: [3.4, 3.4],
    medianWidth: 0,
    curbRadiusLeft: 4.0,
    curbFlareLeft: 0,
    leftTurnOnRed: true,
    motorBoxEnabled: true,
    demandWeight: 1.0,
    baseGreenDuration: 22,
  };

  const nextArms = [...topo.arms, newArm];
  const nextPreset: SignalPhasePreset =
    nextArms.length === 5 && (topo.phasePreset === '2-phase-simultaneous' || topo.phasePreset === '4-phase-protected-right')
      ? '4-phase-split'
      : topo.phasePreset;

  return {
    topo: rebuildPhases({ ...topo, arms: nextArms }, nextPreset),
    newArmId,
  };
}

export function removeArmFromTopology(topo: IntersectionTopology, armId: string): IntersectionTopology {
  if (topo.arms.length <= 3) return topo;
  const nextArms = topo.arms.filter((a) => a.id !== armId);
  const nextPreset: SignalPhasePreset =
    nextArms.length === 3 && (topo.phasePreset === '2-phase-simultaneous' || topo.phasePreset === '4-phase-protected-right')
      ? '3-phase'
      : topo.phasePreset;
  return rebuildPhases({ ...topo, arms: nextArms }, nextPreset);
}

export function updateArmInTopology(
  topo: IntersectionTopology,
  armId: string,
  patch: Partial<ArmDef>
): IntersectionTopology {
  const nextArms = topo.arms.map((arm) => {
    if (arm.id !== armId) return arm;
    const merged: ArmDef = { ...arm, ...patch };
    // Keep lane width arrays synchronized with inLanes / outLanes
    const inCount = Math.max(1, Math.min(4, Math.round(merged.inLanes)));
    const outCount = Math.max(1, Math.min(4, Math.round(merged.outLanes)));
    const defaultInW = merged.inLaneWidths[merged.inLaneWidths.length - 1] ?? 3.5;
    const defaultOutW = merged.outLaneWidths[merged.outLaneWidths.length - 1] ?? 3.5;
    const inLaneWidths = Array.from({ length: inCount }, (_, i) =>
      Math.max(2.6, Math.min(4.6, +(merged.inLaneWidths[i] ?? defaultInW).toFixed(2)))
    );
    const outLaneWidths = Array.from({ length: outCount }, (_, i) =>
      Math.max(2.6, Math.min(4.6, +(merged.outLaneWidths[i] ?? defaultOutW).toFixed(2)))
    );
    return {
      ...merged,
      angleDeg: normDeg(merged.angleDeg),
      length: Math.max(40, Math.min(200, Math.round(merged.length))),
      inLanes: inCount,
      outLanes: outCount,
      inLaneWidths,
      outLaneWidths,
      medianWidth: Math.max(0, Math.min(3.5, +(merged.medianWidth || 0).toFixed(1))),
      curbRadiusLeft: Math.max(2.0, Math.min(12.0, +(merged.curbRadiusLeft || 2.5).toFixed(1))),
      curbFlareLeft: Math.max(0, Math.min(3.5, +(merged.curbFlareLeft || 0).toFixed(1))),
    };
  });

  return rebuildPhases({ ...topo, arms: nextArms });
}

export function applyModuleToArm(
  topo: IntersectionTopology,
  armId: string,
  moduleKind: DrawModuleKind,
  dropAngleDeg?: number
): { topo: IntersectionTopology; selectedArmId: string } {
  if (moduleKind === 'add-arm') {
    const res = addArmToTopology(topo, dropAngleDeg);
    return { topo: res.topo, selectedArmId: res.newArmId };
  }
  const target = topo.arms.find((a) => a.id === armId) ?? topo.arms[0];
  if (!target) return { topo, selectedArmId: armId };

  switch (moduleKind) {
    case 'slip-lane':
      return {
        topo: updateArmInTopology(topo, target.id, {
          leftTurnOnRed: true,
          slipLane: {
            enabled: !(target.slipLane?.enabled ?? false),
            width: target.slipLane?.width ?? 3.5,
            islandSetback: target.slipLane?.islandSetback ?? 18,
            yieldControl: target.slipLane?.yieldControl ?? 'yield',
          },
        }),
        selectedArmId: target.id,
      };
    case 'median':
      return {
        topo: updateArmInTopology(topo, target.id, {
          medianWidth: target.medianWidth > 0.05 ? 0 : 1.6,
        }),
        selectedArmId: target.id,
      };
    case 'flare':
      return {
        topo: updateArmInTopology(topo, target.id, {
          curbFlareLeft: (target.curbFlareLeft ?? 0) > 0.2 ? 0 : 1.5,
          curbRadiusLeft: (target.curbFlareLeft ?? 0) > 0.2 ? 3.0 : 7.0,
        }),
        selectedArmId: target.id,
      };
    case 'rhk':
      return {
        topo: updateArmInTopology(topo, target.id, {
          motorBoxEnabled: !target.motorBoxEnabled,
        }),
        selectedArmId: target.id,
      };
    case 'uturn':
      return {
        topo: updateArmInTopology(topo, target.id, {
          medianWidth: target.medianWidth > 0.05 ? target.medianWidth : 1.4,
          uTurnBay: {
            enabled: !(target.uTurnBay?.enabled ?? false),
            distanceBeforeStop: target.uTurnBay?.distanceBeforeStop ?? 32,
          },
        }),
        selectedArmId: target.id,
      };
    case 'bottleneck': {
      const nextIn = Math.min(4, Math.max(2, target.inLanes));
      const nextOut = Math.max(1, nextIn - 1);
      return {
        topo: updateArmInTopology(topo, target.id, {
          inLanes: nextIn,
          outLanes: nextOut,
        }),
        selectedArmId: target.id,
      };
    }
  }
}

export function validateTopology(topo: IntersectionTopology): TopologyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (topo.arms.length < 3 || topo.arms.length > 5) {
    errors.push(`Jumlah lengan harus 3–5 (saat ini ${topo.arms.length}).`);
  }

  const sorted = [...topo.arms].sort((a, b) => normDeg(a.angleDeg) - normDeg(b.angleDeg));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const diff = i + 1 < sorted.length ? normDeg(b.angleDeg) - normDeg(a.angleDeg) : normDeg(b.angleDeg) + 360 - normDeg(a.angleDeg);
    if (diff < 36) {
      errors.push(`Sudut antara "${a.label}" dan "${b.label}" terlalu sempit (${diff}° < 36°).`);
    } else if (diff < 50) {
      warnings.push(`Sudut tajam (${diff}°) antara "${a.label}" & "${b.label}" — kendaraan akan melambat tajam.`);
    }
  }

  for (const arm of topo.arms) {
    if (arm.inLanes !== arm.outLanes) {
      warnings.push(`"${arm.label}" memiliki bottleneck (${arm.inLanes} masuk → ${arm.outLanes} keluar).`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

const STORAGE_KEY = 'adaptive-signal:saved-draw-topologies:v1';

export function loadSavedTopologies(): IntersectionTopology[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTopologyLocal(topo: IntersectionTopology): IntersectionTopology[] {
  const existing = loadSavedTopologies().filter((t) => t.id !== topo.id);
  const next = [topo, ...existing].slice(0, 12);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return next;
}
