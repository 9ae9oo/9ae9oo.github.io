/* ==========================================================================
   MW.tax — 세무 참고자료 (원천세 · 부가가치세 · 종합소득세)
   · 이 화면은 신고를 대신하지 않습니다. 기획서 1장·15장에 따라 모든 계산 결과는
     "신고 확정값"이 아니라 "참고값"으로 표시합니다.
   · 새로 입력받는 것은 실제 신고·납부한 세액뿐이고, 나머지는 전부 파생 계산입니다.
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var sub = 'wt';                                   // 'wt' | 'vat' | 'income'
  var year = String(new Date().getFullYear());
  var halfKey = '';                                 // 'YYYY-1기'
  var host = null;

  function L() { return MW.store.state.ledger; }
  function A() { return MW.assistants; }

  function ref(text) { return el('span.chip-ref', { text: text || '참고값' }); }

  function warnBar() {
    return el('div.callout.warn.tax-warn', {}, [
      el('strong', { text: '이 화면의 숫자는 참고값입니다. ' }),
      '신고 확정값이 아닙니다. 실제 신고 전에 홈택스 또는 세무사를 통해 확인하세요. ',
      '이 프로그램은 세율 적용 여부나 신고 의무를 판단하지 않습니다.'
    ]);
  }

  function yearsOf() {
    var set = {};
    L().tx.forEach(function (t) { if (t.date) set[String(t.date).slice(0, 4)] = true; });
    L().payments.forEach(function (p) { if (p.year) set[String(p.year)] = true; });
    set[String(new Date().getFullYear())] = true;
    return Object.keys(set).sort().reverse();
  }

  function yearSelect(onChange) {
    var ys = yearsOf();
    if (ys.indexOf(year) < 0) year = ys[0];
    return el('select.field', {
      style: { width: 'auto' },
      onchange: function () { year = this.value; onChange(); }
    }, ys.map(function (y) {
      return el('option', { value: y, text: y + '년', selected: y === year });
    }));
  }

  /* ==========================================================  원천세 */

  /** 지급월('YYYY-MM')별로 원천징수액을 모읍니다 (정산일 기준) */
  function wtByMonth(list) {
    var map = {};
    list.forEach(function (p) {
      if (!p.paidAt) return;
      var m = String(p.paidAt).slice(0, 7);
      var r = A().calc(p);
      if (!map[m]) map[m] = { month: m, gross: 0, incomeTax: 0, localTax: 0, withheld: 0, net: 0, count: 0 };
      map[m].gross += r.gross;
      map[m].incomeTax += r.incomeTax;
      map[m].localTax += r.localTax;
      map[m].withheld += r.withheld;
      map[m].net += r.net;
      map[m].count += 1;
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }

  function paidTxFor(month) {
    return L().tx.find(function (t) { return t.wtMonth === month; }) || null;
  }

  /** 원천세를 실제로 납부한 날 누르는 버튼 — 세금 → 소득세 거래를 만듭니다 */
  function recordWtPayment(row) {
    var parts = row.month.split('-');
    var due = new Date(+parts[0], +parts[1], 10);        // 지급월 다음 달 10일 (기본값)
    var dueYmd = U.ymd(due);
    MW.shell.confirm(
      row.month.replace('-', '년 ') + '월 지급분 원천세 ' + U.won(row.withheld) +
      ' 을 “세금 → 소득세” 거래로 기록합니다.\n날짜는 ' + dueYmd + ' 로 넣어두니, 실제 납부일과 다르면 거래내역에서 고쳐 주세요.',
      function () {
        MW.store.update(function (s) {
          var c = MW.ledger.ensureCat(s, '세금', '소득세');
          s.ledger.tx.push({
            id: U.uid('tx'),
            date: dueYmd,
            typeId: c.typeId,
            catId: c.catId,
            amount: row.withheld,
            desc: row.month.replace('-', '년 ') + '월 지급분 원천세 납부',
            method: '계좌',
            memo: '어시스턴트 지급 ' + row.count + '건의 원천징수 합계',
            vatType: 'none',
            evidence: '',
            paymentId: null,
            wtMonth: row.month
          });
        });
        U.toast('납부 거래를 기록했습니다.');
      },
      '기록'
    );
  }

  function renderWt(body) {
    body.appendChild(warnBar());

    body.appendChild(el('div.lg-toolbar', {}, [
      yearSelect(render),
      el('span.small.dim', { text: '귀속연도 기준' }),
      el('span.spacer'),
      el('button.btn.btn-sm', {
        text: '지급 내역 열기',
        onclick: function () { MW.ledger.openTab('assistants', 'payments'); }
      })
    ]));

    var list = A().ofYear(year);
    if (!list.length) {
      body.appendChild(el('div.empty', { text: year + '년 지급 기록이 없습니다.\n어시스턴트 → 지급 내역에서 먼저 등록해 주세요.' }));
      return;
    }

    var tot = { gross: 0, incomeTax: 0, localTax: 0, withheld: 0, net: 0 };
    list.forEach(function (p) {
      var r = A().calc(p);
      tot.gross += r.gross; tot.incomeTax += r.incomeTax;
      tot.localTax += r.localTax; tot.withheld += r.withheld; tot.net += r.net;
    });

    // 기획서 9장의 흐름을 그대로 세로로 보여줍니다
    body.appendChild(el('div.card', {}, [
      el('h3', {}, ['원천징수 흐름 ', ref()]),
      el('div.flow', {}, [
        el('div.flow-row', {}, [el('span.k', { text: '신고용 총 지급액' }), el('span.v', { text: U.won(tot.gross) })]),
        el('div.flow-row', {}, [el('span.k', { text: '사업소득세' }), el('span.v.minus', { text: '− ' + U.won(tot.incomeTax) })]),
        el('div.flow-row', {}, [el('span.k', { text: '지방소득세 (소득세의 10%)' }), el('span.v.minus', { text: '− ' + U.won(tot.localTax) })]),
        el('div.flow-row.sum', {}, [el('span.k', { text: '원천징수 합계' }), el('span.v', { text: U.won(tot.withheld) })]),
        el('div.flow-row.total', {}, [el('span.k', { text: '실제 지급액' }), el('span.v', { text: U.won(tot.net) })])
      ]),
      el('div.small.dim', {
        text: '세율은 지급 건마다 직접 입력한 값을 씁니다. 이 프로그램은 3.3%를 모든 지급에 적용해야 한다고 판단하지 않습니다.'
      })
    ]));

    // 지급월별 납부 관리
    var rows = wtByMonth(list);
    if (rows.length) {
      var tbody = el('tbody');
      rows.forEach(function (r) {
        var tx = paidTxFor(r.month);
        tbody.appendChild(el('tr', {}, [
          el('td', { text: r.month.replace('-', '년 ') + '월' }),
          el('td.num', { text: r.count + '건' }),
          el('td.num', { text: U.num(r.gross) }),
          el('td.num', { text: U.num(r.incomeTax) }),
          el('td.num', { text: U.num(r.localTax) }),
          el('td.num', { text: U.num(r.withheld) }),
          el('td', {}, [
            tx
              ? el('span.chip-ok', { text: '납부 기록 ' + tx.date })
              : el('button.btn.btn-sm', { text: '납부 기록', onclick: function () { recordWtPayment(r); } })
          ])
        ]));
      });
      body.appendChild(el('div.card', {}, [
        el('h3', {}, ['지급월별 원천징수 ', el('span.muted', { text: '— 실제로 납부한 날 [납부 기록]을 누르면 장부에 세금 거래가 생깁니다' })]),
        el('div.tx-table-wrap', {}, [
          el('table.tx', {}, [
            el('thead', {}, [el('tr', {}, ['지급월', '건수', '총 지급액', '사업소득세', '지방소득세', '원천징수 합계', '납부'].map(function (h) {
              return el('th', { text: h });
            }))]),
            tbody
          ])
        ])
      ]));
    }

    // 작업자별 집계
    var byWho = {};
    list.forEach(function (p) {
      var r = A().calc(p);
      var k = p.assistantId || '-';
      if (!byWho[k]) byWho[k] = { gross: 0, withheld: 0, net: 0, count: 0 };
      byWho[k].gross += r.gross; byWho[k].withheld += r.withheld;
      byWho[k].net += r.net; byWho[k].count += 1;
    });
    var whoBody = el('tbody');
    Object.keys(byWho).forEach(function (k) {
      var v = byWho[k];
      whoBody.appendChild(el('tr', {}, [
        el('td', { text: A().nameOf(k) }),
        el('td.num', { text: v.count + '건' }),
        el('td.num', { text: U.num(v.gross) }),
        el('td.num', { text: U.num(v.withheld) }),
        el('td.num.amount-in', { text: U.num(v.net) })
      ]));
    });
    body.appendChild(el('div.card', {}, [
      el('h3', {}, ['작업자별 집계 ', ref()]),
      el('div.tx-table-wrap', {}, [
        el('table.tx', {}, [
          el('thead', {}, [el('tr', {}, ['작업자', '건수', '신고용 총 지급액', '원천징수 합계', '실제 지급액'].map(function (h) {
            return el('th', { text: h });
          }))]),
          whoBody
        ])
      ])
    ]));

    var unreported = list.filter(function (p) { return p.paidAt && !p.reportedAt; });
    if (unreported.length) {
      body.appendChild(el('div.callout', {}, [
        el('strong', { text: '신고일이 비어 있는 지급 ' + unreported.length + '건 ' }),
        '— 신고를 마쳤다면 지급 내역에서 “세금 신고일”을 적어두면 나중에 확인하기 쉽습니다.'
      ]));
    }
  }

  /* ==========================================================  부가가치세 */

  function halves() {
    var out = [];
    yearsOf().forEach(function (y) {
      out.push(y + '-2기');
      out.push(y + '-1기');
    });
    return out;
  }

  function halfRange(key) {
    var y = key.slice(0, 4);
    var first = key.slice(5) === '1기';
    return { from: y + (first ? '-01-01' : '-07-01'), to: y + (first ? '-06-30' : '-12-31') };
  }

  /** 총액에서 부가세를 1/11 로 역산합니다 (일반과세 10% 기준) */
  function splitVat(amount) {
    var vat = Math.round((+amount || 0) / 11);
    return { supply: (+amount || 0) - vat, vat: vat };
  }

  function renderVat(body) {
    body.appendChild(warnBar());

    var hs = halves();
    if (!halfKey || hs.indexOf(halfKey) < 0) {
      var now = new Date();
      halfKey = now.getFullYear() + '-' + (now.getMonth() < 6 ? '1기' : '2기');
      if (hs.indexOf(halfKey) < 0) halfKey = hs[0];
    }

    body.appendChild(el('div.lg-toolbar', {}, [
      el('select.field', {
        style: { width: 'auto' },
        onchange: function () { halfKey = this.value; render(); }
      }, hs.map(function (h) {
        return el('option', { value: h, text: h.replace('-', '년 '), selected: h === halfKey });
      })),
      el('span.small.dim', { text: '반기 기준' }),
      el('span.spacer')
    ]));

    var range = halfRange(halfKey);
    var inRange = L().tx.filter(function (t) {
      var d = String(t.date || '');
      return d >= range.from && d <= range.to;
    });

    var sales = [], buys = [], check = [];
    inRange.forEach(function (t) {
      var type = MW.ledger.typeById(t.typeId);
      var business = !!type && (type.kind === 'income' || type.name === '업무');
      if (!business) return;
      if (t.vatType === 'taxable') {
        (type.kind === 'income' ? sales : buys).push(t);
        if (!t.evidence || t.evidence === '없음') check.push(t);
      } else if (t.vatType !== 'exempt') {
        check.push(t);
      }
    });

    function totalOf(list) {
      return list.reduce(function (acc, t) {
        var s = splitVat(t.amount);
        acc.amount += +t.amount || 0;
        acc.supply += s.supply;
        acc.vat += s.vat;
        return acc;
      }, { amount: 0, supply: 0, vat: 0 });
    }
    var st = totalOf(sales), bt = totalOf(buys);

    body.appendChild(el('div.stat-grid', {}, [
      el('div.stat.income', {}, [
        el('div.label', { text: '과세 매출 (공급가액)' }),
        el('div.value', { text: U.won(st.supply) }),
        el('div.hint', { text: sales.length + '건 · 총액 ' + U.won(st.amount) })
      ]),
      el('div.stat.income', {}, [
        el('div.label', { text: '매출세액' }),
        el('div.value', { text: U.won(st.vat) })
      ]),
      el('div.stat.expense', {}, [
        el('div.label', { text: '과세 매입 (공급가액)' }),
        el('div.value', { text: U.won(bt.supply) }),
        el('div.hint', { text: buys.length + '건 · 총액 ' + U.won(bt.amount) })
      ]),
      el('div.stat.expense', {}, [
        el('div.label', { text: '매입세액' }),
        el('div.value', { text: U.won(bt.vat) })
      ])
    ]));

    body.appendChild(el('div.card', {}, [
      el('h3', {}, ['매출세액 − 매입세액 ', ref()]),
      el('div.flow', {}, [
        el('div.flow-row', {}, [el('span.k', { text: '매출세액' }), el('span.v', { text: U.won(st.vat) })]),
        el('div.flow-row', {}, [el('span.k', { text: '매입세액' }), el('span.v.minus', { text: '− ' + U.won(bt.vat) })]),
        el('div.flow-row.total', {}, [
          el('span.k', { text: st.vat - bt.vat >= 0 ? '납부(예상)' : '환급(예상)' }),
          el('span.v', { text: U.won(Math.abs(st.vat - bt.vat)) })
        ])
      ]),
      el('div.small.dim', {
        text: '거래 금액을 부가세 포함 총액으로 보고 1/11 로 역산한 값입니다. ' +
              '실제 신고는 사업자 유형과 공제 요건에 따라 달라집니다.'
      })
    ]));

    var vatRec = L().vat[halfKey] || {};
    var vatMemo = el('input.field', { value: vatRec.memo || '', placeholder: '신고 메모 (선택)' });
    body.appendChild(el('div.card', {}, [
      el('h3', {}, ['실제 신고 · 납부 세액 ', el('span.muted', { text: '— 홈택스에서 확정된 값을 적어두는 칸입니다' })]),
      el('div.form-grid', {}, [
        el('div.form-row', {}, [
          el('label', { text: halfKey.replace('-', '년 ') + ' 납부 세액' }),
          el('input.field', {
            type: 'text', inputmode: 'numeric', placeholder: '0',
            value: vatRec.amount ? U.num(vatRec.amount) : '',
            onchange: function () {
              var v = U.parseNum(this.value);
              this.value = v ? U.num(v) : '';
              var memoVal = vatMemo.value;
              MW.store.update(function (s) {
                if (v || memoVal) s.ledger.vat[halfKey] = { amount: v, memo: memoVal };
                else delete s.ledger.vat[halfKey];
              });
            }
          })
        ]),
        el('div.form-row', {}, [
          el('label', { text: '메모' }), vatMemo
        ])
      ])
    ]));
    vatMemo.addEventListener('change', function () {
      var m = this.value;
      MW.store.update(function (s) {
        var cur = s.ledger.vat[halfKey] || { amount: 0, memo: '' };
        cur.memo = m;
        if (cur.amount || cur.memo) s.ledger.vat[halfKey] = cur;
        else delete s.ledger.vat[halfKey];
      });
    });

    body.appendChild(el('div.card', {}, [
      el('h3', {}, ['확인이 필요한 거래 ', el('span.muted', { text: check.length + '건' })]),
      el('div.small.dim', {
        text: '사업 관련 거래(수입 · 업무)인데 부가세 구분이 “해당없음”이거나 과세인데 증빙이 없는 거래입니다.',
        style: { marginBottom: '10px' }
      }),
      check.length
        ? MW.ledger.txTable(function (tbody) {
          check.forEach(function (t) { tbody.appendChild(MW.ledger.txRow(t)); });
        })
        : el('div.empty', { text: '확인이 필요한 거래가 없습니다.' })
    ]));
  }

  /* ==========================================================  종합소득세 */

  function renderIncome(body) {
    body.appendChild(warnBar());

    body.appendChild(el('div.lg-toolbar', {}, [
      yearSelect(render),
      el('span.small.dim', { text: '연도별 신고 참고자료 — 이 화면에서는 아무것도 입력하지 않습니다' }),
      el('span.spacer')
    ]));

    var list = MW.ledger.txInYear(year);
    var income = 0, workCost = 0, otherExpense = 0, taxPaid = 0;
    var byCat = {};
    list.forEach(function (t) {
      var type = MW.ledger.typeById(t.typeId);
      var amt = +t.amount || 0;
      if (!type) return;
      if (type.kind === 'income') { income += amt; }
      else if (type.name === '업무') {
        workCost += amt;
        var k = MW.ledger.catName(t);
        byCat[k] = (byCat[k] || 0) + amt;
      } else if (type.name === '세금') { taxPaid += amt; }
      else { otherExpense += amt; }
    });

    var pays = A().ofYear(year);
    var payGross = 0, payWithheld = 0;
    pays.forEach(function (p) {
      var r = A().calc(p);
      payGross += r.gross; payWithheld += r.withheld;
    });

    body.appendChild(el('div.stat-grid', {}, [
      el('div.stat.income', {}, [
        el('div.label', { text: '사업 수입' }), el('div.value', { text: U.won(income) }),
        el('div.hint', { text: '타입이 “수입”인 거래 합계' })
      ]),
      el('div.stat.expense', {}, [
        el('div.label', { text: '업무 지출 (필요경비 참고)' }), el('div.value', { text: U.won(workCost) }),
        el('div.hint', { text: '타입이 “업무”인 거래 합계' })
      ]),
      el('div.stat', {}, [
        el('div.label', { text: '어시스턴트 인건비' }), el('div.value', { text: U.won(payGross) }),
        el('div.hint', { text: '원천징수 전 총 지급액 · ' + pays.length + '건' })
      ]),
      el('div.stat', {}, [
        el('div.label', { text: '원천징수한 세액' }), el('div.value', { text: U.won(payWithheld) }),
        el('div.hint', { text: '어시스턴트 지급에서 뗀 세금' })
      ])
    ]));

    body.appendChild(el('div.card', {}, [
      el('h3', {}, [year + '년 집계 ', ref()]),
      el('div.flow', {}, [
        el('div.flow-row', {}, [el('span.k', { text: '사업 수입' }), el('span.v', { text: U.won(income) })]),
        el('div.flow-row', {}, [el('span.k', { text: '업무 지출 (필요경비 참고)' }), el('span.v.minus', { text: '− ' + U.won(workCost) })]),
        el('div.flow-row.sum', {}, [el('span.k', { text: '차액' }), el('span.v', { text: U.won(income - workCost) })]),
        el('div.flow-row', {}, [el('span.k', { text: '납부한 세금 (세금 타입 거래)' }), el('span.v', { text: U.won(taxPaid) })]),
        el('div.flow-row', {}, [el('span.k', { text: '사업 외 지출 (생활비 등)' }), el('span.v', { text: U.won(otherExpense) })])
      ]),
      el('div.small.dim', {
        text: '차액은 소득금액이 아닙니다. 필요경비 인정 범위는 사업자 유형과 지출 성격에 따라 달라집니다.'
      })
    ]));

    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    if (cats.length) {
      body.appendChild(el('div.card', {}, [
        el('h3', { text: '업무 지출 대분류별' }),
        el('div.tx-table-wrap', {}, [
          el('table.tx', {}, [
            el('thead', {}, [el('tr', {}, [el('th', { text: '대분류' }), el('th', { text: '합계' })])]),
            el('tbody', {}, cats.map(function (k) {
              return el('tr', {}, [el('td', { text: k }), el('td.num', { text: U.num(byCat[k]) })]);
            }))
          ])
        ])
      ]));
    }

    body.appendChild(el('div.callout', {}, [
      el('strong', { text: '이 화면이 모으지 못하는 것: ' }),
      '내 수입에서 지급처가 원천징수해 간 세액(원고료 3.3% 등)은 이 프로그램에 기록되지 않습니다. ',
      '신고할 때는 지급처가 준 지급명세서나 홈택스의 지급명세서 조회를 함께 확인하세요.'
    ]));
  }

  /* ==========================================================  렌더 */

  var SUBS = [
    { id: 'wt', label: '원천세', fn: renderWt },
    { id: 'vat', label: '부가가치세', fn: renderVat },
    { id: 'income', label: '종합소득세', fn: renderIncome }
  ];

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

  MW.tax = {
    mount: function (node) { host = node; render(); },
    openSub: function (id) { sub = id; },
    splitVat: splitVat
  };
})();
