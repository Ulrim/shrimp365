"use client"

import { useState } from "react"
import { Camera as CameraIcon, Play, Plus, Square, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  createAlertConfig, createCamera, deleteAlertConfig, deleteCamera, startCamera, stopCamera,
} from "@/lib/vision"
import type { Tank, VisionAlertConfig, VisionCamera, VisionCameraStatus } from "@/types"

// 카메라 등록·시작/정지와 개체수 경보 설정.
//
// 양식장·수조는 여기서 만들지 않는다 — 이미 /farms 에서 한 번 등록한다.
// 카메라는 "그 수조에 달린 장비"로만 다룬다. 센서 기기(sensor_devices)와
// 같은 사고방식이라 사용자가 새로 배울 것이 없다.

const CAMERA_TYPES = [
  { value: "picamera", label: "라즈베리파이 카메라 (CSI)", hint: "보드에 직접 연결된 카메라 — 주소가 필요 없습니다" },
  { value: "usb",  label: "USB 카메라", hint: "장치 번호를 적습니다. 보통 0" },
  { value: "rtsp", label: "RTSP (IP 카메라)", hint: "rtsp://아이디:비밀번호@주소:554/stream" },
  { value: "http", label: "HTTP (MJPEG)", hint: "http://주소/video" },
] as const

type CameraTypeValue = (typeof CAMERA_TYPES)[number]["value"]

const ALERT_TYPES = [
  { value: "count_drop",  label: "개체수 급감", desc: "최근 평균보다 크게 줄면 알립니다. 폐사·질병의 첫 신호입니다." },
  { value: "count_spike", label: "개체수 급증", desc: "갑자기 늘면 알립니다. 보통 탐지 오류나 조명 변화입니다." },
  { value: "threshold",   label: "임계값 미만", desc: "정해 둔 마릿수 아래로 떨어지면 알립니다." },
  { value: "offline",     label: "카메라 끊김", desc: "영상이 들어오지 않으면 알립니다." },
] as const

interface Props {
  tanks: Tank[]
  cameras: VisionCamera[]
  statuses: Record<string, VisionCameraStatus>
  configs: VisionAlertConfig[]
  onChanged: () => void
}

