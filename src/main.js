import { isPlayer, getGameViewport, refreshGameViewport } from "./embed.js";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GraphicsPipeline } from "./graphics.js";
import { createGameRenderer } from "./graphics-startup.js";
import { startGraphicsSession } from "./graphics-session.js";
import { createCar } from "./car.js";
import { PhysicsGame } from "./physics.js";
import { buildEnvironment } from "./environments.js";
import { BoosterEffects } from "./effects.js";
import { WreckEffects } from "./wreck.js";
import { RivalPresentation } from "./rival.js";
import { CameraVisibility } from "./camera-visibility.js";
import { Input } from "./input.js";
import { getControlMode, subscribeControlMode } from "./control-mode.js";
import { GameAudio } from "./audio.js";
import { UI, LEVELS } from "./ui.js";
import { setupPWA } from "./pwa.js";

const viewport = getGameViewport();
const mobileGraphics = isPlayer || navigator.userAgentData?.mobile === true ||
  matchMedia("(pointer: coarse)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const defaults = {
  muted: false,
  music: true,
  voices: true,
  haptics: true,
  shake: !reducedMotion,
  safeGraphics: false,
  quality:
    isPlayer || viewport.width < 760 || matchMedia("(pointer: coarse)").matches
      ? "balanced"
      : "high",
};
function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}
function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const settings = { ...defaults, ...readStorage("roadster-settings", {}) };
const records = readStorage("roadster-records", {});
startGraphicsSession(() => {
  settings.safeGraphics = true;
  saveStorage("roadster-settings", settings);
});
const renderer = createGameRenderer(settings, {
  mobile: mobileGraphics,
  onSafeMode() {
    settings.safeGraphics = true;
    saveStorage("roadster-settings", settings);
  },
});
// Start tiny; the device budget is applied before the first scene render.
renderer.setDrawingBufferSize(1, 1, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
function describeCanvasControls() {
  renderer.domElement.setAttribute(
    "aria-label",
    getControlMode() === "touch"
      ? "Roadster game. Use the left pad to drive and the right pad to fly. Hold Boost for rear rockets."
      : "Roadster game. Use Q, W, O and P for boosters and arrow keys to drive.",
  );
}
describeCanvasControls();
subscribeControlMode(describeCanvasControls);
document.querySelector("#game-canvas").appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  38,
  viewport.width / viewport.height,
  0.08,
  2200,
);
let environmentTarget;
function rebuildReflections() {
  scene.environment = null;
  environmentTarget?.dispose();
  environmentTarget = null;
  // PMREM allocates and renders half-float targets even with a 1px canvas.
  // Compatibility mode must skip that GPU path before any scene is rendered.
  if (settings.safeGraphics || !renderer.extensions.has("EXT_color_buffer_float")) return;
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  try {
    environmentTarget = generator.fromScene(room, 0.025);
    scene.environment = environmentTarget.texture;
  } finally {
    room.dispose();
    generator.dispose();
  }
}
scene.environmentIntensity = 0.6;
const car = createCar();
scene.add(car.group);
const audio = new GameAudio();
audio.setMuted(settings.muted);
audio.setPreferences(settings);
audio.preload();
// Unlock sound on a real gesture, including inspecting the car in the hangar.
window.addEventListener("pointerdown", () => audio.start(), { once: true });
window.addEventListener("keydown", () => audio.start(), { once: true });
document.addEventListener("visibilitychange", () =>
  audio.setPaused(paused || document.hidden || windowBlurred),
);
let mode = "menu",
  paused = false,
  windowBlurred = false,
  environment = null,
  rivalPresentation = null,
  cameraVisibility = null,
  studio = null,
  selected = 0,
  cameraMode = 0,
  shake = 0,
  impactFlash = 0,
  blastFlash = 0,
  lastHaptic = 0;
let outcomeAt = null,
  finishState = null,
  resultShown = false,
  firstStart = true,
  airMessage = false,
  lastRingCount = 0,
  crashMessageAt = 0,
  wreckStarted = false,
  aftermathTime = 0;
const pendingImpacts = [];
let countdown = 0,
  totalTime = 0,
  frameCount = 0,
  fpsSum = 0,
  hudTick = 0,
  lastFrame = performance.now();
