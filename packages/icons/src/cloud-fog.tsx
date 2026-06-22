/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cloud Fog icon (Lucide). https://lucide.dev/icons/cloud-fog */
export function CloudFog(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
      <path d="M16 17H7"></path>
      <path d="M17 21H9"></path>
    </svg>
  );
}
