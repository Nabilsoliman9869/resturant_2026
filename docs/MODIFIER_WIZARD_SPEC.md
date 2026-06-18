# مواصفات Modifier Wizard — مطعم أويا

## الهدف
إضافة "تدفق إضافات موجّه" (Guided Modifier Workflow) كبديل عن شاشة الإضافات المسطحة الحالية.

## الوضعان (Mode)
1. **وضع العادي** — الصنف + إضافات مسطحة (الكود الحالي).
2. **وضع المعالج** — شاشة كاملة تبني الطبق خطوة بخطوة (مفضّل لأويا).

---

## بنية البيانات

### 1. ModifierGroup
```
- groupId: string (مثلاً GROUP_SIDE_1)
- nameAr: string
- nameEn: string
- type: "choice" | "addon" | "exclusion" | "kitchen_note" | "cooking"
- minSelect: number
- maxSelect: number
- isRequired: boolean
- sortOrder: number
- items: ModifierItem[]
```

### 2. ModifierItem
```
- itemId: string
- nameAr: string
- nameEn: string
- priceDelta: number (0 للإجباري، +15 للإضافة)
- sortOrder: number
```

### 3. ProductModifierLink
```
- productGuide: string (من TBL007)
- groupId: string
- sortOrder: number (ترتيب المجموعات لهذا المنتج)
```

---

## تدفق المعالج (Wizard Flow)

```
Category
    ↓
Item (مثلاً: بانيه دجاج)
    ↓
Modifier Flow (بالترتيب)
    ├─ Side 1 (Required, min=1, max=1)
    ├─ Side 2 (Required, min=1, max=1)
    ├─ Cooking (Conditional, min=1, max=1)
    ├─ Sauce (Optional, min=0, max=1)
    ├─ Add-ons (Optional, min=0, max=5)
    ├─ Exclusions (Optional, min=0, max=N)
    └─ Kitchen Notes (Optional, text + quick buttons)
    ↓
Submit (إضافة للطلب)
```

### قواعد الاختيار
- **Choice (إجباري)**: min=1, max=1 — يجب اختيار واحد فقط.
- **Choice (متعدد)**: min=1, max=2 — يجب اختيار واحد على الأقل.
- **Add-on**: min=0, max=5 — اختياري.
- **Exclusion**: min=0, max=N — اختياري.
- **Cooking**: min=1, max=1 — إجباري إذا كان اللحم.

### زر "التالي"
- لا يُمكن الضغط على "التالي" إلا بعد تحقيق `minSelect`.
- يُعرض عداد `selected / maxSelect`.

### زر "إضافة للطلب"
- في آخر خطوة، أو عبر زر دائم.
- يُنشئ `CartLine` مع:
  - `productGuide`, `productName`, `basePrice`
  - `modifiers: { groupId, selectedItemIds, notes }[]`
  - `totalPrice = basePrice + sum(priceDelta)`

---

## واجهة الإعدادات (RestaurantOpsSettings)

قسم جديد: **"كيفية اختيار الأصناف عند الكابتن"**

- radio button:
  - [ ] وضع العادي (إضافات مسطحة)
  - [ ] وضع المعالج (تدفق موجّه)

---

## API Endpoints المطلوبة

```
GET  /api/restaurant/modifier-groups           → list all groups
POST /api/restaurant/modifier-groups           → create group
PUT  /api/restaurant/modifier-groups/{id}      → update group
DELETE /api/restaurant/modifier-groups/{id}    → delete group

GET  /api/restaurant/product-modifiers/{guide}  → groups linked to product
PUT  /api/restaurant/product-modifiers/{guide} → link groups to product
```

---

## ملاحظات تنفيذية

1. **لا نُعدّل TBL007** — نستخدم `MAT3AM_RESTAURANT_STATE` (JSON) لتخزين المجموعات والروابط.
2. ** backwards compatible** — إذا لم يكن للمنتج روابط، يُستخدم الوضع العادي.
3. **الإضافات المدفوعة** — `priceDelta` تُضاف للسعر الأساسي.
4. **Kitchen Notes** — قائمة سريعة: "سبايسي"، "قليل الزيت"، "للأطفال"، "طبق منفصل" + حقل نص حر.
5. **Exclusions** — تُطبع في تذكرة المطبخ كـ "NO X".

---

## المراحل

| # | المرحلة | الملفات |
|---|---------|---------|
| 1 | نموذج البيانات + API backend | `api_server.py` |
| 2 | إعدادات الوضع + إدارة المجموعات | `RestaurantOpsSettingsPage.tsx` |
| 3 | مكوّن المعالج (Wizard) | `WaiterOrderPage.tsx` + ملف جديد |
| 4 | ربط المعالج بالسلة | `WaiterOrderPage.tsx` |
| 5 | طباعة التعديلات في التذكرة | `CashierInvoicesLocalPage.tsx` |
| 6 | بناء EXE واختبار | `BuildTool.bat` |

---
*تاريخ الإنشاء: 2026-06-11*
