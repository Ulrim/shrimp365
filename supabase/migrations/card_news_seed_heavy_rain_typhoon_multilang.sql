-- ============================================================
-- 카드뉴스 — 태풍·집중호우 대비 (en / vi / id) · 2026-08-07
--
-- 한국어판과 같은 slug("heavy-rain-typhoon")를 쓰고 locale만 다르게 넣는다.
-- 이미지: public/cardnews/<locale>/heavy-rain-typhoon/01..08.png
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
  $cn$heavy-rain-typhoon$cn$,
  $cn$en$cn$,
  $cn$Typhoons and Heavy Rain — Losses Come the Day After$cn$,
  $cn$Rainwater does not mix in. It floats as a layer on top, and the bottom below it loses its oxygen supply. Here is what to do before, during and after the rain.$cn$,
  $cn$Mortality is found far more often on the morning after heavy rain than on the day itself. The rain does not kill the shrimp — the layer the rain creates cuts off oxygen overnight.

■ Rainwater floats, it does not mix

Rainwater carries no salt, so it is light. It does not blend in; it forms a thin freshwater layer at the surface. Mixing on its own takes hours.

Once that layer forms the pond splits. The surface has oxygen while the bottom's supply is cut off — and the bottom is where the shrimp are. Add an overcast sky, which weakens photosynthesis, and bottom oxygen hits the floor overnight.

■ Salinity — within 5 ppt a day

White shrimp live across 5 to 35 ppt. What matters is not the absolute value but the rate of change.

A swing beyond 5 ppt in one day is more than freshly moulted shrimp can take. Heavy rain is the classic event that crosses that line in a single go. Measure salinity again after the rain stops, and compare it against the reading from before.

■ Before the rain — lower things in advance

If you saw the forecast, cut the feed rate ahead of time. Shrimp eat less while it rains, and what is left decomposes on the bottom and burns oxygen.

Check alkalinity too. Holding 100 to 150 mg/L keeps pH from swinging much when rainwater arrives. Take heavy rain on low alkalinity and pH drops sharply, which is a burden by itself.

■ During the rain — do not stop the aerators

The most common mistake is switching aerators off while it rains. Do the opposite.

Aerators do not only add oxygen. They mix, which stops the layer from forming in the first place. Mixing before stratification sets is far easier than breaking it afterwards. Keep them running through the rain and for a while after it stops.

■ After the rain — drain from the surface

The fresh water is on top. So when you drain, take it from above, not below. Surface draining sends the freshwater layer out first and salinity recovers quickly.

Drain from the bottom and only the saltier water leaves while the fresh layer stays. Knowing where your outlet sits is half of heavy-rain preparation.

And watch the colour. Blooms often crash all at once after heavy rain. If the water suddenly cleared, that night is the dangerous one.

■ That night and the following dawn

Do not skip the pre-dawn measurement on a day with heavy rain. A layer formed, the bloom was shaken, and feed is sitting on the bottom. Someone needs to be at the pond between 4 and 6 in the morning, when oxygen bottoms out.

If shrimp are crowding near the surface or the pond edge, they are already short of oxygen. Run aerators at maximum and stop feeding at once.

■ Records prepare you for the next typhoon

Write down the date, the rainfall, and the salinity, pH, alkalinity and pre-dawn oxygen on either side of it. How hard heavy rain hits your pond, and how many days recovery takes, differs from farm to farm. Knowing that range changes how you read the next forecast.

Shrimp365 logs salinity, pH and dissolved oxygen per tank and alerts you the moment a value leaves its range. Free to use.$cn$,
  array[
    $cn$/cardnews/en/heavy-rain-typhoon/01.png$cn$, $cn$/cardnews/en/heavy-rain-typhoon/02.png$cn$,
    $cn$/cardnews/en/heavy-rain-typhoon/03.png$cn$, $cn$/cardnews/en/heavy-rain-typhoon/04.png$cn$,
    $cn$/cardnews/en/heavy-rain-typhoon/05.png$cn$, $cn$/cardnews/en/heavy-rain-typhoon/06.png$cn$,
    $cn$/cardnews/en/heavy-rain-typhoon/07.png$cn$, $cn$/cardnews/en/heavy-rain-typhoon/08.png$cn$
  ]::text[],
  $cn$/cardnews/en/heavy-rain-typhoon/01.png$cn$,
  array[
    $cn$typhoon$cn$, $cn$heavy rain$cn$, $cn$salinity$cn$, $cn$water quality$cn$,
    $cn$dissolved oxygen$cn$, $cn$white shrimp$cn$, $cn$pond management$cn$, $cn$shrimp farming$cn$
  ]::text[],
  true,
  $cn$2026-08-07 09:00:00+09$cn$::timestamptz
),

