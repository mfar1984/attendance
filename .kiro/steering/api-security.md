# API awam, webhook dan keselamatan

Tiga permukaan yang boleh dicapai dari luar aplikasi. Setiap keputusan di bawah menyelesaikan
masalah tertentu; menukarnya tanpa membaca sebabnya akan membuka semula masalah itu.

#[[file:apps/server/src/api/guard.ts]]

## Lapisan pengawal

`requireApiScope(screen, action)` dalam `api/guard.ts` adalah satu-satunya pintu ke setiap
route awam. Urutannya termurah dan paling sedikit mendedah dahulu.

| Lapisan | Gagal → | Sebab kod itu |
|---|---|---|
| `enabled` | **404** | Endpoint yang mengaku ia wujud adalah endpoint yang berbaloi dicuba lagi. |
| senarai putih IP | **404** | Alamat yang tidak dibenarkan tidak patut belajar endpoint itu wujud. |
| token | **401** | Sebab penolakan (unknown/expired/revoked) **tidak** diberitahu pemanggil — memberitahunya mengesahkan tekaan menamakan token nyata. |
| skop | **403 + nama skop** | Pemanggil sudah disahkan, jadi menamakan skop membantu pemilik token. |
| had kadar | **429 + `retry-after`** | |

**Penolakan sentiasa dilog, walaupun `logRequests` dimatikan.** Tetapan itu mengawal bunyi
trafik yang berjaya. Panggilan yang ditolak ialah yang penting.

**Tolak `enabled && !requireToken && ipWhitelist kosong` dengan 409.** Itu direktori staf
terbuka kepada apa-apa yang boleh menghubungi port. Dibenarkan di belakang senarai putih pada
VLAN terpencil; tidak dibenarkan secara tidak sengaja.

**CIDR ditulis sendiri** dalam `addressMatches()` — v4 dan v6, kira-kira 30 baris.
Kebergantungan rantaian pembekal pada kawalan akses ialah pertukaran yang buruk.

## Token

**SHA-256, bukan argon2.** Nilainya 192 bit rawak; KDF perlahan wujud untuk membuat tekaan
pilihan manusia berentropi rendah menjadi mahal, dan di sini ia hanya menambah latensi pada
setiap permintaan. Hash juga menjadikan pengesahan satu carian berindeks.

**Prefiks `hka_` + 8 aksara** disimpan berasingan supaya log boleh menamakan token, dan supaya
token yang terbocor boleh di-grep dalam repo atau log.

**Nilai dipaparkan sekali sahaja**, dalam balasan kepada permintaan yang menciptanya. Tiada
endpoint memulangkannya. Endpoint yang mengulang kredensial tersimpan menjadi cara termudah
mengekstraknya. Kalau hilang: putar.

**Skop hanya `view` dan `export`**, diterbitkan dari `PERMISSION_SECTIONS` supaya token tidak
boleh diberi sesuatu yang aplikasi tidak ada. Skop tulis akan membenarkan token mengubah
kehadiran tanpa seorang pun dilampirkan pada perubahan itu, dan jejak audit dibina atas
sentiasa ada seorang.

**TIADA putaran automatik.** Reka bentuk rujukan ada togol "rotate daily"; ia ditolak. Memutar
kredensial statik pada pemasa memutuskan setiap integrasi yang memegangnya, secara senyap, pada
waktu pemasa berbunyi. Ganti: putaran eksplisit + tempoh rahmat.

```
POST /api/api-tokens/:id/rotate
  → token baharu dikeluarkan, skop dibawa (bukan dipilih semula)
  → yang lama dapat supersededAt, graceUntil, rotatedToPrefix
  → yang lama terus berfungsi sehingga graceUntil, kemudian 401
```

Alternatifnya — batal lalu cipta — menggagalkan setiap panggilan antara dua langkah itu.

**Token hidup tidak boleh dibuang (409).** Batalkan dahulu. Membuang barisnya
menghilangkan rekod apa yang dibenarkannya sedangkan log aktiviti masih merujuk prefiksnya.

## Webhook

#[[file:apps/server/src/api/webhooks.ts]]

**Tandatangan gaya Stripe:** `X-Kehadiran-Signature: t=<unix>,v1=<hmac-sha256 hex>` atas
`"<t>.<badan mentah>"`, toleransi 300 saat, dibandingkan dengan `timingSafeEqual`.

