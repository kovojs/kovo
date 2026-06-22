/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Rotate Cw Square icon (Lucide). https://lucide.dev/icons/rotate-cw-square */
export function RotateCwSquare(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 5H6a2 2 0 0 0-2 2v3"></path>
      <path d="m9 8 3-3-3-3"></path>
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
    </svg>
  );
}
