import type { CSSProperties } from 'react';

export type WheelSegment = { label: string; color?: string; text_color?: string };

const PALETTE = ['#F97316', '#FFFFFF', '#C2410C', '#FED7AA', '#FB923C', '#FFF7ED', '#9A3412', '#FFEDD5'];
const TEXT_ON: Record<string, string> = { '#C2410C': '#FFFFFF', '#9A3412': '#FFFFFF', '#7C2D12': '#FFFFFF' };

/**
 * Prize wheel drawn as SVG. Segment 0 starts at 12 o'clock and runs clockwise.
 * `rotation` (degrees) is applied with a CSS transition by the parent.
 * Decorative: the result is announced separately in an aria-live region.
 */
export function Wheel({
  segments,
  rotation = 0,
  durationMs = 0,
  size = 320,
  className,
}: {
  segments: WheelSegment[];
  rotation?: number;
  durationMs?: number;
  size?: number;
  className?: string;
}) {
  const n = Math.max(segments.length, 1);
  const r = 100;
  const step = (2 * Math.PI) / n;
  const style: CSSProperties = {
    transform: `rotate(${rotation}deg)`,
    transition: durationMs ? `transform ${durationMs}ms cubic-bezier(0.12, 0.8, 0.12, 1)` : undefined,
    transformOrigin: '50% 50%',
  };
  const point = (a: number, rad = r) => [rad * Math.sin(a), -rad * Math.cos(a)] as const;

  return (
    <div className={className} style={{ width: size, maxWidth: '100%', aspectRatio: '1 / 1', position: 'relative' }} aria-hidden="true">
      <svg viewBox="-110 -110 220 220" width="100%" height="100%">
        <circle r="108" fill="#7C2D12" />
        <g style={style}>
          {segments.map((s, i) => {
            const a0 = i * step;
            const a1 = (i + 1) * step;
            const [x0, y0] = point(a0);
            const [x1, y1] = point(a1);
            const fill = s.color ?? PALETTE[i % PALETTE.length]!;
            const textColor = s.text_color ?? TEXT_ON[fill.toUpperCase()] ?? '#1F2937';
            const mid = (a0 + a1) / 2;
            const deg = (mid * 180) / Math.PI;
            const label = s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label;
            return (
              <g key={i}>
                <path d={`M0 0 L${x0} ${y0} A${r} ${r} 0 ${step > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`} fill={fill} stroke="#7C2D12" strokeWidth="0.8" />
                <text
                  transform={`rotate(${deg}) translate(0 -62) rotate(90)`}
                  fill={textColor}
                  fontSize={n > 10 ? 6.5 : 8}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {label}
                </text>
              </g>
            );
          })}
          {Array.from({ length: n }).map((_, i) => {
            const [x, y] = point(i * step, 103);
            return <circle key={`dot-${i}`} cx={x} cy={y} r="2.2" fill="#FFEDD5" />;
          })}
        </g>
        <circle r="16" fill="#FFFFFF" stroke="#C2410C" strokeWidth="4" />
        <text y="1" fontSize="7" fontWeight={800} fill="#C2410C" textAnchor="middle" dominantBaseline="middle" fontFamily="Inter, system-ui, sans-serif">
          SPIN
        </text>
      </svg>
      {/* pointer */}
      <svg viewBox="0 0 40 40" width="13%" style={{ position: 'absolute', left: '43.5%', top: '-3%' }}>
        <path d="M20 38 L6 6 Q20 0 34 6 Z" fill="#C2410C" stroke="#FFFFFF" strokeWidth="3" />
      </svg>
    </div>
  );
}

/** Rotation (degrees) that brings segment `index` under the top pointer after `turns` full spins. */
export function rotationForSegment(index: number, count: number, turns = 6, jitter = 0): number {
  const seg = 360 / Math.max(count, 1);
  const center = index * seg + seg / 2;
  return turns * 360 + (360 - center) + jitter * seg * 0.35;
}
