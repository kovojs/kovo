/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Text Quote icon (Lucide). https://lucide.dev/icons/text-quote */
export function TextQuote(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17 5H3"></path>
      <path d="M21 12H8"></path>
      <path d="M21 19H8"></path>
      <path d="M3 12v7"></path>
    </svg>
  );
}
