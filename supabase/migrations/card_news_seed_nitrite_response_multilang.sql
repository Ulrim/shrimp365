-- ============================================================
-- 카드뉴스 — 아질산 대응 (en / vi / id) · 2026-08-05
--
-- 한국어판과 같은 slug("nitrite-response")를 쓰고 locale만 다르게 넣는다.
-- 그래야 hreflangMap()이 언어 간 링크를 만든다. 수치는 네 언어가 동일하다.
--
-- 이미지: public/cardnews/<locale>/nitrite-response/01..08.png
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
--            한국어판과는 독립적으로 실행 가능하다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
--              published_at·조회수·좋아요는 건드리지 않는다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values

-- ── English ────────────────────────────────────────────────
(
  $cn$nitrite-response$cn$,
  $cn$en$cn$,
  $cn$Nitrite in Shrimp Ponds — After Ammonia Comes Nitrite$cn$,
  $cn$Shrimp start dying again a few days after ammonia comes down. Usually it is nitrite. Here is the 1 mg/L target, how salinity changes the risk, and the order to work through when it rises.$cn$,
  $cn$Ammonia comes down, you breathe out, and a few days later shrimp start dying again. The aerators are running, dissolved oxygen reads 6 mg/L, and yet the shrimp come up to the surface. This is when you check nitrite.

■ Nitrite forms where ammonia passed through

Nitrogen breaks down in two steps. Ammonia becomes nitrite, then nitrite becomes nitrate. Different bacteria run each step, and the second group settles in later than the first.

So a window opens a few days after ammonia falls, where nitrite climbs. That is the normal sequence. The mistake is stopping your measurements because ammonia looked solved — the second accident happens in that gap.

■ Why it kills — oxygen is there, they cannot use it

Nitrite interferes with oxygen transport in shrimp blood. However much oxygen is in the water, it does not move through the body.

That is why shrimp show oxygen-starvation behaviour at normal dissolved oxygen readings when nitrite is high. If your aerators are at full and shrimp still come to the surface, do not add more air — measure nitrite.

■ The target — under 1 mg/L

For white shrimp, keep nitrite below 1 mg/L.

The safety margin narrows sharply with salinity. In low-salinity ponds, damage is reported at far lower concentrations. If you run around 5 ppt, hold yourself to a stricter number.

■ When it rises

Newly started ponds, because the nitrifiers are not established yet. Right after disinfection, because you killed the useful bacteria along with the pathogens. Late in the cycle, as feed and waste raise the nitrogen load. And, as described above, a few days after an ammonia event.

■ When it rises — in this order

First, cut the feed. Less nitrogen going in is what brings the number down. It is the fastest and surest move.

Second, hold oxygen higher than usual. Nitrite is blocking oxygen inside the animal, so the water needs more of it. Watch the pre-dawn reading in particular.

Third, consider a water change. Do not swap more than 30 percent at once — do 20 to 30 percent in stages, and measure the incoming water's temperature, salinity and pH against the pond first.

Fourth, probiotics are prevention, not emergency medicine. Nitrifiers take days to weeks to establish. Nothing you add today lowers today's reading.

■ Records matter more than thresholds

For a week after ammonia falls, check nitrite every day. With that record, the next cycle tells you roughly when nitrite will climb. Losses look sudden, but on ponds that keep records there is almost always a warning first.

Shrimp365 logs ammonia and nitrite together so you can see the second accident coming. Free to use.$cn$,
  array[
    $cn$/cardnews/en/nitrite-response/01.png$cn$, $cn$/cardnews/en/nitrite-response/02.png$cn$,
    $cn$/cardnews/en/nitrite-response/03.png$cn$, $cn$/cardnews/en/nitrite-response/04.png$cn$,
    $cn$/cardnews/en/nitrite-response/05.png$cn$, $cn$/cardnews/en/nitrite-response/06.png$cn$,
    $cn$/cardnews/en/nitrite-response/07.png$cn$, $cn$/cardnews/en/nitrite-response/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/nitrite-response/01.png$cn$,
  array[
    $cn$nitrite$cn$, $cn$ammonia$cn$, $cn$water quality$cn$, $cn$salinity$cn$,
    $cn$white shrimp$cn$, $cn$dissolved oxygen$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-05 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$nitrite-response$cn$,
  $cn$vi$cn$,
  $cn$Xử lý nitrit trong ao tôm — Sau amoniac là nitrit$cn$,
  $cn$Amoniac vừa hạ được vài ngày thì tôm lại chết. Phần lớn là do nitrit. Bài này nói về ngưỡng 1 mg/L, mức nguy thay đổi theo độ mặn và thứ tự xử lý khi nitrit tăng.$cn$,
  $cn$Amoniac hạ xuống, vừa thở phào thì mấy hôm sau tôm lại chết. Quạt vẫn chạy, oxy hòa tan đo được 6 mg/L, vậy mà tôm cứ nổi lên mặt nước. Lúc này phải kiểm tra nitrit.

■ Nitrit sinh ra ngay chỗ amoniac vừa đi qua

Đạm phân hủy qua hai bước. Amoniac thành nitrit trước, rồi nitrit mới thành nitrat. Mỗi bước do một nhóm vi khuẩn khác nhau đảm nhiệm, và nhóm thứ hai ổn định muộn hơn.

Vì vậy sau khi amoniac hạ vài ngày sẽ có một giai đoạn nitrit tăng lên. Bản thân điều đó là bình thường. Sai lầm là thấy amoniac ổn rồi thì ngừng đo — tai nạn thứ hai xảy ra đúng vào khoảng trống đó.

■ Vì sao nguy — có oxy mà tôm không dùng được

Nitrit cản trở việc vận chuyển oxy trong máu tôm. Nước có bao nhiêu oxy đi nữa thì oxy đó cũng không đi được trong cơ thể.

Nên khi nitrit cao, dù chỉ số oxy hòa tan bình thường tôm vẫn có biểu hiện thiếu oxy. Quạt đã chạy hết công suất mà tôm còn nổi lên mặt, thì đừng thêm khí — hãy đo nitrit.

■ Ngưỡng — dưới 1 mg/L

Với tôm thẻ chân trắng, giữ nitrit dưới 1 mg/L.

Nhưng biên an toàn thay đổi rất nhiều theo độ mặn. Ở ao nuôi độ mặn thấp, thiệt hại được ghi nhận ở nồng độ thấp hơn nhiều. Nếu nuôi quanh mức 5 ppt thì phải tự đặt ngưỡng chặt hơn.

■ Khi nào nitrit tăng

Ao mới bắt đầu, vì vi khuẩn nitrat hóa chưa kịp ổn định. Ngay sau khi sát trùng, vì đã diệt luôn cả vi khuẩn có ích. Giai đoạn cuối vụ, khi thức ăn và chất thải làm tải đạm tăng lên. Và như đã nói ở trên, vài ngày sau một đợt amoniac.

■ Khi tăng — làm theo thứ tự

Bước một, giảm cho ăn. Ít đạm vào thì chỉ số mới hạ. Đây là việc nhanh và chắc chắn nhất.

Bước hai, giữ oxy cao hơn thường lệ. Nitrit đang chặn oxy bên trong cơ thể tôm, nên oxy trong nước phải dư dả hơn. Đặc biệt để ý số đo lúc rạng sáng.

Bước ba, tính đến thay nước. Đừng thay quá 30% một lần, hãy chia 20~30% nhiều đợt. Nhớ đo nhiệt độ, độ mặn, pH của nước mới rồi so với nước ao trước đã.

Bước bốn, men vi sinh là phòng chứ không phải thuốc cấp cứu. Vi khuẩn nitrat hóa cần vài ngày đến vài tuần mới ổn định. Không có thứ gì đổ hôm nay mà hạ được chỉ số hôm nay.

■ Ghi chép quan trọng hơn ngưỡng

Suốt một tuần sau khi amoniac hạ, hãy đo nitrit mỗi ngày. Có ghi chép đó thì vụ sau bạn biết trước khoảng khi nào nitrit sẽ lên. Tôm chết trông như đột ngột, nhưng ở ao có ghi chép thì hầu như luôn có báo trước.

Shrimp365 ghi amoniac và nitrit cùng lúc để bạn thấy trước tai nạn thứ hai. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/nitrite-response/01.png$cn$, $cn$/cardnews/vi/nitrite-response/02.png$cn$,
    $cn$/cardnews/vi/nitrite-response/03.png$cn$, $cn$/cardnews/vi/nitrite-response/04.png$cn$,
    $cn$/cardnews/vi/nitrite-response/05.png$cn$, $cn$/cardnews/vi/nitrite-response/06.png$cn$,
    $cn$/cardnews/vi/nitrite-response/07.png$cn$, $cn$/cardnews/vi/nitrite-response/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/nitrite-response/01.png$cn$,
  array[
    $cn$nitrit$cn$, $cn$amoniac$cn$, $cn$chất lượng nước$cn$, $cn$độ mặn$cn$,
    $cn$tôm thẻ chân trắng$cn$, $cn$oxy hòa tan$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-05 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$nitrite-response$cn$,
  $cn$id$cn$,
  $cn$Menangani Nitrit di Tambak — Setelah Amonia Giliran Nitrit$cn$,
  $cn$Beberapa hari setelah amonia turun, udang mati lagi. Umumnya karena nitrit. Berikut batas 1 mg/L, bagaimana salinitas mengubah risikonya, dan urutan penanganan saat angkanya naik.$cn$,
  $cn$Amonia sudah turun, baru saja lega, beberapa hari kemudian udang mulai mati lagi. Kincir berjalan, oksigen terlarut terbaca 6 mg/L, tetapi udang tetap naik ke permukaan. Saat itulah nitrit harus diperiksa.

■ Nitrit muncul di jalur yang baru dilewati amonia

Nitrogen terurai dalam dua tahap. Amonia menjadi nitrit dulu, lalu nitrit menjadi nitrat. Bakteri yang menangani tiap tahap berbeda, dan kelompok kedua mapan lebih lambat.

Karena itu beberapa hari setelah amonia turun muncul periode nitrit naik. Itu sendiri normal. Kesalahannya adalah berhenti mengukur karena merasa amonia sudah beres — kecelakaan kedua terjadi tepat di celah itu.

■ Kenapa berbahaya — oksigen ada tapi tak terpakai

Nitrit mengganggu pengangkutan oksigen di darah udang. Sebanyak apa pun oksigen di air, oksigen itu tidak beredar di dalam tubuh.

Jadi saat nitrit tinggi, walau angka oksigen terlarut normal, udang tetap menunjukkan gejala kekurangan oksigen. Kalau kincir sudah maksimal dan udang masih naik ke permukaan, jangan menambah aerasi — ukur nitritnya.

■ Batas aman — di bawah 1 mg/L

Untuk udang vaname, jaga nitrit di bawah 1 mg/L.

Namun margin amannya sangat bergantung pada salinitas. Di tambak bersalinitas rendah, kerugian dilaporkan pada konsentrasi yang jauh lebih rendah. Kalau Anda memelihara di sekitar 5 ppt, pakailah batas yang lebih ketat.

■ Kapan nitrit naik

Di tambak yang baru mulai, karena bakteri nitrifikasi belum mapan. Tepat setelah desinfeksi, karena bakteri berguna ikut mati. Di fase akhir siklus, saat pakan dan kotoran menaikkan beban nitrogen. Dan seperti disebut di atas, beberapa hari setelah kejadian amonia.

■ Saat naik — kerjakan berurutan

Langkah satu, kurangi pakan. Nitrogen yang masuk harus berkurang dulu agar angkanya turun. Ini langkah tercepat dan paling pasti.

Langkah dua, jaga oksigen lebih tinggi dari biasanya. Nitrit sedang menghambat oksigen di dalam tubuh, jadi oksigen di air harus lebih berlimpah. Perhatikan terutama angka menjelang subuh.

Langkah tiga, pertimbangkan ganti air. Jangan mengganti lebih dari 30 persen sekaligus — lakukan bertahap 20 sampai 30 persen. Ukur dulu suhu, salinitas, dan pH air baru lalu bandingkan dengan air tambak.

Langkah empat, probiotik itu pencegahan, bukan obat darurat. Bakteri nitrifikasi perlu beberapa hari sampai beberapa minggu untuk mapan. Tidak ada yang ditebar hari ini lalu menurunkan angka hari ini juga.

■ Catatan lebih penting daripada angka batas

Selama seminggu setelah amonia turun, periksa nitrit setiap hari. Dengan catatan itu, siklus berikutnya Anda sudah tahu kira-kira kapan nitrit akan naik. Kematian tampak mendadak, tetapi di tambak yang punya catatan hampir selalu ada peringatan lebih dulu.

Shrimp365 mencatat amonia dan nitrit bersama supaya Anda melihat kecelakaan kedua sebelum terjadi. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/nitrite-response/01.png$cn$, $cn$/cardnews/id/nitrite-response/02.png$cn$,
    $cn$/cardnews/id/nitrite-response/03.png$cn$, $cn$/cardnews/id/nitrite-response/04.png$cn$,
    $cn$/cardnews/id/nitrite-response/05.png$cn$, $cn$/cardnews/id/nitrite-response/06.png$cn$,
    $cn$/cardnews/id/nitrite-response/07.png$cn$, $cn$/cardnews/id/nitrite-response/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/nitrite-response/01.png$cn$,
  array[
    $cn$nitrit$cn$, $cn$amonia$cn$, $cn$kualitas air$cn$, $cn$salinitas$cn$,
    $cn$udang vaname$cn$, $cn$oksigen terlarut$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-05 09:00:00+09$cn$::timestamptz
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
