/* eslint-disable react/no-unescaped-entities --
   약관·개인정보처리방침 원문에는 큰따옴표가 그대로 들어가야 한다.
   법적 문구라 임의로 다른 기호로 바꾸지 않는다. */

type Lang = "ko" | "en" | "vi" | "id"

/** 약관 본문. 언어는 주소(/en/terms 등)나 사용자 설정으로 정해져 prop으로 들어온다. */
export function TermsBody({ lang }: { lang: Lang }) {

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-12">

        {lang === "vi" ? (
          <article aria-label="Điều khoản Dịch vụ">
            <h1 className="text-3xl font-bold mb-2">Điều khoản Dịch vụ</h1>
            <p className="text-muted-foreground text-sm mb-10">Cập nhật lần cuối: 9 tháng 5, 2026</p>
            <nav aria-label="Mục lục" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Mục lục</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#vi-terms-1" className="hover:text-ocean-400 transition-colors">Điều 1 (Mục đích)</a></li>
                <li><a href="#vi-terms-2" className="hover:text-ocean-400 transition-colors">Điều 2 (Định nghĩa)</a></li>
                <li><a href="#vi-terms-3" className="hover:text-ocean-400 transition-colors">Điều 3 (Hiệu lực &amp; Sửa đổi)</a></li>
                <li><a href="#vi-terms-4" className="hover:text-ocean-400 transition-colors">Điều 4 (Sử dụng Dịch vụ)</a></li>
                <li><a href="#vi-terms-5" className="hover:text-ocean-400 transition-colors">Điều 5 (Nghĩa vụ Người dùng)</a></li>
                <li><a href="#vi-terms-6" className="hover:text-ocean-400 transition-colors">Điều 6 (Phí &amp; Quảng cáo)</a></li>
                <li><a href="#vi-terms-7" className="hover:text-ocean-400 transition-colors">Điều 7 (Giới hạn Trách nhiệm)</a></li>
                <li><a href="#vi-terms-8" className="hover:text-ocean-400 transition-colors">Điều 8 (Liên hệ)</a></li>
              </ol>
            </nav>
            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="vi-terms-1"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 1 (Mục đích)</h2><p>Các Điều khoản Dịch vụ này điều chỉnh quyền, nghĩa vụ và trách nhiệm giữa CULIVER INC ("Công ty") và người dùng dịch vụ quản lý nuôi tôm thông minh Shrimp365 ("Dịch vụ").</p></section>
              <section id="vi-terms-2"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 2 (Định nghĩa)</h2><ul className="space-y-2 list-disc list-inside"><li>"Dịch vụ" bao gồm tất cả các tính năng do Công ty cung cấp, bao gồm giám sát chất lượng nước, nhật ký nuôi trồng, chẩn đoán bệnh và tư vấn AI.</li><li>"Người dùng" là bất kỳ cá nhân hoặc pháp nhân nào đồng ý với các Điều khoản này và sử dụng Dịch vụ.</li><li>"Tài khoản" là sự kết hợp địa chỉ email và mật khẩu do Người dùng thiết lập để truy cập Dịch vụ.</li></ul></section>
              <section id="vi-terms-3"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 3 (Hiệu lực &amp; Sửa đổi)</h2><p>Các Điều khoản này có hiệu lực khi được đăng trên Dịch vụ hoặc thông báo cho Người dùng. Công ty có thể sửa đổi các Điều khoản khi cần thiết; các Điều khoản sửa đổi có hiệu lực sau 7 ngày thông báo.</p></section>
              <section id="vi-terms-4"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 4 (Sử dụng Dịch vụ)</h2><ul className="space-y-2 list-disc list-inside"><li>Dịch vụ có thể sử dụng ngay sau khi đăng ký.</li><li>Tất cả các tính năng được cung cấp hoàn toàn miễn phí, không giới hạn số trang trại hoặc ao.</li><li>Công ty có thể sửa đổi nội dung Dịch vụ với thông báo trước để cải thiện chất lượng.</li><li>Dịch vụ có thể tạm thời bị gián đoạn do bất khả kháng hoặc bảo trì theo lịch.</li></ul></section>
              <section id="vi-terms-5"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 5 (Nghĩa vụ Người dùng)</h2><ul className="space-y-2 list-disc list-inside"><li>Người dùng không được mạo danh người khác hoặc đăng ký thông tin sai.</li><li>Người dùng không được sử dụng Dịch vụ vi phạm pháp luật hoặc trật tự công cộng.</li><li>Người dùng chịu trách nhiệm quản lý thông tin xác thực tài khoản của mình.</li></ul></section>
              <section id="vi-terms-6"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 6 (Phí &amp; Quảng cáo)</h2><ul className="space-y-2 list-disc list-inside"><li>Dịch vụ được cung cấp hoàn toàn miễn phí, không có phí hoặc đăng ký nào.</li><li>Công ty có thể hiển thị quảng cáo trong Dịch vụ để trang trải chi phí vận hành.</li><li>Vì không có phí thanh toán nên không áp dụng hoàn tiền.</li></ul></section>
              <section id="vi-terms-7"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 7 (Giới hạn Trách nhiệm)</h2><p>Công ty làm rõ rằng kết quả tư vấn AI và chẩn đoán chất lượng nước trong Dịch vụ chỉ mang tính tham khảo. Người dùng chịu trách nhiệm cuối cùng về các quyết định nuôi trồng dựa trên thông tin đó. Công ty không chịu trách nhiệm về thiệt hại gián tiếp phát sinh từ việc sử dụng Dịch vụ.</p></section>
              <section id="vi-terms-8"><h2 className="text-xl font-semibold text-foreground mb-3">Điều 8 (Liên hệ)</h2><p>Để được hỗ trợ, vui lòng liên hệ:</p><p className="mt-2">Email: <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p></section>
            </div>
          </article>
        ) : lang === "id" ? (
          <article aria-label="Syarat Layanan">
            <h1 className="text-3xl font-bold mb-2">Syarat Layanan</h1>
            <p className="text-muted-foreground text-sm mb-10">Terakhir diperbarui: 9 Mei 2026</p>
            <nav aria-label="Daftar isi" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Daftar Isi</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#id-terms-1" className="hover:text-ocean-400 transition-colors">Pasal 1 (Tujuan)</a></li>
                <li><a href="#id-terms-2" className="hover:text-ocean-400 transition-colors">Pasal 2 (Definisi)</a></li>
                <li><a href="#id-terms-3" className="hover:text-ocean-400 transition-colors">Pasal 3 (Berlaku &amp; Amandemen)</a></li>
                <li><a href="#id-terms-4" className="hover:text-ocean-400 transition-colors">Pasal 4 (Penggunaan Layanan)</a></li>
                <li><a href="#id-terms-5" className="hover:text-ocean-400 transition-colors">Pasal 5 (Kewajiban Pengguna)</a></li>
                <li><a href="#id-terms-6" className="hover:text-ocean-400 transition-colors">Pasal 6 (Biaya &amp; Iklan)</a></li>
                <li><a href="#id-terms-7" className="hover:text-ocean-400 transition-colors">Pasal 7 (Batasan Tanggung Jawab)</a></li>
                <li><a href="#id-terms-8" className="hover:text-ocean-400 transition-colors">Pasal 8 (Kontak)</a></li>
              </ol>
            </nav>
            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="id-terms-1"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 1 (Tujuan)</h2><p>Syarat Layanan ini mengatur hak, kewajiban, dan tanggung jawab antara CULIVER INC ("Perusahaan") dan pengguna layanan manajemen budidaya udang pintar Shrimp365 ("Layanan").</p></section>
              <section id="id-terms-2"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 2 (Definisi)</h2><ul className="space-y-2 list-disc list-inside"><li>"Layanan" berarti semua fitur yang disediakan oleh Perusahaan, termasuk pemantauan kualitas air, jurnal budidaya, diagnosis penyakit, dan konsultan AI.</li><li>"Pengguna" adalah individu atau badan hukum yang menyetujui Syarat ini dan menggunakan Layanan.</li><li>"Akun" adalah kombinasi alamat email dan kata sandi yang ditetapkan Pengguna untuk mengakses Layanan.</li></ul></section>
              <section id="id-terms-3"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 3 (Berlaku &amp; Amandemen)</h2><p>Syarat ini berlaku ketika diposting di Layanan atau diberitahukan kepada Pengguna. Perusahaan dapat mengubah Syarat ini sesuai kebutuhan; Syarat yang diubah berlaku 7 hari setelah pemberitahuan.</p></section>
              <section id="id-terms-4"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 4 (Penggunaan Layanan)</h2><ul className="space-y-2 list-disc list-inside"><li>Layanan tersedia segera setelah pendaftaran.</li><li>Semua fitur disediakan sepenuhnya gratis, tanpa batas jumlah tambak atau kolam.</li><li>Perusahaan dapat memodifikasi konten Layanan dengan pemberitahuan sebelumnya untuk meningkatkan kualitas.</li><li>Layanan mungkin terganggu sementara karena force majeure atau pemeliharaan terjadwal.</li></ul></section>
              <section id="id-terms-5"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 5 (Kewajiban Pengguna)</h2><ul className="space-y-2 list-disc list-inside"><li>Pengguna tidak boleh menyamar sebagai orang lain atau mendaftarkan informasi palsu.</li><li>Pengguna tidak boleh menggunakan Layanan dengan melanggar hukum atau ketertiban umum.</li><li>Pengguna bertanggung jawab atas pengelolaan kredensial akun mereka.</li></ul></section>
              <section id="id-terms-6"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 6 (Biaya &amp; Iklan)</h2><ul className="space-y-2 list-disc list-inside"><li>Layanan disediakan sepenuhnya gratis, tanpa biaya atau langganan.</li><li>Perusahaan dapat menampilkan iklan dalam Layanan untuk menutupi biaya operasional.</li><li>Karena tidak ada biaya berbayar, tidak ada pengembalian dana yang berlaku.</li></ul></section>
              <section id="id-terms-7"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 7 (Batasan Tanggung Jawab)</h2><p>Perusahaan menjelaskan bahwa output konsultan AI dan diagnostik kualitas air dalam Layanan hanya untuk referensi. Pengguna menanggung tanggung jawab akhir atas keputusan budidaya berdasarkan informasi tersebut. Perusahaan tidak bertanggung jawab atas kerugian tidak langsung yang timbul dari penggunaan Layanan.</p></section>
              <section id="id-terms-8"><h2 className="text-xl font-semibold text-foreground mb-3">Pasal 8 (Kontak)</h2><p>Untuk pertanyaan mengenai Layanan, hubungi kami di:</p><p className="mt-2">Email: <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p></section>
            </div>
          </article>
        ) : lang === "ko" ? (
          <article aria-label="서비스 이용약관">
            <h1 className="text-3xl font-bold mb-2">서비스 이용약관</h1>
            <p className="text-muted-foreground text-sm mb-10">최종 수정일: 2026년 5월 9일</p>

            {/* 목차 */}
            <nav aria-label="목차" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">목차</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#ko-terms-1" className="hover:text-ocean-400 transition-colors">제1조 (목적)</a></li>
                <li><a href="#ko-terms-2" className="hover:text-ocean-400 transition-colors">제2조 (정의)</a></li>
                <li><a href="#ko-terms-3" className="hover:text-ocean-400 transition-colors">제3조 (약관의 효력 및 변경)</a></li>
                <li><a href="#ko-terms-4" className="hover:text-ocean-400 transition-colors">제4조 (서비스 이용)</a></li>
                <li><a href="#ko-terms-5" className="hover:text-ocean-400 transition-colors">제5조 (이용자의 의무)</a></li>
                <li><a href="#ko-terms-6" className="hover:text-ocean-400 transition-colors">제6조 (요금 및 광고)</a></li>
                <li><a href="#ko-terms-7" className="hover:text-ocean-400 transition-colors">제7조 (책임의 한계)</a></li>
                <li><a href="#ko-terms-8" className="hover:text-ocean-400 transition-colors">제8조 (문의)</a></li>
              </ol>
            </nav>

            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="ko-terms-1" aria-label="목적">
                <h2 className="text-xl font-semibold text-foreground mb-3">제1조 (목적)</h2>
                <p>본 약관은 CULIVER INC(이하 "회사")가 제공하는 스마트 새우 양식 관리 서비스(이하 "서비스")의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>
              </section>
              <section id="ko-terms-2" aria-label="정의">
                <h2 className="text-xl font-semibold text-foreground mb-3">제2조 (정의)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>"서비스"란 회사가 제공하는 수질 모니터링, 양식 일지, 질병 진단, AI 어드바이저 등 일체의 서비스를 의미합니다.</li>
                  <li>"이용자"란 본 약관에 동의하고 서비스를 이용하는 개인 또는 법인을 의미합니다.</li>
                  <li>"계정"이란 이용자가 서비스 이용을 위해 설정한 이메일 및 비밀번호의 조합을 의미합니다.</li>
                </ul>
              </section>
              <section id="ko-terms-3" aria-label="약관의 효력 및 변경">
                <h2 className="text-xl font-semibold text-foreground mb-3">제3조 (약관의 효력 및 변경)</h2>
                <p>본 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력이 발생합니다. 회사는 필요한 경우 약관을 변경할 수 있으며, 변경된 약관은 공지 후 7일 이후부터 효력이 발생합니다.</p>
              </section>
              <section id="ko-terms-4" aria-label="서비스 이용">
                <h2 className="text-xl font-semibold text-foreground mb-3">제4조 (서비스 이용)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>서비스는 가입 후 즉시 이용 가능합니다.</li>
                  <li>모든 기능은 양식장·수조 수 제한 없이 완전 무료로 제공됩니다.</li>
                  <li>회사는 서비스 품질 향상을 위해 사전 공지 후 서비스 내용을 변경할 수 있습니다.</li>
                  <li>천재지변, 시스템 점검 등 불가피한 사유로 서비스가 일시 중단될 수 있습니다.</li>
                </ul>
              </section>
              <section id="ko-terms-5" aria-label="이용자의 의무">
                <h2 className="text-xl font-semibold text-foreground mb-3">제5조 (이용자의 의무)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>이용자는 타인의 정보를 도용하거나 허위 정보를 등록해서는 안 됩니다.</li>
                  <li>서비스를 이용하여 법령 또는 공공질서에 위반되는 행위를 해서는 안 됩니다.</li>
                  <li>계정 및 비밀번호의 관리 책임은 이용자에게 있습니다.</li>
                </ul>
              </section>
              <section id="ko-terms-6" aria-label="요금 및 광고">
                <h2 className="text-xl font-semibold text-foreground mb-3">제6조 (요금 및 광고)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>서비스는 별도의 요금이나 구독 없이 완전 무료로 제공됩니다.</li>
                  <li>회사는 서비스 운영 비용 충당을 위해 서비스 내에 광고를 게재할 수 있습니다.</li>
                  <li>유료 결제가 없으므로 환불이 발생하지 않습니다.</li>
                </ul>
              </section>
              <section id="ko-terms-7" aria-label="책임의 한계">
                <h2 className="text-xl font-semibold text-foreground mb-3">제7조 (책임의 한계)</h2>
                <p>회사는 서비스 내 AI 어드바이저, 수질 진단 결과 등이 참고 정보임을 명시하며, 이를 기반으로 한 양식 결정에 대한 최종 책임은 이용자에게 있습니다. 회사는 서비스 이용으로 발생한 간접적 손해에 대해 책임을 지지 않습니다.</p>
              </section>
              <section id="ko-terms-8" aria-label="문의">
                <h2 className="text-xl font-semibold text-foreground mb-3">제8조 (문의)</h2>
                <p>서비스 이용과 관련한 문의는 아래로 연락하시기 바랍니다.</p>
                <p className="mt-2">이메일: <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
              </section>
            </div>
          </article>
        ) : (
          <article aria-label="Terms of Service">
            <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
            <p className="text-muted-foreground text-sm mb-10">Last updated: May 9, 2026</p>

            {/* Table of Contents */}
            <nav aria-label="Table of contents" className="mb-10 p-4 bg-card border border-border rounded-xl">
              <p className="text-sm font-semibold mb-2 text-foreground">Contents</p>
              <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                <li><a href="#en-terms-1" className="hover:text-ocean-400 transition-colors">Article 1 (Purpose)</a></li>
                <li><a href="#en-terms-2" className="hover:text-ocean-400 transition-colors">Article 2 (Definitions)</a></li>
                <li><a href="#en-terms-3" className="hover:text-ocean-400 transition-colors">Article 3 (Effectiveness &amp; Amendments)</a></li>
                <li><a href="#en-terms-4" className="hover:text-ocean-400 transition-colors">Article 4 (Use of Service)</a></li>
                <li><a href="#en-terms-5" className="hover:text-ocean-400 transition-colors">Article 5 (User Obligations)</a></li>
                <li><a href="#en-terms-6" className="hover:text-ocean-400 transition-colors">Article 6 (Fees &amp; Advertising)</a></li>
                <li><a href="#en-terms-7" className="hover:text-ocean-400 transition-colors">Article 7 (Limitation of Liability)</a></li>
                <li><a href="#en-terms-8" className="hover:text-ocean-400 transition-colors">Article 8 (Contact)</a></li>
              </ol>
            </nav>

            <div className="space-y-8 text-foreground/80 leading-relaxed">
              <section id="en-terms-1" aria-label="Purpose">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 1 (Purpose)</h2>
                <p>These Terms of Service govern the rights, obligations, and responsibilities between CULIVER INC (the "Company") and users of the Shrimp365 smart aquaculture management service (the "Service").</p>
              </section>
              <section id="en-terms-2" aria-label="Definitions">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 2 (Definitions)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>"Service" means all features provided by the Company, including water quality monitoring, farming journals, disease diagnosis, and AI advisor.</li>
                  <li>"User" means any individual or legal entity that agrees to these Terms and uses the Service.</li>
                  <li>"Account" means the email address and password combination set by the User to access the Service.</li>
                </ul>
              </section>
              <section id="en-terms-3" aria-label="Effectiveness and Amendments">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 3 (Effectiveness &amp; Amendments)</h2>
                <p>These Terms take effect when posted on the Service or otherwise notified to Users. The Company may amend these Terms as needed; amended Terms take effect 7 days after notice.</p>
              </section>
              <section id="en-terms-4" aria-label="Use of Service">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 4 (Use of Service)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>The Service is available immediately upon registration.</li>
                  <li>All features are provided completely free of charge, with no limit on the number of farms or tanks.</li>
                  <li>The Company may modify Service content with prior notice to improve quality.</li>
                  <li>The Service may be temporarily suspended due to force majeure or scheduled maintenance.</li>
                </ul>
              </section>
              <section id="en-terms-5" aria-label="User Obligations">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 5 (User Obligations)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Users must not impersonate others or register false information.</li>
                  <li>Users must not use the Service in violation of applicable laws or public order.</li>
                  <li>Users are responsible for managing their account credentials.</li>
                </ul>
              </section>
              <section id="en-terms-6" aria-label="Fees and Advertising">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 6 (Fees &amp; Advertising)</h2>
                <ul className="space-y-2 list-disc list-inside">
                  <li>The Service is provided completely free of charge, with no fees or subscriptions.</li>
                  <li>The Company may display advertising within the Service to cover operating costs.</li>
                  <li>As there are no paid charges, no refunds apply.</li>
                </ul>
              </section>
              <section id="en-terms-7" aria-label="Limitation of Liability">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 7 (Limitation of Liability)</h2>
                <p>The Company clarifies that AI advisor outputs and water quality diagnostics within the Service are for reference only. Users bear final responsibility for farming decisions made based on such information. The Company is not liable for indirect damages arising from use of the Service.</p>
              </section>
              <section id="en-terms-8" aria-label="Contact">
                <h2 className="text-xl font-semibold text-foreground mb-3">Article 8 (Contact)</h2>
                <p>For inquiries regarding the Service, please contact us at:</p>
                <p className="mt-2">Email: <a href="mailto:contact@culiver.ai" className="text-ocean-400 hover:underline">contact@culiver.ai</a></p>
              </section>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
