// city.js — 窓の外：ビル群、通り、海と橋、遠くの街並み、空、空飛ぶ車、飛行船、雨
//
// 部屋の床が y=0。街の地面は 47 階ぶん下の y=-165。
// ビルは 1 つの InstancedMesh で描き、窓はシェーダーで描く（画面上で窓が細かくなりすぎたら平均の色に寄せてちらつきを防ぐ）。

import * as THREE from 'three';
import { signBoard, glowTexture, JP_FONT } from './textures.js';

export const GROUND_Y = -165;

const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 palette(float t){ return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
`;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- ビルの配置
function genBuildings() {
  const R = rng(4747);
  const out = [];
  const pitch = 64, road = 18;
  for (let gx = -22; gx <= 22; gx++) {
    for (let gz = -28; gz <= 10; gz++) {
      const bx = gx * pitch, bz = gz * pitch; // 区画の角
      const cx = bx + pitch / 2, cz = bz + pitch / 2;
      if (cz < -1720) continue; // 海
      if (Math.abs(cx) < 60 && cz > -45) continue; // 自分のビルの区画
      if (cz > 30 && cx > -40) continue; // 背中側（見えない）
      const dist = Math.hypot(cx, cz);
      const n = dist < 700 ? 1 + Math.floor(R() * 3) : 1 + Math.floor(R() * 2);
      const area = pitch - road;
      for (let k = 0; k < n; k++) {
        const w = Math.min(area, 14 + R() * (n === 1 ? 32 : 18));
        const d = Math.min(area, 14 + R() * (n === 1 ? 32 : 18));
        const x = bx + road / 2 + w / 2 + R() * Math.max(0, area - w);
        const z = bz + road / 2 + d / 2 + R() * Math.max(0, area - d);
        let h = 22 + 125 * Math.pow(R(), 1.9);
        if (R() < 0.07) h = 170 + R() * 170;
        if (Math.abs(x) < 280 && z > -320 && z < 60) h = Math.min(h, 118 + R() * 25); // 窓の近くは見下ろせる高さに
        if (Math.hypot(x, z) < 90) h = Math.min(h, 90);
        out.push({ x, z, w, d, h, seed: R(), lit: 0.45 + R() * 0.55, style: R(), hue: R() });
      }
    }
  }
  // 近所の高層ビル（構図の枠になる）
  out.push({ x: 150, z: -125, w: 46, d: 40, h: 238, seed: 0.31, lit: 0.8, style: 0.05, hue: 0.62 });
  out.push({ x: -190, z: -40, w: 44, d: 48, h: 212, seed: 0.77, lit: 0.7, style: 0.55, hue: 0.9 });
  out.push({ x: 360, z: -420, w: 52, d: 52, h: 300, seed: 0.12, lit: 0.85, style: 0.58, hue: 0.12 });
  out.push({ x: -520, z: -640, w: 60, d: 46, h: 330, seed: 0.55, lit: 0.75, style: 0.08, hue: 0.45 });
  return out;
}

function buildingMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uLit: { value: 1 }, uWarm: { value: 0.5 },
      uSkyLow: { value: new THREE.Color() }, uFacade: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSun: { value: 0 },
    }]),
    vertexShader: /* glsl */`
      attribute vec4 aInfo;
      varying vec3 vLocal; varying vec3 vN; varying vec3 vSize; varying vec4 vInfo; varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSize = size;
        vLocal = (position + vec3(0.5, 0.0, 0.5)) * size;
        vN = normal;
        vInfo = aInfo;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLit, uWarm, uSun;
      uniform vec3 uSkyLow, uFacade, uSunDir, uSunColor;
      varying vec3 vLocal; varying vec3 vN; varying vec3 vSize; varying vec4 vInfo; varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float seed = vInfo.x;
        vec3 col = uFacade;
        vec3 accent = palette(vInfo.w);
        float sunL = max(dot(vN, normalize(uSunDir)), 0.0) * uSun;
        if (vN.y > 0.5) {
          col = uFacade * 0.7 + uSunColor * sunL * 0.08;
          // 屋上の設備の明かり
          vec2 q = vLocal.xz / 6.0;
          float dotL = step(0.92, hash12(floor(q) + seed * 40.0)) * smoothstep(0.35, 0.0, length(fract(q) - 0.5));
          col += vec3(1.0, 0.75, 0.5) * dotL * 0.6 * uLit;
        } else if (vN.y < -0.5) {
          col = vec3(0.0);
        } else {
          bool sx = abs(vN.x) > 0.5;
          float u = sx ? vLocal.z : vLocal.x;
          float faceW = sx ? vSize.z : vSize.x;
          float v = vLocal.y;
          float faceSeed = seed * 17.0 + (sx ? (vN.x > 0.0 ? 1.3 : 2.7) : (vN.z > 0.0 ? 4.1 : 5.9));
          float fh = 3.3 + floor(fract(seed * 7.13) * 3.0) * 0.45;
          float cw = 1.7 + fract(seed * 3.71) * 1.7;
          vec2 cell = vec2(u / cw, v / fh);
          vec2 id = floor(cell);
          vec2 f = fract(cell);
          float ribbon = step(0.72, vInfo.z);
          float mx = mix(smoothstep(0.07, 0.13, f.x) * (1.0 - smoothstep(0.87, 0.93, f.x)), 1.0, ribbon);
          float my = smoothstep(0.16, 0.22, f.y) * (1.0 - smoothstep(0.82, 0.88, f.y));
          float win = mx * my * step(3.0, v) * step(v, vSize.y - 1.5);
          float h1 = hash12(id + faceSeed);
          float h2 = hash12(id.yx * 1.7 + seed * 13.1);
          float litRatio = vInfo.y * uLit;
          float floorOn = hash12(vec2(id.y, seed * 31.0));
          float lit = step(h1, litRatio) * step(0.18, floorOn + litRatio * 0.6);
          float tcell = floor(uTime * 0.04 + h2 * 10.0);
          lit *= step(0.05, hash12(id + tcell * 1.37));
          vec3 warm = vec3(1.0, 0.7, 0.4), cool = vec3(0.72, 0.84, 1.0);
          vec3 lc = mix(cool, warm, step(0.5 - uWarm * 0.35, h2));
          lc = mix(lc, accent, step(0.94, h2) * 0.85);
          float bright = 0.45 + 1.05 * h1 * h1;
          vec3 glass = uSkyLow * mix(0.1, 0.4, f.y) + uSunColor * sunL * 0.25;
          vec3 wc = mix(glass, lc * bright, lit);
          vec2 fw = fwidth(cell);
          float tiny = smoothstep(0.22, 0.6, max(fw.x, fw.y));
          float shade = 0.78 + 0.22 * vN.z - 0.08 * vN.x;
          glass *= shade;
          wc = mix(glass, lc * bright, lit);
          float cover = mix(0.4, 0.62, ribbon);
          vec3 avg = uFacade * shade * (1.0 - cover) + cover * mix(uSkyLow * 0.2 * shade, mix(cool, warm, uWarm) * 0.7, litRatio * 0.75);
          col = uFacade * shade * (1.0 + sunL * 0.8) + uSunColor * sunL * 0.05;
          col = mix(col, wc, win);
          col = mix(col, avg, tiny);
          // 角のネオン（近未来のビル）
          if (vInfo.z < 0.12) {
            float edge = min(u, faceW - u);
            float strip = 1.0 - smoothstep(0.25, 0.7 + tiny * 2.0, edge);
            col += accent * strip * 2.4;
          }
          // 屋上の光の帯
          if (vInfo.z > 0.5 && vInfo.z < 0.64) {
            float crown = smoothstep(vSize.y - 2.4, vSize.y - 1.6, v) * (1.0 - smoothstep(vSize.y - 0.8, vSize.y - 0.2, v));
            col += accent * crown * 2.2;
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- 地面（通りと海）
function groundMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uStreets: { value: 1 }, uSkyLow: { value: new THREE.Color() }, uFacade: { value: new THREE.Color() },
    }]),
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uStreets;
      uniform vec3 uSkyLow, uFacade;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      float lane(float along, float speed, float seed, float gap) {
        float x = along / gap + uTime * speed / gap + seed;
        float id = floor(x);
        float on = step(0.35, hash12(vec2(id, seed)));
        float f = fract(x);
        return on * smoothstep(0.06, 0.0, abs(f - 0.5));
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 col;
        if (p.y < -1735.0) {
          // 海：暗い水面に、遠くの灯りのゆらぎ
          float n = fbm(vec2(p.x * 0.01, p.y * 0.04 + uTime * 0.05));
          col = mix(uFacade * 0.6, uSkyLow * 0.35, 0.3 + 0.4 * n);
          float shimmer = smoothstep(0.62, 0.9, fbm(vec2(p.x * 0.05 + uTime * 0.2, p.y * 0.3)));
          col += vec3(1.0, 0.75, 0.55) * shimmer * 0.25 * uStreets * smoothstep(-1735.0, -1900.0, p.y);
        } else {
          float pitch = 64.0;
          vec2 g = mod(p, pitch);
          vec2 cellId = floor(p / pitch);
          float roadA = 1.0 - step(18.0, g.x); // z 方向の通り
          float roadB = 1.0 - step(18.0, g.y); // x 方向の通り
          float road = max(roadA, roadB);
          col = uFacade * (0.7 + 0.6 * hash12(cellId));
          // 区画の中の小さな明かり
          vec2 q = p / 7.0;
          float dotL = step(0.9, hash12(floor(q))) * smoothstep(0.4, 0.0, length(fract(q) - 0.5));
          col += vec3(1.0, 0.8, 0.55) * dotL * 0.35 * uStreets;
          if (road > 0.5) {
            col = vec3(0.025, 0.022, 0.03);
            float sodium = 0.0;
            vec3 cars = vec3(0.0);
            if (roadA > 0.5) {
              sodium += exp(-pow(g.x - 1.5, 2.0) * 0.6) + exp(-pow(g.x - 16.5, 2.0) * 0.6);
              cars += vec3(1.0, 0.95, 0.85) * lane(p.y, -14.0, cellId.x * 3.1, 26.0) * smoothstep(1.4, 0.0, abs(g.x - 6.0));
              cars += vec3(1.0, 0.12, 0.08) * lane(p.y, 14.0, cellId.x * 7.7, 22.0) * smoothstep(1.4, 0.0, abs(g.x - 12.0));
            }
            if (roadB > 0.5) {
              sodium += exp(-pow(g.y - 1.5, 2.0) * 0.6) + exp(-pow(g.y - 16.5, 2.0) * 0.6);
              cars += vec3(1.0, 0.95, 0.85) * lane(p.x, 12.0, cellId.y * 5.3, 30.0) * smoothstep(1.4, 0.0, abs(g.y - 6.0));
              cars += vec3(1.0, 0.12, 0.08) * lane(p.x, -12.0, cellId.y * 2.9, 24.0) * smoothstep(1.4, 0.0, abs(g.y - 12.0));
            }
            col += vec3(1.0, 0.58, 0.22) * min(sodium, 1.2) * 0.55 * uStreets + cars * 1.6 * uStreets;
          }
          float d = length(fwidth(p));
          float tiny = smoothstep(4.0, 14.0, d);
          vec3 avg = uFacade * 0.9 + vec3(1.0, 0.6, 0.3) * 0.16 * uStreets;
          col = mix(col, avg, tiny);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- 遠くの街並み（湾の向こう）
function skylineMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { uTime: { value: 0 }, uHaze: { value: new THREE.Color() }, uLit: { value: 1 }, uFacade: { value: new THREE.Color() } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uLit; uniform vec3 uHaze, uFacade;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        float x = vUv.x * 900.0;
        float bid = floor(x / 1.3);
        float h = 0.05 + 0.22 * pow(hash12(vec2(bid, 3.0)), 2.2) + 0.08 * fbm(vec2(vUv.x * 30.0, 0.0));
        float tall = step(0.965, hash12(vec2(bid, 9.0))) * 0.22 * hash12(vec2(bid, 5.0));
        h += tall;
        float y = vUv.y;
        if (y > h) discard;
        vec2 wcell = vec2(x * 4.0, y * 260.0);
        float on = step(0.6, hash12(floor(wcell))) * step(hash12(floor(wcell) + 7.0), 0.55 * uLit);
        vec3 col = mix(uFacade, uHaze, 0.55);
        col += vec3(1.0, 0.8, 0.55) * on * 0.5 * mix(1.0, 0.6, y / 0.3);
        float top = step(h - 0.003, y) * step(0.5, hash12(vec2(bid, 2.0)));
        col += vec3(1.5, 0.15, 0.1) * top * (0.5 + 0.5 * sin(uTime * 2.0 + bid));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- 空
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uSun: { value: 0 },
      uMoonDir: { value: new THREE.Vector3() }, uMoon: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uMid, uHorizon, uCloud, uSunDir, uSunColor, uMoonDir;
      uniform float uSun, uMoon, uStars, uTime, uGlow;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uMid, uTop, pow(clamp(h * 1.5, 0.0, 1.0), 0.75));
        col = mix(uHorizon, col, smoothstep(-0.03, 0.25, h));
        if (h < -0.03) col = uHorizon * 0.55;
        // 街の灯りで地平線が明るむ
        col += uHorizon * exp(-max(h, 0.0) * 18.0) * 0.25 * uGlow;
        // 太陽
        vec3 sd = normalize(uSunDir);
        float s = max(dot(d, sd), 0.0);
        col += uSunColor * (smoothstep(0.9988, 0.9993, s) * 4.0 + pow(s, 14.0) * 0.45 + pow(s, 3.0) * 0.12) * uSun;
        // 月
        vec3 md = normalize(uMoonDir);
        float m = dot(d, md);
        float disc = smoothstep(0.99955, 0.99975, m);
        vec3 moonCol = vec3(1.0, 0.95, 0.85) * (0.9 + 0.1 * vnoise((d.xy - md.xy) * 900.0));
        col = mix(col, moonCol * 2.2, disc * uMoon);
        col += vec3(0.55, 0.6, 1.0) * pow(max(m, 0.0), 300.0) * 0.5 * uMoon;
        // 星
        if (uStars > 0.0 && h > 0.02) {
          vec3 sp = d * 260.0;
          vec3 id = floor(sp);
          float r = hash13(id);
          vec3 f = fract(sp) - 0.5;
          float star = step(0.9965, r) * smoothstep(0.32, 0.0, length(f));
          float tw = 0.6 + 0.4 * sin(uTime * (1.0 + r * 5.0) + r * 60.0);
          col += vec3(0.9, 0.92, 1.0) * star * tw * uStars * smoothstep(0.02, 0.3, h) * 1.4;
        }
        // 雲（地平線近くの薄い層）
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.08) * 1.4 + vec2(uTime * 0.004, 0.0);
          float cl = smoothstep(0.5, 0.82, fbm(cp * vec2(0.6, 1.6)));
          float band = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.18, 0.45, h));
          vec3 cc = mix(uCloud, uSunColor, pow(s, 6.0) * uSun * 0.8);
          col = mix(col, cc, cl * band * 0.75);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- 雨（外の雨筋と、ガラスの雨粒）
