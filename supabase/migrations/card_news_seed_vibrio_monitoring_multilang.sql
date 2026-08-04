-- ============================================================
-- 카드뉴스 — 비브리오 관리 (en / vi / id) · 2026-08-09
--
-- 한국어판과 같은 slug("vibrio-monitoring")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/vibrio-monitoring/01..08.png
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
  $cn$vibrio-monitoring$cn$,
  $cn$en$cn$,
  $cn$Vibrio Control — When the Water Glows at Night$cn$,
  $cn$Vibrio is not a bacterium you eliminate; it is one you count. Here is the 10³ CFU/mL threshold, what green colonies mean, and what the glow is telling you.$cn$,
  $cn$If you have walked out at night and seen the water glowing faintly blue, that is luminescent vibrio. It also means the population is already well up.

■ Not a bacterium you remove, one you count

Vibrio is native to seawater. You cannot eliminate it from a pond, and elimination is not the goal.

The issue is numbers. At low counts nothing happens; when conditions line up and they multiply fast, it becomes disease. So vibrio is judged by how many, not by present or absent.

■ The threshold — 10³ CFU/mL

Judge by total vibrio count per millilitre of water.

Below 10² CFU/mL is the safe zone. Between 10² and 10³ is the warning zone, where you should start acting. Above 10³ is the danger zone and infection risk climbs clearly.

Measurement means culturing water on TCBS agar and counting colonies. Regional fisheries institutes and feed company technical teams often provide this, so it is worth asking.

■ Green colonies are the worse kind

On TCBS agar, vibrio grows as yellow or green colonies. The colour splits on the ability to ferment sugar, and in practice the colour is used to grade risk.

Green colonies are the more dangerous side. So at the same total count, a higher share of green is the worse situation. When you get results back, do not read only the total — check the colour breakdown too.

■ The glow is an organic matter signal

Glowing water means luminescent vibrio has increased, and their increase means there is plenty to eat. The organic matter piled on the bottom is that food.

So the first thing to look at after seeing a glow is not a treatment but the bottom and the feed rate. Check whether uneaten feed is being left and whether sludge is accumulating. Attack the bacteria while leaving the cause and they are back in days.

■ Summer speeds them up

Vibrio multiplies faster as water warms. That is why vibrio-related accidents cluster in the hot season.

The shrimp side worsens at the same time. Water flirting with 34 ℃ already burdens them, and several days near 33 ℃ damages the hepatopancreas. The bacteria multiply fast exactly when the shrimp's defences weaken.

■ Common findings

Feed response drops, shells go soft, and more animals look reddish. Rather than mortality spiking overnight, it more often creeps up over several days.

Feed intake records make the call much faster here. If intake had been falling for a few days, that is your starting point.

■ Prevention is the environment

Dirty the bottom less, leave no feed behind, hold oxygen, and reduce temperature swings. What we call vibrio control comes down to those four.

It does not sound like a special measure, but this is the side that actually lowers the count. Disinfection cuts numbers at that moment without changing the conditions.

■ Records matter more than thresholds

If weekly testing is hard, at least log feed intake, temperature and bottom condition daily. The conditions that let vibrio grow show up in that record first. The lab result confirms what the record already said.

