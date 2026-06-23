/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Saudi Riyal icon (Lucide). https://lucide.dev/icons/saudi-riyal */
export function SaudiRiyal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m20 19.5-5.5 1.2"></path>
      <path d="M14.5 4v11.22a1 1 0 0 0 1.242.97L20 15.2"></path>
      <path d="m2.978 19.351 5.549-1.363A2 2 0 0 0 10 16V2"></path>
      <path d="M20 10 4 13.5"></path>
    </svg>
  );
}
