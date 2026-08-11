-- ============================================================
-- 카드뉴스 — 수차 배치와 용량 (en / vi / id) · 2026-08-14
--
-- 한국어판과 같은 slug("aeration-layout")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/aeration-layout/01..08.png
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
  $cn$aeration-layout$cn$,
  $cn$en$cn$,
  $cn$Aerator Layout and Capacity — Placement Comes First$cn$,
  $cn$If you added aerators and the dawn oxygen did not move, it is a layout problem. The water has to turn one way for the bottom to mix. Here is the intensive-culture capacity, the placement rules and the run times.$cn$,
  $cn$You added two more aerators and the pre-dawn dissolved oxygen is unchanged. Often that is not a shortage of capacity but a placement problem. An aerator both adds oxygen and moves water, and if you miss the second part, adding units will not raise the reading.

■ Capacity — 16 to 24 HP per hectare for intensive culture

For intensive culture, take 16 to 24 HP per hectare as the reference. It varies with stocking density and animal size, so treat it as a starting point rather than a fixed value.

What matters is that this figure describes the late stage. As shrimp grow, total biomass rises and so does oxygen demand. Capacity that was ample early running short late is normal, which is exactly why you keep watching the dawn number.

■ Placement — make the water turn one way

This is the most important rule. Position the aerators so the whole body of water forms a single rotating flow.

Two things follow. First, sludge on the bottom collects in the centre — and if the drain is central you can pull it straight out. Second, surface and bottom mix, so stratification does not set in.

When aerators face different directions the currents collide and die. Oxygen goes in, but the water does not turn.

■ Spacing — off the dyke, far apart

Set too close to the dyke and the current hits the wall, breaking the flow and eroding the bank.

Keep the aerators well apart from each other too. Placed close together, the unit behind interferes with the flow the unit in front just made. The same number of units spread out builds the rotation better.

■ Run time — from sundown past sunrise

Oxygen is only consumed overnight, bottoming out between 4 and 6 in the morning.

So aerators are not switched on after oxygen drops — they run through the window in which it will drop. Keep them going from sundown until after the sun is up.

The target is 5 mg/L or more before dawn. If you cannot hold that, revisit the number of units or the layout.

■ In summer, at midday too

Summer needs them during the day as well, because the temperature gap between surface and bottom grows at midday and the water separates into layers.

Once stratification sets in, the bottom layer stops mixing and its oxygen is consumed — and the bottom is where the shrimp are. Run the aerators to break the layer and lift the bottom water.

■ Inspection is management too

A cracked paddle or a worn bearing means the same electricity does less work. From the outside it still looks like it is running, which is why it goes unnoticed.

Check paddle condition and rotation speed regularly. And decide in advance what you will do about backup power. A summer night blackout can cost you a whole pond in a few hours.

■ Records matter more than thresholds

Write the pre-dawn dissolved oxygen down at the same time every day. Whether adding units or changing the layout actually raised the value can only be known from that record. Instinct will not tell you.

