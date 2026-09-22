---
inclusion: fileMatch
fileMatchPattern: 'apps/web/src/**/*.tsx'
---

# Corak skrin senarai

Setiap skrin senarai dalam aplikasi ini menggunakan shell yang sama, diekstrak ke
`apps/web/src/components/RecordPanel.tsx`. Jangan bina semula shell itu dengan tangan:
layout yang disalin merentas dua puluh skrin akan menyimpang dalam satu keluaran, dan
penyimpangan itu kelihatan sebagai aplikasi yang separuh siap.

#[[file:apps/web/src/components/RecordPanel.tsx]]

## Susunan

Satu kad, dalam susunan ini. Langkau mana-mana yang tidak berkenaan, jangan susun semula.

```
PanelCard          tajuk + subtajuk
 └ PanelTabs       hanya jika skrin ada lebih satu subjek
 └ PanelSection    sub-tajuk tab + tindakan utama
 └ ChipBar         penapis status dengan kiraan
 └ FilterRow       carian, facet, tarikh, reset, export
 └ RecordTable     penuh lebar kad
 └ PanelFooter     N daripada N, per halaman, halaman, muat semula
```

Tab yang kandungannya **borang** dan bukan jadual guna `SettingsStack` + `SettingsGroup`
diikuti `PanelActions`, bukan `RecordTable` + `PanelFooter`.

```
PanelCard
 └ PanelTabs
 └ PanelSection      tajuk tab + ikon + suis saluran
 └ SettingsStack     padang kelabu cerah
    └ SettingsGroup  satu kad per kumpulan tetapan
       └ SettingRow  label + hint di kiri, kawalan di kanan
 └ PanelActions      butang simpan
```

```tsx
<PanelSection icon={<Plug className="size-4" aria-hidden />} title="API & Webhook"
              subtitle="…" action={<ChannelSwitch enabled={enabled} onChange={setEnabled} />} />

<SettingsStack>
  <SettingsGroup title="Akses" icon={<ShieldCheck className="size-3.5" aria-hidden />}
                 action={<span className="…">MENJAWAB</span>}>
    <SettingRow label="Perlukan token" hint="…">
      <Switch checked={requireToken} onChange={setRequireToken} label="…" />
    </SettingRow>
  </SettingsGroup>
</SettingsStack>

<PanelActions hint="…"><Button>Simpan konfigurasi</Button></PanelActions>
```

**Kumpulan tetapan dikotakkan, bukan dijalankan rata.** Tab konfigurasi adalah senarai
keputusan berasingan, bukan satu borang. Dijalankan rata, barisnya bercampur menjadi satu
lajur kawalan dan operator kena membaca setiap label untuk mencari kumpulan yang mereka
datang untuk. Menukar permukaan di bawah kad itulah yang menjadikan setiap satu terbaca
sebagai objek sendiri — sama seperti badan aplikasi terbaca terhadap sidebar.

**`SettingsStack` tiada sempadan sendiri.** Perubahan permukaan itulah sempadannya;
menambah sempadan akan berganda dengan `border-t` bar tindakan yang menyusulnya.

**`SettingsGroup.action` membawa ringkasan hidup** — `120/min`, `3 disenaraikan`,
`KUNCI TERSIMPAN`. Sekilas pandang pada kepala kad patut menjawab "apa nilainya sekarang"
tanpa membaca barisnya.

**`PanelSection` dapat `icon` hanya untuk tajuk yang membuka tab.** Mengulanginya pada
setiap sub-tajuk akan menjadikan lajur ikon itu perkara yang dibaca dan bukan tajuknya.

**Jadual tidak dikotakkan dengan `SettingsGroup`.** Senarai token dan senarai webhook guna
`PanelSection` + `RecordTable` + `PanelFooter` seperti biasa — selnya yang membawa padding,
dan `SettingsGroup` akan menambah padding keduanya di atas itu. Jadual yang perlu sempadan
mendapatnya daripada `RecordTable framed`, yang direka untuk itu; lihat "Keputusan yang sudah
dibuat" di bawah.

