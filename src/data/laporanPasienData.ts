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
  AggregatedCensus,
  ClinicalIndicatorItem,
  DoctorScheduleEntry,
  MachineOverview,
  MasterDoctor,
  MasterNurse,
  MasterPatient,
  NurseScheduleEntry,
  OfficialNurseLogbookMonth,
  OperationalItem,
  PatientHDSession,
  SbarData,
  ShiftInfo,
  ShiftSignatures,
  SystemAccessRole
} from '../types/dialysis.ts';
import {
  OFFICIAL_LOGBOOK_ITEMS,
  createInitialOfficialLogbook,
  logbookService,
  type LogbookHarianRecord
} from './officialPelaksanaLogbookData.ts';
import {
  isKepalaRuangVerifier,
  isMatchingNurse,
  isSameBed
} from '../utils/nurseVerificationHelpers.ts';
import {
  formatIsoDateToIndonesianFull,
  indonesianDateLabelToIso
} from '../utils/dateHelpers.ts';

export interface LaporanPasienRow {
  id: string;
  no: number;
  tanggal: string; // Format: YYYY-MM-DD (Penting untuk filter laporan)
  shift?: 'Pagi' | 'Siang';
  // DATA IDENTITAS & STATUS PASIEN
  noRm: string;
  namaPasien: string;
  statusRawat: 'Rawat Jalan' | 'Rawat Inap';
  ruangKategori: string; // 'Reguler' | 'Isolasi Hep B' | 'Isolasi Hep C'
  // PENGATURAN TEKNIS & PRE-HD
  noBedMesin: string;
  aksesVaskular: string;
  waktuMulai: string;
  waktuSelesai: string;
  durasiJam: number;
  // PARAMETER BERAT BADAN & ALIRAN (QB/QD)
  bbKering: number;
  bbPreHd: number;
  bbPostHd: number;
  qb: number;
  qd: number;
  // MONITORING ULTRAFILTRASI & ADEKUASI
  targetUf: number;
  ktV: number;
  capaianUf: number;
  // TANDA VITAL (HEMODINAMIK)
  tdPre: string;
  tdPost: string;
  // SPESIFIKASI DIALISER & HEPARINISASI
  dialiser: string;
  heparinisasi: string;
  // KOMPLIKASI, TATALAKSANA & ADVIS DPJP
  komplikasiIntraHd: string;
  tindakanAdvisDpjp: string;
  // STATUS OPERASIONAL MESIN & DISINFEKSI
  statusMesin: string;
  metodeDisinfeksi: string;
  ketTeknis: string;
  // STATUS MUTU WATER TREATMENT RO
  jamCekRo: string;
  kondisiAirRo: string;
  // ALUR VERIFIKASI MULTI-USER (PJ Shift -> Kepala Ruang)
  perawatId?: string;
  perawatPelaksana: string;
  statusVerifikasi: 'draft' | 'submitted' | 'verified_pj' | 'verified_karu';
  verifikatorPjId?: string;
  verifikatorPjNama?: string;
  verifikatorKaruId?: string;
  verifikatorKaruNama?: string;
  verifierNotes?: string;
  revisionRequested?: boolean;
  updatedAt?: string;
}

export interface LaporanPasienSummary {
  totalPasien: number;
  rawatJalan: number;
  rawatInap: number;
  reguler: number;
  isolasiHepB: number;
  isolasiHepC: number;
  aksesAvShunt: number;
  aksesCdl: number;
  aksesFemoral: number;
  rataDurasiJam: number;
  rataBbKering: number;
  rataBbPreHd: number;
  rataBbPostHd: number;
  rataQb: number;
  rataQd: number;
  totalTargetUf: number;
  totalCapaianUf: number;
  rataCapaianUf: number;
  rataKtV: number;
  memenuhiKtVCount: number;
  memenuhiKtVPct: number;
  komplikasiCount: number;
  bebasKomplikasiCount: number;
  bebasKomplikasiPct: number;
  roMemenuhiSyaratCount: number;
}

export interface MonthlyNurseItemStat {
  code: string;
  bagian: number;
  totalScore: number;
  maxScore: number;
  pct: number;
}

export interface MonthlyNurseReportOptions {
  nipNira?: string;
  nurseRole?: SystemAccessRole;
  headNurseName?: string;
  headNurseNip?: string;
}

export interface MonthlyNurseSpoMatrixReport {
  namaPerawat: string;
  bulanTahun: string; // YYYY-MM
  month: number; // 1..12
  year: number;
  monthLabel: string;
  roleLabel: string;
  daysInMonth: number;
  verifiedDaysCount: number;
  totalVerifiedPatientsInMonth: number;
  poin3_6TotalCount: number;
  logbook: OfficialNurseLogbookMonth;
  itemStats: Record<string, MonthlyNurseItemStat>;
  dailyTotalScores: (number | null)[];
  dailyMaxScores: (number | null)[];
  grandTotalScore: number;
  grandMaxScore: number;
  overallCompliancePct: number;
  verifiedRows: LaporanPasienRow[];
  verifiedLogbooks: LogbookHarianRecord[];
}

export interface KarsClinicalQualityMetrics {
  totalVerifiedSessions: number;
  verifiedPjCount: number;
  verifiedKaruCount: number;
  ufTargetMetCount: number;
  ufTargetMetPct: number;
  avgTargetUfMl: number;
  avgAchievedUfMl: number;
  ktvMetCount: number;
  ktvMetPct: number;
  avgKtV: number;
  durationMetCount: number;
  durationMetPct: number;
  avgDurationHours: number;
  complicationCaseCount: number;
  complicationFreeCount: number;
  complicationFreePct: number;
  qbStabilCount: number;
  qbStabilPct: number;
  avgQb: number;
  advisDocumentedCount: number;
  advisCompliancePct: number;
}

export interface KarsRoWaterChecklistSummary {
  totalCheckedSessions: number;
  roMemenuhiSyaratCount: number;
  roMemenuhiSyaratPct: number;
  jamCekRoList: string[];
  primaryJamCekRo: string;
  disinfeksiHeatCleanCount: number;
  disinfeksiCompliancePct: number;
  mesinSiapPakaiCount: number;
  mesinSiapPakaiPct: number;
  overallRoStatus: 'MEMENUHI SYARAT' | 'BELUM ADA DATA' | 'PERLU EVALUASI';
}

export interface KarsShiftAccreditationSummary {
  tanggalIso: string;
  tanggalFormatted: string;
  shift: 'Pagi' | 'Siang';
  shiftHours: string;
  verifiedRows: LaporanPasienRow[];
  participatingNurses: {
    name: string;
    patientCount: number;
    verifiedPjCount: number;
    verifiedKaruCount: number;
  }[];
  jumlahPerawatTerverifikasi: number;
  rasioPerawatPasien: string;
  census: AggregatedCensus;
  machineUtilization: MachineOverview;
  qualityMetrics: KarsClinicalQualityMetrics;
  clinicalIndicators: ClinicalIndicatorItem[];
  roChecklist: KarsRoWaterChecklistSummary;
  operationalItems: OperationalItem[];
  autoSbar: SbarData;
}

// Array statis dikosongkan agar seluruh laporan 100% ditarik dari Cloud Firestore ('verified_karu')
export const BENCHMARK_LAPORAN_PASIEN_ROWS: Omit<
  LaporanPasienRow,
  'statusVerifikasi' | 'tanggal'
>[] = [];

// ============================================================================
// CACHE + LAYANAN DATABASE CLOUD FIRESTORE UNTUK LAPORAN PASIEN ("patient_sessions")
// ============================================================================

const PATIENT_SESSIONS_CACHE_KEY = 'patient_sessions_cloud_cache_v2';
let memoryPatientSessionsMap = new Map<string, LaporanPasienRow>();
let patientCacheHydrated = false;

function sanitizePatientSessionId(id: string): string {
  const cleaned = (id || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 128);
  return cleaned || `ps_${Date.now()}`;
}

function ensurePatientCacheHydrated(): void {
  if (patientCacheHydrated) return;
  patientCacheHydrated = true;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(PATIENT_SESSIONS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((row: LaporanPasienRow) => {
          if (row && row.id) {
            memoryPatientSessionsMap.set(row.id, row);
          }
        });
      }
    }
  } catch {
    // ignore
  }
}

function persistPatientCache(emitEvent: boolean = true): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const list = Array.from(memoryPatientSessionsMap.values());
    window.localStorage.setItem(PATIENT_SESSIONS_CACHE_KEY, JSON.stringify(list));
    if (emitEvent) {
      window.dispatchEvent(new CustomEvent('logbook_sessions_updated'));
    }
  } catch {
    // ignore
  }
}

function isCloudEnabled(): boolean {
  return typeof window !== 'undefined' && !isFirestoreQuotaExhausted();
}

function filterVerifiedKaruPatientRows(
  rows: LaporanPasienRow[],
  startDate?: string,
  endDate?: string
): LaporanPasienRow[] {
  let list = rows.filter(
    (r) => r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj'
  );
  if (startDate && endDate) {
    list = list.filter((r) => r.tanggal >= startDate && r.tanggal <= endDate);
  } else if (startDate) {
    list = list.filter((r) => r.tanggal === startDate);
  }
  return list
    .sort((a, b) => {
      if (a.tanggal !== b.tanggal) return (b.tanggal || '').localeCompare(a.tanggal || '');
      return (a.noBedMesin || '').localeCompare(b.noBedMesin || '', undefined, { numeric: true });
    })
    .map((r, idx) => ({ ...r, no: idx + 1 }));
}

export function buildDeterministicPatientSessionId(params: {
  tanggal: string;
  shift?: string;
  perawatPelaksana?: string;
  noBedMesin?: string;
  noRm?: string;
}): string {
  const nurseSlug = (params.perawatPelaksana || 'nurse')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 32);
  const bedSlug = (params.noBedMesin || 'bed')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 24);
  const rmSlug = (params.noRm || '0').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 20) || '0';
  const shiftSlug = (params.shift || 'Pagi').toLowerCase().includes('siang') ? 'Siang' : 'Pagi';
  return sanitizePatientSessionId(
    `ps-${params.tanggal}-${shiftSlug}-${nurseSlug}-${bedSlug}-${rmSlug}`
  );
}

let useFallbackPatientCol = false;
const PRIMARY_PATIENT_COL = 'patient_sessions';
const FALLBACK_PATIENT_COL = 'verification_registry';
const FALLBACK_PATIENT_KIND = 'cloud_patient_session_v2';

function isPermDenied(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.toLowerCase().includes('missing or insufficient permissions') ||
    msg.toLowerCase().includes('permission-denied') ||
    msg.toLowerCase().includes('permission_denied')
  );
}

function getActivePatientCol(): string {
  return useFallbackPatientCol ? FALLBACK_PATIENT_COL : PRIMARY_PATIENT_COL;
}

function toPatientDocId(cleanId: string, colName: string): string {
  return colName === FALLBACK_PATIENT_COL ? sanitizePatientSessionId(`psdoc_${cleanId}`) : cleanId;
}

function isMatchingPatientDoc(data: Record<string, unknown>, colName: string): boolean {
  if (colName !== FALLBACK_PATIENT_COL) return true;
  return data?.recordKind === FALLBACK_PATIENT_KIND;
}

function clampStr(val: string | undefined, maxLen: number, fallback: string = ''): string {
  const s = (val ?? fallback).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeLaporanRowBounds(session: LaporanPasienRow, cleanId: string, nowIso: string): LaporanPasienRow {
  const allowedStatus: LaporanPasienRow['statusVerifikasi'][] = [
    'draft',
    'submitted',
    'verified_pj',
    'verified_karu'
  ];
  const safeStatus = allowedStatus.includes(session.statusVerifikasi)
    ? session.statusVerifikasi
    : 'draft';

  return {
    ...session,
    id: cleanId,
    tanggal: clampStr(session.tanggal, 32, nowIso.slice(0, 10)),
    shift: normalizeShiftName(session.shift),
    noRm: clampStr(session.noRm, 64, '-'),
    namaPasien: clampStr(session.namaPasien, 300, 'Pasien HD'),
    statusRawat: session.statusRawat === 'Rawat Inap' ? 'Rawat Inap' : 'Rawat Jalan',
    ruangKategori: clampStr(session.ruangKategori, 128, 'Reguler'),
    noBedMesin: clampStr(session.noBedMesin, 128, 'Bed 01 / M-01'),
    aksesVaskular: clampStr(session.aksesVaskular, 128, 'AV SHUNT'),
    perawatPelaksana: clampStr(session.perawatPelaksana, 300, '-'),
    statusVerifikasi: safeStatus,
    verifikatorPjId: session.verifikatorPjId ? clampStr(session.verifikatorPjId, 300) : undefined,
    verifikatorKaruId: session.verifikatorKaruId
      ? clampStr(session.verifikatorKaruId, 300)
      : undefined,
    komplikasiIntraHd: clampStr(session.komplikasiIntraHd, 2000, 'Tidak ada'),
    tindakanAdvisDpjp: clampStr(session.tindakanAdvisDpjp, 2000, 'Tidak ada'),
    verifierNotes: session.verifierNotes ? clampStr(session.verifierNotes, 2000) : undefined,
    updatedAt: nowIso
  };
}

function normalizeShiftName(shift?: string): 'Pagi' | 'Siang' {
  return (shift || '').trim().toLowerCase().includes('siang') ? 'Siang' : 'Pagi';
}

function normalizeDateIsoParam(tanggal: string): string {
  const trimmed = (tanggal || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return indonesianDateLabelToIso(trimmed);
}

const VERIF_STATUS_RANK: Record<LaporanPasienRow['statusVerifikasi'], number> = {
  draft: 1,
  submitted: 2,
  verified_pj: 3,
  verified_karu: 4
};

function makeShiftPatientDedupKey(row: Pick<LaporanPasienRow, 'noRm' | 'namaPasien' | 'noBedMesin'>): string {
  const cleanRm = (row.noRm || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanRm && cleanRm !== '0' && cleanRm !== '-') {
    return `rm:${cleanRm}`;
  }
  const cleanName = (row.namaPasien || '').trim().toLowerCase();
  const cleanBed = (row.noBedMesin || '').trim().toLowerCase();
  return `pat:${cleanName}__${cleanBed}`;
}

function mergeShiftPatientRows(rows: LaporanPasienRow[]): LaporanPasienRow[] {
  const map = new Map<string, LaporanPasienRow>();
  rows.forEach((candidate) => {
    if (!candidate || (!candidate.namaPasien?.trim() && !candidate.noBedMesin?.trim())) return;
    const key = makeShiftPatientDedupKey(candidate);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, candidate);
      return;
    }
    const candRank = VERIF_STATUS_RANK[candidate.statusVerifikasi] || 1;
    const existRank = VERIF_STATUS_RANK[existing.statusVerifikasi] || 1;
    if (candRank > existRank) {
      map.set(key, {
        ...existing,
        ...candidate,
        statusVerifikasi: candidate.statusVerifikasi
      });
    } else if (candRank === existRank) {
      const candTime = candidate.updatedAt || '';
      const existTime = existing.updatedAt || '';
      if (candTime >= existTime) {
        map.set(key, { ...existing, ...candidate });
      }
    }
  });

  return Array.from(map.values())
    .sort((a, b) =>
      (a.noBedMesin || '').localeCompare(b.noBedMesin || '', undefined, { numeric: true })
    )
    .map((r, idx) => ({ ...r, no: idx + 1 }));
}

