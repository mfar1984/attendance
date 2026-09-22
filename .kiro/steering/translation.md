# Label antara muka dan alih bahasa

Setiap perkataan yang seseorang baca pada skrin datang dari satu registry. Bahasa Melayu
ialah **sumber**, bukan terjemahan bagi dirinya — perkataannya hidup dalam kod, dan setiap
bahasa lain ialah lapisan di atasnya.

#[[file:packages/shared/src/labels.ts]]

## Di mana ia duduk

`packages/shared/src/labels.ts` — satu fail, dikongsi kedua-dua app:

| Eksport | Untuk |
|---|---|
| `LABELS` (objek `as const`) | kunci → perkataan sumber |
| `LabelKey` | `keyof typeof LABELS`, jadi kunci salah ialah kegagalan compile |
| `LABEL_GROUPS` | nama kumpulan, dikunci pada segmen pertama kunci |
| `labelGroup()`, `labelEntries()` | bentuk yang pelayan simpan |

**WAJIB selepas menyunting fail itu.** Tanpa ini `dist/` lapuk dan import gagal dengan
kunci yang kelihatan tidak wujud:

```powershell
cd packages\shared; npx tsc --build
```

Pelayan menyegerakkan dari registry untuk memberi nombor; web merendernya dan jatuh balik
kepada perkataan sumber. Salinan per-app pernah dipertimbangkan dan ditolak: dua salinan
menyimpang, dan yang menyimpang ialah yang seseorang sedang terjemah.

## Corak pada web

#[[file:apps/web/src/lib/translation.tsx]]

```tsx
<T k="login.email" />                          // node, membawa lencana nombor
<T k="roles.viewOnly.heading" vars={{ count: 5 }} />
const { t, tEnum } = useLabels();
t('roles.search')                              // string, untuk placeholder/aria-label/title
tEnum(MAP[value], value)                       // peta enum, dengan sandaran
<TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
```

**`<T>` tiada prop `fallback`.** Ia membaca `LABELS[k]` sendiri. Menghantar sandaran di
setiap tempat panggilan bermakna dua tempat menyimpan perkataan yang sama, dan ia boleh
tidak sepadan.

**Guna `t()` bila nilainya mesti string** — `placeholder`, `aria-label`, `title`, dan
`Dialog.titleText`. Guna `<T>` di tempat lain, supaya nombor label boleh dicap padanya.

**`Dialog` yang `title`-nya node WAJIB juga ada `titleText={t(...)}`.** `aria-label` panel
tidak boleh menerima node. `PanelTabs` sama: `labelText`.

## `vars` boleh membawa `ReactNode`

`format()` menyisipkan node melalui `interleave`, jadi satu ayat yang mengandungi
`<strong>` atau `<code>` disimpan **utuh** sebagai satu label:

```tsx
<T k="roles.note.immutable" vars={{
  emphasis: <strong className="font-medium"><T k="roles.note.immutable.emphasis" /></strong>,
}} />
```

Memecahkannya menjadi tiga label mengandaikan susunan perkataan sama dalam setiap bahasa.
Ia tidak.

## Klausa bersyarat

Klausa yang kadang-kadang tiada dihantar sebagai `vars` yang **membawa tanda bacanya
sendiri**, atau ditulis sebagai ayat penuh yang berasingan. Satu label dengan slot kosong
meninggalkan sengkang atau kurungan terkapai:

```ts
// Slot membawa ruang di depan dan noktah di belakang.
'maintenance.retention.due': '{scans} akan dibuang…{punches}',
'maintenance.retention.due.punches': ' {count} punch akan kehilangan pautan buktinya…',

// Atau: ayat penuh, dicantum dengan join(' ').
'backup.run.result': '{name} ({size}) siap dalam {seconds}s.',
'backup.run.pruned': '{count} fail lama dibuang mengikut had simpanan.',
```

Pilih ayat penuh apabila klausa itu ayat sendiri. Pilih slot apabila klausa itu duduk
**di tengah** ayat.

**Jangan bina ayat dari kata kerja + rangka.** `device.saved.*` ialah empat label penuh dan
bukan `{name} {verb} dan diperiksa` — "ditambah" dan "dikemas kini" bukan perkataan yang
boleh ditukar ganti dalam rangka yang sama dalam setiap bahasa.

## Peta enum menyimpan `LabelKey`, bukan teks

```ts
const STATUS_LABELS: Record<string, LabelKey> = { online: 'device.status.online', … };
```

