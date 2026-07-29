import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GOLDEN_RECIPE_TASKS,
  readGoldenRecipeManifest,
  validateGoldenRecipes,
} from './golden-recipes.mjs';

const pagePath = path.join(process.cwd(), 'site/content/guides/golden-recipes.md');

describe('golden task recipes', () => {
  it('binds the exact charter task set to standalone sources and exported symbols', async () => {
    const markdown = await readFile(pagePath, 'utf8');
    const result = validateGoldenRecipes({ markdown, requireTracked: false });

    expect(result.tasks).toBe(16);
    expect(result.recipes.map((recipe) => recipe.task)).toEqual(GOLDEN_RECIPE_TASKS);
    expect(new Set(result.recipes.map((recipe) => recipe.sourcePath)).size).toBe(16);
  });

  it('rejects a displayed recipe that drifts from its tracked source bytes', async () => {
    const markdown = (await readFile(pagePath, 'utf8')).replace(
      'return <button type="submit">{props.label}</button>;',
      'return <button type="button">{props.label}</button>;',
    );

    expect(() => validateGoldenRecipes({ markdown, requireTracked: false })).toThrow(
      /displayed component bytes differ/u,
    );
  });

  it('rejects a source marker naming an export the source does not own', async () => {
    const markdown = (await readFile(pagePath, 'utf8')).replace(
      'export="SaveButton"',
      'export="MissingButton"',
    );

    expect(() => validateGoldenRecipes({ markdown, requireTracked: false })).toThrow(
      /does not export MissingButton/u,
    );
  });

  it('fails closed on malformed markers and task-set drift', async () => {
    const markdown = await readFile(pagePath, 'utf8');
    expect(() =>
      readGoldenRecipeManifest({
        markdown: markdown.replace(' export="SaveButton"', ' symbol="SaveButton"'),
      }),
    ).toThrow(/malformed kovo-recipe marker/u);
    expect(() =>
      validateGoldenRecipes({
        markdown: markdown.replace('task="component"', 'task="widget"'),
        requireTracked: false,
      }),
    ).toThrow(/task set\/order drifted/u);
  });
});
