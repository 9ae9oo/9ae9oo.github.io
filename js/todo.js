/* ==========================================================================
   MW.todo — 인박스형 투두리스트 (플로팅 위젯 + 캘린더 공유)
   · 날짜 없이도 바로 추가되는 "인박스" 개념
   · 그룹(폴더) 탭으로 분류, 그룹 기본색을 캘린더에서 상속
   · 데이터는 store.todos 한 곳에만 존재하고, 캘린더는 date 가 있는 항목만 필터해서 표시
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var COLORS = ['#6b8afd', '#4ade80', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf', '#8b90a5'];
  var float = null;
  var activeGroup = 'all';

  function groups() { return MW.store.state.todoGroups; }
  function groupOf(id) { return groups().find(function (g) { return g.id === id; }) || null; }

  /** 항목 색 = 개별 지정색 > 그룹 기본색 > 회색 */
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
        groupId: groupId || (s.todoGroups[0] ? s.todoGroups[0].id : null),
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
    var group = el('select.field', {}, groups().map(function (g) {
      return el('option', { value: g.id, text: g.name, selected: g.id === t.groupId });
    }));
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
          el('div.form-row', {}, [el('label', { text: '그룹' }), group]),
          el('div.form-row', {}, [el('label', { text: '날짜 (비우면 인박스)' }), date])
        ]),
        el('div.form-row', {}, [
          el('label', { text: '색상' }),
          el('label.row.small.muted', { style: { gap: '6px', cursor: 'pointer' } }, [
            useOwn, '이 항목만 다른 색 쓰기', color
          ]),
          el('div.small.dim', { text: '체크하지 않으면 그룹 기본색을 따릅니다.' })
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
          x.groupId = group.value;
          x.date = date.value || null;
          x.color = useOwn.checked ? color.value : null;
        });
      }
    });
  }

  /* ------------------------------------------------------------ 드래그 정렬 */

  var dragId = null;

  function attachDrag(node, t, listEl) {
    node.draggable = true;
    node.addEventListener('dragstart', function (e) {
      dragId = t.id;
      node.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', t.id); } catch (err) { /* 일부 브라우저 */ }
      e.dataTransfer.effectAllowed = 'move';
    });
    node.addEventListener('dragend', function () {
      dragId = null;
      node.classList.remove('dragging');
      U.$$('.todo-item.drag-over', listEl).forEach(function (n) { n.classList.remove('drag-over'); });
    });
    node.addEventListener('dragover', function (e) {
      if (!dragId || dragId === t.id) return;
      e.preventDefault();
      node.classList.add('drag-over');
    });
    node.addEventListener('dragleave', function () { node.classList.remove('drag-over'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault();
      node.classList.remove('drag-over');
      var from = dragId;
      if (!from || from === t.id) return;
      MW.store.update(function (s) {
        var a = s.todos.find(function (x) { return x.id === from; });
        var b = s.todos.find(function (x) { return x.id === t.id; });
        if (!a || !b) return;
        var target = b.order || 0;
        // 놓인 자리를 비우고 그 위치에 삽입
        s.todos.forEach(function (x) {
          if (x.id !== a.id && (x.order || 0) >= target) x.order = (x.order || 0) + 1;
        });
        a.order = target;
      });
    });
  }

  /* ------------------------------------------------------------ 렌더 */

  /**
   * 투두 목록을 그립니다. 캘린더 일간 뷰에서도 그대로 재사용합니다.
   * opts: { filter: fn, showMeta: bool, listEl: 이미 만든 컨테이너, draggable: bool }
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
      var node = el('div.todo-item' + (t.done ? '.done' : ''), { dataset: { id: t.id } }, [
        opts.draggable !== false ? el('span.grip', { text: '⠿', title: '끌어서 순서 바꾸기' }) : null,
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
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '✎', title: '수정', onclick: function () { editDialog(t); }
          })
        ])
      ]);
      if (opts.draggable !== false) attachDrag(node, t, container);
      container.appendChild(node);
    });
  }

  function render() {
    if (!float) return;
    U.clear(float.body);

    var tabs = el('div.todo-tabs', {}, [
      el('button.todo-tab' + (activeGroup === 'all' ? '.active' : ''), {
        text: '전체', onclick: function () { activeGroup = 'all'; render(); }
      })
    ].concat(groups().map(function (g) {
      return el('button.todo-tab' + (activeGroup === g.id ? '.active' : ''), {
        text: g.name, onclick: function () { activeGroup = g.id; render(); }
      });
    })));

    var input = el('input.field', {
      placeholder: '생각난 할 일을 바로 적으세요 (Enter)',
      onkeydown: function (e) {
        if (e.key !== 'Enter') return;
        var gid = activeGroup !== 'all' ? activeGroup : null;
        if (add(this.value, gid)) this.value = '';
      }
    });

    var listEl = el('div.todo-list');
    renderList(listEl, {
      filter: function (t) { return activeGroup === 'all' || t.groupId === activeGroup; },
      emptyText: '비어 있습니다.\n떠오르는 일을 위에 적어 두세요.'
    });

    var all = MW.store.state.todos;
    var left = all.filter(function (t) { return !t.done; }).length;

    float.body.appendChild(tabs);
    float.body.appendChild(el('div.todo-add', {}, [input]));
    float.body.appendChild(listEl);
    float.body.appendChild(el('div.small.dim', {
      text: '남은 할 일 ' + left + '개 · 전체 ' + all.length + '개',
      style: { marginTop: '10px', textAlign: 'right' }
    }));
  }

  MW.todo = {
    init: function () {
      float = MW.shell.registerFloat('todo', {
        title: '✅ 투두리스트',
        rect: { x: 300, y: 120, w: 360, h: 460 },
        onOpen: render
      });
    },
    render: function () { if (float && float.isOpen()) render(); },
    renderList: renderList,
    add: add, toggle: toggle, remove: remove, colorOf: colorOf, editDialog: editDialog,
    COLORS: COLORS
  };
})();
