/* 닷 스틱 — 플레이 화면 시각 위계 재구성 (behavior)
   game-source.html / enhanced-stage.js는 그대로 두고, 이미 만들어진 요소들을
   재배치·재활용만 한다(이벤트 리스너가 걸린 원본 버튼은 절대 clone/replace하지
   않고 DOM 안에서 옮기기만 하므로 기존 동작은 그대로 유지된다). */
(function () {
  'use strict';

  var doc = document;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var built = false;

  function $(sel, root) { return (root || doc).querySelector(sel); }

  // ── 1) 남은 개수(.play-status)를 액션 카드(.play-action-group) 맨 위로 이동 ──
  function mergeStatusIntoAction() {
    var status = $('#screenPlay .play-status');
    var actionGroup = $('#screenPlay .play-action-group');
    if (!status || !actionGroup || status.parentElement === actionGroup) return;
    actionGroup.insertBefore(status, actionGroup.firstChild);
  }

  // ── 2) 상단 음성 컨트롤 3개를 "음성 설정" 드롭다운 메뉴로 통합 ──
  var voicePanel, voiceTrigger;

  function closeVoicePanel() {
    if (!voicePanel) return;
    voicePanel.classList.remove('is-open');
    if (voiceTrigger) voiceTrigger.setAttribute('aria-expanded', 'false');
  }

  function toggleVoicePanel() {
    if (!voicePanel) return;
    var willOpen = !voicePanel.classList.contains('is-open');
    voicePanel.classList.toggle('is-open', willOpen);
    if (voiceTrigger) voiceTrigger.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      var firstBtn = voicePanel.querySelector('button');
      if (firstBtn) firstBtn.focus();
    } else if (voiceTrigger) {
      voiceTrigger.focus();
    }
  }

  function buildVoiceMenu() {
    var slot = doc.getElementById('playVoiceSlot');
    var controls = $('#screenPlay .voice-controls') || $('.play-topbar .voice-controls');
    if (!slot || !controls || slot.querySelector('.sr-voice-trigger')) return false;

    slot.style.position = 'relative';

    voiceTrigger = doc.createElement('button');
    voiceTrigger.type = 'button';
    voiceTrigger.className = 'sr-voice-trigger';
    voiceTrigger.setAttribute('aria-haspopup', 'true');
    voiceTrigger.setAttribute('aria-expanded', 'false');
    voiceTrigger.textContent = '음성 설정';

    voicePanel = doc.createElement('div');
    voicePanel.className = 'sr-voice-panel';
    voicePanel.setAttribute('role', 'group');
    voicePanel.setAttribute('aria-label', '음성 설정');

    slot.appendChild(voiceTrigger);
    slot.appendChild(voicePanel);
    voicePanel.appendChild(controls); // 기존 3개 버튼을 그대로(리스너 유지) 패널 안으로 이동

    voiceTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleVoicePanel();
    });

    doc.addEventListener('click', function (e) {
      if (!voicePanel.classList.contains('is-open')) return;
      if (voicePanel.contains(e.target) || e.target === voiceTrigger) return;
      closeVoicePanel();
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && voicePanel.classList.contains('is-open')) closeVoicePanel();
    });

    return true;
  }

  // ── 3) 닷패드 미리보기 "크게 보기" 토글 ──
  var previewBackdrop;

  function closePreviewExpand(previewWrap, expandBtn) {
    previewWrap.classList.remove('is-expanded');
    if (previewBackdrop) previewBackdrop.classList.remove('is-open');
    if (expandBtn) {
      expandBtn.setAttribute('aria-expanded', 'false');
      expandBtn.textContent = '크게 보기';
    }
  }

  function buildPreviewExpand() {
    var previewWrap = $('#screenPlay .preview-wrap');
    var head = previewWrap && previewWrap.querySelector('.preview-head');
    if (!previewWrap || !head || head.querySelector('.sr-expand-btn')) return false;

    if (!previewBackdrop) {
      previewBackdrop = doc.createElement('div');
      previewBackdrop.className = 'sr-preview-backdrop';
      doc.body.appendChild(previewBackdrop);
    }

    var expandBtn = doc.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'sr-expand-btn';
    expandBtn.setAttribute('aria-expanded', 'false');
    expandBtn.textContent = '크게 보기';
    head.appendChild(expandBtn);

    expandBtn.addEventListener('click', function () {
      var willOpen = !previewWrap.classList.contains('is-expanded');
      previewWrap.classList.toggle('is-expanded', willOpen);
      previewBackdrop.classList.toggle('is-open', willOpen);
      expandBtn.setAttribute('aria-expanded', String(willOpen));
      expandBtn.textContent = willOpen ? '작게 보기' : '크게 보기';
      if (willOpen) previewWrap.focus && previewWrap.setAttribute('tabindex', '-1');
    });

    previewBackdrop.addEventListener('click', function () { closePreviewExpand(previewWrap, expandBtn); });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && previewWrap.classList.contains('is-expanded')) closePreviewExpand(previewWrap, expandBtn);
    });

    return true;
  }

  // ── 4) 확정 버튼에 선택값을 그대로 반영: "선택한 N개 가져가기" ──
  function updateConfirmLabel() {
    var takeBtn = doc.getElementById('takeBtn');
    var label = takeBtn && takeBtn.querySelector('span');
    if (!label) return;
    var c2 = doc.getElementById('choice2');
    var amount = c2 && c2.getAttribute('aria-pressed') === 'true' ? 2 : 1;
    label.textContent = '선택한 ' + amount + '개 가져가기';
  }

  function watchChoices() {
    ['choice1', 'choice2'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (!el || !window.MutationObserver) return;
      new MutationObserver(updateConfirmLabel).observe(el, { attributes: true, attributeFilter: ['aria-pressed'] });
    });
    updateConfirmLabel();
  }

  // ── 부팅: #screenPlay/#playVoiceSlot/.voice-controls/.preview-wrap이 실제로
  //         DOM에 준비될 때까지 몇 차례 재시도한다(enhanced-stage.js와 동일 패턴) ──
  function build() {
    var a = buildVoiceMenu();
    var b = buildPreviewExpand();
    mergeStatusIntoAction();
    if (doc.getElementById('choice1')) watchChoices();
    return a && b;
  }

  function boot() {
    if (build()) { built = true; return; }
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;
      if (build() || attempts > 40) window.clearInterval(timer);
    }, 100);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
