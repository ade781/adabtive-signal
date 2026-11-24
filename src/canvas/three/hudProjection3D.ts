import * as THREE from 'three';
import { ARCHETYPE_TRAITS } from '../../engine/driverIntelligence';
import type {
  DriverArchetype,
  FrictionHeatmapSnapshot,
  MapOverlayLayers,
  SignalColor,
  SignalState,
  SimSnapshot,
  Vehicle,
} from '../../engine/types';
import { ARCHETYPE_COLORS } from '../MapHudOverlay';

// ============================================================================
// 1. FrictionHeatmap3D — Dynamic RGBA DataTexture Plane on 3D Asphalt (y=0.048m)
// ============================================================================

const HEAT_STOPS_RGB = [
  [251, 191, 36], // #FBBF24
  [245, 158, 11], // #F59E0B
  [249, 115, 22], // #F97316
  [244, 63, 94],  // #F43F5E
  [225, 29, 72],  // #E11D48
] as const;

/**
 * Renders the simulation's geospatial driver-friction grid onto the 3D road
 * via a single linearly-filtered RGBA DataTexture plane at y = 0.048m (zero GC).
 */
export class FrictionHeatmap3D {
  readonly mesh: THREE.Mesh;

  private gridSize: number;
  private data: Uint8Array;
  private texture: THREE.DataTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private disposed = false;

  constructor(scene?: THREE.Scene, initialGridSize = 28) {
    this.gridSize = Math.max(4, initialGridSize);
    this.data = new Uint8Array(this.gridSize * this.gridSize * 4);
    this.texture = this.createTexture(this.data, this.gridSize);

    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, 0.048, 0);
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;

    if (scene) {
      scene.add(this.mesh);
    }
  }

  private createTexture(buffer: Uint8Array, size: number): THREE.DataTexture {
    const tex = new THREE.DataTexture(
      buffer,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Updates the heatmap DataTexture in place from the latest FrictionHeatmapSnapshot.
   */
  update(
    grid: FrictionHeatmapSnapshot | undefined,
    visible: boolean,
    focusedArchetype: DriverArchetype | null
  ): void {
    if (this.disposed) return;

    if (!visible || !grid || grid.gridSize <= 0) {
      this.mesh.visible = false;
      return;
    }

    const cells = focusedArchetype ? grid.byArchetype[focusedArchetype] : grid.total;
    if (!cells || cells.length === 0) {
      this.mesh.visible = false;
      return;
    }

    const n = grid.gridSize;
    if (n !== this.gridSize) {
      this.gridSize = n;
      this.data = new Uint8Array(n * n * 4);
      this.texture.dispose();
      this.texture = this.createTexture(this.data, n);
      this.material.map = this.texture;
      this.material.needsUpdate = true;
    }

    const spanMeters = Math.max(40, grid.extentMeters) * 2;
    this.mesh.scale.set(spanMeters, spanMeters, 1);

    let peak = focusedArchetype ? 0.8 : Math.max(1.2, grid.maxVal);
    if (focusedArchetype) {
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] > peak) peak = cells[i];
      }
    }

    const buf = this.data;
    const invPeak = 1 / Math.max(0.001, peak);
    let hasHeat = false;

    for (let gy = 0; gy < n; gy++) {
      const srcRow = gy * n;
      // PlaneGeometry rotated -PI/2 maps North (-Z, gy=0) to UV v=1 (bottom-to-top with flipY=false)
      const texRow = (n - 1 - gy) * n;

      for (let gx = 0; gx < n; gx++) {
        const val = cells[srcRow + gx] ?? 0;
        const pIdx = (texRow + gx) * 4;

        if (val < 0.04) {
          buf[pIdx] = 0;
          buf[pIdx + 1] = 0;
          buf[pIdx + 2] = 0;
          buf[pIdx + 3] = 0;
          continue;
        }

        hasHeat = true;
        const norm = Math.min(1, val * invPeak);
        const scaled = norm * 4;
        const idx0 = Math.min(3, Math.floor(scaled));
        const frac = scaled - idx0;
        const c0 = HEAT_STOPS_RGB[idx0];
        const c1 = HEAT_STOPS_RGB[idx0 + 1];

        buf[pIdx] = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
        buf[pIdx + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
        buf[pIdx + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * frac);

        const edgeFade = val < 0.1 ? (val - 0.04) / 0.06 : 1;
        const alpha = (0.3 + 0.56 * Math.pow(norm, 0.72)) * edgeFade;
        buf[pIdx + 3] = Math.max(0, Math.min(225, Math.round(alpha * 255)));
      }
    }

    if (!hasHeat) {
      this.mesh.visible = false;
      return;
    }

    this.texture.needsUpdate = true;
    this.mesh.visible = true;
  }

  /**
   * Removes the heatmap plane from its parent and frees GPU buffers/textures.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// ============================================================================
// 2. SignalHead3DInput & OverlayProjectionScratch
// ============================================================================

const SIGNAL_COLORS: Record<SignalColor, string> = {
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
};

export type SignalHead3DInput = {
  armId: string;
  x: number;
  z: number;
  angleRad?: number;
};

export interface OverlayProjectionScratch {
  projA: THREE.Vector3;
  projB: THREE.Vector3;
  projC: THREE.Vector3;
  projD: THREE.Vector3;
  camTmp: THREE.Vector3;
  pillPosBuf: Float32Array;
  emotionHeightBuf: Float32Array;
  vehicleMap: Map<number, Vehicle>;
}

/**
 * Allocates reusable scratch vectors and overlap buffers for `drawProjected2DOverlays`.
 */
