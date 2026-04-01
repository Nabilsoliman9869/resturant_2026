"""
ثوابت النظام - جمعية المحاسبين
Constants for Accountants Association System
"""

# ========== أنواع المتعاملين (Agent Groups) ==========
# من جدول TBL015

AGENT_GROUP_MEMBERS = "أعضاء المحاسبين"  # الأهم - القوام الأساسي
AGENT_GROUP_FOLLOWERS = "التابعين"  # تحت التدريب
AGENT_GROUP_OFFICES = "المكاتب"  # مكاتب محاسبية
AGENT_GROUP_COURSE_SUBSCRIBERS = "مشتركي دورات"  # مشتركين في دورات
AGENT_GROUP_CASH_CUSTOMERS = "عملاء نقديين"  # يدفعون نقداً

# ========== أنواع الحوافظ المالية (Invoice Types) ==========
# من جدول TBL020

INVOICE_TYPE_MEMBERS_SUBSCRIPTION = "حافظة توريد أعضاء وزملاء"
INVOICE_TYPE_FOLLOWERS_SUBSCRIPTION = "حافظة توريد تابعين"
INVOICE_TYPE_OFFICES_SUBSCRIPTION = "حافظة توريد مكاتب"
INVOICE_TYPE_COURSE_SUBSCRIPTION = "حافظة توريد مشتركي دورات"

# ========== طرق الدفع (Payment Methods) ==========
# القيم المستخدمة في TBL022.PayMethod

PAYMENT_METHOD_CASH = 0  # نقدي
PAYMENT_METHOD_CARDS = 1  # بطاقات مصرفية
PAYMENT_METHOD_CHEQUE = 2  # شيك
PAYMENT_METHOD_DEFERRED = 3  # آجل
PAYMENT_METHOD_BANK_MISR = 4  # بنك مصر
PAYMENT_METHOD_CASH_PAYMENT = 5  # دفع نقدي
PAYMENT_METHOD_SUPER_CASH = 6  # سوبر كاش

# قاموس طرق الدفع (للتحويل من نص إلى رقم)
PAYMENT_METHOD_MAP = {
    'نقدي': PAYMENT_METHOD_CASH,
    'بطاقات مصرفيه': PAYMENT_METHOD_CARDS,
    'شيك': PAYMENT_METHOD_CHEQUE,
    'آجل': PAYMENT_METHOD_DEFERRED,
    'بنك مصر': PAYMENT_METHOD_BANK_MISR,
    'دفع نقدي': PAYMENT_METHOD_CASH_PAYMENT,
    'سوبر كاش': PAYMENT_METHOD_SUPER_CASH
}

# قاموس عكسي (للتحويل من رقم إلى نص)
PAYMENT_METHOD_REVERSE_MAP = {
    PAYMENT_METHOD_CASH: 'نقدي',
    PAYMENT_METHOD_CARDS: 'بطاقات مصرفيه',
    PAYMENT_METHOD_CHEQUE: 'شيك',
    PAYMENT_METHOD_DEFERRED: 'آجل',
    PAYMENT_METHOD_BANK_MISR: 'بنك مصر',
    PAYMENT_METHOD_CASH_PAYMENT: 'دفع نقدي',
    PAYMENT_METHOD_SUPER_CASH: 'سوبر كاش'
}

# ========== أنواع الفواتير ==========
# Invoice vs Receipt

INVOICE_TYPE_INVOICE = "فاتورة"  # Invoice - للعملاء ذوي الرقم الضريبي
INVOICE_TYPE_RECEIPT = "إيصال"  # Receipt - للعملاء بدون رقم ضريبي

# ========== حالة الربط (Lock Relations) ==========
# في TBL022.LockRelations

LOCK_RELATIONS_UNLOCKED = 0  # غير مرتبط (متاح للربط)
LOCK_RELATIONS_LOCKED = 1  # مرتبط (تم الربط)

# ========== حالة النشاط (Not Active) ==========
# في TBL016.NotActive و TBL007.NotActive

