/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock 10 icon (Lucide). https://lucide.dev/icons/clock-10 */
export function Clock10(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l-4-2"></path>
    </svg>
  );
}
