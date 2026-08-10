"use client"

import { useState } from "react"
import { CheckCircle, Link2, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog"
import type { Tank } from "@/types"
import { useT } from "@/lib/i18n-context"

type Result = { device_name: string; tank_name: string; serial: string | null }

/**
 * 기기 화면에 뜬 6자리 코드를 입력해 이 수조에 연결한다.
 *
 * 긴 API 키를 장비에 옮겨 적는 대신, 로그인한 계정 주인이 코드를 승인하는 방식.
 * 승인 전까지 장비는 아무 데이터도 올릴 수 없다.
 */
export function PairDeviceDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<Result | null>(null)

  function close() {
    setOpen(false)
    // 다이얼로그가 닫히는 애니메이션 중에 내용이 바뀌지 않도록 잠깐 뒤에 초기화.
    setTimeout(() => {
      setCode(""); setName(""); setError(""); setResult(null); setSaving(false)
    }, 200)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSaving(true)
    try {
      const res = await fetch("/api/sensors/pair/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, tank_id: tank.id, name }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `${t.pairDevice.connectFailed} (${res.status})`)
      setResult({ device_name: json.device_name, tank_name: json.tank_name, serial: json.serial ?? null })
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
        <button className="w-full text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg py-2 min-h-[36px] transition-colors flex items-center justify-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" />
          {t.pairDevice.trigger}
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-ocean-500" /> {t.pairDevice.trigger}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-foreground font-semibold">{t.pairDevice.done}</p>
              <p className="text-muted-foreground text-xs">
                {t.pairDevice.doneMsg.replace("{{device}}", result.device_name).replace("{{tank}}", result.tank_name)}
              </p>
              {result.serial && (
                <p className="text-[10px] text-muted-foreground font-mono">{result.serial}</p>
              )}
              <p className="text-muted-foreground text-xs mt-1">
                {t.pairDevice.doneHint}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={close} className="bg-ocean-500 hover:bg-ocean-600 text-white w-full">
                {t.common.close}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t.pairDevice.codeHelpBefore}<span className="text-foreground font-semibold">{t.pairDevice.codeDigits}</span>{t.pairDevice.codeHelpAfter}
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="pair-code">{t.pairDevice.codeLabel}</Label>
              <Input
                id="pair-code"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000000"
                value={code}
                // 숫자만 남긴다 — 하이픈이나 공백을 넣어도 그대로 통과시킨다.
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="min-h-[44px] text-center text-2xl font-mono tracking-[0.4em]"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pair-name">{t.pairDevice.nameLabel} <span className="text-muted-foreground font-normal">{t.pairDevice.nameOptional}</span></Label>
              <Input
                id="pair-name"
                placeholder={t.pairDevice.namePlaceholder.replace("{{tank}}", tank.name)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="min-h-[44px]"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2" role="alert">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-500">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="submit"
                disabled={saving || code.length !== 6}
                className="bg-ocean-500 hover:bg-ocean-600 text-white w-full min-h-[44px]"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                {saving ? t.pairDevice.connecting : t.pairDevice.connect}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
