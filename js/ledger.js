/* ==========================================================================
   MW.ledger — 정산 (가계부 · 어시스턴트 · 세무)
   · 이 파일은 정산 페이지의 호스트이자 "가계부" 화면입니다.
     어시스턴트는 js/assistants.js, 세무는 js/tax.js 가 담당합니다.
   · 거래 기록(tx) 하나가 단일 원본이고, 잔액 · 예산 · 세무 자료는 모두 파생 계산입니다.
   · 원천세는 거래에 억지로 넣지 않고 어시스턴트 지급 데이터에서 파생시킵니다 (기획서 7장).
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var METHODS = ['계좌', '카드', '현금', '기타'];
  var VAT_TYPES = [
    { value: 'none', label: '해당없음' },
    { value: 'taxable', label: '과세' },
    { value: 'exempt', label: '면세 · 비과세' }
  ];
  var EVIDENCES = ['', '세금계산서', '현금영수증', '카드전표', '간이영수증', '없음'];

  var tab = 'book';               // 'book' | 'assistants' | 'tax'
  var sub = 'dashboard';          // 가계부 서브탭: 'dashboard' | 'tx'
  var month = U.ym(new Date());
  var txMode = 'month';           // 'month' = 월간 요약, 'all' = 전체 표
  var root = null;

  /* ------------------------------------------------------------ 조회 헬퍼 */

  function L() { return MW.store.state.ledger; }
  function types() { return L().types; }
  function typeById(id) { return types().find(function (t) { return t.id === id; }) || null; }
  function typeByName(name) { return types().find(function (t) { return t.name === name; }) || null; }
  function catById(typeId, catId) {
    var t = typeById(typeId);
    if (!t) return null;
    return t.categories.find(function (c) { return c.id === catId; }) || null;
  }
  function catName(tx) { var c = catById(tx.typeId, tx.catId); return c ? c.name : '-'; }
  function typeName(tx) { var t = typeById(tx.typeId); return t ? t.name : '-'; }
  function isIncome(tx) { var t = typeById(tx.typeId); return !!t && t.kind === 'income'; }

  /**
   * 자동 기록용 타입·대분류를 찾고, 사용자가 지웠다면 다시 만들어 줍니다.
   * (store.update 안에서 state 를 넘겨 호출합니다)
   */
  function ensureCat(state, tName, cName) {
    var kind = tName === '수입' ? 'income' : 'expense';
    var t = state.ledger.types.find(function (x) { return x.name === tName; });
    if (!t) {
      t = { id: U.uid('t'), name: tName, kind: kind, categories: [] };
      state.ledger.types.push(t);
    }
    if (!Array.isArray(t.categories)) t.categories = [];
    var c = t.categories.find(function (x) { return x.name === cName; });
    if (!c) {
      c = { id: U.uid('c'), name: cName };
      t.categories.push(c);
    }
    return { typeId: t.id, catId: c.id };
  }

  function txOf(ymStr) {
    return L().tx.filter(function (t) { return String(t.date || '').slice(0, 7) === ymStr; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function txInYear(year) {
    return L().tx.filter(function (t) { return String(t.date || '').slice(0, 4) === String(year); })
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

  function summary(ymStr) {
    var list = txOf(ymStr);
    var carry = carryOf(ymStr);
    var s = { income: 0, expense: 0, card: 0, liquidIn: 0, liquidOut: 0, byType: {}, byCat: {} };
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

    var vat = el('select.field', {}, VAT_TYPES.map(function (v) {
      return el('option', { value: v.value, text: v.label, selected: v.value === (d.vatType || 'none') });
    }));
    var evidence = el('select.field', {}, EVIDENCES.map(function (e) {
      return el('option', { value: e, text: e || '— 미입력 —', selected: e === (d.evidence || '') });
    }));
    var vatRow = el('div.form-row', {}, [
      el('label', { text: '부가세 구분' }), vat,
      el('div.small.dim', { text: '과세로 표시한 거래만 [세무 → 부가세]에서 매출·매입으로 집계됩니다.' })
    ]);
    var evRow = el('div.form-row', {}, [el('label', { text: '증빙' }), evidence]);

    function fillCats() {
      U.clear(cat);
      var t = typeById(type.value);
      (t ? t.categories : []).forEach(function (c) {
        cat.appendChild(el('option', { value: c.id, text: c.name, selected: c.id === d.catId }));
      });
      syncVat();
    }
    /** 부가세 · 증빙은 사업 관련 거래(수입 · 업무)에서만 물어봅니다 */
    function syncVat() {
      var t = typeById(type.value);
      var show = !!t && (t.kind === 'income' || t.name === '업무');
      vatRow.style.display = show ? 'flex' : 'none';
      evRow.style.display = show ? 'flex' : 'none';
      if (!show) { vat.value = 'none'; evidence.value = ''; }
    }

    type.addEventListener('change', fillCats);
    amount.addEventListener('input', function () {
      var caretEnd = this.selectionStart === this.value.length;
      var v = U.parseNum(this.value);
      this.value = v ? U.num(v) : '';
      if (caretEnd) this.setSelectionRange(this.value.length, this.value.length);
    });
    if (!d.typeId) type.value = types()[0].id;
    fillCats();
    if (d.catId) cat.value = d.catId;
    syncVat();

    return {
      rows: [
        el('div.form-row', {}, [el('label', { text: '날짜' }), date]),
        el('div.form-row', {}, [el('label', { text: '타입' }), type]),
        el('div.form-row', {}, [el('label', { text: '대분류' }), cat]),
        el('div.form-row', {}, [el('label', { text: '금액 (원)' }), amount]),
        el('div.form-row', {}, [el('label', { text: '내역' }), desc]),
        el('div.form-row', {}, [el('label', { text: '결제수단' }), method]),
        el('div.form-row', {}, [el('label', { text: '메모' }), memo]),
        vatRow,
        evRow
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
          vatType: vat.value,
          evidence: evidence.value
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

  function formBody(f) {
    return [el('div.form-grid', {}, f.rows.slice(0, 6)), f.rows[6], f.rows[7], f.rows[8]];
  }

  function addTxDialog(preset) {
    var f = txFields(preset);
    MW.shell.modal({
      title: '거래 추가',
      body: formBody(f),
      okText: '추가',
      onOk: function () {
        if (!f.validate()) return false;
        var v = f.value();
        v.id = U.uid('tx');
        v.paymentId = null;
        MW.store.update(function (s) { s.ledger.tx.push(v); });
        month = v.date.slice(0, 7);
        U.toast('거래를 추가했습니다.');
      }
    });
  }

  function editTxDialog(tx) {
    // 지급 내역에서 자동으로 만들어진 거래는 원본(지급 기록)에서 고칩니다
    if (tx.paymentId) {
      var p = MW.assistants.paymentByTx(tx.id);
      if (p) { MW.assistants.paymentDialog(p); return; }
    }
    var f = txFields(tx);
    MW.shell.modal({
      title: '거래 수정',
      body: formBody(f),
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
      el('span.small.dim', { text: '거래 추가는 “거래내역”에서 합니다' })
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

  function vatLabel(v) {
    var f = VAT_TYPES.find(function (x) { return x.value === v; });
    return f && f.value !== 'none' ? f.label : '';
  }

  function txRow(t) {
    var inc = isIncome(t);
    return el('tr' + (t.paymentId ? '.linked' : ''), {}, [
      el('td', { text: t.date }),
      el('td', { text: typeName(t) }),
      el('td', { text: catName(t) }),
      el('td', {}, [
        t.desc || '-',
        t.paymentId ? el('span.chip-sm', { text: '지급 연동', title: '어시스턴트 지급 내역에서 만들어진 거래입니다' }) : null
      ]),
      el('td', { text: t.method || '-' }),
      el('td.num' + (inc ? '.amount-in' : '.amount-out'), { text: (inc ? '+' : '−') + U.num(t.amount) }),
      el('td', { text: vatLabel(t.vatType) }),
      el('td', { text: t.evidence || '' }),
      el('td', { text: t.memo || '' }),
      el('td', {}, [el('div.tx-actions', {}, [
        el('button.btn.btn-ghost.btn-icon.btn-sm', {
          text: '✎',
          title: t.paymentId ? '지급 내역에서 수정' : '수정',
          onclick: function () { editTxDialog(t); }
        })
      ])])
    ]);
  }

  var TX_HEAD = ['날짜', '타입', '대분류', '내역', '결제수단', '금액', '부가세', '증빙', '메모', ''];

  function txTable(rowsFn) {
    var tbody = el('tbody');
    rowsFn(tbody);
    return el('div.tx-table-wrap', {}, [
      el('table.tx', {}, [
        el('thead', {}, [el('tr', {}, TX_HEAD.map(function (h) { return el('th', { text: h }); }))]),
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
        el('div.stat', {}, [el('div.label', { text: '순 수입' }), el('div.value', { text: U.won(s.net) })]),
        el('div.stat', {}, [
          el('div.label', { text: '거래 건수' }), el('div.value', { text: list.length + '건' })
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
          el('td', { colspan: '4', text: '순 ' + U.num(mIncome - mExpense) })
        ]));
      }
      all.forEach(function (t) {
        var m = String(t.date).slice(0, 7);
        if (m !== curMonth) {
          flush();
          curMonth = m; mIncome = 0; mExpense = 0;
          tbody.appendChild(el('tr.month-head', {}, [el('td', { colspan: '10', text: m.replace('-', '년 ') + '월' })]));
        }
        if (isIncome(t)) mIncome += +t.amount || 0; else mExpense += +t.amount || 0;
        tbody.appendChild(txRow(t));
      });
      flush();
    }));
  }

  /* ------------------------------------------------------------ 가계부 호스트 */

  var BOOK_SUBS = [
    { id: 'dashboard', label: '대시보드', fn: renderDashboard },
    { id: 'tx', label: '거래내역', fn: renderTx }
  ];

  function renderBook(host) {
    host.appendChild(el('div.subtabs', {}, BOOK_SUBS.map(function (s) {
      return el('button.subtab' + (sub === s.id ? '.active' : ''), {
        text: s.label, onclick: function () { sub = s.id; render(); }
      });
    })));
    var body = el('div');
    host.appendChild(body);
    (BOOK_SUBS.find(function (s) { return s.id === sub; }) || BOOK_SUBS[0]).fn(body);
  }

  /* ------------------------------------------------------------ 렌더 */

  var TABS = [
    { id: 'book', label: '가계부' },
    { id: 'assistants', label: '어시스턴트' },
    { id: 'tax', label: '세무' }
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

    if (tab === 'assistants') MW.assistants.mount(host);
    else if (tab === 'tax') MW.tax.mount(host);
    else renderBook(host);
  }

  MW.ledger = {
    mount: function (node) { root = node; render(); },
    render: render,
    openTab: function (id, subId) {
      tab = id;
      if (subId) {
        if (id === 'book') sub = subId;
        else if (id === 'assistants') MW.assistants.openSub(subId);
        else if (id === 'tax') MW.tax.openSub(subId);
      }
      render();
    },

    /* 파생 계산 · 조회 (홈 대시보드와 세무 화면이 함께 씁니다) */
    summary: summary,
    types: types,
    typeById: typeById,
    typeByName: typeByName,
    catById: catById,
    catName: catName,
    typeName: typeName,
    isIncome: isIncome,
    txOf: txOf,
    txInYear: txInYear,
    months: months,
    ensureCat: ensureCat,
    txTable: txTable,
    txRow: txRow,
    editTxDialog: editTxDialog,
    METHODS: METHODS
  };
})();
