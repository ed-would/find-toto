'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, memoryStorage } = require('./dom-fixture.cjs');
const { imagePoint } = require('../game.js');
const INTERVAL = 30 * 60 * 1000;
const START = Date.UTC(2026, 9, 24, 6, 0, 0);
const plain = value => JSON.parse(JSON.stringify(value));

function tap(h, point, type = 'mouse') {
  h.pointer('pointerdown', point, 1, type);
  h.pointer('pointerup', point, 1, type);
  h.advance(20);
}

function findToto(h) {
  h.click('fitButton');
  tap(h, h.screenPoint(h.currentLevel().target));
  h.advance(200);
}

function resumeAt(h, index) {
  h.click('journeyButton');
  h.click('level-' + index);
}

test('Интро сохраняет время до начала игры, показывает 13 прогулок и один открытый уровень', () => {
  const h = createHarness();
  assert.equal(h.getState().phase, 'welcome');
  assert.equal(h.getState().imageReady, true);
  assert.equal(h.getState().startedAt, START);
  assert.equal(h.getState().unlockedCount, 1);
  assert.equal(h.document.getElementById('levelGrid').children.length, 13);
  assert.equal(h.document.getElementById('level-1').disabled, false);
  assert.equal(h.document.getElementById('level-2').disabled, true);
  assert.equal(JSON.parse(h.storage.getItem(h.config.storageKey)).startedAt, START);
  h.sleep(5 * 60 * 1000);
  h.document.dispatch('visibilitychange');
  h.click('startButton');
  assert.equal(h.getState().startedAt, START, 'кнопка старта не переносит начало отсчёта');
  assert.equal(h.getState().phase, 'playing');
  assert.ok(h.getState().elapsedMs < 100, 'время поиска начинается отдельно от расписания');
});

test('Поле телефона: обзор, пустые поля, промах и точное попадание по иллюстрации', () => {
  const h = createHarness({ width: 400, height: 650 });
  h.click('startButton');
  assert.ok(h.getState().zoom > 1, 'узкое поле начинается с заполненного картинкой вида');
  h.click('fitButton');
  assert.equal(h.getState().zoom, 1);
  const view = h.getState();
  assert.ok(view.transform.y > 0);
  tap(h, { x: h.viewport.rect.left + 100, y: h.viewport.rect.top + h.viewport.clientTop + view.transform.y / 2 });
  assert.equal(h.getState().misses, 0, 'нажатие на пустое поле не считается промахом');
  tap(h, h.screenPoint({ x: 100, y: 100 }));
  assert.equal(h.getState().misses, 1);
  assert.equal(h.getState().phase, 'playing');
  tap(h, h.screenPoint(h.currentLevel().target), 'touch');
  assert.equal(h.getState().phase, 'celebrating');
  assert.ok(h.getDrawCalls() > 0);
  h.advance(200);
  assert.equal(h.getState().phase, 'won');
  assert.equal(h.document.getElementById('victoryDialog').open, true);
  assert.deepEqual(plain(h.getState().completed), ['1']);
  assert.equal(h.document.getElementById('cardImage').src, h.currentLevel().card.src);
});

test('Попадание остаётся точным после масштабирования, сдвига и смещения игрового поля', () => {
  const h = createHarness({ width: 1000, height: 650 });
  h.click('startButton');
  const anchor = h.screenPoint(h.currentLevel().target);
  h.viewport.dispatch('wheel', { clientX: anchor.x, clientY: anchor.y, deltaY: -350, deltaMode: 0, ctrlKey: false });
  h.advance(20);
  assert.ok(h.getState().zoom > 1);
  const start = { x: 450, y: 350 };
  const end = { x: 350, y: 390 };
  h.pointer('pointerdown', start);
  h.pointer('pointermove', end);
  h.pointer('pointerup', end);
  assert.equal(h.getState().phase, 'playing');
  assert.equal(h.getState().misses, 0);
  tap(h, h.screenPoint(h.currentLevel().target));
  assert.equal(h.getState().phase, 'celebrating');
});

test('Отмена, потеря захвата и движение туда-обратно не превращаются в победный клик', () => {
  const h = createHarness();
  h.click('startButton');
  let point = h.screenPoint(h.currentLevel().target);
  h.pointer('pointerdown', point);
  h.pointer('pointercancel', point);
  h.pointer('pointerup', point);
  assert.equal(h.getState().activePointers, 0);
  assert.equal(h.getState().phase, 'playing');
  h.pointer('pointerdown', point);
  h.pointer('lostpointercapture', point);
  h.pointer('pointerup', point);
  assert.equal(h.getState().activePointers, 0);
  h.pointer('pointerdown', point);
  h.pointer('pointermove', { x: point.x + 40, y: point.y });
  h.pointer('pointermove', point);
  h.pointer('pointerup', point);
  assert.equal(h.getState().phase, 'playing');
  assert.equal(h.getState().misses, 0);
  point = h.screenPoint(h.currentLevel().target);
  tap(h, point);
  assert.equal(h.getState().phase, 'celebrating');
});

