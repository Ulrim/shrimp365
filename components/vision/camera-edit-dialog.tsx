// 등록된 카메라의 설정을 고치는 창.
//
// 왜 필요한가
// -----------
// 카메라는 두 길로 등록된다. 6자리 코드로 연결하면 **이름·해상도·초당 장수가
// 자동으로 정해진다.** 그 뒤로 바꿀 길이 없었다 — 추가와 삭제만 있고 수정이
// 없었다. 그래서 이름이 "A-1조 카메라" 로 굳거나, 파이가 버거워 초당 장수를
// 낮추고 싶어도 지우고 다시 연결하는 수밖에 없었다(그러면 개체수 이력도
// 날아간다). 뒤쪽(API·스키마)은 처음부터 부분 수정을 받고 있었고, 화면만
// 없었다.
//
// 수조는 바꿀 수 없다. 카메라를 다른 수조로 옮기면 그동안 쌓인 개체수가 어느
// 수조의 것인지 알 수 없게 된다(app/api/vision/cameras/[id] 가 tank_id 를
// 떼어 낸다). 옮기려면 그 수조에서 다시 연결하는 것이 맞다.
//
// 자주 고치는 것(이름)과 드물게 고치는 것(해상도·초당 장수)을 나눠 두었다.
// 농장에서 쓰는 사람에게 해상도를 먼저 들이밀 이유가 없고, 그 값은 잘못
// 만지면 파이가 버거워진다.
"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { updateCamera } from "@/lib/vision"
import type { VisionCamera } from "@/types"
import { ChevronDown, Loader2 } from "lucide-react"

const CAMERA_TYPES = [
  { value: "picamera", label: "라즈베리파이 카메라 (CSI)", hint: "보드에 직접 연결된 카메라 — 주소가 필요 없습니다" },
  { value: "usb",  label: "USB 카메라", hint: "장치 번호를 적습니다. 보통 0" },
  { value: "rtsp", label: "RTSP (IP 카메라)", hint: "rtsp://아이디:비밀번호@주소:554/stream" },
  { value: "http", label: "HTTP (MJPEG)", hint: "http://주소/video" },
] as const

type CameraTypeValue = (typeof CAMERA_TYPES)[number]["value"]

/** 고를 수 있는 해상도. 파이 4 에서 416 모델을 돌리는 기준으로 추렸다 —
 *  더 키워도 모델이 416 으로 줄여 넣으므로 정확도는 오르지 않고 CPU 만 먹는다. */
const RESOLUTIONS = [
  { w: 640,  h: 480,  label: "640 × 480 (권장)" },
  { w: 1280, h: 720,  label: "1280 × 720" },
  { w: 1920, h: 1080, label: "1920 × 1080 (파이가 버거울 수 있습니다)" },
] as const

