/*
  إدراج مجموعات نقاط البيع (TBL015) بدون تكرار — عند غياب الاسم فقط.
  ربط MainAccountGuide بحساب العملاء في TBL004 حيث:
    AccountName ∈ (N'العملاء', N'الزبائن')
    OR LOWER(LatinName) ∈ ('customer', 'customers')

  تنفيذ يدوي على SQL Server بعد مراجعة/use القاعدة المناسبة:
    -- USE [YourDb];
*/

SET NOCOUNT ON;

DECLARE @MainAccountGuide uniqueidentifier;

SELECT TOP (1) @MainAccountGuide = CardGuide
FROM dbo.TBL004
WHERE RTRIM(LTRIM(ISNULL(AccountName, N''))) IN (N'العملاء', N'الزبائن')
   OR LOWER(RTRIM(LTRIM(ISNULL(LatinName, N'')))) IN (N'customer', N'customers')
ORDER BY ID;

IF @MainAccountGuide IS NULL
BEGIN
  RAISERROR(N'لم يُعثر على حساب عملاء في TBL004 (العملاء / الزبائن أو LatinName=customer). أضف الحساب ثم أعد التشغيل.', 16, 1);
  RETURN;
END

DECLARE @names TABLE (
  GroupName   nvarchar(255) NOT NULL PRIMARY KEY,
  LatinName   nvarchar(255) NOT NULL
);

INSERT INTO @names (GroupName, LatinName) VALUES
  (N'عملاء الصالة',     N'Hall dining customers'),
  (N'عملاء الدليفري',   N'Delivery customers'),
  (N'عملاء المواقع',    N'Site / channel customers'),
  (N'عملاء السفاري',    N'Takeaway customers');

DECLARE @gn nvarchar(255), @ln nvarchar(255);
DECLARE @RowGuid uniqueidentifier;

DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT GroupName, LatinName FROM @names;

OPEN c;
FETCH NEXT FROM c INTO @gn, @ln;

WHILE @@FETCH_STATUS = 0
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dbo.TBL015
    WHERE RTRIM(LTRIM(ISNULL(GroupName, N''))) = RTRIM(LTRIM(@gn))
  )
  BEGIN
    SET @RowGuid = NEWID();
    INSERT INTO dbo.TBL015 (
      CardGuide,
      MainGuide,
      RelatedAgent,
      MainAccountGuide,
      MainTaxAccountGuide,
      UnifiedAccountGuide,
      DefaultPayType,
      GroupName,
      Security,
      LatinName,
      Notes,
      CardImage,
      ByUser,
      ByGroup
    )
    VALUES (
      @RowGuid,
      NULL,
      NULL,
      @MainAccountGuide,
      NULL,
      NULL,
      -1,
      @gn,
      1,
      @ln,
      NULL,
      NULL,
      NULL,
      NULL
    );
  END
  ELSE
  BEGIN
    /* تعبئة الحساب المحاسبي فقط إذا كان فارغاً — دون مسح اسم لاتيني أدخل يدوياً */
    UPDATE dbo.TBL015
    SET MainAccountGuide = @MainAccountGuide
    WHERE RTRIM(LTRIM(ISNULL(GroupName, N''))) = RTRIM(LTRIM(@gn))
      AND MainAccountGuide IS NULL;
  END

  FETCH NEXT FROM c INTO @gn, @ln;
END

CLOSE c;
DEALLOCATE c;

SELECT GroupName, CardGuide, MainAccountGuide, LatinName
FROM dbo.TBL015
WHERE GroupName IN (N'عملاء الصالة', N'عملاء الدليفري', N'عملاء المواقع', N'عملاء السفاري')
ORDER BY GroupName;
