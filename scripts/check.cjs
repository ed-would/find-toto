'use strict';

// Real asset/coordinate checks plus syntax and offline-path checks. No network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveRequestPath, parsePort } = require('./serve.cjs');
const root = path.resolve(__dirname, '..');
const problems = [];
const resources = new Set();
let scripts = 0;
const fail = message => problems.push(message);

function dimensions(filename) {
  const b = fs.readFileSync(filename);
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= b.length;) {
      const type = b.toString('ascii', offset, offset + 4);
      const size = b.readUInt32LE(offset + 4);
      const p = offset + 8;
      if (type === 'VP8X' && size >= 10) return { width: 1 + b.readUIntLE(p + 4, 3), height: 1 + b.readUIntLE(p + 7, 3) };
      if (type === 'VP8 ' && size >= 10) return { width: b.readUInt16LE(p + 6) & 0x3fff, height: b.readUInt16LE(p + 8) & 0x3fff };
      if (type === 'VP8L' && size >= 5) return { width: 1 + (((b[p+2] & 0x3f) << 8) | b[p+1]), height: 1 + (((b[p+4] & 0x0f) << 10) | (b[p+3] << 2) | (b[p+2] >> 6)) };
      offset = p + size + (size & 1);
    }
  }
  throw new Error('Не удалось прочитать размеры ' + path.relative(root, filename));
}

