import * as XLSX from 'xlsx';
import {
  NurseScheduleEntry,
  DoctorScheduleEntry,
  MasterNurse,
  MasterDoctor,
  ScheduleShiftType,
  DoctorScheduleShiftType
} from '../types/dialysis.ts';

export const INDONESIAN_MONTH_NAMES = [
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
] as const;

const DAY_SHORT_LABELS = ['Mg', 'Sn', 'Sl', 'Rb', 'Km', 'Jm', 'Sb'] as const;
const DAY_FULL_LABELS = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu'
] as const;

export type NurseMatrixCode =
  | 'P'
  | 'PJ-P'
  | 'S'
  | 'PJ-S'
  | 'M'
  | 'OC'
  | 'L'
  | 'CT'
  | '-';

export type DoctorMatrixCode = 'P' | 'S' | 'PS' | 'OC' | 'L' | '-';

export interface MonthCalendarDay {
  day: number;
  isoDate: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  dayShort: string;
  dayFull: string;
  isSunday: boolean;
  isSaturday: boolean;
}

export interface MatrixCodeMeta<TCode extends string> {
  code: TCode;
  label: string;
  shortDesc: string;
  cellClass: string;
  brushClass: string;
  printTextClass: string;
}

export const NURSE_MATRIX_PALETTE: MatrixCodeMeta<NurseMatrixCode>[] = [
  {
    code: 'P',
    label: 'Dinas Pagi',
    shortDesc: '07.00 - 14.00 WIB',
    cellClass: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    brushClass: 'bg-sky-600 text-white border-sky-700',
    printTextClass: 'font-semibold text-slate-900 bg-sky-50'
  },
  {
    code: 'PJ-P',
    label: 'PJ Shift Pagi',
    shortDesc: 'Penanggung Jawab Pagi',
    cellClass: 'bg-blue-700 text-white border-blue-800 hover:bg-blue-800 font-extrabold',
    brushClass: 'bg-blue-800 text-white border-blue-900',
    printTextClass: 'font-extrabold text-blue-950 bg-blue-100'
  },
  {
    code: 'S',
    label: 'Dinas Siang',
    shortDesc: '14.00 - 21.00 WIB',
    cellClass: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
    brushClass: 'bg-amber-600 text-white border-amber-700',
    printTextClass: 'font-semibold text-slate-900 bg-amber-50'
  },
  {
    code: 'PJ-S',
    label: 'PJ Shift Siang',
    shortDesc: 'Penanggung Jawab Siang',
    cellClass: 'bg-amber-600 text-white border-amber-700 hover:bg-amber-700 font-extrabold',
    brushClass: 'bg-amber-700 text-white border-amber-800',
    printTextClass: 'font-extrabold text-amber-950 bg-amber-100'
  },
  {
    code: 'OC',
    label: 'On-Call (Cito)',
    shortDesc: 'Siaga HD Cito / Emergency',
    cellClass: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
    brushClass: 'bg-teal-600 text-white border-teal-700',
    printTextClass: 'font-semibold text-teal-900 bg-teal-50'
  },
  {
    code: 'M',
    label: 'Dinas Malam',
    shortDesc: '21.00 - 07.00 WIB',
    cellClass: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
    brushClass: 'bg-indigo-600 text-white border-indigo-700',
    printTextClass: 'font-semibold text-indigo-900 bg-indigo-50'
  },
  {
    code: 'L',
    label: 'Libur Rutin',
    shortDesc: 'Off Dinas',
    cellClass: 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200/80',
    brushClass: 'bg-slate-600 text-white border-slate-700',
    printTextClass: 'text-slate-400 bg-slate-50'
  },
  {
    code: 'CT',
    label: 'Cuti / Izin',
    shortDesc: 'Cuti Tahunan / Dinas Luar',
    cellClass: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
    brushClass: 'bg-rose-600 text-white border-rose-700',
    printTextClass: 'font-semibold text-rose-800 bg-rose-50'
  },
  {
    code: '-',
    label: 'Kosongkan Sel',
    shortDesc: 'Hapus jadwal pada tanggal ini',
    cellClass: 'bg-white text-slate-300 border-slate-200/70 hover:bg-slate-50',
    brushClass: 'bg-slate-800 text-white border-slate-900',
    printTextClass: 'text-slate-300'
  }
];

export const DOCTOR_MATRIX_PALETTE: MatrixCodeMeta<DoctorMatrixCode>[] = [
  {
    code: 'P',
    label: 'Jaga / Visite Pagi',
    shortDesc: '07.00 - 14.00 WIB',
    cellClass: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    brushClass: 'bg-sky-600 text-white border-sky-700',
    printTextClass: 'font-semibold text-slate-900 bg-sky-50'
  },
  {
    code: 'S',
    label: 'Jaga / Visite Siang',
    shortDesc: '14.00 - 21.00 WIB',
    cellClass: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
    brushClass: 'bg-amber-600 text-white border-amber-700',
    printTextClass: 'font-semibold text-slate-900 bg-amber-50'
  },
  {
    code: 'PS',
    label: 'Seharian (All-Day)',
    shortDesc: 'Pagi & Siang (07.00 - 21.00)',
    cellClass: 'bg-blue-700 text-white border-blue-800 hover:bg-blue-800 font-extrabold',
    brushClass: 'bg-blue-800 text-white border-blue-900',
    printTextClass: 'font-extrabold text-blue-950 bg-blue-100'
  },
  {
    code: 'OC',
    label: 'On-Call Konsulen',
    shortDesc: 'Siaga Konsultasi / Cito HD',
    cellClass: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
    brushClass: 'bg-teal-600 text-white border-teal-700',
    printTextClass: 'font-semibold text-teal-900 bg-teal-50'
  },
  {
    code: 'L',
    label: 'Libur / Off',
    shortDesc: 'Off Jaga Ruangan',
    cellClass: 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200/80',
    brushClass: 'bg-slate-600 text-white border-slate-700',
    printTextClass: 'text-slate-400 bg-slate-50'
  },
  {
    code: '-',
    label: 'Kosongkan Sel',
    shortDesc: 'Hapus jadwal pada tanggal ini',
    cellClass: 'bg-white text-slate-300 border-slate-200/70 hover:bg-slate-50',
    brushClass: 'bg-slate-800 text-white border-slate-900',
    printTextClass: 'text-slate-300'
  }
];

export function getNurseCodeMeta(code: NurseMatrixCode): MatrixCodeMeta<NurseMatrixCode> {
  return NURSE_MATRIX_PALETTE.find((m) => m.code === code) || NURSE_MATRIX_PALETTE[NURSE_MATRIX_PALETTE.length - 1];
}

export function getDoctorCodeMeta(code: DoctorMatrixCode): MatrixCodeMeta<DoctorMatrixCode> {
  return DOCTOR_MATRIX_PALETTE.find((m) => m.code === code) || DOCTOR_MATRIX_PALETTE[DOCTOR_MATRIX_PALETTE.length - 1];
}

