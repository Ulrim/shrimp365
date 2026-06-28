"use client"

import Link from "next/link"
import { useState } from "react"
import { Waves, ArrowLeft } from "lucide-react"

type Lang = "ko" | "en" | "vi" | "id"

export default function PrivacyPage() {
  const [lang, setLang] = useState<Lang>("ko")

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* 상단 네비게이션 */}
        <nav aria-label="Page navigation" className="flex items-center justify-between mb-10">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">{lang === "ko" ? "홈으로" : lang === "vi" ? "Trang chủ" : lang === "id" ? "Beranda" : "Home"}</span>
          </Link>
          <div className="flex items-center gap-3">
            <div
              className="flex rounded-lg overflow-hidden border border-border text-sm"
              role="group"
              aria-label="Language selection"
            >
              {(["ko", "en", "vi", "id"] as Lang[]).map(l => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-3 min-h-[44px] transition-colors uppercase ${lang === l ? "bg-ocean-500 text-white" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={lang === l}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-ocean-400" />
              <span className="font-bold">Shrimp365</span>
            </div>
          </div>
        </nav>

        {lang === "vi" ? (
          <article aria-label="Chính sách Bảo mật">
            <h1 className="text-3xl font-bold mb-2">Chính sách Bảo mật</h1>
            <p className="text-muted-foreground text-sm mb-10">Cập nhật lần cuối: 9 tháng 5, 2026</p>
            <nav aria-label="Mục lục" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Mục lục</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#vi-priv-1" className="hover:text-ocean-400 transition-colors">Điều 1 (Dữ liệu chúng tôi thu thập)</a></li>
                <li><a href="#vi-priv-2" className="hover:text-ocean-400 transition-colors">Điều 2 (Mục đích thu thập)</a></li>
                <li><a href="#vi-priv-3" className="hover:text-ocean-400 transition-colors">Điều 3 (Thời gian lưu trữ)</a></li>
                <li><a href="#vi-priv-4" className="hover:text-ocean-400 transition-colors">Điều 4 (Bên thứ ba)</a></li>
                <li><a href="#vi-priv-5" className="hover:text-ocean-400 transition-colors">Điều 5 (Quyền người dùng)</a></li>
                <li><a href="#vi-priv-6" className="hover:text-ocean-400 transition-colors">Điều 6 (Người phụ trách bảo mật)</a></li>
                <li><a href="#vi-priv-7" className="hover:text-ocean-400 transition-colors">Điều 7 (Cookie &amp; Quảng cáo)</a></li>
              </ol>
            </nav>
            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="vi-priv-1"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 1 (Dữ liệu chúng tôi thu thập)</h2><p className="mb-3">CULIVER INC ("Công ty") thu thập thông tin cá nhân sau đây để cung cấp Dịch vụ.</p><ul className="space-y-2 list-disc list-inside"><li><strong className="text-foreground">Bắt buộc:</strong> Địa chỉ email, tên (hoặc biệt danh)</li><li><strong className="text-foreground">Tạo ra trong quá trình sử dụng:</strong> Thông tin trang trại và ao, dữ liệu đo chất lượng nước, nhật ký nuôi trồng, hồ sơ chẩn đoán bệnh</li><li><strong className="text-foreground">Thu thập tự động:</strong> Địa chỉ IP, thông tin trình duyệt, nhật ký sử dụng dịch vụ, định danh cookie quảng cáo và phân tích</li></ul></section>
              <section id="vi-priv-2"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 2 (Mục đích thu thập)</h2><ul className="space-y-2 list-disc list-inside"><li>Cung cấp dịch vụ và quản lý tài khoản</li><li>Vận hành tính năng tư vấn AI</li><li>Cải thiện chất lượng dịch vụ và phân tích thống kê</li><li>Phục vụ quảng cáo và vận hành dịch vụ (dịch vụ này được cung cấp miễn phí, được tài trợ bởi doanh thu quảng cáo)</li><li>Hỗ trợ khách hàng và thông báo</li></ul></section>
              <section id="vi-priv-3"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 3 (Thời gian lưu trữ)</h2><ul className="space-y-2 list-disc list-inside"><li>Dữ liệu cá nhân được xóa ngay khi xóa tài khoản.</li><li>Ngoại lệ áp dụng khi pháp luật yêu cầu lưu giữ.</li><li>Hồ sơ giao dịch thương mại điện tử: lưu giữ 5 năm</li></ul></section>
              <section id="vi-priv-4"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 4 (Bên thứ ba)</h2><p className="mb-3">Công ty không chia sẻ dữ liệu cá nhân với bên thứ ba, ngoại trừ các trường hợp sau:</p><ul className="space-y-2 list-disc list-inside"><li><strong className="text-foreground">Supabase:</strong> Dịch vụ cơ sở dữ liệu và xác thực (máy chủ tại Hoa Kỳ)</li><li><strong className="text-foreground">OpenAI:</strong> Tính năng tư vấn AI (máy chủ tại Hoa Kỳ)</li><li><strong className="text-foreground">Vercel:</strong> Lưu trữ dịch vụ và phân tích sử dụng (máy chủ tại Hoa Kỳ)</li><li><strong className="text-foreground">Google AdSense:</strong> Phân phối quảng cáo và đo lường hiệu suất (máy chủ tại Hoa Kỳ)</li><li>Khi pháp luật yêu cầu hoặc theo yêu cầu hợp pháp của cơ quan chức năng</li></ul></section>
              <section id="vi-priv-5"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 5 (Quyền người dùng)</h2><ul className="space-y-2 list-disc list-inside"><li>Người dùng có thể xem và cập nhật thông tin cá nhân của mình bất cứ lúc nào.</li><li>Người dùng có thể yêu cầu xóa dữ liệu cá nhân bằng cách xóa tài khoản.</li><li>Để hỏi về quyền riêng tư, vui lòng liên hệ theo thông tin bên dưới.</li></ul></section>
              <section id="vi-priv-6"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 6 (Người phụ trách bảo mật)</h2><div className="bg-card border border-border rounded-xl p-4 space-y-1"><p><span className="text-muted-foreground">Liên hệ:</span> Người phụ trách bảo vệ dữ liệu CULIVER INC</p><p><span className="text-muted-foreground">Email:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p></div></section>
              <section id="vi-priv-7"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 7 (Cookie &amp; Quảng cáo)</h2><p className="mb-3">Công ty sử dụng cookie thiết yếu để cung cấp Dịch vụ và có thể sử dụng cookie phân tích và quảng cáo để đo lường sử dụng và phân phối quảng cáo. Người dùng có thể tắt cookie trong cài đặt trình duyệt, mặc dù một số tính năng có thể không khả dụng.</p><p>Dịch vụ này có thể hiển thị quảng cáo qua mạng quảng cáo bên thứ ba như Google AdSense, có thể sử dụng cookie để phục vụ quảng cáo dựa trên sở thích. Người dùng có thể từ chối quảng cáo cá nhân hóa tại <a href="https://www.google.com/settings/ads" className="text-ocean-400 hover:underline" target="_blank" rel="noopener noreferrer">Cài đặt quảng cáo Google</a>.</p></section>
            </div>
          </article>
        ) : lang === "id" ? (
          <article aria-label="Kebijakan Privasi">
            <h1 className="text-3xl font-bold mb-2">Kebijakan Privasi</h1>
            <p className="text-muted-foreground text-sm mb-10">Terakhir diperbarui: 9 Mei 2026</p>
            <nav aria-label="Daftar isi" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Daftar Isi</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#id-priv-1" className="hover:text-ocean-400 transition-colors">Pasal 1 (Data yang kami kumpulkan)</a></li>
                <li><a href="#id-priv-2" className="hover:text-ocean-400 transition-colors">Pasal 2 (Tujuan pengumpulan)</a></li>
                <li><a href="#id-priv-3" className="hover:text-ocean-400 transition-colors">Pasal 3 (Periode penyimpanan)</a></li>
                <li><a href="#id-priv-4" className="hover:text-ocean-400 transition-colors">Pasal 4 (Pihak ketiga)</a></li>
                <li><a href="#id-priv-5" className="hover:text-ocean-400 transition-colors">Pasal 5 (Hak pengguna)</a></li>
                <li><a href="#id-priv-6" className="hover:text-ocean-400 transition-colors">Pasal 6 (Penanggung jawab perlindungan data)</a></li>
                <li><a href="#id-priv-7" className="hover:text-ocean-400 transition-colors">Pasal 7 (Cookie &amp; Iklan)</a></li>
              </ol>
            </nav>
            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="id-priv-1"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 1 (Data yang kami kumpulkan)</h2><p className="mb-3">CULIVER INC ("Perusahaan") mengumpulkan informasi pribadi berikut untuk menyediakan Layanan.</p><ul className="space-y-2 list-disc list-inside"><li><strong className="text-foreground">Wajib:</strong> Alamat email, nama (atau nama panggilan)</li><li><strong className="text-foreground">Dihasilkan selama penggunaan:</strong> Informasi tambak dan kolam, data pengukuran kualitas air, jurnal budidaya, catatan diagnosis penyakit</li><li><strong className="text-foreground">Dikumpulkan otomatis:</strong> Alamat IP, informasi browser, log penggunaan layanan, pengidentifikasi cookie iklan dan analitik</li></ul></section>
              <section id="id-priv-2"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 2 (Tujuan pengumpulan)</h2><ul className="space-y-2 list-disc list-inside"><li>Penyediaan layanan dan manajemen akun</li><li>Operasi fitur konsultan AI</li><li>Peningkatan kualitas layanan dan analisis statistik</li><li>Penyajian iklan dan pengoperasian layanan (layanan ini disediakan gratis, didukung oleh pendapatan iklan)</li><li>Dukungan pelanggan dan pengumuman</li></ul></section>
              <section id="id-priv-3"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 3 (Periode penyimpanan)</h2><ul className="space-y-2 list-disc list-inside"><li>Data pribadi dihapus segera saat penghapusan akun.</li><li>Pengecualian berlaku jika penyimpanan diwajibkan oleh hukum yang berlaku.</li><li>Catatan transaksi e-commerce: disimpan selama 5 tahun</li></ul></section>
              <section id="id-priv-4"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 4 (Pihak ketiga)</h2><p className="mb-3">Perusahaan tidak membagikan data pribadi kepada pihak ketiga, dengan pengecualian berikut:</p><ul className="space-y-2 list-disc list-inside"><li><strong className="text-foreground">Supabase:</strong> Layanan database dan autentikasi (server di AS)</li><li><strong className="text-foreground">OpenAI:</strong> Fitur konsultan AI (server di AS)</li><li><strong className="text-foreground">Vercel:</strong> Hosting layanan dan analitik penggunaan (server di AS)</li><li><strong className="text-foreground">Google AdSense:</strong> Pengiriman iklan dan pengukuran kinerja iklan (server di AS)</li><li>Jika diwajibkan oleh hukum atau permintaan sah dari pihak berwenang</li></ul></section>
              <section id="id-priv-5"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 5 (Hak pengguna)</h2><ul className="space-y-2 list-disc list-inside"><li>Pengguna dapat melihat dan memperbarui informasi pribadi mereka kapan saja.</li><li>Pengguna dapat meminta penghapusan data pribadi dengan menghapus akun mereka.</li><li>Untuk pertanyaan privasi, hubungi kami menggunakan detail di bawah.</li></ul></section>
              <section id="id-priv-6"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 6 (Penanggung jawab perlindungan data)</h2><div className="bg-card border border-border rounded-xl p-4 space-y-1"><p><span className="text-muted-foreground">Kontak:</span> Penanggung Jawab Perlindungan Data CULIVER INC</p><p><span className="text-muted-foreground">Email:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p></div></section>
              <section id="id-priv-7"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 7 (Cookie &amp; Iklan)</h2><p className="mb-3">Perusahaan menggunakan cookie esensial untuk menyediakan Layanan dan dapat menggunakan cookie analitik dan iklan untuk pengukuran penggunaan dan pengiriman iklan. Pengguna dapat menonaktifkan cookie di pengaturan browser, meskipun beberapa fitur mungkin tidak tersedia.</p><p>Layanan ini dapat menampilkan iklan melalui jaringan iklan pihak ketiga seperti Google AdSense, yang dapat menggunakan cookie untuk menyajikan iklan berbasis minat. Pengguna dapat menolak iklan yang dipersonalisasi di <a href="https://www.google.com/settings/ads" className="text-ocean-400 hover:underline" target="_blank" rel="noopener noreferrer">Setelan Iklan Google</a>.</p></section>
            </div>
          </article>
        ) : lang === "ko" ? (
          <article aria-label="개인정보 보호정책">
            <h1 className="text-3xl font-bold mb-2">개인정보 보호정책</h1>
            <p className="text-muted-foreground text-sm mb-10">최종 수정일: 2026년 5월 9일</p>

            {/* 목차 */}
            <nav aria-label="목차" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">목차</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#ko-section-1" className="hover:text-ocean-400 transition-colors">제1조 (수집하는 개인정보)</a></li>
                <li><a href="#ko-section-2" className="hover:text-ocean-400 transition-colors">제2조 (개인정보 수집 및 이용 목적)</a></li>
                <li><a href="#ko-section-3" className="hover:text-ocean-400 transition-colors">제3조 (개인정보 보유 및 이용 기간)</a></li>
                <li><a href="#ko-section-4" className="hover:text-ocean-400 transition-colors">제4조 (제3자 제공)</a></li>
                <li><a href="#ko-section-5" className="hover:text-ocean-400 transition-colors">제5조 (이용자의 권리)</a></li>
                <li><a href="#ko-section-6" className="hover:text-ocean-400 transition-colors">제6조 (개인정보 보호 책임자)</a></li>
                <li><a href="#ko-section-7" className="hover:text-ocean-400 transition-colors">제7조 (쿠키 사용)</a></li>
              </ol>
            </nav>

            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="ko-section-1" aria-label="수집하는 개인정보">
                <h2 className="text-xl font-semibold text-foreground mb-3">제1조 (수집하는 개인정보)</h2>
                <p className="mb-3">CULIVER INC(이하 "회사")는 서비스 제공을 위해 아래의 개인정보를 수집합니다.</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-foreground">필수 항목:</strong> 이메일 주소, 이름(닉네임)</li>
                  <li><strong className="text-foreground">서비스 이용 중 생성 정보:</strong> 양식장·수조 정보, 수질 측정 데이터, 양식 일지, 질병 진단 기록</li>
                  <li><strong className="text-foreground">자동 수집 정보:</strong> 접속 IP, 브라우저 정보, 서비스 이용 기록, 광고·분석 쿠키 식별자</li>
                </ul>
              </section>
              <section id="ko-section-2" aria-label="개인정보 수집 및 이용 목적">
                <h2 className="text-xl font-semibold text-foreground mb-3">제2조 (개인정보 수집 및 이용 목적)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>서비스 제공 및 계정 관리</li>
                  <li>AI 어드바이저 기능 제공</li>
                  <li>서비스 품질 개선 및 통계 분석</li>
                  <li>광고 게재 및 서비스 운영(본 서비스는 광고 수익으로 무료 제공됩니다)</li>
                  <li>고객 문의 응대 및 공지사항 전달</li>
                </ul>
              </section>
              <section id="ko-section-3" aria-label="개인정보 보유 및 이용 기간">
                <h2 className="text-xl font-semibold text-foreground mb-3">제3조 (개인정보 보유 및 이용 기간)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>회원 탈퇴 시 즉시 삭제됩니다.</li>
                  <li>단, 관련 법령에 따라 일정 기간 보관이 필요한 경우 해당 기간 동안 보관합니다.</li>
                  <li>전자상거래 관련 기록: 5년 보관 (전자상거래법)</li>
                </ul>
              </section>
              <section id="ko-section-4" aria-label="제3자 제공">
                <h2 className="text-xl font-semibold text-foreground mb-3">제4조 (제3자 제공)</h2>
                <p className="mb-3">회사는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다. 단, 아래의 경우는 예외입니다.</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-foreground">Supabase:</strong> 데이터베이스 및 인증 서비스 (서버 소재지: 미국)</li>
                  <li><strong className="text-foreground">OpenAI:</strong> AI 어드바이저 기능 (서버 소재지: 미국)</li>
                  <li><strong className="text-foreground">Vercel:</strong> 서비스 호스팅 및 이용 통계 분석(Analytics) (서버 소재지: 미국)</li>
                  <li><strong className="text-foreground">Google AdSense:</strong> 광고 게재 및 광고 성과 측정 (서버 소재지: 미국)</li>
                  <li>법령에 의거하거나 수사기관의 요청이 있는 경우</li>
                </ul>
              </section>
              <section id="ko-section-5" aria-label="이용자의 권리">
                <h2 className="text-xl font-semibold text-foreground mb-3">제5조 (이용자의 권리)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>이용자는 언제든지 자신의 개인정보를 조회·수정할 수 있습니다.</li>
                  <li>이용자는 언제든지 회원 탈퇴를 통해 개인정보 삭제를 요청할 수 있습니다.</li>
                  <li>개인정보 관련 문의는 아래 연락처로 요청하시기 바랍니다.</li>
                </ul>
              </section>
              <section id="ko-section-6" aria-label="개인정보 보호 책임자">
                <h2 className="text-xl font-semibold text-foreground mb-3">제6조 (개인정보 보호 책임자)</h2>
                <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                  <p><span className="text-muted-foreground">책임자:</span> CULIVER INC 개인정보 보호 담당자</p>
                  <p><span className="text-muted-foreground">이메일:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
                </div>
              </section>
              <section id="ko-section-7" aria-label="쿠키 사용">
                <h2 className="text-xl font-semibold text-foreground mb-3">제7조 (쿠키 및 광고)</h2>
                <p className="mb-3">회사는 서비스 제공을 위해 필수 쿠키를 사용하며, 이용 통계 분석 및 광고 게재를 위해 분석·광고 쿠키를 사용할 수 있습니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 서비스 일부 기능이 제한될 수 있습니다.</p>
                <p>본 서비스는 Google AdSense 등 제3자 광고 네트워크를 통해 광고를 게재할 수 있으며, 해당 광고 사업자는 쿠키를 사용해 이용자의 관심사 기반 맞춤형 광고를 제공할 수 있습니다. 이용자는 <a href="https://www.google.com/settings/ads" className="text-ocean-400 hover:underline" target="_blank" rel="noopener noreferrer">Google 광고 설정</a>에서 맞춤형 광고를 거부할 수 있습니다.</p>
              </section>
            </div>
          </article>
        ) : (
          <article aria-label="Privacy Policy">
            <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-muted-foreground text-sm mb-10">Last updated: May 9, 2026</p>

            {/* Table of Contents */}
            <nav aria-label="Table of contents" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Contents</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#en-section-1" className="hover:text-ocean-400 transition-colors">Article 1 (Data We Collect)</a></li>
                <li><a href="#en-section-2" className="hover:text-ocean-400 transition-colors">Article 2 (Purpose of Collection)</a></li>
                <li><a href="#en-section-3" className="hover:text-ocean-400 transition-colors">Article 3 (Retention Period)</a></li>
                <li><a href="#en-section-4" className="hover:text-ocean-400 transition-colors">Article 4 (Third-Party Providers)</a></li>
                <li><a href="#en-section-5" className="hover:text-ocean-400 transition-colors">Article 5 (User Rights)</a></li>
                <li><a href="#en-section-6" className="hover:text-ocean-400 transition-colors">Article 6 (Data Protection Officer)</a></li>
                <li><a href="#en-section-7" className="hover:text-ocean-400 transition-colors">Article 7 (Cookie Policy)</a></li>
              </ol>
            </nav>

            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="en-section-1" aria-label="Data We Collect">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 1 (Data We Collect)</h2>
                <p className="mb-3">CULIVER INC (the "Company") collects the following personal information to provide the Service.</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-foreground">Required:</strong> Email address, name (or nickname)</li>
                  <li><strong className="text-foreground">Generated during use:</strong> Farm and tank information, water quality measurement data, farming journals, disease diagnosis records</li>
                  <li><strong className="text-foreground">Automatically collected:</strong> IP address, browser information, service usage logs, advertising and analytics cookie identifiers</li>
                </ul>
              </section>
              <section id="en-section-2" aria-label="Purpose of Collection">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 2 (Purpose of Collection)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Service provision and account management</li>
                  <li>AI advisor feature operation</li>
                  <li>Service quality improvement and statistical analysis</li>
                  <li>Serving advertising and operating the service (this service is provided free of charge, funded by advertising revenue)</li>
                  <li>Customer support and announcements</li>
                </ul>
              </section>
              <section id="en-section-3" aria-label="Retention Period">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 3 (Retention Period)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Personal data is deleted immediately upon account deletion.</li>
                  <li>Exceptions apply where retention is required by applicable law.</li>
                  <li>E-commerce transaction records: retained for 5 years (Electronic Commerce Act)</li>
                </ul>
              </section>
              <section id="en-section-4" aria-label="Third-Party Providers">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 4 (Third-Party Providers)</h2>
                <p className="mb-3">The Company does not share personal data with third parties in principle, with the following exceptions:</p>
                <ul className="space-y-2 list-disc list-inside">
                  <li><strong className="text-foreground">Supabase:</strong> Database and authentication services (servers located in the US)</li>
                  <li><strong className="text-foreground">OpenAI:</strong> AI advisor feature (servers located in the US)</li>
                  <li><strong className="text-foreground">Vercel:</strong> Service hosting and usage analytics (servers located in the US)</li>
                  <li><strong className="text-foreground">Google AdSense:</strong> Advertising delivery and ad performance measurement (servers located in the US)</li>
                  <li>When required by law or a lawful request from authorities</li>
                </ul>
              </section>
              <section id="en-section-5" aria-label="User Rights">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 5 (User Rights)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Users may view and update their personal information at any time.</li>
                  <li>Users may request deletion of their personal data by deleting their account.</li>
                  <li>For privacy-related inquiries, please contact us using the details below.</li>
                </ul>
              </section>
              <section id="en-section-6" aria-label="Data Protection Officer">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 6 (Data Protection Officer)</h2>
                <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                  <p><span className="text-muted-foreground">Contact:</span> CULIVER INC Data Protection Officer</p>
                  <p><span className="text-muted-foreground">Email:</span> <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
                </div>
              </section>
              <section id="en-section-7" aria-label="Cookie Policy">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 7 (Cookies &amp; Advertising)</h2>
                <p className="mb-3">The Company uses essential cookies to provide the Service, and may use analytics and advertising cookies for usage measurement and ad delivery. Users may disable cookies in their browser settings, though some features may become unavailable as a result.</p>
                <p>This service may display ads through third-party ad networks such as Google AdSense, which may use cookies to serve interest-based personalized advertising. Users can opt out of personalized advertising at <a href="https://www.google.com/settings/ads" className="text-ocean-400 hover:underline" target="_blank" rel="noopener noreferrer">Google Ad Settings</a>.</p>
              </section>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
