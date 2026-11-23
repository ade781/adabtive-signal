import { DriverProfile, SPRITES } from './constants';
import type { EnvironmentState, WeatherPhysicsProfile } from './environmentDynamics';
import type {
  DriverArchetype,
  DriverProfileMix,
  MapOverlayLayers,
  SimConfig,
  VehicleClass,
} from './types';

export type { DriverArchetype, DriverProfileMix };

/**
 * Full multi-dimensional cognitive & kinematic profile for each rider/driver archetype.
 * Module-level immutable lookup tables keep per-tick reads strictly zero-GC.
 */
export interface DriverCognitiveTraits {
  archetype: DriverArchetype;
  baseProfile: DriverProfile;
  label: string;
  shortBadge: string;
  // Tahap 1: Longitudinal car-following, jerk, emotion & compliance
  speedMult: number;
  accelMult: number;
  headwayMult: number;
  minGapMult: number;
  comfortDecelMult: number;
  iidmDelta: number;
  jerkMult: number;
  frustrationGrowMult: number;
  frustrationDecayMult: number;
  riskTolerance: number;
  yellowCommitBias: number;
  yellowBoxComplianceMult: number;
  stopCreepBias: number;
  bSafeMult: number;
  postIncidentCautionSec: number;
  postIncidentFrustSpike: number;
  // Tahap 2: Social perception, multi-anticipation, signals & negotiation
  reactionScale: number;
  multiLookaheadTau: number;
  secondLeaderWeight: number;
  occlusionPeekMult: number;
  politeness: number;
  courtesyYieldBias: number;
  glosaCoastingBias: number;
  frustrationMobilSensitivity: number;
  attentionDriftProb: number;
  crossYellowAnticipation: number;
  signalOnsetDist: number;
  mlcPreSortHorizon: number;
  // Tahap 3: Spatial 2D, motorcycle filtering, MOBIL, steering & social coupling
  corridorPinchMult: number;
  wideTurnAvoidMult: number;
  markingIgnoreWeight: number;
  rhkFrontBias: number;
  signalLeadTime: number;
  laneImpedanceSensitivity: number;
  mobilThresholdScale: number;
  allowOncomingConvoyPass: boolean;
  allowOncomingInLightRain: boolean;
  oncomingMarginMult: number;
  steerRateMult: number;
  lookaheadMult: number;
  lateralGripComfortMult: number;
  evasiveShareMult: number;
  wideSwingScale: number;
  tailgateYieldSens: number;
  flankingCushionMult: number;
  runnerContagionSens: number;
  // Tahap 4: Map-context & corridor adaptation
  ltorSpeedScale: number;
  ltorGapMult: number;
  undividedLateralBias: number; // + toward outer curb (defensive), - toward centerline (peek/aggressive)
  curbLaneAffinity: number;     // > 1 prefers outer left LHT lane (e.g. BUS)
}

export const ARCHETYPE_ORDER: readonly DriverArchetype[] = [
  'defensive',
  'commuter',
  'hurried',
  'courier',
  'transit',
  'logistics',
];

export const MAP_OVERLAY_PRESETS: Readonly<Record<'compact' | 'full' | 'off', MapOverlayLayers>> = {
  compact: {
    identity: true,
    tacticalCues: true,
    socialVectors: false,
    emotionBars: true,
    frictionHeatmap: false,
  },
  full: {
    identity: true,
    tacticalCues: true,
    socialVectors: true,
    emotionBars: true,
    frictionHeatmap: true,
  },
  off: {
    identity: false,
    tacticalCues: false,
    socialVectors: false,
    emotionBars: false,
    frictionHeatmap: false,
  },
};

