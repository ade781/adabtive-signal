import * as THREE from 'three';

function makeSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
} {
  if (typeof document === 'undefined') return { canvas: null, ctx: null };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

function fallbackTex(r: number, g: number, b: number, a = 255): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function finalizeTex(
  canvas: HTMLCanvasElement | null,
  opts: {
    srgb?: boolean;
    repeatX?: number;
    repeatY?: number;
    wrapS?: THREE.Wrapping;
    wrapT?: THREE.Wrapping;
    anisotropy?: number;
  } = {},
  fb: [number, number, number, number] = [128, 128, 128, 255]
): THREE.Texture {
  if (!canvas) return fallbackTex(fb[0], fb[1], fb[2], fb[3]);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = opts.wrapS ?? THREE.RepeatWrapping;
  tex.wrapT = opts.wrapT ?? THREE.RepeatWrapping;
  if (opts.repeatX !== undefined && opts.repeatY !== undefined) {
    tex.repeat.set(opts.repeatX, opts.repeatY);
  }
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  tex.needsUpdate = true;
  return tex;
}

export interface AsphaltPbrSet {
  albedo: THREE.Texture;
  bump: THREE.Texture;
  roughness: THREE.Texture;
  dispose: () => void;
}

export function createWeatheredAsphaltPbr(isWet: boolean, heavyRain = false): AsphaltPbrSet {
  const size = 512;
  const rng = makeSeededRng(2026);
  const alb = makeCanvas(size, size);
  const bmp = makeCanvas(size, size);
  const rgh = makeCanvas(size, size);

  if (alb.ctx && bmp.ctx && rgh.ctx) {
    // 1. Albedo: realistic weathered Indonesian asphalt (#3A3F47 dry, darker wet)
    alb.ctx.fillStyle = isWet ? '#262B33' : '#3B414A';
    alb.ctx.fillRect(0, 0, size, size);

    // Subtle aggregate & micro-patch variation
    for (let i = 0; i < 6500; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const s = 1 + rng() * 2.2;
      const v = isWet ? 28 + Math.floor(rng() * 28) : 44 + Math.floor(rng() * 42);
      alb.ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      alb.ctx.fillRect(x, y, s, s);
    }

    // Subtle longitudinal tire wear polish streaks
    for (let i = 0; i < 16; i++) {
      const x = rng() * size;
      const w = 14 + rng() * 24;
      alb.ctx.fillStyle = isWet ? 'rgba(15,19,26,0.16)' : 'rgba(28,32,39,0.12)';
      alb.ctx.fillRect(x, 0, w, size);
    }

    // 2. Bump Map: fine mineral aggregate grain
    bmp.ctx.fillStyle = 'rgb(128,128,128)';
    bmp.ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 7000; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const g = 90 + Math.floor(rng() * 85);
      bmp.ctx.fillStyle = `rgb(${g},${g},${g})`;
      bmp.ctx.fillRect(x, y, 1.5 + rng() * 1.5, 1.5 + rng() * 1.5);
    }

    // 3. Roughness Map: dry high roughness (~0.88), wet puddle mask (0.10 glossy puddles)
    rgh.ctx.fillStyle = isWet ? 'rgb(112,112,112)' : 'rgb(224,224,224)';
    rgh.ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 1800; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const v = isWet ? 85 + Math.floor(rng() * 55) : 200 + Math.floor(rng() * 45);
      rgh.ctx.fillStyle = `rgb(${v},${v},${v})`;
      rgh.ctx.fillRect(x, y, 2, 2);
    }

    if (isWet) {
      const puddleCount = heavyRain ? 18 : 9;
      for (let i = 0; i < puddleCount; i++) {
        const cx = rng() * size;
        const cy = rng() * size;
        const rx = 28 + rng() * (heavyRain ? 58 : 38);
        const ry = 22 + rng() * (heavyRain ? 46 : 30);
        const grad = rgh.ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.max(rx, ry));
        grad.addColorStop(0.0, 'rgba(18,18,18,0.95)'); // Glossy water puddle!
        grad.addColorStop(0.6, 'rgba(34,34,34,0.85)');
        grad.addColorStop(1.0, 'rgba(112,112,112,0.0)');
        rgh.ctx.fillStyle = grad;
        rgh.ctx.beginPath();
        rgh.ctx.ellipse(cx, cy, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
        rgh.ctx.fill();
      }
    }
  }

  const albedo = finalizeTex(alb.canvas, { srgb: true, repeatX: 0.14, repeatY: 0.14 }, [59, 65, 74, 255]);
  const bump = finalizeTex(bmp.canvas, { srgb: false, repeatX: 0.14, repeatY: 0.14 }, [128, 128, 128, 255]);
  const roughness = finalizeTex(rgh.canvas, { srgb: false, repeatX: 0.14, repeatY: 0.14 }, [210, 210, 210, 255]);

  return {
    albedo,
    bump,
    roughness,
    dispose: () => {
      albedo.dispose();
      bump.dispose();
      roughness.dispose();
    },
  };
}

