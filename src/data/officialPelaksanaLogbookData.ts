import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';
import {
  db,
  cleanFirestoreData,
  handleFirestoreError,
  OperationType,
  isFirestoreQuotaExhausted
} from '../services/firebase.ts';
import type {
  OfficialLogbookItem,
  OfficialNurseLogbookMonth,
  PatientHDSession,
  ShiftName,
  SystemAccessRole
} from '../types/dialysis.ts';
import { getWibDateParts } from '../utils/dateHelpers.ts';

export interface LogbookHarianSpoItemValue {
  code: string;
  verified: boolean;
  catatan?: string;
}

export interface LogbookHarianPatientSummary {
  id?: string;
  bedNumber: string;
  patientName: string;
  medicalRecord?: string;
  status?: 'belum_diajukan' | 'diajukan' | 'terverifikasi';
  submittedAt?: string;
  submittedEpoch?: number;
  verifiedAt?: string;
  verifiedBy?: string;
  verifiedByRole?: string;
  verifierNotes?: string;
  revisionRequested?: boolean;
  revisionRequestedAt?: string;
  revisionRequestedBy?: string;
  revisionRequestedByRole?: string;
  revisionEpoch?: number;
}

export interface LogbookHarianRecord {
  id: string;
  tanggal: string; // YYYY-MM-DD
  tanggalLabel?: string;
  shift: string;
  perawatId: string;
  namaPerawat: string;
  nipPerawat?: string;
  perawatRole?: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan';
  targetRole?: 'pj_shift' | 'kepala_ruangan' | 'mandiri';
  targetVerifierName?: string;
  items: LogbookHarianSpoItemValue[];
  facilityStatuses?: Record<string, boolean>;
  patientStatuses?: Record<string, Record<string, boolean>>;
  clinicalDetails?: Record<string, any>;
  statusVerifikasi: 'draft' | 'submitted' | 'verified_pj' | 'verified_karu';
  verifikatorPjId?: string;
  verifikatorPjNama?: string;
  verifiedPjAt?: string;
  verifikatorKaruId?: string;
  verifikatorKaruNama?: string;
  verifiedKaruAt?: string;
  submittedAt?: string;
  submittedEpoch?: number;
  pelaksanaNotes?: string;
  verifierNotes?: string;
  revisionRequested?: boolean;
  revisionRequestedAt?: string;
  revisionRequestedBy?: string;
  revisionRequestedByRole?: string;
  revisionEpoch?: number;
  dokterDpjp?: string;
  dokterJaga?: string;
  patients?: LogbookHarianPatientSummary[];
  sessionsSnapshot?: PatientHDSession[];
  updatedAt?: string;
}

