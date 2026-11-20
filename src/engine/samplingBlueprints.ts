import { DEFAULT_CONFIG } from './constants';
import { GIWANGAN_TOPOLOGY } from './giwanganBlueprint';
import { SCENARIO_PRESETS } from './presets';
import { buildSignalPhasesForTopology, simConfigToTopology } from './topologyBuilder';
import { ArmDef, IntersectionTopology } from './topologyTypes';
import { SimConfig } from './types';

export { GIWANGAN_TOPOLOGY };

export interface StaticSamplingBlueprint {
  id: string;
  category: 'field' | 'template';
  label: string;
  city: string;
  subtitle: string;
  source?: string;
  highlights: string[];
  topology: IntersectionTopology;
}

function makeTJunctionTemplate(): IntersectionTopology {
  const arms: ArmDef[] = [
    {
      id: 'east',
      label: 'Jalan Arteri (Timur)',
      angleDeg: 0,
      length: 100,
      inLanes: 2,
      outLanes: 2,
      inLaneWidths: [3.5, 3.5],
      outLaneWidths: [3.5, 3.5],
      medianWidth: 1.2,
      curbRadiusLeft: 4.5,
      leftTurnOnRed: true,
      slipLane: { enabled: true, width: 3.4, islandSetback: 16, yieldControl: 'yield', separatorStyle: 'triangle-island' },
      motorBoxEnabled: true,
      demandWeight: 1.4,
      baseGreenDuration: 24,
    },
    {
      id: 'south',
      label: 'Jalan Cabang (Selatan)',
      angleDeg: 90,
      length: 90,
      inLanes: 1,
      outLanes: 1,
      inLaneWidths: [3.6],
      outLaneWidths: [3.4],
      medianWidth: 0,
      curbRadiusLeft: 5.0,
      leftTurnOnRed: true,
      motorBoxEnabled: false,
      demandWeight: 0.9,
      baseGreenDuration: 18,
    },
    {
      id: 'west',
      label: 'Jalan Arteri (Barat)',
      angleDeg: 180,
      length: 100,
      inLanes: 2,
      outLanes: 2,
      inLaneWidths: [3.5, 3.5],
      outLaneWidths: [3.5, 3.5],
      medianWidth: 1.2,
      curbRadiusLeft: 3.5,
      leftTurnOnRed: false,
      motorBoxEnabled: true,
      demandWeight: 1.3,
      baseGreenDuration: 24,
    },
  ];
  return {
    id: 'template-t-junction',
    name: 'Simpang 3 (Pertigaan T + Slip Lane)',
    city: 'Template Modular',
    description: 'Pertigaan jalan arteri 2 lajur bertemu jalan cabang 1 lajur dengan jalur khusus belok kiri',
    arms,
    phasePreset: '3-phase',
    phases: buildSignalPhasesForTopology(arms, '3-phase', 3, 1.5, 22),
    yellowBoxEnabled: true,
    defaultTraffic: {
      motorRate: 48,
      carRate: 26,
      heavyRate: 5,
      turnLeftPct: 28,
      turnStraightPct: 50,
      turnRightPct: 22,
      greenDuration: 22,
      yellowDuration: 3,
      allRedDuration: 1.5,
    },
  };
}

function makeFiveWayTemplate(): IntersectionTopology {
  const specs = [
    { id: 'arm-1', label: 'Koridor Utara', angleDeg: 270, inLanes: 2, outLanes: 2, w: 3.5, slip: true },
    { id: 'arm-2', label: 'Koridor Timur Laut', angleDeg: 342, inLanes: 2, outLanes: 1, w: 3.3, slip: false },
    { id: 'arm-3', label: 'Koridor Tenggara', angleDeg: 54, inLanes: 2, outLanes: 2, w: 3.5, slip: true },
    { id: 'arm-4', label: 'Koridor Barat Daya', angleDeg: 126, inLanes: 1, outLanes: 1, w: 3.4, slip: false },
    { id: 'arm-5', label: 'Koridor Barat Laut', angleDeg: 198, inLanes: 2, outLanes: 2, w: 3.5, slip: false },
  ];
  const arms: ArmDef[] = specs.map((s) => ({
    id: s.id,
    label: s.label,
    angleDeg: s.angleDeg,
    length: 100,
    inLanes: s.inLanes,
    outLanes: s.outLanes,
    inLaneWidths: Array.from({ length: s.inLanes }, () => s.w),
    outLaneWidths: Array.from({ length: s.outLanes }, () => s.w),
    medianWidth: s.inLanes >= 2 ? 0.8 : 0,
    curbRadiusLeft: 4.0,
    leftTurnOnRed: true,
    slipLane: s.slip
      ? { enabled: true, width: 3.3, islandSetback: 16, yieldControl: 'yield', separatorStyle: 'triangle-island' }
      : undefined,
    motorBoxEnabled: true,
    demandWeight: 1.0,
    baseGreenDuration: 18,
  }));

  return {
    id: 'template-5-way',
    name: 'Simpang 5 (Lima Lengan)',
    city: 'Template Modular',
    description: 'Simpang 5 lengan bersudut bebas (72°) dengan 5 fase split adaptif dan 2 slip lane',
    arms,
    phasePreset: '4-phase-split',
    phases: buildSignalPhasesForTopology(arms, '4-phase-split', 3, 2, 18),
    yellowBoxEnabled: true,
    defaultTraffic: {
      motorRate: 58,
      carRate: 30,
      heavyRate: 5,
      turnLeftPct: 25,
      turnStraightPct: 50,
      turnRightPct: 25,
      greenDuration: 18,
      yellowDuration: 3,
      allRedDuration: 2,
    },
  };
}

