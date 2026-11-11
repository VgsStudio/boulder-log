// Gera dist/: static/assets/* (nome com hash, cache de 1 ano) e pages/* (sempre revalidado).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'pages'), { recursive: true });

const out = await build({
  entryPoints: [path.join(root, 'web/src/app.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
  entryNames: '[name]-[hash]',
  outdir: path.join(dist, 'static/assets'),
  metafile: true,
  legalComments: 'none',
});
const files = Object.keys(out.metafile.outputs).map((f) => path.basename(f));
const js = files.find((f) => f.endsWith('.js'));
const css = files.find((f) => f.endsWith('.css'));

const html = readFileSync(path.join(root, 'web/index.html'), 'utf8').replace('__JS__', js).replace('__CSS__', css);
writeFileSync(path.join(dist, 'pages/index.html'), html);
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png']) cpSync(path.join(root, 'web', f), path.join(dist, 'pages', f));

for (const [f, o] of Object.entries(out.metafile.outputs)) console.log(`${path.basename(f)}  ${(o.bytes / 1024).toFixed(1)} KB`);