// ============================================================================
// 29 STANDAR SPO LOGBOOK HARIAN PERAWAT HEMODIALISA (BAGIAN I s/d BAGIAN VI)
// ============================================================================
export const OFFICIAL_LOGBOOK_ITEMS: OfficialLogbookItem[] = [
  // BAGIAN I: Kesiapan Fasilitas Ruangan Hemodialisis & Sistem Water Treatment (RO) (3 Poin)
  {
    code: '1.1',
    bagian: 1,
    bagianTitle: 'Kesiapan Fasilitas Ruangan Hemodialisis & Sistem Water Treatment (RO)',
    category: 'Water Treatment & Mutu Air RO',
    shortTitle: 'Memastikan Kesiapan RO & Water Treatment',
    simpleGuide: 'Periksa konduktivitas air RO (< 10 µS/cm), tekanan pompa distribusi, level garam softner, dan bebas klorin/kloramin sebelum shift dimulai.',
    keyMetrics: ['TDS / Konduktivitas RO < 10 µS/cm', 'Total Chlorine < 0.1 mg/L', 'Tekanan Loop RO Stabil'],
    notePlaceholder: 'Catat hasil TDS/konduktivitas RO & jam pengecekan...',
    quickNotes: ['Air RO memenuhi syarat AAMI (< 10 µS/cm)', 'Tekanan loop & pre-treatment normal'],
    description: 'Memastikan kesiapan sistem Water Treatment (Reverse Osmosis / RO), uji konduktivitas, tekanan sirkulasi, serta kualitas air dialisis sesuai baku mutu AAMI/PERNEFRI.',
    standardSpo: 'SPO-HD-01: Mutu Air RO & Pre-Treatment Harian'
  },
  {
    code: '1.2',
    bagian: 1,
    bagianTitle: 'Kesiapan Fasilitas Ruangan Hemodialisis & Sistem Water Treatment (RO)',
    category: 'Kesiapan Ruangan & Zonasi Infeksi',
    shortTitle: 'Kesiapan Ruangan, Suhu & Lingkungan Unit HD',
    simpleGuide: 'Pastikan suhu ruangan 20–24°C, kelembaban 40–60%, pencahayaan cukup, kebersihan bed, serta pemisahan tegas zona Reguler dan Isolasi Hep B / Hep C.',
    keyMetrics: ['Suhu 20–24°C', 'Zonasi Reguler & Isolasi Terpisah', 'Linen & Bed Siap Pakai'],
    notePlaceholder: 'Catat kondisi suhu ruangan & kesiapan bed...',
    quickNotes: ['Suhu & kelembaban ruangan sesuai standar', 'Zonasi Reguler & Isolasi siap pakai'],
    description: 'Memastikan kesiapan ruangan hemodialisis, suhu dan kelembaban lingkungan, sanitasi permukaan tempat tidur, serta kepatuhan pemisahan area infeksius (Hepatitis B/C).',
    standardSpo: 'SPO-HD-02: Kesiapan Lingkungan & PPI Unit Dialisis'
  },
  {
    code: '1.3',
    bagian: 1,
    bagianTitle: 'Kesiapan Fasilitas Ruangan Hemodialisis & Sistem Water Treatment (RO)',
    category: 'Emergency Room & Troli Emergensi',
    shortTitle: 'Kesiapan Emergency Room & Emergency Tools',
    simpleGuide: 'Periksa segel troli emergensi, kelengkapan obat life-saving (Epinefrin, Sulfas Atropin, Dextrose 40%, NaCl 0,9%), defibrilator, ambubag, dan oksigen sentral.',
    keyMetrics: ['Troli Emergensi Terkunci/Lengkap', 'Oksigen & Suction Siap', 'Defibrilator Ready'],
    notePlaceholder: 'Catat status segel troli darurat & alat resusitasi...',
    quickNotes: ['Troli emergensi lengkap & siap pakai', 'Oksigen sentral, suction & defibrilator berfungsi baik'],
    description: 'Memastikan kesiapan fasilitas kegawatdaruratan (Emergency Trolley, obat-obatan emergensi, defibrilator, oksigen sentral, dan suction) sebelum pelayanan dimulai.',
    standardSpo: 'SPO-HD-03: Pemeriksaan Troli & Peralatan Emergensi HD'
  },

  // BAGIAN II: Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD) (6 Poin)
  {
    code: '2.1',
    bagian: 2,
    bagianTitle: 'Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD)',
    category: 'PPI & Keselamatan Petugas',
    shortTitle: 'Kepatuhan 5 Momen Cuci Tangan & Penggunaan APD Lengkap',
    simpleGuide: 'Lakukan hand hygiene 6 langkah pada 5 momen WHO dan gunakan APD lengkap (masker medis, apron/gown kedap air, goggle/faceshield, sarung tangan bersih/steril).',
    keyMetrics: ['Hand Hygiene 5 Momen', 'APD Lengkap Sesuai Zona'],
    notePlaceholder: 'Catat kepatuhan APD & cuci tangan...',
    quickNotes: ['APD lengkap & 5 momen cuci tangan dipatuhi'],
    description: 'Melaksanakan kepatuhan kebersihan tangan (5 Moments for Hand Hygiene) dan pemakaian Alat Pelindung Diri (APD) standar dialisis sebelum kontak pasien/mesin.',
    standardSpo: 'SPO-PPI-01: Hand Hygiene & Penggunaan APD Dialisis'
  },
  {
    code: '2.2',
    bagian: 2,
    bagianTitle: 'Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD)',
    category: 'Kalibrasi & Uji Fungsi Mesin',
    shortTitle: 'Self-Test Otomatis & Kalibrasi Fungsional Mesin HD',
    simpleGuide: 'Nyalakan mesin HD dan pastikan seluruh tahapan automated self-test (T1 test: hidrolik, pompa darah, UF module, bypass) lulus tanpa kode error.',
    keyMetrics: ['T1 / Self-Test Passed', 'Bebas Kode Alarm Teknis'],
    notePlaceholder: 'Catat hasil self-test mesin HD...',
    quickNotes: ['Self-test T1 mesin lulus sempurna (Passed)'],
    description: 'Menjalankan pengujian fungsi otomatis (Automated Self-Test / T1 Test) pada mesin hemodialisis hingga seluruh modul hidrolik dan elektrikal dinyatakan layak pakai.',
    standardSpo: 'SPO-HD-04: Pengoperasian & Self-Test Mesin HD'
  },
  {
    code: '2.3',
    bagian: 2,
    bagianTitle: 'Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD)',
    category: 'Keamanan Sirkuit Ekstrakorporeal',
    shortTitle: 'Verifikasi Sensor Blood Leak Detector (BLD) & Air Trap Detector',
    simpleGuide: 'Pastikan sensor kebocoran darah (BLD) dan detektor gelembung udara (ultrasonic air detector + venous clamp) aktif dan merespons dengan akurat.',
    keyMetrics: ['Sensor BLD Aktif', 'Air Detector & Venous Clamp Aktif'],
    notePlaceholder: 'Catat fungsi sensor BLD & detektor udara...',
    quickNotes: ['Sensor BLD & detektor udara aktif normal'],
    description: 'Memverifikasi kepekaan sensor keamanan utama mesin meliputi Blood Leak Detector (BLD), Air Bubble Detector, dan klem pengaman vena otomatis.',
    standardSpo: 'SPO-HD-05: Verifikasi Sistem Alarm Keamanan Mesin'
  },
  {
    code: '2.4',
    bagian: 2,
    bagianTitle: 'Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD)',
    category: 'Komposisi & Suhu Dialisat',
    shortTitle: 'Pengecekan Konduktivitas Cairan Dialisat (Acid & Bikarbonat) & Suhu',
    simpleGuide: 'Pastikan konsentrat Acid & Bikarbonat terpasang benar, konduktivitas dialisat stabil di 13.5–14.5 mS/cm, dan suhu dialisat 36.0–37.0°C.',
    keyMetrics: ['Konduktivitas 13.5–14.5 mS/cm', 'Suhu Dialisat 36.0–37.0°C'],
    notePlaceholder: 'Catat nilai konduktivitas & suhu dialisat...',
    quickNotes: ['Konduktivitas 14.0 mS/cm, suhu 36.5°C stabil'],
    description: 'Memeriksa ketepatan komposisi cairan konsentrat (Acid & Bicarbonate), kestabilan konduktivitas (13.5–14.5 mS/cm), serta suhu cairan dialisat (36.0–37.0°C).',
    standardSpo: 'SPO-HD-06: Persiapan Konsentrat & Parameter Dialisat'
  },
  {
    code: '2.5',
    bagian: 2,
    bagianTitle: 'Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD)',
    category: 'Pemasangan Sirkuit & Priming',
    shortTitle: 'Pemasangan Blood Line, Dialyzer & Priming Sirkuit Steril NaCl 0,9%',
    simpleGuide: 'Pasang dialyzer dan bloodline secara aseptik, lakukan pembilasan (priming) dengan NaCl 0,9% minimal 500–1000 mL hingga sirkuit bebas udara dan residu.',
    keyMetrics: ['Teknik Aseptik', 'Sirkuit Bebas Gelembung Udara'],
    notePlaceholder: 'Catat tipe dialyzer & volume NaCl priming...',
    quickNotes: ['Priming NaCl 0,9% selesai, sirkuit bebas udara'],
    description: 'Memasang dialyzer dan blood tubing set secara aseptik serta melakukan priming menggunakan NaCl 0,9% hingga seluruh udara dan partikel residu terbilas bersih.',
    standardSpo: 'SPO-HD-07: Pemasangan Sirkuit & Priming Dialyzer'
  },
  {
    code: '2.6',
    bagian: 2,
    bagianTitle: 'Persiapan Perawat, Peralatan, Mesin HD & Alat Kesehatan (Pre-HD)',
    category: 'Antikoagulasi & Kit Kanulasi',
    shortTitle: 'Persiapan Antikoagulan (Heparin) & Kelengkapan Set Kanulasi/AksesSteril',
    simpleGuide: 'Siapkan spuit heparin sesuai dosis resep (Standar/Minimal/Free Heparin) pada syringe pump serta siapkan set dressing/kanulasi AV Fistula atau perawatan CDL steril.',
    keyMetrics: ['Dosis Heparin Terverifikasi', 'Set Kanulasi / Dressing Steril'],
    notePlaceholder: 'Catat dosis heparin & kesiapan alat kanulasi...',
    quickNotes: ['Heparin & set kanulasi steril siap digunakan'],
    description: 'Menyiapkan spuit antikoagulan (Heparin/LMWH atau program Free Heparin) pada syringe pump serta kelengkapan set steril kanulasi AVF atau perawatan kateter CDL.',
    standardSpo: 'SPO-HD-08: Persiapan Antikoagulasi & Alat Akses Vaskular'
  },

  // BAGIAN III: Identifikasi Pasien, Pengkajian Pre-HD & Patient Safety (6 Poin)
  {
    code: '3.1',
    bagian: 3,
    bagianTitle: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan Pasien (Patient Safety)',
    category: 'Sasaran Keselamatan Pasien (SKP 1)',
    shortTitle: 'Identifikasi Pasien (Verbal & Non-Verbal), Status Rawat & Zonasi',
    simpleGuide: 'Cocokkan minimal 2 identitas (Nama Lengkap & Tanggal Lahir / No. RM) secara verbal dan gelang/berkas RM, serta pastikan status Rawat Jalan/Inap & kategori zonasi.',
    keyMetrics: ['2 Identitas Cocok (SKP 1)', 'Status Rawat & Zona Tepat'],
    notePlaceholder: 'Catat hasil verifikasi identitas & status rawat...',
    quickNotes: ['Identitas SKP 1 sesuai nama, tgl lahir & No. RM'],
    description: 'Melakukan identifikasi aktif pasien menggunakan minimal 2 penanda resmi (Nama Lengkap, Tanggal Lahir, Nomor RM) serta memvalidasi status rawat dan ruang zonasi infeksi.',
    standardSpo: 'SPO-SKP-01: Ketepatan Identifikasi Pasien Pre-Tindakan'
  },
  {
    code: '3.2',
    bagian: 3,
    bagianTitle: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan Pasien (Patient Safety)',
    category: 'Evaluasi Cairan & Berat Badan',
    shortTitle: 'Penimbangan Berat Badan Pre-HD, BB Kering & Perhitungan IDWG',
    simpleGuide: 'Timbang BB Pre-HD secara akurat, bandingkan terhadap BB Kering (Dry Weight), hitung kenaikan berat badan interdialitik (IDWG), dan evaluasi tanda overload cairan.',
    keyMetrics: ['BB Pre-HD & BB Kering Tercatat', 'IDWG Terhitung Akurat'],
    notePlaceholder: 'Catat BB Kering, BB Pre-HD & selisih IDWG...',
    quickNotes: ['BB Pre-HD, BB Kering & IDWG terukur akurat'],
    description: 'Menimbang Berat Badan Pre-HD, membandingkannya dengan Berat Badan Kering (Dry Weight), menghitung Interdialytic Weight Gain (IDWG), dan mengkaji status hidrasi/edema.',
    standardSpo: 'SPO-HD-09: Pengkajian Status Cairan & Penetapan UF'
  },
  {
    code: '3.3',
    bagian: 3,
    bagianTitle: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan Pasien (Patient Safety)',
    category: 'Pengkajian Hemodinamik Awal',
    shortTitle: 'Pemeriksaan Tanda-Tanda Vital (TD, Nadi, RR, Suhu, SpO2) Pre-HD',
    simpleGuide: 'Ukur Tekanan Darah (duduk/berbaring), frekuensi nadi, laju pernapasan, suhu tubuh, dan saturasi oksigen (SpO2) sebelum memulai kanulasi/sirkulasi darah.',
    keyMetrics: ['TD, Nadi, RR, Suhu & SpO2 Tercatat', 'Hemodinamik Layak HD'],
    notePlaceholder: 'Catat TD, Nadi, RR, Suhu & SpO2 Pre-HD...',
    quickNotes: ['TTV Pre-HD tercatat & hemodinamik stabil untuk HD'],
    description: 'Melakukan pengukuran lengkap Tanda-Tanda Vital (Tekanan Darah, Nadi, Pernapasan, Suhu, dan SpO2) serta keluhan subjektif pasien sebelum inisiasi hemodialisis.',
    standardSpo: 'SPO-HD-10: Pengkajian Keperawatan & Hemodinamik Pre-HD'
  },
  {
    code: '3.4',
    bagian: 3,
    bagianTitle: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan Pasien (Patient Safety)',
    category: 'Skrining Risiko Jatuh & Persetujuan Tindakan',
    shortTitle: 'Asesmen Risiko Jatuh (Morse/Humpty) & Validasi Informed Consent',
    simpleGuide: 'Lakukan asesmen risiko jatuh (pasang penanda kuning & kunci roda bed bila berisiko) serta pastikan dokumen Informed Consent tindakan HD masih berlaku dan lengkap.',
    keyMetrics: ['Risiko Jatuh Terkaji & Roda Bed Terkunci', 'Informed Consent Lengkap'],
    notePlaceholder: 'Catat skor risiko jatuh & kelengkapan informed consent...',
    quickNotes: ['Asesmen risiko jatuh & informed consent valid lengkap'],
    description: 'Melaksanakan pengkajian risiko jatuh (SKP 6: penguncian roda bed, pemasangan pengaman sisi tempat tidur) dan memverifikasi kelengkapan Informed Consent tindakan HD.',
    standardSpo: 'SPO-SKP-06: Pencegahan Risiko Jatuh & Informed Consent HD'
  },
  {
    code: '3.5',
    bagian: 3,
    bagianTitle: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan Pasien (Patient Safety)',
    category: 'Verifikasi Preskripsi Dialisis',
    shortTitle: 'Verifikasi Resep HD DPJP (Durasi, Target UFG, QB, QD & Dosis Heparin)',
    simpleGuide: 'Konfirmasi preskripsi DPJP meliputi durasi jam HD, Target Ultrafiltrasi (UFG), kecepatan aliran darah (QB), aliran dialisat (QD), dan regimen heparinisasi.',
    keyMetrics: ['Time, Target UFG, QB, QD & Heparin Sesuai Advis DPJP'],
    notePlaceholder: 'Catat durasi HD, Target UFG, QB, QD & Heparin...',
    quickNotes: ['Parameter resep HD sesuai instruksi DPJP'],
    description: 'Memverifikasi dan memprogram parameter resep hemodialisis dari DPJP ke mesin meliputi durasi tindakan (Time), Target UFG, QB, QD, serta dosis antikoagulan.',
    standardSpo: 'SPO-HD-11: Verifikasi Preskripsi Medis Hemodialisis'
  },
  {
    code: '3.6',
    bagian: 3,
    bagianTitle: 'Identifikasi Pasien, Pengkajian Pre-HD & Keselamatan Pasien (Patient Safety)',
    category: 'Manajemen Akses Vaskular & Inisiasi',
    shortTitle: 'Pengkajian & Kanulasi Akses Vaskular (AV Shunt Cimino / CDL / Femoral)',
    simpleGuide: 'Inspeksi/palpasi/auskultasi bruit & thrill pada AVF Cimino atau evaluasi exit-site CDL/Femoral, lakukan antisepsis CHG 2%/alkohol, kanulasi/koneksi secara aseptik & fiksasi aman.',
    keyMetrics: ['Bruit/Thrill AVF Baik atau Lumen CDL Lancar', 'Teknik Aseptik & Fiksasi Aman'],
    notePlaceholder: 'Catat jenis akses vaskular, lokasi & nama perawat pelaksana akses...',
    quickNotes: ['Kanulasi AVF / koneksi CDL aseptik lancar tanpa hematom'],
    description: 'Mengkaji patensi akses vaskular (bruit/thrill AVF atau kepatenan dan exit-site CDL/Femoral) serta melakukan kanulasi atau penyambungan sirkuit dengan teknik aseptik.',
    standardSpo: 'SPO-HD-12: Kanulasi AV Fistula & Perawatan Kateter CDL'
  },

  // BAGIAN IV: Monitoring Intra-HD & Pencegahan Insiden Keselamatan Pasien (IKP) (4 Poin)
  {
    code: '4.1',
    bagian: 4,
    bagianTitle: 'Monitoring Intra-HD & Pencegahan Insiden Keselamatan Pasien (IKP)',
    category: 'Observasi Berkala Hemodinamik',
    shortTitle: 'Observasi Tanda Vital, Keluhan Pasien & Parameter Mesin Setiap Jam',
    simpleGuide: 'Pantau dan dokumentasikan TD, Nadi, RR, kesadaran, QB, QD, UF Rate, dan kumulatif UF setiap 60 menit (atau tiap 15–30 menit pada pasien kritis/tidak stabil).',
    keyMetrics: ['Flowsheet TTV Per Jam Lengkap', 'Respon Cepat Perubahan Hemodinamik'],
    notePlaceholder: 'Catat tren TD Intra-HD & kondisi umum pasien...',
    quickNotes: ['TTV & parameter mesin terpantau stabil tiap jam'],
    description: 'Melakukan pemantauan berkala dan pencatatan pada lembar observasi intra-HD setiap jam meliputi Tekanan Darah, Nadi, kesadaran, QB, UF Rate, dan volume UF tercapai.',
    standardSpo: 'SPO-HD-13: Monitoring Intra-Hemodialisis Terpadu'
  },
  {
    code: '4.2',
    bagian: 4,
    bagianTitle: 'Monitoring Intra-HD & Pencegahan Insiden Keselamatan Pasien (IKP)',
    category: 'Keamanan Sirkuit & Tekanan Ekstrakorporeal',
    shortTitle: 'Pemantauan Tekanan Arteri (AP), Tekanan Vena (VP), TMP & Risiko Clotting',
    simpleGuide: 'Awasi tren Arterial Pressure, Venous Pressure, dan Transmembrane Pressure (TMP), pastikan posisi jarum/kateter tidak tertekuk/dislodgement, dan cegah pembekuan sirkuit.',
    keyMetrics: ['AP, VP & TMP Dalam Batas Aman', 'Akses Terlihat (Uncovered) & Bebas Clotting'],
    notePlaceholder: 'Catat evaluasi tekanan vena/arteri, TMP & kondisi sirkuit...',
    quickNotes: ['Tekanan AP, VP & TMP stabil, sirkuit lancar bebas clotting'],
    description: 'Memantau indikator tekanan ekstrakorporeal (Arterial Pressure, Venous Pressure, TMP), keamanan fiksasi jarum/kateter dari risiko venous needle dislodgement, dan tanda clotting.',
    standardSpo: 'SPO-HD-14: Pemantauan Sirkuit Ekstrakorporeal & Pencegahan IKP'
  },
  {
    code: '4.3',
    bagian: 4,
    bagianTitle: 'Monitoring Intra-HD & Pencegahan Insiden Keselamatan Pasien (IKP)',
    category: 'Deteksi & Tata Laksana Komplikasi Akut',
    shortTitle: 'Deteksi Dini & Tata Laksana Komplikasi Intra-HD (Hipotensi, Kram, Menggigil)',
    simpleGuide: 'Identifikasi segera gejala hipotensi intradialitik, hipertensi, kram otot, mual/muntah, nyeri dada, atau reaksi pirogenik, serta lakukan intervensi keperawatan darurat sesuai SPO.',
    keyMetrics: ['Deteksi Dini Komplikasi', 'Tindakan Korektif Cepat & Terukur'],
    notePlaceholder: 'Catat komplikasi intra-HD (jika ada) & tindakan keperawatan...',
    quickNotes: ['Tidak ada komplikasi intra-HD', 'Komplikasi tertangani sesuai SPO'],
    description: 'Mendeteksi secara dini dan melaksanakan intervensi keperawatan cepat terhadap komplikasi akut intra-HD (hipotensi, kram otot, mual/muntah, menggigil, clotting, perdarahan akses).',
    standardSpo: 'SPO-HD-15: Penanganan Komplikasi Akut Intra-Hemodialisis'
  },
  {
    code: '4.4',
    bagian: 4,
    bagianTitle: 'Monitoring Intra-HD & Pencegahan Insiden Keselamatan Pasien (IKP)',
    category: 'Komunikasi Efektif SBAR / TBAK Medis',
    shortTitle: 'Kolaborasi Medis, Pelaporan Kondisi Kritis & Konfirmasi Advis DPJP (SBAR/TBAK)',
    simpleGuide: 'Laporkan perubahan klinis bermakna kepada Dokter Jaga / DPJP dengan metode SBAR dan dokumentasikan instruksi terapi/modifikasi resep menggunakan prinsip TBAK.',
    keyMetrics: ['Komunikasi SBAR Efektif', 'Advis DPJP / Dokter Jaga Terdokumentasi'],
    notePlaceholder: 'Catat kolaborasi dokter jaga/DPJP & advis medis...',
    quickNotes: ['Kolaborasi & evaluasi medis berjalan baik sesuai SBAR'],
    description: 'Melaksanakan kolaborasi medis serta pelaporan perubahan kondisi klinis pasien kepada Dokter Jaga Ruangan atau DPJP menggunakan komunikasi efektif SBAR dan verifikasi TBAK.',
    standardSpo: 'SPO-SKP-02: Komunikasi Efektif SBAR & TBAK di Unit HD'
  },

  // BAGIAN V: Edukasi Terstruktur Kepada Pasien & Keluarga (5 Poin)
  {
    code: '5.1',
    bagian: 5,
    bagianTitle: 'Edukasi Terstruktur Kepada Pasien & Keluarga (Diet, Cairan, Kebersihan Diri)',
    category: 'Manajemen Cairan & Pembatasan IDWG',
    shortTitle: 'Edukasi Pembatasan Asupan Cairan Harian & Pengendalian IDWG (< 3–4% BB)',
    simpleGuide: 'Edukasi takaran minum harian (volume urin 24 jam + 500 mL IWL), tips mengatasi haus, serta target kenaikan BB antar-dialisis tidak melebihi 3–4% dari BB kering.',
    keyMetrics: ['Target IDWG < 3–4% BB Kering', 'Takaran Cairan Harian Dipahami'],
    notePlaceholder: 'Catat materi edukasi pembatasan cairan...',
    quickNotes: ['Pasien/keluarga memahami batas asupan cairan harian'],
    description: 'Memberikan edukasi terstruktur kepada pasien dan keluarga mengenai perhitungan batas asupan cairan harian dan pengendalian kenaikan berat badan interdialitik (IDWG).',
    standardSpo: 'SPO-KIE-01: Edukasi Manajemen Cairan Pasien Hemodialisis'
  },
  {
    code: '5.2',
    bagian: 5,
    bagianTitle: 'Edukasi Terstruktur Kepada Pasien & Keluarga (Diet, Cairan, Kebersihan Diri)',
    category: 'Nutrisi & Diet Ginjal Kronik',
    shortTitle: 'Edukasi Diet Rendah Kalium, Fosfat, Natrium & Cukup Protein Biologis Tinggi',
    simpleGuide: 'Jelaskan pemilihan makanan rendah kalium (hindari pisang/air kelapa berlebih), rendah garam/natrium, batasi fosfat, serta kecukupan protein (putih telur, ikan) agar tidak malnutrisi.',
    keyMetrics: ['Diet Rendah Kalium, Natrium & Fosfat', 'Asupan Protein Adekuat'],
    notePlaceholder: 'Catat edukasi nutrisi & pantangan diet...',
    quickNotes: ['Edukasi diet rendah kalium/garam & cukup protein diberikan'],
    description: 'Memberikan penyuluhan gizi dialisis terkait pembatasan kalium, natrium, dan fosfat serta pemenuhan protein bernilai biologis tinggi guna mencegah hiperkalemia dan malnutrisi.',
    standardSpo: 'SPO-KIE-02: Edukasi Nutrisi & Diet Pasien Dialisis'
  },
  {
    code: '5.3',
    bagian: 5,
    bagianTitle: 'Edukasi Terstruktur Kepada Pasien & Keluarga (Diet, Cairan, Kebersihan Diri)',
    category: 'Perawatan Mandiri Akses Vaskular',
    shortTitle: 'Edukasi Perawatan Akses Vaskular (AV Shunt / Kateter CDL) & Tanda Infeksi di Rumah',
    simpleGuide: 'Ajarkan menjaga balutan CDL tetap kering/bersih, larangan tensi/angkat beban pada lengan AV Shunt, raba getaran thrill tiap hari, dan tanda bahaya perdarahan/infeksi.',
    keyMetrics: ['Cek Thrill Mandiri / Balutan CDL Kering', 'Kenali Tanda Perdarahan & Infeksi'],
    notePlaceholder: 'Catat edukasi perawatan AVF/CDL di rumah...',
    quickNotes: ['Pasien memahami cara merawat akses vaskular di rumah'],
    description: 'Mengedukasi pasien dan keluarga tentang cara menjaga kebersihan dan patensi akses vaskular (AVF/CDL) di rumah serta penanganan darurat bila terjadi perdarahan atau tanda infeksi.',
    standardSpo: 'SPO-KIE-03: Edukasi Perawatan Mandiri Akses Vaskular'
  },
  {
    code: '5.4',
    bagian: 5,
    bagianTitle: 'Edukasi Terstruktur Kepada Pasien & Keluarga (Diet, Cairan, Kebersihan Diri)',
    category: 'Kepatuhan Obat & Jadwal HD',
    shortTitle: 'Edukasi Kepatuhan Obat Rutin (Antihipertensi, Pengikat Fosfat, EPO) & Jadwal HD',
    simpleGuide: 'Ingatkan aturan minum obat antihipertensi (sebelum/sesudah HD sesuai instruksi dokter), cara konsumsi CaCO3 bersama makan, terapi eritropoietin, dan disiplin jadwal HD.',
    keyMetrics: ['Kepatuhan Regimen Obat', 'Disiplin Kehadiran Jadwal HD'],
    notePlaceholder: 'Catat edukasi kepatuhan obat & jadwal rutin HD...',
    quickNotes: ['Edukasi jadwal HD rutin & aturan obat dipahami'],
    description: 'Mengedukasi ketepatan waktu konsumsi obat-obatan rutin pasien dialisis (antihipertensi, pengikat fosfat, suplementasi zat besi/EPO) dan pentingnya kepatuhan jadwal HD.',
    standardSpo: 'SPO-KIE-04: Edukasi Rekonsiliasi Obat & Kepatuhan Terapi HD'
  },
  {
    code: '5.5',
    bagian: 5,
    bagianTitle: 'Edukasi Terstruktur Kepada Pasien & Keluarga (Diet, Cairan, Kebersihan Diri)',
    category: 'Verifikasi Pemahaman (Teach-Back)',
    shortTitle: 'Evaluasi Pemahaman Pasien/Keluarga dengan Metode Teach-Back & Dokumentasi KIE',
    simpleGuide: 'Minta pasien/pendamping mengulangi poin kunci edukasi dengan bahasa sendiri (Teach-Back) dan lengkapi pencatatan pada formulir edukasi terintegrasi.',
    keyMetrics: ['Evaluasi Teach-Back Tervalidasi', 'Formulir KIE Terdokumentasi'],
    notePlaceholder: 'Catat hasil verifikasi pemahaman metode Teach-Back...',
    quickNotes: ['Pasien/keluarga mampu mengulang materi edukasi (Teach-Back valid)'],
    description: 'Memvalidasi tingkat pemahaman pasien dan keluarga terhadap materi edukasi melalui metode Teach-Back serta mendokumentasikannya pada rekam edukasi terintegrasi.',
    standardSpo: 'SPO-KIE-05: Evaluasi Edukasi Pasien Metode Teach-Back'
  },

  // BAGIAN VI: Terminasi Aman, Evaluasi Post-HD, Disinfeksi Mesin & Pendokumentasian (5 Poin)
  {
    code: '6.1',
    bagian: 6,
    bagianTitle: 'Terminasi Aman, Evaluasi Post-HD, Disinfeksi Mesin & Pendokumentasian',
    category: 'Prosedur Terminasi & Re-infusi',
    shortTitle: 'Prosedur Terminasi & Pengembalian Darah (Re-infusi NaCl 0,9%) Secara Tertutup & Aman',
    simpleGuide: 'Kembalikan darah dari sirkuit ekstrakorporeal ke tubuh pasien dengan bilasan NaCl 0,9% kecepatan rendah secara tertutup (closed system) tanpa risiko emboli udara.',
    keyMetrics: ['Closed-System Re-infusion', 'Bebas Emboli Udara & Sisa Clotting'],
    notePlaceholder: 'Catat kelancaran terminasi & re-infusi darah...',
    quickNotes: ['Re-infusi NaCl 0,9% tertutup berjalan lancar & aman'],
    description: 'Terminasi HD Aman (Washback)',
    standardSpo: 'SPO-HD-16: Prosedur Terminasi & Re-infusi Aman'
  },
  {
    code: '6.2',
    bagian: 6,
    bagianTitle: 'Terminasi Aman, Evaluasi Post-HD, Disinfeksi Mesin & Pendokumentasian',
    category: 'Hemostasis & Penutupan Akses Vaskular',
    shortTitle: 'Pencabutan Jarum Kanulasi & Hemostasis AVF atau Heparin-Lock & Dressing Steril CDL',
    simpleGuide: 'Cabut jarum AVF dengan sudut tepat dan tekan titik punksi 10–15 menit hingga hemostasis sempurna (bruit tetap teraba), atau lakukan flushing NaCl & heparin/citrate lock steril pada CDL.',
    keyMetrics: ['Hemostasis Sempurna Tanpa Perdarahan', 'Heparin Lock & Dressing CDL Steril'],
    notePlaceholder: 'Catat evaluasi hemostasis akses / perawatan exit-site CDL...',
    quickNotes: ['Hemostasis akses aman, tidak ada perdarahan ulang'],
    description: 'Hemostasis & Balut Tekan Akses',
    standardSpo: 'SPO-HD-17: Hemostasis Pasca-Kanulasi & Locking CDL'
  },
  {
    code: '6.3',
    bagian: 6,
    bagianTitle: 'Terminasi Aman, Evaluasi Post-HD, Disinfeksi Mesin & Pendokumentasian',
    category: 'Evaluasi Klinis Pasca-Dialisis',
    shortTitle: 'Evaluasi TTV Post-HD, Penimbangan BB Pulang, Capaian UF & Adekuasi Kt/V',
    simpleGuide: 'Ukur TD & Nadi Post-HD (pastikan bebas hipotensi ortostatik sebelum pasien berdiri/pulang), timbang BB Post-HD, catat total capaian UF aktual, dan nilai adekuasi Kt/V.',
    keyMetrics: ['TTV & BB Post-HD Tercatat', 'Capaian UF & Kt/V Terevaluasi'],
    notePlaceholder: 'Catat TD Post-HD, BB Post-HD, Capaian UF & Kt/V...',
    quickNotes: ['TTV Post-HD stabil, BB pulang & capaian UF sesuai target'],
    description: 'Evaluasi TTV & Berat Badan Post-HD',
    standardSpo: 'SPO-HD-18: Evaluasi Keperawatan Pasca-Hemodialisis & Pemulangan'
  },
  {
    code: '6.4',
    bagian: 6,
    bagianTitle: 'Terminasi Aman, Evaluasi Post-HD, Disinfeksi Mesin & Pendokumentasian',
    category: 'Dekontaminasi Limbah & Disinfeksi Mesin',
    shortTitle: 'Pembuangan Limbah Infeksius Tajam/Medis & Disinfeksi Termal/Kimia Mesin HD',
    simpleGuide: 'Buang jarum ke safety box dan bloodline/dialyzer ke limbah infeksius kuning, dekontaminasi permukaan luar mesin/bed, dan jalankan siklus Heat/Citric/Chemical Disinfection.',
    keyMetrics: ['Safety Box & Limbah B3 Sesuai PPI', 'Siklus Heat / Chemical Clean Aktif'],
    notePlaceholder: 'Catat metode disinfeksi mesin (Heat Clean / Citric)...',
    quickNotes: ['Limbah medis tertangani & mesin menjalani Heat Disinfection'],
    description: 'Disinfeksi Mesin HD (Heat / Chemical)',
    standardSpo: 'SPO-HD-19: Manajemen Limbah B3 & Disinfeksi Mesin HD'
  },
  {
    code: '6.5',
    bagian: 6,
    bagianTitle: 'Terminasi Aman, Evaluasi Post-HD, Disinfeksi Mesin & Pendokumentasian',
    category: 'Dokumentasi Rekam Medis & Timbang Terima',
    shortTitle: 'Pendokumentasian Lengkap Asuhan Keperawatan (CPPT/Logbook) & Serah Terima Shift',
    simpleGuide: 'Lengkapi seluruh dokumentasi asuhan keperawatan HD pada CPPT/rekam medis dan sistem logbook digital, lalu laksanakan timbang terima pasien/alat kepada PJ Shift.',
    keyMetrics: ['Dokumentasi CPPT & Logbook 100% Lengkap', 'Serah Terima Shift Terverifikasi'],
    notePlaceholder: 'Catat kelengkapan CPPT & timbang terima shift...',
    quickNotes: ['Dokumentasi CPPT & logbook lengkap, siap diajukan verifikasi'],
    description: 'Dokumentasi Asuhan & Rekam Medis (CPPT)',
    standardSpo: 'SPO-HD-20: Dokumentasi Keperawatan Dialisis & Handover'
  }
];

