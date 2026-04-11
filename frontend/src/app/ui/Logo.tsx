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
      viewBox="4 2 32 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="brand-gradient"
          x1="4"
          y1="2"
          x2="32"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke="url(#brand-gradient)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M 8 6
             L 20 6
             C 24 6, 28 10, 28 16
             C 28 22, 24 26, 20 26
             L 8 26"
        />

        <line x1="8" y1="16" x2="32" y2="16" />
      </g>
    </svg>
  );
}
