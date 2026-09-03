/**
 * DeepFamily Logo Component
 * Custom tree-based logo for the DeepFamily application
 */
import { useId } from "react";

interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = "w-10 h-10", size }: LogoProps) {
  const width = size ?? undefined;
  const height = size ?? undefined;
  // Every instance needs its own gradient id: `url(#id)` resolves to the first
  // match in the document, so a shared id lets a hidden copy (the header brand
  // below `md`, say) steal the reference and paint nothing.
  const gradientId = `brand-gradient-${useId().replace(/:/g, "")}`;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="14"
          y1="14"
          x2="114"
          y2="114"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#F8843E" />
          <stop offset="1" stopColor="#F04E33" />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16 64 H116" />
        <path d="M16 24 H66 Q88 24 102 58" />
        <path d="M16 104 H66 Q88 104 102 70" />
      </g>
    </svg>
  );
}
