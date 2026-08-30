-- ============================================================
-- 카드뉴스 — 고수온기 관리 (en / vi / id)
--
-- 한국어판과 같은 slug("high-temperature")를 쓰고 locale만 다르게 넣는다.
-- 그래야 hreflangMap()이 언어 간 링크를 만든다. 수치는 네 언어가 동일하다.
--
-- 이미지: public/cardnews/<locale>/high-temperature/01..08.png
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
  $cn$high-temperature$cn$,
  $cn$en$cn$,
  $cn$Managing White Shrimp Through Heat — Above 34 ℃ It Is a Different Pond$cn$,
  $cn$As water warms, the oxygen it can hold goes down while the oxygen your shrimp need goes up. Most summer losses start in that gap. Here is what changes above 34 ℃ and what to adjust.$cn$,
  $cn$In summer the same pond suddenly becomes hard to manage. A stocking density and feed rate that caused no trouble through spring start producing mortality in August. The pond has not changed — the amount of oxygen the water can hold has.

■ The shape of a summer kill — two curves separating

The amount of oxygen that dissolves in water falls as temperature rises. Shrimp, being poikilothermic, run a faster metabolism as the water warms, so their oxygen demand climbs.

Supply drops, demand rises. The distance between those two curves is the danger. That is why a pond that was comfortable at 5 mg/L in spring is running tight at the same reading in midsummer.

■ 34 ℃ — where survival replaces growth

White shrimp feed and grow best between 29 and 31 ℃. Above 32 ℃ growth efficiency starts to slip, and past 34 ℃ the goal of management changes entirely. From there the question is not how much you will grow, but how little you will lose.

Held near 33 ℃ for several days, the hepatopancreas takes real damage — hepatic tubules atrophy and, in severe cases, rupture. That organ handles both digestion and immunity, so once it is compromised almost any disease can follow. High temperature is not itself a disease; it opens the door for one.

■ Water depth — check this first

Deep water heats slowly. In a shallow pond the surface layer climbs fast under midday sun and the daily swing widens.

Hold at least 1.2–1.5 m through summer, and 1.8 m or more in mid-to-late grow-out. Adding depth costs less than adding aerators and the benefit lasts longer.

■ Aerators — run them at midday too

Many farms run aerators only at night. In summer you need them during the day, for two reasons.

First, at midday the temperature difference between surface and bottom grows and the water separates into layers. Once that stratification sets in, the bottom layer stops mixing and its oxygen is consumed with nothing replacing it — and the bottom is where the shrimp are.

Second, aerators do not only add oxygen, they mix. Turning the cooler bottom water into the hot surface water narrows the temperature spread across the whole pond.

■ Feed — what they leave becomes poison

Holding the feed rate steady through a heat spell is dangerous. When water gets too warm shrimp actually eat less. Feed at the usual rate and it will be left behind.

Uneaten feed settles, breaks down, consumes oxygen and drives ammonia up. In a period when oxygen is already tight you are spending more of it and adding a toxin at the same time. Check the feed trays, cut the ration based on what is left, and cut it further on any day dissolved oxygen drops below 5 mg/L.

■ Measure before dawn, log every day

Even in summer, oxygen bottoms out between 4 and 6 in the morning. A daytime reading tells you nothing about whether the pond will get through the night.

Do the same with temperature — track the high and the low, not a single reading. A daily swing beyond 3 ℃ is a burden by itself. If yesterday peaked at 33.2 ℃ and today at 33.8 ℃, you are still under 34 but the trend is unmistakable. Trouble is announced when that trend begins, not when the threshold is crossed.

