import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { devShot } from './dev/vite-plugin-dev-shot.js';

// 開発サーバーだけ：送られた中身を shots/<名前> に保存する（音の書き出しの確認、動画の録画用）
//   POST /__save?name=<名前>    上書き
//   POST /__append?name=<名前>  末尾に書き足す（録画を少しずつ書き出す）
function devSave() {
  const handler = (append) => (req, res) => {
    const name = new URL(req.url, 'http://x').searchParams.get('name') || 'out.bin';
    const safe = name.split('/').map((s) => s.replace(/[^\w.-]/g, '_')).filter((s) => s && s !== '..').join('/');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const file = path.join(process.cwd(), 'shots', safe);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      (append ? fs.appendFileSync : fs.writeFileSync)(file, Buffer.concat(chunks));
      res.end(path.relative(process.cwd(), file));
    });
  };
  return {
    name: 'dev-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', handler(false));
      server.middlewares.use('/__append', handler(true));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devShot(), devSave()],
  server: { host: '127.0.0.1', port: 5184 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
