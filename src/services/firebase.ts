import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  enableNetwork,
  setLogLevel
} from 'firebase/firestore';
import rawConfig from '../../firebase-applet-config.json';
import {
  PatientHDSession,
  ShiftInfo,
  OperationalItem,
  SbarData,
  ShiftSignatures,
  MasterPatient,
  MasterNurse,
  MasterBed,
  MasterDoctor,
  NurseScheduleEntry,
  DoctorScheduleEntry
} from '../types/dialysis.ts';

// Dukungan Environment Variables untuk Vercel / deployment produksi dengan fallback ke firebase-applet-config.json
const firebaseConfig = {
  apiKey: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_API_KEY) || rawConfig.apiKey,
  authDomain: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN) || rawConfig.authDomain,
  projectId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_PROJECT_ID) || rawConfig.projectId,
  storageBucket: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET) || rawConfig.storageBucket,
  messagingSenderId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID) || rawConfig.messagingSenderId,
  appId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_APP_ID) || rawConfig.appId,
  firestoreDatabaseId:
    (typeof import.meta !== 'undefined' &&
      (import.meta.env?.VITE_FIREBASE_DATABASE_ID || import.meta.env?.VITE_FIREBASE_FIRESTORE_DATABASE_ID)) ||
    rawConfig.firestoreDatabaseId
};

// Initialize Firebase App singleton
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with custom databaseId
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Initialize Auth
export const auth = getAuth(app);

// Silence Firestore SDK internal transport/retry spam in console
try {
  setLogLevel('silent');
} catch {
  // Gracefully ignore
}

// ============================================================================
// FIRESTORE QUOTA CIRCUIT BREAKER & DEDUPLICATION CACHE
// ============================================================================

let isQuotaExhaustedMemory = false;
const lastWrittenDocHashes = new Map<string, string>();

function hashObject(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(Math.random());
  }
}

/**
 * Returns true if Firestore write quota has been exceeded for the current day.
 */
export function isFirestoreQuotaExhausted(): boolean {
  if (isQuotaExhaustedMemory) return true;
  try {
    if (
      typeof window !== 'undefined' &&
      sessionStorage.getItem('firestore_quota_exhausted') === 'true'
    ) {
      const exhaustedAt = Number(sessionStorage.getItem('firestore_quota_exhausted_at') || '0');
      // If older than 15 minutes, auto-reset to allow fresh retry
      if (Date.now() - exhaustedAt > 15 * 60 * 1000) {
        sessionStorage.removeItem('firestore_quota_exhausted');
        sessionStorage.removeItem('firestore_quota_exhausted_at');
        isQuotaExhaustedMemory = false;
        return false;
      }
      isQuotaExhaustedMemory = true;
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Trips the circuit breaker: flags write quota as exhausted to prevent
 * excessive cloud writes while leaving read channels and connection tests alive.
 */
export function markQuotaExhausted() {
  if (isQuotaExhaustedMemory) return;
  isQuotaExhaustedMemory = true;
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('firestore_quota_exhausted', 'true');
      sessionStorage.setItem('firestore_quota_exhausted_at', String(Date.now()));
      window.dispatchEvent(
        new CustomEvent('firestore_quota_state_change', { detail: { exhausted: true } })
      );
    }
  } catch {
    // ignore
  }
}

/**
 * Manually resets the quota exhaustion flag if the user re-enables network/billing.
 */
export async function resetQuotaExhaustion(): Promise<void> {
  isQuotaExhaustedMemory = false;
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('firestore_quota_exhausted');
      sessionStorage.removeItem('firestore_quota_exhausted_at');
      window.dispatchEvent(
        new CustomEvent('firestore_quota_state_change', { detail: { exhausted: false } })
      );
    }
    await enableNetwork(db);
  } catch {
    // ignore
  }
}

// Test connection on boot as mandated by Firebase skill
async function testConnection() {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes('resource-exhausted') ||
      msg.includes('Quota limit exceeded') ||
      msg.includes('Free daily') ||
      msg.includes('quota metric')
    ) {
      markQuotaExhausted();
      return;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      if (
        isFirestoreQuotaExhausted() ||
        (typeof navigator !== 'undefined' && navigator.onLine === false)
      ) {
        return;
      }
      try {
        await new Promise((res) => setTimeout(res, 2000));
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        if (
          retryMsg.includes('resource-exhausted') ||
          retryMsg.includes('Quota limit exceeded') ||
          retryMsg.includes('Free daily') ||
          retryMsg.includes('quota metric')
        ) {
          markQuotaExhausted();
          return;
        }
        if (
          retryError instanceof Error &&
          retryError.message.includes('the client is offline') &&
          !isFirestoreQuotaExhausted() &&
          typeof navigator !== 'undefined' &&
          navigator.onLine !== false
        ) {
          console.warn('Firestore connection offline or throttled. Using local storage.');
        }
      }
    }
  }
}

