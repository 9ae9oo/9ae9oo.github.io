/* ==========================================================================
   MW.app — 부팅 / 홈 대시보드 / 전역 리렌더 연결
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el, $ = U.$;

  /* ------------------------------------------------------------ 대시보드
     기준은 "오늘 당장 봐야 할 것" 입니다. 월 격자처럼 둘러보기용 뷰는
     각자의 페이지에 두고, 여기에는 오늘치만 올립니다. */

  /** 그 날의 일정 + (날짜가 붙은) 할 일을 한 목록으로 모읍니다 */
  function itemsOn(day) {
    var out = MW.calendar.eventsOn(day).map(function (ev) {
      return { color: ev.color || '#6b8afd', title: ev.title, time: ev.allDay || ev.start === null ? '종일' : U.fmtMin(ev.start) };
    });
    MW.calendar.todosOn(day).filter(function (t) { return !t.done; }).forEach(function (t) {
      out.push({ color: MW.todo.colorOf(t), title: t.title, time: '' });
    });
    return out;
  }

  /** 일정 한 줄 — 누르면 그 날짜의 캘린더로 갑니다 */
  function itemRow(it, day) {
    return el('div.today-row', {
      onclick: function () { MW.shell.go('calendar'); MW.calendar.goto(day); }
    }, [
      el('span.today-dot', { style: { background: it.color } }),
      it.time ? el('span.today-time', { text: it.time }) : null,
      el('span.today-title', { text: it.title })
    ]);
  }

  function listOrEmpty(rows, emptyText) {
    return rows.length ? el('div.today-list', {}, rows) : el('div.empty', { text: emptyText });
  }

  /** #home-title 을 "오늘 날짜 · 현재 시각" 으로 갱신 (renderHome + 인터벌에서 호출) */
  function homeClock() {
    var titleEl = $('#home-title');
    if (!titleEl) return;
    var now = new Date();
    titleEl.textContent = U.fmtLongDate(U.ymd(now)) + ' · ' + U.pad2(now.getHours()) + ':' + U.pad2(now.getMinutes());
  }

  /* -------- 카드 -------- */

  function todayCard() {
    var today = U.ymd(new Date());
    var rows = itemsOn(today).map(function (it) { return itemRow(it, today); });
    return el('div.card', {}, [
      el('h3', { text: '오늘 일정' }),
      listOrEmpty(rows, '오늘은 일정이 없습니다.')
    ]);
  }

  function nextCard() {
    var now = new Date();
    var today = U.ymd(now);
    var tomorrow = U.ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    // 미뤄진 것 = 기한이 지났는데 아직 안 끝낸 할 일.
    // 지나간 일정(이벤트)은 미뤄진 게 아니라 그냥 지나간 것이므로 넣지 않습니다.
    var late = MW.store.state.todos.filter(function (t) {
      return !t.done && t.date && t.date < today;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var kids = [el('h3', { text: '내일 · 미뤄진 일정' })];

    if (late.length) {
      kids.push(el('h4.dash-subhead', {}, ['미뤄짐 ', el('span.dash-late-count', { text: String(late.length) })]));
      kids.push(el('div.today-list', {}, late.map(function (t) {
        return el('div.today-row', {
          onclick: function () { MW.shell.go('calendar'); MW.calendar.goto(t.date); }
        }, [
          el('span.today-dot', { style: { background: MW.todo.colorOf(t) } }),
          el('span.today-time.late', { text: U.fmtDate(t.date) }),
          el('span.today-title', { text: t.title })
        ]);
      })));
    }

    kids.push(el('h4.dash-subhead', { text: '내일' }));
    kids.push(listOrEmpty(itemsOn(tomorrow).map(function (it) { return itemRow(it, tomorrow); }), '내일은 일정이 없습니다.'));

    return el('div.card', {}, kids);
  }

  function habitsCard() {
    var today = U.ymd(new Date());
    var list = MW.habits.all();

    var body = list.length
      ? el('div.dash-habits', {}, list.map(function (h) {
          var count = MW.habits.countOf(h.id, today);
          var target = MW.habits.targetOf(h);
          return el('button.dash-habit' + (count >= target ? '.done' : ''), {
            title: h.name + ' — ' + count + ' / ' + target,
            onclick: function () { MW.habits.toggle(h.id, today); }
          }, [
            el('span.dash-habit-dot', { style: { background: h.color || 'var(--accent)' } }),
            el('span.dash-habit-name', { text: h.name }),
            el('span.dash-habit-count', { text: count + '/' + target })
          ]);
        }))
      : el('div.empty', { text: '해빗이 없습니다. 설정 → 시간 · 해빗에서 추가해 보세요.' });

    return el('div.card', {}, [
      el('h3', {}, ['오늘 한 해빗 ', el('span.muted', { text: list.length ? MW.habitGrid.todaySummary() : '' })]),
      body
    ]);
  }

  /** 꾸미기 이미지 — 설정에서 넣지 않았으면 null 이라 자리 자체가 생기지 않습니다 */
  function imageCard() {
    var img = MW.store.state.settings.homeImage;
    if (!img) return null;
    var size = MW.store.state.settings.homeImageSize || 'md';
    return el('div.home-image.h-' + size, {}, [el('img', { src: img, alt: '' })]);
  }

  function moneyCard() {
    var today = U.ymd(new Date());
    var ym = today.slice(0, 7);
    var spent = MW.ledger.txOf(ym).reduce(function (a, t) {
      return (t.date === today && !MW.ledger.isIncome(t)) ? a + (+t.amount || 0) : a;
    }, 0);
    var sum = MW.ledger.summary(ym);

    return el('div.card.home-money', {
      onclick: function () { MW.shell.go('ledger'); },
      title: '정산 장부로 이동'
    }, [
      el('span.label', { text: '오늘 쓴 돈' }),
      el('span.value', { text: U.won(spent) }),
      el('span.small.dim', { text: '이번 달 남은 돈 ' + U.won(sum.free) })
    ]);
  }

  /* -------- 카드 순서 (설정 → 테마 탭에서 편집) -------- */

  var HOME_SECTIONS = ['image', 'today', 'next', 'habits', 'money'];
  var HOME_SECTION_LABELS = {
    image: '꾸미기 이미지',
    today: '오늘 일정',
    next: '내일 · 미뤄진 일정',
    habits: '오늘 한 해빗',
    money: '오늘 쓴 돈'
  };
  // 예전 키 → 새 키. 저장해 둔 순서를 잃지 않도록 옮겨 읽습니다.
  var HOME_LEGACY = { calendar: 'today', inbox: 'next' };

  function homeOrder() {
    var saved = MW.store.state.settings.homeOrder || [];
    var ordered = [];
    saved.forEach(function (k) {
      var key = HOME_LEGACY[k] || k;
      if (HOME_SECTIONS.indexOf(key) >= 0 && ordered.indexOf(key) < 0) ordered.push(key);
    });
    // 새로 생긴 카드는 뒤에 붙입니다. 다만 꾸미기 이미지는 예전에 늘 맨 위 고정이었으므로
    // 기존 사용자의 화면에서 갑자기 아래로 내려가지 않게 그 자리를 지켜줍니다.
    HOME_SECTIONS.forEach(function (k) {
      if (ordered.indexOf(k) >= 0) return;
      if (k === 'image') ordered.unshift(k); else ordered.push(k);
    });
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
    if (key === 'image') return imageCard();
    if (key === 'today') return todayCard();
    if (key === 'next') return nextCard();
    if (key === 'habits') return habitsCard();
    if (key === 'money') return moneyCard();
    return null;
  }

  /* -------- 홈에서 직접: 드래그로 순서 바꾸기 + 아래쪽 드래그로 높이 조절 -------- */

  var dragHomeKey = null;
  var MIN_CARD_H = 80, MAX_CARD_H = 800;

  function dropHomeSection(targetKey) {
    var from = dragHomeKey;
    if (!from || from === targetKey) return;
    var order = homeOrder();
    var i = order.indexOf(from), j = order.indexOf(targetKey);
    if (i < 0 || j < 0) return;
    order.splice(j, 0, order.splice(i, 1)[0]);
    MW.store.update(function (s) { s.settings.homeOrder = order; });
  }

  function setCardHeight(key, px) {
    MW.store.update(function (s) {
      var hc = Object.assign({}, s.settings.homeCardHeights);
      if (px == null) delete hc[key]; else hc[key] = px;
      s.settings.homeCardHeights = hc;
    });
  }

  function startCardResize(e, key, wrap) {
    e.preventDefault();
    var startY = e.clientY;
    var startH = wrap.getBoundingClientRect().height;
    wrap.classList.add('resizing');
    function move(ev) {
      var h = Math.min(MAX_CARD_H, Math.max(MIN_CARD_H, Math.round(startH + (ev.clientY - startY))));
      wrap.style.height = h + 'px';
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      wrap.classList.remove('resizing');
      setCardHeight(key, Math.min(MAX_CARD_H, Math.max(MIN_CARD_H, Math.round(wrap.getBoundingClientRect().height))));
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  /** 카드마다 [드래그 손잡이 + 실제 카드 + 아래쪽 리사이즈 바]로 감쌉니다 */
  function homeCardWrap(key, node) {
    if (!node) return null;
    var heights = MW.store.state.settings.homeCardHeights || {};
    var h = heights[key];

    var wrap = el('div.home-card-wrap' + (h ? '.resized' : ''), {
      style: h ? { height: h + 'px' } : null
    }, [
      el('span.home-card-grip', { text: '⠿', title: '끌어서 순서 바꾸기' }),
      node,
      el('div.home-card-resize', {
        title: '드래그해서 높이 조절 (더블클릭: 기본 높이로)',
        onpointerdown: function (e) { startCardResize(e, key, wrap); },
        ondblclick: function () { wrap.style.height = ''; wrap.classList.remove('resized'); setCardHeight(key, null); }
      })
    ]);

    wrap.draggable = true;
    wrap.addEventListener('dragstart', function (e) {
      dragHomeKey = key;
      wrap.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', key); } catch (err) { /* 일부 브라우저 */ }
      e.dataTransfer.effectAllowed = 'move';
    });
    wrap.addEventListener('dragend', function () {
      dragHomeKey = null;
      wrap.classList.remove('dragging');
    });
    wrap.addEventListener('dragover', function (e) {
      if (!dragHomeKey || dragHomeKey === key) return;
      e.preventDefault();
      wrap.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave', function () { wrap.classList.remove('drag-over'); });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      wrap.classList.remove('drag-over');
      dropHomeSection(key);
    });

    return wrap;
  }

  function renderHome() {
    var host = $('#page-home-body');
    if (!host) return;
    U.clear(host);

    homeClock();

    homeOrder().forEach(function (key) {
      var node = sectionNode(key);
      var wrap = homeCardWrap(key, node);
      if (wrap) host.appendChild(wrap);
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
    MW.todo.render();
    MW.pomodoro.renderMini();
    MW.habitGrid.renderAlarms();
    MW.shell.syncFloatButtons();
  }, 40);

  /* ------------------------------------- 넓은 화면에서 도구 패널 자동 펼침 */

  /* 창이 2400px 을 넘어가면 접혀 있던 패널을 엽니다. 넘어가는 순간의 "직전 상태"를
     기억해뒀다가 다시 2400 이하로 줄면 그 상태로 되돌립니다.
       열려 있었음 → 넓어짐(유지) → 좁아짐: 열림
       닫혀 있었음 → 넓어짐(자동 열림) → 좁아짐: 닫힘                             */
  var WIDE_W = 2400;
  var wasWide = false;
  var stateBeforeWide = false;

  function anyPanelOpen() { return document.body.classList.contains('anypanel-open'); }

  function syncWidePanel() {
    var wide = window.innerWidth > WIDE_W;
    if (wide === wasWide) return;
    if (wide) {
      stateBeforeWide = anyPanelOpen();
      if (!stateBeforeWide && MW.shell.floats.inbox) MW.shell.floats.inbox.open();
    } else if (!stateBeforeWide) {
      MW.shell.closeAllPanels();
    }
    wasWide = wide;
  }

  /* ------------------------------------------------------------ 부팅 */

  function boot() {
    MW.store.load();
    MW.shell.applyTheme();
    MW.shell.applyMotion();
    MW.store.on(function () { MW.shell.applyTheme(); MW.shell.applyMotion(); });   // 색·동작 변경은 렌더 지연 없이 바로 반영

    MW.music.init();
    MW.pomodoro.init();
    MW.memo.init();
    MW.todo.initPanel();
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

    syncWidePanel();
    // 넓은 화면에서 사용자가 직접 여닫으면 "기억해둔 직전 상태"를 그 결과로 갱신
    U.on(document.body, 'click', '[data-float]', function () {
      if (window.innerWidth > WIDE_W) setTimeout(function () { stateBeforeWide = anyPanelOpen(); }, 0);
    });

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

    window.addEventListener('resize', U.debounce(function () {
      MW.shell.syncFloatButtons();
      syncWidePanel();
    }, 200));
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
