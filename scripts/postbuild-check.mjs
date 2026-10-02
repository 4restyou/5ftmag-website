// 빌드 뒤 배포본 검증 (validate-assets · qa-smoke).
//
// Netlify 빌드는 DB 를 읽어 피드와 페이지를 다시 만들기 때문에, 저장소만 보는 로컬·CI 와
// 결과가 다를 수 있다(관리 화면에서 숨긴 기사가 rss 에서 빠지는 등). 그 차이로 배포 자체가
// 막히면 사이트가 갱신되지 않으므로, 여기서는 실패해도 배포를 멈추지 않고 로그에
// ::warning:: 으로 크게 남긴다. 저장소 기준의 엄격한 검사는 CI(npm run ci)가 맡는다.
import { spawnSync } from 'node:child_process';

const steps = [
  ['validate-assets', 'scripts/validate-assets.mjs'],
  ['qa-smoke', 'scripts/qa-smoke.mjs'],
];
let failed = 0;
for (const [name, script] of steps) {
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed += 1;
    console.warn(`::warning::[postbuild] ${name} 실패 (exit ${r.status}). 배포는 계속한다. 위 출력에서 원인을 확인할 것.`);
  }
}
console.log(failed ? `postbuild: 검증 ${failed}건 실패 (경고만, 배포 계속)` : 'postbuild: 검증 통과');
