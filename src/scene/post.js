// post.js — 仕上げ：ブルーム、トーンマップ、フィルムっぽい周辺減光・粒子・色収差
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uVignette: { value: 0.9 }, uCA: { value: 0.001 }, uLift: { value: new THREE.Color(0.035, 0.02, 0.05) }, uFade: { value: 0 }, tOverlay: { value: null }, uOverlay: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tOverlay; uniform float uTime, uGrain, uVignette, uCA, uFade, uOverlay; uniform vec3 uLift;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uCA * (1.0 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // 黒を少し持ち上げて紫に寄せる（80 年代の印刷物のような空気）
      col = col + uLift * (1.0 - col);
      float vig = smoothstep(0.85, 0.2, r2 * uVignette * 1.6);
      col *= mix(0.62, 1.0, vig);
      float g = hash(vUv * 1000.0 + fract(uTime * 13.7)) - 0.5;
      col += g * uGrain * (0.6 + 0.4 * (1.0 - dot(col, vec3(0.299, 0.587, 0.114))));
      // 文字の重ね（動画モードの曲名など。録画にも写るようにキャンバスの中で合成する）
      if (uOverlay > 0.0) { vec4 o = texture2D(tOverlay, vUv); col = mix(col, o.rgb, clamp(o.a * uOverlay, 0.0, 1.0)); }
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.55, 0.82);
  const output = new OutputPass();
  const film = new ShaderPass(FilmShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(film);
  return {
    composer, bloom, film, renderPass,
    setSize(w, h) { composer.setSize(w, h); },
    render(t) { film.uniforms.uTime.value = t; composer.render(); },
  };
}