export function parseYearMonthFromIso(isoDate?: string): { year: number; month: number } {
  if (isoDate && /^\d{4}-\d{2}/.test(isoDate)) {
    const [yStr, mStr] = isoDate.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    if (year >= 2020 && year <= 2100 && month >= 1 && month <= 12) {
      return { year, month };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function formatYearMonthPrefix(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Generates all calendar days (1..28/29/30/31) for a 1-indexed month (1 = Januari .. 12 = Desember).
 */
export function getMonthCalendarDays(year: number, month: number): MonthCalendarDay[] {
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = formatYearMonthPrefix(year, month);
  const days: MonthCalendarDay[] = [];

  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    const dow = dt.getUTCDay();
    const isoDate = `${prefix}-${String(d).padStart(2, '0')}`;
    days.push({
      day: d,
      isoDate,
      dayOfWeek: dow,
      dayShort: DAY_SHORT_LABELS[dow],
      dayFull: DAY_FULL_LABELS[dow],
      isSunday: dow === 0,
      isSaturday: dow === 6
    });
  }

  return days;
}

export function entryToNurseMatrixCode(entry?: NurseScheduleEntry): NurseMatrixCode {
  if (!entry) return '-';
  switch (entry.shift) {
    case 'Pagi':
      return entry.isPjShift ? 'PJ-P' : 'P';
    case 'Siang':
      return entry.isPjShift ? 'PJ-S' : 'S';
    case 'Malam':
      return 'M';
    case 'On-Call':
      return 'OC';
    case 'Libur':
      return 'L';
    case 'Cuti':
      return 'CT';
    default:
      return '-';
  }
}

export function nurseMatrixCodeToShift(code: Exclude<NurseMatrixCode, '-'>): {
  shift: ScheduleShiftType;
  isPjShift: boolean;
} {
  switch (code) {
    case 'PJ-P':
      return { shift: 'Pagi', isPjShift: true };
    case 'P':
      return { shift: 'Pagi', isPjShift: false };
    case 'PJ-S':
      return { shift: 'Siang', isPjShift: true };
    case 'S':
      return { shift: 'Siang', isPjShift: false };
    case 'M':
      return { shift: 'Malam', isPjShift: false };
    case 'OC':
      return { shift: 'On-Call', isPjShift: false };
    case 'L':
      return { shift: 'Libur', isPjShift: false };
    case 'CT':
      return { shift: 'Cuti', isPjShift: false };
  }
}

export function getNextNurseMatrixCode(
  current: NurseMatrixCode,
  role: MasterNurse['role']
): NurseMatrixCode {
  const cycle: NurseMatrixCode[] =
    role === 'kepala_ruangan'
      ? ['P', 'L', 'CT', 'OC', '-']
      : role === 'pj_shift'
      ? ['PJ-P', 'PJ-S', 'P', 'S', 'OC', 'L', 'CT', '-']
      : ['P', 'S', 'OC', 'M', 'L', 'CT', '-'];

  const idx = cycle.indexOf(current);
  if (idx === -1) return cycle[0];
  return cycle[(idx + 1) % cycle.length];
}

export function entryToDoctorMatrixCode(entry?: DoctorScheduleEntry): DoctorMatrixCode {
  if (!entry) return '-';
  switch (entry.shift) {
    case 'Pagi':
      return 'P';
    case 'Siang':
      return 'S';
    case 'All-Day':
      return 'PS';
    case 'On-Call':
      return 'OC';
    case 'Libur':
      return 'L';
    default:
      return '-';
  }
}

export function doctorMatrixCodeToShift(
  code: Exclude<DoctorMatrixCode, '-'>
): DoctorScheduleShiftType {
  switch (code) {
    case 'P':
      return 'Pagi';
    case 'S':
      return 'Siang';
    case 'PS':
      return 'All-Day';
    case 'OC':
      return 'On-Call';
    case 'L':
      return 'Libur';
  }
}

export function getNextDoctorMatrixCode(current: DoctorMatrixCode): DoctorMatrixCode {
  const cycle: DoctorMatrixCode[] = ['P', 'S', 'PS', 'OC', 'L', '-'];
  const idx = cycle.indexOf(current);
  if (idx === -1) return cycle[0];
  return cycle[(idx + 1) % cycle.length];
}

function isSameNurseSchedule(entry: NurseScheduleEntry, nurse: MasterNurse): boolean {
  if (entry.nurseId && nurse.id && entry.nurseId === nurse.id) return true;
  return isMatchingSchedulePersonName(entry.nurseName, nurse.name);
}

function isSameDoctorSchedule(entry: DoctorScheduleEntry, doctor: MasterDoctor): boolean {
  if (entry.doctorId && doctor.id && entry.doctorId === doctor.id) return true;
  return isMatchingSchedulePersonName(entry.doctorName, doctor.name);
}

/**
 * Applies a NurseMatrixCode to a single (nurse, isoDate) cell in the schedule array.
 * Enforces single PJ Shift per (isoDate, shift) when PJ-P or PJ-S is assigned.
 */
export function applyNurseMatrixCell(
  schedules: NurseScheduleEntry[],
  nurse: MasterNurse,
  isoDate: string,
  code: NurseMatrixCode,
  customNotes?: string
): NurseScheduleEntry[] {
  const filtered = schedules.filter(
    (s) => !(s.date === isoDate && isSameNurseSchedule(s, nurse))
  );

  if (code === '-') {
    return filtered;
  }

  const existing = schedules.find(
    (s) => s.date === isoDate && isSameNurseSchedule(s, nurse)
  );
  const { shift, isPjShift } = nurseMatrixCodeToShift(code);

  const normalizedOthers = isPjShift
    ? filtered.map((s) =>
        s.date === isoDate && s.shift === shift && s.isPjShift
          ? { ...s, isPjShift: false, updatedAt: new Date().toISOString() }
          : s
      )
    : filtered;

  const resolvedNotes =
    customNotes !== undefined
      ? customNotes.trim() || undefined
      : existing?.notes;

  const updatedEntry: NurseScheduleEntry = {
    id: existing?.id || `nsch-${isoDate}-${nurse.id}`,
    nurseId: nurse.id,
    nurseName: nurse.name,
    date: isoDate,
    shift,
    isPjShift,
    notes: resolvedNotes,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return [...normalizedOthers, updatedEntry];
}

/**
 * Applies a DoctorMatrixCode to a single (doctor, isoDate) cell in the schedule array.
 */
export function applyDoctorMatrixCell(
  schedules: DoctorScheduleEntry[],
  doctor: MasterDoctor,
  isoDate: string,
  code: DoctorMatrixCode,
  customNotes?: string
): DoctorScheduleEntry[] {
  const filtered = schedules.filter(
    (d) => !(d.date === isoDate && isSameDoctorSchedule(d, doctor))
  );

  if (code === '-') {
    return filtered;
  }

  const existing = schedules.find(
    (d) => d.date === isoDate && isSameDoctorSchedule(d, doctor)
  );
  const shift = doctorMatrixCodeToShift(code);
  const resolvedNotes =
    customNotes !== undefined
      ? customNotes.trim() || undefined
      : existing?.notes;

  const updatedEntry: DoctorScheduleEntry = {
    id: existing?.id || `dsch-${isoDate}-${doctor.id}`,
    doctorId: doctor.id,
    doctorName: doctor.name,
    date: isoDate,
    shift,
    role: doctor.role,
    spesialisasi: doctor.spesialisasi || existing?.spesialisasi,
    phone: doctor.phone || existing?.phone,
    notes: resolvedNotes,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return [...filtered, updatedEntry];
}

/**
 * Generates a complete, balanced PERNEFRI-compliant Monthly Nurse Roster for all days in (year, month).
 * - Mon-Sat: Kepala Ruang Dinas Pagi; 1 PJ Pagi + 1 PJ Siang rotating smoothly; ~5-6 Pelaksana Pagi + ~5-6 Pelaksana Siang + ~2 Libur.
 * - Minggu: Layanan HD Cito / Emergency (1 PJ On-Call + 2 Pelaksana On-Call, lainnya Libur).
 */
export function generateMonthlyNurseRoster(
  year: number,
  month: number,
  nurses: MasterNurse[]
): NurseScheduleEntry[] {
  const activeNurses = nurses.filter((n) => (n.accountStatus || 'aktif') === 'aktif');
  const calendarDays = getMonthCalendarDays(year, month);
  const karuNurses = activeNurses.filter((n) => n.role === 'kepala_ruangan');
  const pjNurses = activeNurses.filter((n) => n.role === 'pj_shift');
  const pelaksanaNurses = activeNurses.filter((n) => n.role === 'perawat_pelaksana');

  const entries: NurseScheduleEntry[] = [];
  let workDaySeq = 0;
  let sundaySeq = 0;

  // Balanced 6-day cycle for Pelaksana: 5 active shifts (Pagi/Siang) + 1 Libur
  const pelaksanaPattern: ScheduleShiftType[] = [
    'Pagi',
    'Pagi',
    'Pagi',
    'Siang',
    'Siang',
    'Libur'
  ];

  for (const calDay of calendarDays) {
    const { isoDate, isSunday } = calDay;

    if (isSunday) {
      // Minggu: Unit HD Reguler tutup, tim On-Call Cito siaga
      karuNurses.forEach((n) => {
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: 'Libur',
          isPjShift: false,
          notes: 'Libur Akhir Pekan'
        });
      });

      pjNurses.forEach((n, idx) => {
        const isOnCall = pjNurses.length > 0 && idx === sundaySeq % pjNurses.length;
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: isOnCall ? 'On-Call' : 'Libur',
          isPjShift: false,
          notes: isOnCall ? 'PJ Siaga HD Cito Minggu' : 'Off Akhir Pekan'
        });
      });

      pelaksanaNurses.forEach((n, idx) => {
        const ocIdx1 = pelaksanaNurses.length > 0 ? (sundaySeq * 2) % pelaksanaNurses.length : -1;
        const ocIdx2 =
          pelaksanaNurses.length > 1 ? (sundaySeq * 2 + 1) % pelaksanaNurses.length : -1;
        const isOnCall = idx === ocIdx1 || idx === ocIdx2;
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: isOnCall ? 'On-Call' : 'Libur',
          isPjShift: false,
          notes: isOnCall ? 'Tim Siaga HD Cito / ICU' : 'Off Akhir Pekan'
        });
      });

      sundaySeq += 1;
      continue;
    }

    // Senin - Sabtu: Operasional Penuh Shift Pagi & Shift Siang
    karuNurses.forEach((n) => {
      entries.push({
        id: `nsch-${isoDate}-${n.id}`,
        nurseId: n.id,
        nurseName: n.name,
        date: isoDate,
        shift: 'Pagi',
        isPjShift: false,
        notes: 'Supervisi Klinis & Manajerial Unit HD'
      });
    });

    // Rotate PJ Shift every 2 working days for fair Pagi / Siang / Cadangan / Off distribution
    const pjCycleStep = Math.floor(workDaySeq / 2);
    pjNurses.forEach((n, idx) => {
      const slot = (idx + pjCycleStep) % Math.max(pjNurses.length, 4);
      if (slot === 0) {
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: 'Pagi',
          isPjShift: true,
          notes: 'PJ Shift Pagi Operasional'
        });
      } else if (slot === 1) {
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: 'Siang',
          isPjShift: true,
          notes: 'PJ Shift Siang Operasional'
        });
      } else if (slot === 2) {
        const supportShift: ScheduleShiftType = workDaySeq % 2 === 0 ? 'Pagi' : 'Siang';
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: supportShift,
          isPjShift: false,
          notes: `Perawat Primer / Pendamping ${supportShift}`
        });
      } else {
        entries.push({
          id: `nsch-${isoDate}-${n.id}`,
          nurseId: n.id,
          nurseName: n.name,
          date: isoDate,
          shift: 'Libur',
          isPjShift: false,
          notes: 'Off Dinas Rutin'
        });
      }
    });

    pelaksanaNurses.forEach((n, idx) => {
      const patternShift = pelaksanaPattern[(workDaySeq + idx) % pelaksanaPattern.length];
      entries.push({
        id: `nsch-${isoDate}-${n.id}`,
        nurseId: n.id,
        nurseName: n.name,
        date: isoDate,
        shift: patternShift,
        isPjShift: false,
        notes:
          patternShift === 'Libur'
            ? 'Off Dinas Rutin'
            : `Asuhan Pasien Shift ${patternShift}`
      });
    });

    workDaySeq += 1;
  }

  return entries;
}

