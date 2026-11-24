import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ARCHETYPE_TRAITS,
  MAP_OVERLAY_PRESETS,
} from '../engine/driverIntelligence';
import { getEffectiveRoadWidth } from '../engine/geometry';
import { CompiledTopology } from '../engine/topologyTypes';
import {
  DriverArchetype,
  FrictionHeatmapSnapshot,
  MapOverlayLayers,
  SignalColor,
  SimConfig,
  SimSnapshot,
  Vehicle,
} from '../engine/types';
import { getLoadedAsset, onAssetsLoaded, preloadSimulationAssets } from './assetLoader';
import { drawStaticRoadLayer } from './drawStaticRoad';
import { ARCHETYPE_COLORS, MapHudOverlay } from './MapHudOverlay';
import {
  CanvasViewport,
  computeViewport,
  screenToWorld,
  worldToScreen,
  zoomAroundScreenPoint,
} from './viewport';

export interface IntersectionCanvasProps {
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
  /** Optional legacy toggle retained for backward compatibility (overlayLayers takes priority). */
  showDriverOverlay?: boolean;
}

const ARCHETYPE_CAPSULE_FILL: Record<DriverArchetype, string> = {
  defensive: 'rgba(16, 185, 129, 0.30)',
  commuter: 'rgba(14, 165, 233, 0.30)',
  hurried: 'rgba(244, 63, 94, 0.32)',
  courier: 'rgba(245, 158, 11, 0.32)',
  transit: 'rgba(99, 102, 241, 0.32)',
  logistics: 'rgba(71, 85, 105, 0.34)',
};

const ARCHETYPE_CAPSULE_STROKE: Record<DriverArchetype, string> = {
  defensive: 'rgba(16, 185, 129, 0.72)',
  commuter: 'rgba(14, 165, 233, 0.72)',
  hurried: 'rgba(244, 63, 94, 0.78)',
  courier: 'rgba(245, 158, 11, 0.78)',
  transit: 'rgba(99, 102, 241, 0.76)',
  logistics: 'rgba(100, 116, 139, 0.78)',
};

const HEATMAP_OUTER_COLORS = [
  'rgba(251, 191, 36, 0.12)',
  'rgba(245, 158, 11, 0.16)',
  'rgba(249, 115, 22, 0.20)',
  'rgba(244, 63, 94, 0.24)',
  'rgba(225, 29, 72, 0.28)',
] as const;

const HEATMAP_INNER_COLORS = [
  'rgba(251, 191, 36, 0.22)',
  'rgba(245, 158, 11, 0.28)',
  'rgba(249, 115, 22, 0.34)',
  'rgba(244, 63, 94, 0.40)',
  'rgba(225, 29, 72, 0.46)',
] as const;

const SIGNAL_COLORS: Record<SignalColor, string> = {
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
};

const SIGNAL_IMG: Record<SignalColor, string> = {
  green: '/assets/infra/signal-green.svg',
  yellow: '/assets/infra/signal-yellow.svg',
  red: '/assets/infra/signal-red.svg',
};

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.8;

