// Shared world-space flight gates. Visuals and swept-crossing physics use the
// same coordinates; every gate can be collected once, in either direction.
export const FACTORY_RING_GOAL = 5;
export const FACTORY_BOUNDS = Object.freeze({
  minX: -110, maxX: 110,
  minY: -15, maxY: 100,
  minZ: -45, maxZ: 350,
});
export const FACTORY_RINGS = Object.freeze([
  { id: 1, position: [0, 8, 26], radius: 7 },
  { id: 2, position: [0, 12, 50], radius: 8 },
  { id: 3, position: [1, 16, 76], radius: 8 },
  { id: 4, position: [2, 20, 102], radius: 8 },
  { id: 5, position: [0, 18, 130], radius: 8 },
  { id: 6, position: [-24, 28, 164], radius: 8 },
  { id: 7, position: [-34, 36, 200], radius: 8 },
  { id: 8, position: [0, 42, 232], radius: 9 },
  { id: 9, position: [30, 30, 266], radius: 8 },
  { id: 10, position: [10, 18, 302], radius: 8 },
].map((ring) => Object.freeze({ ...ring, position: Object.freeze(ring.position), normal: Object.freeze([0, 0, 1]) })));
