import type { SessionUser } from "../auth/AuthContext";

/** يُرسل مع طلبات المطعم لمسار الصلاحيات والتدقيق (يثق بالعميل حتى يُضاف JWT لاحقاً). */
export function buildMat3amActor(user: SessionUser | null | undefined): { id: string; login: string; name: string; role: string } | undefined {
  if (!user?.id) return undefined;
  return {
    id: String(user.id),
    login: String(user.login || "").trim(),
    name: String(user.name || "").trim(),
    role: String(user.role || "").trim().toLowerCase(),
  };
}