test('Два пальца → один → ни одного не засчитываются как нажатие по Тото', () => {
  const h = createHarness();
  h.click('startButton');
  let point = h.screenPoint(h.currentLevel().target);
  h.pointer('pointerdown', point, 1, 'touch');
  h.pointer('pointerdown', { x: point.x + 70, y: point.y }, 2, 'touch');
  h.pointer('pointerup', { x: point.x + 70, y: point.y }, 2, 'touch');
  h.pointer('pointerup', point, 1, 'touch');
  assert.equal(h.getState().phase, 'playing');
  assert.equal(h.getState().misses, 0);
  point = h.screenPoint(h.currentLevel().target);
  h.pointer('pointerdown', point, 1, 'touch');
  h.pointer('pointerdown', { x: point.x - 70, y: point.y }, 2, 'touch');
  h.pointer('pointermove', { x: point.x - 120, y: point.y }, 2, 'touch');
  h.pointer('pointerup', { x: point.x - 120, y: point.y }, 2, 'touch');
  h.pointer('pointerup', h.screenPoint(h.currentLevel().target), 1, 'touch');
  assert.ok(h.getState().zoom > 1);
  assert.equal(h.getState().phase, 'playing');
  assert.equal(h.getState().activePointers, 0);
});

test('Подсказки 1 и 2 только текстовые; третья показывает широкий круг без маркера или приближения к Тото', () => {
  const h = createHarness();
  h.click('startButton');
  h.click('zoomIn');
  const before = plain(h.getState().transform);
  for (let i = 0; i < 2; i++) {
    h.click('hintButton');
    assert.deepEqual(plain(h.getState().transform), before);
    assert.equal(h.document.getElementById('hintArea').hidden, true);
    assert.equal(h.document.getElementById('hintPin').hidden, true);
    assert.equal(h.document.getElementById('hintMessage').textContent, h.currentLevel().hints[i]);
  }
  h.click('hintButton');
  assert.equal(h.getState().hintsUsed, 3);
  assert.equal(h.getState().zoom, 1);
  const circle = h.document.getElementById('hintArea');
  assert.equal(circle.hidden, false);
  assert.ok(parseFloat(circle.style.width) >= h.currentLevel().scene.width * 0.38);
  assert.equal(h.document.getElementById('hintPin').hidden, true);
  if (h.document.getElementById('revealButton')) assert.equal(h.document.getElementById('revealButton').hidden, true);
  const area = h.currentLevel().hintArea;
  const target = h.currentLevel().target;
  assert.ok(Math.hypot(area.x - target.x, area.y - target.y) > Math.max(target.rx, target.ry), 'Тото не в центре круга');
  assert.equal(h.document.getElementById('hintButton').disabled, true);
  assert.equal(h.document.getElementById('mapHintButton').disabled, true);
  assert.equal(h.getState().phase, 'playing', 'подсказки не дают автоматическую победу');
});

test('Расписание работает после сна; можно пропустить первые уровни и выбрать любой открытый', () => {
  const h = createHarness();
  h.sleep(3 * INTERVAL);
  h.window.dispatch('pageshow');
  assert.equal(h.getState().unlockedCount, 4);
  assert.deepEqual(plain(h.getState().completed), []);
  h.document.getElementById('level-5').dispatch('click');
  h.advance(20);
  assert.equal(h.getState().levelId, 1, 'даже искусственный click закрытого уровня не меняет сцену');
  h.click('level-4');
  assert.equal(h.getState().levelId, 4);
  assert.equal(h.getState().phase, 'playing');
  findToto(h);
  assert.equal(h.document.getElementById('cardTitle').textContent, h.config.levels[3].card.title);
  assert.deepEqual(plain(h.getState().completed), ['4']);
  h.click('nextLevelButton');
  assert.equal(h.getState().levelId, 1, 'следующей предлагается открытая непройденная прогулка');
});

