/* ==========================================================================
   MW.habits — 해빗 트래커 (알람 + 횟수)
   · 해빗마다 알람 시각을 여러 개 등록합니다. 알람 개수가 곧 하루 목표 횟수입니다.
     (물 6잔 = 알람 6개. 최대 12개)
   · 알람이 울리면 [체크] 또는 [패스] 를 고르고, 체크한 만큼 그날 횟수가 쌓입니다.
   · 알람을 하나도 등록하지 않으면 하루 1회 단순 체크형으로 동작합니다.

   저장 형태: habitLog['YYYY-MM-DD'][habitId] = { done: ['15:00'], pass: ['18:00'] }
             알람 없는 해빗의 체크는 '-' 한 칸으로 기록합니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var MAX_TIMES = 12;
  var SIMPLE = '-';           // 알람 없는 해빗의 슬롯 키

  /* ------------------------------------------------------------ 조회 */

  function all() {
    return MW.store.state.habits.filter(function (h) { return !h.archived; });
  }

  function timesOf(h) { return Array.isArray(h.times) ? h.times : []; }

  /** 하루 목표 횟수 = 알람 개수 (알람이 없으면 1회) */
  function targetOf(h) { return Math.max(1, timesOf(h).length); }

  /** 그 해빗이 그날 쓰는 슬롯 목록 */
  function slotsOf(h) {
    var t = timesOf(h);
    return t.length ? t.slice() : [SIMPLE];
  }

  function entry(habitId, day) {
    var log = MW.store.state.habitLog[day];
    var e = log && log[habitId];
    return {
      done: (e && Array.isArray(e.done)) ? e.done : [],
      pass: (e && Array.isArray(e.pass)) ? e.pass : []
    };
  }

  function countOf(habitId, day) { return entry(habitId, day).done.length; }

  function isDone(habitId, day) {
    var h = MW.store.state.habits.find(function (x) { return x.id === habitId; });
    if (!h) return false;
    return countOf(habitId, day) >= targetOf(h);
  }

  /** 그 슬롯의 상태: 'done' | 'pass' | null */
  function slotState(habitId, day, slot) {
    var e = entry(habitId, day);
    if (e.done.indexOf(slot) >= 0) return 'done';
    if (e.pass.indexOf(slot) >= 0) return 'pass';
    return null;
  }

  /* ------------------------------------------------------------ 기록 */

  function writeEntry(s, habitId, day, fn) {
    if (!s.habitLog[day]) s.habitLog[day] = {};
    var e = s.habitLog[day][habitId];
    if (!e || !Array.isArray(e.done)) e = { done: [], pass: [] };
    fn(e);
    if (e.done.length || e.pass.length) s.habitLog[day][habitId] = e;
    else delete s.habitLog[day][habitId];
    if (!Object.keys(s.habitLog[day]).length) delete s.habitLog[day];
  }

  /** 슬롯 하나를 done / pass / 해제(null) 로 설정 */
  function setSlot(habitId, day, slot, state) {
    MW.store.update(function (s) {
      writeEntry(s, habitId, day, function (e) {
        e.done = e.done.filter(function (x) { return x !== slot; });
        e.pass = e.pass.filter(function (x) { return x !== slot; });
        if (state === 'done') e.done.push(slot);
        else if (state === 'pass') e.pass.push(slot);
      });
    });
  }

  /** 칸 클릭: 비어 있는 슬롯을 앞에서부터 하나 채웁니다. 다 찼으면 그날을 비웁니다. */
  function bump(habitId, day) {
    var h = MW.store.state.habits.find(function (x) { return x.id === habitId; });
    if (!h) return;
    var slots = slotsOf(h);
    var e = entry(habitId, day);
    if (e.done.length >= slots.length) { clearDay(habitId, day); return; }
    var next = slots.filter(function (sl) { return e.done.indexOf(sl) < 0; })[0];
    setSlot(habitId, day, next === undefined ? SIMPLE : next, 'done');
  }

  function clearDay(habitId, day) {
    MW.store.update(function (s) {
      if (s.habitLog[day]) {
        delete s.habitLog[day][habitId];
        if (!Object.keys(s.habitLog[day]).length) delete s.habitLog[day];
      }
    });
  }

  /** 단순 체크형(알람 없음) 토글 — 기존 체크박스 UI 용 */
  function toggle(habitId, day) {
    var h = MW.store.state.habits.find(function (x) { return x.id === habitId; });
    if (!h) return;
    if (timesOf(h).length) { bump(habitId, day); return; }
    setSlot(habitId, day, SIMPLE, slotState(habitId, day, SIMPLE) === 'done' ? null : 'done');
  }

  /** 기준일부터 거꾸로 세는 연속 달성일. 오늘 아직 못 채웠으면 어제까지를 셉니다. */
  function streak(habitId, day) {
    var d = U.parseYmd(day) || new Date();
    var n = 0;
    if (!isDone(habitId, U.ymd(d))) d = U.addDays(d, -1);
    while (isDone(habitId, U.ymd(d))) { n += 1; d = U.addDays(d, -1); }
    return n;
  }

  /* ------------------------------------------------------------ 관리 */

  function add(name, color) {
    name = String(name || '').trim();
    if (!name) return null;
    var id = U.uid('habit');
    MW.store.update(function (s) {
      s.habits.push({
        id: id, name: name,
        color: color || MW.todo.COLORS[s.habits.length % MW.todo.COLORS.length],
        times: [],
        createdAt: U.ymd(new Date()), archived: false
      });
    });
    return id;
  }

  function patch(id, fn) {
    MW.store.update(function (s) {
      var h = s.habits.find(function (x) { return x.id === id; });
      if (h) fn(h);
    });
  }

  function addTime(id, hhmm) {
    var min = U.parseMin(hhmm);
    if (min === null || isNaN(min)) { U.toast('시각을 입력해 주세요.', 'warn'); return false; }
    var value = U.fmtMin(min);
    var h = MW.store.state.habits.find(function (x) { return x.id === id; });
    if (!h) return false;
    if (timesOf(h).length >= MAX_TIMES) {
      U.toast('알람은 해빗당 최대 ' + MAX_TIMES + '개까지입니다.', 'warn');
      return false;
    }
    if (timesOf(h).indexOf(value) >= 0) { U.toast('이미 등록된 시각입니다.', 'warn'); return false; }
    patch(id, function (x) {
      x.times = timesOf(x).concat([value]).sort();
    });
    return true;
  }

  function removeTime(id, hhmm) {
    patch(id, function (x) {
      x.times = timesOf(x).filter(function (t) { return t !== hhmm; });
    });
  }

  function remove(id) {
    MW.store.update(function (s) {
      s.habits = s.habits.filter(function (h) { return h.id !== id; });
      Object.keys(s.habitLog).forEach(function (d) {
        delete s.habitLog[d][id];
        if (!Object.keys(s.habitLog[d]).length) delete s.habitLog[d];
      });
    });
  }

  /* ------------------------------------------------------------ 알람 */

  /**
   * 지금 울려야 하는 알람과 놓친 알람을 모읍니다.
   * 오늘 날짜의 슬롯 중 시각이 지났고 아직 done/pass 가 아닌 것들.
   */
  function pendingAlarms(now) {
    now = now || new Date();
    var day = U.ymd(now);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var out = [];
    all().forEach(function (h) {
      timesOf(h).forEach(function (t) {
        var min = U.parseMin(t);
        if (min === null || min > nowMin) return;
        if (slotState(h.id, day, t)) return;
        out.push({ habit: h, time: t, min: min, day: day, late: nowMin - min > 2 });
      });
    });
    return out.sort(function (a, b) { return a.min - b.min; });
  }

  MW.habits = {
    MAX_TIMES: MAX_TIMES, SIMPLE: SIMPLE,
    all: all, timesOf: timesOf, targetOf: targetOf, slotsOf: slotsOf,
    entry: entry, countOf: countOf, isDone: isDone, slotState: slotState,
    setSlot: setSlot, bump: bump, clearDay: clearDay, toggle: toggle, streak: streak,
    add: add, patch: patch, addTime: addTime, removeTime: removeTime, remove: remove,
    pendingAlarms: pendingAlarms
  };
})();