export function computeDailyActivitiesCount(
  checks: Record<string, boolean[]>,
  dayIndex: number
): number {
  return OFFICIAL_LOGBOOK_ITEMS.reduce((sum, item) => {
    const arr = checks[item.code];
    return sum + (arr && arr[dayIndex] ? 1 : 0);
  }, 0);
}

export function computeItemTotalAndPct(
  checksArr: boolean[] | undefined,
  activeDaysCount: number
): { total: number; pct: number } {
  if (!checksArr || checksArr.length === 0) {
    return { total: 0, pct: 0 };
  }
  const total = checksArr.filter(Boolean).length;
  const denom = activeDaysCount > 0 ? activeDaysCount : 1;
  const pct = activeDaysCount > 0 ? Math.min(100, Math.round((total / denom) * 100)) : 0;
  return { total, pct };
}

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
];

export function createInitialOfficialLogbook(options?: {
  nurseName?: string;
  nipNira?: string;
  nurseRole?: SystemAccessRole;
  shift?: ShiftName;
  month?: number;
  year?: number;
}): OfficialNurseLogbookMonth {
  const wib = getWibDateParts();
  const targetMonth = options?.month || wib.month;
  const targetYear = options?.year || wib.year;
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const monthLabel = INDONESIAN_MONTHS[targetMonth - 1] || 'Oktober';

  const checks: Record<string, boolean[]> = {};
  const notes: Record<string, string> = {};
  const verifiedDays: boolean[] = new Array(31).fill(false);
  OFFICIAL_LOGBOOK_ITEMS.forEach((item) => {
    checks[item.code] = new Array(31).fill(false);
    notes[item.code] = '';
  });

  if (options?.nurseName && options.nurseName !== '-') {
    ensureLocalCacheHydrated();
    const verifiedForMonth = filterVerifiedKaruRecords(Array.from(memoryRecordsMap.values()), {
      bulan: targetMonth,
      tahun: targetYear,
      namaPerawat: options.nurseName
    });
    verifiedForMonth.forEach((rec) => {
      const m = (rec.tanggal || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return;
      const dIdx = parseInt(m[3], 10) - 1;
      if (dIdx < 0 || dIdx >= 31) return;
      verifiedDays[dIdx] = true;
      (rec.items || []).forEach((it) => {
        if (it.verified && checks[it.code]) {
          checks[it.code][dIdx] = true;
        }
        if (it.catatan && !notes[it.code]) {
          notes[it.code] = it.catatan;
        }
      });
    });
  }

  return {
    nurseName: options?.nurseName || '-',
    nipNira: options?.nipNira || '-',
    nurseRole: options?.nurseRole || 'perawat_pelaksana',
    unitName: 'Instalasi Hemodialisa RS Happy Land Medical Centre',
    monthYear: `${monthLabel} / ${targetYear}`,
    daysInMonth,
    pkLevel: 'PK II',
    shift: options?.shift || 'Pagi',
    checks,
    notes,
    verifiedDays,
    nurseSigned: verifiedDays.some(Boolean),
    headNurseName: 'Twis Fertilianti PW., S.Kep., Ns.',
    headNurseNip: '19880412 201201 2 001',
    headNurseSigned: verifiedDays.some(Boolean)
  };
}

// ============================================================================
// SINKRONISASI CACHE LOKAL + CLOUD FIRESTORE (KOLEKSI: "logbooks")
// ============================================================================

const LOGBOOK_CACHE_STORAGE_KEY = 'official_logbooks_cloud_cache_v2';
let memoryRecordsMap = new Map<string, LogbookHarianRecord>();
let cacheHydratedFromStorage = false;

function sanitizeDocId(id: string): string {
  const cleaned = (id || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 128);
  return cleaned || `lb_${Date.now()}`;
}

function normalizePerson(name?: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(ners|ns|s\.kep\.|s\.kep|a\.md\.kep|a\.md\. kep\.|a\.md|kep|skep|dr|pw)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSamePerson(a?: string, b?: string): boolean {
  const na = normalizePerson(a);
  const nb = normalizePerson(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function ensureLocalCacheHydrated(): void {
  if (cacheHydratedFromStorage) return;
  cacheHydratedFromStorage = true;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(LOGBOOK_CACHE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((rec: LogbookHarianRecord) => {
          if (rec && rec.id) {
            memoryRecordsMap.set(rec.id, rec);
          }
        });
      }
    }
  } catch {
    // ignore storage errors
  }
}

function persistLocalCache(emitEvent: boolean = true): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const all = Array.from(memoryRecordsMap.values());
    window.localStorage.setItem(LOGBOOK_CACHE_STORAGE_KEY, JSON.stringify(all));
    if (emitEvent) {
      window.dispatchEvent(new CustomEvent('logbook_records_updated'));
    }
  } catch {
    // ignore storage quota errors
  }
}

