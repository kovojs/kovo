/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cloud Moon icon (Lucide). https://lucide.dev/icons/cloud-moon */
export function CloudMoon(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6z"></path>
      <path d="M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36"></path>
    </svg>
  );
}
