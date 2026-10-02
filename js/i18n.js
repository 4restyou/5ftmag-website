// 언어판(한국어 · /en/ 영문 · /ja/ 일문) 문구·경로 도우미.
//
// 모든 페이지가 head 에서 다른 스크립트보다 먼저 이 파일을 싣는다. 한국어 페이지에선 lang='ko', isEn=false,
// t(ko)=ko, url(u)=u 를 돌려주므로, 문구를 쓰는 쪽은 대체값 없이 `const i18n = window.i18n;` 로 시작한다.
// (예외: 이 파일을 싣지 않는 기사 편집 화면에도 실리는 site-common.js · image-processor.js 는 대체값을 남긴다.)
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
