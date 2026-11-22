import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getEffectiveRoadWidth } from '../engine/geometry';
import { CompiledTopology } from '../engine/topologyTypes';
import { SignalColor, SimConfig, SimSnapshot, Vehicle } from '../engine/types';
import { getLoadedAsset, onAssetsLoaded, preloadSimulationAssets } from './assetLoader';
import { drawStaticRoadLayer } from './drawStaticRoad';
import { computeViewport } from './viewport';

interface IntersectionCanvasProps {
  snapshotRef: React.MutableRefObject<SimSnapshot>;
  config: SimConfig;
  compiledTopology: CompiledTopology;
  running: boolean;
  drawTick: number;
  zoom: number;
  showGrid: boolean;
}

const SIGNAL_COLORS: Record<SignalColor, string> = { green: '#10B981', yellow: '#F59E0B', red: '#EF4444' };
const SIGNAL_IMG: Record<SignalColor, string> = {
  green: '/assets/infra/signal-green.svg',
  yellow: '/assets/infra/signal-yellow.svg',
  red: '/assets/infra/signal-red.svg',
};

const PHASE_PRESET_LABELS: Record<string, string> = {
  '4-phase-split': '4-Fase',
  '2-phase-simultaneous': '2-Fase Simultan',
  '3-phase': '3-Fase',
  '4-phase-protected-right': '4-Fase + Panah Kanan',
  custom: 'Fase Custom',
};

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = React.memo(({
  snapshotRef,
  config,
  compiledTopology,
  running,
  drawTick,
  zoom,
  showGrid,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600, dpr: 1 });
  const [assetVer, setAssetVer] = useState(0);

  useEffect(() => {
    preloadSimulationAssets();
    return onAssetsLoaded(() => setAssetVer((v) => v + 1));
  }, []);

  useEffect(() => {
    return () => {
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
        prev.width === w && prev.height === h && prev.dpr === dpr ? prev : { width: w, height: h, dpr }
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
    off.width = pixelW;
    off.height = pixelH;
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
        compiledTopology
      );
    }
    drawFrameRef.current();
  }, [
    size,
    zoom,
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

    const totalExtent = isCustomTopo
      ? compiledTopology.maxExtentMeters * 2
      : (halfBox + config.roadLength) * 2;
    const vp = computeViewport(width, height, totalExtent, zoom);
    const { cx, cy, pxPerMeter } = vp;

    const { signal, vehicles, stats } = snapshotRef.current;
    const blinkOn = Math.floor(stats.simTime * 2.5) % 2 === 0;
    const env = stats.environment;
    const headlightsOn = (env?.ambientDarkness ?? 0) > 0.1 || (env?.rainIntensity ?? 0) > 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxPerMeter, pxPerMeter);

    for (const v of vehicles) drawVehicle(ctx, v, blinkOn, headlightsOn);

    // Draw traffic signals for all arms (including optional Protected Right-Turn arrow lamps!)
    const armColors: Record<string, SignalColor> = signal.multiPhase?.armColors ?? signal.armLights;
    const arrowColors: Record<string, SignalColor | undefined> = signal.multiPhase?.armRightArrowColors ?? {};

    for (const sp of sigPositions) {
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

      if (img) ctx.drawImage(img, sp.x - 1.15, sp.y - 2.5, 2.3, 5.0);
      else {
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
      const tShift = stats.simTime * (340 + env.rainIntensity * 220);
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

    // Countdown pills on all currently-green/yellow arms (handles 2-phase simultaneous greens!)
    const activeArmIds = sigPositions.filter((sp) => {
      const c = armColors[sp.armId] ?? 'red';
      const rc = arrowColors[sp.armId];
      return c !== 'red' || (rc !== undefined && rc !== 'red');
    });
    const badgeTargets =
      activeArmIds.length > 0
        ? activeArmIds
        : sigPositions.filter((sp) => sp.armId === signal.activeArm).slice(0, 1);

    for (const activeSig of badgeTargets) {
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
  }, [size, zoom, halfBox, isCustomTopo, compiledTopology, config.roadLength, sigPositions, snapshotRef]);

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
  }, [running, drawTick, zoom, showGrid, size, assetVer, config, compiledTopology, drawFrame]);

  const phaseLabel = PHASE_PRESET_LABELS[config.signalPhasePreset ?? '4-phase-split'] ?? '4-Fase';
  const weatherMode = config.environment?.weather ?? 'clear';
  const customArms = config.customTopology?.arms;
  const hasLtor = customArms ? customArms.some((a) => a.leftTurnOnRed || a.slipLane?.enabled) : config.leftTurnOnRed;
  const hasRhk = customArms ? customArms.some((a) => a.motorBoxEnabled) : config.motorBoxEnabled;
  const hasMedianHud = customArms ? customArms.some((a) => a.medianWidth > 0.05) : config.hasMedian;
  const showHudPill = Boolean(
    config.scenarioName ||
      config.customTopology ||
      hasLtor ||
      hasRhk ||
      hasMedianHud ||
      config.yellowBoxEnabled ||
      (config.signalPhasePreset && config.signalPhasePreset !== '4-phase-split') ||
      weatherMode !== 'clear'
  );

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#EDF2E7] rounded-lg border border-slate-200">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        role="img"
        aria-label={
          config.scenarioName
            ? `Traffic intersection simulation: ${config.scenarioName}`
            : 'Traffic intersection simulation canvas'
        }
      />
      {showHudPill && (
        <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 shadow-sm max-w-[calc(100%-80px)]">
          {(config.customTopology?.name || config.scenarioName) && (
            <span className="text-[11px] font-semibold text-slate-800">
              {config.customTopology?.name || config.scenarioName}
            </span>
          )}
          <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
            {phaseLabel}
          </span>
          {hasLtor && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              LTOR
            </span>
          )}
          {hasRhk && (
            <span className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-600/20">
              RHK
            </span>
          )}
          {config.yellowBoxEnabled && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/25">
              YELLOW BOX
            </span>
          )}
          {hasMedianHud && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-inset ring-slate-600/20">
              Median
            </span>
          )}
          {weatherMode !== 'clear' && (
            <span className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-700 ring-1 ring-inset ring-sky-600/20">
              {weatherMode === 'heavy-rain' ? 'Hujan Lebat' : 'Gerimis'}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

function drawVectorCompassFallback(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
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

function drawVehicle(ctx: CanvasRenderingContext2D, v: Vehicle, blinkOn: boolean, headlightsOn: boolean) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.heading + Math.PI / 2);

  // Subtle headlight cones during rain or dusk/night
  if (headlightsOn) {
    ctx.fillStyle = 'rgba(254, 249, 195, 0.22)';
    ctx.beginPath();
    ctx.moveTo(-v.width * 0.3, -v.length * 0.48);
    ctx.lineTo(-v.width * 0.85, -v.length * 0.48 - 4.5);
    ctx.lineTo(v.width * 0.85, -v.length * 0.48 - 4.5);
    ctx.lineTo(v.width * 0.3, -v.length * 0.48);
    ctx.closePath();
    ctx.fill();
  }

  // Subtle visual halo when actively overtaking via oncoming lane, crossing markings, or reversing
  if (v.isReversing) {
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.85)';
    ctx.lineWidth = 0.2;
    ctx.strokeRect(-v.width / 2 - 0.16, -v.length / 2 - 0.16, v.width + 0.32, v.length + 0.32);
  } else if (v.overtakeState && v.overtakeState !== 'none') {
    ctx.strokeStyle = v.overtakeState === 'abort' ? 'rgba(239, 68, 68, 0.75)' : 'rgba(14, 165, 233, 0.75)';
    ctx.lineWidth = 0.18;
    ctx.strokeRect(-v.width / 2 - 0.16, -v.length / 2 - 0.16, v.width + 0.32, v.length + 0.32);
  } else if (v.crossingMarking) {
    ctx.save();
    ctx.setLineDash([0.35, 0.25]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
    ctx.lineWidth = 0.15;
    ctx.strokeRect(-v.width / 2 - 0.14, -v.length / 2 - 0.14, v.width + 0.28, v.length + 0.28);
    ctx.restore();
  }

  const img = getLoadedAsset(v.spriteKey);
  if (img) ctx.drawImage(img, -v.width / 2, -v.length / 2, v.width, v.length);
  else {
    ctx.fillStyle = v.vClass === 'motor' ? '#F59E0B' : v.vClass === 'heavy' ? '#475569' : '#1E293B';
    ctx.fillRect(-v.width / 2, -v.length / 2, v.width, v.length);
  }

  if (v.isReversing) {
    // Bright white reverse lights at rear
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    if (v.vClass === 'motor') ctx.fillRect(-0.09, v.length * 0.4, 0.18, 0.13);
    else {
      const rw = Math.max(0.16, v.width * 0.16);
      const rh = Math.max(0.12, v.length * 0.045);
      ctx.fillRect(-v.width * 0.3, v.length * 0.42, rw, rh);
      ctx.fillRect(v.width * 0.3 - rw, v.length * 0.42, rw, rh);
    }
  } else if (v.speed < 0.8 || v.brakingHard) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
    if (v.vClass === 'motor') ctx.fillRect(-0.1, v.length * 0.4, 0.2, 0.12);
    else {
      const bw = Math.max(0.16, v.width * 0.16);
      const bh = Math.max(0.12, v.length * 0.04);
      ctx.fillRect(-v.width * 0.34, v.length * 0.42, bw, bh);
      ctx.fillRect(v.width * 0.34 - bw, v.length * 0.42, bw, bh);
    }
  }

  const rawTurnDir = v.turn === 'uturn' ? 'right' : v.turn !== 'straight' && v.distanceAlongPath < v.exitLineDist ? v.turn : null;
  const signalDir = v.laneChangeDir ?? rawTurnDir;
  if (blinkOn && signalDir) {
    ctx.fillStyle = '#F59E0B';
    const r = v.vClass === 'motor' ? Math.max(0.055, v.width * 0.075) : Math.min(0.13, v.width * 0.075);
    const sx = (signalDir === 'left' ? -1 : 1) * v.width * (v.vClass === 'motor' ? 0.28 : 0.36);
    const sy = -v.length * (v.vClass === 'motor' ? 0.36 : 0.43);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
