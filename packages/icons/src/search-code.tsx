/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Search Code icon (Lucide). https://lucide.dev/icons/search-code */
export function SearchCode(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m13 13.5 2-2.5-2-2.5"></path>
      <path d="m21 21-4.3-4.3"></path>
      <path d="M9 8.5 7 11l2 2.5"></path>
      <circle cx="11" cy="11" r="8"></circle>
    </svg>
  );
}
