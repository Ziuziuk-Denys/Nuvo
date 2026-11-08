import { useEffect, useRef, useState, type CSSProperties } from "react";

const DWELL_MS = 1800;
const SPEED_PX_PER_S = 32;
const GAP_PX = 32;

/** Single-line text that, after a dwell, scrolls at constant speed only if it overflows. */
export function Marquee({ text }: { text: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState<{ text: string; shift: number } | null>(null);

  useEffect(() => {
    // Measured after the dwell, when the island has finished growing to its hover width.
    const timer = setTimeout(() => {
      const box = boxRef.current;
      const inner = textRef.current;
      if (!box || !inner) return;
      if (inner.scrollWidth > box.clientWidth) setMeasured({ text, shift: inner.scrollWidth + GAP_PX });
    }, DWELL_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const shift = measured?.text === text ? measured.shift : 0;
  const scrolling = shift > 0;
  const trackStyle = scrolling
    ? ({ "--marquee-shift": `${-shift}px`, animationDuration: `${(shift / SPEED_PX_PER_S).toFixed(2)}s` } as CSSProperties)
    : undefined;

  return (
    <span ref={boxRef} className="marquee" data-scrolling={scrolling}>
      <span className="marquee-track" style={trackStyle}>
        <span ref={textRef}>{text}</span>
        {scrolling && (
          <span aria-hidden="true" style={{ paddingLeft: GAP_PX }}>
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
