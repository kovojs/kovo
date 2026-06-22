/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Airplay icon (Lucide). https://lucide.dev/icons/airplay */
export function Airplay(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"></path>
      <path d="m12 15 5 6H7Z"></path>
    </svg>
  );
}
