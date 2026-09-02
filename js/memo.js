/* ==========================================================================
   MW.memo — 메모 (오른쪽 도킹 패널 / 모바일 하단 시트) · 트위터식
   · 제목 없음. 상단 작성 박스 → 타임라인. 헤더에 검색·해시태그 필터.
   · 서식은 마크다운이 아니라 실제 서식: contentEditable + Ctrl/⌘+B·I·U 단축키
     + 작은 서식 바(굵게·기울임·취소선·밑줄·형광펜·체크박스). 저장은 정제된 HTML.
   · 분류 = 본문의 #해시태그 (칩·형광펜은 테마 포인트 컬러). 잠금·북마크.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var float = null, headHost = null, composeHost = null, tagBarHost = null;
  var filterTag = '';          // '' 전체 · '#태그' · '__none__' 미분류
  var search = '';
  var bookmarkOnly = false;
  var editingId = null;        // 인라인 편집 중인 메모 id (한 번에 하나)

  /* ------------------------------------------------------------ HTML 정제 */

  // 저장·표시에 허용하는 인라인 태그만 남기고 나머지는 글자만 살립니다.
  var KEEP = { B: 'b', I: 'i', U: 'u', S: 's', MARK: 'mark', STRONG: 'b', EM: 'i', DEL: 's', STRIKE: 's' };
  var BLOCK = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|TR)$/;

  function sanitize(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html == null ? '' : html);
    var out = [];
    (function walk(node) {
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType === 3) { out.push(U.escapeHtml(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.nodeName;
        if (tag === 'BR') { out.push('<br>'); continue; }
        var keep = KEEP[tag];
        if (keep) { out.push('<' + keep + '>'); walk(n); out.push('</' + keep + '>'); continue; }
        var block = BLOCK.test(tag);
        if (block && out.length && !/(<br>)$/.test(out[out.length - 1])) out.push('<br>');
        walk(n);
        if (block) out.push('<br>');
      }
    })(tmp);
    return out.join('')
      .replace(/^(?:<br>)+/, '')
      .replace(/(?:<br>)+$/, '')
      .replace(/(<br>){3,}/g, '<br><br>');
  }

  /** 검색·태그 추출용 — 태그 벗긴 순수 텍스트 */
  function plain(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html || '');
    return d.textContent || '';
  }

  var TAG_RE = /#[^\s#<>]+/g;
  function tagsOf(body) { return plain(body).match(TAG_RE) || []; }

  /** 표시용 — 텍스트 노드의 #해시태그와 ☐/☑ 를 클릭 가능한 조각으로 바꿉니다 */
  function decorate(body) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(body || '');
    var walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null);
    var texts = [], t;
    while ((t = walker.nextNode())) texts.push(t);
    texts.forEach(function (tn) {
      if (!/[#☐☑]/.test(tn.nodeValue)) return;
      var s = tn.nodeValue, frag = document.createDocumentFragment();
      var re = /#[^\s#<>]+|[☐☑]/g, last = 0, m;
      while ((m = re.exec(s))) {
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var span = document.createElement('span');
        if (m[0].charAt(0) === '#') { span.className = 'mtag'; span.textContent = m[0]; }
        else { span.className = 'mck'; span.setAttribute('role', 'button'); span.textContent = m[0]; }
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      tn.parentNode.replaceChild(frag, tn);
    });
    return tmp.innerHTML;
  }

  /* ------------------------------------------------------------ 스토어 도우미 */

  function memos() { return MW.store.state.memos; }

  function patchMemo(id, fn) {
    MW.store.update(function (s) {
      var m = s.memos.find(function (x) { return x.id === id; });
      if (m) { fn(m); m.updatedAt = Date.now(); }
    });
  }

  /** 저장만 하고 리렌더는 안 함 — 편집 중 매 입력마다 카드가 새로 그려지지 않도록 */
  function touchMemo(id, fn) {
    MW.store.touch(function (s) {
      var m = s.memos.find(function (x) { return x.id === id; });
      if (m) { fn(m); m.updatedAt = Date.now(); }
    });
  }

  function addMemo(body) {
    var now = Date.now();
    MW.store.update(function (s) {
      s.memos.unshift({ id: U.uid('memo'), body: body, createdAt: now, updatedAt: now, locked: false, bookmarked: false });
    });
  }

  function relDate(ts) {
    if (!ts) return '';
    var d = Date.now() - ts, MIN = 60000, H = 3600000, DAY = 86400000;
    if (d < MIN) return '방금';
    if (d < H) return Math.floor(d / MIN) + '분 전';
    if (d < DAY) return Math.floor(d / H) + '시간 전';
    if (d < DAY * 7) return Math.floor(d / DAY) + '일 전';
    var x = new Date(ts);
    return (x.getMonth() + 1) + '월 ' + x.getDate() + '일';
  }

  /* ------------------------------------------------------------ 에디터 (공용) */

  function markAncestor(node) {
    while (node) {
      if (node.nodeType === 1) {
        if (node.nodeName === 'MARK') return node;
        if (node.classList && node.classList.contains('memo-editor')) return null;
      }
      node = node.parentNode;
    }
    return null;
  }

  function wrapSelectionMark() {
    var sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    var existing = markAncestor(sel.anchorNode);
    if (existing) {   // 이미 형광펜 안이면 해제
      var parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
      return;
    }
    var range = sel.getRangeAt(0), mk = document.createElement('mark');
    try { range.surroundContents(mk); }
    catch (e) { mk.appendChild(range.extractContents()); range.insertNode(mk); }
    sel.removeAllRanges();
  }

  function insertCheckbox(ed) {
    ed.focus();
    document.execCommand('insertText', false, '☐ ');
  }

  /**
   * makeEditor(html, { onChange(html), onCommit(), onCancel(), placeholder })
   * 상단 작성 박스와 카드 인라인 편집이 같은 컴포넌트를 씁니다.
   */
  function makeEditor(html, o) {
    var ed = el('div.memo-editor', {
      contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'data-ph': o.placeholder || ''
    });
    ed.innerHTML = html || '';

    function flush() {
      if (ed.innerHTML === '<br>') ed.innerHTML = '';
      o.onChange(sanitize(ed.innerHTML));
    }
    ed.addEventListener('input', flush);
    ed.addEventListener('blur', function () {
      flush();
      if (o.onBlur) setTimeout(o.onBlur, 0);
    });
    ed.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); if (o.onCancel) o.onCancel(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (o.onCommit) o.onCommit(); }
    });

    function cmdBtn(label, run, title, cls) {
      return el('button.memo-fmt-btn' + (cls || ''), {
        type: 'button', title: title, text: label,
        onmousedown: function (e) { e.preventDefault(); ed.focus(); run(); flush(); }
      });
    }
    var bar = el('div.memo-fmt', {}, [
      cmdBtn('B', function () { document.execCommand('bold'); }, '굵게 (Ctrl+B)', '.b'),
      cmdBtn('I', function () { document.execCommand('italic'); }, '기울임 (Ctrl+I)', '.i'),
      cmdBtn('S', function () { document.execCommand('strikeThrough'); }, '취소선', '.s'),
      cmdBtn('U', function () { document.execCommand('underline'); }, '밑줄 (Ctrl+U)', '.u'),
      cmdBtn('🖊', wrapSelectionMark, '형광펜'),
      cmdBtn('☐', function () { insertCheckbox(ed); }, '체크박스')
    ]);

    return {
      wrap: el('div.memo-ed-wrap', {}, [ed, bar]),
      ed: ed,
      bar: bar,
      focusEnd: function () {
        ed.focus();
        try {
          var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        } catch (e) { /* 무시 */ }
      }
    };
  }

  /* ------------------------------------------------------------ 카드 */

  function card(m) {
    var node = el('div.memo-card', { dataset: { memo: m.id } });
    function openEdit() { if (editingId !== m.id) { editingId = m.id; render(); } }
    function closeEdit() { if (editingId === m.id) { editingId = null; render(); } }

    var fav = el('button.memo-fav' + (m.bookmarked ? '.on' : ''), {
      type: 'button', title: m.bookmarked ? '북마크 해제' : '북마크', 'aria-label': '북마크',
      text: m.bookmarked ? '♥' : '♡',
      onclick: function () { patchMemo(m.id, function (x) { x.bookmarked = !x.bookmarked; }); }
    });
    var lock = el('button.memo-lock' + (m.locked ? '.on' : ''), {
      type: 'button', title: m.locked ? '잠금 해제' : '삭제 잠금', 'aria-label': '잠금',
      text: m.locked ? '🔒' : '🔓',
      onclick: function () { patchMemo(m.id, function (x) { x.locked = !x.locked; }); }
    });
    var edit = el('button.memo-edit', {
      type: 'button', title: '편집', 'aria-label': '편집', text: '✎',
      onclick: function () { openEdit(); }
    });
    var del = el('button.memo-del', {
      type: 'button', title: m.locked ? '잠금을 해제해야 삭제할 수 있습니다' : '삭제',
      'aria-label': '삭제', text: '🗑', disabled: m.locked,
      onclick: function () {
        if (m.locked) return;
        MW.shell.confirm('이 메모를 삭제할까요?\n' + plain(m.body).slice(0, 40), function () {
          MW.store.update(function (s) { s.memos = s.memos.filter(function (y) { return y.id !== m.id; }); });
        });
      }
    });

    node.appendChild(el('div.memo-card-top', {}, [
      fav, el('span.memo-date', { text: relDate(m.createdAt) }),
      el('span.spacer'), lock, edit, del
    ]));

    var bodyWrap = el('div.memo-card-body');
    node.appendChild(bodyWrap);

    if (editingId === m.id) {
      var e = makeEditor(m.body, {
        placeholder: '메모…',
        onChange: function (h) { touchMemo(m.id, function (x) { x.body = h; }); },
        onCommit: closeEdit,
        onCancel: closeEdit,
        onBlur: closeEdit
      });
      bodyWrap.appendChild(e.wrap);
      setTimeout(e.focusEnd, 0);
    } else {
      var view = el('div.memo-view', {
        onclick: function (ev) {
          var ck = ev.target.closest('.mck');
          if (ck) {
            ev.stopPropagation();
            var cks = Array.prototype.slice.call(view.querySelectorAll('.mck'));
            toggleCheck(m, cks.indexOf(ck));
            return;
          }
          var tg = ev.target.closest('.mtag');
          if (tg) { ev.stopPropagation(); setFilterTag(tg.textContent); return; }
          if (ev.target.closest('a')) return;
          openEdit();
        }
      });
      view.innerHTML = plain(m.body).trim() ? decorate(m.body) : '<span class="memo-empty">빈 메모 — 눌러서 입력</span>';
      bodyWrap.appendChild(view);

      // 길면 접기
      requestAnimationFrame(function () {
        if (view.scrollHeight > view.clientHeight + 4) {
          var more = el('button.memo-more', {
            type: 'button', text: '더보기',
            onclick: function () {
              var open = node.classList.toggle('expanded');
              more.textContent = open ? '접기' : '더보기';
            }
          });
          bodyWrap.appendChild(more);
        }
      });
    }
    return node;
  }

  function toggleCheck(m, idx) {
    if (idx < 0) return;
    var n = -1;
    var next = String(m.body || '').replace(/[☐☑]/g, function (ch) {
      n++;
      if (n !== idx) return ch;
      return ch === '☑' ? '☐' : '☑';
    });
    patchMemo(m.id, function (x) { x.body = next; });
  }

  /* ------------------------------------------------------------ 헤더 · 작성 · 필터 */

  function setFilterTag(tag) {
    filterTag = (filterTag === tag) ? '' : tag;
    render();
  }

  function renderHeader() {
    if (!headHost) return;
    U.clear(headHost);
    var searchInput = el('input.memo-search', {
      type: 'search', placeholder: '검색 — 내용·#태그', value: search,
      oninput: function () { search = this.value; renderList(); }
    });
    var bm = el('button.memo-bm' + (bookmarkOnly ? '.on' : ''), {
      type: 'button', title: '북마크만 보기', 'aria-label': '북마크만',
      text: bookmarkOnly ? '♥' : '♡',
      onclick: function () { bookmarkOnly = !bookmarkOnly; render(); }
    });
    headHost.appendChild(searchInput);
    headHost.appendChild(bm);
  }

  function renderTagBar() {
    if (!tagBarHost) return;
    U.clear(tagBarHost);
    var count = {};
    memos().forEach(function (m) { tagsOf(m.body).forEach(function (tg) { count[tg] = (count[tg] || 0) + 1; }); });
    var tags = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b); });
    var hasUntagged = memos().some(function (m) { return !tagsOf(m.body).length; });

    function chip(val, label, on) {
      return el('button.memo-tagchip' + (on ? '.active' : ''), {
        type: 'button', text: label,
        onclick: function () { filterTag = (filterTag === val) ? '' : val; render(); }
      });
    }
    tagBarHost.appendChild(chip('', '전체', filterTag === ''));
    tags.forEach(function (tg) { tagBarHost.appendChild(chip(tg, tg, filterTag === tg)); });
    if (hasUntagged) tagBarHost.appendChild(chip('__none__', '미분류', filterTag === '__none__'));
  }

  function renderCompose() {
    if (!composeHost) return;
    var prevDraft = composeHost._draft || '';
    U.clear(composeHost);
    var draft = prevDraft;

    var e = makeEditor(prevDraft, {
      placeholder: '무엇을 메모할까요?  #태그 로 분류',
      onChange: function (h) { draft = h; composeHost._draft = h; },
      onCommit: submit
    });
    function submit() {
      if (!plain(draft).trim()) return;
      addMemo(draft);
      composeHost._draft = '';
      render();
    }
    var record = el('button.btn.btn-primary.btn-sm.memo-record', { type: 'button', text: '기록', onclick: submit });
    e.bar.appendChild(record);   // 서식 바 줄 오른쪽 끝에 [기록]
    composeHost.appendChild(e.wrap);
  }

  /* ------------------------------------------------------------ 리스트 · 렌더 */

  function filtered() {
    var q = search.trim().toLowerCase();
    return memos().filter(function (m) {
      if (bookmarkOnly && !m.bookmarked) return false;
      var tags = tagsOf(m.body);
      if (filterTag === '__none__' && tags.length) return false;
      if (filterTag && filterTag !== '__none__' && tags.indexOf(filterTag) < 0) return false;
      if (q && plain(m.body).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  function renderList() {
    if (!float) return;
    U.clear(float.body);
    var list = filtered();
    if (!list.length) {
      float.body.appendChild(el('div.empty', {
        text: memos().length ? '조건에 맞는 메모가 없습니다.' : '메모가 없습니다.\n위에 적어 첫 메모를 남겨보세요.'
      }));
      return;
    }
    list.forEach(function (m) { float.body.appendChild(card(m)); });
  }

  function render() {
    if (!float) return;
    renderHeader();
    renderTagBar();
    renderCompose();
    renderList();
  }

  MW.memo = {
    init: function () {
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* 태그 기반 서식 강제 */ }
      float = MW.shell.registerPanel('memo', { title: '', onOpen: render });

      var head = float.head || float.node.querySelector('.side-panel-head');
      var h3 = head && head.querySelector('h3');
      if (h3) h3.remove();
      headHost = el('div.memo-headbar');
      if (head) head.insertBefore(headHost, head.firstChild);

      // 작성 박스 + 태그 바 = 스크롤 영역 밖(헤더 아래) 고정
      composeHost = el('div.memo-compose');
      tagBarHost = el('div.memo-tagbar');
      float.node.insertBefore(composeHost, float.body);
      float.node.insertBefore(tagBarHost, float.body);

      render();
    },
    render: function () { if (float && float.isOpen()) render(); }
  };
})();
