import React, { useEffect, useRef, useState } from 'react';
import { getEffectiveRoadWidth } from '../engine/geometry';
import { ArmId, SignalColor, SimSnapshot, Vehicle } from '../engine/types';
import { getLoadedAsset, onAssetsLoaded, preloadSimulationAssets } from './assetLoader';
import { drawStaticRoadLayer } from './drawStaticRoad';

interface IntersectionCanvasProps {
  snapshot: SimSnapshot;
  zoom: number;
  showGrid: boolean;
}

const SIGNAL_COLORS: Record<SignalColor, string> = { green: '#10B981', yellow: '#F59E0B', red: '#EF4444' };
const SIGNAL_IMG: Record<SignalColor, string> = {
  green: '/assets/infra/signal-green.svg',
  yellow: '/assets/infra/signal-yellow.svg',
  red: '/assets/infra/signal-red.svg',
};

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = ({ snapshot, zoom, showGrid }) => {
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
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setSize({ width: w, height: h, dpr });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const { config } = snapshot;
  const halfRoad = getEffectiveRoadWidth(config);
  const halfBox = halfRoad + 2.0;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!staticCanvasRef.current) staticCanvasRef.current = document.createElement('canvas');
    const off = staticCanvasRef.current;
    off.width = Math.floor(size.width * size.dpr);
    off.height = Math.floor(size.height * size.dpr);
    const ctx = off.getContext('2d');
    if (ctx) drawStaticRoadLayer(ctx, size.width, size.height, size.dpr, zoom, showGrid, halfRoad, halfBox, config);
  }, [size, zoom, showGrid, halfRoad, halfBox, config.roadLength, config.lanesPerDirection, assetVer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = size;
    ctx.save();
    ctx.scale(dpr, dpr);
    if (staticCanvasRef.current) ctx.drawImage(staticCanvasRef.current, 0, 0, width, height);

    const totalExtent = (halfBox + config.roadLength) * 2;
    const pxPerMeter = ((Math.min(width, height) * 0.92) / Math.max(60, totalExtent)) * zoom;
    const cx = width / 2;
    const cy = height / 2;
    const { signal, vehicles, stats } = snapshot;
    const blinkOn = Math.floor(stats.simTime * 2.5) % 2 === 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxPerMeter, pxPerMeter);

    for (const v of vehicles) drawVehicle(ctx, v, blinkOn);

    const sigPositions: { arm: ArmId; x: number; y: number }[] = [
      { arm: 'north', x: halfRoad + 2.7, y: -halfBox - 2.7 },
      { arm: 'south', x: -halfRoad - 2.7, y: halfBox + 2.7 },
      { arm: 'west', x: -halfBox - 2.7, y: -halfRoad - 2.7 },
      { arm: 'east', x: halfBox + 2.7, y: halfRoad + 2.7 },
    ];

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
      const sy = activeSig.arm === 'north'
        ? cy + activeSig.y * pxPerMeter - Math.max(18, 4.0 * pxPerMeter)
        : cy + activeSig.y * pxPerMeter + Math.max(16, 3.8 * pxPerMeter);
      const label = `${Math.ceil(signal.phaseRemaining)}s`;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.roundRect(sx - tw / 2, sy - 8, tw, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx, sy + 0.5);
    }

    const compassImg = getLoadedAsset('/assets/infra/compass-north.svg');
    if (compassImg) ctx.drawImage(compassImg, width - 58, 14, 44, 44);

    const barPx = 10 * pxPerMeter;
    if (barPx > 18 && barPx < 200) {
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
      ctx.fillText('10 m · LHT (ID)', bx, by - 7);
    }
    ctx.restore();
  }, [snapshot, size, zoom, halfRoad, halfBox, assetVer]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-slate-100 rounded-lg border border-slate-200">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

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

  if (v.speed < 0.8 && v.distanceAlongPath < v.stopLineDist + 2.0) {
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
