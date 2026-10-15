import { useId, type SVGProps } from "react";

/**
 * Instagram glyph. Inlined because lucide-react no longer ships brand icons.
 * Decorative by default; pass an `aria-label` to expose it.
 */
export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      {...props}
    >
      <defs>
        <radialGradient id={gradientId} cx="30%" cy="107%" r="150%">
          <stop offset="0" stopColor="#FDF497" />
          <stop offset="0.05" stopColor="#FDF497" />
          <stop offset="0.45" stopColor="#FD5949" />
          <stop offset="0.6" stopColor="#D6249F" />
          <stop offset="0.9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill={`url(#${gradientId})`} />
      <rect x="6.5" y="6.5" width="11" height="11" rx="5.5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.15" fill="#fff" />
    </svg>
  );
}