export const ARCHETYPE_TRAITS: Readonly<Record<DriverArchetype, DriverCognitiveTraits>> = {
  defensive: {
    archetype: 'defensive',
    baseProfile: 'cautious',
    label: 'Hati-hati / Defensif',
    shortBadge: 'DEF',
    speedMult: 0.88,
    accelMult: 0.88,
    headwayMult: 1.24,
    minGapMult: 1.18,
    comfortDecelMult: 0.9,
    iidmDelta: 3.1,
    jerkMult: 0.78,
    frustrationGrowMult: 0.45,
    frustrationDecayMult: 1.35,
    riskTolerance: 0.12,
    yellowCommitBias: 0.72,
    yellowBoxComplianceMult: 1.32,
    stopCreepBias: 0.25,
    bSafeMult: 0.82,
    postIncidentCautionSec: 6.5,
    postIncidentFrustSpike: 0.03,
    reactionScale: 1.18,
    multiLookaheadTau: 0.62,
    secondLeaderWeight: 1.28,
    occlusionPeekMult: 0.82,
    politeness: 0.62,
    courtesyYieldBias: 1.35,
    glosaCoastingBias: 1.25,
    frustrationMobilSensitivity: 0.22,
    attentionDriftProb: 0.28,
    crossYellowAnticipation: 0.0,
    signalOnsetDist: 44,
    mlcPreSortHorizon: 72,
    corridorPinchMult: 1.75,
    wideTurnAvoidMult: 1.65,
    markingIgnoreWeight: 0.1,
    rhkFrontBias: 0.7,
    signalLeadTime: 0.55,
    laneImpedanceSensitivity: 0.8,
    mobilThresholdScale: 1.35,
    allowOncomingConvoyPass: false,
    allowOncomingInLightRain: false,
    oncomingMarginMult: 1.3,
    steerRateMult: 0.82,
    lookaheadMult: 1.18,
    lateralGripComfortMult: 0.8,
    evasiveShareMult: 1.18,
    wideSwingScale: 0.9,
    tailgateYieldSens: 1.45,
    flankingCushionMult: 1.35,
    runnerContagionSens: 0.0,
    ltorSpeedScale: 0.82,
    ltorGapMult: 1.22,
    undividedLateralBias: 0.16,
    curbLaneAffinity: 1.25,
  },
  commuter: {
    archetype: 'commuter',
    baseProfile: 'normal',
    label: 'Komuter Normal',
    shortBadge: 'NRM',
    speedMult: 1.0,
    accelMult: 1.0,
    headwayMult: 1.0,
    minGapMult: 1.0,
    comfortDecelMult: 1.0,
    iidmDelta: 4.0,
    jerkMult: 1.0,
    frustrationGrowMult: 1.0,
    frustrationDecayMult: 1.0,
    riskTolerance: 0.42,
    yellowCommitBias: 1.0,
    yellowBoxComplianceMult: 1.0,
    stopCreepBias: 0.85,
    bSafeMult: 1.0,
    postIncidentCautionSec: 3.5,
    postIncidentFrustSpike: 0.08,
    reactionScale: 1.0,
    multiLookaheadTau: 0.46,
    secondLeaderWeight: 1.0,
    occlusionPeekMult: 1.0,
    politeness: 0.26,
    courtesyYieldBias: 1.0,
    glosaCoastingBias: 1.0,
    frustrationMobilSensitivity: 0.65,
    attentionDriftProb: 0.34,
    crossYellowAnticipation: 0.25,
    signalOnsetDist: 32,
    mlcPreSortHorizon: 52,
    corridorPinchMult: 1.0,
    wideTurnAvoidMult: 1.0,
    markingIgnoreWeight: 0.9,
    rhkFrontBias: 1.0,
    signalLeadTime: 0.32,
    laneImpedanceSensitivity: 1.0,
    mobilThresholdScale: 1.0,
    allowOncomingConvoyPass: false,
    allowOncomingInLightRain: true,
    oncomingMarginMult: 1.0,
    steerRateMult: 1.0,
    lookaheadMult: 1.0,
    lateralGripComfortMult: 1.0,
    evasiveShareMult: 1.0,
    wideSwingScale: 1.0,
    tailgateYieldSens: 1.0,
    flankingCushionMult: 0.7,
    runnerContagionSens: 0.35,
    ltorSpeedScale: 1.0,
    ltorGapMult: 1.0,
    undividedLateralBias: 0.04,
    curbLaneAffinity: 1.0,
  },
  hurried: {
    archetype: 'hurried',
    baseProfile: 'aggressive',
    label: 'Agresif / Terburu',
    shortBadge: 'AGR',
    speedMult: 1.15,
    accelMult: 1.15,
    headwayMult: 0.84,
    minGapMult: 0.88,
    comfortDecelMult: 1.12,
    iidmDelta: 4.6,
    jerkMult: 1.25,
    frustrationGrowMult: 1.6,
    frustrationDecayMult: 0.72,
    riskTolerance: 0.84,
    yellowCommitBias: 1.38,
    yellowBoxComplianceMult: 0.62,
    stopCreepBias: 1.35,
    bSafeMult: 1.16,
    postIncidentCautionSec: 1.4,
    postIncidentFrustSpike: 0.2,
    reactionScale: 0.76,
    multiLookaheadTau: 0.32,
    secondLeaderWeight: 0.72,
    occlusionPeekMult: 1.15,
    politeness: 0.06,
    courtesyYieldBias: 0.62,
    glosaCoastingBias: 0.75,
    frustrationMobilSensitivity: 1.0,
    attentionDriftProb: 0.04,
    crossYellowAnticipation: 0.85,
    signalOnsetDist: 18,
    mlcPreSortHorizon: 32,
    corridorPinchMult: 0.65,
    wideTurnAvoidMult: 0.82,
    markingIgnoreWeight: 1.35,
    rhkFrontBias: 1.35,
    signalLeadTime: 0.16,
    laneImpedanceSensitivity: 1.4,
    mobilThresholdScale: 0.76,
    allowOncomingConvoyPass: true,
    allowOncomingInLightRain: true,
    oncomingMarginMult: 0.8,
    steerRateMult: 1.2,
    lookaheadMult: 0.88,
    lateralGripComfortMult: 1.12,
    evasiveShareMult: 0.9,
    wideSwingScale: 1.0,
    tailgateYieldSens: 0.15,
    flankingCushionMult: 0.1,
    runnerContagionSens: 0.78,
    ltorSpeedScale: 1.16,
    ltorGapMult: 0.82,
    undividedLateralBias: -0.14,
    curbLaneAffinity: 0.6,
  },
  courier: {
    archetype: 'courier',
    baseProfile: 'aggressive',
    label: 'Kurir / Ojol',
    shortBadge: 'KUR',
    speedMult: 1.12,
    accelMult: 1.18,
    headwayMult: 0.8,
    minGapMult: 0.82,
    comfortDecelMult: 1.15,
    iidmDelta: 4.5,
    jerkMult: 1.3,
    frustrationGrowMult: 1.45,
    frustrationDecayMult: 0.85,
    riskTolerance: 0.76,
    yellowCommitBias: 1.24,
    yellowBoxComplianceMult: 0.72,
    stopCreepBias: 1.45,
    bSafeMult: 1.12,
    postIncidentCautionSec: 1.2,
    postIncidentFrustSpike: 0.16,
    reactionScale: 0.72,
    multiLookaheadTau: 0.42,
    secondLeaderWeight: 0.92,
    occlusionPeekMult: 1.12,
    politeness: 0.12,
    courtesyYieldBias: 0.78,
    glosaCoastingBias: 0.88,
    frustrationMobilSensitivity: 0.92,
    attentionDriftProb: 0.02,
    crossYellowAnticipation: 0.95,
    signalOnsetDist: 15,
    mlcPreSortHorizon: 28,
    corridorPinchMult: 0.52,
    wideTurnAvoidMult: 0.9,
    markingIgnoreWeight: 1.45,
    rhkFrontBias: 1.65,
    signalLeadTime: 0.18,
    laneImpedanceSensitivity: 1.5,
    mobilThresholdScale: 0.7,
    allowOncomingConvoyPass: true,
    allowOncomingInLightRain: true,
    oncomingMarginMult: 0.84,
    steerRateMult: 1.28,
    lookaheadMult: 0.84,
    lateralGripComfortMult: 1.14,
    evasiveShareMult: 1.05,
    wideSwingScale: 1.0,
    tailgateYieldSens: 0.35,
    flankingCushionMult: 0.25,
    runnerContagionSens: 0.62,
    ltorSpeedScale: 1.18,
    ltorGapMult: 0.8,
    undividedLateralBias: -0.08,
    curbLaneAffinity: 0.85,
  },
  transit: {
    archetype: 'transit',
    baseProfile: 'cautious',
    label: 'Bus / Angkutan',
    shortBadge: 'BUS',
    speedMult: 0.91,
    accelMult: 0.88,
    headwayMult: 1.14,
    minGapMult: 1.1,
    comfortDecelMult: 0.94,
    iidmDelta: 3.1,
    jerkMult: 0.64, // Passenger comfort jerk protection
    frustrationGrowMult: 0.48,
    frustrationDecayMult: 1.28,
    riskTolerance: 0.16,
    yellowCommitBias: 0.84,
    yellowBoxComplianceMult: 1.35,
    stopCreepBias: 0.2,
    bSafeMult: 0.84,
    postIncidentCautionSec: 6.0,
    postIncidentFrustSpike: 0.04,
    reactionScale: 1.06,
    multiLookaheadTau: 0.62,
    secondLeaderWeight: 1.26,
    occlusionPeekMult: 0.84,
    politeness: 0.52,
    courtesyYieldBias: 1.16,
    glosaCoastingBias: 1.26,
    frustrationMobilSensitivity: 0.18,
    attentionDriftProb: 0.12,
    crossYellowAnticipation: 0.15,
    signalOnsetDist: 48,
    mlcPreSortHorizon: 78,
    corridorPinchMult: 1.55,
    wideTurnAvoidMult: 1.55,
    markingIgnoreWeight: 0.04,
    rhkFrontBias: 0.45,
    signalLeadTime: 0.62,
    laneImpedanceSensitivity: 0.72,
    mobilThresholdScale: 1.48,
    allowOncomingConvoyPass: false,
    allowOncomingInLightRain: false,
    oncomingMarginMult: 1.38,
    steerRateMult: 0.82,
    lookaheadMult: 1.18,
    lateralGripComfortMult: 0.74,
    evasiveShareMult: 1.12,
    wideSwingScale: 0.88, // Tighter curb-hugging bus swing vs heavy freight
    tailgateYieldSens: 1.35,
    flankingCushionMult: 1.25,
    runnerContagionSens: 0.0,
    ltorSpeedScale: 0.82,
    ltorGapMult: 1.24,
    undividedLateralBias: 0.14,
    curbLaneAffinity: 1.6, // Strong Halte / outer-lane preference
  },
  logistics: {
    archetype: 'logistics',
    baseProfile: 'normal',
    label: 'Truk Logistik',
    shortBadge: 'TRK',
    speedMult: 0.94,
    accelMult: 0.84, // Heavy laden inertial launch
    headwayMult: 1.26,
    minGapMult: 1.22,
    comfortDecelMult: 0.86, // Longer heavy braking distance
    iidmDelta: 3.5,
    jerkMult: 0.78,
    frustrationGrowMult: 0.62,
    frustrationDecayMult: 1.08,
    riskTolerance: 0.24,
    yellowCommitBias: 1.26, // Momentum conservation on late yellow
    yellowBoxComplianceMult: 1.18,
    stopCreepBias: 0.35,
    bSafeMult: 0.88,
    postIncidentCautionSec: 5.2,
    postIncidentFrustSpike: 0.06,
    reactionScale: 1.14,
    multiLookaheadTau: 0.68,
    secondLeaderWeight: 1.34,
    occlusionPeekMult: 0.86,
    politeness: 0.42,
    courtesyYieldBias: 1.08,
    glosaCoastingBias: 1.18,
    frustrationMobilSensitivity: 0.26,
    attentionDriftProb: 0.16,
    crossYellowAnticipation: 0.05,
    signalOnsetDist: 46,
    mlcPreSortHorizon: 74,
    corridorPinchMult: 1.5,
    wideTurnAvoidMult: 1.5,
    markingIgnoreWeight: 0.08,
    rhkFrontBias: 0.45,
    signalLeadTime: 0.66,
    laneImpedanceSensitivity: 0.68,
    mobilThresholdScale: 1.55,
    allowOncomingConvoyPass: false,
    allowOncomingInLightRain: false,
    oncomingMarginMult: 1.44,
    steerRateMult: 0.74,
    lookaheadMult: 1.22,
    lateralGripComfortMult: 0.7,
    evasiveShareMult: 1.0,
    wideSwingScale: 1.2, // Wider freight trailer off-tracking pre-swing
    tailgateYieldSens: 1.15,
    flankingCushionMult: 0.95,
    runnerContagionSens: 0.1,
    ltorSpeedScale: 0.86,
    ltorGapMult: 1.18,
    undividedLateralBias: 0.1,
    curbLaneAffinity: 1.35,
  },
};

