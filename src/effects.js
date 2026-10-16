import * as THREE from "three";

const COUNT = 600;
const EMPTY_LEVELS = [0, 0, 0, 0];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const particleVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aKind;
  attribute float aSeed;
  attribute vec3 aColor;
  uniform float uPointScale;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha; vKind = aKind; vSeed = aSeed; vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aAlpha > 0.001
      ? clamp(aSize * uPointScale * projectionMatrix[1][1] / max(0.5, -mvPosition.z), 1.0, 180.0)
      : 0.0;
    #include <fog_vertex>
  }
`;

const particleFragment = /* glsl */ `
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying vec3 vColor;
  uniform float uTime;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  void main() {
    if (vAlpha < 0.002) discard;
    vec2 p=gl_PointCoord*2.0-1.0;
    float r=length(p);
    if (r>1.0) discard;
    float alpha;
    vec3 color=vColor;
    if (vKind>0.5 && vKind<1.5) {
      float core=exp(-r*r*22.0);
      float halo=exp(-r*r*5.5)*0.32;
      alpha=(core+halo)*vAlpha;
      color*=1.0+core*1.8;
    } else {
      float n=noise(p*3.1+vSeed+uTime*0.13)*0.67+noise(p*6.7-vSeed)*0.33;
      float edge=1.0-smoothstep(0.28,1.0,r+n*0.16);
      alpha=pow(edge,1.6)*(0.62+n*0.38)*vAlpha;
      color*=0.9+n*0.15;
    }
    if (alpha<0.003) discard;
    gl_FragColor=vec4(color,alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const flameVertex = /* glsl */ `
  attribute float aLevel;
  attribute float aPhase;
  varying vec2 vUv;
  varying float vLevel;
  varying float vPhase;
  varying vec3 vNormal;
  varying vec3 vView;
  #include <fog_pars_vertex>
  void main() {
    vUv=uv; vLevel=aLevel; vPhase=aPhase;
    vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(position,1.0);
    vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);
    vView=-mvPosition.xyz;
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
  }
`;

const flameFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vLevel;
  varying float vPhase;
  varying vec3 vNormal;
  varying vec3 vView;
  #include <fog_pars_fragment>
  void main() {
    if(vLevel<0.005)discard;
    float t=vUv.y;
    float facing=pow(abs(dot(normalize(vNormal),normalize(vView))),0.48);
    float diamond=pow(0.5+0.5*sin(t*47.0-uTime*21.0+vPhase),5.0);
    float flutter=0.90+0.10*sin(t*72.0-uTime*87.0+vPhase*7.0);
    float tip=pow(max(0.0,1.0-t),0.65);
    float alpha=tip*facing*flutter*(0.55+vLevel*0.35);
    vec3 blue=vec3(0.035,0.25,1.4);
    vec3 white=vec3(2.8,3.5,4.8);
    float core=clamp(pow(1.0-t,3.0)*0.8+diamond*0.2,0.0,1.0);
    vec3 color=mix(blue,white,core)*(0.72+vLevel*0.68);
    gl_FragColor=vec4(color,alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeFlameGeometry() {
  const positions = [],
    uvs = [],
    indices = [];
  const radial = 10,
    length = 18;
  for (let j = 0; j <= length; j++) {
    const t = j / length;
    // Small throat, expanding gas core, then a long tapered exhaust tip.
    const radius =
      (0.05 + Math.sin(Math.min(t * 3.4, Math.PI)) * 0.055) *
        Math.pow(1 - t, 0.62) +
      0.001;
    for (let i = 0; i <= radial; i++) {
      const angle = (i / radial) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, -t, Math.sin(angle) * radius);
      uvs.push(i / radial, t);
      if (j < length && i < radial) {
        const a = j * (radial + 1) + i,
          b = a + radial + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Eight flame instances and one bounded, world-space vapor / spark particle pool. */
export class BoosterEffects {
  constructor(scene, car) {
    this.scene = scene;
    this.car = car;
    this.cursor = 0;
    this.time = 0;
    this._lastViewportHeight = 0;
    this._viewportExplicit = false;
    this.positions = new Float32Array(COUNT * 3);
    this.velocities = new Float32Array(COUNT * 3);
    this.colors = new Float32Array(COUNT * 3);
    this.sizes = new Float32Array(COUNT);
    this.alpha = new Float32Array(COUNT);
    this.kind = new Float32Array(COUNT);
    this.seed = new Float32Array(COUNT);
    this.life = new Float32Array(COUNT);
    this.age = new Float32Array(COUNT);
    this.startSize = new Float32Array(COUNT);
    this.opacity = new Float32Array(COUNT);
    this.emission = new Float32Array(8);
    this.washEmission = new Float32Array(4);
    this.levels = new Float32Array(8);
    this._worldPosition = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._worldQuaternion = new THREE.Quaternion();
    this._identityQuaternion = new THREE.Quaternion();
    this._rearQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    );
    this._matrix = new THREE.Matrix4();
    this.nozzles = [];
    for (let i = 0; i < 4; i++) this.nozzles.push(car.boosters[i].clone());
    for (const x of [-0.51, -0.17, 0.17, 0.51])
      this.nozzles.push(new THREE.Vector3(x, -0.205, -2.405));

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.geometry.setAttribute(
      "aColor",
      new THREE.BufferAttribute(this.colors, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.geometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      "aKind",
      new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      "aSeed",
      new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uPointScale: { value: 420 } },
      ]),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.particleMaterial);
    this.points.name = "Cold-gas vapor and impact sparks / 600 particle pool";
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);

    this.flameGeometry = makeFlameGeometry();
    this.flameGeometry.setAttribute(
      "aLevel",
      new THREE.InstancedBufferAttribute(this.levels, 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.flameGeometry.setAttribute(
      "aPhase",
      new THREE.InstancedBufferAttribute(
        new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]),
        1,
      ),
    );
    this.flameMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 } },
      ]),
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      fog: true,
      toneMapped: false,
    });
    this.flames = new THREE.InstancedMesh(
      this.flameGeometry,
      this.flameMaterial,
      8,
    );
    this.flames.name =
      "Eight independently throttled blue-white exhaust plumes";
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 4;
    car.group.add(this.flames);
    this.glow = new THREE.PointLight(0xa6dcff, 0, 5, 2);
    this.glow.position.set(0, -0.48, -0.25);
    car.group.add(this.glow);
    this.clear();
    this._autoViewport();
  }

  /** Optional: use the renderer's actual CSS height and pixel ratio for exact sizes. */
  resize(height, pixelRatio = 1) {
    this.particleMaterial.uniforms.uPointScale.value = Math.max(
      1,
      height * pixelRatio * 0.5,
    );
    this._viewportExplicit = true;
  }

  _autoViewport() {
    if (this._viewportExplicit || typeof window === "undefined") return;
    if (window.innerHeight !== this._lastViewportHeight) {
      this._lastViewportHeight = window.innerHeight;
      this.particleMaterial.uniforms.uPointScale.value =
        window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.75) * 0.5;
    }
  }

  _spawn(x, y, z, vx, vy, vz, size, lifetime, opacity, kind, r, g, b) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % COUNT;
    const k = i * 3;
    this.positions[k] = x;
    this.positions[k + 1] = y;
    this.positions[k + 2] = z;
    this.velocities[k] = vx;
    this.velocities[k + 1] = vy;
    this.velocities[k + 2] = vz;
    this.colors[k] = r;
    this.colors[k + 1] = g;
    this.colors[k + 2] = b;
    this.age[i] = 0;
    this.life[i] = lifetime;
    this.startSize[i] = size;
    this.sizes[i] = size;
    this.opacity[i] = opacity;
    this.alpha[i] = opacity * 0.3;
    this.kind[i] = kind;
    this.seed[i] = Math.random() * 91;
  }

  update(dt, state = {}) {
    dt = clamp(Number(dt) || 0, 0, 0.06);
    this.time += dt;
    this._autoViewport();
    this.car.group.updateWorldMatrix(true, false);
    this.car.group.getWorldQuaternion(this._worldQuaternion);
    const velocity = state.velocity;
    const vx = velocity?.x || 0,
      vy = velocity?.y || 0,
      vz = velocity?.z || 0;
    const boosters = state.boosterLevels || EMPTY_LEVELS;
    const pressure = 0.45 + 0.55 * Math.sqrt(clamp(state.pressure ?? 1, 0, 1));
    let brightest = 0;
    for (let i = 0; i < 8; i++) {
      const level = clamp(
        Number(i < 4 ? boosters[i] : state.rearBoost) || 0,
        0,
        1,
      );
      this.levels[i] = level;
      brightest = Math.max(brightest, level);
      this._worldPosition
        .copy(this.nozzles[i])
        .applyMatrix4(this.car.group.matrixWorld);
      this._direction
        .set(0, i < 4 ? -1 : 0, i < 4 ? 0 : -1)
        .applyQuaternion(this._worldQuaternion);
      const flutter = 0.92 + 0.08 * Math.sin(this.time * 57 + i * 2.3);
      let length =
        (i < 4 ? 2.15 : 3.2) * (0.12 + level * 0.88) * pressure * flutter;
      // Ground clips the jet core; its energy becomes a wide, outward vapor wash.
      const groundDistance =
        this._direction.y < -0.12
          ? (this._worldPosition.y - 0.035) / -this._direction.y
          : Infinity;
      if (groundDistance > 0) length = Math.min(length, groundDistance);
      this._scale.set(
        0.65 + level * 0.75,
        Math.max(0.02, length),
        0.65 + level * 0.75,
      );
      this._matrix.compose(
        this.nozzles[i],
        i < 4 ? this._identityQuaternion : this._rearQuaternion,
        this._scale,
      );
      this.flames.setMatrixAt(i, this._matrix);
      if (level < 0.01 || dt === 0) continue;
      this.emission[i] += dt * (18 + level * 36);
      while (this.emission[i] >= 1) {
        this.emission[i]--;
        const trail = 0.12 + Math.random() * Math.min(0.5, length);
        const jetSpeed = 4 + level * 11;
        const jitter = 0.18 + level * 0.3;
        this._spawn(
          this._worldPosition.x + this._direction.x * trail,
          Math.max(0.045, this._worldPosition.y + this._direction.y * trail),
          this._worldPosition.z + this._direction.z * trail,
          vx * 0.72 +
            this._direction.x * jetSpeed +
            (Math.random() - 0.5) * jitter,
          vy * 0.72 +
            this._direction.y * jetSpeed +
            (Math.random() - 0.5) * jitter,
          vz * 0.72 +
            this._direction.z * jetSpeed +
            (Math.random() - 0.5) * jitter,
          0.09 + Math.random() * 0.15,
          0.85 + Math.random() * 0.8,
          0.4 + level * 0.25,
          2,
          0.78,
          0.86,
          0.94,
        );
      }
      if (i < 4 && groundDistance > 0 && groundDistance < 2.9) {
        this.washEmission[i] += dt * level * 32 * (1 - groundDistance / 3.4);
        while (this.washEmission[i] >= 1) {
          this.washEmission[i]--;
          const angle = Math.random() * Math.PI * 2;
          const spread = 2 + level * 5 + Math.random() * 3;
          this._spawn(
            this._worldPosition.x +
              this._direction.x * groundDistance +
              Math.cos(angle) * 0.14,
            0.08 + Math.random() * 0.12,
            this._worldPosition.z +
              this._direction.z * groundDistance +
              Math.sin(angle) * 0.14,
            Math.cos(angle) * spread + vx * 0.18,
            0.4 + Math.random() * 0.55,
            Math.sin(angle) * spread + vz * 0.18,
            0.28 + Math.random() * 0.25,
            1.0 + Math.random() * 0.9,
            0.48,
            0,
            0.73,
            0.77,
            0.8,
          );
        }
      }
    }
    this.flames.visible = brightest > 0.004;
    this.flames.instanceMatrix.needsUpdate = true;
    this.flameGeometry.attributes.aLevel.needsUpdate = true;
    this.glow.intensity = brightest * pressure * 9;
    this.flameMaterial.uniforms.uTime.value = this.time;
    this.particleMaterial.uniforms.uTime.value = this.time;

    let living = 0;
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const progress = this.age[i] / this.life[i];
      if (progress >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      living++;
      const k = i * 3,
        spark = this.kind[i] === 1;
      const drag = Math.exp(-dt * (spark ? 0.7 : 1.65));
      this.velocities[k] *= drag;
      this.velocities[k + 2] *= drag;
      this.velocities[k + 1] =
        this.velocities[k + 1] * drag + dt * (spark ? -9.81 : 1.1);
      this.positions[k] += this.velocities[k] * dt;
      this.positions[k + 1] += this.velocities[k + 1] * dt;
      this.positions[k + 2] += this.velocities[k + 2] * dt;
      if (this.positions[k + 1] < 0.045) {
        this.positions[k + 1] = 0.045;
        this.velocities[k + 1] =
          Math.abs(this.velocities[k + 1]) * (spark ? 0.32 : 0.08);
        if (!spark) {
          this.velocities[k] += Math.sin(this.seed[i]) * dt * 8;
          this.velocities[k + 2] += Math.cos(this.seed[i]) * dt * 8;
        }
      }
      this.sizes[i] = spark
        ? this.startSize[i] * (1 - progress * 0.65)
        : this.startSize[i] + progress * (this.kind[i] === 2 ? 1.8 : 2.7);
      const fadeIn = spark ? 1 : Math.min(1, this.age[i] * 15 + 0.22);
      this.alpha[i] =
        this.opacity[i] * fadeIn * Math.pow(1 - progress, spark ? 0.6 : 1.15);
    }
    this.points.visible = living > 0;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aKind.needsUpdate = true;
    this.geometry.attributes.aSeed.needsUpdate = true;
  }

  impact({ position, intensity = 0.5, speed = 8 } = {}) {
    if (!position) return;
    const strength = clamp(intensity, 0.05, 1);
    const count = Math.round(12 + strength * 40);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const energy =
        (2 + Math.random() * Math.min(16, speed)) * (0.45 + strength * 0.55);
      this._spawn(
        position.x,
        Math.max(0.08, position.y),
        position.z,
        Math.cos(angle) * energy,
        1.5 + Math.random() * energy * 0.8,
        Math.sin(angle) * energy,
        0.045 + Math.random() * 0.065,
        0.25 + Math.random() * 0.65,
        1,
        1,
        3.3,
        1.45,
        0.32,
      );
    }
    for (let i = 0; i < 9 + strength * 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spread = 1 + Math.random() * strength * 4;
      this._spawn(
        position.x,
        Math.max(0.08, position.y),
        position.z,
        Math.cos(angle) * spread,
        0.5 + Math.random() * 1.6,
        Math.sin(angle) * spread,
        0.25 + Math.random() * 0.4,
        0.8 + Math.random() * 1.3,
        0.35 + strength * 0.2,
        0,
        0.57,
        0.55,
        0.51,
      );
    }
    this.points.visible = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.levels.fill(0);
    this.emission.fill(0);
    this.washEmission.fill(0);
    this.cursor = 0;
    this.points.visible = false;
    this.flames.visible = false;
    this.glow.intensity = 0;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.flameGeometry.attributes.aLevel.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.car.group.remove(this.flames, this.glow);
    this.geometry.dispose();
    this.particleMaterial.dispose();
    this.flameGeometry.dispose();
    this.flameMaterial.dispose();
    this.glow.dispose();
  }
}
