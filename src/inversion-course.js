// The visible concrete apron is also the inversion's landing area. Keep the
// geometry and flight rules together so a safe landing has no invisible gate.
export const INVERSION_APRON = Object.freeze({ width: 230, length: 300, centerZ: 25 });

export function onInversionApron(position) {
  return Math.abs(position.x) < INVERSION_APRON.width / 2 &&
    Math.abs(position.z - INVERSION_APRON.centerZ) < INVERSION_APRON.length / 2;
}
