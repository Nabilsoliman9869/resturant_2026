import type { FloorPlan, FloorTable, Point, TableLiveMap, Obstacle, AislePath, FloorZone } from "../lib/floorPlanModel";

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
  orderCount,
  orderPreview,
}: {
  table: FloorTable;
  status?: string;
  progress?: number;
  orderCount?: number;
  orderPreview?: string;
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
      ) : table.shape === "ellipse" ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={table.w / 2}
          ry={table.h / 2}
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
      {orderCount && orderCount > 0 ? (
        <g>
          <rect x={table.x + table.w + 10} y={table.y + 6} width={120} height={34} rx={8} ry={8} fill="#fff7ed" stroke="#ea580c" strokeWidth={1.5} />
          <text x={table.x + table.w + 70} y={table.y + 20} textAnchor="middle" fontSize={11} fontWeight={700} fill="#9a3412">
            طلبات: {orderCount}
          </text>
          <text x={table.x + table.w + 70} y={table.y + 33} textAnchor="middle" fontSize={10} fill="#9a3412">
            {(orderPreview || "قيد التحضير").slice(0, 20)}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function obstacleColor(t?: string) {
  switch (t) {
    case "stairs":
      return { fill: "#ddd6fe", stroke: "#6d28d9" };
    case "column":
      return { fill: "#94a3b8", stroke: "#334155" };
    case "wall_segment":
      return { fill: "#cbd5e1", stroke: "#1f2937" };
    case "window":
      return { fill: "#bfdbfe", stroke: "#1d4ed8" };
    case "bar":
    case "counter":
      return { fill: "#fed7aa", stroke: "#c2410c" };
    case "door":
      return { fill: "#bbf7d0", stroke: "#15803d" };
    case "service":
      return { fill: "#fde68a", stroke: "#92400e" };
    case "plant":
      return { fill: "#86efac", stroke: "#166534" };
    default:
      return { fill: "#e5e7eb", stroke: "#374151" };
  }
}

function renderObstacle(o: Obstacle) {
  const { fill, stroke } = obstacleColor((o as any).type as string);
  if (o.shape === "circle") {
    return <circle key={o.id} cx={o.x} cy={o.y} r={(o as any).r ?? Math.min(20, 999)} fill={fill} stroke={stroke} strokeWidth={2} />;
  }
  if (o.shape === "rect") {
    const rot = (o as any).rotationDeg ?? 0;
    const cx = o.x + (o as any).w / 2;
    const cy = o.y + (o as any).h / 2;
    return (
      <g key={o.id} transform={`rotate(${rot} ${cx} ${cy})`}>
        <rect x={o.x} y={o.y} width={(o as any).w} height={(o as any).h} rx={6} ry={6} fill={fill} stroke={stroke} strokeWidth={2} />
      </g>
    );
  }
  if (o.shape === "polygon") {
    return <polygon key={o.id} points={(o.points as Point[]).map(([x, y]) => `${x},${y}`).join(" ")} fill={fill} stroke={stroke} strokeWidth={2} />;
  }
  return null;
}

function renderAisle(a: AislePath) {
  const pts = a.points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <polyline
      key={a.id}
      points={pts}
      fill="none"
      stroke="#64748b"
      strokeWidth={Math.max(2, Math.min(8, (a.width || 120) / 40))}
      strokeDasharray="10 6"
      opacity={0.9}
    />
  );
}

function renderZones(z?: FloorZone[]) {
  if (!Array.isArray(z) || !z.length) return null;
  return z.map((zone) => (
    <g key={zone.id}>
      {Array.isArray(zone.boundary) && zone.boundary.length >= 3 && (
        <polygon
          points={zone.boundary.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="rgba(59,130,246,0.08)"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="6 6"
        />
      )}
      <text x={(zone.boundary?.[0]?.[0] ?? 0) + 8} y={(zone.boundary?.[0]?.[1] ?? 0) + 16} fontSize={12} fill="#1e3a8a">
        {zone.name}
      </text>
    </g>
  ));
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
        {Array.isArray(plan.aisles) && plan.aisles.map(renderAisle)}
        {Array.isArray(plan.zones) && renderZones(plan.zones)}
        {Array.isArray(plan.obstacles) && plan.obstacles.map(renderObstacle)}
        {plan.tables.map((table) => {
          const liveState = live[`${plan.id}::${table.id}`] ?? live[table.id];
          return (
            <TableNode
              key={table.id}
              table={table}
              status={liveState?.status}
              progress={liveState?.progress}
              orderCount={liveState?.orderCount}
              orderPreview={liveState?.orderPreview}
            />
          );
        })}
      </svg>
    </div>
  );
}
