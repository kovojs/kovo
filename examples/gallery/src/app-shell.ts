import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  route,
  toNodeHandler,
} from '@jiso/server';

import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const galleryGeneratedRoot = fileURLToPath(new URL('./generated/interactive/', import.meta.url));
const galleryInteractiveClientModules = createMemoryVersionedClientModuleRegistry();

export const galleryInteractiveClientModuleHrefs = Object.freeze(
  interactiveGalleryDemos.map((demo) => registerGalleryInteractiveClientModule(demo.name)),
);

export const galleryInteractiveRoute = route('/interactive', {
  meta: {
    description: 'Compiled Jiso UI primitive demos with generated client handlers.',
    title: 'Jiso Interactive Gallery',
  },
  modulepreloads: galleryInteractiveClientModuleHrefs,
  page() {
    return renderInteractiveGalleryRoute();
  },
});

export function createGalleryInteractiveAppShell() {
  const app = createApp({
    clientModules: galleryInteractiveClientModules,
    document: { lang: 'en-US' },
    renderRoute(value) {
      return routeValueToHtml(value);
    },
    routes: [galleryInteractiveRoute],
  });
  const requestHandler = createRequestHandler(app);

  return {
    app,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export const galleryInteractiveAppShell = createGalleryInteractiveAppShell();
export const galleryInteractiveNodeHandler = galleryInteractiveAppShell.nodeHandler;

export default galleryInteractiveAppShell.app;

function registerGalleryInteractiveClientModule(demoName: string): string {
  const modulePath = `/c/examples/gallery/src/generated/interactive/${demoName}.client.js`;
  const generatedServerTsx = readGeneratedInteractiveArtifact(`${demoName}.tsx`);
  const generatedClientSource = readGeneratedInteractiveArtifact(`${demoName}.client.js`);
  const version = generatedClientModuleVersion(generatedServerTsx, modulePath, demoName);
  const href = galleryInteractiveClientModules.put({
    path: modulePath,
    source: generatedClientSource,
    version,
  });

  if (href !== `${modulePath}?v=${version}`) {
    throw new Error(`Unexpected gallery client module href for ${demoName}: ${href}`);
  }

  return href;
}

function readGeneratedInteractiveArtifact(fileName: string): string {
  return readFileSync(new URL(fileName, `file://${galleryGeneratedRoot}`), 'utf8');
}

function generatedClientModuleVersion(
  source: string,
  modulePath: string,
  demoName: string,
): string {
  const escapedModulePath = escapeRegExp(modulePath);
  const versionPattern = new RegExp(`${escapedModulePath}\\?v=([0-9a-f]{8})#`, 'g');
  const versions = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = versionPattern.exec(source)) !== null) {
    versions.add(String(match[1]));
  }

  if (versions.size !== 1) {
    throw new Error(
      `Expected one generated client version for ${demoName}, found ${versions.size}.`,
    );
  }

  const version = versions.values().next().value;
  if (version === undefined) {
    throw new Error(`Missing generated client version for ${demoName}.`);
  }

  return version;
}

function routeValueToHtml(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
