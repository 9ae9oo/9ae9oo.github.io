/* ==========================================================================
   MW.work — 작업 관리 (작품 → 회차 → 컷 → 공정 체크보드)
   기획서 PRD v1 5장.
   · 체크는 클릭 한 번으로 끝납니다.
   · 퍼센트 · 진행률 · 통계 · "현재 공정 자동 판단"은 넣지 않습니다 (5-4 결정 사항).
   · 평상시에는 화면을 깔끔하게 두고, [순서 변경] 모드에서만 손잡이와 삭제 버튼이 보입니다.

     works: [{ id, name, archived, episodes: [
       { id, number, cutCount, dueDate, processes: [
         { id, name, order, collapsed, completedCuts: [1,2,3] }
       ] }
     ] }]
     (부제 title 은 더는 UI 에서 안 씀. dueDate 는 없으면 '' 취급)
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var DEFAULT_PROCESSES = ['콘티', '선화', '밑색', '명암', '후보정'];
  var PER_ROW = 10;

  var root = null;
  var reorder = false;          // [순서 변경] 모드 (저장하지 않는 화면 상태)
  var dragId = null;

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
      epCount = el('input.field', { type: 'number', min: '0', max: '999', placeholder: '0' });
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
          el('div.form-row', {}, [el('label', { text: '회차 수 (선택)' }), epCount]),
          el('div.form-row', {}, [el('label', { text: '화별 컷수' }), cutsPerEp])
        ]),
        w ? null : el('div.form-row', {}, [
          el('label', { text: '공정 단계' }),
          stepsWrap,
          el('div.row', { style: { marginTop: '6px' } }, [stepInput, el('button.btn.btn-sm', { text: '추가', onclick: function () { addStep(); } })])
        ]),
        w ? null : el('div.small.dim', {
          text: '회차 수를 비워두면 작품만 만들어집니다. 채우면 1화부터 그 수만큼, 위 컷수·공정 구성으로 한 번에 만들어집니다.'
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
          var n = U.clamp(parseInt(epCount.value, 10) || 0, 0, 999);
          if (n > 0 && !steps.length) { U.toast('공정을 하나 이상 넣어 주세요.', 'warn'); return false; }
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

  function episodeDialog(work, ep) {
    var last = work.episodes[work.episodes.length - 1];
    var number = el('input.field', {
      type: 'number', min: '0',
      value: ep ? ep.number : (last ? (+last.number || 0) + 1 : 1)
    });
    // 전체 컷 수는 회차가 이미 있으면 화면의 인라인 편집기(cutCountControl)로만 고칩니다.
    // 여기선 신규 생성 때만 필요합니다.
    var cuts = ep ? null : el('input.field', {
      type: 'number', min: '1', max: '999',
      value: last ? last.cutCount : 60
    });

    MW.shell.modal({
      title: ep ? '회차 수정' : '회차 추가',
      body: [
        ep
          ? el('div.form-row', {}, [el('label', { text: '회차 번호' }), number])
          : el('div.form-grid', {}, [
              el('div.form-row', {}, [el('label', { text: '회차 번호' }), number]),
              el('div.form-row', {}, [el('label', { text: '전체 컷 수' }), cuts])
            ]),
        ep ? null : el('div.small.dim', {
          text: '기본 공정 ' + DEFAULT_PROCESSES.join(' · ') + ' 가 함께 만들어집니다. 이름은 나중에 바꿀 수 있습니다.'
        })
      ],
      extra: ep ? el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          MW.shell.closeModal();
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
      }) : null,
      onOk: function () {
        var num = parseInt(number.value, 10) || 0;
        var newId = U.uid('ep');
        MW.store.update(function (s) {
          var w = s.works.find(function (x) { return x.id === work.id; });
          if (!w) return;
          if (ep) {
            var x = w.episodes.find(function (y) { return y.id === ep.id; });
            if (!x) return;
            x.number = num;
          } else {
            var cut = U.clamp(parseInt(cuts.value, 10) || 1, 1, 999);
            w.episodes.push({
              id: newId, number: num, cutCount: cut,
              processes: DEFAULT_PROCESSES.map(function (n, i) {
                return { id: U.uid('pr'), name: n, order: i, collapsed: i !== 0, completedCuts: [] };
              })
            });
            s.settings.workSel = { workId: w.id, epId: newId };
          }
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

  /** 한 공정의 완료 lookup·완료 개수·남은 개수 (컷 수 기준). processNode 와 episodeRemain 이 함께 씁니다 */
  function processProgress(ep, pr) {
    var done = {};
    pr.completedCuts.forEach(function (n) { done[n] = true; });
    var doneCount = 0;
    for (var k = 1; k <= ep.cutCount; k++) if (done[k]) doneCount++;
    return { done: done, doneCount: doneCount, remain: ep.cutCount - doneCount };
  }

  /** 완료 안 된 모든 공정의 남은 개수 합 - 회차 전체 "남은 일감" 수. 마감 계산기(dueDateControl)가 씁니다 */
  function episodeRemain(ep) {
    return ep.processes.reduce(function (sum, pr) { return sum + processProgress(ep, pr).remain; }, 0);
  }

  /** "남은 N컷" 자리 - 완료면 뱃지, 아니면 진행 개수를 팝업 없이 바로 쓰거나 한 번에 전체 체크 */
  function progressControl(work, ep, pr, doneCount, remain) {
    if (remain <= 0) return el('span.proc-remain.done', { text: '완료' });

    var wrap = el('span.proc-progress');

    function showLabel() {
      U.clear(wrap);
      wrap.appendChild(el('span', { text: '진행 ' }));
      wrap.appendChild(el('button.proc-progress-num', {
        type: 'button', text: String(doneCount), title: '진행한 컷 수 바로 쓰기', onclick: showInput
      }));
      wrap.appendChild(el('span', { text: ' / ' + ep.cutCount }));
      wrap.appendChild(el('button.proc-progress-all', {
        type: 'button', text: '전체 체크', onclick: function () { toggleRow(work, ep, pr, 1, ep.cutCount); }
      }));
    }

    function showInput() {
      U.clear(wrap);
      var inp = el('input.proc-progress-input', { type: 'number', min: '0', max: String(ep.cutCount), value: doneCount });
      var doneOnce = false;
      function commit() {
        if (doneOnce) return;
        doneOnce = true;
        var v = parseInt(inp.value, 10);
        if (isNaN(v)) v = doneCount;
        v = U.clamp(v, 0, ep.cutCount);
        if (v === doneCount) { showLabel(); return; }
        MW.store.update(function (s) {
          var e = findEp(s, work.id, ep.id);
          if (!e) return;
          var p = e.processes.find(function (x) { return x.id === pr.id; });
          if (!p) return;
          var nums = [];
          for (var n = 1; n <= v; n++) nums.push(n);
          p.completedCuts = nums;
        });
      }
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { doneOnce = true; showLabel(); }
      });
      inp.addEventListener('blur', commit);
      wrap.appendChild(el('span', { text: '진행 ' }));
      wrap.appendChild(inp);
      wrap.appendChild(el('span', { text: ' / ' + ep.cutCount }));
      inp.focus();
      inp.select();
    }

    showLabel();
    return wrap;
  }

  /** "마감" - cutCountControl 과 같은 라벨↔입력 토글 패턴. 팝업 없음 */
  function dueDateControl(work, ep) {
    var wrap = el('span.ep-due');

    function diffDays(dueStr) {
      var due = new Date(dueStr + 'T00:00:00').getTime();
      var today = new Date(U.ymd(new Date()) + 'T00:00:00').getTime();
      return Math.round((due - today) / 86400000);
    }

    function showLabel() {
      U.clear(wrap);
      var due = ep.dueDate;
      if (!due) {
        wrap.appendChild(el('button.ep-due-set', { type: 'button', text: '마감 설정', title: '마감일 설정', onclick: showInput }));
        return;
      }
      var diff = diffDays(due);
      var dday = diff === 0 ? 'D-day' : diff > 0 ? 'D-' + diff : 'D+' + (-diff);
      var text;
      if (diff < 0) {
        var remainLate = episodeRemain(ep);
        text = '마감 ' + dday + ' 지남' + (remainLate > 0 ? ' · 총 남은 ' + remainLate + '개' : '');
      } else {
        var remain = episodeRemain(ep);
        if (remain <= 0) text = '마감 ' + dday + ' · 완료';
        else text = '마감 ' + dday + ' · 하루 ' + Math.ceil(remain / (diff + 1)) + '개';
      }
      wrap.appendChild(el('span.ep-due-text' + (diff < 0 ? '.late' : ''), { text: text }));
      wrap.appendChild(el('button.ep-cuts-edit', { type: 'button', text: '✎', title: '마감일 수정', onclick: showInput }));
    }

    function showInput() {
      U.clear(wrap);
      var inp = el('input.ep-due-input', { type: 'date', value: ep.dueDate || '' });
      var doneOnce = false;
      function commit() {
        if (doneOnce) return;
        doneOnce = true;
        var v = inp.value || '';
        if (v === (ep.dueDate || '')) { showLabel(); return; }
        MW.store.update(function (s) {
          var e = findEp(s, work.id, ep.id);
          if (!e) return;
          e.dueDate = v;
        });
      }
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { doneOnce = true; showLabel(); }
      });
      inp.addEventListener('blur', commit);
      wrap.appendChild(el('span', { text: '마감 ' }));
      wrap.appendChild(inp);
      inp.focus();
    }

    showLabel();
    return wrap;
  }

  function processNode(work, ep, pr, index, total) {
    var progress = processProgress(ep, pr);
    var done = progress.done, doneCount = progress.doneCount, remain = progress.remain;

    var head = el('div.proc-head', {}, [
      reorder ? el('span.proc-grip', { text: '⠿', title: '끌어서 순서 바꾸기' }) : null,
      el('button.proc-toggle', {
        onclick: function () { toggleCollapse(work, ep, pr); }
      }, [
        el('span.caret', { text: pr.collapsed ? '▸' : '▾' }),
        el('span.proc-name', { text: pr.name })
      ]),
      progressControl(work, ep, pr, doneCount, remain),
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
                onclick: function () { toggleCut(work, ep, pr, num); }
              }));
            })(n);
          }
          body.appendChild(el('div.cut-row', {}, [
            el('button.cut-label', {
              text: f === t ? String(f) : f + '~' + t,
              title: '이 줄 전체 체크 / 해제',
              onclick: function () { toggleRow(work, ep, pr, f, t); }
            }),
            el('div.cuts', {}, cells)
          ]));
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

  /** "전체 N컷" — ✎ 를 누르면 그 자리에서 숫자 입력으로 바뀌는 인라인 편집기 */
  function cutCountControl(work, ep) {
    var wrap = el('span.ep-cuts');

    function showLabel() {
      U.clear(wrap);
      wrap.appendChild(el('span', { text: '전체 ' + ep.cutCount + '컷' }));
      wrap.appendChild(el('button.ep-cuts-edit', {
        type: 'button', text: '✎', title: '전체 컷 수 수정', onclick: showInput
      }));
    }

    function showInput() {
      U.clear(wrap);
      var inp = el('input.ep-cuts-input', { type: 'number', min: '1', max: '999', value: ep.cutCount });
      var doneOnce = false;
      function commit() {
        if (doneOnce) return;
        doneOnce = true;
        var v = U.clamp(parseInt(inp.value, 10) || ep.cutCount, 1, 999);
        if (v === ep.cutCount) { showLabel(); return; }
        MW.store.update(function (s) {
          var e = findEp(s, work.id, ep.id);
          if (!e) return;
          e.cutCount = v;
          // 컷 수를 줄이면 사라진 컷의 체크는 지웁니다
          e.processes.forEach(function (pr) {
            pr.completedCuts = pr.completedCuts.filter(function (n) { return n <= v; });
          });
        });
      }
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { doneOnce = true; showLabel(); }
      });
      inp.addEventListener('blur', commit);
      wrap.appendChild(el('span', { text: '전체 ' }));
      wrap.appendChild(inp);
      wrap.appendChild(el('span', { text: ' 컷' }));
      inp.focus();
      inp.select();
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
          el('b', { text: e.number + '화' }),
          el('span.cut-n', { text: e.cutCount + '컷' })
        ]);
      });
    chips.push(el('button.ep-chip.add', {
      text: '＋ 회차', onclick: function () { episodeDialog(work, null); }
    }));
    root.appendChild(el('div.ep-bar', {}, chips));

    if (!ep) {
      root.appendChild(el('div.empty', { text: '회차가 없습니다.\n＋ 회차 로 첫 화를 만들어 보세요.' }));
      return;
    }

    root.appendChild(el('div.ep-head', {}, [
      el('h3', { text: ep.number + '화' }),
      cutCountControl(work, ep),
      dueDateControl(work, ep),
      el('span.spacer'),
      el('button.btn.btn-sm' + (reorder ? '.active' : ''), {
        text: reorder ? '순서 변경 끝내기' : '순서 변경',
        onclick: function () { reorder = !reorder; render(); }
      }),
      el('button.btn.btn-ghost.btn-icon.btn-sm', {
        text: '⚙', title: '회차 정보 (번호 · 삭제)',
        onclick: function () { episodeDialog(work, ep); }
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
