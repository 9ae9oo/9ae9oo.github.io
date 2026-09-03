/* ==========================================================================
   MW.settings — 설정 페이지
   "재생과 편집 분리" 원칙: 자주 쓰는 조작(재생·입력)은 각 위젯에서, 가끔 쓰는
   관리(재생목록·카테고리·해빗)는 전부 이 페이지에서 합니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var tab = 'time';
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
      var addTrack = function () { if (MW.music.addTrack(pl.id, urlInput.value)) urlInput.value = ''; };
      var urlInput = el('input.field', {
        placeholder: 'https://www.youtube.com/watch?v=...',
        onkeydown: function (e) { if (e.key === 'Enter') addTrack(); }
      });

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
          el('button.btn.btn-primary.btn-sm', { text: '곡 추가', onclick: addTrack })
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
      var addCat = function () {
        var v = newCat.value.trim();
        if (!v) return;
        MW.store.update(function (s2) {
          var x = s2.ledger.types.find(function (y) { return y.id === t.id; });
          if (x) x.categories.push({ id: U.uid('c'), name: v });
        });
        newCat.value = '';
      };
      var newCat = el('input.field', {
        placeholder: '대분류 이름',
        onkeydown: function (e) { if (e.key === 'Enter') addCat(); }
      });
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
          el('button.btn.btn-sm', { text: '대분류 추가', onclick: addCat })
        ])
      ]));
    });
  }

  /* ------------------------------------------ 시간 · 해빗 · 그룹 */

  function pomoInput(key, label) {
    return el('div.form-row', {}, [
      el('label', { text: label }),
      el('input.field', {
        type: 'number', min: '1', max: '180', value: MW.store.state.pomodoro[key],
        onchange: function () {
          var v = U.clamp(Math.round(U.parseNum(this.value)) || 1, 1, 180);
          this.value = v;
          MW.store.update(function (s) { s.pomodoro[key] = v; });
          MW.pomodoro.refresh();
        }
      })
    ]);
  }

  /** 해빗 하나의 편집 카드 — 이름 · 색 · 알람 시각 목록 */
  function habitCard(h) {
    var times = MW.habits.timesOf(h);
    var addAlarm = function () { if (MW.habits.addTime(h.id, newTime.value)) newTime.value = ''; };
    var newTime = el('input.field', {
      type: 'time', style: { width: 'auto' },
      onkeydown: function (e) { if (e.key === 'Enter') addAlarm(); }
    });

    return el('div.habit-edit', {}, [
      el('div.row', {}, [
        el('input', {
          type: 'color', value: h.color, title: '트래커 칸 색상',
          style: { width: '34px', height: '30px', background: 'none', border: 'none', cursor: 'pointer' },
          onchange: function () {
            var v = this.value;
            MW.habits.patch(h.id, function (x) { x.color = v; });
          }
        }),
        el('input.field', {
          value: h.name, style: { flex: '1' },
          onchange: function () {
            var v = this.value.trim() || '이름 없음';
            MW.habits.patch(h.id, function (x) { x.name = v; });
          }
        }),
        el('span.chip', { text: '하루 ' + MW.habits.targetOf(h) + '회' }),
        el('span.small.dim', { text: '🔥 ' + MW.habits.streak(h.id, U.ymd(new Date())) + '일' }),
        el('button.btn.btn-ghost.btn-icon.btn-sm', {
          text: '✕', title: '삭제',
          onclick: function () {
            MW.shell.confirm('"' + h.name + '" 해빗과 기록을 모두 삭제할까요?', function () { MW.habits.remove(h.id); });
          }
        })
      ]),
      el('div.row-wrap', { style: { marginTop: '8px', alignItems: 'center' } }, [
        el('span.small.dim', { text: '알람' }),
        times.length ? el('span', {}, times.map(function (t) {
          return el('span.time-chip', {}, [
            t,
            el('button', {
              text: '✕', title: '이 알람 삭제',
              onclick: function () { MW.habits.removeTime(h.id, t); }
            })
          ]);
        })) : el('span.small.dim', { text: '없음 — 하루 1회 체크형으로 동작합니다' }),
        newTime,
        el('button.btn.btn-sm', { text: '＋ 알람', onclick: addAlarm })
      ]),
      el('div.small.dim', {
        text: '알람 개수가 하루 목표 횟수입니다. 알람이 울리면 [체크] 또는 [패스] 를 고르고, 놓친 알람은 다음에 열 때 모아서 보여줍니다.',
        style: { marginTop: '6px' }
      })
    ]);
  }

  function renderTime(host) {
    host.appendChild(el('div.card', {}, [
      el('h3', {}, ['뽀모도로 시간 ', el('span.muted', { text: '— 분 단위' })]),
      el('div.form-grid.pomo-grid', {}, [
        pomoInput('work', '집중'),
        pomoInput('shortBreak', '짧은 휴식'),
        pomoInput('longBreak', '긴 휴식'),
        pomoInput('repeat', '반복 횟수')
      ])
    ]));

    var s = MW.store.state.settings;
    host.appendChild(el('div.card', {}, [
      el('h3', { text: '캘린더 시간' }),
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
          el('label', { text: '한 주의 시작 요일' }),
          el('select.field', {
            onchange: function () {
              var v = +this.value;
              MW.store.update(function (st) { st.settings.weekStart = v; });
            }
          }, U.WEEKDAYS.map(function (w, i) {
            return el('option', { value: i, text: w + '요일', selected: i === +s.weekStart });
          }))
        ])
      ])
    ]));

    host.appendChild(icalCard());

    var addHabit = function () { if (MW.habits.add(habitInput.value)) habitInput.value = ''; };
    var habitInput = el('input.field', {
      placeholder: '새 해빗 이름 (예: 물 마시기)',
      onkeydown: function (e) { if (e.key === 'Enter') addHabit(); }
    });
    host.appendChild(el('div.card', {}, [
      el('h3', {}, ['해빗 ', el('span.muted', { text: '— 캘린더 위쪽과 홈 트래커에 표시됩니다' })]),
      el('div.row', {}, [
        habitInput,
        el('button.btn.btn-primary.btn-sm', { text: '추가', onclick: addHabit })
      ]),
      el('div', { style: { marginTop: '10px' } }, MW.habits.all().length
        ? MW.habits.all().map(habitCard)
        : [el('div.empty', { text: '해빗이 없습니다.' })])
    ]));

    host.appendChild(listEditorCard({
      key: 'todoGroups', idPrefix: 'g', palette: MW.todo.COLORS,
      title: '일정 카테고리',
      hint: '— 투두와 캘린더가 함께 쓰는 분류입니다. 카테고리 색이 캘린더 표시색의 기본값이 됩니다',
      placeholder: '새 카테고리 이름'
    }));
  }

  /**
   * 이름 + 색만 있는 분류 목록(일정 카테고리 / 메모 태그)을 편집하는 카드.
   * opts: { key, idPrefix, palette, title, hint, placeholder }
   */
  function listEditorCard(opts) {
    var list = MW.store.state[opts.key];
    var addItem = function () {
      var v = input.value.trim();
      if (!v) return;
      MW.store.update(function (st) {
        var arr = st[opts.key];
        arr.push({ id: U.uid(opts.idPrefix), name: v, color: opts.palette[arr.length % opts.palette.length] });
      });
      input.value = '';
    };
    var input = el('input.field', {
      placeholder: opts.placeholder,
      onkeydown: function (e) { if (e.key === 'Enter') addItem(); }
    });
    return el('div.card', {}, [
      el('h3', {}, [opts.title + ' ', el('span.muted', { text: opts.hint })]),
      el('div.row', {}, [
        input,
        el('button.btn.btn-primary.btn-sm', { text: '추가', onclick: addItem })
      ]),
      el('div', { style: { marginTop: '10px' } }, list.map(function (g) {
        return el('div.row', { style: { padding: '5px 0' } }, [
          el('input', {
            type: 'color', value: g.color,
            style: { width: '34px', height: '28px', background: 'none', border: 'none', cursor: 'pointer' },
            onchange: function () {
              var v = this.value;
              MW.store.update(function (st) {
                var x = st[opts.key].find(function (y) { return y.id === g.id; });
                if (x) x.color = v;
              });
            }
          }),
          el('input.field', {
            value: g.name, style: { flex: '1' },
            onchange: function () {
              var v = this.value.trim() || '이름 없음';
              MW.store.update(function (st) {
                var x = st[opts.key].find(function (y) { return y.id === g.id; });
                if (x) x.name = v;
              });
            }
          }),
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '✕', title: '삭제',
            onclick: function () {
              MW.store.update(function (st) {
                st[opts.key] = st[opts.key].filter(function (y) { return y.id !== g.id; });
              });
            }
          })
        ]);
      }))
    ]);
  }

  /* ------------------------------------------------------------ 일반 */

  /** 외부 캘린더(iCal) 카드 — 시간 관련 설정이므로 “시간 · 해빗” 탭에서 씁니다 */
  function icalCard() {
    var s = MW.store.state.settings;
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

    return el('div.card', {}, [
      el('h3', { text: '외부 캘린더 (iCal 읽기 전용)' }),
      el('div.small.dim', {
        text: '구글 캘린더의 iCal 주소는 브라우저에서 직접 불러오면 CORS 정책에 막히는 경우가 많습니다. ' +
              '막히면 캘린더 설정에서 .ics 파일을 내려받아 아래 “파일 가져오기”를 쓰세요.',
        style: { marginBottom: '10px' }
      }),
      el('div.row-wrap', {}, [
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
    ]);
  }

  function renderGeneral(host) {
    var s = MW.store.state.settings;

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '알림 · 소리' }),
      el('div.row-wrap', {}, [
        el('label.row.small.muted', { style: { gap: '6px', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox', checked: s.notify,
            onchange: function () {
              var v = this.checked;
              MW.store.update(function (st) { st.settings.notify = v; });
              if (v) MW.shell.requestNotify();
            }
          }), '데스크톱 알림 사용'
        ]),
        el('label.row.small.muted', { style: { gap: '6px', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox', checked: s.sound,
            onchange: function () {
              var v = this.checked;
              MW.store.update(function (st) { st.settings.sound = v; });
            }
          }), '알람 소리 사용'
        ]),
        el('button.btn.btn-sm', {
          text: '🔔 브라우저 알림 권한 요청',
          onclick: function () { MW.shell.requestNotify(); }
        })
      ]),
      el('div.small.dim', {
        text: '뽀모도로와 해빗 알람은 이 탭이 열려 있을 때만 울립니다. 놓친 해빗 알람은 다음에 열 때 모아서 보여줍니다.',
        style: { marginTop: '8px' }
      })
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

    host.appendChild(el('div.callout.warn', {}, [
      el('strong', { text: '컴퓨터 시작 시 자동 실행 · 트레이 백그라운드 실행 — 준비 중. ' }),
      '브라우저 안에서는 웹앱이 스스로 켜지거나 트레이에 남을 수 없습니다. ' +
      '데스크톱 래퍼(Electron·Tauri)로 감싸는 단계에서 두 항목을 제공할 예정입니다. ' +
      '그 전까지는 브라우저에서 이 페이지를 앱으로 설치해(주소창 설치 아이콘) 별도 창으로 쓰면 비슷하게 쓸 수 있습니다.'
    ]));
  }

  /* ------------------------------------------------- 홈 대시보드 (테마 탭) */

  var HOME_KEYS_FALLBACK = ['image', 'today', 'next', 'habits', 'money'];
  var HOME_LABELS_FALLBACK = { image: '꾸미기 이미지', today: '오늘 일정', next: '내일 · 미뤄진 일정', habits: '오늘 한 해빗', money: '오늘 쓴 돈' };

  /** 홈 카드 순서 편집 — MW.app 의 헬퍼를 쓰되(부팅 후 존재) 없으면 폴백 */
  function homeOrderCard() {
    var app = MW.app || {};
    var labels = app.homeSectionLabels || HOME_LABELS_FALLBACK;
    var order = app.homeOrder ? app.homeOrder() : HOME_KEYS_FALLBACK.slice();
    var move = app.moveHomeSection || function (key, delta) {
      var i = order.indexOf(key), j = i + delta;
      if (i < 0 || j < 0 || j >= order.length) return;
      order.splice(i, 1); order.splice(j, 0, key);
      MW.store.update(function (s) { s.settings.homeOrder = order.slice(); });
    };

    var rows = order.map(function (key, idx) {
      return el('div.home-order-row', {}, [
        el('span.home-order-label', { text: labels[key] || key }),
        el('div.home-order-btns', {}, [
          el('button', {
            text: '▲', title: '위로', 'aria-label': '위로', disabled: idx === 0,
            onclick: function () { move(key, -1); }
          }),
          el('button', {
            text: '▼', title: '아래로', 'aria-label': '아래로', disabled: idx === order.length - 1,
            onclick: function () { move(key, 1); }
          })
        ])
      ]);
    });

    return el('div.card', {}, [
      el('h3', { text: '대시보드 카드 순서' }),
      el('div.small.dim', { text: '홈 화면에서 카드가 나타나는 순서입니다.', style: { marginBottom: '10px' } }),
      el('div.home-order-list', {}, rows)
    ]);
  }

  /* ------------------------------------------------------ 홈 꾸미기 이미지 */

  /** 파일을 캔버스로 축소해서 data URL(JPEG) 로 변환 — LocalStorage 용량 보호 */
  function shrinkImage(file, maxW, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width);
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        try { cb(cv.toDataURL('image/jpeg', 0.82)); }
        catch (e) { cb(String(reader.result)); }   // 변환 실패 시 원본 사용
      };
      img.onerror = function () { U.toast('이미지를 불러오지 못했습니다.', 'err'); };
      img.src = String(reader.result);
    };
    reader.onerror = function () { U.toast('파일을 읽지 못했습니다.', 'err'); };
    reader.readAsDataURL(file);
  }

  function homeImageCard() {
    var cur = MW.store.state.settings.homeImage || '';
    var size = MW.store.state.settings.homeImageSize || 'md';
    var file = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    file.addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      shrinkImage(f, 1600, function (dataUrl) {
        MW.store.update(function (s) { s.settings.homeImage = dataUrl; });
        U.toast('홈 이미지를 넣었습니다.');
      });
    });

    return el('div.card', {}, [
      el('h3', { text: '홈 꾸미기 이미지' }),
      el('div.small.dim', {
        text: '대시보드에 표시됩니다. 놓이는 자리는 아래 “대시보드 카드 순서”에서 정합니다. 넣지 않으면 그 자리는 나타나지 않습니다. (긴 그림은 자동으로 가로 1600px 로 줄여 저장)',
        style: { marginBottom: '10px' }
      }),
      cur ? el('img.home-image-preview', { src: cur, alt: '' }) : el('div.empty', { text: '설정된 이미지가 없습니다.' }),
      cur ? el('div.knob-row', { style: { marginTop: '12px' } }, [
        el('span.knob-label', { text: '높이' }),
        el('div.seg', {}, [['sm', '낮게'], ['md', '보통'], ['lg', '높게']].map(function (o) {
          return el('button' + (size === o[0] ? '.active' : ''), {
            type: 'button', text: o[1],
            onclick: function () { MW.store.update(function (s) { s.settings.homeImageSize = o[0]; }); }
          });
        }))
      ]) : null,
      el('div.row-wrap', { style: { marginTop: '10px' } }, [
        el('button.btn.btn-sm', { text: cur ? '이미지 바꾸기' : '이미지 선택', onclick: function () { file.click(); } }),
        cur ? el('button.btn.btn-sm.btn-danger', {
          text: '제거',
          onclick: function () { MW.store.update(function (s) { s.settings.homeImage = ''; }); }
        }) : null,
        file
      ])
    ]);
  }

  /* ------------------------------------------------------------ 테마 */

  /* 프리셋 미리보기용 색 — 실제 값의 원본은 css/tokens.css 의 :root[data-preset="…"] */
  var THEME_PRESETS = [
    { id: 'base',     name: '화이트',   bg: '#f5f6fa', accent: '#9db8f0' },
    { id: 'mint',     name: '민트',     bg: '#eff6f2', accent: '#86cfae' },
    { id: 'peach',    name: '피치',     bg: '#fbf3ee', accent: '#f0a98c' },
    { id: 'lavender', name: '라벤더',   bg: '#f5f2fb', accent: '#bfaced' },
    { id: 'butter',   name: '버터',     bg: '#faf5e9', accent: '#e6c579' }
  ];
  var ACCENT_PRESETS = [
    { name: '블루',   color: '#9db8f0' },
    { name: '민트',   color: '#86cfae' },
    { name: '피치',   color: '#f0a98c' },
    { name: '라벤더', color: '#bfaced' },
    { name: '버터',   color: '#e6c579' },
    { name: '로즈',   color: '#eba3b7' },
    { name: '세이지', color: '#a9c08f' }
  ];
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;

  function setTheme(patch) {
    MW.store.update(function (s) {
      s.settings.theme = Object.assign({}, s.settings.theme, patch);
    });
  }

  function keyToVar(key) {
    return key === 'accent' ? '--accent' : key === 'bg' ? '--bg' : '--surface-1';
  }

  /** 색상 입력의 현재값 — 사용자 오버라이드가 있으면 그 값, 없으면 화면에 적용 중인 프리셋 값 */
  function currentColor(key) {
    var t = MW.store.state.settings.theme || {};
    if (HEX_RE.test(t[key] || '')) return t[key];
    var v = getComputedStyle(document.documentElement).getPropertyValue(keyToVar(key)).trim();
    return HEX_RE.test(v) ? v : (key === 'accent' ? '#9db8f0' : '#ffffff');
  }

  function renderTheme(host) {
    var t = MW.store.state.settings.theme || {};
    var preset = THEME_PRESETS.some(function (p) { return p.id === t.preset; }) ? t.preset : 'base';

    /* 1. 프리셋 */
    var grid = el('div.preset-grid', {}, THEME_PRESETS.map(function (p) {
      return el('button.preset-chip' + (preset === p.id ? '.active' : ''), {
        type: 'button', title: p.name,
        onclick: function () { setTheme({ preset: p.id, accent: '', bg: '', card: '' }); }
      }, [
        el('span.preset-chip-sw', { style: { background: p.bg } }, [
          el('span.preset-chip-dot', { style: { background: p.accent } })
        ]),
        el('span.preset-chip-name', { text: p.name })
      ]);
    }));
    host.appendChild(el('div.card', {}, [
      el('h3', { text: '테마 프리셋' }),
      el('div.small.dim', { text: '배경·카드·강조색을 한 번에 바꿉니다. 이 브라우저에만 저장됩니다.', style: { marginBottom: '10px' } }),
      grid
    ]));

    /* 2. 세부 조정 — 프리셋 위에 개별 색을 덮어씀 */
    function knob(label, key) {
      var overridden = HEX_RE.test(t[key] || '');
      var picker = el('input.theme-color', {
        type: 'color', value: currentColor(key),
        oninput: function () { var o = {}; o[key] = this.value; MW.shell.previewTheme(o); },
        onchange: function () { var o = {}; o[key] = this.value; setTheme(o); }
      });
      return el('div.knob-row', {}, [
        el('span.knob-label', { text: label }),
        picker,
        el('span.knob-state.small.dim', { text: overridden ? '사용자 지정' : '프리셋 기본값' }),
        el('button.btn.btn-sm', {
          text: '되돌리기', disabled: !overridden,
          onclick: function () { var o = {}; o[key] = ''; setTheme(o); }
        })
      ]);
    }
    var accentSwatches = el('div.theme-swatches', { style: { marginTop: '2px', marginBottom: '4px' } },
      ACCENT_PRESETS.map(function (p) {
        return el('button.swatch' + ((t.accent || '').toLowerCase() === p.color ? '.active' : ''), {
          type: 'button', title: p.name, style: { background: p.color },
          onclick: function () { setTheme({ accent: p.color }); }
        });
      }));
    host.appendChild(el('div.card', {}, [
      el('h3', { text: '세부 조정' }),
      el('div.small.dim', { text: '"되돌리기"를 누르면 프리셋 기본값으로 돌아갑니다.', style: { marginBottom: '10px' } }),
      knob('강조색', 'accent'),
      accentSwatches,
      knob('배경색', 'bg'),
      knob('카드색', 'card')
    ]));

    /* 3. 배경 이미지 */
    host.appendChild(bgImageCard());

    /* 4. 동작(애니메이션) 줄이기 */
    host.appendChild(widthCard());
    host.appendChild(motionCard());

    host.appendChild(homeOrderCard());
    host.appendChild(homeImageCard());
  }

  function widthCard() {
    var cur = (MW.store.state.settings.theme || {}).contentWidth || 'normal';
    var opts = [['narrow', '좁게'], ['normal', '보통'], ['wide', '넓게'], ['full', '최대']];
    var seg = el('div.seg', {}, opts.map(function (o) {
      return el('button' + (cur === o[0] ? '.active' : ''), {
        type: 'button', text: o[1],
        onclick: function () { setTheme({ contentWidth: o[0] }); }
      });
    }));
    return el('div.card', {}, [
      el('h3', { text: '컨텐츠 폭' }),
      el('div.small.dim', { text: '가운데 메인 영역의 최대 너비입니다. "최대"는 화면을 꽉 채웁니다.', style: { marginBottom: '10px' } }),
      seg
    ]);
  }

  function motionCard() {
    var cur = MW.store.state.settings.reduceMotion || 'auto';
    var opts = [['auto', '자동 (OS 설정)'], ['on', '항상 줄이기'], ['off', '항상 켜기']];
    var seg = el('div.seg', {}, opts.map(function (o) {
      return el('button' + (cur === o[0] ? '.active' : ''), {
        type: 'button', text: o[1],
        onclick: function () { MW.store.update(function (s) { s.settings.reduceMotion = o[0]; }); }
      });
    }));
    return el('div.card', {}, [
      el('h3', { text: '동작 줄이기' }),
      el('div.small.dim', { text: '패널·플로팅 창이 열고 닫힐 때의 애니메이션을 줄입니다.', style: { marginBottom: '10px' } }),
      seg
    ]);
  }

  function bgImageCard() {
    var cur = (MW.store.state.settings.theme || {}).bgImage || '';
    var file = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    file.addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      shrinkImage(f, 2000, function (dataUrl) {
        setTheme({ bgImage: dataUrl });
        U.toast('배경 이미지를 넣었습니다.');
      });
    });
    return el('div.card', {}, [
      el('h3', { text: '배경 이미지' }),
      el('div.small.dim', {
        text: '화면 전체 뒤에 깔립니다. 사이드바·상단바·하단바는 반투명해지고 카드는 그대로 유지됩니다. (긴 그림은 가로 2000px 로 줄여 저장)',
        style: { marginBottom: '10px' }
      }),
      cur ? el('img.home-image-preview', { src: cur, alt: '' }) : el('div.empty', { text: '설정된 배경 이미지가 없습니다.' }),
      el('div.row-wrap', { style: { marginTop: '10px' } }, [
        el('button.btn.btn-sm', { text: cur ? '이미지 바꾸기' : '이미지 선택', onclick: function () { file.click(); } }),
        cur ? el('button.btn.btn-sm.btn-danger', { text: '제거', onclick: function () { setTheme({ bgImage: '' }); } }) : null,
        file
      ])
    ]);
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
    { id: 'time', label: '시간 · 해빗', fn: renderTime },
    { id: 'music', label: '음악', fn: renderMusic },
    { id: 'categories', label: '장부 카테고리', fn: renderCategories },
    { id: 'theme', label: '테마', fn: renderTheme },
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
