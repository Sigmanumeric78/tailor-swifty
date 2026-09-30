export const clamp01 = value => Math.max(0, Math.min(1, value));
export function progressFromRect(top, height, viewportHeight) {
  return clamp01((viewportHeight * .72 - top) / Math.max(1, height * .92));
}
export function drawCount(progress, total) {
  return Math.min(total, Math.max(6, Math.floor(clamp01(progress) * (total / 6)) * 6));
}
