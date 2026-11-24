import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLE_SPECS } from '../../engine/constants';
import type {
  DriverArchetype,
  MapOverlayLayers,
  Vehicle,
  VehicleClass,
} from '../../engine/types';

export type VehicleVariantId =
  | 'moto-commuter'
  | 'moto-scooter'
  | 'moto-sport'
  | 'moto-delivery-box'
  | 'moto-cruiser'
  | 'moto-ev-white'
  | 'car-sedan-navy'
  | 'car-sedan-white'
  | 'car-suv-slate'
  | 'car-compact-teal'
  | 'car-taxi-yellow'
  | 'car-van-delivery'
  | 'car-pickup-slate'
  | 'car-ev-mint'
  | 'car-luxury-black'
  | 'bus-city'
  | 'truck-box'
  | 'truck-heavy'
  | 'truck-dump'
  | 'truck-tanker';

const SPRITE_TO_VARIANT = new Map<string, VehicleVariantId>([
  ['/assets/vehicles/moto-commuter.svg', 'moto-commuter'],
  ['moto-commuter', 'moto-commuter'],
  ['/assets/vehicles/moto-scooter.svg', 'moto-scooter'],
  ['moto-scooter', 'moto-scooter'],
  ['/assets/vehicles/moto-sport.svg', 'moto-sport'],
  ['moto-sport', 'moto-sport'],
  ['/assets/vehicles/moto-delivery-box.svg', 'moto-delivery-box'],
  ['moto-delivery-box', 'moto-delivery-box'],
  ['/assets/vehicles/moto-cruiser.svg', 'moto-cruiser'],
  ['moto-cruiser', 'moto-cruiser'],
  ['/assets/vehicles/moto-ev-white.svg', 'moto-ev-white'],
  ['moto-ev-white', 'moto-ev-white'],
  ['/assets/vehicles/car-sedan-navy.svg', 'car-sedan-navy'],
  ['car-sedan-navy', 'car-sedan-navy'],
  ['/assets/vehicles/car-sedan-white.svg', 'car-sedan-white'],
  ['car-sedan-white', 'car-sedan-white'],
  ['/assets/vehicles/car-suv-slate.svg', 'car-suv-slate'],
  ['car-suv-slate', 'car-suv-slate'],
  ['/assets/vehicles/car-compact-teal.svg', 'car-compact-teal'],
  ['car-compact-teal', 'car-compact-teal'],
  ['/assets/vehicles/car-taxi-yellow.svg', 'car-taxi-yellow'],
  ['car-taxi-yellow', 'car-taxi-yellow'],
  ['/assets/vehicles/car-van-delivery.svg', 'car-van-delivery'],
  ['car-van-delivery', 'car-van-delivery'],
  ['/assets/vehicles/car-pickup-slate.svg', 'car-pickup-slate'],
  ['car-pickup-slate', 'car-pickup-slate'],
  ['/assets/vehicles/car-ev-mint.svg', 'car-ev-mint'],
  ['car-ev-mint', 'car-ev-mint'],
  ['/assets/vehicles/car-luxury-black.svg', 'car-luxury-black'],
  ['car-luxury-black', 'car-luxury-black'],
  ['/assets/vehicles/bus-city.svg', 'bus-city'],
  ['bus-city', 'bus-city'],
  ['/assets/vehicles/truck-box.svg', 'truck-box'],
  ['truck-box', 'truck-box'],
  ['/assets/vehicles/truck-heavy.svg', 'truck-heavy'],
  ['truck-heavy', 'truck-heavy'],
  ['/assets/vehicles/truck-dump.svg', 'truck-dump'],
  ['truck-dump', 'truck-dump'],
  ['/assets/vehicles/truck-tanker.svg', 'truck-tanker'],
  ['truck-tanker', 'truck-tanker'],
]);

function resolveVariantId(spriteKey: string, vClass: VehicleClass): VehicleVariantId {
  const direct = SPRITE_TO_VARIANT.get(spriteKey);
  if (direct) return direct;
  if (vClass === 'motor') return 'moto-commuter';
  if (vClass === 'heavy') return 'truck-box';
  return 'car-sedan-navy';
}

const ARCHETYPE_HEX: Record<DriverArchetype, number> = {
  defensive: 0x10b981,
  commuter: 0x0ea5e9,
  hurried: 0xf43f5e,
  courier: 0xf59e0b,
  transit: 0x6366f1,
  logistics: 0x475569,
};

interface SwappableMesh {
  mesh: THREE.Mesh;
  normalMat: THREE.Material;
  dimMat: THREE.Material;
}

type BrakeState = 0 | 1 | 2; // 0 = off, 1 = idle slow, 2 = brakingHard
type TacticalCueKind = 0 | 1 | 2 | 3 | 4 | 5; // 0=none, 1=abort, 2=yellowBox, 3=yield, 4=caution, 5=frust

interface VehicleRig {
  variant: VehicleVariantId;
  vehicleId: number;
  poolIdx: number;
  root: THREE.Group;
  readPos: THREE.Vector3;
  pickMeshes: THREE.Object3D[];
  swappables: SwappableMesh[];
  // Animated/dynamic sub-parts
  leanGroup: THREE.Group | null;
  handlebarGroup: THREE.Group | null;
  steerAngle: number;
  leanAngle: number;
  headlightsMesh: THREE.Mesh;
  headlightCone: THREE.Mesh;
  brakeMesh: THREE.Mesh;
  brakeBloom: THREE.Mesh;
  reverseMesh: THREE.Mesh;
  blinkerLeftMesh: THREE.Mesh;
  blinkerRightMesh: THREE.Mesh;
  archetypeRing: THREE.Mesh;
  v2vArc: THREE.Mesh;
  tacticalHalo: THREE.Mesh;
  // Cached state flags to avoid redundant material swaps
  isDimmed: boolean;
  headlightsActive: boolean;
  brakeState: BrakeState;
  reverseActive: boolean;
  leftBlinkerActive: boolean;
  rightBlinkerActive: boolean;
  lastArchetype: DriverArchetype | null;
  lastTacKind: TacticalCueKind;
}

interface SharedMaterials {
  tire: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  darkTrim: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  dimBody: THREE.MeshStandardMaterial;
  dimGlass: THREE.MeshStandardMaterial;
  dimTire: THREE.MeshStandardMaterial;
  headlightOff: THREE.MeshStandardMaterial;
  headlightOn: THREE.MeshStandardMaterial;
  headlightCone: THREE.MeshBasicMaterial;
  brakeOff: THREE.MeshStandardMaterial;
  brakeIdle: THREE.MeshStandardMaterial;
  brakeHard: THREE.MeshStandardMaterial;
  brakeBloom: THREE.MeshBasicMaterial;
  reverseOn: THREE.MeshStandardMaterial;
  blinkerOff: THREE.MeshStandardMaterial;
  blinkerOn: THREE.MeshStandardMaterial;
  taxiCrownOn: THREE.MeshStandardMaterial;
  v2vArc: THREE.MeshBasicMaterial;
  selectedReticle: THREE.MeshBasicMaterial;
  selectedReticleOuter: THREE.MeshBasicMaterial;
  archetype: Record<DriverArchetype, THREE.MeshBasicMaterial>;
  archetypeDim: Record<DriverArchetype, THREE.MeshBasicMaterial>;
  tactical: Record<Exclude<TacticalCueKind, 0>, THREE.MeshBasicMaterial>;
}

/**
 * Shared geometry & zero-GC rig pool for 3D procedural Indonesian urban traffic vehicles.
 *
 * Local vehicle rig coordinate convention:
 * - Front / Nose: +X (+length/2)
 * - Rear / Tail: -X (-length/2)
 * - Left (LHT curb side): -Z (-width/2)
 * - Right (median/oncoming): +Z (+width/2)
 * - Tire bottom rests on Y = 0, upward is +Y
 */
export class VehicleMeshPool3D {
  private readonly parentGroup: THREE.Object3D;
  private readonly poolGroup: THREE.Group;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly shared: SharedMaterials;

  // Shared reusable geometries per vehicle class / variant
  private readonly paintMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly variantGeos = new Map<VehicleVariantId, VariantGeometryBundle>();
  private readonly archetypeRingGeos: Record<VehicleClass, THREE.BufferGeometry>;
  private readonly v2vArcGeos: Record<VehicleClass, THREE.BufferGeometry>;
  private readonly tacticalHaloGeos: Record<VehicleClass, THREE.BufferGeometry>;
  private readonly headlightConeGeos: Record<VehicleClass, THREE.BufferGeometry>;
  private readonly brakeBloomGeos: Record<VehicleClass, THREE.BufferGeometry>;

  // Pool storage & zero-GC active tracking
  private readonly activeRigs = new Map<number, VehicleRig>();
  private readonly activeList: VehicleRig[] = [];
  private readonly freePool = new Map<VehicleVariantId, VehicleRig[]>();
  private readonly seenIds = new Set<number>();
  private readonly pickableMeshes: THREE.Object3D[] = [];
  private pickableDirty = false;

  // Single shared reticle for selected vehicle
  private readonly selectedReticle: THREE.Group;

