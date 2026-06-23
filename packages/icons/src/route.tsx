/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Route icon (Lucide). https://lucide.dev/icons/route */
export function Route(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="6" cy="19" r="3"></circle>
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"></path>
      <circle cx="18" cy="5" r="3"></circle>
    </svg>
  );
}
