-- ============================================================
-- 카드뉴스 — pH 하루 변동 (en / vi / id) · 2026-08-12
--
-- 한국어판과 같은 slug("ph-daily-swing")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/ph-daily-swing/01..08.png
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
  $cn$ph-daily-swing$cn$,
  $cn$en$cn$,
  $cn$Managing pH — The Daily Swing Matters More Than the Number$cn$,
  $cn$pH 8.2 is a good reading. An 8.2 that was 7.6 before dawn and 8.6 in the afternoon is a different story. Here is the 0.5 daily limit and how pH changes ammonia and sulfide toxicity.$cn$,
  $cn$You measure pH in the afternoon and get 8.2. Inside the range, so move on? Not quite. If that 8.2 came after 7.6 before dawn and 8.6 at midday, the water moved 1.0 in a day. To shrimp that width matters more than the number itself.

■ The range — 7.5 to 8.5

For white shrimp, manage pH between 7.5 and 8.5.

But that range describes a single moment. Measure once a day and you cannot tell how much the water is moving.

■ Keep the daily swing under 0.5

When the gap between the day's high and low passes 0.5, treat it as a problem that has already started.

A wide swing usually signals too much phytoplankton. So the swing is both a burden in itself and an indicator pointing at something else.

■ Why it moves — up by day, down by night

By day, plankton photosynthesise and take carbon dioxide out of the water. Less carbon dioxide means higher pH, peaking around 2 to 4 in the afternoon.

After sundown photosynthesis stops and only respiration remains. Carbon dioxide builds and pH falls, bottoming out before dawn.

The more plankton, the wider the curve. Ponds reading under 25 cm on the Secchi disk swinging hard on pH is no coincidence.

■ Measure twice a day

Before dawn, 4 to 6 in the morning, and in the afternoon, 2 to 4. Those are the times that capture the low and the high. Write both down or the width stays invisible.

If you already measure dissolved oxygen before dawn, take pH at the same time. One trip, two readings.

■ When pH is high — ammonia gets more toxic

At the same total ammonia, a higher pH raises the share of the toxic form. Roughly 1.2% at pH 7.5, about 11% at pH 8.5 — close to a tenfold difference.

So a pond running past 8.5 in the afternoon is far more dangerous at the same ammonia reading. That is why you always read pH alongside ammonia.

■ When pH is low — sulfide gets more toxic

The direction reverses. For hydrogen sulfide, the toxic share rises as pH falls. Near pH 8 it is under a tenth of total sulfide, and it climbs steeply below that.

This is why ponds with sludge on the bottom have accidents after heavy rain. Rainwater pulls pH down, and at that moment the sulfide down there turns more toxic.

So pH is dangerous high and dangerous low. Watch both ends.

■ The fix is alkalinity

Do not try to move pH directly. The reason it swings is that there is no buffer, and that buffer is alkalinity.

Hold alkalinity at 100 to 150 mg/L and pH moves far less at the same plankton density. Alongside that, check clarity for an overbloom and adjust the feed rate.

■ Records matter more than thresholds

Write the pre-dawn pH and the afternoon pH side by side on the same date. Within days the widening becomes visible. A 0.3 gap growing to 0.4 and 0.5 means plankton is building, and you can act before it crashes.

