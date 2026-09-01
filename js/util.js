/* ==========================================================================
   MW.util — 공통 유틸 (DOM / 날짜 / 포맷 / 이스케이프)
   ES module을 쓰지 않는 이유: file:// 로 더블클릭해서 열어도 동작해야 하기 때문.
   전역 네임스페이스 MW 하나에 모듈을 담고, index.html 에서 순서대로 로드합니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------------------------------------------------------------- DOM */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /**
   * el('div.card', {onclick: fn, title: 'x'}, ['텍스트', otherEl])
   * 태그 문자열에 .class 와 #id 를 붙여 쓸 수 있습니다.
   */
  function el(tag, attrs, children) {
    var spec = String(tag);
    if (spec.charAt(0) === '.' || spec.charAt(0) === '#') spec = 'div' + spec;   // '.card' → 'div.card'
    var m = spec.split(/(?=[.#])/);
    var node = document.createElement(m[0] || 'div');
    for (var i = 1; i < m.length; i++) {
      if (m[i][0] === '.') node.classList.add(m[i].slice(1));
      else node.id = m[i].slice(1);
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') { String(v).split(/\s+/).filter(Boolean).forEach(function (c) { node.classList.add(c); }); }
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;           // 호출부에서 이스케이프 책임
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) { children.forEach(function (c) { append(node, c); }); return node; }
    node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  function on(node, type, sel, fn) {
    // 위임 이벤트: on(list, 'click', '.item', fn)
    node.addEventListener(type, function (e) {
      var t = e.target.closest(sel);
      if (t && node.contains(t)) fn.call(t, e, t);
    });
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* --------------------------------------------------------------- 날짜 */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Date -> 'YYYY-MM-DD' (로컬 기준. toISOString 은 UTC라 날짜가 밀릴 수 있어 쓰지 않음) */
  function ymd(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  /** 'YYYY-MM' */
  function ym(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }

  /** 'YYYY-MM-DD' -> Date(로컬 자정) */
  function parseYmd(s) {
    if (!s) return null;
    var p = String(s).split('-');
    if (p.length < 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function addMonths(d, n) { var x = new Date(d.getFullYear(), d.getMonth() + n, 1); return x; }
  /** 한 주의 시작일. 시작 요일은 설정(settings.weekStart, 0=일 … 6=토)을 따릅니다. */
  function weekStart() {
    var s = MW.store && MW.store.state && MW.store.state.settings;
    var v = s ? +s.weekStart : 1;
    return isNaN(v) ? 1 : clamp(v, 0, 6);
  }
  function startOfWeek(d) {
    var offset = (d.getDay() - weekStart() + 7) % 7;
    return addDays(d, -offset);
  }
  /** 그 주에 표시할 요일 이름을 시작 요일 기준으로 회전시켜 반환 */
  function weekdayNames() {
    var w = weekStart();
    return WEEKDAYS.slice(w).concat(WEEKDAYS.slice(0, w));
  }
  function isSameDay(a, b) { return a && b && ymd(a) === ymd(b); }
  function isToday(d) { return ymd(d) === ymd(new Date()); }

  /** 그 달의 달력 격자(6주 × 7일)를 Date 배열로 */
  function monthGrid(year, month) {
    var first = new Date(year, month, 1);
    var start = startOfWeek(first);
    var cells = [];
    for (var i = 0; i < 42; i++) cells.push(addDays(start, i));
    return cells;
  }

  function daysBetween(a, b) {
    return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  }

  function fmtDate(s) {
    var d = typeof s === 'string' ? parseYmd(s) : s;
    if (!d) return '';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAYS[d.getDay()] + ')';
  }
  function fmtLongDate(s) {
    var d = typeof s === 'string' ? parseYmd(s) : s;
    if (!d) return '';
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAYS[d.getDay()] + ')';
  }
  /** 분(0~1439) -> 'HH:MM' */
  function fmtMin(min) { return pad2(Math.floor(min / 60) % 24) + ':' + pad2(min % 60); }
  /** 'HH:MM' -> 분 */
  function parseMin(s) {
    if (!s) return null;
    var p = String(s).split(':');
    if (p.length < 2) return null;
    return (+p[0]) * 60 + (+p[1]);
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }

  /* --------------------------------------------------------------- 숫자 */

  function won(n) { return (Math.round(+n || 0)).toLocaleString('ko-KR') + '원'; }
  function num(n) { return (Math.round(+n || 0)).toLocaleString('ko-KR'); }
  /** '1,200,000' 같은 입력에서 숫자만 뽑기 */
  function parseNum(s) {
    var v = parseFloat(String(s === null || s === undefined ? '' : s).replace(/[^0-9.\-]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  /* --------------------------------------------------------------- 기타 */

  var _seq = 0;
  function uid(prefix) {
    _seq += 1;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + _seq.toString(36);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  }

  /** http/https 만 통과시킴 (javascript: 등 차단) */
  function safeUrl(u) {
    var s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function toast(msg, kind) {
    var wrap = $('#toast-wrap');
    if (!wrap) return;
    var t = el('div.toast', { text: msg });
    if (kind) t.classList.add(kind);
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, kind === 'err' ? 4200 : kind === 'save' ? 1100 : 2400);
  }

  MW.util = {
    WEEKDAYS: WEEKDAYS,
    $: $, $$: $$, el: el, append: append, clear: clear, on: on, escapeHtml: escapeHtml,
    pad2: pad2, ymd: ymd, ym: ym, parseYmd: parseYmd, addDays: addDays, addMonths: addMonths,
    startOfWeek: startOfWeek, weekStart: weekStart, weekdayNames: weekdayNames,
    isSameDay: isSameDay, isToday: isToday, monthGrid: monthGrid,
    daysBetween: daysBetween, fmtDate: fmtDate, fmtLongDate: fmtLongDate,
    fmtMin: fmtMin, parseMin: parseMin, fmtClock: fmtClock,
    won: won, num: num, parseNum: parseNum,
    uid: uid, clamp: clamp, debounce: debounce, safeUrl: safeUrl, toast: toast
  };
})();
