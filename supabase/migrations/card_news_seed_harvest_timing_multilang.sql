-- ============================================================
-- 카드뉴스 — 출하 판단 (en / vi / id) · 2026-08-17
--
-- 한국어판과 같은 slug("harvest-timing")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/harvest-timing/01..08.png
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
  $cn$harvest-timing$cn$,
  $cn$en$cn$,
  $cn$Harvest Timing — When You Pull Decides the Margin$cn$,
  $cn$One more day of growing looks like a gain, but there is a stretch where it is not. Here is why to avoid the days right after a moult, how size spread cuts the price, and what to base the decision on.$cn$,
  $cn$Harvest is not the last step of a cycle — it is a decision in its own right. Growing one more day looks like more weight and more money, but feed cost, risk and price all move together, so a stretch appears where it is not.

■ Avoid the days right after a moult

Check this first. A freshly moulted shrimp has a soft shell. Hardening usually takes one to three days.

Harvest in that state and losses through grading and transport run high, and the product grades down. It weighs less as well.

A pond does not moult all at once, but there are periods when moulting clusters. Plenty of empty shells on the bottom and feed intake down for several days means you are in one. Waiting a few days is the better move.

■ Size spread cuts the price

At the same total weight, an even size earns more, because more animals fall inside a grade.

Keep growing with a wide spread and the large animals pass the grade while the small ones fall short of it. Total weight rises while the weight that earns does not.

Sample and look at the weight distribution. The average alone hides this.

■ Daily growth rate is the basis

This is the surest measure. Look at how many grams a day they have gained recently.

If the rate has bent, the weight added over the remaining period probably will not cover the feed cost, especially in the hot season. Water flirting with 34 ℃ lowers growth efficiency itself.

Growing on after growth has stopped is pouring feed money into the water. If something like EHP is behind the stall, more so.

■ The day before — stop feeding

Stop feeding the day before harvest. An empty gut holds freshness longer and keeps the water cleaner in transit.

Do not starve them too long, though. A day is enough.

■ Water quality just before

Check dissolved oxygen on the morning of the work. It should be 5 mg/L or more.

Put a net in while oxygen is low and the shrimp crowd, take stress and turn into transit losses. Grading and transport are demanding enough on their own, so the starting point has to be good.

Watch temperature too. Early morning or after sundown beats the middle of the day.

■ Look at the market alongside

The same size fetches different prices at different times. When harvests cluster, the price falls.

The technically optimal moment and the good-price moment are not always the same. If the growth rate is still alive you have a few days of room; if growth has stopped, waiting for a price only spends feed. Hold both in view.

■ Records make the decision

Sample regularly and write down the average weight. Put it beside the feed record and you can see how many grams each kilogram of feed is adding.

The point where that number starts getting worse is when to consider harvest. Decided by instinct it differs every time; decided by record it carries into the next cycle.

