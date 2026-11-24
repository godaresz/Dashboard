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


def to_date(v, year, month):
    """แปลงหัวคอลัมน์วันที่เป็น date — รองรับ
    - เลขวัน (2, 3, ...) ใช้เดือน/ปีจากหัว "วันที่ 1-30 /11/26"
    - วันที่จริงของ Excel (datetime/date)
    - ข้อความ "2/11/2026", "2/11/26", "2/11/2569" (วัน/เดือน/ปี, ปี พ.ศ. แปลงให้)
    """
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        v = v.date()
    if isinstance(v, date):
        return date(v.year - 543, v.month, v.day) if v.year > 2400 else v
    if isinstance(v, (int, float)):
        d = int(v)
        if 1 <= d <= 31:
            try:
                return date(year, month, d)
            except ValueError:
                return None
        return None
    m = re.fullmatch(r"\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})\s*", str(v))
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        if y > 2400:
            y -= 543
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    n = to_num(v)
    return to_date(n, year, month) if n is not None else None


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


PERIOD_ORDER = {"เช้า": 0, "บ่าย": 1, "เย็น": 2, "ดึก": 3}


def sheet_group(title):
    """ประเภทพนักงานจากชื่อชีต: "TPT A,B" -> TPT, "Forklift A,B" / "Forklift JP" -> Forklift
    ชีตรุ่นเก่า ("กะ A", "กะ B", "กะ A (2)") = TPT"""
    t = re.sub(r"\s*\(\d+\)\s*$", "", clean(title))
    # ตัดรหัสกะท้ายชื่อ (A, B, A,B, A-B, JP, กะ A ...) — รหัสกะเป็นตัวอักษร 1–2 ตัว
    t = re.sub(r"(\s+(กะ\s*)?[A-Za-z]{1,2}([\s,/&\-]+[A-Za-z]{1,2})*|\s*กะ\s*[A-Za-z]{1,2})\s*$", "", t).strip()
    return t or "TPT"


def parse_sheet(ws, fallback_ym):
    rows = list(ws.iter_rows(values_only=True))
    hdr_idx = next((i for i, r in enumerate(rows) if r and clean(r[0]) == NAME_HEADER), None)
    if hdr_idx is None:
        return []
    # หาแถว บน/ล่าง/ชีพจร ภายใน 4 แถวถัดจากหัวตาราง (บางชีตมีแถว เช้า/บ่าย คั่นอยู่)
    sub_idx = next((i for i in range(hdr_idx + 1, min(hdr_idx + 5, len(rows)))
                    if rows[i] and any(clean(v) in SUB_LABELS for v in rows[i])), None)
    if sub_idx is None:
        return []
    hdr, sub_row = rows[hdr_idx], rows[sub_idx]
    day_row = rows[hdr_idx + 1] if hdr_idx + 1 < sub_idx else ()
    period_row = rows[sub_idx - 1] if sub_idx - 1 > hdr_idx + 1 else ()

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

    # map column -> (date iso, ช่วงเวลา, metric)
    colmap = {}
    current_day, current_period = None, ""
    for c in range(len(sub_row)):
        if c < len(day_row) and day_row[c] is not None:
            current_day = to_date(day_row[c], year, month)
            current_period = ""
        if c < len(period_row) and clean(period_row[c]):
            current_period = clean(period_row[c])
        key = SUB_LABELS.get(clean(sub_row[c]))
        if key and current_day:
            colmap[c] = (current_day.isoformat(), current_period, key)

    group = sheet_group(ws.title)
    people = []
    for r in rows[sub_idx + 1:]:
        if not r:
            continue
        name = clean(r[0])
        if not name or name == NAME_HEADER:
            continue
        get = lambda c: clean(r[c]) if c is not None and c < len(r) else ""
        readings = {}
        for c, (iso, period, key) in colmap.items():
            v = to_num(r[c]) if c < len(r) else None
            if v is not None:
                readings.setdefault((iso, period), {})[key] = v
        people.append({
            "name": name,
            "group": group,
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
    group_names = {}
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
                # "forklift A,B" กับ "Forklift A,B" = ประเภทเดียวกัน (ใช้ตัวสะกดที่เจอครั้งแรก)
                p["group"] = group_names.setdefault(p["group"].casefold(), p["group"])
                key = (p["group"], p["name"], p["shift"])
                cur = merged.setdefault(key, {**p, "readings": {}})
                for k in ("plate", "dept", "note"):
                    if p[k]:
                        cur[k] = p[k]
                for slot, vals in p["readings"].items():
                    cur["readings"].setdefault(slot, {}).update(vals)
        print(f"อ่านไฟล์: {os.path.basename(f)}")

    if not used:
        sys.exit("อ่านไฟล์ Excel ไม่ได้เลยสักไฟล์")

    drivers = []
    for i, p in enumerate(sorted(merged.values(), key=lambda x: (x["group"] != "TPT", x["group"], x["shift"], x["plate"], x["name"]))):
        readings = [
            {"date": iso, **({"period": period} if period else {}), **v}
            for (iso, period), v in sorted(p["readings"].items(), key=lambda kv: (kv[0][0], PERIOD_ORDER.get(kv[0][1], 9), kv[0][1]))
            if v.get("sys") or v.get("dia")
        ]
        drivers.append({
            "id": i + 1,
            "name": p["name"],
            "group": p["group"],
            "plate": p["plate"],
            "shift": p["shift"],
            "dept": p["dept"],
            "note": p["note"],
            "readings": readings,
        })

    total = sum(len(d["readings"]) for d in drivers)
    if total == 0:
        # อ่านไม่ได้สักรายการ (เช่น รูปแบบไฟล์เปลี่ยน) -> ให้ build ล้ม เว็บจะคงข้อมูลชุดเดิมไว้แทนการขึ้นหน้าว่าง
        sys.exit("ไม่พบข้อมูลการวัดเลย — ตรวจรูปแบบหัวตาราง (ชื่อพนักงานขับรถ / วันที่ / บน-ล่าง-ชีพจร)")

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "build": os.environ.get("BUILD_ID", ""),   # เวอร์ชันโค้ดหน้าเว็บ (ตั้งโดย GitHub Actions)
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