Fail yang memegangnya: `lib/operations-api.ts` (EXCEPTION/STATUS/EVENT/MAJOR),
`lib/reports-api.ts` (LEAVE_STATUS), `lib/settings-api.ts` (USER_STATUS, LEVEL, CATEGORY,
SOURCE, ENTITY, ENCRYPTION), `server/routes/reports.ts` (FIELD_LABELS),
`server/auth/permissions.ts` (ACTION_LABELS), dan peta setempat dalam LiveMonitorPage,
DevicesPage, ShiftsPage, HolidaysPage, PayrollExportPage, LogsPage, ApiTokenList.

**Bahaya yang `tsc` tidak tangkap.** Selepas menukar peta kepada kunci, `MAP[k] ?? k` masih
bertaip `string` — ia mencetak **kunci** pada skrin. Grep selepas setiap perubahan:

```powershell
Select-String -Path apps\web\src -Recurse -Pattern "\{[A-Z_]+_LABELS\["
```

Setiap padanan mesti dibalut `<T>`, `<TEnum>`, atau `t()`/`tEnum()`. Ini sudah berlaku dua
kali: `ApiTokenList` mencetak `tokenStatus.active`, dan `DevicesPage` mencetak `degraded`
dalam grid butiran sementara setiap lencana di skrin yang sama berkata `BERMASALAH`.

## Huruf besar ialah persembahan

`.toUpperCase()` **tidak digunakan** pada rentetan terjemahan — ia tidak selamat dalam
setiap bahasa. Lencana dan chip mendapat `uppercase` dalam `className`; `ChipBar` sudah ada
`<span className="uppercase">` sendiri.

## Bila satu label, bila dua

Kunci `app.*` bermakna **dipakai lebih satu komponen**:

```
app.brand  app.loading  app.refresh  app.remove
app.error.save  app.error.remove  app.status.active  app.status.inactive
```

`panel.column.status`, `panel.column.created`, `panel.column.actions` — pengepala lajur yang
ada pada sepuluh skrin.

**Garisan:** gabungkan apabila **idiom UI yang sama** merendernya — lencana, chip, pengepala
lajur. Jangan gabungkan merentas idiom berbeza. `shifts.shift.detail.active.yes` ('Ya', jawapan
ya/tidak) kekal berasingan daripada `app.status.inactive`, kerana daftarnya berbeza dan CSS tidak
boleh menukar satu menjadi yang lain.

Sebaliknya, apabila idiomnya **bertukar menjadi** yang sama, labelnya digabungkan. Jenis cuti
dahulunya membawa `leave.type.inactive` ('tidak aktif', prosa huruf kecil dalam sel nama); ia
sekarang lencana `Badge` dalam lajur Status seperti setiap skrin lain, jadi kunci itu dibuang dan
lajur itu membaca `app.status.inactive`. Garisannya pada idiom yang merender, bukan pada modul
yang memilikinya.

**Nama bagi tanda, bukan perkataan dalam sel.** `BoolMark` mengambil `label` yang menjadi
`aria-label` dan tooltip, dan label itu mesti menyatakan **lajur mana** yang dijawab:
`leave.type.paid.no` ialah 'Tanpa gaji', bukan 'tidak'. Sel yang melaporkan 'tidak' secara
bersendirian tidak memberitahu sesiapa apa yang dinafikan, jadi tanda ini tidak boleh berkongsi
satu pasangan ya/tidak sejagat.

Sebab menggabung: dua label berperkataan sama kena diterjemah dua kali dan boleh bercanggah.
Sidebar yang tidak sependapat dengan skrin log masuk tentang nama produk terbaca sebagai dua
aplikasi.

## Skema Zod dibina DALAM komponen

`buildSchema(t)`, bukan pada skop modul. Skema yang dibekukan pada masa import mengekalkan
wording lama selepas terjemahan ditukar.

## Pelayan menghantar KUNCI, bukan perkataan

Tiada route memulangkan prosa yang dipaparkan. Route berjalan tanpa pembaca yang bahasanya
boleh dirujuk — pemasa, probe, cron — jadi ia menghantar `labelKey`/`noteKey` dan web
menyelesaikannya.

