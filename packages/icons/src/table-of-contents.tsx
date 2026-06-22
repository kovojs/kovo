/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Table Of Contents icon (Lucide). https://lucide.dev/icons/table-of-contents */
export function TableOfContents(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M16 12H3"></path>
      <path d="M16 19H3"></path>
      <path d="M21 5h.01"></path>
      <path d="M21 12h.01"></path>
      <path d="M21 19h.01"></path>
    </svg>
  );
}
