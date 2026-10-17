import { HalfFloatType, Vector2, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { AdaptiveResolution, graphicsPlan } from "./graphics-policy.js";

export class GraphicsPipeline {
  constructor(renderer, scene, camera, { excludedEffects = () => [] } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.excludedEffects = excludedEffects;
    this.adaptive = new AdaptiveResolution();
    this.composer = null;
    this.ao = null;
    this.fxaa = null;
    this._state = null;
    this.options = null;
    this.configureCount = 0;
    this.resizeCount = 0;
    this.allocationCount = 0;
    this._readCapabilities();
  }

  _readCapabilities() {
    const gl = this.renderer.getContext();
    // Loss can happen during startup, before the app installs its listener.
    // Capability queries then return null; wait for restore() to read them again.
    this.limits = { maxWidth: 1, maxHeight: 1, floatSupported: false };
    if (gl.isContextLost()) return;
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const dimension = Math.min(
      this.renderer.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    );
    if (!viewport || !(dimension > 0) || !(viewport[0] > 0) || !(viewport[1] > 0)) return;
    this.limits = {
      maxWidth: Math.min(dimension, viewport[0]),
      maxHeight: Math.min(dimension, viewport[1]),
      floatSupported: this.renderer.extensions.has("EXT_color_buffer_float"),
    };
  }

  configure(options = {}) {
    if (options.quality && this.options && options.quality !== this.options.quality) this.adaptive.reset();
    this.options = { ...this.options, ...options };
    const next = graphicsPlan({ ...this.options, ...this.limits, adaptiveStep: this.adaptive.step });
    const previous = this._state;
    this.configureCount++;
    // A single call updates size and DPR together, avoiding a transient
    // allocation at the old viewport size during phone rotation.
    if (!previous || previous.width !== next.width || previous.height !== next.height || previous.pixelRatio !== next.pixelRatio) {
      this.renderer.setDrawingBufferSize(next.width, next.height, next.pixelRatio);
      this.resizeCount++;
    }
    this._state = next;
    const rebuild = !previous || previous.postprocessing !== next.postprocessing || previous.ambientOcclusion !== next.ambientOcclusion;
    if (rebuild) {
      this._disposeComposer();
      if (next.postprocessing) this._createComposer(next);
    } else if (this.composer && (previous.renderWidth !== next.renderWidth || previous.renderHeight !== next.renderHeight)) {
      this.composer.setSize(next.renderWidth, next.renderHeight);
    }
    this.fxaa?.uniforms.resolution.value.set(1 / next.renderWidth, 1 / next.renderHeight);
    this.renderer.shadowMap.enabled = next.shadows;
    this.scene.traverse((object) => {
      if (!object.isDirectionalLight || !object.shadow) return;
      const shadow = object.shadow;
      if (!next.shadows || shadow.mapSize.x !== next.shadowSize) {
        shadow.map?.dispose();
        shadow.map = null;
        shadow.mapPass?.dispose();
        shadow.mapPass = null;
        if (next.shadows) shadow.mapSize.set(next.shadowSize, next.shadowSize);
      }
    });
    return this.state;
  }

  _createComposer(state) {
    const target = new WebGLRenderTarget(state.renderWidth, state.renderHeight, { type: HalfFloatType });
    // FXAA avoids the HDR multisample formats that vary between mobile drivers.
    target.samples = 0;
    this.composer = new EffectComposer(this.renderer, target);
    // Targets already use physical pixels: do not apply renderer DPR again.
    this.composer.setPixelRatio(1);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (state.ambientOcclusion) {
      const ao = new SSAOPass(this.scene, this.camera, 1, 1, 16);
      this.ao = ao;
      ao.kernelRadius = 0.45;
      ao.minDistance = 0.0001;
      ao.maxDistance = 0.025;
      const setSize = ao.setSize.bind(ao);
      ao.setSize = (width, height) => setSize(Math.max(1, Math.round(width * 0.65)), Math.max(1, Math.round(height * 0.65)));
      const render = ao.render.bind(ao);
      ao.render = (...args) => {
        const excluded = this.excludedEffects().filter(Boolean);
        const visible = excluded.map((object) => object.visible);
        excluded.forEach((object) => { object.visible = false; });
        try { render(...args); }
        finally { excluded.forEach((object, index) => { object.visible = visible[index]; }); }
      };
      this.composer.addPass(ao);
    }
    this.composer.addPass(new UnrealBloomPass(new Vector2(state.renderWidth, state.renderHeight), 0.22, 0.45, 1.3));
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.allocationCount++;
  }

  _disposeComposer() {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose();
    // Three r180's SSAOPass.dispose omits these two owned resources.
    this.ao?.ssaoMaterial.dispose();
    this.ao?.noiseTexture.dispose();
    this.composer.dispose();
    this.composer = null;
    this.ao = null;
    this.fxaa = null;
  }

  observeFrame(frameMs) {
    if (!this.adaptive.observe(frameMs)) return false;
    this.configure();
    return true;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  restore(options = {}) {
    this._disposeComposer();
    this._state = null;
    this._readCapabilities();
    return this.configure(options);
  }

  dispose() { this._disposeComposer(); }

  get state() { return this._state ? { ...this._state } : null; }
  get diagnostics() {
    return {
      ...this._state, ...this.limits,
      configureCount: this.configureCount,
      resizeCount: this.resizeCount,
      allocationCount: this.allocationCount,
      renderTargetSamples: this.composer?.renderTarget1.samples ?? 0,
    };
  }
}
