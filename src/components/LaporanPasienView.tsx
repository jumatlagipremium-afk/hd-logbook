import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ShiftInfo,
  SystemAccessRole,
  PatientHDSession,
  MasterNurse,
  MasterPatient,
  MasterDoctor,
  NurseScheduleEntry,
  DoctorScheduleEntry
} from '../types/dialysis.ts';
import {
  LaporanPasienRow,
  computeLaporanPasienSummary,
  pasienLogbookService
} from '../data/laporanPasienData.ts';
import {
  normalizeIndonesianDateLabel,
  indonesianDateLabelToIso,
  formatIsoDateToIndonesianFull
} from '../utils/dateHelpers.ts';
import { printDocumentWithOrientation, downloadElementAsPdf } from '../utils/printHelpers.ts';
import { aggregateShiftVerifiedLogbooks } from '../utils/dailyReportHelpers.ts';
import {
  getVerificationRegistry,
  isMatchingNurse
} from '../utils/nurseVerificationHelpers.ts';
import type { NurseLogbookCloudData } from '../services/firebase.ts';
import {
  Printer,
  FileDown,
  Search,
  Filter,
  RefreshCw,
  Calendar,
  Clock,
  ShieldCheck,
  Book,
  UserPlus,
  FileSpreadsheet,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { exportMasterHemodialisaWorkbook } from '../utils/exportMasterSpreadsheet.ts';

interface LaporanPasienViewProps {
  shiftInfo: ShiftInfo;
  userRole?: SystemAccessRole;
  loggedInUserName?: string | null;
  sessions?: PatientHDSession[];
  masterNurses?: MasterNurse[];
  masterPatients?: MasterPatient[];
  masterDoctors?: MasterDoctor[];
  nurseSchedules?: NurseScheduleEntry[];
  doctorSchedules?: DoctorScheduleEntry[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  onDateChange?: (isoDate: string) => void;
  isCustomDate?: boolean;
  onResetDateToToday?: () => void;
  onNavigateToLogbook?: () => void;
}

function formatVerificationStatusLabel(status: LaporanPasienRow['statusVerifikasi']): string {
  switch (status) {
    case 'verified_karu':
      return 'Verified Ka. Ruang';
    case 'verified_pj':
      return 'Verified PJ Shift';
    case 'submitted':
      return 'Diajukan';
    case 'draft':
    default:
      return 'Draft Input';
  }
}

export const LaporanPasienView: React.FC<LaporanPasienViewProps> = ({
  shiftInfo,
  loggedInUserName,
  sessions = [],
  masterNurses = [],
  masterPatients = [],
  masterDoctors = [],
  nurseSchedules = [],
  doctorSchedules = [],
  cloudNurseLogbooks = [],
  onDateChange,
  isCustomDate = false,
  onResetDateToToday,
  onNavigateToLogbook
}) => {
  const [selectedShift, setSelectedShift] = useState<'Pagi' | 'Siang'>(
    shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [syncTick, setSyncTick] = useState(0);

  // Sync selectedShift whenever parent shift changes
  useEffect(() => {
    if (shiftInfo.shift === 'Siang' || shiftInfo.shift === 'Pagi') {
      setSelectedShift(shiftInfo.shift);
    }
  }, [shiftInfo.shift]);

  const activeDateFormatted = normalizeIndonesianDateLabel(shiftInfo.date);
  const activeDateIso = indonesianDateLabelToIso(activeDateFormatted);

  // Active shift date state for Cloud Firestore raw shift report queries
  const [selectedDateIso, setSelectedDateIso] = useState<string>(activeDateIso);
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [rawShiftRows, setRawShiftRows] = useState<LaporanPasienRow[]>([]);

  useEffect(() => {
    setSelectedDateIso(activeDateIso);
  }, [activeDateIso]);

  const displayDateLabel = formatIsoDateToIndonesianFull(selectedDateIso);

  // Asynchronous Cloud Firestore fetch: tarik seluruh baris logbook pasien pada shift aktif tanpa memandang status verifikasi
  const fetchRawShiftReports = useCallback(
    async (tanggalIso: string, shiftName: 'Pagi' | 'Siang') => {
      setIsLoadingReport(true);
      setReportError(null);
      try {
        const rows = await pasienLogbookService.getRawReportsByShift(tanggalIso, shiftName);
        setRawShiftRows(rows);
      } catch (err) {
        console.error('Gagal mengambil laporan logbook pasien shift dari Cloud Firestore:', err);
        setReportError(
          'Gagal memuat data logbook pasien shift dari jaringan Cloud Firestore. Silakan coba muat ulang.'
        );
      } finally {
        setIsLoadingReport(false);
      }
    },
    []
  );

  // Panggil pasienLogbookService.getRawReportsByShift(tanggal, shift) + real-time subscription onSnapshot
  useEffect(() => {
    let isMounted = true;
    void fetchRawShiftReports(selectedDateIso, selectedShift);

    const unsubRawShift = pasienLogbookService.subscribeRawReportsByShift(
      selectedDateIso,
      selectedShift,
      (rows) => {
        if (!isMounted) return;
        setRawShiftRows(rows);
        setIsLoadingReport(false);
      },
      (err) => {
        console.error('Subscription error pasienLogbookService.subscribeRawReportsByShift:', err);
        if (!isMounted) return;
        setReportError(
          'Sinkronisasi real-time Cloud Firestore terganggu. Klik tombol muat ulang untuk menyegarkan data.'
        );
        setIsLoadingReport(false);
      }
    );

    const handleLocalSync = () => {
      setSyncTick((t) => t + 1);
      void pasienLogbookService
        .getRawReportsByShift(selectedDateIso, selectedShift)
        .then((rows) => {
          if (isMounted) {
            setRawShiftRows(rows);
          }
        })
        .catch((err) => {
          console.error('Gagal menyegarkan data shift lokal/cloud:', err);
        });
    };

    window.addEventListener('logbook_records_updated', handleLocalSync);
    window.addEventListener('logbook_sessions_updated', handleLocalSync);
    window.addEventListener('verification_registry_updated', handleLocalSync);
    window.addEventListener('logbook_shift_doctors_updated', handleLocalSync);
    window.addEventListener('storage', handleLocalSync);

    return () => {
      isMounted = false;
      unsubRawShift();
      window.removeEventListener('logbook_records_updated', handleLocalSync);
      window.removeEventListener('logbook_sessions_updated', handleLocalSync);
      window.removeEventListener('verification_registry_updated', handleLocalSync);
      window.removeEventListener('logbook_shift_doctors_updated', handleLocalSync);
      window.removeEventListener('storage', handleLocalSync);
    };
  }, [selectedDateIso, selectedShift, fetchRawShiftReports]);

  // Resolve PJ Shift, Dokter Jaga Ruangan, and Kepala Ruang for the selected date & shift
  const shiftSignatories = useMemo(() => {
    void syncTick;
    const registryEntries = getVerificationRegistry(masterNurses);
    const summaryForShift = aggregateShiftVerifiedLogbooks({
      sessions,
      registryEntries,
      masterNurses,
      masterPatients,
      nurseSchedules,
      doctorSchedules,
      cloudNurseLogbooks,
      activeDateLabel: formatIsoDateToIndonesianFull(selectedDateIso),
      activeShift: selectedShift,
      loggedInUserName,
      fallbackShiftInfo: shiftInfo
    });

    const pjName =
      summaryForShift.pjShiftName && summaryForShift.pjShiftName !== '-'
        ? summaryForShift.pjShiftName
        : shiftInfo.pjShift || '-';
    const pjMaster = masterNurses.find((n) => isMatchingNurse(n.name, pjName));

    const dokterJagaName =
      summaryForShift.dokterJagaName && summaryForShift.dokterJagaName !== '-'
        ? summaryForShift.dokterJagaName
        : shiftInfo.dokterJaga || '-';
    const cleanJagaLower = dokterJagaName.trim().toLowerCase();
    const dokterJagaMaster = masterDoctors.find(
      (d) => d.name.trim().toLowerCase() === cleanJagaLower
    );

    const kepalaRuangName =
      summaryForShift.kepalaRuanganName || shiftInfo.kepalaRuangan || 'TWIS FERTILIANTI PW';
    const kepalaRuangMaster = masterNurses.find((n) => isMatchingNurse(n.name, kepalaRuangName));

    return {
      pjName,
      pjNip: pjMaster?.nip || '-',
      dokterJagaName,
      dokterJagaSip: dokterJagaMaster?.sip || '-',
      kepalaRuangName,
      kepalaRuangNip: kepalaRuangMaster?.nip || '-'
    };
  }, [
    syncTick,
    sessions,
    masterNurses,
    masterPatients,
    masterDoctors,
    nurseSchedules,
    doctorSchedules,
    cloudNurseLogbooks,
    selectedDateIso,
    selectedShift,
    loggedInUserName,
    shiftInfo
  ]);

  // Seluruh baris logbook pasien pada shift aktif tanpa memandang status verifikasi
  const rawRows: LaporanPasienRow[] = rawShiftRows;

  // Hitung rincian status verifikasi untuk informasi real-time shift
  const statusCounts = useMemo(() => {
    let draft = 0;
    let submitted = 0;
    let verifiedPj = 0;
    let verifiedKaru = 0;
    rawRows.forEach((r) => {
      if (r.statusVerifikasi === 'verified_karu') verifiedKaru += 1;
      else if (r.statusVerifikasi === 'verified_pj') verifiedPj += 1;
      else if (r.statusVerifikasi === 'submitted') submitted += 1;
      else draft += 1;
    });
    return { draft, submitted, verifiedPj, verifiedKaru };
  }, [rawRows]);

  // Filtered rows by search, category, and optional status filter
  const filteredRows = useMemo(() => {
    return rawRows
      .filter((row) => {
        if (statusFilter !== 'all' && row.statusVerifikasi !== statusFilter) {
          return false;
        }

        if (categoryFilter !== 'all') {
          if (categoryFilter === 'reguler' && row.ruangKategori !== 'Reguler') return false;
          if (categoryFilter === 'hepb' && !row.ruangKategori.toLowerCase().includes('hep b')) {
            return false;
          }
          if (categoryFilter === 'hepc' && !row.ruangKategori.toLowerCase().includes('hep c')) {
            return false;
          }
          if (categoryFilter === 'ranap' && row.statusRawat !== 'Rawat Inap') return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = row.namaPasien.toLowerCase().includes(q);
          const matchRm = row.noRm.toLowerCase().includes(q);
          const matchBed = row.noBedMesin.toLowerCase().includes(q);
          const matchNurse = row.perawatPelaksana.toLowerCase().includes(q);
          const matchAccess = row.aksesVaskular.toLowerCase().includes(q);
          const matchStatus = formatVerificationStatusLabel(row.statusVerifikasi)
            .toLowerCase()
            .includes(q);
          if (!matchName && !matchRm && !matchBed && !matchNurse && !matchAccess && !matchStatus) {
            return false;
          }
        }

        return true;
      })
      .map((r, idx) => ({ ...r, no: idx + 1 }));
  }, [rawRows, statusFilter, categoryFilter, searchQuery]);

  const summary = useMemo(() => computeLaporanPasienSummary(filteredRows), [filteredRows]);

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handlePrint = () => {
    const docTitle = `Laporan_Pasien_HD_Shift_${selectedShift}_${selectedDateIso}`;
    printDocumentWithOrientation(true, docTitle);
  };

  const handleDownloadPdf = async () => {
    setIsExportingPdf(true);
    try {
      const docTitle = `Laporan_Pasien_HD_Shift_${selectedShift}_${selectedDateIso}`;
      await downloadElementAsPdf('printable-patient-report', {
        filename: docTitle,
        isLandscape: true,
        targetWidthPx: 2040,
        fitToSinglePage: filteredRows.length <= 26
      });
    } catch (err) {
      console.error('Download PDF error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportMasterSpreadsheet = () => {
    exportMasterHemodialisaWorkbook({
      shiftInfo: {
        ...shiftInfo,
        shift: selectedShift
      },
      sessions,
      laporanPasienRows: rawRows.length > 0 ? rawRows : undefined,
      masterNurses,
      masterPatients
    });
  };

  return (
    <div className="w-full max-w-[1750px] mx-auto px-2 sm:px-4 space-y-4 pb-12">
      {/* ===================================================================== */}
      {/* TOP HEADER & DOCUMENT BANNER (SCREEN ONLY)                            */}
      {/* ===================================================================== */}
      <div className="bg-white/95 rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-xs print:hidden space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#185382]">
              <span className="uppercase tracking-wider">Unit Hemodialisa</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-slate-700">RS Happy Land Medical Centre</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-emerald-700 font-bold">Sinkronisasi Real-time Seluruh Input Shift</span>
            </div>
            <h1 className="text-lg sm:text-xl xl:text-2xl font-black text-slate-950 mt-1 uppercase tracking-tight">
              LAPORAN PASIEN: DETAIL PELAYANAN ASUHAN KEPERAWATAN &amp; MEDIS
            </h1>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed max-w-4xl">
              Menampilkan seluruh baris logbook pasien yang diinput oleh perawat pada shift aktif secara real-time dari Cloud Firestore (Draft, Diajukan, Verified PJ Shift, dan Verified Ka. Ruang).
            </p>
          </div>

          {/* Action buttons toolbar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onNavigateToLogbook && (
              <button
                type="button"
                onClick={onNavigateToLogbook}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all border border-slate-200/80 cursor-pointer whitespace-nowrap shrink-0 shadow-2xs"
              >
                <Book className="w-4 h-4 text-[#19588f]" />
                <span>Buka Input Logbook</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold transition-all shadow-xs cursor-pointer whitespace-nowrap shrink-0"
              title="Buka dialog cetak browser langsung (A4 Landscape)"
            >
              <Printer className="w-4 h-4" />
              <span>Cetak</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-xs cursor-pointer whitespace-nowrap shrink-0"
              title="Download file tabel pasien langsung sebagai PDF (.pdf)"
            >
              <FileDown className="w-4 h-4" />
              <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportMasterSpreadsheet}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all shadow-xs cursor-pointer whitespace-nowrap shrink-0"
              title="Unduh 1 File Master Excel (.xlsx) gabungan seluruh laporan"
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>Master Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Shift metadata bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700 bg-slate-50/70 rounded-xl p-2.5 border border-slate-200/60">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
              <Clock className="w-3.5 h-3.5 text-[#19588f]" />
              Shift:{' '}
              <span className="text-[#19588f]">
                {selectedShift} ({selectedShift === 'Pagi' ? '07.00 - 14.00 WIB' : '14.00 - 21.00 WIB'})
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Hari/Tanggal: <strong>{displayDateLabel}</strong></span>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>PJ Shift: <strong>{shiftSignatories.pjName}</strong></span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>DPJP: <strong>{shiftInfo.dokterDpjp || 'dr. Raden Heru Prasanto, Sp.PD-KGH'}</strong></span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>Ka. Ruang: <strong>{shiftSignatories.kepalaRuangName}</strong></span>
          </div>

          {/* Status Sinkronisasi Real-time Cloud Firestore */}
          <div className="flex flex-wrap items-center gap-2.5 tabular-nums text-xs">
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-700">
              {isLoadingReport ? (
                <span className="inline-flex items-center gap-1.5 text-[#19588f] font-bold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>Menarik data shift dari Cloud Firestore...</span>
                </span>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#19588f] shrink-0" />
                  <span className="font-bold text-slate-950">Total: {rawRows.length} Pasien</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-slate-600">Draft: {statusCounts.draft}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-amber-800">Diajukan: {statusCounts.submitted}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-blue-800">Verified PJ: {statusCounts.verifiedPj}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-emerald-800">Verified Ka. Ruang: {statusCounts.verifiedKaru}</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => void fetchRawShiftReports(selectedDateIso, selectedShift)}
              disabled={isLoadingReport}
              title="Muat ulang seluruh baris logbook shift dari Cloud Firestore"
              className="p-1.5 rounded-lg bg-white hover:bg-slate-200 border border-slate-200 disabled:opacity-50 text-slate-700 transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingReport ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Cloud Network Error Banner */}
      {reportError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-900 print:hidden shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{reportError}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchRawShiftReports(selectedDateIso, selectedShift)}
            className="px-3.5 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* FILTER & SEARCH BAR (SCREEN ONLY)                                     */}
      {/* ===================================================================== */}
      <div className="bg-white/95 rounded-2xl p-3 sm:p-3.5 border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
        {/* Search input */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cari Nama Pasien, No. RM, Bed, Perawat, Status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:border-[#19588f] focus:ring-2 focus:ring-[#19588f]/10 transition-all font-medium"
          />
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Shift Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setSelectedShift('Pagi')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                selectedShift === 'Pagi'
                  ? 'bg-[#19588f] text-white shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Shift Pagi
            </button>
            <button
              type="button"
              onClick={() => setSelectedShift('Siang')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                selectedShift === 'Siang'
                  ? 'bg-[#19588f] text-white shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Shift Siang
            </button>
          </div>

          {/* Verification Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 tabular-nums">
            <ShieldCheck className="w-3.5 h-3.5 text-[#19588f] shrink-0" />
            <select
              aria-label="Filter Status Verifikasi"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-bold text-slate-900 border-none outline-hidden cursor-pointer text-xs"
            >
              <option value="all">Semua Status ({rawRows.length})</option>
              <option value="draft">Draft Input ({statusCounts.draft})</option>
              <option value="submitted">Diajukan ({statusCounts.submitted})</option>
              <option value="verified_pj">Verified PJ Shift ({statusCounts.verifiedPj})</option>
              <option value="verified_karu">Verified Ka. Ruang ({statusCounts.verifiedKaru})</option>
            </select>
          </div>

          {/* Category Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 tabular-nums">
            <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              aria-label="Filter Kategori Pasien"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent font-bold text-slate-900 border-none outline-hidden cursor-pointer text-xs"
            >
              <option value="all">Semua Kategori</option>
              <option value="reguler">Reguler</option>
              <option value="hepb">Isolasi Hep B</option>
              <option value="hepc">Isolasi Hep C</option>
              <option value="ranap">Rawat Inap</option>
            </select>
          </div>

          {/* Interactive Date Picker */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 tabular-nums">
            <Calendar className="w-3.5 h-3.5 text-[#19588f] shrink-0" />
            <input
              type="date"
              aria-label="Tanggal Shift Laporan Pasien"
              value={selectedDateIso}
              onChange={(e) => {
                const nextVal = e.target.value;
                if (!nextVal) return;
                setSelectedDateIso(nextVal);
                if (onDateChange) {
                  onDateChange(nextVal);
                }
              }}
              className="bg-transparent font-bold text-slate-900 border-none outline-hidden cursor-pointer text-xs"
            />
            {(isCustomDate || selectedDateIso !== activeDateIso) && (
              <button
                type="button"
                onClick={() => {
                  if (onResetDateToToday) {
                    onResetDateToToday();
                  } else {
                    setSelectedDateIso(activeDateIso);
                  }
                }}
                className="ml-1 text-[10px] font-bold text-[#19588f] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                Hari Ini
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SUMMARY KPI CARDS (SCREEN ONLY)                                       */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 print:hidden tabular-nums">
        <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Pasien Shift Ini
          </span>
          <span className="text-xl sm:text-2xl font-black text-slate-950 block mt-1">
            {summary.totalPasien} <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Total UF Ditarik
          </span>
          <span className="text-xl sm:text-2xl font-black text-[#19588f] block mt-1">
            {summary.totalCapaianUf.toLocaleString('id-ID')}{' '}
            <span className="text-xs font-semibold text-slate-500 font-sans">mL</span>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Rata-rata Kt/V
          </span>
          <span className="text-xl sm:text-2xl font-black text-emerald-700 block mt-1">
            {summary.rataKtV} <span className="text-xs font-normal text-slate-500 font-sans">(&ge; 1,20)</span>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Rata-rata QB
          </span>
          <span className="text-xl sm:text-2xl font-black text-slate-900 block mt-1">
            {summary.rataQb} <span className="text-xs font-semibold text-slate-500 font-sans">mL/m</span>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Rata-rata Durasi
          </span>
          <span className="text-xl sm:text-2xl font-black text-slate-900 block mt-1">
            {summary.rataDurasiJam} <span className="text-xs font-semibold text-slate-500 font-sans">Jam</span>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Mutu Air RO
          </span>
          <span className="text-base sm:text-lg font-black text-emerald-800 block mt-1 truncate">
            {summary.totalPasien > 0
              ? `${summary.roMemenuhiSyaratCount}/${summary.totalPasien} Memenuhi`
              : 'Siap Pakai'}
          </span>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* THE OFFICIAL FORMAT TABLE (SCREEN & PRINT)                            */}
      {/* ===================================================================== */}
      <div
        id="printable-patient-report"
        className="printable-sheet bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden print:border-none print:shadow-none print:rounded-none"
      >
        {/* Printable Document Title Block */}
        <div className="p-3.5 sm:p-4 bg-gradient-to-r from-[#173a64] via-[#1d4c82] to-[#173a64] text-white border-b border-slate-200 print:bg-white print:text-black print:p-2 print:border-b-2 print:border-black">
          <div className="text-center">
            <h2 className="text-sm sm:text-base font-black tracking-wide uppercase print:text-xs print:font-extrabold">
              LOGBOOK DETAIL PELAYANAN ASUHAN KEPERAWATAN &amp; MEDIS PASIEN HEMODIALISIS
            </h2>
            <div className="text-[10.5px] sm:text-[11px] text-blue-100 mt-1 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 print:text-[8.5px] print:text-black">
              <span>
                Shift:{' '}
                <strong>
                  {selectedShift} ({selectedShift === 'Pagi' ? '07.00 - 14.00 WIB' : '14.00 - 21.00 WIB'})
                </strong>
              </span>
              <span className="hidden sm:inline">·</span>
              <span>Hari/Tanggal: <strong>{displayDateLabel}</strong></span>
              <span className="hidden sm:inline">·</span>
              <span>PJ Shift: <strong>{shiftSignatories.pjName}</strong></span>
              <span className="hidden sm:inline">·</span>
              <span>DPJP: <strong>{shiftInfo.dokterDpjp || 'dr. Raden Heru Prasanto, Sp.PD-KGH'}</strong></span>
              <span className="hidden sm:inline">·</span>
              <span>Ka. Ruang: <strong>{shiftSignatories.kepalaRuangName}</strong></span>
            </div>
          </div>
        </div>

        {/* Horizontal Scrollable Table Wrapper */}
        <div className="overflow-x-auto max-h-[760px] scrollbar-thin print:max-h-none print:overflow-visible">
          <table className="w-full text-left border-collapse border border-slate-300 print:border-black text-[9px] sm:text-[10px] xl:text-[10.5px] font-sans leading-tight print:text-[7.5px] print:leading-none">
            {/* 2-TIER TABLE HEADER (31 COLUMNS) */}
            <thead className="sticky top-0 z-20 print:static shadow-xs">
              <tr className="bg-[#173a64] text-white text-center font-bold tracking-tight print:bg-slate-200 print:text-black">
                <th
                  rowSpan={2}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 w-8 text-center align-middle"
                >
                  NO
                </th>
                <th
                  colSpan={4}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  DATA IDENTITAS &amp; STATUS PASIEN
                </th>
                <th
                  colSpan={5}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  PENGATURAN TEKNIS &amp; PRE-HD
                </th>
                <th
                  colSpan={5}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  PARAMETER BERAT BADAN &amp; ALIRAN (QB/QD)
                </th>
                <th
                  colSpan={3}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  MONITORING ULTRAFILTRASI &amp; ADEKUASI
                </th>
                <th
                  colSpan={2}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  TANDA VITAL (HEMODINAMIK)
                </th>
                <th
                  colSpan={2}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  SPESIFIKASI DIALISER &amp; HEPARINISASI
                </th>
                <th
                  colSpan={2}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  KOMPLIKASI, TATALAKSANA &amp; ADVIS DPJP
                </th>
                <th
                  colSpan={3}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  STATUS OPERASIONAL MESIN &amp; DISINFEKSI
                </th>
                <th
                  colSpan={2}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  STATUS MUTU WATER TREATMENT RO
                </th>
                <th
                  colSpan={2}
                  className="border border-slate-300 print:border-black p-1 sm:p-1.5 text-center align-middle uppercase"
                >
                  PERAWAT &amp; VERIFIKASI
                </th>
              </tr>

              <tr className="bg-[#2f5597] text-white text-center font-bold text-[8.5px] sm:text-[9.5px] print:bg-slate-100 print:text-black">
                {/* DATA IDENTITAS */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">NO. RM</th>
                <th className="border border-slate-300 print:border-black p-1 min-w-[120px] sm:min-w-[140px]">NAMA LENGKAP PASIEN</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">STATUS RAWAT</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">RUANG / KATEGORI</th>

                {/* PENGATURAN TEKNIS */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">NO. BED / MESIN</th>
                <th className="border border-slate-300 print:border-black p-1 min-w-[110px]">AKSES VASKULAR</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">WAKTU MULAI</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">WAKTU SELESAI</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">DURASI (JAM)</th>

                {/* PARAMETER BERAT BADAN & ALIRAN */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">BB KERING (KG)</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">BB PRE HD (KG)</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">BB POST HD (KG)</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">QB (ML/M)</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">QD (ML/M)</th>

                {/* MONITORING ULTRAFILTRASI */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">TARGET UF (ML)</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">KT/V</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">CAPAIAN UF (ML)</th>

                {/* TANDA VITAL */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">TD PRE (MMHG)</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">TD POST (MMHG)</th>

                {/* SPESIFIKASI DIALISER & HEPARINISASI */}
                <th className="border border-slate-300 print:border-black p-1 min-w-[110px]">DIALISER</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">HEPARINISASI</th>

                {/* KOMPLIKASI, TATALAKSANA & ADVIS DPJP */}
                <th className="border border-slate-300 print:border-black p-1 min-w-[95px]">KOMPLIKASI INTRA-HD</th>
                <th className="border border-slate-300 print:border-black p-1 min-w-[150px] sm:min-w-[190px]">TINDAKAN &amp; ADVIS MEDIS DPJP</th>

                {/* STATUS OPERASIONAL MESIN & DISINFEKSI */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">STATUS MESIN</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">METODE DISINFEKSI</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">KET. TEKNIS</th>

                {/* STATUS MUTU WATER TREATMENT RO */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">JAM CEK RO</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">KONDISI AIR RO</th>

                {/* PERAWAT & STATUS VERIFIKASI */}
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">PERAWAT PELAKSANA</th>
                <th className="border border-slate-300 print:border-black p-1 whitespace-nowrap">STATUS VERIFIKASI</th>
              </tr>
            </thead>

            {/* TABLE BODY */}
            <tbody className="divide-y divide-slate-200 text-slate-800 tabular-nums">
              {isLoadingReport && filteredRows.length === 0 ? (
                Array.from({ length: 5 }).map((_, skelIdx) => (
                  <tr key={`skel-row-${skelIdx}`} className="bg-white animate-pulse print:hidden">
                    <td colSpan={31} className="border border-slate-200 p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="h-3.5 w-8 bg-slate-200 rounded" />
                        <div className="h-3.5 w-24 bg-slate-200 rounded" />
                        <div className="h-3.5 w-44 bg-slate-200 rounded" />
                        <div className="h-3.5 flex-1 bg-slate-100 rounded" />
                        <div className="h-3.5 w-28 bg-slate-200 rounded" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={31} className="text-center py-10 px-4 bg-slate-50/60 print:py-6">
                    {rawRows.length === 0 ? (
                      <div className="max-w-md mx-auto space-y-3 print:space-y-1">
                        <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-100 flex items-center justify-center text-[#19588f] print:hidden">
                          <Book className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 print:text-xs">
                            Belum Ada Input Logbook Pasien pada Shift Ini
                          </h3>
                          <p className="text-xs text-slate-500 mt-1 print:text-[8px]">
                            Begitu perawat pelaksana menginput pasien pada <strong>Shift {selectedShift}</strong> ({displayDateLabel}), seluruh baris akan langsung tampil secara real-time di tabel ini tanpa menunggu persetujuan verifikasi.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1 print:hidden">
                          {onNavigateToLogbook && (
                            <button
                              type="button"
                              onClick={onNavigateToLogbook}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#19588f] hover:bg-[#154673] text-white text-xs font-bold transition-all shadow-xs cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>Input Logbook Pasien Sekarang</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-md mx-auto space-y-2">
                        <p className="text-xs text-slate-600 font-semibold">
                          Tidak ada baris pasien yang sesuai dengan kriteria filter aktif.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setCategoryFilter('all');
                            setStatusFilter('all');
                          }}
                          className="text-xs font-bold text-[#19588f] hover:underline cursor-pointer"
                        >
                          Reset Filter &amp; Tampilkan Semua ({rawRows.length} Pasien)
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const isEven = idx % 2 === 1;
                  const isHepB = row.ruangKategori.toLowerCase().includes('hep b');
                  const isHepC = row.ruangKategori.toLowerCase().includes('hep c');
                  const isRanap = row.statusRawat === 'Rawat Inap';

                  const verifTextClass =
                    row.statusVerifikasi === 'verified_karu'
                      ? 'text-emerald-800 font-bold'
                      : row.statusVerifikasi === 'verified_pj'
                      ? 'text-blue-800 font-bold'
                      : row.statusVerifikasi === 'submitted'
                      ? 'text-amber-800 font-semibold'
                      : 'text-slate-600 font-medium';

                  return (
                    <tr
                      key={row.id || idx}
                      className={`transition-colors hover:bg-sky-50/70 print:hover:bg-transparent ${
                        isEven ? 'bg-slate-50/70' : 'bg-white'
                      } ${isHepB ? 'bg-amber-50/40' : ''} ${isHepC ? 'bg-orange-50/40' : ''}`}
                    >
                      <td className="border border-slate-300 print:border-black p-1 text-center font-bold text-slate-700">
                        {row.no}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 font-semibold text-slate-900 text-center whitespace-nowrap">
                        {row.noRm}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 font-bold text-slate-950 whitespace-nowrap">
                        {row.namaPasien}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap">
                        <span className={isRanap ? 'text-purple-700 font-bold' : 'text-slate-700'}>
                          {row.statusRawat}
                        </span>
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap">
                        <span
                          className={
                            isHepB
                              ? 'text-amber-800 font-bold'
                              : isHepC
                              ? 'text-orange-800 font-bold'
                              : 'text-slate-700'
                          }
                        >
                          {row.ruangKategori}
                        </span>
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-semibold text-slate-900 whitespace-nowrap">
                        {row.noBedMesin}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 whitespace-nowrap">
                        {row.aksesVaskular}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-mono">
                        {row.waktuMulai}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-mono">
                        {row.waktuSelesai}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-bold">
                        {Number(row.durasiJam || 0).toFixed(1).replace('.', ',')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-right">
                        {Number(row.bbKering || 0).toFixed(1).replace('.', ',')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-right font-semibold">
                        {Number(row.bbPreHd || 0).toFixed(1).replace('.', ',')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-right font-semibold">
                        {Number(row.bbPostHd || 0).toFixed(1).replace('.', ',')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-bold text-[#19588f]">
                        {row.qb}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center text-slate-600">
                        {row.qd}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-right font-semibold">
                        {Number(row.targetUf || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-bold text-emerald-800">
                        {Number(row.ktV || 0).toFixed(2).replace('.', ',')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-right font-bold text-[#19588f]">
                        {Number(row.capaianUf || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-semibold whitespace-nowrap">
                        {row.tdPre}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-semibold whitespace-nowrap">
                        {row.tdPost}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 whitespace-nowrap">
                        {row.dialiser}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 whitespace-nowrap">
                        <span
                          className={
                            (row.heparinisasi || '').toLowerCase().includes('free')
                              ? 'text-red-700 font-bold'
                              : 'text-slate-800'
                          }
                        >
                          {row.heparinisasi}
                        </span>
                      </td>
                      <td className="border border-slate-300 print:border-black p-1">
                        <span
                          className={
                            row.komplikasiIntraHd && row.komplikasiIntraHd !== 'Tidak ada'
                              ? 'text-amber-900 font-bold'
                              : 'text-slate-600'
                          }
                        >
                          {row.komplikasiIntraHd || 'Tidak ada'}
                        </span>
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-[8.5px] sm:text-[9.5px] print:text-[7.5px] leading-snug">
                        {!row.tindakanAdvisDpjp ||
                        row.tindakanAdvisDpjp.trim() === '' ||
                        row.tindakanAdvisDpjp === '-' ||
                        row.tindakanAdvisDpjp.toLowerCase() === 'tidak ada' ||
                        row.komplikasiIntraHd === 'Tidak ada' ||
                        (row.komplikasiIntraHd || '').toLowerCase() === 'tidak ada' ? (
                          <span className="text-slate-500 font-medium">Tidak ada</span>
                        ) : (
                          <span>{row.tindakanAdvisDpjp}</span>
                        )}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap text-emerald-800 font-bold">
                        {row.statusMesin}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap">
                        {row.metodeDisinfeksi}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap">
                        {row.ketTeknis}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center font-mono">
                        {row.jamCekRo}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap text-emerald-800 font-bold">
                        {row.kondisiAirRo}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 whitespace-nowrap font-semibold text-slate-900">
                        {row.perawatPelaksana}
                      </td>
                      <td className="border border-slate-300 print:border-black p-1 text-center whitespace-nowrap">
                        <span className={verifTextClass}>
                          {formatVerificationStatusLabel(row.statusVerifikasi)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* SUMMARY FOOTER ROW */}
            <tfoot>
              <tr className="bg-[#1f4e79] text-white font-bold text-center border-t-2 border-slate-900 print:bg-slate-300 print:text-black tabular-nums">
                <td
                  colSpan={9}
                  className="border border-slate-300 print:border-black p-1.5 text-center font-black tracking-wide uppercase"
                >
                  TOTAL &amp; RATA-RATA ({summary.totalPasien} PASIEN SHIFT {selectedShift.toUpperCase()})
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-center font-black">
                  {summary.rataDurasiJam.toFixed(1).replace('.', ',')}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-right font-black">
                  {summary.rataBbKering.toFixed(1).replace('.', ',')}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-right font-black">
                  {summary.rataBbPreHd.toFixed(1).replace('.', ',')}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-right font-black">
                  {summary.rataBbPostHd.toFixed(1).replace('.', ',')}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-center font-black">
                  {summary.rataQb}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-center font-black">
                  {summary.rataQd}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-right font-black">
                  {summary.totalTargetUf.toLocaleString('id-ID')}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-center font-black">
                  {summary.rataKtV.toFixed(2).replace('.', ',')}
                </td>
                <td className="border border-slate-300 print:border-black p-1 text-right font-black">
                  {summary.totalCapaianUf.toLocaleString('id-ID')}
                </td>
                <td
                  colSpan={13}
                  className="border border-slate-300 print:border-black p-1 text-center text-blue-100 print:text-black italic"
                >
                  Real-time Seluruh Input Shift · Draft: {statusCounts.draft} · Diajukan: {statusCounts.submitted} · Verified PJ: {statusCounts.verifiedPj} · Verified Ka. Ruang: {statusCounts.verifiedKaru}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Printable & Screen Official Verification Signatures Block */}
        <div className="p-4 sm:p-5 bg-white border-t border-slate-200 print:border-black print:p-2 text-slate-900 print:text-black">
          <div className="grid grid-cols-3 gap-4 text-center text-xs print:text-[8px] leading-tight">
            <div>
              <p className="text-slate-600 print:text-black">Mengetahui,</p>
              <p className="font-bold text-slate-800 print:text-black uppercase">Penanggung Jawab Shift</p>
              <div className="h-14 sm:h-16 flex items-end justify-center">
                <span className="text-[10px] text-emerald-800 font-mono">
                  ✓ Terverifikasi Digital
                </span>
              </div>
              <p className="font-extrabold underline text-slate-950 print:text-black mt-1">
                {shiftSignatories.pjName}
              </p>
              <p className="text-[10px] text-slate-500 print:text-black">
                NIP: {shiftSignatories.pjNip}
              </p>
            </div>

            <div>
              <p className="text-slate-600 print:text-black">Menyetujui,</p>
              <p className="font-bold text-slate-800 print:text-black uppercase">Dokter Jaga Ruangan</p>
              <div className="h-14 sm:h-16 flex items-end justify-center">
                <span className="text-[10px] text-blue-800 font-mono">
                  ✓ Pemeriksaan Medis Terkonfirmasi
                </span>
              </div>
              <p className="font-extrabold underline text-slate-950 print:text-black mt-1">
                {shiftSignatories.dokterJagaName}
              </p>
              <p className="text-[10px] text-slate-500 print:text-black">
                SIP: {shiftSignatories.dokterJagaSip}
              </p>
            </div>

            <div>
              <p className="text-slate-600 print:text-black">Mengesahkan,</p>
              <p className="font-bold text-slate-800 print:text-black uppercase">Kepala Ruang</p>
              <div className="h-14 sm:h-16 flex items-end justify-center">
                <span className="text-[10px] text-emerald-800 font-mono">
                  ✓ Disahkan Kepala Ruang
                </span>
              </div>
              <p className="font-extrabold underline text-slate-950 print:text-black mt-1">
                {shiftSignatories.kepalaRuangName}
              </p>
              <p className="text-[10px] text-slate-500 print:text-black">
                NIP: {shiftSignatories.kepalaRuangNip}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