const physics = new PhysicsGame({
  onRivalImpact: (event) => {
    rivalPresentation?.impact(event);
    // A collision between the cars already plays through the player callback.
    if (event.body !== physics.body) {
      effects.impact(event);
      audio.impact(event);
    }
  },
  onImpact: (e) => {
    if (mode !== "game") return;
    pendingImpacts.push(e);
    effects.impact(e);
    audio.impact(e);
    shake = Math.min(0.7, shake + e.intensity * 0.5);
    impactFlash = Math.min(0.4, e.intensity * 0.5);
    vibrate([Math.min(120, 20 + e.intensity * 90)]);
    if (
      !wreckStarted &&
      e.intensity > 0.22 &&
      physics.time - crashMessageAt > 3
    ) {
      crashMessageAt = physics.time;
      ui.message(
        [
          "That was probably load-bearing.",
          "The warranty has left the chat.",
          "Structural feedback received.",
          "A small setback. For the building.",
        ][Math.floor(Math.random() * 4)],
      );
    }
  },
});
const effects = new BoosterEffects(scene, car);
const wreck = new WreckEffects(scene, physics, car);
const graphics = new GraphicsPipeline(renderer, scene, camera, {
  excludedEffects: () => [effects.flames, ...(wreck.aoExcluded || []), ...(rivalPresentation?.wreck.aoExcluded || [])],
});
let graphicsLost = false, graphicsLosses = 0, graphicsRecoveryTimer;
const ui = new UI(action, settings);
const input = new Input({ onAction: action });
input.bind();
const vPosition = new THREE.Vector3(),
  vTarget = new THREE.Vector3(),
  vCamera = new THREE.Vector3(),
  vForward = new THREE.Vector3(),
  lookAt = new THREE.Vector3();
let followYaw = 0,
  orbitYaw = 0.78,
  orbitPitch = 0.2,
  orbitIdle = 0;
