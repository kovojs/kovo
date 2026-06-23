/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Antenna icon (Lucide). https://lucide.dev/icons/antenna */
export function Antenna(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 12 7 2"></path>
      <path d="m7 12 5-10"></path>
      <path d="m12 12 5-10"></path>
      <path d="m17 12 5-10"></path>
      <path d="M4.5 7h15"></path>
      <path d="M12 16v6"></path>
    </svg>
  );
}
