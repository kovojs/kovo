/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Locate Fixed icon (Lucide). https://lucide.dev/icons/locate-fixed */
export function LocateFixed(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="2" x2="5" y1="12" y2="12"></line>
      <line x1="19" x2="22" y1="12" y2="12"></line>
      <line x1="12" x2="12" y1="2" y2="5"></line>
      <line x1="12" x2="12" y1="19" y2="22"></line>
      <circle cx="12" cy="12" r="7"></circle>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  );
}
