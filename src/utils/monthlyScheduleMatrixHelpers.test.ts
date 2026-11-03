import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMonthCalendarDays,
  applyNurseMatrixCell,
  applyDoctorMatrixCell,
  entryToNurseMatrixCode,
  entryToDoctorMatrixCode,
  generateMonthlyNurseRoster,
  generateMonthlyDoctorRoster,
  resolveNurseMatrixShiftForDate,
  resolvePjShiftEntryFromMatrix,
  resolveScheduledDoctorsFromMatrix,
  mergeNurseSchedules,
  mergeDoctorSchedules,
  isLegacySyntheticScheduleEntry,
  stripLegacySyntheticSchedules
} from './monthlyScheduleMatrixHelpers.ts';
import { sampleBenchmarkNurses, initialMasterDoctors } from '../data/mockMasterData.ts';

test('getMonthCalendarDays returns exact days in month with accurate weekdays', () => {
  const oct2026 = getMonthCalendarDays(2026, 10);
  assert.equal(oct2026.length, 31);
  assert.equal(oct2026[0].isoDate, '2026-10-01');
  assert.equal(oct2026[0].dayShort, 'Km');
  assert.equal(oct2026[24].isoDate, '2026-10-25');
  assert.equal(oct2026[24].isSunday, true);

  const feb2028Leap = getMonthCalendarDays(2028, 2);
  assert.equal(feb2028Leap.length, 29);
});

test('applyNurseMatrixCell enforces single PJ Shift per shift on a given date', () => {
  const pjA = sampleBenchmarkNurses[1];
  const pjB = sampleBenchmarkNurses[2];
  const iso = '2026-10-28';

  let list = applyNurseMatrixCell([], pjA, iso, 'PJ-P', 'PJ Pagi Utama');
  assert.equal(list.length, 1);
  assert.equal(entryToNurseMatrixCode(list[0]), 'PJ-P');

  // Assigning pjB to PJ-P on the same date demotes pjA to regular Pagi ('P')
  list = applyNurseMatrixCell(list, pjB, iso, 'PJ-P');
  const entryA = list.find((s) => s.nurseId === pjA.id);
  const entryB = list.find((s) => s.nurseId === pjB.id);
  assert.equal(entryToNurseMatrixCode(entryA), 'P');
  assert.equal(entryToNurseMatrixCode(entryB), 'PJ-P');

  // Clearing pjB with '-' removes pjB's entry
  list = applyNurseMatrixCell(list, pjB, iso, '-');
  assert.equal(list.find((s) => s.nurseId === pjB.id), undefined);
});

test('generateMonthlyNurseRoster and generateMonthlyDoctorRoster cover all days of month', () => {
  const nurseRoster = generateMonthlyNurseRoster(2026, 10, sampleBenchmarkNurses);
  assert.equal(nurseRoster.length, sampleBenchmarkNurses.length * 31);

  const docRoster = generateMonthlyDoctorRoster(2026, 10, initialMasterDoctors);
  assert.equal(docRoster.length, initialMasterDoctors.length * 31);

  const doc0 = initialMasterDoctors[0];
  const edited = applyDoctorMatrixCell(docRoster, doc0, '2026-10-15', 'PS', 'Seharian');
  const target = edited.find((d) => d.doctorId === doc0.id && d.date === '2026-10-15');
  assert.equal(entryToDoctorMatrixCode(target), 'PS');
  assert.equal(target?.notes, 'Seharian');
});

test('resolveNurseMatrixShiftForDate, resolvePjShiftEntryFromMatrix, and resolveScheduledDoctorsFromMatrix map Matrix codes to Logbook inputs', () => {
  const iso = '2026-10-29';
  const pelaksana = sampleBenchmarkNurses[3];
  const pjSiang = sampleBenchmarkNurses[2];
  const offNurse = sampleBenchmarkNurses[4];

  let roster = applyNurseMatrixCell([], pelaksana, iso, 'S');
  roster = applyNurseMatrixCell(roster, pjSiang, iso, 'PJ-S');
  roster = applyNurseMatrixCell(roster, offNurse, iso, 'L');

  // Pelaksana scheduled Siang ('S') resolves to logbookShift === 'Siang'
  const resolvedPelaksana = resolveNurseMatrixShiftForDate(
    roster,
    { id: pelaksana.id, name: pelaksana.name },
    iso
  );
  assert.equal(resolvedPelaksana.matrixCode, 'S');
  assert.equal(resolvedPelaksana.logbookShift, 'Siang');
  assert.equal(resolvedPelaksana.isPjShift, false);
  assert.equal(resolvedPelaksana.isOffOrLeave, false);

  // Off nurse ('L') resolves to logbookShift === null & isOffOrLeave === true
  const resolvedOff = resolveNurseMatrixShiftForDate(
    roster,
    { name: offNurse.name },
    iso
  );
  assert.equal(resolvedOff.matrixCode, 'L');
  assert.equal(resolvedOff.logbookShift, null);
  assert.equal(resolvedOff.isOffOrLeave, true);

  // PJ Shift verifier for Siang resolves directly to pjSiang
  const resolvedPj = resolvePjShiftEntryFromMatrix(
    roster,
    sampleBenchmarkNurses,
    iso,
    'Siang'
  );
  assert.ok(resolvedPj);
  assert.equal(resolvedPj.name, pjSiang.name);
  assert.equal(resolvedPj.fromMatrix, true);

  // Doctor Matrix resolution for Shift Siang
  const dpjpDoc = initialMasterDoctors.find((d) => d.role === 'dpjp' || d.role === 'both')!;
  const jagaDoc = initialMasterDoctors.find((d) => d.role === 'dokter_jaga')!;
  let docRoster = applyDoctorMatrixCell([], dpjpDoc, iso, 'PS');
  docRoster = applyDoctorMatrixCell(docRoster, jagaDoc, iso, 'S');

  const resolvedDocs = resolveScheduledDoctorsFromMatrix(docRoster, iso, 'Siang');
  assert.equal(resolvedDocs.primaryDpjp, dpjpDoc.name);
  assert.equal(resolvedDocs.primaryJaga, jagaDoc.name);

  // Fallback: DPJP scheduled 'P' (Visite Pagi) covers afternoon HD sessions when no other DPJP is on Siang
  let docRosterMorningVisite = applyDoctorMatrixCell([], dpjpDoc, iso, 'P');
  docRosterMorningVisite = applyDoctorMatrixCell(docRosterMorningVisite, jagaDoc, iso, 'S');
  const resolvedVisiteDocs = resolveScheduledDoctorsFromMatrix(
    docRosterMorningVisite,
    iso,
    'Siang',
    initialMasterDoctors
  );
  assert.equal(resolvedVisiteDocs.primaryDpjp, dpjpDoc.name);
  assert.equal(resolvedVisiteDocs.primaryJaga, jagaDoc.name);

  // Role resolution: entries without explicit role field resolve via masterDoctors
  const unrolledEntries: any[] = [
    {
      id: 'dsch-test-1',
      doctorId: dpjpDoc.id,
      doctorName: dpjpDoc.name,
      date: iso,
      shift: 'Pagi'
      // role omitted
    },
    {
      id: 'dsch-test-2',
      doctorId: jagaDoc.id,
      doctorName: jagaDoc.name,
      date: iso,
      shift: 'Siang'
      // role omitted
    }
  ];
  const resolvedFromMaster = resolveScheduledDoctorsFromMatrix(
    unrolledEntries,
    iso,
    'Siang',
    initialMasterDoctors
  );
  assert.equal(resolvedFromMaster.primaryDpjp, dpjpDoc.name);
  assert.equal(resolvedFromMaster.primaryJaga, jagaDoc.name);
});

