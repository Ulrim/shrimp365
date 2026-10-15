"use client"

// 베드 카드 하단 기기 섹션(농업 화면) — 수아 시안 mode-split-ui.md 5-8 "기기 섹션".
//
// 기존 farms-view.tsx 의 DeviceSection 은 내부 함수라 import 할 수 없어 농업판을 그린다.
// 로직은 전부 lib/db(getSensorDevices · toggleSensorDevice · deleteSensorDevice ·
// requestDeviceUpdate)이고 페어링은 PairDeviceDialog 를 그대로 쓴다.
// last_payload 요약은 그리지 않는다 — 대시보드의 DeviceCurrentValues 가 한다.
import { useEffect, useState } from "react"
import { ArrowUpCircle, Cpu, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { PairDeviceDialog } from "@/components/sensors/pair-device-dialog"
import { useAuth } from "@/lib/auth-context"
import { deleteSensorDevice, getSensorDevices, requestDeviceUpdate, toggleSensorDevice } from "@/lib/db"
import { useAgriT, useT } from "@/lib/i18n-context"
import { isTestAccount, MOCK_SENSOR_DEVICES } from "@/lib/mock-data"
import { cn } from "@/lib/utils"
import type { Dict } from "@/lib/i18n"
import type { AgriFarmsDict } from "@/lib/i18n/agri/farms"
import type { SensorDevice, Tank } from "@/types"
import { fill } from "./form-styles"

/** "1.2.3" 을 견줄 수 있는 형태로. 형식이 아니면 null. */
function parseVersion(v: string | null): number[] | null {
  if (!v || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return null
  return v.split(".").map(Number)
}

function isNewer(candidate: string | null, current: string | null): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a) return false
  if (!b) return true // 버전을 아직 모르는 기기 — 일단 올릴 수 있게 둔다
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** 마지막 수신 시각 → "n분 전". 공용 time 사전을 쓴다. 컴포넌트 밖이라 Date.now 가 허용된다. */
function seenLabel(t: Dict, d: AgriFarmsDict, iso: string | null): string {
  if (!iso) return d.deviceNeverSeen
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return t.time.justNow
  if (mins < 60) return fill(t.time.minutesAgo, { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return fill(t.time.hoursAgo, { n: hrs })
  return fill(t.time.daysAgo, { n: Math.floor(hrs / 24) })
}

function updateStatusLabel(d: AgriFarmsDict, status: SensorDevice["update_status"]): string {
  switch (status) {
    case "downloading": return d.updateStatusDownloading
    case "applied":     return d.updateStatusApplied
    case "failed":      return d.updateStatusFailed
    case "rolled_back": return d.updateStatusRolledBack
    default:            return d.updateStatusRequested
  }
}

// ─── 기기 한 줄 ───────────────────────────────────────────────────────────────

function DeviceRow({ device, latest, onChanged, onDelete }: {
  device: SensorDevice
  latest: string | null
  onChanged: (updated: SensorDevice) => void
  onDelete: () => void
}) {
  const { t } = useT()
  const { farms: d } = useAgriT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = device.agent_version
  const pending = device.update_to
  const canUpdate = !pending && isNewer(latest, current)
  const upToDate = !pending && !!current && !!latest && !isNewer(latest, current)
  const failed = !pending && (device.update_status === "failed" || device.update_status === "rolled_back")

  async function handleToggle(active: boolean) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await toggleSensorDevice(device.id, active))
    } catch {
      setError(d.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  // 원격 업데이트는 승인제다 — 여기서 누른 기기만 다음 확인 때 새 버전을 받아 간다.
  async function handleUpdate(version: string | null) {
    setBusy(true)
    setError(null)
    try {
      onChanged(await requestDeviceUpdate(device.id, version))
    } catch {
      setError(d.updateRequestFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="bg-muted rounded-lg px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Cpu className="w-4 h-4 text-brand-fg shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-foreground font-medium truncate">{device.name}</p>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {seenLabel(t, d, device.last_seen_at)}
              {current && <span className="font-mono"> · v{current}</span>}
              {!current && <span> · {d.versionUnknown}</span>}
              {upToDate && <span className="text-emerald-600 dark:text-emerald-400 font-medium"> · {d.firmwareLatest}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch
            checked={device.active}
            disabled={busy}
            onCheckedChange={handleToggle}
            aria-label={fill(d.deviceActiveAria, { name: device.name })}
            className="data-[state=checked]:bg-brand"
          />
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center justify-center disabled:opacity-50"
            title={d.deleteDevice}
            aria-label={fill(d.deleteDeviceAria, { name: device.name })}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 업데이트 — 최신이 아닐 때만 버튼, 예약 중이면 상태 + 취소, 실패면 사유. */}
      {canUpdate && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">{fill(d.newVersion, { v: latest ?? "" })}</span>
          <button
            type="button"
            onClick={() => handleUpdate(latest)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs px-2.5 min-h-[36px] rounded-lg border border-brand/40 text-brand-fg hover:bg-brand/10 transition-colors disabled:opacity-50"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" aria-hidden="true" /> {d.requestUpdate}
          </button>
        </div>
      )}
      {pending && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-brand-fg font-medium tabular-nums">
              {updateStatusLabel(d, device.update_status)} → v{pending}
            </span>
            <button
              type="button"
              onClick={() => handleUpdate(null)}
              disabled={busy}
              className="text-xs px-2.5 min-h-[36px] rounded-lg border border-border text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
            >
              {d.cancelUpdate}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">{d.updatePendingNote}</p>
        </div>
      )}
      {failed && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 break-words">
          {updateStatusLabel(d, device.update_status)}
          {device.update_message && <span className="text-muted-foreground"> · {device.update_message}</span>}
        </p>
      )}
      {error && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </li>
  )
}

// ─── 목록 ───────────────────────────────────────────────────────────────────

export function BedDeviceList({ tank, latestVersion }: {
  tank: Tank
  /** 배포된 최신 수집기 버전(/updates/manifest.json). 뷰가 한 번만 받아 내려준다. */
  latestVersion: string | null
}) {
  const { user } = useAuth()
  const { t } = useT()
  const { farms: d } = useAgriT()
  const [devices, setDevices] = useState<SensorDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<SensorDevice | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const mock = isTestAccount(user?.email)

  useEffect(() => {
    let alive = true
    const load = async () => {
      let next: SensorDevice[] = []
      try {
        next = await getSensorDevices(tank.id)
      } catch {
        next = []
      }
      if (next.length === 0 && mock) next = MOCK_SENSOR_DEVICES.filter(dv => dv.tank_id === tank.id)
      if (!alive) return
      setDevices(next)
      setLoading(false)
    }
    void load()
    return () => { alive = false }
  }, [tank.id, mock])

  async function reload() {
    try {
      setDevices(await getSensorDevices(tank.id))
    } catch { /* 목록은 다음 조회에서 맞춰진다 */ }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteSensorDevice(pendingDelete.id)
      setDevices(prev => prev.filter(dv => dv.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch {
      setDeleteError(d.deleteFailed)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="border-t border-border pt-3 mt-1 space-y-2">
      <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
        <Cpu className="w-3.5 h-3.5" aria-hidden="true" />
        {d.devicesHeading}
        {!loading && devices.length > 0 && <span className="tabular-nums">({devices.length})</span>}
      </p>

      {loading ? (
        <div className="h-10 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />
      ) : devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{d.noDevices}</p>
      ) : (
        <ul className="space-y-2">
          {devices.map(device => (
            <DeviceRow
              key={device.id}
              device={device}
              latest={latestVersion}
              onChanged={updated => setDevices(prev => prev.map(dv => dv.id === updated.id ? updated : dv))}
              onDelete={() => setPendingDelete(device)}
            />
          ))}
        </ul>
      )}

      <PairDeviceDialog tank={tank} onSuccess={reload} />

      <Dialog open={pendingDelete !== null} onOpenChange={v => { if (!v) { setPendingDelete(null); setDeleteError(null) } }}>
        <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-sm w-full">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" /> {d.deleteDevice}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              <span className="text-foreground font-medium">{pendingDelete?.name}</span> — {d.deleteDeviceConfirm}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{deleteError}</p>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="border-border text-muted-foreground hover:bg-accent w-full sm:w-auto min-h-[44px]" onClick={() => setPendingDelete(null)}>
              {t.common.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} className={cn("w-full sm:w-auto min-h-[44px]")} onClick={confirmDelete}>
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
