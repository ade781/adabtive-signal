import {
  ActiveSignalSnapshot,
  EnvironmentConfig,
  IntersectionTopology,
  MovementKind,
  SignalPhasePreset,
  TimeOfDayMode,
  WeatherCondition,
} from './topologyTypes';

export type ArmId = 'north' | 'east' | 'south' | 'west';
export type TurnIntent = 'left' | 'straight' | 'right';
export type VehicleClass = 'motor' | 'car' | 'heavy';
export type SignalColor = 'green' | 'yellow' | 'red';

export interface SimConfig {
  // Road Geometry (unified: roadWidthPerDirection = lanesPerDirection * laneWidth)
  laneWidth: number;             // meters per lane (2.8 - 4.2m)
  roadWidthPerDirection: number; // derived meters (lanesPerDirection * laneWidth)
  roadLength: number;            // meters approach length (40 - 200m)
  lanesPerDirection: number;     // 1 - 4 lanes

  // Traffic Mix (total arrival rate across all arms in vehicles/min)
  motorRate: number;             // vehicles/min total across all arms
  carRate: number;
  heavyRate: number;

  // Turn probabilities (must sum to 100)
  turnLeftPct: number;
  turnStraightPct: number;
  turnRightPct: number;
  uTurnPct?: number;             // optional U-turn percentage when U-turn bays are present

  // Signal Timing (seconds)
  greenDuration: number;         // seconds (base or max green)
  armGreenDurations?: Record<ArmId, number>; // optional per-arm green duration (seconds)
  yellowDuration: number;        // seconds
  allRedDuration: number;        // seconds
  adaptiveSignal: boolean;       // enable dynamic green extension
  armWeights?: Record<ArmId, number>; // relative demand weight per arm
  signalPhasePreset?: SignalPhasePreset; // 4-phase-split | 2-phase-simultaneous | 3-phase | 4-phase-protected-right | custom

  // Indonesian Traffic & Road Metadata
  leftTurnOnRed: boolean;        // Belok Kiri Langsung (LTOR)
  motorSwarmMode: boolean;       // 3-4 column motorcycle packing & tighter seepage
  motorBoxEnabled: boolean;      // Kotak Khusus Sepeda Motor / RHK visual & stop-line pocket
  hasMedian: boolean;            // whether approach arms have a physical center median
  armNames?: Record<ArmId, string>; // optional real street names per arm

  // v2 Smart AI, Yellow Box, Environment & Custom Draw Topology
  yellowBoxEnabled?: boolean;    // Yellow Box Junction anti-gridlock enforcement & visual
  driverDiscipline?: number;     // 0.0 (chaotic) .. 1.0 (strictly disciplined), default 0.72
  smartOvertaking?: boolean;     // MOBIL active car/motor overtaking (default true)
  oncomingOvertaking?: boolean;  // Allow overtaking via oncoming lane when no physical median (default true)
  connectedVehicleRatio?: number; // 0.0 .. 1.0 share of V2V/CAV-equipped vehicles (default 0.0)
  environment?: EnvironmentConfig; // Time-of-Day demand curve + Weather physics
  customTopology?: IntersectionTopology; // Optional custom topology created in Draw page or Giwangan blueprint