/**
 * Ide #1: 2D VehicleClass x DriverArchetype precomputed immutable matrix (100% zero-GC).
 * Differentiates e.g. courier vans/taxis (car) from courier motorcycles (ojol),
 * and defensive/hurried cars from motorcycles.
 */
function buildClassArchetypeMatrix(): Readonly<
  Record<VehicleClass, Readonly<Record<DriverArchetype, DriverCognitiveTraits>>>
> {
  const classes: VehicleClass[] = ['motor', 'car', 'heavy'];
  const matrix = {} as Record<VehicleClass, Record<DriverArchetype, DriverCognitiveTraits>>;

  for (const cls of classes) {
    matrix[cls] = {} as Record<DriverArchetype, DriverCognitiveTraits>;
    for (const arch of ARCHETYPE_ORDER) {
      const base = ARCHETYPE_TRAITS[arch];
      if (cls === 'car' && arch === 'courier') {
        // Courier car (delivery van / pickup / taxi): nimble but heavier/wider than ojol motor
        matrix[cls][arch] = {
          ...base,
          speedMult: 1.09,
          accelMult: 1.11,
          headwayMult: 0.9,
          minGapMult: 0.92,
          jerkMult: 1.14,
          signalLeadTime: 0.26,
          signalOnsetDist: 24,
          mlcPreSortHorizon: 40,
          mobilThresholdScale: 0.82,
          steerRateMult: 1.12,
          lookaheadMult: 0.94,
          markingIgnoreWeight: 1.05,
          oncomingMarginMult: 0.92,
          stopCreepBias: 1.15,
          undividedLateralBias: -0.05,
        };
      } else if (cls === 'car' && arch === 'hurried') {
        matrix[cls][arch] = {
          ...base,
          headwayMult: 0.88,
          minGapMult: 0.92,
          steerRateMult: 1.12,
          signalLeadTime: 0.2,
          mlcPreSortHorizon: 36,
        };
      } else if (cls === 'motor' && arch === 'defensive') {
        matrix[cls][arch] = {
          ...base,
          corridorPinchMult: 1.85,
          rhkFrontBias: 0.72,
          undividedLateralBias: 0.12,
        };
      } else if (cls === 'motor' && arch === 'commuter') {
        matrix[cls][arch] = {
          ...base,
          crossYellowAnticipation: 0.35,
          rhkFrontBias: 1.05,
        };
      } else {
        matrix[cls][arch] = base;
      }
    }
  }
  return matrix;
}