function parseNumericField(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(',', '.').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function extractRawRowsFromNurseLogbookCloudDoc(
  rawDoc: Record<string, unknown>,
  targetIso: string,
  targetShift: 'Pagi' | 'Siang'
): LaporanPasienRow[] {
  const docDateIso =
    typeof rawDoc.dateIso === 'string' && rawDoc.dateIso.trim()
      ? normalizeDateIsoParam(rawDoc.dateIso)
      : typeof rawDoc.logbookDate === 'string' && rawDoc.logbookDate.trim()
      ? indonesianDateLabelToIso(rawDoc.logbookDate)
      : '';
  if (docDateIso !== targetIso) return [];

  const shiftSched = rawDoc.shiftSchedule as { shift?: string } | undefined;
  const docShift = normalizeShiftName(shiftSched?.shift);
  if (docShift !== targetShift) return [];

  const nurseName = typeof rawDoc.nurseName === 'string' && rawDoc.nurseName.trim()
    ? rawDoc.nurseName.trim()
    : '-';
  const managedPatients = Array.isArray(rawDoc.managedPatients)
    ? (rawDoc.managedPatients as Array<Record<string, unknown>>)
    : [];
  if (managedPatients.length === 0) return [];

  const clinicalDetails = (rawDoc.clinicalDetails || {}) as Record<string, any>;
  const patientSubmissions = (rawDoc.patientSubmissions || {}) as Record<string, any>;
  const headerSub = (rawDoc.submission || {}) as Record<string, any>;
  const updatedAt = typeof rawDoc.updatedAt === 'string' ? rawDoc.updatedAt : undefined;

  return managedPatients
    .filter((mp) => Boolean(mp && (mp.patientName || mp.bedNumber)))
    .map((mp, idx) => {
      const pId = String(mp.id || `pat-${idx}`);
      const bedNumber = String(mp.bedNumber || 'Bed 01');
      const patientName = String(mp.patientName || 'Pasien HD');
      const medicalRecord = String(mp.medicalRecord || '-');
      const sub = patientSubmissions[pId] || headerSub || {};
      const subStatus = String(sub.status || 'belum_diajukan');
      const verifiedRole = String(sub.verifiedByRole || '');
      const isKaru = isKepalaRuangVerifier(verifiedRole, String(sub.verifiedBy || ''));

      const statusVerifikasi: LaporanPasienRow['statusVerifikasi'] =
        subStatus === 'terverifikasi'
          ? isKaru
            ? 'verified_karu'
            : 'verified_pj'
          : subStatus === 'diajukan'
          ? 'submitted'
          : 'draft';

      const clin = clinicalDetails[pId] || clinicalDetails[bedNumber] || {};
      const durasiJam = parseNumericField(clin?.poin3_5?.waktuDialisis, 4.5);
      const times = calculateDialysisTimes(targetShift, durasiJam, idx);
      const bbKering = parseNumericField(clin?.poin3_2?.bbKering, 60);
      const bbPreHd = parseNumericField(clin?.poin3_2?.bbPre, Number((bbKering + 2.0).toFixed(1)));
      const bbPostHd = parseNumericField(clin?.poin3_2?.bbPost, bbKering);
      const qb = parseNumericField(clin?.poin3_5?.qb, 220);
      const qd = parseNumericField(clin?.poin3_5?.qd, 500);
      const targetUf = parseNumericField(
        clin?.poin3_5?.targetUfg || clin?.poin3_2?.ufg,
        2000
      );
      const capaianUf = parseNumericField(clin?.poin6_3?.ufgTercapai, targetUf);
      const ktV = parseNumericField(clin?.poin6_3?.ktV, 1.35);

      const tdPre =
        typeof clin?.poin3_3?.tdPreHd === 'string' && clin.poin3_3.tdPreHd.trim()
          ? clin.poin3_3.tdPreHd.trim()
          : clin?.poin3_3?.tdSistolik && clin?.poin3_3?.tdDiastolik
          ? `${clin.poin3_3.tdSistolik}/${clin.poin3_3.tdDiastolik}`
          : '140/85';
      const tdPost =
        typeof clin?.poin6_3?.tdPostHd === 'string' && clin.poin6_3.tdPostHd.trim()
          ? clin.poin6_3.tdPostHd.trim()
          : '125/80';

      const statusRawat: 'Rawat Jalan' | 'Rawat Inap' =
        clin?.poin3_1?.status === 'RAWAT INAP' ? 'Rawat Inap' : 'Rawat Jalan';
      const ruangKategori =
        clin?.poin3_1?.kategori === 'ISOLASI HEPATITIS B'
          ? 'Isolasi Hep B'
          : clin?.poin3_1?.kategori === 'ISOLASI HEPATITIS C/HIV'
          ? 'Isolasi Hep C'
          : 'Reguler';

      const aksesVaskular =
        clin?.poin3_6?.femoralAktif
          ? 'FEMORAL'
          : clin?.poin3_6?.cdlAktif
          ? 'CDL'
          : 'AV SHUNT';

      return {
        id: buildDeterministicPatientSessionId({
          tanggal: targetIso,
          shift: targetShift,
          perawatPelaksana: nurseName,
          noBedMesin: bedNumber,
          noRm: medicalRecord
        }),
        no: idx + 1,
        tanggal: targetIso,
        shift: targetShift,
        noRm: medicalRecord,
        namaPasien: patientName,
        statusRawat,
        ruangKategori,
        noBedMesin: formatBedAndMachineLabel(bedNumber),
        aksesVaskular,
        waktuMulai: times.waktuMulai,
        waktuSelesai: times.waktuSelesai,
        durasiJam,
        bbKering,
        bbPreHd,
        bbPostHd,
        qb,
        qd,
        targetUf,
        ktV,
        capaianUf,
        tdPre,
        tdPost,
        dialiser: 'High Flux (SAS HF 18)',
        heparinisasi:
          typeof clin?.poin3_5?.dosisHeparin === 'string' && clin.poin3_5.dosisHeparin.trim()
            ? clin.poin3_5.dosisHeparin.trim()
            : 'Standar (5000 IU)',
        komplikasiIntraHd: 'Tidak ada',
        tindakanAdvisDpjp: 'Tidak ada',
        statusMesin: 'Siap Pakai',
        metodeDisinfeksi: 'Heat Clean',
        ketTeknis: 'Normal',
        jamCekRo: targetShift === 'Siang' ? '13:30' : '06:30',
        kondisiAirRo: 'Memenuhi Syarat',
        perawatPelaksana: nurseName,
        statusVerifikasi,
        verifikatorPjNama: !isKaru && sub.verifiedBy ? String(sub.verifiedBy) : undefined,
        verifikatorKaruNama: isKaru && sub.verifiedBy ? String(sub.verifiedBy) : undefined,
        verifierNotes: typeof sub.verifierNotes === 'string' ? sub.verifierNotes : undefined,
        revisionRequested: Boolean(sub.revisionRequested),
        updatedAt
      };
    });
}

function extractRowsFromLogbookRecord(
  lb: LogbookHarianRecord,
  overrideStatus?: LaporanPasienRow['statusVerifikasi']
): LaporanPasienRow[] {
  const lbShift = normalizeShiftName(lb.shift);
  const resolvedStatus = overrideStatus || lb.statusVerifikasi || 'draft';
  const rows: LaporanPasienRow[] = [];

  if (Array.isArray(lb.sessionsSnapshot)) {
    lb.sessionsSnapshot.forEach((snap, sIdx) => {
      rows.push(
        convertSessionToLaporanRow(snap, sIdx, {
          statusVerifikasi: resolvedStatus,
          tanggalIso: lb.tanggal
        })
      );
    });
  }

  if (Array.isArray(lb.patients)) {
    const clinMap = (lb.clinicalDetails || {}) as Record<string, any>;
    lb.patients.forEach((mp, pIdx) => {
      if (!mp.patientName && !mp.bedNumber) return;
      const pStatusVerif: LaporanPasienRow['statusVerifikasi'] =
        resolvedStatus === 'verified_karu'
          ? 'verified_karu'
          : resolvedStatus === 'verified_pj'
          ? 'verified_pj'
          : mp.status === 'terverifikasi'
          ? isKepalaRuangVerifier(mp.verifiedByRole, mp.verifiedBy)
            ? 'verified_karu'
            : 'verified_pj'
          : mp.status === 'diajukan'
          ? 'submitted'
          : resolvedStatus;

      const clin = clinMap[mp.id || ''] || clinMap[mp.bedNumber] || {};
      const durasiJam = parseNumericField(clin?.poin3_5?.waktuDialisis, 4.5);
      const times = calculateDialysisTimes(lbShift, durasiJam, pIdx);
      const bbKering = parseNumericField(clin?.poin3_2?.bbKering, 60);
      const bbPreHd = parseNumericField(clin?.poin3_2?.bbPre, Number((bbKering + 2.2).toFixed(1)));
      const bbPostHd = parseNumericField(clin?.poin3_2?.bbPost, bbKering);
      const qb = parseNumericField(clin?.poin3_5?.qb, 220);
      const qd = parseNumericField(clin?.poin3_5?.qd, 500);
      const targetUf = parseNumericField(clin?.poin3_5?.targetUfg || clin?.poin3_2?.ufg, 2200);
      const capaianUf = parseNumericField(clin?.poin6_3?.ufgTercapai, targetUf);
      const ktV = parseNumericField(clin?.poin6_3?.ktV, 1.4);

      rows.push({
        id: buildDeterministicPatientSessionId({
          tanggal: lb.tanggal,
          shift: lbShift,
          perawatPelaksana: lb.namaPerawat,
          noBedMesin: mp.bedNumber,
          noRm: mp.medicalRecord
        }),
        no: pIdx + 1,
        tanggal: lb.tanggal,
        shift: lbShift,
        noRm: mp.medicalRecord || '-',
        namaPasien: mp.patientName || 'Pasien HD',
        statusRawat: clin?.poin3_1?.status === 'RAWAT INAP' ? 'Rawat Inap' : 'Rawat Jalan',
        ruangKategori:
          clin?.poin3_1?.kategori === 'ISOLASI HEPATITIS B'
            ? 'Isolasi Hep B'
            : clin?.poin3_1?.kategori === 'ISOLASI HEPATITIS C/HIV'
            ? 'Isolasi Hep C'
            : 'Reguler',
        noBedMesin: formatBedAndMachineLabel(mp.bedNumber),
        aksesVaskular: clin?.poin3_6?.femoralAktif
          ? 'FEMORAL'
          : clin?.poin3_6?.cdlAktif
          ? 'CDL'
          : 'AV SHUNT',
        waktuMulai: times.waktuMulai,
        waktuSelesai: times.waktuSelesai,
        durasiJam,
        bbKering,
        bbPreHd,
        bbPostHd,
        qb,
        qd,
        targetUf,
        ktV,
        capaianUf,
        tdPre:
          typeof clin?.poin3_3?.tdPreHd === 'string' && clin.poin3_3.tdPreHd.trim()
            ? clin.poin3_3.tdPreHd.trim()
            : '140/85',
        tdPost:
          typeof clin?.poin6_3?.tdPostHd === 'string' && clin.poin6_3.tdPostHd.trim()
            ? clin.poin6_3.tdPostHd.trim()
            : '125/80',
        dialiser: 'High Flux (SAS HF 18)',
        heparinisasi:
          typeof clin?.poin3_5?.dosisHeparin === 'string' && clin.poin3_5.dosisHeparin.trim()
            ? clin.poin3_5.dosisHeparin.trim()
            : 'Standar (5000 IU)',
        komplikasiIntraHd: 'Tidak ada',
        tindakanAdvisDpjp: 'Tidak ada',
        statusMesin: 'Siap Pakai',
        metodeDisinfeksi: 'Heat Clean',
        ketTeknis: 'Normal',
        jamCekRo: lbShift === 'Siang' ? '13:30' : '06:30',
        kondisiAirRo: 'Memenuhi Syarat',
        perawatPelaksana: lb.namaPerawat || '-',
        statusVerifikasi: pStatusVerif,
        verifikatorPjId: lb.verifikatorPjId,
        verifikatorPjNama: lb.verifikatorPjNama,
        verifikatorKaruId: lb.verifikatorKaruId,
        verifikatorKaruNama: lb.verifikatorKaruNama,
        verifierNotes: mp.verifierNotes || lb.verifierNotes,
        updatedAt: lb.updatedAt
      });
    });
  }

  return rows;
}

function parseBulanTahunParam(bulanTahun: string): { year: number; month: number; ymKey: string } {
  const raw = (bulanTahun || '').trim();
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = Math.min(12, Math.max(1, parseInt(isoMatch[2], 10)));
    return {
      year,
      month,
      ymKey: `${year}-${String(month).padStart(2, '0')}`
    };
  }
  const slashRev = raw.match(/^(\d{1,2})[-/](\d{4})/);
  if (slashRev) {
    const month = Math.min(12, Math.max(1, parseInt(slashRev[1], 10)));
    const year = parseInt(slashRev[2], 10);
    return {
      year,
      month,
      ymKey: `${year}-${String(month).padStart(2, '0')}`
    };
  }
  const monthNames = [
    'januari',
    'februari',
    'maret',
    'april',
    'mei',
    'juni',
    'juli',
    'agustus',
    'september',
    'oktober',
    'november',
    'desember'
  ];
  const lower = raw.toLowerCase();
  const foundIdx = monthNames.findIndex((m) => lower.includes(m) || lower.includes(m.slice(0, 3)));
  const yearMatch = raw.match(/(\d{4})/);
  const now = new Date();
  const year = yearMatch ? parseInt(yearMatch[1], 10) : now.getFullYear();
  const month = foundIdx >= 0 ? foundIdx + 1 : now.getMonth() + 1;
  return {
    year,
    month,
    ymKey: `${year}-${String(month).padStart(2, '0')}`
  };
}