```tsx
<PanelCard title="Pengurusan Pengguna" subtitle="…">
  <PanelTabs label="Jenis akaun" active={tab} onChange={setTab} tabs={[…]} />
  <PanelSection title="Administrator" subtitle="…" action={<Button>Tambah</Button>} />
  <ChipBar chips={chips} active={status} onChange={setStatus} />
  <FilterRow search={search} onSearch={setSearch} dirty={dirty} onReset={reset}>
    <FacetSelect label="Semua jabatan" value={dept} onChange={setDept} options={…} />
  </FilterRow>
  <RecordTable columns={[…]} loading={loading} rowCount={rows.length} empty="…">
    {rows.map((row) => <Row key={row.id} row={row} />)}
  </RecordTable>
  <PanelFooter shown={rows.length} total={total} page={page} pageSize={pageSize}
               generatedAt={data?.generatedAt} loading={loading}
               onPage={setPage} onPageSize={setPageSize} onRefresh={load} />
</PanelCard>
```

## Keputusan yang sudah dibuat

Ini bukan pilihan gaya. Setiap satu menyelesaikan masalah yang sudah berlaku.

**Padding pada sel, bukan pada jadual.** Sebab itu garis pengepala dan footer berjalan
penuh lebar kad, dan kad itu terbaca sebagai satu objek. Lajur pertama `px-5`, yang lain
`px-2`.

**`RecordTable framed` untuk jadual yang barisnya sebahagian besarnya ruang kosong.**
Penuh lebar berhenti berfungsi bila satu lajur mengembang dan tujuh lagi sempit: nilai
berkumpul rapat pada kedua-dua tepi dengan lubang di tengah, dan tanpa sempadan untuk mata
mengukur kedudukan itu, baris terbaca sebagai data terlepas dan bukan sebagai rekod.

`framed` meletakkan jadual dalam kad bersempadannya sendiri atas padang kelabu cerah. Ia
peranti yang sama dengan `SettingsStack`, atas sebab yang sama — perubahan permukaan itulah
yang menjadikan sesuatu terbaca sebagai objek sendiri — dipakai pada jadual dan bukan pada
deretan kumpulan.

Dua perkara dikendalikan dalam `RecordTable`, bukan di tempat panggilan, sebab baris ditulis
per skrin dan ini mesti berlaku pada semuanya: `thead` mendapat jalur `bg-slate-50/70`, dan
`border-b` baris terakhir dibuang supaya ia tidak mendarat atas tepi bawah kad sebagai garis
berganda.

**Ia opt-in, dan rollout berperingkat.** Lalai masih penuh lebar. Aplikasi yang separuh
ditukar lebih buruk daripada mana-mana satu keadaan, jadi setiap jadual ditukar dengan
sengaja dan bukan secara pukal. **`LeaveTypesPanel` ialah rujukannya** — tukar yang lain
dengan melihat yang itu, bukan dengan menyalin layout.

**Kiraan chip dikira mengabaikan penapisnya sendiri.** Kalau tidak, memilih satu chip
menjadikan yang lain sifar dan baris yang tinggal nampak seperti hilang. Chip pada sifar
dipaparkan tetapi tidak boleh diklik — sifar itu maklumat, butang yang tak ke mana-mana
itu perangkap.

**Carian dalam `FilterRow` adalah pilihan.** Kotak carian yang menerima taipan tetapi
tidak menapis apa-apa lebih buruk daripada tiada kotak: ia mengajar operator bahawa
senarai itu rosak.

**Reset dimatikan bila tiada apa ditapis.** Supaya ia tidak menjemput klik yang tidak
mengubah apa-apa.

**Tindakan memusnah dimatikan dengan sebab dalam tooltip.** Bukan hidup lalu pulangkan
409. Kalau jenis cuti tidak boleh dibuang kerana ada sejarah, tong sampah itu kelabu dan
tooltip berkata mengapa.

**`window.confirm` tidak digunakan.** Gunakan `Dialog` + `DialogFooter`. Pemadaman yang
serius perlu dua langkah — gantung dahulu, baru buang.

**Baris bermasalah bertona sebelum lajur status dibaca.** `bg-amber-50/40` untuk yang
perlu perhatian, `bg-rose-50/40` untuk yang rosak. Mata jumpa warna sebelum ia membaca
teks.

**Butang export disembunyikan bila kebenaran tiada.** `can(module, 'export')` dari
`useAuth()`. Export yang 403 mengajar operator bahawa laporan itu rosak, bukan bahawa
mereka tiada kebenaran.

