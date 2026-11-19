import * as XLSX from 'xlsx';
import { getArmGreenDuration } from '../engine/constants';
import { ArmId, SimSnapshot } from '../engine/types';

const ARM_LABELS: Record<ArmId, string> = {
  north: 'Utara',
  east: 'Timur',
  south: 'Selatan',
  west: 'Barat',
};

function formatTimestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'simulasi';
}

export function exportSimulationReportXlsx(snapshot: SimSnapshot): boolean {
  const { config, stats } = snapshot;
  const now = new Date();
  const observedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const locationName = config.scenarioName || 'Simulasi Simpang 4 (Custom)';
  const modeLabel = config.adaptiveSignal ? 'Adaptif (Dynamic Green + Anti-Starvation)' : 'Fixed-Time (4-Fase Statis)';
  const notes = `${config.scenarioNotes || 'Simulasi sistem Adaptive Signal'} | Mode: ${modeLabel} | Durasi Simulasi: ${stats.simTime.toFixed(1)}s`;

  const cycleTotalBase = (['north', 'east', 'south', 'west'] as const).reduce(
    (sum, arm) => sum + getArmGreenDuration(config, arm) + config.yellowDuration + config.allRedDuration,
    0
  );

  // Sheet 1: 1_Konfigurasi_Simpang (matching template-data-observasi-adaptive-signal.xlsx)
  const sheet1Rows: (string | number | null)[][] = [
    ['LAPORAN EVALUASI SIMULASI — ADAPTIVE SIGNAL', null, null, null, null],
    ['Hasil ekspor otomatis dari engine simulasi untuk evaluasi & perbandingan dengan data observasi lapangan.', null, null, null, null],
    [null, null, null, null, null],
    ['Parameter / Field', 'Nilai Input', 'Satuan', 'Keterangan & Rentang Valid', 'Mapping SimConfig (Kode)'],
    ['A. METADATA SIMULASI', null, null, null, null],
    ['Nama Persimpangan / Skenario', locationName, 'Teks', 'Preset atau skenario custom yang dijalankan', 'metadata.locationName'],
    ['Tanggal & Jam Ekspor', observedAt, 'YYYY-MM-DD HH:MM', 'Waktu pengambilan snapshot laporan', 'metadata.observedAt'],
    ['Catatan & Mode Sinyal', notes, 'Teks', 'Ringkasan mode kontrol dan durasi simulasi', 'metadata.notes'],
    [null, null, null, null, null],
    ['B. GEOMETRI JALAN (LHT)', null, null, null, null],
    ['Jumlah Lajur per Arah', config.lanesPerDirection, 'lajur', 'Bilangan bulat: 1 s/d 4 lajur per arah', 'lanesPerDirection'],
    ['Lebar per Lajur', config.laneWidth, 'meter', 'Rentang: 2.8 - 4.2 meter', 'laneWidth'],
    ['Lebar Jalan per Arah (Otomatis)', +(config.lanesPerDirection * config.laneWidth).toFixed(2), 'meter', 'Otomatis: Jumlah Lajur x Lebar per Lajur', 'roadWidthPerDirection'],
    ['Panjang Area Pengamatan Lengan', config.roadLength, 'meter', 'Rentang: 40 - 200 meter sebelum garis henti', 'roadLength'],
    [null, null, null, null, null],
    ['C. KOMPOSISI & LAJU KEDATANGAN', null, null, null, null],
    ['Laju Kedatangan Sepeda Motor', config.motorRate, 'kend/menit', 'Total seluruh 4 lengan simpang', 'motorRate'],
    ['Laju Kedatangan Mobil Penumpang', config.carRate, 'kend/menit', 'Mobil pribadi, taksi, SUV, MPV', 'carRate'],
    ['Laju Kedatangan Kendaraan Berat', config.heavyRate, 'kend/menit', 'Truk, bus kota, kendaraan besar', 'heavyRate'],
    ['Persentase Belok Kiri', config.turnLeftPct, '%', '0 - 100 (jumlah Kiri + Lurus + Kanan = 100)', 'turnLeftPct'],
    ['Persentase Jalan Lurus', config.turnStraightPct, '%', '0 - 100 (jumlah Kiri + Lurus + Kanan = 100)', 'turnStraightPct'],
    ['Persentase Belok Kanan', config.turnRightPct, '%', '0 - 100 (jumlah Kiri + Lurus + Kanan = 100)', 'turnRightPct'],
    ['Total Persentase Arah (Validasi)', config.turnLeftPct + config.turnStraightPct + config.turnRightPct, '%', 'Wajib bernilai 100', 'validation.turnSum'],
    [null, null, null, null, null],
    ['D. PENGATURAN LAMPU LALU LINTAS (4-FASE)', null, null, null, null],
    ['Mode Sinyal Adaptif', config.adaptiveSignal ? 'AKTIF (Adaptif)' : 'NONAKTIF (Fixed-Time)', 'Boolean', 'true = Adaptif, false = Fixed-Time', 'adaptiveSignal'],
    ['Durasi Lampu Hijau Dasar / Maks', config.greenDuration, 'detik', 'Durasi hijau dasar atau batas atas adaptif', 'greenDuration'],
    ['Durasi Hijau per Lengan (U/T/S/B)', `${getArmGreenDuration(config, 'north')} / ${getArmGreenDuration(config, 'east')} / ${getArmGreenDuration(config, 'south')} / ${getArmGreenDuration(config, 'west')}`, 'detik', 'Utara / Timur / Selatan / Barat', 'armGreenDurations'],
    ['Durasi Lampu Kuning', config.yellowDuration, 'detik', 'Umumnya 2 - 4 detik', 'yellowDuration'],
    ['Durasi All-Red Clearance', config.allRedDuration, 'detik', 'Jeda semua merah antar fase', 'allRedDuration'],
    ['Total Durasi 1 Siklus Dasar', +cycleTotalBase.toFixed(1), 'detik', 'Jumlah (Hijau + Kuning + All-Red) 4 lengan', 'cycleDuration'],
    ['Bobot Permintaan Lengan (U/T/S/B)', `${(config.armWeights?.north ?? 1).toFixed(1)} / ${(config.armWeights?.east ?? 1).toFixed(1)} / ${(config.armWeights?.south ?? 1).toFixed(1)} / ${(config.armWeights?.west ?? 1).toFixed(1)}`, 'rasio', 'Bobot relatif arus datang per lengan', 'armWeights'],
    [null, null, null, null, null],
    ['E. FITUR LALU LINTAS INDONESIA & PETA', null, null, null, null],
    ['Belok Kiri Langsung (LTOR)', config.leftTurnOnRed ? 'AKTIF' : 'NONAKTIF', 'Boolean', 'Kendaraan belok kiri jalan terus saat merah (mengikuti aturan RI)', 'leftTurnOnRed'],
    ['Mode Swarm Motor (3-4 Kolom)', config.motorSwarmMode ? 'AKTIF' : 'NONAKTIF', 'Boolean', 'Penyelipan & penumpukan motor 3-4 kolom di antara mobil', 'motorSwarmMode'],
    ['Kotak Khusus Motor (RHK)', config.motorBoxEnabled ? 'AKTIF' : 'NONAKTIF', 'Boolean', 'Ruang Henti Khusus sepeda motor di depan garis henti', 'motorBoxEnabled'],
    ['Median Tengah Fisik', config.hasMedian ? 'ADA' : 'TIDAK ADA', 'Boolean', 'Pemisah fisik di tengah lengan pendekat', 'hasMedian'],
    [
      'Nama Ruas Jalan (U / T / S / B)',
      config.armNames
        ? `${config.armNames.north || '-'} / ${config.armNames.east || '-'} / ${config.armNames.south || '-'} / ${config.armNames.west || '-'}`
        : 'Default (Utara / Timur / Selatan / Barat)',
      'Teks',
      'Label nama jalan nyata per lengan simpang',
      'armNames',
    ],
  ];

  // Sheet 2: 2_Observasi_Per_Fase (chronological order)
  const phasesChronological = [...stats.phaseHistory].reverse();
  const sheet2Rows: (string | number)[][] = [
    ['HASIL SIMULASI PER FASE HIJAU (PhaseRecord)'],
    ['Urutan kronologis dari fase paling awal ke terbaru.'],
    [
      'Siklus_Ke',
      'Fase_Ke',
      'Lengan_Asal (north/east/south/west)',
      'Durasi_Hijau (detik)',
      'Keluar_Motor',
      'Keluar_Mobil',
      'Keluar_Truk_Bus',
      'Total_Keluar',
      'Antrean_Awal',
      'Antrean_Sisa',
      'Catatan',
    ],
    ...phasesChronological.map((p) => [
      p.cycleNumber,
      p.phaseIndex,
      p.arm,
      p.greenDuration,
      p.exitedMotor,
      p.exitedCar,
      p.exitedHeavy,
      p.exitedTotal,
      p.queueAtStart,
      p.queueAtEnd,
      `Lengan ${ARM_LABELS[p.arm]} | Mode ${config.adaptiveSignal ? 'Adaptif' : 'Fixed-Time'}`,
    ]),
  ];

  // Sheet 3: 3_Rekap_Per_Siklus (chronological order)
  const cyclesChronological = [...stats.cycleHistory].reverse();
  const sheet3Rows: (string | number)[][] = [
    ['REKAPITULASI PER SIKLUS SIMULASI (CycleRecord)'],
    ['Ringkasan 4 fase per siklus penuh.'],
    [
      'Siklus_Ke',
      'Total_Durasi_Hijau (s)',
      'Keluar_Motor',
      'Keluar_Mobil',
      'Keluar_Truk_Bus',
      'Total_Keluar',
      'Rata2_Antrean_Sisa',
    ],
    ...cyclesChronological.map((c) => {
      const directGreen = (c as { totalGreenDuration?: number }).totalGreenDuration;
      const cyclePhases = phasesChronological.filter((p) => p.cycleNumber === c.cycleNumber);
      const totalGreenDuration =
        typeof directGreen === 'number'
          ? +directGreen.toFixed(1)
          : cyclePhases.length > 0
          ? +cyclePhases.reduce((s, p) => s + p.greenDuration, 0).toFixed(1)
          : 0;
      const avgRemainingQueue =
        cyclePhases.length > 0
          ? +(cyclePhases.reduce((s, p) => s + p.queueAtEnd, 0) / cyclePhases.length).toFixed(1)
          : c.avgQueue;
      return [
        c.cycleNumber,
        totalGreenDuration,
        c.exitedMotor,
        c.exitedCar,
        c.exitedHeavy,
        c.exitedTotal,
        avgRemainingQueue,
      ];
    }),
  ];

  // Sheet 4: 4_Evaluasi_Performa (for quick AI & user evaluation)
  const armStats = (['north', 'east', 'south', 'west'] as const).map((arm) => {
    const armPhases = phasesChronological.filter((p) => p.arm === arm);
    const count = armPhases.length;
    const avgGreen = count > 0 ? +(armPhases.reduce((s, p) => s + p.greenDuration, 0) / count).toFixed(1) : 0;
    const avgExited = count > 0 ? +(armPhases.reduce((s, p) => s + p.exitedTotal, 0) / count).toFixed(1) : 0;
    const avgRemQueue = count > 0 ? +(armPhases.reduce((s, p) => s + p.queueAtEnd, 0) / count).toFixed(1) : 0;
    return {
      arm,
      label: ARM_LABELS[arm],
      count,
      configuredGreen: getArmGreenDuration(config, arm),
      avgGreen,
      avgExited,
      avgRemQueue,
      currentQueue: stats.queueByArm[arm],
    };
  });

  const arrivalPerHour = Math.round((config.motorRate + config.carRate + config.heavyRate) * 60);
  const capacityRatioPct =
    arrivalPerHour === 0 && stats.totalExitedAllTime === 0
      ? 0
      : arrivalPerHour > 0
      ? +((stats.throughputPerHour / arrivalPerHour) * 100).toFixed(1)
      : 100;
  const los =
    stats.totalExitedAllTime === 0
      ? 'Belum ada data (0 kend keluar)'
      : stats.avgWaitTime <= 5
      ? 'A (Sangat Baik)'
      : stats.avgWaitTime <= 15
      ? 'B (Baik)'
      : stats.avgWaitTime <= 25
      ? 'C (Cukup)'
      : stats.avgWaitTime <= 40
      ? 'D (Mendekati Jenuh)'
      : stats.avgWaitTime <= 60
      ? 'E (Jenuh)'
      : 'F (Sangat Jenuh / Macet)';

  const sheet4Rows: (string | number | null)[][] = [
    ['RINGKASAN EVALUASI PERFORMA SIMULASI'],
    ['Digunakan untuk mengevaluasi efektivitas kontrol sinyal dan kalibrasi terhadap data lapangan.'],
    [null, null, null],
    ['Metrik Utama', 'Nilai', 'Satuan'],
    ['Skenario', locationName, 'Teks'],
    ['Mode Kontrol Sinyal', config.adaptiveSignal ? 'Adaptif' : 'Fixed-Time', 'Mode'],
    ['Total Waktu Simulasi', +stats.simTime.toFixed(1), 'detik'],
    ['Total Kendaraan Keluar', stats.totalExitedAllTime, 'kendaraan'],
    ['Proyeksi Throughput', stats.throughputPerHour, 'kend/jam'],
    ['Laju Kedatangan Konfigurasi', arrivalPerHour, 'kend/jam'],
    ['Rasio Kapasitas (Keluar / Datang)', capacityRatioPct, '%'],
    ['Rata-rata Waktu Tunggu (Delay)', stats.avgWaitTime, 'detik/kendaraan'],
    ['Level of Service (LOS)', los, 'PKJI/HCM'],
    ['Maksimum Waktu Tunggu Tercatat', stats.maxWaitTime, 'detik'],
    ['Antrean Aktif Saat Ekspor', stats.activeQueueCount, 'kendaraan'],
    ['Kendaraan Terjebak di Kotak Simpang', stats.boxStuckCount, 'kendaraan'],
    ['Total Fase Tercatat', phasesChronological.length, 'fase'],
    ['Total Siklus Selesai Tercatat', cyclesChronological.length, 'siklus'],
    [null, null, null],
    ['RINGKASAN PER LENGAN (UTARA / TIMUR / SELATAN / BARAT)', null, null],
    [
      'Lengan',
      'Jumlah_Fase',
      'Hijau_Konfigurasi (s)',
      'Rata2_Hijau_Aktual (s)',
      'Rata2_Keluar_per_Fase',
      'Rata2_Antrean_Sisa',
      'Antrean_Aktif_Saat_Ini',
    ],
    ...armStats.map((a) => [
      `${a.label} (${a.arm})`,
      a.count,
      a.configuredGreen,
      a.avgGreen,
      a.avgExited,
      a.avgRemQueue,
      a.currentQueue,
    ]),
  ];

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows);
  ws1['!cols'] = [{ wch: 34 }, { wch: 44 }, { wch: 18 }, { wch: 44 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws1, '1_Konfigurasi_Simpang');

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows);
  ws2['!cols'] = [
    { wch: 11 },
    { wch: 10 },
    { wch: 32 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '2_Observasi_Per_Fase');

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Rows);
  ws3['!cols'] = [{ wch: 11 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws3, '3_Rekap_Per_Siklus');

  const ws4 = XLSX.utils.aoa_to_sheet(sheet4Rows);
  ws4['!cols'] = [{ wch: 32 }, { wch: 26 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws4, '4_Evaluasi_Performa');

  const filename = `laporan-adaptive-signal-${slugify(locationName)}-${formatTimestampForFilename(now)}.xlsx`;
  try {
    XLSX.writeFile(wb, filename);
    return true;
  } catch (err) {
    throw new Error(
      `Gagal mengekspor file Excel (${filename}): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
