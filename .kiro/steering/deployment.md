# Pengedaran dan topologi

Satu repo, dua bentuk pemasangan. Yang membezakannya bukan kod — ia jawapan kepada satu
soalan per terminal: **siapa yang boleh menyentuh kotak itu?**

| Bentuk | Pelayan | Terminal dicapai oleh | Bila |
|---|---|---|---|
| **Standalone** | dalam LAN hospital | pelayan itu sendiri | satu tapak, tiada app mudah alih |
| **Cloud + agent** | hos awam | agent di setiap tapak | banyak tapak, atau app Android/iOS |

Standalone dibina dahulu dan dihantar dahulu. Agent ialah fasa berasingan; membinanya
sebelum kontrak driver terbukti bermakna menulis dua kali.

## Persekitaran produksi

Hos ialah **cPanel** dengan Node.js Selector, yang menjalankan Phusion Passenger.
Folder subdomain juga menjadi akar aplikasi.

| | |
|---|---|
| Domain | `attendance.malaysiadev.com` |
| Klon / akar aplikasi | `/home/malaysiadev/attendance.malaysiadev.com` |
| Fail permulaan | `server.js` (di akar klon) |
| Data berterusan | `/home/malaysiadev/attendance-data` (di **luar** klon) |
| Pangkalan data | `malaysiadev_attendance` |
| Pengguna MySQL | `malaysiadev_attendance` |
| Git | `https://github.com/mfar1984/attendance.git` |

**Kata laluan tidak ditulis di sini, dan tidak dalam mana-mana fail yang dijejak.** Ia hidup
dalam `.env` pada pelayan sahaja. `.env.production.example` ialah templatnya.

`~/attendance-data` duduk di luar klon dengan sengaja. Avatar yang dimuat naik dan dump
pangkalan data tidak boleh berada dalam pokok kerja git — satu `git clean` atau checkout
cawangan akan membuangnya, dan tiada apa dalam output git yang akan menyebut ia berlaku.

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

Tiga langkah dalam satu: `packages/*` melalui project references, kemudian
`apps/server` ke `dist/` melalui `tsconfig.build.json`, kemudian `apps/web` ke `dist/`.

**Produksi menjalankan `node` terhadap output yang dikompil, bukan `tsx`.** Transpile-pada-boot
ialah kebergantungan yang servis berjalan tidak perlukan, dan ia menukar ralat sintaks dalam
fail yang belum diimport daripada kegagalan bina menjadi kegagalan pada masa permintaan.

`apps/server/tsconfig.json` kekal `noEmit` untuk typecheck pembangunan. `tsconfig.build.json`
ialah satu yang mengeluarkan. Dua fail kerana satu daripadanya berjalan pada setiap simpan
dan yang satu lagi hanya semasa pengedaran.

## cPanel: tiga perkara yang bukan pilihan

**Passenger menjalankan satu fail, bukan skrip npm.** Jadi `npm start` dan bendera
`--env-file`-nya tidak pernah terpakai. `apps/server/src/bootstrap.ts` memuatkan `.env`
dari dalam proses untuk sebab itu, dan `server.js` di akar klon ialah fail yang Passenger
mulakan. Ia hanya mengalihkan ke `apps/server/dist/main.js` — satu pelayan, satu laluan
boot, siapa pun yang melancarkannya.

**`RUN_WORKERS=false`, dan kerja itu berpindah ke cron.** Passenger menghentikan aplikasi
yang lama tidak digunakan, dan pemasa dalam proses mati bersamanya. Tarikan rekonsil akan
berjalan beberapa minit selepas setiap lawatan lalu berhenti — lebih buruk daripada tidak
bermula, kerana skrin peranti terus menunjukkan kursor yang bergerak pagi tadi, jadi
tarikan yang sudah mati sehari kelihatan seperti yang sekadar sunyi.

```
*/5 * * * *  cd /home/malaysiadev/attendance.malaysiadev.com && node apps/server/dist/cron.js sync
7 * * * *    cd /home/malaysiadev/attendance.malaysiadev.com && node apps/server/dist/cron.js retention
17 * * * *   cd /home/malaysiadev/attendance.malaysiadev.com && node apps/server/dist/cron.js backup
```

`cron.js` memanggil fungsi yang sama dengan pemasa. Kerja berjadual yang mengambil laluan
kod berbeza ialah kerja yang mod kegagalannya belum pernah dilihat sesiapa, dan yang ini
berjalan pada pukul dua pagi tanpa sesiapa menonton. Gerbang jam untuk retention dan backup
kekal dalam polisi, bukan dalam crontab — jika tidak, seseorang yang menukar jam pada skrin
kena tahu ada crontab yang tidak bersetuju dengannya.

