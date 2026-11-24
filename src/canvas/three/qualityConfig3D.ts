import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DriverArchetype } from '../../engine/types';

export type GraphicsQuality3D = 'low' | 'balanced' | 'ultra';

export interface GraphicsQualityProfile3D {
  id: GraphicsQuality3D;
  label: string;
  desc: string;
  maxDpr: number;
  antialias: boolean;
  staticShadows: boolean;
  shadowMapSize: number;
  iblResolution: number;
  rainDrops: number;
  overlayFps: number;
  maxTrees: number;
}

export const GRAPHICS_QUALITY_PROFILES: Readonly<Record<GraphicsQuality3D, GraphicsQualityProfile3D>> = {
  low: {
    id: 'low',
    label: 'Hemat',
    desc: 'DPR 1.0 · Contact AO · Ultra-cepat di GPU terintegrasi',
    maxDpr: 1.0,
    antialias: false,
    staticShadows: false,
    shadowMapSize: 512,
    iblResolution: 64,
    rainDrops: 220,
    overlayFps: 20,
    maxTrees: 70,
  },
  balanced: {
    id: 'balanced',
    label: 'Seimbang',
    desc: 'DPR 1.5 · Static Shadow 1024px · PMREM IBL · 60fps stabil',
    maxDpr: 1.5,
    antialias: true,
    staticShadows: true,
    shadowMapSize: 1024,
    iblResolution: 128,
    rainDrops: 420,
    overlayFps: 30,
    maxTrees: 120,
  },
  ultra: {
    id: 'ultra',
    label: 'Realistis',
    desc: 'DPR 2.0 · Static Shadow 2048px · Refleksi genangan penuh',
    maxDpr: 2.0,
    antialias: true,
    staticShadows: true,
    shadowMapSize: 2048,
    iblResolution: 256,
    rainDrops: 700,
    overlayFps: 60,
    maxTrees: 180,
  },
};

export const ARCHETYPE_HEX: Readonly<Record<DriverArchetype, number>> = {
  defensive: 0x10b981,
  commuter: 0x0ea5e9,
  hurried: 0xf43f5e,
  courier: 0xf59e0b,
  transit: 0x6366f1,
  logistics: 0x475569,
};

/**
 * Normalizes a geometry to non-indexed with position/normal/uv attributes
 * so mergeGeometries never fails across Box/Cylinder/Shape/Extrude geometries.
 */
export function normalizeGeometryForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) {
    g.computeVertexNormals();
  }
  const pos = g.getAttribute('position');
  if (!g.getAttribute('uv') && pos) {
    const uvs = new Float32Array(pos.count * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  return g;
}

/**
 * Merges static mesh pieces grouped by Material into 1 Mesh per material,
 * collapsing hundreds of scene draw calls down to a handful.
 */
export interface StaticMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
}

export function mergeStaticPartsByMaterial(
  parts: readonly StaticMeshPart[],
  parent: THREE.Group,
  trackedGeos: THREE.BufferGeometry[]
): void {
  if (parts.length === 0) return;
  const buckets = new Map<
    string,
    {
      material: THREE.Material;
      castShadow: boolean;
      receiveShadow: boolean;
      renderOrder: number;
      geos: THREE.BufferGeometry[];
    }
  >();

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const cast = Boolean(p.castShadow);
    const recv = Boolean(p.receiveShadow);
    const order = p.renderOrder ?? 0;
    const key = `${p.material.uuid}:${cast ? 1 : 0}:${recv ? 1 : 0}:${order}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: p.material,
        castShadow: cast,
        receiveShadow: recv,
        renderOrder: order,
        geos: [],
      };
      buckets.set(key, bucket);
    }
    bucket.geos.push(normalizeGeometryForMerge(p.geometry));
  }

  for (const bucket of buckets.values()) {
    const merged =
      bucket.geos.length === 1 ? bucket.geos[0] : mergeGeometries(bucket.geos, false);
    if (bucket.geos.length > 1) {
      for (let i = 0; i < bucket.geos.length; i++) {
        bucket.geos[i].dispose();
      }
    }
    if (!merged) continue;
    trackedGeos.push(merged);
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.renderOrder = bucket.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
  }
}

export function disposeObject3D(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const anyObj = obj as unknown as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
      isSprite?: boolean;
      dispose?: () => void;
    };
    if (anyObj.geometry && !anyObj.isSprite) {
      geos.add(anyObj.geometry);
    }
    if (anyObj.material) {
      if (Array.isArray(anyObj.material)) {
        for (const m of anyObj.material) mats.add(m);
      } else {
        mats.add(anyObj.material);
      }
    }
    if (typeof anyObj.dispose === 'function' && obj !== root) {
      anyObj.dispose();
    }
  });

  for (const m of mats) {
    const rec = m as unknown as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      const val = rec[k];
      if (val && typeof val === 'object' && (val as THREE.Texture).isTexture) {
        texs.add(val as THREE.Texture);
      }
    }
    m.dispose();
  }
  for (const t of texs) t.dispose();
  for (const g of geos) g.dispose();
}
