/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Scooter icon (Lucide). https://lucide.dev/icons/scooter */
export function Scooter(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 4h-3.5l2 11.05"></path>
      <path d="M6.95 17h5.142c.523 0 .95-.406 1.063-.916a6.5 6.5 0 0 1 5.345-5.009"></path>
      <circle cx="19.5" cy="17.5" r="2.5"></circle>
      <circle cx="4.5" cy="17.5" r="2.5"></circle>
    </svg>
  );
}
