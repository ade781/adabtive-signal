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

  // Traffic Mix (total arrival rate across all 4 arms in vehicles/min)
  motorRate: number;             // vehicles/min total across all 4 arms
  carRate: number;
  heavyRate: number;

  // Turn probabilities (must sum to 100)
  turnLeftPct: number;
  turnStraightPct: number;
  turnRightPct: number;

  // Signal Timing (seconds) - 4-phase split (N -> E -> S -> W)
  greenDuration: number;         // seconds (base or max green)
  armGreenDurations?: Record<ArmId, number>; // optional per-arm green duration (seconds)
  yellowDuration: number;        // seconds
  allRedDuration: number;        // seconds
  adaptiveSignal: boolean;       // enable dynamic green extension
  armWeights?: Record<ArmId, number>; // relative demand weight per arm

  // Indonesian Traffic & Road Metadata
  leftTurnOnRed: boolean;        // Belok Kiri Langsung (LTOR)
  motorSwarmMode: boolean;       // 3-4 column motorcycle packing & tighter seepage
  motorBoxEnabled: boolean;      // Kotak Khusus Sepeda Motor / RHK visual & stop-line pocket
  hasMedian: boolean;            // whether approach arms have a physical center median
  armNames?: Record<ArmId, string>; // optional real street names per arm

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
  originArm: ArmId;
  destArm: ArmId;
  turn: TurnIntent;
  laneIndex: number;             // 0 = innermost (near median), L-1 = outermost (near curb)
  lateralOffset: number;         // meters offset inside lane (mainly for motorcycles)
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
}

export interface PhaseRecord {
  phaseIndex: number;
  cycleNumber: number;
  arm: ArmId;
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
}

export interface SimStats {
  simTime: number;               // total elapsed sim seconds
  currentPhaseExited: { motor: number; car: number; heavy: number; total: number };
  currentCycleExited: { motor: number; car: number; heavy: number; total: number };
  totalExitedAllTime: number;
  avgWaitTime: number;           // seconds per exited vehicle
  maxWaitTime: number;           // max observed waiting time (seconds)
  throughputPerHour: number;     // projected vehicles/hour
  boxStuckCount: number;         // vehicles stalled inside intersection box > 2s
  activeQueueCount: number;
  queueByArm: Record<ArmId, number>;
  phaseHistory: PhaseRecord[];   // newest first
  cycleHistory: CycleRecord[];   // newest first
}

export interface SimSnapshot {
  config: SimConfig;
  signal: SignalState;
  vehicles: Vehicle[];
  stats: SimStats;
}
