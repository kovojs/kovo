/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Waves Horizontal icon (Lucide). https://lucide.dev/icons/waves-horizontal */
export function WavesHorizontal(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 12q2.5 2 5 0t5 0 5 0 5 0"></path>
      <path d="M2 19q2.5 2 5 0t5 0 5 0 5 0"></path>
      <path d="M2 5q2.5 2 5 0t5 0 5 0 5 0"></path>
    </svg>
  );
}