Shrimp365 logs temperature, feed rate and mortality together so you can see the conditions for disease before it arrives. Free to use.$cn$,
  array[
    $cn$/cardnews/en/vibrio-monitoring/01.png$cn$, $cn$/cardnews/en/vibrio-monitoring/02.png$cn$,
    $cn$/cardnews/en/vibrio-monitoring/03.png$cn$, $cn$/cardnews/en/vibrio-monitoring/04.png$cn$,
    $cn$/cardnews/en/vibrio-monitoring/05.png$cn$, $cn$/cardnews/en/vibrio-monitoring/06.png$cn$,
    $cn$/cardnews/en/vibrio-monitoring/07.png$cn$, $cn$/cardnews/en/vibrio-monitoring/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/vibrio-monitoring/01.png$cn$,
  array[
    $cn$vibrio$cn$, $cn$disease management$cn$, $cn$water temperature$cn$, $cn$feed management$cn$,
    $cn$pond management$cn$, $cn$mortality$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-09 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$vibrio-monitoring$cn$,
  $cn$vi$cn$,
  $cn$Quản lý vibrio — Khi nước ao phát sáng ban đêm$cn$,
  $cn$Vibrio không phải loại vi khuẩn để diệt mà là loại để đếm. Bài này nói về ngưỡng 10³ CFU/mL, ý nghĩa của khuẩn lạc xanh và điều mà hiện tượng phát sáng đang báo.$cn$,
  $cn$Nếu bạn từng ra ao ban đêm và thấy nước ánh lên màu xanh nhạt, đó là vibrio phát sáng. Và cũng có nghĩa là chúng đã tăng lên khá nhiều rồi.

■ Không phải loại để diệt, mà là loại để đếm

Vibrio vốn có sẵn trong nước biển. Không thể diệt sạch khỏi ao, và diệt sạch cũng không phải mục tiêu.

Vấn đề là số lượng. Khi còn ít thì chẳng có chuyện gì, nhưng gặp điều kiện thuận lợi mà tăng nhanh thì thành bệnh. Nên với vibrio phải hỏi nhiều bao nhiêu, chứ không phải có hay không.

■ Ngưỡng — 10³ CFU/mL

Đánh giá bằng tổng số vibrio trong 1 mL nước.

Dưới 10² CFU/mL là vùng an toàn. Từ 10² đến 10³ là vùng cảnh báo, phải bắt đầu xử lý từ đây. Vượt 10³ là vùng nguy hiểm, nguy cơ nhiễm bệnh tăng rõ rệt.

Cách đo là nuôi cấy nước trên môi trường TCBS rồi đếm khuẩn lạc. Nhiều nơi có thể làm được ở cơ quan thủy sản địa phương hoặc bộ phận kỹ thuật của công ty thức ăn, nên hãy hỏi thử.

■ Khuẩn lạc xanh là loại nguy hơn

Trên môi trường TCBS, vibrio mọc thành khuẩn lạc màu vàng hoặc xanh. Màu khác nhau là do khả năng phân giải đường, còn trong thực tế người ta dùng màu để phân mức nguy.

Khuẩn lạc xanh là phía nguy hiểm hơn. Nên cùng một tổng số, tỉ lệ xanh cao hơn thì tình hình xấu hơn. Khi nhận kết quả, đừng chỉ nhìn tổng số mà hãy xem cả tỉ lệ màu.

■ Phát sáng là tín hiệu hữu cơ

Nước phát sáng nghĩa là vibrio phát sáng đã tăng, mà chúng tăng nghĩa là có nhiều thứ để ăn. Chất hữu cơ tích ở đáy chính là thức ăn đó.

Nên thấy phát sáng thì thứ phải xem trước không phải là thuốc mà là đáy ao và lượng cho ăn. Kiểm tra xem có thừa thức ăn không, đáy có tích cặn không. Cứ để nguyên nguyên nhân mà chỉ diệt khuẩn thì vài hôm sau chúng lại tăng.

■ Mùa nóng chúng nhanh hơn

Vibrio sinh sôi càng nhanh khi nước càng ấm. Đó là lý do sự cố liên quan vibrio hay dồn vào mùa nóng.

Cùng lúc đó phía con tôm cũng tệ đi. Nước chạm ngưỡng 34 ℃ đã là gánh nặng, và 33 ℃ kéo dài nhiều ngày thì gan tụy tổn thương. Vi khuẩn tăng nhanh đúng vào lúc sức đề kháng của tôm yếu đi.

■ Những biểu hiện thường gặp

Tôm giảm ăn, vỏ mềm, và số con có màu đỏ hồng tăng lên. Thay vì chết dồn trong một đêm, thường là chết tăng dần qua vài ngày.

Ở đây có ghi chép lượng ăn thì phán đoán nhanh hơn hẳn. Nếu lượng thức ăn đã giảm mấy ngày liền thì đó chính là điểm bắt đầu.

■ Cách chặn nằm ở môi trường

Làm bẩn đáy ít đi, không để thừa thức ăn, giữ oxy, giảm dao động nhiệt độ. Cái gọi là quản lý vibrio thực chất chỉ là bốn việc đó.

Nghe không giống một biện pháp đặc biệt, nhưng thứ thật sự kéo số vi khuẩn xuống lại là phía này. Sát trùng chỉ giảm số lượng ngay lúc đó chứ không đổi được điều kiện.

■ Ghi chép quan trọng hơn ngưỡng

Nếu khó xét nghiệm hằng tuần thì ít nhất hãy ghi lượng ăn, nhiệt độ và tình trạng đáy mỗi ngày. Điều kiện khiến vibrio tăng sẽ hiện ra trong ghi chép đó trước. Kết quả xét nghiệm chỉ là thứ xác nhận lại.

Shrimp365 ghi nhiệt độ, lượng cho ăn và số tôm chết cùng lúc để bạn thấy trước điều kiện cho bệnh vào. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/vibrio-monitoring/01.png$cn$, $cn$/cardnews/vi/vibrio-monitoring/02.png$cn$,
    $cn$/cardnews/vi/vibrio-monitoring/03.png$cn$, $cn$/cardnews/vi/vibrio-monitoring/04.png$cn$,
    $cn$/cardnews/vi/vibrio-monitoring/05.png$cn$, $cn$/cardnews/vi/vibrio-monitoring/06.png$cn$,
    $cn$/cardnews/vi/vibrio-monitoring/07.png$cn$, $cn$/cardnews/vi/vibrio-monitoring/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/vibrio-monitoring/01.png$cn$,
  array[
    $cn$vibrio$cn$, $cn$quản lý dịch bệnh$cn$, $cn$nhiệt độ nước$cn$, $cn$quản lý thức ăn$cn$,
    $cn$quản lý ao$cn$, $cn$tôm chết$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-09 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$vibrio-monitoring$cn$,
  $cn$id$cn$,
  $cn$Pengendalian Vibrio — Saat Air Menyala di Malam Hari$cn$,
  $cn$Vibrio bukan bakteri untuk dibasmi, melainkan untuk dihitung. Berikut ambang 10³ CFU/mL, arti koloni hijau, dan apa yang sebenarnya diberitahukan oleh pendar itu.$cn$,
  $cn$Kalau Anda pernah keluar malam hari dan melihat air berpendar kebiruan, itu vibrio berpendar. Artinya juga jumlahnya sudah cukup banyak.

■ Bukan bakteri untuk dibasmi, tapi untuk dihitung

Vibrio memang ada di air laut. Tidak bisa dibasmi habis dari tambak, dan membasminya pun bukan tujuannya.

Masalahnya jumlah. Saat jumlahnya sedikit tidak terjadi apa-apa, tetapi begitu kondisinya cocok dan mereka melonjak, jadilah penyakit. Karena itu vibrio dinilai dari seberapa banyak, bukan dari ada atau tidak.

■ Ambangnya — 10³ CFU/mL

Dinilai dari total vibrio dalam 1 mL air.

Di bawah 10² CFU/mL adalah zona aman. Antara 10² dan 10³ adalah zona waspada, dan dari sini penanganan harus dimulai. Melewati 10³ adalah zona bahaya dan risiko infeksi naik jelas.

Pengukurannya dengan membiakkan air pada media TCBS lalu menghitung koloninya. Banyak yang bisa dilayani dinas perikanan setempat atau tim teknis perusahaan pakan, jadi coba tanyakan.

■ Koloni hijau adalah yang lebih berbahaya

Pada media TCBS, vibrio tumbuh sebagai koloni kuning atau hijau. Warnanya terbelah karena kemampuan memfermentasi gula, dan di lapangan warna dipakai untuk menilai tingkat risiko.

Koloni hijau adalah sisi yang lebih berbahaya. Jadi pada total yang sama, proporsi hijau yang lebih tinggi berarti keadaan lebih buruk. Saat menerima hasil, jangan hanya melihat totalnya — periksa juga komposisi warnanya.

■ Pendar itu sinyal bahan organik

Air yang berpendar berarti vibrio berpendar bertambah, dan bertambahnya mereka berarti banyak yang bisa dimakan. Bahan organik yang menumpuk di dasar itulah makanannya.

Jadi saat melihat pendar, yang pertama diperiksa bukan obat melainkan dasar dan jumlah pakan. Cek apakah ada pakan tersisa dan apakah endapan menumpuk. Kalau penyebabnya dibiarkan dan hanya bakterinya yang dibasmi, beberapa hari kemudian mereka kembali.

■ Musim panas mempercepat mereka

Vibrio berkembang biak makin cepat seiring naiknya suhu air. Itulah sebabnya kecelakaan terkait vibrio menumpuk di musim panas.

Di saat yang sama kondisi udang juga memburuk. Air yang menyentuh 34 ℃ sudah membebani, dan 33 ℃ selama beberapa hari merusak hepatopankreas. Bakteri melonjak persis ketika pertahanan udang melemah.

■ Gejala yang sering muncul

Respons makan menurun, kulit melunak, dan makin banyak yang terlihat kemerahan. Alih-alih kematian melonjak dalam semalam, lebih sering ia merangkak naik selama beberapa hari.

Di sini catatan konsumsi pakan mempercepat penilaian. Kalau konsumsi sudah menurun beberapa hari, di situlah titik mulainya.

■ Pencegahannya adalah lingkungan

Mengotori dasar lebih sedikit, tidak menyisakan pakan, menjaga oksigen, dan menekan ayunan suhu. Yang disebut pengendalian vibrio pada akhirnya adalah empat hal itu.

Kedengarannya bukan tindakan istimewa, tetapi sisi inilah yang benar-benar menurunkan jumlah bakterinya. Desinfeksi hanya mengurangi jumlah saat itu tanpa mengubah kondisinya.

■ Catatan lebih penting daripada angka batas

Kalau uji mingguan sulit, setidaknya catat konsumsi pakan, suhu, dan kondisi dasar setiap hari. Kondisi yang membuat vibrio bertambah akan muncul lebih dulu di catatan itu. Hasil laboratorium hanya menegaskan apa yang sudah dikatakan catatan.

Shrimp365 mencatat suhu, jumlah pakan, dan kematian bersama agar Anda melihat kondisi masuknya penyakit lebih awal. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/vibrio-monitoring/01.png$cn$, $cn$/cardnews/id/vibrio-monitoring/02.png$cn$,
    $cn$/cardnews/id/vibrio-monitoring/03.png$cn$, $cn$/cardnews/id/vibrio-monitoring/04.png$cn$,
    $cn$/cardnews/id/vibrio-monitoring/05.png$cn$, $cn$/cardnews/id/vibrio-monitoring/06.png$cn$,
    $cn$/cardnews/id/vibrio-monitoring/07.png$cn$, $cn$/cardnews/id/vibrio-monitoring/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/vibrio-monitoring/01.png$cn$,
  array[
    $cn$vibrio$cn$, $cn$manajemen penyakit$cn$, $cn$suhu air$cn$, $cn$manajemen pakan$cn$,
    $cn$manajemen tambak$cn$, $cn$kematian udang$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-09 09:00:00+09$cn$::timestamptz
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