Shrimp365 logs average weight, feed rate and water quality per tank so the numbers you need for a harvest decision are already there. Free to use.$cn$,
  array[
    $cn$/cardnews/en/harvest-timing/01.png$cn$, $cn$/cardnews/en/harvest-timing/02.png$cn$,
    $cn$/cardnews/en/harvest-timing/03.png$cn$, $cn$/cardnews/en/harvest-timing/04.png$cn$,
    $cn$/cardnews/en/harvest-timing/05.png$cn$, $cn$/cardnews/en/harvest-timing/06.png$cn$,
    $cn$/cardnews/en/harvest-timing/07.png$cn$, $cn$/cardnews/en/harvest-timing/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/harvest-timing/01.png$cn$,
  array[
    $cn$harvest$cn$, $cn$growth rate$cn$, $cn$molting$cn$, $cn$feed management$cn$,
    $cn$dissolved oxygen$cn$, $cn$pond management$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-17 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$harvest-timing$cn$,
  $cn$vi$cn$,
  $cn$Thời điểm thu hoạch — Thu lúc nào quyết định lời lỗ$cn$,
  $cn$Nuôi thêm một ngày tưởng là lời, nhưng có giai đoạn không phải vậy. Bài này nói vì sao phải tránh mấy ngày ngay sau khi lột, chênh cỡ ăn mất giá thế nào, và căn cứ để quyết định.$cn$,
  $cn$Thu hoạch không phải bước cuối của vụ nuôi mà tự nó là một quyết định. Nuôi thêm một ngày thì tưởng là thêm trọng lượng thêm tiền, nhưng tiền cám, rủi ro và giá cả cùng dịch chuyển nên sẽ có giai đoạn không phải vậy.

■ Tránh mấy ngày ngay sau khi lột

Đây là thứ phải xem trước tiên. Tôm vừa lột thì vỏ còn mềm. Cứng lại thường mất một đến ba ngày.

Thu trong trạng thái đó thì hao hụt khi phân cỡ và vận chuyển rất lớn, chất lượng thương phẩm cũng kém. Trọng lượng cũng nhẹ hơn.

Cả ao không lột cùng lúc, nhưng có những đợt lột dồn. Đáy có nhiều vỏ rỗng và lượng ăn giảm mấy ngày liền thì đang ở đợt đó. Hoãn vài ngày sẽ tốt hơn.

■ Chênh cỡ ăn mất giá

Cùng một tổng trọng lượng, cỡ càng đều thì bán được giá hơn, vì càng nhiều con nằm đúng cỡ quy chuẩn.

Cứ nuôi tiếp trong tình trạng chênh cỡ thì con lớn vượt cỡ còn con nhỏ chưa tới cỡ. Tổng trọng lượng tăng mà phần trọng lượng bán được giá thì không.

Hãy vớt mẫu lên xem phân bố trọng lượng. Chỉ nhìn số bình quân thì không thấy được chuyện này.

■ Tốc độ lớn mỗi ngày là căn cứ

Đây là thước đo chắc chắn nhất. Hãy xem mấy ngày gần đây tôm lên được bao nhiêu gam mỗi ngày.

Nếu tốc độ đã gãy thì trọng lượng tăng thêm trong quãng còn lại nhiều khả năng không bù nổi tiền cám, nhất là mùa nóng. Nước chạm ngưỡng 34 ℃ thì bản thân hiệu quả tăng trưởng đã giảm.

Tôm đã ngừng lớn mà cứ nuôi tiếp là đổ tiền cám xuống nước. Nếu có thứ như EHP đứng sau thì càng vậy.

■ Hôm trước thu — ngừng cho ăn

Ngừng cho ăn từ một ngày trước khi thu. Ruột rỗng thì giữ độ tươi lâu hơn và nước trong lúc vận chuyển cũng đỡ bẩn.

Nhưng đừng bỏ đói quá lâu. Một ngày là đủ.

■ Chất lượng nước ngay trước khi thu

Sáng ngày làm việc hãy đo oxy hòa tan. Phải từ 5 mg/L trở lên.

Oxy thấp mà thả lưới xuống thì tôm dồn lại, bị sốc, và thành hao hụt trên đường vận chuyển. Phân cỡ và vận chuyển tự nó đã là việc nặng nên điểm xuất phát phải tốt.

Xem cả nhiệt độ. Sáng sớm hoặc sau khi mặt trời lặn tốt hơn giữa trưa.

■ Nhìn cả thị trường

Cùng một cỡ mà thời điểm khác nhau thì giá khác nhau. Khi thu hoạch dồn thì giá xuống.

Thời điểm tối ưu về kỹ thuật và thời điểm được giá không phải lúc nào cũng trùng nhau. Tốc độ lớn còn tốt thì có dư địa chỉnh vài ngày; đã ngừng lớn thì chờ giá chỉ tốn thêm tiền cám. Hãy đặt cả hai lên bàn cân.

■ Ghi chép tạo ra quyết định

Hãy định kỳ vớt mẫu và ghi trọng lượng bình quân. Đặt cạnh ghi chép lượng cho ăn thì thấy được 1 kg cám đang làm tăng bao nhiêu gam.

Chỗ mà con số đó bắt đầu xấu đi chính là lúc nên tính chuyện thu hoạch. Quyết theo cảm tính thì lần nào cũng khác, quyết theo ghi chép thì vụ sau còn dùng được.

Shrimp365 ghi trọng lượng bình quân, lượng cho ăn và chất lượng nước theo từng ao để những con số cần cho quyết định thu hoạch đã sẵn ở đó. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/harvest-timing/01.png$cn$, $cn$/cardnews/vi/harvest-timing/02.png$cn$,
    $cn$/cardnews/vi/harvest-timing/03.png$cn$, $cn$/cardnews/vi/harvest-timing/04.png$cn$,
    $cn$/cardnews/vi/harvest-timing/05.png$cn$, $cn$/cardnews/vi/harvest-timing/06.png$cn$,
    $cn$/cardnews/vi/harvest-timing/07.png$cn$, $cn$/cardnews/vi/harvest-timing/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/harvest-timing/01.png$cn$,
  array[
    $cn$thu hoạch$cn$, $cn$tốc độ lớn$cn$, $cn$lột xác$cn$, $cn$quản lý thức ăn$cn$,
    $cn$oxy hòa tan$cn$, $cn$quản lý ao$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-17 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$harvest-timing$cn$,
  $cn$id$cn$,
  $cn$Waktu Panen — Kapan Dipanen Menentukan Untungnya$cn$,
  $cn$Menumbuhkan sehari lagi terlihat menguntungkan, tetapi ada rentang di mana tidak begitu. Berikut alasan menghindari hari setelah ganti kulit, bagaimana selisih ukuran memotong harga, dan dasar keputusannya.$cn$,
  $cn$Panen bukan langkah terakhir sebuah siklus — ia sendiri adalah sebuah keputusan. Menumbuhkan sehari lagi terlihat menambah bobot dan uang, tetapi biaya pakan, risiko, dan harga bergerak bersamaan sehingga muncul rentang di mana itu tidak berlaku.

■ Hindari hari-hari tepat setelah ganti kulit

Periksa ini lebih dulu. Udang yang baru ganti kulit kulitnya masih lunak. Mengerasnya biasanya butuh satu sampai tiga hari.

Panen dalam keadaan itu membuat kerugian saat sortir dan pengangkutan menjadi besar, dan mutunya turun. Bobotnya pun lebih ringan.

Satu tambak tidak ganti kulit serentak, tetapi ada masa ketika ganti kulit menumpuk. Banyak kulit kosong di dasar dan konsumsi pakan turun beberapa hari berarti Anda sedang di masa itu. Menunda beberapa hari adalah pilihan yang lebih baik.

■ Selisih ukuran memotong harga

Pada bobot total yang sama, ukuran yang rata dihargai lebih tinggi karena lebih banyak yang masuk grade.

Terus dibesarkan dengan selisih lebar membuat yang besar melewati grade sementara yang kecil tidak mencapainya. Bobot total naik tetapi bobot yang menghasilkan uang tidak.

Ambil sampel dan lihat sebaran bobotnya. Rata-rata saja menyembunyikan hal ini.

■ Laju tumbuh harian adalah dasarnya

Ini ukuran yang paling pasti. Lihat berapa gram per hari yang bertambah belakangan ini.

Kalau lajunya sudah membelok, bobot yang bertambah selama sisa periode kemungkinan tidak menutup biaya pakan, apalagi di musim panas. Air yang menyentuh 34 ℃ menurunkan efisiensi pertumbuhannya sendiri.

Terus membesarkan setelah pertumbuhan berhenti sama dengan menuang uang pakan ke air. Kalau ada sesuatu seperti EHP di baliknya, lebih-lebih lagi.

■ Sehari sebelumnya — hentikan pakan

Hentikan pemberian pakan sehari sebelum panen. Usus yang kosong menjaga kesegaran lebih lama dan membuat air saat pengangkutan tidak cepat kotor.

Tapi jangan dipuasakan terlalu lama. Sehari sudah cukup.

■ Kualitas air tepat sebelum panen

Periksa oksigen terlarut pada pagi hari kerja panen. Harus 5 mg/L atau lebih.

Menurunkan jaring saat oksigen rendah membuat udang berdesakan, tertekan, dan berubah menjadi kerugian saat diangkut. Sortir dan pengangkutan sudah berat dengan sendirinya, jadi titik awalnya harus baik.

Perhatikan suhu juga. Pagi buta atau setelah matahari terbenam lebih baik daripada tengah hari.

■ Lihat pasarnya sekaligus

Ukuran yang sama berbeda harganya pada waktu berbeda. Ketika panen menumpuk, harganya turun.

Momen yang optimal secara teknis dan momen yang bagus harganya tidak selalu sama. Kalau laju tumbuh masih hidup, Anda punya ruang beberapa hari; kalau pertumbuhan berhenti, menunggu harga hanya menghabiskan pakan. Pegang keduanya sekaligus.

■ Catatan yang membuat keputusan

Ambil sampel secara berkala dan catat bobot rata-ratanya. Sandingkan dengan catatan pakan maka terlihat berapa gram yang ditambah setiap kilogram pakan.

Titik ketika angka itu mulai memburuk adalah saat mempertimbangkan panen. Diputuskan dengan firasat hasilnya berbeda tiap kali; diputuskan dengan catatan, ia terbawa ke siklus berikutnya.

Shrimp365 mencatat bobot rata-rata, jumlah pakan, dan kualitas air per petak sehingga angka yang dibutuhkan untuk keputusan panen sudah tersedia. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/harvest-timing/01.png$cn$, $cn$/cardnews/id/harvest-timing/02.png$cn$,
    $cn$/cardnews/id/harvest-timing/03.png$cn$, $cn$/cardnews/id/harvest-timing/04.png$cn$,
    $cn$/cardnews/id/harvest-timing/05.png$cn$, $cn$/cardnews/id/harvest-timing/06.png$cn$,
    $cn$/cardnews/id/harvest-timing/07.png$cn$, $cn$/cardnews/id/harvest-timing/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/harvest-timing/01.png$cn$,
  array[
    $cn$panen$cn$, $cn$laju pertumbuhan$cn$, $cn$ganti kulit$cn$, $cn$manajemen pakan$cn$,
    $cn$oksigen terlarut$cn$, $cn$manajemen tambak$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-17 09:00:00+09$cn$::timestamptz
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