function rainStreaks() {
  const N = 2600;
  const pos = new Float32Array(N * 2 * 3);
  const off = new Float32Array(N * 2);
  const R = rng(99);
  for (let i = 0; i < N; i++) {
    const x = (R() - 0.5) * 140, y = (R() - 0.5) * 120, z = -6 - R() * 90;
    for (let k = 0; k < 2; k++) {
      pos.set([x, y, z], (i * 2 + k) * 3);
      off[i * 2 + k] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(off, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aEnd; uniform float uTime; varying float vA;
      void main() {
        vec3 p = position;
        float fall = 38.0;
        p.y = mod(p.y - uTime * fall + 60.0, 120.0) - 60.0;
        p.x += p.y * 0.08;
        p.y -= aEnd * 2.2;
        vA = 1.0 - aEnd * 0.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA *= smoothstep(140.0, 20.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAmt; varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.8) * vA * uAmt * 0.55, 1.0); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.name = 'rainStreaks';
  return lines;
}

export function dropletsMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uAspect: { value: 3 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uAmt, uAspect;
      varying vec2 vUv;
      ${NOISE_GLSL}
      // 1 粒：中は少し暗く、ふちと左上に光る（水滴のレンズ）
      vec2 drop(vec2 f, vec2 o, float size) {
        vec2 q = (f - o) * vec2(1.0, 0.85);
        float d = length(q);
        float inside = smoothstep(size, size * 0.82, d);
        float rim = inside * smoothstep(size * 0.55, size * 0.95, d);
        float hl = inside * smoothstep(0.35, 0.95, dot(q / max(d, 1e-4), vec2(-0.45, 0.89))) * smoothstep(size * 0.35, size * 0.8, d);
        return vec2(inside * 0.1 + rim * 0.12, hl);
      }
      vec2 layer(vec2 uv, float scale, float seed, float chance) {
        vec2 p = uv * scale;
        vec2 id = floor(p);
        vec2 f = fract(p) - 0.5;
        float r = hash12(id + seed);
        vec2 o = (vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.3)) - 0.5) * 0.6;
        float size = 0.07 + 0.16 * r * r;
        float alive = step(1.0 - chance, fract(r * 13.0 + floor(uTime * 0.05 + r * 5.0) * 0.37));
        return drop(f, o, size) * alive;
      }
      void main() {
        vec2 uv = vUv * vec2(uAspect, 1.0);
        vec2 a = layer(uv, 26.0, 1.0, 0.3) + layer(uv, 48.0, 4.0, 0.35) * 0.7;
        // 流れ落ちる粒と跡
        vec2 p = uv * vec2(16.0, 1.0);
        float col = floor(p.x);
        float r = hash12(vec2(col, 2.0));
        float y = fract(-uTime * (0.04 + 0.08 * r) + r * 7.0);
        float x = fract(p.x) - 0.5 + sin(uv.y * 30.0 + r * 10.0) * 0.05;
        float live = step(0.6, r);
        vec2 run = drop(vec2(x, (uv.y - y) * 16.0 * 0.6), vec2(0.0), 0.2) * live;
        float trail = smoothstep(0.06, 0.0, abs(x)) * step(y, uv.y) * smoothstep(0.25, 0.0, uv.y - y) * live;
        float dark = a.x + run.x + trail * 0.05;
        float light = a.y + run.y;
        float alpha = clamp(dark + light * 0.5, 0.0, 0.8);
        vec3 c = mix(vec3(0.03, 0.04, 0.07), vec3(0.85, 0.9, 1.0), clamp(light * 0.5 / max(alpha, 1e-3), 0.0, 1.0));
        gl_FragColor = vec4(c, alpha * uAmt);
      }`,
  });
}

// ---------------------------------------------------------------- 本体
export function createCity() {
  const city = new THREE.Group();
  city.name = 'city';
  const A = {};

  // ビル
  const list = genBuildings();
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  box.deleteAttribute('uv');
  const bMat = buildingMaterial();
  const inst = new THREE.InstancedMesh(box, bMat, list.length);
  inst.name = 'buildings';
  const info = new Float32Array(list.length * 4);
  const m4 = new THREE.Matrix4();
  list.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d).setPosition(b.x, GROUND_Y, b.z);
    inst.setMatrixAt(i, m4);
    info.set([b.seed, b.lit, b.style, b.hue], i * 4);
  });
  inst.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  inst.frustumCulled = false;
  city.add(inst);
  A.bMat = bMat;

  // 地面
  const gMat = groundMaterial();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), gMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, -1000);
  ground.name = 'ground';
  city.add(ground);
  A.gMat = gMat;

  // 遠くの街並み
  const sMat = skylineMaterial();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(3200, 3200, 700, 160, 1, true, Math.PI * 0.5, Math.PI * 1.2), sMat);
  ring.position.y = GROUND_Y + 350 - 30;
  ring.rotation.y = Math.PI;
  ring.name = 'skyline';
  ring.renderOrder = -1;
  city.add(ring);
  A.sMat = sMat;

  // 空
  const skyMat = skyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMat);
  sky.name = 'sky';
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  city.add(sky);
  A.skyMat = skyMat;

  // 光の点（航空障害灯・橋・塔）
  const glow = glowTexture();
  const pointsMat = (size) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: glow }, uSize: { value: size }, uAmt: { value: 1 } }]),
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aBlink;
      uniform float uTime, uSize; varying vec3 vC;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float blink = aBlink > 0.0 ? step(0.5, fract(uTime * 0.6 + aBlink)) * 0.9 + 0.1 : 1.0;
        vC = aColor * blink;
        gl_PointSize = clamp(uSize * 900.0 / -mvPosition.z, 1.5, 40.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uAmt; varying vec3 vC;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(uMap, gl_PointCoord).r;
        gl_FragColor = vec4(vC * a * uAmt, 1.0);
        #include <fog_fragment>
      }`,
  });
  const lights = [];
  const addLight = (x, y, z, r, g, b, blink = 0) => lights.push({ x, y, z, r, g, b, blink });
  for (const b of list) if (b.h > 150 || (b.h > 100 && b.seed > 0.7)) addLight(b.x, GROUND_Y + b.h + 2, b.z, 3, 0.25, 0.15, b.seed + 0.01);
  // 吊り橋（湾にかかる）
  const bz = -1950, by = GROUND_Y + 48, t1 = -700, t2 = -150, tH = 150;
  for (let x = -1300; x <= 500; x += 9) addLight(x, by, bz, 1.6, 1.25, 0.8);
  const cable = (xa, xb, ya, yb, sag) => { for (let k = 0; k <= 60; k++) { const f = k / 60; const x = xa + (xb - xa) * f; const y = ya + (yb - ya) * f - sag * 4 * f * (1 - f); addLight(x, y, bz, k % 2 ? 1.6 : 2.2, k % 2 ? 0.6 : 1.6, k % 2 ? 1.8 : 2.2); } };
  cable(t1, t2, GROUND_Y + tH, GROUND_Y + tH, 95);
  cable(-1300, t1, by + 5, GROUND_Y + tH, 30);
  cable(t2, 400, GROUND_Y + tH, by + 5, 30);
  for (const tx of [t1, t2]) { for (let y = by; y < GROUND_Y + tH; y += 12) addLight(tx, y, bz, 1.2, 1.2, 1.4); addLight(tx, GROUND_Y + tH + 4, bz, 3, 0.3, 0.2, 0.3); }
  // 電波塔（遠くのランドマーク）
  const tw = { x: -820, z: -1500 };
  for (let y = GROUND_Y; y < GROUND_Y + 560; y += 14) { const r = 18 * (1 - (y - GROUND_Y) / 640); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + y; addLight(tw.x + Math.cos(a) * r, y, tw.z + Math.sin(a) * r, 0.5, 1.2, 2.2); } }
  addLight(tw.x, GROUND_Y + 600, tw.z, 4, 0.3, 0.2, 0.5);
  const lp = new Float32Array(lights.length * 3), lc = new Float32Array(lights.length * 3), lb = new Float32Array(lights.length);
  lights.forEach((l, i) => { lp.set([l.x, l.y, l.z], i * 3); lc.set([l.r, l.g, l.b], i * 3); lb[i] = l.blink; });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('aColor', new THREE.BufferAttribute(lc, 3));
  lg.setAttribute('aBlink', new THREE.BufferAttribute(lb, 1));
  const lMat = pointsMat(5);
  const pts = new THREE.Points(lg, lMat);
  pts.frustumCulled = false;
  pts.name = 'cityLights';
  city.add(pts);
  A.lMat = lMat;
  // 電波塔の本体（細い柱と展望台）
  const towerMat = new THREE.MeshBasicMaterial({ color: 0x0b0b14, fog: true });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 20, 600, 8), towerMat);
  tower.position.set(tw.x, GROUND_Y + 300, tw.z);
  city.add(tower);
  const deckMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.4), fog: true });
  for (const [y, r] of [[350, 26], [450, 18]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 8, 24), deckMat); d.position.set(tw.x, GROUND_Y + y, tw.z); city.add(d); }
  A.deckMat = deckMat;

  // 看板
  const signs = [
    ['シティポップ', '#ff5fa2'], ['喫茶 ネオン', '#3fe3ff'], ['FM 47.0', '#ffb547'], ['ディスコ', '#b46cff'], ['HOTEL', '#ff7a5c'],
    ['カラオケ', '#7dff9e'], ['夜景', '#3fe3ff'], ['CLAWD', '#ff9a5c'], ['24H', '#ffef7a'], ['レコード', '#ff5fa2'],
  ];
  A.signMats = [];
  const R = rng(321);
  const candidates = list.filter((b) => b.z < -110 && b.z > -700 && Math.abs(b.x) < 520 && b.h > 50).sort(() => R() - 0.5).slice(0, signs.length);
  candidates.forEach((b, i) => {
    const [text, colr] = signs[i];
    const vertical = R() < 0.5;
    const t = signBoard(text, { fg: colr, vertical, w: vertical ? 640 : 560, h: 170, size: vertical ? 120 : 104 });
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(1.8, 1.8, 1.8), fog: true, depthWrite: false });
    const sw = vertical ? 8 : 26, sh = vertical ? 30 : 8;
    const sgn = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
    const top = GROUND_Y + b.h;
    sgn.position.set(b.x + (R() - 0.5) * (b.w - sw) * 0.6, Math.min(top - sh / 2 - 3, GROUND_Y + b.h * (0.55 + R() * 0.3)), b.z + b.d / 2 + 0.5);
    sgn.name = 'sign-' + text;
    city.add(sgn);
    A.signMats.push({ mat, phase: R() * 10 });
  });

  // 空飛ぶ車
  const CARS = 34;
  const cars = [];
  const CR = rng(77);
  for (let i = 0; i < CARS; i++) {
    const dir = CR() < 0.5 ? 1 : -1;
    const near = i < 5;
    cars.push({
      x: (CR() - 0.5) * 2400, y: near ? -6 + CR() * 30 : -60 + CR() * 150, z: near ? -28 - CR() * 40 : -90 - CR() * 900,
      v: (24 + CR() * 40) * dir, hue: CR(), bob: CR() * 6,
    });
  }
  const carBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.9, 3.2, 4, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c1d26, roughness: 0.3, metalness: 0.8 }), CARS);
  const carGlow = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 0.18, 1.5), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), CARS);
  carBody.name = 'carBodies'; carGlow.name = 'carGlow';
  carBody.frustumCulled = carGlow.frustumCulled = false;
  const colr = new THREE.Color();
  cars.forEach((c, i) => { colr.setHSL(c.hue < 0.5 ? 0.88 : 0.52, 1, 0.55).multiplyScalar(3); carGlow.setColorAt(i, colr); });
  city.add(carBody, carGlow);
  const headPos = new Float32Array(CARS * 2 * 3), headCol = new Float32Array(CARS * 2 * 3), headBl = new Float32Array(CARS * 2);
  for (let i = 0; i < CARS; i++) { headCol.set([3, 2.8, 2.4], i * 6); headCol.set([3, 0.25, 0.3], i * 6 + 3); }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(headPos, 3));
  hg.setAttribute('aColor', new THREE.BufferAttribute(headCol, 3));
  hg.setAttribute('aBlink', new THREE.BufferAttribute(headBl, 1));
  const hMat = pointsMat(2.2);
  const heads = new THREE.Points(hg, hMat);
  heads.frustumCulled = false;
  city.add(heads);
  const trailPos = new Float32Array(CARS * 2 * 3), trailCol = new Float32Array(CARS * 2 * 3);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  trails.frustumCulled = false;
  city.add(trails);
  A.hMat = hMat;

  // 飛行船（電光掲示板つき）
  const blimp = new THREE.Group(); blimp.name = 'blimp'; city.add(blimp);
  const env = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ color: 0xd8d4e6, roughness: 0.5, metalness: 0.2, fog: true }));
  env.scale.set(38, 10, 10);
  blimp.add(env);
  const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 128;
  const bctx = bc.getContext('2d');
  bctx.fillStyle = '#05040a'; bctx.fillRect(0, 0, 1024, 128);
  bctx.font = `700 76px ${JP_FONT}`; bctx.textBaseline = 'middle';
  const msg = '♪ FM CLAWD 47.0 — シティポップ 24時間放送中 — NIGHT LOUNGE ★ ';
  bctx.fillStyle = '#ffb547'; bctx.fillText(msg, 10, 68);
  const btex = new THREE.CanvasTexture(bc); btex.colorSpace = THREE.SRGBColorSpace; btex.wrapS = THREE.RepeatWrapping;
  btex.repeat.set(0.45, 1);
  const screenMat = new THREE.MeshBasicMaterial({ map: btex, color: new THREE.Color(2.2, 2.2, 2.2), fog: true, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(10.15, 10.15, 5, 40, 1, true, -Math.PI * 0.3, Math.PI * 0.6), screenMat);
  screen.rotation.z = Math.PI / 2;
  screen.rotation.y = Math.PI / 2;
  screen.scale.set(1, 1, 1);
  screen.position.set(0, -1, 0);
  const screenHolder = new THREE.Group(); screenHolder.scale.set(1, 3.7, 1); screenHolder.add(screen);
  blimp.add(screenHolder);
  blimp.position.set(220, 95, -620);
  A.btex = btex;

  // 雨
  const rain = rainStreaks();
  city.add(rain);
  A.rainMat = rain.material;

  // ---------------------------------------------------------------- 毎フレーム
  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const update = (dt, t, env, cam) => {
    const e = env;
    bMat.uniforms.uTime.value = t;
    bMat.uniforms.uLit.value = e.lit;
    bMat.uniforms.uWarm.value = e.warm;
    bMat.uniforms.uSkyLow.value.copy(e.skyHorizon);
    bMat.uniforms.uFacade.value.copy(e.facade);
    bMat.uniforms.uSunDir.value.copy(e.sunDir);
    bMat.uniforms.uSunColor.value.copy(e.sunColor);
    bMat.uniforms.uSun.value = e.sun;
    gMat.uniforms.uTime.value = t;
    gMat.uniforms.uStreets.value = e.streets;
    gMat.uniforms.uSkyLow.value.copy(e.skyHorizon);
    gMat.uniforms.uFacade.value.copy(e.facade);
    sMat.uniforms.uTime.value = t;
    sMat.uniforms.uHaze.value.copy(e.fog);
    sMat.uniforms.uFacade.value.copy(e.facade);
    sMat.uniforms.uLit.value = e.lit;
    const su = skyMat.uniforms;
    su.uTop.value.copy(e.skyTop); su.uMid.value.copy(e.skyMid); su.uHorizon.value.copy(e.skyHorizon); su.uCloud.value.copy(e.cloud);
    su.uSunDir.value.copy(e.sunDir); su.uSunColor.value.copy(e.sunColor); su.uSun.value = e.sun;
    su.uMoonDir.value.copy(e.moonDir); su.uMoon.value = e.moon; su.uStars.value = e.stars; su.uTime.value = t; su.uGlow.value = e.cityGlow;
    lMat.uniforms.uTime.value = t;
    lMat.uniforms.uAmt.value = 0.4 + 0.6 * e.cityGlow;
    hMat.uniforms.uTime.value = t;
    deckMat.color.setRGB(0.6, 1.6, 2.4).multiplyScalar(0.3 + 0.7 * e.cityGlow);
    A.rainMat.uniforms.uTime.value = t;
    A.rainMat.uniforms.uAmt.value = e.rain;
    // 看板のちらつき
    for (const s of A.signMats) {
      const f = Math.sin(t * 0.7 + s.phase) > 0.97 ? (Math.sin(t * 60) > 0 ? 0.3 : 1) : 1;
      s.mat.color.setScalar(1.8 * f * (0.5 + 0.5 * e.cityGlow));
    }
    // 空飛ぶ車
    cars.forEach((c, i) => {
      c.x += c.v * dt;
      if (c.x > 1300) c.x -= 2600;
      if (c.x < -1300) c.x += 2600;
      const y = c.y + Math.sin(t * 0.8 + c.bob) * 0.6;
      const dir = Math.sign(c.v);
      q.setFromAxisAngle(pv.set(0, 1, 0), dir > 0 ? 0 : Math.PI);
      tmpM.compose(pv.set(c.x, y, c.z), q, sc);
      carBody.setMatrixAt(i, tmpM);
      tmpM.compose(pv.set(c.x, y - 0.75, c.z), q, sc);
      carGlow.setMatrixAt(i, tmpM);
      headPos.set([c.x + dir * 2.6, y, c.z], i * 6);
      headPos.set([c.x - dir * 2.6, y, c.z], i * 6 + 3);
      const tl = Math.min(120, Math.abs(c.v) * 1.4);
      trailPos.set([c.x - dir * 2.6, y, c.z], i * 6);
      trailPos.set([c.x - dir * (2.6 + tl), y, c.z], i * 6 + 3);
      const k = c.hue < 0.5 ? [1.6, 0.3, 0.9] : [0.3, 1.2, 1.7];
      trailCol.set(k, i * 6);
      trailCol.set([0, 0, 0], i * 6 + 3);
    });
    carBody.instanceMatrix.needsUpdate = true;
    carGlow.instanceMatrix.needsUpdate = true;
    hg.attributes.position.needsUpdate = true;
    tg.attributes.position.needsUpdate = true;
    tg.attributes.color.needsUpdate = true;
    // 飛行船
    blimp.position.x = 220 + Math.sin(t * 0.01) * 260;
    blimp.position.y = 95 + Math.sin(t * 0.13) * 3;
    blimp.rotation.y = Math.cos(t * 0.01) > 0 ? 0 : Math.PI;
    btex.offset.x = (t * 0.035) % 1;
    // 空は常にカメラの周り
    if (cam) sky.position.copy(cam.position);
  };
  return { city, A, update };
}