Shrimp365 logs temperature and dissolved oxygen per tank and alerts you the moment a value leaves its range. It is free to use.$cn$,
  array[
    $cn$/cardnews/en/high-temperature/01.png$cn$, $cn$/cardnews/en/high-temperature/02.png$cn$,
    $cn$/cardnews/en/high-temperature/03.png$cn$, $cn$/cardnews/en/high-temperature/04.png$cn$,
    $cn$/cardnews/en/high-temperature/05.png$cn$, $cn$/cardnews/en/high-temperature/06.png$cn$,
    $cn$/cardnews/en/high-temperature/07.png$cn$, $cn$/cardnews/en/high-temperature/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/high-temperature/01.png$cn$,
  array[
    $cn$high temperature$cn$, $cn$water temperature$cn$, $cn$white shrimp$cn$, $cn$dissolved oxygen$cn$,
    $cn$water quality$cn$, $cn$feed management$cn$, $cn$summer management$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  now()
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$high-temperature$cn$,
  $cn$vi$cn$,
  $cn$Quản lý tôm thẻ mùa nắng nóng — Trên 34 ℃ là một cái ao khác$cn$,
  $cn$Nước càng nóng thì oxy hòa tan càng ít, trong khi nhu cầu oxy của tôm lại tăng. Phần lớn hao hụt mùa nóng bắt đầu từ khoảng cách đó. Bài này nói rõ trên 34 ℃ có gì thay đổi và cần điều chỉnh những gì.$cn$,
  $cn$Vào mùa nóng, vẫn cái ao đó mà quản lý bỗng khó hẳn. Mật độ nuôi và lượng cho ăn suốt mùa xuân không gây vấn đề gì, đến tháng 8 lại dẫn tới hao hụt. Không phải cái ao đã khác — mà là lượng oxy nước có thể chứa đã khác.

■ Cấu trúc của hao hụt mùa nóng — hai đường tách xa nhau

Lượng oxy hòa tan được trong nước giảm khi nhiệt độ tăng. Ngược lại, tôm là động vật biến nhiệt nên nước càng ấm thì trao đổi chất càng nhanh và nhu cầu oxy càng lớn.

Nguồn cung đi xuống, nhu cầu đi lên. Khoảng cách giữa hai đường đó chính là mức nguy hiểm của mùa nóng. Đó là lý do cái ao mùa xuân thoải mái ở 5 mg/L thì giữa hè cũng con số ấy lại thành sát nút.

■ 34 ℃ — khi sống sót thay chỗ cho tăng trưởng

Tôm thẻ chân trắng ăn khỏe và lớn tốt nhất trong khoảng 29–31 ℃. Vượt 32 ℃ thì hiệu quả tăng trưởng bắt đầu giảm, và qua 34 ℃ thì mục tiêu quản lý đổi hẳn. Từ đó câu hỏi không còn là nuôi được bao nhiêu, mà là mất ít nhất bao nhiêu.

Giữ quanh 33 ℃ trong nhiều ngày, gan tụy tổn thương thật sự — ống gan teo lại, nặng thì vỡ. Gan tụy đảm nhiệm cả tiêu hóa lẫn miễn dịch, nên khi nó hỏng thì hầu như bệnh nào cũng vào được. Nhiệt độ cao tự nó không phải bệnh, nhưng nó mở cửa cho bệnh.

■ Mực nước — thứ cần kiểm tra trước tiên

Nước sâu nóng lên chậm. Ao cạn thì tầng mặt bốc nhiệt rất nhanh dưới nắng trưa và biên độ dao động trong ngày cũng rộng ra.

Mùa nóng hãy giữ tối thiểu 1,2–1,5 m, giai đoạn giữa và cuối vụ thì 1,8 m trở lên. Tăng mực nước tốn ít hơn lắp thêm quạt mà hiệu quả lại bền hơn.

■ Quạt nước — giữa trưa cũng phải chạy

Nhiều nơi chỉ chạy quạt ban đêm. Mùa nóng thì ban ngày cũng cần, vì hai lý do.

Thứ nhất, giữa trưa chênh lệch nhiệt độ giữa tầng mặt và tầng đáy lớn dần, nước tách thành lớp. Khi phân tầng đã hình thành, tầng đáy không được trộn nên oxy cạn dần mà không có gì bù vào — trong khi tôm chủ yếu nằm ở đáy.

Thứ hai, quạt không chỉ đưa oxy vào mà còn trộn nước. Trộn nước đáy mát hơn với nước mặt nóng sẽ thu hẹp chênh lệch nhiệt độ của cả ao.

■ Thức ăn — phần dư thừa thành chất độc

Giữ nguyên lượng cho ăn trong đợt nắng nóng là nguy hiểm. Khi nước quá ấm, tôm thực ra ăn ít đi. Cho ăn như thường thì sẽ dư.

Thức ăn thừa lắng xuống đáy, phân hủy, tiêu hao oxy và làm tăng amoniac. Đúng lúc oxy đang sát nút thì lại tiêu thêm oxy và sinh thêm độc tố. Hãy kiểm tra sàng ăn, giảm khẩu phần dựa trên phần còn lại, và giảm mạnh hơn vào những ngày oxy hòa tan xuống dưới 5 mg/L.

■ Đo lúc rạng sáng, ghi chép mỗi ngày

Mùa nóng thì oxy vẫn thấp nhất vào khoảng 4–6 giờ sáng. Số đo ban ngày không cho biết ao có qua được đêm hay không.

Nhiệt độ cũng vậy — hãy theo dõi cả mức cao nhất và thấp nhất, đừng chỉ đo một lần. Biên độ trong ngày vượt 3 ℃ tự nó đã là gánh nặng. Hôm qua đỉnh 33,2 ℃, hôm nay 33,8 ℃ thì vẫn dưới 34 nhưng xu hướng đã rõ. Sự cố được báo trước từ lúc xu hướng bắt đầu, không phải lúc vượt ngưỡng.

Shrimp365 ghi nhiệt độ và oxy hòa tan theo từng ao, và báo ngay khi có chỉ số vượt ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/high-temperature/01.png$cn$, $cn$/cardnews/vi/high-temperature/02.png$cn$,
    $cn$/cardnews/vi/high-temperature/03.png$cn$, $cn$/cardnews/vi/high-temperature/04.png$cn$,
    $cn$/cardnews/vi/high-temperature/05.png$cn$, $cn$/cardnews/vi/high-temperature/06.png$cn$,
    $cn$/cardnews/vi/high-temperature/07.png$cn$, $cn$/cardnews/vi/high-temperature/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/high-temperature/01.png$cn$,
  array[
    $cn$nắng nóng$cn$, $cn$nhiệt độ nước$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$oxy hòa tan$cn$,
    $cn$chất lượng nước$cn$, $cn$quản lý thức ăn$cn$, $cn$quản lý mùa nóng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  now()
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$high-temperature$cn$,
  $cn$id$cn$,
  $cn$Mengelola Udang Vaname di Suhu Tinggi — Di Atas 34 ℃ Tambaknya Berbeda$cn$,
  $cn$Makin panas airnya, makin sedikit oksigen yang bisa larut, sementara kebutuhan oksigen udang justru naik. Sebagian besar kematian musim panas berawal dari selisih itu. Berikut apa yang berubah di atas 34 ℃ dan apa yang perlu disesuaikan.$cn$,
  $cn$Saat musim panas, tambak yang sama tiba-tiba jadi sulit dikelola. Padat tebar dan jumlah pakan yang sepanjang musim sebelumnya tidak bermasalah, di bulan panas justru berujung kematian. Bukan tambaknya yang berubah — melainkan jumlah oksigen yang sanggup ditampung airnya.

■ Struktur kematian musim panas — dua kurva yang menjauh

Jumlah oksigen yang bisa larut dalam air menurun seiring naiknya suhu. Sebaliknya, udang adalah hewan berdarah dingin, sehingga makin hangat airnya makin cepat metabolismenya dan makin besar kebutuhan oksigennya.

Pasokan turun, kebutuhan naik. Jarak antara dua kurva itulah bahayanya. Karena itu tambak yang nyaman di 5 mg/L saat musim sejuk terasa mepet di angka yang sama ketika puncak panas.

■ 34 ℃ — saat bertahan menggantikan tumbuh

Udang vaname makan dan tumbuh paling baik di 29–31 ℃. Di atas 32 ℃ efisiensi pertumbuhan mulai turun, dan lewat 34 ℃ tujuan pengelolaan berubah sama sekali. Sejak titik itu pertanyaannya bukan berapa banyak yang bisa dibesarkan, melainkan seberapa sedikit yang hilang.

Bertahan di sekitar 33 ℃ selama beberapa hari, hepatopankreas benar-benar rusak — tubulusnya menyusut dan pada kasus berat pecah. Organ itu menangani pencernaan sekaligus kekebalan, jadi begitu ia rusak hampir semua penyakit bisa masuk. Suhu tinggi sendiri bukan penyakit, tetapi ia membuka pintunya.

■ Kedalaman air — yang pertama dicek

Air yang dalam naik suhunya perlahan. Di tambak dangkal, lapisan permukaan cepat memanas di bawah terik siang dan ayunan hariannya melebar.

Jaga minimal 1,2–1,5 m selama musim panas, dan 1,8 m atau lebih pada fase tengah sampai akhir. Menambah kedalaman lebih murah daripada menambah kincir dan manfaatnya bertahan lebih lama.

■ Kincir — siang bolong pun tetap jalan

Banyak tambak hanya menjalankan kincir pada malam hari. Di musim panas siang hari pun perlu, karena dua hal.

Pertama, di siang hari selisih suhu antara permukaan dan dasar membesar dan air terpisah menjadi lapisan. Begitu stratifikasi terbentuk, lapisan dasar berhenti teraduk dan oksigennya habis tanpa ada penggantinya — padahal di dasar itulah udang berada.

Kedua, kincir bukan hanya memasukkan oksigen, tetapi juga mengaduk. Mencampur air dasar yang lebih sejuk dengan air permukaan yang panas mempersempit selisih suhu di seluruh tambak.

■ Pakan — sisanya berubah jadi racun

Mempertahankan jumlah pakan selama gelombang panas itu berbahaya. Ketika air terlalu hangat, udang justru makan lebih sedikit. Diberi seperti biasa, pasti bersisa.

Pakan yang tidak termakan mengendap, terurai, menghabiskan oksigen dan menaikkan amonia. Di masa ketika oksigen sudah mepet, Anda justru memakainya lebih banyak sekaligus menambah racun. Periksa anco, kurangi jatah berdasarkan sisanya, dan kurangi lebih jauh pada hari-hari ketika oksigen terlarut turun di bawah 5 mg/L.

■ Ukur menjelang subuh, catat setiap hari

Di musim panas pun oksigen berada di titik terendah antara pukul 4 dan 6 pagi. Angka yang diambil siang hari tidak memberi tahu apakah tambak akan melewati malam.

Perlakukan suhu dengan cara yang sama — pantau tertinggi dan terendahnya, bukan satu kali pengukuran. Ayunan harian di atas 3 ℃ sudah menjadi beban tersendiri. Kalau kemarin puncaknya 33,2 ℃ dan hari ini 33,8 ℃, Anda masih di bawah 34 tetapi arahnya jelas. Masalah sudah diumumkan sejak tren itu dimulai, bukan saat ambangnya terlampaui.

Shrimp365 mencatat suhu dan oksigen terlarut per petak, lalu memberi tahu Anda begitu sebuah nilai keluar dari rentangnya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/high-temperature/01.png$cn$, $cn$/cardnews/id/high-temperature/02.png$cn$,
    $cn$/cardnews/id/high-temperature/03.png$cn$, $cn$/cardnews/id/high-temperature/04.png$cn$,
    $cn$/cardnews/id/high-temperature/05.png$cn$, $cn$/cardnews/id/high-temperature/06.png$cn$,
    $cn$/cardnews/id/high-temperature/07.png$cn$, $cn$/cardnews/id/high-temperature/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/high-temperature/01.png$cn$,
  array[
    $cn$suhu tinggi$cn$, $cn$suhu air$cn$, $cn$udang vaname$cn$, $cn$oksigen terlarut$cn$,
    $cn$kualitas air$cn$, $cn$manajemen pakan$cn$, $cn$manajemen musim panas$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  now()
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
