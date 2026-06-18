import json
import sys
import urllib.request
from typing import Iterable


BASE_URL = "http://127.0.0.1:2288"


def make_item(group_id: str, sort_order: int, item: str | tuple[str, str] | tuple[str, str, float]) -> dict:
    if isinstance(item, tuple):
        if len(item) == 3:
            name_ar, name_en, price_delta = item
        else:
            name_ar, name_en = item
            price_delta = 0.0
    else:
        name_ar = item
        name_en = item
        price_delta = 0.0
    return {
        "itemId": f"{group_id}_{sort_order}",
        "nameAr": str(name_ar),
        "nameEn": str(name_en),
        "priceDelta": float(price_delta),
        "sortOrder": sort_order,
    }


def make_group(
    group_id: str,
    name_ar: str,
    name_en: str,
    group_type: str,
    items: Iterable[str | tuple[str, str] | tuple[str, str, float]],
    *,
    min_select: int = 0,
    max_select: int = 1,
    is_required: bool = False,
    free_text_label: str | None = None,
    free_text_placeholder: str | None = None,
    free_text_max_length: int = 180,
) -> dict:
    return {
        "groupId": group_id,
        "nameAr": name_ar,
        "nameEn": name_en,
        "type": group_type,
        "minSelect": min_select,
        "maxSelect": max_select,
        "isRequired": is_required,
        "sortOrder": 0,
        "allowFreeText": True,
        "freeTextRequired": False,
        "freeTextLabel": free_text_label or f"مواصفات {name_ar}",
        "freeTextPlaceholder": free_text_placeholder or f"اكتب أي مواصفات إضافية تخص {name_ar}",
        "freeTextMaxLength": free_text_max_length,
        "items": [make_item(group_id, idx + 1, item) for idx, item in enumerate(items)],
    }


