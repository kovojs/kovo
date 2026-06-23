/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Refrigerator icon (Lucide). https://lucide.dev/icons/refrigerator */
export function Refrigerator(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z"></path>
      <path d="M5 10h14"></path>
      <path d="M15 7v6"></path>
    </svg>
  );
}
