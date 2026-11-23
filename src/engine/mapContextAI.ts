import type { SimVehicle } from './behaviors';
import { ARCHETYPE_ORDER, type DriverCognitiveTraits } from './driverIntelligence';
import type { CompiledArmGeometry } from './topologyTypes';
import type {
  DriverArchetype,
  DriverProfileMix,
  FrictionHeatmapSnapshot,
  SimConfig,
} from './types';

export type MapZoneKind = 'transit-bay' | 'campus-caution' | 'hospital-caution' | 'market-friction' | 'enforcement';

export interface MapBehavioralContext {
  id: string;
  label: string;
  /** Arms featuring bus shelters / terminal bays where BUS prefers outer lane & glides smoothly */
  busBayArms: readonly string[];
  /** Arms bordering campus/hospital/enforcement zones tempering recklessness */
  cautionArms: readonly string[];
  /** Arms bordering traditional market/riverside friction zones */
  marketArms: readonly string[];
  /** Multiplier on zone caution dampening for non-aggressive archetypes (0..0.18) */
  zoneCautionSpeedDrop: number;
  /** Multiplier on marking obedience inside enforcement/campus zones */
  zoneDisciplineBoost: number;
  /** Recommended driver profile mix matching this map's real-world Indonesian character */
  recommendedMix: DriverProfileMix;
}

export interface MapContextModifier {
  ltorSpeedCap: number;
  ltorGapMult: number;
  /** Subtle desired lateral offset adjustment (+ outer curb, - centerline peek) on undivided roads */
  undividedLateralShift: number;
  /** Speed factor multiplier from landmark zones (0.88..1.0) */
  zoneSpeedScale: number;
  /** Whether BUS should actively prefer outer curb lane on this arm */
  busCurbPull: boolean;
  /** Active contextual zone kind for telemetry/visual feedback */
  activeZone: MapZoneKind | null;
}

