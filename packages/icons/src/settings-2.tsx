/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Settings 2 icon (Lucide). https://lucide.dev/icons/settings-2 */
export function Settings2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 17H5"></path>
      <path d="M19 7h-9"></path>
      <circle cx="17" cy="17" r="3"></circle>
      <circle cx="7" cy="7" r="3"></circle>
    </svg>
  );
}
