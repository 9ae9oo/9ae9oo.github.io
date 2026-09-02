/* ==========================================================================
   MW.memo — 포스트잇 메모 (오른쪽 도킹 패널 / 모바일 하단 시트)
   · 패널 헤더 = 태그 필터. 그 아래 고정 입력줄(높이 조절 가능)에서 새 메모 추가.
   · 카드 색 = 그 메모의 태그 색 (memoTags[].color). 태그를 바꾸면 색도 바뀝니다.
   · 카드 본문을 누르면 마크다운 원문 편집 → 포커스가 빠지면 다시 서식 표시. (툴바 없음)
     **굵게**  *기울임*  - 목록  - [ ] 할일  > 인용  `코드`
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  /* 태그 색 편집기(설정 → 메모 태그)에서 고르는 팔레트 */
  var COLORS = ['#fbbf24', '#6b8afd', '#4ade80', '#fb7185', '#a78bfa', '#2dd4bf'];
  var float = null;
  var tabsHost = null;
  var composeHost = null;
  var filterGroup = 'all';

  /** 메모의 분류 = 태그. 일정 카테고리(todoGroups)와 분리된 memoTags 만 씁니다. */
  function groups() { return MW.store.state.memoTags; }

  function tagColor(groupId) {
    var g = groups().find(function (x) { return x.id === groupId; });
    return (g && g.color) || COLORS[0];
  }

  function patch(id, fn) {
    MW.store.touch(function (s) {
      var m = s.memos.find(function (x) { return x.id === id; });
      if (m) fn(m);
    });
  }

  function autoGrow(ta, min, max) {
    ta.style.height = 'auto';
    ta.style.height = U.clamp(ta.scrollHeight, min || 48, max || 9999) + 'px';
  }

  function show(node, on) { node.classList.toggle('hidden', !on); }

  /* ---------------------------------------------------------------- 카드 */

  function card(m) {
    var color = tagColor(m.groupId);

    var view = el('div.memo-view.md', {
      onclick: function (e) {
        if (e.target.closest('a')) return;   // 링크는 그대로 열리게
        toEdit();
      }
    });
    function renderView() {
      view.innerHTML = (m.body || '').trim()
        ? MW.markdown.render(m.body)          // render() 내부에서 이스케이프 처리됨
        : '<span class="memo-empty">빈 메모 — 눌러서 입력</span>';
    }
    renderView();

    var ta = el('textarea.memo-input', {
      placeholder: '**굵게**  *기울임*  - 목록  - [ ] 할일  > 인용',
      oninput: function () {
        var v = this.value;
        autoGrow(this, 48);
        patch(m.id, function (x) { x.body = v; });
      },
      onblur: function () {
        renderView();
        show(view, true);
        show(ta, false);
      }
    });
    show(ta, false);

    function toEdit() {
      ta.value = m.body || '';
      show(view, false);
      show(ta, true);
      ta.focus();
      var end = ta.value.length;
      ta.setSelectionRange(end, end);
      autoGrow(ta, 48);
    }

    var title = el('input.m-title', {
      value: m.title, maxlength: '60', placeholder: '제목 (선택)',
      oninput: function () { var v = this.value; patch(m.id, function (x) { x.title = v; }); }
    });

    var del = el('button.memo-del', {
      type: 'button', title: '삭제', 'aria-label': '메모 삭제', text: '✕',
      onclick: function () {
        MW.shell.confirm('"' + (m.title || (m.body || '메모').slice(0, 20)) + '" 을(를) 삭제할까요?', function () {
          MW.store.update(function (s) {
            s.memos = s.memos.filter(function (y) { return y.id !== m.id; });
          });
        });
      }
    });

    var tag = el('select.memo-tag', {
      title: '태그 (색)',
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

    return el('div.memo-card', {
      dataset: { memo: m.id },
      style: { background: U.rgbaOf(color, 0.16), borderColor: U.rgbaOf(color, 0.42) }
    }, [
      el('div.memo-head', {}, [title, del]),
      el('div.memo-body', {}, [view, ta]),
      el('div.memo-foot', {}, [tag])
    ]);
  }

  /* ---------------------------------------------------- 헤더의 태그 필터 */

  function renderTabs() {
    if (!tabsHost) return;
    U.clear(tabsHost);
    function tab(id, label) {
      return el('button.todo-tab' + (filterGroup === id ? '.active' : ''), {
        type: 'button', text: label,
        onclick: function () { filterGroup = id; render(); }
      });
    }
    tabsHost.appendChild(tab('all', '전체'));
    groups().forEach(function (g) { tabsHost.appendChild(tab(g.id, g.name)); });
  }

  /* ------------------------------------------- 상단 고정 입력줄 (높이 조절) */

  function renderCompose() {
    if (!composeHost) return;
    var prev = composeHost.querySelector('.memo-compose-input');
    var draft = prev ? prev.value : '';
    var savedH = prev ? prev.style.height : '';   // 사용자가 드래그로 조절한 높이 유지
    U.clear(composeHost);

    var input = el('textarea.memo-compose-input', {
      rows: '3', placeholder: '메모 입력…  (Enter 저장 · Shift+Enter 줄바꿈 · 우하단 모서리로 높이 조절)', value: draft,
      // 내용이 넘칠 때만 늘리고, 줄이지는 않음 → 드래그로 키운 높이를 되돌리지 않습니다
      oninput: function () { if (this.scrollHeight > this.clientHeight) this.style.height = this.scrollHeight + 'px'; },
      onkeydown: function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      }
    });
    if (savedH) input.style.height = savedH;

    function submit() {
      var text = input.value.trim();
      if (!text) return;
      var gs = groups();
      var gid = filterGroup !== 'all' ? filterGroup : (gs[0] ? gs[0].id : null);
      MW.store.update(function (s) {
        s.memos.unshift({ id: U.uid('memo'), title: '', body: text, groupId: gid, color: '' });
      });
      input.value = '';
      input.focus();
      setTimeout(function () { if (float) float.body.scrollTop = 0; }, 60);
    }

    composeHost.appendChild(input);
    composeHost.appendChild(el('button.btn.btn-primary.btn-sm.memo-compose-add', {
      type: 'button', text: '＋', 'aria-label': '메모 추가', onclick: submit
    }));
  }

  /* ---------------------------------------------------------------- 리스트 */

  function render() {
    if (!float) return;
    renderTabs();
    renderCompose();
    U.clear(float.body);

    var list = MW.store.state.memos.filter(function (m) {
      return filterGroup === 'all' || m.groupId === filterGroup;
    });

    if (!list.length) {
      float.body.appendChild(el('div.empty', { text: '메모가 없습니다.\n위 입력줄에 적어 포스트잇을 붙여보세요.' }));
      return;
    }
    list.forEach(function (m) { float.body.appendChild(card(m)); });
  }

  MW.memo = {
    init: function () {
      // 데스크톱: 오른쪽 도킹 패널 / 모바일: 아래에서 올라오는 시트 (shell.registerPanel 이 처리)
      float = MW.shell.registerPanel('memo', { title: '', onOpen: render });

      // 헤더의 "메모장" 제목을 지우고 그 자리에 태그 필터를 넣습니다 (공간 절약)
      var head = float.head || float.node.querySelector('.side-panel-head');
      var h3 = head && head.querySelector('h3');
      if (h3) h3.remove();
      tabsHost = el('div.memo-tabs');
      if (head) head.insertBefore(tabsHost, head.firstChild);

      // 입력줄은 스크롤 영역 밖(헤더 바로 아래)에 두어 항상 위에 고정합니다
      composeHost = el('div.memo-compose');
      float.node.insertBefore(composeHost, float.body);

      renderTabs();
      renderCompose();
    },
    render: function () { if (float && float.isOpen()) render(); },
    COLORS: COLORS
  };
})();
