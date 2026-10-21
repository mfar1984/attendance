# Tapak, mesin, dan di mana arahan dijalankan

Dokumen ini wujud kerana ketiadaannya mahal. Topologi pemasangan ini hidup dalam
transkrip perbualan sahaja, jadi setiap sesi bermula dengan meneka mesin mana yang
dimaksudkan — dan arahan deploy cloud yang ditaip pada mesin connector sudah gagal
empat kali, tanpa satu pun daripada ralat itu menyebut bahawa mesin itu yang salah.

**Lima perkara, tiga subnet.** Itu keseluruhan gambarnya.

## Mesin

| | Pelayan kehadiran | Connector Sibu | Terminal Hikvision | Kotak ZKTeco | Terminal ZKTeco |
|---|---|---|---|---|---|
| Nama dalam app | — | `Hospital Sibu` | `Rumah Mayat` | — | `Pejabat IT` |
| Hostname | — | `debian` | — | `zktecodev` | — |
| Alamat LAN | `192.168.10.168` | `192.168.1.87` | `192.168.1.250` | `192.168.0.33` | `192.168.0.32` |
| Direktori | `/var/www/attendance.maximumbuilders.my/html` | `/opt/attendance` | — | tiada klon | — |
| Unit systemd | `attendance` | `attendance-agent` | — | tiada | — |
| Pengguna servis | `www-data` | `attendance-agent` | — | — | — |
| Protokol | — | — | ISAPI | — | TA Push pada rekod; **BEST-WDevice** pada konsol vendor |
| Serial | — | — | — | — | `VGU6262300102` |

Koordinat akses jauh — alamat awam dan port SSH — **tidak** direkodkan di sini. Ia dalam
catatan operator. Fail ini dijejak, dan keterlihatan repositori bukan sesuatu yang patut
menentukan sama ada titik masuk SSH diterbitkan.

## Tiga subnet, dan sebab ia penting

```
192.168.1.0/24   Hospital Sibu     connector .87  ──LAN──  terminal Hikvision .250
192.168.0.0/24   tapak pejabat     zktecodev .33  ──LAN──  terminal ZKTeco .32
192.168.10.0/24  tapak pejabat     pelayan kehadiran .168
```

**Connector Sibu berfungsi kerana ia berada pada LAN yang sama dengan terminalnya.** Itu
keseluruhan sebab connector wujud: pelayan tidak boleh route ke `192.168.1.250`, dan
connector boleh.

**Pelayan dan `zktecodev` berada di belakang satu sambungan internet** — kedua-dua port SSH
diteruskan melalui satu alamat awam, dan egress pelayan ialah alamat yang sama. Jadi ia
premis yang sama dengan subnet berbeza, bukan dua bandar.

**Itu kesimpulan, bukan ukuran.** Sama ada `192.168.10.0/24` benar-benar route ke
`192.168.0.0/24` tidak pernah diuji. Kalau ya, terminal ZKTeco tidak perlukan connector
mahupun Zlink — `/iclock` pelayan sendiri melayannya atas LAN. Kalau tidak, kesimpulan itu
salah dan apa-apa yang dibina atasnya juga salah. Ujinya sebelum merancang:

```bash
# PELAYAN KEHADIRAN
ping -c 3 -W 2 192.168.0.32; ip route get 192.168.0.32
```

## Bagaimana membezakan mesin yang anda berada di atasnya

Jangan teka daripada prompt. `root@debian` dan `root@zktecodev` kelihatan serupa dan
kedua-duanya Debian.

```bash
systemctl list-units --type=service --all | grep -i attend
```

| Yang dilihat | Mesin mana |
|---|---|
| `attendance.service` | **pelayan kehadiran** — satu-satunya dengan `.env` dan `DATABASE_URL` |
| `attendance-agent.service` | **connector tapak** |
| tiada apa | `zktecodev` — tiada apa dipasang di situ |

Pengesahan kedua, kalau masih tidak pasti:

```bash
hostname; ip -4 addr show | grep -oP 'inet \K[\d.]+/\d+' | grep -v '^127'
```

