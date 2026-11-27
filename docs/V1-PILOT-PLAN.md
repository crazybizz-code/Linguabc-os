# V1 pilot rejasi (14 kun, bitta markaz)

_Tuzildi: 2026-11-25 (sprint 1-kuni). Sprint: 25-noyabr → 9-dekabr 2026. Bu hujjat yakuniy V1 doirasini kodga solishtiradi. Eski `V1-ROADMAP.md` dagi Click, 120 podkast, 5+5 mock kabi maqsadlar pilot uchun **kechiktirildi** (bekor qilinmadi)._

## Holat belgilari
- **E2E ✓** — to‘liq oqim brauzerda rol bo‘yicha tekshirilgan
- **QA kerak** — kod bor; SQL to‘plami (lokal Postgres) o‘tadi, lekin brauzerda rol bo‘yicha o‘tilmagan
- **Qisman** — bir qismi bor, pilot uchun nimadir yetishmaydi
- **Yo‘q** — kod yo‘q
- **Bloklangan** — tashqi narsa kerak (token, tasdiq)

Hozircha hech bir funksiya **E2E ✓** emas: agentlar production saytga kirmaydi, staging yo‘q, PR #32 dan keyin sahifalar brauzerda bosib chiqilmagan. Dalil sifatida fayl yo‘li va SQL test bo‘limi ko‘rsatilgan.

## A. Tayyorlik matritsasi

