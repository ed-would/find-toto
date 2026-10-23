'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Writable } = require('node:stream');
const { finished } = require('node:stream/promises');
const { createHandler } = require('../scripts/serve.cjs');

// Exercise actual responses and file streaming without listening on any port.
class MemoryResponse extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
    this.headersSent = false;
    this.parts = [];
  }
  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }
  _write(chunk, encoding, callback) {
    this.parts.push(Buffer.from(chunk));
    callback();
  }
  get body() { return Buffer.concat(this.parts); }
}

async function request(method, url) {
  const response = new MemoryResponse();
  const completion = finished(response);
  await createHandler(path.resolve(__dirname, '..'))({ method, url }, response);
  await completion;
  return response;
}

test('Локальный обработчик отдаёт реальную страницу с правильным MIME', async () => {
  const response = await request('GET', '/');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(response.body.toString('utf8'), /Найди Тото/);
  assert.equal(response.body.length, response.headers['Content-Length']);
});

test('Изображение доступно для HEAD без отправки тела', async () => {
  const response = await request('HEAD', '/assets/favicon.svg');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'image/svg+xml');
  assert.ok(response.headers['Content-Length'] > 0);
  assert.equal(response.body.length, 0);
});

test('Отсутствующий файл возвращает 404, скрытый путь — 403', async () => {
  assert.equal((await request('GET', '/assets/not_found_for_test.png')).statusCode, 404);
  assert.equal((await request('GET', '/.git/config')).statusCode, 403);
});

test('Обработчик не принимает изменение файлов через POST', async () => {
  const response = await request('POST', '/index.html');
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET, HEAD');
});
