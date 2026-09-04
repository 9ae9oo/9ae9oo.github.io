/* ==========================================================================
   MW.pomodoro — Timer 도킹 패널
   뽀모도로 · 알람시계 · 카운트다운 · 스톱워치를 한 패널에서 제공합니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var panel = null;
  var floating = null;
  var modeHost = null;
  var activeMode = 'pomodoro';
  var activeSurface = 'panel';
  var MODES = [
    { id: 'pomodoro', label: '뽀모도로' },
    { id: 'alarm', label: '알람' },
    { id: 'countdown', label: '타이머' },
    { id: 'stopwatch', label: '스톱워치' }
  ];

  function fmtHms(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    return U.pad2(h) + ':' + U.pad2(m) + ':' + U.pad2(s);
  }

  function fmtStopwatch(ms) {
    ms = Math.max(0, Math.floor(ms || 0));
    var tenths = Math.floor((ms % 1000) / 100);
    var seconds = Math.floor(ms / 1000);
    return fmtHms(seconds) + '.' + tenths;
  }

  function alertUser(title, message) {
    MW.shell.playSound('end-alarm');
    MW.shell.notify(title, message);
    U.toast(message);
  }

  function pauseOtherMainTimers(except) {
    if (except !== 'pomodoro' && pomoRunning) pomoPause();
    if (except !== 'countdown' && countdownRunning) countdownPause();
    if (except !== 'stopwatch' && stopwatchRunning) stopwatchPause();
  }

  function syncDocumentTitle() {
    if (pomoRunning) {
      document.title = U.fmtClock(pomoRemaining) + ' · ' + POMO_LABEL[pomoSession] + ' — Creator Workspace';
    } else if (countdownRunning) {
      document.title = fmtHms(countdownRemaining) + ' · 타이머 — Creator Workspace';
    } else if (stopwatchRunning) {
      document.title = fmtStopwatch(stopwatchElapsed) + ' · 스톱워치 — Creator Workspace';
    } else {
      document.title = 'Creator Workspace';
    }
  }

  /* ------------------------------------------------------------ 뽀모도로 */

  var POMO_LABEL = { work: '집중', shortBreak: '짧은 휴식', longBreak: '긴 휴식' };
  var R = 72, C = 2 * Math.PI * R;
  var pomoSession = 'work';
  var pomoCount = 1;
  var pomoRemaining = null;
  var pomoRunning = false;
  var pomoDeadline = null;
  var pomoTicker = null;
  var pomoUi = {};

  function pomoConf() { return MW.store.state.pomodoro; }

  function pomoTotal() {
    var c = pomoConf();
    return (pomoSession === 'work' ? c.work : pomoSession === 'shortBreak' ? c.shortBreak : c.longBreak) * 60;
  }

  function pomoSync() {
    if (!pomoRunning || pomoDeadline === null) return;
    pomoRemaining = Math.max(0, Math.ceil((pomoDeadline - Date.now()) / 1000));
  }

  function pomoStart() {
    if (pomoRunning) return;
    pauseOtherMainTimers('pomodoro');
    if (pomoRemaining === null) pomoRemaining = pomoTotal();
    pomoRunning = true;
    pomoDeadline = Date.now() + pomoRemaining * 1000;
    pomoTicker = setInterval(pomoTick, 1000);
    updatePomodoro();
  }

  function pomoPause() {
    if (pomoRunning) pomoSync();
    pomoRunning = false;
    clearInterval(pomoTicker);
    pomoTicker = null;
    pomoDeadline = null;
    updatePomodoro();
  }

  function pomoReset() {
    pomoPause();
    pomoSession = 'work';
    pomoCount = 1;
    pomoRemaining = pomoTotal();
    updatePomodoro();
  }

  function pomoTick() {
    if (!pomoRunning) return;
    pomoSync();
    if (pomoRemaining <= 0) {
      pomoNext(true);
      return;
    }
    updatePomodoro();
  }

  function pomoNext(auto) {
    pomoPause();
    var c = pomoConf();
    var finished = pomoSession;
    if (pomoSession === 'work') {
      if (pomoCount >= c.repeat) {
        pomoSession = 'longBreak';
        pomoCount = 1;
      } else {
        pomoSession = 'shortBreak';
        pomoCount += 1;
      }
    } else {
      pomoSession = 'work';
    }
    pomoRemaining = pomoTotal();
    updatePomodoro();
    if (auto) {
      alertUser(POMO_LABEL[finished] + ' 완료', POMO_LABEL[pomoSession] + ' 시간입니다.');
      if (pomoConf().autoNext) pomoStart();
    }
  }

  function pomoSvg() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 168 168');
    var track = document.createElementNS(ns, 'circle');
    track.setAttribute('class', 'track');
    track.setAttribute('cx', '84');
    track.setAttribute('cy', '84');
    track.setAttribute('r', R);
    var bar = document.createElementNS(ns, 'circle');
    bar.setAttribute('class', 'bar');
    bar.setAttribute('cx', '84');
    bar.setAttribute('cy', '84');
    bar.setAttribute('r', R);
    svg.appendChild(track);
    svg.appendChild(bar);
    pomoUi.bar = bar;
    return svg;
  }

  function updatePomodoro() {
    if (pomoRemaining === null) pomoRemaining = pomoTotal();
    if (pomoUi.time) {
      var total = pomoTotal();
      var ratio = total > 0 ? U.clamp(pomoRemaining / total, 0, 1) : 0;
      pomoUi.time.textContent = U.fmtClock(pomoRemaining);
      pomoUi.session.textContent = POMO_LABEL[pomoSession];
      pomoUi.count.textContent = pomoCount + ' / ' + pomoConf().repeat;
      pomoUi.bar.style.strokeDasharray = C;
      pomoUi.bar.style.strokeDashoffset = C * (1 - ratio);
      pomoUi.ring.classList.toggle('work', pomoSession === 'work');
      pomoUi.ring.classList.toggle('short', pomoSession === 'shortBreak');
      pomoUi.ring.classList.toggle('long', pomoSession === 'longBreak');
      pomoUi.play.textContent = pomoRunning ? '❚❚' : '▶';
      pomoUi.play.title = pomoRunning ? '일시정지' : '시작';
    }
    syncDocumentTitle();
  }

  function renderPomodoro() {
    U.clear(modeHost);
    pomoUi = {};
    pomoUi.ring = el('div.pomo-ring');
    pomoUi.ring.appendChild(pomoSvg());
    pomoUi.session = el('div.pomo-session');
    pomoUi.time = el('div.pomo-time');
    pomoUi.count = el('div.pomo-count');
    pomoUi.ring.appendChild(el('div.pomo-center', {}, [pomoUi.session, pomoUi.time, pomoUi.count]));
    pomoUi.play = el('button.btn.btn-icon.main', {
      title: '시작',
      onclick: function () { pomoRunning ? pomoPause() : pomoStart(); }
    });
    var buttons = el('div.pomo-btns', {}, [
      el('button.btn.btn-icon', { text: '↺', title: '처음으로', onclick: pomoReset }),
      pomoUi.play,
      el('button.btn.btn-icon.pomo-next', { text: '⏭', title: '다음 세션', onclick: function () { pomoNext(false); } })
    ]);
    var auto = el('label.pomo-auto', {}, [
      el('input', {
        type: 'checkbox',
        checked: !!pomoConf().autoNext,
        onchange: function () {
          var value = this.checked;
          MW.store.update(function (s) { s.pomodoro.autoNext = value; });
        }
      }),
      el('span', { text: '자동 다음 세션' })
    ]);
    modeHost.appendChild(el('div.pomo', {}, [pomoUi.ring, buttons, auto]));
    updatePomodoro();
  }

  /* -------------------------------------------------------------- 알람 */

  var alarmTime = '';
  var alarmArmed = false;
  var alarmAt = null;
  var alarmTicker = null;
  var alarmUi = {};

  function defaultAlarmTime() {
    var d = new Date(Date.now() + 5 * 60000);
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  }

  function alarmToggle() {
    if (alarmArmed) {
      alarmArmed = false;
      alarmAt = null;
      clearInterval(alarmTicker);
      alarmTicker = null;
      updateAlarm();
      return;
    }
    alarmTime = alarmUi.input ? alarmUi.input.value : alarmTime;
    var parts = String(alarmTime || '').split(':');
    if (parts.length !== 2) {
      U.toast('알람 시각을 선택해 주세요.', 'warn');
      return;
    }
    var when = new Date();
    when.setHours(+parts[0], +parts[1], 0, 0);
    if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
    alarmAt = when.getTime();
    alarmArmed = true;
    alarmTicker = setInterval(alarmTick, 1000);
    updateAlarm();
  }

  function alarmTick() {
    if (!alarmArmed || alarmAt === null) return;
    if (alarmAt - Date.now() <= 0) {
      alarmArmed = false;
      clearInterval(alarmTicker);
      alarmTicker = null;
      alarmAt = null;
      updateAlarm();
      alertUser('알람', alarmTime + ' 알람입니다.');
      return;
    }
    updateAlarm();
  }

  function updateAlarm() {
    if (!alarmUi.display) return;
    var left = alarmArmed && alarmAt !== null ? Math.ceil((alarmAt - Date.now()) / 1000) : 0;
    alarmUi.display.textContent = alarmArmed ? fmtHms(left) : '--:--:--';
    alarmUi.status.textContent = alarmArmed
      ? new Date(alarmAt).toLocaleString('ko-KR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + '에 울립니다'
      : '시각을 정한 뒤 알람을 켜세요.';
    alarmUi.input.disabled = alarmArmed;
    alarmUi.button.textContent = alarmArmed ? '알람 끄기' : '알람 켜기';
    alarmUi.button.classList.toggle('btn-primary', !alarmArmed);
  }

  function renderAlarm() {
    U.clear(modeHost);
    if (!alarmTime) alarmTime = defaultAlarmTime();
    alarmUi = {};
    alarmUi.display = el('div.timer-display');
    alarmUi.status = el('div.timer-status');
    alarmUi.input = el('input.field.timer-alarm-input', {
      type: 'time',
      value: alarmTime,
      onchange: function () { alarmTime = this.value; }
    });
    alarmUi.button = el('button.btn', { onclick: alarmToggle });
    modeHost.appendChild(el('div.timer-tool', {}, [
      el('div.timer-tool-title', { text: '알람시계' }),
      alarmUi.display,
      alarmUi.status,
      el('div.timer-alarm-row', {}, [alarmUi.input, alarmUi.button])
    ]));
    updateAlarm();
  }

  /* -------------------------------------------------------- 카운트다운 */

  var countdownBase = 5 * 60;
  var countdownRemaining = countdownBase;
  var countdownRunning = false;
  var countdownDeadline = null;
  var countdownTicker = null;
  var countdownUi = {};

  function countdownSync() {
    if (!countdownRunning || countdownDeadline === null) return;
    countdownRemaining = Math.max(0, Math.ceil((countdownDeadline - Date.now()) / 1000));
  }

  function readCountdownInputs() {
    if (!countdownUi.hours) return countdownBase;
    var h = U.clamp(Math.floor(+countdownUi.hours.value || 0), 0, 99);
    var m = U.clamp(Math.floor(+countdownUi.minutes.value || 0), 0, 59);
    var s = U.clamp(Math.floor(+countdownUi.seconds.value || 0), 0, 59);
    countdownUi.hours.value = h;
    countdownUi.minutes.value = m;
    countdownUi.seconds.value = s;
    countdownBase = h * 3600 + m * 60 + s;
    if (!countdownRunning) countdownRemaining = countdownBase;
    updateCountdown();
    return countdownBase;
  }

  function countdownStart() {
    if (countdownRunning) return;
    pauseOtherMainTimers('countdown');
    if (countdownRemaining <= 0) countdownRemaining = readCountdownInputs();
    if (countdownRemaining <= 0) {
      U.toast('카운트다운 시간을 입력해 주세요.', 'warn');
      return;
    }
    countdownRunning = true;
    countdownDeadline = Date.now() + countdownRemaining * 1000;
    countdownTicker = setInterval(countdownTick, 1000);
    updateCountdown();
  }

  function countdownPause() {
    if (countdownRunning) countdownSync();
    countdownRunning = false;
    clearInterval(countdownTicker);
    countdownTicker = null;
    countdownDeadline = null;
    updateCountdown();
  }

  function countdownReset() {
    countdownPause();
    countdownRemaining = countdownBase;
    updateCountdown();
  }

  function countdownTick() {
    if (!countdownRunning) return;
    countdownSync();
    if (countdownRemaining <= 0) {
      countdownRunning = false;
      clearInterval(countdownTicker);
      countdownTicker = null;
      countdownDeadline = null;
      countdownRemaining = 0;
      updateCountdown();
      alertUser('타이머 완료', '카운트다운이 끝났습니다.');
      return;
    }
    updateCountdown();
  }

  function updateCountdown() {
    if (countdownUi.display) {
      countdownUi.display.textContent = fmtHms(countdownRemaining);
      countdownUi.play.textContent = countdownRunning ? '❚❚' : '▶';
      countdownUi.play.title = countdownRunning ? '일시정지' : '시작';
      [countdownUi.hours, countdownUi.minutes, countdownUi.seconds].forEach(function (input) {
        input.disabled = countdownRunning;
      });
    }
    syncDocumentTitle();
  }

  function renderCountdown() {
    U.clear(modeHost);
    countdownUi = {};
    var h = Math.floor(countdownBase / 3600);
    var m = Math.floor((countdownBase % 3600) / 60);
    var s = countdownBase % 60;
    countdownUi.display = el('div.timer-display');
    countdownUi.hours = el('input.field', { type: 'number', min: '0', max: '99', value: h, onchange: readCountdownInputs });
    countdownUi.minutes = el('input.field', { type: 'number', min: '0', max: '59', value: m, onchange: readCountdownInputs });
    countdownUi.seconds = el('input.field', { type: 'number', min: '0', max: '59', value: s, onchange: readCountdownInputs });
    countdownUi.play = el('button.btn.btn-primary.btn-icon.timer-main-btn', {
      title: '시작',
      onclick: function () { countdownRunning ? countdownPause() : countdownStart(); }
    });
    modeHost.appendChild(el('div.timer-tool', {}, [
      el('div.timer-tool-title', { text: '카운트다운' }),
      countdownUi.display,
      el('div.timer-duration-inputs', {}, [
        el('label', {}, [countdownUi.hours, el('span', { text: '시' })]),
        el('label', {}, [countdownUi.minutes, el('span', { text: '분' })]),
        el('label', {}, [countdownUi.seconds, el('span', { text: '초' })])
      ]),
      el('div.timer-actions', {}, [
        el('button.btn.btn-icon', { text: '↺', title: '초기화', onclick: countdownReset }),
        countdownUi.play
      ])
    ]));
    updateCountdown();
  }

  /* ---------------------------------------------------------- 스톱워치 */

  var stopwatchElapsed = 0;
  var stopwatchRunning = false;
  var stopwatchStartedAt = null;
  var stopwatchTicker = null;
  var stopwatchUi = {};

  function stopwatchSync() {
    if (stopwatchRunning && stopwatchStartedAt !== null) {
      stopwatchElapsed = Math.max(0, Date.now() - stopwatchStartedAt);
    }
  }

  function stopwatchStart() {
    if (stopwatchRunning) return;
    pauseOtherMainTimers('stopwatch');
    stopwatchRunning = true;
    stopwatchStartedAt = Date.now() - stopwatchElapsed;
    stopwatchTicker = setInterval(stopwatchTick, 100);
    updateStopwatch();
  }

  function stopwatchPause() {
    stopwatchSync();
    stopwatchRunning = false;
    clearInterval(stopwatchTicker);
    stopwatchTicker = null;
    stopwatchStartedAt = null;
    updateStopwatch();
  }

  function stopwatchReset() {
    stopwatchPause();
    stopwatchElapsed = 0;
    updateStopwatch();
  }

  function stopwatchTick() {
    if (!stopwatchRunning) return;
    stopwatchSync();
    updateStopwatch();
  }

  function updateStopwatch() {
    if (stopwatchUi.display) {
      stopwatchUi.display.textContent = fmtStopwatch(stopwatchElapsed);
      stopwatchUi.play.textContent = stopwatchRunning ? '❚❚' : '▶';
      stopwatchUi.play.title = stopwatchRunning ? '일시정지' : '시작';
    }
    syncDocumentTitle();
  }

  function renderStopwatch() {
    U.clear(modeHost);
    stopwatchUi = {};
    stopwatchUi.display = el('div.timer-display.timer-stopwatch-display');
    stopwatchUi.play = el('button.btn.btn-primary.btn-icon.timer-main-btn', {
      title: '시작',
      onclick: function () { stopwatchRunning ? stopwatchPause() : stopwatchStart(); }
    });
    modeHost.appendChild(el('div.timer-tool', {}, [
      el('div.timer-tool-title', { text: '스톱워치' }),
      stopwatchUi.display,
      el('div.timer-actions', {}, [
        el('button.btn.btn-icon', { text: '↺', title: '초기화', onclick: stopwatchReset }),
        stopwatchUi.play
      ])
    ]));
    updateStopwatch();
  }

  /* ------------------------------------------------------------ 패널 */

  function renderMode() {
    if (!modeHost) return;
    if (activeMode === 'alarm') renderAlarm();
    else if (activeMode === 'countdown') renderCountdown();
    else if (activeMode === 'stopwatch') renderStopwatch();
    else renderPomodoro();
  }

  function renderSuite(container, surface) {
    activeSurface = surface;
    U.clear(container);
    var surfaceButton = el('button.btn.btn-sm.timer-surface-btn', {
      type: 'button',
      text: surface === 'panel' ? '↗ 플로팅으로 분리' : '⇥ 고정 패널로',
      onclick: surface === 'panel' ? openFloating : dockTimer
    });
    container.appendChild(el('div.timer-surface-actions', {}, [surfaceButton]));
    var tabs = el('div.tabs.timer-tabs', {}, MODES.map(function (mode) {
      return el('button.tab' + (activeMode === mode.id ? '.active' : ''), {
        type: 'button',
        text: mode.label,
        onclick: function () {
          activeMode = mode.id;
          renderSuite(container, surface);
        }
      });
    }));
    modeHost = el('div.timer-mode');
    container.appendChild(tabs);
    container.appendChild(modeHost);
    renderMode();
  }

  function renderPanel() {
    if (panel) renderSuite(panel.body, 'panel');
  }

  function renderFloating() {
    if (!floating) return;
    renderSuite(floating.body, 'float');
    syncFloatingLayout();
  }

  function openFloating() {
    if (!floating) return;
    if (panel && panel.isOpen()) panel.close();
    floating.open();
  }

  function dockTimer() {
    if (floating && floating.isOpen()) floating.close();
    if (panel) panel.open();
  }

  function syncFloatingLayout() {
    if (!floating) return;
    var w = floating.node.offsetWidth || 360;
    var h = floating.node.offsetHeight || 480;
    var narrow = window.matchMedia('(max-width: 640px)').matches;
    floating.node.classList.toggle('timer-compact', !narrow && (w < 260 || h < 200));
  }

  function catchUp() {
    if (pomoRunning) pomoTick();
    if (alarmArmed) alarmTick();
    if (countdownRunning) countdownTick();
    if (stopwatchRunning) stopwatchTick();
  }

  function renderMini() {
    var trigger = document.getElementById('timer-trigger');
    if (trigger) trigger.title = 'Timer';
  }

  function init() {
    panel = MW.shell.registerPanel('timer', {
      title: 'Timer',
      onOpen: function () {
        if (floating && floating.isOpen()) floating.close();
        renderPanel();
      }
    });
    floating = MW.shell.registerFloat('timer-float', {
      title: 'Timer',
      rect: { x: Math.max(72, window.innerWidth - 440), y: 96, w: 360, h: 480 },
      minW: 112,
      minH: 84,
      dragBodyWhen: function (node) { return node.classList.contains('timer-compact'); },
      onResize: syncFloatingLayout,
      onOpen: renderFloating
    });
    if (window.ResizeObserver) {
      new ResizeObserver(syncFloatingLayout).observe(floating.node);
    } else {
      window.addEventListener('resize', syncFloatingLayout);
    }
    renderMini();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) catchUp();
    });
    window.addEventListener('focus', catchUp);
  }

  MW.pomodoro = {
    init: init,
    mount: function (container) {
      modeHost = container;
      renderPomodoro();
    },
    renderMini: renderMini,
    open: function () { if (panel) panel.open(); },
    refresh: function () {
      if (!pomoRunning) pomoRemaining = pomoTotal();
      updatePomodoro();
    },
    state: function () {
      return {
        session: pomoSession,
        count: pomoCount,
        remaining: pomoRemaining,
        running: pomoRunning
      };
    }
  };
})();