  constructor(sceneGroup: THREE.Object3D) {
    this.parentGroup = sceneGroup;
    this.poolGroup = new THREE.Group();
    this.poolGroup.name = 'VehicleMeshPool3D';
    this.parentGroup.add(this.poolGroup);

    this.shared = this.createSharedMaterials();
    this.archetypeRingGeos = {
      motor: this.buildArchetypeRingGeo(VEHICLE_SPECS.motor.length, VEHICLE_SPECS.motor.width, 0.16),
      car: this.buildArchetypeRingGeo(VEHICLE_SPECS.car.length, VEHICLE_SPECS.car.width, 0.2),
      heavy: this.buildArchetypeRingGeo(VEHICLE_SPECS.heavy.length, VEHICLE_SPECS.heavy.width, 0.24),
    };
    this.v2vArcGeos = {
      motor: this.buildV2VArcGeo(VEHICLE_SPECS.motor.length, VEHICLE_SPECS.motor.width),
      car: this.buildV2VArcGeo(VEHICLE_SPECS.car.length, VEHICLE_SPECS.car.width),
      heavy: this.buildV2VArcGeo(VEHICLE_SPECS.heavy.length, VEHICLE_SPECS.heavy.width),
    };
    this.tacticalHaloGeos = {
      motor: this.buildTacticalHaloGeo(VEHICLE_SPECS.motor.length, VEHICLE_SPECS.motor.width),
      car: this.buildTacticalHaloGeo(VEHICLE_SPECS.car.length, VEHICLE_SPECS.car.width),
      heavy: this.buildTacticalHaloGeo(VEHICLE_SPECS.heavy.length, VEHICLE_SPECS.heavy.width),
    };
    this.headlightConeGeos = {
      motor: this.buildConeQuadGeo(0.95, 3.4, 0.22, 0.78),
      car: this.buildConeQuadGeo(2.02, 6.2, 0.52, 1.45),
      heavy: this.buildConeQuadGeo(4.45, 9.6, 0.78, 1.95),
    };
    this.brakeBloomGeos = {
      motor: this.buildConeQuadGeo(-0.92, -1.85, 0.24, 0.56),
      car: this.buildConeQuadGeo(-2.02, -3.75, 0.62, 1.18),
      heavy: this.buildConeQuadGeo(-4.48, -6.35, 0.92, 1.58),
    };

    this.selectedReticle = this.buildSelectedReticle();
    this.selectedReticle.visible = false;
    this.poolGroup.add(this.selectedReticle);

    this.initAllVariantGeometries();
  }

  public syncFrame(
    vehicles: readonly Vehicle[],
    simTime: number,
    headlightsOn: boolean,
    layers: MapOverlayLayers,
    focusedArchetype: DriverArchetype | null,
    selectedVehicleId: number | null
  ): void {
    this.seenIds.clear();
    const blinkOn = Math.floor(simTime * 2.5) % 2 === 0;
    const pulseWave = 0.5 + 0.5 * Math.sin(simTime * 6.0);
    let selectedVehicle: Vehicle | null = null;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      this.seenIds.add(v.id);

      const variant = resolveVariantId(v.spriteKey, v.vClass);
      let rig = this.activeRigs.get(v.id);

      if (rig && rig.variant !== variant) {
        this.releaseRig(rig);
        rig = undefined;
      }
      if (!rig) {
        rig = this.acquireRig(variant, v.id);
      }

      const isSelected = selectedVehicleId !== null && v.id === selectedVehicleId;
      if (isSelected) {
        selectedVehicle = v;
      }

      // Position & heading (Front +X, Y=0 road surface, rotation.y = -heading)
      rig.root.position.set(v.x, 0, v.y);
      rig.root.rotation.y = -v.heading;

      // Spotlight Dimming when focusedArchetype is active
      const dimmed =
        focusedArchetype !== null && v.archetype !== focusedArchetype && !isSelected;
      if (rig.isDimmed !== dimmed) {
        rig.isDimmed = dimmed;
        const sw = rig.swappables;
        for (let j = 0; j < sw.length; j++) {
          sw[j].mesh.material = dimmed ? sw[j].dimMat : sw[j].normalMat;
        }
      }

      // Headlights & ground projection cone
      if (rig.headlightsActive !== headlightsOn) {
        rig.headlightsActive = headlightsOn;
        rig.headlightsMesh.material = headlightsOn
          ? this.shared.headlightOn
          : this.shared.headlightOff;
      }
      rig.headlightCone.visible = headlightsOn && !dimmed;

      // Reversing & Brake Lights / Hard Brake Bloom
      const reversing = Boolean(v.isReversing);
      const hardBrake = !reversing && Boolean(v.brakingHard);
      const nextBrakeState: BrakeState = hardBrake ? 2 : !reversing && v.speed < 0.8 ? 1 : 0;

      if (rig.brakeState !== nextBrakeState) {
        rig.brakeState = nextBrakeState;
        rig.brakeMesh.material =
          nextBrakeState === 2
            ? this.shared.brakeHard
            : nextBrakeState === 1
              ? this.shared.brakeIdle
              : this.shared.brakeOff;
        if (nextBrakeState === 2) {
          rig.brakeMesh.scale.set(1, 1.4, 1.16);
        } else {
          rig.brakeMesh.scale.set(1, 1, 1);
        }
      }
      rig.brakeBloom.visible = hardBrake && !dimmed;

      if (rig.reverseActive !== reversing) {
        rig.reverseActive = reversing;
        rig.reverseMesh.visible = reversing;
      }

      // Turn Blinkers (front + rear amber spheres at -Z left / +Z right) + 4-Corner Hazard
      const isHazard = reversing || v.overtakeState === 'abort';
      const rawTurnDir =
        v.turn === 'uturn'
          ? 'right'
          : v.turn !== 'straight' && v.distanceAlongPath < v.exitLineDist
            ? v.turn
            : null;
      const signalDir =
        v.turnSignal ?? v.laneChangeDir ?? v.pendingLaneChangeDir ?? rawTurnDir;

      const leftOn = blinkOn && (isHazard || signalDir === 'left');
      const rightOn = blinkOn && (isHazard || signalDir === 'right');

      if (rig.leftBlinkerActive !== leftOn) {
        rig.leftBlinkerActive = leftOn;
        rig.blinkerLeftMesh.material = leftOn
          ? this.shared.blinkerOn
          : this.shared.blinkerOff;
      }
      if (rig.rightBlinkerActive !== rightOn) {
        rig.rightBlinkerActive = rightOn;
        rig.blinkerRightMesh.material = rightOn
          ? this.shared.blinkerOn
          : this.shared.blinkerOff;
      }

      // Motorcycle steerable handlebars + subtle body lean
      if (rig.handlebarGroup !== null && rig.leanGroup !== null) {
        const steerInput = v.laneChangeDir ?? (v.speed > 0.5 ? v.turnSignal : null) ?? null;
        const targetSteer = steerInput === 'left' ? 0.22 : steerInput === 'right' ? -0.22 : 0;
        const targetLean = steerInput === 'left' ? -0.11 : steerInput === 'right' ? 0.11 : 0;
        rig.steerAngle += (targetSteer - rig.steerAngle) * 0.28;
        rig.leanAngle += (targetLean - rig.leanAngle) * 0.22;
        rig.handlebarGroup.rotation.y = rig.steerAngle;
        rig.leanGroup.rotation.x = rig.leanAngle;
      }

      // Under-Chassis Archetype Ground Accent (layers.identity)
      const arch = v.archetype ?? null;
      if (layers.identity && arch !== null) {
        rig.archetypeRing.visible = true;
        const targetRingMat = dimmed
          ? this.shared.archetypeDim[arch]
          : this.shared.archetype[arch];
        if (rig.archetypeRing.material !== targetRingMat) {
          rig.archetypeRing.material = targetRingMat;
        }
        rig.lastArchetype = arch;
      } else {
        rig.archetypeRing.visible = false;
      }

      // V2V Radar Arc
      const showV2V = layers.tacticalCues && Boolean(v.isConnected) && !dimmed;
      rig.v2vArc.visible = showV2V;
      if (showV2V) {
        const arcScale = 0.96 + 0.08 * pulseWave;
        rig.v2vArc.scale.set(arcScale, 1, arcScale);
      }

      // Tactical / Yield / Caution / Frustration Ground Halo
      let tacKind: TacticalCueKind = 0;
      if (!dimmed) {
        if (layers.tacticalCues && v.overtakeState === 'abort') tacKind = 1;
        else if (layers.tacticalCues && v.holdingYellowBox) tacKind = 2;
        else if (layers.tacticalCues && v.isYielding) tacKind = 3;
        else if (layers.emotionBars && (v.cautionTimer ?? 0) > 0.2) tacKind = 4;
        else if (layers.emotionBars && (v.frustration ?? 0) >= 0.65) tacKind = 5;
      }

      if (tacKind !== 0) {
        rig.tacticalHalo.visible = true;
        if (rig.lastTacKind !== tacKind) {
          rig.lastTacKind = tacKind;
          rig.tacticalHalo.material = this.shared.tactical[tacKind];
        }
        const s = 1 + 0.06 * pulseWave;
        rig.tacticalHalo.scale.set(s, 1, s);
      } else if (rig.tacticalHalo.visible) {
        rig.tacticalHalo.visible = false;
        rig.lastTacKind = 0;
      }
    }

    // Selected Vehicle 3D Reticle
    if (selectedVehicle !== null) {
      this.selectedReticle.visible = true;
      this.selectedReticle.position.set(selectedVehicle.x, 0.075, selectedVehicle.y);
      this.selectedReticle.rotation.y = -selectedVehicle.heading;
      const reticleRadius =
        Math.max(selectedVehicle.length, selectedVehicle.width) * 0.5 + 0.65 + pulseWave * 0.14;
      this.selectedReticle.scale.set(reticleRadius, 1, reticleRadius);
    } else {
      this.selectedReticle.visible = false;
    }

    // Release exited vehicles back to variant pool (zero allocations via swap-and-pop)
    for (let i = this.activeList.length - 1; i >= 0; i--) {
      const rig = this.activeList[i];
      if (!this.seenIds.has(rig.vehicleId)) {
        this.releaseRigAtIndex(rig, i);
      }
    }