Cap masa **di dalam** bahan yang ditandatangan. Tandatangan atas badan sahaja masih betul bila
dimainkan semula sebulan kemudian. `v1` adalah tag versi supaya algoritma boleh bertukar tanpa
penerima meneka.

Penerima mesti mengesahkan **bait mentah**, bukan salinan yang di-serialisasi semula.

**`checkTarget()` menyelesaikan nama host melalui DNS sebelum memutuskan.** Semakan atas teks
URL dipintas oleh mana-mana nama yang menunjuk ke `169.254.169.254` — endpoint metadata awan
yang memberikan kredensial instance kepada sesiapa yang bertanya, tanpa pengesahan. Menyediakan
rekod DNS begitu kos penyerang hampir sifar.

Disemak **semula pada setiap cubaan penghantaran**, bukan hanya semasa disimpan. DNS boleh
ditukar arah selepas langganan dicipta, dan itulah sebab menyelesaikan dan bukan memadan teks.

**Julat disekat:** `169.254.0.0/16`, `0.0.0.0/8`, `100.64.0.0/10`, `224.0.0.0/4`,
`240.0.0.0/4`, `fe80::/10`, `ff00::/8`.

**`http` hanya untuk julat persendirian.** Ke alamat awam ia menghantar muatan dan tandatangan
dalam bentuk jelas.

**4xx TIDAK diulang; 5xx dan kegagalan rangkaian diulang 3 kali** (jeda 2s, 4s). Penerima yang
menjawab 4xx faham permintaan itu dan menolaknya; menghantarnya tiga kali lagi hanya
menghasilkan tiga lagi entri dalam log mereka.

**Cap masa dan `id` peristiwa sama merentas cubaan semula**, supaya penerima yang sudah menerima
cubaan pertama boleh mengenali cubaan kedua dan ketiga sebagai peristiwa yang sama.

**Auto-matikan selepas 20 kegagalan berturut-turut**, dengan `disabledReason` yang menyatakan
sebabnya. Gelung cuba semula tanpa henti terhadap host yang sudah seminggu hilang tidak dapat
dibezakan daripada imbasan keluar, dan firewall penerima yang perasan dahulu. Menghidupkannya
semula mengosongkan `failureCount` — kalau tidak ia terbaca sebagai aktif sambil masih membawa
sebab ia dihentikan.

**Setiap cubaan ditulis ke `webhook_deliveries`,** termasuk sasaran yang ditolak sebelum
sebarang HTTP berlaku. Tanpa baris itu log kosong dan skrin memaparkan webhook yang seolah-olah
tidak pernah berbunyi.

**`requestBody` disimpan tetapi tidak dihidangkan** oleh `GET /api/webhooks/:id/deliveries`.
Ia bahan yang tandatangan lindungi, dan log itu skrin yang sesiapa dengan kebenaran `view`
boleh buka.

**`webhook.test` bukan dalam `NOTIFICATION_TRIGGERS`** — sengaja. `deliver()` dipanggil terus
untuk ujian dan memintas penapis langganan, jadi ujian berfungsi walaupun langganan dimatikan.
Itu diperlukan: anda menguji selepas membetulkan sesuatu.

## Dasar keselamatan

#[[file:apps/server/src/security/policy.ts]]

`securityPolicy()` cache 5 saat. Lima knob, semuanya benar-benar dibaca:

| Knob | Dibaca oleh | Lantai skema |
|---|---|---|
| `maxFailedLogins` | `auth/service.ts` `registerFailedLogin()` | 3–50 |
| `lockoutMinutes` | sama | 1–1440 |
| `passwordMinLength` | `assertPasswordAcceptable()`, dipanggil oleh kedua-dua laluan kata laluan dalam `routes/settings.ts` | 8–128 |
| `tokenDefaultDays` | `POST /api/api-tokens` bila `expiresInDays` tiada | 0–3650 (0 = tanpa luput) |
| `rotationGraceHours` | `POST /api/api-tokens/:id/rotate` | 1–720 |

**Lantai adalah penolakan (400), bukan pengapitan senyap.** Nilai yang dinaikkan senyap ke
lantai meninggalkan skrin memaparkan satu nombor dan pelayan menguatkuasakan yang lain.

**`REQUIRE_ADMIN_2FA` dan `SESSION_TTL_HOURS` adalah env, dipapar BACA-SAHAJA.** Ia dibaca
sekali semasa boot. Menjadikannya boleh disunting akan menghasilkan kawalan yang senyap tidak
berbuat apa-apa — lebih buruk daripada tiada kawalan.

