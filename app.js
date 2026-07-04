const { useState, useEffect, useRef, useCallback } = React;
const APP_VERSION = "5.1.4-patch1";
// ver5.0: 파일 분리(index.html / app.js / firebase.js / styles.css), ver4.9 기능 포함


// ── 발전별 포지션 정의 ────────────────────────────────────
// 근무자 수에 따라 포지션이 달라짐
const POSITIONS_BY_DIV_COUNT = {
  "1발전": {
    4: ["입초(1)", "기록(2)", "검색(3)", "소내(4)"],
    5: ["입초(1)", "기록(2)", "검색(3)", "소내(4)", "출검(5)"],
    6: ["입초(1)", "기록(2)", "검색(3)", "소내(4)", "출검(5)", "출모(6)"],
  },
  "2발전": {
    4: ["입초(1)", "소내(2)", "검색(3)", "기록(4)"],
    5: ["입초(1)", "소내(2)", "검색(3)", "기록(4)", "소내2(5)"],
    6: ["입초(1)", "소내(2)", "검색(3)", "기록(4)", "소내2(5)", "소내3(6)"],
  },
};

// ── 근무 타입별 시작 인덱스 ──────────────────────────────
const SHIFT_START_INDEX = { N: 0, A: 1, D: 1 };

// ── 한국 공휴일 ──────────────────────────────────────────
const FIXED_HOLIDAYS = ["01-01","03-01","05-05","06-06","08-15","10-03","10-09","12-25"];
const DYNAMIC_HOLIDAYS = {
  2024: ["02-09","02-10","02-11","02-12","04-10","05-06","09-16","09-17","09-18"],
  2025: ["01-28","01-29","01-30","03-03","05-06","06-03","10-05","10-06","10-07","10-08"],
  2026: ["02-17","02-18","02-19","02-20","05-25","05-26","05-27","07-17","09-24","09-25","09-26"],
  2027: ["02-06","02-07","02-08","02-09","05-05","09-14","09-15","09-16"],
};

