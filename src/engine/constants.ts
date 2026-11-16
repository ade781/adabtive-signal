import { ArmId, SimConfig, VehicleClass } from './types';

export const DEFAULT_CONFIG: SimConfig = {
  laneWidth: 3.5,
  roadWidthPerDirection: 7.0,
  roadLength: 75,
  lanesPerDirection: 2,
  motorRate: 30,
  carRate: 22,
  heavyRate: 5,
  turnLeftPct: 25,
  turnStraightPct: 55,
  turnRightPct: 20,
  greenDuration: 15,
  yellowDuration: 3,
  allRedDuration: 1.5,
  adaptiveSignal: true,
  armWeights: { north: 1, east: 1, south: 1, west: 1 },
};

export const QUEUE_SPEED_THRESHOLD = 1.2;

export const ARM_ORDER: ArmId[] = ['north', 'east', 'south', 'west'];

export const SPRITES: Record<VehicleClass, string[]> = {
  motor: [
    '/assets/vehicles/moto-commuter.svg',
    '/assets/vehicles/moto-scooter.svg',
    '/assets/vehicles/moto-sport.svg',
    '/assets/vehicles/moto-delivery-box.svg',
    '/assets/vehicles/moto-cruiser.svg',
    '/assets/vehicles/moto-ev-white.svg',
  ],
  car: [
    '/assets/vehicles/car-sedan-navy.svg',
    '/assets/vehicles/car-sedan-white.svg',
    '/assets/vehicles/car-suv-slate.svg',
    '/assets/vehicles/car-compact-teal.svg',
    '/assets/vehicles/car-taxi-yellow.svg',
    '/assets/vehicles/car-van-delivery.svg',
    '/assets/vehicles/car-pickup-slate.svg',
    '/assets/vehicles/car-ev-mint.svg',
    '/assets/vehicles/car-luxury-black.svg',
  ],
  heavy: [
    '/assets/vehicles/truck-box.svg',
    '/assets/vehicles/truck-heavy.svg',
    '/assets/vehicles/bus-city.svg',
    '/assets/vehicles/truck-dump.svg',
    '/assets/vehicles/truck-tanker.svg',
  ],
};

// Calibrated for responsive Indonesian urban start-up & smooth braking
export const VEHICLE_SPECS: Record<
  VehicleClass,
  { length: number; width: number; maxSpeed: number; maxAccel: number; comfortDecel: number; minGap: number; timeHeadway: number }
> = {
  motor: { length: 2.0, width: 0.85, maxSpeed: 13.8, maxAccel: 4.0, comfortDecel: 3.4, minGap: 0.85, timeHeadway: 0.65 },
  car: { length: 4.5, width: 1.85, maxSpeed: 13.5, maxAccel: 2.8, comfortDecel: 2.8, minGap: 1.5, timeHeadway: 0.85 },
  heavy: { length: 9.2, width: 2.5, maxSpeed: 10.2, maxAccel: 1.5, comfortDecel: 2.2, minGap: 2.3, timeHeadway: 1.3 },
};

export type DriverProfile = 'cautious' | 'normal' | 'aggressive';

export const PROFILE_MULT: Record<DriverProfile, { speed: number; accel: number }> = {
  cautious: { speed: 0.88, accel: 0.9 },
  normal: { speed: 1.0, accel: 1.0 },
  aggressive: { speed: 1.15, accel: 1.14 },
};
