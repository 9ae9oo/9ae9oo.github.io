/* ==========================================================================
   MW.quickAdd — 빠른 일정 입력 (데스크톱 전용)
   자연어 파싱으로 할일 vs 일정을 자동 분류합니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util;

  /* -------------------------------------------------------- 자연어 파싱 */

  function parseInput(text) {
    text = String(text || '').trim();
    if (!text) return null;

    var result = {
      text: text,
      title: text,
      date: null,
      time: null,
      hasDateTime: false
    };

    var remaining = text;

    // 1. 상대 날짜 파싱 (내일, 모레, 글피, 다음주, 내년 등)
    var relativeMatch = remaining.match(/^(내일|모레|글피|다음주|이번주|다음달|내년)/);
    if (relativeMatch) {
      var relStr = relativeMatch[1];
      var today = new Date();
      today.setHours(0, 0, 0, 0);

      switch (relStr) {
        case '내일':
          result.date = new Date(today.getTime() + 86400000);
          break;
        case '모레':
          result.date = new Date(today.getTime() + 172800000);
          break;
        case '글피':
          result.date = new Date(today.getTime() + 259200000);
          break;
        case '다음주':
          var daysUntilMonday = (1 - today.getDay() + 7) % 7;
          if (daysUntilMonday === 0) daysUntilMonday = 7;
          result.date = new Date(today.getTime() + daysUntilMonday * 86400000);
          break;
        case '이번주':
          var daysUntilSunday = (0 - today.getDay() + 7) % 7;
          if (daysUntilSunday === 0) daysUntilSunday = 7;
          result.date = new Date(today.getTime() + daysUntilSunday * 86400000);
          break;
        case '다음달':
          result.date = new Date(today.getFullYear(), today.getMonth() + 1, 1);
          break;
        case '내년':
          result.date = new Date(today.getFullYear() + 1, 0, 1);
          break;
      }
      remaining = remaining.substring(relStr.length).trim();
    }

    // 2. 절대 날짜 파싱 (1/31, 3월 4일, 2025-01-31 등)
    if (!result.date) {
      var datePatterns = [
        { regex: /^(\d{1,2})\/(\d{1,2})(?:\s|$)/, group: [1, 2] },
        { regex: /^(\d{1,2})월\s*(\d{1,2})일(?:\s|$)/, group: [1, 2] },
        { regex: /^(\d{1,2})일(?:\s|$)/, group: [1, null] },
        { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s|$)/, group: [1, 2, 3] }
      ];

      for (var i = 0; i < datePatterns.length; i++) {
        var pattern = datePatterns[i];
        var m = remaining.match(pattern.regex);
        if (m) {
          var year = pattern.group.length === 3 && pattern.group[0] ? parseInt(m[pattern.group[0]]) : new Date().getFullYear();
          var month = parseInt(m[pattern.group[0] || pattern.group[0]]);
          var day = pattern.group[1] ? parseInt(m[pattern.group[1]]) : new Date().getDate();

          if (pattern.group.length === 4) {
            year = parseInt(m[pattern.group[0]]);
            month = parseInt(m[pattern.group[1]]);
            day = parseInt(m[pattern.group[2]]);
          }

          result.date = new Date(year, month - 1, day, 0, 0, 0);
          remaining = remaining.replace(pattern.regex, '').trim();
          break;
        }
      }
    }

    // 3. 시간 파싱 (오후 3시, PM 3:00, 3:00, 15:00 등)
    var timePatterns = [
      { regex: /([오전오후]+)\s*(\d{1,2})\s*[:시]?\s*(\d{2})?/, ampm: true },
      { regex: /(AM|PM)\s*(\d{1,2})\s*[:.]?\s*(\d{2})?/i, ampm: true },
      { regex: /(\d{1,2})\s*[:]\s*(\d{2})/, ampm: false },
      { regex: /(\d{1,2})\s*시(?:\s*(\d{2}))?\s*분?/, ampm: false }
    ];

    for (var j = 0; j < timePatterns.length; j++) {
      var tpat = timePatterns[j];
      var tm = remaining.match(tpat.regex);
      if (tm) {
        var hour, min = 0;

        if (tpat.ampm) {
          var ampmStr = tm[1].toUpperCase();
          hour = parseInt(tm[2]);
          if (tm[3]) min = parseInt(tm[3]);

          if (ampmStr.includes('오후') || ampmStr === 'PM') {
            if (hour !== 12) hour += 12;
          } else if (hour === 12) {
            hour = 0;
          }
        } else {
          hour = parseInt(tm[1]);
          if (tm[2]) min = parseInt(tm[2]);
        }

        result.time = { hour: hour, min: min };
        remaining = remaining.replace(tpat.regex, '').trim();
        break;
      }
    }

    result.title = remaining || result.text;
    result.hasDateTime = !!(result.date || result.time);

    return result;
  }

  /* -------------------------------------------------------- UI & 저장 */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function save(parsed) {
    if (!parsed || !parsed.title) return;

    if (parsed.hasDateTime) {
      // 날짜 없이 시간만 입력하면 오늘 날짜로 간주합니다.
      var evDate = parsed.date;
      if (!evDate) {
        evDate = new Date();
        evDate.setHours(0, 0, 0, 0);
      }

      // 일정으로 저장 — calendar.js 이벤트 구조(start/end 는 자정부터의 분 단위)에 맞춤
      var dateStr = evDate.getFullYear() + '-' + pad2(evDate.getMonth() + 1) + '-' + pad2(evDate.getDate());
      var hasTime = !!parsed.time;
      var start = hasTime ? (parsed.time.hour * 60 + parsed.time.min) : null;
      var end = hasTime ? Math.min(start + 60, 24 * 60) : null;

      MW.store.update(function (st) {
        st.events.push({
          id: U.uid('ev'),
          title: parsed.title,
          date: dateStr,
          allDay: !hasTime,
          start: start,
          end: end,
          color: '#6b8afd',
          categoryId: null,
          repeat: { freq: 'none' },
          notifyMin: 0
        });
      });

      U.toast('일정 저장됨: ' + parsed.title);
    } else {
      // 할일(인박스)로 저장
      MW.todo.add(parsed.title);
      U.toast('할일 저장됨: ' + parsed.title);
    }
  }

  function init() {
    var input = document.getElementById('quick-add-input');
    if (!input) return;

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var text = input.value.trim();
        if (text) {
          var parsed = parseInput(text);
          save(parsed);
          input.value = '';
        }
      }
    });
  }

  MW.quickAdd = {
    init: init,
    parseInput: parseInput
  };
})();
