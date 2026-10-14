# segari-makmur

Segari Program Makan — a Google Apps Script web app where employees register for lunch (Siang) and dinner (Malam) each month, and admins see kitchen portion totals, close the canteen on dates and review food feedback. Each portion is Rp 5.000, deducted from salary. UI is in Bahasa Indonesia.

## Files

| File | What it is |
|---|---|
| `Code.js` | Server: sheet access, NIK + name login, weekly cutoff, closures, admin reports |
| `Index.html` | Page shell |
| `Styles.html` | All CSS (design tokens from the v7 design prompt) |
| `App.html` | Client app (plain JS, talks to `api()` via `google.script.run`) |
| `appsscript.json` | Manifest — web app runs as the owner, open to anyone (no Google login) |

## Data — "Program Makmur Segari" spreadsheet

Spreadsheet ID is `SPREADSHEET_ID` in `Code.js`. Missing tabs and headers are created on first run (or run `setupSheets` from the editor).

| Tab | Columns | Notes |
|---|---|---|
| `employee` | NIK, Nama, Departemen, Store, Kategori, Role, Aktif | **Fill this in.** Kategori `White collar`/`Blue collar` (blank → Gudang/Operasional count as blue). Role `admin` unlocks Rekap porsi + Tutup kantin. Aktif `Tidak` blocks login. |
| `pendaftaran` | Tanggal, NIK, Siang, Malam, Diperbarui | Portions per meal, **append-only**: every save adds rows and the newest row for a Tanggal + NIK wins (older rows are history). To change a registration by hand, add a new row rather than editing an old one. Run `compactRegistrations` from the editor (or on a weekly time-driven trigger) to drop superseded rows. |
| `tutup` | Grup, Tanggal, Waktu, Alasan, Dibuat oleh, Dibuat pada | Canteen closures. Registrations on closed meals are ignored (kept, so reopening restores them). |
| `masukan` | Tanggal, Waktu, NIK, Nilai, Tag, Catatan, Diperbarui | Feedback. Kitchen CSV export is anonymous; admins see names. |
| `menu` | Tanggal, Siang, Malam | Optional menu names shown in feedback prompts. |
| `voucher` | Kode, Nilai, Berlaku sampai, Dipakai oleh, Dipakai pada, Potongan, Rincian, Diunggah pada, Diunggah oleh | Single-use discount codes (fixed Rupiah). Admins bulk-upload them on the **Voucher** page (CSV `kode,nilai,berlaku_sampai`). An employee enters a code when submitting; it takes that submission's new portions off the deduction, capped at their cost, and records the split per month in Rincian. |
| `pengaturan` | Kunci, Nilai, Keterangan | `batas_hari` (3 = Friday before the week), `batas_jam` (23:59), `maks_porsi` (3). |

Caching: employees, settings, closures, menus, vouchers and per-month registrations and feedback are cached server-side for 5 minutes. Changes made through the app update the cache immediately; manual edits in the sheet appear within 5 minutes.

Login: employees type their NIK and full name exactly as in `employee` (case and extra spaces ignored). Sessions last 30 days. 8 wrong attempts lock that NIK for 15 minutes.

## Deploy

```bash
clasp login          # once, if not already authenticated
clasp push           # push local files to the Apps Script project
clasp deploy         # create/update a web app deployment
```

The first run needs the owner to authorize spreadsheet access: open the script in the editor and run `setupSheets` once.

Prod script: `1vf3DA43UPmEKgGk5-9tuBt0pZGyMlhIY4HhZLlXaoEuwlvpdCoKixz7M` (`.clasp-prod.json`).
