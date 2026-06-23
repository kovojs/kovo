/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** User Search icon (Lucide). https://lucide.dev/icons/user-search */
export function UserSearch(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="10" cy="7" r="4"></circle>
      <path d="M10.3 15H7a4 4 0 0 0-4 4v2"></path>
      <circle cx="17" cy="17" r="3"></circle>
      <path d="m21 21-1.9-1.9"></path>
    </svg>
  );
}
