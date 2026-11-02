// Paste in the sheet: Extensions -> Apps Script (replace everything). Set TOKEN + SHEET_ID, Ctrl+S.
// First time: Deploy -> New deployment -> Web app, Execute as: Me, Access: Anyone. Send Claude the /exec URL + token.
// Updating: Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy (URL stays the same).
const TOKEN = 'CHANGE-ME-long-random-string';
const SHEET_ID = 'PASTE-SHEET-ID';

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  if (req.token !== TOKEN) return out({error: 'bad token'});
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const res = [];
  for (const op of req.ops) {
    if (op.type === 'style') { styleAll(ss); res.push({ok: 'styled'}); continue; }
    const sh = ss.getSheetByName(op.sheet) || ss.insertSheet(op.sheet);  // auto-creates new tabs
    if (op.type === 'set') { sh.getRange(op.range).setValues(op.values); res.push({ok: op.range}); }
    else if (op.type === 'append') { op.rows.forEach(r => sh.appendRow(r)); res.push({ok: op.rows.length + ' rows'}); }
    else if (op.type === 'read') { res.push({values: sh.getRange(op.range).getValues()}); }
  }
  return out(res);
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- design: one call styles every tab ----
const NAVY = '#1F3A5F';
const WIDTHS = {  // per tab, column widths in px (A, B, C, ...)
  'plan':          [60, 100, 620, 110, 110, 80],
  'forum-threads': [170, 380, 260, 330, 170, 80, 420, 110, 190],
  'forum-limits':  [200, 110, 120, 160, 120, 230],
  'forum-queries': [230, 120, 60, 520, 230, 330, 330, 80],
  'profiles':      [40, 190, 230, 150, 90, 420, 330, 80],
  'competitor-analysis': [150, 170, 380, 200, 260, 220, 330, 300, 80],
  'gp-niche-edits': [150, 170, 380, 170, 50, 110, 200, 260, 120, 220, 330, 260, 80],
};
function styleAll(ss) {
  ss.getSheets().forEach(sh => {
    const lastCol = Math.max(sh.getLastColumn(), 1), lastRow = Math.max(sh.getLastRow(), 2);
    sh.getRange(1, 1, lastRow, lastCol).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setHorizontalAlignment('left')
      .setBackground(null).setFontColor('#000000').setFontWeight('normal');
    sh.getRange(1, 1, 1, lastCol).setBackground(NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1); sh.setRowHeights(1, lastRow, 24);
    (WIDTHS[sh.getName()] || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
    const hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    const st = hdr.indexOf('Status');
    if (st >= 0) sh.getRange(2, st + 1, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['todo', 'doing', 'done', 'skip'], true).build())
      .setHorizontalAlignment('center');
    if (sh.getName() === 'forum-threads') threadRules(sh);
    else if (sh.getName() === 'forum-limits') limitRules(sh);
    else if (sh.getName() === 'gp-niche-edits') gpRules(sh);
    else sh.setConditionalFormatRules([zebra(sh.getRange(2, 1, 999, lastCol))]);
  });
}
const rule = () => SpreadsheetApp.newConditionalFormatRule();
const zebra = R => rule().whenFormulaSatisfied('=ISEVEN(ROW())').setBackground('#F5F8FC').setRanges([R]).build();
function threadRules(sh) {
  const R = sh.getRange('A2:I1000'), E = sh.getRange('E2:E1000'), I = sh.getRange('I2:I1000');
  sh.getRange('H2:H1000').setNumberFormat('yyyy-mm-dd');
  sh.setConditionalFormatRules([   // first match wins
    rule().whenFormulaSatisfied('=$F2="done"').setBackground('#D9EAD3').setRanges([R]).build(),
    // forum used in the last 15 days -> its other thread is yellow
    rule().whenFormulaSatisfied('=AND($A2<>"",$H2="",COUNTIFS($A$2:$A,$A2,$H$2:$H,">"&TODAY()-15)>0)')
      .setBackground('#FFE599').setRanges([R]).build(),
    rule().whenFormulaSatisfied('=LEFT($E2,1)="1"').setFontColor('#1E7B34').setBold(true).setRanges([E]).build(),
    rule().whenFormulaSatisfied('=LEFT($E2,1)="3"').setFontColor('#999999').setRanges([E]).build(),
    rule().whenTextEqualTo('YES').setFontColor('#1E7B34').setBold(true).setRanges([I]).build(),
    rule().whenTextStartsWith('WAIT').setFontColor('#B45F06').setBold(true).setRanges([I]).build(),
    rule().whenTextStartsWith('MAXED').setFontColor('#CC0000').setBold(true).setRanges([I]).build(),
    zebra(R),
  ]);
}
function limitRules(sh) {
  const F = sh.getRange('F2:F1000');
  sh.setConditionalFormatRules([
    rule().whenTextEqualTo('YES').setBackground('#D9EAD3').setFontColor('#1E7B34').setBold(true).setRanges([F]).build(),
    rule().whenTextStartsWith('WAIT').setBackground('#FFE599').setFontColor('#B45F06').setRanges([F]).build(),
    rule().whenTextStartsWith('MAXED').setBackground('#F4CCCC').setFontColor('#CC0000').setRanges([F]).build(),
    zebra(sh.getRange('A2:F1000')),
  ]);
}
function gpRules(sh) {
  const R = sh.getRange('A2:M1000');
  sh.setConditionalFormatRules([
    rule().whenFormulaSatisfied('=$M2="done"').setBackground('#D9EAD3').setRanges([R]).build(),
    rule().whenFormulaSatisfied('=LEFT($D2,3)="PBN"').setFontColor('#999999').setRanges([R]).build(),
    rule().whenTextEqualTo('NO').setFontColor('#1E7B34').setBold(true).setRanges([sh.getRange('I2:I1000')]).build(),
    rule().whenTextEqualTo('DISAVOWED').setFontColor('#CC0000').setRanges([sh.getRange('I2:I1000')]).build(),
    zebra(R),
  ]);
}
