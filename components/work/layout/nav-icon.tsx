import {
  Bell, Building2, CalendarDays, ClipboardCheck, ClipboardList, FileChartColumn, FileStack, History,
  LayoutDashboard, ListChecks, SquareChartGantt, UserCog, Users,
} from "lucide-react";
import type { NavItem } from "@/lib/work/nav";

// 원본의 GanttChartSquare·FileBarChart 는 이 저장소의 lucide-react(1.x)에서
// SquareChartGantt·FileChartColumn 으로 이름이 바뀌었다. 같은 그림이다.
const ICONS = {
  dashboard: LayoutDashboard,
  report: ClipboardList,
  review: ClipboardCheck,
  task: ListChecks,
  calendar: CalendarDays,
  progress: SquareChartGantt,
  consolidated: FileStack,
  output: FileChartColumn,
  bell: Bell,
  history: History,
  users: Users,
  building: Building2,
  user: UserCog,
} as const;

export function NavIcon({ name, className }: { name: NavItem["icon"]; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}
