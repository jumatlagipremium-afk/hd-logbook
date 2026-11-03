import {
  AggregatedCensus,
  ClinicalIndicatorItem,
  DoctorScheduleEntry,
  HdTreatmentDay,
  MasterNurse,
  MasterPatient,
  NurseScheduleEntry,
  PatientHDSession,
  SbarData,
  ShiftInfo,
  SystemAccessRole
} from '../types/dialysis.ts';
import {
  computeCensusAndAccess,
  computeClinicalIndicators,
  generateAutoSbar
} from './hdCalculator.ts';
import {
  extractActiveDayName,
  formatIsoDateToIndonesianFull,
  getCurrentIndonesianFullDate,
  indonesianDateLabelToIso,
  normalizeIndonesianDateLabel
} from './dateHelpers.ts';
import {
  filterMasterPatientsForActiveSchedule,
  resolveNurseSystemAccess
} from './masterDataHelpers.ts';
import {
  PER_PATIENT_STATUS_STORAGE_KEY,
  LogbookVerificationRegistryEntry,
  buildPatientVerificationKey,
  convertLogbookRecordToRegistryEntry,
  getNurseStorageKey,
  isMatchingNurse,
  isSameBed,
  readShiftLogbookDoctorsFromStorage
} from './nurseVerificationHelpers.ts';
import { ensureFullBagianData } from './logbookStandards.ts';
import {
  resolvePjShiftEntryFromMatrix,
  resolveScheduledDoctorsFromMatrix,
  resolveScheduledNursesFromMatrix
} from './monthlyScheduleMatrixHelpers.ts';
import { logbookService } from '../data/officialPelaksanaLogbookData.ts';
import type { NurseLogbookCloudData } from '../services/firebase.ts';

export const DEFAULT_KEPALA_RUANGAN_NAME = 'TWIS FERTILIANTI PW';

export interface ParticipatingShiftNurse {
  canonicalKey: string;
  name: string;
  role: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan';
  patientCount: number;
}

export interface ShiftDailyReportSummary {
  activeDateIso: string;
  activeDateFormatted: string;
  activeDay: HdTreatmentDay;
  activeShift: 'Pagi' | 'Siang';
  shiftHours: string;
  pjShiftName: string;
  pjShiftBerikutnyaName: string;
  pjShiftIsFromMatrix?: boolean;
  pjShiftBerikutnyaIsFromMatrix?: boolean;
  kepalaRuanganName: string;
  dokterDpjpName: string;
  dokterJagaName: string;
  jumlahPerawatDinas: number;
  jumlahPerawatDinasLabel: string;
  participatingNurses: ParticipatingShiftNurse[];
  totalPasienDilayani: number;
  totalPasienDilayaniLabel: string;
  rasioPerawatPasien: string;
  pendingSubmissionsCount: number;
  verifiedSessions: PatientHDSession[];
  census: AggregatedCensus;
  clinicalIndicators: ClinicalIndicatorItem[];
  autoSbar: SbarData;
}

export function formatShiftHoursForShift(shift: 'Pagi' | 'Siang'): string {
  return shift === 'Siang'
    ? 'Siang, jam 14.00 - 21.00 WIB'
    : 'Pagi, jam 07.00 - 14.00 WIB';
}

export function normalizeShiftChoice(rawShift?: string | null): 'Pagi' | 'Siang' {
  if (!rawShift) return 'Pagi';
  return rawShift.trim().toLowerCase().includes('siang') ? 'Siang' : 'Pagi';
}

/**
 * Calculates nurse-to-patient ratio for the active shift & date based on
 * the number of nurses who inputted verified logbooks and total patients served.
 */
export function calculateNursePatientRatio(
  nurseCount: number,
  patientCount: number
): string {
  const safeNurses = Math.max(0, Math.floor(nurseCount));
  const safePatients = Math.max(0, Math.floor(patientCount));

  if (safeNurses === 0 && safePatients === 0) {
    return '0 : 0';
  }
  if (safeNurses > 0 && safePatients === 0) {
    return `${safeNurses} : 0`;
  }
  if (safeNurses === 0 && safePatients > 0) {
    return `0 : ${safePatients}`;
  }

  const perNurse = safePatients / safeNurses;
  const formattedPerNurse = Number.isInteger(perNurse)
    ? String(perNurse)
    : perNurse.toFixed(1).replace(/\.0$/, '');

  return `1 : ${formattedPerNurse} (${safeNurses} Perawat : ${safePatients} Pasien)`;
}

function resolveSessionIsoDate(session: Pick<PatientHDSession, 'sessionDate' | 'date'>): string {
  if (session.sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(session.sessionDate.trim())) {
    return session.sessionDate.trim();
  }
  if (session.date) {
    return indonesianDateLabelToIso(session.date);
  }
  return '';
}

