/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Wind Arrow Down icon (Lucide). https://lucide.dev/icons/wind-arrow-down */
export function WindArrowDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 2v8"></path>
      <path d="M12.8 21.6A2 2 0 1 0 14 18H2"></path>
      <path d="M17.5 10a2.5 2.5 0 1 1 2 4H2"></path>
      <path d="m6 6 4 4 4-4"></path>
    </svg>
  );
}
