<!-- eslint-disable vue/no-v-html -->
<template>
  <div>
    <p
      v-if="estimated && !fullText"
      class="text-caption text-medium-emphasis mb-2 d-print-none"
    >
      {{ $t("recipe.table-view-estimated") }}
    </p>
    <section
      v-for="(table, tableIndex) in tables"
      :key="tableIndex"
      class="recipe-table-section"
    >
      <h3
        v-if="table.title"
        class="text-h6 font-weight-medium mb-1"
      >
        {{ table.title }}
      </h3>
      <div class="recipe-table-scroll">
        <table
          class="recipe-table"
          :class="{ 'recipe-table--full-text': fullText }"
        >
          <caption class="recipe-table-caption">
            {{ table.title || recipe.name }}
          </caption>
          <tbody>
            <tr
              v-for="(row, rowIndex) in table.rows"
              :key="rowIndex"
            >
              <template
                v-for="cell in row"
                :key="cell.column"
              >
                <td
                  v-if="cell.kind === 'ingredient'"
                  class="recipe-table-ingredient"
                  :class="{ 'recipe-table-ingredient--repeated': cell.repeated }"
                  v-html="ingredientHtml(cell)"
                />
                <td
                  v-else-if="cell.kind === 'step'"
                  class="recipe-table-step"
                  :class="{
                    'recipe-table-step--preparation': rowIndex < table.preparationCount,
                    'recipe-table-step--expandable': cell.hasMore && !fullText,
                  }"
                  :rowspan="cell.rowSpan"
                  :colspan="cell.colSpan"
                  :tabindex="cell.hasMore && !fullText ? 0 : undefined"
                  @keydown.enter.prevent="openStep"
                >
                  <template v-if="fullText">
                    <strong v-if="cell.step.summary?.trim()">{{ cell.step.summary }}</strong>
                    <SafeMarkdown :source="cell.step.text" />
                  </template>
                  <template v-else>
                    <SafeMarkdown :source="cell.label" />
                    <!-- a menu, not a tooltip: a tooltip's hover and tap handling conflict on touch screens -->
                    <v-menu
                      v-if="cell.hasMore"
                      activator="parent"
                      location="top"
                      max-width="400"
                    >
                      <v-card class="pa-3">
                        <SafeMarkdown :source="cell.step.text" />
                      </v-card>
                    </v-menu>
                  </template>
                  <div
                    v-if="cell.step.durationSeconds"
                    class="recipe-table-duration"
                  >
                    {{ formatDuration(cell.step.durationSeconds, locale) }}
                  </div>
                </td>
                <td
                  v-else
                  class="recipe-table-blank"
                  :rowspan="cell.rowSpan"
                  :colspan="cell.colSpan"
                />
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatDuration, useIngredientTextParser } from "~/composables/recipes";
import { useRecipeTable } from "~/composables/recipe-page/use-recipe-table";
import type { RecipeTableIngredientCell } from "~/composables/recipe-page/use-recipe-table";
import type { NoUndefinedField } from "~/lib/api/types/non-generated";
import type { Recipe } from "~/lib/api/types/recipe";

interface Props {
  recipe: NoUndefinedField<Recipe>;
  scale?: number;
  /** Shows the whole step in each cell, for output that has no tooltips, such as paper. */
  fullText?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  scale: 1,
  fullText: false,
});

const { locale, t } = useI18n();
const { parseIngredientText, useParsedIngredientText } = useIngredientTextParser();
const { createRecipeTables } = useRecipeTable();

const recipeTables = computed(() => createRecipeTables(props.recipe.recipeIngredient, props.recipe.recipeInstructions));
const tables = computed(() => recipeTables.value.tables);
const estimated = computed(() => recipeTables.value.estimated);

function ingredientHtml(cell: RecipeTableIngredientCell) {
  if (!cell.repeated) {
    return parseIngredientText(cell.ingredient, props.scale);
  }

  // Free-text ingredients hold the amount inside the note, so the amount can't be removed
  const { name, note } = useParsedIngredientText(cell.ingredient, props.scale);
  return name || t("recipe.table-view-repeated", { ingredient: note ?? "" });
}

function openStep(event: KeyboardEvent) {
  (event.currentTarget as HTMLElement).click();
}
</script>

<style scoped>
.recipe-table-section + .recipe-table-section {
  margin-top: 1rem;
}

.recipe-table-scroll {
  overflow-x: auto;
}

.recipe-table {
  width: 100%;
  border-collapse: collapse;
}

.recipe-table td {
  padding: 0.375rem 0.625rem;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  vertical-align: middle;
}

/* The name stays readable for assistive tech without repeating the page title on screen */
.recipe-table-caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.recipe-table-ingredient {
  min-width: 10rem;
}

.recipe-table-ingredient--repeated {
  font-style: italic;
}

.recipe-table-step {
  min-width: 7rem;
  max-width: 16rem;
  text-align: center;
}

.recipe-table-step :deep(p) {
  margin: 0;
}

.recipe-table-step--expandable {
  cursor: pointer;
}

.recipe-table-step--preparation {
  max-width: none;
  font-weight: 500;
}

.recipe-table-duration {
  font-size: 0.75rem;
  opacity: 0.8;
}

.recipe-table--full-text .recipe-table-step {
  min-width: 0;
  max-width: none;
  text-align: left;
}

.recipe-table--full-text .recipe-table-ingredient {
  min-width: 0;
}

@media print {
  .recipe-table-scroll {
    overflow-x: visible;
  }

  .recipe-table td {
    border-color: #000;
  }
}
</style>
