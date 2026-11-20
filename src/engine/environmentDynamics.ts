import { EnvironmentConfig, TimeOfDayMode, WeatherCondition } from './topologyTypes';
import { VehicleClass } from './types';

/**
 * Unified empirical weather physics profile calibrated from FHWA / HCM & PKJI 2023 microsimulation studies.
 * All deceleration, lateral grip, reaction, and sight-distance calculations consume this single profile
 * so friction scaling remains 100% consistent across IDM, cornering, yellow dilemma, MOBIL, and overtaking.
 */
export interface WeatherPhysicsProfile {
  condition: WeatherCondition;
  label: string;
  /** Tire-road grip factor mu relative to dry asphalt (1.0 / 0.78 / 0.58) */
  friction: number;
  /** Desired speed multipliers per vehicle class */
  speedMult: Record<VehicleClass, number>;
  /** Time headway T multiplier */
  headwayMult: number;
  /** Minimum jam gap s0 multiplier */
  minGapMult: number;
  /** Comfortable deceleration b multiplier (drivers brake earlier & smoother on wet road) */
  comfortDecelMult: number;
  /** Emergency max deceleration multiplier (bound by wet friction) */
  emergencyDecelMult: number;
  /** Launch acceleration traction multiplier */
  accelMult: number;
  /** Start-up & hazard reaction time multiplier */
  reactionMult: number;
  /** Lateral grip multiplier for cornering speed sqrt(a_lat * R) */
  lateralGripMult: number;
  /** Perception / sight distance in meters */
  sightDistance: number;
  /** Motorcycle filtering / swarm aggressiveness multiplier */
  seepageScale: number;
  /** Critical gap acceptance multiplier for permissive cross-turns & merges */
  gapAcceptanceMult: number;
  /** Whether oncoming-lane overtaking is allowed under current visibility/grip */
  allowOncomingOvertake: boolean;
  /** Visual rain intensity [0..1] for lightweight canvas overlay */
  rainIntensity: number;
}

export const WEATHER_PROFILES: Record<WeatherCondition, WeatherPhysicsProfile> = {
  clear: {
    condition: 'clear',
    label: 'Cerah (Kering)',
    friction: 1.0,
    speedMult: { motor: 1.0, car: 1.0, heavy: 1.0 },
    headwayMult: 1.0,
    minGapMult: 1.0,
    comfortDecelMult: 1.0,
    emergencyDecelMult: 1.0,
    accelMult: 1.0,
    reactionMult: 1.0,
    lateralGripMult: 1.0,
    sightDistance: 55,
    seepageScale: 1.0,
    gapAcceptanceMult: 1.0,
    allowOncomingOvertake: true,
    rainIntensity: 0,
  },
  'light-rain': {
    condition: 'light-rain',
    label: 'Gerimis (Aspal Basah)',
    friction: 0.78,
    speedMult: { motor: 0.88, car: 0.94, heavy: 0.94 },
    headwayMult: 1.2,
    minGapMult: 1.2,
    comfortDecelMult: 0.85,
    emergencyDecelMult: 0.82,
    accelMult: 0.88,
    reactionMult: 1.15,
    lateralGripMult: 0.8,
    sightDistance: 36,
    seepageScale: 0.72,
    gapAcceptanceMult: 1.15,
    allowOncomingOvertake: true,
    rainIntensity: 0.35,
  },
  'heavy-rain': {
    condition: 'heavy-rain',
    label: 'Hujan Lebat',
    friction: 0.58,
    speedMult: { motor: 0.7, car: 0.82, heavy: 0.82 },
    headwayMult: 1.45,
    minGapMult: 1.5,
    comfortDecelMult: 0.68,
    emergencyDecelMult: 0.65,
    accelMult: 0.74,
    reactionMult: 1.35,
    lateralGripMult: 0.62,
    sightDistance: 24,
    seepageScale: 0.38,
    gapAcceptanceMult: 1.35,
    allowOncomingOvertake: false,
    rainIntensity: 0.85,
  },
};

export interface EnvironmentState {
  timeMode: TimeOfDayMode;
  clockHour: number; // 0..24
  clockLabel: string; // e.g. '07:15 WIB'
  periodLabel: string; // e.g. 'Puncak Pagi'
  demandMultiplier: number; // NHPP total arrival multiplier
  classMultipliers: Record<VehicleClass, number>;
  /** Directional tidal bias [-0.35..+0.35]: positive boosts inbound-city arms (N/W), negative boosts outbound (S/E) */
  tidalShift: number;
  weather: WeatherPhysicsProfile;
  /** Subtle ambient lighting darkness [0..0.38] for dusk/night in 24h mode */
  ambientDarkness: number;
}

