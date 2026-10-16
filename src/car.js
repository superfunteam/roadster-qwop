import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Reference-built Roadster. Local +Z = nose, +X = right, +Y = up.
 * The root origin is the physics center of mass. Wheel contact plane is y=-.71.
 * Return: {group, wheels, boosters, setDamage, applyImpact, takeDebris, update}.
 * wheels are four steering pivots (front left/right, rear left/right).
 * boosters are local Vector3 nozzle mouth positions in that same order.
 * setDamage accepts hull damage as a percentage from 0 to 100.
 * applyImpact accepts {localPoint, localNormal, intensity, speed, damage}; the
 * normal points OUT of the car. Dents accumulate until setDamage(0).
 * takeDebris({explode:false}) drains detached parts. Each {object,size,mass,kind}
 * has a world transform, a centered origin, and independent disposable geometry
 * and materials. The caller owns adding, simulating, and disposing that debris.
 * update accepts {speed: m/s, steer: radians, boosters: four values 0..1}.
 * Particle effects, lighting, physics and wheel suspension belong to the caller.
 */
export function createCar({ color = 0xd5d8d7 } = {}) {
  const group = new THREE.Group();
  group.name = "Roadster / prototype with cold-gas flight package";
  group.userData.damageStage = "intact";
  const shell = new THREE.Group();
  shell.name = "Faceted aluminium coachwork";
  group.add(shell);
  const painted = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.69,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    side: THREE.DoubleSide,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x111418,
    metalness: 0.65,
    roughness: 0.32,
    side: THREE.DoubleSide,
  });
  const carbon = new THREE.MeshStandardMaterial({
    color: 0x101416,
    metalness: 0.3,
    roughness: 0.53,
    side: THREE.DoubleSide,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x131416,
    metalness: 0,
    roughness: 0.92,
  });
  const rubberEdge = new THREE.MeshStandardMaterial({
    color: 0x25272a,
    metalness: 0,
    roughness: 0.86,
  });
  const alloy = new THREE.MeshStandardMaterial({
    color: 0xdfe4e5,
    metalness: 0.92,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x6e7478,
    metalness: 0.9,
    roughness: 0.42,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x020405,
    metalness: 0.1,
    roughness: 0.68,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x03080d,
    metalness: 0,
    roughness: 0.24,
    clearcoat: 0,
    reflectivity: 0.08,
    specularIntensity: 0.015,
    envMapIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xe7f6ff,
    emissive: 0xc7eaff,
    emissiveIntensity: 3.4,
    roughness: 0.15,
    side: THREE.DoubleSide,
  });
  const redLamp = new THREE.MeshStandardMaterial({
    color: 0xff2839,
    emissive: 0xff1326,
    emissiveIntensity: 3,
    roughness: 0.2,
  });
  const amber = new THREE.MeshStandardMaterial({
    color: 0xee6b20,
    emissive: 0xff4a0a,
    emissiveIntensity: 0.65,
  });
  const caliperMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9202e,
    roughness: 0.32,
    metalness: 0.55,
  });
  const seamMaterial = new THREE.LineBasicMaterial({
    color: 0x263038,
    transparent: true,
    opacity: 0.65,
  });
  const damageParts = [];
  const nozzleGlows = [];

  function mesh(geometry, material, parent = shell, name) {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = true;
    result.receiveShadow = true;
    if (name) result.name = name;
    parent.add(result);
    return result;
  }
  function surface(vertices, faces, material = painted, parent = shell, name) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices.flat(), 3),
    );
    geometry.setIndex(faces.flat());
    geometry.computeVertexNormals();
    return mesh(geometry, material, parent, name);
  }
  function quad(a, b, c, d, material = painted, parent = shell, name) {
    return surface(
      [a, b, c, d],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
      material,
      parent,
      name,
    );
  }
  function box(w, h, d, x, y, z, material = trim, parent = shell, name) {
    const result = mesh(new THREE.BoxGeometry(w, h, d), material, parent, name);
    result.position.set(x, y, z);
    return result;
  }
  function line(points, parent = shell, material = seamMaterial) {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(...p)),
    );
    const result = new THREE.Line(geometry, material);
    parent.add(result);
    return result;
  }
  function pipe(points, radius, material, parent = shell, segments = 16) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      false,
      "centripetal",
    );
    return mesh(
      new THREE.TubeGeometry(curve, segments, radius, 5, false),
      material,
      parent,
    );
  }
  function cylinder(
    radiusTop,
    radiusBottom,
    height,
    radialSegments,
    material,
    x,
    y,
    z,
    axis = "y",
    parent = shell,
    open = false,
  ) {
    const result = mesh(
      new THREE.CylinderGeometry(
        radiusTop,
        radiusBottom,
        height,
        radialSegments,
        1,
        open,
      ),
      material,
      parent,
    );
    result.position.set(x, y, z);
    if (axis === "x") result.rotation.z = -Math.PI / 2;
    if (axis === "z") result.rotation.x = Math.PI / 2;
    return result;
  }

  // The two narrow outer surfaces are cut around the wheels. No rectangular
  // chassis is allowed to intersect the exposed tire or close its wheel arch.
  const stations = [
    [-2.3, 0.9, 0.085, 0.025],
    [-2.08, 0.975, 0.135, 0.1],
    [-1.78, 1.005, 0.175, 0.145],
    [-1.43, 1.025, 0.195, 0.15],
    [-1.1, 1.005, 0.17, 0.14],
    [-0.78, 0.977, 0.135, 0.135],
    [-0.4, 0.957, 0.12, 0.135],
    [0, 0.95, 0.1, 0.135],
    [0.42, 0.963, 0.125, 0.14],
    [0.8, 0.987, 0.16, 0.145],
    [1.1, 1.018, 0.19, 0.12],
    [1.43, 1.026, 0.18, 0.075],
    [1.78, 1.008, 0.12, 0.015],
    [2.04, 0.967, 0.015, -0.055],
    [2.3, 0.888, -0.08, -0.12],
  ];
  function section(z) {
    let i = 0;
    while (i < stations.length - 2 && stations[i + 1][0] < z) i++;
    const a = stations[i],
      b = stations[i + 1];
    const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return a.map((n, k) => THREE.MathUtils.lerp(n, b[k], t));
  }
  function lowerEdge(z) {
    let y = -0.425;
    for (const center of [-1.43, 1.43]) {
      const dz = z - center;
      if (Math.abs(dz) <= 0.427)
        y = Math.max(y, -0.35 + Math.sqrt(Math.max(0, 0.427 ** 2 - dz ** 2)));
    }
    return y;
  }
  const samples = new Set(stations.map((s) => s[0]));
  for (let z = -2.3; z <= 2.3; z += 0.06)
    samples.add(Math.round(z * 10000) / 10000);
  for (const center of [-1.43, 1.43]) {
    for (let j = 0; j <= 32; j++)
      samples.add(center + Math.cos((j / 32) * Math.PI) * 0.427);
    samples.add(center - 0.428);
    samples.add(center + 0.428);
  }
  const zValues = [...samples].sort((a, b) => a - b);
  for (const sign of [-1, 1]) {
    const vertices = [],
      indices = [];
    zValues.forEach((z, i) => {
      const [, width, upper] = section(z);
      const bottom = lowerEdge(z);
      const crease = Math.max(bottom + 0.012, -0.17);
      vertices.push([sign * (width - 0.027), bottom, z]);
      vertices.push([sign * width, Math.min(upper - 0.012, crease), z]);
      vertices.push([sign * width, upper, z]);
      if (i)
        for (let j = 0; j < 2; j++) {
          const a = (i - 1) * 3 + j,
            b = i * 3 + j;
          indices.push(sign > 0 ? [a, a + 1, b + 1] : [a, b + 1, a + 1]);
          indices.push(sign > 0 ? [a, b + 1, b] : [a, b, b + 1]);
        }
    });
    surface(
      vertices,
      indices,
      painted,
      shell,
      sign > 0 ? "Right sculpted arch panels" : "Left sculpted arch panels",
    );
    // Fender crown blends the high shoulder into the low hood/deck planes.
    const topVertices = [],
      topIndices = [];
    stations.forEach(([z, width, y, centerY], i) => {
      const inset = z > 0.75 ? 0.7 : z < -1.6 ? 0.73 : 0.78;
      topVertices.push([sign * width, y, z], [sign * inset, centerY, z]);
      if (i) {
        const a = (i - 1) * 2,
          b = i * 2;
        topIndices.push(sign > 0 ? [a, b, b + 1] : [a, b + 1, b]);
        topIndices.push(sign > 0 ? [a, b + 1, a + 1] : [a, a + 1, b + 1]);
      }
    });
    surface(
      topVertices,
      topIndices,
      painted,
      shell,
      "Angular shoulder / fender crown",
    );
    // Thin arch return and a dark inner liner create actual visual depth.
    for (const center of [-1.43, 1.43]) {
      const v = [],
        f = [];
      for (let j = 0; j <= 40; j++) {
        const angle = (Math.PI * j) / 40;
        const z = center + Math.cos(angle) * 0.427;
        const y = -0.35 + Math.sin(angle) * 0.427;
        const width = section(z)[1];
        v.push(
          [sign * (width - 0.026), y, z],
          [sign * (width - 0.095), y - 0.012, z],
        );
        if (j) {
          const a = (j - 1) * 2;
          f.push([a, a + 1, a + 3], [a, a + 3, a + 2]);
        }
      }
      surface(v, f, trim, shell, "Recessed wheel arch lip");
      const linerVertices = [[sign * 0.815, -0.35, center]],
        linerFaces = [];
      for (let j = 0; j <= 40; j++) {
        const angle = (Math.PI * j) / 40;
        linerVertices.push([
          sign * 0.815,
          -0.35 + Math.sin(angle) * 0.415,
          center + Math.cos(angle) * 0.415,
        ]);
        if (j) linerFaces.push([0, j, j + 1]);
      }
      surface(
        linerVertices,
        linerFaces,
        black,
        shell,
        "Upper wheel-well liner",
      );
    }
    // Recessed carbon sills taper upward at each wheel opening.
    quad(
      [sign * 0.985, -0.445, -0.985],
      [sign * 0.975, -0.32, -0.985],
      [sign * 0.975, -0.32, 0.98],
      [sign * 0.985, -0.445, 0.98],
      carbon,
    );
    quad(
      [sign * 0.985, -0.445, -0.985],
      [sign * 0.985, -0.445, 0.98],
      [sign * 1.005, -0.47, 1.0],
      [sign * 1.005, -0.47, -1.0],
      trim,
    );
    const seamX = sign * 0.96;
    line([
      [sign * 0.803, 0.142, 0.64],
      [sign * 0.968, 0.12, 0.42],
      [sign * 0.96, -0.28, 0.37],
      [sign * 0.936, -0.402, 0.26],
      [sign * 0.951, -0.402, -0.8],
      [sign * 0.979, -0.31, -0.91],
      [sign * 0.987, 0.13, -0.96],
    ]);
    box(0.009, 0.014, 0.15, seamX, 0.105, -0.6, trim);
    // Vent blade just behind front wheel and a tiny amber side marker.
    quad(
      [sign * 0.992, 0.095, 0.94],
      [sign * 1.025, 0.11, 1.02],
      [sign * 0.985, -0.3, 0.91],
      [sign * 0.965, -0.3, 0.77],
      black,
    );
    box(0.016, 0.018, 0.085, sign * 0.998, 0.113, 0.945, amber);
  }
  // Broad, subtly creased hood. The cabin covers the center of the deck.
  const topVertices = [],
    topIndices = [];
  stations.forEach(([z, , , y], i) => {
    const width = z > 0.75 ? 0.7 : z < -1.6 ? 0.73 : 0.78;
    topVertices.push([-width, y, z], [0, y + 0.007, z], [width, y, z]);
    if (i)
      for (let k = 0; k < 2; k++) {
        const a = (i - 1) * 3 + k,
          b = i * 3 + k;
        topIndices.push([a, b, b + 1], [a, b + 1, a + 1]);
      }
  });
  surface(
    topVertices,
    topIndices,
    painted,
    shell,
    "Low planar hood and rear deck",
  );
  for (const sign of [-1, 1])
    line([
      [sign * 0.7, -0.118, 2.29],
      [sign * 0.7, 0.015, 1.78],
      [sign * 0.7, 0.12, 1.1],
      [sign * 0.74, 0.145, 0.77],
    ]);
  box(1.43, 0.085, 3.64, 0, -0.348, 0, carbon, shell, "Flat carbon undertray");

  // Deep front fascia, recessed light bar and angular triangular headlamps.
  quad(
    [-0.7, -0.115, 2.319],
    [0.7, -0.115, 2.319],
    [0.865, -0.365, 2.235],
    [-0.865, -0.365, 2.235],
    black,
    shell,
    "Front recessed grille",
  );
  quad(
    [-0.7, -0.11, 2.322],
    [0.7, -0.11, 2.322],
    [0.7, -0.132, 2.325],
    [-0.7, -0.132, 2.325],
    lamp,
    shell,
    "Full width white light signature",
  );
  for (const sign of [-1, 1]) {
    surface(
      [
        [sign * 0.705, -0.096, 2.304],
        [sign * 0.886, -0.072, 2.28],
        [sign * 0.946, 0.047, 1.955],
      ],
      [[0, 1, 2]],
      trim,
      shell,
      "Headlamp triangular recess",
    );
    surface(
      [
        [sign * 0.723, -0.078, 2.285],
        [sign * 0.867, -0.06, 2.269],
        [sign * 0.921, 0.029, 1.997],
      ],
      [[0, 1, 2]],
      lamp,
      shell,
      "Triangular LED headlamp",
    );
    quad(
      [sign * 0.7, -0.12, 2.319],
      [sign * 0.888, -0.08, 2.302],
      [sign * 0.946, -0.27, 2.116],
      [sign * 0.838, -0.27, 2.261],
      painted,
    );
    quad(
      [sign * 0.888, -0.08, 2.302],
      [sign * 0.966, 0.015, 2.04],
      [sign * 0.946, -0.27, 2.116],
      [sign * 0.838, -0.27, 2.261],
      painted,
    );
    quad(
      [sign * 0.838, -0.27, 2.261],
      [sign * 0.946, -0.27, 2.116],
      [sign * 0.985, -0.445, 2.16],
      [sign * 0.894, -0.45, 2.35],
      carbon,
    );
    box(0.15, 0.026, 0.018, sign * 0.69, -0.303, 2.265, trim);
  }
  quad(
    [-0.865, -0.365, 2.235],
    [0.865, -0.365, 2.235],
    [0.925, -0.435, 2.39],
    [-0.925, -0.435, 2.39],
    carbon,
    shell,
    "Front splitter",
  );
  quad(
    [-0.925, -0.435, 2.39],
    [0.925, -0.435, 2.39],
    [0.925, -0.456, 2.38],
    [-0.925, -0.456, 2.38],
    trim,
  );
  box(0.54, 0.043, 0.015, 0, -0.275, 2.278, trim);
  // An understated T emblem formed as metal, not a texture decal.
  const emblem = new THREE.Group();
  emblem.position.set(0, -0.267, 2.293);
  shell.add(emblem);
  box(0.048, 0.007, 0.003, 0, 0.015, 0, alloy, emblem);
  surface(
    [
      [-0.009, 0.01, 0.002],
      [0.009, 0.01, 0.002],
      [0.003, -0.024, 0.003],
      [-0.003, -0.024, 0.003],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
    alloy,
    emblem,
  );

  // A continuous dark, low polygon glasshouse with thin silver structural rails.
  const canopy = new THREE.Group();
  canopy.name = "Low panoramic glass canopy";
  canopy.scale.y = 0.72;
  canopy.position.y = 0.042;
  shell.add(canopy);
  const windshield = [
    [-0.745, 0.151, 0.77],
    [0.745, 0.151, 0.77],
    [0.602, 0.578, -0.27],
    [-0.602, 0.578, -0.27],
  ];
  quad(...windshield, glass, canopy, "Panoramic windshield");
  quad(
    [-0.602, 0.578, -0.27],
    [0.602, 0.578, -0.27],
    [0.611, 0.601, -0.7],
    [-0.611, 0.601, -0.7],
    glass,
    canopy,
    "Black glass roof forward",
  );
  quad(
    [-0.611, 0.601, -0.7],
    [0.611, 0.601, -0.7],
    [0.615, 0.558, -1.04],
    [-0.615, 0.558, -1.04],
    glass,
    canopy,
    "Black glass roof aft",
  );
  quad(
    [-0.615, 0.558, -1.04],
    [0.615, 0.558, -1.04],
    [0.724, 0.179, -1.72],
    [-0.724, 0.179, -1.72],
    glass,
    canopy,
    "Sloping rear glass",
  );
  for (const sign of [-1, 1]) {
    const a = [sign * 0.763, 0.153, 0.69],
      b = [sign * 0.624, 0.572, -0.275],
      c = [sign * 0.636, 0.555, -1.04],
      d = [sign * 0.813, 0.187, -1.48],
      e = [sign * 0.851, 0.132, -0.83];
    surface(
      [a, b, c, d, e],
      [
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
      ],
      glass,
      canopy,
      "Smoked side window",
    );
    pipe(
      [
        [sign * 0.749, 0.151, 0.775],
        [sign * 0.607, 0.586, -0.27],
        [sign * 0.617, 0.607, -0.7],
        [sign * 0.628, 0.562, -1.05],
        [sign * 0.772, 0.202, -1.62],
      ],
      0.016,
      painted,
      canopy,
      24,
    );
    pipe([a, e, d], 0.012, painted, canopy, 12);
    pipe(
      [
        [sign * 0.628, 0.569, -0.67],
        [sign * 0.844, 0.14, -0.78],
      ],
      0.013,
      trim,
      canopy,
      1,
    );
    pipe(
      [
        [sign * 0.65, 0.555, -0.75],
        [sign * 0.844, 0.14, -0.86],
      ],
      0.005,
      trim,
      canopy,
      1,
    );
    // Small rear buttress connects the cabin to the broad rear haunch.
    quad(
      [sign * 0.628, 0.562, -1.05],
      [sign * 0.772, 0.202, -1.62],
      [sign * 0.955, 0.167, -1.62],
      [sign * 0.813, 0.187, -1.48],
      painted,
      canopy,
    );
    const mirror = new THREE.Group();
    mirror.name = sign < 0 ? "Left mirror assembly" : "Right mirror assembly";
    mirror.position.set(sign * 1.042, 0.18, 0.5);
    shell.add(mirror);
    box(0.13, 0.04, 0.22, 0, 0, 0, painted, mirror);
    mirror.rotation.y = sign * 0.14;
    box(0.08, 0.025, 0.06, -sign * 0.069, -0.016, -0.01, trim, mirror);
    box(0.113, 0.027, 0.012, sign * 0.001, 0.001, -0.111, glass, mirror);
    damageParts.push({
      object: mirror,
      position: mirror.position.clone(),
      rotation: mirror.rotation.clone(),
      side: sign,
      type: "mirror",
    });
  }
  // Rear silver fascia frames the long red blade above a four-nozzle diffuser.
  quad(
    [-0.9, 0.085, -2.305],
    [-0.91, -0.14, -2.315],
    [0.91, -0.14, -2.315],
    [0.9, 0.085, -2.305],
    painted,
    shell,
    "Rear fascia",
  );
  box(1.83, 0.085, 0.045, 0, 0.094, -2.305, black);
  box(
    1.825,
    0.022,
    0.015,
    0,
    0.108,
    -2.335,
    redLamp,
    shell,
    "Continuous rear light blade",
  );
  box(1.72, 0.008, 0.012, 0, 0.081, -2.335, redLamp);
  quad(
    [-0.91, -0.14, -2.317],
    [-0.84, -0.425, -2.25],
    [0.84, -0.425, -2.25],
    [0.91, -0.14, -2.317],
    black,
    shell,
    "Rear diffuser recessed face",
  );
  quad(
    [-0.84, -0.425, -2.25],
    [-0.92, -0.48, -2.39],
    [0.92, -0.48, -2.39],
    [0.84, -0.425, -2.25],
    carbon,
    shell,
    "Rising rear diffuser floor",
  );
  for (const x of [-0.72, -0.42, 0, 0.42, 0.72]) {
    quad(
      [x, -0.445, -2.39],
      [x, -0.21, -2.29],
      [x, -0.3, -1.86],
      [x, -0.49, -1.88],
      carbon,
    );
  }
  for (const x of [-0.51, -0.17, 0.17, 0.51]) {
    cylinder(
      0.066,
      0.057,
      0.13,
      32,
      steel,
      x,
      -0.205,
      -2.328,
      "z",
      shell,
      true,
    );
    cylinder(0.048, 0.048, 0.005, 32, black, x, -0.205, -2.401, "z");
    const ring = mesh(new THREE.TorusGeometry(0.062, 0.005, 6, 32), alloy);
    ring.position.set(x, -0.205, -2.397);
  }
  const plate = box(
    0.35,
    0.13,
    0.018,
    0,
    -0.065,
    -2.34,
    new THREE.MeshStandardMaterial({
      color: 0xc9cfcf,
      metalness: 0.45,
      roughness: 0.38,
    }),
  );
  // Tiny generated plate lettering stays legible at close range without visual noise.
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c9cecb";
    ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = "#68736e";
    ctx.font = "400 80px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RDSTR", 256, 100);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const plateFace = mesh(
      new THREE.PlaneGeometry(0.332, 0.12),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.4,
        metalness: 0.1,
      }),
    );
    plateFace.rotation.y = Math.PI;
    plateFace.position.set(0, -0.065, -2.35);
  }
  for (const sign of [-1, 1])
    box(0.018, 0.055, 0.03, sign * 0.91, -0.08, -2.29, redLamp);

  // High, broad aero wing with a thin cambered upper surface and proper endplates.
  const wing = new THREE.Group();
  wing.name = "High rear aerofoil";
  shell.add(wing);
  for (const sign of [-1, 1]) {
    const support = box(
      0.035,
      0.31,
      0.047,
      sign * 0.62,
      0.307,
      -2.037,
      trim,
      wing,
    );
    support.rotation.x = 0.23;
    const brace = box(
      0.021,
      0.29,
      0.025,
      sign * 0.62,
      0.288,
      -1.97,
      alloy,
      wing,
    );
    brace.rotation.x = -0.22;
  }
  const wingSections = [
    [-1.115, 0.435, -2.2],
    [-0.83, 0.445, -2.19],
    [-0.56, 0.445, -2.17],
    [0, 0.421, -2.14],
    [0.56, 0.445, -2.17],
    [0.83, 0.445, -2.19],
    [1.115, 0.435, -2.2],
  ];
  const wv = [],
    wf = [];
  wingSections.forEach(([x, y, z], i) => {
    wv.push(
      [x, y, z + 0.28],
      [x, y + 0.025, z + 0.085],
      [x, y, z - 0.1],
      [x, y - 0.026, z - 0.08],
      [x, y - 0.015, z + 0.28],
    );
    if (i)
      for (let j = 0; j < 4; j++) {
        const a = (i - 1) * 5 + j,
          b = i * 5 + j;
        wf.push([a, b, b + 1], [a, b + 1, a + 1]);
      }
  });
  surface(wv, wf, painted, wing, "Cambered silver rear aerofoil");
  for (const sign of [-1, 1]) {
    const v = [
      [sign * 1.115, 0.465, -1.92],
      [sign * 1.115, 0.435, -2.31],
      [sign * 1.115, 0.22, -2.31],
      [sign * 1.115, 0.3, -2.04],
    ];
    surface(
      v,
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
      painted,
      wing,
      "Wing endplate",
    );
    const inner = v.map((p) => [p[0] - sign * 0.012, p[1], p[2]]);
    surface(
      inner,
      [
        [0, 2, 1],
        [0, 3, 2],
      ],
      carbon,
      wing,
    );
  }
  damageParts.push({
    object: wing,
    position: wing.position.clone(),
    rotation: wing.rotation.clone(),
    type: "wing",
  });

  // Four separate underbody rocket modules, with heat shields and recessed throats.
  const boosters = [
    new THREE.Vector3(-0.78, -0.43, 1.43),
    new THREE.Vector3(0.78, -0.43, 1.43),
    new THREE.Vector3(-0.78, -0.43, -1.43),
    new THREE.Vector3(0.78, -0.43, -1.43),
  ];
  boosters.forEach((p, i) => {
    box(0.23, 0.075, 0.29, p.x, -0.32, p.z, trim);
    cylinder(
      0.068,
      0.102,
      0.115,
      24,
      steel,
      p.x,
      -0.394,
      p.z,
      "y",
      shell,
      true,
    );
    cylinder(0.075, 0.075, 0.007, 24, black, p.x, -0.443, p.z);
    const ring = mesh(new THREE.TorusGeometry(0.099, 0.008, 6, 24), alloy);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, -0.45, p.z);
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0x172a36,
      emissive: 0x5bccff,
      emissiveIntensity: 0,
      roughness: 0.35,
    });
    const glow = cylinder(
      0.047,
      0.047,
      0.008,
      20,
      glowMaterial,
      p.x,
      -0.448,
      p.z,
    );
    nozzleGlows.push(glowMaterial);
    const cable = pipe(
      [
        [p.x, -0.31, p.z],
        [p.x * 0.68, -0.32, p.z - 0.12],
        [p.x * 0.58, -0.32, p.z - 0.31],
      ],
      0.012,
      steel,
      shell,
      6,
    );
  });
  // Visible underslung battery ribs help sell the car in airborne camera angles.
  for (let z = -1.12; z <= 1.12; z += 0.25)
    box(1.17, 0.028, 0.018, 0, -0.402, z, steel);

  const wheels = [];
  const spinningWheels = [];
  const tireProfile = [
    [0.251, -0.135],
    [0.285, -0.137],
    [0.326, -0.126],
    [0.351, -0.101],
    [0.36, -0.065],
    [0.361, 0],
    [0.36, 0.065],
    [0.351, 0.101],
    [0.326, 0.126],
    [0.285, 0.137],
    [0.251, 0.135],
    [0.251, -0.135],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const tireGeometry = new THREE.LatheGeometry(tireProfile, 64);
  tireGeometry.rotateZ(-Math.PI / 2);
  const wheelPositions = [
    [-0.94, -0.35, 1.43],
    [0.94, -0.35, 1.43],
    [-0.94, -0.35, -1.43],
    [0.94, -0.35, -1.43],
  ];
  wheelPositions.forEach(([x, y, z], index) => {
    const sign = Math.sign(x),
      pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.name = index < 2 ? "Front steering wheel" : "Rear wheel";
    group.add(pivot);
    wheels.push(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    spinningWheels.push(spin);
    mesh(tireGeometry, rubber, spin, "Sculpted performance tire");
    for (const radial of [0.311, 0.337]) {
      const ring = mesh(
        new THREE.TorusGeometry(radial, 0.0023, 5, 64),
        rubberEdge,
        spin,
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = sign * 0.13;
    }
    // Two very fine circumferential tread grooves are visible from oblique angles.
    for (const axial of [-0.047, 0.047]) {
      const groove = mesh(
        new THREE.TorusGeometry(0.3607, 0.002, 4, 64),
        black,
        spin,
      );
      groove.rotation.y = Math.PI / 2;
      groove.position.x = axial;
    }
    cylinder(0.26, 0.26, 0.2, 48, trim, 0, 0, 0, "x", spin, true);
    cylinder(0.235, 0.235, 0.014, 48, steel, sign * 0.085, 0, 0, "x", pivot);
    const rotorRing = mesh(
      new THREE.TorusGeometry(0.205, 0.004, 5, 48),
      alloy,
      pivot,
    );
    rotorRing.rotation.y = Math.PI / 2;
    rotorRing.position.x = sign * 0.096;
    const holes = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.009, 6),
      black,
      28,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 28; i++) {
      let angle = (i / 28) * Math.PI * 2;
      dummy.position.set(
        sign * 0.094,
        Math.cos(angle) * 0.192,
        Math.sin(angle) * 0.192,
      );
      dummy.rotation.set(0, (sign * Math.PI) / 2, 0);
      dummy.updateMatrix();
      holes.setMatrixAt(i, dummy.matrix);
    }
    pivot.add(holes);
    const caliper = box(
      0.055,
      0.15,
      0.07,
      sign * 0.106,
      0.045,
      -0.19,
      caliperMaterial,
      pivot,
    );
    caliper.rotation.x = 0.12;
    const lip = mesh(new THREE.TorusGeometry(0.275, 0.012, 8, 64), alloy, spin);
    lip.rotation.y = Math.PI / 2;
    lip.position.x = sign * 0.139;
    const innerLip = mesh(
      new THREE.TorusGeometry(0.253, 0.005, 6, 48),
      trim,
      spin,
    );
    innerLip.rotation.y = Math.PI / 2;
    innerLip.position.x = sign * 0.142;
    // Five slightly swept silver blades with black edge facets and concave hubs.
    for (let blade = 0; blade < 5; blade++) {
      const angle = (blade / 5) * Math.PI * 2 + 0.11;
      const shape = [
        [-0.027, 0.043],
        [0.037, 0.056],
        [0.085, 0.244],
        [0.052, 0.275],
        [-0.02, 0.256],
      ];
      const front = shape.map(([t, r]) => [
        sign * (r < 0.1 ? 0.095 : 0.146),
        Math.cos(angle) * r - Math.sin(angle) * t,
        Math.sin(angle) * r + Math.cos(angle) * t,
      ]);
      const back = front.map((p) => [p[0] - sign * 0.022, p[1], p[2]]);
      surface(
        [...front, ...back],
        [
          [0, 1, 2],
          [0, 2, 3],
          [0, 3, 4],
          [0, 5, 6],
          [0, 6, 1],
          [1, 6, 7],
          [1, 7, 2],
          [2, 7, 8],
          [2, 8, 3],
          [3, 8, 9],
          [3, 9, 4],
          [4, 9, 5],
          [4, 5, 0],
        ],
        alloy,
        spin,
        "Swept forged spoke",
      );
      const spine = [
        [-0.02, 0.067],
        [-0.005, 0.23],
        [0.024, 0.26],
      ].map(([t, r]) => [
        sign * 0.151,
        Math.cos(angle) * r - Math.sin(angle) * t,
        Math.sin(angle) * r + Math.cos(angle) * t,
      ]);
      surface(spine, [[0, 1, 2]], trim, spin);
    }
    cylinder(0.066, 0.066, 0.023, 32, trim, sign * 0.128, 0, 0, "x", spin);
    cylinder(0.035, 0.035, 0.024, 24, alloy, sign * 0.142, 0, 0, "x", spin);
    for (let bolt = 0; bolt < 5; bolt++) {
      const a = (bolt / 5) * Math.PI * 2;
      cylinder(
        0.007,
        0.007,
        0.009,
        8,
        alloy,
        sign * 0.144,
        Math.cos(a) * 0.047,
        Math.sin(a) * 0.047,
        "x",
        spin,
      );
    }
  });

  // Bake static detail that shares a material into one draw call per assembly.
  // Steering pivots, spinning rims, instanced rotor holes and damageable mirrors
  // retain their hierarchy, so the detail remains inexpensive on mobile GPUs.
  const movingParts = new Set(damageParts.map((part) => part.object));
  function consolidate(parent) {
    for (const child of [...parent.children])
      if (child.isGroup) consolidate(child);
    const batches = new Map();
    for (const child of parent.children) {
      if (
        !child.isMesh ||
        child.isInstancedMesh ||
        child.material === glass ||
        movingParts.has(child) ||
        Array.isArray(child.material)
      )
        continue;
      if (!batches.has(child.material)) batches.set(child.material, []);
      batches.get(child.material).push(child);
    }
    for (const [material, parts] of batches) {
      if (parts.length < 2) continue;
      const geometries = parts.map((part) => {
        part.updateMatrix();
        const geometry = part.geometry.index
          ? part.geometry.toNonIndexed()
          : part.geometry.clone();
        geometry.clearGroups();
        // Untextured structural materials need only positions and normals.
        if (!material.map)
          for (const key of Object.keys(geometry.attributes))
            if (key !== "position" && key !== "normal")
              geometry.deleteAttribute(key);
        geometry.applyMatrix4(part.matrix);
        return geometry;
      });
      const combined = mergeGeometries(geometries, false);
      if (combined) {
        mesh(
          combined,
          material,
          parent,
          "Batched bodywork / mechanical detail",
        );
        for (const part of parts) parent.remove(part);
      }
      for (const geometry of geometries) geometry.dispose();
    }
  }
  consolidate(group);

  // Partition the real painted body into removable panels. Classification is
  // performed once; every original triangle belongs to exactly one assembly.
  const detachable = [];
  const bodyPaint = shell.children.find(
    (o) => o.isMesh && o.material === painted,
  );
  if (bodyPaint) {
    const buckets = new Map();
    const source = bodyPaint.geometry;
    const positions = source.attributes.position.array;
    const normals = source.attributes.normal.array;
    for (let i = 0; i < positions.length; i += 9) {
      const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
      const y = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
      const z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
      let key = "shell";
      if (Math.abs(x) < 0.75 && z > 0.79 && y > -0.16) key = "hood";
      else if (x < -0.9 && Math.abs(z) < 0.99 && y > -0.38)
        key = "left-door-skin";
      else if (x > 0.9 && Math.abs(z) < 0.99 && y > -0.38)
        key = "right-door-skin";
      else if (z < -1.55 && Math.abs(x) < 0.78 && y > -0.05) key = "rear-deck";
      if (!buckets.has(key)) buckets.set(key, { positions: [], normals: [] });
      const bucket = buckets.get(key);
      for (let k = 0; k < 9; k++) {
        bucket.positions.push(positions[i + k]);
        bucket.normals.push(normals[i + k]);
      }
    }
    for (const [key, data] of buckets) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(data.positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(data.normals, 3),
      );
      if (key === "shell") {
        bodyPaint.geometry = geometry;
        bodyPaint.name = "Crash-deformable aluminium shell";
      } else {
        geometry.computeBoundingBox();
        const center = geometry.boundingBox.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z);
        const panel = mesh(geometry, painted, shell, `Detachable ${key}`);
        panel.position.copy(center);
        detachable.push({
          object: panel,
          kind: key,
          mass: key === "hood" ? 12 : 8,
          threshold: 0.58,
          minimumDamage: 38,
          radius: 1.45,
          explode: true,
        });
      }
    }
    source.dispose();
  }
  for (const part of damageParts)
    detachable.push({
      object: part.object,
      kind:
        part.type === "wing"
          ? "rear-wing"
          : part.side < 0
            ? "left-mirror"
            : "right-mirror",
      mass: part.type === "wing" ? 7 : 1.4,
      threshold: part.type === "wing" ? 0.47 : 0.32,
      minimumDamage: part.type === "wing" ? 28 : 12,
      radius: part.type === "wing" ? 1.55 : 1.05,
      explode: true,
    });
  wheels.forEach((object, index) =>
    detachable.push({
      object,
      kind: `wheel-${index}`,
      mass: 23,
      threshold: 0.83,
      minimumDamage: 68,
      radius: 0.9,
      explode: index === 0 || index === 3,
    }),
  );

  // A dark cockpit is exposed by missing glass; it is invisible in a new car.
  const wreckInterior = new THREE.Group();
  wreckInterior.name = "Exposed cabin after glass failure";
  wreckInterior.visible = false;
  shell.add(wreckInterior);
  const upholstery = new THREE.MeshStandardMaterial({
    color: 0x17191c,
    roughness: 0.95,
  });
  for (const side of [-1, 1]) {
    box(0.39, 0.1, 0.5, side * 0.34, 0.14, -0.42, upholstery, wreckInterior);
    const back = box(
      0.38,
      0.28,
      0.1,
      side * 0.34,
      0.28,
      -0.67,
      upholstery,
      wreckInterior,
    );
    back.rotation.x = -0.13;
    box(0.24, 0.08, 0.08, side * 0.34, 0.43, -0.68, upholstery, wreckInterior);
  }
  box(1.24, 0.1, 0.16, 0, 0.19, 0.46, black, wreckInterior);
  const steeringWheel = mesh(
    new THREE.TorusGeometry(0.095, 0.016, 6, 20),
    trim,
    wreckInterior,
  );
  steeringWheel.position.set(-0.34, 0.25, 0.28);
  steeringWheel.rotation.x = -0.5;
  consolidate(wreckInterior);

  // Glass cracks and jagged remaining edges are prebuilt. Damage changes their
  // visibility; no texture uploads or fracture geometries occur in the frame loop.
  const crackMaterial = new THREE.LineBasicMaterial({
    color: 0xb9d4dc,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });
  const brokenGlass = new THREE.MeshPhysicalMaterial({
    color: 0x263c46,
    metalness: 0.18,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const panes = [];
  for (const pane of [...canopy.children].filter(
    (o) => o.isMesh && o.material === glass,
  )) {
    const attribute = pane.geometry.attributes.position;
    const corners = Array.from({ length: attribute.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(attribute, i),
    );
    const center = corners
      .reduce((p, c) => p.add(c), new THREE.Vector3())
      .multiplyScalar(1 / corners.length);
    const normal = new THREE.Vector3()
      .subVectors(corners[1], corners[0])
      .cross(new THREE.Vector3().subVectors(corners[2], corners[0]))
      .normalize();
    if (normal.dot(center.clone().sub(new THREE.Vector3(0, 0.32, -0.5))) < 0)
      normal.negate();
    const offset = normal.multiplyScalar(0.003);
    const crackVertices = [],
      shardVertices = [],
      shardFaces = [];
    const putSegment = (a, b) =>
      crackVertices.push(
        a.x + offset.x,
        a.y + offset.y,
        a.z + offset.z,
        b.x + offset.x,
        b.y + offset.y,
        b.z + offset.z,
      );
    for (let ray = 0; ray < 13; ray++) {
      const edge = ray % corners.length;
      const end = corners[edge]
        .clone()
        .lerp(
          corners[(edge + 1) % corners.length],
          0.18 + ((ray * 0.173) % 0.63),
        )
        .lerp(center, 0.045);
      const kink = center
        .clone()
        .lerp(end, 0.46)
        .addScaledVector(
          corners[(edge + 2) % corners.length].clone().sub(center),
          0.025 * Math.sin(ray * 2.1),
        );
      putSegment(center, kink);
      putSegment(kink, end);
      const branch = kink
        .clone()
        .lerp(corners[(edge + 1) % corners.length], 0.26);
      putSegment(kink, branch);
      if (ray < corners.length) {
        const a = corners[ray],
          b = corners[(ray + 1) % corners.length];
        const tip = a
          .clone()
          .lerp(b, 0.42 + 0.13 * Math.sin(ray * 3))
          .lerp(center, 0.14 + 0.11 * Math.abs(Math.sin(ray * 2.7)));
        const start = shardVertices.length;
        shardVertices.push(a.toArray(), b.toArray(), tip.toArray());
        shardFaces.push([start, start + 1, start + 2]);
      }
    }
    const crackGeometry = new THREE.BufferGeometry();
    crackGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(crackVertices, 3),
    );
    const cracks = new THREE.LineSegments(crackGeometry, crackMaterial);
    cracks.name = "Laminated glass spiderweb fracture";
    cracks.visible = false;
    cracks.renderOrder = 2;
    canopy.add(cracks);
    const remnants = surface(
      shardVertices,
      shardFaces,
      brokenGlass,
      canopy,
      "Jagged remaining glass",
    );
    remnants.visible = false;
    panes.push({ object: pane, cracks, remnants, center, stress: 0 });
  }

  // Arrays and attribute objects are retained for the lifetime of this car.
  // All duplicate triangle vertices use the same position-based crease field,
  // avoiding cracks between faces when a localized dent crosses a material seam.
  const deformables = [];
  painted.vertexColors = true;
  group.traverse((object) => {
    if (object.isMesh && object.material === painted) {
      const colors = new Float32Array(
        object.geometry.attributes.position.count * 3,
      ).fill(1);
      object.geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
      );
    }
  });
  shell.traverse((object) => {
    if (!object.isMesh || ![painted, trim, carbon].includes(object.material))
      return;
    if (object.parent === wreckInterior || object === steeringWheel) return;
    let inCanopy = false;
    for (let parent = object.parent; parent; parent = parent.parent)
      if (parent === canopy) inCanopy = true;
    const geometry = object.geometry;
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    deformables.push({
      object,
      geometry,
      inCanopy,
      original: geometry.attributes.position.array.slice(),
      normals: geometry.attributes.normal?.array.slice(),
      colors: geometry.attributes.color?.array,
    });
  });
  const baseTransforms = [
    ...new Set([
      canopy,
      ...wheels,
      ...spinningWheels,
      ...detachable.map((p) => p.object),
    ]),
  ].map((object) => ({
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    visible: object.visible,
  }));
  const materialState = [
    painted,
    trim,
    carbon,
    glass,
    alloy,
    steel,
    lamp,
    redLamp,
    amber,
  ].map((material) => ({
    material,
    color: material.color.clone(),
    roughness: material.roughness,
    metalness: material.metalness,
    clearcoat: material.clearcoat,
    emissiveIntensity: material.emissiveIntensity,
  }));
  const charColor = new THREE.Color(0x29231f);
  const darkMetal = new THREE.Color(0x383633);
  const carInverse = new THREE.Matrix4(),
    localMatrix = new THREE.Matrix4(),
    inverseLocal = new THREE.Matrix4();
  const point = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    vertex = new THREE.Vector3(),
    originalVertex = new THREE.Vector3(),
    displaced = new THREE.Vector3();

  function boundsInObject(object) {
    object.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const bounds = new THREE.Box3();
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.computeBoundingBox();
      if (child.isInstancedMesh) {
        child.computeBoundingBox();
        bounds.union(
          child.boundingBox
            .clone()
            .applyMatrix4(
              new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld),
            ),
        );
      } else
        bounds.union(
          child.geometry.boundingBox
            .clone()
            .applyMatrix4(
              new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld),
            ),
        );
    });
    return bounds;
  }
  group.updateMatrixWorld(true);
  for (const part of detachable) {
    part.anchor = boundsInObject(part.object).getCenter(new THREE.Vector3());
    part.object.localToWorld(part.anchor);
    group.worldToLocal(part.anchor);
    part.pending = false;
    part.detached = false;
    part.object.userData.carPart = part.kind;
  }

  let damage = 0,
    dirty = false,
    crushed = false,
    exploded = false,
    impactCount = 0,
    elapsed = 0;
  function refreshGeometry(record) {
    record.geometry.attributes.position.needsUpdate = true;
    if (record.colors) record.geometry.attributes.color.needsUpdate = true;
    record.geometry.computeVertexNormals();
    record.geometry.computeBoundingBox();
    record.geometry.computeBoundingSphere();
  }
  function updateGlass() {
    let open = false;
    for (const pane of panes) {
      const shattered = damage >= 0.72 || pane.stress > 0.88;
      pane.object.visible = !shattered;
      pane.cracks.visible =
        !shattered && (damage >= 0.22 || pane.stress > 0.13);
      pane.remnants.visible = shattered;
      open ||= shattered;
    }
    wreckInterior.visible = open;
  }
  function crushShell() {
    if (crushed) return;
    crushed = true;
    group.updateMatrixWorld(true);
    carInverse.copy(group.matrixWorld).invert();
    for (const record of deformables) {
      if (record.inCanopy) continue;
      localMatrix.multiplyMatrices(carInverse, record.object.matrixWorld);
      inverseLocal.copy(localMatrix).invert();
      const positions = record.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        vertex.fromArray(positions, i).applyMatrix4(localMatrix);
        if (Math.abs(vertex.z) > 1.25)
          vertex.z -=
            Math.sign(vertex.z) *
            0.22 *
            Math.min(1, (Math.abs(vertex.z) - 1.25) / 1.1);
        vertex.y += Math.sin(vertex.z * 9 + vertex.x * 5) * 0.055;
        if (vertex.y > 0.06) vertex.y = 0.06 + (vertex.y - 0.06) * 0.58;
        vertex.x *= 1 + 0.035 * Math.sin(vertex.z * 7);
        vertex.applyMatrix4(inverseLocal).toArray(positions, i);
      }
      refreshGeometry(record);
    }
    canopy.scale.y *= 0.52;
    canopy.position.y -= 0.025;
  }
  function resetDamage() {
    for (const record of deformables) {
      record.geometry.attributes.position.array.set(record.original);
      record.geometry.attributes.position.needsUpdate = true;
      if (record.normals) {
        record.geometry.attributes.normal.array.set(record.normals);
        record.geometry.attributes.normal.needsUpdate = true;
      }
      if (record.colors) {
        record.colors.fill(1);
        record.geometry.attributes.color.needsUpdate = true;
      }
      record.geometry.computeBoundingBox();
      record.geometry.computeBoundingSphere();
    }
    for (const base of baseTransforms) {
      base.object.position.copy(base.position);
      base.object.quaternion.copy(base.quaternion);
      base.object.scale.copy(base.scale);
      base.object.visible = base.visible;
    }
    for (const base of materialState) {
      base.material.color.copy(base.color);
      base.material.roughness = base.roughness;
      base.material.metalness = base.metalness;
      if (base.clearcoat !== undefined)
        base.material.clearcoat = base.clearcoat;
      if (base.emissiveIntensity !== undefined)
        base.material.emissiveIntensity = base.emissiveIntensity;
    }
    for (const part of detachable) {
      part.pending = false;
      part.detached = false;
    }
    for (const pane of panes) {
      pane.stress = 0;
      pane.object.visible = true;
      pane.cracks.visible = false;
      pane.remnants.visible = false;
    }
    wreckInterior.visible = false;
    for (const material of nozzleGlows) material.emissiveIntensity = 0;
    damage = 0;
    dirty = false;
    crushed = false;
    exploded = false;
    impactCount = 0;
    group.userData.damageStage = "intact";
  }
  function setDamage(amount) {
    const next = THREE.MathUtils.clamp((Number(amount) || 0) / 100, 0, 1);
    if (next === 0) {
      if (dirty || damage) resetDamage();
      return;
    }
    if (next === damage) return;
    damage = next;
    dirty = true;
    const burn = THREE.MathUtils.smoothstep(damage, 0.55, 1);
    painted.color.copy(materialState[0].color).lerp(charColor, burn * 0.97);
    painted.roughness = 0.26 + damage * 0.25 + burn * 0.36;
    painted.metalness = 0.69 - burn * 0.43;
    painted.clearcoat = 1 - damage * 0.8;
    alloy.color.copy(materialState[4].color).lerp(darkMetal, burn * 0.65);
    steel.color.copy(materialState[5].color).lerp(darkMetal, burn * 0.5);
    carbon.roughness = 0.53 + burn * 0.37;
    glass.roughness = 0.24 + damage * 0.14;
    lamp.emissiveIntensity = damage >= 0.99 ? 0 : 3.4 * (1 - damage * 0.75);
    redLamp.emissiveIntensity = damage >= 0.99 ? 0 : 3 * (1 - damage * 0.72);
    amber.emissiveIntensity = damage >= 0.99 ? 0 : 0.65 * (1 - damage);
    if (damage >= 0.99) crushShell();
    updateGlass();
    group.userData.damageStage =
      damage >= 0.99
        ? "wreck"
        : damage >= 0.72
          ? "shattered"
          : damage >= 0.22
            ? "cracked"
            : "dented";
  }
  function applyImpact(event = {}) {
    const intensity = THREE.MathUtils.clamp(
      Number(event.intensity ?? event.severity) || 0,
      0,
      1,
    );
    const speed = Math.max(0, Number(event.speed) || 0);
    if (intensity < 0.035 || speed < 0.4) return;
    if (Number.isFinite(event.damage))
      setDamage(Math.max(damage * 100, event.damage));
    point.set(
      Number(event.localPoint?.x) || 0,
      Number(event.localPoint?.y) || 0,
      Number(event.localPoint?.z) || 0,
    );
    normal.set(
      -(Number(event.localNormal?.x) || 0),
      -(Number(event.localNormal?.y) || 0),
      -(Number(event.localNormal?.z) || 0),
    );
    if (normal.lengthSq() < 0.01) normal.copy(point).negate();
    if (normal.lengthSq() < 0.01) normal.set(0, -1, 0);
    normal.normalize();
    // Contact normals face out of the car. Guard inverted integrations by
    // orienting compression toward the center rather than inflating bodywork.
    if (normal.dot(point) > 0.1) normal.negate();
    const radius = 0.52 + intensity * 1.12;
    const depth = Math.min(
      0.55,
      (0.035 + intensity * 0.3) * Math.min(1.4, 0.65 + speed / 22),
    );
    group.updateMatrixWorld(true);
    carInverse.copy(group.matrixWorld).invert();
    for (const record of deformables) {
      if (!record.object.visible) continue;
      localMatrix.multiplyMatrices(carInverse, record.object.matrixWorld);
      inverseLocal.copy(localMatrix).invert();
      const positions = record.geometry.attributes.position.array;
      let changed = false;
      for (let i = 0; i < positions.length; i += 3) {
        originalVertex.fromArray(record.original, i).applyMatrix4(localMatrix);
        const distance = originalVertex.distanceTo(point);
        if (distance >= radius) continue;
        const t = 1 - distance / radius;
        const influence = t * t * (3 - 2 * t);
        const crease =
          0.86 +
          0.14 *
            Math.sin(
              originalVertex.z * 22 + originalVertex.x * 17 + impactCount * 1.7,
            );
        vertex
          .fromArray(positions, i)
          .applyMatrix4(localMatrix)
          .addScaledVector(normal, depth * influence * crease);
        vertex.y +=
          Math.sin(originalVertex.x * 19 + originalVertex.z * 11) *
          depth *
          influence *
          0.12;
        displaced.subVectors(vertex, originalVertex);
        if (displaced.lengthSq() > 0.75 ** 2)
          vertex.copy(originalVertex).add(displaced.setLength(0.75));
        vertex.applyMatrix4(inverseLocal).toArray(positions, i);
        if (record.colors) {
          const shade = Math.max(0.28, 1 - influence * intensity * 0.55);
          for (let k = 0; k < 3; k++)
            record.colors[i + k] = Math.min(record.colors[i + k], shade);
        }
        changed = true;
      }
      if (changed) refreshGeometry(record);
    }
    for (const pane of panes) {
      vertex
        .copy(pane.center)
        .applyMatrix4(canopy.matrixWorld)
        .applyMatrix4(carInverse);
      const distance = vertex.distanceTo(point);
      if (distance < 1.75)
        pane.stress += intensity * (1 - distance / 1.75) * 1.5;
    }
    const nearby = detachable.filter(
      (part) =>
        !part.detached &&
        !part.pending &&
        intensity >= part.threshold &&
        damage * 100 >= part.minimumDamage &&
        part.anchor.distanceTo(point) <= part.radius,
    );
    nearby.sort(
      (a, b) =>
        a.anchor.distanceToSquared(point) - b.anchor.distanceToSquared(point),
    );
    for (const part of nearby.slice(0, 2)) part.pending = true;
    impactCount++;
    dirty = true;
    updateGlass();
  }
  function clonePart(part) {
    const source = part.object;
    source.updateWorldMatrix(true, true);
    const bounds = boundsInObject(source);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const position = new THREE.Vector3(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    source.matrixWorld.decompose(position, rotation, scale);
    const object = new THREE.Group();
    object.name = `Detached Roadster ${part.kind}`;
    object.position.copy(center).applyMatrix4(source.matrixWorld);
    object.quaternion.copy(rotation);
    object.scale.copy(scale);
    object.userData.carDebris = true;
    object.userData.kind = part.kind;
    const clone = source.clone(true),
      geometries = new Map(),
      materials = new Map();
    clone.traverse((child) => {
      if (child.geometry) {
        if (!geometries.has(child.geometry))
          geometries.set(child.geometry, child.geometry.clone());
        child.geometry = geometries.get(child.geometry);
      }
      if (child.material) {
        const copyMaterial = (material) => {
          if (!materials.has(material))
            materials.set(material, material.clone());
          return materials.get(material);
        };
        child.material = Array.isArray(child.material)
          ? child.material.map(copyMaterial)
          : copyMaterial(child.material);
      }
    });
    clone.position.copy(center).negate();
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    clone.visible = true;
    object.add(clone);
    object.updateMatrixWorld(true);
    return {
      object,
      size: [
        Math.max(0.045, size.x * Math.abs(scale.x)),
        Math.max(0.045, size.y * Math.abs(scale.y)),
        Math.max(0.045, size.z * Math.abs(scale.z)),
      ],
      mass: part.mass,
      kind: part.kind,
    };
  }
  function takeDebris({ explode = false } = {}) {
    if (explode && !exploded) {
      setDamage(100);
      exploded = true;
      for (const part of detachable)
        if (part.explode && !part.detached) part.pending = true;
    }
    const pieces = [];
    for (const part of detachable) {
      if (!part.pending || part.detached) continue;
      pieces.push(clonePart(part));
      part.pending = false;
      part.detached = true;
      part.object.visible = false;
    }
    if (pieces.length) dirty = true;
    return pieces;
  }
  function update(dt, { speed = 0, steer = 0, boosters: active = [] } = {}) {
    elapsed += dt;
    for (let i = 0; i < spinningWheels.length; i++) {
      spinningWheels[i].rotation.x += (speed * dt) / 0.36;
      wheels[i].rotation.y = i < 2 ? steer : 0;
    }
    for (let i = 0; i < nozzleGlows.length; i++)
      nozzleGlows[i].emissiveIntensity =
        damage >= 0.99 ? 0 : (Number(active[i]) || 0) * 7;
    if (damage > 0.65 && damage < 0.99)
      lamp.emissiveIntensity =
        3.4 *
        (1 - damage * 0.75) *
        (0.5 + 0.5 * Math.max(0, Math.sin(elapsed * 31)));
  }
  return {
    group,
    wheels,
    boosters,
    setDamage,
    applyImpact,
    takeDebris,
    update,
  };
}
