/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_DEMO_SITE_ID?: string;
  readonly VITE_DEMO_POWER_METER_ID?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 미초대 계정 안내 화면(FED-3)의 문의 경로. 이메일 또는 https URL. 비면 링크 미렌더. */
  readonly VITE_SUPPORT_CONTACT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
