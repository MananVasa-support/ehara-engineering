// api.js — reads Google Sheets via JSONP (works from file:// with no server)
//
// Sheet column layout (Website Report, gid=998291451):
//   A=Timestamp(TaskID)  B=Subject of Work  C=Client Name
//   D=Task Initiator     E=Task Doer        F=Task
//   G=Priority           H=Due Date         I=Initiator Notes
//   J=Attachment 1       K=Attachment 2     L=Status

var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpd8hHGwe9gSQk1CtoWgIEKEgZsakrUS85TVORaVbtFYCYxqf8m0joltZrasn5hxA1RA/exec';
var SHEET_ID        = '1l2qHDPIzYQ0YPPaH1wBdefZNjHNdLSKv5rq7480MQuY';
var SHEET_GID       = '998291451';
var SHEET_URL       = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
                      '/edit?gid=' + SHEET_GID + '#gid=' + SHEET_GID;

// ─── PUBLIC ENTRY POINT ───────────────────────────────────────────────────────
function callApi(action, payload) {
  if (action === 'getSheetData' || action === 'getDashboardData') {
    return readWebsiteReport();
  }
  if (action === 'getFormData' || action === 'getDropdownData') {
    return readNamesSheet();
  }
  if (action === 'getNavButtons') {
    return Promise.resolve([]);
  }

  // WRITE — fire-and-forget through AppScript
  return fetch(APPS_SCRIPT_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: action, payload: payload || {} })
  }).then(function () { return { ok: true }; });
}

// ─── READ "Website Report" ────────────────────────────────────────────────────
function readWebsiteReport() {
  return fetchGvizJsonp(SHEET_ID, null, SHEET_GID)
    .then(parseWebsiteReport);
}

function parseWebsiteReport(table) {
  var idx    = buildHeaderIndex(table.cols);
  var rows   = table.rows || [];
  var data   = [];
  var empSet = {};
  var rowNum = 0;

  rows.forEach(function (row) {
    rowNum++;
    if (!row || !row.c) return;

    var rawId     = gcell(row, idx, 'timestamp',        0);
    var subject   = gcell(row, idx, 'subject of work',  1);
    var client    = gcell(row, idx, 'client name',      2);
    var initiator = gcell(row, idx, 'task initiator',   3);
    var doer      = gcell(row, idx, 'task doer',        4);
    var taskName  = gcell(row, idx, 'task',             5);
    var priority  = gcell(row, idx, 'priority',         6);
    var dueCell   = gcellRaw(row, idx, 'due date',      7);
    var notes     = gcell(row, idx, 'initiator notes',  8);
    var status    = gcell(row, idx, 'status',          11);

    status    = (status    || '').trim();
    subject   = (subject   || '').trim();
    initiator = (initiator || '').trim();
    doer      = (doer      || '').trim();
    taskName  = (taskName  || '').trim();

    // Skip completely blank rows or rows with no status
    if (!status && !subject && !doer && !initiator) return;
    if (!status) return;

    // Sanitise task ID
    var taskId = (rawId || '').trim();
    if (!taskId || taskId === '#REF!' || taskId === '#ERROR!') {
      taskId = 'R' + rowNum;
    }

    data.push({
      id:        taskId,
      subject:   subject,
      client:    (client   || '').trim(),
      taskName:  taskName,
      doer:      doer || initiator,
      initiator: initiator || doer,
      priority:  (priority || '').trim(),
      status:    status,
      notes:     (notes    || '').trim(),
      dueDate:   parseGvizDate(dueCell),
      createdAt: ''
    });

    if (doer)      empSet[doer]      = true;
    if (initiator) empSet[initiator] = true;
  });

  return {
    result:      'success',
    data:        data,
    employees:   Object.keys(empSet).sort(function (a, b) { return a.localeCompare(b); }),
    generatedAt: new Date().toISOString()
  };
}

