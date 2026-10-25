"use client"

// 전력 카드의 회로 한 줄 아래 — 켜기·끄기·예약대로 단추와 예약 설정.
//
// 웹은 장비에 직접 닿지 못한다. 단추를 누르면 명령함에 넣고(/api/power/command), 장비가 15초마다
// 가져가 실행한 뒤 결과를 돌려준다(app/api/sensors/power). 그래서 누른 뒤 결과를 몇 초 기다린다.
// 안전 규칙은 장비가 지킨다 — 과열 중 켜기 거절, 산소 부족이면 산소공급기를 다시 켠다.
import { useEffect, useRef, useState } from "react"
import { Loader2, CalendarClock, Plus, Trash2 } from "lucide-react"
import { useT } from "@/lib/i18n-context"
import { powerControlDict, type PowerControlDict } from "@/lib/i18n/power-control"
import {
  POWER_MODES, MAX_TIMERS, checkRule, type CircuitControl, type PowerMode, type PowerRule, type CommandStatus,
} from "@/lib/power-remote"

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const KEEP_CHOICES = [0, 30, 60, 120, 240]
const POLL_MS = 2500
const GIVE_UP_MS = 60_000

type Msg = { kind: "busy" | "ok" | "err"; text: string } | null

const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((a, [k, x]) => a.replaceAll(`{{${k}}}`, String(x)), s)

function defaultsFor(mode: PowerMode, base: PowerRule): PowerRule {
  const r: PowerRule = { mode, auto_off_min: base.auto_off_min ?? 0 }
  if (mode !== "do" && base.do_guard_below) r.do_guard_below = base.do_guard_below
  if (mode === "timer") r.timers = base.timers?.length ? base.timers : [{ on: "06:00", off: "18:00", days: ALL_DAYS }]
  if (mode === "cycle") r.cycle = base.cycle ?? { on_min: 15, off_min: 45, from: "06:00", to: "18:00", days: ALL_DAYS }
  if (mode === "do") r.do = base.do ?? { on_below: 5, off_above: 6, min_on_min: 10 }
  return r
}

