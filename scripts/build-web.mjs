// Gera dist/:
//   static/assets/*  nome com hash (JS/CSS) ou versionado (modelo) → cache de 1 ano
//   gz/assets/ort-<versão>/*.wasm  já comprimido em gzip (o CloudFront só comprime até 10 MB)
//   pages/*  index.html, manifest, ícones → sempre revalidados
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const ortVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8')).version;
const ortBase = `/assets/ort-${ortVersion}/`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'pages'), { recursive: true });

// Worker do detector de agarras: arquivo próprio (com o onnxruntime dentro), carregado na primeira foto.
const wk = await build({
  entryPoints: [path.join(root, 'web/src/detect-worker.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
  entryNames: '[name]-[hash]',
  outdir: path.join(dist, 'static/assets'),
  metafile: true,
  legalComments: 'none',
  define: { __ORT_BASE__: JSON.stringify(ortBase), __WORKER_URL__: '""' },
  logOverride: { 'empty-import-meta': 'silent' },
});
const workerFile = Object.keys(wk.metafile.outputs).map((f) => path.basename(f)).find((f) => f.endsWith('.js'));

const out = await build({
  entryPoints: [path.join(root, 'web/src/app.js')],
  bundle: true,
  splitting: true, // onnxruntime-web vira um pedaço separado, carregado só na primeira foto
  minify: true,
  format: 'esm',
  target: ['es2022', 'safari16'],
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  outdir: path.join(dist, 'static/assets'),
  metafile: true,
  legalComments: 'none',
  define: { __ORT_BASE__: JSON.stringify(ortBase), __WORKER_URL__: JSON.stringify(`/assets/${workerFile}`) },
  logOverride: { 'empty-import-meta': 'silent' },
});
const entry = Object.entries(out.metafile.outputs).filter(([, o]) => o.entryPoint).map(([f]) => path.basename(f));
const js = entry.find((f) => f.endsWith('.js'));
const css = Object.keys(out.metafile.outputs).map((f) => path.basename(f)).find((f) => f.endsWith('.css'));

const html = readFileSync(path.join(root, 'web/index.html'), 'utf8').replace('__JS__', js).replace('__CSS__', css);
writeFileSync(path.join(dist, 'pages/index.html'), html);
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png', 'email/banner.png', 'privacidade.html', 'legal.css']) cpSync(path.join(root, 'web', f), path.join(dist, 'pages', f));

// Modelo de agarras (versão no nome do arquivo) e runtime WebAssembly.
cpSync(path.join(root, 'web/models/holds-yolov8n-fp16.onnx'), path.join(dist, 'static/assets/models/holds-yolov8n-fp16.onnx'));
const wasm = readFileSync(path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'));
mkdirSync(path.join(dist, `gz${ortBase}`), { recursive: true });
writeFileSync(path.join(dist, `gz${ortBase}ort-wasm-simd-threaded.wasm`), gzipSync(wasm, { level: 9 }));

for (const [f, o] of [...Object.entries(out.metafile.outputs), ...Object.entries(wk.metafile.outputs)]) console.log(`${path.basename(f)}  ${(o.bytes / 1024).toFixed(1)} KB`);
console.log(`ort-wasm (gzip)  ${(gzipSync(wasm, { level: 9 }).length / 1048576).toFixed(1)} MB  em ${ortBase}`);