if (typeof window !== 'undefined') {
  testConnection();
}

// Clean up any stale quota flags on startup so fresh connection can be established
if (typeof window !== 'undefined') {
  try {
    const lastProjectId = sessionStorage.getItem('last_connected_project_id');
    if (lastProjectId && lastProjectId !== firebaseConfig.projectId) {
      sessionStorage.removeItem('firestore_quota_exhausted');
      sessionStorage.removeItem('firestore_quota_exhausted_at');
      isQuotaExhaustedMemory = false;
    }
    sessionStorage.setItem('last_connected_project_id', firebaseConfig.projectId || '');

    const exhaustedAt = Number(sessionStorage.getItem('firestore_quota_exhausted_at') || '0');
    if (Date.now() - exhaustedAt > 15 * 60 * 1000) {
      sessionStorage.removeItem('firestore_quota_exhausted');
      sessionStorage.removeItem('firestore_quota_exhausted_at');
      isQuotaExhaustedMemory = false;
    }
  } catch {
    // ignore
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errMsg = error instanceof Error ? error.message : String(error);

  const isQuotaError =
    errMsg.includes('resource-exhausted') ||
    errMsg.includes('Quota limit exceeded') ||
    errMsg.includes('Free daily write units') ||
    errMsg.includes('quota metric');

  if (isQuotaError) {
    markQuotaExhausted();
    console.warn(
      `[Firestore Quota] Limit exceeded on ${path || operationType}. Switched to local offline mode.`
    );
    return {
      error: 'Firestore daily write quota reached. Local offline storage active.',
      operationType,
      path,
      authInfo: {
        userId: auth.currentUser?.uid
      }
    };
  }

  // Gracefully handle client offline messages
  if (
    errMsg.includes('the client is offline') ||
    errMsg.includes('Failed to get document because the client is offline')
  ) {
    return {
      error: 'Client offline. Using local storage.',
      operationType,
      path,
      authInfo: { userId: auth.currentUser?.uid }
    };
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email
        })) || []
    },
    operationType,
    path
  };

  if (errMsg.includes('Missing or insufficient permissions')) {
    console.warn(
      `[Firestore Permissions] Permission check on ${path || operationType}. Falling back to local offline storage.`
    );
    return errInfo;
  }

  // Only log genuine unexpected non-quota errors to console
  console.error('Firestore Error:', JSON.stringify(errInfo));
  return errInfo;
}

/**
 * Recursively removes all undefined fields from an object or array to ensure
 * Firestore compatibility (Firestore throws an error when any field value is undefined).
 */
export function cleanFirestoreData<T>(val: T): T {
  if (val === null || val === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) => cleanFirestoreData(item)) as unknown as T;
  }
  if (typeof val === 'object') {
    if (val instanceof Date) return val;
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, any>)) {
      if (v !== undefined) {
        cleaned[k] = cleanFirestoreData(v);
      }
    }
    return cleaned as T;
  }
  return val;
}

/**
 * Validate connection to Cloud Firestore
 */
export async function testFirestoreConnection(): Promise<boolean> {
  if (isFirestoreQuotaExhausted()) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('resource-exhausted') || msg.includes('Quota limit exceeded')) {
      markQuotaExhausted();
      return false;
    }
    if (msg.includes('the client is offline')) {
      return false;
    }
    if (msg.includes('Missing or insufficient permissions')) {
      return false;
    }
    return true;
  }
}

// ============================================================================
// REAL-TIME CLOUD DATA LISTENERS & MUTATIONS
// ============================================================================

/**
 * Listen to live Patient HD Sessions across all staff devices
 */
