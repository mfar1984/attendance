---
inclusion: fileMatch
fileMatchPattern: '**/{reports,leave,dashboard,engine}*.{ts,tsx}'
---

# Laporan, cuti dan payroll

Ini bacaan yang bertukar menjadi wang. Prinsip di sebalik setiap keputusan di bawah
adalah sama: **satu angka tidak pernah dipersembahkan tanpa perkara yang mensyaratkannya.**

## Kejujuran angka

**Nyatakan, jangan halang.** `GET /api/reports/payroll/preview` memulangkan `blockers[]`
dan `safeToExport`, tetapi export tetap dibenarkan. Payroll ada tarikh akhir; skrin yang
enggan menghasilkan fail sehingga setiap pengecualian selesai akan dipintas oleh seseorang
yang export terus dari pangkalan data — dan itu lebih buruk daripada fail yang menyatakan
apa yang salah dengannya.

**Amaran ditulis DALAM fail CSV,** sebagai baris komen `#` di atas pengepala. Hamparan
diforward, dan sesiapa yang membukanya seterusnya tidak pernah melihat sepanduk pada skrin.
Excel memaparkannya sebagai teks dan tiada pengimport menyangkanya data.

**Setiap CSV membawa BOM UTF-8.** Itu yang menghalang Excel merosakkan nama Melayu semasa
dibuka. Perhatian: `Response.text()` membuang BOM semasa mendekod, jadi uji **bait**, bukan
rentetan yang sudah didekod.

**Hasil terpotong mesti berkata demikian.** `truncated` dan `limit` dipulangkan supaya
subtotal tidak dibaca sebagai jumlah. Baris komen dalam export builder menyatakan perkara
yang sama.

**Bawa penyebut, bukan hanya pembilang.** `scheduledDays` = `presentDays + absentDays`.
Payroll membahagi dengannya; kalau ia menyimpang, setiap peratusan yang dibina atasnya
salah. `verify-reports` menegakkan ini pada setiap baris.

**Tempoh melebihi 400 hari ditolak (409).** Export lima tahun selalunya kesilapan, dan
jenis kesilapan yang hanya muncul sebagai timeout.

## Penjana laporan

**Tiada bahasa ungkapan bebas.** Set data, lajur dan cara pengumpulan semuanya datang dari
registry pelayan (`GET /api/reports/fields`), jadi pemilih tidak boleh meminta angka yang
pelayan belum tahu cara menghasilkan. Laporan yang mengira aritmetiknya sendiri adalah
enjin payroll kedua, dan tiada siapa merekonsil yang kedua terhadap yang pertama.

**Pengumpulan dikira dalam memori atas set baris berhad,** bukan dalam SQL. Itu had yang
disengajakan: had itu kelihatan dalam balasan.

**Pratonton dijalankan atas butang, bukan pada setiap perubahan pemilih.** Menanda satu
lajur akan mencetuskan query merentas sebulan rekod bagi lima ribu staf.

## Pengagregatan

**Guna `groupBy` pangkalan data, bukan JavaScript.** 5000 staf × sebulan = 150,000 baris;
menariknya ke dalam proses untuk dikurangkan adalah cara laporan hujung bulan menjadi
insiden memori.

## Saluran notifikasi

Tiga saluran: emel (profil berbilang, jadual `email_profiles`), SMS melalui Infobip dan
Telegram (kedua-duanya baris tunggal, `sms_config` dan `telegram_config`). Semuanya ada
kredensial, senarai pencetus dan butang ujian.

**Kredensial write-only.** Disulitkan masuk; tiada endpoint memulangkannya, walaupun dalam
bentuk yang disulitkan. Yang dipulangkan ialah `apiKeySet` / `botTokenSet` / `passwordSet` — cukup untuk
borang berkata "tersimpan, biarkan kosong untuk kekalkan". Kosong bermakna **kekalkan**,
bukan kosongkan; membuangnya perlukan bendera eksplisit (`clearApiKey`, `clearBotToken`),
kerana tanpa jalan keluar itu kredensial gateway yang sudah ditamatkan kekal dalam
pangkalan data selama-lamanya.

**Ujian menghantar mesej sebenar,** bukan probe sambungan. Mengesahkan kredensial tidak
membuktikan relay akan menerima alamat pengirim itu, atau bot dibenarkan menyiarkan ke
channel — itu yang benar-benar gagal dalam praktik. Keputusan disimpan pada saluran
(`lastTestAt/Ok/Detail`) sebab soalan "pernahkah ini berfungsi" ditanya beberapa hari
kemudian oleh orang yang tidak menjalankan ujian itu.

