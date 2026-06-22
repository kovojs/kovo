/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock 9 icon (Lucide). https://lucide.dev/icons/clock-9 */
export function Clock9(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6H8"></path>
    </svg>
  );
}
