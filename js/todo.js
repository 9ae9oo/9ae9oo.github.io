/* ==========================================================================
   MW.todo — 인박스형 할 일 (우측 레일의 📥 인박스 패널 · 캘린더 일/주 뷰에서도 목록으로)
   · 날짜 없이 바로 추가되는 "인박스" 개념
   · 데이터는 store.todos 한 곳에만 존재
   · renderList 를 다른 화면(캘린더 등)이 재사용합니다
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var COLORS = ['#6b8afd', '#4ade80', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf', '#8b90a5'];
  var panel = null;
  var filterGroup = 'all';

  function groups() { return MW.store.state.todoGroups; }
  function groupOf(id) { return groups().find(function (g) { return g.id === id; }) || null; }

  /** 항목 색 = 개별 지정색 > 카테고리 기본색 > 회색 */
  function colorOf(t) {
    if (t.color) return t.color;
    var g = groupOf(t.groupId);
    return g ? g.color : '#8b90a5';
  }

  function add(title, groupId, date) {
    title = String(title || '').trim();
    if (!title) return null;
    var id = U.uid('todo');
    MW.store.update(function (s) {
      var max = s.todos.reduce(function (m, t) { return Math.max(m, t.order || 0); }, 0);
      s.todos.push({
        id: id, title: title, done: false,
        groupId: groupId || null,
        date: date || null, color: null, order: max + 1
      });
    });
    return id;
  }

  function toggle(id) {
    MW.store.update(function (s) {
      var t = s.todos.find(function (x) { return x.id === id; });
      if (t) t.done = !t.done;
    });
  }

  function remove(id) {
    MW.store.update(function (s) {
      s.todos = s.todos.filter(function (x) { return x.id !== id; });
    });
  }

  /** 정렬: 미완료 먼저(order 순) → 완료 항목은 아래로 */
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (a.order || 0) - (b.order || 0);
    });
  }

  function editDialog(t) {
    var title = el('input.field', { value: t.title, maxlength: '200' });
    var group = el('select.field', {}, [
      el('option', { value: '', text: '카테고리 없음', selected: !t.groupId })
    ].concat(groups().map(function (g) {
      return el('option', { value: g.id, text: g.name, selected: g.id === t.groupId });
    })));
    var date = el('input.field', { type: 'date', value: t.date || '' });
    var useOwn = el('input', { type: 'checkbox', checked: !!t.color });
    var color = el('input', {
      type: 'color', value: t.color || colorOf(t),
      style: { width: '46px', height: '32px', background: 'none', border: 'none', cursor: 'pointer' }
    });

    MW.shell.modal({
      title: '할 일 수정',
      body: [
        el('div.form-row', {}, [el('label', { text: '제목' }), title]),
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '카테고리' }), group]),
          el('div.form-row', {}, [el('label', { text: '날짜 (비우면 인박스)' }), date])
        ]),
        el('div.form-row', {}, [
          el('label', { text: '색상' }),
          el('label.row.small.muted', { style: { gap: '6px', cursor: 'pointer' } }, [
            useOwn, '이 항목만 다른 색 쓰기', color
          ]),
          el('div.small.dim', { text: '체크하지 않으면 카테고리 기본색을 따릅니다.' })
        ])
      ],
      extra: el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () { remove(t.id); MW.shell.closeModal(); }
      }),
      onOk: function () {
        var v = title.value.trim();
        if (!v) { U.toast('제목을 입력해 주세요.', 'warn'); return false; }
        MW.store.update(function (s) {
          var x = s.todos.find(function (y) { return y.id === t.id; });
          if (!x) return;
          x.title = v;
          x.groupId = group.value || null;
          x.date = date.value || null;
          x.color = useOwn.checked ? color.value : null;
        });
      }
    });
  }

  /* ------------------------------------------------------------ 렌더 */

  /**
   * 할 일 목록을 그립니다. 홈 대시보드 · 캘린더 일/주 뷰가 재사용합니다.
   * opts: { filter: fn, showMeta: bool, emptyText: string }
   */
  function renderList(container, opts) {
    opts = opts || {};
    var list = MW.store.state.todos.filter(opts.filter || function () { return true; });
    U.clear(container);

    if (!list.length) {
      container.appendChild(el('div.empty', { text: opts.emptyText || '할 일이 없습니다.' }));
      return;
    }

    sorted(list).forEach(function (t) {
      var g = groupOf(t.groupId);
      var meta = [];
      if (opts.showMeta !== false) {
        if (g) meta.push(g.name);
        if (t.date) meta.push(U.fmtDate(t.date));
      }
      container.appendChild(el('div.todo-item' + (t.done ? '.done' : ''), { dataset: { id: t.id } }, [
        el('input.chk', {
          type: 'checkbox', checked: t.done,
          onchange: function () { toggle(t.id); }
        }),
        el('span.dot', { style: { background: colorOf(t) } }),
        el('div.t-main', {}, [
          el('div.t-title', { text: t.title }),
          meta.length ? el('div.t-meta', { text: meta.join(' · ') }) : null
        ]),
        el('div.t-actions', {}, [
          opts.onSchedule ? el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '📅', title: '캘린더에 배치',
            onclick: function (e) { e.stopPropagation(); opts.onSchedule(t, e.currentTarget); }
          }) : null,
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '✎', title: '수정', onclick: function () { editDialog(t); }
          })
        ])
      ]));
    });
  }

  /* -------------------------------------------------- 우측 레일 인박스 패널 */

  function setDate(id, dateStr) {
    MW.store.update(function (s) {
      var t = s.todos.find(function (x) { return x.id === id; });
      if (t) t.date = dateStr || null;
    });
    if (dateStr) U.toast(U.fmtDate(dateStr) + ' 로 배치했습니다.');
  }

  /** 인박스 항목의 📅 → 빠른 날짜 지정 메뉴 (항목 아래로 펼침) */
  function scheduleMenu(t, btn) {
    var item = btn.closest('.todo-item');
    if (!item) return;
    var existing = item.nextElementSibling;
    if (existing && existing.classList.contains('inbox-sched')) { existing.remove(); return; }

    var now = new Date();
    var toSat = (6 - now.getDay() + 7) % 7 || 7;
    var quick = [
      ['오늘', U.ymd(now)],
      ['내일', U.ymd(U.addDays(now, 1))],
      ['모레', U.ymd(U.addDays(now, 2))],
      ['이번 주말', U.ymd(U.addDays(now, toSat))]
    ];
    var picker = el('input.field', {
      type: 'date',
      onchange: function () { if (this.value) { setDate(t.id, this.value); menu.remove(); } }
    });
    var menu = el('div.inbox-sched', {},
      quick.map(function (q) {
        return el('button.btn.btn-sm', { type: 'button', text: q[0], onclick: function () { setDate(t.id, q[1]); menu.remove(); } });
      }).concat([picker])
    );
    item.after(menu);
    setTimeout(function () {
      document.addEventListener('click', function close(e) {
        if (!menu.contains(e.target) && !item.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
      });
    }, 0);
  }

  function renderPanel() {
    if (!panel) return;
    var host = panel.body;
    U.clear(host);

    var mk = function (id, label) {
      return el('button.todo-tab' + (filterGroup === id ? '.active' : ''), {
        type: 'button', text: label,
        onclick: function () { filterGroup = id; renderPanel(); }
      });
    };
    var tabs = el('div.todo-tabs', {}, [mk('all', '전체')].concat(
      groups().map(function (g) { return mk(g.id, g.name); })
    ));

    var listBox = el('div.todo-list');
    renderList(listBox, {
      filter: function (t) {
        return !t.done && !t.date && (filterGroup === 'all' || t.groupId === filterGroup);
      },
      emptyText: '인박스가 비어 있습니다.\n아래 입력창으로 추가하세요.',
      onSchedule: scheduleMenu
    });

    host.appendChild(tabs);
    host.appendChild(el('div.small.dim', { text: '📅 로 날짜를 지정하면 캘린더로 옮겨집니다.', style: { margin: '2px 2px 8px' } }));
    host.appendChild(listBox);
  }

  MW.todo = {
    renderList: renderList,
    add: add, toggle: toggle, remove: remove, colorOf: colorOf, editDialog: editDialog,
    COLORS: COLORS,
    initPanel: function () {
      panel = MW.shell.registerPanel('inbox', { title: '📥 인박스', onOpen: renderPanel });
    },
    render: function () { if (panel && panel.isOpen()) renderPanel(); }
  };
})();
