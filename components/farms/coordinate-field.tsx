"use client"

import { useState } from "react"
import { MapPin, LocateFixed, Loader2, ExternalLink, AlertTriangle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

/** 양식장 좌표 입력.
 *
 *  라즈베리파이에 GPS 를 다는 것보다 이쪽이 정확하고 싸다. 장비는 수조 옆에
 *  고정되어 움직이지 않으니 위치는 한 번만 정하면 되고, 창고 안에서는 GPS 가
 *  위성을 못 봐서 애초에 측위가 안 된다.
 *
 *  가장 쉬운 길은 "현재 위치로" 다. 농장에 서서 휴대폰으로 누르면 그 자리
 *  좌표가 들어간다. 주소를 좌표로 바꾸는 것(지오코딩)은 외부 서비스 키가
 *  필요하고 양식장처럼 주소가 뭉뚱그려진 곳에서는 정확도도 떨어진다.
 */
export function CoordinateField({
  latitude, longitude, onChange,
}: {
  latitude: number | null
  longitude: number | null
  onChange: (lat: number | null, lon: number | null) => void
}) {
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const useCurrentPosition = () => {
    setError(null)
    if (!navigator.geolocation) {
      setError("이 브라우저는 위치 기능을 지원하지 않습니다.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false)
        onChange(
          Math.round(pos.coords.latitude * 1e6) / 1e6,
          Math.round(pos.coords.longitude * 1e6) / 1e6,
        )
      },
      err => {
        setLocating(false)
        // 사유를 정확히 알려 준다. "실패" 만 뜨면 뭘 고쳐야 할지 알 수 없다.
        setError(
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 주소창의 자물쇠에서 허용해 주세요."
            : err.code === err.POSITION_UNAVAILABLE
              ? "위치를 확인할 수 없습니다. 실내라면 창가나 야외에서 다시 시도해 보세요."
              : "위치 확인이 오래 걸립니다. 다시 시도해 주세요.",
        )
      },
      // 양식장은 한 번만 정하는 값이라 조금 기다려도 정확한 편이 낫다.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const num = (v: string): number | null => {
    if (v.trim() === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // 지도에서 좌표를 옮겨 적을 때 위도·경도를 바꿔 넣는 실수가 흔하다.
  // 위도는 -90~90 이므로 그 밖의 값이 들어오면 뒤바뀐 것이 거의 확실하다.
  const swapped = latitude !== null && Math.abs(latitude) > 90
  const outOfRange = longitude !== null && Math.abs(longitude) > 180
  const ready = latitude !== null && longitude !== null && !swapped && !outOfRange

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground text-sm flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> 좌표 <span className="text-xs opacity-70">(선택)</span>
        </Label>
        <button
          type="button"
          onClick={useCurrentPosition}
          disabled={locating}
          className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-ocean-500/40 text-ocean-500 hover:bg-ocean-500/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {locating
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 확인 중…</>
            : <><LocateFixed className="w-3.5 h-3.5" /> 현재 위치로</>}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number" step="any" inputMode="decimal"
          value={latitude ?? ""}
          onChange={e => onChange(num(e.target.value), longitude)}
          placeholder="위도 예: 34.6667"
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
          aria-label="위도"
        />
        <Input
          type="number" step="any" inputMode="decimal"
          value={longitude ?? ""}
          onChange={e => onChange(latitude, num(e.target.value))}
          placeholder="경도 예: 127.7614"
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
          aria-label="경도"
        />
      </div>

      {swapped && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            위도는 −90~90 사이입니다. <b>위도와 경도가 바뀐 것 같습니다</b> — 지도에서
            복사하면 <b>위도 먼저</b> 나옵니다(우리나라는 위도 33~38, 경도 125~130).
            <button
              type="button"
              onClick={() => onChange(longitude, latitude)}
              className="ml-1 underline font-semibold"
            >서로 바꾸기</button>
          </span>
        </p>
      )}
      {outOfRange && !swapped && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> 경도는 −180~180 사이입니다.
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {!error && !swapped && !outOfRange && (
        <p className="text-xs text-muted-foreground">
          지도 표시와 폭우·태풍 경보에 씁니다. <b>양식장에 서서</b> 휴대폰으로 누르면 가장 정확합니다.
        </p>
      )}

      {/* 저장하기 전에 엉뚱한 곳을 찍지 않았는지 눈으로 확인할 수 있게 한다. */}
      {ready && (
        <a
          href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-ocean-500 hover:underline"
        >
          <ExternalLink className="w-3 h-3" /> 지도에서 이 위치 확인
        </a>
      )}
    </div>
  )
}
