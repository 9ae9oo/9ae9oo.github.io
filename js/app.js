/* ==========================================================================
   MW.app — 부팅 / 홈 대시보드 / 전역 리렌더 연결
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el, $ = U.$;

  /* ------------------------------------------------------------ 홈 대시보드 */

  function renderHome() {
    var host = $('#page-home-body');
    if (!host) return;
    U.clear(host);

    var today = U.ymd(new Date());
    var evs = MW.calendar.eventsOn(today);
    var dayTodos = MW.calendar.todosOn(today).filter(function (t) { return !t.done; });
    var sum = MW.ledger.summary(U.ym(new Date()));

    // 홈 제목 = 오늘 날짜
    var titleEl = $('#home-title');
    if (titleEl) titleEl.textContent = U.fmtLongDate(today);

    var goToday = function () { MW.shell.go('calendar'); MW.calendar.goto(today); };

    // 1) 오늘 일정 — 오늘의 일정 + 날짜가 오늘인 할 일을 한 목록에 점으로 표시
    var rows = [];
    evs.forEach(function (ev) {
      rows.push(el('div.today-row', { onclick: goToday }, [
        el('span.today-dot', { style: { background: ev.color || '#6b8afd' } }),
        el('span.today-time', { text: ev.allDay || ev.start === null ? '종일' : U.fmtMin(ev.start) }),
        el('span.today-title', { text: ev.title })
      ]));
    });
    dayTodos.forEach(function (t) {
      rows.push(el('div.today-row', { onclick: goToday }, [
        el('span.today-dot', { style: { background: MW.todo.colorOf(t) } }),
        el('span.today-title', { text: t.title })
      ]));
    });

    var evCard = el('div.card', {}, [
      el('h3', { text: '오늘 일정' }),
      rows.length ? el('div.today-list', {}, rows) : el('div.empty', { text: '오늘 일정이 없습니다.' })
    ]);

    var todoBox = el('div.todo-list');
    MW.todo.renderList(todoBox, {
      filter: function (t) { return !t.done && !t.date; },
      draggable: false,
      emptyText: '지금 할 일이 없습니다.'
    });

    var todoCard = el('div.card', {}, [
      el('h3', { text: '인박스' }),
      todoBox
    ]);

    host.appendChild(el('div.home-cols', {}, [evCard, todoCard]));

    // 3) 해빗 트래커 — 칸이 넓은 홈에서는 이번 달 전체를 봅니다
    host.appendChild(el('div.card', {}, [
      el('h3', {}, [
        '해빗 트래커 ',
        el('span.muted', { text: U.ym(new Date()).replace('-', '년 ') + '월 · ' + MW.habitGrid.todaySummary() })
      ]),
      MW.habitGrid.monthGridNode(new Date())
    ]));

    // 4) 장부 한 줄 요약
    host.appendChild(el('div.card.home-money', {
      onclick: function () { MW.shell.go('ledger'); },
      title: '정산 장부로 이동'
    }, [
      el('span.label', { text: '이번 달 쓸 수 있는 돈' }),
      el('span.value' + (sum.free < 0 ? '.minus' : ''), { text: U.won(sum.free) }),
      el('span.small.dim', { text: '수입 ' + U.won(sum.income) + ' · 지출 ' + U.won(sum.expense) })
    ]));
  }

  /* ------------------------------------------------------------ 리렌더 */

  var renderAll = U.debounce(function () {
    var route = MW.shell.route();
    if (route === 'home') renderHome();
    else if (route === 'work') MW.work.render();
    else if (route === 'calendar') MW.calendar.render();
    else if (route === 'ledger') MW.ledger.render();
    else if (route === 'settings') MW.settings.render();
    MW.todo.render();
    MW.memo.render();
    MW.music.render();
    MW.pomodoro.renderMini();
    MW.habitGrid.renderAlarms();
    MW.shell.syncFloatButtons();
  }, 40);

  /* ------------------------------------------------------------ 부팅 */

  function boot() {
    MW.store.load();
    MW.shell.applyTheme();
    MW.store.on(function () { MW.shell.applyTheme(); });   // 색 변경은 렌더 지연 없이 바로 반영

    MW.music.mount($('#musicbar'));
    MW.pomodoro.init();
    MW.todo.init();
    MW.memo.init();
    MW.work.mount($('#page-work-body'));
    MW.calendar.mount($('#page-calendar-body'));
    MW.ledger.mount($('#page-ledger-body'));
    MW.settings.mount($('#page-settings-body'));

    MW.shell.onRoute('home', renderHome);
    MW.shell.onRoute('work', function () { MW.work.render(); });
    MW.shell.onRoute('calendar', function () { MW.calendar.render(); });
    MW.shell.onRoute('ledger', function () { MW.ledger.render(); });
    MW.shell.onRoute('settings', function () { MW.settings.render(); });
    MW.shell.init();

    MW.store.on(renderAll);
    renderHome();

    // 일정 알림 · 해빗 알람 확인 (탭이 열려 있는 동안만 동작)
    function tickAlarms() {
      MW.calendar.checkNotifications();
      MW.habitGrid.check();
    }
    setInterval(tickAlarms, 30000);
    tickAlarms();

    // 자정을 넘기면 "오늘"이 바뀌므로 다시 그림
    var day = U.ymd(new Date());
    setInterval(function () {
      var now = U.ymd(new Date());
      if (now !== day) { day = now; renderAll(); }
    }, 60000);

    // 닫기 전에 마지막 상태를 확실히 저장
    window.addEventListener('beforeunload', function () { MW.store.flush(); });

    window.addEventListener('resize', U.debounce(function () { MW.shell.syncFloatButtons(); }, 200));
  }

  MW.app = { boot: boot, renderHome: renderHome, renderAll: renderAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