**Skrin `settings.security` berasingan dari `settings.integration.api`.** Memutuskan dasar
lockout dan memutuskan siapa boleh mengeluarkan token API adalah kerja berbeza, dipegang oleh
orang berbeza. `settings.security` ada `['view','edit']` sahaja — tiada apa untuk dicipta.

**Menukar kata laluan membatalkan sesi yang dibuka dengan yang lama.** Ditegakkan dalam
`verify-security`. Penukaran kata laluan yang membiarkan sesi lama hidup tidak membatalkan
apa-apa, dan itulah sebab seseorang menukarnya selepas kebocoran disyaki.

## Kredensial write-only, merentas semua saluran

Tiada endpoint memulangkan rahsia tersimpan, walaupun dalam bentuk yang disulitkan. Hanya
bendera kehadiran:
`apiKeySet`, `botTokenSet`, `passwordSet`, `secretSet`. Kosong bermakna **kekalkan**; membuang
perlukan bendera eksplisit (`clearApiKey`, `clearBotToken`). Rahsia webhook dan token API
dipaparkan **sekali** semasa dicipta, dan `RevealSecret` dalam
`apps/web/src/components/RevealSecret.tsx` adalah satu-satunya tempat itu berlaku.

`verify-screens` menegakkannya: `tokenhash` dan `secretencrypted` ada dalam senarai kebocoran
bersama `passwordhash` dan `totpsecret`. Ia juga menegaskan prefiks **masih** dipulangkan,
supaya semakan itu tidak boleh dipuaskan dengan membuang pengenal bersama rahsia.

## Skrip verifikasi

```powershell
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-public-api.mts "<kata-laluan>"
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-webhooks.mts  "<kata-laluan>"
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-security.mts  "<kata-laluan>"
```

| Skrip | Menegakkan |
|---|---|
| `verify-public-api` | setiap lapisan pengawal dengan **memicunya**; nilai token tidak boleh dibaca semula; putaran + tempoh rahmat; had kadar per-token; CORS + `Vary`; data peribadi kekal di dalam |
| `verify-webhooks` | membangkitkan penerima sebenar pada loopback dan mengesahkan tandatangan **seperti penerima**; badan diubah gagal; main semula gagal; SSRF ditolak; 4xx=1 cubaan, 5xx=3; auto-matikan; jana semula kunci |
| `verify-security` | setiap knob **dikuatkuasakan**, bukan hanya disimpan: kata laluan pendek ditolak dengan nombor yang ditetapkan, akaun dikunci pada kiraan yang ditetapkan selama tempoh yang ditetapkan, token mengambil luput lalai, tempoh rahmat mengikut tetapan |

### Dua perangkap

**`verify-security` menukar kata laluan admin dan dasar lockout.** Ia ada jaring
`uncaughtException`/`unhandledRejection` yang memulihkan kedua-duanya. Kalau ia melaporkan
`TIDAK DAPAT LOG MASUK`, kata laluan mungkin masih `Sement4ra!`.

**Skrip yang mengimport `apps/server/src/db.js` memulakan semula pelayan pembangunan.**
Klien Prisma dibina secara lazy, dan membinanya menulis ke `node_modules/.prisma/client`, yang
`tsx watch` perhatikan. Ketiga-tiga skrip memanggil `warmUpPrisma()` sebelum penegasan pertama
— ia membina klien, kemudian `waitForServer()` mengundur sehingga `/api/health` menjawab.
Tanpa itu pelayan jatuh di tengah larian dan setiap semakan seterusnya gagal seperti regresi.

## Rekod sendiri

#[[file:apps/server/src/routes/profile.ts]]

`/api/profile` dicapai dengan sesi dan **tiada kebenaran skrin**, sebab subjeknya ialah
pemanggil. Setiap operasi menyentuh satu baris staf — yang sesi itu terikat padanya — dan
id baris **tidak pernah** diambil dari permintaan.

**Sempadan yang menjadi seluruh sebab fail itu ada:**

| Dimiliki orang itu | Dimiliki HR, baca-sahaja |
|---|---|
| telefon, alamat, jawatan, avatar, kata laluan | no. pekerja, nama penuh, no. KP, jabatan, lokasi, tarikh mula, emel log masuk, peranan |

