import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MAP_OVERLAY_PRESETS } from '../engine/driverIntelligence';
import { getEffectiveRoadWidth } from '../engine/geometry';
import { CompiledTopology } from '../engine/topologyTypes';
import {
  DriverArchetype,
  MapOverlayLayers,
  SimConfig,
  SimSnapshot,
} from '../engine/types';
import { Camera3DPreset, MapHudOverlay } from './MapHudOverlay';
import {
  createOverlayProjectionScratch,
  drawProjected2DOverlays,
  FrictionHeatmap3D,
  OverlayProjectionScratch,
} from './three/hudProjection3D';
import { buildIndonesianCity3D, IndonesianCity3DResult } from './three/indonesianCity3D';
import { IndonesianFleet3D } from './three/indonesianFleet3D';
import {
  GRAPHICS_QUALITY_PROFILES,
  GraphicsQuality3D,
} from './three/qualityConfig3D';
import { buildRoadWorld3D, RoadWorld3DResult } from './three/roadWorld3D';
import { SkyAndLighting3D } from './three/skyAndLighting3D';

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
  showDriverOverlay?: boolean;
  graphicsQuality?: GraphicsQuality3D;
}

function computePresetPose(
  preset: Exclude<Camera3DPreset, 'follow'>,
  extentMeters: number,
  zoom: number
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const safeExt = Math.max(45, extentMeters);
  const safeZoom = Math.max(0.5, Math.min(2.6, zoom || 1));
  const scale = 1 / safeZoom;

  if (preset === 'top') {
    return {
      position: new THREE.Vector3(0, safeExt * 1.15 * scale, 0.01),
      target: new THREE.Vector3(0, 0, 0),
    };
  }
  if (preset === 'street') {
    return {
      position: new THREE.Vector3(-24 * scale, 12.5 * scale, 28 * scale),
      target: new THREE.Vector3(0, 2, 0),
    };
  }
  return {
    position: new THREE.Vector3(0, safeExt * 0.7 * scale, safeExt * 0.84 * scale),
    target: new THREE.Vector3(0, 0, 0),
  };
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
  graphicsQuality = 'balanced',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [webglError, setWebglError] = useState<string | null>(null);
  const [cameraPreset, setCameraPreset] = useState<Camera3DPreset>('iso');
  const [hasUserCameraMoved, setHasUserCameraMoved] = useState(false);

  const qualityProfile = GRAPHICS_QUALITY_PROFILES[graphicsQuality] ?? GRAPHICS_QUALITY_PROFILES.balanced;

  const resolvedLayers = useMemo<MapOverlayLayers>(() => {
    if (overlayLayers) return overlayLayers;
    if (showDriverOverlay) return MAP_OVERLAY_PRESETS.compact;
    return MAP_OVERLAY_PRESETS.off;
  }, [overlayLayers, showDriverOverlay]);

  const halfRoad = getEffectiveRoadWidth(config);
  const halfBox = halfRoad + 2.0;
  const isCustomTopo = Boolean(config.customTopology);
  const extentMeters = isCustomTopo
    ? compiledTopology.maxExtentMeters
    : halfBox + config.roadLength;

  // Latest reactive refs for zero-rebind 60fps RAF loop
  const runningRef = useRef(running);
  runningRef.current = running;
  const resolvedLayersRef = useRef(resolvedLayers);
  resolvedLayersRef.current = resolvedLayers;
  const focusedArchetypeRef = useRef(focusedArchetype);
  focusedArchetypeRef.current = focusedArchetype;
  const selectedVehicleIdRef = useRef(selectedVehicleId);
  selectedVehicleIdRef.current = selectedVehicleId;
  const cameraPresetRef = useRef<Camera3DPreset>(cameraPreset);
  cameraPresetRef.current = cameraPreset;
  const extentMetersRef = useRef(extentMeters);
  extentMetersRef.current = extentMeters;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const qualityProfileRef = useRef(qualityProfile);
  qualityProfileRef.current = qualityProfile;

  // Three.js object refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const roadRef = useRef<RoadWorld3DResult | null>(null);
  const cityRef = useRef<IndonesianCity3DResult | null>(null);
  const fleetRef = useRef<IndonesianFleet3D | null>(null);
  const skyRigRef = useRef<SkyAndLighting3D | null>(null);
  const frictionHeatmapRef = useRef<FrictionHeatmap3D | null>(null);

  const sizeRef = useRef({ width: 800, height: 600, dpr: 1 });
  const overlayScratchRef = useRef<OverlayProjectionScratch>(createOverlayProjectionScratch());
  const lastOverlayDrawRef = useRef(0);

  const raycasterRef = useRef(new THREE.Raycaster());
  const ndcPointerRef = useRef(new THREE.Vector2());
  const pointerDownPosRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const transitionRef = useRef<{
    active: boolean;
    targetPos: THREE.Vector3;
    targetLook: THREE.Vector3;
  }>({
    active: false,
    targetPos: new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
  });

  const scratchFollowPos = useRef(new THREE.Vector3());
  const scratchPrevTarget = useRef(new THREE.Vector3());
  const scratchDelta = useRef(new THREE.Vector3());

  const idleRafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const renderFrameNow = useCallback((nowMs: number, forceOverlay = false): boolean => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const fleet = fleetRef.current;
    const skyRig = skyRigRef.current;
    const frictionHeatmap = frictionHeatmapRef.current;
    if (!renderer || !scene || !camera || !controls || !fleet || !skyRig || !frictionHeatmap) {
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
    const qProf = qualityProfileRef.current;

    const env = snap.stats.environment;
    const headlightsOn = (env?.ambientDarkness ?? 0) > 0.1 || (env?.rainIntensity ?? 0) > 0.5;

    // 1. Update Instanced Fleet, Signals, Sky/PMREM IBL & Heatmap
    fleet.syncFrame(snap.vehicles, snap.stats.simTime, headlightsOn, layers, focusedArch, selId);
    cityRef.current?.updateSignals(snap.signal, env?.ambientDarkness ?? 0);
    skyRig.update(snap, dt, {
      targetX: controls.target.x,
      targetZ: controls.target.z,
      streetLampEmissives: cityRef.current?.streetLampEmissives,
      nightFacadeMats: cityRef.current?.nightFacadeMats,
      lightPoolMat: cityRef.current?.lightPoolMat,
    });
    frictionHeatmap.update(snap.frictionGrid, layers.frictionHeatmap, focusedArch);

    // 2. Camera preset transition or vehicle follow
    const preset = cameraPresetRef.current;
    const transition = transitionRef.current;
    if (preset === 'follow' && selId !== null) {
      if (fleet.getVehiclePosition(selId, snap.vehicles, scratchFollowPos.current)) {
        const prevT = scratchPrevTarget.current.copy(controls.target);
        const followAlpha = 1 - Math.exp(-10 * dt);
        controls.target.lerp(scratchFollowPos.current, followAlpha);
        const delta = scratchDelta.current.subVectors(controls.target, prevT);
        camera.position.add(delta);
      }
    } else if (transition.active) {
      const alpha = 1 - Math.exp(-9 * dt);
      camera.position.lerp(transition.targetPos, alpha);
      controls.target.lerp(transition.targetLook, alpha);
      if (
        camera.position.distanceToSquared(transition.targetPos) < 0.04 &&
        controls.target.distanceToSquared(transition.targetLook) < 0.01
      ) {
        camera.position.copy(transition.targetPos);
        controls.target.copy(transition.targetLook);
        transition.active = false;
      }
    }

    const controlsMoved = controls.update();
    renderer.render(scene, camera);

    // 3. Throttled 2D Screen-Space HUD/AI Overlay Projection
    const overlayCanvas = overlayCanvasRef.current;
    const minOverlayInterval = 1000 / Math.max(15, qProf.overlayFps);
    if (
      overlayCanvas &&
      (forceOverlay ||
        nowMs - lastOverlayDrawRef.current >= minOverlayInterval ||
        !runningRef.current)
    ) {
      lastOverlayDrawRef.current = nowMs;
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        const { width, height, dpr } = sizeRef.current;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const sigHeads = roadRef.current?.sigPositions ?? [];
        drawProjected2DOverlays(
          ctx,
          width,
          height,
          camera,
          snap,
          sigHeads,
          layers,
          focusedArch,
          selId,
          overlayScratchRef.current
        );
        ctx.restore();
      }
    }

    return Boolean(controlsMoved || transition.active);
  }, [snapshotRef]);

  const scheduleIdleRender = useCallback(() => {
    if (runningRef.current || idleRafRef.current !== null) return;
    idleRafRef.current = requestAnimationFrame((now) => {
      idleRafRef.current = null;
      const needsMore = renderFrameNow(now, true);
      if (needsMore && !runningRef.current) {
        scheduleIdleRender();
      }
    });
  }, [renderFrameNow]);

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

  // Initialize WebGLRenderer, Scene, OrbitControls, SkyAndLighting3D & Instanced Fleet
  useEffect(() => {
    const container = containerRef.current;
    const webglCanvas = webglCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !webglCanvas) return;

    const initQ = qualityProfileRef.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: webglCanvas,
        antialias: initQ.antialias,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      setWebglError(
        err instanceof Error ? err.message : 'WebGL tidak tersedia di perangkat atau browser ini.'
      );
      return;
    }
    setWebglError(null);

    const dpr = Math.min(window.devicePixelRatio || 1, initQ.maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.shadowMap.enabled = initQ.staticShadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = !initQ.staticShadows;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const rect = container.getBoundingClientRect();
    const initW = Math.max(1, Math.floor(rect.width));
    const initH = Math.max(1, Math.floor(rect.height));
    sizeRef.current = { width: initW, height: initH, dpr };
    renderer.setSize(initW, initH, false);

    if (overlayCanvas) {
      overlayCanvas.width = Math.max(1, Math.floor(initW * dpr));
      overlayCanvas.height = Math.max(1, Math.floor(initH * dpr));
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, initW / initH, 0.5, 950);
    const initialPose = computePresetPose('iso', extentMetersRef.current, zoomRef.current);
    camera.position.copy(initialPose.position);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, webglCanvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 12;
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
      if (!runningRef.current) scheduleIdleRender();
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    const skyRig = new SkyAndLighting3D(scene, renderer, initQ);
    skyRigRef.current = skyRig;

    const fleet = new IndonesianFleet3D(scene, config.environmentId ?? config.customTopology?.id);
    fleetRef.current = fleet;

    const frictionHeatmap = new FrictionHeatmap3D(scene);
    frictionHeatmapRef.current = frictionHeatmap;

    const syncSize = () => {
      const box = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(box.width));
      const h = Math.max(1, Math.floor(box.height));
      const nextDpr = Math.min(window.devicePixelRatio || 1, qualityProfileRef.current.maxDpr);
      const prev = sizeRef.current;
      if (prev.width === w && prev.height === h && prev.dpr === nextDpr) return;

      sizeRef.current = { width: w, height: h, dpr: nextDpr };
      renderer.setPixelRatio(nextDpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      if (overlayCanvas) {
        overlayCanvas.width = Math.max(1, Math.floor(w * nextDpr));
        overlayCanvas.height = Math.max(1, Math.floor(h * nextDpr));
      }
      renderFrameNow(performance.now(), true);
    };

    const ro = new ResizeObserver(syncSize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (idleRafRef.current !== null) {
        cancelAnimationFrame(idleRafRef.current);
        idleRafRef.current = null;
      }
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      controlsRef.current = null;

      if (roadRef.current) {
        scene.remove(roadRef.current.group);
        roadRef.current.dispose();
        roadRef.current = null;
      }
      if (cityRef.current) {
        scene.remove(cityRef.current.group);
        cityRef.current.dispose();
        cityRef.current = null;
      }

      fleet.dispose();
      fleetRef.current = null;
      skyRig.dispose();
      skyRigRef.current = null;
      frictionHeatmap.dispose();
      frictionHeatmapRef.current = null;

      if (overlayCanvas) {
        overlayCanvas.width = 0;
        overlayCanvas.height = 0;
      }

      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [qualityProfile.antialias]); // Recreate WebGL context only if antialias capability changes

  // Apply runtime graphics quality changes without recreating WebGL context when antialias unchanged
  useEffect(() => {
    const renderer = rendererRef.current;
    const skyRig = skyRigRef.current;
    const container = containerRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const camera = cameraRef.current;
    if (!renderer || !skyRig || !container || !camera) return;

    const dpr = Math.min(window.devicePixelRatio || 1, qualityProfile.maxDpr);
    const box = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(box.width));
    const h = Math.max(1, Math.floor(box.height));
    sizeRef.current = { width: w, height: h, dpr };

    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = qualityProfile.staticShadows;
    renderer.shadowMap.autoUpdate = !qualityProfile.staticShadows;
    if (overlayCanvas) {
      overlayCanvas.width = Math.max(1, Math.floor(w * dpr));
      overlayCanvas.height = Math.max(1, Math.floor(h * dpr));
    }

    skyRig.setQuality(qualityProfile);
    skyRig.setShadowFrustum(extentMetersRef.current, qualityProfile);
    skyRig.requestShadowBake();
    renderFrameNow(performance.now(), true);
  }, [qualityProfile, renderFrameNow]);

  // Rebuild merged Road + City + Signals when geometry, topology, weather wetness, grid or quality changes
  const isWet = (config.environment?.weather ?? 'clear') !== 'clear';
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (roadRef.current) {
      scene.remove(roadRef.current.group);
      roadRef.current.dispose();
      roadRef.current = null;
    }
    if (cityRef.current) {
      scene.remove(cityRef.current.group);
      cityRef.current.dispose();
      cityRef.current = null;
    }

    const road = buildRoadWorld3D(config, compiledTopology, qualityProfile);
    roadRef.current = road;
    scene.add(road.group);

    const city = buildIndonesianCity3D(
      config,
      compiledTopology,
      road.sigPositions,
      showGrid,
      qualityProfile
    );
    cityRef.current = city;
    scene.add(city.group);

    fleetRef.current?.setEnvironmentId(config.environmentId ?? config.customTopology?.id);

    skyRigRef.current?.setShadowExtent(road.extentMeters);
    skyRigRef.current?.requestShadowBake();
    renderFrameNow(performance.now(), true);
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
    config.environmentId,
    config.scenarioName,
    config.customTopology,
    config.armNames?.north,
    config.armNames?.east,
    config.armNames?.south,
    config.armNames?.west,
    isWet,
    showGrid,
    qualityProfile,
    renderFrameNow,
  ]);

  // Reset camera cleanly when active map / topology changes
  const hasUserCameraMovedRef = useRef(false);
  useEffect(() => {
    hasUserCameraMovedRef.current = false;
    setHasUserCameraMoved(false);
    applyCameraPreset('iso', true);
  }, [config.environmentId, compiledTopology, applyCameraPreset]);

  // Auto-exit 'follow' if selected vehicle is cleared
  useEffect(() => {
    if (selectedVehicleId === null && cameraPresetRef.current === 'follow') {
      applyCameraPreset('iso', false);
    }
  }, [selectedVehicleId, applyCameraPreset]);

  // 60fps WebGL loop when running
  useEffect(() => {
    if (!running) return;
    let rafId = 0;
    const loop = (now: number) => {
      renderFrameNow(now, false);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [running, renderFrameNow]);

  // Render on-demand when paused and state/layers change
  useEffect(() => {
    if (!running) {
      renderFrameNow(performance.now(), true);
    }
  }, [running, drawTick, zoom, showGrid, resolvedLayers, focusedArchetype, selectedVehicleId, renderFrameNow]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY, active: true };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const down = pointerDownPosRef.current;
      if (!down.active) return;
      down.active = false;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 5) return;

      const canvas = webglCanvasRef.current;
      const camera = cameraRef.current;
      const fleet = fleetRef.current;
      if (!canvas || !camera || !fleet || !onSelectVehicle) return;

      const rect = canvas.getBoundingClientRect();
      ndcPointerRef.current.set(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      raycasterRef.current.setFromCamera(ndcPointerRef.current, camera);
      const hitId = fleet.pickVehicleByRay(
        raycasterRef.current.ray,
        snapshotRef.current.vehicles,
        focusedArchetypeRef.current
      );
      onSelectVehicle(hitId);
    },
    [onSelectVehicle, snapshotRef]
  );

  const handleResetView = useCallback(() => {
    hasUserCameraMovedRef.current = false;
    setHasUserCameraMoved(false);
    onZoomChange?.(1);
    applyCameraPreset('iso', false);
  }, [applyCameraPreset, onZoomChange]);

  const showResetView =
    hasUserCameraMoved || cameraPreset !== 'iso' || Math.abs(zoom - 1) > 0.02;
  const liveSnap = uiSnapshot ?? snapshotRef.current;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#DCE7F3] rounded-lg border border-slate-200 select-none"
    >
      {webglError ? (
        <div className="flex h-full w-full items-center justify-center p-6 text-center text-slate-700">
          <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-1.5">
            <div className="text-xs font-semibold text-rose-700">
              Gagal Menginisialisasi Tampilan 3D
            </div>
            <p className="text-[11px] text-slate-500">{webglError}</p>
          </div>
        </div>
      ) : (
        <>
          <canvas
            ref={webglCanvasRef}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            className="block w-full h-full touch-none cursor-grab active:cursor-grabbing"
            aria-label={
              config.scenarioName
                ? `Simulasi 3D simpang lalu lintas: ${config.scenarioName}`
                : 'Simulasi 3D simpang lalu lintas'
            }
          />
          <canvas
            ref={overlayCanvasRef}
            className="pointer-events-none absolute inset-0 block w-full h-full"
          />
        </>
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
        onResetView={handleResetView}
        is3D
        cameraPreset={cameraPreset}
        onSelectCameraPreset={(p) => applyCameraPreset(p, false)}
      />
    </div>
  );
});
