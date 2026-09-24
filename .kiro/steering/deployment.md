# Pengedaran dan topologi

Satu repo, dua bentuk pemasangan. Yang membezakannya bukan kod — ia jawapan kepada satu
soalan per terminal: **siapa yang boleh menyentuh kotak itu?**

| Bentuk | Pelayan | Terminal dicapai oleh | Bila |
|---|---|---|---|
| **Standalone** | dalam LAN hospital | pelayan itu sendiri | satu tapak, tiada app mudah alih |
| **Cloud + agent** | hos awam | agent di setiap tapak | banyak tapak, atau app Android/iOS |

**Standalone ialah bentuk yang dihantar.** Agent ialah fasa berasingan; membinanya sebelum
kontrak driver terbukti bermakna menulis dua kali.

## Standalone ialah lalai, bukan konfigurasi khas

Empat sahaja medan `.env` yang tiada lalai: `DATABASE_URL`, `ENCRYPTION_KEY`,
`SESSION_SECRET`, `INGEST_PASSWORD`. Lalai bagi `CONNECTOR_MODE` (`direct`), `RUN_WORKERS`
(`true`) dan `HOST` (`0.0.0.0`) **sudah** bentuk standalone.

Itu bukan kebetulan dan patut kekal begitu: bentuk yang paling banyak dipasang patut bentuk
yang paling sedikit perlu ditaip. `.env.standalone.example` ialah templatnya.

**Kata laluan tidak ditulis dalam mana-mana fail yang dijejak.** Ia hidup dalam `.env` pada
mesin itu sahaja.

`STORAGE_DIR` dan `BACKUP_DIR` menunjuk **di luar** klon. Avatar yang dimuat naik dan dump
pangkalan data tidak boleh berada dalam pokok kerja git — satu `git clean` atau checkout
cawangan akan membuangnya, dan tiada apa dalam output git yang akan menyebut ia berlaku.

### Mengikat antara muka

Terminal kena menghubungi pelayan untuk menghantar peristiwa, jadi ia tidak boleh mengikat
loopback sahaja. **Utamakan alamat LAN mesin itu daripada `0.0.0.0`** — mesin yang juga ada
NIC kedua, VPN, atau WiFi akan menerbitkan API pada kesemuanya.

Trafik pada port itu **HTTP biasa**: kuki sesi dan kredensial ingest menyeberangi LAN dalam
bentuk jelas. Letakkan terminal dan pelayan pada VLAN sendiri, atau tamatkan TLS di hadapan
dan tuding terminal ke situ. Ini dinyatakan kerana ia mudah tidak disedari, bukan kerana ia
menghalang pemasangan.

`INGEST_PUBLIC_URL` ditulis ke dalam konfigurasi pendengar HTTP setiap terminal, jadi ia
mesti alamat yang **terminal** boleh capai — alamat LAN pelayan ini, bukan nama hos awam dan
bukan localhost.

## Apa yang dijejak

Yang dijejak: `apps/`, `packages/`, `scripts/`, `prisma/`, konfigurasi akar,
dan `.kiro/steering/`.

Yang **tidak**, dan sebabnya:

- `.kiro/session/` — transkrip perbualan penuh. Apa-apa yang ditampal ke dalamnya ada di
  situ secara verbatim, termasuk kata laluan. Meng-commit-nya menerbitkannya.
- `.kiro/docs/` — arkib SDK vendor, pemasang, DLL. Bukan hak kita mengedarkannya, dan satu
  failnya melampaui had 100 MB GitHub, jadi push akan ditolak terus.
- `*.sql` — dump membawa `user_accounts`, `sessions`, `api_tokens`: hash kata laluan,
  rahsia TOTP, token sesi hidup bagi staf sebenar.
- `storage/`, `backups/` — artifak masa jalan.
- `cookies.txt` — balang kuki daripada skrip verifikasi.

`.kiro/steering/` ialah pengecualian kerana ia sebab di belakang kod, dan tempatnya di
sebelah kod yang diterangkannya.

## Bina

```powershell
npm run build:prod
```

Tiga langkah dalam satu: `packages/*` melalui project references, kemudian `apps/server`
(`prisma generate`, kemudian `tsc -p tsconfig.build.json` ke `dist/`), kemudian `apps/web`
ke `dist/`.

