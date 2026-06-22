/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List icon (Lucide). https://lucide.dev/icons/list */
export function List(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5h.01"></path>
      <path d="M3 12h.01"></path>
      <path d="M3 19h.01"></path>
      <path d="M8 5h13"></path>
      <path d="M8 12h13"></path>
      <path d="M8 19h13"></path>
    </svg>
  );
}