`192.168.10.*` ialah pelayan. `192.168.1.*` ialah connector Sibu. `192.168.0.*` ialah
`zktecodev`.

## Arahan dalam dokumen ini dan dalam perbualan MESTI berlabel

Setiap blok bermula dengan komen yang menamakan mesinnya, dengan nama dari jadual di atas.
Bukan "pada pelayan" — ada tiga mesin dan dua daripadanya menjalankan servis bernama
`attendance-*`.

```bash
# PELAYAN KEHADIRAN
sudo /usr/local/bin/attendance-deploy
```

```bash
# CONNECTOR SIBU
journalctl -u attendance-agent -n 30 --no-pager
```

## Apa yang berjalan di mana

**Pelayan kehadiran** menjalankan web, API, enjin kehadiran dan pekerja. Ia mendengar
`127.0.0.1:8080` di belakang Apache, yang diterbitkan melalui Cloudflare. Hanya mesin ini
ada `.env`, `DATABASE_URL`, dan pangkalan data.

**Connector Sibu** menjalankan `apps/agent`. Ia mendengar `0.0.0.0:8080` pada LAN hospital
untuk push terminal, dan menghubungi pelayan ke luar sahaja. Tiada apa mendengar pelayan:
arahan **dikutip**, tidak pernah dihantar, jadi hospital menerbitkan satu peraturan keluar
dan tiada satu pun masuk.

**`zktecodev` tidak menjalankan apa-apa daripada repositori ini.** Ia diperiksa dan tiada
unit, tiada konfigurasi, tiada klon, tiada apa pada port 8080. Satu connector dicipta
untuk tapak itu dan kemudian ditinggalkan dengan sengaja — pada laluan Zlink tapak itu
tidak perlukan satu, kerana terminal bercakap dengan cloud ZKTeco dan cloud itu bercakap
dengan kita.

## Keadaan pautan Sibu, diukur

Pautan hospital itu **sakit**. Diukur dari connector:

| | |
|---|---|
| `104.21.28.171` (Cloudflare) | 200, tetapi 5.17 s |
| `172.67.146.235` (Cloudflare) | timeout pada 8 s |
| 12 cubaan berturut-turut | 9/12 |

Kira-kira satu per empat permintaan jatuh, dengan latensi berbilang saat. Connector
bertolak ansur dengan itu secara reka bentuk — spool, cuba semula, hantar ke hadapan.

Yang ia **tidak** bertolak ansur ialah restart yang mendarat di dalam tingkap buruk, dan
itu yang menghasilkan pembetulan 0.3.2: separuh identiti roster diingati pada cakera,
supaya push boleh diatribusi dan di-spool sebelum heartbeat pertama. Sebelum itu ia
menjawab 404 kepada setiap push, dan firmware tidak menghantar semula.

**Terowong tidak membetulkan pautan itu.** VPN tapak-ke-tapak berjalan atas pautan yang
sama dan menambah encapsulation pada laluan yang sudah hilang paket. Ia juga menyongsangkan
sifat yang menjadikan connector boleh diluluskan: satu peraturan keluar, tiada masuk.
Terminal yang menjalankan firmware vendor yang tiada siapa tampung tidak sepatutnya boleh
dicapai dari luar bilik tempat ia tergantung.

## Yang masih tidak diketahui

Direkodkan kerana setiap satu daripadanya pernah menyebabkan seseorang bekerja atas
andaian.

- **Sama ada `192.168.10.0/24` route ke `192.168.0.0/24`.** Satu arahan, di atas.
- **Sama ada terminal ZKTeco bercakap ADMS sama sekali.** Ia berdaftar sebagai
  BEST-WDevice pada Zlink. Routing menghantar paket ke sana; ia tidak menjadikan firmware
  bercakap `/iclock`. Jawapannya ada pada menu komunikasi unit itu sendiri — cari
  tetapan Cloud Server atau ADMS dengan alamat pelayan dan port.
- **Sama ada kehilangan Sibu ada dalam laluan anycast Cloudflare atau pada uplink
  hospital.** Bandingkan terus-ke-origin dengan melalui-Cloudflare dari connector.
