import { test, expect } from "@playwright/test";

test.skip(Boolean(process.env.PWA_TEST_URL), "Geometry diagnostics import development modules.");

test("inversion runway has one visible driving surface and retains its flat landing colliders", async ({ page }) => {
  // Build a separate environment so the ray tests are independent of gameplay
  // camera motion and inspect exactly what survives the static scenery batching.
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { buildEnvironment, RAMP } = await import("/src/environments.js");
    const colliders = [];
    const scene = new THREE.Scene();
    const environment = buildEnvironment(2, scene, { addBox: config => colliders.push(config) });
    scene.updateMatrixWorld(true);
    const meshes = [];
    environment.group.traverse(object => {
      if (object.isMesh && !object.material.transparent) meshes.push(object);
    });
    const ray = new THREE.Raycaster();
    const points = [
      [0.73, -26.2], [0.73, -12.2], [0.73, 16.2], [0.73, 30.2], [0.73, 40.2],
      [-4.73, 20.2], [4.73, 20.2], [-5.27, 20.2], [5.27, 20.2],
      [0.73, -30.2], [0.73, 60.2], [30.73, 100.2],
    ];
    const surfaces = points.map(([x, z]) => {
      ray.set(new THREE.Vector3(x, 0.1, z), new THREE.Vector3(0, -1, 0));
      ray.near = 0;
      ray.far = 0.2;
      const heights = ray.intersectObjects(meshes, false).map(hit => hit.point.y);
      return { point: [x, z], heights };
    });
    const floor = colliders.find(body => body.size[0] === 230 && body.size[2] === 300);
    const runway = colliders.find(body => body.size[0] === RAMP.width && body.size[2] === 72);
    const rampSegments = colliders.filter(body => body.friction === 1.1).length;
    environment.dispose();
    return { surfaces, floor, runway, rampSegments, expectedSegments: RAMP.segments };
  });
  for (const surface of result.surfaces) {
    expect(surface.heights, `one surface at ${surface.point}`).toHaveLength(1);
    expect(surface.heights[0]).toBeCloseTo(0, 6);
  }
  expect(result.floor.position[1] + result.floor.size[1] / 2).toBe(0);
  expect(result.runway.position[1] + result.runway.size[1] / 2).toBe(0);
  expect(result.rampSegments).toBe(result.expectedSegments);
});
