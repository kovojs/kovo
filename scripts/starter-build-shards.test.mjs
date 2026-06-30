import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  starterBuildShardPattern,
  starterBuildShards,
} from './starter-build-shards.mjs';

const starterBuildTestPath = 'packages/create-kovo/src/index.build.test.ts';

describe('starter-build-shards', () => {
  it('assigns every starter build integration test exactly once', () => {
    const actualTests = collectVitestTitles(starterBuildTestPath);
    const assignedTests = starterBuildShards.flatMap((shard) => shard.tests);

    expect(new Set(assignedTests).size).toBe(assignedTests.length);
    expect([...assignedTests].sort()).toEqual([...actualTests].sort());
  });

  it('keeps each shard pattern scoped to its own tests', () => {
    const actualTests = collectVitestTitles(starterBuildTestPath);

    for (const shard of starterBuildShards) {
      const pattern = new RegExp(starterBuildShardPattern(shard.id));
      expect(actualTests.filter((title) => pattern.test(title)).sort()).toEqual(
        [...shard.tests].sort(),
      );
    }
  });
});

function collectVitestTitles(path) {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const titles = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'it' || node.expression.text === 'test')
    ) {
      const [title] = node.arguments;
      if (title && ts.isStringLiteralLike(title)) titles.push(title.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return titles;
}