export function createOverlayProjectionScratch(): OverlayProjectionScratch {
  return {
    projA: new THREE.Vector3(),
    projB: new THREE.Vector3(),
    projC: new THREE.Vector3(),
    projD: new THREE.Vector3(),
    camTmp: new THREE.Vector3(),
    pillPosBuf: new Float32Array(512),
    emotionHeightBuf: new Float32Array(512),
    vehicleMap: new Map<number, Vehicle>(),
  };
}

const DEFAULT_SCRATCH = createOverlayProjectionScratch();
const DEFAULT_VEHICLE_PILL_HEIGHT = 2.2;

// ============================================================================
// 3. Projection & Coordinate Helpers (Zero-GC)
// ============================================================================

function getVehicleAnchorHeight(v: Vehicle, baseCarHeight: number): number {
  if (v.vClass === 'heavy') return Math.max(3.45, baseCarHeight + 1.35);
  if (v.vClass === 'motor') return Math.max(1.85, baseCarHeight - 0.1);
  return baseCarHeight;
}

/**
 * Converts vehicle-local coordinates (lx = right+, left-; ly = rear+, forward-)
 * into 3D world coordinates (wx, wy, wz) where +X is East and +Z is South.
 */
function setLocalVehiclePoint3D(
  out: THREE.Vector3,
  v: Vehicle,
  lx: number,
  ly: number,
  wy: number
): THREE.Vector3 {
  const cosH = Math.cos(v.heading);
  const sinH = Math.sin(v.heading);
  return out.set(v.x - ly * cosH - lx * sinH, wy, v.y - ly * sinH + lx * cosH);
}

function projectWorldPoint(
  camera: THREE.Camera,
  wx: number,
  wy: number,
  wz: number,
  halfW: number,
  halfH: number,
  out: THREE.Vector3
): boolean {
  out.set(wx, wy, wz).project(camera);
  if (
    !Number.isFinite(out.x) ||
    !Number.isFinite(out.y) ||
    !Number.isFinite(out.z) ||
    out.z < -1 ||
    out.z > 1
  ) {
    return false;
  }
  out.x = (out.x + 1) * halfW;
  out.y = (1 - out.y) * halfH;
  return true;
}

function projectWorldVec(
  camera: THREE.Camera,
  vec: THREE.Vector3,
  halfW: number,
  halfH: number
): boolean {
  vec.project(camera);
  if (
    !Number.isFinite(vec.x) ||
    !Number.isFinite(vec.y) ||
    !Number.isFinite(vec.z) ||
    vec.z < -1 ||
    vec.z > 1
  ) {
    return false;
  }
  vec.x = (vec.x + 1) * halfW;
  vec.y = (1 - vec.y) * halfH;
  return true;
}

/**
 * Projects a 3D line segment cleanly to screen pixels with near-plane clipping
 * so lines crossing behind a street-level perspective lens never invert across screen.
 */
function projectClippedSegment(
  camera: THREE.Camera,
  a: THREE.Vector3,
  b: THREE.Vector3,
  halfW: number,
  halfH: number
): boolean {
  const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
    ? (camera as THREE.PerspectiveCamera)
    : null;
  if (persp) {
    a.applyMatrix4(camera.matrixWorldInverse);
    b.applyMatrix4(camera.matrixWorldInverse);
    const zLimit = -Math.max(0.25, persp.near + 0.05);
    const aOut = a.z > zLimit;
    const bOut = b.z > zLimit;
    if (aOut && bOut) return false;
    if (aOut) {
      const t = (zLimit - a.z) / (b.z - a.z);
      a.lerp(b, t);
    } else if (bOut) {
      const t = (zLimit - b.z) / (a.z - b.z);
      b.lerp(a, t);
    }
    a.applyMatrix4(camera.projectionMatrix);
    b.applyMatrix4(camera.projectionMatrix);
  } else {
    a.project(camera);
    b.project(camera);
    if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) return false;
  }

  if (
    !Number.isFinite(a.x) ||
    !Number.isFinite(a.y) ||
    !Number.isFinite(b.x) ||
    !Number.isFinite(b.y)
  ) {
    return false;
  }

  a.x = (a.x + 1) * halfW;
  a.y = (1 - a.y) * halfH;
  b.x = (b.x + 1) * halfW;
  b.y = (1 - b.y) * halfH;
  return true;
}

function estimatePxPerMeter(
  camera: THREE.Camera,
  wx: number,
  wy: number,
  wz: number,
  viewportHeight: number,
  tmpVec: THREE.Vector3
): number {
  const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
    ? (camera as THREE.PerspectiveCamera)
    : null;
  if (persp) {
    tmpVec.set(wx, wy, wz);
    const dist = Math.max(1.5, camera.position.distanceTo(tmpVec));
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(persp.fov * 0.5));
    return viewportHeight / (2 * dist * Math.max(0.05, tanHalfFov));
  }
  const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera
    ? (camera as THREE.OrthographicCamera)
    : null;
  if (ortho) {
    return (viewportHeight * ortho.zoom) / Math.max(1, ortho.top - ortho.bottom);
  }
  return 8;
}

