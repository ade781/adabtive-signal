import { SimConfig } from '../engine/types';
import { getLoadedAsset } from './assetLoader';

export function drawStaticRoadLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  zoom: number,
  showGrid: boolean,
  halfRoad: number,
  halfBox: number,
  config: SimConfig
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(0, 0, width, height);

  const totalExtent = (halfBox + config.roadLength) * 2;
  const pxPerMeter = ((Math.min(width, height) * 0.92) / Math.max(60, totalExtent)) * zoom;
  const cx = width / 2;
  const cy = height / 2;

  if (showGrid) {
    const gridStep = 10 * pxPerMeter;
    if (gridStep >= 8) {
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = cx % gridStep; x < width; x += gridStep) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = cy % gridStep; y < height; y += gridStep) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pxPerMeter, pxPerMeter);

  const armLen = halfBox + config.roadLength;
  const sidewalkW = 3.2;

  const corners = [
    { sx: -1, sy: -1, primary: '/assets/infra/city/building-tower-glass.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/helipad-roof.svg' },
    { sx: 1, sy: -1, primary: '/assets/infra/city/park-plaza.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/building-roof-2.svg' },
    { sx: -1, sy: 1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-roof-3.svg' },
    { sx: 1, sy: 1, primary: '/assets/infra/city/building-roof-1.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/park-plaza.svg' },
  ];

  for (const c of corners) {
    const bx = c.sx * (halfRoad + sidewalkW);
    const by = c.sy * (halfRoad + sidewalkW);
    const bw = config.roadLength + 20;
    const rx = c.sx < 0 ? bx - bw : bx;
    const ry = c.sy < 0 ? by - bw : by;

    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(c.sx < 0 ? c.sx * halfRoad - bw - sidewalkW : c.sx * halfRoad, c.sy < 0 ? c.sy * halfRoad - bw - sidewalkW : c.sy * halfRoad, bw + sidewalkW, bw + sidewalkW);

    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 0.25;
    ctx.fillRect(rx, ry, bw, bw);
    ctx.strokeRect(rx, ry, bw, bw);

    const bSize = Math.min(26, Math.max(14, config.roadLength * 0.32));
    const pImg = getLoadedAsset(c.primary);
    if (pImg) ctx.drawImage(pImg, c.sx < 0 ? bx - 5.5 - bSize : bx + 5.5, c.sy < 0 ? by - 5.5 - bSize : by + 5.5, bSize, bSize);

    if (config.roadLength >= 55) {
      const sImg = getLoadedAsset(c.secondary);
      const sSize = bSize * 0.85;
      if (sImg) ctx.drawImage(sImg, c.sx < 0 ? bx - 5.5 - bSize - sSize - 4 : bx + 5.5 + bSize + 4, c.sy < 0 ? by - 5.5 - sSize : by + 5.5, sSize, sSize);

      const tImg = getLoadedAsset(c.tertiary);
      if (tImg) ctx.drawImage(tImg, c.sx < 0 ? bx - 5.5 - sSize : bx + 5.5, c.sy < 0 ? by - 5.5 - bSize - sSize - 4 : by + 5.5 + bSize + 4, sSize, sSize);
    }

    const planterImg = getLoadedAsset('/assets/infra/city/planter-box-long.svg');
    if (planterImg) ctx.drawImage(planterImg, bx + c.sx * 1.4 - 4.5, by + c.sy * 20 - 1.2, 9, 2.4);

    const treeImg = getLoadedAsset(c.sx * c.sy > 0 ? '/assets/infra/tree-architectural-1.svg' : '/assets/infra/city/tree-palm-top.svg');
    if (treeImg) {
      const tSize = 4.4;
      ctx.drawImage(treeImg, bx + c.sx * 2.2 - tSize / 2, by + c.sy * 12 - tSize / 2, tSize, tSize);
      ctx.drawImage(treeImg, bx + c.sx * 12 - tSize / 2, by + c.sy * 2.2 - tSize / 2, tSize, tSize);
      if (config.roadLength >= 90) {
        ctx.drawImage(treeImg, bx + c.sx * 2.2 - tSize / 2, by + c.sy * 36 - tSize / 2, tSize, tSize);
        ctx.drawImage(treeImg, bx + c.sx * 36 - tSize / 2, by + c.sy * 2.2 - tSize / 2, tSize, tSize);
      }
    }
  }

  // Asphalt & curbs
  ctx.fillStyle = '#334155';
  ctx.fillRect(-halfRoad, -armLen, halfRoad * 2, armLen * 2);
  ctx.fillRect(-armLen, -halfRoad, armLen * 2, halfRoad * 2);
  ctx.fillStyle = '#293548';
  ctx.fillRect(-halfRoad, -halfRoad, halfRoad * 2, halfRoad * 2);

  ctx.strokeStyle = '#94A3B8';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * halfRoad, -armLen); ctx.lineTo(s * halfRoad, -halfRoad);
    ctx.moveTo(s * halfRoad, halfRoad); ctx.lineTo(s * halfRoad, armLen);
    ctx.moveTo(-armLen, s * halfRoad); ctx.lineTo(-halfRoad, s * halfRoad);
    ctx.moveTo(halfRoad, s * halfRoad); ctx.lineTo(armLen, s * halfRoad);
  }
  ctx.stroke();

  // Center double yellow medians
  ctx.strokeStyle = '#FBBF24';
  ctx.lineWidth = 0.22;
  const g = 0.18;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * g, -armLen); ctx.lineTo(s * g, -halfBox);
    ctx.moveTo(s * g, halfBox); ctx.lineTo(s * g, armLen);
    ctx.moveTo(-armLen, s * g); ctx.lineTo(-halfBox, s * g);
    ctx.moveTo(halfBox, s * g); ctx.lineTo(armLen, s * g);
  }
  ctx.stroke();

  // Dashed lane dividers
  const lw = halfRoad / Math.max(1, config.lanesPerDirection);
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
  ctx.lineWidth = 0.16;
  ctx.setLineDash([1.6, 1.8]);
  ctx.beginPath();
  for (let l = 1; l < config.lanesPerDirection; l++) {
    const off = l * lw;
    for (const s of [-1, 1]) {
      ctx.moveTo(s * off, -armLen); ctx.lineTo(s * off, -halfBox);
      ctx.moveTo(s * off, halfBox); ctx.lineTo(s * off, armLen);
      ctx.moveTo(-armLen, s * off); ctx.lineTo(-halfBox, s * off);
      ctx.moveTo(halfBox, s * off); ctx.lineTo(armLen, s * off);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosswalks & Stop Lines
  ctx.fillStyle = 'rgba(248, 250, 252, 0.72)';
  for (let p = -halfRoad + 0.5; p < halfRoad - 0.5; p += 1.3) {
    ctx.fillRect(p, -halfRoad - 1.8, 0.65, 1.6);
    ctx.fillRect(p, halfRoad + 0.2, 0.65, 1.6);
    ctx.fillRect(-halfRoad - 1.8, p, 1.6, 0.65);
    ctx.fillRect(halfRoad + 0.2, p, 1.6, 0.65);
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(-halfRoad, halfBox, halfRoad, 0.45);
  ctx.fillRect(0, -halfBox - 0.45, halfRoad, 0.45);
  ctx.fillRect(-halfBox - 0.45, -halfRoad, 0.45, halfRoad);
  ctx.fillRect(halfBox, 0, 0.45, halfRoad);

  // Emerald Exit Counting Lines
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
  ctx.lineWidth = 0.24;
  ctx.setLineDash([0.8, 0.6]);
  ctx.beginPath();
  ctx.moveTo(-halfRoad, -halfBox); ctx.lineTo(0, -halfBox);
  ctx.moveTo(0, halfBox); ctx.lineTo(halfRoad, halfBox);
  ctx.moveTo(halfBox, -halfRoad); ctx.lineTo(halfBox, 0);
  ctx.moveTo(-halfBox, 0); ctx.lineTo(-halfBox, halfRoad);
  ctx.stroke();
  ctx.setLineDash([]);

  // LHT Lane Arrows
  ctx.fillStyle = 'rgba(248, 250, 252, 0.38)';
  const drawArrow = (x: number, y: number, rot: number, mode: 'straight' | 'left' | 'right') => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -1.2); ctx.lineTo(0.48, -0.35); ctx.lineTo(0.18, -0.35);
    ctx.lineTo(0.18, 1.1); ctx.lineTo(-0.18, 1.1); ctx.lineTo(-0.18, -0.35); ctx.lineTo(-0.48, -0.35);
    ctx.closePath();
    ctx.fill();
    if (mode !== 'straight') {
      const s = mode === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(s * 0.18, 0.2); ctx.lineTo(s * 0.75, 0.2); ctx.lineTo(s * 0.75, 0.48);
      ctx.lineTo(s * 1.25, 0.05); ctx.lineTo(s * 0.75, -0.38); ctx.lineTo(s * 0.75, -0.1); ctx.lineTo(s * 0.18, -0.1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  const L = config.lanesPerDirection;
  for (let l = 0; l < L; l++) {
    const off = (l + 0.5) * lw;
    const mode: 'straight' | 'left' | 'right' = L === 1 ? 'straight' : l === L - 1 ? 'left' : l === 0 ? 'right' : 'straight';
    drawArrow(-off, halfBox + 6.0, 0, mode);
    drawArrow(off, -halfBox - 6.0, Math.PI, mode);
    drawArrow(-halfBox - 6.0, -off, Math.PI / 2, mode);
    drawArrow(halfBox + 6.0, off, -Math.PI / 2, mode);
  }

  ctx.restore();
  ctx.restore();
}
