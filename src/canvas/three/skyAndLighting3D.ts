import * as THREE from 'three';
import type { SimSnapshot } from '../../engine/types';
import type { GraphicsQualityProfile3D } from './qualityConfig3D';

export interface SkyLightingUpdateOptions {
  targetX?: number;
  targetZ?: number;
  streetLampEmissives?: readonly THREE.MeshStandardMaterial[];
  nightFacadeMats?: readonly THREE.MeshStandardMaterial[];
  lightPoolMat?: THREE.Material | null;
}

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalDir;
  void main() {
    vLocalDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uDarkness;
  uniform float uRain;
  uniform float uTime;

  varying vec3 vLocalDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbmClouds(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 3; i++) {
      v += amp * valueNoise(p);
      p = p * 2.03 + vec2(17.1, 31.7);
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vLocalDir);
    float up = clamp(dir.y, 0.0, 1.0);
    float gradT = pow(up, 0.58);
    vec3 sky = mix(uHorizonColor, uZenithColor, gradT);

    // Subtle procedural tropical cloud wisps
    float cloudMask = smoothstep(0.04, 0.32, dir.y);
    vec2 cloudUv = (dir.xz / (max(dir.y, 0.0) + 0.22)) * 1.35 + vec2(uTime * 0.011, uTime * 0.004);
    float n = fbmClouds(cloudUv);
    float wisp = smoothstep(0.48 - uRain * 0.18, 0.85, n) * cloudMask;
    vec3 cloudColor = mix(vec3(0.97, 0.98, 1.0), uHorizonColor * 1.15, clamp(uDarkness * 1.2, 0.0, 0.75));
    cloudColor = mix(cloudColor, vec3(0.42, 0.48, 0.56), uRain * 0.7);
    sky = mix(sky, cloudColor, wisp * mix(0.28, 0.55, uRain) * (1.0 - uDarkness * 0.55));

    // Soft sun / moon glow disc
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float disc = pow(sunDot, 220.0) * 1.15;
    float halo = pow(sunDot, 12.0) * 0.28;
    float sunVis = (1.0 - uRain * 0.82);
    sky += uSunColor * (disc + halo) * sunVis;

    // Below horizon darken smoothly
    if (dir.y < 0.0) {
      sky = mix(uHorizonColor, uHorizonColor * 0.35, clamp(-dir.y * 4.0, 0.0, 1.0));
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

const DAY_ZENITH = new THREE.Color(0x2b6cb0);
const DUSK_ZENITH = new THREE.Color(0x312e81);
const NIGHT_ZENITH = new THREE.Color(0x0b1120);

const DAY_HORIZON = new THREE.Color(0xc7e0f4);
const DUSK_HORIZON = new THREE.Color(0xfb923c);
const NIGHT_HORIZON = new THREE.Color(0x1e293b);

const OVERCAST_ZENITH_DAY = new THREE.Color(0x475569);
const OVERCAST_HORIZON_DAY = new THREE.Color(0x94a3b8);
const OVERCAST_ZENITH_NIGHT = new THREE.Color(0x0f172a);
const OVERCAST_HORIZON_NIGHT = new THREE.Color(0x1e293b);

const SUN_COLOR_DAY = new THREE.Color(0xfffbeb);
const SUN_COLOR_DUSK = new THREE.Color(0xfdba74);
const MOON_COLOR_NIGHT = new THREE.Color(0xcbd5e1);

const HEMI_SKY_DAY = new THREE.Color(0xdbeafe);
const HEMI_SKY_DUSK = new THREE.Color(0xfdba74);
const HEMI_SKY_NIGHT = new THREE.Color(0x1e293b);

const HEMI_GROUND_DAY = new THREE.Color(0x475569);
const HEMI_GROUND_DUSK = new THREE.Color(0x334155);
const HEMI_GROUND_NIGHT = new THREE.Color(0x0f172a);

const DIR_COLOR_DAY = new THREE.Color(0xfff7ed);
const DIR_COLOR_DUSK = new THREE.Color(0xfb923c);
const DIR_COLOR_NIGHT = new THREE.Color(0x93c5fd);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function blendThreeStage(
  out: THREE.Color,
  day: THREE.Color,
  dusk: THREE.Color,
  night: THREE.Color,
  darkness: number
): THREE.Color {
  const d = clamp01(darkness);
  if (d <= 0.45) {
    out.copy(day).lerp(dusk, d / 0.45);
  } else {
    out.copy(dusk).lerp(night, (d - 0.45) / 0.55);
  }
  return out;
}

export class SkyAndLighting3D {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer | null;
  private quality: GraphicsQualityProfile3D;

  // Sky dome
  private readonly skyGeo: THREE.SphereGeometry;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly skyMesh: THREE.Mesh;

  // Lights & Fog
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;

  // On-demand PMREM IBL
  private pmremGenerator: THREE.PMREMGenerator | null = null;
  private pmremTarget: THREE.WebGLRenderTarget | null = null;
  private iblCubeRT: THREE.WebGLCubeRenderTarget | null = null;
  private iblCubeCamera: THREE.CubeCamera | null = null;
  private readonly iblScene: THREE.Scene;
  private readonly iblSkyGeo: THREE.SphereGeometry;
  private readonly iblSkyMat: THREE.ShaderMaterial;
  private readonly iblSkyMesh: THREE.Mesh;
  private lastBakedDark = -1;
  private lastBakedRain = -1;
  private lastBakedIblRes = -1;

  // Rain particles
  private rainGeo: THREE.BufferGeometry;
  private readonly rainMat: THREE.PointsMaterial;
  private readonly rainPoints: THREE.Points;
  private rainPositions: Float32Array;
  private rainSpeeds: Float32Array;
  private rainCount = 0;

  // Shadow state
  private shadowExtent = 115;
  private shadowBakePending = true;
  private readonly lastSunDir = new THREE.Vector3(0, 1, 0);
  private lastShadowTargetX = Number.NaN;
  private lastShadowTargetZ = Number.NaN;

  // Scratch objects (zero per-frame allocations)
  private readonly scratchSunDir = new THREE.Vector3();
  private readonly scratchZenith = new THREE.Color();
  private readonly scratchHorizon = new THREE.Color();
  private readonly scratchSunColor = new THREE.Color();
  private readonly scratchOvercastZ = new THREE.Color();
  private readonly scratchOvercastH = new THREE.Color();
  private readonly scratchHemiSky = new THREE.Color();
  private readonly scratchHemiGround = new THREE.Color();
  private readonly scratchDirColor = new THREE.Color();
  private elapsedTime = 0;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer | null,
    quality: GraphicsQualityProfile3D
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;

    // 1. Atmospheric Sky Dome
    this.skyGeo = new THREE.SphereGeometry(520, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenithColor: { value: DAY_ZENITH.clone() },
        uHorizonColor: { value: DAY_HORIZON.clone() },
        uSunDir: { value: new THREE.Vector3(0.45, 0.82, -0.35).normalize() },
        uSunColor: { value: SUN_COLOR_DAY.clone() },
        uDarkness: { value: 0 },
        uRain: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.skyMesh = new THREE.Mesh(this.skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    this.scene.add(this.skyMesh);

    // 2. Mini sky-only scene for PMREM IBL
    this.iblScene = new THREE.Scene();
    this.iblSkyGeo = new THREE.SphereGeometry(50, 16, 12);
    this.iblSkyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenithColor: { value: DAY_ZENITH.clone() },
        uHorizonColor: { value: DAY_HORIZON.clone() },
        uSunDir: { value: new THREE.Vector3(0.45, 0.82, -0.35).normalize() },
        uSunColor: { value: SUN_COLOR_DAY.clone() },
        uDarkness: { value: 0 },
        uRain: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.iblSkyMesh = new THREE.Mesh(this.iblSkyGeo, this.iblSkyMat);
    this.iblScene.add(this.iblSkyMesh);

    if (this.renderer) {
      this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      this.pmremGenerator.compileCubemapShader();
    }

    // 3. Lights & Fog
    this.hemiLight = new THREE.HemisphereLight(HEMI_SKY_DAY, HEMI_GROUND_DAY, 0.85);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(DIR_COLOR_DAY, 1.85);
    this.dirLight.position.set(70, 130, -55);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.03;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.fog = new THREE.FogExp2(DAY_HORIZON.getHex(), 0.0018);
    this.scene.fog = this.fog;

    // 4. 3D Rain Particle System
    this.rainGeo = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(0);
    this.rainSpeeds = new Float32Array(0);
    this.rainMat = new THREE.PointsMaterial({
      color: 0xcbd5e1,
      size: 0.36,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.rainPoints = new THREE.Points(this.rainGeo, this.rainMat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.rainPoints.renderOrder = 20;
    this.scene.add(this.rainPoints);

    this.rebuildRainBuffer(quality.rainDrops);
    this.setShadowFrustum(this.shadowExtent, quality);
  }

  private rebuildRainBuffer(targetCount: number): void {
    const count = Math.max(1, Math.floor(targetCount));
    if (count === this.rainCount && this.rainPositions.length === count * 3) {
      return;
    }
    this.rainCount = count;
    this.rainPositions = new Float32Array(count * 3);
    this.rainSpeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      this.rainPositions[i3] = (Math.random() - 0.5) * 110;
      this.rainPositions[i3 + 1] = Math.random() * 38;
      this.rainPositions[i3 + 2] = (Math.random() - 0.5) * 110;
      this.rainSpeeds[i] = 0.75 + Math.random() * 0.65;
    }

    const oldGeo = this.rainGeo;
    const newGeo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.rainPositions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    newGeo.setAttribute('position', attr);
    this.rainGeo = newGeo;
    this.rainPoints.geometry = newGeo;
    oldGeo.dispose();
  }

  setQuality(quality: GraphicsQualityProfile3D): void {
    this.quality = quality;
    this.rebuildRainBuffer(quality.rainDrops);
    this.setShadowFrustum(this.shadowExtent, quality);
    if (quality.iblResolution !== this.lastBakedIblRes) {
      this.lastBakedDark = -1;
    }
  }

  setShadowExtent(extent: number): void {
    this.setShadowFrustum(extent, this.quality);
  }

  setShadowFrustum(extent: number, quality: GraphicsQualityProfile3D): void {
    this.quality = quality;
    const clamped = Math.max(40, extent);
    this.shadowExtent = clamped;

    const cam = this.dirLight.shadow.camera;
    cam.left = -clamped;
    cam.right = clamped;
    cam.top = clamped;
    cam.bottom = -clamped;
    cam.near = 10;
    cam.far = 420;
    cam.updateProjectionMatrix();

    const size = Math.max(256, quality.shadowMapSize);
    if (
      this.dirLight.shadow.mapSize.width !== size ||
      this.dirLight.shadow.mapSize.height !== size
    ) {
      this.dirLight.shadow.mapSize.set(size, size);
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }

    if (this.renderer) {
      this.renderer.shadowMap.autoUpdate = !quality.staticShadows;
    }
    this.requestShadowBake();
  }

  requestShadowBake(): void {
    this.shadowBakePending = true;
    if (this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private computeSunDirection(clockHour: number, darkness: number): THREE.Vector3 {
    // Tropical sun arc: 6:00 East (+X), 12:00 high overhead, 18:00 West (-X)
    const isNight = darkness > 0.65;
    if (!isNight) {
      const dayT = clamp01((clockHour - 5.5) / 13.0);
      const angle = dayT * Math.PI;
      const x = Math.cos(angle);
      const y = Math.max(0.14, Math.sin(angle) * 0.92);
      const z = -0.34;
      return this.scratchSunDir.set(x, y, z).normalize();
    }
    // Moon arc at night
    const nightHour = clockHour < 6 ? clockHour + 24 : clockHour;
    const nightT = clamp01((nightHour - 18.0) / 12.0);
    const angle = nightT * Math.PI;
    const x = -Math.cos(angle) * 0.7;
    const y = Math.max(0.28, Math.sin(angle) * 0.85);
    const z = 0.35;
    return this.scratchSunDir.set(x, y, z).normalize();
  }

  private bakeIblIfNeeded(darkness: number, rain: number): void {
    if (!this.renderer || !this.pmremGenerator) return;
    const res = Math.max(32, this.quality.iblResolution);
    const needsBake =
      this.lastBakedDark < 0 ||
      res !== this.lastBakedIblRes ||
      Math.abs(darkness - this.lastBakedDark) > 0.08 ||
      Math.abs(rain - this.lastBakedRain) > 0.15;

    if (!needsBake) return;

    if (!this.iblCubeRT || res !== this.lastBakedIblRes) {
      this.iblCubeRT?.dispose();
      this.iblCubeRT = new THREE.WebGLCubeRenderTarget(res, {
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        type: THREE.HalfFloatType,
      });
      this.iblCubeCamera = new THREE.CubeCamera(0.5, 200, this.iblCubeRT);
    }

    // Sync mini-scene uniforms with main sky
    this.iblSkyMat.uniforms.uZenithColor.value.copy(this.skyMat.uniforms.uZenithColor.value);
    this.iblSkyMat.uniforms.uHorizonColor.value.copy(this.skyMat.uniforms.uHorizonColor.value);
    this.iblSkyMat.uniforms.uSunDir.value.copy(this.skyMat.uniforms.uSunDir.value);
    this.iblSkyMat.uniforms.uSunColor.value.copy(this.skyMat.uniforms.uSunColor.value);
    this.iblSkyMat.uniforms.uDarkness.value = darkness;
    this.iblSkyMat.uniforms.uRain.value = rain;
    this.iblSkyMat.uniforms.uTime.value = this.elapsedTime;

    this.iblCubeCamera?.update(this.renderer, this.iblScene);
    const nextPmrem = this.pmremGenerator.fromCubemap(this.iblCubeRT.texture);

    const prevPmrem = this.pmremTarget;
    this.pmremTarget = nextPmrem;
    this.scene.environment = nextPmrem.texture;
    if (prevPmrem) {
      prevPmrem.dispose();
    }

    this.lastBakedDark = darkness;
    this.lastBakedRain = rain;
    this.lastBakedIblRes = res;
  }

  private updateRain(dt: number, rain: number, targetX: number, targetZ: number): void {
    if (rain <= 0.01) {
      this.rainPoints.visible = false;
      return;
    }
    this.rainPoints.visible = true;
    this.rainMat.opacity = Math.min(0.65, 0.16 + rain * 0.45);

    const safeDt = Math.min(0.05, Math.max(0, dt));
    const arr = this.rainPositions;
    const speeds = this.rainSpeeds;
    const count = this.rainCount;
    const windX = 2.6 * rain * safeDt;
    const windZ = 1.1 * rain * safeDt;
    const minX = targetX - 55;
    const maxX = targetX + 55;
    const minZ = targetZ - 55;
    const maxZ = targetZ + 55;
    const span = 110;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      let x = arr[i3] + windX;
      let y = arr[i3 + 1] - (22 + speeds[i] * 14) * safeDt;
      let z = arr[i3 + 2] + windZ;

      if (y < 0) {
        y = 38 + (y % 38);
      }
      if (x < minX) x += span;
      else if (x > maxX) x -= span;
      if (z < minZ) z += span;
      else if (z > maxZ) z -= span;

      arr[i3] = x;
      arr[i3 + 1] = y;
      arr[i3 + 2] = z;
    }

    const posAttr = this.rainGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (posAttr) {
      posAttr.needsUpdate = true;
    }
  }

  update(snap: SimSnapshot, dt: number, opts?: SkyLightingUpdateOptions): void {
    const env = snap.stats.environment;
    const darkness = clamp01(env?.ambientDarkness ?? 0);
    const rain = clamp01(env?.rainIntensity ?? 0);
    const clockHour = env?.clockHour ?? 10.5;
    const targetX = opts?.targetX ?? 0;
    const targetZ = opts?.targetZ ?? 0;

    this.elapsedTime += Math.max(0, dt);

    // Sky dome follows camera target
    this.skyMesh.position.set(targetX, 0, targetZ);

    // Compute sky colors
    blendThreeStage(this.scratchZenith, DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH, darkness);
    blendThreeStage(this.scratchHorizon, DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON, darkness);
    blendThreeStage(
      this.scratchSunColor,
      SUN_COLOR_DAY,
      SUN_COLOR_DUSK,
      MOON_COLOR_NIGHT,
      darkness
    );

    if (rain > 0.001) {
      this.scratchOvercastZ
        .copy(OVERCAST_ZENITH_DAY)
        .lerp(OVERCAST_ZENITH_NIGHT, darkness);
      this.scratchOvercastH
        .copy(OVERCAST_HORIZON_DAY)
        .lerp(OVERCAST_HORIZON_NIGHT, darkness);
      const overcastMix = rain * 0.68;
      this.scratchZenith.lerp(this.scratchOvercastZ, overcastMix);
      this.scratchHorizon.lerp(this.scratchOvercastH, overcastMix);
    }

    const sunDir = this.computeSunDirection(clockHour, darkness);

    // Update sky shader uniforms
    const u = this.skyMat.uniforms;
    (u.uZenithColor.value as THREE.Color).copy(this.scratchZenith);
    (u.uHorizonColor.value as THREE.Color).copy(this.scratchHorizon);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Color).copy(this.scratchSunColor);
    u.uDarkness.value = darkness;
    u.uRain.value = rain;
    u.uTime.value = this.elapsedTime;

    // Update HemisphereLight
    blendThreeStage(this.scratchHemiSky, HEMI_SKY_DAY, HEMI_SKY_DUSK, HEMI_SKY_NIGHT, darkness);
    blendThreeStage(
      this.scratchHemiGround,
      HEMI_GROUND_DAY,
      HEMI_GROUND_DUSK,
      HEMI_GROUND_NIGHT,
      darkness
    );
    this.hemiLight.color.copy(this.scratchHemiSky);
    this.hemiLight.groundColor.copy(this.scratchHemiGround);
    this.hemiLight.intensity = (0.95 - darkness * 0.55) * (1 - rain * 0.22);

    // Update DirectionalLight
    blendThreeStage(this.scratchDirColor, DIR_COLOR_DAY, DIR_COLOR_DUSK, DIR_COLOR_NIGHT, darkness);
    this.dirLight.color.copy(this.scratchDirColor);
    this.dirLight.intensity = (1.95 - darkness * 1.45) * (1 - rain * 0.52);

    const sunShift = this.lastSunDir.distanceTo(sunDir);
    const targetShift =
      Number.isNaN(this.lastShadowTargetX) ||
      Math.abs(targetX - this.lastShadowTargetX) > 4 ||
      Math.abs(targetZ - this.lastShadowTargetZ) > 4;

    if (sunShift > 0.025 || targetShift || !this.quality.staticShadows) {
      this.dirLight.position.set(
        targetX + sunDir.x * 165,
        Math.max(26, sunDir.y * 165),
        targetZ + sunDir.z * 165
      );
      this.dirLight.target.position.set(targetX, 0, targetZ);
      this.dirLight.target.updateMatrixWorld();
      this.lastSunDir.copy(sunDir);
      this.lastShadowTargetX = targetX;
      this.lastShadowTargetZ = targetZ;
      if (this.quality.staticShadows) {
        this.shadowBakePending = true;
      }
    }

    if (this.quality.staticShadows && this.shadowBakePending && this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowBakePending = false;
    }

    // Update FogExp2
    this.fog.color.copy(this.scratchHorizon);
    this.fog.density = 0.0014 + rain * 0.0032 + darkness * 0.0008;

    // On-demand PMREM IBL
    this.bakeIblIfNeeded(darkness, rain);

    // 3D Rain particles
    this.updateRain(dt, rain, targetX, targetZ);

    // Night window facades, street lamp emissives, light pools
    const nightFactor = clamp01((darkness - 0.3) / 0.5);
    if (opts?.nightFacadeMats) {
      const mats = opts.nightFacadeMats;
      const emissiveVal = nightFactor * 1.15;
      for (let i = 0; i < mats.length; i++) {
        mats[i].emissiveIntensity = emissiveVal;
      }
    }
    if (opts?.streetLampEmissives) {
      const mats = opts.streetLampEmissives;
      const lampVal = nightFactor * 1.85;
      for (let i = 0; i < mats.length; i++) {
        mats[i].emissiveIntensity = lampVal;
      }
    }
    if (opts?.lightPoolMat) {
      opts.lightPoolMat.opacity = nightFactor * 0.32;
      opts.lightPoolMat.visible = nightFactor > 0.02;
    }
  }

  dispose(): void {
    this.scene.remove(this.skyMesh);
    this.scene.remove(this.hemiLight);
    this.scene.remove(this.dirLight);
    this.scene.remove(this.dirLight.target);
    this.scene.remove(this.rainPoints);

    if (this.scene.fog === this.fog) {
      this.scene.fog = null;
    }
    if (this.pmremTarget && this.scene.environment === this.pmremTarget.texture) {
      this.scene.environment = null;
    }

    this.skyGeo.dispose();
    this.skyMat.dispose();
    this.iblSkyGeo.dispose();
    this.iblSkyMat.dispose();
    this.rainGeo.dispose();
    this.rainMat.dispose();

    if (this.dirLight.shadow.map) {
      this.dirLight.shadow.map.dispose();
      this.dirLight.shadow.map = null;
    }

    this.pmremTarget?.dispose();
    this.pmremTarget = null;
    this.iblCubeRT?.dispose();
    this.iblCubeRT = null;
    this.pmremGenerator?.dispose();
    this.pmremGenerator = null;
  }
}