export const MAP_CONTEXTS: Readonly<Record<string, MapBehavioralContext>> = {
  'giwangan-yogya': {
    id: 'giwangan-yogya',
    label: 'Ringroad Giwangan · Terminal & Logistik',
    busBayArms: ['east', 'south', 'west'],
    cautionArms: ['north', 'east'], // Pos Brimob NE
    marketArms: [],
    zoneCautionSpeedDrop: 0.05,
    zoneDisciplineBoost: 0.06,
    recommendedMix: {
      cautiousPct: 24,
      normalPct: 48,
      aggressivePct: 28,
      courierShare: 0.44,
      preset: 'custom',
    },
  },
  'brimob-yogya': {
    id: 'brimob-yogya',
    label: 'Brimob Baciro · Komuter Motor & Mako',
    busBayArms: [],
    cautionArms: ['north', 'west'], // Mako Brimob NW
    marketArms: [],
    zoneCautionSpeedDrop: 0.04,
    zoneDisciplineBoost: 0.1,
    recommendedMix: {
      cautiousPct: 14,
      normalPct: 44,
      aggressivePct: 42,
      courierShare: 0.58,
      preset: 'rush-hour',
    },
  },
  'lamper-semarang': {
    id: 'lamper-semarang',
    label: 'Lamper Majapahit · Arteri & RS Bhayangkara',
    busBayArms: ['east', 'west'],
    cautionArms: ['south', 'west'], // RS Bhayangkara SW
    marketArms: ['north'],
    zoneCautionSpeedDrop: 0.06,
    zoneDisciplineBoost: 0.08,
    recommendedMix: {
      cautiousPct: 16,
      normalPct: 46,
      aggressivePct: 38,
      courierShare: 0.52,
      preset: 'rush-hour',
    },
  },
  'sulawesi-banjarmasin': {
    id: 'sulawesi-banjarmasin',
    label: 'Jl. Sulawesi · Pasar Lama & Tepi Sungai',
    busBayArms: [],
    cautionArms: ['north', 'east'], // Masjid Jami NE
    marketArms: ['north', 'west', 'south'], // Pasar Lama NW & Kampung Bugis
    zoneCautionSpeedDrop: 0.08,
    zoneDisciplineBoost: 0.04,
    recommendedMix: {
      cautiousPct: 26,
      normalPct: 50,
      aggressivePct: 24,
      courierShare: 0.36,
      preset: 'balanced',
    },
  },
  'laswi-bandung': {
    id: 'laswi-bandung',
    label: 'Laswi – Gatot Subroto · Koridor TMB & Jam Sibuk',
    busBayArms: ['north', 'east', 'south', 'west'], // Halte TMB on all 4 corners
    cautionArms: [],
    marketArms: [],
    zoneCautionSpeedDrop: 0.05,
    zoneDisciplineBoost: 0.05,
    recommendedMix: {
      cautiousPct: 14,
      normalPct: 46,
      aggressivePct: 40,
      courierShare: 0.48,
      preset: 'rush-hour',
    },
  },
  'bondowoso-malang': {
    id: 'bondowoso-malang',
    label: 'Bondowoso – Retawu · Zona Kampus & Jalan Sempit 3.0m',
    busBayArms: [],
    cautionArms: ['north', 'west', 'south', 'east'], // Kampus Widya Karya + Taman Retawu
    marketArms: ['south', 'west'], // Pasar Buku Wilis
    zoneCautionSpeedDrop: 0.09,
    zoneDisciplineBoost: 0.12,
    recommendedMix: {
      cautiousPct: 44,
      normalPct: 44,
      aggressivePct: 12,
      courierShare: 0.3,
      preset: 'orderly',
    },
  },
  default: {
    id: 'default',
    label: 'Simpang Standar',
    busBayArms: [],
    cautionArms: [],
    marketArms: [],
    zoneCautionSpeedDrop: 0.0,
    zoneDisciplineBoost: 0.0,
    recommendedMix: {
      cautiousPct: 22,
      normalPct: 50,
      aggressivePct: 28,
      courierShare: 0.42,
      preset: 'balanced',
    },
  },
};

export function resolveMapContext(config: Pick<SimConfig, 'environmentId' | 'scenarioName'>): MapBehavioralContext {
  const id = (config.environmentId || '').toLowerCase();
  if (id && MAP_CONTEXTS[id]) return MAP_CONTEXTS[id];
  const name = (config.scenarioName || '').toLowerCase();
  if (name.includes('giwangan')) return MAP_CONTEXTS['giwangan-yogya'];
  if (name.includes('brimob')) return MAP_CONTEXTS['brimob-yogya'];
  if (name.includes('lamper') || name.includes('semarang')) return MAP_CONTEXTS['lamper-semarang'];
  if (name.includes('sulawesi') || name.includes('banjarmasin')) return MAP_CONTEXTS['sulawesi-banjarmasin'];
  if (name.includes('laswi') || name.includes('bandung')) return MAP_CONTEXTS['laswi-bandung'];
  if (name.includes('bondowoso') || name.includes('malang')) return MAP_CONTEXTS['bondowoso-malang'];
  return MAP_CONTEXTS.default;
}

/**
 * Ide #13: Evaluates map-aware per-archetype behavioral modulation (zero-GC).
 * Couples each driver type to the active map's geometry (narrow undivided road vs median),
 * LTOR/slip-lane dynamics, and Indonesian landmark zones (Halte TMB/Terminal, Kampus/RS, Pasar).
 */
