import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAssetsLoaded } from '../canvas/assetLoader';
import { drawTopologyRoadWorld } from '../canvas/drawStaticRoad';
import { CanvasViewport, computeViewport, screenToWorld, worldToScreen, zoomAroundScreenPoint } from '../canvas/viewport';
import { CompiledTopology, IntersectionTopology } from '../engine/topologyTypes';
import { DrawModuleKind } from './drawStore';

interface DrawCanvasProps {
  topology: IntersectionTopology;
  compiled: CompiledTopology;
  selectedArmId: string | null;
  onSelectArm: (armId: string | null) => void;
  onDragStartRecord?: () => void;
  onArmAngleDrag: (armId: string, newAngleDeg: number) => void;
  onArmWidthDrag: (armId: string, side: 'in' | 'out', newAvgLaneWidth: number) => void;
  onSlipSetbackDrag: (armId: string, newSetback: number) => void;
  onCurbFlareDrag?: (armId: string, newFlare: number) => void;
  activeDragModule?: DrawModuleKind | null;
  onDropModule: (armId: string, moduleKind: DrawModuleKind, dropAngleDeg?: number) => void;
  showSplines: boolean;
  showConflicts: boolean;
  showStaticMap: boolean;
  showGrid: boolean;
  zoom: number;
  pan: { x: number; y: number };
  onViewportChange: (next: { zoom: number; pan: { x: number; y: number } }) => void;
}

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
  | { kind: 'angle'; armId: string }
  | { kind: 'width'; armId: string; side: 'in' | 'out' }
  | { kind: 'slip'; armId: string }
  | { kind: 'flare'; armId: string };

