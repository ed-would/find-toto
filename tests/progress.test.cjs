'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../progress.js');
const INTERVAL = 30 * 60 * 1000;
const START = Date.UTC(2026, 9, 24, 6, 0, 0);
const ids = Array.from({ length: 13 }, (_, i) => i + 1);

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  };
}

function setup(options = {}) {
  let clock = options.clock ?? START;
  const storage = options.storage || memoryStorage();
  const game = create({ ids, intervalMs: INTERVAL, storage, key: 'test', now: () => clock, ...options });
  return { game, storage, setClock: value => { clock = value; } };
}

test('Первый вход сразу сохраняется; 2-й уровень открывается ровно через 30 минут, 13-й через 6 часов', () => {
  const h = setup();
  assert.equal(JSON.parse(h.storage.getItem('test')).startedAt, START);
  assert.equal(h.game.get().unlockedCount, 1);
  assert.equal(h.game.get().finalUnlockAt, START + 6 * 60 * 60 * 1000);
  h.setClock(START + INTERVAL - 1);
  assert.equal(h.game.tick().unlockedCount, 1);
  assert.equal(h.game.get().untilNext, 1);
  h.setClock(START + INTERVAL);
  assert.equal(h.game.tick().unlockedCount, 2);
  h.setClock(START + 12 * INTERVAL);
  assert.equal(h.game.tick().unlockedCount, 13);
  assert.equal(h.game.get().nextUnlockAt, null);
  assert.equal(h.game.get().untilNext, 0);
});

test('Закрытая вкладка и перезагрузка догоняют прошедшее время, пропущенные уровни открываются независимо от побед', () => {
  const storage = memoryStorage();
  const first = setup({ storage });
  const second = setup({ storage, clock: START + 3 * INTERVAL });
  assert.equal(first.game.get().startedAt, second.game.get().startedAt);
  assert.equal(second.game.get().unlockedCount, 4);
  assert.deepEqual(second.game.get().completed, []);
  assert.equal(second.game.isUnlocked(4), true);
  assert.equal(second.game.isUnlocked(5), false);
  assert.equal(second.game.complete(5, { elapsedMs: 1000 }), false, 'закрытая сцена не засчитывается');
  assert.ok(second.game.complete(4, { elapsedMs: 24000, hints: 2 }), 'четвёртую можно пройти первой');
});

test('Открытые уровни не закрываются при переводе часов назад, в том числе после перезагрузки', () => {
  const h = setup();
  h.setClock(START + 5 * INTERVAL);
  assert.equal(h.game.tick().unlockedCount, 6);
  h.setClock(START - INTERVAL);
  assert.equal(h.game.tick().unlockedCount, 6);
  const restored = setup({ storage: h.storage, clock: START - 24 * INTERVAL });
  assert.equal(restored.game.get().unlockedCount, 6);
  assert.equal(restored.game.get().startedAt, START);
});

test('Повтор улучшает статистику и не меняет начало путешествия или количество уникальных находок', () => {
  const h = setup();
  h.game.complete(1, { elapsedMs: 60000, hints: 2 });
  h.setClock(START + 10000);
  h.game.complete(1, { elapsedMs: 30000, hints: 0 });
  h.setClock(START + 20000);
  h.game.complete(1, { elapsedMs: 45000, hints: 1 });
  const state = h.game.get();
  assert.equal(state.startedAt, START);
  assert.deepEqual(state.completed, ['1']);
  assert.equal(state.stats['1'].bestMs, 30000);
  assert.equal(state.stats['1'].lastMs, 45000);
  assert.equal(state.stats['1'].bestHints, 0);
});

test('Повреждённый JSON, чужая версия и некорректные поля восстанавливаются без остановки игры', () => {
  for (const raw of ['{', 'null', '[]', '{"version":1}', '{"version":2,"startedAt":"yesterday"}']) {
    const storage = memoryStorage();
    storage.setItem('test', raw);
    const h = setup({ storage });
    assert.equal(h.game.get().startedAt, START);
    assert.equal(h.game.get().unlockedCount, 1);
    assert.doesNotThrow(() => JSON.parse(storage.getItem('test')));
  }
  const storage = memoryStorage();
  storage.setItem('test', JSON.stringify({ version: 2, startedAt: START,
    unlockedCount: 'many', lastSeenAt: 'now', completed: [1, 1, 500, null],
    stats: { 1: { bestMs: -5 }, 500: {} } }));
  const h = setup({ storage });
  assert.deepEqual(h.game.get().completed, ['1']);
  assert.deepEqual(h.game.get().stats, {});
});

test('Запрет чтения или записи localStorage оставляет рабочую игру и таймер в памяти', () => {
  for (const storage of [
    { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } },
    { getItem() { return null; }, setItem() { throw new Error('quota'); } }
  ]) {
    const h = setup({ storage });
    assert.equal(h.game.get().persistent, false);
    h.setClock(START + INTERVAL);
    assert.equal(h.game.tick().unlockedCount, 2);
    assert.ok(h.game.complete(2, { elapsedMs: 13000 }));
    assert.deepEqual(h.game.get().completed, ['2']);
  }
});

test('Две вкладки объединяют находки, ранний старт и лучшую статистику без потери прогресса', () => {
  const storage = memoryStorage();
  const a = setup({ storage });
  const b = setup({ storage, clock: START + 2 * INTERVAL });
  a.setClock(START + 2 * INTERVAL);
  a.game.tick();
  a.game.complete(1, { elapsedMs: 80000, hints: 2 });
  b.game.complete(2, { elapsedMs: 30000, hints: 1 });
  a.game.receive(storage.getItem('test'));
  b.game.receive(storage.getItem('test'));
  assert.deepEqual(a.game.get().completed, ['1', '2']);
  assert.deepEqual(b.game.get().completed, ['1', '2']);
  b.game.complete(1, { elapsedMs: 42000, hints: 0 });
  a.game.receive(storage.getItem('test'));
  assert.equal(a.game.get().stats['1'].bestMs, 42000);
  assert.equal(a.game.get().startedAt, START);
  a.game.receive(null);
  assert.deepEqual(a.game.get().completed, ['1', '2'], 'очистка другой вкладкой не стирает текущие находки');
});

test('Режим preview не читает и не пишет обычное хранилище; все уровни сразу открыты в отдельной памяти', () => {
  let calls = 0;
  const storage = { getItem() { calls++; throw new Error('must not read'); }, setItem() { calls++; } };
  const h = setup({ storage, preview: true });
  assert.equal(h.game.get().unlockedCount, 13);
  h.game.complete(13, { elapsedMs: 0 });
  h.game.save();
  h.game.receive('{"version":2}');
  assert.equal(calls, 0);
  assert.deepEqual(h.game.get().completed, ['13']);
  assert.equal(setup({ storage, preview: true }).game.get().completed.length, 0);
});

test('Большой финал доступен после всех 13 уникальных находок, а не после 13 повторов', () => {
  const h = setup();
  for (let i = 0; i < 13; i++) h.game.complete(1, { elapsedMs: 1000 });
  assert.equal(h.game.get().allCompleted, false);
  assert.equal(h.game.markFinalSeen(), false);
  h.setClock(START + 12 * INTERVAL);
  h.game.tick();
  for (const id of ids) h.game.complete(id, { elapsedMs: 1000 });
  assert.equal(h.game.get().allCompleted, true);
  assert.equal(h.game.markFinalSeen(), true);
  assert.ok(h.game.get().finalSeenAt >= START);
});
