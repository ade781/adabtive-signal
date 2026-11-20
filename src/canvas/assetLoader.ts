const ASSET_URLS = [

  '/assets/vehicles/moto-commuter.svg',
  '/assets/vehicles/moto-scooter.svg',
  '/assets/vehicles/moto-sport.svg',
  '/assets/vehicles/moto-delivery-box.svg',
  '/assets/vehicles/moto-cruiser.svg',
  '/assets/vehicles/moto-ev-white.svg',

  '/assets/vehicles/car-sedan-navy.svg',
  '/assets/vehicles/car-sedan-white.svg',
  '/assets/vehicles/car-suv-slate.svg',
  '/assets/vehicles/car-compact-teal.svg',
  '/assets/vehicles/car-taxi-yellow.svg',
  '/assets/vehicles/car-van-delivery.svg',
  '/assets/vehicles/car-pickup-slate.svg',
  '/assets/vehicles/car-ev-mint.svg',
  '/assets/vehicles/car-luxury-black.svg',

  '/assets/vehicles/truck-box.svg',
  '/assets/vehicles/truck-heavy.svg',
  '/assets/vehicles/bus-city.svg',
  '/assets/vehicles/truck-dump.svg',
  '/assets/vehicles/truck-tanker.svg',
  // Infra & City
  '/assets/infra/signal-red.svg',
  '/assets/infra/signal-yellow.svg',
  '/assets/infra/signal-green.svg',
  '/assets/infra/tree-architectural-1.svg',
  '/assets/infra/tree-architectural-2.svg',
  '/assets/infra/compass-north.svg',
  '/assets/infra/city/building-roof-1.svg',
  '/assets/infra/city/building-roof-2.svg',
  '/assets/infra/city/building-roof-3.svg',
  '/assets/infra/city/park-plaza.svg',
  '/assets/infra/city/park-pond.svg',
  '/assets/infra/city/building-tower-glass.svg',
  '/assets/infra/city/building-commercial-mall.svg',
  '/assets/infra/city/building-terrace-green.svg',
  '/assets/infra/city/parking-lot-top.svg',
  '/assets/infra/city/helipad-roof.svg',
  '/assets/infra/city/bus-shelter-top.svg',
  '/assets/infra/city/streetlight-top.svg',
  '/assets/infra/city/tree-palm-top.svg',
  '/assets/infra/city/planter-box-long.svg',
  '/assets/infra/city/landmark-mako-brimob.svg',
  '/assets/infra/city/landmark-ruko-row.svg',
  '/assets/infra/city/landmark-masjid-jami.svg',
  '/assets/infra/city/landmark-pasar-tradisional.svg',
  '/assets/infra/city/landmark-spbu-pertamina.svg',
  '/assets/infra/city/landmark-kampus-wilis.svg',
  '/assets/infra/city/landmark-stadion-corner.svg',
  '/assets/infra/city/landmark-terminal-giwangan.svg',
];

const cache = new Map<string, HTMLImageElement>();
const failedUrls = new Set<string>();
const listeners = new Set<() => void>();
let started = false;
let notifyScheduled = false;

export function resolveAssetUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

function scheduleNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  const flush = () => {
    notifyScheduled = false;
    for (const cb of listeners) cb();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 16);
  }
}

export function preloadSimulationAssets(): void {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const url of ASSET_URLS) {
    const resolvedUrl = resolveAssetUrl(url);
    const img = new Image();
    img.onload = scheduleNotify;
    img.onerror = () => {
      if (!failedUrls.has(url)) {
        failedUrls.add(url);
        console.warn(`[assetLoader] Failed to load asset: ${resolvedUrl}`);
      }
    };
    img.src = resolvedUrl;
    cache.set(url, img);
  }
}

export function onAssetsLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getLoadedAsset(url: string): HTMLImageElement | null {
  const img = cache.get(url);
  if (img && img.complete && img.naturalWidth > 0) {
    return img;
  }
  return null;
}