### Owner
| Funksiya | Holat | Dalil / izoh |
|---|---|---|
| To‘lovlarni kuzatish (invoys, tushum, qarz, overdue, qisman, tarix) | QA kerak | `payments/page.tsx`, `invoice_balances` view, `center_report` (0027, SQL §27). Guruh bo‘yicha kesim yo‘q |
| To‘lovlar guruh bo‘yicha | Qisman | Talaba bo‘yicha bor; guruh filtri yo‘q |
| Mentorlarni kuzatish | QA kerak | `mentors/page.tsx`: guruhlar, talabalar, davomat, uy vazifa, review navbati |
| Mentor KPI (aniq ta’riflangan) | Qisman | Ko‘rsatkichlar bor, lekin “davomat yozish to‘liqligi”, “review muddati” yo‘q; ta’riflar sahifada ko‘rsatilmagan; ma’lumot 1000 qator API chegarasida JS’da hisoblanadi |
| Talabalarni kuzatish / Student 360 | QA kerak | `students/[id]/page.tsx`, `progress/page.tsx` (#29) |
| Ota-ona monitoringi (bog‘langan / Telegram faol) | Qisman | `parents/page.tsx` web-login holatini ko‘rsatadi; Telegram holati yo‘q |
| Sozlamalar | Qisman | Faqat markaz nomi tahrirlanadi (`settings/centre-name.tsx`). `centers` da telefon/manzil ustuni yo‘q; vaqt mintaqasi faqat ko‘rinadi |
| Foyda (cash-based) | **Yo‘q** | Xarajatlar jadvali yo‘q (production: 32 jadval, `expenses` yo‘q). Tushum `center_report` da bor |
| Oylik moliyaviy trend | Qisman | `center_report.months` (6 oy tushum) bor; xarajat yo‘q |

### Admin
| Funksiya | Holat | Dalil / izoh |
|---|---|---|
| Davomat (guruh/sana, belgilash, tuzatish) | QA kerak | `attendance/`, `mark_attendance` (SQL §3, §22). Sana bo‘yicha tarix sahifasi sodda |
| Ota-ona bilan aloqa | Qisman | `parents/page.tsx` telefonlar; `tel:` havola va Telegram holati yo‘q |
| Guruh yaratish (mentor, jadval, xona) | QA kerak | `groups/create-group.tsx`, `create_group`, `generate_lessons`; xona/mentor to‘qnashuvi `exclude using gist` (0001) |
| Talabani guruhdan chiqarish / ko‘chirish | **Yo‘q** | Enrollment holatini o‘zgartiradigan RPC ham, UI ham yo‘q |
| Guruh jadvalini o‘zgartirish, darsni bekor qilish/ko‘chirish | **Yo‘q** (UI) | Triggerlar bor (`lesson_cancelled/moved`, 0022), lekin staff UI yo‘q |
| Talaba yaratish + ota-ona | QA kerak | 5 bosqichli wizard `students/add-student.tsx`, `create_student` |
| Talaba ma’lumotini tahrirlash | **Yo‘q** | Update RPC/UI yo‘q |
| To‘lov qabul qilish, qisman, chek | QA kerak | `record_payment`, append-only, ortiqcha to‘lov rad (SQL §4) |

### Mentor
| Funksiya | Holat | Dalil / izoh |
|---|---|---|
| Uy vazifa A: kutubxona | QA kerak | `homework/library/`, `assign_library_item`; 277 nashr qilingan element |
| Uy vazifa B: yuklash (PDF/DOCX/TXT/rasm) | QA kerak | `homework/new/upload`, AI ajratish; jonli tekshirilmagan |
| Uy vazifa C: AI | QA kerak | `homework/new/ai`; OpenRouter jonli ishlagan (2026-11-20) |
| Preview / tahrir / tasdiq / tayinlash | QA kerak | `question-editor.tsx`, `approve_assignment` (mentor drafti menejer tasdig‘ini talab qiladi) |
| Topshiriqlarni kuzatish, review | QA kerak | `homework/[id]/review.tsx`, `review_submission` (SQL §11–13) |
| Mock rejalashtirish, test tanlash, natija, release | QA kerak | `mocks/`, 0011/0019/0020 (SQL §9, §20, §21) |
| Davomat (faqat o‘z guruhlari) | QA kerak | `is_mentor_of_group` (SQL §3) |
| Shaxsiy jadval | QA kerak | `schedule/page.tsx` |

### Student
| Funksiya | Holat | Dalil |
|---|---|---|
| Uy vazifa paneli, topshirish, natija | QA kerak | `student/homework/`, `save_submission`, `my_homework_result` |
| Mock paneli, onlayn imtihon, release’dan keyin natija | QA kerak | `exam/[session]/[skill]`, server deadline, autosave (SQL §20) |
| Davomat | QA kerak | `portal-pages.tsx` |
| Jadval | QA kerak | `student/schedule` |
| Progress | QA kerak | `student/progress` (#29) |
| Tavsiyalar (qoidaga asoslangan) | Qisman | `student/plan` amaliyot tavsiyasi bor; past davomat / bajarilmagan vazifa qoidalari yo‘q |

### Parent (Telegram)
| Funksiya | Holat | Izoh |
|---|---|---|
| Bot, webhook, menyu | **Yo‘q** | `src/app/api/telegram` yo‘q |
| Xavfsiz bog‘lash | **Asos yozildi** | 0031 (bu branch), SQL §31. Productionga qo‘llanmagan |
| Ko‘p bola tanlash | **Asos yozildi** | `attach_guardian_to_parent`, `tg_children` |
| Jadval / davomat / to‘lov / vazifa / natija / aloqa | **Yo‘q** | Bo‘lim RPC’lari 2-PR’da |
| Bildirishnomalar | **Asos yozildi** | 0022 triggerlari → `telegram_outbox`; jo‘natuvchi yo‘q |
| Bot tokeni | **Bloklangan** | Asoschi BotFather’dan bot yaratib, tokenni Vercel’ga qo‘yishi kerak |

## B. Asosiy bo‘shliqlar (pilotni to‘xtatadiganlar)
1. **Telegram bot umuman yo‘q** — ota-onalar uchun yagona interfeys.
2. **Talabani tahrirlash, guruhdan chiqarish/ko‘chirish yo‘q** — har kuni kerak bo‘ladigan admin ishi.
3. **Dars jadvalini o‘zgartirish / darsni bekor qilish UI yo‘q** — 6-oqim (Timetable) o‘tmaydi.
4. **Xarajatlar va cash-based natija yo‘q** — 8-oqim (Profit) o‘tmaydi.
5. **Sozlamalarda telefon/manzil yo‘q** — botdagi “Markaz bilan aloqa” uchun kerak.
6. **Hech qaysi oqim brauzerda rol bo‘yicha tekshirilmagan** — 11–12-kunlarda asoschi bilan QA markazda.
7. **Production migratsiya tartibi:** 0029/0030 `main` da, lekin productionda yo‘q. 0031 ulardan mustaqil. Qaror: 0029/0030 ni avval qo‘llash (zararsiz, audio kesh) yoki 0031 ni tartibdan tashqari qo‘llash.
8. Kichik: `finish_ai_request` xarajatni chaqiruvchidan oladi; MFA `aal2` DB’da talab qilinmaydi; leaked-password himoyasi o‘chiq (Auth sozlamasi).

## C. Telegram bot arxitekturasi
**Ma’lumot:** alohida backend yo‘q. Next.js route `POST /api/telegram/webhook` (Vercel `fra1`) server-only service-role klient bilan **faqat** `tg_*` RPC’larini chaqiradi. Har bir RPC `security definer` va Telegram yuborgan `from.id` dan boshlab `app.tg_can_see_student` orqali tekshiradi (link → parent membership → guardians → student, bir markazda). Callback’dagi student id hech qachon o‘zi ishonchli emas. Service role faqat `service_role` ga berilgan funksiyalarni chaqiradi; jadvallarga to‘g‘ridan-to‘g‘ri so‘rov yo‘q.

**Bog‘lash (0031):**
1. Admin Parents sahifasida guardian uchun “Telegram havola” bosadi → `issue_telegram_link` (owner/admin, o‘z markazi). Guardian’da membership bo‘lmasa `parent` membership (`invited`, web-login shart emas) yaratiladi.
2. Token: 192 bit tasodifiy, 32 belgi, DB’da faqat SHA-256 xeshi. 24 soat, bir martalik, yangisi eskisini bekor qiladi.
3. Ota-ona `t.me/<bot>?start=<token>` ni ochadi (admin QR yoki SMS orqali beradi).
4. `tg_redeem_link`: xesh bo‘yicha `FOR UPDATE`, muddati/ishlatilgan/bekor/suspended tekshiriladi, faqat shaxsiy chat (`chat_id > 0`). Har qanday xato bir xil javob.
5. Ikkinchi bola: `attach_guardian_to_parent` (bir markaz, faqat parent akkaunt).
6. Uzish: admin `revoke_telegram_link` yoki botda “Uzish” (`tg_unlink`). Navbatdagi xabarlar `skipped`.

**Menyu (o‘zbekcha, inline tugmalar):** 👨‍🎓 Farzandim · 📅 Dars jadvali · ✅ Davomat · 💳 To‘lovlar · 📚 Uy vazifalari · 📊 Natijalar · 👨‍🏫 Guruh va mentor · ☎️ Markaz bilan aloqa · 🔌 Uzish. Bir nechta bola bo‘lsa avval bola tanlanadi; tanlov callback’da (`c:<student>:<bo‘lim>`), har bosishda qayta tekshiriladi.

**Webhook:** `X-Telegram-Bot-Api-Secret-Token` doimiy vaqtli taqqoslash; `tg_claim_update(update_id)` takrorni tashlaydi; har doim tez 200 qaytaradi; faqat `private` chat; `/start` dan boshqa matn menyuga yo‘naltiriladi.

**Bildirishnomalar:** 0022 triggerlari `app.notify` orqali bir tranzaksiyada `notifications` yozadi → 0031 trigger kerakli turlarni (`attendance`, `payment_due`, `payment_overdue`, `payment`, `lesson_cancelled`, `lesson_moved`, `mock_released`) `telegram_outbox` ga qo‘yadi. Demak xabar faqat o‘zgarish commit bo‘lsa navbatga tushadi; `(notification, link)` unique → dublikat yo‘q. Jo‘natuvchi: server action’dan keyin `after()` bilan darhol + qayta urinish uchun daqiqalik cron. 429 → `retry_after`, 403 → chat bloklangan deb belgilanadi, 6 urinishdan keyin `failed`. Matn o‘zbekcha `data` dan app’da quriladi (DB’dagi inglizcha matn ishlatilmaydi). Homework xabarlari hozircha faqat in-app (ortiqcha xabar bo‘lmasin).

**Cron varianti (tasdiq kerak):** Vercel Hobby cron kuniga 1 marta. Tavsiya: Supabase’da bepul `pg_net` kengaytmasini yoqish va `pg_cron` har daqiqada `/api/telegram/dispatch` ni maxfiy kalit bilan chaqiradi. Pullik navbat kerak emas.

**Migratsiyalar:** `0031_telegram_parents` (asos, yozildi), `0032_telegram_views` (bo‘lim RPC’lari: profil, jadval, davomat, to‘lov, vazifa, natija, aloqa — har biri `tg_can_see_student` bilan; kalitlar va release qilinmagan natijalar yo‘q), `0033` pg_net + dispatch cron (tasdiq bilan).

## D. 14 kunlik reja (bog‘liqlik tartibida)
| Kun | PR | Ish | Xavf |
|---|---|---|---|
| 1 | PR-1 | **Telegram DB asosi (0031) + SQL §31** — yozildi, shu branch | past |
| 2 | PR-2 | 0032 bot bo‘lim RPC’lari + SQL testlar | o‘rta |
| 2–3 | PR-3 | Webhook, menyu, bog‘lash, dispatch (`src/lib/telegram/`), TS unit testlar; Parents sahifasida “Telegram havola/QR”, holat, uzish | yuqori |
| 3–4 | PR-4 | Admin: talabani tahrirlash, guruhdan chiqarish/ko‘chirish (`set_enrollment_status`, `transfer_student`), dars bekor/ko‘chirish UI | o‘rta |
| 4–5 | PR-5 | Xarajatlar (minimal: sana, toifa, summa, izoh; append-only + void), Profit sahifasi: tushum − xarajat, “cash-based” yorlig‘i | o‘rta |
| 5 | PR-6 | Sozlamalar: telefon, manzil, vaqt mintaqasi (owner) | past |
| 6 | PR-7 | Mentor KPI RPC (DB’da hisob, ta’riflar ko‘rsatiladi): davomat yozish %, review %, o‘rtacha review vaqti, o‘tilgan/rejalashtirilgan darslar, talabalar vazifa % | o‘rta |
| 6–7 | PR-8 | To‘lovlar guruh/davr filtri; Parents: tel/Telegram holati | past |
| 7–8 | PR-9 | Talaba tavsiyalari (qoidalar: past davomat, bajarilmagan vazifa, zaif ko‘nikma) | past |
| 7–8 | — | 3 xil uy vazifa, mock oqimlarini QA markazda SQL orqali tekshirish; topilgan xatolar | yuqori |
| 9–10 | — | Botni asoschi telefonida sinash (QA markaz), bildirishnomalar | yuqori |
| 11–12 | — | 8 ta oqim × rollar, mobil, regressiya; asoschi brauzerda | yuqori |
| 13–14 | — | Production migratsiyalar (tasdiq bilan), deploy, onboarding checklist, xodimlar uchun qisqa yo‘riqnoma | — |

## E. Xavflar
1. **Brauzer QA faqat asoschi orqali** — agent kira olmaydi; asoschining vaqti eng tor joy. 7-kundan boshlab har kuni 30 daqiqa kerak.
2. **Bot tokeni va webhook domeni** — `app.linguabc.xyz` Vercel’ga ulanganmi, tasdiqlanmagan.
3. **Staging yo‘q** — har bir migratsiya production. Har biri alohida tasdiq + rollback izohi.
4. **Bildirishnoma cron’i** pg_net yoki tashqi chaqiruvchini talab qiladi.
5. **Uy vazifa yuklash/AI** jonli sinalmagan; AI xarajati va limitlari (20/soat).
6. **Ma’lumot hajmi:** ba’zi sahifalar JS’da hisoblaydi va 1000 qator chegarasiga tegadi; pilot hajmida muammo emas, KPI DB’da hisoblanadi.
7. **Pilot markaz ma’lumotlari** (talabalar ro‘yxati) qo‘lda kiritiladi — Excel import doiradan tashqarida.

## F. Birinchi vazifa (bajarildi, shu branch)
`0031_telegram_parents.sql` + SQL §31: tokenlar (xesh, 24 soat, bir martalik), linklar (bitta jonli link, faqat shaxsiy chat), update dedupe, outbox (commit’dan keyin, dublikatsiz, backoff, block), staff RPC’lari (issue/attach/revoke) va bot RPC’lari (faqat service role). Ilova kodi o‘zgarmagan. Productionga **qo‘llanmagan**.

Rollback: 0031 dagi 4 jadval va funksiyalarni o‘chirish, `app.notify` ni 0022 dagi holatiga qaytarish. Mavjud qatorlar o‘zgarmaydi.
