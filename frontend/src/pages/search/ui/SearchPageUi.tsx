import React, { useEffect, useRef, useState } from "react";
import { formatHashMiddle } from "../../../shared/model";

export function ButtonPrimary({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 font-medium text-white shadow-sm shadow-primary/30 transition-colors duration-200 hover:bg-primary-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary ${className}`}
      {...props}
    />
  );
}

export function HashInline({
  value,
  className = "",
  titleText,
  prefix = 10,
  suffix = 8,
}: {
  value: string;
  className?: string;
  titleText?: string;
  prefix?: number;
  suffix?: number;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState<string>(value);

  useEffect(() => {
    const recompute = () => {
      const container = containerRef.current;
      const meas = measureRef.current;
      if (!container || !meas) return;
      meas.textContent = value;
      const fits = meas.scrollWidth <= container.clientWidth;
      setDisplay(fits ? value : formatHashMiddle(value, prefix, suffix));
    };

    recompute();
    const ro = new ResizeObserver(() => recompute());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [value, prefix, suffix]);

  return (
    <>
      <span
        ref={containerRef}
        className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`}
        title={titleText ?? value}
      >
        {display}
      </span>
      <span
        ref={measureRef}
        className={`absolute left-[-99999px] top-0 invisible whitespace-nowrap ${className}`}
      />
    </>
  );
}
