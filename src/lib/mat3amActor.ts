import type { SessionUser } from "../auth/AuthContext";
import { repairArabicDisplayText } from "../auth/displayUser";
import { getTerminalId, getTerminalToken } from "./terminalSession";

/** يُرسل مع طلبات المطعم لمسار الصلاحيات والتدقيق (يثق بالعميل حتى يُضاف JWT لاحقاً).
 *  عند تفعيل Shared Terminal Mode سيلتقط أيضاً `terminalId` و`terminalToken` من
 *  الذاكرة (مُسجَّلَين بعد إدخال PIN صحيح). الباك-إند يقبل actor بلا token عند
 *  تعطيل الوضع، ويرفض عند تفعيله. */
export type Mat3amActor = {
  id: string;
  login: string;
  name: string;
  role: string;
  terminalId?: string;
  terminalToken?: string;
};

export function buildMat3amActor(user: SessionUser | null | undefined): Mat3amActor | undefined {
  if (!user?.id) return undefined;
  const tok = getTerminalToken();
  const tid = getTerminalId();
  const a: Mat3amActor = {
    id: String(user.id),
    login: String(user.login || "").trim(),
    name: repairArabicDisplayText(String(user.name || "").trim()),
    role: String(user.role || "").trim().toLowerCase(),
    terminalId: tid,
  };
  if (tok) a.terminalToken = tok;
  return a;
}