export function subscribeToDialysisSessions(
  onUpdate: (sessions: PatientHDSession[], fromCache?: boolean) => void,
  onError?: (err: unknown) => void
) {
  const sessionsCol = collection(db, 'dialysis_sessions');
  return onSnapshot(
    sessionsCol,
    (snapshot) => {
      const items: PatientHDSession[] = [];
      snapshot.forEach((d) => {
        const raw = d.data() as PatientHDSession;
        const item = { ...raw, id: d.id };
        items.push(item);
        const { updatedAt, ...restSession } = item;
        const cleaned = cleanFirestoreData({ ...restSession, id: d.id });
        lastWrittenDocHashes.set(`dialysis_sessions/${d.id}`, hashObject(cleaned));
      });
      onUpdate(items, snapshot.metadata.fromCache);
    },
    (error) => {
      const handled = handleFirestoreError(error, OperationType.LIST, 'dialysis_sessions');
      if (onError) onError(handled);
    }
  );
}

/**
 * Save single Patient HD Session to Cloud Firestore (with deduplication & circuit breaker)
 */
export async function saveDialysisSessionCloud(session: PatientHDSession): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const rawId = session.id || `sess-${Date.now()}`;
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `dialysis_sessions/${cleanId}`;

  const { updatedAt, ...restSession } = session;
  const cleaned = cleanFirestoreData({
    ...restSession,
    id: cleanId
  });

  const contentHash = hashObject(cleaned);
  if (lastWrittenDocHashes.get(docKey) === contentHash) {
    return; // Data has not changed; skip redundant Firestore write
  }

  const docRef = doc(db, 'dialysis_sessions', cleanId);
  try {
    await setDoc(docRef, {
      ...cleaned,
      updatedAt: new Date().toISOString()
    });
    lastWrittenDocHashes.set(docKey, contentHash);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docKey);
  }
}

/**
 * Delete a session from Cloud Firestore
 */
export async function deleteDialysisSessionCloud(sessionId: string): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const cleanId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `dialysis_sessions/${cleanId}`;
  const docRef = doc(db, 'dialysis_sessions', cleanId);
  try {
    await deleteDoc(docRef);
    lastWrittenDocHashes.delete(docKey);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docKey);
  }
}

/**
 * Listen to Daily Shift Report (SBAR, signatures, shift info)
 */
