/* ==========================================================================
   MW.motto — 오늘의 마음가짐 (홈에서만 표시)
   체크박스도 목록도 없습니다. 한 줄로 오늘의 태도를 적어두는 자리입니다.
   (완료 체크가 필요한 것은 투두리스트가 맡습니다)
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  /** 날짜가 바뀌면 어제 문구는 흐리게 보여주고, 새로 쓰면 오늘 것으로 바뀝니다 */
  function current() {
    var m = MW.store.state.motto || { text: '', date: '' };
    return { text: m.text || '', date: m.date || '', stale: !!m.text && m.date !== U.ymd(new Date()) };
  }

  function save(text) {
    var v = String(text || '').trim();
    MW.store.update(function (s) {
      s.motto = { text: v, date: U.ymd(new Date()) };
    });
  }

  function node() {
    var m = current();
    var input = el('input.motto-input', {
      value: m.stale ? '' : m.text,
      maxlength: '80',
      placeholder: m.stale ? '어제: ' + m.text : '오늘 어떤 마음으로 작업할까요?',
      onchange: function () { save(this.value); },
      onkeydown: function (e) { if (e.key === 'Enter') this.blur(); }
    });

    return el('div.motto', {}, [
      el('span.motto-label', { text: '오늘의 마음가짐' }),
      input,
      m.text && !m.stale ? el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '✕', title: '지우기', onclick: function () { save(''); }
      }) : null
    ]);
  }

  MW.motto = { node: node, save: save, current: current };
})();