**`prisma generate` berjalan SEBELUM `tsc`, dan susunan itu bukan kosmetik.** Jenis Prisma
dijana, bukan ditulis. Tanpa langkah itu, `tsc` pada klon bersih gagal dengan **301 ralat**
yang setiap satunya berbunyi seperti masalah lain — `Module '@prisma/client' has no exported
member 'Staff'`, kemudian tiga ratus `implicitly has an 'any' type` kerana setiap hasil query
menjadi `{}`. Tiada satu pun daripadanya menyebut punca sebenar.

Ia lulus pada mesin pembangunan kerana `node_modules/.prisma/client` sudah ada dari kerja
sebelumnya. Bug yang hanya muncul pada pemasangan bersih ialah bug yang hanya muncul semasa
pengedaran.

**Produksi menjalankan `node` terhadap output yang dikompil, bukan `tsx`.** Transpile-pada-boot
ialah kebergantungan yang servis berjalan tidak perlukan, dan ia menukar ralat sintaks dalam
fail yang belum diimport daripada kegagalan bina menjadi kegagalan pada masa permintaan.

`apps/server/tsconfig.json` kekal `noEmit` untuk typecheck pembangunan. `tsconfig.build.json`
ialah satu yang mengeluarkan. Dua fail kerana satu daripadanya berjalan pada setiap simpan
dan yang satu lagi hanya semasa pengedaran.

### `prisma.config.ts` memuatkan `.env` sendiri

CLI Prisma tidak membaca `.env` akar repo, jadi setiap arahan Prisma dahulunya perlukan
`DATABASE_URL` di-export dengan tangan atau ia gagal dengan `PrismaConfigEnvError`. Itu juga
yang menjadikan `prisma generate` mustahil dipanggil dari skrip bina.

`prisma.config.ts` sekarang memuatkannya sendiri, dengan pembolehubah yang sudah ditetapkan
menang. Ia kekal `env('DATABASE_URL')` dan bukan rentetan sandaran: URL yang hilang mesti
gagal dengan nama, kerana alternatifnya ialah `db push` mendamaikan secara senyap terhadap
pangkalan data yang salah.

## Pemasangan pertama

```bash
git clone https://github.com/mfar1984/attendance.git
cd attendance
npm ci

cp .env.standalone.example .env
# isi empat nilai; jana rahsia pada mesin ini
nano .env

npm run build:prod

cd apps/server
npx prisma db push          # betul di sini sahaja - lihat peraturan migrasi
node --env-file=../../.env dist/seed.js
```

Seed mencetak kunci TOTP admin. **Simpan** — `REQUIRE_ADMIN_2FA=true` bermakna tanpanya tiada
siapa boleh log masuk.

Kemudian jalankan pelayan di bawah penyelia supaya ia bangun semula selepas boot dan selepas
crash. `loadDotEnvIfNeeded()` dalam `bootstrap.ts` memuatkan `.env` dari dalam proses, jadi
entri tidak perlukan bendera `--env-file`:

```ini
# /etc/systemd/system/attendance.service
[Unit]
Description=Sistem Kehadiran
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/opt/attendance
ExecStart=/usr/bin/node apps/server/dist/main.js
Restart=always
RestartSec=5
User=attendance

[Install]
WantedBy=multi-user.target
```

Pada Windows, gunakan Scheduled Task pada startup atau bungkus sebagai servis; arahannya
sama (`node apps\server\dist\main.js` dengan `WorkingDirectory` pada akar klon).

**Tiada crontab.** `RUN_WORKERS=true` bermakna tarikan rekonsil, sapuan retention dan jadual
backup hidup dalam proses itu. Itu keseluruhan kelebihan standalone: tiada jadual luar yang
perlu bersetuju dengan skrin tetapan, dan gerbang jam kekal dalam polisi di tempat operator
boleh melihatnya.

`cron.js` masih ada dan masih memanggil fungsi yang sama, untuk sesiapa yang mahu penjadualan
luar. Ia tidak diperlukan di sini.

## Kitaran pengedaran

Pada mesin pembangunan, selepas verifikasi lulus:

```powershell
git add <fail tertentu>
git commit -m "..."
git push
```

Pada pelayan:

