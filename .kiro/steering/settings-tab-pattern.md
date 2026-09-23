---
inclusion: fileMatch
fileMatchPattern: '**/{pages,components}/**/*.tsx'
---

# Corak skrin tetapan bertab

> **Rujukan reka bentuk bagi SELURUH aplikasi ialah Cuti** — `LeaveRequestsPage` untuk skrin
> senarai dan dialognya, `LeaveSettingsPage` untuk skrin tetapan bertab. Ini termasuk kedudukan
> butang, ikon, dan bentuk popup modal. Lihat bahagian **"Rujukan rasmi: Cuti"** di penghujung
> fail ini sebelum membina atau membetulkan mana-mana skrin. Bila skrin lain bercanggah dengan
> yang ini, **yang ini betul**.

Rujukan: **Tetapan Cuti** (`/jadual/permohonan/tetapan`) — `LeaveSettingsPage` dengan empat tabnya.
Bila membina atau membetulkan skrin tetapan, buka yang itu dan padankan. Halaman ini menerangkan
**mengapa** ia berbentuk begitu, supaya padanan itu bukan sekadar salinan.

Ini melengkapkan steering `ui-layout`, bukan menggantikannya. Peraturan shell di sana masih terpakai.

#[[file:apps/web/src/pages/LeaveSettingsPage.tsx]]
#[[file:apps/web/src/pages/LeaveRequestsPage.tsx]]

## Dua bentuk tab, dan cara memilih

Satu skrin tetapan ada tab yang **menyenarai** dan tab yang **mengkonfigurasi**. Ia tidak
berkongsi susunan, dan mencampurnya ialah punca kebanyakan skrin yang nampak tidak siap.

| Tab | Kandungan | Susunan |
|---|---|---|
| Jenis Cuti, Templat Emel, Aliran Kelulusan | jadual rekod | `PanelSection` → `FilterRow` → `RecordTable framed` → `PanelFooter` |
| Notifikasi | borang keputusan | `PanelSection` → `SettingsStack` → `SettingsGroup` → `PanelActions` |

Tab jadual **tidak** berakhir dengan `PanelActions`; ia menyimpan per baris melalui dialog.
Tab borang **tidak** ada `RecordTable`; ia menyimpan sekali melalui satu butang.

## Kiraan duduk dalam tajuk, bukan dalam nota

```tsx
<PanelSection
  title={<T k="leave.type.count" vars={{ count: rows.length }} />}   // "6 jenis cuti"
  subtitle={<T k="leave.type.subtitle" />}
  action={<Button><Plus /> <T k="leave.type.add" /></Button>}
/>
```

Tab Aliran Kelulusan dahulunya mengepalai jadualnya dengan `hr.approval.title` ('Aliran Kelulusan')
dan meletakkan panjang rantaian dalam `PanelNote` di bawahnya — **tajuk yang mengulang nama tab di
atasnya**, dan angka yang sepatutnya dalam tajuk itu dibuang ke perenggan. Kunci itu dibuang. Tajuk
seksyen ialah kiraan: `3 aras kelulusan`.

**Satu tindakan dalam slot `action`.** `PanelSection` sendiri sudah `flex-wrap`, jadi kelompok tiga
kawalan di dalamnya pecah satu baris seorang dan menjadi tindanan menegak. Penapis masuk `FilterRow`.

## Nota: paling banyak satu, dan hanya yang boleh ditindak

Ini kegagalan yang paling kerap berulang. Tiga skrin telah dibetulkan daripadanya.

| Fakta | Tempat yang betul |
|---|---|
| sebab butang mati | jalur `PanelNote tone="warn"` atas jadual, **dan** `title` pada butang |
| akibat satu tindakan baris | dalam `label` `RowAction` itu — ia tooltip dan `aria-label` sekali |
| peraturan format satu medan | `hint` medan itu dalam dialog |
| kaveat tentang keputusan | prop `description` pada `Dialog` |
| apa yang simpan akan/tidak akan buat | prop `hint` pada `PanelActions`, di sebelah butang |
| polisi am | **tidak ke mana-mana.** Buang. |

