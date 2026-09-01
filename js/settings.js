/* ==========================================================================
   MW.settings — 설정 페이지
   "재생과 편집 분리" 원칙: 자주 쓰는 조작(재생·입력)은 각 위젯에서, 가끔 쓰는
   관리(재생목록·카테고리·해빗)는 전부 이 페이지에서 합니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var tab = 'music';
  var root = null;

  /* ------------------------------------------------------------ 음악 */

  function renderMusic(host) {
    var pls = MW.store.state.playlists;

    host.appendChild(el('div.callout', {}, [
      el('strong', { text: '곡 관리는 여기에서만 합니다. ' }),
      '상단바에서는 재생과 목록 전환만 하고, 추가·삭제·순서변경은 이 페이지에서 처리합니다. ',
      '유튜브 주소를 붙여넣으면 제목을 자동으로 가져오고, 실패하면 재생할 때 자동으로 채워집니다.'
    ]));

    host.appendChild(el('div.lg-toolbar', {}, [
      el('span.small.muted', { text: '재생목록 ' + pls.length + ' / ' + MW.music.MAX_PLAYLISTS }),
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', {
        text: '＋ 재생목록 만들기',
        onclick: function () {
          var name = el('input.field', { placeholder: '재생목록 이름' });
          MW.shell.modal({
            title: '재생목록 만들기',
            body: [el('div.form-row', {}, [el('label', { text: '이름' }), name])],
            onOk: function () {
              if (!name.value.trim()) { U.toast('이름을 입력해 주세요.', 'warn'); return false; }
              MW.music.addPlaylist(name.value.trim());
            }
          });
        }
      })
    ]));

    if (!pls.length) {
      host.appendChild(el('div.empty', { text: '재생목록이 없습니다.\n＋ 버튼으로 첫 목록을 만들어 주세요.' }));
      return;
    }

    pls.forEach(function (pl) {
      var urlInput = el('input.field', { placeholder: 'https://www.youtube.com/watch?v=...' });

      var tracks = el('div', {}, pl.tracks.length ? pl.tracks.map(function (tr, i) {
        return el('div.track-item', {}, [
          el('span.t-idx', { text: String(i + 1) }),
          el('input.field.t-title', {
            value: tr.title, style: { background: 'transparent', border: 'none', padding: '2px 4px' },
            onchange: function () {
              var v = this.value.trim() || tr.videoId;
              MW.store.update(function (s) {
                var p = s.playlists.find(function (x) { return x.id === pl.id; });
                var t = p && p.tracks.find(function (x) { return x.id === tr.id; });
                if (t) t.title = v;
              });
            }
          }),
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '▲', title: '위로', onclick: function () { moveTrack(pl.id, i, -1); }
          }),
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '▼', title: '아래로', onclick: function () { moveTrack(pl.id, i, 1); }
          }),
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '▶', title: '재생', onclick: function () { MW.music.selectPlaylist(pl.id); MW.music.playTrack(i, true); }
          }),
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '✕', title: '삭제',
            onclick: function () {
              MW.store.update(function (s) {
                var p = s.playlists.find(function (x) { return x.id === pl.id; });
                if (p) p.tracks = p.tracks.filter(function (x) { return x.id !== tr.id; });
              });
            }
          })
        ]);
      }) : [el('div.empty', { text: '곡이 없습니다.' })]);

      host.appendChild(el('div.card', {}, [
        el('div.row', {}, [
          el('input.field', {
            value: pl.name, style: { fontWeight: '600', width: 'auto', flex: '1' },
            onchange: function () {
              var v = this.value.trim() || '이름 없음';
              MW.store.update(function (s) {
                var p = s.playlists.find(function (x) { return x.id === pl.id; });
                if (p) p.name = v;
              });
            }
          }),
          el('span.chip', { text: pl.tracks.length + '곡' }),
          el('button.btn.btn-sm', { text: '재생', onclick: function () { MW.music.selectPlaylist(pl.id); } }),
          el('button.btn.btn-sm.btn-danger', {
            text: '목록 삭제',
            onclick: function () {
              MW.shell.confirm('"' + pl.name + '" 재생목록을 삭제할까요?', function () {
                MW.store.update(function (s) {
                  s.playlists = s.playlists.filter(function (x) { return x.id !== pl.id; });
                  if (s.player.playlistId === pl.id) {
                    s.player.playlistId = s.playlists[0] ? s.playlists[0].id : null;
                    s.player.index = 0;
                  }
                });
              });
            }
          })
        ]),
        el('div.row', { style: { marginTop: '10px' } }, [
          urlInput,
          el('button.btn.btn-primary.btn-sm', {
            text: '곡 추가',
            onclick: function () {
              if (MW.music.addTrack(pl.id, urlInput.value)) urlInput.value = '';
            }
          })
        ]),
        el('div', { style: { marginTop: '10px' } }, [tracks])
      ]));
    });
  }

  function moveTrack(plId, i, dir) {
    MW.store.update(function (s) {
      var p = s.playlists.find(function (x) { return x.id === plId; });
      if (!p) return;
      var j = i + dir;
      if (j < 0 || j >= p.tracks.length) return;
      var tmp = p.tracks[i]; p.tracks[i] = p.tracks[j]; p.tracks[j] = tmp;
    });
  }

  /* ------------------------------------------------------------ 카테고리 */

  function renderCategories(host) {
    host.appendChild(el('div.callout', {}, [
      '타입과 대분류는 여기에서만 관리합니다. 거래를 입력하는 중에는 새 카테고리를 만들 수 없습니다. ',
      el('strong', { text: '대분류는 타입에 종속됩니다.' })
    ]));

    host.appendChild(el('div.lg-toolbar', {}, [
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', {
        text: '＋ 타입 추가',
        onclick: function () {
          var name = el('input.field', { placeholder: '타입 이름' });
          var kind = el('select.field', {}, [
            el('option', { value: 'expense', text: '지출 계열' }),
            el('option', { value: 'income', text: '수입 계열' })
          ]);
          MW.shell.modal({
            title: '타입 추가',
            body: [
              el('div.form-row', {}, [el('label', { text: '이름' }), name]),
              el('div.form-row', {}, [el('label', { text: '수입/지출 구분' }), kind])
            ],
            onOk: function () {
              if (!name.value.trim()) { U.toast('이름을 입력해 주세요.', 'warn'); return false; }
              MW.store.update(function (s) {
                s.ledger.types.push({ id: U.uid('t'), name: name.value.trim(), kind: kind.value, categories: [] });
              });
            }
          });
        }
      })
    ]));

    MW.store.state.ledger.types.forEach(function (t) {
      var newCat = el('input.field', { placeholder: '대분류 이름' });
      host.appendChild(el('div.card', {}, [
        el('div.row', {}, [
          el('input.field', {
            value: t.name, style: { fontWeight: '600', flex: '1' },
            onchange: function () {
              var v = this.value.trim() || '이름 없음';
              MW.store.update(function (s) {
                var x = s.ledger.types.find(function (y) { return y.id === t.id; });
                if (x) x.name = v;
              });
            }
          }),
          el('span.chip', { text: t.kind === 'income' ? '수입' : '지출' }),
          el('button.btn.btn-sm.btn-danger', {
            text: '타입 삭제',
            onclick: function () {
              var used = MW.store.state.ledger.tx.filter(function (x) { return x.typeId === t.id; }).length;
              MW.shell.confirm(
                '"' + t.name + '" 타입을 삭제할까요?' + (used ? '\n이 타입을 쓰는 거래 ' + used + '건은 분류가 사라집니다.' : ''),
                function () {
                  MW.store.update(function (s) {
                    s.ledger.types = s.ledger.types.filter(function (y) { return y.id !== t.id; });
                  });
                }
              );
            }
          })
        ]),
        el('div.row-wrap', { style: { marginTop: '10px' } }, t.categories.map(function (c) {
          return el('span.chip', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
            c.name,
            el('button', {
              text: '✕', style: { color: 'var(--text-dim)', fontSize: '10px' }, title: '삭제',
              onclick: function () {
                MW.store.update(function (s) {
                  var x = s.ledger.types.find(function (y) { return y.id === t.id; });
                  if (x) x.categories = x.categories.filter(function (y) { return y.id !== c.id; });
                });
              }
            })
          ]);
        })),
        el('div.row', { style: { marginTop: '10px' } }, [
          newCat,
          el('button.btn.btn-sm', {
            text: '대분류 추가',
            onclick: function () {
              var v = newCat.value.trim();
              if (!v) return;
              MW.store.update(function (s) {
                var x = s.ledger.types.find(function (y) { return y.id === t.id; });
                if (x) x.categories.push({ id: U.uid('c'), name: v });
              });
              newCat.value = '';
            }
          })
        ])
      ]));
    });
  }

  /* ------------------------------------------------- 해빗 · 투두 그룹 */

  function renderGroups(host) {
    var habitInput = el('input.field', { placeholder: '새 해빗 이름 (매일 반복)' });
    host.appendChild(el('div.card', {}, [
      el('h3', {}, ['해빗 ', el('span.muted', { text: '— 캘린더 월/주/일 뷰에 함께 표시됩니다' })]),
      el('div.row', {}, [
        habitInput,
        el('button.btn.btn-primary.btn-sm', {
          text: '추가',
          onclick: function () { if (MW.habits.add(habitInput.value)) habitInput.value = ''; }
        })
      ]),
      el('div', { style: { marginTop: '10px' } }, MW.habits.all().length
        ? MW.habits.all().map(function (h) {
            return el('div.hb-item', {}, [
              el('span.dot', { style: { background: h.color, width: '10px', height: '10px', borderRadius: '50%' } }),
              el('span.hb-name', { text: h.name }),
              el('span.small.dim', { text: '🔥 ' + MW.habits.streak(h.id, U.ymd(new Date())) + '일' }),
              el('button.btn.btn-ghost.btn-icon.btn-sm', {
                text: '✕', title: '삭제',
                onclick: function () {
                  MW.shell.confirm('"' + h.name + '" 해빗과 기록을 모두 삭제할까요?', function () { MW.habits.remove(h.id); });
                }
              })
            ]);
          })
        : [el('div.empty', { text: '해빗이 없습니다.' })])
    ]));

    var groupInput = el('input.field', { placeholder: '새 그룹 이름' });
    host.appendChild(el('div.card', {}, [
      el('h3', {}, ['투두 · 메모 그룹 ', el('span.muted', { text: '— 그룹 색이 캘린더 표시색의 기본값이 됩니다' })]),
      el('div.row', {}, [
        groupInput,
        el('button.btn.btn-primary.btn-sm', {
          text: '추가',
          onclick: function () {
            var v = groupInput.value.trim();
            if (!v) return;
            MW.store.update(function (s) {
              s.todoGroups.push({ id: U.uid('g'), name: v, color: MW.todo.COLORS[s.todoGroups.length % MW.todo.COLORS.length] });
            });
            groupInput.value = '';
          }
        })
      ]),
      el('div', { style: { marginTop: '10px' } }, MW.store.state.todoGroups.map(function (g) {
        return el('div.row', { style: { padding: '5px 0' } }, [
          el('input', {
            type: 'color', value: g.color,
            style: { width: '34px', height: '28px', background: 'none', border: 'none', cursor: 'pointer' },
            onchange: function () {
              var v = this.value;
              MW.store.update(function (s) {
                var x = s.todoGroups.find(function (y) { return y.id === g.id; });
                if (x) x.color = v;
              });
            }
          }),
          el('input.field', {
            value: g.name, style: { flex: '1' },
            onchange: function () {
              var v = this.value.trim() || '이름 없음';
              MW.store.update(function (s) {
                var x = s.todoGroups.find(function (y) { return y.id === g.id; });
                if (x) x.name = v;
              });
            }
          }),
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '✕', title: '삭제',
            onclick: function () {
              MW.store.update(function (s) {
                s.todoGroups = s.todoGroups.filter(function (y) { return y.id !== g.id; });
              });
            }
          })
        ]);
      }))
    ]));
  }

  /* ------------------------------------------------------------ 일반 */

  function renderGeneral(host) {
    var s = MW.store.state.settings;

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '일반' }),
      el('div.form-grid', {}, [
        el('div.form-row', {}, [
          el('label', { text: '기상 시각 (일간 뷰 타임라인 시작)' }),
          el('select.field', {
            onchange: function () {
              var v = +this.value;
              MW.store.update(function (st) { st.settings.wakeHour = v; });
            }
          }, Array.from({ length: 24 }, function (_, i) {
            return el('option', { value: i, text: U.pad2(i) + ':00', selected: i === +s.wakeHour });
          }))
        ]),
        el('div.form-row', {}, [
          el('label', { text: '알림 / 소리' }),
          el('div.row', {}, [
            el('label.row.small.muted', { style: { gap: '5px', cursor: 'pointer' } }, [
              el('input', {
                type: 'checkbox', checked: s.notify,
                onchange: function () {
                  var v = this.checked;
                  MW.store.update(function (st) { st.settings.notify = v; });
                  if (v) MW.shell.requestNotify();
                }
              }), '알림'
            ]),
            el('label.row.small.muted', { style: { gap: '5px', cursor: 'pointer' } }, [
              el('input', {
                type: 'checkbox', checked: s.sound,
                onchange: function () {
                  var v = this.checked;
                  MW.store.update(function (st) { st.settings.sound = v; });
                }
              }), '소리'
            ])
          ])
        ])
      ]),
      el('button.btn.btn-sm', {
        text: '🔔 브라우저 알림 권한 요청', style: { marginTop: '10px' },
        onclick: function () { MW.shell.requestNotify(); }
      }),
      el('div.small.dim', {
        text: '데스크톱 알림은 이 탭이 열려 있을 때만 동작합니다.', style: { marginTop: '6px' }
      })
    ]));

    var icalUrl = el('input.field', { value: s.icalUrl || '', placeholder: 'https://calendar.google.com/.../basic.ics' });
    var file = el('input', { type: 'file', accept: '.ics,text/calendar', style: { display: 'none' } });
    file.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { MW.calendar.importIcs(String(reader.result)); };
      reader.onerror = function () { U.toast('파일을 읽지 못했습니다.', 'err'); };
      reader.readAsText(f, 'utf-8');
      this.value = '';
    });

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '외부 캘린더 (iCal 읽기 전용)' }),
      el('div.small.dim', {
        text: '구글 캘린더의 iCal 주소는 브라우저에서 직접 불러오면 CORS 정책에 막히는 경우가 많습니다. ' +
              '막히면 캘린더 설정에서 .ics 파일을 내려받아 아래 “파일 가져오기”를 쓰세요.',
        style: { marginBottom: '10px' }
      }),
      el('div.row', {}, [
        icalUrl,
        el('button.btn.btn-sm', {
          text: '주소로 가져오기',
          onclick: function () {
            var url = U.safeUrl(icalUrl.value);
            if (!url) { U.toast('http(s) 주소를 입력해 주세요.', 'warn'); return; }
            MW.store.update(function (st) { st.settings.icalUrl = url; });
            U.toast('불러오는 중…');
            fetch(url)
              .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
              .then(function (text) { MW.calendar.importIcs(text); })
              .catch(function () {
                U.toast('주소로 가져오기에 실패했습니다 (CORS 차단으로 보입니다). .ics 파일 가져오기를 사용해 주세요.', 'err');
              });
          }
        }),
        el('button.btn.btn-sm', { text: '.ics 파일 가져오기', onclick: function () { file.click(); } }),
        file
      ])
    ]));

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '데이터 백업 / 복구' }),
      el('div.small.dim', {
        text: '모든 데이터는 이 브라우저의 LocalStorage에만 저장됩니다. 브라우저 데이터를 지우면 함께 사라지니 주기적으로 내보내 두세요.',
        style: { marginBottom: '10px' }
      }),
      el('div.row-wrap', {}, [
        el('button.btn.btn-sm', { text: '⬇ JSON 내보내기', onclick: exportJson }),
        el('button.btn.btn-sm', { text: '⬆ JSON 불러오기', onclick: importJson }),
        el('button.btn.btn-sm.btn-danger', {
          text: '전체 초기화',
          onclick: function () {
            MW.shell.confirm('모든 데이터를 지우고 처음 상태로 되돌립니다. 계속할까요?', function () {
              MW.store.reset();
              U.toast('초기화했습니다.');
            }, '초기화');
          }
        })
      ])
    ]));
  }

  function exportJson() {
    try {
      var blob = new Blob([MW.store.exportJson()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mini-workspace-' + U.ymd(new Date()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      U.toast('JSON 파일을 내보냈습니다.');
    } catch (e) {
      U.toast('내보내기에 실패했습니다.', 'err');
    }
  }

  function importJson() {
    var input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          MW.store.importJson(String(reader.result));
          U.toast('불러왔습니다.');
        } catch (e) {
          U.toast('JSON 형식이 올바르지 않습니다.', 'err');
        }
      };
      reader.readAsText(f, 'utf-8');
    });
    input.click();
  }

  /* ------------------------------------------------------------ 렌더 */

  var TABS = [
    { id: 'music', label: '음악', fn: renderMusic },
    { id: 'categories', label: '장부 카테고리', fn: renderCategories },
    { id: 'groups', label: '해빗 · 그룹', fn: renderGroups },
    { id: 'general', label: '일반 · 데이터', fn: renderGeneral }
  ];

  function render() {
    if (!root) return;
    U.clear(root);
    root.appendChild(el('div.tabs', {}, TABS.map(function (t) {
      return el('button.tab' + (tab === t.id ? '.active' : ''), {
        text: t.label, onclick: function () { tab = t.id; render(); }
      });
    })));
    var host = el('div.panel.active');
    root.appendChild(host);
    (TABS.find(function (t) { return t.id === tab; }) || TABS[0]).fn(host);
  }

  MW.settings = {
    mount: function (node) { root = node; render(); },
    render: render,
    openTab: function (id) { tab = id; render(); }
  };
})();
