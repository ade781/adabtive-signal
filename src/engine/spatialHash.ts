import { SimVehicle } from './behaviors';

/**
 * Lightweight 2D Spatial Hash Grid for O(1) cell lookup and O(N) bidirectional/360° vehicle perception.
 * Enables vehicles on any arm (approach, box, exit, or opposing carriageway) to perceive nearby traffic fast.
 */
export class SpatialHashGrid {
  private readonly invCellSize: number;
  private buckets: Map<number, SimVehicle[]> = new Map();
  private pool: SimVehicle[][] = [];
  private activeKeys: number[] = [];
  private allVehicles: readonly SimVehicle[] = [];

  constructor(cellSize = 22) {
    this.invCellSize = 1 / cellSize;
  }

  private hash(cx: number, cy: number): number {
    // Pack signed integer grid coords into a safe 53-bit integer key (works cleanly for +/- 100 km)
    return (cx + 16384) * 32768 + (cy + 16384);
  }

  public clear(): void {
    for (let i = 0; i < this.activeKeys.length; i++) {
      const bucket = this.buckets.get(this.activeKeys[i]);
      if (bucket) {
        bucket.length = 0;
        this.pool.push(bucket);
      }
    }
    this.buckets.clear();
    this.activeKeys.length = 0;
  }

  public rebuild(vehicles: readonly SimVehicle[]): void {
    this.allVehicles = vehicles;
    if (vehicles.length <= 28) {
      if (this.activeKeys.length > 0) this.clear();
      return;
    }
    this.clear();
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const cx = Math.floor(v.x * this.invCellSize);
      const cy = Math.floor(v.y * this.invCellSize);
      const key = this.hash(cx, cy);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = this.pool.pop() ?? [];
        this.buckets.set(key, bucket);
        this.activeKeys.push(key);
      }
      bucket.push(v);
    }
  }

  public queryRadius(x: number, y: number, radius: number, out: SimVehicle[] = []): SimVehicle[] {
    out.length = 0;
    const r2 = radius * radius;
    const all = this.allVehicles;
    if (all.length <= 28) {
      for (let i = 0; i < all.length; i++) {
        const v = all[i];
        const dx = v.x - x;
        const dy = v.y - y;
        if (dx * dx + dy * dy <= r2) {
          out.push(v);
        }
      }
      return out;
    }
    const minCx = Math.floor((x - radius) * this.invCellSize);
    const maxCx = Math.floor((x + radius) * this.invCellSize);
    const minCy = Math.floor((y - radius) * this.invCellSize);
    const maxCy = Math.floor((y + radius) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this.hash(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const v = bucket[i];
          const dx = v.x - x;
          const dy = v.y - y;
          if (dx * dx + dy * dy <= r2) {
            out.push(v);
          }
        }
      }
    }
    return out;
  }
}
