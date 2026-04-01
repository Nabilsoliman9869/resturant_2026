"""
تهيئة قاعدة بيانات CONCREET_STATION
ينشئ القاعدة والجداول الأساسية لمحطة الخرسانة
الاتصال: . (سيرفر محلي)، sa، 123
"""
import pyodbc
import json
import os
import uuid

# قراءة الإعدادات
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_settings_path = os.path.join(_root, "config", "settings.json")
if os.path.exists(_settings_path):
    with open(_settings_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    SERVER = (cfg.get("server") or ".").strip()
    PORT = cfg.get("port", 1433)
    DB = (cfg.get("database") or "CONCREET_STATION").strip()
    UID = (cfg.get("uid") or "sa").strip()
    PWD = cfg.get("password") or ""
else:
    SERVER, PORT, DB, UID, PWD = ".", 1477, "CONCREET_STATION", "sa", "123"

_server = f"{SERVER},{PORT}" if PORT and str(PORT).strip() else SERVER
_conn_str = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={_server};DATABASE=master;UID={UID};PWD={PWD};"

def run():
    print("=" * 60)
    print("تهيئة قاعدة بيانات محطة الخرسانة — CONCREET_STATION")
    print("=" * 60)
    print(f"السيرفر: {_server}")
    print(f"قاعدة البيانات: {DB}")
    print()

    # 1) إنشاء القاعدة إن لم تكن موجودة
    try:
        conn = pyodbc.connect(_conn_str, autocommit=True)
        cur = conn.cursor()
        cur.execute(f"""
        IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'{DB}')
        CREATE DATABASE [{DB}]
        """)
        cur.close()
        conn.close()
        print(f"[OK] قاعدة البيانات {DB} جاهزة")
    except Exception as e:
        print(f"[ERR] فشل إنشاء القاعدة: {e}")
        return

    # 2) الاتصال بالقاعدة وإنشاء الجداول
    _conn_db = _conn_str.replace("DATABASE=master", f"DATABASE={DB}")
    try:
        conn = pyodbc.connect(_conn_db, autocommit=False)
        cur = conn.cursor()
    except Exception as e:
        print(f"[ERR] فشل الاتصال: {e}")
        return

    tables = []

    # TBL004 — دليل الحسابات
    tables.append(("TBL004", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL004')
    CREATE TABLE TBL004 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        NotActive bit NULL,
        CardCode nvarchar(100) NULL,
        AccountName nvarchar(255) NULL,
        MainAccount uniqueidentifier NULL,
        LatinName nvarchar(255) NULL,
        TaxCode nvarchar(50) NULL,
        Security tinyint NULL,
        Notes nvarchar(max) NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL005 — مراكز الكلفة / عربيات الخلط
    tables.append(("TBL005", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL005')
    CREATE TABLE TBL005 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        NotActive bit NULL,
        CostCenter nvarchar(255) NULL,
        LatinName nvarchar(255) NULL,
        CardType tinyint NULL,
        Notes nvarchar(max) NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL006 — مجموعات المنتجات
    tables.append(("TBL006", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL006')
    CREATE TABLE TBL006 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        MainGuide uniqueidentifier NULL,
        GroupName nvarchar(255) NULL,
        LatinName nvarchar(255) NULL,
        Notes nvarchar(max) NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL007 — المنتجات (الخلطات)
    tables.append(("TBL007", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL007')
    CREATE TABLE TBL007 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        CardCode nvarchar(100) NULL,
        ProductName nvarchar(255) NULL,
        LatinName nvarchar(255) NULL,
        GroupGuid uniqueidentifier NULL,
        AgentPrice float NULL,
        NotActive bit NULL DEFAULT 0,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL008 — المستودعات
    tables.append(("TBL008", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL008')
    CREATE TABLE TBL008 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        WarehouseName nvarchar(255) NULL,
        LatinName nvarchar(255) NULL,
        NotActive bit NULL,
        Notes nvarchar(max) NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL015 — مجموعات العملاء
    tables.append(("TBL015", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL015')
    CREATE TABLE TBL015 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        GroupName nvarchar(255) NULL,
        MainGroupGuide uniqueidentifier NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL016 — العملاء
    tables.append(("TBL016", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL016')
    CREATE TABLE TBL016 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        AgentName nvarchar(255) NULL,
        CardNumber int NULL,
        MainGroupGuide uniqueidentifier NULL,
        AccountID uniqueidentifier NULL,
        Phone nvarchar(50) NULL,
        Mobile nvarchar(50) NULL,
        FullAdress nvarchar(500) NULL,
        TaxCode nvarchar(50) NULL,
        NotActive bit NULL DEFAULT 0,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL020 — أنواع الفواتير
    tables.append(("TBL020", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL020')
    CREATE TABLE TBL020 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        InvoiceName nvarchar(255) NULL,
        LatinName nvarchar(255) NULL,
        Fields nvarchar(max) NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL022 — رؤوس الفواتير
    tables.append(("TBL022", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL022')
    CREATE TABLE TBL022 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL,
        MainGuide uniqueidentifier NULL,
        BillNumber int NULL,
        BillDate datetime NULL,
        DoneIn datetime NULL,
        AgentGuide uniqueidentifier NULL,
        Project uniqueidentifier NULL,
        CostCenter uniqueidentifier NULL,
        Notes nvarchar(max) NULL,
        Discount float NULL,
        TaxValue float NULL,
        LocalAdministrativeTax float NULL,
        LockRelations bit NULL,
        InsertedIn datetime NULL,
        Paid float NULL,
        PayMethod int NULL,
        SourceBill uniqueidentifier NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # TBL023 — تفاصيل الفواتير
    tables.append(("TBL023", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL023')
    CREATE TABLE TBL023 (
        ID int IDENTITY(1,1),
        MainGuide uniqueidentifier NULL,
        ProductGuide uniqueidentifier NULL,
        Quantity float NULL,
        Unit tinyint NULL,
        TotalValue float NULL,
        InsertedIn datetime NULL,
        RelatedAgent uniqueidentifier NULL,
        SourceBill uniqueidentifier NULL,
        PRIMARY KEY (ID)
    )
    """))

    # TBL049 — المشاريع
    tables.append(("TBL049", """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TBL049')
    CREATE TABLE TBL049 (
        ID int IDENTITY(1,1),
        CardGuide uniqueidentifier NOT NULL DEFAULT newid(),
        ProjectName nvarchar(255) NULL,
        PRIMARY KEY (CardGuide)
    )
    """))

    # MAT3AM_APP_USERS — مستخدمو واجهة المطعم
    tables.append(("MAT3AM_APP_USERS", """
    IF OBJECT_ID(N'dbo.MAT3AM_APP_USERS', N'U') IS NULL
    CREATE TABLE dbo.MAT3AM_APP_USERS (
        Id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        LoginName NVARCHAR(100) NOT NULL,
        PinHash NVARCHAR(256) NULL,
        RoleCode NVARCHAR(20) NOT NULL,
        DisplayName NVARCHAR(200) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
    """))

    # MAT3AM_ERROR_LOG — سجل أخطاء التطبيق
    tables.append(("MAT3AM_ERROR_LOG", """
    IF OBJECT_ID(N'dbo.MAT3AM_ERROR_LOG', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_ERROR_LOG (
            Id BIGINT IDENTITY(1,1) PRIMARY KEY,
            ErrorAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            LevelCode NVARCHAR(20) NOT NULL DEFAULT N'ERROR',
            SourceName NVARCHAR(100) NULL,
            RoleCode NVARCHAR(20) NULL,
            UserName NVARCHAR(200) NULL,
            RoutePath NVARCHAR(500) NULL,
            Message NVARCHAR(MAX) NULL,
            StackTrace NVARCHAR(MAX) NULL,
            PayloadJson NVARCHAR(MAX) NULL,
            ClientTime NVARCHAR(64) NULL
        );
        CREATE INDEX IX_MAT3AM_ERROR_LOG_ErrorAt ON dbo.MAT3AM_ERROR_LOG(ErrorAt DESC);
    END
    """))

    # MAT3AM_AUDIT_LOG — سجل تدقيق العمليات الإدارية
    tables.append(("MAT3AM_AUDIT_LOG", """
    IF OBJECT_ID(N'dbo.MAT3AM_AUDIT_LOG', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_AUDIT_LOG (
            Id BIGINT IDENTITY(1,1) PRIMARY KEY,
            ActionCode NVARCHAR(80) NOT NULL,
            EntityName NVARCHAR(80) NOT NULL,
            EntityId NVARCHAR(100) NULL,
            ActorName NVARCHAR(200) NULL,
            Details NVARCHAR(1000) NULL,
            LoggedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IX_MAT3AM_AUDIT_LOG_LoggedAt ON dbo.MAT3AM_AUDIT_LOG(LoggedAt DESC);
    END
    """))

    # MAT3AM_RECIPE_HDR — رأس وصفة المنتج النهائي
    tables.append(("MAT3AM_RECIPE_HDR", """
    IF OBJECT_ID(N'dbo.MAT3AM_RECIPE_HDR', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_RECIPE_HDR (
            RecipeGuid UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
            ProductGuide UNIQUEIDENTIFIER NULL,
            ProductName NVARCHAR(255) NOT NULL,
            SalePrice FLOAT NOT NULL DEFAULT 0,
            OverheadPercent FLOAT NOT NULL DEFAULT 0,
            AdminShareValue FLOAT NOT NULL DEFAULT 0,
            IsActive BIT NOT NULL DEFAULT 1,
            UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IX_MAT3AM_RECIPE_HDR_ProductGuide ON dbo.MAT3AM_RECIPE_HDR(ProductGuide);
    END
    """))

    # MAT3AM_RECIPE_LINE — تفاصيل المكونات الخام
    tables.append(("MAT3AM_RECIPE_LINE", """
    IF OBJECT_ID(N'dbo.MAT3AM_RECIPE_LINE', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_RECIPE_LINE (
            Id BIGINT IDENTITY(1,1) PRIMARY KEY,
            RecipeGuid UNIQUEIDENTIFIER NOT NULL,
            ComponentProductGuide UNIQUEIDENTIFIER NULL,
            ComponentName NVARCHAR(255) NOT NULL,
            Quantity FLOAT NOT NULL DEFAULT 0,
            UnitCode NVARCHAR(20) NOT NULL DEFAULT N'EA',
            UnitCost FLOAT NOT NULL DEFAULT 0
        );
        CREATE INDEX IX_MAT3AM_RECIPE_LINE_RecipeGuid ON dbo.MAT3AM_RECIPE_LINE(RecipeGuid);
    END
    """))

    # MAT3AM_STOCK_MOVEMENT — حركة مخزون داخل/خارج
    tables.append(("MAT3AM_STOCK_MOVEMENT", """
    IF OBJECT_ID(N'dbo.MAT3AM_STOCK_MOVEMENT', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_STOCK_MOVEMENT (
            Id BIGINT IDENTITY(1,1) PRIMARY KEY,
            MovementAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            MovementType NVARCHAR(30) NOT NULL,
            ReferenceId NVARCHAR(64) NULL,
            InvoiceGuid UNIQUEIDENTIFIER NULL,
            InvoiceTypeGuid UNIQUEIDENTIFIER NULL,
            WarehouseGuid UNIQUEIDENTIFIER NULL,
            ProductGuide UNIQUEIDENTIFIER NULL,
            ItemName NVARCHAR(255) NOT NULL,
            QtyIn FLOAT NOT NULL DEFAULT 0,
            QtyOut FLOAT NOT NULL DEFAULT 0,
            UnitCode NVARCHAR(20) NULL,
            UnitCost FLOAT NOT NULL DEFAULT 0,
            TotalCost FLOAT NOT NULL DEFAULT 0,
            Notes NVARCHAR(500) NULL
        );
        CREATE INDEX IX_MAT3AM_STOCK_MOVEMENT_ProductGuide ON dbo.MAT3AM_STOCK_MOVEMENT(ProductGuide);
        CREATE INDEX IX_MAT3AM_STOCK_MOVEMENT_MovementAt ON dbo.MAT3AM_STOCK_MOVEMENT(MovementAt DESC);
    END
    """))

    # MAT3AM_POS_POLICY — سياسة الضرائب والخدمة
    tables.append(("MAT3AM_POS_POLICY", """
    IF OBJECT_ID(N'dbo.MAT3AM_POS_POLICY', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_POS_POLICY (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            IsActive BIT NOT NULL DEFAULT 1,
            ServicePercent FLOAT NOT NULL DEFAULT 12,
            VatPercent FLOAT NOT NULL DEFAULT 14,
            ApplyDiscountBeforeTax BIT NOT NULL DEFAULT 1,
            ServiceBeforeVat BIT NOT NULL DEFAULT 1,
            UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    END
    """))

    # MAT3AM_PROMOTION — محرك العروض
    tables.append(("MAT3AM_PROMOTION", """
    IF OBJECT_ID(N'dbo.MAT3AM_PROMOTION', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MAT3AM_PROMOTION (
            Id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
            PromoName NVARCHAR(200) NOT NULL,
            PromoType NVARCHAR(40) NOT NULL,
            PriorityNo INT NOT NULL DEFAULT 100,
            IsActive BIT NOT NULL DEFAULT 1,
            IsStackable BIT NOT NULL DEFAULT 1,
            StartAt DATETIME2 NULL,
            EndAt DATETIME2 NULL,
            BranchGuid UNIQUEIDENTIFIER NULL,
            ScopeType NVARCHAR(20) NULL,
            PayloadJson NVARCHAR(MAX) NULL,
            Notes NVARCHAR(500) NULL,
            UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IX_MAT3AM_PROMOTION_Active ON dbo.MAT3AM_PROMOTION(IsActive, PriorityNo);
    END
    """))

    for name, sql in tables:
        try:
            cur.execute(sql)
            conn.commit()
            print(f"  [OK] {name}")
        except Exception as e:
            print(f"  [SKIP/ERR] {name}: {e}")
            conn.rollback()

    # 3) إدراج بيانات افتراضية
    print("\nإدراج بيانات افتراضية...")

    # نوع فاتورة توريد خرسانة
    try:
        cur.execute("SELECT COUNT(*) FROM TBL020")
        if cur.fetchone()[0] == 0:
            g = str(uuid.uuid4()).upper()
            cur.execute("""
            INSERT INTO TBL020 (CardGuide, InvoiceName, LatinName)
            VALUES (?, ?, ?)
            """, (g, 'فاتورة توريد خرسانة', 'Concrete Supply Invoice'))
            conn.commit()
            print(f"  [OK] نوع فاتورة توريد خرسانة (TBL020): {g}")
    except Exception as e:
        print(f"  [SKIP] TBL020: {e}")
        conn.rollback()

    # مجموعة خلطات
    try:
        cur.execute("SELECT COUNT(*) FROM TBL006")
        if cur.fetchone()[0] == 0:
            g = str(uuid.uuid4()).upper()
            cur.execute("""
            INSERT INTO TBL006 (CardGuide, GroupName)
            VALUES (?, ?)
            """, (g, 'خلطات خرسانية'))
            conn.commit()
            print(f"  [OK] مجموعة خلطات (TBL006): {g}")
    except Exception as e:
        conn.rollback()

    # خلطات افتراضية
    try:
        cur.execute("SELECT COUNT(*) FROM TBL007")
        if cur.fetchone()[0] == 0:
            cur.execute("SELECT TOP 1 CardGuide FROM TBL006")
            row = cur.fetchone()
            grp = row[0] if row else None
            mixes = [
                ('خرسانة عادية C20', 280),
                ('خرسانة مسلحة C30', 320),
                ('خرسانة عالية المقاومة C40', 380),
            ]
            for name, price in mixes:
                g = str(uuid.uuid4()).upper()
                cur.execute(
                    "INSERT INTO TBL007 (CardGuide, ProductName, AgentPrice, GroupGuid, NotActive) VALUES (?, ?, ?, ?, 0)",
                    (g, name, price, grp)
                )
            conn.commit()
            print(f"  [OK] {len(mixes)} خلطات افتراضية (TBL007)")
    except Exception as e:
        print(f"  [SKIP] TBL007: {e}")
        conn.rollback()

    # سياسة POS افتراضية (12% خدمة + 14% VAT)
    try:
        cur.execute("SELECT COUNT(*) FROM dbo.MAT3AM_POS_POLICY")
        if cur.fetchone()[0] == 0:
            cur.execute("""
            INSERT INTO dbo.MAT3AM_POS_POLICY
            (IsActive, ServicePercent, VatPercent, ApplyDiscountBeforeTax, ServiceBeforeVat)
            VALUES (1, 12, 14, 1, 1)
            """)
            conn.commit()
            print("  [OK] سياسة POS الافتراضية (خدمة 12% + VAT 14%)")
    except Exception as e:
        print(f"  [SKIP] MAT3AM_POS_POLICY: {e}")
        conn.rollback()

    # عروض افتراضية للمطعم (Promotions Engine)
    try:
        cur.execute("SELECT COUNT(*) FROM dbo.MAT3AM_PROMOTION")
        if cur.fetchone()[0] == 0:
            default_promos = [
                {
                    "name": "خصم فاتورة 10% عند 500",
                    "type": "percent_invoice",
                    "priority": 100,
                    "stack": 1,
                    "scope": "invoice",
                    "payload": json.dumps({"percent": 10, "minSubtotal": 500}, ensure_ascii=False),
                    "notes": "خصم تلقائي على إجمالي الفاتورة عند تجاوز 500"
                },
                {
                    "name": "هابي آور 15% (4-6 مساء)",
                    "type": "happy_hour",
                    "priority": 120,
                    "stack": 1,
                    "scope": "invoice",
                    "payload": json.dumps({"percent": 15, "from": "16:00", "to": "18:00"}, ensure_ascii=False),
                    "notes": "خصم وقتي خلال هابي آور"
                },
                {
                    "name": "كوبون WELCOME10",
                    "type": "coupon",
                    "priority": 130,
                    "stack": 0,
                    "scope": "invoice",
                    "payload": json.dumps({"code": "WELCOME10", "percent": 10}, ensure_ascii=False),
                    "notes": "خصم بكود ترويجي"
                },
            ]
            for p in default_promos:
                cur.execute("""
                INSERT INTO dbo.MAT3AM_PROMOTION
                (Id, PromoName, PromoType, PriorityNo, IsActive, IsStackable, ScopeType, PayloadJson, Notes, UpdatedAt)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, SYSUTCDATETIME())
                """, (
                    str(uuid.uuid4()).upper(),
                    p["name"],
                    p["type"],
                    p["priority"],
                    p["stack"],
                    p["scope"],
                    p["payload"],
                    p["notes"],
                ))
            conn.commit()
            print(f"  [OK] تم إدراج {len(default_promos)} عروض افتراضية")
    except Exception as e:
        print(f"  [SKIP] MAT3AM_PROMOTION: {e}")
        conn.rollback()

    # مستخدمون افتراضيون للدخول الموحد (اسم مستخدم + رمز)
    # — يجب أن تبقى القائمة مطابقة لـ MAT3AM_BOOTSTRAP_DEFAULT_USERS في api_server.py (حزمة التهيئة / bootstrap)
    try:
        cur.execute("SELECT COUNT(*) FROM dbo.MAT3AM_APP_USERS")
        if cur.fetchone()[0] == 0:
            default_users = [
                ("cashier", "1001", "cashier", "كاشير 1"),
                ("accountant", "2001", "accountant", "محاسب 1"),
                ("manager", "3001", "manager", "مدير 1"),
                ("developer", "9001", "developer", "مطوّر"),
                ("host", "123", "host", "جارسون الاستقبال"),
                ("waiter", "123", "waiter", "جارسون الطلبات"),
                ("kitchen", "123", "kitchen", "المطبخ"),
                ("server", "123", "server", "جارسون المناولة"),
            ]
            for login_name, pin, role_code, display_name in default_users:
                cur.execute("""
                INSERT INTO dbo.MAT3AM_APP_USERS
                (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
                VALUES (?, ?, ?, ?, ?, 1, SYSUTCDATETIME())
                """, (
                    str(uuid.uuid4()).upper(),
                    login_name,
                    pin,
                    role_code,
                    display_name,
                ))
            conn.commit()
            print(f"  [OK] تم إدراج {len(default_users)} مستخدمين افتراضيين")
    except Exception as e:
        print(f"  [SKIP] MAT3AM_APP_USERS defaults: {e}")
        conn.rollback()

    cur.close()
    conn.close()
    print("\n" + "=" * 60)
    print("اكتمل التهيئة.")
    print("=" * 60)

if __name__ == "__main__":
    run()
