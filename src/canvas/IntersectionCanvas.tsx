import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getEffectiveRoadWidth } from '../engine/geometry';
import { ArmId, SignalColor, SimConfig, SimSnapshot, Vehicle } from '../engine/types';
import { getLoadedAsset, onAssetsLoaded, preloadSimulationAssets } from './assetLoader';
import { drawStaticRoadLayer } from './drawStaticRoad';

interface IntersectionCanvasProps {
  snapshotRef: React.MutableRefObject<SimSnapshot>;
  config: SimConfig;
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

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = React.memo(({
  snapshotRef,
  config,
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

  const sigPositions = useMemo<{ arm: ArmId; x: number; y: number }[]>(
    () => [
      { arm: 'north', x: halfRoad + 2.7, y: -halfBox - 2.7 },
      { arm: 'south', x: -halfRoad - 2.7, y: halfBox + 2.7 },
      { arm: 'west', x: -halfBox - 2.7, y: -halfRoad - 2.7 },
      { arm: 'east', x: halfBox + 2.7, y: halfRoad + 2.7 },
    ],
    [halfRoad, halfBox]
  );

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
      drawStaticRoadLayer(ctx, size.width, size.height, size.dpr, zoom, showGrid, halfRoad, halfBox, config);
    }
    drawFrameRef.current();
  }, [
    size,
    zoom,
    showGrid,
    halfRoad,
    halfBox,
    assetVer,
    config.lanesPerDirection,
    config.laneWidth,
    config.roadLength,
    config.roadWidthPerDirection,
    config.motorBoxEnabled,
    config.hasMedian,
    config.leftTurnOnRed,
    config.environmentId,
    config.scenarioName,
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

    const totalExtent = (halfBox + config.roadLength) * 2;
    const pxPerMeter = ((Math.min(width, height) * 0.92) / Math.max(60, totalExtent)) * zoom;
    const cx = width / 2;
    const cy = height / 2;
    const { signal, vehicles, stats } = snapshotRef.current;
    const blinkOn = Math.floor(stats.simTime * 2.5) % 2 === 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxPerMeter, pxPerMeter);

    for (const v of vehicles) drawVehicle(ctx, v, blinkOn);

    for (const sp of sigPositions) {
      const color = signal.armLights[sp.arm];
      const img = getLoadedAsset(SIGNAL_IMG[color]);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.roundRect(sp.x - 1.6, sp.y - 3.0, 3.2, 6.0, 0.6);
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
    }
    ctx.restore();

    const activeSig = sigPositions.find((sp) => sp.arm === signal.activeArm);
    if (activeSig) {
      const sx = cx + activeSig.x * pxPerMeter;
      const sy = activeSig.arm === 'north' || activeSig.arm === 'west'
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
      const bx = 16, by = height - 18;
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.lineTo(bx + barPx, by - 4);
      ctx.stroke();
      ctx.fillStyle = '#0F172A';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${scaleMeters} m · LHT (ID)`, bx, by - 7);
    }
    ctx.restore();
  }, [size, zoom, halfBox, config.roadLength, sigPositions, snapshotRef]);

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
  }, [running, drawTick, zoom, showGrid, size, assetVer, config, drawFrame]);

  const showHudPill = Boolean(
    config.scenarioName || config.leftTurnOnRed || config.motorBoxEnabled || config.hasMedian
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
        <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 shadow-sm">
          {config.scenarioName && (
            <span className="text-[11px] font-semibold text-slate-800">{config.scenarioName}</span>
          )}
          {config.leftTurnOnRed && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              LTOR
            </span>
          )}
          {config.motorBoxEnabled && (
            <span className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-600/20">
              RHK
            </span>
          )}
          {config.hasMedian && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-inset ring-slate-600/20">
              Median
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

function drawVehicle(ctx: CanvasRenderingContext2D, v: Vehicle, blinkOn: boolean) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.heading + Math.PI / 2);

  const img = getLoadedAsset(v.spriteKey);
  if (img) ctx.drawImage(img, -v.width / 2, -v.length / 2, v.width, v.length);
  else {
    ctx.fillStyle = v.vClass === 'motor' ? '#F59E0B' : v.vClass === 'heavy' ? '#475569' : '#1E293B';
    ctx.fillRect(-v.width / 2, -v.length / 2, v.width, v.length);
  }

  if (v.speed < 0.8) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
    if (v.vClass === 'motor') ctx.fillRect(-0.1, v.length * 0.4, 0.2, 0.12);
    else {
      const bw = Math.max(0.16, v.width * 0.16), bh = Math.max(0.12, v.length * 0.04);
      ctx.fillRect(-v.width * 0.34, v.length * 0.42, bw, bh);
      ctx.fillRect(v.width * 0.34 - bw, v.length * 0.42, bw, bh);
    }
  }

  const signalDir = v.laneChangeDir ?? (v.turn !== 'straight' && v.distanceAlongPath < v.exitLineDist ? v.turn : null);
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