function isKoreanHoliday(year, month, day) {
  const key = `${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  if (FIXED_HOLIDAYS.includes(key)) return true;
  return (DYNAMIC_HOLIDAYS[year] || []).includes(key);
}

const DOW_KR = ["일","월","화","수","목","금","토"];
function getDow(year, month, day) { return DOW_KR[new Date(year, month-1, day).getDay()]; }
function getDaysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

// ── 발전별 사이클 기준일 ─────────────────────────────────
const SHIFT_CYCLE = ["A","A","A","휴","D","D","D","휴","N","N","N","휴"];
const BASE_DATES = {
  "1발전": new Date(2026, 5, 1),
  "2발전": new Date(2026, 5, 1), // C반 기준 근무 사이클
};

// ── 반별 근무 사이클 보정값 ─────────────────────────────
// 기준: 2026년 7월 2일
// A반 = A근무 2번째, B반 = D근무 1번째, C반 = 휴무, D반 = N근무 3번째
// C반은 기존과 딱 맞아서 offset 0으로 유지합니다.
const BAND_CYCLE_OFFSET = { "A반": 6, "B반": 9, "C반": 0, "D반": 3 };

function getShiftForDate(year, month, day, division, band = "C반") {
  const base = BASE_DATES[division];
  const diffDays = Math.round((new Date(year, month-1, day) - base) / 86400000);
  const offset = BAND_CYCLE_OFFSET[band] ?? 0;
  return SHIFT_CYCLE[(((diffDays + offset) % 12) + 12) % 12];
}

// ── 스케줄 생성 ──────────────────────────────────────────
// 2발전 각 근무별 배치 공식 (이미지 검증 완료):
//   N: result[i] = names[(N_OFFSET - rot + i) % wc]  순방향
//   D: result[i] = names[(rot + D_OFFSET - i) % wc]  역방향
//   A: rot%4 기준 패턴 테이블
// 1발전: shiftOrders + 기존 +rot 방식
const DIV2_N_OFFSET = 6;
const DIV2_D_OFFSET = 3;
// A근무 패턴 테이블: rot%4 → [pos0idx, pos1idx, pos2idx, pos3idx]
const DIV2_A_PATTERN = {
  0: [0,3,1,2],
  1: [2,0,3,1],
  2: [1,2,0,3],
  3: [3,1,2,0],
};

// 1발전 전용 회전 기준값
// 기준: 2026년 7월 C반 1발전
// - 7/3 N: 승진 → 기훈 → 준우 → 준형
// - 7/7 A: 준우 → 준형 → 승진 → 기훈
// - 7/1 D: 기훈 → 준우 → 준형 → 승진
// 위 패턴을 모든 1발전에 동일하게 적용합니다.
const DIV1_SHIFT_OFFSETS = { N: 6, A: 11, D: 9 };

function getIdentityShiftOrders(count) {
  const base = Array.from({ length: count }, (_, i) => i);
  return { N: [...base], A: [...base], D: [...base], CYCLE: [...base] };
}

function isSameOrderSet(a, b, count) {
  return ["N","A","D"].every(sh => {
    const aa = a?.[sh] || [];
    const bb = b?.[sh] || [];
    return aa.length === count && bb.length === count && aa.every((v, i) => Number(v) === Number(bb[i]));
  });
}

function normalizeShiftOrders(rawOrders, division, count) {
  const identity = getIdentityShiftOrders(count);
  const legacy = getLegacyDefaultShiftOrders(division, count);

  // 예전 파일의 기본 순서값은 화면에만 보이고 실제 배치에는 적용되지 않았습니다.
  // ver4.1부터 순서 수정이 실제 배치에 반영되므로, 예전 기본값은 현재 배치가 바뀌지 않도록 기본 순서로 보정합니다.
  if (!rawOrders || isSameOrderSet(rawOrders, legacy, count)) return identity;

  const result = {};
  ["N","A","D"].forEach(sh => {
    const arr = Array.isArray(rawOrders?.[sh]) ? rawOrders[sh].map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < count) : [];
    for (let i = 0; i < count; i++) if (!arr.includes(i)) arr.push(i);
    result[sh] = arr.slice(0, count);
  });
  const cycleRaw = Array.isArray(rawOrders?.CYCLE) ? rawOrders.CYCLE : result.N;
  const cycle = cycleRaw.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < count);
  for (let i = 0; i < count; i++) if (!cycle.includes(i)) cycle.push(i);
  result.CYCLE = cycle.slice(0, count);
  return result;
}

function getOrderedNameIndex(shiftOrders, shift, baseIdx, count) {
  const order = normalizeShiftOrders(shiftOrders, "", count)[shift] || getIdentityShiftOrders(count)[shift];
  return order[((baseIdx % count) + count) % count];
}

function getCycleOrder(shiftOrders, count) {
  const identity = Array.from({ length: count }, (_, i) => i);
  const raw = Array.isArray(shiftOrders?.CYCLE) ? shiftOrders.CYCLE : (Array.isArray(shiftOrders?.N) ? shiftOrders.N : identity);
  const arr = raw.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < count);
  for (let i = 0; i < count; i++) if (!arr.includes(i)) arr.push(i);
  return arr.slice(0, count);
}

function countAGroupWorkDaysBefore(targetDate, division) {
  const refDate = new Date(2026, 6, 1); // 2026-07-01 = 보민→홍빈→태헌→규민 기준일
  const step = targetDate >= refDate ? 1 : -1;
  let count = 0;
  for (let d = new Date(refDate); step === 1 ? d < targetDate : d > targetDate; d.setDate(d.getDate() + step)) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const sh = getShiftForDate(y, m, day, division, "A반");
    if (sh !== "휴") count += step;
  }
  return count;
}

function generateSchedule(names, year, month, division, workerCount, shiftOrders, band = "C반") {
  if (names.length !== workerCount) return [];
  const positions = POSITIONS_BY_DIV_COUNT[division][workerCount];
  const days = getDaysInMonth(year, month);
  const base = BASE_DATES[division];
  const wc = workerCount;

  const refDiff = Math.round((new Date(year, month-1, 1) - base) / 86400000);
  const bandOffset = BAND_CYCLE_OFFSET[band] ?? 0;
  const preCount = { A: 0, D: 0, N: 0 };
  if (refDiff >= 0) {
    for (let d = 0; d < refDiff; d++) {
      const s = SHIFT_CYCLE[(((d + bandOffset) % 12) + 12) % 12];
      if (s !== "휴") preCount[s]++;
    }
  } else {
    for (let d = refDiff; d < 0; d++) {
      const s = SHIFT_CYCLE[(((d + bandOffset) % 12) + 12) % 12];
      if (s !== "휴") preCount[s]--;
    }
  }
  const shiftDayCount = { ...preCount };
  let aBandWorkCount = band === "A반"
    ? countAGroupWorkDaysBefore(new Date(year, month - 1, 1), division)
    : 0;

  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const dow = getDow(year, month, day);
    const shift = getShiftForDate(year, month, day, division, band);
    const holiday = isKoreanHoliday(year, month, day);
    const isRed = dow === "토" || dow === "일" || holiday;

    if (shift === "휴") return { day, dow, shift, assignment: null, isRed, holiday };

    const rotation = shiftDayCount[shift];
    shiftDayCount[shift]++;

    const assignment = {};

    if (band === "A반") {
      // ver4.5 A반 전용: 1발전/2발전 모두 N/A/D별 순서 없이 하나의 순환순서만 사용
      // 기준: 2026년 7월 1일 = 보민 → 홍빈 → 태헌 → 규민
      const cycleOrder = getCycleOrder(shiftOrders, wc);
      const rotation = aBandWorkCount;
      aBandWorkCount++;
      positions.forEach((pos, posIdx) => {
        const orderIdx = ((posIdx - rotation) % wc + wc) % wc;
        assignment[pos] = names[cycleOrder[orderIdx]];
      });
    } else if (division === "2발전") {
      // 2발전: 이미지 검증된 공식 적용 — 건드리지 않음
      positions.forEach((pos, posIdx) => {
        let nameIdx;
        if (shift === "N") {
          nameIdx = ((DIV2_N_OFFSET - rotation + posIdx) % wc + wc) % wc;
        } else if (shift === "D") {
          nameIdx = ((rotation + DIV2_D_OFFSET - posIdx) % wc + wc) % wc;
        } else { // A
          if (wc === 4) {
            const pattern = DIV2_A_PATTERN[((rotation % 4) + 4) % 4];
            nameIdx = pattern[posIdx];
          } else {
            // 5명/6명일 때는 빈칸 방지를 위해 순환 배치 적용
            nameIdx = ((posIdx + rotation) % wc + wc) % wc;
          }
        }
        assignment[pos] = names[getOrderedNameIndex(shiftOrders, shift, nameIdx, wc)];
      });
    } else {
      // 1발전: 2026년 7월 C반 1발전 기준 패턴으로 전체 1발전 통일
      // names 순서를 기준으로 왼쪽으로 1칸씩 회전합니다.
      // 예: names가 [승진, 기훈, 준우, 준형]이면
      // 7/3 N = 승진,기훈,준우,준형 / 7/4 N = 준형,승진,기훈,준우 / 7/5 N = 준우,준형,승진,기훈
      const offset = DIV1_SHIFT_OFFSETS[shift] ?? 0;
      positions.forEach((pos, posIdx) => {
        const nameIdx = ((offset - rotation + posIdx) % wc + wc) % wc;
        assignment[pos] = names[getOrderedNameIndex(shiftOrders, shift, nameIdx, wc)];
      });
    }

    return { day, dow, shift, assignment, isRed, holiday };
  });
}
// ── 색상 ─────────────────────────────────────────────────
const SHIFT_COLORS = {
  N: { bg: "#1a56db", text: "#fff" },
  A: { bg: "#057a55", text: "#fff" },
  D: { bg: "#c27803", text: "#fff" },
};

const DEFAULT_NAMES = {
  4: ["승진","박진","현동","형대"],
  5: ["승진","박진","현동","형대","철수"],
  6: ["승진","박진","현동","형대","철수","영희"],
};

function getLegacyDefaultShiftOrders(division, count) {
  const base = division === "2발전"
    ? { N:[2,3,0,1], A:[1,2,0,3], D:[3,2,1,0] }
    : { N:[0,1,2,3], A:[1,2,3,0], D:[1,2,3,0] };
  const result = {};
  ["N","A","D"].forEach(sh => {
    const arr = [...(base[sh] || [])].filter(i => i < count);
    for (let i = 0; i < count; i++) if (!arr.includes(i)) arr.push(i);
    result[sh] = arr.slice(0, count);
  });
  return result;
}

function getDefaultShiftOrders(division, count) {
  return getIdentityShiftOrders(count);
}

function getDefaultPositionLabels(division, count) {
  return POSITIONS_BY_DIV_COUNT[division][count].map(p => p.replace(/\(.*\)/, ""));
}

function normalizePositionLabels(labels, division, count) {
  const defaults = getDefaultPositionLabels(division, count);
  const result = Array.isArray(labels) ? labels.slice(0, count).map(v => String(v ?? "").trim()) : [];
  while (result.length < count) result.push(defaults[result.length] || `포지션${result.length + 1}`);
  return result.map((v, i) => v || defaults[i] || `포지션${i + 1}`);
}

function normalizeRemoteData(data, band, division) {
  const count = [4,5,6].includes(Number(data?.workerCount)) ? Number(data.workerCount) : 4;
  let nextNames = Array.isArray(data?.names) ? data.names.slice(0, count).map(v => String(v ?? "")) : DEFAULT_NAMES[count];
  while (nextNames.length < count) nextNames.push(DEFAULT_NAMES[count][nextNames.length] || "");
  const nextOrders = normalizeShiftOrders(data?.shiftOrders, division, count);
  const nextPositionLabels = normalizePositionLabels(data?.positionLabels, division, count);
  return { band, division, workerCount: count, names: nextNames, shiftOrders: nextOrders, positionLabels: nextPositionLabels };
}

function getStorageKey(band, division) {
  return `근무배치_${band}_${division}`;
}

function loadSaved() {
  // v2: localStorage는 쓰지 않습니다. 모든 데이터는 Firebase에서만 읽고 씁니다.
  return null;
}

function makeSavableCore(data) {
  return {
    band: data.band,
    division: data.division,
    workerCount: data.workerCount,
    names: data.names,
    shiftOrders: data.shiftOrders,
    positionLabels: data.positionLabels,
  };
}

function isValidSetting(data) {
  if (![4,5,6].includes(Number(data.workerCount))) return false;
  if (!Array.isArray(data.names) || data.names.length !== Number(data.workerCount)) return false;
  const trimmed = data.names.map(n => String(n || "").trim());
  if (trimmed.some(n => n === "")) return false;
  if (new Set(trimmed).size !== trimmed.length) return false;
  if (data.positionLabels && (!Array.isArray(data.positionLabels) || data.positionLabels.length !== Number(data.workerCount))) return false;
  return true;
}

function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2,"0")}`;
}

