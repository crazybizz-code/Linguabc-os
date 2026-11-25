# Telegram migratsiyalarini productionga qo‘llash (taklif, tasdiq kutilmoqda)

_2026-11-25. **Hech qanday production migratsiyasiga ruxsat yo‘q.** Bu hujjat — asoschi tasdiqlashi uchun aniq tartib._

## Faktlar (production, faqat o‘qib tekshirildi)
- `supabase_migrations.schema_migrations`: 0001–0028 yozuvlari. Har birining `version` i — **qo‘llangan vaqt** (`20261121073304` kabi), `name` i — fayl nomi (`0028_practice`). Ular avval Supabase MCP `apply_migration` orqali bittadan qo‘llangan.
- Repo’dagi fayllar `0001_...sql` deb nomlangan. `supabase db push` versiyani fayl nomidan (`0001`) oladi va productiondagi vaqt-versiyalarga mos kelmaydi: u **hamma faylni qaytadan** qo‘llashga urinadi. Shuning uchun `db push` ishlatilmaydi, `migration repair` ham ishlatilmaydi.
- 0029/0030 (audio V2) `main` da, productionda yo‘q va qo‘llanmaydi.
- `pg_cron` o‘rnatilgan, `pg_net` mavjud lekin o‘rnatilmagan, `supabase_vault` o‘rnatilgan.

## Nega tartibdan tashqari qo‘llash xavfsiz
| Tekshiruv | Natija (lokal Postgres 16) |
|---|---|
| 0031/0032 0029/0030 obyektlariga tayanmaydi | `PROD_SHAPE=1 run.sh`: 0029/0030 siz butun to‘plam (§1–28, §31, §33, §34) o‘tdi |
| 0029/0030 0031/0032 o‘zgartirgan obyektlarga tegmaydi (`app.notify`, `centers`) | grep: tegmaydi |
| Keyinchalik 0029/0030 qo‘llansa ham ishlaydi | `30_migration_order.sh` §35: 0028 → 0031 → 0032 → 0029 → 0030 xatosiz |
| Rollback sxemani aynan 0028 holatiga qaytaradi | §36: `pg_dump -s` farqi bo‘sh; qayta qo‘llash ham ishlaydi |

Tarix to‘g‘ri bo‘lib qoladi: jadvalda nima, qachon qo‘llangani yoziladi; 0029/0030 qo‘llanmagani uchun yo‘q. Bu `CURRENT-STATE.md` da qayd etiladi.

## Tartib (har bir qadam alohida tasdiq bilan)
**0. PR ko‘rib chiqiladi va merge qilinadi** (asoschi). Qo‘llanadigan fayl — `main` dagi aniq commit’dagi fayl.

**1. Oldindan tekshiruv (faqat o‘qish):**
```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;  -- oxirgisi 0028_practice
select to_regclass('public.telegram_links'), to_regclass('public.telegram_outbox');             -- ikkalasi null
select count(*) from centers; select count(*) from memberships; select count(*) from notifications; -- “barmoq izi”
select jobname from cron.job;                                                                     -- o‘zgarmasligi kerak
```

**2. 0031 ni qo‘llash:** MCP `apply_migration`, `name = '0031_telegram_parents'`, `query` = fayl matni o‘zgarishsiz. Bitta tranzaksiya: xato bo‘lsa hech narsa qolmaydi.

**3. 0031 dan keyingi tekshiruv** — bitta tranzaksiyada, oxirida `rollback`:
- vaqtinchalik `qa-tg` markaz va `qa.*@linguabc.test` foydalanuvchilar yaratiladi;
- owner sifatida `issue_telegram_link`; begona foydalanuvchi `forbidden` oladi;
- `service_role` sifatida token qabul qilinadi, `tg_children` faqat o‘z bolasini qaytaradi;
- `authenticated` `tg_children` ni chaqira olmaydi (`permission denied`);
- `rollback`; keyin “barmoq izi” qayta solishtiriladi (o‘zgarmagan bo‘lishi kerak).
- Advisor: `get_advisors(security)` — yangi ogohlantirishlar ko‘rib chiqiladi.

**4. 0032 ni qo‘llash** (`name = '0032_telegram_views'`) va xuddi shunday rollback bilan tekshirish: menyu funksiyalari, begona bola → `forbidden`.

**5. Yozib qo‘yish:** `CURRENT-STATE.md` — qachon, qaysi commit, tekshiruv natijalari.

Webhook bu bosqichda **yoqilmaydi**: 0031/0032 qo‘llansa ham, bot tokeni va webhook bo‘lmasa hech kimga xabar ketmaydi. Outbox’da navbat yig‘ilmaydi, chunki hech kim bog‘lanmagan (link yo‘q → navbat yo‘q).

## Xavflar
| Xavf | Ehtimol | Choralar |
|---|---|---|
| `app.notify` almashtiriladi — barcha bildirishnomalar shu orqali o‘tadi | past | Yangi shart faqat **qo‘shadi** (`invited` + jonli Telegram link). Link bo‘lmaguncha xatti-harakat 0022 bilan bir xil. SQL §22, §26 o‘tadi |
| `notifications` ga yangi trigger | past | Link bo‘lmasa trigger hech narsa yozmaydi; xato bo‘lsa bildirishnoma tranzaksiyasi ham to‘xtaydi — shuning uchun lokal to‘plam `mark_attendance`, `record_payment`, eslatmalarni to‘liq sinaydi |
| `centers` ga ustun qo‘shish (0032) | juda past | `null` ruxsat etilgan, default yo‘q — jadval qayta yozilmaydi |
| Tarixda raqam bo‘shlig‘i (0029/0030 yo‘q) | — | Hujjatlashtiriladi; keyin qo‘llash tartibi §35 da sinalgan |

## Rollback
- 0032: `supabase/rollback/0032_telegram_views.down.sql` (avval).
- 0031: `supabase/rollback/0031_telegram_parents.down.sql` (keyin).
- Yo‘qotiladi: Telegram linklari va navbat (ota-onalar qayta bog‘lanadi), Settings’da kiritilgan markaz telefoni/manzili. `issue_telegram_link` yaratgan `invited` parent a’zoliklar qoladi (ishlatilmagan web taklif kabi, zararsiz).
- Rollback’dan keyin `schema_migrations` dagi 0031/0032 yozuvlari **o‘chirilmaydi**, balki `0031_telegram_parents_rollback` nomli yozuv sifatida rollback ham `apply_migration` orqali qo‘llanadi — tarix haqiqatni ko‘rsatadi.

## 0033 (keyinroq, alohida tasdiq)
`pg_net` yoqish, Vault’da dispatch kaliti va URL, `pg_cron` har daqiqada (faqat navbatda xabar bo‘lsa HTTP chaqiradi) va kunlik tozalash. Bu production konfiguratsiyasini o‘zgartiradi — alohida so‘raladi.
