/* ==========================================================================
   MW.work — 작업 관리 (작품 → 회차 → 컷 → 공정 체크보드)
   기획서 PRD v1 5장.
   · 체크는 클릭 한 번으로 끝납니다.
   · 퍼센트 · 진행률 · 통계 · "현재 공정 자동 판단"은 넣지 않습니다 (5-4 결정 사항).
   · 평상시에는 화면을 깔끔하게 두고, [순서 변경] 모드에서만 손잡이와 삭제 버튼이 보입니다.

     works: [{ id, name, archived, episodes: [
       { id, number, cutCount, processes: [
         { id, name, order, collapsed, completedCuts: [1,2,3], dueDate }
       ] }
     ] }]
     (부제 title 은 더는 UI 에서 안 씀. dueDate 는 공정마다 따로 두고, 없으면 '' 취급 — 공정별로
      마감이 다를 수 있어서 회차 단위가 아니라 공정 단위로 둡니다)
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var DEFAULT_PROCESSES = ['콘티', '선화', '밑색', '명암', '후보정'];
  var PER_ROW = 10;

  /** 3자리 0채움 — "017", "032". D-day·하루 할당량 숫자가 자릿수 바뀔 때마다 폭이 흔들리지
      않게 고정폭으로 씁니다 (컷수 상한 999 와 같은 자리수). */
  function pad3(n) {
    n = Math.abs(n);
    return (n < 10 ? '00' : n < 100 ? '0' : '') + n;
  }

  var root = null;
  var reorder = false;          // [순서 변경] 모드 (저장하지 않는 화면 상태)
  var dragId = null;

  /* 컷을 드래그(마우스) · 길게 눌러 끌기(터치)로 여러 개 한 번에 칠하는 상태.
     mousedown/touchstart 즉시 시작해서 지나가는 칸마다 화면만 바꾸고,
     mouseup/touchend 에 한 번에 store 로 반영합니다 (칸마다 반영하면 드래그 중 리렌더가 계속 생김). */
  var paint = null;             // { prId, mode, touched:{} }
  var suppressClick = false;    // 드래그 직후 자동 발생하는 click 을 한 번 무시
  var touchHold = null;         // 롱프레스 대기: { x, y, prId, timer, fired }
  var LONG_PRESS_MS = 220;
  var MOVE_CANCEL_PX = 8;

  function works() { return MW.store.state.works; }
  function selRef() {
    var s = MW.store.state.settings;
    if (!s.workSel || typeof s.workSel !== 'object') s.workSel = { workId: '', epId: '' };
    return s.workSel;
  }

  /** 저장된 선택을 실제 데이터와 맞춰 봅니다 (지워진 작품·회차는 첫 항목으로) */
  function current() {
    var list = works();
    if (!list.length) return { work: null, ep: null };
    var ref = selRef();
    var work = list.find(function (w) { return w.id === ref.workId; }) || list[0];
    var ep = work.episodes.find(function (e) { return e.id === ref.epId; }) || work.episodes[0] || null;
    return { work: work, ep: ep };
  }

  function select(workId, epId) {
    MW.store.update(function (s) {
      s.settings.workSel = { workId: workId, epId: epId || '' };
    });
  }

  function sortedProcesses(ep) {
    return ep.processes.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  /* ------------------------------------------------------------ 작품 · 회차 */

  function workDialog(w) {
    var name = el('input.field', { value: w ? w.name : '', placeholder: '작품 이름' });

    // 신규 생성일 때만: 회차 수 · 화별 컷수 · 공정 단계를 함께 받아 회차까지 한 번에 만듭니다.
    // 비워두면(회차 수 0) 예전처럼 작품만 만들어집니다.
    var epCount, cutsPerEp, stepsWrap, steps, stepInput;
    if (!w) {
      epCount = el('input.field', { type: 'number', min: '1', max: '999', placeholder: '1' });
      cutsPerEp = el('input.field', { type: 'number', min: '1', max: '999', value: '60' });
      steps = DEFAULT_PROCESSES.slice();
      stepsWrap = el('div.row-wrap');
      stepInput = el('input.field', {
        placeholder: '공정 이름', style: { width: '110px' },
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }
      });

      var renderSteps = function () {
        U.clear(stepsWrap);
        steps.forEach(function (stepName, i) {
          stepsWrap.appendChild(el('span.chip', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
            stepName,
            el('button', {
              text: '✕', style: { color: 'var(--text-dim)', fontSize: '10px' }, title: '삭제',
              onclick: function () { steps.splice(i, 1); renderSteps(); }
            })
          ]));
        });
      };
      var addStep = function () {
        var v = stepInput.value.trim();
        if (!v) return;
        steps.push(v);
        stepInput.value = '';
        renderSteps();
      };
      renderSteps();
    }

    MW.shell.modal({
      title: w ? '작품 이름 수정' : '작품 추가',
      body: [
        el('div.form-row', {}, [el('label', { text: '작품 이름' }), name]),
        w ? null : el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '회차 수' }), epCount]),
          el('div.form-row', {}, [el('label', { text: '화별 컷수' }), cutsPerEp])
        ]),
        w ? null : el('div.form-row', {}, [
          el('label', { text: '공정 단계' }),
          stepsWrap,
          el('div.row', { style: { marginTop: '6px' } }, [stepInput, el('button.btn.btn-sm', { text: '추가', onclick: function () { addStep(); } })])
        ]),
        w ? null : el('div.small.dim', {
          text: '비워두면 1화가 만들어집니다. 채우면 1화부터 그 수만큼, 위 컷수·공정 구성으로 한 번에 만들어집니다.'
        })
      ],
      extra: w ? el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          MW.shell.closeModal();
          MW.shell.confirm(
            '“' + w.name + '” 과 그 안의 회차 ' + w.episodes.length + '개를 모두 삭제할까요?\n되돌릴 수 없습니다.',
            function () {
              MW.store.update(function (s) {
                s.works = s.works.filter(function (x) { return x.id !== w.id; });
                s.settings.workSel = { workId: '', epId: '' };
              });
              U.toast('작품을 삭제했습니다.');
            }
          );
        }
      }) : null,
      onOk: function () {
        var v = name.value.trim();
        if (!v) { U.toast('작품 이름을 입력해 주세요.', 'warn'); return false; }
        if (!w) {
          var n = U.clamp(parseInt(epCount.value, 10) || 1, 1, 999);
          if (!steps.length) { U.toast('공정을 하나 이상 넣어 주세요.', 'warn'); return false; }
        }
        var newId = U.uid('work');
        MW.store.update(function (s) {
          if (w) {
            var x = s.works.find(function (y) { return y.id === w.id; });
            if (x) x.name = v;
          } else {
            var cutN = U.clamp(parseInt(cutsPerEp.value, 10) || 60, 1, 999);
            var episodes = [];
            for (var i = 1; i <= n; i++) {
              episodes.push({
                id: U.uid('ep'), number: i, cutCount: cutN,
                processes: steps.map(function (stepName, k) {
                  return { id: U.uid('pr'), name: stepName, order: k, collapsed: k !== 0, completedCuts: [] };
                })
              });
            }
            s.works.push({ id: newId, name: v, archived: false, episodes: episodes });
            s.settings.workSel = { workId: newId, epId: episodes.length ? episodes[0].id : '' };
          }
        });
      }
    });
  }

  /** 신규 회차 생성 전용 (기존 회차 편집·삭제는 episodeHeaderControl 로 옮겼습니다) */
  function episodeDialog(work) {
    var last = work.episodes[work.episodes.length - 1];
    var number = el('input.field', {
      type: 'number', min: '0',
      value: last ? (+last.number || 0) + 1 : 1
    });
    var cuts = el('input.field', {
      type: 'number', min: '1', max: '999',
      value: last ? last.cutCount : 60
    });

    MW.shell.modal({
      title: '회차 추가',
      body: [
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '회차 번호' }), number]),
          el('div.form-row', {}, [el('label', { text: '전체 컷 수' }), cuts])
        ]),
        el('div.small.dim', {
          text: '기본 공정 ' + DEFAULT_PROCESSES.join(' · ') + ' 가 함께 만들어집니다. 이름은 나중에 바꿀 수 있습니다.'
        })
      ],
      onOk: function () {
        var num = parseInt(number.value, 10) || 0;
        var cut = U.clamp(parseInt(cuts.value, 10) || 1, 1, 999);
        var newId = U.uid('ep');
        MW.store.update(function (s) {
          var w = s.works.find(function (x) { return x.id === work.id; });
          if (!w) return;
          w.episodes.push({
            id: newId, number: num, cutCount: cut,
            processes: DEFAULT_PROCESSES.map(function (n, i) {
              return { id: U.uid('pr'), name: n, order: i, collapsed: i !== 0, completedCuts: [] };
            })
          });
          s.settings.workSel = { workId: w.id, epId: newId };
        });
      }
    });
  }

  function processDialog(work, ep, pr) {
    var name = el('input.field', { value: pr ? pr.name : '', placeholder: '공정 이름 (예: 배경)' });
    MW.shell.modal({
      title: pr ? '공정 이름 수정' : '공정 추가',
      body: [el('div.form-row', {}, [el('label', { text: '공정 이름' }), name])],
      onOk: function () {
        var v = name.value.trim();
        if (!v) { U.toast('공정 이름을 입력해 주세요.', 'warn'); return false; }
        MW.store.update(function (s) {
          var e = findEp(s, work.id, ep.id);
          if (!e) return;
          if (pr) {
            var x = e.processes.find(function (y) { return y.id === pr.id; });
            if (x) x.name = v;
          } else {
            e.processes.push({
              id: U.uid('pr'), name: v, order: e.processes.length,
              collapsed: false, completedCuts: []
            });
          }
        });
      }
    });
  }

  function findEp(state, workId, epId) {
    var w = state.works.find(function (x) { return x.id === workId; });
    if (!w) return null;
    return w.episodes.find(function (x) { return x.id === epId; }) || null;
  }

  /* ------------------------------------------------------------ 체크보드 */

  function toggleCut(work, ep, pr, n) {
    MW.store.update(function (s) {
      var e = findEp(s, work.id, ep.id);
      if (!e) return;
      var p = e.processes.find(function (x) { return x.id === pr.id; });
      if (!p) return;
      var i = p.completedCuts.indexOf(n);
      if (i >= 0) p.completedCuts.splice(i, 1);
      else {
        p.completedCuts.push(n);
        p.completedCuts.sort(function (a, b) { return a - b; });
      }
    });
  }

  /** 줄 라벨(1~10)을 누르면 그 줄을 한 번에 채우거나 비웁니다 */
  function toggleRow(work, ep, pr, from, to) {
    var nums = [];
    for (var n = from; n <= to; n++) nums.push(n);
    var allDone = nums.every(function (n) { return pr.completedCuts.indexOf(n) >= 0; });
    MW.store.update(function (s) {
      var e = findEp(s, work.id, ep.id);
      if (!e) return;
      var p = e.processes.find(function (x) { return x.id === pr.id; });
      if (!p) return;
      if (allDone) {
        p.completedCuts = p.completedCuts.filter(function (n) { return n < from || n > to; });
      } else {
        nums.forEach(function (n) { if (p.completedCuts.indexOf(n) < 0) p.completedCuts.push(n); });
        p.completedCuts.sort(function (a, b) { return a - b; });
      }
    });
  }

  function toggleCollapse(work, ep, pr) {
    var mobile = MW.shell.isMobile();
    MW.store.update(function (s) {
      var e = findEp(s, work.id, ep.id);
      if (!e) return;
      var opening = false;
      e.processes.forEach(function (p) {
        if (p.id === pr.id) { p.collapsed = !p.collapsed; opening = !p.collapsed; }
      });
      // 모바일에서는 한 번에 하나만 펼쳐 화면이 길어지지 않게 합니다
      if (mobile && opening) {
        e.processes.forEach(function (p) { if (p.id !== pr.id) p.collapsed = true; });
      }
    });
  }

  function moveProcess(work, ep, pr, delta) {
    MW.store.update(function (s) {
      var e = findEp(s, work.id, ep.id);
      if (!e) return;
      var list = e.processes.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var i = list.findIndex(function (x) { return x.id === pr.id; });
      var j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return;
      list.splice(j, 0, list.splice(i, 1)[0]);
      list.forEach(function (x, k) { x.order = k; });
    });
  }

  function dropProcess(work, ep, targetId) {
    var from = dragId;
    if (!from || from === targetId) return;
    MW.store.update(function (s) {
      var e = findEp(s, work.id, ep.id);
      if (!e) return;
      var list = e.processes.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var i = list.findIndex(function (x) { return x.id === from; });
      var j = list.findIndex(function (x) { return x.id === targetId; });
      if (i < 0 || j < 0) return;
      list.splice(j, 0, list.splice(i, 1)[0]);
      list.forEach(function (x, k) { x.order = k; });
    });
  }

  /** 한 공정의 완료 lookup·완료 개수·남은 개수 (컷 수 기준). processNode 와 remainingControl/dueRow 가 함께 씁니다 */
  function processProgress(ep, pr) {
    var done = {};
    pr.completedCuts.forEach(function (n) { done[n] = true; });
    var doneCount = 0;
    for (var k = 1; k <= ep.cutCount; k++) if (done[k]) doneCount++;
    return { done: done, doneCount: doneCount, remain: ep.cutCount - doneCount };
  }

  /** "― 미완료 N컷" (완료면 "완료") — 공정 이름 옆, 얇은 글씨·다른 색.
      미완료 상태는 계산된 값만 보여주는 순수 텍스트입니다 (입력·클릭 대상 아님).
      완료 상태만 버튼입니다 — 실수로 전체 체크했을 때 눌러서 되돌릴 수 있어야 하므로. */
  function remainingControl(work, ep, pr, remain) {
    if (remain <= 0) {
      return el('button.proc-remain.done', {
        type: 'button', text: '완료', title: '눌러서 전체 해제',
        onclick: function () { toggleRow(work, ep, pr, 1, ep.cutCount); }
      });
    }
    return el('span.proc-remaining', { text: '미완료 ' + remain + '컷' });
  }

  /** 공정 헤더의 마감·할당량 부분 — remainingControl 뒤에 이어 붙어 같은 한 줄을 이룹니다:
      마감일 [입력칸] , D-017일 | 하루 할당량 032컷 남음 [전체 완료]
      마감일 입력칸은 항상 보이고(따로 편집 모드로 안 들어가도 됨), 날짜를 고르면 change
      이벤트로 바로 반영됩니다 — 네이티브 달력에서 날짜를 고르면 change 가 확실히 발생하므로,
      blur 만 믿을 때와 달리 "입력만 하고 안 넘어간 것처럼 보이는" 문제가 없습니다. */
  function dueQuotaNodes(work, ep, pr, remain) {
    var due = pr.dueDate;

    function diffDays(dueStr) {
      var d = new Date(dueStr + 'T00:00:00').getTime();
      var today = new Date(U.ymd(new Date()) + 'T00:00:00').getTime();
      return Math.round((d - today) / 86400000);
    }

    var diff = due ? diffDays(due) : null;
    var dueGroupChildren = [el('span.ep-due-label', { text: '마감일' })];

    var inp = el('input.ep-due-input', { type: 'date', value: due || '' });
    inp.addEventListener('change', function () {
      var v = inp.value || '';
      if (v === (pr.dueDate || '')) return;
      MW.store.update(function (s) {
        var e = findEp(s, work.id, ep.id);
        if (!e) return;
        var p = e.processes.find(function (x) { return x.id === pr.id; });
        if (!p) return;
        p.dueDate = v;
      });
    });
    dueGroupChildren.push(inp);

    if (due) {
      var dday = diff === 0 ? 'D-day' : diff > 0 ? ('D-' + pad3(diff) + '일') : ('D+' + pad3(-diff) + '일');
      var text = ', ' + dday + (diff < 0 ? ' 지남' : '');
      dueGroupChildren.push(el('span.ep-due-text' + (diff < 0 ? '.late' : '.active'), { text: text }));
    }

    var nodes = [el('span.ep-due', {}, dueGroupChildren)];

    if (remain > 0) {
      nodes.push(el('span.ep-header-sep', { text: '|' }));
      if (due && diff >= 0) {
        var daily = Math.ceil(remain / (diff + 1));
        nodes.push(el('span.proc-quota', { text: '하루 할당량 ' + pad3(daily) + '컷 남음' }));
      }
      nodes.push(el('button.btn.btn-sm', {
        type: 'button', text: '전체 완료', title: '전체 체크',
        onclick: function () { toggleRow(work, ep, pr, 1, ep.cutCount); }
      }));
    }

    return nodes;
  }

  /* ----------------------------------------------------------- 드래그로 여러 컷 칠하기
     첫 칸의 반대 상태를 "칠하기" 모드로 정하고, 지나가는 칸마다 그 상태를 즉시 화면에 반영합니다.
     store 반영은 손을 뗄 때 한 번에 (docs/plan-v3.md 의 설계를 그대로 따름) */
  function paintStart(pr, num, btn) {
    paint = { prId: pr.id, mode: !btn.classList.contains('on'), touched: {} };
    paintCell(btn, num);
  }
  function paintCell(btn, num) {
    if (!paint) return;
    btn.classList.toggle('on', paint.mode);
    btn.setAttribute('aria-pressed', paint.mode ? 'true' : 'false');
    paint.touched[num] = true;
  }
  function paintEnd(work, ep, pr) {
    if (!paint) return;
    var p = paint;
    paint = null;
    var nums = Object.keys(p.touched);
    if (!nums.length) return;
    // 마우스는 mousedown+mouseup 이 같은 칸에서 끝나면 브라우저가 곧이어 click 을
    // 합성해서 다시 보내므로, 그 한 번만 무시하면 됩니다. 터치 롱프레스+드래그는
    // 애초에 click 이 안 오므로, 다음 tick 에 자동으로 풀어야 이 플래그가 남아
    // 다음번 진짜 클릭까지 먹어버리는 일이 없습니다.
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 0);
    MW.store.update(function (s) {
      var e = findEp(s, work.id, ep.id);
      if (!e) return;
      var proc = e.processes.find(function (x) { return x.id === p.prId; });
      if (!proc) return;
      var set = {};
      proc.completedCuts.forEach(function (n) { set[n] = true; });
      nums.forEach(function (n) { if (p.mode) set[+n] = true; else delete set[+n]; });
      proc.completedCuts = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    });
  }

  function processNode(work, ep, pr, index, total) {
    var progress = processProgress(ep, pr);
    var done = progress.done, remain = progress.remain;

    var head = el('div.proc-head', {}, [
      reorder ? el('span.proc-grip', { text: '⠿', title: '끌어서 순서 바꾸기' }) : null,
      el('button.proc-toggle', {
        onclick: function () { toggleCollapse(work, ep, pr); }
      }, [
        el('span.caret', { text: pr.collapsed ? '▸' : '▾' }),
        el('span.proc-name', { text: pr.name })
      ]),
      el('span.proc-dash', { text: '―' }),
      remainingControl(work, ep, pr, remain),
      dueQuotaNodes(work, ep, pr, remain),
      el('span.spacer'),
      reorder ? el('div.proc-tools', {}, [
      el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '↑', title: '위로', disabled: index === 0,
        onclick: function () { moveProcess(work, ep, pr, -1); }
      }),
      el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '↓', title: '아래로', disabled: index === total - 1,
        onclick: function () { moveProcess(work, ep, pr, 1); }
      }),
      el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '✎', title: '이름 수정',
        onclick: function () { processDialog(work, ep, pr); }
      }),
      el('button.btn.btn-ghost.btn-icon.btn-sm.danger', {
        text: '✕', title: '공정 삭제',
        onclick: function () {
          MW.shell.confirm('“' + pr.name + '” 공정을 삭제할까요?\n체크한 내용도 함께 사라집니다.', function () {
            MW.store.update(function (s) {
              var e = findEp(s, work.id, ep.id);
              if (!e) return;
              e.processes = e.processes.filter(function (x) { return x.id !== pr.id; });
              e.processes.sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
                .forEach(function (x, k) { x.order = k; });
            });
          });
        }
      })
      ]) : null
    ]);

    var body = null;
    if (!pr.collapsed) {
      body = el('div.proc-body');
      for (var from = 1; from <= ep.cutCount; from += PER_ROW) {
        var to = Math.min(from + PER_ROW - 1, ep.cutCount);
        (function (f, t) {
          var cells = [];
          for (var n = f; n <= t; n++) {
            (function (num) {
              cells.push(el('button.cut' + (done[num] ? '.on' : ''), {
                text: String(num),
                'aria-pressed': done[num] ? 'true' : 'false',
                dataset: { pr: pr.id, num: String(num) },
                onclick: function () {
                  if (suppressClick) { suppressClick = false; return; }
                  toggleCut(work, ep, pr, num);
                },
                onmousedown: function (e) {
                  if (e.button !== 0) return;
                  var btn = this;
                  paintStart(pr, num, btn);
                  var onUp = function () {
                    document.removeEventListener('mouseup', onUp);
                    paintEnd(work, ep, pr);
                  };
                  document.addEventListener('mouseup', onUp);
                },
                onmouseenter: function () {
                  if (paint && paint.prId === pr.id) paintCell(this, num);
                },
                ontouchstart: function (e) {
                  if (e.touches.length !== 1) return;
                  var t = e.touches[0];
                  var btn = this;
                  touchHold = { x: t.clientX, y: t.clientY, prId: pr.id, fired: false, timer: null };
                  touchHold.timer = setTimeout(function () {
                    if (!touchHold) return;
                    touchHold.fired = true;
                    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* 무시 */ } }
                    paintStart(pr, num, btn);
                  }, LONG_PRESS_MS);
                },
                ontouchmove: function (e) {
                  if (!touchHold) return;
                  var t = e.touches[0];
                  var dx = t.clientX - touchHold.x, dy = t.clientY - touchHold.y;
                  if (!touchHold.fired) {
                    if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
                      clearTimeout(touchHold.timer);
                      touchHold = null;
                    }
                    return;   // 롱프레스 확정 전에는 기본 스크롤을 막지 않습니다
                  }
                  e.preventDefault();
                  var target = document.elementFromPoint(t.clientX, t.clientY);
                  if (target && target.classList && target.classList.contains('cut') && target.dataset.pr === touchHold.prId) {
                    paintCell(target, parseInt(target.dataset.num, 10));
                  }
                },
                ontouchend: function () {
                  if (touchHold) {
                    clearTimeout(touchHold.timer);
                    var fired = touchHold.fired;
                    touchHold = null;
                    if (fired) paintEnd(work, ep, pr);
                  }
                  // 롱프레스가 안 걸렸으면(짧은 탭) 브라우저가 곧이어 만드는 click 이벤트에 맡깁니다
                }
              }));
            })(n);
          }
          body.appendChild(el('div.cuts', {}, cells));
        })(from, to);
      }
    }

    var node = el('div.proc' + (pr.collapsed ? '.collapsed' : ''), {}, [head, body]);

    if (reorder) {
      node.draggable = true;
      node.addEventListener('dragstart', function (e) {
        dragId = pr.id;
        node.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', pr.id); } catch (err) { /* 일부 브라우저 */ }
        e.dataTransfer.effectAllowed = 'move';
      });
      node.addEventListener('dragend', function () {
        dragId = null;
        node.classList.remove('dragging');
      });
      node.addEventListener('dragover', function (e) {
        if (!dragId || dragId === pr.id) return;
        e.preventDefault();
        node.classList.add('drag-over');
      });
      node.addEventListener('dragleave', function () { node.classList.remove('drag-over'); });
      node.addEventListener('drop', function (e) {
        e.preventDefault();
        node.classList.remove('drag-over');
        dropProcess(work, ep, pr.id);
      });
    }
    return node;
  }

  /** "N화 | 전체 NN컷" — 텍스트는 클릭 대상이 아니고, 옆의 [편집] 버튼을 눌러야만
      편집 모드로 들어갑니다 (예전엔 텍스트 전체가 버튼이라 실수로 눌리기 쉬웠음).
      회차 번호·컷수를 함께 고치고, 삭제도 여기서 합니다. 팝업 없음 */
  function episodeHeaderControl(work, ep) {
    var wrap = el('div.ep-header-ctl');

    function showLabel() {
      U.clear(wrap);
      wrap.appendChild(el('span.ep-header-text', {}, [
        el('h3', { text: ep.number + '화' }),
        el('span.ep-header-sep', { text: '|' }),
        el('span.ep-header-cuts', { text: '총 ' + ep.cutCount + '컷' })
      ]));
      wrap.appendChild(el('button.btn.btn-sm', {
        type: 'button', text: '편집', title: '회차 번호 · 컷수 수정', onclick: showInput
      }));
    }

    function showInput() {
      U.clear(wrap);
      var numInp = el('input.ep-num-input', { type: 'number', min: '0', value: ep.number });
      var cutInp = el('input.ep-cuts-input', { type: 'number', min: '1', max: '999', value: ep.cutCount });
      var doneOnce = false;

      function commit() {
        if (doneOnce) return;
        doneOnce = true;
        var num = parseInt(numInp.value, 10);
        if (isNaN(num)) num = ep.number;
        var cut = U.clamp(parseInt(cutInp.value, 10) || ep.cutCount, 1, 999);
        MW.store.update(function (s) {
          var e = findEp(s, work.id, ep.id);
          if (!e) return;
          e.number = num;
          if (cut !== e.cutCount) {
            e.cutCount = cut;
            // 컷 수를 줄이면 사라진 컷의 체크는 지웁니다
            e.processes.forEach(function (pr) {
              pr.completedCuts = pr.completedCuts.filter(function (n) { return n <= cut; });
            });
          }
        });
      }
      function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { doneOnce = true; showLabel(); }
      }
      // blur 는 두 입력 사이를 오갈 때도 생기므로, 포커스가 이 컨트롤 밖으로
      // 완전히 나갔을 때만(다음 tick 에 activeElement 로 확인) 커밋합니다.
      // [편집 확인] 버튼도 같은 commit 을 호출하는 명시적 경로입니다.
      function onBlur() {
        setTimeout(function () {
          if (!wrap.contains(document.activeElement)) commit();
        }, 0);
      }
      numInp.addEventListener('keydown', onKey);
      cutInp.addEventListener('keydown', onKey);
      numInp.addEventListener('blur', onBlur);
      cutInp.addEventListener('blur', onBlur);

      wrap.appendChild(el('div.ep-header-edit-row', {}, [
        numInp,
        el('span', { text: '화' }),
        el('span.ep-header-sep', { text: '|' }),
        el('span', { text: '총' }),
        cutInp,
        el('span', { text: '컷' }),
        el('button.btn.btn-sm.btn-primary', {
          type: 'button', text: '편집 확인', onclick: function () { commit(); }
        }),
        el('button.btn.btn-sm.btn-danger', {
          type: 'button', text: '회차 삭제',
          onclick: function () {
            doneOnce = true;
            MW.shell.confirm(ep.number + '화를 삭제할까요?\n체크한 내용도 함께 사라집니다.', function () {
              MW.store.update(function (s) {
                var w = s.works.find(function (x) { return x.id === work.id; });
                if (!w) return;
                w.episodes = w.episodes.filter(function (x) { return x.id !== ep.id; });
                s.settings.workSel = { workId: w.id, epId: '' };
              });
              U.toast('회차를 삭제했습니다.');
            });
          }
        })
      ]));
      numInp.focus();
      numInp.select();
    }

    showLabel();
    return wrap;
  }

  /* ------------------------------------------------------------ 렌더 */

  function render() {
    if (!root) return;
    U.clear(root);

    var list = works();
    if (!list.length) {
      root.appendChild(el('div.empty.work-empty', {}, [
        el('div', { text: '아직 작품이 없습니다.' }),
        el('div.small.dim', { text: '작품을 만들고 회차를 추가하면 컷 단위 공정 체크보드가 열립니다.' }),
        el('button.btn.btn-primary', {
          text: '＋ 작품 추가', style: { marginTop: '12px' },
          onclick: function () { workDialog(null); }
        })
      ]));
      return;
    }

    var cur = current();
    var work = cur.work, ep = cur.ep;

    root.appendChild(el('div.work-toolbar', {}, [
      el('select.field', {
        style: { width: 'auto' },
        onchange: function () { select(this.value, ''); }
      }, list.map(function (w) {
        return el('option', { value: w.id, text: w.name, selected: w.id === work.id });
      })),
      el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '✎', title: '작품 이름 수정 · 삭제', onclick: function () { workDialog(work); }
      }),
      el('button.btn.btn-sm', { text: '＋ 작품', onclick: function () { workDialog(null); } })
    ]));

    // 회차 칩
    var chips = work.episodes.slice().sort(function (a, b) { return (+a.number || 0) - (+b.number || 0); })
      .map(function (e) {
        return el('button.ep-chip' + (ep && e.id === ep.id ? '.active' : ''), {
          onclick: function () { select(work.id, e.id); }
        }, [
          el('b', { text: e.number + '화' })
        ]);
      });
    chips.push(el('button.ep-chip.add', {
      text: '＋ 회차', onclick: function () { episodeDialog(work); }
    }));
    root.appendChild(el('div.ep-bar', {}, chips));

    if (!ep) {
      root.appendChild(el('div.empty', { text: '회차가 없습니다.\n＋ 회차 로 첫 화를 만들어 보세요.' }));
      return;
    }

    root.appendChild(el('div.ep-head', {}, [
      episodeHeaderControl(work, ep),
      el('span.spacer'),
      el('button.btn.btn-sm' + (reorder ? '.active' : ''), {
        text: reorder ? '순서 변경 끝내기' : '순서 변경',
        onclick: function () { reorder = !reorder; render(); }
      })
    ]));

    if (reorder) {
      root.appendChild(el('div.callout', {}, [
        el('strong', { text: '순서 변경 모드 ' }),
        '— 손잡이(⠿)를 끌거나 ↑ ↓ 로 공정 순서를 바꾸고, ✎ 로 이름을 고치고 ✕ 로 지웁니다.'
      ]));
    }

    var procs = sortedProcesses(ep);
    var cards = procs.map(function (pr, i) {
      return processNode(work, ep, pr, i, procs.length);
    });
    cards.push(el('button.proc-add', {
      type: 'button', text: '＋ 공정 추가', onclick: function () { processDialog(work, ep, null); }
    }));
    root.appendChild(el('div.board', {}, cards));
  }

  MW.work = {
    mount: function (node) { root = node; render(); },
    render: render,
    DEFAULT_PROCESSES: DEFAULT_PROCESSES
  };
})();