export function createKonblokPbr(): { albedo: THREE.Texture; bump: THREE.Texture; dispose: () => void } {
  const size = 256;
  const alb = makeCanvas(size, size);
  const bmp = makeCanvas(size, size);
  if (alb.ctx && bmp.ctx) {
    alb.ctx.fillStyle = '#CFCBC2';
    alb.ctx.fillRect(0, 0, size, size);
    bmp.ctx.fillStyle = '#EAEAEA';
    bmp.ctx.fillRect(0, 0, size, size);

    const rng = makeSeededRng(77);
    const rows = 8;
    const cols = 4;
    const cellH = size / rows;
    const cellW = size / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (cellW * 0.5);
      for (let c = -1; c <= cols; c++) {
        const x = c * cellW + offset;
        const y = r * cellH;
        const tone = 198 + Math.floor(rng() * 18);
        alb.ctx.fillStyle = `rgb(${tone},${tone - 3},${tone - 9})`;
        alb.ctx.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
        bmp.ctx.fillStyle = '#FFFFFF';
        bmp.ctx.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
      }
    }
    alb.ctx.strokeStyle = 'rgba(100,95,88,0.32)';
    alb.ctx.lineWidth = 2;
    bmp.ctx.strokeStyle = '#606060';
    bmp.ctx.lineWidth = 3;
    for (let r = 0; r <= rows; r++) {
      const y = r * cellH;
      alb.ctx.beginPath();
      alb.ctx.moveTo(0, y);
      alb.ctx.lineTo(size, y);
      alb.ctx.stroke();
      bmp.ctx.beginPath();
      bmp.ctx.moveTo(0, y);
      bmp.ctx.lineTo(size, y);
      bmp.ctx.stroke();
    }
  }
  const albedo = finalizeTex(alb.canvas, { srgb: true, repeatX: 0.45, repeatY: 0.45 }, [207, 203, 194, 255]);
  const bump = finalizeTex(bmp.canvas, { srgb: false, repeatX: 0.45, repeatY: 0.45 }, [200, 200, 200, 255]);
  return {
    albedo,
    bump,
    dispose: () => {
      albedo.dispose();
      bump.dispose();
    },
  };
}

export function createKanstinTexture(): THREE.Texture {
  const c = makeCanvas(256, 32);
  if (c.ctx) {
    c.ctx.fillStyle = '#F8FAFC';
    c.ctx.fillRect(0, 0, 128, 32);
    c.ctx.fillStyle = '#1E293B';
    c.ctx.fillRect(128, 0, 128, 32);
    c.ctx.fillStyle = 'rgba(15,23,42,0.22)';
    c.ctx.fillRect(0, 26, 256, 6);
    c.ctx.fillRect(126, 0, 3, 32);
  }
  return finalizeTex(
    c.canvas,
    { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping },
    [248, 250, 252, 255]
  );
}

export function createDashedLineTexture(color: string, dashRatio: number): THREE.Texture {
  const c = makeCanvas(128, 16);
  if (c.ctx) {
    c.ctx.clearRect(0, 0, 128, 16);
    c.ctx.fillStyle = color;
    c.ctx.fillRect(0, 0, Math.max(4, Math.round(128 * dashRatio)), 16);
  }
  return finalizeTex(
    c.canvas,
    { srgb: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping },
    [255, 255, 255, 255]
  );
}

export type FacadeStyle = 'ruko' | 'glass-tower' | 'institutional' | 'market';

export interface FacadePbrSet {
  albedo: THREE.Texture;
  emissive: THREE.Texture;
  roughness: THREE.Texture;
  dispose: () => void;
}

