/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** List Filter icon (Lucide). https://lucide.dev/icons/list-filter */
export function ListFilter(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 5h20"></path>
      <path d="M6 12h12"></path>
      <path d="M9 19h6"></path>
    </svg>
  );
}
