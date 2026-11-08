import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, viewBox = "0 0 24 24", children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="currentColor" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function NuvoGlyph({ size = 18, ...rest }: IconProps) {
  return (
    <Icon size={size} viewBox="16 16 224 224" {...rest}>
      <path d="M32 62 A30 30 0 0 1 62 32 L87.92 32 A14 14 0 0 1 100.04 39 L130.14 91.14 A16 16 0 0 0 160 83.14 L160 50 A18 18 0 0 1 178 32 L194 32 A30 30 0 0 1 224 62 L224 194 A30 30 0 0 1 194 224 L168.08 224 A14 14 0 0 1 155.96 217 L125.86 164.86 A16 16 0 0 0 96 172.86 L96 206 A18 18 0 0 1 78 224 L62 224 A30 30 0 0 1 32 194 Z" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 5.14v13.72c0 .8.87 1.3 1.56.9l11.03-6.86a1.05 1.05 0 0 0 0-1.8L8.56 4.24C7.87 3.83 7 4.33 7 5.14Z" />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.4" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.4" />
    </Icon>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 7.1c0-1 1.1-1.62 1.96-1.1l7.04 4.4c.8.5.8 1.68 0 2.18l-7.04 4.4c-.86.53-1.96-.09-1.96-1.1V7.12Z" />
      <path d="M12 7.1c0-1 1.1-1.62 1.96-1.1l7.04 4.4c.8.5.8 1.68 0 2.18l-7.04 4.4c-.86.53-1.96-.09-1.96-1.1V7.12Z" />
    </Icon>
  );
}

export function PreviousIcon(props: IconProps) {
  return <NextIcon {...props} style={{ transform: "scaleX(-1)" }} />;
}

export function HeartIcon({ filled, ...props }: IconProps & { filled: boolean }) {
  const d =
    "M12 20.3c-.25 0-.5-.08-.7-.23C7.1 17 3.5 13.9 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3 .8 4 2.1C13 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 4.3-3.6 7.4-7.8 10.47-.2.15-.45.23-.7.23Z";
  return <Icon {...props}>{filled ? <path d={d} /> : <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" />}</Icon>;
}

export function SpeakerIcon({ louder, ...props }: IconProps & { louder: boolean }) {
  return (
    <Icon {...props}>
      <path d="M4 9.2c0-.66.54-1.2 1.2-1.2h2.6l4.1-3.3c.65-.52 1.6-.06 1.6.77v13.06c0 .83-.95 1.29-1.6.77L7.8 16H5.2c-.66 0-1.2-.54-1.2-1.2V9.2Z" />
      {louder ? (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M16.5 9.5a3.6 3.6 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </Icon>
  );
}
