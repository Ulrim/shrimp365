-- ============================================================
-- 카드뉴스 — 물색 읽는 법 (en / vi / id) · 2026-08-06
--
-- 한국어판과 같은 slug("water-color-reading")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/water-color-reading/01..08.png
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
  $cn$water-color-reading$cn$,
  $cn$en$cn$,
  $cn$Reading Pond Water Colour — Sudden Clearing Is a Warning$cn$,
  $cn$If the water cleared up over a few days, it did not get better — the bloom crashed, and oxygen falls that night. Here is the 30–40 cm Secchi target and how to read the colour.$cn$,
  $cn$When cloudy water clears over a few days it is tempting to read that as an improvement. In a shrimp pond it usually means the opposite. Sudden clearing is the signal that the algal bloom has collapsed, and oxygen falls that same night.

■ Plankton is equipment, not decoration

Phytoplankton makes oxygen through photosynthesis during the day. At the same time it takes up ammonia as a nutrient. You have an oxygen generator and a water treatment unit floating in the pond.

So the amount of plankton is the state of the pond. Too little is a problem and too much is a problem. Secchi depth is how you measure that every day.

■ Secchi depth — 30 to 40 cm

Lower a Secchi disk slowly and note the depth where it disappears. A white disk is enough; without one, the depth at which your palm vanishes gives you a rough read.

30 to 40 cm is the working range. At that density plankton produces oxygen without consuming too much of it overnight.

Measure at the same time and the same spot each day. The difference between yesterday and today tells you more than the absolute number.

■ Below 25 cm — too much

Below 25 cm you have far too much plankton.

The danger there is not daytime but night. More plankton means more oxygen burned through respiration after dark. Ponds that read supersaturated in the afternoon and 2 mg/L before dawn are usually in this state. A daily pH swing above 0.5 is the same signal.

If you confirm an overbloom, cut feed and consider a water change. Plankton keeps growing as long as nutrients keep arriving.

■ Sudden clearing — that is a crash

This is the most dangerous signal. If yesterday read 30 cm and today reads 60 cm, plankton has died off in bulk.

Two things arrive together. The oxygen producer is gone, and the dead cells consume more oxygen as they break down. Supply stops while demand rises, which makes that night the most dangerous of the cycle.

If you confirm a crash, run aerators at maximum and stop feeding immediately. And be at the pond before dawn that night.

■ Reading the colour

Light green and light brown are good. Bright, lively colour means the cells are young and growing.

Deep blue-green means the balance has tipped toward cyanobacteria. They produce oxygen poorly, consume it at night, and collapse all at once when they go.

A grey cast means the plankton has aged and lost vigour, or that uneaten feed and bottom mud are suspended. Once colour starts to dull, treat it as a crash warning.

■ Records make prediction possible

Log Secchi depth daily and the trend before a crash becomes visible: 38, then 34, then 30, then suddenly 50. Catch that inflection and you can prevent a pre-dawn kill. Best of all is Secchi depth and pre-dawn dissolved oxygen written side by side on the same date.