export function evaluateMapContextMod(
  v: SimVehicle,
  traits: DriverCognitiveTraits,
  ctx: MapBehavioralContext,
  armGeom: CompiledArmGeometry | undefined,
  hasPhysicalMedian: boolean,
  hasOncomingNear: boolean,
  blockedByHeavyAhead: boolean
): MapContextModifier {
  // 1. Archetype-calibrated LTOR / Slip-lane speed & gap acceptance
  const baseLtorSpeed = v.vClass === 'motor' ? 5.4 : v.vClass === 'heavy' ? 3.5 : 4.2;
  const ltorSpeedCap = Math.max(2.6, Math.min(7.2, baseLtorSpeed * traits.ltorSpeedScale));
  const ltorGapMult = traits.ltorGapMult;

  // 2. Undivided-road lateral positioning (e.g. Bondowoso Malang 3.0m, Brimob Yogya, Sulawesi Banjarmasin)
  let undividedLateralShift = 0;
  const isUndivided = !hasPhysicalMedian && (armGeom ? armGeom.def.medianWidth <= 0.05 : true);
  const distToStop = v.stopLineDist - v.distanceAlongPath;
  if (
    isUndivided &&
    v.vClass !== 'motor' &&
    !v.isSlipLane &&
    !v.isUTurn &&
    (!v.overtakeState || v.overtakeState === 'none') &&
    v.laneIndex === 0 &&
    distToStop > 10.0 &&
    distToStop < 65.0
  ) {
    const laneW = armGeom?.def.inLaneWidths[0] ?? 3.5;
    const availHalf = Math.max(0, (laneW - v.width) * 0.5 - 0.16);
    if (traits.undividedLateralBias > 0 && hasOncomingNear) {
      // Defensive / BUS / TRK nudge smoothly curb-ward when passing opposing traffic on undivided roads
      const narrowBoost = laneW <= 3.2 ? 1.25 : 1.0;
      undividedLateralShift = Math.min(availHalf, traits.undividedLateralBias * narrowBoost);
    } else if (traits.undividedLateralBias < 0 && blockedByHeavyAhead && !hasOncomingNear) {
      // Aggressive / hurried centerline peek behind heavy occluder when road ahead is clear
      undividedLateralShift = -Math.min(availHalf, Math.abs(traits.undividedLateralBias));
    }
  }

  // 3. Landmark / Corridor Contextual Zones (Bus Shelter, Campus/Hospital, Traditional Market)
  let zoneSpeedScale = 1.0;
  let busCurbPull = false;
  let activeZone: MapZoneKind | null = null;
  const inApproachZone = distToStop > 8.0 && distToStop < 48.0;

  if (inApproachZone) {
    if (traits.archetype === 'transit' && ctx.busBayArms.includes(v.originArm)) {
      busCurbPull = true;
      activeZone = 'transit-bay';
      // Buses smoothly moderate speed near bus shelters / terminal curb bays
      zoneSpeedScale = Math.min(zoneSpeedScale, 0.91);
    }
    if (ctx.cautionArms.includes(v.originArm) && ctx.zoneCautionSpeedDrop > 0) {
      const receptivity =
        traits.archetype === 'defensive' || traits.archetype === 'transit'
          ? 1.15
          : traits.archetype === 'commuter' || traits.archetype === 'logistics'
            ? 0.85
            : 0.35;
      zoneSpeedScale = Math.min(zoneSpeedScale, 1.0 - ctx.zoneCautionSpeedDrop * receptivity);
      if (!activeZone) {
        activeZone =
          ctx.id === 'lamper-semarang'
            ? 'hospital-caution'
            : ctx.id === 'brimob-yogya' || ctx.id === 'giwangan-yogya'
              ? 'enforcement'
              : 'campus-caution';
      }
    }
    if (ctx.marketArms.includes(v.originArm)) {
      const marketDrop =
        traits.archetype === 'defensive' || traits.archetype === 'logistics'
          ? 0.08
          : traits.archetype === 'commuter'
            ? 0.05
            : 0.015; // Couriers stay nimble near market edges
      zoneSpeedScale = Math.min(zoneSpeedScale, 1.0 - marketDrop);
      if (!activeZone) activeZone = 'market-friction';
    }
  }

  return {
    ltorSpeedCap,
    ltorGapMult,
    undividedLateralShift,
    zoneSpeedScale,
    busCurbPull,
    activeZone,
  };
}