function reference(value, source) {
  if (!value || /^(?:#|data:|blob:)/i.test(value)) return null;
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) {
    fail(source + ': ресурс должен иметь относительный локальный путь: ' + value); return null;
  }
  let relative;
  try { relative = decodeURIComponent(value.split(/[?#]/)[0]); }
  catch { fail(source + ': неверный путь ' + value); return null; }
  const file = path.resolve(path.dirname(path.join(root, source)), relative);
  const fromRoot = path.relative(root, file);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) { fail(source + ': путь выходит из проекта'); return null; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { fail(source + ': отсутствует ' + value); return null; }
  if (!fs.statSync(file).size) fail(source + ': пустой ресурс ' + value);
  resources.add(fromRoot);
  return file;
}

function sources(directory = root, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || ['node_modules','dist'].includes(entry.name)) return [];
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? sources(path.join(directory, entry.name), relative)
      : /\.(html|css|js|cjs)$/.test(entry.name) ? [relative] : [];
  });
}

for (const file of ['index.html','styles.css','config.js','progress.js','game.js','README.md','START-HERE.html',
  'package.json','package-lock.json','.nojekyll','.github/workflows/pages.yml','scripts/build.cjs']) {
  if (!fs.existsSync(path.join(root, file))) fail('Отсутствует обязательный файл ' + file);
}

for (const source of sources()) {
  const text = fs.readFileSync(path.join(root, source), 'utf8');
  if (/\.(js|cjs)$/.test(source)) {
    try { new vm.Script(text, { filename: source }); scripts++; }
    catch (e) { fail(source + ': ' + e.message); }
  }
  if (source.endsWith('.html')) {
    const ids = new Set();
    for (const m of text.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
      if (ids.has(m[1])) fail(source + ': повторный id ' + m[1]);
      ids.add(m[1]);
    }
    for (const m of text.matchAll(/<(script|link|img|audio|video|source|iframe|image)\b[^>]*>/gi)) {
      const attr = m[1].toLowerCase() === 'link' ? 'href' : 'src';
      const match = m[0].match(new RegExp('\\b' + attr + '\\s*=\\s*["\x27]([^"\x27]+)["\x27]', 'i'));
      if (match) reference(match[1], source);
      if (m[1].toLowerCase() === 'script' && /type=["']module["']/i.test(m[0])) fail(source + ': ES-модуль несовместим с простым file:// запуском');
    }
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(m[1])) continue;
      try { new vm.Script(m[2]); scripts++; } catch (e) { fail(source + ': ' + e.message); }
    }
  }
  if (/\.(css|html)$/.test(source)) {
    for (const m of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) reference(m[1], source);
    if (/@import\s/i.test(text)) fail(source + ': внешний CSS @import');
  }
}

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length) fail('Появились внешние npm-зависимости.');
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root,'config.js'),'utf8'), context);
  const config = context.window.FIND_TOTO_CONFIG;
  if (!config || !Array.isArray(config.levels) || config.levels.length !== 13) throw new Error('Должно быть ровно 13 уровней.');
  if (config.unlockIntervalMs !== 1800000) fail('Интервал должен быть 30 минут.');
  const scenePaths = new Set(), cardPaths = new Set(), titles = new Set(), cardTexts = new Set();
  config.levels.forEach((level,index) => {
    if (level.id !== index + 1) fail('Неверный порядок id уровня ' + level.id);
    for (const key of ['title','subtitle','description']) if (!level[key]) fail('Уровень ' + level.id + ': нет ' + key);
    titles.add(level.title); scenePaths.add(level.scene.src); cardPaths.add(level.card.src); cardTexts.add(level.card.text);
    const sceneFile = reference(level.scene.src, 'config.js');
    const cardFile = reference(level.card.src, 'config.js');
    reference(level.thumbnail, 'config.js');
    if (sceneFile) {
      const actual = dimensions(sceneFile);
      if (actual.width !== level.scene.width || actual.height !== level.scene.height) fail('Уровень ' + level.id + ': размеры сцены расходятся с config.js');
      if (actual.width < 3072 || actual.height < 2048) fail('Уровень ' + level.id + ': экспорт сцены меньше 2× исходного разрешения');
    }
    if (cardFile) {
      const actual = dimensions(cardFile);
      if (actual.width < 3072 || actual.height < 2048) fail('Уровень ' + level.id + ': открытка меньше 2× исходного разрешения');
    }
    const {width,height} = level.scene, {x,y,rx,ry} = level.target, area = level.hintArea;
    if (![width,height,x,y,rx,ry,area.x,area.y,area.radius].every(Number.isFinite) || Math.min(rx,ry) <= 0) fail('Уровень ' + level.id + ': некорректные координаты');
    if (x-rx < 0 || y-ry < 0 || x+rx > width || y+ry > height) fail('Уровень ' + level.id + ': цель за границами');
    if (area.radius < width * .2) fail('Уровень ' + level.id + ': третья подсказка слишком узкая');
    if (Math.hypot(x-area.x,y-area.y) + Math.max(rx,ry) > area.radius) fail('Уровень ' + level.id + ': Тото выходит за круг подсказки');
    if (Math.hypot(x-area.x,y-area.y) < Math.max(rx,ry)) fail('Уровень ' + level.id + ': круг слишком точно центрирован на Тото');
    if (!Array.isArray(level.hints) || level.hints.length !== 3 || level.hints.some(h=>!h)) fail('Уровень ' + level.id + ': нужны три подсказки');
  });
  for (const [label,set] of [['сцен',scenePaths],['открыток',cardPaths],['названий',titles],['поздравлений',cardTexts]]) {
    if (set.size !== 13) fail('Должно быть 13 уникальных ' + label);
  }
  const finalFile = reference('assets/cards/final.webp','config.js');
  if (finalFile) {
    const actual = dimensions(finalFile);
    if (actual.width < 3072 || actual.height < 2048) fail('Финальное изображение меньше 2× исходного');
  }
} catch (e) { fail('Конфигурация / изображения: ' + e.message); }

if (resolveRequestPath('/',root) !== path.join(root,'index.html')) fail('Неверный путь локального сервера');
for (const unsafe of ['/%00','/%ZZ','/.git/config','/assets/../../.env','/node_modules/x.js','/assets/%5Csecret']) {
  if (resolveRequestPath(unsafe,root) !== null) fail('Сервер принимает запрещённый путь: ' + unsafe);
}
if (parsePort(undefined) !== 4173) fail('Неверный локальный порт');

if (problems.length) {
  console.error('Проверка не пройдена:\n' + problems.map(x=>' • '+x).join('\n'));
  process.exitCode = 1;
} else {
  console.log('✓ 13 уникальных сцен, 13 открыток и отдельный финал.');
  console.log('✓ Реальные размеры изображений, зоны попадания и широкие области подсказок.');
  console.log('✓ ' + resources.size + ' локальных ресурсов; ' + scripts + ' проверок синтаксиса JavaScript.');
  console.log('✓ Относительные пути для GitHub Pages и file://, без внешних npm-зависимостей.');
}
