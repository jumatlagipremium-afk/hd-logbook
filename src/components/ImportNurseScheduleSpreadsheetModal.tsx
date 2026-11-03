import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  MasterNurse,
  NurseScheduleEntry,
  ScheduleShiftType
} from '../types/dialysis.ts';
import {
  INDONESIAN_MONTH_NAMES,
  getMonthCalendarDays,
  NurseMatrixCode,
  replaceMonthNurseSchedules
} from '../utils/monthlyScheduleMatrixHelpers.ts';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
  Copy,
  Sparkles,
  ArrowRight,
  HelpCircle,
  FileText
} from 'lucide-react';

export interface ImportNurseScheduleSpreadsheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedYear: number;
  selectedMonth: number;
  masterNurses: MasterNurse[];
  existingSchedules: NurseScheduleEntry[];
  onApplySchedules: (updatedSchedules: NurseScheduleEntry[], summaryMessage: string) => void;
}

// Preset data 100% persis dari screenshot tabel spreadsheet perawat (30 hari)
export const SCREENSHOT_SPREADSHEET_PRESET: Array<{
  name: string;
  nip: string;
  role: string;
  days: string[]; // index 0 = tanggal 1 s/d index 29 = tanggal 30
}> = [
  {
    name: 'TWIS FERTILIANTI PW',
    nip: 'PR001',
    role: 'Kepala Ruang',
    days: ['L','P','P','P','P','P','P','L','L','L','P','P','P','P','L','P','P','P','P','P','P','L','P','P','P','P','P','P','L','P']
  },
  {
    name: 'M HAIKAL MALILANG',
    nip: 'PR002',
    role: 'PJ Shif',
    days: ['L','P','S','S','P','P','S','L','P','S','S','S','P','P','L','P','S','S','P','P','L','L','S','S','S','P','P','P','L','S']
  },
  {
    name: 'M NOR KHOIRUDIN',
    nip: 'PR003',
    role: 'PJ Shif',
    days: ['L','S','S','S','P','P','P','L','S','P','C','S','P','S','L','S','S','P','P','P','S','L','P','S','S','P','P','P','L','P']
  },
  {
    name: 'RIZKY WAHYU A',
    nip: 'PR004',
    role: 'Perawat Pelaksana',
    days: ['L','S','P','C','S','S','P','L','P','S','S','P','S','P','L','P','P','P','S','S','S','L','S','P','P','S','S','S','L','S']
  },
  {
    name: 'APRILLIA DWI N',
    nip: 'PR005',
    role: 'PJ Shif',
    days: ['L','S','P','P','S','S','L','L','S','S','P','P','S','S','L','P','P','S','S','S','P','L','S','P','P','S','S','S','L','S']
  },
  {
    name: 'DEA IKA P',
    nip: 'PR006',
    role: 'Perawat Pelaksana',
    days: ['L','P','S','S','P','P','S','L','P','P','S','S','P','L','L','S','P','P','S','S','P','L','S','S','S','P','P','S','L','S']
  },
  {
    name: 'NOVIALITA ARYADI',
    nip: 'PR007',
    role: 'PJ Shif',
    days: ['L','S','C','P','S','S','P','L','S','P','P','S','S','S','L','P','S','S','S','P','P','L','P','P','P','S','S','S','L','P']
  },
  {
    name: 'Y BRILLISANTO',
    nip: 'PR008',
    role: 'Perawat Pelaksana',
    days: ['L','P','S','S','P','S','S','L','P','P','S','S','P','L','L','S','S','P','P','S','S','L','S','P','P','S','S','S','L','P']
  },
  {
    name: 'SISWANTINI CATUR P',
    nip: 'PR010',
    role: 'Perawat Pelaksana',
    days: ['L','S','P','P','S','S','S','L','P','P','S','S','S','P','L','S','P','P','P','S','S','L','P','S','S','S','P','P','L','P']
  },
  {
    name: 'RENI DWI A',
    nip: 'PR011',
    role: 'Perawat Pelaksana',
    days: ['L','P','S','S','S','P','P','L','S','S','P','P','S','S','L','P','S','S','S','P','L','L','P','C','P','S','S','P','L','S']
  },
  {
    name: 'HARI ENDAH C',
    nip: 'PR012',
    role: 'Perawat Pelaksana',
    days: ['L','S','P','P','S','S','S','L','P','P','S','S','P','P','L','L','S','P','P','S','P','L','S','S','P','P','S','S','L','P']
  },
  {
    name: 'AYU WULANDARI',
    nip: 'PR013',
    role: 'Perawat Pelaksana',
    days: ['L','S','S','P','P','P','S','L','S','P','P','S','S','S','L','P','L','S','S','P','P','L','C','P','S','S','S','P','L','S']
  },
  {
    name: 'FRANSISCA RANI L',
    nip: 'PR014',
    role: 'Perawat Pelaksana',
    days: ['L','P','P','P','S','S','S','L','P','S','L','S','P','P','L','S','S','S','P','P','P','L','S','S','S','P','S','S','L','P']
  },
  {
    name: 'NITA RESTIANA P',
    nip: 'PR015',
    role: 'Perawat Pelaksana',
    days: ['L','P','S','S','P','P','P','L','P','S','S','P','S','S','L','S','P','S','S','S','S','L','P','S','S','P','P','P','L','S']
  },
  {
    name: 'RINI WULANDARI',
    nip: 'PR016',
    role: 'Perawat Pelaksana',
    days: ['L','C','S','P','P','S','S','L','S','P','P','P','L','S','L','P','P','S','S','S','P','L','P','P','S','S','P','S','L','S']
  },
  {
    name: 'AYU PUSPITA',
    nip: 'PR017',
    role: 'Perawat Pelaksana',
    days: ['L','P','P','S','S','S','P','L','L','S','P','P','S','S','L','S','S','P','P','S','S','L','S','P','P','S','S','P','L','P']
  },
  {
    name: 'YUMIATI',
    nip: 'PR018',
    role: 'Perawat Pelaksana',
    days: ['L','P','P','S','S','P','L','L','S','S','S','P','P','P','L','S','P','S','S','P','S','L','P','S','S','P','P','S','L','P']
  }
];

