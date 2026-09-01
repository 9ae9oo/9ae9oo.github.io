/* ==========================================================================
   MW.habitGrid — 해빗 트래커 화면 (날짜 × 해빗 그리드) + 알람 카드
   · 홈: 이번 달 1~31일 그리드
   · 캘린더 상단: 보고 있는 주 7일 그리드 (접기 가능)
   · 알람 카드: 시각이 된 알람과 놓친 알람을 우측 하단에 모아 [체크]/[패스]
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;
  var H = null;                 // MW.habits (부팅 후 참조)

  var notified = {};            // 'habitId@day@15:00' → 알림을 이미 띄웠는지
  var alarmCard = null;

  function habits() { return MW.habits; }

  /* ------------------------------------------------------------ 그리드 */

  /**
   * grid(days, opts) → 그리드 노드
   * days: Date 배열 / opts: { compact: bool — 주간처럼 칸이 넓을 때 요일도 표시 }
   */
  function grid(days, opts) {
    opts = opts || {};
    var list = habits().all();
    var today = U.ymd(new Date());

    if (!list.length) {
      return el('div.empty', {
        text: '해빗이 없습니다. 설정 → 시간 · 해빗에서 추가하고 알람 시각을 넣어보세요.'
      });
    }

    var wrap = el('div.hg' + (opts.wide ? '.wide' : ''));
    wrap.style.setProperty('--hg-cols', days.length);

    // 헤더 — 날짜(+요일)
    var head = el('div.hg-row.hg-head', {}, [el('div.hg-label')]);
    days.forEach(function (d) {
      var day = U.ymd(d);
      head.appendChild(el('div.hg-cell-head' + (day === today ? '.today' : ''), {}, [
        el('span.d', { text: String(d.getDate()) }),
        opts.wide ? el('span.w', { text: U.WEEKDAYS[d.getDay()] }) : null
      ]));
    });
    wrap.appendChild(head);

    // 해빗별 행
    list.forEach(function (h) {
      var target = habits().targetOf(h);
      var row = el('div.hg-row', {}, [
        el('div.hg-label', { title: h.name + ' · 하루 ' + target + '회' }, [
          el('span.hg-dot', { style: { background: h.color } }),
          el('span.hg-name', { text: h.name }),
          el('span.hg-target', { text: '/' + target })
        ])
      ]);

      days.forEach(function (d) {
        var day = U.ymd(d);
        var n = habits().countOf(h.id, day);
        var full = n >= target;
        var future = day > today;
        var cell = el('button.hg-cell' + (n > 0 ? '.on' : '') + (full ? '.full' : '') + (future ? '.future' : ''), {
          title: h.name + ' · ' + U.fmtDate(day) + ' — ' + n + '/' + target + '회'
            + (future ? '' : '  (클릭: +1, 다 채운 뒤 클릭: 비우기)'),
          onclick: function () { habits().bump(h.id, day); }
        }, [n > 0 ? el('span', { text: String(n) }) : null]);
        if (n > 0) {
          cell.style.background = h.color;
          cell.style.borderColor = h.color;
        }
        row.appendChild(cell);
      });

      wrap.appendChild(row);
    });

    return el('div.hg-scroll', {}, [wrap]);
  }

  /** 이번 달 1일 ~ 말일 */
  function monthDays(ref) {
    var d = ref || new Date();
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    var out = [];
    for (var i = 1; i <= last; i++) out.push(new Date(d.getFullYear(), d.getMonth(), i));
    return out;
  }

  /** 시작 요일 설정을 따르는 그 주 7일 */
  function weekDays(ref) {
    var start = U.startOfWeek(ref || new Date());
    var out = [];
    for (var i = 0; i < 7; i++) out.push(U.addDays(start, i));
    return out;
  }

  /** 홈용 — 이번 달 전체 */
  function monthGridNode(ref) {
    return grid(monthDays(ref), {});
  }

  /** 캘린더 상단용 — 접었다 펼 수 있는 주간 섹션 */
  function weekSection(ref) {
    var open = MW.store.state.settings.habitPanelOpen !== false;
    var body = el('div.hb-panel-body', {}, [
      grid(weekDays(ref), { wide: true }),
      el('div.hb-panel-hint', {
        text: '칸을 누르면 +1 됩니다. 알람 시각은 설정 → 시간 · 해빗에서 정합니다.'
      })
    ]);
    if (!open) body.hidden = true;

    var caret = el('span.hb-caret', { text: open ? '▼' : '▶' });
    var head = el('button.hb-panel-head', {
      onclick: function () {
        var next = body.hidden;
        body.hidden = !next;
        caret.textContent = next ? '▼' : '▶';
        MW.store.touch(function (s) { s.settings.habitPanelOpen = next; });
      }
    }, [
      caret,
      el('strong', { text: '해빗 트래커' }),
      el('span.hb-panel-sub', { text: todaySummary() })
    ]);

    return el('section.hb-panel', {}, [head, body]);
  }

  function todaySummary() {
    var today = U.ymd(new Date());
    var list = habits().all();
    if (!list.length) return '';
    var done = list.filter(function (h) { return habits().isDone(h.id, today); }).length;
    return '오늘 ' + done + ' / ' + list.length + ' 완료';
  }

  /* ------------------------------------------------------------ 알람 카드 */

  function ensureCard() {
    if (alarmCard) return alarmCard;
    alarmCard = el('div.alarm-card', { id: 'alarm-card' });
    document.body.appendChild(alarmCard);
    return alarmCard;
  }

  function renderAlarms() {
    var card = ensureCard();
    var pending = habits().pendingAlarms();
    U.clear(card);

    if (!pending.length) { card.classList.remove('open'); return; }
    card.classList.add('open');

    var late = pending.filter(function (p) { return p.late; }).length;
    card.appendChild(el('div.alarm-head', {}, [
      el('strong', { text: '⏰ 해빗 알람 ' + pending.length + '건' }),
      late ? el('span.chip', { text: '지난 알람 ' + late }) : null,
      el('span.spacer'),
      el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '✕', title: '접기',
        onclick: function () { card.classList.remove('open'); }
      })
    ]));

    pending.slice(0, 6).forEach(function (p) {
      card.appendChild(el('div.alarm-row', {}, [
        el('span.alarm-dot', { style: { background: p.habit.color } }),
        el('div.alarm-main', {}, [
          el('div.alarm-name', { text: p.habit.name }),
          el('div.alarm-time', {
            text: p.time + (p.late ? ' · 지남' : ' · 지금')
              + ' — ' + habits().countOf(p.habit.id, p.day) + '/' + habits().targetOf(p.habit) + '회'
          })
        ]),
        el('button.btn.btn-primary.btn-sm', {
          text: '체크', onclick: function () { habits().setSlot(p.habit.id, p.day, p.time, 'done'); }
        }),
        el('button.btn.btn-sm', {
          text: '패스', onclick: function () { habits().setSlot(p.habit.id, p.day, p.time, 'pass'); }
        })
      ]));
    });

    if (pending.length > 6) {
      card.appendChild(el('div.small.dim', {
        text: '외 ' + (pending.length - 6) + '건', style: { padding: '4px 12px 8px' }
      }));
    }

    card.appendChild(el('div.alarm-foot', {}, [
      el('button.btn.btn-sm', {
        text: '모두 패스',
        onclick: function () {
          pending.forEach(function (p) { habits().setSlot(p.habit.id, p.day, p.time, 'pass'); });
        }
      })
    ]));
  }

  /** 30초마다 호출 — 새로 시각이 된 알람에만 알림/소리를 한 번 냅니다 */
  function check() {
    var pending = habits().pendingAlarms();
    pending.forEach(function (p) {
      if (p.late) return;                       // 놓친 알람은 조용히 카드에만 쌓음
      var key = p.habit.id + '@' + p.day + '@' + p.time;
      if (notified[key]) return;
      notified[key] = true;
      MW.shell.notify(p.habit.name, p.time + ' — 하고 나서 체크해 주세요');
      MW.shell.playSound('start-alarm');
    });
    renderAlarms();
  }

  MW.habitGrid = {
    grid: grid,
    monthDays: monthDays,
    weekDays: weekDays,
    monthGridNode: monthGridNode,
    weekSection: weekSection,
    todaySummary: todaySummary,
    renderAlarms: renderAlarms,
    check: check
  };
})();
