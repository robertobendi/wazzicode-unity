import { useId } from "react";

export default function Logo({ size = 20 }: { size?: number }) {
  const filterId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id={filterId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
            result="fused"
          />
          <feComposite in="SourceGraphic" in2="fused" operator="atop" />
        </filter>
      </defs>
      <rect x="40" y="40" width="944" height="944" rx="224" fill="#C9D9F2" />
      <g
        fill="#11110f"
        transform="matrix(2.6666667 0 0 2.6666667 -128 -320)"
      >
        <g filter={`url(#${filterId})`}>
          <rect x="120" y="216" width="48" height="192" rx="12" />
          <rect x="120" y="360" width="96" height="48" rx="12" />
        </g>
        <g filter={`url(#${filterId})`}>
          <rect x="312" y="216" width="48" height="192" rx="12" />
          <rect x="264" y="360" width="96" height="48" rx="12" />
        </g>
        <rect x="216" y="216" width="48" height="96" rx="12" />
      </g>
    </svg>
  );
}