/**
 * Generates a complete Monthly Doctor Roster (DPJP & Dokter Jaga Ruangan) for all days in (year, month).
 */
export function generateMonthlyDoctorRoster(
  year: number,
  month: number,
  doctors: MasterDoctor[]
): DoctorScheduleEntry[] {
  const activeDoctors = doctors.filter((d) => (d.status || 'aktif') === 'aktif');
  const dpjpDocs = activeDoctors.filter((d) => d.role === 'dpjp' || d.role === 'both');
  const jagaDocs = activeDoctors.filter((d) => d.role === 'dokter_jaga');
  const calendarDays = getMonthCalendarDays(year, month);

  const entries: DoctorScheduleEntry[] = [];
  let workDaySeq = 0;
  let sundaySeq = 0;

  // 10-slot rotation for Dokter Jaga: 3 Pagi, 3 Siang, 1 All-Day/On-Call, 1 On-Call, 2 Libur
  const jagaPattern: DoctorScheduleShiftType[] = [
    'Pagi',
    'Pagi',
    'Siang',
    'Siang',
    'On-Call',
    'On-Call',
    'Libur',
    'Libur',
    'Pagi',
    'Siang'
  ];

  for (const calDay of calendarDays) {
    const { isoDate, isSunday } = calDay;

    if (isSunday) {
      dpjpDocs.forEach((doc, idx) => {
        const isOnCall = dpjpDocs.length > 0 && idx === sundaySeq % dpjpDocs.length;
        entries.push({
          id: `dsch-${isoDate}-${doc.id}`,
          doctorId: doc.id,
          doctorName: doc.name,
          date: isoDate,
          shift: isOnCall ? 'On-Call' : 'Libur',
          role: doc.role,
          spesialisasi: doc.spesialisasi,
          phone: doc.phone,
          notes: isOnCall ? 'DPJP Konsulen Siaga Cito Minggu' : 'Off Akhir Pekan'
        });
      });

      jagaDocs.forEach((doc, idx) => {
        const oc1 = jagaDocs.length > 0 ? (sundaySeq * 2) % jagaDocs.length : -1;
        const oc2 = jagaDocs.length > 1 ? (sundaySeq * 2 + 1) % jagaDocs.length : -1;
        const isOnCall = idx === oc1 || idx === oc2;
        entries.push({
          id: `dsch-${isoDate}-${doc.id}`,
          doctorId: doc.id,
          doctorName: doc.name,
          date: isoDate,
          shift: isOnCall ? 'On-Call' : 'Libur',
          role: doc.role,
          spesialisasi: doc.spesialisasi,
          phone: doc.phone,
          notes: isOnCall ? 'Dokter Jaga Siaga Cito Minggu' : 'Off Akhir Pekan'
        });
      });

      sundaySeq += 1;
      continue;
    }

    // Senin - Sabtu
    const dpjpShifts: DoctorScheduleShiftType[] = ['Pagi', 'Siang', 'On-Call'];
    dpjpDocs.forEach((doc, idx) => {
      const assigned = dpjpShifts[(idx + workDaySeq) % dpjpShifts.length];
      entries.push({
        id: `dsch-${isoDate}-${doc.id}`,
        doctorId: doc.id,
        doctorName: doc.name,
        date: isoDate,
        shift: assigned,
        role: doc.role,
        spesialisasi: doc.spesialisasi,
        phone: doc.phone,
        notes:
          assigned === 'Pagi'
            ? 'DPJP Visite & Preskripsi Shift Pagi'
            : assigned === 'Siang'
            ? 'DPJP Visite & Evaluasi Shift Siang'
            : 'DPJP Konsulen On-Call'
      });
    });

    jagaDocs.forEach((doc, idx) => {
      const assigned = jagaPattern[(idx + workDaySeq * 2) % jagaPattern.length];
      entries.push({
        id: `dsch-${isoDate}-${doc.id}`,
        doctorId: doc.id,
        doctorName: doc.name,
        date: isoDate,
        shift: assigned,
        role: doc.role,
        spesialisasi: doc.spesialisasi,
        phone: doc.phone,
        notes:
          assigned === 'Libur'
            ? 'Off Jaga Rutin'
            : assigned === 'On-Call'
            ? 'Dokter Ruangan Cadangan / On-Call'
            : `Dokter Jaga Standby Shift ${assigned}`
      });
    });

    workDaySeq += 1;
  }

  return entries;
}

