import React, { useEffect, useRef, useState } from 'react';
import { getEffectiveRoadWidth } from '../engine/geometry';
import { ArmId, SignalColor, SimSnapshot, Vehicle } from '../engine/types';
import { getLoadedAsset, onAssetsLoaded, preloadSimulationAssets } from './assetLoader';

interface IntersectionCanvasProps {
  snapshot: SimSnapshot;
  zoom: number;
  showGrid: boolean;
}

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

export const IntersectionCanvas: React.FC<IntersectionCanvasProps> = ({
  snapshot,
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

  // Rebuild offscreen static road/architecture layer only when geometry/viewport/assets change
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!staticCanvasRef.current) {
      staticCanvasRef.current = document.createElement('canvas');
    }
    const off = staticCanvasRef.current;
    const { width, height, dpr } = size;
    off.width = Math.floor(width * dpr);
    off.height = Math.floor(height * dpr);

    const ctx = off.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Background
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(0, 0, width, height);

    const totalExtent = (halfBox + config.roadLength) * 2;
    const baseScale = (Math.min(width, height) * 0.92) / Math.max(60, totalExtent);
    const pxPerMeter = baseScale * zoom;
    const cx = width / 2;
    const cy = height / 2;

    // 2. Swiss Architectural Blueprint Grid
    if (showGrid) {
      const gridStep = 10 * pxPerMeter;
      if (gridStep >= 8) {
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = cx % gridStep; x < width; x += gridStep) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
        }
        for (let y = cy % gridStep; y < height; y += gridStep) {
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxPerMeter, pxPerMeter);

    const armLen = halfBox + config.roadLength;
    const sidewalkW = 3.2;

    // 3. Corner Sidewalks & Architectural Urban Blocks
    const corners: { sx: number; sy: number; bldg: string }[] = [
      { sx: -1, sy: -1, bldg: '/assets/infra/city/building-roof-1.svg' },
      { sx: 1, sy: -1, bldg: '/assets/infra/city/building-roof-2.svg' },
      { sx: -1, sy: 1, bldg: '/assets/infra/city/building-roof-3.svg' },
      { sx: 1, sy: 1, bldg: '/assets/infra/city/building-roof-1.svg' },
    ];

    for (const c of corners) {
      const bx = c.sx * (halfRoad + sidewalkW);
      const by = c.sy * (halfRoad + sidewalkW);
      const bw = config.roadLength + 20;
      const bh = config.roadLength + 20;
      const rx = c.sx < 0 ? bx - bw : bx;
      const ry = c.sy < 0 ? by - bh : by;

      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(
        c.sx < 0 ? c.sx * halfRoad - bw - sidewalkW : c.sx * halfRoad,
        c.sy < 0 ? c.sy * halfRoad - bh - sidewalkW : c.sy * halfRoad,
        bw + sidewalkW,
        bh + sidewalkW
      );

      ctx.fillStyle = '#F8FAFC';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 0.25;
      ctx.fillRect(rx, ry, bw, bh);
      ctx.strokeRect(rx, ry, bw, bh);

      const bImg = getLoadedAsset(c.bldg);
      const bSize = Math.min(26, Math.max(14, config.roadLength * 0.32));
      const bPad = 5.5;
      const bPosX = c.sx < 0 ? bx - bPad - bSize : bx + bPad;
      const bPosY = c.sy < 0 ? by - bPad - bSize : by + bPad;
      if (bImg) {
        ctx.drawImage(bImg, bPosX, bPosY, bSize, bSize);
      }

      const treeImg = getLoadedAsset(
        c.sx * c.sy > 0 ? '/assets/infra/tree-architectural-1.svg' : '/assets/infra/tree-architectural-2.svg'
      );
      if (treeImg) {
        const tSize = 4.2;
        ctx.drawImage(treeImg, bx + c.sx * 2.2 - tSize / 2, by + c.sy * 12 - tSize / 2, tSize, tSize);
        ctx.drawImage(treeImg, bx + c.sx * 12 - tSize / 2, by + c.sy * 2.2 - tSize / 2, tSize, tSize);
        if (config.roadLength >= 90) {
          ctx.drawImage(treeImg, bx + c.sx * 2.2 - tSize / 2, by + c.sy * 36 - tSize / 2, tSize, tSize);
          ctx.drawImage(treeImg, bx + c.sx * 36 - tSize / 2, by + c.sy * 2.2 - tSize / 2, tSize, tSize);
        }
      }
    }

    // 4. Asphalt Road Surfaces + Curb Borders
    ctx.fillStyle = '#334155';
    ctx.fillRect(-halfRoad, -armLen, halfRoad * 2, armLen * 2);
    ctx.fillRect(-armLen, -halfRoad, armLen * 2, halfRoad * 2);

    ctx.fillStyle = '#293548';
    ctx.fillRect(-halfRoad, -halfRoad, halfRoad * 2, halfRoad * 2);

    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.moveTo(-halfRoad, -armLen); ctx.lineTo(-halfRoad, -halfRoad);
    ctx.moveTo(halfRoad, -armLen); ctx.lineTo(halfRoad, -halfRoad);
    ctx.moveTo(-halfRoad, halfRoad); ctx.lineTo(-halfRoad, armLen);
    ctx.moveTo(halfRoad, halfRoad); ctx.lineTo(halfRoad, armLen);
    ctx.moveTo(-armLen, -halfRoad); ctx.lineTo(-halfRoad, -halfRoad);
    ctx.moveTo(halfRoad, -halfRoad); ctx.lineTo(armLen, -halfRoad);
    ctx.moveTo(-armLen, halfRoad); ctx.lineTo(-halfRoad, halfRoad);
    ctx.moveTo(halfRoad, halfRoad); ctx.lineTo(armLen, halfRoad);
    ctx.stroke();

    // 5. Center Double Median Lines
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 0.22;
    const medianGap = 0.18;
    const drawMedian = (x1: number, y1: number, x2: number, y2: number, dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(x1 + dx * medianGap, y1 + dy * medianGap);
      ctx.lineTo(x2 + dx * medianGap, y2 + dy * medianGap);
      ctx.moveTo(x1 - dx * medianGap, y1 - dy * medianGap);
      ctx.lineTo(x2 - dx * medianGap, y2 - dy * medianGap);
      ctx.stroke();
    };
    drawMedian(0, -armLen, 0, -halfBox, 1, 0);
    drawMedian(0, halfBox, 0, armLen, 1, 0);
    drawMedian(-armLen, 0, -halfBox, 0, 0, 1);
    drawMedian(halfBox, 0, armLen, 0, 0, 1);

    // 6. Dashed Lane Dividers
    const lw = halfRoad / Math.max(1, config.lanesPerDirection);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.lineWidth = 0.16;
    ctx.setLineDash([1.6, 1.8]);
    for (let l = 1; l < config.lanesPerDirection; l++) {
      const off = l * lw;
      ctx.beginPath();
      ctx.moveTo(-off, -armLen); ctx.lineTo(-off, -halfBox);
      ctx.moveTo(off, -armLen); ctx.lineTo(off, -halfBox);
      ctx.moveTo(-off, halfBox); ctx.lineTo(-off, armLen);
      ctx.moveTo(off, halfBox); ctx.lineTo(off, armLen);
      ctx.moveTo(-armLen, -off); ctx.lineTo(-halfBox, -off);
      ctx.moveTo(-armLen, off); ctx.lineTo(-halfBox, off);
      ctx.moveTo(halfBox, -off); ctx.lineTo(armLen, -off);
      ctx.moveTo(halfBox, off); ctx.lineTo(armLen, off);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 7. Crosswalks, LHT Stop Lines, and Exit Counting Lines
    ctx.fillStyle = 'rgba(248, 250, 252, 0.72)';
    const stripeW = 0.65;
    const stripeGap = 0.65;
    const cwLen = 1.6;
    for (let p = -halfRoad + 0.5; p < halfRoad - 0.5; p += stripeW + stripeGap) {
      ctx.fillRect(p, -halfRoad - cwLen - 0.2, stripeW, cwLen);
      ctx.fillRect(p, halfRoad + 0.2, stripeW, cwLen);
      ctx.fillRect(-halfRoad - cwLen - 0.2, p, cwLen, stripeW);
      ctx.fillRect(halfRoad + 0.2, p, cwLen, stripeW);
    }

    // LHT Stop Lines (approaching left half)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-halfRoad, halfBox, halfRoad, 0.45);
    ctx.fillRect(0, -halfBox - 0.45, halfRoad, 0.45);
    ctx.fillRect(-halfBox - 0.45, -halfRoad, 0.45, halfRoad);
    ctx.fillRect(halfBox, 0, 0.45, halfRoad);

    // Subtle Emerald Exit Counting Lines (exiting left half)
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
    ctx.lineWidth = 0.24;
    ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath();
    ctx.moveTo(-halfRoad, -halfBox); ctx.lineTo(0, -halfBox);   // North exit
    ctx.moveTo(0, halfBox); ctx.lineTo(halfRoad, halfBox);     // South exit
    ctx.moveTo(halfBox, -halfRoad); ctx.lineTo(halfBox, 0);    // East exit
    ctx.moveTo(-halfBox, 0); ctx.lineTo(-halfBox, halfRoad);   // West exit
    ctx.stroke();
    ctx.setLineDash([]);

    // 8. LHT Lane-Specific Direction Arrows
    ctx.fillStyle = 'rgba(248, 250, 252, 0.38)';
    const drawArrow = (x: number, y: number, rot: number, mode: 'straight' | 'left' | 'right') => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      // Straight shaft
      ctx.beginPath();
      ctx.moveTo(0, -1.2);
      ctx.lineTo(0.48, -0.35);
      ctx.lineTo(0.18, -0.35);
      ctx.lineTo(0.18, 1.1);
      ctx.lineTo(-0.18, 1.1);
      ctx.lineTo(-0.18, -0.35);
      ctx.lineTo(-0.48, -0.35);
      ctx.closePath();
      ctx.fill();

      if (mode === 'left') {
        ctx.beginPath();
        ctx.moveTo(-0.18, 0.2);
        ctx.lineTo(-0.75, 0.2);
        ctx.lineTo(-0.75, 0.48);
        ctx.lineTo(-1.25, 0.05);
        ctx.lineTo(-0.75, -0.38);
        ctx.lineTo(-0.75, -0.1);
        ctx.lineTo(-0.18, -0.1);
        ctx.closePath();
        ctx.fill();
      } else if (mode === 'right') {
        ctx.beginPath();
        ctx.moveTo(0.18, 0.2);
        ctx.lineTo(0.75, 0.2);
        ctx.lineTo(0.75, 0.48);
        ctx.lineTo(1.25, 0.05);
        ctx.lineTo(0.75, -0.38);
        ctx.lineTo(0.75, -0.1);
        ctx.lineTo(0.18, -0.1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    const L = config.lanesPerDirection;
    for (let l = 0; l < L; l++) {
      const off = (l + 0.5) * lw;
      const mode: 'straight' | 'left' | 'right' =
        L === 1 ? 'straight' : l === L - 1 ? 'left' : l === 0 ? 'right' : 'straight';
      drawArrow(-off, halfBox + 6.0, 0, mode);
      drawArrow(off, -halfBox - 6.0, Math.PI, mode);
      drawArrow(-halfBox - 6.0, -off, Math.PI / 2, mode);
      drawArrow(halfBox + 6.0, off, -Math.PI / 2, mode);
    }

    ctx.restore();
    ctx.restore();
  }, [size, zoom, showGrid, halfRoad, halfBox, config.roadLength, config.lanesPerDirection, assetVer]);

  // Dynamic 60fps layer: blit static layer + draw signals + vehicles + crisp screen-space badges
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = size;
    ctx.save();
    ctx.scale(dpr, dpr);

    if (staticCanvasRef.current) {
      ctx.drawImage(staticCanvasRef.current, 0, 0, width, height);
    }

    const totalExtent = (halfBox + config.roadLength) * 2;
    const baseScale = (Math.min(width, height) * 0.92) / Math.max(60, totalExtent);
    const pxPerMeter = baseScale * zoom;
    const cx = width / 2;
    const cy = height / 2;

    const { signal, vehicles, stats } = snapshot;
    const blinkOn = Math.floor(stats.simTime * 2.5) % 2 === 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pxPerMeter, pxPerMeter);

    // Vehicles
    for (const v of vehicles) {
      drawVehicle(ctx, v, blinkOn);
    }

    // Traffic Signal Heads (set back 2.7m from road edge so arrows remain unobstructed)
    const sigPositions: { arm: ArmId; x: number; y: number }[] = [
      { arm: 'north', x: halfRoad + 2.7, y: -halfBox - 2.7 },
      { arm: 'south', x: -halfRoad - 2.7, y: halfBox + 2.7 },
      { arm: 'west', x: -halfBox - 2.7, y: -halfRoad - 2.7 },
      { arm: 'east', x: halfBox + 2.7, y: halfRoad + 2.7 },
    ];

    for (const sp of sigPositions) {
      const color = signal.armLights[sp.arm];
      const img = getLoadedAsset(SIGNAL_IMG[color]);

      // Architectural backing card
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

      if (img) {
        ctx.drawImage(img, sp.x - 1.15, sp.y - 2.5, 2.3, 5.0);
      } else {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 1.0, 0, Math.PI * 2);
        ctx.fillStyle = SIGNAL_COLORS[color];
        ctx.fill();
      }
    }

    ctx.restore();

    // Screen-space Signal Countdown Badge (always sharp 11px regardless of roadLength/zoom)
    const activeSig = sigPositions.find((sp) => sp.arm === signal.activeArm);
    if (activeSig) {
      const sx = cx + activeSig.x * pxPerMeter;
      const sy = cy + activeSig.y * pxPerMeter + Math.max(16, 3.8 * pxPerMeter);
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

    // Compass & Scale Bar Overlay
    const compassImg = getLoadedAsset('/assets/infra/compass-north.svg');
    if (compassImg) {
      ctx.drawImage(compassImg, width - 58, 14, 44, 44);
    }

    const barPx = 10 * pxPerMeter;
    if (barPx > 18 && barPx < 200) {
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
      ctx.fillText('10 m · LHT (ID)', bx, by - 7);
    }

    ctx.restore();
  }, [snapshot, size, zoom, halfRoad, halfBox]);

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

  // Crisp LED brake lights when stopped/waiting
  if (v.speed < 0.8 && v.distanceAlongPath < v.stopLineDist) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
    if (v.vClass === 'motor') {
      ctx.fillRect(-0.11, v.length * 0.42, 0.22, 0.14);
    } else {
      const bw = Math.max(0.16, v.width * 0.18);
      const bh = Math.max(0.14, v.length * 0.045);
      ctx.fillRect(-v.width * 0.34, v.length * 0.41, bw, bh);
      ctx.fillRect(v.width * 0.34 - bw, v.length * 0.41, bw, bh);
    }
  }

  const img = getLoadedAsset(v.spriteKey);
  if (img) {
    ctx.drawImage(img, -v.width / 2, -v.length / 2, v.width, v.length);
  } else {
    ctx.fillStyle = v.vClass === 'motor' ? '#F59E0B' : v.vClass === 'heavy' ? '#475569' : '#1E293B';
    ctx.fillRect(-v.width / 2, -v.length / 2, v.width, v.length);
  }

  // Blinking amber turn signal (lampu sein) for turning or tactical lane change
  const signalDir =
    v.laneChangeDir ??
    (v.turn !== 'straight' && v.distanceAlongPath < v.exitLineDist ? v.turn : null);
  if (blinkOn && signalDir) {
    const sideX = signalDir === 'left' ? -v.width * 0.44 : v.width * 0.44;
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(sideX, -v.length * 0.44, Math.max(0.22, v.width * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
