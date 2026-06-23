/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Utility Pole icon (Lucide). https://lucide.dev/icons/utility-pole */
export function UtilityPole(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2v20"></path>
      <path d="M2 5h20"></path>
      <path d="M3 3v2"></path>
      <path d="M7 3v2"></path>
      <path d="M17 3v2"></path>
      <path d="M21 3v2"></path>
      <path d="m19 5-7 7-7-7"></path>
    </svg>
  );
}