export function CameraSettings({ tanks, cameras, statuses, configs, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 카메라 등록 폼
  // 고른 적이 없으면 첫 수조를 쓴다. 효과로 상태를 밀어 넣는 대신 파생시킨다 —
  // 수조 목록이 늦게 도착해도 렌더 한 번으로 맞는 값이 나온다.
  const [pickedTankId, setPickedTankId] = useState("")
  const [name, setName] = useState("")
  const [cameraType, setCameraType] = useState<CameraTypeValue>("picamera")
  const [streamUrlValue, setStreamUrlValue] = useState("")
  const [tankArea, setTankArea] = useState("")
  const [hostId, setHostId] = useState("")

  // 경보 설정 폼
  const [alertCameraId, setAlertCameraId] = useState("")
  const [alertType, setAlertType] = useState<(typeof ALERT_TYPES)[number]["value"]>("count_drop")
  const [thresholdPct, setThresholdPct] = useState("30")
  const [thresholdValue, setThresholdValue] = useState("")
  const [windowMinutes, setWindowMinutes] = useState("10")
  const [notifyEmail, setNotifyEmail] = useState("")

  const tankId = pickedTankId || tanks[0]?.id || ""
  const typeHint = CAMERA_TYPES.find(t => t.value === cameraType)?.hint ?? ""

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청이 실패했습니다.")
    } finally {
      setBusy(null)
    }
  }

  const handleAddCamera = () =>
    run("add-camera", async () => {
      if (!tankId || !name.trim()) throw new Error("수조와 카메라 이름을 입력하세요.")
      await createCamera({
        tank_id: tankId,
        name: name.trim(),
        camera_type: cameraType,
        stream_url: streamUrlValue.trim() || null,
        tank_area_m2: tankArea ? Number(tankArea) : null,
        host_id: hostId.trim() || null,
      })
      setName("")
      setTankArea("")
    })

  const handleAddAlert = () =>
    run("add-alert", async () => {
      const usesPct = alertType === "count_drop" || alertType === "count_spike"
      if (alertType === "threshold" && !thresholdValue) {
        throw new Error("임계값(마릿수)을 입력하세요.")
      }
      await createAlertConfig({
        // 빈 문자열은 "모든 카메라"를 뜻한다. null 로 바꿔 보낸다.
        camera_id: alertCameraId || null,
        alert_type: alertType,
        threshold_pct: usesPct ? Number(thresholdPct) : null,
        threshold_value: alertType === "threshold" ? Number(thresholdValue) : null,
        window_minutes: Number(windowMinutes) || 10,
        notify_email: notifyEmail.trim() || null,
      })
      setNotifyEmail("")
    })

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* ── 카메라 목록 ─────────────────────────── */}
      <Card className="bg-muted border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">등록된 카메라</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cameras.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              아직 등록된 카메라가 없습니다. 아래에서 추가하세요.
            </p>
          ) : (
            cameras.map(camera => {
              const status = statuses[camera.id] ?? (camera.is_active ? "online" : "offline")
              const running = status === "running"
              return (
                <div
                  key={camera.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
                >
                  <CameraIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{camera.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {camera.tank_name ?? "수조"} · {camera.camera_type.toUpperCase()}
                      {camera.host_id ? ` · ${camera.host_id}` : ""}
                      {camera.stream_url ? ` · ${camera.stream_url}` : ""}
                    </p>
                  </div>
                  <Badge variant={running ? "success" : status === "error" ? "danger" : "secondary"}>
                    {running ? "분석 중" : status === "error" ? "오류" : "중지됨"}
                  </Badge>
                  <Button
                    size="sm"
                    variant={running ? "outline" : "ocean"}
                    disabled={busy === camera.id}
                    onClick={() =>
                      run(camera.id, () => (running ? stopCamera(camera.id) : startCamera(camera.id)))
                    }
                  >
                    {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {running ? "중지" : "시작"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === camera.id}
                    onClick={() => {
                      if (!confirm(`'${camera.name}'을(를) 삭제할까요?\n\n지금까지 쌓인 개체수 기록도 함께 지워집니다.`)) return
                      run(camera.id, () => deleteCamera(camera.id))
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* ── 카메라 추가 ─────────────────────────── */}
      <Card className="bg-muted border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">카메라 추가</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>수조</Label>
            <Select value={tankId} onValueChange={setPickedTankId}>
              <SelectTrigger><SelectValue placeholder="수조를 고르세요" /></SelectTrigger>
              <SelectContent>
                {tanks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>카메라 이름</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="1번 수조 카메라" />
          </div>

          <div className="space-y-1.5">
            <Label>연결 방식</Label>
            <Select
              value={cameraType}
              onValueChange={(v) => {
                const next = v as CameraTypeValue
                setCameraType(next)
                // 방식이 바뀌면 주소 형식도 완전히 달라진다. 남은 값을 그대로
                // 두면 rtsp 자리에 "0" 이 남아 연결이 실패한다.
                setStreamUrlValue(next === "usb" ? "0" : "")
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAMERA_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {cameraType === "picamera" ? (
            <div className="space-y-1.5">
              <Label>연결 주소</Label>
              <p className="text-sm text-muted-foreground pt-2">
                필요 없습니다 — 보드에 직접 붙은 카메라를 그대로 씁니다.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{cameraType === "usb" ? "장치 번호" : "스트림 주소"}</Label>
              <Input
                value={streamUrlValue}
                onChange={e => setStreamUrlValue(e.target.value)}
                placeholder={typeHint}
              />
              <p className="text-[11px] text-muted-foreground">{typeHint}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>장비 ID (선택)</Label>
            <Input
              value={hostId}
              onChange={e => setHostId(e.target.value)}
              placeholder="예: pi-tank-1"
            />
            <p className="text-[11px] text-muted-foreground">
              카메라가 물린 라즈베리파이의 이름입니다. 파이가 여러 대일 때 어느
              장비가 이 카메라를 맡을지 가릅니다. 한 대뿐이면 비워 두세요.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>수조 면적 (㎡, 선택)</Label>
            <Input
              type="number"
              value={tankArea}
              onChange={e => setTankArea(e.target.value)}
              placeholder="예: 120"
            />
            <p className="text-[11px] text-muted-foreground">
              화면에 잡힌 수를 수조 전체로 환산할 때 씁니다.
            </p>
          </div>

          <div className="flex items-end">
            <Button
              variant="ocean"
              className="w-full"
              disabled={busy === "add-camera" || !tanks.length}
              onClick={handleAddCamera}
            >
              <Plus className="w-4 h-4" /> 카메라 추가
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 경보 설정 ─────────────────────────── */}
      <Card className="bg-muted border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">개체수 경보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            여기서 만든 경보는 수질 경보와 같은 알림함으로 갑니다 — 헤더 알림과 휴대폰 푸시에
            함께 뜹니다. 개체수 급감과 용존산소 급락이 겹치면 한 건의 긴급 경보로 묶입니다.
          </p>

          {configs.length > 0 && (
            <div className="space-y-2">
              {configs.map(config => {
                const meta = ALERT_TYPES.find(a => a.value === config.alert_type)
                const camera = cameras.find(c => c.id === config.camera_id)
                return (
                  <div
                    key={config.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{meta?.label ?? config.alert_type}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {camera?.name ?? "모든 카메라"}
                        {config.threshold_pct !== null && ` · ${config.threshold_pct}% 변화`}
                        {config.threshold_value !== null && ` · ${config.threshold_value}마리 미만`}
                        {` · 최근 ${config.window_minutes}분 기준`}
                        {config.notify_email && ` · ${config.notify_email}`}
                      </p>
                    </div>
                    <Badge variant={config.is_enabled ? "success" : "secondary"}>
                      {config.is_enabled ? "켜짐" : "꺼짐"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === config.id}
                      onClick={() => run(config.id, () => deleteAlertConfig(config.id))}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label>적용 대상</Label>
              <Select value={alertCameraId || "all"} onValueChange={v => setAlertCameraId(v === "all" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 카메라</SelectItem>
                  {cameras.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>경보 종류</Label>
              <Select value={alertType} onValueChange={v => setAlertType(v as typeof alertType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALERT_TYPES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {ALERT_TYPES.find(a => a.value === alertType)?.desc}
              </p>
            </div>

            {(alertType === "count_drop" || alertType === "count_spike") && (
              <div className="space-y-1.5">
                <Label>변화율 기준 (%)</Label>
                <Input type="number" value={thresholdPct} onChange={e => setThresholdPct(e.target.value)} />
              </div>
            )}

            {alertType === "threshold" && (
              <div className="space-y-1.5">
                <Label>임계 마릿수</Label>
                <Input type="number" value={thresholdValue} onChange={e => setThresholdValue(e.target.value)} placeholder="예: 200" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>비교 기간 (분)</Label>
              <Input type="number" value={windowMinutes} onChange={e => setWindowMinutes(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">최근 이 시간의 평균과 견줍니다.</p>
            </div>

            <div className="space-y-1.5">
              <Label>메일 알림 (선택)</Label>
              <Input type="email" value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)} placeholder="alert@example.com" />
            </div>

            <div className="flex items-end sm:col-span-2">
              <Button
                variant="ocean"
                disabled={busy === "add-alert"}
                onClick={handleAddAlert}
              >
                <Plus className="w-4 h-4" /> 경보 추가
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
