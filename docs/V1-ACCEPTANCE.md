# V1 qabul checklisti (pilot, 9-dekabr)

_Yangilanadi har kuni. Belgilar: ✅ o‘tdi · ❌ yiqildi · ⏳ kutilmoqda · — tegishli emas. “Lokal” = sintetik ma’lumotli lokal Postgres/Node; “Brauzer” = asoschi QA markazida; “Prod” = productionda tasdiqlangan._

## 8 ta oqim
| # | Oqim | Qadamlar | Lokal | Brauzer | Prod |
|---|---|---|---|---|---|
| 1 | Onboarding | Owner admin va mentor taklif qiladi → admin guruh yaratadi, talaba qo‘shadi → ota-ona Telegram’ga ulanadi → har kim to‘g‘ri sahifaga tushadi | ✅ SQL §1–3, §31 | ⏳ | ⏳ |
| 2 | Davomat | Mentor belgilaydi → admin ko‘radi → talaba o‘zinikini ko‘radi → ota-onaga Telegram (kelmadi/kechikdi) → owner foizni ko‘radi | ✅ SQL §3, §22, §31; e2e bot | ⏳ | ⏳ |
| 3 | To‘lovlar | Admin to‘lov yozadi (qisman ham) → owner hisobot → talaba balansi → ota-ona Telegram’da ko‘radi va xabar oladi → dublikat yo‘q | ✅ SQL §4, §26, §33; e2e dispatch | ⏳ | ⏳ |
| 4 | Uy vazifa | 3 usul (kutubxona, yuklash, AI) → tayinlash → talaba topshiradi → mentor tekshiradi → talaba natijani ko‘radi → owner ko‘radi | ✅ SQL §10–17 (AI/yuklash jonli emas) | ⏳ | ⏳ |
| 5 | Mock | Rejalashtirish → talaba topshiradi → avtomatik baho → mentor release → talaba va ota-ona (Telegram) ko‘radi | ✅ SQL §9, §20–21, §33 | ⏳ | ⏳ |
| 6 | Jadval | Admin jadval yaratadi/o‘zgartiradi → mentor, talaba, ota-ona bir xil ko‘radi → to‘qnashuv rad etiladi | ⚠️ yaratish ✅ §2; **o‘zgartirish UI yo‘q** | ⏳ | ⏳ |
| 7 | Ota-ona xavfsizligi | Begona Telegram rad → ikki bola o‘rtasida almashish → uzilgan link ishlamaydi | ✅ SQL §31, §33, §34; TS + e2e | ⏳ | ⏳ |
| 8 | KPI va natija | Owner haqiqiy yozuvlardan KPI → tushum − xarajat = sof naqd natija | ❌ xarajatlar va KPI RPC hali yo‘q | ⏳ | ⏳ |

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
