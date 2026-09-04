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

  /* -------- 위젯 종류 -------- */

  var WIDGET_DEFS = {
    today:   { label: '오늘 일정', builtin: true },
    next:    { label: '내일 · 미뤄진 일정', builtin: true },
    habits:  { label: '오늘 한 해빗', builtin: true },
    money:   { label: '오늘 쓴 돈', builtin: true },
    image:   { label: '이미지 갤러리', builtin: false, defaultConfig: { mode: 'fixed', images: [], intervalSec: 5 } },
    minical: { label: '미니 달력', builtin: false },
    embed:   { label: 'HTML 임베드', builtin: false, defaultConfig: { html: '' } }
  };
  var ADDABLE_TYPES = ['image', 'minical', 'embed'];

  function widgetNode(w, editing) {
    if (w.type === 'today') return todayCard();
    if (w.type === 'next') return nextCard();
    if (w.type === 'habits') return habitsCard();
    if (w.type === 'money') return moneyCard();
    if (w.type === 'image') return galleryWidgetNode(w, editing);
    if (w.type === 'minical') return miniCalWidget();
    if (w.type === 'embed') return embedWidgetNode(w, editing);
    return null;
  }

  /* -------- 이미지 갤러리 위젯 (고정 한 장 / 캐러셀 / 슬라이드쇼) -------- */

  var galleryIndexState = {};        // widgetId -> 현재 보고 있는 사진 인덱스 (리렌더돼도 유지)
  var activeSlideshowTimers = [];    // 매 렌더마다 정리하지 않으면 setInterval 이 계속 쌓입니다

  function clearSlideshowTimers() {
    activeSlideshowTimers.forEach(function (t) { clearInterval(t); });
    activeSlideshowTimers = [];
  }

  function galleryFrame(widget, imgs, extra) {
    var idx = galleryIndexState[widget.id] || 0;
    if (idx >= imgs.length) idx = 0;
    var dots = imgs.length > 1 ? el('div.home-gallery-dots', {}, imgs.map(function (_, i) {
      return el('span.home-gallery-dot' + (i === idx ? '.active' : ''));
    })) : null;
    return { idx: idx, node: el('div.home-gallery', {}, [el('img', { src: imgs[idx], alt: '' })].concat(extra || []).concat([dots])) };
  }

  function galleryCarousel(widget, imgs) {
    var f = galleryFrame(widget, imgs, [
      el('button.home-gallery-nav.prev', {
        text: '‹', title: '이전 사진',
        onclick: function () { galleryIndexState[widget.id] = (galleryIndexState[widget.id] || 0) - 1; if (galleryIndexState[widget.id] < 0) galleryIndexState[widget.id] = imgs.length - 1; renderHome(); }
      }),
      el('button.home-gallery-nav.next', {
        text: '›', title: '다음 사진',
        onclick: function () { galleryIndexState[widget.id] = ((galleryIndexState[widget.id] || 0) + 1) % imgs.length; renderHome(); }
      })
    ]);
    return f.node;
  }

  function gallerySlideshow(widget, imgs, intervalSec) {
    var f = galleryFrame(widget, imgs);
    if (imgs.length > 1) {
      activeSlideshowTimers.push(setInterval(function () {
        galleryIndexState[widget.id] = ((galleryIndexState[widget.id] || 0) + 1) % imgs.length;
        renderHome();
      }, Math.max(2, intervalSec || 5) * 1000));
    }
    return f.node;
  }

  function galleryEditPanel(widget) {
    var cfg = widget.config;
    var file = el('input', {
      type: 'file', accept: 'image/*', multiple: true, draggable: 'false', style: { display: 'none' }
    });
    file.addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = '';
      files.forEach(function (f) {
        if (cfg.images.length >= 20) { U.toast('사진은 최대 20장까지 담을 수 있습니다.', 'warn'); return; }
        U.shrinkImage(f, 1600, function (dataUrl) { cfg.images.push(dataUrl); renderHome(); });
      });
    });

    var thumbs = el('div.home-gallery-thumbs', {}, cfg.images.map(function (src, i) {
      return el('div.home-gallery-thumb', {}, [
        el('img', { src: src, alt: '' }),
        el('button', { text: '✕', title: '삭제', onclick: function () { cfg.images.splice(i, 1); renderHome(); } })
      ]);
    }));

    var modeSeg = el('div.seg', {}, [['fixed', '고정'], ['carousel', '캐러셀'], ['slideshow', '슬라이드쇼']].map(function (o) {
      return el('button' + (cfg.mode === o[0] ? '.active' : ''), {
        type: 'button', text: o[1],
        onclick: function () { cfg.mode = o[0]; renderHome(); }
      });
    }));

    var intervalInput = cfg.mode === 'slideshow' ? el('label.small.dim', {}, [
      '간격(초) ',
      el('input.input', {
        type: 'number', min: '2', max: '30', step: '1', value: cfg.intervalSec || 5, draggable: 'false',
        style: { width: '50px' },
        onchange: function () { cfg.intervalSec = Math.min(30, Math.max(2, parseInt(this.value, 10) || 5)); renderHome(); }
      })
    ]) : null;

    return el('div.home-gallery-edit', {}, [
      thumbs,
      el('div.row-wrap', { style: { marginTop: '6px', alignItems: 'center' } }, [
        el('button.btn.btn-sm', { text: '+ 사진 추가', onclick: function () { file.click(); } }),
        file, modeSeg, intervalInput
      ])
    ]);
  }

  function galleryWidgetNode(widget, editing) {
    var cfg = widget.config || (widget.config = { mode: 'fixed', images: [], intervalSec: 5 });
    var imgs = cfg.images || [];
    var kids = [];

    if (imgs.length) {
      if (cfg.mode === 'carousel') kids.push(galleryCarousel(widget, imgs));
      else if (cfg.mode === 'slideshow') kids.push(gallerySlideshow(widget, imgs, cfg.intervalSec));
      else kids.push(el('img', { src: imgs[0], alt: '' }));
    } else if (!editing) {
      return null;   // 편집 중이 아니면서 사진도 없으면 자리 자체가 생기지 않음
    } else {
      kids.push(el('div.empty', { text: '사진이 없습니다.' }));
    }

    if (editing) kids.push(galleryEditPanel(widget));
    return el('div.home-image' + (editing ? '.editing' : ''), {}, kids);
  }

  /* -------- 미니 달력 위젯 -------- */

  function miniCalWidget() {
    var now = new Date();
    var todayStr = U.ymd(now);
    var cells = U.monthGrid(now.getFullYear(), now.getMonth());

    var grid = el('div.minical-grid', {}, cells.map(function (d) {
      var dateStr = U.ymd(d);
      var inMonth = d.getMonth() === now.getMonth();
      var has = inMonth && (MW.calendar.eventsOn(dateStr).length > 0 || MW.calendar.todosOn(dateStr).some(function (t) { return !t.done; }));
      return el('button.minical-cell' + (inMonth ? '' : '.out') + (dateStr === todayStr ? '.today' : '') + (has ? '.has' : ''), {
        text: String(d.getDate()),
        onclick: function () { MW.shell.go('calendar'); MW.calendar.goto(dateStr); }
      });
    }));

    return el('div.card.home-minical', {}, [
      el('h3', { text: '미니 달력' }),
      el('div.minical-head', { text: (now.getFullYear()) + '년 ' + (now.getMonth() + 1) + '월' }),
      el('div.minical-week', {}, U.weekdayNames().map(function (w) { return el('span', { text: w }); })),
      grid
    ]);
  }

  /* -------- HTML 임베드 위젯 (사용자 지정) — 격리된 iframe(sandbox) 안에서만 실행 -------- */

  function embedWidgetNode(widget, editing) {
    var cfg = widget.config || (widget.config = { html: '' });
    if (!cfg.html && !editing) return null;

    var frame = el('iframe.home-embed-frame', {
      sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox',
      referrerpolicy: 'no-referrer',
      loading: 'lazy'
    });
    frame.srcdoc = cfg.html || '';

    var kids = [frame];
    if (editing) {
      kids.push(el('div.home-embed-edit', {}, [
        el('textarea', {
          draggable: 'false',
          placeholder: '유튜브·트위터·인스타그램 등의 임베드 코드나 원하는 HTML을 붙여넣으세요.',
          text: cfg.html,
          onchange: function () { cfg.html = this.value.slice(0, 20000); },
          oninput: function () { cfg.html = this.value.slice(0, 20000); }
        }),
        el('div.small.dim', { text: '보안을 위해 격리된 영역(iframe)에서만 실행됩니다. 아래 "미리보기 새로고침"으로 확인하세요.', style: { marginTop: '4px' } }),
        el('button.btn.btn-sm', { text: '미리보기 새로고침', style: { marginTop: '4px' }, onclick: function () { renderHome(); } })
      ]));
    }
    return el('div.home-embed', {}, kids);
  }

  /* -------- 홈 편집 모드: 순서·크기 드래그, 위젯 켜기/끄기·추가·삭제, 저장/취소 -------- */

  var dragHomeKey = null;
  var MIN_CARD_H = 80, MAX_CARD_H = 800;
  var HOME_COLS = 3;        // 홈은 3칸 그리드. 위젯이 1~3칸을 차지
  var HOME_ROWS_MAX = 3;    // 세로로도 최대 3칸까지
  var HOME_ROW_UNIT = 140;  // 세로 리사이즈 시 한 칸 늘리는 데 필요한 드래그 거리(px) 기준. 행 높이는 내용에 따라 자동

  var editMode = false;
  var draft = null;   // 편집 중에만 존재. 저장을 눌러야 실제 설정에 반영됨 (실수로 바뀌는 것 방지)

  function cloneHomeSettings() {
    var s = MW.store.state.settings;
    return {
      widgets: JSON.parse(JSON.stringify(s.homeWidgets || [])),
      heights: Object.assign({}, s.homeCardHeights),
      spans: Object.assign({}, s.homeCardSpans),
      rowSpans: Object.assign({}, s.homeCardRowSpans)
    };
  }

  /** 편집 중이면 임시본(draft), 아니면 실제 저장된 설정을 봅니다 */
  function curHome() {
    if (editMode && draft) return draft;
    var s = MW.store.state.settings;
    return { widgets: s.homeWidgets || [], heights: s.homeCardHeights || {}, spans: s.homeCardSpans || {}, rowSpans: s.homeCardRowSpans || {} };
  }

  function enterEdit() { draft = cloneHomeSettings(); editMode = true; renderHome(); }
  function cancelEdit() { draft = null; editMode = false; renderHome(); }
  function saveEdit() {
    var d = draft;
    MW.store.update(function (s) {
      s.settings.homeWidgets = d.widgets;
      s.settings.homeCardHeights = d.heights;
      s.settings.homeCardSpans = d.spans;
      s.settings.homeCardRowSpans = d.rowSpans;
    });
    draft = null;
    editMode = false;
    renderHome();
  }

  function addWidget(type) {
    var def = WIDGET_DEFS[type];
    if (!def) return;
    var w = { id: U.uid(type), type: type, enabled: true };
    if (def.defaultConfig) w.config = JSON.parse(JSON.stringify(def.defaultConfig));
    draft.widgets.push(w);
    renderHome();
  }

  function removeWidget(id) {
    draft.widgets = draft.widgets.filter(function (w) { return w.id !== id; });
    delete draft.heights[id]; delete draft.spans[id]; delete draft.rowSpans[id];
    renderHome();
  }

  function dropHomeSection(targetKey) {
    var from = dragHomeKey;
    if (!from || from === targetKey) return;
    var i = draft.widgets.findIndex(function (w) { return w.id === from; });
    var j = draft.widgets.findIndex(function (w) { return w.id === targetKey; });
    if (i < 0 || j < 0) return;
    var item = draft.widgets.splice(i, 1)[0];
    var newJ = draft.widgets.findIndex(function (w) { return w.id === targetKey; });
    draft.widgets.splice(newJ, 0, item);
    renderHome();
  }

  function setCardHeight(key, px) { if (px == null) delete draft.heights[key]; else draft.heights[key] = px; }
  function setCardSpan(key, span) { if (span >= HOME_COLS) delete draft.spans[key]; else draft.spans[key] = span; }
  function setCardRowSpan(key, rowSpan) { if (rowSpan <= 1) delete draft.rowSpans[key]; else draft.rowSpans[key] = rowSpan; }

  /** 그리드 한 칸의 너비(px) — 가로 리사이즈 중 드래그 거리와 비교하는 기준 */
  function homeColWidth() {
    var host = $('#page-home-body');
    if (!host) return 300;
    var rect = host.getBoundingClientRect();
    var gap = parseFloat(getComputedStyle(host).columnGap) || 14;
    return (rect.width - gap * (HOME_COLS - 1)) / HOME_COLS;
  }

  function startCardResizeX(e, key, wrap) {
    e.preventDefault();
    var startX = e.clientX;
    var startSpan = Math.min(HOME_COLS, Math.max(1, draft.spans[key] || HOME_COLS));
    var colW = homeColWidth();
    var span = startSpan;
    wrap.classList.add('resizing-x');
    function move(ev) {
      var dx = ev.clientX - startX;
      span = Math.min(HOME_COLS, Math.max(1, Math.round(startSpan + dx / colW)));
      wrap.style.gridColumn = 'span ' + span;
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      wrap.classList.remove('resizing-x');
      setCardSpan(key, span);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function startCardResizeXY(e, key, wrap) {
    e.preventDefault();
    var startY = e.clientY;
    var startRowSpan = Math.min(HOME_ROWS_MAX, Math.max(1, draft.rowSpans[key] || 1));
    var rowSpan = startRowSpan;
    wrap.classList.add('resizing-xy');
    function move(ev) {
      var dy = ev.clientY - startY;
      rowSpan = Math.min(HOME_ROWS_MAX, Math.max(1, Math.round(startRowSpan + dy / HOME_ROW_UNIT)));
      wrap.style.gridRow = 'span ' + rowSpan;
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      wrap.classList.remove('resizing-xy');
      setCardRowSpan(key, rowSpan);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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

  /** 위젯마다 카드 하나로 감쌉니다. 편집 모드일 때만 손잡이·리사이즈 핸들·삭제 버튼이 붙습니다 */
  function homeCardWrap(widget, node, editing) {
    if (!node) return null;
    var key = widget.id;
    var home = curHome();
    var h = home.heights[key];
    var span = Math.min(HOME_COLS, Math.max(1, home.spans[key] || HOME_COLS));
    var rowSpan = Math.min(HOME_ROWS_MAX, Math.max(1, home.rowSpans[key] || 1));

    var kids = [node];
    if (editing) {
      kids.unshift(el('span.home-card-grip', { text: '⠿', title: '끌어서 순서 바꾸기' }));
      if (!WIDGET_DEFS[widget.type].builtin) {
        kids.push(el('button.home-card-remove', {
          text: '✕', title: '위젯 삭제',
          onclick: function () { MW.shell.confirm('이 위젯을 삭제할까요?', function () { removeWidget(key); }); }
        }));
      }
    }

    var wrap = el('div.home-card-wrap' + (h ? '.resized' : ''), {
      style: Object.assign({ gridColumn: 'span ' + span, gridRow: 'span ' + rowSpan }, h ? { height: h + 'px' } : null)
    }, kids);

    if (editing) {
      wrap.appendChild(el('div.home-card-resize', {
        title: '드래그해서 높이 조절 (더블클릭: 기본 높이로)',
        onpointerdown: function (e) { startCardResize(e, key, wrap); },
        ondblclick: function () { wrap.style.height = ''; wrap.classList.remove('resized'); setCardHeight(key, null); }
      }));
      wrap.appendChild(el('div.home-card-resize-x', {
        title: '드래그해서 폭 조절 (더블클릭: 전체 폭으로)',
        onpointerdown: function (e) { startCardResizeX(e, key, wrap); },
        ondblclick: function () { wrap.style.gridColumn = 'span ' + HOME_COLS; setCardSpan(key, HOME_COLS); }
      }));
      wrap.appendChild(el('div.home-card-resize-xy', {
        title: '드래그해서 세로로 길게 (더블클릭: 기본 1줄로)',
        onpointerdown: function (e) { startCardResizeXY(e, key, wrap); },
        ondblclick: function () { wrap.style.gridRow = 'span 1'; setCardRowSpan(key, 1); }
      }));

      wrap.draggable = true;
      wrap.addEventListener('dragstart', function (e) {
        dragHomeKey = key;
        wrap.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', key); } catch (err) { /* 일부 브라우저 */ }
        e.dataTransfer.effectAllowed = 'move';
      });
      wrap.addEventListener('dragend', function () { dragHomeKey = null; wrap.classList.remove('dragging'); });
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
    }

    return wrap;
  }

  function editToolbar() {
    var rows = draft.widgets.map(function (w, idx) {
      var def = WIDGET_DEFS[w.type] || { label: w.type };
      var label = def.label + (def.builtin ? '' : ' #' + (idx + 1));
      return el('label.home-edit-row', {}, [
        el('input', {
          type: 'checkbox', checked: w.enabled !== false,
          onchange: function () { w.enabled = this.checked; renderHome(); }
        }),
        el('span', { text: label })
      ]);
    });

    var addBtns = ADDABLE_TYPES.map(function (type) {
      return el('button.btn.btn-sm', { text: '+ ' + WIDGET_DEFS[type].label, onclick: function () { addWidget(type); } });
    });

    return el('div.home-edit-toolbar', {}, [
      el('div.home-edit-title', { text: '대시보드 편집' }),
      el('div.small.dim', {
        text: '체크박스로 위젯을 켜고 끕니다. 카드는 손잡이(⠿)로 순서를, 오른쪽·아래쪽 가장자리로 크기를 바꿉니다. 저장을 눌러야 실제로 반영됩니다.',
        style: { marginBottom: '8px' }
      }),
      el('div.home-edit-checklist', {}, rows),
      el('div.home-edit-add', {}, addBtns),
      el('div.home-edit-actions', {}, [
        el('button.btn.btn-sm', { text: '취소', onclick: cancelEdit }),
        el('button.btn.btn-primary.btn-sm', { text: '저장', onclick: saveEdit })
      ])
    ]);
  }

  function renderEditBar() {
    var bar = $('#home-edit-bar');
    if (!bar) return;
    U.clear(bar);
    if (!editMode) bar.appendChild(el('button.btn.btn-sm', { text: '편집', onclick: enterEdit }));
  }

  function renderHome() {
    var host = $('#page-home-body');
    if (!host) return;
    clearSlideshowTimers();
    U.clear(host);

    homeClock();
    renderEditBar();

    var home = curHome();
    if (editMode) host.appendChild(editToolbar());

    home.widgets.forEach(function (w) {
      if (w.enabled === false) return;
      var node = widgetNode(w, editMode);
      var wrap = homeCardWrap(w, node, editMode);
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
    boot: boot, renderHome: renderHome, renderAll: renderAll
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
