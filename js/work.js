/* ==========================================================================
   MW.work — 작업 관리 (작품 → 회차 → 컷 공정 체크보드)
   기획서 PRD v1 5장. 이번 단계에서는 자리만 잡아두고, 체크보드는 3단계에서
   채웁니다. 데이터 구조는 미리 정의해 두어 저장 스키마가 흔들리지 않게 합니다.

     works: [{ id, name, episodes: [
       { id, number, cutCount, processes: [
         { id, name, order, completedCuts: [1,2,3] }
       ] }
     ] }]
   ========================================================================== */
window.MW = window.MW || {};

(function () {
  'use strict';
  var U = MW.util, el = U.el;

  var root = null;

  function render() {
    if (!root) return;
    U.clear(root);

    root.appendChild(el('div.callout', {}, [
      el('strong', { text: '준비 중 — 3단계에서 만듭니다. ' }),
      '작품 → 회차 → 컷 단위 공정 체크보드(선화 · 밑색 · 명암 · 후보정 …)가 이 자리에 들어옵니다. ',
      '공정 접기/펼치기, 추가·삭제, 순서 변경까지 포함합니다.'
    ]));

    root.appendChild(el('div.card', {}, [
      el('h3', { text: '이렇게 만들 예정입니다' }),
      el('pre.work-sketch', {
        text: '▾ 선화\n' +
              '  1~10    □ □ □ □ □ □ □ □ □ □\n' +
              '  11~20   □ □ □ □ □ □ □ □ □ □\n' +
              '  61~63   □ □ □\n\n' +
              '▸ 밑색\n' +
              '▸ 명암\n' +
              '▸ 후보정\n\n' +
              '                       ＋ 공정 추가'
      }),
      el('div.small.dim', {
        text: '회차마다 전체 컷 수를 입력하면 10칸씩 줄이 자동으로 생깁니다. ' +
              '진행률·통계는 기획서 결정대로 넣지 않습니다.',
        style: { marginTop: '10px' }
      })
    ]));
  }

  MW.work = {
    mount: function (node) { root = node; render(); },
    render: render
  };
})();
