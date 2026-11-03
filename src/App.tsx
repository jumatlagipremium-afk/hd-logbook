import React, { useState, useMemo, useEffect } from 'react';
import {
  PatientHDSession,
  ShiftInfo,
  MachineOverview,
  OperationalItem,
  SbarData,
  ShiftSignatures,
  MasterPatient,
  MasterNurse,
  MasterBed,
  MasterDoctor,
  NurseScheduleEntry,
  DoctorScheduleEntry,
  SystemAccessRole,
  HdTreatmentDay
} from './types/dialysis.ts';
import {
  initialShiftInfo,
  initialMachineOverview,
  initialOperationalItems,
  initialSbar,
  initialPatients,
  benchmarkShiftInfo,
  benchmarkMachineOverview,
  benchmarkSamplePatients
} from './data/mockShiftData.ts';
import {
  initialMasterPatients,
  initialMasterNurses,
  initialMasterBeds,
  initialMasterDoctors,
  sampleBenchmarkPatients,
  sampleBenchmarkNurses,
  sampleBenchmarkBeds
} from './data/mockMasterData.ts';
import {
  initialNurseSchedules,
  initialDoctorSchedules,
  ensureAllOfficialDoctorSchedules,
  scheduleService
} from './data/mockScheduleData.ts';
import {
  resolveNurseMatrixShiftForDate,
  resolvePjShiftEntryFromMatrix,
  resolveScheduledDoctorsFromMatrix,
  mergeNurseSchedules,
  mergeDoctorSchedules,
  stripLegacySyntheticSchedules,
  applyNurseMatrixCell,
  NurseMatrixCode
} from './utils/monthlyScheduleMatrixHelpers.ts';
import {
  computeCensusAndAccess,
  computeClinicalIndicators
} from './utils/hdCalculator.ts';
import {
  calculateStaffingDetails,
  canAccessMasterData,
  canVerifyLogbook,
  ensureAllOfficialDoctors,
  ensureAndDeduplicateMasterNurses,
  ensureAndDeduplicateMasterBeds,
  normalizeNurseName,
  filterMasterPatientsForActiveSchedule,
  getAccessibleTabs,
  getDefaultTabForRole,
  normalizeMasterPatient,
  resolveDoctorsFromSchedule,
  resolveNurseSystemAccess,
  updateMasterNurseData,
  updateMasterDoctorData
} from './utils/masterDataHelpers.ts';
import { ensureFullBagianData } from './utils/logbookStandards.ts';
import { AppShellLayout, HeaderNavTab } from './components/HeaderNavbar.tsx';
import { PelaksanaView } from './components/PelaksanaView.tsx';
import { LaporanPasienView } from './components/LaporanPasienView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { LapHarianView } from './components/LapHarianView.tsx';
import { VerifikasiView } from './components/VerifikasiView.tsx';
import { RiwayatView } from './components/RiwayatView.tsx';
import { LapBulananView } from './components/LapBulananView.tsx';
import { JadwalDinasView } from './components/JadwalDinasView.tsx';
import { SessionModal } from './components/SessionModal.tsx';
import {
  testFirestoreConnection,
  subscribeToDialysisSessions,
  saveDialysisSessionCloud,
  deleteDialysisSessionCloud,
  subscribeToShiftReport,
  saveShiftReportCloud,
  subscribeToMasterPatients,
  saveMasterPatientsCloud,
  subscribeToMasterNurses,
  saveMasterNursesCloud,
  deleteMasterNurseCloud,
  subscribeToMasterBeds,
  saveMasterBedsCloud,
  deleteMasterBedCloud,
  subscribeToMasterDoctors,
  saveMasterDoctorsCloud,
  subscribeToNurseSchedules,
  saveNurseSchedulesCloud,
  subscribeToDoctorSchedules,
  saveDoctorSchedulesCloud,
  subscribeToVerificationRegistry,
  saveVerificationRegistryCloud,
  subscribeToAllNurseLogbooks,
  type NurseLogbookCloudData,
  isFirestoreQuotaExhausted
} from './services/firebase.ts';
import {
  VERIFICATION_REGISTRY_STORAGE_KEY,
  LogbookVerificationRegistryEntry,
  getVerificationRegistry,
  isMatchingNurse,
  isSameBed,
  isKepalaRuangVerifier,
  getNurseClinicalDetailsKey,
  getNursePatientStatusesKey,
  resetVerificationStorageToBenchmark,
  checkAndResetAllDailyLogbooksIfDayChanged
} from './utils/nurseVerificationHelpers.ts';
import {
  DEFAULT_KEPALA_RUANGAN_NAME,
  aggregateShiftVerifiedLogbooks
} from './utils/dailyReportHelpers.ts';
import { SystemDesignExplainerModal } from './components/SystemDesignExplainerModal.tsx';
import { PrintHelpModal } from './components/PrintHelpModal.tsx';
import { MasterDataManagementModal } from './components/MasterDataManagementModal.tsx';
import { MasterDataView } from './components/MasterDataView.tsx';
import { MyAccountView } from './components/MyAccountView.tsx';
import { LoginPage, LoginUserData } from './components/LoginPage.tsx';
import { useCleanHospitalBackground } from './utils/useCleanHospitalBackground.ts';
import {
  extractActiveDayName,
  formatCurrentWibTimestamp,
  formatIsoDateToIndonesianFull,
  formatShortIndonesianTimestampWib,
  getCurrentIndonesianFullDate,
  getCurrentIsoDateWib,
  indonesianDateLabelToIso
} from './utils/dateHelpers.ts';
import { ManagedPatient, PjVerificationStatus } from './components/Logbook5ButtonsView.tsx';
import {
  PatientLogbookClinicalDetails,
  isPoin3_6Complete,
  normalizePatientClinicalDetails,
  parseClinicalNumber,
  resolveSessionAccessFromPoin3_6,
  resolveSessionComplicationsFromPoin4_3
} from './utils/logbookClinicalHelpers.ts';

function loadPersistedArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }
    }
  } catch {
    // ignore corrupt localStorage
  }
  return fallback;
}

