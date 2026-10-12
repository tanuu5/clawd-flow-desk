// アダプターの見本（dev-harness スキル）。作品のモデルに差し替えるときは、この形のまま中身を書き換える。
// モデルは +Z（カメラの正面）を向き、足もとが y = 0 になるように置く。単位は作品と同じ（メートル推奨）。

export default {
  title: 'Example critter',

  // 作品のモデルを作って { root, update?, dispose? } を返す。作品側のクラスをそのまま包めばよい：
  //   create: () => { const m = new CourierModel(); const a = new CourierAnimator(m);
  //                   return { root: m.root, update: (dt, ctx) => { a.update(dt, ctx.params); m.update(dt, {}); } }; }
  create({ THREE }) {
    const root = new THREE.Group();
    root.name = 'critter';
    const fur = new THREE.MeshStandardMaterial({ name: 'fur', color: 0xd9a066, roughness: 0.8 });
    const cream = new THREE.MeshStandardMaterial({ name: 'cream', color: 0xf3e3c8, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ name: 'dark', color: 0x2a2228, roughness: 0.4 });

    const hips = new THREE.Group(); hips.name = 'hips'; hips.position.y = 0.42; root.add(hips);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.22, 6, 16), fur); body.name = 'body'; body.position.y = 0.17; hips.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), cream); belly.name = 'belly'; belly.scale.set(1, 1.35, 0.55); belly.position.set(0, 0.15, 0.115); hips.add(belly);
    const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.52; hips.add(head);
    head.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), fur), { name: 'skull' }));
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 12), fur); ear.name = s < 0 ? 'earL' : 'earR';
      ear.position.set(0.09 * s, 0.17, -0.01); ear.rotation.z = -0.3 * s; head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), dark); eye.name = s < 0 ? 'eyeL' : 'eyeR';
      eye.position.set(0.062 * s, 0.02, 0.152); head.add(eye);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 10), fur); leg.name = s < 0 ? 'legL' : 'legR';
      leg.geometry.translate(0, -0.18, 0); leg.position.set(0.08 * s, 0.02, 0); hips.add(leg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18, 4, 10), fur); arm.name = s < 0 ? 'armL' : 'armR';
      arm.geometry.translate(0, -0.12, 0); arm.position.set(0.19 * s, 0.3, 0); hips.add(arm);
    }
    const tail = new THREE.Group(); tail.name = 'tail'; tail.position.set(0, 0.05, -0.15); hips.add(tail);
    let seg = tail;
    for (let i = 0; i < 5; i++) {
      const j = new THREE.Group(); j.name = 'tail' + i; j.position.z = i ? -0.07 : 0; seg.add(j);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07 - i * 0.006, 12, 8), i === 4 ? cream : fur);
      m.name = 'tailBall' + i; m.scale.z = 1.4; j.add(m); seg = j;
    }
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 20), dark); hat.name = 'hat'; hat.position.y = 0.17; hat.visible = false; head.add(hat);

    const P = (n) => root.getObjectByName(n);
    let jumpT = -1;
    return {
      root,
      jump() { jumpT = 0; },
      setHat(on) { hat.visible = on; },
      // ctx = { mode, params（modes に書いた値）, time, toggles }
      update(dt, ctx) {
        const t = ctx.time;
        const { speed = 0, wave = false } = ctx.params;
        const ph = t * (4 + speed * 2.2);
        const swing = Math.min(1, speed / 3) * 0.7;
        P('legL').rotation.x = Math.sin(ph) * swing;
        P('legR').rotation.x = -Math.sin(ph) * swing;
        P('armL').rotation.x = -Math.sin(ph) * swing;
        P('armR').rotation.x = Math.sin(ph) * swing;
        P('armR').rotation.z = wave ? 2.6 + Math.sin(t * 9) * 0.35 : 0.08;
        P('armL').rotation.z = -0.08;
        hips.position.y = 0.42 + Math.abs(Math.sin(ph)) * 0.03 * Math.min(1, speed);
        head.rotation.z = Math.sin(t * 1.3) * 0.05;
        for (let i = 0; i < 5; i++) P('tail' + i).rotation.y = Math.sin(t * 5 - i * 0.6) * 0.25;
        P('tail0').rotation.x = 0.6;
        if (jumpT >= 0) {
          jumpT += dt;
          const k = jumpT / 0.6;
          root.position.y = k < 1 ? Math.sin(k * Math.PI) * 0.35 : 0;
          if (k >= 1) jumpT = -1;
        }
      },
    };
  },

  // ボタンに並ぶ動き。配列でも、{ 名前: update に渡す値 } でもよい。
  modes: { idle: { speed: 0 }, walk: { speed: 1.5 }, run: { speed: 4 }, wave: { speed: 0, wave: true } },

  // 入り切りするもの（初期値と、切り替えたときの処理）
  toggles: { hat: { on: false, set: (m, on) => m.setHat(on) } },

  // 1回だけ起こすもの
  actions: { jump: (m) => m.jump() },

  // 自動のカメラ位置（front / q3 / side / back / top / low）に足すもの
  views: { face: { pos: [0, 0.98, 1.3], target: [0, 0.94, 0], fov: 25 } },

  // 参照画像（view 名 → 画像の URL）。元のイラストと同じ向き・画角の view に合わせる
  refs: {
    // front: '/ref/front.png',
  },

  // 作品の照明で見たいとき（light ボタンの「work」）。夜の街灯・室内の暖色など、確認台の照明では見えない色の問題を探す
  // lights({ THREE }) {
  //   const g = new THREE.Group();
  //   g.add(new THREE.HemisphereLight(0x3b4a6b, 0x0b0c10, 0.25));
  //   const lamp = new THREE.PointLight(0xffa860, 40, 12, 2); lamp.position.set(0.8, 2.4, 1.2); lamp.castShadow = true; g.add(lamp);
  //   return g;
  // },
  // lightsBackground: '#07080c',

  // 作品の見た目に合わせたいとき（トーンマッピング・露出など）
  // setup({ THREE, renderer }) { renderer.toneMapping = THREE.ACESFilmicToneMapping; },
  // background: '#cfe5f1',
};
