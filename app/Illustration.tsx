import type { VarKey } from '@/lib/solver';

const common = {
  width: '100%',
  height: 110,
  viewBox: '0 0 120 84',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Tool cross-section (looking at the end of the end mill): a disc with curved flute gullets. */
function ToolFace({ flutes = 4, r = 26, cx = 60, cy = 42 }: { flutes?: number; r?: number; cx?: number; cy?: number }) {
  const parts: string[] = [];
  const gullet = 0.55; // fraction of each pitch that is gullet (cut-away)
  const depth = 0.34; // gullet depth as fraction of r
  const pitch = (Math.PI * 2) / flutes;
  for (let i = 0; i < flutes; i++) {
    const a0 = i * pitch; // cutting edge (tip) at a0
    const aG = a0 + pitch * gullet; // end of gullet
    const a1 = a0 + pitch; // next tip
    const P = (a: number, rr: number) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`;
    const ri = r * (1 - depth);
    if (i === 0) parts.push(`M ${P(a0, r)}`);
    // rake face: sharp drop from the tip inward, then curved gullet back up to the land
    parts.push(`Q ${P(a0 + pitch * 0.12, ri * 0.8)} ${P(a0 + pitch * 0.28, ri)}`);
    parts.push(`Q ${P(aG - pitch * 0.05, ri * 1.02)} ${P(aG, r)}`);
    // land: outer arc up to the next tip
    parts.push(`A ${r} ${r} 0 0 1 ${P(a1, r)}`);
  }
  parts.push('Z');
  return (
    <>
      <path d={parts.join(' ')} fill="currentColor" fillOpacity={0.08} />
      <circle cx={cx} cy={cy} r={2} fill="currentColor" stroke="none" />
    </>
  );
}

function Arrow({ x1, y1, x2, y2, accent }: { x1: number; y1: number; x2: number; y2: number; accent?: boolean }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = 5;
  const p = (ang: number) => `${(x2 - h * Math.cos(a + ang)).toFixed(1)},${(y2 - h * Math.sin(a + ang)).toFixed(1)}`;
  return (
    <g className={accent ? 'ill-accent' : undefined}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polygon points={`${x2},${y2} ${p(0.5)} ${p(-0.5)}`} fill="currentColor" stroke="none" />
    </g>
  );
}

const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)}`;
};

export function Illustration({ k }: { k: VarKey }) {
  switch (k) {
    case 'd':
      return (
        <svg {...common} aria-label="Tool diameter">
          <ToolFace />
          <line x1={34} y1={80} x2={34} y2={44} strokeDasharray="2 2" />
          <line x1={86} y1={80} x2={86} y2={44} strokeDasharray="2 2" />
          <Arrow x1={60} y1={79} x2={35} y2={79} accent />
          <Arrow x1={60} y1={79} x2={85} y2={79} accent />
          <text x={60} y={76} textAnchor="middle" fontSize={10} fill="currentColor" stroke="none" className="ill-accent">d</text>
        </svg>
      );
    case 'z':
      return (
        <svg {...common} aria-label="Number of flutes">
          <ToolFace flutes={4} />
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2;
            return (
              <g key={i} className="ill-accent">
                <circle cx={60 + Math.cos(a) * 26} cy={42 + Math.sin(a) * 26} r={3} fill="currentColor" stroke="none" />
                <text x={60 + Math.cos(a) * 35} y={42 + Math.sin(a) * 35 + 3.5} textAnchor="middle" fontSize={9} fill="currentColor" stroke="none">{i + 1}</text>
              </g>
            );
          })}
        </svg>
      );
    case 'vc':
      return (
        <svg {...common} aria-label="Cutting speed">
          <ToolFace />
          <path d={arc(60, 42, 26, -Math.PI / 2 - 1.1, -Math.PI / 2)} className="ill-accent" />
          <Arrow x1={60} y1={16} x2={82} y2={16} accent />
          <text x={88} y={19} fontSize={10} fill="currentColor" stroke="none" className="ill-accent">vc</text>
          <text x={60} y={80} textAnchor="middle" fontSize={8} fill="currentColor" stroke="none" opacity={0.7}>speed at the cutting edge</text>
        </svg>
      );
    case 'n':
      return (
        <svg {...common} aria-label="Spindle speed">
          <ToolFace />
          <path d={arc(60, 42, 34, Math.PI * 0.75, Math.PI * 2.25)} className="ill-accent" />
          <Arrow x1={37.5} y1={65.5} x2={35.5} y2={66.5} accent />
          <text x={60} y={80} textAnchor="middle" fontSize={9} fill="currentColor" stroke="none" className="ill-accent">n rev/min</text>
        </svg>
      );
    case 'fz': {
      // Two consecutive tooth positions; the offset between them is fz.
      return (
        <svg {...common} aria-label="Feed per tooth">
          <rect x={8} y={48} width={104} height={28} fill="currentColor" opacity={0.08} stroke="none" />
          <line x1={8} y1={48} x2={112} y2={48} />
          <path d={arc(44, 24, 24, Math.PI * 0.25, Math.PI * 0.95)} opacity={0.4} strokeDasharray="3 2" />
          <path d={arc(62, 24, 24, Math.PI * 0.25, Math.PI * 0.95)} />
          <path d={`M 44 48 L 62 48`} className="ill-accent" strokeWidth={3} />
          <line x1={44} y1={6} x2={44} y2={48} strokeDasharray="2 2" opacity={0.6} />
          <line x1={62} y1={6} x2={62} y2={48} strokeDasharray="2 2" opacity={0.6} />
          <Arrow x1={44} y1={12} x2={61} y2={12} accent />
          <text x={72} y={15} fontSize={10} fill="currentColor" stroke="none" className="ill-accent">fz</text>
          <text x={60} y={66} textAnchor="middle" fontSize={8} fill="currentColor" stroke="none" opacity={0.7}>advance per tooth = chip thickness</text>
        </svg>
      );
    }
    case 'vf':
      return (
        <svg {...common} aria-label="Feed rate">
          <rect x={8} y={50} width={104} height={26} fill="currentColor" opacity={0.08} stroke="none" />
          <line x1={8} y1={50} x2={112} y2={50} />
          <rect x={44} y={14} width={20} height={44} rx={2} />
          <line x1={48} y1={18} x2={48} y2={54} opacity={0.4} />
          <line x1={54} y1={18} x2={54} y2={54} opacity={0.4} />
          <line x1={60} y1={18} x2={60} y2={54} opacity={0.4} />
          <path d="M 8 58 L 44 58" className="ill-accent" strokeWidth={3} opacity={0.6} />
          <Arrow x1={68} y1={30} x2={98} y2={30} accent />
          <text x={83} y={25} textAnchor="middle" fontSize={10} fill="currentColor" stroke="none" className="ill-accent">vf</text>
          <text x={60} y={66} textAnchor="middle" fontSize={8} fill="currentColor" stroke="none" opacity={0.7}>tool travel through the material</text>
        </svg>
      );
  }
}