test('Повтор сбрасывает только текущий поиск, сохраняя расписание и найденные открытки', () => {
  const h = createHarness();
  h.click('startButton');
  h.click('hintButton');
  h.advance(3000);
  findToto(h);
  const startedAt = h.getState().startedAt;
  h.click('replayButton');
  assert.equal(h.getState().phase, 'playing');
  assert.equal(h.getState().hintsUsed, 0);
  assert.equal(h.getState().misses, 0);
  assert.ok(h.getState().elapsedMs < 100);
  assert.equal(h.getState().startedAt, startedAt);
  assert.deepEqual(plain(h.getState().completed), ['1']);
  assert.equal(h.document.getElementById('hintPin').hidden, true);
  assert.equal(h.document.getElementById('confettiCanvas').hidden, true);
  findToto(h);
  assert.deepEqual(plain(h.getState().completed), ['1']);
  assert.equal(h.getState().allCompleted, false);
});

test('Открытка закрывается, открывается снова и не запускает повторную победу от лишнего pointerup', () => {
  const h = createHarness();
  h.click('startButton');
  tap(h, h.screenPoint(h.currentLevel().target));
  const drawCount = h.getDrawCalls();
  h.pointer('pointerup', h.screenPoint(h.currentLevel().target));
  assert.equal(h.getDrawCalls(), drawCount);
  h.advance(200);
  assert.equal(h.document.getElementById('confettiCanvas').parentNode.id, 'victoryDialog');
  h.click('victoryClose');
  assert.equal(h.document.getElementById('victoryDialog').open, false);
  assert.equal(h.document.getElementById('confettiCanvas').parentNode, h.document.body);
  h.click('openCardButton');
  assert.equal(h.document.getElementById('victoryDialog').open, true);
});

test('На весь экран раскрывается только sceneShell; увеличение и центр вида сохраняются при входе и выходе', () => {
  const h = createHarness({ nativeFullscreen: true });
  h.click('startButton');
  h.click('zoomIn');
  h.click('zoomIn');
  const before = h.getState();
  const beforeCenter = imagePoint(before.transform, { x: before.viewport.width / 2, y: before.viewport.height / 2 });
  h.click('fullscreenButton');
  assert.deepEqual(h.getFullscreenRequests().map(node => node.id), ['sceneShell']);
  assert.equal(h.getState().fullscreen, true);
  const after = h.getState();
  const afterCenter = imagePoint(after.transform, { x: after.viewport.width / 2, y: after.viewport.height / 2 });
  assert.ok(Math.abs(after.zoom - before.zoom) < 1e-8);
  assert.ok(Math.abs(afterCenter.x - beforeCenter.x) < 1e-8);
  assert.ok(Math.abs(afterCenter.y - beforeCenter.y) < 1e-8);
  h.click('fullscreenButton');
  assert.equal(h.getState().fullscreen, false);
  assert.equal(h.getFullscreenExits(), 1);
  assert.ok(Math.abs(h.getState().zoom - before.zoom) < 1e-8);
});

test('Без Fullscreen API и при отказе браузера работает полноэкранная картинка с выходом по Escape', () => {
  for (const options of [{}, { nativeFullscreen: true, rejectFullscreen: true }]) {
    const h = createHarness(options);
    h.click('startButton');
    h.click('fullscreenButton');
    assert.equal(h.getState().immersiveFallback, true);
    assert.equal(h.document.getElementById('sceneShell').classList.contains('is-immersive'), true);
    assert.equal(h.document.body.classList.contains('map-is-immersive'), true);
    h.document.dispatch('keydown', { key: 'Escape' });
    h.advance(20);
    assert.equal(h.getState().fullscreen, false);
    assert.equal(h.document.body.classList.contains('map-is-immersive'), false);
  }
});

test('Победа дожидается выхода картинки из нативного fullscreen и только затем показывает открытку', async () => {
  const h = createHarness({ nativeFullscreen: true, delayedFullscreenExit: true });
  h.click('startButton');
  h.click('fullscreenButton');
  tap(h, h.screenPoint(h.currentLevel().target));
  assert.equal(h.getState().phase, 'celebrating');
  assert.equal(h.document.getElementById('victoryDialog').open, false);
  assert.equal(h.document.fullscreenElement.id, 'sceneShell');
  h.advance(60);
  await Promise.resolve();
  h.advance(200);
  assert.equal(h.document.fullscreenElement, null);
  assert.equal(h.document.getElementById('victoryDialog').open, true);
  assert.equal(h.getFullscreenExits(), 1);
});

