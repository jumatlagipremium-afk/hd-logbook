import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
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
import type { NurseScheduleEntry, DoctorScheduleEntry } from '../types/dialysis.ts';
import { sampleBenchmarkNurses, initialMasterDoctors } from './mockMasterData.ts';

function sanitizeScheduleDocId(id: string): string {
  const cleaned = (id || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 128);
  return cleaned || `sch_${Date.now()}`;
}

/**
 * Menghasilkan jadwal perawat benchmark harian yang selaras dengan ID matriks bulanan
 * (`nsch-${dateIso}-${nurse.id}`) apabila koleksi cloud belum pernah diinisialisasi.
 */
export function generateBenchmarkNurseSchedules(dateIso: string): NurseScheduleEntry[] {
  const parsed = new Date(`${dateIso}T00:00:00`);
  const isSunday = !Number.isNaN(parsed.getTime()) && parsed.getDay() === 0;
  const dayOfMonth = !Number.isNaN(parsed.getTime()) ? parsed.getDate() : 1;

  return sampleBenchmarkNurses.map((nurse, idx) => {
    let shift: NurseScheduleEntry['shift'] = 'Pagi';
    let isPjShift = false;

    if (isSunday) {
      shift = idx % 4 === 0 ? 'On-Call' : 'Libur';
    } else if (nurse.role === 'kepala_ruangan') {
      shift = 'Pagi';
      isPjShift = false;
    } else if (nurse.role === 'pj_shift') {
      const pagiFirst = idx % 2 === 0;
      shift = (dayOfMonth + (pagiFirst ? 0 : 1)) % 2 === 1 ? 'Pagi' : 'Siang';
      isPjShift = true;
    } else {
      const cycle = (dayOfMonth + idx) % 6;
      if (cycle === 5) {
        shift = 'Libur';
      } else if (cycle <= 2) {
        shift = 'Pagi';
      } else {
        shift = 'Siang';
      }
    }

    return {
      id: sanitizeScheduleDocId(`nsch-${dateIso}-${nurse.id}`),
      nurseId: nurse.id,
      nurseName: nurse.name,
      nip: nurse.nip,
      role: nurse.role,
      date: dateIso,
      shift,
      isPjShift,
      notes: ''
    };
  });
}

/**
 * Menghasilkan jadwal dokter benchmark harian yang selaras dengan ID matriks bulanan
 * (`dsch-${dateIso}-${doc.id}`) apabila koleksi cloud belum pernah diinisialisasi.
 */
export function generateBenchmarkDoctorSchedules(dateIso: string): DoctorScheduleEntry[] {
  const parsed = new Date(`${dateIso}T00:00:00`);
  const isSunday = !Number.isNaN(parsed.getTime()) && parsed.getDay() === 0;
  const dayOfMonth = !Number.isNaN(parsed.getTime()) ? parsed.getDate() : 1;

  return initialMasterDoctors.map((doctor, idx) => {
    let shift: DoctorScheduleEntry['shift'] = 'Pagi';

    if (doctor.role === 'dpjp' || doctor.role === 'both') {
      shift = isSunday ? 'On-Call' : idx === 0 ? 'All-Day' : idx % 2 === 1 ? 'Pagi' : 'Siang';
    } else {
      if (isSunday) {
        shift = idx % 3 === 0 ? 'On-Call' : 'Libur';
      } else {
        const mod = (dayOfMonth + idx) % 5;
        shift = mod === 0 ? 'Pagi' : mod === 1 ? 'Siang' : 'Libur';
      }
    }

    return {
      id: sanitizeScheduleDocId(`dsch-${dateIso}-${doctor.id}`),
      doctorId: doctor.id,
      doctorName: doctor.name,
      role: doctor.role === 'both' ? 'dpjp' : doctor.role,
      spesialisasi: doctor.spesialisasi,
      sip: doctor.sip,
      phone: doctor.phone,
      date: dateIso,
      shift,
      notes: ''
    };
  });
}