export function createIndonesianFacadePbr(style: FacadeStyle): FacadePbrSet {
  const w = 512;
  const h = 512;
  const rng = makeSeededRng(style.length * 911 + 42);
  const alb = makeCanvas(w, h);
  const emi = makeCanvas(w, h);
  const rgh = makeCanvas(w, h);

  if (alb.ctx && emi.ctx && rgh.ctx) {
    emi.ctx.fillStyle = '#000000';
    emi.ctx.fillRect(0, 0, w, h);

    if (style === 'glass-tower') {
      alb.ctx.fillStyle = '#334155';
      alb.ctx.fillRect(0, 0, w, h);
      rgh.ctx.fillStyle = '#94A3B8';
      rgh.ctx.fillRect(0, 0, w, h);

      const cols = 8;
      const rows = 10;
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw + 4;
          const y = r * rh + 4;
          const ww = cw - 8;
          const wh = rh - 10;
          alb.ctx.fillStyle = r === rows - 1 ? '#1E293B' : '#38BDF8';
          alb.ctx.fillRect(x, y, ww, wh);
          alb.ctx.fillStyle = 'rgba(15,23,42,0.45)';
          alb.ctx.fillRect(x, y, ww, wh * 0.45);
          rgh.ctx.fillStyle = '#181818'; // glossy curtain wall glass
          rgh.ctx.fillRect(x, y, ww, wh);
          if (rng() < 0.42) {
            emi.ctx.fillStyle = rng() < 0.7 ? '#FEF08A' : '#BAE6FD';
            emi.ctx.fillRect(x + 2, y + 2, ww - 4, wh - 4);
          }
        }
      }
    } else if (style === 'ruko') {
      // Indonesian 3-story Ruko: rolling door ground floor + upper shop windows & AC units
      alb.ctx.fillStyle = '#F1ECE1';
      alb.ctx.fillRect(0, 0, w, h);
      rgh.ctx.fillStyle = '#D4D4D4';
      rgh.ctx.fillRect(0, 0, w, h);

      // Floor bands & colorful signage strip
      alb.ctx.fillStyle = '#0F766E';
      alb.ctx.fillRect(0, h * 0.64, w, h * 0.08);
      alb.ctx.fillStyle = '#CBD5E1';
      alb.ctx.fillRect(18, h * 0.74, w - 36, h * 0.24);
      // Rolling door horizontal ribs
      alb.ctx.strokeStyle = '#64748B';
      alb.ctx.lineWidth = 2;
      for (let y = h * 0.76; y < h * 0.97; y += 9) {
        alb.ctx.beginPath();
        alb.ctx.moveTo(20, y);
        alb.ctx.lineTo(w - 20, y);
        alb.ctx.stroke();
      }

      // Upper 2 floors windows
      for (let floor = 0; floor < 2; floor++) {
        const fy = floor === 0 ? h * 0.1 : h * 0.36;
        for (let col = 0; col < 4; col++) {
          const wx = 34 + col * 116;
          alb.ctx.fillStyle = '#1E293B';
          alb.ctx.fillRect(wx, fy, 82, 86);
          alb.ctx.fillStyle = '#475569';
          alb.ctx.fillRect(wx + 5, fy + 5, 34, 76);
          alb.ctx.fillRect(wx + 43, fy + 5, 34, 76);
          rgh.ctx.fillStyle = '#262626';
          rgh.ctx.fillRect(wx + 5, fy + 5, 72, 76);
          if (rng() < 0.55) {
            emi.ctx.fillStyle = '#FDE68A';
            emi.ctx.fillRect(wx + 6, fy + 6, 70, 74);
          }
        }
      }
      // Ground shop warm light
      emi.ctx.fillStyle = 'rgba(253, 224, 71, 0.45)';
      emi.ctx.fillRect(28, h * 0.78, w - 56, h * 0.16);
    } else if (style === 'institutional') {
      alb.ctx.fillStyle = '#F8FAFC';
      alb.ctx.fillRect(0, 0, w, h);
      rgh.ctx.fillStyle = '#CFCFCF';
      rgh.ctx.fillRect(0, 0, w, h);
      for (let row = 0; row < 4; row++) {
        const y = 30 + row * 118;
        alb.ctx.fillStyle = '#E2E8F0';
        alb.ctx.fillRect(0, y + 92, w, 14);
        for (let col = 0; col < 6; col++) {
          const x = 22 + col * 80;
          alb.ctx.fillStyle = '#1E3A5F';
          alb.ctx.fillRect(x, y, 56, 76);
          rgh.ctx.fillStyle = '#242424';
          rgh.ctx.fillRect(x, y, 56, 76);
          if (rng() < 0.48) {
            emi.ctx.fillStyle = '#FEF3C7';
            emi.ctx.fillRect(x + 4, y + 4, 48, 68);
          }
        }
      }
    } else {
      // Traditional market / terminal roster + corrugated awning
      alb.ctx.fillStyle = '#E7E0D3';
      alb.ctx.fillRect(0, 0, w, h);
      rgh.ctx.fillStyle = '#D8D8D8';
      rgh.ctx.fillRect(0, 0, w, h);
      alb.ctx.fillStyle = '#B45309';
      alb.ctx.fillRect(0, h * 0.48, w, h * 0.12);
      for (let col = 0; col < 6; col++) {
        const x = 16 + col * 82;
        alb.ctx.fillStyle = '#451A03';
        alb.ctx.fillRect(x, h * 0.64, 64, h * 0.32);
        emi.ctx.fillStyle = 'rgba(251, 191, 36, 0.55)';
        emi.ctx.fillRect(x + 6, h * 0.68, 52, h * 0.2);
      }
    }
  }

  const albedo = finalizeTex(alb.canvas, { srgb: true, repeatX: 1, repeatY: 1 }, [241, 236, 225, 255]);
  const emissive = finalizeTex(emi.canvas, { srgb: true, repeatX: 1, repeatY: 1 }, [0, 0, 0, 255]);
  const roughness = finalizeTex(rgh.canvas, { srgb: false, repeatX: 1, repeatY: 1 }, [200, 200, 200, 255]);
  return {
    albedo,
    emissive,
    roughness,
    dispose: () => {
      albedo.dispose();
      emissive.dispose();
      roughness.dispose();
    },
  };
}

