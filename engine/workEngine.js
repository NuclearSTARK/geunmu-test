// SEUL-POLICE v8.1.0 Work Engine
// UI/Firebase와 분리된 순수 근무순서 엔진입니다.
// 핵심 원칙:
// 1) A/B/D반은 기존 전체 근무일 오른쪽 회전 엔진을 그대로 사용합니다.
// 2) C반은 발전소/근무종류별 영구 패턴 테이블을 사용합니다.
// 3) 휴무는 카운트하지 않습니다.
// 4) 엔진은 숫자 패턴만 계산하고, 마지막에 근무자명으로 매핑합니다.
(function () {
  const BASE_DATE = new Date(2026, 6, 1); // 2026-07-01

  const BASE_PATTERN = {
    'A-1발전': [1, 2, 3, 4],
    'A-2발전': [1, 2, 3, 4],
    'B-1발전': [1, 2, 3, 4],
    'B-2발전': [1, 2, 3, 4],
    'D-1발전': [1, 2, 3, 4],
    'D-2발전': [1, 2, 3, 4],
  };

  // C반 전용 영구 패턴.
  // 각 근무종류(D/N/A)는 서로 독립적으로 카운트한다.
  const C_SHIFT_PATTERNS = {
    '1발전': {
      // C반 1발전 영구 규칙
      // D근무: 7/1 기준 1432
      // N근무: D패턴 +1칸 시작 = 2143
      // A근무: D패턴 +3칸 시작 = 4321
      D: [[1,4,3,2], [2,1,4,3], [3,2,1,4], [4,3,2,1]],
      N: [[2,1,4,3], [3,2,1,4], [4,3,2,1], [1,4,3,2]],
      A: [[4,3,2,1], [1,4,3,2], [2,1,4,3], [3,2,1,4]],
    },
    '2발전': {
      D: [[1,2,3,4], [4,1,2,3], [3,4,1,2], [2,3,4,1]],
      N: [[4,3,2,1], [1,4,3,2], [2,1,4,3], [3,2,1,4]],
      A: [[2,4,1,3], [3,2,4,1], [1,3,2,4], [4,1,3,2]],
    },
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

  function positiveMod(num, mod) {
    return ((Number(num || 0) % mod) + mod) % mod;
  }

  function mapPatternToNames(patternNumbers, names, workerOrder, workerCount) {
    const count = Number(workerCount || 4);
    const safeNames = Array.isArray(names) ? names : [];
    return patternNumbers.slice(0, count).map(num => {
      const nameIdx = Number(num) - 1;
      return safeNames[nameIdx] || `근무자${num}`;
    });
  }

  function generateCDisplayPattern({ year, month, day, band, division, shift, workerCount, getShiftForDate }) {
    const plantPatterns = C_SHIFT_PATTERNS[division];
    const shiftPatterns = plantPatterns && plantPatterns[shift];

    // C반이어도 정의되지 않은 값은 안전하게 기본 엔진으로 보낸다.
    if (!shiftPatterns) return null;

    const count = countWorkDaysFromBase({
      year,
      month,
      day,
      band,
      division,
      shiftFilter: shift,
      getShiftForDate,
    });

    const idx = positiveMod(count, shiftPatterns.length);
    return normalizePattern(shiftPatterns[idx], workerCount);
  }

  function generateDisplayOrder({ year, month, day, band, division, shift, workerCount, names, workerOrder, getShiftForDate }) {
    const bandCode = getBandCode(band);

    if (bandCode === 'C') {
      const cPattern = generateCDisplayPattern({ year, month, day, band, division, shift, workerCount, getShiftForDate });
      if (cPattern) return mapPatternToNames(cPattern, names, workerOrder, workerCount);
    }

    // A/B/D반: 기존 전체 근무일 기준 오른쪽 회전.
    const key = getPatternKey(band, division);
    const pattern = normalizePattern(BASE_PATTERN[key] || [1, 2, 3, 4], workerCount);
    const workCount = countWorkDaysFromBase({ year, month, day, band, division, shiftFilter: null, getShiftForDate });
    const rotated = rotateRight(pattern, workCount);
    return mapPatternToNames(rotated, names, workerOrder, workerCount);
  }

  window.SeulPoliceWorkEngine = {
    version: '8.1.1',
    BASE_DATE,
    BASE_PATTERN,
    C_SHIFT_PATTERNS,
    rotateRight,
    generateDisplayOrder,
    _countWorkDaysFromBase: countWorkDaysFromBase,
  };
})();