**`generatedAt` dalam footer.** Ini jadual hidup; halaman yang terbuka dua puluh minit
nampak serupa dengan yang baharu tanpa cap masa.

**Kaveat dalam `PanelNote`, bukan tooltip.** Tetapan yang akibatnya hanya muncul bila
dihover adalah tetapan yang ditukar tanpa akibatnya dibaca.

**Kawalan ikon-sahaja mesti ada nama.** `RowAction` mengambil `label` yang menjadi
tooltip dan `aria-label` sekali. Tona membawa akibat: biru membaca, ambar mengubah,
merah membuang.

**Editor lebar dapat halaman sendiri, bukan dialog.** Matriks kebenaran empat puluh
skrin × sembilan tindakan perlukan lebar viewport, dan dialog akan menyembunyikan
seksyen yang barisnya sedang ditanda.

## Sidebar

Rel cerah (`bg-white border-r`), bukan gelap. Badan aplikasi adalah kad putih atas
padang kelabu cerah; rel gelap di sebelahnya terbaca sebagai aplikasi berasingan yang
didok di tepi. Berkongsi permukaan menjadikan seluruh tetingkap satu objek — dan ia
memberi baris aktif tempat untuk menonjol, sebab pada rel gelap setiap baris sudah
nampak ditekankan.

**Setiap entri ada ikon sendiri** dalam `lib/nav.ts` (`NavItem.icon`), dan setiap kumpulan
ada ikonnya sendiri (`NavGroup.icon`) yang dipakai pada baris kumpulan dan pada rel yang
dikuncupkan. Baris ini dipandang, bukan dibaca; ikon itu yang membolehkan orang jumpa baris
yang dicari tanpa membaca setiap label.

**Baris aktif:** `bg-brand-100 text-brand-700` + ikon `text-brand-700` + bar
`bg-brand-600` pada tepi hadapan. `brand-700` dan bukan `brand-600` sebab
`brand-600` atas `brand-100` hanya sekitar 4.1:1 — di bawah 4.5:1 yang teks 14px
perlukan, dan baris terpilih ialah satu label dalam rel yang mesti boleh dibaca sekilas.

**Kumpulan mengembang; entri tidak.** Peraturan asal ialah "tiada chevron kembang", sebab
pada masa itu tiada apa bersarang dan chevron yang tidak membuka apa-apa adalah perangkap
yang sama dengan kotak carian yang tidak menapis apa-apa. Peraturan itu meninggalkan pintu
terbuka untuk entri yang benar-benar ada anak, dan sekarang ia terpakai: **tajuk kumpulan
menjadi baris itu sendiri**, dengan anaknya di bawah.

Sebabnya bukan gaya. Dua puluh dua entri di bawah enam tajuk bermakna rel itu dinding baris,
dan mencari satu menjadi kerja membaca dan bukan memandang. Ditutup, rel itu enam baris.

```
Dashboard
──────────────
Kehadiran        ⌄
Staf             ⌄
Jadual           ⌄
Laporan          ⌄
──────────────
Tetapan          ⌃
  │ ● Konfigurasi Umum      ← aktif
  │ ○ Senarai Peranti
  │ ○ Integrasi
```

**Chevron hanya pada baris yang ada anak.** Dashboard tiada chevron dan menavigasi terus.

**Tajuk kumpulan ialah butang, bukan pautan.** Ia tiada halaman sendiri, dan memberinya satu
bermakna meneka anak mana yang jadi pintu depan.

**Kumpulan yang mengandungi laluan semasa sentiasa dibuka.** Tanpa itu, mendarat pada pautan
dalam meninggalkan setiap kumpulan tertutup dan tiada apa di skrin berkata di mana anda
berada. Ditambah ke set, bukan menggantikannya — kumpulan yang dibuka sengaja tidak ditutup
kerana anda menavigasi ke tempat lain.

**Set yang dibuka disimpan dalam `localStorage`** (`sidebar.expanded`), jadi rel tidak reset
di tengah kerja.

**Lencana amaran digulung ke tajuk kumpulan bila ditutup** — sebagai titik ambar, bukan
nombor. Kumpulan yang tertutup menyembunyikan lencana anaknya, jadi amaran akan hilang
sebaik seseorang mengemaskan rel. Bukan nombor sebab kiraan di dalam adalah benda berbeza —
kiraan pengecualian, nisbah terminal — dan menjumlahkannya menghasilkan angka yang tidak
bermakna.

