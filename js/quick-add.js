/* ==========================================================================
   MW.quickAdd — 빠른 일정 입력 (하단 바, 모바일·데스크톱 공통)
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
    var relativeMatch = remaining.match(/^(오늘|내일|모레|글피|다음주|이번주|다음달|내년)/);
    if (relativeMatch) {
      var relStr = relativeMatch[1];
      var today = new Date();
      today.setHours(0, 0, 0, 0);

      switch (relStr) {
        case '오늘':
          result.date = today;
          break;
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

    // 2. 절대 날짜 파싱 (2025-01-31, 1/31, 3월 4일, 15일)
    if (!result.date) {
      var now = new Date();
      var y0 = now.getFullYear(), mo0 = now.getMonth() + 1;
      var datePatterns = [
        { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s|$)/, build: function (m) { return { year: +m[1], month: +m[2], day: +m[3] }; } },
        { regex: /^(\d{1,2})\/(\d{1,2})(?:\s|$)/,        build: function (m) { return { year: y0, month: +m[1], day: +m[2] }; } },
        { regex: /^(\d{1,2})월\s*(\d{1,2})일(?:\s|$)/,   build: function (m) { return { year: y0, month: +m[1], day: +m[2] }; } },
        { regex: /^(\d{1,2})일(?:\s|$)/,                 build: function (m) { return { year: y0, month: mo0, day: +m[1] }; } }
      ];

      for (var i = 0; i < datePatterns.length; i++) {
        var m = remaining.match(datePatterns[i].regex);
        if (!m) continue;
        var p = datePatterns[i].build(m);
        if (p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= 31) {
          result.date = new Date(p.year, p.month - 1, p.day, 0, 0, 0);
          remaining = remaining.replace(datePatterns[i].regex, '').trim();
        }
        // 2월 30일이 3월로 밀려 저장되지 않도록, 달력의 실제 날짜와 대조합니다.
        if (!result.date || result.date.getMonth() !== p.month - 1 || result.date.getDate() !== p.day) {
          result.error = '실제 달력에 있는 날짜를 입력해 주세요.';
        }
        break;
      }
    }

    // 3. 시간 파싱 (오후 3시, PM 3:00, 3:00, 15:00 등)
    var timePatterns = [
      { regex: /(오전|오후)\s*(\d{1,2})\s*[:시]?\s*(\d{2})?\s*분?/, ampm: true },
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
        if (hour < 0 || hour > 23 || min > 59 || (tpat.ampm && (+tm[2] < 1 || +tm[2] > 12))) {
          result.error = '시간은 0–23시, 분은 0–59분으로 입력해 주세요.';
        }
        remaining = remaining.replace(tpat.regex, '').trim();
        break;
      }
    }

    result.title = remaining || result.text;
    result.hasDateTime = !!(result.date || result.time);
    if (result.hasDateTime && !remaining) result.error = '날짜·시간 뒤에 내용을 입력해 주세요.';

    return result;
  }

  /* -------------------------------------------------------- UI & 저장 */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 미리보기와 저장이 같은 날짜·시간표를 사용해야, 안내와 결과가 어긋나지 않습니다. */
  function scheduleOf(parsed) {
    var date = parsed.date || new Date();
    var start = parsed.time ? parsed.time.hour * 60 + parsed.time.min : null;
    return {
      date: date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()),
      start: start,
      end: start === null ? null : Math.min(start + 60, 1440)
    };
  }

  function save(parsed) {
    if (!parsed || !parsed.title || parsed.error) return;

    if (parsed.hasDateTime) {
      var schedule = scheduleOf(parsed);

      MW.store.update(function (st) {
        st.events.push({
          id: U.uid('ev'),
          title: parsed.title,
          date: schedule.date,
          allDay: schedule.start === null,
          start: schedule.start,
          end: schedule.end,
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

    var bar = input.parentNode;
    var summary = U.el('div.quick-add-summary');
    var submit = U.el('button.btn.btn-sm', { type: 'button', text: '저장', onclick: commit });
    var preview = U.el('div.quick-add-preview#quick-add-preview', { hidden: true }, [summary, submit]);
    bar.appendChild(preview);
    input.setAttribute('aria-label', '빠른 입력');
    input.setAttribute('aria-describedby', 'quick-add-preview');

    // 입력이 길어져 두 줄이 되어도, 실제 높이를 다른 화면 요소가 함께 참조합니다.
    function measure() {
      document.documentElement.style.setProperty('--quickbar-h', bar.getBoundingClientRect().height + 'px');
    }
    if (window.ResizeObserver) new ResizeObserver(measure).observe(bar);
    window.addEventListener('resize', measure);

    function showPreview() {
      var parsed = parseInput(input.value);
      preview.hidden = !parsed;
      summary.textContent = '';
      input.setAttribute('aria-invalid', String(!!(parsed && parsed.error)));
      submit.disabled = !parsed || !!parsed.error;
      if (parsed) {
        var details = 'Inbox · 날짜 없음';
        if (parsed.hasDateTime) {
          var schedule = scheduleOf(parsed);
          details = 'Calendar · ' + schedule.date + ' · ' + (schedule.start === null
            ? '종일' : U.fmtMin(schedule.start) + '–' + (schedule.end === 1440 ? '24:00' : U.fmtMin(schedule.end)));
        }
        // 사용자 문장은 HTML로 해석하지 않고 글자로만 보여줍니다.
        summary.appendChild(U.el('div', { text: parsed.error || details }));
        if (!parsed.error) summary.appendChild(U.el('div.quick-add-title', { text: parsed.title }));
      }
      measure();
    }
    function commit() {
      var parsed = parseInput(input.value);
      if (!parsed || parsed.error) { showPreview(); return; }
      save(parsed);
      input.value = '';
      showPreview();
      input.focus();
    }
    input.addEventListener('input', showPreview);
    input.addEventListener('focus', showPreview);
    showPreview();

    input.addEventListener('keydown', function (e) {
      // 한글 조합을 끝내는 Enter는 저장으로 처리하지 않습니다.
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        commit();
      }
    });
  }

  MW.quickAdd = {
    init: init,
    parseInput: parseInput
  };
})();
