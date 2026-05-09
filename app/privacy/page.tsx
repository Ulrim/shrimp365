"use client"

import Link from "next/link"
import { useState } from "react"
import { Waves, ArrowLeft } from "lucide-react"

export default function PrivacyPage() {
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
            <h1 className="text-3xl font-bold mb-2">개인정보 보호정책</h1>
            <p className="text-slate-400 text-sm mb-10">최종 수정일: 2026년 5월 9일</p>
            <div className="space-y-8 text-slate-300 leading-relaxed">
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제1조 (수집하는 개인정보)</h2>
                <p className="mb-3">CULIVER INC(이하 "회사")는 서비스 제공을 위해 아래의 개인정보를 수집합니다.</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-white">필수 항목:</strong> 이메일 주소, 이름(닉네임)</li>
                  <li><strong className="text-white">서비스 이용 중 생성 정보:</strong> 양식장·수조 정보, 수질 측정 데이터, 양식 일지, 질병 진단 기록</li>
                  <li><strong className="text-white">결제 정보:</strong> 결제는 DODO Payments를 통해 처리되며, 카드 정보는 회사가 직접 저장하지 않습니다.</li>
                  <li><strong className="text-white">자동 수집 정보:</strong> 접속 IP, 브라우저 정보, 서비스 이용 기록</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제2조 (개인정보 수집 및 이용 목적)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>서비스 제공 및 계정 관리</li>
                  <li>구독 결제 처리 및 환불 처리</li>
                  <li>AI 어드바이저 기능 제공</li>
                  <li>서비스 품질 개선 및 통계 분석</li>
                  <li>고객 문의 응대 및 공지사항 전달</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제3조 (개인정보 보유 및 이용 기간)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>회원 탈퇴 시 즉시 삭제됩니다.</li>
                  <li>단, 관련 법령에 따라 일정 기간 보관이 필요한 경우 해당 기간 동안 보관합니다.</li>
                  <li>전자상거래 관련 기록: 5년 보관 (전자상거래법)</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제4조 (제3자 제공)</h2>
                <p className="mb-3">회사는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다. 단, 아래의 경우는 예외입니다.</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-white">Supabase:</strong> 데이터베이스 및 인증 서비스 (서버 소재지: 미국)</li>
                  <li><strong className="text-white">DODO Payments:</strong> 결제 처리 (서버 소재지: 미국)</li>
                  <li><strong className="text-white">Anthropic:</strong> AI 어드바이저 기능 (서버 소재지: 미국)</li>
                  <li>법령에 의거하거나 수사기관의 요청이 있는 경우</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제5조 (이용자의 권리)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>이용자는 언제든지 자신의 개인정보를 조회·수정할 수 있습니다.</li>
                  <li>이용자는 언제든지 회원 탈퇴를 통해 개인정보 삭제를 요청할 수 있습니다.</li>
                  <li>개인정보 관련 문의는 아래 연락처로 요청하시기 바랍니다.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제6조 (개인정보 보호 책임자)</h2>
                <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 space-y-1">
                  <p><span className="text-slate-400">책임자:</span> CULIVER INC 개인정보 보호 담당자</p>
                  <p><span className="text-slate-400">이메일:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
                </div>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">제7조 (쿠키 사용)</h2>
                <p>회사는 서비스 제공을 위해 쿠키를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 서비스 일부 기능이 제한될 수 있습니다.</p>
              </section>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-slate-400 text-sm mb-10">Last updated: May 9, 2026</p>
            <div className="space-y-8 text-slate-300 leading-relaxed">
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 1 (Data We Collect)</h2>
                <p className="mb-3">CULIVER INC (the "Company") collects the following personal information to provide the Service.</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-white">Required:</strong> Email address, name (or nickname)</li>
                  <li><strong className="text-white">Generated during use:</strong> Farm and tank information, water quality measurement data, farming journals, disease diagnosis records</li>
                  <li><strong className="text-white">Payment information:</strong> Payments are processed via DODO Payments; the Company does not store card details directly.</li>
                  <li><strong className="text-white">Automatically collected:</strong> IP address, browser information, service usage logs</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 2 (Purpose of Collection)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Service provision and account management</li>
                  <li>Subscription billing and refund processing</li>
                  <li>AI advisor feature operation</li>
                  <li>Service quality improvement and statistical analysis</li>
                  <li>Customer support and announcements</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 3 (Retention Period)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Personal data is deleted immediately upon account deletion.</li>
                  <li>Exceptions apply where retention is required by applicable law.</li>
                  <li>E-commerce transaction records: retained for 5 years (Electronic Commerce Act)</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 4 (Third-Party Providers)</h2>
                <p className="mb-3">The Company does not share personal data with third parties in principle, with the following exceptions:</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-white">Supabase:</strong> Database and authentication services (servers located in the US)</li>
                  <li><strong className="text-white">DODO Payments:</strong> Payment processing (servers located in the US)</li>
                  <li><strong className="text-white">Anthropic:</strong> AI advisor feature (servers located in the US)</li>
                  <li>When required by law or a lawful request from authorities</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 5 (User Rights)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Users may view and update their personal information at any time.</li>
                  <li>Users may request deletion of their personal data by deleting their account.</li>
                  <li>For privacy-related inquiries, please contact us using the details below.</li>
                </ul>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 6 (Data Protection Officer)</h2>
                <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 space-y-1">
                  <p><span className="text-slate-400">Contact:</span> CULIVER INC Data Protection Officer</p>
                  <p><span className="text-slate-400">Email:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
                </div>
              </section>
              <section>
                <h2 className="text-xl font-semibold text-white mb-3">Article 7 (Cookie Policy)</h2>
                <p>The Company uses cookies to provide the Service. Users may disable cookies in their browser settings, though some features may become unavailable as a result.</p>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
