/* 푸터 연도만 현재 날짜에 맞춥니다. 핵심 페이지는 JavaScript 없이도 모두 읽고 다운로드할 수 있습니다. */
(function () {
  'use strict';

  var year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());
}());