export const initialNurseSchedules: NurseScheduleEntry[] = [];
export const initialDoctorSchedules: DoctorScheduleEntry[] = [];

export function ensureAllOfficialDoctorSchedules(
  existing: DoctorScheduleEntry[],
  dateIso?: string
): DoctorScheduleEntry[] {
  if (Array.isArray(existing) && existing.length > 0) {
    return existing;
  }
  if (!dateIso) return [];
  return generateBenchmarkDoctorSchedules(dateIso);
}

// ============================================================================
// STATUS INISIALISASI CLOUD AGAR JADWAL ADMIN TIDAK KEMBALI KE DEFAULT SAAT REFRESH
// ============================================================================

const SCHEDULE_META_DOC_ID = 'schedule_cloud_meta';
const LOCAL_NURSE_INIT_KEY = 'cloud_nurse_schedule_initialized_v1';
const LOCAL_DOCTOR_INIT_KEY = 'cloud_doctor_schedule_initialized_v1';

let nurseCloudInitializedMem = false;
let doctorCloudInitializedMem = false;

function isCloudAvailable(): boolean {
  return typeof window !== 'undefined' && !isFirestoreQuotaExhausted();
}

async function checkNurseCloudInitialized(): Promise<boolean> {
  if (nurseCloudInitializedMem) return true;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (window.localStorage.getItem(LOCAL_NURSE_INIT_KEY) === 'true') {
        nurseCloudInitializedMem = true;
        return true;
      }
      if (window.localStorage.getItem('dialysis_nurse_schedules_v3_clean') !== null) {
        nurseCloudInitializedMem = true;
        return true;
      }
    } catch {
      // ignore
    }
  }

  if (!isCloudAvailable()) return true;

  try {
    const metaSnap = await getDoc(doc(db, 'shift_reports', SCHEDULE_META_DOC_ID));
    if (metaSnap.exists() && metaSnap.data()?.nurseInitialized === true) {
      nurseCloudInitializedMem = true;
      try {
        window.localStorage.setItem(LOCAL_NURSE_INIT_KEY, 'true');
      } catch {}
      return true;
    }

    const legacySnap = await getDoc(doc(db, 'shift_reports', 'nurse_schedules_all'));
    if (legacySnap.exists()) {
      nurseCloudInitializedMem = true;
      await markScheduleMetaInitialized({ nurseInitialized: true });
      return true;
    }

    const anyDocsSnap = await getDocs(collection(db, 'nurse_schedules'));
    if (!anyDocsSnap.empty) {
      nurseCloudInitializedMem = true;
      await markScheduleMetaInitialized({ nurseInitialized: true });
      return true;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `shift_reports/${SCHEDULE_META_DOC_ID}`);
  }
  return false;
}

async function checkDoctorCloudInitialized(): Promise<boolean> {
  if (doctorCloudInitializedMem) return true;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (window.localStorage.getItem(LOCAL_DOCTOR_INIT_KEY) === 'true') {
        doctorCloudInitializedMem = true;
        return true;
      }
      if (window.localStorage.getItem('dialysis_doctor_schedules_v8_clean') !== null) {
        doctorCloudInitializedMem = true;
        return true;
      }
    } catch {
      // ignore
    }
  }

  if (!isCloudAvailable()) return true;

  try {
    const metaSnap = await getDoc(doc(db, 'shift_reports', SCHEDULE_META_DOC_ID));
    if (metaSnap.exists() && metaSnap.data()?.doctorInitialized === true) {
      doctorCloudInitializedMem = true;
      try {
        window.localStorage.setItem(LOCAL_DOCTOR_INIT_KEY, 'true');
      } catch {}
      return true;
    }

    const legacySnap = await getDoc(doc(db, 'shift_reports', 'doctor_schedules_all'));
    if (legacySnap.exists()) {
      doctorCloudInitializedMem = true;
      await markScheduleMetaInitialized({ doctorInitialized: true });
      return true;
    }

    const anyDocsSnap = await getDocs(collection(db, 'doctor_schedules'));
    if (!anyDocsSnap.empty) {
      doctorCloudInitializedMem = true;
      await markScheduleMetaInitialized({ doctorInitialized: true });
      return true;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `shift_reports/${SCHEDULE_META_DOC_ID}`);
  }
  return false;
}