// ─── READ "Names" SHEET ───────────────────────────────────────────────────────
function readNamesSheet() {
  return fetchGvizJsonp(SHEET_ID, 'Names', null)
    .then(function (table) {
      var names = [], subjects = [];
      (table.rows || []).forEach(function (row) {
        if (!row || !row.c) return;
        var n = row.c[0] && row.c[0].v != null ? String(row.c[0].v).trim() : '';
        var s = row.c[1] && row.c[1].v != null ? String(row.c[1].v).trim() : '';
        if (n) names.push(n);
        if (s) subjects.push(s);
      });
      return { employees: names, pinned: names[0] || '', subjects: subjects, navButtons: [] };
    })
    .catch(function () {
      // Fallback to AppScript if Names sheet isn't readable
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        var cb = '__gs_names_' + Date.now();
        window[cb] = function (d) {
          delete window[cb];
          if (s.parentNode) s.parentNode.removeChild(s);
          resolve(d && d.employees ? d : { employees: [], pinned: '', subjects: [], navButtons: [] });
        };
        s.onerror = function () { resolve({ employees: [], pinned: '', subjects: [], navButtons: [] }); };
        s.src = APPS_SCRIPT_URL + '?api=getFormData&callback=' + cb;
        document.head.appendChild(s);
      });
    });
}

// ─── JSONP FETCHER ────────────────────────────────────────────────────────────
// Uses <script> injection — works from file:// URLs (no CORS restriction)

function fetchGvizJsonp(sheetId, sheetName, gid) {
  return new Promise(function (resolve, reject) {
    var cbName = '__gviz_' + Math.random().toString(36).slice(2) + '_' + Date.now();

    // Build URL — either by sheet name or gid
    var base = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?headers=1';
    if (gid)       base += '&gid='   + encodeURIComponent(gid);
    if (sheetName) base += '&sheet=' + encodeURIComponent(sheetName);
    var url = base + '&tqx=responseHandler:' + cbName;

    var script = document.createElement('script');
    var timer = setTimeout(function () {
      cleanup();
      reject(new Error(
        'Request timed out.\n' +
        'Make sure the Google Sheet is shared: Share → Anyone with the link → Viewer.'
      ));
    }, 15000);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cbName]; } catch (e) {}
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (response) {
      cleanup();
      if (!response) { reject(new Error('Empty response from sheet.')); return; }
      if (response.status === 'error') {
        var detail = response.errors && response.errors[0];
        reject(new Error(
          (detail && (detail.detailed_message || detail.message)) ||
          'Sheet access denied. Share the sheet publicly (Anyone with link → Viewer).'
        ));
        return;
      }
      resolve(response.table || { cols: [], rows: [] });
    };

    script.onerror = function () {
      cleanup();
      reject(new Error('Script load failed — check internet connection.'));
    };

    script.src = url;
    document.head.appendChild(script);
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildHeaderIndex(cols) {
  var idx = {};
  (cols || []).forEach(function (col, i) {
    var label = (col.label || col.id || '').toLowerCase().trim();
    if (label) idx[label] = i;
  });
  return idx;
}

function gcell(row, idx, headerName, fixedPos) {
  var i = idx.hasOwnProperty(headerName) ? idx[headerName] : fixedPos;
  if (i == null || !row.c || i >= row.c.length) return '';
  var c = row.c[i];
  if (!c || c.v == null) return '';
  return String(c.f != null ? c.f : c.v);
}

function gcellRaw(row, idx, headerName, fixedPos) {
  var i = idx.hasOwnProperty(headerName) ? idx[headerName] : fixedPos;
  if (i == null || !row.c || i >= row.c.length) return null;
  return row.c[i] || null;
}

// ─── DATE PARSING ─────────────────────────────────────────────────────────────

function parseGvizDate(cell) {
  if (!cell) return '';
  var v = cell.v, f = cell.f;

  // gviz Date string: "Date(2026,3,30)"  — month is 0-based
  if (typeof v === 'string' && v.indexOf('Date(') === 0) {
    var m = v.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (m) return fmtISO(new Date(+m[1], +m[2], +m[3]));
  }
  // Numeric serial (Google Sheets internal)
  if (typeof v === 'number') {
    return fmtISO(new Date(Math.round((v - 25569) * 86400000)));
  }
  // Try formatted string first (e.g. "30-Apr-2026")
  if (f && typeof f === 'string' && f.trim()) return parseDateStr(f.trim());
  // Try raw string
  if (v && typeof v === 'string' && v.trim()) return parseDateStr(v.trim());
  return '';
}

function parseDateStr(s) {
  var m;
  // dd-Mon-yyyy  e.g. "30-Apr-2026"
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    var mons = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    var mi = mons[m[2].toLowerCase()];
    if (mi != null) return fmtISO(new Date(+m[3], mi, +m[1]));
  }
  // dd/MM/yyyy
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return fmtISO(new Date(+m[3], +m[2]-1, +m[1]));
  // yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Generic
  var d = new Date(s);
  return isNaN(d) ? '' : fmtISO(d);
}

function fmtISO(d) {
  if (!d || isNaN(d)) return '';
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}