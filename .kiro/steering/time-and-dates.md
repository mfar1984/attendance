# Tarikh dan masa

Ada **dua domain** dalam sistem ini dan ia tidak boleh bercampur. Mencampurnya pernah
menyebabkan setiap tarikh kerja tersimpan sehari lebih awal, dan kerugian itu berkumpul
pada setiap pusingan baca-tulis. Ia hanya muncul dalam export payroll.

#[[file:apps/server/src/time.ts]]

## Domain 1 — saat (instant)

Satu titik pada garis masa. Cap masa sebenar: `punchAt`, `occurredAt`, `eventTime`,
`createdAt`, `scheduledStart`, `checkInAt`.

| Fungsi | Guna untuk |
|---|---|
| `zonedStartOfDay(instant, tz)` | permulaan tetingkap shift, punch terawal yang boleh dimiliki hari itu |
| `zonedTimeOnDay(day, 'HH:mm', tz)` | waktu jam-dinding pada satu hari |
| `zonedDateKey(instant, tz)` | kunci pengumpulan bagi **cap masa** |
| `formatZonedTime`, `addMinutes`, `minutesBetween` | aritmetik saat |

## Domain 2 — tarikh kalendar (date-only)

Tarikh tanpa masa dan tanpa zon. Lajur ini adalah `@db.Date`:

```
attendance_records.workDate      attendance_exceptions.workDate
roster_entries.workDate          holidays.date
leave_requests.fromDate/toDate   staff.hireDate
```

| Fungsi | Guna untuk |
|---|---|
| `zonedDateOnly(instant, tz)` | saat → tarikh kalendar tempatan |
| `asDateOnly(value)` | normalkan nilai yang sudah bermaksud tarikh (mis. dari `z.coerce.date()`) |
| `dateOnlyFromKey('2026-08-29')` | rentetan → tarikh kalendar |
| `dateOnlyKey(value)` | tarikh kalendar → `'2026-08-29'` |
| `eachDateOnly(from, to)`, `dateOnlySpan`, `addDateOnlyDays` | lelaran dan jarak hari |
| `timeOnDateOnly(dateOnly, 'HH:mm', tz)` | jambatan balik ke domain saat |

## Peraturan

**Jangan sekali-kali simpan `zonedStartOfDay()` ke dalam lajur `@db.Date`.** Prisma
memotong `Date` kepada MySQL `DATE` menggunakan bahagian **UTC**-nya. `zonedStartOfDay`
memulangkan *saat* tengah malam tempatan — untuk Malaysia itu 16:00 UTC hari sebelumnya —
jadi ia tersimpan sebagai hari yang salah. Dan kerana nilai yang dibaca semula disuap ke
query berikutnya, geseran itu berganda: luluskan cuti lalu batalkan, julat sudah bergerak
dua hari.

**Tarikh kalendar adalah tengah malam UTC hari yang dimaksudkan.** Itu satu-satunya
perwakilan yang bertahan pusingan baca-tulis. UTC juga tiada penjimatan cahaya siang,
jadi langkah 24 jam adalah tepat.

**`z.coerce.date()` pada `'2026-08-29'` sudah betul** — ia menghasilkan tengah malam UTC.
Hantar melalui `asDateOnly()` untuk membuang mana-mana komponen masa, bukan melalui
`zonedStartOfDay()`, yang akan merosakkannya.

**`getUTCFullYear()`, bukan `getFullYear()`,** pada nilai tarikh kalendar. Permohonan
1 Januari akan jatuh ke baki tahun sebelumnya kalau dibaca secara tempatan.

**`dateOnlyKey()`, bukan `zonedDateKey()`,** pada nilai yang dibaca dari lajur `@db.Date`.
Ia sudah dalam UTC; menukarnya lagi menggerakkan hari. Kedua-dua sisi perbandingan kunci
mesti guna fungsi yang sama — dalam enjin kehadiran, kunci cuti umum dan kunci hari mesti
sepadan, dan menukar satu sisi sahaja mematikan pengesanan cuti umum secara senyap.

**Julat laporan bawa kedua-dua bentuk.** `Period` dalam `routes/reports.ts` ada
`from`/`to` (kalendar, untuk lajur `@db.Date`) dan `startsAt`/`endsAt` (saat, untuk
`occurredAt` dan `eventTime`). Menapis cap masa dengan tarikh kalendar akan terlepas
lapan jam di setiap hujung yang sepatutnya milik hari tempatan.

**Di web: `formatDateOnly()` untuk medan kalendar, `formatDate()` untuk cap masa.**
`formatDateOnly` memotong sepuluh aksara pertama dan tidak melibatkan zon sama sekali.
`new Date(iso).toLocaleDateString()` pada nilai kalendar akan mendarat pada hari sebelumnya
untuk sesiapa di barat pelayan.

**Enjin tidak pernah mengira hari yang belum berlaku.** `recomputeRange` mengapit hujungnya
pada hari ini. Hari yang belum berlaku tidak boleh menjadi ketidakhadiran, dan menulisnya
menggelembungkan setiap laporan sambil kelihatan berwibawa.

## Regresi

`scripts/test-time.mts` adalah suite bagi kedua-dua domain, termasuk zon di barat UTC dan
sempadan DST. Jalankan selepas menyentuh apa-apa dalam `time.ts`:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/test-time.mts
```

`scripts/verify-leave.mts` menegakkan invarian hujung-ke-hujung: julat yang disimpan mesti
julat yang dimohon, dan baris roster yang ditulis mesti hari yang dicaj.
