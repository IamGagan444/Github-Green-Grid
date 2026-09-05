import type { SVGProps } from "react";

/**
 * GitHub mark. Inlined because lucide-react no longer ships brand icons.
 * Decorative by default; pass an `aria-label` to expose it.
 */
export function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      {...props}
    >
      <path d="M12 .5C5.73.5.67 5.58.67 11.86c0 5.02 3.24 9.28 7.74 10.78.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.1-3.15.69-3.82-1.34-3.82-1.34-.51-1.32-1.25-1.67-1.25-1.67-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.74 2.65 1.24 3.3.95.1-.74.4-1.24.72-1.53-2.52-.29-5.17-1.26-5.17-5.62 0-1.24.44-2.26 1.16-3.05-.12-.29-.5-1.44.11-3 0 0 .95-.3 3.1 1.17a10.7 10.7 0 0 1 5.65 0c2.15-1.47 3.1-1.17 3.1-1.17.61 1.56.23 2.71.11 3 .72.79 1.16 1.81 1.16 3.05 0 4.37-2.66 5.33-5.19 5.61.41.36.77 1.06.77 2.13 0 1.54-.01 2.79-.01 3.17 0 .3.2.66.79.55 4.5-1.5 7.73-5.76 7.73-10.78C23.33 5.58 18.27.5 12 .5Z" />
    </svg>
  );
}
