const { useState, useEffect, useRef, useCallback } = React;
const APP_VERSION = "9.1.0-mobile-calendar";
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
  if (CUSTOM_HOLIDAYS[dateKey(year, month, day)]) return true;
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
const SHIFT_SYSTEM_PATTERNS = {
  THREE_SHIFT: ["A","A","A","휴","D","D","D","휴","N","N","N","휴"],
  TWO_SHIFT_1: ["주","야","비","휴"],
  TWO_SHIFT_2: ["주","주","휴","야","야","비","휴","휴"],
};
let ACTIVE_SHIFT_SYSTEM = { type:"THREE_SHIFT", offsets:{"A반":0,"B반":3,"C반":6,"D반":9} };
let CUSTOM_HOLIDAYS = {};
function setActiveShiftSystem(next){ if(next&&SHIFT_SYSTEM_PATTERNS[next.type]) ACTIVE_SHIFT_SYSTEM={type:next.type,offsets:{...ACTIVE_SHIFT_SYSTEM.offsets,...(next.offsets||{})}}; }
function setCustomHolidayMap(next){ CUSTOM_HOLIDAYS=next&&typeof next==='object'?next:{}; }
function dateKey(year,month,day){ return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
function getShiftForDate(year, month, day, division, band = "C반") {
  if(ACTIVE_SHIFT_SYSTEM.type==='THREE_SHIFT'){
    const base=BASE_DATES[division]; const diffDays=Math.round((new Date(year,month-1,day)-base)/86400000); const offset=BAND_CYCLE_OFFSET[band]??0;
    return SHIFT_CYCLE[(((diffDays+offset)%12)+12)%12];
  }
  const pattern=SHIFT_SYSTEM_PATTERNS[ACTIVE_SHIFT_SYSTEM.type]||SHIFT_SYSTEM_PATTERNS.TWO_SHIFT_1;
  const diffDays=Math.round((new Date(year,month-1,day)-new Date(2026,6,1))/86400000);
  const offset=Number(ACTIVE_SHIFT_SYSTEM.offsets?.[band]||0);
  return pattern[(((diffDays+offset)%pattern.length)+pattern.length)%pattern.length];
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

function rotateOrderRight(order, count) {
  const base = Array.isArray(order) ? order.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < count) : [];
  for (let i = 0; i < count; i++) if (!base.includes(i)) base.push(i);
  const arr = base.slice(0, count);
  if (arr.length <= 1) return arr;
  return [arr[arr.length - 1], ...arr.slice(0, arr.length - 1)];
}

function getDisplayOrderNames(order, names, count) {
  const arr = Array.isArray(order) ? order : Array.from({ length: count }, (_, i) => i);
  return arr.slice(0, count).map((nameIdx) => names[nameIdx] || `근무자${Number(nameIdx) + 1}`);
}

function countRegularBandWorkDaysBefore(targetDate, division, band) {
  const refDate = new Date(2026, 6, 1); // 2026-07-01 = 저장된 명단 첫 순서 기준일
  const step = targetDate >= refDate ? 1 : -1;
  let count = 0;
  for (let d = new Date(refDate); step === 1 ? d < targetDate : d > targetDate; d.setDate(d.getDate() + step)) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const sh = getShiftForDate(y, m, day, division, band);
    // 4조3교대는 기존 로직 유지. 4조2교대는 비번·휴무 모두 회전 카운트에서 제외.
    const countable = ACTIVE_SHIFT_SYSTEM.type === 'THREE_SHIFT' ? sh !== "휴" : !["비","휴"].includes(sh);
    if (countable) count += step;
  }
  return count;
}

function normalizeManualOverrides(raw) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    const day = Number(value?.day || key);
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    const names = Array.isArray(value?.names) ? value.names.map(v => String(v || "").trim()).filter(Boolean) : [];
    if (!names.length) return;
    result[day] = {
      day,
      names,
      mode: value?.mode === "single" ? "single" : "basis",
      workerCount: Number(value?.workerCount || names.length),
      updatedAt: value?.updatedAt || "",
    };
  });
  return result;
}

function getManualOverridePath(year, month, band, division) {
  return `manualOverrides/${getMonthKey(year, month)}/${band}/${division}`;
}

function rotateNamesRight(order) {
  const arr = Array.isArray(order) ? order.filter(Boolean) : [];
  if (arr.length <= 1) return arr;
  return [arr[arr.length - 1], ...arr.slice(0, arr.length - 1)];
}

function rotateNamesRightBy(order, steps) {
  const arr = Array.isArray(order) ? order.filter(Boolean) : [];
  if (arr.length <= 1) return arr;
  const len = arr.length;
  const n = ((Number(steps || 0) % len) + len) % len;
  if (n === 0) return [...arr];
  return [...arr.slice(len - n), ...arr.slice(0, len - n)];
}

const ORDER_ENGINE_BASE_DATE = new Date(2026, 6, 1); // 2026-07-01: 검증 완료된 기준 월

function countWorkDaysFromBase(targetDate, division, band, shiftFilter = null) {
  const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const base = new Date(ORDER_ENGINE_BASE_DATE.getFullYear(), ORDER_ENGINE_BASE_DATE.getMonth(), ORDER_ENGINE_BASE_DATE.getDate());
  if (target.getTime() === base.getTime()) return 0;

  let count = 0;
  if (target > base) {
    for (let d = new Date(base); d < target; d.setDate(d.getDate() + 1)) {
      const sh = getShiftForDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), division, band);
      const countable = ACTIVE_SHIFT_SYSTEM.type === 'THREE_SHIFT' ? sh !== "휴" : !["비","휴"].includes(sh);
      if (countable && (!shiftFilter || sh === shiftFilter)) count += 1;
    }
    return count;
  }

  for (let d = new Date(target); d < base; d.setDate(d.getDate() + 1)) {
    const sh = getShiftForDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), division, band);
    const countable = ACTIVE_SHIFT_SYSTEM.type === 'THREE_SHIFT' ? sh !== "휴" : !["비","휴"].includes(sh);
    if (countable && (!shiftFilter || sh === shiftFilter)) count += 1;
  }
  return -count;
}

const CANONICAL_POSITION_ORDER = {
  4: ["입초", "소내", "검색", "기록"],
  5: ["입초", "소내", "검색", "기록", "출검"],
  6: ["입초", "소내", "검색", "기록", "출검", "소내2"],
};
const POSITION_PRESETS = {
  DEFAULT: ["입초", "소내", "검색", "기록", "출검", "소내2"],
  RECORD_SECOND: ["입초", "기록", "검색", "소내", "출검", "소내2"],
};
function cleanPositionName(value) {
  return String(value || "").replace(/\(.*?\)/g, "").trim();
}
function getCanonicalPositionIndex(label, fallbackIdx, count) {
  const base = CANONICAL_POSITION_ORDER[count] || CANONICAL_POSITION_ORDER[4];
  const cleaned = cleanPositionName(label);
  const found = base.findIndex(v => cleanPositionName(v) === cleaned);
  return found >= 0 ? found : fallbackIdx;
}
function getPositionPreset(type, count) {
  const arr = POSITION_PRESETS[type] || POSITION_PRESETS.DEFAULT;
  return arr.slice(0, count);
}

function normalizeManualOrderNames(values, fallbackNames, count) {
  const result = Array.isArray(values) ? values.slice(0, count).map(v => String(v || "").trim()) : [];
  const fallback = Array.isArray(fallbackNames) ? fallbackNames : [];
  for (let i = 0; i < count; i++) {
    if (!result[i]) result[i] = fallback[i] || `근무자${i + 1}`;
  }
  return result.slice(0, count);
}


// ── v6.0 근무순서 엔진 분리 ─────────────────────────────
// UI/Firebase와 분리된 순수 계산 함수입니다. 앱 화면에는 노출하지 않습니다.
function rotationEngineABD({ names, shiftOrders, workerCount, targetDate, division, band }) {
  const normalizedOrders = normalizeShiftOrders(shiftOrders, division, workerCount);
  const cycleIndexOrder = getCycleOrder(normalizedOrders, workerCount);
  const baseOrder = getDisplayOrderNames(cycleIndexOrder, names, workerCount);
  const rotationCount = countWorkDaysFromBase(targetDate, division, band, null);
  return rotateNamesRightBy(baseOrder, rotationCount);
}

function rotationEngineC({ names, shiftOrders, workerCount, targetDate, division, band, shift }) {
  const normalizedOrders = normalizeShiftOrders(shiftOrders, division, workerCount);
  const baseShiftOrders = {
    N: getDisplayOrderNames(normalizedOrders.N, names, workerCount),
    A: getDisplayOrderNames(normalizedOrders.A, names, workerCount),
    D: getDisplayOrderNames(normalizedOrders.D, names, workerCount),
  };
  const baseOrder = baseShiftOrders[shift] || getDisplayOrderNames(getCycleOrder(normalizedOrders, workerCount), names, workerCount);
  const rotationCount = countWorkDaysFromBase(targetDate, division, band, shift);
  return rotateNamesRightBy(baseOrder, rotationCount);
}

function getWorkerOrderForDate({ names, shiftOrders, workerCount, targetDate, division, band, shift }) {
  // A/B/D반: 전체 근무일 엔진. C반: A/D/N 근무별 독립 엔진.
  if (band === "C반") {
    return rotationEngineC({ names, shiftOrders, workerCount, targetDate, division, band, shift });
  }
  return rotationEngineABD({ names, shiftOrders, workerCount, targetDate, division, band });
}

function getDisplayLabelsForSchedule(band, division, count, customPositionLabels) {
  const labels = normalizePositionLabels(customPositionLabels, division, count);
  if (count === 4 && division === '1발전' && ['A반','B반','D반'].includes(band)) return ['입초', '소내', '검색', '기록'];
  if (count === 4 && division === '1발전' && band === 'C반') return ['입초', '기록', '검색', '소내'];
  return labels;
}

function getPositionKeyFromDisplayLabel(label, positions, displayLabels) {
  const cleaned = cleanPositionName(label);
  const matched = positions.find(p => cleanPositionName(p) === cleaned);
  if (matched) return matched;
  const idx = displayLabels.findIndex(v => cleanPositionName(v) === cleaned);
  return positions[idx >= 0 ? idx : 0] || positions[0];
}

function generateSchedule(names, year, month, division, workerCount, shiftOrders, band = "C반", manualOverrides = {}, customPositionLabels = null) {
  if (names.length !== workerCount) return [];
  const positions = POSITIONS_BY_DIV_COUNT[division][workerCount];
  const displayLabels = getDisplayLabelsForSchedule(band, division, workerCount, customPositionLabels);
  const days = getDaysInMonth(year, month);
  const wc = workerCount;
  const normalizedOrders = normalizeShiftOrders(shiftOrders, division, wc);
  const cycleOrder = getCycleOrder(normalizedOrders, wc);

  const engine = window.SeulPoliceWorkEngine;

  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const dow = getDow(year, month, day);
    const shift = getShiftForDate(year, month, day, division, band);
    const holiday = isKoreanHoliday(year, month, day);
    const isRed = dow === "토" || dow === "일" || holiday;

    if (shift === "휴" || shift === "비") return { day, dow, shift, assignment: null, isRed, holiday };

    let displayOrderNames;
    if (engine && typeof engine.generateDisplayOrder === 'function') {
      displayOrderNames = engine.generateDisplayOrder({
        year,
        month,
        day,
        band,
        division,
        shift,
        workerCount: wc,
        names,
        workerOrder: cycleOrder,
        getShiftForDate,
      });
    } else {
      // 안전 fallback: 검증된 오른쪽 회전만 사용
      const targetDate = new Date(year, month - 1, day);
      const count = countWorkDaysFromBase(targetDate, division, band, band === 'C반' ? shift : null);
      const baseOrder = getDisplayOrderNames(cycleOrder, names, wc);
      displayOrderNames = rotateNamesRightBy(baseOrder, count);
    }

    const assignment = {};
    displayLabels.forEach((label, idx) => {
      const key = getPositionKeyFromDisplayLabel(label, positions, displayLabels);
      assignment[key] = displayOrderNames[idx] || "";
    });

    // 혹시 표시되지 않는 포지션 키가 있으면 빈 값으로 채워 렌더링 방어
    positions.forEach((pos) => { if (!(pos in assignment)) assignment[pos] = ""; });

    return { day, dow, shift, assignment, isRed, holiday, manualOverride: false };
  });
}

