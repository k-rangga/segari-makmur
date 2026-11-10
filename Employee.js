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
    sheet.clear(); // Optional: clears existing sheet data before import

    // 6. Parse and write metadata (Headers)
    const rsmd = rs.getMetaData();
    const numColumns = rsmd.getColumnCount();
    const headers = [];
    for (let i = 1; i <= numColumns; i++) {
      headers.push(rsmd.getColumnName(i));
    }
    sheet.appendRow(headers);

    // 7. Parse and write rows
    const rows = [];
    while (rs.next()) {
      const row = [];
      for (let i = 1; i <= numColumns; i++) {
        row.push(rs.getString(i));
      }
      rows.push(row);

      // Batch rows periodically to avoid memory issues on huge sets
      if (rows.length === 500) {
        const lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, rows.length, numColumns).setValues(rows);
        rows.length = 0; // Clear the batch array
      }
    }

    // Write any remaining rows
    if (rows.length > 0) {
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rows.length, numColumns).setValues(rows);
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
