"use client";

// 현장관리 서브 내비 — docs/plans/dailywork-merge-ui.md 6·7장.
//
// 원본의 Sidebar·Topbar·BottomNav 를 대신한다. shrimp365 셸(사이드바·헤더·하단 내비) 안의
// <main> 맨 위에 놓이고, (app)/layout.tsx 가 서버에서 계산한 메뉴·건수·사업장을 받는다.
//
//   1행  사업장 선택(2곳 이상이면 셀렉트)            [일보 작성]  ← lg 이상
//   2행  업무 … | 공정·보고 … | 관리 …   ← 모바일은 가로 스크롤, lg 이상은 줄바꿈
//   (모바일) 화면 오른쪽 아래 플로팅 "일보 작성" — 셸 하단 내비(h-16) 바로 위
import { Building2, PencilLine } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/work/ui/button";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/work/nav";
import { NavIcon } from "./nav-icon";
import { ProjectSwitcher } from "./project-switcher";

const GROUPS: readonly NavItem["group"][] = ["업무", "공정·보고", "관리"];
const WRITE_HREF = "/daumlabs/work/reports/new";
/** 일보를 쓰고 있는 화면에서는 "일보 작성" 버튼을 숨긴다(원본 BottomNav 와 같은 조건). */
const WRITING = /^\/daumlabs\/work\/reports\/(new|[^/]+\/edit)$/;

export function WorkNav({
  items,
  counts,
  projects,
  currentProjectId,
  canWrite,
}: {
  items: NavItem[];
  counts: Record<string, number>;
  projects: { id: string; name: string }[];
  currentProjectId: string | null;
  canWrite: boolean;
}) {
  const pathname = usePathname() ?? "";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const showWrite = canWrite && !WRITING.test(pathname);

  // 모바일에서 활성 탭이 화면 밖에 있으면 가운데로 데려온다. scrollIntoView 는 바깥
  // 스크롤 컨테이너(<main>)까지 움직일 수 있어 탭 줄의 scrollLeft 만 직접 바꾼다.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !active || scroller.scrollWidth <= scroller.clientWidth) return;
    const box = scroller.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    scroller.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
  }, [pathname]);

  return (
    <>
      <div className="no-print mb-4 space-y-2 print:hidden lg:mb-6">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Building2 className="size-4 shrink-0 text-brand-fg" aria-hidden />
            <ProjectSwitcher projects={projects} current={currentProjectId ?? ""} />
          </div>
          {showWrite && (
            <Button asChild className="hidden lg:inline-flex">
              <Link href={WRITE_HREF}>
                <PencilLine />
                일보 작성
              </Link>
            </Button>
          )}
        </div>

        <nav
          aria-label="현장관리 메뉴"
          ref={scrollerRef}
          className="-mx-4 flex items-center gap-x-2 gap-y-1 overflow-x-auto border-b border-border px-4 py-1.5 max-lg:[scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 max-lg:[&::-webkit-scrollbar]:hidden"
        >
          {GROUPS.map((group) => {
            const list = items.filter((item) => item.group === group);
            if (list.length === 0) return null;
            return (
              <ul
                key={group}
                aria-label={group}
                className="flex shrink-0 items-center gap-1 border-l border-border pl-2 first:border-l-0 first:pl-0"
              >
                {list.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const count = counts[item.href];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors lg:h-9",
                          active ? "bg-brand-a10 text-brand-fg" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <NavIcon name={item.icon} className="size-4 shrink-0" />
                        {item.label}
                        {count ? (
                          <span className="min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                            {count > 99 ? "99+" : count}
                            <span className="sr-only">건</span>
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            );
          })}
        </nav>
      </div>

      {/* 모바일 플로팅 버튼. 셸 하단 내비(높이 4rem, z-40) 위 0.75rem. 인쇄에서는
          app/globals.css 의 `.fixed { display: none }` 이 지운다. */}
      {showWrite && (
        <Link
          href={WRITE_HREF}
          aria-label="오늘 작업일보 작성"
          className="no-print fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-semibold text-white shadow-lg transition-colors active:bg-brand-hover lg:hidden"
        >
          <PencilLine className="size-5" aria-hidden />
          일보 작성
        </Link>
      )}
    </>
  );
}
