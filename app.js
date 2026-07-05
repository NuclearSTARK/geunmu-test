const { useState, useEffect, useRef, useCallback } = React;
// v5.3.0: 전체 근무로직 리셋 + N/A/D 근무별 세부순서 보정


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

function getWorkdayRotationIndex(year, month, day, division, band) {
  // v5.3.0: 전체 근무일 기준 순환 엔진
  // - N/A/D 근무 종류와 무관하게 "휴"가 아닌 날만 카운트
  // - 당월 1일부터 해당 날짜 전날까지의 근무일 수를 회전값으로 사용
  // - 휴무일은 회전 카운트에서 제외
  let count = 0;
  for (let d = 1; d < day; d++) {
    const shift = getShiftForDate(year, month, d, division, band);
    if (shift !== "휴") count++;
  }
  return count;
}

function getShiftDetailOrder(shiftOrders, shift, count) {
  // 근무별 세부순서 보정: N/A/D별로 사용자가 저장한 순서를 최종 매핑에 반영
  const identity = Array.from({ length: count }, (_, i) => i);
  const normalized = normalizeShiftOrders(shiftOrders, "", count);
  const raw = Array.isArray(normalized?.[shift]) ? normalized[shift] : identity;
  const result = raw.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < count);
  for (let i = 0; i < count; i++) if (!result.includes(i)) result.push(i);
  return result.slice(0, count);
}

