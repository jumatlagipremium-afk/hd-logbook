import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ShiftInfo,
  AggregatedCensus,
  MachineOverview,
  ClinicalIndicatorItem,
  OperationalItem,
  SbarData,
  PatientHDSession,
  ShiftSignatures,
  SystemAccessRole,
  MasterNurse,
  MasterPatient,
  MasterDoctor,
  NurseScheduleEntry,
  DoctorScheduleEntry,
  HdTreatmentDay
} from '../types/dialysis.ts';
import { OfficialReportPrintable } from './OfficialReportPrintable.tsx';
import { LoginUserData } from './LoginPage.tsx';
import {
  extractActiveDayName,
  formatIsoDateToIndonesianFull,
  formatShortIndonesianTimestampWib,
  getCurrentIsoDateWib,
  indonesianDateLabelToIso,
  normalizeIndonesianDateLabel
} from '../utils/dateHelpers.ts';
import { printDocumentWithOrientation, downloadElementAsPdf } from '../utils/printHelpers.ts';
import {
  DEFAULT_KEPALA_RUANGAN_NAME,
  aggregateShiftVerifiedLogbooks,
  detectActiveLogbookShiftForDate,
  formatShiftHoursForShift
} from '../utils/dailyReportHelpers.ts';
import {
  LogbookVerificationRegistryEntry,
  getVerificationRegistry
} from '../utils/nurseVerificationHelpers.ts';
import {
  saveShiftReportCloud,
  subscribeToShiftReport,
  type NurseLogbookCloudData
} from '../services/firebase.ts';
import { initialMachineOverview } from '../data/mockShiftData.ts';
import {
  pasienLogbookService,
  buildKarsShiftSummaryFromVerifiedRows,
  formatSbarHandoverText,
  type LaporanPasienRow
} from '../data/laporanPasienData.ts';
import {
  FileText,
  Printer,
  FileDown,
  Sparkles,
  CheckSquare,
  Users,
  Save,
  CheckCircle,
  RefreshCw,
  Activity,
  Droplets,
  Stethoscope,
  Plus,
  Trash2,
  RotateCcw,
  Edit3,
  Cpu,
  Layers,
  ClipboardCheck,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Copy,
  Check
} from 'lucide-react';
import { exportMasterHemodialisaWorkbook } from '../utils/exportMasterSpreadsheet.ts';

interface LapHarianViewProps {
  shiftInfo: ShiftInfo;
  setShiftInfo: React.Dispatch<React.SetStateAction<ShiftInfo>>;
  census: AggregatedCensus;
  machineOverview: MachineOverview;
  setMachineOverview: React.Dispatch<React.SetStateAction<MachineOverview>>;
  clinicalIndicators: ClinicalIndicatorItem[];
  operationalItems: OperationalItem[];
  setOperationalItems: React.Dispatch<React.SetStateAction<OperationalItem[]>>;
  sbar: SbarData;
  setSbar: React.Dispatch<React.SetStateAction<SbarData>>;
  signatures: ShiftSignatures;
  setSignatures: React.Dispatch<React.SetStateAction<ShiftSignatures>>;
  sessions: PatientHDSession[];
  userRole?: SystemAccessRole;
  loggedInUser?: LoginUserData | null;
  masterNurses?: MasterNurse[];
  masterPatients?: MasterPatient[];
  masterDoctors?: MasterDoctor[];
  nurseSchedules?: NurseScheduleEntry[];
  doctorSchedules?: DoctorScheduleEntry[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  onDateChange?: (isoDate: string) => void;
  isCustomDate?: boolean;
  onResetDateToToday?: () => void;
}

type LapHarianSubTab =
  | 'preview_full'
  | 'section_a'
  | 'section_b'
  | 'section_c'
  | 'section_d'
  | 'section_e'
  | 'section_f';

const STORAGE_KEYS = {
  CENSUS: 'rshl_manual_census_v4',
  MACHINE: 'rshl_manual_machine_v3',
  CLINICAL: 'rshl_manual_clinical_v4'
};

export const LapHarianView: React.FC<LapHarianViewProps> = ({
  shiftInfo,
  setShiftInfo,
  machineOverview,
  setMachineOverview,
  clinicalIndicators,
  operationalItems,
  setOperationalItems,
  sbar,
  setSbar,
  signatures,
  setSignatures,
  sessions,
  userRole = 'pj_shift',
  loggedInUser,
  masterNurses = [],
  masterPatients = [],
  masterDoctors = [],
  nurseSchedules = [],
  doctorSchedules = [],
  cloudNurseLogbooks = [],
  onDateChange,
  isCustomDate = false,
  onResetDateToToday
}) => {
  const isSupervisor = userRole === 'pj_shift' || userRole === 'kepala_ruangan';
  const [activeSubTab, setActiveSubTab] = useState<LapHarianSubTab>('preview_full');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedSbar, setCopiedSbar] = useState<boolean>(false);

  // Inisialisasi default ke preview dokumen lengkap KARS, namun mengizinkan navigasi bebas ke Blok A-F
  useEffect(() => {
    // Biarkan user memilih tab tanpa di-lock secara paksa
  }, []);

  const activeDay = extractActiveDayName(shiftInfo.date) as HdTreatmentDay;
  const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
  const activeDateIso = indonesianDateLabelToIso(normalizeIndonesianDateLabel(shiftInfo.date));

  // Live verification registry entries & logbook shift doctors for schedule signatory metadata
  const [registryEntries, setRegistryEntries] = useState<LogbookVerificationRegistryEntry[]>(() =>
    getVerificationRegistry(masterNurses)
  );
  const [logbookDoctorSyncTick, setLogbookDoctorSyncTick] = useState(0);

  useEffect(() => {
    const refreshRegistry = () => {
      setRegistryEntries(getVerificationRegistry(masterNurses));
      setLogbookDoctorSyncTick((t) => t + 1);
    };
    const refreshDoctors = () => {
      setLogbookDoctorSyncTick((t) => t + 1);
    };
    refreshRegistry();
    window.addEventListener('logbook_records_updated', refreshRegistry);
    window.addEventListener('verification_registry_updated', refreshRegistry);
    window.addEventListener('logbook_shift_doctors_updated', refreshDoctors);
    window.addEventListener('storage', refreshDoctors);
    return () => {
      window.removeEventListener('logbook_records_updated', refreshRegistry);
      window.removeEventListener('verification_registry_updated', refreshRegistry);
      window.removeEventListener('logbook_shift_doctors_updated', refreshDoctors);
      window.removeEventListener('storage', refreshDoctors);
    };
  }, [masterNurses, sessions]);

  // Schedule & signatory metadata helper (PJ Shift, DPJP, Dokter Jaga, Kepala Ruang)
  const shiftSummary = useMemo(() => {
    void logbookDoctorSyncTick;
    return aggregateShiftVerifiedLogbooks({
      sessions,
      registryEntries,
      masterNurses,
      masterPatients,
      nurseSchedules,
      doctorSchedules,
      cloudNurseLogbooks,
      activeDateLabel: shiftInfo.date,
      activeShift,
      loggedInUserName: loggedInUser?.name,
      fallbackShiftInfo: shiftInfo
    });
  }, [
    sessions,
    registryEntries,
    masterNurses,
    masterPatients,
    nurseSchedules,
    doctorSchedules,
    cloudNurseLogbooks,
    logbookDoctorSyncTick,
    shiftInfo,
    activeShift,
    loggedInUser?.name
  ]);

  const shiftScopeKey = `${activeDateIso}_${activeShift}`;

  // =========================================================================
  // CLOUD FIRESTORE FETCH: pasienLogbookService.getVerifiedReportsByShift(tanggal, shift)
  // Hanya menarik sesi pasien dengan status minimal 'verified_pj' atau 'verified_karu'
  // =========================================================================
  const [verifiedShiftRows, setVerifiedShiftRows] = useState<LaporanPasienRow[]>([]);
  const [isLoadingCloudReport, setIsLoadingCloudReport] = useState<boolean>(true);
  const [cloudReportError, setCloudReportError] = useState<string | null>(null);

  const fetchVerifiedShiftReports = useCallback(
    async (tanggalIso: string, shiftName: 'Pagi' | 'Siang') => {
      setIsLoadingCloudReport(true);
      setCloudReportError(null);
      try {
        const rows = await pasienLogbookService.getVerifiedReportsByShift(tanggalIso, shiftName);
        const strictlyVerified = rows.filter(
          (r) => r.statusVerifikasi === 'verified_pj' || r.statusVerifikasi === 'verified_karu'
        );
        setVerifiedShiftRows(strictlyVerified);
      } catch (err) {
        console.error(
          'Gagal mengambil rangkuman shift terverifikasi dari Cloud Firestore:',
          err
        );
        setCloudReportError(
          'Gagal memuat data sesi pasien terverifikasi (verified_pj / verified_karu) dari jaringan Cloud Firestore.'
        );
      } finally {
        setIsLoadingCloudReport(false);
      }
    },
    []
  );

