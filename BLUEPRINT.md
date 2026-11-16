# Adaptive Signal — Project Blueprint & Development Flow

> **Status Dokumen:** Fase Diskusi & Perancangan Awal  
> **Fokus Saat Ini:** UI/UX yang Menarik & Sistem Simulasi Inti yang Berjalan (*Working Core System*)

---

## 1. Latar Belakang & Visi Proyek

### 1.1 Masalah yang Dipecahkan
Pengaturan durasi lampu lalu lintas (*traffic light*) di banyak persimpangan sering kali bersifat statis atau tidak adaptif terhadap kondisi lalu lintas yang sebenarnya. Hal ini menyebabkan:
- Antrean kendaraan menumpuk pada satu lengan persimpangan sementara lengan lain kosong.
- Pemborosan waktu tempuh, bahan bakar, dan peningkatan emisi akibat siklus lampu merah/hijau yang tidak optimal.

### 1.2 Visi Sistem (`Adaptive Signal`)
**Adaptive Signal** adalah sistem simulasi lalu lintas berbasis *digital twin* yang memungkinkan pengguna memodelkan kondisi persimpangan dunia nyata secara dinamis, menjalankan simulasi pergerakan kendaraan secara *real-time*, dan pada tahap selanjutnya melatih model (*machine learning* / *reinforcement learning*) menggunakan data kondisi jalan nyata untuk menghasilkan durasi lampu lalu lintas yang optimal.

---

## 2. Kriteria Optimalitas & Konsep Validasi Dunia Nyata

Kapan proyek ini dikatakan **optimal**?

> **Sistem dikatakan optimal apabila hasil simulasi di dalam sistem sama (atau mendekati akurat) dengan hasil yang terjadi di dunia nyata.**

### 2.1 Tolok Ukur Utama: *Throughput per Siklus Lampu*
Sebagai contoh konkret:
- Di dunia nyata, pada sebuah persimpangan dengan kondisi jalan tertentu, dalam **1 kali periode/siklus lampu merah–hijau**, tercatat ada sejumlah $N$ kendaraan yang berhasil keluar melewati persimpangan (misalnya: 18 motor, 7 mobil, 2 truk).
- Di dalam sistem **Adaptive Signal**, jika pengguna memasukkan parameter jalan, komposisi kendaraan, dan durasi lampu yang sama persis dengan kondisi lapangan tersebut, maka **jumlah kendaraan yang berhasil keluar dalam 1 siklus pada simulasi harus sesuai dengan angka di dunia nyata ($N_{\text{simulasi}} \approx N_{\text{nyata}}$)**.

### 2.2 Implikasi Desain
Karena validasi bergantung pada kesesuaian dengan dunia nyata, maka:
1. **Parameter harus dinamis dan fleksibel** agar bisa meniru berbagai bentuk dan kondisi jalan nyata.
2. **Perilaku fisik kendaraan** (ukuran, kecepatan, jarak aman, akselerasi antar jenis kendaraan) harus diperhitungkan secara realistis—bukan sekadar animasi acak.
3. **Metrik keluaran per siklus** (jumlah kendaraan keluar per fase/periode) harus tercatat dan tampil jelas di layar.

---

## 3. Parameter Dinamis yang Dapat Diedit Pengguna

Sistem harus memberi kebebasan penuh kepada pengguna untuk mengubah kondisi persimpangan secara langsung (*live/dynamic editing*):

### 3.1 Geometri & Ruas Jalan
| Parameter | Keterangan | Contoh Nilai |
|---|---|---|
| **Tipe Persimpangan** | Jumlah lengan simpang (Simpang 3, Simpang 4, atau ruas tunggal) | Simpang 4 |
| **Jumlah Lajur (*Lanes*)** | Banyaknya lajur per arah/lengan jalan | 1 – 4 lajur |
| **Lebar Jalan (*Road Width*)** | Mempengaruhi ruang gerak kendaraan (terutama selap-selip motor vs mobil/truk) | 3.5 m – 14 m |
| **Panjang Ruas (*Road Length*)** | Jarak area pengamatan/antrean sebelum garis henti | 50 m – 300 m |

### 3.2 Komposisi & Volume Kendaraan
Pengguna dapat mengatur jumlah atau laju kedatangan (*arrival rate*) untuk tiap jenis kendaraan secara terpisah karena masing-masing memiliki dimensi dan dinamika gerak yang berbeda:
- **Sepeda Motor:** Dimensi kecil, akselerasi cepat, dapat mengisi celah antar lajur (*lane filtering*).
- **Mobil Penumpang:** Dimensi sedang, akselerasi standar, mengikuti lajur secara disiplin.
- **Kendaraan Berat (Truk / Bus):** Dimensi panjang & lebar, akselerasi lambat, butuh ruang pengereman dan waktu melewati simpang lebih lama.