function generateSchedule(names, year, month, division, workerCount, shiftOrders, band = "C반") {
  if (names.length !== workerCount) return [];
  const positions = POSITIONS_BY_DIV_COUNT[division][workerCount];
  const days = getDaysInMonth(year, month);
  const wc = workerCount;

  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const dow = getDow(year, month, day);
    const shift = getShiftForDate(year, month, day, division, band);
    const holiday = isKoreanHoliday(year, month, day);
    const isRed = dow === "토" || dow === "일" || holiday;

    if (shift === "휴") return { day, dow, shift, assignment: null, isRed, holiday };

    // 전체 근무일 기준 회전값. 근무 종류가 바뀌어도 카운트는 계속 이어집니다.
    // 예: 1 2 3 4 → 4 1 2 3 → 3 4 1 2 → 휴 → 2 3 4 1
    const rotation = getWorkdayRotationIndex(year, month, day, division, band);
    const detailOrder = getShiftDetailOrder(shiftOrders, shift, wc);
    const assignment = {};

    positions.forEach((pos, posIdx) => {
      // 오른쪽 마지막 사람이 앞으로 오는 회전.
      const baseIdx = ((posIdx - rotation) % wc + wc) % wc;
      const nameIdx = detailOrder[baseIdx] ?? baseIdx;
      assignment[pos] = names[nameIdx] || "";
    });

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

  // 저장된 설정 불러오기 (반+발전별 독립 저장)
  const initBand = "C반";
  const initDivision = "1발전";
  const saved = loadSaved(initBand, initDivision);
  const initCount = saved?.workerCount || 4;
  const initNames = saved?.names || DEFAULT_NAMES[initCount];
  const initPositionLabels = saved?.positionLabels || getDefaultPositionLabels(initDivision, initCount);

  const [band, setBand] = useState(initBand);
  const [division, setDivision] = useState(initDivision);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [workerCount, setWorkerCount] = useState(initCount);
  const [inputNames, setInputNames] = useState(initNames);
  const [names, setNames] = useState(initNames);
  const [positionLabels, setPositionLabels] = useState(initPositionLabels);

  // 근무별 순서 — 발전별 기본값 (저장값 있으면 유지)
  const defaultOrders1 = getDefaultShiftOrders(initDivision, initCount);
  const initOrders = saved?.shiftOrders || defaultOrders1;
  const [currentBand, setCurrentBand] = useState(initBand);
  const [shiftOrders, setShiftOrders] = useState(initOrders);
  const [editingShift, setEditingShift] = useState(null); // 현재 편집 중인 근무

  const [schedule, setSchedule] = useState(() =>
    generateSchedule(initNames, today.getFullYear(), today.getMonth()+1, initDivision, initCount, initOrders, initBand)
  );
  const [error, setError] = useState("");
  const [savedToast, setSavedToast] = useState(false);

  const applyingRemoteRef = useRef(false);
  const lastRemoteCoreRef = useRef("");
  const saveTimerRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Firebase 연결 준비중");

  // v5.0.2 직원 DB / 간단 관리자모드
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [showEmployeePanel, setShowEmployeePanel] = useState(false);
  const [employees, setEmployees] = useState({});
  const [employeeForm, setEmployeeForm] = useState({ name:"", band:initBand });

  // Firebase에서 직원 DB 실시간 불러오기
  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;

    const attachEmployees = () => {
      if (cancelled) return;
      if (!window.firebaseDB) {
        setTimeout(attachEmployees, 200);
        return;
      }
      unsubscribe = window.firebaseDB.listen("employees", (data) => {
        if (cancelled) return;
        setEmployees(data || {});
      });
    };

    attachEmployees();
    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const employeeList = sortEmployees(Object.entries(employees || {}).map(([id, raw]) => normalizeEmployee(raw, id)));
  const activeEmployeeList = employeeList.filter(emp => emp.active && emp.name);
  const employeeGroups = EMPLOYEE_BANDS
    .map(b => ({ band: b, employees: employeeList.filter(emp => emp.band === b) }))
    .filter(group => group.employees.length > 0);

  const makeEmployeeDraftGroups = useCallback((sourceEmployees) => {
    const groups = Object.fromEntries(EMPLOYEE_BANDS.map(b => [b, ""]));
    const list = sortEmployees(Object.entries(sourceEmployees || {}).map(([id, raw]) => normalizeEmployee(raw, id)))
      .filter(emp => emp.active && emp.name);
    EMPLOYEE_BANDS.forEach(b => {
      groups[b] = list.filter(emp => emp.band === b).map(emp => emp.name).join("\n");
    });
    return groups;
  }, []);

  const [employeeDraftGroups, setEmployeeDraftGroups] = useState(() => makeEmployeeDraftGroups({}));

  useEffect(() => {
    if (!isAdminMode) {
      setEmployeeDraftGroups(makeEmployeeDraftGroups(employees));
    }
  }, [employees, isAdminMode, makeEmployeeDraftGroups]);

  const updateEmployeeDraftGroup = (targetBand, value) => {
    setEmployeeDraftGroups(prev => ({ ...prev, [targetBand]: value }));
  };

  const handleEmployeeBulkSave = async () => {
    if (!window.firebaseDB?.save) { alert("Firebase 연결 후 다시 저장해주세요."); return; }

    const now = new Date().toISOString();
    const nextEmployees = {};
    let seq = 1;

    for (const b of EMPLOYEE_BANDS) {
      const namesInBand = String(employeeDraftGroups[b] || "")
        .split(/[\n,]/)
        .map(v => v.trim())
        .filter(Boolean);
      const uniqueNames = [...new Set(namesInBand)];
      for (const name of uniqueNames) {
        const old = employeeList.find(emp => emp.band === b && emp.name === name);
        const id = old?.id || `emp${String(seq).padStart(3,"0")}`;
        while (nextEmployees[id]) seq++;
        const finalId = nextEmployees[id] ? `emp${String(seq).padStart(3,"0")}` : id;
        nextEmployees[finalId] = {
          id: finalId, name, band: b, active: true,
          createdAt: old?.createdAt || now, updatedAt: now,
        };
        seq++;
      }
    }

    await window.firebaseDB.save("employees", nextEmployees);
    alert("A/B/C/D 직원 명단을 전체 저장했어요.");
  };

  const getWorkerOptions = useCallback((slotIdx) => {
    const current = String(inputNames[slotIdx] || "").trim();
    const usedNames = new Set(
      inputNames
        .map((name, idx) => idx === slotIdx ? "" : String(name || "").trim())
        .filter(Boolean)
    );
    const options = activeEmployeeList.filter(emp => emp.band === band && emp.name && (!usedNames.has(emp.name) || emp.name === current));
    if (current && !options.some(emp => emp.name === current)) {
      options.unshift({ id: `current-${slotIdx}`, name: current, band: "현재값", active: true });
    }
    return options;
  }, [activeEmployeeList, inputNames, band]);

  const setWorkerNameAt = useCallback((slotIdx, value) => {
    const next = [...inputNames];
    next[slotIdx] = value;
    setInputNames(next);
    const trimmed = next.map(v => String(v || "").trim());
    if (trimmed.every(v => v !== "") && new Set(trimmed).size === workerCount) {
      setNames(trimmed);
    }
  }, [inputNames, workerCount]);

  const handleAdminLogin = () => {
    if (adminCodeInput.trim() === ADMIN_EDIT_CODE) {
      setIsAdminMode(true);
      setAdminCodeInput("");
      setShowEmployeePanel(true);
    } else {
      alert("편집코드가 맞지 않아요.");
    }
  };

  const handleEmployeeSave = async () => {
    const name = employeeForm.name.trim();
    if (!name) { alert("직원 이름을 입력해주세요."); return; }
    const id = makeEmployeeId(employees);
    const now = new Date().toISOString();
    await window.firebaseDB?.save(`employees/${id}`, {
      id,
      name,
      band: employeeForm.band,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    setEmployeeForm({ name:"", band: employeeForm.band });
  };

  const updateEmployee = (id, patch) => {
    const before = employees?.[id] || {};
    return window.firebaseDB?.save(`employees/${id}`, {
      ...before,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    });
  };

  const applyEmployeesToCurrentSchedule = () => {
    const matched = activeEmployeeList.filter(emp => emp.band === band);
    const count = workerCount; // v5.0.5: 직원 수가 많아도 현재 설정 인원수(기본 4명)를 유지
    if (matched.length < count) {
      alert(`${band} 직원이 ${matched.length}명입니다. 현재 근무자 수 ${count}명보다 적어요.`);
      return;
    }
    const nextNames = matched.slice(0, count).map(emp => emp.name);
    const nextOrders = normalizeShiftOrders(shiftOrders, division, count);
    const nextLabels = normalizePositionLabels(positionLabels, division, count);
    setInputNames(nextNames);
    setNames(nextNames);
    setShiftOrders(nextOrders);
    setPositionLabels(nextLabels);
    setSchedule(generateSchedule(nextNames, selectedYear, selectedMonth, division, count, nextOrders, band));
    saveSetting({ band, division, year:selectedYear, month:selectedMonth, workerCount:count, names:nextNames, shiftOrders:nextOrders, positionLabels:nextLabels });
    alert(`${getMonthKey(selectedYear, selectedMonth)} ${band} 직원 DB 명단 중 ${count}명을 현재 ${division}에 적용했어요.`);
  };

  // Firebase에서 현재 반+발전 설정을 실시간으로 불러오기
  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    setIsLoaded(false);
    setSyncStatus("Firebase 연결 대기중");

    const attachFirebase = () => {
      if (cancelled) return;
      if (!window.firebaseDB) {
        setTimeout(attachFirebase, 200);
        return;
      }

      setSyncStatus(`${getMonthKey(selectedYear, selectedMonth)} 실시간 연결됨`);
      unsubscribe = window.firebaseDB.listen(getMonthlySchedulePath(selectedYear, selectedMonth, band, division), async (data) => {
        if (cancelled) return;

        // 월별 데이터가 아직 없으면 기존 ver4.x 데이터(schedules/반/발전)를 1회 초기값으로 사용합니다.
        // 이후 저장은 반드시 monthlySchedules/YYYY-MM/반/발전에만 저장되어 월별로 완전히 독립됩니다.
        let sourceData = data;
        if (!sourceData && window.firebaseDB?.read) {
          try {
            sourceData = await window.firebaseDB.read(getLegacySchedulePath(band, division));
          } catch (err) {
            console.warn("기존 설정 불러오기 실패:", err);
          }
        }
        if (cancelled) return;

        const normalized = sourceData
          ? normalizeRemoteData(sourceData, band, division)
          : {
              band,
              division,
              workerCount: 4,
              names: DEFAULT_NAMES[4],
              shiftOrders: getDefaultShiftOrders(division, 4),
              positionLabels: getDefaultPositionLabels(division, 4),
            };

        const core = makeSavableCore(normalized);
        lastRemoteCoreRef.current = data ? JSON.stringify(core) : "";

        applyingRemoteRef.current = true;
        setWorkerCount(normalized.workerCount);
        setInputNames(normalized.names);
        setNames(normalized.names);
        setPositionLabels(normalized.positionLabels);
        setShiftOrders(normalized.shiftOrders);
        setSchedule(generateSchedule(normalized.names, selectedYear, selectedMonth, division, normalized.workerCount, normalized.shiftOrders, band));
        setIsLoaded(true);
        setTimeout(() => { applyingRemoteRef.current = false; }, 50);
      });
    };

    attachFirebase();

    return () => {
      cancelled = true;
      setIsLoaded(false);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [band, division, selectedYear, selectedMonth]);

  // 입력/근무자수/순서가 바뀌면 Firebase에 자동 저장
  useEffect(() => {
    if (!isLoaded || applyingRemoteRef.current) return;
    const core = makeSavableCore({ band, division, workerCount, names, shiftOrders, positionLabels });
    const coreJson = JSON.stringify(core);
    if (coreJson === lastRemoteCoreRef.current) return;
    if (!isValidSetting(core)) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSyncStatus("저장중...");
      saveSetting({ ...core, year: selectedYear, month: selectedMonth })
        ?.then(() => {
          lastRemoteCoreRef.current = coreJson;
          setSyncStatus("저장 완료 · 실시간 연결됨");
          setTimeout(() => setSyncStatus("실시간 연결됨"), 1200);
        })
        ?.catch((err) => {
          console.warn(err);
          setSyncStatus("저장 실패");
        });
    }, 350);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [band, division, workerCount, names, shiftOrders, positionLabels, isLoaded]);

  // 근무자수 변경 시 이름 배열 조정
  const handleWorkerCountChange = (count) => {
    setWorkerCount(count);
    const newNames = inputNames.slice(0, count);
    while (newNames.length < count) newNames.push("");
    setInputNames(newNames);
    const newPositionLabels = normalizePositionLabels(positionLabels, division, count);
    setPositionLabels(newPositionLabels);
    // shiftOrders를 새 count에 맞게 확장 (부족하면 뒤에 추가)
    const newOrders = {};
    ["N","A","D"].forEach(sh => {
      const existing = shiftOrders[sh] || [];
      const arr = [...existing];
      for (let i = 0; i < count; i++) { if (!arr.includes(i)) arr.push(i); }
      newOrders[sh] = arr.slice(0, count);
    });
    setShiftOrders(newOrders);
    const trimmed = newNames.map(n => n.trim());
    if (trimmed.every(n => n !== "") && new Set(trimmed).size === count) {
      setNames(trimmed);
      setSchedule(generateSchedule(trimmed, selectedYear, selectedMonth, division, count, newOrders, band));
    }
  };

  useEffect(() => {
    setSchedule(generateSchedule(names, selectedYear, selectedMonth, division, workerCount, shiftOrders, band));
  }, [selectedYear, selectedMonth, band, division, workerCount, names, shiftOrders]);

  const handleGenerate = () => {
    const trimmed = inputNames.map(n => n.trim());
    if (trimmed.some(n => n === "")) { setError("모든 이름을 입력해주세요."); return; }
    if (new Set(trimmed).size !== workerCount) { setError("이름이 중복되지 않게 입력해주세요."); return; }
    setError("");
    setNames(trimmed);
    setSchedule(generateSchedule(trimmed, selectedYear, selectedMonth, division, workerCount, shiftOrders, band));
    saveSetting({ band, division, year: selectedYear, month: selectedMonth, workerCount, names: trimmed, shiftOrders, positionLabels });
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2200);
  };

  const positions = POSITIONS_BY_DIV_COUNT[division][workerCount];
  const displayPositionLabels = normalizePositionLabels(positionLabels, division, workerCount);


  // ver4.3: 모바일/PC 모두 작동하는 순서 드래그 수정
  const draggingOrderRef = useRef(null);
  const orderPanelRefs = useRef({});
  const [draggingKey, setDraggingKey] = useState("");

  const draggingPositionRef = useRef(null);
  const positionPanelRef = useRef(null);
  const [draggingPositionIdx, setDraggingPositionIdx] = useState(null);

  const movePositionToIndex = useCallback((fromIdx, toIndex) => {
    const safeTo = Math.max(0, Math.min(workerCount - 1, toIndex));
    if (fromIdx === safeTo) return;

    const nextLabels = normalizePositionLabels(positionLabels, division, workerCount);
    const [pickedLabel] = nextLabels.splice(fromIdx, 1);
    nextLabels.splice(safeTo, 0, pickedLabel);

    const nextInputNames = [...inputNames];
    const [pickedName] = nextInputNames.splice(fromIdx, 1);
    nextInputNames.splice(safeTo, 0, pickedName);

    setPositionLabels(nextLabels);
    setInputNames(nextInputNames);
    const trimmed = nextInputNames.map(v => String(v || "").trim());
    if (trimmed.every(v => v !== "") && new Set(trimmed).size === workerCount) {
      setNames(trimmed);
      setSchedule(generateSchedule(trimmed, selectedYear, selectedMonth, division, workerCount, shiftOrders, band));
    }
    draggingPositionRef.current = safeTo;
  }, [positionLabels, inputNames, workerCount, division, selectedYear, selectedMonth, shiftOrders, band]);

  const startPositionDrag = useCallback((e, idx) => {
    e.preventDefault();
    draggingPositionRef.current = idx;
    setDraggingPositionIdx(idx);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = "none";
  }, []);

  const endPositionDrag = useCallback(() => {
    draggingPositionRef.current = null;
    setDraggingPositionIdx(null);
    document.body.style.userSelect = "";
  }, []);

  const handlePositionPointerMove = useCallback((e) => {
    const fromIdx = draggingPositionRef.current;
    if (fromIdx === null || fromIdx === undefined) return;
    e.preventDefault();
    const panel = positionPanelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll("[data-position-drag-item='true']"));
    if (!items.length) return;

    let targetIndex = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const midX = rect.left + rect.width / 2;
      if (e.clientY < midY || (Math.abs(e.clientY - midY) < rect.height / 2 && e.clientX < midX)) {
        targetIndex = i;
        break;
      }
    }
    movePositionToIndex(fromIdx, targetIndex);
  }, [movePositionToIndex]);

  const moveShiftOrderToIndex = useCallback((shift, draggedNameIdx, toIndex) => {
    setShiftOrders(prev => {
      const order = shift === "CYCLE" ? getCycleOrder(prev, workerCount) : (prev[shift] || []);
      const from = order.indexOf(draggedNameIdx);
      if (from < 0) return prev;

      const safeTo = Math.max(0, Math.min(order.length - 1, toIndex));
      if (from === safeTo) return prev;

      const nextOrder = [...order];
      const [picked] = nextOrder.splice(from, 1);
      nextOrder.splice(safeTo, 0, picked);

      const nextOrders = { ...prev, [shift]: nextOrder };
      setSchedule(generateSchedule(names, selectedYear, selectedMonth, division, workerCount, nextOrders, band));
      return nextOrders;
    });
  }, [names, selectedYear, selectedMonth, band, division, workerCount]);

  const startOrderDrag = useCallback((e, shift, nameIdx) => {
    e.preventDefault();
    draggingOrderRef.current = { shift, nameIdx };
    setDraggingKey(`${shift}-${nameIdx}`);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = "none";
  }, []);

  const endOrderDrag = useCallback(() => {
    draggingOrderRef.current = null;
    setDraggingKey("");
    document.body.style.userSelect = "";
  }, []);

  const handleOrderPointerMove = useCallback((e) => {
    const dragging = draggingOrderRef.current;
    if (!dragging) return;
    e.preventDefault();

    const panel = orderPanelRefs.current[dragging.shift];
    if (!panel) return;

    const items = Array.from(panel.querySelectorAll("[data-drag-item='true']"));
    if (!items.length) return;

    let targetIndex = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        targetIndex = i;
        break;
      }
    }

    moveShiftOrderToIndex(dragging.shift, dragging.nameIdx, targetIndex);
  }, [moveShiftOrderToIndex]);

  // 순찰자 표시 로직
  // - A근무: 기존 규칙 유지
  // - C반 N근무: 기록/소내 모두 🚔 표시
  const cleanPosLabel = (value) => String(value || "").replace(/\(.*\)/, "").trim();

  const getPatrolInfo = useCallback((day, posIdx) => {
    if (!day.assignment) return null;

    const label = cleanPosLabel(displayPositionLabels[posIdx]);
    const isWeekendOrHoliday = day.dow === "토" || day.dow === "일" || day.holiday;

    // C반 1·2발전 N근무: 기록=1순찰, 소내=2순찰
    if (band === "C반" && day.shift === "N") {
      if (label === "기록") return { label, mark: "🚔" };
      if (label === "소내") return { label, mark: "🚔" };
      return null;
    }

    if (day.shift !== "A") return null;

    const patrolRules = {
      "C반|1발전": isWeekendOrHoliday ? "소내" : "기록",
      "C반|2발전": isWeekendOrHoliday ? "입초" : "기록",
      "A반|1발전": isWeekendOrHoliday ? "입초" : "기록",
      "A반|2발전": isWeekendOrHoliday ? "입초" : "기록",
    };

    const targetLabel = patrolRules[`${band}|${division}`];
    return label === targetLabel ? { label, mark: "🚔" } : null;
  }, [band, division, displayPositionLabels]);

  const captureRef = useRef(null);
  const [textCopied, setTextCopied] = useState(false);
  const [showScreenshotGuide, setShowScreenshotGuide] = useState(false);

  // 텍스트 복사 (카톡/문자 공유용)
  const handleCopyText = useCallback(() => {
    const lines = [];
    lines.push(`📋 ${selectedYear}년 ${selectedMonth}월 ${band} ${division} 배치표`);
    lines.push(`${"─".repeat(36)}`);
    lines.push(`${"일/요일/근무".padEnd(10)}${displayPositionLabels.map(p => p.padEnd(5)).join("")}`);
    lines.push(`${"─".repeat(36)}`);
    schedule.forEach(d => {
      const dateStr = `${d.day}(${d.dow})`.padEnd(7);
      const holiday = d.holiday ? "★" : " ";
      if (d.shift === "휴") {
        lines.push(`${holiday}${dateStr} 휴`);
      } else {
        const names = positions.map((p, posIdx) => {
          const patrol = getPatrolInfo(d, posIdx);
          return `${d.assignment[p] || ""}${patrol ? patrol.mark : ""}`.padEnd(5);
        }).join(" ");
        lines.push(`${holiday}${dateStr}[${d.shift}] ${names}`);
      }
    });
    lines.push(`${"─".repeat(36)}`);
    lines.push(`★=공휴일 · 🚔=순찰자`);
    const text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setTextCopied(true);
        setTimeout(() => setTextCopied(false), 2500);
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }, [schedule, selectedYear, selectedMonth, band, division, positions, displayPositionLabels, getPatrolInfo]);

  const fallbackCopy = (text) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); setTextCopied(true); setTimeout(() => setTextCopied(false), 2500); } catch {}
    document.body.removeChild(ta);
  };

  // 스크린샷 모드 토글
  const handleScreenshot = useCallback(() => {
    setShowScreenshotGuide(g => !g);
  }, []);

  const yearOptions = Array.from({ length: 6 }, (_, i) => 2023 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const todayDay = today.getFullYear() === selectedYear && today.getMonth()+1 === selectedMonth ? today.getDate() : null;
  const todayRef = useRef(null);
  // 오늘 날짜 강조는 유지하되 자동 스크롤은 하지 않습니다. (ver4.9 반영)

  const selectStyle = {
    padding: "8px 12px", background: "#0f172a", border: "1.5px solid #334155",
    borderRadius: 8, color: "#f1f5f9", fontSize: 15, fontWeight: 700, outline: "none",
    cursor: "pointer", appearance: "none", WebkitAppearance: "none", paddingRight: 28,
  };

  // 그리드 컬럼: 날짜 + 근무 + 포지션수
  const gridCols = `88px 42px ${positions.map(() => "1fr").join(" ")}`;

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0f172a 0%,#1e293b 100%)", fontFamily:"'Segoe UI','Apple SD Gothic Neo',sans-serif", color:"#e2e8f0", padding:"20px 14px" }}>
      <div style={{ maxWidth:920, margin:"0 auto" }}>

        {/* ── 헤더 ── */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:12, color:"#64748b", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>
            {band} {division} 근무자 배치 자동화
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            {/* 반 선택 */}
            <div style={{ display:"flex", background:"#0f172a", border:"1.5px solid #334155", borderRadius:9, padding:3, gap:2 }}>
              {["A반","B반","C반","D반"].map(b => (
                <button key={b} onClick={() => { setBand(b); }} style={{
                  padding:"6px 10px", borderRadius:7, border:"none", fontSize:13, fontWeight:800,
                  cursor:"pointer", transition:"all 0.15s",
                  background: band === b ? "linear-gradient(135deg,#0ea5e9,#6366f1)" : "transparent",
                  color: band === b ? "#fff" : "#64748b",
                }}>{b}</button>
              ))}
            </div>

            {/* 발전 토글 */}
            <div style={{ display:"flex", background:"#0f172a", border:"1.5px solid #334155", borderRadius:9, padding:3, gap:3 }}>
              {["1발전","2발전"].map(div => (
                <button key={div} onClick={() => { setDivision(div); }} style={{
                  padding:"6px 14px", borderRadius:7, border:"none", fontSize:13, fontWeight:800,
                  cursor:"pointer", transition:"all 0.15s",
                  background: division === div
                    ? (div === "1발전" ? "linear-gradient(135deg,#f59e0b,#f97316)" : "linear-gradient(135deg,#6366f1,#8b5cf6)")
                    : "transparent",
                  color: division === div ? "#fff" : "#64748b",
                }}>{div}</button>
              ))}
            </div>

            {/* 년도 */}
            <div style={{ position:"relative", display:"inline-block" }}>
              <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} style={selectStyle}>
                {yearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <span style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", color:"#64748b", pointerEvents:"none", fontSize:11 }}>▼</span>
            </div>

            {/* 월 */}
            <div style={{ position:"relative", display:"inline-block" }}>
              <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} style={selectStyle}>
                {monthOptions.map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
              <span style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", color:"#64748b", pointerEvents:"none", fontSize:11 }}>▼</span>
            </div>

            {/* 근무자 수: 관리자모드에서만 수정 */}
            {isAdminMode ? (
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:12, color:"#64748b", fontWeight:600, whiteSpace:"nowrap" }}>근무자 수</span>
                <div style={{ display:"flex", background:"#0f172a", border:"1.5px solid #334155", borderRadius:9, padding:3, gap:3 }}>
                  {[4,5,6].map(n => (
                    <button key={n} onClick={() => handleWorkerCountChange(n)} style={{
                      width:34, height:30, borderRadius:7, border:"none", fontSize:13, fontWeight:800,
                      cursor:"pointer", transition:"all 0.15s",
                      background: workerCount === n ? "linear-gradient(135deg,#0ea5e9,#2563eb)" : "transparent",
                      color: workerCount === n ? "#fff" : "#64748b",
                    }}>{n}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize:12, color:"#64748b", fontWeight:800, padding:"7px 9px", background:"#0f172a", border:"1px solid #334155", borderRadius:8 }}>
                근무자 {workerCount}명
              </div>
            )}

            <div style={{ fontSize:26, fontWeight:900, letterSpacing:"-1px" }}>👨‍✈️ SEUL POLICE</div>
          </div>

          <div style={{ fontSize:12, color:"#475569", marginTop:4 }}>
            오늘: {today.getFullYear()}년 {today.getMonth()+1}월 {today.getDate()}일 ({DOW_KR[today.getDay()]})
            &nbsp;·&nbsp; 🔴 주말/공휴일 표시
          </div>
        </div>

        {/* ── 관리자모드 / 직원 DB ── */}
        <div style={{ background:"#111827", border:"1px solid #334155", borderRadius:14, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:900, color:"#e2e8f0" }}>👥 직원 DB</div>
              <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>
                직원은 emp001 방식으로 자동 생성됩니다. DB에는 반과 이름만 저장합니다.
              </div>
            </div>
            {isAdminMode ? (
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => setShowEmployeePanel(v => !v)} style={{ background:"#334155", border:"none", borderRadius:7, color:"#fff", fontSize:11, fontWeight:800, padding:"7px 10px", cursor:"pointer" }}>
                  {showEmployeePanel ? "직원 DB 닫기" : "직원 DB 열기"}
                </button>
                <button onClick={() => { setIsAdminMode(false); setShowEmployeePanel(false); }} style={{ background:"#7f1d1d", border:"none", borderRadius:7, color:"#fecaca", fontSize:11, fontWeight:800, padding:"7px 10px", cursor:"pointer" }}>
                  편집종료
                </button>
              </div>
            ) : (
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <input
                  value={adminCodeInput}
                  onChange={e => setAdminCodeInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdminLogin()}
                  placeholder="편집코드"
                  type="password"
                  style={{ width:110, padding:"7px 9px", background:"#0f172a", border:"1px solid #334155", borderRadius:7, color:"#f1f5f9", fontSize:12, outline:"none" }}
                />
                <button onClick={handleAdminLogin} style={{ background:"linear-gradient(135deg,#0ea5e9,#2563eb)", border:"none", borderRadius:7, color:"#fff", fontSize:11, fontWeight:800, padding:"8px 10px", cursor:"pointer" }}>
                  관리자모드
                </button>
              </div>
            )}
          </div>

          {isAdminMode && showEmployeePanel && (
            <div style={{ marginTop:14, borderTop:"1px solid #334155", paddingTop:14 }}>
              <div style={{ fontSize:12, color:"#94a3b8", marginBottom:10, lineHeight:1.6 }}>
                각 반 명단을 줄바꿈으로 입력하고 <b style={{color:"#f8fafc"}}>전체 저장</b>을 누르면 A/B/C/D가 한 번에 Firebase에 저장됩니다.
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10, marginBottom:10 }}>
                {EMPLOYEE_BANDS.map(b => (
                  <div key={b} style={{ background:"#0b1220", border:"1px solid #263449", borderRadius:10, padding:"10px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                      <div style={{ fontSize:13, fontWeight:900, color:"#f1f5f9" }}>👥 {b}</div>
                      <div style={{ fontSize:10, color:"#64748b", fontWeight:800 }}>줄바꿈 입력</div>
                    </div>
                    <textarea
                      value={employeeDraftGroups[b] || ""}
                      onChange={e => updateEmployeeDraftGroup(b, e.target.value)}
                      placeholder={`${b} 직원명\n예: 준우\n준형\n승진\n기훈`}
                      style={{
                        width:"100%", minHeight:150, boxSizing:"border-box", resize:"vertical",
                        padding:"9px 10px", background:"#0f172a", border:"1px solid #334155",
                        borderRadius:8, color:"#f1f5f9", fontSize:13, fontWeight:800,
                        lineHeight:1.7, outline:"none", fontFamily:"inherit"
                      }}
                    />
                  </div>
                ))}
              </div>

              <button onClick={handleEmployeeBulkSave} style={{ width:"100%", marginBottom:10, background:"linear-gradient(135deg,#10b981,#059669)", border:"none", borderRadius:8, color:"#fff", fontSize:13, fontWeight:900, padding:"10px 10px", cursor:"pointer" }}>
                ✅ A/B/C/D 명단 전체 저장
              </button>

              <button onClick={applyEmployeesToCurrentSchedule} style={{ width:"100%", background:"linear-gradient(135deg,#f59e0b,#f97316)", border:"none", borderRadius:8, color:"#fff", fontSize:12, fontWeight:900, padding:"9px 10px", cursor:"pointer" }}>
                📌 현재 {getMonthKey(selectedYear, selectedMonth)} {band} 직원 DB 명단을 {division}에 적용
              </button>
            </div>
          )}
        </div>

        {/* ── 이름 입력 ── */}
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:14, padding:"18px 20px", marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:12, textTransform:"uppercase", letterSpacing:"0.05em" }}>
            근무자 이름 ({workerCount}명)
            <span style={{ marginLeft:8, fontWeight:500, textTransform:"none", fontSize:11, color:"#475569" }}>
              — 현재 선택한 반의 직원 DB만 표시 · 근무지는 드래그로 순서 변경 · Firebase 자동 저장
            </span>
          </div>
          <div
            ref={positionPanelRef}
            onPointerMove={handlePositionPointerMove}
            onPointerUp={endPositionDrag}
            onPointerCancel={endPositionDrag}
            style={{ display:"grid", gridTemplateColumns:`repeat(${workerCount},1fr)`, gap:8, marginBottom:12 }}
          >
            {Array.from({ length: workerCount }, (_, i) => {
              const isPosDragging = draggingPositionIdx === i;
              return (
              <div key={`${displayPositionLabels[i]}-${i}`} data-position-drag-item="true">
                <div
                  onPointerDown={e => startPositionDrag(e, i)}
                  style={{
                    fontSize:11, color:"#94a3b8", marginBottom:5, fontWeight:900,
                    display:"flex", alignItems:"center", justifyContent:"center", gap:5,
                    background: isPosDragging ? "#334155" : "#111827",
                    border: isPosDragging ? "1px solid #f59e0b" : "1px solid #334155",
                    borderRadius:6, padding:"5px 6px", cursor:"grab", touchAction:"none", userSelect:"none",
                    boxShadow: isPosDragging ? "0 6px 16px rgba(0,0,0,0.35)" : "none"
                  }}
                  title="근무지를 잡고 드래그하면 순서가 바뀝니다"
                >
                  <span style={{ color:"#64748b" }}>☰</span>
                  <span>{displayPositionLabels[i] || `근무지${i+1}`}</span>
                </div>
                <select
                  value={inputNames[i] || ""}
                  onChange={e => setWorkerNameAt(i, e.target.value)}
                  style={{ width:"100%", padding:"9px 10px", background:"#0f172a", border:"1.5px solid #334155", borderRadius:8, color:"#f1f5f9", fontSize:14, fontWeight:800, outline:"none", boxSizing:"border-box" }}
                >
                  <option value="">직원 선택</option>
                  {getWorkerOptions(i).map(emp => (
                    <option key={`${emp.id}-${emp.name}`} value={emp.name}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
              );
            })}
          </div>
          {error && (
            <div style={{ color:"#f87171", fontSize:12, marginBottom:10, padding:"7px 11px", background:"#450a0a", borderRadius:6, border:"1px solid #7f1d1d" }}>
              ⚠️ {error}
            </div>
          )}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={handleGenerate} style={{ padding:"9px 0", background:"linear-gradient(135deg,#f59e0b,#f97316)", border:"none", borderRadius:8, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", flex:1 }}>
              🔄 배치표 생성
            </button>
            <button onClick={handleScreenshot} style={{ padding:"9px 0", background: showScreenshotGuide ? "linear-gradient(135deg,#b45309,#d97706)" : "linear-gradient(135deg,#db2777,#e11d48)", border:"none", borderRadius:8, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", flex:1 }}>
              {showScreenshotGuide ? "✕ 닫기" : "📸 스크린샷"}
            </button>
          </div>
        </div>

        {/* ── 스크린샷 모드: 31일 전체 압축 뷰 ── */}
        {showScreenshotGuide && (
          <div style={{
            position:"fixed", top:0, left:0, right:0, bottom:0,
            background:"#0f172a", zIndex:200,
            display:"flex", flexDirection:"column",
            padding:"6px 6px 6px",
          }}>
            {/* 상단 헤더 */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4, flexShrink:0 }}>
              <div style={{ fontSize:11, fontWeight:800, color:"#f1f5f9" }}>
                {selectedYear}년 {selectedMonth}월 {band} {division} 배치표
              </div>
              <button onClick={() => setShowScreenshotGuide(false)} style={{
                background:"#334155", border:"none", borderRadius:6,
                color:"#fff", fontSize:11, fontWeight:700, padding:"4px 10px", cursor:"pointer"
              }}>✕ 닫기</button>
            </div>

            {/* 배치표 — flex:1로 남은 공간 전부 사용, overflow hidden */}
            <div style={{ background:"#1e293b", borderRadius:8, overflow:"hidden", flex:1, display:"flex", flexDirection:"column" }}>
              {/* 컬럼 헤더 */}
              <div style={{
                display:"grid",
                gridTemplateColumns:`44px 22px ${positions.map(()=>"1fr").join(" ")}`,
                background:"#0f172a", padding:"0 4px", flexShrink:0,
                borderBottom:"1px solid #334155"
              }}>
                {["날짜","근무",...displayPositionLabels].map(h=>(
                  <div key={h} style={{ padding:"3px 1px", fontSize:9, fontWeight:700, color:"#64748b", textAlign:"center" }}>{h}</div>
                ))}
              </div>

              {/* 행들 — flex:1, overflow hidden → 자동으로 화면에 맞게 */}
              <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
                {schedule.map((day, idx) => {
                  const textColor = day.isRed ? "#ef4444" : "#cbd5e1";
                  const isToday2 = day.day === todayDay;
                  const shiftColors = { N:"#1a56db", A:"#057a55", D:"#c27803" };
                  return (
                    <div key={day.day} style={{
                      flex:1,
                      display:"grid",
                      gridTemplateColumns:`44px 22px ${positions.map(()=>"1fr").join(" ")}`,
                      borderBottom: idx < schedule.length-1 ? "1px solid #0f172a" : "none",
                      background: isToday2 ? "rgba(245,158,11,0.15)" : idx%2===0 ? "transparent" : "#172032",
                      padding:"0 4px",
                      outline: isToday2 ? "1px solid #f59e0b" : "none",
                      minHeight:0,
                    }}>
                      <div style={{ fontSize:9, fontWeight:600, color:textColor, display:"flex", alignItems:"center", gap:1, overflow:"hidden" }}>
                        {isToday2 && <span style={{width:3,height:3,borderRadius:"50%",background:"#f59e0b",flexShrink:0}}/>}
                        <span>{day.day}({day.dow}){day.holiday?"★":""}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {day.shift !== "휴"
                          ? <span style={{ background:shiftColors[day.shift], color:"#fff", borderRadius:2, padding:"0px 3px", fontSize:8, fontWeight:800, lineHeight:"14px" }}>{day.shift}</span>
                          : <span style={{ fontSize:8, color:"#475569" }}>휴</span>
                        }
                      </div>
                      {positions.map((pos, posIdx) => {
                        const patrol = getPatrolInfo(day, posIdx);
                        return (
                          <div key={pos} style={{
                            fontSize:9, fontWeight: patrol ? 900 : 600,
                            color: day.assignment ? (patrol ? "#fde047" : "#f1f5f9") : "transparent",
                            textAlign:"center", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden",
                            background: patrol ? "rgba(250,204,21,0.18)" : "transparent", borderRadius:3
                          }}>
                            {day.assignment ? (<>{day.assignment[pos]}{patrol && <span style={{ marginLeft:2 }}>{patrol.mark}</span>}</>) : ""}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 하단 안내 */}
            <div style={{ marginTop:4, fontSize:9, color:"#475569", textAlign:"center", flexShrink:0 }}>
              📸 지금 스크린샷! &nbsp; 🚔 순찰자 &nbsp; 🍎 사이드+볼륨↑ &nbsp; 🤖 전원+볼륨↓
            </div>
          </div>
        )}

        {/* ── 근무 순서 편집 패널 + 배치표 캡처 영역 ── */}
        <div ref={captureRef} style={{ background:"#0f172a", padding:"4px 0" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16 }}>
          {["N","A","D"].map(shift => {
            const isEditing = editingShift === shift;
            const order = getShiftDetailOrder(shiftOrders, shift, workerCount);
            return (
              <div key={shift} style={{ background:"#1e293b", border: isEditing ? `2px solid ${SHIFT_COLORS[shift].bg}` : "1px solid #334155", borderRadius:10, padding:"10px 11px", transition:"border 0.15s" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ background:SHIFT_COLORS[shift].bg, color:"#fff", borderRadius:5, padding:"2px 8px", fontSize:12, fontWeight:800 }}>{shift}</span>
                    <span style={{ fontSize:10, color:"#64748b" }}>근무별 순서</span>
                  </div>
                  <button
                    onClick={() => setEditingShift(isEditing ? null : shift)}
                    style={{ background: isEditing ? SHIFT_COLORS[shift].bg : "#334155", border:"none", borderRadius:5, color:"#fff", fontSize:10, fontWeight:700, padding:"3px 7px", cursor:"pointer" }}
                  >{isEditing ? "✓ 완료" : "✏️ 수정"}</button>
                </div>
                {isEditing ? (
                  <div
                    ref={el => { orderPanelRefs.current[shift] = el; }}
                    onPointerMove={handleOrderPointerMove}
                    onPointerUp={endOrderDrag}
                    onPointerCancel={endOrderDrag}
                    style={{ display:"flex", flexDirection:"column", gap:5 }}
                  >
                    {order.map((nameIdx, pos) => {
                      const isDragging = draggingKey === `${shift}-${nameIdx}`;
                      return (
                        <div
                          key={nameIdx}
                          data-drag-item="true"
                          data-drag-shift={shift}
                          data-name-idx={nameIdx}
                          onPointerDown={(e) => startOrderDrag(e, shift, nameIdx)}
                          style={{
                            display:"flex", alignItems:"center", gap:6,
                            background: isDragging ? "#334155" : "#0f172a",
                            border: isDragging ? `1px solid ${SHIFT_COLORS[shift].bg}` : "1px solid #263449",
                            borderRadius:7, padding:"6px 7px",
                            cursor:"grab", touchAction:"none", userSelect:"none",
                            opacity: isDragging ? 0.78 : 1,
                            boxShadow: isDragging ? "0 6px 16px rgba(0,0,0,0.35)" : "none",
                            transition:"background 0.12s, border 0.12s, box-shadow 0.12s"
                          }}
                        >
                          <span style={{ fontSize:13, color:"#64748b", width:16, textAlign:"center", flexShrink:0 }}>☰</span>
                          <span style={{ fontSize:10, color:"#475569", width:14, textAlign:"right", flexShrink:0 }}>{pos+1}</span>
                          <span style={{ flex:1, fontSize:12, fontWeight:800, color:"#f1f5f9", textAlign:"center" }}>
                            {names[nameIdx] || "?"}
                          </span>
                        </div>
                      );
                    })}
                    <div style={{ fontSize:9, color:"#64748b", textAlign:"center", marginTop:2 }}>
                      기본 순환 결과에 N/A/D별 세부순서 보정을 적용합니다
                    </div>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:3, alignItems:"center" }}>
                    {order.map((nameIdx, idx) => (
                      <div key={idx} style={{ display:"flex", alignItems:"center", gap:2 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:"#f1f5f9", background:"#0f172a", borderRadius:4, padding:"2px 6px" }}>{names[nameIdx] || "?"}</span>
                        {idx < order.length-1 && <span style={{ color:"#334155", fontSize:10 }}>→</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* ── 배치표 테이블 ── */}
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:14, overflow:"hidden" }}>
          {/* 테이블 헤더 */}
          <div style={{ background:"#0f172a", padding:"11px 16px", borderBottom:"1px solid #334155", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:800, fontSize:14 }}>
              {selectedYear}년 {selectedMonth}월 {band} {division} 배치
            </span>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:11, color:"#94a3b8" }}>근무자 {workerCount}명 · {positions.length}포지션</span>
              <span style={{ fontSize:11, color:"#dc2626" }}>🔴 주말·공휴일</span>
              <span style={{ fontSize:11, color:"#64748b" }}>{schedule.filter(d=>d.shift!=="휴").length}일 근무</span>
            </div>
          </div>

          {/* 컬럼 헤더 */}
          <div style={{ display:"grid", gridTemplateColumns:gridCols, background:"#0f172a", borderBottom:"1px solid #334155", padding:"0 14px" }}>
            {["일/요일","근무",...displayPositionLabels].map(h => (
              <div key={h} style={{ padding:"8px 4px", fontSize:11, fontWeight:700, color:"#64748b", textAlign:"center" }}>{h}</div>
            ))}
          </div>

          {/* 행 */}
          {schedule.map((day, idx) => {
            const isToday = day.day === todayDay;
            const textColor = day.isRed ? "#ef4444" : "#cbd5e1";
            const rowBg = isToday ? "rgba(245,158,11,0.1)" : idx % 2 === 0 ? "transparent" : "#172032";
            return (
              <div key={day.day} ref={isToday ? todayRef : null} style={{
                display:"grid", gridTemplateColumns:gridCols,
                borderBottom: idx < schedule.length-1 ? "1px solid #1e293b" : "none",
                background: rowBg, padding:"0 14px",
                outline: isToday ? "2px solid #f59e0b" : "none", outlineOffset:"-1px",
              }}>
                {/* 날짜 */}
                <div style={{ padding:"9px 4px", display:"flex", alignItems:"center", gap:4 }}>
                  {isToday && <span style={{ width:5, height:5, borderRadius:"50%", background:"#f59e0b", flexShrink:0 }} />}
                  <span style={{ fontSize:13, fontWeight: isToday ? 800 : 600, color: textColor }}>{day.day}</span>
                  <span style={{ fontSize:12, color: textColor }}>({day.dow})</span>
                  {day.holiday && <span style={{ fontSize:10, color:"#ef4444" }}>★</span>}
                </div>
                {/* 근무 */}
                <div style={{ padding:"9px 2px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {day.shift !== "휴" ? (
                    <span style={{ background:SHIFT_COLORS[day.shift].bg, color:"#fff", borderRadius:5, padding:"2px 7px", fontSize:11, fontWeight:800 }}>
                      {day.shift}
                    </span>
                  ) : (
                    <span style={{ fontSize:11, color:"#475569" }}>휴</span>
                  )}
                </div>
                {/* 배치 */}
                {positions.map((pos, posIdx) => {
                  const patrol = getPatrolInfo(day, posIdx);
                  return (
                    <div key={pos} style={{
                      padding:"9px 4px", fontSize:12, fontWeight: patrol ? 900 : (day.assignment ? 600 : 400),
                      color: day.assignment ? (patrol ? "#fde047" : "#f1f5f9") : "#334155",
                      textAlign:"center", background: patrol ? "rgba(250,204,21,0.16)" : "transparent",
                      borderRadius:6, boxShadow: patrol ? "inset 0 0 0 1px rgba(250,204,21,0.45)" : "none"
                    }}>
                      {day.assignment ? (<>{day.assignment[pos]}{patrol && <span style={{ marginLeft:4 }}>{patrol.mark}</span>}</>) : ""}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop:12, fontSize:12, color:"#94a3b8", textAlign:"center", paddingBottom:10, fontWeight:700, lineHeight:1.7 }}>
          🚔 순찰자 &nbsp;·&nbsp; ★ 공휴일 &nbsp;·&nbsp; 🔴 주말/공휴일 빨간 표시 &nbsp;·&nbsp; 오늘 = 주황 하이라이트
        </div>
        </div>{/* captureRef 끝 */}

        {/* 저장 안내 */}
        <div style={{ marginTop:8, fontSize:11, color:"#1e3a2f", textAlign:"center", background:"#052e16", border:"1px solid #14532d", borderRadius:8, padding:"7px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <span>💾 이름·발전·근무자 수는 Firebase에 실시간 저장됩니다. <b style={{color:"#86efac"}}>{syncStatus}</b></span>
          <button onClick={() => {
            const defOrders = getDefaultShiftOrders(division, workerCount);
            const defNames = DEFAULT_NAMES[workerCount];
            const defaultLabels = getDefaultPositionLabels(division, workerCount);
            setShiftOrders(defOrders);
            setPositionLabels(defaultLabels);
            setInputNames(defNames);
            setNames(defNames);
            setSchedule(generateSchedule(defNames, selectedYear, selectedMonth, division, workerCount, defOrders, band));
            saveSetting({ band, division, year: selectedYear, month: selectedMonth, workerCount, names: defNames, shiftOrders: defOrders, positionLabels: defaultLabels });
            alert(`${band} ${division} 설정이 초기화됐어요!`);
          }} style={{ background:"#7f1d1d", border:"none", borderRadius:5, color:"#fca5a5", fontSize:10, fontWeight:700, padding:"3px 8px", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
            🔄 초기화
          </button>
        </div>

        {/* 제작자 푸터 */}
        <div style={{
          marginTop:24,
          paddingTop:20,
          paddingBottom:28,
          borderTop:"1px solid #334155",
          textAlign:"center",
        }}>
          <div style={{
            fontSize:15,
            fontWeight:700,
            color:"#94a3b8",
            letterSpacing:"0.3px",
            marginBottom:10,
          }}>
            Made by Hyungdai
          </div>
          <div style={{
            fontSize:28,
            fontWeight:900,
            color:"#f8fafc",
            letterSpacing:"1.5px",
            lineHeight:1.15,
            textShadow:"0 0 14px rgba(255,255,255,0.10)",
          }}>
            SEUL-POLICE 👨‍✈️
          </div>
        </div>

        {/* 저장 토스트 */}
        {savedToast && (
          <div style={{
            position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)",
            background:"#059669", color:"#fff", fontSize:13, fontWeight:700,
            padding:"10px 22px", borderRadius:10, boxShadow:"0 4px 20px rgba(0,0,0,0.4)",
            zIndex:999,
          }}>
            ✅ 설정이 저장됐어요!
          </div>
        )}
        {/* 텍스트 복사 토스트 */}
        {textCopied && (
          <div style={{
            position:"fixed", bottom:28, left:"50%", transform:"translateX(-50%)",
            background:"#7c3aed", color:"#fff", fontSize:13, fontWeight:700,
            padding:"10px 22px", borderRadius:10, boxShadow:"0 4px 20px rgba(0,0,0,0.4)",
            zIndex:999,
          }}>
            📋 클립보드에 복사됐어요! 카톡에 붙여넣기 하세요
          </div>
        )}
      </div>
    </div>
  );
}


    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
