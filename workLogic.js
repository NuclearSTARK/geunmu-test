// SEUL POLICE v7.0 근무 로직 엔진
// 이 파일은 UI/Firebase와 분리된 순수 근무순서 계산 전용 모듈입니다.
// app.js는 이 엔진의 결과만 받아 화면에 표시합니다.
(function (global) {
  "use strict";

  const BASE_DATE = new Date(2026, 6, 1); // 2026-07-01 검증 완료 기준일

  function asDateOnly(value) {
    const d = value instanceof Date ? value : new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function normalizeCount(count, fallback) {
    const n = Number(count);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  }

  function normalizeOrder(rawOrder, count) {
    const total = normalizeCount(count, 4);
    const result = [];
    if (Array.isArray(rawOrder)) {
      rawOrder.forEach((value) => {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0 && n < total && !result.includes(n)) result.push(n);
      });
    }
    for (let i = 0; i < total; i += 1) {
      if (!result.includes(i)) result.push(i);
    }
    return result.slice(0, total);
  }

  function mapOrderToNames(order, names, count) {
    const total = normalizeCount(count, Array.isArray(names) ? names.length : 4);
    const safeNames = Array.isArray(names) ? names : [];
    return normalizeOrder(order, total).map((idx) => safeNames[idx] || `근무자${idx + 1}`);
  }

  // 핵심 회전 방향: 1234 → 4123 → 3412 → 2341 → 1234
  function rotateRightBy(values, steps) {
    const arr = Array.isArray(values) ? values.slice() : [];
    if (arr.length <= 1) return arr;
    const len = arr.length;
    const move = ((Number(steps || 0) % len) + len) % len;
    if (move === 0) return arr;
    return arr.slice(len - move).concat(arr.slice(0, len - move));
  }

  function countWorkDaysBefore({ targetDate, division, band, shiftFilter = null, getShiftForDate }) {
    if (typeof getShiftForDate !== "function") {
      throw new Error("workLogic: getShiftForDate 함수가 필요합니다.");
    }

    const target = asDateOnly(targetDate);
    const base = asDateOnly(BASE_DATE);
    if (target.getTime() === base.getTime()) return 0;

    let count = 0;
    if (target > base) {
      for (let d = new Date(base); d < target; d.setDate(d.getDate() + 1)) {
        const sh = getShiftForDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), division, band);
        if (sh !== "휴" && (!shiftFilter || sh === shiftFilter)) count += 1;
      }
      return count;
    }

    for (let d = new Date(target); d < base; d.setDate(d.getDate() + 1)) {
      const sh = getShiftForDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), division, band);
      if (sh !== "휴" && (!shiftFilter || sh === shiftFilter)) count -= 1;
    }
    return count;
  }

  function getBaseOrder({ names, shiftOrders, workerCount, shift, mode }) {
    const count = normalizeCount(workerCount, Array.isArray(names) ? names.length : 4);
    const identity = Array.from({ length: count }, (_, i) => i);

    if (mode === "C") {
      return mapOrderToNames(shiftOrders && shiftOrders[shift] ? shiftOrders[shift] : identity, names, count);
    }

    // A/B/D는 전체 순환 기준. CYCLE이 있으면 CYCLE을 사용하고 없으면 N 또는 기본순서를 사용.
    const raw = shiftOrders && Array.isArray(shiftOrders.CYCLE)
      ? shiftOrders.CYCLE
      : (shiftOrders && Array.isArray(shiftOrders.N) ? shiftOrders.N : identity);
    return mapOrderToNames(raw, names, count);
  }

  function buildABDOrder({ names, shiftOrders, workerCount, targetDate, division, band, getShiftForDate }) {
    const baseOrder = getBaseOrder({ names, shiftOrders, workerCount, mode: "ABD" });
    const rotationCount = countWorkDaysBefore({ targetDate, division, band, getShiftForDate });
    return rotateRightBy(baseOrder, rotationCount);
  }

  function buildCOrder({ names, shiftOrders, workerCount, targetDate, division, band, shift, getShiftForDate }) {
    const baseOrder = getBaseOrder({ names, shiftOrders, workerCount, shift, mode: "C" });
    const rotationCount = countWorkDaysBefore({ targetDate, division, band, shiftFilter: shift, getShiftForDate });
    return rotateRightBy(baseOrder, rotationCount);
  }

  function buildWorkerOrder({ names, shiftOrders, workerCount, targetDate, division, band, shift, getShiftForDate }) {
    if (band === "C반") {
      return buildCOrder({ names, shiftOrders, workerCount, targetDate, division, band, shift, getShiftForDate });
    }
    return buildABDOrder({ names, shiftOrders, workerCount, targetDate, division, band, getShiftForDate });
  }

  global.SeulPoliceWorkLogic = Object.freeze({
    BASE_DATE_ISO: "2026-07-01",
    rotateRightBy,
    countWorkDaysBefore,
    buildABDOrder,
    buildCOrder,
    buildWorkerOrder,
  });
})(window);