export function createTerracottaRoofTexture(): THREE.Texture {
  const size = 256;
  const c = makeCanvas(size, size);
  if (c.ctx) {
    c.ctx.fillStyle = '#B45309';
    c.ctx.fillRect(0, 0, size, size);
    const rng = makeSeededRng(331);
    for (let y = 0; y < size; y += 16) {
      c.ctx.fillStyle = 'rgba(69,26,3,0.28)';
      c.ctx.fillRect(0, y + 13, size, 3);
      for (let x = 0; x < size; x += 24) {
        const shade = rng() * 24 - 12;
        c.ctx.fillStyle = `rgb(${180 + shade},${82 + shade * 0.5},${14})`;
        c.ctx.fillRect(x + 1, y + 1, 21, 12);
      }
    }
  }
  return finalizeTex(c.canvas, { srgb: true, repeatX: 2.2, repeatY: 2.2 }, [180, 83, 9, 255]);
}

export function createTropicalFoliageTexture(): THREE.Texture {
  const size = 256;
  const c = makeCanvas(size, size);
  if (c.ctx) {
    c.ctx.clearRect(0, 0, size, size);
    const rng = makeSeededRng(888);
    // Organic leaf cluster cards with varied tropical greens
    for (let i = 0; i < 110; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.pow(rng(), 0.65) * 92;
      const cx = size * 0.5 + Math.cos(ang) * rad;
      const cy = size * 0.5 + Math.sin(ang) * rad;
      const rx = 14 + rng() * 20;
      const ry = 8 + rng() * 12;
      const gTone = 105 + Math.floor(rng() * 70);
      const rTone = 34 + Math.floor(rng() * 34);
      const bTone = 26 + Math.floor(rng() * 26);
      c.ctx.fillStyle = `rgb(${rTone},${gTone},${bTone})`;
      c.ctx.beginPath();
      c.ctx.ellipse(cx, cy, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
      c.ctx.fill();
    }
  }
  return finalizeTex(
    c.canvas,
    { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping },
    [60, 140, 60, 255]
  );
}

export function createSoftGlowBlobTexture(rgbaInner: string, rgbaOuter: string): THREE.Texture {
  const size = 128;
  const c = makeCanvas(size, size);
  if (c.ctx) {
    c.ctx.clearRect(0, 0, size, size);
    const g = c.ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0.0, rgbaInner);
    g.addColorStop(0.55, rgbaInner);
    g.addColorStop(1.0, rgbaOuter);
    c.ctx.fillStyle = g;
    c.ctx.fillRect(0, 0, size, size);
  }
  return finalizeTex(
    c.canvas,
    { srgb: true, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping },
    [0, 0, 0, 128]
  );
}