export const CLASS_ARCHETYPE_TRAITS = buildClassArchetypeMatrix();

export const DRIVER_MIX_PRESETS: Record<
  Exclude<NonNullable<DriverProfileMix['preset']>, 'custom'>,
  { label: string; desc: string; mix: DriverProfileMix }
> = {
  balanced: {
    label: 'Seimbang (Default)',
    desc: '22% Hati-hati · 50% Normal · 28% Agresif',
    mix: { cautiousPct: 22, normalPct: 50, aggressivePct: 28, courierShare: 0.42, preset: 'balanced' },
  },
  orderly: {
    label: 'Tertib Kampus',
    desc: '48% Hati-hati · 42% Normal · 10% Agresif',
    mix: { cautiousPct: 48, normalPct: 42, aggressivePct: 10, courierShare: 0.28, preset: 'orderly' },
  },
  'rush-hour': {
    label: 'Komuter Sibuk',
    desc: '14% Hati-hati · 46% Normal · 40% Agresif',
    mix: { cautiousPct: 14, normalPct: 46, aggressivePct: 40, courierShare: 0.46, preset: 'rush-hour' },
  },
  'courier-dense': {
    label: 'Dominan Kurir / Ojol',
    desc: '12% Hati-hati · 38% Normal · 50% Agresif (72% Kurir)',
    mix: { cautiousPct: 12, normalPct: 38, aggressivePct: 50, courierShare: 0.72, preset: 'courier-dense' },
  },
  'night-logistics': {
    label: 'Malam & Logistik',
    desc: '38% Hati-hati · 46% Normal · 16% Agresif',
    mix: { cautiousPct: 38, normalPct: 46, aggressivePct: 16, courierShare: 0.25, preset: 'night-logistics' },
  },
};

