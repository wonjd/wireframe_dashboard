// 이 레포는 pnpm 워크스페이스입니다. npm/yarn 으로 설치하면
// 루트 node_modules 에 hoist 된 실디렉터리가 pnpm 심링크 구조 위에 겹쳐서
// "Cannot find module" 이 무작위로 뜹니다. 설치 시점에 막습니다.
const ua = process.env.npm_config_user_agent ?? "";
if (!ua.startsWith("pnpm/")) {
  console.error(`
  이 레포는 pnpm 전용입니다.

    감지된 패키지 매니저: ${ua.split(" ")[0] || "unknown"}
    사용할 명령:          pnpm install

  이유: packages/* 가 "workspace:*" 프로토콜을 쓰는데 npm 은 이를
        EUNSUPPORTEDPROTOCOL 로 거부합니다.
`);
  process.exit(1);
}
