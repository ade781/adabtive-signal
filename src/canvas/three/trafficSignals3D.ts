import * as THREE from 'three';
import { SignalColor, SignalState } from '../../engine/types';

export interface SignalRigInput {
  armId: string;
  x: number;
  z: number;
  angleRad?: number;
}

export type SignalPoleInput = SignalRigInput;

export interface TrafficSignals3DController {
  group: THREE.Group;
  update: (signal: SignalState, ambientDarkness?: number) => void;
  dispose: () => void;
}

interface ColorVisualSpec {
  activeColor: THREE.Color;
  activeEmissive: THREE.Color;
  inactiveColor: THREE.Color;
  inactiveEmissive: THREE.Color;
}

const SIGNAL_SPECS: Record<SignalColor, ColorVisualSpec> = {
  red: {
    activeColor: new THREE.Color('#ff4d4d'),
    activeEmissive: new THREE.Color('#ef4444'),
    inactiveColor: new THREE.Color('#2a0b0d'),
    inactiveEmissive: new THREE.Color('#1f0709'),
  },
  yellow: {
    activeColor: new THREE.Color('#fde047'),
    activeEmissive: new THREE.Color('#f59e0b'),
    inactiveColor: new THREE.Color('#2b1e06'),
    inactiveEmissive: new THREE.Color('#1c1303'),
  },
  green: {
    activeColor: new THREE.Color('#34d399'),
    activeEmissive: new THREE.Color('#10b981'),
    inactiveColor: new THREE.Color('#07261c'),
    inactiveEmissive: new THREE.Color('#041912'),
  },
};

const ARROW_GLYPH_COLORS: Record<SignalColor, { color: THREE.Color; emissive: THREE.Color; backing: THREE.Color }> = {
  green: {
    color: new THREE.Color('#6ee7b7'),
    emissive: new THREE.Color('#10b981'),
    backing: new THREE.Color('#052016'),
  },
  yellow: {
    color: new THREE.Color('#fef08a'),
    emissive: new THREE.Color('#f59e0b'),
    backing: new THREE.Color('#241904'),
  },
  red: {
    color: new THREE.Color('#fca5a5'),
    emissive: new THREE.Color('#ef4444'),
    backing: new THREE.Color('#22080a'),
  },
};

const INACTIVE_EMISSIVE_INTENSITY = 0.05;
const BASE_ACTIVE_EMISSIVE_INTENSITY = 2.6;
const NIGHT_BOOST_EMISSIVE_INTENSITY = 2.6;
const BASE_ARROW_EMISSIVE_INTENSITY = 2.9;
const NIGHT_ARROW_BOOST_INTENSITY = 2.7;

const CARDINAL_ANGLE_RAD: Record<string, number> = {
  east: 0,
  south: Math.PI * 0.5,
  west: Math.PI,
  north: -Math.PI * 0.5,
};

const SIGNAL_ORDER: readonly SignalColor[] = ['red', 'yellow', 'green'];
const LENS_Y_OFFSETS: Record<SignalColor, number> = {
  red: 0.34,
  yellow: 0,
  green: -0.34,
};

interface PoleRigState {
  armId: string;
  lensMaterials: Record<SignalColor, THREE.MeshStandardMaterial>;
  rightArrowGroup: THREE.Group;
  arrowGlyphMat: THREE.MeshStandardMaterial;
  arrowBackingMat: THREE.MeshStandardMaterial;
  lastArrowColor: SignalColor | undefined;
}

/**
 * Resolves the outward arm angle in Canvas 2D Y-down / Three.js XZ radians
 * (`0 = +X East`, `PI/2 = +Z South`, `PI = -X West`, `-PI/2 = -Z North`).
 */
function resolvePoleAngleRad(pole: SignalPoleInput): number {
  if (typeof pole.angleRad === 'number' && Number.isFinite(pole.angleRad)) {
    return pole.angleRad;
  }
  const cardinal = CARDINAL_ANGLE_RAD[pole.armId];
  if (cardinal !== undefined) {
    return cardinal;
  }
  if (pole.x === 0 && pole.z === 0) {
    return 0;
  }
  // signalPos = sigDist * outDir + sigLat * inLeftNormal (~45 deg CW of outDir)
  return Math.atan2(pole.z, pole.x) - Math.PI * 0.25;
}

/**
 * Builds a clean bent right-turn arrow (`↱`) shape in the XY plane facing +Z.
 * Fits inside radius ~0.105m centered on the lens face.
 */
function createRightTurnArrowGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.055, -0.082);
  shape.lineTo(-0.02, -0.082);
  shape.lineTo(-0.02, 0.025);
  shape.lineTo(0.028, 0.025);
  shape.lineTo(0.028, 0.002);
  shape.lineTo(0.092, 0.0415);
  shape.lineTo(0.028, 0.081);
  shape.lineTo(0.028, 0.058);
  shape.lineTo(-0.038, 0.058);
  shape.lineTo(-0.055, 0.041);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 1);
}

/**
 * Creates realistic Indonesian urban 3D traffic signal gantry poles (`tiang APILL`)
 * with concrete plinths, dark slate galvanized steel vertical masts (~5.8m),
 * L-cantilever arms (~3.4m) reaching over the inbound curb toward the road centerline,
 * 3-aspect vertical signal housings with visors, and optional protected right-turn arrow heads.
 */
export function createTrafficSignals3D(poles: SignalPoleInput[]): TrafficSignals3DController {
  const group = new THREE.Group();
  group.name = 'traffic-signals-3d';

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(geo: T): T => {
    geometries.push(geo);
    return geo;
  };
  const trackMat = <T extends THREE.Material>(mat: T): T => {
    materials.push(mat);
    return mat;
  };

  // --- Shared structural geometries ---
  const concretePadGeo = trackGeo(new THREE.BoxGeometry(0.68, 0.14, 0.68));
  const concretePedestalGeo = trackGeo(new THREE.CylinderGeometry(0.24, 0.29, 0.4, 8));
  const flangePlateGeo = trackGeo(new THREE.BoxGeometry(0.38, 0.035, 0.38));
  const anchorBoltGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.045, 6));

  const mastGeo = trackGeo(new THREE.CylinderGeometry(0.088, 0.118, 4.78, 14));
  const safetyBandGeo = trackGeo(new THREE.CylinderGeometry(0.114, 0.116, 0.1, 14));
  const controlBoxGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.36, 0.24));
  const mastCouplerGeo = trackGeo(new THREE.CylinderGeometry(0.098, 0.098, 0.14, 14));

  const cantileverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 5.2, 0),
    new THREE.Vector3(0.04, 5.56, 0),
    new THREE.Vector3(0.36, 5.8, 0),
    new THREE.Vector3(0.95, 5.84, 0),
    new THREE.Vector3(3.4, 5.82, 0),
  ]);
  const cantileverGeo = trackGeo(new THREE.TubeGeometry(cantileverCurve, 24, 0.076, 10, false));
  const armEndCapGeo = trackGeo(new THREE.SphereGeometry(0.078, 10, 8));
  const gussetGeo = trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 1.11, 8));

  const clampCollarGeo = trackGeo(new THREE.CylinderGeometry(0.094, 0.094, 0.12, 10));
  const hangerDropGeo = trackGeo(new THREE.CylinderGeometry(0.034, 0.034, 0.56, 8));

  // --- Shared main 3-aspect housing geometries ---
  const mainHousingGeo = trackGeo(new THREE.BoxGeometry(0.4, 1.08, 0.26));
  const mainBackplateGeo = trackGeo(new THREE.BoxGeometry(0.46, 1.14, 0.025));
  const mainBezelGeo = trackGeo(new THREE.RingGeometry(0.114, 0.138, 24));
  const mainVisorGeo = trackGeo(
    new THREE.CylinderGeometry(0.145, 0.138, 0.17, 18, 1, true, Math.PI * 0.52, Math.PI * 0.96)
  );
  const lensGeo = trackGeo(new THREE.SphereGeometry(0.116, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5));
  lensGeo.scale(1, 0.34, 1);

  // --- Shared protected right-turn arrow geometries ---
  const arrowBracketGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.055, 0.055));
  const arrowHousingGeo = trackGeo(new THREE.BoxGeometry(0.38, 0.42, 0.24));
  const arrowBackplateGeo = trackGeo(new THREE.BoxGeometry(0.44, 0.48, 0.025));
  const arrowBackingLensGeo = trackGeo(new THREE.CircleGeometry(0.125, 24));
  const arrowBezelGeo = trackGeo(new THREE.RingGeometry(0.122, 0.144, 24));
  const arrowVisorGeo = trackGeo(
    new THREE.CylinderGeometry(0.15, 0.143, 0.17, 18, 1, true, Math.PI * 0.52, Math.PI * 0.96)
  );
  const arrowGlyphGeo = trackGeo(createRightTurnArrowGeometry());

  // --- Shared structural materials ---
  const concretePadMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x8a94a6, roughness: 0.92, metalness: 0.04 })
  );
  const concretePedestalMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x9aa4b5, roughness: 0.88, metalness: 0.04 })
  );
  const steelMastMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x263244, roughness: 0.42, metalness: 0.72 })
  );
  const darkHardwareMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1a2332, roughness: 0.52, metalness: 0.65 })
  );
  const safetyBandMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.45,
      metalness: 0.2,
      emissive: 0x713f12,
      emissiveIntensity: 0.12,
    })
  );
  const housingMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.68, metalness: 0.25 })
  );
  const backplateMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.28 })
  );
  const visorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.72,
      metalness: 0.2,
      side: THREE.DoubleSide,
    })
  );
  const bezelMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x060a12, roughness: 0.55, metalness: 0.35 })
  );

  const poleRigs: PoleRigState[] = [];
  const gussetTilt = -Math.atan2(0.72, 0.84);

  for (let i = 0; i < poles.length; i++) {
    const pole = poles[i];
    const angleRad = resolvePoleAngleRad(pole);

    const poleGroup = new THREE.Group();
    poleGroup.name = `signal-pole-${pole.armId}`;
    poleGroup.position.set(pole.x, 0, pole.z);
    // Align local +Z along outDir (toward approaching traffic) and local +X along -inLeftNormal (toward road centerline)
    poleGroup.rotation.y = Math.PI * 0.5 - angleRad;

    // 1. Concrete foundation plinth + steel base flange + anchor bolts
    const padMesh = new THREE.Mesh(concretePadGeo, concretePadMat);
    padMesh.position.y = 0.07;
    padMesh.castShadow = true;
    padMesh.receiveShadow = true;
    poleGroup.add(padMesh);

    const pedestalMesh = new THREE.Mesh(concretePedestalGeo, concretePedestalMat);
    pedestalMesh.position.y = 0.34;
    pedestalMesh.castShadow = true;
    pedestalMesh.receiveShadow = true;
    poleGroup.add(pedestalMesh);

    const flangeMesh = new THREE.Mesh(flangePlateGeo, darkHardwareMat);
    flangeMesh.position.y = 0.5575;
    flangeMesh.castShadow = true;
    poleGroup.add(flangeMesh);

    for (let bx = -1; bx <= 1; bx += 2) {
      for (let bz = -1; bz <= 1; bz += 2) {
        const bolt = new THREE.Mesh(anchorBoltGeo, darkHardwareMat);
        bolt.position.set(bx * 0.135, 0.58, bz * 0.135);
        poleGroup.add(bolt);
      }
    }

    // 2. Vertical galvanized steel mast + inspection box + safety band + L-cantilever arm
    const mastMesh = new THREE.Mesh(mastGeo, steelMastMat);
    mastMesh.position.y = 2.96;
    mastMesh.castShadow = true;
    mastMesh.receiveShadow = true;
    poleGroup.add(mastMesh);

    const safetyBand = new THREE.Mesh(safetyBandGeo, safetyBandMat);
    safetyBand.position.y = 1.05;
    poleGroup.add(safetyBand);

    const controlBox = new THREE.Mesh(controlBoxGeo, darkHardwareMat);
    controlBox.position.set(-0.15, 1.55, 0);
    controlBox.castShadow = true;
    poleGroup.add(controlBox);

    const mastCoupler = new THREE.Mesh(mastCouplerGeo, darkHardwareMat);
    mastCoupler.position.y = 5.3;
    poleGroup.add(mastCoupler);

    const cantileverMesh = new THREE.Mesh(cantileverGeo, steelMastMat);
    cantileverMesh.castShadow = true;
    poleGroup.add(cantileverMesh);

    const endCap = new THREE.Mesh(armEndCapGeo, darkHardwareMat);
    endCap.position.set(3.4, 5.82, 0);
    poleGroup.add(endCap);

    const gusset = new THREE.Mesh(gussetGeo, darkHardwareMat);
    gusset.position.set(0.42, 5.4, 0);
    gusset.rotation.z = gussetTilt;
    gusset.castShadow = true;
    poleGroup.add(gusset);

    const clampCollar = new THREE.Mesh(clampCollarGeo, darkHardwareMat);
    clampCollar.position.set(2.65, 5.825, 0);
    clampCollar.rotation.z = Math.PI * 0.5;
    poleGroup.add(clampCollar);

    const hangerDrop = new THREE.Mesh(hangerDropGeo, darkHardwareMat);
    hangerDrop.position.set(2.65, 5.56, 0.02);
    poleGroup.add(hangerDrop);

    // 3. Main 3-aspect vertical signal housing
    const mainHeadGroup = new THREE.Group();
    mainHeadGroup.position.set(2.65, 5.24, 0.04);

    const mainHousing = new THREE.Mesh(mainHousingGeo, housingMat);
    mainHousing.castShadow = true;
    mainHeadGroup.add(mainHousing);

    const mainBackplate = new THREE.Mesh(mainBackplateGeo, backplateMat);
    mainBackplate.position.z = -0.125;
    mainHeadGroup.add(mainBackplate);

    const lensMaterials = {} as Record<SignalColor, THREE.MeshStandardMaterial>;
    for (let j = 0; j < SIGNAL_ORDER.length; j++) {
      const colorKey = SIGNAL_ORDER[j];
      const yOff = LENS_Y_OFFSETS[colorKey];
      const spec = SIGNAL_SPECS[colorKey];

      const lensMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: spec.inactiveColor,
          emissive: spec.inactiveEmissive,
          emissiveIntensity: INACTIVE_EMISSIVE_INTENSITY,
          roughness: 0.2,
          metalness: 0.12,
        })
      );
      lensMaterials[colorKey] = lensMat;

      const lensMesh = new THREE.Mesh(lensGeo, lensMat);
      lensMesh.position.set(0, yOff, 0.131);
      lensMesh.rotation.x = Math.PI * 0.5;
      mainHeadGroup.add(lensMesh);

      const bezelMesh = new THREE.Mesh(mainBezelGeo, bezelMat);
      bezelMesh.position.set(0, yOff, 0.132);
      mainHeadGroup.add(bezelMesh);

      const visorMesh = new THREE.Mesh(mainVisorGeo, visorMat);
      visorMesh.position.set(0, yOff, 0.185);
      visorMesh.rotation.x = Math.PI * 0.5;
      mainHeadGroup.add(visorMesh);
    }

    poleGroup.add(mainHeadGroup);

    // 4. Optional Protected Right-Turn Arrow Head (↱) attached on driver's right (+local X)
    const rightArrowGroup = new THREE.Group();
    rightArrowGroup.position.set(3.16, 5.24, 0.04);
    rightArrowGroup.visible = false;

    const arrowBracket = new THREE.Mesh(arrowBracketGeo, darkHardwareMat);
    arrowBracket.position.set(-0.24, 0, -0.02);
    rightArrowGroup.add(arrowBracket);

    const arrowHousing = new THREE.Mesh(arrowHousingGeo, housingMat);
    arrowHousing.castShadow = true;
    rightArrowGroup.add(arrowHousing);

    const arrowBackplate = new THREE.Mesh(arrowBackplateGeo, backplateMat);
    arrowBackplate.position.z = -0.115;
    rightArrowGroup.add(arrowBackplate);

    const arrowBackingMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x070c14,
        emissive: ARROW_GLYPH_COLORS.green.backing,
        emissiveIntensity: 0.25,
        roughness: 0.24,
        metalness: 0.1,
      })
    );
    const arrowBackingLens = new THREE.Mesh(arrowBackingLensGeo, arrowBackingMat);
    arrowBackingLens.position.z = 0.122;
    rightArrowGroup.add(arrowBackingLens);

    const arrowBezel = new THREE.Mesh(arrowBezelGeo, bezelMat);
    arrowBezel.position.z = 0.123;
    rightArrowGroup.add(arrowBezel);

    const arrowVisor = new THREE.Mesh(arrowVisorGeo, visorMat);
    arrowVisor.position.z = 0.175;
    arrowVisor.rotation.x = Math.PI * 0.5;
    rightArrowGroup.add(arrowVisor);

    const arrowGlyphMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: ARROW_GLYPH_COLORS.green.color,
        emissive: ARROW_GLYPH_COLORS.green.emissive,
        emissiveIntensity: BASE_ARROW_EMISSIVE_INTENSITY,
        roughness: 0.18,
        metalness: 0.08,
      })
    );
    const arrowGlyphMesh = new THREE.Mesh(arrowGlyphGeo, arrowGlyphMat);
    arrowGlyphMesh.position.z = 0.127;
    rightArrowGroup.add(arrowGlyphMesh);

    poleGroup.add(rightArrowGroup);
    group.add(poleGroup);

    poleRigs.push({
      armId: pole.armId,
      lensMaterials,
      rightArrowGroup,
      arrowGlyphMat,
      arrowBackingMat,
      lastArrowColor: undefined,
    });
  }

  let disposed = false;
  let hasUpdated = false;
  let lastUpdateMs = 0;

  function update(signal: SignalState, ambientDarkness = 0): void {
    if (disposed) return;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let alpha = 1;
    if (hasUpdated) {
      const dtSec = Math.max(0.001, (nowMs - lastUpdateMs) * 0.001);
      // Snap cleanly on large pauses (>80ms), smooth exponentially at interactive frame rates
      alpha = dtSec > 0.08 ? 1 : 1 - Math.exp(-18 * dtSec);
    }
    hasUpdated = true;
    lastUpdateMs = nowMs;

    const darkness = Math.max(0, Math.min(1, ambientDarkness));
    const activeGlow = BASE_ACTIVE_EMISSIVE_INTENSITY + darkness * NIGHT_BOOST_EMISSIVE_INTENSITY;
    const arrowGlow = BASE_ARROW_EMISSIVE_INTENSITY + darkness * NIGHT_ARROW_BOOST_INTENSITY;

    const armColors = signal.multiPhase?.armColors as Record<string, SignalColor | undefined> | undefined;
    const armLights = signal.armLights as Record<string, SignalColor | undefined> | undefined;
    const arrowColors = signal.multiPhase?.armRightArrowColors;

    for (let i = 0; i < poleRigs.length; i++) {
      const rig = poleRigs[i];
      const activeColor: SignalColor =
        armColors?.[rig.armId] ??
        armLights?.[rig.armId] ??
        (rig.armId === signal.activeArm ? signal.activeColor : 'red');

      for (let j = 0; j < SIGNAL_ORDER.length; j++) {
        const key = SIGNAL_ORDER[j];
        const mat = rig.lensMaterials[key];
        const spec = SIGNAL_SPECS[key];
        const isLit = key === activeColor;

        const targetColor = isLit ? spec.activeColor : spec.inactiveColor;
        const targetEmissive = isLit ? spec.activeEmissive : spec.inactiveEmissive;
        const targetIntensity = isLit ? activeGlow : INACTIVE_EMISSIVE_INTENSITY;

        if (alpha >= 0.999) {
          mat.color.copy(targetColor);
          mat.emissive.copy(targetEmissive);
          mat.emissiveIntensity = targetIntensity;
        } else {
          mat.color.lerp(targetColor, alpha);
          mat.emissive.lerp(targetEmissive, alpha);
          mat.emissiveIntensity += (targetIntensity - mat.emissiveIntensity) * alpha;
        }
      }

      const rightColor = arrowColors?.[rig.armId];
      if (rightColor === undefined) {
        rig.rightArrowGroup.visible = false;
        rig.lastArrowColor = undefined;
      } else {
        const arrowAlpha = rig.lastArrowColor === undefined ? 1 : alpha;
        rig.rightArrowGroup.visible = true;
        rig.lastArrowColor = rightColor;

        const arrowSpec = ARROW_GLYPH_COLORS[rightColor];
        if (arrowAlpha >= 0.999) {
          rig.arrowGlyphMat.color.copy(arrowSpec.color);
          rig.arrowGlyphMat.emissive.copy(arrowSpec.emissive);
          rig.arrowGlyphMat.emissiveIntensity = arrowGlow;
          rig.arrowBackingMat.emissive.copy(arrowSpec.backing);
          rig.arrowBackingMat.emissiveIntensity = 0.24 + darkness * 0.16;
        } else {
          rig.arrowGlyphMat.color.lerp(arrowSpec.color, arrowAlpha);
          rig.arrowGlyphMat.emissive.lerp(arrowSpec.emissive, arrowAlpha);
          rig.arrowGlyphMat.emissiveIntensity +=
            (arrowGlow - rig.arrowGlyphMat.emissiveIntensity) * arrowAlpha;
          rig.arrowBackingMat.emissive.lerp(arrowSpec.backing, arrowAlpha);
          const targetBackIntensity = 0.24 + darkness * 0.16;
          rig.arrowBackingMat.emissiveIntensity +=
            (targetBackIntensity - rig.arrowBackingMat.emissiveIntensity) * arrowAlpha;
        }
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    group.clear();
    for (let i = 0; i < geometries.length; i++) {
      geometries[i].dispose();
    }
    for (let i = 0; i < materials.length; i++) {
      materials[i].dispose();
    }
    geometries.length = 0;
    materials.length = 0;
    poleRigs.length = 0;
  }

  return { group, update, dispose };
}
