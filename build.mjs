// Build the explorer engine and the project pages.
//   node build.mjs                 -> builds every project listed in projects.json
// Each project folder gets: index.html (website), artifact.html (Claude preview), engine/ (bundled JS + CSS).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const projects = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
const outEngine = path.join(root, 'engine', 'build');
const site = path.join(root, 'site');
fs.rmSync(outEngine, { recursive: true, force: true });
await build({
  entryPoints: [path.join(root, 'engine/src/main.js')], bundle: true, format: 'esm', splitting: true,
  outdir: outEngine, minify: true, target: 'es2020', chunkNames: 'chunk-[hash]', legalComments: 'none',
});
fs.copyFileSync(path.join(root, 'engine/engine.css'), path.join(outEngine, 'engine.css'));

const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">';

for (const p of projects) {
  const dir = path.join(site, p.slug);
  fs.rmSync(path.join(dir, 'engine'), { recursive: true, force: true });
  fs.cpSync(outEngine, path.join(dir, 'engine'), { recursive: true });
  const cfg = JSON.stringify({ data: 'data.json', assets: 'assets/', mapsKey: p.mapsKey || '', title: p.title });
  const head = `<title>${p.title}</title>\n<meta name="description" content="${p.description}">\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<link rel="stylesheet" href="engine/engine.css">`;
  const bodyHtml = `<div class="app" id="app"></div>\n<script type="module">import { boot } from './engine/main.js'; boot(${cfg});</script>`;
  const og = `<meta property="og:title" content="${p.title}"><meta property="og:description" content="${p.description}"><meta property="og:image" content="assets/ai/hero.jpg">`;
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${head}\n${og}\n</head><body>\n${bodyHtml}\n</body></html>\n`);
  // Claude artifact preview: no Maps key (the preview blocks outside map servers), skeleton added by the host.
  const cfgPreview = JSON.stringify({ data: 'data.json', assets: 'assets/', mapsKey: '', title: p.title });
  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'artifact.html'), `${head}\n<div class="app" id="app"></div>\n<script type="module">import { boot } from './engine/main.js'; boot(${cfgPreview});</script>\n`);
  console.log('built', p.slug);
}
