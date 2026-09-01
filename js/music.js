/* ==========================================================================
   MW.music — 상단 고정바 음악 플레이어 (YouTube)
   · 화면 최상단에 항상 고정. 페이지를 옮겨도 재생이 끊기지 않습니다.
   · 재생목록 최대 5개 / 순차·셔플 / 곡 추가·삭제는 설정 페이지에서만.
   · 제목 조회는 3단 폴백: oEmbed → 재생 시 IFrame API의 영상 정보 → 수동 입력.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var MAX_PLAYLISTS = 5;
  var player = null;
  var apiReady = false;
  var apiFailed = false;
  var pending = null;          // API 준비 전에 누른 재생 요청
  var playing = false;
  var ui = {};
  var popover = null;

  /* ------------------------------------------------------------ 데이터 */

  function st() { return MW.store.state; }
  function playlists() { return st().playlists; }
  function currentPlaylist() {
    var p = st().player;
    return playlists().find(function (x) { return x.id === p.playlistId; }) || playlists()[0] || null;
  }
  function currentTrack() {
    var pl = currentPlaylist();
    if (!pl || !pl.tracks.length) return null;
    var i = U.clamp(st().player.index || 0, 0, pl.tracks.length - 1);
    return pl.tracks[i];
  }

  /** 유튜브 URL/ID 에서 영상 ID 추출 */
  function videoId(url) {
    var s = String(url || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    var m = s.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  /** oEmbed 로 제목 조회. CORS 로 막히면 null 을 돌려주고 재생 시 자동 보정합니다. */
  function fetchTitle(id) {
    var url = 'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id);
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.title ? j.title : null; })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------ YouTube IFrame API */

  function loadApi() {
    if (window.YT && window.YT.Player) { onApiReady(); return; }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') prev();
      onApiReady();
    };
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = function () {
      apiFailed = true;
      renderBar();
      U.toast('YouTube 스크립트를 불러오지 못했습니다. 네트워크가 차단된 환경일 수 있습니다.', 'warn');
    };
    document.head.appendChild(s);
    // 8초 안에 준비되지 않으면 차단된 것으로 간주하고 안내
    setTimeout(function () {
      if (!apiReady) { apiFailed = true; renderBar(); }
    }, 8000);
  }

  function onApiReady() {
    apiReady = true;
    apiFailed = false;
    player = new YT.Player('yt-host', {
      height: '1', width: '1',
      playerVars: { playsinline: 1 },
      events: {
        onReady: function () {
          if (pending) { var p = pending; pending = null; playTrack(p.index, p.autoplay); }
          renderBar();
        },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.ENDED) nextTrack(true);
          playing = (e.data === YT.PlayerState.PLAYING);
          if (playing) syncTitleFromPlayer();
          renderBar();
        },
        onError: function () {
          U.toast('이 영상은 재생할 수 없습니다 (비공개·삭제·임베드 차단).', 'warn');
          nextTrack(true);
        }
      }
    });
  }

  /** oEmbed 가 막혔을 때: 실제 재생 중인 영상 제목으로 목록을 자동 보정 */
  function syncTitleFromPlayer() {
    if (!player || !player.getVideoData) return;
    var data;
    try { data = player.getVideoData(); } catch (e) { return; }
    if (!data || !data.title) return;
    var t = currentTrack();
    if (!t || t.title === data.title) return;
    if (t.title && t.title !== t.videoId && !/^유튜브 영상/.test(t.title)) return;
    MW.store.update(function (s) {
      s.playlists.forEach(function (pl) {
        pl.tracks.forEach(function (tr) { if (tr.id === t.id) tr.title = data.title; });
      });
    });
  }

  /* ------------------------------------------------------------ 재생 제어 */

  function playTrack(index, autoplay) {
    var pl = currentPlaylist();
    if (!pl || !pl.tracks.length) { U.toast('재생할 곡이 없습니다. 설정에서 곡을 추가해 주세요.', 'warn'); return; }
    index = ((index % pl.tracks.length) + pl.tracks.length) % pl.tracks.length;

    MW.store.update(function (s) { s.player.playlistId = pl.id; s.player.index = index; });

    if (!apiReady || !player || !player.loadVideoById) {
      pending = { index: index, autoplay: autoplay !== false };
      if (apiFailed) U.toast('플레이어를 사용할 수 없습니다.', 'warn');
      return;
    }
    var track = pl.tracks[index];
    if (autoplay === false) player.cueVideoById(track.videoId);
    else player.loadVideoById(track.videoId);
  }

  function togglePlay() {
    if (!player || !player.getPlayerState) {
      playTrack(st().player.index || 0, true);
      return;
    }
    var s = player.getPlayerState();
    if (s === YT.PlayerState.PLAYING) player.pauseVideo();
    else if (s === YT.PlayerState.CUED || s === YT.PlayerState.UNSTARTED || s === -1) playTrack(st().player.index || 0, true);
    else player.playVideo();
  }

  function nextIndex(dir) {
    var pl = currentPlaylist();
    if (!pl || !pl.tracks.length) return 0;
    if (st().player.mode === 'shuffle' && pl.tracks.length > 1) {
      var i, cur = st().player.index || 0;
      do { i = Math.floor(Math.random() * pl.tracks.length); } while (i === cur);
      return i;
    }
    return (st().player.index || 0) + dir;
  }

  function nextTrack(auto) { playTrack(nextIndex(1), true); if (!auto) { /* 사용자 조작 */ } }
  function prevTrack() { playTrack(nextIndex(-1), true); }

  function setMode(mode) {
    MW.store.update(function (s) { s.player.mode = mode; });
    U.toast(mode === 'shuffle' ? '셔플 재생' : '순차 재생');
  }

  function selectPlaylist(id) {
    MW.store.update(function (s) { s.player.playlistId = id; s.player.index = 0; });
    playTrack(0, false);
    closePopover();
  }

  /* ------------------------------------------------------------ 팝오버 */

  function openPopover() {
    closePopover();
    var pl = currentPlaylist();
    popover = el('div.popover', {}, [
      el('h4', { text: '재생목록 (' + playlists().length + '/' + MAX_PLAYLISTS + ')' }),
      playlists().length
        ? el('div', {}, playlists().map(function (p) {
            return el('div.pl-item' + (pl && p.id === pl.id ? '.active' : ''), {
              onclick: function () { selectPlaylist(p.id); }
            }, [
              el('span', { text: p.name, style: { flex: '1' } }),
              el('span.small.dim', { text: p.tracks.length + '곡' })
            ]);
          }))
        : el('div.empty', { text: '재생목록이 없습니다.' }),
      el('h4', { text: pl ? '곡 목록 — ' + pl.name : '곡 목록' }),
      pl && pl.tracks.length
        ? el('div', {}, pl.tracks.map(function (t, i) {
            return el('div.track-item' + (i === st().player.index ? '.active' : ''), {
              onclick: function () { playTrack(i, true); closePopover(); }
            }, [
              el('span.t-idx', { text: String(i + 1) }),
              el('span.t-title', { text: t.title || t.videoId })
            ]);
          }))
        : el('div.empty', { text: '곡이 없습니다.' }),
      el('div', { style: { padding: '8px' } }, [
        el('button.btn.btn-sm', {
          text: '⚙ 설정에서 곡 관리', style: { width: '100%' },
          onclick: function () { closePopover(); MW.shell.go('settings'); MW.settings.openTab('music'); }
        })
      ])
    ]);
    document.getElementById('musicbar').appendChild(popover);
    setTimeout(function () { document.addEventListener('click', outside); }, 0);
  }

  function outside(e) {
    if (popover && !popover.contains(e.target) && !e.target.closest('[data-pop="music"]')) closePopover();
  }

  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
    document.removeEventListener('click', outside);
  }

  /* ------------------------------------------------------------ 상단바 */

  function renderBar() {
    if (!ui.title) return;
    var pl = currentPlaylist();
    var t = currentTrack();
    ui.title.textContent = t ? (t.title || t.videoId) : '재생할 곡이 없습니다';
    ui.sub.textContent = apiFailed
      ? 'YouTube 플레이어를 불러올 수 없는 환경입니다'
      : (pl ? pl.name + ' · ' + (pl.tracks.length ? (U.clamp(st().player.index || 0, 0, pl.tracks.length - 1) + 1) + '/' + pl.tracks.length : '0곡') : '설정에서 재생목록을 만들어 주세요');
    ui.play.textContent = playing ? '❚❚' : '▶';
    ui.mode.textContent = st().player.mode === 'shuffle' ? '🔀' : '🔁';
    ui.mode.title = st().player.mode === 'shuffle' ? '셔플 재생 (클릭 시 순차)' : '순차 재생 (클릭 시 셔플)';
    ui.mode.classList.toggle('on', st().player.mode === 'shuffle');
  }

  function mount(bar) {
    ui.title = el('div.mb-now-title');
    ui.sub = el('div.mb-now-sub');
    ui.play = el('button.btn.btn-icon.mb-play', { title: '재생/일시정지', onclick: togglePlay });
    ui.mode = el('button.btn.btn-icon.mb-mode', {
      onclick: function () { setMode(st().player.mode === 'shuffle' ? 'seq' : 'shuffle'); }
    });

    bar.appendChild(el('button.btn.btn-ghost.btn-icon.mb-burger', {
      text: '☰', title: '사이드바 접기', 'aria-label': '사이드바 접기',
      dataset: { sidebarToggle: '1' }
    }));
    bar.appendChild(el('div.mb-brand', {}, [ 'Mini ', el('span', { text: 'Workspace' }) ]));
    bar.appendChild(el('div.mb-controls', {}, [
      el('button.btn.btn-icon', { text: '◀', title: '이전 곡', onclick: prevTrack }),
      ui.play,
      el('button.btn.btn-icon', { text: '▶', title: '다음 곡', onclick: function () { nextTrack(false); } })
    ]));
    bar.appendChild(el('div.mb-now', {}, [ui.title, ui.sub]));
    bar.appendChild(ui.mode);
    bar.appendChild(el('button.btn.btn-icon', {
      text: '☰', title: '재생목록', dataset: { pop: 'music' },
      onclick: function () { popover ? closePopover() : openPopover(); }
    }));

    // 어느 페이지에 있든 바로 띄울 수 있도록 플로팅 위젯 버튼을 상단바에 둡니다
    bar.appendChild(el('div.mb-sep'));
    bar.appendChild(el('button.btn.btn-icon.mb-widget', {
      text: '📝', title: '메모장', 'aria-label': '메모장', dataset: { float: 'memo' }
    }));
    bar.appendChild(el('button.btn.btn-icon.mb-widget', {
      text: '✅', title: '투두리스트', 'aria-label': '투두리스트', dataset: { float: 'todo' }
    }));

    bar.appendChild(el('div', { id: 'yt-host' }));

    renderBar();
    loadApi();
    // 새로고침 후에도 마지막 곡을 물려받되 자동 재생은 하지 않음
    if (currentTrack()) setTimeout(function () { playTrack(st().player.index || 0, false); }, 1200);
  }

  /* --------------------------------------------- 설정 페이지에서 쓰는 API */

  function addPlaylist(name) {
    if (playlists().length >= MAX_PLAYLISTS) {
      U.toast('재생목록은 최대 ' + MAX_PLAYLISTS + '개까지입니다.', 'warn');
      return null;
    }
    var id = U.uid('pl');
    MW.store.update(function (s) {
      s.playlists.push({ id: id, name: name || ('재생목록 ' + (s.playlists.length + 1)), tracks: [] });
      if (!s.player.playlistId) s.player.playlistId = id;
    });
    return id;
  }

  /** URL 붙여넣기 → 영상 ID 추출 → 제목 자동 조회(실패 시 임시 제목) */
  function addTrack(playlistId, url) {
    var id = videoId(url);
    if (!id) { U.toast('유튜브 주소에서 영상 ID를 찾지 못했습니다.', 'err'); return false; }
    var trackId = U.uid('tr');
    MW.store.update(function (s) {
      var pl = s.playlists.find(function (p) { return p.id === playlistId; });
      if (pl) pl.tracks.push({ id: trackId, videoId: id, title: '유튜브 영상 ' + id, url: String(url).trim() });
    });
    fetchTitle(id).then(function (title) {
      if (!title) {
        U.toast('제목 자동 조회에 실패했습니다. 재생하면 자동으로 채워지며, 직접 수정할 수도 있습니다.', 'warn');
        return;
      }
      MW.store.update(function (s) {
        s.playlists.forEach(function (pl) {
          pl.tracks.forEach(function (tr) { if (tr.id === trackId) tr.title = title; });
        });
      });
    });
    return true;
  }

  MW.music = {
    mount: mount,
    render: renderBar,
    addPlaylist: addPlaylist,
    addTrack: addTrack,
    videoId: videoId,
    playTrack: playTrack,
    selectPlaylist: selectPlaylist,
    MAX_PLAYLISTS: MAX_PLAYLISTS,
    isBlocked: function () { return apiFailed; }
  };
})();
