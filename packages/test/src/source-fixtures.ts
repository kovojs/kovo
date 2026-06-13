import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProjectSourceSiteFact {
  line: number;
  path: string;
}

export interface ProjectFileTreeOptions {
  directory: string;
  include?: (path: string) => boolean;
  rootPath: string;
}

export interface ProjectFileSourceFact {
  path: string;
  source: string;
}

export interface ForbiddenBrowserArchitectureFact {
  column: number;
  fileName: string;
  label: string;
  line: number;
  site: string;
}

export interface CssScopeRuleFact {
  limit: string;
  raw: string;
  scope: string;
}

type TypeScriptModule = typeof import('typescript');

export function cssSourceDirectives(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@source '))
    .map((line) => line.slice('@source '.length).replace(/;$/, ''));
}

export function cssScopeRules(source: string): CssScopeRuleFact[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      const match = /^@scope\s+\((.+)\)\s+to\s+\((.+)\)\s+\{$/.exec(line);
      return match
        ? {
            limit: match[2] ?? '',
            raw: line,
            scope: match[1] ?? '',
          }
        : undefined;
    })
    .filter((rule): rule is CssScopeRuleFact => rule !== undefined);
}

export function projectSourceSiteFact(site: string): ProjectSourceSiteFact {
  const separator = site.lastIndexOf(':');
  if (separator === -1) {
    throw new Error(`Project source site includes a line number: ${site}`);
  }

  const line = Number(site.slice(separator + 1));
  if (!Number.isInteger(line) || line <= 0) {
    throw new Error(`Project source site line is positive: ${site}`);
  }

  return { line, path: site.slice(0, separator) };
}

export async function projectDirectoryNames(options: ProjectFileTreeOptions): Promise<string[]> {
  const entries = await readdir(join(options.rootPath, options.directory), {
    withFileTypes: true,
  });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${options.directory}/${entry.name}`)
    .filter((path) => options.include?.(path) ?? true);

  return names.sort((left, right) => left.localeCompare(right));
}

export async function projectFilePaths(options: ProjectFileTreeOptions): Promise<string[]> {
  const paths = await projectFileTreeEntries(options);
  return paths.sort((left, right) => left.localeCompare(right));
}

export async function projectFileSources(
  options: ProjectFileTreeOptions,
): Promise<ProjectFileSourceFact[]> {
  return Promise.all(
    (await projectFilePaths(options)).map(async (path) => ({
      path,
      source: await readFile(join(options.rootPath, path), 'utf8'),
    })),
  );
}

export async function projectJsonFile<T = unknown>(rootPath: string, path: string): Promise<T> {
  return JSON.parse(await readFile(join(rootPath, path), 'utf8')) as T;
}

export function forbiddenBrowserArchitectureFacts(
  ts: TypeScriptModule,
  fileName: string,
  source: string,
): ForbiddenBrowserArchitectureFact[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts: ForbiddenBrowserArchitectureFact[] = [];
  const nodeName = (node: import('typescript').Expression): string | undefined =>
    ts.isIdentifier(node)
      ? node.text
      : ts.isPropertyAccessExpression(node)
        ? node.name.text
        : undefined;
  const isStringValue = (node: import('typescript').Node | undefined, value: string) =>
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === value;
  const record = (node: import('typescript').Node, label: string) => {
    const { character, line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    facts.push({
      column: character + 1,
      fileName,
      label,
      line: line + 1,
      site: `${fileName}:${line + 1}:${character + 1}`,
    });
  };

  const visit = (node: import('typescript').Node) => {
    if (ts.isCallExpression(node)) {
      const callName = nodeName(node.expression);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        callName === 'define' &&
        nodeName(node.expression.expression) === 'customElements'
      ) {
        record(node, 'customElements.define');
      }
      if (callName === 'attachShadow') {
        record(node, 'attachShadow');
      }
      if (callName === 'addEventListener' && isStringValue(node.arguments[0], 'unload')) {
        record(node, 'addEventListener unload');
      }
      if (callName === 'createBrowserRouter' || callName === 'hydrateRoot') {
        record(node, callName);
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'onunload') ||
      (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'onunload')
    ) {
      record(node, 'onunload');
    }

    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'script'
    ) {
      for (const property of node.attributes.properties) {
        if (
          ts.isJsxAttribute(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'type' &&
          isStringValue(property.initializer, 'importmap')
        ) {
          record(property, 'importmap script');
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

async function projectFileTreeEntries(options: ProjectFileTreeOptions): Promise<string[]> {
  const entries = await readdir(join(options.rootPath, options.directory), {
    withFileTypes: true,
  });
  const paths: string[] = [];

  for (const entry of entries) {
    const path = `${options.directory}/${entry.name}`;

    if (entry.isDirectory()) {
      paths.push(...(await projectFileTreeEntries({ ...options, directory: path })));
    } else if (options.include?.(path) ?? true) {
      paths.push(path);
    }
  }

  return paths;
}
