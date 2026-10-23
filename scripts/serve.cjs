'use strict';

// Optional local server. The game also works by opening index.html directly.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function parsePort(value) {
  const port = Number(value === undefined ? 4173 : value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT должен быть целым числом от 1 до 65535.');
  }
  return port;
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function resolveRequestPath(requestUrl, root = ROOT) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part.startsWith('.') || part === 'node_modules')) return null;
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filename = path.resolve(root, '.' + requested);
  return isInsideRoot(root, filename) ? filename : null;
}

function respond(res, status, message, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(message);
}

function createHandler(root = ROOT) {
  const absoluteRoot = path.resolve(root);
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respond(res, 405, 'Доступны только GET и HEAD.', { Allow: 'GET, HEAD' });
      return;
    }
    const filename = resolveRequestPath(req.url, absoluteRoot);
    if (!filename) {
      respond(res, 403, 'Этот путь недоступен.');
      return;
    }
    const contentType = MIME[path.extname(filename).toLowerCase()];
    if (!contentType) {
      respond(res, 404, 'Файл не найден.');
      return;
    }
    try {
      const resolved = await fsp.realpath(filename);
      if (!isInsideRoot(absoluteRoot, resolved)) {
        respond(res, 403, 'Этот путь недоступен.');
        return;
      }
      const stat = await fsp.stat(resolved);
      if (!stat.isFile()) {
        respond(res, 404, 'Файл не найден.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(resolved);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
      } else {
        const missing = ['ENOENT', 'ENOTDIR'].includes(error.code);
        respond(res, missing ? 404 : 500, missing ? 'Файл не найден.' : 'Не получилось прочитать файл.');
      }
    }
  };
}

if (require.main === module) {
  try {
    const port = parsePort(process.env.PORT);
    const host = process.env.HOST || '127.0.0.1';
    const server = http.createServer(createHandler());
    server.on('error', error => {
      const detail = error.code === 'EADDRINUSE'
        ? 'Этот порт уже занят. Задайте другой PORT или откройте index.html двойным кликом.'
        : error.message;
      console.error('Не удалось запустить игру: ' + detail);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      const localAddress = host === '0.0.0.0' ? '127.0.0.1' : host.includes(':') ? '[' + host + ']' : host;
      console.log('«Найди Тото» — http://' + localAddress + ':' + port);
      console.log('Остановить сервер: Ctrl+C.');
      if (host === '0.0.0.0') console.log('На телефоне: http://<локальный IP компьютера>:' + port + ' в той же сети Wi-Fi.');
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createHandler, isInsideRoot, parsePort, resolveRequestPath };
