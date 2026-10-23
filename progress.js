/* Время путешествия и находки. Без сети, зависимостей и привязки к открытой вкладке. */
(function (root) {
  "use strict";

  var VERSION = 2;
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function timestamp(value) { return finite(value) && value >= 0 && value <= 8640000000000000; }
  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function create(options) {
    options = options || {};
    var ids = (options.ids || []).map(String);
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error("У уровней должны быть уникальные идентификаторы.");
    var interval = finite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs : 30 * 60 * 1000;
    var key = options.key || "find-toto-rina-v2";
    var now = typeof options.now === "function" ? options.now : Date.now;
    var preview = options.preview === true;
    var storage = preview ? null : options.storage;
    var available = preview || Boolean(storage);
    var idsSet = new Set(ids);
    var firstNow = Math.max(0, now());
    var record = {
      version: VERSION,
      startedAt: firstNow,
      lastSeenAt: firstNow,
      unlockedCount: preview ? ids.length : 1,
      completed: [],
      stats: {},
      finalSeenAt: null
    };

    function validStat(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return null;
      var best = input.bestMs;
      var last = input.lastMs;
      var hints = input.bestHints;
      if (!finite(best) || best < 0 || !finite(last) || last < 0 ||
          !Number.isInteger(hints) || hints < 0 || hints > 3 ||
          !timestamp(input.lastAt)) return null;
      return {
        bestMs: Math.round(best), lastMs: Math.round(last),
        bestHints: hints,
        lastHints: Number.isInteger(input.lastHints) ? clamp(input.lastHints, 0, 3) : hints,
        lastAt: input.lastAt
      };
    }

    function clean(input) {
      if (!input || typeof input !== "object" || input.version !== VERSION ||
          !timestamp(input.startedAt)) return null;
      var completed = Array.isArray(input.completed)
        ? ids.filter(function (id) { return input.completed.map(String).indexOf(id) !== -1; }) : [];
      var stats = {};
      ids.forEach(function (id) {
        var stat = input.stats && validStat(input.stats[id]);
        if (stat && completed.indexOf(id) !== -1) stats[id] = stat;
      });
      var highestCompleted = completed.reduce(function (highest, id) {
        return Math.max(highest, ids.indexOf(id) + 1);
      }, 1);
      return {
        version: VERSION,
        startedAt: input.startedAt,
        lastSeenAt: Math.max(input.startedAt, timestamp(input.lastSeenAt) ? input.lastSeenAt : input.startedAt),
        unlockedCount: Math.max(highestCompleted,
          Number.isInteger(input.unlockedCount) ? clamp(input.unlockedCount, 1, ids.length) : 1),
        completed: completed,
        stats: stats,
        finalSeenAt: timestamp(input.finalSeenAt) ? input.finalSeenAt : null
      };
    }

    function merge(other) {
      if (!other) return;
      record.startedAt = Math.min(record.startedAt, other.startedAt);
      record.lastSeenAt = Math.max(record.lastSeenAt, other.lastSeenAt);
      record.unlockedCount = Math.max(record.unlockedCount, other.unlockedCount);
      record.completed = ids.filter(function (id) {
        return record.completed.indexOf(id) !== -1 || other.completed.indexOf(id) !== -1;
      });
      ids.forEach(function (id) {
        var a = record.stats[id];
        var b = other.stats[id];
        if (!b) return;
        if (!a) { record.stats[id] = b; return; }
        var last = a.lastAt >= b.lastAt ? a : b;
        record.stats[id] = {
          bestMs: Math.min(a.bestMs, b.bestMs),
          lastMs: last.lastMs,
          bestHints: Math.min(a.bestHints, b.bestHints),
          lastHints: last.lastHints,
          lastAt: last.lastAt
        };
      });
      if (other.finalSeenAt !== null) {
        record.finalSeenAt = record.finalSeenAt === null ? other.finalSeenAt
          : Math.min(record.finalSeenAt, other.finalSeenAt);
      }
    }

    function decode(value) {
      if (typeof value !== "string") return null;
      try { return clean(JSON.parse(value)); }
      catch (_) { return null; }
    }

    function readStored() {
      if (!storage || preview) return null;
      try {
        var value = storage.getItem(key);
        available = true;
        return decode(value);
      } catch (_) { available = false; return null; }
    }

    function updateTime() {
      var current = now();
      if (!timestamp(current)) current = record.lastSeenAt;
      record.lastSeenAt = Math.max(record.lastSeenAt, current);
      var byTime = 1 + Math.floor(Math.max(0, record.lastSeenAt - record.startedAt) / interval);
      var before = record.unlockedCount;
      record.unlockedCount = preview ? ids.length
        : clamp(Math.max(before, byTime), 1, ids.length);
      return before !== record.unlockedCount;
    }

    function persist() {
      if (!storage || preview) return;
      // Read before every write so two tabs cannot overwrite each other's finds.
      merge(readStored());
      updateTime();
      try {
        var value = JSON.stringify(record);
        if (storage.getItem(key) !== value) storage.setItem(key, value);
        available = true;
      } catch (_) { available = false; }
    }

    function snapshot() {
      var nextAt = record.unlockedCount < ids.length
        ? record.startedAt + record.unlockedCount * interval : null;
      return {
        startedAt: record.startedAt,
        lastSeenAt: record.lastSeenAt,
        unlockedCount: record.unlockedCount,
        completed: record.completed.slice(),
        stats: clone(record.stats),
        allCompleted: record.completed.length === ids.length,
        finalSeenAt: record.finalSeenAt,
        nextUnlockAt: nextAt,
        untilNext: nextAt === null ? 0 : Math.max(0, nextAt - record.lastSeenAt),
        finalUnlockAt: record.startedAt + (ids.length - 1) * interval,
        preview: preview,
        persistent: !preview && available
      };
    }

    // A real first visit saves the starting timestamp immediately, even on the intro.
    if (!preview) {
      var saved = readStored();
      if (saved) record = saved;
    }
    updateTime();
    persist();

    return Object.freeze({
      key: key,
      tick: function () {
        if (updateTime()) persist();
        return snapshot();
      },
      get: function () { return snapshot(); },
      isUnlocked: function (id) {
        if (updateTime()) persist();
        return ids.indexOf(String(id)) !== -1 && ids.indexOf(String(id)) < record.unlockedCount;
      },
      complete: function (id, details) {
        id = String(id);
        if (!idsSet.has(id) || !this.isUnlocked(id)) return false;
        details = details || {};
        var milliseconds = finite(details.elapsedMs) ? Math.max(0, Math.round(details.elapsedMs)) : 0;
        var hints = Number.isInteger(details.hints) ? clamp(details.hints, 0, 3) : 0;
        merge(readStored());
        if (record.completed.indexOf(id) === -1) record.completed.push(id);
        record.completed = ids.filter(function (candidate) { return record.completed.indexOf(candidate) !== -1; });
        var previous = record.stats[id];
        record.stats[id] = {
          bestMs: previous ? Math.min(previous.bestMs, milliseconds) : milliseconds,
          lastMs: milliseconds,
          bestHints: previous ? Math.min(previous.bestHints, hints) : hints,
          lastHints: hints,
          lastAt: record.lastSeenAt
        };
        persist();
        return snapshot();
      },
      markFinalSeen: function () {
        if (record.completed.length !== ids.length && !preview) return false;
        if (record.finalSeenAt === null) record.finalSeenAt = Math.max(record.lastSeenAt, now());
        persist();
        return true;
      },
      receive: function (value) {
        if (preview) return snapshot();
        merge(decode(value));
        merge(readStored());
        updateTime();
        persist();
        return snapshot();
      },
      save: function () { updateTime(); persist(); return snapshot(); }
    });
  }

  var api = { create: create, version: VERSION };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TotoProgress = api;
})(typeof window !== "undefined" ? window : globalThis);
