import { Point2D } from '../engine/types';

export interface CanvasViewport {
  width: number;
  height: number;
  cx: number;
  cy: number;
  pxPerMeter: number;
  zoom: number;
  panX: number; // screen pixels offset
  panY: number; // screen pixels offset
}

export function computeViewport(
  width: number,
  height: number,
  totalExtentMeters: number,
  zoom: number,
  panX = 0,
  panY = 0
): CanvasViewport {
  const safeExtent = Math.max(60, totalExtentMeters);
  const pxPerMeter = ((Math.min(width, height) * 0.92) / safeExtent) * zoom;
  return {
    width,
    height,
    cx: width / 2 + panX,
    cy: height / 2 + panY,
    pxPerMeter,
    zoom,
    panX,
    panY,
  };
}

export function worldToScreen(vp: CanvasViewport, wx: number, wy: number): Point2D {
  return {
    x: vp.cx + wx * vp.pxPerMeter,
    y: vp.cy + wy * vp.pxPerMeter,
  };
}

export function screenToWorld(vp: CanvasViewport, sx: number, sy: number): Point2D {
  const inv = vp.pxPerMeter > 1e-6 ? 1 / vp.pxPerMeter : 1;
  return {
    x: (sx - vp.cx) * inv,
    y: (sy - vp.cy) * inv,
  };
}

/**
 * Computes updated pan offsets so zooming around a cursor screen position keeps the world point under cursor stationary.
 */
export function zoomAroundScreenPoint(
  vp: CanvasViewport,
  totalExtentMeters: number,
  nextZoom: number,
  cursorScreenX: number,
  cursorScreenY: number
): { zoom: number; panX: number; panY: number } {
  const clampedZoom = Math.max(0.4, Math.min(3.5, +nextZoom.toFixed(2)));
  const worldPt = screenToWorld(vp, cursorScreenX, cursorScreenY);
  const basePxPerMeter = ((Math.min(vp.width, vp.height) * 0.92) / Math.max(60, totalExtentMeters)) * clampedZoom;
  const nextCx = cursorScreenX - worldPt.x * basePxPerMeter;
  const nextCy = cursorScreenY - worldPt.y * basePxPerMeter;
  return {
    zoom: clampedZoom,
    panX: nextCx - vp.width / 2,
    panY: nextCy - vp.height / 2,
  };
}