```bash
cd /opt/attendance
git pull
npm ci
npm run build:prod
sudo systemctl restart attendance
# migrasi hanya jika skema berubah - lihat peraturan di bawah
```

`npm ci` dan bukan `npm install`: ia memasang tepat apa yang `package-lock.json` namakan.
`npm install` boleh menaikkan versi transitif pada pelayan yang tiada siapa uji.

### Setiap push dinyatakan siap dengan dua fakta

**Commit mana, dan sama ada migrasi diperlukan.** Tanpa kedua-duanya, operator tidak boleh tahu
bila anda push melainkan anda beritahu — dan commit yang duduk tanpa di-deploy kelihatan sama
seperti bug yang belum dibetulkan. Ini sudah berlaku: pembetulan dihantar, dilaporkan siap, dan
operator terus melihat gejala lama selama beberapa pusingan sebelum bertanya sendiri.

Nyatakan juga **mesin mana**. Cloud dan agent kedua-duanya Debian dan kedua-duanya ada klon di
`/opt/attendance`, jadi "jalankan ini di pelayan" tidak mencukupi. Arahan deploy cloud yang
ditaip pada mesin agent gagal empat kali — pemilikan git, `DATABASE_URL` tiada, unit tidak
dijumpai — dan tiada satu pun daripada ralat itu menyebut bahawa mesin itu yang salah.

### Perubahan pada `apps/agent` mesti menaikkan `AGENT_VERSION`

`AGENT_VERSION` dalam `packages/shared/src/schemas/agent.ts`. Ia dikongsi kerana kedua-dua belah
memerlukannya: agent melaporkannya pada setiap heartbeat, dan cloud membandingkan laporan itu
dengan nilai yang sama untuk menjawab "adakah tapak itu menjalankan kod lama".

Perbandingan itulah yang memacu butang **Kemas kini connector** dalam dialog butiran connector.
Jadi:

- **Sentuh `apps/agent` → naikkan `AGENT_VERSION`.** Kalau tidak, butang kekal kelabu dan setiap
  tapak kekal pada kod lama sambil skrin berkata ia terkini. Tiada apa akan melaporkan itu.
- **Sentuh cloud sahaja → jangan naikkan.** Butang kelabu memang betul; tiada apa di tapak
  berubah, dan meminta lima belas connector membina semula tanpa sebab ialah lima belas peluang
  untuk bina gagal.

"Terkini" bermaksud **apa yang pemasangan ini akan pasang**, bukan nombor dari internet. Cloud
menghidangkan pemasang dan kemas kini menjalankan `git pull` dalam repo yang sama, jadi pemalar
itu satu-satunya definisi jujur — dan ia tidak boleh bercanggah dengan realiti seperti versi
jauh yang dikodkan tetap boleh.

Dua salinan nombor versi ialah satu salinan yang bercanggah, dan yang bercanggah itu memutuskan
sama ada seseorang diberitahu tapak mereka lapuk. Sebab itu ia dipindah keluar dari
`apps/agent/src/config.ts`, yang kini mengimport dan mengeksportnya semula.

### Arahan yang diberi pada setiap deploy

**Cloud.** Nama unit dan direktori berbeza antara pemasangan, jadi cari dan jangan teka:

```bash
systemctl list-units --type=service --all | grep -i attend
systemctl cat <unit> | grep -E 'WorkingDirectory|ExecStart'
```

Kemudian, dalam direktori itu:

```bash
git log --oneline -1          # sahkan di mana cloud berada sekarang
git pull
npm ci
# migrasi HANYA jika skema berubah, dan backup dahulu setiap kali:
mysqldump -u <user> -p <db> > pre-migration-$(date +%F).sql
mysql -u <user> -p <db> < apps/server/prisma/migrations/<fail>.sql
npm run build:prod
sudo systemctl restart <unit>
```

**Agent.** Hanya apabila `apps/agent` atau `packages/*` berubah. Tiga perkara yang mudah
terlepas, dan ketiga-tiganya sudah menggagalkan deploy sebenar:

```bash
git config --global --add safe.directory /opt/attendance

cd /opt/attendance \
  && git pull \
  && npm ci --ignore-scripts \
  && npx tsc --build \
  && npm run build:prod --workspace @attendance/agent \
  && chown -R attendance-agent:attendance-agent /opt/attendance

sudo systemctl restart attendance-agent
```

