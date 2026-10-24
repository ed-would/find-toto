/* Найди Тото — автономная игра. Работает с обычными script и через file://. */
(function (root) {
  "use strict";

  function number(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  var math = {
    fitScale: function (viewport, scene) {
      if (!(viewport.width > 0 && viewport.height > 0 &&
            scene.width > 0 && scene.height > 0)) return 1;
      return Math.min(viewport.width / scene.width, viewport.height / scene.height);
    },
    clampTransform: function (transform, viewport, scene) {
      var scale = Math.max(0.000001, number(transform.scale, 1));
      var width = scene.width * scale;
      var height = scene.height * scale;
      return {
        x: width <= viewport.width
          ? (viewport.width - width) / 2
          : clamp(number(transform.x, 0), viewport.width - width, 0),
        y: height <= viewport.height
          ? (viewport.height - height) / 2
          : clamp(number(transform.y, 0), viewport.height - height, 0),
        scale: scale
      };
    },
    imagePoint: function (transform, point) {
      return {
        x: (point.x - transform.x) / transform.scale,
        y: (point.y - transform.y) / transform.scale
      };
    },
    zoomAt: function (transform, anchor, nextScale) {
      var image = math.imagePoint(transform, anchor);
      return {
        x: anchor.x - image.x * nextScale,
        y: anchor.y - image.y * nextScale,
        scale: nextScale
      };
    },
    containsTarget: function (point, target, slop) {
      var padding = Math.max(0, number(slop, 0));
      var rx = number(target.rx, 0) + padding;
      var ry = number(target.ry, 0) + padding;
      if (!(rx > 0 && ry > 0 && Number.isFinite(point.x) &&
            Number.isFinite(point.y) && Number.isFinite(target.x) &&
            Number.isFinite(target.y))) return false;
      var dx = (point.x - target.x) / rx;
      var dy = (point.y - target.y) / ry;
      return dx * dx + dy * dy <= 1 + 1e-10;
    },
    hitSlop: function (pointerType, scale, target) {
      var screenPadding = pointerType === "touch" ? 8 : 2;
      var imageCap = Math.max(0, Math.min(target.rx, target.ry) * 0.2);
      return Math.min(screenPadding / Math.max(scale, 0.000001), imageCap);
    },
    tapEligible: function (gesture) {
      return Boolean(gesture) && !gesture.multi && !gesture.cancelled &&
        !gesture.dragging && gesture.maxMovement <= gesture.threshold;
    },
    formatElapsed: function (milliseconds) {
      var seconds = Math.floor(Math.max(0, number(milliseconds, 0)) / 1000);
      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var remainder = seconds % 60;
      var pair = function (value) { return String(value).padStart(2, "0"); };
      return hours > 0
        ? hours + ":" + pair(minutes) + ":" + pair(remainder)
        : pair(minutes) + ":" + pair(remainder);
    }
  };

  // The same coordinate helpers can be verified in Node without a DOM.
  if (typeof module !== "undefined" && module.exports) module.exports = math;
  root.TotoGameMath = math;
  if (typeof document === "undefined") return;

  function boot() {
    var config = root.FIND_TOTO_CONFIG || {};
    var byId = function (id) { return document.getElementById(id); };
    var ui = {};
    [
      "viewport", "world", "sceneImage", "hintArea", "hintPin",
      "zoomIn", "zoomOut", "fitButton", "hintButton", "soundButton",
      "helpButton", "restartButton", "timeLabel", "zoomLabel",
      "hintMessage", "hintCount", "revealButton", "liveStatus",
      "confettiCanvas", "welcomeDialog", "startButton", "helpDialog",
      "helpClose", "victoryDialog", "replayButton", "victoryTime",
      "victoryHints", "victoryClose", "openCardButton", "fullscreenButton",
      "loadingState", "loadError", "retryImageButton", "sceneShell",
      "levelGrid", "welcomeCountdown", "welcomeCountdownLabel",
      "welcomeProgress", "journeyStartTime", "journeyEndTime", "journeyButton",
      "journeyCountdown", "progressLabel", "levelTitle", "levelSubtitle", "levelNumber",
      "levelDescription", "worldTitle", "mapHintButton", "mapHintMessage", "keyboardCursor",
      "cardImage", "cardTitle", "cardText", "cardLocation", "cardSignoff", "cardProgress",
      "nextLevelButton", "finalButton", "hubFinalButton", "finalDialog", "finalImage",
      "finalClose", "finalReplayButton", "previewBadge", "previewCardButton", "saveNotice",
      "victoryTitle"
    ].forEach(function (id) { ui[id] = byId(id); });
    if (!ui.viewport || !ui.world || !ui.sceneImage) return;

    var levels = Array.isArray(config.levels) ? config.levels : [];
    if (!levels.length || !root.TotoProgress) {
      if (ui.loadError) {
        ui.loadError.hidden = false;
        ui.loadError.textContent = "Не все файлы игры загрузились. Обнови страницу или распакуй архив целиком.";
      }
      return;
    }
    var parameters;
    try { parameters = new URL(root.location && root.location.href || document.baseURI).searchParams; }
    catch (_) { parameters = { get: function () { return null; } }; }
    var preview = parameters.get("preview") === "1";
    var storage = null;
    // Do not even access localStorage's getter in preview mode.
    if (!preview) { try { storage = root.localStorage; } catch (_) {} }
    var progress = root.TotoProgress.create({
      ids: levels.map(function (level) { return level.id; }),
      intervalMs: number(config.unlockIntervalMs, 1800000),
      key: config.storageKey || "find-toto-rina-v2",
      storage: storage,
      preview: preview,
      now: function () { return Date.now(); }
    });
    var journey = progress.get();
    var scene = { width: 1, height: 1 };
    var target = { x: 0, y: 0, rx: 0, ry: 0 };
    var targetValid = false;
    var area = { x: 0, y: 0, radius: 1 };
    var hints = [];
    var maxZoom = clamp(number(config.maxZoom, 8), 2, 20);
    var motionQuery = root.matchMedia
      ? root.matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false };
    var state = {
      phase: "welcome",
      ready: false,
      error: false,
      started: false,
      hintLevel: 0,
      assisted: false,
      misses: 0,
      transform: { x: 0, y: 0, scale: 1 },
      viewport: { width: 0, height: 0 },
      fit: 1,
      elapsed: 0,
      clockSince: null,
      sound: false,
      suspended: false,
      levelIndex: 0,
      pendingStart: false,
      immersive: false,
      previewCard: false,
      reducedMotion: Boolean(motionQuery.matches)
    };
    var pointers = new Map();
    var gesture = null;
    var renderFrame = 0;
    var viewportOrigin = null;
    var lastZoomPercent = "";
    var motionFrame = 0;
    var confettiFrame = 0;
    var confettiStopTimeout = 0;
    var victoryTimeout = 0;
    var liveTimeout = 0;
    var lastMissAnnouncement = -Infinity;
    var levelTiles = [];
    var audioContext = null;
    var confettiContext = null;
    var initialImageSource = ui.sceneImage.getAttribute("src") || "";
    var brandLink = document.querySelector(".brand");
    var mapBadge = document.querySelector(".map-badge span:last-child");
    var mapBadgeInitialText = mapBadge ? mapBadge.textContent : "Тото где-то здесь";
    var confettiHome = ui.confettiCanvas ? {
      parent: ui.confettiCanvas.parentNode,
      nextSibling: ui.confettiCanvas.nextSibling
    } : null;
    var dialogReturnFocus = new Map();
    var dialogs = [ui.helpDialog, ui.victoryDialog, ui.finalDialog].filter(Boolean);

    function visible(element, show) {
      if (element) element.hidden = !show;
    }

    function announce(message) {
      if (!ui.liveStatus) return;
      root.clearTimeout(liveTimeout);
      ui.liveStatus.textContent = "";
      liveTimeout = root.setTimeout(function () {
        ui.liveStatus.textContent = message;
      }, 35);
    }

    function listen(element, event, handler, options) {
      if (element) element.addEventListener(event, handler, options);
    }

    function currentLevel() { return levels[state.levelIndex]; }

    function hasCompleted(index) {
      return journey.completed.indexOf(String(levels[index].id)) !== -1;
    }

    function nextIncomplete(fromIndex) {
      for (var offset = 1; offset <= levels.length; offset += 1) {
        var index = (fromIndex + offset + levels.length) % levels.length;
        if (index < journey.unlockedCount && !hasCompleted(index)) return index;
      }
      return -1;
    }

    function displayTime(timestamp) {
      try { return new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
      catch (_) { return ""; }
    }

    function makeLevelGrid() {
      if (!ui.levelGrid) return;
      ui.levelGrid.textContent = "";
      levels.forEach(function (level, index) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "level-tile";
        button.setAttribute("id", "level-" + level.id);
        button.setAttribute("data-level", String(level.id));
        var thumbnail = document.createElement("img");
        thumbnail.className = "level-thumb";
        thumbnail.alt = "";
        thumbnail.decoding = "async";
        thumbnail.width = 512;
        thumbnail.height = 341;
        var openedNow = index < journey.unlockedCount;
        if (!openedNow) button.classList.add("is-locked");
        if (level.thumbnail && openedNow) {
          thumbnail.src = level.thumbnail;
          thumbnail.setAttribute("data-loaded", level.thumbnail);
        } else if (!openedNow) {
          thumbnail.src = "data:image/svg+xml," + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" aria-hidden="true"></svg>'
          );
        }
        button.appendChild(thumbnail);
        var secret = document.createElement("span");
        secret.className = "level-secret";
        secret.setAttribute("aria-hidden", "true");
        secret.innerHTML = '<img class="pug-mark" src="assets/placeholder-toto.webp" alt="" width="1254" height="1254" draggable="false" decoding="async">';
        button.appendChild(secret);
        var copy = document.createElement("span");
        copy.className = "level-copy";
        var numberLabel = document.createElement("span");
        numberLabel.className = "level-count";
        numberLabel.textContent = "Прогулка " + (index + 1);
        var title = document.createElement("strong");
        title.className = "level-tile-title";
        title.textContent = openedNow ? (level.title || "Сюрприз Тото") : "";
        var label = document.createElement("span");
        label.className = "level-state";
        copy.appendChild(numberLabel);
        copy.appendChild(title);
        copy.appendChild(label);
        button.appendChild(copy);
        listen(button, "click", function () { loadLevel(index, true); });
        ui.levelGrid.appendChild(button);
        levelTiles.push({ button: button, label: label, title: title, thumb: thumbnail });
      });
    }

    function writeOpenCount(node, before, count, after) {
      var mark = document.createElement("span");
      mark.className = "open-count";
      mark.textContent = String(count);
      node.textContent = "";
      if (before) node.appendChild(document.createTextNode(before));
      node.appendChild(mark);
      if (after) node.appendChild(document.createTextNode(after));
    }

    function refreshJourney(announceUnlock) {
      var before = journey.unlockedCount;
      journey = progress.tick();
      var wait = math.formatElapsed(Math.ceil(journey.untilNext / 1000) * 1000);
      var allOpen = journey.unlockedCount === levels.length;
      var count = journey.completed.length + " / " + levels.length;
      if (ui.progressLabel) ui.progressLabel.textContent = "Тото найден: " + count;
      if (ui.welcomeProgress) writeOpenCount(ui.welcomeProgress, "Открыто ", journey.unlockedCount,
        " из " + levels.length + " прогулок · Тото найден: " + count);
      if (ui.welcomeCountdown) {
        if (allOpen) writeOpenCount(ui.welcomeCountdown, "Все ", levels.length, "!");
        else ui.welcomeCountdown.textContent = wait;
      }
      if (ui.welcomeCountdownLabel) ui.welcomeCountdownLabel.textContent = allOpen
        ? "Все прогулки уже открыты" : "Следующая прогулка через";
      if (ui.journeyCountdown) ui.journeyCountdown.textContent = allOpen
        ? "Все прогулки открыты" : "Новая прогулка через " + wait;
      if (ui.journeyStartTime) ui.journeyStartTime.textContent = displayTime(journey.startedAt);
      if (ui.journeyEndTime) ui.journeyEndTime.textContent = displayTime(journey.finalUnlockAt);
      if (ui.cardProgress) ui.cardProgress.textContent = "Тото найден в " + journey.completed.length +
        " из " + levels.length + " прогулок";
      visible(ui.finalButton, journey.allCompleted);
      visible(ui.hubFinalButton, journey.allCompleted || preview);
      visible(ui.saveNotice, !preview && !journey.persistent);
      if (ui.startButton) ui.startButton.textContent = state.started
        ? "Продолжить прогулку" : "Пойдём искать!";
      if (ui.nextLevelButton) ui.nextLevelButton.textContent = nextIncomplete(state.levelIndex) !== -1
        ? "К следующей прогулке" : "Ко всем прогулкам";
      levelTiles.forEach(function (tile, index) {
        var opened = index < journey.unlockedCount;
        var completed = hasCompleted(index);
        tile.button.disabled = !opened;
        tile.button.classList[opened ? "remove" : "add"]("is-locked");
        tile.button.classList[completed ? "add" : "remove"]("is-completed");
        tile.button.classList[state.started && index === state.levelIndex ? "add" : "remove"]("is-current");
        if (state.started && index === state.levelIndex) tile.button.setAttribute("aria-current", "true");
        else tile.button.removeAttribute("aria-current");
        tile.label.textContent = !opened ? ""
          : completed ? "Тото найден · можно ещё раз" : "Искать Тото";
        if (tile.title) tile.title.textContent = opened ? (levels[index].title || "Сюрприз Тото") : "";
        tile.button.setAttribute("aria-label", opened
          ? "Прогулка " + (index + 1) + ". " + levels[index].title + ". " + tile.label.textContent
          : "Прогулка " + (index + 1) + ". Ещё закрыта.");
        if (opened && tile.thumb && levels[index].thumbnail &&
            tile.thumb.getAttribute("data-loaded") !== levels[index].thumbnail) {
          tile.thumb.src = levels[index].thumbnail;
          tile.thumb.setAttribute("data-loaded", levels[index].thumbnail);
        }
      });
      if (announceUnlock && journey.unlockedCount > before) {
        announce("Тото открыл новые прогулки! Теперь доступны " + journey.unlockedCount +
          " из " + levels.length + ". Их можно выбрать в меню прогулок.");
      }
    }

    function setTextWithDate(node, text) {
      var date = "24 октября";
      var at = text.indexOf(date);
      node.textContent = "";
      if (at < 0) {
        node.textContent = text;
        return;
      }
      if (at > 0) node.appendChild(document.createTextNode(text.slice(0, at)));
      var mark = document.createElement("span");
      mark.className = "date-mark";
      mark.textContent = date;
      node.appendChild(mark);
      if (at + date.length < text.length) node.appendChild(document.createTextNode(text.slice(at + date.length)));
    }

    function loadLevel(index, begin) {
      if (!Number.isInteger(index) || index < 0 || index >= levels.length ||
          !progress.isUnlocked(levels[index].id)) return false;
      refreshJourney(false);
      if (index === state.levelIndex && state.ready) {
        if (begin) startGame(true);
        return true;
      }
      root.clearTimeout(victoryTimeout);
      victoryTimeout = 0;
      stopConfetti();
      stopMotion();
      clearPointers();
      state.levelIndex = index;
      state.ready = false;
      state.error = false;
      state.pendingStart = Boolean(begin);
      if (begin) {
        enterGameView();
        state.started = true;
        state.phase = "loading";
        dialogs.forEach(closeDialog);
      }
      var level = currentLevel();
      scene.width = Math.max(1, number(level.scene && level.scene.width, 1));
      scene.height = Math.max(1, number(level.scene && level.scene.height, 1));
      target = {
        x: number(level.target && level.target.x, NaN),
        y: number(level.target && level.target.y, NaN),
        rx: number(level.target && level.target.rx, 0),
        ry: number(level.target && level.target.ry, 0)
      };
      targetValid = Number.isFinite(target.x) && Number.isFinite(target.y) && target.rx > 0 && target.ry > 0;
      var areaConfig = level.hintArea || {};
      area = {
        x: number(areaConfig.x, scene.width * 0.5),
        y: number(areaConfig.y, scene.height * 0.5),
        radius: Math.max(scene.width * 0.19, number(areaConfig.radius, scene.width * 0.24))
      };
      hints = level.hints || [];
      state.hintLevel = 0;
      state.misses = 0;
      state.elapsed = 0;
      state.clockSince = null;
      state.previewCard = false;
      state.viewport = { width: 0, height: 0 };
      visible(ui.hintArea, false);
      visible(ui.hintPin, false);
      visible(ui.revealButton, false);
      visible(ui.keyboardCursor, false);
      visible(ui.openCardButton, false);
      visible(ui.loadError, false);
      visible(ui.retryImageButton, false);
      visible(ui.loadingState, Boolean(begin));
      if (ui.loadingState) ui.loadingState.dataset.state = begin ? "loading" : "";
      if (ui.levelTitle) ui.levelTitle.textContent = level.title || "Прогулка с Тото";
      if (ui.levelSubtitle) setTextWithDate(ui.levelSubtitle, level.subtitle || "");
      if (ui.levelNumber) ui.levelNumber.textContent = String(index + 1).padStart(2, "0") + " / " + levels.length;
      if (ui.levelDescription) ui.levelDescription.textContent = level.description || "";
      if (ui.worldTitle) ui.worldTitle.textContent = level.title || "Мир Тото";
      ui.sceneImage.alt = level.scene && level.scene.alt || "Большая подробная иллюстрация: " + level.title;
      initialImageSource = level.scene && level.scene.src || "";
      updateButtons();
      refreshJourney(false);
      syncClock();
      // Full scene bytes stay unloaded until this quest is entered.
      if (!begin) return true;
      ui.world.style.width = scene.width + "px";
      ui.world.style.height = scene.height + "px";
      ui.sceneImage.width = scene.width;
      ui.sceneImage.height = scene.height;
      resizeScene();
      if (ui.sceneImage.fetchPriority !== undefined) ui.sceneImage.fetchPriority = "high";
      ui.sceneImage.src = initialImageSource;
      if (ui.sceneImage.complete) {
        if (ui.sceneImage.naturalWidth > 0) markImageReady();
        else markImageError();
      }
      return true;
    }

    function landingIsVisible() {
      return !document.body.classList.contains("game-active");
    }

    function goToLanding() {
      exitFullscreenView(function () {
        document.body.classList.remove("game-active", "route-panel-open");
        refreshJourney(false);
        syncClock();
        if (ui.welcomeDialog && typeof ui.welcomeDialog.scrollIntoView === "function") {
          ui.welcomeDialog.scrollIntoView({
            behavior: state.reducedMotion ? "auto" : "smooth",
            block: "start"
          });
        }
      });
    }

    function enterGameView() {
      document.body.classList.add("game-active");
    }

    function continueJourney() {
      refreshJourney(false);
      if (state.started && state.ready && state.phase === "playing") {
        syncClock();
        focusSafely(ui.viewport);
        return;
      }
      var index = nextIncomplete(-1);
      if (!state.started) enterGameView();
      loadLevel(index === -1 ? state.levelIndex : index, true);
    }

    function dialogIsOpen(dialog) {
      return Boolean(dialog && (dialog.open || dialog.getAttribute("data-modal-open") === "true"));
    }

    function anyDialogOpen() {
      return dialogs.some(dialogIsOpen);
    }

    function elapsedNow() {
      return state.elapsed + (state.clockSince === null ? 0 : performance.now() - state.clockSince);
    }

    function updateClock() {
      if (ui.timeLabel) ui.timeLabel.textContent = math.formatElapsed(elapsedNow());
    }

    function syncClock() {
      var running = state.phase === "playing" && state.ready &&
        !document.hidden && !state.suspended && !anyDialogOpen();
      if (running && state.clockSince === null) state.clockSince = performance.now();
      if (!running && state.clockSince !== null) {
        state.elapsed += performance.now() - state.clockSince;
        state.clockSince = null;
      }
      updateClock();
    }

    function focusSafely(element) {
      if (!element || !element.focus) return;
      try { element.focus({ preventScroll: true }); }
      catch (_) { element.focus(); }
    }

    function focusableElements(dialog) {
      return Array.prototype.filter.call(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
          'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
        function (element) {
          return !element.hidden && !element.closest("[hidden]") &&
            element.getClientRects().length > 0 &&
            element.getAttribute("aria-hidden") !== "true";
        }
      );
    }

    function showDialog(dialog, preferredFocus) {
      if (!dialog || dialogIsOpen(dialog)) return;
      clearPointers();
      dialogReturnFocus.set(dialog, document.activeElement);
      dialog.hidden = false;
      try {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
          dialog.setAttribute("data-modal-open", "true");
          dialog.setAttribute("aria-modal", "true");
          dialog.setAttribute("role", "dialog");
        }
      } catch (_) {
        dialog.setAttribute("open", "");
        dialog.setAttribute("data-modal-open", "true");
      }
      syncClock();
      root.requestAnimationFrame(function () {
        if (!dialogIsOpen(dialog)) return;
        var preferred = preferredFocus && !preferredFocus.disabled ? preferredFocus : null;
        focusSafely(preferred || focusableElements(dialog)[0] || dialog);
      });
    }

    function afterDialogClose(dialog) {
      dialog.removeAttribute("data-modal-open");
      if (dialog === ui.victoryDialog || dialog === ui.finalDialog) restoreConfettiCanvas();
      syncClock();
      var previous = dialogReturnFocus.get(dialog);
      dialogReturnFocus.delete(dialog);
      if (previous && previous !== document.body && previous.isConnected && !previous.hidden &&
          !previous.closest("[hidden]") && !previous.disabled &&
          previous.getClientRects().length > 0) {
        focusSafely(previous);
      } else if (state.started) {
        focusSafely(ui.viewport);
      }
    }

    function closeDialog(dialog) {
      if (!dialogIsOpen(dialog)) return;
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
        afterDialogClose(dialog);
      }
      syncClock();
    }

    dialogs.forEach(function (dialog) {
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
      listen(dialog, "close", function () { afterDialogClose(dialog); });
      listen(dialog, "keydown", function (event) {
        if (event.key === "Escape" && typeof dialog.close !== "function") {
          event.preventDefault();
          closeDialog(dialog);
        }
        if (event.key !== "Tab") return;
        var elements = focusableElements(dialog);
        if (!elements.length) {
          event.preventDefault();
          focusSafely(dialog);
          return;
        }
        var first = elements[0];
        var last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          focusSafely(last);
        } else if (!event.shiftKey &&
                   (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          focusSafely(first);
        }
      });
    });

    function measureViewport() {
      return {
        width: ui.viewport.clientWidth,
        height: ui.viewport.clientHeight
      };
    }

    function rememberViewportOrigin() {
      var rectangle = ui.viewport.getBoundingClientRect();
      viewportOrigin = {
        left: rectangle.left + ui.viewport.clientLeft,
        top: rectangle.top + ui.viewport.clientTop
      };
    }

    function localPoint(event) {
      // While a drag is active the viewport does not move, so reuse the origin.
      // Reading layout on every pointermove was forcing style recalculation.
      if (!pointers.size || !viewportOrigin) rememberViewportOrigin();
      return {
        x: event.clientX - viewportOrigin.left,
        y: event.clientY - viewportOrigin.top
      };
    }

    function navigationAllowed() {
      return state.ready && state.started && !anyDialogOpen() && !state.suspended;
    }

    function scaleLimit(scale) {
      return clamp(scale, state.fit, state.fit * maxZoom);
    }

    function updateButtons() {
      var playable = state.ready && state.phase === "playing";
      if (ui.startButton) ui.startButton.disabled = state.phase === "loading";
      if (ui.zoomIn) ui.zoomIn.disabled = !state.ready ||
        state.transform.scale >= state.fit * maxZoom - 0.000001;
      if (ui.zoomOut) ui.zoomOut.disabled = !state.ready ||
        state.transform.scale <= state.fit + 0.000001;
      if (ui.fitButton) ui.fitButton.disabled = !state.ready;
      [ui.hintButton, ui.mapHintButton].filter(Boolean).forEach(function (button) {
        button.disabled = !playable || state.hintLevel >= 3;
        button.setAttribute("aria-label", state.hintLevel >= 3 ? "Все три подсказки открыты"
          : "Подсказка " + (state.hintLevel + 1) + " из 3");
      });
      if (ui.restartButton) ui.restartButton.disabled = !state.ready || !state.started;
      if (ui.hintCount) ui.hintCount.textContent = state.hintLevel + " / 3";
      if (ui.zoomLabel) {
        ui.zoomLabel.textContent = Math.round(state.transform.scale / state.fit * 100) + "%";
      }
      if (ui.revealButton) ui.revealButton.disabled = !playable;
      if (ui.fullscreenButton) ui.fullscreenButton.disabled = !state.ready || !state.started;
      if (ui.previewCardButton) ui.previewCardButton.disabled = !preview || !state.ready;
    }

    function applyTransform() {
      var transform = state.transform;
      ui.world.style.transform = "translate3d(" + transform.x + "px," +
        transform.y + "px,0) scale(" + transform.scale + ")";
      if (ui.hintArea && !ui.hintArea.hidden) {
        ui.hintArea.style.borderWidth = Math.max(1, 1.35 / transform.scale) + "px";
      }
      if (ui.hintPin && !ui.hintPin.hidden) {
        ui.hintPin.style.transform = "translate(-50%,-50%) scale(" + (1 / transform.scale) + ")";
      }
      var percent = state.fit > 0
        ? Math.round(transform.scale / state.fit * 100) + "%"
        : "";
      if (percent === lastZoomPercent) return;
      lastZoomPercent = percent;
      if (ui.zoomLabel) ui.zoomLabel.textContent = percent;
      if (ui.zoomIn) ui.zoomIn.disabled = !state.ready ||
        transform.scale >= state.fit * maxZoom - 0.000001;
      if (ui.zoomOut) ui.zoomOut.disabled = !state.ready ||
        transform.scale <= state.fit + 0.000001;
    }

    function scheduleRender() {
      if (renderFrame) return;
      renderFrame = root.requestAnimationFrame(function () {
        renderFrame = 0;
        applyTransform();
      });
    }

    function stopMotion() {
      if (motionFrame) root.cancelAnimationFrame(motionFrame);
      motionFrame = 0;
    }

    function setTransform(transform) {
      state.transform = math.clampTransform(transform, state.viewport, scene);
      scheduleRender();
    }

    function animateTransform(transform, duration) {
      stopMotion();
      var destination = math.clampTransform(transform, state.viewport, scene);
      if (state.reducedMotion || duration === 0) {
        setTransform(destination);
        return;
      }
      var origin = {
        x: state.transform.x, y: state.transform.y, scale: state.transform.scale
      };
      var start = performance.now();
      var length = duration || 260;
      function step(now) {
        var progress = clamp((now - start) / length, 0, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        state.transform = math.clampTransform({
          x: origin.x + (destination.x - origin.x) * eased,
          y: origin.y + (destination.y - origin.y) * eased,
          scale: origin.scale + (destination.scale - origin.scale) * eased
        }, state.viewport, scene);
        applyTransform();
        if (progress < 1) motionFrame = root.requestAnimationFrame(step);
        else motionFrame = 0;
      }
      motionFrame = root.requestAnimationFrame(step);
    }

    function fitScene(animated) {
      if (!state.viewport.width || !state.viewport.height) resizeScene();
      var fitted = math.clampTransform(
        { x: 0, y: 0, scale: state.fit }, state.viewport, scene
      );
      if (animated) animateTransform(fitted);
      else {
        stopMotion();
        setTransform(fitted);
      }
    }

    function openingScale() {
      if (state.viewport.width / state.viewport.height < 1.15) {
        return scaleLimit(Math.max(
          state.viewport.width / scene.width,
          state.viewport.height / scene.height
        ));
      }
      return state.fit;
    }

    function openingSceneView() {
      stopMotion();
      var scale = openingScale();
      setTransform({
        x: state.viewport.width / 2 - scene.width * scale / 2,
        y: state.viewport.height / 2 - scene.height * scale / 2,
        scale: scale
      });
    }

    function zoomAtPoint(factor, point, animated) {
      stopMotion();
      var next = math.zoomAt(state.transform, point, scaleLimit(state.transform.scale * factor));
      if (animated) animateTransform(next, 180);
      else setTransform(next);
    }

    function centerOn(point, scale, duration) {
      var nextScale = scaleLimit(scale);
      animateTransform({
        x: state.viewport.width / 2 - point.x * nextScale,
        y: state.viewport.height / 2 - point.y * nextScale,
        scale: nextScale
      }, duration);
    }

    function resizeScene() {
      viewportOrigin = null;
      var measured = measureViewport();
      if (!(measured.width > 0 && measured.height > 0)) return;
      if (measured.width === state.viewport.width &&
          measured.height === state.viewport.height) return;
      clearPointers();
      stopMotion();
      var oldViewport = state.viewport;
      var oldFit = state.fit;
      var oldCenter = oldViewport.width && oldViewport.height
        ? math.imagePoint(state.transform, {
          x: oldViewport.width / 2, y: oldViewport.height / 2
        })
        : { x: scene.width / 2, y: scene.height / 2 };
      var relativeZoom = oldViewport.width ? state.transform.scale / oldFit : 1;
      state.viewport = measured;
      state.fit = math.fitScale(measured, scene);
      var newScale = scaleLimit(state.fit * relativeZoom);
      if (!state.started) {
        newScale = openingScale();
        oldCenter = { x: scene.width / 2, y: scene.height / 2 };
      }
      setTransform({
        x: measured.width / 2 - oldCenter.x * newScale,
        y: measured.height / 2 - oldCenter.y * newScale,
        scale: newScale
      });
    }

    function positionHints() {
      if (ui.hintArea) {
        ui.hintArea.style.left = (area.x - area.radius) + "px";
        ui.hintArea.style.top = (area.y - area.radius) + "px";
        ui.hintArea.style.width = (area.radius * 2) + "px";
        ui.hintArea.style.height = (area.radius * 2) + "px";
        ui.hintArea.style.pointerEvents = "none";
      }
      if (ui.hintPin) {
        ui.hintPin.style.left = target.x + "px";
        ui.hintPin.style.top = target.y + "px";
        ui.hintPin.style.pointerEvents = "none";
        ui.hintPin.setAttribute("aria-hidden", "true");
      }
    }

    function giveHint() {
      if (!state.ready || state.phase !== "playing" || state.hintLevel >= 3) return;
      state.hintLevel += 1;
      var message = String(hints[state.hintLevel - 1] || hints[hints.length - 1] || "");
      if (ui.hintMessage) {
        ui.hintMessage.textContent = message;
        ui.hintMessage.hidden = false;
      }
      if (ui.mapHintMessage) {
        ui.mapHintMessage.textContent = message;
        ui.mapHintMessage.hidden = false;
      }
      // The first two clues are words only: no movement, pin, circle or zoom.
      // The third marks a broad, off-centre neighbourhood and shows the whole scene.
      if (state.hintLevel === 3) {
        visible(ui.hintArea, true);
        fitScene(true);
      }
      playSound("hint");
      updateButtons();
      announce("Подсказка " + state.hintLevel + " из 3. " + message);
    }

    function soundButtonState() {
      if (!ui.soundButton) return;
      ui.soundButton.setAttribute("aria-pressed", String(state.sound));
      ui.soundButton.setAttribute("aria-label", state.sound ? "Выключить звуки" : "Включить звуки");
      ui.soundButton.title = state.sound ? "Выключить звуки" : "Включить звуки";
      ui.soundButton.dataset.state = state.sound ? "on" : "off";
      var label = ui.soundButton.querySelector("[data-label]");
      if (label) label.textContent = state.sound ? "Звук вкл." : "Звук выкл.";
    }

    async function toggleSound() {
      if (state.sound) {
        state.sound = false;
        soundButtonState();
        announce("Звуки выключены.");
        return;
      }
      var AudioClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioClass) {
        announce("В этом браузере звук недоступен. Игра продолжится без звука.");
        return;
      }
      try {
        if (!audioContext) audioContext = new AudioClass();
        if (audioContext.state === "suspended") await audioContext.resume();
        state.sound = true;
        soundButtonState();
        playSound("enable");
        announce("Тихие звуки включены.");
      } catch (_) {
        state.sound = false;
        soundButtonState();
        announce("Браузер не смог включить звук. Можно попробовать ещё раз.");
      }
    }

    function playTone(frequency, time, duration, volume, type) {
      if (!audioContext || audioContext.state !== "running") return;
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(volume, time + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.025);
      oscillator.onended = function () {
        oscillator.disconnect();
        gain.disconnect();
      };
    }

    function playSound(kind) {
      if (!state.sound || !audioContext || document.hidden) return;
      if (audioContext.state !== "running") {
        audioContext.resume().catch(function () {});
        return;
      }
      var now = audioContext.currentTime + 0.01;
      if (kind === "win") {
        [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach(function (frequency, index) {
          playTone(frequency, now + index * 0.105, 0.42, 0.035, "sine");
        });
      } else if (kind === "miss") {
        playTone(246.94, now, 0.11, 0.018, "sine");
      } else {
        playTone(659.25, now, 0.19, 0.025, "sine");
        playTone(880, now + 0.09, 0.25, 0.023, "sine");
      }
    }

    function showTapFeedback(point, found) {
      var ripple = document.createElement("span");
      ripple.className = "tap-feedback" + (found ? " is-correct" : "");
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.cssText = "position:absolute;pointer-events:none;z-index:8;" +
        "left:" + point.x + "px;top:" + point.y + "px;" +
        "width:32px;height:32px;margin:-16px 0 0 -16px;border-radius:50%;" +
        "border:2px solid " + (found ? "#7d995e" : "#ad705c") + ";" +
        "background:" + (found ? "rgba(255,231,159,.28)" : "rgba(255,248,232,.5)") + ";";
      ui.viewport.appendChild(ripple);
      if (ripple.animate && !state.reducedMotion) {
        var animation = ripple.animate([
          { transform: "scale(.6)", opacity: 0.9 },
          { transform: "scale(1.8)", opacity: 0 }
        ], { duration: 520, easing: "ease-out", fill: "forwards" });
        animation.onfinish = function () { ripple.remove(); };
      } else {
        root.setTimeout(function () { ripple.remove(); }, 400);
      }
    }

    function registerTap(point, pointerType) {
      if (state.phase !== "playing" || !state.ready || anyDialogOpen()) return;
      if (point.x < 0 || point.y < 0 || point.x > state.viewport.width ||
          point.y > state.viewport.height) return;
      var image = math.imagePoint(state.transform, point);
      // Letterbox space never counts as a hit.
      if (image.x < 0 || image.y < 0 || image.x > scene.width || image.y > scene.height) return;
      var found = math.containsTarget(image, target, math.hitSlop(pointerType, state.transform.scale, target));
      showTapFeedback(point, found);
      if (found) {
        win(false);
      } else {
        state.misses += 1;
        playSound("miss");
        if (performance.now() - lastMissAnnouncement > 3500) {
          lastMissAnnouncement = performance.now();
          announce("Здесь Тото нет. Можно приблизить картинку или взять подсказку.");
        }
      }
    }

    function pinchSnapshot() {
      var pair = Array.from(pointers.values()).slice(0, 2);
      if (pair.length < 2) return null;
      return {
        midpoint: { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 },
        distance: Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y))
      };
    }

    function clearPointers() {
      pointers.forEach(function (_, id) {
        try {
          if (ui.viewport.hasPointerCapture && ui.viewport.hasPointerCapture(id)) {
            ui.viewport.releasePointerCapture(id);
          }
        } catch (_) {}
      });
      pointers.clear();
      gesture = null;
      ui.viewport.classList.remove("is-dragging");
    }

    function onPointerDown(event) {
      if (!navigationAllowed() || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (event.target.closest && event.target.closest("button, a, input, select, textarea")) return;
      event.preventDefault();
      visible(ui.keyboardCursor, false);
      stopMotion();
      var point = localPoint(event);
      if (!pointers.size) {
        gesture = {
          primary: event.pointerId,
          pointerType: event.pointerType || "mouse",
          start: point,
          maxMovement: 0,
          threshold: event.pointerType === "touch" ? 10 : 5,
          multi: false,
          cancelled: false,
          dragging: false,
          pinch: null
        };
      }
      pointers.set(event.pointerId, point);
      try { ui.viewport.setPointerCapture(event.pointerId); } catch (_) {}
      if (pointers.size > 1 && gesture) {
        gesture.multi = true;
        gesture.dragging = true;
        gesture.pinch = pinchSnapshot();
        ui.viewport.classList.add("is-dragging");
      }
      if (event.pointerType !== "touch") focusSafely(ui.viewport);
    }

    function onPointerMove(event) {
      if (!pointers.has(event.pointerId) || !gesture) return;
      event.preventDefault();
      var previous = pointers.get(event.pointerId);
      var point = localPoint(event);
      pointers.set(event.pointerId, point);
      if (pointers.size >= 2) {
        var currentPinch = pinchSnapshot();
        var previousPinch = gesture.pinch || currentPinch;
        var nextScale = scaleLimit(
          state.transform.scale * currentPinch.distance / previousPinch.distance
        );
        var anchor = math.imagePoint(state.transform, previousPinch.midpoint);
        setTransform({
          x: currentPinch.midpoint.x - anchor.x * nextScale,
          y: currentPinch.midpoint.y - anchor.y * nextScale,
          scale: nextScale
        });
        gesture.pinch = currentPinch;
        gesture.multi = true;
        gesture.dragging = true;
        ui.viewport.classList.add("is-dragging");
        return;
      }
      var distance = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y);
      gesture.maxMovement = Math.max(gesture.maxMovement, distance);
      if (!gesture.dragging && gesture.maxMovement > gesture.threshold) {
        gesture.dragging = true;
        setTransform({
          x: state.transform.x + point.x - gesture.start.x,
          y: state.transform.y + point.y - gesture.start.y,
          scale: state.transform.scale
        });
      } else if (gesture.dragging) {
        setTransform({
          x: state.transform.x + point.x - previous.x,
          y: state.transform.y + point.y - previous.y,
          scale: state.transform.scale
        });
      }
      if (gesture.dragging) ui.viewport.classList.add("is-dragging");
    }

    function finishPointer(event, cancelled) {
      if (!pointers.has(event.pointerId) || !gesture) return;
      var point = localPoint(event);
      if (Number.isFinite(point.x) && Number.isFinite(point.y) &&
          event.pointerId === gesture.primary) {
        gesture.maxMovement = Math.max(gesture.maxMovement,
          Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y));
      }
      if (cancelled) gesture.cancelled = true;
      var candidate = pointers.size === 1 && !cancelled && math.tapEligible(gesture);
      var pointerType = gesture.pointerType;
      pointers.delete(event.pointerId);
      try {
        if (ui.viewport.hasPointerCapture && ui.viewport.hasPointerCapture(event.pointerId)) {
          ui.viewport.releasePointerCapture(event.pointerId);
        }
      } catch (_) {}
      if (!pointers.size) {
        gesture = null;
        ui.viewport.classList.remove("is-dragging");
        if (candidate) registerTap(point, pointerType);
      } else {
        // A multi-touch gesture stays multi-touch until ALL fingers are lifted.
        gesture.multi = true;
        gesture.pinch = pinchSnapshot();
        if (pointers.size === 1) {
          gesture.start = Array.from(pointers.values())[0];
          gesture.dragging = true;
        }
      }
    }

    function restoreConfettiCanvas() {
      if (!ui.confettiCanvas || !confettiHome || !confettiHome.parent ||
          ui.confettiCanvas.parentNode === confettiHome.parent) return;
      var before = confettiHome.nextSibling;
      confettiHome.parent.insertBefore(ui.confettiCanvas,
        before && before.parentNode === confettiHome.parent ? before : null);
    }

    function stopConfetti() {
      if (confettiFrame) root.cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
      root.clearTimeout(confettiStopTimeout);
      confettiStopTimeout = 0;
      if (confettiContext && ui.confettiCanvas) {
        confettiContext.clearRect(0, 0, ui.confettiCanvas.width, ui.confettiCanvas.height);
      }
      visible(ui.confettiCanvas, false);
      restoreConfettiCanvas();
    }

    function startConfetti() {
      stopConfetti();
      if (!ui.confettiCanvas) return;
      try { confettiContext = ui.confettiCanvas.getContext("2d"); }
      catch (_) { return; }
      if (!confettiContext) return;
      var canvas = ui.confettiCanvas;
      var context = confettiContext;
      var width = root.innerWidth;
      var height = root.innerHeight;
      var ratio = Math.min(root.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      visible(canvas, true);
      var colors = ["#e59c94", "#efd184", "#93ac8a", "#c4afe0", "#ffffff", "#d59f54"];
      var particles = [];
      var count = state.reducedMotion ? 28 : 170;
      for (var index = 0; index < count; index += 1) {
        var side = index % 2 ? 1 : -1;
        particles.push({
          x: state.reducedMotion ? Math.random() * width : side < 0 ? width * 0.07 : width * 0.93,
          y: state.reducedMotion ? Math.random() * height * 0.8 : height * 0.6 + Math.random() * 45,
          vx: -side * (120 + Math.random() * 320),
          vy: -240 - Math.random() * 500,
          rotation: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 10,
          size: 5 + Math.random() * 7,
          color: colors[index % colors.length],
          round: index % 4 === 0
        });
      }
      function drawParticle(particle) {
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        if (particle.round) {
          context.beginPath();
          context.arc(0, 0, particle.size * 0.4, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.65);
        }
        context.restore();
      }
      if (state.reducedMotion) {
        particles.forEach(drawParticle);
        confettiStopTimeout = root.setTimeout(stopConfetti, 900);
        return;
      }
      var started = performance.now();
      var previous = started;
      function frame(now) {
        var delta = Math.min((now - previous) / 1000, 0.035);
        previous = now;
        context.clearRect(0, 0, width, height);
        context.globalAlpha = clamp((4300 - (now - started)) / 1000, 0, 1);
        particles.forEach(function (particle) {
          particle.x += particle.vx * delta;
          particle.y += particle.vy * delta;
          particle.vy += 520 * delta;
          particle.vx *= Math.pow(0.98, delta * 60);
          particle.rotation += particle.spin * delta;
          drawParticle(particle);
        });
        context.globalAlpha = 1;
        if (now - started < 4300) confettiFrame = root.requestAnimationFrame(frame);
        else stopConfetti();
      }
      confettiFrame = root.requestAnimationFrame(frame);
    }

    function fillVictoryCard() {
      var level = currentLevel();
      var card = level.card || {};
      if (ui.cardImage) {
        var cardSrc = card.src || "";
        if (cardSrc && ui.cardImage.getAttribute("data-loaded") !== cardSrc) {
          ui.cardImage.src = cardSrc;
          ui.cardImage.setAttribute("data-loaded", cardSrc);
        }
        ui.cardImage.alt = card.alt || "Поздравительная открытка от Тото";
        ui.cardImage.style.objectPosition = card.position || "50% 50%";
      }
      if (ui.cardTitle) ui.cardTitle.textContent = card.title || "С днём рождения, Любимочка!";
      if (ui.cardText) ui.cardText.textContent = card.text || "Обнимаю тебя всеми лапками!";
      if (ui.cardLocation) ui.cardLocation.textContent = card.eyebrow || level.title;
      if (ui.cardSignoff) ui.cardSignoff.textContent = card.signoff || "Твой Тото ♡";
      if (ui.victoryTitle) ui.victoryTitle.textContent = state.previewCard
        ? "Проверяем открытку Тото" : "Рина, ты нашла Тото!";
      if (ui.victoryTime) ui.victoryTime.textContent = math.formatElapsed(elapsedNow());
      if (ui.victoryHints) ui.victoryHints.textContent = state.previewCard
        ? "Просмотр не засчитывает находку" : state.hintLevel === 0
          ? "Без подсказок" : "Подсказки: " + state.hintLevel + " из 3";
      refreshJourney(false);
    }

    function openVictoryCard() {
      if (state.phase !== "won" && state.phase !== "celebrating" && !state.previewCard) return;
      if (!state.previewCard) state.phase = "won";
      fillVictoryCard();
      showDialog(ui.victoryDialog, ui.nextLevelButton || ui.victoryClose);
      // The native dialog is a top layer: confetti follows it into that layer.
      if (ui.victoryDialog && ui.confettiCanvas && !ui.confettiCanvas.hidden) {
        ui.victoryDialog.appendChild(ui.confettiCanvas);
      }
    }

    var finalImageSource = "assets/cards/final.webp";

    function ensureFinalImage() {
      if (!ui.finalImage) return;
      if (ui.finalImage.getAttribute("data-loaded") === finalImageSource) return;
      try {
        ui.finalImage.src = new URL(finalImageSource, document.baseURI).href;
      } catch (_) {
        ui.finalImage.src = finalImageSource;
      }
      ui.finalImage.setAttribute("data-loaded", finalImageSource);
    }

    function openFinal() {
      refreshJourney(false);
      if (!journey.allCompleted && !preview) return false;
      ensureFinalImage();
      exitFullscreenView(function () {
        dialogs.forEach(closeDialog);
        progress.markFinalSeen();
        showDialog(ui.finalDialog, ui.finalClose || ui.finalReplayButton);
        startConfetti();
        if (ui.finalDialog && ui.confettiCanvas) ui.finalDialog.appendChild(ui.confettiCanvas);
        playSound("win");
        announce("Все тринадцать Тото найдены! Рина, с днём рождения, Любимочка!");
      });
      return true;
    }

    function continueAfterCard() {
      refreshJourney(false);
      var index = nextIncomplete(state.levelIndex);
      closeDialog(ui.victoryDialog);
      state.previewCard = false;
      if (index !== -1) loadLevel(index, true);
      else goToLanding();
    }

    function win() {
      if (state.phase !== "playing" || !state.ready) return;
      var winningIndex = state.levelIndex;
      state.phase = "celebrating";
      state.assisted = false;
      state.previewCard = false;
      clearPointers();
      syncClock();
      progress.complete(currentLevel().id, { elapsedMs: elapsedNow(), hints: state.hintLevel });
      refreshJourney(false);
      visible(ui.hintArea, false);
      visible(ui.hintPin, true);
      visible(ui.keyboardCursor, false);
      visible(ui.revealButton, false);
      visible(ui.openCardButton, true);
      if (ui.hintPin) ui.hintPin.dataset.state = "found";
      if (mapBadge) mapBadge.textContent = "Тото нашёлся!";
      if (ui.hintMessage) {
        ui.hintMessage.hidden = false;
        ui.hintMessage.textContent = "Рина, ты нашла Тото! Он приготовил для тебя маленькое поздравление.";
      }
      if (ui.mapHintMessage) ui.mapHintMessage.hidden = true;
      ui.viewport.classList.add("is-found");
      updateButtons();
      playSound("win");
      announce("Ура, Рина нашла Тото! Сейчас он подарит тебе открытку.");
      // The image leaves fullscreen before any greeting dialog is opened.
      exitFullscreenView(function () {
        if (state.phase !== "celebrating" || state.levelIndex !== winningIndex) return;
        centerOn(target, Math.max(state.transform.scale, state.fit * 2.5,
          52 / (Math.min(target.rx, target.ry) * 2)), 400);
        startConfetti();
        root.clearTimeout(victoryTimeout);
        victoryTimeout = root.setTimeout(function () {
          if (state.phase === "celebrating" && state.levelIndex === winningIndex) openVictoryCard();
        }, state.reducedMotion ? 180 : 1050);
      });
    }

    function startGame(restarting) {
      if (!state.ready || !progress.isUnlocked(currentLevel().id)) return;
      root.clearTimeout(victoryTimeout);
      victoryTimeout = 0;
      stopConfetti();
      stopMotion();
      clearPointers();
      state.phase = "playing";
      state.started = true;
      state.pendingStart = false;
      state.previewCard = false;
      state.hintLevel = 0;
      state.assisted = false;
      state.misses = 0;
      state.elapsed = 0;
      state.clockSince = null;
      lastMissAnnouncement = -Infinity;
      visible(ui.hintArea, false);
      visible(ui.hintPin, false);
      visible(ui.revealButton, false);
      visible(ui.keyboardCursor, false);
      visible(ui.openCardButton, false);
      visible(ui.mapHintMessage, false);
      if (ui.hintMessage) {
        ui.hintMessage.hidden = false;
        ui.hintMessage.textContent = restarting
          ? "Тото снова в своём укрытии. Прогуляемся ещё раз?"
          : "Не торопись. Приближай картинку, замечай маленькие истории и ищи Тото.";
      }
      ui.viewport.classList.remove("is-found");
      if (mapBadge) mapBadge.textContent = mapBadgeInitialText;
      dialogs.forEach(closeDialog);
      openingSceneView();
      refreshJourney(false);
      updateButtons();
      syncClock();
      focusSafely(ui.viewport);
      announce(restarting
        ? "Прогулка началась заново. Тото в том же укрытии, время поиска и подсказки сброшены. Расписание остальных прогулок сохранено."
        : "Поиск начался. Можно приблизить картинку кнопками или жестом и перемещать её перетаскиванием.");
    }

    function markImageReady() {
      if (state.ready && !state.error && !state.pendingStart) return;
      if (!(ui.sceneImage.naturalWidth > 0 && ui.sceneImage.naturalHeight > 0)) {
        markImageError();
        return;
      }
      if (!(currentLevel().scene && currentLevel().scene.width > 0 && currentLevel().scene.height > 0)) {
        scene.width = ui.sceneImage.naturalWidth;
        scene.height = ui.sceneImage.naturalHeight;
      }
      if (!targetValid || target.x < 0 || target.y < 0 ||
          target.x > scene.width || target.y > scene.height) {
        markImageError("В настройках игры не удалось найти место Тото. Проверь, что config.js и все файлы из архива лежат рядом.");
        return;
      }
      state.ready = true;
      state.error = false;
      ui.world.style.width = scene.width + "px";
      ui.world.style.height = scene.height + "px";
      ui.world.style.transformOrigin = "0 0";
      visible(ui.loadingState, false);
      visible(ui.loadError, false);
      visible(ui.retryImageButton, false);
      positionHints();
      // Scene dimensions may only become available after the image has loaded.
      state.viewport = { width: 0, height: 0 };
      resizeScene();
      if (!state.started) openingSceneView();
      updateButtons();
      syncClock();
      if (state.pendingStart) {
        startGame(false);
        return;
      }
      if (!state.started && ui.startButton && document.activeElement === document.body) {
        focusSafely(ui.startButton);
      }
    }

    function markImageError(message) {
      state.ready = false;
      state.error = true;
      clearPointers();
      stopMotion();
      visible(ui.loadingState, !ui.loadError ||
        Boolean(ui.loadingState && ui.loadingState.contains(ui.loadError)));
      visible(ui.loadError, true);
      visible(ui.retryImageButton, true);
      if (ui.loadingState) ui.loadingState.dataset.state = "error";
      if (ui.loadError) {
        var errorMessage = ui.loadError.querySelector("[data-error-message], p");
        if (!errorMessage) {
          errorMessage = document.createElement("p");
          ui.loadError.insertBefore(errorMessage, ui.loadError.firstChild);
        }
        errorMessage.textContent = typeof message === "string" ? message :
          "Картинка не открылась. Распакуй весь архив целиком, сохрани папку assets рядом с index.html и нажми «Попробовать ещё раз».";
      }
      // The error and its retry button must be reachable, even before the first game.
      updateButtons();
      syncClock();
      announce("Картинка пока недоступна. Проверь, что архив полностью распакован.");
    }

    function retryImage() {
      state.ready = false;
      state.error = false;
      visible(ui.loadingState, true);
      visible(ui.loadError, false);
      visible(ui.retryImageButton, false);
      if (ui.loadingState) ui.loadingState.dataset.state = "loading";
      updateButtons();
      syncClock();
      try {
        var url = new URL(initialImageSource, document.baseURI);
        url.searchParams.set("retry", String(Date.now()));
        ui.sceneImage.src = url.href;
      } catch (_) {
        ui.sceneImage.src = initialImageSource;
      }
    }

    listen(ui.sceneImage, "load", markImageReady);
    listen(ui.sceneImage, "error", markImageError);
    listen(ui.retryImageButton, "click", retryImage);
    listen(ui.startButton, "click", continueJourney);
    if (preview && brandLink) brandLink.setAttribute("href", "./index.html?preview=1#welcomeDialog");
    listen(brandLink, "click", function (event) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      event.preventDefault();
      goToLanding();
    });
    listen(ui.restartButton, "click", function () { startGame(true); });
    listen(ui.replayButton, "click", function () { startGame(true); });
    listen(ui.journeyButton, "click", goToLanding);
    listen(ui.helpButton, "click", function () {
      exitFullscreenView(function () { showDialog(ui.helpDialog, ui.helpClose); });
    });
    listen(ui.helpClose, "click", function () { closeDialog(ui.helpDialog); });
    listen(ui.victoryClose, "click", function () {
      closeDialog(ui.victoryDialog);
      state.previewCard = false;
    });
    listen(ui.openCardButton, "click", openVictoryCard);
    listen(ui.nextLevelButton, "click", continueAfterCard);
    listen(ui.finalButton, "click", openFinal);
    listen(ui.hubFinalButton, "click", openFinal);
    listen(ui.finalClose, "click", function () { closeDialog(ui.finalDialog); });
    listen(ui.finalReplayButton, "click", function () { closeDialog(ui.finalDialog); goToLanding(); });
    listen(ui.previewCardButton, "click", function () {
      if (!preview || !state.ready) return;
      if (!state.started) startGame(false);
      state.previewCard = true;
      exitFullscreenView(openVictoryCard);
    });
    listen(ui.hintButton, "click", giveHint);
    listen(ui.mapHintButton, "click", giveHint);
    listen(ui.soundButton, "click", toggleSound);
    listen(ui.zoomIn, "click", function () {
      if (state.ready) zoomAtPoint(1.3, { x: state.viewport.width / 2, y: state.viewport.height / 2 }, true);
    });
    listen(ui.zoomOut, "click", function () {
      if (state.ready) zoomAtPoint(1 / 1.3, { x: state.viewport.width / 2, y: state.viewport.height / 2 }, true);
    });
    listen(ui.fitButton, "click", function () { if (state.ready) fitScene(true); });

    ui.sceneImage.draggable = false;
    ui.viewport.style.touchAction = "none";
    ui.viewport.style.overscrollBehavior = "contain";
    if (!ui.viewport.hasAttribute("tabindex")) ui.viewport.tabIndex = 0;
    listen(ui.viewport, "pointerdown", onPointerDown);
    listen(ui.viewport, "pointermove", onPointerMove);
    listen(ui.viewport, "pointerup", function (event) { finishPointer(event, false); });
    listen(ui.viewport, "pointercancel", function (event) { finishPointer(event, true); });
    listen(ui.viewport, "lostpointercapture", function (event) {
      if (pointers.has(event.pointerId)) finishPointer(event, true);
    });
    listen(ui.viewport, "contextmenu", function (event) { event.preventDefault(); });
    listen(ui.viewport, "dragstart", function (event) { event.preventDefault(); });
    listen(ui.viewport, "wheel", function (event) {
      if (!navigationAllowed()) return;
      event.preventDefault();
      if (gesture) gesture.cancelled = true;
      var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.viewport.height : 1;
      var factor = Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.008 : 0.0016));
      zoomAtPoint(clamp(factor, 0.65, 1.5), localPoint(event), false);
    }, { passive: false });
    listen(ui.viewport, "dblclick", function (event) {
      if (!navigationAllowed() || event.target !== ui.viewport && event.target.closest("button, a")) return;
      event.preventDefault();
      zoomAtPoint(1.65, localPoint(event), true);
    });
    listen(ui.viewport, "keydown", function (event) {
      if (!navigationAllowed() || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target !== ui.viewport && event.target.closest("button, a, input, select, textarea")) return;
      var center = { x: state.viewport.width / 2, y: state.viewport.height / 2 };
      var handled = true;
      var movement = event.shiftKey ? 150 : 75;
      var next = { x: state.transform.x, y: state.transform.y, scale: state.transform.scale };
      switch (event.key) {
        case "+":
        case "=":
          zoomAtPoint(1.25, center, true); break;
        case "-":
        case "_":
          zoomAtPoint(0.8, center, true); break;
        case "0":
        case "Home":
          fitScene(true); break;
        case "ArrowLeft":
          stopMotion(); next.x += movement; setTransform(next); break;
        case "ArrowRight":
          stopMotion(); next.x -= movement; setTransform(next); break;
        case "ArrowUp":
          stopMotion(); next.y += movement; setTransform(next); break;
        case "ArrowDown":
          stopMotion(); next.y -= movement; setTransform(next); break;
        case " ":
        case "Enter":
          registerTap(center, "keyboard"); break;
        case "h":
        case "H":
        case "р":
        case "Р":
          giveHint(); break;
        case "?":
          showDialog(ui.helpDialog, ui.helpClose); break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        if (state.phase === "playing") visible(ui.keyboardCursor, true);
      }
    });

    function fullscreenActive() {
      return state.immersive || Boolean(ui.sceneShell && document.fullscreenElement === ui.sceneShell);
    }

    function updateFullscreenButton() {
      var full = fullscreenActive();
      if (ui.fullscreenButton) {
        ui.fullscreenButton.setAttribute("aria-pressed", String(full));
        ui.fullscreenButton.setAttribute("aria-label", full
          ? "Выйти из полного экрана картинки" : "Рассмотреть картинку на весь экран");
        ui.fullscreenButton.title = full ? "Выйти из полного экрана" : "Картинка на весь экран";
        var label = ui.fullscreenButton.querySelector("[data-label]");
        if (label) label.textContent = full ? "Свернуть" : "На весь экран";
      }
      if (ui.sceneShell) ui.sceneShell.classList[full ? "add" : "remove"]("is-fullscreen");
    }

    function enterImmersiveFallback() {
      if (!ui.sceneShell) return;
      state.immersive = true;
      ui.sceneShell.classList.add("is-immersive");
      document.body.classList.add("map-is-immersive");
      updateFullscreenButton();
      resizeScene();
      root.requestAnimationFrame(resizeScene);
      announce("Картинка раскрыта на весь экран. Кнопка «Свернуть» или Escape вернёт обычный вид.");
    }

    function exitFullscreenView(done) {
      function finish() {
        state.immersive = false;
        if (ui.sceneShell) ui.sceneShell.classList.remove("is-immersive");
        document.body.classList.remove("map-is-immersive");
        updateFullscreenButton();
        resizeScene();
        root.requestAnimationFrame(resizeScene);
        if (typeof done === "function") done();
      }
      if (ui.sceneShell && document.fullscreenElement === ui.sceneShell && document.exitFullscreen) {
        try {
          var result = document.exitFullscreen();
          if (result && typeof result.then === "function") result.then(finish, finish);
          else finish();
        } catch (_) { finish(); }
      } else finish();
    }

    function toggleFullscreen() {
      if (!state.ready || !state.started || !ui.sceneShell) return;
      if (fullscreenActive()) { exitFullscreenView(); return; }
      clearPointers();
      if (typeof ui.sceneShell.requestFullscreen === "function" && document.exitFullscreen) {
        try {
          // The shell contains only the illustration and its small navigation controls.
          var request = ui.sceneShell.requestFullscreen();
          if (request && typeof request.then === "function") {
            request.then(function () { updateFullscreenButton(); resizeScene(); }, enterImmersiveFallback);
          } else { updateFullscreenButton(); resizeScene(); }
        } catch (_) { enterImmersiveFallback(); }
      } else enterImmersiveFallback();
    }

    listen(ui.fullscreenButton, "click", toggleFullscreen);
    listen(document, "fullscreenchange", function () {
      updateFullscreenButton();
      resizeScene();
      root.requestAnimationFrame(resizeScene);
    });
    listen(document, "keydown", function (event) {
      if (event.key === "Escape" && fullscreenActive() && !anyDialogOpen()) {
        event.preventDefault();
        exitFullscreenView();
      }
    });

    listen(document, "visibilitychange", function () {
      if (document.hidden) {
        clearPointers();
        stopMotion();
        progress.save();
      }
      refreshJourney(!document.hidden);
      syncClock();
    });
    listen(root, "pagehide", function () {
      state.suspended = true;
      clearPointers();
      stopMotion();
      stopConfetti();
      progress.save();
      syncClock();
    });
    listen(root, "pageshow", function () {
      state.suspended = false;
      refreshJourney(true);
      resizeScene();
      syncClock();
    });
    listen(root, "blur", clearPointers);
    listen(root, "storage", function (event) {
      if (!preview && event.key === progress.key && (!event.storageArea || event.storageArea === storage)) {
        progress.receive(event.newValue);
        refreshJourney(true);
      }
    });
    listen(root, "resize", resizeScene);
    if (root.ResizeObserver) {
      var resizeObserver = new root.ResizeObserver(resizeScene);
      resizeObserver.observe(ui.viewport);
    }
    function motionChanged(event) {
      state.reducedMotion = Boolean(event.matches);
      if (state.reducedMotion) {
        stopMotion();
        stopConfetti();
      }
    }
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", motionChanged);
    else if (motionQuery.addListener) motionQuery.addListener(motionChanged);

    // Non-spoiling state snapshot for diagnostics and automated checks.
    root.FindToto = Object.freeze({
      getState: function () {
        return {
          phase: state.phase,
          imageReady: state.ready,
          imageError: state.error,
          hintsUsed: state.hintLevel,
          assisted: state.assisted,
          elapsedMs: Math.round(elapsedNow()),
          misses: state.misses,
          zoom: state.transform.scale / state.fit,
          transform: {
            x: state.transform.x, y: state.transform.y, scale: state.transform.scale
          },
          viewport: { width: state.viewport.width, height: state.viewport.height },
          activePointers: pointers.size,
          soundEnabled: state.sound,
          reducedMotion: state.reducedMotion,
          levelId: currentLevel().id,
          levelNumber: state.levelIndex + 1,
          unlockedCount: journey.unlockedCount,
          completed: journey.completed.slice(),
          startedAt: journey.startedAt,
          nextUnlockAt: journey.nextUnlockAt,
          allCompleted: journey.allCompleted,
          persistent: journey.persistent,
          preview: preview,
          fullscreen: fullscreenActive(),
          immersiveFallback: state.immersive,
          finalOpen: dialogIsOpen(ui.finalDialog),
          landingVisible: landingIsVisible()
        };
      }
    });

    visible(ui.hintArea, false);
    visible(ui.hintPin, false);
    visible(ui.revealButton, false);
    visible(ui.openCardButton, false);
    visible(ui.loadError, false);
    visible(ui.retryImageButton, false);
    visible(ui.loadingState, true);
    visible(ui.keyboardCursor, false);
    visible(ui.mapHintMessage, false);
    visible(ui.previewBadge, preview);
    visible(ui.previewCardButton, preview);
    makeLevelGrid();
    refreshJourney(false);
    soundButtonState();
    updateFullscreenButton();
    updateClock();
    updateButtons();
    resizeScene();
    document.body.classList.remove("game-active", "route-panel-open");
    if (ui.startButton) focusSafely(ui.startButton);
    var firstIndex = nextIncomplete(-1);
    loadLevel(firstIndex === -1 ? 0 : firstIndex, false);
    if (preview && parameters.get("final") === "1") openFinal();
    root.setInterval(function () { updateClock(); refreshJourney(true); }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