// ── 색상 ─────────────────────────────────────────────────
const SHIFT_COLORS = {
  N: { bg: "#1a56db", text: "#fff" },
  A: { bg: "#057a55", text: "#fff" },
  D: { bg: "#c27803", text: "#fff" },
  주: { bg: "#0f9f8f", text: "#fff" },
  야: { bg: "#2563eb", text: "#fff" },
  비: { bg: "#475569", text: "#fff" },
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


function formatSavedTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}

function getDisplayNameFromValue(value, employees = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const list = Object.entries(employees || {}).map(([id, emp]) => normalizeEmployee(emp, id));
  const found = list.find(emp => emp.active && (emp.name === raw || emp.outputName === raw || emp.displayName === raw));
  return String(found?.outputName || found?.name || raw).trim();
}

function getEmployeeProfileByName(value, employees = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const list = Object.entries(employees || {}).map(([id, emp]) => normalizeEmployee(emp, id));
  return list.find(emp => emp.active && (emp.name === raw || emp.outputName === raw || emp.displayName === raw)) || null;
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
// v5.6.0: 관리자 암호는 최초 1회 사용자가 직접 설정합니다.
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
  const [pageMode, setPageMode] = useState(personal.startPage === 'calendar' ? 'calendar' : 'home');
  const [calendarMode, setCalendarMode] = useState('personal');
  const [shiftSystem, setShiftSystem] = useState(() => { try { return JSON.parse(localStorage.getItem('sp_shift_system')||'null') || {type:'THREE_SHIFT',offsets:{'A반':0,'B반':3,'C반':6,'D반':9}}; } catch { return {type:'THREE_SHIFT',offsets:{'A반':0,'B반':3,'C반':6,'D반':9}}; } });
  const [customHolidays, setCustomHolidays] = useState(() => { try { return JSON.parse(localStorage.getItem('sp_custom_holidays')||'{}'); } catch { return {}; } });
  const [holidayForm, setHolidayForm] = useState({date:'',name:''});
  const [adminOpenSection, setAdminOpenSection] = useState('');
  const [workerCount, setWorkerCount] = useState(4);
  const [names, setNames] = useState(DEFAULT_NAMES[4]);
  const [inputNames, setInputNames] = useState(DEFAULT_NAMES[4]);
  const [shiftOrders, setShiftOrders] = useState(getDefaultShiftOrders(initDivision, 4));
  const [positionLabels, setPositionLabels] = useState(getDefaultPositionLabels(initDivision, 4));
  const [schedule, setSchedule] = useState(() => generateSchedule(DEFAULT_NAMES[4], today.getFullYear(), today.getMonth()+1, initDivision, 4, getDefaultShiftOrders(initDivision, 4), initBand, {}, getDefaultPositionLabels(initDivision, 4)));
  const [syncStatus, setSyncStatus] = useState('Firebase 연결 준비중');
  const [isLoaded, setIsLoaded] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [dirtyStatus, setDirtyStatus] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(() => localStorage.getItem('sp_last_saved_at') || '');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [editMode, setEditMode] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const undoTimerRef = useRef(null);
  const [profileRemoteData, setProfileRemoteData] = useState(null);
  const [manualOverrides, setManualOverrides] = useState({});
  const [profileManualOverrides, setProfileManualOverrides] = useState({});
  const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const [manualForm, setManualForm] = useState({
    date: todayIso,
    band: initBand,
    division: initDivision,
    workerCount: 4,
    mode: 'basis',
    names: ['', '', '', ''],
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('personal');
  const [personalBand, setPersonalBand] = useState(initBand);
  const [personalDivision, setPersonalDivision] = useState(initDivision);
  const [personalName, setPersonalName] = useState(personal.name || '');
  const [personalStartPage, setPersonalStartPage] = useState(personal.startPage === 'calendar' ? 'calendar' : 'home');
  const [personalMemos, setPersonalMemos] = useState(() => { try { return JSON.parse(localStorage.getItem('sp_personal_calendar_memos') || '{}'); } catch { return {}; } });
  const [memoDate, setMemoDate] = useState('');
  const [memoDraft, setMemoDraft] = useState('');

  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [adminNewCode, setAdminNewCode] = useState('');
  const [adminNewCodeConfirm, setAdminNewCodeConfirm] = useState('');
  const [adminChangeCode, setAdminChangeCode] = useState({ current:'', next:'', confirm:'' });
  const [adminAuth, setAdminAuth] = useState(null);
  const [adminAuthLoaded, setAdminAuthLoaded] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [employees, setEmployees] = useState({});
  const [employeeForm, setEmployeeForm] = useState({ name:'', band:'A반', outputName:'' });
  const [globalNotice, setGlobalNotice] = useState({ text:'', enabled:false, urgent:false });
  const [noticeForm, setNoticeForm] = useState({ text:'', enabled:false, urgent:false });
  const [patrolSettings, setPatrolSettings] = useState({});
  const [patrolForm, setPatrolForm] = useState({ band:initBand, division:initDivision, weekdayA:'기록', holidayA:'입초', night:['기록'] });
  const [adminBandOpen, setAdminBandOpen] = useState('');
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
  const composingPosRef = useRef(false);
  const [draggingPosIndex, setDraggingPosIndex] = useState(null);
  const draggingOrderRef = useRef(null);
  const [draggingOrder, setDraggingOrder] = useState(null);

  const applyingRemoteRef = useRef(false);
  const lastRemoteCoreRef = useRef('');
  const saveTimerRef = useRef(null);

  const positions = POSITIONS_BY_DIV_COUNT[division][workerCount];
  const displayPositionLabels = normalizePositionLabels(positionLabels, division, workerCount);
  const isABDOnePlant = division === '1발전' && ['A반','B반','D반'].includes(band);
  const isCOnePlant = division === '1발전' && band === 'C반';
  const visiblePositionLabels = workerCount === 4
    ? (isABDOnePlant ? ['입초', '소내', '검색', '기록'] : (isCOnePlant ? ['입초', '기록', '검색', '소내'] : displayPositionLabels))
    : displayPositionLabels;
  const yearOptions = Array.from({ length: 15 }, (_, i) => 2026 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const todayDay = today.getFullYear() === selectedYear && today.getMonth()+1 === selectedMonth ? today.getDate() : null;

  const employeeList = sortEmployees(Object.entries(employees || {}).map(([id, raw]) => normalizeEmployee(raw, id)));
  const activeEmployeeList = employeeList.filter(emp => emp.active && emp.name);

  const getEmployeeDisplayName = (emp) => String(emp.outputName || emp.name || '').trim();
  const cleanLabel = (value) => String(value || '').replace(/\(.*\)/, '').trim();
  const isWeekendOrHoliday = (day) => day.dow === '토' || day.dow === '일' || day.holiday;
  const patrolSettingKey = (b, d) => `${b}-${d}`;
  // v5.5.5: 순찰자는 코드 하드코딩을 전부 제거하고 관리자설정 저장값만 표에 반영합니다.
  // 아래 기본값은 '관리자설정 입력 폼'의 초기값으로만 사용되며, 저장 전에는 표에 순찰 표시가 나오지 않습니다.
  const getDefaultPatrolSetting = () => ({ weekdayA:'기록', holidayA:'입초', night:['기록'] });
  const normalizeSavedPatrolSetting = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const night = Array.isArray(raw.night) ? raw.night.map(cleanLabel).filter(Boolean) : [];
    return {
      weekdayA: cleanLabel(raw.weekdayA),
      holidayA: cleanLabel(raw.holidayA),
      night,
    };
  };
  const currentAdvanced = advancedSettings[band] || defaultAdvancedSettings[band] || { positionOrderEnabled:true, shiftOrderEnabled:false };
    const getPatrolSettingFor = (b, d) => normalizeSavedPatrolSetting(patrolSettings[patrolSettingKey(b, d)]);
  const getPatrolFormSettingFor = (b, d) => getPatrolSettingFor(b, d) || getDefaultPatrolSetting();
  const patrolPositionOptions = normalizePositionLabels(getDefaultPositionLabels(patrolForm.division, workerCount), patrolForm.division, workerCount).map(cleanLabel);


  useEffect(()=>{ setActiveShiftSystem(shiftSystem); localStorage.setItem('sp_shift_system',JSON.stringify(shiftSystem)); setSchedule(generateSchedule(names,selectedYear,selectedMonth,division,workerCount,shiftOrders,band,manualOverrides,positionLabels)); },[shiftSystem]);
  useEffect(()=>{ setCustomHolidayMap(customHolidays); localStorage.setItem('sp_custom_holidays',JSON.stringify(customHolidays)); setSchedule(generateSchedule(names,selectedYear,selectedMonth,division,workerCount,shiftOrders,band,manualOverrides,positionLabels)); },[customHolidays]);
  useEffect(()=>{ let a,b,c=false; const attach=()=>{ if(c)return; if(!window.firebaseDB){setTimeout(attach,250);return;} a=window.firebaseDB.listen('settings/shiftSystem',d=>{if(d?.type)setShiftSystem(d)}); b=window.firebaseDB.listen('settings/customHolidays',d=>{if(d&&typeof d==='object')setCustomHolidays(d)});}; attach(); return()=>{c=true;if(typeof a==='function')a();if(typeof b==='function')b();};},[]);

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      unsubscribe = window.firebaseDB.listen('settings/adminAuth', data => {
        if (cancelled) return;
        setAdminAuth(data && typeof data === 'object' ? data : null);
        setAdminAuthLoaded(true);
      });
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
      unsubscribe = window.firebaseDB.listen('employees', async data => {
        if (cancelled) return;
        let next = data || {};
        // v5.2.4: 예전 기기에 localStorage 직원DB가 남아있는 경우 Firebase로 1회 이전합니다.
        if (!Object.keys(next).length) {
          try {
            const legacyKeys = ['sp_employees','employees','employeeDB','staffDB','sp_employee_db'];
            for (const key of legacyKeys) {
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
                next = parsed;
                await window.firebaseDB.save('employees', next);
                break;
              }
            }
          } catch (e) { console.warn('legacy employee migration skipped', e); }
        }
        setEmployees(next || {});
      });
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
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      unsubscribe = window.firebaseDB.listen('settings/patrolSettings', data => {
        if (cancelled) return;
        setPatrolSettings(data || {});
      });
    };
    attach();
    return () => { cancelled = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  useEffect(() => {
    const next = getPatrolFormSettingFor(patrolForm.band, patrolForm.division);
    setPatrolForm(f => {
      if (f.weekdayA === next.weekdayA && f.holidayA === next.holidayA && JSON.stringify(f.night) === JSON.stringify(next.night)) return f;
      return { ...f, ...next };
    });
  }, [patrolForm.band, patrolForm.division, patrolSettings]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const personalProfile = getEmployeeProfileByName(personalName, employees);
  const profileBand = personalProfile?.band || personalBand;
  const profileDivision = personalDivision;
  const profileDisplayName = getDisplayNameFromValue(personalName, employees);
  const hasPersonalProfile = Boolean(personalName && profileBand && profileDivision);

  useEffect(() => {
    if (!hasPersonalProfile) { setProfileRemoteData(null); return; }
    let unsubscribe = null;
    let cancelled = false;
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      unsubscribe = window.firebaseDB.listen(getMonthlySchedulePath(ty, tm, profileBand, profileDivision), async (data) => {
        if (cancelled) return;
        let sourceData = data;
        if (!sourceData && window.firebaseDB?.read) {
          try { sourceData = await window.firebaseDB.read(getLegacySchedulePath(profileBand, profileDivision)); } catch {}
        }
        const normalized = sourceData
          ? normalizeRemoteData(sourceData, profileBand, profileDivision)
          : { band: profileBand, division: profileDivision, workerCount:4, names:DEFAULT_NAMES[4], shiftOrders:getDefaultShiftOrders(profileDivision,4), positionLabels:getDefaultPositionLabels(profileDivision,4) };
        setProfileRemoteData(normalized);
      });
    };
    attach();
    return () => { cancelled = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [hasPersonalProfile, profileBand, profileDivision]);

  useEffect(() => {
    if (!hasPersonalProfile) { setProfileManualOverrides({}); return; }
    let unsubscribe = null;
    let cancelled = false;
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      unsubscribe = window.firebaseDB.listen(getManualOverridePath(ty, tm, profileBand, profileDivision), data => {
        if (cancelled) return;
        setProfileManualOverrides(normalizeManualOverrides(data || {}));
      });
    };
    attach();
    return () => { cancelled = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [hasPersonalProfile, profileBand, profileDivision]);

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (!window.firebaseDB) { setTimeout(attach, 200); return; }
      unsubscribe = window.firebaseDB.listen(getManualOverridePath(selectedYear, selectedMonth, band, division), data => {
        if (cancelled) return;
        setManualOverrides(normalizeManualOverrides(data || {}));
      });
    };
    attach();
    return () => { cancelled = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [selectedYear, selectedMonth, band, division]);

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
        setSchedule(generateSchedule(normalized.names, selectedYear, selectedMonth, division, normalized.workerCount, normalized.shiftOrders, band, manualOverrides, normalized.positionLabels));
        setIsLoaded(true);
        setTimeout(() => { applyingRemoteRef.current = false; }, 80);
      });
    };
    attach();
    return () => { cancelled = true; setIsLoaded(false); if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [band, division, selectedYear, selectedMonth]);

  useEffect(() => {
    setSchedule(generateSchedule(names, selectedYear, selectedMonth, division, workerCount, shiftOrders, band, manualOverrides, positionLabels));
  }, [names, selectedYear, selectedMonth, division, workerCount, shiftOrders, band, manualOverrides, positionLabels]);

  const makeCurrentCore = useCallback(() => makeSavableCore({ band, division, workerCount, names, shiftOrders, positionLabels }), [band, division, workerCount, names, shiftOrders, positionLabels]);

  const pushBackup = useCallback((core) => {
    try {
      const key = 'sp_backups';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      const item = { at: new Date().toISOString(), year:selectedYear, month:selectedMonth, core };
      localStorage.setItem(key, JSON.stringify([item, ...list].slice(0, 5)));
    } catch (err) { console.warn('백업 저장 실패', err); }
  }, [selectedYear, selectedMonth]);

  const showUndo = useCallback((snapshot) => {
    setUndoSnapshot(snapshot);
    setUndoVisible(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoVisible(false), 5000);
  }, []);

  const restoreCore = useCallback((snapshot) => {
    if (!snapshot) return;
    applyingRemoteRef.current = true;
    setBand(snapshot.band);
    setDivision(snapshot.division);
    setWorkerCount(snapshot.workerCount);
    setNames(snapshot.names);
    setInputNames(snapshot.names);
    setShiftOrders(snapshot.shiftOrders);
    setPositionLabels(snapshot.positionLabels);
    setSchedule(generateSchedule(snapshot.names, selectedYear, selectedMonth, snapshot.division, snapshot.workerCount, snapshot.shiftOrders, snapshot.band, manualOverrides, snapshot.positionLabels));
    setTimeout(() => { applyingRemoteRef.current = false; }, 80);
    saveSetting({ ...snapshot, year:selectedYear, month:selectedMonth })?.then(() => {
      const t = formatSavedTime();
      setLastSavedAt(t);
      localStorage.setItem('sp_last_saved_at', t);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1200);
    });
    setUndoVisible(false);
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    if (!isLoaded || applyingRemoteRef.current) return;
    const core = makeSavableCore({ band, division, workerCount, names, shiftOrders, positionLabels });
    const coreJson = JSON.stringify(core);
    if (coreJson === lastRemoteCoreRef.current) return;
    if (!isValidSetting(core)) return;
    setDirtyStatus(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const beforeSaveSnapshot = makeCurrentCore();
    saveTimerRef.current = setTimeout(() => {
      setSyncStatus('저장중...');
      pushBackup(beforeSaveSnapshot);
      saveSetting({ ...core, year:selectedYear, month:selectedMonth })?.then(() => {
        lastRemoteCoreRef.current = coreJson;
        const t = formatSavedTime();
        setLastSavedAt(t);
        localStorage.setItem('sp_last_saved_at', t);
        setDirtyStatus(false);
        showUndo(beforeSaveSnapshot);
        setSyncStatus('저장 완료');
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 1100);
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
    localStorage.setItem('sp_personal_settings', JSON.stringify({ band: personalBand, division: personalDivision, name: personalName, startPage: personalStartPage }));
    setBand(personalBand);
    setDivision(personalDivision);
    setSettingsOpen(false);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  };

  const openPersonalMemo = (day) => {
    const key = dateKey(selectedYear, selectedMonth, day);
    setMemoDate(key);
    setMemoDraft(String(personalMemos[key] || ''));
  };

  const savePersonalMemo = () => {
    const next = { ...personalMemos };
    const value = String(memoDraft || '').trim();
    if (value) next[memoDate] = value;
    else delete next[memoDate];
    setPersonalMemos(next);
    localStorage.setItem('sp_personal_calendar_memos', JSON.stringify(next));
    setMemoDate('');
    setMemoDraft('');
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1200);
  };

  const cleanAdminCode = (value) => String(value || '').replace(/[^0-9]/g, '').slice(0, 6);
  const isValidAdminCode = (value) => /^\d{4,6}$/.test(String(value || ''));

  const handleAdminLogin = () => {
    const code = cleanAdminCode(adminCodeInput);
    if (!adminAuthLoaded) { alert('관리자 암호 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.'); return; }
    if (!adminAuth?.password) { alert('먼저 관리자 암호를 설정해주세요.'); return; }
    if (code === String(adminAuth.password)) { setIsAdminMode(true); setAdminCodeInput(''); }
    else alert('관리자 암호가 맞지 않아요.');
  };

  const handleAdminPasswordSetup = async () => {
    const next = cleanAdminCode(adminNewCode);
    const confirm = cleanAdminCode(adminNewCodeConfirm);
    if (!isValidAdminCode(next)) { alert('관리자 암호는 숫자 4~6자리로 설정해주세요.'); return; }
    if (next !== confirm) { alert('확인 암호가 일치하지 않아요.'); return; }
    if (!window.firebaseDB?.save) { alert('Firebase 연결 후 다시 시도해주세요.'); return; }
    const payload = { password: next, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await window.firebaseDB.save('settings/adminAuth', payload);
    setAdminAuth(payload);
    setAdminNewCode('');
    setAdminNewCodeConfirm('');
    setIsAdminMode(true);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1200);
  };

  const handleAdminPasswordChange = async () => {
    const current = cleanAdminCode(adminChangeCode.current);
    const next = cleanAdminCode(adminChangeCode.next);
    const confirm = cleanAdminCode(adminChangeCode.confirm);
    if (!adminAuth?.password) { alert('먼저 관리자 암호를 설정해주세요.'); return; }
    if (current !== String(adminAuth.password)) { alert('현재 암호가 맞지 않아요.'); return; }
    if (!isValidAdminCode(next)) { alert('새 암호는 숫자 4~6자리로 설정해주세요.'); return; }
    if (next !== confirm) { alert('새 암호 확인이 일치하지 않아요.'); return; }
    const payload = { ...(adminAuth || {}), password: next, updatedAt: new Date().toISOString() };
    await window.firebaseDB?.save('settings/adminAuth', payload);
    setAdminAuth(payload);
    setAdminChangeCode({ current:'', next:'', confirm:'' });
    alert('관리자 암호가 변경되었습니다.');
  };

  const handleEmployeeAdd = async () => {
    const name = String(employeeForm.name || '').trim();
    const outputName = String(employeeForm.outputName || employeeForm.name || '').trim();
    const empBand = employeeForm.band || 'A반';
    if (!name) { alert('실명을 입력해주세요.'); return; }
    if (!window.firebaseDB?.save) { alert('Firebase 연결 후 다시 시도해주세요.'); return; }

    const id = makeEmployeeId(employees);
    const now = new Date().toISOString();
    const newEmployee = { id, name, outputName, band:empBand, active:true, createdAt:now, updatedAt:now };
    const nextEmployees = { ...(employees || {}), [id]: newEmployee };

    // 즉시 화면에 반영하고, 전체 employees 객체도 함께 저장해서 부모 리스너가 확실히 갱신되게 합니다.
    setEmployees(nextEmployees);
    try {
      await window.firebaseDB.save('employees', nextEmployees);
      setEmployeeForm({ name:'', band:empBand, outputName:'' });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1200);
    } catch (err) {
      console.error('직원 추가 실패:', err);
      alert('직원 추가 저장에 실패했어요. Firebase 연결을 확인해주세요.');
    }
  };

  const deleteEmployee = async (id) => {
    if (!confirm('이 직원을 삭제할까요?')) return;
    const nextEmployees = { ...(employees || {}) };
    nextEmployees[id] = { ...(nextEmployees[id] || {}), id, active:false, updatedAt:new Date().toISOString() };
    setEmployees(nextEmployees);
    await window.firebaseDB?.save('employees', nextEmployees);
  };

  const clearBandEmployees = async (targetBand) => {
    if (!confirm(`${targetBand} 직원DB를 전체 삭제할까요?`)) return;
    const nextEmployees = { ...(employees || {}) };
    employeeList.filter(emp => emp.band === targetBand && emp.active).forEach(emp => {
      nextEmployees[emp.id] = { ...(nextEmployees[emp.id] || {}), id:emp.id, active:false, updatedAt:new Date().toISOString() };
    });
    setEmployees(nextEmployees);
    await window.firebaseDB?.save('employees', nextEmployees);
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

  const getManualFormOptions = (targetBand = manualForm.band) => {
    const list = activeEmployeeList
      .filter(emp => emp.band === targetBand)
      .map(emp => ({ ...emp, displayName:getEmployeeDisplayName(emp) }))
      .filter(emp => emp.displayName);
    return list;
  };

  const setManualNameAt = (idx, value) => {
    setManualForm(prev => {
      const count = Number(prev.workerCount || 4);
      const nextNames = (prev.names || []).slice(0, count);
      while (nextNames.length < count) nextNames.push('');
      nextNames[idx] = value;
      return { ...prev, names: nextNames };
    });
  };

  const fillManualFromCurrentSchedule = async () => {
    const [y, m, d] = String(manualForm.date || '').split('-').map(Number);
    if (!y || !m || !d) { alert('날짜를 먼저 선택해주세요.'); return; }
    let sourceData = null;
    try {
      if (window.firebaseDB?.read) {
        sourceData = await window.firebaseDB.read(getMonthlySchedulePath(y, m, manualForm.band, manualForm.division));
        if (!sourceData) sourceData = await window.firebaseDB.read(getLegacySchedulePath(manualForm.band, manualForm.division));
      }
    } catch (err) { console.warn('수동수정 기준 데이터 불러오기 실패', err); }
    const normalized = sourceData
      ? normalizeRemoteData(sourceData, manualForm.band, manualForm.division)
      : (manualForm.band === band && manualForm.division === division
          ? { band, division, workerCount, names, shiftOrders, positionLabels }
          : { band: manualForm.band, division: manualForm.division, workerCount:4, names:DEFAULT_NAMES[4], shiftOrders:getDefaultShiftOrders(manualForm.division,4), positionLabels:getDefaultPositionLabels(manualForm.division,4) });
    let existingOverrides = {};
    try {
      if (window.firebaseDB?.read) existingOverrides = await window.firebaseDB.read(getManualOverridePath(y, m, manualForm.band, manualForm.division)) || {};
    } catch {}
    const sc = generateSchedule(normalized.names, y, m, manualForm.division, normalized.workerCount, normalized.shiftOrders, manualForm.band, existingOverrides, normalized.positionLabels);
    const row = sc.find(item => item.day === d);
    const labels = normalizePositionLabels(normalized.positionLabels, manualForm.division, normalized.workerCount);
    const posKeys = POSITIONS_BY_DIV_COUNT[manualForm.division][normalized.workerCount];
    const nextNames = labels.map((label, idx) => {
      const key = posKeys.find(p => cleanLabel(p) === cleanLabel(label)) || posKeys[idx];
      return row?.assignment?.[key] || '';
    });
    setManualForm(prev => ({ ...prev, workerCount: normalized.workerCount, names: nextNames }));
  };

  const saveManualOverride = async () => {
    const [y, m, d] = String(manualForm.date || '').split('-').map(Number);
    if (!y || !m || !d) { alert('날짜를 선택해주세요.'); return; }
    const count = Number(manualForm.workerCount || 4);
    const trimmed = (manualForm.names || []).slice(0, count).map(v => String(v || '').trim());
    if (trimmed.length !== count || trimmed.some(v => !v)) { alert('근무자를 모두 선택해주세요.'); return; }
    if (new Set(trimmed).size !== trimmed.length) { alert('중복된 근무자가 있어요.'); return; }
    const path = getManualOverridePath(y, m, manualForm.band, manualForm.division);
    let current = {};
    try { if (window.firebaseDB?.read) current = await window.firebaseDB.read(path) || {}; } catch {}
    const payload = {
      ...current,
      [d]: {
        day: d,
        names: trimmed,
        mode: manualForm.mode === 'single' ? 'single' : 'basis',
        workerCount: count,
        updatedAt: new Date().toISOString(),
      }
    };
    await window.firebaseDB?.save(path, payload);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1400);
    alert(manualForm.mode === 'single' ? '이 날짜만 수동 수정했어요.' : '이 날짜부터 새 기준으로 적용했어요.');
  };

  const clearManualOverride = async () => {
    const [y, m, d] = String(manualForm.date || '').split('-').map(Number);
    if (!y || !m || !d) { alert('날짜를 선택해주세요.'); return; }
    if (!confirm(`${manualForm.date} 수동 수정값을 삭제할까요?`)) return;
    const path = getManualOverridePath(y, m, manualForm.band, manualForm.division);
    let current = {};
    try { if (window.firebaseDB?.read) current = await window.firebaseDB.read(path) || {}; } catch {}
    delete current[d];
    await window.firebaseDB?.save(path, current);
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
    const next = inputNames.slice(0, workerCount);
    while (next.length < workerCount) next.push('');
    next[idx] = value;

    // v5.5.6: 근무자 선택값을 inputNames에만 두면 표가 기존 names를 계속 사용해서
    // 저장 전/후 모두 바뀌지 않는 것처럼 보일 수 있습니다.
    // 선택 즉시 names와 표 계산까지 같이 갱신합니다. 저장 버튼은 Firebase 확정 저장용입니다.
    setInputNames(next);
    const valid = next.every(v => String(v || '').trim()) && new Set(next.map(v => String(v || '').trim())).size === workerCount;
    if (valid) {
      const trimmed = next.map(v => String(v || '').trim());
      setNames(trimmed);
      setSchedule(generateSchedule(trimmed, selectedYear, selectedMonth, division, workerCount, shiftOrders, band, manualOverrides, positionLabels));
    }
    setWorkerNamesDirty(true);
    setDirtyStatus(true);
  };

  const saveWorkerNames = async () => {
    const trimmed = inputNames.slice(0, workerCount).map(v => String(v || '').trim());
    if (trimmed.some(v => !v)) { alert('근무자를 모두 선택해주세요.'); return; }
    if (new Set(trimmed).size !== workerCount) { alert('중복된 근무자가 있어요.'); return; }

    // v5.5.4 핵심 수정
    // 근무자 선택 저장 시 화면 상태만 바꾸고 자동저장에 맡기면
    // Firebase 리스너/기존 원격값이 다시 덮어써서 "바뀌지 않는" 문제가 생길 수 있습니다.
    // 그래서 저장 버튼을 누르는 순간 월/반/발전 경로에 즉시 저장하고,
    // 표도 새 명단 기준으로 즉시 다시 계산합니다.
    const nextShiftOrders = normalizeShiftOrders(shiftOrders, division, workerCount);
    const nextCore = makeSavableCore({
      band,
      division,
      workerCount,
      names: trimmed,
      shiftOrders: nextShiftOrders,
      positionLabels,
    });

    applyingRemoteRef.current = true;
    setInputNames(trimmed);
    setNames(trimmed);
    setShiftOrders(nextShiftOrders);
    setSchedule(generateSchedule(trimmed, selectedYear, selectedMonth, division, workerCount, nextShiftOrders, band, manualOverrides, positionLabels));
    setWorkerNamesDirty(false);
    setDirtyStatus(false);
    setSyncStatus('근무자 명단 저장중...');

    try {
      pushBackup(makeCurrentCore());
      // v5.5.7: 해당 월/반/발전의 오래된 수동 수정값이 있으면 A반 1발전처럼 표가 고정될 수 있어 저장 시 함께 비웁니다.
      try {
        if (window.firebaseDB?.save) {
          await window.firebaseDB.save(getManualOverridePath(selectedYear, selectedMonth, band, division), {});
          setManualOverrides({});
        }
      } catch (e) { console.warn('manual override clear skipped', e); }
      await saveSetting({ ...nextCore, year: selectedYear, month: selectedMonth });
      lastRemoteCoreRef.current = JSON.stringify(nextCore);
      const t = formatSavedTime();
      setLastSavedAt(t);
      localStorage.setItem('sp_last_saved_at', t);
      setSyncStatus('근무자 명단 저장 완료');
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1400);
      setTimeout(() => setSyncStatus('실시간 연결됨'), 1000);
    } catch (err) {
      console.error('근무자 명단 저장 실패', err);
      setDirtyStatus(true);
      setSyncStatus('근무자 명단 저장 실패');
      alert('근무자 명단 저장에 실패했어요. 인터넷 연결을 확인해주세요.');
    } finally {
      setTimeout(() => { applyingRemoteRef.current = false; }, 120);
    }
  };

  const moveWorkerSlot = (idx, dir) => {
    if (!editMode) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= workerCount) return;
    const arr = inputNames.slice(0, workerCount);
    while (arr.length < workerCount) arr.push('');
    [arr[idx], arr[nextIdx]] = [arr[nextIdx], arr[idx]];

    // v5.5.6: 위/아래 이동도 즉시 names와 표에 반영합니다.
    setInputNames(arr);
    const valid = arr.every(v => String(v || '').trim()) && new Set(arr.map(v => String(v || '').trim())).size === workerCount;
    if (valid) {
      const trimmed = arr.map(v => String(v || '').trim());
      setNames(trimmed);
      setSchedule(generateSchedule(trimmed, selectedYear, selectedMonth, division, workerCount, shiftOrders, band, manualOverrides, positionLabels));
    }
    setWorkerNamesDirty(true);
    setDirtyStatus(true);
  };

  const movePositionSlot = (idx, dir) => {
    if (!positionEditMode) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= workerCount) return;
    const arr = [...displayPositionLabels];
    [arr[idx], arr[nextIdx]] = [arr[nextIdx], arr[idx]];
    setPositionLabels(arr);
    setDirtyStatus(true);
  };

  const applyPositionPreset = (type) => {
    if (!editMode) return;
    setPositionLabels(getPositionPreset(type, workerCount));
    setPositionEditMode(true);
    setDirtyStatus(true);
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


  const rotateSavedWorkerOrder = () => {
    setShiftOrders(prev => {
      const current = normalizeShiftOrders(prev, division, workerCount);
      const nextCycle = rotateOrderRight(getCycleOrder(current, workerCount), workerCount);
      setDirtyStatus(true);
      return { ...current, CYCLE: nextCycle, N: nextCycle, A: nextCycle, D: nextCycle };
    });
  };

  const rotateShiftOrder = (shift) => {
    setShiftOrders(prev => {
      const current = normalizeShiftOrders(prev, division, workerCount);
      setDirtyStatus(true);
      return { ...current, [shift]: rotateOrderRight(current[shift], workerCount) };
    });
  };

  const getPositionKeyByLabel = (label) => positions.find(p => cleanLabel(p) === cleanLabel(label)) || positions[displayPositionLabels.indexOf(label)] || positions[0];

  const getPatrolInfo = useCallback((day, label) => {
    if (!day.assignment || day.shift === '휴') return null;
    const l = cleanLabel(label);
    const setting = getPatrolSettingFor(band, division);
    if (!setting) return null;
    if (day.shift === 'A') {
      const target = isWeekendOrHoliday(day) ? setting.holidayA : setting.weekdayA;
      return l === cleanLabel(target) ? { mark:'🚔' } : null;
    }
    if (day.shift === 'N') {
      return setting.night.map(cleanLabel).includes(l) ? { mark:'🚔' } : null;
    }
    return null;
  }, [band, division, patrolSettings, positionLabels, workerCount]);

  const savePatrolSettings = async () => {
    const key = patrolSettingKey(patrolForm.band, patrolForm.division);
    const payload = {
      ...patrolSettings,
      [key]: {
        weekdayA: cleanLabel(patrolForm.weekdayA),
        holidayA: cleanLabel(patrolForm.holidayA),
        night: (patrolForm.night || []).map(cleanLabel).filter(Boolean),
        updatedAt: new Date().toISOString(),
      }
    };
    setPatrolSettings(payload);
    try {
      await window.firebaseDB?.save('settings/patrolSettings', payload);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1200);
    } catch (err) {
      console.error('순찰설정 저장 실패:', err);
      alert('순찰설정 저장에 실패했어요. Firebase 연결을 확인해주세요.');
    }
  };

  const toggleNightPatrolTarget = (target) => {
    const clean = cleanLabel(target);
    setPatrolForm(f => {
      const current = (f.night || []).map(cleanLabel);
      const exists = current.includes(clean);
      const next = exists ? current.filter(v => v !== clean) : [...current, clean];
      return { ...f, night: next.length ? next : [clean] };
    });
  };


  const movePositionToIndex = (from, to) => {
    if (!positionEditMode) return;
    setPositionLabels(prev => {
      const arr = normalizePositionLabels(prev, division, workerCount);
      const safeTo = Math.max(0, Math.min(arr.length - 1, to));
      if (from === safeTo) return arr;
      const [picked] = arr.splice(from, 1);
      arr.splice(safeTo, 0, picked);
      setDirtyStatus(true);
      return [...arr];
    });
  };

  const setPositionLabelAt = (idx, value) => {
    setPositionLabels(prev => {
      const arr = normalizePositionLabels(prev, division, workerCount);
      arr[idx] = String(value ?? '');
      setDirtyStatus(true);
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
      const baseOrder = shift === 'CYCLE'
        ? getCycleOrder(current, workerCount)
        : (current[shift] || getIdentityShiftOrders(workerCount)[shift]);
      const arr = [...baseOrder];
      const safeTo = Math.max(0, Math.min(arr.length - 1, to));
      if (from === safeTo) return current;
      const [picked] = arr.splice(from, 1);
      arr.splice(safeTo, 0, picked);
      if (shift === 'CYCLE') {
        // 근무자 순서를 직접 드래그 수정하면 이후 회전 기준도 이 순서로 고정
        setDirtyStatus(true);
        return { ...current, CYCLE: arr, N: arr, A: arr, D: arr };
      }
      setDirtyStatus(true);
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

  const todayWorkInfo = (() => {
    if (!hasPersonalProfile || !profileRemoteData) return null;
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const td = today.getDate();
    const sc = generateSchedule(profileRemoteData.names, ty, tm, profileDivision, profileRemoteData.workerCount, profileRemoteData.shiftOrders, profileBand, profileManualOverrides, profileRemoteData.positionLabels);
    const row = sc.find(d => d.day === td);
    if (!row || row.shift === '휴') return { name: profileDisplayName || personalName, band: profileBand, division: profileDivision, shift: '휴', position: '휴무', status: '휴무', note: '오늘은 휴무입니다.' };
    const targetName = profileDisplayName || personalName;
    let foundLabel = '';
    const labels = normalizePositionLabels(profileRemoteData.positionLabels, profileDivision, profileRemoteData.workerCount);
    for (const label of labels) {
      const key = POSITIONS_BY_DIV_COUNT[profileDivision][profileRemoteData.workerCount].find(p => cleanLabel(p) === cleanLabel(label)) || label;
      if (row.assignment?.[key] === targetName) { foundLabel = cleanLabel(label); break; }
    }
    return { name: targetName, band: profileBand, division: profileDivision, shift: row.shift, position: foundLabel || '미배정', status: foundLabel ? '확인됨' : '미배정', note: foundLabel ? '' : '배치표를 생성하거나 근무자명을 확인해주세요.' };
  })();

  const selectStyle = { padding:'8px 12px', background:'#0f172a', border:'1.5px solid #334155', borderRadius:8, color:'#f1f5f9', fontSize:16, fontWeight:800, outline:'none' };
  const buttonBase = { border:'none', borderRadius:8, color:'#fff', fontWeight:900, cursor:'pointer' };
  const gridCols = `82px 42px ${visiblePositionLabels.map(() => '1fr').join(' ')}`;

  const changeMonth=(delta)=>{const d=new Date(selectedYear,selectedMonth-1+delta,1);setSelectedYear(d.getFullYear());setSelectedMonth(d.getMonth()+1);};
  const shiftSystemLabel=shiftSystem.type==='THREE_SHIFT'?'4조3교대':shiftSystem.type==='TWO_SHIFT_1'?'4조2교대(1주기)':'4조2교대(2주기)';
  const saveShiftSystem=async()=>{setActiveShiftSystem(shiftSystem);localStorage.setItem('sp_shift_system',JSON.stringify(shiftSystem));await window.firebaseDB?.save('settings/shiftSystem',shiftSystem);setSavedToast(true);setTimeout(()=>setSavedToast(false),1200);};
  const moveBandCycle=(b,delta)=>{const len=(SHIFT_SYSTEM_PATTERNS[shiftSystem.type]||SHIFT_SYSTEM_PATTERNS.THREE_SHIFT).length;setShiftSystem(v=>({...v,offsets:{...v.offsets,[b]:(((Number(v.offsets?.[b]||0)+delta)%len)+len)%len}}));};
  const addCustomHoliday=async()=>{if(!holidayForm.date||!holidayForm.name.trim()){alert('날짜와 공휴일명을 입력해주세요.');return;}const next={...customHolidays,[holidayForm.date]:holidayForm.name.trim()};setCustomHolidays(next);setHolidayForm({date:'',name:''});await window.firebaseDB?.save('settings/customHolidays',next);};
  const removeCustomHoliday=async(key)=>{const next={...customHolidays};delete next[key];setCustomHolidays(next);await window.firebaseDB?.save('settings/customHolidays',next);};
  const formatShiftShort=(shift)=>shift;
  const calendarBand=personalBand||band;
  const calendarDays=Array.from({length:getDaysInMonth(selectedYear,selectedMonth)},(_,i)=>i+1);

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)', fontFamily:"'Segoe UI','Apple SD Gothic Neo',sans-serif", color:'#e2e8f0', padding:'10px 8px' }}>
      <div style={{ maxWidth:430, margin:'0 auto', width:'100%', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <img src="./icon-192.png" style={{ width:42, height:42, borderRadius:11 }} />
            <div>
              <div style={{ fontSize:24, fontWeight:950, letterSpacing:'-0.5px' }}>Seul Police</div>
              <div style={{ fontSize:12, color:'#94a3b8', fontWeight:700 }}>{band} {division} 근무자 배치 자동화</div>
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} style={{ ...buttonBase, width:42, height:42, background:'#111827', border:'1px solid #334155', fontSize:20 }}>⚙️</button>
        </div>

        <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', marginBottom:10 }}>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:11, fontWeight:900, color:isOnline?'#86efac':'#fca5a5', background:isOnline?'#052e16':'#450a0a', border:`1px solid ${isOnline?'#14532d':'#7f1d1d'}`, borderRadius:999, padding:'5px 8px' }}>{isOnline ? '🟢 온라인' : '🔴 오프라인'}</span>
            {dirtyStatus && <span style={{ fontSize:11, fontWeight:950, color:'#fbbf24', background:'rgba(251,191,36,.12)', border:'1px solid rgba(251,191,36,.35)', borderRadius:999, padding:'5px 8px' }}>● 변경됨</span>}
            {lastSavedAt && <span style={{ fontSize:11, fontWeight:850, color:'#94a3b8', background:'#0f172a', border:'1px solid #334155', borderRadius:999, padding:'5px 8px' }}>마지막 저장 {lastSavedAt}</span>}
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
            <button onClick={()=>setPageMode('home')} style={{ ...buttonBase, background:pageMode==='home'?'#2563eb':'#334155', padding:'7px 10px', fontSize:12 }}>🏠 홈</button>
            <button onClick={()=>setPageMode('calendar')} style={{ ...buttonBase, background:pageMode==='calendar'?'#2563eb':'#334155', padding:'7px 10px', fontSize:12 }}>📅 교대달력</button>
            <button onClick={() => { const now = new Date(); setSelectedYear(now.getFullYear()); setSelectedMonth(now.getMonth()+1); }} style={{ ...buttonBase, background:'#334155', padding:'7px 10px', fontSize:12 }}>오늘</button>
          </div>
        </div>

        {hasPersonalProfile && todayWorkInfo && <div style={{ background:'linear-gradient(135deg,#0f172a,#172554)', border:'1px solid #334155', borderRadius:14, padding:'12px 14px', marginBottom:10, boxShadow:'0 12px 28px rgba(0,0,0,.22)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
            <div style={{ display:'grid', gap:3 }}>
              <div style={{ fontSize:18, fontWeight:950 }}>👮 {todayWorkInfo.name}</div>
              <div style={{ fontSize:12, color:'#93c5fd', fontWeight:900 }}>{todayWorkInfo.band} · {todayWorkInfo.division}</div>
            </div>
            <span style={{ fontSize:11, fontWeight:950, color:todayWorkInfo.status==='확인됨'?'#86efac':'#fbbf24', background:todayWorkInfo.status==='확인됨'?'#052e16':'rgba(251,191,36,.12)', border:`1px solid ${todayWorkInfo.status==='확인됨'?'#14532d':'rgba(251,191,36,.35)'}`, borderRadius:999, padding:'5px 8px' }}>{todayWorkInfo.status}</span>
          </div>
          <div style={{ marginTop:10, display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:'#94a3b8', fontWeight:900 }}>오늘 근무</span>
            <span style={{ fontSize:24, color:'#f8fafc', fontWeight:950 }}>{todayWorkInfo.position}</span>
            <span style={{ fontSize:12, color:'#cbd5e1', fontWeight:900 }}>{todayWorkInfo.shift}근무</span>
          </div>
          {todayWorkInfo.note && <div style={{ marginTop:5, fontSize:11, color:'#94a3b8', fontWeight:800 }}>{todayWorkInfo.note}</div>}
        </div>}

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
          <div style={{ display:'flex', background:'#0f172a', border:'1.5px solid #334155', borderRadius:9, padding:3, gap:2 }}>
            {EMPLOYEE_BANDS.map(b => <button key={b} onClick={() => setBand(b)} style={{ ...buttonBase, padding:'7px 11px', background:band===b?'linear-gradient(135deg,#0ea5e9,#6366f1)':'transparent', color:band===b?'#fff':'#64748b' }}>{b}</button>)}
          </div>
          <div style={{ display:'flex', background:'#0f172a', border:'1.5px solid #334155', borderRadius:9, padding:3, gap:2 }}>
            {['1발전','2발전'].map(d => <button key={d} onClick={() => setDivision(d)} style={{ ...buttonBase, padding:'7px 13px', background:division===d?'linear-gradient(135deg,#f59e0b,#f97316)':'transparent', color:division===d?'#fff':'#64748b' }}>{d}</button>)}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, background:'#0f172a', border:'1px solid #334155', borderRadius:9, padding:3 }}>
            <button onClick={()=>changeMonth(-1)} style={{ ...buttonBase, background:'#1e293b', padding:'7px 9px' }}>‹</button>
            <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} style={{...selectStyle,border:'none'}}>{yearOptions.map(y=><option key={y} value={y}>{y}년</option>)}</select>
            <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} style={{...selectStyle,border:'none'}}>{monthOptions.map(m=><option key={m} value={m}>{m}월</option>)}</select>
            <button onClick={()=>changeMonth(1)} style={{ ...buttonBase, background:'#1e293b', padding:'7px 9px' }}>›</button>
          </div>
          <span style={{ fontSize:12, color:'#94a3b8', fontWeight:800, padding:'8px 10px', background:'#0f172a', border:'1px solid #334155', borderRadius:8 }}>근무자 {workerCount}명</span>
        </div>

        {globalNotice.enabled && globalNotice.text && <div style={{ overflow:'hidden', whiteSpace:'nowrap', background:globalNotice.urgent?'linear-gradient(135deg,#7f1d1d,#991b1b)':'linear-gradient(135deg,#0f172a,#1e293b)', border:globalNotice.urgent?'1px solid #ef4444':'1px solid #334155', color:'#f8fafc', borderRadius:10, padding:'8px 0', marginBottom:10, boxShadow:'0 10px 25px rgba(0,0,0,.2)' }}>
          <div className="notice-marquee" style={{ fontSize:13, fontWeight:900 }}>
            <span style={{ marginRight:40 }}>{globalNotice.urgent ? '🚨 긴급공지' : '📢 공지'} · {globalNotice.text}</span>
          </div>
        </div>}

        {pageMode==='home' && <>
        <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:12, padding:'8px 8px', marginBottom:10, overflow:'hidden' }}>
          <button onClick={() => setWorkSettingOpen(v => !v)} style={{ width:'100%', border:'none', background:'transparent', color:'#f8fafc', fontSize:13, fontWeight:950, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', padding:0 }}>
            <span>근무지설정</span>
            <span style={{ color:'#94a3b8', fontSize:16 }}>{workSettingOpen ? '▾' : '▸'}</span>
          </button>

          {workSettingOpen && <div style={{ marginTop:8, display:'grid', gap:7, width:'100%', overflow:'hidden' }}>
            <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:8, width:'100%', overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:900 }}>근무자 선택</div>
                  <div style={{ fontSize:9, color:'#64748b' }}>{band} 직원 DB만 표시 · 중복 선택 방지</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {workerNamesDirty && <span style={{ fontSize:10, fontWeight:950, color:'#fbbf24', background:'rgba(251,191,36,.12)', border:'1px solid rgba(251,191,36,.35)', borderRadius:999, padding:'4px 7px' }}>변경됨</span>}
                  <button onClick={() => setEditMode(v=>!v)} style={{ ...buttonBase, background:editMode?'#059669':'#1d4ed8', padding:'6px 9px', fontSize:11 }}>{editMode ? '✔ 완료' : '✏️ 편집'}</button>
                </div>
              </div>
              <div style={{ display:'grid', gap:5, width:'100%' }}>
                {inputNames.map((name, idx) => <div key={idx} style={{ display:'grid', gridTemplateColumns:'26px 1fr 26px 26px', alignItems:'center', gap:5 }}>
                  <span style={{ color:'#94a3b8', fontSize:10, fontWeight:900, textAlign:'center' }}>{idx+1}</span>
                  <select value={name} disabled={!editMode} onChange={e=>setWorkerNameAt(idx,e.target.value)} style={{ ...selectStyle, padding:'6px 7px', fontSize:11, width:'100%' }}>
                    <option value="">근무자 {idx+1}</option>
                    {getWorkerOptions(idx).map(emp => <option key={emp.id} value={emp.displayName || emp.name}>{emp.displayName || emp.name}</option>)}
                  </select>
                  <button disabled={!editMode || idx===0} onClick={()=>moveWorkerSlot(idx,-1)} style={{ ...buttonBase, padding:'5px 0', fontSize:11, background:'#1e293b', opacity:editMode && idx>0?1:.35 }}>↑</button>
                  <button disabled={!editMode || idx===workerCount-1} onClick={()=>moveWorkerSlot(idx,1)} style={{ ...buttonBase, padding:'5px 0', fontSize:11, background:'#1e293b', opacity:editMode && idx<workerCount-1?1:.35 }}>↓</button>
                </div>)}
              </div>
              <button disabled={!editMode} onClick={saveWorkerNames} style={{ ...buttonBase, opacity:editMode?1:.45, marginTop:7, width:'100%', background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'7px 8px', fontSize:11 }}>근무자 명단 저장</button>
            </div>

            {currentAdvanced.shiftOrderEnabled && <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'8px 9px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                <div style={{ color:'#f8fafc', fontSize:12, fontWeight:950 }}>근무별순서</div>
                <button disabled={!editMode} onClick={() => setCOrderEditMode(v => !v)} style={{ ...buttonBase, opacity:editMode?1:.45, background:cOrderEditMode?'#059669':'#334155', padding:'4px 6px', fontSize:10 }}>{cOrderEditMode ? '완료' : '수정'}</button>
              </div>
              <div style={{ fontSize:9, color:'#64748b', margin:'5px 0 7px' }}>필요 시 N/A/D별 기준순서를 세부 조정합니다. 기본 배치는 근무지순서 기준으로 계산됩니다.</div>
              <div style={{ display:'grid', gap:6 }}>
                {(() => {
                  const normalizedOrders = normalizeShiftOrders(shiftOrders, division, workerCount);
                  const rows = [
                    ['N','N근무','#60a5fa'],
                    ['A','A근무','#86efac'],
                    ['D','D근무','#fbbf24']
                  ];
                  return rows.map(([sh,label,color]) => {
                    const order = normalizedOrders[sh] || getIdentityShiftOrders(workerCount)[sh];
                    return <div key={sh} style={{ background:'#111827', border:'1px solid #334155', borderRadius:8, padding:6 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom:5 }}>
                        <div style={{ fontSize:10, fontWeight:950, color }}>{label}</div>
                        <button disabled={!cOrderEditMode} onClick={()=>rotateShiftOrder(sh)} style={{ ...buttonBase, background:cOrderEditMode?'#2563eb':'#334155', opacity:cOrderEditMode?1:.45, padding:'4px 6px', fontSize:10 }}>↻ 회전</button>
                      </div>
                      <div onPointerMove={e=>handleShiftOrderMove(e, sh)} onPointerUp={endShiftOrderDrag} onPointerCancel={endShiftOrderDrag} style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:2 }}>
                        {order.map((nameIdx, idx) => <div key={`${sh}-${nameIdx}-${idx}`} data-order-card="true" onPointerDown={e=>startShiftOrderDrag(e, sh, idx)} style={{ minWidth:50, flex:'0 0 auto', textAlign:'center', padding:'5px 7px', borderRadius:999, background:draggingOrder?.shift===sh && draggingOrder?.idx===idx ? '#334155' : '#1e293b', border:cOrderEditMode?'1px solid #f59e0b':'1px solid #475569', cursor:cOrderEditMode?'grab':'default', touchAction:'none', userSelect:'none', fontSize:10, fontWeight:950 }}>
                          <span style={{ marginRight:3, color:cOrderEditMode?'#fbbf24':'#64748b', fontSize:9 }}>{cOrderEditMode?'↔':''}</span>{names[nameIdx] || inputNames[nameIdx] || `근무자${nameIdx+1}`}
                        </div>)}
                      </div>
                    </div>;
                  });
                })()}
              </div>
            </div>}
          </div>}
        </div>

        <div style={{ background:'#1e293b', border:'1px solid #334155', borderRadius:14, overflow:'hidden' }}>
          <div style={{ background:'#0f172a', padding:'11px 14px', borderBottom:'1px solid #334155', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontWeight:900, fontSize:16 }}>{selectedYear}년 {selectedMonth}월 {band} {division}</span>
            <span style={{ fontSize:11, color:'#94a3b8' }}>🚔 순찰자 · 🔴 주말/공휴일</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:gridCols, background:'#0f172a', borderBottom:'1px solid #334155', padding:'0 10px' }}>
            {['일/요일','근무',...visiblePositionLabels].map(h => <div key={h} style={{ padding:'8px 4px', fontSize:11, fontWeight:800, color:'#94a3b8', textAlign:'center' }}>{h}</div>)}
          </div>
          {schedule.map((day, idx) => {
            const isToday = day.day === todayDay;
            const textColor = day.isRed ? '#ef4444' : '#cbd5e1';
            return <div key={day.day} style={{ display:'grid', gridTemplateColumns:gridCols, borderBottom:idx<schedule.length-1?'1px solid #1e293b':'none', background:isToday?'rgba(37,99,235,.16)':idx%2?'#172032':'transparent', padding:'0 10px', outline:isToday?'2px solid #3b82f6':'none', outlineOffset:-1 }}>
              <div style={{ padding:'9px 4px', display:'flex', alignItems:'center', gap:4 }}><span style={{ fontWeight:900, color:textColor }}>{day.day}</span><span style={{ color:textColor }}>({day.dow})</span>{day.holiday && <span style={{ color:'#ef4444', fontSize:10 }}>★</span>}</div>
              <div style={{ padding:'9px 2px', textAlign:'center' }}>{day.shift !== '휴' ? <span style={{ background:SHIFT_COLORS[day.shift].bg, color:'#fff', borderRadius:5, padding:'2px 7px', fontSize:11, fontWeight:900 }}>{day.shift}</span> : <span style={{ fontSize:11, color:'#475569' }}>휴</span>}</div>
              {visiblePositionLabels.map(label => {
                const key = getPositionKeyByLabel(label);
                const patrol = getPatrolInfo(day, label);
                return <div key={label} style={{ padding:'9px 4px', fontSize:12, fontWeight:patrol?950:700, color:day.assignment?(patrol?'#fde047':'#f1f5f9'):'#334155', textAlign:'center', background:patrol?'rgba(250,204,21,.16)':'transparent', borderRadius:6, boxShadow:patrol?'inset 0 0 0 1px rgba(250,204,21,.45)':'none' }}>{day.assignment ? <>{day.assignment[key]}{patrol && <span style={{ marginLeft:3 }}>{patrol.mark}</span>}</> : ''}</div>;
              })}
            </div>;
          })}
        </div>

        </>}
        {pageMode==='calendar' && <div style={{display:'grid',gap:10}}>
          <div style={{display:'flex',gap:6,background:'rgba(15,23,42,.92)',border:'1px solid #334155',borderRadius:14,padding:4,boxShadow:'0 12px 30px rgba(0,0,0,.22)'}}>
            <button onClick={()=>setCalendarMode('personal')} style={{...buttonBase,flex:1,padding:'10px 8px',borderRadius:10,background:calendarMode==='personal'?'linear-gradient(135deg,#2563eb,#4f46e5)':'transparent'}}>{calendarBand} 달력</button>
            <button onClick={()=>setCalendarMode('all')} style={{...buttonBase,flex:1,padding:'10px 8px',borderRadius:10,background:calendarMode==='all'?'linear-gradient(135deg,#2563eb,#4f46e5)':'transparent'}}>전체 교대달력</button>
          </div>
          <div style={{background:'#111827',border:'1px solid #334155',borderRadius:18,overflow:'hidden',boxShadow:'0 18px 42px rgba(0,0,0,.25)'}}>
            <div style={{padding:'13px 14px',background:'linear-gradient(135deg,#0f172a,#172554)',borderBottom:'1px solid #334155',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><strong>{selectedYear}년 {selectedMonth}월 · {shiftSystemLabel}</strong><span style={{fontSize:11,color:'#93c5fd',fontWeight:900}}>{calendarMode==='personal'?calendarBand:'A/B/C/D반'}</span></div>
            {calendarMode==='personal'?<div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))'}}>
              {['일','월','화','수','목','금','토'].map((d,i)=><div key={d} style={{padding:'9px 2px',textAlign:'center',color:i===0?'#f87171':i===6?'#60a5fa':'#94a3b8',fontSize:12,fontWeight:950,borderBottom:'1px solid #334155'}}>{d}</div>)}
              {Array.from({length:new Date(selectedYear,selectedMonth-1,1).getDay()},(_,i)=><div key={'e'+i} style={{minHeight:70,borderBottom:'1px solid #1e293b',borderRight:'1px solid #1e293b',background:'#0b1220'}}/>)}
              {calendarDays.map(day=>{const sh=getShiftForDate(selectedYear,selectedMonth,day,division,calendarBand);const dow=new Date(selectedYear,selectedMonth-1,day).getDay();const red=isKoreanHoliday(selectedYear,selectedMonth,day)||dow===0;const memoKey=dateKey(selectedYear,selectedMonth,day);const hasMemo=Boolean(personalMemos[memoKey]);const badge={N:{bg:'#312e81',fg:'#c7d2fe',bd:'#6366f1'},A:{bg:'#78350f',fg:'#fde68a',bd:'#f59e0b'},D:{bg:'#164e63',fg:'#a5f3fc',bd:'#06b6d4'},'주':{bg:'#064e3b',fg:'#a7f3d0',bd:'#10b981'},'야':{bg:'#1e3a8a',fg:'#bfdbfe',bd:'#3b82f6'},'비':{bg:'#334155',fg:'#e2e8f0',bd:'#64748b'},'휴':{bg:'#4c0519',fg:'#fecdd3',bd:'#f43f5e'}}[formatShiftShort(sh)]||{bg:'#1e293b',fg:'#f8fafc',bd:'#475569'};return <button key={day} onClick={()=>openPersonalMemo(day)} style={{appearance:'none',color:'inherit',textAlign:'left',minWidth:0,minHeight:70,padding:'6px 4px',border:'none',borderBottom:'1px solid #1e293b',borderRight:'1px solid #1e293b',background:day===todayDay?'linear-gradient(180deg,rgba(37,99,235,.28),rgba(37,99,235,.10))':'transparent',position:'relative'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:11,color:red?'#f87171':dow===6?'#60a5fa':'#94a3b8',fontWeight:950}}>{day}</span>{hasMemo&&<span title="메모 있음" style={{width:6,height:6,borderRadius:999,background:'#fbbf24',boxShadow:'0 0 0 2px rgba(251,191,36,.15)'}}/>}</div><div style={{display:'flex',justifyContent:'center',marginTop:7}}><span style={{minWidth:30,textAlign:'center',padding:'5px 7px',borderRadius:999,background:badge.bg,color:badge.fg,border:`1px solid ${badge.bd}`,fontSize:14,fontWeight:950,boxShadow:'0 5px 14px rgba(0,0,0,.22)'}}>{formatShiftShort(sh)}</span></div></button>})}
            </div>:<div style={{width:'100%',overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'52px repeat(4,minmax(0,1fr))',background:'#0f172a',borderBottom:'1px solid #334155'}}>{['날짜',...EMPLOYEE_BANDS].map(h=><div key={h} style={{padding:'9px 1px',textAlign:'center',fontSize:11,fontWeight:950,color:'#cbd5e1'}}>{h}</div>)}</div>
              {calendarDays.map(day=>{const dow=new Date(selectedYear,selectedMonth-1,day).getDay();const red=isKoreanHoliday(selectedYear,selectedMonth,day)||dow===0;return <div key={day} style={{display:'grid',gridTemplateColumns:'52px repeat(4,minmax(0,1fr))',borderBottom:'1px solid #1e293b',background:day===todayDay?'rgba(37,99,235,.16)':day%2?'#172032':'transparent'}}><div style={{padding:'8px 1px',textAlign:'center',fontSize:11,fontWeight:950,color:red?'#f87171':dow===6?'#60a5fa':'#cbd5e1'}}>{day}<span style={{fontSize:9,color:'#64748b'}}>({DOW_KR[dow]})</span></div>{EMPLOYEE_BANDS.map(b=>{const sh=formatShiftShort(getShiftForDate(selectedYear,selectedMonth,day,division,b));const badge={N:{bg:'#312e81',fg:'#c7d2fe',bd:'#6366f1'},A:{bg:'#78350f',fg:'#fde68a',bd:'#f59e0b'},D:{bg:'#164e63',fg:'#a5f3fc',bd:'#06b6d4'},'주':{bg:'#064e3b',fg:'#a7f3d0',bd:'#10b981'},'야':{bg:'#1e3a8a',fg:'#bfdbfe',bd:'#3b82f6'},'비':{bg:'#334155',fg:'#e2e8f0',bd:'#64748b'},'휴':{bg:'#4c0519',fg:'#fecdd3',bd:'#f43f5e'}}[sh]||{bg:'#1e293b',fg:'#f8fafc',bd:'#475569'};return <div key={b} style={{padding:'6px 1px',display:'flex',alignItems:'center',justifyContent:'center',minWidth:0}}><span style={{width:30,textAlign:'center',padding:'4px 0',borderRadius:999,background:badge.bg,color:badge.fg,border:`1px solid ${badge.bd}`,fontSize:12,fontWeight:950}}>{sh}</span></div>})}</div>})}
            </div>}
          </div>
          {calendarMode==='personal'&&<div style={{fontSize:11,color:'#94a3b8',textAlign:'center'}}>날짜를 누르면 개인 메모를 작성할 수 있습니다. 메모는 이 기기에만 저장됩니다.</div>}
        </div>}

        <div style={{ marginTop:8, fontSize:11, color:'#86efac', textAlign:'center', background:'#052e16', border:'1px solid #14532d', borderRadius:8, padding:'7px 12px' }}>💾 Firebase 자동 저장 · {syncStatus}</div>
        {undoVisible && undoSnapshot && <button onClick={()=>restoreCore(undoSnapshot)} style={{ ...buttonBase, marginTop:8, width:'100%', background:'#7c2d12', padding:'8px 10px', fontSize:12 }}>↩ 실행 취소</button>}
        <div style={{ marginTop:22, paddingTop:18, borderTop:'1px solid #334155', textAlign:'center', color:'#94a3b8', fontWeight:800 }}>Made by Hyungdai<br/><span style={{ color:'#f8fafc', fontSize:24, fontWeight:950 }}>SEUL-POLICE</span></div>

        {savedToast && <div style={{ position:'fixed', left:'50%', bottom:22, transform:'translateX(-50%)', zIndex:1200, background:'#052e16', border:'1px solid #16a34a', color:'#dcfce7', borderRadius:999, padding:'9px 14px', fontSize:13, fontWeight:950, boxShadow:'0 10px 30px rgba(0,0,0,.35)' }}>🟢 저장완료</div>}

        {memoDate && <div style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(2,6,23,.82)',display:'flex',alignItems:'center',justifyContent:'center',padding:14}}>
          <div style={{width:'min(400px,100%)',background:'#0f172a',border:'1px solid #334155',borderRadius:18,padding:14,boxShadow:'0 24px 80px rgba(0,0,0,.5)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div><div style={{fontSize:18,fontWeight:950}}>개인 메모</div><div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{memoDate} · 이 기기에만 저장</div></div><button onClick={()=>setMemoDate('')} style={{...buttonBase,width:40,height:40,background:'#334155',fontSize:18}}>×</button></div>
            <textarea autoFocus value={memoDraft} onChange={e=>setMemoDraft(e.target.value)} placeholder="예: 연차, 약속, 교대 요청 등" style={{...selectStyle,width:'100%',minHeight:130,resize:'vertical',boxSizing:'border-box',lineHeight:1.5}}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}><button onClick={()=>{setMemoDraft('');}} style={{...buttonBase,background:'#7f1d1d',padding:10}}>내용 지우기</button><button onClick={savePersonalMemo} style={{...buttonBase,background:'linear-gradient(135deg,#0ea5e9,#2563eb)',padding:10}}>메모 저장</button></div>
          </div>
        </div>}

        {settingsOpen && <div style={{ position:'fixed', inset:0, background:'rgba(2,6,23,.78)', zIndex:999, display:'flex', alignItems:'center', justifyContent:'center', padding:10 }}>
          <div style={{ width:'min(430px,100%)', maxHeight:'86vh', overflow:'auto', background:'#0f172a', border:'1px solid #334155', borderRadius:18, padding:14, boxShadow:'0 20px 80px rgba(0,0,0,.45)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div style={{ fontSize:20, fontWeight:950 }}>설정</div>
              <button onClick={()=>setSettingsOpen(false)} style={{ ...buttonBase, background:'#334155', width:44, height:44, fontSize:20 }}>×</button>
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
              <label style={{ fontSize:12, color:'#94a3b8', fontWeight:900 }}>사이트 접속 시 첫 화면</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <button onClick={()=>setPersonalStartPage('home')} style={{...buttonBase,padding:'10px 8px',background:personalStartPage==='home'?'#2563eb':'#1e293b',border:'1px solid #334155'}}>🏠 홈</button>
                <button onClick={()=>setPersonalStartPage('calendar')} style={{...buttonBase,padding:'10px 8px',background:personalStartPage==='calendar'?'#2563eb':'#1e293b',border:'1px solid #334155'}}>📅 교대달력</button>
              </div>
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
              {!isAdminMode ? <div style={{ display:'grid', gap:10 }}>
                {!adminAuthLoaded ? <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:12, padding:12, color:'#cbd5e1', fontSize:13, fontWeight:900 }}>관리자 암호 정보를 불러오는 중...</div> : !adminAuth?.password ? <div style={{ display:'grid', gap:10, background:'#0f172a', border:'1px solid #334155', borderRadius:14, padding:12 }}>
                  <div style={{ fontSize:16, fontWeight:950, color:'#f8fafc' }}>관리자 암호 최초 설정</div>
                  <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>처음 한 번만 숫자 4~6자리 암호를 설정해주세요. 이후 관리자설정은 이 암호로 들어갑니다.</div>
                  <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="new-password" value={adminNewCode} onChange={e=>setAdminNewCode(cleanAdminCode(e.target.value))} placeholder="새 암호 4~6자리" style={{ ...selectStyle, width:'100%', boxSizing:'border-box', fontSize:16 }} />
                  <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="new-password" value={adminNewCodeConfirm} onChange={e=>setAdminNewCodeConfirm(cleanAdminCode(e.target.value))} onKeyDown={e=>e.key==='Enter'&&handleAdminPasswordSetup()} placeholder="새 암호 확인" style={{ ...selectStyle, width:'100%', boxSizing:'border-box', fontSize:16 }} />
                  <button onClick={handleAdminPasswordSetup} style={{ ...buttonBase, background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'12px 13px', width:'100%' }}>관리자 암호 설정</button>
                </div> : <>
                  <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="current-password" value={adminCodeInput} onChange={e=>setAdminCodeInput(cleanAdminCode(e.target.value))} onKeyDown={e=>e.key==='Enter'&&handleAdminLogin()} placeholder="관리자 암호" style={{ ...selectStyle, width:'100%', boxSizing:'border-box', fontSize:16 }} />
                  <button onClick={handleAdminLogin} style={{ ...buttonBase, background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'12px 13px', width:'100%' }}>관리자설정 열기</button>
                </>}
              </div> : <div style={{ display:'grid', gap:10 }}>
                <div style={{color:'#94a3b8',fontSize:11,fontWeight:850}}>모든 메뉴는 기본적으로 닫혀 있습니다.</div>
                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='shift'?'':'shift')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>🔄 교대제 설정</span><span>{adminOpenSection==='shift'?'▼':'▶'}</span></button>
                  {adminOpenSection==='shift'&&<div style={{padding:12,borderTop:'1px solid #334155',display:'grid',gap:10}}>
                    {[['THREE_SHIFT','4조3교대'],['TWO_SHIFT_1','4조2교대(1주기)'],['TWO_SHIFT_2','4조2교대(2주기)']].map(([value,label])=><label key={value} style={{display:'flex',alignItems:'center',gap:8,background:shiftSystem.type===value?'rgba(37,99,235,.2)':'#0f172a',border:'1px solid #334155',borderRadius:10,padding:10,fontWeight:900}}><input type="radio" name="shiftType" checked={shiftSystem.type===value} onChange={()=>setShiftSystem(v=>({...v,type:value,offsets:{'A반':0,'B반':value==='TWO_SHIFT_1'?1:2,'C반':value==='TWO_SHIFT_1'?2:4,'D반':value==='TWO_SHIFT_1'?3:6}}))}/>{label}</label>)}
                    {shiftSystem.type!=='THREE_SHIFT'&&<div style={{display:'grid',gap:7}}><div style={{fontSize:11,color:'#94a3b8'}}>반별 시작 위치 밀고당기기</div>{EMPLOYEE_BANDS.map(b=><div key={b} style={{display:'grid',gridTemplateColumns:'48px 36px 1fr 36px',alignItems:'center',gap:6,background:'#0f172a',border:'1px solid #334155',borderRadius:10,padding:8}}><strong>{b}</strong><button onClick={()=>moveBandCycle(b,-1)} style={{...buttonBase,background:'#334155'}}>‹</button><div style={{textAlign:'center',fontSize:11,fontWeight:950}}>{(SHIFT_SYSTEM_PATTERNS[shiftSystem.type]||[]).map((x,i)=>i===Number(shiftSystem.offsets?.[b]||0)?`[${x}]`:x).join(' · ')}</div><button onClick={()=>moveBandCycle(b,1)} style={{...buttonBase,background:'#334155'}}>›</button></div>)}</div>}
                    <div style={{fontSize:10,color:'#94a3b8'}}>1주기: 주-야-비-휴 / 2주기: 주-주-휴-야-야-비-휴-휴</div>
                    <button onClick={saveShiftSystem} style={{...buttonBase,background:'linear-gradient(135deg,#0ea5e9,#2563eb)',padding:11}}>전체 달력에 적용·저장</button>
                  </div>}
                </div>
                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='holiday'?'':'holiday')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>📅 공휴일 관리</span><span>{adminOpenSection==='holiday'?'▼':'▶'}</span></button>
                  {adminOpenSection==='holiday'&&<div style={{padding:12,borderTop:'1px solid #334155',display:'grid',gap:8}}><input type="date" value={holidayForm.date} onChange={e=>setHolidayForm(v=>({...v,date:e.target.value}))} style={{...selectStyle,width:'100%',boxSizing:'border-box'}}/><input value={holidayForm.name} onChange={e=>setHolidayForm(v=>({...v,name:e.target.value}))} placeholder="공휴일 이름" style={{...selectStyle,width:'100%',boxSizing:'border-box'}}/><button onClick={addCustomHoliday} style={{...buttonBase,background:'#2563eb',padding:10}}>공휴일 추가</button>{Object.entries(customHolidays).sort().map(([k,v])=><div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,background:'#0f172a',border:'1px solid #334155',borderRadius:9,padding:'8px 10px'}}><span><b>{k}</b> · {v}</span><button onClick={()=>removeCustomHoliday(k)} style={{...buttonBase,background:'#7f1d1d',padding:'5px 8px'}}>삭제</button></div>)}</div>}
                </div>
                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='employees'?'':'employees')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>👥 직원 DB 관리</span><span>{adminOpenSection==='employees'?'▼':'▶'}</span></button>
                  {adminOpenSection==='employees'&&<div style={{paddingBottom:10,borderTop:'1px solid #334155'}}>
                <div style={{ background:'#111827', border:'1px solid #334155', borderRadius:14, overflow:'hidden' }}>
                  
                  <div style={{ margin:'10px 12px 0', fontSize:11, color:'#86efac', background:'#052e16', border:'1px solid #14532d', borderRadius:10, padding:'8px 10px', fontWeight:900 }}>
                    🟢 Firebase 연결됨 · 직원DB {activeEmployeeList.length}명 동기화
                  </div>
                  <div style={{ padding:12, display:'grid', gap:8 }}>
                    <input value={employeeForm.name} onChange={e=>setEmployeeForm(f=>({...f,name:e.target.value}))} placeholder="실명 예: 문태헌" style={{ ...selectStyle, width:'100%', boxSizing:'border-box' }} />
                    <input value={employeeForm.outputName} onChange={e=>setEmployeeForm(f=>({...f,outputName:e.target.value}))} placeholder="출력이름 예: 태헌 / 진수A" style={{ ...selectStyle, width:'100%', boxSizing:'border-box' }} />
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 92px', gap:8 }}>
                      <select value={employeeForm.band} onChange={e=>setEmployeeForm(f=>({...f,band:e.target.value}))} style={{ ...selectStyle, width:'100%' }}>{EMPLOYEE_BANDS.map(b=><option key={b}>{b}</option>)}</select>
                      <button onClick={handleEmployeeAdd} style={{ ...buttonBase, background:'#059669', padding:'8px 10px' }}>추가</button>
                    </div>
                  </div>
                </div>

                <div style={{ display:'grid', gap:8 }}>
                  {EMPLOYEE_BANDS.map(b => {
                    const activeCount = employeeList.filter(emp=>emp.band===b && emp.active).length;
                    const opened = adminBandOpen === b;
                    return <div key={b} style={{ background:'#111827', border:'1px solid #334155', borderRadius:14, overflow:'hidden' }}>
                      <button onClick={()=>setAdminBandOpen(opened ? '' : b)} style={{ width:'100%', border:'none', background:'transparent', color:'#f8fafc', padding:'12px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }}>
                        <span style={{ fontWeight:950 }}>{opened ? '▼' : '▶'} {b} <span style={{ color:'#94a3b8', fontSize:12 }}>({activeCount}명)</span></span>
                        <span style={{ color:'#94a3b8', fontSize:12 }}>보기</span>
                      </button>
                      {opened && <div style={{ borderTop:'1px solid #334155', padding:10, display:'grid', gap:8 }}>
                        <button onClick={()=>clearBandEmployees(b)} style={{ border:'none', borderRadius:9, background:'#7f1d1d', color:'#fecaca', padding:'9px 10px', fontSize:12, fontWeight:950, cursor:'pointer', width:'100%' }}>이 반 전체삭제</button>
                        {employeeList.filter(emp=>emp.band===b && emp.active).map(emp => <div key={emp.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'9px 10px' }}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:16, fontWeight:950 }}>{getEmployeeDisplayName(emp)}</div>
                            <div style={{ fontSize:11, color:'#64748b', fontWeight:800 }}>{emp.name}</div>
                          </div>
                          <button onClick={()=>deleteEmployee(emp.id)} style={{ border:'none', background:'#7f1d1d', color:'#fecaca', borderRadius:999, cursor:'pointer', fontWeight:950, width:30, height:30, flex:'0 0 auto' }}>×</button>
                        </div>)}
                        {activeCount===0 && <div style={{ color:'#64748b', fontSize:12, padding:'8px 0', textAlign:'center' }}>비어있음</div>}
                      </div>}
                    </div>;
                  })}
                </div>

                  </div>}
                </div>

                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='patrol'?'':'patrol')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>🚔 순찰설정</span><span>{adminOpenSection==='patrol'?'▼':'▶'}</span></button>
                  {adminOpenSection==='patrol'&&<div style={{padding:12,borderTop:'1px solid #334155'}}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                    <div>
                      <div style={{ fontSize:11, color:'#94a3b8', fontWeight:900, marginBottom:5 }}>반 선택</div>
                      <select value={patrolForm.band} onChange={e=>setPatrolForm(f=>({ ...f, band:e.target.value }))} style={{ ...selectStyle, width:'100%' }}>{EMPLOYEE_BANDS.map(b=><option key={b}>{b}</option>)}</select>
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:'#94a3b8', fontWeight:900, marginBottom:5 }}>발전소 선택</div>
                      <select value={patrolForm.division} onChange={e=>setPatrolForm(f=>({ ...f, division:e.target.value }))} style={{ ...selectStyle, width:'100%' }}>{['1발전','2발전'].map(d=><option key={d}>{d}</option>)}</select>
                    </div>
                  </div>
                  <div style={{ display:'grid', gap:9 }}>
                    <label style={{ display:'grid', gap:5 }}>
                      <span style={{ fontSize:12, color:'#cbd5e1', fontWeight:950 }}>평일 A근무 순찰자</span>
                      <select value={patrolForm.weekdayA} onChange={e=>setPatrolForm(f=>({ ...f, weekdayA:e.target.value }))} style={{ ...selectStyle, width:'100%' }}>{patrolPositionOptions.map(pos=><option key={pos}>{pos}</option>)}</select>
                    </label>
                    <label style={{ display:'grid', gap:5 }}>
                      <span style={{ fontSize:12, color:'#cbd5e1', fontWeight:950 }}>주말/공휴일 A근무 순찰자</span>
                      <select value={patrolForm.holidayA} onChange={e=>setPatrolForm(f=>({ ...f, holidayA:e.target.value }))} style={{ ...selectStyle, width:'100%' }}>{patrolPositionOptions.map(pos=><option key={pos}>{pos}</option>)}</select>
                    </label>
                    <div>
                      <div style={{ fontSize:12, color:'#cbd5e1', fontWeight:950, marginBottom:6 }}>N근무 순찰자 <span style={{ color:'#94a3b8', fontWeight:800 }}>(1명 기본 · 2명 이상 체크 가능)</span></div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:7 }}>
                        {patrolPositionOptions.map(pos => {
                          const checked = (patrolForm.night || []).map(cleanLabel).includes(cleanLabel(pos));
                          return <label key={pos} style={{ display:'flex', alignItems:'center', gap:7, background:checked?'rgba(37,99,235,.22)':'#0f172a', border:`1px solid ${checked?'#2563eb':'#334155'}`, borderRadius:10, padding:'9px 10px', fontSize:12, fontWeight:950 }}>
                            <input type="checkbox" checked={checked} onChange={()=>toggleNightPatrolTarget(pos)} />
                            <span>{pos}</span>
                          </label>;
                        })}
                      </div>
                    </div>
                    <button onClick={savePatrolSettings} style={{ ...buttonBase, background:'linear-gradient(135deg,#0ea5e9,#2563eb)', padding:'10px 12px', width:'100%' }}>순찰설정 저장</button>
                    <div style={{ fontSize:10, color:'#94a3b8', lineHeight:1.45 }}>반·발전소별로 따로 저장됩니다. 저장 후 표의 🚔 순찰자 표시가 바로 반영됩니다.</div>
                  </div>
                </div>

                  </div>}
                </div>
                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='notice'?'':'notice')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>📢 공지사항 관리</span><span>{adminOpenSection==='notice'?'▼':'▶'}</span></button>
                  {adminOpenSection==='notice'&&<div style={{padding:12,borderTop:'1px solid #334155'}}>
                  <textarea value={noticeForm.text} onChange={e=>setNoticeForm(f=>({...f,text:e.target.value}))} placeholder="전체 사용자에게 표시할 공지사항" style={{ ...selectStyle, width:'100%', minHeight:78, resize:'vertical', boxSizing:'border-box', lineHeight:1.45 }} />
                  <div style={{ display:'grid', gap:8, marginTop:8 }}>
                    <label style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6, fontSize:13, fontWeight:900, color:'#cbd5e1', background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'9px 10px' }}>
                      <span>공지 표시</span><input type="checkbox" checked={noticeForm.enabled} onChange={e=>setNoticeForm(f=>({...f,enabled:e.target.checked}))} />
                    </label>
                    <label style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6, fontSize:13, fontWeight:900, color:'#fecaca', background:'#0f172a', border:'1px solid #334155', borderRadius:10, padding:'9px 10px' }}>
                      <span>긴급공지</span><input type="checkbox" checked={noticeForm.urgent} onChange={e=>setNoticeForm(f=>({...f,urgent:e.target.checked}))} />
                    </label>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:10 }}>
                    <button onClick={saveGlobalNotice} style={{ ...buttonBase, background:'#2563eb', padding:'10px 12px', fontSize:12 }}>공지 저장</button>
                    <button onClick={clearGlobalNotice} style={{ ...buttonBase, background:'#7f1d1d', padding:'10px 12px', fontSize:12 }}>공지 삭제</button>
                  </div>
                </div>

                  </div>}
                </div>
                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='workers'?'':'workers')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>👮 근무자 수 설정</span><span>{adminOpenSection==='workers'?'▼':'▶'}</span></button>
                  {adminOpenSection==='workers'&&<div style={{padding:12,borderTop:'1px solid #334155'}}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>{[4,5,6].map(n=><button key={n} onClick={()=>handleWorkerCountChange(n)} style={{ ...buttonBase, height:38, background:workerCount===n?'#2563eb':'#334155' }}>{n}명</button>)}</div>
                  </div>}
                </div>
                <div style={{ textAlign:'center', color:'#64748b', fontSize:11, fontWeight:800 }}>Seul Police · v{APP_VERSION}</div>
                <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,overflow:'hidden'}}>
                  <button onClick={()=>setAdminOpenSection(v=>v==='password'?'':'password')} style={{width:'100%',border:'none',background:'transparent',color:'#f8fafc',padding:12,display:'flex',justifyContent:'space-between',fontWeight:950}}><span>🔐 관리자 암호 변경</span><span>{adminOpenSection==='password'?'▼':'▶'}</span></button>
                  {adminOpenSection==='password'&&<div style={{padding:12,borderTop:'1px solid #334155',display:'grid',gap:8}}>
                  <input type="password" inputMode="numeric" pattern="[0-9]*" value={adminChangeCode.current} onChange={e=>setAdminChangeCode(v=>({...v,current:cleanAdminCode(e.target.value)}))} placeholder="현재 암호" style={{ ...selectStyle, width:'100%', boxSizing:'border-box', fontSize:16 }} />
                  <input type="password" inputMode="numeric" pattern="[0-9]*" value={adminChangeCode.next} onChange={e=>setAdminChangeCode(v=>({...v,next:cleanAdminCode(e.target.value)}))} placeholder="새 암호 4~6자리" style={{ ...selectStyle, width:'100%', boxSizing:'border-box', fontSize:16 }} />
                  <input type="password" inputMode="numeric" pattern="[0-9]*" value={adminChangeCode.confirm} onChange={e=>setAdminChangeCode(v=>({...v,confirm:cleanAdminCode(e.target.value)}))} placeholder="새 암호 확인" style={{ ...selectStyle, width:'100%', boxSizing:'border-box', fontSize:16 }} />
                  <button onClick={handleAdminPasswordChange} style={{ ...buttonBase, background:'#334155', padding:'10px 12px' }}>암호 변경</button>
                  </div>}
                </div>
                <button onClick={()=>setIsAdminMode(false)} style={{ ...buttonBase, background:'#7f1d1d', padding:'11px 12px' }}>관리자모드 종료</button>
              </div>}
            </div>}          </div>
        </div>}

        {savedToast && <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'#059669', color:'#fff', fontSize:13, fontWeight:900, padding:'10px 20px', borderRadius:10, zIndex:1000 }}>✅ 저장됐어요</div>}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
