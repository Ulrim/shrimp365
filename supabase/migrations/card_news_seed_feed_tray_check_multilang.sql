-- ============================================================
-- 카드뉴스 — 먹이대 읽는 법 (en / vi / id) · 2026-08-15
--
-- 한국어판과 같은 slug("feed-tray-check")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/feed-tray-check/01..08.png
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
  $cn$feed-tray-check$cn$,
  $cn$en$cn$,
  $cn$Reading the Feed Tray — The Ration Is Decided Here, Not on the Table$cn$,
  $cn$The feeding table is only a starting point. What is left on the tray decides the actual ration. Here is the 4–5% to place, the 1–2 hour check, and how far to raise or cut.$cn$,
  $cn$You feed by the table and feed keeps being left behind. The table is not wrong — you are only looking at the table. The table is where you start. The actual ration for that day comes from the tray.

■ Why the table does not fit as it is

A feeding table is calculated from animal size and stocking number. But how much shrimp actually eat changes daily with water temperature, dissolved oxygen, the moult cycle and the weather.

The tray is the tool that closes the gap between the calculation and real intake. So this is not about discarding the table — you start with the table and adjust with the tray.

■ How much to place — 4 to 5% of the ration

You do not put the whole meal on the tray. Place about 4 to 5% and broadcast the rest as usual.

The tray is a measuring instrument, not a feeding method. Confuse the two and you end up putting too much on it, and then you cannot read the real intake.

Conditions differ from spot to spot within one pond, so do not use a single tray — spread several around.

■ Check after 1 to 2 hours

Lift the tray 1 to 2 hours after feeding. Too early and they are still eating; too late and the feed has swollen in the water, making it hard to judge.

If you feed 4 to 5 times a day, check on every round. Feed left in the morning and feed left in the evening mean different things.

■ If it is clean — raise by 2 to 5%

If the tray comes up empty, raise the next round by about 2 to 5%.

Do not jump up in one step. The point is to climb gradually and find the level at which feed starts being left. Just below that point is the right amount for the day.

■ If feed is left — cut the next round

Leftover feed does not only waste money. It settles, breaks down, consumes oxygen and drives ammonia up. That organic matter then piles on the bottom as food for sulfide and vibrio.

So leftovers are a cost and the raw material for the next accident. If feed is left, cut without hesitating.

■ Days to cut in advance

Some days you know before you look at the tray.

- Consecutive cloudy days — weak photosynthesis, short oxygen
- The moult period — they eat less or almost nothing. That is normal
- Water past 34 ℃ — they actually eat less
- Days with heavy rain — layers form and intake falls

Feed by the table on those days and it will be left. Cut in advance and confirm with the tray.

■ Not eating is the first sign of disease

If the tray keeps coming back with feed while weather and water quality are unchanged, look for another reason.

The first sign of AHPND is a drop in feed intake. The same goes for EHP. When vibrio builds, feed response falls first too. The tray record is a feed-adjustment tool and the fastest disease detector you have.

■ Records matter more than thresholds

Write down what you gave and what was left, every round. Within days the point where intake bends becomes visible. If that bend holds for three days or more, it is time to check water quality and the shrimp together.