Shrimp365 logs clarity and dissolved oxygen per tank and alerts you the moment a value leaves its range. Free to use.$cn$,
  array[
    $cn$/cardnews/en/water-color-reading/01.png$cn$, $cn$/cardnews/en/water-color-reading/02.png$cn$,
    $cn$/cardnews/en/water-color-reading/03.png$cn$, $cn$/cardnews/en/water-color-reading/04.png$cn$,
    $cn$/cardnews/en/water-color-reading/05.png$cn$, $cn$/cardnews/en/water-color-reading/06.png$cn$,
    $cn$/cardnews/en/water-color-reading/07.png$cn$, $cn$/cardnews/en/water-color-reading/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/water-color-reading/01.png$cn$,
  array[
    $cn$plankton$cn$, $cn$water clarity$cn$, $cn$water quality$cn$, $cn$dissolved oxygen$cn$,
    $cn$white shrimp$cn$, $cn$pond management$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-06 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$water-color-reading$cn$,
  $cn$vi$cn$,
  $cn$Đọc màu nước ao tôm — Nước trong đột ngột là điềm xấu$cn$,
  $cn$Nước trong hẳn ra sau vài ngày không phải là tốt lên mà là tảo đã sập. Đêm đó oxy sẽ tụt. Bài này nói về ngưỡng độ trong 30–40 cm và cách đọc màu nước.$cn$,
  $cn$Nước đang đục mà vài ngày sau trong hẳn ra thì dễ tưởng là nước tốt lên. Với ao tôm thì thường ngược lại. Trong đột ngột phần lớn là dấu hiệu tảo đã sập, và ngay đêm đó oxy sẽ tụt mạnh.

■ Tảo không phải để trang trí, đó là thiết bị

Tảo trong ao ban ngày quang hợp tạo ra oxy. Đồng thời chúng hút amoniac trong nước làm dinh dưỡng. Coi như có một máy tạo oxy kiêm máy lọc nước đang lơ lửng trong ao.

Vì vậy lượng tảo chính là tình trạng của ao. Ít quá cũng hỏng mà nhiều quá cũng hỏng. Cách đo mỗi ngày chính là độ trong.

■ Độ trong — 30 đến 40 cm

Thả đĩa Secchi xuống từ từ và ghi độ sâu mà đĩa biến mất. Đĩa trắng là đủ; không có thì ước chừng bằng độ sâu mà lòng bàn tay không còn nhìn thấy.

30 đến 40 cm là khoảng hợp lý. Ở mật độ đó tảo vừa tạo oxy vừa không tiêu quá nhiều oxy về đêm.

Hãy đo cùng giờ, cùng một chỗ mỗi ngày. Chênh lệch giữa hôm qua và hôm nay nói lên nhiều điều hơn con số tuyệt đối.

■ Dưới 25 cm — tảo quá dày

Độ trong xuống dưới 25 cm là tảo đã quá nhiều.

Nguy hiểm lúc này không phải ban ngày mà là ban đêm. Tảo càng nhiều thì oxy tiêu cho hô hấp ban đêm càng lớn. Những ao ban chiều đo ra quá bão hòa mà rạng sáng chỉ còn 2 mg/L thường đang ở trạng thái này. Biên độ pH trong ngày vượt 0,5 cũng là dấu hiệu tương tự.

Nếu xác định tảo quá dày thì giảm cho ăn và tính đến thay nước. Dinh dưỡng còn vào thì tảo còn tăng.

■ Trong đột ngột — đó là sập tảo

Đây là dấu hiệu nguy hiểm nhất. Hôm qua 30 cm mà hôm nay 60 cm nghĩa là tảo đã chết hàng loạt.

Hai chuyện đến cùng lúc. Thứ tạo oxy biến mất, và tảo chết phân hủy lại tiêu thêm oxy. Nguồn cung đứt trong khi tiêu thụ tăng, nên đêm đó là đêm nguy hiểm nhất cả vụ.

Nếu xác định tảo sập thì lập tức chạy quạt hết công suất và ngừng cho ăn. Và rạng sáng hôm đó nhất định phải có người ra ao.

■ Đọc bằng màu nước

Xanh lá nhạt và nâu nhạt là màu tốt. Màu sáng và tươi nghĩa là tảo đang phát triển khỏe.

Xanh lam đậm là dấu hiệu đã nghiêng về tảo lam. Tảo lam tạo oxy kém, ban đêm lại tiêu oxy, và khi sập thì sập cùng lúc.

Màu ngả xám là tảo đã già mất sức, hoặc thức ăn thừa và bùn đáy đang lơ lửng. Khi màu bắt đầu đục đi thì hãy coi đó là báo trước của một đợt sập.

■ Ghi chép tạo ra dự đoán

Ghi độ trong mỗi ngày thì trước khi sập sẽ thấy được xu hướng: 38 rồi 34 rồi 30, rồi đột nhiên 50. Bắt được điểm gãy đó là ngăn được đợt chết rạng sáng. Tốt nhất là ghi độ trong và oxy rạng sáng cạnh nhau cùng một ngày.

Shrimp365 ghi độ trong và oxy hòa tan theo từng ao, và báo ngay khi có chỉ số vượt ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/water-color-reading/01.png$cn$, $cn$/cardnews/vi/water-color-reading/02.png$cn$,
    $cn$/cardnews/vi/water-color-reading/03.png$cn$, $cn$/cardnews/vi/water-color-reading/04.png$cn$,
    $cn$/cardnews/vi/water-color-reading/05.png$cn$, $cn$/cardnews/vi/water-color-reading/06.png$cn$,
    $cn$/cardnews/vi/water-color-reading/07.png$cn$, $cn$/cardnews/vi/water-color-reading/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/water-color-reading/01.png$cn$,
  array[
    $cn$tảo$cn$, $cn$độ trong$cn$, $cn$chất lượng nước$cn$, $cn$oxy hòa tan$cn$,
    $cn$tôm thẻ chân trắng$cn$, $cn$quản lý ao$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-06 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$water-color-reading$cn$,
  $cn$id$cn$,
  $cn$Membaca Warna Air Tambak — Mendadak Bening Itu Peringatan$cn$,
  $cn$Air yang bening dalam beberapa hari bukan membaik, melainkan planktonnya runtuh. Malam itu oksigen anjlok. Berikut patokan kecerahan 30–40 cm dan cara membaca warnanya.$cn$,
  $cn$Air yang tadinya keruh lalu bening dalam beberapa hari mudah dikira membaik. Di tambak udang biasanya justru sebaliknya. Bening mendadak umumnya pertanda plankton sudah runtuh, dan malam itu juga oksigen akan anjlok.

■ Plankton itu perangkat, bukan hiasan

Fitoplankton menghasilkan oksigen lewat fotosintesis di siang hari. Sekaligus menyerap amonia di air sebagai nutrisi. Jadi ada penghasil oksigen sekaligus penjernih air yang mengambang di tambak.

Karena itu jumlah plankton adalah gambaran kondisi tambak. Terlalu sedikit bermasalah, terlalu banyak juga bermasalah. Cara mengukurnya tiap hari adalah kecerahan.

■ Kecerahan — 30 sampai 40 cm

Turunkan cakram Secchi perlahan lalu catat kedalaman saat cakram tak terlihat lagi. Cakram putih sudah cukup; kalau tidak ada, kedalaman saat telapak tangan tak terlihat bisa jadi perkiraan kasar.

30 sampai 40 cm adalah rentang yang pas. Pada kepadatan itu plankton menghasilkan oksigen tanpa menghabiskan terlalu banyak di malam hari.

Ukur pada jam dan titik yang sama setiap hari. Selisih kemarin dan hari ini lebih banyak bercerita daripada angka mutlaknya.

■ Di bawah 25 cm — kebanyakan

Kecerahan di bawah 25 cm berarti plankton sudah terlalu banyak.

Yang berbahaya bukan siangnya, melainkan malamnya. Makin banyak plankton, makin besar oksigen yang terpakai untuk respirasi setelah gelap. Tambak yang sore hari terbaca jenuh tapi menjelang subuh tinggal 2 mg/L umumnya dalam kondisi ini. Ayunan pH harian di atas 0,5 adalah sinyal yang sama.

Kalau terbukti kelebihan plankton, kurangi pakan dan pertimbangkan ganti air. Selama nutrisi terus masuk, plankton akan terus bertambah.

■ Mendadak bening — itu keruntuhan

Ini sinyal paling berbahaya. Kalau kemarin 30 cm dan hari ini 60 cm, berarti plankton mati massal.

Dua hal datang bersamaan. Penghasil oksigennya hilang, dan sel-sel mati itu menghabiskan oksigen lagi saat terurai. Pasokan terputus sementara konsumsi naik, sehingga malam itu jadi malam paling berbahaya sepanjang siklus.

Kalau terbukti runtuh, segera jalankan kincir maksimal dan hentikan pakan. Dan menjelang subuh malam itu harus ada orang di tambak.

■ Membaca lewat warna

Hijau muda dan cokelat muda adalah warna yang bagus. Warna cerah dan segar berarti selnya muda dan tumbuh aktif.

Hijau biru pekat menandakan keseimbangan sudah condong ke sianobakteri. Mereka buruk menghasilkan oksigen, malam hari justru memakainya, dan kalau runtuh maka runtuh sekaligus.

Warna yang kelabu berarti planktonnya menua dan kehilangan daya, atau pakan sisa dan lumpur dasar sedang melayang. Begitu warna mulai kusam, anggap itu peringatan keruntuhan.

■ Catatan yang membuat prediksi mungkin

Catat kecerahan tiap hari maka tren sebelum keruntuhan akan terlihat: 38, lalu 34, lalu 30, lalu tiba-tiba 50. Menangkap titik belok itu berarti mencegah kematian menjelang subuh. Paling baik adalah menulis kecerahan dan oksigen subuh berdampingan pada tanggal yang sama.

Shrimp365 mencatat kecerahan dan oksigen terlarut per petak, lalu memberi tahu begitu sebuah nilai keluar dari rentangnya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/water-color-reading/01.png$cn$, $cn$/cardnews/id/water-color-reading/02.png$cn$,
    $cn$/cardnews/id/water-color-reading/03.png$cn$, $cn$/cardnews/id/water-color-reading/04.png$cn$,
    $cn$/cardnews/id/water-color-reading/05.png$cn$, $cn$/cardnews/id/water-color-reading/06.png$cn$,
    $cn$/cardnews/id/water-color-reading/07.png$cn$, $cn$/cardnews/id/water-color-reading/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/water-color-reading/01.png$cn$,
  array[
    $cn$plankton$cn$, $cn$kecerahan air$cn$, $cn$kualitas air$cn$, $cn$oksigen terlarut$cn$,
    $cn$udang vaname$cn$, $cn$manajemen tambak$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-06 09:00:00+09$cn$::timestamptz
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
