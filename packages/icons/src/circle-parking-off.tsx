/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Parking Off icon (Lucide). https://lucide.dev/icons/circle-parking-off */
export function CircleParkingOff(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12.656 7H13a3 3 0 0 1 2.984 3.307"></path>
      <path d="M13 13H9"></path>
      <path d="M19.071 19.071A1 1 0 0 1 4.93 4.93"></path>
      <path d="m2 2 20 20"></path>
      <path d="M8.357 2.687a10 10 0 0 1 12.956 12.956"></path>
      <path d="M9 17V9"></path>
    </svg>
  );
}
