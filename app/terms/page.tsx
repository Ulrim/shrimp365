"use client"

import Link from "next/link"
import { useState } from "react"
import { Waves, ArrowLeft } from "lucide-react"

export default function TermsPage() {
  const [lang, setLang] = useState<"ko" | "en">("ko")

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-10">
          <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">{lang === "ko" ? "홈으로" : "Home"}</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border border-white/10 text-sm">
              <button onClick={() => setLang("ko")} className={`px-3 py-1 transition-colors ${lang === "ko" ? "bg-ocean-500 text-white" : "text-slate-400 hover:text-white"}`}>KO</button>
              <button onClick={() => setLang("en")} className={`px-3 py-1 transition-colors ${lang === "en" ? "bg-ocean-500 text-white" : "text-slate-400 hover:text-white"}`}>EN</button>
            </div>
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-ocean-400" />
              <span className="font-bold">Shrimp365</span>
            </div>
          </div>
        </div>

        {lang === "ko" ? (
          <>
            <h1 className="text-3xl font-bold mb-2">서비스 이용약관</h1>
            <p className="text-slate-400 text-sm mb-10">최종 수정일: 2026년 5월 9일</p>
            <div className="space-y-8 text-slate-300 leading-relaxed">
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제1조 (목적)</h2>
                <p>본 약관은 CULIVER INC(이하 "회사")가 제공하는 스마트 새우 양식 관리 서비스(이하 "서비스")의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제2조 (정의)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>"서비스"란 회사가 제공하는 수질 모니터링, 양식 일지, 질병 진단, AI 어드바이저 등 일체의 서비스를 의미합니다.</li>
                  <li>"이용자"란 본 약관에 동의하고 서비스를 이용하는 개인 또는 법인을 의미합니다.</li>
                  <li>"계정"이란 이용자가 서비스 이용을 위해 설정한 이메일 및 비밀번호의 조합을 의미합니다.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제3조 (약관의 효력 및 변경)</h2>
                <p>본 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이 발생합니다. 회사는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 공지 후 7일 이후부터 효력이 발생합니다.</p>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제4조 (서비스 이용)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>서비스는 가입 후 즉시 이용 가능합니다.</li>
                  <li>Free 플랜은 무료로 제공되며, 유료 플랜(Basic, Pro)은 월정액 구독 방식으로 제공됩니다.</li>
                  <li>회사는 서비스 품질 향상을 위해 사전 공지 후 서비스 내용을 변경할 수 있습니다.</li>
                  <li>천재지변, 시스템 점검 등 불가피한 사유로 서비스가 일시 중단될 수 있습니다.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제5조 (이용자의 의무)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>이용자는 타인의 정보를 도용하거나 허위 정보를 등록해서는 안 됩니다.</li>
                  <li>서비스를 이용하여 법령 또는 공공질서에 위반되는 행위를 해서는 안 됩니다.</li>
                  <li>계정 및 비밀번호의 관리 책임은 이용자에게 있습니다.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제6조 (구독 및 결제)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>유료 플랜은 월 단위로 자동 갱신됩니다.</li>
                  <li>결제는 DODO Payments를 통해 처리되며, 신용카드 등 DODO Payments가 지원하는 결제 수단을 이용할 수 있습니다.</li>
                  <li>구독 취소는 다음 결제일 이전에 설정 페이지에서 언제든지 가능합니다.</li>
                  <li>환불 정책은 별도의 환불 정책 페이지를 따릅니다.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제7조 (책임의 한계)</h2>
                <p>회사는 서비스 내 AI 어드바이저, 수질 진단 결과 등이 참고 정보임을 명시하며, 이를 기반으로 한 양식 결정에 대한 최종 책임은 이용자에게 있습니다. 회사는 서비스 이용으로 발생한 간접적 손해에 대해 책임을 지지 않습니다.</p>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제8조 (문의)</h2>
                <p>서비스 이용과 관련한 문의는 아래로 연락하시기 바랍니다.</p>
                <p className="mt-2">이메일: <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
              </section>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
            <p className="text-slate-400 text-sm mb-10">Last updated: May 9, 2026</p>
            <div className="space-y-8 text-slate-300 leading-relaxed">
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 1 (Purpose)</h2>
                <p>These Terms of Service govern the rights, obligations, and responsibilities between CULIVER INC (the "Company") and users of the Shrimp365 smart aquaculture management service (the "Service").</p>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 2 (Definitions)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>"Service" means all features provided by the Company, including water quality monitoring, farming journals, disease diagnosis, and AI advisor.</li>
                  <li>"User" means any individual or legal entity that agrees to these Terms and uses the Service.</li>
                  <li>"Account" means the email address and password combination set by the User to access the Service.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 3 (Effectiveness &amp; Amendments)</h2>
                <p>These Terms take effect when posted on the Service or otherwise notified to Users. The Company may amend these Terms as needed; amended Terms take effect 7 days after notice.</p>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 4 (Use of Service)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>The Service is available immediately upon registration.</li>
                  <li>The Free plan is provided at no cost; paid plans (Basic, Pro) are offered on a monthly subscription basis.</li>
                  <li>The Company may modify Service content with prior notice to improve quality.</li>
                  <li>The Service may be temporarily suspended due to force majeure or scheduled maintenance.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 5 (User Obligations)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Users must not impersonate others or register false information.</li>
                  <li>Users must not use the Service in violation of applicable laws or public order.</li>
                  <li>Users are responsible for managing their account credentials.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 6 (Subscription &amp; Payment)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Paid plans auto-renew monthly.</li>
                  <li>Payments are processed via DODO Payments using credit cards or other supported payment methods.</li>
                  <li>Subscriptions may be cancelled at any time from the settings page before the next billing date.</li>
                  <li>Refunds are governed by the separate Refund Policy.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 7 (Limitation of Liability)</h2>
                <p>The Company clarifies that AI advisor outputs and water quality diagnostics within the Service are for reference only. Users bear final responsibility for farming decisions made based on such information. The Company is not liable for indirect damages arising from use of the Service.</p>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 8 (Contact)</h2>
                <p>For inquiries regarding the Service, please contact us at:</p>
                <p className="mt-2">Email: <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