export function CircuitControlBar({ tankId, deviceId, circuitId, ctl, online, clockOk, onChanged }: {
  tankId: string
  deviceId: string
  circuitId: string
  ctl: CircuitControl
  online: boolean
  clockOk: boolean
  /** 장비가 실행했다 — 카드가 제어 상태와 값을 다시 읽는다. */
  onChanged: () => void
}) {
  const { locale } = useT()
  const d = powerControlDict[locale]
  const [msg, setMsg] = useState<Msg>(null)
  const [keep, setKeep] = useState(0)
  const [editing, setEditing] = useState<PowerRule | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const busy = msg?.kind === "busy"
  const disabled = !online || !ctl.can || busy

  async function send(payload: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current)
    setMsg({ kind: "busy", text: d.sending })
    let id: string
    try {
      const res = await fetch("/api/power/command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tank_id: tankId, device_id: deviceId, circuit: circuitId, ...payload }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || typeof j.id !== "string") {
        setMsg({ kind: "err", text: d.errors[j.error as string] ?? d.errors.server })
        return false
      }
      id = j.id
    } catch {
      setMsg({ kind: "err", text: d.errors.network })
      return false
    }
    const started = Date.now()
    const poll = async () => {
      let status: CommandStatus | undefined, result: string | null = null
      try {
        const r = await fetch(`/api/power/command?id=${id}`, { cache: "no-store" })
        if (r.ok) ({ status, result } = await r.json())
      } catch { /* 다음 번에 다시 */ }
      if (status === "done") { setMsg({ kind: "ok", text: d.done }); onChanged(); return }
      if (status === "failed") { setMsg({ kind: "err", text: fill(d.failed, { e: result || "?" }) }); onChanged(); return }
      if (status === "expired" || Date.now() - started > GIVE_UP_MS) { setMsg({ kind: "err", text: d.expired }); return }
      timer.current = setTimeout(poll, POLL_MS)
    }
    timer.current = setTimeout(poll, POLL_MS)
    return true
  }

  function setOn(on: boolean) {
    if (!on && ctl.confirm_off && !window.confirm(d.confirmOff)) return
    void send({ action: "set", on, ...(keep ? { minutes: keep } : {}) })
  }

  async function saveRule() {
    if (!editing) return
    const bad = checkRule(editing)
    if (bad) { setMsg({ kind: "err", text: d.errors[bad] ?? d.errors.bad }); return }
    if (await send({ action: "rule", rule: editing })) setEditing(null)
  }

  const rule = ctl.rule
  const status: string[] = [d.mode[rule.mode] ?? rule.mode]
  if (ctl.do_forced) status.push(d.doForced)
  else if (ctl.override) {
    const until = ctl.override.until ? ctl.override.until.slice(11, 16) : ""
    status.push(until ? fill(d.overrideUntil, { t: until }) : d.override)
  } else if (ctl.scheduled != null) status.push(ctl.scheduled ? d.schedOn : d.schedOff)

  if (!ctl.can) return null

  return (
    <div className="px-3 pb-2.5 -mt-0.5 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" disabled={disabled} onClick={() => setOn(true)}
          className="h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-40">
          {d.turnOn}
        </button>
        <button type="button" disabled={disabled} onClick={() => setOn(false)}
          className="h-8 px-3 rounded-lg text-xs font-semibold bg-muted text-foreground border border-border disabled:opacity-40">
          {d.turnOff}
        </button>
        {ctl.override && (
          <button type="button" disabled={disabled} onClick={() => void send({ action: "auto" })}
            className="h-8 px-3 rounded-lg text-xs font-semibold border border-border text-foreground disabled:opacity-40">
            {d.auto}
          </button>
        )}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {d.keep}
          <select value={keep} onChange={e => setKeep(Number(e.target.value))} disabled={disabled}
            className="h-8 rounded-lg border border-border bg-background px-1.5 text-xs text-foreground">
            {KEEP_CHOICES.map(m => <option key={m} value={m}>{m ? fill(d.minutes, { m }) : d.keepAlways}</option>)}
          </select>
        </label>
        <button type="button" disabled={!online || busy}
          onClick={() => setEditing(editing ? null : defaultsFor(rule.mode, rule))}
          className="h-8 px-2.5 rounded-lg text-xs font-semibold border border-border text-foreground flex items-center gap-1 ml-auto disabled:opacity-40">
          <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />{d.editRule}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{status.join(" · ")}</p>
      {!clockOk && rule.mode !== "manual" && rule.mode !== "do" && <p className="text-xs text-amber-600 dark:text-amber-400">{d.clockBad}</p>}
      {ctl.error && <p className="text-xs text-amber-600 dark:text-amber-400">{fill(d.deviceSays, { e: ctl.error })}</p>}
      {msg && (
        <p role="status" className={`text-xs flex items-center gap-1 ${
          msg.kind === "err" ? "text-red-600 dark:text-red-400" : msg.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
        }`}>
          {msg.kind === "busy" && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}{msg.text}
        </p>
      )}
      {editing && (
        <RuleEditor d={d} rule={editing} onChange={setEditing} busy={busy}
          onSave={() => void saveRule()} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}

const inputCls = "h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground tabular-nums"

function NumField({ label, value, step = 1, onChange }: {
  label: string; value: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground min-w-0">
      {label}
      <input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ""}
        onChange={e => onChange(e.target.value === "" ? NaN : Number(e.target.value))} className={`${inputCls} w-full`} />
    </label>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground min-w-0">
      {label}
      <input type="time" value={value === "24:00" ? "23:59" : value} onChange={e => onChange(e.target.value)}
        className={`${inputCls} w-full`} />
    </label>
  )
}

function DayPicker({ d, days, onChange }: { d: PowerControlDict; days: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-1 flex-wrap" role="group" aria-label={d.days}>
      {ALL_DAYS.map(i => {
        const on = days.includes(i)
        return (
          <button key={i} type="button" aria-pressed={on}
            onClick={() => onChange(on ? days.filter(x => x !== i) : [...days, i].sort())}
            className={`h-7 min-w-8 px-1.5 rounded-md text-xs font-semibold border ${
              on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
            }`}>
            {d.dayNames[i]}
          </button>
        )
      })}
    </div>
  )
}

function RuleEditor({ d, rule, onChange, onSave, onCancel, busy }: {
  d: PowerControlDict; rule: PowerRule; busy: boolean
  onChange: (r: PowerRule) => void; onSave: () => void; onCancel: () => void
}) {
  const set = (patch: Partial<PowerRule>) => onChange({ ...rule, ...patch })
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex gap-1 flex-wrap" role="radiogroup">
        {POWER_MODES.map(m => (
          <button key={m} type="button" role="radio" aria-checked={rule.mode === m}
            onClick={() => onChange(defaultsFor(m, rule))}
            className={`h-8 px-2.5 rounded-lg text-xs font-semibold border ${
              rule.mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground"
            }`}>
            {d.mode[m]}
          </button>
        ))}
      </div>

      {rule.mode === "timer" && (
        <div className="space-y-2">
          {(rule.timers ?? []).map((t, i) => {
            const upd = (p: Partial<typeof t>) => set({ timers: rule.timers!.map((x, j) => j === i ? { ...x, ...p } : x) })
            return (
              <div key={i} className="rounded-lg border border-border bg-background p-2 space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <TimeField label={d.onAt} value={t.on} onChange={v => upd({ on: v })} />
                  <TimeField label={d.offAt} value={t.off} onChange={v => upd({ off: v })} />
                  <button type="button" aria-label={d.remove} disabled={rule.timers!.length <= 1}
                    onClick={() => set({ timers: rule.timers!.filter((_, j) => j !== i) })}
                    className="h-8 w-8 grid place-items-center rounded-lg border border-border text-muted-foreground disabled:opacity-30">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <DayPicker d={d} days={t.days} onChange={v => upd({ days: v })} />
              </div>
            )
          })}
          {(rule.timers?.length ?? 0) < MAX_TIMERS && (
            <button type="button"
              onClick={() => set({ timers: [...(rule.timers ?? []), { on: "06:00", off: "07:00", days: ALL_DAYS }] })}
              className="h-8 px-2.5 rounded-lg text-xs font-semibold border border-dashed border-border text-foreground flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />{d.addTimer}
            </button>
          )}
        </div>
      )}

      {rule.mode === "cycle" && rule.cycle && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <NumField label={d.cycleOn} value={rule.cycle.on_min} onChange={v => set({ cycle: { ...rule.cycle!, on_min: v } })} />
            <NumField label={d.cycleOff} value={rule.cycle.off_min} onChange={v => set({ cycle: { ...rule.cycle!, off_min: v } })} />
            <TimeField label={d.from} value={rule.cycle.from} onChange={v => set({ cycle: { ...rule.cycle!, from: v } })} />
            <TimeField label={d.to} value={rule.cycle.to} onChange={v => set({ cycle: { ...rule.cycle!, to: v } })} />
          </div>
          <DayPicker d={d} days={rule.cycle.days} onChange={v => set({ cycle: { ...rule.cycle!, days: v } })} />
        </div>
      )}

      {rule.mode === "do" && rule.do && (
        <div className="grid grid-cols-3 gap-2">
          <NumField label={d.doOnBelow} step={0.1} value={rule.do.on_below} onChange={v => set({ do: { ...rule.do!, on_below: v } })} />
          <NumField label={d.doOffAbove} step={0.1} value={rule.do.off_above} onChange={v => set({ do: { ...rule.do!, off_above: v } })} />
          <NumField label={d.doMinOn} value={rule.do.min_on_min} onChange={v => set({ do: { ...rule.do!, min_on_min: v } })} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumField label={d.autoOff} value={rule.auto_off_min ?? 0} onChange={v => set({ auto_off_min: v })} />
        {rule.mode !== "do" && (
          <NumField label={d.guard} step={0.1} value={rule.do_guard_below ?? 0}
            onChange={v => set({ do_guard_below: v })} />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{d.ruleNote}</p>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="h-8 px-3 rounded-lg text-xs font-semibold border border-border text-foreground">
          {d.cancel}
        </button>
        <button type="button" onClick={onSave} disabled={busy}
          className="h-8 px-3 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-40">
          {d.save}
        </button>
      </div>
    </div>
  )
}
