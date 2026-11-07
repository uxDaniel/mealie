import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildRecipeTables, recipeTableStepLabel, useRecipeTable } from "../use-recipe-table";
import type { RecipeTable, RecipeTableCell } from "../use-recipe-table";
import { useLocales } from "../../use-locales";
import type { RecipeIngredient, RecipeStep } from "~/lib/api/types/recipe";

vi.mock("../../use-locales");

function ingredient(referenceId: string): RecipeIngredient {
  return { referenceId, note: referenceId } as RecipeIngredient;
}

function step(text: string, extra: Partial<RecipeStep> = {}): RecipeStep {
  return { text, ...extra } as RecipeStep;
}

function links(...steps: string[][]) {
  return steps.map(references => new Set(references));
}

/** Builds a recipe that must fit in one table */
function buildOne(...args: Parameters<typeof buildRecipeTables>) {
  const tables = buildRecipeTables(...args);
  expect(tables).toHaveLength(1);
  return tables[0]!;
}

function grid(table: RecipeTable) {
  return table.rows.slice(table.preparationCount);
}

function stepCell(table: RecipeTable, label: string) {
  const cell = table.rows.flat().find(item => item.kind === "step" && item.label === label);
  if (!cell) {
    throw new Error(`no cell for ${label}`);
  }
  return cell;
}

function ingredientNames(table: RecipeTable) {
  return grid(table).flat().flatMap(cell => (cell.kind === "ingredient" ? [cell.ingredient.note] : []));
}

/** Every position in the grid must belong to exactly one cell, or the table renders out of shape */
function expectFullCoverage(table: RecipeTable) {
  const cells: RecipeTableCell[] = grid(table).flat();
  const covered = new Map<string, number>();
  for (const cell of cells) {
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (let column = cell.column; column < cell.column + cell.colSpan; column++) {
        covered.set(`${row}:${column}`, (covered.get(`${row}:${column}`) ?? 0) + 1);
      }
    }
  }

  expect(covered.size).toBe(grid(table).length * (table.stepColumnCount + 1));
  expect([...covered.values()].every(count => count === 1)).toBe(true);
}

