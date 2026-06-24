/**
 * DeepFamily Logo Component
 * Custom tree-based logo for the DeepFamily application
 */
interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = "w-10 h-10", size }: LogoProps) {
  const width = size ?? undefined;
  const height = size ?? undefined;

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
          id="brand-gradient"
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
        stroke="url(#brand-gradient)"
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