const SPRITE_POOL: Record<VehicleClass, Partial<Record<DriverArchetype, readonly string[]>>> = {
  motor: {
    defensive: [
      '/assets/vehicles/moto-scooter.svg',
      '/assets/vehicles/moto-commuter.svg',
      '/assets/vehicles/moto-ev-white.svg',
      '/assets/vehicles/moto-cruiser.svg',
    ],
    commuter: [
      '/assets/vehicles/moto-commuter.svg',
      '/assets/vehicles/moto-scooter.svg',
      '/assets/vehicles/moto-ev-white.svg',
      '/assets/vehicles/moto-cruiser.svg',
    ],
    hurried: [
      '/assets/vehicles/moto-sport.svg',
      '/assets/vehicles/moto-commuter.svg',
      '/assets/vehicles/moto-scooter.svg',
    ],
    courier: [
      '/assets/vehicles/moto-delivery-box.svg',
      '/assets/vehicles/moto-delivery-box.svg',
      '/assets/vehicles/moto-delivery-box.svg',
      '/assets/vehicles/moto-scooter.svg',
    ],
  },
  car: {
    defensive: [
      '/assets/vehicles/car-compact-teal.svg',
      '/assets/vehicles/car-sedan-white.svg',
      '/assets/vehicles/car-ev-mint.svg',
      '/assets/vehicles/car-sedan-navy.svg',
    ],
    commuter: [
      '/assets/vehicles/car-sedan-navy.svg',
      '/assets/vehicles/car-sedan-white.svg',
      '/assets/vehicles/car-suv-slate.svg',
      '/assets/vehicles/car-compact-teal.svg',
      '/assets/vehicles/car-ev-mint.svg',
      '/assets/vehicles/car-taxi-yellow.svg',
    ],
    hurried: [
      '/assets/vehicles/car-luxury-black.svg',
      '/assets/vehicles/car-taxi-yellow.svg',
      '/assets/vehicles/car-suv-slate.svg',
      '/assets/vehicles/car-sedan-navy.svg',
    ],
    courier: [
      '/assets/vehicles/car-van-delivery.svg',
      '/assets/vehicles/car-van-delivery.svg',
      '/assets/vehicles/car-pickup-slate.svg',
      '/assets/vehicles/car-taxi-yellow.svg',
    ],
  },
  heavy: {
    transit: ['/assets/vehicles/bus-city.svg'],
    logistics: [
      '/assets/vehicles/truck-box.svg',
      '/assets/vehicles/truck-heavy.svg',
      '/assets/vehicles/truck-dump.svg',
      '/assets/vehicles/truck-tanker.svg',
    ],
  },
};

