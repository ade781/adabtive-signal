import { Point2D, SignalColor } from './types';

export type MovementKind = 'left' | 'straight' | 'right' | 'uturn';
export type SignalPhasePreset =
  | '4-phase-split'
  | '2-phase-simultaneous'
  | '3-phase'
  | '4-phase-protected-right'
  | 'custom';

export type MovementSignalState =
  | 'protected-green'
  | 'permissive-green'
  | 'yellow'
  | 'red'
  | 'slip-yield';

export type WeatherCondition = 'clear' | 'light-rain' | 'heavy-rain';
export type TimeOfDayMode = 'static' | 'morning-rush' | 'evening-rush' | 'full-day-24h';

export interface EnvironmentConfig {
  weather: WeatherCondition;
  dynamicWeather?: boolean;
  timeMode: TimeOfDayMode;
  startHour?: number;
  /** Simulated minutes advanced per 1 simulation second (default 0.75 => 150 min in 200s) */
  timeCompression?: number;
}

export interface SlipLaneDef {
  enabled: boolean;
  /** Width of the dedicated left-turn channel in meters (2.8 - 4.5m) */
  width: number;
  /** Distance upstream of stop line where the slip lane branches out (10 - 30m) */
  islandSetback: number;
  /** Whether vehicles yield to merging traffic on destination arm */
  yieldControl: 'free' | 'yield';
}

export interface UTurnBayDef {
  enabled: boolean;
  /** Distance upstream of stop line where U-turn bay opens (16 - 40m) */
  distanceBeforeStop: number;
}

export interface ArmDef {
  id: string;
  label: string;
  /** Direction pointing OUTWARD from intersection center in Canvas 2D Y-down degrees: 0=E, 90=S, 180=W, 270=N */
  angleDeg: number;
  /** Approach/exit road length in meters (40 - 200m) */
  length: number;
  /** Number of inbound lanes approaching intersection (1 - 4) */
  inLanes: number;
  /** Number of outbound lanes leaving intersection (1 - 4); can differ from inLanes (bottleneck!) */
  outLanes: number;
  /** Individual widths per inbound lane (index 0 = innermost near center/median) */
  inLaneWidths: number[];
  /** Individual widths per outbound lane (index 0 = innermost near center/median) */
  outLaneWidths: number[];
  /** Physical center median width in meters (0 = no physical median -> allows oncoming overtaking!) */
  medianWidth: number;
  /** Radius of the curb fillet on the left (inbound outer) side of this arm (2.0 - 14.0m) */
  curbRadiusLeft: number;
  /** Extra approach flare width on the outer left side near stop line (0 - 3.5m) */
  curbFlareLeft?: number;
  /** Per-arm Left Turn On Red (Belok Kiri Langsung) permission */
  leftTurnOnRed: boolean;
  /** Dedicated channelized left-turn slip lane + triangular splitter island */
  slipLane?: SlipLaneDef;
  /** Pre-intersection U-turn opening */
  uTurnBay?: UTurnBayDef;
  /** Motorcycle stop-line pocket (RHK) */
  motorBoxEnabled: boolean;
  /** Relative arrival demand weight */
  demandWeight: number;
  /** Optional per-arm base green duration (seconds) */
  baseGreenDuration?: number;
}

export interface MovementPermission {
  armId: string;
  movements: MovementKind[];
  mode: 'protected' | 'permissive';
}

export interface SignalPhaseDef {
  id: string;
  label: string;
  permissions: MovementPermission[];
  baseGreen: number;
  minGreen?: number;
  yellowDuration: number;
  allRedDuration: number;
}

export interface LandmarkItem {
  id: string;
  assetKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationRad: number;
  label?: string;
}

export interface IntersectionTopology {
  id: string;
  name: string;
  description?: string;
  city?: string;
  source?: string;
  /** Optional static map underlay path under public/assets/maps/ */
  staticMapImage?: string;
  arms: ArmDef[];
  phasePreset: SignalPhasePreset;
  phases: SignalPhaseDef[];
  yellowBoxEnabled: boolean;
  landmarks?: LandmarkItem[];
  /** Default traffic parameters when loaded as a blueprint */
  defaultTraffic?: {
    motorRate: number;
    carRate: number;
    heavyRate: number;
    turnLeftPct: number;
    turnStraightPct: number;
    turnRightPct: number;
    uTurnPct?: number;
    greenDuration: number;
    yellowDuration: number;
    allRedDuration: number;
  };
}