describe("buildRecipeTables", () => {
  test("matches the shape of a classic linear card", () => {
    const ingredients = ["butter", "sugar", "vanilla", "eggs", "flour", "salt"].map(ingredient);
    const steps = [
      step("Preheat oven."),
      step("melt", { ingredientReferences: [{ referenceId: "butter" }] }),
      step("mix"),
      step("mix again"),
      step("fold in"),
      step("bake"),
    ];
    const table = buildOne(ingredients, steps, links([], ["butter"], ["sugar", "vanilla"], ["eggs"], ["flour", "salt"], []));

    expect(table.preparationCount).toBe(1);
    expect(table.rows[0]?.[0]).toMatchObject({ kind: "step", label: "Preheat oven.", colSpan: 6 });
    expect(table.stepColumnCount).toBe(5);
    expect(ingredientNames(table)).toEqual(["butter", "sugar", "vanilla", "eggs", "flour", "salt"]);

    expect(stepCell(table, "melt")).toMatchObject({ row: 0, column: 1, rowSpan: 1 });
    expect(stepCell(table, "mix")).toMatchObject({ row: 0, column: 2, rowSpan: 3 });
    expect(stepCell(table, "mix again")).toMatchObject({ row: 0, column: 3, rowSpan: 4 });
    expect(stepCell(table, "fold in")).toMatchObject({ row: 0, column: 4, rowSpan: 6 });
    expect(stepCell(table, "bake")).toMatchObject({ row: 0, column: 5, rowSpan: 6 });
    expectFullCoverage(table);
  });

  test("neighbouring ingredients share one blank cell", () => {
    const ingredients = ["butter", "sugar", "vanilla"].map(ingredient);
    const table = buildOne(ingredients, [step("melt"), step("mix")], links(["butter"], ["sugar", "vanilla"]));

    const blanks = grid(table).flat().filter(cell => cell.kind === "blank");
    expect(blanks).toEqual([{ kind: "blank", row: 1, column: 1, rowSpan: 2, colSpan: 1 }]);
    expectFullCoverage(table);
  });

  test("each section gets its own table with its title", () => {
    const ingredients = ["flour", "water", "tomato", "cheese"].map(ingredient);
    const steps = [
      step("knead", { title: "Dough" }),
      step("rest"),
      step("simmer", { title: "Sauce" }),
      step("stretch", { title: "Assemble" }),
      step("add cheese"),
      step("bake"),
    ];
    const tables = buildRecipeTables(ingredients, steps, links(["flour", "water"], [], ["tomato"], [], ["cheese"], []));

    expect(tables.map(table => table.title)).toEqual(["Dough", "Sauce", "Assemble"]);
    const [dough, sauce, assemble] = tables as [RecipeTable, RecipeTable, RecipeTable];

    expect(ingredientNames(dough)).toEqual(["flour", "water"]);
    expect(stepCell(dough, "rest")).toMatchObject({ row: 0, column: 2, rowSpan: 2 });
    expect(ingredientNames(sauce)).toEqual(["tomato"]);
    expect(stepCell(sauce, "simmer")).toMatchObject({ row: 0, column: 1, rowSpan: 1 });

    // A section that opens with no ingredients has nothing to span yet, and nothing joins it to earlier tables
    expect(assemble.preparationCount).toBe(1);
    expect(assemble.rows[0]?.[0]).toMatchObject({ kind: "step", label: "stretch", colSpan: 3 });
    expect(ingredientNames(assemble)).toEqual(["cheese"]);
    expect(stepCell(assemble, "bake")).toMatchObject({ column: 2, rowSpan: 1 });
    tables.forEach(expectFullCoverage);
  });

  test("steps before the first section title form a table with no title", () => {
    const tables = buildRecipeTables(
      ["butter", "sugar"].map(ingredient),
      [step("melt"), step("whisk", { title: "Icing" })],
      links(["butter"], ["sugar"]),
    );

    expect(tables.map(table => table.title)).toEqual(["", "Icing"]);
  });

  test("a section of steps with no ingredients is all preparation", () => {
    const tables = buildRecipeTables([ingredient("butter")], [step("melt"), step("plate", { title: "Serve" })], links(["butter"], []));

    expect(tables[1]).toMatchObject({ title: "Serve", stepColumnCount: 0, preparationCount: 1 });
    expect(tables[1]?.rows[0]?.[0]).toMatchObject({ kind: "step", label: "plate", colSpan: 1 });
  });

  test("a blank section title does not start a table", () => {
    const table = buildOne([ingredient("butter")], [step("melt"), step("cool", { title: "  " })], links(["butter"], []));

    expect(table.title).toBe("");
  });

  test("a later use of an ingredient repeats its row without the amount", () => {
    const ingredients = ["salt", "egg"].map(ingredient);
    const table = buildOne(ingredients, [step("whisk"), step("season")], links(["salt", "egg"], ["salt"]));

    const rows = grid(table).flat().filter(cell => cell.kind === "ingredient");
    expect(rows.map(cell => [cell.ingredient.note, cell.repeated])).toEqual([
      ["salt", false],
      ["egg", false],
      ["salt", true],
    ]);
    expectFullCoverage(table);
  });

  test("an ingredient that repeats in a later table is still marked as repeated", () => {
    const tables = buildRecipeTables(
      [ingredient("salt")],
      [step("cure"), step("season", { title: "Sauce" })],
      links(["salt"], ["salt"]),
    );

    const repeated = tables.map(table => table.rows.flat().find(cell => cell.kind === "ingredient")?.repeated);
    expect(repeated).toEqual([false, true]);
  });

  test("unlinked ingredients go to the first step that has ingredients", () => {
    const ingredients = ["butter", "pepper"].map(ingredient);
    const table = buildOne(ingredients, [step("preheat"), step("melt")], links([], ["butter"]));

    expect(table.preparationCount).toBe(1);
    expect(stepCell(table, "melt")).toMatchObject({ row: 0, rowSpan: 2 });
    expectFullCoverage(table);
  });

  test("when nothing links, every ingredient goes to the first step", () => {
    const ingredients = ["butter", "pepper"].map(ingredient);
    const table = buildOne(ingredients, [step("mix"), step("bake")], links([], []));

    expect(table.preparationCount).toBe(0);
    expect(stepCell(table, "mix")).toMatchObject({ column: 1, rowSpan: 2 });
    expect(stepCell(table, "bake")).toMatchObject({ column: 2, rowSpan: 2 });
    expectFullCoverage(table);
  });

  test("a recipe with no steps lists its ingredients", () => {
    const table = buildOne(["butter", "pepper"].map(ingredient), [], []);

    expect(table.stepColumnCount).toBe(0);
    expect(ingredientNames(table)).toEqual(["butter", "pepper"]);
    expectFullCoverage(table);
  });

  test("a recipe with no ingredients shows its steps as preparation", () => {
    const table = buildOne([], [step("boil"), step("serve")], links([], []));

    expect(table.preparationCount).toBe(2);
    expect(table.rows[1]?.[0]).toMatchObject({ kind: "step", label: "serve", colSpan: 1 });
  });

  test("an empty recipe has no tables", () => {
    expect(buildRecipeTables([], [], [])).toEqual([]);
  });
});

