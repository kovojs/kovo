/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down icon (Lucide). https://lucide.dev/icons/arrow-down */
export function ArrowDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 5v14"></path>
      <path d="m19 12-7 7-7-7"></path>
    </svg>
  );
}
