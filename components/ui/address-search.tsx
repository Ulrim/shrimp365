"use client"

import { useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: DaumPostcodeResult) => void
        onclose?: () => void
        width?: number
        height?: number
      }) => { open: () => void }
    }
  }
}

interface DaumPostcodeResult {
  address: string        // 도로명 주소
  jibunAddress: string   // 지번 주소
  roadAddress: string
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

export function AddressSearch({
  value,
  onChange,
  placeholder = "주소를 검색하세요",
  id,
  required,
  inputClassName,
}: AddressSearchProps) {
  const scriptLoaded = useRef(false)

  useEffect(() => {
    if (scriptLoaded.current || document.getElementById("daum-postcode-script")) return
    const script = document.createElement("script")
    script.id = "daum-postcode-script"
    script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
    script.async = true
    document.head.appendChild(script)
    scriptLoaded.current = true
  }, [])

  function openPostcode() {
    if (!window.daum?.Postcode) {
      alert("주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.")
      return
    }
    new window.daum.Postcode({
      oncomplete(data: DaumPostcodeResult) {
        // 도로명 주소 우선, 없으면 지번
        const addr = data.roadAddress || data.jibunAddress || data.address
        onChange(addr)
      },
    }).open()
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        readOnly
        onClick={openPostcode}
        className={`cursor-pointer bg-muted/50 ${inputClassName ?? ""}`}
      />
      <Button
        type="button"
        variant="outline"
        onClick={openPostcode}
        className="shrink-0 gap-1.5 px-3"
      >
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">주소 검색</span>
      </Button>
    </div>
  )
}