Shrimp365 logs the ration and the leftovers per round and draws the intake trend. Free to use.$cn$,
  array[
    $cn$/cardnews/en/feed-tray-check/01.png$cn$, $cn$/cardnews/en/feed-tray-check/02.png$cn$,
    $cn$/cardnews/en/feed-tray-check/03.png$cn$, $cn$/cardnews/en/feed-tray-check/04.png$cn$,
    $cn$/cardnews/en/feed-tray-check/05.png$cn$, $cn$/cardnews/en/feed-tray-check/06.png$cn$,
    $cn$/cardnews/en/feed-tray-check/07.png$cn$, $cn$/cardnews/en/feed-tray-check/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/feed-tray-check/01.png$cn$,
  array[
    $cn$feed management$cn$, $cn$feeding$cn$, $cn$feed tray$cn$, $cn$disease management$cn$,
    $cn$pond management$cn$, $cn$water quality$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-15 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$feed-tray-check$cn$,
  $cn$vi$cn$,
  $cn$Đọc sàng ăn — Lượng cho ăn quyết định ở đây, không phải ở bảng$cn$,
  $cn$Bảng cho ăn chỉ là điểm xuất phát. Phần còn lại trên sàng mới quyết định lượng thật. Bài này nói về mức 4–5% bỏ vào sàng, thời điểm kiểm tra 1–2 giờ, và biên độ tăng giảm.$cn$,
  $cn$Cho ăn đúng theo bảng mà thức ăn cứ thừa. Không phải bảng sai, mà là chỉ nhìn mỗi bảng. Bảng là chỗ bắt đầu. Lượng cho ăn thật của hôm đó do sàng ăn cho biết.

■ Vì sao bảng không khớp nguyên vẹn

Bảng cho ăn được tính từ cỡ tôm và số lượng thả. Nhưng lượng tôm thật sự ăn thay đổi mỗi ngày theo nhiệt độ nước, oxy hòa tan, chu kỳ lột và thời tiết.

Sàng ăn là công cụ lấp khoảng cách giữa con số tính toán và lượng ăn thật. Nên không phải bỏ bảng đi, mà là bắt đầu từ bảng rồi điều chỉnh bằng sàng.

■ Bỏ vào bao nhiêu — 4 đến 5% của cữ

Không phải bỏ cả cữ vào sàng. Bỏ khoảng 4 đến 5% thôi, phần còn lại rải như thường lệ.

Sàng ăn là dụng cụ đo chứ không phải cách cho ăn. Lẫn hai thứ này thì sẽ bỏ vào sàng quá nhiều, và khi đó không đọc được tình trạng ăn thật.

Trong cùng một ao mỗi chỗ mỗi khác, nên đừng đặt một cái mà hãy chia ra nhiều điểm.

■ Kiểm tra sau 1 đến 2 giờ

Nhấc sàng lên sau khi cho ăn 1 đến 2 giờ. Sớm quá thì tôm còn đang ăn, muộn quá thì thức ăn nở trong nước nên khó đánh giá.

Nếu cho ăn 4 đến 5 cữ một ngày thì cữ nào cũng kiểm tra. Thừa buổi sáng và thừa buổi tối mang ý nghĩa khác nhau.

■ Nếu sạch trơn — tăng 2 đến 5%

Sàng nhấc lên mà trống trơn thì cữ sau tăng khoảng 2 đến 5%.

Đừng tăng vọt một lần. Mục đích là tăng dần để tìm ra mức bắt đầu có thừa. Ngay dưới mức đó chính là lượng phù hợp của ngày hôm ấy.

■ Nếu còn thừa — giảm cữ kế tiếp

Thức ăn thừa không chỉ phí tiền. Nó lắng xuống, phân hủy, tiêu oxy và làm tăng amoniac. Rồi chất hữu cơ đó tích ở đáy thành thức ăn cho khí H2S và vibrio.

Nghĩa là phần thừa vừa là chi phí vừa là nguyên liệu cho tai nạn kế tiếp. Thấy thừa thì giảm ngay, đừng do dự.

■ Những ngày phải giảm trước

Có những ngày chưa cần nhìn sàng cũng biết.

- Trời âm u nhiều ngày liền — quang hợp yếu, oxy thiếu
- Kỳ lột xác — tôm ăn ít hoặc gần như không ăn. Đó là bình thường
- Nước vượt 34 ℃ — tôm ăn ít hơn chứ không nhiều hơn
- Ngày mưa lớn — nước phân tầng và tôm bắt mồi kém

Những ngày đó mà cho ăn theo bảng thì chắc chắn thừa. Hãy giảm trước rồi kiểm tra bằng sàng.

■ Bỏ ăn là dấu hiệu đầu tiên của bệnh

Nếu sàng cứ còn thừa mà thời tiết và chất lượng nước không đổi thì phải tìm lý do khác.

Dấu hiệu đầu của AHPND là lượng ăn giảm. EHP cũng vậy. Vibrio tăng thì phản ứng bắt mồi cũng giảm trước tiên. Ghi chép sàng ăn vừa là công cụ chỉnh lượng cho ăn vừa là máy phát hiện bệnh nhanh nhất.

■ Ghi chép quan trọng hơn ngưỡng

Mỗi cữ hãy ghi lượng đã cho và lượng còn lại. Chỉ vài ngày là thấy được điểm mà lượng ăn bắt đầu gãy. Nếu chỗ gãy đó kéo dài từ ba ngày trở lên thì đã đến lúc kiểm tra cả chất lượng nước lẫn tình trạng tôm.

Shrimp365 ghi lượng cho ăn và phần thừa theo từng cữ rồi vẽ ra xu hướng bắt mồi. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/feed-tray-check/01.png$cn$, $cn$/cardnews/vi/feed-tray-check/02.png$cn$,
    $cn$/cardnews/vi/feed-tray-check/03.png$cn$, $cn$/cardnews/vi/feed-tray-check/04.png$cn$,
    $cn$/cardnews/vi/feed-tray-check/05.png$cn$, $cn$/cardnews/vi/feed-tray-check/06.png$cn$,
    $cn$/cardnews/vi/feed-tray-check/07.png$cn$, $cn$/cardnews/vi/feed-tray-check/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/feed-tray-check/01.png$cn$,
  array[
    $cn$quản lý thức ăn$cn$, $cn$cho ăn$cn$, $cn$sàng ăn$cn$, $cn$quản lý dịch bệnh$cn$,
    $cn$quản lý ao$cn$, $cn$chất lượng nước$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-15 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$feed-tray-check$cn$,
  $cn$id$cn$,
  $cn$Membaca Anco — Jatah Pakan Ditentukan di Sini, Bukan di Tabel$cn$,
  $cn$Tabel pakan hanyalah titik awal. Sisa di anco yang menentukan jatah sebenarnya. Berikut 4–5% yang ditaruh, pengecekan 1–2 jam, dan seberapa jauh menaikkan atau mengurangi.$cn$,
  $cn$Anda memberi pakan sesuai tabel tapi pakan terus bersisa. Tabelnya tidak salah — Anda hanya melihat tabelnya saja. Tabel adalah tempat memulai. Jatah sebenarnya hari itu datang dari anco.

■ Kenapa tabel tidak pas begitu saja

Tabel pakan dihitung dari ukuran udang dan jumlah tebar. Tetapi berapa banyak udang benar-benar makan berubah tiap hari mengikuti suhu air, oksigen terlarut, siklus ganti kulit, dan cuaca.

Anco adalah alat yang menutup jarak antara hitungan dan konsumsi nyata. Jadi ini bukan soal membuang tabel — Anda mulai dari tabel lalu menyesuaikan dengan anco.

■ Berapa yang ditaruh — 4 sampai 5% dari jatah

Bukan seluruh jatah ditaruh di anco. Taruh sekitar 4 sampai 5% dan sebar sisanya seperti biasa.

Anco adalah alat ukur, bukan cara memberi pakan. Kalau keduanya tertukar, Anda akan menaruh terlalu banyak dan konsumsi sebenarnya jadi tak terbaca.

Kondisinya berbeda dari titik ke titik dalam satu tambak, jadi jangan hanya satu anco — sebar beberapa.

■ Cek setelah 1 sampai 2 jam

Angkat anco 1 sampai 2 jam setelah pemberian. Terlalu cepat, udang masih makan; terlalu lambat, pakan mengembang di air sehingga sulit dinilai.

Kalau memberi 4 sampai 5 kali sehari, periksa tiap kali. Sisa di pagi hari dan sisa di sore hari berarti hal yang berbeda.

■ Kalau bersih — naikkan 2 sampai 5%

Kalau anco terangkat dalam keadaan kosong, naikkan pemberian berikutnya sekitar 2 sampai 5%.

Jangan melonjak sekaligus. Tujuannya menaikkan perlahan untuk menemukan titik ketika pakan mulai bersisa. Tepat di bawah titik itulah jumlah yang pas untuk hari tersebut.

■ Kalau bersisa — kurangi jatah berikutnya

Pakan sisa bukan hanya membuang uang. Ia mengendap, terurai, menghabiskan oksigen, dan menaikkan amonia. Bahan organik itu lalu menumpuk di dasar sebagai makanan bagi sulfida dan vibrio.

Jadi sisa pakan adalah biaya sekaligus bahan baku untuk kecelakaan berikutnya. Kalau bersisa, kurangi tanpa ragu.

■ Hari-hari yang harus dikurangi lebih dulu

Ada hari yang sudah bisa diketahui sebelum melihat anco.

- Mendung beberapa hari berturut-turut — fotosintesis lemah, oksigen kurang
- Masa ganti kulit — makan sedikit atau hampir tidak makan. Itu normal
- Air melewati 34 ℃ — justru makan lebih sedikit
- Hari hujan deras — lapisan terbentuk dan nafsu makan turun

Pada hari-hari itu, memberi sesuai tabel pasti bersisa. Kurangi lebih dulu lalu pastikan dengan anco.

■ Tidak makan adalah tanda pertama penyakit

Kalau anco terus bersisa sementara cuaca dan kualitas air tidak berubah, carilah alasan lain.

Tanda pertama AHPND adalah turunnya konsumsi pakan. EHP juga sama. Saat vibrio bertambah, respons makan pun turun lebih dulu. Catatan anco adalah alat pengatur pakan sekaligus pendeteksi penyakit tercepat yang Anda punya.

■ Catatan lebih penting daripada angka batas

Catat berapa yang diberi dan berapa yang bersisa, tiap pemberian. Dalam hitungan hari titik belok konsumsi akan terlihat. Kalau belokan itu bertahan tiga hari atau lebih, saatnya memeriksa kualitas air dan kondisi udang bersamaan.

Shrimp365 mencatat jatah dan sisanya per pemberian lalu menggambar tren konsumsinya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/feed-tray-check/01.png$cn$, $cn$/cardnews/id/feed-tray-check/02.png$cn$,
    $cn$/cardnews/id/feed-tray-check/03.png$cn$, $cn$/cardnews/id/feed-tray-check/04.png$cn$,
    $cn$/cardnews/id/feed-tray-check/05.png$cn$, $cn$/cardnews/id/feed-tray-check/06.png$cn$,
    $cn$/cardnews/id/feed-tray-check/07.png$cn$, $cn$/cardnews/id/feed-tray-check/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/feed-tray-check/01.png$cn$,
  array[
    $cn$manajemen pakan$cn$, $cn$pemberian pakan$cn$, $cn$anco$cn$, $cn$manajemen penyakit$cn$,
    $cn$manajemen tambak$cn$, $cn$kualitas air$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-15 09:00:00+09$cn$::timestamptz
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
