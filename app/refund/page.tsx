"use client"

import Link from "next/link"
import { useState } from "react"
import { Waves, ArrowLeft } from "lucide-react"

export default function RefundPage() {
  const [lang, setLang] = useState<"ko" | "en">("ko")

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* 상단 네비게이션 */}
        <nav aria-label={lang === "ko" ? "페이지 네비게이션" : "Page navigation"} className="flex items-center justify-between mb-10">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">{lang === "ko" ? "홈으로" : "Home"}</span>
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="flex rounded-lg overflow-hidden border border-border text-sm"
              role="group"
              aria-label={lang === "ko" ? "언어 선택" : "Language selection"}
            >
              <button
                onClick={() => setLang("ko")}
                className={`px-3 min-h-[44px] transition-colors ${lang === "ko" ? "bg-ocean-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
                aria-pressed={lang === "ko"}
              >
                KO
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-3 min-h-[44px] transition-colors ${lang === "en" ? "bg-ocean-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
                aria-pressed={lang === "en"}
              >
                EN
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-ocean-400" />
              <span className="font-bold">Shrimp365</span>
            </div>
          </div>
        </nav>

        {lang === "ko" ? (
          <article aria-label="환불 정책">
            <h1 className="text-3xl font-bold mb-2">환불 정책</h1>
            <p className="text-muted-foreground text-sm mb-10">최종 수정일: 2026년 5월 9일</p>

            {/* 목차 */}
            <nav aria-label="목차" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">목차</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#ko-refund-1" className="hover:text-ocean-400 transition-colors">제1조 (환불 가능 기간)</a></li>
                <li><a href="#ko-refund-2" className="hover:text-ocean-400 transition-colors">제2조 (환불 방법)</a></li>
                <li><a href="#ko-refund-3" className="hover:text-ocean-400 transition-colors">제3조 (구독 취소)</a></li>
                <li><a href="#ko-refund-4" className="hover:text-ocean-400 transition-colors">제4조 (환불 불가 사유)</a></li>
                <li><a href="#ko-refund-5" className="hover:text-ocean-400 transition-colors">제5조 (결제 오류)</a></li>
                <li><a href="#ko-refund-6" className="hover:text-ocean-400 transition-colors">제6조 (환불 문의)</a></li>
              </ol>
            </nav>

            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section aria-label="안내" className="bg-ocean-500/10 border border-ocean-500/30 rounded-xl p-5">
                <p className="text-ocean-400 font-medium">Shrimp365는 고객 만족을 최우선으로 합니다. 서비스에 만족하지 못하신 경우 아래 정책에 따라 환불을 요청하실 수 있습니다.</p>
              </section>
              <section id="ko-refund-1" aria-label="환불 가능 기간">
                <h2 className="text-xl font-semibold text-foreground mb-3">제1조 (환불 가능 기간)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-foreground">최초 구독 후 7일 이내:</strong> 전액 환불 가능</li>
                  <li><strong className="text-foreground">7일 초과:</strong> 환불 불가 (해당 월 구독 기간 이용 가능)</li>
                  <li>구독 갱신(자동 결제) 후에는 환불이 적용되지 않습니다.</li>
                </ul>
              </section>
              <section id="ko-refund-2" aria-label="환불 방법">
                <h2 className="text-xl font-semibold text-foreground mb-3">제2조 (환불 방법)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>환불 요청은 이메일로만 접수됩니다.</li>
                  <li>이메일 제목: <strong className="text-foreground">[환불 요청] 가입 이메일 주소</strong></li>
                  <li>환불 접수 후 영업일 기준 3~5일 내 처리됩니다.</li>
                  <li>환불 금액은 결제 수단으로 반환됩니다.</li>
                </ul>
              </section>
              <section id="ko-refund-3" aria-label="구독 취소">
                <h2 className="text-xl font-semibold text-foreground mb-3">제3조 (구독 취소)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>구독 취소는 설정 → 구독 탭에서 언제든지 가능합니다.</li>
                  <li>취소 후에도 현재 결제 기간 종료일까지 서비스 이용이 가능합니다.</li>
                  <li>취소 시 데이터는 즉시 삭제되지 않으며, 이용 종료 후 30일간 보관됩니다.</li>
                </ul>
              </section>
              <section id="ko-refund-4" aria-label="환불 불가 사유">
                <h2 className="text-xl font-semibold text-foreground mb-3">제4조 (환불 불가 사유)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>최초 구독 후 7일 초과 시</li>
                  <li>이용자의 약관 위반으로 인한 계정 정지 또는 해지의 경우</li>
                  <li>서비스를 실질적으로 이용한 경우 (수질 데이터 입력, AI 어드바이저 사용 등)</li>
                </ul>
              </section>
              <section id="ko-refund-5" aria-label="결제 오류">
                <h2 className="text-xl font-semibold text-foreground mb-3">제5조 (결제 오류)</h2>
                <p>이중 청구 또는 결제 오류가 발생한 경우, 확인 후 전액 환불해 드립니다. 아래 이메일로 결제 내역을 첨부하여 문의해 주세요.</p>
              </section>
              <section id="ko-refund-6" aria-label="환불 문의">
                <h2 className="text-xl font-semibold text-foreground mb-3">제6조 (환불 문의)</h2>
                <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                  <p><span className="text-muted-foreground">이메일:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
                  <p><span className="text-muted-foreground">운영 시간:</span> 평일 09:00 ~ 18:00 (주말·공휴일 제외)</p>
                  <p><span className="text-muted-foreground">처리 기간:</span> 영업일 기준 3~5일</p>
                </div>
              </section>
            </div>
          </article>
        ) : (
          <article aria-label="Refund Policy">
            <h1 className="text-3xl font-bold mb-2">Refund Policy</h1>
            <p className="text-muted-foreground text-sm mb-10">Last updated: May 9, 2026</p>

            {/* Table of Contents */}
            <nav aria-label="Table of contents" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Contents</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#en-refund-1" className="hover:text-ocean-400 transition-colors">Article 1 (Refund Window)</a></li>
                <li><a href="#en-refund-2" className="hover:text-ocean-400 transition-colors">Article 2 (How to Request a Refund)</a></li>
                <li><a href="#en-refund-3" className="hover:text-ocean-400 transition-colors">Article 3 (Subscription Cancellation)</a></li>
                <li><a href="#en-refund-4" className="hover:text-ocean-400 transition-colors">Article 4 (Non-Refundable Situations)</a></li>
                <li><a href="#en-refund-5" className="hover:text-ocean-400 transition-colors">Article 5 (Billing Errors)</a></li>
                <li><a href="#en-refund-6" className="hover:text-ocean-400 transition-colors">Article 6 (Refund Contact)</a></li>
              </ol>
            </nav>

            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section aria-label="Overview" className="bg-ocean-500/10 border border-ocean-500/30 rounded-xl p-5">
                <p className="text-ocean-400 font-medium">Customer satisfaction is our top priority. If you are not satisfied with the Service, you may request a refund in accordance with the policy below.</p>
              </section>
              <section id="en-refund-1" aria-label="Refund Window">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 1 (Refund Window)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-foreground">Within 7 days of initial subscription:</strong> Full refund available</li>
                  <li><strong className="text-foreground">After 7 days:</strong> No refund (service access continues until the end of the billing period)</li>
                  <li>Refunds do not apply to subscription renewals (automatic payments).</li>
                </ul>
              </section>
              <section id="en-refund-2" aria-label="How to Request a Refund">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 2 (How to Request a Refund)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Refund requests are accepted by email only.</li>
                  <li>Email subject: <strong className="text-foreground">[Refund Request] your registered email address</strong></li>
                  <li>Requests are processed within 3–5 business days of receipt.</li>
                  <li>Refunds are returned to the original payment method.</li>
                </ul>
              </section>
              <section id="en-refund-3" aria-label="Subscription Cancellation">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 3 (Subscription Cancellation)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>You may cancel your subscription at any time from Settings → Subscription.</li>
                  <li>After cancellation, you retain access to the Service until the end of the current billing period.</li>
                  <li>Your data is not deleted immediately upon cancellation; it is retained for 30 days after the service period ends.</li>
                </ul>
              </section>
              <section id="en-refund-4" aria-label="Non-Refundable Situations">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 4 (Non-Refundable Situations)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>More than 7 days have elapsed since the initial subscription</li>
                  <li>Account suspension or termination due to violation of the Terms of Service</li>
                  <li>Substantial use of the Service (e.g., entering water quality data, using the AI advisor)</li>
                </ul>
              </section>
              <section id="en-refund-5" aria-label="Billing Errors">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 5 (Billing Errors)</h2>
                <p>If a duplicate charge or billing error occurs, we will issue a full refund upon verification. Please email us with your payment receipt attached.</p>
              </section>
              <section id="en-refund-6" aria-label="Refund Contact">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 6 (Refund Contact)</h2>
                <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                  <p><span className="text-muted-foreground">Email:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
                  <p><span className="text-muted-foreground">Hours:</span> Weekdays 09:00–18:00 KST (excluding weekends and public holidays)</p>
                  <p><span className="text-muted-foreground">Processing time:</span> 3–5 business days</p>
                </div>
              </section>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
