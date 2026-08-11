-- ============================================================
-- 카드뉴스 — 알칼리도와 경도 (en / vi / id) · 2026-08-11
--
-- 한국어판과 같은 slug("alkalinity-hardness")를 쓰고 locale만 다르게 넣는다.
-- 그래야 hreflangMap()이 언어 간 링크를 만든다. 수치는 네 언어가 동일하다.
--
-- 이미지: public/cardnews/<locale>/alkalinity-hardness/01..08.png
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
  $cn$alkalinity-hardness$cn$,
  $cn$en$cn$,
  $cn$Alkalinity and Hardness — Where to Look When pH Swings$cn$,
  $cn$If pH moves a lot within a single day, alkalinity is short. Here is the 100–150 mg/L target, why nitrification eats alkalinity, and the calcium to magnesium ratio that builds shells.$cn$,
  $cn$pH swings widely through the day. Ammonia will not come down however much probiotic you add. Shells do not harden properly after a moult. These look like three separate problems, but they often point at the same place — alkalinity and hardness.

■ Alkalinity is what holds pH in place

Alkalinity is how well the water resists a shift toward acid. That is what buffering capacity means.

With enough alkalinity, pH stays put whether plankton photosynthesise by day or respire by night. Without it, the same conditions push pH up and down across the day.

So when the swing grows, looking only at pH is the wrong order. Measure alkalinity first.

■ The target — 100 to 150 mg/L

For white shrimp, manage alkalinity between 100 and 150 mg/L.

Inside that band the daily pH swing stays under 0.5. Below it, pH starts to move, and heavy rain or a water exchange moves it further.

Measure at least weekly. It does not need to be daily, but the value falls as the cycle proceeds, so you need the trend.

■ Nitrification consumes alkalinity

This is the most commonly missed part. Taking ammonia through to nitrate consumes alkalinity — roughly 7.14 g per 1 g of ammonia.

So the heavier the nitrogen load, the faster alkalinity falls. Alkalinity dropping late in the cycle is not a fault; it is nitrification doing its job.

The problem is what happens when it runs out. Nitrification slows or stops, and then ammonia will not come down. No amount of probiotic helps in that state.

■ Hardness — the material for shells

Hardness is the calcium and magnesium dissolved in the water. It is often confused with alkalinity but it is a different thing. Alkalinity resists pH change; hardness builds shells.

Shrimp make a new shell at every moult, and they take the material from the water. With low hardness the shell does not harden properly, and some animals start a moult they cannot finish.

■ Calcium to magnesium — 1 : 3

The ratio matters more than the absolute amount. Magnesium at roughly three times calcium is the composition reported to suit white shrimp.

Seawater is naturally close to that ratio. The problem cases are farms using groundwater or running low salinity. That water is often short of magnesium relative to calcium, so total hardness can look adequate while moulting still goes badly.

If you run low salinity, do not read total hardness alone — measure calcium and magnesium separately.

■ When does it fall

It falls as the cycle proceeds, because nitrification keeps spending it.

It falls after heavy rain too. Rainwater carries neither alkalinity nor hardness, so it simply dilutes both. A large water exchange does the same, so check the incoming water first.

■ Records matter more than thresholds

Write alkalinity down once a week and you will see how fast it falls on your farm. Knowing that rate lets you top it up before it bottoms out. Measuring after an accident and knowing the trend are not the same thing.

