import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import type { Product, CategorySummary } from "../types/catalog.types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const catalog: Product[] = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "data", "catalog.json"), "utf-8")
);

export const getCatalog = (): Product[] => catalog;

export const getCategories = (): CategorySummary[] => {
  const catMap = new Map<string, number>();
  for (const p of catalog) {
    catMap.set(p.category, (catMap.get(p.category) || 0) + p.popularity);
  }
  return [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, totalPopularity]) => ({ name, totalPopularity }));
};

export default {
  getCatalog,
  getCategories,
};
