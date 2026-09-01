/* ==========================================================================
   MW.ledger — 정산 장부 (가계부)
   · 거래 기록(tx) 하나가 단일 원본이고, 대시보드·잔액·부가세 목록은 모두 파생 계산입니다.
   · 대분류는 타입에 종속됩니다 (타입을 고르면 그 타입의 대분류만 나옵니다).
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var METHODS = ['계좌', '카드', '현금', '기타'];
  var WT_RATE = 0.033;            // 사업소득세 3% + 지방세 0.3%
  var ASSIST_CAT = '어시비';

  var tab = 'dashboard';
  var month = U.ym(new Date());
  var txMode = 'month';           // 'month' = 월간 요약, 'all' = 전체 표
  var root = null;

  /* ------------------------------------------------------------ 조회 헬퍼 */

  function L() { return MW.store.state.ledger; }
  function types() { return L().types; }
  function typeById(id) { return types().find(function (t) { return t.id === id; }) || null; }
  function catById(typeId, catId) {
    var t = typeById(typeId);
    if (!t) return null;
    return t.categories.find(function (c) { return c.id === catId; }) || null;
  }
  function catName(tx) { var c = catById(tx.typeId, tx.catId); return c ? c.name : '-'; }
  function typeName(tx) { var t = typeById(tx.typeId); return t ? t.name : '-'; }
  function isIncome(tx) { var t = typeById(tx.typeId); return !!t && t.kind === 'income'; }

  function txOf(ymStr) {
    return L().tx.filter(function (t) { return String(t.date || '').slice(0, 7) === ymStr; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function months() {
    var set = {};
    L().tx.forEach(function (t) { if (t.date) set[t.date.slice(0, 7)] = true; });
    set[U.ym(new Date())] = true;
    return Object.keys(set).sort().reverse();
  }

  function carryOf(ymStr) {
    var c = L().carry[ymStr];
    return { bank: (c && +c.bank) || 0, cash: (c && +c.cash) || 0, lastCard: (c && +c.lastCard) || 0 };
  }

  /** 원천세: 업무 → 어시비 이면서 어시스턴트를 지정한 거래만 자동 계산 */
  function withholding(tx) {
    if (!tx.assistantId) return 0;
    if (catName(tx) !== ASSIST_CAT) return 0;
    return Math.round((+tx.amount || 0) * WT_RATE);
  }

  function summary(ymStr) {
    var list = txOf(ymStr);
    var carry = carryOf(ymStr);
    var s = {
      income: 0, expense: 0, card: 0, liquidIn: 0, liquidOut: 0,
      byType: {}, byCat: {}, wtTotal: 0, paidTotal: 0
    };
    list.forEach(function (t) {
      var amt = +t.amount || 0;
      var inc = isIncome(t);
      if (inc) s.income += amt; else s.expense += amt;

      s.byType[t.typeId] = (s.byType[t.typeId] || 0) + amt;
      s.byCat[t.typeId + ':' + t.catId] = (s.byCat[t.typeId + ':' + t.catId] || 0) + amt;

      if (t.method === '카드') { if (!inc) s.card += amt; }
      else if (t.method === '계좌' || t.method === '현금') {
        if (inc) s.liquidIn += amt; else s.liquidOut += amt;
      }
      var w = withholding(t);
      if (w) { s.wtTotal += w; s.paidTotal += amt; }
    });
    // 통장잔액 = 이월(계좌+현금) + 계좌·현금 수입 − 계좌·현금 지출 − 지난달 카드 청구액
    s.bank = carry.bank + carry.cash + s.liquidIn - s.liquidOut - carry.lastCard;
    // 쓸 수 있는 돈 = 통장잔액 − 이번달 카드 사용액
    s.free = s.bank - s.card;
    s.net = s.income - s.expense;
    s.carry = carry;
    return s;
  }

  /* ------------------------------------------------------------ 거래 입력 폼 */

  function txFields(initial) {
    var d = initial || {};
    var date = el('input.field', { type: 'date', value: d.date || U.ymd(new Date()) });

    var type = el('select.field', {}, types().map(function (t) {
      return el('option', { value: t.id, text: t.name, selected: t.id === d.typeId });
    }));
    var cat = el('select.field');
    var amount = el('input.field', { type: 'text', inputmode: 'numeric', placeholder: '0', value: d.amount ? U.num(d.amount) : '' });
    var desc = el('input.field', { placeholder: '무엇 / 누구', value: d.desc || '' });
    var method = el('select.field', {}, METHODS.map(function (m) {
      return el('option', { value: m, text: m, selected: m === (d.method || '계좌') });
    }));
    var memo = el('input.field', { placeholder: '자유 메모', value: d.memo || '' });

    var assistant = el('select.field', {}, [el('option', { value: '', text: '— 지정 안 함 —' })].concat(
      L().assistants.map(function (a) {
        return el('option', { value: a.id, text: a.name + ' (' + a.role + ')', selected: a.id === d.assistantId });
      })
    ));
    var wtNote = el('div.wt-note');
    var assistRow = el('div.form-row', {}, [el('label', { text: '어시스턴트 (원천세 3.3%)' }), assistant, wtNote]);

    function fillCats() {
      U.clear(cat);
      var t = typeById(type.value);
      (t ? t.categories : []).forEach(function (c) {
        cat.appendChild(el('option', { value: c.id, text: c.name, selected: c.id === d.catId }));
      });
      syncAssist();
    }
    function syncAssist() {
      var c = catById(type.value, cat.value);
      var show = !!c && c.name === ASSIST_CAT;
      assistRow.style.display = show ? 'flex' : 'none';
      if (!show) { assistant.value = ''; }
      updateWt();
    }
    function updateWt() {
      var amt = U.parseNum(amount.value);
      if (assistant.value && amt > 0) {
        var w = Math.round(amt * WT_RATE);
        wtNote.style.display = 'block';
        wtNote.textContent = '원천세 ' + U.won(w) + ' · 실지급액 ' + U.won(amt - w);
      } else {
        wtNote.style.display = 'none';
      }
    }

    type.addEventListener('change', fillCats);
    cat.addEventListener('change', syncAssist);
    assistant.addEventListener('change', updateWt);
    amount.addEventListener('input', function () {
      var caretEnd = this.selectionStart === this.value.length;
      var v = U.parseNum(this.value);
      this.value = v ? U.num(v) : '';
      if (caretEnd) this.setSelectionRange(this.value.length, this.value.length);
      updateWt();
    });
    if (!d.typeId) type.value = types()[0].id;
    fillCats();
    if (d.catId) cat.value = d.catId;
    syncAssist();

    return {
      rows: [
        el('div.form-row', {}, [el('label', { text: '날짜' }), date]),
        el('div.form-row', {}, [el('label', { text: '타입' }), type]),
        el('div.form-row', {}, [el('label', { text: '대분류' }), cat]),
        el('div.form-row', {}, [el('label', { text: '금액 (원)' }), amount]),
        el('div.form-row', {}, [el('label', { text: '내역' }), desc]),
        el('div.form-row', {}, [el('label', { text: '결제수단' }), method]),
        el('div.form-row', {}, [el('label', { text: '메모' }), memo]),
        assistRow
      ],
      value: function () {
        return {
          date: date.value,
          typeId: type.value,
          catId: cat.value,
          amount: U.parseNum(amount.value),
          desc: desc.value.trim(),
          method: method.value,
          memo: memo.value.trim(),
          assistantId: assistant.value || null
        };
      },
      validate: function () {
        if (!date.value) { U.toast('날짜를 선택해 주세요.', 'warn'); return false; }
        if (!cat.value) { U.toast('대분류를 선택해 주세요.', 'warn'); return false; }
        if (U.parseNum(amount.value) <= 0) { U.toast('금액을 입력해 주세요.', 'warn'); return false; }
        return true;
      },
      focus: function () { amount.focus(); }
    };
  }

  function addTxDialog(preset) {
    var f = txFields(preset);
    MW.shell.modal({
      title: '거래 추가',
      body: [el('div.form-grid', {}, f.rows.slice(0, 6)), f.rows[6], f.rows[7]],
      okText: '추가',
      onOk: function () {
        if (!f.validate()) return false;
        var v = f.value();
        v.id = U.uid('tx');
        MW.store.update(function (s) { s.ledger.tx.push(v); });
        month = v.date.slice(0, 7);
        U.toast('거래를 추가했습니다.');
      }
    });
  }

  function editTxDialog(tx) {
    var f = txFields(tx);
    MW.shell.modal({
      title: '거래 수정',
      body: [el('div.form-grid', {}, f.rows.slice(0, 6)), f.rows[6], f.rows[7]],
      extra: el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          MW.store.update(function (s) {
            s.ledger.tx = s.ledger.tx.filter(function (x) { return x.id !== tx.id; });
          });
          MW.shell.closeModal();
        }
      }),
      onOk: function () {
        if (!f.validate()) return false;
        var v = f.value();
        MW.store.update(function (s) {
          var x = s.ledger.tx.find(function (y) { return y.id === tx.id; });
          if (x) Object.assign(x, v);
        });
      }
    });
  }

  /* ------------------------------------------------------------ 대시보드 */

  function monthSelect(onChange) {
    return el('select.field', {
      style: { width: 'auto' },
      onchange: function () { month = this.value; onChange(); }
    }, months().map(function (m) {
      return el('option', { value: m, text: m.replace('-', '년 ') + '월', selected: m === month });
    }));
  }

  function carryInput(key, label, value) {
    return el('div.form-row', {}, [
      el('label', { text: label }),
      el('input.field', {
        type: 'text', inputmode: 'numeric', value: value ? U.num(value) : '',
        placeholder: '0',
        onchange: function () {
          var v = U.parseNum(this.value);
          this.value = v ? U.num(v) : '';
          MW.store.update(function (s) {
            if (!s.ledger.carry[month]) s.ledger.carry[month] = { bank: 0, cash: 0, lastCard: 0 };
            s.ledger.carry[month][key] = v;
          });
        }
      })
    ]);
  }

  function renderDashboard(host) {
    var s = summary(month);

    host.appendChild(el('div.lg-toolbar', {}, [
      monthSelect(render),
      el('span.spacer'),
      el('span.small.dim', { text: '거래 추가는 “거래내역” 탭에서 합니다' })
    ]));

    host.appendChild(el('div.stat-grid', {}, [
      el('div.stat.income', {}, [
        el('div.label', { text: '수입' }),
        el('div.value', { text: U.won(s.income) })
      ]),
      el('div.stat.expense', {}, [
        el('div.label', { text: '지출 합계' }),
        el('div.value', { text: U.won(s.expense) }),
        el('div.hint', { text: '순 수입 ' + U.won(s.net) })
      ]),
      el('div.stat.bank', {}, [
        el('div.label', { text: '통장 잔액 (유추)' }),
        el('div.value', { text: U.won(s.bank) }),
        el('div.hint', { text: '이월 + 계좌·현금 수입 − 지출 − 지난달 카드' })
      ]),
      el('div.stat.free', {}, [
        el('div.label', { text: '쓸 수 있는 돈' }),
        el('div.value' + (s.free < 0 ? '.minus' : ''), { text: U.won(s.free) }),
        el('div.hint', { text: '통장 잔액 − 이번달 카드 ' + U.won(s.card) })
      ])
    ]));

    host.appendChild(el('div.card', {}, [
      el('h3', {}, ['이월금 ', el('span.muted', { text: '— 매달 직접 입력합니다 (자동 계산 아님)' })]),
      el('div.carry-box', {}, [
        carryInput('bank', '계좌 잔액', s.carry.bank),
        carryInput('cash', '현금', s.carry.cash),
        carryInput('lastCard', '지난달 카드 청구액', s.carry.lastCard)
      ])
    ]));

    // 타입별 → 대분류 카드 (탭 없이 스크롤)
    types().forEach(function (t) {
      var total = s.byType[t.id] || 0;
      var cards = t.categories.map(function (c) {
        var key = t.id + ':' + c.id;
        var actual = s.byCat[key] || 0;
        var budget = +L().budgets[key] || 0;
        var over = budget > 0 && actual > budget;
        var ratio = budget > 0 ? Math.min(100, actual / budget * 100) : 0;
        return el('div.cat-card' + (over ? '.over' : ''), {}, [
          el('div.name', { text: c.name }),
          el('div.amounts', {}, [
            el('span', { text: U.won(actual) }),
            el('span.diff', { text: budget > 0 ? (over ? '+' : '') + U.won(actual - budget) : '예산 미설정' })
          ]),
          budget > 0 ? el('div.bar', {}, [el('span', { style: { width: ratio + '%' } })]) : null,
          el('input.budget-input', {
            type: 'text', inputmode: 'numeric', placeholder: '예산 입력',
            value: budget ? U.num(budget) : '',
            onchange: function () {
              var v = U.parseNum(this.value);
              MW.store.update(function (st) {
                if (v > 0) st.ledger.budgets[key] = v;
                else delete st.ledger.budgets[key];
              });
            }
          })
        ]);
      });
      host.appendChild(el('div.cat-group', {}, [
        el('h3', {}, [t.name, el('span.sum', { text: U.won(total) })]),
        el('div.cat-cards', {}, cards)
      ]));
    });
  }

  /* ------------------------------------------------------------ 거래내역 */

  function txRow(t) {
    var inc = isIncome(t);
    var w = withholding(t);
    return el('tr', {}, [
      el('td', { text: t.date }),
      el('td', { text: typeName(t) }),
      el('td', { text: catName(t) }),
      el('td', { text: t.desc || '-' }),
      el('td', { text: t.method || '-' }),
      el('td.num' + (inc ? '.amount-in' : '.amount-out'), { text: (inc ? '+' : '−') + U.num(t.amount) }),
      el('td.num', { text: w ? U.num(w) : '', title: w ? '실지급 ' + U.won(t.amount - w) : '' }),
      el('td', { text: t.memo || '' }),
      el('td', {}, [el('div.tx-actions', {}, [
        el('button.btn.btn-ghost.btn-icon.btn-sm', { text: '✎', title: '수정', onclick: function () { editTxDialog(t); } })
      ])])
    ]);
  }

  function txTable(rowsFn) {
    var tbody = el('tbody');
    rowsFn(tbody);
    return el('div.tx-table-wrap', {}, [
      el('table.tx', {}, [
        el('thead', {}, [el('tr', {}, ['날짜', '타입', '대분류', '내역', '결제수단', '금액', '원천세', '메모', ''].map(function (h) {
          return el('th', { text: h });
        }))]),
        tbody
      ])
    ]);
  }

  function renderTx(host) {
    host.appendChild(el('div.lg-toolbar', {}, [
      el('div.cal-views', {}, [
        el('button' + (txMode === 'month' ? '.active' : ''), {
          text: '월간 요약', onclick: function () { txMode = 'month'; render(); }
        }),
        el('button' + (txMode === 'all' ? '.active' : ''), {
          text: '전체 표', onclick: function () { txMode = 'all'; render(); }
        })
      ]),
      txMode === 'month' ? monthSelect(render) : null,
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', { text: '＋ 거래 추가', onclick: function () { addTxDialog({ date: month + '-01' }); } })
    ]));

    if (txMode === 'month') {
      var s = summary(month);
      var list = txOf(month);
      host.appendChild(el('div.stat-grid', {}, [
        el('div.stat.income', {}, [el('div.label', { text: '수입' }), el('div.value', { text: U.won(s.income) })]),
        el('div.stat.expense', {}, [el('div.label', { text: '지출' }), el('div.value', { text: U.won(s.expense) })]),
        el('div.stat', {}, [
          el('div.label', { text: '총 지급액 (어시)' }), el('div.value', { text: U.won(s.paidTotal) })
        ]),
        el('div.stat', {}, [
          el('div.label', { text: '총 원천세 3.3%' }), el('div.value', { text: U.won(s.wtTotal) }),
          el('div.hint', { text: '실지급 합계 ' + U.won(s.paidTotal - s.wtTotal) })
        ])
      ]));
      if (!list.length) {
        host.appendChild(el('div.empty', { text: '이 달의 거래가 없습니다.' }));
        return;
      }
      host.appendChild(txTable(function (tbody) {
        list.forEach(function (t) { tbody.appendChild(txRow(t)); });
      }));
      return;
    }

    // 전체 표: 월별 그룹 + 합계행
    var all = L().tx.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (!all.length) {
      host.appendChild(el('div.empty', { text: '거래 기록이 없습니다.\n＋ 거래 추가로 첫 기록을 남겨보세요.' }));
      return;
    }
    host.appendChild(txTable(function (tbody) {
      var curMonth = null, mIncome = 0, mExpense = 0;
      function flush() {
        if (curMonth === null) return;
        tbody.appendChild(el('tr.month-sum', {}, [
          el('td', { colspan: '5', text: curMonth + ' 합계' }),
          el('td.num', { text: '+' + U.num(mIncome) + ' / −' + U.num(mExpense) }),
          el('td', { colspan: '3', text: '순 ' + U.num(mIncome - mExpense) })
        ]));
      }
      all.forEach(function (t) {
        var m = String(t.date).slice(0, 7);
        if (m !== curMonth) {
          flush();
          curMonth = m; mIncome = 0; mExpense = 0;
          tbody.appendChild(el('tr.month-head', {}, [el('td', { colspan: '9', text: m.replace('-', '년 ') + '월' })]));
        }
        if (isIncome(t)) mIncome += +t.amount || 0; else mExpense += +t.amount || 0;
        tbody.appendChild(txRow(t));
      });
      flush();
    }));
  }

  /* ------------------------------------------------------------ 어시스턴트 */

  function assistantDialog(a) {
    var name = el('input.field', { value: a ? a.name : '', placeholder: '이름 또는 필명' });
    var role = el('input.field', { value: a ? a.role : '', placeholder: '채색 / 선화 / 배경 …' });
    var memo = el('textarea.field', { rows: '4', text: a ? a.memo : '', placeholder: '연락처, 계좌, 특이사항 등 자유롭게' });
    MW.shell.modal({
      title: a ? '어시스턴트 수정' : '어시스턴트 등록',
      body: [
        el('div.form-row', {}, [el('label', { text: '이름 (필수)' }), name]),
        el('div.form-row', {}, [el('label', { text: '공정/역할 (필수)' }), role]),
        el('div.form-row', {}, [el('label', { text: '자유 메모' }), memo])
      ],
      extra: a ? el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          MW.store.update(function (s) {
            s.ledger.assistants = s.ledger.assistants.filter(function (x) { return x.id !== a.id; });
          });
          MW.shell.closeModal();
        }
      }) : null,
      onOk: function () {
        if (!name.value.trim() || !role.value.trim()) { U.toast('이름과 공정/역할은 필수입니다.', 'warn'); return false; }
        MW.store.update(function (s) {
          if (a) {
            var x = s.ledger.assistants.find(function (y) { return y.id === a.id; });
            if (x) { x.name = name.value.trim(); x.role = role.value.trim(); x.memo = memo.value; }
          } else {
            s.ledger.assistants.push({
              id: U.uid('as'), name: name.value.trim(), role: role.value.trim(), memo: memo.value
            });
          }
        });
      }
    });
  }

  function renderAssistants(host) {
    host.appendChild(el('div.callout', {}, [
      el('strong', { text: '원천세 3.3% ' }),
      '— 별도 계산기가 아니라, 거래에서 “업무 → 어시비”를 고르고 등록된 어시스턴트를 지정하면 자동으로 계산됩니다. (사업소득세 3% + 지방세 0.3%)'
    ]));
    host.appendChild(el('div.lg-toolbar', {}, [
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', { text: '＋ 어시스턴트 등록', onclick: function () { assistantDialog(null); } })
    ]));

    var list = L().assistants;
    if (!list.length) {
      host.appendChild(el('div.empty', { text: '등록된 어시스턴트가 없습니다.' }));
      return;
    }
    host.appendChild(el('div.asst-grid', {}, list.map(function (a) {
      var paid = 0, wt = 0;
      L().tx.forEach(function (t) {
        if (t.assistantId === a.id) { paid += +t.amount || 0; wt += withholding(t); }
      });
      return el('div.asst-card', {}, [
        el('div.n', { text: a.name }),
        el('div.r', { text: a.role }),
        a.memo ? el('div.m', { text: a.memo }) : null,
        el('div.small.dim', {
          text: '누적 지급 ' + U.won(paid) + ' · 원천세 ' + U.won(wt),
          style: { marginTop: '8px' }
        }),
        el('button.btn.btn-sm', { text: '수정', style: { marginTop: '8px' }, onclick: function () { assistantDialog(a); } })
      ]);
    })));
  }

  /* ------------------------------------------------------------ 부가세 */

  function renderVat(host) {
    var workType = types().find(function (t) { return t.name === '업무'; });
    var year = month.slice(0, 4);
    var half = +month.slice(5, 7) <= 6 ? '1기' : '2기';
    var key = year + '-' + half;

    host.appendChild(el('div.callout.warn', {}, [
      el('strong', { text: '세무 안내: ' }),
      '원천세(3.3%) 계산 등은 참고용입니다. 실제 신고 전에는 홈택스 또는 세무사를 통해 확인하세요.'
    ]));

    host.appendChild(el('div.lg-toolbar', {}, [
      monthSelect(render),
      el('span.chip', { text: year + '년 ' + half }),
      el('span.spacer')
    ]));

    var list = workType
      ? L().tx.filter(function (t) { return t.typeId === workType.id && String(t.date).slice(0, 7) === month; })
      : [];
    var total = list.reduce(function (a, t) { return a + (+t.amount || 0); }, 0);

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '부가세 세액 (직접 입력)' }),
      el('div.form-grid', {}, [
        el('div.form-row', {}, [
          el('label', { text: key + ' 납부(예정) 세액' }),
          el('input.field', {
            type: 'text', inputmode: 'numeric',
            value: L().vat[key] ? U.num(L().vat[key]) : '',
            placeholder: '0',
            onchange: function () {
              var v = U.parseNum(this.value);
              this.value = v ? U.num(v) : '';
              MW.store.update(function (s) {
                if (v) s.ledger.vat[key] = v; else delete s.ledger.vat[key];
              });
            }
          })
        ]),
        el('div.form-row', {}, [
          el('label', { text: '이 달 업무지출 합계' }),
          el('div.field', { text: U.won(total), style: { background: 'var(--surface-2)' } })
        ])
      ])
    ]));

    host.appendChild(el('div.card', {}, [
      el('h3', { text: '업무 지출 자동 필터 (' + list.length + '건)' }),
      el('div.small.dim', { text: '타입이 “업무”인 거래만 자동으로 모았습니다. 부가가치세 신고 준비용 목록입니다.', style: { marginBottom: '10px' } }),
      list.length
        ? txTable(function (tbody) { list.forEach(function (t) { tbody.appendChild(txRow(t)); }); })
        : el('div.empty', { text: '이 달의 업무 지출이 없습니다.' })
    ]));
  }

  /* ------------------------------------------------------------ 렌더 */

  var TABS = [
    { id: 'dashboard', label: '대시보드', fn: renderDashboard },
    { id: 'tx', label: '거래내역', fn: renderTx },
    { id: 'assistants', label: '어시스턴트', fn: renderAssistants },
    { id: 'vat', label: '부가세', fn: renderVat }
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

  MW.ledger = {
    mount: function (node) { root = node; render(); },
    render: render,
    openTab: function (id) { tab = id; render(); },
    summary: summary,
    withholding: withholding,
    WT_RATE: WT_RATE
  };
})();
