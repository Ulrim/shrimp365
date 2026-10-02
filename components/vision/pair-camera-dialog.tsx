"use client"

import { useState } from "react"
import { CheckCircle, Link2, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { Tank } from "@/types"

type Result = { camera_name: string; tank_name: string; serial: string | null }

/**
 * 라즈베리파이 화면(또는 로그)에 뜬 6자리 코드를 입력해 카메라를 수조에 연결한다.
 *
 * 수질 센서 기기 등록(components/sensors/pair-device-dialog.tsx)과 같은 방식이다.
 * 긴 기기 키를 파이 설정 파일에 옮겨 적는 대신, 로그인한 계정 주인이 코드를
 * 승인한다. 승인 전까지 그 파이는 어떤 카메라도 맡지 못한다.
 */
export function PairCameraDialog({
  tanks, onSuccess,
}: {
  tanks: Tank[]
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [tankId, setTankId] = useState("")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<Result | null>(null)

  const effectiveTankId = tankId || tanks[0]?.id || ""

  function close() {
    setOpen(false)
    // 닫히는 애니메이션 중에 내용이 바뀌지 않도록 잠깐 뒤에 초기화한다.
    setTimeout(() => {
      setCode(""); setName(""); setError(""); setResult(null); setSaving(false)
    }, 200)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSaving(true)
    try {
      const res = await fetch("/api/vision/pair/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, tank_id: effectiveTankId, name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `연결에 실패했습니다. (${res.status})`)
      setResult({
        camera_name: json.camera_name,
        tank_name: json.tank_name,
        serial: json.serial ?? null,
      })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button variant="ocean" disabled={tanks.length === 0}>
          <Link2 className="w-4 h-4" /> 카메라 연결
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-ocean-500" /> 카메라 연결
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle className="w-5 h-5" />
              <p className="font-medium">연결되었습니다</p>
            </div>
            <div className="rounded-xl border border-border bg-muted p-3 text-sm space-y-1">
              <p><span className="text-muted-foreground">카메라</span> {result.camera_name}</p>
              <p><span className="text-muted-foreground">수조</span> {result.tank_name}</p>
              {result.serial && (
                <p className="font-mono text-xs text-muted-foreground">
                  시리얼 {result.serial}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              라즈베리파이가 잠시 뒤 스스로 연결을 확인하고 개체수를 올리기 시작합니다.
            </p>
            <DialogFooter>
              <Button onClick={close}>확인</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              라즈베리파이에 뜬 6자리 코드를 입력하세요. 코드는 15분간 유효합니다.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="pair-code">연결 코드</Label>
              <Input
                id="pair-code"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="off"
                className="text-center text-2xl tracking-[0.4em] font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label>수조</Label>
              <Select value={effectiveTankId} onValueChange={setTankId}>
                <SelectTrigger><SelectValue placeholder="수조를 고르세요" /></SelectTrigger>
                <SelectContent>
                  {tanks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pair-name">카메라 이름 (선택)</Label>
              <Input
                id="pair-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="비워 두면 수조 이름으로 만듭니다"
              />
            </div>

            {error && (
              <p className="flex items-start gap-2 text-sm text-red-500">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>취소</Button>
              <Button type="submit" variant="ocean" disabled={saving || code.length !== 6 || !effectiveTankId}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                연결
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
