// 농업(스마트팜) 사전 — environment 섹션(대시보드 "환경·기상" 카드). 4개 언어를 한 파일에 둔다.
//
// 항목 키·단위·소수 자리는 lib/env-params.ts 에 있다. 장비 화면(raspberry-pi/webui.py)의
// 같은 칸과 말을 맞췄다 — 패널에서 "오늘 강수"라고 본 것을 휴대폰에서 다른 말로 읽지 않게.
// 자리표시자는 `{{name}}` `{{ago}}` `{{n}}` `{{v}}` `{{dir}}`.
import type { Locale } from "@/lib/i18n"
import type { EnvParamKey } from "@/lib/env-params"

export interface AgriEnvironmentDict {
  /** 카드 제목 — `{{name}}` 베드 이름. */
  title: string
  param: Record<EnvParamKey, string>
  /** 기온 칸 — 2m 기온이 없어 초관부 온도(지상 10cm)를 받았을 때. 서버에는 구분이 남지 않아 설명으로 둔다. */
  airTempHint: string
  /** 마지막 수신 — `{{ago}}`. */
  updated: string
  /** 24시간 범위 — `{{min}}` `{{max}}`. */
  range24h: string
  /** 8방위 이름(북 → 북동 → … → 북서). */
  compass: readonly [string, string, string, string, string, string, string, string]
  /** 풍속 칸 보조 줄 — `{{v}}` 돌풍, `{{dir}}` 방위. */
  windSub: string
  /** 비 칸 보조 줄 — `{{v}}` 강우강도. */
  rainNow: string
  noRain: string
  /** 30분 넘게 새 값이 없을 때. */
  stale: string
  /** 센서가 여러 대인 칸의 보조 줄 — `{{n}}` 대수. 누르면 센서별 값이 펼쳐진다. */
  avgOf: string
  /** 펼친 목록 제목 — `{{param}}` 칸 이름. */
  eachTitle: string
  /** 펼친 목록의 기준 시각 — `{{ago}}`. */
  eachAt: string
  highest: string
  lowest: string
  /** 그래프에는 있지만 마지막 수신에 빠진 센서. */
  lost: string
  close: string
  /** 이슬점 칸 — 기온·습도로 계산. */
  dewPoint: string
  /** 이슬점 칸 보조 줄 — `{{v}}` 기온과의 차이(°C). 작을수록 이슬·결로가 맺히기 쉽다. */
  dewGap: string
  /** 기온과 이슬점이 2°C 안으로 붙었을 때 — 잎 젖음·병 발생 주의. */
  dewNear: string
}

