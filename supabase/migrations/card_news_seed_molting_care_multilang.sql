-- ============================================================
-- 카드뉴스 — 탈피 직후 관리 (en / vi / id)
--
-- 한국어판과 같은 slug("molting-care")를 쓰고 locale만 다르게 넣는다.
-- 그래야 hreflangMap()이 언어 간 링크를 만든다.
-- 수치는 네 언어가 모두 동일해야 한다.
--
-- 이미지: public/cardnews/<locale>/molting-care/01..08.png
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
--            한국어판(card_news_seed_molting_care.sql)과는 독립적으로 실행 가능하다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values

-- ── English ────────────────────────────────────────────────
(
  $cn$molting-care$cn$,
  $cn$en$cn$,
  $cn$Molting Care for White Shrimp — The Hours After a Molt Are the Riskiest$cn$,
  $cn$Shrimp grow only when they molt. But a freshly molted shrimp is defenceless until its new shell hardens, and its oxygen demand climbs while that happens. Here is what to watch during a molt, and how to prevent molt failure.$cn$,
  $cn$Shrimp do not grow gradually the way fish do. They are locked inside a rigid shell, and they get bigger only in the moment they shed it. Molting is growth itself. The problem is that it is also the most dangerous time in a shrimp's life.

■ What happens right after a molt

A shrimp that has just shed its shell is soft. The new shell takes roughly one to three days to harden, and during that stretch the animal is effectively defenceless. Predators are one threat, but so are the other shrimp in the same pond — a soft-shelled neighbour is an easy meal and a convenient source of the minerals they need for their own shell. This is why losses cluster around molting in dense ponds with nowhere to hide.

Oxygen is the other thing farmers miss. Molting burns a great deal of energy, and oxygen demand rises sharply while it happens. A dissolved oxygen level that is normally survivable can fall short during a molt. Hold DO at 5 mg/L or above, and pay particular attention to the pre-dawn hours when oxygen bottoms out.

■ When the shell will not harden — molt failure

Building a new shell draws minerals from the water. In water with low alkalinity the shell cannot harden properly, and animals begin a molt they cannot finish. That is molt failure.

Manage alkalinity in the range of 100–150 mg/L. The same buffer also stabilises pH. When alkalinity runs low, the daily pH swing widens, and that alone is a burden on the animals.

Sudden salinity changes cause molt failure too. White shrimp tolerate a wide band, roughly 5–35 ppt, but what matters is not the absolute value — it is the rate of change. A shift of more than 5 ppt in a single day is more than a freshly molted shrimp can absorb. Always re-measure after a water exchange or heavy rain. Keep the daily temperature swing under 3 ℃ for the same reason.

■ Do not feed more when they stop eating

As a molt approaches, shrimp eat less or stop altogether. This is normal, not illness. The common mistake here is to read the reduced intake as hunger and increase the ration.

Uneaten feed settles on the bottom, breaks down, drives ammonia up and consumes oxygen. During a molt that means causing the two things you least want, at the same time. Reduce the ration and adjust based on what is left in the feed trays.

■ Give them somewhere to hide

The single most reliable way to keep a freshly molted shrimp alive is to keep it out of sight. Ponds with adequate shelter lose noticeably fewer animals during molting periods. In high-density ponds this matters more, not less.

■ You track molting with records, not with your eyes

A pond does not molt all at once. Individuals are on their own schedules — younger shrimp molt more often, larger ones less. So "are we in a molt right now?" is not a question a single look at the pond can answer.

Records answer it. If feed intake has been falling for several days, empty shells are showing up on the bottom, and mortality ticked up over that same window, molting is likely involved. Log feeding, water quality and mortality against the same dates and you will start to see the next cycle coming.

Shrimp365 logs water quality, feeding and mortality per tank and alerts you when a value leaves its range. It is free to use.$cn$,
  array[
    $cn$/cardnews/en/molting-care/01.png$cn$, $cn$/cardnews/en/molting-care/02.png$cn$,
    $cn$/cardnews/en/molting-care/03.png$cn$, $cn$/cardnews/en/molting-care/04.png$cn$,
    $cn$/cardnews/en/molting-care/05.png$cn$, $cn$/cardnews/en/molting-care/06.png$cn$,
    $cn$/cardnews/en/molting-care/07.png$cn$, $cn$/cardnews/en/molting-care/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/molting-care/01.png$cn$,
  array[
    $cn$molting$cn$, $cn$white shrimp$cn$, $cn$water quality$cn$, $cn$dissolved oxygen$cn$,
    $cn$alkalinity$cn$, $cn$salinity$cn$, $cn$feed management$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  now()
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$molting-care$cn$,
  $cn$vi$cn$,
  $cn$Quản lý tôm thẻ lột xác — Nguy hiểm nhất là ngay sau khi lột$cn$,
  $cn$Tôm chỉ lớn lên khi lột xác. Nhưng tôm vừa lột thì không tự vệ được cho đến khi vỏ mới cứng lại, và nhu cầu oxy trong giai đoạn này tăng mạnh. Bài này tổng hợp những điều cần kiểm tra khi tôm lột xác và cách phòng lột xác lỗi.$cn$,
  $cn$Tôm không lớn dần từng chút như cá. Chúng bị bó trong lớp vỏ cứng và chỉ to ra đúng vào lúc trút bỏ lớp vỏ đó. Lột xác chính là sự tăng trưởng. Vấn đề là đây cũng là quãng thời gian nguy hiểm nhất của con tôm.

■ Điều gì xảy ra ngay sau khi lột xác

Con tôm vừa trút vỏ có thân mềm. Vỏ mới cần khoảng một đến ba ngày để cứng lại, và trong suốt quãng đó tôm gần như không có khả năng tự vệ. Không chỉ địch hại bên ngoài — chính những con tôm khác trong ao cũng tấn công. Một con tôm vỏ mềm là miếng mồi dễ ăn và là nguồn khoáng tiện lợi cho lớp vỏ của con tấn công. Đó là lý do hao hụt thường dồn vào giai đoạn lột xác ở những ao mật độ cao và không có chỗ trú.

Điều thứ hai dễ bị bỏ qua là oxy. Lột xác tiêu tốn rất nhiều năng lượng, nên nhu cầu oxy trong giai đoạn này tăng mạnh. Mức oxy hòa tan bình thường vẫn đủ có thể trở nên thiếu khi tôm lột. Hãy giữ oxy hòa tan từ 5 mg/L trở lên, và đặc biệt chú ý khoảng rạng sáng khi oxy xuống thấp nhất trong ngày.

■ Khi vỏ không cứng lại — lột xác lỗi

Vỏ mới được tạo thành từ khoáng chất trong nước. Trong nước có độ kiềm thấp, vỏ không thể cứng lại đúng cách, và có những con bắt đầu lột nhưng không hoàn tất được rồi chết. Đó gọi là lột xác lỗi.

Hãy quản lý độ kiềm trong khoảng 100–150 mg/L. Độ kiềm cũng đồng thời giữ pH ổn định. Khi độ kiềm thấp, biên độ dao động pH trong ngày rộng ra, và riêng điều đó đã là gánh nặng cho tôm.

Độ mặn thay đổi đột ngột cũng gây lột xác lỗi. Tôm thẻ chân trắng sống được trong khoảng rộng, chừng 5–35 ppt, nhưng điều quan trọng không phải giá trị tuyệt đối mà là tốc độ thay đổi. Thay đổi quá 5 ppt trong một ngày là mức con tôm vừa lột không chịu nổi. Sau khi thay nước hoặc sau mưa lớn, nhất định phải đo lại. Biên độ nhiệt độ trong ngày cũng nên giữ dưới 3 ℃ vì cùng lý do.

■ Đừng cho ăn thêm khi tôm bỏ ăn

Gần đến kỳ lột xác, tôm ăn ít lại hoặc gần như bỏ ăn. Đây là quá trình bình thường, không phải bệnh. Sai lầm thường gặp là nghĩ "ăn ít thì phải cho thêm" rồi tăng lượng thức ăn.

Thức ăn không được ăn sẽ lắng xuống đáy, phân hủy, làm tăng ammonia và tiêu hao oxy. Trong giai đoạn lột xác, đó là gây ra đúng hai thứ cần tránh nhất, cùng một lúc. Hãy giảm lượng cho ăn và điều chỉnh dựa trên phần còn lại trong sàng ăn.

■ Hãy tạo chỗ trú ẩn

Cách chắc chắn nhất để con tôm vừa lột sống sót là không bị những con khác nhìn thấy. Ao có đủ chỗ trú ẩn hao hụt trong kỳ lột xác ít hơn rõ rệt. Ao mật độ cao càng cần chú ý điều này.

■ Nhìn kỳ lột xác bằng sổ ghi chép, không phải bằng mắt

Cả ao không lột xác cùng một lúc. Mỗi con một nhịp, tôm nhỏ lột thường xuyên hơn, tôm lớn thưa hơn. Vì vậy câu hỏi "bây giờ có phải kỳ lột xác không" không thể trả lời bằng một lần nhìn xuống ao.

Sổ ghi chép trả lời được. Nếu lượng ăn giảm mấy ngày liền, đáy ao xuất hiện vỏ rỗng, và trong cùng khoảng đó hao hụt tăng lên thì nhiều khả năng liên quan đến lột xác. Ghi lượng cho ăn, chất lượng nước và hao hụt theo cùng một ngày, bạn sẽ dần đoán được kỳ lột tiếp theo.

Shrimp365 ghi lại chất lượng nước, lượng cho ăn và hao hụt theo từng ao, và báo cho bạn khi có chỉ số vượt ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/molting-care/01.png$cn$, $cn$/cardnews/vi/molting-care/02.png$cn$,
    $cn$/cardnews/vi/molting-care/03.png$cn$, $cn$/cardnews/vi/molting-care/04.png$cn$,
    $cn$/cardnews/vi/molting-care/05.png$cn$, $cn$/cardnews/vi/molting-care/06.png$cn$,
    $cn$/cardnews/vi/molting-care/07.png$cn$, $cn$/cardnews/vi/molting-care/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/molting-care/01.png$cn$,
  array[
    $cn$lột xác$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$chất lượng nước$cn$, $cn$oxy hòa tan$cn$,
    $cn$độ kiềm$cn$, $cn$độ mặn$cn$, $cn$quản lý thức ăn$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  now()
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$molting-care$cn$,
  $cn$id$cn$,
  $cn$Manajemen Molting Udang Vaname — Paling Rawan Justru Setelah Ganti Kulit$cn$,
  $cn$Udang hanya tumbuh saat molting. Tetapi udang yang baru ganti kulit tidak berdaya sampai kulit barunya mengeras, dan kebutuhan oksigennya naik tajam selama itu. Berikut yang perlu dipantau saat molting dan cara mencegah gagal molting.$cn$,
  $cn$Udang tidak tumbuh sedikit demi sedikit seperti ikan. Mereka terkurung dalam kulit yang keras dan baru membesar tepat pada saat melepaskannya. Molting adalah pertumbuhan itu sendiri. Masalahnya, itu juga waktu paling berbahaya bagi udang.

■ Apa yang terjadi tepat setelah molting

Udang yang baru melepas kulitnya bertubuh lunak. Kulit baru butuh sekitar satu sampai tiga hari untuk mengeras, dan selama itu udang praktis tidak punya pertahanan. Bukan hanya predator dari luar — udang lain di kolam yang sama pun menyerang. Udang berkulit lunak adalah mangsa mudah sekaligus sumber mineral yang praktis untuk kulit si penyerang. Karena itu kehilangan sering menumpuk di masa molting pada kolam padat yang tidak punya tempat bersembunyi.

Hal kedua yang mudah terlewat adalah oksigen. Molting menghabiskan banyak energi, sehingga kebutuhan oksigen pada masa ini naik tajam. Kadar oksigen terlarut yang biasanya cukup bisa menjadi kurang saat molting. Jaga oksigen terlarut di 5 mg/L atau lebih, dan beri perhatian khusus pada dini hari ketika oksigen berada di titik terendah.

■ Ketika kulit tidak mengeras — gagal molting

Kulit baru dibentuk dari mineral yang ada di air. Pada air dengan alkalinitas rendah kulit tidak dapat mengeras dengan benar, dan ada udang yang mulai molting tetapi tidak sanggup menyelesaikannya lalu mati. Inilah yang disebut gagal molting.

Kelola alkalinitas pada kisaran 100–150 mg/L. Alkalinitas sekaligus menstabilkan pH. Bila alkalinitas rendah, ayunan pH harian melebar, dan itu sendiri sudah membebani udang.

Perubahan salinitas yang mendadak juga memicu gagal molting. Udang vaname sanggup hidup pada rentang lebar, sekitar 5–35 ppt, tetapi yang menentukan bukan nilai mutlaknya melainkan kecepatan perubahannya. Perubahan lebih dari 5 ppt dalam sehari tidak sanggup ditahan udang yang baru molting. Setelah ganti air atau hujan deras, ukur ulang. Jaga juga ayunan suhu harian di bawah 3 ℃ dengan alasan yang sama.

■ Jangan menambah pakan saat udang berhenti makan

Menjelang molting, udang makan lebih sedikit atau hampir berhenti. Ini proses normal, bukan penyakit. Kesalahan yang sering terjadi adalah membaca turunnya nafsu makan sebagai kelaparan lalu menambah pakan.

Pakan yang tidak dimakan mengendap di dasar, terurai, menaikkan amonia dan menghabiskan oksigen. Pada masa molting itu berarti memicu dua hal yang paling ingin dihindari sekaligus. Kurangi jatah pakan dan sesuaikan berdasarkan sisa di anco.

■ Sediakan tempat berlindung

Cara paling andal menjaga udang yang baru molting tetap hidup adalah membuatnya tidak terlihat. Kolam dengan tempat berlindung yang memadai kehilangan jauh lebih sedikit udang selama masa molting. Pada kolam padat hal ini justru lebih penting.

■ Molting dibaca dari catatan, bukan dari pandangan mata

Satu kolam tidak molting serentak. Tiap individu punya jadwalnya sendiri — udang kecil lebih sering, udang besar lebih jarang. Jadi pertanyaan "apakah sekarang masa molting" tidak bisa dijawab dengan sekali melihat kolam.

Catatan yang menjawabnya. Bila konsumsi pakan turun beberapa hari berturut-turut, kulit kosong mulai terlihat di dasar, dan pada rentang yang sama kematian ikut naik, besar kemungkinan itu berkaitan dengan molting. Catat pakan, kualitas air dan kematian pada tanggal yang sama, maka siklus berikutnya akan mulai terbaca.

Shrimp365 mencatat kualitas air, pakan dan kematian per petak, lalu memberi tahu Anda saat sebuah nilai keluar dari rentangnya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/molting-care/01.png$cn$, $cn$/cardnews/id/molting-care/02.png$cn$,
    $cn$/cardnews/id/molting-care/03.png$cn$, $cn$/cardnews/id/molting-care/04.png$cn$,
    $cn$/cardnews/id/molting-care/05.png$cn$, $cn$/cardnews/id/molting-care/06.png$cn$,
    $cn$/cardnews/id/molting-care/07.png$cn$, $cn$/cardnews/id/molting-care/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/molting-care/01.png$cn$,
  array[
    $cn$molting$cn$, $cn$udang vaname$cn$, $cn$kualitas air$cn$, $cn$oksigen terlarut$cn$,
    $cn$alkalinitas$cn$, $cn$salinitas$cn$, $cn$manajemen pakan$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  now()
)

on conflict (slug, locale) do update set
  title        = excluded.title,
  summary      = excluded.summary,
  body         = excluded.body,
  images       = excluded.images,
  cover_url    = excluded.cover_url,
  tags         = excluded.tags,
  published    = excluded.published,
  published_at = excluded.published_at,
  updated_at   = now();
