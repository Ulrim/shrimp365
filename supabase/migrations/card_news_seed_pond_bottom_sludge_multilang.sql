-- ============================================================
-- 카드뉴스 — 바닥 관리와 황화수소 (en / vi / id) · 2026-08-08
--
-- 한국어판과 같은 slug("pond-bottom-sludge")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/pond-bottom-sludge/01..08.png
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
--              published_at·조회수·좋아요는 건드리지 않는다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values

-- ── English ────────────────────────────────────────────────
(
  $cn$pond-bottom-sludge$cn$,
  $cn$en$cn$,
  $cn$Pond Bottom Management — A Black Bottom Means You Are Late$cn$,
  $cn$Sludge on the bottom generates hydrogen sulfide. Keep it under 0.01 mg/L; harm is reported even at 0.002 mg/L. That is a different order of magnitude from your other parameters.$cn$,
  $cn$Some ponds read normal on all six water quality parameters and still lose shrimp steadily. That happens when you are only watching the water. Shrimp live on the bottom, and the accident starts there.

■ The bottom keeps accumulating

Uneaten feed, waste and dead plankton settle every day. The rate rises as the cycle goes on, because the feed rate rises.

Breaking that down takes oxygen. Once the layer thickens, oxygen no longer reaches inside it. Bacteria that work without oxygen take over, and from that point the products of decomposition change.

■ Hydrogen sulfide — a different order of magnitude

What forms on an oxygen-free bottom is hydrogen sulfide, the gas that smells of rotten eggs.

Keep it under 0.01 mg/L. For white shrimp, harm is reported at concentrations as low as 0.002 mg/L.

Put that number beside the others. Ammonia is discussed in units of 1 mg/L, and so is nitrite. Hydrogen sulfide causes accidents more than a hundred times below that. So "there is a little" is not a meaningful phrase here.

■ Lower pH is more toxic — the opposite of ammonia

Ammonia gets more toxic as pH rises. Sulfide is the reverse: the toxic fraction rises as pH falls.

Near pH 8 the toxic form is under a tenth of total sulfide, and that share climbs steeply as pH drops. This is why bottom trouble compounds after heavy rain, or on ponds running low alkalinity. A falling pH and a bottom problem should never be looked at separately.

■ Prevention — get oxygen to the bottom

Hydrogen sulfide only forms where there is no oxygen. Put the other way: it does not form as long as oxygen reaches the bottom.

The working target is 3 mg/L or more near the bottom. That is what aerator placement is for. Aerators must lift bottom water and mix it, not just churn the surface. In summer, when stratification sets in at midday, this matters most.

And the cheapest method is to let less accumulate in the first place. Check the feed trays and adjust the ration by what is left. Uneaten feed is both a cost and a load on the bottom.

■ Checking — colour and smell

Few farms measure hydrogen sulfide daily. Check the bottom directly instead.

Scoop bottom mud with a pole or net and look at the colour and smell it. Blackened and smelling of rotten eggs is conclusive — sulfide is being produced right there.

It varies by spot within one pond. It appears first in corners the current does not reach and far from the aerators. Do not judge from one place; sample several.

■ If the dead shrimp are on the bottom

If mortalities are found mostly on the bottom, if shrimp try to move to the edges, and if all six water parameters read normal, suspect the bottom. Keep measuring only the water and you will spend days without finding the cause.

■ Records matter more than thresholds

Noting the bottom's colour and smell every few days is enough. Put feed rate, aerator hours and bottom checks side by side on the same date and you will see the point where the bottom started to go.

Shrimp365 logs dissolved oxygen, pH and feed rate per tank so you can see the bottom deteriorating before it costs you. Free to use.$cn$,
  array[
    $cn$/cardnews/en/pond-bottom-sludge/01.png$cn$, $cn$/cardnews/en/pond-bottom-sludge/02.png$cn$,
    $cn$/cardnews/en/pond-bottom-sludge/03.png$cn$, $cn$/cardnews/en/pond-bottom-sludge/04.png$cn$,
    $cn$/cardnews/en/pond-bottom-sludge/05.png$cn$, $cn$/cardnews/en/pond-bottom-sludge/06.png$cn$,
    $cn$/cardnews/en/pond-bottom-sludge/07.png$cn$, $cn$/cardnews/en/pond-bottom-sludge/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/pond-bottom-sludge/01.png$cn$,
  array[
    $cn$hydrogen sulfide$cn$, $cn$pond management$cn$, $cn$dissolved oxygen$cn$, $cn$feed management$cn$,
    $cn$water quality$cn$, $cn$mortality$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-08 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$pond-bottom-sludge$cn$,
  $cn$vi$cn$,
  $cn$Quản lý đáy ao — Đáy đã đen là đã muộn$cn$,
  $cn$Bùn tích ở đáy sinh ra khí H2S. Phải giữ dưới 0,01 mg/L, mà ngay ở 0,002 mg/L đã có thiệt hại. Đây là mức khác hẳn bậc so với các chỉ tiêu khác.$cn$,
  $cn$Có những ao mà sáu chỉ tiêu nước đều bình thường nhưng tôm cứ hao dần. Đó là vì chỉ nhìn nước. Tôm sống ở đáy, và tai nạn cũng bắt đầu từ đáy.

■ Đáy ao thì cứ tích tụ mãi

Thức ăn thừa, phân tôm, tảo chết mỗi ngày đều lắng xuống đáy. Vụ càng về sau tốc độ tích tụ càng nhanh, vì lượng cho ăn tăng lên.

Muốn phân hủy được thì cần oxy. Nhưng lớp tích tụ dày lên thì oxy không vào tới bên trong nữa. Vi khuẩn hoạt động không cần oxy chiếm chỗ, và từ đó sản phẩm phân hủy đổi khác.

■ Khí H2S — khác hẳn bậc so với chỉ tiêu khác

Thứ sinh ra ở đáy không có oxy chính là khí H2S, loại khí có mùi trứng thối.

Ngưỡng quản lý là dưới 0,01 mg/L. Ở tôm thẻ chân trắng, thiệt hại đã được ghi nhận ở nồng độ thấp cỡ 0,002 mg/L.

Hãy đặt con số này cạnh các chỉ tiêu khác. Amoniac tính theo đơn vị 1 mg/L, nitrit cũng vậy. H2S gây tai nạn ở mức thấp hơn cả trăm lần. Nên câu "có một chút thôi" ở đây không có nghĩa gì cả.

■ pH càng thấp càng độc — ngược hẳn với amoniac

Amoniac càng độc khi pH càng cao. H2S thì ngược lại: pH càng thấp thì tỉ lệ dạng độc càng lên.

Quanh pH 8 thì dạng độc chưa tới một phần mười tổng sulfua, và tỉ lệ đó tăng rất nhanh khi pH tụt. Đó là lý do sự cố đáy hay chồng lên sau mưa lớn hoặc ở ao có độ kiềm thấp. Đừng bao giờ tách riêng chuyện pH tụt với chuyện đáy ao.

■ Cách chặn — đưa oxy xuống đáy

H2S chỉ sinh ra ở nơi không có oxy. Nói cách khác, còn oxy chạm tới đáy thì nó không sinh ra.

Chuẩn là giữ oxy hòa tan gần đáy từ 3 mg/L trở lên. Việc bố trí quạt là để làm điều đó. Quạt phải kéo được nước đáy lên trộn chứ không chỉ khuấy tầng mặt. Mùa nóng có phân tầng giữa trưa thì điều này càng quan trọng.

Và cách rẻ nhất là ngay từ đầu để nó tích tụ ít đi. Kiểm tra sàng ăn và điều chỉnh khẩu phần theo phần còn lại. Thức ăn thừa vừa là tiền vừa là gánh nặng cho đáy.

■ Kiểm tra — bằng màu và mùi

Ít ao nào đo H2S mỗi ngày. Thay vào đó hãy kiểm tra đáy trực tiếp.

Dùng sào hoặc vợt vớt bùn đáy lên xem màu và ngửi. Đen sạm và mùi trứng thối là chắc chắn. Lúc đó H2S đang được sinh ra ngay tại chỗ ấy.

Trong cùng một ao mỗi chỗ mỗi khác. Nó xuất hiện trước ở góc nước không chảy tới và ở xa quạt. Đừng chỉ nhìn một chỗ, hãy vớt nhiều điểm.

■ Nếu tôm chết nằm ở đáy

Nếu tôm chết chủ yếu ở đáy, tôm cố dạt ra bờ, mà sáu chỉ tiêu nước vẫn bình thường thì hãy nghi ngờ đáy ao. Cứ chỉ đo nước thì sẽ mất nhiều ngày mà không tìm ra nguyên nhân.

■ Ghi chép quan trọng hơn ngưỡng

Chỉ cần vài ngày một lần ghi lại màu và mùi của đáy là đủ. Đặt lượng cho ăn, giờ chạy quạt và kết quả kiểm tra đáy cạnh nhau cùng một ngày thì sẽ thấy đáy bắt đầu xấu đi từ lúc nào.

Shrimp365 ghi oxy hòa tan, pH và lượng cho ăn theo từng ao để bạn thấy trước xu hướng đáy đang xấu đi. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/pond-bottom-sludge/01.png$cn$, $cn$/cardnews/vi/pond-bottom-sludge/02.png$cn$,
    $cn$/cardnews/vi/pond-bottom-sludge/03.png$cn$, $cn$/cardnews/vi/pond-bottom-sludge/04.png$cn$,
    $cn$/cardnews/vi/pond-bottom-sludge/05.png$cn$, $cn$/cardnews/vi/pond-bottom-sludge/06.png$cn$,
    $cn$/cardnews/vi/pond-bottom-sludge/07.png$cn$, $cn$/cardnews/vi/pond-bottom-sludge/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/pond-bottom-sludge/01.png$cn$,
  array[
    $cn$khí H2S$cn$, $cn$quản lý ao$cn$, $cn$oxy hòa tan$cn$, $cn$quản lý thức ăn$cn$,
    $cn$chất lượng nước$cn$, $cn$tôm chết$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-08 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$pond-bottom-sludge$cn$,
  $cn$id$cn$,
  $cn$Mengelola Dasar Tambak — Dasar Menghitam Berarti Sudah Terlambat$cn$,
  $cn$Endapan di dasar menghasilkan hidrogen sulfida. Jaga di bawah 0,01 mg/L; kerugian dilaporkan bahkan pada 0,002 mg/L. Ordenya berbeda dari parameter air lainnya.$cn$,
  $cn$Ada tambak yang enam parameter airnya normal semua tapi udangnya terus berkurang. Itu terjadi karena hanya airnya yang diperhatikan. Udang hidup di dasar, dan kecelakaan pun bermula dari dasar.

■ Dasar terus menumpuk

Pakan yang tidak termakan, kotoran, dan plankton mati mengendap setiap hari. Makin jauh siklusnya, makin cepat penumpukannya, karena jumlah pakan bertambah.

Untuk terurai dibutuhkan oksigen. Tetapi begitu lapisannya menebal, oksigen tidak sampai ke dalamnya. Bakteri yang bekerja tanpa oksigen mengambil alih, dan sejak itu hasil penguraiannya berubah.

■ Hidrogen sulfida — ordenya berbeda

Yang terbentuk di dasar tanpa oksigen adalah hidrogen sulfida, gas berbau telur busuk itu.

Batas pengelolaannya di bawah 0,01 mg/L. Pada udang vaname, kerugian dilaporkan pada konsentrasi serendah 0,002 mg/L.

Sandingkan angka itu dengan parameter lain. Amonia dibicarakan dalam satuan 1 mg/L, nitrit juga. Hidrogen sulfida menimbulkan kecelakaan pada tingkat lebih dari seratus kali lebih rendah. Jadi ungkapan "cuma sedikit" tidak berlaku di sini.

■ Makin rendah pH makin beracun — kebalikan amonia

Amonia makin beracun saat pH naik. Sulfida sebaliknya: proporsi bentuk beracunnya naik saat pH turun.

Di sekitar pH 8, bentuk beracunnya belum sampai sepersepuluh total sulfida, dan proporsi itu melonjak tajam seiring pH turun. Inilah sebabnya masalah dasar sering menumpuk setelah hujan deras atau di tambak beralkalinitas rendah. pH yang turun dan masalah dasar tidak boleh dilihat terpisah.

■ Cara mencegah — masukkan oksigen ke dasar

Hidrogen sulfida hanya terbentuk di tempat tanpa oksigen. Sebaliknya, selama oksigen mencapai dasar, ia tidak terbentuk.

Patokannya menjaga oksigen terlarut dekat dasar minimal 3 mg/L. Untuk itulah penempatan kincir diatur. Kincir harus mengangkat air dasar dan mengaduknya, bukan sekadar mengocok permukaan. Di musim panas, saat stratifikasi terjadi tengah hari, ini paling penting.

Dan cara termurah adalah membuatnya menumpuk lebih sedikit sejak awal. Periksa anco dan sesuaikan jatah berdasarkan sisanya. Pakan yang tidak termakan adalah biaya sekaligus beban bagi dasar.

■ Cara cek — warna dan bau

Tidak banyak tambak yang mengukur hidrogen sulfida setiap hari. Sebagai gantinya periksa dasarnya langsung.

Ambil lumpur dasar dengan galah atau serokan, lihat warnanya dan cium baunya. Menghitam dan berbau telur busuk berarti sudah pasti — sulfida sedang terbentuk tepat di titik itu.

Di satu tambak pun tiap titik berbeda. Ia muncul lebih dulu di sudut yang tak terjangkau arus dan di titik jauh dari kincir. Jangan menilai dari satu tempat, ambil beberapa titik.

■ Kalau udang mati ditemukan di dasar

Kalau kematian kebanyakan ditemukan di dasar, udang berusaha ke tepi, dan enam parameter air normal semua, curigai dasarnya. Kalau hanya mengukur air terus, Anda akan menghabiskan waktu tanpa menemukan penyebabnya.

■ Catatan lebih penting daripada angka batas

Cukup mencatat warna dan bau dasar tiap beberapa hari. Sandingkan jumlah pakan, jam kincir, dan hasil pemeriksaan dasar pada tanggal yang sama, maka akan terlihat sejak kapan dasarnya mulai memburuk.

Shrimp365 mencatat oksigen terlarut, pH, dan jumlah pakan per petak agar Anda melihat dasar memburuk sebelum merugikan. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/pond-bottom-sludge/01.png$cn$, $cn$/cardnews/id/pond-bottom-sludge/02.png$cn$,
    $cn$/cardnews/id/pond-bottom-sludge/03.png$cn$, $cn$/cardnews/id/pond-bottom-sludge/04.png$cn$,
    $cn$/cardnews/id/pond-bottom-sludge/05.png$cn$, $cn$/cardnews/id/pond-bottom-sludge/06.png$cn$,
    $cn$/cardnews/id/pond-bottom-sludge/07.png$cn$, $cn$/cardnews/id/pond-bottom-sludge/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/pond-bottom-sludge/01.png$cn$,
  array[
    $cn$hidrogen sulfida$cn$, $cn$manajemen tambak$cn$, $cn$oksigen terlarut$cn$, $cn$manajemen pakan$cn$,
    $cn$kualitas air$cn$, $cn$kematian udang$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-08 09:00:00+09$cn$::timestamptz
)

on conflict (slug, locale) do update set
  title      = excluded.title,
  summary    = excluded.summary,
  body       = excluded.body,
  images     = excluded.images,
  cover_url  = excluded.cover_url,
  tags       = excluded.tags,
  published  = excluded.published,
  updated_at = now();
