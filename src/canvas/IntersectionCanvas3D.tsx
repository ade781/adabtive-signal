import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MAP_OVERLAY_PRESETS } from '../engine/driverIntelligence';
import { CompiledTopology } from '../engine/topologyTypes';
import {
  DriverArchetype,
  MapOverlayLayers,
  SimConfig,
  SimSnapshot,
} from '../engine/types';
import { Camera3DPreset, MapHudOverlay } from './MapHudOverlay';
import { buildCityLandmarks3D } from './three/cityLandmarks3D';
import {
  drawProjected2DOverlays,
  EnvironmentRig3D,
  FrictionHeatmap3D,
} from './three/overlays3D';
import { buildRoadSurfaces3D } from './three/roadSurfaces3D';
import { createTrafficSignals3D } from './three/trafficSignals3D';
import { VehicleMeshPool3D } from './three/vehicleMeshes3D';

export interface IntersectionCanvas3DProps {
  snapshotRef: React.MutableRefObject<SimSnapshot>;
  uiSnapshot?: SimSnapshot;
  config: SimConfig;
  compiledTopology: CompiledTopology;
  running: boolean;
  drawTick: number;
  zoom: number;
  onZoomChange?: (nextZoom: number) => void;
  showGrid: boolean;
  overlayLayers?: MapOverlayLayers;
  focusedArchetype?: DriverArchetype | null;
  onSelectArchetype?: (arch: DriverArchetype | null) => void;
  selectedVehicleId?: number | null;
  onSelectVehicle?: (id: number | null) => void;
  /** Optional legacy toggle retained for parity with IntersectionCanvasProps. */
  showDriverOverlay?: boolean;
}

type RoadSurfaceBundle = ReturnType<typeof buildRoadSurfaces3D>;
type CityLandmarksBundle = ReturnType<typeof buildCityLandmarks3D>;
type TrafficSignalsBundle = ReturnType<typeof createTrafficSignals3D>;

const PRESET_LABELS: Record<Camera3DPreset, string> = {
  iso: 'Iso',
  top: 'Atas',
  street: 'Jalan',
  follow: 'Ikuti',
};

const CLICK_DRAG_THRESHOLD_PX = 5;

function computePresetPose(
  preset: Exclude<Camera3DPreset, 'follow'>,
  extentMeters: number,
  zoom: number
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const extent = Math.max(36, extentMeters);
  const zoomScale = 1 / Math.max(0.5, Math.min(2.8, zoom || 1));

  switch (preset) {
    case 'top':
      return {
        position: new THREE.Vector3(0, extent * 1.15 * zoomScale, 0.01),
        target: new THREE.Vector3(0, 0, 0),
      };
    case 'street':
      return {
        position: new THREE.Vector3(
          -24 * zoomScale,
          14 * Math.max(0.75, zoomScale),
          28 * zoomScale
        ),
        target: new THREE.Vector3(0, 2, 0),
      };
    case 'iso':
    default:
      return {
        position: new THREE.Vector3(
          0,
          extent * 0.72 * zoomScale,
          extent * 0.85 * zoomScale
        ),
        target: new THREE.Vector3(0, 0, 0),
      };
  }
}

function extractVehicleId(hitObject: THREE.Object3D): number | null {
  let cur: THREE.Object3D | null = hitObject;
  while (cur) {
    const rawId = cur.userData?.vehicleId;
    if (typeof rawId === 'number' && Number.isFinite(rawId)) {
      return rawId;
    }
    cur = cur.parent;
  }
  return null;
}

