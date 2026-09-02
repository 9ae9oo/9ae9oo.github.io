/* ==========================================================================
   MW.memo — 포스트잇 메모 (플로팅 위젯)
   · 여러 장을 추가/삭제
   · 마크다운: 기호 직접 입력 + 툴바 버튼 둘 다 지원(하이브리드)
   · 입력하는 즉시 아래에 서식이 반영됩니다 (별도 미리보기 모드 없음)
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var COLORS = ['#fbbf24', '#6b8afd', '#4ade80', '#fb7185', '#a78bfa', '#2dd4bf'];
  var float = null;
  var filterGroup = 'all';

  /** 메모의 분류 = 태그. 일정 카테고리(todoGroups)와 분리된 memoTags 만 씁니다. */
  function groups() { return MW.store.state.memoTags; }

  function add() {
    var id = U.uid('memo');
    MW.store.update(function (s) {
      s.memos.unshift({
        id: id,
        title: '새 메모',
        body: '',
        groupId: filterGroup !== 'all' ? filterGroup : (s.memoTags[0] ? s.memoTags[0].id : null),
        color: COLORS[s.memos.length % COLORS.length]
      });
    });
    setTimeout(function () {
      var node = float.body.querySelector('[data-memo="' + id + '"] .memo-input');
      if (node) node.focus();
    }, 30);
  }

  function patch(id, fn) {
    MW.store.touch(function (s) {
      var m = s.memos.find(function (x) { return x.id === id; });
      if (m) fn(m);
    });
  }

  /** 툴바 버튼: 선택 영역을 기호로 감싸거나, 줄 앞에 기호를 붙입니다 */
  function wrap(textarea, before, after, blockPrefix) {
    var v = textarea.value;
    var s = textarea.selectionStart, e = textarea.selectionEnd;
    var sel = v.slice(s, e);
    var out, caret;
    if (blockPrefix) {
      var lineStart = v.lastIndexOf('\n', s - 1) + 1;
      out = v.slice(0, lineStart) + blockPrefix + v.slice(lineStart);
      caret = e + blockPrefix.length;
    } else {
      out = v.slice(0, s) + before + (sel || '') + after + v.slice(e);
      caret = sel ? e + before.length + after.length : s + before.length;
    }
    textarea.value = out;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(54, ta.scrollHeight) + 'px';
  }

  function card(m) {
    var preview = el('div.memo-preview.md');
    preview.innerHTML = MW.markdown.render(m.body);   // render() 내부에서 이스케이프 처리됨

    var ta = el('textarea.memo-input', {
      value: m.body,
      placeholder: '마크다운으로 적어보세요.  **굵게**  *기울임*  - [ ] 할일  > 인용  ```코드```',
      oninput: function () {
        var v = this.value;
        preview.innerHTML = MW.markdown.render(v);
        autoGrow(this);
        patch(m.id, function (x) { x.body = v; });
      }
    });

    var tools = el('div.memo-tools', {}, [
      el('button', { text: 'B', title: '굵게', style: { fontWeight: '700' }, onclick: function () { wrap(ta, '**', '**'); } }),
      el('button', { text: 'I', title: '기울임', style: { fontStyle: 'italic' }, onclick: function () { wrap(ta, '*', '*'); } }),
      el('button', { text: 'U', title: '밑줄', style: { textDecoration: 'underline' }, onclick: function () { wrap(ta, '__', '__'); } }),
      el('button', { text: 'S', title: '취소선', style: { textDecoration: 'line-through' }, onclick: function () { wrap(ta, '~~', '~~'); } }),
      el('button', { text: '☑', title: '체크박스', onclick: function () { wrap(ta, '', '', '- [ ] '); } }),
      el('button', { text: '•', title: '목록', onclick: function () { wrap(ta, '', '', '- '); } }),
      el('button', { text: '❝', title: '인용', onclick: function () { wrap(ta, '', '', '> '); } }),
      el('button', { text: '</>', title: '코드', onclick: function () { wrap(ta, '`', '`'); } }),
      el('button', { text: '🔗', title: '링크', onclick: function () { wrap(ta, '[', '](https://)'); } }),
      el('button', { text: '—', title: '구분선', onclick: function () { wrap(ta, '', '', '---\n'); } })
    ]);

    var groupSelect = el('select.field', {
      onchange: function () {
        var v = this.value;
        MW.store.update(function (s) {
          var x = s.memos.find(function (y) { return y.id === m.id; });
          if (x) x.groupId = v;
        });
      }
    }, groups().map(function (g) {
      return el('option', { value: g.id, text: g.name, selected: g.id === m.groupId });
    }));

    var node = el('div.memo-card', { dataset: { memo: m.id }, style: { borderLeftColor: m.color || COLORS[0] } }, [
      el('div.memo-head', {}, [
        el('input.m-title', {
          value: m.title, maxlength: '60',
          oninput: function () { var v = this.value; patch(m.id, function (x) { x.title = v; }); }
        }),
        groupSelect,
        el('button.btn.btn-ghost.btn-icon.btn-sm', {
          text: '🎨', title: '색 바꾸기',
          onclick: function () {
            var next = COLORS[(COLORS.indexOf(m.color) + 1) % COLORS.length];
            MW.store.update(function (s) {
              var x = s.memos.find(function (y) { return y.id === m.id; });
              if (x) x.color = next;
            });
          }
        }),
        el('button.btn.btn-ghost.btn-icon.btn-sm', {
          text: '✕', title: '메모 삭제',
          onclick: function () {
            MW.shell.confirm('"' + m.title + '" 메모를 삭제할까요?', function () {
              MW.store.update(function (s) {
                s.memos = s.memos.filter(function (y) { return y.id !== m.id; });
              });
            });
          }
        })
      ]),
      tools,
      ta,
      preview
    ]);
    setTimeout(function () { autoGrow(ta); }, 0);
    return node;
  }

  function render() {
    if (!float) return;
    U.clear(float.body);

    var tabs = el('div.todo-tabs', {}, [
      el('button.todo-tab' + (filterGroup === 'all' ? '.active' : ''), {
        text: '전체', onclick: function () { filterGroup = 'all'; render(); }
      })
    ].concat(groups().map(function (g) {
      return el('button.todo-tab' + (filterGroup === g.id ? '.active' : ''), {
        text: g.name, onclick: function () { filterGroup = g.id; render(); }
      });
    })));

    float.body.appendChild(tabs);
    float.body.appendChild(el('div.memo-toolbar-top', {}, [
      el('button.btn.btn-primary.btn-sm', { text: '＋ 새 메모', onclick: add }),
      el('span.spacer')
    ]));

    var list = MW.store.state.memos.filter(function (m) {
      return filterGroup === 'all' || m.groupId === filterGroup;
    });

    if (!list.length) {
      float.body.appendChild(el('div.empty', { text: '메모가 없습니다.\n＋ 새 메모로 포스트잇을 붙여보세요.' }));
      return;
    }
    list.forEach(function (m) { float.body.appendChild(card(m)); });
  }

  MW.memo = {
    init: function () {
      // 데스크톱: 오른쪽 도킹 패널 / 모바일: 아래에서 올라오는 시트 (shell.registerPanel 이 처리)
      float = MW.shell.registerPanel('memo', {
        title: '📝 메모장',
        onOpen: render
      });
    },
    render: function () { if (float && float.isOpen()) render(); },
    COLORS: COLORS
  };
})();