/**
 * Resolves immutable 2D (VehicleClass x DriverArchetype) cognitive traits, falling back
 * gracefully when legacy tests/mocks only provide `profile` and `vClass`.
 */
export function getDriverTraits(v: {
  profile: DriverProfile;
  archetype?: DriverArchetype;
  vClass: VehicleClass;
}): DriverCognitiveTraits {
  const clsTable = CLASS_ARCHETYPE_TRAITS[v.vClass] ?? ARCHETYPE_TRAITS;
  if (v.archetype && clsTable[v.archetype]) {
    return clsTable[v.archetype];
  }
  if (v.vClass === 'heavy') {
    return v.profile === 'cautious' ? clsTable.transit : clsTable.logistics;
  }
  if (v.profile === 'cautious') return clsTable.defensive;
  if (v.profile === 'aggressive') return clsTable.hurried;
  return clsTable.commuter;
}

export function normalizeDriverProfileMix(raw?: DriverProfileMix): DriverProfileMix {
  const def = DRIVER_MIX_PRESETS.balanced.mix;
  if (!raw) return { ...def };
  const c = Math.max(0, Number.isFinite(raw.cautiousPct) ? raw.cautiousPct : def.cautiousPct);
  const n = Math.max(0, Number.isFinite(raw.normalPct) ? raw.normalPct : def.normalPct);
  const a = Math.max(0, Number.isFinite(raw.aggressivePct) ? raw.aggressivePct : def.aggressivePct);
  const sum = c + n + a;
  if (sum <= 1e-4) return { ...def };
  const cautiousPct = Math.round((c / sum) * 100);
  const normalPct = Math.round((n / sum) * 100);
  const aggressivePct = Math.max(0, 100 - cautiousPct - normalPct);
  const courierShare = Math.max(
    0,
    Math.min(1, Number.isFinite(raw.courierShare) ? raw.courierShare! : def.courierShare ?? 0.42)
  );
  return {
    cautiousPct,
    normalPct,
    aggressivePct,
    courierShare,
    preset: raw.preset ?? 'custom',
  };
}

