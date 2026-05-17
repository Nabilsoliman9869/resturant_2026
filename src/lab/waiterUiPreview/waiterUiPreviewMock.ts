export type PreviewCategory = { id: string; name: string; emoji: string };
export type PreviewProduct = {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  prepMin?: number;
};
export type PreviewCartLine = {
  id: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  seatNo: number | null;
};

export const PREVIEW_TABLE = { id: "t12", name: "طاولة 12", guests: 4 };

export const PREVIEW_CATEGORIES: PreviewCategory[] = [
  { id: "all", name: "الكل", emoji: "◎" },
  { id: "grill", name: "مشويات", emoji: "🥩" },
  { id: "app", name: "مقبلات", emoji: "🥗" },
  { id: "main", name: "أطباق", emoji: "🍽" },
  { id: "drink", name: "مشروبات", emoji: "🥤" },
  { id: "dessert", name: "حلويات", emoji: "🍰" },
];

export const PREVIEW_PRODUCTS: PreviewProduct[] = [
  { id: "p1", categoryId: "grill", name: "كباب لحم", price: 185, prepMin: 18 },
  { id: "p2", categoryId: "grill", name: "شيش طاووق", price: 165, prepMin: 16 },
  { id: "p3", categoryId: "grill", name: "ريش غنم", price: 220, prepMin: 22 },
  { id: "p4", categoryId: "app", name: "حمص باللحمة", price: 55, prepMin: 8 },
  { id: "p5", categoryId: "app", name: "فتوش", price: 42, prepMin: 6 },
  { id: "p6", categoryId: "main", name: "منسف أردني", price: 195, prepMin: 20 },
  { id: "p7", categoryId: "main", name: "ملوخية بالدجاج", price: 88, prepMin: 14 },
  { id: "p8", categoryId: "drink", name: "عصير برتقال", price: 28, prepMin: 3 },
  { id: "p9", categoryId: "drink", name: "مياه كبيرة", price: 12, prepMin: 1 },
  { id: "p10", categoryId: "drink", name: "قهوة تركي", price: 18, prepMin: 5 },
  { id: "p11", categoryId: "dessert", name: "كنافة", price: 45, prepMin: 10 },
  { id: "p12", categoryId: "dessert", name: "آيس كريم", price: 32, prepMin: 4 },
];

export const PREVIEW_SEATS = [
  { no: 0, label: "عام" },
  { no: 1, label: "أحمد" },
  { no: 2, label: "سارة" },
  { no: 3, label: "ضيف ٣" },
  { no: 4, label: "ضيف ٤" },
];
