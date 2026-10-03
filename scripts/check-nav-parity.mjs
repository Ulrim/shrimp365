// 사이드바(데스크톱)와 하단 메뉴(모바일)가 같은 곳으로 갈 수 있는지 본다.
//
//     node scripts/check-nav-parity.mjs
//
// 왜 있나: `/vision`(개체수)이 사이드바에만 추가되어 **휴대폰에서는 그 화면에
// 갈 길이 아예 없었다.** 농장에서 쓰는 사람은 대부분 휴대폰이라, 기능을 만들어
// 두고도 아무도 쓸 수 없는 상태였다. 타입 검사도 린트도 이것을 잡지 못한다 —
// 두 파일 각각은 완벽하게 옳기 때문이다.
//
// 공개 콘텐츠(게시판·카드뉴스)는 localizedHref() 로 감싸 있어 정적으로 읽히지
// 않으므로 제외한다. 권한에 따라 붙는 항목(관제센터·관리자)도 제외한다.
import { readFileSync } from 'node:fs';

const EXCLUDE = new Set(['/control', '/admin']);

/** 목록의 `{ href: "/x" }` 과 JSX 의 `href="/x"` 를 모두 긁는다.
 *  사이드바는 홈을 목록이 아니라 <NavItem href="/home"> 으로 따로 둔다 —
 *  한쪽 꼴만 보면 그것을 "없는 항목" 으로 잘못 짚는다. */
function hrefs(path) {
  const src = readFileSync(path, 'utf8');
  const found = [
    ...[...src.matchAll(/href:\s*"(\/[^"]*)"/g)].map(m => m[1]),
    ...[...src.matchAll(/href="(\/[^"]*)"/g)].map(m => m[1]),
    // href={withAgri("/x")} 꼴. 안 보면 새 링크를 "없는 항목" 으로 잘못 짚는다.
    ...[...src.matchAll(/href=\{withAgri\("(\/[^"]*)"\)\}/g)].map(m => m[1]),
  ];
  return new Set(found.filter(h => !EXCLUDE.has(h)));
}

const side = hrefs('components/layout/sidebar.tsx');
const bottom = hrefs('components/layout/bottom-nav.tsx');

// 하단 메뉴에는 기록(/record/**)이 첫 줄에 따로 있고 사이드바는 별도 묶음에
// 둔다 — 양쪽에 다 있으므로 차집합에 걸리지 않는다.
const missing = [...side].filter(h => !bottom.has(h));
const extra = [...bottom].filter(h => !side.has(h));

let bad = false;
if (missing.length) {
  bad = true;
  console.log('✗ 하단 메뉴(모바일)에 없는 항목 — 휴대폰에서 갈 길이 없습니다:');
  for (const h of missing) console.log(`    ${h}`);
}
if (extra.length) {
  bad = true;
  console.log('✗ 사이드바에 없는 항목:');
  for (const h of extra) console.log(`    ${h}`);
}
if (!bad) console.log(`✓ 두 메뉴가 같은 ${side.size}곳을 가리킵니다.`);
process.exit(bad ? 1 : 0);