function resolveRegistryEntryIsoDate(
  entry: Pick<LogbookVerificationRegistryEntry, 'dateKey' | 'dateLabel'>
): string {
  if (entry.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(entry.dateKey.trim())) {
    return entry.dateKey.trim();
  }
  if (entry.dateLabel) {
    return indonesianDateLabelToIso(entry.dateLabel);
  }
  return '';
}

function isPerPatientRecordVerifiedInStorage(
  nurseName: string,
  bedNumber: string,
  medicalRecordNumber: string | undefined,
  dateIso: string
): boolean | null {
  if (typeof window === 'undefined' || !window.localStorage || !nurseName) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PER_PATIENT_STATUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const exactDateKey = buildPatientVerificationKey(
      nurseName,
      bedNumber,
      medicalRecordNumber,
      dateIso
    );
    const exactKey = buildPatientVerificationKey(nurseName, bedNumber, medicalRecordNumber);
    const fallbackNoRmKey = buildPatientVerificationKey(nurseName, bedNumber, '0');

    const record = parsed[exactDateKey] || parsed[exactKey] || parsed[fallbackNoRmKey];
    if (record && record.status) {
      return record.status === 'terverifikasi';
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function isSessionVerifiedForShiftAndDate(
  session: PatientHDSession,
  targetDateIso: string,
  targetShift: 'Pagi' | 'Siang',
  verifiedRegistryEntries: LogbookVerificationRegistryEntry[]
): boolean {
  if (
    session.isVerifiedByPj === true ||
    session.isVerifiedByKepalaRuang === true ||
    session.verificationStatus === 'terverifikasi'
  ) {
    return true;
  }

  if (session.nurseInCharge) {
    const perPatVerified = isPerPatientRecordVerifiedInStorage(
      session.nurseInCharge,
      session.bedNumber,
      session.medicalRecordNumber,
      targetDateIso
    );
    if (perPatVerified !== null) {
      return perPatVerified;
    }
  }

  // Check if the managing nurse has a verified registry submission on this exact date & shift
  if (session.nurseInCharge) {
    const matchingVerifiedEntry = verifiedRegistryEntries.find((entry) => {
      if (!isMatchingNurse(entry.submittedNurseName, session.nurseInCharge)) {
        return false;
      }
      const entryIso = resolveRegistryEntryIsoDate(entry);
      const entryShift = normalizeShiftChoice(entry.shift);
      const dateMatches = !entryIso || entryIso === targetDateIso;
      return dateMatches && entryShift === targetShift;
    });
    if (matchingVerifiedEntry) {
      return true;
    }
  }

  return false;
}

function mergeRegistryWithLogbookServiceForDate(
  registryEntries: LogbookVerificationRegistryEntry[],
  targetDateIso: string
): LogbookVerificationRegistryEntry[] {
  const verifiedFromService = logbookService.getCachedVerifiedReports({ tanggal: targetDateIso });
  const pendingPj = logbookService
    .getCachedPendingVerifications('PJ Shift')
    .filter((r) => r.tanggal === targetDateIso);
  const pendingKaruDirect = logbookService
    .getCachedPendingVerifications('Kepala Ruang')
    .filter((r) => r.tanggal === targetDateIso && r.statusVerifikasi === 'submitted');

  const serviceRecords = [...verifiedFromService, ...pendingPj, ...pendingKaruDirect];
  if (serviceRecords.length === 0) {
    return registryEntries;
  }

  const merged = [...registryEntries];
  serviceRecords.forEach((rec) => {
    const mapped = convertLogbookRecordToRegistryEntry(rec);
    const existingIdx = merged.findIndex((e) => {
      if (mapped.id && e.id === mapped.id) return true;
      const eIso = resolveRegistryEntryIsoDate(e);
      if (eIso && mapped.dateKey && eIso !== mapped.dateKey) return false;
      if (normalizeShiftChoice(e.shift) !== normalizeShiftChoice(mapped.shift)) return false;
      return isMatchingNurse(e.submittedNurseName, mapped.submittedNurseName);
    });

    if (existingIdx >= 0) {
      const prev = merged[existingIdx];
      merged[existingIdx] = {
        ...prev,
        ...mapped,
        status:
          mapped.status === 'terverifikasi' || prev.status === 'terverifikasi'
            ? 'terverifikasi'
            : mapped.status,
        patients:
          mapped.patients && mapped.patients.length > 0 ? mapped.patients : prev.patients
      };
    } else {
      merged.push(mapped);
    }
  });

  return merged;
}

/**
 * Detects the active logbook shift ('Pagi' | 'Siang') for a given date so
 * Laporan Harian automatically aligns with the shift chosen during logbook input.
 */
export function detectActiveLogbookShiftForDate(params: {
  activeDateLabel: string;
  sessions: PatientHDSession[];
  registryEntries: LogbookVerificationRegistryEntry[];
  lastSelectedLogbookShift?: string | null;
  loggedInUserShift?: string | null;
}): 'Pagi' | 'Siang' | null {
  const {
    activeDateLabel,
    sessions,
    registryEntries,
    lastSelectedLogbookShift,
    loggedInUserShift
  } = params;

  const targetDateIso = indonesianDateLabelToIso(activeDateLabel);
  const combinedRegistryEntries = mergeRegistryWithLogbookServiceForDate(
    registryEntries,
    targetDateIso
  );

  // 1. Check verified registry entries on this date (most recent first)
  const dateRegistryEntries = combinedRegistryEntries.filter((e) => {
    const eIso = resolveRegistryEntryIsoDate(e);
    return eIso === targetDateIso && (e.shift === 'Pagi' || e.shift === 'Siang');
  });

  const verifiedDateRegistry = dateRegistryEntries.filter((e) => e.status === 'terverifikasi');
  const hasVerifiedPagiReg = verifiedDateRegistry.some((e) => e.shift === 'Pagi');
  const hasVerifiedSiangReg = verifiedDateRegistry.some((e) => e.shift === 'Siang');

  // 2. Check verified sessions on this date
  const verifiedDateSessions = sessions.filter((s) => {
    const sIso = resolveSessionIsoDate(s);
    if (sIso !== targetDateIso) return false;
    const sShift = normalizeShiftChoice(s.shift);
    return isSessionVerifiedForShiftAndDate(s, targetDateIso, sShift, verifiedDateRegistry);
  });

  const hasVerifiedPagiSess = verifiedDateSessions.some(
    (s) => normalizeShiftChoice(s.shift) === 'Pagi'
  );
  const hasVerifiedSiangSess = verifiedDateSessions.some(
    (s) => normalizeShiftChoice(s.shift) === 'Siang'
  );

  const anyVerifiedPagi = hasVerifiedPagiReg || hasVerifiedPagiSess;
  const anyVerifiedSiang = hasVerifiedSiangReg || hasVerifiedSiangSess;

  // If only one shift has verified logbooks on this date, immediately pick that shift
  if (anyVerifiedSiang && !anyVerifiedPagi) return 'Siang';
  if (anyVerifiedPagi && !anyVerifiedSiang) return 'Pagi';

  // 3. Explicit last selected shift during logbook entry
  if (lastSelectedLogbookShift === 'Pagi' || lastSelectedLogbookShift === 'Siang') {
    return lastSelectedLogbookShift;
  }

  // 4. Most recent registry submission on this date
  if (dateRegistryEntries.length > 0) {
    const firstValid = dateRegistryEntries.find(
      (e) => e.shift === 'Pagi' || e.shift === 'Siang'
    );
    if (firstValid?.shift === 'Pagi' || firstValid?.shift === 'Siang') {
      return firstValid.shift;
    }
  }

  // 5. Any session on this date
  const dateSession = sessions.find(
    (s) =>
      resolveSessionIsoDate(s) === targetDateIso &&
      (s.shift === 'Pagi' || s.shift === 'Siang')
  );
  if (dateSession?.shift === 'Pagi' || dateSession?.shift === 'Siang') {
    return dateSession.shift;
  }

  // 6. Fallback to logged-in user's shift
  if (loggedInUserShift === 'Pagi' || loggedInUserShift === 'Siang') {
    return loggedInUserShift;
  }

  return null;
}

function resolveCanonicalNurseIdentity(
  rawNurseName: string,
  fallbackRole: SystemAccessRole | undefined,
  masterNurses: MasterNurse[]
): {
  canonicalKey: string;
  name: string;
  role: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan';
} {
  const matchedMaster = masterNurses.find((n) => isMatchingNurse(n.name, rawNurseName));
  if (matchedMaster) {
    const sysRole = resolveNurseSystemAccess(matchedMaster);
    const normalizedRole: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan' =
      sysRole === 'kepala_ruangan' || matchedMaster.role === 'kepala_ruangan'
        ? 'kepala_ruangan'
        : sysRole === 'pj_shift' || matchedMaster.role === 'pj_shift'
        ? 'pj_shift'
        : 'perawat_pelaksana';

    return {
      canonicalKey: matchedMaster.id || getNurseStorageKey(matchedMaster.name),
      name: matchedMaster.name,
      role: normalizedRole
    };
  }

  const normalizedFallback: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan' =
    fallbackRole === 'kepala_ruangan'
      ? 'kepala_ruangan'
      : fallbackRole === 'pj_shift'
      ? 'pj_shift'
      : 'perawat_pelaksana';

  return {
    canonicalKey: getNurseStorageKey(rawNurseName),
    name: rawNurseName.trim(),
    role: normalizedFallback
  };
}

function buildPatientDedupKey(session: Pick<PatientHDSession, 'medicalRecordNumber' | 'patientName' | 'bedNumber'>): string {
  const cleanRm = (session.medicalRecordNumber || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanRm && cleanRm !== '0') {
    return `rm:${cleanRm}`;
  }
  const cleanName = (session.patientName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const cleanBed = (session.bedNumber || '').trim().toLowerCase().replace(/\s+/g, '_');
  return `pat:${cleanName}__${cleanBed}`;
}

interface DoctorCandidate {
  value: string;
  tier: number; // 2 = explicit manual choice in Logbook, 1 = active/submitted Logbook entry
  epoch: number;
}

function pickBestDoctorCandidate(candidates: DoctorCandidate[]): string | null {
  const valid = candidates.filter((c) => Boolean(c.value && c.value.trim() && c.value.trim() !== '-'));
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return b.epoch - a.epoch;
  });
  return valid[0].value.trim();
}

function resolveNurseLogbookIsoDate(logbook: NurseLogbookCloudData): string {
  if (logbook.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(logbook.dateIso.trim())) {
    return logbook.dateIso.trim();
  }
  const rawLabel = logbook.logbookDate || logbook.shiftSchedule?.date;
  if (rawLabel) {
    return indonesianDateLabelToIso(rawLabel);
  }
  return '';
}

/**
 * Aggregates all verified logbooks inputted across all accounts (Perawat Pelaksana,
 * PJ Shift, and Kepala Ruang) for a single active date and active shift.
 */
export function aggregateShiftVerifiedLogbooks(params: {
  sessions: PatientHDSession[];
  registryEntries: LogbookVerificationRegistryEntry[];
  masterNurses: MasterNurse[];
  masterPatients: MasterPatient[];
  nurseSchedules?: NurseScheduleEntry[];
  doctorSchedules?: DoctorScheduleEntry[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  activeDateLabel: string;
  activeShift: 'Pagi' | 'Siang';
  loggedInUserName?: string | null;
  fallbackShiftInfo: ShiftInfo;
}): ShiftDailyReportSummary {
  const {
    sessions,
    registryEntries,
    masterNurses,
    masterPatients,
    nurseSchedules,
    doctorSchedules,
    cloudNurseLogbooks,
    activeDateLabel,
    activeShift,
    loggedInUserName,
    fallbackShiftInfo
  } = params;

  const rawDate = activeDateLabel?.trim() || getCurrentIndonesianFullDate();
  const activeDateIso = indonesianDateLabelToIso(rawDate);
  const activeDateFormatted =
    normalizeIndonesianDateLabel(rawDate) || formatIsoDateToIndonesianFull(activeDateIso);
  const activeDay = extractActiveDayName(activeDateFormatted) as HdTreatmentDay;
  const shiftHours = formatShiftHoursForShift(activeShift);

  // Ambil laporan resmi terverifikasi dari logbookService & gabungkan dengan registri
  const verifiedServiceReports = logbookService.getCachedVerifiedReports({
    tanggal: activeDateIso,
    shift: activeShift
  });
  const combinedRegistryEntries = mergeRegistryWithLogbookServiceForDate(
    registryEntries,
    activeDateIso
  );

  // Filter registry entries matching this exact date & shift
  const matchingShiftRegistry = combinedRegistryEntries.filter((entry) => {
    const entryIso = resolveRegistryEntryIsoDate(entry);
    if (entryIso !== activeDateIso) return false;
    return normalizeShiftChoice(entry.shift) === activeShift;
  });

  const verifiedShiftRegistry = matchingShiftRegistry.filter(
    (entry) => entry.status === 'terverifikasi'
  );
  const pendingSubmissionsCount = matchingShiftRegistry.filter(
    (entry) => entry.status === 'diajukan'
  ).length;

  // 1. Collect verified sessions matching activeDateIso & activeShift
  const candidateVerifiedSessions: PatientHDSession[] = [];
  sessions.forEach((s) => {
    const sIso = resolveSessionIsoDate(s);
    if (sIso !== activeDateIso) return;
    const sShift = normalizeShiftChoice(s.shift);
    if (sShift !== activeShift) return;
    if (isSessionVerifiedForShiftAndDate(s, activeDateIso, activeShift, verifiedShiftRegistry)) {
      candidateVerifiedSessions.push(s);
    }
  });

  // 1b. Sertakan sessionsSnapshot dari logbookService.getVerifiedReports() jika tersedia
  verifiedServiceReports.forEach((rec) => {
    if (Array.isArray(rec.sessionsSnapshot)) {
      rec.sessionsSnapshot.forEach((snapSess) => {
        candidateVerifiedSessions.push(snapSess);
      });
    }
  });

  // 2. Reconcile verified registry entries whose patient list has not yet materialized in sessions
  verifiedShiftRegistry.forEach((entry) => {
    if (!entry.patients || !Array.isArray(entry.patients) || entry.patients.length === 0) {
      return;
    }

    entry.patients.forEach((mp, idx) => {
      if (!mp.patientName?.trim() && !mp.bedNumber?.trim()) return;
      const cleanMpRm = mp.medicalRecord?.trim();
      const cleanMpName = (mp.patientName || '').trim().toLowerCase();

      const alreadyInSessions = candidateVerifiedSessions.some((s) => {
        if (cleanMpRm && s.medicalRecordNumber?.trim() === cleanMpRm) return true;
        if (cleanMpName && s.patientName.trim().toLowerCase() === cleanMpName) return true;
        if (
          isMatchingNurse(s.nurseInCharge, entry.submittedNurseName) &&
          isSameBed(s.bedNumber, mp.bedNumber)
        ) {
          return true;
        }
        return false;
      });

      if (!alreadyInSessions) {
        const masterMatch = masterPatients.find(
          (m) =>
            (cleanMpRm && m.medicalRecordNumber === cleanMpRm) ||
            (cleanMpName && m.patientName.trim().toLowerCase() === cleanMpName)
        );
        const dryWeight = masterMatch?.defaultDryWeight || 60.0;

        candidateVerifiedSessions.push(
          ensureFullBagianData({
            id: `sess-reg-${activeDateIso}-${activeShift}-${getNurseStorageKey(entry.submittedNurseName)}-${idx}`,
            date: activeDateFormatted,
            sessionDate: activeDateIso,
            shift: activeShift,
            bedNumber: mp.bedNumber || 'BED A01',
            patientName: mp.patientName || masterMatch?.patientName || 'Pasien HD',
            medicalRecordNumber:
              mp.medicalRecord || masterMatch?.medicalRecordNumber || '',
            age: masterMatch?.age || 54,
            gender: masterMatch?.gender || 'L',
            status: masterMatch?.defaultStatus || 'rajal',
            category: masterMatch?.category || 'reguler',
            sessionStatus: 'selesai',
            isCito: false,
            vascularAccess: masterMatch?.defaultVascularAccess || 'av_fistula',
            accessSite: masterMatch?.defaultAccessSite || 'AVF Radiocephalica',
            dialyzerModel: masterMatch?.defaultDialyzer || 'SAS HF 18',
            isReuse: false,
            dryWeight,
            preWeight: dryWeight + 2.4,
            postWeight: dryWeight,
            targetUf: 2400,
            achievedUf: 2400,
            durationPrescribed: 4.5,
            durationActual: 4.5,
            bloodFlowQb: 220,
            dialysateFlowQd: 500,
            preBp: '140/85',
            postBp: '125/80',
            hasHypotension: false,
            hasMuscleCramps: false,
            hasClotting: false,
            hasFirstUseSyndrome: false,
            hasAccessBleeding: false,
            hasConsultDpjp: false,
            underUfTolerated: false,
            nurseInCharge: entry.submittedNurseName,
            isVerifiedByPj: true,
            isVerifiedByKepalaRuang: entry.submittedNurseRole === 'kepala_ruangan',
            verificationStatus: 'terverifikasi',
            verifiedAt: entry.verifiedAt,
            verifiedBy: entry.verifiedBy,
            verifiedByRole: entry.verifiedByRole
          })
        );
      }
    });
  });

  // 3. Deduplicate verified sessions within the same date & shift
  const seenPatientKeys = new Set<string>();
  const verifiedSessions: PatientHDSession[] = [];
  candidateVerifiedSessions.forEach((s) => {
    const key = buildPatientDedupKey(s);
    if (!seenPatientKeys.has(key)) {
      seenPatientKeys.add(key);
      verifiedSessions.push(s);
    }
  });

  // 4. Count distinct nurses (Pelaksana, PJ Shift, Kepala Ruang) who inputted verified logbooks on this shift & date
  const nurseMap = new Map<string, ParticipatingShiftNurse>();

  const registerNurse = (
    rawName: string | undefined,
    roleHint: SystemAccessRole | undefined,
    incrementPatient: boolean
  ) => {
    const clean = (rawName || '').trim();
    if (!clean || clean === '-') return;
    const resolved = resolveCanonicalNurseIdentity(clean, roleHint, masterNurses);
    if (!resolved.canonicalKey || resolved.canonicalKey === 'default') return;

    const existing = nurseMap.get(resolved.canonicalKey);
    if (existing) {
      if (incrementPatient) {
        existing.patientCount += 1;
      }
    } else {
      nurseMap.set(resolved.canonicalKey, {
        canonicalKey: resolved.canonicalKey,
        name: resolved.name,
        role: resolved.role,
        patientCount: incrementPatient ? 1 : 0
      });
    }
  };

  verifiedSessions.forEach((s) => {
    if (s.sessionStatus === 'batal') return;
    const regMatch = verifiedShiftRegistry.find((e) =>
      isMatchingNurse(e.submittedNurseName, s.nurseInCharge)
    );
    registerNurse(s.nurseInCharge, regMatch?.submittedNurseRole, true);
  });

  // Also ensure any verified registry entry or logbookService verified report is registered
  verifiedShiftRegistry.forEach((entry) => {
    if (entry.patients && entry.patients.length > 0) {
      registerNurse(entry.submittedNurseName, entry.submittedNurseRole, false);
    }
  });
  verifiedServiceReports.forEach((rec) => {
    if (
      (rec.patients && rec.patients.length > 0) ||
      (Array.isArray(rec.items) && rec.items.some((it) => it.verified))
    ) {
      registerNurse(rec.namaPerawat, rec.perawatRole, false);
    }
  });

  const participatingNurses = Array.from(nurseMap.values());
  const scheduledShiftManpower = resolveScheduledNursesFromMatrix(
    nurseSchedules,
    masterNurses,
    activeDateIso,
    activeShift
  );
  const jumlahPerawatDinas = scheduledShiftManpower.hasScheduleForDate
    ? scheduledShiftManpower.scheduledNurses.length
    : Array.isArray(nurseSchedules) && nurseSchedules.length > 0
    ? participatingNurses.length
    : participatingNurses.length;
  const jumlahPerawatDinasLabel = `${jumlahPerawatDinas} Orang`;

  // 5. Total Pasien Dilayani & Rasio Perawat dan Pasien
  const servedSessions = verifiedSessions.filter((s) => s.sessionStatus !== 'batal');
  const totalPasienDilayani = servedSessions.length;
  const rasioPerawatPasien = calculateNursePatientRatio(
    jumlahPerawatDinas,
    totalPasienDilayani
  );

  // 6. Scheduled patients count for activeDay + activeShift
  const scheduledMaster =
    masterPatients.length > 0
      ? filterMasterPatientsForActiveSchedule(masterPatients, activeDay, activeShift)
      : [];
  const scheduledTargetCount = scheduledMaster.length;

  const baseCensus = computeCensusAndAccess(verifiedSessions, scheduledTargetCount);
  const census: AggregatedCensus = {
    ...baseCensus,
    pasienTerjadwal: Math.max(scheduledTargetCount, totalPasienDilayani),
    pasienHadirSelesai: totalPasienDilayani,
    totalPasienDilayani
  };

  const totalPasienDilayaniLabel =
    totalPasienDilayani > 0
      ? `${totalPasienDilayani} Pasien (${census.pasienRajal} Rajal, ${census.pasienRanap} Ranap)`
      : '0 Pasien';

  // 7. Penanggung Jawab (PJ) Shift (menyesuaikan perawat terjadwal PJ Shift pada tanggal & shift aktif) & Kepala Ruangan HD
  const scheduledMatrixPj = resolvePjShiftEntryFromMatrix(
    nurseSchedules,
    masterNurses,
    activeDateIso,
    activeShift
  );
  const activeMasterNurses = masterNurses.filter((n) => n.accountStatus !== 'nonaktif');
  const masterShiftPj =
    activeMasterNurses.find(
      (n) =>
        (resolveNurseSystemAccess(n) === 'pj_shift' || n.role === 'pj_shift') &&
        n.shiftAssigned === activeShift &&
        n.isOnDutyToday
    ) ||
    activeMasterNurses.find(
      (n) =>
        (resolveNurseSystemAccess(n) === 'pj_shift' || n.role === 'pj_shift') &&
        n.shiftAssigned === activeShift
    );

  const cleanAccountOwner = (loggedInUserName || '').trim();
  const pjShiftIsFromMatrix = Boolean(scheduledMatrixPj?.name);
  const pjShiftName = scheduledMatrixPj?.name
    ? scheduledMatrixPj.name
    : Array.isArray(nurseSchedules) && nurseSchedules.length > 0 && masterShiftPj?.name
    ? masterShiftPj.name
    : cleanAccountOwner && cleanAccountOwner !== '-'
    ? cleanAccountOwner
    : masterShiftPj?.name
    ? masterShiftPj.name
    : fallbackShiftInfo.pjShift && fallbackShiftInfo.pjShift !== '-'
    ? fallbackShiftInfo.pjShift
    : '-';

  // 7b. Resolusi PJ Shift Penerima (Yang Menerima / Menerima) dari Matriks Jadwal Bulanan Perawat
  // - Shift Pagi: Yang Menerima = PJ SHIFT SIANG pada tanggal yang sama
  // - Shift Siang: Menerima = Perawat On-Call / Cito atau Shift Berikutnya
  const scheduledMatrixNextPj = resolvePjShiftEntryFromMatrix(
    nurseSchedules,
    masterNurses,
    activeDateIso,
    activeShift === 'Pagi' ? 'Siang' : 'Pagi'
  );

  const scheduledOnCallNurse = Array.isArray(nurseSchedules)
    ? nurseSchedules.find(
        (s) =>
          s.date === activeDateIso &&
          (s.shift === 'On-Call' || (s.shift as string) === 'OC')
      )
    : undefined;

  let pjShiftBerikutnyaName = '';
  let pjShiftBerikutnyaIsFromMatrix = false;

  if (activeShift === 'Pagi') {
    if (scheduledMatrixNextPj?.name) {
      pjShiftBerikutnyaName = scheduledMatrixNextPj.name;
      pjShiftBerikutnyaIsFromMatrix = true;
    } else {
      const masterSiangPj = activeMasterNurses.find(
        (n) =>
          (resolveNurseSystemAccess(n) === 'pj_shift' || n.role === 'pj_shift') &&
          n.shiftAssigned === 'Siang'
      );
      pjShiftBerikutnyaName =
        masterSiangPj?.name ||
        (fallbackShiftInfo.pjShiftBerikutnya && fallbackShiftInfo.pjShiftBerikutnya !== '-'
          ? fallbackShiftInfo.pjShiftBerikutnya
          : '');
    }
  } else {
    if (scheduledOnCallNurse?.nurseName) {
      pjShiftBerikutnyaName = scheduledOnCallNurse.nurseName;
      pjShiftBerikutnyaIsFromMatrix = true;
    } else if (fallbackShiftInfo.pjShiftBerikutnya && fallbackShiftInfo.pjShiftBerikutnya !== '-') {
      pjShiftBerikutnyaName = fallbackShiftInfo.pjShiftBerikutnya;
    } else {
      pjShiftBerikutnyaName = '';
    }
  }

  const karuMaster = masterNurses.find(
    (n) =>
      n.accountStatus !== 'nonaktif' &&
      (resolveNurseSystemAccess(n) === 'kepala_ruangan' || n.role === 'kepala_ruangan')
  );
  const kepalaRuanganName = karuMaster?.name || DEFAULT_KEPALA_RUANGAN_NAME;

  // 8. Dokter DPJP Unit HD & Dokter Jaga Ruangan — menyesuaikan nama dokter yang diinputkan di awal Logbook
  const matrixScheduledDoctors = resolveScheduledDoctorsFromMatrix(
    doctorSchedules,
    activeDateIso,
    activeShift
  );
  const matrixDpjpLower = matrixScheduledDoctors.primaryDpjp?.trim().toLowerCase() || '';
  const matrixJagaLower = matrixScheduledDoctors.primaryJaga?.trim().toLowerCase() || '';
  const dpjpCandidates: DoctorCandidate[] = [];
  const jagaCandidates: DoctorCandidate[] = [];

  // 8a. LocalStorage record written directly by Logbook start panel for (activeDateIso, activeShift)
  const localLogbookDoctors = readShiftLogbookDoctorsFromStorage(activeDateIso, activeShift);
  if (localLogbookDoctors) {
    const localEpoch = localLogbookDoctors.updatedAtEpoch || 1;
    const localTier = localLogbookDoctors.isManual ? 2 : 1;
    if (localLogbookDoctors.dokterDpjp?.trim()) {
      dpjpCandidates.push({
        value: localLogbookDoctors.dokterDpjp,
        tier: localTier,
        epoch: localEpoch
      });
    }
    if (localLogbookDoctors.dokterJaga?.trim()) {
      jagaCandidates.push({
        value: localLogbookDoctors.dokterJaga,
        tier: localTier,
        epoch: localEpoch
      });
    }
  }

  // 8b. Live Cloud / Local Nurse Logbooks matching (activeDateIso, activeShift)
  if (Array.isArray(cloudNurseLogbooks)) {
    cloudNurseLogbooks.forEach((lb) => {
      if (!lb || !lb.shiftDoctors) return;
      const lbDateIso = resolveNurseLogbookIsoDate(lb);
      if (lbDateIso !== activeDateIso) return;
      const lbShift = normalizeShiftChoice(lb.shiftSchedule?.shift);
      if (lbShift !== activeShift) return;

      const parsedEpoch =
        lb.shiftDoctors.updatedAtEpoch ||
        (lb.updatedAt ? Date.parse(lb.updatedAt) || 0 : 0);

      if (lb.shiftDoctors.dokterDpjp?.trim()) {
        const isDiffFromMatrix =
          Boolean(matrixDpjpLower) &&
          lb.shiftDoctors.dokterDpjp.trim().toLowerCase() !== matrixDpjpLower;
        dpjpCandidates.push({
          value: lb.shiftDoctors.dokterDpjp,
          tier: lb.shiftDoctors.isManualDpjp || isDiffFromMatrix ? 2 : 1,
          epoch: parsedEpoch
        });
      }

      if (lb.shiftDoctors.dokterJaga?.trim()) {
        const isDiffFromMatrix =
          Boolean(matrixJagaLower) &&
          lb.shiftDoctors.dokterJaga.trim().toLowerCase() !== matrixJagaLower;
        jagaCandidates.push({
          value: lb.shiftDoctors.dokterJaga,
          tier: lb.shiftDoctors.isManualJaga || isDiffFromMatrix ? 2 : 1,
          epoch: parsedEpoch
        });
      }
    });
  }

  // 8c. Verification Registry entries submitted/verified for (activeDateIso, activeShift)
  matchingShiftRegistry.forEach((entry) => {
    const regEpoch = entry.submittedEpoch || 0;
    if (entry.dokterDpjp?.trim()) {
      const isDiffFromMatrix =
        Boolean(matrixDpjpLower) &&
        entry.dokterDpjp.trim().toLowerCase() !== matrixDpjpLower;
      dpjpCandidates.push({
        value: entry.dokterDpjp,
        tier: isDiffFromMatrix ? 2 : 1,
        epoch: regEpoch
      });
    }
    if (entry.dokterJaga?.trim()) {
      const isDiffFromMatrix =
        Boolean(matrixJagaLower) &&
        entry.dokterJaga.trim().toLowerCase() !== matrixJagaLower;
      jagaCandidates.push({
        value: entry.dokterJaga,
        tier: isDiffFromMatrix ? 2 : 1,
        epoch: regEpoch
      });
    }
  });

  // 8d. Patient HD Sessions recorded on (activeDateIso, activeShift)
  sessions.forEach((s) => {
    const sIso = resolveSessionIsoDate(s);
    if (sIso !== activeDateIso) return;
    if (normalizeShiftChoice(s.shift) !== activeShift) return;
    const sessEpoch = s.updatedAt ? Date.parse(s.updatedAt) || 0 : (s.submittedEpoch || 0);
    if (s.dokterDpjp?.trim()) {
      const isDiffFromMatrix =
        Boolean(matrixDpjpLower) &&
        s.dokterDpjp.trim().toLowerCase() !== matrixDpjpLower;
      dpjpCandidates.push({
        value: s.dokterDpjp,
        tier: isDiffFromMatrix ? 2 : 1,
        epoch: sessEpoch
      });
    }
    if (s.dokterJaga?.trim()) {
      const isDiffFromMatrix =
        Boolean(matrixJagaLower) &&
        s.dokterJaga.trim().toLowerCase() !== matrixJagaLower;
      jagaCandidates.push({
        value: s.dokterJaga,
        tier: isDiffFromMatrix ? 2 : 1,
        epoch: sessEpoch
      });
    }
  });

  const dokterDpjpName =
    pickBestDoctorCandidate(dpjpCandidates) ||
    matrixScheduledDoctors.primaryDpjp ||
    (fallbackShiftInfo.dokterDpjp && fallbackShiftInfo.dokterDpjp !== '-'
      ? fallbackShiftInfo.dokterDpjp
      : '-');

  const dokterJagaName =
    pickBestDoctorCandidate(jagaCandidates) ||
    matrixScheduledDoctors.primaryJaga ||
    (fallbackShiftInfo.dokterJaga && fallbackShiftInfo.dokterJaga !== '-'
      ? fallbackShiftInfo.dokterJaga
      : '-');

  const clinicalIndicators = computeClinicalIndicators(servedSessions);

  const effectiveShiftInfoForSbar: ShiftInfo = {
    ...fallbackShiftInfo,
    date: activeDateFormatted,
    shift: activeShift,
    shiftHours,
    pjShift: pjShiftName,
    pjShiftBerikutnya: pjShiftBerikutnyaName,
    kepalaRuangan: kepalaRuanganName,
    dokterDpjp: dokterDpjpName,
    dokterJaga: dokterJagaName,
    totalPerawatDinas: jumlahPerawatDinas,
    detailPerawat: jumlahPerawatDinasLabel,
    perawatRatio: rasioPerawatPasien
  };

  const autoSbar: SbarData =
    totalPasienDilayani > 0
      ? generateAutoSbar(effectiveShiftInfoForSbar, census, servedSessions)
      : {
          situation: `Shift ${activeShift} (${activeDateFormatted}): Belum ada logbook pasien terverifikasi yang tercatat pada shift ini (0 Pasien, ${jumlahPerawatDinas} Perawat Dinas).`,
          background:
            'Menunggu penginputan dan pengesahan verifikasi logbook pasien oleh Perawat Pelaksana, PJ Shift, atau Kepala Ruang.',
          assessment:
            'Indikator klinis dan capaian ultrafiltrasi akan terangkum otomatis segera setelah logbook shift diverifikasi.',
          recommendation: `1. Pastikan seluruh perawat yang berdinas pada Shift ${activeShift} mengajukan dan memverifikasi logbook pasien.\n2. Lakukan pemeriksaan kesiapan mesin HD dan parameter mutu air RO sesuai SOP.`
        };

  return {
    activeDateIso,
    activeDateFormatted,
    activeDay,
    activeShift,
    shiftHours,
    pjShiftName,
    pjShiftBerikutnyaName,
    pjShiftIsFromMatrix,
    pjShiftBerikutnyaIsFromMatrix,
    kepalaRuanganName,
    dokterDpjpName,
    dokterJagaName,
    jumlahPerawatDinas,
    jumlahPerawatDinasLabel,
    participatingNurses,
    totalPasienDilayani,
    totalPasienDilayaniLabel,
    rasioPerawatPasien,
    pendingSubmissionsCount,
    verifiedSessions,
    census,
    clinicalIndicators,
    autoSbar
  };
}