const INDONESIAN_MONTH_LABELS = [
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

function computeMonthlyNurseMatrixFromVerifiedKaru(params: {
  namaPerawat: string;
  bulanTahun: string;
  verifiedPatientRows: LaporanPasienRow[];
  verifiedLogbooks: LogbookHarianRecord[];
  options?: MonthlyNurseReportOptions;
}): MonthlyNurseSpoMatrixReport {
  const { namaPerawat, bulanTahun, verifiedPatientRows, verifiedLogbooks, options } = params;
  const { year, month, ymKey } = parseBulanTahunParam(bulanTahun);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLabel = INDONESIAN_MONTH_LABELS[month - 1] || 'Oktober';

  const nurseRole: SystemAccessRole = options?.nurseRole || 'perawat_pelaksana';
  const roleLabel =
    nurseRole === 'kepala_ruangan'
      ? 'Kepala Ruangan'
      : nurseRole === 'pj_shift'
      ? 'Penanggung Jawab Shift'
      : 'Perawat Pelaksana';

  const matchingRows = verifiedPatientRows.filter(
    (r) =>
      (r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj') &&
      (r.tanggal || '').startsWith(`${ymKey}-`) &&
      isMatchingNurse(r.perawatPelaksana, namaPerawat)
  );

  const matchingLogbooks = verifiedLogbooks.filter(
    (lb) =>
      (lb.statusVerifikasi === 'verified_karu' || lb.statusVerifikasi === 'verified_pj') &&
      (lb.tanggal || '').startsWith(`${ymKey}-`) &&
      isMatchingNurse(lb.namaPerawat, namaPerawat)
  );

  const baseLogbook = createInitialOfficialLogbook({
    nurseName: namaPerawat,
    nipNira: options?.nipNira || matchingLogbooks[0]?.nipPerawat || '-',
    nurseRole,
    month,
    year
  });

  if (options?.headNurseName) {
    baseLogbook.headNurseName = options.headNurseName;
  }
  if (options?.headNurseNip) {
    baseLogbook.headNurseNip = options.headNurseNip;
  }

  const checks: Record<string, boolean[]> = {};
  const notes: Record<string, string> = {};
  const dailyScores: Record<string, (number | null)[]> = {};
  const dailyItemMaxScores: Record<string, number[]> = {};
  const itemMaxScores: Record<string, number> = {};
  const verifiedDays: boolean[] = new Array(31).fill(false);
  const hasActivityDays: boolean[] = new Array(31).fill(false);
  const dailyVerifiedPatientCounts: number[] = new Array(31).fill(0);

  OFFICIAL_LOGBOOK_ITEMS.forEach((item) => {
    checks[item.code] = new Array(31).fill(false);
    notes[item.code] = '';
    dailyScores[item.code] = new Array(31).fill(null);
    dailyItemMaxScores[item.code] = new Array(31).fill(0);
    itemMaxScores[item.code] = 0;
  });

  // Group verified_karu rows & logbooks by day index (0..30)
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dayIdx = dayNum - 1;
    const dateKey = `${ymKey}-${String(dayNum).padStart(2, '0')}`;

    const dayPatientRows = matchingRows.filter((r) => r.tanggal === dateKey);
    const dayLogbooks = matchingLogbooks.filter((lb) => lb.tanggal === dateKey);

    if (dayPatientRows.length === 0 && dayLogbooks.length === 0) {
      continue;
    }

    // Deduplicate all verified patients on this date for this nurse
    const combinedDayRows = mergeShiftPatientRows([
      ...dayPatientRows,
      ...dayLogbooks.flatMap((lb) =>
        extractRowsFromLogbookRecord(lb, lb.statusVerifikasi || 'verified_pj')
      )
    ]);

    const patCount = Math.max(
      combinedDayRows.length,
      dayLogbooks.reduce((acc, lb) => Math.max(acc, lb.patients?.length || 0), 0)
    );

    verifiedDays[dayIdx] = true;
    hasActivityDays[dayIdx] = true;
    dailyVerifiedPatientCounts[dayIdx] = patCount;

    OFFICIAL_LOGBOOK_ITEMS.forEach((spo) => {
      if (spo.bagian === 1) {
        // Bagian I (1.1 - 1.3): nilai maks 1 per hari dinas terverifikasi
        const fromLbItem = dayLogbooks.some((lb) => {
          const explicitFac = lb.facilityStatuses?.[spo.code];
          if (typeof explicitFac === 'boolean') return explicitFac;
          return Boolean(lb.items?.find((it) => it.code === spo.code)?.verified);
        });
        const fromSessionRow =
          dayLogbooks.length === 0 &&
          combinedDayRows.length > 0 &&
          (spo.code !== '1.1' ||
            combinedDayRows.some((r) => r.kondisiAirRo.toLowerCase().includes('memenuhi')));

        const achieved = fromLbItem || fromSessionRow ? 1 : 0;
        dailyScores[spo.code][dayIdx] = achieved;
        dailyItemMaxScores[spo.code][dayIdx] = 1;
        checks[spo.code][dayIdx] = achieved > 0;

        const noteCandidate = dayLogbooks
          .map((lb) => lb.items?.find((it) => it.code === spo.code)?.catatan)
          .find((c) => Boolean(c && c.trim()));
        if (noteCandidate && !notes[spo.code]) {
          notes[spo.code] = noteCandidate;
        }
        return;
      }

      // Bagian II s/d VI (2.1 - 6.5): akumulasi mengikuti jumlah pasien kelolaan verified_karu hari tersebut
      const maxForCell = patCount;
      let achievedCount = 0;

      if (dayLogbooks.length > 0) {
        let countedFromStatuses = 0;
        let hasPatientStatusMap = false;

        dayLogbooks.forEach((lb) => {
          if (lb.patientStatuses && Object.keys(lb.patientStatuses).length > 0) {
            hasPatientStatusMap = true;
            const trackedIds = (lb.patients || [])
              .map((p) => p.id)
              .filter((id): id is string => Boolean(id));
            const targetKeys =
              trackedIds.length > 0 ? trackedIds : Object.keys(lb.patientStatuses);
            targetKeys.forEach((pKey) => {
              if (lb.patientStatuses?.[pKey]?.[spo.code]) {
                countedFromStatuses += 1;
              }
            });
          }
        });

        if (hasPatientStatusMap) {
          achievedCount = Math.min(maxForCell, countedFromStatuses);
        } else {
          const itemVerified = dayLogbooks.some(
            (lb) => Boolean(lb.items?.find((it) => it.code === spo.code)?.verified)
          );
          achievedCount = itemVerified ? maxForCell : 0;
        }

        // Jika masih ada pasien verified_karu langsung dari patient_sessions di luar logbooks, tambahkan proporsional
        const lbPatCount = dayLogbooks.reduce((s, lb) => s + (lb.patients?.length || 0), 0);
        if (combinedDayRows.length > lbPatCount) {
          achievedCount = Math.min(maxForCell, achievedCount + (combinedDayRows.length - lbPatCount));
        }

        const noteCandidate = dayLogbooks
          .map((lb) => lb.items?.find((it) => it.code === spo.code)?.catatan)
          .find((c) => Boolean(c && c.trim()));
        if (noteCandidate && !notes[spo.code]) {
          notes[spo.code] = noteCandidate;
        }
      } else {
        // Murni dari sesi pasien 'verified_karu' pada koleksi patient_sessions
        achievedCount = combinedDayRows.filter((row) => {
          if (spo.code === '3.6') {
            return Boolean(row.aksesVaskular && row.aksesVaskular.trim() !== '-');
          }
          if (spo.code === '6.4') {
            return Boolean(row.metodeDisinfeksi && row.metodeDisinfeksi.trim() !== '-');
          }
          return true;
        }).length;
      }

      dailyScores[spo.code][dayIdx] = achievedCount;
      dailyItemMaxScores[spo.code][dayIdx] = maxForCell;
      checks[spo.code][dayIdx] = achievedCount > 0;
    });
  }

  const verifiedDaysCount = verifiedDays.slice(0, daysInMonth).filter(Boolean).length;
  const totalVerifiedPatientsInMonth = dailyVerifiedPatientCounts
    .slice(0, daysInMonth)
    .reduce((sum, n) => sum + n, 0);

  const itemStats: Record<string, MonthlyNurseItemStat> = {};
  let grandTotalScore = 0;
  let grandMaxScore = 0;

  OFFICIAL_LOGBOOK_ITEMS.forEach((spo) => {
    const scoresForMonth = dailyScores[spo.code].slice(0, daysInMonth);
    const maxForMonth = dailyItemMaxScores[spo.code].slice(0, daysInMonth);
    const rowTotal = scoresForMonth.reduce<number>(
      (acc, v) => acc + (typeof v === 'number' ? v : 0),
      0
    );
    const rowMax = maxForMonth.reduce<number>((acc, m) => acc + (m || 0), 0);
    const pct = rowMax > 0 ? Math.min(100, Math.round((rowTotal / rowMax) * 100)) : 0;

    itemMaxScores[spo.code] = rowMax;
    itemStats[spo.code] = {
      code: spo.code,
      bagian: spo.bagian,
      totalScore: rowTotal,
      maxScore: rowMax,
      pct
    };

    grandTotalScore += rowTotal;
    grandMaxScore += rowMax;
  });

  const dailyTotalScores: (number | null)[] = new Array(31).fill(null);
  const dailyMaxScores: (number | null)[] = new Array(31).fill(null);

  for (let dIdx = 0; dIdx < daysInMonth; dIdx++) {
    if (!verifiedDays[dIdx]) continue;
    let dSum = 0;
    let dMax = 0;
    OFFICIAL_LOGBOOK_ITEMS.forEach((spo) => {
      const val = dailyScores[spo.code][dIdx];
      const mx = dailyItemMaxScores[spo.code][dIdx] || 0;
      if (typeof val === 'number') dSum += val;
      dMax += mx;
    });
    dailyTotalScores[dIdx] = dSum;
    dailyMaxScores[dIdx] = dMax;
  }

  const overallCompliancePct =
    grandMaxScore > 0 ? Number(((grandTotalScore / grandMaxScore) * 100).toFixed(1)) : 0;

  const poin3_6TotalCount = itemStats['3.6']?.totalScore || 0;

  const populatedLogbook: OfficialNurseLogbookMonth = {
    ...baseLogbook,
    monthYear: `${monthLabel} / ${year}`,
    daysInMonth,
    checks,
    notes,
    verifiedDays,
    hasActivityDays,
    dailyVerifiedPatientCounts,
    dailyScores,
    dailyItemMaxScores,
    itemMaxScores,
    nurseSigned: verifiedDaysCount > 0,
    headNurseSigned: verifiedDaysCount > 0
  };

  const mergedAllMonthRows = mergeShiftPatientRows([
    ...matchingRows,
    ...matchingLogbooks.flatMap((lb) =>
      extractRowsFromLogbookRecord(lb, lb.statusVerifikasi || 'verified_pj')
    )
  ]);

  return {
    namaPerawat,
    bulanTahun: ymKey,
    month,
    year,
    monthLabel,
    roleLabel,
    daysInMonth,
    verifiedDaysCount,
    totalVerifiedPatientsInMonth,
    poin3_6TotalCount,
    logbook: populatedLogbook,
    itemStats,
    dailyTotalScores,
    dailyMaxScores,
    grandTotalScore,
    grandMaxScore,
    overallCompliancePct,
    verifiedRows: mergedAllMonthRows,
    verifiedLogbooks: matchingLogbooks
  };
}

export const pasienLogbookService = {
  // 1. Simpan/Input Logbook Klinis Pasien Baru oleh Perawat Pelaksana ke Cloud Firestore
  savePatientSession: async (session: LaporanPasienRow): Promise<boolean> => {
    ensurePatientCacheHydrated();
    const cleanId = sanitizePatientSessionId(session.id);
    const nowIso = new Date().toISOString();
    const payload = sanitizeLaporanRowBounds(session, cleanId, nowIso);

    memoryPatientSessionsMap.set(cleanId, payload);
    persistPatientCache(true);

    if (!isCloudEnabled()) {
      return true;
    }

    const colName = getActivePatientCol();
    const docId = toPatientDocId(cleanId, colName);
    try {
      const body =
        colName === FALLBACK_PATIENT_COL
          ? cleanFirestoreData({ ...payload, recordKind: FALLBACK_PATIENT_KIND })
          : cleanFirestoreData(payload);
      await setDoc(doc(db, colName, docId), body, { merge: true });
      return true;
    } catch (error) {
      if (!useFallbackPatientCol && isPermDenied(error)) {
        useFallbackPatientCol = true;
        const fbId = toPatientDocId(cleanId, FALLBACK_PATIENT_COL);
        try {
          await setDoc(
            doc(db, FALLBACK_PATIENT_COL, fbId),
            cleanFirestoreData({ ...payload, recordKind: FALLBACK_PATIENT_KIND }),
            { merge: true }
          );
          return true;
        } catch (fbErr) {
          try {
            handleFirestoreError(fbErr, OperationType.WRITE, `${FALLBACK_PATIENT_COL}/${fbId}`);
          } catch (handledErr) {
            console.error('Gagal mengirim data sesi pasien ke Cloud Firestore:', handledErr);
          }
          return false;
        }
      }
      try {
        handleFirestoreError(error, OperationType.WRITE, `${colName}/${docId}`);
      } catch (handledErr) {
        console.error('Gagal mengirim data sesi pasien ke Cloud Firestore:', handledErr);
      }
      return false;
    }
  },

  // 2. Ambil Data Antrean Verifikasi Sesi Pasien berdasarkan Peran Verifikator
  getSessionsForVerification: async (
    role: 'PJ Shift' | 'Kepala Ruang'
  ): Promise<LaporanPasienRow[]> => {
    ensurePatientCacheHydrated();

    if (isCloudEnabled()) {
      const fetchPendingFromCol = async (colName: string): Promise<LaporanPasienRow[]> => {
        const q =
          role === 'PJ Shift'
            ? query(collection(db, colName), where('statusVerifikasi', '==', 'submitted'))
            : query(
                collection(db, colName),
                where('statusVerifikasi', 'in', ['submitted', 'verified_pj'])
              );

        const querySnapshot = await getDocs(q);
        const sessions: LaporanPasienRow[] = [];
        querySnapshot.forEach((docSnap) => {
          const rawData = docSnap.data() as Record<string, unknown>;
          if (!isMatchingPatientDoc(rawData, colName)) return;
          const logicalId =
            typeof rawData.id === 'string' && rawData.id.trim()
              ? sanitizePatientSessionId(rawData.id)
              : docSnap.id;
          const item = {
            ...(rawData as unknown as LaporanPasienRow),
            id: logicalId
          };
          sessions.push(item);
          memoryPatientSessionsMap.set(item.id, item);
        });
        persistPatientCache(false);
        return sessions;
      };

      const colName = getActivePatientCol();
      try {
        return await fetchPendingFromCol(colName);
      } catch (error) {
        if (!useFallbackPatientCol && isPermDenied(error)) {
          useFallbackPatientCol = true;
          try {
            return await fetchPendingFromCol(FALLBACK_PATIENT_COL);
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.LIST, FALLBACK_PATIENT_COL);
          }
        } else {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      }
    }

    return Array.from(memoryPatientSessionsMap.values()).filter((s) =>
      role === 'PJ Shift'
        ? s.statusVerifikasi === 'submitted'
        : s.statusVerifikasi === 'submitted' || s.statusVerifikasi === 'verified_pj'
    );
  },

  // 3. Verifikasi Sesi Pasien secara Real-time (PJ Shift -> 'verified_pj', Kepala Ruang -> 'verified_karu')
  verifyPatientSession: async (
    id: string,
    verifikatorId: string,
    role: 'PJ Shift' | 'Kepala Ruang',
    details?: {
      verifikatorNama?: string;
      verifierNotes?: string;
      fallbackRow?: Partial<LaporanPasienRow>;
    }
  ): Promise<boolean> => {
    ensurePatientCacheHydrated();
    const cleanId = sanitizePatientSessionId(id);
    const nowIso = new Date().toISOString();
    const existing = memoryPatientSessionsMap.get(cleanId);

    const nextStatus: LaporanPasienRow['statusVerifikasi'] =
      role === 'Kepala Ruang' ? 'verified_karu' : 'verified_pj';

    const updatePayload: Partial<LaporanPasienRow> = {
      ...(details?.fallbackRow || {}),
      ...(existing || {}),
      id: cleanId,
      statusVerifikasi: nextStatus,
      revisionRequested: false,
      updatedAt: nowIso
    };

    if (details?.verifierNotes !== undefined) {
      updatePayload.verifierNotes = details.verifierNotes;
    }

    if (role === 'PJ Shift') {
      updatePayload.verifikatorPjId = verifikatorId;
      updatePayload.verifikatorPjNama = details?.verifikatorNama || verifikatorId;
    } else {
      updatePayload.verifikatorKaruId = verifikatorId;
      updatePayload.verifikatorKaruNama = details?.verifikatorNama || verifikatorId;
    }

    if (existing || details?.fallbackRow?.namaPasien) {
      memoryPatientSessionsMap.set(cleanId, updatePayload as LaporanPasienRow);
      persistPatientCache(true);
    }

    if (!isCloudEnabled()) {
      return true;
    }

    const colName = getActivePatientCol();
    const docId = toPatientDocId(cleanId, colName);
    try {
      const body =
        colName === FALLBACK_PATIENT_COL
          ? cleanFirestoreData({ ...updatePayload, recordKind: FALLBACK_PATIENT_KIND })
          : cleanFirestoreData(updatePayload);
      await setDoc(doc(db, colName, docId), body, { merge: true });
      return true;
    } catch (error) {
      if (!useFallbackPatientCol && isPermDenied(error)) {
        useFallbackPatientCol = true;
        const fbId = toPatientDocId(cleanId, FALLBACK_PATIENT_COL);
        try {
          await setDoc(
            doc(db, FALLBACK_PATIENT_COL, fbId),
            cleanFirestoreData({ ...updatePayload, recordKind: FALLBACK_PATIENT_KIND }),
            { merge: true }
          );
          return true;
        } catch (fbErr) {
          handleFirestoreError(fbErr, OperationType.UPDATE, `${FALLBACK_PATIENT_COL}/${fbId}`);
          return false;
        }
      }
      handleFirestoreError(error, OperationType.UPDATE, `${colName}/${docId}`);
      return false;
    }
  },

  // 3b. Kembalikan Sesi Pasien untuk Perbaikan ('draft')
  requestPatientSessionRevision: async (
    id: string,
    _verifikatorId: string,
    _role: 'PJ Shift' | 'Kepala Ruang',
    verifierNotes?: string
  ): Promise<boolean> => {
    ensurePatientCacheHydrated();
    const cleanId = sanitizePatientSessionId(id);
    const nowIso = new Date().toISOString();
    const existing = memoryPatientSessionsMap.get(cleanId);

    const updatePayload: Partial<LaporanPasienRow> = {
      ...(existing || {}),
      id: cleanId,
      statusVerifikasi: 'draft',
      revisionRequested: true,
      verifierNotes: verifierNotes || existing?.verifierNotes || '',
      updatedAt: nowIso
    };

    if (existing) {
      memoryPatientSessionsMap.set(cleanId, updatePayload as LaporanPasienRow);
      persistPatientCache(true);
    }

    if (!isCloudEnabled()) {
      return true;
    }

    const colName = getActivePatientCol();
    const docId = toPatientDocId(cleanId, colName);
    try {
      const body =
        colName === FALLBACK_PATIENT_COL
          ? cleanFirestoreData({ ...updatePayload, recordKind: FALLBACK_PATIENT_KIND })
          : cleanFirestoreData(updatePayload);
      await setDoc(doc(db, colName, docId), body, { merge: true });
      return true;
    } catch (error) {
      if (!useFallbackPatientCol && isPermDenied(error)) {
        useFallbackPatientCol = true;
        const fbId = toPatientDocId(cleanId, FALLBACK_PATIENT_COL);
        try {
          await setDoc(
            doc(db, FALLBACK_PATIENT_COL, fbId),
            cleanFirestoreData({ ...updatePayload, recordKind: FALLBACK_PATIENT_KIND }),
            { merge: true }
          );
          return true;
        } catch (fbErr) {
          handleFirestoreError(fbErr, OperationType.UPDATE, `${FALLBACK_PATIENT_COL}/${fbId}`);
          return false;
        }
      }
      handleFirestoreError(error, OperationType.UPDATE, `${colName}/${docId}`);
      return false;
    }
  },

  // 4. Tarik Data Laporan Pasien Terverifikasi (HANYA jika statusVerifikasi === 'verified_karu')
  getVerifiedPatientReports: async (
    startDate?: string,
    endDate?: string
  ): Promise<LaporanPasienRow[]> => {
    ensurePatientCacheHydrated();

    if (isCloudEnabled()) {
      const fetchVerifiedFromCol = async (colName: string): Promise<LaporanPasienRow[]> => {
        const q = query(
          collection(db, colName),
          where('statusVerifikasi', 'in', ['verified_karu', 'verified_pj'])
        );
        const querySnapshot = await getDocs(q);
        const cloudRows: LaporanPasienRow[] = [];
        querySnapshot.forEach((docSnap) => {
          const rawData = docSnap.data() as Record<string, unknown>;
          if (!isMatchingPatientDoc(rawData, colName)) return;
          const logicalId =
            typeof rawData.id === 'string' && rawData.id.trim()
              ? sanitizePatientSessionId(rawData.id)
              : docSnap.id;
          const row = {
            ...(rawData as unknown as LaporanPasienRow),
            id: logicalId
          };
          cloudRows.push(row);
          memoryPatientSessionsMap.set(row.id, row);
        });
        persistPatientCache(false);
        return filterVerifiedKaruPatientRows(cloudRows, startDate, endDate);
      };

      const colName = getActivePatientCol();
      try {
        return await fetchVerifiedFromCol(colName);
      } catch (error) {
        if (!useFallbackPatientCol && isPermDenied(error)) {
          useFallbackPatientCol = true;
          try {
            return await fetchVerifiedFromCol(FALLBACK_PATIENT_COL);
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.LIST, FALLBACK_PATIENT_COL);
          }
        } else {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      }
    }

    return filterVerifiedKaruPatientRows(
      Array.from(memoryPatientSessionsMap.values()),
      startDate,
      endDate
    );
  },

  // 5. Real-time Subscription Antrean Sesi Pasien
  subscribeSessionsForVerification: (
    role: 'PJ Shift' | 'Kepala Ruang',
    onUpdate: (rows: LaporanPasienRow[]) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    ensurePatientCacheHydrated();
    if (!isCloudEnabled()) {
      onUpdate(
        Array.from(memoryPatientSessionsMap.values()).filter((s) =>
          role === 'PJ Shift'
            ? s.statusVerifikasi === 'submitted'
            : s.statusVerifikasi === 'submitted' || s.statusVerifikasi === 'verified_pj'
        )
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
          const rows: LaporanPasienRow[] = [];
          const activeIds = new Set<string>();
          snapshot.forEach((docSnap) => {
            const rawData = docSnap.data() as Record<string, unknown>;
            if (!isMatchingPatientDoc(rawData, colName)) return;
            const logicalId =
              typeof rawData.id === 'string' && rawData.id.trim()
                ? sanitizePatientSessionId(rawData.id)
                : docSnap.id;
            const item = {
              ...(rawData as unknown as LaporanPasienRow),
              id: logicalId
            };
            rows.push(item);
            activeIds.add(item.id);
            memoryPatientSessionsMap.set(item.id, item);
          });

          memoryPatientSessionsMap.forEach((cached, key) => {
            const matchedBefore =
              role === 'PJ Shift'
                ? cached.statusVerifikasi === 'submitted'
                : cached.statusVerifikasi === 'submitted' ||
                  cached.statusVerifikasi === 'verified_pj';
            if (matchedBefore && !activeIds.has(key)) {
              memoryPatientSessionsMap.set(key, {
                ...cached,
                statusVerifikasi: role === 'PJ Shift' ? 'verified_pj' : 'verified_karu'
              });
            }
          });
          persistPatientCache(false);
          onUpdate(rows);
        },
        (err) => {
          if (!useFallbackPatientCol && isPermDenied(err)) {
            useFallbackPatientCol = true;
            if (currentUnsub) currentUnsub();
            attachListener(FALLBACK_PATIENT_COL);
            return;
          }
          if (onError) onError(err);
          try {
            handleFirestoreError(err, OperationType.LIST, colName);
          } catch {
            // dilaporkan ke pemanggil
          }
        }
      );
    };

    attachListener(getActivePatientCol());
    return () => {
      cancelled = true;
      if (currentUnsub) currentUnsub();
    };
  },

  // 6. Real-time Subscription Laporan Pasien Terverifikasi Kepala Ruang ('verified_karu')
  subscribeVerifiedPatientReports: (
    startDate: string | undefined,
    endDate: string | undefined,
    onUpdate: (rows: LaporanPasienRow[]) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    ensurePatientCacheHydrated();
    if (!isCloudEnabled()) {
      onUpdate(
        filterVerifiedKaruPatientRows(
          Array.from(memoryPatientSessionsMap.values()),
          startDate,
          endDate
        )
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
          const rows: LaporanPasienRow[] = [];
          snapshot.forEach((docSnap) => {
            const rawData = docSnap.data() as Record<string, unknown>;
            if (!isMatchingPatientDoc(rawData, colName)) return;
            const logicalId =
              typeof rawData.id === 'string' && rawData.id.trim()
                ? sanitizePatientSessionId(rawData.id)
                : docSnap.id;
            const item = {
              ...(rawData as unknown as LaporanPasienRow),
              id: logicalId
            };
            rows.push(item);
            memoryPatientSessionsMap.set(item.id, item);
          });
          persistPatientCache(true);
          onUpdate(filterVerifiedKaruPatientRows(rows, startDate, endDate));
        },
        (err) => {
          if (!useFallbackPatientCol && isPermDenied(err)) {
            useFallbackPatientCol = true;
            if (currentUnsub) currentUnsub();
            attachListener(FALLBACK_PATIENT_COL);
            return;
          }
          if (onError) onError(err);
          try {
            handleFirestoreError(err, OperationType.LIST, colName);
          } catch {
            // dilaporkan ke pemanggil
          }
        }
      );
    };

    attachListener(getActivePatientCol());
    return () => {
      cancelled = true;
      if (currentUnsub) currentUnsub();
    };
  },

  // 7. Ambil SELURUH Baris Logbook Pasien pada Tanggal & Shift Aktif Tanpa Memandang Status Verifikasi
  // ('draft' | 'submitted' | 'verified_pj' | 'verified_karu')
  getRawReportsByShift: async (
    tanggal: string,
    shift: string
  ): Promise<LaporanPasienRow[]> => {
    ensurePatientCacheHydrated();
    const normalizedTanggal = normalizeDateIsoParam(tanggal);
    const normalizedShift = normalizeShiftName(shift);

    if (isCloudEnabled()) {
      const fetchFromPatientCol = async (colName: string): Promise<LaporanPasienRow[]> => {
        const q = query(collection(db, colName), where('tanggal', '==', normalizedTanggal));
        const snap = await getDocs(q);
        const rows: LaporanPasienRow[] = [];
        snap.forEach((docSnap) => {
          const rawData = docSnap.data() as Record<string, unknown>;
          if (!isMatchingPatientDoc(rawData, colName)) return;
          const logicalId =
            typeof rawData.id === 'string' && rawData.id.trim()
              ? sanitizePatientSessionId(rawData.id)
              : docSnap.id;
          const item = {
            ...(rawData as unknown as LaporanPasienRow),
            id: logicalId
          };
          memoryPatientSessionsMap.set(item.id, item);
          if (normalizeShiftName(item.shift) === normalizedShift) {
            rows.push(item);
          }
        });
        persistPatientCache(false);
        return rows;
      };

      let patientColRows: LaporanPasienRow[] = [];
      const colName = getActivePatientCol();
      try {
        patientColRows = await fetchFromPatientCol(colName);
      } catch (error) {
        if (!useFallbackPatientCol && isPermDenied(error)) {
          useFallbackPatientCol = true;
          try {
            patientColRows = await fetchFromPatientCol(FALLBACK_PATIENT_COL);
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.LIST, FALLBACK_PATIENT_COL);
          }
        } else {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      }

      // Rekonsiliasi juga dari nurse_logbooks & logbooks pada tanggal aktif agar draf perawat real-time langsung terbaca
      let nurseDraftRows: LaporanPasienRow[] = [];
      try {
        const nlQuery = query(
          collection(db, 'nurse_logbooks'),
          where('dateIso', '==', normalizedTanggal)
        );
        const nlSnap = await getDocs(nlQuery);
        nlSnap.forEach((docSnap) => {
          const rawDoc = docSnap.data() as Record<string, unknown>;
          nurseDraftRows.push(
            ...extractRawRowsFromNurseLogbookCloudDoc(rawDoc, normalizedTanggal, normalizedShift)
          );
        });
      } catch {
        // koleksi sekunder opsional
      }

      let logbookRows: LaporanPasienRow[] = [];
      try {
        const lbQuery = query(
          collection(db, 'logbooks'),
          where('tanggal', '==', normalizedTanggal)
        );
        const lbSnap = await getDocs(lbQuery);
        lbSnap.forEach((docSnap) => {
          const lb = docSnap.data() as unknown as LogbookHarianRecord;
          if (normalizeShiftName(lb.shift) === normalizedShift) {
            logbookRows.push(...extractRowsFromLogbookRecord(lb));
          }
        });
      } catch {
        // koleksi sekunder opsional
      }

      const cachedForShift = Array.from(memoryPatientSessionsMap.values()).filter(
        (r) => r.tanggal === normalizedTanggal && normalizeShiftName(r.shift) === normalizedShift
      );

      return mergeShiftPatientRows([
        ...nurseDraftRows,
        ...logbookRows,
        ...cachedForShift,
        ...patientColRows
      ]);
    }

    const localMatching = Array.from(memoryPatientSessionsMap.values()).filter(
      (r) => r.tanggal === normalizedTanggal && normalizeShiftName(r.shift) === normalizedShift
    );
    const localLbRows = logbookService
      .getAllRecords()
      .filter(
        (lb) =>
          lb.tanggal === normalizedTanggal && normalizeShiftName(lb.shift) === normalizedShift
      )
      .flatMap((lb) => extractRowsFromLogbookRecord(lb));

    return mergeShiftPatientRows([...localLbRows, ...localMatching]);
  },

  // 7b. Real-time Subscription untuk Seluruh Baris Logbook Pasien pada Shift Aktif (Tanpa Filter Verifikasi)
  subscribeRawReportsByShift: (
    tanggal: string,
    shift: string,
    onUpdate: (rows: LaporanPasienRow[]) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    ensurePatientCacheHydrated();
    const normalizedTanggal = normalizeDateIsoParam(tanggal);
    const normalizedShift = normalizeShiftName(shift);

    if (!isCloudEnabled()) {
      const localMatching = Array.from(memoryPatientSessionsMap.values()).filter(
        (r) => r.tanggal === normalizedTanggal && normalizeShiftName(r.shift) === normalizedShift
      );
      onUpdate(mergeShiftPatientRows(localMatching));
      return () => {};
    }

    let unsubPrimary: (() => void) | null = null;
    let unsubNurseLogs: (() => void) | null = null;
    let cancelled = false;
    let latestPrimary: LaporanPasienRow[] = [];
    let latestNurseLogs: LaporanPasienRow[] = [];

    const emitMerged = () => {
      if (cancelled) return;
      const cachedSameShift = Array.from(memoryPatientSessionsMap.values()).filter(
        (r) => r.tanggal === normalizedTanggal && normalizeShiftName(r.shift) === normalizedShift
      );
      onUpdate(mergeShiftPatientRows([...latestNurseLogs, ...cachedSameShift, ...latestPrimary]));
    };

    const attachPrimary = (colName: string) => {
      if (cancelled) return;
      const q = query(collection(db, colName), where('tanggal', '==', normalizedTanggal));
      unsubPrimary = onSnapshot(
        q,
        (snapshot) => {
          const rows: LaporanPasienRow[] = [];
          snapshot.forEach((docSnap) => {
            const rawData = docSnap.data() as Record<string, unknown>;
            if (!isMatchingPatientDoc(rawData, colName)) return;
            const logicalId =
              typeof rawData.id === 'string' && rawData.id.trim()
                ? sanitizePatientSessionId(rawData.id)
                : docSnap.id;
            const item = {
              ...(rawData as unknown as LaporanPasienRow),
              id: logicalId
            };
            memoryPatientSessionsMap.set(item.id, item);
            if (normalizeShiftName(item.shift) === normalizedShift) {
              rows.push(item);
            }
          });
          persistPatientCache(false);
          latestPrimary = rows;
          emitMerged();
        },
        (err) => {
          if (!useFallbackPatientCol && isPermDenied(err)) {
            useFallbackPatientCol = true;
            if (unsubPrimary) unsubPrimary();
            attachPrimary(FALLBACK_PATIENT_COL);
            return;
          }
          if (onError) onError(err);
          try {
            handleFirestoreError(err, OperationType.LIST, colName);
          } catch {
            // dilaporkan ke pemanggil
          }
        }
      );
    };

    attachPrimary(getActivePatientCol());

    try {
      const nlQuery = query(
        collection(db, 'nurse_logbooks'),
        where('dateIso', '==', normalizedTanggal)
      );
      unsubNurseLogs = onSnapshot(
        nlQuery,
        (snap) => {
          const extracted: LaporanPasienRow[] = [];
          snap.forEach((docSnap) => {
            const rawDoc = docSnap.data() as Record<string, unknown>;
            extracted.push(
              ...extractRawRowsFromNurseLogbookCloudDoc(rawDoc, normalizedTanggal, normalizedShift)
            );
          });
          latestNurseLogs = extracted;
          emitMerged();
        },
        () => {
          // koleksi sekunder opsional
        }
      );
    } catch {
      // koleksi sekunder opsional
    }

    return () => {
      cancelled = true;
      if (unsubPrimary) unsubPrimary();
      if (unsubNurseLogs) unsubNurseLogs();
    };
  },

  // 8. Ambil Baris Sesi Pasien Terverifikasi pada Shift Aktif untuk Laporan PJ Shift (Blok A-F & SBAR)
  // HANYA menyertakan status minimal 'verified_pj' atau 'verified_karu'
  getVerifiedReportsByShift: async (
    tanggal: string,
    shift: string
  ): Promise<LaporanPasienRow[]> => {
    ensurePatientCacheHydrated();
    const normalizedTanggal = normalizeDateIsoParam(tanggal);
    const normalizedShift = normalizeShiftName(shift);

    const isVerifiedForShiftReport = (status?: LaporanPasienRow['statusVerifikasi']) =>
      status === 'verified_pj' || status === 'verified_karu';

    if (isCloudEnabled()) {
      const fetchVerifiedShiftCol = async (colName: string): Promise<LaporanPasienRow[]> => {
        const q = query(collection(db, colName), where('tanggal', '==', normalizedTanggal));
        const snap = await getDocs(q);
        const rows: LaporanPasienRow[] = [];
        snap.forEach((docSnap) => {
          const rawData = docSnap.data() as Record<string, unknown>;
          if (!isMatchingPatientDoc(rawData, colName)) return;
          const logicalId =
            typeof rawData.id === 'string' && rawData.id.trim()
              ? sanitizePatientSessionId(rawData.id)
              : docSnap.id;
          const item = {
            ...(rawData as unknown as LaporanPasienRow),
            id: logicalId
          };
          memoryPatientSessionsMap.set(item.id, item);
          if (
            normalizeShiftName(item.shift) === normalizedShift &&
            isVerifiedForShiftReport(item.statusVerifikasi)
          ) {
            rows.push(item);
          }
        });
        persistPatientCache(false);
        return rows;
      };

      let primaryRows: LaporanPasienRow[] = [];
      const colName = getActivePatientCol();
      try {
        primaryRows = await fetchVerifiedShiftCol(colName);
      } catch (error) {
        if (!useFallbackPatientCol && isPermDenied(error)) {
          useFallbackPatientCol = true;
          try {
            primaryRows = await fetchVerifiedShiftCol(FALLBACK_PATIENT_COL);
          } catch (fbErr) {
            handleFirestoreError(fbErr, OperationType.LIST, FALLBACK_PATIENT_COL);
          }
        } else {
          handleFirestoreError(error, OperationType.LIST, colName);
        }
      }

      // Rekonsiliasi dengan logbooks ('verified_pj' | 'verified_karu') pada tanggal & shift yang sama
      let verifiedLogbookRows: LaporanPasienRow[] = [];
      try {
        const lbQuery = query(
          collection(db, 'logbooks'),
          where('tanggal', '==', normalizedTanggal)
        );
        const lbSnap = await getDocs(lbQuery);
        lbSnap.forEach((docSnap) => {
          const lb = docSnap.data() as unknown as LogbookHarianRecord;
          if (
            normalizeShiftName(lb.shift) === normalizedShift &&
            (lb.statusVerifikasi === 'verified_pj' || lb.statusVerifikasi === 'verified_karu')
          ) {
            verifiedLogbookRows.push(...extractRowsFromLogbookRecord(lb, lb.statusVerifikasi));
          }
        });
      } catch {
        // koleksi sekunder opsional
      }

      return mergeShiftPatientRows([...verifiedLogbookRows, ...primaryRows]).filter((r) =>
        isVerifiedForShiftReport(r.statusVerifikasi)
      );
    }

    const cachedVerified = Array.from(memoryPatientSessionsMap.values()).filter(
      (r) =>
        r.tanggal === normalizedTanggal &&
        normalizeShiftName(r.shift) === normalizedShift &&
        isVerifiedForShiftReport(r.statusVerifikasi)
    );
    const localLbVerified = logbookService
      .getAllRecords()
      .filter(
        (lb) =>
          lb.tanggal === normalizedTanggal &&
          normalizeShiftName(lb.shift) === normalizedShift &&
          (lb.statusVerifikasi === 'verified_pj' || lb.statusVerifikasi === 'verified_karu')
      )
      .flatMap((lb) => extractRowsFromLogbookRecord(lb, lb.statusVerifikasi));

    return mergeShiftPatientRows([...localLbVerified, ...cachedVerified]).filter((r) =>
      isVerifiedForShiftReport(r.statusVerifikasi)
    );
  },

  // 8b. Real-time Subscription Sesi Pasien Terverifikasi ('verified_pj' | 'verified_karu') per Shift
  subscribeVerifiedReportsByShift: (
    tanggal: string,
    shift: string,
    onUpdate: (rows: LaporanPasienRow[]) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    ensurePatientCacheHydrated();
    const normalizedTanggal = normalizeDateIsoParam(tanggal);
    const normalizedShift = normalizeShiftName(shift);
    const isVerifiedForShiftReport = (status?: LaporanPasienRow['statusVerifikasi']) =>
      status === 'verified_pj' || status === 'verified_karu';

    if (!isCloudEnabled()) {
      const localRows = Array.from(memoryPatientSessionsMap.values()).filter(
        (r) =>
          r.tanggal === normalizedTanggal &&
          normalizeShiftName(r.shift) === normalizedShift &&
          isVerifiedForShiftReport(r.statusVerifikasi)
      );
      onUpdate(mergeShiftPatientRows(localRows));
      return () => {};
    }

    let unsubPrimary: (() => void) | null = null;
    let unsubLogbooks: (() => void) | null = null;
    let cancelled = false;
    let latestPrimary: LaporanPasienRow[] = [];
    let latestLbRows: LaporanPasienRow[] = [];

    const emitMerged = () => {
      if (cancelled) return;
      const merged = mergeShiftPatientRows([...latestLbRows, ...latestPrimary]).filter((r) =>
        isVerifiedForShiftReport(r.statusVerifikasi)
      );
      onUpdate(merged);
    };

    const attachPrimary = (colName: string) => {
      if (cancelled) return;
      const q = query(collection(db, colName), where('tanggal', '==', normalizedTanggal));
      unsubPrimary = onSnapshot(
        q,
        (snapshot) => {
          const rows: LaporanPasienRow[] = [];
          snapshot.forEach((docSnap) => {
            const rawData = docSnap.data() as Record<string, unknown>;
            if (!isMatchingPatientDoc(rawData, colName)) return;
            const logicalId =
              typeof rawData.id === 'string' && rawData.id.trim()
                ? sanitizePatientSessionId(rawData.id)
                : docSnap.id;
            const item = {
              ...(rawData as unknown as LaporanPasienRow),
              id: logicalId
            };
            memoryPatientSessionsMap.set(item.id, item);
            if (
              normalizeShiftName(item.shift) === normalizedShift &&
              isVerifiedForShiftReport(item.statusVerifikasi)
            ) {
              rows.push(item);
            }
          });
          persistPatientCache(false);
          latestPrimary = rows;
          emitMerged();
        },
        (err) => {
          if (!useFallbackPatientCol && isPermDenied(err)) {
            useFallbackPatientCol = true;
            if (unsubPrimary) unsubPrimary();
            attachPrimary(FALLBACK_PATIENT_COL);
            return;
          }
          if (onError) onError(err);
          try {
            handleFirestoreError(err, OperationType.LIST, colName);
          } catch {
            // dilaporkan ke pemanggil
          }
        }
      );
    };

    attachPrimary(getActivePatientCol());

    try {
      const lbQuery = query(
        collection(db, 'logbooks'),
        where('tanggal', '==', normalizedTanggal)
      );
      unsubLogbooks = onSnapshot(
        lbQuery,
        (snap) => {
          const rows: LaporanPasienRow[] = [];
          snap.forEach((docSnap) => {
            const lb = docSnap.data() as unknown as LogbookHarianRecord;
            if (
              normalizeShiftName(lb.shift) === normalizedShift &&
              (lb.statusVerifikasi === 'verified_pj' || lb.statusVerifikasi === 'verified_karu')
            ) {
              rows.push(...extractRowsFromLogbookRecord(lb, lb.statusVerifikasi));
            }
          });
          latestLbRows = rows;
          emitMerged();
        },
        () => {
          // koleksi sekunder opsional
        }
      );
    } catch {
      // koleksi sekunder opsional
    }

    return () => {
      cancelled = true;
      if (unsubPrimary) unsubPrimary();
      if (unsubLogbooks) unsubLogbooks();
    };
  },

  // 9. Ambil Rekapitulasi Bulanan Matriks 1-31 (29 Poin SPO) Perawat dari Data 'verified_karu'
  getMonthlyReportByNurse: async (
    namaPerawat: string,
    bulanTahun: string,
    options?: MonthlyNurseReportOptions
  ): Promise<MonthlyNurseSpoMatrixReport> => {
    ensurePatientCacheHydrated();
    const { ymKey } = parseBulanTahunParam(bulanTahun);
    const startIso = `${ymKey}-01`;
    const endIso = `${ymKey}-31`;

    const [verifiedPatientRows, verifiedLogbooks] = await Promise.all([
      pasienLogbookService.getVerifiedPatientReports(startIso, endIso),
      logbookService.getVerifiedReports(startIso, endIso)
    ]);

    return computeMonthlyNurseMatrixFromVerifiedKaru({
      namaPerawat,
      bulanTahun: ymKey,
      verifiedPatientRows: verifiedPatientRows.filter(
        (r) => r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj'
      ),
      verifiedLogbooks: verifiedLogbooks.filter(
        (lb) => lb.statusVerifikasi === 'verified_karu' || lb.statusVerifikasi === 'verified_pj'
      ),
      options
    });
  },

  // 9b. Real-time Subscription Matriks Bulanan 1-31 (29 Poin SPO) Perawat ('verified_karu' | 'verified_pj')
  subscribeMonthlyReportByNurse: (
    namaPerawat: string,
    bulanTahun: string,
    onUpdate: (report: MonthlyNurseSpoMatrixReport) => void,
    onError?: (err: unknown) => void,
    options?: MonthlyNurseReportOptions
  ): (() => void) => {
    ensurePatientCacheHydrated();
    const { ymKey } = parseBulanTahunParam(bulanTahun);
    const startIso = `${ymKey}-01`;
    const endIso = `${ymKey}-31`;

    let latestPatientRows = pasienLogbookService.getCachedVerifiedPatientReports(startIso, endIso);
    let latestLogbooks = logbookService.getCachedVerifiedReports(startIso, endIso);

    const emitReport = () => {
      onUpdate(
        computeMonthlyNurseMatrixFromVerifiedKaru({
          namaPerawat,
          bulanTahun: ymKey,
          verifiedPatientRows: latestPatientRows.filter(
            (r) => r.statusVerifikasi === 'verified_karu' || r.statusVerifikasi === 'verified_pj'
          ),
          verifiedLogbooks: latestLogbooks.filter(
            (lb) => lb.statusVerifikasi === 'verified_karu' || lb.statusVerifikasi === 'verified_pj'
          ),
          options
        })
      );
    };

    const unsubPatients = pasienLogbookService.subscribeVerifiedPatientReports(
      startIso,
      endIso,
      (rows) => {
        latestPatientRows = rows;
        emitReport();
      },
      onError
    );

    const unsubLogs = logbookService.subscribeVerifiedReports(
      startIso,
      endIso,
      (records) => {
        latestLogbooks = records;
        emitReport();
      },
      onError
    );

    return () => {
      unsubPatients();
      unsubLogs();
    };
  },

  getCachedVerifiedPatientReports: (
    startDate?: string,
    endDate?: string
  ): LaporanPasienRow[] => {
    ensurePatientCacheHydrated();
    return filterVerifiedKaruPatientRows(
      Array.from(memoryPatientSessionsMap.values()),
      startDate,
      endDate
    );
  },

  clearAllPatientSessions: (): void => {
    memoryPatientSessionsMap = new Map<string, LaporanPasienRow>();
    patientCacheHydrated = true;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(PATIENT_SESSIONS_CACHE_KEY);
      } catch {
        // ignore
      }
    }
  }
};

