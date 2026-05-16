// 5ft.mag 카메라 브랜드 사전 + 정규화
//
// 사용자 자유 입력 카메라명("Leica M6", "라이카 M6", "M6" 등)을 동일 모델로
// 묶기 위한 사전. 브랜드 prefix 를 제거한 뒤 model 키로 그룹화한다.
//
// 처리 순서:
//   1) 입력 정리 (trim · lowercase · 공백 단일화 · 괄호/점/슬래시 제거)
//   2) 브랜드 + 공백 prefix 매칭  (예: "Leica M6")
//   3) 브랜드 + 공백 없는 prefix 매칭 — 단 남은 부분에 숫자 포함  (예: "니콘D750")
//   4) 브랜드 못 찾았으면 MODEL_BRAND_HINTS 로 모델→브랜드 추정 (예: "Lomomatic", "오토보이")
//
// 새 카메라 모델/브랜드가 들어오는데 사전에 없는 게 자주 보이면:
//   - 브랜드 자체가 누락 → CAMERA_BRANDS 에 추가
//   - 브랜드명 없이 모델만 적히는 게 자주 보임 → MODEL_BRAND_HINTS 에 추가
// (films.html 의 카메라 드롭다운에 "기타 (브랜드 미확인)" 그룹으로 모임)
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
  ];

  // 브랜드명 없이도 자주 입력되는 모델들 → 브랜드 추정
  // 형식: { brand, models: [normalized model 문자열들 (공백/하이픈 제거 후 비교)] }
  // 입력 모델이 여기 모델로 시작하면 매칭 (예: "lomomatic110" → "lomomatic" 으로 시작 → lomography)
  const MODEL_BRAND_HINTS = [
    {
      brand: 'lomography',
      models: [
        'lomomatic', 'lomoapparat',
        'lca', 'lcwide', 'lc120',
        'mca',  // 신규 Lomo MC-A
        'diana', 'dianababy', 'dianamini', 'dianaf',
        'fisheye', 'fisheye2',
        'spinner', 'spinner360',
        'konstruktor',
        'belair',
        'sprocketrocket',
        'sardina',
        'hydrochrome',
      ],
    },
    {
      brand: 'canon',
      models: [
        '오토보이', 'autoboy',
        'sureshot',
        'snappy',
      ],
    },
    {
      brand: 'nikon',
      models: [
        'nikonos',
        'nikkormat',
      ],
    },
    {
      brand: 'olympus',
      models: [
        'mjuii', 'muii', 'mju2', 'mu2',
        'penee', 'penft', 'penf', 'penep',
        'stylusepic',
      ],
    },
    {
      brand: 'contax',
      models: ['t2', 't3', 'g1', 'g2'],
    },
    {
      brand: 'rollei',
      models: ['rolleimatic', 'rollei35'],
    },
    {
      brand: 'fujifilm',
      models: ['klasse', 'natura', 'tiara', 'quicksnap', 'simpleace'],
    },
    {
      brand: 'kodak',
      models: ['ektar', 'instamatic', 'retina', 'h35'],
    },
    {
      brand: 'minolta',
      models: ['hi-matic', 'himatic', 'tc-1', 'tc1'],
    },
    {
      brand: 'pentax',
      models: ['espio', 'auto110', 'spotmatic', 'pentax17'],
    },
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

  // 모델 키 정규화 (alias 비교용) — 공백/하이픈/언더스코어 모두 제거
  function modelKey(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '');
  }

  // input → { key, brand, original }
  //   - key: 브랜드 prefix 제거 후 공백/하이픈 제거한 model 식별자 (그룹 키)
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
    let brandMatched = false;
    for (const [canonical, form] of flat) {
      if (rest === form) {
        // 브랜드만 입력된 경우 — model 없음
        return { key: '', brand: canonical, original };
      }
      // 1) 공백 있는 prefix
      if (rest.startsWith(form + ' ')) {
        rest = rest.slice(form.length + 1).trim();
        brand = canonical;
        brandMatched = true;
        break;
      }
      // 2) 공백 없는 prefix — 남은 부분에 숫자 포함된 경우만 (모델 코드 식별)
      //    "니콘D750", "leicaM6", "canonAE1" 같은 표기 흡수
      //    "nikonos" 처럼 같은 단어가 이어지는 경우는 숫자 없어서 매칭 X (→ MODEL_BRAND_HINTS 에서 처리)
      if (rest.startsWith(form) && rest.length > form.length) {
        const after = rest.slice(form.length).trim();
        if (after && /\d/.test(after)) {
          rest = after;
          brand = canonical;
          brandMatched = true;
          break;
        }
      }
    }

    // 3) 브랜드 매칭 실패 → MODEL_BRAND_HINTS 로 모델로부터 브랜드 추정
    if (!brandMatched) {
      const mk = modelKey(rest);
      outer: for (const hint of MODEL_BRAND_HINTS) {
        for (const m of hint.models) {
          const mNorm = modelKey(m);
          if (mk === mNorm || mk.startsWith(mNorm)) {
            brand = hint.brand;
            break outer;
          }
        }
      }
    }

    const key = modelKey(rest);
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
  window.MODEL_BRAND_HINTS = MODEL_BRAND_HINTS;
})();