Contoh: `hr.approval.suspended.note` ('aras digantung dilangkau — rantaian jadi lebih pendek, bukan
tersekat') dahulunya jalur di bawah jadual. Ia sekarang disambung pada label tindakan gantung, jadi
ia dibaca pada saat keputusan dibuat dan bukan selepasnya. `leave.type.backdatedNote` pula dibuang
terus — ia mengulang hint checkbox dalam dialog.

## Sel jadual: tanda, pill, lencana — bukan perkataan

Lajur `ya` / `tidak` / `dibenarkan` terbaca sebagai longgokan nilai medan: setiap sel sama berat,
jadi mencari baris yang berbeza bermakna membaca semuanya.

```tsx
<CodePill code={row.code} colour={row.colour} />        // pengenal di kepala baris
<BoolMark value={row.paid} label={t('leave.type.paid.no')} />
<Badge tone={row.active ? 'success' : 'neutral'}><T k="app.status.active" /></Badge>
```

**`BoolMark.label` mesti menyatakan lajur mana yang dijawab.** `'Tanpa gaji'`, bukan `'tidak'`. Tanda
itu imej — pembaca skrin sampai pada sel yang tidak mengumumkan apa-apa tanpa label, dan sel yang
melaporkan 'tidak' bersendirian tidak memberitahu apa yang dinafikan.

**Status dapat lajurnya sendiri.** Bukan `Badge` diselitkan di bawah nama. Lajur nama membawa nama
dan keterangan; status ialah lajur kedua dari belakang, sebelum Tindakan.

**Tona membawa daftar, bukan keterukan.** `info` dan `accent` ada dalam `Badge` khusus untuk ini:
kategori yang terhad bukan kesalahan. Jangan guna `danger` untuk mewarnakan kategori. `warning`
dibenarkan bila nilai itu memang patut diperhatikan — `Hari kalendar` ambar sebab ia mengecaj hari
rehat.

**Huruf besar melalui `className` pada `Badge`.** Bukan `<span className="uppercase">` di dalamnya,
dan bukan `.toUpperCase()` — yang tidak selamat dalam setiap bahasa.

## Dialog

```tsx
<Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="2xl" onClose={onClose}>
```

**Lebar mengikut baris terlebar di dalamnya.** `md` (448px) hanya untuk pengesahan. Borang dengan
baris lima-melintang perlukan `2xl` (1024px). Pada `xl` label terpanjang masih membalut dua baris,
yang menolak inputnya separuh baris ke bawah dan barisan jadi ragged — **ketidaksamarataan** itu
yang terbaca sebagai teruk, bukan kepadatan.

Dialog Templat Emel juga `2xl`, atas sebab berbeza: ia memegang badan monospace dua belas baris dan
satu grid chip placeholder. Pada `lg` chip itu membalut empat baris dan badannya jadi lajur sempit
berisi baris templat yang terbalut — bentuk paling sukar untuk membaca semak satu emel. **Dialog
dalam satu skrin tetapan yang sama guna lebar yang sama** melainkan ada sebab yang dinyatakan.

**Blok terakhir sebelum `DialogFooter` perlukan `pb`.** Footer itu `sticky bottom-0` dengan margin
negatif yang membatalkan padding badan, jadi pada borang yang cukup panjang untuk ditatal ia terapung
atas kandungan. Tanpa `pb-2`, elemen terakhir mendarat terus atas garis footer dan terbaca sebagai
terpotong.

**Setiap label satu baris.** Label yang membalut memindahkan inputnya sendiri. Pendekkan labelnya:
`Kelayakan setahun (hari)` → `Hari setahun`, dengan unit dalam hint.

**Susunan medan:** identiti (kod, nama) → prosa (keterangan) → nilai yang dipilih (grid) → kad
checkbox → `DialogFooter`.

```tsx
<div className="grid gap-4 sm:grid-cols-[7rem_1fr]">        {/* kod | nama */}
<TextArea label={…} hint={…} rows={2} />                     {/* keterangan */}
<div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
<div className="space-y-2 pb-2">                             {/* kad checkbox */}
```

`items-start` supaya sel bergantung pada satu garis dan bukan meregang ke hint tertinggi.
`pb-2` pada tindanan kad supaya kad terakhir lepas dari footer — `DialogFooter` ialah
`sticky bottom-0` dengan margin negatif, jadi ia terapung atas kandungan bila borang ditatal.

## `CheckCard`, bukan checkbox berbaris

Deretan checkbox kosong terbaca sebagai satu perenggan dengan tanda di kiri, dan hint setiap satu
bertaut ke label seterusnya. Mengotakkannya menjadikan setiap pilihan sasaran bersempadan, dan
menonakan yang ditanda bermakna keadaan seluruh kumpulan dibaca dengan memandang.

```tsx
<CheckCard checked={paid} onChange={setPaid}
           icon={<Banknote className="size-4" aria-hidden />}
           title={<T k="leave.type.dialog.paid" />}
           hint={<T k="leave.type.dialog.paid.hint" />} />
```

Seluruh kotak ialah `<label>`, jadi hint itu bahagian sasaran klik.

**Medan yang bergantung muncul bila kad ditanda**, bertakuk `pl-9` supaya ia jelas milik kad itu:

```tsx
{serviceTiers && (
  <div className="grid gap-4 pb-1 pl-9 sm:grid-cols-3">…</div>
)}
```

Tiga kotak nombor yang tidak buat apa-apa lebih buruk daripada kad yang membesar, dan pasangan yang
dilumpuhkan terbaca sebagai ciri yang orang lain kena buka.

**Guna step palet yang WUJUD.** `index.css` hanya ada `brand-100/500/600/700`. `brand-300` dan
`brand-50` tidak wujud — Tailwind tidak keluarkan apa-apa untuk step yang tiada, jadi `border` jatuh
ke `currentColor` dan setiap kad bertanda melukis garis **hitam** atas putih. Kad bertanda ialah
`border-brand-500 bg-brand-100/60`.

## Select: tiga jenis, dan ia tidak boleh ditukar ganti

| Komponen | Bila |
|---|---|
| `SelectField` (`ui.tsx`) | dalam borang/dialog — label **nampak**, ada hint |
| `SelectControl` (`ChannelForm.tsx`) | dalam `SettingRow` atau `FilterRow` — `aria-label` sahaja |
| `FacetSelect` (`RecordPanel.tsx`) | penapis di mana **kosong bermakna tiada penapis** |

**`FacetSelect` menyisipkan satu opsyen kosong yang membawa labelnya sendiri.** Itu betul untuk
penapis. Dalam borang ia **pepijat**: dialog aliran kelulusan menghantar pelulus kosong sebab opsyen
kosong itu boleh dipilih. Kalau medan itu sentiasa ada nilai, ia bukan facet.

Bila "tiada" memang pilihan sah — profil emel — tulis `<option value="">` sendiri supaya niat itu
kelihatan dalam kod.

## Tab borang: `Switch`, bukan checkbox mentah

```tsx
<SettingRow label={<T k="hr.notify.applicant" />} hint={<T k="hr.notify.applicant.hint" />}>
  <Switch checked={on} onChange={setOn} label={t('hr.notify.applicant')} />
</SettingRow>
```

Setiap baris tetapan lain — Integrasi, Konfigurasi Umum, Keselamatan — guna `Switch`. Tab Notifikasi
duduk bersebelahan mereka dengan tanda asli. Keadaan saluran ialah sesuatu yang dibaca dari seberang
meja, dan itu sebab `Switch` ada.

**Jangan sarangkan `PanelNote` dalam `SettingRow`.** Kalau syaratnya bergantung pada keadaan, tukar
`hint` baris itu:

```tsx
hint={profileMissing ? <T k="hr.notify.profile.notSending" /> : <T k="hr.notify.profile.hint" />}
```

**`PanelActions` dapat `hint`**, bukan `PanelNote` di atasnya. Apa yang simpan akan dan tidak akan
buat dibaca pada saat memutuskan untuk menekannya.

**Butang simpan di KANAN.** `PanelActions` dahulunya merender `{children}` dahulu, jadi butang jatuh
ke kiri dengan hint mengisi ruang di kanannya. Itu meletakkan butang simpan setiap tab borang —
Integrasi, Konfigurasi Umum, Keselamatan, Notifikasi, 23 tempat — pada sisi **bertentangan** dengan
butang simpan setiap dialog, sebab `DialogFooter` ialah `justify-end`. Dua jalur yang menutup borang
dalam aplikasi yang sama tidak boleh bercanggah tentang di mana kawalan commit-nya duduk; mata pergi
ke satu sudut dan menjumpainya separuh masa. Hint mengambil ruang bebas supaya butang kekal melekat
pada tepi kanan seberapa panjang pun ayat itu.

## `whitespace-nowrap` pada butang

Sudah ada dalam `Button`. Label butang ialah label, bukan perenggan — tanpanya label dua perkataan
pecah baris sebaik barisnya sempit dan kawalan itu jadi lebih tinggi daripada segala di sebelahnya,
yang terbaca sebagai rosak dan bukan sebagai sempit. Kalau label terlalu panjang untuk ruang, **label
itu terlalu panjang**.

Butang jangan membawa nilai yang kawalan di sebelahnya sudah memaparkan. `Sync 2026` di sebelah
dropdown tahun menyebut nombor itu dua kali — dan semasa butang itu berwayar ke tahun *tetapan*
bukan tahun *dipapar*, kedua-duanya boleh bercanggah terus.

## Rollout `framed` masih berperingkat

`RecordTable framed` ialah opt-in. Setakat ini: `LeaveTypesPanel`, `ApprovalWorkflow`,
`EmailTemplates`, senarai cuti umum dalam Integrasi. **59 jadual lain masih penuh lebar.** Tukar
dengan sengaja, satu skrin satu masa, dan padankan keseluruhan corak pada skrin itu — bukan hanya
propnya. Grep untuk mencari yang belum:

```powershell
$f = Get-ChildItem 'apps\web\src' -Recurse -Include *.tsx
$f | Select-String -Pattern '<RecordTable' -Context 0,1 | Where-Object { ($_.Context.PostContext -join '') -notmatch 'framed' }
```

Dan untuk corak lencana lama:

```powershell
$f | Select-String -Pattern '<Badge' -Context 0,2 | Where-Object { ($_.Context.PostContext -join '') -match '<span className="uppercase"' }
```

## Verifikasi selepas menyunting mana-mana ini

```powershell
cd packages\shared; npx tsc --build
cd apps\web;        npx tsc --noEmit; npx vite build
```

Kemudian semakan label yatim — membuang satu tempat panggilan meninggalkan kunci yang tiada siapa
akan lihat, dan `tsc` tidak menangkapnya. Rangkai pada **satu baris**; gelung berbilang baris menelan
output dalam shell ini:

```powershell
$root='f:\Programming\attendance'; $labels=[System.IO.File]::ReadAllText("$root\packages\shared\src\labels.ts"); $keys=[regex]::Matches($labels,"(?m)^\s{2}'([^']+)':") | ForEach-Object { $_.Groups[1].Value }; $files=Get-ChildItem "$root\apps\web\src","$root\apps\server\src","$root\packages" -Recurse -Include *.ts,*.tsx | Where-Object { $_.Name -ne 'labels.ts' -and $_.FullName -notmatch '\\dist\\' -and $_.FullName -notmatch 'node_modules' }; $srcAll=($files | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"; $orphans=@($keys | Where-Object { $srcAll -notmatch [regex]::Escape("'$_'") -and $srcAll -notmatch [regex]::Escape("`"$_`"") }); "KUNCI=$($keys.Count) YATIM=$($orphans.Count)"; $orphans
```

**`packages` seluruhnya, bukan `packages\shared\src`.** Versi lama melaporkan
`device.warning.remoteCheck` sebagai yatim pada setiap larian: satu-satunya tempat panggilannya
ialah probe kesihatan dalam `packages/terminal-drivers`, yang berpindah ke pakejnya sendiri dalam
`78e1af8` sementara senarai imbasan tidak bergerak.

**Label yatim bukan sentiasa untuk dibuang.** Dua daripada tiga yang muncul semasa kerja ini membawa
fakta sebenar yang tempatnya salah, bukan fakta yang tidak diperlukan. Baca setiap satu sebelum
memadam.

---

# Rujukan rasmi: Cuti

**Dua skrin ini adalah rujukan bagi setiap skrin lain dalam aplikasi.** Bukan sekadar contoh —
bila ada percanggahan antara skrin lain dan yang ini, yang ini betul.

| Rujukan | Fail | Untuk |
|---|---|---|
| **Permohonan Cuti** | `apps/web/src/pages/LeaveRequestsPage.tsx` | skrin **senarai** + dialog rekod baharu |
| **Tetapan Cuti** | `apps/web/src/pages/LeaveSettingsPage.tsx` | skrin **tetapan bertab** (4 tab) |

Buka kedua-duanya sebelum membina skrin baharu. Padankan susunan, kedudukan butang, ikon, dan
bentuk dialog. Jangan reka semula mana-mana daripadanya.

## Kedudukan butang — satu peraturan, dua jalur

**Setiap kawalan commit duduk di KANAN.**

| Jalur | Komponen | Kenapa |
|---|---|---|
| dialog | `DialogFooter` | `justify-end` — Batal kiri, Hantar kanan |
| tab borang | `PanelActions` | hint mengambil ruang bebas, butang melekat tepi kanan |

`PanelActions` dahulunya merender `{children}` dahulu, jadi butang simpan **23 tempat** jatuh ke
kiri sementara setiap dialog meletakkannya di kanan. Dua jalur yang menutup borang dalam aplikasi
yang sama tidak boleh bercanggah tentang di mana kawalan commit duduk — mata pergi ke satu sudut
dan menjumpainya separuh masa.

**Tindakan utama skrin duduk dalam `PanelSection.action`**, di kanan tajuk. Satu sahaja; kelompok
tiga kawalan pecah menjadi tindanan menegak sebab `PanelSection` itu `flex-wrap`.

## Ikon

**Setiap butang tindakan membawa ikon, di KIRI labelnya.** `<Plus className="size-4" aria-hidden />`
kemudian label. `aria-hidden` sentiasa — labelnya yang diumumkan, bukan ikonnya.

| Saiz | Tempat |
|---|---|
| `size-4` | butang, `RowAction`, `PanelSection.icon`, `CheckCard.icon` |
| `size-3.5` | `SettingsGroup.icon`, `PanelNote.icon`, ikon dalam teks kecil |
| `size-3` | titik status dalam sel |

**Ikon `RowAction` membawa tona, dan tona membawa akibat:** biru membaca, ambar mengubah, merah
membuang. `RowAction` mesti ada `label` — ia tooltip dan `aria-label` sekali.

**`PanelSection.icon` hanya untuk tajuk yang membuka tab.** Mengulanginya pada setiap sub-tajuk
menjadikan lajur ikon itu perkara yang dibaca dan bukan tajuknya.

Ikon yang sudah dipakai untuk maksud tertentu — jangan tukar: `Plus` tambah, `Trash2` buang,
`Upload` muat naik, `FileText` dokumen ada, `Paperclip` lampiran, `UserRound` orang,
`Loader2` sedang memuat.

## Dialog — bentuk penuh

```tsx
<Dialog title={<T k={k} />} titleText={t(k)} description={<T k={`${k}.description`} />}
        width="2xl" onClose={onClose}>
  <div className="space-y-4">
    <Feedback error={error} />
    …medan…
    <div className="space-y-4 pb-2">  {/* blok TERAKHIR */}
      …jalur jumlah / nota…
    </div>
    <DialogFooter onClose={onClose} onSubmit={() => void submit()}
                  busy={busy} disabled={blocked} submitLabel={<T k={`${k}.submit`} />} />
  </div>
</Dialog>
```

**Lebar mengikut baris terlebar di dalamnya.**

| Lebar | max-w | Untuk |
|---|---|---|
| `md` | `max-w-md` | pengesahan sahaja |
| `lg` | `max-w-2xl` | borang satu lajur |
| `xl` | `max-w-4xl` | — |
| `2xl` | `max-w-5xl` | borang dengan baris lima-melintang (jenis cuti, templat emel) |
| `3xl` | `max-w-6xl` | borang dengan **blok berulang** — baris tuntutan + jalur lampiran |

`3xl` ditambah untuk borang tuntutan: setiap baris ialah grid empat-melintang **campur** jalur
lampirannya sendiri, dan sehingga 50 baris bertindan. Pada `2xl` medan setiap baris cukup sempit
sehingga keterangan dibaca beberapa perkataan sekali — dan sebab lebar itu penting ialah seseorang
sedang membandingkan satu baris dengan baris seterusnya.

**Blok terakhir sebelum `DialogFooter` WAJIB ada `pb-2`.** `DialogFooter` ialah `sticky bottom-0`
dengan margin negatif yang membatalkan padding badan, jadi pada borang yang ditatal ia terapung
atas kandungan. Tanpa `pb-2` jalur jumlah mendarat **terus atas garis footer tanpa gap** — dan
kotak bertona yang menyentuh seperator terbaca sebagai terpotong, bukan sebagai selesai.

**`Dialog` yang `title`-nya node WAJIB ada `titleText={t(...)}`.** `aria-label` panel tidak boleh
menerima node.

**Susunan medan:** identiti → prosa → nilai dipilih (grid) → kad checkbox → blok `pb-2` →
`DialogFooter`.

## Pemilih nama dua peringkat

Borang yang menyebut seorang staf **tidak** guna `<select>`. Direktori ini 5002 orang — satu select
setiap seorang ialah suku megabait opsyen tanpa cara mencarinya.

```
peringkat 1: Field carian + senarai calon (debounce 250ms, ditapis di PELAYAN)
peringkat 2: jalur staf terpilih + butang Tukar, kemudian borang penuh
```

Rujukan: `LeaveRequestsPage`. `ClaimsPage` menyalinnya. Endpoint carian **satu per modul**
(`/api/leave-requests/staff-search`, `/api/claim-requests/staff-search`) sebab pintunya berbeza —
sesiapa yang memfailkan tuntutan bukan semestinya sesiapa yang memfailkan cuti.

**Memilih staf memuatkan fakta yang bergantung padanya.** Cuti memuatkan baki dan kelayakan setiap
jenis; jangan tunjukkan medan yang jawapannya belum boleh dikira.

## Lampiran fail dalam dialog

**Input fail tidak boleh dihantar bersama JSON.** Ia pemegang kepada sesuatu pada cakera pengguna,
bukan nilai dalam borang. Urutannya:

```
1. fail disimpan dalam state draf (per baris — satu input tersembunyi setiap baris)
2. rekod difailkan; route memulangkan id baris yang dicipta, dalam susunan dihantar
3. fail dimuat naik satu-satu, dipetakan mengikut POSISI
```

**Satu input dikongsi merentas baris akan melampirkan fail kepada baris yang mencetuskannya
terakhir** — itu resit yang difailkan terhadap kos yang salah. Sebab itu `DraftReceipt` dan
`ItemReceipt` ialah komponen sendiri.

**Perkataan mesti menyatakan urutan itu.** `'Akan dimuat naik selepas hantar'` — butang berlabel
"Lampirkan" yang tidak memuat naik apa-apa sampai Hantar ditekan ialah kawalan yang menipu.

**Muat naik gagal TIDAK menggagalkan rekod.** Rekod sudah tersimpan; membuang ralat akan
meninggalkan skrin melaporkan kegagalan bagi rekod yang wujud — bacaan yang membuat seseorang
memfailkannya kali kedua. Laporkan kiraan, biarkan lampiran dibuat semula dari senarai.

**Berjujukan, bukan `Promise.all`.** Lima puluh muat naik serentak atas rangkaian hospital ialah
cara tiga yang pertama berjaya dan yang lain tamat masa.

## Yang mesti disemak sebelum berkata siap

```powershell
cd packages\shared; npx tsc --build
cd apps\server;     npx tsc --noEmit
cd apps\web;        npx tsc --noEmit; npx vite build
node node_modules/tsx/dist/cli.mjs scripts/missing-en.mts
```

`missing-en.mts` keluar bukan-sifar bagi **tiga** perkara: label tanpa terjemahan Inggeris, kunci
usang dalam `scripts/translations/en.ts`, dan placeholder yang menyimpang. Ketiga-tiganya tidak
ditangkap `tsc` — `scripts/` tiada dalam mana-mana tsconfig, jadi
`Partial<Record<LabelKey, string>>` pada fail itu **tidak pernah disemak**. Itulah sebab 18 kunci
usang berkumpul di sana tanpa disedari.

Kemudian semakan label yatim (satu baris) dalam bahagian Verifikasi di atas.
