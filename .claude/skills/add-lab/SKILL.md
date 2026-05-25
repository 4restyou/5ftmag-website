---
name: add-lab
description: 5ft.mag 필름 현상소(labs) 항목을 data/labs.json 에 추가·수정하고 배포까지 진행. 사용자가 현상소 정보나 네이버 지도 캡처를 주며 "현상소 추가 / 업데이트 / 가격 갱신 / 중복 정리"를 요청할 때 사용.
---

# 현상소(labs) 항목 추가·수정 → 배포

`data/labs.json` 에 필름 현상소를 추가/수정하고 PR·머지·배포까지 한 번에 처리하는 플레이북.
(근거: 2026-05-24 세션 PR #230·#233·#235·#236·#238·#239·#234 등 6회 이상 반복, 매번 일회용 스크립트를 재작성하며 삽입 위치·중복·문체 오류 발생)

## 데이터 위치·스키마
- 파일: `data/labs.json` → `{ "labs": [ { … } ] }`
- 항목은 **9개 필드 고정 순서**: `name, region, address, lat, lng, scanRes, features, url, prices`
- `prices` 중첩 구조(모든 칸 존재, 값 없으면 null):
  - `color` / `bw` / `slide`: 각각 `{ "120": {basic,high}, "135": {basic,high} }`
  - `cinema`(영화용): `{ "135": {basic,high} }`  ← 120 없음
  - `etc`: `{ "110": null, "aps": null }`  (문자열/숫자 허용)

## 가격 매핑 규칙
- 카드에 노출되는 값은 종류별 **`135.basic` 한 줄**(컬러/흑백/슬라이드/영화용). 그 값이 대표가격이 되게 넣을 것.
- 화질: `basic`=일반/기본, `high`=고해상. 중간화질 칸은 없음 → basic/high 두 단계만 사용.
- 종류 매핑: C-41=`color`, 흑백(D-76)=`bw`, 슬라이드(E-6)=`slide`, 영화용(ECN-2)=`cinema`(135만), APS/110=`etc`.
- 숫자는 **콤마 없이** 저장(표시는 JS 가 처리). "현상+스캔" 가격을 대표로, 메뉴가 단일가면 basic 에만.

## 일회용 적용 스크립트 (/tmp 에 작성 후 `node` 실행, 커밋하지 말 것)
```js
import fs from 'fs';
const PATH = 'data/labs.json';
const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
const tier = (b=null,h=null)=>({basic:b,high:h});
function P(s={}){const mk=o=>{const r={'120':tier(),'135':tier()};if(o)for(const k of Object.keys(o))r[k]=tier(o[k][0]??null,o[k][1]??null);return r;};
  return {color:mk(s.color),bw:mk(s.bw),slide:mk(s.slide),
    cinema:{'135':s.cinema&&s.cinema['135']?tier(s.cinema['135'][0]??null,s.cinema['135'][1]??null):tier()},
    etc:{'110':s.etc?.['110']??null,aps:s.etc?.aps??null}};}
const find = n => data.labs.find(l=>l.name===n);

// 신규: 가나다 순서상 '앞 이웃' 이름 뒤에 삽입 (localeCompare 는 라틴 이름 때문에 어긋나니 앵커 방식 사용)
function insertAfter(anchorName, lab){
  const i = data.labs.findIndex(l=>l.name===anchorName);
  if(i<0){console.log('앵커 못 찾음:',anchorName);process.exit(1);}
  data.labs.splice(i+1,0,lab);
}
// 예) insertAfter('보다봄', { name:'부광사진관', region:'울산', address:'…', lat:null,lng:null,
//        scanRes:null, features:'…', url:'…', prices:P({color:{'135':[8000,null]}}) });
// 수정) const l=find('고래사진관'); l.prices=P({color:{'135':[6000,null],'120':[7000,null]}, bw:{'135':[8000,null]}, ...}); l.features='…';

fs.writeFileSync(PATH, JSON.stringify(data,null,2)+'\n');
console.log('총', data.labs.length);
```

## 추가(신규) 주의
- **가나다 위치**에 삽입: 같은 초성의 기존 항목을 앵커로 그 뒤에 넣는다(예: 부광→`보다봄` 뒤, 세하포토랩→`선릉사진관` 뒤). 배열 뒤쪽은 정렬이 흐트러져 있으니 앵커의 다음 이웃을 확인할 것.
- `lat`/`lng` 는 **null** 로 두고, 머지 후 좌표 워크플로로 채운다(아래 배포 참고).
- `scanRes`·`url` 없으면 null. 전화번호 필드는 스키마에 없음(넣지 말 것).

## 수정(기존) 주의
- 이름으로 찾아 **필요한 필드만** 바꾼다(전체 prices 재생성 시 기존 비가격 값 손실 주의 → targeted 수정 권장).
- **동명/중복 주의**: `필름로그`(드롭포인트 2곳)·`포토닉스`(중복 2건) 같은 사례는 주소로 구분하고, 진짜 중복은 splice 로 1건만 남겨 정보 통합.
- 주소가 바뀌면 좌표가 무효 → `lat`/`lng` 를 null 로 비우고 재지오코딩.

## 검증
1. `node -e "JSON.parse(require('fs').readFileSync('data/labs.json','utf8'))"`
2. `npm run validate` (labs.json 이 검사 대상에 포함됨)
3. em-dash(—) 금지: `grep -n '—' data/labs.json` → 없어야 함(가운뎃점·쉼표·괄호로 대체)

## features 문체
- 20년차 편집부 보고서체로 **간결**하게. 구어체·내부 메모·불확실 표현("정보 부족", "확인 불가", "~것 같음") 금지.
- 구분자 `//`·`+` → 쉼표·가운뎃점·마침표. em-dash 금지.

## 배포
- `claude/<slug>` 브랜치 → 커밋 → `git push -u origin <branch>` → PR.
- CI(`validate`) 통과 후 **squash 머지**(커밋 메시지 = PR 제목 + ` (#NN)`). 데이터 전용 PR 은 Playwright 를 건너뛰어 CI 가 빠르다(#241).
- 초반 단계에서 ~20초 만에 실패하면 일시적 결함이니 빈 커밋으로 재실행(#247·#250 사례).
- main 직접 커밋 금지.

## 신규 좌표 채우기 (추가 항목이 있을 때만)
- 머지 후 **Actions → Geocode labs → Run workflow**(브랜치 main) 실행.
- 스크립트는 비어 있는 lat/lng 만 채우고(`scripts/geocode-labs.mjs`), 자동으로 좌표 PR 을 생성한다(저장소 설정에서 Actions PR 생성 권한이 켜져 있어야 함).
- 그 PR 의 CI 통과 후 이어서 squash 머지.
