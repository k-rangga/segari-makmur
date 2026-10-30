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
| `employee` | NIK, Nama, Departemen, Store, Kategori, Role, Aktif, Tim | **Fill this in.** Kategori `White collar`/`Blue collar` (blank → Gudang/Operasional count as blue). Role `admin` unlocks Rekap porsi + Tutup kantin. Aktif `Tidak` blocks login. Tim is written by the app (the employee's team in their own Store); a value that isn't a team of that store counts as no team. |
| `pendaftaran` | Tanggal, NIK, Siang, Malam, Diperbarui, Store | Portions per meal, **append-only**: every save adds rows and the newest row for a Tanggal + NIK wins (older rows are history). To change a registration by hand, add a new row rather than editing an old one. Run `compactRegistrations` from the editor (or on a weekly time-driven trigger) to drop superseded rows. Store = the location the employee picked in the submit bar (dropdown of every store in `employee`); the recap counts each portion at that store. Every "Kirim pendaftaran" that adds portions opens a pop-up asking which store (searchable list, required, always starts empty: nothing is remembered or pre-filled); saves that only remove portions send without it. The server also rejects adds without a valid store. Blank (rows from before the column existed) falls back to the employee's own store. |
| `tutup` | Grup, Tanggal, Waktu, Alasan, Dibuat oleh, Dibuat pada | Canteen closures. Registrations on closed meals are ignored (kept, so reopening restores them). |
| `masukan` | Tanggal, Waktu, NIK, Nilai, Tag, Catatan, Diperbarui | Feedback. Kitchen CSV export is anonymous; admins see names. |
| `menu` | Tanggal, Siang, Malam | Optional menu names shown in feedback prompts. |
| `tim` | Store, Tim, Dibuat oleh, Dibuat pada | Teams per store (free text, unique per store ignoring case). Admins add them in bulk on the **Tim** page (one per line or comma-separated) and can assign or change anyone's team there; removing a team clears it from its members. Employees pick their own team (optional) under the greeting on Daftar makan, from their own store's teams. |
| `voucher` | Kode, Nilai, Berlaku sampai, Dipakai oleh, Dipakai pada, Potongan, Rincian, Diunggah pada, Diunggah oleh | Single-use discount codes (fixed Rupiah). Admins bulk-upload them on the **Voucher** page (CSV `kode,nilai,berlaku_sampai`). An employee enters a code when submitting; it takes that submission's new portions off the deduction, capped at their cost, and records the split per month in Rincian. |
| `pengaturan` | Kunci, Nilai, Keterangan | `batas_hari` / `batas_jam` (white collar: 3 = Friday before the week, 23:59), `batas_hari_blue` / `batas_jam_blue` (blue collar; fall back to the white-collar values), `maks_porsi` (3). Days count back from the meal week's Monday: 5 (Wednesday before) … 1 (Sunday), 0 (Monday) … -2 (Wednesday of the meal week). Today and past days are always locked. |

Rekap porsi (admin): Harian, **Mingguan** (Senin–Minggu, with prev/next and a date picker that snaps to Monday; same stats, store split, day table and CSV exports as Bulanan), Bulanan, Masukan. Mingguan and Bulanan also have a store filter (applies to stats, tables, the PDF and the detail CSV; the CSV untuk dapur always covers every store, Tanpa store included), a comparison with the previous week / month (single month only), a per-day pill showing whether portions are Final / Sudah pasti / Sebagian pasti (one collar past its cutoff) / Bisa berubah, and a "Dari store lain" column: portions eaten at a store by employees whose own store is another one. Detail CSVs gain a "Store asal" column. Mingguan uses a single week picker (‹ week ›, with a list of weeks and their status) and an **Unduh** menu (PDF untuk dapur, CSV untuk dapur, CSV detail karyawan); Mingguan and Bulanan show the per-day table first. **PDF untuk dapur** (Harian, Mingguan, Bulanan) is built in the browser with jsPDF + autoTable from cdnjs and carries the Segari logo; the weekly PDF adds a store × day matrix. Employees see each registered day's store location in the week cards, the calendar and the portion popover. Harian has a ‹ day › picker (Hari ini / Besok), a menu-and-rating card from the `menu` and `masukan` tabs, and the employee detail with a Tim column, grouped per store or per team, with extra portions (more than 1 per meal) highlighted. Mingguan and Bulanan add a **Per tim** table (portions by the employee's own store and team; shown once anyone with portions has a team), and the detail CSVs end with a Tim column. Mingguan puts the stat cards on top and adds a store × day table, an 8-week trend and the list of active employees with no portions that week (CSV export).

Caching: employees, teams, settings, closures, menus, vouchers and per-month registrations and feedback are cached server-side for 5 minutes. Changes made through the app update the cache immediately; manual edits in the sheet appear within 5 minutes.

Login: employees type their NIK and full name exactly as in `employee` (case and extra spaces ignored). Sessions last 30 days. 8 wrong attempts lock that NIK for 15 minutes.

## Deploy

```bash
clasp login          # once, if not already authenticated
clasp push           # push local files to the Apps Script project
clasp deploy         # create/update a web app deployment
```

The first run needs the owner to authorize spreadsheet access: open the script in the editor and run `setupSheets` once.

Prod script: `1vf3DA43UPmEKgGk5-9tuBt0pZGyMlhIY4HhZLlXaoEuwlvpdCoKixz7M` (`.clasp-prod.json`).
