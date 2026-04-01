export default function DeveloperInitDb() {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>تهيئة الجداول والبروسيجرات</h2>
      <p style={{ color: "var(--muted)" }}>
        تم نقل التنفيذ المباشر إلى نافذة <strong>اتصال القاعدة</strong> بزر <strong>تنفيذ التهيئة</strong>.
        هذه الصفحة مرجعية فقط لملفات SQL الإضافية.
      </p>
      <ul style={{ color: "var(--muted)" }}>
        <li>
          <code>POST /api/dev/bootstrap</code> — <strong>حزمة التهيئة</strong>: جداول الدعم (MAT3AM_*) + إن كان{" "}
          <code>MAT3AM_APP_USERS</code> فارغاً يُدرَج مستخدمون تجريبيون (مثل <code>cashier</code>/<code>1001</code>،{" "}
          <code>developer</code>/<code>9001</code>، جرسون <code>123</code>). الرد يتضمن{" "}
          <code>defaultAppUsersInserted</code> و<code>defaultAppUsersSpec</code>.
        </li>
        <li>
          <code>sql/mat3am_app_users_table_and_seed.sql</code> — تشغيل مباشر في SSMS: إنشاء <code>dbo.MAT3AM_APP_USERS</code>{" "}
          وإدراج المستخدمين التجريبيين إن لم يكونوا موجودين
        </li>
        <li>
          سكربتات إكسترا الرسمية تبقى من <code>Jobs Builder\Default.xml</code> عند إنشاء القاعدة
        </li>
      </ul>
    </div>
  );
}
