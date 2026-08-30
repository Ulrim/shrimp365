-- ============================================================
-- 카드뉴스 — 환수 요령 (en / vi / id) · 2026-08-13
--
-- 한국어판과 같은 slug("water-exchange")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/water-exchange/01..08.png
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
  $cn$water-exchange$cn$,
  $cn$en$cn$,
  $cn$Water Exchange — Order Matters More Than Volume$cn$,
  $cn$When a reading goes bad the first instinct is to swap water. That is how freshly moulted shrimp get lost. Here is the 30% limit, measuring the incoming water first, and what to check afterwards.$cn$,
  $cn$Ammonia is up. Nitrite is up. The colour looks wrong. The first thing that comes to mind is a water exchange. But an exchange is the strongest move available and also the one that causes the most accidents. Losing shrimp while chasing a number happens right here.

■ Never swap more than 30% at once

Keep any single exchange under 30%. Doing 20 to 30% in stages is safer.

The reason is simple. The more water you replace, the more temperature, salinity and pH move at once, and that change can hit the shrimp harder than the poor water quality did. Freshly moulted animals in particular cannot take it.

■ Measure the incoming water first

This is the step most often skipped. Measure the temperature, salinity and pH of the water you are about to add, then compare against the pond.

- A large temperature gap means adding it slowly, over time
- A large salinity gap means cutting the percentage further
- A very different pH means checking alkalinity too

Adding without measuring is changing the water without knowing what will change.

■ Daily limits — salinity 5 ppt, temperature 3 ℃

White shrimp live across 5 to 35 ppt, but a shift beyond 5 ppt in one day is more than freshly moulted animals can handle.

The same goes for temperature — keep the daily swing within 3 ℃.

Plan the exchange around those two ceilings. Instead of asking what percentage to swap, ask how far this water will move salinity. That framing prevents most mistakes.

■ Where you drain from changes things

The outlet depends on what you are trying to remove.

After heavy rain it is the surface. Rainwater is light and sits on top as a freshwater layer, so draining from above sends that layer out first.

If sludge has built up it is the bottom. On ponds with a central drain, pull from there and take the sediment with it.

Drain without deciding the purpose and only the water you needed leaves while the problem stays.

■ What to check afterwards

An exchange does not only change water. Bacteria and plankton leave with it.

So check nitrite for a few days afterwards. Diluting the nitrifiers temporarily cuts your capacity to process nitrite.

Watch the colour too. A large plankton loss can leave the rest collapsing and oxygen falling. Do not skip the pre-dawn reading the morning after an exchange.

■ Something comes before an exchange

When a reading climbs, the order is this. Cut the feed, raise the oxygen, then consider an exchange.

Cutting feed reduces the cause; an exchange washes out the result. Wash without removing the cause and you are back in the same place within days.

■ Records matter more than thresholds

Write down the date, the percentage swapped, the temperature, salinity and pH of both waters, and the readings over the following days. After a few exchanges you will know how your pond responds and how many days recovery takes.