export const IntersectionCanvas3D: React.FC<IntersectionCanvas3DProps> = React.memo(({
  snapshotRef,
  uiSnapshot,
  config,
  compiledTopology,
  running,
  drawTick,
  zoom,
  onZoomChange,
  showGrid,
  overlayLayers,
  focusedArchetype = null,
  onSelectArchetype,
  selectedVehicleId = null,
  onSelectVehicle,
  showDriverOverlay = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraPreset, setCameraPreset] = useState<Camera3DPreset>('iso');
  const [hasUserCameraMoved, setHasUserCameraMoved] = useState(false);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  const resolvedLayers = useMemo<MapOverlayLayers>(() => {
    if (overlayLayers) return overlayLayers;
    if (showDriverOverlay) return MAP_OVERLAY_PRESETS.compact;
    return MAP_OVERLAY_PRESETS.off;
  }, [overlayLayers, showDriverOverlay]);

  // Mutable refs for zero-GC 60fps loop access
  const runningRef = useRef(running);
  runningRef.current = running;
  const zoomRef = useRef(zoom);
  const prevZoomRef = useRef(zoom);
  const resolvedLayersRef = useRef(resolvedLayers);
  resolvedLayersRef.current = resolvedLayers;
  const focusedArchetypeRef = useRef(focusedArchetype);
  focusedArchetypeRef.current = focusedArchetype;
  const selectedVehicleIdRef = useRef(selectedVehicleId);
  selectedVehicleIdRef.current = selectedVehicleId;
  const cameraPresetRef = useRef(cameraPreset);
  cameraPresetRef.current = cameraPreset;
  const hasUserCameraMovedRef = useRef(hasUserCameraMoved);
  hasUserCameraMovedRef.current = hasUserCameraMoved;
  const extentMetersRef = useRef<number>(
    config.customTopology
      ? Math.max(40, compiledTopology.maxExtentMeters)
      : Math.max(40, config.roadLength + 12)
  );

  // Three.js lifecycle refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const roadRef = useRef<RoadSurfaceBundle | null>(null);
  const cityRef = useRef<CityLandmarksBundle | null>(null);
  const signalsRef = useRef<TrafficSignalsBundle | null>(null);
  const vehiclePoolRef = useRef<VehicleMeshPool3D | null>(null);
  const environmentRigRef = useRef<EnvironmentRig3D | null>(null);
  const frictionHeatmapRef = useRef<FrictionHeatmap3D | null>(null);

  const sizeRef = useRef({ width: 800, height: 600, dpr: 1 });
  const loopRafRef = useRef<number>(0);
  const idleRafRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);

  const transitionRef = useRef<{
    active: boolean;
    targetPos: THREE.Vector3;
    targetLook: THREE.Vector3;
  }>({
    active: false,
    targetPos: new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
  });

  // Scratch vectors to keep per-frame tracking strictly zero-allocation
  const scratchPrevTarget = useRef(new THREE.Vector3());
  const scratchDesiredTarget = useRef(new THREE.Vector3());
  const scratchDelta = useRef(new THREE.Vector3());
  const scratchOffset = useRef(new THREE.Vector3());
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerNdcRef = useRef(new THREE.Vector2());

  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    moved: false,
  });

  // Auto-exit 'follow' if user closes vehicle inspector
  useEffect(() => {
    if (selectedVehicleId === null && cameraPresetRef.current === 'follow') {
      cameraPresetRef.current = 'iso';
      setCameraPreset('iso');
    }
  }, [selectedVehicleId]);

  const renderSingleFrame = useCallback((nowMs: number): boolean => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const vehiclePool = vehiclePoolRef.current;
    const environmentRig = environmentRigRef.current;
    const frictionHeatmap = frictionHeatmapRef.current;
    if (
      !renderer ||
      !scene ||
      !camera ||
      !controls ||
      !vehiclePool ||
      !environmentRig ||
      !frictionHeatmap
    ) {
      return false;
    }

    const prevTime = lastFrameTimeRef.current;
    const dt =
      prevTime > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - prevTime) / 1000)) : 1 / 60;
    lastFrameTimeRef.current = nowMs;

    const snap = snapshotRef.current;
    const layers = resolvedLayersRef.current;
    const focusedArch = focusedArchetypeRef.current;
    const selId = selectedVehicleIdRef.current;

    // 1. Update dynamic 3D world entities
    const env = snap.stats.environment;
    const headlightsOn = (env?.ambientDarkness ?? 0) > 0.1 || (env?.rainIntensity ?? 0) > 0.5;
    vehiclePool.syncFrame(
      snap.vehicles,
      snap.stats.simTime,
      headlightsOn,
      layers,
      focusedArch,
      selId
    );
    signalsRef.current?.update(snap.signal, env?.ambientDarkness ?? 0);
    environmentRig.update(snap, dt, cityRef.current?.streetLampEmissives);
    frictionHeatmap.update(snap.frictionGrid, layers.frictionHeatmap, focusedArch);

    // 2. Update camera preset transitions or 'follow' vehicle tracking
    const preset = cameraPresetRef.current;
    const transition = transitionRef.current;

    if (preset === 'follow' && selId !== null) {
      const rigPos = vehiclePool.getRigPosition(selId);
      if (rigPos) {
        const prevTarget = scratchPrevTarget.current.copy(controls.target);
        const desiredTarget = scratchDesiredTarget.current.set(
          rigPos.x,
          Math.max(0.8, rigPos.y),
          rigPos.z
        );
        const followAlpha = 1 - Math.exp(-10 * dt);
        controls.target.lerp(desiredTarget, followAlpha);
        const delta = scratchDelta.current.subVectors(controls.target, prevTarget);
        camera.position.add(delta);
        if (camera.position.y < 1.5) {
          camera.position.y = 1.5;
        }
      }
      transition.active = false;
    } else if (transition.active) {
      const lerpAlpha = 1 - Math.exp(-9 * dt);
      camera.position.lerp(transition.targetPos, lerpAlpha);
      controls.target.lerp(transition.targetLook, lerpAlpha);

      const posDone = camera.position.distanceToSquared(transition.targetPos) < 0.01;
      const lookDone = controls.target.distanceToSquared(transition.targetLook) < 0.01;
      if (posDone && lookDone) {
        camera.position.copy(transition.targetPos);
        controls.target.copy(transition.targetLook);
        transition.active = false;
      }
    }

    const controlsMoved = controls.update();

    // 3. Render 3D scene
    renderer.render(scene, camera);

    // 4. Render synchronized screen-space 2D overlay canvas
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        const { width, height, dpr } = sizeRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawProjected2DOverlays(
          ctx,
          width,
          height,
          camera,
          snap,
          roadRef.current?.sigPositions ?? [],
          layers,
          focusedArch,
          selId
        );
      }
    }

    return Boolean(controlsMoved) || transition.active;
  }, [snapshotRef]);

  const scheduleIdleRender = useCallback(() => {
    if (runningRef.current || idleRafRef.current !== 0) return;

    const tickIdle = (now: number) => {
      idleRafRef.current = 0;
      if (runningRef.current) return;
      const keepGoing = renderSingleFrame(now);
      if (keepGoing && !runningRef.current) {
        idleRafRef.current = requestAnimationFrame(tickIdle);
      }
    };

    idleRafRef.current = requestAnimationFrame(tickIdle);
  }, [renderSingleFrame]);

  const applyCameraPreset = useCallback(
    (preset: Camera3DPreset, immediate = false) => {
      cameraPresetRef.current = preset;
      setCameraPreset(preset);

      if (preset === 'follow') {
        transitionRef.current.active = false;
        scheduleIdleRender();
        return;
      }

      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const { position, target } = computePresetPose(
        preset,
        extentMetersRef.current,
        zoomRef.current
      );

      if (!camera || !controls) return;

      if (immediate) {
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        transitionRef.current.active = false;
      } else {
        transitionRef.current.targetPos.copy(position);
        transitionRef.current.targetLook.copy(target);
        transitionRef.current.active = true;
      }
      scheduleIdleRender();
    },
    [scheduleIdleRender]
  );

  // Initialize Three.js WebGLRenderer, Scene, Camera, OrbitControls, Dynamic Pools & ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    const webglCanvas = webglCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !webglCanvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: webglCanvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      setWebglError(
        err instanceof Error
          ? err.message
          : 'WebGL tidak tersedia di perangkat atau browser ini.'
      );
      return;
    }
    setWebglError(null);

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const rect = container.getBoundingClientRect();
    const initW = Math.max(1, Math.floor(rect.width));
    const initH = Math.max(1, Math.floor(rect.height));
    sizeRef.current = { width: initW, height: initH, dpr: pixelRatio };
    renderer.setSize(initW, initH, false);

    if (overlayCanvas) {
      overlayCanvas.width = Math.max(1, Math.floor(initW * pixelRatio));
      overlayCanvas.height = Math.max(1, Math.floor(initH * pixelRatio));
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, initW / initH, 0.5, 900);
    const initialPose = computePresetPose('iso', extentMetersRef.current, zoomRef.current);
    camera.position.copy(initialPose.position);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, webglCanvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 14;
    controls.maxDistance = 280;
    controls.screenSpacePanning = false;
    controls.target.copy(initialPose.target);
    controls.update();
    controlsRef.current = controls;

    const handleControlsStart = () => {
      transitionRef.current.active = false;
      if (!hasUserCameraMovedRef.current) {
        hasUserCameraMovedRef.current = true;
        setHasUserCameraMoved(true);
      }
    };
    const handleControlsChange = () => {
      if (!runningRef.current) {
        scheduleIdleRender();
      }
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    const vehiclePool = new VehicleMeshPool3D(scene);
    vehiclePoolRef.current = vehiclePool;
    const environmentRig = new EnvironmentRig3D(scene);
    environmentRigRef.current = environmentRig;
    const frictionHeatmap = new FrictionHeatmap3D(scene);
    frictionHeatmapRef.current = frictionHeatmap;

    const syncSize = () => {
      const box = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(box.width));
      const h = Math.max(1, Math.floor(box.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const prev = sizeRef.current;
      if (prev.width === w && prev.height === h && prev.dpr === dpr) {
        return;
      }
      sizeRef.current = { width: w, height: h, dpr };

      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      if (overlayCanvas) {
        const targetW = Math.max(1, Math.floor(w * dpr));
        const targetH = Math.max(1, Math.floor(h * dpr));
        if (overlayCanvas.width !== targetW || overlayCanvas.height !== targetH) {
          overlayCanvas.width = targetW;
          overlayCanvas.height = targetH;
        }
      }

      if (!runningRef.current) {
        scheduleIdleRender();
      }
    };

    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    return () => {
      if (loopRafRef.current !== 0) {
        cancelAnimationFrame(loopRafRef.current);
        loopRafRef.current = 0;
      }
      if (idleRafRef.current !== 0) {
        cancelAnimationFrame(idleRafRef.current);
        idleRafRef.current = 0;
      }

      ro.disconnect();
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      controlsRef.current = null;

      if (roadRef.current) {
        scene.remove(roadRef.current.group);
        roadRef.current.dispose();
        roadRef.current = null;
      }
      if (signalsRef.current) {
        scene.remove(signalsRef.current.group);
        signalsRef.current.dispose();
        signalsRef.current = null;
      }
      if (cityRef.current) {
        scene.remove(cityRef.current.group);
        cityRef.current.dispose();
        cityRef.current = null;
      }

      vehiclePool.dispose();
      vehiclePoolRef.current = null;
      environmentRig.dispose();
      environmentRigRef.current = null;
      frictionHeatmap.dispose();
      frictionHeatmapRef.current = null;

      if (overlayCanvas) {
        overlayCanvas.width = 0;
        overlayCanvas.height = 0;
      }

      renderer.dispose();
      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
      lastFrameTimeRef.current = 0;
    };
  }, [scheduleIdleRender]);

  // Static Road Surfaces & Traffic Signals rebuild ONLY on geometry/topology/wetness changes
  const weatherMode = config.environment?.weather ?? 'clear';
  const isWet = weatherMode === 'light-rain' || weatherMode === 'heavy-rain';

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (roadRef.current) {
      scene.remove(roadRef.current.group);
      roadRef.current.dispose();
      roadRef.current = null;
    }
    if (signalsRef.current) {
      scene.remove(signalsRef.current.group);
      signalsRef.current.dispose();
      signalsRef.current = null;
    }

    const road = buildRoadSurfaces3D(config, compiledTopology);
    roadRef.current = road;
    extentMetersRef.current = road.extentMeters;
    scene.add(road.group);

    const signals = createTrafficSignals3D(road.sigPositions);
    signalsRef.current = signals;
    scene.add(signals.group);

    const snap = snapshotRef.current;
    signals.update(snap.signal, snap.stats.environment?.ambientDarkness ?? 0);

    // If user hasn't manually orbited/switched away from default iso, frame new map cleanly
    if (cameraPresetRef.current === 'iso' && !hasUserCameraMovedRef.current) {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (camera && controls) {
        const pose = computePresetPose('iso', road.extentMeters, zoomRef.current);
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        controls.update();
      }
    }

    if (!runningRef.current) {
      scheduleIdleRender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compiledTopology,
    config.lanesPerDirection,
    config.laneWidth,
    config.roadLength,
    config.roadWidthPerDirection,
    config.motorBoxEnabled,
    config.hasMedian,
    config.leftTurnOnRed,
    config.yellowBoxEnabled,
    config.customTopology,
    config.environmentId,
    config.scenarioName,
    isWet,
    scheduleIdleRender,
  ]);

  // Static City Landmarks & Grid rebuild ONLY when geometry/topology/scenario/grid changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (cityRef.current) {
      scene.remove(cityRef.current.group);
      cityRef.current.dispose();
      cityRef.current = null;
    }

    const city = buildCityLandmarks3D(config, compiledTopology, showGrid);
    cityRef.current = city;
    scene.add(city.group);

    if (!runningRef.current) {
      scheduleIdleRender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    compiledTopology,
    config.lanesPerDirection,
    config.laneWidth,
    config.roadLength,
    config.roadWidthPerDirection,
    config.customTopology,
    config.environmentId,
    config.scenarioName,
    config.armNames?.north,
    config.armNames?.east,
    config.armNames?.south,
    config.armNames?.west,
    showGrid,
    scheduleIdleRender,
  ]);

  // Reset camera back to default isometric framing when switching maps/blueprints
  useEffect(() => {
    setHasUserCameraMoved(false);
    hasUserCameraMovedRef.current = false;
    applyCameraPreset('iso', true);
  }, [config.environmentId, compiledTopology, applyCameraPreset]);

  // Sync external zoom prop changes (e.g. from SettingsPage slider) without fighting OrbitControls
  useEffect(() => {
    const prevZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;
    zoomRef.current = zoom;

    if (Math.abs(zoom - prevZoom) < 1e-4) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const offset = scratchOffset.current.subVectors(camera.position, controls.target);
    const currentDist = offset.length();
    if (currentDist > 1e-4) {
      const ratio = Math.max(0.35, Math.min(2.8, prevZoom / Math.max(0.4, zoom)));
      const nextDist = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, currentDist * ratio)
      );
      offset.setLength(nextDist);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      if (!runningRef.current) {
        scheduleIdleRender();
      }
    }
  }, [zoom, scheduleIdleRender]);

  // Continuous 60fps render loop while running === true
  useEffect(() => {
    if (!running) {
      if (loopRafRef.current !== 0) {
        cancelAnimationFrame(loopRafRef.current);
        loopRafRef.current = 0;
      }
      return;
    }

    if (idleRafRef.current !== 0) {
      cancelAnimationFrame(idleRafRef.current);
      idleRafRef.current = 0;
    }
    lastFrameTimeRef.current = performance.now();

    const loop = (now: number) => {
      renderSingleFrame(now);
      loopRafRef.current = requestAnimationFrame(loop);
    };
    loopRafRef.current = requestAnimationFrame(loop);

    return () => {
      if (loopRafRef.current !== 0) {
        cancelAnimationFrame(loopRafRef.current);
        loopRafRef.current = 0;
      }
    };
  }, [running, renderSingleFrame]);

  // On-demand render when paused and drawTick or visual props change
  useEffect(() => {
    if (!running) {
      scheduleIdleRender();
    }
  }, [
    running,
    drawTick,
    showGrid,
    resolvedLayers,
    focusedArchetype,
    selectedVehicleId,
    cameraPreset,
    config,
    compiledTopology,
    scheduleIdleRender,
  ]);

  const handleSelectCameraPreset = useCallback(
    (preset: Camera3DPreset) => {
      applyCameraPreset(preset, false);
    },
    [applyCameraPreset]
  );

  const handleResetView = useCallback(() => {
    setHasUserCameraMoved(false);
    hasUserCameraMovedRef.current = false;
    zoomRef.current = 1;
    prevZoomRef.current = 1;
    if (Math.abs(zoom - 1) > 0.01) {
      onZoomChange?.(1);
    }
    applyCameraPreset('iso', false);
  }, [zoom, onZoomChange, applyCameraPreset]);

  // Click-to-inspect Raycaster (< 5px pointer travel distinguishes clicks from orbiting/panning)
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const drag = pointerDragRef.current;
    drag.active = true;
    drag.pointerId = e.pointerId;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.moved = false;
    setIsGrabbing(true);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = pointerDragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId || drag.moved) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= CLICK_DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
  }, []);

  const finishPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
      const drag = pointerDragRef.current;
      if (!drag.active || drag.pointerId !== e.pointerId) return;
      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      const wasClick = !cancelled && !drag.moved && dist < CLICK_DRAG_THRESHOLD_PX;
      drag.active = false;
      drag.pointerId = -1;
      drag.moved = false;
      setIsGrabbing(false);

      if (!wasClick || !onSelectVehicle) return;

      const canvas = webglCanvasRef.current;
      const camera = cameraRef.current;
      const vehiclePool = vehiclePoolRef.current;
      if (!canvas || !camera || !vehiclePool) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const ndc = pointerNdcRef.current;
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      camera.updateMatrixWorld();
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(ndc, camera);

      const pickables = vehiclePool.getPickableMeshes();
      const hits = raycaster.intersectObjects(pickables, true);
      let hitVehicleId: number | null = null;
      for (let i = 0; i < hits.length; i++) {
        const foundId = extractVehicleId(hits[i].object);
        if (foundId !== null) {
          hitVehicleId = foundId;
          break;
        }
      }

      onSelectVehicle(hitVehicleId);
    },
    [onSelectVehicle]
  );

  const showResetView =
    cameraPreset !== 'iso' || hasUserCameraMoved || Math.abs(zoom - 1) > 0.02;

  const liveSnap = uiSnapshot ?? snapshotRef.current;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#DCE7F2] rounded-lg border border-slate-200 select-none"
    >
      <canvas
        ref={webglCanvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointer(e, false)}
        onPointerCancel={(e) => finishPointer(e, true)}
        className={`block w-full h-full touch-none outline-none ${
          isGrabbing ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        role="img"
        aria-label={
          config.scenarioName
            ? `Simulasi simpang 3D: ${config.scenarioName}`
            : 'Kanvas simulasi simpang 3D interaktif'
        }
      />

      <canvas
        ref={overlayCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full"
      />

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 p-6 text-center">
          <div className="max-w-sm rounded-lg border border-slate-700 bg-slate-800 p-4 text-slate-100 shadow-sm space-y-2">
            <div className="text-xs font-semibold text-amber-300">Mode 3D WebGL Tidak Tersedia</div>
            <p className="text-[11px] text-slate-300 font-mono break-words">{webglError}</p>
          </div>
        </div>
      )}

      <MapHudOverlay
        config={config}
        compiledTopology={compiledTopology}
        liveSnap={liveSnap}
        resolvedLayers={resolvedLayers}
        focusedArchetype={focusedArchetype}
        onSelectArchetype={onSelectArchetype}
        selectedVehicleId={selectedVehicleId}
        onSelectVehicle={onSelectVehicle}
        showResetView={showResetView}
        resetViewLabel={cameraPreset !== 'iso' ? PRESET_LABELS[cameraPreset] : undefined}
        onResetView={handleResetView}
        is3D
        cameraPreset={cameraPreset}
        onSelectCameraPreset={handleSelectCameraPreset}
      />
    </div>
  );
});
