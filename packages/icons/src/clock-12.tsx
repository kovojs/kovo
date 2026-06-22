/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock 12 icon (Lucide). https://lucide.dev/icons/clock-12 */
export function Clock12(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6"></path>
    </svg>
  );
}