export const DEFAULT_ENVIRONMENT: EnvironmentConfig = {
  weather: 'clear',
  dynamicWeather: false,
  timeMode: 'static',
  startHour: 7.0,
  timeCompression: 0.75,
};

function gaussian(x: number, mean: number, sigma: number): number {
  const z = (x - mean) / sigma;
  return Math.exp(-0.5 * z * z);
}

export function formatClockWib(hourFloat: number): string {
  const wrapped = ((hourFloat % 24) + 24) % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.floor((wrapped - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} WIB`;
}

/**
 * Indonesian urban multi-peak demand curve (PKJI 2023 / 15-minute PHF fluctuation).
 * Returns demand multiplier centered around ~1.0 at peak hours, ~0.35 at off-peak night,
 * and up to ~1.35 during the tight 15-minute morning/evening surge.
 */
export function evaluateUrbanDemandAtHour(hourFloat: number): {
  demandMultiplier: number;
  classMultipliers: Record<VehicleClass, number>;
  tidalShift: number;
  periodLabel: string;
  ambientDarkness: number;
} {
  const h = ((hourFloat % 24) + 24) % 24;

  // Multi-peak Indonesian urban profile:
  // Morning peak (07:30, sharp), Midday minor peak (12:30), Evening peak (17:30, broader/higher)
  const baseFloor = 0.24;
  const morningPeak = 0.96 * gaussian(h, 7.45, 0.85);
  const middayPeak = 0.44 * gaussian(h, 12.5, 1.5);
  const eveningPeak = 1.04 * gaussian(h, 17.45, 1.15);
  const lateEvening = 0.22 * gaussian(h, 20.5, 1.2);

  // 15-minute PHF micro-surge wave (Indonesian urban PHF ~ 0.78 - 0.90)
  const phfRipple = 1 + 0.1 * Math.sin((h * 4 * Math.PI * 2) / 1.0);
  const demandMultiplier = Math.max(
    0.2,
    Math.min(1.48, (baseFloor + morningPeak + middayPeak + eveningPeak + lateEvening) * phfRipple)
  );

  // Vehicle mix shifts across the day
  const isNight = h >= 21.5 || h < 5.2;
  const isMorningCommute = h >= 6.2 && h <= 8.8;
  const isMidday = h >= 11.0 && h <= 14.5;
  const isEveningCommute = h >= 16.0 && h <= 19.0;

  const motorMult = isMorningCommute ? 1.18 : isEveningCommute ? 1.12 : isNight ? 0.65 : 1.0;
  const carMult = isMidday ? 1.15 : isEveningCommute ? 1.08 : isNight ? 0.78 : 1.0;
  // Logistics/heavy trucks surge on urban ringroads late at night/early morning
  const heavyMult = isNight ? 1.85 : isMorningCommute ? 0.75 : isMidday ? 1.15 : 0.95;

  // Tidal directional flow: morning favors inbound (north/west), evening reverses (south/east)
  const tidalShift = 0.28 * gaussian(h, 7.4, 1.0) - 0.28 * gaussian(h, 17.4, 1.2);

  let periodLabel = 'Normal Siang';
  if (h >= 6.25 && h < 8.75) periodLabel = 'Jam Sibuk Pagi';
  else if (h >= 8.75 && h < 11.25) periodLabel = 'Transisi Pagi';
  else if (h >= 11.25 && h < 14.0) periodLabel = 'Puncak Siang';
  else if (h >= 14.0 && h < 16.0) periodLabel = 'Siang Landai';
  else if (h >= 16.0 && h < 18.75) periodLabel = 'Jam Sibuk Sore';
  else if (h >= 18.75 && h < 21.5) periodLabel = 'Malam Ramai';
  else periodLabel = 'Dini Hari / Sepi';

  // Ambient darkness for 24h cycle visuals
  let ambientDarkness = 0;
  if (h >= 18.0 || h < 5.5) {
    if (h >= 18.0 && h < 19.5) ambientDarkness = ((h - 18.0) / 1.5) * 0.28;
    else if (h >= 4.5 && h < 5.5) ambientDarkness = ((5.5 - h) / 1.0) * 0.28;
    else ambientDarkness = 0.28;
  }

  return {
    demandMultiplier,
    classMultipliers: { motor: motorMult, car: carMult, heavy: heavyMult },
    tidalShift,
    periodLabel,
    ambientDarkness,
  };
}

export function evaluateEnvironment(simTime: number, rawEnv?: EnvironmentConfig): EnvironmentState {
  const env: EnvironmentConfig = {
    ...DEFAULT_ENVIRONMENT,
    ...rawEnv,
  };

  let activeWeatherKey: WeatherCondition = env.weather;
  if (env.dynamicWeather) {
    // Automated weather cycle every 180s: 0-60s clear, 60-105s light-rain, 105-150s heavy-rain, 150-180s light-rain
    const cycleT = ((simTime % 180) + 180) % 180;
    if (cycleT < 60) activeWeatherKey = 'clear';
    else if (cycleT < 105) activeWeatherKey = 'light-rain';
    else if (cycleT < 150) activeWeatherKey = 'heavy-rain';
    else activeWeatherKey = 'light-rain';
  }
  const weather = WEATHER_PROFILES[activeWeatherKey];

  if (env.timeMode === 'static') {
    return {
      timeMode: 'static',
      clockHour: env.startHour ?? 7.5,
      clockLabel: 'Konstan',
      periodLabel: 'Arus Tetap (100%)',
      demandMultiplier: 1.0,
      classMultipliers: { motor: 1.0, car: 1.0, heavy: 1.0 },
      tidalShift: 0,
      weather,
      ambientDarkness: activeWeatherKey === 'heavy-rain' ? 0.14 : activeWeatherKey === 'light-rain' ? 0.06 : 0,
    };
  }

  // Time-of-day dynamic progression
  let startH = 6.25;
  let windowHours = 2.5;
  let compressionMinPerSimSec = env.timeCompression ?? 0.75; // default ~150 min in 200s sim

  if (env.timeMode === 'morning-rush') {
    startH = env.startHour ?? 6.25;
    windowHours = 2.75; // 06:15 -> 09:00
    compressionMinPerSimSec = env.timeCompression ?? 0.85;
  } else if (env.timeMode === 'evening-rush') {
    startH = env.startHour ?? 15.75;
    windowHours = 3.25; // 15:45 -> 19:00
    compressionMinPerSimSec = env.timeCompression ?? 0.95;
  } else if (env.timeMode === 'full-day-24h') {
    startH = env.startHour ?? 5.5;
    windowHours = 24.0;
    compressionMinPerSimSec = env.timeCompression ?? 4.0; // 24h in 360s sim
  }

  const elapsedHours = (simTime * compressionMinPerSimSec) / 60;
  const clockHour =
    env.timeMode === 'full-day-24h'
      ? (startH + elapsedHours) % 24
      : startH + (elapsedHours % windowHours);

  const curve = evaluateUrbanDemandAtHour(clockHour);
  const rainDarkBoost = activeWeatherKey === 'heavy-rain' ? 0.1 : activeWeatherKey === 'light-rain' ? 0.04 : 0;

  return {
    timeMode: env.timeMode,
    clockHour,
    clockLabel: formatClockWib(clockHour),
    periodLabel: curve.periodLabel,
    demandMultiplier: curve.demandMultiplier,
    classMultipliers: curve.classMultipliers,
    tidalShift: curve.tidalShift,
    weather,
    ambientDarkness: Math.min(0.38, curve.ambientDarkness + rainDarkBoost),
  };
}

/**
 * Generates sample points along the demand curve for lightweight sparkline preview in UI.
 */
export function sampleDemandCurve(mode: TimeOfDayMode, samples = 24): { hour: number; mult: number }[] {
  if (mode === 'static') {
    return Array.from({ length: samples }, (_, i) => ({ hour: 6 + (i / samples) * 12, mult: 1 }));
  }
  const startH = mode === 'morning-rush' ? 6.25 : mode === 'evening-rush' ? 15.75 : 5.5;
  const span = mode === 'morning-rush' ? 2.75 : mode === 'evening-rush' ? 3.25 : 24.0;
  const out: { hour: number; mult: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const h = (startH + (i / (samples - 1)) * span) % 24;
    out.push({ hour: h, mult: evaluateUrbanDemandAtHour(h).demandMultiplier });
  }
  return out;
}