export interface CompiledArmGeometry {
  def: ArmDef;
  angleRad: number;
  /** Unit vector pointing OUTWARD from center along arm axis */
  outDir: Point2D;
  /** Unit vector pointing INWARD toward center (inbound traffic travel direction) */
  inDir: Point2D;
  /** Unit vector pointing 90° LEFT of inDir (outward toward inbound curb in LHT) */
  inLeftNormal: Point2D;
  /** Total inbound carriageway width (sum of inLaneWidths) */
  inWidth: number;
  /** Total outbound carriageway width (sum of outLaneWidths) */
  outWidth: number;
  /** Half of physical center median */
  halfMedian: number;
  /** Distance from center (0,0) to stop line / exit line along outDir */
  setback: number;
  /** Center offsets (measured from centerline 0 along inLeftNormal) for each inbound lane */
  inLaneCenters: number[];
  /** Center offsets (measured from centerline 0 along -inLeftNormal) for each outbound lane */
  outLaneCenters: number[];
  /** Neighbor arm immediately clockwise (to the LEFT of inbound traffic -> left-turn destination in LHT!) */
  leftNeighborArmId: string;
  /** Neighbor arm immediately counter-clockwise (to the RIGHT of inbound traffic -> right-turn destination) */
  rightNeighborArmId: string;
  /** Arm most directly opposite this arm (straight destination, if any) */
  straightArmId: string | null;
  /** Map from MovementKind -> destination armId */
  destByMovement: Partial<Record<MovementKind, string>>;
  /** Map from destination armId -> MovementKind */
  movementByDest: Record<string, MovementKind>;
  /** Signal pole world position */
  signalPos: Point2D;
}

export interface IslandPolygon {
  armId: string;
  destArmId: string;
  points: Point2D[];
  centroid: Point2D;
  slipLaneCenterPts: Point2D[];
  slipLaneWidth: number;
}

export interface SplineSample {
  x: number;
  y: number;
  heading: number;
  /** Signed curvature kappa = d(heading)/ds in rad/m (0 on straight segments) */
  curvature: number;
}

export interface CompiledMovementPath {
  key: string; // `${originArmId}:${destArmId}:${originLane}:${isSlip ? 'slip' : 'main'}`
  originArmId: string;
  destArmId: string;
  movement: MovementKind;
  originLane: number;
  destLane: number;
  isSlipLane: boolean;
  isUTurn: boolean;
  stopLineDist: number;
  exitLineDist: number;
  totalPathLength: number;
  /** Minimum radius of curvature along the curve (Infinity if straight) */
  minRadius: number;
  /** Sampled points inside the curve for rendering & conflict detection */
  curvePoints: Point2D[];
  sample: (dist: number) => SplineSample;
  /** Fast curvature lookahead max(|kappa|) in [sStart, sEnd] */
  maxCurvatureInRange: (sStart: number, sEnd: number) => number;
}

export interface ConflictZone {
  id: string;
  pathKeyA: string;
  pathKeyB: string;
  originArmA: string;
  originArmB: string;
  movementA: MovementKind;
  movementB: MovementKind;
  sA: number;
  sB: number;
  point: Point2D;
  type: 'crossing' | 'merge' | 'opposing-turn';
  /** Which movement has natural LHT right-of-way when both are active */
  priority: 'A' | 'B' | 'equal';
}

export interface CompiledTopology {
  topology: IntersectionTopology;
  armOrder: string[];
  armsById: Record<string, CompiledArmGeometry>;
  /** Center intersection polygon vertices ordered around (0,0) */
  centerPolygon: Point2D[];
  /** Triangular splitter islands for slip lanes */
  islands: IslandPolygon[];
  /** All compiled movement paths indexed by key */
  pathsByKey: Record<string, CompiledMovementPath>;
  /** Quick lookup: originArmId -> movement -> originLane -> CompiledMovementPath */
  pathLookup: Record<string, Partial<Record<MovementKind, CompiledMovementPath[]>>>;
  /** Slip lane paths indexed by originArmId */
  slipPathsByArm: Record<string, CompiledMovementPath>;
  /** Precomputed geometric conflict zones inside the intersection */
  conflictZones: ConflictZone[];
  /** Conflict zones grouped by pathKey for O(1) runtime lookup */
  conflictsByPathKey: Record<string, ConflictZone[]>;
  /** Max world extent (meters from origin) for viewport sizing */
  maxExtentMeters: number;
}

export interface ActiveSignalSnapshot {
  activePhaseIndex: number;
  activePhaseLabel: string;
  phaseCount: number;
  /** Per-arm main display color */
  armColors: Record<string, SignalColor>;
  /** Per-arm optional protected right-turn arrow color */
  armRightArrowColors: Record<string, SignalColor | undefined>;
}
