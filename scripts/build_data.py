#!/usr/bin/env python3
"""แปลงไฟล์ Excel ผลวัดความดัน พขร. (data/*.xlsx) เป็น site/data.json สำหรับ Dashboard

รูปแบบชีตที่รองรับ (เหมือนไฟล์ "ลงข้อมูลวัดความดัน TPT A-B"):
  แถวหัวตาราง : ชื่อพนักงานขับรถ | ทะเบียนรถ | กะ | ... | "วันที่ 1-30 /11/26"
  แถวถัดไป    : เลขวันที่ (อยู่บนคอลัมน์แรกของแต่ละกลุ่ม 3 คอลัมน์)
  แถวถัดไป    : บน | ล่าง | ชีพจร
  แถวข้อมูล   : หนึ่งแถวต่อ พขร. หนึ่งคน

อ่านทุกชีตในทุกไฟล์ แล้วรวมข้อมูลตาม (ชื่อ, กะ) — ถ้าวันเดียวกันมีหลายค่า ใช้ค่าจากชีตที่อ่านทีหลัง
"""
import glob
import json
import os
import re
import sys
from datetime import date, datetime, timezone

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "site", "data.json")

NAME_HEADER = "ชื่อพนักงานขับรถ"
SUB_LABELS = {"บน": "sys", "ล่าง": "dia", "ชีพจร": "pulse"}


def clean(s):
    return re.sub(r"\s+", " ", str(s)).strip() if s is not None else ""


def to_num(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return int(round(n)) if n > 0 else None


def parse_month(text, fallback):
    """'วันที่ 1-30 /11/26' -> (2026, 11)"""
    m = re.search(r"/\s*(\d{1,2})\s*/\s*(\d{2,4})", text or "")
    if not m:
        return fallback
    month, year = int(m.group(1)), int(m.group(2))
    if year < 100:
        year += 2000
    if year > 2400:  # พ.ศ.
        year -= 543
    return year, month


def parse_sheet(ws, fallback_ym):
    rows = list(ws.iter_rows(values_only=True))
    hdr_idx = next((i for i, r in enumerate(rows) if r and clean(r[0]) == NAME_HEADER), None)
    if hdr_idx is None or hdr_idx + 2 >= len(rows):
        return []
    hdr, day_row, sub_row = rows[hdr_idx], rows[hdr_idx + 1], rows[hdr_idx + 2]

    col_plate = col_shift = col_dept = col_note = None
    month_text = ""
    for c, v in enumerate(hdr):
        t = clean(v)
        if t.startswith("ทะเบียน"):
            col_plate = c
        elif t == "กะ":
            col_shift = c
        elif t.lower().startswith("department"):
            col_dept = c
        elif t.startswith("หมายเหตุ"):
            col_note = c
        elif t.startswith("วันที่"):
            month_text = t
    year, month = parse_month(month_text, fallback_ym)

    # map column -> (date iso, metric)
    colmap = {}
    current_day = None
    for c in range(len(sub_row)):
        if c < len(day_row) and day_row[c] is not None:
            d = to_num(day_row[c])
            current_day = d if d and 1 <= d <= 31 else None
        key = SUB_LABELS.get(clean(sub_row[c]))
        if key and current_day:
            try:
                iso = date(year, month, current_day).isoformat()
            except ValueError:
                continue
            colmap[c] = (iso, key)

    people = []
    for r in rows[hdr_idx + 3:]:
        if not r:
            continue
        name = clean(r[0])
        if not name or name == NAME_HEADER:
            continue
        get = lambda c: clean(r[c]) if c is not None and c < len(r) else ""
        readings = {}
        for c, (iso, key) in colmap.items():
            v = to_num(r[c]) if c < len(r) else None
            if v is not None:
                readings.setdefault(iso, {})[key] = v
        people.append({
            "name": name,
            "plate": get(col_plate),
            "shift": get(col_shift).upper() or "-",
            "dept": get(col_dept),
            "note": get(col_note),
            "readings": readings,
        })
    return people


def main():
    files = sorted(
        f for f in glob.glob(os.path.join(DATA_DIR, "*"))
        if os.path.splitext(f)[1].lower() in (".xlsx", ".xlsm") and not os.path.basename(f).startswith("~$")
    )
    if not files:
        sys.exit("ไม่พบไฟล์ Excel (.xlsx) ในโฟลเดอร์ data/")

    merged = {}
    today = date.today()
    used = []
    for f in files:
        try:
            wb = openpyxl.load_workbook(f, data_only=True, read_only=True)
        except Exception as e:  # ไฟล์เสีย / กำลังบันทึกอยู่ — ข้ามไป ไม่ให้ทั้งระบบล่ม
            print(f"⚠️ ข้ามไฟล์ {os.path.basename(f)}: {e}")
            continue
        used.append(f)
        for ws in wb.worksheets:
            for p in parse_sheet(ws, (today.year, today.month)):
                key = (p["name"], p["shift"])
                cur = merged.setdefault(key, {**p, "readings": {}})
                for k in ("plate", "dept", "note"):
                    if p[k]:
                        cur[k] = p[k]
                for iso, vals in p["readings"].items():
                    cur["readings"].setdefault(iso, {}).update(vals)
        print(f"อ่านไฟล์: {os.path.basename(f)}")

    if not used:
        sys.exit("อ่านไฟล์ Excel ไม่ได้เลยสักไฟล์")

    drivers = []
    for i, p in enumerate(sorted(merged.values(), key=lambda x: (x["shift"], x["plate"], x["name"]))):
        readings = [
            {"date": iso, **v}
            for iso, v in sorted(p["readings"].items())
            if v.get("sys") or v.get("dia")
        ]
        drivers.append({
            "id": i + 1,
            "name": p["name"],
            "plate": p["plate"],
            "shift": p["shift"],
            "dept": p["dept"],
            "note": p["note"],
            "readings": readings,
        })

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": [os.path.basename(f) for f in used],
        "drivers": drivers,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    n = sum(len(d["readings"]) for d in drivers)
    print(f"บันทึก {OUT}: พขร. {len(drivers)} คน, {n} รายการวัด")


if __name__ == "__main__":
    main()
