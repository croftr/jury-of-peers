import { useId } from "react";
import type { AvatarSpec } from "@/lib/types";

type Mood = "idle" | "thinking" | "decided";

/**
 * A procedurally-assembled portrait. Every juror gets a distinct face from a
 * fixed set of parts, so twelve seats read as twelve people rather than twelve
 * icons. Hair is drawn in two passes — the mass behind the head, the cap in
 * front — so long styles frame the face instead of covering it.
 */
export default function JurorAvatar({
  spec,
  mood = "idle",
  className = "",
}: {
  spec: AvatarSpec;
  mood?: Mood;
  className?: string;
}) {
  const shade = darken(spec.skin);
  const thinking = mood === "thinking";
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clip = `clip-${uid}`;
  const grad = `grad-${uid}`;
  const style = spec.hairStyle % 10;

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={spec.garment} />
          <stop offset="100%" stopColor={darken(spec.garment)} />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${clip})`}>
        <rect width="100" height="100" fill="#12151b" />
        <circle cx="50" cy="34" r="42" fill="#1a1f28" />

        <HairBack style={style} color={spec.hair} />

        {/* shoulders */}
        <path
          d="M50 68c-19 0-32 10-36 24-1.5 5-2 9-2 12h76c0-3-.5-7-2-12-4-14-17-24-36-24Z"
          fill={`url(#${grad})`}
        />
        {/* collar */}
        <path d="M42 70l8 12 8-12-8-4-8 4Z" fill={lighten(spec.garment)} opacity="0.85" />

        {/* neck */}
        <path d="M42 56h16v14c0 3-16 3-16 0V56Z" fill={shade} />

        {/* ears */}
        <ellipse cx="30" cy="46" rx="3.6" ry="5" fill={spec.skin} />
        <ellipse cx="70" cy="46" rx="3.6" ry="5" fill={spec.skin} />
        {spec.earrings && (
          <>
            <circle cx="30" cy="51.5" r="1.7" fill="#e6c14a" />
            <circle cx="70" cy="51.5" r="1.7" fill="#e6c14a" />
          </>
        )}

        {/* head */}
        <ellipse cx="50" cy="44" rx="19" ry="22" fill={spec.skin} />

        <HairFront style={style} color={spec.hair} />

        {/* brows — furrowed while deliberating */}
        <path
          d={thinking ? "M39 36.5l9 2.2" : "M39 36l9 0.6"}
          stroke={spec.hair}
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={thinking ? "M61 36.5l-9 2.2" : "M61 36l-9 0.6"}
          stroke={spec.hair}
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />

        {/* eyes — narrowed in concentration while deliberating */}
        {thinking ? (
          <>
            <path d="M41 43.5h6" stroke="#20242c" strokeWidth="2" strokeLinecap="round" />
            <path d="M53 43.5h6" stroke="#20242c" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="44" cy="43.5" rx="2.6" ry="2.9" fill="#f4f1ea" />
            <ellipse cx="56" cy="43.5" rx="2.6" ry="2.9" fill="#f4f1ea" />
            <circle cx="44.4" cy="43.8" r="1.5" fill="#1d222b" />
            <circle cx="56.4" cy="43.8" r="1.5" fill="#1d222b" />
          </>
        )}

        {/* nose + mouth */}
        <path
          d="M50 46v4.5l2.4 1.4"
          stroke={shade}
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={
            mood === "decided"
              ? "M45 56.5c2.6 2 7.4 2 10 0"
              : thinking
                ? "M45.5 57h9"
                : "M45.5 56.6c3 1.2 6 1.2 9 0"
          }
          stroke={darken(shade)}
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />

        {spec.facialHair && (
          <path
            d="M33 47c0 12 7 21 17 21s17-9 17-21c0 0-3 9-17 9s-17-9-17-9Z"
            fill={spec.hair}
            opacity="0.92"
          />
        )}

        {spec.glasses && (
          <g stroke="#d6d9df" strokeWidth="1.4" fill="rgba(200,220,255,0.09)">
            <rect x="38.5" y="39.5" width="11" height="8" rx="3" />
            <rect x="50.5" y="39.5" width="11" height="8" rx="3" />
            <path d="M49.5 43h1M31.5 42l7 0.8M68.5 42l-7 0.8" fill="none" />
          </g>
        )}
      </g>
    </svg>
  );
}

/** Volume that sits behind the head: long lengths, afros, buns, ponytails. */
function HairBack({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 3: // long, framing
      return <path d="M28 78c-3-14-2-30 1-40 3-11 10-17 21-17s18 6 21 17c3 10 4 26 1 40-2-14-4-28-6-38-4 6-9 8-16 8s-12-2-16-8c-2 10-4 24-6 38Z" fill={color} />;
    case 4: // afro
      return <circle cx="50" cy="38" r="25" fill={color} />;
    case 5: // top bun
      return <circle cx="50" cy="17" r="7.5" fill={color} />;
    case 6: // wavy, shoulder length
      return <path d="M27 72c-2-13-1-26 3-34 3-8 10-13 20-13s17 5 20 13c4 8 5 21 3 34-2-8-4-17-5-25-5 6-11 8-18 8s-13-2-18-8c-1 8-3 17-5 25Z" fill={color} />;
    case 7: // curls
      return (
        <>
          {[
            [34, 27],
            [44, 21],
            [55, 21],
            [65, 27],
            [69, 37],
            [31, 37],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="9" fill={color} />
          ))}
        </>
      );
    case 9: // ponytail
      return <path d="M66 30c8 2 12 9 12 18s-3 15-7 19c2-9 1-17-1-23s-4-10-4-14Z" fill={color} />;
    default:
      return null;
  }
}

/** The cap that overlays the crown of the head. */
function HairFront({ style, color }: { style: number; color: string }) {
  const crop = "M30.6 44c-1.4-15 7.6-23 19.4-23s20.8 8 19.4 23c-2-8-6-12-19.4-12s-17.4 4-19.4 12Z";
  switch (style) {
    case 1: // buzz / receded
      return (
        <path
          d="M31.4 42c0-12 8-19 18.6-19s18.6 7 18.6 19c-2-6-6.6-8-10.6-7-3 1-4 3-8 3s-5-2-8-3c-4-1-8.6 1-10.6 7Z"
          fill={color}
        />
      );
    case 2: // side part
      return (
        <path
          d="M30.6 46c-1.6-16 7.4-25 19.4-25 10 0 17.6 6 18.6 15 .4 4-.6 7-1.4 9-.6-7-4-11-10-12-6-1-12 4-16.6 3-3-.6-5.4 2-6.6 5-.8 2-1.2 4-1.4 5h-2Z"
          fill={color}
        />
      );
    case 8: // swept back, thinning
      return (
        <path
          d="M32.4 40c1-12 8.6-18 17.6-18s17 6 17.8 17c-3-5-7.6-7-12.6-6-4 .8-5.6 2-9.6 2s-5.6-1-8.6-1c-2.4 0-3.8 2-4.6 6Z"
          fill={color}
        />
      );
    case 4: // afro — the crown is already behind; just a soft edge
      return <path d={crop} fill={color} opacity="0.55" />;
    default:
      return <path d={crop} fill={color} />;
  }
}

function shift(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const darken = (hex: string) => shift(hex, -26);
const lighten = (hex: string) => shift(hex, 22);