export const agriEnvironment: Record<Locale, AgriEnvironmentDict> = {
  ko: {
    title: "환경·기상 · {{name}}",
    param: {
      air_temp: "기온", canopy_temp: "초관부 온도", humidity: "습도", soil_moisture: "토양수분", soil_temp: "지온",
      wind_speed: "풍속", wind_gust: "돌풍", wind_dir: "풍향", rain_day: "오늘 강수",
      rain_rate: "강우강도", solar: "일사", uv_index: "자외선", pressure: "기압",
    },
    airTempHint: "2m 기온 센서가 없으면 지상 10cm 초관부 온도입니다.",
    updated: "{{ago}} 수신",
    range24h: "24시간 {{min}}~{{max}}",
    compass: ["북", "북동", "동", "남동", "남", "남서", "서", "북서"],
    windSub: "돌풍 {{v}} m/s · {{dir}}풍",
    rainNow: "지금 {{v}} mm/h",
    noRain: "비 없음",
    stale: "30분 넘게 새 값이 없습니다 — 장비의 수집기·센서 배터리를 확인하세요.",
    avgOf: "평균 · {{n}}대 ›", eachTitle: "{{param}} · 센서별", eachAt: "{{ago}} 값",
    highest: "최고", lowest: "최저", close: "닫기",
    lost: "끊김",
    dewPoint: "이슬점", dewGap: "기온보다 {{v}}°C 낮음", dewNear: "이슬 맺힐 수 있음 (기온과 {{v}}°C 차이)",
  },
  en: {
    title: "Environment & weather · {{name}}",
    param: {
      air_temp: "Air temp", canopy_temp: "Canopy temp", humidity: "Humidity", soil_moisture: "Soil moisture", soil_temp: "Soil temp",
      wind_speed: "Wind", wind_gust: "Gust", wind_dir: "Wind dir.", rain_day: "Rain today",
      rain_rate: "Rain rate", solar: "Solar", uv_index: "UV", pressure: "Pressure",
    },
    airTempHint: "Without a 2 m air sensor this is canopy temperature at 10 cm.",
    updated: "updated {{ago}}",
    range24h: "24 h {{min}}–{{max}}",
    compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
    windSub: "gust {{v}} m/s · from {{dir}}",
    rainNow: "now {{v}} mm/h",
    noRain: "no rain",
    stale: "No new values for over 30 minutes — check the device's collectors and sensor batteries.",
    avgOf: "avg of {{n}} sensors ›", eachTitle: "{{param}} · by sensor", eachAt: "as of {{ago}}",
    highest: "highest", lowest: "lowest", close: "Close",
    lost: "No signal",
    dewPoint: "Dew point", dewGap: "{{v}}°C below air temp", dewNear: "Dew likely ({{v}}°C from air temp)",
  },
  vi: {
    title: "Môi trường & thời tiết · {{name}}",
    param: {
      air_temp: "Nhiệt độ KK", canopy_temp: "Nhiệt độ tán", humidity: "Độ ẩm", soil_moisture: "Độ ẩm đất", soil_temp: "Nhiệt độ đất",
      wind_speed: "Gió", wind_gust: "Gió giật", wind_dir: "Hướng gió", rain_day: "Mưa hôm nay",
      rain_rate: "Cường độ mưa", solar: "Bức xạ", uv_index: "UV", pressure: "Áp suất",
    },
    airTempHint: "Nếu không có cảm biến 2 m, đây là nhiệt độ tán ở 10 cm.",
    updated: "cập nhật {{ago}}",
    range24h: "24 giờ {{min}}–{{max}}",
    compass: ["Bắc", "Đông Bắc", "Đông", "Đông Nam", "Nam", "Tây Nam", "Tây", "Tây Bắc"],
    windSub: "giật {{v}} m/s · hướng {{dir}}",
    rainNow: "hiện {{v}} mm/h",
    noRain: "không mưa",
    stale: "Hơn 30 phút không có giá trị mới — kiểm tra bộ thu và pin cảm biến của thiết bị.",
    avgOf: "TB {{n}} cảm biến ›", eachTitle: "{{param}} · từng cảm biến", eachAt: "lúc {{ago}}",
    highest: "cao nhất", lowest: "thấp nhất", close: "Đóng",
    lost: "Mất tín hiệu",
    dewPoint: "Điểm sương", dewGap: "thấp hơn nhiệt độ {{v}}°C", dewNear: "Có thể đọng sương (cách {{v}}°C)",
  },
  id: {
    title: "Lingkungan & cuaca · {{name}}",
    param: {
      air_temp: "Suhu udara", canopy_temp: "Suhu kanopi", humidity: "Kelembapan", soil_moisture: "Kelembapan tanah", soil_temp: "Suhu tanah",
      wind_speed: "Angin", wind_gust: "Hembusan", wind_dir: "Arah angin", rain_day: "Hujan hari ini",
      rain_rate: "Intensitas hujan", solar: "Radiasi", uv_index: "UV", pressure: "Tekanan",
    },
    airTempHint: "Tanpa sensor 2 m, ini suhu kanopi pada 10 cm.",
    updated: "diperbarui {{ago}}",
    range24h: "24 jam {{min}}–{{max}}",
    compass: ["U", "TL", "T", "TG", "S", "BD", "B", "BL"],
    windSub: "hembusan {{v}} m/s · dari {{dir}}",
    rainNow: "kini {{v}} mm/j",
    noRain: "tidak hujan",
    stale: "Tidak ada nilai baru lebih dari 30 menit — periksa kolektor dan baterai sensor perangkat.",
    avgOf: "rata-rata {{n}} sensor ›", eachTitle: "{{param}} · per sensor", eachAt: "per {{ago}}",
    highest: "tertinggi", lowest: "terendah", close: "Tutup",
    lost: "Terputus",
    dewPoint: "Titik embun", dewGap: "{{v}}°C di bawah suhu udara", dewNear: "Embun mungkin terbentuk (selisih {{v}}°C)",
  },
}
