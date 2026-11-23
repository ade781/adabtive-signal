import { MapBehavioralContext, resolveMapContext } from '../engine/mapContextAI';
import { CompiledTopology } from '../engine/topologyTypes';
import { SimConfig } from '../engine/types';
import { getLoadedAsset } from './assetLoader';
import { computeViewport } from './viewport';

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

function drawYellowBoxMarking(ctx: CanvasRenderingContext2D, halfW: number, halfH: number): void {
  const inset = 0.6;
  const x0 = -halfW + inset;
  const y0 = -halfH + inset;
  const w = Math.max(2, (halfW - inset) * 2);
  const h = Math.max(2, (halfH - inset) * 2);

  ctx.save();
  ctx.fillStyle = 'rgba(250, 204, 21, 0.11)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.78)';
  ctx.lineWidth = 0.24;
  ctx.strokeRect(x0, y0, w, h);

  // Diagonal criss-cross yellow box lines
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + w, y0 + h);
  ctx.moveTo(x0 + w, y0);
  ctx.lineTo(x0, y0 + h);
  ctx.stroke();
  ctx.restore();
}

function drawLaneArrowLocal(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, mode: 'straight' | 'left' | 'right'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
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
  if (mode !== 'straight') {
    const s = mode === 'left' ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(s * 0.18, 0.2);
    ctx.lineTo(s * 0.75, 0.2);
    ctx.lineTo(s * 0.75, 0.48);
    ctx.lineTo(s * 1.25, 0.05);
    ctx.lineTo(s * 0.75, -0.38);
    ctx.lineTo(s * 0.75, -0.1);
    ctx.lineTo(s * 0.18, -0.1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Renders any arbitrary N-arm, angled, asymmetric IntersectionTopology (with slip lanes,
 * triangular splitter islands, physical medians, U-turn bays, RHK pockets, and Yellow Box).
 * Shared by both Simulator view (when customTopology is active) and the Draw workspace!
 */
function drawCustomTopologyEnvironment(
  ctx: CanvasRenderingContext2D,
  compiled: CompiledTopology
): void {
  const cwArms = [...compiled.armOrder]
    .map((id) => compiled.armsById[id])
    .sort((a, b) => a.angleRad - b.angleRad);
  const n = cwArms.length;
  if (n < 3) return;

  // 1. Subtle sector lawns & roadside trees between adjacent arms
  const treeAsset1 = getLoadedAsset('/assets/infra/tree-architectural-1.svg');
  const treeAsset2 = getLoadedAsset('/assets/infra/tree-architectural-2.svg');
  const palmAsset = getLoadedAsset('/assets/infra/city/tree-palm-top.svg');

  const fallbackAssets = [
    '/assets/infra/city/building-roof-1.svg',
    '/assets/infra/city/building-commercial-mall.svg',
    '/assets/infra/city/park-plaza.svg',
    '/assets/infra/city/landmark-ruko-row.svg',
    '/assets/infra/city/building-terrace-green.svg',
  ];

  for (let i = 0; i < n; i++) {
    const a = cwArms[i];
    const b = cwArms[(i + 1) % n];
    let diff = b.angleRad - a.angleRad;
    if (diff <= 0) diff += Math.PI * 2;
    const midAngle = a.angleRad + diff * 0.5;
    const ux = Math.cos(midAngle);
    const uy = Math.sin(midAngle);

    // Safe radial distance outside junction box & any slip lane
    const maxW = Math.max(a.inWidth + a.outWidth, b.inWidth + b.outWidth);
    const minDist = Math.max(a.setback, b.setback) + maxW + 18;

    // Roadside trees along sector bisector & flanks
    const treeOffsets = [minDist - 5, minDist + 22, minDist + 46];
    for (let tIdx = 0; tIdx < treeOffsets.length; tIdx++) {
      const r = treeOffsets[tIdx];
      const tx = ux * r + (tIdx % 2 === 0 ? -uy : uy) * 6;
      const ty = uy * r + (tIdx % 2 === 0 ? ux : -ux) * 6;
      const tImg = tIdx === 1 ? palmAsset : tIdx % 2 === 0 ? treeAsset1 : treeAsset2;
      if (tImg) {
        drawRotatedImage(ctx, tImg, tx, ty, 6.2, 6.2, midAngle);
      }
    }

    // If topology doesn't specify explicit landmarks (e.g. Draw custom maps, 3-arm, 5-arm), render clean sector buildings
    if (!compiled.topology.landmarks || compiled.topology.landmarks.length === 0) {
      const bx = ux * (minDist + 10);
      const by = uy * (minDist + 10);
      const img = getLoadedAsset(fallbackAssets[i % fallbackAssets.length]);
      if (img) {
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(midAngle + Math.PI * 0.25);
        ctx.fillStyle = '#D7D2C7';
        ctx.strokeStyle = '#B8B0A0';
        ctx.lineWidth = 0.28;
        ctx.beginPath();
        ctx.roundRect(-12, -9, 24, 18, 1.4);
        ctx.fill();
        ctx.stroke();
        drawImageContain(ctx, img, -10.5, -7.5, 21, 15);
        ctx.restore();
      }
    }
  }

  // 2. Render explicit real-world landmarks (e.g. Terminal Giwangan, SPBU, Pos Brimob, Ruko)
  const landmarks = compiled.topology.landmarks ?? [];
  for (const lm of landmarks) {
    const img = getLoadedAsset(lm.assetKey);
    ctx.save();
    ctx.translate(lm.x, lm.y);
    ctx.rotate(lm.rotationRad || 0);

    // Paved compound apron
    ctx.fillStyle = '#D7D2C7';
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 0.28;
    ctx.beginPath();
    ctx.roundRect(-lm.width * 0.56, -lm.height * 0.58, lm.width * 1.12, lm.height * 1.16, 1.4);
    ctx.fill();
    ctx.stroke();

    if (img) {
      drawImageContain(ctx, img, -lm.width * 0.5, -lm.height * 0.5, lm.width, lm.height);
    }

    if (lm.label) {
      ctx.rotate(-(lm.rotationRad || 0));
      ctx.font = '600 1.45px "Inter", system-ui, sans-serif';
      const tw = ctx.measureText(lm.label).width + 2.0;
      const ly = lm.height * 0.58 + 1.9;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.beginPath();
      ctx.roundRect(-tw / 2, ly - 1.1, tw, 2.2, 0.55);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lm.label, 0, ly + 0.05);
    }
    ctx.restore();
  }
}

function getCautionZoneLabel(envId: string): string {
  if (envId === 'bondowoso-malang') return 'ZONA KAMPUS';
  if (envId === 'lamper-semarang') return 'ZONA RS';
  return 'ZONA TERTIB';
}

function drawUprightLocalText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  parentAngleRad: number,
  color: string,
  font: string
): void {
  let norm = parentAngleRad % (Math.PI * 2);
  if (norm > Math.PI) norm -= Math.PI * 2;
  if (norm <= -Math.PI) norm += Math.PI * 2;
  const flip = norm > Math.PI / 2 || norm <= -Math.PI / 2;

  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

interface ArmContextMarkingParams {
  armId: string;
  armAngleRad: number;
  stopX: number;
  armEnd: number;
  curbY: number;
  curbFlare?: number;
  slipSetback: number;
  mapCtx: MapBehavioralContext;
}

/**
 * Ide #13: Renders subtle Indonesian map-aware architectural markings in arm-local coordinates
 * (+X = outward upstream from stop line, +Y = outer left LHT curb & sidewalk).
 * Shared cleanly by both standard 4-arm and custom N-arm topology renderers.
 */
function drawArmContextMarkings(ctx: CanvasRenderingContext2D, p: ArmContextMarkingParams): void {
  const { armId, armAngleRad, stopX, armEnd, curbY, curbFlare = 0, slipSetback, mapCtx } = p;
  if (mapCtx.id === 'default') return;

  const hasBusBay = mapCtx.busBayArms.includes(armId);
  const hasCaution = mapCtx.cautionArms.includes(armId);
  const hasMarket = mapCtx.marketArms.includes(armId);
  if (!hasBusBay && !hasCaution && !hasMarket) return;

  const safeUpstreamMin = slipSetback > 0 ? Math.max(22, slipSetback + 5) : 16;

  // 1. Bus Shelter / Terminal Bay Markings (e.g. Laswi TMB, Giwangan Terminal, Lamper Trans Semarang)
  if (hasBusBay) {
    const x0 = stopX + safeUpstreamMin;
    const x1 = Math.min(armEnd - 2.5, x0 + 18);
    if (x1 - x0 >= 7) {
      const bayDepth = 1.15;
      const taper = 1.6;
      const yOuter = curbY - 0.06;
      const yInner = curbY - bayDepth;

      ctx.save();
      // Subtle recessed indigo bay tint
      ctx.fillStyle = 'rgba(99, 102, 241, 0.16)';
      ctx.beginPath();
      ctx.moveTo(x0, yOuter);
      ctx.lineTo(x0 + taper, yInner);
      ctx.lineTo(x1 - taper, yInner);
      ctx.lineTo(x1, yOuter);
      ctx.closePath();
      ctx.fill();

      // Dashed amber inner bay boundary
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.88)';
      ctx.lineWidth = 0.22;
      ctx.setLineDash([1.25, 0.85]);
      ctx.beginPath();
      ctx.moveTo(x0, yOuter);
      ctx.lineTo(x0 + taper, yInner);
      ctx.lineTo(x1 - taper, yInner);
      ctx.lineTo(x1, yOuter);
      ctx.stroke();
      ctx.setLineDash([]);

      // Indigo accent bar directly along outer curb
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.82)';
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, yOuter - 0.04);
      ctx.lineTo(x1 - 0.5, yOuter - 0.04);
      ctx.stroke();

      drawUprightLocalText(
        ctx,
        'HALTE / BUS',
        (x0 + x1) * 0.5,
        (yInner + yOuter) * 0.5,
        armAngleRad,
        'rgba(254, 243, 199, 0.92)',
        '700 0.78px "JetBrains Mono", monospace'
      );
      ctx.restore();
    }
  }

  // 2. Market Friction Curb Edge (e.g. Sulawesi Banjarmasin Pasar Lama, Wilis)
  if (hasMarket) {
    const x0 = stopX + (slipSetback > 0 ? Math.max(20, slipSetback + 4) : 12);
    const x1 = Math.min(armEnd - 2.5, x0 + 24);
    if (x1 - x0 >= 6) {
      ctx.save();
      // Subtle terracotta asphalt edge wash
      ctx.fillStyle = 'rgba(194, 65, 12, 0.16)';
      ctx.fillRect(x0, curbY - 0.58, x1 - x0, 0.52);

      // Terracotta dashed curb-edge line
      ctx.strokeStyle = 'rgba(234, 88, 12, 0.84)';
      ctx.lineWidth = 0.2;
      ctx.setLineDash([1.15, 0.85]);
      ctx.beginPath();
      ctx.moveTo(x0, curbY - 0.56);
      ctx.lineTo(x1, curbY - 0.56);
      ctx.stroke();

      // Secondary warm amber guide near curb
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
      ctx.lineWidth = 0.12;
      ctx.setLineDash([0.65, 0.95]);
      ctx.beginPath();
      ctx.moveTo(x0 + 0.4, curbY - 0.14);
      ctx.lineTo(x1 - 0.4, curbY - 0.14);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // 3. Campus / Hospital / Enforcement Caution Sidewalk Border Accent
  if (hasCaution) {
    const x0 = stopX + (slipSetback > 0 ? Math.max(22, slipSetback + 5) : 14);
    const x1 = Math.min(armEnd - 2.5, x0 + 18);
    if (x1 - x0 >= 6) {
      const bandY = curbY + curbFlare * 0.55 + 0.46;
      const bandH = 0.74;
      const label = getCautionZoneLabel(mapCtx.id);

      ctx.save();
      // Subtle base tint on sidewalk border
      ctx.fillStyle = 'rgba(15, 23, 42, 0.06)';
      ctx.fillRect(x0, bandY, x1 - x0, bandH);

      // Twin alternating diagonal amber & emerald caution stripes
      ctx.lineWidth = 0.22;
      let stripeIdx = 0;
      for (let sx = x0 + 0.4; sx < x1 - 0.6; sx += 1.5) {
        ctx.strokeStyle =
          stripeIdx % 2 === 0 ? 'rgba(245, 158, 11, 0.82)' : 'rgba(16, 185, 129, 0.82)';
        ctx.beginPath();
        ctx.moveTo(sx, bandY + bandH);
        ctx.lineTo(sx + 0.62, bandY);
        ctx.stroke();
        stripeIdx++;
      }

      // Crisp architectural hairline borders
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.lineWidth = 0.09;
      ctx.strokeRect(x0, bandY, x1 - x0, bandH);

      // Clean micro-text badge on outer sidewalk edge
      const cx = (x0 + x1) * 0.5;
      const cy = bandY + bandH + 0.82;
      ctx.font = '700 0.74px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width + 1.1;
      const th = 1.25;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle =
        mapCtx.id === 'bondowoso-malang'
          ? 'rgba(16, 185, 129, 0.72)'
          : mapCtx.id === 'lamper-semarang'
            ? 'rgba(245, 158, 11, 0.78)'
            : 'rgba(14, 165, 233, 0.65)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, 0.3);
      ctx.fill();
      ctx.stroke();

      drawUprightLocalText(
        ctx,
        label,
        cx,
        cy + 0.03,
        armAngleRad,
        '#0F172A',
        '700 0.74px "JetBrains Mono", monospace'
      );
      ctx.restore();
    }
  }
}

export function drawTopologyRoadWorld(
  ctx: CanvasRenderingContext2D,
  compiled: CompiledTopology,
  options: {
    showPathPreviews?: boolean;
    selectedArmId?: string | null;
    wetAsphalt?: boolean;
    mapContext?: MapBehavioralContext;
  } = {}
): void {
  const asphaltMain = options.wetAsphalt ? '#282E38' : '#373D47';
  const asphaltCenter = options.wetAsphalt ? '#222730' : '#2F353E';
  const mapCtx =
    options.mapContext ??
    resolveMapContext({
      environmentId: compiled.topology.id,
      scenarioName: compiled.topology.name,
    });

  // 0. Sector environment & real-world landmarks (Terminal Giwangan, SPBU, Brimob, Ruko, trees)
  drawCustomTopologyEnvironment(ctx, compiled);

  // 1. Sidewalk apron under arms & center
  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const inOuter = arm.halfMedian + arm.inWidth + (arm.def.curbFlareLeft ?? 0);
    const outOuter = arm.halfMedian + arm.outWidth;
    const totalLen = arm.setback + arm.def.length + 6;
    const sidewalk = 2.6;

    ctx.save();
    ctx.rotate(arm.angleRad);
    ctx.fillStyle = '#CFCBC2';
    ctx.fillRect(0, -(outOuter + sidewalk), totalLen, outOuter + inOuter + sidewalk * 2);
    ctx.restore();
  }

  // 2. Slip-lane sidewalk apron + integrated asphalt channel polygon (drawn BEFORE main asphalt so it merges seamlessly!)
  for (const isl of compiled.islands) {
    if (isl.outerBoundaryPts.length >= 6) {
      ctx.save();
      ctx.fillStyle = '#CFCBC2';
      ctx.strokeStyle = '#CFCBC2';
      ctx.lineWidth = 4.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      isl.outerBoundaryPts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fill();

      ctx.fillStyle = asphaltMain;
      ctx.beginPath();
      isl.outerBoundaryPts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (isl.slipLaneCenterPts.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#CFCBC2';
      ctx.lineWidth = isl.slipLaneWidth + 1.4;
      ctx.beginPath();
      isl.slipLaneCenterPts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.strokeStyle = asphaltMain;
      ctx.lineWidth = isl.slipLaneWidth;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 3. Center junction polygon asphalt
  if (compiled.centerPolygon.length >= 3) {
    ctx.save();
    ctx.fillStyle = asphaltCenter;
    ctx.beginPath();
    compiled.centerPolygon.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 4. Arm asphalt, kanstin curbs, flared approaches, medians, lane markings, stop lines, RHK, arrows
  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const isSelected = options.selectedArmId === armId;
    const inOuter = arm.halfMedian + arm.inWidth;
    const flare = arm.def.curbFlareLeft ?? 0;
    const outOuter = arm.halfMedian + arm.outWidth;
    const armEnd = arm.setback + arm.def.length;

    ctx.save();
    // Local arm frame: +X points OUTWARD from intersection center along outDir.
    // +Y points along ( -outDir.y, outDir.x )? Wait: check rotation!
    // rotate(angleRad) maps local (1,0) -> (cos a, sin a) = outDir
    // maps local (0,1) -> (-sin a, cos a) = (inDir.y, -inDir.x) = inLeftNormal!!
    // VERIFIED: local +Y === inLeftNormal (inbound lanes on +Y, outbound lanes on -Y!)
    ctx.rotate(arm.angleRad);

    // Main carriageway polygon (including optional curb flare near stop line on +Y inbound side)
    ctx.fillStyle = asphaltMain;
    ctx.beginPath();
    ctx.moveTo(arm.setback - 0.5, -outOuter);
    ctx.lineTo(armEnd, -outOuter);
    ctx.lineTo(armEnd, inOuter);
    if (flare > 0.05) {
      const flareStart = Math.min(armEnd - 4, arm.setback + 24);
      ctx.lineTo(flareStart, inOuter);
      ctx.lineTo(arm.setback + 4, inOuter + flare);
      ctx.lineTo(arm.setback - 0.5, inOuter + flare);
    } else {
      ctx.lineTo(arm.setback - 0.5, inOuter);
    }
    ctx.closePath();
    ctx.fill();

    // Selection highlight in Draw mode
    if (isSelected) {
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = 0.45;
      ctx.stroke();
    }

    // Black-and-white Indonesian kanstin curbs
    const drawCurb = () => {
      ctx.beginPath();
      ctx.moveTo(arm.setback, -outOuter - 0.16);
      ctx.lineTo(armEnd, -outOuter - 0.16);
      ctx.moveTo(armEnd, inOuter + 0.16);
      if (flare > 0.05) {
        const flareStart = Math.min(armEnd - 4, arm.setback + 24);
        ctx.lineTo(flareStart, inOuter + 0.16);
        ctx.lineTo(arm.setback + 4, inOuter + flare + 0.16);
        ctx.lineTo(arm.setback, inOuter + flare + 0.16);
      } else {
        ctx.lineTo(arm.setback, inOuter + 0.16);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 0.38;
    ctx.strokeStyle = '#F8FAFC';
    drawCurb();
    ctx.strokeStyle = '#1E293B';
    ctx.setLineDash([1.5, 1.5]);
    drawCurb();
    ctx.setLineDash([]);

    // Physical center median OR dashed/double yellow centerline (dashed when no median -> signals oncoming pass allowed!)
    const medianStart = arm.setback + 0.8;
    const medianLen = Math.max(0, armEnd - medianStart);
    const uTurnBay = arm.def.uTurnBay;
    if (arm.def.medianWidth > 0.05 && medianLen > 0) {
      const mW = Math.max(0.55, arm.def.medianWidth);
      const drawMedianSeg = (x0: number, len: number) => {
        if (len <= 0.8) return;
        ctx.fillStyle = '#CBD5E1';
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.roundRect(x0, -mW / 2, len, mW, Math.min(0.45, mW / 2));
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#22C55E';
        ctx.beginPath();
        ctx.roundRect(x0 + 0.35, -(mW * 0.56) / 2, Math.max(0.2, len - 0.7), mW * 0.56, Math.min(0.28, mW * 0.28));
        ctx.fill();

        for (let d = x0 + 2.2; d < x0 + len - 1.5; d += 4.2) {
          ctx.fillStyle = '#15803D';
          ctx.beginPath();
          ctx.arc(d, 0, Math.min(0.42, mW * 0.28), 0, Math.PI * 2);
          ctx.fill();
        }
      };

      if (uTurnBay?.enabled) {
        const bayX = arm.setback + uTurnBay.distanceBeforeStop;
        const gapHalf = 4.2;
        drawMedianSeg(medianStart, Math.max(0, bayX - gapHalf - medianStart));
        drawMedianSeg(bayX + gapHalf, Math.max(0, armEnd - (bayX + gapHalf)));
        // U-turn bay subtle pavement cue
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
        ctx.lineWidth = 0.16;
        ctx.setLineDash([0.8, 0.7]);
        ctx.beginPath();
        ctx.moveTo(bayX - gapHalf, 0);
        ctx.lineTo(bayX + gapHalf, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        drawMedianSeg(medianStart, medianLen);
      }
    } else {
      // No physical median: solid double yellow near stop line (no-pass zone 28m), dashed yellow upstream (passing zone!)
      const noPassEnd = Math.min(armEnd, arm.setback + 28);
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      ctx.moveTo(arm.setback, -0.16);
      ctx.lineTo(noPassEnd, -0.16);
      ctx.moveTo(arm.setback, 0.16);
      ctx.lineTo(noPassEnd, 0.16);
      ctx.stroke();

      if (armEnd > noPassEnd) {
        ctx.setLineDash([2.4, 2.2]);
        ctx.beginPath();
        ctx.moveTo(noPassEnd, 0);
        ctx.lineTo(armEnd, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Dashed lane dividers for inbound (+Y) and outbound (-Y)
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.58)';
    ctx.lineWidth = 0.16;
    ctx.setLineDash([1.6, 1.8]);
    ctx.beginPath();
    let curIn = arm.halfMedian;
    for (let l = 0; l < arm.def.inLanes - 1; l++) {
      curIn += arm.def.inLaneWidths[l];
      ctx.moveTo(arm.setback, curIn);
      ctx.lineTo(armEnd, curIn);
    }
    let curOut = arm.halfMedian;
    for (let l = 0; l < arm.def.outLanes - 1; l++) {
      curOut += arm.def.outLaneWidths[l];
      ctx.moveTo(arm.setback, -curOut);
      ctx.lineTo(armEnd, -curOut);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Solid white Stop Line (inbound side +Y only — NO ZEBRA CROSS!)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(arm.setback, arm.halfMedian, 0.48, arm.inWidth + flare);

    // Emerald Exit Counting Line (outbound side -Y)
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
    ctx.lineWidth = 0.24;
    ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath();
    ctx.moveTo(arm.setback, -arm.halfMedian);
    ctx.lineTo(arm.setback, -outOuter);
    ctx.stroke();
    ctx.setLineDash([]);

    // RHK Motor Box behind stop line
    if (arm.def.motorBoxEnabled) {
      const rhkDepth = 4.4;
      const rx = arm.setback + 0.5;
      const ry = arm.halfMedian + 0.14;
      const rw = Math.max(0.5, arm.inWidth - 0.28);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.26)';
      ctx.fillRect(rx, ry, rhkDepth, rw);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.lineWidth = 0.15;
      ctx.strokeRect(rx, ry, rhkDepth, rw);

      ctx.save();
      ctx.translate(rx + rhkDepth / 2, ry + rw / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.font = '700 1.05px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RHK', 0, 0);
      ctx.restore();
    }

    // LHT Lane Arrows on inbound lanes
    ctx.fillStyle = 'rgba(248, 250, 252, 0.42)';
    for (let l = 0; l < arm.def.inLanes; l++) {
      const yOff = arm.inLaneCenters[l];
      const mode: 'straight' | 'left' | 'right' =
        arm.def.inLanes === 1
          ? 'straight'
          : l === arm.def.inLanes - 1
          ? 'left'
          : l === 0
          ? 'right'
          : 'straight';
      // Local inbound travel direction is -X (rot = -PI/2 maps arrow -Y to -X!)
      drawLaneArrowLocal(ctx, arm.setback + 6.5, yOff, -Math.PI / 2, mode);
    }

    // Per-arm LTOR / SLIP indicator badge on outer left side (clear of slip channel!)
    if (arm.def.leftTurnOnRed || arm.def.slipLane?.enabled) {
      const lx = arm.setback + 9.2;
      const slipExtra = arm.def.slipLane?.enabled ? arm.def.slipLane.width + 2.4 : 0;
      const ly = inOuter + flare + 1.5 + slipExtra;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.roundRect(lx - 1.3, ly - 0.9, 2.6, 1.8, 0.35);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(-arm.angleRad);
      ctx.fillStyle = '#047857';
      ctx.font = '700 0.72px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arm.def.slipLane?.enabled ? 'SLIP' : 'LTOR', 0, 0);
      ctx.restore();
    }

    // Ide #13: Map-aware Bus Bay, Caution Zone & Market Edge architectural markings
    drawArmContextMarkings(ctx, {
      armId,
      armAngleRad: arm.angleRad,
      stopX: arm.setback,
      armEnd,
      curbY: inOuter,
      curbFlare: flare,
      slipSetback: arm.def.slipLane?.enabled ? arm.def.slipLane.islandSetback : 0,
      mapCtx,
    });

    ctx.restore();
  }

  // 5. Slip-Lane Channelization Separators: Full Triangular Island, Compact Curb Divider (Giwangan West!), or Painted Gore
  for (const isl of compiled.islands) {
    if (isl.slipLaneCenterPts.length >= 2) {
      // Subtle emerald LTOR slip guide dashes + arrow inside the slip channel
      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
      ctx.lineWidth = 0.18;
      ctx.setLineDash([1.1, 1.3]);
      ctx.beginPath();
      isl.slipLaneCenterPts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Yield dashed white line at slip-lane merge exit
      const last = isl.slipLaneCenterPts[isl.slipLaneCenterPts.length - 1];
      const prev = isl.slipLaneCenterPts[isl.slipLaneCenterPts.length - 2];
      const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
      ctx.translate(last.x, last.y);
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 0.24;
      ctx.setLineDash([0.45, 0.35]);
      ctx.beginPath();
      ctx.moveTo(0, -isl.slipLaneWidth * 0.44);
      ctx.lineTo(0, isl.slipLaneWidth * 0.44);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (isl.style === 'curb-divider' && isl.innerEdgePts.length >= 2) {
      // Compact narrow curb divider (sekat kecil pemisah belok kiri spt Simpang Giwangan Barat)
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = isl.separatorThickness;
      ctx.beginPath();
      isl.innerEdgePts.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      // Alternating dark kanstin blocks along the compact divider
      ctx.strokeStyle = '#1E293B';
      ctx.setLineDash([0.9, 0.9]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Thin yellow warning edge highlight
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
      ctx.lineWidth = 0.12;
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (isl.style === 'painted-gore' && isl.points.length >= 3) {
      // Painted chevron gore area (no physical raised island)
      ctx.save();
      ctx.fillStyle = 'rgba(250, 204, 21, 0.14)';
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.82)';
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      isl.points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      continue;
    }

    // Default: Full smooth curved triangular splitter island with kanstin & landscaped core
    if (isl.points.length < 3) continue;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#CBD5E1';
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 0.36;
    ctx.beginPath();
    isl.points.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#1E293B';
    ctx.setLineDash([1.1, 1.1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Green landscaped core inside the curved splitter island
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    isl.points.forEach((pt, idx) => {
      const sx = isl.centroid.x + (pt.x - isl.centroid.x) * 0.6;
      const sy = isl.centroid.y + (pt.y - isl.centroid.y) * 0.6;
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 6. Yellow Box Junction marking in center if enabled (adapts to centerPolygon for angled / N-arm junctions!)
  if (compiled.topology.yellowBoxEnabled && compiled.centerPolygon.length >= 3) {
    const xs = compiled.centerPolygon.map((p) => p.x);
    const ys = compiled.centerPolygon.map((p) => p.y);
    const halfW = Math.min(12, Math.max(4, (Math.max(...xs) - Math.min(...xs)) * 0.34));
    const halfH = Math.min(12, Math.max(4, (Math.max(...ys) - Math.min(...ys)) * 0.34));
    drawYellowBoxMarking(ctx, halfW, halfH);
  }

  // 7. Optional Movement Spline Previews (Draw mode!)
  if (options.showPathPreviews) {
    ctx.save();
    ctx.lineWidth = 0.22;
    for (const path of Object.values(compiled.pathsByKey)) {
      if (path.curvePoints.length < 2) continue;
      ctx.strokeStyle = path.isSlipLane
        ? 'rgba(16, 185, 129, 0.75)'
        : path.isUTurn
        ? 'rgba(245, 158, 11, 0.75)'
        : path.movement === 'straight'
        ? 'rgba(148, 163, 184, 0.38)'
        : path.movement === 'right'
        ? 'rgba(244, 63, 94, 0.35)'
        : 'rgba(56, 189, 248, 0.38)';
      ctx.setLineDash(path.isSlipLane ? [1.2, 0.8] : [0.9, 1.1]);
      ctx.beginPath();
      path.curvePoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 8. Street-name pills along each arm
  ctx.save();
  ctx.font = '600 1.6px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const armId of compiled.armOrder) {
    const arm = compiled.armsById[armId];
    const name = arm.def.label;
    if (!name) continue;
    const dist = arm.setback + Math.min(arm.def.length * 0.48, 28);
    const lx = arm.outDir.x * dist;
    const ly = arm.outDir.y * dist;
    const padX = 1.2;
    const pillH = 2.7;
    const tw = ctx.measureText(name).width + padX * 2;
    ctx.fillStyle = options.selectedArmId === armId ? '#0F172A' : 'rgba(255, 255, 255, 0.93)';
    ctx.strokeStyle = options.selectedArmId === armId ? '#0EA5E9' : '#CBD5E1';
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2, ly - pillH / 2, tw, pillH, 0.75);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = options.selectedArmId === armId ? '#FFFFFF' : '#0F172A';
    ctx.fillText(name, lx, ly + 0.06);
  }
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
  config: SimConfig,
  compiledTopology?: CompiledTopology,
  panX = 0,
  panY = 0
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#C9D3B8';
  ctx.fillRect(0, 0, width, height);

  const isCustomTopo = Boolean(config.customTopology && compiledTopology);
  const totalExtent = isCustomTopo
    ? compiledTopology!.maxExtentMeters * 2
    : (halfBox + config.roadLength) * 2;
  const vp = computeViewport(width, height, totalExtent, zoom, panX, panY);
  const { cx, cy, pxPerMeter } = vp;

  if (showGrid) {
    const gridStep = 10 * pxPerMeter;
    if (gridStep >= 8) {
      ctx.strokeStyle = 'rgba(120, 134, 107, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startX = ((cx % gridStep) + gridStep) % gridStep;
      const startY = ((cy % gridStep) + gridStep) % gridStep;
      for (let x = startX; x < width; x += gridStep) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = startY; y < height; y += gridStep) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pxPerMeter, pxPerMeter);

  const wetAsphalt = (config.environment?.weather ?? 'clear') !== 'clear';
  let mapCtx = resolveMapContext(config);
  if (mapCtx.id === 'default' && compiledTopology) {
    mapCtx = resolveMapContext({
      environmentId: compiledTopology.topology.id,
      scenarioName: compiledTopology.topology.name,
    });
  }

  // Custom / N-Arm / Asymmetric / Giwangan Topology Renderer
  if (isCustomTopo && compiledTopology) {
    // Subtle urban grass backdrop around arms
    drawTopologyRoadWorld(ctx, compiledTopology, { wetAsphalt, mapContext: mapCtx });
    ctx.restore();
    ctx.restore();
    return;
  }

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

    // Tropical grass & warm Indonesian soil plot
    ctx.fillStyle = c.isPark ? '#7FA25E' : '#94AD74';
    ctx.fillRect(rx, ry, bw, bw);

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

    const soilStrip = 2.6;
    ctx.fillStyle = '#A88F6B';
    ctx.fillRect(c.sx < 0 ? bx - soilStrip : bx, ry, soilStrip, bw);
    ctx.fillRect(rx, c.sy < 0 ? by - soilStrip : by, c.riverEdge ? Math.min(bw, riverOffset) : bw, soilStrip);

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

  // Charcoal asphalt (slightly darker when wet/raining) & curbs
  const filletR = 2.2;
  ctx.fillStyle = wetAsphalt ? '#282E38' : '#373D47';
  ctx.fillRect(-halfRoad, -armLen, halfRoad * 2, armLen * 2);
  ctx.fillRect(-armLen, -halfRoad, armLen * 2, halfRoad * 2);

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

  ctx.fillStyle = wetAsphalt ? '#222730' : '#2F353E';
  ctx.fillRect(-halfRoad, -halfRoad, halfRoad * 2, halfRoad * 2);

  // Yellow Box Junction marking (No. 8)
  if (config.yellowBoxEnabled) {
    drawYellowBoxMarking(ctx, halfRoad, halfRoad);
  }

  // Indonesian black-and-white kanstin curbs
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

  // Center median: physical planted island when hasMedian is true, otherwise yellow lines (dashed upstream to show overtaking zone!)
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
    const noPassEnd = Math.min(armLen, halfBox + 28);
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 0.22;
    const g = 0.18;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(s * g, -noPassEnd);
      ctx.lineTo(s * g, -halfBox);
      ctx.moveTo(s * g, halfBox);
      ctx.lineTo(s * g, noPassEnd);
      ctx.moveTo(-noPassEnd, s * g);
      ctx.lineTo(-halfBox, s * g);
      ctx.moveTo(halfBox, s * g);
      ctx.lineTo(noPassEnd, s * g);
    }
    ctx.stroke();

    if (armLen > noPassEnd) {
      ctx.setLineDash([2.4, 2.2]);
      ctx.beginPath();
      ctx.moveTo(0, -armLen);
      ctx.lineTo(0, -noPassEnd);
      ctx.moveTo(0, noPassEnd);
      ctx.lineTo(0, armLen);
      ctx.moveTo(-armLen, 0);
      ctx.lineTo(-noPassEnd, 0);
      ctx.moveTo(noPassEnd, 0);
      ctx.lineTo(armLen, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
      ctx.moveTo(s * off, -armLen);
      ctx.lineTo(s * off, -halfBox);
      ctx.moveTo(s * off, halfBox);
      ctx.lineTo(s * off, armLen);
      ctx.moveTo(-armLen, s * off);
      ctx.lineTo(-halfBox, s * off);
      ctx.moveTo(halfBox, s * off);
      ctx.lineTo(armLen, s * off);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Stop Lines (Zebra crosswalks removed per user specification!)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(-halfRoad, halfBox, halfRoad, 0.45);
  ctx.fillRect(0, -halfBox - 0.45, halfRoad, 0.45);
  ctx.fillRect(-halfBox - 0.45, -halfRoad, 0.45, halfRoad);
  ctx.fillRect(halfBox, 0, 0.45, halfRoad);

  // Kotak Khusus Sepeda Motor / RHK
  if (config.motorBoxEnabled) {
    const rhkDepth = 4.5;
    const innerMargin = config.hasMedian ? 0.5 : 0.12;
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

      const cxBox = rx + rw / 2;
      const cyBox = ry + rhkDepth / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillRect(cxBox - 0.35, cyBox - 0.85, 0.7, 0.22);
      ctx.fillRect(cxBox - 0.12, cyBox - 0.85, 0.24, 1.15);
      ctx.font = '700 1.05px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RHK', cxBox, cyBox + 1.05);
      ctx.restore();
    }
  }

  // LTOR indicator near outer left curb
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
  ctx.moveTo(-halfRoad, -halfBox);
  ctx.lineTo(0, -halfBox);
  ctx.moveTo(0, halfBox);
  ctx.lineTo(halfRoad, halfBox);
  ctx.moveTo(halfBox, -halfRoad);
  ctx.lineTo(halfBox, 0);
  ctx.moveTo(-halfBox, 0);
  ctx.lineTo(-halfBox, halfRoad);
  ctx.stroke();
  ctx.setLineDash([]);

  // LHT Lane Arrows
  ctx.fillStyle = 'rgba(248, 250, 252, 0.38)';
  const L = config.lanesPerDirection;
  for (let l = 0; l < L; l++) {
    const off = (l + 0.5) * lw;
    const mode: 'straight' | 'left' | 'right' = L === 1 ? 'straight' : l === L - 1 ? 'left' : l === 0 ? 'right' : 'straight';
    drawLaneArrowLocal(ctx, -off, halfBox + 6.0, 0, mode);
    drawLaneArrowLocal(ctx, off, -halfBox - 6.0, Math.PI, mode);
    drawLaneArrowLocal(ctx, -halfBox - 6.0, -off, Math.PI / 2, mode);
    drawLaneArrowLocal(ctx, halfBox + 6.0, off, -Math.PI / 2, mode);
  }

  // Ide #13: Map-aware Bus Bay, Caution Zone & Market Edge architectural markings (standard 4-arm)
  if (mapCtx.id !== 'default') {
    const stdArms: Array<{ id: 'east' | 'south' | 'west' | 'north'; angleRad: number }> = [
      { id: 'east', angleRad: 0 },
      { id: 'south', angleRad: Math.PI / 2 },
      { id: 'west', angleRad: Math.PI },
      { id: 'north', angleRad: -Math.PI / 2 },
    ];
    for (const a of stdArms) {
      ctx.save();
      ctx.rotate(a.angleRad);
      drawArmContextMarkings(ctx, {
        armId: a.id,
        armAngleRad: a.angleRad,
        stopX: halfBox,
        armEnd: armLen,
        curbY: halfRoad,
        slipSetback: 0,
        mapCtx,
      });
      ctx.restore();
    }
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