function upsertMemoryRecord(record: LogbookHarianRecord, emitEvent: boolean = true): LogbookHarianRecord {
  ensureLocalCacheHydrated();
  const cleanId = sanitizeDocId(record.id);
  const normalized: LogbookHarianRecord = {
    ...record,
    id: cleanId
  };
  memoryRecordsMap.set(cleanId, normalized);
  persistLocalCache(emitEvent);
  return normalized;
}

function isCloudRuntimeEnabled(): boolean {
  return typeof window !== 'undefined' && !isFirestoreQuotaExhausted();
}

function filterPendingByRoleAndVerifier(
  records: LogbookHarianRecord[],
  role: 'PJ Shift' | 'Kepala Ruang',
  verifierName?: string
): LogbookHarianRecord[] {
  return records.filter((rec) => {
    if (role === 'PJ Shift') {
      if (rec.statusVerifikasi !== 'submitted') return false;
      if (rec.targetRole === 'kepala_ruangan' || rec.targetRole === 'mandiri') return false;
      if (verifierName && verifierName !== '-') {
        if (isSamePerson(rec.namaPerawat, verifierName)) return false;
        if (rec.targetVerifierName && rec.targetVerifierName !== '-') {
          return isSamePerson(rec.targetVerifierName, verifierName);
        }
      }
      return true;
    }

    // Kepala Ruang menerima:
    // 1. Pengajuan yang telah disetujui PJ Shift ('verified_pj') untuk pengesahan tahap akhir ('verified_karu')
    // 2. Pengajuan langsung ke Kepala Ruang ('submitted' dengan targetRole 'kepala_ruangan' / 'mandiri' atau dari PJ Shift)
    if (rec.statusVerifikasi === 'verified_pj') {
      return true;
    }
    if (rec.statusVerifikasi === 'submitted') {
      if (
        rec.targetRole === 'kepala_ruangan' ||
        rec.targetRole === 'mandiri' ||
        rec.perawatRole === 'pj_shift' ||
        rec.perawatRole === 'kepala_ruangan'
      ) {
        return true;
      }
      if (verifierName && verifierName !== '-' && rec.targetVerifierName) {
        return isSamePerson(rec.targetVerifierName, verifierName);
      }
      // Jika tidak ada pembatasan targetRole eksplisit ke PJ lain, izinkan tampil apabila kueri umum tanpa nama spesifik
      return !verifierName;
    }
    return false;
  });
}

