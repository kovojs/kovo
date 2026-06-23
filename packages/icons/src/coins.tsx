/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Coins icon (Lucide). https://lucide.dev/icons/coins */
export function Coins(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"></path>
      <path d="M15 6h1v4"></path>
      <path d="m6.134 14.768.866-.5 2 3.464"></path>
      <circle cx="16" cy="8" r="6"></circle>
    </svg>
  );
}