- **`safe.directory`** — pemasang `chown` klon kepada pengguna servis, jadi root yang `git pull`
  di situ ditolak dengan `dubious ownership`.
- **`npx tsc --build`** — membina `packages/*` dahulu. Pemasang menjalankan dua arahan bina dan
  bukan satu; meninggalkan yang pertama menggagalkan bina agent dengan
  `has no exported member` bagi apa-apa yang baru ditambah ke `shared`.
- **`chown` di hujung** — bina sebagai root meninggalkan `dist/` dan `node_modules/` dimiliki
  root, dan `git pull` seterusnya bergelut dengan pemilikan bercampur.

Sahkan sebelum restart, kerana bina boleh gagal sementara arahan sebelumnya kelihatan lulus:

```bash
ls -l /opt/attendance/apps/agent/dist/main.js
```

**Selepas kemas kini manual pertama, langkah ini tidak diperlukan lagi.** Butang Kemas kini
connector melakukan perkara yang sama dari skrin. Ia tidak boleh memasang dirinya sendiri —
binaan yang berjalan sekarang tidak tahu membaca permintaan itu — jadi setiap tapak yang ada
perlukan satu lawatan manual, dan setiap tapak baharu mendapatnya dari hari pertama.

**Susunan: cloud dahulu, agent kemudian.** Agent yang dikemas kini bercakap dengan endpoint yang
cloud lama tidak ada, dapat 404, dan log amaran pada setiap pusingan. Tiada kerosakan, tetapi ia
bunyi yang menghantar seseorang memburu bug yang tidak wujud.

### Skrip pemasangan mesti diluluskan dalam repo

npm 11.19+ **menyekat skrip pemasangan dependensi secara lalai**. Kelulusan hidup dalam medan
`allowScripts` pada `package.json` **akar**, dan ia dijejak:

```json
"allowScripts": {
  "prisma@7.10.0": true,
  "@prisma/engines@7.10.0": true,
  "argon2": false
}
```

Tanpa dua yang pertama, `@prisma/engines` tidak meletakkan binari enjinnya dan Prisma gagal
dengan ralat yang tidak menyebut skrip pemasangan sama sekali.

**Entri disematkan pada versi**, jadi menaikkan Prisma bermakna menyunting medan ini juga.
Itu disengajakan: postinstall Prisma memuat turun binari dari rangkaian, dan versi yang
diluluskan patut versi yang seseorang telah semak. `npm ci` memberi amaran apabila entri
tidak sepadan, dan `npm run build:prod` selepasnya gagal dengan kuat — jadi terlupa tidak
berakhir senyap.

**Jangan luluskannya dengan tangan pada pelayan.** `npm install-scripts approve` menulis ke
`package.json`, yang menjadikan pokok kerja kotor; `git checkout -- package.json` seterusnya
membuang kelulusan itu dan pengedaran berikutnya memerlukannya semula. Itu sudah berlaku.

**`argon2` ditolak dengan sengaja** (`false`, bukan tiada entri). Entri `false` bertahan
melalui `approve --all`, jadi penolakan itu tidak boleh hilang secara tidak sengaja.

### Kenapa kata laluan guna scrypt dan bukan Argon2id

Ditemui semasa mencuba hos terurus, tetapi keputusannya berdiri atas kakinya sendiri.

`argon2` ialah modul natif. Prebuild `linux-x64` yang ia hantar memerlukan **glibc 2.34**;
hos itu membawa **2.28**, jadi `require('argon2')` gagal dengan `ERR_DLOPEN_FAILED` dan
setiap log masuk menjadi mustahil. Mengkompil dari sumber perlukan toolchain, dan perlu
diulang pada setiap `npm ci`.

Dokumen ini pernah menyatakan sebaliknya — bahawa prebuild itu bermakna tiada kompilasi
diperlukan. **Prebuild yang ada bukan prebuild yang boleh dimuatkan.**

`apps/server/src/auth/password.ts` guna `scrypt` dari `node:crypto`: memori-keras, dalam
pustaka standard, dan tidak boleh dipatahkan oleh hos menukar imej asasnya. Hash yang tiada
siapa boleh hitung bukan hash yang lebih kuat. Ini kekal betul untuk standalone juga — ia
membuang satu kelas kegagalan pemasangan daripada mana-mana mesin, bukan hanya hos itu.