  useEffect(() => {
    let isMounted = true;
    void fetchVerifiedShiftReports(activeDateIso, activeShift);

    const unsubVerifiedShift = pasienLogbookService.subscribeVerifiedReportsByShift(
      activeDateIso,
      activeShift,
      (rows) => {
        if (!isMounted) return;
        const strictlyVerified = rows.filter(
          (r) => r.statusVerifikasi === 'verified_pj' || r.statusVerifikasi === 'verified_karu'
        );
        setVerifiedShiftRows(strictlyVerified);
        setIsLoadingCloudReport(false);
      },
      (err) => {
        console.error(
          'Subscription error pasienLogbookService.subscribeVerifiedReportsByShift:',
          err
        );
        if (!isMounted) return;
        setCloudReportError(
          'Sinkronisasi real-time laporan shift terganggu. Silakan klik Sinkron Logbook untuk menyegarkan.'
        );
        setIsLoadingCloudReport(false);
      }
    );

    const handleLocalVerifiedRefresh = () => {
      void pasienLogbookService
        .getVerifiedReportsByShift(activeDateIso, activeShift)
        .then((rows) => {
          if (!isMounted) return;
          setVerifiedShiftRows(
            rows.filter(
              (r) => r.statusVerifikasi === 'verified_pj' || r.statusVerifikasi === 'verified_karu'
            )
          );
        })
        .catch(() => {});
    };

    window.addEventListener('logbook_sessions_updated', handleLocalVerifiedRefresh);
    window.addEventListener('logbook_records_updated', handleLocalVerifiedRefresh);

    return () => {
      isMounted = false;
      unsubVerifiedShift();
      window.removeEventListener('logbook_sessions_updated', handleLocalVerifiedRefresh);
      window.removeEventListener('logbook_records_updated', handleLocalVerifiedRefresh);
    };
  }, [activeDateIso, activeShift, fetchVerifiedShiftReports]);

