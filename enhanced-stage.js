(function () {
  'use strict';

  var doc = document;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stageRoot;
  var sticksRoot;
  var flash;
  var sparks;
  var lastCount = null;
  var heartbeatTimer = null;
  var audioContext = null;

  function getCount() {
    var node = doc.getElementById('countBig');
    var value = node ? parseInt(node.textContent, 10) : 0;
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function getSelectedAmount() {
    var selected = doc.querySelector('.choice[aria-pressed="true"]');
    return selected && selected.id === 'choice2' ? 2 : 1;
  }

  function isPlayersTurn() {
    var tag = doc.getElementById('turnTag');
    return !!tag && !tag.classList.contains('dot') && /당신|나의|내 차례/.test(tag.textContent || '');
  }

  function safeSpeak(text) {
    if (!text) return;
    try {
      if (typeof window.speak === 'function') {
        window.speak(text, { interrupt: true, liveText: text });
        return;
      }
    } catch (error) {}
    var live = doc.getElementById('liveRegion') || doc.querySelector('[aria-live]');
    if (live) live.textContent = text;
  }

  function ensureAudio() {
    if (audioContext) return audioContext;
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try { audioContext = new AudioCtor(); } catch (error) { return null; }
    return audioContext;
  }

  function tone(type) {
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'preview') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(650, now + .08);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.035, now + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
      osc.start(now); osc.stop(now + .13);
    } else if (type === 'take') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(820, now + .16);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.075, now + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .24);
      osc.start(now); osc.stop(now + .25);
    } else if (type === 'heartbeat') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(74, now);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.025, now + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
      osc.start(now); osc.stop(now + .17);
    }
  }

  function createStick(index) {
    var stick = doc.createElement('span');
    stick.className = 'light-stick';
    stick.setAttribute('aria-hidden', 'true');
    stick.style.setProperty('--delay', (-index * 173) + 'ms');
    stick.style.setProperty('--tilt', ((index % 3) - 1) * .7 + 'deg');
    stick.innerHTML = '<span class="light-stick__haze"></span>' +
      '<span class="light-stick__flame"></span>' +
      '<span class="light-stick__core"></span>' +
      '<span class="light-stick__base"></span>';
    return stick;
  }

  function renderSticks(count) {
    if (!sticksRoot) return;
    var current = sticksRoot.children.length;
    if (current === count) return;
    sticksRoot.textContent = '';
    for (var i = 0; i < count; i += 1) sticksRoot.appendChild(createStick(i));
    stageRoot.classList.toggle('is-last-light', count === 1);
    updatePreview();
  }

  function updatePreview() {
    if (!sticksRoot) return;
    var amount = getSelectedAmount();
    var count = sticksRoot.children.length;
    var canPreview = isPlayersTurn();
    Array.prototype.forEach.call(sticksRoot.children, function (stick, index) {
      stick.classList.toggle('is-preview', canPreview && index >= Math.max(0, count - amount));
    });
  }

  function announcePreview() {
    var count = getCount();
    var amount = Math.min(getSelectedAmount(), count);
    if (!isPlayersTurn() || count <= 0) return;
    var remaining = Math.max(0, count - amount);
    safeSpeak(amount + '개를 가져가면 ' + remaining + '개가 남습니다.');
    tone('preview');
  }

  function makeSparks() {
    if (!sparks || reducedMotion) return;
    sparks.textContent = '';
    for (var i = 0; i < 8; i += 1) {
      var spark = doc.createElement('span');
      spark.className = 'light-spark';
      spark.style.setProperty('--x', (42 + Math.random() * 16) + '%');
      spark.style.setProperty('--y', (44 + Math.random() * 18) + '%');
      spark.style.setProperty('--dx', (-55 + Math.random() * 110) + 'px');
      spark.style.setProperty('--dy', (-70 - Math.random() * 70) + 'px');
      sparks.appendChild(spark);
    }
    window.setTimeout(function () { if (sparks) sparks.textContent = ''; }, 800);
  }

  function animateTake() {
    if (!sticksRoot || !isPlayersTurn()) return;
    var amount = Math.min(getSelectedAmount(), sticksRoot.children.length);
    var nodes = Array.prototype.slice.call(sticksRoot.children).slice(-amount);
    nodes.forEach(function (node, index) {
      window.setTimeout(function () { node.classList.add('is-taking'); }, index * 55);
    });
    if (flash) {
      flash.classList.remove('is-active');
      void flash.offsetWidth;
      flash.classList.add('is-active');
    }
    makeSparks();
    tone('take');
    emitAccessibilityEvent('take', { amount: amount, remaining: Math.max(0, getCount() - amount) });
  }

  function emitAccessibilityEvent(type, detail) {
    var payload = { source: 'dotstick-stage', type: type, detail: detail || {} };
    try { window.dispatchEvent(new CustomEvent('dotstick:' + type, { detail: payload.detail })); } catch (error) {}
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*');
    } catch (error) {}
  }

  function syncTurn() {
    var tag = doc.getElementById('turnTag');
    if (!tag) return;
    if (tag.classList.contains('dot')) {
      tag.textContent = '탐험가 닷이 고민 중';
      stageRoot.setAttribute('data-turn', 'dot');
    } else {
      stageRoot.setAttribute('data-turn', 'player');
    }
    updatePreview();
  }

  function stopHeartbeat() {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function syncHeartbeat(count) {
    stopHeartbeat();
    stageRoot.classList.toggle('is-last-light', count === 1);
    if (count !== 1 || reducedMotion) return;
    tone('heartbeat');
    emitAccessibilityEvent('last-light-pulse', { remaining: 1 });
    heartbeatTimer = window.setInterval(function () {
      if (getCount() !== 1) return stopHeartbeat();
      tone('heartbeat');
      emitAccessibilityEvent('last-light-pulse', { remaining: 1 });
    }, 2400);
  }

  function syncCount() {
    var count = getCount();
    if (count === lastCount) return;
    lastCount = count;
    window.setTimeout(function () {
      renderSticks(count);
      syncHeartbeat(count);
    }, 360);
  }

  function observeText(node, callback) {
    if (!node || !window.MutationObserver) return;
    new MutationObserver(callback).observe(node, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function bindChoices() {
    ['choice1', 'choice2'].forEach(function (id) {
      var button = doc.getElementById(id);
      if (!button) return;
      button.addEventListener('mouseenter', updatePreview);
      button.addEventListener('focus', function () { updatePreview(); announcePreview(); });
      button.addEventListener('click', updatePreview);
    });
  }

  function buildStage() {
    var play = doc.getElementById('screenPlay');
    var host = play && play.querySelector('.stage');
    var preview = host && host.querySelector('.preview-wrap');
    if (!host || !preview || host.querySelector('.light-stage')) return false;

    stageRoot = doc.createElement('section');
    stageRoot.className = 'light-stage';
    stageRoot.setAttribute('aria-label', '남은 빛의 스틱 무대');
    stageRoot.innerHTML = '<span class="light-stage__label">LAST LIGHT STAGE</span>' +
      '<div class="light-sticks" aria-hidden="true"></div>' +
      '<span class="light-stage__floor" aria-hidden="true"></span>' +
      '<span class="light-stage__flash" aria-hidden="true"></span>' +
      '<span class="light-sparks" aria-hidden="true"></span>';
    host.insertBefore(stageRoot, preview);
    sticksRoot = stageRoot.querySelector('.light-sticks');
    flash = stageRoot.querySelector('.light-stage__flash');
    sparks = stageRoot.querySelector('.light-sparks');

    renderSticks(getCount());
    syncTurn();
    bindChoices();

    var takeButton = doc.getElementById('takeBtn');
    if (takeButton) takeButton.addEventListener('click', animateTake, true);

    observeText(doc.getElementById('countBig'), syncCount);
    observeText(doc.getElementById('turnTag'), syncTurn);

    var status = doc.getElementById('statusLine');
    observeText(status, function () {
      if (!status) return;
      status.style.animation = 'none';
      void status.offsetWidth;
      status.style.animation = '';
    });

    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) stopHeartbeat();
      else syncHeartbeat(getCount());
    });

    return true;
  }

  function boot() {
    if (buildStage()) return;
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (buildStage() || attempts > 40) window.clearInterval(timer);
    }, 100);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
