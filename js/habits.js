/* ==========================================================================
   MW.habits — 해빗 트래커 (독립 위젯이 아니라 캘린더 월/주/일 뷰에 내장)
   · 체크 방식은 단순 체크(했다/안했다)만, 매일 반복.
   · habitLog['YYYY-MM-DD'] = [완료한 해빗 id...]
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  function all() {
    return MW.store.state.habits.filter(function (h) { return !h.archived; });
  }

  function logOf(day) {
    var l = MW.store.state.habitLog[day];
    return Array.isArray(l) ? l : [];
  }

  function isDone(habitId, day) { return logOf(day).indexOf(habitId) >= 0; }

  function toggle(habitId, day) {
    MW.store.update(function (s) {
      var list = Array.isArray(s.habitLog[day]) ? s.habitLog[day] : [];
      var i = list.indexOf(habitId);
      if (i >= 0) list.splice(i, 1); else list.push(habitId);
      if (list.length) s.habitLog[day] = list;
      else delete s.habitLog[day];
    });
  }

  /** 기준일부터 거꾸로 세는 연속 달성일. 오늘 아직 안 했으면 어제까지를 셉니다. */
  function streak(habitId, day) {
    var d = U.parseYmd(day) || new Date();
    var n = 0;
    if (!isDone(habitId, U.ymd(d))) d = U.addDays(d, -1);
    while (isDone(habitId, U.ymd(d))) { n += 1; d = U.addDays(d, -1); }
    return n;
  }

  function add(name, color) {
    name = String(name || '').trim();
    if (!name) return null;
    var id = U.uid('habit');
    MW.store.update(function (s) {
      s.habits.push({
        id: id, name: name,
        color: color || MW.todo.COLORS[s.habits.length % MW.todo.COLORS.length],
        createdAt: U.ymd(new Date()), archived: false
      });
    });
    return id;
  }

  function remove(id) {
    MW.store.update(function (s) {
      s.habits = s.habits.filter(function (h) { return h.id !== id; });
      Object.keys(s.habitLog).forEach(function (d) {
        s.habitLog[d] = s.habitLog[d].filter(function (x) { return x !== id; });
        if (!s.habitLog[d].length) delete s.habitLog[d];
      });
    });
  }

  /** 월간 칸에 찍는 ●○ 점. 아직 오지 않은 날은 점을 찍지 않아 화면이 조용하도록 합니다. */
  function dots(day) {
    var list = all();
    if (!list.length) return null;
    var doneAny = logOf(day).length > 0;
    if (!doneAny && day > U.ymd(new Date())) return null;
    var wrap = el('div.hb-dots');
    list.slice(0, 6).forEach(function (h) {
      var on = isDone(h.id, day);
      wrap.appendChild(el('span.hb-dot' + (on ? '.on' : ''), {
        title: h.name + (on ? ' — 완료' : ''),
        style: on ? { background: h.color } : {}
      }));
    });
    return wrap;
  }

  /** 주간 컬럼의 체크박스 줄 */
  function weekRow(day) {
    var list = all();
    if (!list.length) return null;
    return el('div.hb-week', {}, list.map(function (h) {
      var on = isDone(h.id, day);
      return el('button.hb-chip' + (on ? '.on' : ''), {
        title: h.name,
        style: on ? { background: h.color, borderColor: h.color, color: '#0f1117' } : {},
        text: h.name.slice(0, 4),
        onclick: function () { toggle(h.id, day); }
      });
    }));
  }

  /** 일간 뷰: 전체 목록 + 연속 달성일 */
  function dayList(day) {
    var list = all();
    if (!list.length) {
      return el('div.empty', { text: '해빗이 없습니다. 설정 → 해빗에서 추가해 주세요.' });
    }
    return el('div.hb-list', {}, list.map(function (h) {
      var on = isDone(h.id, day);
      var s = streak(h.id, day);
      return el('div.hb-item' + (on ? '.on' : ''), {}, [
        el('input.chk', {
          type: 'checkbox', checked: on,
          onchange: function () { toggle(h.id, day); }
        }),
        el('span.hb-name', { text: h.name }),
        el('span.hb-streak', { text: s > 0 ? '🔥 ' + s + '일' : '—' })
      ]);
    }));
  }

  MW.habits = {
    all: all, isDone: isDone, toggle: toggle, streak: streak,
    add: add, remove: remove, dots: dots, weekRow: weekRow, dayList: dayList
  };
})();