test('mergeNurseSchedules and mergeDoctorSchedules preserve local data and avoid data loss', () => {
  // 1. If remote is empty, keeps all local entries
  const localDocEntries = [
    {
      id: 'dsch-1',
      doctorId: 'doc-1',
      doctorName: 'dr. Raden Heru',
      date: '2026-11-01',
      shift: 'Pagi' as const,
      role: 'dpjp' as const,
      updatedAt: '2026-11-01T08:00:00Z'
    }
  ];
  const mergedWithEmptyRemote = mergeDoctorSchedules(localDocEntries, []);
  assert.equal(mergedWithEmptyRemote.length, 1);
  assert.equal(mergedWithEmptyRemote[0].doctorName, 'dr. Raden Heru');

  // 2. If local has entries and remote has different dates, merges both without dropping either
  const remoteDocEntries = [
    {
      id: 'dsch-2',
      doctorId: 'doc-1',
      doctorName: 'dr. Raden Heru',
      date: '2026-11-02',
      shift: 'Siang' as const,
      role: 'dpjp' as const,
      updatedAt: '2026-11-01T09:00:00Z'
    }
  ];
  const mergedBoth = mergeDoctorSchedules(localDocEntries, remoteDocEntries);
  assert.equal(mergedBoth.length, 2);

  // 3. Conflict resolution: newer updatedAt wins
  const newerLocalDoc = [
    {
      id: 'dsch-1',
      doctorId: 'doc-1',
      doctorName: 'dr. Raden Heru',
      date: '2026-11-01',
      shift: 'Siang' as const, // Local was updated to Siang later
      role: 'dpjp' as const,
      updatedAt: '2026-11-01T10:00:00Z'
    }
  ];
  const olderRemoteDoc = [
    {
      id: 'dsch-1',
      doctorId: 'doc-1',
      doctorName: 'dr. Raden Heru',
      date: '2026-11-01',
      shift: 'Pagi' as const,
      role: 'dpjp' as const,
      updatedAt: '2026-11-01T08:00:00Z'
    }
  ];
  const conflictResolved = mergeDoctorSchedules(newerLocalDoc, olderRemoteDoc);
  assert.equal(conflictResolved.length, 1);
  assert.equal(conflictResolved[0].shift, 'Siang');
});

test('isLegacySyntheticScheduleEntry and stripLegacySyntheticSchedules purge dummy schedules without dropping user entries', () => {
  const dummyNurseEntry = {
    id: 'nsch-2026-11-02-01',
    nurseName: 'TWIS FERTILIANTI PW',
    date: '2026-11-02',
    notes: 'Supervisi Klinis & Manajerial Unit HD'
  };
  const dummyDoctorEntry = {
    id: 'dsch-2026-11-02-01',
    doctorName: 'dr. Heru Prasanto',
    date: '2026-11-02',
    notes: 'DPJP Utama Shift Pagi (Visite & Preskripsi)'
  };
  const realCustomEntry = {
    id: 'custom-sch-01',
    nurseName: 'M HAIKAL MALILANG',
    date: '2026-11-02',
    notes: 'Jadwal riil dinas shift pagi unit HD'
  };

  assert.equal(isLegacySyntheticScheduleEntry(dummyNurseEntry), true);
  assert.equal(isLegacySyntheticScheduleEntry(dummyDoctorEntry), true);
  assert.equal(isLegacySyntheticScheduleEntry(realCustomEntry), false);

  const mixed = [dummyNurseEntry, realCustomEntry, dummyDoctorEntry];
  const cleaned = stripLegacySyntheticSchedules(mixed);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].id, 'custom-sch-01');
  assert.equal((cleaned[0] as { nurseName?: string }).nurseName, 'M HAIKAL MALILANG');
});


