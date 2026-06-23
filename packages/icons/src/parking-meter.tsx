/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Parking Meter icon (Lucide). https://lucide.dev/icons/parking-meter */
export function ParkingMeter(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 15h2"></path>
      <path d="M12 12v3"></path>
      <path d="M12 19v3"></path>
      <path d="M15.282 19a1 1 0 0 0 .948-.68l2.37-6.988a7 7 0 1 0-13.2 0l2.37 6.988a1 1 0 0 0 .948.68z"></path>
      <path d="M9 9a3 3 0 1 1 6 0"></path>
    </svg>
  );
}