async function markScheduleMetaInitialized(flags: {
  nurseInitialized?: boolean;
  doctorInitialized?: boolean;
}): Promise<void> {
  if (flags.nurseInitialized) {
    nurseCloudInitializedMem = true;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LOCAL_NURSE_INIT_KEY, 'true');
      }
    } catch {}
  }
  if (flags.doctorInitialized) {
    doctorCloudInitializedMem = true;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LOCAL_DOCTOR_INIT_KEY, 'true');
      }
    } catch {}
  }

  if (!isCloudAvailable()) return;

  try {
    await setDoc(
      doc(db, 'shift_reports', SCHEDULE_META_DOC_ID),
      cleanFirestoreData({
        ...flags,
        updatedAt: new Date().toISOString()
      }),
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `shift_reports/${SCHEDULE_META_DOC_ID}`);
  }
}

export const scheduleService = {
  // 1. Ambil Jadwal Perawat Harian berdasarkan Tanggal Aktif dari Cloud Firestore
  getNurseSchedules: async (dateIso: string): Promise<NurseScheduleEntry[]> => {
    if (!isCloudAvailable()) {
      return [];
    }

    try {
      const q = query(collection(db, 'nurse_schedules'), where('date', '==', dateIso));
      const querySnapshot = await getDocs(q);
      const records: NurseScheduleEntry[] = [];

      querySnapshot.forEach((docSnap) => {
        records.push({
          ...(docSnap.data() as NurseScheduleEntry),
          id: docSnap.id
        });
      });

      if (records.length === 0) {
        const alreadyInitialized = await checkNurseCloudInitialized();
        if (!alreadyInitialized) {
          const benchmark = generateBenchmarkNurseSchedules(dateIso);
          for (const entry of benchmark) {
            const cleanId = sanitizeScheduleDocId(entry.id);
            await setDoc(
              doc(db, 'nurse_schedules', cleanId),
              cleanFirestoreData({ ...entry, id: cleanId, updatedAt: new Date().toISOString() })
            );
          }
          await markScheduleMetaInitialized({ nurseInitialized: true });
          return benchmark;
        }
      } else {
        nurseCloudInitializedMem = true;
      }

      return records;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'nurse_schedules');
      return [];
    }
  },

  // 1b. Ambil Seluruh Jadwal Perawat untuk Matriks Bulanan dari Cloud Firestore
  getAllNurseSchedules: async (): Promise<NurseScheduleEntry[]> => {
    if (!isCloudAvailable()) return [];
    try {
      const querySnapshot = await getDocs(collection(db, 'nurse_schedules'));
      const records: NurseScheduleEntry[] = [];
      querySnapshot.forEach((docSnap) => {
        records.push({
          ...(docSnap.data() as NurseScheduleEntry),
          id: docSnap.id
        });
      });
      if (records.length > 0) {
        nurseCloudInitializedMem = true;
      }
      return records;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'nurse_schedules');
      return [];
    }
  },

  // 2. Simpan Modifikasi Jadwal Perawat oleh Administrator ke Cloud Firestore
  saveNurseSchedule: async (entry: NurseScheduleEntry): Promise<void> => {
    if (!isCloudAvailable()) return;
    const cleanId = sanitizeScheduleDocId(entry.id);
    const docPath = `nurse_schedules/${cleanId}`;
    try {
      await setDoc(
        doc(db, 'nurse_schedules', cleanId),
        cleanFirestoreData({
          ...entry,
          id: cleanId,
          updatedAt: new Date().toISOString()
        }),
        { merge: true }
      );
      await markScheduleMetaInitialized({ nurseInitialized: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  // 2b. Hapus Sel Jadwal Perawat saat dikosongkan ('-') oleh Administrator
  deleteNurseSchedule: async (id: string): Promise<void> => {
    if (!isCloudAvailable()) return;
    const cleanId = sanitizeScheduleDocId(id);
    const docPath = `nurse_schedules/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'nurse_schedules', cleanId));
      await markScheduleMetaInitialized({ nurseInitialized: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  },

  // 2c. Simpan / Ganti Batch Jadwal Bulanan Perawat secara Aman ke Cloud Firestore
  saveNurseSchedulesBatch: async (
    newEntries: NurseScheduleEntry[],
    deletedIds: string[] = []
  ): Promise<void> => {
    if (!isCloudAvailable()) return;
    try {
      await markScheduleMetaInitialized({ nurseInitialized: true });
      const CHUNK_SIZE = 40;

      for (let i = 0; i < deletedIds.length; i += CHUNK_SIZE) {
        const slice = deletedIds.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          slice.map((rawId) => {
            const cleanId = sanitizeScheduleDocId(rawId);
            return deleteDoc(doc(db, 'nurse_schedules', cleanId));
          })
        );
      }

      const nowIso = new Date().toISOString();
      for (let i = 0; i < newEntries.length; i += CHUNK_SIZE) {
        const slice = newEntries.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          slice.map((entry) => {
            const cleanId = sanitizeScheduleDocId(entry.id);
            return setDoc(
              doc(db, 'nurse_schedules', cleanId),
              cleanFirestoreData({
                ...entry,
                id: cleanId,
                updatedAt: nowIso
              }),
              { merge: true }
            );
          })
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'nurse_schedules');
    }
  },

  // 3. Ambil Jadwal Dokter Harian berdasarkan Tanggal Aktif dari Cloud Firestore
  getDoctorSchedules: async (dateIso: string): Promise<DoctorScheduleEntry[]> => {
    if (!isCloudAvailable()) {
      return generateBenchmarkDoctorSchedules(dateIso);
    }

    try {
      const q = query(collection(db, 'doctor_schedules'), where('date', '==', dateIso));
      const querySnapshot = await getDocs(q);
      const records: DoctorScheduleEntry[] = [];

      querySnapshot.forEach((docSnap) => {
        records.push({
          ...(docSnap.data() as DoctorScheduleEntry),
          id: docSnap.id
        });
      });

      if (records.length === 0) {
        const alreadyInitialized = await checkDoctorCloudInitialized();
        if (!alreadyInitialized) {
          const benchmark = generateBenchmarkDoctorSchedules(dateIso);
          for (const entry of benchmark) {
            const cleanId = sanitizeScheduleDocId(entry.id);
            await setDoc(
              doc(db, 'doctor_schedules', cleanId),
              cleanFirestoreData({ ...entry, id: cleanId, updatedAt: new Date().toISOString() })
            );
          }
          await markScheduleMetaInitialized({ doctorInitialized: true });
          return benchmark;
        }
      } else {
        doctorCloudInitializedMem = true;
      }

      return records;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'doctor_schedules');
      return [];
    }
  },

  // 3b. Ambil Seluruh Jadwal Dokter untuk Matriks Bulanan dari Cloud Firestore
  getAllDoctorSchedules: async (): Promise<DoctorScheduleEntry[]> => {
    if (!isCloudAvailable()) return [];
    try {
      const querySnapshot = await getDocs(collection(db, 'doctor_schedules'));
      const records: DoctorScheduleEntry[] = [];
      querySnapshot.forEach((docSnap) => {
        records.push({
          ...(docSnap.data() as DoctorScheduleEntry),
          id: docSnap.id
        });
      });
      if (records.length > 0) {
        doctorCloudInitializedMem = true;
      }
      return records;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'doctor_schedules');
      return [];
    }
  },

  // 4. Simpan Modifikasi Jadwal Dokter oleh Administrator ke Cloud Firestore
  saveDoctorSchedule: async (entry: DoctorScheduleEntry): Promise<void> => {
    if (!isCloudAvailable()) return;
    const cleanId = sanitizeScheduleDocId(entry.id);
    const docPath = `doctor_schedules/${cleanId}`;
    try {
      await setDoc(
        doc(db, 'doctor_schedules', cleanId),
        cleanFirestoreData({
          ...entry,
          id: cleanId,
          updatedAt: new Date().toISOString()
        }),
        { merge: true }
      );
      await markScheduleMetaInitialized({ doctorInitialized: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  // 4b. Hapus Sel Jadwal Dokter saat dikosongkan ('-') oleh Administrator
  deleteDoctorSchedule: async (id: string): Promise<void> => {
    if (!isCloudAvailable()) return;
    const cleanId = sanitizeScheduleDocId(id);
    const docPath = `doctor_schedules/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'doctor_schedules', cleanId));
      await markScheduleMetaInitialized({ doctorInitialized: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  },

  // 4c. Simpan / Ganti Batch Jadwal Bulanan Dokter secara Aman ke Cloud Firestore
  saveDoctorSchedulesBatch: async (
    newEntries: DoctorScheduleEntry[],
    deletedIds: string[] = []
  ): Promise<void> => {
    if (!isCloudAvailable()) return;
    try {
      await markScheduleMetaInitialized({ doctorInitialized: true });
      const CHUNK_SIZE = 40;

      for (let i = 0; i < deletedIds.length; i += CHUNK_SIZE) {
        const slice = deletedIds.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          slice.map((rawId) => {
            const cleanId = sanitizeScheduleDocId(rawId);
            return deleteDoc(doc(db, 'doctor_schedules', cleanId));
          })
        );
      }

      const nowIso = new Date().toISOString();
      for (let i = 0; i < newEntries.length; i += CHUNK_SIZE) {
        const slice = newEntries.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          slice.map((entry) => {
            const cleanId = sanitizeScheduleDocId(entry.id);
            return setDoc(
              doc(db, 'doctor_schedules', cleanId),
              cleanFirestoreData({
                ...entry,
                id: cleanId,
                updatedAt: nowIso
              }),
              { merge: true }
            );
          })
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'doctor_schedules');
    }
  },

  // 5. Real-time Subscription Lintas Perangkat untuk nurse_schedules & doctor_schedules
  subscribeAllNurseSchedules: (
    onUpdate: (entries: NurseScheduleEntry[], isInitialized: boolean) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    if (!isCloudAvailable()) return () => {};
    return onSnapshot(
      collection(db, 'nurse_schedules'),
      (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return;
        const list: NurseScheduleEntry[] = [];
        snapshot.forEach((docSnap) => {
          list.push({
            ...(docSnap.data() as NurseScheduleEntry),
            id: docSnap.id
          });
        });
        if (list.length > 0) {
          nurseCloudInitializedMem = true;
        }
        onUpdate(list, nurseCloudInitializedMem || list.length > 0);
      },
      (err) => {
        if (onError) onError(err);
        try {
          handleFirestoreError(err, OperationType.LIST, 'nurse_schedules');
        } catch {}
      }
    );
  },

  subscribeAllDoctorSchedules: (
    onUpdate: (entries: DoctorScheduleEntry[], isInitialized: boolean) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    if (!isCloudAvailable()) return () => {};
    return onSnapshot(
      collection(db, 'doctor_schedules'),
      (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return;
        const list: DoctorScheduleEntry[] = [];
        snapshot.forEach((docSnap) => {
          list.push({
            ...(docSnap.data() as DoctorScheduleEntry),
            id: docSnap.id
          });
        });
        if (list.length > 0) {
          doctorCloudInitializedMem = true;
        }
        onUpdate(list, doctorCloudInitializedMem || list.length > 0);
      },
      (err) => {
        if (onError) onError(err);
        try {
          handleFirestoreError(err, OperationType.LIST, 'doctor_schedules');
        } catch {}
      }
    );
  }
};
