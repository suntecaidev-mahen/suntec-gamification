import { useId } from 'react';

/**
 * Original illustrations for the game tiles (Suntec palette, drawn as SVG so they stay sharp
 * at any size and need no licensed photos). Decorative: the tile shows the game name as text.
 */
export function GameArt({ type, className }: { type: string; className?: string }) {
  const id = useId().replace(/:/g, '');
  const common = { viewBox: '0 0 640 360', className, 'aria-hidden': true as const, focusable: 'false' as const, preserveAspectRatio: 'xMidYMid slice' };
  if (type === 'scratch_card') return <ScratchArt id={id} {...common} />;
  if (type === 'quiz') return <QuizArt id={id} {...common} />;
  return <SpinArt id={id} {...common} />;
}

type ArtProps = React.SVGProps<SVGSVGElement> & { id: string };

const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(1)},${(cy + rr * Math.sin(rad)).toFixed(1)}`);
  }
  return pts.join(' ');
};
/** Four-point sparkle. */
const sparkle = (cx: number, cy: number, r: number) =>
  `M${cx},${cy - r} Q${cx},${cy} ${cx + r},${cy} Q${cx},${cy} ${cx},${cy + r} Q${cx},${cy} ${cx - r},${cy} Q${cx},${cy} ${cx},${cy - r}Z`;

function Confetti({ items }: { items: [number, number, number, string][] }) {
  return (
    <g>
      {items.map(([x, y, rot, c], i) => (
        <rect key={i} x={x} y={y} width={i % 2 ? 10 : 14} height={i % 2 ? 18 : 7} rx={2} fill={c} transform={`rotate(${rot} ${x} ${y})`} />
      ))}
    </g>
  );
}

function Coin({ x, y, r, id }: { x: number; y: number; r: number; id: string }) {
  return (
    <g>
      <circle cx={x} cy={y + r * 0.12} r={r} fill="#B45309" />
      <circle cx={x} cy={y} r={r} fill={`url(#${id}-gold)`} />
      <circle cx={x} cy={y} r={r * 0.72} fill="none" stroke="#FFFBEB" strokeOpacity={0.7} strokeWidth={r * 0.08} />
      <polygon points={star(x, y, r * 0.42)} fill="#FFFBEB" />
    </g>
  );
}

const GOLD = (id: string) => (
  <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stopColor="#FEF3C7" />
    <stop offset="0.45" stopColor="#FBBF24" />
    <stop offset="1" stopColor="#D97706" />
  </linearGradient>
);

// ---------------------------------------------------------------- Spin & Win
const SEGMENTS = ['#F97316', '#FFFFFF', '#0369A1', '#FDE68A', '#15803D', '#FFEDD5', '#DC2626', '#E0F2FE'];