-- ── Tiếng Việt ─────────────────────────────────────────────
(
  $cn$heavy-rain-typhoon$cn$,
  $cn$vi$cn$,
  $cn$Ứng phó bão và mưa lớn — Hôm sau mưa tôm mới chết$cn$,
  $cn$Nước mưa không trộn vào mà nổi thành một lớp ở trên, và tầng đáy bên dưới bị cắt nguồn oxy. Bài này chia rõ việc phải làm trước, trong và sau khi mưa.$cn$,
  $cn$Tôm chết thường được phát hiện vào sáng hôm sau chứ không phải ngay ngày mưa. Không phải mưa giết tôm, mà là lớp nước do mưa tạo ra đã cắt oxy suốt đêm.

■ Nước mưa nổi lên chứ không trộn vào

Nước mưa không có muối nên nhẹ. Rơi xuống ao, nó không trộn ngay mà tạo một lớp nước ngọt mỏng ở tầng mặt. Tự trộn được phải mất vài giờ.

Khi lớp đó hình thành thì trên dưới tách hẳn. Tầng mặt có oxy còn tầng đáy bị cắt nguồn — mà tôm chủ yếu nằm ở đáy. Thêm trời âm u làm quang hợp yếu đi thì oxy đáy sẽ chạm đáy suốt đêm.

■ Độ mặn — trong phạm vi 5 ppt một ngày

Tôm thẻ sống được trong khoảng 5 đến 35 ppt. Quan trọng không phải giá trị tuyệt đối mà là tốc độ thay đổi.

Đổi quá 5 ppt trong một ngày là quá sức với tôm vừa lột. Mưa lớn chính là sự kiện điển hình vượt ngưỡng đó chỉ trong một lần. Mưa tạnh phải đo lại độ mặn, và so với số đo trước khi mưa mới biết đã dịch chuyển bao nhiêu.

■ Trước khi mưa — hạ trước một bước

Thấy dự báo rồi thì giảm lượng cho ăn từ trước. Trời mưa tôm ăn ít đi, phần thừa lắng xuống đáy phân hủy và tiêu oxy.

Kiểm tra cả độ kiềm. Giữ được 100 đến 150 mg/L thì nước mưa vào pH cũng không dao động nhiều. Độ kiềm thấp mà gặp mưa lớn thì pH tụt mạnh, bản thân điều đó đã là gánh nặng cho tôm.

■ Đang mưa — đừng tắt quạt

Sai lầm hay gặp nhất là tắt quạt trong lúc mưa. Phải làm ngược lại.

Quạt không chỉ đưa oxy vào. Nó trộn nước, tức là chặn ngay từ đầu việc hình thành lớp. Trộn trước khi phân tầng dễ hơn nhiều so với phá lớp đã hình thành. Hãy chạy suốt lúc mưa và một lúc sau khi tạnh.

■ Mưa tạnh — xả từ tầng mặt

Nước ngọt đang nằm ở trên. Nên khi xả phải xả từ trên chứ không phải từ dưới. Xả tầng mặt đẩy lớp nước ngọt ra trước thì độ mặn hồi lại nhanh.

Xả từ đáy thì chỉ có nước mặn phía dưới đi ra còn nước ngọt vẫn nằm nguyên. Biết rõ vị trí cống xả là đã xong một nửa việc chuẩn bị cho mưa lớn.

Và hãy nhìn màu nước. Sau mưa lớn tảo hay sập cùng lúc. Nếu nước bỗng trong hẳn thì đêm đó là nguy hiểm nhất.

■ Đêm đó và rạng sáng hôm sau

Ngày có mưa lớn thì đừng bỏ buổi đo rạng sáng. Lớp nước đã hình thành, tảo đã bị lung lay, và đáy còn thức ăn thừa. Phải có người ra ao lúc 4 đến 6 giờ sáng, khi oxy thấp nhất.

Nếu tôm dồn lên gần mặt nước hoặc ra bờ ao thì đã thiếu oxy rồi. Lập tức chạy quạt hết công suất và ngừng cho ăn.

■ Ghi chép để chuẩn bị cho cơn bão sau

Hãy ghi ngày mưa, lượng mưa, cùng độ mặn, pH, độ kiềm và oxy rạng sáng trước và sau đó. Ao mình bị mưa lớn làm lung lay đến đâu, mất mấy ngày để hồi, mỗi ao mỗi khác. Biết được biên độ đó thì cách bạn đọc bản tin bão lần sau sẽ khác hẳn.

Shrimp365 ghi độ mặn, pH và oxy hòa tan theo từng ao, và báo ngay khi có chỉ số vượt ngưỡng. Hoàn toàn miễn phí.$cn$,
  array[
    $cn$/cardnews/vi/heavy-rain-typhoon/01.png$cn$, $cn$/cardnews/vi/heavy-rain-typhoon/02.png$cn$,
    $cn$/cardnews/vi/heavy-rain-typhoon/03.png$cn$, $cn$/cardnews/vi/heavy-rain-typhoon/04.png$cn$,
    $cn$/cardnews/vi/heavy-rain-typhoon/05.png$cn$, $cn$/cardnews/vi/heavy-rain-typhoon/06.png$cn$,
    $cn$/cardnews/vi/heavy-rain-typhoon/07.png$cn$, $cn$/cardnews/vi/heavy-rain-typhoon/08.png$cn$
  ]::text[],
  $cn$/cardnews/vi/heavy-rain-typhoon/01.png$cn$,
  array[
    $cn$bão$cn$, $cn$mưa lớn$cn$, $cn$độ mặn$cn$, $cn$chất lượng nước$cn$,
    $cn$oxy hòa tan$cn$, $cn$tôm thẻ chân trắng$cn$, $cn$quản lý ao$cn$, $cn$nuôi tôm$cn$
  ]::text[],
  true,
  $cn$2026-08-07 09:00:00+09$cn$::timestamptz
),

