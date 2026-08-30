-- ============================================================
-- 카드뉴스 — EHP와 성장 정체 (en / vi / id) · 2026-08-16
--
-- 한국어판과 같은 slug("ehp-slow-growth")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/ehp-slow-growth/01..08.png
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
  $cn$ehp-slow-growth$cn$,
  $cn$en$cn$,
  $cn$EHP — Shrimp That Will Not Die and Will Not Grow$cn$,
  $cn$No mortality but the size has not moved in weeks — suspect EHP. A microsporidian that enters the hepatopancreas, reported to cut annual output across Asia by 10–20%. There is no cure.$cn$,
  $cn$Almost no mortality. Water quality normal. Yet the size has not moved in weeks, and the gap between the biggest and smallest animals from the same stocking keeps widening. This is when you check for EHP.

■ Not a killer, a stunter

EHP (Enterocytozoon hepatopenaei) is a microsporidian parasite. It settles into the hepatopancreas of white shrimp.

What defines this disease is that it does not cause mass mortality. That is why it is found late. AHPND collapses a pond in days and you notice immediately; EHP quietly runs up your feed bill.

Across major producing countries in Asia, EHP is reported to reduce annual output by 10 to 20%. Detection in white shrimp has also been reported in Korea.

■ The target is the hepatopancreas — the same organ as AHPND

The hepatopancreas handles both digestion and immunity. It is the organ AHPND attacks.

EHP multiplies inside its cells. Digestion and nutrient absorption fall, so the same amount of feed does not turn into flesh. That is where "eating but not growing" comes from.

■ Findings that come with it

Stunted growth is the main sign, and these come alongside.

- White faeces — droppings look white and sometimes float
- Soft shells — they do not harden well after a moult
- Falling feed response — feed starts being left on the tray
- Size spread — animals stocked at the same time diverge widely

Size spread is the easiest to see. Sample and weigh, and the distribution is spread wide.

■ Confirmation only comes from a test

The signs above justify suspicion but do not confirm it. White faeces has other causes, and stunted growth can come from feed, water quality or density.

Confirmation is a PCR test. Regional fisheries institutes and diagnostic services can run it, so if growth has been flat for weeks it is worth testing. The test costs less than feeding on without knowing the cause.

■ There is no cure

EHP has no treatment. So there are only two responses.

First, keep it out. Use tested seed and prepare the pond properly before stocking. EHP spores persist in the environment for a long time.

Second, if it is confirmed, stop it spreading. It moves through water and equipment. Use separate equipment per zone and check your drainage routes.

■ You have to decide whether to keep going

If EHP is confirmed and growth has stopped, continuing is often a loss. The feed bill keeps running while the weight does not.

Do not decide emotionally. Put the recent daily growth rate against the feed cost for the remaining period and the answer appears.

■ Records make early detection possible

EHP has no dramatic signs, so it is hard to catch without records. Sample regularly, weigh the average, and write down the daily growth rate.

If what used to grow at 0.15 g/day drops to 0.05 g/day, that is your starting point. Put it beside the feed record and "eating but not growing" becomes a number.

