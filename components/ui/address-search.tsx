"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, X } from "lucide-react"

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: DaumPostcodeResult) => void
        onclose?: () => void
        width?: string | number
        height?: string | number
      }) => { embed: (el: HTMLElement) => void; open: () => void }
    }
  }
}

interface DaumPostcodeResult {
  address: string        // 기본 주소
  jibunAddress: string   // 지번 주소
  roadAddress: string    // 도로명 주소
  zonecode: string       // 우편번호
  sido: string
  sigungu: string
  bname: string
}

interface AddressSearchProps {
  value: string
  onChange: (address: string) => void
  placeholder?: string
  id?: string
  className?: string
  required?: boolean
  inputClassName?: string
}

const SCRIPT_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"

export function AddressSearch({
  value,
  onChange,
  placeholder = "주소를 검색하세요",
  id,
  required,
  inputClassName,
}: AddressSearchProps) {
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const embedRef = useRef<HTMLDivElement>(null)

  // 스크립트를 미리 로드해 둔다 (한 번만).
  useEffect(() => {
    if (window.daum?.Postcode) { setReady(true); return }
    const existing = document.getElementById("daum-postcode-script") as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", () => setReady(true))
      return
    }
    const script = document.createElement("script")
    script.id = "daum-postcode-script"
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => setReady(true)
    document.head.appendChild(script)
  }, [])

  // 모달이 열리고 스크립트가 준비되면 우편번호 위젯을 iframe으로 임베드한다.
  useEffect(() => {
    if (!open || !ready || !embedRef.current || !window.daum?.Postcode) return
    embedRef.current.innerHTML = ""
    new window.daum.Postcode({
      oncomplete(data: DaumPostcodeResult) {
        const addr = data.roadAddress || data.jibunAddress || data.address
        onChange(addr)
        setOpen(false)
      },
      onclose() {
        setOpen(false)
      },
      width: "100%",
      height: "100%",
    }).embed(embedRef.current)
  }, [open, ready, onChange])

  return (
    <>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          readOnly
          onClick={() => setOpen(true)}
          className={`cursor-pointer bg-muted/50 ${inputClassName ?? ""}`}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="shrink-0 gap-1.5 px-3"
        >
          <Search className="w-4 h-4" />
          <span className="hidden sm:inline">주소 검색</span>
        </Button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="주소 검색"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
            style={{ height: "70vh", maxHeight: 560 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-sm font-semibold text-foreground">주소 검색</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 relative">
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div ref={embedRef} className="w-full h-full" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
