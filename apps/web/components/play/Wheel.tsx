import type { CSSProperties } from 'react';

export type WheelSegment = { label: string; color?: string; text_color?: string };

/**
 * Festive palette inspired by the Suntec City logo (orange, blue, green, red) on a bright
 * orange rim. Every fill has a text colour that meets WCAG AA (≥ 4.5:1).
 */
export const WHEEL_PALETTE: { color: string; text: string }[] = [
  { color: '#F97316', text: '#1F2937' }, // Suntec orange
  { color: '#FFFFFF', text: '#C2410C' }, // white
  { color: '#0369A1', text: '#FFFFFF' }, // Suntec blue
  { color: '#FDE68A', text: '#1F2937' }, // gold
  { color: '#15803D', text: '#FFFFFF' }, // Suntec green
  { color: '#FFEDD5', text: '#9A3412' }, // peach
  { color: '#DC2626', text: '#FFFFFF' }, // Suntec red
  { color: '#E0F2FE', text: '#0369A1' }, // sky
];
const TEXT_ON: Record<string, string> = Object.fromEntries(WHEEL_PALETTE.map((p) => [p.color, p.text]));

/**
 * Prize wheel drawn as SVG. Segment 0 starts at 12 o'clock and runs clockwise; the
 * pointer sits at 12 o'clock, so the segment under it is the result.
 * `rotation` (degrees) is animated with a CSS transition by the parent.
 * `highlight` = index of the winning segment, glowing once the wheel has stopped.
 * Decorative: the result is announced separately in an aria-live region.
 */
export function Wheel({
  segments,
  rotation = 0,
  durationMs = 0,
  size = 320,
  highlight = null,
  className,
}: {
  segments: WheelSegment[];
  rotation?: number;
  durationMs?: number;
  size?: number;
  highlight?: number | null;
  className?: string;
}) {
  const n = Math.max(segments.length, 1);
  const r = 96;
  const step = (2 * Math.PI) / n;
  // The wheel's centre is the SVG origin (0,0): rotate around it explicitly.
  const style: CSSProperties = {
    transform: `rotate(${rotation}deg)`,
    transition: durationMs ? `transform ${durationMs}ms cubic-bezier(0.15, 0.75, 0.1, 1)` : undefined,
    transformOrigin: '0px 0px',
    transformBox: 'view-box',
  };
  const point = (a: number, rad = r) => [rad * Math.sin(a), -rad * Math.cos(a)] as const;
  const bulbs = n * 2;

  return (
    <div className={className} style={{ width: size, maxWidth: '100%', aspectRatio: '1 / 1', position: 'relative' }} aria-hidden="true">
      <svg viewBox="-112 -112 224 224" width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="sp-rim" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#FDBA74" />
            <stop offset="70%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#EA580C" />
          </radialGradient>
          <radialGradient id="sp-shine" cx="50%" cy="25%" r="75%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sp-hub" cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#FFF7ED" />
          </radialGradient>
          <filter id="sp-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#9A3412" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* rim with lights */}
        <circle r="110" fill="url(#sp-rim)" filter="url(#sp-shadow)" />
        <circle r="100" fill="#FFFFFF" />
        {Array.from({ length: bulbs }).map((_, i) => {
          const [x, y] = point((i * 2 * Math.PI) / bulbs, 105);
          return <circle key={`bulb-${i}`} cx={x} cy={y} r="2.6" fill={i % 2 ? '#FFFFFF' : '#FDE68A'} stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="0.8" />;
        })}

        <g style={style}>
          {segments.map((s, i) => {
            const a0 = i * step;
            const a1 = (i + 1) * step;
            const [x0, y0] = point(a0);
            const [x1, y1] = point(a1);
            const theme = WHEEL_PALETTE[i % WHEEL_PALETTE.length]!;
            const fill = s.color ?? theme.color;
            const textColor = s.text_color ?? TEXT_ON[fill.toUpperCase()] ?? '#1F2937';
            const mid = (a0 + a1) / 2;
            const deg = (mid * 180) / Math.PI;
            const label = s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label;
            const d = `M0 0 L${x0} ${y0} A${r} ${r} 0 ${step > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`;
            return (
              <g key={i}>
                <path d={d} fill={fill} stroke="#FFFFFF" strokeWidth="1.2" />
                {highlight === i && <path d={d} fill="#FFFFFF" fillOpacity="0.25" stroke="#FACC15" strokeWidth="3.5" strokeLinejoin="round" className="sp-win" />}
                <text
                  transform={`rotate(${deg}) translate(0 -60) rotate(90)`}
                  fill={textColor}
                  fontSize={n > 10 ? 6.5 : 8}
                  fontWeight={800}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontFamily: 'var(--font-montserrat), Montserrat, Arial, sans-serif' }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>

        {/* glossy highlight + hub */}
        <circle r="100" fill="url(#sp-shine)" pointerEvents="none" />
        <circle r="19" fill="url(#sp-hub)" stroke="#F97316" strokeWidth="4" filter="url(#sp-shadow)" />
        <text y="1" fontSize="7.5" fontWeight={800} fill="#021F47" textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'var(--font-montserrat), Montserrat, Arial, sans-serif' }}>
          SPIN
        </text>
      </svg>
      {/* pointer at 12 o'clock: the segment under it wins */}
      <svg viewBox="0 0 40 48" width="12%" style={{ position: 'absolute', left: '44%', top: '-4%', filter: 'drop-shadow(0 2px 2px rgba(124,45,18,0.45))' }}>
        <path d="M20 46 L5 10 Q4 3 11 2 L29 2 Q36 3 35 10 Z" fill="#C2410C" stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="20" cy="12" r="4" fill="#FDE68A" />
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
