import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  MasterNurse,
  PatientHDSession,
  ShiftInfo,
  SystemAccessRole
} from '../types/dialysis.ts';
import { OFFICIAL_LOGBOOK_ITEMS, logbookService } from '../data/officialPelaksanaLogbookData.ts';
import {
  pasienLogbookService,
  type MonthlyNurseSpoMatrixReport
} from '../data/laporanPasienData.ts';
import { OfficialPelaksanaLogbookPrintable } from './OfficialPelaksanaLogbookPrintable.tsx';
import { LoginUserData } from './LoginPage.tsx';
import {
  buildAllStaffMonthlyRecap,
  parseIndonesianLogbookDate,
  getMonthLabel,
  UnitMonthlyRecapOverview
} from '../utils/monthlyRecapHelpers.ts';
import {
  getCurrentIndonesianFullDate,
  normalizeIndonesianDateLabel
} from '../utils/dateHelpers.ts';
import { isMatchingNurse } from '../utils/nurseVerificationHelpers.ts';
import { canVerifyLogbook } from '../utils/masterDataHelpers.ts';
import { printDocumentWithOrientation, downloadElementAsPdf } from '../utils/printHelpers.ts';
import {
  Table,
  Printer,
  FileDown,
  Calendar,
  Award,
  UserCheck,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Activity,
  Filter,
  RefreshCw,
  FileText,
  FileSpreadsheet,
  Loader2
} from 'lucide-react';
import { exportMasterHemodialisaWorkbook } from '../utils/exportMasterSpreadsheet.ts';
import type { NurseLogbookCloudData } from '../services/firebase.ts';

interface LapBulananViewProps {
  masterNurses?: MasterNurse[];
  loggedInUser?: LoginUserData | null;
  shiftInfo?: ShiftInfo;
  userRole?: SystemAccessRole;
  sessions?: PatientHDSession[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  onNavigateToLogbook?: () => void;
  onNavigateToVerifikasi?: () => void;
}

const BAGIAN_SECTION_HEADERS: {
  bagian: number;
  title: string;
  ruleBadge: string;
}[] = [
  {
    bagian: 1,
    title: 'BAGIAN I: KESIAPAN FASILITAS RUANGAN & WATER TREATMENT (RO)',
    ruleBadge: 'Nilai = 1 (1x Aktivitas / Hari Terverifikasi PJ / Karu)'
  },
  {
    bagian: 2,
    title: 'BAGIAN II: PERSIAPAN PERAWAT, PERALATAN, MESIN HD & ALKES (PRE-HD)',
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 3,
    title: 'BAGIAN III: IDENTIFIKASI PASIEN, PENGKAJIAN PRE-HD & PATIENT SAFETY',
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 4,
    title: 'BAGIAN IV: MONITORING INTRA-HD & PENCEGAHAN IKP',
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 5,
    title: 'BAGIAN V: EDUKASI TERSTRUKTUR PASIEN & KELUARGA (KIE)',
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  },
  {
    bagian: 6,
    title: 'BAGIAN VI: TERMINASI AMAN, EVALUASI POST-HD, DISINFEKSI & CPPT',
    ruleBadge: 'Akumulasi Pasien Kelolaan Terverifikasi (PJ / Karu)'
  }
];

const INDONESIAN_MONTH_OPTIONS = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' }
];

const ALL_STAFF_KEY = 'ALL_STAFF';

