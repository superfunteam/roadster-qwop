import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FACTORY_RINGS } from "./flight-course.js";
import { INVERSION_APRON } from "./inversion-course.js";

// All dimensions are metres. The track and its collision surfaces share one path.
export const RAMP = {
  radius: 12,
  entryZ: 42,
  width: 10,
  thickness: 0.35,
  segments: 96,
};

export function buildEnvironment(level, scene, physics) {
  const id =
    {
      0: "garage",
      1: "drag",
      2: "ramp",
      3: "factory",
      dragstrip: "drag",
      strip: "drag",
      loop: "ramp",
    }[level] || level;
  const group = new THREE.Group();
  group.name = `${id}-environment`;
  scene.add(group);
  const props = [];
  const animations = [];
  const animatedRoots = new Set();
  const rings = [];
  const textures = new Set();
  const geometries = new Set();
  const materials = new Set();
  const materialCache = new Map();
  let elapsed = 0;
  let seed = 34251;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const material = (color, roughness = 0.72, metalness = 0, extra = {}) => {
    const key = [
      color,
      roughness,
      metalness,
      ...Object.entries(extra).flatMap(([k, v]) => [k, v?.uuid || v]),
    ].join("|");
    if (materialCache.has(key)) return materialCache.get(key);
    const value = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      ...extra,
    });
    materials.add(value);
    materialCache.set(key, value);
    return value;
  };
  const standard = {
    concrete: material("#b1afa8", 0.95),
    black: material("#101315", 0.63),
    metal: material("#747b7e", 0.36, 0.8),
    darkMetal: material("#252a2c", 0.47, 0.72),
    white: material("#e2e2dd", 0.78),
    red: material("#be2028", 0.46, 0.22),
    wood: material("#8c6d4c", 0.9),
    asphalt: material("#272a2b", 0.98),
    glass: material("#32414a", 0.16, 0.7),
    line: material("#d6d7ce", 0.86),
    soil: material("#9c886c", 1),
    rubber: material("#16191a", 0.95),
  };
  function mesh(
    geometry,
    mat,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    parent = group,
    cast = true,
  ) {
    geometries.add(geometry);
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(...position);
    object.rotation.set(...rotation);
    object.castShadow = cast;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(size, position, mat = standard.concrete, options = {}) {
    const rotation = options.rotation || [0, 0, 0];
    const object = mesh(
      new THREE.BoxGeometry(...size),
      mat,
      position,
      rotation,
      options.parent || group,
      options.cast !== false,
    );
    if (options.collider || options.mass) {
      const body = physics?.addBox?.({
        position,
        size,
        rotation,
        mass: options.mass || 0,
        friction: options.friction ?? 0.7,
        restitution: options.restitution ?? 0.13,
        label: options.label || "scenery",
      });
      if (options.mass && body)
        props.push({ mesh: object, body, kind: options.label || "prop" });
    }
    return object;
  }
  function cylinder(radius, height, position, mat, options = {}) {
    return mesh(
      new THREE.CylinderGeometry(
        radius,
        options.bottomRadius ?? radius,
        height,
        options.segments || 16,
      ),
      mat,
      position,
      options.rotation || [0, 0, 0],
      options.parent || group,
      options.cast !== false,
    );
  }
  function beam(a, b, radius, mat = standard.metal, parent = group) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const object = mesh(
      new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 6),
      mat,
      start.clone().add(end).multiplyScalar(0.5).toArray(),
      [0, 0, 0],
      parent,
    );
    object.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.sub(start).normalize(),
    );
    return object;
  }
  function texture(size, draw, repeat = [1, 1]) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
    tex.anisotropy = 8;
    textures.add(tex);
    return tex;
  }
  function surfaceTexture(base, grain = 12, repeat = [1, 1], joints = false) {
    return texture(
      512,
      (ctx, s) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, s, s);
        // Broad, low-contrast mottling underneath the aggregate prevents flat diffuse slabs.
        for (let i = 0; i < 70; i++) {
          const x = rand() * s,
            y = rand() * s,
            radius = 25 + rand() * 110;
          const tone = i % 3 ? "0,0,0" : "255,255,255";
          const wash = ctx.createRadialGradient(x, y, 0, x, y, radius);
          wash.addColorStop(0, `rgba(${tone},${0.015 + rand() * 0.024})`);
          wash.addColorStop(1, `rgba(${tone},0)`);
          ctx.fillStyle = wash;
          ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        for (let i = 0; i < 26000; i++) {
          const v = Math.floor(rand() * grain);
          ctx.fillStyle = `rgba(${v > grain / 2 ? "255,255,255" : "0,0,0"},${0.018 + rand() * (0.025 + grain * 0.0018)})`;
          const n = 1 + rand() * 2;
          ctx.fillRect(rand() * s, rand() * s, n, n);
        }
        if (joints) {
          ctx.strokeStyle = "rgba(30,32,32,.2)";
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, s - 2, s - 2);
          ctx.strokeStyle = "rgba(255,255,255,.1)";
          ctx.lineWidth = 1;
          ctx.strokeRect(3, 3, s - 6, s - 6);
        }
      },
      repeat,
    );
  }
  function label(text, width, height, options = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.max(96, Math.round((1024 * height) / width));
    const ctx = canvas.getContext("2d");
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = options.color || "#f4f4f0";
    ctx.font = `${options.weight || 500} ${options.fontSize || Math.round(canvas.height * 0.48)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const letters = [...text],
      spacing = options.spacing ?? canvas.height * 0.06;
    const textWidth =
      letters.reduce((sum, letter) => sum + ctx.measureText(letter).width, 0) +
      spacing * (letters.length - 1);
    let x = (canvas.width - textWidth) / 2;
    for (const letter of letters) {
      ctx.textAlign = "left";
      ctx.fillText(letter, x, canvas.height * 0.52);
      x += ctx.measureText(letter).width + spacing;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.add(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: !options.background,
      side: THREE.DoubleSide,
      depthWrite: !!options.background,
      toneMapped: false,
    });
    materials.add(mat);
    return mesh(
      new THREE.PlaneGeometry(width, height),
      mat,
      options.position,
      options.rotation,
      options.parent || group,
      false,
    );
  }
  function groundMark(
    text,
    position,
    width = 5,
    height = 1.5,
    color = "#ededdf",
  ) {
    return label(text, width, height, {
      position,
      rotation: [-Math.PI / 2, 0, Math.PI],
      color,
      weight: 600,
      spacing: 8,
    });
  }
  function lights(night = false) {
    scene.background = new THREE.Color(night ? "#080b11" : "#d5d9da");
    scene.fog = new THREE.Fog(
      night ? "#080b11" : "#d5d9da",
      night ? 80 : 150,
      night ? 340 : 800,
    );
    const hemi = new THREE.HemisphereLight(
      night ? "#7995c2" : "#e1edff",
      night ? "#202124" : "#786b53",
      night ? 1.1 : 1.9,
    );
    group.add(hemi);
    const sun = new THREE.DirectionalLight(
      night ? "#c5ddff" : "#ffe6c5",
      night ? 1.35 : 3.2,
    );
    sun.position.set(night ? -45 : -28, night ? 48 : 38, night ? 10 : -18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 180;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -45;
    sun.shadow.camera.right = sun.shadow.camera.top = 45;
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    group.add(sun);
    group.add(sun.target);
    if (id === "drag" || id === "factory") {
      animations.push(() => {
        const car = physics?.carBody || physics?.body;
        const p =
          typeof car?.translation === "function"
            ? car.translation()
            : car?.position;
        if (p) {
          sun.position.z = p.z - 22;
          sun.target.position.z = p.z + 8;
        }
      });
    }
    return { sun, hemi };
  }
  function plant(x, z, scale = 1, dry = false) {
    const mat = dry ? material("#7e7c52", 1) : material("#536148", 1);
    for (let i = 0; i < 3; i++) {
      mesh(
        new THREE.IcosahedronGeometry((0.42 + i * 0.1) * scale, 0),
        mat,
        [x + (rand() - 0.5) * 0.5, 0.3 * scale, z + (rand() - 0.5) * 0.5],
        [rand(), rand(), rand()],
        group,
        false,
      ).scale.y = 0.65;
    }
  }
  function distantHills(night = false) {
    // A continuous, softly eroded horizon avoids floating low-poly backdrop props.
    const terrain = new THREE.PlaneGeometry(1600, 1800, 88, 96);
    terrain.rotateX(-Math.PI / 2);
    const positions = terrain.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const nearColor = new THREE.Color(
      night ? "#141b23" : id === "garage" ? "#62704f" : "#aaa18b",
    );
    const highColor = new THREE.Color(
      night ? "#293140" : id === "garage" ? "#929a87" : "#b3afa1",
    );
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        z = positions.getZ(i);
      const distance = Math.hypot(x, z * (id === "drag" ? 0.38 : 0.9));
      const rise = THREE.MathUtils.smoothstep(distance, 140, 360);
      const wave =
        25 +
        Math.sin(x * 0.013 + 0.4) * 10 +
        Math.sin(z * 0.017) * 12 +
        Math.sin((x + z) * 0.029) * 6 +
        Math.sin((x - z) * 0.043) * 3;
      const height = rise * wave - 0.38;
      positions.setY(i, height);
      const c = nearColor
        .clone()
        .lerp(highColor, THREE.MathUtils.clamp(height / 40, 0, 1));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    terrain.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    const terrainMesh = mesh(
      terrain,
      material("#ffffff", 1, 0, { vertexColors: true }),
      [0, 0, id === "drag" ? 240 : 25],
      [0, 0, 0],
      group,
      false,
    );
    terrainMesh.userData.cameraGround = true;
  }
  function pole(x, z, height = 8, night = false) {
    cylinder(0.08, height, [x, height / 2, z], standard.darkMetal, {
      segments: 8,
    });
    beam(
      [x, height, z],
      [x + (x < 0 ? 1 : -1) * 1.4, height, z],
      0.07,
      standard.darkMetal,
    );
    box(
      [1.1, 0.13, 0.45],
      [x + (x < 0 ? 1 : -1) * 1.3, height, z],
      standard.darkMetal,
    );
    box(
      [0.9, 0.025, 0.32],
      [x + (x < 0 ? 1 : -1) * 1.3, height - 0.08, z],
      material(night ? "#d8e8ff" : "#faf4e7", 0.3, 0, {
        emissive: night ? "#c2dbff" : "#aaa79c",
        emissiveIntensity: night ? 4 : 0.25,
      }),
      { cast: false },
    );
  }
  function cone(x, z, scale = 1) {
    const assembly = new THREE.Group();
    assembly.position.set(x, 0.39 * scale, z);
    group.add(assembly);
    const orange = material("#de5a20", 0.7);
    box(
      [0.52 * scale, 0.07 * scale, 0.52 * scale],
      [0, -0.35 * scale, 0],
      standard.rubber,
      { parent: assembly },
    );
    cylinder(0.035 * scale, 0.63 * scale, [0, 0, 0], orange, {
      bottomRadius: 0.2 * scale,
      parent: assembly,
    });
    cylinder(0.09 * scale, 0.13 * scale, [0, 0.06 * scale, 0], standard.white, {
      bottomRadius: 0.127 * scale,
      parent: assembly,
    });
    const body = physics?.addBox?.({
      position: [x, 0.39 * scale, z],
      size: [0.42 * scale, 0.78 * scale, 0.42 * scale],
      mass: 3,
      friction: 0.7,
      label: "cone",
    });
    if (body) props.push({ mesh: assembly, body, kind: "cone" });
  }
  function carton(
    position,
    size = [0.55, 0.5, 0.55],
    mass = 7,
    tone = "#b79b74",
  ) {
    const cardboard = material(tone, 0.96);
    const assembly = new THREE.Group();
    assembly.position.set(...position);
    group.add(assembly);
    box(size, [0, 0, 0], cardboard, { parent: assembly });
    const tape = material("#c7b58a", 0.7);
    box([size[0] + 0.006, 0.013, 0.09], [0, size[1] / 2 + 0.005, 0], tape, {
      parent: assembly,
      cast: false,
    });
    box([0.08, 0.013, size[2] + 0.008], [0, size[1] / 2 + 0.006, 0], tape, {
      parent: assembly,
      cast: false,
    });
    for (const side of [-1, 1]) {
      box(
        [0.08, size[1] + 0.008, 0.009],
        [0, 0, side * (size[2] / 2 + 0.005)],
        tape,
        { parent: assembly, cast: false },
      );
      box(
        [0.009, size[1] + 0.008, 0.085],
        [side * (size[0] / 2 + 0.005), 0, 0],
        tape,
        { parent: assembly, cast: false },
      );
      box(
        [0.19, 0.12, 0.006],
        [size[0] * 0.19, 0.015, side * (size[2] / 2 + 0.01)],
        standard.white,
        { parent: assembly, cast: false },
      );
      for (let i = 0; i < 6; i++)
        box(
          [0.006 + (i % 3) * 0.002, 0.055, 0.008],
          [
            size[0] * 0.19 - 0.06 + i * 0.023,
            0.01,
            side * (size[2] / 2 + 0.014),
          ],
          standard.black,
          { parent: assembly, cast: false },
        );
      const scuff = material("#8d7757", 0.98);
      for (let i = 0; i < 4; i++)
        box(
          [0.025 + rand() * 0.055, 0.005 + rand() * 0.007, 0.003],
          [
            (rand() - 0.5) * size[0] * 0.75,
            -size[1] * 0.34 + rand() * size[1] * 0.12,
            side * (size[2] / 2 + 0.004),
          ],
          scuff,
          {
            parent: assembly,
            cast: false,
            rotation: [0, 0, (rand() - 0.5) * 0.4],
          },
        );
    }
    box(
      [0.2, 0.13, 0.006],
      [-size[0] * 0.2, -0.02, size[2] / 2 + 0.01],
      standard.white,
      { parent: assembly, cast: false },
    );
    for (let i = 0; i < 6; i++)
      box(
        [0.008 + (i % 2) * 0.003, 0.065, 0.008],
        [-size[0] * 0.2 - 0.06 + i * 0.023, -0.035, size[2] / 2 + 0.014],
        standard.black,
        { parent: assembly, cast: false },
      );
    const body = physics?.addBox?.({
      position,
      size,
      mass,
      friction: 0.62,
      restitution: 0.18,
      label: "carton",
    });
    if (body) props.push({ mesh: assembly, body, kind: "carton" });
  }
  function bin(position, color = "#3c4c52") {
    const g = new THREE.Group();
    g.position.set(...position);
    group.add(g);
    const mat = material(color, 0.66);
    box([0.72, 0.48, 0.5], [0, 0, 0], mat, { parent: g });
    box([0.77, 0.045, 0.54], [0, 0.255, 0], standard.black, { parent: g });
    for (const side of [-1, 1])
      box([0.11, 0.055, 0.025], [side * 0.24, 0.15, 0.26], standard.black, {
        parent: g,
      });
    const body = physics?.addBox?.({
      position,
      size: [0.77, 0.55, 0.54],
      mass: 11,
      label: "storage bin",
    });
    if (body) props.push({ mesh: g, body, kind: "storage bin" });
  }
  function can(position, color = "#ccccbc") {
    const g = new THREE.Group();
    g.position.set(...position);
    group.add(g);
    cylinder(0.14, 0.29, [0, 0, 0], material(color, 0.45, 0.15), {
      parent: g,
      segments: 12,
    });
    cylinder(0.148, 0.022, [0, 0.155, 0], standard.metal, {
      parent: g,
      segments: 12,
    });
    cylinder(0.148, 0.018, [0, -0.15, 0], standard.metal, {
      parent: g,
      segments: 12,
    });
    const body = physics?.addBox?.({
      position,
      size: [0.3, 0.33, 0.3],
      mass: 2.7,
      label: "paint can",
    });
    if (body) props.push({ mesh: g, body, kind: "paint can" });
  }
  function goalPad(z, width = 6, text = "CLEAR", night = false) {
    const green = material(night ? "#91b8a0" : "#748d79", 0.72, 0.1, {
      emissive: "#4a8c5c",
      emissiveIntensity: night ? 0.45 : 0.1,
    });
    box([width, 0.025, 0.07], [0, 0.025, z - 2.1], green, { cast: false });
    box([width, 0.025, 0.07], [0, 0.025, z + 2.1], green, { cast: false });
    box([0.07, 0.025, 4.2], [-width / 2, 0.025, z], green, { cast: false });
    box([0.07, 0.025, 4.2], [width / 2, 0.025, z], green, { cast: false });
    groundMark(
      text,
      [0, 0.045, z],
      width * 0.7,
      1.0,
      night ? "#b0c6b8" : "#788c7b",
    );
  }

  let spawn = [0, 0.73, 0],
    goal,
    lighting;
  if (id === "garage") {
    lighting = lights(false);
    const floorMap = surfaceTexture("#bcbcb4", 15, [5, 6], true);
    const floorHeight = floorMap.clone();
    floorHeight.colorSpace = THREE.NoColorSpace;
    textures.add(floorHeight);
    const floor = material("#c5c4bb", 0.95, 0, {
      map: floorMap,
      bumpMap: floorHeight,
      bumpScale: 0.014,
      roughnessMap: floorHeight,
    });
    const driveway = material("#989a94", 0.95, 0, {
      map: surfaceTexture("#9e9f99", 16, [4, 12], true),
    });
    const wall = material("#e4e1d7", 0.95);
    const woodMap = texture(
      512,
      (ctx, s) => {
        ctx.fillStyle = "#947352";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 380; i++) {
          const y = rand() * s;
          ctx.strokeStyle = `rgba(${i % 3 ? "50,26,12" : "228,194,145"},${0.045 + rand() * 0.09})`;
          ctx.lineWidth = 0.4 + rand() * 1.3;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(
            s * 0.3,
            y + rand() * 7,
            s * 0.7,
            y - rand() * 7,
            s,
            y + (rand() - 0.5) * 3,
          );
          ctx.stroke();
        }
      },
      [2, 1],
    );
    const timber = material("#ffffff", 0.82, 0, { map: woodMap });
    const grass = material("#65724d", 1, 0, {
      map: surfaceTexture("#68774c", 35, [25, 25]),
    });
    box([150, 1, 150], [0, -0.7, 20], grass, { collider: true, cast: false });
    box([10.6, 0.3, 13], [0, -0.15, 1], floor, { collider: true, cast: false });
    box([8, 0.18, 35], [0, -0.09, 24], driveway, {
      collider: true,
      cast: false,
    });
    for (const x of [-5.25, 5.25]) {
      box([0.24, 3.15, 12.5], [x, 1.575, 0.75], wall, { collider: true });
      box(
        [0.12, 0.14, 12.5],
        [x - Math.sign(x) * 0.14, 0.12, 0.75],
        standard.white,
      );
      box([0.32, 0.22, 12.7], [x, 3.08, 0.75], timber);
    }
    // A single-sided back wall is an intentional architectural cutaway for the chase camera.
    mesh(new THREE.PlaneGeometry(10.6, 2.8), wall, [0, 1.4, -5.27]);
    physics?.addBox?.({
      position: [0, 1.4, -5.4],
      size: [10.6, 2.8, 0.25],
      label: "garage wall",
    });
    mesh(new THREE.PlaneGeometry(10.6, 0.17), timber, [0, 2.8, -5.23]);
    // Open roof / structural beams leave a clear game camera while keeping architectural depth.
    for (const z of [-4.8, -0.8, 3.2])
      for (const x of [-4.05, 4.05])
        box([2.5, 0.18, 0.2], [x, 3.32, z], timber);
    box([10.4, 0.18, 0.2], [0, 3.32, 6.8], timber);
    for (const x of [-3.35, 3.35]) {
      box([0.11, 0.1, 11.8], [x, 3.15, 1], standard.metal);
      box([0.06, 0.14, 2], [x, 2.48, 6.9], standard.metal, {
        rotation: [Math.PI / 2, 0, 0],
      });
    }
    // Raised sectional door with thin panel seams, opening onto the driveway.
    box([6.5, 0.13, 2.1], [0, 3.08, 5.98], material("#c1c1b8", 0.66, 0.1));
    for (let i = 0; i < 5; i++)
      box(
        [6.46, 0.018, 0.025],
        [0, 2.999, 5.05 + i * 0.44],
        standard.darkMetal,
      );
    for (const x of [-4.35, 4.35])
      box([1.8, 3.6, 0.4], [x, 1.8, 7.15], wall, { collider: true });
    box([10.6, 0.55, 0.5], [0, 3.45, 7.15], wall);
    // Slim windows catch the late-afternoon sky.
    for (const z of [-2.5, 1.2, 4.8]) {
      box([0.035, 0.86, 1.7], [-5.105, 2.27, z], standard.darkMetal);
      box(
        [0.045, 0.72, 1.55],
        [-5.075, 2.27, z],
        material("#becbd0", 0.12, 0.7, {
          emissive: "#a9b9c3",
          emissiveIntensity: 0.2,
        }),
      );
      box([0.055, 0.74, 0.035], [-5.045, 2.27, z], standard.white);
    }
    // Industrial shelving: open steel uprights and separately simulated contents.
    for (const side of [-1, 1]) {
      const x = side * 4.55;
      for (const z of [-3.6, 1.0, 4.55]) {
        const length = z === 4.55 ? 1.6 : 2.4;
        for (const xx of [-0.4, 0.4])
          for (const zz of [-length / 2, length / 2])
            box(
              [0.055, 2.35, 0.055],
              [x + xx, 1.175, z + zz],
              standard.darkMetal,
              { collider: true },
            );
        for (const y of [0.18, 0.91, 1.64, 2.3]) {
          box([0.91, 0.045, length + 0.1], [x, y, z], standard.metal, {
            collider: true,
          });
          box(
            [0.035, 0.12, length + 0.1],
            [x - side * 0.43, y - 0.045, z],
            standard.darkMetal,
          );
        }
        for (let shelf = 0; shelf < 3; shelf++) {
          const y = [0.18, 0.91, 1.64][shelf];
          for (let j = 0; j < (length > 2 ? 3 : 2); j++) {
            const zz = z - length * 0.32 + j * 0.68;
            if ((shelf + j + (side > 0 ? 1 : 0)) % 3 === 0)
              bin([x, y + 0.28, zz], shelf % 2 ? "#566169" : "#35454b");
            else
              carton(
                [x, y + 0.26, zz],
                [0.56, 0.48, 0.55],
                5 + rand() * 4,
                ["#bba17b", "#a88d65", "#c4ae8b"][j % 3],
              );
          }
        }
      }
    }
    // The workshop sits to one side of the chase camera's clear line to the car.
    const benchShift = -3.15;
    box([3.05, 0.12, 0.85], [0.7 + benchShift, 0.98, -4.72], timber, {
      collider: true,
    });
    for (const x of [-0.45 + benchShift, 1.85 + benchShift]) {
      box([0.65, 0.88, 0.72], [x, 0.44, -4.7], standard.darkMetal, {
        collider: true,
      });
      for (let i = 0; i < 4; i++) {
        box(
          [0.61, 0.17, 0.025],
          [x, 0.15 + i * 0.2, -4.32],
          material("#4d5150", 0.55, 0.4),
        );
        box([0.3, 0.025, 0.035], [x, 0.2 + i * 0.2, -4.294], standard.metal);
      }
    }
    box(
      [2.9, 1.2, 0.055],
      [0.7 + benchShift, 1.93, -5.22],
      material("#555c59", 0.87),
    );
    for (let i = 0; i < 22; i++)
      for (let j = 0; j < 8; j++)
        mesh(
          new THREE.PlaneGeometry(0.018, 0.018),
          standard.black,
          [-0.64 + benchShift + i * 0.127, 1.45 + j * 0.137, -5.179],
          [0, 0, 0],
          group,
          false,
        );
    for (let i = 0; i < 7; i++) {
      const x = -0.3 + benchShift + i * 0.27;
      beam(
        [x, 1.7, -5.12],
        [x, 2.12 + (i % 2) * 0.1, -5.12],
        0.021,
        standard.metal,
      );
      if (i % 2) box([0.15, 0.045, 0.06], [x, 2.13, -5.12], standard.metal);
      else
        cylinder(0.055, 0.025, [x, 2.15, -5.12], standard.metal, {
          rotation: [Math.PI / 2, 0, 0],
          segments: 8,
        });
    }
    box([0.18, 0.19, 0.25], [1.62 + benchShift, 1.14, -4.65], standard.metal);
    beam(
      [1.4 + benchShift, 1.13, -4.45],
      [1.85 + benchShift, 1.13, -4.45],
      0.018,
      standard.metal,
    );
    for (let i = 0; i < 3; i++)
      can(
        [-0.35 + benchShift + i * 0.33, 1.2, -4.6],
        ["#b4aea0", "#b23c36", "#364c54"][i],
      );
    // Wall connector and coiled cable, a recognisable Tesla garage detail.
    const charger = new THREE.Group();
    charger.position.set(-5.0, 1.5, 2.9);
    charger.rotation.y = Math.PI / 2;
    group.add(charger);
    box([0.32, 0.55, 0.13], [0, 0, 0], standard.white, { parent: charger });
    box([0.022, 0.32, 0.015], [0, 0.015, 0.074], standard.black, {
      parent: charger,
    });
    box(
      [0.018, 0.15, 0.02],
      [0, 0.11, 0.085],
      material("#9bf2a3", 0.3, 0, {
        emissive: "#52bf74",
        emissiveIntensity: 1.5,
      }),
      { parent: charger },
    );
    const cordPoints = [
      new THREE.Vector3(0.07, -0.22, 0),
      new THREE.Vector3(0.35, -0.65, 0.02),
      new THREE.Vector3(0.2, -0.99, 0.05),
      new THREE.Vector3(-0.25, -0.87, 0.05),
      new THREE.Vector3(-0.25, -0.51, 0.03),
      new THREE.Vector3(0.22, -0.5, 0.03),
    ];
    mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(cordPoints),
        24,
        0.018,
        5,
        false,
      ),
      standard.rubber,
      [0, 0, 0.11],
      [0, 0, 0],
      charger,
    );
    // Bicycle leaning at the rear wall.
    const bike = new THREE.Group();
    bike.position.set(2.7, 0.38, -4.8);
    group.add(bike);
    const bikeBlue = material("#637984", 0.3, 0.65);
    for (const x of [-0.65, 0.65]) {
      mesh(
        new THREE.TorusGeometry(0.34, 0.035, 6, 32),
        standard.rubber,
        [x, 0, 0],
        [0, 0, 0],
        bike,
      );
      mesh(
        new THREE.TorusGeometry(0.302, 0.012, 5, 32),
        standard.metal,
        [x, 0, 0],
        [0, 0, 0],
        bike,
      );
      for (let i = 0; i < 12; i++)
        beam(
          [x, 0, 0],
          [
            x + Math.cos((i / 6) * Math.PI) * 0.3,
            Math.sin((i / 6) * Math.PI) * 0.3,
            0,
          ],
          0.003,
          standard.metal,
          bike,
        );
    }
    for (const [a, b] of [
      [
        [-0.65, 0, 0],
        [-0.24, 0.5, 0],
      ],
      [
        [-0.24, 0.5, 0],
        [0.05, 0.02, 0],
      ],
      [
        [0.05, 0.02, 0],
        [-0.65, 0, 0],
      ],
      [
        [-0.24, 0.5, 0],
        [0.43, 0.5, 0],
      ],
      [
        [0.43, 0.5, 0],
        [0.05, 0.02, 0],
      ],
      [
        [0.43, 0.5, 0],
        [0.65, 0, 0],
      ],
    ])
      beam(a, b, 0.024, bikeBlue, bike);
    beam([-0.24, 0.5, 0], [-0.29, 0.68, 0], 0.022, standard.metal, bike);
    box([0.27, 0.055, 0.15], [-0.29, 0.69, 0], standard.black, {
      parent: bike,
    });
    beam([0.43, 0.5, 0], [0.39, 0.76, 0], 0.022, standard.metal, bike);
    beam([0.39, 0.76, -0.17], [0.39, 0.76, 0.17], 0.021, standard.black, bike);
    // Aluminium ladder stored on right wall.
    const ladder = new THREE.Group();
    ladder.position.set(4.93, 1.3, -1.45);
    ladder.rotation.z = -0.13;
    group.add(ladder);
    for (const z of [-0.3, 0.3])
      box([0.065, 2.55, 0.055], [0, 0, z], standard.metal, { parent: ladder });
    for (let i = 0; i < 8; i++)
      box([0.06, 0.045, 0.64], [0, -1.09 + i * 0.31, 0], standard.metal, {
        parent: ladder,
      });
    // A small, deliberate amount of clutter in the escape path.
    carton([-2.7, 0.34, 4.75], [0.75, 0.66, 0.62], 9);
    carton([2.5, 0.25, 5.7], [0.61, 0.48, 0.65], 6);
    carton([2.49, 0.77, 5.7], [0.53, 0.5, 0.52], 4);
    bin([-3.35, 0.28, 6], "#46615b");
    cone(-2.5, 8.4);
    cone(2.5, 8.4);
    // Home exterior and landscape.
    box([5, 4.1, 10], [8.1, 2.05, 2.8], material("#c5c0b1", 0.9), {
      collider: true,
    });
    box([5.5, 0.25, 10.6], [8.1, 4.22, 2.8], standard.darkMetal);
    box([0.025, 1.6, 3.1], [5.585, 2.2, 2.8], standard.glass);
    for (const side of [-1, 1]) {
      box([0.16, 0.18, 28], [side * 4.18, 0.045, 23.2], standard.concrete);
      for (let i = 0; i < 11; i++)
        plant(side * (5.5 + rand() * 1.5), 10 + i * 2.8, 0.75 + rand() * 0.4);
      for (let i = 0; i < 7; i++)
        box([0.16, 1.25, 0.16], [side * 12, 0.625, 1 + i * 5.8], timber);
      for (const y of [0.4, 1.0])
        box([0.12, 0.14, 40], [side * 12, y, 18], timber);
    }
    // Street and curb beyond the driveway.
    box(
      [140, 0.16, 10],
      [0, -0.15, 43],
      material("#555957", 0.98, 0, {
        map: surfaceTexture("#5d605c", 15, [35, 3]),
      }),
      { collider: true, cast: false },
    );
    for (let x = -60; x < 60; x += 8)
      box([3.6, 0.016, 0.13], [x, -0.06, 43], standard.line, { cast: false });
    goalPad(24, 5.6, "PARK");
    goal = { position: [0, 0.73, 24], radius: 3.3, heading: 0 };
    distantHills(false);
  } else if (id === "drag") {
    lighting = lights(false);
    scene.background = new THREE.Color("#b5c3cb");
    scene.fog.color.set("#b5c3cb");
    box([230, 1, 850], [0, -0.58, 270], standard.soil, {
      collider: true,
      cast: false,
    });
    const asphaltMap = surfaceTexture("#404442", 30, [4, 145]);
    const asphaltHeight = asphaltMap.clone();
    asphaltHeight.colorSpace = THREE.NoColorSpace;
    textures.add(asphaltHeight);
    const asphalt = material("#ffffff", 0.93, 0, {
      map: asphaltMap,
      bumpMap: asphaltHeight,
      bumpScale: 0.018,
    });
    box([17, 0.16, 680], [3.2, -0.08, 285], asphalt, {
      collider: true,
      cast: false,
      friction: 1,
    });
    // Dark rubber launch lanes and tire streaks extend into the first hundred metres.
    const rubberMark = material("#282c2b", 0.9);
    for (const lane of [0, 6.4])
      for (const side of [-0.77, 0.77]) {
        box([0.44, 0.005, 135], [lane + side, 0.008, 65], rubberMark, {
          cast: false,
        });
        for (let i = 0; i < 4; i++)
          box(
            [0.035, 0.006, 130],
            [lane + side + (i - 1.5) * 0.09, 0.012, 65],
            standard.asphalt,
            { cast: false },
          );
      }
    for (const x of [-4.8, 3.2, 11.2])
      box([0.13, 0.016, 650], [x, 0.02, 285], standard.line, { cast: false });
    for (let z = -20; z <= 600; z += 5) {
      for (const x of [-5.5, 11.9])
        box(
          [0.65, 0.16, 5],
          [x, 0.03, z],
          z % 10 === 0 ? standard.red : standard.white,
          { cast: false },
        );
    }
    for (const x of [-6.3, 12.7]) {
      for (let z = -20; z < 610; z += 12) {
        box([0.46, 0.8, 11.8], [x, 0.4, z], standard.concrete, {
          collider: true,
        });
        box([0.65, 0.18, 11.8], [x, 0.09, z], standard.concrete);
        box(
          [0.09, 0.11, 0.25],
          [x - Math.sign(x) * 0.24, 0.61, z],
          material("#e5bb5c", 0.3, 0.3),
        );
      }
    }
    // Grid boxes, quarter-mile finish line and readable distance callouts.
    box([16.2, 0.02, 0.22], [3.2, 0.025, -2.5], standard.line, { cast: false });
    groundMark("01", [0, 0.035, -5], 2.7, 2.1);
    groundMark("02", [6.4, 0.035, -5], 2.7, 2.1);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 20; col++)
        box(
          [0.8, 0.018, 0.55],
          [-4.4 + col * 0.8, 0.025, 402 + row * 0.55],
          (col + row) % 2 ? standard.white : standard.black,
          { cast: false },
        );
    for (const z of [100, 200, 300])
      groundMark(`${z} M`, [0, 0.03, z], 2.5, 1.4, "#c9cbbf");
    // Drag racing Christmas tree.
    cylinder(0.1, 3.65, [3.2, 1.825, 4], standard.darkMetal);
    box([0.95, 2.35, 0.3], [3.2, 2.65, 4], standard.black);
    const glowMats = [];
    for (let row = 0; row < 6; row++)
      for (const side of [-1, 1]) {
        const color = row < 2 ? "#d9cba0" : row < 5 ? "#f4a52f" : "#4fb87a";
        const mat = material(color, 0.2, 0.15, {
          emissive: color,
          emissiveIntensity: row === 5 ? 1.5 : 0.45,
        });
        glowMats.push(mat);
        cylinder(
          0.12,
          0.08,
          [3.2 + side * 0.22, 3.55 - row * 0.35, 3.81],
          mat,
          { rotation: [Math.PI / 2, 0, 0] },
        );
      }
    label("PRE STAGE", 0.72, 0.12, {
      position: [3.2, 3.81, 3.83],
      fontSize: 60,
    });
    // Start line sponsor gantry.
    for (const x of [-7.4, 13.8])
      box([0.4, 6, 0.4], [x, 3, -16], standard.darkMetal);
    box([21.6, 1.5, 0.45], [3.2, 5.8, -16], standard.black);
    label("T E S L A", 7, 0.85, {
      position: [3.2, 5.85, -16.24],
      rotation: [0, Math.PI, 0],
      spacing: 22,
    });
    // Track buildings and grandstand, with individually modelled seat rows.
    box([10, 5.2, 21], [-22, 2.6, 12], material("#bab9af", 0.9), {
      collider: true,
    });
    box([10.6, 0.3, 21.6], [-22, 5.28, 12], standard.darkMetal);
    box([0.06, 1.3, 17.2], [-16.95, 3.83, 12], standard.glass);
    for (let z = 5; z < 22; z += 2.8)
      box([0.08, 1.4, 0.08], [-16.89, 3.83, z], standard.metal);
    label("ROADSTER / TEST FACILITY", 15, 0.8, {
      position: [-16.87, 2.25, 12],
      rotation: [0, Math.PI / 2, 0],
      color: "#24282b",
    });
    for (const centerZ of [65, 115, 165]) {
      for (let row = 0; row < 6; row++) {
        const x = 19 + row * 1.0;
        box([1.15, 0.2, 34], [x, 0.75 + row * 0.48, centerZ], standard.metal);
        box(
          [0.45, 0.16, 33],
          [x + 0.2, 1.02 + row * 0.48, centerZ],
          row % 3 ? standard.darkMetal : standard.red,
        );
        for (const z of [centerZ - 15, centerZ + 15])
          box(
            [0.11, 0.8 + row * 0.48, 0.11],
            [x, (0.8 + row * 0.48) / 2, z],
            standard.darkMetal,
          );
      }
      for (const z of [centerZ - 17, centerZ + 17])
        beam([18.7, 1.2, z], [24.7, 4, z], 0.045, standard.metal);
    }
    for (let z = -15; z < 550; z += 48) {
      pole(-9.5, z, 10);
      pole(16.5, z, 10);
    }
    for (let z = 50; z < 500; z += 70) {
      box([0.12, 1.9, 7], [-6.56, 1.8, z], standard.black);
      label(z % 140 === 50 ? "ROADSTER" : "T E S L A", 6.2, 1.0, {
        position: [-6.47, 1.9, z],
        rotation: [0, Math.PI / 2, 0],
        fontSize: 150,
        spacing: 13,
      });
    }
    // Thin chain-link fence stanchions, sparse desert scrub, low distant buildings.
    for (let z = -35; z < 620; z += 18) {
      cylinder(0.045, 2.3, [-13.8, 1.15, z], standard.metal, { segments: 5 });
      for (const y of [0.4, 1.3, 2.1])
        beam([-13.8, y, z], [-13.8, y, z + 18], 0.009, standard.metal);
      if (z % 3) plant(-20 - rand() * 55, z + rand() * 7, 0.8 + rand(), true);
      plant(32 + rand() * 45, z + rand() * 12, 0.7 + rand(), true);
    }
    for (let i = 0; i < 8; i++)
      box(
        [15 + rand() * 15, 5 + rand() * 6, 25 + rand() * 10],
        [-65 - rand() * 40, 2.3, 100 + i * 55],
        material(i % 2 ? "#9a9d96" : "#adada1", 1),
        { cast: false },
      );
    cone(-3.9, 3);
    cone(10.2, 3);
    for (const x of [-8.3, 14.7]) {
      box([0.26, 7, 0.26], [x, 3.5, 402], standard.darkMetal);
      box(
        [4.6, 2.4, 0.35],
        [x + (x < 0 ? -2.5 : 2.5), 6.6, 402],
        standard.black,
      );
      label("402 M", 3.8, 1.1, {
        position: [x + (x < 0 ? -2.5 : 2.5), 6.7, 401.8],
        rotation: [0, Math.PI, 0],
        color: "#ee493c",
        spacing: 20,
      });
    }
    goal = { position: [0, 0.73, 402], radius: 7, heading: 0 };
    distantHills(false);
  } else if (id === "factory") {
    lighting = lights(false);
    scene.background = new THREE.Color("#263744");
    scene.fog = new THREE.Fog("#263744", 165, 420);
    lighting.hemi.color.set("#b5d8ee");
    lighting.hemi.groundColor.set("#46505b");
    lighting.hemi.intensity = 2.25;
    lighting.sun.color.set("#d4eaff");
    lighting.sun.intensity = 2.8;
    const floor = material("#c5ccd0", 0.88, 0.09, {
      map: surfaceTexture("#697783", 10, [25, 45], true),
    });
    const shell = material("#76828d", 0.74, 0.2);
    const steel = material("#35434e", 0.52, 0.6);
    const paleSteel = material("#a3b0b8", 0.5, 0.45);
    const yellow = material("#e5b83f", 0.64, 0.08);
    const robotRed = material("#e43631", 0.43, 0.35);
    const cyan = new THREE.MeshBasicMaterial({ color: "#60e5ff", toneMapped: false });
    const stripLight = new THREE.MeshBasicMaterial({ color: "#d4edfa", toneMapped: false });
    materials.add(cyan);
    materials.add(stripLight);

    // A real, enclosed flight hall. Only the perimeter contains machinery: the
    // wide central bay gives a tumbling Roadster room to recover between gates.
    const hall = { minX: -100, maxX: 100, minZ: -30, maxZ: 330, height: 60 };
    const centerZ = (hall.minZ + hall.maxZ) / 2;
    const length = hall.maxZ - hall.minZ;
    const width = hall.maxX - hall.minX;
    box([width, 1, length], [0, -0.5, centerZ], floor, { collider: true, cast: false });
    for (const x of [hall.minX, hall.maxX]) {
      box([1, hall.height, length], [x, hall.height / 2, centerZ], shell, {
        collider: true, cast: false, label: "factory wall",
      });
      box([0.12, 2.2, length], [x - Math.sign(x) * 0.56, 1.1, centerZ], steel, { cast: false });
      box([0.15, 0.2, length], [x - Math.sign(x) * 0.6, 2.4, centerZ], yellow, { cast: false });
      for (let z = hall.minZ + 12; z < hall.maxZ; z += 24) {
        box([1.4, 58, 1.3], [x - Math.sign(x) * 1.1, 29, z], steel, { cast: false });
        // High clerestory panels read as daylight without expensive local lights.
        box([0.2, 10, 19], [x - Math.sign(x) * 0.7, 45, z], stripLight, { cast: false });
        box([0.25, 10.4, 0.22], [x - Math.sign(x) * 0.85, 45, z], paleSteel, { cast: false });
      }
    }
    for (const z of [hall.minZ, hall.maxZ]) {
      box([width, hall.height, 1], [0, hall.height / 2, z], shell, {
        collider: true, cast: false, label: "factory wall",
      });
      box([width, 2.2, 0.12], [0, 1.1, z + (z < 0 ? 0.6 : -0.6)], steel, { cast: false });
      for (const x of [-72, -36, 36, 72]) {
        box([22, 16, 0.25], [x, 8, z + (z < 0 ? 0.65 : -0.65)], steel, { cast: false });
        for (let y = 1; y < 16; y += 1.7)
          box([21.6, 0.06, 0.1], [x, y, z + (z < 0 ? 0.82 : -0.82)], paleSteel, { cast: false });
      }
    }
    box([width, 0.8, length], [0, hall.height, centerZ], steel, {
      collider: true, cast: false, label: "factory roof",
    });
    for (let z = hall.minZ + 12; z < hall.maxZ; z += 24) {
      box([width, 0.7, 0.65], [0, 56, z], paleSteel, { cast: false });
      box([width, 0.7, 0.65], [0, 59, z], paleSteel, { cast: false });
      for (let x = hall.minX; x < hall.maxX; x += 12)
        beam([x, 56, z], [x + 12, 59, z], 0.17, steel).castShadow = false;
      for (const x of [-66, -32, 0, 32, 66])
        box([1.2, 0.05, 15], [x, 55.5, z], stripLight, { cast: false });
    }

    // Tesla's production architecture: parallel assembly lines, orange-red
    // industrial arms, battery storage racks and yellow overhead gantry cranes.
    for (const side of [-1, 1]) {
      const x = side * 78;
      box([17, 0.55, 265], [x, 0.275, 154], steel, { collider: true, label: "assembly line" });
      for (const offset of [-7.1, 7.1])
        box([0.16, 0.6, 265], [x + offset, 0.82, 154], yellow);
      for (let z = 24; z < 285; z += 22) {
        box([6.6, 2.4, 6.2], [x, 1.75, z], paleSteel, { collider: true, label: "battery station" });
        box([6.1, 0.15, 5.8], [x, 3.02, z], standard.darkMetal);
        box([2.4, 0.16, 3.7], [x, 3.15, z], standard.red);
        for (const offset of [-5.4, 5.4]) {
          const armX = x + offset;
          cylinder(1.1, 1.2, [armX, 1.2, z], steel, { segments: 10 });
          beam([armX, 1.5, z], [armX - side * 1.8, 5.6, z + 0.5], 0.62, robotRed);
          beam([armX - side * 1.8, 5.6, z + 0.5], [armX - side * 3, 4.6, z + 2.4], 0.46, robotRed);
          cylinder(0.8, 1.25, [armX - side * 1.8, 5.6, z + 0.5], steel, {
            rotation: [Math.PI / 2, 0, 0], segments: 10,
          });
          box([1, 0.9, 0.7], [armX - side * 3, 4.35, z + 2.4], standard.darkMetal);
        }
      }
      for (let z = 28; z < 300; z += 36) {
        const shelfX = side * 94;
        box([5, 15, 0.3], [shelfX, 7.5, z - 4.5], steel);
        box([5, 15, 0.3], [shelfX, 7.5, z + 4.5], steel);
        for (const y of [0.8, 5.3, 9.8]) {
          box([5.5, 0.22, 9.3], [shelfX, y, z], yellow);
          for (const zz of [-2.3, 2.3]) {
            box([4.4, 3.6, 3.5], [shelfX, y + 1.95, z + zz], standard.white);
            box([4.5, 0.18, 0.15], [shelfX, y + 1.6, z + zz + 1.8], steel);
          }
        }
      }
      box([0.28, 0.08, length - 20], [side * 59, 0.05, centerZ], yellow, { cast: false });
      for (let z = 10; z < 310; z += 20)
        box([7, 0.025, 0.35], [side * 63, 0.035, z], yellow, { cast: false, rotation: [0, side * 0.55, 0] });
    }
    for (const z of [52, 172, 292]) {
      for (const x of [-61, 61]) {
        box([1.4, 47, 1.5], [x, 23.5, z], yellow, { collider: true, label: "gantry column" });
        box([3.4, 0.5, 3.4], [x, 0.25, z], steel);
      }
      box([124, 2.1, 2.6], [0, 47, z], yellow);
      box([123, 0.2, 2.7], [0, 48.15, z], standard.darkMetal);
      box([8, 1.8, 4.5], [38, 45.5, z], steel);
      beam([38, 45, z], [38, 40, z], 0.085, standard.metal);
      cylinder(0.55, 0.9, [38, 39.5, z], yellow, { segments: 10 });
    }

    // A clean launch apron and visual depth cues on the floor help judge height.
    for (const x of [-18, 18])
      box([0.15, 0.035, 270], [x, 0.025, 125], cyan, { cast: false });
    for (let z = -10; z < 280; z += 12)
      box([0.22, 0.025, 4], [0, 0.025, z], standard.line, { cast: false });
    for (let z = 40; z <= 280; z += 40) {
      box([35.8, 0.02, 0.1], [0, 0.035, z], paleSteel, { cast: false });
      groundMark(`${z} M`, [-23, 0.045, z], 4, 1.7, "#a6bcc9");
    }
    groundMark("FLIGHT TEST 04", [0, 0.045, -11], 17, 2.1, "#d4edf7");
    label("G I G A F A C T O R Y", 64, 6.4, {
      position: [0, 32, hall.maxZ - 0.6], rotation: [0, Math.PI, 0],
      color: "#e4eef4", spacing: 16, weight: 500,
    });
    label("TESLA  /  ADVANCED FLIGHT SYSTEMS", 49, 2.4, {
      position: [0, 25.8, hall.maxZ - 0.62], rotation: [0, Math.PI, 0],
      color: "#73dcef", spacing: 10,
    });
    label("FLY FIVE. STAY IN ONE PIECE.", 37, 2.2, {
      position: [0, 19, hall.maxZ - 0.64], rotation: [0, Math.PI, 0],
      color: "#afc0cb", spacing: 7,
    });

    // Shared atlases keep all ten markers inexpensive. The halo is baked into a
    // transparent texture so rings still glow in the mobile direct-render path.
    const haloTexture = texture(256, (ctx, size) => {
      const center = size / 2;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.68, "rgba(255,255,255,0)");
      gradient.addColorStop(0.75, "rgba(255,255,255,.12)");
      gradient.addColorStop(0.79, "rgba(255,255,255,.8)");
      gradient.addColorStop(0.82, "rgba(255,255,255,.18)");
      gradient.addColorStop(0.94, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    });
    const numberAtlas = texture(512, (ctx, size) => {
      const cell = size / 4;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.font = "500 72px Arial, sans-serif";
      for (let i = 0; i < 10; i++)
        ctx.fillText(String(i + 1).padStart(2, "0"), (i % 4 + 0.5) * cell, (Math.floor(i / 4) + 0.5) * cell);
      ctx.font = "600 80px Arial, sans-serif";
      ctx.fillText("✓", 2.5 * cell, 2.5 * cell);
    });
    function atlasCell(geometry, cell) {
      const uv = geometry.attributes.uv;
      const x = cell % 4;
      const y = Math.floor(cell / 4);
      uv.setXY(0, x / 4, 1 - y / 4);
      uv.setXY(1, (x + 1) / 4, 1 - y / 4);
      uv.setXY(2, x / 4, 1 - (y + 1) / 4);
      uv.setXY(3, (x + 1) / 4, 1 - (y + 1) / 4);
      uv.needsUpdate = true;
    }
    const updateRings = [];
    for (let index = 0; index < FACTORY_RINGS.length; index++) {
      const ring = FACTORY_RINGS[index];
      const root = new THREE.Group();
      root.name = `Flight ring ${index + 1}`;
      root.position.set(...ring.position);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...ring.normal));
      group.add(root);
      animatedRoots.add(root);
      const color = index < 5 ? "#64e7ff" : "#ffd486";
      const rimMaterial = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const haloMaterial = new THREE.MeshBasicMaterial({
        color, map: haloTexture, transparent: true, opacity: 0.54,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      });
      const numberMaterial = new THREE.MeshBasicMaterial({
        map: numberAtlas, color, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      });
      materials.add(rimMaterial);
      materials.add(haloMaterial);
      materials.add(numberMaterial);
      const rim = mesh(new THREE.TorusGeometry(ring.radius, 0.13, 6, 64), rimMaterial, [0, 0, 0], [0, 0, 0], root, false);
      const halo = mesh(new THREE.PlaneGeometry(ring.radius * 2.5, ring.radius * 2.5), haloMaterial, [0, 0, 0], [0, 0, 0], root, false);
      // Four short brackets establish the ring plane without filling its opening.
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const x = Math.sin(angle) * (ring.radius + 0.35);
        const y = Math.cos(angle) * (ring.radius + 0.35);
        box([0.4, 0.8, 0.25], [x, y, 0], paleSteel, { parent: root, cast: false, rotation: [0, 0, -angle] });
      }
      const number = mesh(new THREE.PlaneGeometry(2.3, 2.3), numberMaterial, [0, ring.radius + 2, 0], [0, Math.PI, 0], root, false);
      atlasCell(number.geometry, index);
      const entry = { ...ring, root, rim, halo, number, collected: false };
      rings.push(entry);
      updateRings.push((passed, time) => {
        if (passed !== entry.collected) {
          entry.collected = passed;
          rimMaterial.color.set(passed ? "#68e9a3" : color);
          haloMaterial.color.copy(rimMaterial.color);
          numberMaterial.color.copy(rimMaterial.color);
          atlasCell(number.geometry, passed ? 10 : index);
        }
        haloMaterial.opacity = passed ? 0.17 : 0.42 + Math.sin(time * 2 + index * 0.7) * 0.08;
        rimMaterial.color.set(passed ? "#3c9568" : color);
      });
    }
    animations.push((dt, time) => {
      const collected = physics?.state?.collectedRings || [];
      for (let index = 0; index < rings.length; index++) {
        const passed = typeof collected.has === "function"
          ? collected.has(rings[index].id)
          : collected.includes(rings[index].id);
        updateRings[index](passed, time);
      }
    });
    goal = { position: FACTORY_RINGS[4].position, radius: FACTORY_RINGS[4].radius, heading: 0 };
  } else {
    lighting = lights(true);
    const apron = material("#a5b0bc", 0.88, 0.12, {
      map: surfaceTexture("#353b41", 17, [40, 50], true),
    });
    // Keep the landing collider perfectly flat, but leave an actual opening in
    // its visible apron for the runway. Two surfaces at y=0 were fighting for
    // the same depth pixels, particularly as the camera moved along the road.
    const { width: apronWidth, length: apronLength, centerZ: apronZ } = INVERSION_APRON;
    physics?.addBox?.({
      position: [0, -0.5, apronZ], size: [apronWidth, 1, apronLength], rotation: [0, 0, 0],
      mass: 0, friction: 0.7, restitution: 0.13, label: "scenery",
    });
    const halfRoad = RAMP.width / 2;
    const sideWidth = apronWidth / 2 - halfRoad;
    for (const side of [-1, 1])
      box([sideWidth, 1, apronLength], [side * (halfRoad + sideWidth / 2), -0.5, apronZ], apron, { cast: false });
    const apronStart = apronZ - apronLength / 2, apronEnd = apronZ + apronLength / 2;
    box([RAMP.width, 1, -30 - apronStart], [0, -0.5, (apronStart - 30) / 2], apron, { cast: false });
    box([RAMP.width, 1, apronEnd - RAMP.entryZ], [0, -0.5, (RAMP.entryZ + apronEnd) / 2], apron, { cast: false });
    const road = material("#aeb5c0", 0.68, 0.2, {
      map: surfaceTexture("#454a50", 10, [2, 9]),
    });
    box([RAMP.width, 0.22, 72], [0, -0.11, 6], road, {
      collider: true,
      cast: false,
    });
    const redGlow = new THREE.MeshBasicMaterial({
      color: "#ff233b",
      toneMapped: false,
    });
    materials.add(redGlow);
    const guide = material("#b5bdc5", 0.35, 0.3, {
      emissive: "#bcc9db",
      emissiveIntensity: 0.25,
    });
    for (const x of [-RAMP.width / 2, RAMP.width / 2])
      box([0.08, 0.05, 72], [x, 0.05, 6], redGlow, { cast: false });
    for (const x of [-1.6, 1.6])
      box([0.035, 0.015, 71], [x, 0.015, 6], guide, { cast: false });
    const { radius, entryZ, width, thickness, segments } = RAMP;
    // Inner driving face rises into a complete half-loop and releases the car inverted.
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI,
        b = ((i + 1) / segments) * Math.PI,
        mid = (a + b) / 2;
      const y = radius * (1 - Math.cos(mid)),
        z = entryZ + radius * Math.sin(mid);
      const outwardY = -Math.cos(mid),
        outwardZ = Math.sin(mid);
      const segmentLength =
        2 * radius * Math.sin(Math.PI / segments / 2) + 0.025;
      box(
        [width, thickness, segmentLength],
        [0, y + (outwardY * thickness) / 2, z + (outwardZ * thickness) / 2],
        road,
        { rotation: [-mid, 0, 0], collider: true, friction: 1.1 },
      );
      for (const x of [-width / 2, width / 2])
        box(
          [0.095, 0.055, segmentLength + 0.01],
          [x, y - outwardY * 0.025, z - outwardZ * 0.025],
          redGlow,
          { rotation: [-mid, 0, 0], cast: false },
        );
      for (const x of [-1.6, 1.6])
        box(
          [0.035, 0.015, segmentLength],
          [x, y - outwardY * 0.008, z - outwardZ * 0.008],
          guide,
          { rotation: [-mid, 0, 0], cast: false },
        );
    }
    // Tubular truss rings mirror the structure visible in the demonstration footage.
    for (const x of [-5.35, 5.35]) {
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI,
          b = ((i + 1) / 30) * Math.PI;
        const point = (angle, r) => [
          x,
          radius - r * Math.cos(angle),
          entryZ + r * Math.sin(angle),
        ];
        beam(
          point(a, radius + 0.5),
          point(b, radius + 0.5),
          0.13,
          standard.metal,
        );
        beam(
          point(a, radius + 2.0),
          point(b, radius + 2.0),
          0.13,
          standard.metal,
        );
        beam(
          point(a, radius + 0.5),
          point(b, radius + 2.0),
          0.075,
          standard.metal,
        );
        beam(
          point(a, radius + 2.0),
          point(b, radius + 0.5),
          0.075,
          standard.metal,
        );
      }
      for (let i = 0; i < 6; i++) {
        const angle = 0.25 + i * 0.5,
          z = entryZ + Math.sin(angle) * (radius + 1.2),
          y = Math.max(0.2, radius - Math.cos(angle) * (radius + 1.2));
        beam([x, 0.1, z + 4], [x, y, z], 0.15, standard.darkMetal);
        if (y > 5)
          beam([x, 0.1, z + 8], [x, y * 0.7, z], 0.11, standard.darkMetal);
      }
      box([1.4, 0.32, 26], [x, 0.16, entryZ + 11], standard.darkMetal, {
        collider: true,
      });
    }
    for (let i = 0; i < 16; i++) {
      const angle = (i / 15) * Math.PI;
      const y = radius - (radius + 0.6) * Math.cos(angle),
        z = entryZ + (radius + 0.6) * Math.sin(angle);
      beam([-5.35, y, z], [5.35, y, z], 0.11, standard.metal);
    }
    // Landing field is marked behind the ramp's overhanging release point.
    goalPad(5, 7.6, "LANDING ZONE", true);
    for (const x of [-3.8, 3.8])
      for (let z = -15; z < 25; z += 4)
        box([0.06, 0.015, 2], [x, 0.02, z], guide, { cast: false });
    for (let z = -16; z < 30; z += 8) {
      for (const x of [-8.4, 8.4]) {
        box([1.15, 0.6, 1.15], [x, 0.3, z], standard.darkMetal, {
          collider: true,
        });
        box([1.05, 0.02, 0.08], [x, 0.61, z], redGlow, { cast: false });
      }
    }
    // Performance event backdrop and architectural lighting.
    box([38, 10, 0.8], [0, 5, 78], standard.black);
    label("R O A D S T E R", 28, 4, {
      position: [0, 5.8, 77.55],
      rotation: [0, Math.PI, 0],
      color: "#d8dbe1",
      fontSize: 110,
      weight: 400,
      spacing: 18,
    });
    label("THE ONLY LIMIT IS GRAVITY.", 18, 0.9, {
      position: [0, 2.45, 77.54],
      rotation: [0, Math.PI, 0],
      color: "#9c9fa7",
      fontSize: 44,
      spacing: 8,
    });
    box([38, 0.12, 0.12], [0, 0.6, 77.5], redGlow, { cast: false });
    for (let x = -18; x <= 18; x += 3) {
      if (x % 9 === 0) {
        const light = new THREE.PointLight("#e3192b", 55, 18, 2);
        light.position.set(x, 0.45, 76.8);
        group.add(light);
      }
      box([0.2, 0.12, 0.35], [x, 0.12, 76], standard.black);
    }
    // Keep the near floodlight towers behind the trackside camera's x=28 corridor.
    for (const x of [-22, 40])
      for (const z of [-9, 39, 70]) {
        for (const xx of [-0.6, 0.6])
          for (const zz of [-0.6, 0.6])
            cylinder(0.055, 17, [x + xx, 8.5, z + zz], standard.metal, {
              segments: 6,
            });
        for (let y = 0; y < 16; y += 2) {
          beam(
            [x - 0.6, y, z - 0.6],
            [x + 0.6, y + 2, z - 0.6],
            0.035,
            standard.metal,
          );
          beam(
            [x + 0.6, y, z + 0.6],
            [x - 0.6, y + 2, z + 0.6],
            0.035,
            standard.metal,
          );
          beam(
            [x - 0.6, y, z - 0.6],
            [x - 0.6, y + 2, z + 0.6],
            0.035,
            standard.metal,
          );
        }
        box([3.2, 0.3, 1.7], [x, 17, z], standard.darkMetal);
        for (let i = 0; i < 4; i++) {
          box(
            [0.58, 0.28, 0.8],
            [x - 1.12 + i * 0.75, 16.85, z],
            standard.black,
          );
          box(
            [0.48, 0.035, 0.6],
            [x - 1.12 + i * 0.75, 16.67, z],
            material("#d9e9ff", 0.2, 0, {
              emissive: "#d7e7ff",
              emissiveIntensity: 7,
            }),
            { cast: false },
          );
        }
        const spot = new THREE.SpotLight("#d8e5ff", 900, 95, 0.55, 0.65, 1.5);
        spot.position.set(x, 16.7, z);
        spot.target.position.set(0, z === 39 ? 14 : 0.2, z === 39 ? 50 : z + 8);
        group.add(spot, spot.target);
      }
    const rampFill = new THREE.PointLight("#c8d8ee", 450, 65, 2);
    rampFill.position.set(0, 10, 27);
    group.add(rampFill);
    // Safety crowd barriers and low stage boxes frame the action without blocking the view.
    for (const x of [-14.5, 14.5])
      for (let z = -15; z <= 60; z += 3.1) {
        for (const zz of [-1.4, 1.4])
          cylinder(0.035, 1.15, [x, 0.575, z + zz], standard.metal, {
            segments: 5,
          });
        beam([x, 1.15, z - 1.4], [x, 1.15, z + 1.4], 0.035, standard.metal);
        beam([x, 0.3, z - 1.4], [x, 0.3, z + 1.4], 0.028, standard.metal);
        for (let zz = -1.15; zz <= 1.2; zz += 0.38)
          beam([x, 0.3, z + zz], [x, 1.15, z + zz], 0.012, standard.metal);
      }
    for (let i = 0; i < 18; i++) {
      const x = (i % 2 ? -1 : 1) * (20 + rand() * 20),
        z = -12 + rand() * 75;
      box([1.2, 0.9, 1], [x, 0.45, z], standard.darkMetal);
      box([1.25, 0.07, 1.05], [x, 0.94, z], standard.black);
    }
    goal = { position: [0, 0.73, 5], radius: 20, heading: Math.PI };
    distantHills(true);
  }

  // Bake every loose object into a single coloured mesh; a room of 57 rigid bodies
  // should cost 57 draw calls, including their tape, labels, handles and barcodes.
  const propGrain = surfaceTexture("#ffffff", 7, [2, 2]);
  const propMaterial = material("#ffffff", 0.78, 0.04, {
    vertexColors: true,
    map: propGrain,
  });
  const canMaterial = material("#ffffff", 0.45, 0.4, { vertexColors: true });
  for (const prop of props) {
    prop.mesh.updateMatrixWorld(true);
    const inverse = prop.mesh.matrixWorld.clone().invert();
    const children = [];
    prop.mesh.traverse((object) => {
      if (object.isMesh) children.push(object);
    });
    if (!children.length) continue;
    const copies = children.map((object) => {
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      const color = object.material.color;
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = color.r;
        colors[i + 1] = color.g;
        colors[i + 2] = color.b;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const combined = mergeGeometries(copies);
    for (const copy of copies) copy.dispose();
    if (!combined) continue;
    for (const child of children) {
      child.removeFromParent();
      child.geometry.dispose();
      geometries.delete(child.geometry);
    }
    mesh(
      combined,
      prop.kind === "paint can" ? canMaterial : propMaterial,
      [0, 0, 0],
      [0, 0, 0],
      prop.mesh,
    );
  }

  // Bake stationary scenery by material to keep hundreds of small details affordable.
  // Rigid-body props retain their individual transforms for crashes and resets.
  const dynamicRoots = new Set(props.map((prop) => prop.mesh));
  const batches = new Map();
  group.updateMatrixWorld(true);
  const cameraBounds = new THREE.Box3();
  const cameraCenter = new THREE.Vector3();
  const cameraSize = new THREE.Vector3();
  if (id === "garage") group.traverse((object) => {
    if (!object.isMesh || object.userData.cameraGround) return;
    object.geometry.computeBoundingBox();
    cameraBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    // Floors remain solid. Every raised object, including moving cartons and
    // shelving, can make a cutaway when it covers the car from the chosen view.
    if (cameraBounds.max.y <= 0.2) return;
    object.userData.cameraOccluder = true;
    cameraBounds.getCenter(cameraCenter);
    cameraBounds.getSize(cameraSize);
    // Keep walls and roof pieces separate; small details still batch locally.
    // A material shared by a wall and every shelf must never erase the whole room.
    object.userData.cameraBatch = Math.max(cameraSize.x, cameraSize.y, cameraSize.z) > 4
      ? object.uuid
      : `${Math.floor(cameraCenter.x / 3)}:${Math.floor(cameraCenter.y / 3)}:${Math.floor(cameraCenter.z / 3)}`;
  });
  group.traverse((object) => {
    if (!object.isMesh || object.material.transparent) return;
    for (
      let parent = object;
      parent && parent !== group;
      parent = parent.parent
    )
      if (dynamicRoots.has(parent) || animatedRoots.has(parent)) return;
    const key = `${object.material.uuid}:${object.castShadow}:${object.userData.cameraBatch || "ground"}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(object);
  });
  for (const objects of batches.values()) {
    if (objects.length < 3) continue;
    const copies = objects.map((object) => {
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      return geometry;
    });
    const combined = mergeGeometries(copies);
    for (const copy of copies) copy.dispose();
    if (!combined) continue;
    const object = new THREE.Mesh(combined, objects[0].material);
    object.castShadow = objects[0].castShadow;
    object.receiveShadow = true;
    object.name = "Batched static scenery";
    object.userData.cameraOccluder = !!objects[0].userData.cameraOccluder;
    geometries.add(combined);
    group.add(object);
    for (const source of objects) {
      source.removeFromParent();
      source.geometry.dispose();
      geometries.delete(source.geometry);
    }
  }

  const cameraOccluders = [];
  if (id === "garage") group.traverse((object) => {
    if (object.isMesh && object.userData.cameraOccluder) cameraOccluders.push(object);
  });

  return {
    id,
    group,
    props,
    rings,
    cameraOccluders,
    spawn,
    goal,
    lighting,
    ramp: id === "ramp" ? RAMP : null,
    update(dt = 0) {
      elapsed += dt;
      for (const prop of props) {
        const body = prop.body;
        const p =
          typeof body.translation === "function"
            ? body.translation()
            : body.position;
        const q =
          typeof body.rotation === "function"
            ? body.rotation()
            : body.quaternion;
        if (p) prop.mesh.position.set(p.x, p.y, p.z);
        if (q) prop.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }
      for (const animate of animations) animate(dt, elapsed);
    },
    dispose() {
      scene.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const tex of textures) tex.dispose();
      for (const object of group.children)
        if (object.isLight) object.dispose?.();
      props.length = 0;
    },
  };
}
