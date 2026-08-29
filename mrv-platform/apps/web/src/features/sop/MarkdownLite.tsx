/*
 * 최소 마크다운 렌더러(SOP 본문 전용). 외부 라이브러리 미도입(과설계 금지, 위임 지시).
 * 지원: #/##/### 제목, -/* 목록, **굵게**, 빈 줄 구분 단락. 그 외 문법(표/링크/코드블록
 * 등)은 원문 그대로(이스케이프된) 텍스트로 출력한다 — SOP 콘텐츠는 절차 설명 위주라
 * 이 정도로 충분(과설계 금지).
 */
import { Fragment } from "react";

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; lines: string[] };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraphBuf: string[] = [];
  let listBuf: string[] = [];

  function flushParagraph() {
    if (paragraphBuf.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraphBuf });
      paragraphBuf = [];
    }
  }
  function flushList() {
    if (listBuf.length > 0) {
      blocks.push({ kind: "list", items: listBuf });
      listBuf = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    const listMatch = /^[-*]\s+(.*)$/.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      });
    } else if (listMatch) {
      flushParagraph();
      listBuf.push(listMatch[1]);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphBuf.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** **굵게** 인라인 구문만 지원(단순 정규식 분할, 중첩 없음). */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    if (m) {
      return (
        <strong key={i} className="font-semibold text-fg">
          {m[1]}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-lg font-bold text-fg mt-2",
  2: "text-base font-bold text-fg mt-2",
  3: "text-sm font-semibold text-fg mt-1",
};

export function MarkdownLite({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);

  if (blocks.length === 0) {
    return <p className="text-sm text-muted">본문이 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          const Tag = (`h${block.level}` as unknown) as "h1" | "h2" | "h3";
          return (
            <Tag key={i} className={HEADING_CLASS[block.level]}>
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm text-fg">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line text-sm text-fg">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
