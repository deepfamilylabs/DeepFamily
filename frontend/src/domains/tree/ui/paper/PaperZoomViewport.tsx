import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PAPER_PREVIEW_MAX_WIDTH_PX } from "./paperStyles";

export interface PaperZoomViewportProps {
  fontScale?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

// Scales the whole paper sheet for preview while keeping scrollbars accurate. CSS `zoom` does not
// expand the layout box, so overflow parents clip the right/bottom edge; `transform: scale` with an
// explicit spacer sized to (content × scale) is the reliable cross-browser pattern.
export function PaperZoomViewport({
  fontScale = 1,
  className,
  style,
  children,
}: PaperZoomViewportProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 });
  const scale = fontScale > 0 ? fontScale : 1;

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || typeof window === "undefined") return undefined;

    let frame = 0;
    const measure = () => {
      const width = Math.max(el.scrollWidth, el.offsetWidth);
      const height = Math.max(el.scrollHeight, el.offsetHeight);
      setBaseSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    measure();
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(el);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [children, scale]);

  if (scale === 1) {
    return (
      <div
        ref={contentRef}
        data-paper-zoom
        className={className}
        style={{
          ...style,
          width: "100%",
          maxWidth: PAPER_PREVIEW_MAX_WIDTH_PX,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {children}
      </div>
    );
  }

  const baseWidth = Math.max(baseSize.width, PAPER_PREVIEW_MAX_WIDTH_PX);
  const scaledWidth = Math.ceil(baseWidth * scale);
  const scaledHeight =
    baseSize.height > 0 ? Math.ceil(baseSize.height * scale) : undefined;

  return (
    <div
      data-paper-zoom-spacer
      className="mx-auto shrink-0"
      style={{
        width: scaledWidth,
        minWidth: scaledWidth,
        height: scaledHeight,
        minHeight: scaledHeight,
      }}
    >
      <div
        ref={contentRef}
        data-paper-zoom
        className={className}
        style={{
          ...style,
          width: baseWidth,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
