/**
 * Original mascot artwork for this student project, drawn as inline SVG.
 * It is intentionally not based on any official university logo or mark.
 */

const TAU = Math.PI * 2;
const ring = (count: number, radius: number, phase = 0) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * TAU + phase;
    return { x: +(100 + Math.cos(a) * radius).toFixed(1), y: +(104 + Math.sin(a) * radius).toFixed(1) };
  });

function Head() {
  return (
    <g>
      {ring(14, 62).map((p, i) => (
        <circle key={`o${i}`} cx={p.x} cy={p.y} r="25" fill="#E0850A" />
      ))}
      <circle cx="100" cy="104" r="64" fill="#E0850A" />
      {ring(14, 50, TAU / 28).map((p, i) => (
        <circle key={`i${i}`} cx={p.x} cy={p.y} r="21" fill="#FFB81C" />
      ))}
      <circle cx="100" cy="104" r="56" fill="#FFB81C" />
      {/* ears */}
      <circle cx="57" cy="62" r="17" fill="#FFCB52" />
      <circle cx="57" cy="62" r="9" fill="#C9661A" />
      <circle cx="143" cy="62" r="17" fill="#FFCB52" />
      <circle cx="143" cy="62" r="9" fill="#C9661A" />
      {/* face */}
      <ellipse cx="100" cy="109" rx="46" ry="44" fill="#FFDA7A" />
      <path d="M76 71 Q100 90 124 71 Q100 60 76 71Z" fill="#FFB81C" />
      <ellipse cx="74" cy="122" rx="8" ry="5" fill="#FFB38A" opacity=".55" />
      <ellipse cx="126" cy="122" rx="8" ry="5" fill="#FFB38A" opacity=".55" />
      {/* eyes */}
      <ellipse cx="82" cy="104" rx="5.6" ry="7.2" fill="#2A1048" />
      <ellipse cx="118" cy="104" rx="5.6" ry="7.2" fill="#2A1048" />
      <circle cx="84" cy="101" r="2" fill="#fff" />
      <circle cx="120" cy="101" r="2" fill="#fff" />
      <path d="M73 89.5 L89 90.5 M127 89.5 L111 90.5" stroke="#2A1048" strokeWidth="3.6" strokeLinecap="round" />
      {/* muzzle */}
      <ellipse cx="100" cy="130" rx="24" ry="18" fill="#FFF4DA" />
      <path d="M90 119 Q100 115 110 119 Q108 129 100 131 Q92 129 90 119Z" fill="#4C1D95" />
      <path
        d="M100 131 V137 M100 137 Q93 144 86 138 M100 137 Q107 144 114 138"
        stroke="#4C1D95"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

export function LionMascot({
  size = 48,
  variant = 'head',
  className,
}: {
  size?: number;
  variant?: 'head' | 'full';
  className?: string;
}) {
  if (variant === 'head') {
    return (
      <svg className={className} width={size} height={size} viewBox="8 12 184 184" aria-hidden="true" focusable="false">
        <Head />
      </svg>
    );
  }
  return (
    <svg
      className={className}
      width={size}
      height={(size * 250) / 220}
      viewBox="0 0 220 250"
      aria-hidden="true"
      focusable="false"
    >
      {/* backpack straps + hoodie */}
      <path d="M22 250 Q22 190 70 176 L150 176 Q198 190 198 250Z" fill="#4C1D95" />
      <path d="M22 250 Q22 190 70 176 L96 176 Q52 196 50 250Z" fill="#3A1670" opacity=".55" />
      <ellipse cx="110" cy="180" rx="56" ry="20" fill="#34125F" />
      <path d="M64 186 Q58 216 62 250 L80 250 Q74 214 82 190Z" fill="#FFB81C" />
      <path d="M156 186 Q162 216 158 250 L140 250 Q146 214 138 190Z" fill="#FFB81C" />
      <path d="M98 196 V222 M122 196 V222" stroke="#FFDA7A" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="98" cy="225" r="3.4" fill="#FFDA7A" />
      <circle cx="122" cy="225" r="3.4" fill="#FFDA7A" />
      <path
        d="M110 214 l4.7 9.6 10.6 1.5 -7.7 7.5 1.8 10.5 -9.4 -5 -9.4 5 1.8 -10.5 -7.7 -7.5 10.6 -1.5Z"
        fill="#FFC93C"
      />
      <g transform="translate(10 -6)">
        <Head />
      </g>
    </svg>
  );
}