NEW_GROUPS = [
    make_group(
        "meat_cooking_level",
        "درجة السواء - اللحوم",
        "Meat Cooking Level",
        "cooking",
        ["Rare", "Medium Rare", "Medium", "Medium Well", "Well Done"],
        min_select=1,
        max_select=1,
        is_required=True,
        free_text_label="مواصفات درجة السواء - اللحوم",
        free_text_placeholder="مثال: بين Medium و Medium Well",
    ),
    make_group(
        "meat_side_1",
        "الطبق الجانبي الأول - اللحوم",
        "Meat Side Dish 1",
        "choice",
        ["بطاطس فرنش فرايز", "بطاطس ويدجز", "أرز أبيض", "أرز بسمتي", "خضار سوتيه", "مكرونة"],
        min_select=1,
        max_select=1,
        is_required=True,
    ),
    make_group(
        "meat_side_2",
        "الطبق الجانبي الثاني - اللحوم",
        "Meat Side Dish 2",
        "choice",
        ["سلطة خضراء", "شوربة اليوم", "كول سلو", "خضار سوتيه", "بدون"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "meat_sauce",
        "الصوص - اللحوم",
        "Meat Sauce",
        "choice",
        ["مشروم", "بيبر", "جريفي", "BBQ", "ديمي جلاس", "بدون صوص"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "meat_addons",
        "إضافات - اللحوم",
        "Meat Add-ons",
        "addon",
        [
            ("جبنة شيدر", "Cheddar Cheese", 0.0),
            ("إكسترا مشروم", "Extra Mushroom", 0.0),
            ("بيض", "Egg", 0.0),
            ("أفوكادو", "Avocado", 0.0),
            ("بيكون", "Bacon", 0.0),
            ("إكسترا فرايز", "Extra Fries", 0.0),
        ],
        min_select=0,
        max_select=6,
    ),
    make_group(
        "meat_exclusions",
        "استبعادات - اللحوم",
        "Meat Exclusions",
        "exclusion",
        ["بدون بصل", "بدون ثوم", "بدون ملح", "بدون فلفل", "بدون زبدة"],
        min_select=0,
        max_select=5,
    ),
    make_group(
        "chicken_seasoning_level",
        "مستوى التتبيل - الدجاج",
        "Chicken Seasoning Level",
        "choice",
        ["عادي", "سبايسي", "إكسترا سبايسي"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "chicken_side_1",
        "الطبق الجانبي الأول - الدجاج",
        "Chicken Side Dish 1",
        "choice",
        ["أرز", "بطاطس", "مكرونة", "خضار"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "chicken_side_2",
        "الطبق الجانبي الثاني - الدجاج",
        "Chicken Side Dish 2",
        "choice",
        ["سلطة", "شوربة", "كول سلو", "بدون"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "chicken_sauce",
        "الصوص - الدجاج",
        "Chicken Sauce",
        "choice",
        ["ثاوزند آيلاند", "رانش", "هاني ماسترد", "باربيكيو", "جارليك"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "chicken_addons",
        "إضافات - الدجاج",
        "Chicken Add-ons",
        "addon",
        ["جبنة شيدر", "جبنة موتزاريلا", "إكسترا تشيكن", "إكسترا صوص"],
        min_select=0,
        max_select=4,
    ),
    make_group(
        "chicken_exclusions",
        "استبعادات - الدجاج",
        "Chicken Exclusions",
        "exclusion",
        ["بدون خس", "بدون طماطم", "بدون بصل", "بدون مايونيز"],
        min_select=0,
        max_select=4,
    ),
    make_group(
        "pizza_dough_type",
        "نوع العجين - البيتزا",
        "Pizza Dough Type",
        "choice",
        ["رفيع Thin", "إيطالي", "سميك Pan", "ستافد كراست"],
        min_select=1,
        max_select=1,
        is_required=True,
    ),
    make_group(
        "pizza_size",
        "الحجم - البيتزا",
        "Pizza Size",
        "choice",
        ["Small", "Medium", "Large", "Family"],
        min_select=1,
        max_select=1,
        is_required=True,
    ),
    make_group(
        "pizza_cheese_type",
        "نوع الجبن - البيتزا",
        "Pizza Cheese Type",
        "choice",
        ["عادي", "إكسترا موتزاريلا", "شيدر", "ميكس جبن"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "pizza_addons",
        "إضافات - البيتزا",
        "Pizza Add-ons",
        "addon",
        ["زيتون", "مشروم", "بيبروني", "سجق", "بسطرمة", "ذرة", "فلفل ألوان", "دجاج", "لحم مفروم", "أنشوجة"],
        min_select=0,
        max_select=10,
    ),
    make_group(
        "pizza_exclusions",
        "استبعادات - البيتزا",
        "Pizza Exclusions",
        "exclusion",
        ["بدون زيتون", "بدون بصل", "بدون مشروم", "بدون جبنة"],
        min_select=0,
        max_select=4,
    ),
    make_group(
        "pizza_cutting",
        "تقطيع البيتزا",
        "Pizza Cutting",
        "choice",
        ["4 قطع", "6 قطع", "8 قطع", "12 قطعة"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "fatayer_fat_type",
        "نوع الدهن - الفطائر",
        "Fatayer Fat Type",
        "choice",
        ["سمن بلدي", "زبدة", "زيت", "بدون دهن إضافي"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "fatayer_bake_level",
        "درجة التسوية - الفطائر",
        "Fatayer Bake Level",
        "choice",
        ["عادي", "محمرة زيادة", "خفيفة"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "fatayer_addons",
        "إضافات - الفطائر",
        "Fatayer Add-ons",
        "addon",
        ["جبنة", "عسل", "عسل أسود", "طحينة", "مكسرات"],
        min_select=0,
        max_select=5,
    ),
    make_group(
        "fatayer_exclusions",
        "استبعادات - الفطائر",
        "Fatayer Exclusions",
        "exclusion",
        ["بدون سمسم", "بدون سكر"],
        min_select=0,
        max_select=2,
    ),
    make_group(
        "hot_drink_sugar_level",
        "السكر - المشروبات الساخنة",
        "Hot Drink Sugar Level",
        "choice",
        ["سادة", "على الريحة", "مظبوط", "زيادة", "زيادة جدًا"],
        min_select=1,
        max_select=1,
        is_required=True,
    ),
    make_group(
        "hot_drink_sugar_type",
        "نوع السكر - المشروبات الساخنة",
        "Hot Drink Sugar Type",
        "choice",
        ["أبيض", "دايت", "بني"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "coffee_strength",
        "درجة القوة - القهوة",
        "Coffee Strength",
        "choice",
        ["خفيف", "وسط", "تقيل"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "tea_strength",
        "درجة القوة - الشاي",
        "Tea Strength",
        "choice",
        ["خفيف", "مظبوط", "تقيل"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "hot_drink_addons",
        "إضافات - المشروبات الساخنة",
        "Hot Drink Add-ons",
        "addon",
        ["حليب", "كريمة", "قرفة", "هيل", "شيكولاتة", "فانيليا"],
        min_select=0,
        max_select=6,
    ),
    make_group(
        "hot_drink_notes",
        "ملاحظات - المشروبات الساخنة",
        "Hot Drink Notes",
        "kitchen_note",
        ["بدون وش", "سخن جدًا", "دافئ"],
        min_select=0,
        max_select=3,
    ),
    make_group(
        "juice_sugar_level",
        "السكر - العصائر والكوكتيل",
        "Juice Sugar Level",
        "choice",
        ["بدون", "قليل", "مظبوط", "زيادة"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "juice_ice_level",
        "الثلج - العصائر والكوكتيل",
        "Juice Ice Level",
        "choice",
        ["بدون ثلج", "قليل", "عادي", "زيادة"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "juice_addons",
        "إضافات - العصائر والكوكتيل",
        "Juice Add-ons",
        "addon",
        ["آيس كريم", "عسل", "كريمة", "مكسرات"],
        min_select=0,
        max_select=4,
    ),
    make_group(
        "salad_dressing",
        "الدريسنج - السلطات",
        "Salad Dressing",
        "choice",
        ["رانش", "سيزر", "إيطالي", "ثاوزند آيلاند", "بدون"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "salad_addons",
        "إضافات - السلطات",
        "Salad Add-ons",
        "addon",
        ["دجاج", "تونة", "جبنة فيتا", "جبنة بارميزان"],
        min_select=0,
        max_select=4,
    ),
    make_group(
        "salad_exclusions",
        "استبعادات - السلطات",
        "Salad Exclusions",
        "exclusion",
        ["بدون بصل", "بدون طماطم", "بدون خيار"],
        min_select=0,
        max_select=3,
    ),
    make_group(
        "dessert_serving_temperature",
        "طريقة التقديم - الحلويات",
        "Dessert Serving Temperature",
        "choice",
        ["ساخن", "بارد", "دافئ"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "dessert_addons",
        "إضافات - الحلويات",
        "Dessert Add-ons",
        "addon",
        ["آيس كريم", "صوص شيكولاتة", "كراميل", "مكسرات", "كريمة"],
        min_select=0,
        max_select=5,
    ),
    make_group(
        "shisha_flavor",
        "المعسل - الشيشة",
        "Shisha Flavor",
        "choice",
        ["تفاحتين", "عنب", "نعناع", "بلوبيري", "ميكس"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "shisha_head",
        "الرأس - الشيشة",
        "Shisha Head",
        "choice",
        ["عادي", "تفاحتين خاص", "فواكه"],
        min_select=0,
        max_select=1,
    ),
    make_group(
        "shisha_addons",
        "إضافات - الشيشة",
        "Shisha Add-ons",
        "addon",
        ["Ice Hose", "خرطوم جديد"],
        min_select=0,
        max_select=2,
    ),
]


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def put_json(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else BASE_URL
    groups_url = f"{base.rstrip('/')}/api/restaurant/modifier-groups"
    current = get_json(groups_url)
    existing_groups = current.get("groups") if isinstance(current, dict) else []
    if not isinstance(existing_groups, list):
        existing_groups = []

    existing_ids = {str(g.get("groupId") or "").strip() for g in existing_groups if isinstance(g, dict)}
    max_sort = max([int(g.get("sortOrder") or 0) for g in existing_groups if isinstance(g, dict)] or [0])

    appended = []
    for idx, group in enumerate(NEW_GROUPS, start=1):
        if group["groupId"] in existing_ids:
            continue
        entry = dict(group)
        entry["sortOrder"] = max_sort + idx
        appended.append(entry)

    merged = list(existing_groups) + appended
    result = put_json(groups_url, {"groups": merged})
    result_groups = result.get("groups") if isinstance(result, dict) else []
    print(
        json.dumps(
            {
                "ok": True,
                "existingBefore": len(existing_groups),
                "addedNow": len(appended),
                "totalAfter": len(result_groups) if isinstance(result_groups, list) else len(merged),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
