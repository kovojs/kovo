import { createRequire } from 'node:module';
import type * as ts from 'typescript';

interface TypescriptCompatibilityApi {
  canHaveModifiers?: (node: ts.Node) => boolean;
  getEffectiveConstraintOfTypeParameter?: (
    node: ts.TypeParameterDeclaration,
  ) => ts.TypeNode | undefined;
  getModifiers?: (node: ts.Node) => readonly ts.ModifierLike[] | undefined;
}

interface TypescriptApiAdapter {
  canHaveModifiers(node: ts.Node): boolean;
  getEffectiveConstraintOfTypeParameter(node: ts.TypeParameterDeclaration): ts.TypeNode | undefined;
  getModifiers(node: ts.Node): readonly ts.ModifierLike[] | undefined;
  hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean;
}

const requireTypescript = createRequire(import.meta.url);
export const typescriptRuntime = requireTypescript('typescript') as typeof ts;
const defaultTsApi = createTypescriptApi(typescriptRuntime);

export function ensureTypescriptRuntime(typescript: unknown = typescriptRuntime): typeof ts {
  if (typescript && typeof typescript === 'object') {
    if ('ScriptTarget' in typescript) return typescript as typeof ts;
    const nestedDefault = (typescript as unknown as { readonly default?: unknown }).default;
    if (
      nestedDefault !== null &&
      typeof nestedDefault === 'object' &&
      'ScriptTarget' in nestedDefault
    ) {
      return nestedDefault as typeof ts;
    }
  }
  return typescriptRuntime;
}

export function createTypescriptApi(
  typescript: typeof ts = typescriptRuntime,
): TypescriptApiAdapter {
  const runtime = ensureTypescriptRuntime(typescript);
  const compatibility = runtime as typeof ts & TypescriptCompatibilityApi;

  const adapter: TypescriptApiAdapter = {
    canHaveModifiers(node) {
      if (compatibility.canHaveModifiers) return compatibility.canHaveModifiers(node);
      return legacyModifiers(node) !== undefined;
    },
    getEffectiveConstraintOfTypeParameter(node) {
      if (compatibility.getEffectiveConstraintOfTypeParameter) {
        return compatibility.getEffectiveConstraintOfTypeParameter(node);
      }
      return node.constraint;
    },
    getModifiers(node) {
      if (compatibility.getModifiers && adapter.canHaveModifiers(node)) {
        return compatibility.getModifiers(node);
      }
      return legacyModifiers(node);
    },
    hasModifier(node, kind) {
      return adapter.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
    },
  };

  return adapter;
}

export function canHaveModifiers(node: ts.Node): boolean {
  return defaultTsApi.canHaveModifiers(node);
}

export function getModifiers(node: ts.Node): readonly ts.ModifierLike[] | undefined {
  return defaultTsApi.getModifiers(node);
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return defaultTsApi.hasModifier(node, kind);
}

export function getEffectiveConstraintOfTypeParameter(
  node: ts.TypeParameterDeclaration,
): ts.TypeNode | undefined {
  return defaultTsApi.getEffectiveConstraintOfTypeParameter(node);
}

function legacyModifiers(node: ts.Node): readonly ts.ModifierLike[] | undefined {
  return (node as ts.Node & { readonly modifiers?: readonly ts.ModifierLike[] }).modifiers;
}
