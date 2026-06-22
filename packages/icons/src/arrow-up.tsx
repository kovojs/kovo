/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up icon (Lucide). https://lucide.dev/icons/arrow-up */
export function ArrowUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m5 12 7-7 7 7"></path>
      <path d="M12 19V5"></path>
    </svg>
  );
}
