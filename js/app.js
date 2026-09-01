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
    var todos = MW.store.state.todos;
    var openTodos = todos.filter(function (t) { return !t.done; });
    var dated = todos.filter(function (t) { return t.date === today; });
    var habits = MW.habits.all();
    var doneHabits = habits.filter(function (h) { return MW.habits.isDone(h.id, today); });
    var sum = MW.ledger.summary(U.ym(new Date()));

    host.appendChild(el('div.stat-grid', {}, [
      el('div.stat', {}, [
        el('div.label', { text: '오늘 일정' }),
        el('div.value', { text: evs.length + '건' }),
        el('div.hint', { text: evs.length ? evs[0].title : '비어 있습니다' })
      ]),
      el('div.stat', {}, [
        el('div.label', { text: '남은 할 일' }),
        el('div.value', { text: openTodos.length + '개' }),
        el('div.hint', { text: '오늘 지정 ' + dated.length + '개' })
      ]),
      el('div.stat', {}, [
        el('div.label', { text: '오늘 해빗' }),
        el('div.value', { text: doneHabits.length + ' / ' + habits.length }),
        el('div.hint', { text: habits.length ? '체크는 캘린더에서' : '설정에서 추가해 주세요' })
      ]),
      el('div.stat.free', {}, [
        el('div.label', { text: '이번달 쓸 수 있는 돈' }),
        el('div.value' + (sum.free < 0 ? '.minus' : ''), { text: U.won(sum.free) }),
        el('div.hint', { text: '수입 ' + U.won(sum.income) + ' · 지출 ' + U.won(sum.expense) })
      ])
    ]));

    var evCard = el('div.card', {}, [
      el('h3', {}, ['오늘 일정 ', el('span.muted', { text: U.fmtLongDate(today) })]),
      evs.length ? el('div', {}, evs.map(function (ev) {
        return el('div.ev-row', { onclick: function () { MW.shell.go('calendar'); MW.calendar.goto(today); } }, [
          el('div.ev-bar', { style: { background: ev.color || '#6b8afd' } }),
          el('div.ev-main', {}, [
            el('div.ev-time', { text: ev.allDay || ev.start === null ? '종일' : U.fmtMin(ev.start) }),
            el('div.ev-title', { text: ev.title })
          ])
        ]);
      })) : el('div.empty', { text: '오늘 등록된 일정이 없습니다.' }),
      el('button.btn.btn-sm', {
        text: '캘린더 열기', style: { marginTop: '8px' },
        onclick: function () { MW.shell.go('calendar'); }
      })
    ]);

    var todoBox = el('div.todo-list');
    MW.todo.renderList(todoBox, {
      filter: function (t) { return !t.done && (t.date === today || !t.date); },
      draggable: false,
      emptyText: '지금 할 일이 없습니다.'
    });

    var todoCard = el('div.card', {}, [
      el('h3', {}, ['인박스 · 오늘 할 일']),
      todoBox,
      el('button.btn.btn-sm', {
        text: '투두 창 열기', style: { marginTop: '8px' },
        onclick: function () { MW.shell.floats.todo.open(); }
      })
    ]);

    host.appendChild(el('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px', alignItems: 'start' }
    }, [evCard, todoCard]));

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '오늘의 해빗' }),
      MW.habits.dayList(today)
    ]));
  }

  /* ------------------------------------------------------------ 리렌더 */

  var renderAll = U.debounce(function () {
    var route = MW.shell.route();
    if (route === 'home') renderHome();
    else if (route === 'calendar') MW.calendar.render();
    else if (route === 'ledger') MW.ledger.render();
    else if (route === 'settings') MW.settings.render();
    MW.goals.render();
    MW.todo.render();
    MW.memo.render();
    MW.music.render();
    MW.shell.syncFloatButtons();
  }, 40);

  /* ------------------------------------------------------------ 부팅 */

  function boot() {
    MW.store.load();

    MW.music.mount($('#musicbar'));
    MW.pomodoro.mount($('#pomo-slot'));
    MW.goals.mount($('#goals-slot'));
    MW.todo.init();
    MW.memo.init();
    MW.calendar.mount($('#page-calendar-body'));
    MW.ledger.mount($('#page-ledger-body'));
    MW.settings.mount($('#page-settings-body'));

    MW.shell.onRoute('home', renderHome);
    MW.shell.onRoute('calendar', function () { MW.calendar.render(); });
    MW.shell.onRoute('ledger', function () { MW.ledger.render(); });
    MW.shell.onRoute('settings', function () { MW.settings.render(); });
    MW.shell.init();

    MW.store.on(renderAll);
    renderHome();

    // 일정 알림 확인 (탭이 열려 있는 동안만 동작)
    setInterval(MW.calendar.checkNotifications, 30000);
    MW.calendar.checkNotifications();

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
