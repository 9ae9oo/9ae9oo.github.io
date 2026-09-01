/* ==========================================================================
   MW.assistants — 어시스턴트 (작업자 · 지급 내역)
   · 개인정보 최소화 (기획서 12장): 계좌번호 · 은행 · 주민등록번호는
     입력란 자체를 만들지 않습니다. 데이터 모델에 없으므로 JSON 백업에도 없습니다.
   · 기본정보와 지급 기록을 분리합니다. 단가가 나중에 바뀌어도 과거 지급은 그대로입니다.
   · 지급을 저장하면 가계부에 "업무 → 어시비" 거래가 자동으로 생기고 서로 묶입니다.
     (기획서 6장 — 화면은 분리하되 데이터는 연결한다)
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var DEFAULT_RATE = 3.3;         // 사업소득세 3% + 지방소득세 0.3%
  var sub = 'people';             // 'people' | 'payments'
  var yearFilter = String(new Date().getFullYear());

  function L() { return MW.store.state.ledger; }
  function all() { return L().assistants; }
  function payments() { return L().payments; }
  function byId(id) { return all().find(function (a) { return a.id === id; }) || null; }
  function nameOf(id) { var a = byId(id); return a ? a.name : '(삭제된 작업자)'; }

  /* ==========================================================  계산 엔진 */

  /**
   * 원천징수액. 지방소득세가 소득세의 10% 라는 구조를 유지하기 위해
   * 입력받은 합계 세율 r 을 소득세 r/1.1 과 지방세 나머지로 나눕니다.
   * (3.3% → 3.0% + 0.3%,  8.8% → 8.0% + 0.8%)
   */
  function taxOn(gross, rate) {
    var r = (+rate || 0) / 100;
    if (r <= 0 || gross <= 0) return { incomeTax: 0, localTax: 0, withheld: 0 };
    var incomeTax = Math.round(gross * (r / 1.1));
    var localTax = Math.round(incomeTax * 0.1);
    return { incomeTax: incomeTax, localTax: localTax, withheld: incomeTax + localTax };
  }

  /**
   * 세후(입금액) 기준일 때, 실제 입금액이 정확히 net 이 되는 총 지급액을 역산합니다.
   * net / (1 - r) 한 번만으로는 반올림 때문에 1원이 어긋나서 반복해서 맞춥니다.
   */
  function grossUp(net, rate) {
    var r = (+rate || 0) / 100;
    net = Math.round(net);
    if (r <= 0 || r >= 1 || net <= 0) return Math.max(0, net);
    var gross = Math.round(net / (1 - r));
    for (var i = 0; i < 8; i++) {
      var diff = net - (gross - taxOn(gross, rate).withheld);
      if (!diff) break;
      gross += diff;
    }
    return gross;
  }

  /** 지급 한 건의 파생값. 저장하지 않고 필요할 때마다 계산합니다. */
  function calc(p) {
    p = p || {};
    var entered = (+p.basePay || 0) + (+p.extraPay || 0);
    var rate = typeof p.taxRate === 'number' ? p.taxRate : DEFAULT_RATE;
    var gross = p.payBasis === 'net' ? grossUp(entered, rate) : Math.round(entered);
    var t = taxOn(gross, rate);
    return {
      entered: entered, rate: rate, gross: gross,
      incomeTax: t.incomeTax, localTax: t.localTax, withheld: t.withheld,
      net: gross - t.withheld
    };
  }

  /* ==========================================================  가계부 연동 */

  /**
   * 지급 → "업무 → 어시비" 거래를 만들거나 갱신합니다.
   * 장부에 적히는 금액은 실제로 통장에서 나간 돈, 즉 입금액입니다.
   * 원천징수액은 [세무 → 원천세]에서 납부할 세액으로 따로 집계합니다.
   */
  function syncTx(state, p) {
    var idx = state.ledger.tx.findIndex(function (t) { return t.id === p.txId; });
    var existing = idx >= 0 ? state.ledger.tx[idx] : null;

    if (!p.paidAt) {                        // 아직 보내지 않은 지급은 장부에 올리지 않습니다
      if (existing) state.ledger.tx.splice(idx, 1);
      p.txId = null;
      return;
    }

    var c = MW.ledger.ensureCat(state, '업무', '어시비');
    var a = state.ledger.assistants.find(function (x) { return x.id === p.assistantId; });
    var r = calc(p);
    var fields = {
      date: p.paidAt,
      typeId: c.typeId,
      catId: c.catId,
      amount: r.net,
      desc: ((a && a.name) || '어시스턴트') + ' · ' + (p.workDesc || '작업'),
      method: '계좌',
      memo: '지급 내역 연동 — 총 ' + U.num(r.gross) + '원 중 원천징수 ' + U.num(r.withheld) + '원',
      vatType: 'none',
      evidence: '',
      assistantId: p.assistantId,
      paymentId: p.id
    };
    if (existing) { Object.assign(existing, fields); return; }
    fields.id = U.uid('tx');
    state.ledger.tx.push(fields);
    p.txId = fields.id;
  }

  function paymentByTx(txId) {
    return payments().find(function (p) { return p.txId === txId; }) || null;
  }

  /* ==========================================================  공용 입력 */

  function moneyInput(value, onInput) {
    return el('input.field', {
      type: 'text', inputmode: 'numeric', placeholder: '0',
      value: value ? U.num(value) : '',
      oninput: function () {
        var caretEnd = this.selectionStart === this.value.length;
        var v = U.parseNum(this.value);
        this.value = v ? U.num(v) : '';
        if (caretEnd) this.setSelectionRange(this.value.length, this.value.length);
        if (onInput) onInput(v);
      }
    });
  }

  /** 세그먼트 버튼 — 값이 둘뿐인 선택에 씁니다 */
  function seg(options, value, onChange) {
    var node = el('div.seg');
    options.forEach(function (o) {
      node.appendChild(el('button' + (o.value === value ? '.active' : ''), {
        type: 'button', text: o.label, title: o.hint || '',
        onclick: function () {
          value = o.value;
          U.$$('button', node).forEach(function (b) { b.classList.remove('active'); });
          this.classList.add('active');
          onChange(value);
        }
      }));
    });
    node.get = function () { return value; };
    return node;
  }

  var BASIS = [
    { value: 'gross', label: '세전 기준', hint: '적은 금액이 총 지급액이고, 여기서 원천징수를 뺀 만큼 입금합니다' },
    { value: 'net', label: '세후(입금액) 기준', hint: '적은 금액을 그대로 입금하고, 원천징수는 총액에서 역산합니다' }
  ];

  /* ==========================================================  작업자 */

  function assistantDialog(a) {
    var isNew = !a;
    var name = el('input.field', { value: a ? a.name : '', placeholder: '이름 또는 필명' });
    var part = el('input.field', { value: a ? a.workPart : '', placeholder: '밑색 / 선화 / 배경 …' });
    var basis = a && a.payBasis === 'net' ? 'net' : 'gross';
    var basisSeg = seg(BASIS, basis, function (v) { basis = v; });
    var pay = moneyInput(a ? a.defaultPay : 0);
    var rate = el('input.field', {
      type: 'number', step: '0.1', min: '0', max: '99',
      value: a && typeof a.taxRate === 'number' ? a.taxRate : DEFAULT_RATE
    });
    var extraRule = el('input.field', {
      value: a ? a.extraRule : '', placeholder: '예: 추가 컷당 3,000원'
    });
    var memo = el('textarea.field', {
      rows: '3', placeholder: '작업 관련 메모 (연락 방식, 마감 습관 등)'
    });
    memo.value = a ? (a.memo || '') : '';

    MW.shell.modal({
      title: isNew ? '작업자 등록' : '작업자 수정',
      body: [
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '이름 (필수)' }), name]),
          el('div.form-row', {}, [el('label', { text: '작업 파트' }), part])
        ]),
        el('div.form-row', {}, [
          el('label', { text: '지급 기준' }), basisSeg,
          el('div.small.dim', { text: '세전 = 적은 금액에서 원천징수를 뺀 돈을 보냅니다 · 세후 = 적은 금액을 그대로 보냅니다' })
        ]),
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '회차당 지급액' }), pay]),
          el('div.form-row', {}, [el('label', { text: '원천징수율 (%)' }), rate,
            el('div.small.dim', { text: '기본 3.3 (소득세 3 + 지방세 0.3) · 0 이면 원천징수 없음' })])
        ]),
        el('div.form-row', {}, [el('label', { text: '추가 작업금 기준' }), extraRule]),
        el('div.form-row', {}, [
          el('label', { text: '작업 관련 메모' }), memo,
          el('div.note-warn', { text: '⚠ 계좌번호 · 은행 · 주민등록번호는 적지 마세요. 이 프로그램은 그 정보를 저장하지 않습니다.' })
        ])
      ],
      extra: isNew ? null : el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          var cnt = payments().filter(function (p) { return p.assistantId === a.id; }).length;
          MW.shell.closeModal();
          MW.shell.confirm(
            cnt
              ? a.name + ' 님을 삭제합니다. 지급 기록 ' + cnt + '건은 남아 있지만 이름이 표시되지 않습니다.'
              : a.name + ' 님을 삭제할까요?',
            function () {
              MW.store.update(function (s) {
                s.ledger.assistants = s.ledger.assistants.filter(function (x) { return x.id !== a.id; });
              });
              U.toast('작업자를 삭제했습니다.');
            }
          );
        }
      }),
      onOk: function () {
        if (!name.value.trim()) { U.toast('이름을 입력해 주세요.', 'warn'); return false; }
        var v = {
          name: name.value.trim(),
          workPart: part.value.trim(),
          payBasis: basis,
          defaultPay: U.parseNum(pay.value),
          taxRate: U.clamp(parseFloat(rate.value) || 0, 0, 99),
          extraRule: extraRule.value.trim(),
          memo: memo.value
        };
        MW.store.update(function (s) {
          if (isNew) {
            v.id = U.uid('as');
            v.archived = false;
            s.ledger.assistants.push(v);
          } else {
            var x = s.ledger.assistants.find(function (y) { return y.id === a.id; });
            if (x) Object.assign(x, v);
          }
        });
        U.toast(isNew ? '작업자를 등록했습니다.' : '수정했습니다.');
      }
    });
  }

  function assistantTotals(id) {
    var gross = 0, withheld = 0, net = 0, count = 0;
    payments().forEach(function (p) {
      if (p.assistantId !== id) return;
      var r = calc(p);
      gross += r.gross; withheld += r.withheld; net += r.net; count += 1;
    });
    return { gross: gross, withheld: withheld, net: net, count: count };
  }

  function renderPeople(host) {
    host.appendChild(el('div.callout', {}, [
      el('strong', { text: '개인정보는 최소한만 다룹니다. ' }),
      '이름 · 작업 정보 · 지급 자료만 저장합니다. ',
      '주민등록번호 · 계좌번호 · 은행 정보는 ', el('strong', { text: '입력란 자체를 만들지 않아' }),
      ' JSON 백업에도 남지 않습니다.'
    ]));

    host.appendChild(el('div.lg-toolbar', {}, [
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', {
        text: '＋ 작업자 등록', onclick: function () { assistantDialog(null); }
      })
    ]));

    var list = all();
    if (!list.length) {
      host.appendChild(el('div.empty', { text: '등록된 작업자가 없습니다.\n＋ 작업자 등록으로 시작해 보세요.' }));
      return;
    }

    host.appendChild(el('div.asst-grid', {}, list.map(function (a) {
      var t = assistantTotals(a.id);
      var basisLabel = a.payBasis === 'net' ? '세후(입금액) 기준' : '세전 기준';
      return el('div.asst-card', {}, [
        el('div.n', { text: a.name }),
        el('div.r', { text: a.workPart || '작업 파트 미입력' }),
        el('div.asst-meta', {}, [
          el('div', {}, [el('span.k', { text: '지급 기준' }), el('span.v', { text: basisLabel })]),
          el('div', {}, [el('span.k', { text: '회차당' }), el('span.v', { text: U.won(a.defaultPay) })]),
          el('div', {}, [el('span.k', { text: '원천징수율' }), el('span.v', { text: (a.taxRate || 0) + '%' })]),
          a.extraRule ? el('div', {}, [el('span.k', { text: '추가 작업금' }), el('span.v', { text: a.extraRule })]) : null
        ]),
        a.memo ? el('div.m', { text: a.memo }) : null,
        el('div.asst-sum', {
          text: t.count
            ? '지급 ' + t.count + '건 · 총 ' + U.won(t.gross) + ' · 원천징수 ' + U.won(t.withheld)
            : '지급 기록 없음'
        }),
        el('div.row', { style: { marginTop: '8px', gap: '6px' } }, [
          el('button.btn.btn-sm', { text: '수정', onclick: function () { assistantDialog(a); } }),
          el('button.btn.btn-sm', {
            text: '＋ 지급 등록',
            onclick: function () { paymentDialog(null, a.id); }
          })
        ])
      ]);
    })));
  }

  /* ==========================================================  지급 내역 */

  function paymentDialog(p, presetAssistantId) {
    if (!all().length) {
      U.toast('먼저 작업자를 등록해 주세요.', 'warn');
      return;
    }
    var isNew = !p;
    var d = p || {
      year: String(new Date().getFullYear()),
      assistantId: presetAssistantId || all()[0].id,
      workDesc: '', basePay: 0, extraPay: 0, extraCuts: 0,
      payBasis: 'gross', taxRate: DEFAULT_RATE,
      paidAt: U.ymd(new Date()), reportedAt: '', memo: ''
    };
    if (isNew && presetAssistantId) {
      var pre = byId(presetAssistantId);
      if (pre) { d.payBasis = pre.payBasis; d.taxRate = pre.taxRate; d.basePay = pre.defaultPay; }
    }

    var year = el('input.field', { type: 'number', min: '2000', max: '2999', value: d.year });
    var who = el('select.field', {}, all().map(function (a) {
      return el('option', { value: a.id, text: a.name + (a.workPart ? ' · ' + a.workPart : ''), selected: a.id === d.assistantId });
    }));
    var desc = el('input.field', { value: d.workDesc, placeholder: '예: 8화 밑색' });
    var basePay = moneyInput(d.basePay, refresh);
    var extraPay = moneyInput(d.extraPay, refresh);
    var extraCuts = el('input.field', { type: 'number', min: '0', value: d.extraCuts || 0 });
    var basis = d.payBasis === 'net' ? 'net' : 'gross';
    var basisSeg = seg(BASIS, basis, function (v) { basis = v; refresh(); });
    var rate = el('input.field', {
      type: 'number', step: '0.1', min: '0', max: '99', value: d.taxRate,
      oninput: refresh
    });
    var paidAt = el('input.field', { type: 'date', value: d.paidAt || '' });
    var reportedAt = el('input.field', { type: 'date', value: d.reportedAt || '' });
    var memo = el('input.field', { value: d.memo || '', placeholder: '자유 메모' });
    var calcBox = el('div.pay-calc');

    function current() {
      return {
        basePay: U.parseNum(basePay.value),
        extraPay: U.parseNum(extraPay.value),
        payBasis: basis,
        taxRate: U.clamp(parseFloat(rate.value) || 0, 0, 99)
      };
    }
    function refresh() {
      var r = calc(current());
      U.clear(calcBox);
      calcBox.appendChild(el('div.pay-calc-row', {}, [
        el('span', {}, [el('b', { text: '총 지급액 ' }), U.won(r.gross)]),
        el('span.op', { text: '−' }),
        el('span', { text: '소득세 ' + U.num(r.incomeTax) + ' + 지방세 ' + U.num(r.localTax) }),
        el('span.op', { text: '=' }),
        el('span.net', {}, [el('b', { text: '입금액 ' }), U.won(r.net)])
      ]));
      calcBox.appendChild(el('div.small.dim', {
        text: r.withheld
          ? '장부에는 입금액 ' + U.won(r.net) + ' 이 계좌 지출로 기록됩니다. 원천징수 ' +
            U.won(r.withheld) + ' 은 [세무 → 원천세]에서 납부할 세액으로 모입니다.'
          : '원천징수가 없어 총 지급액이 그대로 장부에 기록됩니다.'
      }));
    }
    refresh();

    who.addEventListener('change', function () {
      var a = byId(who.value);
      if (!a) return;
      // 작업자를 바꾸면 그 사람의 기본 조건을 다시 채웁니다 (그 자리에서 고칠 수 있습니다)
      basis = a.payBasis === 'net' ? 'net' : 'gross';
      U.$$('button', basisSeg).forEach(function (b, i) {
        b.classList.toggle('active', BASIS[i].value === basis);
      });
      rate.value = a.taxRate;
      if (!U.parseNum(basePay.value)) basePay.value = a.defaultPay ? U.num(a.defaultPay) : '';
      refresh();
    });

    MW.shell.modal({
      title: isNew ? '지급 등록' : '지급 수정',
      body: [
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '귀속연도' }), year]),
          el('div.form-row', {}, [el('label', { text: '작업자' }), who])
        ]),
        el('div.form-row', {}, [el('label', { text: '작업 내역' }), desc]),
        el('div.form-row', {}, [
          el('label', { text: '지급 기준' }), basisSeg
        ]),
        el('div.form-grid', {}, [
          el('div.form-row', {}, [el('label', { text: '기본 지급' }), basePay]),
          el('div.form-row', {}, [el('label', { text: '추가 지급' }), extraPay]),
          el('div.form-row', {}, [el('label', { text: '추가 컷' }), extraCuts]),
          el('div.form-row', {}, [el('label', { text: '원천징수율 (%)' }), rate])
        ]),
        calcBox,
        el('div.form-grid', {}, [
          el('div.form-row', {}, [
            el('label', { text: '입금 정산일' }), paidAt,
            el('div.small.dim', { text: '비워두면 아직 보내지 않은 지급으로 보고 장부에 올리지 않습니다.' })
          ]),
          el('div.form-row', {}, [
            el('label', { text: '세금 신고일' }), reportedAt,
            el('div.small.dim', { text: '원천세 신고를 마친 날 (선택)' })
          ])
        ]),
        el('div.form-row', {}, [el('label', { text: '메모' }), memo])
      ],
      extra: isNew ? null : el('button.btn.btn-danger.btn-sm', {
        text: '삭제',
        onclick: function () {
          MW.shell.closeModal();
          MW.shell.confirm(
            p.txId
              ? '이 지급 기록과 연동된 가계부 거래를 함께 삭제할까요?'
              : '이 지급 기록을 삭제할까요?',
            function () {
              MW.store.update(function (s) {
                s.ledger.payments = s.ledger.payments.filter(function (x) { return x.id !== p.id; });
                if (p.txId) s.ledger.tx = s.ledger.tx.filter(function (t) { return t.id !== p.txId; });
              });
              U.toast('지급 기록을 삭제했습니다.');
            }
          );
        }
      }),
      onOk: function () {
        if (!desc.value.trim()) { U.toast('작업 내역을 적어 주세요.', 'warn'); return false; }
        var c = current();
        if (c.basePay + c.extraPay <= 0) { U.toast('지급액을 입력해 주세요.', 'warn'); return false; }
        var v = {
          year: String(year.value || new Date().getFullYear()),
          assistantId: who.value,
          workDesc: desc.value.trim(),
          basePay: c.basePay,
          extraPay: c.extraPay,
          extraCuts: Math.max(0, parseInt(extraCuts.value, 10) || 0),
          payBasis: c.payBasis,
          taxRate: c.taxRate,
          paidAt: paidAt.value || '',
          reportedAt: reportedAt.value || '',
          memo: memo.value.trim()
        };
        MW.store.update(function (s) {
          var target;
          if (isNew) {
            v.id = U.uid('pay');
            v.txId = null;
            s.ledger.payments.push(v);
            target = v;
          } else {
            target = s.ledger.payments.find(function (x) { return x.id === p.id; });
            if (target) Object.assign(target, v);
          }
          if (target) syncTx(s, target);
        });
        yearFilter = v.year;
        U.toast(isNew ? '지급을 등록했습니다.' : '지급을 수정했습니다.');
      }
    });
  }

  function years() {
    var set = {};
    payments().forEach(function (p) { if (p.year) set[p.year] = true; });
    set[String(new Date().getFullYear())] = true;
    return Object.keys(set).sort().reverse();
  }

  function ofYear(y) {
    return payments().filter(function (p) { return String(p.year) === String(y); })
      .sort(function (a, b) {
        var x = a.paidAt || '9999', z = b.paidAt || '9999';
        return x < z ? -1 : x > z ? 1 : 0;
      });
  }

  function renderPayments(host) {
    var ys = years();
    if (ys.indexOf(yearFilter) < 0) yearFilter = ys[0];

    host.appendChild(el('div.lg-toolbar', {}, [
      el('select.field', {
        style: { width: 'auto' },
        onchange: function () { yearFilter = this.value; render(); }
      }, ys.map(function (y) {
        return el('option', { value: y, text: y + '년', selected: y === yearFilter });
      })),
      el('span.small.dim', { text: '귀속연도 기준' }),
      el('span.spacer'),
      el('button.btn.btn-primary.btn-sm', { text: '＋ 지급 등록', onclick: function () { paymentDialog(null); } })
    ]));

    var list = ofYear(yearFilter);
    var tot = { gross: 0, withheld: 0, net: 0 };
    list.forEach(function (p) {
      var r = calc(p);
      tot.gross += r.gross; tot.withheld += r.withheld; tot.net += r.net;
    });

    host.appendChild(el('div.stat-grid', {}, [
      el('div.stat', {}, [el('div.label', { text: '지급 건수' }), el('div.value', { text: list.length + '건' })]),
      el('div.stat', {}, [el('div.label', { text: '신고용 총 지급액' }), el('div.value', { text: U.won(tot.gross) })]),
      el('div.stat', {}, [
        el('div.label', { text: '원천징수 합계' }), el('div.value', { text: U.won(tot.withheld) }),
        el('div.hint', { text: '세무 → 원천세에서 신고 자료로 집계됩니다' })
      ]),
      el('div.stat.bank', {}, [el('div.label', { text: '실제 입금액 합계' }), el('div.value', { text: U.won(tot.net) })])
    ]));

    if (!list.length) {
      host.appendChild(el('div.empty', { text: yearFilter + '년 지급 기록이 없습니다.' }));
      return;
    }

    var head = ['귀속연도', '작업자', '작업 내역', '기본 지급', '추가 지급', '추가 컷',
      '총 지급액', '원천징수', '입금액', '정산일', '신고일', ''];
    var tbody = el('tbody');
    list.forEach(function (p) {
      var r = calc(p);
      tbody.appendChild(el('tr', {}, [
        el('td', { text: p.year }),
        el('td', {}, [
          nameOf(p.assistantId),
          p.payBasis === 'net' ? el('span.chip-sm', { text: '세후', title: '세후(입금액) 기준' }) : null
        ]),
        el('td', { text: p.workDesc || '-' }),
        el('td.num', { text: U.num(p.basePay) }),
        el('td.num', { text: p.extraPay ? U.num(p.extraPay) : '' }),
        el('td.num', { text: p.extraCuts ? p.extraCuts + '컷' : '' }),
        el('td.num', { text: U.num(r.gross) }),
        el('td.num', {
          text: r.withheld ? U.num(r.withheld) : '',
          title: r.withheld ? '소득세 ' + U.num(r.incomeTax) + ' + 지방세 ' + U.num(r.localTax) : ''
        }),
        el('td.num.amount-in', { text: U.num(r.net) }),
        el('td', {}, [
          p.paidAt ? p.paidAt : el('span.chip-warn', { text: '미지급' })
        ]),
        el('td', { text: p.reportedAt || '' }),
        el('td', {}, [el('div.tx-actions', {}, [
          el('button.btn.btn-ghost.btn-icon.btn-sm', {
            text: '✎', title: '수정', onclick: function () { paymentDialog(p); }
          })
        ])])
      ]));
    });

    host.appendChild(el('div.tx-table-wrap', {}, [
      el('table.tx.pay', {}, [
        el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))]),
        tbody
      ])
    ]));

    host.appendChild(el('div.small.dim', {
      text: '작업자의 단가·세율을 나중에 바꿔도 이미 등록한 지급 기록은 바뀌지 않습니다.',
      style: { marginTop: '10px' }
    }));
  }

  /* ==========================================================  렌더 */

  var SUBS = [
    { id: 'people', label: '작업자', fn: renderPeople },
    { id: 'payments', label: '지급 내역', fn: renderPayments }
  ];

  var host = null;

  function render() {
    if (!host) return;
    U.clear(host);
    host.appendChild(el('div.subtabs', {}, SUBS.map(function (s) {
      return el('button.subtab' + (sub === s.id ? '.active' : ''), {
        text: s.label, onclick: function () { sub = s.id; render(); }
      });
    })));
    var body = el('div');
    host.appendChild(body);
    (SUBS.find(function (s) { return s.id === sub; }) || SUBS[0]).fn(body);
  }

  MW.assistants = {
    mount: function (node) { host = node; render(); },
    openSub: function (id) { sub = id; },
    calc: calc,
    grossUp: grossUp,
    taxOn: taxOn,
    DEFAULT_RATE: DEFAULT_RATE,
    all: all,
    byId: byId,
    nameOf: nameOf,
    payments: payments,
    ofYear: ofYear,
    years: years,
    paymentByTx: paymentByTx,
    paymentDialog: paymentDialog,
    totals: assistantTotals
  };
})();
