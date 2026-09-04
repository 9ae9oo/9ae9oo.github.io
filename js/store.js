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
  var VERSION = 5;

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
        floats: {},           // 플로팅 창 위치·크기 기억
        habitPanelOpen: true, // 캘린더 상단 해빗 트래커 펼침 여부
        pomoPinned: false,    // 앱 실행 시 뽀모도로 창을 자동으로 띄울지 (창 위치·크기는 settings.floats.pomodoro)
        /* 대시보드 위젯 목록. 홈 → "편집"에서 추가·삭제·켜기/끄기·순서 변경.
           { id, type, enabled, config? }
           type: 'today'|'next'|'habits'|'money' (고정 1개씩, 끄기만 가능)
               | 'image'(갤러리)|'minical'(미니 달력)|'embed'(HTML 임베드) — 여러 개 추가 가능
           image.config: { mode:'fixed'|'carousel'|'slideshow', images:[dataURL,…], intervalSec }
           embed.config: { html: '사용자가 붙여넣은 HTML' } */
        homeWidgets: [
          { id: 'image', type: 'image', enabled: false, config: { mode: 'fixed', images: [], intervalSec: 5 } },
          { id: 'today', type: 'today', enabled: true },
          { id: 'next', type: 'next', enabled: true },
          { id: 'habits', type: 'habits', enabled: true },
          { id: 'money', type: 'money', enabled: true }
        ],
        homeCardHeights: {},   // 위젯별 사용자 지정 높이 { [위젯id]: px } — 편집 모드에서 카드 아래쪽을 드래그해 조절. 없으면 기본 높이
        homeCardSpans: {},     // 위젯별 가로 칸수 { [위젯id]: 1~3 } — 3칸 그리드에서 몇 칸을 차지할지. 없으면 3(전체 폭)
        homeCardRowSpans: {},  // 위젯별 세로 칸수 { [위젯id]: 1~3 } — 편집 모드에서 오른쪽 아래 모서리를 드래그. 없으면 1
        reduceMotion: 'auto', // 'auto'(OS 설정) | 'on'(항상 줄임) | 'off'(항상 켬)
        /* 테마 = 프리셋 하나 + 세부 오버라이드. 오버라이드가 빈 문자열이면 프리셋 기본값을 씁니다.
           preset: 'base'|'mint'|'peach'|'lavender'|'butter' (전부 화이트 계열, 파스텔 강조색만 다름)
           accent/bg/card: '#rrggbb' 이면 사용자 지정, '' 이면 프리셋 값
           bgImage: data URL (화면 전체 뒤 배경, 비우면 없음)
           contentWidth: 'narrow'|'normal'|'wide'|'full'|'custom' — 가운데 컨텐츠 최대폭
           contentWidthPx: 'custom' 일 때 쓰는 사용자 지정 픽셀값 (320~2000) */
        theme: { preset: 'base', accent: '', bg: '', card: '', bgImage: '', contentWidth: 'normal', contentWidthPx: 1100 }
      },
      pomodoro: { work: 25, shortBreak: 5, longBreak: 15, repeat: 4, autoNext: false },  // legacy 파이썬 앱과 동일한 기본값
      playlists: [],
      player: { playlistId: null, index: 0, mode: 'seq' },
      /* 일정 카테고리 — 투두 + 캘린더가 함께 씁니다.
         투두 = 캘린더에서 날짜·시간이 아직 정해지지 않은 일정으로 보기 때문에
         두 곳의 분류 체계를 하나로 공유합니다. 카테고리 색이 캘린더 표시색의 기본값이 됩니다. */
      todoGroups: [
        { id: 'g-work', name: '업무', color: '#6b8afd' },
        { id: 'g-personal', name: '개인', color: '#4ade80' },
        { id: 'g-etc', name: '기타', color: '#8b90a5' }
      ],
      todos: [],
      memos: [],
      habits: [],           // {id, name, color, times:['15:00',…] — 개수 = 하루 목표 횟수}
      habitLog: {},         // 'YYYY-MM-DD' → { habitId: { done:['15:00'], pass:['18:00'] } }
      events: [],
      /* 작업 관리 — 작품 → 회차 → 컷 → 공정
         {id, name, archived, episodes:[
           {id, number, title, cutCount, processes:[
             {id, name, order, collapsed, completedCuts:[1,2,3]} ]} ]} */
      works: [],
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
        /* 어시스턴트 — 개인정보 최소화: 계좌·은행·주민번호는 필드 자체를 두지 않습니다
           {id, name, workPart, payBasis:'gross'|'net', defaultPay, taxRate,
            extraRule, memo, archived} */
        assistants: [],
        /* 지급 내역 — 기본정보와 분리해서, 단가가 바뀌어도 과거 기록은 그대로 남습니다
           payBasis·taxRate 는 입력 시점 값을 복사해 고정합니다
           {id, year, assistantId, workDesc, basePay, extraPay, extraCuts,
            payBasis, taxRate, paidAt, reportedAt, memo, txId} */
        payments: [],
        vat: {}          // 'YYYY-1기' -> { amount, memo } 실제 신고/납부 세액 직접 입력
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
    (function () {
      var BUILTIN = ['today', 'next', 'habits', 'money'];
      var MULTI = ['image', 'minical', 'embed'];
      var KNOWN = BUILTIN.concat(MULTI);

      // 구버전(homeOrder 배열 + homeImage 문자열)이면 새 위젯 목록으로 한 번만 변환
      if (!Array.isArray(out.settings.homeWidgets) || !out.settings.homeWidgets.length) {
        var legacyKey = { calendar: 'today', inbox: 'next' };
        var order = Array.isArray(data.settings && data.settings.homeOrder) ? data.settings.homeOrder : BUILTIN;
        var seen = {};
        var widgets = [];
        order.forEach(function (k) {
          var key = legacyKey[k] || k;
          if (BUILTIN.indexOf(key) < 0 || seen[key]) return;
          seen[key] = true;
          widgets.push({ id: key, type: key, enabled: true });
        });
        BUILTIN.forEach(function (key) {
          if (!seen[key]) widgets.push({ id: key, type: key, enabled: true });
        });
        var legacyImg = (data.settings && typeof data.settings.homeImage === 'string') ? data.settings.homeImage : '';
        widgets.unshift({
          id: 'image', type: 'image', enabled: !!legacyImg,
          config: { mode: 'fixed', images: legacyImg ? [legacyImg] : [], intervalSec: 5 }
        });
        out.settings.homeWidgets = widgets;
      }
      delete out.settings.homeOrder;
      delete out.settings.homeImage;
      delete out.settings.homeImageSize;

      // 위젯 목록 정리: 알 수 없는 타입 제거, 고정 위젯(today/next/habits/money)은 하나씩만, id 중복 방지
      var idsSeen = {}, builtinSeen = {};
      out.settings.homeWidgets = out.settings.homeWidgets.filter(function (w) {
        if (!w || typeof w !== 'object' || KNOWN.indexOf(w.type) < 0) return false;
        if (BUILTIN.indexOf(w.type) >= 0) {
          if (builtinSeen[w.type]) return false;
          builtinSeen[w.type] = true;
          w.id = w.type;
        }
        if (typeof w.id !== 'string' || !w.id || idsSeen[w.id]) w.id = U && U.uid ? U.uid(w.type) : (w.type + '-' + Math.random().toString(36).slice(2));
        idsSeen[w.id] = true;
        w.enabled = w.enabled !== false;
        if (w.type === 'image') {
          var c = (w.config && typeof w.config === 'object') ? w.config : {};
          w.config = {
            mode: ['fixed', 'carousel', 'slideshow'].indexOf(c.mode) >= 0 ? c.mode : 'fixed',
            images: Array.isArray(c.images) ? c.images.filter(function (u) { return typeof u === 'string' && u; }).slice(0, 20) : [],
            intervalSec: (typeof c.intervalSec === 'number' && isFinite(c.intervalSec)) ? Math.min(30, Math.max(2, Math.round(c.intervalSec))) : 5
          };
        } else if (w.type === 'embed') {
          var ec = (w.config && typeof w.config === 'object') ? w.config : {};
          w.config = { html: typeof ec.html === 'string' ? ec.html.slice(0, 20000) : '' };
        } else {
          delete w.config;
        }
        return true;
      });
      BUILTIN.forEach(function (key) {
        if (!builtinSeen[key]) out.settings.homeWidgets.push({ id: key, type: key, enabled: true });
      });
    })();
    if (['auto', 'on', 'off'].indexOf(out.settings.reduceMotion) < 0) out.settings.reduceMotion = 'auto';
    (function () {
      var raw = (out.settings.homeCardHeights && typeof out.settings.homeCardHeights === 'object') ? out.settings.homeCardHeights : {};
      var clean = {};
      Object.keys(raw).forEach(function (k) {
        var n = raw[k];
        if (typeof n === 'number' && isFinite(n)) clean[k] = Math.min(800, Math.max(80, Math.round(n)));
      });
      out.settings.homeCardHeights = clean;
    })();
    (function () {
      var raw = (out.settings.homeCardSpans && typeof out.settings.homeCardSpans === 'object') ? out.settings.homeCardSpans : {};
      var clean = {};
      Object.keys(raw).forEach(function (k) {
        if (Number.isInteger(raw[k]) && raw[k] >= 1 && raw[k] <= 3) clean[k] = raw[k];
      });
      out.settings.homeCardSpans = clean;
    })();
    (function () {
      var raw = (out.settings.homeCardRowSpans && typeof out.settings.homeCardRowSpans === 'object') ? out.settings.homeCardRowSpans : {};
      var clean = {};
      Object.keys(raw).forEach(function (k) {
        if (Number.isInteger(raw[k]) && raw[k] >= 1 && raw[k] <= 3) clean[k] = raw[k];
      });
      out.settings.homeCardRowSpans = clean;
    })();
    delete out.settings.pomoScale;   // 구버전 필드 — 이제 창 크기(settings.floats.pomodoro)로 대체
    // theme: 프리셋 + 세부 오버라이드 구조로 정규화. 구버전( { mode, accent } )도 여기서 흡수합니다.
    var th = (out.settings.theme && typeof out.settings.theme === 'object') ? out.settings.theme : {};
    var HEX = /^#[0-9a-fA-F]{6}$/;
    var PRESETS = ['base', 'mint', 'peach', 'lavender', 'butter'];
    // 구버전 기본 강조색(#6b8afd)은 "일부러 고른 값"이 아니므로 오버라이드로 이어받지 않습니다.
    var carryAccent = HEX.test(th.accent || '') && String(th.accent).toLowerCase() !== '#6b8afd';
    out.settings.theme = {
      preset: PRESETS.indexOf(th.preset) >= 0 ? th.preset : 'base',
      accent: carryAccent ? th.accent : '',
      bg: HEX.test(th.bg || '') ? th.bg : '',
      card: HEX.test(th.card || '') ? th.card : '',
      bgImage: typeof th.bgImage === 'string' ? th.bgImage : '',
      contentWidth: ['narrow', 'normal', 'wide', 'full', 'custom'].indexOf(th.contentWidth) >= 0 ? th.contentWidth : 'normal',
      contentWidthPx: (function (n) { return (typeof n === 'number' && isFinite(n)) ? Math.min(2000, Math.max(320, Math.round(n))) : 1100; })(th.contentWidthPx)
    };
    out.pomodoro = Object.assign({}, base.pomodoro, data.pomodoro || {});
    out.player = Object.assign({}, base.player, data.player || {});
    out.ledger = Object.assign({}, base.ledger, data.ledger || {});
    ['playlists', 'todoGroups', 'todos', 'memos', 'habits', 'events', 'works'].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = base[k];
    });
    delete out.memoTags;   // v5: 메모 분류는 본문 #해시태그로 대체됨
    if (!out.habitLog || typeof out.habitLog !== 'object') out.habitLog = {};

    /* v1 → v2 -------------------------------------------------------------
       · habitLog[day] = [habitId,…] (했다/안했다) → { habitId: {done, pass} } (횟수)
       · habits[].times 신설 (알람 시각 목록 = 하루 목표 횟수)
       · (구) goals[] / motto 한 줄 기능은 제거됨 — 남은 데이터는 버립니다      */
    delete out.goals;
    delete out.motto;

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
    if (!Array.isArray(out.ledger.payments)) out.ledger.payments = [];

    /* v2 → v3 -------------------------------------------------------------
       · 어시스턴트 role → workPart 로 이름 변경, 지급 기준 필드 신설
       · 거래에 부가세 구분(vatType)·증빙(evidence) 필드 추가
       · 작업 관리(works) 신설                                             */
    out.ledger.assistants = out.ledger.assistants.map(function (a) {
      if (!a || typeof a !== 'object') return a;
      if (a.workPart === undefined) a.workPart = a.role || '';
      delete a.role;
      if (a.payBasis !== 'net') a.payBasis = 'gross';
      if (typeof a.defaultPay !== 'number') a.defaultPay = 0;
      if (typeof a.taxRate !== 'number') a.taxRate = 3.3;
      if (a.extraRule === undefined) a.extraRule = '';
      if (a.memo === undefined) a.memo = '';
      if (a.archived === undefined) a.archived = false;
      return a;
    });
    out.works = out.works.map(function (w) {
      if (!w || typeof w !== 'object') return w;
      if (!Array.isArray(w.episodes)) w.episodes = [];
      w.episodes.forEach(function (ep) {
        if (!ep || typeof ep !== 'object') return;
        if (!Array.isArray(ep.processes)) ep.processes = [];
        ep.processes.forEach(function (p, i) {
          if (!p || typeof p !== 'object') return;
          if (!Array.isArray(p.completedCuts)) p.completedCuts = [];
          if (typeof p.order !== 'number') p.order = i;
        });
      });
      return w;
    });
    out.ledger.tx = out.ledger.tx.map(function (t) {
      if (!t || typeof t !== 'object') return t;
      if (t.vatType === undefined) t.vatType = 'none';   // taxable | exempt | none
      if (t.evidence === undefined) t.evidence = '';
      if (t.paymentId === undefined) t.paymentId = null;
      return t;
    });
    ['budgets', 'carry', 'vat'].forEach(function (k) {
      if (!out.ledger[k] || typeof out.ledger[k] !== 'object') out.ledger[k] = {};
    });

    // 일정에도 카테고리(선택)를 붙일 수 있게 필드를 추가합니다. 색은 그대로 두고 분류만 기록합니다.
    out.events = out.events.map(function (ev) {
      if (ev && typeof ev === 'object' && ev.categoryId === undefined) ev.categoryId = null;
      return ev;
    });

    /* v4 → v5 -----------------------------------------------------------------
       메모: 제목·카테고리·색 제거 → 본문(정제 HTML) + 작성일 + 잠금 + 북마크.
       분류는 본문 #해시태그로. 기존 memoTags·groupId·color 는 버립니다.       */
    var fromV = parseInt(data.version, 10) || 0;
    out.memos = out.memos.map(function (m) {
      if (!m || typeof m !== 'object') return { id: 'memo-' + Math.random().toString(36).slice(2), body: '', createdAt: Date.now(), updatedAt: Date.now(), locked: false, bookmarked: false };
      var body = typeof m.body === 'string' ? m.body : '';
      if (fromV < 5) {
        // 구버전 본문은 평문(마크다운 기호 포함). 이스케이프 후 최소 서식만 HTML 로 1회 변환.
        body = body
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
          .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
          .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
          .replace(/__([^_\n]+)__/g, '<u>$1</u>')
          .replace(/\r?\n/g, '<br>');
        if (m.title && String(m.title).trim() && String(m.title).trim() !== '새 메모') {
          var t = String(m.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          body = '<b>' + t + '</b>' + (body ? '<br>' + body : '');
        }
      }
      var ts = Date.now();
      return {
        id: m.id || ('memo-' + Math.random().toString(36).slice(2)),
        body: body,
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : ts,
        updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : ts,
        locked: m.locked === true,
        bookmarked: m.bookmarked === true
      };
    });

    return out;
  }

  /** 자동 저장이 되었다는 것을 조용히 알려줍니다 (연속 입력 중에는 한 번만) */
  var notifySaved = U.debounce(function () { U.toast('저장됨', 'save'); }, 1200);

  function write(silent) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      writeFailed = false;
      if (!silent) notifySaved();
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

    flush: function () { write(true); },

    /* ------------------------------------------------------ 백업 / 복구 */

    exportJson: function () {
      return JSON.stringify(state, null, 2);
    },

    importJson: function (text) {
      var parsed = JSON.parse(text);          // 실패 시 호출부에서 catch
      state = migrate(parsed);
      write(true);
      emit();
    },

    reset: function () {
      state = defaults();
      write(true);
      emit();
    },

    defaults: defaults
  };

  MW.store = store;
})();
