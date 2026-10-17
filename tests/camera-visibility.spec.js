import { test, expect } from "@playwright/test";

test.skip(Boolean(process.env.PWA_TEST_URL), "Camera diagnostics are development-only.");

async function openGarage(page) {
  await page.addInitScript(() => {
    localStorage.setItem("roadster-manual-seen", "true");
    localStorage.setItem("roadster-settings", JSON.stringify({ quality: "low", muted: true, music: false, voices: false, shake: false, haptics: false }));
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__roadster && !document.querySelector("#loading"));
  await page.evaluate(() => window.__roadster.startLevel(0));
  await page.waitForFunction(() => window.__roadster.cameraVisibility?.active);
}

test("actual garage walls, roof, shelves and loose props leave the whole car visible from awkward camera angles", async ({ page }) => {
  await openGarage(page);
  const results = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { environment, cameraVisibility, camera, car, physics } = window.__roadster;
    const scenarios = [
      { name: "chase spawn", car: [0, 0.74, 0], camera: [3.3, 4.04, -8.8] },
      { name: "right wall and house", car: [3.8, 0.74, 2], camera: [12, 4, -4] },
      { name: "backwards chase", car: [0, 0.74, -3.4], camera: [-3.3, 4, 5.4], rotation: [0, Math.PI, 0] },
      { name: "trackside through house", car: [0, 0.74, 0], camera: [23, 8, -9] },
      { name: "raised garage door", car: [0, 3.2, 5.8], camera: [3, 8, -2] },
      { name: "camera in back wall", car: [0, 0.8, -1], camera: [0, 1.6, -5.3] },
      { name: "roof in airborne roll", car: [3, 2.5, 3], camera: [7, 7, -6], rotation: [-0.9, 0.8, 3] },
      { name: "outside house", car: [12, 0.74, 2], camera: [3.2, 4.1, 5.3] },
      { name: "reverse by shelves", car: [-3.8, 0.74, 1.5], camera: [-6, 3.1, 7.3], rotation: [0, Math.PI, 0] },
    ];
    const bodyCount = physics.world.bodies.length;
    const results = [];
    const ray = new THREE.Raycaster();
    const target = new THREE.Vector3();
    for (const aspect of [1100 / 760, 390 / 844, 844 / 390]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      for (const scenario of scenarios) {
        cameraVisibility.reset();
        car.group.position.set(...scenario.car);
        car.group.rotation.set(...(scenario.rotation || [0, 0, 0]));
        car.group.updateMatrixWorld(true);
        camera.position.set(...scenario.camera);
        camera.lookAt(...scenario.car);
        camera.updateMatrixWorld(true);
        cameraVisibility.update(camera, car.group, 1 / 60);
        environment.group.updateMatrixWorld(true);
        const visible = environment.cameraOccluders.filter(object => object.visible);
        const blockedSamples = [];
        // Independent geometry raycasts check body corners, roof, wheels and
        // center against the actual rendered garage after its cutaway update.
        for (const x of [-1.1, 0, 1.1]) for (const y of [-0.65, 0.2, 0.75]) for (const z of [-2.3, 0, 2.3]) {
          target.set(x, y, z).applyMatrix4(car.group.matrixWorld);
          const distance = camera.position.distanceTo(target);
          ray.set(camera.position, target.sub(camera.position).normalize());
          ray.near = camera.near;
          ray.far = distance - 0.02;
          const hits = ray.intersectObjects(visible, false);
          if (hits.length) blockedSamples.push({ point: [x, y, z], mesh: hits[0].object.name });
        }
        results.push({ name: scenario.name, aspect, blockedSamples, hidden: cameraVisibility.hiddenCount, visible: visible.length });
      }
    }
    const ground = [];
    environment.group.traverse((object) => {
      if (object.isMesh && !object.userData.cameraOccluder) ground.push(object.visible);
    });
    cameraVisibility.reset();
    return {
      scenarios: results,
      bodyCountUnchanged: physics.world.bodies.length === bodyCount,
      allGroundVisible: ground.every(Boolean),
      restored: environment.cameraOccluders.every(object => object.visible),
      occluderCount: environment.cameraOccluders.length,
    };
  });
  expect(results.scenarios).toHaveLength(27);
  for (const result of results.scenarios) {
    expect(result.blockedSamples, `${result.name} at aspect ${result.aspect}`).toEqual([]);
    expect(result.hidden).toBeGreaterThan(0);
    expect(result.visible).toBeGreaterThan(20);
  }
  expect(results.bodyCountUnchanged).toBe(true);
  expect(results.allGroundVisible).toBe(true);
  expect(results.restored).toBe(true);
  expect(results.occluderCount).toBeLessThan(220);
});

test("live camera modes cut away blockers and level changes release the controller", async ({ page }) => {
  await openGarage(page);
  await page.waitForFunction(() => window.__roadster.input.enabled);
  for (let view = 0; view < 3; view++) {
    const snapshot = await page.evaluate(() => ({
      hidden: window.__roadster.cameraVisibility.hiddenCount,
      active: window.__roadster.cameraVisibility.active,
      finite: window.__roadster.camera.position.toArray().every(Number.isFinite),
    }));
    expect(snapshot.active).toBe(true);
    expect(snapshot.hidden).toBeGreaterThan(0);
    expect(snapshot.finite).toBe(true);
    await page.getByRole("button", { name: "Change camera", exact: true }).click();
    await page.waitForTimeout(400);
  }
  const lifecycle = await page.evaluate(() => {
    const previous = window.__roadster.cameraVisibility;
    window.__roadster.startLevel(1);
    return { entries: previous.entries.length, active: previous.active, current: window.__roadster.cameraVisibility.entries.length };
  });
  expect(lifecycle).toEqual({ entries: 0, active: false, current: 0 });
});
