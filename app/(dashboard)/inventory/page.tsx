"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Package, Plus, ArrowDownToLine, ArrowUpFromLine, Trash2, Edit2, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import {
  getInventoryItems, createInventoryItem, updateInventoryItem, deleteInventoryItem,
  getInventoryTransactions, createInventoryTransaction, deleteInventoryTransaction,
  getAllTanks,
} from "@/lib/db"
import { isTestAccount, MOCK_INVENTORY_ITEMS, MOCK_INVENTORY_TRANSACTIONS, MOCK_TANKS } from "@/lib/mock-data"
import type { InventoryItem, InventoryTransaction, Tank } from "@/types"

type Category = InventoryItem["category"]

const CAT_COLORS: Record<Category, string> = {
  feed:      "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  probiotic: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30",
  chemical:  "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30",
  other:     "bg-muted-foreground/10 text-muted-foreground border-border",
}

function stockBadge(item: InventoryItem, t: ReturnType<typeof useT>["t"]) {
  if (item.reorder_level > 0 && item.current_stock <= 0) return { label: t.inventory.critical, cls: "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30", ariaLabel: t.a11y.stockOutDesc }
  if (item.reorder_level > 0 && item.current_stock <= item.reorder_level) return { label: t.inventory.warning, cls: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30", ariaLabel: t.a11y.stockLowDesc }
  return { label: t.inventory.sufficient, cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", ariaLabel: t.a11y.stockOkDesc }
}

// ─── Item Form Dialog ───────────────────────────────────────────────────────
interface ItemDialogProps {
  open: boolean
  item?: InventoryItem
  onClose: () => void
  onSave: (values: { category: Category; name: string; unit: string; current_stock: number; reorder_level: number; notes?: string }, id?: string) => Promise<void>
  t: ReturnType<typeof useT>["t"]
}
function ItemDialog({ open, item, onClose, onSave, t }: ItemDialogProps) {
  const [category, setCategory] = useState<Category>(item?.category ?? "feed")
  const [name, setName] = useState(item?.name ?? "")
  const [unit, setUnit] = useState(item?.unit ?? "")
  const [currentStock, setCurrentStock] = useState(String(item?.current_stock ?? ""))
  const [reorderLevel, setReorderLevel] = useState(String(item?.reorder_level ?? ""))
  const [notes, setNotes] = useState(item?.notes ?? "")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setCategory(item?.category ?? "feed")
      setName(item?.name ?? "")
      setUnit(item?.unit ?? "")
      setCurrentStock(String(item?.current_stock ?? ""))
      setReorderLevel(String(item?.reorder_level ?? ""))
      setNotes(item?.notes ?? "")
    }
  }, [open, item])

  if (!open) return null

  const categories: { value: Category; label: string }[] = [
    { value: "feed", label: t.inventory.catFeed },
    { value: "probiotic", label: t.inventory.catProbiotic },
    { value: "chemical", label: t.inventory.catChemical },
    { value: "other", label: t.inventory.catOther },
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({ category, name, unit, current_stock: parseFloat(currentStock) || 0, reorder_level: parseFloat(reorderLevel) || 0, notes: notes || undefined }, item?.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-[95vw] sm:max-w-md shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">{item ? t.inventory.editItem : t.inventory.addItem}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.inventory.category}</label>
            <div className="grid grid-cols-2 gap-2">
              {categories.map(c => (
                <button key={c.value} type="button" onClick={() => setCategory(c.value)}
                  className={cn("px-3 py-2 rounded-xl text-sm font-medium border transition-colors", category === c.value ? CAT_COLORS[c.value] : "border-border text-muted-foreground hover:border-border/60")}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.inventory.itemName}</label>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder={t.inventory.itemNamePlaceholder}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ocean-500" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.inventory.unit}</label>
            <input required value={unit} onChange={e => setUnit(e.target.value)} placeholder={t.inventory.unitPlaceholder}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ocean-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.inventory.currentStock}</label>
              <input type="number" min="0" step="any" value={currentStock} onChange={e => setCurrentStock(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.inventory.reorderLevel}</label>
              <input type="number" min="0" step="any" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.common.note}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ocean-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1 border-border min-h-[44px]" onClick={onClose}>{t.common.cancel}</Button>
            <Button type="submit" disabled={saving} className="flex-1 bg-ocean-600 hover:bg-ocean-500 min-h-[44px]">
              {saving ? t.inventory.saving : t.common.save}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Transaction Form Dialog ────────────────────────────────────────────────
interface TxDialogProps {
  open: boolean
  item: InventoryItem
  tanks: Tank[]
  onClose: () => void
  onSave: (values: { type: "in" | "out"; quantity: number; unit_price?: number; tank_id?: string; supplier?: string; recorded_at: string; notes?: string }) => Promise<void>
  t: ReturnType<typeof useT>["t"]
}
function TxDialog({ open, item, tanks, onClose, onSave, t }: TxDialogProps) {
  const [txType, setTxType] = useState<"in" | "out">("in")
  const [quantity, setQuantity] = useState("")
  const [unitPrice, setUnitPrice] = useState("")
  const [tankId, setTankId] = useState("")
  const [supplier, setSupplier] = useState("")
  const [recordedAt, setRecordedAt] = useState(format(new Date(), "yyyy-MM-dd"))
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setTxType("in"); setQuantity(""); setUnitPrice(""); setTankId(""); setSupplier(""); setRecordedAt(format(new Date(), "yyyy-MM-dd")); setNotes("") }
  }, [open])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        type: txType,
        quantity: parseFloat(quantity) || 0,
        unit_price: unitPrice ? parseFloat(unitPrice) : undefined,
        tank_id: tankId || undefined,
        supplier: supplier || undefined,
        recorded_at: recordedAt,
        notes: notes || undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-[95vw] sm:max-w-md shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">{t.inventory.addTx} — {item.name}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setTxType("in")}
              className={cn("flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors", txType === "in" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "border-border text-muted-foreground hover:border-border/60")}>
              <ArrowDownToLine className="w-4 h-4" />{t.inventory.txIn}
            </button>
            <button type="button" onClick={() => setTxType("out")}
              className={cn("flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors", txType === "out" ? "bg-red-500/20 text-red-400 border-red-500/30" : "border-border text-muted-foreground hover:border-border/60")}>
              <ArrowUpFromLine className="w-4 h-4" />{t.inventory.txOut}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.inventory.quantity} ({item.unit})</label>
              <input required type="number" min="0.01" step="any" value={quantity} onChange={e => setQuantity(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500" />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.inventory.unitPrice}</label>
              <input type="number" min="0" step="any" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="0"
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ocean-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.common.date}</label>
            <input required type="date" value={recordedAt} onChange={e => setRecordedAt(e.target.value)}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500" />
          </div>
          {txType === "in" && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.inventory.supplier}</label>
              <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={t.inventory.supplierPlaceholder}
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ocean-500" />
            </div>
          )}
          {txType === "out" && tanks.length > 0 && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">{t.inventory.tank}</label>
              <select value={tankId} onChange={e => setTankId(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500">
                <option value="">{t.inventory.selectTank}</option>
                {tanks.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">{t.common.note}</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ocean-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1 border-border min-h-[44px]" onClick={onClose}>{t.common.cancel}</Button>
            <Button type="submit" disabled={saving} className={cn("flex-1 min-h-[44px]", txType === "in" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500")}>
              {saving ? t.inventory.saving : (txType === "in" ? t.inventory.txIn : t.inventory.txOut)}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const { user } = useAuth()
  const { t } = useT()
  const mock = isTestAccount(user?.email)

  const [items, setItems] = useState<InventoryItem[]>([])
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [catFilter, setCatFilter] = useState<Category | "all">("all")

  const [showItemDialog, setShowItemDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>()
  const [showTxDialog, setShowTxDialog] = useState(false)
  const [txItem, setTxItem] = useState<InventoryItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (mock) {
        setItems(MOCK_INVENTORY_ITEMS)
        setTransactions(MOCK_INVENTORY_TRANSACTIONS)
        setTanks(MOCK_TANKS)
      } else {
        const [itemsData, txData, tanksData] = await Promise.all([
          getInventoryItems(),
          getInventoryTransactions(),
          getAllTanks(),
        ])
        setItems(itemsData)
        setTransactions(txData)
        setTanks(tanksData)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [mock])

  useEffect(() => { load() }, [load])

  // Auto-select first item
  useEffect(() => {
    if (!selectedItem && items.length > 0) setSelectedItem(items[0])
  }, [items, selectedItem])

  const filteredItems = catFilter === "all" ? items : items.filter(i => i.category === catFilter)

  const categories: { value: Category | "all"; label: string }[] = [
    { value: "all", label: t.common.all },
    { value: "feed", label: t.inventory.catFeed },
    { value: "probiotic", label: t.inventory.catProbiotic },
    { value: "chemical", label: t.inventory.catChemical },
    { value: "other", label: t.inventory.catOther },
  ]

  const lowStockCount = items.filter(i => i.reorder_level > 0 && i.current_stock <= i.reorder_level).length

  const selectedTxs = transactions.filter(tx => tx.item_id === selectedItem?.id)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))

  async function handleSaveItem(values: { category: Category; name: string; unit: string; current_stock: number; reorder_level: number; notes?: string }, id?: string) {
    if (mock) {
      if (id) {
        setItems(prev => prev.map(i => i.id === id ? { ...i, ...values, notes: values.notes ?? null, updated_at: new Date().toISOString() } : i))
      } else {
        const newItem: InventoryItem = { id: `inv-${Date.now()}`, user_id: "mock-user-1", ...values, notes: values.notes ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        setItems(prev => [...prev, newItem])
        setSelectedItem(newItem)
      }
      return
    }
    if (id) {
      await updateInventoryItem(id, values)
    } else {
      await createInventoryItem(values)
    }
    await load()
  }

  async function handleDeleteItem(item: InventoryItem) {
    if (!confirm(t.inventory.deleteItemConfirm)) return
    if (mock) {
      setItems(prev => prev.filter(i => i.id !== item.id))
      setTransactions(prev => prev.filter(tx => tx.item_id !== item.id))
      if (selectedItem?.id === item.id) setSelectedItem(null)
      return
    }
    await deleteInventoryItem(item.id)
    await load()
    if (selectedItem?.id === item.id) setSelectedItem(null)
  }

  async function handleSaveTx(values: { type: "in" | "out"; quantity: number; unit_price?: number; tank_id?: string; supplier?: string; recorded_at: string; notes?: string }) {
    if (!txItem) return
    if (mock) {
      const newTx: InventoryTransaction = {
        id: `tx-${Date.now()}`, item_id: txItem.id, item_name: txItem.name, item_unit: txItem.unit,
        user_id: "mock-user-1", tank_name: null, ...values, unit_price: values.unit_price ?? null,
        tank_id: values.tank_id ?? null, supplier: values.supplier ?? null, notes: values.notes ?? null,
        created_at: new Date().toISOString(),
      }
      setTransactions(prev => [newTx, ...prev])
      const delta = values.type === "in" ? values.quantity : -values.quantity
      setItems(prev => prev.map(i => i.id === txItem.id ? { ...i, current_stock: Math.max(0, i.current_stock + delta), updated_at: new Date().toISOString() } : i))
      return
    }
    await createInventoryTransaction({ ...values, item_id: txItem.id })
    await load()
  }

  async function handleDeleteTx(tx: InventoryTransaction) {
    if (!confirm(t.inventory.deleteTxConfirm)) return
    if (mock) {
      setTransactions(prev => prev.filter(t => t.id !== tx.id))
      const delta = tx.type === "in" ? -tx.quantity : tx.quantity
      setItems(prev => prev.map(i => i.id === tx.item_id ? { ...i, current_stock: Math.max(0, i.current_stock + delta), updated_at: new Date().toISOString() } : i))
      return
    }
    await deleteInventoryTransaction(tx.id, tx.item_id, tx.type, tx.quantity)
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t.common.loading}</div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="w-6 h-6 text-ocean-500" />{t.inventory.title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t.inventory.subtitle}</p>
        </div>
        <Button onClick={() => { setEditingItem(undefined); setShowItemDialog(true) }}
          aria-label={t.inventory.addItem}
          className="bg-ocean-600 hover:bg-ocean-500 gap-2 min-h-[44px]">
          <Plus className="w-4 h-4" />{t.inventory.addItem}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-muted border border-border rounded-2xl p-4">
          <div className="text-muted-foreground text-xs mb-1">{t.inventory.totalItems}</div>
          <div className="text-2xl font-bold text-foreground">{items.length}</div>
        </div>
        <div className={cn("border rounded-2xl p-4", lowStockCount > 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-muted border-border")}>
          <div className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
            {lowStockCount > 0 && <AlertTriangle className="w-3 h-3 text-amber-500" />}
            {t.inventory.lowStockItems}
          </div>
          <div className={cn("text-2xl font-bold", lowStockCount > 0 ? "text-amber-500" : "text-foreground")}>{lowStockCount}</div>
        </div>
        <div className="bg-muted border border-border rounded-2xl p-4 col-span-2 sm:col-span-1">
          <div className="text-muted-foreground text-xs mb-1">{t.inventory.recentActivity}</div>
          <div className="text-2xl font-bold text-foreground">{transactions.filter(tx => {
            const d = new Date(tx.recorded_at)
            const now = new Date()
            return (now.getTime() - d.getTime()) < 7 * 86400000
          }).length}<span className="text-sm font-normal text-muted-foreground ml-1">{t.a11y.recentActivityUnit}</span></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left — Item List */}
        <div className="lg:col-span-2 space-y-3">
          {/* Category filter */}
          <div className="flex gap-1 flex-wrap">
            {categories.map(c => (
              <button key={c.value} onClick={() => setCatFilter(c.value)}
                aria-label={`${c.label} ${t.a11y.categoryFilter}`}
                aria-pressed={catFilter === c.value}
                className={cn("px-3 py-1 min-h-[44px] rounded-full text-xs font-medium transition-colors border",
                  catFilter === c.value ? "bg-ocean-600 text-white border-ocean-600" : "border-border text-muted-foreground hover:border-border/60 hover:text-foreground/80")}>
                {c.label}
              </button>
            ))}
          </div>

          {filteredItems.length === 0 ? (
            <div className="bg-muted border border-border rounded-2xl p-8 text-center">
              <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">{t.inventory.noItems}</p>
              <p className="text-muted-foreground text-sm mt-1">{t.inventory.noItemsMsg}</p>
            </div>
          ) : (
            filteredItems.map(item => {
              const badge = stockBadge(item, t)
              const isSelected = selectedItem?.id === item.id
              return (
                <div key={item.id} onClick={() => setSelectedItem(item)}
                  className={cn("bg-muted border rounded-2xl p-4 cursor-pointer transition-all",
                    isSelected ? "border-ocean-500/50 bg-ocean-500/5" :
                    item.reorder_level > 0 && item.current_stock <= 0 ? "border-red-500/40 hover:border-red-500/60" :
                    item.reorder_level > 0 && item.current_stock <= item.reorder_level ? "border-amber-500/40 hover:border-amber-500/60" :
                    "border-border hover:border-border/60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", CAT_COLORS[item.category])}>
                          {t.inventory[`cat${item.category.charAt(0).toUpperCase() + item.category.slice(1)}` as keyof typeof t.inventory]}
                        </span>
                        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", badge.cls)} aria-label={badge.ariaLabel}>{badge.label}</span>
                      </div>
                      <p className="text-foreground font-medium mt-1.5 truncate">{item.name}</p>
                      <p className="text-muted-foreground text-sm mt-0.5">
                        <span className={cn("font-semibold",
                          item.reorder_level > 0 && item.current_stock <= 0 ? "text-red-600 dark:text-red-400" :
                          item.reorder_level > 0 && item.current_stock <= item.reorder_level ? "text-amber-600 dark:text-amber-400" :
                          "text-foreground"
                        )}>{item.current_stock.toLocaleString()}</span> {item.unit}
                        {item.reorder_level > 0 && <span className="text-muted-foreground ml-2">/ {t.a11y.reorderShort} {item.reorder_level.toLocaleString()}</span>}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={e => { e.stopPropagation(); setEditingItem(item); setShowItemDialog(true) }}
                        aria-label={`${item.name} ${t.common.edit}`}
                        className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-ocean-500 transition-colors rounded-lg hover:bg-ocean-500/10">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDeleteItem(item) }}
                        aria-label={`${item.name} ${t.common.delete}`}
                        className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors rounded-lg hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Right — Transaction Detail */}
        <div className="lg:col-span-3">
          {selectedItem ? (
            <div className="bg-muted border border-border rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-border flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-foreground font-bold">{selectedItem.name}</h2>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {t.inventory.currentStock}: <span className="text-foreground font-semibold">{selectedItem.current_stock.toLocaleString()} {selectedItem.unit}</span>
                  </p>
                </div>
                <Button size="sm" onClick={() => { setTxItem(selectedItem); setShowTxDialog(true) }}
                  aria-label={`${selectedItem.name} ${t.inventory.addTx}`}
                  className="bg-ocean-600 hover:bg-ocean-500 gap-1.5 shrink-0 min-h-[44px]">
                  <Plus className="w-3.5 h-3.5" />{t.inventory.addTx}
                </Button>
              </div>

              {selectedTxs.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-muted-foreground">{t.inventory.noTransactions}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {selectedTxs.map(tx => (
                    <div key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent group transition-colors">
                      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                        tx.type === "in" ? "bg-emerald-500/20" : "bg-red-500/20")}>
                        {tx.type === "in"
                          ? <TrendingUp className="w-4 h-4 text-emerald-500" />
                          : <TrendingDown className="w-4 h-4 text-red-500" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-sm font-semibold", tx.type === "in" ? "text-emerald-500" : "text-red-500")}>
                            {tx.type === "in" ? "+" : "-"}{tx.quantity.toLocaleString()} {tx.item_unit ?? selectedItem.unit}
                          </span>
                          {tx.supplier && <span className="text-muted-foreground text-xs">({tx.supplier})</span>}
                          {tx.tank_name && <span className="text-muted-foreground text-xs">→ {tx.tank_name}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-muted-foreground text-xs">{tx.recorded_at}</span>
                          {tx.unit_price && <span className="text-muted-foreground text-xs">· @{tx.unit_price.toLocaleString()}{t.a11y.currency}/{tx.item_unit}</span>}
                          {tx.notes && <span className="text-muted-foreground text-xs truncate">· {tx.notes}</span>}
                        </div>
                      </div>
                      <button onClick={() => handleDeleteTx(tx)}
                        aria-label={`${tx.recorded_at} ${tx.type === "in" ? t.inventory.txIn : t.inventory.txOut} ${t.a11y.deleteRecord}`}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-red-500 transition-all rounded-lg hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-muted border border-border rounded-2xl p-8 text-center">
              <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{t.inventory.noItems}</p>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ItemDialog
        open={showItemDialog}
        item={editingItem}
        onClose={() => { setShowItemDialog(false); setEditingItem(undefined) }}
        onSave={handleSaveItem}
        t={t}
      />
      {txItem && (
        <TxDialog
          open={showTxDialog}
          item={txItem}
          tanks={tanks}
          onClose={() => { setShowTxDialog(false); setTxItem(null) }}
          onSave={handleSaveTx}
          t={t}
        />
      )}
    </div>
  )
}
