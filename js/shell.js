/* ==========================================================================
   MW.shell — 라우팅 / 사이드바·하단탭 / 플로팅 창 매니저 / 모달 / 알림
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el, $ = U.$, $$ = U.$$;

  var ROUTES = ['home', 'work', 'calendar', 'ledger', 'settings'];
  var routeHandlers = {};
  var current = null;

  /* --------------------------------------------------------------- 라우팅 */

  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
    return ROUTES.indexOf(h) >= 0 ? h : 'home';
  }

  function go(route) {
    if (ROUTES.indexOf(route) < 0) route = 'home';
    if (location.hash !== '#/' + route) { location.hash = '#/' + route; return; }
    apply(route);
  }

  function apply(route) {
    current = route;
    document.body.dataset.route = route;
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.dataset.page === route); });
    $$('[data-nav]').forEach(function (b) { b.classList.toggle('active', b.dataset.nav === route); });
    var main = $('#main');
    if (main) main.scrollTop = 0;
    var body = $('#body');
    if (body) body.scrollTop = 0;
    if (routeHandlers[route]) routeHandlers[route](route);
  }

  function onRoute(route, fn) { routeHandlers[route] = fn; }

  /* ---------------------------------------------------------- 플로팅 창 */

  var floats = {};
  var zTop = 100;

  function registerFloat(id, opts) {
    opts = opts || {};
    var node = el('div.float', { id: 'float-' + id });
    var titleEl = el('h3', { text: opts.title || '' });
    var head = el('div.float-head', {}, [
      titleEl,
      opts.headExtra || null,
      el('button.btn.btn-ghost.btn-icon', {
        title: '닫기', 'aria-label': '닫기', text: '✕',
        onclick: function () { api.close(); }
      })
    ]);
    var body = el('div.float-body');
    var grip = el('div.float-resize', { title: '크기 조절' });
    node.appendChild(head);
    node.appendChild(body);
    node.appendChild(grip);
    document.body.appendChild(node);

    // 위치·크기는 사용자가 옮긴 그대로 저장했다가 다음에 열 때 복원합니다
    var saved = (MW.store.state.settings.floats || {})[id];
    var rect = saved || opts.rect || { x: 120, y: 100, w: 340, h: 420 };
    rect = {
      x: U.clamp(rect.x, 0, Math.max(0, window.innerWidth - 120)),
      y: U.clamp(rect.y, 0, Math.max(0, window.innerHeight - 80)),
      w: Math.max(260, rect.w), h: Math.max(200, rect.h)
    };
    node.style.left = rect.x + 'px';
    node.style.top = rect.y + 'px';
    node.style.width = rect.w + 'px';
    node.style.height = rect.h + 'px';

    function remember() {
      MW.store.touch(function (st) {
        if (!st.settings.floats) st.settings.floats = {};
        st.settings.floats[id] = {
          x: node.offsetLeft, y: node.offsetTop,
          w: node.offsetWidth, h: node.offsetHeight
        };
      });
    }

    dragMove(head, node, remember);
    dragResize(grip, node, remember);
    node.addEventListener('mousedown', raise);
    node.addEventListener('touchstart', raise, { passive: true });
    function raise() { zTop += 1; node.style.zIndex = zTop; }

    var api = {
      id: id, node: node, body: body,
      setTitle: function (t) { titleEl.textContent = t; },
      isOpen: function () { return node.classList.contains('open'); },
      open: function () {
        node.classList.add('open');
        raise();
        syncButtons();
        if (opts.onOpen) opts.onOpen(api);
      },
      close: function () { node.classList.remove('open'); syncButtons(); },
      toggle: function () { api.isOpen() ? api.close() : api.open(); }
    };
    floats[id] = api;
    return api;
  }

  /* ---------------------------------------------------------- 사이드 도킹 패널
     데스크톱에서는 오른쪽에 붙는 패널, 모바일에서는 아래에서 올라오는 시트.
     플로팅 창과 달리 위치를 옮기지 않고, 가장자리 가운데의 손잡이 버튼으로 여닫습니다.
     하단 탭바의 [data-float] 버튼과 syncButtons 가 그대로 동작하도록 floats 맵에 등록합니다. */
  function registerPanel(id, opts) {
    opts = opts || {};
    var node = el('aside.side-panel', { id: 'panel-' + id });
    var body = el('div.side-panel-body');
    // 손잡이는 패널 밖(body 직속)에 둡니다. 패널이 transform 으로 숨겨질 때
    // 자식이면 함께 사라져 열 수단이 없어지기 때문입니다. 데스크톱·모바일 동일한 가장자리 탭.
    var handle = el('button.side-panel-handle', {
      id: 'panel-' + id + '-handle', type: 'button',
      'aria-label': (opts.title || '') + ' 열고 닫기',
      onclick: function () { api.toggle(); }
    }, [el('span.side-panel-handle-icon', { text: '‹' })]);
    var head = el('div.side-panel-head', {}, [
      el('h3', { text: opts.title || '' }),
      el('button.btn.btn-ghost.btn-icon', {
        title: '닫기', 'aria-label': '닫기', text: '✕',
        onclick: function () { api.close(); }
      })
    ]);
    node.appendChild(head);
    node.appendChild(body);
    document.body.appendChild(node);
    document.body.appendChild(handle);

    var api = {
      id: id, node: node, body: body,
      isOpen: function () { return node.classList.contains('open'); },
      open: function () {
        node.classList.add('open');
        handle.classList.add('open');
        document.body.classList.add('panel-' + id + '-open');
        syncButtons();
        if (opts.onOpen) opts.onOpen(api);
      },
      close: function () {
        node.classList.remove('open');
        handle.classList.remove('open');
        document.body.classList.remove('panel-' + id + '-open');
        syncButtons();
      },
      toggle: function () { api.isOpen() ? api.close() : api.open(); }
    };
    floats[id] = api;
    return api;
  }

  function syncButtons() {
    $$('[data-float]').forEach(function (b) {
      var f = floats[b.dataset.float];
      b.classList.toggle('active', !!(f && f.isOpen()));
    });
  }

  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }

  function dragMove(handle, node, onEnd) {
    var sx = 0, sy = 0, ox = 0, oy = 0, active = false;
    function down(e) {
      if (isMobile()) return;                       // 모바일은 전체화면 시트
      if (e.target.closest('button')) return;
      var p = point(e);
      active = true; sx = p.x; sy = p.y;
      ox = node.offsetLeft; oy = node.offsetTop;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
      e.preventDefault();
    }
    function move(e) {
      if (!active) return;
      var p = point(e);
      node.style.left = U.clamp(ox + p.x - sx, -node.offsetWidth + 80, window.innerWidth - 80) + 'px';
      node.style.top = U.clamp(oy + p.y - sy, 0, window.innerHeight - 44) + 'px';
      if (e.cancelable) e.preventDefault();
    }
    function up() {
      if (active && onEnd) onEnd();
      active = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
  }

  function dragResize(grip, node, onEnd) {
    var sx = 0, sy = 0, ow = 0, oh = 0, active = false;
    function down(e) {
      if (isMobile()) return;
      var p = point(e);
      active = true; sx = p.x; sy = p.y; ow = node.offsetWidth; oh = node.offsetHeight;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault(); e.stopPropagation();
    }
    function move(e) {
      if (!active) return;
      var p = point(e);
      node.style.width = Math.max(260, ow + p.x - sx) + 'px';
      node.style.height = Math.max(200, oh + p.y - sy) + 'px';
    }
    function up() {
      if (active && onEnd) onEnd();
      active = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    grip.addEventListener('mousedown', down);
  }

  function point(e) {
    var t = e.touches && e.touches[0];
    return { x: t ? t.clientX : e.clientX, y: t ? t.clientY : e.clientY };
  }

  /* --------------------------------------------------------------- 모달 */

  var backdrop = null;

  /**
   * modal({ title, body: [노드들], okText, onOk: fn -> false 면 닫지 않음, extra: 노드 })
   */
  function modal(opts) {
    if (!backdrop) {
      backdrop = el('div.modal-backdrop', {
        onclick: function (e) { if (e.target === backdrop) closeModal(); }
      });
      document.body.appendChild(backdrop);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
      });
    }
    U.clear(backdrop);

    var box = el('div.modal', {}, [
      el('div.modal-head', {}, [
        el('h3', { text: opts.title || '' }),
        el('button.btn.btn-ghost.btn-icon', { text: '✕', 'aria-label': '닫기', onclick: closeModal })
      ]),
      el('div.modal-body', {}, opts.body || []),
      el('div.modal-foot', {}, [
        opts.extra || null,
        el('span.spacer'),
        el('button.btn', { text: opts.cancelText || '취소', onclick: closeModal }),
        opts.onOk === null ? null : el('button.btn.btn-primary', {
          text: opts.okText || '저장',
          onclick: function () { if (!opts.onOk || opts.onOk() !== false) closeModal(); }
        })
      ])
    ]);
    backdrop.appendChild(box);
    backdrop.classList.add('open');
    var first = box.querySelector('input, textarea, select');
    if (first) setTimeout(function () { first.focus(); }, 30);
    return { close: closeModal, box: box };
  }

  function closeModal() { if (backdrop) backdrop.classList.remove('open'); }

  function confirmDialog(message, onYes, okText) {
    modal({
      title: '확인',
      body: [el('p', { text: message, style: { color: 'var(--text-muted)', lineHeight: '1.7', whiteSpace: 'pre-line' } })],
      okText: okText || '삭제',
      onOk: onYes
    });
  }

  /* --------------------------------------------------------------- 알림 */

  function requestNotify() {
    if (!('Notification' in window)) {
      U.toast('이 브라우저는 데스크톱 알림을 지원하지 않습니다.', 'warn');
      return Promise.resolve('unsupported');
    }
    return Notification.requestPermission().then(function (p) {
      U.toast(p === 'granted' ? '알림이 허용되었습니다.' : '알림이 허용되지 않았습니다.', p === 'granted' ? null : 'warn');
      return p;
    });
  }

  function notify(title, body) {
    if (!MW.store.state.settings.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body: body, silent: true }); } catch (e) { /* 무시 */ }
  }

  var sounds = {};
  function playSound(name) {
    if (!MW.store.state.settings.sound) return;
    try {
      // 단일 파일 빌드에서는 MW.assets 에 data URI 가 들어옵니다 (scripts/build-single.py)
      if (!sounds[name]) {
        var src = (MW.assets && MW.assets[name]) || ('./assets/sounds/' + name + '.mp3');
        sounds[name] = new Audio(src);
      }
      sounds[name].currentTime = 0;
      var p = sounds[name].play();
      if (p && p.catch) p.catch(function () { /* 사용자 상호작용 전에는 브라우저가 막음 */ });
    } catch (e) { /* 무시 */ }
  }

  /* ----------------------------------------------------------------- 테마 */

  /**
   * 설정 → 테마의 mode(dark/light)·accent 색을 실제 화면에 적용합니다.
   * --accent 계열 변수만 갈아끼우므로 다른 색(성공·경고 등)은 그대로 유지됩니다.
   */
  function applyTheme() {
    var t = (MW.store.state.settings && MW.store.state.settings.theme) || {};
    var mode = t.mode === 'light' ? 'light' : 'dark';
    var accent = /^#[0-9a-fA-F]{6}$/.test(t.accent || '') ? t.accent : '#6b8afd';
    var root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-dim', U.rgbaOf(accent, 0.12));
    root.style.setProperty('--accent-hover', U.lighten(accent, 0.18));
  }

  /* ---------------------------------------------------------- 사이드바 토글 */

  var sidebarCollapsed = false;

  function toggleSidebar() {
    var sidebar = $('#sidebar');
    if (!sidebar) return;
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle('collapsed');
    try { localStorage.setItem('mw.sidebar.collapsed', sidebarCollapsed ? '1' : '0'); } catch (e) {}
  }

  function setNavDrawer(open) {
    var sidebar = $('#sidebar');
    var overlay = $('.sidebar-overlay');
    var trigger = $('#nav-menu-trigger');
    if (sidebar) sidebar.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('open', open);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeSidebarOnMobile() {
    if (window.innerWidth <= 900) setNavDrawer(false);
  }

  /* --------------------------------------------------- 음악 팝업 (하단) */

  var musicPopupOpen = false;

  function toggleMusicPopup() {
    var popup = $('#music-popup');
    if (!popup) return;
    musicPopupOpen = !musicPopupOpen;
    popup.classList.toggle('open');
  }

  function closeMusicPopup() {
    var popup = $('#music-popup');
    if (popup) {
      popup.classList.remove('open');
      musicPopupOpen = false;
    }
  }

  /* --------------------------------------------------------------- 초기화 */

  function init() {
    window.addEventListener('hashchange', function () { apply(parseHash()); });

    /* 라우팅 */
    U.on(document.body, 'click', '[data-nav]', function (e, t) {
      go(t.dataset.nav);
      closeSidebarOnMobile();
    });

    /* 플로팅·도킹 위젯 (메모 버튼 등에서 작동) */
    U.on(document.body, 'click', '[data-float]', function (e, t) {
      var f = floats[t.dataset.float];
      if (f) f.toggle();
    });

    /* 모바일 내비게이션 메뉴 (상단바 오른쪽 ☰) — 사이드바 드로어를 여닫습니다 */
    var navMenuTrigger = $('#nav-menu-trigger');
    if (navMenuTrigger) {
      navMenuTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var sidebar = $('#sidebar');
        setNavDrawer(!(sidebar && sidebar.classList.contains('open')));
      });
    }
    var sidebarOverlay = $('.sidebar-overlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', function () { setNavDrawer(false); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setNavDrawer(false);
    });

    /* 사이드바 토글 */
    var sidebarToggleBtn = $('#sidebar-toggle-btn');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }

    /* 음악 팝업 닫기 (팝업은 music.js 의 재생목록 팝오버에서 여닫습니다) */
    var musicPopupClose = $('#music-popup-close');
    if (musicPopupClose) {
      musicPopupClose.addEventListener('click', closeMusicPopup);
    }

    /* 음악 팝업 배경 클릭으로 닫기 */
    var musicPopup = $('#music-popup');
    if (musicPopup) {
      musicPopup.addEventListener('click', function (e) {
        if (e.target === musicPopup) {
          closeMusicPopup();
        }
      });
    }

    /* 사이드바 저장된 상태 복원 */
    try {
      var collapsed = localStorage.getItem('mw.sidebar.collapsed') === '1';
      if (collapsed) toggleSidebar();
    } catch (e) {}

    /* 빠른 입력 초기화 */
    if (MW.quickAdd) MW.quickAdd.init();

    apply(parseHash());
  }

  MW.shell = {
    init: init, go: go, onRoute: onRoute, route: function () { return current; },
    registerFloat: registerFloat, registerPanel: registerPanel, floats: floats,
    syncFloatButtons: syncButtons, isMobile: isMobile,
    modal: modal, closeModal: closeModal, confirm: confirmDialog,
    requestNotify: requestNotify, notify: notify, playSound: playSound,
    applyTheme: applyTheme
  };
})();
