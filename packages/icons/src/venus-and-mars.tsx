/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Venus And Mars icon (Lucide). https://lucide.dev/icons/venus-and-mars */
export function VenusAndMars(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 20h4"></path>
      <path d="M12 16v6"></path>
      <path d="M17 2h4v4"></path>
      <path d="m21 2-5.46 5.46"></path>
      <circle cx="12" cy="11" r="5"></circle>
    </svg>
  );
}
