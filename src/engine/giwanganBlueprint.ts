import { buildSignalPhasesForTopology } from './topologyBuilder';
import { ArmDef, IntersectionTopology } from './topologyTypes';

/**
 * Referensi Nyata: Simpang Empat Giwangan, Yogyakarta
 * - Ringroad Selatan (Barat & Timur): 3 lajur lebar bermedian fisik (2.0m) + bukaan U-Turn.
 * - Sisi Barat (Ringroad Barat -> Jl. Pramuka): jalur khusus belok kiri langsung dengan SEKAT PEMISAH KECIL ('curb-divider').
 * - Sisi Utara (Jl. Pramuka), Timur (Ringroad Timur), dan Selatan (Jl. Imogiri Timur): tanpa sekat slip-lane.
 * - Landmark sekitar: Terminal Giwangan (Tenggara), SPBU Pertamina (Barat-Selatan), Pos Brimob (Timur-Laut), Ruko (Barat-Laut).
 */
export function makeGiwanganTopology(): IntersectionTopology {
  const arms: ArmDef[] = [
    {
      id: 'north',
      label: 'Jl. Pramuka (Utara)',
      angleDeg: 266,
      length: 110,
      inLanes: 2,
      outLanes: 2,
      inLaneWidths: [3.2, 3.4],
      outLaneWidths: [3.2, 3.2],
      medianWidth: 0.4,
      curbRadiusLeft: 4.5,
      curbFlareLeft: 0.5,
      leftTurnOnRed: true,
      slipLane: { enabled: false, width: 3.2, islandSetback: 16, yieldControl: 'yield' },
      motorBoxEnabled: true,
      demandWeight: 1.0,
      baseGreenDuration: 24,
    },
    {
      id: 'east',
      label: 'Ringroad Selatan (Timur)',
      angleDeg: 0,
      length: 130,
      inLanes: 3,
      outLanes: 3,
      inLaneWidths: [3.5, 3.5, 3.8],
      outLaneWidths: [3.5, 3.5, 3.6],
      medianWidth: 2.0,
      curbRadiusLeft: 5.5,
      curbFlareLeft: 0.6,
      leftTurnOnRed: true,
      slipLane: { enabled: false, width: 3.4, islandSetback: 18, yieldControl: 'yield' },
      uTurnBay: { enabled: true, distanceBeforeStop: 38 },
      motorBoxEnabled: true,
      demandWeight: 1.6,
      baseGreenDuration: 38,
    },
    {
      id: 'south',
      label: 'Jl. Imogiri Timur (Selatan)',
      angleDeg: 94,
      length: 110,
      inLanes: 2,
      outLanes: 2,
      inLaneWidths: [3.3, 3.5],
      outLaneWidths: [3.1, 3.1],
      medianWidth: 0.0, // Tanpa median fisik di Jl. Imogiri Timur -> memungkinkan salip jalur lawan
      curbRadiusLeft: 4.2,
      curbFlareLeft: 0.4,
      leftTurnOnRed: true,
      slipLane: { enabled: false, width: 3.2, islandSetback: 14, yieldControl: 'yield' },
      motorBoxEnabled: true,
      demandWeight: 1.15,
      baseGreenDuration: 26,
    },
    {
      id: 'west',
      label: 'Ringroad Selatan (Barat)',
      angleDeg: 180,
      length: 130,
      inLanes: 3,
      outLanes: 2, // Bottleneck 3 masuk -> 2 keluar di mulut Ringroad Barat
      inLaneWidths: [3.5, 3.5, 3.8],
      outLaneWidths: [3.6, 3.6],
      medianWidth: 2.0,
      curbRadiusLeft: 6.0,
      curbFlareLeft: 0.9,
      leftTurnOnRed: true,
      // Hanya sisi Barat yang memiliki jalur belok kiri langsung dengan sekat pemisah kecil!
      slipLane: {
        enabled: true,
        width: 3.4,
        islandSetback: 18,
        yieldControl: 'yield',
        separatorStyle: 'curb-divider',
        separatorThickness: 0.55,
        curveBulge: 0.62,
      },
      uTurnBay: { enabled: true, distanceBeforeStop: 38 },
      motorBoxEnabled: true,
      demandWeight: 1.75,
      baseGreenDuration: 40,
    },
  ];

  return {
    id: 'giwangan-yogya',
    name: 'Simpang Giwangan, Yogyakarta',
    city: 'Yogyakarta',
    source: 'Referensi Geometri Nyata Ringroad Selatan – Terminal Giwangan',
    description:
      'Ringroad 3-lajur bermedian × Jl. Pramuka/Imogiri Timur 2-lajur · Sekat belok kiri kecil di sisi Barat · Terminal, SPBU & Brimob',
    staticMapImage: '/assets/maps/giwangan-yogya.svg',
    arms,
    phasePreset: '4-phase-protected-right',
    phases: buildSignalPhasesForTopology(arms, '4-phase-protected-right', 3, 2, 34),
    yellowBoxEnabled: true,
    landmarks: [
      {
        id: 'terminal-giwangan',
        assetKey: '/assets/infra/city/landmark-terminal-giwangan.svg',
        x: 42,
        y: 36,
        width: 34,
        height: 24,
        rotationRad: 0,
        label: 'Terminal Giwangan',
      },
      {
        id: 'spbu-giwangan',
        assetKey: '/assets/infra/city/landmark-spbu-pertamina.svg',
        x: -44,
        y: 26,
        width: 24,
        height: 18,
        rotationRad: 0,
        label: 'SPBU Giwangan',
      },
      {
        id: 'brimob-giwangan',
        assetKey: '/assets/infra/city/landmark-mako-brimob.svg',
        x: 34,
        y: -30,
        width: 26,
        height: 20,
        rotationRad: 0,
        label: 'Pos / Kompleks Brimob',
      },
      {
        id: 'ruko-giwangan',
        assetKey: '/assets/infra/city/landmark-ruko-row.svg',
        x: -36,
        y: -30,
        width: 26,
        height: 16,
        rotationRad: 0,
        label: 'Ruko & Pertokoan',
      },
    ],
    defaultTraffic: {
      motorRate: 92,
      carRate: 44,
      heavyRate: 11,
      turnLeftPct: 26,
      turnStraightPct: 54,
      turnRightPct: 20,
      uTurnPct: 4,
      greenDuration: 34,
      yellowDuration: 3,
      allRedDuration: 2,
    },
  };
}

export const GIWANGAN_TOPOLOGY: IntersectionTopology = makeGiwanganTopology();
