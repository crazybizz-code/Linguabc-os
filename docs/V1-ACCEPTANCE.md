# V1 qabul checklisti (pilot, 9-dekabr)

_Yangilanadi har kuni (oxirgi: 2026-11-25). Belgilar: ✅ o‘tdi · ❌ yiqildi · ⏳ kutilmoqda. “Lokal” = sintetik ma’lumotli lokal Postgres/Node testlari; “Lok. brauzer” = lokal Supabase-o‘xshash stackda Playwright (PR #37, `docs/LOCAL-QA.md`); “Brauzer” = asoschi QA markazida productionda; “Prod” = productionda tasdiqlangan._

## 8 ta oqim
| # | Oqim | Qadamlar | Lokal | Lok. brauzer | Brauzer | Prod |
|---|---|---|---|---|---|---|
| 1 | Onboarding | Owner admin va mentor taklif qiladi → admin guruh yaratadi, talaba qo‘shadi → ota-ona Telegram’ga ulanadi → har kim to‘g‘ri sahifaga tushadi | ✅ SQL §1–3, §31 | ✅ owner→admin/mentor taklif, join, guruh, talaba; ota-ona Telegram havolasi | ⏳ | ⏳ |
| 2 | Davomat | Mentor belgilaydi → admin ko‘radi → talaba o‘zinikini ko‘radi → ota-onaga Telegram (kelmadi/kechikdi) → owner foizni ko‘radi | ✅ SQL §3, §22, §31; e2e bot | ✅ mentor “kelmadi” → talaba ko‘radi | ⏳ | ⏳ |
| 3 | To‘lovlar | Admin to‘lov yozadi (qisman ham) → owner hisobot → talaba balansi → ota-ona Telegram’da ko‘radi va xabar oladi → dublikat yo‘q | ✅ SQL §4, §26, §33; e2e dispatch | ✅ qisman to‘lov, chek, ortiqcha rad, owner hisobot | ⏳ | ⏳ |
| 4 | Uy vazifa | 3 usul (kutubxona, yuklash, AI) → tayinlash → talaba topshiradi → mentor tekshiradi → talaba natijani ko‘radi → owner ko‘radi | ✅ SQL §10–17 (AI/yuklash jonli emas) | ✅ kutubxona usuli: tayinlash → topshirish 100% → mentor ko‘radi (yuklash/AI — kalit yo‘q) | ⏳ | ⏳ |
| 5 | Mock | Rejalashtirish → talaba topshiradi → avtomatik baho → mentor release → talaba va ota-ona (Telegram) ko‘radi | ✅ SQL §9, §20–21, §33; mentor rejalashtirishi §42 (PR #40) | ✅ mentor rejalashtiradi → ball → release → talaba ko‘radi (onlayn imtihon: lokal test materiali yo‘q) | ⏳ | ⏳ |
| 6 | Jadval | Admin jadval yaratadi/o‘zgartiradi → mentor, talaba, ota-ona bir xil ko‘radi → to‘qnashuv rad etiladi | ✅ §2; o‘zgartirish/bekor/ko‘chirish §40 (PR #38); Telegram §39 | ✅ yaratish, o‘zgartirish, bekor qilish, haqiqiy to‘qnashuv rad, talaba yangi vaqtni ko‘radi | ⏳ | ⏳ |
| 7 | Ota-ona xavfsizligi | Begona Telegram rad → ikki bola o‘rtasida almashish → uzilgan link ishlamaydi | ✅ SQL §31, §33, §34; TS + e2e | ✅ mentor Parents sahifasiga kira olmaydi | ⏳ | ⏳ |
| 8 | KPI va natija | Owner haqiqiy yozuvlardan KPI → tushum − xarajat = sof naqd natija | ✅ xarajatlar §38 (PR #37); KPI §41 (PR #39) | ✅ xarajat → sof naqd natija, bekor qilish; admin /finance ga kira olmaydi; KPI haqiqiy sonlar (1/10) | ⏳ | ⏳ |

## Hali tekshirilmagan
- Uy vazifa: **yuklash va AI** usullari — lokal AI kaliti yo‘q. Kerak: asoschi limitli test kalitini (OpenRouter, oylik limit $2) faqat lokal `.env.qa` ga qo‘yadi; DB limiti 20 so‘rov/soat amal qiladi.
- Onlayn mock imtihoni (Reading/Listening) — lokal kutubxonada nashr qilingan test yo‘q; sintetik test seed qilish rejada.
- Telegram — haqiqiy bot bilan, webhook yoqilgandan keyin.

## Rollar bo‘yicha qolgan ishlar
- **Owner:** xarajatlar + “sof naqd operatsion natija” (tasdiqlangan), DB’da hisoblanadigan mentor KPI, sozlamalar (telefon/manzil/vaqt mintaqasi), to‘lovlar guruh/davr filtri.
- **Admin:** talabani tahrirlash, guruhdan chiqarish/ko‘chirish, darsni bekor qilish/ko‘chirish UI.
- **Mentor / Student:** brauzerda tekshirish; tavsiyalar qoidalari.
- **Parent:** productionda yoqish (migratsiya → bot → webhook) va telefonda sinash.

## Asoschi uchun erta brauzer QA (bugundan, yangi migratsiyasiz)
Hozir productionda bor funksiyalar bilan. **Faqat QA markazida**: yangi markaz “QA Pilot” (slug `qa-` bilan boshlansin), test foydalanuvchilar telefon bilan. Har bir qadam uchun ✅/❌ va skrinshot.
1. **Owner:** markaz yaratish → admin va mentor taklif qilish (havolani boshqa brauzer/inkognitoda ochish).
2. **Admin:** filial, xona, kurs → guruh (mentor, jadval, xona) → bir xil vaqtga ikkinchi guruh (rad etilishi kerak) → 2 talaba + ota-ona → invoys → qisman to‘lov → chek.
3. **Mentor:** davomat (kelmadi/kechikdi) → kutubxonadan uy vazifa → AI bilan 5 savollik vazifa → PDF yuklash → mock rejalashtirish.
4. **Student:** vazifani topshirish → natija → jadval, davomat, progress → onlayn mock.
5. **Mentor:** tekshirish → mock natijasini release → talaba ko‘radi.
6. **Telefon:** 2–5-qadamlarni telefon brauzerida takrorlash (mobil ko‘rinish).
Oxirida QA markazi o‘chiriladi (SECURITY.md tartibida, asoschi tasdig‘i bilan).

## Lokal brauzer QA’da topilgan xatolar
| Sana | Xato | Holat |
|---|---|---|
| 2026-11-25 | Parents: Telegram havola dialogi yopilib qoladi (qator kaliti o‘zgaradi), admin havolani ko‘rmaydi | ✅ tuzatildi, PR #36 |
| 2026-11-25 | Parents: Telegram uchun yaratilgan hisobda “Invite to parent portal” xato beradi | ✅ tuzatildi, PR #36 |
| 2026-11-25 | Students ro‘yxati qisman to‘langanni “Pending” deb ko‘rsatadi (Payments’da “Partial”) | ✅ tuzatildi, PR #38 |
| 2026-11-25 | Talaba uy vazifasi tugmalari (Save/Submit) tarjima qilinmagan | ✅ tuzatildi, PR #38 |
| 2026-11-25 | Mentor mock rejalashtira olmaydi (V1 5.2), DB faqat staff’ga ruxsat bergan | ✅ tuzatildi, PR #40 |
| 2026-11-25 | Mock natijasi yuborilgandan keyin mentor sahifasi eski holatda qoladi | ✅ tuzatildi, PR #40 |
| 2026-11-25 | Lesson bildirishnomalari Telegram’da bolaning hozirgi guruhi tekshirilmay yuborilishi mumkin edi | ✅ tuzatildi, PR #35 |
