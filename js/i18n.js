// 영문판(/en/) 문구·경로 도우미.
//
// 영문 페이지(<html lang="en">)만 이 파일을 불러온다. 한국어 페이지는 불러오지 않으므로,
// 문구를 쓰는 쪽은 아래 한 줄로 한국어 기본값을 갖고 시작한다.
//   var i18n = window.i18n || { isEn: false, t: function (ko) { return ko; }, url: function (u) { return u; } };
// 문구는 한 자리에 두 언어를 함께 적는다: i18n.t('최근 글', 'Latest')
(function () {
  var isEn = document.documentElement.lang === 'en';

  // 영문판이 있는 페이지. 여기 없는 페이지(장터·구매·이북 등)는 한국어판으로 보낸다.
  var EN_PAGES = /^\/(?:index\.html)?$|^\/(?:stories|films|labs|about)\.html$|^\/(?:stories|film|labs)\/[^/]+\.html$/;

  function url(href) {
    if (!isEn || typeof href !== 'string') return href;
    var m = href.match(/^(\/[^?#]*)(.*)$/);
    if (!m || m[1].indexOf('/en/') === 0) return href;
    return EN_PAGES.test(m[1]) ? '/en' + m[1] + m[2] : href;
  }

  window.i18n = {
    isEn: isEn,
    lang: isEn ? 'en' : 'ko',
    locale: isEn ? 'en-US' : 'ko-KR',
    t: function (ko, en) { return isEn && en != null ? en : ko; },
    url: url,
  };
})();
