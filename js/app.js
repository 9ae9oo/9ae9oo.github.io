/* ==========================================================================
   MW.app — 부팅 / 홈 대시보드 / 전역 리렌더 연결
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el, $ = U.$;

  /* ------------------------------------------------------------ 홈 대시보드 */

  // 홈 미니 달력의 현재 월/선택일 (리렌더 사이에 유지)
  var homeCal = { cursor: new Date(), sel: U.ymd(new Date()) };

  /** 그 날의 일정 + (날짜가 붙은) 할 일을 점 목록용으로 모읍니다 */
  function itemsOn(day) {
    var out = MW.calendar.eventsOn(day).map(function (ev) {
      return { color: ev.color || '#6b8afd', title: ev.title, time: ev.allDay || ev.start === null ? '종일' : U.fmtMin(ev.start) };
    });
    MW.calendar.todosOn(day).filter(function (t) { return !t.done; }).forEach(function (t) {
      out.push({ color: MW.todo.colorOf(t), title: t.title, time: '' });
    });
    return out;
  }

  /** 이미지 형식의 오늘 일정 카드 — 미니 월 달력 + 선택한 날의 목록 */
  function eventCalendarCard() {
    var cur = homeCal.cursor;
    var y = cur.getFullYear(), m = cur.getMonth();
    var todayYmd = U.ymd(new Date());

    var head = el('div.mini-cal-head', {}, [
      el('span.mini-cal-title', { text: y + '년 ' + (m + 1) + '월' }),
      el('div.mini-cal-nav', {}, [
        el('button', { text: '‹', title: '이전 달', onclick: function () { homeCal.cursor = new Date(y, m - 1, 1); renderHome(); } }),
        el('button', { text: '오늘', onclick: function () { homeCal.cursor = new Date(); homeCal.sel = todayYmd; renderHome(); } }),
        el('button', { text: '›', title: '다음 달', onclick: function () { homeCal.cursor = new Date(y, m + 1, 1); renderHome(); } })
      ])
    ]);

    var dow = el('div.mini-cal-dow', {}, U.weekdayNames().map(function (w) {
      return el('span' + (w === '일' ? '.sun' : w === '토' ? '.sat' : ''), { text: w });
    }));

    var grid = el('div.mini-cal-grid', {}, U.monthGrid(y, m).map(function (d) {
      var dYmd = U.ymd(d);
      var dots = itemsOn(dYmd).slice(0, 4);
      var cls = '.mini-cal-day';
      if (d.getMonth() !== m) cls += '.out';
      if (dYmd === todayYmd) cls += '.today';
      if (dYmd === homeCal.sel) cls += '.selected';
      return el('button' + cls, {
        onclick: function () { homeCal.sel = dYmd; renderHome(); }
      }, [
        el('span.n', { text: String(d.getDate()) }),
        el('span.mini-cal-dots', {}, dots.map(function (it) {
          return el('span.mini-cal-dot', { style: { background: it.color } });
        }))
      ]);
    }));

    // 선택한 날의 목록
    var selItems = itemsOn(homeCal.sel);
    var listRows = selItems.map(function (it) {
      return el('div.today-row', { onclick: function () { MW.shell.go('calendar'); MW.calendar.goto(homeCal.sel); } }, [
        el('span.today-dot', { style: { background: it.color } }),
        it.time ? el('span.today-time', { text: it.time }) : null,
        el('span.today-title', { text: it.title })
      ]);
    });

    return el('div.card', {}, [
      head,
      dow,
      grid,
      el('h4.mini-cal-dayhead', { text: U.fmtLongDate(homeCal.sel) }),
      listRows.length ? el('div.today-list', {}, listRows) : el('div.empty', { text: '일정이 없습니다.' })
    ]);
  }

  /** #home-title 을 "오늘 날짜 · 현재 시각" 으로 갱신 (renderHome + 인터벌에서 호출) */
  function homeClock() {
    var titleEl = $('#home-title');
    if (!titleEl) return;
    var now = new Date();
    titleEl.textContent = U.fmtLongDate(U.ymd(now)) + ' · ' + U.pad2(now.getHours()) + ':' + U.pad2(now.getMinutes());
  }

  /* -------- 대시보드 카드 순서 (설정 → 테마 탭에서 편집) -------- */

  var HOME_SECTIONS = ['calendar', 'inbox', 'habits', 'money'];
  var HOME_SECTION_LABELS = {
    calendar: '오늘의 일정',
    inbox: '인박스',
    habits: '해빗 트래커',
    money: '금전 요약'
  };

  function homeOrder() {
    var saved = MW.store.state.settings.homeOrder || [];
    var ordered = saved.filter(function (k) { return HOME_SECTIONS.indexOf(k) >= 0; });
    HOME_SECTIONS.forEach(function (k) { if (ordered.indexOf(k) < 0) ordered.push(k); });
    return ordered;
  }

  function moveHomeSection(key, delta) {
    var order = homeOrder();
    var i = order.indexOf(key);
    var j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(i, 1);
    order.splice(j, 0, key);
    MW.store.update(function (s) { s.settings.homeOrder = order; });
  }

  function sectionNode(key) {
    if (key === 'calendar') return eventCalendarCard();

    if (key === 'inbox') {
      var todoBox = el('div.todo-list');
      MW.todo.renderList(todoBox, {
        filter: function (t) { return !t.done && !t.date; },
        draggable: false,
        emptyText: '지금 할 일이 없습니다.'
      });
      return el('div.card', {}, [el('h3', { text: '인박스' }), todoBox]);
    }

    if (key === 'habits') {
      return el('div.card', {}, [
        el('h3', {}, [
          '해빗 트래커 ',
          el('span.muted', { text: U.ym(new Date()).replace('-', '년 ') + '월 · ' + MW.habitGrid.todaySummary() })
        ]),
        MW.habitGrid.monthGridNode(new Date())
      ]);
    }

    if (key === 'money') {
      var sum = MW.ledger.summary(U.ym(new Date()));
      return el('div.card.home-money', {
        onclick: function () { MW.shell.go('ledger'); },
        title: '정산 장부로 이동'
      }, [
        el('span.label', { text: '이번 달 쓸 수 있는 돈' }),
        el('span.value' + (sum.free < 0 ? '.minus' : ''), { text: U.won(sum.free) }),
        el('span.small.dim', { text: '수입 ' + U.won(sum.income) + ' · 지출 ' + U.won(sum.expense) })
      ]);
    }
    return null;
  }

  function renderHome() {
    var host = $('#page-home-body');
    if (!host) return;
    U.clear(host);

    homeClock();

    // 꾸밈 이미지 — 날짜(제목) 바로 아래. 설정에서 넣지 않으면 칸 자체가 없습니다
    var img = MW.store.state.settings.homeImage;
    if (img) {
      host.appendChild(el('div.home-image', {}, [el('img', { src: img, alt: '' })]));
    }

    homeOrder().forEach(function (key) {
      var node = sectionNode(key);
      if (node) host.appendChild(node);
    });
  }

  /* ------------------------------------------------------------ 리렌더 */

  var renderAll = U.debounce(function () {
    var route = MW.shell.route();
    if (route === 'home') renderHome();
    else if (route === 'work') MW.work.render();
    else if (route === 'calendar') MW.calendar.render();
    else if (route === 'ledger') MW.ledger.render();
    else if (route === 'settings') MW.settings.render();
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
    MW.shell.applyMotion();
    MW.store.on(function () { MW.shell.applyTheme(); MW.shell.applyMotion(); });   // 색·동작 변경은 렌더 지연 없이 바로 반영

    MW.music.mount($('#musicbar'));
    MW.pomodoro.init();
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

    // 홈 제목의 현재 시각 갱신
    setInterval(homeClock, 20000);

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

  MW.app = {
    boot: boot, renderHome: renderHome, renderAll: renderAll,
    // 설정 → 테마 탭의 "대시보드 카드 순서" 편집에서 사용
    homeSectionLabels: HOME_SECTION_LABELS,
    homeOrder: homeOrder,
    moveHomeSection: moveHomeSection
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