  const [manualMachine, setManualMachine] = useState<MachineOverview>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MACHINE);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return machineOverview || initialMachineOverview;
  });

  // Base ShiftInfo for KARS summary generation
  const baseShiftInfoForKars = useMemo<ShiftInfo>(
    () => ({
      ...shiftInfo,
      date: shiftSummary.activeDateFormatted,
      shift: activeShift,
      shiftHours: shiftSummary.shiftHours,
      pjShift: shiftSummary.pjShiftName || shiftInfo.pjShift,
      pjShiftBerikutnya:
        shiftSummary.pjShiftBerikutnyaName || shiftInfo.pjShiftBerikutnya || '',
      kepalaRuangan: shiftSummary.kepalaRuanganName || DEFAULT_KEPALA_RUANGAN_NAME,
      dokterDpjp: shiftSummary.dokterDpjpName,
      dokterJaga: shiftSummary.dokterJagaName
    }),
    [shiftInfo, shiftSummary, activeShift]
  );

  // =========================================================================
  // KALKULASI AKREDITASI KARS (BLOK A–F) MURNI DARI 'verified_pj' & 'verified_karu'
  // =========================================================================
  const karsSummary = useMemo(
    () =>
      buildKarsShiftSummaryFromVerifiedRows({
        verifiedRows: verifiedShiftRows,
        tanggal: activeDateIso,
        shift: activeShift,
        shiftInfo: baseShiftInfoForKars,
        baseMachineOverview: manualMachine,
        masterNurses,
        masterDoctors,
        nurseSchedules,
        doctorSchedules
      }),
    [
      verifiedShiftRows,
      activeDateIso,
      activeShift,
      baseShiftInfoForKars,
      manualMachine,
      masterNurses,
      masterDoctors,
      nurseSchedules,
      doctorSchedules
    ]
  );

  const verifiedNurseCountLabel =
    karsSummary.jumlahPerawatTerverifikasi > 0
      ? `${karsSummary.jumlahPerawatTerverifikasi} Orang Perawat`
      : shiftSummary.jumlahPerawatDinasLabel;

  // Effective ShiftInfo with Blok A auto-computed values for display & printable sheet
  const effectiveShiftInfo = useMemo<ShiftInfo>(
    () => ({
      ...baseShiftInfoForKars,
      totalPerawatDinas:
        karsSummary.jumlahPerawatTerverifikasi > 0
          ? karsSummary.jumlahPerawatTerverifikasi
          : shiftSummary.jumlahPerawatDinas,
      detailPerawat: verifiedNurseCountLabel,
      perawatRatio: karsSummary.rasioPerawatPasien
    }),
    [baseShiftInfoForKars, karsSummary, shiftSummary.jumlahPerawatDinas, verifiedNurseCountLabel]
  );

  // Track whether user manually edited census / clinical / operational / sbar in the current date+shift scope
  const [manualOverrideScope, setManualOverrideScope] = useState<{
    censusScope: string | null;
    clinicalScope: string | null;
    operationalScope: string | null;
    sbarScope: string | null;
    manualShiftDateIso: string | null;
  }>({
    censusScope: null,
    clinicalScope: null,
    operationalScope: null,
    sbarScope: null,
    manualShiftDateIso: null
  });

  const [manualCensus, setManualCensus] = useState<AggregatedCensus>(() => karsSummary.census);

  const [manualClinical, setManualClinical] = useState<ClinicalIndicatorItem[]>(() =>
    karsSummary.clinicalIndicators.length > 0 ? karsSummary.clinicalIndicators : clinicalIndicators
  );

  // Synchronize Blok B (Sensus), Blok C (Indikator Mutu Klinis), Blok D (Checklist RO), and Blok E (SBAR)
  // strictly with verified shift sessions ('verified_pj' | 'verified_karu')
  useEffect(() => {
    if (manualOverrideScope.censusScope !== shiftScopeKey) {
      setManualCensus(karsSummary.census);
    }
  }, [karsSummary.census, shiftScopeKey, manualOverrideScope.censusScope]);

  useEffect(() => {
    if (manualOverrideScope.clinicalScope !== shiftScopeKey) {
      setManualClinical(karsSummary.clinicalIndicators);
    }
  }, [karsSummary.clinicalIndicators, shiftScopeKey, manualOverrideScope.clinicalScope]);

  useEffect(() => {
    if (manualOverrideScope.operationalScope !== shiftScopeKey) {
      setOperationalItems(karsSummary.operationalItems);
    }
  }, [
    karsSummary.operationalItems,
    shiftScopeKey,
    manualOverrideScope.operationalScope,
    setOperationalItems
  ]);

  useEffect(() => {
    if (manualOverrideScope.sbarScope !== shiftScopeKey) {
      setSbar(karsSummary.autoSbar);
    }
  }, [karsSummary.autoSbar, shiftScopeKey, manualOverrideScope.sbarScope, setSbar]);

  // Keep parent shiftInfo manpower & Logbook doctor fields aligned
  useEffect(() => {
    setShiftInfo((prev) => {
      const nextPjBerikutnya =
        shiftSummary.pjShiftBerikutnyaName && shiftSummary.pjShiftBerikutnyaName !== '-'
          ? shiftSummary.pjShiftBerikutnyaName
          : prev.pjShiftBerikutnya;
      const nextNurseCount =
        karsSummary.jumlahPerawatTerverifikasi > 0
          ? karsSummary.jumlahPerawatTerverifikasi
          : shiftSummary.jumlahPerawatDinas;

      if (
        prev.pjShift === shiftSummary.pjShiftName &&
        prev.pjShiftBerikutnya === nextPjBerikutnya &&
        prev.kepalaRuangan === shiftSummary.kepalaRuanganName &&
        prev.dokterDpjp === shiftSummary.dokterDpjpName &&
        prev.dokterJaga === shiftSummary.dokterJagaName &&
        prev.totalPerawatDinas === nextNurseCount &&
        prev.detailPerawat === verifiedNurseCountLabel &&
        prev.perawatRatio === karsSummary.rasioPerawatPasien &&
        prev.shiftHours === shiftSummary.shiftHours
      ) {
        return prev;
      }
      return {
        ...prev,
        shiftHours: shiftSummary.shiftHours,
        pjShift: shiftSummary.pjShiftName,
        pjShiftBerikutnya: nextPjBerikutnya || prev.pjShiftBerikutnya,
        kepalaRuangan: shiftSummary.kepalaRuanganName,
        dokterDpjp: shiftSummary.dokterDpjpName,
        dokterJaga: shiftSummary.dokterJagaName,
        totalPerawatDinas: nextNurseCount,
        detailPerawat: verifiedNurseCountLabel,
        perawatRatio: karsSummary.rasioPerawatPasien
      };
    });
  }, [
    setShiftInfo,
    shiftSummary.pjShiftName,
    shiftSummary.pjShiftBerikutnyaName,
    shiftSummary.kepalaRuanganName,
    shiftSummary.dokterDpjpName,
    shiftSummary.dokterJagaName,
    shiftSummary.jumlahPerawatDinas,
    shiftSummary.shiftHours,
    karsSummary.jumlahPerawatTerverifikasi,
    karsSummary.rasioPerawatPasien,
    verifiedNurseCountLabel
  ]);

  // Sync unsigned signature names with PJ Shift, PJ Shift Berikutnya, and Kepala Ruangan
  useEffect(() => {
    setSignatures((prev) => {
      const nextPjName = prev.pjShift.signed ? prev.pjShift.name : shiftSummary.pjShiftName;
      const nextPjBerikutnyaName = prev.pjBerikutnya.signed
        ? prev.pjBerikutnya.name
        : shiftSummary.pjShiftBerikutnyaName || prev.pjBerikutnya.name;
      const nextKaruName = prev.kepalaRuangan.signed
        ? prev.kepalaRuangan.name
        : shiftSummary.kepalaRuanganName;
      if (
        prev.pjShift.name === nextPjName &&
        prev.pjBerikutnya.name === nextPjBerikutnyaName &&
        prev.kepalaRuangan.name === nextKaruName
      ) {
        return prev;
      }
      return {
        ...prev,
        pjShift: { ...prev.pjShift, name: nextPjName },
        pjBerikutnya: { ...prev.pjBerikutnya, name: nextPjBerikutnyaName },
        kepalaRuangan: { ...prev.kepalaRuangan, name: nextKaruName }
      };
    });
  }, [
    setSignatures,
    shiftSummary.pjShiftName,
    shiftSummary.pjShiftBerikutnyaName,
    shiftSummary.kepalaRuanganName
  ]);

  // Real-time Cloud Firestore listener for supporting staff & signatures
  useEffect(() => {
    const unsub = subscribeToShiftReport(
      activeDateIso,
      activeShift,
      (cloudReport) => {
        if (cloudReport.shiftInfo) {
          setShiftInfo((prev) => ({
            ...prev,
            tenagaPendukung:
              cloudReport.shiftInfo?.tenagaPendukung !== undefined
                ? cloudReport.shiftInfo.tenagaPendukung
                : prev.tenagaPendukung,
            pjShiftBerikutnya:
              cloudReport.shiftInfo?.pjShiftBerikutnya !== undefined
                ? cloudReport.shiftInfo.pjShiftBerikutnya
                : prev.pjShiftBerikutnya
          }));
        }
        if (cloudReport.signatures) {
          setSignatures((prev) => ({
            pjShift: cloudReport.signatures?.pjShift?.signed
              ? cloudReport.signatures.pjShift
              : { ...prev.pjShift, name: shiftSummary.pjShiftName },
            pjBerikutnya: cloudReport.signatures?.pjBerikutnya || prev.pjBerikutnya,
            kepalaRuangan: cloudReport.signatures?.kepalaRuangan?.signed
              ? cloudReport.signatures.kepalaRuangan
              : { ...prev.kepalaRuangan, name: shiftSummary.kepalaRuanganName }
          }));
        }
      }
    );
    return () => unsub();
  }, [
    activeDateIso,
    activeShift,
    shiftSummary.pjShiftName,
    shiftSummary.kepalaRuanganName,
    setShiftInfo,
    setSignatures
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEYS.CENSUS}_${shiftScopeKey}`, JSON.stringify(manualCensus));
    } catch {
      // storage quota
    }
  }, [manualCensus, shiftScopeKey]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.MACHINE, JSON.stringify(manualMachine));
      setMachineOverview(manualMachine);
    } catch {
      // storage quota
    }
  }, [manualMachine, setMachineOverview]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEYS.CLINICAL}_${shiftScopeKey}`, JSON.stringify(manualClinical));
    } catch {
      // storage quota
    }
  }, [manualClinical, shiftScopeKey]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // Formatted SBAR Handover Text ready to read/copy below Blok A–F
  const formattedSbarHandoverText = useMemo(
    () =>
      formatSbarHandoverText({
        shiftInfo: effectiveShiftInfo,
        census: manualCensus,
        qualityMetrics: karsSummary.qualityMetrics,
        roChecklist: karsSummary.roChecklist,
        sbar,
        signatures
      }),
    [effectiveShiftInfo, manualCensus, karsSummary.qualityMetrics, karsSummary.roChecklist, sbar, signatures]
  );

  const handleCopySbarText = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(formattedSbarHandoverText);
      }
      setCopiedSbar(true);
      showToast('Format teks serah terima SBAR berhasil disalin ke papan klip.');
      setTimeout(() => setCopiedSbar(false), 2500);
    } catch (err) {
      console.error('Clipboard copy error:', err);
      showToast('Gagal menyalin otomatis, silakan blok dan salin teks SBAR di bawah.');
    }
  };

  // =========================================================================
  // LOGBOOK SHIFT AUTO-SYNCHRONIZATION (FOR PJ SHIFT & KEPALA RUANGAN)
  // =========================================================================
  useEffect(() => {
    if (userRole !== 'pj_shift' && userRole !== 'kepala_ruangan') return;
    if (manualOverrideScope.manualShiftDateIso === activeDateIso) return;

    let savedLastShift: string | null = null;
    try {
      savedLastShift = localStorage.getItem('dialysis_last_logbook_shift');
    } catch {
      // ignore
    }

    const detectedShift = detectActiveLogbookShiftForDate({
      activeDateLabel: shiftInfo.date,
      sessions,
      registryEntries,
      lastSelectedLogbookShift: savedLastShift,
      loggedInUserShift: loggedInUser?.shift
    });

    if (detectedShift && detectedShift !== activeShift) {
      const nextHours = formatShiftHoursForShift(detectedShift);
      setShiftInfo((prev) => ({
        ...prev,
        shift: detectedShift,
        shiftHours: nextHours
      }));
      showToast(
        `Shift Laporan Harian otomatis diselaraskan ke Shift ${detectedShift} sesuai input logbook.`
      );
    }
  }, [
    userRole,
    shiftInfo.date,
    activeDateIso,
    sessions,
    registryEntries,
    activeShift,
    loggedInUser?.shift,
    manualOverrideScope.manualShiftDateIso,
    setShiftInfo
  ]);

  const handleSwitchShift = (targetShift: 'Pagi' | 'Siang') => {
    const nextHours = formatShiftHoursForShift(targetShift);

    try {
      localStorage.setItem('dialysis_last_logbook_shift', targetShift);
    } catch {
      // ignore
    }

    setManualOverrideScope((prev) => ({
      ...prev,
      manualShiftDateIso: activeDateIso
    }));

    setShiftInfo((prev) => ({
      ...prev,
      shift: targetShift,
      shiftHours: nextHours
    }));
    showToast(`Shift Laporan dialihkan ke Shift ${targetShift} (${nextHours}).`);
  };

  const handleDatePickerChange = (nextIso: string) => {
    if (!nextIso) return;
    setManualOverrideScope((prev) => ({
      ...prev,
      manualShiftDateIso: null
    }));
    if (onDateChange) {
      onDateChange(nextIso);
    } else {
      setShiftInfo((prev) => ({
        ...prev,
        date: formatIsoDateToIndonesianFull(nextIso)
      }));
    }
  };

  // =========================================================================
  // ACTIONS & HANDLERS
  // =========================================================================

  const handleCensusChange = (field: keyof AggregatedCensus, value: number) => {
    const safeVal = Math.max(0, isNaN(value) ? 0 : value);
    setManualOverrideScope((prev) => ({ ...prev, censusScope: shiftScopeKey }));
    setManualCensus((prev) => {
      const next = { ...prev, [field]: safeVal };
      if (field === 'pasienHadirSelesai' || field === 'pasienCitoEmergency') {
        next.totalPasienDilayani = next.pasienHadirSelesai + next.pasienCitoEmergency;
      }
      return next;
    });
  };

  const handleMachineChange = (field: keyof MachineOverview, value: number) => {
    const safeVal = Math.max(0, isNaN(value) ? 0 : value);
    setManualMachine((prev) => ({ ...prev, [field]: safeVal }));
  };

  const handleClinicalChange = (
    id: string,
    field: keyof ClinicalIndicatorItem,
    value: string | boolean
  ) => {
    setManualOverrideScope((prev) => ({ ...prev, clinicalScope: shiftScopeKey }));
    setManualClinical((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleAddClinicalIndicator = () => {
    const newId = `cli-${Date.now()}`;
    const newItem: ClinicalIndicatorItem = {
      id: newId,
      label: 'Indikator Klinis Baru',
      capaian: '0%',
      standar: '≥ 90%',
      analisis: 'Hasil observasi dan tindak lanjut',
      isStandardMet: true
    };
    setManualOverrideScope((prev) => ({ ...prev, clinicalScope: shiftScopeKey }));
    setManualClinical((prev) => [...prev, newItem]);
    showToast('Baris indikator klinis baru berhasil ditambahkan.');
  };

  const handleDeleteClinicalIndicator = (id: string) => {
    setManualOverrideScope((prev) => ({ ...prev, clinicalScope: shiftScopeKey }));
    setManualClinical((prev) => prev.filter((item) => item.id !== id));
    showToast('Baris indikator klinis dihapus.');
  };

  const handleResetClinicalToStandard = () => {
    setManualOverrideScope((prev) => ({ ...prev, clinicalScope: null }));
    setManualClinical(karsSummary.clinicalIndicators);
    showToast('Indikator mutu klinis diselaraskan kembali ke sesi pasien terverifikasi.');
  };

  const handleOperationalChange = (
    id: string,
    field: keyof OperationalItem,
    value: string
  ) => {
    setManualOverrideScope((prev) => ({ ...prev, operationalScope: shiftScopeKey }));
    setOperationalItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleAddOperationalItem = () => {
    const newId = `op-${Date.now()}`;
    const newItem: OperationalItem = {
      id: newId,
      item: 'Item Pengawasan Baru',
      parameterUji: 'Parameter pengawasan & pengujian',
      hasilObservasi: 'Hasil observasi fisik / uji shift',
      statusKepatuhan: 'MEMENUHI SYARAT'
    };
    setManualOverrideScope((prev) => ({ ...prev, operationalScope: shiftScopeKey }));
    setOperationalItems((prev) => [...prev, newItem]);
    showToast('Baris item operasional baru berhasil ditambahkan.');
  };

  const handleDeleteOperationalItem = (id: string) => {
    setManualOverrideScope((prev) => ({ ...prev, operationalScope: shiftScopeKey }));
    setOperationalItems((prev) => prev.filter((item) => item.id !== id));
    showToast('Item operasional dihapus.');
  };

  const handleResetOperationalToStandard = () => {
    setManualOverrideScope((prev) => ({ ...prev, operationalScope: null }));
    setOperationalItems(karsSummary.operationalItems);
    showToast('Checklist RO & item operasional diselaraskan ke sesi pasien terverifikasi.');
  };

  const handlePullBaselineFromSessions = async () => {
    await fetchVerifiedShiftReports(activeDateIso, activeShift);
    setRegistryEntries(getVerificationRegistry(masterNurses));
    setManualOverrideScope((prev) => ({
      ...prev,
      censusScope: null,
      clinicalScope: null,
      operationalScope: null,
      sbarScope: null
    }));
    showToast(
      `Rangkuman KARS Shift ${activeShift} (${shiftSummary.activeDateFormatted}) disinkronkan dari sesi berstatus verified_pj / verified_karu.`
    );
  };

  const handleRegenerateSbar = () => {
    setManualOverrideScope((prev) => ({ ...prev, sbarScope: null }));
    setSbar(karsSummary.autoSbar);
    showToast('Format SBAR diperbarui dari sesi pasien terverifikasi (verified_pj / verified_karu).');
  };

  const handleSign = (roleKey: 'pjShift' | 'pjBerikutnya' | 'kepalaRuangan') => {
    const timeFormatted = formatShortIndonesianTimestampWib();
    const signerName =
      roleKey === 'pjShift'
        ? shiftSummary.pjShiftName || 'PJ Shift'
        : roleKey === 'kepalaRuangan'
        ? shiftSummary.kepalaRuanganName || DEFAULT_KEPALA_RUANGAN_NAME
        : shiftInfo.pjShiftBerikutnya || 'PJ Shift Berikutnya';

    const nextSignatures: ShiftSignatures = {
      ...signatures,
      [roleKey]: {
        name: signerName,
        signed: true,
        signedAt: timeFormatted
      }
    };
    setSignatures(nextSignatures);

    saveShiftReportCloud(activeDateIso, activeShift, {
      shiftInfo: effectiveShiftInfo,
      sbar,
      signatures: nextSignatures,
      operationalItems
    }).catch(() => {});

    const roleTitle =
      roleKey === 'pjShift'
        ? 'PJ Shift'
        : roleKey === 'pjBerikutnya'
        ? 'PJ Shift Berikutnya'
        : 'Kepala Ruangan';
    showToast(`Pengesahan digital ${roleTitle} berhasil dibubuhkan (${timeFormatted}).`);
  };

  const handleResetSignature = (roleKey: 'pjShift' | 'pjBerikutnya' | 'kepalaRuangan') => {
    const nextSignatures: ShiftSignatures = {
      ...signatures,
      [roleKey]: {
        ...signatures[roleKey],
        signed: false,
        signedAt: ''
      }
    };
    setSignatures(nextSignatures);
    saveShiftReportCloud(activeDateIso, activeShift, {
      shiftInfo: effectiveShiftInfo,
      sbar,
      signatures: nextSignatures,
      operationalItems
    }).catch(() => {});
    showToast('Status tanda tangan telah direset.');
  };

  const handleSaveAllReport = () => {
    try {
      localStorage.setItem(`${STORAGE_KEYS.CENSUS}_${shiftScopeKey}`, JSON.stringify(manualCensus));
      localStorage.setItem(STORAGE_KEYS.MACHINE, JSON.stringify(manualMachine));
      localStorage.setItem(`${STORAGE_KEYS.CLINICAL}_${shiftScopeKey}`, JSON.stringify(manualClinical));
      localStorage.setItem('rshl_shift_operational_v1', JSON.stringify(operationalItems));
      localStorage.setItem('rshl_shift_sbar_v1', JSON.stringify(sbar));
      localStorage.setItem('dialysis_signatures_v1', JSON.stringify(signatures));
    } catch {
      // ignore
    }
    saveShiftReportCloud(activeDateIso, activeShift, {
      shiftInfo: effectiveShiftInfo,
      sbar,
      signatures,
      operationalItems
    }).catch(() => {});
    showToast('Laporan Harian PJ Shift berhasil disimpan dan disinkronkan ke Cloud.');
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handlePrint = () => {
    handleSaveAllReport();
    if (activeSubTab !== 'preview_full') {
      setActiveSubTab('preview_full');
    }
    showToast('Membuka dialog cetak Laporan PJ Shift...');
    const docTitle = `Laporan_PJ_Shift_${activeShift}_${activeDateIso}`;
    setTimeout(() => {
      printDocumentWithOrientation(false, docTitle);
    }, 250);
  };

  const handleDownloadPdf = async () => {
    handleSaveAllReport();
    if (activeSubTab !== 'preview_full') {
      setActiveSubTab('preview_full');
    }
    setIsExportingPdf(true);
    showToast('Memproses dan mengunduh file PDF Laporan PJ Shift...');
    const docTitle = `Laporan_PJ_Shift_${activeShift}_${activeDateIso}`;
    setTimeout(async () => {
      try {
        await downloadElementAsPdf('printable-report', {
          filename: docTitle,
          isLandscape: false
        });
        showToast('File PDF Laporan PJ Shift berhasil diunduh.');
      } catch (err) {
        console.error('Failed to download PDF:', err);
        showToast('Gagal mengunduh PDF, silakan gunakan tombol Cetak.');
      } finally {
        setIsExportingPdf(false);
      }
    }, 250);
  };

  const handleExportMasterSpreadsheet = () => {
    exportMasterHemodialisaWorkbook({
      shiftInfo: effectiveShiftInfo,
      sessions,
      laporanPasienRows: verifiedShiftRows.length > 0 ? verifiedShiftRows : undefined,
      operationalItems,
      sbar,
      masterNurses,
      masterPatients,
      masterDoctors
    });
    showToast('File Master Spreadsheet (.xlsx) 5-Sheet berhasil diunduh.');
  };

  const activeDateFormatted = shiftSummary.activeDateFormatted;

  return (
    <div className="w-full max-w-[1750px] mx-auto px-2 sm:px-4 space-y-4 pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs border border-slate-700 animate-in fade-in slide-in-from-bottom-3">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Top Banner & Title Lockup */}
      <div className="bg-white/95 backdrop-blur-md rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-xs space-y-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-semibold">
              <span className="text-[#1e4b85] font-bold uppercase tracking-wider">Model Akreditasi KARS (Blok A–F)</span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span>Basis: Minimal Verified PJ / Ka. Ruang</span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span className="truncate">{shiftInfo?.hospitalName || 'RS Happy Land Medical Centre'}</span>
            </div>
            <h1 className="text-lg sm:text-xl font-black text-slate-950 mt-1 uppercase tracking-tight">
              {isSupervisor ? 'LAPORAN PJ SHIFT (AKREDITASI KARS BLOK A–F)' : 'LAPORAN HARIAN SHIFT HEMODIALISIS (BLOK A–F)'}
            </h1>
            <p className="text-xs text-slate-600 mt-0.5 max-w-3xl leading-relaxed">
              Menghitung sensus pasien, persentase mutu klinis, checklist Water Treatment RO, serta serah terima SBAR secara real-time dari sesi pasien berstatus minimal <strong>verified_pj</strong> atau <strong>verified_karu</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handlePullBaselineFromSessions()}
              disabled={isLoadingCloudReport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold border border-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Tarik ulang sesi terverifikasi dari Cloud Firestore"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${isLoadingCloudReport ? 'animate-spin' : ''}`} />
              <span>Sinkron Logbook</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAllReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>Simpan Laporan</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              title="Cetak langsung dokumen ke printer / dialog cetak"
            >
              <Printer className="w-4 h-4" />
              <span>Cetak</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              title="Download dokumen Laporan PJ Shift langsung sebagai file PDF (.pdf)"
            >
              <FileDown className="w-4 h-4" />
              <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportMasterSpreadsheet}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              title="Unduh 1 File Master Excel (.xlsx) yang menggabungkan Laporan Pasien, Laporan PJ Shift, dan Rekapitulasi Bulanan Semua Perawat"
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>Master Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Summary Strip of Shift Filter + Cloud Verification Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200/80 text-xs">
          <div className="inline-flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 font-semibold text-slate-700 tabular-nums">
            <Calendar className="w-3.5 h-3.5 text-[#1e4b85] shrink-0" />
            <span>Filter Tanggal Laporan:</span>
            <input
              type="date"
              aria-label="Pilih Tanggal Laporan Harian"
              value={activeDateIso}
              onChange={(e) => handleDatePickerChange(e.target.value)}
              className="bg-transparent font-bold text-slate-900 outline-hidden cursor-pointer"
            />
            {isCustomDate && onResetDateToToday && (
              <button
                type="button"
                onClick={onResetDateToToday}
                className="text-[11px] font-bold text-[#1e4b85] hover:underline cursor-pointer ml-1 whitespace-nowrap shrink-0"
              >
                Hari Ini
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-700 tabular-nums">
            {isLoadingCloudReport ? (
              <span className="inline-flex items-center gap-1.5 text-[#1e4b85] font-bold">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>Menarik sesi terverifikasi dari Cloud Firestore...</span>
              </span>
            ) : (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="font-bold text-slate-900">
                  Sesi Terverifikasi: {karsSummary.qualityMetrics.totalVerifiedSessions} Pasien
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-blue-800">
                  Verified PJ: {karsSummary.qualityMetrics.verifiedPjCount}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-800">
                  Verified Ka. Ruang: {karsSummary.qualityMetrics.verifiedKaruCount}
                </span>
              </>
            )}
          </div>
        </div>

        {cloudReportError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-semibold">{cloudReportError}</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchVerifiedShiftReports(activeDateIso, activeShift)}
              className="px-3 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer whitespace-nowrap shrink-0"
            >
              Coba Lagi
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1 text-xs tabular-nums">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Hari / Tanggal</span>
            <span className="font-bold text-slate-900 block mt-0.5 truncate" title={activeDateFormatted}>
              {activeDateFormatted}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Shift Dinas</span>
            <span className="font-bold text-[#1e4b85] block mt-0.5 truncate" title={effectiveShiftInfo.shiftHours}>
              Shift {activeShift} ({activeShift === 'Siang' ? '14.00–21.00' : '07.00–14.00'})
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">PJ Shift</span>
            <span className="font-bold text-slate-900 block mt-0.5 truncate" title={effectiveShiftInfo.pjShift}>
              {effectiveShiftInfo.pjShift}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Perawat Terverifikasi</span>
            <span className="font-extrabold text-slate-900 block mt-0.5">
              {verifiedNurseCountLabel}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Rasio Perawat : Pasien</span>
            <span className="font-extrabold text-emerald-800 block mt-0.5 truncate" title={karsSummary.rasioPerawatPasien}>
              {karsSummary.rasioPerawatPasien}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200">
            <span className="text-[11px] text-blue-800 block">Sensus Terverifikasi</span>
            <span className="font-extrabold text-blue-950 block mt-0.5 truncate">
              {manualCensus.totalPasienDilayani} Pasien
            </span>
          </div>
        </div>
      </div>

      {/* Sub-Tabs Navigation for Section Selection */}
      <div className="bg-white/95 backdrop-blur-md p-1.5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveSubTab('preview_full')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'preview_full'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            Dokumen KARS (Blok A–F)
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('section_a')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'section_a'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            Blok A: Ketenagaan
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('section_b')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'section_b'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Activity className="w-4 h-4" />
            Blok B: Sensus &amp; Mesin
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('section_c')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'section_c'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Stethoscope className="w-4 h-4" />
            Blok C: Mutu Klinis
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('section_d')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'section_d'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            Blok D: Checklist RO
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('section_e')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'section_e'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Blok E: SBAR
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('section_f')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'section_f'
                ? 'bg-[#1e4b85] text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Blok F: Pengesahan
          </button>
        </div>

        {/* Active Date & Shift Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 text-[11px] font-semibold text-slate-700 tabular-nums">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#1e4b85]" />
            <input
              type="date"
              aria-label="Pilih Tanggal Laporan Harian"
              value={activeDateIso}
              onChange={(e) => handleDatePickerChange(e.target.value)}
              className="bg-white border border-slate-200 rounded-md px-2 py-0.5 text-[11px] font-bold text-slate-900 cursor-pointer"
            />
            {isCustomDate && onResetDateToToday && (
              <button
                type="button"
                onClick={onResetDateToToday}
                className="px-2 py-0.5 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-[10px] font-bold text-[#1e4b85] cursor-pointer whitespace-nowrap"
              >
                Hari Ini
              </button>
            )}
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => handleSwitchShift('Pagi')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                activeShift === 'Pagi'
                  ? 'bg-[#1e4b85] text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Shift Pagi (07.00 - 14.00 WIB)"
            >
              Shift Pagi
            </button>
            <button
              type="button"
              onClick={() => handleSwitchShift('Siang')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                activeShift === 'Siang'
                  ? 'bg-[#1e4b85] text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Shift Siang (14.00 - 21.00 WIB)"
            >
              Shift Siang
            </button>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 1. RANGKUMAN AKREDITASI KARS (BLOK A–F) + FORMAT TEKS SBAR            */}
      {/* ===================================================================== */}
      {activeSubTab === 'preview_full' ? (
        <div className="space-y-5">
          {/* Loading State Skeleton while pulling Cloud Firestore verified shift sessions */}
          {isLoadingCloudReport && verifiedShiftRows.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 animate-pulse print:hidden">
              <div className="h-4 w-72 bg-slate-200 rounded" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="h-24 bg-slate-100 rounded-xl" />
                <div className="h-24 bg-slate-100 rounded-xl" />
                <div className="h-24 bg-slate-100 rounded-xl" />
              </div>
            </div>
          )}

          {/* Rangkuman Eksekutif Model Akreditasi KARS (Blok A–F) di Layar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs print:hidden tabular-nums">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-950">
                  Rangkuman Shift Model Akreditasi KARS (Blok A–F)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Dihitung eksklusif dari <strong>{karsSummary.qualityMetrics.totalVerifiedSessions} sesi pasien</strong> berstatus minimal <strong>verified_pj</strong> ({karsSummary.qualityMetrics.verifiedPjCount}) atau <strong>verified_karu</strong> ({karsSummary.qualityMetrics.verifiedKaruCount}) pada Shift {activeShift} ({activeDateFormatted}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubTab('section_a')}
                className="text-xs font-bold text-[#1e4b85] hover:underline flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Sunting Manual Blok A–F</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 text-xs">
              {/* BLOK A & B: Ketenagaan + Sensus Pasien */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                <div className="font-bold text-[#1e4b85] text-xs">
                  Blok A &amp; B · Ketenagaan &amp; Sensus Pasien
                </div>
                <div className="space-y-1.5 text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Total Sensus Terverifikasi</span>
                    <strong className="text-slate-950 font-mono">{manualCensus.totalPasienDilayani} Pasien</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rawat Jalan / Rawat Inap</span>
                    <strong className="text-slate-900 font-mono">
                      {manualCensus.pasienRajal} Rajal · {manualCensus.pasienRanap} Ranap
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Zonasi Infeksius</span>
                    <strong className="text-slate-900 font-mono">
                      Reg {manualCensus.pasienReguler} · HepB {manualCensus.pasienHepB} · HepC {manualCensus.pasienHepC}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Akses Vaskular</span>
                    <strong className="text-slate-900 font-mono">
                      AVF {manualCensus.aksesAvFistula} · AVG {manualCensus.aksesAvGraft} · CDL {manualCensus.aksesCdlNonTunnel + manualCensus.aksesCdlPermcath}
                    </strong>
                  </div>
                </div>
              </div>

              {/* BLOK C: Persentase Indikator Mutu Klinis */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                <div className="font-bold text-[#1e4b85] text-xs">
                  Blok C · Persentase Indikator Mutu Klinis
                </div>
                <div className="space-y-1.5 text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Capaian Target UF (&ge; 90%)</span>
                    <strong className="text-emerald-800 font-mono">
                      {karsSummary.qualityMetrics.ufTargetMetPct}% ({karsSummary.qualityMetrics.ufTargetMetCount}/{karsSummary.qualityMetrics.totalVerifiedSessions})
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Adekuasi Dosis Kt/V (&ge; 1,20)</span>
                    <strong className="text-emerald-800 font-mono">
                      {karsSummary.qualityMetrics.ktvMetPct}% (Rerata {karsSummary.qualityMetrics.avgKtV})
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Kepatuhan Durasi (&ge; 4,0 Jam)</span>
                    <strong className="text-slate-900 font-mono">
                      {karsSummary.qualityMetrics.durationMetPct}% (Rerata {karsSummary.qualityMetrics.avgDurationHours} Jam)
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Bebas Komplikasi Intra-HD</span>
                    <strong className="text-slate-900 font-mono">
                      {karsSummary.qualityMetrics.complicationFreePct}% ({karsSummary.qualityMetrics.complicationCaseCount} Kasus)
                    </strong>
                  </div>
                </div>
              </div>

              {/* BLOK D, E & F: Checklist RO, SBAR & Pengesahan */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5 md:col-span-2 xl:col-span-1">
                <div className="font-bold text-[#1e4b85] text-xs">
                  Blok D, E &amp; F · Checklist RO &amp; Pengesahan
                </div>
                <div className="space-y-1.5 text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Status Air RO ({karsSummary.roChecklist.primaryJamCekRo} WIB)</span>
                    <strong className="text-emerald-800 font-mono">
                      {karsSummary.roChecklist.roMemenuhiSyaratPct}% ({karsSummary.roChecklist.overallRoStatus})
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Disinfeksi Mesin (Heat Clean)</span>
                    <strong className="text-slate-900 font-mono">
                      {karsSummary.roChecklist.disinfeksiCompliancePct}% ({karsSummary.roChecklist.disinfeksiHeatCleanCount}/{karsSummary.roChecklist.totalCheckedSessions})
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Kesiapan Operasional Mesin</span>
                    <strong className="text-slate-900 font-mono">
                      {karsSummary.roChecklist.mesinSiapPakaiPct}% Siap Pakai
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pengesahan Digital (Blok F)</span>
                    <strong className="text-slate-900">
                      {[
                        signatures.pjShift.signed ? 'PJ Shift' : null,
                        signatures.pjBerikutnya.signed ? 'Penerima' : null,
                        signatures.kepalaRuangan.signed ? 'Ka. Ruang' : null
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Menunggu Tanda Tangan'}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Dokumen Resmi KARS Blok A–F (Layar & A4 Print) */}
          <OfficialReportPrintable
            shiftInfo={effectiveShiftInfo}
            census={manualCensus}
            machineOverview={manualMachine}
            clinicalIndicators={manualClinical}
            operationalItems={operationalItems}
            sbar={sbar}
            signatures={signatures}
            onPrint={handlePrint}
            onDownloadPdf={handleDownloadPdf}
            onSign={handleSign}
          />

          {/* FORMAT TEKS SERAH TERIMA SBAR DI BAWAH RANGKUMAN BLOK A–F */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 shadow-xs print:hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-950 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#1e4b85]" />
                  <span>Format Teks Serah Terima Shift SBAR (Standar KARS)</span>
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Format teks terstruktur siap salin untuk buku operan shift / komunikasi tim keperawatan berdasarkan data sesi terverifikasi (<strong>verified_pj</strong> / <strong>verified_karu</strong>).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleRegenerateSbar}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Perbarui Teks SBAR</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySbarText()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                >
                  {copiedSbar ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Teks SBAR Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin Teks SBAR</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <pre className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto tabular-nums">
              {formattedSbarHandoverText}
            </pre>
          </div>
        </div>
      ) : (
        <div className="hidden print:block">
          <OfficialReportPrintable
            shiftInfo={effectiveShiftInfo}
            census={manualCensus}
            machineOverview={manualMachine}
            clinicalIndicators={manualClinical}
            operationalItems={operationalItems}
            sbar={sbar}
            signatures={signatures}
            onPrint={handlePrint}
            onDownloadPdf={handleDownloadPdf}
            onSign={handleSign}
          />
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. SEKSI A: INFORMASI UMUM SHIFT & KETENAGAAN                          */}
      {/* ===================================================================== */}
      {activeSubTab === 'section_a' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6 shadow-xs print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-[11px] font-bold text-[#1e4b85] uppercase tracking-wider">
                BLOK A · INFORMASI UMUM SHIFT &amp; KETENAGAAN
              </div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                <Users className="w-5 h-5 text-[#1e4b85]" />
                Informasi Umum Shift &amp; Ketenagaan Unit HD
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Merangkum hari/tanggal aktif, PJ Shift, Kepala Ruangan HD, jumlah perawat dengan sesi terverifikasi (verified_pj / verified_karu), rasio perawat dan pasien, serta total pasien dilayani.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                handleSaveAllReport();
                setActiveSubTab('section_b');
              }}
              className="px-4 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 self-start cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              Simpan &amp; Lanjut ke Blok B
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 tabular-nums">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3.5">
              <div className="text-xs font-bold text-[#1e4b85] uppercase tracking-wider flex items-center gap-1.5">
                <Stethoscope className="w-4 h-4" />
                Identitas Shift, Pejabat &amp; Dokter
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Hari / Tanggal
                    </label>
                    <span className="text-[10px] text-slate-500">Hari Aktif Otomatis</span>
                  </div>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      readOnly
                      value={activeDateFormatted}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={activeDateIso}
                        onChange={(e) => handleDatePickerChange(e.target.value)}
                        className="text-[11px] px-2 py-1 border border-slate-300 rounded-md bg-white text-slate-700 cursor-pointer"
                      />
                      {activeDateIso !== getCurrentIsoDateWib() && (
                        <button
                          type="button"
                          onClick={() => handleDatePickerChange(getCurrentIsoDateWib())}
                          className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 border border-slate-300 text-[10px] font-bold text-[#1e4b85] cursor-pointer whitespace-nowrap"
                        >
                          Reset Hari Aktif
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Shift Dinas
                    </label>
                    <span className="text-[10px] text-slate-500">Sesuai Logbook</span>
                  </div>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      readOnly
                      value={effectiveShiftInfo.shiftHours}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSwitchShift('Pagi')}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold cursor-pointer border transition-colors whitespace-nowrap ${
                          activeShift === 'Pagi'
                            ? 'bg-[#1e4b85] text-white border-[#1e4b85]'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        Shift Pagi (07.00–14.00)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchShift('Siang')}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold cursor-pointer border transition-colors whitespace-nowrap ${
                          activeShift === 'Siang'
                            ? 'bg-[#1e4b85] text-white border-[#1e4b85]'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        Shift Siang (14.00–21.00)
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Penanggung Jawab (PJ) Shift
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={effectiveShiftInfo.pjShift}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Kepala Ruangan HD
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={effectiveShiftInfo.kepalaRuangan}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Dokter DPJP Unit HD
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={effectiveShiftInfo.dokterDpjp}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Dokter Jaga Ruangan
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={effectiveShiftInfo.dokterJaga}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold text-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3.5">
              <div className="text-xs font-bold text-[#1e4b85] uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                Rekap Ketenagaan, Rasio &amp; Sesi Terverifikasi (Shift {activeShift})
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Jumlah Perawat Terverifikasi
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={verifiedNurseCountLabel}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-extrabold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Rasio Perawat dan Pasien
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={karsSummary.rasioPerawatPasien}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-extrabold text-emerald-800"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Total Sesi Pasien Terverifikasi (verified_pj / verified_karu)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={`${karsSummary.qualityMetrics.totalVerifiedSessions} Pasien Terverifikasi (${karsSummary.qualityMetrics.verifiedPjCount} Verified PJ · ${karsSummary.qualityMetrics.verifiedKaruCount} Verified Ka. Ruang)`}
                    className="w-full p-2 border border-blue-300 rounded-lg bg-blue-50/50 font-extrabold text-blue-950"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Tenaga Pendukung Dinas (RO / Elektromedis / HK / Admin)
                  </label>
                  <input
                    type="text"
                    value={shiftInfo.tenagaPendukung}
                    onChange={(e) => setShiftInfo({ ...shiftInfo, tenagaPendukung: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                    placeholder="1 Teknisi Elektromedis/RO, 1 HK Ruangan, 1 Administrasi"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-700">
                    Daftar Perawat pada Sesi Terverifikasi ({karsSummary.participatingNurses.length} Perawat)
                  </span>
                  <span className="text-slate-500">verified_pj · verified_karu</span>
                </div>
                {karsSummary.participatingNurses.length === 0 ? (
                  <div className="p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-500">
                    Belum ada sesi pasien berstatus verified_pj atau verified_karu pada Shift {activeShift} ({activeDateFormatted}).
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                    {karsSummary.participatingNurses.map((nurse, idx) => (
                      <div
                        key={`${nurse.name}-${idx}`}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px]"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="font-bold text-slate-900 block truncate">
                            {idx + 1}. {nurse.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            PJ: {nurse.verifiedPjCount} · Ka. Ruang: {nurse.verifiedKaruCount}
                          </span>
                        </div>
                        <span className="font-bold text-[#1e4b85] shrink-0">
                          {nurse.patientCount} Pasien
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. SEKSI B: SENSUS PASIEN, AKSES VASKULAR & UTILISASI MESIN HD         */}
      {/* ===================================================================== */}
      {activeSubTab === 'section_b' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6 shadow-xs print:hidden tabular-nums">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-[11px] font-bold text-[#1e4b85] uppercase tracking-wider">
                BLOK B · SENSUS PASIEN &amp; UTILISASI MESIN HD
              </div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                <Activity className="w-5 h-5 text-[#1e4b85]" />
                Sensus Pasien, Akses Vaskular &amp; Utilisasi Mesin Hemodialisis
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Otomatis terisi dari sesi pasien berstatus minimal verified_pj / verified_karu, serta dapat disesuaikan manual bila diperlukan.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <button
                type="button"
                onClick={() => void handlePullBaselineFromSessions()}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                Sinkron Sensus Terverifikasi
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveAllReport();
                  setActiveSubTab('section_c');
                }}
                className="px-4 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                Simpan &amp; Lanjut ke Blok C
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#1e4b85] uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    Sensus &amp; Klasifikasi Pasien Shift
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    verified_pj · verified_karu
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <div>
                      <span className="font-semibold text-slate-800 block">Pasien Terjadwal (Target Shift)</span>
                      <span className="text-[10px] text-slate-400">Target pasien terjadwal {activeDay} {activeShift}</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienTerjadwal}
                      onChange={(e) => handleCensusChange('pasienTerjadwal', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <div>
                      <span className="font-semibold text-blue-900 block">Pasien Hadir &amp; Selesai HD</span>
                      <span className="text-[10px] text-slate-400">Jumlah sesi terverifikasi tuntas menjalani HD</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienHadirSelesai}
                      onChange={(e) => handleCensusChange('pasienHadirSelesai', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-extrabold text-sm p-1.5 border border-blue-300 rounded-lg bg-blue-50/40 text-blue-950 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <div>
                      <span className="font-semibold text-rose-800 block">Pasien HD Cito / Emergency (ICU/IGD)</span>
                      <span className="text-[10px] text-slate-400">Pasien tidak terjadwal rujukan gawat darurat</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienCitoEmergency}
                      onChange={(e) => handleCensusChange('pasienCitoEmergency', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-rose-300 rounded-lg bg-rose-50/40 text-rose-950 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <div>
                      <span className="font-semibold text-slate-700 block">Pasien Batal / Tunda (Reschedule)</span>
                      <span className="text-[10px] text-slate-400">Pasien berhalangan / kondisi hemodinamik tidak stabil</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienBatalTunda}
                      onChange={(e) => handleCensusChange('pasienBatalTunda', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-800">Kategori: Pasien Reguler (Non-Hepatitis)</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienReguler}
                      onChange={(e) => handleCensusChange('pasienReguler', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-amber-800">Kategori: Pasien Isolasi Hepatitis B</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienHepB}
                      onChange={(e) => handleCensusChange('pasienHepB', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-amber-300 rounded-lg bg-amber-50/40 text-amber-900 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-amber-800">Kategori: Pasien Isolasi Hepatitis C / HIV</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.pasienHepC}
                      onChange={(e) => handleCensusChange('pasienHepC', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-amber-300 rounded-lg bg-amber-50/40 text-amber-900 focus:bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <span className="font-semibold text-slate-800 block text-[11px]">Pasien Rawat Jalan (Rajal)</span>
                      <input
                        type="number"
                        min={0}
                        value={manualCensus.pasienRajal}
                        onChange={(e) => handleCensusChange('pasienRajal', parseInt(e.target.value, 10))}
                        className="w-full text-center font-bold text-sm p-1 mt-1 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                      />
                    </div>
                    <div className="p-2 rounded-lg bg-white border border-slate-200">
                      <span className="font-semibold text-slate-800 block text-[11px]">Pasien Rawat Inap (Ranap)</span>
                      <input
                        type="number"
                        min={0}
                        value={manualCensus.pasienRanap}
                        onChange={(e) => handleCensusChange('pasienRanap', parseInt(e.target.value, 10))}
                        className="w-full text-center font-bold text-sm p-1 mt-1 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50 border border-blue-200">
                    <div>
                      <span className="font-bold text-blue-950 block">Total Pasien Dilayani Shift Ini</span>
                      <span className="text-[10px] text-blue-700">Dihitung dari sesi terverifikasi shift ini</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.totalPasienDilayani}
                      onChange={(e) => handleCensusChange('totalPasienDilayani', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-black text-base p-1 border border-blue-400 rounded-lg bg-white text-blue-950"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#1e4b85] uppercase tracking-wider flex items-center gap-1.5">
                    <Cpu className="w-4 h-4" />
                    Kapasitas &amp; Utilisasi Mesin HD
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-800">
                    {manualMachine.beroperasiSiapPakai} Beroperasi
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-800">Total Kapasitas Mesin HD</span>
                    <input
                      type="number"
                      min={0}
                      value={manualMachine.totalCapacity}
                      onChange={(e) => handleMachineChange('totalCapacity', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-emerald-800">Mesin Beroperasi Siap Pakai</span>
                    <input
                      type="number"
                      min={0}
                      value={manualMachine.beroperasiSiapPakai}
                      onChange={(e) => handleMachineChange('beroperasiSiapPakai', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-emerald-300 rounded-lg bg-emerald-50/40 text-emerald-950 focus:bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-600">Mesin Maintenance / Perbaikan</span>
                    <input
                      type="number"
                      min={0}
                      value={manualMachine.maintenance}
                      onChange={(e) => handleMachineChange('maintenance', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-amber-800">Mesin Khusus Hepatitis B (Isolasi)</span>
                    <input
                      type="number"
                      min={0}
                      value={manualMachine.khususHepB}
                      onChange={(e) => handleMachineChange('khususHepB', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-amber-300 rounded-lg bg-amber-50/40 text-amber-950 focus:bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-amber-800">Mesin Khusus Hepatitis C</span>
                    <input
                      type="number"
                      min={0}
                      value={manualMachine.khususHepC}
                      onChange={(e) => handleMachineChange('khususHepC', parseInt(e.target.value, 10))}
                      className="w-20 text-center font-bold text-sm p-1.5 border border-amber-300 rounded-lg bg-amber-50/40 text-amber-900 focus:bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div className="text-xs font-bold text-[#1e4b85] uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  Distribusi Akses Vaskular Pasien Shift
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-800 block text-[11px]">AV Fistula (Cimino)</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.aksesAvFistula}
                      onChange={(e) => handleCensusChange('aksesAvFistula', parseInt(e.target.value, 10))}
                      className="w-full text-center font-bold text-sm p-1 mt-1 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-800 block text-[11px]">AV Graft</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.aksesAvGraft}
                      onChange={(e) => handleCensusChange('aksesAvGraft', parseInt(e.target.value, 10))}
                      className="w-full text-center font-bold text-sm p-1 mt-1 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-800 block text-[11px]">CDL Non-Tunnel / Femoral</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.aksesCdlNonTunnel}
                      onChange={(e) => handleCensusChange('aksesCdlNonTunnel', parseInt(e.target.value, 10))}
                      className="w-full text-center font-bold text-sm p-1 mt-1 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="font-semibold text-slate-800 block text-[11px]">CDL Tunnel (Permcath)</span>
                    <input
                      type="number"
                      min={0}
                      value={manualCensus.aksesCdlPermcath}
                      onChange={(e) => handleCensusChange('aksesCdlPermcath', parseInt(e.target.value, 10))}
                      className="w-full text-center font-bold text-sm p-1 mt-1 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4. SEKSI C: PERSENTASE INDIKATOR MUTU KLINIS SHIFT                     */}
      {/* ===================================================================== */}
      {activeSubTab === 'section_c' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6 shadow-xs print:hidden tabular-nums">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-[11px] font-bold text-[#1e4b85] uppercase tracking-wider">
                BLOK C · INDIKATOR MUTU KLINIS AKREDITASI KARS
              </div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                <Stethoscope className="w-5 h-5 text-[#1e4b85]" />
                Persentase Indikator Mutu Klinis &amp; Pelayanan Medis Shift
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Persentase capaian UF, adekuasi Kt/V, durasi dialisis, sesi bebas komplikasi, dan dokumentasi advis DPJP dari sesi pasien terverifikasi.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <button
                type="button"
                onClick={handleResetClinicalToStandard}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
                Hitung Ulang dari Sesi Terverifikasi
              </button>
              <button
                type="button"
                onClick={handleAddClinicalIndicator}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-bold rounded-xl border border-blue-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4 text-blue-700" />
                Tambah Indikator
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveAllReport();
                  setActiveSubTab('section_d');
                }}
                className="px-4 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                Simpan &amp; Lanjut ke Blok D
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-[#1e4b85]/10 text-slate-900 font-bold">
                  <th className="p-2.5 border border-slate-200 w-1/4">Indikator Mutu Klinis KARS</th>
                  <th className="p-2.5 border border-slate-200 w-1/6 text-center">Capaian (%)</th>
                  <th className="p-2.5 border border-slate-200 w-1/6 text-center">Standar Target</th>
                  <th className="p-2.5 border border-slate-200">Analisis &amp; Rencana Tindak Lanjut</th>
                  <th className="p-2.5 border border-slate-200 w-12 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {manualClinical.map((item, idx) => (
                  <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                    <td className="p-2 border border-slate-200">
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => handleClinicalChange(item.id, 'label', e.target.value)}
                        className="w-full p-1.5 text-xs font-semibold text-slate-900 border border-slate-300 rounded bg-white"
                      />
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      <input
                        type="text"
                        value={item.capaian}
                        onChange={(e) => handleClinicalChange(item.id, 'capaian', e.target.value)}
                        className="w-full p-1.5 text-xs font-bold text-center text-blue-900 border border-slate-300 rounded bg-white font-mono"
                      />
                    </td>
                    <td className="p-2 border border-slate-200 text-center">
                      <input
                        type="text"
                        value={item.standar}
                        onChange={(e) => handleClinicalChange(item.id, 'standar', e.target.value)}
                        className="w-full p-1.5 text-xs text-center text-slate-700 border border-slate-300 rounded bg-white font-mono"
                      />
                    </td>
                    <td className="p-2 border border-slate-200">
                      <textarea
                        rows={2}
                        value={item.analisis}
                        onChange={(e) => handleClinicalChange(item.id, 'analisis', e.target.value)}
                        className="w-full p-1.5 text-xs text-slate-800 border border-slate-300 rounded bg-white resize-y"
                      />
                    </td>
                    <td className="p-2 border border-slate-200 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => handleDeleteClinicalIndicator(item.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer rounded"
                        title="Hapus baris indikator"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. SEKSI D: CHECKLIST WATER TREATMENT RO & OPERASIONAL                 */}
      {/* ===================================================================== */}
      {activeSubTab === 'section_d' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6 shadow-xs print:hidden tabular-nums">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-[11px] font-bold text-[#1e4b85] uppercase tracking-wider">
                BLOK D · CHECKLIST WATER TREATMENT RO, DISINFEKSI &amp; PPI
              </div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                <CheckSquare className="w-5 h-5 text-[#1e4b85]" />
                Checklist Mutu Air Reverse Osmosis (RO), Disinfeksi Mesin &amp; K3
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Dihitung otomatis dari pemeriksaan jam cek RO ({karsSummary.roChecklist.primaryJamCekRo} WIB) dan disinfeksi Heat Clean pada sesi pasien terverifikasi.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <button
                type="button"
                onClick={handleResetOperationalToStandard}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
                Sinkron Checklist RO
              </button>
              <button
                type="button"
                onClick={handleAddOperationalItem}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-bold rounded-xl border border-blue-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4 text-blue-700" />
                Tambah Item
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveAllReport();
                  setActiveSubTab('section_e');
                }}
                className="px-4 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                Simpan &amp; Lanjut ke Blok E
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {operationalItems.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2 flex-1">
                    <Droplets className="w-4 h-4 text-blue-600 shrink-0" />
                    <input
                      type="text"
                      value={item.item}
                      onChange={(e) => handleOperationalChange(item.id, 'item', e.target.value)}
                      className="font-bold text-xs text-slate-900 p-1 border border-slate-300 rounded bg-white w-full max-w-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 font-medium">Status Kepatuhan:</span>
                    <input
                      type="text"
                      value={item.statusKepatuhan}
                      onChange={(e) => handleOperationalChange(item.id, 'statusKepatuhan', e.target.value)}
                      className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-emerald-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteOperationalItem(item.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer rounded ml-1"
                      title="Hapus baris item operasional"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Parameter Uji / Standar Pengawasan
                    </label>
                    <input
                      type="text"
                      value={item.parameterUji}
                      onChange={(e) => handleOperationalChange(item.id, 'parameterUji', e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Hasil Observasi Fisik &amp; Uji Shift
                    </label>
                    <input
                      type="text"
                      value={item.hasilObservasi}
                      onChange={(e) => handleOperationalChange(item.id, 'hasilObservasi', e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-900"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 6. SEKSI E: SERAH TERIMA SHIFT MODEL SBAR                              */}
      {/* ===================================================================== */}
      {activeSubTab === 'section_e' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6 shadow-xs print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-[11px] font-bold text-[#1e4b85] uppercase tracking-wider">
                BLOK E · KOMUNIKASI EFEKTIF SERAH TERIMA SBAR
              </div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                Serah Terima Shift Model SBAR (Situation, Background, Assessment, Recommendation)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Standar handover klinis KARS berdasarkan data sesi pasien berstatus minimal verified_pj / verified_karu.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <button
                type="button"
                onClick={handleRegenerateSbar}
                className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold rounded-xl shadow-2xs flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Draf dari Sesi Terverifikasi
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSaveAllReport();
                  setActiveSubTab('section_f');
                }}
                className="px-4 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                Simpan &amp; Lanjut ke Blok F
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1e4b85] uppercase tracking-wide">
                  1. SITUATION (S) - Situasi Shift
                </label>
                <span className="text-[11px] text-slate-400">Sensus terverifikasi &amp; kepemimpinan shift</span>
              </div>
              <textarea
                rows={3}
                value={sbar.situation}
                onChange={(e) => {
                  setManualOverrideScope((prev) => ({ ...prev, sbarScope: shiftScopeKey }));
                  setSbar({ ...sbar, situation: e.target.value });
                }}
                className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white leading-relaxed"
              />
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1e4b85] uppercase tracking-wide">
                  2. BACKGROUND (B) - Riwayat Kasus Pasien Berisiko
                </label>
                <span className="text-[11px] text-slate-400">Distribusi akses vaskular &amp; kasus komplikasi</span>
              </div>
              <textarea
                rows={3}
                value={sbar.background}
                onChange={(e) => {
                  setManualOverrideScope((prev) => ({ ...prev, sbarScope: shiftScopeKey }));
                  setSbar({ ...sbar, background: e.target.value });
                }}
                className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white leading-relaxed"
              />
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1e4b85] uppercase tracking-wide">
                  3. ASSESSMENT (A) - Penilaian Indikator Mutu &amp; RO
                </label>
                <span className="text-[11px] text-slate-400">Persentase capaian UF, Kt/V, durasi, dan mutu RO</span>
              </div>
              <textarea
                rows={3}
                value={sbar.assessment}
                onChange={(e) => {
                  setManualOverrideScope((prev) => ({ ...prev, sbarScope: shiftScopeKey }));
                  setSbar({ ...sbar, assessment: e.target.value });
                }}
                className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white leading-relaxed"
              />
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1e4b85] uppercase tracking-wide">
                  4. RECOMMENDATION (R) - Rekomendasi Shift Berikutnya
                </label>
                <span className="text-[11px] text-slate-400">Rencana tindak lanjut tim shift selanjutnya</span>
              </div>
              <textarea
                rows={4}
                value={sbar.recommendation}
                onChange={(e) => {
                  setManualOverrideScope((prev) => ({ ...prev, sbarScope: shiftScopeKey }));
                  setSbar({ ...sbar, recommendation: e.target.value });
                }}
                className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-white leading-relaxed"
              />
            </div>

            {/* Pratinjau Format Teks Serah Terima SBAR */}
            <div className="pt-4 border-t border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Format Teks Serah Terima SBAR (Siap Salin):
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopySbarText()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  {copiedSbar ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSbar ? 'Tersalin' : 'Salin Teks SBAR'}</span>
                </button>
              </div>
              <pre className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto tabular-nums">
                {formattedSbarHandoverText}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 7. SEKSI F: PENGESAHAN & PERTANGGUNGJAWABAN SHIFT                      */}
      {/* ===================================================================== */}
      {activeSubTab === 'section_f' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6 shadow-xs print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="text-[11px] font-bold text-[#1e4b85] uppercase tracking-wider">
                BLOK F · PENGESAHAN &amp; TANDA TANGAN DIGITAL
              </div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mt-0.5">
                <ClipboardCheck className="w-5 h-5 text-[#1e4b85]" />
                Pengesahan &amp; Pertanggungjawaban Shift (3 Pihak)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Pembubuhan tanda tangan digital resmi PJ Shift, Penerima Shift Berikutnya, dan Kepala Ruangan HD.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                handleSaveAllReport();
                setActiveSubTab('preview_full');
              }}
              className="px-4 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 self-start cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              Simpan &amp; Lihat Rangkuman KARS
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 flex flex-col justify-between shadow-2xs space-y-4">
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase">1. Yang Menyerahkan</div>
                <div className="font-bold text-[#1e4b85] mt-1 text-sm flex items-center justify-between">
                  <span>{activeShift === 'Pagi' ? 'PJ SHIFT PAGI' : 'PJ SHIFT SIANG'}</span>
                  {shiftSummary.pjShiftIsFromMatrix && (
                    <span className="text-[10px] text-emerald-800 font-semibold">
                      ✓ Dari Jadwal
                    </span>
                  )}
                </div>
                <label className="block text-[11px] font-semibold text-slate-600 mt-2 mb-1">
                  Nama {activeShift === 'Pagi' ? 'PJ Shift Pagi' : 'PJ Shift Siang'}:
                </label>
                <input
                  type="text"
                  readOnly
                  value={effectiveShiftInfo.pjShift}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white font-semibold text-slate-900"
                />
              </div>

              <div className="pt-3 border-t border-slate-200">
                <div className="text-[11px] text-slate-500 mb-2 font-medium">Status Pengesahan Digital:</div>
                {signatures.pjShift.signed ? (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                    <span className="text-emerald-800 font-bold flex items-center gap-1.5 text-xs">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      TERVERIFIKASI DIGITAL
                    </span>
                    <div className="text-[10px] text-slate-600 font-medium">
                      Otentikasi: {signatures.pjShift.signedAt}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResetSignature('pjShift')}
                      className="text-[10px] text-rose-600 hover:underline block pt-1 cursor-pointer font-semibold"
                    >
                      Reset Tanda Tangan
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSign('pjShift')}
                    className="w-full px-3 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-xs"
                  >
                    Tanda Tangani Sebagai {activeShift === 'Pagi' ? 'PJ Shift Pagi' : 'PJ Shift Siang'}
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 flex flex-col justify-between shadow-2xs space-y-4">
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase">
                  {activeShift === 'Pagi' ? '2. Yang Menerima' : '2. Menerima'}
                </div>
                <div className="font-bold text-[#1e4b85] mt-1 text-sm flex items-center justify-between">
                  <span>{activeShift === 'Pagi' ? 'PJ SHIFT SIANG' : 'Perawat On-Call / Shift Berikutnya'}</span>
                  {shiftSummary.pjShiftBerikutnyaIsFromMatrix && (
                    <span className="text-[10px] text-emerald-800 font-semibold">
                      ✓ Dari Jadwal
                    </span>
                  )}
                </div>
                <label className="block text-[11px] font-semibold text-slate-600 mt-2 mb-1">
                  Nama {activeShift === 'Pagi' ? 'PJ Shift Siang (Penerima Shift)' : 'Penerima Shift / On-Call'}:
                </label>
                <input
                  type="text"
                  value={effectiveShiftInfo.pjShiftBerikutnya}
                  onChange={(e) => setShiftInfo({ ...shiftInfo, pjShiftBerikutnya: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white font-medium text-slate-900"
                  placeholder={activeShift === 'Pagi' ? 'Nama PJ Shift Siang' : 'Nama Perawat On-Call / Penerima'}
                />
              </div>

              <div className="pt-3 border-t border-slate-200">
                <div className="text-[11px] text-slate-500 mb-2 font-medium">Status Pengesahan Digital:</div>
                {signatures.pjBerikutnya.signed ? (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                    <span className="text-emerald-800 font-bold flex items-center gap-1.5 text-xs">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      TERVERIFIKASI DIGITAL
                    </span>
                    <div className="text-[10px] text-slate-600 font-medium">
                      Otentikasi: {signatures.pjBerikutnya.signedAt}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResetSignature('pjBerikutnya')}
                      className="text-[10px] text-rose-600 hover:underline block pt-1 cursor-pointer font-semibold"
                    >
                      Reset Tanda Tangan
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSign('pjBerikutnya')}
                    className="w-full px-3 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-xs"
                  >
                    Tanda Tangani Sebagai {activeShift === 'Pagi' ? 'PJ Shift Siang' : 'Penerima / On-Call'}
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 flex flex-col justify-between shadow-2xs space-y-4">
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase">3. Mengetahui &amp; Menyetujui</div>
                <div className="font-bold text-slate-900 mt-1 text-sm">Kepala Ruang</div>
                <label className="block text-[11px] font-semibold text-slate-600 mt-2 mb-1">
                  Nama Kepala Ruang:
                </label>
                <input
                  type="text"
                  readOnly
                  value={effectiveShiftInfo.kepalaRuangan}
                  className="w-full p-2 border border-slate-300 rounded-lg bg-white font-semibold text-slate-900"
                />
              </div>

              <div className="pt-3 border-t border-slate-200">
                <div className="text-[11px] text-slate-500 mb-2 font-medium">Status Pengesahan Digital:</div>
                {signatures.kepalaRuangan.signed ? (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                    <span className="text-emerald-800 font-bold flex items-center gap-1.5 text-xs">
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      TERVERIFIKASI DIGITAL
                    </span>
                    <div className="text-[10px] text-slate-600 font-medium">
                      Otentikasi: {signatures.kepalaRuangan.signedAt}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResetSignature('kepalaRuangan')}
                      className="text-[10px] text-rose-600 hover:underline block pt-1 cursor-pointer font-semibold"
                    >
                      Reset Tanda Tangan
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSign('kepalaRuangan')}
                    className="w-full px-3 py-2 bg-[#1e4b85] hover:bg-[#163865] text-white rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-xs"
                  >
                    Tanda Tangani Sebagai Kepala Ruang
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
