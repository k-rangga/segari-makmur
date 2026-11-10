function importrawData() {
  // 0. Destination sheet
  const DEST_SHEET_NAME = 'employee';

  // 1. Pull connection details from Script Properties (never hardcode secrets)
  const props = PropertiesService.getScriptProperties();
  const host     = props.getProperty('PG_HOST');
  const port     = props.getProperty('PG_PORT') || '5432';
  const dbName   = props.getProperty('PG_DB');
  const user     = props.getProperty('PG_USER');
  const password = props.getProperty('PG_PASSWORD');

  if (!host || !dbName || !user || !password) {
    throw new Error('Missing DB credentials in Script Properties. Set PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD.');
  }

  // 2. Format the connection string specifically for JDBC
  const url = `jdbc:postgresql://${host}:${port}/${dbName}`;

  try {
    // 3. Connect to the database
    const conn = Jdbc.getConnection(url, user, password);

    // 4. Execute your SQL query (template literal — safe with internal single quotes)
    const stmt = conn.createStatement();
    const rs = stmt.executeQuery(`select employee_id as nik, '-' as name, '-' as departemen,  w.name as store, 
	case when contract_type in ('PKWTT','PKWT') then 'White Collar' else 'Blue Collar' end as kategori,
	MAX(case when wd.type='ROLE' then wd.value end) as role,
	case when itu.deleted_at is null then 'Aktif' else 'Tidak Aktif' end as status
from internal_tools_users itu
left join warehouses w on w.id=itu.home_office_id
left join internal_user_workplace_departments iuwd on iuwd.internal_user_id=itu.id
left join workplace_departments wd on wd.id=iuwd.workplace_department_id
group by 1,2,3,4,5,7
;`);

    // 5. Get the specified worksheet — create it if it doesn't exist yet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(DEST_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(DEST_SHEET_NAME);
    }

    // 6. Remember the hand-filled admin column (T/F) by NIK before the sheet is cleared
    const key = v => String(v == null ? '' : v).replace(/\s/g, '');
    const adminByNik = {};
    let hasAdminCol = false;
    const old = sheet.getDataRange().getValues();
    if (old.length) {
      const oh = old[0].map(h => String(h).trim().toLowerCase());
      const ni = oh.indexOf('nik'), ai = oh.indexOf('admin');
      if (ni >= 0 && ai >= 0) {
        hasAdminCol = true;
        for (let r = 1; r < old.length; r++) {
          const v = old[r][ai];
          if (key(old[r][ni]) && v !== '' && v != null) adminByNik[key(old[r][ni])] = v;
        }
      }
    }

    // 7. Read headers and rows from the query, then add the admin column back
    const rsmd = rs.getMetaData();
    const numColumns = rsmd.getColumnCount();
    const headers = [];
    for (let i = 1; i <= numColumns; i++) {
      headers.push(rsmd.getColumnName(i));
    }
    const nikCol = headers.map(h => String(h).toLowerCase()).indexOf('nik');
    const keepAdmin = hasAdminCol && nikCol >= 0 && headers.every(h => String(h).toLowerCase() !== 'admin');
    if (keepAdmin) headers.push('admin');

    const rows = [];
    while (rs.next()) {
      const row = [];
      for (let i = 1; i <= numColumns; i++) {
        row.push(rs.getString(i));
      }
      if (keepAdmin) {
        const a = adminByNik[key(row[nikCol])];
        row.push(a === undefined ? '' : a);
      }
      rows.push(row);
    }

    // Write everything only after the query has been read in full
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    // 8. Close connections cleanly
    rs.close();
    stmt.close();
    conn.close();

    Logger.log('Data import complete!');

  } catch (e) {
    Logger.log('Error connecting to database: ' + e.toString());
  }
}