    if (this.pickableDirty) {
      this.rebuildPickables();
    }
  }

  public getPickableMeshes(): THREE.Object3D[] {
    if (this.pickableDirty) {
      this.rebuildPickables();
    }
    return this.pickableMeshes;
  }

  public getRigPosition(vehicleId: number): THREE.Vector3 | null {
    const rig = this.activeRigs.get(vehicleId);
    if (!rig) return null;
    rig.readPos.copy(rig.root.position);
    return rig.readPos;
  }

  public dispose(): void {
    this.parentGroup.remove(this.poolGroup);
    for (let i = 0; i < this.geos.length; i++) {
      this.geos[i].dispose();
    }
    for (let i = 0; i < this.mats.length; i++) {
      this.mats[i].dispose();
    }
    this.geos.length = 0;
    this.mats.length = 0;
    this.activeRigs.clear();
    this.activeList.length = 0;
    this.freePool.clear();
    this.pickableMeshes.length = 0;
    this.seenIds.clear();
    this.paintMats.clear();
    this.variantGeos.clear();
  }

  // ---------------------------------------------------------------------------
  // Pool Acquire / Release
  // ---------------------------------------------------------------------------

  private acquireRig(variant: VehicleVariantId, vehicleId: number): VehicleRig {
    const bucket = this.freePool.get(variant);
    let rig = bucket && bucket.length > 0 ? bucket.pop()! : undefined;

    if (!rig) {
      rig = this.buildRig(variant);
      this.poolGroup.add(rig.root);
    }

    rig.vehicleId = vehicleId;
    rig.root.userData.vehicleId = vehicleId;
    for (let i = 0; i < rig.pickMeshes.length; i++) {
      rig.pickMeshes[i].userData.vehicleId = vehicleId;
    }

    // Reset transient kinematics
    rig.steerAngle = 0;
    rig.leanAngle = 0;
    if (rig.handlebarGroup) rig.handlebarGroup.rotation.y = 0;
    if (rig.leanGroup) rig.leanGroup.rotation.x = 0;

    rig.root.visible = true;
    rig.poolIdx = this.activeList.length;
    this.activeList.push(rig);
    this.activeRigs.set(vehicleId, rig);
    this.pickableDirty = true;
    return rig;
  }

  private releaseRig(rig: VehicleRig): void {
    if (rig.poolIdx >= 0 && rig.poolIdx < this.activeList.length) {
      this.releaseRigAtIndex(rig, rig.poolIdx);
    }
  }

  private releaseRigAtIndex(rig: VehicleRig, idx: number): void {
    const last = this.activeList.pop()!;
    if (idx < this.activeList.length) {
      this.activeList[idx] = last;
      last.poolIdx = idx;
    }
    rig.poolIdx = -1;
    this.activeRigs.delete(rig.vehicleId);
    rig.vehicleId = -1;
    rig.root.userData.vehicleId = -1;
    rig.root.visible = false;

    let bucket = this.freePool.get(rig.variant);
    if (!bucket) {
      bucket = [];
      this.freePool.set(rig.variant, bucket);
    }
    bucket.push(rig);
    this.pickableDirty = true;
  }

  private rebuildPickables(): void {
    this.pickableMeshes.length = 0;
    for (let i = 0; i < this.activeList.length; i++) {
      const pm = this.activeList[i].pickMeshes;
      for (let j = 0; j < pm.length; j++) {
        this.pickableMeshes.push(pm[j]);
      }
    }
    this.pickableDirty = false;
  }

  // ---------------------------------------------------------------------------
  // Shared Materials & Tracked Resource Allocation
  // ---------------------------------------------------------------------------

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geos.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.mats.push(mat);
    return mat;
  }

  private getPaintMat(hex: number, roughness = 0.32, metalness = 0.28): THREE.MeshStandardMaterial {
    const key = `${hex}_${roughness}_${metalness}`;
    let mat = this.paintMats.get(key);
    if (!mat) {
      mat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: hex,
          roughness,
          metalness,
        })
      );
      this.paintMats.set(key, mat);
    }
    return mat;
  }

  private createSharedMaterials(): SharedMaterials {
    const tire = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.86, metalness: 0.08 })
    );
    const glass = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0b1324, roughness: 0.15, metalness: 0.45 })
    );
    const darkTrim = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.2 })
    );
    const chrome = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.22, metalness: 0.78 })
    );

    const dimBody = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.7,
        metalness: 0.05,
        transparent: true,
        opacity: 0.28,
        depthWrite: true,
      })
    );
    const dimGlass = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        opacity: 0.24,
        depthWrite: true,
      })
    );
    const dimTire = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.9,
        transparent: true,
        opacity: 0.26,
        depthWrite: true,
      })
    );

    const headlightOff = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.2, metalness: 0.3 })
    );
    const headlightOn = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfef08a,
        emissiveIntensity: 1.6,
        roughness: 0.15,
      })
    );
    const headlightCone = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfef9c3,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    const brakeOff = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x7f1d1d,
        emissive: 0x450a0a,
        emissiveIntensity: 0.25,
        roughness: 0.35,
      })
    );
    const brakeIdle = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        emissive: 0xdc2626,
        emissiveIntensity: 0.85,
        roughness: 0.25,
      })
    );
    const brakeHard = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff1e42,
        emissive: 0xff1e42,
        emissiveIntensity: 2.1,
        roughness: 0.15,
      })
    );
    const brakeBloom = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const reverseOn = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xf8fafc,
        emissiveIntensity: 1.9,
        roughness: 0.15,
      })
    );

    const blinkerOff = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x78350f,
        roughness: 0.45,
      })
    );
    const blinkerOn = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 2.2,
        roughness: 0.2,
      })
    );

    const taxiCrownOn = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfde047,
        emissiveIntensity: 1.15,
        roughness: 0.2,
      })
    );

    const v2vArc = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    const selectedReticle = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const selectedReticleOuter = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    const archetype = {} as Record<DriverArchetype, THREE.MeshBasicMaterial>;
    const archetypeDim = {} as Record<DriverArchetype, THREE.MeshBasicMaterial>;
    const archKeys: DriverArchetype[] = [
      'defensive',
      'commuter',
      'hurried',
      'courier',
      'transit',
      'logistics',
    ];
    for (let i = 0; i < archKeys.length; i++) {
      const k = archKeys[i];
      archetype[k] = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: ARCHETYPE_HEX[k],
          transparent: true,
          opacity: 0.76,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      archetypeDim[k] = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: ARCHETYPE_HEX[k],
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
    }

    const tactical: Record<Exclude<TacticalCueKind, 0>, THREE.MeshBasicMaterial> = {
      1: this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0xf43f5e,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      ),
      2: this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      ),
      3: this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x0ea5e9,
          transparent: true,
          opacity: 0.84,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      ),
      4: this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      ),
      5: this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      ),
    };

    return {
      tire,
      glass,
      darkTrim,
      chrome,
      dimBody,
      dimGlass,
      dimTire,
      headlightOff,
      headlightOn,
      headlightCone,
      brakeOff,
      brakeIdle,
      brakeHard,
      brakeBloom,
      reverseOn,
      blinkerOff,
      blinkerOn,
      taxiCrownOn,
      v2vArc,
      selectedReticle,
      selectedReticleOuter,
      archetype,
      archetypeDim,
      tactical,
    };
  }

  // ---------------------------------------------------------------------------
  // Geometry Helpers
  // ---------------------------------------------------------------------------

  private mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const normalized: THREE.BufferGeometry[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const nonIdx = p.index ? p.toNonIndexed() : p;
      normalized.push(nonIdx);
    }
    const merged = mergeGeometries(normalized, false);
    for (let i = 0; i < parts.length; i++) {
      parts[i].dispose();
    }
    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i] !== parts[i]) {
        normalized[i].dispose();
      }
    }
    if (!merged) {
      throw new Error('VehicleMeshPool3D: mergeGeometries failed');
    }
    return this.trackGeo(merged);
  }

  private makeBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }

  private makeWheel(radius: number, width: number, x: number, z: number, segs = 14): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(radius, radius, width, segs);
    g.rotateX(Math.PI / 2); // align axle along Z, bottom rests at y = 0 when translated by +radius
    g.translate(x, radius, z);
    return g;
  }

  private extrudeProfile(
    pts: readonly [number, number][],
    width: number,
    bevel = 0.04
  ): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i][0], pts[i][1]);
    }
    shape.closePath();

    const innerDepth = Math.max(0.04, width - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: innerDepth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 2,
    });
    geo.translate(0, 0, -innerDepth * 0.5);
    return geo;
  }

  private makeBlinkersPair(
    radius: number,
    fx: number,
    fy: number,
    rx: number,
    ry: number,
    z: number
  ): THREE.BufferGeometry {
    const f = new THREE.SphereGeometry(radius, 8, 6);
    f.translate(fx, fy, z);
    const r = new THREE.SphereGeometry(radius, 8, 6);
    r.translate(rx, ry, z);
    return this.mergeParts([f, r]);
  }

  private buildConeQuadGeo(x0: number, x1: number, w0: number, w1: number): THREE.BufferGeometry {
    const positions = new Float32Array([
      x0, 0, -w0,
      x0, 0, w0,
      x1, 0, w1,
      x1, 0, -w1,
    ]);
    const normals = new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    return this.trackGeo(geo);
  }

  private addRoundedRectPath(
    path: THREE.Path | THREE.Shape,
    hl: number,
    hw: number,
    r: number,
    ccw: boolean
  ): void {
    const cr = Math.min(r, hl * 0.9, hw * 0.9);
    if (ccw) {
      path.moveTo(-hl + cr, -hw);
      path.lineTo(hl - cr, -hw);
      path.quadraticCurveTo(hl, -hw, hl, -hw + cr);
      path.lineTo(hl, hw - cr);
      path.quadraticCurveTo(hl, hw, hl - cr, hw);
      path.lineTo(-hl + cr, hw);
      path.quadraticCurveTo(-hl, hw, -hl, hw - cr);
      path.lineTo(-hl, -hw + cr);
      path.quadraticCurveTo(-hl, -hw, -hl + cr, -hw);
    } else {
      path.moveTo(-hl + cr, -hw);
      path.quadraticCurveTo(-hl, -hw, -hl, -hw + cr);
      path.lineTo(-hl, hw - cr);
      path.quadraticCurveTo(-hl, hw, -hl + cr, hw);
      path.lineTo(hl - cr, hw);
      path.quadraticCurveTo(hl, hw, hl, hw - cr);
      path.lineTo(hl, -hw + cr);
      path.quadraticCurveTo(hl, -hw, hl - cr, -hw);
      path.lineTo(-hl + cr, -hw);
    }
  }

  private buildArchetypeRingGeo(length: number, width: number, ringThickness: number): THREE.BufferGeometry {
    const hlOut = length * 0.5 + 0.24;
    const hwOut = width * 0.5 + 0.24;
    const hlIn = Math.max(0.2, hlOut - ringThickness);
    const hwIn = Math.max(0.15, hwOut - ringThickness);
    const rOut = Math.min(hwOut * 0.85, 0.56);
    const rIn = Math.max(0.08, rOut - ringThickness * 0.65);

    const outer = new THREE.Shape();
    this.addRoundedRectPath(outer, hlOut, hwOut, rOut, true);
    const inner = new THREE.Path();
    this.addRoundedRectPath(inner, hlIn, hwIn, rIn, false);
    outer.holes.push(inner);

    const geo = new THREE.ShapeGeometry(outer, 6);
    geo.rotateX(-Math.PI / 2);
    return this.trackGeo(geo);
  }

  private buildV2VArcGeo(length: number, width: number): THREE.BufferGeometry {
    const hw = width * 0.5;
    const noseX = length * 0.36;
    const r1 = hw + 0.56;
    const r2 = hw + 1.04;
    const a1 = new THREE.RingGeometry(r1, r1 + 0.1, 16, 1, -0.58, 1.16);
    a1.rotateX(-Math.PI / 2);
    a1.translate(noseX, 0, 0);

    const a2 = new THREE.RingGeometry(r2, r2 + 0.08, 16, 1, -0.5, 1.0);
    a2.rotateX(-Math.PI / 2);
    a2.translate(noseX, 0, 0);

    return this.mergeParts([a1, a2]);
  }

  private buildTacticalHaloGeo(length: number, width: number): THREE.BufferGeometry {
    const r = width * 0.5 + 0.32;
    const arc = new THREE.RingGeometry(r, r + 0.16, 16, 1, -0.72, 1.44);
    arc.rotateX(-Math.PI / 2);
    arc.translate(length * 0.5 - width * 0.32, 0, 0);
    return this.trackGeo(arc);
  }

  private buildSelectedReticle(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'SelectedVehicleReticle3D';

    // Outer subtle cyan glow ring (unit radius 1.0 -> scaled dynamically)
    const ringGeo = this.trackGeo(new THREE.RingGeometry(0.92, 1.02, 32));
    ringGeo.rotateX(-Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo, this.shared.selectedReticleOuter);
    g.add(ringMesh);

    // 4 crisp corner brackets at unit +/-1 box
    const arm = 0.42;
    const thick = 0.08;
    const parts: THREE.BufferGeometry[] = [];
    const signs: readonly [number, number][] = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (let i = 0; i < signs.length; i++) {
      const [sx, sz] = signs[i];
      parts.push(this.makeBox(arm, 0.02, thick, sx * (1 - arm * 0.5), 0.005, sz));
      parts.push(this.makeBox(thick, 0.02, arm, sx, 0.005, sz * (1 - arm * 0.5)));
    }
    const bracketGeo = this.mergeParts(parts);
    const bracketMesh = new THREE.Mesh(bracketGeo, this.shared.selectedReticle);
    g.add(bracketMesh);

    return g;
  }

  // ---------------------------------------------------------------------------
  // Variant Geometry Builders (20 Distinct Stylized Vehicles)
  // ---------------------------------------------------------------------------

  private initAllVariantGeometries(): void {
    // 6 Motorcycles
    this.registerMotoVariants();
    // 9 Cars
    this.registerCarVariants();
    // 5 Heavy Vehicles
    this.registerHeavyVariants();
  }

  private registerMotoVariants(): void {
    const specs: {
      id: VehicleVariantId;
      style: 'commuter' | 'scooter' | 'sport' | 'delivery' | 'cruiser' | 'ev';
      bodyHex: number;
      accentHex: number;
      jacketHex: number;
      helmetHex: number;
      bodyRoughness?: number;
      bodyMetalness?: number;
    }[] = [
      {
        id: 'moto-commuter',
        style: 'commuter',
        bodyHex: 0x1d4ed8, // commuter blue
        accentHex: 0x334155, // slate chassis
        jacketHex: 0x334155,
        helmetHex: 0xf1f5f9,
      },
      {
        id: 'moto-scooter',
        style: 'scooter',
        bodyHex: 0xfef3c7, // cream body
        accentHex: 0xfb7185, // coral fairing
        jacketHex: 0xe2e8f0,
        helmetHex: 0x334155,
      },
      {
        id: 'moto-sport',
        style: 'sport',
        bodyHex: 0xdc2626, // sport red aerodynamic fairing
        accentHex: 0x0f172a, // black belly & tail
        jacketHex: 0x1e293b,
        helmetHex: 0xf8fafc,
      },
      {
        id: 'moto-delivery-box',
        style: 'delivery',
        bodyHex: 0x1e293b, // dark matic frame
        accentHex: 0x16a34a, // Ojol green box trim
        jacketHex: 0x16a34a, // iconic Ojol green jacket
        helmetHex: 0x22c55e, // iconic Ojol green helmet
      },
      {
        id: 'moto-cruiser',
        style: 'cruiser',
        bodyHex: 0x334155, // dark metallic cruiser
        accentHex: 0x94a3b8, // chrome-slate trim
        jacketHex: 0x1e293b,
        helmetHex: 0x475569,
        bodyRoughness: 0.24,
        bodyMetalness: 0.72,
      },
      {
        id: 'moto-ev-white',
        style: 'ev',
        bodyHex: 0xf8fafc, // EV clean white
        accentHex: 0x06b6d4, // cyan EV accent
        jacketHex: 0x334155,
        helmetHex: 0x06b6d4,
        bodyRoughness: 0.22,
        bodyMetalness: 0.2,
      },
    ];

    // Shared motorcycle wheel, blinker, light geometries
    const frontWheelGeo = this.trackGeo(this.makeWheel(0.24, 0.13, 0.14, 0, 12));
    const rearWheelGeo = this.trackGeo(this.makeWheel(0.24, 0.14, -0.66, 0, 12));
    const handlebarDefaultGeo = this.mergeParts([
      this.makeBox(0.05, 0.05, 0.64, 0.04, 0.88, 0),
      this.makeBox(0.14, 0.34, 0.08, 0.06, 0.56, 0), // front fork stem
    ]);
    const handlebarCruiserGeo = this.mergeParts([
      this.makeBox(0.06, 0.05, 0.74, -0.02, 0.86, 0),
      this.makeBox(0.14, 0.36, 0.09, 0.07, 0.54, 0),
    ]);
    const motoHeadlightGeo = this.trackGeo(this.makeBox(0.08, 0.12, 0.18, 0.26, 0.74, 0));
    const motoBrakeGeo = this.trackGeo(this.makeBox(0.06, 0.1, 0.24, -0.94, 0, 0));
    const motoReverseGeo = this.trackGeo(this.makeBox(0.05, 0.08, 0.14, -0.95, 0.46, 0));
    const motoBlinkerL = this.makeBlinkersPair(0.06, 0.64, 0.74, -0.88, 0.56, -0.25);
    const motoBlinkerR = this.makeBlinkersPair(0.06, 0.64, 0.74, -0.88, 0.56, 0.25);

    // Commuter / Naked bike frame
    const commuterBodyGeo = this.mergeParts([
      this.makeBox(0.95, 0.28, 0.32, -0.15, 0.44, 0), // engine + frame
      this.makeBox(0.46, 0.24, 0.36, 0.22, 0.68, 0), // fuel tank
      this.makeBox(0.68, 0.14, 0.3, -0.46, 0.62, 0), // seat + tail
    ]);
    // Step-through scooter fairing + floorboard
    const scooterBodyGeo = this.mergeParts([
      this.makeBox(0.62, 0.14, 0.42, 0.06, 0.28, 0), // floorboard
      this.makeBox(0.32, 0.58, 0.42, 0.48, 0.56, 0), // front leg shield
      this.makeBox(0.76, 0.34, 0.44, -0.44, 0.52, 0), // rear scooter body
    ]);
    // Sport aerodynamic fairing
    const sportBodyGeo = this.mergeParts([
      this.extrudeProfile(
        [
          [-0.86, 0.54],
          [0.05, 0.32],
          [0.72, 0.34],
          [0.92, 0.68],
          [0.44, 0.84],
          [-0.08, 0.74],
          [-0.92, 0.78],
        ],
        0.38,
        0.04
      ),
    ]);
    // Cruiser low-slung frame
    const cruiserBodyGeo = this.mergeParts([
      this.makeBox(1.12, 0.28, 0.34, -0.12, 0.4, 0),
      this.makeBox(0.5, 0.24, 0.4, 0.22, 0.62, 0), // wide teardrop tank
      this.makeBox(0.62, 0.14, 0.32, -0.48, 0.52, 0), // low cruiser saddle
    ]);

    // Rider torso & helmet (upright vs tucked sport)
    const riderUprightGeo = this.mergeParts([
      this.makeBox(0.3, 0.48, 0.44, -0.06, 0.94, 0),
      this.makeBox(0.34, 0.11, 0.12, 0.18, 0.88, -0.22), // left arm
      this.makeBox(0.34, 0.11, 0.12, 0.18, 0.88, 0.22), // right arm
    ]);
    const riderSportGeo = this.mergeParts([
      (() => {
        const t = new THREE.BoxGeometry(0.46, 0.3, 0.42);
        t.rotateZ(-0.42);
        t.translate(0.02, 0.88, 0);
        return t;
      })(),
      this.makeBox(0.32, 0.1, 0.11, 0.28, 0.84, -0.2),
      this.makeBox(0.32, 0.1, 0.11, 0.28, 0.84, 0.2),
    ]);

    const buildHelmetGeo = (hx: number, hy: number) => {
      const s = new THREE.SphereGeometry(0.18, 10, 8);
      s.translate(hx, hy, 0);
      return this.trackGeo(s);
    };
    const helmetUprightGeo = buildHelmetGeo(0.02, 1.28);
    const helmetSportGeo = buildHelmetGeo(0.18, 1.12);

    // Visors merged or small trim
    const visorUprightGeo = this.trackGeo(this.makeBox(0.1, 0.08, 0.26, 0.17, 1.28, 0));
    const visorSportGeo = this.trackGeo(this.makeBox(0.1, 0.08, 0.26, 0.33, 1.12, 0));

    // Rear thermal delivery box + hi-vis lime strap for Ojol
    const deliveryBoxGeo = this.trackGeo(this.makeBox(0.48, 0.42, 0.48, -0.62, 0.86, 0));
    const deliveryLidGeo = this.trackGeo(this.makeBox(0.5, 0.09, 0.5, -0.62, 1.08, 0));
    const deliveryHiVisGeo = this.trackGeo(this.makeBox(0.04, 0.06, 0.44, -0.87, 0.84, 0));

    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      const bodyGeo =
        sp.style === 'scooter' || sp.style === 'delivery' || sp.style === 'ev'
          ? scooterBodyGeo
          : sp.style === 'sport'
            ? sportBodyGeo
            : sp.style === 'cruiser'
              ? cruiserBodyGeo
              : commuterBodyGeo;

      const isSport = sp.style === 'sport';
      const isCruiser = sp.style === 'cruiser';

      // Extra accent piece depending on style (sport windscreen/belly, scooter coral nose, Ojol box, EV cyan strip)
      let extraAccentGeo: THREE.BufferGeometry | null = null;
      if (sp.style === 'sport') {
        extraAccentGeo = this.trackGeo(this.makeBox(0.42, 0.16, 0.36, 0.22, 0.36, 0));
      } else if (sp.style === 'scooter') {
        extraAccentGeo = this.trackGeo(this.makeBox(0.26, 0.36, 0.38, 0.56, 0.62, 0));
      } else if (sp.style === 'delivery') {
        extraAccentGeo = deliveryLidGeo;
      } else if (sp.style === 'cruiser') {
        extraAccentGeo = this.trackGeo(this.makeBox(0.75, 0.08, 0.1, -0.35, 0.3, 0.22));
      } else if (sp.style === 'ev') {
        extraAccentGeo = this.trackGeo(this.makeBox(0.16, 0.28, 0.34, 0.58, 0.64, 0));
      } else {
        extraAccentGeo = this.trackGeo(this.makeBox(0.66, 0.14, 0.34, -0.15, 0.44, 0));
      }

      this.variantGeos.set(sp.id, {
        vClass: 'motor',
        parts: [
          {
            geo: bodyGeo,
            mat: this.getPaintMat(
              sp.bodyHex,
              sp.bodyRoughness ?? 0.34,
              sp.bodyMetalness ?? 0.24
            ),
            dimMat: this.shared.dimBody,
            pickable: true,
            parent: 'lean',
          },
          ...(extraAccentGeo
            ? [
                {
                  geo: extraAccentGeo,
                  mat: this.getPaintMat(sp.accentHex, 0.35, 0.25),
                  dimMat: this.shared.dimBody,
                  pickable: false,
                  parent: 'lean' as const,
                },
              ]
            : []),
          ...(sp.style === 'delivery'
            ? [
                {
                  geo: deliveryBoxGeo,
                  mat: this.shared.darkTrim,
                  dimMat: this.shared.dimBody,
                  pickable: true,
                  parent: 'lean' as const,
                },
                {
                  geo: deliveryHiVisGeo,
                  mat: this.getPaintMat(0xbef264, 0.4, 0.1),
                  dimMat: this.shared.dimBody,
                  pickable: false,
                  parent: 'lean' as const,
                },
              ]
            : []),
          {
            geo: rearWheelGeo,
            mat: this.shared.tire,
            dimMat: this.shared.dimTire,
            pickable: false,
            parent: 'lean',
          },
          {
            geo: frontWheelGeo,
            mat: this.shared.tire,
            dimMat: this.shared.dimTire,
            pickable: false,
            parent: 'handlebar',
          },
          {
            geo: isCruiser ? handlebarCruiserGeo : handlebarDefaultGeo,
            mat: isCruiser ? this.shared.chrome : this.shared.darkTrim,
            dimMat: this.shared.dimTire,
            pickable: false,
            parent: 'handlebar',
          },
          {
            geo: isSport ? riderSportGeo : riderUprightGeo,
            mat: this.getPaintMat(sp.jacketHex, 0.72, 0.05),
            dimMat: this.shared.dimBody,
            pickable: true,
            parent: 'lean',
          },
          {
            geo: isSport ? helmetSportGeo : helmetUprightGeo,
            mat: this.getPaintMat(sp.helmetHex, 0.24, 0.15),
            dimMat: this.shared.dimBody,
            pickable: true,
            parent: 'lean',
          },
          {
            geo: isSport ? visorSportGeo : visorUprightGeo,
            mat: this.shared.glass,
            dimMat: this.shared.dimGlass,
            pickable: false,
            parent: 'lean',
          },
        ],
        headlightsGeo: motoHeadlightGeo,
        headlightsParent: 'handlebar',
        brakeGeo: motoBrakeGeo,
        brakeY: 0.56,
        reverseGeo: motoReverseGeo,
        blinkerLeftGeo: motoBlinkerL,
        blinkerRightGeo: motoBlinkerR,
      });
    }
  }

  private registerCarVariants(): void {
    // Shared 4-wheel sets
    const carWheelsStd = this.mergeParts([
      this.makeWheel(0.33, 0.22, 1.36, -0.78),
      this.makeWheel(0.33, 0.22, 1.36, 0.78),
      this.makeWheel(0.33, 0.22, -1.36, -0.78),
      this.makeWheel(0.33, 0.22, -1.36, 0.78),
    ]);
    const carWheelsSuv = this.mergeParts([
      this.makeWheel(0.37, 0.24, 1.38, -0.8),
      this.makeWheel(0.37, 0.24, 1.38, 0.8),
      this.makeWheel(0.37, 0.24, -1.38, -0.8),
      this.makeWheel(0.37, 0.24, -1.38, 0.8),
    ]);
    const carWheelsCompact = this.mergeParts([
      this.makeWheel(0.31, 0.21, 1.24, -0.75),
      this.makeWheel(0.31, 0.21, 1.24, 0.75),
      this.makeWheel(0.31, 0.21, -1.24, -0.75),
      this.makeWheel(0.31, 0.21, -1.24, 0.75),
    ]);

    // Sedan Silhouette (navy, white, taxi, luxury)
    const sedanChassisGeo = this.mergeParts([
      this.extrudeProfile(
        [
          [-2.16, 0.24],
          [2.16, 0.22],
          [2.2, 0.56],
          [2.02, 0.72],
          [1.0, 0.84],
          [-1.38, 0.86],
          [-2.14, 0.78],
          [-2.18, 0.44],
        ],
        1.8,
        0.05
      ),
      this.makeBox(0.14, 0.1, 0.18, 0.82, 0.88, -0.94),
      this.makeBox(0.14, 0.1, 0.18, 0.82, 0.88, 0.94),
    ]);
    const sedanGlassGeo = this.trackGeo(
      this.extrudeProfile(
        [
          [-1.4, 0.82],
          [1.04, 0.8],
          [0.46, 1.34],
          [-0.86, 1.34],
        ],
        1.5,
        0.03
      )
    );
    const sedanRoofGeo = this.trackGeo(this.makeBox(1.3, 0.07, 1.4, -0.2, 1.36, 0));

    // SUV Silhouette (tall muscular stance + roof rails)
    const suvChassisGeo = this.mergeParts([
      this.extrudeProfile(
        [
          [-2.18, 0.28],
          [2.18, 0.26],
          [2.22, 0.68],
          [2.04, 0.88],
          [1.02, 0.96],
          [-2.12, 0.96],
          [-2.2, 0.5],
        ],
        1.84,
        0.05
      ),
      this.makeBox(0.15, 0.12, 0.2, 0.84, 1.0, -0.96),
      this.makeBox(0.15, 0.12, 0.2, 0.84, 1.0, 0.96),
    ]);
    const suvGlassGeo = this.trackGeo(
      this.extrudeProfile(
        [
          [-2.06, 0.92],
          [1.04, 0.92],
          [0.48, 1.56],
          [-1.82, 1.56],
        ],
        1.56,
        0.03
      )
    );
    const suvRoofRailsGeo = this.mergeParts([
      this.makeBox(2.26, 0.08, 1.44, -0.67, 1.58, 0),
      this.makeBox(2.05, 0.07, 0.08, -0.68, 1.65, -0.58),
      this.makeBox(2.05, 0.07, 0.08, -0.68, 1.65, 0.58),
      this.makeBox(0.08, 0.05, 1.16, -0.05, 1.65, 0),
      this.makeBox(0.08, 0.05, 1.16, -1.25, 1.65, 0),
    ]);

    // Compact Hatchback Silhouette
    const compactChassisGeo = this.mergeParts([
      this.extrudeProfile(
        [
          [-1.96, 0.22],
          [1.98, 0.21],
          [2.02, 0.56],
          [1.84, 0.72],
          [0.92, 0.84],
          [-1.92, 0.84],
          [-1.98, 0.44],
        ],
        1.76,
        0.05
      ),
      this.makeBox(0.13, 0.09, 0.16, 0.76, 0.86, -0.91),
      this.makeBox(0.13, 0.09, 0.16, 0.76, 0.86, 0.91),
    ]);
    const compactGlassGeo = this.trackGeo(
      this.extrudeProfile(
        [
          [-1.86, 0.8],
          [0.94, 0.8],
          [0.42, 1.35],
          [-1.52, 1.35],
        ],
        1.48,
        0.03
      )
    );
    const compactRoofGeo = this.trackGeo(this.makeBox(1.88, 0.07, 1.38, -0.55, 1.37, 0));

    // Delivery Cargo Van (Gran Max / Blind Van)
    const vanBodyGeo = this.mergeParts([
      this.extrudeProfile(
        [
          [-2.2, 0.26],
          [2.16, 0.24],
          [2.2, 0.88],
          [1.92, 1.02],
          [1.42, 1.84],
          [-2.18, 1.86],
        ],
        1.82,
        0.05
      ),
      this.makeBox(0.14, 0.14, 0.18, 1.36, 1.08, -0.94),
      this.makeBox(0.14, 0.14, 0.18, 1.36, 1.08, 0.94),
    ]);
    const vanGlassGeo = this.trackGeo(
      this.extrudeProfile(
        [
          [0.86, 1.0],
          [1.95, 1.0],
          [1.48, 1.72],
          [0.86, 1.72],
        ],
        1.64,
        0.02
      )
    );
    const vanRackGeo = this.mergeParts([
      this.makeBox(0.12, 0.08, 1.56, 0.25, 1.9, 0),
      this.makeBox(0.12, 0.08, 1.56, -1.2, 1.9, 0),
      this.makeBox(2.4, 0.06, 0.08, -0.48, 1.9, -0.68),
      this.makeBox(2.4, 0.06, 0.08, -0.48, 1.9, 0.68),
    ]);

    // Pickup Truck (Cab + Recessed Open Rear Bed!)
    const pickupBodyGeo = this.mergeParts([
      // Front hood + cab + lower bed frame
      this.extrudeProfile(
        [
          [-2.2, 0.26],
          [2.18, 0.24],
          [2.22, 0.68],
          [2.02, 0.86],
          [1.18, 0.94],
          [0.1, 0.94],
          [0.08, 0.56],
          [-2.18, 0.56],
        ],
        1.82,
        0.04
      ),
      // Left & right raised rear cargo bed walls + rear tailgate
      this.makeBox(2.26, 0.42, 0.14, -1.07, 0.77, -0.84),
      this.makeBox(2.26, 0.42, 0.14, -1.07, 0.77, 0.84),
      this.makeBox(0.14, 0.42, 1.82, -2.14, 0.77, 0),
      // Side mirrors
      this.makeBox(0.14, 0.12, 0.18, 0.92, 0.98, -0.96),
      this.makeBox(0.14, 0.12, 0.18, 0.92, 0.98, 0.96),
    ]);
    const pickupGlassGeo = this.trackGeo(
      this.extrudeProfile(
        [
          [0.16, 0.9],
          [1.22, 0.9],
          [0.82, 1.5],
          [0.2, 1.5],
        ],
        1.54,
        0.03
      )
    );
    const pickupRoofBedlinerGeo = this.mergeParts([
      this.makeBox(0.66, 0.07, 1.44, 0.51, 1.52, 0), // cab roof
      this.makeBox(2.08, 0.06, 1.52, -1.04, 0.58, 0), // recessed dark bedliner floor
    ]);

    // EV Mint Sleek Crossover Fastback
    const evChassisGeo = this.mergeParts([
      this.extrudeProfile(
        [
          [-2.14, 0.24],
          [2.14, 0.23],
          [2.18, 0.62],
          [1.86, 0.82],
          [0.98, 0.9],
          [-1.65, 0.9],
          [-2.16, 0.76],
          [-2.18, 0.44],
        ],
        1.82,
        0.05
      ),
      this.makeBox(0.14, 0.1, 0.18, 0.82, 0.92, -0.94),
      this.makeBox(0.14, 0.1, 0.18, 0.82, 0.92, 0.94),
    ]);
    const evGlassRoofGeo = this.trackGeo(
      this.extrudeProfile(
        [
          [-1.72, 0.86],
          [1.02, 0.86],
          [0.36, 1.4],
          [-1.12, 1.4],
        ],
        1.5,
        0.03
      )
    );

    // Taxi Crown Sign & Sunroof accents
    const taxiCrownBaseGeo = this.trackGeo(this.makeBox(0.24, 0.08, 0.58, 0.16, 1.43, 0));
    const taxiCrownGlowGeo = this.trackGeo(this.makeBox(0.2, 0.11, 0.46, 0.16, 1.47, 0));
    const sunroofGeo = this.trackGeo(this.makeBox(0.68, 0.04, 0.96, -0.05, 1.4, 0));
    const luxuryGrilleGeo = this.trackGeo(this.makeBox(0.06, 0.22, 0.88, 2.21, 0.44, 0));

    // Car Light Geometries (standard vs compact vs van)
    const carHeadlightsStd = this.mergeParts([
      this.makeBox(0.1, 0.12, 0.34, 2.18, 0.54, -0.58),
      this.makeBox(0.1, 0.12, 0.34, 2.18, 0.54, 0.58),
    ]);
    const carHeadlightsCompact = this.mergeParts([
      this.makeBox(0.1, 0.12, 0.32, 2.0, 0.54, -0.56),
      this.makeBox(0.1, 0.12, 0.32, 2.0, 0.54, 0.56),
    ]);
    const carHeadlightsVan = this.mergeParts([
      this.makeBox(0.1, 0.14, 0.34, 2.18, 0.64, -0.58),
      this.makeBox(0.1, 0.14, 0.34, 2.18, 0.64, 0.58),
    ]);

    const carBrakeStd = this.mergeParts([
      this.makeBox(0.08, 0.11, 0.38, -2.18, 0, -0.56),
      this.makeBox(0.08, 0.11, 0.38, -2.18, 0, 0.56),
    ]);
    const carBrakeCompact = this.mergeParts([
      this.makeBox(0.08, 0.11, 0.36, -1.98, 0, -0.54),
      this.makeBox(0.08, 0.11, 0.36, -1.98, 0, 0.54),
    ]);

    const carReverseStd = this.mergeParts([
      this.makeBox(0.08, 0.09, 0.2, -2.19, 0.54, -0.32),
      this.makeBox(0.08, 0.09, 0.2, -2.19, 0.54, 0.32),
    ]);
    const carReverseCompact = this.mergeParts([
      this.makeBox(0.08, 0.09, 0.2, -1.99, 0.54, -0.32),
      this.makeBox(0.08, 0.09, 0.2, -1.99, 0.54, 0.32),
    ]);

    const carBlinkL = this.makeBlinkersPair(0.095, 2.08, 0.54, -2.1, 0.6, -0.82);
    const carBlinkR = this.makeBlinkersPair(0.095, 2.08, 0.54, -2.1, 0.6, 0.82);
    const compactBlinkL = this.makeBlinkersPair(0.09, 1.9, 0.54, -1.9, 0.62, -0.78);
    const compactBlinkR = this.makeBlinkersPair(0.09, 1.9, 0.54, -1.9, 0.62, 0.78);

    // 1. car-sedan-navy
    this.variantGeos.set('car-sedan-navy', {
      vClass: 'car',
      parts: [
        { geo: carWheelsStd, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: sedanChassisGeo, mat: this.getPaintMat(0x1e3a8a, 0.28, 0.45), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: sedanGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: sedanRoofGeo, mat: this.getPaintMat(0x1e40af, 0.28, 0.45), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsStd,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 2. car-sedan-white (with panoramic sunroof)
    this.variantGeos.set('car-sedan-white', {
      vClass: 'car',
      parts: [
        { geo: carWheelsStd, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: sedanChassisGeo, mat: this.getPaintMat(0xf8fafc, 0.24, 0.18), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: sedanGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: sedanRoofGeo, mat: this.getPaintMat(0xffffff, 0.24, 0.18), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: sunroofGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: false, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsStd,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 3. car-suv-slate (taller roof & aluminum roof rails)
    this.variantGeos.set('car-suv-slate', {
      vClass: 'car',
      parts: [
        { geo: carWheelsSuv, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: suvChassisGeo, mat: this.getPaintMat(0x475569, 0.3, 0.35), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: suvGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: suvRoofRailsGeo, mat: this.shared.chrome, dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsVan,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 4. car-compact-teal
    this.variantGeos.set('car-compact-teal', {
      vClass: 'car',
      parts: [
        { geo: carWheelsCompact, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: compactChassisGeo, mat: this.getPaintMat(0x0d9488, 0.3, 0.32), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: compactGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: compactRoofGeo, mat: this.getPaintMat(0x0f9e91, 0.3, 0.32), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsCompact,
      headlightsParent: 'root',
      brakeGeo: carBrakeCompact,
      brakeY: 0.62,
      reverseGeo: carReverseCompact,
      blinkerLeftGeo: compactBlinkL,
      blinkerRightGeo: compactBlinkR,
    });

    // 5. car-taxi-yellow (yellow body + illuminated roof TAXI crown!)
    this.variantGeos.set('car-taxi-yellow', {
      vClass: 'car',
      parts: [
        { geo: carWheelsStd, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: sedanChassisGeo, mat: this.getPaintMat(0xf59e0b, 0.28, 0.25), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: sedanGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: sedanRoofGeo, mat: this.getPaintMat(0xfde68a, 0.32, 0.15), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: taxiCrownBaseGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
        { geo: taxiCrownGlowGeo, mat: this.shared.taxiCrownOn, dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsStd,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 6. car-van-delivery (tall boxy cargo van)
    const vanLiveryStripe = this.mergeParts([
      this.makeBox(3.4, 0.16, 0.04, -0.4, 0.92, -0.92),
      this.makeBox(3.4, 0.16, 0.04, -0.4, 0.92, 0.92),
    ]);
    this.variantGeos.set('car-van-delivery', {
      vClass: 'car',
      parts: [
        { geo: carWheelsStd, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: vanBodyGeo, mat: this.getPaintMat(0xf8fafc, 0.34, 0.15), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: vanGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: vanRackGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
        { geo: vanLiveryStripe, mat: this.getPaintMat(0x2563eb, 0.4, 0.1), dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsVan,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 7. car-pickup-slate (cab + recessed open rear bed!)
    this.variantGeos.set('car-pickup-slate', {
      vClass: 'car',
      parts: [
        { geo: carWheelsSuv, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: pickupBodyGeo, mat: this.getPaintMat(0x475569, 0.36, 0.28), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: pickupGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: pickupRoofBedlinerGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsVan,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 8. car-ev-mint
    this.variantGeos.set('car-ev-mint', {
      vClass: 'car',
      parts: [
        { geo: carWheelsStd, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: evChassisGeo, mat: this.getPaintMat(0x10b981, 0.24, 0.28), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: evGlassRoofGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsStd,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });

    // 9. car-luxury-black
    this.variantGeos.set('car-luxury-black', {
      vClass: 'car',
      parts: [
        { geo: carWheelsStd, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: sedanChassisGeo, mat: this.getPaintMat(0x0f172a, 0.16, 0.68), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: sedanGlassGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: sedanRoofGeo, mat: this.getPaintMat(0x1e293b, 0.18, 0.6), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: luxuryGrilleGeo, mat: this.shared.chrome, dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: carHeadlightsStd,
      headlightsParent: 'root',
      brakeGeo: carBrakeStd,
      brakeY: 0.6,
      reverseGeo: carReverseStd,
      blinkerLeftGeo: carBlinkL,
      blinkerRightGeo: carBlinkR,
    });
  }

  private registerHeavyVariants(): void {
    // Shared heavy lights & blinkers
    const heavyHeadlights = this.mergeParts([
      this.makeBox(0.12, 0.18, 0.44, 4.5, 0.86, -0.78),
      this.makeBox(0.12, 0.18, 0.44, 4.5, 0.86, 0.78),
    ]);
    const heavyBrakes = this.mergeParts([
      this.makeBox(0.1, 0.18, 0.44, -4.52, 0, -0.82),
      this.makeBox(0.1, 0.18, 0.44, -4.52, 0, 0.82),
    ]);
    const heavyReverse = this.mergeParts([
      this.makeBox(0.1, 0.14, 0.24, -4.53, 0.78, -0.46),
      this.makeBox(0.1, 0.14, 0.24, -4.53, 0.78, 0.46),
    ]);
    const heavyBlinkL = this.makeBlinkersPair(0.13, 4.44, 0.86, -4.48, 0.84, -1.16);
    const heavyBlinkR = this.makeBlinkersPair(0.13, 4.44, 0.86, -4.48, 0.84, 1.16);

    // 1. bus-city (Indonesian city transit bus: indigo-blue & white livery, panoramic windows, rooftop AC pods)
    const busWheels = this.mergeParts([
      this.makeWheel(0.5, 0.34, 2.85, -1.06),
      this.makeWheel(0.5, 0.34, 2.85, 1.06),
      this.makeWheel(0.5, 0.34, -2.55, -1.06),
      this.makeWheel(0.5, 0.34, -2.55, 1.06),
    ]);
    const busBodyGeo = this.mergeParts([
      this.makeBox(9.05, 0.96, 2.44, 0, 0.92, 0), // lower royal-blue body
      this.makeBox(9.0, 0.22, 2.44, 0, 2.46, 0), // upper blue header band
      this.makeBox(0.22, 0.24, 0.22, 4.35, 1.85, -1.3), // extended left mirror
      this.makeBox(0.22, 0.24, 0.22, 4.35, 1.85, 1.3), // extended right mirror
    ]);
    const busWindowsGeo = this.trackGeo(this.makeBox(8.98, 1.02, 2.38, 0, 1.88, 0));
    const busWhiteRoofAndAc = this.mergeParts([
      this.makeBox(8.85, 0.16, 2.34, -0.04, 2.64, 0), // white transit roof deck
      this.makeBox(2.0, 0.26, 1.56, 1.65, 2.84, 0), // front AC pod
      this.makeBox(2.2, 0.26, 1.56, -1.55, 2.84, 0), // rear AC pod
    ]);
    const busLiveryStripe = this.mergeParts([
      this.makeBox(8.8, 0.14, 2.48, 0, 1.34, 0), // sky-blue livery beltline
      this.makeBox(0.08, 0.14, 1.25, 4.5, 2.46, 0), // front cyan LED display
    ]);

    this.variantGeos.set('bus-city', {
      vClass: 'heavy',
      parts: [
        { geo: busWheels, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: busBodyGeo, mat: this.getPaintMat(0x1e3a8a, 0.3, 0.35), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: busWindowsGeo, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: true, parent: 'root' },
        { geo: busWhiteRoofAndAc, mat: this.getPaintMat(0xf8fafc, 0.34, 0.15), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: busLiveryStripe, mat: this.getPaintMat(0x0284c7, 0.32, 0.2), dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: heavyHeadlights,
      headlightsParent: 'root',
      brakeGeo: heavyBrakes,
      brakeY: 0.84,
      reverseGeo: heavyReverse,
      blinkerLeftGeo: heavyBlinkL,
      blinkerRightGeo: heavyBlinkR,
    });

    // Shared 2-axle & 4-axle truck wheel configurations
    const truckWheels3Axle = this.mergeParts([
      this.makeWheel(0.5, 0.34, 3.25, -1.06),
      this.makeWheel(0.5, 0.34, 3.25, 1.06),
      this.makeWheel(0.5, 0.34, -2.15, -1.06),
      this.makeWheel(0.5, 0.34, -2.15, 1.06),
      this.makeWheel(0.5, 0.34, -3.45, -1.06),
      this.makeWheel(0.5, 0.34, -3.45, 1.06),
    ]);
    const truckWheelsSemi = this.mergeParts([
      this.makeWheel(0.5, 0.34, 3.45, -1.06),
      this.makeWheel(0.5, 0.34, 3.45, 1.06),
      this.makeWheel(0.5, 0.34, 1.95, -1.06),
      this.makeWheel(0.5, 0.34, 1.95, 1.06),
      this.makeWheel(0.5, 0.34, -2.55, -1.06),
      this.makeWheel(0.5, 0.34, -2.55, 1.06),
      this.makeWheel(0.5, 0.34, -3.75, -1.06),
      this.makeWheel(0.5, 0.34, -3.75, 1.06),
    ]);

    // Standard Truck Cab + Chassis frame
    const makeTruckCab = (xMin: number, xMax: number, roofH: number) =>
      this.mergeParts([
        this.makeBox(xMax - xMin, roofH - 0.56, 2.34, (xMin + xMax) * 0.5, 0.56 + (roofH - 0.56) * 0.5, 0),
        this.makeBox(0.18, 0.24, 0.16, xMax - 0.35, 1.75, -1.26),
        this.makeBox(0.18, 0.24, 0.16, xMax - 0.35, 1.75, 1.26),
      ]);
    const truckWindshieldStd = this.trackGeo(this.makeBox(0.24, 0.68, 2.16, 4.38, 1.88, 0));
    const truckChassisGeo = this.mergeParts([
      this.makeBox(8.9, 0.32, 1.48, -0.05, 0.68, 0),
      this.makeBox(0.28, 0.34, 2.42, 4.42, 0.66, 0), // heavy front bumper
      this.makeBox(0.32, 0.28, 2.42, -4.46, 0.64, 0), // rear underride guard
    ]);

    // 2. truck-box (Colt Diesel / Hino amber cab + white corrugated cargo box)
    const boxCabGeo = this.mergeParts([
      makeTruckCab(2.25, 4.46, 2.42),
      this.makeBox(1.5, 0.36, 2.12, 3.0, 2.58, 0), // cab aero deflector
    ]);
    const boxCargoGeo = this.trackGeo(this.makeBox(6.48, 2.26, 2.46, -1.26, 1.98, 0));
    const boxSafetyStripe = this.mergeParts([
      this.makeBox(6.52, 0.12, 2.49, -1.26, 1.02, 0),
      this.makeBox(0.1, 0.16, 2.48, -4.48, 2.94, 0),
    ]);

    this.variantGeos.set('truck-box', {
      vClass: 'heavy',
      parts: [
        { geo: truckWheels3Axle, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: truckChassisGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimTire, pickable: true, parent: 'root' },
        { geo: boxCabGeo, mat: this.getPaintMat(0xf59e0b, 0.34, 0.24), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: truckWindshieldStd, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: false, parent: 'root' },
        { geo: boxCargoGeo, mat: this.getPaintMat(0xf8fafc, 0.38, 0.15), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: boxSafetyStripe, mat: this.getPaintMat(0xef4444, 0.4, 0.1), dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: heavyHeadlights,
      headlightsParent: 'root',
      brakeGeo: heavyBrakes,
      brakeY: 0.84,
      reverseGeo: heavyReverse,
      blinkerLeftGeo: heavyBlinkL,
      blinkerRightGeo: heavyBlinkR,
    });

    // 3. truck-heavy (Articulated Tractor Cab + Long Cargo Container)
    const semiTractorCabGeo = this.mergeParts([
      makeTruckCab(1.98, 4.48, 2.66),
      this.makeBox(0.16, 2.2, 0.16, 2.02, 1.85, -1.06), // left exhaust stack
      this.makeBox(0.16, 2.2, 0.16, 2.02, 1.85, 1.06), // right exhaust stack
    ]);
    const semiContainerGeo = this.trackGeo(this.makeBox(6.38, 2.38, 2.48, -1.36, 2.08, 0));
    const semiOrangeStripe = this.mergeParts([
      this.makeBox(6.42, 0.14, 2.5, -1.36, 3.16, 0),
      this.makeBox(6.42, 0.14, 2.5, -1.36, 1.02, 0),
      this.makeBox(0.12, 0.18, 1.5, 4.48, 0.72, 0),
    ]);

    this.variantGeos.set('truck-heavy', {
      vClass: 'heavy',
      parts: [
        { geo: truckWheelsSemi, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: truckChassisGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimTire, pickable: true, parent: 'root' },
        { geo: semiTractorCabGeo, mat: this.getPaintMat(0x475569, 0.36, 0.34), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: truckWindshieldStd, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: false, parent: 'root' },
        { geo: semiContainerGeo, mat: this.getPaintMat(0xf1f5f9, 0.42, 0.18), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: semiOrangeStripe, mat: this.getPaintMat(0xf97316, 0.4, 0.15), dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: heavyHeadlights,
      headlightsParent: 'root',
      brakeGeo: heavyBrakes,
      brakeY: 0.84,
      reverseGeo: heavyReverse,
      blinkerLeftGeo: heavyBlinkL,
      blinkerRightGeo: heavyBlinkR,
    });

    // 4. truck-dump (Cab + Angled Industrial Dump Bed!)
    const dumpCabGeo = this.trackGeo(makeTruckCab(2.25, 4.46, 2.38));
    const dumpBedGeo = this.mergeParts([
      // Industrial angled steel side & headboard silhouette extruded across 2.44m width
      this.extrudeProfile(
        [
          [-4.46, 0.92],
          [1.92, 0.86],
          [1.96, 2.36],
          [2.48, 2.46], // rock-guard canopy over rear cab edge
          [2.42, 2.58],
          [1.82, 2.52],
          [-4.22, 2.16], // sloped dump bed top edge
          [-4.48, 1.32],
        ],
        2.44,
        0.04
      ),
      // Exterior vertical reinforcement ribs along both flanks
      this.makeBox(0.18, 1.34, 2.52, 0.8, 1.62, 0),
      this.makeBox(0.18, 1.28, 2.52, -1.0, 1.58, 0),
      this.makeBox(0.18, 1.2, 2.52, -2.8, 1.52, 0),
    ]);
    const dumpInnerCargoGeo = this.trackGeo(this.makeBox(5.8, 0.34, 2.12, -1.2, 2.18, 0));

    this.variantGeos.set('truck-dump', {
      vClass: 'heavy',
      parts: [
        { geo: truckWheels3Axle, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: truckChassisGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimTire, pickable: true, parent: 'root' },
        { geo: dumpCabGeo, mat: this.getPaintMat(0xf59e0b, 0.36, 0.24), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: truckWindshieldStd, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: false, parent: 'root' },
        { geo: dumpBedGeo, mat: this.getPaintMat(0x64748b, 0.52, 0.38), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: dumpInnerCargoGeo, mat: this.getPaintMat(0x334155, 0.85, 0.1), dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: heavyHeadlights,
      headlightsParent: 'root',
      brakeGeo: heavyBrakes,
      brakeY: 0.84,
      reverseGeo: heavyReverse,
      blinkerLeftGeo: heavyBlinkL,
      blinkerRightGeo: heavyBlinkR,
    });

    // 5. truck-tanker (Cab + Horizontal Metallic Cylindrical Tank!)
    const tankerCabGeo = this.trackGeo(makeTruckCab(2.2, 4.46, 2.42));
    const tankCylinder = new THREE.CylinderGeometry(1.04, 1.04, 6.05, 18);
    tankCylinder.rotateZ(Math.PI / 2); // align tank along X axis!
    tankCylinder.translate(-1.35, 1.9, 0);
    // Dome end caps & cradle saddles
    const tankSaddles = this.mergeParts([
      this.makeBox(0.36, 0.54, 1.72, 0.7, 1.02, 0),
      this.makeBox(0.36, 0.54, 1.72, -1.35, 1.02, 0),
      this.makeBox(0.36, 0.54, 1.72, -3.4, 1.02, 0),
      this.makeBox(0.55, 0.16, 0.55, 0.4, 2.98, 0), // top manway hatch 1
      this.makeBox(0.55, 0.16, 0.55, -2.6, 2.98, 0), // top manway hatch 2
    ]);
    const tankBodyGeo = this.trackGeo(tankCylinder);
    const tankRedBand = new THREE.CylinderGeometry(1.06, 1.06, 0.72, 18);
    tankRedBand.rotateZ(Math.PI / 2);
    tankRedBand.translate(-1.35, 1.9, 0);
    const tankBandGeo = this.trackGeo(tankRedBand);

    this.variantGeos.set('truck-tanker', {
      vClass: 'heavy',
      parts: [
        { geo: truckWheels3Axle, mat: this.shared.tire, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: truckChassisGeo, mat: this.shared.darkTrim, dimMat: this.shared.dimTire, pickable: true, parent: 'root' },
        { geo: tankerCabGeo, mat: this.getPaintMat(0x1e293b, 0.34, 0.35), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: truckWindshieldStd, mat: this.shared.glass, dimMat: this.shared.dimGlass, pickable: false, parent: 'root' },
        { geo: tankSaddles, mat: this.shared.darkTrim, dimMat: this.shared.dimTire, pickable: false, parent: 'root' },
        { geo: tankBodyGeo, mat: this.getPaintMat(0xe2e8f0, 0.22, 0.74), dimMat: this.shared.dimBody, pickable: true, parent: 'root' },
        { geo: tankBandGeo, mat: this.getPaintMat(0xef4444, 0.32, 0.25), dimMat: this.shared.dimBody, pickable: false, parent: 'root' },
      ],
      headlightsGeo: heavyHeadlights,
      headlightsParent: 'root',
      brakeGeo: heavyBrakes,
      brakeY: 0.84,
      reverseGeo: heavyReverse,
      blinkerLeftGeo: heavyBlinkL,
      blinkerRightGeo: heavyBlinkR,
    });
  }

  // ---------------------------------------------------------------------------
  // Rig Instantiation from Shared Variant Templates
  // ---------------------------------------------------------------------------

  private buildRig(variant: VehicleVariantId): VehicleRig {
    const bundle = this.variantGeos.get(variant)!;
    const vClass = bundle.vClass;

    const root = new THREE.Group();
    const leanGroup = vClass === 'motor' ? new THREE.Group() : null;
    const handlebarGroup = vClass === 'motor' ? new THREE.Group() : null;

    if (leanGroup && handlebarGroup) {
      handlebarGroup.position.set(0.52, 0, 0);
      leanGroup.add(handlebarGroup);
      root.add(leanGroup);
    }

    const pickMeshes: THREE.Object3D[] = [];
    const swappables: SwappableMesh[] = [];

    for (let i = 0; i < bundle.parts.length; i++) {
      const part = bundle.parts[i];
      const mesh = new THREE.Mesh(part.geo, part.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (part.parent === 'handlebar' && handlebarGroup) {
        handlebarGroup.add(mesh);
      } else if (part.parent === 'lean' && leanGroup) {
        leanGroup.add(mesh);
      } else {
        root.add(mesh);
      }

      if (part.pickable) {
        pickMeshes.push(mesh);
      }
      swappables.push({ mesh, normalMat: part.mat, dimMat: part.dimMat });
    }

    // Headlights
    const headlightsMesh = new THREE.Mesh(bundle.headlightsGeo, this.shared.headlightOff);
    if (bundle.headlightsParent === 'handlebar' && handlebarGroup) {
      handlebarGroup.add(headlightsMesh);
    } else if (leanGroup) {
      leanGroup.add(headlightsMesh);
    } else {
      root.add(headlightsMesh);
    }

    // Headlight ground cone
    const headlightCone = new THREE.Mesh(
      this.headlightConeGeos[vClass],
      this.shared.headlightCone
    );
    headlightCone.position.y = 0.04;
    headlightCone.visible = false;
    root.add(headlightCone);

    // Brake light bar + Hard brake bloom
    const brakeMesh = new THREE.Mesh(bundle.brakeGeo, this.shared.brakeOff);
    brakeMesh.position.y = bundle.brakeY;
    if (leanGroup) {
      leanGroup.add(brakeMesh);
    } else {
      root.add(brakeMesh);
    }

    const brakeBloom = new THREE.Mesh(this.brakeBloomGeos[vClass], this.shared.brakeBloom);
    brakeBloom.position.y = 0.05;
    brakeBloom.visible = false;
    root.add(brakeBloom);

    // Reverse lamps
    const reverseMesh = new THREE.Mesh(bundle.reverseGeo, this.shared.reverseOn);
    reverseMesh.visible = false;
    if (leanGroup) {
      leanGroup.add(reverseMesh);
    } else {
      root.add(reverseMesh);
    }

    // Turn blinkers (-Z left, +Z right)
    const blinkerLeftMesh = new THREE.Mesh(bundle.blinkerLeftGeo, this.shared.blinkerOff);
    const blinkerRightMesh = new THREE.Mesh(bundle.blinkerRightGeo, this.shared.blinkerOff);
    if (leanGroup) {
      leanGroup.add(blinkerLeftMesh);
      leanGroup.add(blinkerRightMesh);
    } else {
      root.add(blinkerLeftMesh);
      root.add(blinkerRightMesh);
    }

    // Under-chassis archetype ground accent (y = 0.05m)
    const archetypeRing = new THREE.Mesh(
      this.archetypeRingGeos[vClass],
      this.shared.archetype.commuter
    );
    archetypeRing.position.y = 0.05;
    archetypeRing.visible = false;
    root.add(archetypeRing);

    // V2V Radar forward arc (y = 0.065m)
    const v2vArc = new THREE.Mesh(this.v2vArcGeos[vClass], this.shared.v2vArc);
    v2vArc.position.y = 0.065;
    v2vArc.visible = false;
    root.add(v2vArc);

    // Tactical / Caution / Yield / Yellow-Box forward ground halo (y = 0.075m)
    const tacticalHalo = new THREE.Mesh(
      this.tacticalHaloGeos[vClass],
      this.shared.tactical[2]
    );
    tacticalHalo.position.y = 0.075;
    tacticalHalo.visible = false;
    root.add(tacticalHalo);

    return {
      variant,
      vehicleId: -1,
      poolIdx: -1,
      root,
      readPos: new THREE.Vector3(),
      pickMeshes,
      swappables,
      leanGroup,
      handlebarGroup,
      steerAngle: 0,
      leanAngle: 0,
      headlightsMesh,
      headlightCone,
      brakeMesh,
      brakeBloom,
      reverseMesh,
      blinkerLeftMesh,
      blinkerRightMesh,
      archetypeRing,
      v2vArc,
      tacticalHalo,
      isDimmed: false,
      headlightsActive: false,
      brakeState: 0,
      reverseActive: false,
      leftBlinkerActive: false,
      rightBlinkerActive: false,
      lastArchetype: null,
      lastTacKind: 0,
    };
  }
}

interface VariantPartSpec {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  dimMat: THREE.Material;
  pickable: boolean;
  parent: 'root' | 'lean' | 'handlebar';
}

interface VariantGeometryBundle {
  vClass: VehicleClass;
  parts: VariantPartSpec[];
  headlightsGeo: THREE.BufferGeometry;
  headlightsParent: 'root' | 'lean' | 'handlebar';
  brakeGeo: THREE.BufferGeometry;
  brakeY: number;
  reverseGeo: THREE.BufferGeometry;
  blinkerLeftGeo: THREE.BufferGeometry;
  blinkerRightGeo: THREE.BufferGeometry;
}