export default function App() {
  const {
    bgSrc: hospitalBgSrc,
    hasError: hospitalBgError,
    onImageError: handleHospitalBgError
  } = useCleanHospitalBackground();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loggedInUser, setLoggedInUser] = useState<LoginUserData | null>(null);
  const [userRole, setUserRole] = useState<SystemAccessRole>('perawat_pelaksana');
  const [, setActiveRole] = useState<'pelaksana' | 'pj_shift'>('pelaksana');
  const [currentTab, setCurrentTab] = useState<HeaderNavTab>('dashboard');
  const [scheduleMatrixTab, setScheduleMatrixTab] = useState<'perawat' | 'dokter'>('perawat');
  const [isCloudConnected, setIsCloudConnected] = useState<boolean>(
    () => !isFirestoreQuotaExhausted()
  );
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(() =>
    isFirestoreQuotaExhausted()
  );

  // ABSOLUTE OVERRIDE INTERCEPTOR: Memaksa inisialisasi awal mutlak ke BAGIAN I unit hemodialisis
  useEffect(() => {
    try {
      localStorage.setItem('dialysis_forced_tab_init_v1', '1');
      localStorage.setItem('dialysis_last_active_bagian_num', '1');
    } catch (e) {}
  }, [isAuthenticated, currentTab]);

  useEffect(() => {
    const handleQuotaChange = (e: any) => {
      const exhausted = Boolean(e?.detail?.exhausted ?? isFirestoreQuotaExhausted());
      setIsQuotaExceeded(exhausted);
      if (exhausted) {
        setIsCloudConnected(false);
      }
    };
    window.addEventListener('firestore_quota_state_change', handleQuotaChange);
    return () => window.removeEventListener('firestore_quota_state_change', handleQuotaChange);
  }, []);

  const [printHelpState, setPrintHelpState] = useState<{
    isOpen: boolean;
    documentTitle?: string;
    errorMessage?: string;
  }>({
    isOpen: false
  });

  useEffect(() => {
    const handlePrintBlocked = (e: any) => {
      setPrintHelpState({
        isOpen: true,
        documentTitle: e?.detail?.documentTitle,
        errorMessage: e?.detail?.error
      });
    };
    window.addEventListener('dialysis_print_blocked', handlePrintBlocked);
    return () => window.removeEventListener('dialysis_print_blocked', handlePrintBlocked);
  }, []);

  const PATIENTS_STORAGE_KEY = 'dialysis_master_patients_v1_stable';
  const BEDS_STORAGE_KEY = 'dialysis_master_beds_v1_stable';
  const NURSES_STORAGE_KEY = 'dialysis_master_nurses_v1_stable';
  const DOCTORS_STORAGE_KEY = 'dialysis_master_doctors_v1_stable';

  const masterPatientsCloudLoadedRef = React.useRef(false);
  const masterPatientsDirtyRef = React.useRef(false);

  const masterNursesCloudLoadedRef = React.useRef(false);
  const masterNursesDirtyRef = React.useRef(false);

  const masterBedsCloudLoadedRef = React.useRef(false);
  const masterBedsDirtyRef = React.useRef(false);

  const masterDoctorsCloudLoadedRef = React.useRef(false);
  const masterDoctorsDirtyRef = React.useRef(false);

  const [masterPatients, setMasterPatients] = useState<MasterPatient[]>(() => {
    try {
      const rawCurrent = localStorage.getItem(PATIENTS_STORAGE_KEY);
      if (rawCurrent) {
        const parsedCurrent = JSON.parse(rawCurrent);
        if (Array.isArray(parsedCurrent) && parsedCurrent.length > 0) {
          return (parsedCurrent as MasterPatient[]).map(normalizeMasterPatient);
        }
      }

      let legacyPatients: MasterPatient[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('master_patients_') && k !== PATIENTS_STORAGE_KEY) {
          const rawLegacy = localStorage.getItem(k);
          if (rawLegacy) {
            try {
              const parsed = JSON.parse(rawLegacy);
              if (Array.isArray(parsed) && parsed.length > legacyPatients.length) {
                legacyPatients = parsed as MasterPatient[];
              }
            } catch {}
          }
        }
      }

      if (legacyPatients.length > 0) {
        const legacyById = new Map(legacyPatients.map((p) => [p.id, p]));
        const merged = initialMasterPatients.map((seedPat) => legacyById.get(seedPat.id) || seedPat);
        const existingCustom = legacyPatients.filter((p) => !p.id?.startsWith('pat-hdhl-'));
        existingCustom.forEach((customPat) => {
          const duplicate = merged.some(
            (s) =>
              s.patientName.trim().toLowerCase() ===
                customPat.patientName.trim().toLowerCase() ||
              (customPat.medicalRecordNumber &&
                s.medicalRecordNumber === customPat.medicalRecordNumber)
          );
          if (!duplicate) {
            merged.push(customPat);
          }
        });
        const normalized = merged.map(normalizeMasterPatient);
        try {
          localStorage.setItem(PATIENTS_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        return normalized;
      }
    } catch {
      // ignore
    }

    return initialMasterPatients.map(normalizeMasterPatient);
  });
  const [masterNurses, setMasterNurses] = useState<MasterNurse[]>(() => {
    try {
      const rawStable = localStorage.getItem(NURSES_STORAGE_KEY);
      if (rawStable) {
        const parsed = JSON.parse(rawStable);
        if (Array.isArray(parsed) && parsed.length >= 17) {
          const { uniqueNurses } = ensureAndDeduplicateMasterNurses(parsed);
          return uniqueNurses;
        }
      }

      const rawV8 = localStorage.getItem('master_nurses_v8_official');
      if (rawV8) {
        const parsed = JSON.parse(rawV8);
        if (Array.isArray(parsed) && parsed.length >= 17) {
          const { uniqueNurses } = ensureAndDeduplicateMasterNurses(parsed);
          try {
            localStorage.setItem(NURSES_STORAGE_KEY, JSON.stringify(uniqueNurses));
          } catch {}
          return uniqueNurses;
        }
      }

      const rawV7 = localStorage.getItem('master_nurses_v7');
      if (rawV7) {
        const parsedV7 = JSON.parse(rawV7);
        if (Array.isArray(parsedV7) && parsedV7.length > 0) {
          const { uniqueNurses } = ensureAndDeduplicateMasterNurses(parsedV7);
          try {
            localStorage.setItem(NURSES_STORAGE_KEY, JSON.stringify(uniqueNurses));
          } catch {}
          return uniqueNurses;
        }
      }
    } catch {
      // ignore
    }
    const { uniqueNurses } = ensureAndDeduplicateMasterNurses(initialMasterNurses);
    return uniqueNurses;
  });

  const [masterBeds, setMasterBeds] = useState<MasterBed[]>(() => {
    try {
      const rawStable = localStorage.getItem(BEDS_STORAGE_KEY);
      if (rawStable) {
        const parsed = JSON.parse(rawStable);
        if (Array.isArray(parsed) && parsed.length >= 40) {
          const { uniqueBeds } = ensureAndDeduplicateMasterBeds(parsed);
          return uniqueBeds;
        }
      }

      const rawV8 = localStorage.getItem('master_beds_v8_official');
      if (rawV8) {
        const parsed = JSON.parse(rawV8);
        if (Array.isArray(parsed) && parsed.length >= 40) {
          const { uniqueBeds } = ensureAndDeduplicateMasterBeds(parsed);
          try {
            localStorage.setItem(BEDS_STORAGE_KEY, JSON.stringify(uniqueBeds));
          } catch {}
          return uniqueBeds;
        }
      }

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('master_beds_') && k !== BEDS_STORAGE_KEY) {
          const raw = localStorage.getItem(k);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length >= 40) {
                const { uniqueBeds } = ensureAndDeduplicateMasterBeds(parsed);
                try {
                  localStorage.setItem(BEDS_STORAGE_KEY, JSON.stringify(uniqueBeds));
                } catch {}
                return uniqueBeds;
              }
            } catch {}
          }
        }
      }
    } catch {
      // ignore
    }
    const { uniqueBeds } = ensureAndDeduplicateMasterBeds(initialMasterBeds);
    return uniqueBeds;
  });

  // Debounced auto-save to localStorage and Firestore ONLY when user explicitly mutates data
  useEffect(() => {
    try {
      localStorage.setItem(PATIENTS_STORAGE_KEY, JSON.stringify(masterPatients));
    } catch {
      // ignore
    }
    if (!masterPatientsDirtyRef.current) return;
    const timer = setTimeout(() => {
      saveMasterPatientsCloud(masterPatients)
        .then(() => {
          masterPatientsDirtyRef.current = false;
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [masterPatients]);

  useEffect(() => {
    try {
      localStorage.setItem(NURSES_STORAGE_KEY, JSON.stringify(masterNurses));
      localStorage.setItem('master_nurses_v8_official', JSON.stringify(masterNurses));
    } catch {
      // ignore
    }
    if (!masterNursesDirtyRef.current) return;
    const timer = setTimeout(() => {
      saveMasterNursesCloud(masterNurses)
        .then(() => {
          masterNursesDirtyRef.current = false;
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [masterNurses]);

  useEffect(() => {
    try {
      localStorage.setItem(BEDS_STORAGE_KEY, JSON.stringify(masterBeds));
      localStorage.setItem('master_beds_v8_official', JSON.stringify(masterBeds));
    } catch {
      // ignore
    }
    if (!masterBedsDirtyRef.current) return;
    const timer = setTimeout(() => {
      saveMasterBedsCloud(masterBeds)
        .then(() => {
          masterBedsDirtyRef.current = false;
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [masterBeds]);

  const [masterDoctors, setMasterDoctors] = useState<MasterDoctor[]>(() => {
    try {
      const persistedStable = localStorage.getItem(DOCTORS_STORAGE_KEY);
      if (persistedStable) {
        const parsed = JSON.parse(persistedStable);
        if (Array.isArray(parsed) && parsed.length >= 13) {
          return ensureAllOfficialDoctors(parsed);
        }
      }
      const persisted = localStorage.getItem('dialysis_master_doctors_v4_13');
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (Array.isArray(parsed) && parsed.length >= 13) {
          const docs = ensureAllOfficialDoctors(parsed);
          try {
            localStorage.setItem(DOCTORS_STORAGE_KEY, JSON.stringify(docs));
          } catch {}
          return docs;
        }
      }
    } catch {
      // ignore
    }
    return ensureAllOfficialDoctors(initialMasterDoctors);
  });

  useEffect(() => {
    try {
      localStorage.setItem(DOCTORS_STORAGE_KEY, JSON.stringify(masterDoctors));
      localStorage.setItem('dialysis_master_doctors_v4_13', JSON.stringify(masterDoctors));
    } catch {
      // ignore
    }
    if (!masterDoctorsDirtyRef.current) return;
    const timer = setTimeout(() => {
      saveMasterDoctorsCloud(masterDoctors)
        .then(() => {
          masterDoctorsDirtyRef.current = false;
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [masterDoctors]);

  const handleUpdateMasterPatients: React.Dispatch<React.SetStateAction<MasterPatient[]>> = React.useCallback(
    (action) => {
      masterPatientsDirtyRef.current = true;
      setMasterPatients(action);
    },
    []
  );

  const handleUpdateMasterNurses: React.Dispatch<React.SetStateAction<MasterNurse[]>> = React.useCallback(
    (action) => {
      masterNursesDirtyRef.current = true;
      setMasterNurses(action);
    },
    []
  );

  const handleUpdateMasterBeds: React.Dispatch<React.SetStateAction<MasterBed[]>> = React.useCallback(
    (action) => {
      masterBedsDirtyRef.current = true;
      setMasterBeds(action);
    },
    []
  );

  const handleUpdateMasterDoctors: React.Dispatch<React.SetStateAction<MasterDoctor[]>> = React.useCallback(
    (action) => {
      masterDoctorsDirtyRef.current = true;
      setMasterDoctors(action);
    },
    []
  );
const RENDERING_FIX_TAB_KEY = 'dialysis_forced_tab_init_v1';
const NURSE_SCHEDULES_STORAGE_KEY = 'dialysis_nurse_schedules_v3_clean';
const DOCTOR_SCHEDULES_STORAGE_KEY = 'dialysis_doctor_schedules_v8_clean';
const [nurseSchedules, setNurseSchedules] = useState<NurseScheduleEntry[]>(() => {
try {
const obsoleteKeys = [
'dialysis_nurse_schedules_v2_monthly',
'dialysis_nurse_schedules_v1'
];
obsoleteKeys.forEach((k) => {
try { localStorage.removeItem(k); } catch {}
});
const rawCurrent = localStorage.getItem(NURSE_SCHEDULES_STORAGE_KEY);
if (rawCurrent) {
const parsed = JSON.parse(rawCurrent);
if (Array.isArray(parsed) && parsed.length > 0) {
return stripLegacySyntheticSchedules(parsed as NurseScheduleEntry[]);
}
}
} catch {
// ignore
}
return [];
});
const [doctorSchedules, setDoctorSchedules] = useState<DoctorScheduleEntry[]>(() => {
try {
const obsoleteKeys = [
'dialysis_doctor_schedules_v7_clean',
'dialysis_doctor_schedules_v5_monthly',
'dialysis_doctor_schedules_v4_13',
'dialysis_doctor_schedules_v2',
'dialysis_doctor_schedules_v1'
];
obsoleteKeys.forEach((k) => {
try { localStorage.removeItem(k); } catch {}
});
const persistedMonthly = localStorage.getItem(DOCTOR_SCHEDULES_STORAGE_KEY);
if (persistedMonthly) {
const parsed = JSON.parse(persistedMonthly);
if (Array.isArray(parsed) && parsed.length > 0) {
return stripLegacySyntheticSchedules(parsed as DoctorScheduleEntry[]);
}
}
} catch {
// ignore
}
return [];
});
const nurseSchedulesCloudLoadedRef = React.useRef(false);
const doctorSchedulesCloudLoadedRef = React.useRef(false);
const nurseSchedulesDirtyRef = React.useRef(false);
const doctorSchedulesDirtyRef = React.useRef(false);
const handleUpdateNurseSchedules: React.Dispatch<React.SetStateAction<NurseScheduleEntry[]>> = React.useCallback(
(action) => {
nurseSchedulesDirtyRef.current = true;
setNurseSchedules(action);
},
[]
);
const handleUpdateDoctorSchedules: React.Dispatch<React.SetStateAction<DoctorScheduleEntry[]>> = React.useCallback(
(action) => {
doctorSchedulesDirtyRef.current = true;
setDoctorSchedules(action);
},
[]
);
useEffect(() => {
try {
localStorage.setItem(NURSE_SCHEDULES_STORAGE_KEY, JSON.stringify(nurseSchedules));
} catch {
// ignore
}
if (!nurseSchedulesCloudLoadedRef.current || !nurseSchedulesDirtyRef.current) {
return;
}
const timer = setTimeout(() => {
saveNurseSchedulesCloud(nurseSchedules)
.then(() => {
nurseSchedulesDirtyRef.current = false;
})
.catch(() => {});
}, 600);
return () => clearTimeout(timer);
}, [nurseSchedules]);
useEffect(() => {
try {
localStorage.setItem(DOCTOR_SCHEDULES_STORAGE_KEY, JSON.stringify(doctorSchedules));
} catch {
// ignore
}
if (!doctorSchedulesCloudLoadedRef.current || !doctorSchedulesDirtyRef.current) {
return;
}
const timer = setTimeout(() => {
saveDoctorSchedulesCloud(doctorSchedules)
.then(() => {
doctorSchedulesDirtyRef.current = false;
})
.catch(() => {});
}, 600);
return () => clearTimeout(timer);
}, [doctorSchedules]);
  useEffect(() => {
    if (isFirestoreQuotaExhausted()) return;
    const unsubN = subscribeToNurseSchedules((cloudSchedules) => {
nurseSchedulesCloudLoadedRef.current = true;
if (Array.isArray(cloudSchedules)) {
const cleanedCloud = stripLegacySyntheticSchedules(cloudSchedules);
if (cleanedCloud.length !== cloudSchedules.length) {
saveNurseSchedulesCloud(cleanedCloud).catch(() => {});
}
if (cleanedCloud.length > 0) {
setNurseSchedules((prevLocal) =>
nurseSchedulesDirtyRef.current
? mergeNurseSchedules(prevLocal, cleanedCloud)
: mergeNurseSchedules(cleanedCloud, prevLocal)
);
} else {
setNurseSchedules((prevLocal) => {
if (prevLocal && prevLocal.length > 0) {
saveNurseSchedulesCloud(prevLocal).catch(() => {});
}
return prevLocal;
});
}
}
});
const unsubD = subscribeToDoctorSchedules((cloudDocs) => {
doctorSchedulesCloudLoadedRef.current = true;
if (Array.isArray(cloudDocs)) {
const cleanedCloudDocs = stripLegacySyntheticSchedules(cloudDocs);
if (cleanedCloudDocs.length !== cloudDocs.length) {
saveDoctorSchedulesCloud(cleanedCloudDocs).catch(() => {});
}
if (cleanedCloudDocs.length > 0) {
setDoctorSchedules((prevLocal) =>
doctorSchedulesDirtyRef.current
? mergeDoctorSchedules(prevLocal, cleanedCloudDocs)
: mergeDoctorSchedules(cleanedCloudDocs, prevLocal)
);
} else {
setDoctorSchedules((prevLocal) => {
if (prevLocal && prevLocal.length > 0) {
saveDoctorSchedulesCloud(prevLocal).catch(() => {});
}
return prevLocal;
});
}
}
});
const unsubCloudNurseCol = scheduleService.subscribeAllNurseSchedules(
(entries, isInitialized) => {
nurseSchedulesCloudLoadedRef.current = true;
if (!isInitialized) return;
const cleaned = stripLegacySyntheticSchedules(entries);
setNurseSchedules((prevLocal) =>
nurseSchedulesDirtyRef.current
? mergeNurseSchedules(prevLocal, cleaned)
: cleaned.length > 0
? mergeNurseSchedules(prevLocal, cleaned)
: prevLocal
);
}
);
const unsubCloudDoctorCol = scheduleService.subscribeAllDoctorSchedules(
(entries, isInitialized) => {
doctorSchedulesCloudLoadedRef.current = true;
if (!isInitialized) return;
const cleaned = stripLegacySyntheticSchedules(entries);
setDoctorSchedules((prevLocal) =>
doctorSchedulesDirtyRef.current
? mergeDoctorSchedules(prevLocal, cleaned)
: cleaned.length > 0
? mergeDoctorSchedules(prevLocal, cleaned)
: prevLocal
);
}
);
    return () => {
      unsubN();
      unsubD();
      unsubCloudNurseCol();
      unsubCloudDoctorCol();
    };
}, []);
const accessibleTabs = useMemo(() => getAccessibleTabs(userRole), [userRole]);
useEffect(() => {
if (!accessibleTabs.includes(currentTab)) {
setCurrentTab(getDefaultTabForRole(userRole));
}
}, [accessibleTabs, currentTab, userRole]);
const handleSelectTab = (tab: HeaderNavTab) => {
const allowed = getAccessibleTabs(userRole);
if (!allowed.includes(tab)) {
setCurrentTab(getDefaultTabForRole(userRole));
return;
}
setCurrentTab(tab);
if (tab === 'dashboard' || tab === 'verifikasi' || tab === 'lap_harian') {
setActiveRole('pj_shift');
} else if (tab === 'logbook') {
setActiveRole('pelaksana');
}
};
const handleRoleChange = (newRole: SystemAccessRole) => {
setUserRole(newRole);
const allowed = getAccessibleTabs(newRole);
if (!allowed.includes(currentTab)) {
const nextDefault = getDefaultTabForRole(newRole);
setCurrentTab(nextDefault);
setActiveRole(nextDefault === 'logbook' ? 'pelaksana' : 'pj_shift');
}
};
const handleLogin = (userData: LoginUserData) => {
setIsAuthenticated(true);
setLoggedInUser(userData);
const role: SystemAccessRole = userData.userRole || 'perawat_pelaksana';
setUserRole(role);
const nextDefault = getDefaultTabForRole(role);
setCurrentTab(nextDefault);
setActiveRole(role === 'pj_shift' || role === 'kepala_ruangan' ? 'pj_shift' : 'pelaksana');
try {
localStorage.setItem(RENDERING_FIX_TAB_KEY, '1');
localStorage.setItem('dialysis_last_active_bagian_num', '1');
} catch {}
const activeIso = isCustomDate
? indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()
: getCurrentIsoDateWib();
const matrixSchedule = resolveNurseMatrixShiftForDate(
nurseSchedules,
{ id: userData.nurseId, name: userData.name },
activeIso
);
const normalizedShift: 'Pagi' | 'Siang' =
matrixSchedule.logbookShift || (userData.shift === 'Siang' ? 'Siang' : 'Pagi');
const matrixPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
masterNurses,
activeIso,
normalizedShift
);
const matchingShiftPj =
masterNurses.find(
(n) =>
n.accountStatus !== 'nonaktif' &&
resolveNurseSystemAccess(n) === 'pj_shift' &&
n.shiftAssigned === normalizedShift &&
n.isOnDutyToday
) ||
masterNurses.find(
(n) =>
n.accountStatus !== 'nonaktif' &&
resolveNurseSystemAccess(n) === 'pj_shift' &&
n.shiftAssigned === normalizedShift
);
const karuNurse = masterNurses.find(
(n) => n.accountStatus !== 'nonaktif' && resolveNurseSystemAccess(n) === 'kepala_ruangan'
);
const resolvedShiftHours =
normalizedShift === 'Siang'
? 'Siang, jam 14.00 - 21.00 WIB'
: 'Pagi, jam 07.00 - 14.00 WIB';
const otherShift = normalizedShift === 'Pagi' ? 'Siang' : 'Pagi';
const matrixNextPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
masterNurses,
activeIso,
otherShift
);
const matrixDocs = resolveScheduledDoctorsFromMatrix(
doctorSchedules,
activeIso,
normalizedShift,
masterDoctors
);
setLoggedInUser({
...userData,
shift: normalizedShift,
shiftHours: resolvedShiftHours
});
setShiftInfo((prev) => ({
...prev,
date: isCustomDate ? prev.date : getCurrentIndonesianFullDate(),
shift: normalizedShift,
shiftHours: resolvedShiftHours,
dokterDpjp: matrixDocs.primaryDpjp || prev.dokterDpjp,
dokterJaga: matrixDocs.primaryJaga || prev.dokterJaga,
pjShift:
matrixPj?.name ||
matchingShiftPj?.name ||
(role === 'pj_shift' && userData.name
? userData.name
: prev.pjShift && prev.pjShift !== '-'
? prev.pjShift
: '-'),
pjShiftBerikutnya:
matrixNextPj?.name ||
(normalizedShift === 'Pagi'
? masterNurses.find(
(n) =>
n.accountStatus !== 'nonaktif' &&
resolveNurseSystemAccess(n) === 'pj_shift' &&
n.shiftAssigned === 'Siang'
)?.name || prev.pjShiftBerikutnya
: prev.pjShiftBerikutnya),
kepalaRuangan: karuNurse?.name || DEFAULT_KEPALA_RUANGAN_NAME
}));
};
const handleLogbookShiftChange = (
nextShift: 'Pagi' | 'Siang',
explicitCode?: NurseMatrixCode
) => {
const nextShiftHours =
nextShift === 'Siang'
? 'Siang, jam 14.00 - 21.00 WIB'
: 'Pagi, jam 07.00 - 14.00 WIB';
try {
localStorage.setItem('dialysis_last_logbook_shift', nextShift);
} catch {
// ignore
}
const activeIso = isCustomDate
? indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()
: getCurrentIsoDateWib();
if (loggedInUser?.name) {
const currentNurse: MasterNurse =
masterNurses.find((n) => loggedInUser.nurseId && n.id === loggedInUser.nurseId) ||
masterNurses.find((n) => isMatchingNurse(n.name, loggedInUser.name)) || {
id: loggedInUser.nurseId || `nurse-${loggedInUser.name.toLowerCase().replace(/\s+/g, '-')}`,
name: loggedInUser.name,
nip: loggedInUser.nip || '-',
pernefriCertified: true,
isOnDutyToday: true,
role:
userRole === 'kepala_ruangan'
? 'kepala_ruangan'
: userRole === 'pj_shift'
? 'pj_shift'
: 'perawat_pelaksana'
};
const resolvedRole = userRole || resolveNurseSystemAccess(currentNurse);
let targetCode: NurseMatrixCode = explicitCode || (nextShift === 'Siang' ? 'S' : 'P');
if (!explicitCode && resolvedRole === 'pj_shift') {
targetCode = nextShift === 'Siang' ? 'PJ-S' : 'PJ-P';
}
handleUpdateNurseSchedules((prevSchedules) =>
applyNurseMatrixCell(
prevSchedules,
currentNurse,
activeIso,
targetCode,
`Dirubah via sistem oleh ${loggedInUser.name} (${formatCurrentWibTimestamp()})`
)
);
}
const matrixPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
masterNurses,
activeIso,
nextShift
);
const matrixNextPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
masterNurses,
activeIso,
nextShift === 'Pagi' ? 'Siang' : 'Pagi'
);
const matrixDocs = resolveScheduledDoctorsFromMatrix(
doctorSchedules,
activeIso,
nextShift,
masterDoctors
);
setShiftInfo((prev) => ({
...prev,
shift: nextShift,
shiftHours: nextShiftHours,
dokterDpjp: matrixDocs.primaryDpjp || prev.dokterDpjp,
dokterJaga: matrixDocs.primaryJaga || prev.dokterJaga,
pjShift: matrixPj?.name || prev.pjShift,
pjShiftBerikutnya: matrixNextPj?.name || prev.pjShiftBerikutnya
}));
setLoggedInUser((prev) =>
prev
? {
...prev,
shift: nextShift,
shiftHours: nextShiftHours
}
: prev
);
};
const handleActiveDateChange = (nextIsoDate: string) => {
if (!nextIsoDate) return;
const todayIso = getCurrentIsoDateWib();
const formatted = formatIsoDateToIndonesianFull(nextIsoDate);
setIsCustomDate(nextIsoDate !== todayIso);
const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
const matrixPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
masterNurses,
nextIsoDate,
activeShift
);
const matrixNextPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
masterNurses,
nextIsoDate,
activeShift === 'Pagi' ? 'Siang' : 'Pagi'
);
const matrixDocs = resolveScheduledDoctorsFromMatrix(
doctorSchedules,
nextIsoDate,
activeShift,
masterDoctors
);
setShiftInfo((prev) => ({
...prev,
date: formatted,
dokterDpjp: matrixDocs.primaryDpjp || prev.dokterDpjp,
dokterJaga: matrixDocs.primaryJaga || prev.dokterJaga,
pjShift: matrixPj?.name || prev.pjShift,
pjShiftBerikutnya: matrixNextPj?.name || prev.pjShiftBerikutnya
}));
};
const handleResetDateToToday = () => {
setIsCustomDate(false);
const todayIso = getCurrentIsoDateWib();
const wasReset = checkAndResetAllDailyLogbooksIfDayChanged(todayIso);
if (wasReset && typeof window !== 'undefined') {
window.dispatchEvent(
new CustomEvent('dialysis_day_changed', { detail: { todayIso } })
);
}
setShiftInfo((prev) => ({
...prev,
date: getCurrentIndonesianFullDate()
}));
};
const handleLogout = () => {
setIsAuthenticated(false);
setLoggedInUser(null);
setUserRole('perawat_pelaksana');
setCurrentTab('dashboard');
setActiveRole('pelaksana');
try { localStorage.removeItem(RENDERING_FIX_TAB_KEY); } catch {}
};
const [isCustomDate, setIsCustomDate] = useState(false);
const [shiftInfo, setShiftInfo] = useState(() => {
if (typeof window !== 'undefined') {
checkAndResetAllDailyLogbooksIfDayChanged(getCurrentIsoDateWib());
}
return {
...initialShiftInfo,
date: getCurrentIndonesianFullDate()
};
});
useEffect(() => {
const todayIso = getCurrentIsoDateWib();
checkAndResetAllDailyLogbooksIfDayChanged(todayIso);
if (isCustomDate) return;
const syncLiveDate = () => {
const liveDateLabel = getCurrentIndonesianFullDate();
const currentTodayIso = getCurrentIsoDateWib();
const wasReset = checkAndResetAllDailyLogbooksIfDayChanged(currentTodayIso);
if (wasReset && typeof window !== 'undefined') {
window.dispatchEvent(
new CustomEvent('dialysis_day_changed', { detail: { todayIso: currentTodayIso } })
);
}
setShiftInfo((prev) => (prev.date === liveDateLabel ? prev : { ...prev, date: liveDateLabel }));
};
syncLiveDate();
const timerId = window.setInterval(syncLiveDate, 10000);
return () => window.clearInterval(timerId);
}, [isCustomDate]);
useEffect(() => {
const activeIso = isCustomDate
? indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()
: getCurrentIsoDateWib();
const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
const matrixDocs = resolveScheduledDoctorsFromMatrix(
doctorSchedules,
activeIso,
activeShift,
masterDoctors
);
if (matrixDocs.primaryDpjp || matrixDocs.primaryJaga) {
setShiftInfo((prev) => {
const nextDpjp = matrixDocs.primaryDpjp || prev.dokterDpjp;
const nextJaga = matrixDocs.primaryJaga || prev.dokterJaga;
if (nextDpjp === prev.dokterDpjp && nextJaga === prev.dokterJaga) {
return prev;
}
return {
...prev,
dokterDpjp: nextDpjp,
dokterJaga: nextJaga
};
});
}
}, [doctorSchedules, shiftInfo.date, shiftInfo.shift, isCustomDate, masterDoctors]);
const isDateCustomFromToday =
isCustomDate && indonesianDateLabelToIso(shiftInfo.date) !== getCurrentIsoDateWib();
const [operationalItems, setOperationalItems] = useState<OperationalItem[]>(() =>
loadPersistedArray('dialysis_operational_v1', initialOperationalItems)
);
const [sbar, setSbar] = useState(() => {
try {
const saved = localStorage.getItem('dialysis_sbar_v1');
if (saved) return JSON.parse(saved);
} catch {
// ignore
}
return initialSbar;
});
useEffect(() => {
try {
localStorage.setItem('dialysis_operational_v1', JSON.stringify(operationalItems));
} catch {
// ignore
}
}, [operationalItems]);
useEffect(() => {
try {
localStorage.setItem('dialysis_sbar_v1', JSON.stringify(sbar));
} catch {
// ignore
}
}, [sbar]);
const [sessions, setSessions] = useState<PatientHDSession[]>(() =>
loadPersistedArray('dialysis_sessions_v6', initialPatients).map(
ensureFullBagianData
)
);
useEffect(() => {
try {
localStorage.setItem('dialysis_sessions_v6', JSON.stringify(sessions));
} catch {
// ignore
}
}, [sessions]);
useEffect(() => {
testFirestoreConnection().then((connected) => {
setIsCloudConnected(connected);
});
}, []);
useEffect(() => {
const unsubscribe = subscribeToDialysisSessions((cloudSessions, fromCache) => {
setIsCloudConnected(true);
if (cloudSessions.length > 0 || !fromCache) {
setSessions(cloudSessions.map(ensureFullBagianData));
}
});
return () => unsubscribe();
}, []);
const [cloudNurseLogbooks, setCloudNurseLogbooks] = useState<NurseLogbookCloudData[]>([]);
useEffect(() => {
const unsub = subscribeToAllNurseLogbooks((logbooks) => {
setCloudNurseLogbooks(logbooks);
});
const handleLocalNurseSave = (e: Event) => {
const detail = (e as CustomEvent).detail;
if (!detail || !detail.nurseName) return;
setCloudNurseLogbooks((prev) => {
const idx = prev.findIndex((item) => isMatchingNurse(item.nurseName, detail.nurseName));
if (idx >= 0) {
const next = [...prev];
next[idx] = { ...next[idx], ...detail };
return next;
}
return [...prev, detail];
});
};
window.addEventListener('nurse_logbook_local_saved', handleLocalNurseSave);
return () => {
unsub();
window.removeEventListener('nurse_logbook_local_saved', handleLocalNurseSave);
};
}, []);
  useEffect(() => {
    const unsub = subscribeToMasterPatients((cloudPatients) => {
      masterPatientsCloudLoadedRef.current = true;
      if (Array.isArray(cloudPatients) && cloudPatients.length > 0) {
        setMasterPatients((prevLocal) => {
          if (masterPatientsDirtyRef.current) return prevLocal;
          const normalized = cloudPatients.map(normalizeMasterPatient);
          try {
            localStorage.setItem(PATIENTS_STORAGE_KEY, JSON.stringify(normalized));
          } catch {}
          return normalized;
        });
      } else if (Array.isArray(cloudPatients) && cloudPatients.length === 0) {
        setMasterPatients((prevLocal) => {
          if (prevLocal.length > 0) {
            saveMasterPatientsCloud(prevLocal).catch(() => {});
          }
          return prevLocal;
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isFirestoreQuotaExhausted()) return;
    const unsub = subscribeToMasterDoctors((cloudDoctors) => {
      masterDoctorsCloudLoadedRef.current = true;
      if (Array.isArray(cloudDoctors) && cloudDoctors.length > 0) {
        setMasterDoctors((prevLocal) => {
          if (masterDoctorsDirtyRef.current) return prevLocal;
          const officialDocs = ensureAllOfficialDoctors(cloudDoctors);
          try {
            localStorage.setItem(DOCTORS_STORAGE_KEY, JSON.stringify(officialDocs));
          } catch {}
          return officialDocs;
        });
      } else if (Array.isArray(cloudDoctors) && cloudDoctors.length === 0) {
        setMasterDoctors((prevLocal) => {
          if (prevLocal.length > 0) {
            saveMasterDoctorsCloud(prevLocal).catch(() => {});
          }
          return prevLocal;
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToMasterNurses((cloudNurses) => {
      masterNursesCloudLoadedRef.current = true;
      if (Array.isArray(cloudNurses) && cloudNurses.length > 0) {
        setMasterNurses((prevLocal) => {
          if (masterNursesDirtyRef.current) return prevLocal;
          const { uniqueNurses, duplicateIdsRemoved } = ensureAndDeduplicateMasterNurses(cloudNurses);
          if (duplicateIdsRemoved.length > 0) {
            duplicateIdsRemoved.forEach((dupId) => {
              deleteMasterNurseCloud(dupId).catch(() => {});
            });
          }
          const mapped = uniqueNurses.map((n) => ({
            ...n,
            systemAccess: resolveNurseSystemAccess(n)
          }));
          try {
            localStorage.setItem(NURSES_STORAGE_KEY, JSON.stringify(mapped));
          } catch {}
          return mapped;
        });
      } else if (Array.isArray(cloudNurses) && cloudNurses.length === 0) {
        setMasterNurses((prevLocal) => {
          if (prevLocal.length > 0) {
            saveMasterNursesCloud(prevLocal).catch(() => {});
          }
          return prevLocal;
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isFirestoreQuotaExhausted()) return;
    const unsub = subscribeToMasterBeds((cloudBeds) => {
      masterBedsCloudLoadedRef.current = true;
      if (Array.isArray(cloudBeds) && cloudBeds.length > 0) {
        setMasterBeds((prevLocal) => {
          if (masterBedsDirtyRef.current) return prevLocal;
          const { uniqueBeds, duplicateIdsRemoved } = ensureAndDeduplicateMasterBeds(cloudBeds);
          if (duplicateIdsRemoved.length > 0) {
            duplicateIdsRemoved.forEach((dupId) => {
              deleteMasterBedCloud(dupId).catch(() => {});
            });
          }
          try {
            localStorage.setItem(BEDS_STORAGE_KEY, JSON.stringify(uniqueBeds));
          } catch {}
          return uniqueBeds;
        });
      } else if (Array.isArray(cloudBeds) && cloudBeds.length === 0) {
        setMasterBeds((prevLocal) => {
          if (prevLocal.length > 0) {
            saveMasterBedsCloud(prevLocal).catch(() => {});
          }
          return prevLocal;
        });
      }
    });
    return () => unsub();
  }, []);
useEffect(() => {
const unsub = subscribeToVerificationRegistry((cloudEntries) => {
if (Array.isArray(cloudEntries) && cloudEntries.length > 0) {
try {
localStorage.setItem(VERIFICATION_REGISTRY_STORAGE_KEY, JSON.stringify(cloudEntries));
window.dispatchEvent(new CustomEvent('verification_registry_updated'));
} catch {
// ignore
}
}
});
return () => unsub();
}, []);
const handleSyncNurseLogbookSessions = (
nurseName: string,
managedPatients: ManagedPatient[],
verification: {
status: PjVerificationStatus;
verifiedAt?: string;
verifiedBy?: string;
verifiedByRole?: string;
verifierNotes?: string;
date?: string;
sessionDate?: string;
shift?: 'Pagi' | 'Siang';
dokterDpjp?: string;
dokterJaga?: string;
clinicalDetails?: Record<string, PatientLogbookClinicalDetails>;
patientStatuses?: Record<string, Record<string, boolean>>;
perPatientStatuses?: Record<
string,
{
status: PjVerificationStatus;
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
>;
}
) => {
if (!nurseName) return;
const activeDateIso =
verification.sessionDate ||
(verification.date ? indonesianDateLabelToIso(verification.date) : indonesianDateLabelToIso(shiftInfo.date)) ||
getCurrentIsoDateWib();
const activeDateLabel =
verification.date || shiftInfo.date || getCurrentIndonesianFullDate();
const activeShift = verification.shift || shiftInfo.shift;
let clinicalDetailsMap: Record<string, PatientLogbookClinicalDetails> =
verification.clinicalDetails || {};
if (Object.keys(clinicalDetailsMap).length === 0) {
try {
const rawClin = localStorage.getItem(getNurseClinicalDetailsKey(nurseName));
if (rawClin) {
const parsedClin = JSON.parse(rawClin);
if (parsedClin && typeof parsedClin === 'object') {
clinicalDetailsMap = parsedClin;
}
}
} catch {
// ignore
}
}
let patientStatusesMap: Record<string, Record<string, boolean>> =
verification.patientStatuses || {};
if (Object.keys(patientStatusesMap).length === 0) {
try {
const rawStat = localStorage.getItem(getNursePatientStatusesKey(nurseName));
if (rawStat) {
const parsedStat = JSON.parse(rawStat);
if (parsedStat && typeof parsedStat === 'object') {
patientStatusesMap = parsedStat;
}
}
} catch {
// ignore
}
}
setSessions((prev) => {
const unaffectedSessions = prev.filter((s) => {
const isSameNurse = isMatchingNurse(s.nurseInCharge, nurseName);
if (!isSameNurse) return true;
const sDateIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
const isSameDate = sDateIso === activeDateIso;
const isSameShift = !s.shift || s.shift === activeShift;
return !(isSameDate && isSameShift);
});
const existingCurrentDateSessions = prev.filter((s) => {
const isSameNurse = isMatchingNurse(s.nurseInCharge, nurseName);
if (!isSameNurse) return false;
const sDateIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
const isSameDate = sDateIso === activeDateIso;
const isSameShift = !s.shift || s.shift === activeShift;
return isSameDate && isSameShift;
});
const syncedMySessions: PatientHDSession[] = managedPatients.map((mp, idx) => {
const patVerif = verification.perPatientStatuses?.[mp.id];
const cleanMpRm = mp.medicalRecord?.trim();
const cleanMpName = mp.patientName.toLowerCase().trim();
const patClinical = normalizePatientClinicalDetails(clinicalDetailsMap[mp.id]);
const patStatusChecks = patientStatusesMap[mp.id] || patientStatusesMap[mp.bedNumber];
const resolvedVascNurse = patClinical.poin3_6.vascularAccessNurse?.trim() || nurseName;
const resolvedPoin3_6Done =
patStatusChecks && typeof patStatusChecks['3.6'] === 'boolean'
? patStatusChecks['3.6']
: isPoin3_6Complete(patClinical.poin3_6);
const bbPreVal = parseClinicalNumber(patClinical.poin3_2.bbPre);
const bbPostVal = parseClinicalNumber(patClinical.poin3_2.bbPost);
const bbKeringVal = parseClinicalNumber(patClinical.poin3_2.bbKering);
const tdPreHdVal = patClinical.poin3_3.tdPreHd?.trim() || '';
const durasiVal = parseClinicalNumber(patClinical.poin3_5.waktuDialisis);
const targetUfgVal = parseClinicalNumber(patClinical.poin3_5.targetUfg);
const qbVal = parseClinicalNumber(patClinical.poin3_5.qb);
const qdVal = parseClinicalNumber(patClinical.poin3_5.qd);
const heparinVal = patClinical.poin3_5.dosisHeparin.trim();
const resolvedComp = resolveSessionComplicationsFromPoin4_3(patClinical.poin4_3);
const postBpVal = patClinical.poin6_3?.tdPostHd?.trim() || '';
const achievedUfgVal = parseClinicalNumber(patClinical.poin6_3?.ufgTercapai);
const ktvNumVal = parseClinicalNumber(patClinical.poin6_3?.ktV);
const ktvVal = ktvNumVal !== null ? ktvNumVal : patClinical.poin6_3?.ktV?.trim() || undefined;
const foundExisting = existingCurrentDateSessions.find((s) => {
if (cleanMpRm && s.medicalRecordNumber?.trim() === cleanMpRm) return true;
if (isSameBed(s.bedNumber, mp.bedNumber)) return true;
if (cleanMpName && s.patientName.toLowerCase().trim() === cleanMpName) return true;
return false;
});
if (foundExisting) {
const resolvedAccess = resolveSessionAccessFromPoin3_6(
patClinical.poin3_6,
foundExisting.vascularAccess,
foundExisting.accessSite || 'AVF Radiocephalica'
);
const baseExistingNote = (foundExisting.nurseNotes || '')
.replace(/\s*Komplikasi HD:[^]*]/g, '')
.trim();
const syncedExistingNote = resolvedComp.hasAnyInput
? resolvedComp.activeCount > 0
? `${baseExistingNote ? `${baseExistingNote} ` : ''}[Komplikasi HD: ${resolvedComp.activeSummary}]`
: baseExistingNote || undefined
: foundExisting.nurseNotes;
const effectiveStatus: PjVerificationStatus = patVerif
? patVerif.status
: foundExisting.revisionRequested && foundExisting.verificationStatus === 'belum_diajukan'
? 'belum_diajukan'
: foundExisting.isVerifiedByPj || foundExisting.verificationStatus === 'terverifikasi'
? 'terverifikasi'
: verification.status;
const isPatVerified = effectiveStatus === 'terverifikasi';
const isPatRevision =
effectiveStatus === 'belum_diajukan' &&
Boolean(
patVerif?.revisionRequested ??
foundExisting.revisionRequested ??
(patVerif?.verifierNotes || foundExisting.verifierNotes)
);
const resolvedVerifiedBy =
patVerif?.verifiedBy || verification.verifiedBy || foundExisting.verifiedBy;
const resolvedVerifiedByRole =
patVerif?.verifiedByRole ||
verification.verifiedByRole ||
foundExisting.verifiedByRole;
const isPatKaru =
isPatVerified && isKepalaRuangVerifier(resolvedVerifiedByRole, resolvedVerifiedBy);
const p31Status = patClinical.poin3_1?.status;
const p31Ruang = patClinical.poin3_1?.ruangRawatInap;
const p31Kat = patClinical.poin3_1?.kategori;
const syncedStatus =
p31Status === 'RAWAT INAP'
? 'ranap'
: p31Status === 'RAWAT JALAN'
? 'rajal'
: foundExisting.status;
const syncedCategory =
p31Kat === 'ISOLASI HEPATITIS B'
? 'hepatitis_b'
: p31Kat === 'ISOLASI HEPATITIS C/HIV'
? 'hepatitis_c'
: p31Kat === 'REGULER'
? 'reguler'
: foundExisting.category;
return ensureFullBagianData({
...foundExisting,
bedNumber: mp.bedNumber,
patientName: mp.patientName,
medicalRecordNumber: mp.medicalRecord || foundExisting.medicalRecordNumber,
status: syncedStatus,
category: syncedCategory,
isCito:
p31Status === 'RAWAT INAP' && p31Ruang === 'ICU'
? true
: foundExisting.isCito,
vascularAccess: resolvedAccess.vascularAccess,
accessSite: resolvedAccess.accessSite,
dryWeight:
bbKeringVal !== null && bbKeringVal > 0 ? bbKeringVal : foundExisting.dryWeight,
preWeight:
bbPreVal !== null && bbPreVal > 0 ? bbPreVal : foundExisting.preWeight,
postWeight:
bbPostVal !== null && bbPostVal > 0 ? bbPostVal : foundExisting.postWeight,
preBp: tdPreHdVal || foundExisting.preBp,
postBp: postBpVal || foundExisting.postBp,
durationPrescribed:
durasiVal !== null && durasiVal > 0 ? durasiVal : foundExisting.durationPrescribed,
durationActual:
durasiVal !== null && durasiVal > 0 ? durasiVal : foundExisting.durationActual,
targetUf:
targetUfgVal !== null && targetUfgVal >= 0
? Math.round(targetUfgVal)
: foundExisting.targetUf,
achievedUf:
achievedUfgVal !== null && achievedUfgVal >= 0
? Math.round(achievedUfgVal)
: targetUfgVal !== null && targetUfgVal >= 0
? Math.round(targetUfgVal)
: foundExisting.achievedUf,
ktV: ktvVal !== undefined ? ktvVal : foundExisting.ktV,
bloodFlowQb:
qbVal !== null && qbVal > 0 ? Math.round(qbVal) : foundExisting.bloodFlowQb,
dialysateFlowQd:
qdVal !== null && qdVal > 0 ? Math.round(qdVal) : foundExisting.dialysateFlowQd,
hasHypotension: resolvedComp.hasAnyInput
? resolvedComp.hasHypotension
: foundExisting.hasHypotension,
hypotensionBp: resolvedComp.hasAnyInput
? resolvedComp.hypotensionBp
: foundExisting.hypotensionBp,
hypotensionAction: resolvedComp.hasAnyInput
? resolvedComp.hypotensionAction
: foundExisting.hypotensionAction,
hasMuscleCramps: resolvedComp.hasAnyInput
? resolvedComp.hasMuscleCramps
: foundExisting.hasMuscleCramps,
muscleCrampAction: resolvedComp.hasAnyInput
? resolvedComp.muscleCrampAction
: foundExisting.muscleCrampAction,
hasClotting: resolvedComp.hasAnyInput
? resolvedComp.hasClotting
: foundExisting.hasClotting,
clottingDetails: resolvedComp.hasAnyInput
? resolvedComp.clottingDetails
: foundExisting.clottingDetails,
hasFirstUseSyndrome: resolvedComp.hasAnyInput
? resolvedComp.hasFirstUseSyndrome
: foundExisting.hasFirstUseSyndrome,
firstUseDetails: resolvedComp.hasAnyInput
? resolvedComp.firstUseDetails
: foundExisting.firstUseDetails,
hasAccessBleeding: resolvedComp.hasAnyInput
? resolvedComp.hasAccessBleeding
: foundExisting.hasAccessBleeding,
accessBleedingAction: resolvedComp.hasAnyInput
? resolvedComp.accessBleedingAction
: foundExisting.accessBleedingAction,
hasConsultDpjp:
resolvedComp.hasAnyInput &&
(resolvedComp.hasPenurunanKesadaran || resolvedComp.hasFirstUseSyndrome)
? true
: foundExisting.hasConsultDpjp,
complicationNames: resolvedComp.hasAnyInput
? resolvedComp.complicationNames
: foundExisting.complicationNames,
consultAdvice: resolvedComp.hasAnyInput
? (resolvedComp.doctorAdviceSummary || undefined)
: foundExisting.consultAdvice,
bagian4: resolvedComp.hasAnyInput ? undefined : foundExisting.bagian4,
nurseInCharge: nurseName,
vascularAccessNurse: resolvedVascNurse,
poin3_6Completed: resolvedPoin3_6Done,
dokterDpjp: verification.dokterDpjp || foundExisting.dokterDpjp,
dokterJaga: verification.dokterJaga || foundExisting.dokterJaga,
nurseNotes: syncedExistingNote,
date: activeDateLabel,
sessionDate: activeDateIso,
shift: activeShift,
isVerifiedByPj: isPatVerified,
isVerifiedByKepalaRuang: isPatKaru,
verificationStatus: effectiveStatus,
submittedAt: patVerif?.submittedAt || foundExisting.submittedAt,
submittedEpoch: patVerif?.submittedEpoch ?? foundExisting.submittedEpoch,
verifiedAt: isPatVerified
? patVerif?.verifiedAt || verification.verifiedAt || foundExisting.verifiedAt
: undefined,
verifiedBy: isPatVerified ? resolvedVerifiedBy : undefined,
verifiedByRole: isPatVerified ? resolvedVerifiedByRole : undefined,
verifierNotes:
effectiveStatus === 'diajukan'
? undefined
: patVerif?.verifierNotes ??
verification.verifierNotes ??
foundExisting.verifierNotes,
revisionRequested: isPatRevision,
revisionRequestedAt: isPatRevision
? patVerif?.revisionRequestedAt || foundExisting.revisionRequestedAt
: undefined,
revisionRequestedBy: isPatRevision
? patVerif?.revisionRequestedBy || foundExisting.revisionRequestedBy
: undefined,
revisionRequestedByRole: isPatRevision
? patVerif?.revisionRequestedByRole || foundExisting.revisionRequestedByRole
: undefined,
revisionEpoch: isPatRevision
? patVerif?.revisionEpoch ?? foundExisting.revisionEpoch
: undefined,
updatedAt: new Date().toISOString()
});
}
const masterMatch = masterPatients.find(
(m) =>
(cleanMpRm && m.medicalRecordNumber === cleanMpRm) ||
m.patientName.toLowerCase().trim() === cleanMpName
);
const defaultDry =
bbKeringVal !== null && bbKeringVal > 0
? bbKeringVal
: masterMatch?.defaultDryWeight || 60.0;
const defaultPre =
bbPreVal !== null && bbPreVal > 0 ? bbPreVal : defaultDry + 2.4;
const defaultPost =
bbPostVal !== null && bbPostVal > 0 ? bbPostVal : defaultDry;
const defaultTargetUf =
targetUfgVal !== null && targetUfgVal >= 0 ? Math.round(targetUfgVal) : 2400;
const defaultDur = durasiVal !== null && durasiVal > 0 ? durasiVal : 4.5;
const resolvedAccess = resolveSessionAccessFromPoin3_6(
patClinical.poin3_6,
masterMatch?.defaultVascularAccess || 'av_fistula',
masterMatch?.defaultAccessSite || 'AVF Radiocephalica'
);
const newEffectiveStatus: PjVerificationStatus =
patVerif?.status || verification.status;
const isNewVerified = newEffectiveStatus === 'terverifikasi';
const resolvedNewVerifiedBy = patVerif?.verifiedBy || verification.verifiedBy;
const resolvedNewVerifiedByRole = patVerif?.verifiedByRole || verification.verifiedByRole;
const isNewKaru =
isNewVerified &&
isKepalaRuangVerifier(resolvedNewVerifiedByRole, resolvedNewVerifiedBy);
const p31Status = patClinical.poin3_1?.status;
const p31Ruang = patClinical.poin3_1?.ruangRawatInap;
const p31Kat = patClinical.poin3_1?.kategori;
const initialStatus =
p31Status === 'RAWAT INAP'
? 'ranap'
: p31Status === 'RAWAT JALAN'
? 'rajal'
: masterMatch?.defaultStatus || 'rajal';
const initialCategory =
p31Kat === 'ISOLASI HEPATITIS B'
? 'hepatitis_b'
: p31Kat === 'ISOLASI HEPATITIS C/HIV'
? 'hepatitis_c'
: p31Kat === 'REGULER'
? 'reguler'
: masterMatch?.category || 'reguler';
return ensureFullBagianData({
id: `sess-lb-${activeDateIso}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
date: activeDateLabel,
sessionDate: activeDateIso,
bedNumber: mp.bedNumber,
patientName: mp.patientName,
medicalRecordNumber:
mp.medicalRecord || masterMatch?.medicalRecordNumber || `4529${idx + 1}`,
age: masterMatch?.age || 54,
gender: masterMatch?.gender || 'L',
status: initialStatus,
category: initialCategory,
sessionStatus: 'selesai',
isCito: p31Status === 'RAWAT INAP' && p31Ruang === 'ICU',
shift: activeShift,
vascularAccess: resolvedAccess.vascularAccess,
accessSite: resolvedAccess.accessSite,
dialyzerModel: masterMatch?.defaultDialyzer || 'SAS HF 18',
isReuse: false,
dryWeight: defaultDry,
preWeight: defaultPre,
postWeight: defaultPost,
targetUf: defaultTargetUf,
achievedUf:
achievedUfgVal !== null && achievedUfgVal >= 0
? Math.round(achievedUfgVal)
: defaultTargetUf,
durationPrescribed: defaultDur,
durationActual: defaultDur,
bloodFlowQb: qbVal !== null && qbVal > 0 ? Math.round(qbVal) : 220,
dialysateFlowQd: qdVal !== null && qdVal > 0 ? Math.round(qdVal) : 500,
preBp: tdPreHdVal || '140/85',
postBp: postBpVal || '125/80',
ktV: ktvVal !== undefined ? ktvVal : 1.8,
hasHypotension: resolvedComp.hasHypotension,
hypotensionBp: resolvedComp.hypotensionBp,
hypotensionAction: resolvedComp.hypotensionAction,
hasMuscleCramps: resolvedComp.hasMuscleCramps,
muscleCrampAction: resolvedComp.muscleCrampAction,
hasClotting: resolvedComp.hasClotting,
clottingDetails: resolvedComp.clottingDetails,
hasFirstUseSyndrome: resolvedComp.hasFirstUseSyndrome,
firstUseDetails: resolvedComp.firstUseDetails,
hasAccessBleeding: resolvedComp.hasAccessBleeding,
accessBleedingAction: resolvedComp.accessBleedingAction,
hasConsultDpjp:
resolvedComp.hasPenurunanKesadaran || resolvedComp.hasFirstUseSyndrome,
complicationNames: resolvedComp.complicationNames,
consultAdvice: resolvedComp.doctorAdviceSummary || undefined,
underUfTolerated: false,
nurseInCharge: nurseName,
vascularAccessNurse: resolvedVascNurse,
poin3_6Completed: resolvedPoin3_6Done,
dokterDpjp: verification.dokterDpjp,
dokterJaga: verification.dokterJaga,
nurseNotes: `${heparinVal ? `Asuhan HD & SPO Bagian I–VI lengkap (Dosis Heparin: ${heparinVal}).` : 'Asuhan hemodialisis & checklist SPO Bagian I–VI terisi lengkap.'}${resolvedComp.activeCount > 0 ? ` [Komplikasi HD: ${resolvedComp.activeSummary}]` : ''}`,
isVerifiedByPj: isNewVerified,
isVerifiedByKepalaRuang: isNewKaru,
verificationStatus: newEffectiveStatus,
submittedAt: patVerif?.submittedAt,
submittedEpoch: patVerif?.submittedEpoch,
verifiedAt: isNewVerified ? patVerif?.verifiedAt || verification.verifiedAt : undefined,
verifiedBy: isNewVerified ? resolvedNewVerifiedBy : undefined,
verifiedByRole: isNewVerified ? resolvedNewVerifiedByRole : undefined,
verifierNotes:
newEffectiveStatus === 'diajukan'
? undefined
: patVerif?.verifierNotes ?? verification.verifierNotes,
revisionRequested:
newEffectiveStatus === 'belum_diajukan' && Boolean(patVerif?.revisionRequested),
revisionRequestedAt:
newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionRequestedAt : undefined,
revisionRequestedBy:
newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionRequestedBy : undefined,
revisionRequestedByRole:
newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionRequestedByRole : undefined,
revisionEpoch:
newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionEpoch : undefined,
updatedAt: new Date().toISOString()
});
});
const syncedIds = new Set(syncedMySessions.map((s) => s.id));
existingCurrentDateSessions.forEach((oldSess) => {
if (!syncedIds.has(oldSess.id)) {
deleteDialysisSessionCloud(oldSess.id).catch(() => {});
}
});
syncedMySessions.forEach((sessionItem) => {
saveDialysisSessionCloud(sessionItem).catch((err) => {
console.warn('Could not sync session to Firestore:', err);
});
});
return [...unaffectedSessions, ...syncedMySessions];
});
};
const handleNurseVerificationUpdated = (
nurseName: string,
status: PjVerificationStatus,
details: {
verifiedAt?: string;
verifiedBy?: string;
verifiedByRole?: string;
verifierNotes?: string;
revisionRequested?: boolean;
revisionRequestedAt?: string;
revisionRequestedBy?: string;
revisionRequestedByRole?: string;
revisionEpoch?: number;
shift?: string;
dateKey?: string;
dateLabel?: string;
}
) => {
const isVerified = status === 'terverifikasi';
const isRevision = status === 'belum_diajukan' && Boolean(details.revisionRequested);
const isKaru =
isVerified && isKepalaRuangVerifier(details.verifiedByRole, details.verifiedBy);
const targetShift: 'Pagi' | 'Siang' | undefined = details.shift
? details.shift.toLowerCase().includes('siang')
? 'Siang'
: 'Pagi'
: undefined;
const targetDateIso =
details.dateKey ||
(details.dateLabel ? indonesianDateLabelToIso(details.dateLabel) : '');
setSessions((prev) =>
prev.map((s) => {
if (!isMatchingNurse(s.nurseInCharge, nurseName)) return s;
if (targetShift && s.shift && s.shift !== targetShift) return s;
if (targetDateIso) {
const sIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
if (sIso && sIso !== targetDateIso) return s;
}
if (isVerified && s.verificationStatus === 'belum_diajukan') {
return s;
}
const updatedSession: PatientHDSession = {
...s,
date: s.date || details.dateLabel || shiftInfo.date,
sessionDate: s.sessionDate || targetDateIso || indonesianDateLabelToIso(shiftInfo.date),
shift: s.shift || targetShift || shiftInfo.shift,
isVerifiedByPj: isVerified,
isVerifiedByKepalaRuang: isKaru,
verificationStatus: status,
verifiedAt: isVerified ? details.verifiedAt : undefined,
verifiedBy: isVerified ? details.verifiedBy : undefined,
verifiedByRole: isVerified ? details.verifiedByRole : undefined,
verifierNotes: details.verifierNotes,
revisionRequested: isRevision,
revisionRequestedAt: isRevision ? details.revisionRequestedAt : undefined,
revisionRequestedBy: isRevision ? details.revisionRequestedBy : undefined,
revisionRequestedByRole: isRevision ? details.revisionRequestedByRole : undefined,
revisionEpoch: isRevision ? details.revisionEpoch : undefined
};
saveDialysisSessionCloud(updatedSession).catch(() => {});
return updatedSession;
})
);
};
const handleVerifyPatientSession = (
patientIdentifier: { bedNumber?: string; patientName?: string; medicalRecord?: string },
verified: boolean,
details: {
verifiedAt?: string;
verifiedBy?: string;
verifiedByRole?: string;
verifierNotes?: string;
revisionRequested?: boolean;
revisionRequestedAt?: string;
revisionRequestedBy?: string;
revisionRequestedByRole?: string;
revisionEpoch?: number;
nurseName?: string;
shift?: string;
dateKey?: string;
dateLabel?: string;
}
) => {
const isKaru =
verified && isKepalaRuangVerifier(details.verifiedByRole, details.verifiedBy);
const resolvedDetailShift: 'Pagi' | 'Siang' = details.shift
? details.shift.toLowerCase().includes('siang')
? 'Siang'
: 'Pagi'
: shiftInfo.shift === 'Siang'
? 'Siang'
: 'Pagi';
const resolvedDetailDateLabel = details.dateLabel || shiftInfo.date;
const resolvedDetailDateIso =
details.dateKey ||
indonesianDateLabelToIso(resolvedDetailDateLabel) ||
getCurrentIsoDateWib();
setSessions((prev) => {
let matched = false;
const cleanTargetName = (patientIdentifier.patientName || '').toLowerCase().trim();
const cleanTargetRm = patientIdentifier.medicalRecord?.trim();
let fallbackVascNurse: string | undefined;
let fallbackPoin3_6Done: boolean | undefined;
if (details.nurseName) {
const matchedCloudLb = cloudNurseLogbooks.find((lb) =>
isMatchingNurse(lb.nurseName, details.nurseName!)
);
let mpList: Array<{ id?: string; bedNumber?: string; medicalRecord?: string; patientName?: string }> =
Array.isArray(matchedCloudLb?.managedPatients) ? matchedCloudLb!.managedPatients : [];
let clinMap: Record<string, unknown> =
(matchedCloudLb?.clinicalDetails as Record<string, unknown>) || {};
let statMap: Record<string, Record<string, boolean>> = matchedCloudLb?.patientStatuses || {};
if (Object.keys(clinMap).length === 0) {
try {
const rawClin = localStorage.getItem(getNurseClinicalDetailsKey(details.nurseName));
if (rawClin) clinMap = JSON.parse(rawClin) || {};
} catch {
// ignore
}
}
if (Object.keys(statMap).length === 0) {
try {
const rawStat = localStorage.getItem(getNursePatientStatusesKey(details.nurseName));
if (rawStat) statMap = JSON.parse(rawStat) || {};
} catch {
// ignore
}
}
const matchedMp = mpList.find(
(m) =>
(cleanTargetRm && m.medicalRecord?.trim() === cleanTargetRm) ||
(patientIdentifier.bedNumber && isSameBed(m.bedNumber, patientIdentifier.bedNumber)) ||
(cleanTargetName && m.patientName?.toLowerCase().trim() === cleanTargetName)
);
const lookupKey = matchedMp?.id || patientIdentifier.bedNumber || '';
const rawClinItem =
(lookupKey && clinMap[lookupKey]) ||
(patientIdentifier.bedNumber && clinMap[patientIdentifier.bedNumber]);
if (rawClinItem) {
const normClin = normalizePatientClinicalDetails(rawClinItem);
fallbackVascNurse = normClin.poin3_6.vascularAccessNurse?.trim() || details.nurseName;
const checks =
(lookupKey && statMap[lookupKey]) ||
(patientIdentifier.bedNumber ? statMap[patientIdentifier.bedNumber] : undefined);
fallbackPoin3_6Done =
checks && typeof checks['3.6'] === 'boolean'
? checks['3.6']
: isPoin3_6Complete(normClin.poin3_6);
}
}
const updated = prev.map((s) => {
if (
details.nurseName &&
s.nurseInCharge &&
!isMatchingNurse(s.nurseInCharge, details.nurseName)
) {
return s;
}
if (details.shift && s.shift && s.shift !== resolvedDetailShift) {
return s;
}
if (details.dateKey || details.dateLabel) {
const sIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
if (sIso && sIso !== resolvedDetailDateIso) {
return s;
}
}
const matchesRm = Boolean(cleanTargetRm && s.medicalRecordNumber?.trim() === cleanTargetRm);
const matchesBed = isSameBed(s.bedNumber, patientIdentifier.bedNumber);
const matchesName =
cleanTargetName.length > 3 && s.patientName.toLowerCase().trim() === cleanTargetName;
if (matchesRm || matchesBed || matchesName) {
matched = true;
const targetDateLabel = s.date || resolvedDetailDateLabel;
const targetDateIso = s.sessionDate || resolvedDetailDateIso;
const effectiveOwner = s.nurseInCharge || details.nurseName || shiftInfo.pjShift;
const updatedSession: PatientHDSession = {
...s,
date: targetDateLabel,
sessionDate: targetDateIso,
shift: s.shift || resolvedDetailShift,
nurseInCharge: effectiveOwner,
vascularAccessNurse:
fallbackVascNurse || s.vascularAccessNurse || effectiveOwner,
poin3_6Completed:
fallbackPoin3_6Done ?? s.poin3_6Completed ?? true,
isVerifiedByPj: verified,
isVerifiedByKepalaRuang: isKaru,
verificationStatus: (verified ? 'terverifikasi' : 'belum_diajukan') as
| 'terverifikasi'
| 'belum_diajukan',
verifiedAt: verified ? details.verifiedAt : undefined,
verifiedBy: verified ? details.verifiedBy : undefined,
verifiedByRole: verified ? details.verifiedByRole : undefined,
verifierNotes: details.verifierNotes,
revisionRequested: !verified,
revisionRequestedAt: !verified ? details.revisionRequestedAt : undefined,
revisionRequestedBy: !verified ? details.revisionRequestedBy : undefined,
revisionRequestedByRole: !verified ? details.revisionRequestedByRole : undefined,
revisionEpoch: !verified ? details.revisionEpoch || Date.now() : undefined,
updatedAt: new Date().toISOString()
};
saveDialysisSessionCloud(updatedSession).catch(() => {});
return updatedSession;
}
return s;
});
if (!matched && verified && (patientIdentifier.patientName || patientIdentifier.bedNumber)) {
const masterMatch = masterPatients.find(
(m) =>
(cleanTargetRm && m.medicalRecordNumber === cleanTargetRm) ||
(cleanTargetName && m.patientName.toLowerCase().trim() === cleanTargetName)
);
const dryWeight = masterMatch?.defaultDryWeight || 60.0;
const effectiveOwner = details.nurseName || shiftInfo.pjShift;
const newSession: PatientHDSession = ensureFullBagianData({
id: `sess-verif-${resolvedDetailDateIso}-${resolvedDetailShift}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
date: resolvedDetailDateLabel,
sessionDate: resolvedDetailDateIso,
shift: resolvedDetailShift,
bedNumber: patientIdentifier.bedNumber || masterBeds[0]?.bedNumber || 'BED A01',
patientName:
patientIdentifier.patientName || masterMatch?.patientName || 'Pasien Dialisis',
medicalRecordNumber:
patientIdentifier.medicalRecord || masterMatch?.medicalRecordNumber || '452100',
age: masterMatch?.age || 55,
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
preWeight: dryWeight + 2.5,
postWeight: dryWeight,
targetUf: 2500,
achievedUf: 2500,
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
nurseInCharge: effectiveOwner,
vascularAccessNurse: fallbackVascNurse || effectiveOwner,
poin3_6Completed: fallbackPoin3_6Done ?? true,
nurseNotes: 'Sesi hemodialisis dan checklist Bagian I–VI terisi lengkap.',
isVerifiedByPj: true,
isVerifiedByKepalaRuang: isKaru,
verificationStatus: 'terverifikasi' as const,
verifiedAt: details.verifiedAt || formatCurrentWibTimestamp(resolvedDetailDateLabel),
verifiedBy:
details.verifiedBy || (isKaru ? shiftInfo.kepalaRuangan : shiftInfo.pjShift),
verifiedByRole: details.verifiedByRole || (isKaru ? 'Kepala Ruangan' : 'PJ Shift'),
verifierNotes: details.verifierNotes,
revisionRequested: false,
updatedAt: new Date().toISOString()
});
saveDialysisSessionCloud(newSession).catch(() => {});
return [...updated, newSession];
}
return updated;
});
};
const [signatures, setSignatures] = useState(() => {
try {
const saved = localStorage.getItem('dialysis_signatures_v1');
if (saved) return JSON.parse(saved);
} catch {
// ignore
}
return {
pjShift: { name: initialShiftInfo.pjShift, signed: false, signedAt: '' },
pjBerikutnya: { name: initialShiftInfo.pjShiftBerikutnya, signed: false, signedAt: '' },
kepalaRuangan: { name: initialShiftInfo.kepalaRuangan, signed: false, signedAt: '' }
};
});
useEffect(() => {
try {
localStorage.setItem('dialysis_signatures_v1', JSON.stringify(signatures));
} catch {
// ignore
}
}, [signatures]);
const [selectedSession, setSelectedSession] = useState<PatientHDSession | null>(null);
  const [sessionModalTab, setSessionModalTab] = useState<
    'bagian1' | 'bagian2' | 'bagian3' | 'bagian4' | 'bagian5'
  >('bagian3');
const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
const [isExplainerModalOpen, setIsExplainerModalOpen] = useState(false);
const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);
const [registryEntries, setRegistryEntries] = useState<LogbookVerificationRegistryEntry[]>(() =>
getVerificationRegistry()
);
useEffect(() => {
const syncReg = () => {
const next = getVerificationRegistry();
setRegistryEntries((prev) => {
if (JSON.stringify(prev) === JSON.stringify(next)) {
return prev;
}
return next;
});
};
syncReg();
window.addEventListener('verification_registry_updated', syncReg);
return () => window.removeEventListener('verification_registry_updated', syncReg);
}, [sessions, masterNurses]);
const verifiedShiftSummary = useMemo(() => {
const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
return aggregateShiftVerifiedLogbooks({
sessions,
registryEntries,
masterNurses,
masterPatients,
nurseSchedules,
activeDateLabel: shiftInfo.date,
activeShift,
loggedInUserName: userRole === 'pj_shift' ? loggedInUser?.name : undefined,
fallbackShiftInfo: shiftInfo
});
}, [
sessions,
registryEntries,
masterNurses,
masterPatients,
nurseSchedules,
shiftInfo.date,
shiftInfo.shift,
userRole,
loggedInUser?.name
]);
const liveCensus = verifiedShiftSummary.census;
const liveClinicalIndicators = verifiedShiftSummary.clinicalIndicators;
const [machineOverview, setMachineOverview] = useState(initialMachineOverview);
useEffect(() => {
const total = masterBeds.length;
const maintenance = masterBeds.filter((b) => b.status === 'maintenance').length;
const ready = total - maintenance;
const hepB = masterBeds.filter(
(b) => b.designation === 'isolasi' || b.designation === 'isolasi_hepb'
).length;
const hepC = masterBeds.filter((b) => b.designation === 'isolasi_hepc').length;
setMachineOverview((prev) => {
if (
prev.totalCapacity === total &&
prev.beroperasiSiapPakai === ready &&
prev.maintenance === maintenance &&
prev.khususHepB === hepB &&
prev.khususHepC === hepC
) {
return prev;
}
return {
totalCapacity: total,
beroperasiSiapPakai: ready,
maintenance,
khususHepB: hepB,
khususHepC: hepC
};
});
}, [masterBeds]);
useEffect(() => {
const activeNurses = masterNurses.filter((n) => n.accountStatus !== 'nonaktif');
const activeIso = indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib();
const activeShiftBinary: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
const matrixPj = resolvePjShiftEntryFromMatrix(
nurseSchedules,
activeNurses,
activeIso,
activeShiftBinary
);
const shiftPj =
activeNurses.find(
(n) =>
resolveNurseSystemAccess(n) === 'pj_shift' &&
n.shiftAssigned === shiftInfo.shift &&
n.isOnDutyToday
) ||
activeNurses.find(
(n) => resolveNurseSystemAccess(n) === 'pj_shift' && n.shiftAssigned === shiftInfo.shift
) ||
activeNurses.find((n) => resolveNurseSystemAccess(n) === 'pj_shift');
const resolvedPjShift =
matrixPj?.name ||
shiftPj?.name ||
(userRole === 'pj_shift' && loggedInUser?.name ? loggedInUser.name : '-');
const matrixDocs = resolveScheduledDoctorsFromMatrix(
doctorSchedules,
activeIso,
activeShiftBinary,
masterDoctors
);
const resolvedDocs = resolveDoctorsFromSchedule(
doctorSchedules,
activeIso,
shiftInfo.shift,
matrixDocs.primaryDpjp || shiftInfo.dokterDpjp,
matrixDocs.primaryJaga || shiftInfo.dokterJaga
);
setShiftInfo((prev) => {
const nextPj = resolvedPjShift;
const nextKaru = verifiedShiftSummary.kepalaRuanganName || DEFAULT_KEPALA_RUANGAN_NAME;
const nextDpjp = matrixDocs.primaryDpjp || resolvedDocs.dpjp || prev.dokterDpjp;
const nextJaga = matrixDocs.primaryJaga || resolvedDocs.dokterJaga || prev.dokterJaga;
const nextTotal = verifiedShiftSummary.jumlahPerawatDinas;
const nextDetail = verifiedShiftSummary.jumlahPerawatDinasLabel;
const nextRatio = verifiedShiftSummary.rasioPerawatPasien;
if (
prev.pjShift === nextPj &&
prev.kepalaRuangan === nextKaru &&
prev.dokterDpjp === nextDpjp &&
prev.dokterJaga === nextJaga &&
prev.totalPerawatDinas === nextTotal &&
prev.detailPerawat === nextDetail &&
prev.perawatRatio === nextRatio
) {
return prev;
}
return {
...prev,
pjShift: nextPj,
kepalaRuangan: nextKaru,
dokterDpjp: nextDpjp,
dokterJaga: nextJaga,
totalPerawatDinas: nextTotal,
detailPerawat: nextDetail,
perawatRatio: nextRatio
};
});
}, [
masterNurses,
nurseSchedules,
doctorSchedules,
masterDoctors,
shiftInfo.date,
shiftInfo.shift,
userRole,
loggedInUser?.name,
verifiedShiftSummary.kepalaRuanganName,
verifiedShiftSummary.jumlahPerawatDinas,
verifiedShiftSummary.jumlahPerawatDinasLabel,
verifiedShiftSummary.rasioPerawatPasien
]);
const handleNurseDutySync = () => {
setShiftInfo((prev) => ({
...prev,
totalPerawatDinas: verifiedShiftSummary.jumlahPerawatDinas,
detailPerawat: verifiedShiftSummary.jumlahPerawatDinasLabel,
perawatRatio: verifiedShiftSummary.rasioPerawatPasien
}));
};
  const handleNurseUpdated = (oldNurse: MasterNurse, updatedNurse: MasterNurse) => {
    masterNursesDirtyRef.current = true;
    if (oldNurse.name !== updatedNurse.name) {
      setSessions((prev) =>
        prev.map((s) =>
          s.nurseInCharge === oldNurse.name ? { ...s, nurseInCharge: updatedNurse.name } : s
        )
      );
    }
    setShiftInfo((prev) => ({
      ...prev,
      pjShift:
        updatedNurse.role === 'pj_shift' && updatedNurse.isOnDutyToday
          ? updatedNurse.name
          : prev.pjShift === oldNurse.name
          ? updatedNurse.name
          : prev.pjShift,
      kepalaRuangan:
        updatedNurse.role === 'kepala_ruangan'
          ? updatedNurse.name
          : prev.kepalaRuangan === oldNurse.name
          ? updatedNurse.name
          : prev.kepalaRuangan
    }));
    setLoggedInUser((prev) => {
      if (!prev || prev.nurseId !== updatedNurse.id) return prev;
      const nextAccess = resolveNurseSystemAccess(updatedNurse);
      setUserRole(nextAccess);
      return {
        ...prev,
        name: updatedNurse.name,
        email: updatedNurse.email || prev.email,
        username: updatedNurse.username,
        nip: updatedNurse.nip,
        userRole: nextAccess,
        role:
          nextAccess === 'administrator'
            ? 'Administrator Unit HD'
            : updatedNurse.role === 'kepala_ruangan'
            ? 'Kepala Ruangan (Ka. Ruangan)'
            : updatedNurse.role === 'pj_shift'
            ? 'Penanggung Jawab Shift (PJ Shift)'
            : 'Perawat Pelaksana Dialisis'
      };
    });
  };
  const handleBedUpdated = (oldBed: MasterBed, updatedBed: MasterBed) => {
    masterBedsDirtyRef.current = true;
    if (oldBed.bedNumber !== updatedBed.bedNumber) {
      setSessions((prev) =>
        prev.map((s) =>
          s.bedNumber === oldBed.bedNumber ? { ...s, bedNumber: updatedBed.bedNumber } : s
        )
      );
    }
  };
  const handleDoctorUpdated = (_oldDoc: MasterDoctor, updatedDoc: MasterDoctor) => {
    masterDoctorsDirtyRef.current = true;
    setMasterDoctors((prev) =>
      updateMasterDoctorData(prev, updatedDoc.id, updatedDoc)
    );
  };
  const handleSaveSession = (savedSession: PatientHDSession) => {
    const fullSession = ensureFullBagianData(savedSession);
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === fullSession.id);
      if (exists) {
        return prev.map((s) => (s.id === fullSession.id ? fullSession : s));
      } else {
        return [...prev, fullSession];
      }
    });
    saveDialysisSessionCloud(fullSession).catch((err) => {
      console.warn('Could not sync session to Firestore:', err);
    });
  };
  const handleOpenEditSession = (
    session?: PatientHDSession,
    initialTab?: 'bagian1' | 'bagian2' | 'bagian3' | 'bagian4' | 'bagian5'
  ) => {
    setSelectedSession(session || null);
    if (initialTab) {
      setSessionModalTab(initialTab);
    } else {
      setSessionModalTab('bagian3');
    }
    setIsSessionModalOpen(true);
  };
  const handleQuickToggleComplete = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, sessionStatus: 'selesai' } : s))
    );
  };
  const handleLoadBenchmarkData = () => {
    resetVerificationStorageToBenchmark();
    masterPatientsDirtyRef.current = true;
    masterNursesDirtyRef.current = true;
    masterBedsDirtyRef.current = true;
    setSessions(benchmarkSamplePatients.map(ensureFullBagianData));
    setMasterPatients(sampleBenchmarkPatients);
    setMasterNurses(
      sampleBenchmarkNurses.map((n) => ({
        ...n,
        systemAccess: resolveNurseSystemAccess(n)
      }))
    );
    setMasterBeds(sampleBenchmarkBeds);
    setIsCustomDate(false);
    setShiftInfo({
      ...benchmarkShiftInfo,
      date: getCurrentIndonesianFullDate()
    });
setMachineOverview(benchmarkMachineOverview);
setOperationalItems(initialOperationalItems);
setSbar(initialSbar);
const shortStamp = formatShortIndonesianTimestampWib();
setSignatures({
pjShift: {
name: benchmarkShiftInfo.pjShift,
signed: true,
signedAt: shortStamp
},
pjBerikutnya: {
name: benchmarkShiftInfo.pjShiftBerikutnya,
signed: true,
signedAt: shortStamp
},
kepalaRuangan: {
name: benchmarkShiftInfo.kepalaRuangan,
signed: true,
signedAt: shortStamp
}
});
};
  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={handleLogin}
        shiftInfo={shiftInfo}
        masterNurses={masterNurses}
        nurseSchedules={nurseSchedules}
      />
    );
  }

  return (
    <AppShellLayout
      currentTab={currentTab}
      onSelectTab={handleSelectTab}
      shiftInfo={shiftInfo}
      userRole={userRole}
      loggedInUserName={loggedInUser?.name}
      onDateChange={handleActiveDateChange}
      isCustomDate={isDateCustomFromToday}
      onResetDateToToday={handleResetDateToToday}
      onShiftChange={handleLogbookShiftChange}
      onLogout={handleLogout}
      isCloudConnected={isCloudConnected}
      isQuotaExceeded={isQuotaExceeded}
    >
      {!hospitalBgError && (
        <div
          className="fixed inset-0 pointer-events-none z-[-1] bg-cover bg-center opacity-30"
          style={{ backgroundImage: `url(${hospitalBgSrc})` }}
        />
      )}

      {currentTab === 'dashboard' && accessibleTabs.includes('dashboard') && (
        <DashboardView
          masterNurses={masterNurses}
          masterPatients={masterPatients}
          sessions={sessions}
          shiftInfo={shiftInfo}
          loggedInUser={loggedInUser}
          userRole={userRole}
          onNavigateTab={handleSelectTab}
        />
      )}

      {currentTab === 'lap_harian' && accessibleTabs.includes('lap_harian') && (
        <LapHarianView
          shiftInfo={shiftInfo}
          setShiftInfo={setShiftInfo}
          census={liveCensus}
          machineOverview={machineOverview}
          setMachineOverview={setMachineOverview}
          clinicalIndicators={liveClinicalIndicators}
          operationalItems={operationalItems}
          setOperationalItems={setOperationalItems}
          sbar={sbar}
          setSbar={setSbar}
          signatures={signatures}
          setSignatures={setSignatures}
          sessions={sessions}
          userRole={userRole}
          loggedInUser={loggedInUser}
          masterNurses={masterNurses}
          masterPatients={masterPatients}
          masterDoctors={masterDoctors}
          nurseSchedules={nurseSchedules}
          doctorSchedules={doctorSchedules}
          cloudNurseLogbooks={cloudNurseLogbooks}
          onDateChange={handleActiveDateChange}
          isCustomDate={isDateCustomFromToday}
          onResetDateToToday={handleResetDateToToday}
        />
      )}
{currentTab === 'logbook' && accessibleTabs.includes('logbook') && (
<PelaksanaView
sessions={sessions}
cloudNurseLogbooks={cloudNurseLogbooks}
onOpenSessionModal={handleOpenEditSession}
onQuickToggleComplete={handleQuickToggleComplete}
onOpenMasterModal={() => {
if (canAccessMasterData(userRole)) {
setIsMasterModalOpen(true);
}
}}
shiftInfo={shiftInfo}
masterPatients={masterPatients}
masterNurses={masterNurses}
masterBeds={masterBeds}
masterDoctors={masterDoctors}
nurseSchedules={nurseSchedules}
doctorSchedules={doctorSchedules}
loggedInUser={loggedInUser}
userRole={userRole}
onShiftChange={handleLogbookShiftChange}
onDateChange={handleActiveDateChange}
isCustomDate={isDateCustomFromToday}
onResetDateToToday={handleResetDateToToday}
onSyncNurseSessions={handleSyncNurseLogbookSessions}
onNavigateToVerifikasi={() => handleSelectTab('verifikasi')}
onNavigateToRiwayat={() => handleSelectTab('riwayat')}
/>
)}
{currentTab === 'laporan_pasien' && accessibleTabs.includes('laporan_pasien') && (
<LaporanPasienView
shiftInfo={shiftInfo}
userRole={userRole}
loggedInUserName={loggedInUser?.name}
sessions={sessions}
masterNurses={masterNurses}
masterPatients={masterPatients}
masterDoctors={masterDoctors}
nurseSchedules={nurseSchedules}
doctorSchedules={doctorSchedules}
cloudNurseLogbooks={cloudNurseLogbooks}
onDateChange={handleActiveDateChange}
isCustomDate={isDateCustomFromToday}
onResetDateToToday={handleResetDateToToday}
            onNavigateToLogbook={() => handleSelectTab('logbook')}
          />
        )}
      {currentTab === 'verifikasi' && canVerifyLogbook(userRole) && (
        <VerifikasiView
          shiftInfo={shiftInfo}
          masterNurses={masterNurses}
          userRole={userRole}
          loggedInUser={loggedInUser}
          sessions={sessions}
          cloudNurseLogbooks={cloudNurseLogbooks}
          onVerificationUpdated={handleNurseVerificationUpdated}
          onVerifyPatientSession={handleVerifyPatientSession}
          onSaveSession={handleSaveSession}
        />
      )}
{currentTab === 'riwayat' && accessibleTabs.includes('riwayat') && (
<RiwayatView
sessions={sessions}
shiftInfo={shiftInfo}
userRole={userRole}
loggedInUser={loggedInUser}
masterNurses={masterNurses}
onOpenSessionModal={handleOpenEditSession}
onNavigateToLogbook={() => handleSelectTab('logbook')}
onNavigateToVerifikasi={() => handleSelectTab('verifikasi')}
/>
)}
{currentTab === 'lap_bulanan' && accessibleTabs.includes('lap_bulanan') && (
<LapBulananView
masterNurses={masterNurses}
loggedInUser={loggedInUser}
shiftInfo={shiftInfo}
userRole={userRole}
sessions={sessions}
cloudNurseLogbooks={cloudNurseLogbooks}
onNavigateToLogbook={() => handleSelectTab('logbook')}
onNavigateToVerifikasi={() => handleSelectTab('verifikasi')}
/>
)}
{currentTab === 'jadwal_dinas' && accessibleTabs.includes('jadwal_dinas') && (
<JadwalDinasView
nurseSchedules={nurseSchedules}
setNurseSchedules={handleUpdateNurseSchedules}
doctorSchedules={doctorSchedules}
setDoctorSchedules={handleUpdateDoctorSchedules}
masterNurses={masterNurses}
masterDoctors={masterDoctors}
shiftInfo={shiftInfo}
setShiftInfo={setShiftInfo}
userRole={userRole}
currentIsoDate={indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()}
initialScheduleTab={scheduleMatrixTab}
onApplyScheduleToShiftInfo={(appliedInfo) => {
setShiftInfo((prev) => ({
...prev,
...appliedInfo
}));
}}
/>
)}
{(currentTab === 'data_pasien' ||
currentTab === 'data_perawat' ||
currentTab === 'data_mesin' ||
currentTab === 'data_dokter') &&
canAccessMasterData(userRole) && (
<MasterDataView
section={
currentTab === 'data_pasien'
? 'patients'
: currentTab === 'data_perawat'
? 'nurses'
: currentTab === 'data_mesin'
? 'beds'
: 'doctors'
}
          masterPatients={masterPatients}
          setMasterPatients={handleUpdateMasterPatients}
          masterNurses={masterNurses}
          setMasterNurses={handleUpdateMasterNurses}
          masterBeds={masterBeds}
          setMasterBeds={handleUpdateMasterBeds}
          masterDoctors={masterDoctors}
          setMasterDoctors={handleUpdateMasterDoctors}
          onNurseDutyChange={handleNurseDutySync}
          onNurseUpdated={handleNurseUpdated}
          onBedUpdated={handleBedUpdated}
          onDoctorUpdated={handleDoctorUpdated}
          onOpenScheduleMatrix={(targetTab) => {
            setScheduleMatrixTab(targetTab);
            handleSelectTab('jadwal_dinas');
          }}
        />
      )}
      {currentTab === 'my_account' && accessibleTabs.includes('my_account') && (
        <MyAccountView
          shiftInfo={shiftInfo}
          masterNurses={masterNurses}
          onOpenMasterDataModal={() => {
            if (canAccessMasterData(userRole)) {
              setIsMasterModalOpen(true);
            }
          }}
          onLogoutSuccess={handleLogout}
          userRole={userRole}
          onRoleChange={handleRoleChange}
          loggedInUser={loggedInUser}
          onUpdateOwnPassword={(currentPass, nextPass) => {
            if (!loggedInUser?.nurseId) return { ok: true };
            const target = masterNurses.find((n) => n.id === loggedInUser.nurseId);
            if (!target) return { ok: true };
            const expected = target.password || '12345';
            if (currentPass !== expected) {
              return { ok: false, error: 'Kata sandi saat ini tidak sesuai.' };
            }
            handleUpdateMasterNurses((prev) =>
              updateMasterNurseData(prev, target.id, { password: nextPass })
            );
            return { ok: true };
          }}
        />
      )}
      <SessionModal
        isOpen={isSessionModalOpen}
        onClose={() => setIsSessionModalOpen(false)}
        session={selectedSession}
        sessions={sessions}
        cloudNurseLogbooks={cloudNurseLogbooks}
        initialTab={sessionModalTab}
        onSave={handleSaveSession}
        masterPatients={masterPatients}
        masterNurses={masterNurses}
        masterBeds={masterBeds}
        masterDoctors={masterDoctors}
        shiftInfo={shiftInfo}
        userRole={userRole}
        loggedInUserName={loggedInUser?.name}
      />
      <SystemDesignExplainerModal
        isOpen={isExplainerModalOpen}
        onClose={() => setIsExplainerModalOpen(false)}
      />
      {canAccessMasterData(userRole) && (
        <MasterDataManagementModal
          isOpen={isMasterModalOpen}
          onClose={() => setIsMasterModalOpen(false)}
          masterPatients={masterPatients}
          setMasterPatients={handleUpdateMasterPatients}
          masterNurses={masterNurses}
          setMasterNurses={handleUpdateMasterNurses}
          masterBeds={masterBeds}
          setMasterBeds={handleUpdateMasterBeds}
          masterDoctors={masterDoctors}
          setMasterDoctors={handleUpdateMasterDoctors}
          onNurseDutyChange={handleNurseDutySync}
        />
      )}
      <PrintHelpModal
        isOpen={printHelpState.isOpen}
        onClose={() => setPrintHelpState({ isOpen: false })}
        documentTitle={printHelpState.documentTitle}
        errorMessage={printHelpState.errorMessage}
      />
    </AppShellLayout>
  );
}