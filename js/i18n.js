// 외국어판(/en/ 영문, /ja/ 일문) 문구·경로 도우미.
//
// 외국어 페이지(<html lang="en"> · <html lang="ja">)만 이 파일을 불러온다. 한국어 페이지는 불러오지 않으므로,
// 문구를 쓰는 쪽은 아래 한 줄로 한국어 기본값을 갖고 시작한다.
//   var i18n = window.i18n || { isEn: false, t: function (ko) { return ko; }, url: function (u) { return u; } };
// 문구는 한 자리에 세 언어를 함께 적는다: i18n.t('최근 글', 'Latest', '最新記事')
// 일본어가 비어 있으면 영어, 영어도 비어 있으면 한국어를 돌려준다.
//
// isEn 은 "한국어판이 아님" 이다(영문·일문 둘 다 true). 가격 표기·외국어 경로처럼 한국어판과 갈리는 자리를
// 이미 isEn 으로 나눠 두었기 때문이다. 영어와 일본어를 나눠야 하는 자리는 lang 을 본다.
(function () {
  var lang = document.documentElement.lang === 'ja' ? 'ja' : document.documentElement.lang === 'en' ? 'en' : 'ko';
  var foreign = lang !== 'ko';

  // 외국어판이 있는 페이지. 여기 없는 페이지(관리 화면 등)는 한국어판으로 보낸다.
  var PAGES = /^\/(?:index\.html)?$|^\/(?:stories|films|labs|about|books|market|shop|search|me|authors|ebook-read|unsubscribe)\.html$|^\/(?:stories|film|labs|authors)\/[^/]+\.html$|^\/legal\/(?:terms|privacy|refund|copyright)\.html$/;

  function url(href) {
    if (!foreign || typeof href !== 'string') return href;
    var m = href.match(/^(\/[^?#]*)(.*)$/);
    if (!m || /^\/(?:en|ja)\//.test(m[1])) return href;
    return PAGES.test(m[1]) ? '/' + lang + m[1] + m[2] : href;
  }

  window.i18n = {
    isEn: foreign,
    lang: lang,
    locale: { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' }[lang],
    t: function (ko, en, ja) {
      if (lang === 'ja' && ja != null) return ja;
      return foreign && en != null ? en : ko;
    },
    url: url,
  };
})();
