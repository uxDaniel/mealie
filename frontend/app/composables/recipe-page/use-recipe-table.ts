import { useExtractIngredientReferences } from "./use-extract-ingredient-references";
import { useIngredientTextParser } from "~/composables/recipes";
import type { RecipeIngredient, RecipeStep } from "~/lib/api/types/recipe";

/**
 * Tabular Recipe Notation lays a recipe out as a grid: each ingredient is a row, and each
 * step is a cell that spans every row it acts on. Reading left to right follows the cooking.
 *
 * Column 0 holds the ingredients and the remaining columns hold the steps. Steps don't record
 * which earlier step they continue, so the flow is derived:
 *   - a step with a section title starts a new table, so parallel work stays apart
 *   - a step continues the step before it in the same table
 *   - a step with no ingredients and nothing to continue is preparation, shown above the grid
 */

export interface RecipeTableIngredientCell {
  kind: "ingredient";
  ingredient: RecipeIngredient;
  /** true when an earlier row already showed this ingredient's amount */
  repeated: boolean;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

export interface RecipeTableStepCell {
  kind: "step";
  step: RecipeStep;
  /** short text to show in the cell */
  label: string;
  /** true when the label doesn't show the whole step */
  hasMore: boolean;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

export interface RecipeTableBlankCell {
  kind: "blank";
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

export type RecipeTableCell = RecipeTableIngredientCell | RecipeTableStepCell | RecipeTableBlankCell;

export interface RecipeTable {
  /** The section title of the first step, or an empty string */
  title: string;
  /** Preparation rows first, then the grid. Each row holds its cells from left to right. */
  rows: RecipeTableCell[][];
  /** The number of step columns, excluding the ingredient column */
  stepColumnCount: number;
  /** The number of rows at the start of `rows` that are full-width preparation steps */
  preparationCount: number;
}

interface RecipeSection {
  title: string;
  entries: { step: RecipeStep; links: Set<string> }[];
}

interface IngredientNode {
  type: "ingredient";
  ingredient: RecipeIngredient;
  repeated: boolean;
}

interface StepNode {
  type: "step";
  step: RecipeStep;
  children: TreeNode[];
}

type TreeNode = IngredientNode | StepNode;

function ingredientKey(ingredient: RecipeIngredient, index: number): string {
  return ingredient.referenceId ?? `index-${index}`;
}

/**
 * The first sentence of a step, or the first line when the step has no sentence ending.
 * The letter check keeps a leading list marker such as "1." from counting as a sentence.
 */
function firstSentence(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const sentence = firstLine.match(/^.*?\p{L}.*?[.!?](?=\s|$)/u);
  return (sentence ? sentence[0] : firstLine).trim();
}

export function recipeTableStepLabel(step: RecipeStep): string {
  return step.summary?.trim() || firstSentence(step.text);
}

/** Ingredients that no step links go to the first step that has ingredients. */
function withUnlinkedIngredients(ingredients: RecipeIngredient[], links: Set<string>[]): Set<string>[] {
  const linked = new Set(links.flatMap(stepLinks => [...stepLinks]));
  const unlinked = ingredients.map(ingredientKey).filter(key => !linked.has(key));
  if (!unlinked.length || !links.length) {
    return links;
  }

  const target = Math.max(links.findIndex(stepLinks => stepLinks.size > 0), 0);
  return links.map((stepLinks, index) => (index === target ? new Set([...stepLinks, ...unlinked]) : stepLinks));
}

function splitSections(steps: RecipeStep[], links: Set<string>[]) {
  const sections: RecipeSection[] = [];
  steps.forEach((step, index) => {
    const title = step.title?.trim();
    if (title || !sections.length) {
      sections.push({ title: title ?? "", entries: [] });
    }
    sections.at(-1)?.entries.push({ step, links: links[index] ?? new Set() });
  });
  return sections;
}

/**
 * @param shown the keys of the ingredients that earlier sections showed. Adds this section's keys.
 */
function buildSectionTree(ingredients: RecipeIngredient[], section: RecipeSection, shown: Set<string>) {
  const preparation: RecipeStep[] = [];
  let current: StepNode | null = null;

  for (const { step, links } of section.entries) {
    const nodes: IngredientNode[] = [];
    ingredients.forEach((ingredient, ingredientIndex) => {
      const key = ingredientKey(ingredient, ingredientIndex);
      if (links.has(key)) {
        nodes.push({ type: "ingredient", ingredient, repeated: shown.has(key) });
        shown.add(key);
      }
    });

    if (current || nodes.length) {
      current = { type: "step", step, children: current ? [current, ...nodes] : nodes };
    }
    else {
      preparation.push(step);
    }
  }

  return { preparation, roots: current ? [current] : [] };
}

function columnOf(node: TreeNode): number {
  return node.type === "ingredient" ? 0 : 1 + Math.max(...node.children.map(columnOf));
}

/** Adds the cells of a node and its children, and returns the row after the last one. */
function placeNode(node: TreeNode, top: number, cells: RecipeTableCell[]): number {
  if (node.type === "ingredient") {
    const { ingredient, repeated } = node;
    cells.push({ kind: "ingredient", ingredient, repeated, row: top, column: 0, rowSpan: 1, colSpan: 1 });
    return top + 1;
  }

  const column = columnOf(node);
  let row = top;
  let index = 0;
  while (index < node.children.length) {
    // Neighbours that stop at the same column share one blank cell, which keeps the grid readable
    const groupColumn = columnOf(node.children[index]!);
    const groupTop = row;
    while (index < node.children.length && columnOf(node.children[index]!) === groupColumn) {
      row = placeNode(node.children[index]!, row, cells);
      index++;
    }
    if (groupColumn < column - 1) {
      cells.push({
        kind: "blank",
        row: groupTop,
        column: groupColumn + 1,
        rowSpan: row - groupTop,
        colSpan: column - groupColumn - 1,
      });
    }
  }

  const label = recipeTableStepLabel(node.step);
  cells.push({
    kind: "step",
    step: node.step,
    label,
    hasMore: label !== node.step.text.trim(),
    row: top,
    column,
    rowSpan: row - top,
    colSpan: 1,
  });
  return row;
}

function layoutTable(title: string, preparation: RecipeStep[], roots: TreeNode[]): RecipeTable {
  const stepColumnCount = Math.max(0, ...roots.map(columnOf));
  const cells: RecipeTableCell[] = [];
  let row = 0;
  for (const root of roots) {
    row = placeNode(root, row, cells);
  }

  const gridRows = Array.from({ length: row }, (_, index) => {
    return cells.filter(cell => cell.row === index).sort((a, b) => a.column - b.column);
  });
  const preparationRows = preparation.map((step, index): RecipeTableCell[] => {
    const label = recipeTableStepLabel(step);
    return [{
      kind: "step",
      step,
      label,
      hasMore: label !== step.text.trim(),
      row: index,
      column: 0,
      rowSpan: 1,
      colSpan: stepColumnCount + 1,
    }];
  });

  return {
    title,
    rows: [...preparationRows, ...gridRows],
    stepColumnCount,
    preparationCount: preparationRows.length,
  };
}

/**
 * Builds one table for each section of a recipe.
 * @param links for each step, the keys of the ingredients it uses: the reference id of each ingredient
 */
export function buildRecipeTables(ingredients: RecipeIngredient[], steps: RecipeStep[], links: Set<string>[]): RecipeTable[] {
  if (!steps.length) {
    // With no steps there is nothing to attach the ingredients to, so each one is its own row
    const roots = ingredients.map((ingredient): TreeNode => ({ type: "ingredient", ingredient, repeated: false }));
    return roots.length ? [layoutTable("", [], roots)] : [];
  }

  const shown = new Set<string>();
  return splitSections(steps, withUnlinkedIngredients(ingredients, links)).map((section) => {
    const { preparation, roots } = buildSectionTree(ingredients, section, shown);
    return layoutTable(section.title, preparation, roots);
  });
}

export function useRecipeTable() {
  const { parseIngredientText } = useIngredientTextParser();
  const { extractIngredientReferences } = useExtractIngredientReferences();

  /**
   * Saved links are always used when a recipe has any. Otherwise the links are matched from the
   * step text. Each ingredient goes to the first step that mentions it, because a matched
   * ingredient that repeats is more likely a false match than a real second use.
   */
  function resolveLinks(ingredients: RecipeIngredient[], steps: RecipeStep[]) {
    const estimated = !steps.some(step => step.ingredientReferences?.length);
    if (!estimated) {
      const links = steps.map(step => new Set((step.ingredientReferences ?? []).flatMap(ref => ref.referenceId ?? [])));
      return { links, estimated };
    }

    const claimed: string[] = [];
    const links = steps.map((step) => {
      const matches = extractIngredientReferences(ingredients, claimed, step.text);
      claimed.push(...matches);
      return matches;
    });
    return { links, estimated };
  }

  function createRecipeTables(recipeIngredients: RecipeIngredient[], steps: RecipeStep[]) {
    // An entry with no text only carries a section title for the ingredient list
    const ingredients = recipeIngredients.filter(ingredient => parseIngredientText(ingredient));
    const { links, estimated } = resolveLinks(ingredients, steps);
    return { tables: buildRecipeTables(ingredients, steps, links), estimated };
  }

  return { createRecipeTables };
}
