import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Rounded 911 rival. +Z is forward; the wheel contact plane is y=-.71.
 * Parts handed to takeDebris own their geometry/materials and are centered in
 * world space, so the existing WreckEffects can simulate and dispose of them.
 */
export function createPorsche({ color = 0xf2c329 } = {}) {
  const group = new THREE.Group();
  group.name = "Porsche 911 / drag rival";
  group.userData.damageStage = "intact";
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.42,
      roughness: 0.27,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
      side: THREE.DoubleSide,
    }),
    black: new THREE.MeshStandardMaterial({
      color: 0x101318,
      metalness: 0.3,
      roughness: 0.43,
      side: THREE.DoubleSide,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x151719,
      roughness: 0.94,
    }),
    alloy: new THREE.MeshStandardMaterial({
      color: 0x3c4147,
      metalness: 0.91,
      roughness: 0.22,
    }),
    disc: new THREE.MeshStandardMaterial({
      color: 0x747b7d,
      metalness: 0.85,
      roughness: 0.48,
    }),
    caliper: new THREE.MeshStandardMaterial({
      color: 0xf5cf22,
      metalness: 0.35,
      roughness: 0.4,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x101b23,
      metalness: 0.15,
      roughness: 0.16,
      clearcoat: 1,
      envMapIntensity: 0.55,
      side: THREE.DoubleSide,
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xdbeeff,
      emissive: 0xa9d5ff,
      emissiveIntensity: 2.7,
      roughness: 0.2,
    }),
    red: new THREE.MeshStandardMaterial({
      color: 0xe82134,
      emissive: 0xee1028,
      emissiveIntensity: 2,
      roughness: 0.24,
    }),
    lettering: new THREE.MeshStandardMaterial({
      color: 0xe0e2df,
      metalness: 0.8,
      roughness: 0.3,
    }),
    crest: new THREE.MeshStandardMaterial({
      color: 0xb59345,
      metalness: 0.65,
      roughness: 0.3,
    }),
  };
  const shell = new THREE.Group();
  shell.name = "911 rounded coachwork";
  group.add(shell);
  const detachable = [];
  const wheels = [],
    spinning = [];
  function add(geometry, material, parent = shell, name = "") {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.castShadow = object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(
    w,
    h,
    d,
    x,
    y,
    z,
    mat = materials.black,
    parent = shell,
    name = "",
  ) {
    const o = add(new THREE.BoxGeometry(w, h, d), mat, parent, name);
    o.position.set(x, y, z);
    return o;
  }
  function surface(points, indices, mat, parent = shell, name = "") {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points.flat(), 3),
    );
    geo.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        points.flatMap(() => [0, 0]),
        2,
      ),
    );
    geo.setIndex(indices.flat());
    geo.computeVertexNormals();
    return add(geo, mat, parent, name);
  }
  function grid(rows, cols, fn, mat, parent = shell, name = "") {
    const p = [],
      f = [];
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= cols; c++) p.push(fn(r / rows, c / cols));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c,
          b = a + cols + 1;
        f.push([a, b, a + 1], [a + 1, b, b + 1]);
      }
    return surface(p, f, mat, parent, name);
  }
  function tube(points, radius, material, parent = shell) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    );
    return add(
      new THREE.TubeGeometry(
        curve,
        Math.max(8, points.length * 4),
        radius,
        6,
        false,
      ),
      material,
      parent,
    );
  }
  function part(kind, mass) {
    const object = new THREE.Group();
    object.name = `911 ${kind}`;
    object.userData.carPart = kind;
    group.add(object);
    detachable.push({ object, kind, mass, pending: false, detached: false });
    return object;
  }
  // Interpolated longitudinal stations preserve the broad rear haunches,
  // narrow waist, low hood and high oval front fenders of the 911 silhouette.
  const sections = [
    [-2.24, 0.76, 0.09],
    [-2.08, 0.91, 0.19],
    [-1.7, 1.01, 0.29],
    [-1.36, 1.025, 0.31],
    [-0.85, 0.96, 0.23],
    [-0.35, 0.92, 0.17],
    [0.35, 0.92, 0.17],
    [0.85, 0.96, 0.2],
    [1.27, 0.985, 0.25],
    [1.65, 0.95, 0.23],
    [1.96, 0.84, 0.13],
    [2.22, 0.62, -0.04],
  ];
  function section(z) {
    let i = 0;
    while (i < sections.length - 2 && sections[i + 1][0] < z) i++;
    const a = sections[i],
      b = sections[i + 1],
      t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return [
      THREE.MathUtils.lerp(a[1], b[1], t),
      THREE.MathUtils.lerp(a[2], b[2], t),
    ];
  }
  function arch(z) {
    let y = -0.43;
    for (const center of [-1.37, 1.28]) {
      const d = z - center;
      if (Math.abs(d) < 0.417)
        y = Math.max(y, -0.35 + Math.sqrt(0.417 * 0.417 - d * d));
    }
    return y;
  }
  for (const side of [-1, 1]) {
    grid(
      160,
      6,
      (u, v) => {
        const z = THREE.MathUtils.lerp(-2.24, 2.22, u),
          [w, y] = section(z),
          bottom = arch(z);
        return [
          side * (w - 0.05 * Math.pow(2 * v - 1, 2)),
          THREE.MathUtils.lerp(bottom, y, v),
          z,
        ];
      },
      materials.paint,
    );
    // Fine dark arch lips leave the entire tire silhouette exposed.
    for (const z of [-1.37, 1.28]) {
      const points = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI,
          zz = z + Math.cos(a) * 0.419;
        points.push([
          side * (section(zz)[0] - 0.009),
          -0.35 + Math.sin(a) * 0.419,
          zz,
        ]);
      }
      tube(points, 0.013, materials.black);
    }
    box(0.045, 0.085, 1.64, side * 0.93, -0.405, -0.03, materials.black);
    // Window sill and the curved seam outline distinguish the long coupe doors.
    tube(
      [
        [side * 0.925, 0.155, 0.72],
        [side * 0.923, -0.24, 0.6],
        [side * 0.94, -0.32, -0.58],
        [side * 0.96, 0.2, -0.77],
      ],
      0.008,
      materials.black,
    );
    box(0.12, 0.027, 0.033, side * 0.947, 0.105, -0.45, materials.black);
  }
  // Upper shell edges curve down into the bumper; the narrow center hood is a
  // separate panel so the front of the car visibly opens after an explosion.
  for (const side of [-1, 1])
    grid(
      96,
      10,
      (u, v) => {
        const z = THREE.MathUtils.lerp(-2.24, 2.22, u),
          [w, y] = section(z),
          x = THREE.MathUtils.lerp(0.54, w, v);
        const fender =
          Math.exp(-Math.pow((z - 1.25) / 0.64, 2)) *
          0.092 *
          Math.sin(v * Math.PI);
        return [side * x, y - 0.065 * (1 - v) + fender, z];
      },
      materials.paint,
    );
  grid(
    44,
    16,
    (u, v) => {
      const z = THREE.MathUtils.lerp(-1.68, 0.85, u),
        [, y] = section(z),
        x = (v * 2 - 1) * 0.55;
      return [x, y - 0.06 + 0.025 * (1 - Math.pow(x / 0.55, 2)), z];
    },
    materials.paint,
  );
  const hood = part("hood", 12);
  grid(
    30,
    16,
    (u, v) => {
      const z = THREE.MathUtils.lerp(0.85, 2.17, u),
        [w, y] = section(z),
        x = (v * 2 - 1) * Math.min(0.545, w - 0.05);
      return [x, y - 0.059 + 0.025 * (1 - Math.pow(x / 0.55, 2)), z];
    },
    materials.paint,
    hood,
  );
  // Flat undertray remains behind the detached panels and wheels.
  box(1.59, 0.13, 3.8, 0, -0.4, -0.02, materials.black);
  const front = part("front-bumper", 11);
  grid(
    12,
    24,
    (u, v) => {
      const x = (v * 2 - 1) * 0.86,
        z = 2.22 - 0.23 * Math.pow(x / 0.86, 2);
      return [
        x,
        THREE.MathUtils.lerp(-0.41, -0.065, u),
        z + 0.035 * Math.sin(u * Math.PI),
      ];
    },
    materials.paint,
    front,
  );
  box(1.18, 0.145, 0.025, 0, -0.235, 2.255, materials.black, front);
  for (const side of [-1, 1]) {
    box(0.2, 0.145, 0.032, side * 0.715, -0.24, 2.09, materials.black, front);
    box(0.21, 0.026, 0.043, side * 0.708, -0.101, 2.112, materials.lamp, front);
  }
  box(1.74, 0.035, 0.22, 0, -0.435, 2.04, materials.black, front);
  // Round, recessed headlamps tilted with the hood, each with four DRL dots.
  for (const side of [-1, 1]) {
    const housing = new THREE.Group();
    housing.position.set(side * 0.738, 0.17, 1.775);
    housing.rotation.x = -1.04;
    shell.add(housing);
    const bezel = add(
      new THREE.SphereGeometry(0.188, 24, 12),
      materials.black,
      housing,
    );
    bezel.scale.set(1, 1.16, 0.28);
    const lens = add(
      new THREE.CircleGeometry(0.154, 32),
      materials.glass,
      housing,
    );
    lens.position.z = 0.057;
    const rim = add(
      new THREE.TorusGeometry(0.159, 0.012, 6, 32),
      materials.lamp,
      housing,
    );
    rim.position.z = 0.062;
    rim.scale.y = 1.12;
    for (const [x, y] of [
      [-0.064, -0.063],
      [0.064, -0.063],
      [-0.064, 0.063],
      [0.064, 0.063],
    ]) {
      const o = add(
        new THREE.CircleGeometry(0.024, 8),
        materials.lamp,
        housing,
      );
      o.position.set(x, y, 0.065);
    }
  }
  // One continuously curved roof with the classic rearward fastback profile.
  const roofHeight = (z) => 0.645 - 0.075 * Math.pow((z + 0.22) / 0.72, 2);
  grid(
    24,
    20,
    (u, v) => {
      const z = THREE.MathUtils.lerp(-0.79, 0.29, u),
        x = (v * 2 - 1) * 0.64;
      return [x, roofHeight(z) - 0.085 * Math.pow(x / 0.64, 2), z];
    },
    materials.paint,
    shell,
    "911 arched roof",
  );
  function windshield(rear) {
    grid(
      16,
      20,
      (u, v) => {
        const topZ = rear ? -0.75 : 0.25,
          bottomZ = rear ? -1.6 : 0.99,
          z = THREE.MathUtils.lerp(bottomZ, topZ, u);
        const width = THREE.MathUtils.lerp(rear ? 0.63 : 0.73, 0.62, u),
          x = (v * 2 - 1) * width;
        const y =
          THREE.MathUtils.lerp(rear ? 0.27 : 0.178, roofHeight(topZ), u) -
          0.075 * Math.pow(x / width, 2) * u +
          0.024 * Math.sin(u * Math.PI);
        return [x, y, z];
      },
      materials.glass,
      shell,
      rear ? "911 sloping rear glass" : "911 curved windshield",
    );
  }
  windshield(false);
  windshield(true);
  for (const side of [-1, 1])
    surface(
      [
        [side * 0.64, 0.548, -0.75],
        [side * 0.63, 0.27, -1.6],
        [side * 0.99, 0.294, -1.6],
        [side * 0.755, 0.25, -1.2],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
      materials.paint,
    );

  for (const side of [-1, 1]) {
    const pts = [
      [side * 0.728, 0.19, 0.93],
      [side * 0.616, 0.542, 0.25],
      [side * 0.63, 0.538, -0.73],
      [side * 0.755, 0.25, -1.2],
      [side * 0.88, 0.19, -0.78],
    ];
    surface(
      pts,
      [
        [0, 1, 2],
        [0, 2, 4],
        [2, 3, 4],
      ],
      materials.glass,
      shell,
      "911 side glazing",
    );
    tube(
      [
        [side * 0.73, 0.184, 1],
        [side * 0.63, 0.56, 0.27],
        [side * 0.64, 0.558, -0.73],
        [side * 0.76, 0.25, -1.26],
      ],
      0.028,
      materials.paint,
    );
    tube(
      [
        [side * 0.88, 0.18, -0.78],
        [side * 0.74, 0.18, 0.94],
      ],
      0.018,
      materials.paint,
    );
    tube(
      [
        [side * 0.638, 0.54, -0.36],
        [side * 0.839, 0.194, -0.42],
      ],
      0.018,
      materials.black,
    );
    box(0.055, 0.035, 0.2, side * 0.91, 0.19, 0.66, materials.black);
    const mirror = add(new THREE.SphereGeometry(1, 16, 8), materials.paint);
    mirror.scale.set(0.14, 0.07, 0.115);
    mirror.position.set(side * 1.04, 0.23, 0.68);
    const glass = add(new THREE.SphereGeometry(1, 12, 6), materials.glass);
    glass.scale.set(0.102, 0.046, 0.012);
    glass.position.set(side * 1.055, 0.23, 0.574);
  }
  const deck = part("rear-deck", 9);
  grid(
    16,
    16,
    (u, v) => {
      const z = THREE.MathUtils.lerp(-2.15, -1.61, u),
        x = (v * 2 - 1) * 0.55;
      return [
        x,
        section(z)[1] - 0.044 + 0.018 * (1 - Math.pow(x / 0.55, 2)),
        z,
      ];
    },
    materials.paint,
    deck,
  );
  for (let i = -5; i <= 5; i++)
    box(0.026, 0.014, 0.24, i * 0.067, 0.237, -1.77, materials.black, deck);
  const rear = part("rear-bumper", 13);
  grid(
    12,
    24,
    (u, v) => {
      const x = (v * 2 - 1) * 0.9,
        z = -2.24 + 0.15 * Math.pow(x / 0.9, 2);
      return [
        x,
        THREE.MathUtils.lerp(-0.42, 0.12, u),
        z - 0.035 * Math.sin(u * Math.PI),
      ];
    },
    materials.paint,
    rear,
  );
  box(1.5, 0.12, 0.025, 0, -0.24, -2.278, materials.black, rear);
  box(1.64, 0.027, 0.025, 0, 0.09, -2.253, materials.red, rear);
  for (const side of [-1, 1]) {
    const exhaust = add(
      new THREE.CylinderGeometry(0.065, 0.07, 0.18, 16),
      materials.alloy,
      rear,
    );
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(side * 0.22, -0.35, -2.25);
    const bore = add(
      new THREE.CircleGeometry(0.051, 14),
      materials.black,
      rear,
    );
    bore.rotation.y = Math.PI;
    bore.position.set(side * 0.22, -0.35, -2.345);
    for (let i = 0; i < 3; i++)
      box(
        0.017,
        0.11,
        0.35,
        side * (0.4 + i * 0.18),
        -0.39,
        -2.13,
        materials.black,
        rear,
      );
  }
  // GT rear wing, thin endplates and swan-neck-style supports.
  const wing = part("rear-wing", 8);
  for (const side of [-1, 1]) {
    tube(
      [
        [side * 0.46, 0.23, -1.72],
        [side * 0.46, 0.57, -1.72],
        [side * 0.46, 0.66, -1.95],
      ],
      0.022,
      materials.black,
      wing,
    );
    box(0.034, 0.15, 0.38, side * 0.91, 0.64, -1.99, materials.black, wing);
  }
  const wingBlade = box(
    1.85,
    0.047,
    0.36,
    0,
    0.64,
    -1.99,
    materials.black,
    wing,
  );
  wingBlade.rotation.x = 0.06;
  box(1.81, 0.028, 0.035, 0, 0.666, -2.16, materials.paint, wing);
  // Small vector lettering avoids a texture allocation and stays sharp when
  // the camera follows directly behind the rival.
  const glyph = {
    P: [
      [0, 0, 0, 1],
      [0, 1, 0.65, 1],
      [0.65, 1, 0.65, 0.55],
      [0.65, 0.55, 0, 0.55],
    ],
    O: [
      [0, 0, 0, 1],
      [0, 1, 0.65, 1],
      [0.65, 1, 0.65, 0],
      [0.65, 0, 0, 0],
    ],
    R: [
      [0, 0, 0, 1],
      [0, 1, 0.65, 1],
      [0.65, 1, 0.65, 0.55],
      [0.65, 0.55, 0, 0.55],
      [0.25, 0.55, 0.7, 0],
    ],
    S: [
      [0.65, 1, 0, 1],
      [0, 1, 0, 0.55],
      [0, 0.55, 0.65, 0.55],
      [0.65, 0.55, 0.65, 0],
      [0.65, 0, 0, 0],
    ],
    C: [
      [0.65, 1, 0, 1],
      [0, 1, 0, 0],
      [0, 0, 0.65, 0],
    ],
    H: [
      [0, 0, 0, 1],
      [0.65, 0, 0.65, 1],
      [0, 0.5, 0.65, 0.5],
    ],
    E: [
      [0, 0, 0, 1],
      [0, 1, 0.65, 1],
      [0, 0.5, 0.5, 0.5],
      [0, 0, 0.65, 0],
    ],
  };
  const text = "PORSCHE",
    height = 0.055,
    advance = 0.13;
  for (let i = 0; i < text.length; i++)
    for (const [ax, ay, bx, by] of glyph[text[i]]) {
      const x = ((text.length - 1) / 2) * advance - i * advance;
      tube(
        [
          [x - ax * height, -0.035 + ay * height, -2.285],
          [x - bx * height, -0.035 + by * height, -2.285],
        ],
        0.0045,
        materials.lettering,
        rear,
      );
    }
  // Front crest: shield outline, dark center and red bars.
  const crest = surface(
    [
      [-0.035, 0.095, 1.98],
      [0.035, 0.095, 1.98],
      [0.027, 0.077, 2.035],
      [0, 0.071, 2.055],
      [-0.027, 0.077, 2.035],
    ],
    [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
    ],
    materials.crest,
    hood,
  );
  crest.name = "Porsche crest";
  box(0.036, 0.004, 0.033, 0, 0.097, 2.006, materials.black, hood);
  // Four real wheel assemblies. Rotating spokes, tire, disc and red centerlocks
  // are merged per material inside each wheel, not duplicated per spoke.
  for (const [i, x, z] of [
    [0, -0.945, 1.28],
    [1, 0.945, 1.28],
    [2, -0.971, -1.37],
    [3, 0.971, -1.37],
  ]) {
    const pivot = part(`wheel-${i}`, 22);
    pivot.position.set(x, -0.35, z);
    wheels.push(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    spinning.push(spin);
    const side = Math.sign(x);
    const tire = add(
      new THREE.TorusGeometry(0.273, 0.087, 10, 32),
      materials.rubber,
      spin,
    );
    tire.rotation.y = Math.PI / 2;
    tire.scale.z = 1.65;
    const rim = add(
      new THREE.CylinderGeometry(0.263, 0.263, 0.2, 28, 1, true),
      materials.alloy,
      spin,
    );
    rim.rotation.z = Math.PI / 2;
    const disc = add(
      new THREE.CylinderGeometry(0.216, 0.216, 0.025, 28),
      materials.disc,
      spin,
    );
    disc.rotation.z = Math.PI / 2;
    disc.position.x = side * 0.07;
    const lip = add(
      new THREE.TorusGeometry(0.251, 0.012, 6, 28),
      materials.alloy,
      spin,
    );
    lip.rotation.y = Math.PI / 2;
    lip.position.x = side * 0.116;
    for (let j = 0; j < 10; j++) {
      const angle = (j / 10) * Math.PI * 2,
        spoke = box(
          0.031,
          0.025,
          0.233,
          side * 0.12,
          Math.sin(angle) * 0.11,
          Math.cos(angle) * 0.11,
          materials.alloy,
          spin,
        );
      spoke.rotation.x = -angle;
    }
    const hub = add(
      new THREE.CylinderGeometry(0.053, 0.053, 0.04, 16),
      materials.alloy,
      spin,
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * 0.135;
    const lock = add(
      new THREE.CylinderGeometry(0.027, 0.027, 0.045, 6),
      materials.red,
      spin,
    );
    lock.rotation.z = Math.PI / 2;
    lock.position.x = side * 0.15;
    box(
      0.065,
      0.145,
      0.065,
      side * 0.094,
      0.09,
      -0.13,
      materials.caliper,
      pivot,
    );
  }
  // Bake meshes by material in each independently moving or detachable group.
  // This keeps the complete rival under fifty draw calls, including its wheels.
  function batch(root) {
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert(),
      buckets = new Map(),
      original = [];
    root.traverse((o) => {
      if (o.isMesh) {
        const key = o.material;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        const g = o.geometry.index
          ? o.geometry.toNonIndexed()
          : o.geometry.clone();
        g.applyMatrix4(
          new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld),
        );
        list.push(g);
        original.push(o);
      }
    });
    for (const o of original) {
      o.removeFromParent();
      o.geometry.dispose();
    }
    // The static shell contains empty helper groups after baking.
    for (const [material, list] of buckets) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      add(
        geo,
        material,
        root,
        `${root.name} / ${Object.keys(materials).find((k) => materials[k] === material)}`,
      );
    }
  }
  batch(shell);
  for (const p of detachable) {
    if (p.kind.startsWith("wheel")) {
      batch(p.object.children[0]);
    } else batch(p.object);
  }
  const rest = [];
  group.traverse((o) => {
    if (o === group) return;
    const record = {
      object: o,
      position: o.position.clone(),
      quaternion: o.quaternion.clone(),
      scale: o.scale.clone(),
      visible: o.visible,
    };
    if (o.geometry)
      record.vertices = o.geometry.attributes.position.array.slice();
    rest.push(record);
  });
  const paintColor = materials.paint.color.clone();
  let damage = 0,
    exploded = false,
    dirty = false,
    disposed = false;
  function reset() {
    for (const r of rest) {
      r.object.position.copy(r.position);
      r.object.quaternion.copy(r.quaternion);
      r.object.scale.copy(r.scale);
      r.object.visible = r.visible;
      if (r.vertices) {
        const a = r.object.geometry.attributes.position;
        a.array.set(r.vertices);
        a.needsUpdate = true;
        r.object.geometry.computeVertexNormals();
        r.object.geometry.computeBoundingSphere();
      }
    }
    for (const p of detachable) {
      p.pending = p.detached = false;
    }
    materials.paint.color.copy(paintColor);
    materials.paint.roughness = 0.27;
    materials.glass.color.setHex(0x101b23);
    materials.lamp.emissiveIntensity = 2.7;
    materials.red.emissiveIntensity = 2;
    damage = 0;
    exploded = false;
    dirty = false;
    group.userData.damageStage = "intact";
  }
  function setDamage(amount) {
    const next = THREE.MathUtils.clamp(Number(amount) || 0, 0, 100);
    if (!next) {
      if (dirty || damage) reset();
      return;
    }
    if (next === damage) return;
    damage = next;
    dirty = true;
    group.userData.damageStage =
      next >= 99 ? "wreck" : next >= 50 ? "damaged" : "dented";
    materials.paint.color
      .copy(paintColor)
      .lerp(new THREE.Color(0x171715), Math.pow(next / 100, 1.6) * 0.96);
    materials.paint.roughness = 0.27 + next * 0.0055;
    materials.lamp.emissiveIntensity = next >= 99 ? 0 : 2.7 * (1 - next / 140);
    materials.red.emissiveIntensity = next >= 99 ? 0 : 2;
    if (next >= 75) materials.glass.color.setHex(0x07090b);
  }
  function applyImpact(event = {}) {
    const intensity = THREE.MathUtils.clamp(event.intensity || 0.2, 0, 1),
      point = new THREE.Vector3().copy(
        event.localPoint || { x: 0, y: 0, z: 2 },
      );
    const normal = new THREE.Vector3()
        .copy(event.localNormal || { x: 0, y: 0, z: 1 })
        .normalize(),
      radius = 0.55 + intensity * 0.9;
    shell.updateMatrix();
    for (const r of rest) {
      if (!r.vertices || r.object.parent !== shell) continue;
      const a = r.object.geometry.attributes.position,
        v = new THREE.Vector3();
      let changed = false;
      for (let i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i);
        const d = v.distanceTo(point);
        if (d > radius) continue;
        v.addScaledVector(
          normal,
          -Math.pow(1 - d / radius, 2) * intensity * 0.2,
        );
        a.setXYZ(i, v.x, v.y, v.z);
        changed = true;
      }
      if (changed) {
        a.needsUpdate = true;
        r.object.geometry.computeVertexNormals();
        r.object.geometry.computeBoundingSphere();
      }
    }
    if (intensity > 0.68) {
      const nearest = detachable
        .filter((p) => !p.detached)
        .sort(
          (a, b) =>
            new THREE.Box3()
              .setFromObject(a.object)
              .getCenter(new THREE.Vector3())
              .distanceToSquared(group.localToWorld(point.clone())) -
            new THREE.Box3()
              .setFromObject(b.object)
              .getCenter(new THREE.Vector3())
              .distanceToSquared(group.localToWorld(point.clone())),
        )[0];
      if (nearest) nearest.pending = true;
    }
    dirty = true;
    setDamage(
      Math.max(damage, Number(event.damage) || damage + intensity * 14),
    );
  }
  function cloneDebris(p) {
    p.object.updateWorldMatrix(true, true);
    const inverse = p.object.matrixWorld.clone().invert(),
      bounds = new THREE.Box3(),
      vertex = new THREE.Vector3();
    p.object.traverse((o) => {
      if (o.geometry) {
        const matrix = new THREE.Matrix4().multiplyMatrices(
            inverse,
            o.matrixWorld,
          ),
          a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++)
          bounds.expandByPoint(
            vertex.fromBufferAttribute(a, i).applyMatrix4(matrix),
          );
      }
    });
    const center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3()),
      object = new THREE.Group(),
      scale = new THREE.Vector3();
    p.object.matrixWorld.decompose(object.position, object.quaternion, scale);
    object.position.copy(center).applyMatrix4(p.object.matrixWorld);
    object.scale.copy(scale);
    object.name = `Detached Porsche ${p.kind}`;
    object.userData.carDebris = true;
    object.userData.kind = p.kind;
    const clone = p.object.clone(true),
      geos = new Map(),
      mats = new Map();
    clone.traverse((o) => {
      if (o.geometry) {
        if (!geos.has(o.geometry)) geos.set(o.geometry, o.geometry.clone());
        o.geometry = geos.get(o.geometry);
      }
      if (o.material) {
        if (!mats.has(o.material)) mats.set(o.material, o.material.clone());
        o.material = mats.get(o.material);
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
      mass: p.mass,
      kind: p.kind,
    };
  }
  function takeDebris({ explode = false } = {}) {
    if (explode && !exploded) {
      exploded = true;
      setDamage(100);
      for (const p of detachable) if (!p.detached) p.pending = true;
    }
    const result = [];
    for (const p of detachable) {
      if (!p.pending || p.detached) continue;
      result.push(cloneDebris(p));
      p.pending = false;
      p.detached = true;
      p.object.visible = false;
      dirty = true;
    }
    return result;
  }
  function update(dt, { speed = 0, steer = 0 } = {}) {
    for (let i = 0; i < 4; i++) {
      spinning[i].rotation.x += (speed * dt) / 0.36;
      wheels[i].rotation.y = i < 2 ? steer : 0;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    const geos = new Set();
    group.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
    });
    for (const geo of geos) geo.dispose();
    for (const material of Object.values(materials)) material.dispose();
    group.removeFromParent();
  }
  return {
    group,
    wheels,
    boosters: [],
    setDamage,
    applyImpact,
    takeDebris,
    update,
    dispose,
  };
}
