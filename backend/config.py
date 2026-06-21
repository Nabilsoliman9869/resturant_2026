"""
إعدادات الاتصال بقاعدة البيانات
Database Connection Settings
"""
import json

# Fallback defaults (only used if settings.json is missing).
# Keep localhost so accidental runs never hit a remote production server.
SERVER = '127.0.0.1,1433'
DATABASE = 'Mat3amLocal'
USERNAME = 'sa'
PASSWORD = ''
USE_WINDOWS_AUTH = True  # Prefer Windows Auth for local dev fallback

# إعدادات الاتصال القديمة (للاختبار المحلي)
# SERVER = 'localhost'
# DATABASE = 'ACCA'
# USE_WINDOWS_AUTH = True

# إعدادات EInvoiceCLI (الفاتورة الإلكترونية)
EINVOICE_CLI_PATH = r"D:\تشغيل فاتورة الكترونية وايصال\new\EInvoiceCLI.exe"
EINVOICE_COMP_ID = "44be1330-ceed-457d-8253-37d274d743c9"  # معرف الشركة
EINVOICE_CLIENT_SECRET = "8465addf-3592-489f-b9d9-c373b8441534"  # Client Secret
EINVOICE_TOKEN_PIN = "11112222"  # PIN للتوقيع
EINVOICE_ENVIRONMENT_PROD = True  # True للإنتاج، False للاختبار

def get_connection_string():
    """إنشاء سلسلة الاتصال"""
    if USE_WINDOWS_AUTH:
        return f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};Trusted_Connection=yes;'
    else:
        return f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};UID={USERNAME};PWD={PASSWORD};'

def get_connection_string_driver13():
    """إنشاء سلسلة الاتصال مع Driver 13"""
    if USE_WINDOWS_AUTH:
        return f'DRIVER={{ODBC Driver 13 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};Trusted_Connection=yes;'
    else:
        return f'DRIVER={{ODBC Driver 13 for SQL Server}};SERVER={SERVER};DATABASE={DATABASE};UID={USERNAME};PWD={PASSWORD};'

def get_einvoice_myserver():
    """إنشاء سلسلة الاتصال لقاعدة البيانات لـ EInvoiceCLI (بصيغة Connection String)"""
    if USE_WINDOWS_AUTH:
        return f'Data Source={SERVER};Initial Catalog={DATABASE};Integrated Security=True;Connect Timeout=120'
    else:
        return f'Data Source={SERVER};User ID={USERNAME};Password={PASSWORD};Initial Catalog={DATABASE};Connect Timeout=120'

def create_einvoice_settings_json():
    """إنشاء محتوى settings.json لـ EInvoiceCLI"""
    settings = {
        "server": "https://api.preprod.invoicing.eta.gov.eg" if not EINVOICE_ENVIRONMENT_PROD else "https://api.invoicing.eta.gov.eg",
        "idSrvBaseURL": "https://id.eta.gov.eg",
        "apiBaseURL": "https://api.preprod.invoicing.eta.gov.eg" if not EINVOICE_ENVIRONMENT_PROD else "https://api.invoicing.eta.gov.eg",
        "id_srv_base_url": "https://id.eta.gov.eg/connect/token",
        "myserver": get_einvoice_myserver(),
        "clientId": EINVOICE_COMP_ID,
        "client_id_comp": EINVOICE_COMP_ID,
        "compID": EINVOICE_COMP_ID,
        "ClientSecret": EINVOICE_CLIENT_SECRET,
        "client_secret_comp": EINVOICE_CLIENT_SECRET,
        "Issuer_ClintSecret_1": EINVOICE_CLIENT_SECRET,
        "token_pin": EINVOICE_TOKEN_PIN,
        "TokenPin": EINVOICE_TOKEN_PIN,
        "token_type": "Egypt Trust Sealing CA",
        "EnvironmentProd": EINVOICE_ENVIRONMENT_PROD,
        "DocumentTypeVersion": "1.0"
    }
    
    return json.dumps(settings, indent=2, ensure_ascii=False)
