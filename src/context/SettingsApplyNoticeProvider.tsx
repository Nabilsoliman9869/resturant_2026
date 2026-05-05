import { useEffect, useState, type ReactNode } from "react";
import { registerSettingsRestartNotifier } from "../lib/settingsRestartNotice";

/** بعد حفظ الإعدادات: تذكير بإعادة تحميل الواجهة لتطبيق التغيير بثقة وتقليل إعادة التحقق عند كل طلبية. */
export function SettingsApplyNoticeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    registerSettingsRestartNotifier(() => setOpen(true));
    return () => registerSettingsRestartNotifier(null);
  }, []);

  if (!open) return <>{children}</>;

  return (
    <>
      {children}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-restart-title"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100002,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily: "var(--font)",
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div
          className="card"
          style={{
            maxWidth: 480,
            width: "100%",
            padding: "1.25rem 1.35rem",
            borderRadius: 14,
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h2 id="settings-restart-title" style={{ marginTop: 0, fontFamily: "var(--display)", fontSize: "1.35rem" }}>
            تطبيق الإعدادات
          </h2>
          <p style={{ margin: "0 0 0.75rem", lineHeight: 1.65, color: "var(--text)" }}>
            تم حفظ التغييرات. لضمان تطبيق المنيو وسياسات نقطة البيع والمسارات وغيرها على كل الشاشات والجلسات، يُنصح{" "}
            <strong>بإعادة تحميل النظام الآن</strong> (صفحة واحدة)، بدل اعتماد التحقق الخلفي من الإعدادات عند كل عملية.
          </p>
          <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.55 }}>
            الخادوم يبقى شغّالًا؛ «إعادة التحميل» تعني تحديث الواجهة في المتصفح أو تطبيقك الحالي فقط.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", justifyContent: "flex-start" }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              إعادة تحميل الآن
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              متابعة بدون تحميل
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
