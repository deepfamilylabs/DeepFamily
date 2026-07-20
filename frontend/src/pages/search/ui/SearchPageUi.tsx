import { ChevronDown } from "lucide-react";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { formatHashMiddle } from "../../../shared/model";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="text-xs text-red-500 font-medium leading-snug whitespace-normal wrap-break-word w-full mt-1 ml-1">
      {message}
    </div>
  );
}

export function SectionCard({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-3xl bg-white dark:bg-black border border-gray-100 dark:border-gray-800 transition-all duration-500 ${isOpen ? "shadow-2xl shadow-gray-200/50 dark:shadow-gray-900/50" : "shadow-xs hover:shadow-md"}`}
    >
      <div
        className="p-6 flex items-center justify-between cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-4">
          <div
            className={`w-1.5 h-6 rounded-full bg-linear-to-b from-orange-400 to-red-500 transition-all duration-500 ${isOpen ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"}`}
          />
          <h3
            className={`text-lg font-bold transition-all duration-300 ${isOpen ? "bg-clip-text text-transparent bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400" : "text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200"}`}
          >
            {title}
          </h3>
        </div>
        <button
          type="button"
          className={`flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-500 transition-all duration-300 group-hover:scale-110 ${isOpen ? "rotate-180 bg-white dark:bg-black shadow-lg text-orange-500" : ""}`}
        >
          <ChevronDown size={20} />
        </button>
      </div>
      <div
        className={`transition-all duration-500 ease-in-out overflow-hidden ${isOpen ? "max-h-[50000px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="p-6 pt-0">{children}</div>
      </div>
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = "", ...props }, ref) => (
  <input
    ref={ref}
    className={`w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all duration-300 ${className}`}
    {...props}
  />
));
Input.displayName = "Input";

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

export function ButtonSecondary({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`px-6 py-2.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-700 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-300 flex items-center justify-center gap-2 ${className}`}
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