`argon2` kekal dalam `optionalDependencies` semata-mata untuk **membaca** hash lama. Ia
diimport secara lazy, kegagalan dimaafkan, dan setiap log masuk yang berjaya menulis semula
hash itu kepada scrypt.

Regresi: `node node_modules/tsx/dist/cli.mjs scripts/test-password.mts` (tiada pelayan atau
pangkalan data diperlukan).

## Bila migrasi diperlukan

Ini soalan yang dijawab pada setiap pengedaran, dan jawapan yang salah dalam satu arah
kehilangan data.

**Perlu migrasi** apabila commit menyentuh `apps/server/prisma/schema.prisma`.

**Tidak perlu** untuk apa-apa yang lain — logik route, komponen web, label, skrip.

`prisma generate` berjalan pada setiap bina kerana klien mesti sepadan dengan skema. Itu
tidak menyentuh pangkalan data.

### `db push` tidak digunakan selepas pemasangan pertama

`prisma db push` mendamaikan seluruh skema dan akan **membuang lajur** yang tidak lagi dalam
skema tanpa bertanya. Pada pembangunan itu boleh diterima. Pada pangkalan data yang memegang
kehadiran sebenar, ia bukan.

Pengecualian: **pemasangan pertama pada pangkalan data kosong.** Tiada apa untuk dihilangkan,
jadi `npx prisma db push` betul di situ. Peraturan ini untuk setiap kali selepas itu.

Perubahan skema selepas itu ditulis sebagai SQL aditif, dijalankan secara eksplisit, dan
diuji pada salinan dahulu:

```bash
mysqldump -u attendance -p attendance > /var/lib/attendance/backups/pre-migration-$(date +%F).sql
mysql -u attendance -p attendance < migration.sql
```

Backup dahulu, setiap kali. Migrasi yang separuh dijalankan pada pangkalan data tanpa salinan
ialah keadaan yang tiada jalan keluar.

## Yang perlu wujud sebelum boot pertama

`loadEnv()` gagal dengan kuat pada persekitaran yang tidak sah, jadi kegagalan berlaku pada
boot dan bukan pada permintaan pertama yang menyentuh medan yang hilang.

- `ENCRYPTION_KEY` — 32 bait hex. **Tidak boleh diputar di tempatnya:** ia menyahsulit kata
  laluan peranti, rahsia TOTP dan PIN pintu yang tersimpan. Menukarnya menjadikan setiap satu
  daripadanya tidak boleh dibaca.
- `SESSION_SECRET` — minimum 32 aksara.
- `INGEST_PASSWORD` — 8–16 aksara, had firmware.
- `WEB_DIST_DIR` — laluan mutlak ke `apps/web/dist`.
- `HOST` — alamat LAN yang terminal boleh capai.

Hasilkan rahsia yang baharu pada mesin itu. Menggunakan semula nilai pembangunan bermakna
sesiapa yang pernah melihat repo pembangunan boleh menandatangani sesi produksi.

## Had kadar

Dua laluan tidak melalui pengehad kadar biasa, kerana terminal bercakap lebih kerap daripada
manusia:

- `/hik/events` — ingest terminal
- `/api/health` — probe

## Apa yang percubaan hos terurus tinggalkan

Dicuba pada cPanel dengan Passenger dan ditinggalkan, kerana hos awam **tidak boleh
menghubungi `192.168.1.250`**. Ia akan menjalankan web dan API dengan sempurna sambil
merekod sifar kehadiran, dan tiada tetapan yang membetulkannya — hanya agent, yang belum ada.

Empat perkara dari percubaan itu kekal kerana ia memperbaiki kod tanpa mengira hos:

- **scrypt** menggantikan Argon2id (di atas).
- **`allowScripts`** dalam repo (di atas). Sekatan npm ini global, bukan cPanel.
- **`prisma generate` dalam `build:prod`** (di atas). Bug klon bersih, bukan bug hos.
- **`bootstrap.ts`** dan `server.js` di akar. `loadDotEnvIfNeeded()` bermakna entri berfungsi
  tanpa `--env-file`, yang systemd pun faedahi. `server.js` tidak digunakan dalam standalone
  tetapi dibiarkan: ia satu laluan boot yang stabil, dan ia berfungsi.

