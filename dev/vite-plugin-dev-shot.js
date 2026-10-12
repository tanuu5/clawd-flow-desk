// vite-plugin-dev-shot.js — 開発サーバーだけで使う画像の保存口（dev-harness スキル）
//
// ページから POST /__shot?name=<名前> に dataURL（PNG / JPEG / WebP）を送ると、
// プロジェクトの shots/<名前>.<拡張子> に保存する。名前に / を入れるとサブフォルダになる。
// apply: 'serve' なので公開ビルドには入らない。shots/ は .gitignore に入れておく。
//
//   // vite.config.js
//   import { devShot } from './dev/vite-plugin-dev-shot.js';
//   export default defineConfig({ plugins: [devShot()] });

import fs from 'node:fs';
import path from 'node:path';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** dataURL の本体を受け取り、dir の下に保存して base（プロジェクト）からの相対パスを返す（dev-server.mjs と共用）。 */
export function saveShot(dir, rawName, body, base = path.dirname(dir)) {
  const m = /^data:(image\/[\w+.-]+);base64,/.exec(body);
  const ext = EXT[m?.[1]] || 'png';
  const name = String(rawName || 'shot')
    .split('/').map((s) => s.replace(/[^\w.-]/g, '_').replace(/^\.+/, '')).filter(Boolean).join('/') || 'shot';
  const file = path.join(dir, `${name}.${ext}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(body.slice(m ? m[0].length : 0), 'base64'));
  return path.relative(base, file);
}

export function devShot({ dir = 'shots', route = '/__shot' } = {}) {
  return {
    name: 'dev-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const name = new URL(req.url, 'http://x').searchParams.get('name');
            res.end(saveShot(path.resolve(server.config.root, dir), name, Buffer.concat(chunks).toString(), server.config.root));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}
