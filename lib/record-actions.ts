import {
  createJournalEntry,
  insertWaterQuality,
  createInventoryTransaction,
} from "@/lib/db"

export const FEED_TYPES = [
  "PHOCA 9071(39%)", "PHOCA 9072(39%)", "PHOCA 9073S(39%)", "PHOCA 9073P(39%)",
  "PHOCA 9074S(39%)", "PHOCA 9074", "PHOCA 9075(39%)", "기타",
]
export const MICROBIAL_TYPES = ["컬리버 1호", "컬리버 2호", "컬리버 3호", "기타"]

export type JournalPersistedDefaults = {
  feed_type?: string
  feeding_times?: string
  microbial_type?: string
  microbial_input?: boolean
  disinfection?: boolean
  disinfection_type?: string
  check_aeration?: boolean
  check_filtration?: boolean
  check_circulation?: boolean
  check_feeding_check?: boolean
}

export const JOURNAL_DEFAULTS_KEY = "journal_form_defaults"

export function loadJournalDefaults(): JournalPersistedDefaults {
  try {
    const raw = localStorage.getItem(JOURNAL_DEFAULTS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function saveJournalDefaults(form: Record<string, unknown>) {
  try {
    const toSave: JournalPersistedDefaults = {
      feed_type:           form.feed_type as string,
      feeding_times:       form.feeding_times as string,
      microbial_type:      form.microbial_type as string,
      microbial_input:     form.microbial_input as boolean,
      disinfection:        form.disinfection as boolean,
      disinfection_type:   form.disinfection_type as string,
      check_aeration:      form.check_aeration as boolean,
      check_filtration:    form.check_filtration as boolean,
      check_circulation:   form.check_circulation as boolean,
      check_feeding_check: form.check_feeding_check as boolean,
    }
    localStorage.setItem(JOURNAL_DEFAULTS_KEY, JSON.stringify(toSave))
  } catch { /* ignore */ }
}

export type JournalFormValues = {
  tank_id: string
  date: string
  feeding_amount: string
  feed_type: string
  feeding_times: string
  mortality_count: string
  water_exchange_rate: string
  disinfection: boolean
  disinfection_type: string
  microbial_input: boolean
  microbial_type: string
  microbial_amount: string
  feedItemId: string
  microbialItemId: string
  chemicalItemId: string
  chemicalQty: string
  check_aeration: boolean
  check_filtration: boolean
  check_circulation: boolean
  check_feeding_check: boolean
  notes: string
}

export async function submitJournal(
  values: JournalFormValues,
  opts: { mock: boolean }
): Promise<void> {
  await createJournalEntry({
    tank_id: values.tank_id,
    date: values.date,
    feeding_amount: parseFloat(values.feeding_amount) || 0,
    feed_type: values.feed_type,
    feeding_times: parseInt(values.feeding_times) || 0,
    mortality_count: parseInt(values.mortality_count) || 0,
    water_exchange_rate: parseInt(values.water_exchange_rate) || 0,
    microbial_input: values.microbial_input,
    microbial_type: values.microbial_input ? values.microbial_type : null,
    microbial_amount: values.microbial_input ? parseFloat(values.microbial_amount) || null : null,
    disinfection: values.disinfection,
    disinfection_type: values.disinfection ? values.disinfection_type : null,
    check_aeration: values.check_aeration,
    check_filtration: values.check_filtration,
    check_circulation: values.check_circulation,
    check_feeding_check: values.check_feeding_check,
    notes: values.notes || null,
  })

  try {
    const deductions: { itemId: string; qty: number; note: string }[] = []
    if (values.feedItemId && parseFloat(values.feeding_amount) > 0)
      deductions.push({ itemId: values.feedItemId, qty: parseFloat(values.feeding_amount), note: `일지 자동차감 - ${values.feed_type}` })
    if (values.microbial_input && values.microbialItemId && parseFloat(values.microbial_amount) > 0)
      deductions.push({ itemId: values.microbialItemId, qty: parseFloat(values.microbial_amount), note: `일지 자동차감 - ${values.microbial_type}` })
    if (values.disinfection && values.chemicalItemId && parseFloat(values.chemicalQty) > 0)
      deductions.push({ itemId: values.chemicalItemId, qty: parseFloat(values.chemicalQty), note: `일지 자동차감 - ${values.disinfection_type || "소독"}` })

    for (const d of deductions) {
      if (!opts.mock) {
        await createInventoryTransaction({
          item_id: d.itemId,
          type: "out",
          quantity: d.qty,
          tank_id: values.tank_id,
          recorded_at: values.date,
          notes: d.note,
        })
      }
    }
  } catch (err) {
    console.error("[record-actions] inventory deduction failed:", err)
    /* inventory deduction failure does not block journal */
  }
}
