import * as THREE from "three";
import * as CANNON from "cannon-es";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const random = (lo, hi) => lo + Math.random() * (hi - lo);
const FIRE_CAPACITY = 256;
const SMOKE_CAPACITY = 320;
const MAX_PARTS = 24;
const MAX_SHARDS = 20;

const particleVertex = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSize;
  attribute float aAspect;
  attribute float aAngle;
  attribute float aAlpha;
  attribute float aAge;
  attribute float aSeed;
  attribute float aKind;
  attribute vec3 aColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vAge;
  varying float vSeed;
  varying float vKind;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv=uv;vAlpha=aAlpha;vAge=aAge;vSeed=aSeed;vKind=aKind;vColor=aColor;
    float c=cos(aAngle),s=sin(aAngle);
    vec2 corner=position.xy*vec2(aSize*aAspect,aSize);
    corner=mat2(c,-s,s,c)*corner;
    vec4 mvPosition=viewMatrix*vec4(aCenter,1.0);
    mvPosition.xy+=corner;
    gl_Position=projectionMatrix*mvPosition;
    if(aAlpha<0.001)gl_Position=vec4(2.0,2.0,2.0,1.0);
    #include <fog_vertex>
  }
`;

const particleFragment = /* glsl */ `
  uniform float uTime;
  uniform float uFire;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vAge;
  varying float vSeed;
  varying float vKind;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){return noise(p)*0.56+noise(p*2.03+7.1)*0.28+noise(p*4.11-3.6)*0.16;}
  void main(){
    if(vAlpha<0.002)discard;
    vec2 p=vUv*2.0-1.0;
    float radius=length(p);
    if(radius>1.0)discard;
    float alpha;
    vec3 color;
    if(uFire>0.5){
      if(vKind>1.5){
        float core=exp(-radius*radius*12.0);
        float glow=exp(-radius*radius*3.8)*0.26;
        alpha=(core+glow)*vAlpha;
        color=vec3(7.0,5.2,2.7)*(0.5+core);
      }else if(vKind>0.5){
        float core=exp(-p.y*p.y*18.0-p.x*p.x*3.0);
        alpha=core*vAlpha;
        color=vColor*(1.2+core*2.0);
      }else{
        vec2 flow=p*2.4+vec2(vSeed,-uTime*1.5-vAge*2.0);
        float n=fbm(flow+p*fbm(flow*0.72));
        float edge=1.0-smoothstep(0.42,1.0,radius+(n-0.5)*0.29);
        float hot=clamp((n-0.25)*1.55+(1.0-radius)*0.48-vAge*0.3,0.0,1.0);
        vec3 amber=vec3(3.2,0.16,0.009);
        vec3 yellow=vec3(6.4,1.7,0.075);
        vec3 white=vec3(7.5,4.3,1.2);
        color=mix(amber,yellow,smoothstep(0.18,0.75,hot));
        color=mix(color,white,pow(hot,4.0)*(1.0-vAge)*0.8);
        alpha=edge*edge*(0.35+n*0.65)*vAlpha;
      }
    }else{
      vec2 flow=p*2.7+vec2(vSeed,uTime*0.19);
      float n=fbm(flow+p*fbm(flow*0.56+4.0));
      float edge=1.0-smoothstep(0.38,1.0,radius+(n-0.5)*0.24);
      float roundLight=sqrt(max(0.0,1.0-radius*radius));
      float shade=0.57+roundLight*0.32+n*0.35+p.y*0.08;
      color=vColor*shade;
      alpha=pow(edge,1.45)*(0.5+n*0.5)*vAlpha;
    }
    if(alpha<0.003)discard;
    gl_FragColor=vec4(color,alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const groundVertex = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main(){
    vUv=uv;
    vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
  }
`;
const groundFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uOpacity;
  uniform float uRing;
  #include <fog_pars_fragment>
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  void main(){vec2 p=vUv*2.-1.;float r=length(p);float n=noise(p*8.)*.6+noise(p*17.)*.4;
    float shape=mix(pow(max(0.,1.-r),1.8),exp(-pow((r-.77)/.14,2.)),uRing);
    float alpha=shape*(.45+n*.55)*uOpacity;if(alpha<.004)discard;
    gl_FragColor=vec4(mix(vec3(.014,.012,.011),vec3(.42,.35,.26),uRing),alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A fixed-size instanced billboard pool; quads have no hardware point-size limit. */
class ParticlePool {
  constructor(count, fire) {
    this.count = count;
    this.cursor = 0;
    this.center = new Float32Array(count * 3);
    this.velocity = new Float32Array(count * 3);
    this.color = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.aspect = new Float32Array(count);
    this.angle = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.progress = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.kind = new Float32Array(count);
    this.life = new Float32Array(count);
    this.age = new Float32Array(count);
    this.initialSize = new Float32Array(count);
    this.growth = new Float32Array(count);
    this.opacity = new Float32Array(count);
    this.fire = fire;
    const plane = new THREE.PlaneGeometry(2, 2);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = plane.index.clone();
    this.geometry.setAttribute("position", plane.attributes.position.clone());
    this.geometry.setAttribute("uv", plane.attributes.uv.clone());
    plane.dispose();
    const attrs = {
      aCenter: [this.center, 3],
      aColor: [this.color, 3],
      aSize: [this.size, 1],
      aAspect: [this.aspect, 1],
      aAngle: [this.angle, 1],
      aAlpha: [this.alpha, 1],
      aAge: [this.progress, 1],
      aSeed: [this.seed, 1],
      aKind: [this.kind, 1],
    };
    for (const [key, [array, size]] of Object.entries(attrs))
      this.geometry.setAttribute(
        key,
        new THREE.InstancedBufferAttribute(array, size).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
    this.geometry.instanceCount = count;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uFire: { value: fire ? 1 : 0 } },
      ]),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = fire ? 8 : 6;
    this.mesh.name = fire
      ? "Wreck / fire and sparks"
      : "Wreck / rolling smoke and dust";
    this.mesh.visible = false;
  }
  emit({
    position,
    velocity = [0, 0, 0],
    size = 0.5,
    growth = 1,
    life = 1,
    opacity = 0.6,
    kind = 0,
    color = [1, 1, 1],
    aspect = 1,
  }) {
    const i = this.cursor,
      k = i * 3;
    this.cursor = (i + 1) % this.count;
    this.center.set(position, k);
    this.velocity.set(velocity, k);
    this.color.set(color, k);
    this.initialSize[i] = this.size[i] = size;
    this.growth[i] = growth;
    this.life[i] = life;
    this.age[i] = 0;
    this.opacity[i] = opacity;
    this.alpha[i] = opacity * 0.4;
    this.progress[i] = 0;
    this.kind[i] = kind;
    this.aspect[i] = aspect;
    this.angle[i] = random(-Math.PI, Math.PI);
    this.seed[i] = random(0, 91);
    this.mesh.visible = true;
  }
  update(dt, time) {
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      const k = i * 3,
        spark = this.fire && this.kind[i] === 1,
        dust = !this.fire && this.kind[i] === 1;
      const drag = Math.exp(-dt * (spark ? 0.35 : dust ? 1.8 : 0.95));
      this.velocity[k] *= drag;
      this.velocity[k + 2] *= drag;
      this.velocity[k + 1] =
        this.velocity[k + 1] * drag +
        dt * (spark ? -9.81 : dust ? 0.14 : this.fire ? 1.7 : 1.15);
      this.center[k] += this.velocity[k] * dt;
      this.center[k + 1] += this.velocity[k + 1] * dt;
      this.center[k + 2] += this.velocity[k + 2] * dt;
      if (this.center[k + 1] < 0.035) {
        this.center[k + 1] = 0.035;
        this.velocity[k + 1] =
          Math.abs(this.velocity[k + 1]) * (spark ? 0.28 : 0.1);
      }
      this.progress[i] = t;
      this.size[i] =
        this.initialSize[i] + this.growth[i] * (1 - Math.pow(1 - t, 1.7));
      this.angle[i] += dt * (spark ? 0 : Math.sin(this.seed[i]) * 0.17);
      const fadeIn = this.fire
        ? Math.min(1, 0.55 + this.age[i] * 22)
        : Math.min(1, 0.12 + this.age[i] * 6);
      this.alpha[i] =
        this.opacity[i] *
        fadeIn *
        Math.pow(1 - t, spark ? 0.55 : this.fire ? 0.7 : 1.05);
    }
    this.mesh.visible = alive > 0;
    this.material.uniforms.uTime.value = time;
    for (const name of [
      "aCenter",
      "aColor",
      "aSize",
      "aAspect",
      "aAngle",
      "aAlpha",
      "aAge",
      "aSeed",
      "aKind",
    ])
      this.geometry.attributes[name].needsUpdate = true;
  }
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.cursor = 0;
    this.mesh.visible = false;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Physical detached bodywork, a brief blast, and sustained fire/smoke from the shell. */
export class WreckEffects {
  constructor(scene, physics, car) {
    this.scene = scene;
    this.physics = physics;
    this.car = car;
    this.group = new THREE.Group();
    this.group.name = "Wreck / physical debris and combustion";
    scene.add(this.group);
    this.fire = new ParticlePool(FIRE_CAPACITY, true);
    this.smoke = new ParticlePool(SMOKE_CAPACITY, false);
    this.group.add(this.fire.mesh, this.smoke.mesh);
    this.blastLight = new THREE.PointLight(0xffb15b, 0, 30, 2);
    this.burnLight = new THREE.PointLight(0xff651e, 0, 10, 2);
    this.group.add(this.blastLight, this.burnLight);
    const plane = new THREE.PlaneGeometry(2, 2);
    this.groundGeometry = plane;
    const groundMaterial = (ring) =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          { uOpacity: { value: 0 }, uRing: { value: ring ? 1 : 0 } },
        ]),
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    this.shockwave = new THREE.Mesh(plane, groundMaterial(true));
    this.soot = new THREE.Mesh(plane, groundMaterial(false));
    for (const object of [this.shockwave, this.soot]) {
      object.rotation.x = -Math.PI / 2;
      object.visible = false;
      object.renderOrder = 2;
      this.group.add(object);
    }
    this.aoExcluded = [
      this.fire.mesh,
      this.smoke.mesh,
      this.shockwave,
      this.soot,
    ];
    this.shardMaterials = [
      new THREE.MeshStandardMaterial({
        color: "#373d41",
        metalness: 0.7,
        roughness: 0.54,
      }),
      new THREE.MeshStandardMaterial({
        color: "#c1c7c8",
        metalness: 0.8,
        roughness: 0.37,
      }),
      new THREE.MeshStandardMaterial({
        color: "#182328",
        metalness: 0.3,
        roughness: 0.26,
      }),
    ];
    this.debris = [];
    this.time = 0;
    this.exploded = false;
    this.blastAge = -1;
    this.burnAge = 0;
    this.smokeEmission = 0;
    this.flameEmission = 0;
    this.emberEmission = 0;
    this.lastImpact = -10;
    this._position = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._pointVelocity = new CANNON.Vec3();
    this._direction = new THREE.Vector3();
  }

  /** Quads are world-sized, so this exists only for parity with BoosterEffects. */
  resize() {}

  _removeDebris(index) {
    const debris = this.debris[index];
    if (!debris) return;
    this.physics.world.removeBody(debris.body);
    debris.object.removeFromParent();
    const geometrySet = new Set(),
      materialSet = new Set();
    debris.object.traverse((object) => {
      if (object.geometry) geometrySet.add(object.geometry);
      if (!debris.shard && object.material)
        for (const mat of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materialSet.add(mat);
    });
    for (const geometry of geometrySet) geometry.dispose();
    for (const material of materialSet) material.dispose();
    this.debris.splice(index, 1);
  }

  _bodyFor(
    object,
    size,
    mass,
    { shard = false, explosion = false, strength = 0.5 } = {},
  ) {
    const sameKind = this.debris.filter((piece) => piece.shard === shard);
    if (sameKind.length >= (shard ? MAX_SHARDS : MAX_PARTS))
      this._removeDebris(this.debris.indexOf(sameKind[0]));
    const position = object.position;
    const body = new CANNON.Body({
      mass: clamp(mass || 2, 0.15, 90),
      material: this.physics.propMaterial,
      shape: new CANNON.Box(
        new CANNON.Vec3(
          ...size.map((value) => Math.max(0.04, Math.abs(value) / 2)),
        ),
      ),
      position: new CANNON.Vec3(
        position.x,
        Math.max(0.08, position.y),
        position.z,
      ),
      linearDamping: 0.045,
      angularDamping: 0.12,
      allowSleep: true,
      sleepSpeedLimit: 0.16,
      sleepTimeLimit: 1.8,
      collisionFilterGroup: 1,
      collisionFilterMask: ~2,
    });
    body.quaternion.set(
      object.quaternion.x,
      object.quaternion.y,
      object.quaternion.z,
      object.quaternion.w,
    );
    const carBody = this.physics.body;
    carBody.getVelocityAtWorldPoint(body.position, this._pointVelocity);
    body.velocity.copy(this._pointVelocity);
    this._direction.set(
      position.x - carBody.position.x,
      Math.max(0.2, position.y - carBody.position.y + 0.5),
      position.z - carBody.position.z,
    );
    if (this._direction.lengthSq() < 0.03)
      this._direction.set(random(-1, 1), 0.6, random(-1, 1));
    this._direction.normalize();
    const kick = explosion ? random(3.5, 7.5) : 1.5 + strength * 4;
    body.velocity.x += this._direction.x * kick;
    body.velocity.y += this._direction.y * kick + random(0.6, 2.2);
    body.velocity.z += this._direction.z * kick;
    const spin = explosion ? 7 : 3;
    body.angularVelocity.set(
      carBody.angularVelocity.x + random(-spin, spin),
      carBody.angularVelocity.y + random(-spin, spin),
      carBody.angularVelocity.z + random(-spin, spin),
    );
    body.userData = {
      wreckDebris: true,
      shard,
      sourceBodyId: carBody.id,
      spawnedAt: this.physics.time,
    };
    this.physics.world.addBody(body);
    this.group.add(object);
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.debris.push({
      object,
      body,
      shard,
      age: 0,
      lifetime: shard ? random(14, 20) : 60,
    });
  }

  _consumeParts(explosion = false, strength = 0.5) {
    const parts = this.car.takeDebris?.({ explode: explosion }) || [];
    for (const part of parts) {
      if (!part?.object) continue;
      this._bodyFor(
        part.object,
        part.size || [0.3, 0.15, 0.3],
        part.mass || 4,
        { explosion, strength },
      );
    }
    return parts.length;
  }

  _shards(position, count, explosion = false) {
    for (let i = 0; i < count; i++) {
      const size = [
        random(0.07, 0.22),
        random(0.025, 0.065),
        random(0.08, 0.28),
      ];
      const object = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        this.shardMaterials[i % this.shardMaterials.length],
      );
      object.position.set(
        position.x + random(-0.45, 0.45),
        Math.max(0.12, position.y + random(-0.1, 0.5)),
        position.z + random(-0.45, 0.45),
      );
      object.rotation.set(random(0, 3), random(0, 3), random(0, 3));
      this._bodyFor(object, size, random(0.15, 0.65), {
        shard: true,
        explosion,
        strength: 1,
      });
    }
  }

  onImpact(event = {}) {
    const strength = clamp(event.intensity ?? (event.speed || 0) / 22, 0, 1);
    this._consumeParts(false, strength);
    if (
      !event.position ||
      event.body?.userData?.wreckDebris ||
      this.time - this.lastImpact < 0.14
    )
      return;
    this.lastImpact = this.time;
    const p = event.position;
    const count = Math.round(5 + strength * 18);
    for (let i = 0; i < count; i++) {
      const angle = random(0, Math.PI * 2),
        speed = random(1.5, 4 + strength * 9);
      this.fire.emit({
        position: [p.x, p.y, p.z],
        velocity: [
          Math.cos(angle) * speed,
          random(1, 5),
          Math.sin(angle) * speed,
        ],
        size: random(0.022, 0.055),
        growth: 0.01,
        life: random(0.25, 0.75),
        opacity: 0.9,
        kind: 1,
        color: [3.2, 1.1, 0.12],
        aspect: random(2, 6),
      });
    }
    for (let i = 0; i < 4 + strength * 8; i++)
      this.smoke.emit({
        position: [p.x, Math.max(0.1, p.y), p.z],
        velocity: [random(-2, 2), random(0.4, 2), random(-2, 2)],
        size: random(0.2, 0.45),
        growth: random(0.7, 1.6),
        life: random(0.8, 2),
        opacity: 0.32,
        kind: 1,
        color: [0.26, 0.24, 0.21],
      });
    if (strength > 0.3 && (event.speed || 0) > 7 && !this.exploded)
      this._shards(p, Math.min(5, Math.ceil(strength * 5)), false);
  }

  explode(state = {}) {
    if (this.exploded) return false;
    this.exploded = true;
    this.blastAge = 0;
    this.burnAge = 0;
    this.car.group.updateWorldMatrix(true, false);
    const p = state.position || this.physics.body.position;
    this._position.set(p.x, p.y + 0.2, p.z);
    this._consumeParts(true, 1);
    this._shards(this._position, 18, true);
    this.blastLight.position.copy(this._position);
    this.blastLight.intensity = 1100;
    this.fire.emit({
      position: this._position.toArray(),
      size: 1.3,
      growth: 4.3,
      life: 0.17,
      opacity: 1,
      kind: 2,
    });
    for (let i = 0; i < 34; i++) {
      const angle = random(0, Math.PI * 2),
        up = random(-0.08, 0.9),
        radial = Math.sqrt(1 - up * up),
        speed = random(3, 9);
      const direction = [
        Math.cos(angle) * radial,
        up,
        Math.sin(angle) * radial,
      ];
      this.fire.emit({
        position: [
          p.x + direction[0] * random(0.2, 1),
          p.y + random(0.1, 0.65),
          p.z + direction[2] * random(0.2, 1),
        ],
        velocity: [
          direction[0] * speed,
          2 + direction[1] * speed,
          direction[2] * speed,
        ],
        size: random(0.65, 1.3),
        growth: random(1.4, 2.4),
        life: random(0.5, 1.15),
        opacity: random(0.7, 1),
      });
    }
    for (let i = 0; i < 48; i++) {
      const a = random(0, Math.PI * 2),
        speed = random(2, 7);
      this.smoke.emit({
        position: [
          p.x + random(-0.7, 0.7),
          p.y + random(0.1, 1),
          p.z + random(-0.7, 0.7),
        ],
        velocity: [Math.cos(a) * speed, random(1.3, 6), Math.sin(a) * speed],
        size: random(0.7, 1.5),
        growth: random(2, 4),
        life: random(4.5, 8),
        opacity: random(0.6, 0.9),
        color: [0.035, 0.04, 0.046],
      });
    }
    for (let i = 0; i < 75; i++) {
      const a = random(0, Math.PI * 2),
        speed = random(5, 19);
      this.fire.emit({
        position: [p.x, p.y + 0.4, p.z],
        velocity: [Math.cos(a) * speed, random(2, 13), Math.sin(a) * speed],
        size: random(0.025, 0.065),
        growth: 0,
        life: random(0.5, 1.7),
        opacity: 1,
        kind: 1,
        color: [4.5, 1.2, 0.12],
        aspect: random(3, 8),
      });
    }
    if (p.y < 5) {
      this.shockwave.position.set(p.x, 0.045, p.z);
      this.shockwave.visible = true;
      this.soot.position.set(p.x, 0.025, p.z);
      this.soot.scale.set(3.4, 2.7, 1);
      this.soot.material.uniforms.uOpacity.value = 0.72;
      this.soot.visible = true;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2,
          speed = random(5, 11);
        this.smoke.emit({
          position: [p.x + Math.cos(a), 0.16, p.z + Math.sin(a)],
          velocity: [Math.cos(a) * speed, random(0.2, 1), Math.sin(a) * speed],
          size: random(0.3, 0.65),
          growth: random(1, 2),
          life: random(1.8, 3.4),
          opacity: 0.36,
          kind: 1,
          color: [0.3, 0.26, 0.2],
        });
      }
    }
    return true;
  }

  _burn(dt, state) {
    const damage = state.damage || 0;
    const smoke = this.exploded ? 1 : clamp((damage - 65) / 35, 0, 1);
    const flame = this.exploded
      ? Math.max(0.5, 1 - this.burnAge / 90)
      : clamp((damage - 85) / 15, 0, 1);
    if (!smoke && !flame) {
      this.burnLight.intensity = 0;
      return;
    }
    this.burnAge += dt;
    this.car.group.getWorldQuaternion(this._quaternion);
    const p = state.position || this.physics.body.position,
      v = state.velocity || this.physics.body.velocity;
    this._position.set(p.x, p.y, p.z);
    this.smokeEmission += dt * (5 + smoke * 19);
    this.flameEmission += dt * flame * 29;
    this.emberEmission += dt * flame * 7;
    while (this.smokeEmission >= 1) {
      this.smokeEmission--;
      this._local
        .set(random(-0.55, 0.55), 0.24, random(-1.3, 1.3))
        .applyQuaternion(this._quaternion)
        .add(this._position);
      this.smoke.emit({
        position: this._local.toArray(),
        velocity: [
          v.x * 0.28 + random(-0.3, 0.3),
          1.2 + smoke * 1.3 + v.y * 0.15,
          v.z * 0.28 + random(-0.3, 0.3),
        ],
        size: random(0.3, 0.65),
        growth: random(1.6, 3),
        life: random(4, 7),
        opacity: 0.35 + smoke * 0.4,
        color: this.exploded ? [0.024, 0.029, 0.035] : [0.075, 0.08, 0.085],
      });
    }
    while (this.flameEmission >= 1) {
      this.flameEmission--;
      this._local
        .set(random(-0.6, 0.6), 0.12, random(-1.25, 1.25))
        .applyQuaternion(this._quaternion)
        .add(this._position);
      this.fire.emit({
        position: this._local.toArray(),
        velocity: [
          v.x * 0.35 + random(-0.3, 0.3),
          random(1.2, 2.5),
          v.z * 0.35 + random(-0.3, 0.3),
        ],
        size: random(0.22, 0.5),
        growth: random(0.45, 1.1),
        life: random(0.45, 0.95),
        opacity: 0.55 + flame * 0.35,
      });
    }
    while (this.emberEmission >= 1) {
      this.emberEmission--;
      this.fire.emit({
        position: [p.x + random(-0.7, 0.7), p.y + 0.4, p.z + random(-1, 1)],
        velocity: [random(-1, 1), random(2, 5), random(-1, 1)],
        size: 0.02,
        growth: 0,
        life: random(0.5, 1.2),
        opacity: 0.7,
        kind: 1,
        color: [3, 0.45, 0.035],
        aspect: 2,
      });
    }
    this.burnLight.position.set(p.x, p.y + 0.8, p.z);
    this.burnLight.intensity =
      flame *
      (25 + Math.sin(this.time * 19) * 5 + Math.sin(this.time * 31) * 3);
  }

  update(dt, state = {}) {
    dt = clamp(Number(dt) || 0, 0, 0.06);
    this.time += dt;
    if (dt > 0) {
      this._consumeParts(false, 0.4);
      this._burn(dt, state);
    }
    if (this.blastAge >= 0) {
      this.blastAge += dt;
      this.blastLight.intensity = 1100 * Math.exp(-this.blastAge * 15);
      if (this.shockwave.visible) {
        const t = this.blastAge / 0.85;
        this.shockwave.scale.setScalar(1 + this.blastAge * 13);
        this.shockwave.material.uniforms.uOpacity.value =
          Math.max(0, 1 - t) * 0.3;
        if (t >= 1) this.shockwave.visible = false;
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const part = this.debris[i];
      part.age += dt;
      if (part.age > 0.35 && part.body.collisionFilterMask !== -1) {
        part.body.collisionFilterMask = -1;
        part.body.aabbNeedsUpdate = true;
        part.body.wakeUp();
      }
      if (part.age > part.lifetime || part.body.position.y < -30) {
        this._removeDebris(i);
        continue;
      }
      part.object.position.copy(part.body.position);
      part.object.quaternion.copy(part.body.quaternion);
    }
    this.fire.update(dt, this.time);
    this.smoke.update(dt, this.time);
  }

  clear() {
    while (this.debris.length) this._removeDebris(this.debris.length - 1);
    this.fire.clear();
    this.smoke.clear();
    this.time = 0;
    this.exploded = false;
    this.blastAge = -1;
    this.burnAge = 0;
    this.smokeEmission = this.flameEmission = this.emberEmission = 0;
    this.lastImpact = -10;
    this.blastLight.intensity = this.burnLight.intensity = 0;
    this.shockwave.visible = this.soot.visible = false;
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.fire.dispose();
    this.smoke.dispose();
    this.groundGeometry.dispose();
    this.shockwave.material.dispose();
    this.soot.material.dispose();
    for (const material of this.shardMaterials) material.dispose();
    this.blastLight.dispose();
    this.burnLight.dispose();
  }
}
