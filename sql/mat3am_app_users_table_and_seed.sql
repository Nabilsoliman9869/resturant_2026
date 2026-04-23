-- ============================================================
-- مطاعم XTRA: جدول مستخدمي التطبيق + قيم افتراضية (يدوي في SSMS)
-- نفّذ على نفس قاعدة البيانات المعرّفة في config/settings.json
-- يكافئ منطق MAT3AM_BOOTSTRAP_DEFAULT_USERS في backend/api_server.py
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.MAT3AM_APP_USERS', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MAT3AM_APP_USERS (
        Id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        LoginName NVARCHAR(100) NOT NULL,
        PinHash NVARCHAR(256) NULL,
        RoleCode NVARCHAR(20) NOT NULL,
        DisplayName NVARCHAR(200) NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- الرمز في PinHash يُخزَّن كنص يطابق ما يُرسل من شاشة الدخول (ليس hash تشفيري حالياً)
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'cashier')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'cashier', N'1001', N'cashier', N'كاشير 1', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'accountant')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'accountant', N'2001', N'accountant', N'محاسب 1', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'manager')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'manager', N'3001', N'manager', N'مدير 1', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'developer')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'developer', N'9001', N'developer', N'مطوّر', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'host')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'host', N'123', N'host', N'جارسون الاستقبال', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'waiter')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'waiter', N'123', N'waiter', N'جارسون الطلبات', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'kitchen')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'kitchen', N'123', N'kitchen', N'المطبخ', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'speed')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'speed', N'123', N'speed_order', N'الطلبات السريعة', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'server')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'server', N'123', N'server', N'جارسون المناولة', 1, SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.MAT3AM_APP_USERS WHERE LoginName = N'kids')
    INSERT INTO dbo.MAT3AM_APP_USERS (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
    VALUES (NEWID(), N'kids', N'123', N'kids_guard', N'كيدز إيريا', 1, SYSUTCDATETIME());
GO

SELECT LoginName, RoleCode, DisplayName, IsActive FROM dbo.MAT3AM_APP_USERS ORDER BY LoginName;