## Connector tapak

`apps/agent`. Ia wujud untuk satu sebab: hos cloud tidak boleh route ke
`192.168.1.250`. Ia juga titik pendedahan rangkaian tunggal bagi tapak itu —
lima belas terminal di belakang satu connector bermakna satu peraturan firewall
untuk dirundingkan dan bukan lima belas, dan terminal itu, yang menjalankan
firmware vendor yang tiada siapa tampung, tidak perlukan laluan ke internet sama
sekali.

**Semuanya dimulakan oleh agent.** Tiada apa mendengar cloud. Arahan **dikutip**,
tidak pernah dihantar, jadi hospital menerbitkan satu peraturan keluar dan tiada
satu pun masuk. Itu soalan pertama yang IT akan tanya dan jawapannya bersih.

| Permintaan kepada IT | |
|---|---|
| Keluar | TCP 443 dari IP Pi ke satu nama hos |
| Masuk | tiada |
| Dalam LAN | 15 terminal mencapai Pi pada satu port |
| NTP | tidak perlu — masa datang dari balasan cloud |

### Per-peranti, bukan per-pemasangan

`Device.agentId` null bermakna pelayan mencapai terminal itu sendiri. Satu
pemasangan memegang kedua-duanya serentak: terminal dalam bangunan yang sama
direct, klinik di belakang NAT melalui agent. `CONNECTOR_MODE` hanya lalai untuk
peranti baharu.

Kesan sampingan yang berguna: 15 terminal boleh dibahagi antara dua Pi tanpa satu
baris kod berubah, yang merupakan jawapan apabila satu connector untuk seluruh
tapak terlalu banyak untuk hilang serentak.

### Memasang

```powershell
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/create-agent.mts "Nama Tapak"
```

Ia mencetak arahan pemasang lengkap dengan alamat cloud sudah diisi. Pada Pi:

```bash
curl -fsSL https://<cloud>/install-agent.sh | sudo bash -s -- --cloud https://<cloud> --token hken_...
```

**Dua kredensial, bukan satu.** Token pendaftaran (`hken_`) sekali guna dan luput
sejam — ia yang ditampal ke arahan shell, jadi ia masuk ke `~/.bash_history` pada
mesin yang mungkin duduk di koridor. Kredensial kerja (`hkag_`) dikeluarkan cloud
semasa pendaftaran dan ditulis ke `/var/lib/attendance-agent/credential` pada
`0600`. Operator tidak pernah melihatnya.

`--reissue <id>` untuk memasang semula. Ia **tidak** mengosongkan kredensial yang
ada, jadi tapak itu terus melaporkan kehadiran sementara seseorang memandu ke
sana.

### Apa yang berfungsi, dan apa yang tidak

**Berfungsi:** push terminal, tarikan rekonsil pada LAN, penghantaran peristiwa
mentah, tambah/buang pengguna, tambah/buang wajah, reboot, NTP, tetapan pintu dan
pembaca, mod kehadiran, mengosongkan slot push, menuding terminal ke connector
sendiri, dan kemas kini connector sendiri.

**Hikvision ISAPI sahaja.** Driver ZKTeco TA Push menulis melalui baris giliran
cloud yang connector tiada akses, dan rentetan arahannya datang dari transkripsi
pihak ketiga dan belum pernah disemak terhadap SenseFace sebenar. `roster.ts`
menolaknya dengan baris log, bukan secara senyap — connector yang mendakwa
menyokongnya akan menghasilkan tapak yang kelihatan sihat dan merekod sifar.

**Bacaan ialah snapshot, bukan langsung.** Connector menyapu terminalnya pada
pemasa `SNAPSHOT_SECONDS` (lalai 600) dan melaporkan apa yang dibacanya ke
`POST /agent/snapshots`; cloud menyimpannya dalam `device_snapshots` dan
`AgentProxyDriver` menjawab daripada laporan terbaharu.