/**
 * Resolves spawn driver profile, Indonesian traffic archetype, and correlated sprite asset
 * taking into account vehicle class, configured mix, time-of-day, weather, and map context.
 */
export function resolveSpawnDriverIdentity(
  vClass: VehicleClass,
  config: SimConfig,
  envState: EnvironmentState,
  rng: () => number
): { profile: DriverProfile; archetype: DriverArchetype; spriteKey: string } {
  const mix = normalizeDriverProfileMix(config.driverProfileMix);
  let cautiousW = mix.cautiousPct;
  let normalW = mix.normalPct;
  let aggressiveW = mix.aggressivePct;

  // Dynamic time-of-day shift in non-static modes
  if (envState.timeMode !== 'static') {
    const h = envState.clockHour;
    const isRush = (h >= 6.25 && h < 8.75) || (h >= 16.0 && h < 18.75);
    const isNight = h >= 21.5 || h < 5.2;
    if (isRush) {
      cautiousW = Math.max(4, cautiousW - 4);
      aggressiveW += 5;
    } else if (isNight) {
      cautiousW += 6;
      aggressiveW = Math.max(4, aggressiveW - 6);
    }
  }

  // Heavy rain slightly tempers extreme reckless spawns unless user pinned aggressive=100%
  if (envState.weather.condition === 'heavy-rain' && aggressiveW < 95) {
    const shift = Math.min(aggressiveW * 0.25, 6);
    aggressiveW -= shift;
    cautiousW += shift;
  }

  const totalW = Math.max(1e-4, cautiousW + normalW + aggressiveW);
  const roll = rng() * totalW;
  const profile: DriverProfile =
    roll < cautiousW ? 'cautious' : roll < cautiousW + normalW ? 'normal' : 'aggressive';

  let archetype: DriverArchetype;
  if (vClass === 'heavy') {
    const isNight = envState.timeMode !== 'static' && (envState.clockHour >= 21.5 || envState.clockHour < 5.2);
    const envId = config.environmentId ?? '';
    const isTransitCorridor = envId === 'giwangan-yogya' || envId === 'laswi-bandung';
    const baseBusChance = isNight ? 0.1 : profile === 'cautious' ? 0.45 : 0.24;
    const busChance = Math.min(0.75, baseBusChance + (isTransitCorridor && !isNight ? 0.2 : 0));
    archetype = rng() < busChance ? 'transit' : 'logistics';
  } else {
    if (profile === 'cautious') {
      archetype = 'defensive';
    } else if (profile === 'normal') {
      const steadyCourierP = vClass === 'motor' ? (mix.courierShare ?? 0.42) * 0.18 : 0.05;
      archetype = rng() < steadyCourierP ? 'courier' : 'commuter';
    } else {
      const courierBase = mix.courierShare ?? 0.42;
      const courierP = vClass === 'motor' ? courierBase : courierBase * 0.35;
      archetype = rng() < courierP ? 'courier' : 'hurried';
    }
  }

  const pool = SPRITE_POOL[vClass][archetype] ?? SPRITES[vClass];
  const spriteKey = pool[Math.floor(rng() * pool.length)];
  return { profile, archetype, spriteKey };
}