/**
 * Ide #14: Zero-GC Geospatial Driver-Behavior Friction Grid.
 * Tracks exponentially-decayed intensity of hard brakes, yield conflicts, overtaking,
 * and marking crosses per archetype for live on-map heatmap visualization.
 */
export class SpatialFrictionGrid {
  readonly gridSize: number;
  extentMeters: number;
  private readonly totalCells: Float32Array;
  private readonly archCells: Record<DriverArchetype, Float32Array>;
  private maxVal = 0.001;

  constructor(gridSize = 28, extentMeters = 90) {
    this.gridSize = gridSize;
    this.extentMeters = Math.max(40, extentMeters);
    const len = gridSize * gridSize;
    this.totalCells = new Float32Array(len);
    this.archCells = {
      defensive: new Float32Array(len),
      commuter: new Float32Array(len),
      hurried: new Float32Array(len),
      courier: new Float32Array(len),
      transit: new Float32Array(len),
      logistics: new Float32Array(len),
    };
  }

  reset(extentMeters?: number): void {
    if (extentMeters !== undefined && Number.isFinite(extentMeters)) {
      this.extentMeters = Math.max(40, extentMeters);
    }
    this.totalCells.fill(0);
    for (let i = 0; i < ARCHETYPE_ORDER.length; i++) {
      this.archCells[ARCHETYPE_ORDER[i]].fill(0);
    }
    this.maxVal = 0.001;
  }

  recordEvent(x: number, y: number, archetype: DriverArchetype, weight: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || weight <= 0) return;
    const half = this.extentMeters;
    const nx = (x + half) / (2 * half);
    const ny = (y + half) / (2 * half);
    if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return;
    const gx = Math.min(this.gridSize - 1, Math.max(0, Math.floor(nx * this.gridSize)));
    const gy = Math.min(this.gridSize - 1, Math.max(0, Math.floor(ny * this.gridSize)));
    const idx = gy * this.gridSize + gx;
    const nextTotal = Math.min(18.0, this.totalCells[idx] + weight);
    this.totalCells[idx] = nextTotal;
    const archArr = this.archCells[archetype];
    if (archArr) {
      archArr[idx] = Math.min(14.0, archArr[idx] + weight);
    }
    if (nextTotal > this.maxVal) {
      this.maxVal = nextTotal;
    }
  }

  decay(dt: number): void {
    if (dt <= 0) return;
    const factor = Math.exp(-dt * 0.032); // ~22s half-life for smooth persistent hotspot readability
    let peak = 0.001;
    const len = this.totalCells.length;
    for (let i = 0; i < len; i++) {
      const v = this.totalCells[i] * factor;
      this.totalCells[i] = v < 0.005 ? 0 : v;
      if (v > peak) peak = v;
    }
    for (let a = 0; a < ARCHETYPE_ORDER.length; a++) {
      const arr = this.archCells[ARCHETYPE_ORDER[a]];
      for (let i = 0; i < len; i++) {
        const v = arr[i] * factor;
        arr[i] = v < 0.005 ? 0 : v;
      }
    }
    this.maxVal = peak;
  }

  toSnapshot(): FrictionHeatmapSnapshot {
    const len = this.totalCells.length;
    const total = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      total[i] = Math.round(this.totalCells[i] * 100) / 100;
    }
    const byArchetype = {} as Record<DriverArchetype, number[]>;
    for (let a = 0; a < ARCHETYPE_ORDER.length; a++) {
      const arch = ARCHETYPE_ORDER[a];
      const src = this.archCells[arch];
      const dst = new Array<number>(len);
      for (let i = 0; i < len; i++) {
        dst[i] = Math.round(src[i] * 100) / 100;
      }
      byArchetype[arch] = dst;
    }
    return {
      gridSize: this.gridSize,
      extentMeters: this.extentMeters,
      maxVal: Math.round(this.maxVal * 100) / 100,
      total,
      byArchetype,
    };
  }
}