export function subscribeToShiftReport(
  dateIsoKey: string,
  shiftKey: string,
  onUpdate: (data: {
    shiftInfo?: Partial<ShiftInfo>;
    sbar?: SbarData;
    signatures?: ShiftSignatures;
    operationalItems?: OperationalItem[];
  }) => void
) {
  const cleanDocKey = `${dateIsoKey}_${shiftKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docRef = doc(db, 'shift_reports', cleanDocKey);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onUpdate(snapshot.data() as any);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `shift_reports/${cleanDocKey}`);
    }
  );
}

/**
 * Save Shift Report to Cloud Firestore (with deduplication & circuit breaker)
 */
export async function saveShiftReportCloud(
  dateIsoKey: string,
  shiftKey: string,
  payload: {
    shiftInfo?: ShiftInfo;
    sbar?: SbarData;
    signatures?: ShiftSignatures;
    operationalItems?: OperationalItem[];
  }
): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const cleanDocKey = `${dateIsoKey}_${shiftKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `shift_reports/${cleanDocKey}`;
  const cleaned = cleanFirestoreData(payload);
  const contentHash = hashObject(cleaned);
  if (lastWrittenDocHashes.get(docKey) === contentHash) {
    return;
  }

  const docRef = doc(db, 'shift_reports', cleanDocKey);
  try {
    await setDoc(
      docRef,
      {
        ...cleaned,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
    lastWrittenDocHashes.set(docKey, contentHash);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docKey);
  }
}

/**
 * Real-time sync for Master Patients
 */
export function subscribeToMasterPatients(
  onUpdate: (patients: MasterPatient[]) => void
) {
  const colRef = collection(db, 'master_patients');
  return onSnapshot(
    colRef,
    (snapshot) => {
      if (!snapshot.empty) {
        const list: MasterPatient[] = [];
        snapshot.forEach((d) => {
          const pat = { ...d.data(), id: d.id } as MasterPatient;
          list.push(pat);
          const docKey = `master_patients/${d.id}`;
          lastWrittenDocHashes.set(docKey, hashObject(cleanFirestoreData(pat)));
        });
        onUpdate(list);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'master_patients');
    }
  );
}

export async function saveMasterPatientsCloud(patients: MasterPatient[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  try {
    for (const p of patients) {
      if (p.id) {
        const cleanId = p.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        const docKey = `master_patients/${cleanId}`;
        const cleaned = cleanFirestoreData(p);
        const contentHash = hashObject(cleaned);
        if (lastWrittenDocHashes.get(docKey) !== contentHash) {
          await setDoc(doc(db, 'master_patients', cleanId), cleaned);
          lastWrittenDocHashes.set(docKey, contentHash);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'master_patients');
  }
}

export async function deleteMasterPatientCloud(patientId: string): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const cleanId = patientId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `master_patients/${cleanId}`;
  const docRef = doc(db, 'master_patients', cleanId);
  try {
    await deleteDoc(docRef);
    lastWrittenDocHashes.delete(docKey);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docKey);
  }
}

/**
 * Real-time sync for Master Nurses
 */
export function subscribeToMasterNurses(onUpdate: (nurses: MasterNurse[]) => void) {
  const colRef = collection(db, 'master_nurses');
  return onSnapshot(
    colRef,
    (snapshot) => {
      if (!snapshot.empty) {
        const list: MasterNurse[] = [];
        snapshot.forEach((d) => {
          const nurse = { ...d.data(), id: d.id } as MasterNurse;
          list.push(nurse);
          const docKey = `master_nurses/${d.id}`;
          lastWrittenDocHashes.set(docKey, hashObject(cleanFirestoreData(nurse)));
        });
        onUpdate(list);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'master_nurses');
    }
  );
}

export async function saveMasterNursesCloud(nurses: MasterNurse[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  try {
    for (const n of nurses) {
      if (n.id) {
        const cleanId = n.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        const docKey = `master_nurses/${cleanId}`;
        const cleaned = cleanFirestoreData(n);
        const contentHash = hashObject(cleaned);
        if (lastWrittenDocHashes.get(docKey) !== contentHash) {
          await setDoc(doc(db, 'master_nurses', cleanId), cleaned);
          lastWrittenDocHashes.set(docKey, contentHash);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'master_nurses');
  }
}

export async function deleteMasterNurseCloud(nurseId: string): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const cleanId = nurseId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `master_nurses/${cleanId}`;
  const docRef = doc(db, 'master_nurses', cleanId);
  try {
    await deleteDoc(docRef);
    lastWrittenDocHashes.delete(docKey);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docKey);
  }
}

/**
 * Real-time sync for Master Beds
 */
export function subscribeToMasterBeds(onUpdate: (beds: MasterBed[]) => void) {
  const colRef = collection(db, 'master_beds');
  return onSnapshot(
    colRef,
    (snapshot) => {
      if (!snapshot.empty) {
        const list: MasterBed[] = [];
        snapshot.forEach((d) => {
          const bed = { ...d.data(), id: d.id } as MasterBed;
          list.push(bed);
          const docKey = `master_beds/${d.id}`;
          lastWrittenDocHashes.set(docKey, hashObject(cleanFirestoreData(bed)));
        });
        onUpdate(list);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'master_beds');
    }
  );
}

export async function saveMasterBedsCloud(beds: MasterBed[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  try {
    for (const b of beds) {
      if (b.id) {
        const cleanId = b.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        const docKey = `master_beds/${cleanId}`;
        const cleaned = cleanFirestoreData(b);
        const contentHash = hashObject(cleaned);
        if (lastWrittenDocHashes.get(docKey) !== contentHash) {
          await setDoc(doc(db, 'master_beds', cleanId), cleaned);
          lastWrittenDocHashes.set(docKey, contentHash);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'master_beds');
  }
}

export async function deleteMasterBedCloud(bedId: string): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const cleanId = bedId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `master_beds/${cleanId}`;
  const docRef = doc(db, 'master_beds', cleanId);
  try {
    await deleteDoc(docRef);
    lastWrittenDocHashes.delete(docKey);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docKey);
  }
}

/**
 * Real-time sync for Master Doctors
 */
export function subscribeToMasterDoctors(onUpdate: (doctors: MasterDoctor[]) => void) {
  const colRef = collection(db, 'master_doctors');
  return onSnapshot(
    colRef,
    (snapshot) => {
      if (!snapshot.empty) {
        const list: MasterDoctor[] = [];
        snapshot.forEach((d) => {
          const docItem = { ...d.data(), id: d.id } as MasterDoctor;
          list.push(docItem);
          const docKey = `master_doctors/${d.id}`;
          lastWrittenDocHashes.set(docKey, hashObject(cleanFirestoreData(docItem)));
        });
        onUpdate(list);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'master_doctors');
    }
  );
}

export async function saveMasterDoctorsCloud(doctors: MasterDoctor[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  try {
    for (const d of doctors) {
      if (d.id) {
        const cleanId = d.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        const docKey = `master_doctors/${cleanId}`;
        const cleaned = cleanFirestoreData(d);
        const contentHash = hashObject(cleaned);
        if (lastWrittenDocHashes.get(docKey) !== contentHash) {
          await setDoc(doc(db, 'master_doctors', cleanId), cleaned);
          lastWrittenDocHashes.set(docKey, contentHash);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'master_doctors');
  }
}

export async function deleteMasterDoctorCloud(doctorId: string): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const cleanId = doctorId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const docKey = `master_doctors/${cleanId}`;
  const docRef = doc(db, 'master_doctors', cleanId);
  try {
    await deleteDoc(docRef);
    lastWrittenDocHashes.delete(docKey);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docKey);
  }
}

/**
 * Real-time sync for Nurse Schedules (persisted under shift_reports for atomic roster sync)
 */
export function subscribeToNurseSchedules(onUpdate: (schedules: NurseScheduleEntry[]) => void) {
  const docRef = doc(db, 'shift_reports', 'roster_nurse_schedules');
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) {
        return;
      }
      if (snapshot.exists()) {
        const d = snapshot.data();
        if (Array.isArray(d?.schedules)) {
          const docKey = 'shift_reports/roster_nurse_schedules';
          const cleaned = cleanFirestoreData({ schedules: d.schedules });
          const contentHash = hashObject(cleaned);
          if (lastWrittenDocHashes.get(docKey) === contentHash) {
            return;
          }
          lastWrittenDocHashes.set(docKey, contentHash);
          onUpdate(d.schedules as NurseScheduleEntry[]);
        } else {
          onUpdate([]);
        }
      } else {
        onUpdate([]);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, 'shift_reports/roster_nurse_schedules');
    }
  );
}

function capScheduleEntriesForCloud<T extends { date: string }>(
  items: T[],
  maxEntries: number = 1900
): T[] {
  if (items.length <= maxEntries) return items;
  return [...items]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(items.length - maxEntries);
}

export async function saveNurseSchedulesCloud(schedules: NurseScheduleEntry[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  if (!Array.isArray(schedules)) {
    return;
  }
  const docKey = 'shift_reports/roster_nurse_schedules';
  const boundedSchedules = capScheduleEntriesForCloud(schedules, 1900);
  const cleaned = cleanFirestoreData({ schedules: boundedSchedules });
  const contentHash = hashObject(cleaned);
  if (lastWrittenDocHashes.get(docKey) === contentHash) {
    return;
  }
  const docRef = doc(db, 'shift_reports', 'roster_nurse_schedules');
  try {
    await setDoc(
      docRef,
      {
        ...cleaned,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
    lastWrittenDocHashes.set(docKey, contentHash);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docKey);
  }
}

/**
 * Real-time sync for Doctor Schedules (persisted under shift_reports for atomic roster sync)
 */
export function subscribeToDoctorSchedules(onUpdate: (schedules: DoctorScheduleEntry[]) => void) {
  const docRef = doc(db, 'shift_reports', 'roster_doctor_schedules');
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) {
        return;
      }
      if (snapshot.exists()) {
        const d = snapshot.data();
        if (Array.isArray(d?.schedules)) {
          const docKey = 'shift_reports/roster_doctor_schedules';
          const cleaned = cleanFirestoreData({ schedules: d.schedules });
          const contentHash = hashObject(cleaned);
          if (lastWrittenDocHashes.get(docKey) === contentHash) {
            return;
          }
          lastWrittenDocHashes.set(docKey, contentHash);
          onUpdate(d.schedules as DoctorScheduleEntry[]);
        } else {
          onUpdate([]);
        }
      } else {
        onUpdate([]);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, 'shift_reports/roster_doctor_schedules');
    }
  );
}

export async function saveDoctorSchedulesCloud(schedules: DoctorScheduleEntry[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  if (!Array.isArray(schedules)) {
    return;
  }
  const docKey = 'shift_reports/roster_doctor_schedules';
  const boundedSchedules = capScheduleEntriesForCloud(schedules, 1900);
  const cleaned = cleanFirestoreData({ schedules: boundedSchedules });
  const contentHash = hashObject(cleaned);
  if (lastWrittenDocHashes.get(docKey) === contentHash) {
    return;
  }
  const docRef = doc(db, 'shift_reports', 'roster_doctor_schedules');
  try {
    await setDoc(
      docRef,
      {
        ...cleaned,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
    lastWrittenDocHashes.set(docKey, contentHash);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docKey);
  }
}

export interface NurseLogbookCloudData {
  nurseName: string;
  managedPatients: any[];
  facilityStatuses?: Record<string, boolean>;
  facilityNotes?: Record<string, string>;
  patientStatuses?: Record<string, Record<string, boolean>>;
  patientNotes?: Record<string, Record<string, string>>;
  clinicalDetails?: Record<string, any>;
  submission?: any;
  patientSubmissions?: Record<string, any>;
  shiftSchedule?: { shift: 'Pagi' | 'Siang'; date: string };
  shiftDoctors?: {
    dokterDpjp?: string;
    dokterJaga?: string;
    isManualDpjp?: boolean;
    isManualJaga?: boolean;
    updatedAtEpoch?: number;
  };
  dateIso?: string;
  logbookDate?: string;
  updatedAt?: string;
}

/**
 * Real-time sync for a specific nurse's personal logbook
 */
export function subscribeToNurseLogbook(
  nurseName: string,
  onUpdate: (data: NurseLogbookCloudData) => void
) {
  if (!nurseName || nurseName === '-') return () => {};
  const cleanKey = nurseName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
  if (!cleanKey) return () => {};
  const docRef = doc(db, 'nurse_logbooks', cleanKey);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onUpdate(snapshot.data() as NurseLogbookCloudData);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `nurse_logbooks/${cleanKey}`);
    }
  );
}

/**
 * Real-time sync for all nurses' personal logbooks across devices so patients and beds
 * already inputted into any nurse's logbook cannot be selected again by other nurses.
 */
export function subscribeToAllNurseLogbooks(
  onUpdate: (logbooks: NurseLogbookCloudData[]) => void
) {
  const colRef = collection(db, 'nurse_logbooks');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list: NurseLogbookCloudData[] = [];
      snapshot.forEach((d) => {
        const raw = d.data() as NurseLogbookCloudData;
        if (raw && typeof raw === 'object') {
          list.push({
            ...raw,
            nurseName: raw.nurseName || d.id
          });
        }
      });
      onUpdate(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, 'nurse_logbooks');
    }
  );
}

