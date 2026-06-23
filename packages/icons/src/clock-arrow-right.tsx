/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Clock Arrow Right icon (Lucide). https://lucide.dev/icons/clock-arrow-right */
export function ClockArrowRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6v6l2 1"></path>
      <path d="M13.5 21.885A10 10 0 1 1 22 12"></path>
      <path d="M14 18h8"></path>
      <path d="m18 22 4-4-4-4"></path>
    </svg>
  );
}