-- ── Bahasa Indonesia ───────────────────────────────────────
(
  $cn$heavy-rain-typhoon$cn$,
  $cn$id$cn$,
  $cn$Menghadapi Topan dan Hujan Deras — Kematian Datang Esok Harinya$cn$,
  $cn$Air hujan tidak menyatu, melainkan mengambang jadi lapisan di atas, dan dasar di bawahnya kehilangan pasokan oksigen. Berikut yang harus dilakukan sebelum, saat, dan sesudah hujan.$cn$,
  $cn$Kematian jauh lebih sering ditemukan pada pagi berikutnya, bukan pada hari hujannya. Bukan hujan yang membunuh udang, melainkan lapisan yang dibentuk hujan itu memutus oksigen sepanjang malam.

■ Air hujan mengambang, tidak menyatu

Air hujan tidak bergaram sehingga ringan. Begitu jatuh ke tambak, ia tidak langsung menyatu melainkan membentuk lapisan tawar tipis di permukaan. Menyatu dengan sendirinya butuh beberapa jam.

Begitu lapisan itu terbentuk, atas dan bawah terpisah. Permukaan punya oksigen sementara dasar terputus pasokannya — padahal di dasar itulah udang berada. Tambah langit mendung yang melemahkan fotosintesis, maka oksigen dasar akan habis sepanjang malam.

■ Salinitas — dalam rentang 5 ppt sehari

Udang vaname hidup di 5 sampai 35 ppt. Yang penting bukan nilai mutlaknya melainkan kecepatan perubahannya.

Berubah lebih dari 5 ppt dalam sehari tidak sanggup ditahan udang yang baru ganti kulit. Hujan deras adalah peristiwa khas yang melewati batas itu sekaligus. Setelah hujan reda, ukur ulang salinitas dan bandingkan dengan angka sebelum hujan.

■ Sebelum hujan — turunkan lebih dulu

Kalau sudah melihat prakiraan, kurangi jumlah pakan dari sebelumnya. Saat hujan udang makan lebih sedikit, dan sisanya mengendap di dasar, terurai, dan menghabiskan oksigen.

Periksa juga alkalinitas. Menjaga 100 sampai 150 mg/L membuat pH tidak banyak goyah saat air hujan masuk. Alkalinitas rendah lalu kena hujan deras akan membuat pH anjlok, dan itu sendiri sudah membebani udang.

■ Saat hujan — jangan matikan kincir

Kesalahan paling sering adalah mematikan kincir selagi hujan. Lakukan sebaliknya.

Kincir bukan hanya memasukkan oksigen. Ia mengaduk, sehingga mencegah lapisan terbentuk sejak awal. Mengaduk sebelum stratifikasi terjadi jauh lebih mudah daripada memecahnya setelah terbentuk. Jalankan terus selama hujan dan beberapa saat setelah reda.

■ Setelah hujan — buang dari permukaan

Air tawar berada di atas. Jadi saat membuang air, ambil dari atas, bukan dari bawah. Pembuangan permukaan mengeluarkan lapisan tawar lebih dulu sehingga salinitas cepat pulih.

Membuang dari dasar hanya mengeluarkan air asin di bawah sementara lapisan tawarnya tetap tinggal. Mengetahui letak saluran pembuangan sudah setengah dari persiapan menghadapi hujan deras.

Dan perhatikan warna airnya. Setelah hujan deras plankton sering runtuh sekaligus. Kalau air mendadak bening, malam itulah yang paling berbahaya.

■ Malam itu dan subuh berikutnya

Pada hari yang ada hujan deras, jangan lewatkan pengukuran menjelang subuh. Lapisan sudah terbentuk, plankton sudah tergoyang, dan pakan masih tertinggal di dasar. Harus ada orang di tambak pukul 4 sampai 6 pagi, saat oksigen berada di titik terendah.

Kalau udang berkumpul dekat permukaan atau di tepi tambak, itu sudah kekurangan oksigen. Segera jalankan kincir maksimal dan hentikan pakan.

■ Catatan menyiapkan Anda untuk topan berikutnya

Catat tanggal hujan, curah hujannya, serta salinitas, pH, alkalinitas, dan oksigen subuh sebelum dan sesudahnya. Seberapa goyah tambak Anda oleh hujan deras dan berapa hari pulihnya berbeda di tiap tambak. Mengetahui rentang itu akan mengubah cara Anda membaca prakiraan berikutnya.

Shrimp365 mencatat salinitas, pH, dan oksigen terlarut per petak, lalu memberi tahu begitu sebuah nilai keluar dari rentangnya. Gratis digunakan.$cn$,
  array[
    $cn$/cardnews/id/heavy-rain-typhoon/01.png$cn$, $cn$/cardnews/id/heavy-rain-typhoon/02.png$cn$,
    $cn$/cardnews/id/heavy-rain-typhoon/03.png$cn$, $cn$/cardnews/id/heavy-rain-typhoon/04.png$cn$,
    $cn$/cardnews/id/heavy-rain-typhoon/05.png$cn$, $cn$/cardnews/id/heavy-rain-typhoon/06.png$cn$,
    $cn$/cardnews/id/heavy-rain-typhoon/07.png$cn$, $cn$/cardnews/id/heavy-rain-typhoon/08.png$cn$
  ]::text[],
  $cn$/cardnews/id/heavy-rain-typhoon/01.png$cn$,
  array[
    $cn$topan$cn$, $cn$hujan deras$cn$, $cn$salinitas$cn$, $cn$kualitas air$cn$,
    $cn$oksigen terlarut$cn$, $cn$udang vaname$cn$, $cn$manajemen tambak$cn$, $cn$budidaya udang$cn$
  ]::text[],
  true,
  $cn$2026-08-07 09:00:00+09$cn$::timestamptz
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