### 3.3 Pengaturan Sinyal Lampu Lalu Lintas
- **Durasi Lampu Hijau (*Green Time*)** per lengan/fase (detik).
- **Durasi Lampu Kuning (*Yellow/Amber Time*)** (detik).
- **Durasi Lampu Merah (*Red Time*)** / *All-Red Clearance* (detik).
- **Urutan Fase (*Phase Sequence*)** (misalnya: Utara–Selatan bergantian dengan Timur–Barat, atau per lengan satu per satu).

---

## 4. Alur Pengembangan (*Development Flow*)

Pengembangan dibagi menjadi 3 fase berurutan agar fondasi sistem kuat sebelum masuk ke fitur kompleks:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 1 (FOKUS SAAT INI): UI Menarik + Core Simulation Engine Berjalan   │
│ • Visualisasi persimpangan interaktif (2D Top-Down Canvas)              │
│ • Editor parameter dinamis (jalan, lebar, kendaraan, durasi lampu)      │
│ • Mesin simulasi berjalan real-time (antrean, lampu, kendaraan keluar)  │
│ • Penghitung kendaraan keluar per 1 siklus lampu                        │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 2: Kalibrasi & Perbandingan Dunia Nyata (Ground Truth Matching)    │
│ • Input data observasi dunia nyata (jumlah kendaraan keluar per siklus) │
│ • Indikator akurasi / selisih (Error Rate: Simulasi vs Dunia Nyata)     │
│ • Preset skenario persimpangan nyata & ekspor/impor konfigurasi         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FASE 3: Model Training & Optimasi Durasi Otomatis (AI / RL Engine)      │
│ • Training model dengan data jalan nyata yang sudah terkalibrasi        │
│ • Rekomendasi durasi lampu hijau/merah optimal otomatis                 │
│ • Mode perbandingan Before vs After optimasi                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Prinsip Fokus Fase 1 (Saat Ini)
- **Jangan menumpuk fitur sekunder dulu** (seperti login, database kompleks, ekspor PDF, atau AI training pipeline).
- **Prioritas utama:**
  1. **Sistem benar-benar berjalan:** Kendaraan muncul, mengantre saat lampu merah, bergerak saat hijau, dan dihitung saat keluar melewati garis simpang.
  2. **UI menarik, modern, dan intuitif:** Nyaman dilihat, responsif saat parameter diubah, dan visualisasi lalu lintasnya hidup/enak diamati.

---

## 5. Rancangan UI/UX Fase 1

Konsep desain mengarah ke **Traffic Control Center / Digital Twin Dashboard** yang bersih, modern, dan *data-driven*:

### 5.1 Tata Letak Layar Utama (*Layout*)
1. **Top Bar (Header & Playback Controls)**
   - Nama proyek (`Adaptive Signal`) & status simulasi (*Running / Paused*).
   - Tombol kontrol utama: **Play / Pause**, **Reset**, dan **Speed Multiplier** (`1x`, `2x`, `5x`).
   - Indikator waktu simulasi & nomor siklus lampu saat ini (*Cycle #1, #2, ...*).
2. **Area Tengah / Utama: Interactive Simulation Viewport (65%–70% layar)**
   - Kanvas 2D *top-down* yang merender ruas jalan, marka lajur, garis henti (*stop line*), lampu lalu lintas di tiap lengan (berubah warna Merah/Kuning/Hijau secara *real-time*), serta animasi kendaraan (motor, mobil, truk/bus) dengan ukuran proporsional terhadap lebar jalan.
   - Animasi halus: kendaraan mengerem saat mendekati lampu merah atau kendaraan di depannya, dan berakselerasi saat lampu hijau.
   - Indikator visual singkat saat kendaraan melewati garis keluar (penghitungan *throughput*).
3. **Panel Kanan: Dynamic Parameter Editor (30%–35% layar)**
   - **Tab / Bagian 1 — Geometri Jalan:** Slider/input untuk Panjang Jalan, Lebar Jalan, dan Jumlah Lajur. Perubahan langsung terlihat di kanvas!
   - **Tab / Bagian 2 — Komposisi Kendaraan:** Pengaturan jumlah/rasio Motor, Mobil, dan Kendaraan Berat.
   - **Tab / Bagian 3 — Durasi Lampu:** Slider durasi Hijau, Kuning, dan Merah per arah/fase.
4. **Panel Bawah / Overlay Metrik: Live Cycle Telemetry**
   - **Kendaraan Keluar Siklus Ini (*Current Cycle Exited*):** Rincian Motor, Mobil, Kendaraan Berat, dan Total.
   - **Riwayat per Periode (*Cycle History*):** Tabel/kartu ringkas hasil 1 periode lampu sebelumnya (misal: Siklus #1 = 24 kendaraan keluar, Siklus #2 = 26 kendaraan keluar).
   - **Panjang Antrean Aktif (*Current Queue*):** Jumlah kendaraan yang sedang tertahan di lampu merah.

---

## 6. Spesifikasi Teknis Core Simulation Engine (Fase 1)

Agar simulasi terasa realistis dan siap dikalibrasi dengan dunia nyata pada Fase 2, mesin simulasi menggunakan pendekatan *microscopic traffic simulation* ringan:

1. **Representasi Fisik & Skala:**
   - Menggunakan satuan dunia nyata (meter dan detik) yang dipetakan ke piksel di kanvas (`scale: px per meter`).
   - Dimensi standar kendaraan (dapat disesuaikan):
     - Motor: ~2.0 m × 0.8 m
     - Mobil: ~4.5 m × 1.8 m
     - Kendaraan Berat: ~9.0 m × 2.5 m
2. **Logika Pergerakan (*Car-Following & Signal Reaction*):**
   - Setiap kendaraan memiliki kecepatan aktual ($v$), kecepatan maksimum ($v_{\max}$), akselerasi ($a$), dan jarak aman minimum (*safe gap*).
   - Jika lampu di depan berwarna **Merah** atau **Kuning** (dan kendaraan masih di belakang *stop line*), target berhenti adalah *stop line*.
   - Jika ada kendaraan lain di depan dalam lajur yang sama, kendaraan menyesuaikan kecepatan agar tidak bertabrakan dan menjaga *safe gap*.
   - Ketika **Lebar Jalan** diperbesar, kapasitas ruang lateral meningkat (khususnya memungkinkan motor lebih leluasa mengisi celah antrean).
3. **Logika Siklus & Penghitungan *Throughput*:**
   - 1 Periode Siklus = seluruh fase lampu dari awal hingga kembali ke fase awal (atau per fase hijau tiap lengan).
   - Setiap kendaraan yang melintasi garis keluar simpang (*exit line*) akan dicatat sebagai `exited` pada siklus yang sedang aktif, dipisahkan berdasarkan kategori (Motor, Mobil, Kendaraan Berat).

---

## 7. Rekomendasi Tech Stack (Ringan & Cepat untuk Fase 1)

Agar pengembangan UI dan mesin simulasi berjalan cepat, mulus (60 FPS), dan mudah dikembangkan ke tahap ML/Backend nanti:

- **Frontend Framework:** React + TypeScript + Vite (cepat, modular, *type-safe*).
- **Styling & UI Components:** Tailwind CSS + Lucide Icons (untuk tampilan dashboard modern yang bersih dan responsif).
- **Simulation Rendering:** HTML5 `<canvas>` 2D API (performa tinggi untuk merender puluhan hingga ratusan kendaraan bergerak di 60 FPS tanpa membebani DOM).
- **Simulation Engine:** Modul TypeScript murni (`src/engine/`) yang terpisah dari komponen React, sehingga logika fisika & lalu lintas bersih, terukur, dan mudah dihubungkan ke API/model ML di masa depan.

---

## 8. Definisi "Done" untuk Fase 1

Fase 1 dianggap selesai dan siap diuji apabila:
- [ ] Aplikasi web dapat dijalankan secara lokal tanpa error.
- [ ] Kanvas persimpangan tampil proporsional dan merespons perubahan **Lebar Jalan**, **Panjang Ruas**, dan **Jumlah Lajur** secara langsung.
- [ ] Kendaraan (Motor, Mobil, Kendaraan Berat) dapat di-spawn sesuai pengaturan user, bergerak, mengantre di lampu merah, dan melaju saat lampu hijau tanpa saling menabrak/tumpang tindih.
- [ ] Durasi lampu merah, kuning, dan hijau dapat diubah secara dinamis dan langsung memengaruhi siklus lampu di kanvas.
- [ ] Sistem menghitung dan menampilkan dengan akurat **berapa kendaraan yang berhasil keluar dalam 1 kali periode lampu**.
- [ ] Tampilan UI terlihat modern, rapi, dan nyaman digunakan untuk eksperimen parameter.