  // Optional scenario metadata for Excel evaluation report & landmark rendering
  environmentId?: string;
  scenarioName?: string;
  scenarioNotes?: string;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Vehicle {
  id: number;
  vClass: VehicleClass;
  spriteKey: string;             // path under /assets/vehicles/
  originArm: string;             // 'north'|'east'|'south'|'west' or custom arm id
  destArm: string;
  turn: MovementKind;
  laneIndex: number;             // 0 = innermost (near median), L-1 = outermost (near curb)
  destLaneIndex?: number;
  lateralOffset: number;         // meters offset inside lane (+ = left/curb, - = right/median/oncoming)
  length: number;                // meters
  width: number;                 // meters
  maxSpeed: number;              // m/s
  maxAccel: number;              // m/s^2
  comfortDecel: number;          // m/s^2
  minGap: number;                // m
  timeHeadway: number;           // s
  speed: number;                 // m/s
  distanceAlongPath: number;     // meters from spawn
  totalPathLength: number;       // meters
  stopLineDist: number;          // meters from spawn to stop line
  exitLineDist: number;          // meters from spawn to intersection exit
  x: number;                     // world meters (+X East, +Y South)
  y: number;                     // world meters
  heading: number;               // radians (0 = East/+X, -PI/2 = North/-Y)
  hasExitedIntersection: boolean;
  waitingTime: number;           // seconds spent v < QUEUE_SPEED_THRESHOLD (1.2 m/s)
  laneChangeDir?: 'left' | 'right' | null;
  isSlipLane?: boolean;
  isUTurn?: boolean;
  overtakeState?: 'none' | 'pull_out' | 'passing' | 'merge_back' | 'abort';
  isYielding?: boolean;
  holdingYellowBox?: boolean;
  brakingHard?: boolean;
  isReversing?: boolean;
  crossingMarking?: boolean;
}

export interface PhaseRecord {
  phaseIndex: number;
  cycleNumber: number;
  arm: ArmId;
  phaseArmIds?: string[];
  phaseLabel?: string;
  greenDuration: number;
  exitedMotor: number;
  exitedCar: number;
  exitedHeavy: number;
  exitedTotal: number;
  queueAtStart: number;
  queueAtEnd: number;
}

export interface CycleRecord {
  cycleNumber: number;
  totalDuration: number;
  totalGreenDuration?: number;
  exitedMotor: number;
  exitedCar: number;
  exitedHeavy: number;
  exitedTotal: number;
  avgQueue: number;
}

export interface SignalState {
  activeArm: ArmId;
  activeColor: SignalColor;
  phaseRemaining: number;        // seconds remaining in current sub-phase
  phaseElapsed: number;
  cycleNumber: number;
  armLights: Record<ArmId, SignalColor>;
  // Multi-phase & arbitrary-arm signal extension
  multiPhase?: ActiveSignalSnapshot;
}

export interface EnvironmentTelemetry {
  timeMode: TimeOfDayMode;
  clockHour: number;
  clockLabel: string;
  periodLabel: string;
  demandMultiplier: number;
  weather: WeatherCondition;
  weatherLabel: string;
  friction: number;
  rainIntensity: number;
  ambientDarkness: number;
}

export interface SimStats {
  simTime: number;               // total elapsed sim seconds
  currentPhaseExited: { motor: number; car: number; heavy: number; total: number };
  currentCycleExited: { motor: number; car: number; heavy: number; total: number };
  totalExitedAllTime: number;
  avgWaitTime: number;           // seconds per exited vehicle
  maxWaitTime: number;           // max observed waiting time (seconds)
  throughputPerHour: number;     // projected vehicles/hour
  rollingThroughputPerHour?: number; // rolling 60s window vehicles/hour
  rollingAvgWaitTime?: number;       // rolling 60s window average wait time
  boxStuckCount: number;         // vehicles stalled inside intersection box > 2s
  activeQueueCount: number;
  queueByArm: Record<ArmId, number>;
  queueByArmId?: Record<string, number>; // supports arbitrary N-arm IDs
  carOvertakeCount?: number;
  oncomingOvertakeCount?: number;
  yieldConflictCount?: number;
  yellowBoxHoldCount?: number;
  reverseRecoveryCount?: number;
  markingCrossCount?: number;
  environment?: EnvironmentTelemetry;
  phaseHistory: PhaseRecord[];   // newest first
  cycleHistory: CycleRecord[];   // newest first
}

export interface SimSnapshot {
  config: SimConfig;
  signal: SignalState;
  vehicles: Vehicle[];
  stats: SimStats;
}
