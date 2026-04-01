import type { FloorPlan, FloorTable, Point, TableLiveMap } from "../lib/floorPlanModel";

type Props = {
  plan: FloorPlan;
  live?: TableLiveMap;
};

function polygonToSvgPoints(points: Point[]) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

function statusColor(status?: string) {
  switch (status) {
    case "occupied":
      return "#f59e0b";
    case "reserved":
      return "#3b82f6";
    case "billing":
      return "#8b5cf6";
    case "dirty":
      return "#ef4444";
    case "free":
    default:
      return "#22c55e";
  }
}

function renderSeats(table: FloorTable) {
  const seats = table.seats ?? 0;
  if (seats <= 0) return null;

  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;

  if (table.shape === "circle") {
    const radius = Math.max(table.w, table.h) / 2 + 18;
    return Array.from({ length: seats }).map((_, i) => {
      const angle = (Math.PI * 2 * i) / seats - Math.PI / 2;
      const sx = cx + Math.cos(angle) * radius;
      const sy = cy + Math.sin(angle) * radius;
      return <circle key={i} cx={sx} cy={sy} r={8} fill="#cbd5e1" stroke="#64748b" />;
    });
  }

  const nodes: { x: number; y: number }[] = [];
  const topCount = Math.ceil(seats / 2);
  const bottomCount = Math.floor(seats / 2);

  for (let i = 0; i < topCount; i++) {
    nodes.push({
      x: table.x + ((i + 1) * table.w) / (topCount + 1),
      y: table.y - 16,
    });
  }
  for (let i = 0; i < bottomCount; i++) {
    nodes.push({
      x: table.x + ((i + 1) * table.w) / (bottomCount + 1),
      y: table.y + table.h + 16,
    });
  }

  return nodes.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={8} fill="#cbd5e1" stroke="#64748b" />);
}

function TableNode({
  table,
  status,
  progress,
}: {
  table: FloorTable;
  status?: string;
  progress?: number;
}) {
  const fill = statusColor(status);
  const cx = table.x + table.w / 2;
  const cy = table.y + table.h / 2;
  const rotation = table.rotation ?? 0;

  return (
    <g transform={`rotate(${rotation} ${cx} ${cy})`}>
      {table.shape === "circle" ? (
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(table.w, table.h) / 2}
          fill={fill}
          opacity={0.9}
          stroke="#1f2937"
          strokeWidth={2}
        />
      ) : (
        <rect
          x={table.x}
          y={table.y}
          width={table.w}
          height={table.h}
          rx={12}
          ry={12}
          fill={fill}
          opacity={0.9}
          stroke="#1f2937"
          strokeWidth={2}
        />
      )}

      {renderSeats(table)}

      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={16} fontWeight={700} fill="#111827">
        {table.label}
      </text>

      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={13} fill="#111827">
        {progress != null ? `${progress}%` : status ?? "free"}
      </text>
    </g>
  );
}

/** عرض مخطط الصالة v1 — مضلع + طاولات؛ الحالة الحية منفصلة (TableLiveMap). */
export function FloorPlanSvgView({ plan, live = {} }: Props) {
  return (
    <div style={{ width: "100%", overflow: "auto", background: "#f8fafc", padding: 16, borderRadius: 12 }}>
      <div style={{ marginBottom: 12, fontWeight: 700 }}>{plan.name}</div>

      <svg
        width={plan.width}
        height={plan.height}
        viewBox={`0 0 ${plan.width} ${plan.height}`}
        style={{
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: 12,
          maxWidth: "100%",
          height: "auto",
        }}
      >
        <polygon points={polygonToSvgPoints(plan.shell.points)} fill="#f1f5f9" stroke="#334155" strokeWidth={3} />

        {plan.tables.map((table) => {
          const liveState = live[`${plan.id}::${table.id}`] ?? live[table.id];
          return (
            <TableNode
              key={table.id}
              table={table}
              status={liveState?.status}
              progress={liveState?.progress}
            />
          );
        })}
      </svg>
    </div>
  );
}