function SpinArt({ id, ...svg }: ArtProps) {
  const cx = 330;
  const cy = 194;
  const R = 118;
  const seg = (i: number) => {
    const a0 = ((i * 45 - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * 45 - 90) * Math.PI) / 180;
    return `M${cx},${cy} L${cx + R * Math.cos(a0)},${cy + R * Math.sin(a0)} A${R},${R} 0 0 1 ${cx + R * Math.cos(a1)},${cy + R * Math.sin(a1)}Z`;
  };
  return (
    <svg {...svg}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="0.5" cy="0.55" r="0.75">
          <stop offset="0" stopColor="#FDBA74" />
          <stop offset="0.55" stopColor="#F97316" />
          <stop offset="1" stopColor="#C2410C" />
        </radialGradient>
        {GOLD(id)}
        <filter id={`${id}-sh`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#7C2D12" floodOpacity="0.45" />
        </filter>
      </defs>
      <rect width="640" height="360" fill={`url(#${id}-bg)`} />
      {/* light rays */}
      <g fill="#FFFFFF" opacity="0.1">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d={`M${cx},${cy} L${cx - 40},-200 L${cx + 40},-200Z`} transform={`rotate(${i * 30} ${cx} ${cy})`} />
        ))}
      </g>
      <Confetti
        items={[
          [70, 60, 20, '#FDE68A'], [140, 290, -30, '#FFFFFF'], [560, 70, 40, '#FFFFFF'], [520, 300, 15, '#FDE68A'],
          [40, 200, -15, '#0369A1'], [600, 190, 60, '#15803D'], [200, 40, 75, '#FFFFFF'], [470, 30, -50, '#DC2626'],
        ]}
      />
      <Coin x={110} y={130} r={34} id={id} />
      <Coin x={548} y={248} r={28} id={id} />
      <Coin x={500} y={110} r={18} id={id} />
      {/* wheel */}
      <g filter={`url(#${id}-sh)`}>
        <circle cx={cx} cy={cy} r={R + 22} fill={`url(#${id}-gold)`} />
        <circle cx={cx} cy={cy} r={R + 6} fill="#021F47" />
      </g>
      <g transform={`rotate(-14 ${cx} ${cy})`}>
        {SEGMENTS.map((c, i) => (
          <path key={i} d={seg(i)} fill={c} stroke="#021F47" strokeOpacity="0.15" strokeWidth="2" />
        ))}
        {SEGMENTS.map((c, i) => {
          const a = ((i * 45 + 22.5 - 90) * Math.PI) / 180;
          const light = ['#FFFFFF', '#FDE68A', '#FFEDD5', '#E0F2FE'].includes(c);
          return <polygon key={i} points={star(cx + R * 0.68 * Math.cos(a), cy + R * 0.68 * Math.sin(a), 13)} fill={light ? '#F97316' : '#FFFFFF'} />;
        })}
      </g>
      {/* rim bulbs */}
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i * 22.5 * Math.PI) / 180;
        return <circle key={i} cx={cx + (R + 14) * Math.cos(a)} cy={cy + (R + 14) * Math.sin(a)} r={5} fill={i % 2 ? '#FFFFFF' : '#FFFBEB'} stroke="#B45309" strokeWidth="1.5" />;
      })}
      {/* hub */}
      <circle cx={cx} cy={cy} r={28} fill={`url(#${id}-gold)`} stroke="#FFFFFF" strokeWidth="4" />
      <polygon points={star(cx, cy, 15)} fill="#C2410C" />
      {/* pointer */}
      <g filter={`url(#${id}-sh)`}>
        <path d={`M${cx - 22},${cy - R - 40} L${cx + 22},${cy - R - 40} L${cx},${cy - R + 6}Z`} fill="#021F47" stroke="#FFFFFF" strokeWidth="4" strokeLinejoin="round" />
      </g>
      <path d={sparkle(230, 70, 14)} fill="#FFFFFF" />
      <path d={sparkle(450, 330, 10)} fill="#FFFBEB" />
    </svg>
  );
}