**Bila dikuncupkan, ikon kumpulan membuka flyout,** bukan mengembang di tempatnya. Tiada
ruang untuk label pada rel 64px. Tanpa flyout, rel yang dikuncupkan hanya hiasan: anda kena
membuka semula rel penuh untuk sampai ke mana-mana, dan itu bukan rel yang diminimumkan, itu
rel yang disembunyikan. Escape dan klik luar menutupnya.

**`isCurrent()` memadan subtree,** bukan laluan tepat. Entri Peranan kekal ditanda semasa
editor peranan terbuka pada `/tetapan/peranan/3`.

**Tajuk kumpulan `text-slate-500`,** bukan `slate-400`. Pada 11px ia masih teks yang
orang baca untuk mencari kumpulan, dan `slate-400` atas putih hanya sekitar 3:1.

**Bila dikuncupkan,** hanya butang toggle di kepala — ada ruang untuk tanda jenama atau
toggle, bukan kedua-duanya, dan membuang toggle akan meninggalkan pengguna tanpa jalan
balik ke rel penuh.

Kepala sidebar guna `py-3` sekeliling anak 32px — sama rentak dengan header kandungan
di sebelahnya, jadi kedua-dua garis bawah bertemu sebagai satu garis merentas tetingkap
tanpa mana-mana tingginya dikodkan tetap untuk memadankan yang lain.

## Modal

Satu shell sahaja: `components/Dialog.tsx`. Jangan tulis `fixed inset-0` sendiri —
`StaffFormDialog` pernah ada shell sendiri, dan pemusatan serta garis di bawah tajuknya
menyimpang daripada setiap dialog lain.

```tsx
<Dialog title="Tambah staf" description="…" width="lg" onClose={onClose}>
  <div className="space-y-4">
    <Feedback error={error} />
    …medan…
    <DialogFooter onClose={onClose} onSubmit={submit} busy={busy} submitLabel="Tambah" />
  </div>
</Dialog>
```

**Dipusatkan menegak,** bukan dilekapkan ke atas. Panel dihadkan pada
`max-h-[calc(100dvh-2rem)]` dan menatal badannya sendiri, jadi pemusatan tidak boleh
memotong borang yang panjang.

**Garis di bawah tajuk wajib.** `border-b` pada `<header>` — itu yang menjadikan tajuk
terbaca sebagai tajuk dan bukan sebagai baris pertama borang.

**`DialogFooter` penuh lebar dan melekat pada bawah.** `sticky bottom-0` dengan margin
negatif membatalkan padding badan, supaya bar tindakan bertemu tepi panel dan kekal
dicapai pada borang yang perlu ditatal. Butang yang berada di bawah lipatan adalah cara
rekod yang separuh diisi ditinggalkan.

`DialogFooter` mesti anak langsung badan dialog (fragmen `<>` atau `space-y-*` tanpa
padding mendatar tidak mengapa). Membungkusnya dalam elemen yang ada `px-*` akan
merosakkan margin negatif itu.

**Kredensial yang baru dijana guna `components/RevealSecret.tsx`,** bukan dialog sendiri.

```tsx
<RevealSecret
  title="Token API baharu"
  label="Token"
  value={issued.token}
  note="Ini satu-satunya kali nilai ini dipaparkan. Tiada endpoint memulangkannya semula."
  hint={<>Hantar sebagai <code>Authorization: Bearer …</code></>}
  onClose={() => setRevealed(null)}
/>
```

Butang tutupnya berkata **"Saya sudah rekod"**, bukan "Tutup" — menutupnya adalah pengakuan
bahawa nilai itu sudah disimpan, dan itu satu-satunya peluang. Jalur ambar `note` menyatakan
apa yang rosak kalau ia hilang. Digunakan oleh token API dan kunci tandatangan webhook;
sebabnya dalam steering `api-security`.

## Jangan hidupkan semula

Ini sudah dibuang kerana `RecordPanel` menggantikannya. Kalau anda dapati diri anda
memerlukannya, anda sedang membina semula shell dengan tangan.