export function CameraEditDialog({
  camera,
  open,
  onClose,
  onSaved,
}: {
  camera: VisionCamera | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  if (!camera) return null
  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>카메라 설정</DialogTitle>
        </DialogHeader>
        {/* key 로 카메라마다 폼을 새로 마운트한다. useEffect 로 값을 맞추면,
            앞서 열었던 카메라의 값이 한 번 그려진 뒤 덮어쓰이고(깜빡임),
            맞추는 것을 하나라도 빠뜨리면 고치지도 않은 항목이 그 값으로
            저장된다. 처음부터 지금 카메라의 값으로 시작하는 쪽이 안전하다. */}
        <EditForm
          key={camera.id}
          camera={camera}
          onClose={onClose}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  camera,
  onClose,
  onSaved,
}: {
  camera: VisionCamera
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(camera.name)
  const [cameraType, setCameraType] = useState<CameraTypeValue>(
    camera.camera_type as CameraTypeValue
  )
  const [streamUrl, setStreamUrl] = useState(camera.stream_url ?? "")
  const [resolution, setResolution] = useState(
    `${camera.resolution_w}x${camera.resolution_h}`
  )
  const [fps, setFps] = useState(String(camera.fps_target))
  const [tankArea, setTankArea] = useState(
    camera.tank_area_m2 == null ? "" : String(camera.tank_area_m2)
  )
  const [isActive, setIsActive] = useState(camera.is_active)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeInfo = CAMERA_TYPES.find(t => t.value === cameraType)
  const needsUrl = cameraType !== "picamera"
  const fpsNum = Number(fps)
  const fpsBad = !Number.isFinite(fpsNum) || fpsNum < 0.5 || fpsNum > 5
  const urlBad = needsUrl && !streamUrl.trim()

  const save = async () => {
    if (fpsBad || urlBad) return
    const [w, h] = resolution.split("x").map(Number)
    setSaving(true)
    setError(null)
    try {
      await updateCamera(camera.id, {
        name: name.trim() || camera.name,
        camera_type: cameraType,
        // CSI 는 보드에 직접 붙어 있어 주소가 없다. 전에 USB 로 쓰던 카메라를
        // CSI 로 바꾸면 옛 장치 번호가 남아 엉뚱한 것을 열려 든다.
        stream_url: needsUrl ? streamUrl.trim() : null,
        resolution_w: w,
        resolution_h: h,
        fps_target: fpsNum,
        tank_area_m2: tankArea.trim() === "" ? null : Number(tankArea),
        is_active: isActive,
      })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
          {/* 수조는 바꿀 수 없다. 비활성 입력으로 두어 "왜 없나" 를 묻지 않게 한다. */}
          <div className="space-y-1.5">
            <Label>수조</Label>
            <Input value={camera.tank_name ?? "수조"} disabled />
            <p className="text-xs text-muted-foreground">
              수조는 바꿀 수 없습니다 — 쌓인 개체수가 어느 수조의 것인지
              알 수 없게 됩니다. 옮기려면 그 수조에서 다시 연결하세요.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cam-name">카메라 이름</Label>
            <Input
              id="cam-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={camera.name}
              className="min-h-[44px]"
            />
          </div>

          {/* 줄 전체가 누르는 자리다. 스위치만 누르게 두면 24px 짜리 과녁이
              되어 농장에서 장갑 낀 손으로는 잘 안 맞는다. 스위치에서 포인터
              이벤트를 떼어 두 번 토글되는 것을 막고, 키보드로는 여전히
              스위치에 포커스가 가 Space 로 바꿀 수 있다. */}
          <div
            onClick={() => setIsActive(v => !v)}
            className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 active:bg-accent transition-colors"
          >
            <div className="min-w-0">
              <Label htmlFor="cam-active" className="cursor-pointer">사용</Label>
              <p className="text-xs text-muted-foreground">
                끄면 개체수를 세지 않습니다. 쌓인 기록은 그대로 남습니다.
              </p>
            </div>
            <Switch
              id="cam-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              className="pointer-events-none shrink-0"
            />
          </div>

          {/* ── 자세한 설정 — 드물게 고치는 것은 접어 둔다 ── */}
          <button
            type="button"
            onClick={() => setAdvanced(v => !v)}
            className="flex w-full items-center justify-between rounded-xl px-3 py-3 min-h-[44px] text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-expanded={advanced}
          >
            자세한 설정 (연결 방식 · 해상도 · 초당 장수)
            <ChevronDown className={`w-4 h-4 transition-transform ${advanced ? "rotate-180" : ""}`} />
          </button>

          {advanced && (
            <div className="space-y-4 rounded-xl border border-border bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label>연결 방식</Label>
                <Select value={cameraType} onValueChange={v => setCameraType(v as CameraTypeValue)}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMERA_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {typeInfo && <p className="text-xs text-muted-foreground">{typeInfo.hint}</p>}
              </div>

              {needsUrl && (
                <div className="space-y-1.5">
                  <Label htmlFor="cam-url">
                    {cameraType === "usb" ? "장치 번호" : "스트림 주소"}
                  </Label>
                  <Input
                    id="cam-url"
                    value={streamUrl}
                    onChange={e => setStreamUrl(e.target.value)}
                    placeholder={cameraType === "usb" ? "0" : typeInfo?.hint}
                    className="min-h-[44px]"
                    aria-invalid={urlBad}
                    aria-describedby={urlBad ? "cam-url-err" : undefined}
                  />
                  {urlBad && (
                    <p id="cam-url-err" role="alert" className="text-xs text-destructive">
                      {cameraType === "usb" ? "장치 번호를 적으세요 (보통 0)." : "주소를 적으세요."}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>해상도</Label>
                <Select value={resolution} onValueChange={setResolution}>
                  <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESOLUTIONS.map(r => (
                      <SelectItem key={`${r.w}x${r.h}`} value={`${r.w}x${r.h}`}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  모델이 416×416 으로 줄여 넣습니다 — 키워도 정확도는 오르지 않고
                  파이만 버거워집니다.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cam-fps">초당 장수</Label>
                <Input
                  id="cam-fps"
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0.5"
                  max="5"
                  value={fps}
                  onChange={e => setFps(e.target.value)}
                  className="min-h-[44px]"
                  aria-invalid={fpsBad}
                  aria-describedby={fpsBad ? "cam-fps-err" : "cam-fps-help"}
                />
                {fpsBad ? (
                  <p id="cam-fps-err" role="alert" className="text-xs text-destructive">
                    0.5 에서 5 사이로 적으세요.
                  </p>
                ) : (
                  <p id="cam-fps-help" className="text-xs text-muted-foreground">
                    개체수는 초당 한 번이면 충분합니다. 높이면 파이가 뜨거워지고
                    기록만 늘어납니다.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cam-area">수조 면적 (㎡, 선택)</Label>
                <Input
                  id="cam-area"
                  type="number"
                  inputMode="decimal"
                  value={tankArea}
                  onChange={e => setTankArea(e.target.value)}
                  placeholder="예: 120"
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  적어 두면 화면에 보이는 마리 수로 수조 전체를 가늠합니다.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
        </div>

      {/* 저장을 바닥에 붙여 둔다. 자세한 설정을 펴면 내용이 화면보다 길어져
          휴대폰에서는 저장 버튼이 접힌 아래로 밀려났다 — 다 고쳐 놓고 저장을
          못 찾는 것이 가장 나쁘다. */}
      {/* DialogFooter 는 좁은 화면에서 버튼을 세로로 쌓는다(flex-col-reverse).
          여기서는 두 줄이 되어 가뜩이나 좁은 세로를 더 먹으므로 가로로 둔다. */}
      <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 flex-row gap-2 border-t border-border bg-background px-6 py-4">
        <Button variant="outline" onClick={onClose} disabled={saving} className="min-h-[44px] flex-1 sm:flex-none">
          취소
        </Button>
        <Button
          variant="ocean"
          onClick={save}
          disabled={saving || fpsBad || urlBad}
          className="min-h-[44px] flex-1 sm:flex-none"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? "저장 중…" : "저장"}
        </Button>
      </DialogFooter>
    </>
  )
}