function drawLocalGroundArc(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  v: Vehicle,
  cxLocal: number,
  cyLocal: number,
  radius: number,
  wy: number,
  halfW: number,
  halfH: number,
  strokeStyle: string,
  lineWidth: number,
  scratch: OverlayProjectionScratch
): void {
  const a0 = -Math.PI * 0.74;
  const a1 = -Math.PI * 0.26;
  const { projA, projB, projC } = scratch;
  setLocalVehiclePoint3D(projA, v, cxLocal + Math.cos(a0) * radius, cyLocal + Math.sin(a0) * radius, wy);
  setLocalVehiclePoint3D(
    projB,
    v,
    cxLocal + Math.cos((a0 + a1) * 0.5) * radius * 1.15,
    cyLocal + Math.sin((a0 + a1) * 0.5) * radius * 1.15,
    wy
  );
  setLocalVehiclePoint3D(projC, v, cxLocal + Math.cos(a1) * radius, cyLocal + Math.sin(a1) * radius, wy);

  if (
    projectWorldVec(camera, projA, halfW, halfH) &&
    projectWorldVec(camera, projB, halfW, halfH) &&
    projectWorldVec(camera, projC, halfW, halfH)
  ) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(projA.x, projA.y);
    ctx.quadraticCurveTo(projB.x, projB.y, projC.x, projC.y);
    ctx.stroke();
  }
}

// ============================================================================
// 4. Projected Overlay Sub-Passes
// ============================================================================