/**
 * Evaluates contextual weather + darkness scaling for a specific driver archetype.
 * Preserves wet-friction physics while modeling distinct behavioral adaptation across rider types.
 */
export function computeContextualBehaviorMod(
  traits: DriverCognitiveTraits,
  weather: WeatherPhysicsProfile,
  ambientDarkness: number
): {
  speedWeatherGrace: number;
  seepageWeatherScale: number;
  headwayCautionBoost: number;
} {
  const rain = Math.max(0, weather.rainIntensity);
  const dark = Math.max(0, Math.min(1, ambientDarkness / 0.3));
  if (rain < 0.05 && dark < 0.05) {
    return { speedWeatherGrace: 1.0, seepageWeatherScale: 1.0, headwayCautionBoost: 1.0 };
  }

  // Aggressive/hurried riders drop reckless weaving sharply in heavy rain & darkness;
  // couriers stay nimble with wider braking margin; defensive/transit widen margins notably at night.
  if (traits.archetype === 'hurried') {
    return {
      speedWeatherGrace: 1.0 - 0.05 * rain - 0.02 * dark,
      seepageWeatherScale: Math.max(0.5, 1.0 - 0.38 * rain - 0.16 * dark),
      headwayCautionBoost: 1.0 + 0.14 * rain + 0.08 * dark,
    };
  }
  if (traits.archetype === 'courier') {
    return {
      speedWeatherGrace: 1.0 + 0.04 * rain,
      seepageWeatherScale: Math.max(0.7, 1.0 + 0.15 * rain - 0.1 * dark),
      headwayCautionBoost: 1.0 + 0.1 * rain + 0.06 * dark,
    };
  }
  if (traits.archetype === 'defensive' || traits.archetype === 'transit') {
    return {
      speedWeatherGrace: 1.0 - 0.04 * rain - 0.04 * dark,
      seepageWeatherScale: Math.max(0.4, 1.0 - 0.45 * rain - 0.25 * dark),
      headwayCautionBoost: 1.0 + 0.12 * rain + 0.12 * dark,
    };
  }
  return {
    speedWeatherGrace: 1.0 - 0.02 * dark,
    seepageWeatherScale: Math.max(0.55, 1.0 - 0.14 * dark),
    headwayCautionBoost: 1.0 + 0.05 * rain + 0.06 * dark,
  };
}
