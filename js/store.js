/* ==========================================================================
   MW.store — LocalStorage 단일 원본 저장소
   · 모든 위젯은 이 저장소 하나만 바라봅니다 (Single Source of Truth).
   · update() 한 번이면 저장 + 구독자 전체 리렌더.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util;

  var KEY = 'mw.v1';       // 저장 키는 유지하고, 안쪽 version 으로 스키마를 올립니다
  var VERSION = 2;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function catsOf(names) {
    return names.map(function (n) { return { id: 'c-' + n, name: n }; });
  }

  function defaults() {
    return {
      version: VERSION,
      settings: {
        wakeHour: 7,          // 일간 뷰 타임라인 시작 시각
        weekStart: 1,         // 한 주의 시작 요일 (0=일 … 6=토)
        notify: true,         // 브라우저 알림 사용
        sound: true,          // 알람 소리 사용
        icalUrl: '',
        sidebarCollapsed: false,
        floats: {},           // 플로팅 창 위치·크기 기억
        habitPanelOpen: true  // 캘린더 상단 해빗 트래커 펼침 여부
      },
      pomodoro: { work: 25, shortBreak: 5, longBreak: 15, repeat: 4 },  // legacy 파이썬 앱과 동일한 기본값
      motto: { text: '', date: '' },   // 오늘의 마음가짐 (홈에서만 표시, 체크 없음)
      playlists: [],
      player: { playlistId: null, index: 0, mode: 'seq' },
      todoGroups: [
        { id: 'g-work', name: '업무메모', color: '#6b8afd' },
        { id: 'g-personal', name: '개인일정', color: '#4ade80' },
        { id: 'g-etc', name: '기타', color: '#8b90a5' }
      ],
      todos: [],
      memos: [],
      habits: [],           // {id, name, color, times:['15:00',…] — 개수 = 하루 목표 횟수}
      habitLog: {},         // 'YYYY-MM-DD' → { habitId: { done:['15:00'], pass:['18:00'] } }
      events: [],
      ledger: {
        types: [
          { id: 't-income', name: '수입', kind: 'income', categories: catsOf(['MG/RS', '주식', '예금/기타']) },
          { id: 't-work', name: '업무', kind: 'expense', categories: catsOf(['어시비', '소재비', '소프트웨어', '하드웨어', '도서/기타']) },
          { id: 't-var', name: '지출(변동)', kind: 'expense', categories: catsOf(['식비', '병원', '관리/공과금', '쇼핑/여가', '교통/기타']) },
          { id: 't-fix', name: '지출(고정)', kind: 'expense', categories: catsOf(['보험', '통신비']) },
          { id: 't-tax', name: '세금', kind: 'expense', categories: catsOf(['소득세', '부가세', '기타']) },
          { id: 't-save', name: '저축', kind: 'expense', categories: catsOf(['적금', '투자']) },
          { id: 't-repay', name: '상환', kind: 'expense', categories: catsOf(['대출', '카드']) }
        ],
        tx: [],
        budgets: {},
        carry: {},
        assistants: [],
        vat: {}          // 'YYYY-반기' -> 직접 입력한 세액
      }
    };
  }

  var state = defaults();
  var subs = [];
  var writeFailed = false;

  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); }
    catch (e) { U.toast('브라우저 저장소를 읽을 수 없습니다. 시크릿 모드에서는 데이터가 유지되지 않습니다.', 'warn'); }
    if (!raw) return defaults();
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { U.toast('저장된 데이터를 읽지 못해 초기 상태로 시작합니다.', 'err'); return defaults(); }
    return migrate(parsed);
  }

  /** 저장 스키마가 바뀌어도 기존 데이터를 잃지 않도록 기본값과 병합 */
  function migrate(data) {
    var base = defaults();
    if (!data || typeof data !== 'object') return base;
    var out = Object.assign({}, base, data);
    out.version = VERSION;
    out.settings = Object.assign({}, base.settings, data.settings || {});
    out.pomodoro = Object.assign({}, base.pomodoro, data.pomodoro || {});
    out.player = Object.assign({}, base.player, data.player || {});
    out.ledger = Object.assign({}, base.ledger, data.ledger || {});
    ['playlists', 'todoGroups', 'todos', 'memos', 'habits', 'events'].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = base[k];
    });
    if (!out.habitLog || typeof out.habitLog !== 'object') out.habitLog = {};

    /* v1 → v2 -------------------------------------------------------------
       · goals[] (여러 개 + 완료 체크) → motto 한 줄
       · habitLog[day] = [habitId,…] (했다/안했다) → { habitId: {done, pass} } (횟수)
       · habits[].times 신설 (알람 시각 목록 = 하루 목표 횟수)                */
    if (!out.motto || typeof out.motto !== 'object') out.motto = { text: '', date: '' };
    if (Array.isArray(data.goals) && !out.motto.text) {
      var today = new Date();
      var ymd = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
      var carry = data.goals.filter(function (g) { return g && g.date === ymd && !g.done; })[0]
        || data.goals.filter(function (g) { return g && g.date === ymd; })[0];
      if (carry) out.motto = { text: String(carry.text || ''), date: ymd };
    }
    delete out.goals;

    out.habits = out.habits.map(function (h) {
      if (!h || typeof h !== 'object') return h;
      if (!Array.isArray(h.times)) h.times = [];
      return h;
    });

    Object.keys(out.habitLog).forEach(function (day) {
      var v = out.habitLog[day];
      if (Array.isArray(v)) {
        var obj = {};
        v.forEach(function (id) { obj[id] = { done: ['-'], pass: [] }; });
        out.habitLog[day] = obj;
      } else if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (id) {
          var e = v[id];
          if (!e || typeof e !== 'object') { v[id] = { done: ['-'], pass: [] }; return; }
          if (!Array.isArray(e.done)) e.done = [];
          if (!Array.isArray(e.pass)) e.pass = [];
        });
      } else {
        delete out.habitLog[day];
      }
    });
    if (!Array.isArray(out.ledger.types) || !out.ledger.types.length) out.ledger.types = base.ledger.types;
    if (!Array.isArray(out.ledger.tx)) out.ledger.tx = [];
    if (!Array.isArray(out.ledger.assistants)) out.ledger.assistants = [];
    ['budgets', 'carry', 'vat'].forEach(function (k) {
      if (!out.ledger[k] || typeof out.ledger[k] !== 'object') out.ledger[k] = {};
    });
    return out;
  }

  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      writeFailed = false;
    } catch (e) {
      if (!writeFailed) {
        writeFailed = true;
        U.toast('저장에 실패했습니다 (저장 공간 초과 또는 사생활 보호 모드).', 'err');
      }
    }
  }

  var scheduleWrite = U.debounce(write, 150);

  function emit() {
    subs.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error('[store] 구독자 오류', e); }
    });
  }

  var store = {
    get state() { return state; },

    load: function () { state = read(); return state; },

    /** update(function (s) { s.todos.push(...) }) — 변경 후 저장 + 전체 알림 */
    update: function (fn) {
      if (typeof fn === 'function') fn(state);
      scheduleWrite();
      emit();
      return state;
    },

    /** 저장만 하고 리렌더는 하지 않음 (타이머처럼 초당 갱신되는 값) */
    touch: function (fn) {
      if (typeof fn === 'function') fn(state);
      scheduleWrite();
    },

    on: function (fn) { subs.push(fn); return fn; },

    flush: write,

    /* ------------------------------------------------------ 백업 / 복구 */

    exportJson: function () {
      return JSON.stringify(state, null, 2);
    },

    importJson: function (text) {
      var parsed = JSON.parse(text);          // 실패 시 호출부에서 catch
      state = migrate(parsed);
      write();
      emit();
    },

    reset: function () {
      state = defaults();
      write();
      emit();
    },

    defaults: defaults
  };

  MW.store = store;
})();