export interface VerifiedReportsFilter {
  tanggal?: string;
  startDate?: string;
  endDate?: string;
  shift?: string;
  bulan?: number;
  tahun?: number;
  namaPerawat?: string;
}

function filterVerifiedKaruRecords(
  records: LogbookHarianRecord[],
  startDateOrFilter?: string | VerifiedReportsFilter,
  endDate?: string
): LogbookHarianRecord[] {
  // Sesuai aturan: Menarik data yang sudah diverifikasi PJ Shift maupun Kepala Ruang
  let list = records.filter(
    (r) => r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj'
  );

  if (!startDateOrFilter) {
    return list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  }

  if (typeof startDateOrFilter === 'string') {
    const start = startDateOrFilter.trim();
    const end = (endDate || startDateOrFilter).trim();
    if (start && end) {
      list = list.filter((r) => r.tanggal >= start && r.tanggal <= end);
    } else if (start) {
      list = list.filter((r) => r.tanggal >= start);
    }
    return list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
  }

  const filter = startDateOrFilter;
  if (filter.tanggal) {
    list = list.filter((r) => r.tanggal === filter.tanggal);
  }
  if (filter.startDate && filter.endDate) {
    list = list.filter((r) => r.tanggal >= filter.startDate! && r.tanggal <= filter.endDate!);
  } else if (filter.startDate) {
    list = list.filter((r) => r.tanggal >= filter.startDate!);
  }
  if (filter.shift) {
    const sNorm = filter.shift.trim().toLowerCase();
    list = list.filter((r) => (r.shift || '').trim().toLowerCase() === sNorm);
  }
  if (filter.bulan && filter.tahun) {
    const ymPrefix = `${filter.tahun}-${String(filter.bulan).padStart(2, '0')}-`;
    list = list.filter((r) => (r.tanggal || '').startsWith(ymPrefix));
  }
  if (filter.namaPerawat) {
    list = list.filter((r) => isSamePerson(r.namaPerawat, filter.namaPerawat));
  }

  return list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
}

