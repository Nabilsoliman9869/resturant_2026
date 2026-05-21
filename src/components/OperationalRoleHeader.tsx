import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { sessionDisplayName } from "../auth/displayUser";
import { useAuth } from "../auth/AuthContext";

type Props = {
  roleTitle: string;
  backTo?: string;
  onBack?: () => void;
  hideBack?: boolean;
  hideUser?: boolean;
  titleStyle?: CSSProperties;
  titleSub?: ReactNode;
  rightSlot?: ReactNode;
  /** صف إضافي أسفل عنوان الشريط (مثلاً مجموعات منيو نصية + أوامر سريعة) */
  subToolbar?: ReactNode;
};

export function OperationalRoleHeader({ roleTitle, backTo, onBack, hideBack, hideUser, titleStyle, titleSub, rightSlot, subToolbar }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();

  function goBack() {
    if (onBack) {
      onBack();
      return;
    }
    if (backTo) {
      navigate(backTo);
      return;
    }
    navigate(-1);
  }

  return (
    <header className={`waiter-pos__header${subToolbar ? " waiter-pos__header--stacked" : ""}`}>
      <div className="waiter-pos__header__row">
        <div className="waiter-pos__header-left">
          {!hideBack && (
            <button type="button" className="waiter-pos__back" onClick={() => goBack()} aria-label="رجوع">
              ←
            </button>
          )}
          <div>
            <div className="waiter-pos__title" style={titleStyle}>{roleTitle}</div>
            {titleSub ? (
              <div className="waiter-pos__title-sub">{titleSub}</div>
            ) : !hideUser ? (
              <div className="waiter-pos__user" title={user?.login || undefined}>
                {sessionDisplayName(user)}
              </div>
            ) : null}
          </div>
        </div>
        {rightSlot ? <div className="waiter-pos__header-right">{rightSlot}</div> : null}
      </div>
      {subToolbar ? <div className="waiter-pos__header__sub">{subToolbar}</div> : null}
    </header>
  );
}