**Terminal tidak boleh dicapai dari cloud.** Hos cPanel tidak boleh menghubungi
`192.168.1.250`. Sehingga agent siap, pemasangan cloud menjalankan web, API, dan daftar
masuk mudah alih — **tiada terminal**. Itu bukan pepijat konfigurasi dan tidak ada tetapan
yang membetulkannya.

## Kitaran pengedaran

Pada mesin pembangunan, selepas verifikasi lulus:

```powershell
git add <fail tertentu>
git commit -m "..."
git push
```

Pada pelayan:

```bash
cd ~/attendance.malaysiadev.com
git pull
npm ci
npm run build:prod
# migrasi hanya jika skema berubah - lihat peraturan di bawah
```

Kemudian **Restart** dalam cPanel › Setup Node.js App. Passenger tidak mengambil kod
baharu tanpa itu.

`npm ci` dan bukan `npm install`: ia memasang tepat apa yang `package-lock.json` namakan.
`npm install` boleh menaikkan versi transitif pada pelayan yang tiada siapa uji.

`argon2` ialah modul natif, tetapi ia menghantar prebuild `linux-x64`, jadi ia tidak perlu
dikompil pada hos yang tiada alat bina.

## Bila migrasi diperlukan

Ini soalan yang dijawab pada setiap pengedaran, dan jawapan yang salah dalam satu arah
kehilangan data.

**Perlu migrasi** apabila commit menyentuh `apps/server/prisma/schema.prisma`.

**Tidak perlu** untuk apa-apa yang lain — logik route, komponen web, label, skrip.

`prisma generate` berjalan pada setiap bina kerana klien mesti sepadan dengan skema. Itu
tidak menyentuh pangkalan data.

```bash
cd ~/attendance.malaysiadev.com/apps/server
export DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2- | tr -d '\"')"
npx prisma generate
```

**Konfigurasi Prisma tidak membaca `.env` akar**, jadi `DATABASE_URL` ditetapkan secara
manual atau ia gagal dengan `PrismaConfigEnvError`.

### `db push` tidak digunakan pada produksi

`prisma db push` mendamaikan seluruh skema dan akan **membuang lajur** yang tidak lagi
dalam skema tanpa bertanya. Pada pembangunan itu boleh diterima. Pada pangkalan data yang
memegang kehadiran sebenar, ia bukan.

Perubahan skema produksi ditulis sebagai SQL aditif, dijalankan secara eksplisit, dan
diuji pada salinan dahulu:

Pengecualian: **pemasangan pertama pada pangkalan data kosong.** Tiada apa untuk
dihilangkan, jadi `npx prisma db push` betul di situ. Peraturan di atas adalah untuk
setiap kali selepas itu.

```bash
mysqldump -u malaysiadev_attendance -p malaysiadev_attendance > ~/attendance-data/backups/pre-migration-$(date +%F).sql
mysql -u malaysiadev_attendance -p malaysiadev_attendance < migration.sql
```

Backup dahulu, setiap kali. Migrasi yang separuh dijalankan pada pangkalan data tanpa
salinan ialah keadaan yang tiada jalan keluar.

## Yang perlu wujud sebelum boot pertama

`loadEnv()` gagal dengan kuat pada persekitaran yang tidak sah, jadi kegagalan berlaku pada
boot dan bukan pada permintaan pertama yang menyentuh medan yang hilang.

- `ENCRYPTION_KEY` — 32 bait hex. **Tidak boleh diputar di tempatnya:** ia menyahsulit kata
  laluan peranti, rahsia TOTP dan PIN pintu yang tersimpan. Menukarnya menjadikan
  setiap satu daripadanya tidak boleh dibaca.
- `SESSION_SECRET` — minimum 32 aksara.
- `INGEST_PASSWORD` — 8–16 aksara, had firmware.
- `WEB_DIST_DIR` — laluan mutlak ke `apps/web/dist`.
- `RUN_WORKERS` — `false` pada cPanel, dengan cron dipasang.

Hasilkan yang baharu pada pelayan. Menggunakan semula nilai pembangunan bermakna sesiapa
yang pernah melihat repo pembangunan boleh menandatangani sesi produksi.

## Reverse proxy

`HOST=127.0.0.1` pada produksi. Proxy menamatkan TLS di hadapannya; mengikat `0.0.0.0`
pada hos awam mendedahkan API tanpa TLS.

Dua laluan yang tidak boleh melalui pengehad kadar biasa, kerana terminal dan agent
bercakap lebih kerap daripada manusia:

- `/hik/events` — ingest terminal
- `/api/health` — probe

## Yang belum siap

Binari agent. Sehingga ia ada, hanya standalone boleh diedarkan, dan `CONNECTOR_MODE=agent`
pada `.env` produksi tidak lebih daripada lalai untuk terminal yang ditambah kemudian.