Shrimp365 logs water quality before and after an exchange side by side so the size of the change is immediately visible. Free to use.$cn$,
  array[
    $cn$/cardnews/en/water-exchange/01.png$cn$, $cn$/cardnews/en/water-exchange/02.png$cn$,
    $cn$/cardnews/en/water-exchange/03.png$cn$, $cn$/cardnews/en/water-exchange/04.png$cn$,
    $cn$/cardnews/en/water-exchange/05.png$cn$, $cn$/cardnews/en/water-exchange/06.png$cn$,
    $cn$/cardnews/en/water-exchange/07.png$cn$, $cn$/cardnews/en/water-exchange/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/water-exchange/01.png$cn$,
  array[
    $cn$water exchange$cn$, $cn$salinity$cn$, $cn$water temperature$cn$, $cn$nitrite$cn$,
    $cn$water quality$cn$, $cn$pond management$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-13 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$water-exchange$cn$,
  $cn$vi$cn$,
  $cn$Thay nước ao tôm — Thứ tự quan trọng hơn lượng nước$cn$,
  $cn$Chỉ số xấu là nghĩ ngay tới thay nước. Rồi mất tôm đang lột. Bài này nói về giới hạn 30% một lần, đo nước mới trước, và những gì phải kiểm tra sau khi thay.$cn$,
  $cn$Amoniac lên. Nitrit lên. Màu nước trông lạ. Việc đầu tiên nghĩ tới là thay nước. Nhưng thay nước vừa là biện pháp mạnh nhất vừa là biện pháp hay gây sự cố nhất. Chuyện mất tôm vì chạy theo chỉ số xảy ra đúng ở đây.

■ Đừng thay quá 30% một lần

Mỗi lần thay giữ dưới 30%. Chia 20 đến 30% làm nhiều đợt thì an toàn hơn.

Lý do đơn giản. Thay càng nhiều thì nhiệt độ, độ mặn, pH càng dịch cùng lúc, và chính cái thay đổi đó có khi còn nặng hơn cả việc nước xấu. Nhất là con vừa lột thì không chịu nổi.

■ Đo nước mới trước đã

Đây là bước hay bị bỏ qua nhất. Đo nhiệt độ, độ mặn, pH của nước sắp đưa vào rồi so với nước trong ao.

- Chênh nhiệt độ nhiều thì chia thời gian đưa vào từ từ
- Chênh độ mặn nhiều thì giảm tỉ lệ thay xuống nữa
- pH khác nhiều thì kiểm tra cả độ kiềm

Không đo mà cứ đưa vào là thay nước trong khi không biết cái gì sẽ đổi.

■ Giới hạn ngày — độ mặn 5 ppt, nhiệt độ 3 ℃

Tôm thẻ sống được trong 5 đến 35 ppt, nhưng dịch quá 5 ppt trong một ngày là quá sức với con vừa lột.

Nhiệt độ cũng vậy — giữ biên độ trong ngày dưới 3 ℃.

Hãy lập kế hoạch thay nước quanh hai trần đó. Thay vì hỏi thay bao nhiêu phần trăm, hãy hỏi nước này sẽ làm độ mặn dịch bao nhiêu. Nghĩ như vậy thì bớt sai sót.

■ Xả ở đâu là chuyện khác nhau

Vị trí xả tùy theo bạn muốn đưa cái gì ra.

Sau mưa lớn thì xả tầng mặt. Nước mưa nhẹ nên nằm trên thành lớp nước ngọt, xả từ trên thì lớp đó ra trước.

Nếu bùn tích ở đáy thì xả đáy. Ao có cống giữa thì xả qua đó, kéo luôn cặn lắng ra.

Không xác định mục đích mà cứ xả thì chỉ mất nước cần còn vấn đề vẫn nằm nguyên.

■ Sau khi thay phải kiểm tra

Thay nước không chỉ đổi nước. Vi khuẩn và tảo trong nước cũng ra theo.

Nên vài ngày sau khi thay hãy kiểm tra nitrit. Vi khuẩn nitrat hóa bị loãng thì khả năng xử lý nitrit tạm thời giảm.

Xem cả màu nước. Tảo mất nhiều thì phần còn lại có thể sập và oxy tụt. Sáng hôm sau khi thay nước đừng bỏ buổi đo rạng sáng.

■ Có việc phải làm trước khi thay nước

Khi chỉ số lên, thứ tự là thế này. Giảm cho ăn, nâng oxy, rồi mới tính thay nước.

Giảm cho ăn là bớt nguyên nhân, thay nước là rửa kết quả. Cứ rửa mà để nguyên nguyên nhân thì vài hôm sau lại về chỗ cũ.

■ Ghi chép quan trọng hơn ngưỡng

Hãy ghi ngày thay, tỉ lệ đã thay, nhiệt độ - độ mặn - pH của cả nước mới lẫn nước ao, và chỉ số mấy ngày sau đó. Vài lần là biết ao mình phản ứng ra sao và mất mấy ngày để hồi.

Shrimp365 ghi chất lượng nước trước và sau khi thay cạnh nhau để bạn thấy ngay mức thay đổi. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/water-exchange/01.png$cn$, $cn$/cardnews/vi/water-exchange/02.png$cn$,
    $cn$/cardnews/vi/water-exchange/03.png$cn$, $cn$/cardnews/vi/water-exchange/04.png$cn$,
    $cn$/cardnews/vi/water-exchange/05.png$cn$, $cn$/cardnews/vi/water-exchange/06.png$cn$,
    $cn$/cardnews/vi/water-exchange/07.png$cn$, $cn$/cardnews/vi/water-exchange/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/water-exchange/01.png$cn$,
  array[
    $cn$thay nước$cn$, $cn$độ mặn$cn$, $cn$nhiệt độ nước$cn$, $cn$nitrit$cn$,
    $cn$chất lượng nước$cn$, $cn$quản lý ao$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-13 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$water-exchange$cn$,
  $cn$id$cn$,
  $cn$Ganti Air Tambak — Urutan Lebih Penting dari Jumlah$cn$,
  $cn$Begitu angkanya buruk, yang terpikir langsung ganti air. Dari situlah udang yang baru ganti kulit hilang. Berikut batas 30%, mengukur air baru lebih dulu, dan apa yang dicek sesudahnya.$cn$,
  $cn$Amonia naik. Nitrit naik. Warna airnya aneh. Yang pertama terpikir adalah ganti air. Tetapi ganti air adalah tindakan paling kuat sekaligus yang paling sering menimbulkan kecelakaan. Kehilangan udang saat mengejar angka terjadi persis di sini.

■ Jangan ganti lebih dari 30% sekaligus

Setiap kali ganti, jaga di bawah 30%. Melakukan 20 sampai 30% secara bertahap lebih aman.

Alasannya sederhana. Makin banyak air diganti, makin banyak suhu, salinitas, dan pH bergerak sekaligus, dan perubahan itu bisa lebih memukul udang daripada air yang buruk tadi. Terutama yang baru ganti kulit tidak sanggup menahannya.

■ Ukur air baru lebih dulu

Ini langkah yang paling sering dilewati. Ukur suhu, salinitas, dan pH air yang akan dimasukkan, lalu bandingkan dengan air tambak.

- Selisih suhu besar berarti memasukkannya perlahan, dibagi waktu
- Selisih salinitas besar berarti menurunkan lagi persentasenya
- pH yang jauh berbeda berarti alkalinitas juga perlu dicek

Memasukkan tanpa mengukur berarti mengganti air tanpa tahu apa yang akan berubah.

■ Batas harian — salinitas 5 ppt, suhu 3 ℃

Udang vaname hidup di 5 sampai 35 ppt, tetapi bergeser lebih dari 5 ppt dalam sehari melampaui kemampuan udang yang baru ganti kulit.

Suhu juga sama — jaga ayunan hariannya dalam 3 ℃.

Susun rencana ganti air di sekitar dua batas itu. Alih-alih bertanya berapa persen yang diganti, tanyakan air ini akan menggeser salinitas sejauh apa. Cara berpikir itu mencegah kebanyakan kesalahan.

■ Dari mana membuangnya itu berbeda

Letak pembuangan tergantung apa yang ingin Anda keluarkan.

Setelah hujan deras berarti permukaan. Air hujan ringan dan mengambang di atas sebagai lapisan tawar, jadi membuang dari atas mengeluarkan lapisan itu lebih dulu.

Kalau endapan menumpuk berarti dasar. Di tambak dengan pembuangan tengah, tarik dari sana dan bawa sedimennya sekalian.

Membuang tanpa menentukan tujuan hanya mengeluarkan air yang Anda butuhkan sementara masalahnya tetap tinggal.

■ Yang dicek sesudahnya

Ganti air bukan hanya mengganti air. Bakteri dan plankton ikut keluar bersamanya.

Jadi periksa nitrit selama beberapa hari sesudahnya. Bakteri nitrifikasi yang terencerkan membuat kemampuan mengolah nitrit turun sementara.

Perhatikan warnanya juga. Kehilangan plankton besar bisa membuat sisanya runtuh dan oksigen anjlok. Jangan lewatkan pengukuran subuh pada pagi setelah ganti air.

■ Ada yang harus didahulukan sebelum ganti air

Saat angka naik, urutannya begini. Kurangi pakan, naikkan oksigen, baru pertimbangkan ganti air.

Mengurangi pakan mengurangi penyebabnya; ganti air membilas akibatnya. Membilas tanpa menyingkirkan penyebab akan kembali ke titik yang sama beberapa hari kemudian.

■ Catatan lebih penting daripada angka batas

Catat tanggalnya, persentase yang diganti, suhu - salinitas - pH kedua airnya, dan angka pada hari-hari berikutnya. Setelah beberapa kali Anda akan tahu bagaimana tambak Anda bereaksi dan berapa hari pulihnya.

Shrimp365 mencatat kualitas air sebelum dan sesudah ganti air berdampingan sehingga besarnya perubahan langsung terlihat. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/water-exchange/01.png$cn$, $cn$/cardnews/id/water-exchange/02.png$cn$,
    $cn$/cardnews/id/water-exchange/03.png$cn$, $cn$/cardnews/id/water-exchange/04.png$cn$,
    $cn$/cardnews/id/water-exchange/05.png$cn$, $cn$/cardnews/id/water-exchange/06.png$cn$,
    $cn$/cardnews/id/water-exchange/07.png$cn$, $cn$/cardnews/id/water-exchange/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/water-exchange/01.png$cn$,
  array[
    $cn$ganti air$cn$, $cn$salinitas$cn$, $cn$suhu air$cn$, $cn$nitrit$cn$,
    $cn$kualitas air$cn$, $cn$manajemen tambak$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-13 09:00:00+09$cn$::timestamptz
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
