'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fitScale,
  clampTransform,
  zoomAt,
  imagePoint,
  containsTarget
} = require('../game.js');

function close(actual, expected, label) {
  assert.ok(Number.isFinite(actual), label + ': значение должно быть конечным');
  assert.ok(Math.abs(actual - expected) < 1e-8, label + ': ожидалось ' + expected + ', получено ' + actual);
}

test('Вся картина помещается в широкое и узкое игровое поле', () => {
  const scene = { width: 4000, height: 2400 };
  close(fitScale({ width: 1200, height: 720 }, scene), 0.3, 'широкое поле');
  close(fitScale({ width: 360, height: 600 }, scene), 0.09, 'поле телефона');
});

test('В режиме обзора картина центрируется и не уезжает за край', () => {
  const viewport = { width: 360, height: 600 };
  const scene = { width: 4000, height: 2400 };
  const result = clampTransform({ x: 900, y: -900, scale: 0.09 }, viewport, scene);
  close(result.x, 0, 'x');
  close(result.y, 192, 'y');
});

test('После приближения можно дойти до каждого края без пустого пространства', () => {
  const viewport = { width: 800, height: 600 };
  const scene = { width: 4000, height: 2400 };
  const upperLeft = clampTransform({ x: 10000, y: 10000, scale: 0.5 }, viewport, scene);
  const lowerRight = clampTransform({ x: -10000, y: -10000, scale: 0.5 }, viewport, scene);
  close(upperLeft.x, 0, 'левый край');
  close(upperLeft.y, 0, 'верхний край');
  close(lowerRight.x, -1200, 'правый край');
  close(lowerRight.y, -600, 'нижний край');
});

test('Допустимое положение увеличенной картины сохраняется', () => {
  const viewport = { width: 800, height: 600 };
  const scene = { width: 4000, height: 2400 };
  const position = { x: -500, y: -250, scale: 0.5 };
  const result = clampTransform(position, viewport, scene);
  close(result.x, position.x, 'x');
  close(result.y, position.y, 'y');
  close(result.scale, position.scale, 'scale');
});

test('При масштабировании точка под указателем остаётся на месте', () => {
  const transform = { x: -240, y: 30, scale: 0.4 };
  for (const anchor of [{ x: 0, y: 0 }, { x: 380, y: 260 }, { x: 800, y: 600 }]) {
    const before = imagePoint(transform, anchor);
    for (const scale of [0.2, 0.8, 1.6]) {
      const after = imagePoint(zoomAt(transform, anchor, scale), anchor);
      close(after.x, before.x, 'x под указателем');
      close(after.y, before.y, 'y под указателем');
    }
  }
});

test('Попадание преобразуется из координат экрана в координаты иллюстрации', () => {
  const result = imagePoint({ x: -600, y: -250, scale: 0.5 }, { x: 150, y: 100 });
  close(result.x, 1500, 'x иллюстрации');
  close(result.y, 700, 'y иллюстрации');
});

test('Тото находится по эллипсу: центр и граница засчитываются, углы не засчитываются', () => {
  const target = { x: 1500, y: 700, rx: 30, ry: 45 };
  assert.equal(containsTarget({ x: 1500, y: 700 }, target), true);
  assert.equal(containsTarget({ x: 1530, y: 700 }, target), true);
  assert.equal(containsTarget({ x: 1500, y: 745 }, target), true);
  assert.equal(containsTarget({ x: 1530, y: 745 }, target), false);
  assert.equal(containsTarget({ x: 1531, y: 700 }, target), false);
  assert.equal(containsTarget({ x: 100, y: 100 }, target), false);
});

test('Небольшой допуск помогает нажатию и не делает соседние детали победой', () => {
  const target = { x: 1500, y: 700, rx: 30, ry: 45 };
  assert.equal(containsTarget({ x: 1532, y: 700 }, target, 3), true);
  assert.equal(containsTarget({ x: 1540, y: 700 }, target, 3), false);
});
