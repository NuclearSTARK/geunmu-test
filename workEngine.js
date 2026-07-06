// SEUL-POLICE v7.0.1 Work Engine
// UI/Firebase와 분리된 순수 근무순서 엔진입니다.
// 핵심 원칙:
// 1) 엔진은 숫자 패턴만 계산합니다.
// 2) 기본 회전은 오른쪽 회전만 사용합니다: 1234 → 4123 → 3412 → 2341
// 3) C반 1발전만 BASE_PATTERN이 1432입니다.
// 4) A/B/D는 전체 근무일 기준, C반은 근무별(A/D/N) 독립 카운트입니다.
(function () {
  const BASE_DATE = new Date(2026, 6, 1); // 2026-07-01

  const BASE_PATTERN = {
    'A-1발전': [1, 2, 3, 4],
    'A-2발전': [1, 2, 3, 4],
    'B-1발전': [1, 2, 3, 4],
    'B-2발전': [1, 2, 3, 4],
    'C-1발전': [1, 4, 3, 2],
    'C-2발전': [1, 2, 3, 4],
    'D-1발전': [1, 2, 3, 4],
    'D-2발전': [1, 2, 3, 4],
  };

  function getBandCode(band) {
    return String(band || '').replace('반', '');
  }

  function getPatternKey(band, division) {
    return `${getBandCode(band)}-${division}`;
  }

  function normalizePattern(pattern, workerCount) {
    const count = Number(workerCount || 4);
    const source = Array.isArray(pattern) ? pattern : [];
    const result = source
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 1 && n <= count);
    for (let n = 1; n <= count; n++) if (!result.includes(n)) result.push(n);
    return result.slice(0, count);
  }

  function rotateRight(pattern, steps) {
    const arr = Array.isArray(pattern) ? [...pattern] : [];
    if (arr.length <= 1) return arr;
    const len = arr.length;
    const n = ((Number(steps || 0) % len) + len) % len;
    if (n === 0) return arr;
    return [...arr.slice(len - n), ...arr.slice(0, len - n)];
  }

  function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function countWorkDaysFromBase({ year, month, day, band, division, shiftFilter, getShiftForDate }) {
    const target = dateOnly(new Date(year, month - 1, day));
    const base = dateOnly(BASE_DATE);
    if (target.getTime() === base.getTime()) return 0;

    const stepForward = target > base;
    let count = 0;

    if (stepForward) {
      for (let d = new Date(base); d < target; d.setDate(d.getDate() + 1)) {
        const sh = getShiftForDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), division, band);
        if (sh !== '휴' && (!shiftFilter || sh === shiftFilter)) count += 1;
      }
      return count;
    }

    for (let d = new Date(target); d < base; d.setDate(d.getDate() + 1)) {
      const sh = getShiftForDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), division, band);
      if (sh !== '휴' && (!shiftFilter || sh === shiftFilter)) count += 1;
    }
    return -count;
  }

  function mapPatternToNames(patternNumbers, names, workerOrder, workerCount) {
    const count = Number(workerCount || 4);
    const safeNames = Array.isArray(names) ? names : [];
    const safeOrder = Array.isArray(workerOrder) ? workerOrder : Array.from({ length: count }, (_, i) => i);

    // 번호 1~N은 '근무자 설정에서 저장한 순서'를 의미합니다.
    // 예: 1 = 저장명단 첫 번째 사람, 2 = 두 번째 사람.
    return patternNumbers.slice(0, count).map(num => {
      const orderIdx = Number(num) - 1;
      const nameIdx = safeOrder[orderIdx] ?? orderIdx;
      return safeNames[nameIdx] || `근무자${num}`;
    });
  }

  function generateDisplayOrder({ year, month, day, band, division, shift, workerCount, names, workerOrder, getShiftForDate }) {
    const key = getPatternKey(band, division);
    const pattern = normalizePattern(BASE_PATTERN[key] || [1, 2, 3, 4], workerCount);

    // C반은 A/D/N 근무별로 각각 독립 회전. A/B/D는 전체 근무일 기준으로 회전.
    const shiftFilter = getBandCode(band) === 'C' ? shift : null;
    const workCount = countWorkDaysFromBase({ year, month, day, band, division, shiftFilter, getShiftForDate });
    const rotated = rotateRight(pattern, workCount);
    return mapPatternToNames(rotated, names, workerOrder, workerCount);
  }

  window.SeulPoliceWorkEngine = {
    version: '7.0.1',
    BASE_DATE,
    BASE_PATTERN,
    rotateRight,
    generateDisplayOrder,
    _countWorkDaysFromBase: countWorkDaysFromBase,
  };
})();