ACTIVE = 0  # نشط
INACTIVE = 1  # غير نشط

# ========== مجموعات المنتجات/الخدمات ==========
# من جدول TBL006

PRODUCT_GROUP_SERVICES_25 = "خدمات 25"  # المستخدم من الخدمات السارية في الجمعية

# ========== رسائل التحذير ==========

WARNING_TAX_CODE_EXISTS = "⚠️ انتبه: العضو له رقم ضريبي - لابد أن تنشأ له فاتورة وليس إيصال"
WARNING_PAYING_FOR_FOLLOWERS = "⚠️ هذا المكتب/العضو يسدد عن منتسبيه - سيتم إظهار بيان المنتسبين"

# ========== فترات الاستعراض ==========

INVOICE_EDIT_WINDOW_DAYS = 7  # عدد الأيام لعرض الفواتير القابلة للتعديل (أسبوع)

# ========== الموردين (Suppliers) ==========
# يتم استبعادهم من قائمة العملاء

SUPPLIER_GUID = '26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500'  # GUID الموردين

# ========== جداول السندات (إكسترا) ==========
# السندات = TBL009 + TBL010 + TBL011 + TBL012 + TBL038

VOUCHER_TABLES = ("TBL009", "TBL010", "TBL011", "TBL012", "TBL038")

# ========== الحقول المهمة في الجداول ==========

# TBL016 - العملاء
FIELD_AGENT_CARD_GUIDE = "CardGuide"
FIELD_AGENT_NAME = "AgentName"
FIELD_AGENT_MAIN_GROUP_GUIDE = "MainGroupGuide"
FIELD_AGENT_TAX_CODE = "TaxCode"
FIELD_AGENT_CARD_NUMBER = "CardNumber"
FIELD_AGENT_ACCOUNT_ID = "AccountID"
FIELD_AGENT_MAIN_AGENT = "MainAgent"  # للتابعين - العضو/المكتب الذي يتبعونه
FIELD_AGENT_NOT_ACTIVE = "NotActive"

# TBL022 - رؤوس الفواتير
FIELD_INVOICE_CARD_GUIDE = "CardGuide"
FIELD_INVOICE_MAIN_GUIDE = "MainGuide"  # نوع الفاتورة/الإيصال
FIELD_INVOICE_BILL_NUMBER = "BillNumber"
FIELD_INVOICE_BILL_DATE = "BillDate"
FIELD_INVOICE_AGENT_GUIDE = "AgentGuide"
FIELD_INVOICE_NOTES = "Notes"  # يتم حفظ التعديلات هنا
FIELD_INVOICE_LOCK_RELATIONS = "LockRelations"
FIELD_INVOICE_PAID = "Paid"
FIELD_INVOICE_PAY_METHOD = "PayMethod"

# TBL023 - أصناف الفواتير
FIELD_INVOICE_ITEM_MAIN_GUIDE = "MainGuide"  # المعرف الفريد للفاتورة
FIELD_INVOICE_ITEM_PRODUCT_GUIDE = "ProductGuide"
FIELD_INVOICE_ITEM_QUANTITY = "Quantity"
FIELD_INVOICE_ITEM_UNIT = "Unit"
FIELD_INVOICE_ITEM_TOTAL_VALUE = "TotalValue"
FIELD_INVOICE_ITEM_RELATED_AGENT = "RelatedAgent"

# TBL007 - المنتجات/الخدمات
FIELD_PRODUCT_CARD_GUIDE = "CardGuide"
FIELD_PRODUCT_NAME = "ProductName"
FIELD_PRODUCT_GROUP_GUID = "GroupGuid"
FIELD_PRODUCT_PRICE = "AgentPrice"
FIELD_PRODUCT_NOT_ACTIVE = "NotActive"

# TBL015 - مجموعات العملاء
FIELD_GROUP_CARD_GUIDE = "CardGuide"
FIELD_GROUP_NAME = "GroupName"

# TBL020 - أنواع الفواتير
FIELD_INVOICE_TYPE_CARD_GUIDE = "CardGuide"
FIELD_INVOICE_TYPE_NAME = "InvoiceName"
FIELD_INVOICE_TYPE_FIELDS = "Fields"