| Route | Menghantar |
|---|---|
| `/api/reports/fields` | `labelKey`, `noteKey` pada dataset, medan dan groupBy |
| `/api/roles/matrix` | `labelKey`, `noteKey`, `actionLabels: Record<string, LabelKey>` |
| `/api/backup` | `restoreWarningKey`; `restoreHint` kekal teks (arahan shell) |
| `/api/backup/run` | `noteKey` |
| `/api/maintenance/cache` | `cleared: LabelKey[]`, `noteKey` |
| `/api/maintenance/trim-logs` | `noteKey` |
| `/api/retention/run` | `noteKey?` |
| `/api/devices/health` | `warnings: Array<{ key: LabelKey; vars? }>` |
| `/api/identity/map` | `noteKey` + `backfilled` berasingan |
| `/api/work-patterns` | `noteKey?` |
| `/api/api-tokens` skop | `labelKey` + `action`, sengkang milik label |
| `/api/users` | `noteKey?` |

**Pengecualian, dan sebabnya:**

- **Pengepala CSV** guna perkataan sumber. `BuilderResult.columns` membawa **kedua-dua**
  `labelKey` (jadual pratonton) dan `label` (fail ditulis di pelayan, tiada pembaca).
- **Mesej ralat prosa** pada pelayan menyelesaikan `LABELS[key]` sendiri — lihat
  `screenLabel()` dan `actionLabel()` dalam `auth/permissions.ts`. Prosa perlu perkataan.
- **`detail` log aktiviti** dan lajur DB seperti `decisionNote` dan `resolutionNote` ditulis
  dalam perkataan sumber. Ia rekod sejarah; menterjemahnya kemudian tidak mungkin.

Ditolak: pelayan menyelesaikan ke Melayu. Balasan yang sama dibaca oleh orang berbeza.

## Apa yang TIDAK didaftarkan

- Nama negeri Malaysia dan nama orang — kata nama khas.
- Nama bulan dari `Intl` — sudah mengikut bahasa pembaca.
- Simbol: `∅`, `#`, `—`, `••••••••`.
- Topeng dan contoh: `placeholder="000000"`, `192.168.1.250`, `2.2870`.
- Nilai tersimpan yang operator memilih secara literal: pola `YYYY-MM-DD`, `timeMode:
  manual`, nama skop `staff.directory:view`. Contoh berkerja di sebelahnya yang didaftarkan.
- **`LABEL_GROUPS`** — ia pengepala editor yang menterjemah label. Pengepala yang dibaca
  dari jadual yang sedang disunting akan berubah di bawah penterjemah.

## ID label

Autoincrement DB, dikunci pada kunci teks yang stabil. Nombor mengikut **susunan sisipan
registry**, bukan susunan skrin — itu betul, sebab ID mesti stabil supaya boleh ditulis dan
dirujuk. Jurang adalah normal; autoincrement tidak guna semula.

**Label yang hilang dari registry mendapat `retiredAt`, bukan DELETE.** ID tidak diguna
semula.

`PUT /api/translations/ms/labels` menjawab **409**. Melayu ialah sumber.

## Diagnostik nombor label

Togol **Tunjuk Label** dalam Tetapan › Konfigurasi Umum › Alih Bahasa mencap nombor pada
setiap label di seluruh antara muka. Ambar = masih perkataan sumber, hijau = sudah
diterjemah, `#–` = belum didaftarkan. Disimpan dalam `sessionStorage`, jadi ia mati apabila
tab ditutup.

Ini yang menjawab "label #412 itu di mana" tanpa memburu skrin.

## Prop yang sudah diluaskan ke `ReactNode`

Supaya ia boleh membawa lencana nombor. Kalau prop lain perlukannya, luaskan cara yang sama.

```
ui.tsx            Field.label, Field.hint, StatTile.label, StatTile.hint
RecordPanel.tsx   PanelCard.title/subtitle, PanelSection.title/subtitle,
                  PanelTab.label (+labelText), Chip.label, PanelColumn.header,
                  RecordTable.empty, SettingsGroup.title/subtitle, KeyValue.label,
                  Detail.label, PanelActions.hint
Dialog.tsx        Dialog.title (+titleText), Dialog.description,
                  DialogFooter.submitLabel/closeLabel
ChannelForm.tsx   SettingRow.label, SettingRow.hint
MaintenanceTab    HealthTile.label
```

`PanelColumn.header` menjadi node, jadi `key={column.header}` ditukar ke `key={index}` —
senarai lajur adalah statik per skrin.

## Verifikasi

```powershell
cd packages\shared; npx tsc --build
cd apps\server;     npx tsc --noEmit
cd apps\web;        npx tsc --noEmit; npx vite build
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-translation.mts "<kata-laluan>"
```