function buildFieldSamplingBlueprints(): StaticSamplingBlueprint[] {
  const fieldPresets = SCENARIO_PRESETS.filter((p) => p.category === 'field');
  const highlightsById: Record<string, string[]> = {
    'giwangan-yogya': [
      'Ringroad 3-lajur bermedian × Jl. Pramuka/Imogiri 2-lajur',
      'Sekat belok kiri kecil hanya di sisi Barat + Terminal, SPBU & Brimob',
    ],
    'brimob-yogya': ['1 lajur/arah (3.5m) tanpa median', 'Ideal untuk uji salip makan jalur lawan', '96.1 kend/mnt · 84% motor'],
    'lamper-semarang': ['2 lajur lebar (3.8m) bermedian', 'Ideal untuk uji MOBIL overtaking & LTOR', '153.9 kend/mnt · 36% belok kiri'],
    'sulawesi-banjarmasin': ['Beban timpang ekstrem U-T vs S-B', 'Ideal untuk uji Adaptive Signal', '27.7 kend/mnt · tanpa LTOR'],
    'laswi-bandung': ['Volume ekstrem 174.7 kend/mnt', 'Ideal untuk uji Yellow Box & Rush Hour', 'Siklus 332s · bermedian'],
    'bondowoso-malang': ['1 lajur sempit (3.0m) · data asli 2-fase', 'Ideal untuk uji 2-Fase & Potong Arah', '69.0 kend/mnt · 73% lurus'],
  };

  return fieldPresets.map((preset) => {
    if (preset.patch.customTopology) {
      return {
        id: preset.id,
        category: 'field',
        label: preset.label,
        city: preset.city || 'Indonesia',
        subtitle: preset.description,
        source: preset.source,
        highlights: highlightsById[preset.id] || [preset.description],
        topology: cloneTopology(preset.patch.customTopology),
      };
    }

    const mergedCfg: SimConfig = {
      ...DEFAULT_CONFIG,
      ...preset.patch,
      signalPhasePreset: preset.id === 'bondowoso-malang' ? '2-phase-simultaneous' : '4-phase-split',
      yellowBoxEnabled: preset.id === 'laswi-bandung' || preset.id === 'lamper-semarang',
    };
    const topo = simConfigToTopology(mergedCfg);
    topo.id = preset.id;
    topo.name = preset.patch.scenarioName || preset.label;
    topo.city = preset.city;
    topo.source = preset.source;
    topo.description = preset.description;
    topo.staticMapImage = `/assets/maps/${preset.id}.svg`;
    if (mergedCfg.hasMedian) {
      topo.arms = topo.arms.map((a) => ({ ...a, medianWidth: 1.2 }));
    }
    topo.defaultTraffic = {
      motorRate: mergedCfg.motorRate,
      carRate: mergedCfg.carRate,
      heavyRate: mergedCfg.heavyRate,
      turnLeftPct: mergedCfg.turnLeftPct,
      turnStraightPct: mergedCfg.turnStraightPct,
      turnRightPct: mergedCfg.turnRightPct,
      greenDuration: mergedCfg.greenDuration,
      yellowDuration: mergedCfg.yellowDuration,
      allRedDuration: mergedCfg.allRedDuration,
    };

    return {
      id: preset.id,
      category: 'field',
      label: preset.label,
      city: preset.city || 'Indonesia',
      subtitle: preset.description,
      source: preset.source,
      highlights: highlightsById[preset.id] || [preset.description],
      topology: topo,
    };
  });
}

export const STATIC_SAMPLING_BLUEPRINTS: StaticSamplingBlueprint[] = [
  ...buildFieldSamplingBlueprints(),
  {
    id: 'template-t-junction',
    category: 'template',
    label: 'Pertigaan (Simpang 3 + Slip Lane)',
    city: 'Template Modular',
    subtitle: '3 Lengan · 3-Fase · Arteri 2 lajur × Cabang 1 lajur',
    highlights: ['Geometri Simpang 3 otomatis tanpa belokan ilegal', 'Dilengkapi Slip Lane + Pulau Segitiga'],
    topology: makeTJunctionTemplate(),
  },
  {
    id: 'template-5-way',
    category: 'template',
    label: 'Simpang 5 (Sudut Bebas 72°)',
    city: 'Template Modular',
    subtitle: '5 Lengan · 5-Fase Adaptif · 2 Slip Lane',
    highlights: ['5 lengan bersudut bebas dengan setback analitik', 'Lajur masuk ≠ keluar (asimetris)'],
    topology: makeFiveWayTemplate(),
  },
];

export function cloneTopology(topo: IntersectionTopology): IntersectionTopology {
  return JSON.parse(JSON.stringify(topo)) as IntersectionTopology;
}