Bacaan segerak masih mustahil — permintaan pelayar tidak boleh menunggu tinjauan
berikutnya — tetapi itu tidak bermakna tiada apa untuk ditunjukkan. Skrin
memaparkan cap masa di sebelah nilai (`device.editor.live.snapshotAt`,
"Laporan connector"), berperkataan berbeza daripada bacaan langsung dengan
sengaja: tetapan cache yang dipersembahkan sebagai semasa lebih buruk daripada
medan kosong, kerana seseorang menukar mod pengesahan di papan kekunci dan skrin
kekal yakin dan salah.

Editor peranti pernah menembak bacaan itu secara buta, dapat 409, dan merender
penolakan sebagai ralat — enam jalur merah untuk satu fakta struktur. Kemudian ia
melangkaunya sepenuhnya, yang membuang merah tetapi meninggalkan tab kosong.
Kedua-duanya salah kerana kedua-duanya tiada tempat untuk nilai itu datang.

Bacaan yang kontraknya boleh menyatakan kekosongan memulangkan kosong sebelum
sapuan pertama, bukan membaling. Hanya `identity.read` dan `clock.read` masih
membaling, kerana `TerminalIdentity` dan `ClockReading` bukan nullable.

**Tiga tulisan kekal ditolak,** dan membariskannya akan merosakkan setiap satu
dan bukan membetulkannya. Ketiga-tiganya menyatakan sebabnya dalam
`DriverCapabilities.unavailable`, kerana skrin memaparkan sebab itu pada kawalan
itu sendiri.

- **Buka pintu.** Melepaskan kunci lima belas saat lewat bukan kejayaan yang
  lambat — ia pintu terbuka ketika tiada siapa menjangkakannya, dan orang yang
  menekannya sudah menganggap ia gagal lalu beredar.
- **Tetapkan jam secara manual.** Connector sudah menetapkan jam terminal dari
  masa cloud pada setiap heartbeat. Cap masa yang dibariskan sudah lapuk ketika
  dikutip, dan menulis masa lapuk ke jam mengekalkan hanyutan yang sepatutnya
  dibetulkan. Hos NTP dibariskan sebaliknya: konfigurasi kekal betul lima belas
  saat kemudian, cap masa tidak.
- **Tetapkan sasaran push.** Sasarannya ialah alamat LAN connector itu sendiri,
  yang ia tahu dan cloud tidak. `POST /api/devices/:id/push/via-agent`
  membariskan arahan yang membawa slot dan laluan **sahaja**; connector mengisi
  alamat dan kata laluan Digestnya sendiri. Mengosongkan slot dibenarkan, kerana
  itu perlukan nombor slot sahaja.

**Skrin sudah ada.** Tab Connector pada Senarai Peranti mencipta agent, jana
token pendaftaran semula, tarik kredensial, buang baris yang ditarik, dan buka
dialog butiran dengan butang kemas kini. Borang peranti ada pemilih "Dicapai
melalui" yang menetapkan `devices.agentId`. `create-agent.mts` masih ada untuk
sesiapa yang lebih suka shell, tetapi tiada langkah operasi memerlukannya lagi.

### Dua perkara yang akan menggigit kalau dilupakan

**Spool ialah keseluruhan kontrak.** Firmware tidak menyimpan baris giliran dan
tidak pernah mencuba semula, jadi antara connector menjawab 200 kepada satu unit
dan cloud menerima kelompok itu, Pi ialah satu-satunya tempat peristiwa itu
wujud. Tulisan berlaku sebelum respons; pemadaman selepas cloud menerima. Guna
SSD kalau boleh — Pi 5 ada PCIe, dan kad SD ialah cara Pi paling biasa mati.

**Connector tidak pernah menjadi sumber masa.** Pi 5 tiada jam bersandar bateri.
Ia relay jam cloud dan MENOLAK menetapkan jam terminal sampai ia melihat satu.
Terminal yang dibiar hanyut ialah masalah dengan amaran pada skrin; terminal yang
ditetapkan dengan yakin ke hari yang salah bukan.

### Trafik itu HTTP biasa dalam LAN

Kuki sesi dan kredensial ingest menyeberangi LAN tanpa TLS antara terminal dan
Pi. Letakkan terminal dan Pi pada VLAN sendiri, atau tamatkan TLS di hadapan.
Perjalanan Pi ke cloud sentiasa HTTPS — `assertSecureCloud()` menolak HTTP awam
pada boot.