Shrimp365 logs alkalinity, pH and ammonia together per tank so you can see how the three move against each other. Free to use.$cn$,
  array[
    $cn$/cardnews/en/alkalinity-hardness/01.png$cn$, $cn$/cardnews/en/alkalinity-hardness/02.png$cn$,
    $cn$/cardnews/en/alkalinity-hardness/03.png$cn$, $cn$/cardnews/en/alkalinity-hardness/04.png$cn$,
    $cn$/cardnews/en/alkalinity-hardness/05.png$cn$, $cn$/cardnews/en/alkalinity-hardness/06.png$cn$,
    $cn$/cardnews/en/alkalinity-hardness/07.png$cn$, $cn$/cardnews/en/alkalinity-hardness/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/alkalinity-hardness/01.png$cn$,
  array[
    $cn$alkalinity$cn$, $cn$hardness$cn$, $cn$pH$cn$, $cn$molting$cn$,
    $cn$nitrification$cn$, $cn$water quality$cn$, $cn$white shrimp$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-11 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$alkalinity-hardness$cn$,
  $cn$vi$cn$,
  $cn$Độ kiềm và độ cứng — Nhìn vào đâu khi pH dao động$cn$,
  $cn$Nếu pH lên xuống mạnh trong ngày thì độ kiềm đang thiếu. Bài này nói về ngưỡng 100–150 mg/L, vì sao nitrat hóa ăn mất độ kiềm, và tỉ lệ canxi với magie để tạo vỏ.$cn$,
  $cn$pH lên xuống mạnh trong ngày. Đổ men vi sinh bao nhiêu amoniac cũng không hạ. Lột xong vỏ không cứng lại được. Nhìn thì như ba vấn đề khác nhau, nhưng thường cùng chỉ về một chỗ — độ kiềm và độ cứng.

■ Độ kiềm là thứ giữ pH đứng yên

Độ kiềm cho biết nước chịu được bao nhiêu khi bị đẩy về phía axit. Đó chính là khả năng đệm.

Đủ độ kiềm thì ban ngày tảo quang hợp hay ban đêm hô hấp, pH vẫn không dao động nhiều. Thiếu độ kiềm thì cùng điều kiện ấy pH sẽ lên xuống suốt ngày.

Nên khi biên độ rộng ra mà chỉ nhìn pH là sai thứ tự. Hãy đo độ kiềm trước.

■ Ngưỡng — 100 đến 150 mg/L

Với tôm thẻ chân trắng, quản lý độ kiềm trong khoảng 100 đến 150 mg/L.

Trong khoảng này biên độ pH trong ngày nằm dưới 0,5. Thấp hơn thì pH bắt đầu dao động, và mưa lớn hay thay nước sẽ đẩy nó đi xa hơn.

Đo ít nhất tuần một lần. Không cần đo hằng ngày, nhưng giá trị sẽ tụt dần theo vụ nuôi nên phải nắm được xu hướng.

■ Nitrat hóa ăn mất độ kiềm

Đây là phần hay bị bỏ sót nhất. Đưa amoniac đi hết đường tới nitrat sẽ tốn độ kiềm — khoảng 7,14 g cho mỗi 1 g amoniac.

Nên ao nào tải đạm càng lớn thì độ kiềm tụt càng nhanh. Cuối vụ độ kiềm giảm không phải là hỏng, mà là nitrat hóa đang làm việc.

Vấn đề là khi nó cạn. Nitrat hóa chậm lại hoặc dừng hẳn, và khi đó amoniac không hạ nữa. Ở trạng thái ấy đổ bao nhiêu men cũng vô ích.

■ Độ cứng — nguyên liệu tạo vỏ

Độ cứng là lượng canxi và magie hòa tan trong nước. Hay bị lẫn với độ kiềm nhưng là hai thứ khác nhau. Độ kiềm chống lại thay đổi pH, còn độ cứng là nguyên liệu tạo vỏ.

Mỗi lần lột tôm phải tạo vỏ mới, và lấy nguyên liệu từ nước. Độ cứng thấp thì vỏ không cứng lại được, có con bắt đầu lột mà không lột xong nổi.

■ Canxi và magie — 1 : 3

Tỉ lệ quan trọng hơn lượng tuyệt đối. Magie gấp khoảng ba lần canxi là cấu tạo được ghi nhận là phù hợp với tôm thẻ.

Nước biển vốn đã gần tỉ lệ này. Chỗ hay có vấn đề là ao dùng nước ngầm hoặc nuôi độ mặn thấp. Nước đó thường thiếu magie so với canxi, nên tổng độ cứng trông đủ mà tôm vẫn lột kém.

Nếu nuôi độ mặn thấp thì đừng chỉ xem tổng độ cứng — hãy đo riêng canxi và magie.

■ Khi nào thì tụt

Tụt dần theo vụ nuôi, vì nitrat hóa cứ tiêu độ kiềm.

Sau mưa lớn cũng tụt. Nước mưa không có độ kiềm cũng không có độ cứng nên chỉ làm loãng cả hai. Thay nước nhiều cũng vậy, nên hãy kiểm tra nước mới trước đã.

■ Ghi chép quan trọng hơn ngưỡng

Ghi độ kiềm mỗi tuần một lần thì sẽ thấy ao mình tụt nhanh chậm ra sao. Biết tốc độ đó thì bổ sung được trước khi cạn. Đo sau khi có sự cố và nắm được xu hướng là hai chuyện hoàn toàn khác.

Shrimp365 ghi độ kiềm, pH và amoniac cùng lúc theo từng ao để bạn thấy quan hệ giữa ba thứ đó. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/alkalinity-hardness/01.png$cn$, $cn$/cardnews/vi/alkalinity-hardness/02.png$cn$,
    $cn$/cardnews/vi/alkalinity-hardness/03.png$cn$, $cn$/cardnews/vi/alkalinity-hardness/04.png$cn$,
    $cn$/cardnews/vi/alkalinity-hardness/05.png$cn$, $cn$/cardnews/vi/alkalinity-hardness/06.png$cn$,
    $cn$/cardnews/vi/alkalinity-hardness/07.png$cn$, $cn$/cardnews/vi/alkalinity-hardness/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/alkalinity-hardness/01.png$cn$,
  array[
    $cn$độ kiềm$cn$, $cn$độ cứng$cn$, $cn$pH$cn$, $cn$lột xác$cn$,
    $cn$nitrat hóa$cn$, $cn$chất lượng nước$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-11 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$alkalinity-hardness$cn$,
  $cn$id$cn$,
  $cn$Alkalinitas dan Kesadahan — Ke Mana Melihat Saat pH Goyah$cn$,
  $cn$Kalau pH banyak bergerak dalam sehari, alkalinitasnya kurang. Berikut patokan 100–150 mg/L, kenapa nitrifikasi memakan alkalinitas, dan rasio kalsium terhadap magnesium untuk kulit.$cn$,
  $cn$pH naik turun tajam sepanjang hari. Amonia tidak mau turun sebanyak apa pun probiotik ditebar. Kulit tidak mengeras setelah ganti kulit. Kelihatannya tiga masalah berbeda, tetapi sering menunjuk ke tempat yang sama — alkalinitas dan kesadahan.

■ Alkalinitas adalah penahan pH

Alkalinitas menunjukkan seberapa kuat air menahan pergeseran ke arah asam. Itulah yang disebut daya penyangga.

Dengan alkalinitas cukup, pH tetap stabil baik saat plankton berfotosintesis siang hari maupun bernapas malam hari. Tanpa itu, kondisi yang sama membuat pH naik turun sepanjang hari.

Jadi saat ayunannya melebar, hanya melihat pH itu urutan yang salah. Ukur alkalinitas lebih dulu.

■ Patokan — 100 sampai 150 mg/L

Untuk udang vaname, kelola alkalinitas antara 100 dan 150 mg/L.

Di dalam rentang itu ayunan pH harian tetap di bawah 0,5. Di bawahnya, pH mulai bergerak, dan hujan deras atau ganti air akan menggerakkannya lebih jauh.

Ukur minimal seminggu sekali. Tidak perlu harian, tetapi nilainya turun seiring berjalannya siklus sehingga trennya harus terlihat.

■ Nitrifikasi memakan alkalinitas

Ini bagian yang paling sering terlewat. Membawa amonia sampai menjadi nitrat menghabiskan alkalinitas — sekitar 7,14 g per 1 g amonia.

Jadi makin berat beban nitrogennya, makin cepat alkalinitas turun. Alkalinitas yang menurun di fase akhir bukan kerusakan, melainkan tanda nitrifikasi sedang bekerja.

Masalahnya saat ia habis. Nitrifikasi melambat atau berhenti, dan amonia pun tidak turun lagi. Dalam keadaan itu berapa pun probiotik ditebar tidak berguna.

■ Kesadahan — bahan pembentuk kulit

Kesadahan adalah kalsium dan magnesium yang terlarut di air. Sering tertukar dengan alkalinitas padahal berbeda. Alkalinitas menahan perubahan pH, kesadahan membentuk kulit.

Setiap ganti kulit udang membuat kulit baru, dan bahannya diambil dari air. Kalau kesadahan rendah, kulit tidak mengeras dengan baik dan ada yang mulai ganti kulit tapi tidak sanggup menyelesaikannya.

■ Kalsium dan magnesium — 1 : 3

Rasionya lebih penting daripada jumlah mutlaknya. Magnesium sekitar tiga kali kalsium adalah komposisi yang dilaporkan cocok untuk udang vaname.

Air laut memang sudah mendekati rasio itu. Yang bermasalah adalah tambak yang memakai air tanah atau bersalinitas rendah. Air seperti itu sering kekurangan magnesium dibanding kalsium, sehingga total kesadahan terlihat cukup tapi ganti kulit tetap buruk.

Kalau memelihara di salinitas rendah, jangan hanya membaca total kesadahan — ukur kalsium dan magnesium terpisah.

■ Kapan turunnya

Turun seiring berjalannya siklus, karena nitrifikasi terus memakainya.

Turun juga setelah hujan deras. Air hujan tidak membawa alkalinitas maupun kesadahan sehingga hanya mengencerkan keduanya. Ganti air dalam jumlah besar sama saja, jadi periksa dulu air yang akan masuk.

■ Catatan lebih penting daripada angka batas

Catat alkalinitas seminggu sekali maka akan terlihat seberapa cepat turunnya di tambak Anda. Mengetahui laju itu memungkinkan Anda menambahnya sebelum habis. Mengukur setelah kecelakaan dan mengetahui trennya adalah dua hal berbeda.

Shrimp365 mencatat alkalinitas, pH, dan amonia bersama per petak agar hubungan ketiganya terlihat sekaligus. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/alkalinity-hardness/01.png$cn$, $cn$/cardnews/id/alkalinity-hardness/02.png$cn$,
    $cn$/cardnews/id/alkalinity-hardness/03.png$cn$, $cn$/cardnews/id/alkalinity-hardness/04.png$cn$,
    $cn$/cardnews/id/alkalinity-hardness/05.png$cn$, $cn$/cardnews/id/alkalinity-hardness/06.png$cn$,
    $cn$/cardnews/id/alkalinity-hardness/07.png$cn$, $cn$/cardnews/id/alkalinity-hardness/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/alkalinity-hardness/01.png$cn$,
  array[
    $cn$alkalinitas$cn$, $cn$kesadahan$cn$, $cn$pH$cn$, $cn$ganti kulit$cn$,
    $cn$nitrifikasi$cn$, $cn$kualitas air$cn$, $cn$udang vaname$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-11 09:00:00+09$cn$::timestamptz
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