export interface ParsedSpreadsheetRow {
  rowIdx: number;
  rawName: string;
  rawNip: string;
  rawRole: string;
  matchedNurse?: MasterNurse;
  matchScore: 'exact' | 'nip' | 'name_partial' | 'unmatched';
  dayCodes: Record<number, string>; // day 1..31 -> 'P' | 'S' | 'L' | 'C' | etc.
}

function normalizeStr(s: any): string {
  if (s === null || s === undefined) return '';
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapCellCodeToNurseShift(
  rawCode: string
): {
  shift: ScheduleShiftType;
  isPj: boolean;
  standardCode: NurseMatrixCode;
  notes: string;
} {
  const code = String(rawCode || '').trim().toUpperCase();

  // Shift Pagi murni (tidak otomatis mengisi PJ Shift, PJ diisi manual oleh pengguna)
  if (code === 'P' || code === 'PAGI' || code === 'PJ-P' || code === 'PJP') {
    return {
      shift: 'Pagi',
      isPj: false,
      standardCode: 'P',
      notes: 'Dinas Pagi'
    };
  }

  // Shift Siang murni (tidak otomatis mengisi PJ Shift, PJ diisi manual oleh pengguna)
  if (code === 'S' || code === 'SIANG' || code === 'PJ-S' || code === 'PJS') {
    return {
      shift: 'Siang',
      isPj: false,
      standardCode: 'S',
      notes: 'Dinas Siang'
    };
  }

  if (code === 'L' || code === 'OFF' || code === 'LIBUR') {
    return {
      shift: 'Libur',
      isPj: false,
      standardCode: 'L',
      notes: 'Off Dinas Rutin'
    };
  }

  if (code === 'C' || code === 'CT' || code === 'CUTI' || code === 'IZIN') {
    return {
      shift: 'Cuti',
      isPj: false,
      standardCode: 'CT',
      notes: 'Cuti / Izin Tahunan'
    };
  }

  if (code === 'OC' || code === 'ON-CALL' || code === 'ON CALL' || code === 'CITO') {
    return {
      shift: 'On-Call',
      isPj: false,
      standardCode: 'OC',
      notes: 'Siaga HD Cito'
    };
  }

  if (code === 'M' || code === 'MALAM') {
    return {
      shift: 'Malam',
      isPj: false,
      standardCode: 'M',
      notes: 'Dinas Malam'
    };
  }

  return {
    shift: 'Libur',
    isPj: false,
    standardCode: '-',
    notes: ''
  };
}

export const ImportNurseScheduleSpreadsheetModal: React.FC<ImportNurseScheduleSpreadsheetModalProps> = ({
  isOpen,
  onClose,
  selectedYear,
  selectedMonth,
  masterNurses,
  existingSchedules,
  onApplySchedules
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste' | 'preset'>('upload');
  const [pastedText, setPastedText] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<ParsedSpreadsheetRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const monthName = INDONESIAN_MONTH_NAMES[selectedMonth - 1] || '';
  const monthDays = useMemo(
    () => getMonthCalendarDays(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  // Matcher for nurse row against masterNurses
  const findMatchingNurse = (
    nameStr: string,
    nipStr: string
  ): { nurse?: MasterNurse; score: 'exact' | 'nip' | 'name_partial' | 'unmatched' } => {
    const cleanNip = normalizeStr(nipStr);
    const cleanName = normalizeStr(nameStr);

    if (cleanNip) {
      const byNip = masterNurses.find((n) => normalizeStr(n.nip) === cleanNip);
      if (byNip) return { nurse: byNip, score: 'nip' };
    }

    if (cleanName) {
      const byExactName = masterNurses.find(
        (n) => normalizeStr(n.name) === cleanName
      );
      if (byExactName) return { nurse: byExactName, score: 'exact' };

      const byPartial = masterNurses.find((n) => {
        const nName = normalizeStr(n.name);
        return nName.includes(cleanName) || cleanName.includes(nName);
      });
      if (byPartial) return { nurse: byPartial, score: 'name_partial' };
    }

    return { score: 'unmatched' };
  };

  // Convert parsed 2D array into ParsedSpreadsheetRow[]
  const processRawAoa = (aoa: any[][]) => {
    setParseError(null);
    if (!aoa || aoa.length === 0) {
      setParseError('Data spreadsheet kosong atau tidak dapat dibaca.');
      setParsedRows([]);
      return;
    }

    // Find header row: look for row that contains "Nama" or contains numeric columns 1, 2, 3
    let headerRowIdx = -1;
    let nameColIdx = 1;
    let nipColIdx = 2;
    let roleColIdx = 3;
    const dayCols: { [dayNum: number]: number } = {};

    for (let r = 0; r < Math.min(aoa.length, 10); r++) {
      const row = aoa[r] || [];
      const rowStr = row.map((cell) => String(cell || '').trim().toLowerCase());
      const hasNama = rowStr.some((c) => c.includes('nama') || c.includes('perawat'));
      const hasDays = row.some((c) => {
        const num = Number(c);
        return Number.isInteger(num) && num >= 1 && num <= 5;
      });

      if (hasNama || hasDays) {
        headerRowIdx = r;
        // Map columns
        row.forEach((cellVal, cIdx) => {
          const s = String(cellVal || '').trim().toLowerCase();
          if (s.includes('nama') || s.includes('perawat')) {
            nameColIdx = cIdx;
          } else if (s.includes('nip') || s.includes('id') || s.includes('kode')) {
            nipColIdx = cIdx;
          } else if (s.includes('peran') || s.includes('jabatan') || s.includes('role')) {
            roleColIdx = cIdx;
          } else {
            const num = Number(cellVal);
            if (Number.isInteger(num) && num >= 1 && num <= 31) {
              dayCols[num] = cIdx;
            }
          }
        });
        break;
      }
    }

    if (headerRowIdx === -1) {
      setParseError(
        'Baris judul (header) tidak ditemukan. Pastikan terdapat kolom "Nama Perawat" dan angka tanggal 1 s/d 30.'
      );
      setParsedRows([]);
      return;
    }

    // If day columns were not explicitly found in header, check if columns after roleCol are 1..31
    if (Object.keys(dayCols).length < 5) {
      const headerRow = aoa[headerRowIdx] || [];
      const startDayCol = Math.max(nameColIdx, nipColIdx, roleColIdx) + 1;
      for (let c = startDayCol; c < headerRow.length; c++) {
        const dayNum = c - startDayCol + 1;
        if (dayNum <= 31) {
          dayCols[dayNum] = c;
        }
      }
    }

    const rowsResult: ParsedSpreadsheetRow[] = [];
    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const rawName = String(row[nameColIdx] || '').trim();
      const rawNip = String(row[nipColIdx] || '').trim();
      const rawRole = String(row[roleColIdx] || '').trim();

      // Skip empty or summary rows
      if (
        !rawName ||
        rawName.toLowerCase().startsWith('total') ||
        rawName.toLowerCase().startsWith('keterangan') ||
        rawName.toLowerCase().startsWith('periode')
      ) {
        continue;
      }

      const match = findMatchingNurse(rawName, rawNip);
      const dayCodes: Record<number, string> = {};

      monthDays.forEach((calDay) => {
        const cIdx = dayCols[calDay.day];
        if (cIdx !== undefined && row[cIdx] !== undefined) {
          dayCodes[calDay.day] = String(row[cIdx]).trim().toUpperCase();
        } else {
          dayCodes[calDay.day] = '-';
        }
      });

      rowsResult.push({
        rowIdx: r,
        rawName,
        rawNip,
        rawRole,
        matchedNurse: match.nurse,
        matchScore: match.score,
        dayCodes
      });
    }

    if (rowsResult.length === 0) {
      setParseError('Tidak ada baris perawat yang valid ditemukan di berkas/teks.');
      setParsedRows([]);
      return;
    }

    setParsedRows(rowsResult);
  };

  // 1. File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        processRawAoa(aoa);
      } catch (err: any) {
        setParseError(`Gagal membaca berkas Excel: ${err?.message || 'Format tidak didukung'}`);
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setParseError('Gagal membuka berkas lokal.');
      setIsProcessing(false);
    };

    reader.readAsBinaryString(file);
  };

  // 2. Paste Handler
  const handleParsePastedText = () => {
    if (!pastedText.trim()) {
      setParseError('Silakan tempel (paste) data tabel terlebih dahulu.');
      return;
    }

    // Split rows by newline, columns by tab (typical Excel copy) or comma/semicolon
    const lines = pastedText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const aoa: string[][] = lines.map((line) => {
      if (line.includes('\t')) {
        return line.split('\t');
      }
      if (line.includes(';') && !line.includes('\t')) {
        return line.split(';');
      }
      return line.split(',');
    });

    processRawAoa(aoa);
  };

  // 3. Load from Screenshot Preset
  const handleLoadScreenshotPreset = () => {
    setParseError(null);
    const rowsResult: ParsedSpreadsheetRow[] = SCREENSHOT_SPREADSHEET_PRESET.map(
      (item, idx) => {
        const match = findMatchingNurse(item.name, item.nip);
        const dayCodes: Record<number, string> = {};
        monthDays.forEach((calDay) => {
          const presetVal = item.days[calDay.day - 1];
          dayCodes[calDay.day] = presetVal || 'L';
        });

        return {
          rowIdx: idx + 1,
          rawName: item.name,
          rawNip: item.nip,
          rawRole: item.role,
          matchedNurse: match.nurse,
          matchScore: match.score,
          dayCodes
        };
      }
    );

    setParsedRows(rowsResult);
  };

  // Download official Excel template matching screenshot
  const handleDownloadTemplate = () => {
    const activeNurses = masterNurses.filter(
      (n) => (n.accountStatus || 'aktif') === 'aktif'
    );
    const rows: (string | number)[][] = [
      ['No', 'Nama Perawat', 'NIP', 'Peran', ...monthDays.map((d) => d.day)],
      ...activeNurses.map((nurse, i) => {
        const roleLabel =
          nurse.role === 'kepala_ruangan'
            ? 'Kepala Ruang'
            : nurse.role === 'pj_shift'
            ? 'PJ Shif'
            : 'Perawat Pelaksana';
        // Fill sample standard codes
        const sampleDayCodes = monthDays.map((d) => (d.isSunday ? 'L' : 'P'));
        return [i + 1, nurse.name, nurse.nip || `PR${String(i + 1).padStart(3, '0')}`, roleLabel, ...sampleDayCodes];
      })
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 },
      { wch: 26 },
      { wch: 12 },
      { wch: 18 },
      ...monthDays.map(() => ({ wch: 4 }))
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Jadwal Perawat');
    XLSX.writeFile(
      wb,
      `Template_Jadwal_Perawat_HD_${monthName}_${selectedYear}.xlsx`
    );
  };

  // Apply parsed rows into NurseScheduleEntry[]
  const handleApplyToSystem = () => {
    if (parsedRows.length === 0) return;

    const newEntries: NurseScheduleEntry[] = [];
    let filledCellCount = 0;

    parsedRows.forEach((row) => {
      const nurse = row.matchedNurse;
      const nurseId = nurse?.id || `nurse-custom-${normalizeStr(row.rawName)}`;
      const nurseName = nurse?.name || row.rawName;
      const nurseRole = nurse?.role;

      monthDays.forEach((calDay) => {
        const rawCode = row.dayCodes[calDay.day] || '-';
        if (!rawCode || rawCode === '-') return;

        const resolved = mapCellCodeToNurseShift(rawCode);
        newEntries.push({
          id: `nsch-${calDay.isoDate}-${nurseId}`,
          nurseId,
          nurseName,
          date: calDay.isoDate,
          shift: resolved.shift,
          isPjShift: false, // Tidak otomatis mengisi PJ shift sesuai permintaan (diinputkan manual)
          notes: resolved.notes
        });
        filledCellCount += 1;
      });
    });

    const updated = replaceMonthNurseSchedules(
      existingSchedules,
      selectedYear,
      selectedMonth,
      newEntries
    );

    const summary = `Berhasil mengimpor ${filledCellCount} sel jadwal perawat bulan ${monthName} ${selectedYear} (Shift Pagi & Siang saja; jadwal PJ Shift dapat diinputkan secara manual).`;
    onApplySchedules(updated, summary);
    onClose();
  };

  // Stats for the parsed data
  const stats = useMemo(() => {
    let pagi = 0;
    let siang = 0;
    let libur = 0;
    let cuti = 0;
    let matchedCount = 0;

    parsedRows.forEach((row) => {
      if (row.matchedNurse) matchedCount += 1;
      Object.values(row.dayCodes).forEach((code) => {
        const c = String(code).toUpperCase();
        if (c === 'P' || c === 'PJ-P') pagi += 1;
        else if (c === 'S' || c === 'PJ-S') siang += 1;
        else if (c === 'L') libur += 1;
        else if (c === 'C' || c === 'CT') cuti += 1;
      });
    });

    return { pagi, siang, libur, cuti, matchedCount };
  }, [parsedRows]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900 via-blue-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 border border-blue-400/30 rounded-xl">
              <FileSpreadsheet className="w-5 h-5 text-sky-300" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>Impor Jadwal Bulanan Perawat dari Spreadsheet</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-400/20 text-sky-200 border border-sky-300/30">
                  {monthName} {selectedYear}
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Dukungan format tabel spreadsheet sesuai gambar lampiran (No &middot; Nama &middot; NIP &middot; Peran &middot; Tanggal 1 s/d {monthDays.length}).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="inline-flex items-center bg-slate-200/70 p-1 rounded-xl text-xs font-bold gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                activeTab === 'upload'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Unggah File Excel (.xlsx / .csv)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('paste')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                activeTab === 'paste'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin-Tempel (Copy-Paste)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('preset');
                handleLoadScreenshotPreset();
              }}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all ${
                activeTab === 'preset'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Muat dari Gambar Lampiran (1-Klik)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Unduh Template Excel</span>
          </button>
        </div>

        {/* Content body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {/* PJ Shift Manual Notice */}
          <div className="bg-sky-50/80 border border-sky-200 rounded-xl px-3.5 py-2.5 text-xs text-sky-950 flex items-start sm:items-center gap-2.5">
            <span className="font-extrabold shrink-0 bg-sky-700 text-white text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider">
              Aturan Pengisian
            </span>
            <span className="leading-relaxed">
              Semua kode <strong>P</strong> dan <strong>S</strong> diimpor sebagai <strong>Shift Pagi</strong> atau <strong>Shift Siang biasa</strong> (tanpa otomatis mengisi PJ Shift). Penugasan PJ Shift dapat Anda inputkan secara manual di tabel matriks menggunakan kuas <strong>PJ-P</strong> / <strong>PJ-S</strong>.
            </span>
          </div>

          {/* Active Tab Panels */}
          {activeTab === 'upload' && (
            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center bg-slate-50/50 hover:bg-blue-50/30 transition-all cursor-pointer relative group">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="text-sm font-extrabold text-slate-900">
                  Pilih atau seret berkas spreadsheet Excel (.xlsx / .csv)
                </div>
                <p className="text-xs text-slate-500 max-w-md">
                  Sistem otomatis mendeteksi baris nama perawat, NIP, peran, dan kolom tanggal 1 s/d {monthDays.length} dengan kode P, S, L, C.
                </p>
                <div className="mt-2 text-[11px] font-bold text-blue-700 bg-blue-100/60 px-3 py-1 rounded-full border border-blue-200">
                  {isProcessing ? 'Sedang memproses berkas...' : 'Klik di sini untuk memilih berkas'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'paste' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-bold">
                  Tempel (Ctrl+V) Baris Tabel dari Excel atau Google Sheets:
                </span>
                <span className="text-[11px] text-slate-400">
                  Format: Header dengan kolom tanggal 1 s/d 30, lalu baris perawat
                </span>
              </div>
              <textarea
                rows={5}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Contoh salinan dari Excel:&#10;No	Nama Perawat	NIP	Peran	1	2	3	4	...	30&#10;1	TWIS FERTILIANTI PW	PR001	Kepala Ruang	L	P	P	P	...	P&#10;2	M HAIKAL MALILANG	PR002	PJ Shif	L	P	S	S	...	S"
                className="w-full p-3 font-mono text-xs border border-slate-300 rounded-xl bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParsePastedText}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Proses Data Teks Spreadsheet</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'preset' && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Preset Terverifikasi: Data Spreadsheet Lampiran Gambar</span>
                </div>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Data 17 perawat RS Happy Land lengkap dengan susunan kode shift P, S, L, C untuk tanggal 1 s/d 30 telah dimuat otomatis ke pratinjau di bawah.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadScreenshotPreset}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
              >
                Muat Ulang Preset
              </button>
            </div>
          )}

          {/* Parse error alert */}
          {parseError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Interactive Preview of Parsed Spreadsheet */}
          {parsedRows.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Pratinjau Matriks Spreadsheet ({parsedRows.length} Perawat)
                  </h4>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {stats.matchedCount} / {parsedRows.length} Cocok Master Data
                  </span>
                </div>

                {/* Shift code counter badges */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 border border-sky-200">
                    P: {stats.pagi}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                    S: {stats.siang}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                    L: {stats.libur}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                    C: {stats.cuti}
                  </span>
                </div>
              </div>

              {/* Scrollable table preview */}
              <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[360px] shadow-2xs">
                <table className="w-full border-collapse text-[11px] tabular-nums">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-center w-8 font-extrabold border-r border-slate-200">
                        No
                      </th>
                      <th className="p-2 text-left min-w-[190px] font-extrabold border-r border-slate-200">
                        Nama Perawat
                      </th>
                      <th className="p-2 text-center w-16 font-extrabold border-r border-slate-200">
                        NIP
                      </th>
                      <th className="p-2 text-left min-w-[120px] font-extrabold border-r border-slate-200">
                        Peran
                      </th>
                      {monthDays.map((d) => (
                        <th
                          key={d.day}
                          className={`p-1 text-center min-w-[26px] font-extrabold border-r border-slate-200 ${
                            d.isSunday ? 'bg-rose-100 text-rose-900' : ''
                          }`}
                        >
                          <div>{d.day}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80">
                        <td className="p-1.5 text-center font-mono text-slate-500 border-r border-slate-100">
                          {idx + 1}
                        </td>
                        <td className="p-1.5 font-bold text-slate-900 border-r border-slate-100">
                          <div className="flex items-center justify-between gap-1">
                            <span>{row.rawName}</span>
                            {row.matchedNurse ? (
                              <span title="Terverifikasi cocok dengan Master Perawat">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              </span>
                            ) : (
                              <span
                                className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-bold"
                                title="Nama belum ada di Master Data, akan ditambahkan otomatis"
                              >
                                Baru
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-1.5 text-center font-mono text-slate-600 border-r border-slate-100">
                          {row.rawNip || '-'}
                        </td>
                        <td className="p-1.5 text-slate-700 text-[10px] border-r border-slate-100">
                          {row.rawRole || '-'}
                        </td>
                        {monthDays.map((d) => {
                          const code = row.dayCodes[d.day] || '-';
                          const isP = code === 'P' || code === 'PJ-P';
                          const isS = code === 'S' || code === 'PJ-S';
                          const isL = code === 'L';
                          const isC = code === 'C' || code === 'CT';

                          let badgeClass = 'text-slate-300';
                          if (isP)
                            badgeClass =
                              'bg-sky-100 text-sky-800 font-extrabold border border-sky-200';
                          else if (isS)
                            badgeClass =
                              'bg-amber-100 text-amber-900 font-extrabold border border-amber-200';
                          else if (isL)
                            badgeClass =
                              'bg-slate-100 text-slate-500 font-bold border border-slate-200';
                          else if (isC)
                            badgeClass =
                              'bg-purple-100 text-purple-800 font-black border border-purple-200';

                          return (
                            <td
                              key={d.day}
                              className="p-0.5 text-center border-r border-slate-100"
                            >
                              <span
                                className={`inline-block w-5 h-5 leading-5 text-[10px] text-center rounded ${badgeClass}`}
                              >
                                {code}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legend guide */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 pt-1">
                <span className="font-bold text-slate-800">Keterangan:</span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3.5 h-3.5 rounded bg-sky-100 border border-sky-300 text-sky-800 font-bold text-[9px] flex items-center justify-center">
                    P
                  </span>{' '}
                  Pagi (07.00 - 14.00)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3.5 h-3.5 rounded bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[9px] flex items-center justify-center">
                    S
                  </span>{' '}
                  Siang (14.00 - 21.00)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3.5 h-3.5 rounded bg-slate-100 border border-slate-300 text-slate-600 font-bold text-[9px] flex items-center justify-center">
                    L
                  </span>{' '}
                  Libur Rutin (Off)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3.5 h-3.5 rounded bg-purple-100 border border-purple-300 text-purple-800 font-bold text-[9px] flex items-center justify-center">
                    C
                  </span>{' '}
                  Cuti Tahunan / Izin
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              Perubahan akan langsung memperbarui matriks bulanan perawat dan tersimpan ke database cloud.
            </span>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={parsedRows.length === 0}
              onClick={handleApplyToSystem}
              className={`px-5 py-2 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs transition-all ${
                parsedRows.length === 0
                  ? 'bg-slate-400 cursor-not-allowed opacity-60'
                  : 'bg-blue-700 hover:bg-blue-800'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Terapkan ke Matriks Jadwal ({monthName} {selectedYear})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