// ---------------------------------------------------------------- Scratch & Win
function ScratchArt({ id, ...svg }: ArtProps) {
  return (
    <svg {...svg}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#021F47" />
          <stop offset="1" stopColor="#0369A1" />
        </linearGradient>
        {GOLD(id)}
        <linearGradient id={`${id}-silver`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3F4F6" />
          <stop offset="0.5" stopColor="#C7CDD4" />
          <stop offset="1" stopColor="#9CA3AF" />
        </linearGradient>
        <pattern id={`${id}-grain`} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.2" fill="#FFFFFF" opacity="0.5" />
          <circle cx="9" cy="8" r="1" fill="#6B7280" opacity="0.25" />
        </pattern>
        <mask id={`${id}-scratch`}>
          <rect x="0" y="0" width="640" height="360" fill="#FFFFFF" />
          <path d="M240,200 C280,165 330,225 380,185 S440,170 465,205 M262,248 C315,222 360,262 425,236 M290,172 L385,166" stroke="#000000" strokeWidth="44" strokeLinecap="round" fill="none" />
        </mask>
        <filter id={`${id}-sh`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000814" floodOpacity="0.5" />
        </filter>
      </defs>
      <rect width="640" height="360" fill={`url(#${id}-bg)`} />
      <circle cx="80" cy="60" r="120" fill="#F97316" opacity="0.18" />
      <circle cx="600" cy="330" r="150" fill="#FDE68A" opacity="0.12" />
      <Confetti
        items={[
          [60, 280, 25, '#F97316'], [110, 90, -20, '#FDE68A'], [560, 60, 35, '#F97316'], [590, 160, -40, '#FFFFFF'],
          [40, 170, 60, '#FFFFFF'], [520, 320, 10, '#FDE68A'],
        ]}
      />
      {/* ticket */}
      <g transform="rotate(-6 330 190)" filter={`url(#${id}-sh)`}>
        <rect x="130" y="70" width="400" height="240" rx="22" fill="#FFFFFF" />
        <rect x="130" y="70" width="400" height="58" rx="22" fill="#F97316" />
        <rect x="130" y="106" width="400" height="22" fill="#F97316" />
        <text x="330" y="108" textAnchor="middle" fontFamily="inherit" fontWeight="800" fontSize="28" letterSpacing="3" fill="#FFFFFF">
          SCRATCH &amp; WIN
        </text>
        {/* prize revealed underneath */}
        <rect x="160" y="148" width="340" height="132" rx="14" fill="#FFF7ED" />
        <g>
          <rect x="296" y="186" width="68" height="58" rx="6" fill="#DC2626" />
          <rect x="288" y="172" width="84" height="22" rx="5" fill="#EF4444" />
          <rect x="323" y="172" width="14" height="72" fill="#FDE68A" />
          <path d="M330,172 C312,150 290,162 312,172 M330,172 C348,150 370,162 348,172" stroke="#FDE68A" strokeWidth="7" fill="none" strokeLinecap="round" />
        </g>
        <polygon points={star(230, 200, 16)} fill="#F97316" />
        <polygon points={star(430, 232, 14)} fill="#F97316" />
        {/* silver coating with scratch marks */}
        <g mask={`url(#${id}-scratch)`}>
          <rect x="160" y="148" width="340" height="132" rx="14" fill={`url(#${id}-silver)`} />
          <rect x="160" y="148" width="340" height="132" rx="14" fill={`url(#${id}-grain)`} />
        </g>
      </g>
      {/* coin scratching */}
      <g transform="rotate(-25 500 270)">
        <ellipse cx="500" cy="276" rx="38" ry="38" fill="#B45309" />
        <circle cx="500" cy="270" r="38" fill={`url(#${id}-gold)`} />
        <circle cx="500" cy="270" r="27" fill="none" stroke="#FFFBEB" strokeOpacity="0.7" strokeWidth="3" />
        <polygon points={star(500, 270, 15)} fill="#FFFBEB" />
      </g>
      <path d={sparkle(470, 150, 16)} fill="#FDE68A" />
      <path d={sparkle(190, 300, 12)} fill="#FFFFFF" />
      <path d={sparkle(560, 230, 9)} fill="#FFFFFF" />
    </svg>
  );
}

// ---------------------------------------------------------------- Quiz & Win
function QuizArt({ id, ...svg }: ArtProps) {
  const answers = [
    { y: 92, letter: 'A', ok: false },
    { y: 160, letter: 'B', ok: true },
    { y: 228, letter: 'C', ok: false },
  ];
  return (
    <svg {...svg}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0369A1" />
          <stop offset="1" stopColor="#0F766E" />
        </linearGradient>
        {GOLD(id)}
        <filter id={`${id}-sh`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#022C3A" floodOpacity="0.45" />
        </filter>
      </defs>
      <rect width="640" height="360" fill={`url(#${id}-bg)`} />
      <circle cx="560" cy="40" r="130" fill="#FFFFFF" opacity="0.07" />
      <circle cx="40" cy="340" r="140" fill="#F97316" opacity="0.18" />
      <Confetti
        items={[
          [40, 60, 30, '#FDE68A'], [600, 300, -25, '#F97316'], [270, 330, 50, '#FFFFFF'], [610, 120, 15, '#FDE68A'], [30, 250, -45, '#FFFFFF'],
        ]}
      />
      {/* speech bubble with question mark */}
      <g filter={`url(#${id}-sh)`}>
        <rect x="58" y="70" width="210" height="190" rx="36" fill="#FFFFFF" />
        <path d="M110,250 L96,300 L150,256Z" fill="#FFFFFF" />
      </g>
      <text x="163" y="222" textAnchor="middle" fontFamily="inherit" fontWeight="900" fontSize="170" fill="#F97316">
        ?
      </text>
      {/* answers */}
      {answers.map((a) => (
        <g key={a.letter} filter={`url(#${id}-sh)`}>
          <rect x="310" y={a.y} width="250" height="52" rx="26" fill={a.ok ? '#15803D' : '#FFFFFF'} />
          <circle cx="338" cy={a.y + 26} r="18" fill={a.ok ? '#FFFFFF' : '#FFEDD5'} />
          <text x="338" y={a.y + 33} textAnchor="middle" fontFamily="inherit" fontWeight="800" fontSize="20" fill={a.ok ? '#15803D' : '#C2410C'}>
            {a.letter}
          </text>
          <rect x="368" y={a.y + 20} width={a.ok ? 120 : 140} height="12" rx="6" fill={a.ok ? '#FFFFFF' : '#E5E7EB'} opacity={a.ok ? 0.85 : 1} />
          {a.ok && <path d={`M520,${a.y + 26} l10,10 l18,-20`} stroke="#FFFFFF" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      ))}
      {/* stopwatch */}
      <g transform="translate(560 64)" filter={`url(#${id}-sh)`}>
        <rect x="-8" y="-46" width="16" height="12" rx="3" fill="#FDE68A" />
        <circle r="34" fill="#FFFFFF" />
        <path d="M0,-26 A26,26 0 1,1 -25,7 L0,0Z" fill="#F97316" />
        <circle r="5" fill="#021F47" />
      </g>
      <Coin x={250} y={300} r={24} id={id} />
      <path d={sparkle(290, 60, 14)} fill="#FDE68A" />
      <path d={sparkle(600, 220, 10)} fill="#FFFFFF" />
    </svg>
  );
}