`verify-reports` diperluas untuk menyemak pengepala CSV mengandungi **perkataan** dan bukan
kunci (`!includes('reportField.')`) — mod kegagalan yang `tsc` tidak dapat tangkap.

`verify-screens` menegakkan bahawa katalog medan laporan menghantar `labelKey`/`noteKey` dan
**tiada** `label`/`note`, jadi seseorang tidak boleh memulangkan prosa ke skrin itu semula
tanpa satu semakan gagal.

## Kemajuan

**3823 kunci berdaftar. Setiap skrin siap.**

Tiada lagi fail dengan literal tinggal. Yang terakhir disiapkan ialah tujuh yang paling besar:
`UsersPage` (1518 baris), `EmailProfilesTab`, `WebhookList`, `ProfilePage`, `SecurityTab`,
`TelegramTab`, `SmsTab` — dengan kumpulan sendiri setiap satu (`users`, `emailProfile`,
`webhook`, `profile`, `security`, `telegram`, `sms`) supaya penterjemah yang bekerja pada
gateway SMS tidak perlu membaca melepasi wording tandatangan webhook.

Modul HR penuh juga berdaftar: `overtime`, `claim`, `expense`, `recruit`, `kpi`, `pay`, dan
`hr` bagi aliran kelulusan yang dikongsi. `pay` berasingan daripada `payroll` — yang kedua
ialah export kehadiran yang kerani gaji baca, yang pertama ialah modul yang membayar orang.

### Semakan orphan

Bukan skrip, satu baris. Jalankan selepas menyunting `labels.ts` — kunci yang tiada tempat
panggilan bermakna label yang tiada siapa akan lihat, dan `tsc` tidak menangkapnya.

```powershell
$root = 'f:\Programming\attendance'
$labels = [System.IO.File]::ReadAllText("$root\packages\shared\src\labels.ts")
$keys = [regex]::Matches($labels, "(?m)^\s{2}'([^']+)':") | ForEach-Object { $_.Groups[1].Value }
$srcAll = (Get-ChildItem "$root\apps\web\src", "$root\apps\server\src" -Recurse -Include *.ts,*.tsx |
  ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"
$keys | Where-Object { $srcAll -notmatch [regex]::Escape("'$_'") -and $srcAll -notmatch [regex]::Escape("`"$_`"") }
```

**Semak kedua-dua bentuk petikan.** JSX menulis `k="sms.title"` dengan petikan berganda dan
kod menulis `t('sms.title')` dengan petikan tunggal; menyemak satu sahaja melaporkan separuh
registry sebagai orphan.

### Yang kekal TIDAK didaftarkan, dan sebabnya

Selain senarai dalam bahagian "Apa yang TIDAK didaftarkan" di atas:

**Tooltip diagnostik nombor label** dalam `lib/translation.tsx` (`LabelNumber`). Pengecualian
yang sama dengan `LABEL_GROUPS`: ia milik alat yang menterjemah, bukan antara muka yang
diterjemah. Mendaftarkannya akan memberi lencana yang memaparkan nombor label satu nombor
label sendiri untuk dipaparkan, dan sesiapa yang menghidupkan diagnostik untuk memburu
rentetan belum diterjemah akan menjumpai diagnostik itu melaporkan dirinya sendiri.

**Topeng tanpa perkataan** — `1.0.0`, `96000`, `smtp.hospital.local`, `ServiceSMS`,
`@namachannel`, `-1001234567890`, `CST-8:00:00`. Tetapi contoh yang **membawa prosa** memang
didaftar: `'cth. Jururawat Masyarakat U29'` dan `'cth. Portal HR — kemas kini cuti'` ada
singkatan Melayu dan kata nama Melayu di dalamnya.

Garisnya: ada perkataan yang seseorang boleh terjemah, ia didaftar.

### Seterusnya

Perluas `verify-translation` supaya ia membuktikan liputan **dua hala** dalam CI dan bukan
dengan satu baris PowerShell — setiap kunci registry ada tempat panggilan, dan setiap tempat
panggilan ada kunci — lalu jalankan suite penuh dengan jeda 80s antara skrip.

**Belum disahkan berjalan:** perubahan pada `verify-screens` (semakan bentuk katalog medan
laporan) dan `verify-identity` (`noteKey` menggantikan `note`). Kedua-duanya perlukan pelayan
hidup.
