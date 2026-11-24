/** Supabase/PostgreSQL 오류를 사용자에게 보여 줄 한국어 메시지로 바꾼다. */
export function toMessage(error: { message?: string; code?: string; details?: string } | null | undefined): string {
  if (!error) return "알 수 없는 오류가 발생했습니다.";
  const message = error.message ?? "";
  // DB 함수·트리거에서 직접 보낸 한국어 메시지는 그대로 보여 준다
  if (/[가-힣]/.test(message)) return message;
  switch (error.code) {
    case "23505":
      if (message.includes("dw_daily_reports_project_id_author_id_work_date_key")) {
        return "해당 날짜의 작업일보가 이미 있습니다. 기존 작업일보를 수정해 주세요.";
      }
      if (message.includes("dw_projects_code_key")) return "이미 사용 중인 사업장 코드입니다.";
      if (message.includes("dw_processes_project_id_name_key")) return "같은 이름의 공정이 이미 있습니다.";
      return "이미 등록된 데이터입니다.";
    case "23514":
      if (message.includes("dw_daily_reports")) return "작업 시간이 올바르지 않습니다. 시작·종료·휴게시간을 확인해 주세요.";
      return "입력값이 허용 범위를 벗어났습니다.";
    case "23503":
      return "다른 데이터에서 사용 중이어서 처리할 수 없습니다.";
    case "42501":
      return "이 작업을 수행할 권한이 없습니다.";
    case "PGRST116":
      return "데이터를 찾을 수 없거나 접근 권한이 없습니다.";
  }
  if (message.includes("row-level security")) return "이 작업을 수행할 권한이 없습니다.";
  if (message.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  // 분류되지 않은 오류는 서버 로그에 남겨 원인을 추적할 수 있게 한다
  console.error("[처리 오류]", error.code, message, error.details ?? "");
  return "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}
