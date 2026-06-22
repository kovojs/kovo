/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock 7 icon (Lucide). https://lucide.dev/icons/clock-7 */
export function Clock7(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l-2 4"></path>
    </svg>
  );
}
