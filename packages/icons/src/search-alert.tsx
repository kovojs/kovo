/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Search Alert icon (Lucide). https://lucide.dev/icons/search-alert */
export function SearchAlert(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.3-4.3"></path>
      <path d="M11 7v4"></path>
      <path d="M11 15h.01"></path>
    </svg>
  );
}
