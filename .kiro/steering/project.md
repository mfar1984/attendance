# Sistem Kehadiran Hospital Sibu

Kehadiran untuk ~5000 staf, dipacu terminal pengecaman muka Hikvision
DS-K1T342MFX-E1 melalui ISAPI. Antara muka dalam Bahasa Melayu.

**Susunan:** monorepo npm workspaces — `apps/server` (Fastify + Prisma + MySQL),
`apps/web` (Vite + React + React Router + Tailwind), `packages/hik-isapi` (klien
peranti), `packages/shared` (skema Zod dikongsi).

## Prinsip asas

**Log mentah tidak boleh diubah; segala-galanya lain diterbitkan.** `RawEvent` dan
`Punch` adalah rekod apa yang terminal laporkan. `AttendanceRecord`,
`AttendanceException` dan setiap angka laporan dikira daripadanya. Sebab itu
`recomputeRange` boleh dijalankan semula selepas jam terminal dibetulkan, selepas
peraturan shift bertukar, atau selepas pemetaan identiti diperbaiki.

**Betulkan puncanya, jangan sunting hasilnya.** Kalau satu hari salah, cari sebabnya
dan jalankan kira semula. Menyunting `AttendanceRecord` secara terus memusnahkan
satu-satunya hubungan antara angka dan buktinya.

## Arahan

Pelayan pembangunan dijalankan **secara manual** oleh pengguna, bukan oleh agen —
kedua-duanya proses menonton yang tidak akan tamat.

```powershell
cd apps\server; npm run dev      # port 8080, tsx watch
cd apps\web;    npm run dev      # port 5173
```

```powershell
cd apps\server; npx tsc --noEmit
cd apps\web;    npx tsc --noEmit; npx vite build
```

**Prisma perlu `DATABASE_URL` ditetapkan secara manual.** Konfigurasi Prisma tidak
membaca `.env` di akar repo, jadi tanpa ini ia gagal dengan
`PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`:

```powershell
cd apps\server
$env:DATABASE_URL = (Select-String -Path ..\..\.env -Pattern '^DATABASE_URL=' | ForEach-Object { $_.Line -replace '^DATABASE_URL=','' }).Trim('"')
npx prisma db push; npx prisma generate
```

```powershell
cd apps\server; npx tsx --env-file=../../.env src/seed.ts    # seed
$env:MYSQL_PWD='root'; mysql -u root hospital --table -e "SELECT …"
```

## Skrip verifikasi

Dalam `scripts/`, dijalankan terhadap pelayan yang sedang hidup. Ia menegakkan
tingkah laku, bukan hanya bentuk balasan — sebab itu ia menangkap perkara yang
`tsc` tidak dapat.

```powershell
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/<nama>.mts "<kata-laluan-admin>"
```

Kata laluan dan rahsia TOTP ada dalam `.env`. **Jangan tulis kredential ke dalam
mana-mana fail steering atau fail yang dijejak** — hantar sebagai argumen.

| Skrip | Menegakkan |
|---|---|
| `test-time` | kedua-dua domain masa; tiada pelayan diperlukan |
| `verify-screens` | setiap skrin ada medan yang lajurnya baca, dan tiada endpoint membocorkan kredential |
| `verify-leave` | kelulusan menulis roster + kira semula; pembatalan membuangnya; pengawal 409 |
| `verify-reports` | subtotal jabatan sepadan jumlah organisasi; amaran ada dalam fail CSV |
| `verify-email` | membangkitkan pelayan SMTP sebenar pada loopback; mesej benar-benar sampai |
| `verify-sms` | stand-in Infobip pada loopback; menegaskan permintaan yang gateway sebenar terima |
| `verify-telegram` | membangkitkan pelayan sendiri dengan `TELEGRAM_API_BASE` ke stand-in loopback |
| `verify-schedule` | shift melintas tengah malam; tetingkap toleransi bertindih ditolak |
| `verify-public-api` | setiap lapisan pengawal API awam, dengan memicunya |
| `verify-webhooks` | penerima sebenar pada loopback; tandatangan disahkan seperti penerima |
| `verify-security` | setiap knob tab Keselamatan dikuatkuasakan, bukan hanya disimpan |
| `verify-config` | tab Konfigurasi Umum: had nilai per-kunci, muat naik logo, jadual backup + pruning, mod penyelenggaraan tidak menyekat ingest |
| `verify-profile` | sempadan profil layan-diri: medan HR tidak boleh ditulis, kata laluan semasa diperlukan, sesi lain dibatalkan tetapi bukan yang ini |
| `verify-settings`, `verify-users`, `verify-org`, `verify-retention`, `verify-operations` | seperti namanya |

Tiga yang terakhir dijelaskan dalam steering `api-security`, termasuk dua perangkapnya.

Empat yang perlu diketahui sebelum memburunya:

- **`verify-identity`** gagal 2 semakan pada larian kedua. Skrip itu mengesahkan satu
  pemetaan, jadi larian seterusnya tidak menemui apa-apa yang belum disahkan. Masalah
  fikstur, bukan regresi.
- **`verify-api`** tergantung pada kira semula seluruh organisasi (5002 staf × 59 hari).
  Uji laluan itu atas tetingkap kecil dengan `staffIds` sebaliknya.
- **Jangan jalankan semua skrip berturut-turut tanpa jeda.** Ada had kadar global 300
  permintaan/minit per alamat dalam `app.ts`. Membakarnya menjadikan skrip seterusnya gagal
  di tengah jalan dengan setiap semakan berkata `... responds` gagal — yang terbaca sebagai
  regresi luas dan bukan sebagai 429. `Start-Sleep -Seconds 8` cukup antara skrip kecil;
  selepas skrip besar seperti `verify-screens` atau `verify-public-api`, biarkan
  **`Start-Sleep -Seconds 75`** supaya tingkap satu minit itu tamat sepenuhnya.
- **Skrip yang mengimport `apps/server/src/db.js` akan memulakan semula pelayan
  pembangunan.** Klien Prisma dibina secara lazy dan membinanya menulis ke
  `node_modules/.prisma/client`, yang diperhatikan oleh `tsx watch`. `verify-public-api`,
  `verify-webhooks` dan `verify-security` memanggil `warmUpPrisma()` dahulu supaya
  permulaan semula itu berlaku sebelum penegasan pertama dan bukan di tengah-tengahnya.
  Skrip baharu yang mengimport `db.js` perlukan corak yang sama.
- **Gelung `foreach` berbilang baris kadang-kadang menelan output** dalam shell ini. Jalankan
  skrip satu-satu, atau rangkaikan dengan `;` pada satu baris.
- **`verify-security` dan `verify-profile` menukar kata laluan admin.** Kedua-duanya ada
  jaring `uncaughtException`/`unhandledRejection` yang memulihkannya. Kalau larian gagal di
  tengah dan jaring itu juga gagal, kata laluan mungkin tertinggal sebagai `Sement4ra!`
  (verify-security) atau `Sement4raProfil!` (verify-profile) — log masuk dengannya dan tukar
  semula di Profil Saya. Larian seterusnya akan gagal pada `logged in` sampai itu dibetulkan.

## Persekitaran

Peranti `https://192.168.1.250`, MySQL pangkalan data `hospital`. Zon waktu organisasi
datang daripada `ORG_TIMEZONE`, bukan daripada jam pelayan. `REQUIRE_ADMIN_2FA=false`
dalam pembangunan — hidupkan semula untuk produksi.
