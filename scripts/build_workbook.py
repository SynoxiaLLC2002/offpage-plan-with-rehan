"""Build <site>-offpage.xlsx from every *.csv in a site folder (one tab per CSV, file order = tab order).
Usage: python build_workbook.py "<your Desktop>/offpage plans/<domain>"
"""
import csv, sys, pathlib
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation

folder = pathlib.Path(sys.argv[1])
csvs = sorted(folder.glob("*.csv"))
assert csvs, f"no CSVs in {folder}"
wb = Workbook(); wb.remove(wb.active)
head = PatternFill("solid", fgColor="1F3A5F")
for path in csvs:
    rows = list(csv.reader(open(path, encoding="utf-8-sig")))
    ws = wb.create_sheet(path.stem.split("-", 1)[-1][:31])  # "01-forum-threads" -> "forum-threads"
    for r in rows: ws.append(r)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF"); c.fill = head
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for col in ws.columns:
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max(width + 2, 10), 70)
        for c in col[1:]:
            v = str(c.value or "")
            if v.startswith("http"):
                c.hyperlink = v; c.font = Font(color="0563C1", underline="single")
            c.alignment = Alignment(vertical="top", wrap_text=width > 70)
    hdr = [str(c.value) for c in ws[1]]
    if "Status" in hdr:
        dv = DataValidation(type="list", formula1='"todo,doing,done,skip"', allow_blank=True)
        ws.add_data_validation(dv)
        L = ws.cell(1, hdr.index("Status") + 1).column_letter
        dv.add(f"{L}2:{L}{max(ws.max_row, 2)}")
out = folder / f"{folder.name}-offpage.xlsx"
wb.save(out)
print(out, [ws.title for ws in wb])
