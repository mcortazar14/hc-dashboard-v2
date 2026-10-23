const { google } = require('googleapis');

const RCRM_SHEET_ID      = '1tezh5OM7fg2khAAMg128Jf0F51f0oGISa3yv3hbXaFE';
const UPSELL_SHEET_ID    = '13GmU4WLqNJjCGPvjqrxuZg7utELMJQWbqNxjjiM7ojg';
const CHECKINS_SHEET_ID  = '1OeFPo2mUQ15oPEPgAHI6C3wgi39j_UUiTmOB5qx8Jlo';

function getAuth() {
  const saJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials: saJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
}

async function readRange(sheetId, range) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return res.data.values || [];
}

// Returns array of RCRM client objects
async function readRCRM() {
  const rows = await readRange(RCRM_SHEET_ID, "'RCRM Data Pull'!A:AH");
  const headers = rows[0] || [];
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h.trim()] = i; });

  const clients = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const jobName = row[idx['Job Name']] || '';
    if (!jobName.match(/ ?- /)) continue;
    clients.push({
      jobName,
      jobStatus:   row[idx['Job Status']]   || '',
      jobTeam:     row[idx['Job Team']]     || '',
      activeDays:  row[idx['Active Days']]  || '',
      typeOfClient: row[idx['Type of Client']] || '',
      createdOn:   row[idx['Created on']]   || '',
      closedJobAt: row[idx['Closed Job At']] || '',
      emailClient: (row[idx['Email Client']] || '').toLowerCase().trim(),
    });
  }
  return clients;
}

// Returns array of upsell tracker rows
async function readUpsellTracker() {
  const rows = await readRange(UPSELL_SHEET_ID, "'Upsell Tracker'!A:O");
  const headers = rows[0] || [];
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h.trim()] = i; });

  const entries = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = row[idx['Cliente']] || '';
    if (!name) continue;
    entries.push({
      trackerId:           row[idx['ID']]                  || '',
      clientName:          name,
      hcName:              row[idx['HC']]                  || '',
      status:              row[idx['Status']]              || '',
      upsellStage:         row[idx['Upsell Stage']]        || 'N/A',
      stageSince:          row[idx['Stage Since']]         || '',
      lastExternalContact: row[idx['Last External Contact']] || '',
      externalChannel:     row[idx['External Channel']]    || '',
      clientResponded:     (row[idx['Client Responded']]   || '') === 'Yes',
      notes:               row[idx['Notas HC']]            || '',
    });
  }
  return entries;
}

// Returns array of historical check-in rows (for one-time import)
async function readCheckinsHistory() {
  const rows = await readRange(CHECKINS_SHEET_ID, "'Form Responses 1'!A:Z");
  const headers = rows[0] || [];
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h.trim()] = i; });

  const entries = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const clientName = row[idx['Client Name']] || '';
    if (!clientName) continue;
    entries.push({
      clientName,
      timestamp:    row[idx['Timestamp']]              || '',
      showedUp:     row[idx['Did the Client Show Up?']] || '',
      checkinType:  row[idx['Type of Check-in']]        || '',
      meetingDate:  row[idx['Date Of Meeting']]         || '',
      hcName:       row[idx['HC Name']]                || '',
    });
  }
  return entries;
}

module.exports = { readRCRM, readUpsellTracker, readCheckinsHistory, UPSELL_SHEET_ID, CHECKINS_SHEET_ID };
