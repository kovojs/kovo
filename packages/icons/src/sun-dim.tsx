/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Sun Dim icon (Lucide). https://lucide.dev/icons/sun-dim */
export function SunDim(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 4h.01"></path>
      <path d="M20 12h.01"></path>
      <path d="M12 20h.01"></path>
      <path d="M4 12h.01"></path>
      <path d="M17.657 6.343h.01"></path>
      <path d="M17.657 17.657h.01"></path>
      <path d="M6.343 17.657h.01"></path>
      <path d="M6.343 6.343h.01"></path>
    </svg>
  );
}