function drawProjectedTacticalCues(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  vehicles: readonly Vehicle[],
  height: number,
  halfW: number,
  halfH: number,
  pulseWave: number,
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null,
  baseCarHeight: number,
  scratch: OverlayProjectionScratch
): void {
  const { projA, projB, projC, projD, camTmp } = scratch;

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const isSelected = selectedVehicleId !== null && v.id === selectedVehicleId;
    const dimmed = focusedArchetype !== null && v.archetype !== focusedArchetype && !isSelected;

    const halfWVeh = v.width * 0.5;
    const halfLVeh = v.length * 0.5;
    const pxPerM = estimatePxPerMeter(camera, v.x, 0.5, v.y, height, camTmp);
    if (pxPerM < 2.2 && !isSelected) continue;

    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.22;

    // 1. Occlusion Peek cone (4.5m forward)
    if (v.occlusionPeekActive) {
      setLocalVehiclePoint3D(projA, v, 0, -halfLVeh, 0.14);
      setLocalVehiclePoint3D(projB, v, -1.85, -halfLVeh - 4.5, 0.14);
      setLocalVehiclePoint3D(projC, v, 1.85, -halfLVeh - 4.5, 0.14);
      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.lineTo(projC.x, projC.y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
        ctx.lineWidth = Math.max(1.1, Math.min(2.2, pxPerM * 0.12));
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projC.x, projC.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 2. Heavy Wide-Swing Arc (BUS / TRK)
    if (
      v.vClass === 'heavy' &&
      (v.wideSwingState === 'pre_swing' || v.wideSwingState === 'turning')
    ) {
      const swingSide = v.turn === 'left' ? 1 : -1;
      const isPre = v.wideSwingState === 'pre_swing';
      setLocalVehiclePoint3D(projA, v, swingSide * (halfWVeh + 0.08), halfLVeh * 0.12, 0.16);
      setLocalVehiclePoint3D(projB, v, swingSide * (halfWVeh + 1.35), halfLVeh * 0.55, 0.16);
      setLocalVehiclePoint3D(projC, v, swingSide * (halfWVeh + 0.95), halfLVeh + 0.85, 0.16);
      setLocalVehiclePoint3D(projD, v, swingSide * (halfWVeh * 0.35), halfLVeh, 0.16);

      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH) &&
        projectWorldVec(camera, projD, halfW, halfH)
      ) {
        ctx.fillStyle = isPre ? 'rgba(245, 158, 11, 0.15)' : 'rgba(100, 116, 139, 0.16)';
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.quadraticCurveTo(projB.x, projB.y, projC.x, projC.y);
        ctx.lineTo(projD.x, projD.y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = isPre ? 'rgba(245, 158, 11, 0.9)' : 'rgba(148, 163, 184, 0.9)';
        ctx.lineWidth = Math.max(1.3, Math.min(2.6, pxPerM * 0.15));
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.quadraticCurveTo(projB.x, projB.y, projC.x, projC.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 3. Crossing lane/centerline marking flank underline
    if (v.crossingMarking) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.88)';
      ctx.lineWidth = Math.max(1.2, Math.min(2.4, pxPerM * 0.14));
      ctx.setLineDash([4, 3]);
      for (const side of [-1, 1] as const) {
        setLocalVehiclePoint3D(projA, v, side * (halfWVeh + 0.16), -halfLVeh * 0.78, 0.14);
        setLocalVehiclePoint3D(projB, v, side * (halfWVeh + 0.16), halfLVeh * 0.78, 0.14);
        if (projectClippedSegment(camera, projA, projB, halfW, halfH)) {
          ctx.beginPath();
          ctx.moveTo(projA.x, projA.y);
          ctx.lineTo(projB.x, projB.y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // 4. Overtake / Lane-Change Intent Arc + '!' Abort Indicator
    const hasOvertake = Boolean(v.overtakeState && v.overtakeState !== 'none');
    const hasPendingLC = v.pendingLaneChangeDir != null;
    if (hasOvertake || hasPendingLC) {
      const isAbort = v.overtakeState === 'abort';
      const dirSign =
        v.pendingLaneChangeDir != null
          ? v.pendingLaneChangeDir === 'left'
            ? -1
            : 1
          : v.laneChangeDir != null
            ? v.laneChangeDir === 'left'
              ? -1
              : 1
            : v.overtakeState === 'merge_back' || isAbort
              ? -1
              : 1;

      const startY = -halfLVeh - 0.1;
      const endX = dirSign * (v.width * 0.85 + 0.95);
      const endY = startY - 2.6;

      setLocalVehiclePoint3D(projA, v, 0, startY, 0.24);
      setLocalVehiclePoint3D(projB, v, dirSign * 0.25, startY - 1.55, 0.3);
      setLocalVehiclePoint3D(projC, v, endX, endY, 0.24);

      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.strokeStyle = isAbort ? 'rgba(244, 63, 94, 0.95)' : 'rgba(14, 165, 233, 0.92)';
        ctx.lineWidth = Math.max(1.5, Math.min(2.8, pxPerM * 0.17));
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.quadraticCurveTo(projB.x, projB.y, projC.x, projC.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const ang = Math.atan2(projC.y - projB.y, projC.x - projB.x);
        const headLen = Math.max(5.5, Math.min(9.5, pxPerM * 0.48));
        ctx.fillStyle = isAbort ? '#F43F5E' : '#0EA5E9';
        ctx.beginPath();
        ctx.moveTo(projC.x, projC.y);
        ctx.lineTo(
          projC.x - headLen * Math.cos(ang - 0.52),
          projC.y - headLen * Math.sin(ang - 0.52)
        );
        ctx.lineTo(
          projC.x - headLen * Math.cos(ang + 0.52),
          projC.y - headLen * Math.sin(ang + 0.52)
        );
        ctx.closePath();
        ctx.fill();
      }

      if (isAbort) {
        const badgeY = getVehicleAnchorHeight(v, baseCarHeight) * 0.72;
        setLocalVehiclePoint3D(projD, v, -dirSign * (halfWVeh + 0.45), -halfLVeh - 0.35, badgeY);
        if (projectWorldVec(camera, projD, halfW, halfH)) {
          ctx.fillStyle = '#F43F5E';
          ctx.beginPath();
          ctx.arc(projD.x, projD.y, 6.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '800 9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', projD.x, projD.y + 0.5);
        }
      }
    }

    // 5. YIELD Chevron + Micro-Tag
    if (v.isYielding) {
      const cy = -halfLVeh - 0.62;
      const cw = Math.min(0.85, Math.max(0.45, v.width * 0.42));
      setLocalVehiclePoint3D(projA, v, -cw, cy - 0.28, 0.2);
      setLocalVehiclePoint3D(projB, v, 0, cy + 0.25, 0.2);
      setLocalVehiclePoint3D(projC, v, cw, cy - 0.28, 0.2);
      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
        ctx.lineWidth = Math.max(1.4, Math.min(2.6, pxPerM * 0.16));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.lineTo(projC.x, projC.y);
        ctx.stroke();

        if (pxPerM >= 4.2 || isSelected) {
          const tx = projB.x;
          const ty = projB.y - 9;
          ctx.fillStyle = 'rgba(14, 165, 233, 0.92)';
          ctx.beginPath();
          ctx.roundRect(tx - 16, ty - 5.5, 32, 11, 2.5);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 8px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('YIELD', tx, ty + 0.5);
        }
      }
    }

    // 6. Yellow Box Hold Bar + YBOX Micro-Tag
    if (v.holdingYellowBox) {
      const barY = -halfLVeh - 0.46;
      const halfBarW = (v.width + 0.45) * 0.5;
      setLocalVehiclePoint3D(projA, v, -halfBarW, barY, 0.18);
      setLocalVehiclePoint3D(projB, v, halfBarW, barY, 0.18);
      if (projectClippedSegment(camera, projA, projB, halfW, halfH)) {
        ctx.lineCap = 'butt';
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = Math.max(3.6, Math.min(6.0, pxPerM * 0.34));
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.stroke();

        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = Math.max(2.0, Math.min(4.0, pxPerM * 0.22));
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (pxPerM >= 4.2 || isSelected) {
          const mx = (projA.x + projB.x) * 0.5;
          const my = (projA.y + projB.y) * 0.5 - 10;
          ctx.fillStyle = '#FACC15';
          ctx.strokeStyle = '#0F172A';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(mx - 14.5, my - 5.5, 29, 11, 2.5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#0F172A';
          ctx.font = '800 8px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('YBOX', mx, my + 0.5);
        }
      }
    }

    // 7. V2V / CAV Cyan Wave Arcs + Badge
    if (v.isConnected) {
      const noseY = -halfLVeh + 0.1;
      const r1 = halfWVeh + 0.58;
      const r2 = halfWVeh + 1.12;
      drawLocalGroundArc(
        ctx,
        camera,
        v,
        0,
        noseY,
        r1,
        0.22,
        halfW,
        halfH,
        'rgba(6, 182, 212, 0.8)',
        1.4,
        scratch
      );
      drawLocalGroundArc(
        ctx,
        camera,
        v,
        0,
        noseY,
        r2,
        0.22,
        halfW,
        halfH,
        'rgba(6, 182, 212, 0.45)',
        1.1,
        scratch
      );

      if (pxPerM >= 6.0 || isSelected) {
        setLocalVehiclePoint3D(projA, v, 0, -halfLVeh - 1.35, 0.55);
        if (projectWorldVec(camera, projA, halfW, halfH)) {
          ctx.fillStyle = 'rgba(8, 145, 178, 0.92)';
          ctx.beginPath();
          ctx.roundRect(projA.x - 11, projA.y - 5, 22, 10, 2.5);
          ctx.fill();
          ctx.fillStyle = '#ECFEFF';
          ctx.font = '700 7.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('V2V', projA.x, projA.y + 0.5);
        }
      }
    }

    // 8. RHK Cross-Yellow Launch Chevron
    if (v.rhkAnticipating) {
      const ly = -halfLVeh - 0.52 - pulseWave * 0.15;
      setLocalVehiclePoint3D(projA, v, -0.34, ly + 0.24, 0.22);
      setLocalVehiclePoint3D(projB, v, 0, ly - 0.14, 0.22);
      setLocalVehiclePoint3D(projC, v, 0.34, ly + 0.24, 0.22);
      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.strokeStyle = '#10B981';
        ctx.lineWidth = Math.max(1.5, Math.min(2.5, pxPerM * 0.15));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.lineTo(projC.x, projC.y);
        ctx.stroke();
      }

      setLocalVehiclePoint3D(projA, v, -0.26, ly - 0.04, 0.24);
      setLocalVehiclePoint3D(projB, v, 0, ly - 0.36, 0.24);
      setLocalVehiclePoint3D(projC, v, 0.26, ly - 0.04, 0.24);
      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = Math.max(1.2, Math.min(2.1, pxPerM * 0.12));
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.lineTo(projC.x, projC.y);
        ctx.stroke();
      }
    }

    // 9. Reversing rear directional chevron
    if (v.isReversing) {
      const ry = halfLVeh + 0.55;
      setLocalVehiclePoint3D(projA, v, -0.42, ry - 0.22, 0.22);
      setLocalVehiclePoint3D(projB, v, 0, ry + 0.22, 0.22);
      setLocalVehiclePoint3D(projC, v, 0.42, ry - 0.22, 0.22);
      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.92)';
        ctx.lineWidth = Math.max(1.4, Math.min(2.5, pxPerM * 0.15));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.lineTo(projC.x, projC.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

function drawProjectedSocialVectors(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  vehicles: readonly Vehicle[],
  vMap: Map<number, Vehicle>,
  halfW: number,
  halfH: number,
  pulseWave: number,
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null,
  scratch: OverlayProjectionScratch
): void {
  const { projA, projB, projC } = scratch;

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const isSelected = selectedVehicleId !== null && v.id === selectedVehicleId;
    const dimmed = focusedArchetype !== null && v.archetype !== focusedArchetype && !isSelected;

    // 1. Tailgate Pressure behind pressured vehicle
    const tg = v.tailgatePressure ?? 0;
    if (tg > 0.55) {
      const halfL = v.length * 0.5;
      const linkLen = 1.45 + tg * 1.15;
      const isHot = tg > 0.78;
      setLocalVehiclePoint3D(projA, v, 0, halfL + 0.25, 0.35);
      setLocalVehiclePoint3D(projB, v, 0, halfL + linkLen, 0.35);

      if (projectClippedSegment(camera, projA, projB, halfW, halfH)) {
        ctx.save();
        if (dimmed) ctx.globalAlpha = 0.24;
        ctx.strokeStyle = isHot
          ? `rgba(244, 63, 94, ${(0.62 + 0.32 * pulseWave).toFixed(2)})`
          : `rgba(245, 158, 11, ${(0.58 + 0.3 * pulseWave).toFixed(2)})`;
        ctx.lineWidth = 2.0;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const cy = halfL + 0.55 + (1 - pulseWave) * 0.35;
        setLocalVehiclePoint3D(projA, v, -0.42, cy + 0.34, 0.36);
        setLocalVehiclePoint3D(projB, v, 0, cy, 0.36);
        setLocalVehiclePoint3D(projC, v, 0.42, cy + 0.34, 0.36);
        if (
          projectWorldVec(camera, projA, halfW, halfH) &&
          projectWorldVec(camera, projB, halfW, halfH) &&
          projectWorldVec(camera, projC, halfW, halfH)
        ) {
          ctx.lineWidth = 1.9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(projA.x, projA.y);
          ctx.lineTo(projB.x, projB.y);
          ctx.lineTo(projC.x, projC.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 2. Cooperative Handshake (#10B981) / Yield Partner (#0EA5E9)
    const partnerId = v.handshakePartnerId ?? v.yieldTargetId;
    if (partnerId != null && partnerId !== v.id) {
      const target = vMap.get(partnerId);
      if (target) {
        const isMutualDup =
          v.handshakePartnerId != null &&
          target.handshakePartnerId === v.id &&
          v.id > target.id;
        if (!isMutualDup) {
          const dist = Math.hypot(target.x - v.x, target.y - v.y);
          if (dist > 0.8 && dist < 34) {
            projA.set(v.x, 0.72, v.y);
            projB.set(target.x, 0.72, target.y);
            if (projectClippedSegment(camera, projA, projB, halfW, halfH)) {
              ctx.save();
              if (dimmed) ctx.globalAlpha = 0.22;
              const isHandshake = v.handshakePartnerId != null;
              ctx.strokeStyle = isHandshake
                ? 'rgba(16, 185, 129, 0.86)'
                : 'rgba(14, 165, 233, 0.78)';
              ctx.lineWidth = 1.8;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.moveTo(projA.x, projA.y);
              ctx.lineTo(projB.x, projB.y);
              ctx.stroke();
              ctx.setLineDash([]);

              const mx = (projA.x + projB.x) * 0.5;
              const my = (projA.y + projB.y) * 0.5;
              ctx.fillStyle = isHandshake ? '#10B981' : '#0EA5E9';
              ctx.beginPath();
              ctx.arc(mx, my, 3.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }
    }

    // 3. Defensive Flanking Cushion on DEF / BUS
    const flank = v.flankingHazard ?? 0;
    if (flank > 0.1 && (v.archetype === 'defensive' || v.archetype === 'transit')) {
      const halfWVeh = v.width * 0.5;
      const halfLVeh = v.length * 0.5;
      const cushion = 0.42 + Math.min(0.45, flank * 0.42);
      const alpha = 0.44 + Math.min(0.4, flank * 0.45);

      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.22;
      ctx.strokeStyle = `rgba(16, 185, 129, ${alpha.toFixed(2)})`;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.lineWidth = 1.6;
      for (const side of [-1, 1] as const) {
        setLocalVehiclePoint3D(projA, v, side * (halfWVeh + 0.12), -halfLVeh * 0.72, 0.18);
        setLocalVehiclePoint3D(projB, v, side * (halfWVeh + cushion + 0.32), 0, 0.18);
        setLocalVehiclePoint3D(projC, v, side * (halfWVeh + 0.12), halfLVeh * 0.72, 0.18);
        if (
          projectWorldVec(camera, projA, halfW, halfH) &&
          projectWorldVec(camera, projB, halfW, halfH) &&
          projectWorldVec(camera, projC, halfW, halfH)
        ) {
          ctx.beginPath();
          ctx.moveTo(projA.x, projA.y);
          ctx.quadraticCurveTo(projB.x, projB.y, projC.x, projC.y);
          ctx.stroke();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
}

function drawProjectedSelectedReticleAndLinks(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  sel: Vehicle,
  vMap: Map<number, Vehicle>,
  halfW: number,
  halfH: number,
  pulseWave: number,
  scratch: OverlayProjectionScratch
): void {
  const { projA, projB, projC } = scratch;

  const drawLink = (targetId: number | undefined, color: string, dash: [number, number]) => {
    if (targetId == null || targetId === sel.id) return;
    const t = vMap.get(targetId);
    if (!t) return;
    const dist = Math.hypot(t.x - sel.x, t.y - sel.y);
    if (dist < 0.5 || dist > 65) return;

    projA.set(sel.x, 0.8, sel.y);
    projB.set(t.x, 0.8, t.y);
    if (!projectClippedSegment(camera, projA, projB, halfW, halfH)) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(projA.x, projA.y);
    ctx.lineTo(projB.x, projB.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(projB.x, projB.y, 4.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  drawLink(sel.leaderId, '#64748B', [6, 4]);
  drawLink(sel.overtakeTargetId, '#0EA5E9', [7, 3]);
  const coopId = sel.handshakePartnerId ?? sel.yieldTargetId;
  drawLink(coopId, '#10B981', [6, 3]);
  if (sel.yieldTargetId != null && sel.yieldTargetId !== coopId) {
    drawLink(sel.yieldTargetId, '#10B981', [6, 3]);
  }

  // Architectural 4-corner reticle projected onto the road plane around selected vehicle
  const r = Math.max(sel.length, sel.width) * 0.5 + 0.68 + pulseWave * 0.14;
  const armFrac = Math.min(0.45, Math.max(0.26, 0.72 / r));

  const corners: readonly [number, number][] = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ];

  const strokeCornerBrackets = () => {
    ctx.beginPath();
    for (let c = 0; c < 4; c++) {
      const [cx, cz] = corners[c];
      const legX = -Math.sign(cx) * r * armFrac;
      const legZ = -Math.sign(cz) * r * armFrac;
      setLocalVehiclePoint3D(projA, sel, cx + legX, cz, 0.16);
      setLocalVehiclePoint3D(projB, sel, cx, cz, 0.16);
      setLocalVehiclePoint3D(projC, sel, cx, cz + legZ, 0.16);
      if (
        projectWorldVec(camera, projA, halfW, halfH) &&
        projectWorldVec(camera, projB, halfW, halfH) &&
        projectWorldVec(camera, projC, halfW, halfH)
      ) {
        ctx.moveTo(projA.x, projA.y);
        ctx.lineTo(projB.x, projB.y);
        ctx.lineTo(projC.x, projC.y);
      }
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.lineWidth = 3.8;
  strokeCornerBrackets();

  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 2.0;
  strokeCornerBrackets();
  ctx.restore();
}

function drawProjectedEmotionBars(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  vehicles: readonly Vehicle[],
  width: number,
  height: number,
  halfW: number,
  halfH: number,
  pulseWave: number,
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null,
  baseCarHeight: number,
  scratch: OverlayProjectionScratch
): void {
  const { projA, camTmp } = scratch;

  if (scratch.emotionHeightBuf.length < vehicles.length) {
    scratch.emotionHeightBuf = new Float32Array(Math.max(512, vehicles.length));
  }
  const stackBuf = scratch.emotionHeightBuf;

  ctx.save();
  for (let i = 0; i < vehicles.length; i++) {
    stackBuf[i] = 0;
    const v = vehicles[i];
    const frust = v.frustration ?? 0;
    const caution = v.cautionTimer ?? 0;
    const hasFrust = frust >= 0.48;
    const hasCaution = caution > 0.2;
    if (!hasFrust && !hasCaution) continue;

    const isSelected = selectedVehicleId !== null && v.id === selectedVehicleId;
    const dimmed = focusedArchetype !== null && v.archetype !== focusedArchetype && !isSelected;

    const pxPerM = estimatePxPerMeter(camera, v.x, 0.5, v.y, height, camTmp);
    if (pxPerM < 3.5 && !isSelected) continue;

    const anchorY = getVehicleAnchorHeight(v, baseCarHeight);
    if (!projectWorldPoint(camera, v.x, anchorY, v.y, halfW, halfH, projA)) continue;
    if (projA.x < -30 || projA.x > width + 30 || projA.y < -30 || projA.y > height + 30) {
      continue;
    }

    const barW = Math.max(22, Math.min(34, v.width * 13));
    let barY = projA.y;
    let stackPx = 0;

    ctx.globalAlpha = dimmed ? 0.25 : 1;

    if (hasFrust) {
      const clamped = Math.min(1, frust);
      const barH = 4.2;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.beginPath();
      ctx.roundRect(projA.x - barW * 0.5, barY - barH * 0.5, barW, barH, 2);
      ctx.fill();

      ctx.fillStyle = clamped >= 0.82 ? '#F43F5E' : clamped >= 0.65 ? '#F97316' : '#F59E0B';
      ctx.beginPath();
      ctx.roundRect(projA.x - barW * 0.5, barY - barH * 0.5, barW * clamped, barH, 2);
      ctx.fill();

      barY -= 6;
      stackPx += 6;
    }

    if (hasCaution) {
      const cRatio = Math.min(1, caution / 6.0);
      const barH = 3.6;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.beginPath();
      ctx.roundRect(projA.x - barW * 0.5, barY - barH * 0.5, barW, barH, 1.8);
      ctx.fill();

      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.roundRect(projA.x - barW * 0.5, barY - barH * 0.5, barW * cRatio, barH, 1.8);
      ctx.fill();
      stackPx += 5.5;

      const pulseAlpha = (0.45 + 0.35 * pulseWave) * (dimmed ? 0.25 : 1);
      drawLocalGroundArc(
        ctx,
        camera,
        v,
        0,
        -v.length * 0.5 + 0.2,
        v.width * 0.5 + 0.42 + pulseWave * 0.14,
        0.18,
        halfW,
        halfH,
        `rgba(16, 185, 129, ${pulseAlpha.toFixed(2)})`,
        1.5,
        scratch
      );
    }

    stackBuf[i] = stackPx;
  }
  ctx.restore();
}

function drawProjectedArchetypePills(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  vehicles: readonly Vehicle[],
  width: number,
  height: number,
  halfW: number,
  halfH: number,
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null,
  hasEmotionBars: boolean,
  baseCarHeight: number,
  scratch: OverlayProjectionScratch
): void {
  const { projA, camTmp, pillPosBuf, emotionHeightBuf } = scratch;
  const pillW = 26;
  const pillH = 13;
  const halfPillW = pillW * 0.5;
  const halfPillH = pillH * 0.5;
  const maxStored = pillPosBuf.length >> 1;
  let placed = 0;

  ctx.save();
  ctx.font = '700 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.2;

  const drawOnePill = (v: Vehicle, idx: number, isSelected: boolean) => {
    if (!v.archetype) return;

    const pxPerM = estimatePxPerMeter(camera, v.x, 0.5, v.y, height, camTmp);
    if (!isSelected && focusedArchetype === null && pxPerM < 5.2) {
      return;
    }

    const anchorY = getVehicleAnchorHeight(v, baseCarHeight);
    if (!projectWorldPoint(camera, v.x, anchorY, v.y, halfW, halfH, projA)) return;

    const px = projA.x;
    const emotionShift = hasEmotionBars && idx < emotionHeightBuf.length ? emotionHeightBuf[idx] : 0;
    const py = projA.y - emotionShift - 9;

    if (px < -30 || px > width + 30 || py < -30 || py > height + 30) return;

    if (!isSelected) {
      for (let j = 0; j < placed; j++) {
        const ox = pillPosBuf[j * 2];
        const oy = pillPosBuf[j * 2 + 1];
        if (Math.abs(px - ox) < 28 && Math.abs(py - oy) < 15) {
          return;
        }
      }
    }

    if (placed < maxStored) {
      pillPosBuf[placed * 2] = px;
      pillPosBuf[placed * 2 + 1] = py;
      placed++;
    }

    const badge = ARCHETYPE_TRAITS[v.archetype].shortBadge;
    const borderCol = ARCHETYPE_COLORS[v.archetype] ?? '#64748B';

    ctx.fillStyle = isSelected ? '#020617' : 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = isSelected ? '#38BDF8' : borderCol;
    ctx.beginPath();
    ctx.roundRect(px - halfPillW, py - halfPillH, pillW, pillH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(badge, px, py + 0.5);
  };

  if (selectedVehicleId !== null) {
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id === selectedVehicleId) {
        drawOnePill(vehicles[i], i, true);
        break;
      }
    }
  }

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (!v.archetype) continue;
    if (selectedVehicleId !== null && v.id === selectedVehicleId) continue;
    if (focusedArchetype !== null && v.archetype !== focusedArchetype) continue;
    drawOnePill(v, i, false);
  }

  ctx.restore();
}

function projectSignalHeadAnchor(
  camera: THREE.Camera,
  head: SignalHead3DInput,
  halfW: number,
  halfH: number,
  out: THREE.Vector3
): boolean {
  let wx = head.x;
  let wz = head.z;
  let wy = 6.05;

  // Offset onto the overhanging cantilever signal head (local x=2.65m, y=6.08m) when angleRad is supplied
  if (typeof head.angleRad === 'number' && Number.isFinite(head.angleRad)) {
    wx += 2.65 * Math.sin(head.angleRad) + 0.04 * Math.cos(head.angleRad);
    wz += -2.65 * Math.cos(head.angleRad) + 0.04 * Math.sin(head.angleRad);
    wy = 6.08;
  }

  return projectWorldPoint(camera, wx, wy, wz, halfW, halfH, out);
}

function drawProjectedSignalCountdowns(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  signal: SignalState,
  signalHeads: readonly SignalHead3DInput[],
  width: number,
  height: number,
  halfW: number,
  halfH: number,
  scratch: OverlayProjectionScratch
): void {
  if (signalHeads.length === 0) return;

  const armColors: Record<string, SignalColor> = signal.multiPhase?.armColors ?? signal.armLights;
  const arrowColors: Record<string, SignalColor | undefined> =
    signal.multiPhase?.armRightArrowColors ?? {};

  const { projA } = scratch;
  const label = `${Math.ceil(Math.max(0, signal.phaseRemaining))}s`;

  ctx.save();
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.5;
  const tw = ctx.measureText(label).width + 10;

  let anyDrawn = false;
  for (let i = 0; i < signalHeads.length; i++) {
    const head = signalHeads[i];
    const mainColor = armColors[head.armId] ?? 'red';
    const rightColor = arrowColors[head.armId];
    const isActive = mainColor !== 'red' || (rightColor !== undefined && rightColor !== 'red');
    if (!isActive) continue;

    anyDrawn = true;
    if (!projectSignalHeadAnchor(camera, head, halfW, halfH, projA)) continue;

    const sx = projA.x;
    const sy = projA.y - 12;
    if (sx < -40 || sx > width + 40 || sy < -30 || sy > height + 30) continue;

    const borderColor =
      mainColor !== 'red'
        ? SIGNAL_COLORS[mainColor]
        : SIGNAL_COLORS[rightColor ?? signal.activeColor];

    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.roundRect(sx - tw * 0.5, sy - 8.5, tw, 17, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, sx, sy + 0.5);
  }

  // Fallback during all-red clearance: show pill above primary activeArm signal head
  if (!anyDrawn) {
    for (let i = 0; i < signalHeads.length; i++) {
      const head = signalHeads[i];
      if (head.armId !== signal.activeArm) continue;
      if (!projectSignalHeadAnchor(camera, head, halfW, halfH, projA)) break;

      const sx = projA.x;
      const sy = projA.y - 12;
      if (sx < -40 || sx > width + 40 || sy < -30 || sy > height + 30) break;

      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = SIGNAL_COLORS[signal.activeColor];
      ctx.beginPath();
      ctx.roundRect(sx - tw * 0.5, sy - 8.5, tw, 17, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, sx, sy + 0.5);
      break;
    }
  }

  ctx.restore();
}

function drawDynamicNorthCompass(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  cx: number,
  cy: number
): void {
  const m = camera.matrixWorld.elements;
  const northAngle = Math.atan2(-m[2], m[0]);

  ctx.save();

  ctx.beginPath();
  ctx.arc(cx, cy, 19, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.fill();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(northAngle);

  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(17.5, 0);
  ctx.moveTo(-15, 0);
  ctx.lineTo(-17.5, 0);
  ctx.moveTo(0, 15);
  ctx.lineTo(0, 17.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-4.8, -5.5);
  ctx.lineTo(4.8, -5.5);
  ctx.closePath();
  ctx.fillStyle = '#EF4444';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, 14.5);
  ctx.lineTo(-3.6, 5.5);
  ctx.lineTo(3.6, 5.5);
  ctx.closePath();
  ctx.fillStyle = '#CBD5E1';
  ctx.fill();

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, 6.2, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy + 0.5);

  ctx.restore();
}

// ============================================================================
// 5. Public Entry Point — drawProjected2DOverlays
// ============================================================================

/**
 * Projects 3D simulation state onto a transparent 2D HUD canvas layered above the WebGL view.
 * Uses pre-allocated scratch vectors and overlap buffers for strictly zero-GC 60 FPS rendering.
 */
export function drawProjected2DOverlays(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: THREE.Camera,
  snap: SimSnapshot,
  signalHeads: readonly SignalHead3DInput[],
  layers: MapOverlayLayers,
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null,
  scratch: OverlayProjectionScratch = DEFAULT_SCRATCH
): void {
  if (width <= 0 || height <= 0) return;

  camera.updateMatrixWorld();

  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const { vehicles, signal, stats } = snap;
  const pulseWave = 0.5 + 0.5 * Math.sin(stats.simTime * 6.0);

  const needMap = layers.socialVectors || selectedVehicleId !== null;
  const vMap = scratch.vehicleMap;
  if (needMap) {
    vMap.clear();
    for (let i = 0; i < vehicles.length; i++) {
      vMap.set(vehicles[i].id, vehicles[i]);
    }
  }

  ctx.save();

  if (layers.tacticalCues) {
    drawProjectedTacticalCues(
      ctx,
      camera,
      vehicles,
      height,
      halfW,
      halfH,
      pulseWave,
      focusedArchetype,
      selectedVehicleId,
      DEFAULT_VEHICLE_PILL_HEIGHT,
      scratch
    );
  }

  if (layers.socialVectors) {
    drawProjectedSocialVectors(
      ctx,
      camera,
      vehicles,
      vMap,
      halfW,
      halfH,
      pulseWave,
      focusedArchetype,
      selectedVehicleId,
      scratch
    );
  }

  if (selectedVehicleId !== null) {
    const sel = vMap.get(selectedVehicleId);
    if (sel) {
      drawProjectedSelectedReticleAndLinks(
        ctx,
        camera,
        sel,
        vMap,
        halfW,
        halfH,
        pulseWave,
        scratch
      );
    }
  }

  if (layers.emotionBars) {
    drawProjectedEmotionBars(
      ctx,
      camera,
      vehicles,
      width,
      height,
      halfW,
      halfH,
      pulseWave,
      focusedArchetype,
      selectedVehicleId,
      DEFAULT_VEHICLE_PILL_HEIGHT,
      scratch
    );
  }

  if (layers.identity) {
    drawProjectedArchetypePills(
      ctx,
      camera,
      vehicles,
      width,
      height,
      halfW,
      halfH,
      focusedArchetype,
      selectedVehicleId,
      layers.emotionBars,
      DEFAULT_VEHICLE_PILL_HEIGHT,
      scratch
    );
  }

  drawProjectedSignalCountdowns(
    ctx,
    camera,
    signal,
    signalHeads,
    width,
    height,
    halfW,
    halfH,
    scratch
  );

  drawDynamicNorthCompass(ctx, camera, width - 36, 36);

  ctx.restore();
}