const pointer = { down: false, x: 0, y: 0 };
renderer.domElement.addEventListener("pointerdown", (e) => {
  renderer.domElement.focus({ preventScroll: true });
  if (mode !== "menu") return;
  pointer.down = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  try {
    renderer.domElement.setPointerCapture(e.pointerId);
  } catch {}
  orbitIdle = 8;
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!pointer.down || mode !== "menu") return;
  orbitYaw += (e.clientX - pointer.x) * 0.006;
  orbitPitch = THREE.MathUtils.clamp(
    orbitPitch + (e.clientY - pointer.y) * 0.002,
    0.06,
    0.7,
  );
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
renderer.domElement.addEventListener("pointerup", () => (pointer.down = false));
renderer.domElement.addEventListener(
  "pointercancel",
  () => (pointer.down = false),
);

renderer.domElement.addEventListener(
  "lostpointercapture",
  () => (pointer.down = false),
);
window.addEventListener("blur", () => {
  windowBlurred = true;
  pointer.down = false;
  audio.setPaused(true);
});
window.addEventListener("focus", () => {
  windowBlurred = false;
  audio.setPaused(paused || document.hidden);
});

function vibrate(pattern) {
  if (!settings.haptics || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {}
}
function graphicsOptions() {
  return {
    quality: settings.quality,
    width: viewport.width,
    height: viewport.height,
    devicePixelRatio: window.devicePixelRatio,
    mobile: mobileGraphics,
    safeMode: settings.safeGraphics,
  };
}
function resizeEffects() {
  effects.resize?.(viewport.height, renderer.getPixelRatio());
  wreck.resize?.(viewport.height, renderer.getPixelRatio());
}
function configureGraphics() {
  if (graphicsLost) return;
  graphics.configure(graphicsOptions());
  resizeEffects();
}
async function copyGraphicsReport() {
  const gl = renderer.getContext();
  const lost = gl.isContextLost();
  const debug = !lost && gl.getExtension("WEBGL_debug_renderer_info");
  const report = JSON.stringify({
    date: new Date().toISOString(),
    build: __ROADSTER_BUILD__,
    browser: navigator.userAgent,
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unavailable",
    webgl: lost ? "context lost" : gl.getParameter(gl.VERSION),
    contextLosses: graphicsLosses,
    contextLost: lost,
    graphics: graphics.diagnostics,
    antialias: gl.getContextAttributes()?.antialias,
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    resources: { ...renderer.info.memory },
    environmentReflections: Boolean(scene.environment),
    level: mode === "game" ? LEVELS[selected].id : "hangar",
  }, null, 2);
  try {
    await navigator.clipboard.writeText(report);
    ui.toast("Graphics report copied. Share it with the developer.");
  } catch {
    ui.graphicsReport(report);
  }
}
function makeStudio() {
  const group = new THREE.Group();
  group.name = "Launch studio";
  scene.add(group);
  scene.background = new THREE.Color(0x090b0e);
  scene.fog = new THREE.FogExp2(0x090b0e, 0.025);
  scene.environmentIntensity = 0.6;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({
      color: 0x010102,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const hemi = new THREE.HemisphereLight(0xc6ddff, 0x161216, 0.75);
  group.add(hemi);
  const key = new THREE.DirectionalLight(0xf1f5ff, 2.3);
  key.position.set(4, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  group.add(key);
  const rim = new THREE.DirectionalLight(0x9ebdff, 1.5);
  rim.position.set(-5, 4, -3);
  group.add(rim);
  const front = new THREE.DirectionalLight(0xffe5d4, 0.65);
  front.position.set(0, 2, 8);
  group.add(front);
  const red = new THREE.PointLight(0xe82127, 18, 12, 2);
  red.position.set(-4, 1.8, -3);
  group.add(red);
  // A long red floor inlay anchors the launch-stage composition.
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(25, 0.018, 0.025),
    new THREE.MeshBasicMaterial({ color: 0x7f151d }),
  );
  line.position.set(0, 0.013, -4);
  group.add(line);
  car.group.position.set(0, 0.73, 0);
  car.group.quaternion.identity();
  car.setDamage(0);
  return {
    group,
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) o.material.dispose();
        o.shadow?.map?.dispose();
      });
    },
  };
}
function home() {
  input.enabled = false;
  input.clear();
  paused = false;
  mode = "menu";
  outcomeAt = null;
  finishState = null;
  resultShown = false;
  wreck.clear();
  audio.reset();
  audio.setScene("menu");
  pendingImpacts.length = 0;
  wreckStarted = false;
  aftermathTime = 0;
  blastFlash = 0;
  rivalPresentation?.dispose();
  rivalPresentation = null;
  cameraVisibility?.dispose();
  cameraVisibility = null;
  environment?.dispose();
  environment = null;
  studio?.dispose();
  studio = makeStudio();
  effects.clear();
  ui.home();
  orbitYaw = 0.78;
  orbitPitch = 0.2;
  configureGraphics();
  audio.update({}, false);
}
function startLevel(index = selected) {
  selected = index;
  audio.start();
  input.clear();
  input.enabled = false;
  paused = false;
  mode = "game";
  wreck.clear();
  audio.reset();
  pendingImpacts.length = 0;
  wreckStarted = false;
  aftermathTime = 0;
  blastFlash = 0;
  rivalPresentation?.dispose();
  rivalPresentation = null;
  cameraVisibility?.dispose();
  cameraVisibility = null;
  studio?.dispose();
  studio = null;
  environment?.dispose();
  environment = null;
  physics.setLevel(LEVELS[index].id);
  audio.beginRun(LEVELS[index].id);
  environment = buildEnvironment(LEVELS[index].id, scene, physics);
  cameraVisibility = new CameraVisibility(environment.cameraOccluders || []);
  if (physics.rival) rivalPresentation = new RivalPresentation(scene, physics, {
    onExplosion: (state) => {
      const distance = physics.body.position.distanceTo(state.position);
      audio.explosion();
      if (distance < 30) {
        shake = Math.max(shake, 0.55 * (1 - distance / 30));
        blastFlash = Math.max(blastFlash, reducedMotion ? 0.06 : 0.3);
        vibrate([60, 40, 90]);
      }
      if (!physics.crashed) ui.message("Porsche has left the competition. In several pieces.", 3600);
    },
  });
  scene.environmentIntensity = index === 2 ? 0.38 : 0.6;
  effects.clear();
  car.setDamage(0);
  ui.game(LEVELS[index]);
  outcomeAt = null;
  finishState = null;
  resultShown = false;
  airMessage = false;
  lastRingCount = 0;
  crashMessageAt = 0;
  followYaw = 0;
  shake = 0;
  impactFlash = 0;
  countdown = 1.4;
  ui.message(
    index === 2
      ? "Autodrive engaged. You have the boosters."
      : index === 3
        ? "Ten rings. Fly through any five. Keep the car in one piece."
      : index === 1
        ? "Porsche in the other lane. First to 402 metres wins."
      : "Flight systems armed.",
  );
  updateCar(physics.state, 0);
  updateCamera(1, true);
  configureGraphics();
  if (!isPlayer && firstStart && !readStorage("roadster-manual-seen", false)) {
    firstStart = false;
    paused = true;
    ui.help();
    saveStorage("roadster-manual-seen", true);
  }
}
function reset() {
  if (mode !== "game") return;
  ui.close();
  ui.recovery(null);
  input.clear();
  wreck.clear();
  audio.reset();
  pendingImpacts.length = 0;
  wreckStarted = false;
  aftermathTime = 0;
  blastFlash = 0;
  physics.reset();
  rivalPresentation?.reset();
  cameraVisibility?.reset();
  audio.beginRun(LEVELS[selected].id);
  effects.clear();
  environment?.update(0);
  car.setDamage(0);
  outcomeAt = null;
  finishState = null;
  resultShown = false;
  paused = false;
  airMessage = false;
  lastRingCount = 0;
  crashMessageAt = 0;
  shake = 0;
  impactFlash = 0;
  countdown = 0.7;
  input.enabled = false;
  followYaw = 0;
  updateCar(physics.state, 0);
  updateCamera(1, true);
  ui.message("One more perfectly reasonable attempt.");
}
function togglePause() {
  if (mode !== "game") {
    if (!ui.dialog.hidden) {
      ui.close();
    }
    return;
  }
  if (resultShown) return;
  if (paused) {
    ui.close();
    paused = false;
    input.enabled = countdown <= 0;
    input.clear();
  } else {
    paused = true;
    input.enabled = false;
    input.clear();
    ui.pause();
  }
}
function action(name, value) {
  if (name === "reload-graphics") {
    settings.safeGraphics = true;
    saveStorage("roadster-settings", settings);
    location.reload();
    return;
  }
  if (name === "graphics-report") {
    void copyGraphicsReport();
    return;
  }
  if (graphicsLost) return;
  if (name === "select") {
    selected = value;
    return;
  }
  if (name === "start") {
    startLevel(selected);
    return;
  }
  if (name === "home") {
    home();
    return;
  }
  if (name === "reset") {
    reset();
    return;
  }
  if (name === "pause") {
    togglePause();
    return;
  }
  if (name === "blur") {
    if (mode === "game" && !paused && !resultShown) {
      paused = true;
      input.enabled = false;
      ui.pause();
    }
    return;
  }
  if (name === "close") {
    if (resultShown) {
      home();
      return;
    }
    ui.close();
    paused = false;
    input.enabled = mode === "game" && countdown <= 0;
    input.clear();
    return;
  }
  if (name === "help") {
    if (mode === "game") {
      paused = true;
      input.enabled = false;
      input.clear();
    }
    ui.help();
    return;
  }
  if (name === "settings") {
    if (mode === "game") {
      paused = true;
      input.enabled = false;
      input.clear();
    }
    ui.showSettings(settings);
    return;
  }
  if (name === "save-settings") {
    const wasSafeGraphics = settings.safeGraphics;
    settings.muted = !document.querySelector("#setting-sound").checked;
    settings.music = document.querySelector("#setting-music").checked;
    settings.voices = document.querySelector("#setting-voices").checked;
    settings.haptics = document.querySelector("#setting-haptics").checked;
    settings.shake = document.querySelector("#setting-shake").checked;
    settings.quality = document.querySelector("#setting-quality").value;
    settings.safeGraphics = document.querySelector("#setting-safe").checked;
    saveStorage("roadster-settings", settings);
    audio.setMuted(settings.muted);
    audio.setPreferences(settings);
    ui.setMuted(settings.muted);
    configureGraphics();
    if (wasSafeGraphics !== settings.safeGraphics) rebuildReflections();
    action("close");
    return;
  }
  if (name === "mute") {
    settings.muted = !settings.muted;
    audio.start();
    audio.setMuted(settings.muted);
    ui.setMuted(settings.muted);
    saveStorage("roadster-settings", settings);
    ui.toast(settings.muted ? "Sound muted" : "Sound on");
    return;
  }
  if (name === "camera") {
    cameraMode = (cameraMode + 1) % 3;
    ui.toast(["Chase camera", "Trackside camera", "Close pursuit"][cameraMode]);
    return;
  }
  if (name === "fullscreen") {
    const unavailable = () =>
      ui.toast(
        isPlayer
          ? "Open the full game to use fullscreen."
          : "Fullscreen is unavailable in this browser.",
      );
    // Sandboxed players can reject this synchronously or as a promise.
    try {
      if (document.fullscreenElement)
        Promise.resolve(document.exitFullscreen?.()).catch(unavailable);
      else if (
        document.fullscreenEnabled !== false &&
        document.documentElement.requestFullscreen
      )
        Promise.resolve(document.documentElement.requestFullscreen()).catch(
          unavailable,
        );
      else unavailable();
    } catch {
      unavailable();
    }
    return;
  }
  if (name === "next") {
    if (selected >= LEVELS.length - 1) {
      home();
      return;
    }
    ui.select(selected + 1);
    startLevel(selected);
    return;
  }
}
function updateCar(s, dt) {
  car.group.position.copy(s.position);
  car.group.quaternion.copy(s.quaternion);
  car.update(dt, {
    speed: s.signedSpeed || s.speed,
    steer: (s.steer * 0.54) / (1 + Math.abs(s.signedSpeed) / 26),
    boosters: s.boosterLevels,
  });
  car.wheels.forEach((wheel, i) => {
    wheel.position.y = s.suspension[i];
  });
  car.setDamage(s.damage);
  car.group.updateMatrixWorld();
}
function updateCamera(dt, snap = false) {
  const mobile =
    viewport.width < 760 || matchMedia("(pointer: coarse)").matches;
  const portrait = viewport.height > viewport.width;
  const landscapePhone = mobile && !portrait && viewport.height < 520;
  const isFactory = mode === "game" && LEVELS[selected].id === "factory";
  if (mode === "menu") {
    orbitIdle -= dt;
    if (!pointer.down && orbitIdle <= 0 && !reducedMotion)
      orbitYaw += dt * 0.025;
    const compactShowroom =
      !isPlayer && !portrait && (viewport.width <= 1100 || viewport.height <= 520);
    const distance = portrait
      ? Math.max(10, 7.5 / camera.aspect)
      : compactShowroom
        ? 9.8
        : 8.7;
    vCamera.set(
      Math.sin(orbitYaw) * distance,
      1.2 + Math.sin(orbitPitch) * distance,
      Math.cos(orbitYaw) * distance,
    );
    // Framing the car slightly low leaves breathing room for the title.
    camera.fov = portrait ? 43 : 38;
    camera.position.copy(vCamera);
    camera.setViewOffset(
      viewport.width,
      viewport.height,
      0,
      viewport.height * (portrait ? 0.065 : compactShowroom ? 0.01 : -0.035),
      viewport.width,
      viewport.height,
    );
    camera.lookAt(0, 0.65, 0);
    camera.updateProjectionMatrix();
    return;
  }
  camera.setViewOffset(
    viewport.width,
    viewport.height,
    0,
    viewport.height * (isFactory ? (landscapePhone ? 0.08 : portrait ? 0.06 : 0.02) : landscapePhone ? 0.18 : portrait ? 0.12 : 0.055),
    viewport.width,
    viewport.height,
  );
  const s = physics.state;
  vPosition.copy(s.position);
  let speed = s.speed;
  vForward.set(0, 0, 1).applyQuaternion(car.group.quaternion);
  vForward.y = 0;
  if (s.grounded && vForward.length() > 0.3) {
    const targetYaw = Math.atan2(vForward.x, vForward.z);
    followYaw +=
      Math.atan2(
        Math.sin(targetYaw - followYaw),
        Math.cos(targetYaw - followYaw),
      ) * Math.min(1, dt * 4);
  }
  const isRamp = LEVELS[selected].id === "ramp";
  const rivalGap = s.rival ? Math.abs(s.rival.position.z - s.position.z) : Infinity;
  const rivalFraming = s.rival && !s.rival.crashed ? Math.max(0, 1 - rivalGap / 45) : 0;
  if (cameraMode === 1 || (isRamp && cameraMode !== 2)) {
    vCamera.set(
      s.position.x + 23,
      Math.max(8, s.position.y + 5.5),
      s.position.z - 9,
    );
    if (isRamp) {
      vCamera.x = 28;
      vCamera.y = Math.max(9, s.position.y + 4.5);
      vCamera.z = s.position.z - 10;
    }
    vTarget.set(s.position.x, s.position.y + 1, s.position.z + 1.3);
  } else {
    const close = cameraMode === 2,
      distance = close ? 5.8 : isFactory ? (portrait ? 20 : 15) : rivalFraming > 0 ? (portrait ? 20 : 11.5) : landscapePhone ? 8.8 : portrait ? 11.4 : 8.8;
    const offset = new THREE.Vector3(
      close ? 1.8 : isFactory ? 0.6 : 3.3,
      close ? 2.3 : isFactory && portrait ? 5.5 : selected === 0 ? 3.3 : 3.6,
      -distance,
    ).applyAxisAngle(THREE.Object3D.DEFAULT_UP, followYaw);
    vCamera.copy(vPosition).add(offset);
    vCamera.y = Math.max(2, vCamera.y);
    vTarget
      .copy(vPosition)
      .add(
        new THREE.Vector3(0, isFactory ? 0.8 : 0.25, close ? 0.8 : isFactory ? 2 : 0.2).applyAxisAngle(
          THREE.Object3D.DEFAULT_UP,
          followYaw,
        ),
      );
    if (!close && rivalFraming > 0)
      vTarget.x += THREE.MathUtils.clamp((s.rival.position.x - s.position.x) * 0.5, -4, 4) * rivalFraming;
  }
  if (wreckStarted) {
    vCamera.sub(vPosition).multiplyScalar(1.22).add(vPosition);
    vCamera.y += 0.8;
  }
  const blend = snap ? 1 : 1 - Math.exp(-dt * (isRamp ? 4 : 5.5));
  camera.position.lerp(vCamera, blend);
  lookAt.lerp(vTarget, snap ? 1 : 1 - Math.exp(-dt * 7));
  if (settings.shake && !paused) {
    const jet = Math.max(...s.boosterLevels, s.rearBoost) * 0.012;
    camera.position.x += (Math.random() - 0.5) * (shake + jet);
    camera.position.y += (Math.random() - 0.5) * (shake + jet);
  }
  camera.lookAt(lookAt);
  camera.fov = THREE.MathUtils.lerp(
    camera.fov,
    (isFactory ? (mobile ? 60 : 58) : mobile ? 55 : 48) + Math.min(9, speed * 0.12),
    Math.min(1, dt * 3),
  );
  camera.updateProjectionMatrix();
  cameraVisibility?.update(camera, car.group, dt);
}
function finish(s) {
  resultShown = true;
  input.enabled = false;
  input.clear();
  let best = records[LEVELS[selected].id];
  if (s.outcome === "success") {
    best = Math.min(best || Infinity, s.time);
    records[LEVELS[selected].id] = best;
    saveStorage("roadster-records", records);
    audio.chime();
    vibrate([45, 70, 100]);
  }
  audio.finish(s.outcome);
  ui.result(s, LEVELS[selected], best);
}
let resizeTimer;
function resize() {
  const previousWidth = viewport.width;
  refreshGameViewport();
  if (previousWidth !== viewport.width) {
    input.clear();
    pointer.down = false;
  }
  camera.aspect = viewport.width / viewport.height;
  camera.updateProjectionMatrix();
  // Browser chrome and rotation can emit a burst of viewport events. Resize
  // the GPU buffers once after they settle; CSS still responds immediately.
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(configureGraphics, 120);
}
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.addEventListener("install-help", (e) => {
  if (mode === "game") {
    paused = true;
    input.enabled = false;
    input.clear();
  }
  ui.modal(
    `<p class="eyebrow">YOUR POCKET LAUNCHPAD</p><h2 id="dialog-title">${e.detail.title}</h2><p class="install-instructions">${e.detail.instructions}</p><p class="install-instructions">Once the game has loaded online, all four tests are available offline.</p><button class="primary-button wide" data-action="close">Got it</button>`,
  );
});
window.addEventListener("pwa-installed", () =>
  ui.toast("Roadster installed. Ready for takeoff."),
);
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  graphicsLost = true;
  graphicsLosses++;
  paused = true;
  input.enabled = false;
  input.clear();
  pointer.down = false;
  audio.setPaused(true);
  settings.safeGraphics = true;
  saveStorage("roadster-settings", settings);
  graphics.dispose();
  // Release GPU-generated targets before the context is replaced. WebKit
  // rejects deleting native objects from the previous context after restore.
  scene.environment = null;
  environmentTarget?.dispose();
  environmentTarget = null;
  scene.traverse((object) => {
    if (!object.shadow) return;
    object.shadow.map?.dispose();
    object.shadow.map = null;
    object.shadow.mapPass?.dispose();
    object.shadow.mapPass = null;
  });
  ui.graphicsRecovery("restoring");
  clearTimeout(graphicsRecoveryTimer);
  graphicsRecoveryTimer = setTimeout(() => {
    if (graphicsLost) ui.graphicsRecovery("failed");
  }, 10000);
});
renderer.domElement.addEventListener("webglcontextrestored", () => {
  clearTimeout(graphicsRecoveryTimer);
  if (graphicsLosses >= 3) {
    ui.graphicsRecovery("failed");
    return;
  }
  try {
    // Three recreates its GL state first. Recovery keeps reflections disabled
    // in compatibility mode instead of recreating the same half-float targets.
    graphics.restore(graphicsOptions());
    rebuildReflections();
    resizeEffects();
    graphicsLost = false;
    lastFrame = performance.now();
    ui.graphicsRecovery("restored", mode === "game" && !resultShown);
  } catch (error) {
    console.error("Graphics restoration failed", error);
    ui.graphicsRecovery("failed");
  }
});
setupPWA();
home();
// Install loss handlers and apply the render budget before any reflection pass.
rebuildReflections();
const linkedLevel = LEVELS.findIndex(
  (level) => level.id === new URLSearchParams(location.search).get("test"),
);
if (linkedLevel >= 0) ui.select(linkedLevel);
setTimeout(() => {
  document.querySelector("#loading").classList.add("done");
  setTimeout(() => document.querySelector("#loading")?.remove(), 700);
}, 450);