- `components/Tabs.tsx`
- `components/DataTable.tsx`
- fungsi `Card` dalam `components/ui.tsx`
- shell modal sendiri dalam `StaffFormDialog` — sekarang guna `Dialog`
- warna `--color-shell-*` dalam `index.css` — dibuang bersama sidebar gelap

## Kawalan asli penyemak imbas

`:root { color-scheme: light }` dalam `index.css` **wajib kekal.** Panel pemilih di
belakang `<input type="date">` dan `<input type="time">` adalah chrome penyemak imbas,
dan ia mengikut `color-scheme`, bukan CSS pengarang. Tanpa deklarasi itu Chromium jatuh
kembali kepada pilihan sistem pengendalian, jadi pada mesin bertetapan mod gelap kalendar
dan senarai jam terpapar sebagai panel hitam di tengah aplikasi cerah. Tiada apa dalam
stylesheet boleh masuk ke dalam panel itu untuk membetulkannya.

Sebab yang sama, checkbox dan radio digambar sendiri dalam `index.css` dan bukan
dibiarkan asli — Preflight menetapkan `border: 0 solid`, dan Chromium menganggap sempadan
yang ditetapkan pengarang sebagai isyarat untuk meninggalkan rendering asli. Jangan
buang blok itu.

## Tarikh dalam sel jadual

`formatDateOnly()` untuk medan kalendar (`workDate`, `fromDate`, tarikh cuti umum).
`formatDate()` hanya untuk cap masa (`createdAt`, `lastLoginAt`). Sebabnya dalam
steering `time-and-dates`.

## Header

Tajuk di kiri, kluster di kanan: **Muat semula** (ikon sahaja), **loceng amaran**, kemudian
**menu pengguna**.

`components/layout/HeaderMenu.tsx` memiliki dua popover itu. Kedua-duanya guna
`useDismiss()` yang sama — Escape menutup, klik luar menutup. Menu yang hanya boleh
ditutup dengan mengklik pencetusnya semula ialah menu yang tiada siapa tahu cara
menutupnya.

**Log keluar tinggal dalam menu pengguna,** bukan di header.** Dahulunya ia butang
bersempadan penuh di sebelah "Muat semula", yang meletakkan kawalan paling memusnah dalam
header pada berat yang sama dengan yang paling rutin.

**Loceng menunjukkan keadaan, bukan mesej.** Tiada jadual inbox dan tiada tanda
sudah-dibaca. Setiap item ialah kiraan hidup bagi keadaan yang sedang benar; ia hilang bila
keadaan itu tidak lagi benar. Bendera "sudah dibaca" akan membenarkan seseorang menolak
terminal offline dan lencana menjadi sunyi sementara terminal itu kekal offline.

**Lencana mengira keadaan, bukan baris.** Lima terminal offline ialah **satu** perkara untuk
diuruskan. Lencana yang membaca "47" untuk kerosakan yang sama ialah lencana yang orang
berhenti membaca.

**Amaran ditapis ikut kebenaran** dalam `routes/alerts.ts` — `can(user, screen, 'view')`
sebelum setiap kiraan. Lencana yang membawa ke 403 mengajar orang mengabaikan lencana.

**Tajuk luar-nav** ada dalam `OFF_NAV_TITLES` dalam `AppShell.tsx`. Tanpanya header jatuh
kembali ke "Dashboard", jadi orang yang berada di halaman profil sendiri diberitahu mereka
sedang melihat dashboard.

## Borang layan-diri

`pages/ProfilePage.tsx` ialah rujukan: `SettingsStack` + `SettingsGroup` dengan
`SettingRow` (label kiri, kawalan kanan), sama seperti tab Integrasi dan Konfigurasi Umum.

**Dua kad, satu sempadan.** Apa yang orang itu miliki boleh disunting; apa yang organisasi
miliki dipaparkan dalam kad **"Diuruskan oleh HR"** dengan sebabnya dinyatakan. Tanpa sebab
itu, kad tersebut terbaca sebagai medan yang seseorang terlupa jadikan boleh disunting.

**Muat naik disimpan sebaik dipilih,** bukan menunggu butang simpan. Input fail memegang
pemegang kepada sesuatu pada cakera pengguna, bukan nilai dalam borang, dan membawanya
melalui simpanan yang mungkin gagal atas medan lain ialah cara muat naik senyap tidak
berlaku. Dinyatakan di bawah kawalan itu.
