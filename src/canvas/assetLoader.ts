const ASSET_URLS = [
  // Motorcycles
  '/assets/vehicles/moto-commuter.svg',
  '/assets/vehicles/moto-scooter.svg',
  '/assets/vehicles/moto-sport.svg',
  '/assets/vehicles/moto-delivery-box.svg',
  '/assets/vehicles/moto-cruiser.svg',
  '/assets/vehicles/moto-ev-white.svg',
  // Cars
  '/assets/vehicles/car-sedan-navy.svg',
  '/assets/vehicles/car-sedan-white.svg',
  '/assets/vehicles/car-suv-slate.svg',
  '/assets/vehicles/car-compact-teal.svg',
  '/assets/vehicles/car-taxi-yellow.svg',
  '/assets/vehicles/car-van-delivery.svg',
  '/assets/vehicles/car-pickup-slate.svg',
  '/assets/vehicles/car-ev-mint.svg',
  '/assets/vehicles/car-luxury-black.svg',
  // Heavy
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
];

const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();
let started = false;

export function preloadSimulationAssets(): void {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const url of ASSET_URLS) {
    const img = new Image();
    img.onload = () => {
      for (const cb of listeners) cb();
    };
    img.src = url;
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
