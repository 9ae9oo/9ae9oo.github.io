/* ==========================================================================
   MW.goals — 오늘의 목표 (사이드바 고정 위젯)
   오늘 날짜의 목표만 보여줍니다. 날짜가 바뀌면 자동으로 빈 목록에서 시작.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;
  var container = null;

  function todayGoals() {
    var t = U.ymd(new Date());
    return MW.store.state.goals.filter(function (g) { return g.date === t; });
  }

  function add(text) {
    text = String(text || '').trim();
    if (!text) return;
    MW.store.update(function (s) {
      s.goals.push({ id: U.uid('goal'), text: text, done: false, date: U.ymd(new Date()) });
    });
  }

  function render() {
    if (!container) return;
    U.clear(container);

    var list = el('div.goal-list');
    var goals = todayGoals();
    if (!goals.length) {
      list.appendChild(el('div.empty', { text: '오늘 집중할 일을 적어보세요', style: { padding: '10px 4px' } }));
    }
    goals.forEach(function (g) {
      list.appendChild(el('div.goal-item' + (g.done ? '.done' : ''), {}, [
        el('input.chk', {
          type: 'checkbox', checked: g.done,
          onchange: function () {
            var v = this.checked;
            MW.store.update(function (s) {
              var it = s.goals.find(function (x) { return x.id === g.id; });
              if (it) it.done = v;
            });
          }
        }),
        el('div.g-text', { text: g.text }),
        el('button.btn-x', {
          text: '✕', title: '삭제',
          onclick: function () {
            MW.store.update(function (s) {
              s.goals = s.goals.filter(function (x) { return x.id !== g.id; });
            });
          }
        })
      ]));
    });

    var input = el('input.field', {
      placeholder: '목표 추가 후 Enter', maxlength: '120',
      onkeydown: function (e) { if (e.key === 'Enter') { add(this.value); this.value = ''; } }
    });

    var done = goals.filter(function (g) { return g.done; }).length;
    container.appendChild(el('div', {}, [
      list,
      input,
      goals.length ? el('div.small.dim', {
        text: done + ' / ' + goals.length + ' 완료',
        style: { marginTop: '6px', textAlign: 'right' }
      }) : null
    ]));
  }

  MW.goals = {
    mount: function (node) { container = node; render(); },
    render: render
  };
})();
