import type { CSSProperties, HTMLAttributes } from 'react';

const PAPER = '#f7f4ee';
const INK = '#102a43';
const DEFAULT_WAX = '#b84b3a';

export type SealMarkSize = 'sm' | 'md' | 'lg' | 'xl';

export interface SealMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  color?: string;
  /** Optional legacy/analytics identifier; it does not determine the visual mark. */
  sealId?: string | null;
  /** A symbol or short mark. It is used when monogram is not supplied. */
  mark?: string;
  /** A one- or two-character personal signet; takes precedence over mark. */
  monogram?: string;
  size?: SealMarkSize;
  /** Use null, or decorative=true, when the seal is already described by nearby text. */
  label?: string | null;
  decorative?: boolean;
}

const SIZE_CONFIG: Record<SealMarkSize, { dimension: number; markSize: number; letterSpacing: number }> = {
  sm: { dimension: 40, markSize: 24, letterSpacing: 0.5 },
  md: { dimension: 56, markSize: 31, letterSpacing: 0.8 },
  lg: { dimension: 76, markSize: 40, letterSpacing: 1.2 },
  xl: { dimension: 104, markSize: 54, letterSpacing: 1.6 },
};

function limitMark(value: string, maximumCharacters: number): string {
  return Array.from(value.trim()).slice(0, maximumCharacters).join('');
}

const SAFE_MARKS: Record<string, string> = {
  heart: 'H',
  monogram: 'M',
  crest: 'C',
  blossom: 'B',
  fern: 'F',
  compass: 'W',
};

function getDisplayMark(mark: string | undefined, monogram: string | undefined, sealId?: string | null): string {
  const cleanMonogram = monogram?.trim();
  if (cleanMonogram) return limitMark(cleanMonogram.toUpperCase(), 2);

  const cleanMark = mark?.trim();
  // Keep the interface independent of platform emoji fonts. Seal marks shown in
  // the UI are intentionally short typographic initials instead.
  return cleanMark && /^[A-Za-z0-9]{1,2}$/.test(cleanMark)
    ? limitMark(cleanMark.toUpperCase(), 2)
    : SAFE_MARKS[sealId || ''] || 'D';
}

export function SealMark({
  color = DEFAULT_WAX,
  sealId,
  mark,
  monogram,
  size = 'md',
  label,
  decorative = false,
  className,
  style,
  ...props
}: SealMarkProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const displayMark = getDisplayMark(mark, monogram, sealId);
  const isDecorative = decorative || label === null;
  const accessibleLabel = isDecorative ? undefined : label?.trim() || 'Wax seal';
  const sealStyle: CSSProperties = {
    ...style,
    width: sizeConfig.dimension,
    height: sizeConfig.dimension,
    color,
    backgroundColor: color,
    borderRadius: '50%',
    flex: '0 0 auto',
    boxShadow: '0 2px 8px rgba(16, 42, 67, 0.12)',
  };

  return (
    <span
      {...props}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-[#f7f4ee]/[0.58] ${className || ''}`.trim()}
      style={sealStyle}
      role={isDecorative ? undefined : 'img'}
      aria-label={accessibleLabel}
      aria-hidden={isDecorative ? true : undefined}
      data-seal-size={size}
      data-seal-id={sealId ?? undefined}
    >
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="50" cy="50" r="47" fill={color} stroke={INK} strokeOpacity="0.18" strokeWidth="1" />
        <circle cx="50" cy="50" r="39.5" fill="none" stroke={PAPER} strokeOpacity="0.46" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="43.5" fill="none" stroke={PAPER} strokeOpacity="0.16" strokeWidth="1" />
        <text
          x="50"
          y="57"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize={sizeConfig.markSize}
          fontWeight="600"
          letterSpacing={displayMark.length > 1 ? sizeConfig.letterSpacing : 0}
          fill={PAPER}
        >
          {displayMark}
        </text>
      </svg>
    </span>
  );
}