function clampPan(
  panX: number,
  panY: number,
  width: number,
  height: number,
  zoom: number
): { x: number; y: number } {
  const maxX = Math.max(120, width * 0.85 * Math.max(1, zoom));
  const maxY = Math.max(120, height * 0.85 * Math.max(1, zoom));
  return {
    x: Math.max(-maxX, Math.min(maxX, panX)),
    y: Math.max(-maxY, Math.min(maxY, panY)),
  };
}

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = React.memo(({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600, dpr: 1 });
  const [assetVer, setAssetVer] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const vehicleMapRef = useRef<Map<number, Vehicle>>(new Map());
  const pillPosBufRef = useRef<Float32Array>(new Float32Array(512));
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const panRafRef = useRef<number | null>(null);

  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    moved: false,
  });

  const resolvedLayers = useMemo<MapOverlayLayers>(() => {
    if (overlayLayers) return overlayLayers;
    if (showDriverOverlay) return MAP_OVERLAY_PRESETS.compact;
    return MAP_OVERLAY_PRESETS.off;
  }, [overlayLayers, showDriverOverlay]);

  useEffect(() => {
    preloadSimulationAssets();
    return onAssetsLoaded(() => setAssetVer((v) => v + 1));
  }, []);

  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (staticCanvasRef.current) {
        staticCanvasRef.current.width = 0;
        staticCanvasRef.current.height = 0;
        staticCanvasRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      setSize((prev) =>
        prev.width === w && prev.height === h && prev.dpr === dpr
          ? prev
          : { width: w, height: h, dpr }
      );
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let mqCleanup: (() => void) | undefined;
    const watchDpr = () => {
      mqCleanup?.();
      if (typeof window.matchMedia !== 'function') return;
      const dpr = window.devicePixelRatio || 1;
      const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
      const onChange = () => {
        resize();
        watchDpr();
      };
      mq.addEventListener('change', onChange, { once: true });
      mqCleanup = () => mq.removeEventListener('change', onChange);
    };
    watchDpr();

    return () => {
      ro.disconnect();
      mqCleanup?.();
    };
  }, []);

  const halfRoad = getEffectiveRoadWidth(config);
  const halfBox = halfRoad + 2.0;
  const isCustomTopo = Boolean(config.customTopology);
  const totalExtent = isCustomTopo
    ? compiledTopology.maxExtentMeters * 2
    : (halfBox + config.roadLength) * 2;
  const totalExtentRef = useRef(totalExtent);
  totalExtentRef.current = totalExtent;

  // Auto-reset pan when active map / topology changes
  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  }, [config.environmentId, compiledTopology]);

  // Non-passive cursor-anchored wheel zoom (Ide #4)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      if (!onZoomChange) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const curSize = sizeRef.current;
      const ext = totalExtentRef.current;

      const factor = Math.max(0.84, Math.min(1.18, Math.exp(-e.deltaY * 0.0014)));
      const clampedNext = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(curZoom * factor).toFixed(2)));
      if (Math.abs(clampedNext - curZoom) < 1e-4) return;

      const vp = computeViewport(curSize.width, curSize.height, ext, curZoom, curPan.x, curPan.y);
      const next = zoomAroundScreenPoint(vp, ext, clampedNext, cursorX, cursorY);
      const bounded = clampPan(next.panX, next.panY, curSize.width, curSize.height, next.zoom);
      zoomRef.current = next.zoom;
      panRef.current = bounded;
      setPan(bounded);
      onZoomChange(next.zoom);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [onZoomChange]);

  const schedulePanUpdate = useCallback((nextPan: { x: number; y: number }) => {
    panRef.current = nextPan;
    pendingPanRef.current = nextPan;
    if (panRafRef.current === null) {
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null;
        if (pendingPanRef.current) {
          const p = pendingPanRef.current;
          pendingPanRef.current = null;
          setPan(p);
        }
      });
    }
  }, []);

  const handleResetView = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
    onZoomChange?.(1);
  }, [onZoomChange]);

  const hitTestVehicle = useCallback(
    (screenX: number, screenY: number): number | null => {
      const curSize = sizeRef.current;
      const curPan = panRef.current;
      const vp = computeViewport(
        curSize.width,
        curSize.height,
        totalExtentRef.current,
        zoomRef.current,
        curPan.x,
        curPan.y
      );
      const wPt = screenToWorld(vp, screenX, screenY);
      const vehicles = snapshotRef.current.vehicles;
      const pad = 0.5;

      let bestId: number | null = null;
      let bestScore = Infinity;

      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        const dx = wPt.x - v.x;
        const dy = wPt.y - v.y;
        const cosH = Math.cos(v.heading);
        const sinH = Math.sin(v.heading);
        const along = dx * cosH + dy * sinH;
        const across = -dx * sinH + dy * cosH;

        if (Math.abs(along) <= v.length * 0.5 + pad && Math.abs(across) <= v.width * 0.5 + pad) {
          let score = dx * dx + dy * dy;
          if (focusedArchetype && v.archetype !== focusedArchetype) {
            score += 9.0; // Prioritize focused archetype when overlapping
          }
          if (score < bestScore) {
            bestScore = score;
            bestId = v.id;
          }
        }
      }
      return bestId;
    },
    [snapshotRef, focusedArchetype]
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const drag = dragRef.current;
    drag.active = true;
    drag.pointerId = e.pointerId;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.startPanX = panRef.current.x;
    drag.startPanY = panRef.current.y;
    drag.moved = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events without pointer capture
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) >= 5) {
        drag.moved = true;
        setIsDragging(true);
      }
      if (drag.moved) {
        const curSize = sizeRef.current;
        const bounded = clampPan(
          drag.startPanX + dx,
          drag.startPanY + dy,
          curSize.width,
          curSize.height,
          zoomRef.current
        );
        schedulePanUpdate(bounded);
      }
    },
    [schedulePanUpdate]
  );

  const finishPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>, isCancel: boolean) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== e.pointerId) return;
      const wasDrag = drag.moved;
      drag.active = false;
      drag.pointerId = -1;
      drag.moved = false;
      setIsDragging(false);
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }

      if (!isCancel && !wasDrag && onSelectVehicle) {
        const rect = e.currentTarget.getBoundingClientRect();
        const hitId = hitTestVehicle(e.clientX - rect.left, e.clientY - rect.top);
        onSelectVehicle(hitId);
      }
    },
    [hitTestVehicle, onSelectVehicle]
  );

  const sigPositions = useMemo<{ armId: string; x: number; y: number; outY: number }[]>(() => {
    if (isCustomTopo) {
      return compiledTopology.armOrder.map((armId) => {
        const arm = compiledTopology.armsById[armId];
        return { armId, x: arm.signalPos.x, y: arm.signalPos.y, outY: arm.outDir.y };
      });
    }
    return [
      { armId: 'north', x: halfRoad + 2.7, y: -halfBox - 2.7, outY: -1 },
      { armId: 'south', x: -halfRoad - 2.7, y: halfBox + 2.7, outY: 1 },
      { armId: 'west', x: -halfBox - 2.7, y: -halfRoad - 2.7, outY: -1 },
      { armId: 'east', x: halfBox + 2.7, y: halfRoad + 2.7, outY: 1 },
    ];
  }, [isCustomTopo, compiledTopology, halfRoad, halfBox]);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const pixelW = Math.floor(size.width * size.dpr);
    const pixelH = Math.floor(size.height * size.dpr);

    const canvas = canvasRef.current;
    if (canvas) {
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }

    if (!staticCanvasRef.current) staticCanvasRef.current = document.createElement('canvas');
    const off = staticCanvasRef.current;
    if (off.width !== pixelW || off.height !== pixelH) {
      off.width = pixelW;
      off.height = pixelH;
    }
    const ctx = off.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, pixelW, pixelH);
      drawStaticRoadLayer(
        ctx,
        size.width,
        size.height,
        size.dpr,
        zoom,
        showGrid,
        halfRoad,
        halfBox,
        config,
        compiledTopology,
        pan.x,
        pan.y
      );
    }
    drawFrameRef.current();
  }, [
    size,
    zoom,
    pan.x,
    pan.y,
    showGrid,
    halfRoad,
    halfBox,
    assetVer,
    compiledTopology,
    config.lanesPerDirection,
    config.laneWidth,
    config.roadLength,
    config.roadWidthPerDirection,
    config.motorBoxEnabled,
    config.hasMedian,
    config.leftTurnOnRed,
    config.yellowBoxEnabled,
    config.environment?.weather,
    config.environmentId,
    config.scenarioName,
    config.armNames?.north,
    config.armNames?.east,
    config.armNames?.south,
    config.armNames?.west,
    config.customTopology,
  ]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = size;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (staticCanvasRef.current) {
      ctx.drawImage(staticCanvasRef.current, 0, 0);
    }
    ctx.scale(dpr, dpr);

    const vp = computeViewport(width, height, totalExtent, zoom, pan.x, pan.y);
    const { cx, cy, pxPerMeter } = vp;

    const snap = snapshotRef.current;
    const { signal, vehicles, stats } = snap;
    const simTime = stats.simTime;
    const blinkOn = Math.floor(simTime * 2.5) % 2 === 0;
    const pulseWave = 0.5 + 0.5 * Math.sin(simTime * 6.0);
    const env = stats.environment;
    const headlightsOn = (env?.ambientDarkness ?? 0) > 0.1 || (env?.rainIntensity ?? 0) > 0.5;

    // Populate zero-GC vehicle lookup map only when social vectors or inspector vectors need it
    const needMap = resolvedLayers.socialVectors || selectedVehicleId !== null;
    const vMap = vehicleMapRef.current;
    if (needMap) {
      vMap.clear();
      for (let i = 0; i < vehicles.length; i++) {
        vMap.set(vehicles[i].id, vehicles[i]);
      }
    }

    // ================= WORLD SPACE PASS =================
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxPerMeter, pxPerMeter);

    // 1. Ide #14: Geospatial Driver Friction Heatmap (on road layer, below vehicles)
    if (resolvedLayers.frictionHeatmap && snap.frictionGrid) {
      drawFrictionHeatmap(ctx, snap.frictionGrid, focusedArchetype);
    }

    // 2. Vehicles + Under-Chassis Accent + Lights/Blinkers + Tactical Cues + Salient Emotion Bars
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const isSelected = selectedVehicleId !== null && v.id === selectedVehicleId;
      const dimmed =
        focusedArchetype !== null && v.archetype !== focusedArchetype && !isSelected;
      drawVehicle(
        ctx,
        v,
        blinkOn,
        headlightsOn,
        pulseWave,
        resolvedLayers,
        dimmed
      );
    }

    // 3. Ide #9, #10, #11: Pairwise Social Interaction Vectors Layer
    if (resolvedLayers.socialVectors) {
      drawSocialInteractionVectors(ctx, vehicles, vMap, pulseWave, focusedArchetype, selectedVehicleId);
    }

    // 4. Ide #12: Selected Vehicle Target Reticle & Live Target Relation Vectors
    if (selectedVehicleId !== null) {
      const sel = vMap.get(selectedVehicleId);
      if (sel) {
        drawSelectedVehicleReticleAndLinks(ctx, sel, vMap, pulseWave);
      }
    }

    // 5. Traffic Signals (all arms + optional Protected Right-Turn arrows)
    const armColors: Record<string, SignalColor> = signal.multiPhase?.armColors ?? signal.armLights;
    const arrowColors: Record<string, SignalColor | undefined> =
      signal.multiPhase?.armRightArrowColors ?? {};

    for (let i = 0; i < sigPositions.length; i++) {
      const sp = sigPositions[i];
      const color: SignalColor = armColors[sp.armId] ?? 'red';
      const rightArrowColor = arrowColors[sp.armId];
      const img = getLoadedAsset(SIGNAL_IMG[color]);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.roundRect(sp.x - 1.6, sp.y - 3.0, rightArrowColor ? 5.2 : 3.2, 6.0, 0.6);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = `${SIGNAL_COLORS[color]}26`;
      ctx.fill();

      if (img) {
        ctx.drawImage(img, sp.x - 1.15, sp.y - 2.5, 2.3, 5.0);
      } else {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 1.0, 0, Math.PI * 2);
        ctx.fillStyle = SIGNAL_COLORS[color];
        ctx.fill();
      }

      if (rightArrowColor) {
        const ax = sp.x + 2.4;
        ctx.beginPath();
        ctx.arc(ax, sp.y, 0.95, 0, Math.PI * 2);
        ctx.fillStyle = SIGNAL_COLORS[rightArrowColor];
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 1.05px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('↱', ax, sp.y + 0.05);
      }
    }
    ctx.restore();

    // ================= SCREEN SPACE PASS =================

    // Subtle dusk/night/storm ambient tint
    if (env && env.ambientDarkness > 0.01) {
      ctx.fillStyle = `rgba(15, 23, 42, ${env.ambientDarkness.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Lightweight deterministic rain streak overlay (zero allocations, 60 FPS safe)
    if (env && env.rainIntensity > 0.05) {
      const dropCount = Math.round(env.rainIntensity * 95);
      ctx.save();
      ctx.strokeStyle = `rgba(226, 232, 240, ${(0.22 + env.rainIntensity * 0.26).toFixed(2)})`;
      ctx.lineWidth = env.rainIntensity > 0.6 ? 1.25 : 0.9;
      ctx.beginPath();
      const tShift = simTime * (340 + env.rainIntensity * 220);
      for (let i = 0; i < dropCount; i++) {
        const sx = ((i * 97.3 + tShift * 0.22) % (width + 40)) - 20;
        const sy = ((i * 53.7 + tShift) % (height + 40)) - 20;
        const len = 8 + env.rainIntensity * 12;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - len * 0.24, sy + len);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Ide #2: Zoom-Adaptive Screen-Space Archetype Micro-Pills (replaces illegible 0.9px world text)
    if (resolvedLayers.identity) {
      drawScreenSpaceArchetypePills(
        ctx,
        vp,
        vehicles,
        focusedArchetype,
        selectedVehicleId,
        pillPosBufRef.current
      );
    }

    // Countdown pills on all currently-green/yellow arms
    const activeArmIds = sigPositions.filter((sp) => {
      const c = armColors[sp.armId] ?? 'red';
      const rc = arrowColors[sp.armId];
      return c !== 'red' || (rc !== undefined && rc !== 'red');
    });
    const badgeTargets =
      activeArmIds.length > 0
        ? activeArmIds
        : sigPositions.filter((sp) => sp.armId === signal.activeArm).slice(0, 1);

    for (let i = 0; i < badgeTargets.length; i++) {
      const activeSig = badgeTargets[i];
      const sx = cx + activeSig.x * pxPerMeter;
      const sy =
        activeSig.outY < 0
          ? cy + activeSig.y * pxPerMeter - Math.max(18, 4.0 * pxPerMeter)
          : cy + activeSig.y * pxPerMeter + Math.max(16, 3.8 * pxPerMeter);
      const label = `${Math.ceil(Math.max(0, signal.phaseRemaining))}s`;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = SIGNAL_COLORS[signal.activeColor];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(sx - tw / 2, sy - 8, tw, 17, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx, sy + 0.5);
    }

    const compassImg = getLoadedAsset('/assets/infra/compass-north.svg');
    if (compassImg) {
      ctx.drawImage(compassImg, width - 58, 14, 44, 44);
    } else {
      drawVectorCompassFallback(ctx, width - 36, 36);
    }

    const scaleMeters = [10, 5, 2, 1, 20, 50].find((m) => {
      const px = m * pxPerMeter;
      return px > 18 && px < 200;
    });
    if (scaleMeters !== undefined) {
      const barPx = scaleMeters * pxPerMeter;
      const bx = 16;
      const by = height - 18;
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + barPx, by);
      ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = '#0F172A';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${scaleMeters} m · LHT (ID)`, bx, by - 7);
    }
    ctx.restore();
  }, [
    size,
    zoom,
    pan.x,
    pan.y,
    totalExtent,
    sigPositions,
    snapshotRef,
    resolvedLayers,
    focusedArchetype,
    selectedVehicleId,
  ]);

  const drawFrameRef = useRef(drawFrame);
  drawFrameRef.current = drawFrame;

  useEffect(() => {
    if (!running) return;

    let rafId = 0;
    const tick = () => {
      drawFrameRef.current();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [running]);

  useEffect(() => {
    if (!running) {
      drawFrameRef.current();
    }
  }, [
    running,
    drawTick,
    zoom,
    pan.x,
    pan.y,
    showGrid,
    resolvedLayers,
    focusedArchetype,
    selectedVehicleId,
    size,
    assetVer,
    config,
    compiledTopology,
    drawFrame,
  ]);

  const isViewTransformed =
    Math.abs(pan.x) > 1 || Math.abs(pan.y) > 1 || Math.abs(zoom - 1) > 0.02;

  const liveSnap = uiSnapshot ?? snapshotRef.current;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#EDF2E7] rounded-lg border border-slate-200 select-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointer(e, false)}
        onPointerCancel={(e) => finishPointer(e, true)}
        className={`block w-full h-full touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="img"
        aria-label={
          config.scenarioName
            ? `Traffic intersection simulation: ${config.scenarioName}`
            : 'Traffic intersection simulation canvas'
        }
      />

      <MapHudOverlay
        config={config}
        compiledTopology={compiledTopology}
        liveSnap={liveSnap}
        resolvedLayers={resolvedLayers}
        focusedArchetype={focusedArchetype}
        onSelectArchetype={onSelectArchetype}
        selectedVehicleId={selectedVehicleId}
        onSelectVehicle={onSelectVehicle}
        showResetView={isViewTransformed}
        resetViewLabel={`${Math.round(zoom * 100)}%`}
        onResetView={handleResetView}
      />
    </div>
  );
});

function drawVectorCompassFallback(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy - 13);
  ctx.lineTo(cx - 4.5, cy - 5);
  ctx.lineTo(cx + 4.5, cy - 5);
  ctx.closePath();
  ctx.fillStyle = '#EF4444';
  ctx.fill();

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy + 5);
  ctx.restore();
}

/**
 * Ide #14: Zero-GC, zero-shadowBlur Geospatial Driver Friction Heatmap.
 */
function drawFrictionHeatmap(
  ctx: CanvasRenderingContext2D,
  grid: FrictionHeatmapSnapshot,
  focusedArchetype: DriverArchetype | null
): void {
  const cells = focusedArchetype ? grid.byArchetype[focusedArchetype] : grid.total;
  if (!cells || cells.length === 0) return;

  const n = grid.gridSize;
  const extent = grid.extentMeters;
  const cellSize = (2 * extent) / n;

  let peak = focusedArchetype ? 0.8 : Math.max(1.2, grid.maxVal);
  if (focusedArchetype) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] > peak) peak = cells[i];
    }
  }

  const outerR = cellSize * 0.92;
  const innerR = cellSize * 0.52;

  for (let gy = 0; gy < n; gy++) {
    const rowOff = gy * n;
    const wy = -extent + (gy + 0.5) * cellSize;
    for (let gx = 0; gx < n; gx++) {
      const val = cells[rowOff + gx];
      if (val < 0.06) continue;
      const norm = Math.min(1, val / peak);
      const bucket = Math.min(4, Math.floor(norm * 4.99));
      const wx = -extent + (gx + 0.5) * cellSize;

      ctx.fillStyle = HEATMAP_OUTER_COLORS[bucket];
      ctx.beginPath();
      ctx.arc(wx, wy, outerR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = HEATMAP_INNER_COLORS[bucket];
      ctx.beginPath();
      ctx.arc(wx, wy, innerR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Ide #1, #3, #4, #5–#8: Draws a single vehicle with under-chassis archetype capsule,
 * front+rear blinkers, hard-brake bloom, event-driven tactical cues, and salient emotion/caution bars.
 * Strictly zero ctx.shadowBlur for locked 60 FPS on 100+ vehicles.
 */
function drawVehicle(
  ctx: CanvasRenderingContext2D,
  v: Vehicle,
  blinkOn: boolean,
  headlightsOn: boolean,
  pulseWave: number,
  layers: MapOverlayLayers,
  dimmed: boolean
): void {
  ctx.save();
  if (dimmed) {
    ctx.globalAlpha = 0.22;
  }
  ctx.translate(v.x, v.y);
  ctx.rotate(v.heading + Math.PI / 2);

  const halfW = v.width * 0.5;
  const halfL = v.length * 0.5;

  // 1. Subtle headlight cones during rain or dusk/night
  if (headlightsOn) {
    ctx.fillStyle = 'rgba(254, 249, 195, 0.22)';
    ctx.beginPath();
    ctx.moveTo(-v.width * 0.3, -halfL * 0.96);
    ctx.lineTo(-v.width * 0.85, -halfL * 0.96 - 4.5);
    ctx.lineTo(v.width * 0.85, -halfL * 0.96 - 4.5);
    ctx.lineTo(v.width * 0.3, -halfL * 0.96);
    ctx.closePath();
    ctx.fill();
  }

  // 2. Ide #6 (part): Occlusion Peek forward sight-cone (drawn below chassis)
  if (layers.tacticalCues && v.occlusionPeekActive) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, -halfL);
    ctx.lineTo(-1.85, -halfL - 4.5);
    ctx.lineTo(1.85, -halfL - 4.5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.62)';
    ctx.lineWidth = 0.11;
    ctx.setLineDash([0.38, 0.28]);
    ctx.beginPath();
    ctx.moveTo(-0.2, -halfL);
    ctx.lineTo(-1.85, -halfL - 4.5);
    ctx.moveTo(0.2, -halfL);
    ctx.lineTo(1.85, -halfL - 4.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 3. Ide #7: Heavy Wide-Swing Swept Rear-Corner Arc (BUS / TRK)
  if (
    layers.tacticalCues &&
    v.vClass === 'heavy' &&
    (v.wideSwingState === 'pre_swing' || v.wideSwingState === 'turning')
  ) {
    const swingSide = v.turn === 'left' ? 1 : -1; // outer rear corner opposite turn apex
    const isPre = v.wideSwingState === 'pre_swing';
    ctx.fillStyle = isPre ? 'rgba(245, 158, 11, 0.13)' : 'rgba(100, 116, 139, 0.15)';
    ctx.beginPath();
    ctx.moveTo(swingSide * halfW, halfL * 0.1);
    ctx.quadraticCurveTo(
      swingSide * (halfW + 1.35),
      halfL * 0.55,
      swingSide * (halfW + 0.95),
      halfL + 0.85
    );
    ctx.lineTo(swingSide * (halfW * 0.35), halfL);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = isPre ? 'rgba(245, 158, 11, 0.88)' : 'rgba(148, 163, 184, 0.90)';
    ctx.lineWidth = 0.16;
    ctx.setLineDash([0.55, 0.35]);
    ctx.beginPath();
    ctx.moveTo(swingSide * (halfW + 0.08), halfL * 0.12);
    ctx.quadraticCurveTo(
      swingSide * (halfW + 1.35),
      halfL * 0.55,
      swingSide * (halfW + 0.95),
      halfL + 0.85
    );
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 4. Ide #1: Under-Chassis Archetype Ground Accent Capsule + Rear Directional Pip (NO boxy strokeRect!)
  if (layers.identity && v.archetype) {
    const padX = v.vClass === 'motor' ? 0.17 : 0.22;
    const padY = v.vClass === 'motor' ? 0.18 : 0.22;
    const capW = v.width + padX * 2;
    const capH = v.length + padY * 2;
    const capR = Math.min(capW * 0.46, 0.56);

    ctx.fillStyle = ARCHETYPE_CAPSULE_FILL[v.archetype] ?? 'rgba(100, 116, 139, 0.28)';
    ctx.strokeStyle = ARCHETYPE_CAPSULE_STROKE[v.archetype] ?? 'rgba(100, 116, 139, 0.65)';
    ctx.lineWidth = 0.11;
    ctx.beginPath();
    ctx.roundRect(-capW * 0.5, -capH * 0.5, capW, capH, capR);
    ctx.fill();
    ctx.stroke();

    // Tiny rear directional pip at rear capsule apex
    const pipR = v.vClass === 'motor' ? 0.13 : 0.17;
    ctx.fillStyle = ARCHETYPE_COLORS[v.archetype] ?? '#64748B';
    ctx.beginPath();
    ctx.arc(0, halfL + padY, pipR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Ide #8 (part): Subtle dashed amber flank underline when crossing lane/centerline marking
  if (layers.tacticalCues && v.crossingMarking) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.88)';
    ctx.lineWidth = 0.15;
    ctx.setLineDash([0.38, 0.28]);
    ctx.beginPath();
    ctx.moveTo(-halfW - 0.16, -halfL * 0.78);
    ctx.lineTo(-halfW - 0.16, halfL * 0.78);
    ctx.moveTo(halfW + 0.16, -halfL * 0.78);
    ctx.lineTo(halfW + 0.16, halfL * 0.78);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 6. Vehicle Sprite
  const img = getLoadedAsset(v.spriteKey);
  if (img) {
    ctx.drawImage(img, -halfW, -halfL, v.width, v.length);
  } else {
    ctx.fillStyle =
      v.vClass === 'motor' ? '#F59E0B' : v.vClass === 'heavy' ? '#475569' : '#1E293B';
    ctx.fillRect(-halfW, -halfL, v.width, v.length);
  }

  // 7. Ide #1: Reverse Lights, Hard-Brake Bloom vs Ordinary Idle Stop Bars
  if (v.isReversing) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    if (v.vClass === 'motor') {
      ctx.fillRect(-0.09, v.length * 0.4, 0.18, 0.13);
    } else {
      const rw = Math.max(0.16, v.width * 0.16);
      const rh = Math.max(0.12, v.length * 0.045);
      ctx.fillRect(-v.width * 0.3, v.length * 0.42, rw, rh);
      ctx.fillRect(v.width * 0.3 - rw, v.length * 0.42, rw, rh);
    }
  } else if (v.brakingHard) {
    // Translucent crimson rear bloom polygon (zero shadowBlur!)
    const bloomLen = v.vClass === 'motor' ? 0.95 : 1.55;
    ctx.fillStyle = 'rgba(244, 63, 94, 0.26)';
    ctx.beginPath();
    ctx.moveTo(-v.width * 0.42, halfL * 0.94);
    ctx.lineTo(-v.width * 0.72, halfL + bloomLen);
    ctx.lineTo(v.width * 0.72, halfL + bloomLen);
    ctx.lineTo(v.width * 0.42, halfL * 0.94);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(239, 68, 68, 0.42)';
    ctx.beginPath();
    ctx.moveTo(-v.width * 0.34, halfL * 0.94);
    ctx.lineTo(-v.width * 0.5, halfL + bloomLen * 0.55);
    ctx.lineTo(v.width * 0.5, halfL + bloomLen * 0.55);
    ctx.lineTo(v.width * 0.34, halfL * 0.94);
    ctx.closePath();
    ctx.fill();

    // Brighter crimson twin brake bars
    ctx.fillStyle = '#FF1E42';
    if (v.vClass === 'motor') {
      ctx.fillRect(-0.14, v.length * 0.39, 0.28, 0.16);
    } else {
      const bw = Math.max(0.22, v.width * 0.22);
      const bh = Math.max(0.15, v.length * 0.055);
      ctx.fillRect(-v.width * 0.38, v.length * 0.41, bw, bh);
      ctx.fillRect(v.width * 0.38 - bw, v.length * 0.41, bw, bh);
    }
  } else if (v.speed < 0.8) {
    // Compact muted red brake bars for ordinary idle stop
    ctx.fillStyle = 'rgba(220, 38, 38, 0.72)';
    if (v.vClass === 'motor') {
      ctx.fillRect(-0.09, v.length * 0.41, 0.18, 0.11);
    } else {
      const bw = Math.max(0.15, v.width * 0.15);
      const bh = Math.max(0.1, v.length * 0.036);
      ctx.fillRect(-v.width * 0.32, v.length * 0.42, bw, bh);
      ctx.fillRect(v.width * 0.32 - bw, v.length * 0.42, bw, bh);
    }
  }

  // 8. Ide #1: Front AND Rear Turn-Signal Blinkers + Synchronized Dual Hazard Flash
  const isHazard = Boolean(v.isReversing || v.overtakeState === 'abort');
  const rawTurnDir =
    v.turn === 'uturn'
      ? 'right'
      : v.turn !== 'straight' && v.distanceAlongPath < v.exitLineDist
        ? v.turn
        : null;
  const signalDir = v.turnSignal ?? v.laneChangeDir ?? v.pendingLaneChangeDir ?? rawTurnDir;

  if (blinkOn && (isHazard || signalDir)) {
    ctx.fillStyle = '#F59E0B';
    const r =
      v.vClass === 'motor'
        ? Math.max(0.06, v.width * 0.08)
        : Math.min(0.14, v.width * 0.08);
    const xOff = v.width * (v.vClass === 'motor' ? 0.3 : 0.37);
    const yFront = -v.length * (v.vClass === 'motor' ? 0.37 : 0.43);
    const yRear = v.length * (v.vClass === 'motor' ? 0.37 : 0.43);

    if (isHazard) {
      ctx.beginPath();
      ctx.arc(-xOff, yFront, r, 0, Math.PI * 2);
      ctx.arc(xOff, yFront, r, 0, Math.PI * 2);
      ctx.arc(-xOff, yRear, r, 0, Math.PI * 2);
      ctx.arc(xOff, yRear, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (signalDir) {
      const sx = (signalDir === 'left' ? -1 : 1) * xOff;
      ctx.beginPath();
      ctx.arc(sx, yFront, r, 0, Math.PI * 2);
      ctx.arc(sx, yRear, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 9. Ide #5, #6, #8: Event-Driven Forward Tactical Cues
  if (layers.tacticalCues) {
    // 9a. Overtake / Lane-Change Intent Arc
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

      const startY = -halfL - 0.1;
      const endX = dirSign * (v.width * 0.85 + 0.95);
      const endY = startY - 2.6;
      const ctrlX = dirSign * 0.25;
      const ctrlY = startY - 1.55;

      ctx.strokeStyle = isAbort ? 'rgba(244, 63, 94, 0.95)' : 'rgba(14, 165, 233, 0.90)';
      ctx.lineWidth = 0.18;
      ctx.setLineDash([0.45, 0.28]);
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead tip
      const ang = Math.atan2(endY - ctrlY, endX - ctrlX);
      const headLen = 0.48;
      ctx.fillStyle = isAbort ? '#F43F5E' : '#0EA5E9';
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - headLen * Math.cos(ang - 0.55), endY - headLen * Math.sin(ang - 0.55));
      ctx.lineTo(endX - headLen * Math.cos(ang + 0.55), endY - headLen * Math.sin(ang + 0.55));
      ctx.closePath();
      ctx.fill();

      // Crisp '!' micro-indicator on abort
      if (isAbort) {
        const bx = -dirSign * (halfW + 0.45);
        const by = -halfL - 0.45;
        ctx.fillStyle = '#F43F5E';
        ctx.beginPath();
        ctx.arc(bx, by, 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(bx - 0.07, by - 0.26, 0.14, 0.30);
        ctx.fillRect(bx - 0.07, by + 0.11, 0.14, 0.13);
      }
    }

    // 9b. Yield Chevron (give-way chevron in front of nose bumper)
    if (v.isYielding) {
      const cy = -halfL - 0.62;
      const cw = Math.min(0.85, Math.max(0.45, v.width * 0.42));
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.88)';
      ctx.lineWidth = 0.18;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-cw, cy - 0.28);
      ctx.lineTo(0, cy + 0.25);
      ctx.lineTo(cw, cy - 0.28);
      ctx.stroke();
    }

    // 9c. Yellow Box Hold Bar (compact amber-black stop bar ticks ahead of bumper)
    if (v.holdingYellowBox) {
      const barY = -halfL - 0.46;
      const barW = v.width + 0.45;
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(-barW * 0.5, barY - 0.14, barW, 0.28);
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      for (let tx = -barW * 0.5 + 0.22; tx < barW * 0.5 - 0.1; tx += 0.42) {
        ctx.moveTo(tx, barY + 0.14);
        ctx.lineTo(tx + 0.2, barY - 0.14);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.lineWidth = 0.07;
      ctx.strokeRect(-barW * 0.5, barY - 0.14, barW, 0.28);
    }

    // 9d. V2V / CAV Radar (2 thin concentric cyan arcs ahead of bumper)
    if (v.isConnected) {
      const noseY = -halfL + 0.1;
      const r1 = halfW + 0.58;
      const r2 = halfW + 1.12;
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.76)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(0, noseY, r1, -Math.PI * 0.72, -Math.PI * 0.28);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.44)';
      ctx.lineWidth = 0.10;
      ctx.beginPath();
      ctx.arc(0, noseY, r2, -Math.PI * 0.69, -Math.PI * 0.31);
      ctx.stroke();
    }

    // 9e. RHK Cross-Yellow Anticipation (small bright emerald/amber launch chevron ahead of front-row motor)
    if (v.rhkAnticipating) {
      const ly = -halfL - 0.52 - pulseWave * 0.15;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(-0.34, ly + 0.24);
      ctx.lineTo(0, ly - 0.14);
      ctx.lineTo(0.34, ly + 0.24);
      ctx.stroke();

      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 0.13;
      ctx.beginPath();
      ctx.moveTo(-0.26, ly - 0.04);
      ctx.lineTo(0, ly - 0.36);
      ctx.lineTo(0.26, ly - 0.04);
      ctx.stroke();
    }

    // 9f. Reversing directional rear chevron
    if (v.isReversing) {
      const ry = halfL + 0.55;
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.90)';
      ctx.lineWidth = 0.18;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.42, ry - 0.22);
      ctx.lineTo(0, ry + 0.22);
      ctx.lineTo(0.42, ry - 0.22);
      ctx.stroke();
    }
  }

  // 10. Ide #3: Salient-Only Emotion (>= 0.48) & Post-Incident Caution Recovery (> 0.2s)
  if (layers.emotionBars) {
    const frust = v.frustration ?? 0;
    const caution = v.cautionTimer ?? 0;
    const barW = Math.max(1.25, v.width + 0.24);
    let nextBarY = halfL + 0.36;

    if (frust >= 0.48) {
      const clamped = Math.min(1, frust);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.beginPath();
      ctx.roundRect(-barW * 0.5, nextBarY, barW, 0.24, 0.1);
      ctx.fill();

      ctx.fillStyle = clamped >= 0.82 ? '#F43F5E' : clamped >= 0.65 ? '#F97316' : '#F59E0B';
      ctx.beginPath();
      ctx.roundRect(-barW * 0.5, nextBarY, barW * clamped, 0.24, 0.1);
      ctx.fill();
      nextBarY += 0.3;
    }

    if (caution > 0.2) {
      const cRatio = Math.min(1, caution / 6.0);
      const pulseAlpha = 0.45 + 0.35 * pulseWave;

      // Calming recovery bar
      ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
      ctx.beginPath();
      ctx.roundRect(-barW * 0.5, nextBarY, barW, 0.2, 0.08);
      ctx.fill();

      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.roundRect(-barW * 0.5, nextBarY, barW * cRatio, 0.2, 0.08);
      ctx.fill();

      // Subtle emerald/sky calming pulse arc around front bumper
      ctx.strokeStyle = `rgba(16, 185, 129, ${pulseAlpha.toFixed(2)})`;
      ctx.lineWidth = 0.13;
      ctx.beginPath();
      ctx.arc(0, -halfL + 0.2, halfW + 0.42 + pulseWave * 0.14, -Math.PI * 0.82, -Math.PI * 0.18);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Ide #9, #10, #11: Pairwise Social Interaction Vectors Layer
 * - Tailgate Pressure behind pressured vehicle (tailgatePressure > 0.55)
 * - Cooperative Handshake / Yield dashed emerald-sky line
 * - Defensive Flanking Cushion soft emerald side-arc on DEF/BUS when flankingHazard > 0.1
 */
function drawSocialInteractionVectors(
  ctx: CanvasRenderingContext2D,
  vehicles: Vehicle[],
  vMap: Map<number, Vehicle>,
  pulseWave: number,
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null
): void {
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const isSelected = selectedVehicleId !== null && v.id === selectedVehicleId;
    const dimmed = focusedArchetype !== null && v.archetype !== focusedArchetype && !isSelected;

    // Ide #9: Tailgate Pressure (> 0.55) behind pressured vehicle
    const tg = v.tailgatePressure ?? 0;
    if (tg > 0.55) {
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.24;
      ctx.translate(v.x, v.y);
      ctx.rotate(v.heading + Math.PI / 2);

      const halfL = v.length * 0.5;
      const linkLen = 1.45 + tg * 1.15;
      const isHot = tg > 0.78;
      ctx.strokeStyle = isHot
        ? `rgba(244, 63, 94, ${(0.58 + 0.34 * pulseWave).toFixed(2)})`
        : `rgba(245, 158, 11, ${(0.55 + 0.32 * pulseWave).toFixed(2)})`;
      ctx.lineWidth = 0.2;
      ctx.setLineDash([0.38, 0.24]);
      ctx.beginPath();
      ctx.moveTo(0, halfL + 0.25);
      ctx.lineTo(0, halfL + linkLen);
      ctx.stroke();
      ctx.setLineDash([]);

      // Forward-pointing pressure chevron pushing toward rear bumper
      const cy = halfL + 0.55 + (1 - pulseWave) * 0.35;
      ctx.lineWidth = 0.18;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-0.42, cy + 0.34);
      ctx.lineTo(0, cy);
      ctx.lineTo(0.42, cy + 0.34);
      ctx.stroke();
      ctx.restore();
    }

    // Ide #10: Cooperative Handshake / Yield Vector connecting v -> partner
    const partnerId = v.handshakePartnerId ?? v.yieldTargetId;
    if (partnerId != null && partnerId !== v.id) {
      const target = vMap.get(partnerId);
      if (target) {
        // Avoid double-drawing symmetric handshakes
        const isMutualDup =
          v.handshakePartnerId != null &&
          target.handshakePartnerId === v.id &&
          v.id > target.id;
        if (!isMutualDup) {
          const dx = target.x - v.x;
          const dy = target.y - v.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.8 && dist < 34) {
            ctx.save();
            if (dimmed) ctx.globalAlpha = 0.22;
            const isHandshake = v.handshakePartnerId != null;
            ctx.strokeStyle = isHandshake
              ? 'rgba(16, 185, 129, 0.82)'
              : 'rgba(14, 165, 233, 0.72)';
            ctx.lineWidth = 0.16;
            ctx.setLineDash([0.62, 0.42]);
            ctx.beginPath();
            ctx.moveTo(v.x, v.y);
            ctx.lineTo(target.x, target.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Subtle midpoint node pip
            const mx = (v.x + target.x) * 0.5;
            const my = (v.y + target.y) * 0.5;
            ctx.fillStyle = isHandshake ? '#10B981' : '#0EA5E9';
            ctx.beginPath();
            ctx.arc(mx, my, 0.24, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }

    // Ide #11: Defensive Flanking Cushion soft emerald side-arc on DEF / BUS when flankingHazard > 0.1
    const flank = v.flankingHazard ?? 0;
    if (flank > 0.1 && (v.archetype === 'defensive' || v.archetype === 'transit')) {
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.22;
      ctx.translate(v.x, v.y);
      ctx.rotate(v.heading + Math.PI / 2);

      const halfW = v.width * 0.5;
      const halfL = v.length * 0.5;
      const cushion = 0.42 + Math.min(0.45, flank * 0.42);
      const alpha = 0.42 + Math.min(0.4, flank * 0.45);

      ctx.strokeStyle = `rgba(16, 185, 129, ${alpha.toFixed(2)})`;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.11)';
      ctx.lineWidth = 0.15;

      // Soft protective emerald arcs along both flanks
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(side * (halfW + 0.12), -halfL * 0.72);
        ctx.quadraticCurveTo(
          side * (halfW + cushion + 0.32),
          0,
          side * (halfW + 0.12),
          halfL * 0.72
        );
        ctx.stroke();
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

/**
 * Ide #12: Crisp architectural target reticle + live target relation vectors for selected vehicle.
 */
function drawSelectedVehicleReticleAndLinks(
  ctx: CanvasRenderingContext2D,
  sel: Vehicle,
  vMap: Map<number, Vehicle>,
  pulseWave: number
): void {
  const drawLink = (
    targetId: number | undefined,
    color: string,
    dash: [number, number]
  ) => {
    if (targetId == null || targetId === sel.id) return;
    const t = vMap.get(targetId);
    if (!t) return;
    const dx = t.x - sel.x;
    const dy = t.y - sel.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5 || dist > 60) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.17;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(sel.x, sel.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Small target ring
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Relation vectors: Leader (slate), Overtake Target (sky), Yield / Handshake (emerald)
  drawLink(sel.leaderId, '#64748B', [0.55, 0.4]);
  drawLink(sel.overtakeTargetId, '#0EA5E9', [0.75, 0.35]);
  const coopId = sel.handshakePartnerId ?? sel.yieldTargetId;
  drawLink(coopId, '#10B981', [0.6, 0.35]);
  if (sel.yieldTargetId != null && sel.yieldTargetId !== coopId) {
    drawLink(sel.yieldTargetId, '#10B981', [0.6, 0.35]);
  }

  // Architectural 4-corner target reticle around selected vehicle
  const r = Math.max(sel.length, sel.width) * 0.5 + 0.68 + pulseWave * 0.14;
  const arm = Math.min(1.1, Math.max(0.55, r * 0.36));

  ctx.save();
  ctx.translate(sel.x, sel.y);

  const strokeCorners = () => {
    ctx.beginPath();
    // Top-Left
    ctx.moveTo(-r, -r + arm);
    ctx.lineTo(-r, -r);
    ctx.lineTo(-r + arm, -r);
    // Top-Right
    ctx.moveTo(r - arm, -r);
    ctx.lineTo(r, -r);
    ctx.lineTo(r, -r + arm);
    // Bottom-Right
    ctx.moveTo(r, r - arm);
    ctx.lineTo(r, r);
    ctx.lineTo(r - arm, r);
    // Bottom-Left
    ctx.moveTo(-r + arm, r);
    ctx.lineTo(-r, r);
    ctx.lineTo(-r, r - arm);
    ctx.stroke();
  };

  ctx.lineCap = 'square';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.lineWidth = 0.34;
  strokeCorners();

  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 0.18;
  strokeCorners();
  ctx.restore();
}

/**
 * Ide #2: Dedicated screen-space pass rendering crisp JetBrains Mono 9px dark micro-pills
 * with zero-GC overlap suppression on crowded/low-zoom scenes.
 */
function drawScreenSpaceArchetypePills(
  ctx: CanvasRenderingContext2D,
  vp: CanvasViewport,
  vehicles: Vehicle[],
  focusedArchetype: DriverArchetype | null,
  selectedVehicleId: number | null,
  posBuf: Float32Array
): void {
  const allowAllByZoom = vp.pxPerMeter >= 5.2;
  if (!allowAllByZoom && focusedArchetype === null && selectedVehicleId === null) {
    return;
  }

  const pillW = 26;
  const pillH = 13;
  const halfW = pillW * 0.5;
  const halfH = pillH * 0.5;
  const maxStored = posBuf.length >> 1;
  let placed = 0;

  ctx.save();
  ctx.font = '700 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.2;

  // Draw selected vehicle first so its pill is guaranteed never to be culled by overlap
  const drawOnePill = (v: Vehicle, isSelected: boolean) => {
    if (!v.archetype) return;
    const pt = worldToScreen(vp, v.x, v.y);
    if (pt.x < -30 || pt.x > vp.width + 30 || pt.y < -30 || pt.y > vp.height + 30) return;

    const footprintPx = Math.max(v.length, v.width) * 0.5 * vp.pxPerMeter;
    const px = pt.x;
    const py = pt.y - Math.min(26, Math.max(10, footprintPx + 7));

    if (!isSelected) {
      for (let j = 0; j < placed; j++) {
        const ox = posBuf[j * 2];
        const oy = posBuf[j * 2 + 1];
        if (Math.abs(px - ox) < 28 && Math.abs(py - oy) < 14) {
          return;
        }
      }
    }

    if (placed < maxStored) {
      posBuf[placed * 2] = px;
      posBuf[placed * 2 + 1] = py;
      placed++;
    }

    const badge = ARCHETYPE_TRAITS[v.archetype].shortBadge;
    const borderCol = ARCHETYPE_COLORS[v.archetype] ?? '#64748B';

    ctx.fillStyle = isSelected ? '#020617' : 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = isSelected ? '#38BDF8' : borderCol;
    ctx.beginPath();
    ctx.roundRect(px - halfW, py - halfH, pillW, pillH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(badge, px, py + 0.5);
  };

  if (selectedVehicleId !== null) {
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id === selectedVehicleId) {
        drawOnePill(vehicles[i], true);
        break;
      }
    }
  }

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (!v.archetype) continue;
    if (selectedVehicleId !== null && v.id === selectedVehicleId) continue;
    if (focusedArchetype !== null) {
      if (v.archetype !== focusedArchetype) continue;
    } else if (!allowAllByZoom) {
      continue;
    }
    drawOnePill(v, false);
  }

  ctx.restore();
}