let nextRenderAt = 0;
function animate(now) {
  requestAnimationFrame(animate);
  audio.setPaused(paused || document.hidden || windowBlurred || graphicsLost);
  if (document.hidden || graphicsLost) {
    lastFrame = now;
    nextRenderAt = 0;
    return;
  }
  // A 120 Hz phone should not render twice as many pixels for the same game.
  // Menus and paused scenes also need less GPU time and generate less heat.
  if (mobileGraphics) {
    if (now + 0.5 < nextRenderAt) return;
    const frameLimit = mode === "game" && !paused && !windowBlurred ? 60 : 30;
    nextRenderAt = Math.max(nextRenderAt + 1000 / frameLimit, now);
  }
  const frameMs = now - lastFrame;
  const dt = Math.min(frameMs / 1000, 0.05);
  lastFrame = now;
  totalTime += dt;
  if (mode === "game" && !paused && !windowBlurred && countdown <= 0 && !resultShown && graphics.observeFrame(frameMs)) resizeEffects();
  if (!paused) {
    shake *= Math.exp(-dt * 8);
    impactFlash *= Math.exp(-dt * 5);
    blastFlash *= Math.exp(-dt * 12);
  }
  document
    .querySelector(".impact-vignette")
    .style.setProperty("--impact", impactFlash);
  document
    .querySelector(".explosion-flash")
    .style.setProperty("--blast", blastFlash);
  if (mode === "game") {
    // Bank an airborne course finish immediately: a completed flight should
    // not coast into the roof while its result card is opening.
    const courseComplete = LEVELS[selected].id === "factory" && physics.outcome === "success";
    if (!paused && !resultShown) {
      if (countdown > 0) {
        countdown -= dt;
        if (countdown <= 0) {
          input.enabled = true;
          ui.messageForInput(
            LEVELS[selected].id === "ramp" ? "AUTO DRIVE · Ready your Q + W jets." : "Your move.",
            LEVELS[selected].touchHint,
          );
        }
      } else if (!courseComplete) physics.step(dt, input.state);
    } else if (resultShown && !paused && !courseComplete) {
      physics.step(dt, {});
    }
    let state = physics.state;
    if (!paused && !resultShown && !state.outcome && state.recoveryReady) {
      reset();
      state = physics.state;
      ui.message("Back on four wheels. A minor orientation issue.");
    }
    updateCar(state, paused ? 0 : dt);
    for (const event of pendingImpacts) {
      car.applyImpact(event);
      wreck.onImpact(event);
    }
    pendingImpacts.length = 0;
    if (state.crashed && !wreckStarted) {
      wreckStarted = true;
      // Detach actual car parts first, so the same physical blast catches them
      // and the level's loose objects. The rigid shell keeps tumbling afterward.
      wreck.explode(state);
      physics.explode();
      state = physics.state;
      audio.explosion();
      shake = 1.15;
      blastFlash = reducedMotion ? 0.12 : 0.68;
      impactFlash = 0.6;
      input.enabled = false;
      input.clear();
      ui.message(
        "Thermal runaway. An ambitious interpretation of launch control.",
        4800,
      );
      vibrate([120, 60, 180, 80, 80]);
    }
    physics.setMissingWheels(car.wheels.map((wheel) => !wheel.visible));
    rivalPresentation?.update(paused ? 0 : dt);
    environment?.update(paused ? 0 : dt);
    effects.update(paused ? 0 : dt, state);
    wreck.update(paused ? 0 : dt, state);
    audio.update(state, !paused && (!resultShown || state.crashed));
    hudTick += dt;
    if (hudTick > 0.04) {
      ui.update(
        finishState ? { ...state, time: finishState.time } : state,
        LEVELS[selected],
      );
      hudTick = 0;
    }
    if (!paused && !resultShown) {
      if (state.altitude > 4 && !airMessage && !wreckStarted && LEVELS[selected].id !== "factory") {
        airMessage = true;
        ui.message("You are now an aviation problem.");
      }
      if (state.ringCount > lastRingCount && !state.crashed) {
        lastRingCount = state.ringCount;
        audio.ringPass(state.ringCount);
        vibrate([25, 35, 40]);
        ui.message(state.outcome === "success"
          ? "Five rings. Factory flight certified."
          : `${state.ringCount} / ${state.ringGoal} rings. Keep it airborne.`);
      }
      if (
        state.rampStage === "airborne" &&
        !physics._uiAirborneNotified &&
        !wreckStarted
      ) {
        physics._uiAirborneNotified = true;
        ui.messageForInput("Q + W · Rotate. O + P · Catch it.", "Nose up · Rotate. Tail up · Catch it.");
      }
      if (state.time < 0.1) physics._uiAirborneNotified = false;
      if (
        settings.haptics &&
        Math.max(...state.boosterLevels, state.rearBoost) > 0.3 &&
        now - lastHaptic > 160
      ) {
        lastHaptic = now;
        vibrate(12);
      }
      if (state.outcome && !outcomeAt) {
        outcomeAt = now;
        finishState = { ...state };
        input.enabled = false;
        input.clear();
        aftermathTime = 0;
      }
      if (outcomeAt) aftermathTime += dt;
      if (
        outcomeAt &&
        aftermathTime >
          (state.outcome === "success" ? 0.65 : wreckStarted ? 5.2 : 1.8)
      )
        finish(finishState || state);
    }
  } else {
    car.update(dt, { speed: 0, steer: 0, boosters: [0, 0, 0, 0] });
    audio.update({}, false);
  }
  updateCamera(dt);
  graphics.render();
  if (import.meta.env.DEV) {
    frameCount++;
    fpsSum += dt;
    if (fpsSum > 1) {
      window.__roadster.fps = Math.round(frameCount / fpsSum);
      frameCount = 0;
      fpsSum = 0;
    }
  }
}
if (import.meta.env.DEV)
  window.__roadster = {
    physics,
    car,
    scene,
    camera,
    renderer,
    graphics,
    get environment() { return environment; },
    get rivalPresentation() { return rivalPresentation; },
    get cameraVisibility() { return cameraVisibility; },
    get graphicsLost() { return graphicsLost; },
    get graphicsLosses() { return graphicsLosses; },
    ui,
    input,
    effects,
    wreck,
    audio,
    settings,
    viewport,
    startLevel,
    home,
    reset,
    get mode() {
      return mode;
    },
    get paused() {
      return paused;
    },
    get selected() {
      return selected;
    },
    get frame() {
      return totalTime;
    },
    fps: 0,
  };
requestAnimationFrame(animate);