export const DrawCanvas: React.FC<DrawCanvasProps> = ({
  topology,
  compiled,
  selectedArmId,
  onSelectArm,
  onDragStartRecord,
  onArmAngleDrag,
  onArmWidthDrag,
  onSlipSetbackDrag,
  onCurbFlareDrag,
  activeDragModule,
  onDropModule,
  showSplines,
  showConflicts,
  showStaticMap,
  showGrid,
  zoom,
  pan,
  onViewportChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600, dpr: 1 });
  const dragRef = useRef<DragState>({ kind: 'none' });
  const [hoverArmId, setHoverArmId] = useState<string | null>(null);
  const [hoverCursor, setHoverCursor] = useState<'default' | 'pointer' | 'grab' | 'grabbing'>('default');
  const [dragReadout, setDragReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const [assetVer, setAssetVer] = useState(0);
  const [dropPreview, setDropPreview] = useState<{ armId: string; moduleKind: DrawModuleKind; worldPt: { x: number; y: number } } | null>(null);
  const [staticMapImg, setStaticMapImg] = useState<HTMLImageElement | null>(null);
  const [staticMapMissing, setStaticMapMissing] = useState(false);

  useEffect(() => onAssetsLoaded(() => setAssetVer((v) => v + 1)), []);

  // Load optional static reference map image (No. 5B hook) when enabled
  useEffect(() => {
    if (!showStaticMap || !topology.staticMapImage) {
      setStaticMapImg(null);
      setStaticMapMissing(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setStaticMapImg(img);
      setStaticMapMissing(false);
    };
    img.onerror = () => {
      setStaticMapImg(null);
      setStaticMapMissing(true);
    };
    img.src = topology.staticMapImage;
  }, [showStaticMap, topology.staticMapImage]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      setSize({ width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)), dpr });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalExtent = compiled.maxExtentMeters * 2;
  const vp: CanvasViewport = useMemo(
    () => computeViewport(size.width, size.height, totalExtent, zoom, pan.x, pan.y),
    [size.width, size.height, totalExtent, zoom, pan.x, pan.y]
  );

  // Compute interactive gizmo positions in world meters
  const gizmos = useMemo(() => {
    const angleHandles: { armId: string; x: number; y: number }[] = [];
    const widthHandles: { armId: string; side: 'in' | 'out'; x: number; y: number }[] = [];
    const slipHandles: { armId: string; x: number; y: number }[] = [];
    const flareHandles: { armId: string; x: number; y: number }[] = [];

    for (const armId of compiled.armOrder) {
      const arm = compiled.armsById[armId];
      const handleDist = arm.setback + Math.min(arm.def.length * 0.78, 52);
      angleHandles.push({
        armId,
        x: arm.outDir.x * handleDist,
        y: arm.outDir.y * handleDist,
      });

      if (armId === selectedArmId) {
        const midDist = arm.setback + Math.min(arm.def.length * 0.35, 22);
        const inEdge = arm.halfMedian + arm.inWidth;
        const outEdge = arm.halfMedian + arm.outWidth;
        widthHandles.push({
          armId,
          side: 'in',
          x: arm.outDir.x * midDist + arm.inLeftNormal.x * inEdge,
          y: arm.outDir.y * midDist + arm.inLeftNormal.y * inEdge,
        });
        widthHandles.push({
          armId,
          side: 'out',
          x: arm.outDir.x * midDist - arm.inLeftNormal.x * outEdge,
          y: arm.outDir.y * midDist - arm.inLeftNormal.y * outEdge,
        });

        if (arm.def.slipLane?.enabled) {
          const slipDist = arm.setback + arm.def.slipLane.islandSetback;
          const slipOff = arm.halfMedian + arm.inWidth + arm.def.slipLane.width * 0.5;
          slipHandles.push({
            armId,
            x: arm.outDir.x * slipDist + arm.inLeftNormal.x * slipOff,
            y: arm.outDir.y * slipDist + arm.inLeftNormal.y * slipOff,
          });
        }

        if (onCurbFlareDrag) {
          const flareDist = arm.setback + 2.5;
          const flareOff = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0);
          flareHandles.push({
            armId,
            x: arm.outDir.x * flareDist + arm.inLeftNormal.x * flareOff,
            y: arm.outDir.y * flareDist + arm.inLeftNormal.y * flareOff,
          });
        }
      }
    }
    return { angleHandles, widthHandles, slipHandles, flareHandles };
  }, [compiled, selectedArmId, onCurbFlareDrag]);

  const findNearestArmId = useCallback(
    (wx: number, wy: number): string | null => {
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const armId of compiled.armOrder) {
        const arm = compiled.armsById[armId];
        const proj = wx * arm.outDir.x + wy * arm.outDir.y;
        const clamped = Math.max(arm.setback * 0.5, Math.min(arm.setback + arm.def.length, proj));
        const px = arm.outDir.x * clamped;
        const py = arm.outDir.y * clamped;
        const d = Math.hypot(wx - px, wy - py);
        if (d < bestDist) {
          bestDist = d;
          bestId = armId;
        }
      }
      return bestDist < 26 ? bestId : compiled.armOrder[0] ?? null;
    },
    [compiled]
  );

  // Paint Draw Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelW = Math.floor(size.width * size.dpr);
    const pixelH = Math.floor(size.height * size.dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(size.dpr, size.dpr);
    ctx.fillStyle = '#D7E0CC';
    ctx.fillRect(0, 0, size.width, size.height);

    // Grid
    if (showGrid) {
      const gridStep = 10 * vp.pxPerMeter;
      if (gridStep >= 8) {
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const startX = ((vp.cx % gridStep) + gridStep) % gridStep;
        const startY = ((vp.cy % gridStep) + gridStep) % gridStep;
        for (let x = startX; x < size.width; x += gridStep) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, size.height);
        }
        for (let y = startY; y < size.height; y += gridStep) {
          ctx.moveTo(0, y);
          ctx.lineTo(size.width, y);
        }
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(vp.cx, vp.cy);
    ctx.scale(vp.pxPerMeter, vp.pxPerMeter);

    // Optional Static Reference Map Image (No. 5)
    if (showStaticMap && staticMapImg) {
      ctx.save();
      ctx.globalAlpha = 0.38;
      const mapSize = totalExtent * 0.9;
      ctx.drawImage(staticMapImg, -mapSize / 2, -mapSize / 2, mapSize, mapSize);
      ctx.restore();
    }

    // Core N-Arm Topology Road Layer
    drawTopologyRoadWorld(ctx, compiled, {
      showPathPreviews: showSplines,
      selectedArmId: dropPreview?.armId ?? selectedArmId ?? hoverArmId,
    });

    // Optional Conflict Zone Overlay (shows where straight vs crossing turns yield!)
    if (showConflicts) {
      for (const cz of compiled.conflictZones) {
        ctx.beginPath();
        ctx.arc(cz.point.x, cz.point.y, cz.type === 'opposing-turn' ? 1.1 : 0.75, 0, Math.PI * 2);
        ctx.fillStyle =
          cz.type === 'opposing-turn'
            ? 'rgba(244, 63, 94, 0.72)'
            : cz.type === 'merge'
            ? 'rgba(245, 158, 11, 0.68)'
            : 'rgba(99, 102, 241, 0.45)';
        ctx.fill();
      }
    }

    // Drop target highlight halo
    if (dropPreview) {
      const targetArm = compiled.armsById[dropPreview.armId];
      if (targetArm && dropPreview.moduleKind !== 'add-arm') {
        const d = targetArm.setback + 14;
        const hx = targetArm.outDir.x * d;
        const hy = targetArm.outDir.y * d;
        ctx.beginPath();
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#0284C7';
        ctx.lineWidth = 0.45;
        ctx.setLineDash([1.0, 0.8]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (dropPreview.moduleKind === 'add-arm') {
        ctx.strokeStyle = '#0284C7';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1.2, 1.0]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(dropPreview.worldPt.x, dropPreview.worldPt.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    // Screen-space interactive Gizmo Handles (always crisp pixel sizes!)
    for (const h of gizmos.angleHandles) {
      const sc = worldToScreen(vp, h.x, h.y);
      const isSel = h.armId === selectedArmId;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, isSel ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#0284C7' : '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = isSel ? '#FFFFFF' : '#0284C7';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = isSel ? '#FFFFFF' : '#0F172A';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↻', sc.x, sc.y + 0.5);
    }

    for (const w of gizmos.widthHandles) {
      const sc = worldToScreen(vp, w.x, w.y);
      ctx.beginPath();
      ctx.rect(sc.x - 6, sc.y - 6, 12, 12);
      ctx.fillStyle = w.side === 'in' ? '#10B981' : '#F59E0B';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    for (const sl of gizmos.slipHandles) {
      const sc = worldToScreen(vp, sl.x, sl.y);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#8B5CF6';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    for (const fl of gizmos.flareHandles) {
      const sc = worldToScreen(vp, fl.x, fl.y);
      ctx.beginPath();
      ctx.moveTo(sc.x, sc.y - 7);
      ctx.lineTo(sc.x + 7, sc.y);
      ctx.lineTo(sc.x, sc.y + 7);
      ctx.lineTo(sc.x - 7, sc.y);
      ctx.closePath();
      ctx.fillStyle = '#EC4899';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (dropPreview) {
      const sc = worldToScreen(vp, dropPreview.worldPt.x, dropPreview.worldPt.y);
      const labelMap: Record<DrawModuleKind, string> = {
        'slip-lane': '+ Pulau & Slip Lane',
        'add-arm': '+ Tambah Lengan Baru',
        median: 'Toggle Median Fisik',
        flare: 'Pelebaran Belokan',
        bottleneck: 'Asimetri / Bottleneck',
        uturn: 'Bukaan U-Turn',
        rhk: 'Kotak Motor (RHK)',
      };
      const txt = labelMap[dropPreview.moduleKind] ?? dropPreview.moduleKind;
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(txt).width + 16;
      const bx = Math.min(size.width - tw - 8, Math.max(8, sc.x - tw * 0.5));
      const by = Math.max(8, sc.y - 34);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.roundRect(bx, by, tw, 22, 5);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, bx + tw * 0.5, by + 11);
    }

    // Scale bar bottom-left
    const scaleMeters = [10, 5, 20, 50].find((m) => {
      const px = m * vp.pxPerMeter;
      return px > 24 && px < 180;
    });
    if (scaleMeters !== undefined) {
      const barPx = scaleMeters * vp.pxPerMeter;
      const bx = 16;
      const by = size.height - 16;
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
      ctx.fillText(`${scaleMeters} m · Draw Mode`, bx, by - 7);
    }

    ctx.restore();
  }, [size, vp, compiled, selectedArmId, hoverArmId, showSplines, showConflicts, showStaticMap, staticMapImg, showGrid, gizmos, dropPreview, totalExtent, assetVer]);

  const getLocalScreenPt = (e: React.MouseEvent | React.DragEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = getLocalScreenPt(e);

    // Middle/Right click or Shift+Alt pans
    if (e.button === 1 || e.button === 2) {
      dragRef.current = { kind: 'pan', startX: pt.x, startY: pt.y, origPanX: pan.x, origPanY: pan.y };
      setHoverCursor('grabbing');
      return;
    }

    // Check gizmo hit-test (screen pixel radius 13px)
    for (const fl of gizmos.flareHandles) {
      const sc = worldToScreen(vp, fl.x, fl.y);
      if (Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 13) {
        onDragStartRecord?.();
        dragRef.current = { kind: 'flare', armId: fl.armId };
        setHoverCursor('grabbing');
        return;
      }
    }

    for (const sl of gizmos.slipHandles) {
      const sc = worldToScreen(vp, sl.x, sl.y);
      if (Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 13) {
        onDragStartRecord?.();
        dragRef.current = { kind: 'slip', armId: sl.armId };
        setHoverCursor('grabbing');
        return;
      }
    }

    for (const w of gizmos.widthHandles) {
      const sc = worldToScreen(vp, w.x, w.y);
      if (Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 13) {
        onDragStartRecord?.();
        dragRef.current = { kind: 'width', armId: w.armId, side: w.side };
        setHoverCursor('grabbing');
        return;
      }
    }

    for (const h of gizmos.angleHandles) {
      const sc = worldToScreen(vp, h.x, h.y);
      if (Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 14) {
        onSelectArm(h.armId);
        onDragStartRecord?.();
        dragRef.current = { kind: 'angle', armId: h.armId };
        setHoverCursor('grabbing');
        return;
      }
    }

    // Otherwise select clicked arm or pan canvas
    const wpt = screenToWorld(vp, pt.x, pt.y);
    const hitArm = findNearestArmId(wpt.x, wpt.y);
    if (hitArm && Math.hypot(wpt.x, wpt.y) > 8) {
      onSelectArm(hitArm);
    } else {
      dragRef.current = { kind: 'pan', startX: pt.x, startY: pt.y, origPanX: pan.x, origPanY: pan.y };
      setHoverCursor('grabbing');
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = getLocalScreenPt(e);
    const d = dragRef.current;

    if (d.kind === 'pan') {
      onViewportChange({
        zoom,
        pan: { x: d.origPanX + (pt.x - d.startX), y: d.origPanY + (pt.y - d.startY) },
      });
      return;
    }

    const wpt = screenToWorld(vp, pt.x, pt.y);

    if (d.kind === 'angle') {
      let deg = (Math.atan2(wpt.y, wpt.x) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      const rounded = Math.round(deg) % 360;
      onArmAngleDrag(d.armId, rounded);
      setDragReadout({ x: pt.x, y: pt.y, text: `Sudut: ${rounded}°` });
      return;
    }

    if (d.kind === 'width') {
      const arm = compiled.armsById[d.armId];
      if (!arm) return;
      const lat = wpt.x * arm.inLeftNormal.x + wpt.y * arm.inLeftNormal.y;
      const rawCarriageway = d.side === 'in' ? lat - arm.halfMedian : -lat - arm.halfMedian;
      const laneCount = d.side === 'in' ? arm.def.inLanes : arm.def.outLanes;
      const avgW = Math.max(2.6, Math.min(4.6, +(rawCarriageway / Math.max(1, laneCount)).toFixed(1)));
      onArmWidthDrag(d.armId, d.side, avgW);
      setDragReadout({ x: pt.x, y: pt.y, text: `${d.side === 'in' ? 'Lajur Masuk' : 'Lajur Keluar'}: ${avgW.toFixed(1)}m` });
      return;
    }

    if (d.kind === 'flare') {
      const arm = compiled.armsById[d.armId];
      if (!arm || !onCurbFlareDrag) return;
      const lat = wpt.x * arm.inLeftNormal.x + wpt.y * arm.inLeftNormal.y;
      const flare = Math.max(0, Math.min(3.5, +(lat - arm.halfMedian - arm.inWidth).toFixed(1)));
      onCurbFlareDrag(d.armId, flare);
      setDragReadout({ x: pt.x, y: pt.y, text: `Pelebaran Belokan: +${flare.toFixed(1)}m` });
      return;
    }

    if (d.kind === 'slip') {
      const arm = compiled.armsById[d.armId];
      if (!arm) return;
      const along = wpt.x * arm.outDir.x + wpt.y * arm.outDir.y;
      const setback = Math.max(10, Math.min(30, Math.round(along - arm.setback)));
      onSlipSetbackDrag(d.armId, setback);
      setDragReadout({ x: pt.x, y: pt.y, text: `Mundur Slip: ${setback}m` });
      return;
    }

    // Hover feedback & dynamic cursor
    const overGizmo =
      gizmos.flareHandles.some((fl) => {
        const sc = worldToScreen(vp, fl.x, fl.y);
        return Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 13;
      }) ||
      gizmos.slipHandles.some((sl) => {
        const sc = worldToScreen(vp, sl.x, sl.y);
        return Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 13;
      }) ||
      gizmos.widthHandles.some((w) => {
        const sc = worldToScreen(vp, w.x, w.y);
        return Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 13;
      }) ||
      gizmos.angleHandles.some((h) => {
        const sc = worldToScreen(vp, h.x, h.y);
        return Math.hypot(pt.x - sc.x, pt.y - sc.y) <= 14;
      });

    const near = findNearestArmId(wpt.x, wpt.y);
    setHoverArmId(near);
    setHoverCursor(overGizmo ? 'grab' : near && Math.hypot(wpt.x, wpt.y) > 8 ? 'pointer' : 'default');
  };

  const handleMouseUp = () => {
    dragRef.current = { kind: 'none' };
    setDragReadout(null);
    setHoverCursor('default');
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const res = zoomAroundScreenPoint(vp, totalExtent, zoom * factor, sx, sy);
    onViewportChange({ zoom: res.zoom, pan: { x: res.panX, y: res.panY } });
  };

  const handleDragOver = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const moduleKind = (activeDragModule || e.dataTransfer.getData('application/x-draw-module') || 'slip-lane') as DrawModuleKind;
    const pt = getLocalScreenPt(e);
    const wpt = screenToWorld(vp, pt.x, pt.y);
    const armId = findNearestArmId(wpt.x, wpt.y) ?? compiled.armOrder[0] ?? '';
    setDropPreview({ armId, moduleKind, worldPt: wpt });
  };

  const handleDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const moduleKind = e.dataTransfer.getData('application/x-draw-module') as DrawModuleKind;
    setDropPreview(null);
    if (!moduleKind) return;
    const pt = getLocalScreenPt(e);
    const wpt = screenToWorld(vp, pt.x, pt.y);
    const armId = findNearestArmId(wpt.x, wpt.y) ?? compiled.armOrder[0] ?? '';
    let angle = (Math.atan2(wpt.y, wpt.x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    onDropModule(armId, moduleKind, Math.round(angle));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden rounded-lg border border-slate-200 bg-[#D7E0CC] select-none"
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropPreview(null)}
        onDrop={handleDrop}
        style={{ cursor: hoverCursor }}
        className="block w-full h-full"
      />

      {dragReadout && (
        <div
          style={{ left: dragReadout.x + 14, top: dragReadout.y - 26 }}
          className="pointer-events-none absolute z-20 rounded bg-slate-900/95 px-2 py-0.5 font-mono text-[10px] font-semibold text-white shadow"
        >
          {dragReadout.text}
        </div>
      )}

      {/* Compact Legend Pill */}
      <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] text-slate-600 shadow-sm">
        <span className="font-semibold text-slate-900">{topology.name}</span>
        <span className="text-slate-300">|</span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-600 inline-block" /> Seret sudut (Shift=snap 15°)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Lebar masuk
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Lebar keluar
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" /> Pulau slip-lane
        </span>
      </div>

      {showStaticMap && staticMapMissing && topology.staticMapImage && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800 shadow-sm max-w-[300px]">
          Slot peta statis <code className="font-mono">{topology.staticMapImage}</code> belum diisi. Taruh gambar statis di <code className="font-mono">public{topology.staticMapImage}</code> jika ingin menampilkan citra peta.
        </div>
      )}
    </div>
  );
};