**Ujian pada saluran yang dimatikan ditolak (409).** Lulus terhadap saluran yang setiap
notifikasi langkau akan mengesahkan sesuatu yang tetap tidak menghantar.

**200 daripada Infobip TIDAK bermakna dihantar.** Ia menerima permintaan dan melaporkan
status per-mesej di dalam badan, jadi pengirim yang ditolak sampai di dalam respons yang
berjaya. `groupName` `REJECTED`/`UNDELIVERABLE` dilayan sebagai kegagalan.

**Kira segmen SMS, jangan teka.** Satu aksara di luar GSM 03.38 menurunkan had dari 160
ke 70 dan menjadikan satu mesej tiga — itu bil tiga kali ganda, bukan ralat.

**Telegram: teks biasa, tiada `parse_mode`.** Ia memerlukan escaping aksara yang muncul
dalam nama Melayu biasa, dan yang tidak di-escape ditolak dan bukan dihantar apa adanya.

**Ralat dipetakan kepada medan yang salah,** bukan kepada syscall. Nilai butang ujian
bukan ia jadi merah tetapi ia beritahu apa perlu ditukar: 403 Infobip → skop
`sms:message:send` tiada, bukan kunci salah; "chat not found" Telegram → bot belum
ditambah ke channel. Baca **mesej** sebelum kod: nodemailer melaporkan sambungan ditolak
sebagai `ESOCKET`, dan Infobip/Telegram menyembunyikan errno dalam teks.

**`notify()` fire-and-forget dan tidak pernah melempar.** Notifikasi adalah kesan sampingan
sesuatu yang sudah berjaya. Menggagalkan kelulusan cuti kerana gateway tidak dapat dihubungi
menukar SMS yang hilang kepada kelulusan yang hilang.

**Tiada outbox.** Kalau gateway mati ketika peristiwa berlaku, notifikasi itu hilang.
Dinyatakan, bukan disembunyikan — outbox tahan lama adalah jawapan betul apabila mesej ini
cukup penting sehingga seseorang akan mencari yang hilang.

**Pencetus dari registri pelayan** (`notify/triggers.ts`), dan hanya peristiwa yang sistem
ini benar-benar bangkitkan. Togol untuk sesuatu yang tidak pernah berlaku lebih buruk
daripada tiada togol: ia terbaca sebagai ciri yang rosak, bukan yang tidak wujud. Medan
`wired` menyatakan sama ada panggilan dispatch sudah ada, dan skrin menunjukkannya.

## Cuti

**Kelulusan mesti menulis `RosterEntry entryType='leave'` DAN memanggil
`recomputeRange`.** Tanpa itu status bertukar pada skrin dan orang itu masih dilaporkan
tidak hadir dalam payroll. Itu keseluruhan tujuan ciri ini.

**Hanya hari yang dicaj ditulis.** Hari Ahad di dalam julat cuti bukan cuti — baki tidak
pernah dicaj untuknya, dan menulis `leave` atasnya menjadikan laporan bulanan mengira lebih
banyak hari cuti daripada yang didebit. Dua angka itu wajib sepadan masa payroll.
`rosterSkipped` melaporkan berapa yang dilangkau.

**Pembatalan TIDAK memulihkan shift asal.** Roster tidak menyimpan sejarah apa yang
digantikannya; berpura-pura sebaliknya akan meletakkan orang pada shift yang tiada sesiapa
semak semula. Dinyatakan dalam balasan dan dalam dialog.

**Hari `pending` dikira terhadap baki.** Kalau tidak, seseorang boleh memfailkan lima
permohonan berasingan yang masing-masing lulus semakan dan bersama melebihi kelayakan.

**`allowBackdated` per jenis, bukan global.** Cuti sakit dan cuti kecemasan difailkan
selepas berlaku secara definisi. Menolaknya menjadikan kategori itu tidak boleh guna dan
mendorong orang merekodkannya sebagai cuti tahunan.

**Permohonan bertindih ditolak (409).** Dua permohonan hidup atas hari yang sama akan
masing-masing menulis baris roster yang sama, dan yang kedua menimpa yang pertama tanpa
memberitahu.

**Penolakan wajib ada sebab bertulis (min 3 aksara, 409).** Tanpanya pemohon tiada apa
untuk ditindaklanjuti, dan pertikaian kemudian tiada apa untuk dirujuk.

**Jenis cuti yang ada sejarah dinyahaktifkan, bukan dibuang (409).** Permohonan lampau
masih perlu menamakan cuti yang diambil.
