/**
 * Compare dotted x.y.z versions (OfficeCLI / lark-cli style).
 * @param {string | number} left
 * @param {string | number} right
 * @returns {-1 | 0 | 1}
 */
export function compareManagedCliVersions(left, right) {
  const leftParts = String(left).split(".").map(Number);
  const rightParts = String(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}
