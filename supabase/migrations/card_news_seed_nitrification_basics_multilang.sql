-- ============================================================
-- 카드뉴스 — 질산화와 미생물제 (en / vi / id) · 2026-08-10
--
-- 한국어판과 같은 slug("nitrification-basics")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/nitrification-basics/01..08.png
--
-- 특정 제품은 언급하지 않는다. 원리만 다룬다.
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
  $cn$nitrification-basics$cn$,
  $cn$en$cn$,
  $cn$Nitrification and Probiotics — They Are Not Medicine$cn$,
  $cn$Adding a probiotic when ammonia spikes does not lower the reading that day. Nitrifiers take 2 to 4 weeks to establish. Here is how nitrification runs and when to add.$cn$,
  $cn$Ammonia went up, you added a probiotic, and the next day it reads the same. The product is not bad — the timing is wrong. A probiotic is not medicine that lowers today's number. It is preparation that stops the number from rising.

■ Nitrification runs in two steps

Shrimp excrete and feed is left behind, and ammonia forms. Nitrification is the path by which that ammonia disappears.

Ammonia becomes nitrite first, then nitrite becomes nitrate. That last stage is far less toxic than the two before it. So on a pond where nitrification turns well, nitrogen keeps arriving without accumulating in a dangerous form.

■ Each step has different bacteria

This is the core of it. The bacteria that turn ammonia into nitrite and the ones that turn nitrite into nitrate are different organisms.

And the second group settles in later. So early in a cycle ammonia starts being processed while nitrite has nowhere to go and piles up for a while. That is exactly why nitrite climbs a few days after ammonia falls.

Know that window and you do not panic. Miss it and you stop measuring because ammonia looked solved — and the second accident happens in that gap.

■ 2 to 4 weeks to establish

The bacteria that run nitrification grow slowly. In a newly started pond they usually take 2 to 4 weeks to establish.

So adding a probiotic today and lowering today's reading does not happen. If the number is already up and the shrimp are at risk, you need something other than a probiotic. Cut feed, raise oxygen, consider a water change — those come first.

■ The time to add is routinely

There are three moments when a probiotic actually earns its cost.

At start-up, when the water holds nothing yet and needs to be established.

Right after disinfection, when you killed the useful bacteria along with the pathogens. That is when it is emptiest.

And routinely. Feed and waste raise the nitrogen load as the cycle proceeds. Building processing capacity before the load arrives is the right order.

Adding after the accident is late. You add so the accident does not happen.

■ Without alkalinity, nitrification stops too

This is the most commonly missed part. Nitrification consumes alkalinity. Taking 1 g of ammonia through to nitrate uses roughly 7.14 g of alkalinity.

So the heavier the nitrogen load, the faster alkalinity falls. Run alkalinity to the floor and nitrification itself slows or stops. In that state no amount of probiotic helps.

Manage alkalinity around 100 to 150 mg/L. If you use a probiotic, you have to measure alkalinity alongside it. They are one package.

■ Oxygen is required too

The bacteria running nitrification use oxygen. Where oxygen does not reach the bottom, nitrification does not proceed.

The 5 mg/L you hold for the shrimp is also what these bacteria need. Running the aerators is oxygen supply and nitrogen processing at the same time. Where organic matter lies thick on the bottom, oxygen does not reach inside it and something else happens there instead of nitrification.

■ To put it simply

A probiotic is closer to equipment than to emergency medicine. Lay it down in advance and meet its conditions and it works; without those conditions it does nothing however much you add. Alkalinity and oxygen are those conditions.

■ Records matter more than thresholds

Write down when you added, and what ammonia, nitrite and alkalinity read at the time. After a few cycles you will see how many days nitrification takes to establish on your pond, and how fast alkalinity falls. Knowing those numbers comes before choosing which product to use.

