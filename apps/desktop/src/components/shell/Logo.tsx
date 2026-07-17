/**
 * The wazzicode "W-cube" mark: a Unity-style isometric cube whose seams form
 * a W. Mirrors the app icon. `cut` is the color of the W seams — pass the
 * color of whatever surface the logo sits on.
 */
export default function Logo({
  size = 20,
  cut = "rgb(7 10 10)",
}: {
  size?: number;
  cut?: string;
}) {
  // Pointy-top hexagon, R=46 around (50,50); W points mirror the icon script.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 4px 12px rgb(var(--accent) / 0.16))" }}
    >
      {/* left face */}
      <polygon points="10.2,27 50,50 50,96 10.2,73" fill="rgb(var(--accent))" />
      {/* right face (shaded) */}
      <polygon points="50,50 89.8,27 89.8,73 50,96" fill="rgb(var(--glacier))" />
      {/* top face (lit) */}
      <polygon points="10.2,27 50,4 89.8,27 50,50" fill="rgb(var(--frost))" />
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
