/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Rotate Ccw Square icon (Lucide). https://lucide.dev/icons/rotate-ccw-square */
export function RotateCcwSquare(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 9V7a2 2 0 0 0-2-2h-6"></path>
      <path d="m15 2-3 3 3 3"></path>
      <path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"></path>
    </svg>
  );
}