Shrimp365 logs pH by time of day, draws the daily swing, and alerts you the moment a value leaves its range. Free to use.$cn$,
  array[
    $cn$/cardnews/en/ph-daily-swing/01.png$cn$, $cn$/cardnews/en/ph-daily-swing/02.png$cn$,
    $cn$/cardnews/en/ph-daily-swing/03.png$cn$, $cn$/cardnews/en/ph-daily-swing/04.png$cn$,
    $cn$/cardnews/en/ph-daily-swing/05.png$cn$, $cn$/cardnews/en/ph-daily-swing/06.png$cn$,
    $cn$/cardnews/en/ph-daily-swing/07.png$cn$, $cn$/cardnews/en/ph-daily-swing/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/ph-daily-swing/01.png$cn$,
  array[
    $cn$pH$cn$, $cn$alkalinity$cn$, $cn$ammonia$cn$, $cn$hydrogen sulfide$cn$,
    $cn$plankton$cn$, $cn$water quality$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-12 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$ph-daily-swing$cn$,
  $cn$vi$cn$,
  $cn$Quản lý pH — Biên độ trong ngày quan trọng hơn con số$cn$,
  $cn$pH 8,2 là con số đẹp. Nhưng 8,2 mà rạng sáng là 7,6 rồi chiều lên 8,6 thì lại khác. Bài này nói về giới hạn 0,5 mỗi ngày và cách pH làm đổi độc tính của amoniac và khí H2S.$cn$,
  $cn$Chiều đo pH được 8,2. Nằm trong khoảng phù hợp nên bỏ qua được chăng. Không hẳn. Nếu 8,2 đó có được sau khi rạng sáng là 7,6 rồi giữa trưa lên 8,6, thì nước đã dịch 1,0 trong một ngày. Với con tôm, biên độ đó quan trọng hơn bản thân con số.

■ Khoảng phù hợp — 7,5 đến 8,5

Với tôm thẻ chân trắng, quản lý pH trong khoảng 7,5 đến 8,5.

Nhưng khoảng đó chỉ mô tả một thời điểm. Đo mỗi ngày một lần thì không biết nước đang dao động bao nhiêu.

■ Giữ biên độ ngày dưới 0,5

Khi chênh lệch giữa mức cao nhất và thấp nhất trong ngày vượt 0,5, hãy coi là vấn đề đã bắt đầu.

Biên độ rộng thường là dấu hiệu tảo quá nhiều. Nên biên độ pH vừa là gánh nặng vừa là chỉ báo cho thứ khác.

■ Vì sao dao động — ngày lên, đêm xuống

Ban ngày tảo quang hợp và lấy CO2 ra khỏi nước. CO2 giảm thì pH lên, cao nhất vào khoảng 2 đến 4 giờ chiều.

Mặt trời lặn thì quang hợp dừng, chỉ còn hô hấp. CO2 tích lại và pH tụt, thấp nhất vào lúc rạng sáng.

Tảo càng nhiều thì đường cong càng rộng. Ao có độ trong dưới 25 cm mà pH dao động mạnh không phải là ngẫu nhiên.

■ Đo hai lần một ngày

Rạng sáng 4 đến 6 giờ và buổi chiều 2 đến 4 giờ. Đó là hai thời điểm bắt được mức thấp nhất và cao nhất. Ghi cả hai thì mới thấy được biên độ.

Nếu bạn đã đo oxy hòa tan lúc rạng sáng thì đo pH luôn thể. Một lần ra ao được hai chỉ số.

■ Khi pH cao — amoniac độc hơn

Cùng một nồng độ amoniac tổng, pH càng cao thì tỉ lệ dạng độc càng lớn. Khoảng 1,2% ở pH 7,5 và khoảng 11% ở pH 8,5 — chênh gần mười lần.

Nên ao mà buổi chiều vượt 8,5 sẽ nguy hiểm hơn hẳn dù chỉ số amoniac như nhau. Đó là lý do luôn phải xem pH cùng với amoniac.

■ Khi pH thấp — khí H2S độc hơn

Chiều ngược lại. Với khí H2S, pH càng thấp thì tỉ lệ dạng độc càng lên. Quanh pH 8 thì chưa tới một phần mười tổng sulfua, và tụt xuống nữa thì tăng rất nhanh.

Đó là lý do ao có bùn tích ở đáy hay gặp sự cố sau mưa lớn. Nước mưa kéo pH xuống, và ngay lúc đó khí H2S dưới đáy độc hơn.

Nghĩa là pH cao cũng nguy mà thấp cũng nguy. Phải xem cả hai đầu.

■ Cách xử lý là độ kiềm

Đừng cố can thiệp trực tiếp vào pH. Lý do nó dao động là không có đệm, mà đệm chính là độ kiềm.

Giữ độ kiềm ở 100 đến 150 mg/L thì cùng mật độ tảo ấy pH sẽ ít dịch hơn nhiều. Song song đó hãy xem độ trong để biết tảo có quá dày không và điều chỉnh lượng cho ăn.

■ Ghi chép quan trọng hơn ngưỡng

Ghi pH rạng sáng và pH buổi chiều cạnh nhau cùng một ngày. Chỉ vài ngày là thấy biên độ đang rộng ra. Từ 0,3 lên 0,4 rồi 0,5 nghĩa là tảo đang tăng, và bạn kịp xử lý trước khi nó sập.

Shrimp365 ghi pH theo từng thời điểm, vẽ ra biên độ trong ngày và báo ngay khi có chỉ số vượt ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/ph-daily-swing/01.png$cn$, $cn$/cardnews/vi/ph-daily-swing/02.png$cn$,
    $cn$/cardnews/vi/ph-daily-swing/03.png$cn$, $cn$/cardnews/vi/ph-daily-swing/04.png$cn$,
    $cn$/cardnews/vi/ph-daily-swing/05.png$cn$, $cn$/cardnews/vi/ph-daily-swing/06.png$cn$,
    $cn$/cardnews/vi/ph-daily-swing/07.png$cn$, $cn$/cardnews/vi/ph-daily-swing/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/ph-daily-swing/01.png$cn$,
  array[
    $cn$pH$cn$, $cn$độ kiềm$cn$, $cn$amoniac$cn$, $cn$khí H2S$cn$,
    $cn$tảo$cn$, $cn$chất lượng nước$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-12 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$ph-daily-swing$cn$,
  $cn$id$cn$,
  $cn$Mengelola pH — Ayunan Harian Lebih Penting dari Angkanya$cn$,
  $cn$pH 8,2 adalah angka bagus. Tetapi 8,2 yang subuhnya 7,6 lalu sore 8,6 itu cerita lain. Berikut batas ayunan 0,5 per hari dan bagaimana pH mengubah racun amonia dan sulfida.$cn$,
  $cn$Sore hari Anda mengukur pH dan dapat 8,2. Masih di dalam rentang, jadi lewatkan saja? Belum tentu. Kalau 8,2 itu datang setelah 7,6 menjelang subuh dan 8,6 di siang hari, airnya bergerak 1,0 dalam sehari. Bagi udang, lebar itu lebih penting daripada angkanya sendiri.

■ Rentangnya — 7,5 sampai 8,5

Untuk udang vaname, kelola pH antara 7,5 dan 8,5.

Tetapi rentang itu menggambarkan satu titik waktu. Mengukur sekali sehari tidak memberi tahu seberapa besar airnya bergerak.

■ Jaga ayunan harian di bawah 0,5

Kalau selisih tertinggi dan terendah dalam sehari melewati 0,5, anggap masalahnya sudah dimulai.

Ayunan lebar biasanya menandakan fitoplankton terlalu banyak. Jadi ayunan pH sekaligus beban dan penunjuk ke masalah lain.

■ Kenapa bergerak — naik siang, turun malam

Siang hari plankton berfotosintesis dan mengambil karbon dioksida dari air. Karbon dioksida berkurang, pH naik, tertinggi sekitar pukul 2 sampai 4 sore.

Setelah matahari terbenam fotosintesis berhenti dan tinggal respirasi. Karbon dioksida menumpuk dan pH turun, terendah menjelang subuh.

Makin banyak plankton, makin lebar kurvanya. Tambak dengan kecerahan di bawah 25 cm yang pH-nya berayun keras bukan kebetulan.

■ Ukur dua kali sehari

Menjelang subuh pukul 4 sampai 6, dan sore pukul 2 sampai 4. Itulah waktu yang menangkap titik terendah dan tertinggi. Catat keduanya, kalau tidak lebarnya tak terlihat.

Kalau Anda sudah mengukur oksigen terlarut menjelang subuh, ukur pH sekalian. Sekali keluar, dua parameter.

■ Saat pH tinggi — amonia lebih beracun

Pada total amonia yang sama, pH lebih tinggi menaikkan proporsi bentuk beracunnya. Sekitar 1,2% di pH 7,5 dan sekitar 11% di pH 8,5 — hampir sepuluh kali lipat.

Jadi tambak yang sore hari melewati 8,5 jauh lebih berbahaya pada angka amonia yang sama. Itulah sebabnya pH selalu dibaca bersama amonia.

■ Saat pH rendah — sulfida lebih beracun

Arahnya berbalik. Untuk hidrogen sulfida, proporsi beracunnya naik saat pH turun. Di sekitar pH 8 belum sampai sepersepuluh total sulfida, dan melonjak tajam di bawah itu.

Inilah sebabnya tambak berendapan mengalami kecelakaan setelah hujan deras. Air hujan menarik pH turun, dan tepat saat itu sulfida di dasar menjadi lebih beracun.

Jadi pH berbahaya saat tinggi maupun rendah. Perhatikan kedua ujungnya.

■ Penanganannya adalah alkalinitas

Jangan mencoba menggeser pH secara langsung. Alasan ia berayun adalah tidak ada penyangga, dan penyangga itu alkalinitas.

Jaga alkalinitas di 100 sampai 150 mg/L maka pada kepadatan plankton yang sama pH akan jauh lebih tenang. Bersamaan dengan itu, periksa kecerahan untuk melihat kelebihan plankton dan sesuaikan jumlah pakan.

■ Catatan lebih penting daripada angka batas

Tulis pH subuh dan pH sore berdampingan pada tanggal yang sama. Dalam hitungan hari pelebarannya akan terlihat. Selisih 0,3 yang menjadi 0,4 lalu 0,5 berarti plankton sedang bertambah, dan Anda bisa bertindak sebelum runtuh.

Shrimp365 mencatat pH per waktu, menggambar ayunan hariannya, dan memberi tahu begitu sebuah nilai keluar dari rentangnya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/ph-daily-swing/01.png$cn$, $cn$/cardnews/id/ph-daily-swing/02.png$cn$,
    $cn$/cardnews/id/ph-daily-swing/03.png$cn$, $cn$/cardnews/id/ph-daily-swing/04.png$cn$,
    $cn$/cardnews/id/ph-daily-swing/05.png$cn$, $cn$/cardnews/id/ph-daily-swing/06.png$cn$,
    $cn$/cardnews/id/ph-daily-swing/07.png$cn$, $cn$/cardnews/id/ph-daily-swing/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/ph-daily-swing/01.png$cn$,
  array[
    $cn$pH$cn$, $cn$alkalinitas$cn$, $cn$amonia$cn$, $cn$hidrogen sulfida$cn$,
    $cn$plankton$cn$, $cn$kualitas air$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-12 09:00:00+09$cn$::timestamptz
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
