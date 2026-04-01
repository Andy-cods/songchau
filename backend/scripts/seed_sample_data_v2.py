#!/usr/bin/env python3
"""
Seed comprehensive sample data for Song Chau ERP testing/demo.

Populates ALL pages with realistic Vietnamese business data so the CEO
can see how the system looks with real-ish data.

Run: docker exec sc-api python scripts/seed_sample_data_v2.py
"""

import psycopg2
import psycopg2.extras
from datetime import date, datetime, timedelta
import random
import json
import sys

# ---------------------------------------------------------------------------
# Connect
# ---------------------------------------------------------------------------

DSN = "postgresql://scadmin:SC2026_ERP_Pr0d_X9k2mQ7wR4@postgres:5432/songchau_erp"

print("=" * 65)
print("SONG CHAU ERP — SEED DU LIEU MAU v2 (psycopg2 sync)")
print("=" * 65)

try:
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    print("[OK] Ket noi database thanh cong.")
except Exception as e:
    print(f"[ERROR] Khong the ket noi: {e}")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def execute(sql, params=None):
    try:
        cur.execute(sql, params)
        return cur.rowcount
    except Exception as e:
        conn.rollback()
        print(f"  [WARN] SQL error: {e}")
        return 0

def fetchone(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchone()

def fetchall(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchall()

today = date(2026, 3, 30)

def days_ago(n):
    return today - timedelta(days=n)

def days_from_now(n):
    return today + timedelta(days=n)

# ---------------------------------------------------------------------------
# 0. Get user IDs
# ---------------------------------------------------------------------------
print("\n[0] Doc user IDs tu database...")

admin = fetchone("SELECT id FROM users WHERE role::text = 'admin' LIMIT 1")
if not admin:
    admin = fetchone("SELECT id FROM users LIMIT 1")
admin_id = str(admin["id"])

manager = fetchone("SELECT id FROM users WHERE role::text = 'manager' LIMIT 1")
manager_id = str(manager["id"]) if manager else admin_id

procurement = fetchone("SELECT id FROM users WHERE role::text = 'procurement' LIMIT 1")
procurement_id = str(procurement["id"]) if procurement else admin_id

warehouse = fetchone("SELECT id FROM users WHERE role::text = 'warehouse' LIMIT 1")
warehouse_id = str(warehouse["id"]) if warehouse else admin_id

accountant = fetchone("SELECT id FROM users WHERE role::text = 'accountant' LIMIT 1")
accountant_id = str(accountant["id"]) if accountant else admin_id

staff_rows = fetchall("SELECT id FROM users WHERE role::text = 'staff' LIMIT 5")
staff_ids = [str(r["id"]) for r in staff_rows] if staff_rows else [admin_id]

all_user_rows = fetchall("SELECT id FROM users WHERE deleted_at IS NULL LIMIT 18")
all_user_ids = [str(r["id"]) for r in all_user_rows]

print(f"  admin={admin_id[:8]}..., manager={manager_id[:8]}..., {len(all_user_ids)} users total")

# ---------------------------------------------------------------------------
# 1. Companies
# ---------------------------------------------------------------------------
print("\n[1] Companies...")

companies_data = [
    ("SC", "Cong ty TNHH Song Chau", "0123456789", "123 Duong Nguyen Trai, Q.1, TP.HCM", "Nguyen Van Thang", "028-3838-1234", "info@songchau.vn", "Vietcombank", "0071001234567"),
    ("AMA", "Cong ty TNHH AMA Bac Ninh", "0987654321", "KCN Que Vo, Bac Ninh", "Tran Thi Lan", "0222-3939-5678", "info@ama-bn.vn", "BIDV", "0032009876543"),
]

for code, name, tax, addr, rep, phone, email, bank, acct in companies_data:
    execute("""
        INSERT INTO companies (company_code, company_name, tax_code, address, representative, phone, email, bank_name, bank_account)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (company_code) DO NOTHING
    """, (code, name, tax, addr, rep, phone, email, bank, acct))

conn.commit()
companies = fetchall("SELECT id, company_code FROM companies ORDER BY id")
sc_company_id = next((c["id"] for c in companies if c["company_code"] == "SC"), None)
print(f"  {len(companies)} companies, SC id={sc_company_id}")

# ---------------------------------------------------------------------------
# 2. Suppliers (10 Chinese)
# ---------------------------------------------------------------------------
print("\n[2] Suppliers (10)...")

suppliers_data = [
    ("Shenzhen Huawei Parts Co., Ltd",      "Zhang Wei",     "zhang@huawei-parts.cn",   "+86-755-8888-0101", "huawei_zhang",  "CN", "Quang Dong", "T/T 30% deposit, 70% before shipment", 14, 4.5, "RMB"),
    ("Shanghai Precision Components Co.",   "Li Jianming",   "li@shprecision.cn",       "+86-21-6666-0202", "shprec_li",     "CN", "Thuong Hai",  "T/T 100% after delivery",              21, 4.2, "RMB"),
    ("Dongguan SMT Electronics Ltd.",       "Wang Fang",     "wang@dgsmt.cn",           "+86-769-2222-0303", "dgsmt_wang",    "CN", "Quang Dong", "L/C 60 days",                           18, 3.8, "RMB"),
    ("Guangzhou Golden Eagle Trading",      "Chen Xiaohua",  "chen@golden-eagle.cn",    "+86-20-3333-0404", "golden_chen",   "CN", "Quang Dong", "T/T full prepaid",                      10, 4.0, "RMB"),
    ("Suzhou Industrial Parts Co., Ltd",    "Huang Lei",     "huang@suzhouparts.cn",    "+86-512-5555-0505", "suzhou_huang",  "CN", "Giang To",   "T/T 50% deposit",                       15, 4.3, "RMB"),
    ("Ningbo FastShip Components",          "Liu Yang",      "liu@nbfastship.cn",       "+86-574-7777-0606", "nbfast_liu",    "CN", "Chiết Giang","T/T 30 days after B/L",                 7,  4.6, "RMB"),
    ("Chengdu MicroTech Supply",            "Zhao Min",      "zhao@cdmicrotech.cn",     "+86-28-9999-0707", "micro_zhao",    "CN", "Tu Xuyen",   "T/T 100% before shipment",              28, 3.5, "RMB"),
    ("Hangzhou Digital Parts Co.",          "Sun Ting",      "sun@hzdigital.cn",        "+86-571-8888-0808", "hzdig_sun",     "CN", "Chiết Giang","L/C 90 days",                           20, 3.9, "RMB"),
    ("Foshan Metal Works Co., Ltd",         "Wu Guang",      "wu@fsmetalworks.cn",      "+86-757-6666-0909", "fsmetal_wu",    "CN", "Quang Dong", "T/T 30% deposit",                       12, 4.1, "RMB"),
    ("Xiamen Import Export Trading Co.",    "Zheng Hai",     "zheng@xmtrading.cn",      "+86-592-5555-1010", "xmtrade_zheng", "CN", "Phuc Kien",  "T/T 100% after delivery",              17, 4.4, "RMB"),
]

for name, cname, email, phone, wechat, country, addr, terms, lead, rating, cur_code in suppliers_data:
    execute("""
        INSERT INTO suppliers (name, contact_name, contact_email, contact_phone, contact_wechat,
            country, address, payment_terms, lead_time_days, rating,
            default_currency, is_active, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::currency_code,true,%s::uuid)
        ON CONFLICT DO NOTHING
    """, (name, cname, email, phone, wechat, country, addr, terms, lead, rating, cur_code, admin_id))

conn.commit()
suppliers = fetchall("SELECT id, name FROM suppliers ORDER BY id LIMIT 15")
supplier_ids = [r["id"] for r in suppliers]
print(f"  {len(supplier_ids)} suppliers loaded")

# ---------------------------------------------------------------------------
# 3. Customers (5)
# ---------------------------------------------------------------------------
print("\n[3] Customers (5)...")

customers_data = [
    ("SEV-001", "Samsung Electronics Vietnam Co., Ltd", "Samsung SEV", "0312345678", "Lo J1, KCN Yen Phong, Bac Ninh", "bqms", "key_account"),
    ("LGI-001", "LG Innotek Vietnam Co., Ltd",          "LG Innotek",  "0222345678", "KCN Trang Due, Hai Phong",       "imv",  "key_account"),
    ("CVN-001", "Canon Vietnam Co., Ltd",               "Canon VN",    "0432345678", "KCN Thang Long, Ha Noi",         "imv",  "regular"),
    ("FOX-001", "Foxconn Industrial Internet Vietnam",  "Foxconn VN",  "0862345678", "KCN Que Vo, Bac Ninh",           "bqms", "regular"),
    ("GTE-001", "Goertek Electronics Vietnam",          "Goertek VN",  "0912345678", "KCN Que Vo 2, Bac Ninh",         "bqms", "regular"),
]

for code, name, short, tax, addr, bsys, ctype in customers_data:
    execute("""
        INSERT INTO customers (customer_code, company_name, short_name, tax_code, address, business_system, customer_type, is_active)
        VALUES (%s,%s,%s,%s,%s,%s::business_system,%s,true)
        ON CONFLICT (customer_code) DO NOTHING
    """, (code, name, short, tax, addr, bsys, ctype))

conn.commit()
customers = fetchall("SELECT id, customer_code, company_name FROM customers ORDER BY id LIMIT 10")
customer_ids = [r["id"] for r in customers]
sev_id = next((c["id"] for c in customers if "Samsung" in c["company_name"]), customer_ids[0])
print(f"  {len(customer_ids)} customers, SEV id={sev_id}")

# ---------------------------------------------------------------------------
# 4. Products (50 SMT spare parts)
# ---------------------------------------------------------------------------
print("\n[4] Products (50 SMT spare parts)...")

products_data = [
    # (bqms_code, name, spec, maker, category, unit, origin)
    ("Z123456-001", "Nozzle CN020",           "CN020, OD2.0mm, SUS316L",           "Samsung",  "Nozzle",   "EA", "CN"),
    ("Z123456-002", "Nozzle CN030",           "CN030, OD3.0mm, SUS316L",           "Samsung",  "Nozzle",   "EA", "CN"),
    ("Z123456-003", "Nozzle CN040",           "CN040, OD4.0mm, SUS316L",           "Samsung",  "Nozzle",   "EA", "CN"),
    ("Z123456-004", "Nozzle CN065",           "CN065, OD6.5mm, SUS316L",           "Samsung",  "Nozzle",   "EA", "CN"),
    ("Z123456-005", "Nozzle CN140",           "CN140, OD14.0mm, SUS316L",          "Samsung",  "Nozzle",   "EA", "KR"),
    ("Z123456-006", "Nozzle CN220",           "CN220, OD22.0mm, SUS316L",          "Samsung",  "Nozzle",   "EA", "KR"),
    ("Z123456-007", "Nozzle CN400",           "CN400, OD40.0mm, SUS316L",          "Samsung",  "Nozzle",   "EA", "KR"),
    ("Z123456-008", "Feeder 8mm",             "8mm Tape Feeder, Samsung SM series","Samsung",  "Feeder",   "EA", "CN"),
    ("Z123456-009", "Feeder 12mm",            "12mm Tape Feeder, Samsung SM481",   "Samsung",  "Feeder",   "EA", "CN"),
    ("Z123456-010", "Feeder 16mm",            "16mm Tape Feeder, Samsung SM series","Samsung", "Feeder",   "EA", "CN"),
    ("Z123456-011", "Feeder 24mm",            "24mm Tape Feeder, Samsung SM series","Samsung", "Feeder",   "EA", "KR"),
    ("Z123456-012", "Feeder 32mm",            "32mm Tape Feeder, SM series",       "Samsung",  "Feeder",   "EA", "KR"),
    ("Z123456-013", "Filter Air HEPA",        "HEPA Filter, 150x150x25mm",         "Panasonic","Filter",   "EA", "JP"),
    ("Z123456-014", "Filter Vacuum",          "Vacuum Filter, Porous Ceramic",     "Samsung",  "Filter",   "EA", "CN"),
    ("Z123456-015", "Conveyor Belt 500mm",    "L500mm x W10mm, Polyurethane",      "Samsung",  "Belt",     "M",  "CN"),
    ("Z123456-016", "Conveyor Belt 800mm",    "L800mm x W12mm, Polyurethane",      "Samsung",  "Belt",     "M",  "CN"),
    ("Z123456-017", "Return Spring 8mm",      "OD8mm, L35mm, SUS304",              "Samsung",  "Spring",   "EA", "CN"),
    ("Z123456-018", "Compression Spring",     "OD5mm, L20mm, SUS304",              "Panasonic","Spring",   "EA", "CN"),
    ("Z123456-019", "Photo Sensor",           "Diffuse reflective, 24VDC, NPN",    "Keyence",  "Sensor",   "EA", "JP"),
    ("Z123456-020", "Fiber Sensor",           "Fiber optic sensor, M4",            "Keyence",  "Sensor",   "EA", "JP"),
    ("Z123456-021", "Proximity Sensor",       "Inductive M8, 24VDC, 2mm detect",  "Omron",    "Sensor",   "EA", "JP"),
    ("Z123456-022", "Servo Motor 400W",       "AC Servo 400W, 3000RPM, 24bit enc", "Panasonic","Motor",    "EA", "JP"),
    ("Z123456-023", "Servo Motor 100W",       "AC Servo 100W, 3000RPM",            "Yaskawa",  "Motor",    "EA", "JP"),
    ("Z123456-024", "Stepping Motor NEMA17",  "NEMA17, 1.8deg, 2A",                "JUKI",     "Motor",    "EA", "CN"),
    ("Z123456-025", "PCB Main Board",         "Main Control Board, SM471 series",  "Samsung",  "PCB",      "EA", "KR"),
    ("Z123456-026", "PCB Driver Board",       "Servo Driver Board, SM series",     "Samsung",  "PCB",      "EA", "KR"),
    ("Z123456-027", "PCB IO Board",           "I/O Interface Board, 32-in/32-out", "Samsung",  "PCB",      "EA", "CN"),
    ("Z123456-028", "Solenoid Valve 3/2",     "3/2 way NC, 24VDC, 1/8 BSP",       "SMC",      "Valve",    "EA", "JP"),
    ("Z123456-029", "Solenoid Valve 5/2",     "5/2 way, 24VDC, 1/4 BSP, bistable","Festo",    "Valve",    "EA", "DE"),
    ("Z123456-030", "Air Cylinder 20x50",     "Bore 20mm, Stroke 50mm, double act","SMC",      "Cylinder", "EA", "JP"),
    ("Z123456-031", "Air Cylinder 32x80",     "Bore 32mm, Stroke 80mm",            "Festo",    "Cylinder", "EA", "DE"),
    ("Z123456-032", "Linear Guide Rail 400",  "MGN12, L400mm, SUS440",             "Hiwin",    "Guide",    "EA", "TW"),
    ("Z123456-033", "Linear Guide Rail 600",  "MGN15, L600mm, SUS440",             "THK",      "Guide",    "EA", "JP"),
    ("Z123456-034", "Ball Screw 16x5",        "SFU1605-400mm, C7 grade",           "Hiwin",    "Screw",    "EA", "TW"),
    ("Z123456-035", "Bearing 6202",           "Deep groove 6202-2RS, 15x35x11",   "NSK",      "Bearing",  "EA", "JP"),
    ("Z123456-036", "Bearing 6204",           "Deep groove 6204-2RS, 20x47x14",   "SKF",      "Bearing",  "EA", "SE"),
    ("Z123456-037", "Coupling 6.35x8mm",      "Rigid coupling, AL6061, D14xL25",  "Samsung",  "Coupling", "EA", "CN"),
    ("Z123456-038", "O-Ring P15",             "NBR O-ring, P15, ID15.4xW1.9mm",   "NOK",      "Seal",     "EA", "JP"),
    ("Z123456-039", "Camera Module VGA",      "CCD Camera, 640x480, GigE",         "Cognex",   "Vision",   "EA", "US"),
    ("Z123456-040", "LED Ring Light",         "LED Ring Light, OD120mm, 24VDC",    "Samsung",  "Vision",   "EA", "CN"),
    ("Z123456-041", "Vacuum Generator",       "Venturi type, -90kPa, 1/8 BSP",    "SMC",      "Vacuum",   "EA", "JP"),
    ("Z123456-042", "Vacuum Cup 6mm",         "Silicone suction cup, Flat, D6mm",  "Piab",     "Vacuum",   "EA", "SE"),
    ("Z123456-043", "Vacuum Cup 15mm",        "Silicone suction cup, Flat, D15mm", "Piab",     "Vacuum",   "EA", "SE"),
    ("Z123456-044", "Pressure Regulator",     "Air regulator, 0-1MPa, 1/4 BSP",   "SMC",      "Pneumatic","EA", "JP"),
    ("Z123456-045", "Flow Control Valve",     "Exhaust throttle, M5, 0-8 L/min",  "Festo",    "Pneumatic","EA", "DE"),
    ("Z123456-046", "Touch Screen 15 inch",   "Industrial LCD 15'', 1024x768",     "Samsung",  "HMI",      "EA", "KR"),
    ("Z123456-047", "Encoder 2500PPR",        "Incremental encoder, 2500PPR, 6mm", "Omron",    "Encoder",  "EA", "JP"),
    ("Z123456-048", "Power Supply 24V 10A",   "SMPS 24VDC 10A, DIN rail mount",   "Meanwell", "Power",    "EA", "TW"),
    ("Z123456-049", "Circuit Breaker 10A",    "MCB 10A, 1P, 230VAC",              "Schneider", "Electrical","EA","FR"),
    ("Z123456-050", "Emergency Stop Button",  "E-stop 40mm, red, NC+NO, IP65",    "Omron",    "Electrical","EA","JP"),
]

prod_count = 0
for code, name, spec, maker, category, unit, origin in products_data:
    n = execute("""
        INSERT INTO products (bqms_code, product_name, specification, maker, category, unit, country_origin, business_system, is_active)
        VALUES (%s,%s,%s,%s,%s,%s,%s,'bqms'::business_system,true)
        ON CONFLICT (bqms_code) DO NOTHING
    """, (code, name, spec, maker, category, unit, origin))
    prod_count += n

conn.commit()
products = fetchall("SELECT id, bqms_code, product_name, specification, maker, category, unit FROM products WHERE bqms_code LIKE 'Z123456-%' ORDER BY bqms_code")
product_ids = [r["id"] for r in products]
print(f"  {len(product_ids)} products loaded (inserted {prod_count})")

# ---------------------------------------------------------------------------
# 5. Inventory (50 items)
# ---------------------------------------------------------------------------
print("\n[5] Inventory (50 items)...")

inv_count = 0
for i, prod in enumerate(products):
    qty = random.choice([0, 5, 12, 25, 50, 80, 120, 200, 350, 500])
    reserved = random.randint(0, max(0, qty - 5)) if qty > 5 else 0
    min_stock = random.choice([10, 20, 30, 50])
    max_stock = min_stock * random.randint(5, 20)
    category = prod["category"] or "General"
    brand = prod["maker"] or "Unknown"
    # Unit cost: CNY 50-5000 -> VND ~170000-17000000
    unit_cost_cny = random.uniform(50, 5000)
    unit_cost_vnd = round(unit_cost_cny * 3450, 0)

    n = execute("""
        INSERT INTO inventory (product_id, product_code, product_name, category, brand,
            specification, unit, quantity, reserved_qty, min_stock, max_stock, unit_cost)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (product_code) DO NOTHING
    """, (
        prod["id"], prod["bqms_code"], prod["product_name"],
        category, brand, prod["specification"], prod["unit"] or "EA",
        qty, reserved, min_stock, max_stock, unit_cost_vnd
    ))
    inv_count += n

conn.commit()
print(f"  {inv_count} inventory records inserted")

# ---------------------------------------------------------------------------
# 6. Exchange Rates (30 days: CNY/VND, USD/VND)
# ---------------------------------------------------------------------------
print("\n[6] Exchange rates (30 days)...")

er_count = 0
base_rates = {
    ("RMB", "VND"): (3450.0, 25.0),
    ("USD", "VND"): (25450.0, 30.0),
    ("KRW", "VND"): (18.5, 0.1),
    ("JPY", "VND"): (168.0, 1.0),
    ("EUR", "VND"): (27500.0, 50.0),
}

for day_i in range(30):
    rate_date = today - timedelta(days=day_i)
    for (from_cur, to_cur), (base, var) in base_rates.items():
        rate = round(base + random.uniform(-var, var), 2)
        n = execute("""
            INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, rate_type, source)
            VALUES (%s,%s::currency_code,%s::currency_code,%s,'transfer','manual_seed')
            ON CONFLICT ON CONSTRAINT uq_exchange_rate DO NOTHING
        """, (rate_date, from_cur, to_cur, rate))
        er_count += n

conn.commit()
print(f"  {er_count} exchange rate records inserted")

# ---------------------------------------------------------------------------
# 7. Cash Book Categories
# ---------------------------------------------------------------------------
print("\n[7] Cash book categories...")

cats = [
    ("THU-BAN", "Thu tien ban hang",       "thu"),
    ("THU-TM",  "Thu tam ung",              "thu"),
    ("THU-KHAC","Thu khac",                 "thu"),
    ("CHI-MH",  "Chi mua hang NCC",        "chi"),
    ("CHI-LUONG","Chi tien luong",          "chi"),
    ("CHI-VC",  "Chi van chuyen / logistics","chi"),
    ("CHI-TM",  "Chi tam ung",              "chi"),
    ("CHI-KHAC","Chi khac",                 "chi"),
]
for code, name, direction in cats:
    execute("""
        INSERT INTO cash_book_categories (category_code, category_name, direction)
        VALUES (%s,%s,%s)
        ON CONFLICT (category_code) DO NOTHING
    """, (code, name, direction))

conn.commit()
cat_rows = fetchall("SELECT id, category_code FROM cash_book_categories")
cat_map = {r["category_code"]: r["id"] for r in cat_rows}
print(f"  {len(cat_map)} categories")

# ---------------------------------------------------------------------------
# 8. Purchase Orders (15 POs)
# ---------------------------------------------------------------------------
print("\n[8] Purchase orders (15 POs)...")

po_statuses = [
    "draft", "pending_approval", "approved", "sent_to_supplier",
    "confirmed", "in_transit", "partial_received", "received", "closed"
]

po_data = [
    # (suffix, sup_idx, status, days_ago, currency, exch_rate, notes)
    ("202601-000001", 0, "closed",           60, "RMB", 3450.0, "Nozzle CN020/030 batch Q1"),
    ("202601-000002", 1, "received",         45, "RMB", 3455.0, "Feeder 8mm/12mm re-stock"),
    ("202602-000003", 2, "received",         38, "RMB", 3440.0, "Filter HEPA + Vacuum"),
    ("202602-000004", 3, "in_transit",       20, "RMB", 3460.0, "Sensor & Motor components"),
    ("202602-000005", 4, "in_transit",       18, "RMB", 3448.0, "PCB boards Samsung series"),
    ("202603-000006", 5, "confirmed",        12, "RMB", 3452.0, "Valve + Cylinder SMC"),
    ("202603-000007", 6, "sent_to_supplier", 8,  "RMB", 3445.0, "Linear guide + Ball screw"),
    ("202603-000008", 7, "approved",         5,  "RMB", 3458.0, "Bearing + Coupling batch"),
    ("202603-000009", 8, "pending_approval", 3,  "RMB", 3462.0, "Camera + Vision system"),
    ("202603-000010", 9, "draft",            1,  "RMB", 3450.0, "Vacuum generator + cup"),
    ("202603-000011", 0, "approved",         7,  "USD", 25450.0,"Emergency parts order SEV"),
    ("202603-000012", 1, "in_transit",       15, "USD", 25420.0,"Encoder + Power supply"),
    ("202603-000013", 2, "received",         25, "USD", 25480.0,"E-stop + CB batch"),
    ("202603-000014", 3, "closed",           50, "USD", 25500.0,"Touch screen + HMI"),
    ("202603-000015", 4, "draft",            2,  "RMB", 3455.0, "Spring + O-ring Q2 stock"),
]

po_ids = []
for suffix, sup_idx, status, d_ago, currency, exch_rate, notes in po_data:
    po_number = f"PO-{suffix}"
    sup = suppliers[sup_idx % len(suppliers)]
    order_date = days_ago(d_ago)
    expected_date = order_date + timedelta(days=21)
    cust_id = sev_id if "SEV" in notes else None

    # Check if exists
    existing = fetchone("SELECT id FROM purchase_orders WHERE po_number = %s", (po_number,))
    if existing:
        po_ids.append(existing["id"])
        continue

    # Subtotal will be updated after line items
    cur.execute("""
        INSERT INTO purchase_orders (po_number, supplier_id, customer_id, status, currency,
            exchange_rate, subtotal, total_amount, order_date, expected_date, notes,
            business_system, created_by)
        VALUES (%s,%s,%s,%s::po_status,%s::currency_code,%s,0,0,%s,%s,%s,'bqms'::business_system,%s::uuid)
        RETURNING id
    """, (po_number, sup["id"], cust_id, status, currency, exch_rate,
          order_date, expected_date, notes, admin_id))
    row = cur.fetchone()
    if row:
        po_ids.append(row["id"])

conn.commit()
print(f"  {len(po_ids)} purchase orders ready")

# ---------------------------------------------------------------------------
# 9. PO Line Items (~3 per PO)
# ---------------------------------------------------------------------------
print("\n[9] PO line items...")

li_count = 0
for i, po_id in enumerate(po_ids):
    # Check existing lines
    existing_lines = fetchall("SELECT id FROM po_line_items WHERE po_id = %s", (po_id,))
    if existing_lines:
        continue

    n_lines = random.randint(2, 4)
    subtotal = 0
    for line_num in range(1, n_lines + 1):
        prod = products[(i * 3 + line_num - 1) % len(products)]
        qty = random.choice([50, 100, 200, 500, 1000])
        unit_price = round(random.uniform(50, 3000), 2)  # CNY or USD
        cur.execute("""
            INSERT INTO po_line_items (po_id, line_number, product_id, product_code,
                product_name, specification, maker, quantity, unit, unit_price, currency)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'RMB'::currency_code)
        """, (po_id, line_num, prod["id"], prod["bqms_code"], prod["product_name"],
              prod["specification"], prod["maker"], qty, prod["unit"] or "EA", unit_price))
        subtotal += qty * unit_price
        li_count += 1

    execute("""
        UPDATE purchase_orders SET subtotal=%s, total_amount=%s WHERE id=%s
    """, (round(subtotal, 2), round(subtotal, 2), po_id))

conn.commit()
print(f"  {li_count} line items inserted")

# ---------------------------------------------------------------------------
# 10. Customers Contacts
# ---------------------------------------------------------------------------
print("\n[10] Customer contacts...")

contacts_data = [
    (sev_id, "Park Jisoo",    "park.jisoo@samsung.com",       "0222-300-0001", "Purchasing Dept", True),
    (sev_id, "Kim Minji",     "kim.minji@samsung.com",        "0222-300-0002", "Quality Dept",    False),
    (sev_id, "Lee Sunghoon",  "lee.sunghoon@samsung.com",     "0222-300-0003", "Warehouse",       False),
]
cust_contact_count = 0
for cid, fname, email, phone, dept, primary in contacts_data:
    n = execute("""
        INSERT INTO customer_contacts (customer_id, full_name, email, phone, department, is_primary, is_active)
        VALUES (%s,%s,%s,%s,%s,%s,true)
        ON CONFLICT DO NOTHING
    """, (cid, fname, email, phone, dept, primary))
    cust_contact_count += n

conn.commit()
print(f"  {cust_contact_count} contacts inserted")

# ---------------------------------------------------------------------------
# 11. Sales Orders (10)
# ---------------------------------------------------------------------------
print("\n[11] Sales orders (10)...")

so_statuses = ["confirmed", "in_progress", "shipped", "delivered", "invoiced", "closed"]
so_data = [
    ("SO-202601-000001", sev_id, "Samsung Electronics Vietnam", "delivered", 60, 580_000_000),
    ("SO-202601-000002", sev_id, "Samsung Electronics Vietnam", "invoiced",  45, 420_000_000),
    ("SO-202602-000003", sev_id, "Samsung Electronics Vietnam", "delivered", 35, 315_000_000),
    ("SO-202602-000004", sev_id, "Samsung Electronics Vietnam", "shipped",   20, 780_000_000),
    ("SO-202603-000005", sev_id, "Samsung Electronics Vietnam", "confirmed", 10, 250_000_000),
    ("SO-202603-000006", customer_ids[1] if len(customer_ids) > 1 else sev_id, "LG Innotek Vietnam", "in_progress", 8, 190_000_000),
    ("SO-202603-000007", customer_ids[1] if len(customer_ids) > 1 else sev_id, "LG Innotek Vietnam", "confirmed",   5, 145_000_000),
    ("SO-202603-000008", customer_ids[2] if len(customer_ids) > 2 else sev_id, "Canon Vietnam",      "confirmed",   3, 88_000_000),
    ("SO-202603-000009", sev_id, "Samsung Electronics Vietnam", "in_progress",12, 360_000_000),
    ("SO-202603-000010", sev_id, "Samsung Electronics Vietnam", "confirmed",   1, 520_000_000),
]

so_ids = []
for so_num, cust_id, cust_name, status, d_ago, total in so_data:
    existing = fetchone("SELECT id FROM sales_orders WHERE order_number = %s", (so_num,))
    if existing:
        so_ids.append(existing["id"])
        continue
    order_date = days_ago(d_ago)
    vat = round(total * 0.1, 0)
    cur.execute("""
        INSERT INTO sales_orders (order_number, customer_id, customer_name, order_date,
            requested_delivery_date, status, subtotal, vat_amount, total_amount,
            currency, source_system, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'VND'::currency_code,'bqms',%s::uuid)
        RETURNING id
    """, (so_num, cust_id, cust_name, order_date,
          order_date + timedelta(days=14), status,
          total, vat, total + vat, admin_id))
    row = cur.fetchone()
    if row:
        so_ids.append(row["id"])

conn.commit()
print(f"  {len(so_ids)} sales orders ready")

# Sales order items
soi_count = 0
for i, so_id in enumerate(so_ids):
    existing = fetchall("SELECT id FROM sales_order_items WHERE sales_order_id = %s", (so_id,))
    if existing:
        continue
    for line_num in range(1, random.randint(2, 5)):
        prod = products[(i * 5 + line_num) % len(products)]
        qty = random.choice([100, 200, 500, 1000])
        unit_price = round(random.uniform(500_000, 5_000_000), 0)
        execute("""
            INSERT INTO sales_order_items (sales_order_id, line_number, product_id, product_code,
                product_name, specification, unit, quantity, unit_price, amount, vat_rate)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,10)
        """, (so_id, line_num, prod["id"], prod["bqms_code"], prod["product_name"],
              prod["specification"], prod["unit"] or "EA", qty, unit_price,
              round(qty * unit_price, 0)))
        soi_count += 1

conn.commit()
print(f"  {soi_count} SO line items")

# ---------------------------------------------------------------------------
# 12. Revenue Invoices (10)
# ---------------------------------------------------------------------------
print("\n[12] Revenue invoices (10)...")

rev_data = [
    ("INV-2026-0001", days_ago(55), sev_id,  "Samsung Electronics Vietnam", 480_000_000, 380_000_000, 100_000_000),
    ("INV-2026-0002", days_ago(42), sev_id,  "Samsung Electronics Vietnam", 350_000_000, 280_000_000, 70_000_000),
    ("INV-2026-0003", days_ago(35), sev_id,  "Samsung Electronics Vietnam", 620_000_000, 500_000_000, 120_000_000),
    ("INV-2026-0004", days_ago(28), sev_id,  "Samsung Electronics Vietnam", 290_000_000, 230_000_000, 60_000_000),
    ("INV-2026-0005", days_ago(20), sev_id,  "Samsung Electronics Vietnam", 780_000_000, 620_000_000, 160_000_000),
    ("INV-2026-0006", days_ago(15), customer_ids[1] if len(customer_ids)>1 else sev_id, "LG Innotek Vietnam", 185_000_000, 148_000_000, 37_000_000),
    ("INV-2026-0007", days_ago(10), sev_id,  "Samsung Electronics Vietnam", 430_000_000, 344_000_000, 86_000_000),
    ("INV-2026-0008", days_ago(5),  sev_id,  "Samsung Electronics Vietnam", 560_000_000, 448_000_000, 112_000_000),
    ("INV-2026-0009", days_ago(3),  customer_ids[2] if len(customer_ids)>2 else sev_id, "Canon Vietnam", 95_000_000, 76_000_000, 19_000_000),
    ("INV-2026-0010", days_ago(1),  sev_id,  "Samsung Electronics Vietnam", 720_000_000, 576_000_000, 144_000_000),
]

rev_ids = []
for inv_num, inv_date, cust_id, cust_name, total, cost, profit in rev_data:
    prod = products[len(rev_ids) % len(products)]
    qty = 100
    unit_price = total / qty
    cur.execute("""
        INSERT INTO revenue_invoices (invoice_number, invoice_date, invoice_month, invoice_year,
            customer_id, customer_name, product_id, product_name, unit, quantity,
            unit_price, amount, tax_rate, vat_amount, total_amount,
            total_cost, profit, data_source)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'EA',%s,%s,%s,10,%s,%s,%s,%s,'manual_seed')
        ON CONFLICT DO NOTHING
        RETURNING id
    """, (inv_num, inv_date, inv_date.month, inv_date.year,
          cust_id, cust_name, prod["id"], prod["product_name"],
          qty, unit_price, total, round(total * 0.1, 0),
          round(total * 1.1, 0), cost, profit))
    row = cur.fetchone()
    if row:
        rev_ids.append(row["id"])

conn.commit()
print(f"  {len(rev_ids)} revenue invoices")

# ---------------------------------------------------------------------------
# 13. Accounts Receivable (8 records)
# ---------------------------------------------------------------------------
print("\n[13] Accounts receivable (8)...")

ar_statuses = ["pending", "partial_paid", "paid", "overdue"]
ar_data = [
    (sev_id, days_ago(55), days_ago(25), 528_000_000, 528_000_000, "paid"),
    (sev_id, days_ago(42), days_ago(12), 385_000_000, 385_000_000, "paid"),
    (sev_id, days_ago(35), days_ago(5),  682_000_000, 400_000_000, "partial_paid"),
    (sev_id, days_ago(28), days_from_now(2), 319_000_000, 0, "overdue"),
    (sev_id, days_ago(20), days_from_now(10),858_000_000, 0, "pending"),
    (customer_ids[1] if len(customer_ids)>1 else sev_id, days_ago(15), days_from_now(15), 203_500_000, 0, "pending"),
    (sev_id, days_ago(10), days_from_now(20), 473_000_000, 0, "pending"),
    (sev_id, days_ago(5),  days_from_now(25), 616_000_000, 0, "pending"),
]

ar_ids = []
for cust_id, inv_date, due_date, amount, paid, status in ar_data:
    cur.execute("""
        INSERT INTO accounts_receivable (customer_id, invoice_date, due_date, amount,
            currency, paid_amount, status, created_by)
        VALUES (%s,%s,%s,%s,'VND'::currency_code,%s,%s::payment_status,%s::uuid)
        RETURNING id
    """, (cust_id, inv_date, due_date, amount, paid, status, accountant_id))
    row = cur.fetchone()
    if row:
        ar_ids.append(row["id"])

conn.commit()
print(f"  {len(ar_ids)} AR records")

# ---------------------------------------------------------------------------
# 14. Accounts Payable (8 records)
# ---------------------------------------------------------------------------
print("\n[14] Accounts payable (8)...")

ap_data = [
    (0, days_ago(58), days_ago(28), 285_000, "CNY", 3450, "paid"),
    (1, days_ago(43), days_ago(13), 148_000, "CNY", 3455, "paid"),
    (2, days_ago(36), days_ago(6),  520_000, "CNY", 3440, "partial_paid"),
    (3, days_ago(22), days_from_now(8),  380_000, "CNY", 3460, "pending"),
    (4, days_ago(19), days_from_now(11), 210_000, "CNY", 3448, "pending"),
    (5, days_ago(13), days_from_now(17), 95_000,  "CNY", 3452, "pending"),
    (6, days_ago(7),  days_from_now(23), 440_000, "CNY", 3445, "pending"),
    (7, days_ago(3),  days_from_now(27), 175_000, "CNY", 3458, "pending"),
]

ap_ids = []
for sup_idx, inv_date, due_date, amount_cny, currency, exch, status in ap_data:
    sup = suppliers[sup_idx % len(suppliers)]
    amount_vnd = int(amount_cny * exch)
    po_id = po_ids[sup_idx % len(po_ids)] if po_ids else None
    cur.execute("""
        INSERT INTO accounts_payable (supplier_id, po_id, invoice_date, due_date, amount,
            currency, exchange_rate, amount_vnd, paid_amount, status, created_by)
        VALUES (%s,%s,%s,%s,%s,%s::currency_code,%s,%s,0,%s::payment_status,%s::uuid)
        RETURNING id
    """, (sup["id"], po_id, inv_date, due_date, amount_cny,
          currency, exch, amount_vnd, status, accountant_id))
    row = cur.fetchone()
    if row:
        ap_ids.append(row["id"])

conn.commit()
print(f"  {len(ap_ids)} AP records")

# ---------------------------------------------------------------------------
# 15. Cash Book (20 entries)
# ---------------------------------------------------------------------------
print("\n[15] Cash book (20 entries)...")

cb_entries = [
    (days_ago(29), "PT-2026-001", "THU-BAN",  "Samsung Electronics Vietnam", "Thu tien hang nozzle thang 2",            528_000_000, "thu"),
    (days_ago(27), "PT-2026-002", "THU-BAN",  "Samsung Electronics Vietnam", "Thu tien hang feeder thang 2",            385_000_000, "thu"),
    (days_ago(25), "CHI-MH-001", "CHI-MH",   "Shenzhen Huawei Parts Co.",   "Chi tien mua nozzle CN020/030",           285_000_000, "chi"),
    (days_ago(22), "PT-2026-003", "THU-BAN",  "LG Innotek Vietnam",          "Thu tien hang sensor LG Innotek",          195_000_000, "thu"),
    (days_ago(20), "CHI-VC-001", "CHI-VC",   "DHL Vietnam",                 "Chi phi van chuyen tu Trung Quoc",          12_500_000, "chi"),
    (days_ago(18), "CHI-MH-002", "CHI-MH",   "Shanghai Precision Components","Chi tien mua PCB driver board",           520_000_000, "chi"),
    (days_ago(16), "CHI-LUONG-001","CHI-LUONG","Nhan vien Song Chau",        "Tra luong thang 2/2026",                   85_000_000, "chi"),
    (days_ago(14), "PT-2026-004", "THU-BAN",  "Samsung Electronics Vietnam", "Thu tien hang cylinder + valve",          682_000_000, "thu"),
    (days_ago(12), "CHI-MH-003", "CHI-MH",   "Dongguan SMT Electronics",    "Chi mua filter + vacuum components",       148_000_000, "chi"),
    (days_ago(10), "CHI-VC-002", "CHI-VC",   "FedEx Vietnam",               "Chi phi logistics chuyen phat nhanh",       8_200_000, "chi"),
    (days_ago(9),  "PT-2026-005", "THU-BAN",  "Canon Vietnam",               "Thu tien hang camera vision system",        95_000_000, "thu"),
    (days_ago(8),  "CHI-TM-001", "CHI-TM",   "Nguyen Thi Ngan",             "Tam ung cong tac phi di CN",               15_000_000, "chi"),
    (days_ago(7),  "PT-2026-006", "THU-BAN",  "Samsung Electronics Vietnam", "Thu tien hang encoder + power supply",    473_000_000, "thu"),
    (days_ago(6),  "CHI-MH-004", "CHI-MH",   "Guangzhou Golden Eagle",      "Chi mua bearing + coupling batch",        380_000_000, "chi"),
    (days_ago(5),  "CHI-LUONG-002","CHI-LUONG","Nhan vien Song Chau",        "Thuong Tet am lich 2026",                  42_000_000, "chi"),
    (days_ago(4),  "THU-TM-001", "THU-TM",   "Nguyen Thi Ngan",             "Hoan tam ung cong tac phi",                 8_500_000, "thu"),
    (days_ago(3),  "CHI-VC-003", "CHI-VC",   "TNT Express",                 "Chi phi van chuyen noi dia",                3_800_000, "chi"),
    (days_ago(2),  "PT-2026-007", "THU-BAN",  "Samsung Electronics Vietnam", "Thu tien hang guide + ball screw",        616_000_000, "thu"),
    (days_ago(1),  "CHI-MH-005", "CHI-MH",   "Suzhou Industrial Parts",     "Dat coc mua hang Q2/2026",                210_000_000, "chi"),
    (today,        "CHI-KHAC-001","CHI-KHAC", "Cong ty dich vu van phong",   "Phi van phong thang 3/2026",                5_500_000, "chi"),
]

cb_count = 0
balance = 500_000_000  # opening balance
for entry_date, doc_num, cat_code, counterparty, desc, amount, direction in cb_entries:
    if direction == "thu":
        balance += amount
    else:
        balance -= amount
    cat_id = cat_map.get(cat_code)
    n = execute("""
        INSERT INTO cash_book (entry_date, document_number, category_id, counterparty,
            description, amount, direction, balance_after, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::uuid)
        ON CONFLICT DO NOTHING
    """, (entry_date, doc_num, cat_id, counterparty, desc, amount, direction, balance, accountant_id))
    cb_count += n

conn.commit()
print(f"  {cb_count} cash book entries")

# ---------------------------------------------------------------------------
# 16. Workflow Instances (5) + History
# ---------------------------------------------------------------------------
print("\n[16] Workflow instances (5)...")

wf_data = [
    ("purchase_approval", "pending_l1", "Phe duyet PO-202603-000010 — Shenzhen Huawei Parts", 520_000_000, 3, procurement_id, manager_id),
    ("po_approval",       "approved",  "PO-202603-000008 approved — Bearing + Coupling batch",380_000_000, 2, procurement_id, manager_id),
    ("bqms_quotation",    "pending_l2","Bao gia BQMS Z123456-025 PCB Main Board for SEV",      95_000_000, 4, staff_ids[0] if staff_ids else admin_id, manager_id),
    ("expense_approval",  "approved",  "De nghi chi cong tac phi di Trung Quoc thang 3",       15_000_000, 2, procurement_id, manager_id),
    ("purchase_approval", "rejected",  "PO Nozzle CN400 — gia cao hon thi truong 18%",         28_000_000, 1, procurement_id, manager_id),
]

wf_ids = []
for wf_type, status, title, amount, priority, created_by, assigned_to in wf_data:
    existing = fetchone("SELECT id FROM workflow_instances WHERE title = %s", (title,))
    if existing:
        wf_ids.append(existing["id"])
        continue
    cur.execute("""
        INSERT INTO workflow_instances (workflow_type, current_status, title, amount,
            currency, priority, created_by, assigned_to)
        VALUES (%s::workflow_type,%s::workflow_status,%s,%s,'VND'::currency_code,%s,%s::uuid,%s::uuid)
        RETURNING id
    """, (wf_type, status, title, amount, priority, created_by, assigned_to))
    row = cur.fetchone()
    if row:
        wf_id = row["id"]
        wf_ids.append(wf_id)
        # History: create
        execute("""
            INSERT INTO workflow_history (instance_id, from_status, to_status, action, actor_id, comment)
            VALUES (%s,NULL,'draft'::workflow_status,'create',%s::uuid,'Tao moi')
        """, (wf_id, created_by))
        # History: submit
        if status != "draft":
            to_st = "pending_l1"
            execute("""
                INSERT INTO workflow_history (instance_id, from_status, to_status, action, actor_id, comment)
                VALUES (%s,'draft'::workflow_status,%s::workflow_status,'submit',%s::uuid,'Gui yeu cau duyet')
            """, (wf_id, to_st, created_by))
        if status in ("approved", "rejected"):
            action = "approve" if status == "approved" else "reject"
            comment = "Duyet OK" if status == "approved" else "Tu choi — gia qua cao"
            execute("""
                INSERT INTO workflow_history (instance_id, from_status, to_status, action, actor_id, comment)
                VALUES (%s,'pending_l1'::workflow_status,%s::workflow_status,%s,%s::uuid,%s)
            """, (wf_id, status, action, assigned_to, comment))

conn.commit()
print(f"  {len(wf_ids)} workflow instances")

# ---------------------------------------------------------------------------
# 17. Tasks (10)
# ---------------------------------------------------------------------------
print("\n[17] Tasks (10)...")

tasks_data = [
    ("Lien he NCC Shenzhen Huawei ve don PO-202603-000010", "Xac nhan gia va ETA cho don hang nozzle", procurement_id, manager_id, 3, "in_progress", days_from_now(3)),
    ("Kiem tra chat luong nozzle CN020 lo moi",             "Kiem tra 100% truoc khi nhap kho",          warehouse_id,   procurement_id, 4, "todo",        days_from_now(5)),
    ("Chuan bi bao gia BQMS thang 4/2026",                  "Tong hop RFQ moi tu Samsung, phan cong",    staff_ids[0] if staff_ids else admin_id, manager_id, 2, "todo", days_from_now(7)),
    ("Cap nhat ty gia CNY/VND tuan nay",                    "Lay ty gia tu VCB, cap nhat he thong",       accountant_id,  manager_id, 2, "done",        days_ago(1)),
    ("Lam thu tuc hai quan lo hang CN022",                   "Tao to khai nhap khau, nop thue",           procurement_id, admin_id,   3, "in_progress", days_from_now(2)),
    ("Xuat hoa don GTGT cho Samsung thang 3",               "Xuat 3 hoa don GTGT, gui cho Samsung",      accountant_id,  manager_id, 3, "in_progress", days_from_now(1)),
    ("Kiem ke kho thang 3/2026",                            "Kiem ke toan bo ton kho, doi chieu so lieu", warehouse_id,   admin_id,   2, "todo",        days_from_now(2)),
    ("Bao cao doanh thu Q1/2026",                           "Tong hop doanh thu, loi nhuan Q1",          accountant_id,  admin_id,   4, "todo",        days_from_now(5)),
    ("Theo doi don hang in transit PO-202602-000004",        "Kiem tra ETA hang SMC valve tu CN",         procurement_id, manager_id, 3, "in_progress", days_from_now(8)),
    ("Review hop dong NCC Suzhou Industrial",               "Renew hop dong, dam phan gia Q2",            procurement_id, admin_id,   2, "todo",        days_from_now(15)),
]

task_count = 0
for title, desc, assigned_to, assigned_by, priority, status, due_date in tasks_data:
    n = execute("""
        INSERT INTO tasks (title, description, assigned_to, assigned_by, priority, status, due_date)
        VALUES (%s,%s,%s::uuid,%s::uuid,%s,%s,%s)
        ON CONFLICT DO NOTHING
    """, (title, desc, assigned_to, assigned_by, priority, status, due_date))
    task_count += n

conn.commit()
print(f"  {task_count} tasks inserted")

# ---------------------------------------------------------------------------
# 18. Notifications (15)
# ---------------------------------------------------------------------------
print("\n[18] Notifications (15)...")

notif_data = [
    (manager_id,     "workflow_request",  "Yeu cau phe duyet PO-202603-000010",       "Nguyen Thi Ngan gui yeu cau phe duyet don hang 520 trieu VND cho Shenzhen Huawei Parts.", False),
    (manager_id,     "workflow_request",  "Bao gia BQMS Z123456-025 can phe duyet",   "Truong phong can phe duyet bao gia PCB Main Board cho Samsung SEV, gia tri 95 trieu VND.", False),
    (procurement_id, "workflow_approved", "PO-202603-000008 da duoc phe duyet",        "Don hang Bearing + Coupling batch (380 trieu VND) da duoc Giam doc phe duyet. Tien hanh gui NCC.", True),
    (procurement_id, "workflow_rejected", "Bao gia Nozzle CN400 bi tu choi",           "Bao gia bi tu choi vi gia cao hon thi truong 18%. Can dam phan lai voi NCC Shenzhen.", False),
    (warehouse_id,   "stock_alert",       "Canh bao: Nozzle CN020 sap het hang",       "Ton kho Nozzle CN020 (Z123456-001) con 5 EA, duoi muc toi thieu 10 EA. Can dat hang gap.", False),
    (warehouse_id,   "stock_alert",       "Canh bao: Feeder 8mm duoi muc toi thieu",  "Ton kho Feeder 8mm (Z123456-008) chi con 0 EA. Hang da het kho!", False),
    (admin_id,       "bqms_rfq_new",      "5 RFQ moi tu Samsung BQMS",                "He thong nhan 5 yeu cau bao gia moi tu Samsung. Vui long phan cong xu ly truoc 3 ngay.", False),
    (procurement_id, "po_received",       "PO-202602-000003 da nhan hang",             "Lo hang filter HEPA + vacuum da nhan du tai kho. NCC: Dongguan SMT Electronics.", True),
    (procurement_id, "po_received",       "PO-202601-000002 da nhan hang",             "Lo hang feeder 8mm/12mm nhan day du. Kiem tra chat luong truoc nhap kho.", True),
    (accountant_id,  "deadline_reminder", "Han thanh toan AP den han trong 3 ngay",    "3 phieu phai tra NCC Guangzhou Golden Eagle (380 trieu CNY) se den han trong 3 ngay.", False),
    (manager_id,     "report_ready",      "Bao cao doanh thu thang 2/2026 san sang",   "Bao cao tong hop doanh thu, chi phi, loi nhuan thang 2 da san sang. Click de xem.", True),
    (staff_ids[0] if staff_ids else admin_id, "deadline_reminder", "Han nop bao gia BQMS ngay mai", "2 RFQ Samsung can nop bao gia truoc 17:00 ngay mai. Kiem tra danh sach RFQ.", False),
    (warehouse_id,   "po_received",       "Hang PO-202602-000004 du kien den ngay mai","Lo hang SMC valve + cylinder du kien ETA ngay mai. Chuan bi khu vuc nhan hang.", False),
    (admin_id,       "workflow_approved", "Workflow phe duyet Q1 hoan tat",            "Tat ca workflow phe duyet Q1/2026 da xu ly xong. Ty le phe duyet: 85%.", True),
    (accountant_id,  "report_ready",      "Bao cao cong no phai thu thang 3",          "Tong cong no phai thu: 2.8 ty VND. Samsung SEV chiem 95%. Bao cao chi tiet da san sang.", False),
]

notif_count = 0
for recipient_id, ntype, title, body, is_read in notif_data:
    n = execute("""
        INSERT INTO notifications (recipient_id, type, title, body, is_read)
        VALUES (%s::uuid,%s::notification_type,%s,%s,%s)
        ON CONFLICT DO NOTHING
    """, (recipient_id, ntype, title, body, is_read))
    notif_count += n

conn.commit()
print(f"  {notif_count} notifications")

# ---------------------------------------------------------------------------
# 19. BQMS Samsung PO (8 records)
# ---------------------------------------------------------------------------
print("\n[19] BQMS Samsung POs (8)...")

samsung_po_statuses = ["new", "confirmed", "shipped", "received", "invoiced"]
spo_data = [
    ("SEV-PO-2026-000123", days_ago(55), "confirmed", "Park Jisoo", "park.jisoo@samsung.com", 0,  500, 580_000, "VND"),
    ("SEV-PO-2026-000145", days_ago(48), "invoiced",  "Kim Minji",  "kim.minji@samsung.com",  1,  200, 420_000, "VND"),
    ("SEV-PO-2026-000167", days_ago(38), "received",  "Park Jisoo", "park.jisoo@samsung.com", 2,  100, 1_250_000, "VND"),
    ("SEV-PO-2026-000189", days_ago(28), "shipped",   "Lee Sunghoon","lee.sunghoon@samsung.com",3, 1000, 89_000,  "VND"),
    ("SEV-PO-2026-000201", days_ago(18), "confirmed", "Park Jisoo", "park.jisoo@samsung.com", 4,  50,  8_500_000,"VND"),
    ("SEV-PO-2026-000223", days_ago(10), "new",       "Kim Minji",  "kim.minji@samsung.com",  5,  300, 350_000, "VND"),
    ("SEV-PO-2026-000245", days_ago(5),  "new",       "Park Jisoo", "park.jisoo@samsung.com", 6,  80,  3_200_000,"VND"),
    ("SEV-PO-2026-000267", days_ago(2),  "new",       "Lee Sunghoon","lee.sunghoon@samsung.com",7, 200, 750_000, "VND"),
]

spo_ids = []
for po_num, po_date, status, recv_name, buyer_email, prod_idx, qty, unit_price, currency in spo_data:
    prod = products[prod_idx % len(products)]
    amount = qty * unit_price
    cur.execute("""
        INSERT INTO bqms_samsung_po (po_number, po_date, process_status, buyer_name, buyer_email,
            product_id, bqms_code, specification, maker, order_qty, unit_price, amount, currency,
            recipient_name, preferred_delivery_date)
        VALUES (%s,%s,%s::samsung_po_process_status,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::currency_code,%s,%s)
        ON CONFLICT (po_number) DO NOTHING
        RETURNING id
    """, (po_num, po_date, status, recv_name, buyer_email,
          prod["id"], prod["bqms_code"], prod["specification"], prod["maker"],
          qty, unit_price, amount, currency, recv_name,
          po_date + timedelta(days=14)))
    row = cur.fetchone()
    if row:
        spo_ids.append(row["id"])

conn.commit()
print(f"  {len(spo_ids)} Samsung POs")

# ---------------------------------------------------------------------------
# 20. BQMS Deliveries (6)
# ---------------------------------------------------------------------------
print("\n[20] BQMS deliveries (6)...")

del_data = [
    (0, days_ago(52), "da_giao",    days_ago(50), 500),
    (1, days_ago(45), "da_giao",    days_ago(43), 200),
    (2, days_ago(35), "da_giao",    days_ago(33), 100),
    (3, days_ago(25), "dang_giao",  None,         800),
    (4, days_ago(15), "chua_giao",  None,          50),
    (5, days_ago(8),  "chua_giao",  None,         300),
]

del_count = 0
for spo_idx, del_date, status, actual_date, qty in del_data:
    if spo_idx >= len(spo_ids):
        continue
    spo_id = spo_ids[spo_idx]
    prod = products[spo_idx % len(products)]
    unit_price = random.uniform(89_000, 8_500_000)
    amount = round(qty * unit_price, 0)

    n = execute("""
        INSERT INTO bqms_deliveries (samsung_po_id, po_date, product_id, bqms_code,
            specification, quantity, unit, unit_price, amount,
            recipient_name, receiving_warehouse, delivery_status, delivery_date,
            actual_delivered_at, actual_delivered_qty, country_origin)
        VALUES (%s,%s,%s,%s,%s,%s,'EA',%s,%s,%s,%s,%s::delivery_status,%s,%s,%s,'CN')
        ON CONFLICT DO NOTHING
    """, (spo_id, del_date, prod["id"], prod["bqms_code"], prod["specification"],
          qty, unit_price, amount,
          "Park Jisoo", "Kho Samsung SEV B1",
          status, del_date,
          actual_date, qty if actual_date else None))
    del_count += n

conn.commit()
print(f"  {del_count} delivery records")

# ---------------------------------------------------------------------------
# 21. Customs Declarations (3)
# ---------------------------------------------------------------------------
print("\n[21] Customs declarations (3)...")

customs_data = [
    ("HQSG-2026-001234", days_ago(55), "import", "Cuc HQ TPHCM", "Cong ty TNHH Song Chau", "0123456789", "Shenzhen Huawei Parts Co.", "CN", 28_500, 983_250_000, "cleared"),
    ("HQSG-2026-002345", days_ago(35), "import", "Cuc HQ TPHCM", "Cong ty TNHH Song Chau", "0123456789", "Shanghai Precision Components", "CN", 52_000, 1_794_000_000, "green"),
    ("HQSG-2026-003456", days_ago(12), "import", "Cuc HQ TPHCM", "Cong ty TNHH Song Chau", "0123456789", "Suzhou Industrial Parts", "CN", 38_000, 1_311_000_000, "submitted"),
]

cust_count = 0
for decl_num, decl_date, decl_type, office, importer, importer_tax, exporter, country, total_usd, total_vnd, status in customs_data:
    n = execute("""
        INSERT INTO customs_declarations (declaration_number, declaration_date, declaration_type,
            customs_office, importer_name, importer_tax_code, exporter_name, country_origin,
            total_value_usd, total_value_vnd, status, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::uuid)
        ON CONFLICT (declaration_number) DO NOTHING
    """, (decl_num, decl_date, decl_type, office, importer, importer_tax,
          exporter, country, total_usd, total_vnd, status, admin_id))
    cust_count += n

conn.commit()
print(f"  {cust_count} customs declarations")

# ---------------------------------------------------------------------------
# 22. RFQ Requests (5 internal)
# ---------------------------------------------------------------------------
print("\n[22] Internal RFQ requests (5)...")

rfq_req_data = [
    ("RFQ-INT-202603-001", "Bao gia nozzle CN020/030 Q2",       days_from_now(7),  "sent",     "bqms"),
    ("RFQ-INT-202603-002", "Bao gia feeder 8mm/12mm re-stock",   days_from_now(10), "received", "bqms"),
    ("RFQ-INT-202603-003", "Bao gia sensor Keyence + Omron",      days_from_now(5),  "selected", "bqms"),
    ("RFQ-INT-202603-004", "Bao gia servo motor 400W Panasonic",  days_from_now(14), "sent",     "bqms"),
    ("RFQ-INT-202603-005", "Bao gia PCB board Q2/2026",           days_from_now(3),  "draft",    "bqms"),
]

rfq_req_ids = []
for rfq_num, title, deadline, status, bsys in rfq_req_data:
    existing = fetchone("SELECT id FROM rfq_requests WHERE rfq_number = %s", (rfq_num,))
    if existing:
        rfq_req_ids.append(existing["id"])
        continue
    cur.execute("""
        INSERT INTO rfq_requests (rfq_number, title, deadline, status, business_system, created_by)
        VALUES (%s,%s,%s,%s,%s::business_system,%s::uuid)
        RETURNING id
    """, (rfq_num, title, deadline, status, bsys, procurement_id))
    row = cur.fetchone()
    if row:
        rfq_req_ids.append(row["id"])

conn.commit()

# RFQ line items
for i, rfq_id in enumerate(rfq_req_ids):
    existing = fetchall("SELECT id FROM rfq_line_items WHERE rfq_id = %s", (rfq_id,))
    if existing:
        continue
    for line_num in range(1, 3):
        prod = products[(i * 2 + line_num - 1) % len(products)]
        execute("""
            INSERT INTO rfq_line_items (rfq_id, product_id, product_code, product_name, specification, maker, quantity, unit)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, (rfq_id, prod["id"], prod["bqms_code"], prod["product_name"],
              prod["specification"], prod["maker"], random.choice([100, 200, 500]), prod["unit"] or "EA"))

# RFQ quotations
for i, rfq_id in enumerate(rfq_req_ids):
    existing = fetchall("SELECT id FROM rfq_quotations WHERE rfq_id = %s", (rfq_id,))
    if existing:
        continue
    for j in range(2):
        sup = suppliers[(i + j) % len(suppliers)]
        execute("""
            INSERT INTO rfq_quotations (rfq_id, supplier_id, unit_price, currency, lead_time_days, validity_date, is_selected)
            VALUES (%s,%s,%s,'RMB'::currency_code,%s,%s,%s)
        """, (rfq_id, sup["id"], round(random.uniform(100, 2000), 2),
              random.randint(7, 21), days_from_now(30), j == 0))

conn.commit()
print(f"  {len(rfq_req_ids)} RFQ requests with line items and quotations")

# ---------------------------------------------------------------------------
# 23. Budget Targets (6)
# ---------------------------------------------------------------------------
print("\n[23] Budget targets (6)...")

budget_data = [
    (2026, 1,  "revenue", "bqms", 3_500_000_000, 3_823_000_000),
    (2026, 2,  "revenue", "bqms", 3_800_000_000, 4_105_000_000),
    (2026, 3,  "revenue", "bqms", 4_000_000_000, None),
    (2026, 1,  "profit",  "bqms",   700_000_000,   812_000_000),
    (2026, 2,  "profit",  "bqms",   760_000_000,   895_000_000),
    (2026, 3,  "profit",  "bqms",   800_000_000,   None),
]

for fy, fm, ttype, bsys, target, actual in budget_data:
    execute("""
        INSERT INTO budget_targets (fiscal_year, fiscal_month, target_type, business_system,
            target_value, actual_value, currency, created_by)
        VALUES (%s,%s,%s,%s::business_system,%s,%s,'VND'::currency_code,%s::uuid)
        ON CONFLICT DO NOTHING
    """, (fy, fm, ttype, bsys, target, actual, admin_id))

conn.commit()
print("  6 budget targets")

# ---------------------------------------------------------------------------
# 24. Payment Requests (5)
# ---------------------------------------------------------------------------
print("\n[24] Payment requests (5)...")

pr_data = [
    (procurement_id, "Mua hang",    days_ago(20), "Chi tien mua nozzle lo thang 3",               380_000_000, "approved", "RMB"),
    (procurement_id, "Mua hang",    days_ago(10), "Chi coc PO-202603-000010 Shenzhen Huawei",     156_000_000, "pending",  "RMB"),
    (accountant_id,  "Ke toan",     days_ago(5),  "Tra no NCC Dongguan SMT Electronics",          148_000_000, "approved", "RMB"),
    (staff_ids[0] if staff_ids else admin_id, "Kinh doanh", days_ago(3), "Tam ung cong tac phi di Quang Dong", 15_000_000, "paid", "VND"),
    (warehouse_id,   "Kho van",     days_ago(1),  "Chi phi van chuyen + khai thue lo CN022",       12_500_000, "pending",  "VND"),
]

pr_count = 0
for requester_id, dept, req_date, desc, amount, status, currency in pr_data:
    n = execute("""
        INSERT INTO payment_requests (requester_id, department, request_date, description,
            amount, currency, status, payment_method)
        VALUES (%s::uuid,%s,%s,%s,%s,%s::currency_code,%s,'bank_transfer')
        ON CONFLICT DO NOTHING
    """, (requester_id, dept, req_date, desc, amount, currency, status))
    pr_count += n

conn.commit()
print(f"  {pr_count} payment requests")

# ---------------------------------------------------------------------------
# 25. Delivery Receipts (4)
# ---------------------------------------------------------------------------
print("\n[25] Delivery receipts (4)...")

dr_data = [
    ("DR-202601-001", sev_id, "Samsung Electronics Vietnam", so_ids[0] if so_ids else None, days_ago(50), "Park Jisoo", "0222-300-0001"),
    ("DR-202602-002", sev_id, "Samsung Electronics Vietnam", so_ids[1] if len(so_ids)>1 else None, days_ago(38), "Kim Minji", "0222-300-0002"),
    ("DR-202602-003", sev_id, "Samsung Electronics Vietnam", so_ids[2] if len(so_ids)>2 else None, days_ago(28), "Park Jisoo", "0222-300-0001"),
    ("DR-202603-004", customer_ids[1] if len(customer_ids)>1 else sev_id, "LG Innotek Vietnam", so_ids[5] if len(so_ids)>5 else None, days_ago(8), "Nguyen Van Duc", "0222-400-0001"),
]

dr_count = 0
for receipt_num, cust_id, cust_name, so_id, receipt_date, recv_name, recv_phone in dr_data:
    n = execute("""
        INSERT INTO delivery_receipts (receipt_number, customer_id, customer_name, sales_order_id,
            receipt_date, delivery_method, receiver_name, receiver_phone, total_items, created_by)
        VALUES (%s,%s,%s,%s,%s,'Xe tai cong ty',%s,%s,3,%s::uuid)
        ON CONFLICT (receipt_number) DO NOTHING
    """, (receipt_num, cust_id, cust_name, so_id, receipt_date, recv_name, recv_phone, admin_id))
    dr_count += n

conn.commit()
print(f"  {dr_count} delivery receipts")

# ---------------------------------------------------------------------------
# 26. Price History (15 entries)
# ---------------------------------------------------------------------------
print("\n[26] Price history (15 entries)...")

ph_count = 0
for i in range(15):
    prod = products[i % len(products)]
    sup = suppliers[i % len(suppliers)]
    po_id = po_ids[i % len(po_ids)] if po_ids else None
    price = round(random.uniform(80, 3000), 2)
    recorded_at = days_ago(random.randint(1, 90))
    n = execute("""
        INSERT INTO price_history (product_code, supplier_id, unit_price, currency, quantity, po_id, recorded_at)
        VALUES (%s,%s,%s,'RMB'::currency_code,%s,%s,%s)
        ON CONFLICT DO NOTHING
    """, (prod["bqms_code"], sup["id"], price, random.choice([100, 200, 500]), po_id, recorded_at))
    ph_count += n

conn.commit()
print(f"  {ph_count} price history entries")

# ---------------------------------------------------------------------------
# 27. IMV Module — inquiries + consolidated + POs (5 each)
# ---------------------------------------------------------------------------
print("\n[27] IMV module data...")

lg_id = customer_ids[1] if len(customer_ids) > 1 else sev_id

imv_inq_count = 0
for i in range(5):
    prod = products[25 + i]  # Use PCB/vision products
    sup = suppliers[i % len(suppliers)]
    inq_date = days_ago(random.randint(5, 60))
    cur.execute("""
        INSERT INTO imv_inquiries (customer_name, person_in_charge, person_in_charge_name,
            model, product_name, product_id, maker, inquiry_date,
            purchase_price, purchase_currency, selling_price, quantity,
            supplier_id, supplier_name, exchange_rate, notes, data_source)
        VALUES (%s,%s::uuid,%s,%s,%s,%s,%s,%s,%s,'RMB'::currency_code,%s,%s,%s,%s,%s,%s,'manual_seed')
        RETURNING id
    """, ("LG Innotek Vietnam", procurement_id, "Nguyen Thi Ngan",
          f"SM-{481+i}", prod["product_name"], prod["id"], prod["maker"],
          inq_date, round(random.uniform(200, 2000), 2),
          round(random.uniform(500_000, 5_000_000), 0),
          random.choice([100, 200, 500]),
          sup["id"], sup["name"], 3450.0,
          f"IMV inquiry mau {i+1}"))
    if cur.fetchone():
        imv_inq_count += 1

imv_po_count = 0
for i in range(5):
    prod = products[30 + i]
    sup = suppliers[i % len(suppliers)]
    po_date = days_ago(random.randint(10, 60))
    unit_price = round(random.uniform(300_000, 3_000_000), 0)
    qty = random.choice([50, 100, 200])
    amount = qty * unit_price
    execute("""
        INSERT INTO imv_purchase_orders (po_date, po_number, product_id, product_name,
            unit, requested_qty, unit_price, amount, total_amount,
            supplier_id, supplier_name, data_source)
        VALUES (%s,%s,%s,%s,'EA',%s,%s,%s,%s,%s,%s,'manual_seed')
        ON CONFLICT DO NOTHING
    """, (po_date, f"IMV-PO-2026-{i+1:04d}", prod["id"], prod["product_name"],
          qty, unit_price, amount, amount, sup["id"], sup["name"]))
    imv_po_count += 1

conn.commit()
print(f"  {imv_inq_count} IMV inquiries, {imv_po_count} IMV POs")

# ---------------------------------------------------------------------------
# 28. System Settings
# ---------------------------------------------------------------------------
print("\n[28] System settings...")

settings_data = [
    ("company_name",        json.dumps("Cong ty TNHH Song Chau"),          "string", "Ten cong ty"),
    ("default_currency",    json.dumps("VND"),                              "string", "Dong tien mac dinh"),
    ("vat_rate",            json.dumps(10),                                 "number", "Thue GTGT (%)"),
    ("po_approval_limit",   json.dumps(500_000_000),                        "number", "Nguong can phe duyet PO (VND)"),
    ("exchange_rate_source",json.dumps("manual"),                           "string", "Nguon ty gia"),
    ("smtp_from_email",     json.dumps("erp@songchau.vn"),                  "string", "Email gui thong bao"),
    ("bqms_sync_enabled",   json.dumps(True),                               "boolean","Bat dong bo BQMS"),
    ("stock_alert_enabled", json.dumps(True),                               "boolean","Bat canh bao ton kho"),
    ("fiscal_year_start",   json.dumps("01-01"),                            "string", "Ngay bat dau nam tai chinh"),
    ("max_session_hours",   json.dumps(8),                                  "number", "So gio phien dang nhap toi da"),
]

settings_count = 0
for key, val, stype, desc in settings_data:
    n = execute("""
        INSERT INTO system_settings (setting_key, setting_value, setting_type, description, updated_by)
        VALUES (%s,%s::jsonb,%s,%s,%s::uuid)
        ON CONFLICT (setting_key) DO NOTHING
    """, (key, val, stype, desc, admin_id))
    settings_count += n

conn.commit()
print(f"  {settings_count} system settings")

# ---------------------------------------------------------------------------
# 29. ETL Sync Log (5 entries)
# ---------------------------------------------------------------------------
print("\n[29] ETL sync log (5)...")

etl_data = [
    ("bqms_excel_import",  days_ago(7),  "success", 3, 2777, 0, 0),
    ("bqms_excel_import",  days_ago(14), "success", 2, 450,  12, 0),
    ("exchange_rate_sync", days_ago(1),  "success", 1, 5,    0, 0),
    ("inventory_import",   days_ago(3),  "success", 1, 50,   0, 0),
    ("bqms_excel_import",  days_ago(21), "success", 4, 620,  8, 2),
]

for sync_type, started, status, files, rows_ins, rows_upd, rows_skip in etl_data:
    execute("""
        INSERT INTO etl_sync_log (sync_type, started_at, completed_at, status,
            files_processed, rows_inserted, rows_updated, rows_skipped)
        VALUES (%s,%s,%s + interval '5 minutes',%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING
    """, (sync_type, started, started, status, files, rows_ins, rows_upd, rows_skip))

conn.commit()
print("  5 ETL sync log entries")

# ---------------------------------------------------------------------------
# 30. Tags
# ---------------------------------------------------------------------------
print("\n[30] Tags...")

tags_data = [
    ("urgent",       "#FF4444"),
    ("key-account",  "#4444FF"),
    ("samsung-sev",  "#1428A0"),
    ("china-supplier","#FF8C00"),
    ("nozzle",       "#44AA44"),
    ("feeder",       "#AA4444"),
    ("sensor",       "#4444AA"),
    ("motor",        "#AA44AA"),
]

tag_ids = {}
for tag_name, color in tags_data:
    execute("""
        INSERT INTO tags (tag_name, color, created_by)
        VALUES (%s,%s,%s::uuid)
        ON CONFLICT (tag_name) DO NOTHING
    """, (tag_name, color, admin_id))

conn.commit()
tag_rows = fetchall("SELECT id, tag_name FROM tags WHERE tag_name = ANY(%s)",
                    ([t[0] for t in tags_data],))
for r in tag_rows:
    tag_ids[r["tag_name"]] = r["id"]

# Tag some suppliers and products
if "samsung-sev" in tag_ids:
    execute("""
        INSERT INTO taggings (tag_id, ref_type, ref_id, created_by)
        VALUES (%s,'customers',%s,%s::uuid)
        ON CONFLICT ON CONSTRAINT uq_tagging DO NOTHING
    """, (tag_ids["samsung-sev"], sev_id, admin_id))

if "china-supplier" in tag_ids:
    for sup in suppliers[:5]:
        execute("""
            INSERT INTO taggings (tag_id, ref_type, ref_id, created_by)
            VALUES (%s,'suppliers',%s,%s::uuid)
            ON CONFLICT ON CONSTRAINT uq_tagging DO NOTHING
        """, (tag_ids["china-supplier"], sup["id"], admin_id))

if "urgent" in tag_ids and wf_ids:
    execute("""
        INSERT INTO taggings (tag_id, ref_type, ref_id, created_by)
        VALUES (%s,'workflow_instances',%s,%s::uuid)
        ON CONFLICT ON CONSTRAINT uq_tagging DO NOTHING
    """, (tag_ids["urgent"], wf_ids[0], admin_id))

conn.commit()
print(f"  {len(tag_ids)} tags with taggings")

# ---------------------------------------------------------------------------
# 31. BQMS Won Quotations (5)
# ---------------------------------------------------------------------------
print("\n[31] BQMS won quotations (5)...")

won_rfq_rows = fetchall(
    "SELECT id, rfq_number, bqms_code, specification, maker, person_in_charge_name FROM bqms_rfq WHERE result = 'won' LIMIT 5"
)
won_count = 0
for i, rfq in enumerate(won_rfq_rows[:5]):
    prod = products[i % len(products)]
    n = execute("""
        INSERT INTO bqms_won_quotations (rfq_id, rfq_number, bqms_code, product_id,
            person_in_charge_name, specification, quantity, unit, po_price,
            po_deadline, supplier_name, hs_code, leadtime_days, delivery_location)
        VALUES (%s,%s,%s,%s,%s,%s,%s,'EA',%s,%s,%s,'8466.94.90',14,'KCN Yen Phong, Bac Ninh')
        ON CONFLICT DO NOTHING
    """, (rfq["id"], rfq["rfq_number"], rfq["bqms_code"], prod["id"],
          rfq["person_in_charge_name"], rfq["specification"],
          random.choice([100, 200, 500]),
          round(random.uniform(89_000, 2_500_000), 0),
          days_from_now(random.randint(14, 45)),
          suppliers[i % len(suppliers)]["name"]))
    won_count += n

conn.commit()
print(f"  {won_count} won quotations")

# ---------------------------------------------------------------------------
# 32. BQMS RFQ Submissions (3)
# ---------------------------------------------------------------------------
print("\n[32] BQMS RFQ submissions (3)...")

sub_data = [
    ("QT26030001", days_ago(25), days_ago(20), sev_id, "submitted", 5),
    ("QT26030002", days_ago(15), days_ago(10), sev_id, "won",       8),
    ("QT26030003", days_ago(5),  days_from_now(2), sev_id, "draft", 3),
]

sub_ids = []
for rfq_num, sub_date, deadline, cust_id, status, items_count in sub_data:
    existing = fetchone("SELECT id FROM bqms_rfq_submissions WHERE rfq_number = %s", (rfq_num,))
    if existing:
        sub_ids.append(existing["id"])
        continue
    company_id = sc_company_id
    cur.execute("""
        INSERT INTO bqms_rfq_submissions (company_id, rfq_number, submission_date, deadline,
            customer_id, vendor_name, vendor_tax_code, status, items_count)
        VALUES (%s,%s,%s,%s,%s,'Cong ty TNHH Song Chau','0123456789',%s::quotation_status,%s)
        RETURNING id
    """, (company_id, rfq_num, sub_date, deadline, cust_id, status, items_count))
    row = cur.fetchone()
    if row:
        sub_ids.append(row["id"])

# Quotation items for first submission
if sub_ids:
    for line_num in range(1, 4):
        prod = products[line_num % len(products)]
        qty = random.choice([100, 200, 500])
        unit_price = round(random.uniform(300_000, 3_000_000), 0)
        execute("""
            INSERT INTO bqms_quotation_items (submission_id, line_number, product_id, bqms_code,
                specification, quantity, unit, unit_price, currency, amount, profit_margin_pct)
            VALUES (%s,%s,%s,%s,%s,%s,'EA',%s,'VND'::currency_code,%s,15.0)
            ON CONFLICT DO NOTHING
        """, (sub_ids[0], line_num, prod["id"], prod["bqms_code"], prod["specification"],
              qty, unit_price, qty * unit_price))

conn.commit()
print(f"  {len(sub_ids)} BQMS RFQ submissions")

# ---------------------------------------------------------------------------
# 33. BQMS Orders (5)
# ---------------------------------------------------------------------------
print("\n[33] BQMS orders (5)...")

border_statuses = ["confirmed", "in_production", "shipped", "delivered", "closed"]
bord_count = 0
for i in range(5):
    prod = products[i % len(products)]
    rfq_rows = fetchall("SELECT id, rfq_number FROM bqms_rfq WHERE result = 'won' LIMIT 1 OFFSET %s", (i,))
    rfq_id = rfq_rows[0]["id"] if rfq_rows else None
    rfq_num = rfq_rows[0]["rfq_number"] if rfq_rows else f"QT26030{i+1:03d}"
    n = execute("""
        INSERT INTO bqms_orders (rfq_id, rfq_number, product_id, bqms_code, specification,
            customer_id, customer_name, expected_qty, order_qty, unit,
            order_date, validity_date, status, delivered_qty)
        VALUES (%s,%s,%s,%s,%s,%s,'Samsung Electronics Vietnam',%s,%s,'EA',%s,%s,%s,%s)
        ON CONFLICT DO NOTHING
    """, (rfq_id, rfq_num, prod["id"], prod["bqms_code"], prod["specification"],
          sev_id, random.choice([100,200,500]), random.choice([100,200,500]),
          days_ago(random.randint(10, 60)),
          days_from_now(random.randint(7, 30)),
          border_statuses[i],
          random.choice([0, 50, 100, 200]) if i < 3 else random.choice([100, 200, 500])))
    bord_count += n

conn.commit()
print(f"  {bord_count} BQMS orders")

# ---------------------------------------------------------------------------
# Final commit and summary
# ---------------------------------------------------------------------------
conn.commit()

print("\n" + "=" * 65)
print("TONG KET SEED DU LIEU MAU v2")
print("=" * 65)
summary = [
    ("companies",            len(companies)),
    ("suppliers",            len(supplier_ids)),
    ("customers",            len(customer_ids)),
    ("products (SMT parts)", len(product_ids)),
    ("inventory",            inv_count),
    ("exchange_rates",       er_count),
    ("cash_book_categories", len(cat_map)),
    ("purchase_orders",      len(po_ids)),
    ("po_line_items",        li_count),
    ("sales_orders",         len(so_ids)),
    ("revenue_invoices",     len(rev_ids)),
    ("accounts_receivable",  len(ar_ids)),
    ("accounts_payable",     len(ap_ids)),
    ("cash_book",            cb_count),
    ("workflow_instances",   len(wf_ids)),
    ("tasks",                task_count),
    ("notifications",        notif_count),
    ("bqms_samsung_po",      len(spo_ids)),
    ("bqms_deliveries",      del_count),
    ("customs_declarations", cust_count),
    ("rfq_requests",         len(rfq_req_ids)),
    ("budget_targets",       6),
    ("payment_requests",     pr_count),
    ("delivery_receipts",    dr_count),
    ("price_history",        ph_count),
    ("system_settings",      settings_count),
    ("tags",                 len(tag_ids)),
    ("bqms_rfq_submissions", len(sub_ids)),
]

total_rows = 0
for table, count in summary:
    print(f"  {table:<30s}: {count:>5d} records")
    total_rows += count

print("-" * 65)
print(f"  {'TONG CONG':<30s}: {total_rows:>5d} records")
print("=" * 65)
print("\n[DONE] Seed du lieu thanh cong!")
print("       Chay: docker exec sc-api python scripts/seed_sample_data_v2.py")

cur.close()
conn.close()
