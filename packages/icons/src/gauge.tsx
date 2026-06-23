/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Gauge icon (Lucide). https://lucide.dev/icons/gauge */
export function Gauge(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m12 14 4-4"></path>
      <path d="M3.34 19a10 10 0 1 1 17.32 0"></path>
    </svg>
  );
}