test('Клавиатура двигает картинку, показывает прицел, Enter находит Тото в центре вида', () => {
  const h = createHarness();
  h.click('startButton');
  h.viewport.dispatch('keydown', { key: '+' });
  h.advance(20);
  assert.equal(h.document.getElementById('keyboardCursor').hidden, false);
  for (let i = 0; i < 3; i++) h.click('zoomIn');
  const point = h.screenPoint(h.currentLevel().target);
  const center = {
    x: h.viewport.rect.left + h.viewport.clientLeft + h.viewport.clientWidth / 2,
    y: h.viewport.rect.top + h.viewport.clientTop + h.viewport.clientHeight / 2
  };
  h.pointer('pointerdown', point);
  h.pointer('pointermove', center);
  h.pointer('pointerup', center);
  h.advance(20);
  assert.equal(h.getState().phase, 'playing');
  h.viewport.dispatch('keydown', { key: 'Enter' });
  assert.equal(h.getState().phase, 'celebrating');
});

test('Сбой загрузки до старта даёт повтор, сохраняет исходное время и возвращает интро', () => {
  for (const url of [undefined, 'https://example.github.io/find-toto/']) {
    const h = createHarness({ loaded: false, url });
    assert.equal(h.document.getElementById('startButton').disabled, true);
    assert.equal(JSON.parse(h.storage.getItem(h.config.storageKey)).startedAt, START);
    h.scene.dispatch('error');
    h.advance(20);
    assert.equal(h.getState().imageError, true);
    assert.equal(h.document.getElementById('welcomeDialog').open, false);
    assert.equal(h.document.getElementById('loadError').hidden, false);
    h.click('retryImageButton');
    assert.match(h.scene.src, /scene-01\.webp\?retry=/);
    if (url) assert.match(h.scene.src, /^https:\/\/example\.github\.io\/find-toto\/assets\//);
    else assert.match(h.scene.src, /^file:/);
    h.completeImage();
    assert.equal(h.getState().imageError, false);
    assert.equal(h.document.getElementById('welcomeDialog').open, true);
    assert.equal(h.getState().startedAt, START);
    h.click('startButton');
    assert.equal(h.getState().phase, 'playing');
  }
});

test('Ошибка изображения, уже завершившего загрузку до запуска скрипта, сразу показывает доступный повтор', () => {
  const h = createHarness({ loaded: false, cachedFailure: true });
  assert.equal(h.getState().imageError, true);
  assert.equal(h.document.getElementById('loadError').hidden, false);
  assert.equal(h.document.getElementById('welcomeDialog').open, false);
  assert.equal(h.getState().startedAt, START);
  h.click('retryImageButton');
  h.completeImage();
  assert.equal(h.getState().imageReady, true);
  assert.equal(h.document.getElementById('welcomeDialog').open, true);
});

test('Если следующая сцена не загрузилась, повтор восстанавливает выбранный уровень и его правильную цель', () => {
  const h = createHarness();
  h.click('startButton');
  h.sleep(INTERVAL);
  h.window.dispatch('pageshow');
  h.setAutomaticImages(false);
  resumeAt(h, 2);
  assert.equal(h.getState().phase, 'loading');
  h.scene.dispatch('error');
  h.advance(20);
  assert.equal(h.getState().imageError, true);
  h.click('retryImageButton');
  assert.match(h.scene.src, /scene-02\.webp/);
  h.completeImage();
  assert.equal(h.getState().phase, 'playing');
  assert.equal(h.getState().levelId, 2);
  findToto(h);
  assert.deepEqual(plain(h.getState().completed), ['2']);
});

test('Таймер поиска останавливается в правилах и скрытой вкладке, расписание продолжает идти', () => {
  const h = createHarness({ reducedMotion: false });
  h.click('startButton');
  h.advance(1500);
  h.click('helpButton');
  const paused = h.getState().elapsedMs;
  h.advance(3000);
  assert.equal(h.getState().elapsedMs, paused);
  h.click('helpClose');
  h.advance(1000);
  assert.ok(h.getState().elapsedMs > paused);
  h.document.hidden = true;
  h.document.dispatch('visibilitychange');
  const hiddenTime = h.getState().elapsedMs;
  h.sleep(INTERVAL);
  h.document.hidden = false;
  h.document.dispatch('visibilitychange');
  assert.equal(h.getState().elapsedMs, hiddenTime);
  assert.equal(h.getState().unlockedCount, 2);
  tap(h, h.screenPoint(h.currentLevel().target));
  h.advance(1200);
  assert.equal(h.getState().phase, 'won');
  h.advance(5000);
  assert.equal(h.document.getElementById('confettiCanvas').hidden, true);
  assert.equal(h.document.getElementById('confettiCanvas').parentNode, h.document.body);
});

test('Перезагрузка и события storage объединяют находки двух вкладок и не закрывают уже открытые уровни', () => {
  const storage = memoryStorage();
  const a = createHarness({ storage });
  a.sleep(2 * INTERVAL);
  a.window.dispatch('pageshow');
  const b = createHarness({ storage, now: START + 2 * INTERVAL });
  a.click('startButton');
  b.click('level-3');
  findToto(a);
  findToto(b);
  const value = storage.getItem(a.config.storageKey);
  a.window.dispatch('storage', { key: a.config.storageKey, newValue: value, storageArea: storage });
  b.window.dispatch('storage', { key: b.config.storageKey, newValue: storage.getItem(b.config.storageKey), storageArea: storage });
  assert.deepEqual(plain(a.getState().completed), ['1', '3']);
  assert.deepEqual(plain(b.getState().completed), ['1', '3']);
  const restored = createHarness({ storage, now: START - INTERVAL });
  assert.equal(restored.getState().startedAt, START);
  assert.equal(restored.getState().unlockedCount, 3);
  assert.deepEqual(plain(restored.getState().completed), ['1', '3']);
});

test('Preview открывает все сцены и тестовые открытки, не трогая обычный прогресс даже через getter localStorage', () => {
  const storage = memoryStorage();
  const normal = createHarness({ storage });
  const before = storage.getItem(normal.config.storageKey);
  const h = createHarness({ storage, storageDenied: true, url: 'https://example.github.io/toto/?preview=1' });
  assert.equal(h.getState().preview, true);
  assert.equal(h.getState().unlockedCount, 13);
  assert.equal(h.getStorageReads(), 0);
  assert.equal(h.document.getElementById('previewBadge').hidden, false);
  h.click('level-8');
  h.click('previewCardButton');
  assert.equal(h.document.getElementById('victoryDialog').open, true);
  assert.equal(h.document.getElementById('cardImage').src, h.config.levels[7].card.src);
  assert.deepEqual(plain(h.getState().completed), []);
  assert.equal(storage.getItem(normal.config.storageKey), before);
  const final = createHarness({ storage, url: 'https://example.github.io/toto/?preview=1&final=1' });
  assert.equal(final.getState().finalOpen, true);
  assert.equal(storage.getItem(normal.config.storageKey), before);
  const ignored = createHarness({ url: 'https://example.github.io/toto/?final=1' });
  assert.equal(ignored.getState().finalOpen, false);
  assert.equal(ignored.getState().unlockedCount, 1);
});

test('Логотип открывает маршрут без перезагрузки и сохраняет preview даже при открытии ссылки в новой вкладке', () => {
  const h = createHarness({ url: 'https://example.github.io/toto/?preview=1' });
  h.click('startButton');
  const brand = h.document.querySelector('.brand');
  assert.match(brand.getAttribute('href'), /\?preview=1$/);
  const event = brand.dispatch('click', { button: 0 });
  h.advance(20);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.document.getElementById('welcomeDialog').open, true);
  assert.equal(h.getState().preview, true);
  assert.equal(h.getStorageReads(), 0);
  const modifiedClick = brand.dispatch('click', { button: 0, ctrlKey: true });
  assert.equal(modifiedClick.defaultPrevented, false, 'открытие корректной ссылки в новой вкладке остаётся обычным действием браузера');
});

