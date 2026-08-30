import React, { useEffect, useRef, useState } from "react";
import { formatHashMiddle } from "../../../shared/model";

export function ButtonPrimary({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`px-6 py-2.5 rounded-full bg-linear-to-r from-orange-400 to-red-500 text-white font-medium shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-300 flex items-center justify-center gap-2 ${className}`}
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
