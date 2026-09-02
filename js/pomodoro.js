/* ==========================================================================
   MW.pomodoro — 뽀모도로 타이머 (플로팅 위젯 + 상단바 미니 표시)
   legacy/app/pomodoro.py 의 PomodoroTimer 세션 전환 로직을 그대로 옮겼습니다.
   (작업 → 마지막 회차면 긴 휴식, 아니면 짧은 휴식 → 다시 작업)
   원형 게이지는 QPainter drawPie 대신 SVG stroke-dasharray 로 그립니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var LABEL = { work: '집중', shortBreak: '짧은 휴식', longBreak: '긴 휴식' };
  var R = 72, C = 2 * Math.PI * R;

  var session = 'work';
  var count = 1;
  var remaining = null;      // 초
  var running = false;
  var ticker = null;
  var ui = {};

  function conf() { return MW.store.state.pomodoro; }
  function total() {
    var c = conf();
    return (session === 'work' ? c.work : session === 'shortBreak' ? c.shortBreak : c.longBreak) * 60;
  }

  function start() {
    if (running) return;
    running = true;
    ticker = setInterval(tick, 1000);
    render();
  }

  function pause() {
    running = false;
    clearInterval(ticker);
    ticker = null;
    render();
  }

  function reset() {
    pause();
    session = 'work';
    count = 1;
    remaining = total();
    render();
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) { next(true); return; }
    render();
  }

  /** 세션 전환. auto=true 면 시간이 다 되어 자동 전환된 경우 */
  function next(auto) {
    pause();                                   // 파이썬 원본과 동일하게 전환 시 일시정지
    var c = conf();
    var finished = session;
    if (session === 'work') {
      if (count >= c.repeat) { session = 'longBreak'; count = 1; }
      else { session = 'shortBreak'; count += 1; }
    } else {
      session = 'work';
    }
    remaining = total();
    render();
    if (auto) {
      MW.shell.playSound(finished === 'work' ? 'end-alarm' : 'start-alarm');
      MW.shell.notify(
        LABEL[finished] + ' 완료',
        LABEL[session] + ' 시간입니다 (' + Math.round(total() / 60) + '분)'
      );
      U.toast(LABEL[finished] + ' 완료 → ' + LABEL[session]);
      if (conf().autoNext) start();          // 자동 다음 세션
    }
  }

  function render() {
    renderMini();
    if (!ui.time) return;
    if (remaining === null) remaining = total();
    var t = total();
    var ratio = t > 0 ? U.clamp(remaining / t, 0, 1) : 0;

    ui.time.textContent = U.fmtClock(remaining);
    ui.session.textContent = LABEL[session];
    ui.count.textContent = count + ' / ' + conf().repeat;
    ui.bar.style.strokeDasharray = C;
    ui.bar.style.strokeDashoffset = C * (1 - ratio);
    // className 을 통째로 갈아끼우면 compact 클래스가 지워지므로 개별 토글합니다
    ui.ring.classList.toggle('work', session === 'work');
    ui.ring.classList.toggle('short', session === 'shortBreak');
    ui.ring.classList.toggle('long', session === 'longBreak');
    ui.play.textContent = running ? '❚❚' : '▶';
    ui.play.title = running ? '일시정지' : '시작';
    document.title = running ? U.fmtClock(remaining) + ' · ' + LABEL[session] + ' — Creator Workspace' : 'Creator Workspace';
  }

  function svgRing() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    // 크기는 .pomo-ring 컨테이너(--pomo-scale)가 결정하고, viewBox 로 좌표를 맞춥니다.
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.setAttribute('viewBox', '0 0 168 168');
    var track = document.createElementNS(ns, 'circle');
    track.setAttribute('class', 'track'); track.setAttribute('cx', '84'); track.setAttribute('cy', '84'); track.setAttribute('r', R);
    var bar = document.createElementNS(ns, 'circle');
    bar.setAttribute('class', 'bar'); bar.setAttribute('cx', '84'); bar.setAttribute('cy', '84'); bar.setAttribute('r', R);
    svg.appendChild(track); svg.appendChild(bar);
    ui.bar = bar;
    return svg;
  }

  /** 상단바 뽀모도로 버튼의 남은시간 표시 — 패널을 닫아도 시간이 보이도록 */
  function renderMini() {
    if (remaining === null) remaining = total();
    var time = U.fmtClock(remaining);

    var trigger = document.getElementById('pomodoro-trigger');
    if (trigger) {
      var t = trigger.querySelector('.tp-time');
      if (t) t.textContent = time;
      trigger.classList.toggle('running', running);
      trigger.title = LABEL[session] + ' ' + time + (running ? ' (진행 중)' : ' (멈춤)');
    }

    /* 다른 곳(예: 홈 카드)에 뽀모도로 미니 표시가 있으면 함께 갱신 */
    document.querySelectorAll('[data-pomo-time]').forEach(function (n) { n.textContent = time; });
  }

  function mount(container) {
    U.clear(container);
    ui = {};
    ui.ring = el('div.pomo-ring');
    ui.ring.appendChild(svgRing());
    ui.session = el('div.pomo-session');
    ui.time = el('div.pomo-time');
    ui.count = el('div.pomo-count');
    ui.ring.appendChild(el('div.pomo-center', {}, [ui.session, ui.time, ui.count]));

    ui.play = el('button.btn.btn-icon.main', { onclick: function () { running ? pause() : start(); } });

    var btns = el('div.pomo-btns', {}, [
      el('button.btn.btn-icon', { text: '↺', title: '처음으로', onclick: reset }),
      ui.play,
      el('button.btn.btn-icon', { text: '⏭', title: '다음 세션', onclick: function () { next(false); } })
    ]);

    // 자동 다음 세션 — 세션이 끝나면 멈추지 않고 바로 이어서 시작합니다
    var autoRow = el('label.pomo-auto', { title: '세션이 끝나면 다음 세션을 자동으로 시작합니다' }, [
      el('input', {
        type: 'checkbox', checked: !!conf().autoNext,
        onchange: function () {
          var v = this.checked;
          MW.store.update(function (s) { s.pomodoro.autoNext = v; });
        }
      }),
      el('span', { text: '자동 다음 세션' })
    ]);

    // 시간 설정은 설정 → “시간 · 해빗” 탭에서 합니다
    container.appendChild(el('div.pomo', {}, [ui.ring, btns, autoRow]));
    if (remaining === null) remaining = total();
    render();
  }

  /* ---------------------------------------------------- 플로팅 창 */

  var float = null;

  function pinned() { return !!(MW.store.state.settings && MW.store.state.settings.pomoPinned); }
  function setPinned(v) { MW.store.update(function (s) { s.settings.pomoPinned = !!v; }); }

  /** 창 너비에 맞춰 링·글자·버튼이 함께 커지도록 --pomo-scale 갱신 (넘치면 float-body 가 스크롤) */
  function syncScale() {
    if (!float) return;
    var w = float.node.offsetWidth || 360;
    var s = U.clamp((w - 24) / 280, 0.8, 2.6);
    float.node.style.setProperty('--pomo-scale', Math.round(s * 100) / 100);
  }

  function init() {
    float = MW.shell.registerFloat('pomodoro', {
      title: '🍅 뽀모도로',
      rect: { x: Math.max(72, window.innerWidth - 440), y: 96, w: 360, h: 480 },
      headExtra: (function () {
        return el('label.float-pin', { title: '앱을 열 때 자동으로 띄웁니다' }, [
          el('input', {
            type: 'checkbox', checked: pinned(),
            onchange: function () { setPinned(this.checked); }
          }),
          el('span', { text: '자동' })
        ]);
      })(),
      onOpen: function (api) { mount(api.body); syncScale(); }
    });

    if (window.ResizeObserver) {
      new ResizeObserver(syncScale).observe(float.node);
    } else {
      window.addEventListener('resize', syncScale);
    }

    renderMini();
    if (pinned()) float.open();
  }

  MW.pomodoro = {
    init: init,
    mount: mount,
    renderMini: renderMini,
    open: function () { if (float) float.open(); },
    /** 설정 페이지에서 시간 값이 바뀌었을 때 다시 그리기 위해 */
    refresh: function () { if (ui.time) { if (!running) remaining = total(); render(); } },
    state: function () { return { session: session, count: count, remaining: remaining, running: running }; }
  };
})();
