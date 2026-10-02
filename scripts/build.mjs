// Bundles the app into one self-contained HTML file, dist/post-time.html, for sharing as a single page.
// Also writes dist/artifact.html, the same page without the document wrapper.
// The site itself doesn't need this: it runs straight from the repo.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

const result = await build({
  entryPoints: [new URL('js/app.js', root).pathname],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false,
  define: { __SINGLE_FILE__: 'true' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// Fonts and the icon go in as data: URIs; links that only make sense for the hosted site come out.
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
let css = await read('css/app.css');
for (const [, file] of css.matchAll(/url\('\.\.\/(fonts\/[^']+\.woff2)'\)/g)) css = css.replace(`url('../${file}')`, `url(${await dataUri(file, 'font/woff2')})`);
const icon = await dataUri('icon.svg', 'image/svg+xml');
const html = (await read('index.html'))
  .replace(/ *<script src="carry\.js"><\/script>\n/, '') // only needed at the game's own address
  .replace(/\s*<link rel="(manifest|apple-touch-icon|preload)"[^>]*>/g, '')
  .replace('href="icon.svg"', () => `href="${icon}"`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/app.js"></script>', () => `<script>\n${js}</script>`);

const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/post-time.html', root), html);
await writeFile(new URL('dist/artifact.html', root), fragment);
console.log(`dist/post-time.html  ${(html.length / 1024).toFixed(1)} KB`);