function getMonthlySchedulePath(year, month, band, division) {
  return `monthlySchedules/${getMonthKey(year, month)}/${band}/${division}`;
}

function getLegacySchedulePath(band, division) {
  return `schedules/${band}/${division}`;
}

function saveSetting(data) {
  const core = makeSavableCore(data);
  const payload = { ...core, updatedAt: new Date().toISOString() };
  try {
    if (window.firebaseDB) {
      return window.firebaseDB.save(getMonthlySchedulePath(data.year, data.month, data.band, data.division), payload);
    }
  } catch (err) {
    console.warn("Firebase 저장 실패:", err);
  }
}

// ── 직원 DB / 관리자모드 ──────────────────────────────────
// v5.0.2: 우선은 간단한 편집코드 방식입니다.
// 이후 Firebase Authentication을 붙이면 실제 계정 기반 권한으로 바꿀 예정입니다.
const ADMIN_EDIT_CODE = "seul2026";
const EMPLOYEE_BANDS = ["A반","B반","C반","D반"];
function makeEmployeeId(employees) {
  const nums = Object.keys(employees || {})
    .map(id => Number(String(id).replace(/[^0-9]/g, "")))
    .filter(n => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `emp${String(next).padStart(3,"0")}`;
}

function normalizeEmployee(raw, id) {
  return {
    id,
    name: String(raw?.name || "").trim(),
    outputName: String(raw?.outputName || raw?.displayName || raw?.name || "").trim(),
    band: raw?.band || "A반",
    active: raw?.active !== false,
    createdAt: raw?.createdAt || null,
    updatedAt: raw?.updatedAt || null,
  };
}

function sortEmployees(list) {
  return [...list].sort((a, b) => {
    const byBand = EMPLOYEE_BANDS.indexOf(a.band) - EMPLOYEE_BANDS.indexOf(b.band);
    if (byBand) return byBand;
    return a.name.localeCompare(b.name, "ko");
  });
}

const POSITION_OPTIONS_BY_COUNT = {
  4: ["입초", "기록", "검색", "소내"],
  5: ["입초", "기록", "검색", "소내", "출검", "소내2"],
  6: ["입초", "기록", "검색", "소내", "출검", "소내2", "출모", "소내3"],
};

function getPositionOptions(count, currentLabels, slotIdx) {
  const current = String(currentLabels?.[slotIdx] || "").trim();
  const used = new Set(
    (currentLabels || [])
      .map((label, idx) => idx === slotIdx ? "" : String(label || "").trim())
      .filter(Boolean)
  );
  const base = POSITION_OPTIONS_BY_COUNT[count] || POSITION_OPTIONS_BY_COUNT[4];
  const options = base.filter(label => !used.has(label) || label === current);
  if (current && !options.includes(current)) options.unshift(current);
  return options;
}


// ── 컴포넌트 ─────────────────────────────────────────────
function App() {
  const today = new Date();
  const personal = (() => {
    try { return JSON.parse(localStorage.getItem('sp_personal_settings') || '{}'); } catch { return {}; }
  })();
  const initBand = personal.band || 'C반';
  const initDivision = personal.division || '1발전';

  const [band, setBand] = useState(initBand);
  const [division, setDivision] = useState(initDivision);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [workerCount, setWorkerCount] = useState(4);
  const [names, setNames] = useState(DEFAULT_NAMES[4]);
  const [inputNames, setInputNames] = useState(DEFAULT_NAMES[4]);
  const [shiftOrders, setShiftOrders] = useState(getDefaultShiftOrders(initDivision, 4));
  const [positionLabels, setPositionLabels] = useState(getDefaultPositionLabels(initDivision, 4));
  const [schedule, setSchedule] = useState(() => generateSchedule(DEFAULT_NAMES[4], today.getFullYear(), today.getMonth()+1, initDivision, 4, getDefaultShiftOrders(initDivision, 4), initBand));
  const [syncStatus, setSyncStatus] = useState('Firebase 연결 준비중');
  const [isLoaded, setIsLoaded] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('personal');
  const [personalBand, setPersonalBand] = useState(initBand);
  const [personalDivision, setPersonalDivision] = useState(initDivision);
  const [personalName, setPersonalName] = useState(personal.name || '');

  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [employees, setEmployees] = useState({});
  const [employeeForm, setEmployeeForm] = useState({ name:'', band:'A반', outputName:'' });
  const [globalNotice, setGlobalNotice] = useState({ text:'', enabled:false, urgent:false });
  const [noticeForm, setNoticeForm] = useState({ text:'', enabled:false, urgent:false });
  const defaultAdvancedSettings = {
    'A반': { positionOrderEnabled:true, shiftOrderEnabled:false },
    'B반': { positionOrderEnabled:true, shiftOrderEnabled:false },
    'C반': { positionOrderEnabled:true, shiftOrderEnabled:true },
    'D반': { positionOrderEnabled:true, shiftOrderEnabled:false },
  };
  const [advancedBand, setAdvancedBand] = useState(initBand);
  const [advancedSettings, setAdvancedSettings] = useState(() => {
    try { return { ...defaultAdvancedSettings, ...(JSON.parse(localStorage.getItem('sp_advanced_settings') || '{}')) }; } catch { return defaultAdvancedSettings; }
  });
  const [workerNamesDirty, setWorkerNamesDirty] = useState(false);

  const [positionEditMode, setPositionEditMode] = useState(false);
  const [positionSectionOpen, setPositionSectionOpen] = useState(false);
  const [cOrderEditMode, setCOrderEditMode] = useState(false);
  const [cOrderSectionOpen, setCOrderSectionOpen] = useState(false);
  const [workSettingOpen, setWorkSettingOpen] = useState(false);
  const draggingPosRef = useRef(null);
  const positionRailRef = useRef(null);
  const [draggingPosIndex, setDraggingPosIndex] = useState(null);
  const draggingOrderRef = useRef(null);
  const [draggingOrder, setDraggingOrder] = useState(null);

  const applyingRemoteRef = useRef(false);
  const lastRemoteCoreRef = useRef('');
  const saveTimerRef = useRef(null);

  const positions = POSITIONS_BY_DIV_COUNT[division][workerCount];
  const displayPositionLabels = normalizePositionLabels(positionLabels, division, workerCount);
  const yearOptions = Array.from({ length: 6 }, (_, i) => 2023 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const todayDay = today.getFullYear() === selectedYear && today.getMonth()+1 === selectedMonth ? today.getDate() : null;

  const employeeList = sortEmployees(Object.entries(employees || {}).map(([id, raw]) => normalizeEmployee(raw, id)));
  const activeEmployeeList = employeeList.filter(emp => emp.active && emp.name);

  const getEmployeeDisplayName = (emp) => String(emp.outputName || emp.name || '').trim();
  const cleanLabel = (value) => String(value || '').replace(/\(.*\)/, '').trim();
  const isWeekendOrHoliday = (day) => day.dow === '토' || day.dow === '일' || day.holiday;
  const currentAdvanced = advancedSettings[band] || defaultAdvancedSettings[band] || { positionOrderEnabled:true, shiftOrderEnabled:false };

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      unsubscribe = window.firebaseDB.listen('employees', data => { if (!cancelled) setEmployees(data || {}); });
    };
    attach();
    return () => { cancelled = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      // 전역 공지: 월/반/발전과 무관하게 모든 사용자에게 동일 적용
      unsubscribe = window.firebaseDB.listen('settings/globalNotice', data => {
        if (cancelled) return;
        const next = {
          text: String(data?.text || ''),
          enabled: Boolean(data?.enabled),
          urgent: Boolean(data?.urgent),
          updatedAt: data?.updatedAt || ''
        };
        setGlobalNotice(next);
        setNoticeForm({ text: next.text, enabled: next.enabled, urgent: next.urgent });
      });
    };
    attach();
    return () => { cancelled = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    setIsLoaded(false);
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      setSyncStatus(`${getMonthKey(selectedYear, selectedMonth)} 실시간 연결됨`);
      unsubscribe = window.firebaseDB.listen(getMonthlySchedulePath(selectedYear, selectedMonth, band, division), async (data) => {
        if (cancelled) return;
        let sourceData = data;
        if (!sourceData && window.firebaseDB?.read) {
          try { sourceData = await window.firebaseDB.read(getLegacySchedulePath(band, division)); } catch {}
        }
        const normalized = sourceData
          ? normalizeRemoteData(sourceData, band, division)
          : { band, division, workerCount:4, names:DEFAULT_NAMES[4], shiftOrders:getDefaultShiftOrders(division,4), positionLabels:getDefaultPositionLabels(division,4) };
        const core = makeSavableCore(normalized);
        lastRemoteCoreRef.current = data ? JSON.stringify(core) : '';
        applyingRemoteRef.current = true;
        setWorkerCount(normalized.workerCount);
        setInputNames(normalized.names);
        setNames(normalized.names);
        setShiftOrders(normalized.shiftOrders);
        setPositionLabels(normalized.positionLabels);
        setSchedule(generateSchedule(normalized.names, selectedYear, selectedMonth, division, normalized.workerCount, normalized.shiftOrders, band));
        setIsLoaded(true);
        setTimeout(() => { applyingRemoteRef.current = false; }, 80);
      });
    };
    attach();
    return () => { cancelled = true; setIsLoaded(false); if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [band, division, selectedYear, selectedMonth]);

  useEffect(() => {
    setSchedule(generateSchedule(names, selectedYear, selectedMonth, division, workerCount, shiftOrders, band));
  }, [names, selectedYear, selectedMonth, division, workerCount, shiftOrders, band]);

  useEffect(() => {
    if (!isLoaded || applyingRemoteRef.current) return;
    const core = makeSavableCore({ band, division, workerCount, names, shiftOrders, positionLabels });
    const coreJson = JSON.stringify(core);
    if (coreJson === lastRemoteCoreRef.current) return;
    if (!isValidSetting(core)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSyncStatus('저장중...');
      saveSetting({ ...core, year:selectedYear, month:selectedMonth })?.then(() => {
        lastRemoteCoreRef.current = coreJson;
        setSyncStatus('저장 완료');
        setTimeout(() => setSyncStatus('실시간 연결됨'), 1000);
      }).catch(() => setSyncStatus('저장 실패'));
    }, 350);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [band, division, workerCount, names, shiftOrders, positionLabels, isLoaded, selectedYear, selectedMonth]);

  const applyBandEmployees = useCallback((targetBand = band) => {
    const matched = activeEmployeeList.filter(emp => emp.band === targetBand).map(getEmployeeDisplayName).filter(Boolean);
    if (matched.length < workerCount) return;
    const nextNames = matched.slice(0, workerCount);
    setInputNames(nextNames);
    setNames(nextNames);
  }, [activeEmployeeList, band, workerCount]);


  const savePersonalSettings = () => {
    localStorage.setItem('sp_personal_settings', JSON.stringify({ band: personalBand, division: personalDivision, name: personalName }));
    setBand(personalBand);
    setDivision(personalDivision);
    setSettingsOpen(false);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  };

  const handleAdminLogin = () => {
    if (adminCodeInput.trim() === ADMIN_EDIT_CODE) { setIsAdminMode(true); setAdminCodeInput(''); }
    else alert('관리자 암호가 맞지 않아요.');
  };

  const handleEmployeeAdd = async () => {
    const name = employeeForm.name.trim();
    const outputName = (employeeForm.outputName || employeeForm.name).trim();
    if (!name) { alert('이름을 입력해주세요.'); return; }
    const id = makeEmployeeId(employees);
    const now = new Date().toISOString();
    await window.firebaseDB?.save(`employees/${id}`, { id, name, outputName, band:employeeForm.band, active:true, createdAt:now, updatedAt:now });
    setEmployeeForm({ name:'', band:employeeForm.band, outputName:'' });
  };

  const deleteEmployee = async (id) => {
    if (!confirm('이 직원을 삭제할까요?')) return;
    await window.firebaseDB?.save(`employees/${id}`, { ...(employees[id] || {}), id, active:false, updatedAt:new Date().toISOString() });
  };

  const clearBandEmployees = async (targetBand) => {
    if (!confirm(`${targetBand} 직원DB를 전체 삭제할까요?`)) return;
    const targets = employeeList.filter(emp => emp.band === targetBand && emp.active);
    await Promise.all(targets.map(emp => window.firebaseDB?.save(`employees/${emp.id}`, { ...(employees[emp.id] || {}), id:emp.id, active:false, updatedAt:new Date().toISOString() })));
  };

  const saveGlobalNotice = async () => {
    const payload = {
      text: String(noticeForm.text || '').trim(),
      enabled: Boolean(noticeForm.enabled) && Boolean(String(noticeForm.text || '').trim()),
      urgent: Boolean(noticeForm.urgent),
      updatedAt: new Date().toISOString()
    };
    await window.firebaseDB?.save('settings/globalNotice', payload);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1400);
  };

  const clearGlobalNotice = async () => {
    if (!confirm('공지사항을 삭제할까요?')) return;
    const payload = { text:'', enabled:false, urgent:false, updatedAt:new Date().toISOString() };
    await window.firebaseDB?.save('settings/globalNotice', payload);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1400);
  };

  const getWorkerOptions = (slotIdx) => {
    const current = String(inputNames[slotIdx] || '').trim();
    const used = new Set(inputNames.map((n, idx) => idx === slotIdx ? '' : String(n || '').trim()).filter(Boolean));
    const opts = activeEmployeeList
      .filter(emp => emp.band === band)
      .map(emp => ({ ...emp, displayName:getEmployeeDisplayName(emp) }))
      .filter(emp => emp.displayName && (!used.has(emp.displayName) || emp.displayName === current));
    if (current && !opts.some(emp => emp.displayName === current)) opts.unshift({ id:'current', displayName:current, name:current, band });
    return opts;
  };

  const setWorkerNameAt = (idx, value) => {
    const next = [...inputNames];
    next[idx] = value;
    setInputNames(next);
    setWorkerNamesDirty(true);
  };

  const saveWorkerNames = () => {
    const trimmed = inputNames.slice(0, workerCount).map(v => String(v || '').trim());
    if (trimmed.some(v => !v)) { alert('근무자를 모두 선택해주세요.'); return; }
    if (new Set(trimmed).size !== workerCount) { alert('중복된 근무자가 있어요.'); return; }
    setNames(trimmed);
    setWorkerNamesDirty(false);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1400);
  };

  const handleWorkerCountChange = (count) => {
    setWorkerCount(count);
    const nextNames = inputNames.slice(0, count);
    while (nextNames.length < count) nextNames.push('');
    setInputNames(nextNames);
    setWorkerNamesDirty(true);
    if (nextNames.every(Boolean) && new Set(nextNames.map(v => String(v).trim())).size === count) setNames(nextNames.map(v => String(v).trim()));
    setShiftOrders(getDefaultShiftOrders(division, count));
    setPositionLabels(getDefaultPositionLabels(division, count));
  };

  const updateAdvancedSetting = (targetBand, key, value) => {
    setAdvancedSettings(prev => {
      const next = { ...prev, [targetBand]: { ...(prev[targetBand] || defaultAdvancedSettings[targetBand]), [key]: value } };
      localStorage.setItem('sp_advanced_settings', JSON.stringify(next));
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1100);
      return next;
    });
  };

  const getPositionKeyByLabel = (label) => positions.find(p => cleanLabel(p) === cleanLabel(label)) || positions[displayPositionLabels.indexOf(label)] || positions[0];

  const getPatrolInfo = useCallback((day, label) => {
    if (!day.assignment || day.shift === '휴') return null;
    const l = cleanLabel(label);
    const weekend = isWeekendOrHoliday(day);
    if (band === 'C반') {
      if (day.shift === 'N' && (l === '기록' || l === '소내')) return { mark:'🚔' };
      if (day.shift === 'A') {
        const target = division === '2발전' ? (weekend ? '입초' : '기록') : (weekend ? '소내' : '기록');
        return l === target ? { mark:'🚔' } : null;
      }
      return null;
    }
    if (band === 'A반') {
      if (day.shift === 'N') return l === '기록' ? { mark:'🚔' } : null;
      if (day.shift === 'A') return l === (weekend ? '소내' : '입초') ? { mark:'🚔' } : null;
    }
    if ((band === 'B반' || band === 'D반')) {
      if (day.shift === 'N') return l === '기록' ? { mark:'🚔' } : null;
      if (day.shift === 'A') return l === (weekend ? '소내' : '입초') ? { mark:'🚔' } : null;
    }
    return null;
  }, [band, division]);

  const movePositionToIndex = (from, to) => {
    if (!positionEditMode) return;
    setPositionLabels(prev => {
      const arr = normalizePositionLabels(prev, division, workerCount);
      const safeTo = Math.max(0, Math.min(arr.length - 1, to));
      if (from === safeTo) return arr;
      const [picked] = arr.splice(from, 1);
      arr.splice(safeTo, 0, picked);
      return [...arr];
    });
  };

  const startPositionDrag = (e, idx) => {
    if (!positionEditMode) return;
    e.preventDefault();
    draggingPosRef.current = idx;
    setDraggingPosIndex(idx);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = 'none';
  };
  const endPositionDrag = () => { draggingPosRef.current = null; setDraggingPosIndex(null); document.body.style.userSelect = ''; };
  const handlePositionMove = (e) => {
    if (draggingPosRef.current === null || !positionRailRef.current) return;
    const items = Array.from(positionRailRef.current.querySelectorAll('[data-pos-card="true"]'));
    let target = items.length - 1;
    for (let i=0;i<items.length;i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width/2) { target = i; break; }
    }
    if (target !== draggingPosRef.current) { movePositionToIndex(draggingPosRef.current, target); draggingPosRef.current = target; }
  };

  const moveShiftOrderToIndex = (shift, from, to) => {
    setShiftOrders(prev => {
      const current = normalizeShiftOrders(prev, division, workerCount);
      const arr = [...(current[shift] || getIdentityShiftOrders(workerCount)[shift])];
      const safeTo = Math.max(0, Math.min(arr.length - 1, to));
      if (from === safeTo) return current;
      const [picked] = arr.splice(from, 1);
      arr.splice(safeTo, 0, picked);
      return { ...current, [shift]: arr };
    });
  };

  const startShiftOrderDrag = (e, shift, idx) => {
    if (!cOrderEditMode) return;
    e.preventDefault();
    draggingOrderRef.current = { shift, idx };
    setDraggingOrder({ shift, idx });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = 'none';
  };
  const endShiftOrderDrag = () => { draggingOrderRef.current = null; setDraggingOrder(null); document.body.style.userSelect = ''; };
  const handleShiftOrderMove = (e, shift) => {
    if (!cOrderEditMode) return;
    const drag = draggingOrderRef.current;
    if (!drag || drag.shift !== shift) return;
    const rail = e.currentTarget;
    const items = Array.from(rail.querySelectorAll('[data-order-card="true"]'));
    let target = items.length - 1;
    for (let i=0;i<items.length;i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width/2) { target = i; break; }
    }
    if (target !== drag.idx) {
      moveShiftOrderToIndex(shift, drag.idx, target);
      draggingOrderRef.current = { shift, idx: target };
      setDraggingOrder({ shift, idx: target });
    }
  };

  const selectStyle = { padding:'8px 12px', background:'#0f172a', border:'1.5px solid #334155', borderRadius:8, color:'#f1f5f9', fontSize:14, fontWeight:800, outline:'none' };
  const buttonBase = { border:'none', borderRadius:8, color:'#fff', fontWeight:900, cursor:'pointer' };
  const gridCols = `82px 42px ${displayPositionLabels.map(() => '1fr').join(' ')}`;

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)', fontFamily:"'Segoe UI','Apple SD Gothic Neo',sans-serif", color:'#e2e8f0', padding:'18px 12px' }}>
      <div style={{ maxWidth:980, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <img src="./icon-192.png" style={{ width:42, height:42, borderRadius:11 }} />
            <div>
              <div style={{ fontSize:24, fontWeight:950, letterSpacing:'-0.5px' }}>SEUL-POLICE</div>
              <div style={{ fontSize:12, color:'#94a3b8', fontWeight:700 }}>{band} {division} 근무자 배치 자동화</div>
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} style={{ ...buttonBase, width:42, height:42, background:'#111827', border:'1px solid #334155', fontSize:20 }}>⚙️</button>
        </div>

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
          <div style={{ display:'flex', background:'#0f172a', border:'1.5px solid #334155', borderRadius:9, padding:3, gap:2 }}>
            {EMPLOYEE_BANDS.map(b => <button key={b} onClick={() => setBand(b)} style={{ ...buttonBase, padding:'7px 11px', background:band===b?'linear-gradient(135deg,#0ea5e9,#6366f1)':'transparent', color:band===b?'#fff':'#64748b' }}>{b}</button>)}
          </div>
          <div style={{ display:'flex', background:'#0f172a', border:'1.5px solid #334155', borderRadius:9, padding:3, gap:2 }}>
            {['1발전','2발전'].map(d => <button key={d} onClick={() => setDivision(d)} style={{ ...buttonBase, padding:'7px 13px', background:division===d?'linear-gradient(135deg,#f59e0b,#f97316)':'transparent', color:division===d?'#fff':'#64748b' }}>{d}</button>)}
          </div>
          <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} style={selectStyle}>{yearOptions.map(y=><option key={y} value={y}>{y}년</option>)}</select>
          <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} style={selectStyle}>{monthOptions.map(m=><option key={m} value={m}>{m}월</option>)}</select>
          <span style={{ fontSize:12, color:'#94a3b8', fontWeight:800, padding:'8px 10px', background:'#0f172a', border:'1px solid #334155', borderRadius:8 }}>근무자 {workerCount}명</span>
        </div>

        {globalNotice.enabled && globalNotice.text && <div style={{ overflow:'hidden', whiteSpace:'nowrap', background:globalNotice.urgent?'linear-gradient(135deg,#7f1d1d,#991b1b)':'linear-gradient(135deg,#0f172a,#1e293b)', border:globalNotice.urgent?'1px solid #ef4444':'1px solid #334155', color:'#f8fafc', borderRadius:10, padding:'8px 0', marginBottom:10, boxShadow:'0 10px 25px rgba(0,0,0,.2)' }}>
          <div className="notice-marquee" style={{ fontSize:13, fontWeight:900 }}>
            <span style={{ marginRight:40 }}>{globalNotice.urgent ? '🚨 긴급공지' : '📢 공지'} · {globalNotice.text}</span>
          </div>
        </div>}

        <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:12, padding:'9px 10px', marginBottom:10 }}>
          <button onClick={() => setWorkSettingOpen(v => !v)} style={{ width:'100%', border:'none', background:'transparent', color:'#f8fafc', fontSize:14, fontWeight:950, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', padding:0 }}>
            <span>근무지설정</span>
            <span style={{ color:'#94a3b8', fontSize:14 }}>{workSettingOpen ? '▾' : '▸'}</span>
          </button>

          {workSettingOpen && <div style={{ marginTop:10, display:'grid', gap:9 }}>
            <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:900 }}>근무자 선택</div>
                  <div style={{ fontSize:10, color:'#64748b' }}>{band} 직원 DB만 표시 · 중복 선택 방지</div>
                </div>
                {workerNamesDirty && <span style={{ fontSize:10, fontWeight:950, color:'#fbbf24', background:'rgba(251,191,36,.12)', border:'1px solid rgba(251,191,36,.35)', borderRadius:999, padding:'4px 7px' }}>변경됨</span>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:6 }}>
                {inputNames.map((name, idx) => <select key={idx} value={name} onChange={e=>setWorkerNameAt(idx,e.target.value)} style={{ ...selectStyle, padding:'7px 9px', fontSize:12 }}>
                  <option value="">근무자 {idx+1}</option>
                  {getWorkerOptions(idx).map(emp => <option key={emp.id} value={emp.displayName || emp.name}>{emp.displayName || emp.name}</option>)}
                </select>)}
              </div>
              <button onClick={saveWorkerNames} style={{ ...buttonBase, marginTop:8, width:'100%', background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'8px 10px', fontSize:12 }}>근무자 명단 저장</button>
            </div>

            {currentAdvanced.positionOrderEnabled && <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'8px 9px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                <div style={{ color:'#f8fafc', fontSize:12, fontWeight:950 }}>근무지순서</div>
                <button onClick={() => setPositionEditMode(v => !v)} style={{ ...buttonBase, background:positionEditMode?'#059669':'#334155', padding:'4px 7px', fontSize:10 }}>{positionEditMode ? '완료' : '수정'}</button>
              </div>
              <div style={{ fontSize:9, color:'#64748b', margin:'5px 0 7px' }}>수정 버튼을 눌러야 좌우 드래그 가능</div>
              <div ref={positionRailRef} onPointerMove={handlePositionMove} onPointerUp={endPositionDrag} onPointerCancel={endPositionDrag} style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:2 }}>
                {displayPositionLabels.map((label, idx) => <div key={`${label}-${idx}`} data-pos-card="true" onPointerDown={e=>startPositionDrag(e, idx)} style={{ minWidth:56, flex:'0 0 auto', textAlign:'center', padding:'5px 7px', borderRadius:8, background:draggingPosIndex===idx?'#334155':'#111827', border:positionEditMode?'1px solid #f59e0b':'1px solid #334155', cursor:positionEditMode?'grab':'default', touchAction:'none', userSelect:'none', fontSize:11, fontWeight:900 }}>
                  <span style={{ marginRight:3, color:positionEditMode?'#fbbf24':'#64748b', fontSize:9 }}>{positionEditMode?'↔':'·'}</span>{label}
                </div>)}
              </div>
            </div>}

            {currentAdvanced.shiftOrderEnabled && <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'8px 9px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                <div style={{ color:'#f8fafc', fontSize:12, fontWeight:950 }}>근무별순서</div>
                <button onClick={() => setCOrderEditMode(v => !v)} style={{ ...buttonBase, background:cOrderEditMode?'#059669':'#334155', padding:'4px 7px', fontSize:10 }}>{cOrderEditMode ? '완료' : '수정'}</button>
              </div>
              <div style={{ fontSize:9, color:'#64748b', margin:'5px 0 7px' }}>수정 버튼을 눌러야 N/A/D 순서 드래그 가능</div>
              <div style={{ display:'grid', gap:5 }}>
                {['N','A','D'].map(sh => {
                  const normalizedOrders = normalizeShiftOrders(shiftOrders, division, workerCount);
                  const order = normalizedOrders[sh] || getIdentityShiftOrders(workerCount)[sh];
                  return <div key={sh} style={{ background:'#111827', border:'1px solid #334155', borderRadius:8, padding:6 }}>
                    <div style={{ fontSize:10, fontWeight:950, marginBottom:5, color:SHIFT_COLORS[sh]?.bg === '#1a56db' ? '#93c5fd' : sh === 'A' ? '#86efac' : '#fbbf24' }}>{sh} 순서</div>
                    <div onPointerMove={e=>handleShiftOrderMove(e, sh)} onPointerUp={endShiftOrderDrag} onPointerCancel={endShiftOrderDrag} style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:2 }}>
                      {order.map((nameIdx, idx) => <div key={`${sh}-${nameIdx}-${idx}`} data-order-card="true" onPointerDown={e=>startShiftOrderDrag(e, sh, idx)} style={{ minWidth:50, flex:'0 0 auto', textAlign:'center', padding:'5px 7px', borderRadius:999, background:draggingOrder?.shift===sh && draggingOrder?.idx===idx?'#334155':'#1e293b', border:cOrderEditMode?'1px solid #f59e0b':'1px solid #475569', cursor:cOrderEditMode?'grab':'default', touchAction:'none', userSelect:'none', fontSize:10, fontWeight:950 }}>
                        {inputNames[nameIdx] || `근무자${nameIdx+1}`}
                      </div>)}
                    </div>
                  </div>;
                })}
              </div>
            </div>}
          </div>}
        </div>

        <div style={{ background:'#1e293b', border:'1px solid #334155', borderRadius:14, overflow:'hidden' }}>
          <div style={{ background:'#0f172a', padding:'11px 14px', borderBottom:'1px solid #334155', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontWeight:900, fontSize:14 }}>{selectedYear}년 {selectedMonth}월 {band} {division}</span>
            <span style={{ fontSize:11, color:'#94a3b8' }}>🚔 순찰자 · 🔴 주말/공휴일</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:gridCols, background:'#0f172a', borderBottom:'1px solid #334155', padding:'0 10px' }}>
            {['일/요일','근무',...displayPositionLabels].map(h => <div key={h} style={{ padding:'8px 4px', fontSize:11, fontWeight:800, color:'#94a3b8', textAlign:'center' }}>{h}</div>)}
          </div>
          {schedule.map((day, idx) => {
            const isToday = day.day === todayDay;
            const textColor = day.isRed ? '#ef4444' : '#cbd5e1';
            return <div key={day.day} style={{ display:'grid', gridTemplateColumns:gridCols, borderBottom:idx<schedule.length-1?'1px solid #1e293b':'none', background:isToday?'rgba(245,158,11,.11)':idx%2?'#172032':'transparent', padding:'0 10px', outline:isToday?'2px solid #f59e0b':'none', outlineOffset:-1 }}>
              <div style={{ padding:'9px 4px', display:'flex', alignItems:'center', gap:4 }}><span style={{ fontWeight:900, color:textColor }}>{day.day}</span><span style={{ color:textColor }}>({day.dow})</span>{day.holiday && <span style={{ color:'#ef4444', fontSize:10 }}>★</span>}</div>
              <div style={{ padding:'9px 2px', textAlign:'center' }}>{day.shift !== '휴' ? <span style={{ background:SHIFT_COLORS[day.shift].bg, color:'#fff', borderRadius:5, padding:'2px 7px', fontSize:11, fontWeight:900 }}>{day.shift}</span> : <span style={{ fontSize:11, color:'#475569' }}>휴</span>}</div>
              {displayPositionLabels.map(label => {
                const key = getPositionKeyByLabel(label);
                const patrol = getPatrolInfo(day, label);
                return <div key={label} style={{ padding:'9px 4px', fontSize:12, fontWeight:patrol?950:700, color:day.assignment?(patrol?'#fde047':'#f1f5f9'):'#334155', textAlign:'center', background:patrol?'rgba(250,204,21,.16)':'transparent', borderRadius:6, boxShadow:patrol?'inset 0 0 0 1px rgba(250,204,21,.45)':'none' }}>{day.assignment ? <>{day.assignment[key]}{patrol && <span style={{ marginLeft:3 }}>{patrol.mark}</span>}</> : ''}</div>;
              })}
            </div>;
          })}
        </div>

        <div style={{ marginTop:8, fontSize:11, color:'#86efac', textAlign:'center', background:'#052e16', border:'1px solid #14532d', borderRadius:8, padding:'7px 12px' }}>💾 Firebase 자동 저장 · {syncStatus}</div>
        <div style={{ marginTop:22, paddingTop:18, borderTop:'1px solid #334155', textAlign:'center', color:'#94a3b8', fontWeight:800 }}>Made by Hyungdai<br/><span style={{ color:'#f8fafc', fontSize:24, fontWeight:950 }}>SEUL-POLICE</span></div>

        {settingsOpen && <div style={{ position:'fixed', inset:0, background:'rgba(2,6,23,.78)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:14 }}>
          <div style={{ width:'min(760px,100%)', maxHeight:'88vh', overflow:'auto', background:'#0f172a', border:'1px solid #334155', borderRadius:16, padding:16, boxShadow:'0 20px 80px rgba(0,0,0,.45)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontSize:20, fontWeight:950 }}>설정</div>
              <button onClick={()=>setSettingsOpen(false)} style={{ ...buttonBase, background:'#334155', width:34, height:34 }}>×</button>
            </div>
            <div style={{ display:'flex', gap:8, marginBottom:14, overflowX:'auto', paddingBottom:2 }}>
              <button onClick={()=>setSettingsTab('personal')} style={{ ...buttonBase, background:settingsTab==='personal'?'#2563eb':'#1e293b', padding:'9px 13px', whiteSpace:'nowrap' }}>개인설정</button>
              <button onClick={()=>setSettingsTab('advanced')} style={{ ...buttonBase, background:settingsTab==='advanced'?'#2563eb':'#1e293b', padding:'9px 13px', whiteSpace:'nowrap' }}>반별 고급설정</button>
              <button onClick={()=>setSettingsTab('admin')} style={{ ...buttonBase, background:settingsTab==='admin'?'#2563eb':'#1e293b', padding:'9px 13px', whiteSpace:'nowrap' }}>관리자설정</button>
            </div>

            {settingsTab === 'personal' && <div style={{ display:'grid', gap:12 }}>
              <label style={{ fontSize:12, color:'#94a3b8', fontWeight:900 }}>나의 반</label>
              <select value={personalBand} onChange={e=>{ setPersonalBand(e.target.value); setPersonalName(''); }} style={selectStyle}>{EMPLOYEE_BANDS.map(b=><option key={b}>{b}</option>)}</select>
              <label style={{ fontSize:12, color:'#94a3b8', fontWeight:900 }}>이름</label>
              <select value={personalName} onChange={e=>setPersonalName(e.target.value)} style={selectStyle}>
                <option value="">선택 안 함</option>
                {activeEmployeeList.filter(emp=>emp.band===personalBand).map(emp=><option key={emp.id} value={emp.name}>{emp.name}</option>)}
              </select>
              <label style={{ fontSize:12, color:'#94a3b8', fontWeight:900 }}>나의 근무지</label>
              <select value={personalDivision} onChange={e=>setPersonalDivision(e.target.value)} style={selectStyle}>{['1발전','2발전'].map(d=><option key={d}>{d}</option>)}</select>
              <button onClick={savePersonalSettings} style={{ ...buttonBase, background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'11px 14px' }}>개인설정 저장</button>
            </div>}

            {settingsTab === 'advanced' && <div style={{ display:'grid', gap:12 }}>
              <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:12, padding:12 }}>
                <label style={{ fontSize:12, color:'#94a3b8', fontWeight:900 }}>반 선택</label>
                <select value={advancedBand} onChange={e=>setAdvancedBand(e.target.value)} style={{ ...selectStyle, width:'100%', marginTop:7 }}>{EMPLOYEE_BANDS.map(b=><option key={b}>{b}</option>)}</select>
                <div style={{ display:'grid', gap:10, marginTop:12 }}>
                  <label style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'10px 12px', fontSize:13, fontWeight:950 }}>
                    <span>근무지순서 사용</span>
                    <input type="checkbox" checked={Boolean((advancedSettings[advancedBand] || defaultAdvancedSettings[advancedBand])?.positionOrderEnabled)} onChange={e=>updateAdvancedSetting(advancedBand, 'positionOrderEnabled', e.target.checked)} />
                  </label>
                  <label style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'10px 12px', fontSize:13, fontWeight:950 }}>
                    <span>근무별순서 사용</span>
                    <input type="checkbox" checked={Boolean((advancedSettings[advancedBand] || defaultAdvancedSettings[advancedBand])?.shiftOrderEnabled)} onChange={e=>updateAdvancedSetting(advancedBand, 'shiftOrderEnabled', e.target.checked)} />
                  </label>
                </div>
                <div style={{ marginTop:10, fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>ON/OFF는 이 기기 설정에 저장됩니다. 현재 선택한 반 화면에서 바로 반영돼요.</div>
              </div>
            </div>}

            {settingsTab === 'admin' && <div>
              {!isAdminMode ? <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <input type="password" value={adminCodeInput} onChange={e=>setAdminCodeInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAdminLogin()} placeholder="관리자 암호" style={{ ...selectStyle, minWidth:160 }} />
                <button onClick={handleAdminLogin} style={{ ...buttonBase, background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'10px 13px' }}>관리자설정 열기</button>
              </div> : <div style={{ display:'grid', gap:14 }}>
                <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:12, padding:12 }}>
                  <div style={{ fontWeight:950, marginBottom:10 }}>직원 DB 관리</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 1fr auto', gap:8 }}>
                    <input value={employeeForm.name} onChange={e=>setEmployeeForm(f=>({...f,name:e.target.value}))} placeholder="실명 예: 문태헌" style={selectStyle} />
                    <select value={employeeForm.band} onChange={e=>setEmployeeForm(f=>({...f,band:e.target.value}))} style={selectStyle}>{EMPLOYEE_BANDS.map(b=><option key={b}>{b}</option>)}</select>
                    <input value={employeeForm.outputName} onChange={e=>setEmployeeForm(f=>({...f,outputName:e.target.value}))} placeholder="출력이름 예: 태헌 / 진수A" style={selectStyle} />
                    <button onClick={handleEmployeeAdd} style={{ ...buttonBase, background:'#059669', padding:'8px 12px' }}>추가</button>
                  </div>
                  <div style={{ display:'grid', gap:10, marginTop:12 }}>
                    {EMPLOYEE_BANDS.map(b => <div key={b} style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:10 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                        <div style={{ fontSize:13, fontWeight:950 }}>{b}</div>
                        <button onClick={()=>clearBandEmployees(b)} style={{ border:'none', borderRadius:7, background:'#7f1d1d', color:'#fecaca', padding:'5px 8px', fontSize:11, fontWeight:950, cursor:'pointer' }}>전체삭제</button>
                      </div>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {employeeList.filter(emp=>emp.band===b && emp.active).map(emp => <span key={emp.id} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1e293b', border:'1px solid #334155', borderRadius:999, padding:'6px 9px', fontSize:12, fontWeight:900 }}>
                          {getEmployeeDisplayName(emp)}<button onClick={()=>deleteEmployee(emp.id)} style={{ border:'none', background:'#7f1d1d', color:'#fecaca', borderRadius:999, cursor:'pointer', fontWeight:950 }}>×</button>
                        </span>)}
                        {employeeList.filter(emp=>emp.band===b && emp.active).length===0 && <span style={{ color:'#64748b', fontSize:12 }}>비어있음</span>}
                      </div>
                    </div>)}
                  </div>
                </div>
                <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:12, padding:12 }}>
                  <div style={{ fontWeight:950, marginBottom:10 }}>공지사항 관리</div>
                  <textarea value={noticeForm.text} onChange={e=>setNoticeForm(f=>({...f,text:e.target.value}))} placeholder="전체 사용자에게 표시할 공지사항" style={{ ...selectStyle, width:'100%', minHeight:70, resize:'vertical', boxSizing:'border-box', lineHeight:1.45 }} />
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginTop:8 }}>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:900, color:'#cbd5e1' }}>
                      <input type="checkbox" checked={noticeForm.enabled} onChange={e=>setNoticeForm(f=>({...f,enabled:e.target.checked}))} /> 공지 표시
                    </label>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:900, color:'#fecaca' }}>
                      <input type="checkbox" checked={noticeForm.urgent} onChange={e=>setNoticeForm(f=>({...f,urgent:e.target.checked}))} /> 긴급공지
                    </label>
                  </div>
                  <div style={{ display:'flex', gap:8, marginTop:10 }}>
                    <button onClick={saveGlobalNotice} style={{ ...buttonBase, background:'#2563eb', padding:'9px 12px', fontSize:12 }}>공지 저장</button>
                    <button onClick={clearGlobalNotice} style={{ ...buttonBase, background:'#7f1d1d', padding:'9px 12px', fontSize:12 }}>공지 삭제</button>
                  </div>
                  <div style={{ marginTop:8, fontSize:11, color:'#94a3b8' }}>저장 경로: settings/globalNotice · 월/반/발전과 무관하게 전체 적용</div>
                </div>

                <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:12, padding:12 }}>
                  <div style={{ fontWeight:950, marginBottom:8 }}>근무자 수 설정</div>
                  <div style={{ display:'flex', gap:6 }}>{[4,5,6].map(n=><button key={n} onClick={()=>handleWorkerCountChange(n)} style={{ ...buttonBase, width:42, height:36, background:workerCount===n?'#2563eb':'#334155' }}>{n}</button>)}</div>
                </div>
                <button onClick={()=>setIsAdminMode(false)} style={{ ...buttonBase, background:'#7f1d1d', padding:'10px 12px' }}>관리자모드 종료</button>
              </div>}
            </div>}
          </div>
        </div>}

        {savedToast && <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:13, fontWeight:900, padding:'10px 20px', borderRadius:10, zIndex:1000 }}>✅ 저장됐어요</div>}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
