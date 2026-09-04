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

  var DEFAULT_PROCESSES = ['콘티', '스케치', '선화', '밑색', '명암', '후보정'];
  var PER_ROW = 10;

  /** 3자리 0채움 — "017", "032". D-day·하루 할당량 숫자가 자릿수 바뀔 때마다 폭이 흔들리지
      않게 고정폭으로 씁니다 (컷수 상한 999 와 같은 자리수). */
  function pad3(n) {
    n = Math.abs(n);
    return (n < 10 ? '00' : n < 100 ? '0' : '') + n;
  }

  var root = null;
  var reorder = false;          // [순서 변경] 모드 (저장하지 않는 화면 상태)
  var createOpen = false;       // 작품 추가 영역의 펼침 상태 (기본은 접힘, 저장하지 않음)
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

  function cleanProcessNames(names) {
    var seen = {};
    return (Array.isArray(names) ? names : []).map(function (name) {
      return String(name || '').trim();
    }).filter(function (name) {
      if (!name || seen[name]) return false;
      seen[name] = true;
      return true;
    });
  }

  function processNamesOf(ep) {
    return ep ? cleanProcessNames(sortedProcesses(ep).map(function (p) { return p.name; })) : [];
  }

  function hasWorkTemplate(work) {
    return !!(work && work.template && typeof work.template === 'object' &&
      +work.template.cutCount >= 1 && cleanProcessNames(work.template.processes).length);
  }

  /** 예전 작품에는 template 필드가 없으므로 가장 마지막 회차를 임시 기본값으로 사용합니다. */
  function templateOf(work) {
    if (hasWorkTemplate(work)) {
      return {
        cutCount: U.clamp(parseInt(work.template.cutCount, 10) || 60, 1, 999),
        processes: cleanProcessNames(work.template.processes),
        inferred: false,
        sourceNumber: null
      };
    }
    var episodes = (work && Array.isArray(work.episodes) ? work.episodes : []).slice()
      .sort(function (a, b) { return (+a.number || 0) - (+b.number || 0); });
    var source = episodes[episodes.length - 1] || null;
    var names = processNamesOf(source);
    return {
      cutCount: source ? U.clamp(parseInt(source.cutCount, 10) || 60, 1, 999) : 60,
      processes: names.length ? names : DEFAULT_PROCESSES.slice(),
      inferred: true,
      sourceNumber: source ? source.number : null
    };
  }

  function cloneEpisode(ep) {
    return JSON.parse(JSON.stringify(ep));
  }

  /** 공정 이름이 같은 항목은 체크 기록과 마감일을 보존하고, 새 공정만 빈 상태로 만듭니다. */
  function setEpisodeProcesses(ep, names) {
    var unused = ep.processes.slice();
    ep.processes = names.map(function (name, order) {
      var index = unused.findIndex(function (p) { return p.name === name; });
      var process = index >= 0 ? unused.splice(index, 1)[0] : {
        id: U.uid('pr'), name: name, collapsed: order !== 0, completedCuts: []
      };
      process.name = name;
      process.order = order;
      if (!Array.isArray(process.completedCuts)) process.completedCuts = [];
      return process;
    });
  }

  function bindProcessTagDrag(handle, tag, container, list, index, redraw, onChange) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var targetIndex = index;
      tag.classList.add('dragging');

      function clearTargets() {
        Array.prototype.forEach.call(container.querySelectorAll('.work-template-sort-tag'), function (node) {
          node.classList.remove('drag-over');
        });
      }
      function move(ev) {
        ev.preventDefault();
        var target = document.elementFromPoint(ev.clientX, ev.clientY);
        target = target && target.closest ? target.closest('.work-template-sort-tag') : null;
        if (!target || !container.contains(target)) return;
        targetIndex = parseInt(target.dataset.processIndex, 10);
        clearTargets();
        if (targetIndex !== index) target.classList.add('drag-over');
      }
      function finish() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', finish);
        clearTargets();
        tag.classList.remove('dragging');
        if (targetIndex === index || isNaN(targetIndex)) return;
        list.splice(targetIndex, 0, list.splice(index, 1)[0]);
        redraw();
        if (onChange) onChange();
      }
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    });
  }

  /* ------------------------------------------------------------ 작품 · 회차 */

  function createWork(name, episodeCount, cutCount, steps) {
    var newId = U.uid('work');
    var episodes = [];
    for (var i = 1; i <= episodeCount; i++) {
      episodes.push({
        id: U.uid('ep'), number: i, cutCount: cutCount,
        processes: steps.map(function (stepName, k) {
          return { id: U.uid('pr'), name: stepName, order: k, collapsed: k !== 0, completedCuts: [] };
        })
      });
    }
    MW.store.update(function (s) {
      s.works.push({
        id: newId, name: name, archived: false,
        template: { cutCount: cutCount, processes: steps.slice() },
        episodes: episodes
      });
      s.settings.workSel = { workId: newId, epId: episodes.length ? episodes[0].id : '' };
    });
  }

  function workCreatePanel() {
    var steps = DEFAULT_PROCESSES.slice();
    var name = el('input.field.work-create-name', {
      id: 'work-create-name', type: 'text', placeholder: '작품 이름 입력', autocomplete: 'off'
    });
    var epCount = el('input.field.work-create-number', {
      id: 'work-create-episodes', type: 'text', inputmode: 'numeric', value: '1', maxlength: '3',
      oninput: function () { this.value = this.value.replace(/\D/g, '').slice(0, 3); }
    });
    var cutsPerEp = el('input.field.work-create-number', {
      id: 'work-create-cuts', type: 'text', inputmode: 'numeric', value: '60', maxlength: '3',
      oninput: function () { this.value = this.value.replace(/\D/g, '').slice(0, 3); }
    });
    var stepInput = el('input.field.work-create-step', {
      id: 'work-create-step', type: 'text', placeholder: '공정 이름', autocomplete: 'off',
      onkeydown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addStep();
        }
      }
    });
    var tags = el('div.work-create-tags', { 'aria-label': '추가할 공정 단계' });

    function renderSteps() {
      U.clear(tags);
      if (!steps.length) {
        tags.appendChild(el('span.work-create-tags-empty', { text: '공정을 추가해 주세요.' }));
        return;
      }
      steps.forEach(function (stepName, i) {
        var dragHandle = el('button.work-template-drag-handle', {
          type: 'button', text: '⠿', title: stepName + ' 순서 이동', 'aria-label': stepName + ' 순서 이동'
        });
        var tag = el('span.chip.work-create-tag.work-template-sort-tag', {
          dataset: { processIndex: String(i) }
        }, [
          dragHandle,
          el('span', { text: stepName }),
          el('button.work-create-tag-remove', {
            type: 'button', text: '✕', title: stepName + ' 삭제', 'aria-label': stepName + ' 삭제',
            onclick: function () { steps.splice(i, 1); renderSteps(); }
          })
        ]);
        bindProcessTagDrag(dragHandle, tag, tags, steps, i, renderSteps);
        tags.appendChild(tag);
      });
    }

    function addStep() {
      var value = stepInput.value.trim();
      if (!value) return;
      steps.push(value);
      stepInput.value = '';
      renderSteps();
      stepInput.focus();
    }

    function submit() {
      var workName = name.value.trim();
      if (!workName) {
        U.toast('작품 이름을 입력해 주세요.', 'warn');
        name.focus();
        return;
      }
      if (!steps.length) {
        U.toast('공정을 하나 이상 넣어 주세요.', 'warn');
        stepInput.focus();
        return;
      }
      var episodeN = U.clamp(parseInt(epCount.value, 10) || 1, 1, 999);
      var cutN = U.clamp(parseInt(cutsPerEp.value, 10) || 60, 1, 999);
      createWork(workName, episodeN, cutN, steps);
    }

    var body = el('form.work-create-body', {
      onsubmit: function (e) { e.preventDefault(); submit(); }
    }, [
      el('div.work-create-line.work-create-name-line', {}, [
        el('label', { for: 'work-create-name', text: '작품 이름' }),
        name,
        el('button.btn.btn-primary.work-create-submit', { type: 'submit', text: '작품 추가하기' })
      ]),
      el('div.work-create-line.work-create-count-line', {}, [
        el('label', { for: 'work-create-episodes', text: '회차수' }),
        epCount,
        el('label.work-create-cut-label', { for: 'work-create-cuts', text: '화별 기본 컷수' }),
        cutsPerEp,
        el('span.work-create-unit', { text: '컷' })
      ]),
      el('div.work-create-line.work-create-process-line', {}, [
        el('label', { for: 'work-create-step', text: '공정 단계' }),
        stepInput,
        el('button.btn.work-create-step-add', { type: 'button', text: '추가', onclick: addStep })
      ]),
      tags
    ]);
    body.hidden = !createOpen;
    var caret = el('span.work-create-caret', { text: createOpen ? '▼' : '▶', 'aria-hidden': 'true' });
    var toggle = el('button.work-create-toggle', {
      type: 'button', title: createOpen ? '접기' : '펼치기',
      'aria-label': createOpen ? '작품 추가 영역 접기' : '작품 추가 영역 펼치기',
      'aria-expanded': String(createOpen),
      onclick: function () {
        createOpen = !createOpen;
        body.hidden = !createOpen;
        caret.textContent = createOpen ? '▼' : '▶';
        toggle.title = createOpen ? '접기' : '펼치기';
        toggle.setAttribute('aria-label', createOpen ? '작품 추가 영역 접기' : '작품 추가 영역 펼치기');
        toggle.setAttribute('aria-expanded', String(createOpen));
      }
    }, [caret]);
    var heading = el('div.work-create-heading', {}, [
      toggle,
      el('h2', { text: '작품 추가하기' })
    ]);

    renderSteps();
    return el('section.work-create-panel', {}, [heading, body]);
  }

  function processTagEditor(initialNames, onChange) {
    var names = cleanProcessNames(initialNames);
    var tags = el('div.work-template-tags', { 'aria-label': '공정 태그' });
    var input = el('input.field.work-template-process-input', {
      type: 'text', placeholder: '공정 이름', autocomplete: 'off',
      onkeydown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          add();
        }
      }
    });

    function changed() { if (onChange) onChange(); }
    function draw() {
      U.clear(tags);
      if (!names.length) {
        tags.appendChild(el('span.work-create-tags-empty', { text: '공정을 추가해 주세요.' }));
        return;
      }
      names.forEach(function (processName, index) {
        var dragHandle = el('button.work-template-drag-handle', {
          type: 'button', text: '⠿', title: processName + ' 순서 이동', 'aria-label': processName + ' 순서 이동'
        });
        var tag = el('span.chip.work-create-tag.work-template-sort-tag', {
          dataset: { processIndex: String(index) }
        }, [
          dragHandle,
          el('span', { text: processName }),
          el('button.work-create-tag-remove', {
            type: 'button', text: '✕', title: processName + ' 삭제', 'aria-label': processName + ' 삭제',
            onclick: function () {
              names.splice(index, 1);
              draw();
              changed();
            }
          })
        ]);
        bindProcessTagDrag(dragHandle, tag, tags, names, index, draw, changed);
        tags.appendChild(tag);
      });
    }
    function add() {
      var value = input.value.trim();
      if (!value) return;
      if (names.indexOf(value) >= 0) {
        U.toast('이미 들어 있는 공정입니다.', 'warn');
        input.select();
        return;
      }
      names.push(value);
      input.value = '';
      draw();
      changed();
      input.focus();
    }

    draw();
    return {
      node: el('div.work-template-process-editor', {}, [
        el('div.work-template-process-add', {}, [
          input,
          el('button.btn.btn-sm', { type: 'button', text: '추가', onclick: add })
        ]),
        tags
      ]),
      getNames: function () { return names.slice(); }
    };
  }

  function workTemplateDialog(work) {
    var baseTemplate = templateOf(work);
    var originalEpisodes = work.episodes.map(cloneEpisode);
    var episodeDrafts = work.episodes.map(cloneEpisode);
    var selected = {};
    var approvedWarning = '';

    var name = el('input.field', { type: 'text', value: work.name, placeholder: '작품 이름' });
    var defaultCuts = el('input.field.work-template-cut-input', {
      type: 'text', inputmode: 'numeric', value: String(baseTemplate.cutCount), maxlength: '3',
      oninput: function () { this.value = this.value.replace(/\D/g, '').slice(0, 3); }
    });
    var templateProcesses = processTagEditor(baseTemplate.processes);
    var episodeList = el('div.work-template-episode-list');
    var selectedCount = el('span.work-template-selected-count', { text: '0개 선택' });
    var selectAll = el('input.chk', { type: 'checkbox', 'aria-label': '전체 회차 선택' });
    var editSelected = el('button.btn.btn-sm', { type: 'button', text: '선택 수정', disabled: true });
    var deleteSelected = el('button.btn.btn-sm.btn-danger', { type: 'button', text: '선택 삭제', disabled: true });
    var selectionArea = el('div.work-template-selection-area');
    var deleteNotice = el('div.work-template-delete-note');
    var warningBox = el('div.work-template-save-warning');
    warningBox.hidden = true;
    deleteNotice.hidden = true;

    function sortedDrafts() {
      return episodeDrafts.slice().sort(function (a, b) { return (+a.number || 0) - (+b.number || 0); });
    }
    function selectedDrafts() {
      return sortedDrafts().filter(function (ep) { return !!selected[ep.id]; });
    }
    function closeSelectionArea() { U.clear(selectionArea); }
    function updateSelectionState() {
      var count = selectedDrafts().length;
      var total = episodeDrafts.length;
      selectedCount.textContent = count + '개 선택';
      selectAll.checked = total > 0 && count === total;
      selectAll.indeterminate = count > 0 && count < total;
      selectAll.disabled = total === 0;
      editSelected.disabled = count === 0;
      deleteSelected.disabled = count === 0;
    }
    function episodeProcessChips(ep) {
      var names = processNamesOf(ep);
      if (!names.length) return [el('span.small.dim', { text: '공정 없음' })];
      return names.map(function (processName) {
        return el('span.chip.work-template-mini-tag', { text: processName });
      });
    }
    function drawEpisodeList() {
      U.clear(episodeList);
      Object.keys(selected).forEach(function (id) {
        if (!episodeDrafts.some(function (ep) { return ep.id === id; })) delete selected[id];
      });
      var drafts = sortedDrafts();
      if (!drafts.length) {
        episodeList.appendChild(el('div.work-template-episodes-empty', { text: '남아 있는 회차가 없습니다.' }));
      }
      drafts.forEach(function (ep) {
        var checkbox = el('input.chk', {
          type: 'checkbox', checked: !!selected[ep.id], 'aria-label': ep.number + '화 선택',
          onchange: function () {
            if (this.checked) selected[ep.id] = true;
            else delete selected[ep.id];
            closeSelectionArea();
            updateSelectionState();
          }
        });
        episodeList.appendChild(el('div.work-template-episode-row', { dataset: { episodeId: ep.id } }, [
          checkbox,
          el('strong.work-template-episode-number', { text: ep.number + '화' }),
          el('span.work-template-episode-cuts', { text: '총 ' + ep.cutCount + '컷' }),
          el('div.work-template-episode-processes', {}, episodeProcessChips(ep))
        ]));
      });
      updateSelectionState();
      drawDeleteNotice();
    }
    function drawDeleteNotice() {
      var alive = {};
      episodeDrafts.forEach(function (ep) { alive[ep.id] = true; });
      var deleted = originalEpisodes.filter(function (ep) { return !alive[ep.id]; })
        .sort(function (a, b) { return (+a.number || 0) - (+b.number || 0); });
      U.clear(deleteNotice);
      deleteNotice.hidden = !deleted.length;
      if (!deleted.length) return;
      deleteNotice.appendChild(el('span', {
        text: deleted.map(function (ep) { return ep.number + '화'; }).join(', ') +
          ' 삭제 예정 · 저장 전까지 취소할 수 있습니다.'
      }));
      deleteNotice.appendChild(el('button.btn.btn-sm', {
        type: 'button', text: '삭제 취소',
        onclick: function () {
          var current = {};
          episodeDrafts.forEach(function (ep) { current[ep.id] = true; });
          originalEpisodes.forEach(function (ep) {
            if (!current[ep.id]) episodeDrafts.push(cloneEpisode(ep));
          });
          approvedWarning = '';
          closeSelectionArea();
          drawEpisodeList();
        }
      }));
    }

    selectAll.addEventListener('change', function () {
      selected = {};
      if (selectAll.checked) episodeDrafts.forEach(function (ep) { selected[ep.id] = true; });
      closeSelectionArea();
      drawEpisodeList();
    });

    editSelected.addEventListener('click', function () {
      var targets = selectedDrafts();
      if (!targets.length) return;
      U.clear(selectionArea);
      var firstCuts = targets[0].cutCount;
      var sameCuts = targets.every(function (ep) { return ep.cutCount === firstCuts; });
      var firstNames = processNamesOf(targets[0]);
      var sameProcesses = targets.every(function (ep) {
        return JSON.stringify(processNamesOf(ep)) === JSON.stringify(firstNames);
      });
      var changeCuts = el('input.chk', { type: 'checkbox' });
      var cutInput = el('input.field.work-template-cut-input', {
        type: 'text', inputmode: 'numeric', value: sameCuts ? String(firstCuts) : '',
        placeholder: sameCuts ? '' : '서로 다른 값', maxlength: '3',
        oninput: function () {
          this.value = this.value.replace(/\D/g, '').slice(0, 3);
          changeCuts.checked = true;
        }
      });
      var changeProcesses = el('input.chk', { type: 'checkbox' });
      var processEditor = processTagEditor(sameProcesses ? firstNames : templateProcesses.getNames(), function () {
        changeProcesses.checked = true;
      });

      selectionArea.appendChild(el('div.work-template-selection-editor', {}, [
        el('div.work-template-selection-head', {}, [
          el('strong', { text: targets.length + '개 회차 수정' }),
          el('span.small.dim', { text: '체크한 항목만 바뀝니다.' })
        ]),
        el('label.work-template-change-row', {}, [
          changeCuts,
          el('span', { text: '컷수 변경' }),
          cutInput,
          el('span.small.dim', { text: '컷' })
        ]),
        el('div.work-template-change-processes', {}, [
          el('label.work-template-change-row', {}, [changeProcesses, el('span', { text: '공정 변경' })]),
          sameProcesses ? null : el('div.small.dim', {
            text: '선택한 회차의 공정 구성이 서로 달라 기본 공정을 표시했습니다.'
          }),
          processEditor.node
        ]),
        el('div.work-template-selection-actions', {}, [
          el('button.btn.btn-sm', { type: 'button', text: '닫기', onclick: closeSelectionArea }),
          el('button.btn.btn-sm.btn-primary', {
            type: 'button', text: '선택 항목에 적용',
            onclick: function () {
              if (!changeCuts.checked && !changeProcesses.checked) {
                U.toast('바꿀 항목을 체크해 주세요.', 'warn');
                return;
              }
              var cut = null;
              if (changeCuts.checked) {
                cut = parseInt(cutInput.value, 10);
                if (!cut || cut < 1) {
                  U.toast('컷수를 입력해 주세요.', 'warn');
                  cutInput.focus();
                  return;
                }
                cut = U.clamp(cut, 1, 999);
              }
              var names = processEditor.getNames();
              if (changeProcesses.checked && !names.length) {
                U.toast('공정을 하나 이상 넣어 주세요.', 'warn');
                return;
              }
              targets.forEach(function (target) {
                var draft = episodeDrafts.find(function (ep) { return ep.id === target.id; });
                if (!draft) return;
                if (changeCuts.checked && cut !== draft.cutCount) {
                  draft.cutCount = cut;
                  draft.processes.forEach(function (process) {
                    process.completedCuts = process.completedCuts.filter(function (n) { return n <= cut; });
                  });
                }
                if (changeProcesses.checked) setEpisodeProcesses(draft, names);
              });
              approvedWarning = '';
              closeSelectionArea();
              drawEpisodeList();
              U.toast(targets.length + '개 회차의 수정 내용을 준비했습니다.');
            }
          })
        ])
      ]));
    });

    deleteSelected.addEventListener('click', function () {
      var targets = selectedDrafts();
      if (!targets.length) return;
      U.clear(selectionArea);
      var numbers = targets.map(function (ep) { return ep.number + '화'; }).join(', ');
      selectionArea.appendChild(el('div.work-template-delete-confirm', {}, [
        el('strong', { text: numbers + ' (' + targets.length + '개)를 삭제할까요?' }),
        el('span.small.dim', { text: '아직 저장되지 않습니다. 아래 저장 버튼을 누르기 전에는 취소할 수 있습니다.' }),
        el('div.work-template-selection-actions', {}, [
          el('button.btn.btn-sm', { type: 'button', text: '취소', onclick: closeSelectionArea }),
          el('button.btn.btn-sm.btn-danger', {
            type: 'button', text: '삭제 예정으로 표시',
            onclick: function () {
              var removing = {};
              targets.forEach(function (ep) { removing[ep.id] = true; });
              episodeDrafts = episodeDrafts.filter(function (ep) { return !removing[ep.id]; });
              selected = {};
              approvedWarning = '';
              closeSelectionArea();
              drawEpisodeList();
            }
          })
        ])
      ]));
    });

    function destructiveMessages() {
      var messages = [];
      var draftsById = {};
      episodeDrafts.forEach(function (ep) { draftsById[ep.id] = ep; });
      var deleted = originalEpisodes.filter(function (ep) { return !draftsById[ep.id]; })
        .sort(function (a, b) { return (+a.number || 0) - (+b.number || 0); });
      if (deleted.length) {
        messages.push('회차 삭제: ' + deleted.map(function (ep) { return ep.number + '화'; }).join(', ') +
          ' (' + deleted.length + '개, 체크 기록 포함)');
      }
      originalEpisodes.forEach(function (original) {
        var draft = draftsById[original.id];
        if (!draft) return;
        if (draft.cutCount < original.cutCount) {
          messages.push(original.number + '화 컷수 축소: ' + original.cutCount + '컷 → ' + draft.cutCount +
            '컷 (초과한 컷의 체크 기록 삭제)');
        }
        var draftNames = processNamesOf(draft);
        var removed = processNamesOf(original).filter(function (processName) {
          return draftNames.indexOf(processName) < 0;
        });
        if (removed.length) {
          messages.push(original.number + '화 공정 삭제: ' + removed.join(', ') + ' (체크·마감 기록 포함)');
        }
      });
      return messages;
    }

    var body = [
      baseTemplate.inferred ? el('div.work-template-inferred', {
        text: baseTemplate.sourceNumber !== null
          ? '이 작품에는 저장된 기본 템플릿이 없어 마지막 회차인 ' + baseTemplate.sourceNumber +
            '화의 컷수와 공정을 불러왔습니다. 저장하면 앞으로 추가하는 회차의 기본값으로 사용됩니다.'
          : '이 작품에는 저장된 기본 템플릿과 회차가 없어 기본값을 불러왔습니다.'
      }) : null,
      el('section.work-template-section', {}, [
        el('div.work-template-section-head', {}, [
          el('strong', { text: '기본 정보' }),
          el('span.small.dim', { text: '새 회차를 만들 때 사용하는 기본값' })
        ]),
        el('div.form-row', {}, [el('label', { text: '작품 명' }), name]),
        el('div.form-row.work-template-cuts-row', {}, [
          el('label', { text: '화별 기본' }), defaultCuts, el('span', { text: '컷' })
        ]),
        el('div.form-row', {}, [el('label', { text: '기본 공정 태그' }), templateProcesses.node])
      ]),
      el('div.work-divider', { 'aria-hidden': 'true' }),
      el('section.work-template-section', {}, [
        el('div.work-template-section-head', {}, [
          el('strong', { text: '작품 회차별 정보' }),
          el('span.small.dim', { text: '기존 회차에서 고칠 항목을 선택' })
        ]),
        el('div.work-template-episode-toolbar', {}, [
          el('label.work-template-select-all', {}, [selectAll, el('span', { text: '전체 선택' })]),
          selectedCount,
          el('span.spacer'),
          editSelected,
          deleteSelected
        ]),
        episodeList,
        selectionArea,
        deleteNotice
      ]),
      warningBox
    ];

    drawEpisodeList();
    var dialog = MW.shell.modal({
      title: '작품 관리',
      body: body,
      okText: '변경 내용 저장',
      extra: el('button.btn.btn-danger.btn-sm', {
        type: 'button', text: '작품 삭제',
        onclick: function () {
          MW.shell.closeModal();
          MW.shell.confirm(
            '“' + work.name + '”과 그 안의 회차 ' + work.episodes.length + '개를 모두 삭제할까요?\n되돌릴 수 없습니다.',
            function () {
              MW.store.update(function (s) {
                s.works = s.works.filter(function (x) { return x.id !== work.id; });
                s.settings.workSel = { workId: '', epId: '' };
              });
              U.toast('작품을 삭제했습니다.');
            }
          );
        }
      }),
      onOk: function () {
        var workName = name.value.trim();
        var cutCount = U.clamp(parseInt(defaultCuts.value, 10) || 0, 1, 999);
        var processNames = templateProcesses.getNames();
        if (!workName) {
          U.toast('작품 이름을 입력해 주세요.', 'warn');
          name.focus();
          return false;
        }
        if (!parseInt(defaultCuts.value, 10)) {
          U.toast('화별 기본 컷수를 입력해 주세요.', 'warn');
          defaultCuts.focus();
          return false;
        }
        if (!processNames.length) {
          U.toast('기본 공정을 하나 이상 넣어 주세요.', 'warn');
          return false;
        }
        var destructive = destructiveMessages();
        var warning = destructive.join('\n');
        if (warning && warning !== approvedWarning) {
          approvedWarning = warning;
          warningBox.hidden = false;
          warningBox.textContent = '저장하면 다음 내용은 되돌릴 수 없습니다.\n• ' +
            destructive.join('\n• ') + '\n한 번 더 누르면 적용합니다.';
          if (saveButton) saveButton.textContent = '확인하고 적용';
          warningBox.scrollIntoView({ block: 'nearest' });
          return false;
        }
        MW.store.update(function (s) {
          var target = s.works.find(function (item) { return item.id === work.id; });
          if (!target) return;
          target.name = workName;
          target.template = { cutCount: cutCount, processes: processNames.slice() };
          target.episodes = episodeDrafts.map(cloneEpisode);
          if (s.settings.workSel && s.settings.workSel.workId === target.id) {
            var selectedStillExists = target.episodes.some(function (ep) {
              return ep.id === s.settings.workSel.epId;
            });
            if (!selectedStillExists) {
              var first = target.episodes.slice().sort(function (a, b) {
                return (+a.number || 0) - (+b.number || 0);
              })[0];
              s.settings.workSel.epId = first ? first.id : '';
            }
          }
        });
        U.toast('작품 템플릿을 저장했습니다.');
      }
    });
    dialog.box.classList.add('work-template-modal');
    var saveButton = dialog.box.querySelector('.modal-foot .btn-primary');
  }

  /** 신규 회차 생성 전용 (기존 회차 편집·삭제는 episodeHeaderControl 로 옮겼습니다) */
  function episodeDialog(work) {
    var baseTemplate = templateOf(work);
    var last = work.episodes.slice().sort(function (a, b) {
      return (+a.number || 0) - (+b.number || 0);
    }).pop();
    var number = el('input.field', {
      type: 'number', min: '0',
      value: last ? (+last.number || 0) + 1 : 1
    });
    var cuts = el('input.field', {
      type: 'number', min: '1', max: '999',
      value: baseTemplate.cutCount
    });

    MW.shell.modal({
      title: '회차 추가',
      body: [
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '회차 번호' }), number]),
          el('div.form-row', {}, [el('label', { text: '전체 컷 수' }), cuts])
        ]),
        el('div.small.dim', {
          text: '기본 공정 ' + baseTemplate.processes.join(' · ') + '이(가) 함께 만들어집니다.'
        })
      ],
      onOk: function () {
        var num = parseInt(number.value, 10) || 0;
        var cut = U.clamp(parseInt(cuts.value, 10) || 1, 1, 999);
        var newId = U.uid('ep');
        MW.store.update(function (s) {
          var w = s.works.find(function (x) { return x.id === work.id; });
          if (!w) return;
          if (!hasWorkTemplate(w)) {
            w.template = { cutCount: baseTemplate.cutCount, processes: baseTemplate.processes.slice() };
          }
          w.episodes.push({
            id: newId, number: num, cutCount: cut,
            processes: baseTemplate.processes.map(function (n, i) {
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

    // "전체 완료" ↔ "전체 취소" — remain 이 0 이 됐다고 버튼 자체를 없애면 실수로 전체
    // 체크했을 때 되돌릴 자리가 이 줄에서 사라져 버립니다. 자리는 그대로 두고 라벨·동작만 뒤집습니다.
    nodes.push(el('span.ep-header-sep', { text: '|' }));
    if (remain > 0 && due && diff >= 0) {
      var daily = Math.ceil(remain / (diff + 1));
      nodes.push(el('span.proc-quota', { text: '하루 할당량 ' + pad3(daily) + '컷 남음' }));
    }
    nodes.push(el('button.btn.btn-sm', {
      type: 'button',
      text: remain > 0 ? '전체 완료' : '전체 취소',
      title: remain > 0 ? '전체 체크' : '전체 해제',
      onclick: function () { toggleRow(work, ep, pr, 1, ep.cutCount); }
    }));

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

    root.appendChild(workCreatePanel());
    root.appendChild(el('div.work-divider', { 'aria-hidden': 'true' }));

    var list = works();
    if (!list.length) {
      root.appendChild(el('div.empty.work-empty', {}, [
        el('div', { text: '아직 작품이 없습니다.' }),
        el('div.small.dim', { text: '위 입력칸에서 첫 작품을 추가해 주세요.' })
      ]));
      return;
    }

    var cur = current();
    var work = cur.work, ep = cur.ep;

    var workPicker = el('select.field.work-list-select', {
      'aria-label': '작품 리스트',
      onchange: function () {
        if (this.value) select(this.value, '');
      }
    }, [
      el('option', { value: '', text: '작품 리스트', disabled: true, selected: !work })
    ].concat(list.map(function (w) {
      return el('option', { value: w.id, text: w.name, selected: w.id === work.id });
    })));
    root.appendChild(el('div.work-toolbar', {}, [
      workPicker,
      el('button.btn.btn-sm', {
        type: 'button', text: '작품 관리', onclick: function () { workTemplateDialog(work); }
      })
    ]));

    // 회차 칩
    var sortedEpisodes = work.episodes.slice().sort(function (a, b) { return (+a.number || 0) - (+b.number || 0); });
    function episodeGroup(number, groupSize) {
      return Math.floor((Math.max(1, Math.floor(+number || 1)) - 1) / groupSize);
    }
    var previousDesktopGroup = null;
    var previousMobileGroup = null;
    var chips = sortedEpisodes
      .map(function (e, index) {
        var desktopGroup = episodeGroup(e.number, 15);
        var mobileGroup = episodeGroup(e.number, 10);
        var rowBreaks = {
          pcRowStart: index > 0 && desktopGroup !== previousDesktopGroup ? 'true' : 'false',
          mobileRowStart: index > 0 && mobileGroup !== previousMobileGroup ? 'true' : 'false'
        };
        previousDesktopGroup = desktopGroup;
        previousMobileGroup = mobileGroup;
        return el('button.ep-chip' + (ep && e.id === ep.id ? '.active' : ''), {
          dataset: rowBreaks,
          onclick: function () { select(work.id, e.id); }
        }, [
          el('b', { text: e.number + '화' })
        ]);
      });
    var lastEpisode = sortedEpisodes[sortedEpisodes.length - 1];
    var lastDesktopCount = lastEpisode ? sortedEpisodes.filter(function (item) {
      return episodeGroup(item.number, 15) === episodeGroup(lastEpisode.number, 15);
    }).length : 0;
    var lastMobileCount = lastEpisode ? sortedEpisodes.filter(function (item) {
      return episodeGroup(item.number, 10) === episodeGroup(lastEpisode.number, 10);
    }).length : 0;
    chips.push(el('button.ep-chip.add', {
      text: '＋ 회차',
      dataset: {
        pcRowStart: lastDesktopCount >= 15 ? 'true' : 'false',
        mobileRowStart: lastMobileCount >= 10 ? 'true' : 'false'
      },
      onclick: function () { episodeDialog(work); }
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