Shrimp365 logs pre-dawn dissolved oxygen per tank and alerts you the moment it falls below the line. Free to use.$cn$,
  array[
    $cn$/cardnews/en/aeration-layout/01.png$cn$, $cn$/cardnews/en/aeration-layout/02.png$cn$,
    $cn$/cardnews/en/aeration-layout/03.png$cn$, $cn$/cardnews/en/aeration-layout/04.png$cn$,
    $cn$/cardnews/en/aeration-layout/05.png$cn$, $cn$/cardnews/en/aeration-layout/06.png$cn$,
    $cn$/cardnews/en/aeration-layout/07.png$cn$, $cn$/cardnews/en/aeration-layout/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/aeration-layout/01.png$cn$,
  array[
    $cn$aerators$cn$, $cn$dissolved oxygen$cn$, $cn$dawn mortality$cn$, $cn$pond management$cn$,
    $cn$water quality$cn$, $cn$summer management$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-14 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$aeration-layout$cn$,
  $cn$vi$cn$,
  $cn$Bố trí và công suất quạt nước — Bố trí trước đã$cn$,
  $cn$Lắp thêm quạt mà oxy rạng sáng vẫn vậy thì là do bố trí. Nước phải chảy vòng một chiều thì đáy mới trộn được. Bài này nói về công suất cho nuôi thâm canh, nguyên tắc bố trí và giờ chạy.$cn$,
  $cn$Lắp thêm hai cái quạt mà oxy hòa tan lúc rạng sáng vẫn y nguyên. Thường không phải thiếu công suất mà là bố trí sai. Quạt vừa đưa oxy vào vừa làm nước chảy, bỏ sót vế thứ hai thì thêm bao nhiêu cái chỉ số cũng không lên.

■ Công suất — thâm canh 16 đến 24 HP mỗi ha

Với nuôi thâm canh, lấy 16 đến 24 HP mỗi ha làm mốc. Con số này đổi theo mật độ và cỡ tôm nên hãy coi là điểm xuất phát chứ không phải giá trị cố định.

Điều quan trọng là mốc đó mô tả giai đoạn cuối vụ. Tôm càng lớn thì tổng sinh khối càng nhiều và nhu cầu oxy càng cao. Công suất đầu vụ dư mà cuối vụ thiếu là bình thường, và đó chính là lý do phải theo dõi số đo rạng sáng liên tục.

■ Bố trí — cho nước chảy vòng một chiều

Đây là nguyên tắc quan trọng nhất. Đặt quạt sao cho cả khối nước tạo thành một dòng chảy vòng theo một chiều.

Có hai thứ đi kèm. Thứ nhất, cặn dưới đáy dồn vào giữa ao — nếu cống nằm ở giữa thì kéo ra được luôn. Thứ hai, tầng mặt và tầng đáy trộn với nhau nên không hình thành phân tầng.

Quạt quay các hướng khác nhau thì dòng chảy đụng nhau và triệt tiêu. Oxy có vào nhưng nước không chảy vòng.

■ Khoảng cách — cách bờ ra, cách xa nhau

Đặt sát bờ quá thì dòng nước đập vào bờ làm đứt dòng chảy và xói bờ.

Các quạt cũng phải cách nhau đủ xa. Đặt gần nhau thì cái sau phá dòng chảy mà cái trước vừa tạo ra. Cùng số lượng ấy mà trải rộng thì vòng chảy hình thành tốt hơn.

■ Giờ chạy — từ lúc mặt trời lặn đến sau khi mọc

Ban đêm oxy chỉ bị tiêu, thấp nhất vào khoảng 4 đến 6 giờ sáng.

Nên quạt không phải bật sau khi oxy đã tụt, mà chạy suốt khoảng thời gian nó sẽ tụt. Hãy chạy từ lúc mặt trời lặn cho tới sau khi mặt trời mọc.

Mục tiêu là oxy rạng sáng từ 5 mg/L trở lên. Không giữ được thì phải xem lại số lượng hoặc cách bố trí.

■ Mùa nóng thì giữa trưa cũng chạy

Mùa nóng ban ngày cũng cần, vì giữa trưa chênh lệch nhiệt độ giữa tầng mặt và tầng đáy lớn dần và nước tách thành lớp.

Khi phân tầng đã hình thành, tầng đáy không được trộn nên oxy cạn dần — mà tôm chủ yếu nằm ở đáy. Hãy chạy quạt để phá lớp và kéo nước đáy lên.

■ Kiểm tra cũng là quản lý

Cánh quạt nứt hay bạc đạn mòn thì cùng lượng điện mà làm được ít việc hơn. Nhìn bên ngoài vẫn thấy nó quay nên khó nhận ra.

Hãy kiểm tra định kỳ tình trạng cánh và tốc độ quay. Và tính trước sẽ làm gì khi mất điện. Một đêm mùa nóng mất điện có thể làm mất cả một ao chỉ trong vài giờ.

■ Ghi chép quan trọng hơn ngưỡng

Hãy ghi oxy hòa tan rạng sáng vào cùng một giờ mỗi ngày. Lắp thêm quạt hay đổi bố trí có thật sự làm chỉ số lên hay không, chỉ ghi chép đó mới cho biết. Cảm tính thì không thể phán đoán được.

Shrimp365 ghi oxy hòa tan rạng sáng theo từng ao và báo ngay khi tụt xuống dưới ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/aeration-layout/01.png$cn$, $cn$/cardnews/vi/aeration-layout/02.png$cn$,
    $cn$/cardnews/vi/aeration-layout/03.png$cn$, $cn$/cardnews/vi/aeration-layout/04.png$cn$,
    $cn$/cardnews/vi/aeration-layout/05.png$cn$, $cn$/cardnews/vi/aeration-layout/06.png$cn$,
    $cn$/cardnews/vi/aeration-layout/07.png$cn$, $cn$/cardnews/vi/aeration-layout/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/aeration-layout/01.png$cn$,
  array[
    $cn$quạt nước$cn$, $cn$oxy hòa tan$cn$, $cn$chết rạng sáng$cn$, $cn$quản lý ao$cn$,
    $cn$chất lượng nước$cn$, $cn$quản lý mùa nóng$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-14 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$aeration-layout$cn$,
  $cn$id$cn$,
  $cn$Tata Letak dan Kapasitas Kincir — Penempatan Lebih Dulu$cn$,
  $cn$Kalau kincir ditambah tapi oksigen subuh tidak bergerak, itu masalah tata letak. Air harus berputar satu arah agar dasarnya teraduk. Berikut kapasitas untuk budidaya intensif, aturan penempatan, dan jam operasi.$cn$,
  $cn$Anda menambah dua kincir dan oksigen terlarut menjelang subuh tidak berubah. Sering kali itu bukan kekurangan kapasitas melainkan masalah penempatan. Kincir memasukkan oksigen sekaligus menggerakkan air, dan kalau bagian kedua terlewat, menambah unit tidak akan menaikkan angkanya.

■ Kapasitas — 16 sampai 24 HP per hektar untuk intensif

Untuk budidaya intensif, ambil 16 sampai 24 HP per hektar sebagai acuan. Angka ini berubah menurut padat tebar dan ukuran udang, jadi anggap titik awal, bukan nilai tetap.

Yang penting, angka itu menggambarkan fase akhir. Saat udang membesar, total biomassa naik dan kebutuhan oksigen ikut naik. Kapasitas yang cukup di awal lalu kurang di akhir itu normal, dan justru karena itu angka subuh terus diperhatikan.

■ Penempatan — buat air berputar satu arah

Ini aturan paling penting. Tempatkan kincir sehingga seluruh badan air membentuk satu aliran berputar.

Dua hal mengikutinya. Pertama, endapan di dasar berkumpul di tengah — dan kalau pembuangannya di tengah, bisa langsung ditarik keluar. Kedua, permukaan dan dasar teraduk sehingga stratifikasi tidak terbentuk.

Kalau kincir menghadap arah berbeda-beda, arusnya bertabrakan dan saling mematikan. Oksigen masuk, tetapi airnya tidak berputar.

■ Jarak — jauh dari tanggul, berjauhan satu sama lain

Terlalu dekat tanggul membuat arus menghantam dinding, memutus aliran dan menggerus tanggulnya.

Jaga jarak antar kincir juga. Ditempatkan berdekatan, unit di belakang mengganggu aliran yang baru dibuat unit di depan. Jumlah unit yang sama tapi disebar membentuk putaran lebih baik.

■ Jam operasi — sejak matahari terbenam sampai lewat terbit

Semalaman oksigen hanya dikonsumsi, terendah antara pukul 4 dan 6 pagi.

Jadi kincir bukan dinyalakan setelah oksigen turun — ia berjalan sepanjang jendela waktu ketika oksigen akan turun. Jalankan sejak matahari terbenam sampai matahari sudah naik.

Targetnya oksigen subuh 5 mg/L atau lebih. Kalau tidak tercapai, tinjau ulang jumlah unit atau tata letaknya.

■ Di musim panas, tengah hari juga

Musim panas membutuhkannya di siang hari juga, karena tengah hari selisih suhu permukaan dan dasar membesar dan air terpisah menjadi lapisan.

Begitu stratifikasi terbentuk, lapisan dasar berhenti teraduk dan oksigennya habis — padahal di dasar itulah udang berada. Jalankan kincir untuk memecah lapisan dan mengangkat air dasar.

■ Pemeriksaan juga bagian dari pengelolaan

Kipas retak atau bantalan aus membuat listrik yang sama menghasilkan kerja lebih sedikit. Dari luar tetap terlihat berputar, karena itu sering tidak disadari.

Periksa kondisi kipas dan kecepatan putarannya secara berkala. Dan tentukan lebih dulu apa yang akan dilakukan soal cadangan listrik. Pemadaman di malam musim panas bisa menghabiskan satu petak dalam beberapa jam.

■ Catatan lebih penting daripada angka batas

Catat oksigen terlarut menjelang subuh pada jam yang sama setiap hari. Apakah menambah unit atau mengubah tata letak benar-benar menaikkan angkanya hanya bisa diketahui dari catatan itu. Firasat tidak akan memberi tahu.

Shrimp365 mencatat oksigen terlarut subuh per petak dan memberi tahu begitu turun di bawah batas. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/aeration-layout/01.png$cn$, $cn$/cardnews/id/aeration-layout/02.png$cn$,
    $cn$/cardnews/id/aeration-layout/03.png$cn$, $cn$/cardnews/id/aeration-layout/04.png$cn$,
    $cn$/cardnews/id/aeration-layout/05.png$cn$, $cn$/cardnews/id/aeration-layout/06.png$cn$,
    $cn$/cardnews/id/aeration-layout/07.png$cn$, $cn$/cardnews/id/aeration-layout/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/aeration-layout/01.png$cn$,
  array[
    $cn$kincir$cn$, $cn$oksigen terlarut$cn$, $cn$kematian subuh$cn$, $cn$manajemen tambak$cn$,
    $cn$kualitas air$cn$, $cn$manajemen musim panas$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-14 09:00:00+09$cn$::timestamptz
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
