#!/usr/bin/env node

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/** Build the installable VSIX from one exact reviewed runtime allowlist. */
export function createKovoDiagnosticsVsix(outputFile) {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const files = new Map([
    ['[Content_Types].xml', Buffer.from(contentTypes(), 'utf8')],
    ['extension.vsixmanifest', Buffer.from(extensionManifest(manifest), 'utf8')],
    ['extension/package.json', readFileSync(path.join(packageRoot, 'package.json'))],
    ['extension/readme.md', readFileSync(path.join(packageRoot, 'README.md'))],
    [
      'extension/src/diagnostic-adapter.cjs',
      readFileSync(path.join(packageRoot, 'src', 'diagnostic-adapter.cjs')),
    ],
    ['extension/src/extension.cjs', readFileSync(path.join(packageRoot, 'src', 'extension.cjs'))],
  ]);
  const bytes = createZip(files);
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, bytes);
  return Object.freeze({ bytes: bytes.byteLength, entries: files.size });
}

function extensionManifest(manifest) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}" />
    <DisplayName>${xml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(manifest.description)}</Description>
    <Tags>${xml(manifest.keywords.join(','))}</Tags>
    <Categories>${xml(manifest.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${xml(manifest.extensionKind.join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${xml(manifest.repository.url)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="${xml(manifest.repository.url)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="${xml(manifest.repository.url)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="${xml(manifest.bugs.url)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="${xml(manifest.homepage)}" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />
  </Assets>
</PackageManifest>`;
}

function contentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".cjs" ContentType="application/octet-stream"/><Default Extension=".json" ContentType="application/json"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>`;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, value] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(body.byteLength, 22);
    local.writeUInt16LE(nameBytes.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(body.byteLength, 24);
    central.writeUInt16LE(nameBytes.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.byteLength + nameBytes.byteLength + body.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Object.freeze(
  Array.from({ length: 256 }, (_unused, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }),
);

function xml(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('VSIX manifest values must be non-empty strings.');
  }
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputFile = path.join(packageRoot, 'dist', 'kovo-diagnostics.vsix');
  const result = createKovoDiagnosticsVsix(outputFile);
  process.stdout.write(
    `kovo-vscode-package/v1 entries=${String(result.entries)} bytes=${String(result.bytes)} output=${path.relative(packageRoot, outputFile)} OK\n`,
  );
}
