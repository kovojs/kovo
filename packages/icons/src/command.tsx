/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Command icon (Lucide). https://lucide.dev/icons/command */
export function Command(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"></path>
    </svg>
  );
}