`employeeNo` ialah kunci antara sistem ini dan setiap terminal serta setiap baris kehadiran.
`departmentId` memacu subtotal payroll — seseorang menaip semula jabatan sendiri akan
memindahkan wang antara pusat kos tanpa sesiapa meluluskannya. Menjadikannya boleh disunting
ialah cara paling mudah merosakkan payroll dari skrin yang kelihatan hanya menukar nombor
telefon.

**`z.strictObject`, bukan `z.object`.** Objek biasa membuang kunci tidak dikenali secara
senyap — selamat, sebab lajur itu tidak berubah, tetapi tidak kelihatan. Cubaan menghantar
`employeeNo` ialah seseorang menguji sempadan, dan ia patut gagal dengan mesej yang
menamakan kunci itu, bukan menjawab 200 lalu mengabaikannya.

**`parseBody` menamakan isu peringkat-akar.** Kunci tidak dikenali duduk pada akar dan bukan
pada medan, jadi skema ketat dahulunya menjawab `Data yang dihantar tidak sah` yang tidak
memberitahu kunci mana perlu dibuang. Sekarang isu berlaluan-kosong dinamakan, dengan
`issue.keys` bagi `unrecognized_keys`.

## Tukar kata laluan sendiri

`POST /api/profile/password` **memerlukan kata laluan semasa**, tidak seperti reset oleh
administrator. Sesi yang terbuka pada mesin tidak berkunci tidak sepatutnya cukup untuk
mengunci pemiliknya keluar dari akaun sendiri.

**Setiap sesi lain dibatalkan; yang ini kekal.** Membatalkan semuanya akan mengeluarkan orang
itu di tengah tindakan akibat perubahan mereka sendiri yang **berjaya**, yang terbaca sebagai
perubahan itu gagal. Tujuan membatalkan yang lain ialah sesi yang dibuka dengan kata laluan
lama — yang itulah yang kebocoran akan gunakan — berhenti berfungsi. Dilaksanakan dengan
`tokenHash: { not: hashSessionToken(token) }`.

Kata laluan semasa yang salah dilog pada aras `warn`: satu rentetan cubaan terhadap satu
akaun ialah seseorang meneka.

## Avatar bukan biometrik

`Staff.photoPath` ialah gambar di sebelah nama pada skrin. `numOfFace` mengira templat yang
didaftarkan pada **terminal**, dan itulah kredensial yang seseorang scan dengannya.
Mencampurnya bermakna staf menukar avatar sambil percaya mereka mendaftar semula muka, atau
operator membuang foto lalu menghilangkan keupayaan seseorang untuk merekod kehadiran.
Dinyatakan pada skrin, bukan hanya dalam komen.

Avatar dihidangkan dengan **sesi tetapi tiada kebenaran** (`cache-control: private`) — ia
gambar rakan sekerja, dan setiap skrin yang menyenaraikan orang perlu memaparkannya.

## Muat naik imej, kedua-dua tempat

`routes/branding.ts` (logo, favicon) dan `routes/profile.ts` (avatar) berkongsi peraturan
yang sama:

- Jenis ditentukan daripada **bait pertama**, bukan `content-type` atau nama fail. Kedua-dua
  itu rentetan yang klien pilih.
- **SVG ditolak.** Ia format paling jelas untuk logo dan ia juga dokumen XML yang boleh
  membawa `<script>`, dihidangkan dari origin ini, di mana CSP membenarkan skrip dari
  `'self'`. Muat naik logo yang menerima SVG ialah lubang stored-XSS dengan borang di
  hadapannya.
- Nama fail **diterbitkan pelayan**, tidak pernah diterima. Baris tetapan menyimpan nama itu
  dan bukan laluan, dan `organisation.logoPath` sengaja **tiada** dalam `SETTING_KEYS` supaya
  endpoint tetapan tidak boleh menuding ia ke mana-mana pada cakera.
- Fail lama dibuang **selepas** baris menunjuk ke tempat lain, jadi tulisan yang gagal tidak
  meninggalkan tetapan menamakan fail yang sudah hilang.

**`@fastify/multipart` didaftar dalam skop terkapsul sendiri** bersama dua route itu. Ia
memasang parser untuk `multipart/form-data`, dan route ingest memasang parser mentahnya
sendiri untuk jenis yang sama — terminal melampirkan snapshot begitu. Dua parser untuk satu
jenis ialah kegagalan boot (`FST_ERR_CTP_ALREADY_PRESENT`).
