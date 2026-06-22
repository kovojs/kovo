/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Heater icon (Lucide). https://lucide.dev/icons/heater */
export function Heater(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 8c2-3-2-3 0-6"></path>
      <path d="M15.5 8c2-3-2-3 0-6"></path>
      <path d="M6 10h.01"></path>
      <path d="M6 14h.01"></path>
      <path d="M10 16v-4"></path>
      <path d="M14 16v-4"></path>
      <path d="M18 16v-4"></path>
      <path d="M20 6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"></path>
      <path d="M5 20v2"></path>
      <path d="M19 20v2"></path>
    </svg>
  );
}
