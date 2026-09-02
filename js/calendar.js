/* ==========================================================================
   MW.calendar — 캘린더 전용 페이지 (월/주/일)
   · 투두와 데이터를 공유합니다 (날짜가 있는 투두만 필터해서 표시).
   · 반복 일정은 원본 1건만 저장하고 렌더 시점에 전개합니다.
     수정·삭제는 기획대로 "전체 일괄"만 지원합니다 (특정 회차 예외 없음).
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var COLORS = ['#6b8afd', '#4ade80', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf'];
  var REPEAT_LABEL = { none: '반복 없음', daily: '매일', weekly: '매주', monthly: '매월' };

  var view = 'month';
  var cursor = new Date();
  var selected = U.ymd(new Date());
  var root = null;
  var notified = {};

  /* ------------------------------------------------------------ 데이터 조회 */

  /** 반복 규칙을 펼쳐서 그 날짜에 일정이 있는지 판단 */
  function occursOn(ev, d) {
    var base = U.parseYmd(ev.date);
    if (!base) return false;
    var freq = (ev.repeat && ev.repeat.freq) || 'none';
    if (freq === 'none') return U.ymd(base) === U.ymd(d);
    if (d < base) return false;
    if (freq === 'daily') return true;
    if (freq === 'weekly') return d.getDay() === base.getDay();
    if (freq === 'monthly') return d.getDate() === base.getDate();
    return false;
  }

  function eventsOn(day) {
    var d = U.parseYmd(day);
    if (!d) return [];
    return MW.store.state.events
      .filter(function (ev) { return occursOn(ev, d); })
      .sort(function (a, b) {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.start === null ? -1 : a.start) - (b.start === null ? -1 : b.start);
      });
  }

  function todosOn(day) {
    return MW.store.state.todos.filter(function (t) { return t.date === day; });
  }

  /* ------------------------------------------------------------ 일정 편집 */

  function eventDialog(opts) {
    opts = opts || {};
    var ev = opts.event || null;
    var isNew = !ev;
    var d = ev ? ev : {
      title: '', date: opts.date || selected,
      start: opts.start === undefined ? 9 * 60 : opts.start,
      end: opts.end === undefined ? 10 * 60 : opts.end,
      allDay: opts.allDay || false,
      color: COLORS[0], categoryId: null, repeat: { freq: 'none' }, notifyMin: 0
    };

    var cats = MW.store.state.todoGroups;
    var category = el('select.field', {
      onchange: function () {
        var c = cats.find(function (x) { return x.id === category.value; });
        if (c) color.value = c.color;   // 카테고리를 고르면 표시색을 그 색으로 맞춰 줍니다
      }
    }, [el('option', { value: '', text: '카테고리 없음', selected: !d.categoryId })].concat(
      cats.map(function (c) {
        return el('option', { value: c.id, text: c.name, selected: c.id === d.categoryId });
      })
    ));

    var title = el('input.field', { value: d.title, placeholder: '일정 제목' });
    var date = el('input.field', { type: 'date', value: d.date });
    var allDay = el('input', { type: 'checkbox', checked: !!d.allDay });
    var start = el('input.field', { type: 'time', value: d.start === null ? '' : U.fmtMin(d.start) });
    var end = el('input.field', { type: 'time', value: d.end === null ? '' : U.fmtMin(d.end) });
    var color = el('input', {
      type: 'color', value: d.color || COLORS[0],
      style: { width: '100%', height: '34px', background: 'none', border: 'none', cursor: 'pointer' }
    });
    var repeat = el('select.field', {}, Object.keys(REPEAT_LABEL).map(function (k) {
      return el('option', { value: k, text: REPEAT_LABEL[k], selected: (d.repeat && d.repeat.freq) === k });
    }));
    var notifyMin = el('select.field', {}, [
      { v: -1, t: '알림 없음' }, { v: 0, t: '시작 시각' }, { v: 5, t: '5분 전' },
      { v: 10, t: '10분 전' }, { v: 30, t: '30분 전' }, { v: 60, t: '1시간 전' }
    ].map(function (o) {
      return el('option', { value: o.v, text: o.t, selected: (d.notifyMin === undefined ? 0 : d.notifyMin) === o.v });
    }));

    var timeRow = el('div.form-grid', {}, [
      el('div.form-row', {}, [el('label', { text: '시작' }), start]),
      el('div.form-row', {}, [el('label', { text: '종료' }), end])
    ]);
    function syncTime() { timeRow.style.display = allDay.checked ? 'none' : 'grid'; }
    allDay.addEventListener('change', syncTime);
    syncTime();

    MW.shell.modal({
      title: isNew ? '새 일정' : '일정 수정',
      body: [
        el('div.form-row', {}, [el('label', { text: '제목' }), title]),
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '날짜' }), date]),
          el('div.form-row', {}, [
            el('label', { text: '종일' }),
            el('label.row.small.muted', { style: { gap: '6px', cursor: 'pointer', height: '34px' } }, [allDay, '하루 종일'])
          ])
        ]),
        timeRow,
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '반복' }), repeat]),
          el('div.form-row', {}, [el('label', { text: '알림' }), notifyMin])
        ]),
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '카테고리' }), category]),
          el('div.form-row', {}, [el('label', { text: '색상' }), color])
        ]),
        !isNew && d.repeat && d.repeat.freq !== 'none'
          ? el('div.small.dim', { text: '반복 일정은 전체가 함께 수정·삭제됩니다.' })
          : null
      ],
      extra: isNew ? null : el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          MW.store.update(function (s) {
            s.events = s.events.filter(function (x) { return x.id !== ev.id; });
          });
          MW.shell.closeModal();
        }
      }),
      onOk: function () {
        var v = title.value.trim();
        if (!v) { U.toast('제목을 입력해 주세요.', 'warn'); return false; }
        if (!date.value) { U.toast('날짜를 선택해 주세요.', 'warn'); return false; }
        var payload = {
          title: v,
          date: date.value,
          allDay: allDay.checked,
          start: allDay.checked ? null : (U.parseMin(start.value) === null ? 9 * 60 : U.parseMin(start.value)),
          end: allDay.checked ? null : (U.parseMin(end.value) === null ? null : U.parseMin(end.value)),
          color: color.value,
          categoryId: category.value || null,
          repeat: { freq: repeat.value },
          notifyMin: +notifyMin.value
        };
        if (!payload.allDay && payload.end !== null && payload.end <= payload.start) {
          payload.end = Math.min(payload.start + 60, 24 * 60);
        }
        MW.store.update(function (s) {
          if (isNew) {
            payload.id = U.uid('ev');
            s.events.push(payload);
          } else {
            var x = s.events.find(function (y) { return y.id === ev.id; });
            if (x) Object.assign(x, payload);
          }
        });
        selected = payload.date;
      }
    });
  }

  /* ------------------------------------------------------------ 월간 뷰 */

  function pillFor(ev) {
    return el('div.cal-pill', {
      style: { borderLeftColor: ev.color || COLORS[0] },
      title: ev.title,
      text: (ev.allDay || ev.start === null ? '' : U.fmtMin(ev.start) + ' ') + ev.title
    });
  }

  function todoPill(t) {
    return el('div.cal-pill.todo' + (t.done ? '.done' : ''), {
      style: { borderLeftColor: MW.todo.colorOf(t) },
      title: '할 일: ' + t.title,
      text: '✓ ' + t.title
    });
  }

  function renderMonth(host) {
    var y = cursor.getFullYear(), m = cursor.getMonth();
    var cells = U.monthGrid(y, m);

    var names = U.weekdayNames();
    var dow = el('div.cal-dow', {}, names.map(function (w) {
      return el('div' + (w === '일' ? '.sun' : w === '토' ? '.sat' : ''), { text: w });
    }));
    var weeks = el('div.cal-weeks');

    for (var w = 0; w < 6; w++) {
      var row = el('div.cal-week');
      for (var i = 0; i < 7; i++) {
        (function (d) {
          var day = U.ymd(d);
          var cls = '.cal-cell';
          if (d.getMonth() !== m) cls += '.out';
          if (U.isToday(d)) cls += '.today';
          if (day === selected) cls += '.selected';
          if (d.getDay() === 0) cls += '.sun';
          if (d.getDay() === 6) cls += '.sat';

          // 할 일은 인박스(날짜 없음) 개념이라 날짜 칸에는 일정만 표시합니다.
          var items = eventsOn(day).map(pillFor);
          var shown = items.slice(0, 3);

          row.appendChild(el(cls, {
            onclick: function () { selected = day; render(); },
            ondblclick: function () { eventDialog({ date: day }); }
          }, [
            el('div.cal-num', {}, [el('span.n', { text: String(d.getDate()) })]),
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, shown),
            items.length > 3 ? el('div.cal-more', { text: '+' + (items.length - 3) + ' 더보기' }) : null
          ]));
        })(cells[w * 7 + i]);
      }
      weeks.appendChild(row);
    }

    host.appendChild(el('div.cal-layout', {}, [
      el('div.cal-grid', {}, [dow, weeks]),
      sidePanel()
    ]));
  }

  /* ------------------------------------------------------------ 상세 패널 */

  function sidePanel() {
    var day = selected;
    var evs = eventsOn(day);

    return el('div.cal-side', {}, [
      el('h3', { text: U.fmtLongDate(day) }),
      el('div.sub', { text: U.isToday(U.parseYmd(day)) ? '오늘' : '' }),

      el('section', {}, [
        el('h4', { text: '일정 ' + (evs.length ? '(' + evs.length + ')' : '') }),
        evs.length ? el('div', {}, evs.map(function (ev) {
          return el('div.ev-row', { onclick: function () { eventDialog({ event: ev }); } }, [
            el('div.ev-bar', { style: { background: ev.color || COLORS[0] } }),
            el('div.ev-main', {}, [
              el('div.ev-time', {
                text: ev.allDay || ev.start === null ? '종일'
                  : U.fmtMin(ev.start) + (ev.end !== null && ev.end !== undefined ? ' – ' + U.fmtMin(ev.end) : '')
              }),
              el('div.ev-title', { text: ev.title }),
              ev.repeat && ev.repeat.freq !== 'none' ? el('div.ev-rep', { text: '↻ ' + REPEAT_LABEL[ev.repeat.freq] }) : null
            ])
          ]);
        })) : el('div.empty', { text: '일정이 없습니다.', style: { padding: '10px' } }),
        el('button.btn.btn-sm', {
          text: '＋ 일정 추가', style: { width: '100%', marginTop: '6px' },
          onclick: function () { eventDialog({ date: day }); }
        })
      ]),

      el('section', {}, [
        el('h4', { text: '인박스' }),
        el('div.small.dim', { text: '날짜·시간이 정해지지 않은 할 일', style: { marginBottom: '6px' } }),
        (function () {
          var box = el('div.todo-list');
          MW.todo.renderList(box, {
            filter: function (t) { return !t.date; },
            draggable: false, showMeta: false,
            emptyText: '인박스가 비어 있습니다.'
          });
          return box;
        })(),
        el('button.btn.btn-sm', {
          text: '＋ 할 일 추가', style: { width: '100%', marginTop: '6px' },
          onclick: function () {
            var input = el('input.field', { placeholder: '할 일 제목' });
            MW.shell.modal({
              title: '할 일 추가',
              body: [el('div.form-row', {}, [el('label', { text: '제목' }), input])],
              onOk: function () {
                if (!MW.todo.add(input.value)) { U.toast('제목을 입력해 주세요.', 'warn'); return false; }
              }
            });
          }
        })
      ]),

    ]);
  }

  /* ------------------------------------------------------------ 주간 뷰 */

  function renderWeek(host) {
    var start = U.startOfWeek(cursor);
    var grid = el('div.week-grid');

    for (var i = 0; i < 7; i++) {
      (function (d) {
        var day = U.ymd(d);
        var evs = eventsOn(day);
        var timed = evs.filter(function (e) { return !e.allDay && e.start !== null && e.start !== undefined; });
        var allDayEvs = evs.filter(function (e) { return e.allDay || e.start === null || e.start === undefined; });
        var untimed = [];      // 시간이 지정되지 않은 일정은 시간 일정 아래로

        function evPill(ev, showTime) {
          return el('div.cal-pill', {
            style: { borderLeftColor: ev.color || COLORS[0], whiteSpace: 'normal' },
            text: (showTime ? U.fmtMin(ev.start) + ' ' : '') + ev.title,
            onclick: function (e) { e.stopPropagation(); eventDialog({ event: ev }); }
          });
        }

        // 두 번째 카드: 시간 지정 일정 → 시간 미지정 (할 일은 주간 하단 인박스로 분리)
        var bodyCard = el('div.week-card', {}, [
          timed.length
            ? el('div.week-stack', {}, timed.map(function (ev) { return evPill(ev, true); }))
            : el('div.week-none', { text: '시간 일정 없음' }),
          untimed.length ? el('div.week-divider', { text: '시간 미지정' }) : null,
          untimed.length ? el('div.week-stack', {}, untimed.map(function (ev) { return evPill(ev, false); })) : null
        ]);

        var col = el('div.week-col' + (U.isToday(d) ? '.today' : ''), {
          ondblclick: function () { eventDialog({ date: day }); }
        }, [
          el('div.week-col-head', {
            title: '일간 뷰로 보기',
            onclick: function () { selected = day; view = 'day'; cursor = d; render(); }
          }, [
            el('span.d', { text: String(d.getDate()) }),
            el('span.w' + (d.getDay() === 0 ? '.sun' : d.getDay() === 6 ? '.sat' : ''), { text: U.WEEKDAYS[d.getDay()] })
          ]),
          el('div.week-card.allday', {}, [
            allDayEvs.length
              ? el('div.week-stack', {}, allDayEvs.map(function (ev) { return evPill(ev, false); }))
              : el('div.week-none', { text: '종일 없음' })
          ]),
          bodyCard
        ]);
        grid.appendChild(col);
      })(U.addDays(start, i));
    }
    host.appendChild(grid);

    // 주간 달력 하단: 인박스 (날짜 없는 할 일) — 좁은 칸에 눌러 담지 않고 한 곳에 모읍니다
    var weekInbox = el('div.todo-list');
    MW.todo.renderList(weekInbox, {
      filter: function (t) { return !t.date; },
      draggable: false, showMeta: false,
      emptyText: '인박스가 비어 있습니다.'
    });
    host.appendChild(el('div.card.week-inbox', {}, [
      el('h3', { text: '인박스' }),
      el('div.small.dim', { text: '날짜·시간이 정해지지 않은 할 일', style: { marginBottom: '8px' } }),
      weekInbox,
      el('button.btn.btn-sm', {
        text: '＋ 할 일 추가', style: { width: '100%', marginTop: '8px' },
        onclick: function () {
          var input = el('input.field', { placeholder: '할 일 제목' });
          MW.shell.modal({
            title: '할 일 추가',
            body: [el('div.form-row', {}, [el('label', { text: '제목' }), input])],
            onOk: function () {
              if (!MW.todo.add(input.value)) { U.toast('제목을 입력해 주세요.', 'warn'); return false; }
            }
          });
        }
      })
    ]));
  }

  /* ------------------------------------------------------------ 일간 뷰 */

  function renderDay(host) {
    var day = U.ymd(cursor);
    selected = day;
    var wake = U.clamp(+MW.store.state.settings.wakeHour || 0, 0, 23);
    var evs = eventsOn(day);
    var timed = evs.filter(function (e) { return !e.allDay && e.start !== null && e.start !== undefined; });
    var allDayEvs = evs.filter(function (e) { return e.allDay || e.start === null || e.start === undefined; });

    var top = el('div.day-top', {}, [
      el('div.card', {}, [
        el('h3', { text: '종일 일정' }),
        allDayEvs.length ? el('div', {}, allDayEvs.map(function (ev) {
          return el('div.ev-row', { onclick: function () { eventDialog({ event: ev }); } }, [
            el('div.ev-bar', { style: { background: ev.color || COLORS[0] } }),
            el('div.ev-main', {}, [el('div.ev-title', { text: ev.title })])
          ]);
        })) : el('div.small.dim', { text: '종일 일정이 없습니다.' })
      ])
    ]);

    /* 타임라인 */
    var timeline = el('div.timeline');
    for (var i = 0; i < 24; i++) {
      var h = (wake + i) % 24;
      timeline.appendChild(el('div.tl-row', {}, [
        el('div.tl-hour', { text: U.pad2(h) + ':00' }),
        el('div.tl-slot', {}, [el('div.tl-half')])
      ]));
    }

    var layer = el('div.tl-events');
    timeline.appendChild(layer);

    var ROW = 44;
    function yOf(min) { return (((min - wake * 60) + 1440) % 1440) / 60 * ROW; }

    timed.forEach(function (ev) {
      var top1 = yOf(ev.start);
      var dur = (ev.end !== null && ev.end !== undefined ? ev.end : ev.start + 60) - ev.start;
      if (dur <= 0) dur = 60;
      layer.appendChild(el('div.tl-ev', {
        style: {
          top: top1 + 'px',
          height: Math.max(20, dur / 60 * ROW - 3) + 'px',
          background: (ev.color || COLORS[0]) + '22',
          borderLeftColor: ev.color || COLORS[0]
        },
        onclick: function () { eventDialog({ event: ev }); }
      }, [
        el('div.t', { text: ev.title }),
        el('div.h', { text: U.fmtMin(ev.start) + (ev.end !== null && ev.end !== undefined ? ' – ' + U.fmtMin(ev.end) : '') })
      ]));
    });

    /* 드래그로 시간대 선택해서 일정 추가 (구글 캘린더 방식) */
    var sel = null, startY = null;
    function minAt(clientY) {
      var r = timeline.getBoundingClientRect();
      var y = U.clamp(clientY - r.top, 0, 24 * ROW);
      var min = wake * 60 + Math.round((y / ROW) * 60 / 15) * 15;
      return U.clamp(min, wake * 60, wake * 60 + 1440);
    }
    timeline.addEventListener('mousedown', function (e) {
      if (e.target.closest('.tl-ev') || e.offsetX < 54 && e.target.classList.contains('tl-hour')) return;
      startY = minAt(e.clientY);
      sel = el('div.tl-sel', { style: { top: yOf(startY) + 'px', height: '2px' } });
      layer.appendChild(sel);
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    function move(e) {
      if (!sel) return;
      var cur = minAt(e.clientY);
      var a = Math.min(startY, cur), b = Math.max(startY, cur);
      sel.style.top = yOf(a) + 'px';
      sel.style.height = Math.max(2, (b - a) / 60 * ROW) + 'px';
    }
    function up(e) {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (!sel) return;
      var cur = minAt(e.clientY);
      var a = Math.min(startY, cur), b = Math.max(startY, cur);
      sel.remove(); sel = null;
      if (b - a < 15) b = a + 60;
      eventDialog({ date: day, start: a % 1440, end: b % 1440 === 0 ? 1439 : b % 1440 });
    }

    // 시간 미지정 할 일 = 인박스 (날짜 없는 할 일 전체). 어느 날을 봐도 같은 인박스를 보여줍니다.
    var sideTodos = el('div.todo-list');
    MW.todo.renderList(sideTodos, {
      filter: function (t) { return !t.date; },
      draggable: false, showMeta: false, emptyText: '인박스가 비어 있습니다.'
    });

    host.appendChild(el('div', {}, [
      top,
      el('div.day-layout', {}, [
        timeline,
        el('div.card.day-side', {}, [
          el('h3', { text: '인박스' }),
          el('div.small.dim', {
            text: '날짜·시간이 정해지지 않은 할 일 · 타임라인을 드래그하면 일정이 추가됩니다.',
            style: { marginBottom: '10px' }
          }),
          sideTodos,
          el('button.btn.btn-sm', {
            text: '＋ 할 일 추가', style: { width: '100%', marginTop: '8px' },
            onclick: function () {
              var input = el('input.field', { placeholder: '할 일 제목' });
              MW.shell.modal({
                title: '할 일 추가',
                body: [el('div.form-row', {}, [el('label', { text: '제목' }), input])],
                onOk: function () {
                  if (!MW.todo.add(input.value)) { U.toast('제목을 입력해 주세요.', 'warn'); return false; }
                }
              });
            }
          })
        ])
      ])
    ]));
  }

  /* ------------------------------------------------------------ 툴바/렌더 */

  function moveCursor(dir) {
    if (view === 'month') cursor = U.addMonths(cursor, dir);
    else if (view === 'week') cursor = U.addDays(cursor, dir * 7);
    else cursor = U.addDays(cursor, dir);
    if (view !== 'month') selected = U.ymd(cursor);
    render();
  }

  function titleText() {
    if (view === 'month') return cursor.getFullYear() + '년 ' + (cursor.getMonth() + 1) + '월';
    if (view === 'week') {
      var s = U.startOfWeek(cursor), e = U.addDays(s, 6);
      return (s.getMonth() + 1) + '월 ' + s.getDate() + '일 – ' + (e.getMonth() + 1) + '월 ' + e.getDate() + '일';
    }
    return U.fmtLongDate(cursor);
  }

  /**
   * 툴바 — 왼쪽에 기간 이동, 오른쪽 끝에 [+ 일정 추가]와 월/주/일 전환을 고정합니다.
   * 화면 폭이 변해도 월/주/일 버튼 위치가 흔들리지 않도록 오른쪽에 여백을 둡니다.
   */
  function toolbar() {
    return el('div.cal-toolbar', {}, [
      el('button.btn.btn-icon', { text: '‹', title: '이전', onclick: function () { moveCursor(-1); } }),
      el('div.cal-title', { text: titleText() }),
      el('button.btn.btn-icon', { text: '›', title: '다음', onclick: function () { moveCursor(1); } }),
      el('button.btn.btn-sm', {
        text: '오늘',
        onclick: function () { cursor = new Date(); selected = U.ymd(cursor); render(); }
      }),
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', {
        text: '＋ 일정 추가', onclick: function () { eventDialog({ date: selected }); }
      }),
      el('div.cal-views', {}, ['month', 'week', 'day'].map(function (v) {
        return el('button' + (view === v ? '.active' : ''), {
          text: { month: '월', week: '주', day: '일' }[v],
          onclick: function () { view = v; if (v !== 'month') cursor = U.parseYmd(selected) || cursor; render(); }
        });
      }))
    ]);
  }

  function render() {
    if (!root) return;
    U.clear(root);
    // 해빗 트래커는 홈에만 둡니다 (캘린더에도 두면 같은 내용이 반복됩니다)
    root.appendChild(toolbar());
    if (view === 'month') renderMonth(root);
    else if (view === 'week') renderWeek(root);
    else renderDay(root);
  }

  /* ------------------------------------------------------------ 알림 */

  function checkNotifications() {
    var s = MW.store.state;
    if (!s.settings.notify) return;
    var now = new Date();
    var day = U.ymd(now);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    eventsOn(day).forEach(function (ev) {
      if (ev.allDay || ev.start === null || ev.start === undefined) return;
      var lead = ev.notifyMin === undefined ? 0 : ev.notifyMin;
      if (lead < 0) return;
      var fireAt = ev.start - lead;
      var key = ev.id + '@' + day;
      if (notified[key]) return;
      if (nowMin >= fireAt && nowMin < fireAt + 2) {
        notified[key] = true;
        MW.shell.notify(ev.title, U.fmtMin(ev.start) + ' 시작' + (lead ? ' (' + lead + '분 전 알림)' : ''));
        MW.shell.playSound('start-alarm');
      }
    });
  }

  /* ------------------------------------------------------------ iCal 가져오기 */

  /** .ics 텍스트 → 일정 배열 (VEVENT 의 SUMMARY/DTSTART/DTEND/RRULE 만 사용) */
  function parseIcs(text) {
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    // 접힌 줄(다음 줄이 공백으로 시작) 펼치기
    var unfolded = [];
    lines.forEach(function (l) {
      if (/^[ \t]/.test(l) && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1);
      else unfolded.push(l);
    });

    var out = [], cur = null;
    unfolded.forEach(function (line) {
      if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; return; }
      if (/^END:VEVENT/i.test(line)) {
        if (cur && cur.title && cur.date) out.push(cur);
        cur = null; return;
      }
      if (!cur) return;
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var key = line.slice(0, idx).toUpperCase();
      var val = line.slice(idx + 1).trim();
      var name = key.split(';')[0];

      if (name === 'SUMMARY') cur.title = val.replace(/\\,/g, ',').replace(/\\n/gi, ' ').replace(/\\\\/g, '\\');
      else if (name === 'DTSTART') {
        var p = icsDate(val, key);
        if (p) { cur.date = p.date; cur.start = p.min; cur.allDay = p.allDay; }
      } else if (name === 'DTEND') {
        var q = icsDate(val, key);
        if (q) cur.end = q.min;
      } else if (name === 'RRULE') {
        var f = (val.match(/FREQ=([A-Z]+)/i) || [])[1];
        cur.repeat = { freq: { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }[(f || '').toUpperCase()] || 'none' };
      }
    });
    return out;
  }

  function icsDate(val, key) {
    var m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    if (!m[4]) return { date: m[1] + '-' + m[2] + '-' + m[3], min: null, allDay: true };
    if (m[7]) {  // UTC → 로컬 변환
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
      return { date: U.ymd(d), min: d.getHours() * 60 + d.getMinutes(), allDay: false };
    }
    return { date: m[1] + '-' + m[2] + '-' + m[3], min: (+m[4]) * 60 + (+m[5]), allDay: /VALUE=DATE\b/i.test(key) ? true : false };
  }

  function importIcs(text) {
    var parsed;
    try { parsed = parseIcs(text); }
    catch (e) { U.toast('.ics 파일을 해석하지 못했습니다.', 'err'); return 0; }
    if (!parsed.length) { U.toast('가져올 일정이 없습니다.', 'warn'); return 0; }
    MW.store.update(function (s) {
      parsed.forEach(function (p) {
        var dup = s.events.some(function (e) {
          return e.title === p.title && e.date === p.date && e.start === (p.start === undefined ? null : p.start);
        });
        if (dup) return;
        s.events.push({
          id: U.uid('ev'),
          title: p.title,
          date: p.date,
          start: p.allDay ? null : (p.start === undefined ? null : p.start),
          end: p.allDay ? null : (p.end === undefined ? null : p.end),
          allDay: !!p.allDay,
          color: '#2dd4bf',
          repeat: p.repeat || { freq: 'none' },
          notifyMin: -1,
          source: 'ical'
        });
      });
    });
    U.toast(parsed.length + '건을 가져왔습니다.');
    return parsed.length;
  }

  MW.calendar = {
    mount: function (node) { root = node; render(); },
    render: render,
    importIcs: importIcs,
    parseIcs: parseIcs,
    occursOn: occursOn,
    eventsOn: eventsOn,
    todosOn: todosOn,
    eventDialog: eventDialog,
    checkNotifications: checkNotifications,
    goto: function (day) { selected = day; cursor = U.parseYmd(day) || new Date(); render(); }
  };
})();