describe("recipeTableStepLabel", () => {
  test.each([
    ["Melt the butter. Then cool it.", "Melt the butter."],
    ["Stir! Then rest.", "Stir!"],
    ["Add 1.5 cups of flour. Mix well.", "Add 1.5 cups of flour."],
    ["1. Melt the butter. Then cool it.", "1. Melt the butter."],
    ["First line\nSecond line", "First line"],
    ["no ending punctuation", "no ending punctuation"],
    ["  Spaced out.  ", "Spaced out."],
  ])("uses the first sentence of %j", (text, expected) => {
    expect(recipeTableStepLabel(step(text))).toBe(expected);
  });

  test("prefers the summary", () => {
    expect(recipeTableStepLabel(step("Melt the butter.", { summary: " melt " }))).toBe("melt");
  });

  test("ignores a blank summary", () => {
    expect(recipeTableStepLabel(step("Melt the butter.", { summary: "  " }))).toBe("Melt the butter.");
  });
});

describe("useRecipeTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLocales).mockReturnValue({
      locales: [{ value: "en-US", pluralFoodHandling: "without-unit" }],
      locale: { value: "en-US", pluralFoodHandling: "without-unit" },
    } as any);
  });

  test("uses saved links and is not estimated", () => {
    const { createRecipeTables } = useRecipeTable();
    const steps = [
      step("Add the butter.", { ingredientReferences: [{ referenceId: "butter" }] }),
      step("Add the sugar."),
    ];
    const { tables: [table], estimated } = createRecipeTables(["butter", "sugar"].map(ingredient), steps);

    expect(estimated).toBe(false);
    // Saved links are trusted, so "sugar" is unlinked here even though step 2 mentions it
    expect(table!.rows[1]?.[0]).toMatchObject({ kind: "ingredient", ingredient: { note: "sugar" } });
    expect(stepCell(table!, "Add the butter.")).toMatchObject({ rowSpan: 2 });
    expect(stepCell(table!, "Add the sugar.")).toMatchObject({ column: 2, rowSpan: 2 });
  });

  test("matches links from the step text when a recipe has none", () => {
    const { createRecipeTables } = useRecipeTable();
    const { tables: [table], estimated } = createRecipeTables(
      ["butter", "sugar"].map(ingredient),
      [step("Preheat oven."), step("Melt butter."), step("Stir in sugar.")],
    );

    expect(estimated).toBe(true);
    expect(table!.preparationCount).toBe(1);
    expect(stepCell(table!, "Melt butter.")).toMatchObject({ column: 1, rowSpan: 1 });
    expect(stepCell(table!, "Stir in sugar.")).toMatchObject({ column: 2, rowSpan: 2 });
  });

  test("a matched ingredient stays with the first step that mentions it", () => {
    const { createRecipeTables } = useRecipeTable();
    const { tables: [table] } = createRecipeTables(
      [ingredient("butter")],
      [step("Melt butter."), step("Brush with more butter.")],
    );

    expect(table!.rows.flat().filter(cell => cell.kind === "ingredient")).toHaveLength(1);
  });

  test("skips entries with no text, which only hold a section title", () => {
    const { createRecipeTables } = useRecipeTable();
    const sectionOnly = { referenceId: "section", title: "Sauce" } as RecipeIngredient;
    const { tables: [table] } = createRecipeTables([sectionOnly, ingredient("butter")], [step("Melt butter.")]);

    expect(table!.rows).toHaveLength(1);
    expect(table!.rows[0]?.[0]).toMatchObject({ kind: "ingredient", ingredient: { note: "butter" } });
  });
});
