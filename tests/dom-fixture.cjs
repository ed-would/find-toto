'use strict';

// Small DOM fixture for the real game script. This is NOT a browser renderer:
// it checks application state, event sequences and the actual HTML element tree.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  dispatch(name, properties = {}) {
    const event = {
      type: name, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}, ...properties
    };
    for (const callback of [...(this.listeners.get(name) || [])]) callback(event);
    return event;
  }
}

class TextNode {
  constructor(text, document) {
    this.ownerDocument = document;
    this.parentNode = null;
    this._text = String(text);
    this.children = [];
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  matches() { return false; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
}

class Element extends Events {
  constructor(tagName, document) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this._text = '';
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.captures = new Set();
    this.clientWidth = 100;
    this.clientHeight = 100;
    this.clientLeft = 0;
    this.clientTop = 0;
    this.rect = { left: 0, top: 0 };
    this.classList = {
      add: (...names) => this.changeClasses(names, true),
      remove: (...names) => this.changeClasses(names, false),
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }
  changeClasses(names, add) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    names.forEach(name => add ? classes.add(name) : classes.delete(name));
    this.className = [...classes].join(' ');
  }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { value ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
  get open() { return this.hasAttribute('open'); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  get isConnected() {
    for (let item = this; item; item = item.parentNode) if (item === this.ownerDocument.documentElement) return true;
    return false;
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this._text = String(value);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.ownerDocument.ids.set(String(value), this);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) {
    child.remove();
    const index = this.children.indexOf(before);
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  contains(element) {
    for (let item = element; item; item = item.parentNode) if (item === this) return true;
    return false;
  }
  matches(selector) {
    if (selector.includes(' ')) {
      const pieces = selector.split(/\s+/);
      if (!this.matches(pieces.pop())) return false;
      let ancestor = this.parentNode;
      while (pieces.length) {
        const expected = pieces.pop();
        while (ancestor && !ancestor.matches(expected)) ancestor = ancestor.parentNode;
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    }
    if (selector.endsWith(':last-child')) {
      return Boolean(this.parentNode && this.parentNode.children.at(-1) === this && this.matches(selector.replace(':last-child', '')));
    }
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === '[hidden]') return this.hidden;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const attribute = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (attribute) return this.hasAttribute(attribute[1]) && (!attribute[2] || this.getAttribute(attribute[1]) === attribute[2]);
    if (/^button/.test(selector)) return this.tagName === 'BUTTON' && (!selector.includes(':not') || !this.disabled);
    if (/^input|^select|^textarea/.test(selector)) return selector.startsWith(this.tagName.toLowerCase()) && !this.disabled;
    if (selector.startsWith('[tabindex]')) return this.hasAttribute('tabindex') && this.getAttribute('tabindex') !== '-1';
    return this.tagName.toLowerCase() === selector;
  }
  closest(selectors) {
    for (let item = this; item; item = item.parentNode) {
      if (selectors.split(',').some(selector => item.matches(selector.trim()))) return item;
    }
    return null;
  }
  querySelectorAll(selectors) {
    const result = [];
    const visit = element => {
      for (const child of element.children) {
        if (selectors.split(',').some(selector => child.matches(selector.trim()))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getClientRects() {
    for (let item = this; item; item = item.parentNode) {
      if (item.hidden || item.tagName === 'DIALOG' && !item.open) return [];
    }
    return this.isConnected ? [this.getBoundingClientRect()] : [];
  }
  getBoundingClientRect() {
    return { ...this.rect, width: this.clientWidth + this.clientLeft * 2, height: this.clientHeight + this.clientTop * 2 };
  }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); this.dispatch('close'); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}

function parseDocument(html) {
  const document = new Events();
  document.ids = new Map();
  document.readyState = 'complete';
  document.hidden = false;
  document.baseURI = pathToFileURL(path.join(ROOT, 'index.html')).href;
  document.createElement = tag => new Element(tag, document);
  document.createTextNode = text => new TextNode(text, document);
  document.getElementById = id => {
    const element = document.ids.get(id);
    return element && element.isConnected ? element : null;
  };
  document.querySelector = selector => document.documentElement.querySelector(selector);
  const stack = [];
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g)) {
    const value = token[0];
    if (value.startsWith('<!')) continue;
    if (value.startsWith('</')) { stack.pop(); continue; }
    if (value.startsWith('<')) {
      const tag = value.match(/^<([\w-]+)/);
      if (!tag) continue;
      const element = document.createElement(tag[1]);
      const attributeText = value.slice(tag[0].length).replace(/\/?\s*>$/, '');
      for (const attr of attributeText.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        element.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      if (stack.length) stack[stack.length - 1].appendChild(element);
      else if (element.tagName === 'HTML') document.documentElement = element;
      if (element.tagName === 'BODY') document.body = element;
      if (!VOID.has(tag[1]) && !value.endsWith('/>')) stack.push(element);
    } else if (stack.length) stack[stack.length - 1]._text += value;
  }
  document.activeElement = document.body;
  return document;
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function createHarness(options = {}) {
  const document = parseDocument(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  if (options.url) document.baseURI = options.url;
  const window = new Events();
  const timers = new Map();
  let clock = 1000;
  let wallClock = options.now ?? Date.UTC(2026, 9, 24, 6, 0, 0);
  let nextId = 1;
  const schedule = (callback, delay, kind) => {
    const id = nextId++;
    timers.set(id, { callback, at: clock + delay, delay, kind });
    return id;
  };
  window.setTimeout = (fn, delay = 0) => schedule(fn, delay, 'timeout');
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (fn, delay) => schedule(fn, delay, 'interval');
  window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = fn => schedule(fn, 16, 'raf');
  window.cancelAnimationFrame = id => timers.delete(id);
  window.innerWidth = 1280;
  window.innerHeight = 800;
  window.devicePixelRatio = 1;
  window.location = { href: options.url || document.baseURI };
  window.matchMedia = () => ({ matches: options.reducedMotion !== false, addEventListener() {} });
  const storage = options.storage || memoryStorage();
  let storageReads = 0;
  Object.defineProperty(window, 'localStorage', { get() {
    storageReads++;
    if (options.storageDenied) throw new Error('localStorage denied');
    return storage;
  } });
  const viewport = document.getElementById('viewport');
  viewport.clientWidth = options.width || 920;
  viewport.clientHeight = options.height || 610;
  viewport.clientLeft = 2;
  viewport.clientTop = 2;
  viewport.rect = { left: 51, top: 87 };
  const originalDimensions = { width: viewport.clientWidth, height: viewport.clientHeight };
  const fullscreenRequests = [];
  let fullscreenExits = 0;
  const shell = document.getElementById('sceneShell');
  document.fullscreenElement = null;
  if (options.nativeFullscreen && shell) {
    shell.requestFullscreen = function () {
      fullscreenRequests.push(this);
      if (options.rejectFullscreen) throw new Error('Fullscreen denied by browser');
      document.fullscreenElement = this;
      viewport.clientWidth = window.innerWidth;
      viewport.clientHeight = window.innerHeight;
      document.dispatch('fullscreenchange');
      return options.asyncFullscreen ? Promise.resolve() : undefined;
    };
    document.documentElement.requestFullscreen = function () {
      fullscreenRequests.push(this);
      throw new Error('The whole document must never request fullscreen');
    };
    document.exitFullscreen = function () {
      fullscreenExits++;
      const finish = () => {
        document.fullscreenElement = null;
        viewport.clientWidth = originalDimensions.width;
        viewport.clientHeight = originalDimensions.height;
        document.dispatch('fullscreenchange');
      };
      if (options.delayedFullscreenExit) {
        return new Promise(resolve => window.setTimeout(() => { finish(); resolve(); }, 50));
      }
      finish();
      return options.asyncFullscreen ? Promise.resolve() : undefined;
    };
  }
  let drawCalls = 0;
  document.getElementById('confettiCanvas').getContext = () => ({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() {}, arc() {}, fill() { drawCalls++; }, fillRect() { drawCalls++; }
  });
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wallClock])); }
    static now() { return wallClock; }
  }
  const context = vm.createContext({ window, document, performance: { now: () => clock }, URL, Date: FixtureDate, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'), context, { filename: 'config.js' });
  if (options.config) window.FIND_TOTO_CONFIG = options.config;
  const config = window.FIND_TOTO_CONFIG;
  const scene = document.getElementById('sceneImage');
  let automaticImages = options.loaded !== false;
  let imageSource = scene.getAttribute('src') || '';
  function imageLevel(source) {
    const pathname = new URL(source, document.baseURI).pathname;
    return config.levels.find(level => pathname.endsWith('/' + level.scene.src)) || config.levels[0];
  }
  function completeImage() {
    const level = imageLevel(imageSource);
    scene.naturalWidth = level.scene.width;
    scene.naturalHeight = level.scene.height;
    scene.complete = true;
    scene.dispatch('load');
  }
  scene.complete = false;
  scene.naturalWidth = 0;
  scene.naturalHeight = 0;
  Object.defineProperty(scene, 'src', {
    get() { return imageSource; },
    set(value) {
      imageSource = String(value);
      scene.complete = options.cachedFailure === true;
      scene.naturalWidth = 0;
      scene.naturalHeight = 0;
      if (automaticImages) window.setTimeout(completeImage, 1);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'progress.js'), 'utf8'), context, { filename: 'progress.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), context, { filename: 'game.js' });

  function advance(milliseconds) {
    const deadline = clock + milliseconds;
    let steps = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= deadline).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++steps > 15000) throw new Error('Fixture timer loop did not settle');
      const [id, timer] = next;
      const when = Math.max(clock, timer.at);
      wallClock += when - clock;
      clock = when;
      timers.delete(id);
      if (timer.kind === 'interval') timers.set(id, { ...timer, at: clock + timer.delay });
      timer.callback(clock);
    }
    wallClock += deadline - clock;
    clock = deadline;
  }

  function click(id) {
    const element = document.getElementById(id);
    if (!element || element.disabled || !element.getClientRects().length) throw new Error('Element unavailable for click: ' + id);
    const modal = [...document.ids.values()].find(item => item.tagName === 'DIALOG' && item.open);
    if (modal && !modal.contains(element)) throw new Error('Element is behind a modal: ' + id);
    element.dispatch('click');
    advance(20);
  }

  function screenPoint(point) {
    const transform = window.FindToto.getState().transform;
    return {
      x: viewport.rect.left + viewport.clientLeft + transform.x + point.x * transform.scale,
      y: viewport.rect.top + viewport.clientTop + transform.y + point.y * transform.scale
    };
  }

  function pointer(name, point, id = 1, pointerType = 'mouse', extras = {}) {
    viewport.dispatch(name, { clientX: point.x, clientY: point.y, pointerId: id, pointerType, button: 0, buttons: name === 'pointerup' ? 0 : 1, isPrimary: id === 1, ...extras });
  }

  advance(20);
  return {
    window, document, config, viewport, scene, storage, advance, click, pointer, screenPoint,
    currentLevel: () => config.levels[window.FindToto.getState().levelNumber - 1],
    getState: () => window.FindToto.getState(),
    getDrawCalls: () => drawCalls,
    getStorageReads: () => storageReads,
    getFullscreenRequests: () => fullscreenRequests,
    getFullscreenExits: () => fullscreenExits,
    now: () => wallClock,
    setWallClock: value => { wallClock = value; },
    sleep: milliseconds => { clock += milliseconds; wallClock += milliseconds; },
    setAutomaticImages: value => { automaticImages = value; },
    completeImage: () => { automaticImages = true; completeImage(); advance(20); }
  };
}

module.exports = { createHarness, memoryStorage };