/**
 * Save a nurse's personal logbook to Firestore (with deduplication & circuit breaker)
 */
export async function saveNurseLogbookCloud(
  nurseName: string,
  data: Partial<NurseLogbookCloudData>
): Promise<void> {
  if (!nurseName || nurseName === '-') return;
  const cleanKey = nurseName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
  if (!cleanKey) return;
  const docKey = `nurse_logbooks/${cleanKey}`;

  const { updatedAt, ...restData } = data;
  const cleaned = cleanFirestoreData({
    ...restData,
    nurseName
  });

  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('nurse_logbook_local_saved', {
          detail: {
            ...cleaned,
            updatedAt: new Date().toISOString()
          }
        })
      );
    }
  } catch {
    // ignore
  }

  if (isFirestoreQuotaExhausted()) {
    return;
  }

  const contentHash = hashObject(cleaned);
  if (lastWrittenDocHashes.get(docKey) === contentHash) {
    return; // Unchanged data, skip redundant write
  }

  const docRef = doc(db, 'nurse_logbooks', cleanKey);
  try {
    await setDoc(
      docRef,
      {
        ...cleaned,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
    lastWrittenDocHashes.set(docKey, contentHash);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docKey);
  }
}

/**
 * Real-time sync for Verification Registry (PJ Shift & Kepala Ruangan)
 */
export function subscribeToVerificationRegistry(
  onUpdate: (entries: any[]) => void
) {
  const docRef = doc(db, 'verification_registry', 'active_registry');
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        if (Array.isArray(d?.entries)) {
          const docKey = 'verification_registry/active_registry';
          const cleaned = cleanFirestoreData({ entries: d.entries });
          lastWrittenDocHashes.set(docKey, hashObject(cleaned));
          onUpdate(d.entries);
        }
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, 'verification_registry/active_registry');
    }
  );
}

export async function saveVerificationRegistryCloud(entries: any[]): Promise<void> {
  if (isFirestoreQuotaExhausted()) {
    return;
  }
  const docKey = 'verification_registry/active_registry';
  const cleaned = cleanFirestoreData({ entries });
  const contentHash = hashObject(cleaned);
  if (lastWrittenDocHashes.get(docKey) === contentHash) {
    return; // Unchanged, skip redundant write
  }

  const docRef = doc(db, 'verification_registry', 'active_registry');
  try {
    await setDoc(
      docRef,
      {
        ...cleaned,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
    lastWrittenDocHashes.set(docKey, contentHash);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docKey);
  }
}