Shrimp365 logs average weight and feed rate per tank and draws the daily growth rate. Free to use.$cn$,
  array[
    $cn$/cardnews/en/ehp-slow-growth/01.png$cn$, $cn$/cardnews/en/ehp-slow-growth/02.png$cn$,
    $cn$/cardnews/en/ehp-slow-growth/03.png$cn$, $cn$/cardnews/en/ehp-slow-growth/04.png$cn$,
    $cn$/cardnews/en/ehp-slow-growth/05.png$cn$, $cn$/cardnews/en/ehp-slow-growth/06.png$cn$,
    $cn$/cardnews/en/ehp-slow-growth/07.png$cn$, $cn$/cardnews/en/ehp-slow-growth/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/ehp-slow-growth/01.png$cn$,
  array[
    $cn$EHP$cn$, $cn$disease management$cn$, $cn$growth rate$cn$, $cn$feed management$cn$,
    $cn$hepatopancreas$cn$, $cn$pond management$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-16 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$ehp-slow-growth$cn$,
  $cn$vi$cn$,
  $cn$EHP — Tôm không chết mà cũng không lớn$cn$,
  $cn$Không hao hụt mà mấy tuần liền cỡ tôm không nhúc nhích thì hãy nghi EHP. Đây là vi bào tử trùng đi vào gan tụy, được ghi nhận làm giảm 10–20% sản lượng năm ở châu Á. Không có thuốc chữa.$cn$,
  $cn$Gần như không có tôm chết. Chất lượng nước bình thường. Vậy mà mấy tuần liền cỡ tôm không nhúc nhích, và chênh lệch giữa con lớn nhất với con nhỏ nhất trong cùng một lứa ngày càng rộng. Lúc này phải kiểm tra EHP.

■ Không phải bệnh giết, mà là bệnh làm còi

EHP (Enterocytozoon hepatopenaei) là một loại vi bào tử trùng ký sinh. Nó vào gan tụy của tôm thẻ chân trắng và trú ở đó.

Đặc điểm của bệnh này là không gây chết hàng loạt. Vì vậy mà phát hiện muộn. AHPND làm sập ao trong vài ngày nên nhận ra ngay, còn EHP thì âm thầm chỉ làm tiền cám chất chồng.

Ở các nước nuôi tôm lớn tại châu Á, EHP được ghi nhận làm giảm 10 đến 20% sản lượng mỗi năm. Ở Hàn Quốc cũng đã có báo cáo phát hiện trên tôm thẻ.

■ Đích là gan tụy — cùng cơ quan với AHPND

Gan tụy đảm nhiệm cả tiêu hóa lẫn miễn dịch. Đó là cơ quan mà AHPND tấn công.

EHP nhân lên bên trong tế bào của cơ quan này. Tiêu hóa và hấp thu dinh dưỡng kém đi nên ăn cùng một lượng mà không thành thịt. Tình trạng "ăn mà không lớn" ra đời từ đây.

■ Những biểu hiện đi kèm

Chậm lớn là triệu chứng chính, và bên cạnh đó có mấy thứ nữa.

- Phân trắng — phân có màu trắng, đôi khi nổi lên mặt nước
- Vỏ mềm — lột xong vỏ không cứng lại tốt
- Phản ứng bắt mồi giảm — sàng ăn bắt đầu còn thừa
- Chênh cỡ — thả cùng lúc mà khác biệt giữa các con ngày càng lớn

Chênh cỡ là dấu hiệu dễ thấy nhất. Vớt mẫu lên cân thì thấy phân bố trải rất rộng.

■ Chỉ xét nghiệm mới xác định được

Những dấu hiệu trên đủ để nghi ngờ nhưng không xác định được. Phân trắng còn do nguyên nhân khác, và chậm lớn cũng có thể do thức ăn, nước hay mật độ.

Xác định bằng xét nghiệm PCR. Cơ quan thủy sản địa phương hoặc dịch vụ chẩn đoán có thể làm được, nên nếu tôm không lớn suốt mấy tuần thì nên đi xét nghiệm. Tiền xét nghiệm rẻ hơn tiền cám đổ vào mà không biết nguyên nhân.

■ Không có thuốc chữa

EHP không có thuốc điều trị. Nên chỉ có hai hướng đối phó.

Thứ nhất, không cho nó vào. Dùng giống đã qua kiểm tra và chuẩn bị ao cho tử tế trước khi thả. Bào tử EHP tồn tại rất lâu trong môi trường.

Thứ hai, nếu đã xác định thì chặn lây lan. Nó lây qua nước và dụng cụ. Hãy dùng dụng cụ riêng cho từng khu và kiểm tra đường thoát nước.

■ Phải quyết định có nuôi tiếp hay không

Nếu đã xác định EHP mà tôm ngừng lớn thì nuôi tiếp thường là lỗ. Tiền cám vẫn chạy mà trọng lượng không tăng.

Đừng quyết định theo cảm tính. Đặt tốc độ lớn mỗi ngày gần đây cạnh tiền cám cho quãng thời gian còn lại, câu trả lời sẽ hiện ra.

■ Ghi chép tạo ra phát hiện sớm

EHP không có dấu hiệu rõ rệt nên không ghi chép thì rất khó nhận ra. Hãy định kỳ vớt mẫu, cân trọng lượng bình quân và ghi tốc độ lớn mỗi ngày.

Trước lớn 0,15 g/ngày mà nay chỉ còn 0,05 g/ngày thì đó chính là điểm bắt đầu. Đặt cạnh ghi chép lượng cho ăn thì "ăn mà không lớn" hiện ra thành con số.

Shrimp365 ghi trọng lượng bình quân và lượng cho ăn theo từng ao rồi vẽ ra tốc độ lớn mỗi ngày. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/ehp-slow-growth/01.png$cn$, $cn$/cardnews/vi/ehp-slow-growth/02.png$cn$,
    $cn$/cardnews/vi/ehp-slow-growth/03.png$cn$, $cn$/cardnews/vi/ehp-slow-growth/04.png$cn$,
    $cn$/cardnews/vi/ehp-slow-growth/05.png$cn$, $cn$/cardnews/vi/ehp-slow-growth/06.png$cn$,
    $cn$/cardnews/vi/ehp-slow-growth/07.png$cn$, $cn$/cardnews/vi/ehp-slow-growth/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/ehp-slow-growth/01.png$cn$,
  array[
    $cn$EHP$cn$, $cn$quản lý dịch bệnh$cn$, $cn$tốc độ lớn$cn$, $cn$quản lý thức ăn$cn$,
    $cn$gan tụy$cn$, $cn$quản lý ao$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-16 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$ehp-slow-growth$cn$,
  $cn$id$cn$,
  $cn$EHP — Udang yang Tidak Mati tapi Tidak Besar$cn$,
  $cn$Tidak ada kematian tapi ukurannya tidak bergerak berminggu-minggu — curigai EHP. Mikrosporidia yang masuk ke hepatopankreas, dilaporkan memangkas produksi tahunan Asia 10–20%. Tidak ada obatnya.$cn$,
  $cn$Hampir tidak ada kematian. Kualitas air normal. Namun ukurannya tidak bergerak berminggu-minggu, dan jarak antara yang terbesar dan terkecil dari tebaran yang sama terus melebar. Saat itulah EHP perlu diperiksa.

■ Bukan pembunuh, melainkan pengerdil

EHP (Enterocytozoon hepatopenaei) adalah parasit mikrosporidia. Ia bersarang di hepatopankreas udang vaname.

Ciri penyakit ini adalah tidak menyebabkan kematian massal. Karena itu terlambat ditemukan. AHPND meruntuhkan tambak dalam hitungan hari sehingga langsung disadari; EHP diam-diam hanya menumpuk biaya pakan.

Di negara-negara produsen utama Asia, EHP dilaporkan menurunkan produksi tahunan sebesar 10 sampai 20%. Deteksi pada udang vaname juga telah dilaporkan di Korea.

■ Sasarannya hepatopankreas — organ yang sama dengan AHPND

Hepatopankreas menangani pencernaan sekaligus kekebalan. Itulah organ yang diserang AHPND.

EHP berkembang biak di dalam sel organ itu. Pencernaan dan penyerapan nutrisi menurun, sehingga pakan dalam jumlah sama tidak menjadi daging. Dari sinilah muncul keadaan "makan tapi tidak besar".

■ Temuan yang menyertainya

Pertumbuhan kerdil adalah gejala utamanya, dan berikut yang menyertai.

- Feses putih — kotorannya tampak putih dan kadang mengapung
- Kulit lunak — tidak mengeras dengan baik setelah ganti kulit
- Respons makan menurun — pakan mulai bersisa di anco
- Selisih ukuran — ditebar bersamaan tapi perbedaannya melebar jauh

Selisih ukuran paling mudah dilihat. Ambil sampel lalu timbang, dan sebarannya melebar.

■ Kepastian hanya dari uji

Tanda-tanda di atas cukup untuk mencurigai tetapi tidak memastikan. Feses putih punya penyebab lain, dan pertumbuhan kerdil bisa datang dari pakan, kualitas air, atau kepadatan.

Kepastiannya adalah uji PCR. Dinas perikanan setempat atau layanan diagnostik bisa menjalankannya, jadi kalau pertumbuhan datar berminggu-minggu sebaiknya diuji. Biaya ujinya lebih murah daripada terus memberi pakan tanpa tahu penyebabnya.

■ Tidak ada obatnya

EHP tidak punya pengobatan. Jadi hanya ada dua respons.

Pertama, jangan biarkan masuk. Pakai benur yang sudah diuji dan siapkan tambak dengan benar sebelum tebar. Spora EHP bertahan lama di lingkungan.

Kedua, kalau sudah terkonfirmasi, hentikan penyebarannya. Ia berpindah lewat air dan peralatan. Pakai peralatan terpisah per zona dan periksa jalur pembuangan Anda.

■ Anda harus memutuskan lanjut atau tidak

Kalau EHP terkonfirmasi dan pertumbuhan berhenti, melanjutkan sering berarti rugi. Biaya pakan terus berjalan sementara bobotnya tidak.

Jangan memutuskan secara emosional. Sandingkan laju tumbuh harian terakhir dengan biaya pakan untuk sisa periode, maka jawabannya muncul.

■ Catatan memungkinkan deteksi dini

EHP tidak punya tanda yang mencolok sehingga sulit tertangkap tanpa catatan. Ambil sampel secara berkala, timbang bobot rata-rata, dan catat laju tumbuh hariannya.

Kalau yang biasanya tumbuh 0,15 g/hari turun menjadi 0,05 g/hari, di situlah titik mulanya. Sandingkan dengan catatan pakan maka "makan tapi tidak besar" berubah menjadi angka.

Shrimp365 mencatat bobot rata-rata dan jumlah pakan per petak lalu menggambar laju tumbuh hariannya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/ehp-slow-growth/01.png$cn$, $cn$/cardnews/id/ehp-slow-growth/02.png$cn$,
    $cn$/cardnews/id/ehp-slow-growth/03.png$cn$, $cn$/cardnews/id/ehp-slow-growth/04.png$cn$,
    $cn$/cardnews/id/ehp-slow-growth/05.png$cn$, $cn$/cardnews/id/ehp-slow-growth/06.png$cn$,
    $cn$/cardnews/id/ehp-slow-growth/07.png$cn$, $cn$/cardnews/id/ehp-slow-growth/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/ehp-slow-growth/01.png$cn$,
  array[
    $cn$EHP$cn$, $cn$manajemen penyakit$cn$, $cn$laju pertumbuhan$cn$, $cn$manajemen pakan$cn$,
    $cn$hepatopankreas$cn$, $cn$manajemen tambak$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-16 09:00:00+09$cn$::timestamptz
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
