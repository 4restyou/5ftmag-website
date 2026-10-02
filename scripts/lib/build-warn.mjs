// 빌드 스크립트가 DB 조회에 실패했을 때 남기는 경고.
// 빌드는 멈추지 않고(기존 파일 유지, exit 0) 넘어가므로, 로그에서 눈에 띄도록
// GitHub Actions 주석 형식(::warning::) 한 줄로 stderr 에 남긴다.
export function warnBuild(script, message) {
  console.warn(`::warning::[${script}] ${message}`);
}
