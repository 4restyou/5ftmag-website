// 5ft.mag 카메라 브랜드 사전 + 정규화
//
// 사용자 자유 입력 카메라명("Leica M6", "라이카 M6", "M6" 등)을 동일 모델로
// 묶기 위한 사전. 브랜드 prefix 를 제거한 뒤 model 키로 그룹화한다.
//
// 각 엔트리: [canonical, ...aliases]
//   - canonical: 표기 통일에 사용 (영문 소문자)
//   - aliases: 같은 브랜드를 가리키는 다양한 표기 (영문/한글, 약칭 등)
//
// 새 카메라가 들어오는데 사전에 없는 브랜드가 보이면 여기 추가하면 됨.
// (films.html 의 카메라 드롭다운에 "기타" 그룹으로 모임)
(function () {
  'use strict';

  const CAMERA_BRANDS = [
    ['leica',        '라이카'],
    ['canon',        '캐논'],
    ['nikon',        '니콘'],
    ['pentax',       '펜탁스', 'asahi pentax', 'asahi'],
    ['olympus',      '올림푸스'],
    ['minolta',      '미놀타'],
    ['contax',       '콘탁스'],
    ['yashica',      '야시카'],
    ['mamiya',       '마미야', 'mamiyaflex'],
    ['hasselblad',   '핫셀블라드', '핫셀'],
    ['rollei',       '롤라이', 'rolleiflex', 'rolleicord'],
    ['voigtländer',  'voigtlander', '보이그랜더', '보이그란더', '포익트랜더'],
    ['bronica',      '브로니카', 'zenza bronica', 'zenza'],
    ['fujifilm',     'fuji', '후지', '후지필름'],
    ['konica',       '코니카'],
    ['ricoh',        '리코'],
    ['lomography',   'lomo', '로모', '로모그래피'],
    ['polaroid',     '폴라로이드'],
    ['holga',        '홀가'],
    ['kodak',        '코닥'],
    ['plaubel',      '플라우벨'],
    ['linhof',       '린호프'],
    ['zeiss',        'zeiss ikon', '자이스', '자이스 이콘', 'carl zeiss', '짜이스'],
    ['zorki',        '조르키'],
    ['fed',          '페드'],
    ['kiev',         '키예프'],
    ['lubitel',      '류비텔'],
    ['smena',        '스메나'],
    ['praktica',     '프락티카'],
    ['exakta',       '엑사크타', '엑사타'],
    ['cosina',       '코시나'],
    ['chinon',       '치논'],
    ['vivitar',      '비비타'],
    ['petri',        '페트리'],
    ['topcon',       '톱콘'],
    ['bessa',        '베사'],
    ['pentax 67',    'pentax67'], // 의도적으로 모델까지 포함된 별칭 — 사용자가 "67" 만 적어도 매칭되도록은 X (model 그대로)
  ];

  // 입력 → [trim, lowercase, 공백 단일화, 괄호/점/슬래시 제거]
  function pre(s) {
    return String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/[+()/.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // input → { key, brand, original }
  //   - key: 브랜드 prefix 제거 후 공백 모두 제거한 model 식별자 (그룹 키)
  //   - brand: 인식된 canonical 브랜드명 (null 가능)
  //   - original: 원본 입력 그대로 (표기 후보용)
  function normalizeCamera(input) {
    const original = String(input ?? '');
    const trimmed = pre(original);
    if (!trimmed) return { key: '', brand: null, original };

    // 가장 긴 alias 우선 매칭 (예: 'asahi pentax' > 'asahi' > 'pentax')
    const flat = [];
    for (const [canonical, ...aliases] of CAMERA_BRANDS) {
      flat.push([canonical, canonical]);
      for (const a of aliases) flat.push([canonical, a.toLowerCase()]);
    }
    flat.sort((a, b) => b[1].length - a[1].length);

    let brand = null;
    let rest = trimmed;
    for (const [canonical, form] of flat) {
      if (rest === form) {
        // 브랜드만 입력된 경우 — model 없음
        return { key: '', brand: canonical, original };
      }
      if (rest.startsWith(form + ' ')) {
        rest = rest.slice(form.length + 1).trim();
        brand = canonical;
        break;
      }
    }
    // model: 공백/하이픈/언더스코어 제거
    const key = rest.replace(/[\s\-_]/g, '');
    return { key, brand, original };
  }

  // 같은 model 키의 후보 표기들 중 표시용 1개를 고름.
  // 정책: 가장 많이 등장한 원본 (count 동률이면 더 긴 것, 또 동률이면 첫 등장)
  function pickDisplay(originals) {
    if (!originals || !originals.length) return '';
    const tally = new Map();
    for (const s of originals) {
      const key = String(s ?? '').trim();
      if (!key) continue;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    let best = '';
    let bestScore = -1;
    for (const [s, c] of tally) {
      const score = c * 10000 + s.length;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  window.normalizeCamera = normalizeCamera;
  window.pickCameraDisplay = pickDisplay;
  window.CAMERA_BRANDS = CAMERA_BRANDS;
})();
