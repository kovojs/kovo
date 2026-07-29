import type { AppManifestEntry, DataflowBundle, RuntimeFrameStore } from './index.js';

export type NodeRequestHandler = (req: unknown, res: unknown) => void | Promise<void>;

export function createDevtoolApp(opts: {
  bundles: DataflowBundle[];
  base?: string;
  mode?: 'development' | 'production';
  runtimeFrames?: RuntimeFrameStore;
}): {
  app: unknown;
  requestHandler: unknown;
  nodeHandler: NodeRequestHandler;
  manifest: AppManifestEntry[];
  base: string;
  runtimeFrames?: RuntimeFrameStore;
};
