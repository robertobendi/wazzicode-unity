import { useId } from "react";

/**
 * The wazzicode "W-cube" mark: a Unity-style isometric cube whose seams form
 * a W. Mirrors the app icon. `cut` is the color of the W seams — pass the
 * color of whatever surface the logo sits on.
 */
export default function Logo({
  size = 20,
  cut = "rgb(5 5 8)",
}: {
  size?: number;
  cut?: string;
}) {
  const gradientId = useId();

  // Pointy-top hexagon, R=46 around (50,50); W points mirror the icon script.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 6px 14px rgb(0 0 0 / 0.36))" }}
    >
      <defs>
        <linearGradient id={`${gradientId}-left`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--spectrum-violet))" />
          <stop offset="1" stopColor="rgb(var(--spectrum-rose))" />
        </linearGradient>
        <linearGradient id={`${gradientId}-right`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--spectrum-blue))" />
          <stop offset="1" stopColor="rgb(var(--spectrum-cyan))" />
        </linearGradient>
        <linearGradient id={`${gradientId}-top`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="rgb(var(--spectrum-rose))" />
          <stop offset="1" stopColor="rgb(var(--spectrum-amber))" />
        </linearGradient>
      </defs>
      {/* left face */}
      <polygon points="10.2,27 50,50 50,96 10.2,73" fill={`url(#${gradientId}-left)`} />
      {/* right face (shaded) */}
      <polygon points="50,50 89.8,27 89.8,73 50,96" fill={`url(#${gradientId}-right)`} />
      {/* top face (lit) */}
      <polygon points="10.2,27 50,4 89.8,27 50,50" fill={`url(#${gradientId}-top)`} />
      {/* the W seams, stroked in the surface color */}
      <polyline
        points="20,18 36,88 50,51 64,88 80,18"
        fill="none"
        stroke={cut}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
