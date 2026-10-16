// 사용자 상세(/admin/users/[id]) 응답 모양 — API(app/api/admin/users/[id])와 화면,
// 목데이터가 함께 쓴다. 서버 전용 코드가 없어 API 쪽에서는 `import type` 으로만 읽는다.

export type TankStatusCounts = {
  total: number
  active: number
  warning: number
  danger: number
  inactive: number
}

export interface AdminUserDetail {
  account: {
    id: string
    name: string
    email: string
    role: string
    plan: string
    /** profiles.ui_mode — 컬럼이 아직 없으면 null. */
    ui_mode: "shrimp" | "agriculture" | null
    created_at: string
    last_sign_in_at: string | null
    email_confirmed: boolean
    /** 로그인 방식(email·google·kakao·naver …). 중복 없이, 첫 값이 가입 방식. */
    providers: string[]
    is_super_admin: boolean
  }
  farms: {
    id: string
    name: string
    farm_type: "shrimp" | "agriculture"
    location: string
    /** 좌표 유무 — farms 에 좌표 컬럼이 없으면 null. */
    has_coords: boolean | null
    created_at: string | null
    tanks: TankStatusCounts
  }[]
  devices: {
    id: string
    name: string
    farm_id: string
    farm_name: string
    tank_id: string
    tank_name: string
    active: boolean
    serial: string | null
    version: string | null
    last_seen_at: string | null
    online: boolean
  }[]
  alerts: {
    /** 미해결 알림 수. 조회 실패면 null. */
    open_count: number | null
    recent: {
      id: string
      type: "danger" | "warning" | "info"
      parameter: string | null
      message: string
      created_at: string
      resolved: boolean
      tank_name: string
      farm_name: string
    }[]
  }
  activity: {
    /** 최근 30일 수질 기록 수. 테이블·컬럼이 없으면 null. */
    readings_30d: number | null
    last_reading_at: string | null
    journal_count: number | null
    /** 마지막 일지 날짜(YYYY-MM-DD). */
    last_journal_date: string | null
  }
  /** 열람자로 연결된 농장. farm_viewers 테이블이 없으면 null. */
  viewer_links: { farm_id: string; farm_name: string; owner_name: string }[] | null
}
