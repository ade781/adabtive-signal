import { SimConfig } from '../engine/types';
import { getLoadedAsset } from './assetLoader';

interface CornerSpec {
  sx: -1 | 1;
  sy: -1 | 1;
  primary: string;
  secondary: string;
  tertiary: string;
  isPark: boolean;
  label?: string;
  riverEdge?: boolean;
  denseTrees?: boolean;
}

function resolveEnvironmentKey(config: SimConfig): string {
  if (config.environmentId && config.environmentId !== 'default') {
    return config.environmentId;
  }
  const name = (config.scenarioName ?? '').toLowerCase();
  if (name.includes('brimob')) return 'brimob-yogya';
  if (name.includes('lamper')) return 'lamper-semarang';
  if (name.includes('sulawesi')) return 'sulawesi-banjarmasin';
  if (name.includes('laswi')) return 'laswi-bandung';
  if (name.includes('bondowoso') || name.includes('retawu')) return 'bondowoso-malang';
  return 'default';
}

function getEnvironmentCorners(envKey: string): CornerSpec[] {
  switch (envKey) {
    case 'brimob-yogya':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/landmark-mako-brimob.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: false, label: 'Mako Brimob Baciro' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-pasar-tradisional.svg', secondary: '/assets/infra/city/landmark-ruko-row.svg', tertiary: '/assets/infra/city/building-roof-1.svg', isPark: false, label: 'Taru Martani & Ruko' },
        { sx: -1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-roof-3.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Ruko Gondosuli' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-stadion-corner.svg', secondary: '/assets/infra/city/park-plaza.svg', tertiary: '/assets/infra/city/building-terrace-green.svg', isPark: true, label: 'Kawasan Mandala Krida', denseTrees: true },
      ];
    case 'lamper-semarang':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/landmark-ruko-row.svg', isPark: false, label: 'Eks Lotte Mart Majapahit' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: false, label: 'Ruko Jl. Gajah Raya' },
        { sx: -1, sy: 1, primary: '/assets/infra/city/helipad-roof.svg', secondary: '/assets/infra/city/building-tower-glass.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Kawasan RS Bhayangkara' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-roof-1.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: false, label: 'Ruko Lamper Tengah' },
      ];
    case 'sulawesi-banjarmasin':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/landmark-pasar-tradisional.svg', secondary: '/assets/infra/city/landmark-ruko-row.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Pasar Lama' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-masjid-jami.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: true, label: 'Kawasan Masjid Jami', riverEdge: true },
        { sx: -1, sy: 1, primary: '/assets/infra/city/building-roof-1.svg', secondary: '/assets/infra/city/building-roof-3.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: false, label: 'Kampung Bugis' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/park-plaza.svg', tertiary: '/assets/infra/city/building-roof-1.svg', isPark: false, label: 'Tepi Sungai & Jembatan', riverEdge: true },
      ];
    case 'laswi-bandung':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/building-tower-glass.svg', secondary: '/assets/infra/city/helipad-roof.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'Koridor Laswi' },
        { sx: 1, sy: -1, primary: '/assets/infra/city/landmark-spbu-pertamina.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/parking-lot-top.svg', isPark: false, label: 'SPBU & Halte TMB' },
        { sx: -1, sy: 1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-tower-glass.svg', isPark: false, label: 'Kawasan Trans Studio' },
        { sx: 1, sy: 1, primary: '/assets/infra/city/building-terrace-green.svg', secondary: '/assets/infra/city/park-plaza.svg', tertiary: '/assets/infra/city/landmark-ruko-row.svg', isPark: false, label: 'Pelajar Pejuang 45' },
      ];
    case 'bondowoso-malang':
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/landmark-kampus-wilis.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-terrace-green.svg', isPark: false, label: 'Kampus Widya Karya', denseTrees: true },
        { sx: 1, sy: -1, primary: '/assets/infra/city/park-plaza.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: true, label: 'Taman Jl. Retawu', denseTrees: true },
        { sx: -1, sy: 1, primary: '/assets/infra/city/landmark-pasar-tradisional.svg', secondary: '/assets/infra/city/landmark-ruko-row.svg', tertiary: '/assets/infra/city/building-roof-1.svg', isPark: false, label: 'Pasar Buku Wilis', denseTrees: true },
        { sx: 1, sy: 1, primary: '/assets/infra/city/landmark-ruko-row.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: false, label: 'Sentra Kuliner & Kafe', denseTrees: true },
      ];
    default:
      return [
        { sx: -1, sy: -1, primary: '/assets/infra/city/building-tower-glass.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/helipad-roof.svg', isPark: false },
        { sx: 1, sy: -1, primary: '/assets/infra/city/park-plaza.svg', secondary: '/assets/infra/city/park-pond.svg', tertiary: '/assets/infra/city/building-roof-2.svg', isPark: true },
        { sx: -1, sy: 1, primary: '/assets/infra/city/building-commercial-mall.svg', secondary: '/assets/infra/city/parking-lot-top.svg', tertiary: '/assets/infra/city/building-roof-3.svg', isPark: false },
        { sx: 1, sy: 1, primary: '/assets/infra/city/building-roof-1.svg', secondary: '/assets/infra/city/building-terrace-green.svg', tertiary: '/assets/infra/city/park-plaza.svg', isPark: false },
      ];
  }
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  boxW: number,
  boxH: number
): void {
  const nw = img.naturalWidth || boxW;
  const nh = img.naturalHeight || boxH;
  if (nw <= 0 || nh <= 0) {
    ctx.drawImage(img, x, y, boxW, boxH);
    return;
  }
  const scale = Math.min(boxW / nw, boxH / nh);
  const w = nw * scale;
  const h = nh * scale;
  ctx.drawImage(img, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
}

function drawRotatedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

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

  ctx.fillStyle = '#C9D3B8';
  ctx.fillRect(0, 0, width, height);

  const totalExtent = (halfBox + config.roadLength) * 2;
  const pxPerMeter = ((Math.min(width, height) * 0.92) / Math.max(60, totalExtent)) * zoom;
  const cx = width / 2;
  const cy = height / 2;

  if (showGrid) {
    const gridStep = 10 * pxPerMeter;
    if (gridStep >= 8) {
      ctx.strokeStyle = 'rgba(120, 134, 107, 0.28)';
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
  const sidewalkW = 3.4;

  const envKey = resolveEnvironmentKey(config);
  const corners = getEnvironmentCorners(envKey);

  for (const c of corners) {
    const bx = c.sx * (halfRoad + sidewalkW);
    const by = c.sy * (halfRoad + sidewalkW);
    const bw = config.roadLength + 24;
    const rx = c.sx < 0 ? bx - bw : bx;
    const ry = c.sy < 0 ? by - bw : by;

    // Sidewalk (Trotoar konblok)
    const swX = c.sx < 0 ? c.sx * halfRoad - bw - sidewalkW : c.sx * halfRoad;
    const swY = c.sy < 0 ? c.sy * halfRoad - bw - sidewalkW : c.sy * halfRoad;
    ctx.fillStyle = '#CFCBC2';
    ctx.fillRect(swX, swY, bw + sidewalkW, bw + sidewalkW);

    // Tropical grass & warm Indonesian soil plot (Tanah & Rumput)
    ctx.fillStyle = c.isPark ? '#7FA25E' : '#94AD74';
    ctx.fillRect(rx, ry, bw, bw);

    // Martapura river/canal edge for Banjarmasin east quadrants
    const riverOffset = c.riverEdge ? Math.max(42, config.roadLength * 0.56) : bw;
    if (c.riverEdge) {
      const riverX = bx + riverOffset;
      const riverW = Math.max(12, bw - riverOffset);
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(riverX - 1.6, ry, 1.6, bw);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(riverX, ry, riverW, bw);
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(riverX + riverW * 0.25, ry, riverW * 0.5, bw);
    }

    // Warm earth/soil border strip (Tanah cokelat) along the sidewalk edge
    const soilStrip = 2.6;
    ctx.fillStyle = '#A88F6B';
    ctx.fillRect(
      c.sx < 0 ? bx - soilStrip : bx,
      ry,
      soilStrip,
      bw
    );
    ctx.fillRect(
      rx,
      c.sy < 0 ? by - soilStrip : by,
      c.riverEdge ? Math.min(bw, riverOffset) : bw,
      soilStrip
    );

    // Paved courtyard / konblok forecourt for buildings
    const bSize = Math.min(26, Math.max(14, config.roadLength * 0.32));
    if (!c.isPark) {
      const yardPad = 2.5;
      const yardW = bSize * 2.05;
      const yardX = c.sx < 0 ? bx - soilStrip - yardPad - yardW : bx + soilStrip + yardPad;
      const yardY = c.sy < 0 ? by - soilStrip - yardPad - yardW : by + soilStrip + yardPad;
      ctx.fillStyle = '#D7D2C7';
      ctx.strokeStyle = '#B8B0A0';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.roundRect(yardX, yardY, yardW, yardW, 1.2);
      ctx.fill();
      ctx.stroke();
    }

    const pX = c.sx < 0 ? bx - 5.5 - bSize : bx + 5.5;
    const pY = c.sy < 0 ? by - 5.5 - bSize : by + 5.5;
    const pImg = getLoadedAsset(c.primary);
    if (pImg) drawImageContain(ctx, pImg, pX, pY, bSize, bSize);

    if (config.roadLength >= 55) {
      const sImg = getLoadedAsset(c.secondary);
      const sSize = bSize * 0.85;
      if (sImg) {
        drawImageContain(
          ctx,
          sImg,
          c.sx < 0 ? bx - 5.5 - bSize - sSize - 4 : bx + 5.5 + bSize + 4,
          c.sy < 0 ? by - 5.5 - sSize : by + 5.5,
          sSize,
          sSize
        );
      }

      const tLabelOffset = c.label ? 4.8 : 0;
      const tImg = getLoadedAsset(c.tertiary);
      if (tImg) {
        drawImageContain(
          ctx,
          tImg,
          c.sx < 0 ? bx - 5.5 - sSize : bx + 5.5,
          c.sy < 0 ? by - 5.5 - bSize - sSize - 4 - tLabelOffset : by + 5.5 + bSize + 4 + tLabelOffset,
          sSize,
          sSize
        );
      }
    }

    // Landmark caption badge inside the corner plot
    if (c.label) {
      ctx.save();
      ctx.font = '600 2.05px "Plus Jakarta Sans", Inter, sans-serif';
      const labelW = ctx.measureText(c.label).width + 2.8;
      const labelH = 3.6;
      const lx = c.sx < 0 ? pX + bSize - labelW : pX;
      const ly = c.sy < 0 ? pY - labelH - 0.8 : pY + bSize + 0.8;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.beginPath();
      ctx.roundRect(lx, ly, labelW, labelH, 0.9);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.label, lx + 1.4, ly + labelH / 2 + 0.1);
      ctx.restore();
    }

    const planterImg = getLoadedAsset('/assets/infra/city/planter-box-long.svg');
    if (planterImg) drawRotatedImage(ctx, planterImg, bx + c.sx * 1.4, by + c.sy * 20, 9, 2.4, Math.PI / 2);

    // Streetlights & bus shelter along sidewalks
    const lampImg = getLoadedAsset('/assets/infra/city/streetlight-top.svg');
    if (lampImg) {
      drawRotatedImage(ctx, lampImg, bx + c.sx * -1.4, by + c.sy * 16, 2.8, 1.4, Math.PI / 2);
      ctx.drawImage(lampImg, bx + c.sx * 16 - 1.4, by + c.sy * -1.4 - 0.7, 2.8, 1.4);
    }
    if (config.roadLength >= 65 && (c.sx * c.sy > 0 || envKey === 'laswi-bandung')) {
      const shelterImg = getLoadedAsset('/assets/infra/city/bus-shelter-top.svg');
      if (shelterImg) {
        drawRotatedImage(ctx, shelterImg, bx + c.sx * -1.6, by + c.sy * 28, 6.4, 2.8, Math.PI / 2);
      }
    }

    const treeImg = getLoadedAsset(c.sx * c.sy > 0 || c.denseTrees ? '/assets/infra/tree-architectural-1.svg' : '/assets/infra/city/tree-palm-top.svg');
    const altTreeImg = getLoadedAsset('/assets/infra/tree-architectural-2.svg');
    if (treeImg) {
      const tSize = 4.8;
      ctx.drawImage(treeImg, bx + c.sx * 1.3 - tSize / 2, by + c.sy * 10 - tSize / 2, tSize, tSize);
      ctx.drawImage(treeImg, bx + c.sx * 10 - tSize / 2, by + c.sy * 1.3 - tSize / 2, tSize, tSize);
      if (altTreeImg) {
        ctx.drawImage(altTreeImg, bx + c.sx * 1.3 - tSize / 2, by + c.sy * 24 - tSize / 2, tSize, tSize);
        if (c.denseTrees) {
          ctx.drawImage(altTreeImg, bx + c.sx * 24 - tSize / 2, by + c.sy * 1.3 - tSize / 2, tSize, tSize);
        }
      }
      if (config.roadLength >= 90) {
        ctx.drawImage(treeImg, bx + c.sx * 1.3 - tSize / 2, by + c.sy * 38 - tSize / 2, tSize, tSize);
        ctx.drawImage(treeImg, bx + c.sx * 38 - tSize / 2, by + c.sy * 1.3 - tSize / 2, tSize, tSize);
      }
    }
  }

  // Warm charcoal asphalt & curbs
  const filletR = 2.2;
  ctx.fillStyle = '#373D47';
  ctx.fillRect(-halfRoad, -armLen, halfRoad * 2, armLen * 2);
  ctx.fillRect(-armLen, -halfRoad, armLen * 2, halfRoad * 2);

  // Rounded corner fillets so turning heavy vehicles don't clip sharp 90-degree corners
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(sx * halfRoad, sy * halfRoad);
      ctx.lineTo(sx * halfRoad, sy * (halfRoad + filletR));
      ctx.arcTo(sx * halfRoad, sy * halfRoad, sx * (halfRoad + filletR), sy * halfRoad, filletR);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.fillStyle = '#2F353E';
  ctx.fillRect(-halfRoad, -halfRoad, halfRoad * 2, halfRoad * 2);

  // Indonesian black-and-white kanstin curbs along road edges
  const strokeCurbPaths = () => {
    ctx.beginPath();
    for (const sx of [-1, 1] as const) {
      for (const sy of [-1, 1] as const) {
        ctx.moveTo(sx * (halfRoad + 0.18), sy * armLen);
        ctx.lineTo(sx * (halfRoad + 0.18), sy * (halfRoad + filletR));
        ctx.arcTo(sx * (halfRoad + 0.18), sy * (halfRoad + 0.18), sx * (halfRoad + filletR), sy * (halfRoad + 0.18), filletR);
        ctx.lineTo(sx * armLen, sy * (halfRoad + 0.18));
      }
    }
    ctx.stroke();
  };
  ctx.lineWidth = 0.42;
  ctx.strokeStyle = '#F8FAFC';
  strokeCurbPaths();
  ctx.strokeStyle = '#1E293B';
  ctx.setLineDash([1.5, 1.5]);
  strokeCurbPaths();
  ctx.setLineDash([]);

  // Center median: physical planted island when hasMedian is true, otherwise double yellow lines
  if (config.hasMedian) {
    const medianStart = halfBox + 0.8;
    const medianLen = Math.max(0, armLen - medianStart);
    if (medianLen > 0) {
      const drawMedianArm = (rot: number) => {
        ctx.save();
        ctx.rotate(rot);
        ctx.fillStyle = '#CBD5E1';
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.roundRect(-0.38, medianStart, 0.76, medianLen, 0.38);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#22C55E';
        ctx.beginPath();
        ctx.roundRect(-0.2, medianStart + 0.4, 0.4, Math.max(0, medianLen - 0.8), 0.2);
        ctx.fill();

        for (let d = medianStart + 2.0; d < armLen - 1.5; d += 3.8) {
          ctx.fillStyle = '#15803D';
          ctx.beginPath();
          ctx.arc(0, d, 0.32, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#86EFAC';
          ctx.beginPath();
          ctx.arc(-0.08, d - 0.08, 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };
      for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        drawMedianArm(rot);
      }
    }
  } else {
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
  }

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

  // Kotak Khusus Sepeda Motor / RHK (4.5m red-tinted pocket behind stop line)
  if (config.motorBoxEnabled) {
    const rhkDepth = 4.5;
    const innerMargin = config.hasMedian ? 0.50 : 0.12;
    for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      ctx.save();
      ctx.rotate(rot);
      const rx = -halfRoad + 0.12;
      const ry = halfBox + 0.45;
      const rw = Math.max(0.5, halfRoad - 0.12 - innerMargin);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.26)';
      ctx.fillRect(rx, ry, rw, rhkDepth);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 0.16;
      ctx.strokeRect(rx, ry, rw, rhkDepth);

      // Subtle motorcycle stencil + RHK label
      const cxBox = rx + rw / 2;
      const cyBox = ry + rhkDepth / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillRect(cxBox - 0.35, cyBox - 0.85, 0.7, 0.22); // handlebar
      ctx.fillRect(cxBox - 0.12, cyBox - 0.85, 0.24, 1.15); // body
      ctx.font = '700 1.05px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RHK', cxBox, cyBox + 1.05);
      ctx.restore();
    }
  }

  // Left Turn On Red (Belok Kiri Langsung / LTOR) indicator near outer left curb
  if (config.leftTurnOnRed) {
    for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      ctx.save();
      ctx.rotate(rot);
      const lx = -halfRoad - 1.45;
      const ly = halfBox + 8.8;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.roundRect(lx - 1.15, ly - 1.4, 2.3, 2.8, 0.45);
      ctx.fill();
      ctx.stroke();

      // Curved left-turn arrow
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 0.26;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lx + 0.35, ly + 0.25);
      ctx.lineTo(lx + 0.35, ly - 0.35);
      ctx.quadraticCurveTo(lx + 0.35, ly - 0.75, lx - 0.35, ly - 0.75);
      ctx.stroke();

      ctx.fillStyle = '#059669';
      ctx.beginPath();
      ctx.moveTo(lx - 0.72, ly - 0.75);
      ctx.lineTo(lx - 0.22, ly - 1.05);
      ctx.lineTo(lx - 0.22, ly - 0.45);
      ctx.closePath();
      ctx.fill();

      ctx.font = '700 0.72px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LTOR', lx, ly + 0.82);
      ctx.restore();
    }
  }

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

  // Street-name labels along all 4 road arms
  if (config.armNames) {
    const labelDist = halfBox + Math.min(config.roadLength * 0.46, 26);
    const arms: Array<{ key: 'north' | 'east' | 'south' | 'west'; x: number; y: number }> = [
      { key: 'north', x: 0, y: -labelDist },
      { key: 'south', x: 0, y: labelDist },
      { key: 'east', x: labelDist, y: 0 },
      { key: 'west', x: -labelDist, y: 0 },
    ];
    ctx.font = '600 1.55px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const a of arms) {
      const name = config.armNames[a.key];
      if (!name) continue;
      const padX = 1.1;
      const pillH = 2.6;
      const tw = ctx.measureText(name).width + padX * 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      ctx.roundRect(a.x - tw / 2, a.y - pillH / 2, tw, pillH, 0.7);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.fillText(name, a.x, a.y + 0.08);
    }
  }

  ctx.restore();
  ctx.restore();
}