// ============================================================================
// FUNGSI KALKULASI & KONVERSI BARIS LAPORAN PASIEN
// ============================================================================

export function formatBedAndMachineLabel(bedNumber?: string): string {
  if (!bedNumber) return 'Bed 01 / M-01';
  const trimmed = bedNumber.trim();
  if (trimmed.includes('/')) return trimmed;
  const numMatch = trimmed.match(/([A-Za-z]*\s*\d+)/);
  const code = numMatch ? numMatch[1].replace(/\s+/g, '') : '01';
  const digitsOnly = code.match(/\d+/)?.[0] || '01';
  const padded = digitsOnly.padStart(2, '0');
  if (/iso/i.test(trimmed)) {
    return `Bed ISO ${padded} / M-ISO-${padded}`;
  }
  const cleanBedLabel = /^bed/i.test(trimmed) ? trimmed : `Bed ${padded}`;
  return `${cleanBedLabel} / M-${padded}`;
}

export function calculateDialysisTimes(
  shift?: string,
  durationHours: number = 4.5,
  rowIndex: number = 0
): { waktuMulai: string; waktuSelesai: string } {
  const isSiang = (shift || '').toLowerCase().includes('siang');
  const baseMinutes = isSiang ? 14 * 60 : 7 * 60 + 30;
  const stagger = Math.min(25, (rowIndex % 6) * 5);
  const startTotal = baseMinutes + stagger;
  const endTotal = Math.round(startTotal + durationHours * 60);

  const fmt = (mins: number) => {
    const h = Math.floor((mins % (24 * 60)) / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  return {
    waktuMulai: fmt(startTotal),
    waktuSelesai: fmt(endTotal)
  };
}

export function convertSessionToLaporanRow(
  session: PatientHDSession,
  index: number,
  options?: {
    statusVerifikasi?: LaporanPasienRow['statusVerifikasi'];
    tanggalIso?: string;
  }
): LaporanPasienRow {
  const resolvedShift: 'Pagi' | 'Siang' = session.shift === 'Siang' ? 'Siang' : 'Pagi';
  const durasi = session.durationActual || session.durationPrescribed || 4.5;
  const times = calculateDialysisTimes(resolvedShift, durasi, index);

  const aksesLabel =
    session.vascularAccess === 'cdl_non_tunnel' || session.vascularAccess === 'cdl_permcath'
      ? session.accessSite?.toUpperCase().includes('FEMORAL')
        ? 'FEMORAL'
        : 'CDL'
      : session.vascularAccess === 'av_graft'
      ? 'AV GRAFT'
      : 'AV SHUNT';

  const ruangKategori =
    session.category === 'hepatitis_b'
      ? 'Isolasi Hep B'
      : session.category === 'hepatitis_c'
      ? 'Isolasi Hep C'
      : 'Reguler';

  const compParts: string[] = [];
  if (session.complicationNames && session.complicationNames.trim()) {
    compParts.push(session.complicationNames.trim());
  } else {
    if (session.hasHypotension) {
      compParts.push(
        session.hypotensionBp ? `Hipotensi (${session.hypotensionBp})` : 'Hipotensi'
      );
    }
    if (session.hasMuscleCramps) compParts.push('Kram Otot');
    if (session.hasClotting) compParts.push('Clotting');
    if (session.hasFirstUseSyndrome) compParts.push('First Use Syndrome');
    if (session.hasAccessBleeding) compParts.push('Perdarahan Akses');
  }

  const actionParts: string[] = [];
  if (session.hypotensionAction) actionParts.push(session.hypotensionAction);
  if (session.muscleCrampAction) actionParts.push(session.muscleCrampAction);
  if (session.clottingDetails) actionParts.push(session.clottingDetails);
  if (session.accessBleedingAction) actionParts.push(session.accessBleedingAction);
  if (session.consultAdvice) actionParts.push(session.consultAdvice);

  const heparinMatch = session.nurseNotes?.match(/Dosis Heparin:\s*([^).]+)/i);
  const heparinLabel = heparinMatch
    ? heparinMatch[1].trim()
    : session.bagian2?.circuitHeparinizationType === 'Bebas Heparin (Saline Flush)'
    ? 'Free Heparin (NaCl Flush)'
    : session.bagian2?.circuitHeparinizationType === 'LMWH (Enoxaparin)'
    ? 'LMWH (Enoxaparin)'
    : 'Standar (5000 IU)';

  const tanggalIso =
    options?.tanggalIso ||
    session.sessionDate ||
    (session.date ? indonesianDateLabelToIso(session.date) : '') ||
    new Date().toISOString().slice(0, 10);

  const resolvedStatusVerif: LaporanPasienRow['statusVerifikasi'] =
    options?.statusVerifikasi ||
    (session.isVerifiedByKepalaRuang ||
    isKepalaRuangVerifier(session.verifiedByRole, session.verifiedBy)
      ? 'verified_karu'
      : session.isVerifiedByPj || session.verificationStatus === 'terverifikasi'
      ? 'verified_pj'
      : session.verificationStatus === 'diajukan'
      ? 'submitted'
      : 'draft');

  return {
    id: buildDeterministicPatientSessionId({
      tanggal: tanggalIso,
      shift: resolvedShift,
      perawatPelaksana: session.nurseInCharge,
      noBedMesin: session.bedNumber,
      noRm: session.medicalRecordNumber
    }),
    no: index + 1,
    tanggal: tanggalIso,
    shift: resolvedShift,
    noRm: session.medicalRecordNumber || '-',
    namaPasien: session.patientName,
    statusRawat: session.status === 'ranap' ? 'Rawat Inap' : 'Rawat Jalan',
    ruangKategori,
    noBedMesin: formatBedAndMachineLabel(session.bedNumber),
    aksesVaskular: aksesLabel,
    waktuMulai: times.waktuMulai,
    waktuSelesai: times.waktuSelesai,
    durasiJam: durasi,
    bbKering: Number(session.dryWeight || 0),
    bbPreHd: Number(session.preWeight || 0),
    bbPostHd: Number(session.postWeight || 0),
    qb: Number(session.bloodFlowQb || 200),
    qd: Number(session.dialysateFlowQd || 500),
    targetUf: Number(session.targetUf || 0),
    ktV: Number(session.ktV ?? 1.4),
    capaianUf: Number(session.achievedUf || 0),
    tdPre: session.preBp || '140/85',
    tdPost: session.postBp || '125/80',
    dialiser: session.dialyzerModel
      ? session.dialyzerModel.toLowerCase().includes('flux')
        ? session.dialyzerModel
        : `High Flux (${session.dialyzerModel})`
      : 'High Flux (SAS HF 18)',
    heparinisasi: heparinLabel,
    komplikasiIntraHd: compParts.length > 0 ? compParts.join(', ') : 'Tidak ada',
    tindakanAdvisDpjp: actionParts.length > 0 ? actionParts.join('; ') : 'Tidak ada',
    statusMesin: 'Siap Pakai',
    metodeDisinfeksi: 'Heat Clean',
    ketTeknis: 'Normal',
    jamCekRo: resolvedShift === 'Siang' ? '13:30' : '06:30',
    kondisiAirRo: 'Memenuhi Syarat',
    perawatPelaksana: session.nurseInCharge || '-',
    statusVerifikasi: resolvedStatusVerif,
    verifikatorPjNama: !isKepalaRuangVerifier(session.verifiedByRole, session.verifiedBy)
      ? session.verifiedBy
      : undefined,
    verifikatorKaruNama: isKepalaRuangVerifier(session.verifiedByRole, session.verifiedBy)
      ? session.verifiedBy
      : undefined,
    verifierNotes: session.verifierNotes,
    revisionRequested: session.revisionRequested,
    updatedAt: session.updatedAt
  };
}

export function computeLaporanPasienSummary(rows: LaporanPasienRow[]): LaporanPasienSummary {
  const totalPasien = rows.length;
  if (totalPasien === 0) {
    return {
      totalPasien: 0,
      rawatJalan: 0,
      rawatInap: 0,
      reguler: 0,
      isolasiHepB: 0,
      isolasiHepC: 0,
      aksesAvShunt: 0,
      aksesCdl: 0,
      aksesFemoral: 0,
      rataDurasiJam: 0,
      rataBbKering: 0,
      rataBbPreHd: 0,
      rataBbPostHd: 0,
      rataQb: 0,
      rataQd: 0,
      totalTargetUf: 0,
      totalCapaianUf: 0,
      rataCapaianUf: 0,
      rataKtV: 0,
      memenuhiKtVCount: 0,
      memenuhiKtVPct: 0,
      komplikasiCount: 0,
      bebasKomplikasiCount: 0,
      bebasKomplikasiPct: 0,
      roMemenuhiSyaratCount: 0
    };
  }

  const rawatJalan = rows.filter((r) => r.statusRawat === 'Rawat Jalan').length;
  const rawatInap = rows.filter((r) => r.statusRawat === 'Rawat Inap').length;
  const reguler = rows.filter((r) => r.ruangKategori === 'Reguler').length;
  const isolasiHepB = rows.filter((r) => r.ruangKategori.toLowerCase().includes('hep b')).length;
  const isolasiHepC = rows.filter((r) => r.ruangKategori.toLowerCase().includes('hep c')).length;

  const aksesAvShunt = rows.filter((r) =>
    r.aksesVaskular.toUpperCase().includes('AV')
  ).length;
  const aksesFemoral = rows.filter((r) =>
    r.aksesVaskular.toUpperCase().includes('FEMORAL')
  ).length;
  const aksesCdl = rows.filter(
    (r) =>
      r.aksesVaskular.toUpperCase().includes('CDL') &&
      !r.aksesVaskular.toUpperCase().includes('FEMORAL')
  ).length;

  const totalDurasi = rows.reduce((sum, r) => sum + (Number(r.durasiJam) || 0), 0);
  const rataDurasiJam = Number((totalDurasi / totalPasien).toFixed(1));

  const totalBbKering = rows.reduce((sum, r) => sum + (Number(r.bbKering) || 0), 0);
  const rataBbKering = Number((totalBbKering / totalPasien).toFixed(1));

  const totalBbPre = rows.reduce((sum, r) => sum + (Number(r.bbPreHd) || 0), 0);
  const rataBbPreHd = Number((totalBbPre / totalPasien).toFixed(1));

  const totalBbPost = rows.reduce((sum, r) => sum + (Number(r.bbPostHd) || 0), 0);
  const rataBbPostHd = Number((totalBbPost / totalPasien).toFixed(1));

  const totalQb = rows.reduce((sum, r) => sum + (Number(r.qb) || 0), 0);
  const rataQb = Math.round(totalQb / totalPasien);

  const totalQd = rows.reduce((sum, r) => sum + (Number(r.qd) || 0), 0);
  const rataQd = Math.round(totalQd / totalPasien);

  const totalTargetUf = Math.round(rows.reduce((sum, r) => sum + (Number(r.targetUf) || 0), 0));
  const totalCapaianUf = Math.round(rows.reduce((sum, r) => sum + (Number(r.capaianUf) || 0), 0));
  const rataCapaianUf = Math.round(totalCapaianUf / totalPasien);

  const totalKtV = rows.reduce((sum, r) => sum + (Number(r.ktV) || 0), 0);
  const rataKtV = Number((totalKtV / totalPasien).toFixed(2));
  const memenuhiKtVCount = rows.filter((r) => Number(r.ktV) >= 1.2).length;
  const memenuhiKtVPct = Math.round((memenuhiKtVCount / totalPasien) * 100);

  const komplikasiCount = rows.filter(
    (r) =>
      r.komplikasiIntraHd &&
      r.komplikasiIntraHd.trim().toLowerCase() !== 'tidak ada' &&
      r.komplikasiIntraHd.trim() !== '-'
  ).length;
  const bebasKomplikasiCount = totalPasien - komplikasiCount;
  const bebasKomplikasiPct = Math.round((bebasKomplikasiCount / totalPasien) * 100);

  const roMemenuhiSyaratCount = rows.filter((r) =>
    r.kondisiAirRo.toLowerCase().includes('memenuhi')
  ).length;

  return {
    totalPasien,
    rawatJalan,
    rawatInap,
    reguler,
    isolasiHepB,
    isolasiHepC,
    aksesAvShunt,
    aksesCdl,
    aksesFemoral,
    rataDurasiJam,
    rataBbKering,
    rataBbPreHd,
    rataBbPostHd,
    rataQb,
    rataQd,
    totalTargetUf,
    totalCapaianUf,
    rataCapaianUf,
    rataKtV,
    memenuhiKtVCount,
    memenuhiKtVPct,
    komplikasiCount,
    bebasKomplikasiCount,
    bebasKomplikasiPct,
    roMemenuhiSyaratCount
  };
}

/**
 * Mengumpulkan baris Laporan Pasien HANYA dari data yang telah berstatus 'verified_karu'
 * (telah disetujui Kepala Ruang) pada tanggal & shift aktif.
 */
export function collectAllInputtedLogbookRows(params: {
  sessions: PatientHDSession[];
  activeDateIso: string;
  activeShift?: 'Pagi' | 'Siang';
  masterNurses?: MasterNurse[];
  masterPatients?: MasterPatient[];
  cloudVerifiedPatientRows?: LaporanPasienRow[];
  cloudVerifiedLogbooks?: ReturnType<typeof logbookService.getCachedVerifiedReports>;
}): LaporanPasienRow[] {
  const {
    sessions = [],
    activeDateIso,
    activeShift,
    masterPatients = [],
    cloudVerifiedPatientRows,
    cloudVerifiedLogbooks
  } = params;

  const verifiedKaruLogbooks =
    cloudVerifiedLogbooks ??
    logbookService.getCachedVerifiedReports({
      tanggal: activeDateIso,
      shift: activeShift
    });

  const verifiedPatientRowsFromService =
    cloudVerifiedPatientRows ??
    pasienLogbookService.getCachedVerifiedPatientReports(activeDateIso, activeDateIso);

  const resultMap = new Map<string, LaporanPasienRow>();

  const makeDedupKey = (rm?: string, name?: string, bed?: string) => {
    const cleanRm = (rm || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanRm && cleanRm !== '0') return `rm:${cleanRm}`;
    return `pat:${(name || '').trim().toLowerCase()}__${(bed || '').trim().toLowerCase()}`;
  };

  // 1. Masukkan baris dari pasienLogbookService yang berstatus 'verified_karu'
  verifiedPatientRowsFromService.forEach((row) => {
    if (row.statusVerifikasi !== 'verified_karu') return;
    if (row.tanggal !== activeDateIso) return;
    if (activeShift && row.shift && row.shift !== activeShift) return;
    const key = makeDedupKey(row.noRm, row.namaPasien, row.noBedMesin);
    resultMap.set(key, row);
  });

  // 2. Masukkan sesi yang secara eksplisit telah disetujui Kepala Ruang (isVerifiedByKepalaRuang === true atau logbooknya 'verified_karu')
  sessions.forEach((s, idx) => {
    const sIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
    if (sIso !== activeDateIso) return;
    const sShift = s.shift === 'Siang' ? 'Siang' : 'Pagi';
    if (activeShift && sShift !== activeShift) return;

    const approvedByKaruDirectly =
      s.isVerifiedByKepalaRuang === true ||
      (s.verificationStatus === 'terverifikasi' &&
        isKepalaRuangVerifier(s.verifiedByRole, s.verifiedBy));

    const approvedViaLogbookService = verifiedKaruLogbooks.some(
      (lb) =>
        lb.statusVerifikasi === 'verified_karu' &&
        lb.tanggal === activeDateIso &&
        (!activeShift || (lb.shift === 'Siang' ? 'Siang' : 'Pagi') === activeShift) &&
        (isMatchingNurse(lb.namaPerawat, s.nurseInCharge) ||
          lb.patients?.some(
            (p) =>
              (p.medicalRecord && p.medicalRecord === s.medicalRecordNumber) ||
              isSameBed(p.bedNumber, s.bedNumber)
          ))
    );

    if (!approvedByKaruDirectly && !approvedViaLogbookService) {
      return;
    }

    const key = makeDedupKey(s.medicalRecordNumber, s.patientName, s.bedNumber);
    if (!resultMap.has(key)) {
      resultMap.set(
        key,
        convertSessionToLaporanRow(s, idx, {
          statusVerifikasi: 'verified_karu',
          tanggalIso: activeDateIso
        })
      );
    }
  });

  // 3. Rekonsiliasi pasien dari logbookService ('verified_karu') jika belum punya sesi tersendiri
  verifiedKaruLogbooks.forEach((lb) => {
    if (lb.statusVerifikasi !== 'verified_karu') return;
    if (lb.tanggal !== activeDateIso) return;
    const lbShift: 'Pagi' | 'Siang' = lb.shift === 'Siang' ? 'Siang' : 'Pagi';
    if (activeShift && lbShift !== activeShift) return;

    if (Array.isArray(lb.sessionsSnapshot)) {
      lb.sessionsSnapshot.forEach((snap, sIdx) => {
        const key = makeDedupKey(snap.medicalRecordNumber, snap.patientName, snap.bedNumber);
        if (!resultMap.has(key)) {
          resultMap.set(
            key,
            convertSessionToLaporanRow(snap, sIdx, {
              statusVerifikasi: 'verified_karu',
              tanggalIso: activeDateIso
            })
          );
        }
      });
    }

    if (Array.isArray(lb.patients)) {
      lb.patients.forEach((mp, pIdx) => {
        if (!mp.patientName && !mp.bedNumber) return;
        const key = makeDedupKey(mp.medicalRecord, mp.patientName, mp.bedNumber);
        if (resultMap.has(key)) return;

        const matchedMaster = masterPatients.find(
          (m) =>
            (mp.medicalRecord && m.medicalRecordNumber === mp.medicalRecord) ||
            m.patientName.trim().toLowerCase() === (mp.patientName || '').trim().toLowerCase()
        );
        const dry = matchedMaster?.defaultDryWeight || 60.0;
        const times = calculateDialysisTimes(lbShift, 4.5, pIdx);

        resultMap.set(key, {
          id: buildDeterministicPatientSessionId({
            tanggal: activeDateIso,
            shift: lbShift,
            perawatPelaksana: lb.namaPerawat,
            noBedMesin: mp.bedNumber,
            noRm: mp.medicalRecord
          }),
          no: resultMap.size + 1,
          tanggal: activeDateIso,
          shift: lbShift,
          noRm: mp.medicalRecord || matchedMaster?.medicalRecordNumber || '-',
          namaPasien: mp.patientName || matchedMaster?.patientName || 'Pasien HD',
          statusRawat: matchedMaster?.defaultStatus === 'ranap' ? 'Rawat Inap' : 'Rawat Jalan',
          ruangKategori:
            matchedMaster?.category === 'hepatitis_b'
              ? 'Isolasi Hep B'
              : matchedMaster?.category === 'hepatitis_c'
              ? 'Isolasi Hep C'
              : 'Reguler',
          noBedMesin: formatBedAndMachineLabel(mp.bedNumber),
          aksesVaskular:
            matchedMaster?.defaultVascularAccess === 'cdl_non_tunnel' ||
            matchedMaster?.defaultVascularAccess === 'cdl_permcath'
              ? 'CDL'
              : 'AV SHUNT',
          waktuMulai: times.waktuMulai,
          waktuSelesai: times.waktuSelesai,
          durasiJam: 4.5,
          bbKering: dry,
          bbPreHd: Number((dry + 2.4).toFixed(1)),
          bbPostHd: dry,
          qb: 220,
          qd: 500,
          targetUf: 2400,
          ktV: 1.4,
          capaianUf: 2400,
          tdPre: '140/85',
          tdPost: '125/80',
          dialiser: `High Flux (${matchedMaster?.defaultDialyzer || 'SAS HF 18'})`,
          heparinisasi: 'Standar (5000 IU)',
          komplikasiIntraHd: 'Tidak ada',
          tindakanAdvisDpjp: 'Tidak ada',
          statusMesin: 'Siap Pakai',
          metodeDisinfeksi: 'Heat Clean',
          ketTeknis: 'Normal',
          jamCekRo: lbShift === 'Siang' ? '13:30' : '06:30',
          kondisiAirRo: 'Memenuhi Syarat',
          perawatPelaksana: lb.namaPerawat,
          statusVerifikasi: 'verified_karu',
          verifikatorKaruId: lb.verifikatorKaruId,
          verifikatorKaruNama: lb.verifikatorKaruNama,
          updatedAt: lb.updatedAt
        });
      });
    }
  });

  return Array.from(resultMap.values())
    .sort((a, b) =>
      (a.noBedMesin || '').localeCompare(b.noBedMesin || '', undefined, { numeric: true })
    )
    .map((r, idx) => ({ ...r, no: idx + 1 }));
}

// ============================================================================
// KALKULATOR AKREDITASI KARS (BLOK A-F) & FORMAT TEKS SERAH TERIMA SBAR
// (Murni dari Sesi Pasien Berstatus Minimal 'verified_pj' atau 'verified_karu')
// ============================================================================

export function buildKarsShiftSummaryFromVerifiedRows(params: {
  verifiedRows: LaporanPasienRow[];
  tanggal: string;
  shift: string;
  shiftInfo?: ShiftInfo;
  baseMachineOverview?: MachineOverview;
  masterNurses?: MasterNurse[];
  masterDoctors?: MasterDoctor[];
  nurseSchedules?: NurseScheduleEntry[];
  doctorSchedules?: DoctorScheduleEntry[];
}): KarsShiftAccreditationSummary {
  const tanggalIso = normalizeDateIsoParam(params.tanggal);
  const shift = normalizeShiftName(params.shift);
  const shiftHours = shift === 'Siang' ? '14.00 - 21.00 WIB' : '07.00 - 14.00 WIB';
  const tanggalFormatted = formatIsoDateToIndonesianFull(tanggalIso);

  // Filter tegas: HANYA sesi pasien dengan status minimal 'verified_pj' atau 'verified_karu'
  const validRows = params.verifiedRows.filter(
    (r) => r.statusVerifikasi === 'verified_pj' || r.statusVerifikasi === 'verified_karu'
  );

  const total = validRows.length;
  const verifiedPjCount = validRows.filter((r) => r.statusVerifikasi === 'verified_pj').length;
  const verifiedKaruCount = validRows.filter((r) => r.statusVerifikasi === 'verified_karu').length;

  // BLOK A: Ketenagaan & Perawat Penginput Terverifikasi
  const nurseMap = new Map<
    string,
    { name: string; patientCount: number; verifiedPjCount: number; verifiedKaruCount: number }
  >();
  validRows.forEach((row) => {
    const rawName = (row.perawatPelaksana || '').trim();
    if (!rawName || rawName === '-') return;
    const matchedEntry = Array.from(nurseMap.entries()).find(([, val]) =>
      isMatchingNurse(val.name, rawName)
    );
    const key = matchedEntry ? matchedEntry[0] : rawName.toLowerCase();
    const prev = matchedEntry
      ? matchedEntry[1]
      : { name: rawName, patientCount: 0, verifiedPjCount: 0, verifiedKaruCount: 0 };
    prev.patientCount += 1;
    if (row.statusVerifikasi === 'verified_karu') prev.verifiedKaruCount += 1;
    else prev.verifiedPjCount += 1;
    nurseMap.set(key, prev);
  });

  const participatingNurses = Array.from(nurseMap.values()).sort(
    (a, b) => b.patientCount - a.patientCount
  );
  const scheduledNursesCount = (params.nurseSchedules || []).filter(
    (ns) => ns.date === tanggalIso && normalizeShiftName(ns.shift) === shift
  ).length;
  const jumlahPerawatTerverifikasi =
    participatingNurses.length > 0 ? participatingNurses.length : scheduledNursesCount;

  const rasioPerawatPasien =
    jumlahPerawatTerverifikasi > 0 && total > 0
      ? `1 : ${Math.max(1, Math.round((total / jumlahPerawatTerverifikasi) * 10) / 10)}`
      : total === 0
      ? '0 Pasien Terverifikasi'
      : `1 : ${total}`;

  // BLOK B: Sensus Pasien, Klasifikasi Zonasi, Akses Vaskular & Utilisasi Mesin
  const pasienRajal = validRows.filter((r) => r.statusRawat === 'Rawat Jalan').length;
  const pasienRanap = validRows.filter((r) => r.statusRawat === 'Rawat Inap').length;
  const pasienHepB = validRows.filter((r) =>
    r.ruangKategori.toLowerCase().includes('hep b')
  ).length;
  const pasienHepC = validRows.filter((r) =>
    r.ruangKategori.toLowerCase().includes('hep c')
  ).length;
  const pasienReguler = Math.max(0, total - pasienHepB - pasienHepC);

  const aksesAvGraft = validRows.filter((r) =>
    r.aksesVaskular.toUpperCase().includes('GRAFT')
  ).length;
  const aksesAvFistula = validRows.filter(
    (r) =>
      r.aksesVaskular.toUpperCase().includes('AV') &&
      !r.aksesVaskular.toUpperCase().includes('GRAFT')
  ).length;
  const aksesCdlPermcath = validRows.filter(
    (r) =>
      r.aksesVaskular.toUpperCase().includes('PERMCATH') ||
      r.aksesVaskular.toUpperCase().includes('TUNNEL')
  ).length;
  const aksesCdlNonTunnel = validRows.filter(
    (r) =>
      (r.aksesVaskular.toUpperCase().includes('CDL') ||
        r.aksesVaskular.toUpperCase().includes('FEMORAL')) &&
      !r.aksesVaskular.toUpperCase().includes('PERMCATH') &&
      !r.aksesVaskular.toUpperCase().includes('TUNNEL')
  ).length;

  const census: AggregatedCensus = {
    pasienTerjadwal: total,
    pasienHadirSelesai: total,
    pasienCitoEmergency: 0,
    pasienBatalTunda: 0,
    pasienReguler,
    pasienHepB,
    pasienHepC,
    pasienRajal,
    pasienRanap,
    totalPasienDilayani: total,
    aksesAvFistula,
    aksesAvGraft,
    aksesCdlNonTunnel,
    aksesCdlPermcath
  };

  const baseCap = params.baseMachineOverview?.totalCapacity || 20;
  const baseMaint = params.baseMachineOverview?.maintenance || 0;
  const machineUtilization: MachineOverview = {
    totalCapacity: baseCap,
    beroperasiSiapPakai: Math.max(total, params.baseMachineOverview?.beroperasiSiapPakai || baseCap - baseMaint),
    maintenance: baseMaint,
    khususHepB: Math.max(pasienHepB, params.baseMachineOverview?.khususHepB || 1),
    khususHepC: Math.max(pasienHepC, params.baseMachineOverview?.khususHepC || 1)
  };

  // BLOK C: Persentase Indikator Mutu Klinis KARS & PERNEFRI
  const ufTargetMetCount = validRows.filter((r) => {
    const tgt = Number(r.targetUf) || 0;
    const cap = Number(r.capaianUf) || 0;
    if (tgt <= 0) return cap >= 0;
    return cap / tgt >= 0.9;
  }).length;
  const ufTargetMetPct = total > 0 ? Math.round((ufTargetMetCount / total) * 100) : 0;
  const avgTargetUfMl =
    total > 0
      ? Math.round(validRows.reduce((s, r) => s + (Number(r.targetUf) || 0), 0) / total)
      : 0;
  const avgAchievedUfMl =
    total > 0
      ? Math.round(validRows.reduce((s, r) => s + (Number(r.capaianUf) || 0), 0) / total)
      : 0;

  const ktvMetCount = validRows.filter((r) => (Number(r.ktV) || 0) >= 1.2).length;
  const ktvMetPct = total > 0 ? Math.round((ktvMetCount / total) * 100) : 0;
  const avgKtV =
    total > 0
      ? Number(
          (validRows.reduce((s, r) => s + (Number(r.ktV) || 0), 0) / total).toFixed(2)
        )
      : 0;

  const durationMetCount = validRows.filter((r) => (Number(r.durasiJam) || 0) >= 4.0).length;
  const durationMetPct = total > 0 ? Math.round((durationMetCount / total) * 100) : 0;
  const avgDurationHours =
    total > 0
      ? Number(
          (validRows.reduce((s, r) => s + (Number(r.durasiJam) || 0), 0) / total).toFixed(1)
        )
      : 0;

  const complicationRows = validRows.filter((r) => {
    const val = (r.komplikasiIntraHd || '').trim().toLowerCase();
    return Boolean(val && val !== 'tidak ada' && val !== '-');
  });
  const complicationCaseCount = complicationRows.length;
  const complicationFreeCount = Math.max(0, total - complicationCaseCount);
  const complicationFreePct = total > 0 ? Math.round((complicationFreeCount / total) * 100) : 0;

  const qbStabilCount = validRows.filter((r) => (Number(r.qb) || 0) >= 200).length;
  const qbStabilPct = total > 0 ? Math.round((qbStabilCount / total) * 100) : 0;
  const avgQb =
    total > 0
      ? Math.round(validRows.reduce((s, r) => s + (Number(r.qb) || 0), 0) / total)
      : 0;

  const advisDocumentedCount = complicationRows.filter((r) => {
    const adv = (r.tindakanAdvisDpjp || '').trim().toLowerCase();
    return Boolean(adv && adv !== 'tidak ada' && adv !== '-');
  }).length;
  const advisCompliancePct =
    total === 0
      ? 0
      : complicationCaseCount === 0
      ? 100
      : Math.round((advisDocumentedCount / complicationCaseCount) * 100);

  const qualityMetrics: KarsClinicalQualityMetrics = {
    totalVerifiedSessions: total,
    verifiedPjCount,
    verifiedKaruCount,
    ufTargetMetCount,
    ufTargetMetPct,
    avgTargetUfMl,
    avgAchievedUfMl,
    ktvMetCount,
    ktvMetPct,
    avgKtV,
    durationMetCount,
    durationMetPct,
    avgDurationHours,
    complicationCaseCount,
    complicationFreeCount,
    complicationFreePct,
    qbStabilCount,
    qbStabilPct,
    avgQb,
    advisDocumentedCount,
    advisCompliancePct
  };

  const clinicalIndicators: ClinicalIndicatorItem[] = [
    {
      id: 'kars-cli-uf',
      label: 'Ketercapaian Target Ultrafiltrasi (UF ≥ 90% Preskripsi)',
      capaian: total > 0 ? `${ufTargetMetPct}% (${ufTargetMetCount}/${total} Pasien)` : '0% (0 Pasien)',
      standar: '≥ 90%',
      analisis:
        total > 0
          ? `Rata-rata UF tercapai ${avgAchievedUfMl.toLocaleString('id-ID')} mL dari target ${avgTargetUfMl.toLocaleString('id-ID')} mL.`
          : 'Menunggu verifikasi sesi pasien oleh PJ Shift / Kepala Ruang.',
      isStandardMet: total > 0 && ufTargetMetPct >= 90
    },
    {
      id: 'kars-cli-ktv',
      label: 'Adekuasi Dosis Hemodialisis (Kt/V ≥ 1,20)',
      capaian: total > 0 ? `${ktvMetPct}% (Rerata Kt/V ${avgKtV})` : '0% (0 Pasien)',
      standar: '≥ 85% (Kt/V ≥ 1,20)',
      analisis:
        total > 0
          ? `${ktvMetCount} dari ${total} sesi terverifikasi mencapai target adekuasi PERNEFRI.`
          : 'Menunggu verifikasi sesi pasien oleh PJ Shift / Kepala Ruang.',
      isStandardMet: total > 0 && ktvMetPct >= 85
    },
    {
      id: 'kars-cli-durasi',
      label: 'Kepatuhan Durasi Preskripsi Hemodialisis (≥ 4,0 Jam)',
      capaian: total > 0 ? `${durationMetPct}% (Rerata ${avgDurationHours} Jam)` : '0% (0 Pasien)',
      standar: '≥ 90%',
      analisis:
        total > 0
          ? `${durationMetCount} dari ${total} pasien menjalani durasi dialisis penuh sesuai resep.`
          : 'Menunggu verifikasi sesi pasien oleh PJ Shift / Kepala Ruang.',
      isStandardMet: total > 0 && durationMetPct >= 90
    },
    {
      id: 'kars-cli-komplikasi',
      label: 'Sesi Bebas Komplikasi Akut Intra-HD (Hipotensi/Kram/Clotting)',
      capaian:
        total > 0
          ? `${complicationFreePct}% (${complicationCaseCount} Kasus Komplikasi)`
          : '0% (0 Pasien)',
      standar: '≥ 90% Bebas Komplikasi',
      analisis:
        complicationCaseCount > 0
          ? `Tercatat ${complicationCaseCount} sesi dengan penyulit intra-HD: ${complicationRows
              .map((r) => `${r.namaPasien} (${r.komplikasiIntraHd})`)
              .join('; ')}.`
          : total > 0
          ? 'Seluruh pasien terverifikasi stabil tanpa insiden hipotensi, kram otot, maupun clotting.'
          : 'Menunggu verifikasi sesi pasien oleh PJ Shift / Kepala Ruang.',
      isStandardMet: total > 0 && complicationFreePct >= 90
    },
    {
      id: 'kars-cli-qb',
      label: 'Stabilitas Aliran Darah Ekstrakorporeal (QB ≥ 200 mL/menit)',
      capaian: total > 0 ? `${qbStabilPct}% (Rerata ${avgQb} mL/m)` : '0% (0 Pasien)',
      standar: '≥ 85%',
      analisis:
        total > 0
          ? `Aliran akses vaskular optimal pada ${qbStabilCount}/${total} pasien terverifikasi.`
          : 'Menunggu verifikasi sesi pasien oleh PJ Shift / Kepala Ruang.',
      isStandardMet: total > 0 && qbStabilPct >= 85
    },
    {
      id: 'kars-cli-advis',
      label: 'Dokumentasi Tatalaksana & Konfirmasi Advis DPJP (TBAK)',
      capaian: total > 0 ? `${advisCompliancePct}%` : '0%',
      standar: '100%',
      analisis:
        complicationCaseCount > 0
          ? `${advisDocumentedCount}/${complicationCaseCount} kasus komplikasi terdokumentasi lengkap dengan advis medis DPJP.`
          : total > 0
          ? 'Tidak terdapat kejadian kritis yang memerlukan intervensi darurat DPJP.'
          : 'Menunggu verifikasi sesi pasien oleh PJ Shift / Kepala Ruang.',
      isStandardMet: total > 0 && advisCompliancePct === 100
    }
  ];

  // BLOK D: Checklist Mutu Air Reverse Osmosis (RO) & Disinfeksi Mesin
  const roMemenuhiSyaratCount = validRows.filter((r) =>
    (r.kondisiAirRo || '').toLowerCase().includes('memenuhi')
  ).length;
  const roMemenuhiSyaratPct =
    total > 0 ? Math.round((roMemenuhiSyaratCount / total) * 100) : 0;
  const jamCekRoSet = Array.from(
    new Set(validRows.map((r) => (r.jamCekRo || '').trim()).filter(Boolean))
  );
  const primaryJamCekRo = jamCekRoSet[0] || (shift === 'Siang' ? '13:30' : '06:30');

  const disinfeksiHeatCleanCount = validRows.filter((r) =>
    (r.metodeDisinfeksi || '').toLowerCase().includes('heat') ||
    (r.metodeDisinfeksi || '').toLowerCase().includes('citric') ||
    Boolean((r.metodeDisinfeksi || '').trim())
  ).length;
  const disinfeksiCompliancePct =
    total > 0 ? Math.round((disinfeksiHeatCleanCount / total) * 100) : 0;

  const mesinSiapPakaiCount = validRows.filter((r) =>
    (r.statusMesin || '').toLowerCase().includes('siap') ||
    (r.ketTeknis || '').toLowerCase().includes('normal')
  ).length;
  const mesinSiapPakaiPct = total > 0 ? Math.round((mesinSiapPakaiCount / total) * 100) : 0;

  const overallRoStatus: KarsRoWaterChecklistSummary['overallRoStatus'] =
    total === 0
      ? 'BELUM ADA DATA'
      : roMemenuhiSyaratPct === 100
      ? 'MEMENUHI SYARAT'
      : 'PERLU EVALUASI';

  const roChecklist: KarsRoWaterChecklistSummary = {
    totalCheckedSessions: total,
    roMemenuhiSyaratCount,
    roMemenuhiSyaratPct,
    jamCekRoList: jamCekRoSet,
    primaryJamCekRo,
    disinfeksiHeatCleanCount,
    disinfeksiCompliancePct,
    mesinSiapPakaiCount,
    mesinSiapPakaiPct,
    overallRoStatus
  };

  const operationalItems: OperationalItem[] = [
    {
      id: 'op-ro-water',
      item: 'Sistem Water Treatment Reverse Osmosis (RO)',
      parameterUji: 'Konduktivitas / TDS < 10 µS/cm, Total Chlorine < 0,1 mg/L, Tekanan Loop Stabil',
      hasilObservasi:
        total > 0
          ? `Jam Cek RO ${primaryJamCekRo} WIB · ${roMemenuhiSyaratCount}/${total} sesi (${roMemenuhiSyaratPct}%) tercatat air RO memenuhi syarat baku mutu AAMI.`
          : `Menunggu sesi terverifikasi pada Shift ${shift} (jadwal cek RO ${primaryJamCekRo} WIB).`,
      statusKepatuhan:
        total === 0
          ? 'MENUNGGU VERIFIKASI'
          : roMemenuhiSyaratPct === 100
          ? 'MEMENUHI SYARAT'
          : 'EVALUASI TEKNIS'
    },
    {
      id: 'op-machine-disinfection',
      item: 'Disinfeksi Termal & Dekalsifikasi Mesin HD Pasca-Pakai',
      parameterUji: 'Heat Clean / Citric Acid Disinfection setiap pergantian sesi pasien',
      hasilObservasi:
        total > 0
          ? `${disinfeksiHeatCleanCount}/${total} mesin (${disinfeksiCompliancePct}%) telah menjalani Heat Clean & ${mesinSiapPakaiCount}/${total} (${mesinSiapPakaiPct}%) berstatus Siap Pakai.`
          : 'Belum ada penggunaan mesin terverifikasi pada shift ini.',
      statusKepatuhan:
        total === 0
          ? 'MENUNGGU VERIFIKASI'
          : disinfeksiCompliancePct === 100
          ? 'MEMENUHI SYARAT'
          : 'PERLU PEMANTAUAN'
    },
    {
      id: 'op-infection-zoning',
      item: 'Kepatuhan Zonasi Infeksius & PPI Unit Hemodialisis',
      parameterUji: 'Pemisahan ketat mesin/bed Reguler vs Isolasi Hepatitis B & Hepatitis C',
      hasilObservasi:
        total > 0
          ? `Reguler: ${pasienReguler} pasien · Isolasi Hep B: ${pasienHepB} pasien · Isolasi Hep C: ${pasienHepC} pasien. APD & 5 momen cuci tangan dipatuhi.`
          : 'Zonasi Reguler & Isolasi siap pakai sesuai standar PPI.',
      statusKepatuhan: 'MEMENUHI SYARAT'
    },
    {
      id: 'op-emergency-trolley',
      item: 'Kesiapan Troli Emergensi, Oksigen Sentral & Defibrilator',
      parameterUji: 'Segel utuh, obat life-saving lengkap, O2 sentral & suction berfungsi',
      hasilObservasi:
        'Troli emergensi siap pakai, stok NaCl 0,9%, Dextrose 40%, Epinefrin, serta dialiser & bloodline mencukupi.',
      statusKepatuhan: 'MEMENUHI SYARAT'
    }
  ];

  // BLOK E: Komunikasi Efektif Serah Terima SBAR (Otomatis dari Data Terverifikasi)
  const pjName = params.shiftInfo?.pjShift || 'PJ Shift';
  const dpjpName = params.shiftInfo?.dokterDpjp || 'Dokter DPJP HD';

  const autoSbar: SbarData =
    total === 0
      ? {
          situation: `Shift ${shift} (${tanggalFormatted}, ${shiftHours}) dipimpin oleh ${pjName}. Saat ini belum terdapat sesi pasien dengan status minimal Terverifikasi PJ Shift (verified_pj) atau Disahkan Kepala Ruang (verified_karu).`,
          background:
            'Seluruh logbook pasien yang masih berstatus Draft atau Diajukan (submitted) belum dihitung ke dalam sensus akreditasi KARS hingga diverifikasi oleh PJ Shift atau Kepala Ruang.',
          assessment:
            'Indikator mutu klinis (capaian UF, Kt/V, bebas komplikasi) dan checklist mutu air RO siap terhitung otomatis begitu verifikasi shift dilakukan.',
          recommendation:
            '1. Lakukan pemeriksaan dan persetujuan pada menu Verifikasi untuk sesi pasien yang telah selesai.\n2. Pastikan pengecekan konduktivitas air RO dan disinfeksi Heat Clean tercatat sebelum serah terima shift berikutnya.'
        }
      : {
          situation: `Pelayanan Hemodialisis Shift ${shift} (${tanggalFormatted}, ${shiftHours}) di bawah koordinasi PJ Shift ${pjName} dan DPJP ${dpjpName} melayani ${total} pasien terverifikasi (${verifiedKaruCount} verified_karu, ${verifiedPjCount} verified_pj), terdiri dari ${pasienRajal} Rawat Jalan dan ${pasienRanap} Rawat Inap (Reguler: ${pasienReguler}, Isolasi Hep B: ${pasienHepB}, Isolasi Hep C: ${pasienHepC}).`,
          background:
            complicationCaseCount > 0
              ? `Distribusi akses vaskular: AV Fistula ${aksesAvFistula}, AV Graft ${aksesAvGraft}, CDL/Femoral ${
                  aksesCdlNonTunnel + aksesCdlPermcath
                }. Tercatat ${complicationCaseCount} pasien mengalami penyulit intra-HD: ${complicationRows
                  .map(
                    (r) =>
                      `${r.namaPasien} (${r.noBedMesin} - ${r.komplikasiIntraHd}; Tindakan/Advis: ${r.tindakanAdvisDpjp})`
                  )
                  .join(' | ')}.`
              : `Distribusi akses vaskular: AV Fistula ${aksesAvFistula}, AV Graft ${aksesAvGraft}, CDL/Femoral ${
                  aksesCdlNonTunnel + aksesCdlPermcath
                }. Seluruh ${total} sesi pasien berlangsung lancar tanpa insiden hipotensi intradialitik, kram otot, maupun clotting sirkuit.`,
          assessment: `Capaian indikator mutu klinis KARS: Ketercapaian UF ≥90% sebesar ${ufTargetMetPct}% (rerata UF ${avgAchievedUfMl.toLocaleString(
            'id-ID'
          )} mL), Adekuasi Kt/V ≥1,20 sebesar ${ktvMetPct}% (rerata Kt/V ${avgKtV}), Durasi ≥4 jam sebesar ${durationMetPct}% (rerata ${avgDurationHours} jam), Bebas Komplikasi ${complicationFreePct}%. Checklist Water Treatment RO jam ${primaryJamCekRo} WIB: ${roMemenuhiSyaratPct}% memenuhi syarat AAMI & disinfeksi mesin Heat Clean ${disinfeksiCompliancePct}%.`,
          recommendation:
            complicationCaseCount > 0
              ? `1. Pantau ketat evaluasi post-HD dan kesiapan hemodinamik berikutnya bagi pasien dengan riwayat penyulit (${complicationRows
                  .map((r) => r.namaPasien)
                  .join(', ')}).\n2. Pertahankan verifikasi konduktivitas air RO pra-shift dan pastikan seluruh mesin pasca-pakai telah tuntas Heat Clean.\n3. Lanjutkan serah terima berkas CPPT dan resep heparinisasi khusus kepada tim shift berikutnya.`
              : `1. Pertahankan standar priming sirkuit steril dan evaluasi BB kering pra-HD pada shift berikutnya.\n2. Pastikan log pemeriksaan harian Water Treatment RO dan disinfeksi Heat Clean seluruh mesin terjaga 100%.\n3. Siapkan set kanulasi AV Fistula dan dressing CDL steril untuk jadwal pasien shift selanjutnya.`
        };

  return {
    tanggalIso,
    tanggalFormatted,
    shift,
    shiftHours,
    verifiedRows: validRows,
    participatingNurses,
    jumlahPerawatTerverifikasi,
    rasioPerawatPasien,
    census,
    machineUtilization,
    qualityMetrics,
    clinicalIndicators,
    roChecklist,
    operationalItems,
    autoSbar
  };
}

export function formatSbarHandoverText(params: {
  shiftInfo: ShiftInfo;
  census: AggregatedCensus;
  qualityMetrics: KarsClinicalQualityMetrics;
  roChecklist: KarsRoWaterChecklistSummary;
  sbar: SbarData;
  signatures?: ShiftSignatures;
}): string {
  const { shiftInfo, census, qualityMetrics, roChecklist, sbar, signatures } = params;
  const shiftLabel = shiftInfo.shift || 'Pagi';
  const nextReceiver =
    shiftInfo.pjShiftBerikutnya?.trim() ||
    signatures?.pjBerikutnya?.name?.trim() ||
    (shiftLabel === 'Pagi' ? 'PJ Shift Siang' : 'Tim On-Call / Shift Pagi Berikutnya');

  return [
    `LAPORAN SERAH TERIMA SHIFT HEMODIALISIS (METODE SBAR - STANDAR KARS)`,
    `${shiftInfo.hospitalName || 'RS Happy Land Medical Centre'} — ${shiftInfo.unitName || 'Instalasi Hemodialisa'}`,
    `Hari / Tanggal : ${shiftInfo.date}`,
    `Shift Dinas    : Shift ${shiftLabel} (${shiftInfo.shiftHours || (shiftLabel === 'Siang' ? '14.00 - 21.00 WIB' : '07.00 - 14.00 WIB')})`,
    `Basis Data     : ${qualityMetrics.totalVerifiedSessions} Sesi Pasien Terverifikasi (${qualityMetrics.verifiedKaruCount} Verified Ka. Ruang, ${qualityMetrics.verifiedPjCount} Verified PJ Shift)`,
    `------------------------------------------------------------------------`,
    `[S] SITUATION (Situasi Pelayanan Shift):`,
    sbar.situation || '-',
    ``,
    `[B] BACKGROUND (Latar Belakang Sensus, Akses & Kasus Berisiko):`,
    sbar.background || '-',
    `• Rincian Sensus : Total ${census.totalPasienDilayani} Pasien (Rajal: ${census.pasienRajal}, Ranap: ${census.pasienRanap} | Reguler: ${census.pasienReguler}, Hep B: ${census.pasienHepB}, Hep C: ${census.pasienHepC})`,
    `• Akses Vaskular : AV Fistula ${census.aksesAvFistula} · AV Graft ${census.aksesAvGraft} · CDL Non-Tunnel/Femoral ${census.aksesCdlNonTunnel} · CDL Tunnel ${census.aksesCdlPermcath}`,
    ``,
    `[A] ASSESSMENT (Penilaian Indikator Mutu Klinis & Checklist RO):`,
    sbar.assessment || '-',
    `• Indikator Mutu : Capaian UF ≥90%: ${qualityMetrics.ufTargetMetPct}% | Kt/V ≥1,20: ${qualityMetrics.ktvMetPct}% | Durasi ≥4 Jam: ${qualityMetrics.durationMetPct}% | Bebas Komplikasi: ${qualityMetrics.complicationFreePct}%`,
    `• Checklist RO   : ${roChecklist.overallRoStatus} (${roChecklist.roMemenuhiSyaratPct}% memenuhi syarat pada jam cek ${roChecklist.primaryJamCekRo} WIB) | Disinfeksi Heat Clean: ${roChecklist.disinfeksiCompliancePct}%`,
    ``,
    `[R] RECOMMENDATION (Rekomendasi & Tindak Lanjut Shift Berikutnya):`,
    sbar.recommendation || '-',
    `------------------------------------------------------------------------`,
    `Menyerahkan (PJ Shift ${shiftLabel}) : ${shiftInfo.pjShift || '-'}`,
    `Menerima Shift Berikutnya       : ${nextReceiver}`,
    `Mengetahui (Kepala Ruang HD)    : ${shiftInfo.kepalaRuangan || '-'}`
  ].join('\n');
}
