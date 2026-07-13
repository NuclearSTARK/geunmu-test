// SEUL-POLICE v8.0.0 rotation helper
// 오른쪽 회전만 사용: 1234 → 4123 → 3412 → 2341
window.SeulPoliceRotateRight = function rotateRight(pattern, steps) {
  const arr = Array.isArray(pattern) ? [...pattern] : [];
  if (arr.length <= 1) return arr;
  const len = arr.length;
  const n = ((Number(steps || 0) % len) + len) % len;
  if (n === 0) return arr;
  return [...arr.slice(len - n), ...arr.slice(0, len - n)];
};
