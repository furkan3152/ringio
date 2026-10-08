import type { ReactNode } from "react";

export type RingNodeState = "received" | "recipient" | "paid" | "due" | "missed" | "empty";

export type RingNode = {
  key: string;
  label: string;
  state: RingNodeState;
  title: string;
};

const NODE_STYLE: Record<RingNodeState, { fill: string; stroke: string; text: string; dash?: string }> = {
  received: { fill: "#c8952a", stroke: "#ffd97a", text: "#1b1404" },
  recipient: { fill: "#ffd97a", stroke: "#fff1c6", text: "#1b1404" },
  paid: { fill: "#10141c", stroke: "#3ddc97", text: "#8ff0c5" },
  due: { fill: "#10141c", stroke: "rgba(148,163,184,0.45)", text: "#a9b3c2" },
  missed: { fill: "#10141c", stroke: "#ff6b6b", text: "#ffb3b3" },
  empty: { fill: "transparent", stroke: "rgba(148,163,184,0.35)", text: "#6d788a", dash: "3 3" },
};

/**
 * The circle itself: one node per seat in payout order, a gold arc for turns
 * already paid out. Purely presentational; every state comes from chain data.
 */
export function RingDial({
  nodes,
  progress,
  center,
  spin = false,
  label,
}: {
  nodes: RingNode[];
  /** 0..1 share of turns already paid out. */
  progress: number;
  center: ReactNode;
  spin?: boolean;
  label: string;
}) {
  const size = 320;
  const radius = 128;
  const c = size / 2;
  const circumference = 2 * Math.PI * radius;
  const nodeRadius = nodes.length > 16 ? 10 : nodes.length > 10 ? 13 : 17;

  return (
    <div className="ring-dial" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="dial-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd97a" />
            <stop offset="1" stopColor="#c8952a" />
          </linearGradient>
          <radialGradient id="dial-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="rgba(242,193,78,0.16)" />
            <stop offset="1" stopColor="rgba(242,193,78,0)" />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={radius - 26} fill="url(#dial-glow)" />
        <g className={spin ? "ring-spin" : undefined}>
          <circle cx={c} cy={c} r={radius} fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth="10" />
          <circle
            cx={c}
            cy={c}
            r={radius}
            fill="none"
            stroke="url(#dial-gold)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, Math.min(1, progress)) * circumference} ${circumference}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
          <circle cx={c} cy={c} r={radius - 40} fill="none" stroke="rgba(148,163,184,0.08)" strokeDasharray="2 6" />
          {nodes.map((node, index) => {
            const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
            const x = c + radius * Math.cos(angle);
            const y = c + radius * Math.sin(angle);
            const style = NODE_STYLE[node.state];
            return (
              <g key={node.key}>
                <title>{node.title}</title>
                {node.state === "recipient" && (
                  <circle cx={x} cy={y} r={nodeRadius + 7} fill="rgba(242,193,78,0.18)" stroke="rgba(242,193,78,0.5)" />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={nodeRadius}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth="2"
                  strokeDasharray={style.dash}
                />
                {nodeRadius >= 13 && (
                  <text
                    className="ring-node-label"
                    x={x}
                    y={y}
                    fill={style.text}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="ring-dial-center">{center}</div>
    </div>
  );
}