Shrimp365 logs ammonia, nitrite and alkalinity together per tank and alerts you the moment a value leaves its range. Free to use.$cn$,
  array[
    $cn$/cardnews/en/nitrification-basics/01.png$cn$, $cn$/cardnews/en/nitrification-basics/02.png$cn$,
    $cn$/cardnews/en/nitrification-basics/03.png$cn$, $cn$/cardnews/en/nitrification-basics/04.png$cn$,
    $cn$/cardnews/en/nitrification-basics/05.png$cn$, $cn$/cardnews/en/nitrification-basics/06.png$cn$,
    $cn$/cardnews/en/nitrification-basics/07.png$cn$, $cn$/cardnews/en/nitrification-basics/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/nitrification-basics/01.png$cn$,
  array[
    $cn$nitrification$cn$, $cn$probiotics$cn$, $cn$ammonia$cn$, $cn$nitrite$cn$,
    $cn$alkalinity$cn$, $cn$water quality$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-10 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$nitrification-basics$cn$,
  $cn$vi$cn$,
  $cn$Nitrat hóa và men vi sinh — Men không phải là thuốc$cn$,
  $cn$Amoniac tăng rồi đổ men vi sinh thì hôm đó chỉ số cũng không hạ. Vi khuẩn nitrat hóa cần 2 đến 4 tuần mới ổn định. Bài này nói quá trình nitrat hóa diễn ra thế nào và khi nào nên đổ men.$cn$,
  $cn$Amoniac lên, bạn đổ men vi sinh, hôm sau đo vẫn y nguyên. Không phải sản phẩm dở mà là đổ sai lúc. Men vi sinh không phải thuốc hạ chỉ số của hôm nay. Nó là thứ chuẩn bị để chỉ số đừng lên.

■ Nitrat hóa diễn ra qua hai bước

Tôm bài tiết và thức ăn còn thừa thì sinh ra amoniac. Con đường để amoniac đó biến mất chính là nitrat hóa.

Amoniac thành nitrit trước, rồi nitrit mới thành nitrat. Bước cuối này ít độc hơn hẳn hai bước trước. Nên ao nào quá trình nitrat hóa chạy tốt thì đạm cứ vào mà không tích lại ở dạng nguy hiểm.

■ Mỗi bước một loại vi khuẩn khác nhau

Đây là điểm cốt lõi. Vi khuẩn biến amoniac thành nitrit và vi khuẩn biến nitrit thành nitrat là hai nhóm khác nhau.

Và nhóm thứ hai ổn định muộn hơn. Nên đầu vụ amoniac bắt đầu được xử lý trong khi nitrit không có chỗ đi nên dồn lại một thời gian. Đó chính là lý do vài ngày sau khi amoniac hạ thì nitrit lại lên.

Biết giai đoạn này thì không hoảng. Không biết thì thấy amoniac ổn rồi liền ngừng đo — và tai nạn thứ hai xảy ra ngay khoảng trống đó.

■ Cần 2 đến 4 tuần mới ổn định

Vi khuẩn làm nhiệm vụ nitrat hóa sinh trưởng chậm. Ở ao mới bắt đầu, chúng thường cần 2 đến 4 tuần mới ổn định.

Nên chuyện đổ men hôm nay rồi hạ chỉ số hôm nay là không có. Nếu chỉ số đã lên và tôm đang nguy thì cần biện pháp khác chứ không phải men. Giảm cho ăn, nâng oxy, tính thay nước — những việc đó phải làm trước.

■ Thời điểm đổ là lúc bình thường

Có ba lúc mà men vi sinh thật sự đáng đồng tiền.

Lúc bắt đầu vụ, vì nước chưa có gì nên phải gây dựng.

Ngay sau khi sát trùng, vì đã diệt luôn cả vi khuẩn có ích cùng mầm bệnh. Đó là lúc trống nhất.

Và lúc bình thường. Vụ càng về sau thức ăn và chất thải càng nhiều nên tải đạm tăng lên. Xây năng lực xử lý trước khi tải tăng mới đúng thứ tự.

Đổ sau khi đã có sự cố là muộn. Đổ là để sự cố đừng xảy ra.

■ Không có độ kiềm thì nitrat hóa cũng dừng

Đây là phần hay bị bỏ sót nhất. Nitrat hóa tiêu tốn độ kiềm. Đưa 1 g amoniac đi hết đường tới nitrat thì tốn khoảng 7,14 g độ kiềm.

Nên ao nào tải đạm lớn thì độ kiềm tụt càng nhanh. Độ kiềm cạn thì bản thân quá trình nitrat hóa chậm lại hoặc dừng hẳn. Ở trạng thái đó thì đổ bao nhiêu men cũng vô ích.

Hãy quản độ kiềm quanh mức 100 đến 150 mg/L. Nếu đang dùng men vi sinh thì phải đo độ kiềm kèm theo. Hai thứ này đi chung một gói.

■ Oxy cũng cần

Vi khuẩn làm nitrat hóa có dùng oxy. Chỗ nào oxy không chạm tới đáy thì ở đó nitrat hóa không diễn ra.

Mức 5 mg/L bạn giữ cho tôm cũng chính là mức những vi khuẩn này cần. Nghĩa là chạy quạt vừa là cấp oxy vừa là xử lý đạm. Chỗ nào hữu cơ dày ở đáy thì bên trong oxy không tới, và ở đó xảy ra chuyện khác chứ không phải nitrat hóa.

■ Nói gọn lại

Men vi sinh gần với thiết bị hơn là thuốc cấp cứu. Đặt sẵn và tạo đủ điều kiện thì nó làm việc, không có điều kiện thì đổ bao nhiêu cũng không làm. Độ kiềm và oxy chính là điều kiện đó.

■ Ghi chép quan trọng hơn ngưỡng

Hãy ghi lại đã đổ men lúc nào, khi đó amoniac, nitrit, độ kiềm là bao nhiêu. Qua vài vụ bạn sẽ thấy ao mình cần mấy ngày để nitrat hóa ổn định, và độ kiềm tụt bao nhiêu trong mấy ngày. Biết những con số đó còn quan trọng hơn việc chọn dùng sản phẩm nào.

Shrimp365 ghi amoniac, nitrit và độ kiềm cùng lúc theo từng ao, và báo ngay khi có chỉ số vượt ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/nitrification-basics/01.png$cn$, $cn$/cardnews/vi/nitrification-basics/02.png$cn$,
    $cn$/cardnews/vi/nitrification-basics/03.png$cn$, $cn$/cardnews/vi/nitrification-basics/04.png$cn$,
    $cn$/cardnews/vi/nitrification-basics/05.png$cn$, $cn$/cardnews/vi/nitrification-basics/06.png$cn$,
    $cn$/cardnews/vi/nitrification-basics/07.png$cn$, $cn$/cardnews/vi/nitrification-basics/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/nitrification-basics/01.png$cn$,
  array[
    $cn$nitrat hóa$cn$, $cn$men vi sinh$cn$, $cn$amoniac$cn$, $cn$nitrit$cn$,
    $cn$độ kiềm$cn$, $cn$chất lượng nước$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-10 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$nitrification-basics$cn$,
  $cn$id$cn$,
  $cn$Nitrifikasi dan Probiotik — Probiotik Itu Bukan Obat$cn$,
  $cn$Menebar probiotik saat amonia naik tidak menurunkan angkanya hari itu juga. Bakteri nitrifikasi perlu 2 sampai 4 minggu untuk mapan. Berikut cara kerja nitrifikasi dan kapan menebarnya.$cn$,
  $cn$Amonia naik, Anda menebar probiotik, keesokan harinya angkanya tetap sama. Bukan produknya yang buruk, melainkan waktunya yang salah. Probiotik bukan obat yang menurunkan angka hari ini. Ia adalah persiapan supaya angkanya tidak naik.

■ Nitrifikasi berjalan dalam dua tahap

Udang membuang kotoran dan pakan tersisa, lalu terbentuk amonia. Nitrifikasi adalah jalur hilangnya amonia itu.

Amonia menjadi nitrit dulu, lalu nitrit menjadi nitrat. Tahap terakhir ini jauh lebih rendah racunnya dibanding dua tahap sebelumnya. Jadi di tambak yang nitrifikasinya berputar baik, nitrogen terus masuk tanpa menumpuk dalam bentuk berbahaya.

■ Tiap tahap bakterinya berbeda

Di sinilah intinya. Bakteri yang mengubah amonia jadi nitrit dan yang mengubah nitrit jadi nitrat adalah organisme yang berbeda.

Dan kelompok kedua mapan lebih lambat. Jadi di awal siklus amonia mulai diproses sementara nitrit tidak punya tujuan sehingga menumpuk untuk sementara. Persis itulah sebabnya nitrit naik beberapa hari setelah amonia turun.

Kalau tahu periode ini Anda tidak panik. Kalau tidak tahu, Anda berhenti mengukur karena merasa amonia sudah beres — dan kecelakaan kedua terjadi di celah itu.

■ Perlu 2 sampai 4 minggu untuk mapan

Bakteri yang menjalankan nitrifikasi tumbuh lambat. Di tambak yang baru mulai, mereka umumnya perlu 2 sampai 4 minggu untuk mapan.

Jadi menebar hari ini lalu angkanya turun hari ini juga tidak akan terjadi. Kalau angkanya sudah naik dan udang dalam bahaya, yang dibutuhkan bukan probiotik melainkan tindakan lain. Kurangi pakan, naikkan oksigen, pertimbangkan ganti air — itu yang lebih dulu.

■ Waktu menebarnya adalah saat normal

Ada tiga saat probiotik benar-benar sepadan dengan biayanya.

Saat memulai, karena airnya belum berisi apa pun dan harus dibangun dulu.

Tepat setelah desinfeksi, karena bakteri berguna ikut mati bersama patogen. Saat itulah paling kosong.

Dan saat normal. Makin jauh siklusnya, pakan dan kotoran menaikkan beban nitrogen. Membangun kapasitas pengolahan sebelum bebannya datang adalah urutan yang benar.

Menebar setelah kecelakaan terjadi itu terlambat. Menebar dilakukan supaya kecelakaannya tidak terjadi.

■ Tanpa alkalinitas, nitrifikasi juga berhenti

Ini bagian yang paling sering terlewat. Nitrifikasi menghabiskan alkalinitas. Membawa 1 g amonia sampai menjadi nitrat memakai sekitar 7,14 g alkalinitas.

Jadi makin berat beban nitrogennya, makin cepat alkalinitas turun. Kalau alkalinitas habis, nitrifikasinya sendiri melambat atau berhenti. Dalam keadaan itu, sebanyak apa pun probiotik ditebar tidak ada gunanya.

Kelola alkalinitas di kisaran 100 sampai 150 mg/L. Kalau memakai probiotik, alkalinitas harus diukur bersamaan. Keduanya satu paket.

■ Oksigen juga diperlukan

Bakteri yang menjalankan nitrifikasi memakai oksigen. Di bagian yang oksigennya tidak sampai ke dasar, nitrifikasi tidak berjalan.

Angka 5 mg/L yang Anda jaga untuk udang juga merupakan kebutuhan bakteri ini. Artinya menjalankan kincir sekaligus memasok oksigen dan mengolah nitrogen. Di tempat bahan organik menumpuk tebal di dasar, oksigen tidak masuk ke dalamnya, dan di situ terjadi hal lain alih-alih nitrifikasi.

■ Ringkasnya

Probiotik lebih dekat ke perangkat daripada ke obat darurat. Disiapkan lebih dulu dan kondisinya dipenuhi maka ia bekerja; tanpa kondisi itu, ditebar sebanyak apa pun tidak bekerja. Alkalinitas dan oksigen adalah kondisi tersebut.

■ Catatan lebih penting daripada angka batas

Catat kapan Anda menebarnya, dan saat itu amonia, nitrit, serta alkalinitasnya berapa. Setelah beberapa siklus akan terlihat berapa hari nitrifikasi mapan di tambak Anda, dan seberapa cepat alkalinitas turun. Mengetahui angka itu lebih dulu daripada memilih produk mana yang dipakai.

Shrimp365 mencatat amonia, nitrit, dan alkalinitas bersama per petak, lalu memberi tahu begitu sebuah nilai keluar dari rentangnya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/nitrification-basics/01.png$cn$, $cn$/cardnews/id/nitrification-basics/02.png$cn$,
    $cn$/cardnews/id/nitrification-basics/03.png$cn$, $cn$/cardnews/id/nitrification-basics/04.png$cn$,
    $cn$/cardnews/id/nitrification-basics/05.png$cn$, $cn$/cardnews/id/nitrification-basics/06.png$cn$,
    $cn$/cardnews/id/nitrification-basics/07.png$cn$, $cn$/cardnews/id/nitrification-basics/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/nitrification-basics/01.png$cn$,
  array[
    $cn$nitrifikasi$cn$, $cn$probiotik$cn$, $cn$amonia$cn$, $cn$nitrit$cn$,
    $cn$alkalinitas$cn$, $cn$kualitas air$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-10 09:00:00+09$cn$::timestamptz
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
