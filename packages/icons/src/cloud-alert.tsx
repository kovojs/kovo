/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Cloud Alert icon (Lucide). https://lucide.dev/icons/cloud-alert */
export function CloudAlert(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 12v4"></path>
      <path d="M12 20h.01"></path>
      <path d="M8.128 16.949A7 7 0 1 1 15.71 8h1.79a1 1 0 0 1 0 9h-1.642"></path>
    </svg>
  );
}
