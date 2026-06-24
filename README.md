# WA Broadcast Bot Dashboard - Dakauri 2026 🚀

Aplikasi **WhatsApp Broadcast Bot Dashboard** adalah sistem pengiriman pesan siaran (broadcast) WhatsApp massal yang dikendalikan melalui antarmuka web modern berbasis **Tailwind CSS v4** dan **Socket.io**. Sistem ini menggunakan library **whatsapp-web.js** (Puppeteer) yang berjalan di latar belakang untuk melakukan otomatisasi pengiriman pesan secara aman dan terjadwal.

---

## 🌟 Fitur Utama

- 🎨 **Antarmuka Premium (Dark Mode)**: Layout dashboard modern, responsif 3-kolom, menggunakan font tunggal *Outfit* yang seimbang dan animasi micro-interactions.
- 🔒 **Kunci Nomor Bot Khusus**: Bot dikunci secara otomatis hanya untuk nomor **6288293680886**. Upaya masuk dari nomor lain akan ditolak dan memicu logout otomatis.
- 🛡️ **Keamanan Akses QR & Admin**:
  - Pengguna umum hanya dapat melihat halaman status offline bersih jika bot terputus.
  - QR Code scanner dan tombol *Log Out* hanya dapat diakses oleh administrator melalui parameter khusus pada URL: `/?admin=true` atau `/?owner=true`.
- 📁 **Manajemen Kontak & Grup Manual**:
  - Tidak memuat seluruh buku alamat telepon secara otomatis guna mempercepat loading dan menjaga kebersihan data.
  - Penambahan kontak dan grup dilakukan secara manual langsung melalui dashboard.
  - Dilengkapi tombol hapus permanen untuk membersihkan data target.
- ⏱️ **Mitigasi Spam Ban**: Rekomendasi interval jeda pengiriman aman (min. 10 detik) untuk meminimalisir risiko pemblokiran nomor oleh WhatsApp.
- 💾 **Penyimpanan Permanen (Persistent Volume Ready)**: Folder `persist/` yang mengonsolidasikan semua sesi login (`.wwebjs_auth`) dan database target sehingga aman saat dilakukan restart server di cloud.
- 🐳 **Docker & Railway Ready**: Dockerfile terkonfigurasi untuk otomatis menginstal Google Chrome stable pada OS Linux Debian/Ubuntu di Railway.

---

## 🛠️ Cara Menjalankan Secara Lokal

1. **Instal Dependensi**:
   ```bash
   npm install
   ```

2. **Kompilasi Tailwind CSS**:
   ```bash
   npm run tailwind:build
   ```

3. **Jalankan Aplikasi**:
   ```bash
   npm start
   ```
   Aplikasi akan berjalan di `http://localhost:3000`.

---

## 🚂 Cara Hosting ke Railway

Aplikasi ini sudah dilengkapi dengan konfigurasi **Dockerfile** yang siap dideploy di Railway.

1. **Hubungkan Repositori GitHub Anda** ke Railway.
2. **Tambahkan Persistent Volume** pada servis Anda di Railway:
   - Klik **New Volume** di tab **Volumes** servis.
   - Atur **Mount Path** ke: `/app/persist` (Sangat krusial untuk menjaga sesi WhatsApp tetap login).
3. **Dapatkan URL Publik**:
   - Di tab **Settings** servis, klik **Generate Domain** di bagian *Networking*.
4. **Pindai QR Code**:
   - Buka URL domain Railway Anda di browser dengan menambahkan parameter admin: `https://domain-anda.up.railway.app/?admin=true`.
   - Pindai QR Code menggunakan WhatsApp nomor **6288293680886** Anda.