let useFallbackLogbookCollection = false;
const PRIMARY_LOGBOOK_COL = 'logbooks';
const FALLBACK_LOGBOOK_COL = 'verification_registry';
const FALLBACK_LOGBOOK_KIND = 'cloud_logbook_record_v2';

function isPermissionDeniedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.toLowerCase().includes('missing or insufficient permissions') ||
    msg.toLowerCase().includes('permission-denied') ||
    msg.toLowerCase().includes('permission_denied')
  );
}

function getActiveLogbookCol(): string {
  return useFallbackLogbookCollection ? FALLBACK_LOGBOOK_COL : PRIMARY_LOGBOOK_COL;
}

function toStorageDocId(cleanId: string, colName: string): string {
  return colName === FALLBACK_LOGBOOK_COL ? sanitizeDocId(`lb_${cleanId}`) : cleanId;
}

function isMatchingLogbookDoc(data: Record<string, unknown>, colName: string): boolean {
  if (colName !== FALLBACK_LOGBOOK_COL) return true;
  return data?.recordKind === FALLBACK_LOGBOOK_KIND;
}

export const logbookService = {
  // 1. Simpan atau Update Logbook ke Database Cloud Firestore ("logbooks")
  saveRecord: async (record: LogbookHarianRecord): Promise<boolean> => {
    const cleanId = sanitizeDocId(record.id);
    const nowIso = new Date().toISOString();
    const payload: LogbookHarianRecord = {
      ...record,
      id: cleanId,
      updatedAt: nowIso
    };

    upsertMemoryRecord(payload, true);

    if (!isCloudRuntimeEnabled()) {
      return true;
    }

    const colName = getActiveLogbookCol();
    const docId = toStorageDocId(cleanId, colName);
    try {
      const docRef = doc(db, colName, docId);
      const writeBody =
        colName === FALLBACK_LOGBOOK_COL
          ? cleanFirestoreData({ ...payload, recordKind: FALLBACK_LOGBOOK_KIND })
          : cleanFirestoreData(payload);
      await setDoc(docRef, writeBody, { merge: true });
      return true;
    } catch (error) {
      if (!useFallbackLogbookCollection && isPermissionDeniedError(error)) {
        useFallbackLogbookCollection = true;
        const fbId = toStorageDocId(cleanId, FALLBACK_LOGBOOK_COL);
        try {
          await setDoc(
            doc(db, FALLBACK_LOGBOOK_COL, fbId),
            cleanFirestoreData({ ...payload, recordKind: FALLBACK_LOGBOOK_KIND }),
            { merge: true }
          );
          return true;
        } catch (fbErr) {
          try {
            handleFirestoreError(fbErr, OperationType.WRITE, `${FALLBACK_LOGBOOK_COL}/${fbId}`);
          } catch (handledErr) {
            console.error('Gagal menyimpan logbook ke Cloud Firestore:', handledErr);
          }
          return false;
        }
      }
      try {
        handleFirestoreError(error, OperationType.WRITE, `${colName}/${docId}`);
      } catch (handledErr) {
        console.error('Gagal menyimpan logbook ke Cloud Firestore:', handledErr);
      }
      return false;
    }
  },

  // 2. Ambil Data Antrean Verifikasi untuk PJ Shift dan Kepala Ruang secara Asinkron dari Cloud Firestore
  getPendingVerifications: async (
    role: 'PJ Shift' | 'Kepala Ruang',
    verifierName?: string
  ): Promise<LogbookHarianRecord[]> => {
    ensureLocalCacheHydrated();

    if (isCloudRuntimeEnabled()) {
      const fetchFromCol = async (colName: string): Promise<LogbookHarianRecord[]> => {
        const q =
          role === 'PJ Shift'
            ? query(collection(db, colName), where('statusVerifikasi', '==', 'submitted'))
            : query(
                collection(db, colName),
                where('statusVerifikasi', 'in', ['submitted', 'verified_pj'])
              );

        const querySnapshot = await getDocs(q);
        const cloudRecords: LogbookHarianRecord[] = [];
        querySnapshot.forEach((docSnap) => {
          const rawData = docSnap.data() as Record<string, unknown>;
          if (!isMatchingLogbookDoc(rawData, colName)) return;
          const logicalId =
            typeof rawData.id === 'string' && rawData.id.trim()
              ? sanitizeDocId(rawData.id)
              : docSnap.id;
          const rec = {
            ...(rawData as unknown as LogbookHarianRecord),
            id: logicalId
          };
          cloudRecords.push(rec);
          memoryRecordsMap.set(rec.id, rec);
        });
        persistLocalCache(false);
        return filterPendingByRoleAndVerifier(cloudRecords, role, verifierName);
      };

      const colName = getActiveLogbookCol();
      try {
        return await fetchFromCol(colName);
      } catch (error) {
        if (!useFallbackLogbookCollection && isPermissionDeniedError(error)) {
          useFallbackLogbookCollection = true;
          try {
            return await fetchFromCol(FALLBACK_LOGBOOK_COL);
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.LIST, FALLBACK_LOGBOOK_COL);
          }
        } else {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      }
    }

    return filterPendingByRoleAndVerifier(
      Array.from(memoryRecordsMap.values()),
      role,
      verifierName
    );
  },

  // 3. Proses Verifikasi Real-time (Mendukung tanda tangan pemanggilan (id, verifikatorId, role, details?) maupun (id, role, details?))
  verifyRecord: async (
    id: string,
    verifikatorIdOrRole: string,
    roleOrDetails?:
      | 'PJ Shift'
      | 'Kepala Ruang'
      | { verifikatorId?: string; verifikatorNama?: string; verifierNotes?: string },
    extraDetails?: { verifikatorNama?: string; verifierNotes?: string }
  ): Promise<LogbookHarianRecord | null> => {
    ensureLocalCacheHydrated();
    const cleanId = sanitizeDocId(id);
    const nowIso = new Date().toISOString();

    let resolvedRole: 'PJ Shift' | 'Kepala Ruang';
    let resolvedVerifikatorId: string;
    let resolvedVerifikatorNama: string | undefined;
    let resolvedNotes: string | undefined;

    if (roleOrDetails === 'PJ Shift' || roleOrDetails === 'Kepala Ruang') {
      resolvedRole = roleOrDetails;
      resolvedVerifikatorId = verifikatorIdOrRole;
      resolvedVerifikatorNama = extraDetails?.verifikatorNama || verifikatorIdOrRole;
      resolvedNotes = extraDetails?.verifierNotes;
    } else if (verifikatorIdOrRole === 'PJ Shift' || verifikatorIdOrRole === 'Kepala Ruang') {
      resolvedRole = verifikatorIdOrRole;
      const det = typeof roleOrDetails === 'object' && roleOrDetails ? roleOrDetails : {};
      resolvedVerifikatorId = det.verifikatorId || det.verifikatorNama || resolvedRole;
      resolvedVerifikatorNama = det.verifikatorNama || det.verifikatorId;
      resolvedNotes = det.verifierNotes;
    } else {
      resolvedRole = 'PJ Shift';
      resolvedVerifikatorId = verifikatorIdOrRole;
      resolvedVerifikatorNama = extraDetails?.verifikatorNama || verifikatorIdOrRole;
      resolvedNotes = extraDetails?.verifierNotes;
    }

    const existing = memoryRecordsMap.get(cleanId);
    const updateData: Partial<LogbookHarianRecord> = {
      ...(existing || {}),
      id: cleanId,
      revisionRequested: false,
      updatedAt: nowIso
    };

    if (resolvedNotes !== undefined) {
      updateData.verifierNotes = resolvedNotes;
    }

    if (resolvedRole === 'PJ Shift') {
      updateData.statusVerifikasi = 'verified_pj';
      updateData.verifikatorPjId = resolvedVerifikatorId;
      updateData.verifikatorPjNama = resolvedVerifikatorNama || existing?.verifikatorPjNama;
      updateData.verifiedPjAt = nowIso;
    } else {
      updateData.statusVerifikasi = 'verified_karu';
      updateData.verifikatorKaruId = resolvedVerifikatorId;
      updateData.verifikatorKaruNama = resolvedVerifikatorNama || existing?.verifikatorKaruNama;
      updateData.verifiedKaruAt = nowIso;
    }

    const mergedRecord: LogbookHarianRecord = {
      id: cleanId,
      tanggal: existing?.tanggal || new Date().toISOString().slice(0, 10),
      shift: existing?.shift || 'Pagi',
      perawatId: existing?.perawatId || cleanId,
      namaPerawat: existing?.namaPerawat || '-',
      items: existing?.items || [],
      statusVerifikasi: updateData.statusVerifikasi!,
      ...updateData
    };

    upsertMemoryRecord(mergedRecord, true);

    if (isCloudRuntimeEnabled()) {
      const colName = getActiveLogbookCol();
      const docId = toStorageDocId(cleanId, colName);
      try {
        const body =
          colName === FALLBACK_LOGBOOK_COL
            ? cleanFirestoreData({ ...mergedRecord, recordKind: FALLBACK_LOGBOOK_KIND })
            : cleanFirestoreData(mergedRecord);
        await setDoc(doc(db, colName, docId), body, { merge: true });
      } catch (error) {
        if (!useFallbackLogbookCollection && isPermissionDeniedError(error)) {
          useFallbackLogbookCollection = true;
          const fbId = toStorageDocId(cleanId, FALLBACK_LOGBOOK_COL);
          try {
            await setDoc(
              doc(db, FALLBACK_LOGBOOK_COL, fbId),
              cleanFirestoreData({ ...mergedRecord, recordKind: FALLBACK_LOGBOOK_KIND }),
              { merge: true }
            );
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.UPDATE, `${FALLBACK_LOGBOOK_COL}/${fbId}`);
          }
        } else {
          handleFirestoreError(error, OperationType.UPDATE, `${colName}/${docId}`);
        }
      }
    }

    return mergedRecord;
  },

  // 3b. Kembalikan Logbook untuk Revisi ('draft')
  requestRevision: async (
    id: string,
    verifikatorIdOrRole: string,
    roleOrDetails?:
      | 'PJ Shift'
      | 'Kepala Ruang'
      | { verifikatorNama?: string; verifierNotes?: string },
    extraDetails?: { verifikatorNama?: string; verifierNotes?: string }
  ): Promise<LogbookHarianRecord | null> => {
    ensureLocalCacheHydrated();
    const cleanId = sanitizeDocId(id);
    const nowIso = new Date().toISOString();

    let resolvedRole: 'PJ Shift' | 'Kepala Ruang' = 'PJ Shift';
    let verifierNama = '';
    let verifierNotes = '';

    if (roleOrDetails === 'PJ Shift' || roleOrDetails === 'Kepala Ruang') {
      resolvedRole = roleOrDetails;
      verifierNama = extraDetails?.verifikatorNama || verifikatorIdOrRole;
      verifierNotes = extraDetails?.verifierNotes || '';
    } else if (verifikatorIdOrRole === 'PJ Shift' || verifikatorIdOrRole === 'Kepala Ruang') {
      resolvedRole = verifikatorIdOrRole;
      const det = typeof roleOrDetails === 'object' && roleOrDetails ? roleOrDetails : {};
      verifierNama = det.verifikatorNama || resolvedRole;
      verifierNotes = det.verifierNotes || '';
    }

    const existing = memoryRecordsMap.get(cleanId);
    const updated: LogbookHarianRecord = {
      id: cleanId,
      tanggal: existing?.tanggal || new Date().toISOString().slice(0, 10),
      shift: existing?.shift || 'Pagi',
      perawatId: existing?.perawatId || cleanId,
      namaPerawat: existing?.namaPerawat || '-',
      items: existing?.items || [],
      ...(existing || {}),
      statusVerifikasi: 'draft',
      revisionRequested: true,
      revisionRequestedAt: nowIso,
      revisionRequestedBy: verifierNama,
      revisionRequestedByRole: resolvedRole,
      revisionEpoch: Date.now(),
      verifierNotes: verifierNotes || existing?.verifierNotes || '',
      updatedAt: nowIso
    };

    upsertMemoryRecord(updated, true);

    if (isCloudRuntimeEnabled()) {
      const colName = getActiveLogbookCol();
      const docId = toStorageDocId(cleanId, colName);
      try {
        const body =
          colName === FALLBACK_LOGBOOK_COL
            ? cleanFirestoreData({ ...updated, recordKind: FALLBACK_LOGBOOK_KIND })
            : cleanFirestoreData(updated);
        await setDoc(doc(db, colName, docId), body, { merge: true });
      } catch (error) {
        if (!useFallbackLogbookCollection && isPermissionDeniedError(error)) {
          useFallbackLogbookCollection = true;
          const fbId = toStorageDocId(cleanId, FALLBACK_LOGBOOK_COL);
          try {
            await setDoc(
              doc(db, FALLBACK_LOGBOOK_COL, fbId),
              cleanFirestoreData({ ...updated, recordKind: FALLBACK_LOGBOOK_KIND }),
              { merge: true }
            );
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.UPDATE, `${FALLBACK_LOGBOOK_COL}/${fbId}`);
          }
        } else {
          handleFirestoreError(error, OperationType.UPDATE, `${colName}/${docId}`);
        }
      }
    }

    return updated;
  },

  // 4. Tarik Data Laporan Resmi secara Asinkron (HANYA statusVerifikasi === 'verified_karu')
  getVerifiedReports: async (
    startDate?: string,
    endDate?: string
  ): Promise<LogbookHarianRecord[]> => {
    ensureLocalCacheHydrated();

    if (isCloudRuntimeEnabled()) {
      const fetchVerifiedFromCol = async (colName: string): Promise<LogbookHarianRecord[]> => {
        const q = query(
          collection(db, colName),
          where('statusVerifikasi', 'in', ['verified_karu', 'verified_pj'])
        );
        const querySnapshot = await getDocs(q);
        const cloudRecords: LogbookHarianRecord[] = [];
        querySnapshot.forEach((docSnap) => {
          const rawData = docSnap.data() as Record<string, unknown>;
          if (!isMatchingLogbookDoc(rawData, colName)) return;
          const logicalId =
            typeof rawData.id === 'string' && rawData.id.trim()
              ? sanitizeDocId(rawData.id)
              : docSnap.id;
          const rec = {
            ...(rawData as unknown as LogbookHarianRecord),
            id: logicalId
          };
          cloudRecords.push(rec);
          memoryRecordsMap.set(rec.id, rec);
        });
        persistLocalCache(false);
        return filterVerifiedKaruRecords(cloudRecords, startDate, endDate);
      };

      const colName = getActiveLogbookCol();
      try {
        return await fetchVerifiedFromCol(colName);
      } catch (error) {
        if (!useFallbackLogbookCollection && isPermissionDeniedError(error)) {
          useFallbackLogbookCollection = true;
          try {
            return await fetchVerifiedFromCol(FALLBACK_LOGBOOK_COL);
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.LIST, FALLBACK_LOGBOOK_COL);
          }
        } else {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      }
    }

    return filterVerifiedKaruRecords(
      Array.from(memoryRecordsMap.values()),
      startDate,
      endDate
    );
  },

  // 5. Real-time Subscription untuk Antrean Verifikasi Lintas Perangkat
  subscribePendingVerifications: (
    role: 'PJ Shift' | 'Kepala Ruang',
    onUpdate: (records: LogbookHarianRecord[]) => void,
    onError?: (err: unknown) => void,
    verifierName?: string
  ): (() => void) => {
    ensureLocalCacheHydrated();
    if (!isCloudRuntimeEnabled()) {
      onUpdate(
        filterPendingByRoleAndVerifier(Array.from(memoryRecordsMap.values()), role, verifierName)
      );
      return () => {};
    }

    let currentUnsub: (() => void) | null = null;
    let cancelled = false;

    const attachListener = (colName: string) => {
      if (cancelled) return;
      const q =
        role === 'PJ Shift'
          ? query(collection(db, colName), where('statusVerifikasi', '==', 'submitted'))
          : query(
              collection(db, colName),
              where('statusVerifikasi', 'in', ['submitted', 'verified_pj'])
            );

      currentUnsub = onSnapshot(
        q,
        (snapshot) => {
          const liveList: LogbookHarianRecord[] = [];
          const activeIds = new Set<string>();
          snapshot.forEach((docSnap) => {
            const rawData = docSnap.data() as Record<string, unknown>;
            if (!isMatchingLogbookDoc(rawData, colName)) return;
            const logicalId =
              typeof rawData.id === 'string' && rawData.id.trim()
                ? sanitizeDocId(rawData.id)
                : docSnap.id;
            const rec = {
              ...(rawData as unknown as LogbookHarianRecord),
              id: logicalId
            };
            liveList.push(rec);
            activeIds.add(rec.id);
            memoryRecordsMap.set(rec.id, rec);
          });

          memoryRecordsMap.forEach((cached, key) => {
            const wasMatchingQuery =
              role === 'PJ Shift'
                ? cached.statusVerifikasi === 'submitted'
                : cached.statusVerifikasi === 'submitted' ||
                  cached.statusVerifikasi === 'verified_pj';
            if (wasMatchingQuery && !activeIds.has(key)) {
              memoryRecordsMap.set(key, {
                ...cached,
                statusVerifikasi: role === 'PJ Shift' ? 'verified_pj' : 'verified_karu'
              });
            }
          });
          persistLocalCache(false);
          onUpdate(filterPendingByRoleAndVerifier(liveList, role, verifierName));
        },
        (err) => {
          if (!useFallbackLogbookCollection && isPermissionDeniedError(err)) {
            useFallbackLogbookCollection = true;
            if (currentUnsub) currentUnsub();
            attachListener(FALLBACK_LOGBOOK_COL);
            return;
          }
          if (onError) onError(err);
          try {
            handleFirestoreError(err, OperationType.LIST, colName);
          } catch {
            // dilaporkan ke onError pemanggil
          }
        }
      );
    };

    attachListener(getActiveLogbookCol());
    return () => {
      cancelled = true;
      if (currentUnsub) currentUnsub();
    };
  },

  // 6. Real-time Subscription untuk Laporan Terverifikasi Kepala Ruang ('verified_karu')
  subscribeVerifiedReports: (
    startDate: string | undefined,
    endDate: string | undefined,
    onUpdate: (records: LogbookHarianRecord[]) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    ensureLocalCacheHydrated();
    if (!isCloudRuntimeEnabled()) {
      onUpdate(
        filterVerifiedKaruRecords(Array.from(memoryRecordsMap.values()), startDate, endDate)
      );
      return () => {};
    }

    let currentUnsub: (() => void) | null = null;
    let cancelled = false;

    const attachListener = (colName: string) => {
      if (cancelled) return;
      const q = query(
        collection(db, colName),
        where('statusVerifikasi', 'in', ['verified_karu', 'verified_pj'])
      );

      currentUnsub = onSnapshot(
        q,
        (snapshot) => {
          const verifiedList: LogbookHarianRecord[] = [];
          snapshot.forEach((docSnap) => {
            const rawData = docSnap.data() as Record<string, unknown>;
            if (!isMatchingLogbookDoc(rawData, colName)) return;
            const logicalId =
              typeof rawData.id === 'string' && rawData.id.trim()
                ? sanitizeDocId(rawData.id)
                : docSnap.id;
            const rec = {
              ...(rawData as unknown as LogbookHarianRecord),
              id: logicalId
            };
            verifiedList.push(rec);
            memoryRecordsMap.set(rec.id, rec);
          });
          persistLocalCache(true);
          onUpdate(filterVerifiedKaruRecords(verifiedList, startDate, endDate));
        },
        (err) => {
          if (!useFallbackLogbookCollection && isPermissionDeniedError(err)) {
            useFallbackLogbookCollection = true;
            if (currentUnsub) currentUnsub();
            attachListener(FALLBACK_LOGBOOK_COL);
            return;
          }
          if (onError) onError(err);
          try {
            handleFirestoreError(err, OperationType.LIST, colName);
          } catch {
            // dilaporkan ke onError pemanggil
          }
        }
      );
    };

    attachListener(getActiveLogbookCol());
    return () => {
      cancelled = true;
      if (currentUnsub) currentUnsub();
    };
  },

  // Pembaca Cache Sinkron (untuk kalkulator agregat sinkron & unit test)
  getAllRecords: (): LogbookHarianRecord[] => {
    ensureLocalCacheHydrated();
    return Array.from(memoryRecordsMap.values());
  },

  getCachedPendingVerifications: (
    role: 'PJ Shift' | 'Kepala Ruang',
    verifierName?: string
  ): LogbookHarianRecord[] => {
    ensureLocalCacheHydrated();
    return filterPendingByRoleAndVerifier(
      Array.from(memoryRecordsMap.values()),
      role,
      verifierName
    );
  },

  getCachedVerifiedReports: (
    filter?: string | VerifiedReportsFilter,
    endDate?: string
  ): LogbookHarianRecord[] => {
    ensureLocalCacheHydrated();
    return filterVerifiedKaruRecords(Array.from(memoryRecordsMap.values()), filter, endDate);
  },

  clearAllRecords: (): void => {
    memoryRecordsMap = new Map<string, LogbookHarianRecord>();
    cacheHydratedFromStorage = true;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(LOGBOOK_CACHE_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent('logbook_records_updated'));
      } catch {
        // ignore
      }
    }
  }
};
