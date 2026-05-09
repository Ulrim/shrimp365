import Link from "next/link"
import { Waves, ArrowLeft } from "lucide-react"

export const metadata = { title: "환불 정책 | Shrimp365" }

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">홈으로</span>
          </Link>
          <div className="flex items-center gap-2">
            <Waves className="w-5 h-5 text-ocean-400" />
            <span className="font-bold">Shrimp365</span>
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-2">환불 정책</h1>
        <p className="text-slate-400 text-sm mb-10">최종 수정일: 2026년 5월 9일</p>

        <div className="space-y-8 text-slate-300 leading-relaxed">
          <section className="bg-ocean-500/10 border border-ocean-500/30 rounded-xl p-5">
            <p className="text-ocean-300 font-medium">Shrimp365는 고객 만족을 최우선으로 합니다. 서비스에 만족하지 못하신 경우 아래 정책에 따라 환불을 요청하실 수 있습니다.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">제1조 (환불 가능 기간)</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li><strong className="text-white">최초 구독 후 7일 이내:</strong> 전액 환불 가능</li>
              <li><strong className="text-white">7일 초과:</strong> 환불 불가 (해당 월 구독 기간 이용 가능)</li>
              <li>구독 갱신(자동 결제) 후에는 환불이 적용되지 않습니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">제2조 (환불 방법)</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>환불 요청은 이메일로만 접수됩니다.</li>
              <li>이메일 제목: <strong className="text-white">[환불 요청] 가입 이메일 주소</strong></li>
              <li>환불 접수 후 영업일 기준 3~5일 내 처리됩니다.</li>
              <li>환불 금액은 결제 수단으로 반환됩니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">제3조 (구독 취소)</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>구독 취소는 설정 → 구독 탭에서 언제든지 가능합니다.</li>
              <li>취소 후에도 현재 결제 기간 종료일까지 서비스 이용이 가능합니다.</li>
              <li>취소 시 데이터는 즉시 삭제되지 않으며, 이용 종료 후 30일간 보관됩니다.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">제4조 (환불 불가 사유)</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>최초 구독 후 7일 초과 시</li>
              <li>이용자의 약관 위반으로 인한 계정 정지 또는 해지의 경우</li>
              <li>서비스를 실질적으로 이용한 경우 (수질 데이터 입력, AI 어드바이저 사용 등)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">제5조 (결제 오류)</h2>
            <p>이중 청구 또는 결제 오류가 발생한 경우, 확인 후 전액 환불해 드립니다. 아래 이메일로 결제 내역을 첨부하여 문의해 주세요.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">제6조 (환불 문의)</h2>
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 space-y-1">
              <p><span className="text-slate-400">이메일:</span> <a href="mailto:support@shrimp365.kr" className="text-ocean-400 hover:underline">support@shrimp365.kr</a></p>
              <p><span className="text-slate-400">운영 시간:</span> 평일 09:00 ~ 18:00 (주말·공휴일 제외)</p>
              <p><span className="text-slate-400">처리 기간:</span> 영업일 기준 3~5일</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