# ========== الاستعلامات المهمة ==========

# جلب الحوافظ غير المرتبطة
QUERY_UNLOCKED_INVOICES = """
SELECT TBL022.*, TBL016.AgentName, TBL016.TaxCode, TBL016.CardNumber
FROM TBL022
LEFT JOIN TBL016 ON TBL016.CardGuide = TBL022.AgentGuide
WHERE TBL022.MainGuide = ?
  AND (TBL022.LockRelations = 0 OR TBL022.LockRelations IS NULL)
ORDER BY TBL022.BillDate DESC
"""

# التحقق من وجود رقم ضريبي
QUERY_CHECK_TAX_CODE = """
SELECT TaxCode
FROM TBL016
WHERE CardGuide = ?
  AND TaxCode IS NOT NULL
  AND TaxCode <> ''
"""

# جلب المنتسبين (التابعين)
QUERY_GET_FOLLOWERS = """
SELECT CardGuide, AgentName, IDNumber, Birthdate, TextValue2, LatinName
FROM TBL016
WHERE MainAgent = ?
  AND NotActive = 0
ORDER BY AgentName
"""

# جلب الفواتير الصادرة خلال فترة معينة
QUERY_INVOICES_BY_DATE_RANGE = """
SELECT TBL022.*, TBL016.AgentName, TBL016.CardNumber
FROM TBL022
LEFT JOIN TBL016 ON TBL016.CardGuide = TBL022.AgentGuide
WHERE TBL022.BillDate >= ?
  AND TBL022.BillDate <= ?
ORDER BY TBL022.BillDate DESC
"""

# جلب الفواتير الصادرة خلال أسبوع (للتعديل)
QUERY_INVOICES_LAST_WEEK = """
SELECT TBL022.*, TBL016.AgentName, TBL016.CardNumber
FROM TBL022
LEFT JOIN TBL016 ON TBL016.CardGuide = TBL022.AgentGuide
WHERE TBL022.BillDate >= DATEADD(day, -?, GETDATE())
  AND TBL022.InsertedIn >= DATEADD(day, -?, GETDATE())
ORDER BY TBL022.BillDate DESC
"""

# ========== دوال مساعدة ==========

def has_tax_code(agent_data: dict) -> bool:
    """التحقق من وجود رقم ضريبي للعميل"""
    tax_code = agent_data.get(FIELD_AGENT_TAX_CODE)
    return tax_code is not None and tax_code.strip() != ''

def is_paying_for_followers(agent_data: dict) -> bool:
    """التحقق إذا كان المكتب/العضو يسدد عن منتسبيه"""
    # يمكن التحقق من وجود تابعين مرتبطين به
    main_agent = agent_data.get(FIELD_AGENT_MAIN_AGENT)
    return main_agent is not None

def should_create_invoice(agent_data: dict) -> bool:
    """تحديد إذا كان يجب إنشاء فاتورة (Invoice) أو إيصال (Receipt)"""
    # إذا كان للعميل رقم ضريبي → فاتورة
    # إذا لم يكن له رقم ضريبي → إيصال
    return has_tax_code(agent_data)

def get_payment_method_code(payment_method_name: str) -> int:
    """تحويل اسم طريقة الدفع إلى رقم"""
    return PAYMENT_METHOD_MAP.get(payment_method_name, PAYMENT_METHOD_CASH)

def get_payment_method_name(payment_method_code: int) -> str:
    """تحويل رقم طريقة الدفع إلى اسم"""
    return PAYMENT_METHOD_REVERSE_MAP.get(payment_method_code, 'نقدي')

def is_unlocked_invoice(invoice_data: dict) -> bool:
    """التحقق إذا كانت الفاتورة غير مرتبطة (متاحة للربط)"""
    lock_relations = invoice_data.get(FIELD_INVOICE_LOCK_RELATIONS)
    return lock_relations == LOCK_RELATIONS_UNLOCKED or lock_relations is None
