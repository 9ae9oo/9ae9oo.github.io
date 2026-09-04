/* ==========================================================================
   MW.music — BGM 플레이어 (YouTube) · 우측 레일의 BGM 패널
   · 패널을 닫아도 숨김 iframe 은 DOM 에 남아 재생이 끊기지 않습니다.
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
  var errorStreak = 0;         // 연속 재생 실패 수 — 무한 스킵 방지
  var ui = {};
  var panel = null;
  var miniHost = null;
  var seeking = false;         // 미니바 플레이헤드 드래그 중
  var seekPct = 0;
  var playlistImporting = false;

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

  /** 유튜브 재생목록 URL/ID 에서 목록 ID 추출 */
  function playlistId(url) {
    var s = String(url || '').trim();
    if (/^[\w-]{10,}$/.test(s)) return s;
    var m = s.match(/[?&]list=([^&#]+)/i);
    if (!m) return null;
    var id;
    try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; }
    return /^[\w-]{10,}$/.test(id) ? id : null;
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

  /** 여러 곡의 제목을 동시에 너무 많이 요청하지 않고, 모아서 한 번에 저장 */
  function fetchImportedTitles(tracks) {
    var cursor = 0;
    var titles = {};

    function worker() {
      var track = tracks[cursor++];
      if (!track) return Promise.resolve();
      return fetchTitle(track.videoId).then(function (title) {
        if (title) titles[track.id] = title;
        return worker();
      });
    }

    var workers = [];
    for (var i = 0; i < Math.min(4, tracks.length); i++) workers.push(worker());
    Promise.all(workers).then(function () {
      if (!Object.keys(titles).length) return;
      MW.store.update(function (s) {
        s.playlists.forEach(function (pl) {
          pl.tracks.forEach(function (tr) {
            if (titles[tr.id]) tr.title = titles[tr.id];
          });
        });
      });
    });
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
          if (playing) { errorStreak = 0; syncTitleFromPlayer(); }
          renderBar();
        },
        onError: function () {
          // 재생 불가 영상에서 다음 곡으로 자동 이동하되, 목록을 한 바퀴
          // 다 돌 때까지 성공이 없으면 멈춰서 토스트가 무한히 쌓이지 않게 합니다.
          var pl = currentPlaylist();
          var total = pl && pl.tracks.length ? pl.tracks.length : 1;
          errorStreak++;
          if (errorStreak >= total) {
            errorStreak = 0;
            playing = false;
            renderBar();
            U.toast('재생할 수 있는 영상이 없습니다. 설정에서 링크를 확인해 주세요.', 'warn');
            return;
          }
          nextTrack(true);
        }
      }
    });
  }

  function waitForApi() {
    return new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) { resolve(); return; }
      if (apiFailed) { reject(new Error('YouTube 연결이 막혀 있어 재생목록을 가져올 수 없습니다.')); return; }

      var started = Date.now();
      var timer = setInterval(function () {
        if (window.YT && window.YT.Player) {
          clearInterval(timer);
          resolve();
        } else if (apiFailed || Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error('YouTube 플레이어를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
        }
      }, 100);
    });
  }

  /** 재생 중인 플레이어와 분리된 임시 플레이어로 재생목록의 영상 ID를 읽습니다. */
  function readPlaylistVideoIds(id) {
    return waitForApi().then(function () {
      return new Promise(function (resolve, reject) {
        var wrap = document.createElement('div');
        var host = document.createElement('div');
        var hostId = U.uid('yt-import-host');
        var importer = null;
        var best = [];
        var settled = false;
        var poll = null;
        var timeout = null;

        host.id = hostId;
        wrap.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0;overflow:hidden';
        wrap.appendChild(host);
        document.body.appendChild(wrap);

        function cleanup() {
          clearInterval(poll);
          clearTimeout(timeout);
          if (importer && importer.destroy) {
            try { importer.destroy(); } catch (e) { /* 이미 정리됨 */ }
          }
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        }

        function finish(ids) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(ids);
        }

        function fail() {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('재생목록을 읽지 못했습니다. 공개된 YouTube 재생목록 주소인지 확인해 주세요.'));
        }

        function read() {
          if (!importer || !importer.getPlaylist) return [];
          var ids = [];
          try { ids = importer.getPlaylist() || []; } catch (e) { return []; }
          ids = ids.filter(function (video) { return /^[\w-]{11}$/.test(video); });
          if (ids.length > best.length) best = ids.slice();
          return ids;
        }

        try {
          importer = new YT.Player(hostId, {
            height: '1', width: '1',
            playerVars: { playsinline: 1 },
            events: {
              onReady: function () {
                try {
                  importer.cuePlaylist({ listType: 'playlist', list: id, index: 0, startSeconds: 0 });
                } catch (e) { fail(); }
              },
              onStateChange: function (e) {
                if (e.data === YT.PlayerState.CUED) {
                  var ids = read();
                  if (ids.length) finish(ids);
                }
              },
              onError: function () {
                setTimeout(function () {
                  if (!read().length) fail();
                  else finish(best);
                }, 500);
              }
            }
          });
        } catch (e) {
          fail();
          return;
        }

        poll = setInterval(read, 250);
        timeout = setTimeout(function () {
          read();
          if (best.length) finish(best);
          else fail();
        }, 15000);
      });
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
    errorStreak = 0;   // 사용자가 직접 재생을 누르면 실패 카운트 초기화
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
    errorStreak = 0;
    MW.store.update(function (s) { s.player.playlistId = id; s.player.index = 0; });
    playTrack(0, false);
  }

  /* ---------------------------------------------------- BGM 패널 표시 */

  function renderBar() {
    var pl = currentPlaylist();
    var t = currentTrack();
    var titleText = t ? (t.title || t.videoId) : '재생할 곡이 없습니다';

    if (ui.play) ui.play.textContent = playing ? '❚❚' : '▶';
    if (ui.mode) {
      ui.mode.textContent = st().player.mode === 'shuffle' ? '🔀' : '🔁';
      ui.mode.title = st().player.mode === 'shuffle' ? '셔플 재생 (클릭 시 순차)' : '순차 재생 (클릭 시 셔플)';
      ui.mode.classList.toggle('on', st().player.mode === 'shuffle');
    }
    if (ui.nowTitle) {
      ui.nowTitle.textContent = titleText;
      ui.nowTitle.title = apiFailed ? 'YouTube 플레이어를 불러올 수 없는 환경입니다' : titleText;
    }
    if (ui.nowSub) {
      ui.nowSub.textContent = pl
        ? pl.name + ' · ' + (pl.tracks.length ? (U.clamp(st().player.index || 0, 0, pl.tracks.length - 1) + 1) + '/' + pl.tracks.length : '0곡')
        : '설정에서 재생목록을 만들어 주세요';
    }

    // 미니바 — 재생할 곡이 없으면 통째로 숨김
    if (miniHost) miniHost.hidden = !t;
    if (ui.miniPlay) ui.miniPlay.textContent = playing ? '❚❚' : '▶';
    if (ui.miniTitle) ui.miniTitle.textContent = titleText;

    renderList();
  }

  /* --------------------------------------------------- 미니바 (컨텐츠 하단) */

  function duration() {
    if (!player || !player.getDuration) return 0;
    try { var d = player.getDuration(); return (typeof d === 'number' && isFinite(d) && d > 0) ? d : 0; }
    catch (e) { return 0; }
  }
  function currentTime() {
    if (!player || !player.getCurrentTime) return 0;
    try { var c = player.getCurrentTime(); return (typeof c === 'number' && isFinite(c)) ? c : 0; }
    catch (e) { return 0; }
  }

  function paintProgress(p) {
    if (!ui.miniFill) return;
    ui.miniFill.style.width = (p * 100) + '%';
    ui.miniHead.style.left = (p * 100) + '%';
  }

  function tickProgress() {
    if (!ui.miniTrack || seeking) return;
    var dur = duration(), cur = currentTime();
    paintProgress(dur > 0 ? U.clamp(cur / dur, 0, 1) : 0);
    if (ui.miniTime) ui.miniTime.textContent = U.fmtClock(cur) + ' / ' + U.fmtClock(dur);
  }

  /** ◎ 플레이헤드를 끌거나 바를 눌러 구간 이동 */
  function attachSeek(track) {
    function pctFrom(e) {
      var r = track.getBoundingClientRect();
      return r.width ? U.clamp((e.clientX - r.left) / r.width, 0, 1) : 0;
    }
    function move(e) { seekPct = pctFrom(e); paintProgress(seekPct); if (e.cancelable) e.preventDefault(); }
    function up() {
      if (!seeking) return;
      seeking = false;
      track.classList.remove('dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      var dur = duration();
      if (dur > 0 && player && player.seekTo) {
        try { player.seekTo(seekPct * dur, true); } catch (e) { /* 무시 */ }
      }
    }
    track.addEventListener('pointerdown', function (e) {
      if (duration() <= 0) return;
      seeking = true;
      track.classList.add('dragging');
      seekPct = pctFrom(e);
      paintProgress(seekPct);
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      e.preventDefault();
    });
  }

  function mountMini(host) {
    if (!host) return;
    miniHost = host;
    U.clear(host);

    ui.miniPlay = el('button.mm-btn.mm-play', { type: 'button', title: '재생/일시정지', onclick: togglePlay });
    ui.miniTitle = el('span.mm-title');
    ui.miniTime = el('span.mm-time', { text: '00:00 / 00:00' });
    ui.miniFill = el('div.mm-fill');
    ui.miniHead = el('div.mm-head');
    ui.miniTrack = el('div.mm-track', { title: '끌어서 구간 이동' }, [ui.miniFill, ui.miniHead]);

    host.appendChild(el('div.mm-ctrls', {}, [
      el('button.mm-btn', { type: 'button', text: '◀', title: '이전 곡', onclick: prevTrack }),
      ui.miniPlay,
      el('button.mm-btn', { type: 'button', text: '▶', title: '다음 곡', onclick: function () { nextTrack(false); } })
    ]));
    host.appendChild(el('div.mm-sep'));
    host.appendChild(el('div.mm-right', {}, [
      el('div.mm-titlerow', {}, [ui.miniTitle, ui.miniTime]),
      ui.miniTrack
    ]));

    attachSeek(ui.miniTrack);
    setInterval(tickProgress, 400);
  }

  function renderList() {
    if (!ui.list) return;
    U.clear(ui.list);
    var pl = currentPlaylist();

    ui.list.appendChild(el('h4', { text: '재생목록 (' + playlists().length + '/' + MAX_PLAYLISTS + ')' }));
    ui.list.appendChild(playlists().length
      ? el('div', {}, playlists().map(function (p) {
          return el('div.pl-item' + (pl && p.id === pl.id ? '.active' : ''), {
            onclick: function () { selectPlaylist(p.id); }
          }, [
            el('span', { text: p.name, style: { flex: '1' } }),
            el('span.small.dim', { text: p.tracks.length + '곡' })
          ]);
        }))
      : el('div.empty', { text: '재생목록이 없습니다.' }));

    ui.list.appendChild(el('h4', { text: pl ? '곡 목록 — ' + pl.name : '곡 목록' }));
    ui.list.appendChild(pl && pl.tracks.length
      ? el('div', {}, pl.tracks.map(function (t, i) {
          return el('div.track-item' + (i === st().player.index ? '.active' : ''), {
            onclick: function () { playTrack(i, true); }
          }, [
            el('span.t-idx', { text: String(i + 1) }),
            el('span.t-title', { text: t.title || t.videoId })
          ]);
        }))
      : el('div.empty', { text: '곡이 없습니다.' }));

    ui.list.appendChild(el('button.btn.btn-sm', {
      text: '⚙ 설정에서 곡 관리', style: { width: '100%', marginTop: '8px' },
      onclick: function () { MW.shell.go('settings'); MW.settings.openTab('music'); }
    }));
  }

  function mount(host) {
    // 숨김 YouTube iframe — 패널을 닫아도 DOM 에 남아 재생 유지
    host.appendChild(el('div', { id: 'yt-host' }));

    ui.play = el('button.mbar-btn.mbar-play', { title: '재생/일시정지', onclick: togglePlay });
    ui.mode = el('button.mbar-btn', {
      title: '재생 모드',
      onclick: function () { setMode(st().player.mode === 'shuffle' ? 'seq' : 'shuffle'); }
    });
    ui.nowTitle = el('div.mus-now-title');
    ui.nowSub = el('div.mus-now-sub.small.dim');
    ui.list = el('div.mus-list');

    host.appendChild(el('div.mus-now', {}, [ui.nowTitle, ui.nowSub]));
    host.appendChild(el('div.mbar', {}, [
      el('button.mbar-btn', { text: '◀', title: '이전 곡', onclick: prevTrack }),
      ui.play,
      el('button.mbar-btn', { text: '▶', title: '다음 곡', onclick: function () { nextTrack(false); } }),
      ui.mode
    ]));
    host.appendChild(ui.list);

    renderBar();
    loadApi();
    // 새로고침 후에도 마지막 곡을 물려받되 자동 재생은 하지 않음
    if (currentTrack()) setTimeout(function () { playTrack(st().player.index || 0, false); }, 1200);
  }

  function init() {
    panel = MW.shell.registerPanel('music', { title: '🎵 BGM', onOpen: renderBar });
    mount(panel.body);
    mountMini(document.getElementById('musicmini'));
    renderBar();
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

  /** 공개 YouTube 재생목록의 곡을 현재 목록 끝에 한꺼번에 추가 */
  function importPlaylist(targetPlaylistId, url) {
    var id = playlistId(url);
    if (!id) return Promise.reject(new Error('YouTube 재생목록 주소를 확인해 주세요.'));
    if (playlistImporting) return Promise.reject(new Error('다른 재생목록을 가져오는 중입니다. 잠시만 기다려 주세요.'));

    playlistImporting = true;
    return readPlaylistVideoIds(id).then(function (ids) {
      var target = playlists().find(function (pl) { return pl.id === targetPlaylistId; });
      if (!target) throw new Error('곡을 넣을 재생목록을 찾지 못했습니다.');

      var seen = {};
      target.tracks.forEach(function (tr) { seen[tr.videoId] = true; });
      var freshIds = ids.filter(function (video) {
        if (seen[video]) return false;
        seen[video] = true;
        return true;
      });
      var addedTracks = freshIds.map(function (video) {
        return {
          id: U.uid('tr'),
          videoId: video,
          title: '유튜브 영상 ' + video,
          url: 'https://www.youtube.com/watch?v=' + video
        };
      });

      if (addedTracks.length) {
        MW.store.update(function (s) {
          var pl = s.playlists.find(function (item) { return item.id === targetPlaylistId; });
          if (pl) Array.prototype.push.apply(pl.tracks, addedTracks);
        });
        fetchImportedTitles(addedTracks);
      }

      return { total: ids.length, added: addedTracks.length, skipped: ids.length - addedTracks.length };
    }).finally(function () {
      playlistImporting = false;
    });
  }

  MW.music = {
    init: init,
    render: renderBar,
    addPlaylist: addPlaylist,
    addTrack: addTrack,
    importPlaylist: importPlaylist,
    videoId: videoId,
    playlistId: playlistId,
    playTrack: playTrack,
    selectPlaylist: selectPlaylist,
    MAX_PLAYLISTS: MAX_PLAYLISTS,
    isBlocked: function () { return apiFailed; }
  };
})();
