-- ============================================================
-- 카드뉴스 다국어 21건 등록 (영어·베트남어·인도네시아어 각 7건)
--
-- 한국어(card_news_seed_ko.sql)와 같은 slug를 쓴다 — 같은 slug + 다른 locale이
-- 서로의 다른 언어판으로 인식되어 hreflang으로 연결된다.
-- 이미지는 언어별 폴더(/cardnews/<lang>/<slug>/)의 정적 파일을 쓰므로
-- Storage 업로드가 필요 없다.
--
-- 실행 조건: card_news.sql 을 먼저 실행해야 한다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
-- ============================================================

insert into public.card_news (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values
  -- 영어(English)
  ($cn$water-quality-guide$cn$, $cn$en$cn$, $cn$Whiteleg Shrimp Water Quality Ranges — The Only Numbers You Need to Memorize$cn$, $cn$Temperature, pH, dissolved oxygen, salinity, ammonia and nitrite. The six daily water quality parameters for vannamei shrimp ponds, with target ranges.$cn$, $cn$In whiteleg shrimp (Litopenaeus vannamei) farming, most mortality starts with water quality rather than with a pathogen. When water quality collapses, immunity drops first — and disease walks in through that gap. Knowing your daily parameters and their target ranges is the foundation of everything else.

■ Temperature — target 28–32°C

Shrimp are ectothermic, so water temperature directly sets their metabolic rate. 28–32°C gives the best growth and feed conversion. Below 24°C they barely feed. Above 34°C oxygen demand rises sharply while the water's capacity to hold oxygen falls — a double risk. Keep the daily swing under 3°C.

■ pH — target 7.5–8.5

pH matters less on its own than through what it does to everything else, especially ammonia toxicity. At the same total ammonia concentration, the toxic un-ionized form (NH₃) is about 1.2% at pH 7.5 but roughly 11% at pH 8.5 — nearly a tenfold difference. A daily swing greater than 0.5 also signals a phytoplankton bloom that needs attention.

■ Dissolved oxygen (DO) — keep above 5 mg/L

This is the parameter that kills fastest. Growth stops below 4 mg/L, and a few hours below 2 mg/L leads directly to mass mortality. Always measure between 04:00 and 06:00, the daily minimum. Plenty of ponds read 8 mg/L at midday and 2 mg/L before dawn.

■ Salinity — culturable at 5–35 ppt

The great advantage of vannamei is its wide salinity tolerance. Culture is possible from 5 to 35 ppt, with best growth around 15–25 ppt. What matters is not the absolute value but the rate of change: a shift of more than 5 ppt in one day will kill animals that have just molted. Always re-measure after water exchange or heavy rain.

■ Ammonia (NH₃) — below 0.1 mg/L

Produced as uneaten feed and waste break down. Above 0.1 mg/L you see gill damage and failed molts. As noted above, the higher the pH the more dangerous the same concentration becomes — so ammonia must always be read together with pH.

■ Nitrite (NO₂⁻) — below 1 mg/L

Formed at the intermediate step of ammonia breakdown. It blocks oxygen transport in shrimp blood, so with high nitrite the animals suffocate even when dissolved oxygen looks fine. It spikes most easily in new ponds or right after disinfection, before nitrifying bacteria are established.

■ Records matter more than reference ranges

Knowing your own pond's normal values beats memorizing textbook numbers. If DO was 6.2 yesterday and 5.1 today, you are still inside the range — but the trend is unmistakable. Accidents are announced when the trend begins, not when the threshold is crossed. Measure at the same time, at the same spot, every day, and write it down.

Shrimp365 records these six parameters per tank and alerts you the moment a value leaves its range. Free to use.$cn$, array[$cn$/cardnews/en/water-quality-guide/01.png$cn$,$cn$/cardnews/en/water-quality-guide/02.png$cn$,$cn$/cardnews/en/water-quality-guide/03.png$cn$,$cn$/cardnews/en/water-quality-guide/04.png$cn$,$cn$/cardnews/en/water-quality-guide/05.png$cn$,$cn$/cardnews/en/water-quality-guide/06.png$cn$,$cn$/cardnews/en/water-quality-guide/07.png$cn$,$cn$/cardnews/en/water-quality-guide/08.png$cn$]::text[], $cn$/cardnews/en/water-quality-guide/01.png$cn$, array[$cn$water quality$cn$,$cn$vannamei$cn$,$cn$dissolved oxygen$cn$,$cn$ammonia$cn$,$cn$salinity$cn$,$cn$shrimp farming$cn$]::text[], true, now() - interval '0 hours'),
  ($cn$dawn-oxygen-drop$cn$, $cn$en$cn$, $cn$Oxygen Bottoms Out at 4 AM — Never Trust a Daytime DO Reading$cn$, $cn$Dissolved oxygen that reads 8 mg/L at midday can fall to 2 mg/L before dawn. Why the pre-dawn oxygen crash happens and how to prepare for it.$cn$, $cn$You walk out in the morning and find dead shrimp — but yesterday's midday DO reading was 8 mg/L and looked perfectly fine. This is the single most common accident pattern in shrimp farming, and the cause is the midday reading itself.

■ How oxygen moves through the day

Pond oxygen is not steady; it swings hard. During daylight, phytoplankton photosynthesize and produce oxygen, peaking around 2–4 PM. Measure then and you get 8 mg/L, sometimes supersaturation.

After sunset photosynthesis stops, but the plankton, the shrimp and the microbes all keep respiring. For the whole night oxygen is only consumed, never produced. The result is the daily minimum just before sunrise, around 4–6 AM. A pond reading 8 mg/L at noon dropping to 2 mg/L at dawn is not unusual.

■ What makes it worse

The denser the plankton bloom, the higher the daytime peak — and the deeper the night-time low, because a bloom that produces a lot of oxygen also consumes a lot after dark. Deep green water is not reassurance; it is a reason to watch the dawn more closely.

Higher water temperature reduces how much oxygen the water can hold at all. Summer nights combine high consumption with low solubility — the worst pairing. High stocking density, a heavy feeding day, cloudy or rainy weather (weak photosynthesis) and a sudden plankton crash are all additional risk factors.

■ How to prepare

First, move your measurement to dawn. If you only measure once a day, that once must be at 4–6 AM. A midday value tells you almost nothing useful for management.

Second, run aerators from sunset through to after sunrise. The principle is to run them through the window when oxygen will fall, not to switch them on after it has already fallen.

Third, read the shrimp. If at dawn they gather near the surface or along the pond edge, oxygen is already short. At that point run aerators at maximum and stop feeding immediately — digestion consumes oxygen too.

Fourth, cut feed in advance when cloudy weather lasts more than two days. With photosynthesis weak, leftover feed consumes still more oxygen as it breaks down.

■ Records are what make prediction possible

Log dawn DO at the same time every day and you will see the minimum drifting down over several days. A run of 6.0 → 5.6 → 5.2 is still within range, but the next dawn is likely to reach the danger zone. Mortality looks sudden, but in ponds with records there was almost always a warning.

Shrimp365 stores your dawn readings per tank, plots the trend, and alerts you the moment a value drops below range.$cn$, array[$cn$/cardnews/en/dawn-oxygen-drop/01.png$cn$,$cn$/cardnews/en/dawn-oxygen-drop/02.png$cn$,$cn$/cardnews/en/dawn-oxygen-drop/03.png$cn$,$cn$/cardnews/en/dawn-oxygen-drop/04.png$cn$,$cn$/cardnews/en/dawn-oxygen-drop/05.png$cn$]::text[], $cn$/cardnews/en/dawn-oxygen-drop/01.png$cn$, array[$cn$dissolved oxygen$cn$,$cn$night mortality$cn$,$cn$aerator$cn$,$cn$plankton$cn$,$cn$shrimp farming$cn$,$cn$water quality$cn$]::text[], true, now() - interval '1 hours'),
  ($cn$ammonia-response$cn$, $cn$en$cn$, $cn$When Ammonia Rises — Five Things to Do, in Order$cn$, $cn$The same ammonia concentration is ten times more toxic at pH 8.5 than at pH 7.5. How to respond in the right order instead of panicking.$cn$, $cn$The most common mistake when ammonia exceeds its threshold is skipping steps — exchanging water before identifying the source, or dosing probiotics and waiting. Work through the following in order.

■ First understand this — pH decides ammonia toxicity

Your test kit usually reports total ammonia nitrogen (TAN). Only the un-ionized fraction (NH₃) is actually toxic to shrimp, and that fraction depends heavily on pH.

At the same total ammonia concentration, the toxic fraction is about 1.2% at pH 7.5 but rises to roughly 11% at pH 8.5 — nearly tenfold. So an ammonia number alone means nothing; you must read it with pH. The same 1 mg/L is comfortable in a pond at pH 7.5 and an emergency in a pond at pH 8.7.

■ Step 1 — Cut or stop feeding immediately

Ammonia comes mostly from uneaten feed and waste. Taking other measures without cutting the source is like bailing water with the tap still running. Stop feeding, or halve it, for at least a day — up to two if the reading is high. Shrimp survive several days without feed.

■ Step 2 — Check pH and bring it down if you can

If pH is above 8.5, that is now your most urgent problem. Manage CO₂ through aeration and stop any liming immediately. Bringing pH down to around 8.0 alone cuts actual toxicity by more than half. That said, sharp pH swings are themselves dangerous — never force a change greater than 0.3 in a day.

■ Step 3 — Push oxygen to maximum

Shrimp exposed to ammonia have damaged gills and reduced oxygen uptake. A DO level that would normally be fine is not enough now. Run aerators at full. Oxygen is also required for nitrifying bacteria to break the ammonia down.

■ Step 4 — Water exchange comes after that

Only now consider exchanging water. Never change more than 30% at once; do it in 20–30% portions. Always measure the incoming water's temperature, salinity and pH first and compare with the pond. Losing molting shrimp to a sudden salinity shift while chasing an ammonia number is a frequent accident.

■ Step 5 — Probiotics are prevention, not emergency medicine

Nitrifying bacteria take days to weeks to establish. This is not a product you dose today to lower today's reading. Probiotics work when applied routinely — especially when starting a new pond and right after disinfection — not after the incident.

■ Afterwards, always watch nitrite

Ammonia breaks down into nitrite. It is normal for nitrite to rise a few days after ammonia falls. Relaxing at this point invites a second incident. Check nitrite daily for a week after any ammonia event.

Shrimp365 records ammonia together with pH so you can judge real toxicity risk rather than a bare number.$cn$, array[$cn$/cardnews/en/ammonia-response/01.png$cn$,$cn$/cardnews/en/ammonia-response/02.png$cn$,$cn$/cardnews/en/ammonia-response/03.png$cn$,$cn$/cardnews/en/ammonia-response/04.png$cn$,$cn$/cardnews/en/ammonia-response/05.png$cn$,$cn$/cardnews/en/ammonia-response/06.png$cn$,$cn$/cardnews/en/ammonia-response/07.png$cn$,$cn$/cardnews/en/ammonia-response/08.png$cn$]::text[], $cn$/cardnews/en/ammonia-response/01.png$cn$, array[$cn$ammonia$cn$,$cn$pH$cn$,$cn$nitrite$cn$,$cn$water exchange$cn$,$cn$probiotics$cn$,$cn$shrimp farming$cn$]::text[], true, now() - interval '2 hours'),
  ($cn$ahpnd-early-signs$cn$, $cn$en$cn$, $cn$Early Signs of AHPND (EMS) — Look at the Hepatopancreas$cn$, $cn$AHPND can wipe out a whole pond within days of onset. The early signals you can catch, how to check, and what actually prevents it.$cn$, $cn$AHPND (acute hepatopancreatic necrosis disease, also called early mortality syndrome) is one of the most destructive diseases in whiteleg shrimp farming. It is caused by toxin-producing Vibrio strains, typically strikes 20–30 days after stocking, and once it starts it can take out an entire pond within days. There is no cure, so early detection and prevention are everything.

■ The first signal — reduced feed response

Check the feed tray: feed that normally disappears within the usual window starts being left behind. This arrives before anything shows in your water numbers, and only farms that check trays daily will catch it. If intake drops 20–30% for no obvious reason, sample shrimp and inspect them the same day.

■ Inspect the hepatopancreas directly

AHPND targets the hepatopancreas — the dark brown organ on the dorsal side of the head. Net a few animals, remove the shell, and compare by eye.

Healthy — deep brown or dark yellow-brown, full in size, with clearly defined edges.

Suspect — noticeably paler (light yellow, close to white), shrunken, and soft when pressed. In advanced cases black spots or streaks may appear.

■ Accompanying signs

The shell softens and the body becomes translucent. The midgut is empty, so the dark line running along the back is absent — direct evidence the shrimp are not feeding. Growth visibly lags and size becomes uneven. Dead animals are found mostly on the pond bottom.

■ Reducing the conditions is the only real defence

First, source post-larvae from screened suppliers. A large share of AHPND enters at the seed stage. Ask for and check PCR results before stocking.

Second, bottom management is the core. Bottoms loaded with organic matter are ideal for Vibrio. Dry and clean the bottom thoroughly between cycles. During culture, avoiding overfeeding is the most effective bottom management there is.

Third, do not push stocking density. Higher density raises stress and organic load together.

Fourth, apply beneficial microbes consistently to leave Vibrio less room to establish.

■ If you suspect it, decide on isolation immediately

Once confirmed in one pond, you must block transmission through water and equipment. Keep tools pond-specific and check your drainage routes. A day's delay in this decision costs you the neighbouring ponds.

■ Daily records are what make early detection possible

The first sign of AHPND is a drop in feed intake. Recording daily feed and leftovers turns "less than usual" from a hunch into a number. Shrimp365 keeps feeding and mortality records together so anomalies surface fast.

※ This is field-observation guidance and does not replace diagnosis. If you suspect AHPND, get PCR testing from an aquatic animal health laboratory.$cn$, array[$cn$/cardnews/en/ahpnd-early-signs/01.png$cn$,$cn$/cardnews/en/ahpnd-early-signs/02.png$cn$,$cn$/cardnews/en/ahpnd-early-signs/03.png$cn$,$cn$/cardnews/en/ahpnd-early-signs/04.png$cn$,$cn$/cardnews/en/ahpnd-early-signs/05.png$cn$,$cn$/cardnews/en/ahpnd-early-signs/06.png$cn$,$cn$/cardnews/en/ahpnd-early-signs/07.png$cn$]::text[], $cn$/cardnews/en/ahpnd-early-signs/01.png$cn$, array[$cn$AHPND$cn$,$cn$EMS$cn$,$cn$hepatopancreas$cn$,$cn$shrimp disease$cn$,$cn$vibrio$cn$,$cn$shrimp farming$cn$]::text[], true, now() - interval '3 hours'),
  ($cn$feeding-rate-calculation$cn$, $cn$en$cn$, $cn$Stop Feeding by Instinct — Here's How to Calculate It$cn$, $cn$Work out daily feed from biomass × feeding rate, then verify with the feed tray and adjust. Overfeeding wastes money and destroys water quality at once.$cn$, $cn$Feed is more than half of production cost. And every kilo left uneaten turns into ammonia and takes your water quality down with it. Guessing the feed amount loses you money and water simultaneously. Calculate, verify, adjust.

■ Step 1 — Calculate biomass

Biomass = surviving count × average body weight

Say you stocked 100,000 post-larvae and estimate 85% survival, leaving 85,000 animals. If a sample gives an average weight of 10 g:

85,000 × 10 g = 850,000 g = 850 kg

Survival is an estimate, so keep correcting it against feed tray response and mortality records.

■ Step 2 — Multiply by the feeding rate for that size

Feeding rate is daily feed as a percentage of biomass, and it falls as shrimp grow. Common guidance:

1–3 g — 8–6% of biomass
3–5 g — 6–5%
5–10 g — 5–4%
10–15 g — 4–3%
15–20 g — 3–2.5%
Over 20 g — 2.5–2%

For the example above (850 kg, average 10 g), applying 4%:

850 kg × 0.04 = 34 kg/day

That is the daily total, normally split across 4–5 feedings.

■ Step 3 — Always verify with the feed tray

The calculation is only a starting point. The real decision comes from the tray. Place 1–2% of each feeding in the tray and check after a set interval.

Empty at 2 hours — underfed. Increase 5–10% from the next feeding.
Emptied cleanly at 2–3 hours — correct. Hold.
Feed still left after 3 hours — overfed. Cut 10–20%.

■ When to cut immediately, regardless of the calculation

Water below 26°C, dissolved oxygen below 4 mg/L, a concentrated molting period, cloudy weather lasting more than two days, rising ammonia or nitrite, and any suspicion of disease. When shrimp are not eating, feeding to the calculation converts the entire ration into pollution.

■ Use FCR to check your management level

Feed conversion ratio (FCR) = total feed used ÷ total weight gained

1.2–1.5 means you are managing well. Above 1.8 means either overfeeding or a wrong survival estimate. FCR is not only an end-of-cycle number — calculating it mid-cycle tells you whether your current management is right.

■ No records, no calculation

Daily feed, leftovers, sample weights and mortality must all be recorded for the biomass estimate to be accurate — and only then does the calculation mean anything. Shrimp365 records these per tank and shows feeding trends alongside FCR.$cn$, array[$cn$/cardnews/en/feeding-rate-calculation/01.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/02.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/03.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/04.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/05.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/06.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/07.png$cn$,$cn$/cardnews/en/feeding-rate-calculation/08.png$cn$]::text[], $cn$/cardnews/en/feeding-rate-calculation/01.png$cn$, array[$cn$feeding rate$cn$,$cn$FCR$cn$,$cn$biomass$cn$,$cn$feed tray$cn$,$cn$feed management$cn$,$cn$shrimp farming$cn$]::text[], true, now() - interval '4 hours'),
  ($cn$mortality-diagnosis$cn$, $cn$en$cn$, $cn$Mortality Diagnosis Chart — Where They Died Tells You Why$cn$, $cn$Narrow down the cause from location, timing, shell condition and colour. Distinguishing low oxygen, disease, toxicity and molt failure.$cn$, $cn$When mortality happens, the priority is narrowing down the cause — because different causes call for opposite responses. Checking the following four things resolves most cases.

■ Check 1 — Where did they die?

Pond edges, near the surface — likely low oxygen or acute toxicity. The shrimp moved there because they were in distress.

Pond bottom — likely disease, especially a chronic progression such as AHPND. It means they lacked the strength to move at all.

Clustered around the aerators — low oxygen is close to certain.

■ Check 2 — When did they die?

Found at dawn or early morning — suspect low oxygen first. It matches the pattern of oxygen being consumed all night and bottoming out before sunrise.

Progressing during daylight — suspect a temperature spike, an inflow of toxic material, or an abrupt water quality change.

A few at a time over several days — disease or chronic water quality decline. A steady trickle of daily deaths is the most dangerous signal of all.

Right after water exchange or rain — a sudden shift in salinity or temperature, or contaminated inflow water.

■ Check 3 — What is the shell like?

Hard shell, intact body — an acute event. Low oxygen or toxicity. The animal was normal right up to death.

Soft shell, translucent body — chronic. Disease or nutrition. It had not been eating for some time.

Shell half shed — molt failure. Caused by insufficient salinity or minerals (calcium, magnesium) during the molt window, or by low oxygen mid-molt.

■ Check 4 — What about colour and hepatopancreas?

Body turned reddish — a sign of severe stress or acute infection.

Hepatopancreas pale and shrunken — strongly suspect AHPND. (See post 04.)

Black spots on the shell — bacterial shell disease or a fouled bottom.

Empty midgut (no dark line along the back) — they stopped eating some time ago. Points to disease.

■ Quick reference

Dawn + edges + hard shell → low oxygen
Bottom + over several days + pale hepatopancreas → disease such as AHPND
Molt period + half-shed shell → molt failure (minerals, oxygen)
Right after exchange + sudden and numerous → water quality shift or inflow problem
Daytime + abrupt + abnormal behaviour → toxic substance

■ Record mortality counts every day

"Feels like more than usual today" is only possible to judge if you have yesterday's numbers. If daily mortality goes from 5 to 12, it still looks small — but it has more than doubled, and that is the moment to act. Once mortality is visibly heavy, it is already too late.

Shrimp365 keeps mortality counts alongside water quality and feeding records, so you can look back and see which value moved first, before the deaths started climbing.$cn$, array[$cn$/cardnews/en/mortality-diagnosis/01.png$cn$,$cn$/cardnews/en/mortality-diagnosis/02.png$cn$,$cn$/cardnews/en/mortality-diagnosis/03.png$cn$,$cn$/cardnews/en/mortality-diagnosis/04.png$cn$,$cn$/cardnews/en/mortality-diagnosis/05.png$cn$,$cn$/cardnews/en/mortality-diagnosis/06.png$cn$,$cn$/cardnews/en/mortality-diagnosis/07.png$cn$]::text[], $cn$/cardnews/en/mortality-diagnosis/01.png$cn$, array[$cn$mortality$cn$,$cn$diagnosis$cn$,$cn$low oxygen$cn$,$cn$molting$cn$,$cn$shrimp disease$cn$,$cn$shrimp farming$cn$]::text[], true, now() - interval '5 hours'),
  ($cn$community-board-open$cn$, $cn$en$cn$, $cn$We've Opened a Shrimp Farming Community Board$cn$, $cn$A place to share field experience — water quality, disease, feeding, equipment. Readable without login; only posting requires an account.$cn$, $cn$Most problems on a shrimp farm are problems someone else has already faced. The trouble is that the experience stays in one person's memory and never reaches anyone else. So we opened a community board.

■ What gets discussed here

Water quality — dawn DO keeps falling; how many more aerators do I need? How does raw water salinity shift by season in your area?

Disease — the hepatopancreas looks like this, could it be AHPND? Has anyone seen these symptoms?

Feeding — what feeding rate are you running at this size? How do you adjust when the tray looks like this?

Equipment — which aerators are you using? Whose meters last?

Business — what FCR and survival did you get this cycle? How do you decide harvest timing?

■ You can attach photos

Post pictures of the shrimp, the water colour, the feed tray, the equipment, and you will get far more accurate answers. Hepatopancreas condition and shell state are hard to describe in words — one photo beats ten lines.

■ Readable without logging in

Anyone arriving from a search engine can read everything as-is. An account is needed only to post or comment, and you can sign up with email or straight through Kakao or Google.

■ Separated by language

Korean, English, Vietnamese and Indonesian users each see only posts written in their own language. You do not have to select anything — the language of your post is detected automatically.

■ A good way to start

If it is your first post, a question works better than an introduction. Write down whatever is bothering you most in your pond right now. Once answers arrive, the thread itself becomes material for the next person.

If you have already solved something, write up how. One "this happened, I did this, and this was the result" is more useful than ten textbook pages. Failures are worth exactly as much.

■ A few ground rules

Please do not attack specific products or companies. Fact-based reviews of what you actually used are welcome. If disease information is unconfirmed, say so explicitly — one wrong piece of information can cost another farm its pond.

The board is at www.shrimp365.kr/board.$cn$, array[$cn$/cardnews/en/community-board-open/01.png$cn$,$cn$/cardnews/en/community-board-open/02.png$cn$]::text[], $cn$/cardnews/en/community-board-open/01.png$cn$, array[$cn$community$cn$,$cn$forum$cn$,$cn$shrimp farming$cn$,$cn$knowledge sharing$cn$,$cn$aquaculture$cn$,$cn$know-how$cn$]::text[], true, now() - interval '6 hours'),
  -- 베트남어(Tiếng Việt)
  ($cn$water-quality-guide$cn$, $cn$vi$cn$, $cn$Ngưỡng chất lượng nước tôm thẻ chân trắng — Chỉ cần nhớ những con số này$cn$, $cn$Nhiệt độ, pH, oxy hòa tan, độ mặn, amoniac và nitrit. Sáu chỉ tiêu chất lượng nước cần kiểm tra mỗi ngày trong ao tôm thẻ chân trắng.$cn$, $cn$Trong nuôi tôm thẻ chân trắng, phần lớn ca tôm chết bắt đầu từ chất lượng nước chứ không phải từ mầm bệnh. Nước xấu làm sức đề kháng của tôm giảm trước, rồi bệnh mới theo khe hở đó đi vào. Vì vậy việc đầu tiên là thuộc các chỉ tiêu phải đo mỗi ngày và ngưỡng của chúng.

■ Nhiệt độ — thích hợp 28–32°C

Tôm là động vật biến nhiệt nên nhiệt độ nước quyết định trực tiếp tốc độ trao đổi chất. Khoảng 28–32°C cho tăng trưởng và hệ số thức ăn tốt nhất. Dưới 24°C tôm gần như bỏ ăn. Trên 34°C nhu cầu oxy tăng vọt trong khi khả năng hòa tan oxy của nước lại giảm — nguy hiểm kép. Nên giữ biên độ dao động trong ngày dưới 3°C.

■ pH — thích hợp 7,5–8,5

Bản thân pH ít nguy hiểm bằng ảnh hưởng của nó lên các yếu tố khác, đặc biệt là độc tính amoniac. Cùng một nồng độ amoniac tổng, tỷ lệ dạng độc (NH₃) chỉ khoảng 1,2% ở pH 7,5 nhưng lên tới khoảng 11% ở pH 8,5 — chênh gần mười lần. Biên độ dao động trong ngày vượt 0,5 là dấu hiệu tảo đang phát triển quá mức.

■ Oxy hòa tan (DO) — giữ trên 5 mg/L

Đây là chỉ tiêu giết tôm nhanh nhất. Dưới 4 mg/L tôm ngừng lớn; dưới 2 mg/L kéo dài vài giờ là chết hàng loạt. Bắt buộc đo lúc 4–6 giờ sáng, thời điểm thấp nhất trong ngày. Rất nhiều ao đo giữa trưa được 8 mg/L nhưng rạng sáng chỉ còn 2 mg/L.

■ Độ mặn — nuôi được ở 5–35 ppt

Ưu điểm lớn của tôm thẻ chân trắng là chịu được biên độ mặn rộng. Có thể nuôi từ 5 đến 35 ppt, tăng trưởng tốt nhất ở 15–25 ppt. Điều quan trọng không phải giá trị tuyệt đối mà là tốc độ thay đổi: thay đổi hơn 5 ppt trong một ngày sẽ làm chết những con vừa lột xác. Sau khi thay nước hoặc mưa lớn phải đo lại.

■ Amoniac (NH₃) — dưới 0,1 mg/L

Sinh ra khi thức ăn thừa và chất thải phân hủy. Vượt 0,1 mg/L sẽ gây tổn thương mang và lột xác không hoàn chỉnh. Như đã nói ở trên, pH càng cao thì cùng một nồng độ càng nguy hiểm — nên luôn đọc amoniac cùng với pH.

■ Nitrit (NO₂⁻) — dưới 1 mg/L

Sinh ra ở bước trung gian của quá trình phân hủy amoniac. Nó cản trở vận chuyển oxy trong máu tôm, nên khi nitrit cao thì dù oxy hòa tan đủ tôm vẫn bị ngạt. Thường tăng mạnh ở ao mới hoặc ngay sau khi sát trùng, khi vi khuẩn nitrat hóa chưa ổn định.

■ Ghi chép quan trọng hơn ngưỡng

Biết giá trị bình thường của chính ao mình còn quan trọng hơn thuộc lòng con số sách vở. Hôm qua DO 6,2 hôm nay 5,1 thì vẫn trong ngưỡng, nhưng xu hướng đã rõ. Tai nạn được báo trước từ lúc xu hướng bắt đầu, không phải lúc vượt ngưỡng. Hãy đo cùng giờ, cùng vị trí, mỗi ngày, và ghi lại.

Shrimp365 ghi sáu chỉ tiêu này theo từng ao và báo ngay khi vượt ngưỡng. Dùng miễn phí.$cn$, array[$cn$/cardnews/vi/water-quality-guide/01.png$cn$,$cn$/cardnews/vi/water-quality-guide/02.png$cn$,$cn$/cardnews/vi/water-quality-guide/03.png$cn$,$cn$/cardnews/vi/water-quality-guide/04.png$cn$,$cn$/cardnews/vi/water-quality-guide/05.png$cn$,$cn$/cardnews/vi/water-quality-guide/06.png$cn$,$cn$/cardnews/vi/water-quality-guide/07.png$cn$,$cn$/cardnews/vi/water-quality-guide/08.png$cn$]::text[], $cn$/cardnews/vi/water-quality-guide/01.png$cn$, array[$cn$chất lượng nước$cn$,$cn$tôm thẻ chân trắng$cn$,$cn$oxy hòa tan$cn$,$cn$amoniac$cn$,$cn$độ mặn$cn$,$cn$nuôi tôm$cn$]::text[], true, now() - interval '0 hours'),
  ($cn$dawn-oxygen-drop$cn$, $cn$vi$cn$, $cn$4 giờ sáng là lúc oxy thấp nhất — Đừng tin số DO đo ban ngày$cn$, $cn$Oxy hòa tan đo giữa trưa 8 mg/L có thể tụt còn 2 mg/L lúc rạng sáng. Vì sao oxy sụt vào sáng sớm và cách phòng tránh.$cn$, $cn$Sáng ra thăm ao thấy tôm chết, trong khi chiều qua đo oxy hòa tan được 8 mg/L, hoàn toàn bình thường — đây là kiểu tai nạn phổ biến nhất trong nuôi tôm. Nguyên nhân nằm ngay ở việc đo vào ban ngày.

■ Oxy trong ao biến động thế nào trong một ngày

Oxy trong ao không ổn định mà dao động rất mạnh. Ban ngày tảo quang hợp tạo oxy, đạt đỉnh vào khoảng 14–16 giờ. Đo lúc đó được 8 mg/L, có khi còn quá bão hòa.

Nhưng khi mặt trời lặn, quang hợp dừng lại trong khi tảo, tôm và vi sinh vật đều tiếp tục hô hấp. Suốt đêm oxy chỉ bị tiêu thụ chứ không được tạo ra. Kết quả là mức thấp nhất trong ngày rơi vào 4–6 giờ sáng, ngay trước bình minh. Ao đo 8 mg/L giữa trưa mà còn 2 mg/L lúc rạng sáng là chuyện không hiếm.

■ Những điều làm nguy cơ tăng thêm

Tảo càng dày thì đỉnh ban ngày càng cao nhưng đáy ban đêm càng sâu, vì lượng oxy tạo ra nhiều thì lượng tiêu thụ về đêm cũng nhiều. Nước xanh đậm không phải dấu hiệu yên tâm mà là lý do phải canh kỹ hơn lúc rạng sáng.

Nhiệt độ càng cao thì lượng oxy nước có thể hòa tan càng ít. Đêm hè là sự kết hợp tệ nhất: tiêu thụ nhiều mà độ hòa tan thấp. Mật độ thả dày, ngày cho ăn nhiều, trời âm u hoặc mưa (quang hợp yếu), tảo tàn đột ngột — tất cả đều làm tăng rủi ro.

■ Cách phòng tránh

Thứ nhất, chuyển giờ đo sang rạng sáng. Nếu mỗi ngày chỉ đo một lần thì lần đó bắt buộc phải là 4–6 giờ sáng. Số đo ban ngày gần như vô dụng cho việc ra quyết định.

Thứ hai, chạy quạt nước từ lúc mặt trời lặn đến sau khi mặt trời mọc. Nguyên tắc là chạy suốt khung giờ oxy sẽ tụt, chứ không phải bật khi đã tụt rồi.

Thứ ba, đọc hành vi của tôm. Rạng sáng mà tôm nổi lên mặt nước hoặc dạt vào bờ là đã thiếu oxy. Lúc này phải chạy quạt hết công suất và ngừng cho ăn ngay, vì tiêu hóa cũng tốn oxy.

Thứ tư, giảm lượng thức ăn trước khi trời âm u kéo dài quá hai ngày. Quang hợp yếu, thức ăn thừa phân hủy lại tiếp tục ngốn oxy.

■ Ghi chép tạo ra khả năng dự đoán

Ghi DO rạng sáng cùng giờ mỗi ngày, bạn sẽ thấy mức thấp nhất trôi dần xuống qua vài ngày. Chuỗi 6,0 → 5,6 → 5,2 vẫn trong ngưỡng nhưng rạng sáng hôm sau nhiều khả năng chạm vùng nguy hiểm. Tôm chết trông như đột ngột, nhưng ở ao có ghi chép thì hầu như luôn có báo trước.

Shrimp365 lưu số đo rạng sáng theo từng ao, vẽ xu hướng và báo ngay khi xuống dưới ngưỡng.$cn$, array[$cn$/cardnews/vi/dawn-oxygen-drop/01.png$cn$,$cn$/cardnews/vi/dawn-oxygen-drop/02.png$cn$,$cn$/cardnews/vi/dawn-oxygen-drop/03.png$cn$,$cn$/cardnews/vi/dawn-oxygen-drop/04.png$cn$,$cn$/cardnews/vi/dawn-oxygen-drop/05.png$cn$]::text[], $cn$/cardnews/vi/dawn-oxygen-drop/01.png$cn$, array[$cn$oxy hòa tan$cn$,$cn$tôm chết ban đêm$cn$,$cn$quạt nước$cn$,$cn$tảo$cn$,$cn$nuôi tôm$cn$,$cn$chất lượng nước$cn$]::text[], true, now() - interval '1 hours'),
  ($cn$ammonia-response$cn$, $cn$vi$cn$, $cn$Khi amoniac tăng cao — 5 việc phải làm theo đúng thứ tự$cn$, $cn$Cùng một nồng độ amoniac nhưng ở pH 8,5 độc gấp mười lần so với pH 7,5. Cách xử lý theo đúng trình tự thay vì luống cuống.$cn$, $cn$Sai lầm phổ biến nhất khi amoniac vượt ngưỡng là bỏ qua trình tự — thay nước ngay mà chưa xác định nguồn gốc, hoặc chỉ đánh men vi sinh rồi chờ. Hãy làm lần lượt theo các bước sau.

■ Trước hết phải hiểu — độc tính amoniac do pH quyết định

Bộ test thường cho ra tổng amoniac (TAN). Chỉ phần không ion hóa (NH₃) mới thực sự độc với tôm, và tỷ lệ đó phụ thuộc mạnh vào pH.

Cùng một nồng độ tổng, tỷ lệ dạng độc chỉ khoảng 1,2% ở pH 7,5 nhưng lên tới khoảng 11% ở pH 8,5 — chênh gần mười lần. Vì vậy chỉ nhìn con số amoniac là vô nghĩa, phải đọc kèm pH. Cùng là 1 mg/L, ao pH 7,5 còn dư địa, còn ao pH 8,7 là tình huống khẩn cấp.

■ Bước 1 — Giảm hoặc ngừng cho ăn ngay

Amoniac chủ yếu đến từ thức ăn thừa và chất thải. Làm việc khác mà không cắt nguồn thì chẳng khác gì tát nước trong khi vòi vẫn mở. Hãy ngừng cho ăn hoặc giảm một nửa ít nhất một ngày, tối đa hai ngày nếu chỉ số cao. Tôm nhịn vài ngày không chết.

■ Bước 2 — Kiểm tra pH và hạ xuống nếu có thể

Nếu pH trên 8,5 thì đó là vấn đề cấp bách nhất lúc này. Điều tiết CO₂ bằng quạt nước và ngừng ngay việc bón vôi. Chỉ cần đưa pH về khoảng 8,0 là độc tính thực tế đã giảm hơn một nửa. Tuy nhiên biến động pH đột ngột cũng nguy hiểm — đừng ép thay đổi quá 0,3 mỗi ngày.

■ Bước 3 — Đẩy oxy lên mức tối đa

Tôm nhiễm amoniac bị tổn thương mang nên khả năng hấp thu oxy giảm. Mức DO bình thường vẫn đủ thì lúc này lại thiếu. Chạy quạt hết công suất. Oxy cũng cần cho vi khuẩn nitrat hóa phân hủy amoniac.

■ Bước 4 — Thay nước sau đó mới tính

Đến lúc này mới cân nhắc thay nước. Không thay quá 30% một lần, hãy chia thành từng đợt 20–30%. Bắt buộc đo nhiệt độ, độ mặn và pH của nước cấp vào rồi so với ao. Tai nạn hay gặp là vì chạy theo con số amoniac mà làm độ mặn đổi đột ngột, giết chết tôm đang lột xác.

■ Bước 5 — Men vi sinh là phòng ngừa, không phải thuốc cấp cứu

Vi khuẩn nitrat hóa cần vài ngày đến vài tuần mới ổn định. Đây không phải sản phẩm đánh hôm nay để hạ chỉ số hôm nay. Men vi sinh chỉ hiệu quả khi dùng đều đặn — nhất là khi khởi động ao mới và ngay sau khi sát trùng — chứ không phải sau khi sự cố đã xảy ra.

■ Sau đó bắt buộc theo dõi nitrit

Amoniac phân hủy sẽ thành nitrit. Việc nitrit tăng vài ngày sau khi amoniac giảm là diễn biến bình thường. Lơ là lúc này sẽ dẫn tới sự cố thứ hai. Hãy kiểm tra nitrit hằng ngày trong một tuần sau mỗi lần amoniac tăng.

Shrimp365 ghi amoniac cùng với pH để bạn đánh giá được nguy cơ độc thật sự, chứ không chỉ một con số trơ trọi.$cn$, array[$cn$/cardnews/vi/ammonia-response/01.png$cn$,$cn$/cardnews/vi/ammonia-response/02.png$cn$,$cn$/cardnews/vi/ammonia-response/03.png$cn$,$cn$/cardnews/vi/ammonia-response/04.png$cn$,$cn$/cardnews/vi/ammonia-response/05.png$cn$,$cn$/cardnews/vi/ammonia-response/06.png$cn$,$cn$/cardnews/vi/ammonia-response/07.png$cn$,$cn$/cardnews/vi/ammonia-response/08.png$cn$]::text[], $cn$/cardnews/vi/ammonia-response/01.png$cn$, array[$cn$amoniac$cn$,$cn$pH$cn$,$cn$nitrit$cn$,$cn$thay nước$cn$,$cn$men vi sinh$cn$,$cn$nuôi tôm$cn$]::text[], true, now() - interval '2 hours'),
  ($cn$ahpnd-early-signs$cn$, $cn$vi$cn$, $cn$Dấu hiệu sớm của AHPND (EMS) — Hãy nhìn gan tụy$cn$, $cn$AHPND có thể xóa sổ cả ao chỉ vài ngày sau khi phát bệnh. Những dấu hiệu sớm có thể nhận ra, cách kiểm tra và biện pháp phòng ngừa.$cn$, $cn$AHPND (bệnh hoại tử gan tụy cấp tính, còn gọi là hội chứng tôm chết sớm) là một trong những bệnh có sức tàn phá lớn nhất trong nuôi tôm thẻ chân trắng. Nguyên nhân là các dòng vi khuẩn Vibrio sinh độc tố, thường bùng phát 20–30 ngày sau khi thả, và một khi đã khởi phát thì có thể quét sạch cả ao chỉ trong vài ngày. Không có thuốc chữa, nên phát hiện sớm và phòng ngừa là tất cả.

■ Dấu hiệu đầu tiên — giảm bắt mồi

Kiểm tra nhá (sàng ăn): lượng thức ăn vốn hết trong khoảng thời gian quen thuộc bắt đầu còn dư. Dấu hiệu này đến trước khi các chỉ số nước thay đổi, và chỉ ao nào kiểm tra nhá hằng ngày mới bắt được. Nếu lượng ăn giảm 20–30% mà không có lý do rõ ràng, hãy vớt tôm lên kiểm tra ngay trong ngày.

■ Kiểm tra trực tiếp gan tụy

Cơ quan đích của AHPND là gan tụy — khối màu nâu sẫm ở phần lưng của đầu tôm. Vớt vài con, bóc vỏ và so sánh bằng mắt.

Tôm khỏe — nâu đậm hoặc nâu vàng sẫm, đầy đặn, ranh giới rõ ràng.

Tôm nghi bệnh — màu nhạt đi rõ rệt (vàng nhạt, gần như trắng), teo nhỏ, ấn vào thấy mềm nhũn. Nặng hơn có thể thấy đốm hoặc vệt đen.

■ Các biểu hiện đi kèm

Vỏ mềm, thân trong. Ruột giữa rỗng nên không thấy đường chỉ đen chạy dọc lưng — bằng chứng trực tiếp là tôm không ăn. Tăng trưởng chậm hẳn và kích cỡ không đồng đều. Tôm chết chủ yếu nằm ở đáy ao.

■ Giảm điều kiện phát bệnh là cách phòng duy nhất

Thứ nhất, mua giống ở nơi có kiểm dịch. Phần lớn AHPND xâm nhập từ giai đoạn con giống. Hãy yêu cầu và kiểm tra kết quả PCR trước khi thả.

Thứ hai, quản lý đáy ao là cốt lõi. Đáy tích tụ chất hữu cơ là môi trường lý tưởng cho Vibrio. Phơi và cải tạo đáy kỹ giữa các vụ. Trong quá trình nuôi, tránh cho ăn dư chính là cách quản lý đáy hiệu quả nhất.

Thứ ba, đừng thả quá dày. Mật độ càng cao thì stress và tải lượng hữu cơ càng tăng theo.

Thứ tư, bổ sung vi sinh có lợi đều đặn để Vibrio ít chỗ bám trụ.

■ Nghi ngờ thì quyết định cách ly ngay

Khi đã xác nhận ở một ao, phải chặn lây lan qua nước và dụng cụ. Dùng dụng cụ riêng cho từng ao và kiểm tra đường thoát nước. Chậm quyết định một ngày là mất luôn các ao lân cận.

■ Ghi chép hằng ngày tạo ra khả năng phát hiện sớm

Dấu hiệu đầu tiên của AHPND là giảm lượng ăn. Ghi lượng cho ăn và thức ăn thừa mỗi ngày sẽ biến cảm giác "hôm nay ăn ít hơn" thành con số cụ thể. Shrimp365 quản lý ghi chép cho ăn và tôm chết cùng nhau nên bất thường lộ ra rất nhanh.

※ Đây là hướng dẫn quan sát tại ao, không thay thế chẩn đoán. Khi nghi ngờ hãy làm xét nghiệm PCR tại cơ quan chuyên ngành bệnh thủy sản.$cn$, array[$cn$/cardnews/vi/ahpnd-early-signs/01.png$cn$,$cn$/cardnews/vi/ahpnd-early-signs/02.png$cn$,$cn$/cardnews/vi/ahpnd-early-signs/03.png$cn$,$cn$/cardnews/vi/ahpnd-early-signs/04.png$cn$,$cn$/cardnews/vi/ahpnd-early-signs/05.png$cn$,$cn$/cardnews/vi/ahpnd-early-signs/06.png$cn$,$cn$/cardnews/vi/ahpnd-early-signs/07.png$cn$]::text[], $cn$/cardnews/vi/ahpnd-early-signs/01.png$cn$, array[$cn$AHPND$cn$,$cn$EMS$cn$,$cn$gan tụy$cn$,$cn$bệnh tôm$cn$,$cn$vi khuẩn vibrio$cn$,$cn$nuôi tôm$cn$]::text[], true, now() - interval '3 hours'),
  ($cn$feeding-rate-calculation$cn$, $cn$vi$cn$, $cn$Đừng cho ăn theo cảm tính — Đây là cách tính$cn$, $cn$Tính lượng thức ăn hằng ngày bằng sinh khối × tỷ lệ cho ăn, rồi kiểm chứng bằng nhá và điều chỉnh. Cho ăn dư vừa tốn tiền vừa phá nước.$cn$, $cn$Thức ăn chiếm hơn một nửa giá thành nuôi. Và mỗi ký thức ăn thừa đều biến thành amoniac, kéo chất lượng nước đi xuống. Cho ăn theo cảm tính là mất tiền và mất nước cùng lúc. Hãy tính, kiểm chứng và điều chỉnh.

■ Bước 1 — Tính sinh khối

Sinh khối = số con còn lại × trọng lượng trung bình

Ví dụ thả 100.000 con giống, ước tính tỷ lệ sống 85% thì còn 85.000 con. Nếu mẫu cân được trọng lượng trung bình 10 g:

85.000 × 10 g = 850.000 g = 850 kg

Tỷ lệ sống chỉ là ước tính, nên phải liên tục hiệu chỉnh dựa vào phản ứng ở nhá và số liệu tôm chết.

■ Bước 2 — Nhân với tỷ lệ cho ăn theo cỡ tôm

Tỷ lệ cho ăn là phần trăm thức ăn hằng ngày so với sinh khối, và giảm dần khi tôm lớn. Mức tham khảo phổ biến:

1–3 g — 8–6% sinh khối
3–5 g — 6–5%
5–10 g — 5–4%
10–15 g — 4–3%
15–20 g — 3–2,5%
Trên 20 g — 2,5–2%

Với ví dụ trên (850 kg, trung bình 10 g), áp dụng 4%:

850 kg × 0,04 = 34 kg/ngày

Đó là tổng lượng cả ngày, thường chia làm 4–5 lần.

■ Bước 3 — Bắt buộc kiểm chứng bằng nhá

Con số tính toán chỉ là điểm khởi đầu. Quyết định thật sự nằm ở nhá. Cho 1–2% lượng mỗi cữ vào nhá và kiểm tra sau khoảng thời gian đã định.

Hết sạch sau 2 giờ — thiếu. Tăng 5–10% từ cữ sau.
Hết vừa đẹp trong 2–3 giờ — hợp lý. Giữ nguyên.
Sau 3 giờ vẫn còn — dư. Giảm 10–20%.

■ Khi nào phải giảm ngay, bất kể con số tính toán

Nhiệt độ dưới 26°C, oxy hòa tan dưới 4 mg/L, giai đoạn lột xác đồng loạt, trời âm u kéo dài quá hai ngày, amoniac hoặc nitrit tăng, và bất cứ khi nào nghi có bệnh. Khi tôm không ăn mà vẫn cho theo công thức thì toàn bộ khẩu phần đó trở thành nguồn ô nhiễm.

■ Dùng FCR để kiểm tra trình độ quản lý

Hệ số chuyển đổi thức ăn (FCR) = tổng thức ăn đã dùng ÷ tổng trọng lượng tăng

1,2–1,5 là đang quản lý tốt. Trên 1,8 nghĩa là cho ăn dư hoặc ước tính tỷ lệ sống sai. FCR không chỉ là con số cuối vụ — tính giữa vụ sẽ cho biết cách quản lý hiện tại có đúng không.

■ Không có ghi chép thì cũng không có phép tính

Lượng cho ăn, thức ăn thừa, trọng lượng mẫu và số tôm chết đều phải được ghi hằng ngày thì ước tính sinh khối mới chính xác — và chỉ khi đó phép tính mới có ý nghĩa. Shrimp365 ghi các số liệu này theo từng ao và hiển thị xu hướng cho ăn cùng FCR.$cn$, array[$cn$/cardnews/vi/feeding-rate-calculation/01.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/02.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/03.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/04.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/05.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/06.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/07.png$cn$,$cn$/cardnews/vi/feeding-rate-calculation/08.png$cn$]::text[], $cn$/cardnews/vi/feeding-rate-calculation/01.png$cn$, array[$cn$lượng cho ăn$cn$,$cn$FCR$cn$,$cn$sinh khối$cn$,$cn$nhá$cn$,$cn$quản lý thức ăn$cn$,$cn$nuôi tôm$cn$]::text[], true, now() - interval '4 hours'),
  ($cn$mortality-diagnosis$cn$, $cn$vi$cn$, $cn$Bảng phân biệt nguyên nhân tôm chết — Chết ở đâu sẽ cho biết vì sao$cn$, $cn$Thu hẹp nguyên nhân dựa vào vị trí, thời điểm, tình trạng vỏ và màu sắc. Phân biệt thiếu oxy, bệnh, ngộ độc và lột xác thất bại.$cn$, $cn$Khi tôm chết, việc quan trọng nhất là thu hẹp nguyên nhân — vì nguyên nhân khác nhau thì cách xử lý có thể trái ngược hẳn. Kiểm tra bốn điểm sau sẽ giải quyết được phần lớn trường hợp.

■ Kiểm tra 1 — Chết ở đâu?

Ven bờ, gần mặt nước — nhiều khả năng thiếu oxy hoặc ngộ độc cấp. Tôm dạt tới đó vì đang khó chịu.

Đáy ao — nhiều khả năng do bệnh, đặc biệt là dạng tiến triển mạn như AHPND. Nghĩa là tôm không còn sức để di chuyển.

Tụ quanh quạt nước — gần như chắc chắn thiếu oxy.

■ Kiểm tra 2 — Chết lúc nào?

Phát hiện lúc rạng sáng hoặc sáng sớm — nghi thiếu oxy đầu tiên. Phù hợp với diễn biến oxy bị tiêu thụ suốt đêm và chạm đáy trước bình minh.

Diễn ra trong ngày — nghi nhiệt độ tăng vọt, chất độc xâm nhập, hoặc chất lượng nước thay đổi đột ngột.

Rải rác vài con mỗi ngày trong nhiều ngày — bệnh hoặc nước xấu kéo dài. Việc mỗi ngày đều đặn có vài con chết là dấu hiệu nguy hiểm nhất.

Ngay sau khi thay nước hoặc mưa — độ mặn hoặc nhiệt độ biến động đột ngột, hoặc nước cấp bị ô nhiễm.

■ Kiểm tra 3 — Vỏ thế nào?

Vỏ cứng, thân nguyên vẹn — sự cố cấp tính. Thiếu oxy hoặc ngộ độc. Tôm vẫn bình thường cho tới lúc chết.

Vỏ mềm, thân trong — mạn tính. Bệnh hoặc dinh dưỡng. Tôm đã bỏ ăn một thời gian.

Vỏ lột dở dang — lột xác thất bại. Do thiếu độ mặn hoặc khoáng (canxi, magiê) trong giai đoạn lột, hoặc thiếu oxy giữa lúc lột.

■ Kiểm tra 4 — Màu sắc và gan tụy ra sao?

Thân chuyển đỏ — dấu hiệu stress nặng hoặc nhiễm trùng cấp.

Gan tụy nhợt và teo — nghi ngờ mạnh AHPND. (Xem bài số 04.)

Đốm đen trên vỏ — bệnh vỏ do vi khuẩn hoặc đáy ao bẩn.

Ruột giữa rỗng (không thấy đường chỉ đen trên lưng) — tôm đã ngừng ăn từ lâu. Nghiêng về bệnh.

■ Tóm tắt phân biệt

Rạng sáng + ven bờ + vỏ cứng → thiếu oxy
Đáy ao + kéo dài nhiều ngày + gan tụy nhợt → bệnh như AHPND
Giai đoạn lột + vỏ lột dở → lột xác thất bại (khoáng, oxy)
Ngay sau thay nước + chết nhiều đột ngột → nước biến động hoặc nước cấp có vấn đề
Ban ngày + đột ngột + hành vi bất thường → chất độc

■ Hãy ghi số tôm chết mỗi ngày

Nhận định "hôm nay hình như nhiều hơn" chỉ có thể đưa ra khi có số liệu của hôm qua. Nếu số chết mỗi ngày tăng từ 5 lên 12 con thì trông vẫn ít, nhưng đã tăng hơn gấp đôi — và đó chính là lúc phải hành động. Khi tôm chết đã nhiều tới mức thấy rõ thì đã muộn.

Shrimp365 lưu số tôm chết cùng với ghi chép chất lượng nước và cho ăn, để bạn nhìn lại xem chỉ số nào đã động trước khi số chết bắt đầu tăng.$cn$, array[$cn$/cardnews/vi/mortality-diagnosis/01.png$cn$,$cn$/cardnews/vi/mortality-diagnosis/02.png$cn$,$cn$/cardnews/vi/mortality-diagnosis/03.png$cn$,$cn$/cardnews/vi/mortality-diagnosis/04.png$cn$,$cn$/cardnews/vi/mortality-diagnosis/05.png$cn$,$cn$/cardnews/vi/mortality-diagnosis/06.png$cn$,$cn$/cardnews/vi/mortality-diagnosis/07.png$cn$]::text[], $cn$/cardnews/vi/mortality-diagnosis/01.png$cn$, array[$cn$tôm chết$cn$,$cn$phân tích nguyên nhân$cn$,$cn$thiếu oxy$cn$,$cn$lột xác$cn$,$cn$bệnh tôm$cn$,$cn$nuôi tôm$cn$]::text[], true, now() - interval '5 hours'),
  ($cn$community-board-open$cn$, $cn$vi$cn$, $cn$Chúng tôi đã mở diễn đàn cộng đồng nuôi tôm$cn$, $cn$Nơi chia sẻ kinh nghiệm thực tế — chất lượng nước, dịch bệnh, cho ăn, thiết bị. Đọc không cần đăng nhập, chỉ khi viết bài mới cần tài khoản.$cn$, $cn$Phần lớn vấn đề ở ao tôm là vấn đề đã có người khác gặp rồi. Vấn đề là kinh nghiệm đó chỉ nằm trong trí nhớ của một người và không đến được với ai khác. Vì vậy chúng tôi mở diễn đàn cộng đồng.

■ Ở đây bàn những chuyện gì

Chất lượng nước — DO rạng sáng cứ tụt, cần thêm mấy dàn quạt nữa? Độ mặn nguồn nước ở vùng anh chị thay đổi thế nào theo mùa?

Dịch bệnh — gan tụy trông thế này liệu có phải AHPND? Có ai từng gặp triệu chứng này chưa?

Cho ăn — cỡ tôm này anh chị đang cho ăn tỷ lệ bao nhiêu phần trăm? Nhá phản ứng thế này thì điều chỉnh ra sao?

Thiết bị — anh chị đang dùng quạt loại nào? Máy đo hãng nào bền?

Kinh doanh — vụ này FCR và tỷ lệ sống của anh chị ra sao? Anh chị quyết định thời điểm thu hoạch thế nào?

■ Có thể đăng kèm ảnh

Đăng ảnh tôm, màu nước, nhá, thiết bị thì sẽ nhận được câu trả lời chính xác hơn nhiều. Tình trạng gan tụy hay vỏ tôm rất khó tả bằng lời — một tấm ảnh hơn mười dòng chữ.

■ Đọc được mà không cần đăng nhập

Người từ công cụ tìm kiếm vào vẫn đọc được toàn bộ. Chỉ khi viết bài hoặc bình luận mới cần tài khoản, và có thể đăng ký bằng email hoặc trực tiếp qua Kakao, Google.

■ Tách theo ngôn ngữ

Người dùng tiếng Hàn, tiếng Anh, tiếng Việt và tiếng Indonesia chỉ thấy bài viết bằng ngôn ngữ của mình. Bạn không cần chọn gì cả — ngôn ngữ bài viết được nhận diện tự động.

■ Nên bắt đầu thế nào

Nếu là bài đầu tiên, một câu hỏi tốt hơn một lời giới thiệu. Hãy viết ra điều đang khiến bạn bận tâm nhất ở ao lúc này. Khi có người trả lời, chính chủ đề đó trở thành tư liệu cho người sau.

Nếu bạn đã giải quyết được việc gì, hãy kể lại cách làm. Một bài "gặp thế này, tôi làm thế kia, kết quả thế này" hữu ích hơn mười trang sách. Những ca thất bại cũng có giá trị y như vậy.

■ Vài nguyên tắc mong được giữ

Xin đừng công kích sản phẩm hay công ty cụ thể. Đánh giá dựa trên trải nghiệm thật thì luôn được hoan nghênh. Nếu thông tin về dịch bệnh chưa được xác nhận, hãy ghi rõ điều đó — một thông tin sai có thể làm hỏng cả ao của người khác.

Diễn đàn ở địa chỉ www.shrimp365.kr/board.$cn$, array[$cn$/cardnews/vi/community-board-open/01.png$cn$,$cn$/cardnews/vi/community-board-open/02.png$cn$]::text[], $cn$/cardnews/vi/community-board-open/01.png$cn$, array[$cn$cộng đồng$cn$,$cn$diễn đàn$cn$,$cn$nuôi tôm$cn$,$cn$chia sẻ kiến thức$cn$,$cn$thủy sản$cn$,$cn$kinh nghiệm$cn$]::text[], true, now() - interval '6 hours'),
  -- 인도네시아어(Bahasa Indonesia)
  ($cn$water-quality-guide$cn$, $cn$id$cn$, $cn$Kisaran Kualitas Air Udang Vaname — Angka yang Wajib Dihafal$cn$, $cn$Suhu, pH, oksigen terlarut, salinitas, amonia, dan nitrit. Enam parameter kualitas air yang harus dicek setiap hari di tambak udang vaname.$cn$, $cn$Dalam budidaya udang vaname, sebagian besar kematian bermula dari kualitas air, bukan dari patogen. Ketika kualitas air memburuk, daya tahan udang turun lebih dulu — dan penyakit masuk lewat celah itu. Karena itu langkah pertama adalah menghafal parameter harian beserta kisarannya.

■ Suhu — ideal 28–32°C

Udang berdarah dingin, sehingga suhu air langsung menentukan laju metabolismenya. Kisaran 28–32°C memberi pertumbuhan dan efisiensi pakan terbaik. Di bawah 24°C udang hampir tidak makan. Di atas 34°C kebutuhan oksigen melonjak sementara daya larut oksigen air justru turun — risiko ganda. Jaga fluktuasi harian di bawah 3°C.

■ pH — ideal 7,5–8,5

pH lebih berbahaya lewat pengaruhnya pada parameter lain, terutama toksisitas amonia. Pada konsentrasi amonia total yang sama, bentuk beracun (NH₃) hanya sekitar 1,2% pada pH 7,5 tetapi mencapai sekitar 11% pada pH 8,5 — hampir sepuluh kali lipat. Fluktuasi harian di atas 0,5 juga menandakan plankton sedang meledak.

■ Oksigen terlarut (DO) — pertahankan di atas 5 mg/L

Inilah parameter yang paling cepat membunuh. Di bawah 4 mg/L pertumbuhan berhenti; beberapa jam di bawah 2 mg/L langsung berujung kematian massal. Ukurlah pukul 04.00–06.00, titik terendah dalam sehari. Banyak tambak terbaca 8 mg/L saat siang tetapi hanya 2 mg/L menjelang subuh.

■ Salinitas — dapat dibudidayakan pada 5–35 ppt

Keunggulan besar vaname adalah toleransi salinitas yang luas. Budidaya bisa dilakukan pada 5 sampai 35 ppt, dengan pertumbuhan terbaik di 15–25 ppt. Yang penting bukan nilai mutlaknya melainkan kecepatan perubahannya: perubahan lebih dari 5 ppt dalam sehari akan mematikan udang yang baru saja molting. Ukur ulang setelah pergantian air atau hujan deras.

■ Amonia (NH₃) — di bawah 0,1 mg/L

Terbentuk dari sisa pakan dan kotoran yang terurai. Di atas 0,1 mg/L muncul kerusakan insang dan gagal molting. Seperti dijelaskan di atas, makin tinggi pH makin berbahaya konsentrasi yang sama — jadi amonia harus selalu dibaca bersama pH.

■ Nitrit (NO₂⁻) — di bawah 1 mg/L

Terbentuk pada tahap antara penguraian amonia. Nitrit menghambat pengangkutan oksigen dalam darah udang, sehingga saat nitrit tinggi udang tetap sesak meski oksigen terlarut terlihat cukup. Paling mudah melonjak di tambak baru atau tepat setelah disinfeksi, saat bakteri nitrifikasi belum mapan.

■ Catatan lebih penting daripada kisaran acuan

Mengetahui nilai normal tambak sendiri lebih berguna daripada menghafal angka buku. Jika DO kemarin 6,2 dan hari ini 5,1, nilainya masih aman — tetapi trennya jelas. Kecelakaan sudah diumumkan sejak tren dimulai, bukan saat ambang dilewati. Ukur pada jam dan titik yang sama setiap hari, lalu catat.

Shrimp365 mencatat keenam parameter ini per petak dan memberi peringatan begitu nilainya keluar dari kisaran. Gratis digunakan.$cn$, array[$cn$/cardnews/id/water-quality-guide/01.png$cn$,$cn$/cardnews/id/water-quality-guide/02.png$cn$,$cn$/cardnews/id/water-quality-guide/03.png$cn$,$cn$/cardnews/id/water-quality-guide/04.png$cn$,$cn$/cardnews/id/water-quality-guide/05.png$cn$,$cn$/cardnews/id/water-quality-guide/06.png$cn$,$cn$/cardnews/id/water-quality-guide/07.png$cn$,$cn$/cardnews/id/water-quality-guide/08.png$cn$]::text[], $cn$/cardnews/id/water-quality-guide/01.png$cn$, array[$cn$kualitas air$cn$,$cn$udang vaname$cn$,$cn$oksigen terlarut$cn$,$cn$amonia$cn$,$cn$salinitas$cn$,$cn$budidaya udang$cn$]::text[], true, now() - interval '0 hours'),
  ($cn$dawn-oxygen-drop$cn$, $cn$id$cn$, $cn$Oksigen Terendah Pukul 4 Pagi — Jangan Percaya Angka DO Siang Hari$cn$, $cn$Oksigen terlarut yang terbaca 8 mg/L siang hari bisa turun ke 2 mg/L menjelang subuh. Penyebab anjloknya oksigen dini hari dan cara mengantisipasinya.$cn$, $cn$Pagi hari Anda ke tambak dan menemukan udang mati, padahal siang kemarin oksigen terlarut terbaca 8 mg/L dan tampak baik-baik saja. Ini pola kecelakaan paling umum dalam budidaya udang, dan penyebabnya justru pada pengukuran siang itu sendiri.

■ Bagaimana oksigen bergerak sepanjang hari

Oksigen tambak tidak stabil, melainkan berayun tajam. Siang hari plankton berfotosintesis dan menghasilkan oksigen, memuncak sekitar pukul 14.00–16.00. Diukur saat itu hasilnya 8 mg/L, bahkan bisa lewat jenuh.

Setelah matahari terbenam fotosintesis berhenti, tetapi plankton, udang, dan mikroba semuanya tetap bernapas. Sepanjang malam oksigen hanya dikonsumsi, tidak diproduksi. Akibatnya titik terendah harian jatuh tepat sebelum matahari terbit, sekitar pukul 04.00–06.00. Tambak yang terbaca 8 mg/L siang hari lalu tinggal 2 mg/L menjelang subuh bukan hal langka.

■ Yang memperparah

Makin pekat plankton, makin tinggi puncak siangnya — dan makin dalam titik terendah malamnya, karena yang banyak memproduksi juga banyak mengonsumsi setelah gelap. Air hijau pekat bukan tanda aman, justru alasan untuk lebih waspada menjelang subuh.

Suhu air yang lebih tinggi menurunkan jumlah oksigen yang bisa larut. Malam musim panas menggabungkan konsumsi tinggi dengan kelarutan rendah — kombinasi terburuk. Padat tebar tinggi, hari dengan pakan banyak, cuaca mendung atau hujan (fotosintesis lemah), dan plankton yang tiba-tiba mati semuanya menambah risiko.

■ Cara mengantisipasi

Pertama, pindahkan waktu pengukuran ke dini hari. Kalau hanya mengukur sekali sehari, sekali itu harus pukul 04.00–06.00. Angka siang hari hampir tidak berguna untuk pengambilan keputusan.

Kedua, jalankan kincir sejak matahari terbenam sampai setelah terbit. Prinsipnya menjalankan kincir sepanjang jendela waktu ketika oksigen akan turun, bukan menyalakannya setelah terlanjur turun.

Ketiga, baca perilaku udang. Kalau menjelang subuh udang berkumpul di permukaan atau di tepi tambak, oksigen sudah kurang. Pada titik itu jalankan kincir maksimal dan hentikan pemberian pakan, karena pencernaan juga menghabiskan oksigen.

Keempat, kurangi pakan lebih awal bila mendung berlangsung lebih dari dua hari. Dengan fotosintesis lemah, sisa pakan yang terurai justru menyedot oksigen lagi.

■ Catatan yang membuat prediksi mungkin

Catat DO subuh pada jam yang sama setiap hari, dan Anda akan melihat titik terendah merosot perlahan selama beberapa hari. Urutan 6,0 → 5,6 → 5,2 masih dalam kisaran, tetapi subuh berikutnya kemungkinan besar masuk zona bahaya. Kematian tampak mendadak, padahal di tambak yang punya catatan hampir selalu ada peringatannya.

Shrimp365 menyimpan angka subuh per petak, menggambar trennya, dan memberi peringatan begitu turun di bawah kisaran.$cn$, array[$cn$/cardnews/id/dawn-oxygen-drop/01.png$cn$,$cn$/cardnews/id/dawn-oxygen-drop/02.png$cn$,$cn$/cardnews/id/dawn-oxygen-drop/03.png$cn$,$cn$/cardnews/id/dawn-oxygen-drop/04.png$cn$,$cn$/cardnews/id/dawn-oxygen-drop/05.png$cn$]::text[], $cn$/cardnews/id/dawn-oxygen-drop/01.png$cn$, array[$cn$oksigen terlarut$cn$,$cn$kematian malam$cn$,$cn$kincir$cn$,$cn$plankton$cn$,$cn$budidaya udang$cn$,$cn$kualitas air$cn$]::text[], true, now() - interval '1 hours'),
  ($cn$ammonia-response$cn$, $cn$id$cn$, $cn$Saat Amonia Naik — Lima Langkah Sesuai Urutan$cn$, $cn$Konsentrasi amonia yang sama sepuluh kali lebih beracun pada pH 8,5 dibanding pH 7,5. Cara menangani dengan urutan yang benar.$cn$, $cn$Kesalahan paling umum ketika amonia melewati ambang adalah melompati langkah — mengganti air sebelum tahu sumbernya, atau sekadar menebar probiotik lalu menunggu. Kerjakan berurutan seperti berikut.

■ Pahami dulu — toksisitas amonia ditentukan pH

Test kit umumnya melaporkan total amonia nitrogen (TAN). Yang benar-benar beracun bagi udang hanya fraksi tak terionisasi (NH₃), dan fraksi itu sangat bergantung pada pH.

Pada konsentrasi total yang sama, fraksi beracunnya sekitar 1,2% pada pH 7,5 tetapi naik menjadi sekitar 11% pada pH 8,5 — hampir sepuluh kali lipat. Jadi angka amonia saja tidak berarti apa-apa; harus dibaca bersama pH. Nilai 1 mg/L yang sama masih aman di tambak ber-pH 7,5, tetapi darurat di tambak ber-pH 8,7.

■ Langkah 1 — Kurangi atau hentikan pakan segera

Amonia sebagian besar berasal dari sisa pakan dan kotoran. Melakukan tindakan lain tanpa memutus sumbernya sama seperti menguras air dengan keran tetap terbuka. Hentikan pemberian pakan, atau kurangi separuh, minimal satu hari — sampai dua hari bila angkanya tinggi. Udang tidak mati meski berpuasa beberapa hari.

■ Langkah 2 — Periksa pH dan turunkan bila memungkinkan

Bila pH di atas 8,5, itulah masalah paling mendesak sekarang. Kelola CO₂ lewat aerasi dan hentikan pengapuran seketika. Menurunkan pH ke sekitar 8,0 saja sudah memangkas toksisitas nyata lebih dari separuh. Namun perubahan pH yang mendadak juga berbahaya — jangan paksa berubah lebih dari 0,3 per hari.

■ Langkah 3 — Naikkan oksigen ke maksimum

Udang yang terpapar amonia mengalami kerusakan insang sehingga penyerapan oksigennya menurun. Kadar DO yang biasanya cukup kini tidak lagi memadai. Jalankan kincir penuh. Oksigen juga dibutuhkan bakteri nitrifikasi untuk menguraikan amonia.

■ Langkah 4 — Pergantian air baru setelah itu

Baru sekarang pertimbangkan ganti air. Jangan pernah mengganti lebih dari 30% sekaligus; lakukan bertahap 20–30%. Selalu ukur suhu, salinitas, dan pH air masuk lalu bandingkan dengan tambak. Kehilangan udang yang sedang molting akibat salinitas berubah mendadak demi mengejar angka amonia adalah kecelakaan yang sering terjadi.

■ Langkah 5 — Probiotik itu pencegahan, bukan obat darurat

Bakteri nitrifikasi butuh beberapa hari sampai beberapa minggu untuk mapan. Ini bukan produk yang ditebar hari ini lalu menurunkan angka hari ini juga. Probiotik bekerja bila diberikan rutin — terutama saat memulai tambak baru dan tepat setelah disinfeksi — bukan setelah insiden terjadi.

■ Setelahnya, wajib pantau nitrit

Amonia terurai menjadi nitrit. Naiknya nitrit beberapa hari setelah amonia turun adalah alur yang normal. Lengah di titik ini mengundang insiden kedua. Periksa nitrit setiap hari selama seminggu setelah setiap kejadian amonia.

Shrimp365 mencatat amonia bersama pH sehingga Anda bisa menilai risiko racun yang sebenarnya, bukan sekadar angka telanjang.$cn$, array[$cn$/cardnews/id/ammonia-response/01.png$cn$,$cn$/cardnews/id/ammonia-response/02.png$cn$,$cn$/cardnews/id/ammonia-response/03.png$cn$,$cn$/cardnews/id/ammonia-response/04.png$cn$,$cn$/cardnews/id/ammonia-response/05.png$cn$,$cn$/cardnews/id/ammonia-response/06.png$cn$,$cn$/cardnews/id/ammonia-response/07.png$cn$,$cn$/cardnews/id/ammonia-response/08.png$cn$]::text[], $cn$/cardnews/id/ammonia-response/01.png$cn$, array[$cn$amonia$cn$,$cn$pH$cn$,$cn$nitrit$cn$,$cn$ganti air$cn$,$cn$probiotik$cn$,$cn$budidaya udang$cn$]::text[], true, now() - interval '2 hours'),
  ($cn$ahpnd-early-signs$cn$, $cn$id$cn$, $cn$Gejala Awal AHPND (EMS) — Perhatikan Hepatopankreasnya$cn$, $cn$AHPND bisa menghabiskan satu petak hanya dalam hitungan hari sejak muncul. Sinyal awal yang bisa ditangkap, cara memeriksanya, dan pencegahannya.$cn$, $cn$AHPND (penyakit nekrosis hepatopankreas akut, dikenal juga sebagai early mortality syndrome) adalah salah satu penyakit paling merusak dalam budidaya udang vaname. Penyebabnya adalah galur Vibrio penghasil racun, umumnya menyerang 20–30 hari setelah tebar, dan begitu mulai bisa menghabiskan satu petak dalam beberapa hari. Tidak ada obatnya, sehingga deteksi dini dan pencegahan adalah segalanya.

■ Sinyal pertama — nafsu makan menurun

Periksa anco: pakan yang biasanya habis dalam rentang waktu normal mulai tersisa. Tanda ini muncul sebelum apa pun terlihat pada angka kualitas air, dan hanya tambak yang mengecek anco setiap hari yang akan menangkapnya. Bila konsumsi turun 20–30% tanpa sebab jelas, ambil sampel udang dan periksa hari itu juga.

■ Periksa hepatopankreas secara langsung

Organ sasaran AHPND adalah hepatopankreas — organ cokelat tua di sisi punggung bagian kepala. Ambil beberapa ekor, buka cangkangnya, lalu bandingkan secara visual.

Sehat — cokelat pekat atau cokelat kekuningan tua, berisi penuh, dengan batas yang jelas.

Dicurigai — warnanya jelas memucat (kuning muda, mendekati putih), mengecil, dan lembek saat ditekan. Pada kondisi lanjut bisa muncul bintik atau garis hitam.

■ Tanda penyerta

Cangkang melunak dan tubuh menjadi bening. Usus tengah kosong sehingga garis gelap di sepanjang punggung tidak terlihat — bukti langsung bahwa udang tidak makan. Pertumbuhan tertinggal nyata dan ukuran menjadi tidak seragam. Udang mati kebanyakan ditemukan di dasar tambak.

■ Menekan kondisi pemicu adalah satu-satunya pertahanan nyata

Pertama, ambil benur dari pemasok yang tersertifikasi. Sebagian besar AHPND masuk pada tahap benur. Minta dan periksa hasil PCR sebelum menebar.

Kedua, pengelolaan dasar adalah intinya. Dasar yang sarat bahan organik adalah lingkungan ideal bagi Vibrio. Keringkan dan bersihkan dasar secara menyeluruh di antara siklus. Selama pemeliharaan, menghindari pakan berlebih adalah pengelolaan dasar paling efektif.

Ketiga, jangan memaksakan padat tebar. Kepadatan tinggi menaikkan stres dan beban organik sekaligus.

Keempat, tebar mikroba menguntungkan secara konsisten agar Vibrio tidak punya ruang untuk mapan.

■ Bila dicurigai, putuskan isolasi segera

Setelah terkonfirmasi di satu petak, penularan lewat air dan peralatan harus diputus. Gunakan peralatan terpisah per petak dan periksa jalur pembuangan. Terlambat sehari dalam keputusan ini berarti kehilangan petak-petak sebelahnya.

■ Catatan harian yang memungkinkan deteksi dini

Tanda pertama AHPND adalah turunnya konsumsi pakan. Mencatat pakan harian dan sisanya mengubah "kok lebih sedikit dari biasanya" dari firasat menjadi angka. Shrimp365 menyimpan catatan pakan dan kematian bersama-sama sehingga anomali cepat terlihat.

※ Ini panduan pengamatan lapangan dan tidak menggantikan diagnosis. Bila dicurigai, lakukan uji PCR di laboratorium kesehatan hewan akuatik.$cn$, array[$cn$/cardnews/id/ahpnd-early-signs/01.png$cn$,$cn$/cardnews/id/ahpnd-early-signs/02.png$cn$,$cn$/cardnews/id/ahpnd-early-signs/03.png$cn$,$cn$/cardnews/id/ahpnd-early-signs/04.png$cn$,$cn$/cardnews/id/ahpnd-early-signs/05.png$cn$,$cn$/cardnews/id/ahpnd-early-signs/06.png$cn$,$cn$/cardnews/id/ahpnd-early-signs/07.png$cn$]::text[], $cn$/cardnews/id/ahpnd-early-signs/01.png$cn$, array[$cn$AHPND$cn$,$cn$EMS$cn$,$cn$hepatopankreas$cn$,$cn$penyakit udang$cn$,$cn$vibrio$cn$,$cn$budidaya udang$cn$]::text[], true, now() - interval '3 hours'),
  ($cn$feeding-rate-calculation$cn$, $cn$id$cn$, $cn$Berhenti Memberi Pakan Berdasarkan Feeling — Begini Cara Menghitungnya$cn$, $cn$Hitung pakan harian dari biomassa × feeding rate, lalu verifikasi dengan anco dan sesuaikan. Pakan berlebih memboroskan biaya sekaligus merusak kualitas air.$cn$, $cn$Pakan menyumbang lebih dari separuh biaya produksi. Dan setiap kilo yang tersisa berubah menjadi amonia dan menyeret kualitas air ikut turun. Menebak jumlah pakan berarti kehilangan uang dan air sekaligus. Hitung, verifikasi, sesuaikan.

■ Langkah 1 — Hitung biomassa

Biomassa = jumlah udang yang hidup × bobot rata-rata

Misalnya Anda menebar 100.000 benur dan memperkirakan sintasan 85%, sehingga tersisa 85.000 ekor. Bila sampling memberi bobot rata-rata 10 g:

85.000 × 10 g = 850.000 g = 850 kg

Sintasan hanyalah perkiraan, jadi teruslah dikoreksi dengan respons anco dan catatan kematian.

■ Langkah 2 — Kalikan dengan feeding rate sesuai ukuran

Feeding rate adalah persentase pakan harian terhadap biomassa, dan menurun seiring udang membesar. Acuan umum:

1–3 g — 8–6% biomassa
3–5 g — 6–5%
5–10 g — 5–4%
10–15 g — 4–3%
15–20 g — 3–2,5%
Di atas 20 g — 2,5–2%

Untuk contoh di atas (850 kg, rata-rata 10 g) dengan 4%:

850 kg × 0,04 = 34 kg/hari

Itu total harian, biasanya dibagi 4–5 kali pemberian.

■ Langkah 3 — Wajib verifikasi dengan anco

Hasil hitungan hanyalah titik awal. Keputusan sebenarnya datang dari anco. Taruh 1–2% dari setiap pemberian di anco dan periksa setelah selang waktu yang ditetapkan.

Habis dalam 2 jam — kurang. Naikkan 5–10% mulai pemberian berikutnya.
Habis pas dalam 2–3 jam — tepat. Pertahankan.
Masih tersisa setelah 3 jam — berlebih. Kurangi 10–20%.

■ Kapan harus langsung dikurangi, terlepas dari hitungan

Suhu di bawah 26°C, oksigen terlarut di bawah 4 mg/L, periode molting massal, mendung lebih dari dua hari, amonia atau nitrit naik, dan setiap kecurigaan penyakit. Saat udang tidak makan, memberi pakan sesuai rumus mengubah seluruh ransum itu menjadi sumber pencemaran.

■ Gunakan FCR untuk mengukur mutu pengelolaan

Feed conversion ratio (FCR) = total pakan terpakai ÷ total pertambahan bobot

Angka 1,2–1,5 berarti pengelolaan Anda baik. Di atas 1,8 berarti pakan berlebih atau perkiraan sintasan salah. FCR bukan hanya angka akhir siklus — menghitungnya di tengah siklus memberi tahu apakah pengelolaan saat ini sudah benar.

■ Tanpa catatan, tidak ada perhitungan

Pakan harian, sisa pakan, bobot sampling, dan kematian semuanya harus dicatat agar perkiraan biomassa akurat — dan baru setelah itu perhitungannya bermakna. Shrimp365 mencatat semuanya per petak dan menampilkan tren pakan berikut FCR.$cn$, array[$cn$/cardnews/id/feeding-rate-calculation/01.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/02.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/03.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/04.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/05.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/06.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/07.png$cn$,$cn$/cardnews/id/feeding-rate-calculation/08.png$cn$]::text[], $cn$/cardnews/id/feeding-rate-calculation/01.png$cn$, array[$cn$feeding rate$cn$,$cn$FCR$cn$,$cn$biomassa$cn$,$cn$anco$cn$,$cn$manajemen pakan$cn$,$cn$budidaya udang$cn$]::text[], true, now() - interval '4 hours'),
  ($cn$mortality-diagnosis$cn$, $cn$id$cn$, $cn$Tabel Diagnosis Kematian — Di Mana Matinya Menunjukkan Penyebabnya$cn$, $cn$Persempit penyebab dari lokasi, waktu, kondisi cangkang, dan warna. Membedakan oksigen rendah, penyakit, keracunan, dan gagal molting.$cn$, $cn$Saat terjadi kematian, prioritasnya adalah mempersempit penyebab — karena penyebab yang berbeda menuntut penanganan yang bisa berlawanan. Memeriksa empat hal berikut menyelesaikan sebagian besar kasus.

■ Cek 1 — Di mana matinya?

Di tepi tambak, dekat permukaan — kemungkinan besar oksigen rendah atau keracunan akut. Udang berpindah ke sana karena tersiksa.

Di dasar tambak — kemungkinan besar penyakit, khususnya yang berjalan kronis seperti AHPND. Artinya udang bahkan tidak punya tenaga untuk bergerak.

Berkumpul di sekitar kincir — hampir pasti oksigen rendah.

■ Cek 2 — Kapan matinya?

Ditemukan menjelang subuh atau pagi — curigai oksigen rendah lebih dulu. Ini cocok dengan pola oksigen yang terkuras semalaman dan mencapai titik terendah sebelum matahari terbit.

Berlangsung pada siang hari — curigai lonjakan suhu, masuknya bahan beracun, atau perubahan kualitas air yang mendadak.

Beberapa ekor per hari selama beberapa hari — penyakit atau penurunan kualitas air yang kronis. Kematian yang menetes setiap hari justru sinyal paling berbahaya.

Tepat setelah ganti air atau hujan — perubahan salinitas atau suhu yang mendadak, atau air masuk yang tercemar.

■ Cek 3 — Bagaimana cangkangnya?

Cangkang keras, tubuh utuh — kejadian akut. Oksigen rendah atau keracunan. Udang normal sampai detik kematiannya.

Cangkang lunak, tubuh bening — kronis. Penyakit atau masalah nutrisi. Sudah lama tidak makan.

Cangkang terkelupas separuh — gagal molting. Disebabkan salinitas atau mineral (kalsium, magnesium) yang kurang saat periode molting, atau oksigen rendah di tengah proses molting.

■ Cek 4 — Bagaimana warna dan hepatopankreasnya?

Tubuh memerah — tanda stres berat atau infeksi akut.

Hepatopankreas pucat dan mengecil — curigai kuat AHPND. (Lihat postingan 04.)

Bintik hitam pada cangkang — penyakit cangkang akibat bakteri atau dasar tambak yang kotor.

Usus tengah kosong (garis gelap di punggung tidak terlihat) — sudah lama berhenti makan. Mengarah ke penyakit.

■ Ringkasan cepat

Subuh + tepi + cangkang keras → oksigen rendah
Dasar + berhari-hari + hepatopankreas pucat → penyakit seperti AHPND
Periode molting + cangkang terkelupas separuh → gagal molting (mineral, oksigen)
Tepat setelah ganti air + mendadak banyak → perubahan kualitas air atau masalah air masuk
Siang hari + mendadak + perilaku aneh → bahan beracun

■ Catat jumlah kematian setiap hari

Penilaian "hari ini kok terasa lebih banyak" hanya mungkin kalau ada angka kemarin. Bila kematian harian naik dari 5 menjadi 12 ekor, angkanya masih tampak kecil — padahal sudah lebih dari dua kali lipat, dan itulah saatnya bertindak. Begitu kematian sudah terlihat banyak, semuanya sudah terlambat.

Shrimp365 menyimpan angka kematian bersama catatan kualitas air dan pakan, sehingga Anda bisa menelusuri nilai mana yang bergerak lebih dulu sebelum kematian mulai naik.$cn$, array[$cn$/cardnews/id/mortality-diagnosis/01.png$cn$,$cn$/cardnews/id/mortality-diagnosis/02.png$cn$,$cn$/cardnews/id/mortality-diagnosis/03.png$cn$,$cn$/cardnews/id/mortality-diagnosis/04.png$cn$,$cn$/cardnews/id/mortality-diagnosis/05.png$cn$,$cn$/cardnews/id/mortality-diagnosis/06.png$cn$,$cn$/cardnews/id/mortality-diagnosis/07.png$cn$]::text[], $cn$/cardnews/id/mortality-diagnosis/01.png$cn$, array[$cn$kematian udang$cn$,$cn$analisis penyebab$cn$,$cn$oksigen rendah$cn$,$cn$molting$cn$,$cn$penyakit udang$cn$,$cn$budidaya udang$cn$]::text[], true, now() - interval '5 hours'),
  ($cn$community-board-open$cn$, $cn$id$cn$, $cn$Kami Membuka Forum Komunitas Budidaya Udang$cn$, $cn$Tempat berbagi pengalaman lapangan — kualitas air, penyakit, pakan, peralatan. Bisa dibaca tanpa login; hanya menulis yang perlu akun.$cn$, $cn$Sebagian besar masalah di tambak adalah masalah yang sudah pernah dialami orang lain. Persoalannya, pengalaman itu berhenti di ingatan satu orang dan tidak pernah sampai ke siapa pun. Karena itu kami membuka forum komunitas.

■ Apa saja yang dibahas di sini

Kualitas air — DO subuh terus turun, perlu berapa kincir lagi? Bagaimana salinitas air sumber di daerah Anda berubah menurut musim?

Penyakit — hepatopankreasnya seperti ini, apakah AHPND? Ada yang pernah melihat gejala begini?

Pakan — pada ukuran ini Anda memakai feeding rate berapa persen? Kalau respons anco seperti ini, bagaimana menyesuaikannya?

Peralatan — kincir merek apa yang Anda pakai? Alat ukur merek mana yang awet?

Bisnis — berapa FCR dan sintasan siklus ini? Bagaimana Anda menentukan waktu panen?

■ Bisa melampirkan foto

Unggah foto udang, warna air, anco, dan peralatan, maka jawaban yang Anda terima akan jauh lebih tepat. Kondisi hepatopankreas dan cangkang sulit dijelaskan dengan kata-kata — satu foto mengalahkan sepuluh baris tulisan.

■ Bisa dibaca tanpa login

Siapa pun yang datang dari mesin pencari bisa langsung membaca semuanya. Akun hanya diperlukan untuk menulis atau berkomentar, dan pendaftaran bisa lewat email atau langsung dengan Kakao maupun Google.

■ Terpisah menurut bahasa

Pengguna bahasa Korea, Inggris, Vietnam, dan Indonesia masing-masing hanya melihat postingan dalam bahasanya sendiri. Anda tidak perlu memilih apa pun — bahasa tulisan Anda dikenali otomatis.

■ Cara memulai yang baik

Kalau ini postingan pertama Anda, sebuah pertanyaan lebih berguna daripada perkenalan. Tuliskan saja apa yang paling mengganjal di tambak Anda sekarang. Begitu jawaban berdatangan, utas itu sendiri menjadi bahan bagi orang berikutnya.

Kalau Anda sudah pernah menyelesaikan sesuatu, tuliskan prosesnya. Satu kisah "begini kejadiannya, saya lakukan ini, hasilnya begini" lebih berguna daripada sepuluh halaman buku teks. Kegagalan bernilai persis sama.

■ Beberapa aturan main

Mohon jangan menyerang produk atau perusahaan tertentu. Ulasan berbasis pengalaman nyata selalu diterima. Bila informasi penyakit belum terkonfirmasi, tuliskan itu secara jelas — satu informasi keliru bisa menghancurkan tambak orang lain.

Forumnya ada di www.shrimp365.kr/board.$cn$, array[$cn$/cardnews/id/community-board-open/01.png$cn$,$cn$/cardnews/id/community-board-open/02.png$cn$]::text[], $cn$/cardnews/id/community-board-open/01.png$cn$, array[$cn$komunitas$cn$,$cn$forum$cn$,$cn$budidaya udang$cn$,$cn$berbagi pengetahuan$cn$,$cn$akuakultur$cn$,$cn$pengalaman$cn$]::text[], true, now() - interval '6 hours')
on conflict (slug, locale) do update set
  title      = excluded.title,
  summary    = excluded.summary,
  body       = excluded.body,
  images     = excluded.images,
  cover_url  = excluded.cover_url,
  tags       = excluded.tags,
  published  = excluded.published,
  updated_at = now();
