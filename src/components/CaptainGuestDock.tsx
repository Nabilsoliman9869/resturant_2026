/** شريط ضيوف ثابت (يسار الشاشة في RTL) — اختيار مقعد ثم المنيو */

type Props = {
  seats: number[];
  selectedSeat: number;
  seatLabel: (seatNo: number) => string;
  truncateLabel: (text: string, max?: number) => string;
  onPickSeat: (seatNo: number) => void;
};

export function CaptainGuestDock({ seats, selectedSeat, seatLabel, truncateLabel, onPickSeat }: Props) {
  return (
    <aside className="waiter-pos__captain-guest-dock" aria-label="ضيوف الطاولة — اضغط الاسم لاختيار أصنافه">
      <div className="waiter-pos__captain-guest-dock__head">
        <span className="waiter-pos__captain-guest-dock__head-title">ضيوف</span>
        <span className="waiter-pos__captain-guest-dock__head-hint">اضغط الاسم → منيو</span>
      </div>
      <div className="waiter-pos__captain-guest-dock__list">
        {seats.map((n) => {
          const label = seatLabel(n);
          const active = selectedSeat === n;
          const isShared = n === 13;
          return (
            <button
              key={`dock-seat-${n}`}
              type="button"
              className={`waiter-pos__captain-guest-dock__btn${active ? " waiter-pos__captain-guest-dock__btn--active" : ""}${
                isShared ? " waiter-pos__captain-guest-dock__btn--shared" : ""
              }`}
              title={`سلة ${label} — انتقل للمنيو`}
              aria-pressed={active}
              onClick={() => onPickSeat(n)}
            >
              <span className="waiter-pos__captain-guest-dock__no">{isShared ? "١٣" : n}</span>
              <span className="waiter-pos__captain-guest-dock__name">{truncateLabel(label, 14)}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