export const LapBulananView: React.FC<LapBulananViewProps> = ({
  masterNurses = [],
  loggedInUser,
  shiftInfo,
  userRole = 'perawat_pelaksana',
  sessions = [],
  cloudNurseLogbooks = [],
  onNavigateToLogbook,
  onNavigateToVerifikasi
}) => {
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const activeDateLabel = shiftInfo?.date
    ? normalizeIndonesianDateLabel(shiftInfo.date)
    : getCurrentIndonesianFullDate();

  const activeParsedDate = useMemo(
    () => parseIndonesianLogbookDate(activeDateLabel),
    [activeDateLabel]
  );

  // Month & Year state filterable by user
  const [selectedMonth, setSelectedMonth] = useState<number>(() => activeParsedDate.month);
  const [selectedYear, setSelectedYear] = useState<number>(() => activeParsedDate.year);

  const bulanTahun = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const monthStartIso = `${bulanTahun}-01`;
  const monthEndIso = `${bulanTahun}-31`;

  const isPelaksana = userRole === 'perawat_pelaksana';

  const activeNurses = useMemo(() => {
    return masterNurses.filter((n) => n.accountStatus !== 'nonaktif');
  }, [masterNurses]);

  const loggedInNurse = useMemo(() => {
    if (!loggedInUser?.name) return null;
    return activeNurses.find((n) => isMatchingNurse(n.name, loggedInUser.name)) || null;
  }, [activeNurses, loggedInUser?.name]);

  const personalStaffName =
    loggedInNurse?.name || activeNurses[0]?.name || loggedInUser?.name || 'Perawat Pelaksana';

  // Default langsung ke perawat aktif agar matriks horizontal 1–31 (29 poin SPO) langsung dipanggil & ditampilkan
  const [selectedStaff, setSelectedStaff] = useState<string>(() => personalStaffName);

  // Guard: Perawat Pelaksana terkunci pada nama sendiri; Supervisor yang masih di placeholder diselaraskan ke staf pertama
  useEffect(() => {
    if (isPelaksana && selectedStaff !== personalStaffName) {
      setSelectedStaff(personalStaffName);
      return;
    }
    if (
      !isPelaksana &&
      selectedStaff === 'Perawat Pelaksana' &&
      personalStaffName !== 'Perawat Pelaksana'
    ) {
      setSelectedStaff(personalStaffName);
    }
  }, [isPelaksana, personalStaffName, selectedStaff]);

  const effectiveSelectedStaff = isPelaksana ? personalStaffName : selectedStaff;

  const [viewMode, setViewMode] = useState<'matrix' | 'print'>('matrix');

  const daysArray = Array.from({ length: 31 }, (_, i) => i + 1);
  const currentMonthLabel = getMonthLabel(selectedMonth);
  const currentMonthYearTitle = `${currentMonthLabel} ${selectedYear}`;

  // Find the selected individual nurse object
  const activeNurseObject = useMemo(() => {
    if (!isPelaksana && effectiveSelectedStaff === ALL_STAFF_KEY) return null;
    const targetName = isPelaksana ? personalStaffName : effectiveSelectedStaff;
    const found = activeNurses.find((n) => isMatchingNurse(n.name, targetName));
    if (found) return found;
    return {
      id: 'nurse-selected',
      name: targetName,
      nip: loggedInUser?.nip || '-',
      role: 'perawat_pelaksana',
      systemAccess: userRole,
      accountStatus: 'aktif'
    } as MasterNurse;
  }, [isPelaksana, effectiveSelectedStaff, personalStaffName, activeNurses, loggedInUser?.nip, userRole]);

  const headNurseMaster = useMemo(() => {
    const karuName = shiftInfo?.kepalaRuangan || 'TWIS FERTILIANTI PW';
    return masterNurses.find(
      (n) => n.role === 'kepala_ruangan' || isMatchingNurse(n.name, karuName)
    );
  }, [masterNurses, shiftInfo?.kepalaRuangan]);

  // =========================================================================
  // CLOUD FIRESTORE FETCH: pasienLogbookService.getMonthlyReportByNurse(namaPerawat, bulanTahun)
  // Melacak akumulasi 29 butir kegiatan asuhan keperawatan milik perawat yang terverifikasi (PJ Shift / Ka. Ruang)
  // =========================================================================
  const [monthlyNurseReport, setMonthlyNurseReport] =
    useState<MonthlyNurseSpoMatrixReport | null>(null);
  const [isLoadingMonthlyCloud, setIsLoadingMonthlyCloud] = useState<boolean>(true);
  const [monthlyCloudError, setMonthlyCloudError] = useState<string | null>(null);

  const fetchMonthlyCloudData = useCallback(async () => {
    setIsLoadingMonthlyCloud(true);
    setMonthlyCloudError(null);
    try {
      if (effectiveSelectedStaff !== ALL_STAFF_KEY && activeNurseObject?.name) {
        const report = await pasienLogbookService.getMonthlyReportByNurse(
          activeNurseObject.name,
          bulanTahun,
          {
            nipNira: activeNurseObject.nip || '-',
            nurseRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
            headNurseName: headNurseMaster?.name || shiftInfo?.kepalaRuangan,
            headNurseNip: headNurseMaster?.nip
          }
        );
        setMonthlyNurseReport(report);
      } else {
        await Promise.all([
          logbookService.getVerifiedReports(monthStartIso, monthEndIso),
          pasienLogbookService.getVerifiedPatientReports(monthStartIso, monthEndIso)
        ]);
        setRefreshTick((t) => t + 1);
      }
    } catch (err) {
      console.error('Gagal mengambil laporan matriks bulanan perawat dari Cloud Firestore:', err);
      setMonthlyCloudError(
        'Gagal memuat matriks bulanan 29 poin SPO terverifikasi (PJ Shift / Ka. Ruang) dari jaringan Cloud Firestore.'
      );
    } finally {
      setIsLoadingMonthlyCloud(false);
    }
  }, [
    effectiveSelectedStaff,
    activeNurseObject,
    bulanTahun,
    headNurseMaster?.name,
    headNurseMaster?.nip,
    shiftInfo?.kepalaRuangan,
    monthStartIso,
    monthEndIso
  ]);

  useEffect(() => {
    let isMounted = true;
    void fetchMonthlyCloudData();

    let unsubNurseMatrix: (() => void) | null = null;
    let unsubUnitLogs: (() => void) | null = null;
    let unsubUnitPatients: (() => void) | null = null;

    if (effectiveSelectedStaff !== ALL_STAFF_KEY && activeNurseObject?.name) {
      unsubNurseMatrix = pasienLogbookService.subscribeMonthlyReportByNurse(
        activeNurseObject.name,
        bulanTahun,
        (report) => {
          if (!isMounted) return;
          setMonthlyNurseReport(report);
          setIsLoadingMonthlyCloud(false);
        },
        (err) => {
          console.error(
            'Subscription error pasienLogbookService.subscribeMonthlyReportByNurse:',
            err
          );
          if (!isMounted) return;
          setMonthlyCloudError(
            'Sinkronisasi real-time matriks bulanan terganggu. Klik tombol Muat Ulang.'
          );
          setIsLoadingMonthlyCloud(false);
        },
        {
          nipNira: activeNurseObject.nip || '-',
          nurseRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
          headNurseName: headNurseMaster?.name || shiftInfo?.kepalaRuangan,
          headNurseNip: headNurseMaster?.nip
        }
      );
    } else {
      unsubUnitLogs = logbookService.subscribeVerifiedReports(
        monthStartIso,
        monthEndIso,
        () => {
          if (!isMounted) return;
          setRefreshTick((t) => t + 1);
          setIsLoadingMonthlyCloud(false);
        }
      );
      unsubUnitPatients = pasienLogbookService.subscribeVerifiedPatientReports(
        monthStartIso,
        monthEndIso,
        () => {
          if (!isMounted) return;
          setRefreshTick((t) => t + 1);
          setIsLoadingMonthlyCloud(false);
        }
      );
    }

    const handleLocalUpdate = () => {
      setRefreshTick((t) => t + 1);
      if (effectiveSelectedStaff !== ALL_STAFF_KEY && activeNurseObject?.name) {
        void pasienLogbookService
          .getMonthlyReportByNurse(activeNurseObject.name, bulanTahun, {
            nipNira: activeNurseObject.nip || '-',
            nurseRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
            headNurseName: headNurseMaster?.name || shiftInfo?.kepalaRuangan,
            headNurseNip: headNurseMaster?.nip
          })
          .then((rep) => {
            if (isMounted) setMonthlyNurseReport(rep);
          })
          .catch(() => {});
      }
    };

    window.addEventListener('logbook_records_updated', handleLocalUpdate);
    window.addEventListener('logbook_sessions_updated', handleLocalUpdate);
    window.addEventListener('verification_registry_updated', handleLocalUpdate);
    window.addEventListener('storage', handleLocalUpdate);

    return () => {
      isMounted = false;
      if (unsubNurseMatrix) unsubNurseMatrix();
      if (unsubUnitLogs) unsubUnitLogs();
      if (unsubUnitPatients) unsubUnitPatients();
      window.removeEventListener('logbook_records_updated', handleLocalUpdate);
      window.removeEventListener('logbook_sessions_updated', handleLocalUpdate);
      window.removeEventListener('verification_registry_updated', handleLocalUpdate);
      window.removeEventListener('storage', handleLocalUpdate);
    };
  }, [
    effectiveSelectedStaff,
    activeNurseObject,
    bulanTahun,
    headNurseMaster?.name,
    headNurseMaster?.nip,
    shiftInfo?.kepalaRuangan,
    monthStartIso,
    monthEndIso,
    fetchMonthlyCloudData
  ]);

  // Compute Unit All-Staff Recap for supervisor / admin roles
  const unitRecap: UnitMonthlyRecapOverview = useMemo(() => {
    if (isPelaksana) {
      return {
        month: selectedMonth,
        year: selectedYear,
        monthYear: currentMonthYearTitle,
        totalActiveNurses: 0,
        totalVerifiedDutyDays: 0,
        totalVerifiedPatientsUnit: 0,
        unitOverallCompliancePct: 0,
        staffSummaries: []
      };
    }
    return buildAllStaffMonthlyRecap({
      masterNurses: activeNurses,
      shiftInfo,
      sessions,
      cloudNurseLogbooks,
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPelaksana,
    activeNurses,
    shiftInfo,
    sessions,
    cloudNurseLogbooks,
    selectedMonth,
    selectedYear,
    currentMonthYearTitle,
    refreshTick
  ]);

  const isCurrentMonthActive =
    selectedMonth === activeParsedDate.month && selectedYear === activeParsedDate.year;

  const handleResetToCurrentMonth = () => {
    setSelectedMonth(activeParsedDate.month);
    setSelectedYear(activeParsedDate.year);
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handlePrint = () => {
    const isIndiv = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;
    const docTitle = isIndiv
      ? `Logbook_Bulanan_${activeNurseObject?.name || 'Perawat'}_${currentMonthYearTitle}`
      : `Rekapitulasi_Bulanan_Unit_HD_${currentMonthYearTitle}`;

    if (viewMode !== 'print' && isIndiv) {
      setViewMode('print');
      setTimeout(() => {
        printDocumentWithOrientation(true, docTitle);
      }, 180);
      return;
    }
    printDocumentWithOrientation(true, docTitle);
  };

  const handleDownloadPdf = async () => {
    const isIndiv = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;
    const docTitle = isIndiv
      ? `Logbook_Bulanan_${activeNurseObject?.name || 'Perawat'}_${currentMonthYearTitle}`
      : `Rekapitulasi_Bulanan_Unit_HD_${currentMonthYearTitle}`;

    setIsExportingPdf(true);
    try {
      if (isIndiv && viewMode !== 'print') {
        setViewMode('print');
        setTimeout(async () => {
          try {
            await downloadElementAsPdf('printable-official-logbook', {
              filename: docTitle,
              isLandscape: true
            });
          } finally {
            setIsExportingPdf(false);
          }
        }, 220);
        return;
      }

      const targetId = isIndiv ? 'printable-official-logbook' : 'printable-unit-recap';
      await downloadElementAsPdf(targetId, {
        filename: docTitle,
        isLandscape: true
      });
    } catch (err) {
      console.error('Download PDF error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportMasterSpreadsheet = () => {
    exportMasterHemodialisaWorkbook({
      shiftInfo: shiftInfo || {
        hospitalName: 'RS Happy Land Medical Centre',
        unitName: 'Instalasi Dialisis',
        date: getCurrentIndonesianFullDate(),
        shift: 'Pagi',
        shiftHours: '07.00 - 14.00 WIB',
        pjShift: 'M. Haikal Malilang, A.Md. Kep.',
        dokterDpjp: 'dr. Raden Heru Prasanto, Sp.PD-KGH',
        kepalaRuangan: 'Twis Fertilianti PW., S.Kep., Ns.',
        dokterJaga: 'dr. Paramitha',
        totalPerawatDinas: 8,
        detailPerawat: '8 Orang (1 PJ Shift + 7 Perawat Pelaksana)',
        perawatRatio: '1 : 3',
        tenagaPendukung: '1 Teknisi Elektromedis/RO, 1 HK Ruangan',
        pjShiftBerikutnya: 'Aprillia Dwi N, S.Kep., Ns.'
      },
      sessions: sessions || [],
      masterNurses: masterNurses || [],
      cloudNurseLogbooks: cloudNurseLogbooks || [],
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
  };

  const isViewingIndividualMatrix = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;

  return (
    <div className="w-full max-w-[1750px] mx-auto px-2 sm:px-4 space-y-4 pb-12">
      {/* ===================================================================== */}
      {/* 1. HEADER CARD & INTEGRATED CONTROL BAR                               */}
      {/* ===================================================================== */}
      <div className="bg-white/95 rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col gap-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="text-[#164e78] font-bold uppercase tracking-wider">
                Laporan Bulanan Hemodialisis (29 Poin SPO)
              </span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span>Basis Data: Terverifikasi PJ Shift &amp; Kepala Ruang (verified_pj / verified_karu)</span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span className="truncate">{shiftInfo?.hospitalName || 'RS Happy Land Medical Centre'}</span>
            </div>

            <h2 className="text-lg sm:text-xl xl:text-[22px] font-black text-slate-950 tracking-tight flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-4 h-4" />
              </div>
              <span className="truncate">
                MATRIKS REKAPITULASI BULANAN (TANGGAL 1 S/D 31)
              </span>
              <span className="hidden sm:inline-block text-xs font-bold text-[#164e78] font-mono">
                &middot; {currentMonthYearTitle}
              </span>
            </h2>

            <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
              Melacak akumulasi 29 butir kegiatan asuhan keperawatan hemodialisis (Bagian I–VI) pada kolom tanggal 1 sampai 31 horizontal yang telah diverifikasi oleh <strong>PJ Shift</strong> maupun <strong>Kepala Ruang</strong> di Cloud Firestore.{' '}
              &middot; Periode Kode: <strong className="text-[#164e78] font-mono">{bulanTahun}</strong>
              {isLoadingMonthlyCloud && (
                <span className="inline-flex items-center gap-1 ml-2 text-[#164e78] font-semibold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Menarik data Cloud Firestore...</span>
                </span>
              )}
            </p>
            {monthlyCloudError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-900 mt-1">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span className="font-semibold">{monthlyCloudError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchMonthlyCloudData()}
                  className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Coba Lagi
                </button>
              </div>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center shrink-0">
            <div className="inline-flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'matrix'
                    ? 'bg-white text-[#164e78] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {effectiveSelectedStaff === ALL_STAFF_KEY
                    ? 'Rekap Unit HD'
                    : 'Matriks 1–31 (29 SPO)'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('print')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'print'
                    ? 'bg-[#164e78] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Printer className="w-3.5 h-3.5 shrink-0" />
                <span>Format Cetak A4</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void fetchMonthlyCloudData()}
              disabled={isLoadingMonthlyCloud}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-bold border border-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Muat ulang data bulanan dari Cloud Firestore"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMonthlyCloud ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#164e78] hover:bg-[#103b5b] text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5 shrink-0" />
              <span>Cetak</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            >
              <FileDown className="w-3.5 h-3.5 shrink-0" />
              <span>{isExportingPdf ? 'Mengunduh PDF...' : 'Simpan PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportMasterSpreadsheet}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Master Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Staff Selector & Month/Year Filter Bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 rounded-xl p-3 border border-slate-200/70">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {isPelaksana ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#164e78]" />
                  <span>Nama Perawat:</span>
                </span>
                <div className="bg-white border border-blue-200 text-slate-900 font-bold text-xs rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-2xs">
                  <span className="text-[#164e78] font-bold">{personalStaffName}</span>
                  <span aria-hidden="true" className="text-slate-300">&middot;</span>
                  <span className="text-[11px] font-medium text-slate-600">Akun Mandiri</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-[280px] flex-1 sm:flex-initial">
                <label
                  htmlFor="select-staff"
                  className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0"
                >
                  <UserCheck className="w-3.5 h-3.5 text-[#164e78]" />
                  <span>Pilih Perawat:</span>
                </label>
                <select
                  id="select-staff"
                  value={selectedStaff}
                  onChange={(e) => {
                    setSelectedStaff(e.target.value);
                    setViewMode('matrix');
                  }}
                  className="bg-white border border-slate-300 text-slate-900 font-semibold text-xs rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#164e78]/30 focus:border-[#164e78] focus:outline-hidden w-full cursor-pointer shadow-2xs transition-all"
                >
                  <optgroup label="Matriks 1–31 Perawat (29 Poin SPO Terverifikasi)">
                    {activeNurses.map((nurse) => {
                      const nurseRecap = unitRecap.staffSummaries.find(
                        (s) => s.nurseName === nurse.name
                      );
                      const verifiedDays = nurseRecap?.verifiedDaysCount || 0;
                      const verifiedPats = nurseRecap?.totalVerifiedPatients || 0;
                      const roleTag =
                        nurse.role === 'kepala_ruangan'
                          ? '[Ka. Ruangan]'
                          : nurse.role === 'pj_shift'
                          ? '[PJ Shift]'
                          : '[Pelaksana]';
                      return (
                        <option key={nurse.id} value={nurse.name}>
                          {roleTag} {nurse.name} — ({verifiedDays} Hari | {verifiedPats} Pasien)
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="Ringkasan Unit">
                    <option value={ALL_STAFF_KEY}>
                      Rekapitulasi Seluruh Staf (Unit Hemodialisis)
                    </option>
                  </optgroup>
                </select>
              </div>
            )}

            {!isPelaksana && selectedStaff !== ALL_STAFF_KEY && (
              <button
                type="button"
                onClick={() => setSelectedStaff(ALL_STAFF_KEY)}
                className="text-xs font-bold text-[#164e78] hover:text-[#0e3553] bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/80 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Rekap Semua Staf</span>
              </button>
            )}
          </div>

          {/* Month & Year Filter (Memicu getMonthlyReportByNurse(namaPerawat, bulanTahun)) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1 shadow-2xs tabular-nums">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Pilih Bulan Rekapitulasi"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="text-xs font-bold text-slate-800 bg-transparent border-none py-0.5 px-1 focus:ring-0 focus:outline-hidden cursor-pointer"
              >
                {INDONESIAN_MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="text-slate-300">/</span>
              <select
                aria-label="Pilih Tahun Rekapitulasi"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="text-xs font-bold text-slate-800 bg-transparent border-none py-0.5 px-1 focus:ring-0 focus:outline-hidden cursor-pointer"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>

            {!isCurrentMonthActive && (
              <button
                type="button"
                onClick={handleResetToCurrentMonth}
                title="Kembali ke bulan berjalan saat ini"
                className="text-xs font-semibold text-slate-700 hover:text-[#164e78] bg-white hover:bg-slate-50 border border-slate-300 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Bulan Ini</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2. VIEW UNIT OVERVIEW (OPSIONAL JIKA SUPERVISOR MEMILIH SEMUA STAF)    */}
      {/* ===================================================================== */}
      {!isPelaksana && effectiveSelectedStaff === ALL_STAFF_KEY && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums">
            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Total Tenaga Perawat
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalActiveNurses}{' '}
                  <span className="text-xs font-semibold text-slate-500 font-sans">Orang</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Unit Dialisis &middot; Terjadwal
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Hari Dinas Disahkan
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalVerifiedDutyDays}{' '}
                  <span className="text-xs font-semibold text-slate-500 font-sans">Hari Kerja</span>
                </div>
                <div className="text-[11px] text-[#164e78] font-semibold truncate mt-0.5">
                  Periode {unitRecap.monthYear}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pasien HD Terverifikasi
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalVerifiedPatientsUnit}{' '}
                  <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
                </div>
                <div className="text-[11px] text-emerald-700 font-semibold truncate mt-0.5">
                  Terverifikasi PJ Shift &amp; Ka. Ruang
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Kepatuhan SPO Unit HD
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-800 mt-1 font-mono">
                  {unitRecap.unitOverallCompliancePct}%
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Standar Akreditasi KARS
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <Award className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div
            id="printable-unit-recap"
            className="printable-sheet bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:border-none print:shadow-none print:rounded-none"
          >
            <div className="px-5 py-4 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#164e78]" />
                  <span>Daftar Rekapitulasi Capaian Logbook Seluruh Perawat ({unitRecap.monthYear})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Klik tombol Buka Matriks pada baris perawat untuk membuka tabel matriks 1–31 horizontal (29 Poin SPO).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse tabular-nums">
                <thead>
                  <tr className="bg-[#164e78] text-white font-bold text-center text-[11px] uppercase tracking-wider">
                    <th className="p-3 border-r border-[#1e5d8e] w-12 text-center">NO</th>
                    <th className="p-3 border-r border-[#1e5d8e] text-left min-w-[210px]">NAMA PERAWAT &amp; NIP</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-36 text-center">JABATAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">HARI DISAHKAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-32 text-center">PASIEN KELOLAAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-32 text-center">NILAI SPO / MAKS</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">% CAPAIAN</th>
                    <th className="p-3 w-36 text-center print:hidden">AKSI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {unitRecap.staffSummaries.map((staff, idx) => {
                    const hasVerified = staff.verifiedDaysCount > 0 || staff.totalVerifiedPatients > 0;
                    return (
                      <tr
                        key={staff.nurseId || idx}
                        className={
                          idx % 2 === 1
                            ? 'bg-slate-50/60 hover:bg-blue-50/50 transition-colors'
                            : 'bg-white hover:bg-blue-50/50 transition-colors'
                        }
                      >
                        <td className="p-3 text-center font-mono text-slate-500 font-semibold border-r border-slate-200">
                          {idx + 1}
                        </td>
                        <td className="p-3 border-r border-slate-200">
                          <div className="font-bold text-slate-950 text-xs">{staff.nurseName}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">NIP: {staff.nurseNip}</div>
                        </td>
                        <td className="p-3 text-center border-r border-slate-200 font-semibold text-slate-700">
                          {staff.role === 'kepala_ruangan'
                            ? 'Kepala Ruangan'
                            : staff.role === 'pj_shift'
                            ? 'PJ Shift'
                            : 'Perawat Pelaksana'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                          {hasVerified ? `${staff.verifiedDaysCount} Hari` : '0 Hari'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                          {hasVerified ? `${staff.totalVerifiedPatients} Pasien` : '0 Pasien'}
                        </td>
                        <td className="p-3 text-center font-mono border-r border-slate-200">
                          {hasVerified ? `${staff.grandTotalScore} / ${staff.grandMaxScore}` : '-'}
                        </td>
                        <td className="p-3 text-center font-mono font-bold border-r border-slate-200">
                          {hasVerified ? `${staff.overallCompliancePct}%` : '-'}
                        </td>
                        <td className="p-3 text-center print:hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStaff(staff.nurseName);
                              setViewMode('matrix');
                            }}
                            className="px-3 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 w-full cursor-pointer shadow-2xs whitespace-nowrap"
                          >
                            <span>Buka Matriks 1–31</span>
                            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. MATRIKS HORIZONTAL TANGGAL 1 S/D 31 (29 POIN KEGIATAN SPO)         */}
      {/* Hasil pemetaan pasienLogbookService.getMonthlyReportByNurse(...)      */}
      {/* ===================================================================== */}
      {isViewingIndividualMatrix && (
        <div className="space-y-4">
          {isLoadingMonthlyCloud && !monthlyNurseReport ? (
            /* Loading Skeleton State saat menarik matriks 1-31 dari Cloud Firestore */
            <div className="space-y-4 animate-pulse print:hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 h-24" />
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <div className="h-5 w-80 bg-slate-200 rounded" />
                {Array.from({ length: 8 }).map((_, rIdx) => (
                  <div key={rIdx} className="h-7 bg-slate-100 rounded" />
                ))}
              </div>
            </div>
          ) : monthlyNurseReport ? (
            <>
              {/* Individual Nurse KPI Metric Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums print:hidden">
                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Perawat Pelaksana Asuhan
                    </div>
                    <div className="text-base sm:text-lg font-black text-slate-950 mt-1 truncate">
                      {monthlyNurseReport.logbook.nurseName}
                    </div>
                    <div className="text-[11.5px] text-slate-500 truncate mt-0.5">
                      {monthlyNurseReport.roleLabel} &middot; NIP: {monthlyNurseReport.logbook.nipNira}
                    </div>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
                    <UserCheck className="w-5 h-5" />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Hari Dinas (verified_karu)
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                      {monthlyNurseReport.verifiedDaysCount}{' '}
                      <span className="text-xs font-semibold text-slate-500 font-sans">Hari</span>
                    </div>
                    <div className="text-[11.5px] text-[#164e78] font-semibold truncate mt-0.5">
                      Periode {monthlyNurseReport.logbook.monthYear}
                    </div>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                    <Calendar className="w-5 h-5" />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Pasien Terverifikasi (PJ / Karu)
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                      {monthlyNurseReport.totalVerifiedPatientsInMonth}{' '}
                      <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
                    </div>
                    <div className="text-[11.5px] text-emerald-700 font-semibold truncate mt-0.5">
                      Status: verified_pj / verified_karu
                    </div>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                    <Users className="w-5 h-5" />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Akumulasi 29 Poin SPO
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-emerald-800 mt-1 font-mono">
                      {monthlyNurseReport.overallCompliancePct}%
                    </div>
                    <div className="text-[11.5px] text-slate-500 font-mono truncate mt-0.5">
                      Nilai: {monthlyNurseReport.grandTotalScore} / {monthlyNurseReport.grandMaxScore}
                    </div>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                    <Award className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Informational Banner if No verified Days in This Month */}
              {monthlyNurseReport.verifiedDaysCount === 0 && !isLoadingMonthlyCloud && (
                <div className="bg-amber-50/60 rounded-2xl border border-amber-200 p-4 sm:p-5 shadow-2xs space-y-3 print:hidden">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-1 flex-1">
                      <h3 className="text-sm font-bold text-amber-950">
                        Belum Ada Data Terverifikasi untuk {monthlyNurseReport.logbook.nurseName} pada Periode {currentMonthYearTitle}
                      </h3>
                      <p className="text-xs text-amber-900/90 leading-relaxed">
                        Tabel matriks horizontal 1–31 di bawah ini melacak akumulasi 29 poin kegiatan asuhan keperawatan milik perawat yang telah diverifikasi oleh Penanggung Jawab (PJ) Shift atau disahkan oleh Kepala Ruang di Cloud Firestore.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {canVerifyLogbook(userRole) && onNavigateToVerifikasi && (
                      <button
                        type="button"
                        onClick={onNavigateToVerifikasi}
                        className="px-3.5 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Buka Halaman Verifikasi</span>
                      </button>
                    )}
                    {onNavigateToLogbook && (
                      <button
                        type="button"
                        onClick={onNavigateToLogbook}
                        className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>Buka Input Logbook</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* VIEW SWITCHER CONTENT: PRINT vs HORIZONTAL 1-31 MATRIX */}
              {viewMode === 'print' ? (
                <OfficialPelaksanaLogbookPrintable logbook={monthlyNurseReport.logbook} />
              ) : (
                <>
                  <div className="hidden print:block">
                    <OfficialPelaksanaLogbookPrintable logbook={monthlyNurseReport.logbook} />
                  </div>

                  {/* Large Horizontal 1-31 Matrix Table Container (29 SPO Items) */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:hidden">
                    <div className="px-5 py-3.5 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                          <Table className="w-4 h-4 text-[#164e78]" />
                          <span>
                            Matriks Akumulasi 29 Poin Kegiatan SPO — Tanggal 1 s/d 31 ({monthlyNurseReport.logbook.monthYear})
                          </span>
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Perawat: <strong>{monthlyNurseReport.logbook.nurseName}</strong> &middot; Menghitung kegiatan yang telah diverifikasi PJ Shift maupun Kepala Ruang (<strong>verified_pj / verified_karu</strong>).
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setViewMode('print')}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300/80 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Table className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                          <span>Format Cetak A4</span>
                        </button>
                        <button
                          type="button"
                          onClick={handlePrint}
                          className="px-3 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                        >
                          <Printer className="w-3.5 h-3.5 shrink-0" />
                          <span>Cetak</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadPdf}
                          disabled={isExportingPdf}
                          className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                        >
                          <FileDown className="w-3.5 h-3.5 shrink-0" />
                          <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
                        </button>
                      </div>
                    </div>

                    {/* 31-Day Horizontal Matrix Table */}
                    <div className="overflow-x-auto max-h-[760px] relative scrollbar-thin">
                      <table className="w-full text-left text-xs border-collapse tabular-nums">
                        <thead className="sticky top-0 z-20 shadow-xs">
                          <tr className="bg-[#164e78] text-white font-bold text-center text-[10.5px]">
                            <th
                              rowSpan={2}
                              className="p-2 border-r border-[#1e5d8e] w-[52px] min-w-[52px] max-w-[52px] sticky left-0 z-30 bg-[#164e78] text-center"
                            >
                              POIN
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-r border-[#1e5d8e] w-[130px] min-w-[130px] max-w-[130px] text-left sticky left-[52px] z-30 bg-[#164e78]"
                            >
                              FASE ASUHAN
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-r border-[#1e5d8e] min-w-[250px] text-left bg-[#164e78]"
                            >
                              URAIAN 29 BUTIR KEGIATAN ASUHAN KEPERAWATAN (SPO)
                            </th>
                            <th
                              colSpan={31}
                              className="p-1.5 border-b border-[#1e5d8e] text-[10px] uppercase font-bold tracking-wider bg-[#1a5b8c] text-white"
                            >
                              TANGGAL 1 SAMPAI 31 HORIZONTAL (TERVERIFIKASI PJ / KARU) — {monthlyNurseReport.logbook.monthYear.toUpperCase()}
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-l border-[#1e5d8e] w-[56px] min-w-[56px] text-center bg-[#164e78]"
                            >
                              TOTAL
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-l border-[#1e5d8e] w-[56px] min-w-[56px] text-center bg-[#164e78]"
                            >
                              MAKS
                            </th>
                            <th
                              rowSpan={2}
                              className="p-2 border-l border-[#1e5d8e] w-[56px] min-w-[56px] text-center bg-[#164e78]"
                            >
                              %
                            </th>
                          </tr>

                          {/* Row 2: Horizontal Columns Date 1 to 31 */}
                          <tr className="bg-[#1a5b8c] text-white font-bold text-[9.5px] text-center">
                            {daysArray.map((day, idx) => {
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              const isActiveDay =
                                !isOutOfMonth && day === activeParsedDate.day && isCurrentMonthActive;
                              const isVerifiedDay =
                                !isOutOfMonth && Boolean(monthlyNurseReport.logbook.verifiedDays?.[idx]);
                              return (
                                <th
                                  key={day}
                                  title={
                                    isOutOfMonth
                                      ? `Tidak ada tanggal ${day} pada periode ${monthlyNurseReport.logbook.monthYear}`
                                      : `Tanggal ${day} ${monthlyNurseReport.logbook.monthYear}`
                                  }
                                  className={`p-1 border-r border-[#226ca4] w-[28px] min-w-[28px] max-w-[28px] font-mono ${
                                    isOutOfMonth
                                      ? 'bg-slate-900/60 text-slate-500'
                                      : isActiveDay
                                      ? 'bg-cyan-400 text-slate-950 font-black ring-2 ring-inset ring-white'
                                      : isVerifiedDay
                                      ? 'bg-[#246ea3] text-white'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {day}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-200 text-[11px] text-slate-800">
                          {/* Reference Row: Verified Patients per Day (1..31) */}
                          <tr className="bg-indigo-50/80 font-bold text-indigo-950 group">
                            <td
                              colSpan={2}
                              className="px-3 py-2 border-r border-slate-200 sticky left-0 bg-indigo-50/95 group-hover:bg-indigo-100 z-10 text-[10.5px] uppercase tracking-wider font-bold"
                            >
                              Pasien (Terverifikasi)
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200 text-[10.5px] text-indigo-900">
                              Jumlah sesi pasien kelolaan perawat yang telah diverifikasi PJ Shift atau Kepala Ruang
                            </td>
                            {daysArray.map((day, dayIdx) => {
                              const pCount =
                                monthlyNurseReport.logbook.dailyVerifiedPatientCounts?.[dayIdx] || 0;
                              const isVerif =
                                Boolean(monthlyNurseReport.logbook.verifiedDays?.[dayIdx]) &&
                                pCount > 0;
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              return (
                                <td
                                  key={day}
                                  className={`p-1 text-center font-mono border-r border-slate-200 text-[11px] ${
                                    isOutOfMonth
                                      ? 'bg-slate-100/60 text-slate-300'
                                      : isVerif
                                      ? 'bg-indigo-100/90 text-indigo-950 font-black'
                                      : 'text-slate-300'
                                  }`}
                                >
                                  {isOutOfMonth ? '·' : isVerif ? pCount : ''}
                                </td>
                              );
                            })}
                            <td className="p-2 text-center font-mono font-black text-indigo-950 border-l border-slate-200">
                              {monthlyNurseReport.totalVerifiedPatientsInMonth}
                            </td>
                            <td
                              colSpan={2}
                              className="p-2 text-center text-[10.5px] font-bold text-indigo-900 border-l border-slate-200"
                            >
                              Pasien Disahkan
                            </td>
                          </tr>

                          {/* Grouped 29 SPO Items (1.1 through 6.5) */}
                          {BAGIAN_SECTION_HEADERS.map((sec) => {
                            const sectionItems = OFFICIAL_LOGBOOK_ITEMS.filter(
                              (it) => it.bagian === sec.bagian
                            );

                            return (
                              <React.Fragment key={sec.bagian}>
                                <tr className="bg-slate-100/95 text-slate-900 font-bold">
                                  <td
                                    colSpan={3}
                                    className="px-3 py-2 text-[10.5px] uppercase tracking-wider sticky left-0 bg-slate-100/95 z-10 border-r border-slate-300"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-extrabold text-[#164e78]">{sec.title}</span>
                                      <span className="font-semibold text-slate-600 text-[10px] normal-case tracking-normal">
                                        {sec.ruleBadge}
                                      </span>
                                    </div>
                                  </td>
                                  <td colSpan={34} className="bg-slate-100/95 border-b border-slate-200" />
                                </tr>

                                {sectionItems.map((item, idx) => {
                                  const scoreArr =
                                    monthlyNurseReport.logbook.dailyScores?.[item.code] || [];
                                  const stat = monthlyNurseReport.itemStats[item.code] || {
                                    totalScore: 0,
                                    maxScore: 0,
                                    pct: 0
                                  };

                                  return (
                                    <tr
                                      key={item.code}
                                      className={`group transition-colors ${
                                        idx % 2 === 1
                                          ? 'bg-slate-50/50 hover:bg-blue-50/40'
                                          : 'bg-white hover:bg-blue-50/40'
                                      }`}
                                    >
                                      <td className={`px-2 py-1.5 text-center font-mono font-bold text-slate-900 border-r border-slate-200 sticky left-0 z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-blue-50/70`}>
                                        {item.code}
                                      </td>
                                      <td className={`px-2.5 py-1.5 font-bold text-slate-800 border-r border-slate-200 sticky left-[52px] z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} group-hover:bg-blue-50/70 leading-snug text-[10.5px]`}>
                                        {item.category}
                                      </td>
                                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-200 text-[11px] leading-tight">
                                        {item.description}
                                      </td>

                                      {/* Horizontal Date Columns 1 to 31 */}
                                      {daysArray.map((day, dayIdx) => {
                                        const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                                        const val = scoreArr[dayIdx];
                                        const isVerif =
                                          val !== null &&
                                          val !== undefined &&
                                          Boolean(monthlyNurseReport.logbook.verifiedDays?.[dayIdx]);
                                        const maxCell =
                                          monthlyNurseReport.logbook.dailyItemMaxScores?.[item.code]?.[
                                            dayIdx
                                          ] ??
                                          (item.bagian === 1
                                            ? 1
                                            : monthlyNurseReport.logbook
                                                .dailyVerifiedPatientCounts?.[dayIdx] || 0);

                                        const cellColor = isOutOfMonth
                                          ? 'bg-slate-100/50 text-slate-300'
                                          : !isVerif
                                          ? 'text-slate-300'
                                          : val === 0 && maxCell === 0
                                          ? 'bg-slate-50 text-slate-400 font-semibold'
                                          : val === maxCell && maxCell > 0
                                          ? 'bg-emerald-50 text-emerald-900 font-bold'
                                          : (val ?? 0) > 0
                                          ? 'bg-amber-50 text-amber-900 font-bold'
                                          : 'bg-rose-50/70 text-rose-700 font-semibold';

                                        return (
                                          <td
                                            key={day}
                                            className={`p-1 text-center font-mono border-r border-slate-200 text-[11px] ${cellColor}`}
                                            title={
                                              isOutOfMonth
                                                ? undefined
                                                : isVerif
                                                ? `Tanggal ${day}: Poin ${item.code} = ${val} dari ${maxCell} (terverifikasi)`
                                                : undefined
                                            }
                                          >
                                            {isOutOfMonth ? '·' : isVerif ? val : ''}
                                          </td>
                                        );
                                      })}

                                      <td className="p-2 text-center font-mono font-bold text-slate-900 border-l border-slate-200">
                                        {stat.totalScore}
                                      </td>
                                      <td className="p-2 text-center font-mono text-slate-500 border-l border-slate-200">
                                        {stat.maxScore}
                                      </td>
                                      <td
                                        className={`p-2 text-center font-mono font-bold border-l border-slate-200 ${
                                          stat.maxScore === 0
                                            ? 'text-slate-400'
                                            : stat.pct === 100
                                            ? 'text-emerald-700'
                                            : stat.pct >= 75
                                            ? 'text-amber-700'
                                            : 'text-rose-700'
                                        }`}
                                      >
                                        {stat.pct}%
                                      </td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}

                          {/* Sticky Footer Sums across 1..31 */}
                          <tr className="bg-slate-100 text-slate-950 font-bold text-center border-t-2 border-slate-300 text-[10.5px] sticky bottom-0 z-10 shadow-xs">
                            <td
                              colSpan={3}
                              className="px-3 py-2.5 border-r border-slate-300 text-right uppercase tracking-wider font-black sticky left-0 bg-slate-100 z-10"
                            >
                              TOTAL AKUMULASI 29 POIN SPO (VERIFIED_KARU)
                            </td>
                            {daysArray.map((day, dayIdx) => {
                              const isOutOfMonth = day > monthlyNurseReport.daysInMonth;
                              const daySum = monthlyNurseReport.dailyTotalScores[dayIdx];
                              const dayMax = monthlyNurseReport.dailyMaxScores[dayIdx];
                              const hasDay =
                                daySum !== null && daySum !== undefined && !isOutOfMonth;
                              return (
                                <td
                                  key={dayIdx}
                                  className={`p-1 border-r border-slate-300 font-mono ${
                                    isOutOfMonth
                                      ? 'bg-slate-200/50 text-slate-400'
                                      : hasDay
                                      ? 'bg-emerald-50 text-slate-950 font-black'
                                      : 'text-slate-300'
                                  }`}
                                  title={
                                    hasDay
                                      ? `Total Harian Tanggal ${day}: ${daySum} / ${dayMax}`
                                      : undefined
                                  }
                                >
                                  {isOutOfMonth ? '·' : hasDay ? daySum : ''}
                                </td>
                              );
                            })}
                            <td className="p-2 border-l border-slate-300 font-mono font-black text-[#164e78] text-xs">
                              {monthlyNurseReport.grandTotalScore}
                            </td>
                            <td className="p-2 border-l border-slate-300 font-mono font-bold text-slate-600 text-xs">
                              {monthlyNurseReport.grandMaxScore}
                            </td>
                            <td className="p-2 border-l border-slate-300 font-mono font-black text-emerald-800 text-xs">
                              {monthlyNurseReport.overallCompliancePct}%
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};
