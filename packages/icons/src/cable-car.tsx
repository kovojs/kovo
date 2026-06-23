/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Cable Car icon (Lucide). https://lucide.dev/icons/cable-car */
export function CableCar(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 3h.01"></path>
      <path d="M14 2h.01"></path>
      <path d="m2 9 20-5"></path>
      <path d="M12 12V6.5"></path>
      <rect width="16" height="10" x="4" y="12" rx="3"></rect>
      <path d="M9 12v5"></path>
      <path d="M15 12v5"></path>
      <path d="M4 17h16"></path>
    </svg>
  );
}
