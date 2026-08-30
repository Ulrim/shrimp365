import { NextRequest, NextResponse } from "next/server"

// 양식장 좌표로 날씨를 가져온다.
//
// Open-Meteo 를 쓴다. 키가 필요 없고 무료이며 전 세계를 다룬다 — 베트남·인도네시아
// 농가까지 같은 코드로 서비스할 수 있다. 기상청 API 는 국내만 되고 격자 좌표
// 변환이 따로 필요해서, 다국어로 나가는 이 서비스에는 맞지 않는다.
//
// 새우 양식에서 날씨가 중요한 이유는 비 때문이다. 폭우가 쏟아지면 표층 염도가
// 급락하고, 흐린 날이 이어지면 식물플랑크톤 광합성이 줄어 새벽 용존산소가
// 떨어진다. 둘 다 미리 알면 대비할 수 있다.

export const revalidate = 900   // 15분. 예보는 그보다 자주 바뀌지 않는다.

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast"

/** 하루 강수량(mm)을 새우 양식 기준으로 판정한다.
 *
 *  기준은 기상청 호우주의보(3시간 60mm 또는 12시간 110mm)를 하루로 환산해
 *  잡았다. 양식장에서는 "얼마나 왔나" 보다 "염도가 얼마나 흔들리나" 가
 *  중요한데, 그건 수조 깊이와 면적에 따라 달라 일반화하기 어렵다.
 *  그래서 경보는 비의 세기로만 내고, 실제 영향은 염도 그래프로 확인하게 한다. */
function rainLevel(mm: number): "none" | "watch" | "warn" | "danger" {
  if (mm >= 110) return "danger"
  if (mm >= 60) return "warn"
  if (mm >= 20) return "watch"
  return "none"
}

function windLevel(ms: number): "none" | "watch" | "warn" | "danger" {
  // 강풍주의보 14m/s, 경보 21m/s 기준.
  if (ms >= 21) return "danger"
  if (ms >= 14) return "warn"
  if (ms >= 9) return "watch"
  return "none"
}

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"))
  const lon = Number(req.nextUrl.searchParams.get("lon"))

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "좌표가 올바르지 않습니다." }, { status: 400 })
  }

  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,precipitation,wind_speed_10m,weather_code"
    + "&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,weather_code"
    + "&timezone=auto&forecast_days=4&wind_speed_unit=ms"

  try {
    const res = await fetch(url, { next: { revalidate } })
    if (!res.ok) {
      return NextResponse.json({ error: "날씨를 가져오지 못했습니다." }, { status: 502 })
    }
    const data = await res.json()

    const days = (data.daily?.time ?? []).map((date: string, i: number) => {
      const rain = data.daily.precipitation_sum?.[i] ?? 0
      const wind = data.daily.wind_speed_10m_max?.[i] ?? 0
      return {
        date,
        rain_mm: Math.round(rain * 10) / 10,
        wind_ms: Math.round(wind * 10) / 10,
        temp_max: data.daily.temperature_2m_max?.[i] ?? null,
        temp_min: data.daily.temperature_2m_min?.[i] ?? null,
        code: data.daily.weather_code?.[i] ?? null,
        rain_level: rainLevel(rain),
        wind_level: windLevel(wind),
      }
    })

    // 앞으로 며칠 안에 대비가 필요한 날이 있으면 짚어 준다.
    const warnings: { date: string; kind: "rain" | "wind"; level: string; detail: string }[] = []
    for (const d of days) {
      if (d.rain_level === "warn" || d.rain_level === "danger") {
        warnings.push({
          date: d.date, kind: "rain", level: d.rain_level,
          detail: `강수 ${d.rain_mm}mm — 표층 염도 급락에 대비하세요`,
        })
      }
      if (d.wind_level === "warn" || d.wind_level === "danger") {
        warnings.push({
          date: d.date, kind: "wind", level: d.wind_level,
          detail: `최대풍속 ${d.wind_ms}m/s — 시설·전원을 점검하세요`,
        })
      }
    }

    return NextResponse.json({
      current: {
        temperature: data.current?.temperature_2m ?? null,
        precipitation: data.current?.precipitation ?? null,
        wind_ms: data.current?.wind_speed_10m ?? null,
        code: data.current?.weather_code ?? null,
      },
      days,
      warnings,
    })
  } catch {
    // 날씨를 못 가져와도 화면의 나머지는 그대로 떠야 한다.
    return NextResponse.json({ error: "날씨를 가져오지 못했습니다." }, { status: 502 })
  }
}
