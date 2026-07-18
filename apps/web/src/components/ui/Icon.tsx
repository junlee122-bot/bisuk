import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "box"
  | "check"
  | "clock"
  | "compass"
  | "document"
  | "download"
  | "layers"
  | "plus"
  | "search"
  | "shield"
  | "spark"
  | "warning";

const paths: Record<IconName, ReactNode> = {
  "arrow-left": <path d="m15 18-6-6 6-6M9 12h11" />,
  "arrow-right": <path d="m9 18 6-6-6-6m6 6H4" />,
  box: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m8-4.5-8 4.5-8-4.5" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2" />,
  compass: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z" />,
  document: <path d="M7 3h7l4 4v14H7V3Zm7 0v5h4M10 12h5m-5 4h5" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <path d="m20 20-4.5-4.5M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />,
  shield: <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Zm-3-10 2 2 4-5" />,
  spark: <path d="m12 2 1.4 5.6L19 9l-5.6 1.4L12 16l-1.4-5.6L5 9l5.6-1.4L12 2Zm7 13 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />,
  warning: <path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3h.01" />,
};

export function Icon({ name, className = "h-4 w-4", ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