test('Большое поздравление следует за последней из 13 уникальных находок; сначала показывается собственная открытка уровня', () => {
  const h = createHarness();
  h.sleep(12 * INTERVAL);
  h.window.dispatch('pageshow');
  const order = [13, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  for (let index = 0; index < order.length; index++) {
    h.click('level-' + order[index]);
    findToto(h);
    assert.equal(h.document.getElementById('cardImage').src, h.currentLevel().card.src);
    assert.equal(h.document.getElementById('cardText').textContent, h.currentLevel().card.text);
    assert.equal(h.getState().finalOpen, false);
    assert.equal(h.document.getElementById('finalButton').hidden, index !== 12);
    if (index !== 12) {
      h.click('victoryClose');
      h.click('journeyButton');
    }
  }
  assert.equal(h.getState().completed.length, 13);
  assert.equal(h.getState().allCompleted, true);
  h.click('finalButton');
  assert.equal(h.getState().finalOpen, true);
  assert.equal(h.document.getElementById('victoryDialog').open, false);
  h.click('finalReplayButton');
  assert.equal(h.document.getElementById('welcomeDialog').open, true);
  assert.equal(h.document.getElementById('hubFinalButton').hidden, false);
  h.click('level-13');
  findToto(h);
  assert.equal(h.getState().completed.length, 13);
  assert.equal(h.getState().finalOpen, false, 'повтор снова показывает открытку выбранного уровня');
});