export function replaceMonthNurseSchedules(
  existing: NurseScheduleEntry[],
  year: number,
  month: number,
  monthEntries: NurseScheduleEntry[]
): NurseScheduleEntry[] {
  const prefix = `${formatYearMonthPrefix(year, month)}-`;
  const otherMonths = existing.filter((s) => !s.date.startsWith(prefix));
  return [...otherMonths, ...monthEntries];
}

export function replaceMonthDoctorSchedules(
  existing: DoctorScheduleEntry[],
  year: number,
  month: number,
  monthEntries: DoctorScheduleEntry[]
): DoctorScheduleEntry[] {
  const prefix = `${formatYearMonthPrefix(year, month)}-`;
  const otherMonths = existing.filter((d) => !d.date.startsWith(prefix));
  return [...otherMonths, ...monthEntries];
}

export function copyPreviousMonthNurseRoster(
  existing: NurseScheduleEntry[],
  targetYear: number,
  targetMonth: number,
  nurses: MasterNurse[]
): { entries: NurseScheduleEntry[]; copiedCount: number } {
  const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear;
  const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1;
  const prevPrefix = `${formatYearMonthPrefix(prevYear, prevMonth)}-`;
  const prevEntries = existing.filter((s) => s.date.startsWith(prevPrefix));

  if (prevEntries.length === 0) {
    return { entries: existing, copiedCount: 0 };
  }

  const targetDays = getMonthCalendarDays(targetYear, targetMonth);
  const generatedMonth: NurseScheduleEntry[] = [];

  for (const nurse of nurses) {
    for (const calDay of targetDays) {
      const prevIso = `${prevPrefix}${String(calDay.day).padStart(2, '0')}`;
      const match = prevEntries.find(
        (s) => s.date === prevIso && isSameNurseSchedule(s, nurse)
      );
      if (match) {
        generatedMonth.push({
          ...match,
          id: `nsch-${calDay.isoDate}-${nurse.id}`,
          nurseId: nurse.id,
          nurseName: nurse.name,
          date: calDay.isoDate,
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  return {
    entries: replaceMonthNurseSchedules(existing, targetYear, targetMonth, generatedMonth),
    copiedCount: generatedMonth.length
  };
}

export function copyPreviousMonthDoctorRoster(
  existing: DoctorScheduleEntry[],
  targetYear: number,
  targetMonth: number,
  doctors: MasterDoctor[]
): { entries: DoctorScheduleEntry[]; copiedCount: number } {
  const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear;
  const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1;
  const prevPrefix = `${formatYearMonthPrefix(prevYear, prevMonth)}-`;
  const prevEntries = existing.filter((d) => d.date.startsWith(prevPrefix));

  if (prevEntries.length === 0) {
    return { entries: existing, copiedCount: 0 };
  }

  const targetDays = getMonthCalendarDays(targetYear, targetMonth);
  const generatedMonth: DoctorScheduleEntry[] = [];

  for (const doc of doctors) {
    for (const calDay of targetDays) {
      const prevIso = `${prevPrefix}${String(calDay.day).padStart(2, '0')}`;
      const match = prevEntries.find(
        (d) => d.date === prevIso && isSameDoctorSchedule(d, doc)
      );
      if (match) {
        generatedMonth.push({
          ...match,
          id: `dsch-${calDay.isoDate}-${doc.id}`,
          doctorId: doc.id,
          doctorName: doc.name,
          date: calDay.isoDate,
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  return {
    entries: replaceMonthDoctorSchedules(existing, targetYear, targetMonth, generatedMonth),
    copiedCount: generatedMonth.length
  };
}

export interface NurseMonthlyStat {
  pagiCount: number;
  siangCount: number;
  pjCount: number;
  onCallOrMalamCount: number;
  liburOrCutiCount: number;
  activeWorkDays: number;
}

export function computeNurseMonthlyStat(
  nurse: MasterNurse,
  monthDays: MonthCalendarDay[],
  monthEntries: NurseScheduleEntry[]
): NurseMonthlyStat {
  let pagiCount = 0;
  let siangCount = 0;
  let pjCount = 0;
  let onCallOrMalamCount = 0;
  let liburOrCutiCount = 0;

  for (const d of monthDays) {
    const entry = monthEntries.find(
      (s) => s.date === d.isoDate && isSameNurseSchedule(s, nurse)
    );
    const code = entryToNurseMatrixCode(entry);
    if (code === 'P' || code === 'PJ-P') pagiCount += 1;
    if (code === 'S' || code === 'PJ-S') siangCount += 1;
    if (code === 'PJ-P' || code === 'PJ-S') pjCount += 1;
    if (code === 'OC' || code === 'M') onCallOrMalamCount += 1;
    if (code === 'L' || code === 'CT') liburOrCutiCount += 1;
  }

  return {
    pagiCount,
    siangCount,
    pjCount,
    onCallOrMalamCount,
    liburOrCutiCount,
    activeWorkDays: pagiCount + siangCount + onCallOrMalamCount
  };
}

export interface DoctorMonthlyStat {
  pagiCount: number;
  siangCount: number;
  allDayCount: number;
  onCallCount: number;
  liburCount: number;
  activeDutyDays: number;
}

export function computeDoctorMonthlyStat(
  doctor: MasterDoctor,
  monthDays: MonthCalendarDay[],
  monthEntries: DoctorScheduleEntry[]
): DoctorMonthlyStat {
  let pagiCount = 0;
  let siangCount = 0;
  let allDayCount = 0;
  let onCallCount = 0;
  let liburCount = 0;

  for (const d of monthDays) {
    const entry = monthEntries.find(
      (item) => item.date === d.isoDate && isSameDoctorSchedule(item, doctor)
    );
    const code = entryToDoctorMatrixCode(entry);
    if (code === 'P') pagiCount += 1;
    if (code === 'S') siangCount += 1;
    if (code === 'PS') allDayCount += 1;
    if (code === 'OC') onCallCount += 1;
    if (code === 'L') liburCount += 1;
  }

  return {
    pagiCount,
    siangCount,
    allDayCount,
    onCallCount,
    liburCount,
    activeDutyDays: pagiCount + siangCount + allDayCount + onCallCount
  };
}

/**
 * Exports a 2-sheet Excel (.xlsx) workbook containing both Monthly Nurse Matrix and Monthly Doctor Matrix.
 */
export function exportMonthlyScheduleMatrixXlsx(params: {
  year: number;
  month: number;
  nurses: MasterNurse[];
  doctors: MasterDoctor[];
  nurseSchedules: NurseScheduleEntry[];
  doctorSchedules: DoctorScheduleEntry[];
  hospitalName: string;
  unitName: string;
  kepalaRuangan: string;
}): void {
  const {
    year,
    month,
    nurses,
    doctors,
    nurseSchedules,
    doctorSchedules,
    hospitalName,
    unitName,
    kepalaRuangan
  } = params;

  const monthName = INDONESIAN_MONTH_NAMES[month - 1] || String(month);
  const monthDays = getMonthCalendarDays(year, month);
  const prefix = `${formatYearMonthPrefix(year, month)}-`;
  const monthNurseEntries = nurseSchedules.filter((s) => s.date.startsWith(prefix));
  const monthDocEntries = doctorSchedules.filter((d) => d.date.startsWith(prefix));

  const wb = XLSX.utils.book_new();

  // Sheet 1: Matriks Perawat
  const nurseRows: (string | number)[][] = [
    [hospitalName.toUpperCase()],
    [`MATRIKS JADWAL DINAS BULANAN PERAWAT - ${unitName.toUpperCase()}`],
    [`Periode: ${monthName} ${year} | Kepala Ruangan: ${kepalaRuangan}`],
    [
      'Keterangan Kode: P = Pagi, PJ-P = PJ Shift Pagi, S = Siang, PJ-S = PJ Shift Siang, M = Malam, OC = On-Call Cito, L = Libur, CT = Cuti'
    ],
    [],
    [
      'No',
      'Nama Perawat',
      'NIP / NIRA',
      'Jabatan',
      ...monthDays.map((d) => `${d.day} (${d.dayShort})`),
      'Σ Pagi',
      'Σ Siang',
      'Σ PJ',
      'Σ OC/M',
      'Σ L/CT',
      'Total Dinas'
    ]
  ];

  nurses.forEach((nurse, idx) => {
    const roleLabel =
      nurse.role === 'kepala_ruangan'
        ? 'Kepala Ruangan'
        : nurse.role === 'pj_shift'
        ? 'PJ Shift'
        : 'Perawat Pelaksana';
    const dayCodes = monthDays.map((d) => {
      const found = monthNurseEntries.find(
        (s) => s.date === d.isoDate && isSameNurseSchedule(s, nurse)
      );
      return entryToNurseMatrixCode(found);
    });
    const stat = computeNurseMonthlyStat(nurse, monthDays, monthNurseEntries);
    nurseRows.push([
      idx + 1,
      nurse.name,
      nurse.nip || '-',
      roleLabel,
      ...dayCodes,
      stat.pagiCount,
      stat.siangCount,
      stat.pjCount,
      stat.onCallOrMalamCount,
      stat.liburOrCutiCount,
      stat.activeWorkDays
    ]);
  });

  nurseRows.push([]);
  nurseRows.push([
    '',
    'TOTAL DINAS PAGI PER HARI',
    '',
    '',
    ...monthDays.map((d) =>
      monthNurseEntries.filter((s) => s.date === d.isoDate && s.shift === 'Pagi').length
    ),
    '',
    '',
    '',
    '',
    '',
    ''
  ]);
  nurseRows.push([
    '',
    'TOTAL DINAS SIANG PER HARI',
    '',
    '',
    ...monthDays.map((d) =>
      monthNurseEntries.filter((s) => s.date === d.isoDate && s.shift === 'Siang').length
    ),
    '',
    '',
    '',
    '',
    '',
    ''
  ]);

  const wsNurses = XLSX.utils.aoa_to_sheet(nurseRows);
  wsNurses['!cols'] = [
    { wch: 5 },
    { wch: 28 },
    { wch: 16 },
    { wch: 18 },
    ...monthDays.map(() => ({ wch: 6 })),
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 11 }
  ];
  XLSX.utils.book_append_sheet(wb, wsNurses, 'Matriks Perawat');

  // Sheet 2: Matriks Dokter
  const docRows: (string | number)[][] = [
    [hospitalName.toUpperCase()],
    [`MATRIKS JADWAL BULANAN DOKTER (DPJP & DOKTER JAGA) - ${unitName.toUpperCase()}`],
    [`Periode: ${monthName} ${year}`],
    [
      'Keterangan Kode: P = Pagi, S = Siang, PS = Seharian (Pagi & Siang), OC = On-Call Konsulen, L = Libur'
    ],
    [],
    [
      'No',
      'Nama Dokter',
      'Kategori Peran',
      'Spesialisasi / SIP',
      ...monthDays.map((d) => `${d.day} (${d.dayShort})`),
      'Σ Pagi',
      'Σ Siang',
      'Σ PS',
      'Σ On-Call',
      'Σ Libur',
      'Total Aktif'
    ]
  ];

  doctors.forEach((doc, idx) => {
    const roleLabel =
      doc.role === 'dpjp'
        ? 'Dokter DPJP'
        : doc.role === 'both'
        ? 'DPJP & Jaga'
        : 'Dokter Jaga Ruangan';
    const dayCodes = monthDays.map((d) => {
      const found = monthDocEntries.find(
        (item) => item.date === d.isoDate && isSameDoctorSchedule(item, doc)
      );
      return entryToDoctorMatrixCode(found);
    });
    const stat = computeDoctorMonthlyStat(doc, monthDays, monthDocEntries);
    docRows.push([
      idx + 1,
      doc.name,
      roleLabel,
      doc.spesialisasi || doc.sip || '-',
      ...dayCodes,
      stat.pagiCount,
      stat.siangCount,
      stat.allDayCount,
      stat.onCallCount,
      stat.liburCount,
      stat.activeDutyDays
    ]);
  });

  docRows.push([]);
  docRows.push([
    '',
    'TOTAL DPJP AKTIF PER HARI',
    '',
    '',
    ...monthDays.map(
      (d) =>
        monthDocEntries.filter(
          (item) =>
            item.date === d.isoDate &&
            (item.role === 'dpjp' || item.role === 'both') &&
            item.shift !== 'Libur'
        ).length
    ),
    '',
    '',
    '',
    '',
    '',
    ''
  ]);
  docRows.push([
    '',
    'TOTAL DOKTER JAGA AKTIF PER HARI',
    '',
    '',
    ...monthDays.map(
      (d) =>
        monthDocEntries.filter(
          (item) =>
            item.date === d.isoDate &&
            (item.role === 'dokter_jaga' || item.role === 'both') &&
            item.shift !== 'Libur'
        ).length
    ),
    '',
    '',
    '',
    '',
    '',
    ''
  ]);

  const wsDocs = XLSX.utils.aoa_to_sheet(docRows);
  wsDocs['!cols'] = [
    { wch: 5 },
    { wch: 34 },
    { wch: 18 },
    { wch: 28 },
    ...monthDays.map(() => ({ wch: 6 })),
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 9 },
    { wch: 8 },
    { wch: 11 }
  ];
  XLSX.utils.book_append_sheet(wb, wsDocs, 'Matriks Dokter');

  XLSX.writeFile(wb, `Matriks_Jadwal_HD_${monthName}_${year}.xlsx`);
}

// ============================================================================
// MATRIX -> LOGBOOK SHIFT, PJ VERIFIER & DOCTOR AUTO-RESOLUTION HELPERS
// ============================================================================

function normalizeClinicalPersonName(raw?: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(
      /\b(ners|ns|s\.kep\.|s\.kep|a\.md\.kep|a\.md\. kep\.|a\.md|s\.tr\.kep|m\.kep|kep|skep|dr|sp\.pd-kgh|sp\.pd|m\.sc|msc|pw)\b/gi,
      ' '
    )
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMatchingSchedulePersonName(nameA?: string, nameB?: string): boolean {
  const normA = normalizeClinicalPersonName(nameA);
  const normB = normalizeClinicalPersonName(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  return normA.includes(normB) || normB.includes(normA);
}

export interface ResolvedNurseMatrixShift {
  entry?: NurseScheduleEntry;
  matrixCode: NurseMatrixCode;
  logbookShift: 'Pagi' | 'Siang' | null;
  isPjShift: boolean;
  isOffOrLeave: boolean;
  isOnCallOrNight: boolean;
  statusLabel: string;
}

/**
 * Resolves a nurse's scheduled shift from the Administrator's Monthly Matrix for a given ISO date.
 */
export function resolveNurseMatrixShiftForDate(
  nurseSchedules: NurseScheduleEntry[] | undefined,
  nurseIdentity: { id?: string; name?: string },
  dateIso?: string
): ResolvedNurseMatrixShift {
  if (
    !Array.isArray(nurseSchedules) ||
    nurseSchedules.length === 0 ||
    !dateIso ||
    (!nurseIdentity.id && (!nurseIdentity.name || nurseIdentity.name === '-'))
  ) {
    return {
      matrixCode: '-',
      logbookShift: null,
      isPjShift: false,
      isOffOrLeave: false,
      isOnCallOrNight: false,
      statusLabel: 'Belum Terjadwal pada Matriks'
    };
  }

  const found = nurseSchedules.find(
    (s) =>
      s.date === dateIso &&
      ((nurseIdentity.id && s.nurseId === nurseIdentity.id) ||
        isMatchingSchedulePersonName(s.nurseName, nurseIdentity.name))
  );

  const code = entryToNurseMatrixCode(found);
  const meta = getNurseCodeMeta(code);

  if (code === 'P' || code === 'PJ-P') {
    return {
      entry: found,
      matrixCode: code,
      logbookShift: 'Pagi',
      isPjShift: code === 'PJ-P',
      isOffOrLeave: false,
      isOnCallOrNight: false,
      statusLabel: `${meta.label} [${code}]`
    };
  }

  if (code === 'S' || code === 'PJ-S') {
    return {
      entry: found,
      matrixCode: code,
      logbookShift: 'Siang',
      isPjShift: code === 'PJ-S',
      isOffOrLeave: false,
      isOnCallOrNight: false,
      statusLabel: `${meta.label} [${code}]`
    };
  }

  if (code === 'L' || code === 'CT') {
    return {
      entry: found,
      matrixCode: code,
      logbookShift: null,
      isPjShift: false,
      isOffOrLeave: true,
      isOnCallOrNight: false,
      statusLabel: `${meta.label} [${code}]`
    };
  }

  if (code === 'OC' || code === 'M') {
    return {
      entry: found,
      matrixCode: code,
      logbookShift: null,
      isPjShift: false,
      isOffOrLeave: false,
      isOnCallOrNight: true,
      statusLabel: `${meta.label} [${code}]`
    };
  }

  return {
    entry: found,
    matrixCode: '-',
    logbookShift: null,
    isPjShift: false,
    isOffOrLeave: false,
    isOnCallOrNight: false,
    statusLabel: 'Belum Terjadwal pada Matriks'
  };
}

/**
 * Resolves the designated PJ Shift (name & NIP) from the Administrator's Monthly Matrix
 * for a given date & shift ('Pagi' or 'Siang').
 */
export function resolvePjShiftEntryFromMatrix(
  nurseSchedules: NurseScheduleEntry[] | undefined,
  masterNurses: MasterNurse[],
  dateIso: string | undefined,
  shift: 'Pagi' | 'Siang',
  excludeNurseName?: string
): { name: string; nip: string; fromMatrix: boolean } | null {
  if (!Array.isArray(nurseSchedules) || !dateIso) return null;

  const sameDateAndShift = nurseSchedules.filter(
    (s) =>
      s.date === dateIso &&
      s.shift === shift &&
      (!excludeNurseName || !isMatchingSchedulePersonName(s.nurseName, excludeNurseName))
  );

  // Only pick explicit PJ-P / PJ-S manually assigned by user
  const chosen = sameDateAndShift.find(
    (s) =>
      s.isPjShift ||
      (s as any).code === (shift === 'Pagi' ? 'PJ-P' : 'PJ-S') ||
      Boolean(s.notes && s.notes.toLowerCase().includes(`pj shift ${shift.toLowerCase()}`))
  );
  if (!chosen) return null;

  const matchedMaster = masterNurses.find(
    (n) =>
      (chosen!.nurseId && n.id === chosen!.nurseId) ||
      isMatchingSchedulePersonName(n.name, chosen!.nurseName)
  );

  return {
    name: matchedMaster?.name || chosen.nurseName,
    nip: matchedMaster?.nip || '-',
    fromMatrix: true
  };
}

/**
 * Resolves scheduled DPJP & Dokter Jaga from the Administrator's Monthly Doctor Matrix
 * for a given date & shift ('Pagi' or 'Siang').
 *
 * Supports role lookup in masterDoctors, name heuristics (Sp.PD / KGH),
 * and sensible clinical fallbacks (e.g. DPJP Visite Pagi covering afternoon HD sessions).
 */
export function resolveScheduledDoctorsFromMatrix(
  doctorSchedules: DoctorScheduleEntry[] | undefined,
  dateIso: string | undefined,
  shift: 'Pagi' | 'Siang',
  masterDoctors?: MasterDoctor[]
): {
  primaryDpjp: string | null;
  primaryJaga: string | null;
  scheduledDpjpNames: string[];
  scheduledJagaNames: string[];
  onCallNames: string[];
} {
  if (!Array.isArray(doctorSchedules) || doctorSchedules.length === 0 || !dateIso) {
    return {
      primaryDpjp: null,
      primaryJaga: null,
      scheduledDpjpNames: [],
      scheduledJagaNames: [],
      onCallNames: []
    };
  }

  const forDate = doctorSchedules.filter((d) => d && d.date === dateIso);
  if (forDate.length === 0) {
    return {
      primaryDpjp: null,
      primaryJaga: null,
      scheduledDpjpNames: [],
      scheduledJagaNames: [],
      onCallNames: []
    };
  }

  // Helper to determine if a doctor is DPJP or Dokter Jaga
  const resolveRole = (d: DoctorScheduleEntry): 'dpjp' | 'dokter_jaga' | 'both' => {
    if (d.role === 'dpjp' || d.role === 'dokter_jaga' || d.role === 'both') {
      return d.role;
    }
    if (Array.isArray(masterDoctors) && masterDoctors.length > 0) {
      const match = masterDoctors.find(
        (m) =>
          (d.doctorId && m.id === d.doctorId) ||
          isMatchingSchedulePersonName(d.doctorName, m.name)
      );
      if (match?.role) return match.role;
    }
    const nameLower = (d.doctorName || '').toLowerCase();
    const specLower = (d.spesialisasi || '').toLowerCase();
    if (
      nameLower.includes('sp.pd') ||
      nameLower.includes('kgh') ||
      nameLower.includes('heru') ||
      nameLower.includes('muntaqinah') ||
      nameLower.includes('alfany') ||
      specLower.includes('sp.pd') ||
      specLower.includes('kgh') ||
      specLower.includes('ginjal') ||
      specLower.includes('nefrolog')
    ) {
      return 'dpjp';
    }
    return 'dokter_jaga';
  };

  const isDpjp = (d: DoctorScheduleEntry) => {
    const r = resolveRole(d);
    return r === 'dpjp' || r === 'both';
  };

  const isJaga = (d: DoctorScheduleEntry) => {
    const r = resolveRole(d);
    return r === 'dokter_jaga' || r === 'both';
  };

  // DPJP:
  // 1. Direct shift match (shift or All-Day)
  const dpjpOnShift = forDate.filter(
    (d) => isDpjp(d) && (d.shift === shift || d.shift === 'All-Day')
  );
  // 2. Active DPJP on that date (not Libur) - e.g. Visite Pagi covering Siang
  const dpjpActiveOnDate = forDate.filter(
    (d) => isDpjp(d) && d.shift && d.shift !== 'Libur'
  );
  // 3. DPJP On-Call
  const dpjpOnCall = forDate.filter((d) => isDpjp(d) && d.shift === 'On-Call');

  // Dokter Jaga Ruangan:
  // 1. Direct shift match (shift or All-Day)
  const jagaOnShift = forDate.filter(
    (d) => isJaga(d) && (d.shift === shift || d.shift === 'All-Day')
  );
  // 2. Jaga On-Call
  const jagaOnCall = forDate.filter((d) => isJaga(d) && d.shift === 'On-Call');
  // 3. Any active jaga on that date (not Libur)
  const jagaActiveOnDate = forDate.filter(
    (d) => isJaga(d) && d.shift && d.shift !== 'Libur'
  );

  const onCallAll = forDate
    .filter((d) => d.shift === 'On-Call')
    .map((d) => d.doctorName);

  const primaryDpjp =
    dpjpOnShift[0]?.doctorName ||
    dpjpActiveOnDate[0]?.doctorName ||
    dpjpOnCall[0]?.doctorName ||
    null;

  const primaryJaga =
    jagaOnShift[0]?.doctorName ||
    jagaOnCall[0]?.doctorName ||
    jagaActiveOnDate[0]?.doctorName ||
    null;

  const scheduledDpjpNames =
    dpjpOnShift.length > 0
      ? dpjpOnShift.map((d) => d.doctorName)
      : dpjpActiveOnDate.map((d) => d.doctorName);

  const scheduledJagaNames =
    jagaOnShift.length > 0
      ? jagaOnShift.map((d) => d.doctorName)
      : jagaActiveOnDate.map((d) => d.doctorName);

  return {
    primaryDpjp,
    primaryJaga,
    scheduledDpjpNames,
    scheduledJagaNames,
    onCallNames: onCallAll
  };
}

export interface ScheduledShiftNurseInfo {
  id: string;
  name: string;
  role: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan';
  isPjShift: boolean;
}

/**
 * Resolves all active nurses scheduled on a given ISO date and shift ('Pagi' or 'Siang')
 * from the Administrator's Monthly Matrix (`P` / `PJ-P` for Pagi, `S` / `PJ-S` for Siang).
 */
export function resolveScheduledNursesFromMatrix(
  nurseSchedules: NurseScheduleEntry[] | undefined,
  masterNurses: MasterNurse[],
  dateIso: string | undefined,
  shift: 'Pagi' | 'Siang'
): {
  scheduledNurses: ScheduledShiftNurseInfo[];
  hasScheduleForDate: boolean;
} {
  if (!Array.isArray(nurseSchedules) || nurseSchedules.length === 0 || !dateIso) {
    return {
      scheduledNurses: [],
      hasScheduleForDate: false
    };
  }

  const entriesForDate = nurseSchedules.filter((s) => s.date === dateIso);
  if (entriesForDate.length === 0) {
    return {
      scheduledNurses: [],
      hasScheduleForDate: false
    };
  }

  const seenKeys = new Set<string>();
  const scheduledNurses: ScheduledShiftNurseInfo[] = [];

  entriesForDate.forEach((s) => {
    if (s.shift !== shift) return;

    const matchedMaster = masterNurses.find(
      (n) =>
        (s.nurseId && n.id === s.nurseId) ||
        isMatchingSchedulePersonName(n.name, s.nurseName)
    );

    if (matchedMaster && matchedMaster.accountStatus === 'nonaktif') {
      return;
    }

    const dedupKey =
      matchedMaster?.id ||
      s.nurseId ||
      normalizeClinicalPersonName(s.nurseName);
    if (!dedupKey || seenKeys.has(dedupKey)) return;
    seenKeys.add(dedupKey);

    const resolvedRole: 'perawat_pelaksana' | 'pj_shift' | 'kepala_ruangan' =
      matchedMaster?.role === 'kepala_ruangan'
        ? 'kepala_ruangan'
        : s.isPjShift || matchedMaster?.role === 'pj_shift'
        ? 'pj_shift'
        : 'perawat_pelaksana';

    scheduledNurses.push({
      id: matchedMaster?.id || s.nurseId || dedupKey,
      name: matchedMaster?.name || s.nurseName,
      role: resolvedRole,
      isPjShift: Boolean(s.isPjShift)
    });
  });

  return {
    scheduledNurses,
    hasScheduleForDate: true
  };
}

/**
 * Merges local and remote nurse schedules safely without losing user inputs.
 * - If remote is empty, keeps all local entries (prevents wiping on fresh/uninitialized cloud).
 * - Matches by unique key: (nurseId || normalizedNurseName) + '__' + date.
 * - When conflict exists: keeps whichever entry has the more recent `updatedAt` ISO timestamp.
 */
export function mergeNurseSchedules(
  local: NurseScheduleEntry[],
  remote: NurseScheduleEntry[]
): NurseScheduleEntry[] {
  if (!Array.isArray(remote) || remote.length === 0) return local;
  if (!Array.isArray(local) || local.length === 0) return remote;

  const map = new Map<string, NurseScheduleEntry>();

  const getEntryKey = (entry: NurseScheduleEntry): string => {
    const idOrName = (entry.nurseId || normalizeClinicalPersonName(entry.nurseName) || '').trim().toLowerCase();
    return `${idOrName}__${entry.date}`;
  };

  for (const item of local) {
    if (item && item.date) {
      map.set(getEntryKey(item), item);
    }
  }

  for (const item of remote) {
    if (!item || !item.date) continue;
    const key = getEntryKey(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
    } else {
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const remoteTime = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
      if (remoteTime > existingTime) {
        map.set(key, item);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Merges local and remote doctor schedules safely without losing user inputs.
 * - If remote is empty, keeps all local entries (prevents wiping on fresh/uninitialized cloud).
 * - Matches by unique key: (doctorId || normalizedDoctorName) + '__' + date.
 * - When conflict exists: keeps whichever entry has the more recent `updatedAt` ISO timestamp.
 */
export function mergeDoctorSchedules(
  local: DoctorScheduleEntry[],
  remote: DoctorScheduleEntry[]
): DoctorScheduleEntry[] {
  if (!Array.isArray(remote) || remote.length === 0) return local;
  if (!Array.isArray(local) || local.length === 0) return remote;

  const map = new Map<string, DoctorScheduleEntry>();

  const getEntryKey = (entry: DoctorScheduleEntry): string => {
    const idOrName = (entry.doctorId || normalizeClinicalPersonName(entry.doctorName) || '').trim().toLowerCase();
    return `${idOrName}__${entry.date}`;
  };

  for (const item of local) {
    if (item && item.date) {
      map.set(getEntryKey(item), item);
    }
  }

  for (const item of remote) {
    if (!item || !item.date) continue;
    const key = getEntryKey(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
    } else {
      const existingTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const remoteTime = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
      if (remoteTime > existingTime) {
        map.set(key, item);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Detects whether a schedule entry is a legacy auto-generated synthetic mock entry.
 * Used to purge default built-in mock schedules and prevent them from corrupting real user rosters.
 */
export function isLegacySyntheticScheduleEntry(entry?: { id?: string; notes?: string }): boolean {
  if (!entry) return false;

  const syntheticNotes = new Set([
    'supervisi klinis & manajerial unit hd',
    'pj shift pagi (penanggung jawab operasional)',
    'pj shift siang (penanggung jawab operasional)',
    'pj shift pagi operasional',
    'pj shift siang operasional',
    'off dinas rutin',
    'off akhir pekan',
    'bed a01 - a04 (zonasi reguler)',
    'bed a05 - a08 (zonasi reguler)',
    'bed a09 - a12 (zonasi reguler)',
    'bed b01 - b04 (zonasi reguler)',
    'bed b05 - b09 (zonasi reguler)',
    'bed isolasi hep b & hep c (iso 01-04)',
    'asuhan pasien shift pagi',
    'asuhan pasien shift siang',
    'pj siaga hd cito minggu',
    'tim siaga hd cito / icu',
    'dpjp utama shift pagi (visite & preskripsi)',
    'dpjp konsulen shift siang (visite & evaluasi hd)',
    'dpjp konsulen on-call / komplikasi khusus',
    'dokter ruangan standby shift pagi',
    'dokter ruangan standby shift siang',
    'dokter ruangan cadangan / on-call',
    'dpjp visite & preskripsi shift pagi',
    'dpjp visite & evaluasi shift siang',
    'dpjp konsulen on-call',
    'dokter jaga standby shift pagi',
    'dokter jaga standby shift siang',
    'dpjp konsulen siaga cito minggu',
    'dokter jaga siaga cito minggu',
    'off jaga rutin'
  ]);

  const cleanNote = (entry.notes || '').trim().toLowerCase();
  if (cleanNote && syntheticNotes.has(cleanNote)) {
    return true;
  }

  // Detect synthetic benchmark IDs generated by generateBenchmarkNurseSchedules or generateBenchmarkDoctorSchedules
  if (entry.id && (/^nsch-\d{4}-\d{2}-\d{2}-\d{2}$/.test(entry.id) || /^dsch-\d{4}-\d{2}-\d{2}-\d{2}$/.test(entry.id))) {
    return true;
  }

  return false;
}

/**
 * Strips legacy synthetic mock entries from an array of schedules.
 */
export function stripLegacySyntheticSchedules<T extends { id?: string; notes?: string }>(schedules: T[]): T[] {
  if (!Array.isArray(schedules)) return [];
  return schedules.filter((s) => !isLegacySyntheticScheduleEntry(s));
}
