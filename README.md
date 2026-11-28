# Adaptive Signal

Simulator persimpangan lalu lintas 4-arah berbasis web dengan aturan **lajur kiri (Left-Hand Traffic / LHT)** Indonesia dan perilaku lalu lintas campuran (*heterogeneous mixed traffic*). Proyek ini dibangun sebagai fondasi *digital twin* untuk mengkalibrasi dan mengoptimalkan durasi lampu lalu lintas terhadap kondisi persimpangan dunia nyata.

> **Tolok Ukur Optimalitas:** Sistem dikatakan optimal apabila jumlah kendaraan yang berhasil keluar dalam **1 periode lampu** (per fase hijau maupun per 1 siklus penuh 4 arah) pada simulasi sesuai dengan hasil pengamatan di persimpangan dunia nyata.

---

## Fitur & Logika Inti (Fase 1)

- **Geometri Lajur Kiri (LHT Indonesia):**
  - Penempatan lajur masuk & keluar di sisi kiri jalan pada keempat lengan (`Utara`, `Timur`, `Selatan`, `Barat`).
  - Kurva belok *Quadratic Bézier* dengan *arc-length lookup table* (*belok kiri* radius pendek menyusuri trotoar, *belok kanan* radius lebar melintasi simpang) dan pembagian lajur yang terarah.
  - Kesatuan **Jumlah Lajur (`1–4`) × Lebar per Lajur (`2.8m – 4.2m`) = Lebar Jalan**, sehingga lebar jalan selalu proporsional terhadap dimensi fisik kendaraan.
- **Model Gerak & Karakteristik Pengendara Indonesia:**
  - **Intelligent Driver Model (IDM)** dengan penyesuaian lebar lajur ala **MKJI (`FC_w`)**—lajur sempit membatasi kecepatan dan memperbesar *time headway*, sedangkan lajur lebar meningkatkan kapasitas pelepasan.
  - **Indonesian Motorcycle Seepage (*Selap-Selip*):** Motor secara proaktif memindai celah kosong dengan *forward lookahead* (termasuk garis putus-putus antar-lajur, tepi median, dan tepi trotoar) menggunakan lebar efektif *filtering* (`0.72m`) dan *creeping speed* untuk mengisi kantong depan (*front-of-queue pocket*) saat lampu merah.
  - **Front-Wheel Steering Yaw:** Manuver pindah lajur dan menyalip menggunakan kurva S kecepatan lateral + sudut *yaw* kemudi sehingga hidung/ban depan berbelok lebih dulu dan badan kendaraan mengikuti secara halus.
  - **Gelombang Reaksi Lampu Hijau (*Start-Up Reaction Wave*):** Antrean memiliki jeda reaksi berjenjang secara monotonik per lajur saat lampu berubah menjadi hijau.
  - **Tactical Car Lane Change & Box Clearance:** Mobil lurus dapat berpindah lajur saat lampu hijau jika terhambat truk lambat, serta kendaraan tertahan di garis henti jika kotak simpang masih ditempati kendaraan dari lengan lain.
- **Kontrol Sinyal 4-Fase Bebas Konflik:**
  - Urutan fase `Utara → Timur → Selatan → Barat` dengan durasi **Hijau**, **Kuning**, dan **All-Red** yang dapat diatur.
  - **Edit-Lock Saat Berjalan:** Parameter simulasi dikunci saat status `RUNNING` untuk menjaga konsistensi data siklus (klik **Pause untuk Edit** untuk mengubah parameter).
- **UI Light Architectural / Swiss Grid:**
  - Kanvas HTML5 2D HiDPI dengan *offscreen static road caching*, lampu rem LED, lampu sein berkedip, dan ikon SVG arsitektural.
  - Telemetri *real-time* untuk **Keluar Fase Ini (1 Fase Hijau)**, **Keluar Siklus (4 Arah Penuh)**, **Antrean Aktif**, dan **Riwayat Periode**.

---

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite 6
- **Styling & Ikon:** Tailwind CSS, Lucide React, + 79 aset SVG kustom di `public/assets/`
- **Rendering:** HTML5 `<canvas>` 2D API (*offscreen static layer caching*)
- **Simulation Engine:** Pure TypeScript (`src/engine/`) tanpa ketergantungan DOM

---

## Struktur Proyek

```text
adabtive-signal/
├── assets/                   # Sumber 79 aset SVG (vehicles, infra, road, city, ui)
├── public/assets/            # Aset SVG statis yang disajikan oleh Vite
├── ui-concepts/              # Referensi mockup konsep UI awal
├── src/
│   ├── engine/
│   │   ├── types.ts          # Definisi tipe konfigurasi, kendaraan, sinyal & statistik
│   │   ├── geometry.ts       # Geometri LHT, kurva Bézier, PathCache & steering yaw
│   │   ├── simulation.ts     # Core engine (IDM, seepage, 4-fase sinyal, 2-pass update)
│   │   └── test_sim.ts       # Suite uji stres & validasi 2D lintas-lajur (CLI)
│   ├── canvas/
│   │   ├── assetLoader.ts    # Preloader & cache SVG
│   │   └── IntersectionCanvas.tsx # Renderer kanvas 2D HiDPI + offscreen caching
│   ├── components/
│   │   ├── TopBar.tsx        # Kontrol Play/Pause, Reset, Speed (1x/2x/5x), Zoom & Fase
│   │   ├── ParameterInspector.tsx # Editor parameter (Jalan, Kendaraan, Lampu) + Edit-Lock
│   │   └── TelemetryStrip.tsx # KPI keluar per fase, per siklus, antrean & riwayat
│   ├── App.tsx               # Orkestrasi loop simulasi requestAnimationFrame
│   └── main.tsx
├── BLUEPRINT.md              # Dokumen rancangan arsitektur & roadmap proyek
└── package.json
```

---

## Cara Menjalankan

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Menjalankan Mode Pengembangan (*Development Server*)
```bash
npm run dev
```
Buka URL lokal yang tampil di terminal (default `http://localhost:5173/`).

### 3. Build Produksi & Typecheck
```bash
npm run build
```

### 4. Menjalankan Pengujian Engine (*Headless Stress Test*)
```bash
npx tsx src/engine/test_sim.ts
```
Menguji kontinuitas 12 jalur belok LHT, skenario lajur sempit (`2.8m`) vs lebar (`4.0m`), skenario dominan kendaraan berat, mutasi konfigurasi, serta verifikasi nol *overlap* 2D dan nol `NaN`.

---

## Peta Jalan Pengembangan

Detail lengkap rencana pengembangan bertahap tersedia di [BLUEPRINT.md](BLUEPRINT.md):
- **Fase 1 (Selesai):** UI *Light Architectural / Swiss Grid* & *Core Simulation Engine* LHT Indonesia.
- **Fase 2:** Modul kalibrasi & perbandingan dengan data observasi persimpangan dunia nyata (*Ground Truth Matching*).
- **Fase 3:** *Model training* & optimasi durasi lampu lalu lintas otomatis.
sikatttttttt