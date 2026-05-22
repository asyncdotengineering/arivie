/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deterministic seed for the F&B POS example. Uses a seeded RNG so every
 * `pnpm seed` produces byte-identical data — required for skill regression
 * testing and for stable demo outputs.
 *
 * Usage:
 *   DATABASE_URL=postgresql://localhost:5432/arivie_pos pnpm tsx db/seed.ts
 *
 * Volume produced (14 days × 3 outlets):
 *   - outlets: 3
 *   - menu_categories: 8
 *   - menu_items: 36
 *   - modifiers: 24
 *   - ingredients: 32
 *   - recipe_lines: ~80
 *   - suppliers: 6
 *   - employees: 36 (12 per outlet)
 *   - shifts + time_entries: ~500
 *   - purchase_orders + lines: ~30
 *   - stock_movements: ~3000 (receive + consume + waste)
 *   - tickets: ~2100
 *   - ticket_items: ~5000
 *   - tenders: ~2400
 *   - gl_entries: ~600
 */
import postgres from "postgres";

// ─────────────────────────────────────────────────────────────────────────
// Seeded RNG (mulberry32) — deterministic.
// ─────────────────────────────────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260521);
const rand = (min: number, max: number): number => min + rng() * (max - min);
const randint = (min: number, max: number): number => Math.floor(rand(min, max + 1));
const pick = <T>(arr: readonly T[]): T => arr[randint(0, arr.length - 1)] as T;
const chance = (p: number): boolean => rng() < p;
const money = (n: number): number => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────────────────
const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);
const SEED_WINDOW_DAYS = 14;

type OutletKey = "luminere-bistro" | "luminere-riverside" | "luminere-westside";

interface Outlet {
  id: OutletKey;
  name: string;
  brand: string;
  concept: "full_service" | "fast_casual" | "bar" | "cafe";
  city: string;
  state: string;
  seats: number;
  dailyTicketTarget: { breakfast: number; lunch: number; dinner: number; latenight: number };
  avgCheck: number;
  alcoholMix: number; // share of revenue from alcohol
}

const OUTLETS: Outlet[] = [
  {
    id: "luminere-bistro",
    name: "Lumière Bistro",
    brand: "Lumière",
    concept: "full_service",
    city: "Brooklyn",
    state: "NY",
    seats: 64,
    dailyTicketTarget: { breakfast: 4, lunch: 14, dinner: 36, latenight: 2 },
    avgCheck: 64,
    alcoholMix: 0.32,
  },
  {
    id: "luminere-riverside",
    name: "Lumière Riverside",
    brand: "Lumière",
    concept: "full_service",
    city: "Hoboken",
    state: "NJ",
    seats: 48,
    dailyTicketTarget: { breakfast: 14, lunch: 24, dinner: 22, latenight: 0 },
    avgCheck: 46,
    alcoholMix: 0.21,
  },
  {
    id: "luminere-westside",
    name: "Lumière Westside",
    brand: "Lumière",
    concept: "bar",
    city: "Manhattan",
    state: "NY",
    seats: 42,
    dailyTicketTarget: { breakfast: 0, lunch: 6, dinner: 22, latenight: 24 },
    avgCheck: 58,
    alcoholMix: 0.62,
  },
];

const CATEGORIES = [
  { name: "Starters", course: "starter" as const, sort: 1 },
  { name: "Mains", course: "main" as const, sort: 2 },
  { name: "Sides", course: "side" as const, sort: 3 },
  { name: "Desserts", course: "dessert" as const, sort: 4 },
  { name: "Cocktails", course: "cocktail" as const, sort: 5 },
  { name: "Wine", course: "wine" as const, sort: 6 },
  { name: "Beer", course: "beer" as const, sort: 7 },
  { name: "Non-Alcoholic", course: "non_alcoholic" as const, sort: 8 },
];

interface MenuItemDef {
  sku: string;
  category: string;
  name: string;
  price: number;
  cost: number;
  alcoholic?: boolean;
  menuClass: "star" | "plowhorse" | "puzzle" | "dog";
  recipe: ReadonlyArray<{ ing: string; qty: number; unit: string }>;
}

const MENU: MenuItemDef[] = [
  // Starters
  { sku: "M-S01", category: "Starters", name: "Crispy Burrata", price: 16, cost: 4.2, menuClass: "star",     recipe: [{ ing: "ING-burrata", qty: 120, unit: "g" }, { ing: "ING-tomato", qty: 80, unit: "g" }, { ing: "ING-basil", qty: 5, unit: "g" }] },
  { sku: "M-S02", category: "Starters", name: "Tuna Tartare", price: 19, cost: 6.8, menuClass: "puzzle",   recipe: [{ ing: "ING-tuna", qty: 90, unit: "g" }, { ing: "ING-avocado", qty: 50, unit: "g" }, { ing: "ING-sesame", qty: 5, unit: "g" }] },
  { sku: "M-S03", category: "Starters", name: "House Soup",   price: 11, cost: 1.9, menuClass: "plowhorse",recipe: [{ ing: "ING-stock", qty: 250, unit: "ml" }, { ing: "ING-onion", qty: 40, unit: "g" }] },
  { sku: "M-S04", category: "Starters", name: "Charcuterie Board", price: 24, cost: 9.5, menuClass: "puzzle", recipe: [{ ing: "ING-prosciutto", qty: 90, unit: "g" }, { ing: "ING-salami", qty: 80, unit: "g" }, { ing: "ING-bread", qty: 100, unit: "g" }] },
  // Mains
  { sku: "M-M01", category: "Mains", name: "Pan-Seared Salmon", price: 32, cost: 8.5, menuClass: "star",      recipe: [{ ing: "ING-salmon", qty: 180, unit: "g" }, { ing: "ING-butter", qty: 20, unit: "g" }, { ing: "ING-lemon", qty: 30, unit: "g" }] },
  { sku: "M-M02", category: "Mains", name: "Ribeye 12oz",       price: 48, cost: 16.0, menuClass: "puzzle",    recipe: [{ ing: "ING-ribeye", qty: 340, unit: "g" }, { ing: "ING-butter", qty: 20, unit: "g" }] },
  { sku: "M-M03", category: "Mains", name: "Cacio e Pepe",      price: 22, cost: 3.4, menuClass: "star",       recipe: [{ ing: "ING-pasta", qty: 110, unit: "g" }, { ing: "ING-pecorino", qty: 30, unit: "g" }, { ing: "ING-pepper", qty: 4, unit: "g" }] },
  { sku: "M-M04", category: "Mains", name: "Roasted Half Chicken", price: 28, cost: 6.2, menuClass: "plowhorse", recipe: [{ ing: "ING-chicken", qty: 500, unit: "g" }, { ing: "ING-herbs", qty: 5, unit: "g" }] },
  { sku: "M-M05", category: "Mains", name: "Wild Mushroom Risotto", price: 26, cost: 5.1, menuClass: "star",    recipe: [{ ing: "ING-rice", qty: 120, unit: "g" }, { ing: "ING-mushroom", qty: 80, unit: "g" }, { ing: "ING-parmesan", qty: 30, unit: "g" }] },
  { sku: "M-M06", category: "Mains", name: "Lobster Roll",         price: 38, cost: 14.0, menuClass: "puzzle", recipe: [{ ing: "ING-lobster", qty: 140, unit: "g" }, { ing: "ING-brioche", qty: 90, unit: "g" }] },
  { sku: "M-M07", category: "Mains", name: "Truffle Burger",       price: 24, cost: 5.4, menuClass: "star",    recipe: [{ ing: "ING-ground-beef", qty: 200, unit: "g" }, { ing: "ING-brioche", qty: 80, unit: "g" }, { ing: "ING-truffle-oil", qty: 5, unit: "ml" }] },
  { sku: "M-M08", category: "Mains", name: "Avocado Toast",        price: 14, cost: 2.6, menuClass: "plowhorse", recipe: [{ ing: "ING-bread", qty: 110, unit: "g" }, { ing: "ING-avocado", qty: 80, unit: "g" }] },
  // Sides
  { sku: "M-SD01", category: "Sides", name: "Truffle Fries",    price: 11, cost: 1.8, menuClass: "star",       recipe: [{ ing: "ING-potato", qty: 200, unit: "g" }, { ing: "ING-truffle-oil", qty: 5, unit: "ml" }] },
  { sku: "M-SD02", category: "Sides", name: "Roasted Veg",      price: 9,  cost: 1.4, menuClass: "plowhorse",   recipe: [{ ing: "ING-vegetables", qty: 180, unit: "g" }] },
  { sku: "M-SD03", category: "Sides", name: "Caesar Side",      price: 8,  cost: 1.2, menuClass: "plowhorse",   recipe: [{ ing: "ING-romaine", qty: 120, unit: "g" }, { ing: "ING-parmesan", qty: 15, unit: "g" }] },
  // Desserts
  { sku: "M-D01", category: "Desserts", name: "Chocolate Tart",     price: 12, cost: 1.9, menuClass: "star",   recipe: [{ ing: "ING-chocolate", qty: 60, unit: "g" }, { ing: "ING-butter", qty: 20, unit: "g" }] },
  { sku: "M-D02", category: "Desserts", name: "Crème Brûlée",       price: 11, cost: 1.6, menuClass: "plowhorse", recipe: [{ ing: "ING-cream", qty: 120, unit: "ml" }, { ing: "ING-sugar", qty: 30, unit: "g" }] },
  { sku: "M-D03", category: "Desserts", name: "Seasonal Sorbet",    price: 9,  cost: 1.1, menuClass: "dog",    recipe: [{ ing: "ING-fruit", qty: 80, unit: "g" }] },
  // Cocktails
  { sku: "M-C01", category: "Cocktails", name: "Old Fashioned",      price: 16, cost: 2.2, alcoholic: true, menuClass: "star",     recipe: [{ ing: "ING-whiskey", qty: 60, unit: "ml" }, { ing: "ING-bitters", qty: 3, unit: "ml" }] },
  { sku: "M-C02", category: "Cocktails", name: "Espresso Martini",   price: 17, cost: 2.4, alcoholic: true, menuClass: "star",     recipe: [{ ing: "ING-vodka", qty: 50, unit: "ml" }, { ing: "ING-coffee-liqueur", qty: 25, unit: "ml" }, { ing: "ING-espresso", qty: 30, unit: "ml" }] },
  { sku: "M-C03", category: "Cocktails", name: "Spicy Margarita",    price: 15, cost: 2.0, alcoholic: true, menuClass: "puzzle",   recipe: [{ ing: "ING-tequila", qty: 50, unit: "ml" }, { ing: "ING-lime", qty: 30, unit: "ml" }] },
  { sku: "M-C04", category: "Cocktails", name: "Negroni",            price: 16, cost: 2.3, alcoholic: true, menuClass: "plowhorse",recipe: [{ ing: "ING-gin", qty: 30, unit: "ml" }, { ing: "ING-campari", qty: 30, unit: "ml" }, { ing: "ING-vermouth", qty: 30, unit: "ml" }] },
  { sku: "M-C05", category: "Cocktails", name: "Paloma",             price: 14, cost: 1.9, alcoholic: true, menuClass: "dog",      recipe: [{ ing: "ING-tequila", qty: 50, unit: "ml" }, { ing: "ING-grapefruit", qty: 80, unit: "ml" }] },
  // Wine
  { sku: "M-W01", category: "Wine", name: "House Red, Glass",    price: 14, cost: 2.6, alcoholic: true, menuClass: "plowhorse",  recipe: [{ ing: "ING-red-wine", qty: 175, unit: "ml" }] },
  { sku: "M-W02", category: "Wine", name: "House White, Glass",  price: 13, cost: 2.4, alcoholic: true, menuClass: "plowhorse",  recipe: [{ ing: "ING-white-wine", qty: 175, unit: "ml" }] },
  { sku: "M-W03", category: "Wine", name: "Reserve Bottle",      price: 78, cost: 22.0, alcoholic: true, menuClass: "puzzle",    recipe: [{ ing: "ING-red-wine", qty: 750, unit: "ml" }] },
  // Beer
  { sku: "M-B01", category: "Beer", name: "Draft IPA",       price: 9, cost: 1.5, alcoholic: true, menuClass: "star",        recipe: [{ ing: "ING-beer-ipa", qty: 470, unit: "ml" }] },
  { sku: "M-B02", category: "Beer", name: "Pilsner",         price: 8, cost: 1.3, alcoholic: true, menuClass: "plowhorse",   recipe: [{ ing: "ING-beer-pilsner", qty: 470, unit: "ml" }] },
  { sku: "M-B03", category: "Beer", name: "Stout",           price: 9, cost: 1.5, alcoholic: true, menuClass: "dog",         recipe: [{ ing: "ING-beer-stout", qty: 470, unit: "ml" }] },
  // Non-alcoholic
  { sku: "M-N01", category: "Non-Alcoholic", name: "Sparkling Water", price: 5, cost: 0.5, menuClass: "plowhorse", recipe: [{ ing: "ING-sparkling-water", qty: 330, unit: "ml" }] },
  { sku: "M-N02", category: "Non-Alcoholic", name: "Cold Brew",        price: 6, cost: 0.7, menuClass: "plowhorse", recipe: [{ ing: "ING-coffee", qty: 18, unit: "g" }] },
  { sku: "M-N03", category: "Non-Alcoholic", name: "House Lemonade",   price: 6, cost: 0.6, menuClass: "plowhorse", recipe: [{ ing: "ING-lemon", qty: 50, unit: "g" }, { ing: "ING-sugar", qty: 20, unit: "g" }] },
  { sku: "M-N04", category: "Non-Alcoholic", name: "Espresso",         price: 4, cost: 0.4, menuClass: "plowhorse", recipe: [{ ing: "ING-coffee", qty: 18, unit: "g" }] },
  { sku: "M-N05", category: "Non-Alcoholic", name: "Mocktail Spritz",  price: 9, cost: 1.0, menuClass: "puzzle",    recipe: [{ ing: "ING-na-bitters", qty: 20, unit: "ml" }] },
];

interface IngredientDef {
  sku: string;
  name: string;
  category: "protein" | "produce" | "dairy" | "dry" | "frozen" | "beverage_na" | "beer" | "wine" | "spirit" | "liqueur" | "mixer" | "paper" | "cleaning";
  unit: string;
  unitCost: number;
  shelfLife: number;
  supplier: string;
}

const INGREDIENTS: IngredientDef[] = [
  { sku: "ING-burrata",        name: "Burrata cheese",      category: "dairy",    unit: "g",  unitCost: 0.025,  shelfLife: 7,   supplier: "Hudson Dairy" },
  { sku: "ING-tomato",         name: "Heirloom tomato",     category: "produce",  unit: "g",  unitCost: 0.008,  shelfLife: 7,   supplier: "Riverside Produce" },
  { sku: "ING-basil",          name: "Fresh basil",         category: "produce",  unit: "g",  unitCost: 0.025,  shelfLife: 5,   supplier: "Riverside Produce" },
  { sku: "ING-tuna",           name: "Sushi-grade tuna",    category: "protein",  unit: "g",  unitCost: 0.06,   shelfLife: 3,   supplier: "Atlantic Seafood" },
  { sku: "ING-avocado",        name: "Avocado",             category: "produce",  unit: "g",  unitCost: 0.012,  shelfLife: 5,   supplier: "Riverside Produce" },
  { sku: "ING-sesame",         name: "Sesame seeds",        category: "dry",      unit: "g",  unitCost: 0.02,   shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-stock",          name: "House chicken stock", category: "produce",  unit: "ml", unitCost: 0.003,  shelfLife: 5,   supplier: "Hudson Dairy" },
  { sku: "ING-onion",          name: "Yellow onion",        category: "produce",  unit: "g",  unitCost: 0.003,  shelfLife: 30,  supplier: "Riverside Produce" },
  { sku: "ING-prosciutto",     name: "Prosciutto di Parma", category: "protein",  unit: "g",  unitCost: 0.055,  shelfLife: 14,  supplier: "Hudson Dairy" },
  { sku: "ING-salami",         name: "Soppressata salami",  category: "protein",  unit: "g",  unitCost: 0.04,   shelfLife: 21,  supplier: "Hudson Dairy" },
  { sku: "ING-bread",          name: "Artisan loaf",        category: "dry",      unit: "g",  unitCost: 0.007,  shelfLife: 3,   supplier: "Pantry Direct" },
  { sku: "ING-salmon",         name: "Atlantic salmon",     category: "protein",  unit: "g",  unitCost: 0.035,  shelfLife: 3,   supplier: "Atlantic Seafood" },
  { sku: "ING-butter",         name: "European butter",     category: "dairy",    unit: "g",  unitCost: 0.012,  shelfLife: 30,  supplier: "Hudson Dairy" },
  { sku: "ING-lemon",          name: "Lemon",               category: "produce",  unit: "g",  unitCost: 0.005,  shelfLife: 14,  supplier: "Riverside Produce" },
  { sku: "ING-ribeye",         name: "Prime ribeye",        category: "protein",  unit: "g",  unitCost: 0.042,  shelfLife: 5,   supplier: "Empire Meats" },
  { sku: "ING-pasta",          name: "Fresh tonnarelli",    category: "dry",      unit: "g",  unitCost: 0.01,   shelfLife: 14,  supplier: "Pantry Direct" },
  { sku: "ING-pecorino",       name: "Pecorino Romano",     category: "dairy",    unit: "g",  unitCost: 0.03,   shelfLife: 60,  supplier: "Hudson Dairy" },
  { sku: "ING-pepper",         name: "Tellicherry pepper",  category: "dry",      unit: "g",  unitCost: 0.025,  shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-chicken",        name: "Whole chicken",       category: "protein",  unit: "g",  unitCost: 0.011,  shelfLife: 3,   supplier: "Empire Meats" },
  { sku: "ING-herbs",          name: "Fresh herb blend",    category: "produce",  unit: "g",  unitCost: 0.04,   shelfLife: 5,   supplier: "Riverside Produce" },
  { sku: "ING-rice",           name: "Arborio rice",        category: "dry",      unit: "g",  unitCost: 0.005,  shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-mushroom",       name: "Wild mushroom mix",   category: "produce",  unit: "g",  unitCost: 0.025,  shelfLife: 7,   supplier: "Riverside Produce" },
  { sku: "ING-parmesan",       name: "Parmesan Reggiano",   category: "dairy",    unit: "g",  unitCost: 0.035,  shelfLife: 60,  supplier: "Hudson Dairy" },
  { sku: "ING-lobster",        name: "Maine lobster meat",  category: "protein",  unit: "g",  unitCost: 0.08,   shelfLife: 2,   supplier: "Atlantic Seafood" },
  { sku: "ING-brioche",        name: "Brioche bun",         category: "dry",      unit: "g",  unitCost: 0.012,  shelfLife: 3,   supplier: "Pantry Direct" },
  { sku: "ING-ground-beef",    name: "Ground chuck",        category: "protein",  unit: "g",  unitCost: 0.018,  shelfLife: 2,   supplier: "Empire Meats" },
  { sku: "ING-truffle-oil",    name: "Truffle oil",         category: "dry",      unit: "ml", unitCost: 0.12,   shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-potato",         name: "Yukon gold potato",   category: "produce",  unit: "g",  unitCost: 0.003,  shelfLife: 30,  supplier: "Riverside Produce" },
  { sku: "ING-vegetables",     name: "Seasonal veg mix",    category: "produce",  unit: "g",  unitCost: 0.006,  shelfLife: 5,   supplier: "Riverside Produce" },
  { sku: "ING-romaine",        name: "Romaine hearts",      category: "produce",  unit: "g",  unitCost: 0.005,  shelfLife: 7,   supplier: "Riverside Produce" },
  { sku: "ING-chocolate",      name: "70% dark chocolate",  category: "dry",      unit: "g",  unitCost: 0.018,  shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-cream",          name: "Heavy cream",         category: "dairy",    unit: "ml", unitCost: 0.005,  shelfLife: 7,   supplier: "Hudson Dairy" },
  { sku: "ING-sugar",          name: "Cane sugar",          category: "dry",      unit: "g",  unitCost: 0.002,  shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-fruit",          name: "Seasonal fruit",      category: "produce",  unit: "g",  unitCost: 0.008,  shelfLife: 5,   supplier: "Riverside Produce" },
  { sku: "ING-whiskey",        name: "Rye whiskey",         category: "spirit",   unit: "ml", unitCost: 0.025,  shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-bitters",        name: "Angostura bitters",   category: "liqueur",  unit: "ml", unitCost: 0.04,   shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-vodka",          name: "Premium vodka",       category: "spirit",   unit: "ml", unitCost: 0.022,  shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-coffee-liqueur", name: "Coffee liqueur",      category: "liqueur",  unit: "ml", unitCost: 0.018,  shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-espresso",       name: "Espresso shot",       category: "beverage_na", unit: "ml", unitCost: 0.01, shelfLife: 1, supplier: "Pantry Direct" },
  { sku: "ING-tequila",        name: "Blanco tequila",      category: "spirit",   unit: "ml", unitCost: 0.024,  shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-lime",           name: "Fresh lime juice",    category: "produce",  unit: "ml", unitCost: 0.006,  shelfLife: 3,   supplier: "Riverside Produce" },
  { sku: "ING-gin",            name: "London dry gin",      category: "spirit",   unit: "ml", unitCost: 0.022,  shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-campari",        name: "Campari",             category: "liqueur",  unit: "ml", unitCost: 0.028,  shelfLife: 1825, supplier: "Premier Liquor" },
  { sku: "ING-vermouth",       name: "Sweet vermouth",      category: "wine",     unit: "ml", unitCost: 0.012,  shelfLife: 90,  supplier: "Premier Liquor" },
  { sku: "ING-grapefruit",     name: "Grapefruit juice",    category: "produce",  unit: "ml", unitCost: 0.004,  shelfLife: 5,   supplier: "Riverside Produce" },
  { sku: "ING-red-wine",       name: "House red wine",      category: "wine",     unit: "ml", unitCost: 0.011,  shelfLife: 365, supplier: "Premier Liquor" },
  { sku: "ING-white-wine",     name: "House white wine",    category: "wine",     unit: "ml", unitCost: 0.010,  shelfLife: 365, supplier: "Premier Liquor" },
  { sku: "ING-beer-ipa",       name: "Local IPA keg",       category: "beer",     unit: "ml", unitCost: 0.0032, shelfLife: 90,  supplier: "Premier Liquor" },
  { sku: "ING-beer-pilsner",   name: "Pilsner keg",         category: "beer",     unit: "ml", unitCost: 0.0028, shelfLife: 90,  supplier: "Premier Liquor" },
  { sku: "ING-beer-stout",     name: "Stout keg",           category: "beer",     unit: "ml", unitCost: 0.0032, shelfLife: 90,  supplier: "Premier Liquor" },
  { sku: "ING-sparkling-water",name: "Sparkling water",     category: "beverage_na", unit: "ml", unitCost: 0.0015, shelfLife: 365, supplier: "Pantry Direct" },
  { sku: "ING-coffee",         name: "Single-origin coffee",category: "beverage_na", unit: "g", unitCost: 0.04,    shelfLife: 30,  supplier: "Pantry Direct" },
  { sku: "ING-na-bitters",     name: "Non-alc bitters",     category: "beverage_na", unit: "ml", unitCost: 0.05,    shelfLife: 365, supplier: "Premier Liquor" },
];

const SUPPLIERS = [
  { name: "Hudson Dairy",        category: "dairy_protein", terms: "net_30" },
  { name: "Riverside Produce",   category: "produce",       terms: "net_15" },
  { name: "Atlantic Seafood",    category: "seafood",       terms: "cod" },
  { name: "Empire Meats",        category: "protein",       terms: "net_30" },
  { name: "Pantry Direct",       category: "dry_goods",     terms: "net_30" },
  { name: "Premier Liquor",      category: "alcohol",       terms: "net_30" },
];

const GL_ACCOUNTS: ReadonlyArray<{ code: string; name: string; type: "asset"|"liability"|"equity"|"revenue"|"cogs"|"expense"; category: string }> = [
  { code: "1010", name: "Cash on Hand",            type: "asset",    category: "current_asset" },
  { code: "1020", name: "Bank — Operating",        type: "asset",    category: "current_asset" },
  { code: "1030", name: "Credit Card Receivable",  type: "asset",    category: "current_asset" },
  { code: "1040", name: "3rd-Party Delivery Receivable", type: "asset", category: "current_asset" },
  { code: "1200", name: "Inventory — Food",        type: "asset",    category: "current_asset" },
  { code: "1210", name: "Inventory — Bar",         type: "asset",    category: "current_asset" },
  { code: "2100", name: "Sales Tax Payable",       type: "liability", category: "current_liability" },
  { code: "2200", name: "Tips Payable",            type: "liability", category: "current_liability" },
  { code: "4010", name: "Sales — Food",            type: "revenue",  category: "revenue" },
  { code: "4020", name: "Sales — Alcohol",         type: "revenue",  category: "revenue" },
  { code: "4030", name: "Sales — N/A Beverage",    type: "revenue",  category: "revenue" },
  { code: "4900", name: "Sales — Comps",           type: "revenue",  category: "contra_revenue" },
  { code: "4910", name: "Sales — Voids",           type: "revenue",  category: "contra_revenue" },
  { code: "4920", name: "Sales — Discounts",       type: "revenue",  category: "contra_revenue" },
  { code: "5010", name: "COGS — Food",             type: "cogs",     category: "cogs" },
  { code: "5020", name: "COGS — Alcohol",          type: "cogs",     category: "cogs" },
  { code: "5030", name: "COGS — N/A Beverage",     type: "cogs",     category: "cogs" },
  { code: "6010", name: "Labor — FOH",             type: "expense",  category: "operating_expense" },
  { code: "6020", name: "Labor — BOH",             type: "expense",  category: "operating_expense" },
  { code: "6030", name: "Labor — Management",      type: "expense",  category: "operating_expense" },
  { code: "6100", name: "Credit Card Processing Fees", type: "expense", category: "operating_expense" },
  { code: "6200", name: "Waste",                   type: "expense",  category: "operating_expense" },
  { code: "2300", name: "Payroll Payable",         type: "liability", category: "current_liability" },
  { code: "4990", name: "Contra-Revenue Offset",   type: "revenue",  category: "contra_offset" },
];

// ─────────────────────────────────────────────────────────────────────────
// Helpers for time within a business day
// ─────────────────────────────────────────────────────────────────────────
function businessDay(d: Date): Date {
  // Treat midnight UTC as the start; F&B 4am cutoff handled at query time.
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function ticketOpenedAt(businessDay_: Date, daypart: "breakfast"|"lunch"|"dinner"|"latenight"): Date {
  let hour: number;
  let minute = randint(0, 59);
  switch (daypart) {
    case "breakfast": hour = randint(8, 10); break;
    case "lunch":     hour = randint(11, 14); break;
    case "dinner":    hour = randint(17, 22); break;
    case "latenight": hour = randint(23, 25); break;
  }
  const d = new Date(businessDay_);
  d.setUTCHours(hour, minute, randint(0, 59));
  return d;
}

interface CompositionRule {
  daypart: "breakfast"|"lunch"|"dinner"|"latenight";
  itemsRange: [number, number];
  alcoholBias: number;
}

const COMPOSITION: Record<string, CompositionRule[]> = {
  full_service: [
    { daypart: "breakfast", itemsRange: [1, 3], alcoholBias: 0.1 },
    { daypart: "lunch",     itemsRange: [2, 4], alcoholBias: 0.2 },
    { daypart: "dinner",    itemsRange: [3, 6], alcoholBias: 0.45 },
    { daypart: "latenight", itemsRange: [1, 3], alcoholBias: 0.6 },
  ],
  bar: [
    { daypart: "lunch",     itemsRange: [1, 3], alcoholBias: 0.4 },
    { daypart: "dinner",    itemsRange: [2, 5], alcoholBias: 0.55 },
    { daypart: "latenight", itemsRange: [2, 4], alcoholBias: 0.75 },
  ],
  fast_casual: [
    { daypart: "lunch",  itemsRange: [1, 3], alcoholBias: 0.1 },
    { daypart: "dinner", itemsRange: [1, 3], alcoholBias: 0.15 },
  ],
  cafe: [
    { daypart: "breakfast", itemsRange: [1, 2], alcoholBias: 0 },
    { daypart: "lunch",     itemsRange: [1, 2], alcoholBias: 0 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required (e.g. postgresql://localhost:5432/arivie_pos)");
    process.exit(2);
  }

  const sql = postgres(databaseUrl, { max: 4 });

  console.log("→ truncating tables");
  await sql`TRUNCATE outlets, menu_categories, menu_items, modifiers, ingredients,
            recipe_lines, suppliers, purchase_orders, purchase_order_lines,
            stock_movements, tickets, ticket_items, ticket_item_modifiers,
            tenders, employees, shifts, time_entries, gl_accounts, gl_entries
            RESTART IDENTITY CASCADE`;

  // ── outlets
  console.log("→ outlets");
  for (const o of OUTLETS) {
    await sql`
      INSERT INTO outlets (id, name, brand, concept, city, state, country, timezone,
                           business_day_cutoff_hour, opened_on, seats, is_active)
      VALUES (${o.id}, ${o.name}, ${o.brand}, ${o.concept}, ${o.city}, ${o.state},
              'US', 'America/New_York', 4, '2023-01-15', ${o.seats}, TRUE)
    `;
  }

  // ── categories
  console.log("→ categories");
  const catIdByName = new Map<string, number>();
  for (const c of CATEGORIES) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO menu_categories (name, course, sort_order)
      VALUES (${c.name}, ${c.course}, ${c.sort})
      RETURNING id
    `;
    catIdByName.set(c.name, row!.id);
  }

  // ── menu items
  console.log("→ menu items");
  const itemIdBySku = new Map<string, number>();
  for (const m of MENU) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO menu_items (sku, category_id, name, description, list_price,
                              theoretical_food_cost, is_alcoholic, is_active, menu_class)
      VALUES (${m.sku}, ${catIdByName.get(m.category)!}, ${m.name}, NULL, ${m.price},
              ${m.cost}, ${m.alcoholic ?? false}, TRUE, ${m.menuClass})
      RETURNING id
    `;
    itemIdBySku.set(m.sku, row!.id);
  }

  // ── modifiers
  console.log("→ modifiers");
  const GLOBAL_MODS = [
    { group: "preparation", name: "Extra spicy",  delta: 0 },
    { group: "preparation", name: "Mild",         delta: 0 },
    { group: "preparation", name: "No onion",     delta: 0 },
    { group: "preparation", name: "No salt",      delta: 0 },
    { group: "addon",       name: "Add avocado",  delta: 3 },
    { group: "addon",       name: "Add cheese",   delta: 2 },
    { group: "addon",       name: "Add bacon",    delta: 4 },
    { group: "doneness",    name: "Rare",         delta: 0 },
    { group: "doneness",    name: "Medium-rare",  delta: 0 },
    { group: "doneness",    name: "Medium",       delta: 0 },
    { group: "doneness",    name: "Well done",    delta: 0 },
  ];
  const modIds: number[] = [];
  for (const mod of GLOBAL_MODS) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO modifiers (menu_item_id, name, modifier_group, price_delta, is_default)
      VALUES (NULL, ${mod.name}, ${mod.group}, ${mod.delta}, FALSE)
      RETURNING id
    `;
    modIds.push(row!.id);
  }

  // ── ingredients
  console.log("→ ingredients");
  const ingIdBySku = new Map<string, number>();
  for (const ing of INGREDIENTS) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO ingredients (sku, name, category, unit, shelf_life_days)
      VALUES (${ing.sku}, ${ing.name}, ${ing.category}, ${ing.unit}, ${ing.shelfLife})
      RETURNING id
    `;
    ingIdBySku.set(ing.sku, row!.id);
  }

  // ── suppliers
  console.log("→ suppliers");
  const supplierIdByName = new Map<string, number>();
  for (const s of SUPPLIERS) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO suppliers (name, category, payment_terms)
      VALUES (${s.name}, ${s.category}, ${s.terms})
      RETURNING id
    `;
    supplierIdByName.set(s.name, row!.id);
  }

  // ── recipe lines
  console.log("→ recipes");
  for (const m of MENU) {
    for (const line of m.recipe) {
      await sql`
        INSERT INTO recipe_lines (menu_item_id, ingredient_id, qty, unit)
        VALUES (${itemIdBySku.get(m.sku)!}, ${ingIdBySku.get(line.ing)!},
                ${line.qty}, ${line.unit})
      `;
    }
  }

  // ── employees
  console.log("→ employees");
  type EmpId = string;
  const employeesByOutlet = new Map<OutletKey, { id: EmpId; role: string; wage: number; tipEligible: boolean; name: string }[]>();
  const FIRST_NAMES = ["Aiden","Mira","Tomás","Priya","Naomi","Eli","Camille","Wren","Sofia","Mateo","Yuki","Kofi","Zara","Theo","Anya","Luca","Naila","Jonas","Hana","Devon"];
  const LAST_NAMES  = ["Rivera","Chen","Okafor","Lindqvist","Patel","Romano","Bauer","Tanaka","Garcia","Kowalski","Bennett","Hoang"];

  let empCounter = 0;
  function nextName(): string {
    const a = pick(FIRST_NAMES);
    const b = pick(LAST_NAMES);
    return `${a} ${b}`;
  }

  for (const o of OUTLETS) {
    const roster: { id: EmpId; role: string; wage: number; tipEligible: boolean; name: string }[] = [];
    const ROSTER_BLUEPRINT: Array<{ role: string; count: number; wage: number; tip: boolean }> = [
      { role: "gm",          count: 1, wage: 38, tip: false },
      { role: "exec_chef",   count: 1, wage: 36, tip: false },
      { role: "sous_chef",   count: 1, wage: 26, tip: false },
      { role: "line_cook",   count: 3, wage: 20, tip: false },
      { role: "dishwasher",  count: 1, wage: 17, tip: false },
      { role: "foh_manager", count: 1, wage: 28, tip: false },
      { role: "server",      count: 3, wage: 15, tip: true },
      { role: "bartender",   count: o.concept === "bar" ? 2 : 1, wage: 16, tip: true },
      { role: "host",        count: 1, wage: 17, tip: false },
    ];
    for (const slot of ROSTER_BLUEPRINT) {
      for (let i = 0; i < slot.count; i += 1) {
        const id = `emp-${(++empCounter).toString().padStart(4, "0")}`;
        const name = nextName();
        await sql`
          INSERT INTO employees (id, outlet_id, full_name, role, hourly_wage, tip_eligible, hired_on, is_active)
          VALUES (${id}, ${o.id}, ${name}, ${slot.role}, ${slot.wage}, ${slot.tip},
                  '2023-06-01', TRUE)
        `;
        roster.push({ id, role: slot.role, wage: slot.wage, tipEligible: slot.tip, name });
      }
    }
    // Single chain-level owner attached to the flagship.
    if (o.id === "luminere-bistro") {
      const id = `emp-${(++empCounter).toString().padStart(4, "0")}`;
      await sql`
        INSERT INTO employees (id, outlet_id, full_name, role, hourly_wage, tip_eligible, hired_on, is_active)
        VALUES (${id}, ${o.id}, 'Renée Marchetti', 'owner', 0, FALSE, '2023-01-15', TRUE)
      `;
      roster.push({ id, role: "owner", wage: 0, tipEligible: false, name: "Renée Marchetti" });
    }
    // One bookkeeper attached to the flagship.
    if (o.id === "luminere-bistro") {
      const id = `emp-${(++empCounter).toString().padStart(4, "0")}`;
      await sql`
        INSERT INTO employees (id, outlet_id, full_name, role, hourly_wage, tip_eligible, hired_on, is_active)
        VALUES (${id}, ${o.id}, 'David Okonkwo', 'bookkeeper', 32, FALSE, '2023-02-01', TRUE)
      `;
      roster.push({ id, role: "bookkeeper", wage: 32, tipEligible: false, name: "David Okonkwo" });
    }
    employeesByOutlet.set(o.id, roster);
  }

  // ── GL accounts (idempotent in case schema bootstraps them later)
  console.log("→ gl accounts");
  for (const acc of GL_ACCOUNTS) {
    await sql`
      INSERT INTO gl_accounts (code, name, account_type, category)
      VALUES (${acc.code}, ${acc.name}, ${acc.type}, ${acc.category})
      ON CONFLICT (code) DO NOTHING
    `;
  }

  // ── 14-day operational loop
  console.log("→ 14-day operational data (this may take ~20s)");
  let ticketCounter = 0;
  let poCounter = 0;
  const startBd = new Date(TODAY);
  startBd.setUTCDate(startBd.getUTCDate() - SEED_WINDOW_DAYS);

  for (let dayOffset = 0; dayOffset < SEED_WINDOW_DAYS; dayOffset += 1) {
    const bd = new Date(startBd);
    bd.setUTCDate(bd.getUTCDate() + dayOffset);
    const dow = bd.getUTCDay();
    const isWeekend = dow === 5 || dow === 6 || dow === 0;
    const weekendMult = isWeekend ? 1.25 : 1.0;

    for (const outlet of OUTLETS) {
      // ── shifts + time entries
      const roster = employeesByOutlet.get(outlet.id)!;
      let dailyLaborCost = 0;
      for (const emp of roster) {
        if (emp.role === "owner") continue;
        // Skip ~15% of shifts to vary the schedule
        if (chance(0.15)) continue;
        const startH = emp.role === "line_cook" || emp.role === "sous_chef" || emp.role === "exec_chef" ? 9
                     : emp.role === "host" || emp.role === "server" ? 11
                     : emp.role === "bartender" && outlet.concept === "bar" ? 16
                     : 10;
        const endH = emp.role === "bartender" && outlet.concept === "bar" ? 26
                   : emp.role === "line_cook" || emp.role === "exec_chef" ? 22
                   : 23;
        const start = new Date(bd);
        start.setUTCHours(startH, randint(0, 30), 0, 0);
        const end = new Date(bd);
        end.setUTCHours(endH, randint(0, 45), 0, 0);
        if (end.getUTCDate() === start.getUTCDate() && endH >= 24) {
          end.setUTCDate(end.getUTCDate() + 1);
          end.setUTCHours(endH - 24, end.getUTCMinutes(), 0, 0);
        }
        const shiftId = `shift-${outlet.id}-${bd.toISOString().slice(0, 10)}-${emp.id}`;
        await sql`
          INSERT INTO shifts (id, outlet_id, employee_id, business_day, scheduled_start, scheduled_end, role_assigned, section)
          VALUES (${shiftId}, ${outlet.id}, ${emp.id}, ${bd.toISOString().slice(0, 10)},
                  ${start.toISOString()}, ${end.toISOString()}, ${emp.role},
                  ${emp.role === "server" ? `section-${randint(1, 4)}` : null})
        `;
        const breakMin = emp.role === "owner" || emp.role === "bookkeeper" ? 0 : randint(20, 45);
        const declaredTips = emp.tipEligible ? money(rand(30, 220) * weekendMult) : 0;
        const actualEnd = new Date(end.getTime() + randint(-15, 30) * 60_000);
        const hours = (actualEnd.getTime() - start.getTime()) / 3_600_000 - breakMin / 60;
        dailyLaborCost += emp.wage * Math.max(0, hours);
        await sql`
          INSERT INTO time_entries (shift_id, employee_id, outlet_id, business_day, clock_in_at, clock_out_at, break_minutes, hourly_wage, declared_tips)
          VALUES (${shiftId}, ${emp.id}, ${outlet.id}, ${bd.toISOString().slice(0, 10)},
                  ${start.toISOString()}, ${actualEnd.toISOString()}, ${breakMin},
                  ${emp.wage}, ${declaredTips})
        `;
      }

      // ── tickets
      const servers = roster.filter((e) => e.role === "server" || (e.role === "bartender" && outlet.concept === "bar"));
      const composition = COMPOSITION[outlet.concept]!;
      let dailyFoodCogs = 0;
      let dailyAlcoholCogs = 0;
      let dailyNaCogs = 0;
      let dailyFoodSales = 0;
      let dailyAlcoholSales = 0;
      let dailyNaSales = 0;
      let dailyTax = 0;
      let dailyComp = 0;
      let dailyVoid = 0;
      let dailyDiscount = 0;
      const tenderTotals = new Map<string, { amount: number; tip: number; fee: number }>();

      for (const dp of composition) {
        const baseCount = outlet.dailyTicketTarget[dp.daypart];
        const adjustedCount = Math.round(baseCount * weekendMult * rand(0.85, 1.15));
        for (let i = 0; i < adjustedCount; i += 1) {
          ticketCounter += 1;
          const ticketId = `tk-${ticketCounter.toString().padStart(7, "0")}`;
          const opened = ticketOpenedAt(bd, dp.daypart);
          let closed: Date | null = new Date(opened.getTime() + randint(20, 110) * 60_000);
          const serviceType: "dine_in"|"takeout"|"delivery"|"bar"|"online" =
            outlet.concept === "bar"
              ? (chance(0.85) ? "bar" : (chance(0.6) ? "dine_in" : "takeout"))
              : (dp.daypart === "breakfast" ? (chance(0.4) ? "takeout" : "dine_in")
                 : (chance(0.55) ? "dine_in" : chance(0.5) ? "takeout" : "delivery"));
          const channel: "in_house"|"doordash"|"ubereats"|"grubhub"|"own_app"|"phone"|"walk_in" =
            serviceType === "delivery" ? (chance(0.5) ? "doordash" : chance(0.6) ? "ubereats" : "grubhub")
            : serviceType === "online" ? "own_app"
            : serviceType === "takeout" ? (chance(0.5) ? "phone" : "walk_in")
            : "in_house";

          const guestCount = serviceType === "dine_in" ? randint(1, 4) : 1;
          const tableNumber = serviceType === "dine_in" ? randint(1, 24) : null;
          const server = servers.length > 0 ? pick(servers) : null;

          const [low, high] = dp.itemsRange;
          const itemCount = randint(low, high);
          const itemsOnTicket: { item: MenuItemDef; qty: number; lineSubtotal: number; sentToKitchenAt: Date; firedAt: Date|null }[] = [];

          // Composition: respect alcoholBias for outlet style
          for (let k = 0; k < itemCount; k += 1) {
            const wantAlcohol = chance(dp.alcoholBias);
            const pool = MENU.filter((m) => wantAlcohol ? !!m.alcoholic : !m.alcoholic);
            const m = pick(pool);
            const qty = chance(0.85) ? 1 : 2;
            const lineSubtotal = money(m.price * qty);
            const sentToKitchen = new Date(opened.getTime() + randint(2, 12) * 60_000);
            const fired = serviceType === "dine_in" ? new Date(sentToKitchen.getTime() + randint(8, 28) * 60_000) : null;
            itemsOnTicket.push({ item: m, qty, lineSubtotal, sentToKitchenAt: sentToKitchen, firedAt: fired });
          }

          const subtotal = money(itemsOnTicket.reduce((s, x) => s + x.lineSubtotal, 0));

          // Discounts / comps / voids — realistic low rates
          const isVoided = chance(0.012);
          const isComped = chance(0.022) && !isVoided;
          const hasDiscount = chance(0.07) && !isVoided && !isComped;
          const discountAmt = hasDiscount ? money(subtotal * rand(0.05, 0.2)) : 0;
          const compAmt = isComped ? money(subtotal * rand(0.5, 1.0)) : 0;
          const voidAmt = isVoided ? subtotal : 0;
          const adjustedSubtotal = money(subtotal - discountAmt - compAmt - voidAmt);
          const taxAmt = money(adjustedSubtotal * 0.0875);
          const tipPct = serviceType === "dine_in" ? rand(0.15, 0.25)
                       : serviceType === "takeout" ? rand(0.0, 0.10)
                       : serviceType === "delivery" ? 0
                       : serviceType === "bar" ? rand(0.15, 0.22)
                       : 0;
          const tipAmt = money(adjustedSubtotal * tipPct);
          const totalAmt = money(adjustedSubtotal + taxAmt + tipAmt);

          let ticketStatus: "open"|"closed"|"voided"|"comped"|"transferred";
          if (isVoided) { ticketStatus = "voided"; closed = null; }
          else if (isComped) ticketStatus = "comped";
          else ticketStatus = "closed";

          // Open the ticket (server_id may be null for takeout/delivery)
          await sql`
            INSERT INTO tickets (
              id, outlet_id, ticket_number, business_day, opened_at, closed_at,
              service_type, channel, table_number, guest_count, server_id,
              subtotal, discount_amount, comp_amount, void_amount, tax_amount, tip_amount, total_amount,
              status, void_reason, comp_reason
            )
            VALUES (
              ${ticketId}, ${outlet.id}, ${ticketCounter}, ${bd.toISOString().slice(0, 10)},
              ${opened.toISOString()}, ${closed ? closed.toISOString() : null},
              ${serviceType}, ${channel}, ${tableNumber}, ${guestCount},
              ${server ? server.id : null},
              ${subtotal}, ${discountAmt}, ${compAmt}, ${voidAmt}, ${taxAmt}, ${tipAmt}, ${totalAmt},
              ${ticketStatus},
              ${isVoided ? pick(["wrong order", "guest walked out", "system error", "kitchen error"]) : null},
              ${isComped ? pick(["manager comp - quality", "loyalty appreciation", "vip table", "long wait apology"]) : null}
            )
          `;

          for (const it of itemsOnTicket) {
            const [row] = await sql<{ id: string }[]>`
              INSERT INTO ticket_items (
                ticket_id, menu_item_id, qty, unit_price, line_subtotal,
                discount_amount, comp_amount, void_amount, course,
                sent_to_kitchen_at, fired_at, is_voided, is_comped
              )
              VALUES (
                ${ticketId}, ${itemIdBySku.get(it.item.sku)!}, ${it.qty}, ${it.item.price}, ${it.lineSubtotal},
                ${0}, ${isComped ? money(it.lineSubtotal * 0.7) : 0}, ${isVoided ? it.lineSubtotal : 0},
                ${(() => { const cat = CATEGORIES.find((c) => c.name === it.item.category); return cat ? cat.course : null; })()},
                ${it.sentToKitchenAt.toISOString()}, ${it.firedAt ? it.firedAt.toISOString() : null},
                ${isVoided}, ${isComped}
              )
              RETURNING id::text AS id
            `;
            // ~25% chance of a modifier per item
            if (chance(0.25) && modIds.length > 0) {
              const modId = pick(modIds);
              await sql`
                INSERT INTO ticket_item_modifiers (ticket_item_id, modifier_id, price_delta)
                VALUES (${row!.id}, ${modId}, ${chance(0.4) ? randint(2, 4) : 0})
              `;
            }
            // Stock consumption from recipe (only if not voided)
            if (!isVoided) {
              for (const rline of it.item.recipe) {
                const ingId = ingIdBySku.get(rline.ing)!;
                const ingDef = INGREDIENTS.find((x) => x.sku === rline.ing)!;
                const consumedQty = rline.qty * it.qty;
                const consumedCost = money(consumedQty * ingDef.unitCost);
                await sql`
                  INSERT INTO stock_movements (outlet_id, ingredient_id, movement_type, qty, unit_cost, occurred_at, reference)
                  VALUES (${outlet.id}, ${ingId}, 'consume', ${consumedQty}, ${ingDef.unitCost},
                          ${it.sentToKitchenAt.toISOString()}, ${ticketId})
                `;
                if (ingDef.category === "beer" || ingDef.category === "wine" || ingDef.category === "spirit" || ingDef.category === "liqueur" || ingDef.category === "mixer") {
                  dailyAlcoholCogs += consumedCost;
                } else if (ingDef.category === "beverage_na") {
                  dailyNaCogs += consumedCost;
                } else {
                  dailyFoodCogs += consumedCost;
                }
              }
            }
            // Sales accrual: a comped ticket still RECOGNIZES revenue, with the
            // comp booked separately as contra (4900). Only voids are excluded
            // entirely from revenue recognition.
            if (!isVoided) {
              if (it.item.alcoholic) {
                dailyAlcoholSales += it.lineSubtotal;
              } else if (CATEGORIES.find((c) => c.name === it.item.category)?.course === "non_alcoholic") {
                dailyNaSales += it.lineSubtotal;
              } else {
                dailyFoodSales += it.lineSubtotal;
              }
            }
          }

          if (!isVoided) {
            // ── tenders: closed tickets get a tender (sometimes split)
            const remaining = totalAmt;
            const splits: number[] = [];
            if (serviceType === "delivery") {
              splits.push(totalAmt);
            } else if (chance(0.08) && totalAmt > 50) {
              const a = money(totalAmt * rand(0.3, 0.7));
              splits.push(a, money(totalAmt - a));
            } else {
              splits.push(remaining);
            }

            for (let s = 0; s < splits.length; s += 1) {
              const amt = splits[s]!;
              const tenderType: "cash"|"card_credit"|"card_debit"|"gift_card"|"house_account"|"comp"|"doordash_pay"|"ubereats_pay"|"grubhub_pay" =
                serviceType === "delivery"
                  ? (channel === "doordash" ? "doordash_pay" : channel === "ubereats" ? "ubereats_pay" : "grubhub_pay")
                  : (chance(0.75) ? "card_credit"
                     : chance(0.5) ? "card_debit"
                     : chance(0.5) ? "cash"
                     : "gift_card");
              const cardBrand = tenderType === "card_credit" || tenderType === "card_debit"
                ? pick(["visa", "mc", "amex", "discover"]) : null;
              const cardLast4 = cardBrand ? randint(1000, 9999).toString() : null;
              const processorFee = tenderType.startsWith("card") ? money(amt * 0.029 + 0.30)
                : tenderType === "doordash_pay" ? money(amt * 0.30)
                : tenderType === "ubereats_pay" ? money(amt * 0.30)
                : tenderType === "grubhub_pay" ? money(amt * 0.30)
                : 0;
              const tipShare = splits.length > 1 ? money(tipAmt / splits.length) : tipAmt;
              await sql`
                INSERT INTO tenders (id, ticket_id, outlet_id, tender_type, amount, tip_amount, card_brand, card_last4, processor_fee, captured_at)
                VALUES (${`tnd-${ticketCounter.toString().padStart(7, "0")}-${s}`}, ${ticketId}, ${outlet.id},
                        ${tenderType}, ${amt}, ${s === 0 ? tipShare : 0}, ${cardBrand}, ${cardLast4},
                        ${processorFee}, ${closed!.toISOString()})
              `;
              const t = tenderTotals.get(tenderType) ?? { amount: 0, tip: 0, fee: 0 };
              t.amount += amt;
              t.tip += s === 0 ? tipShare : 0;
              t.fee += processorFee;
              tenderTotals.set(tenderType, t);
            }
            dailyTax += taxAmt;
            dailyDiscount += discountAmt;
          }
          dailyComp += compAmt;
          dailyVoid += voidAmt;
        }
      }

      // ── waste at end of day (~1.5% of food cost)
      const wasteIngredients = ["ING-tomato", "ING-basil", "ING-romaine", "ING-fruit", "ING-bread", "ING-vegetables"];
      for (const ingSku of wasteIngredients) {
        if (chance(0.6)) {
          const ing = INGREDIENTS.find((x) => x.sku === ingSku)!;
          const wasteQty = money(rand(40, 220));
          await sql`
            INSERT INTO stock_movements (outlet_id, ingredient_id, movement_type, qty, unit_cost, occurred_at, reference, notes)
            VALUES (${outlet.id}, ${ingIdBySku.get(ingSku)!}, 'waste', ${wasteQty}, ${ing.unitCost},
                    ${new Date(bd.getTime() + 23 * 3_600_000).toISOString()}, ${`waste-${bd.toISOString().slice(0,10)}`},
                    'end-of-day count adjustment')
          `;
        }
      }

      // ── Weekly purchase orders (Mondays of the seed window)
      if (dow === 1) {
        for (const supplier of SUPPLIERS) {
          poCounter += 1;
          const poId = `po-${outlet.id}-${poCounter.toString().padStart(5, "0")}`;
          const orderedAt = new Date(bd);
          orderedAt.setUTCHours(8, randint(0, 59), 0, 0);
          const deliveredAt = new Date(orderedAt.getTime() + 24 * 3_600_000);
          const lines = INGREDIENTS.filter((i) => i.supplier === supplier.name).slice(0, 8);
          let total = 0;
          await sql`
            INSERT INTO purchase_orders (id, outlet_id, supplier_id, ordered_at, delivered_at, status, total_cost, invoice_number)
            VALUES (${poId}, ${outlet.id}, ${supplierIdByName.get(supplier.name)!},
                    ${orderedAt.toISOString()}, ${deliveredAt.toISOString()}, 'received', 0,
                    ${`INV-${poCounter.toString().padStart(6, "0")}`})
          `;
          for (const ing of lines) {
            const qty = money(rand(800, 6000));
            const lineTotal = money(qty * ing.unitCost);
            total += lineTotal;
            await sql`
              INSERT INTO purchase_order_lines (purchase_order_id, ingredient_id, qty, unit_cost, line_total)
              VALUES (${poId}, ${ingIdBySku.get(ing.sku)!}, ${qty}, ${ing.unitCost}, ${lineTotal})
            `;
            await sql`
              INSERT INTO stock_movements (outlet_id, ingredient_id, movement_type, qty, unit_cost, occurred_at, reference)
              VALUES (${outlet.id}, ${ingIdBySku.get(ing.sku)!}, 'receive', ${qty}, ${ing.unitCost},
                      ${deliveredAt.toISOString()}, ${poId})
            `;
          }
          await sql`UPDATE purchase_orders SET total_cost = ${money(total)} WHERE id = ${poId}`;
        }
      }

      // ── Daily GL postings (double-entry per outlet per day)
      const postedAt = new Date(bd);
      postedAt.setUTCHours(23, 59, 0, 0);
      const memoTag = `Daily close ${bd.toISOString().slice(0, 10)} — ${outlet.id}`;
      const ref = `close-${outlet.id}-${bd.toISOString().slice(0, 10)}`;

      // Revenue side
      const postRev = async (code: string, amt: number) => {
        if (amt <= 0) return;
        await sql`
          INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
          VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, ${code}, 0, ${money(amt)}, ${ref}, ${memoTag}, ${postedAt.toISOString()})
        `;
      };
      const postAsset = async (code: string, amt: number, isDebit: boolean) => {
        if (amt <= 0) return;
        await sql`
          INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
          VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, ${code},
                  ${isDebit ? money(amt) : 0}, ${isDebit ? 0 : money(amt)}, ${ref}, ${memoTag}, ${postedAt.toISOString()})
        `;
      };
      const postExpenseCogs = async (code: string, amt: number) => {
        if (amt <= 0) return;
        await sql`
          INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
          VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, ${code}, ${money(amt)}, 0, ${ref}, ${memoTag}, ${postedAt.toISOString()})
        `;
      };

      await postRev("4010", dailyFoodSales);
      await postRev("4020", dailyAlcoholSales);
      await postRev("4030", dailyNaSales);
      // Contras for non-voided tickets balance natively: gross sales credit
      // (4010-4030) is offset by the lower DR on cash/CC/3PD (which is net of
      // comp + discount) PLUS the explicit comp/discount DR.
      if (dailyComp > 0) await postExpenseCogs("4900", dailyComp);
      if (dailyDiscount > 0) await postExpenseCogs("4920", dailyDiscount);
      // Voids never recognize revenue — no sales credit was posted — so the
      // void contra DR needs its own CR offset on 4990 to self-balance.
      if (dailyVoid > 0) {
        await postExpenseCogs("4910", dailyVoid);
        await postRev("4990", dailyVoid);
      }

      // Tenders → cash, CC receivable, 3PD receivable.
      // tenders.amount already includes tax + tip (it's the split's portion of
      // total_amount). Do NOT add tip again — it's already inside amount.
      let cashIn = 0;
      let ccIn = 0;
      let _3pdIn = 0;
      let processorFees = 0;
      for (const [type, totals] of tenderTotals.entries()) {
        if (type === "cash") cashIn += totals.amount;
        else if (type.startsWith("card")) ccIn += totals.amount;
        else if (type.endsWith("_pay")) _3pdIn += totals.amount;
        else cashIn += totals.amount;
        processorFees += totals.fee;
      }
      await postAsset("1010", cashIn, true);
      await postAsset("1030", ccIn, true);
      await postAsset("1040", _3pdIn, true);

      // Tax payable
      await sql`
        INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
        VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, '2100', 0, ${money(dailyTax)}, ${ref}, ${memoTag}, ${postedAt.toISOString()})
      `;
      // Tips payable
      let allTips = 0;
      for (const totals of tenderTotals.values()) allTips += totals.tip;
      if (allTips > 0) {
        await sql`
          INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
          VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, '2200', 0, ${money(allTips)}, ${ref}, ${memoTag}, ${postedAt.toISOString()})
        `;
      }

      // COGS
      await postExpenseCogs("5010", dailyFoodCogs);
      await postExpenseCogs("5020", dailyAlcoholCogs);
      await postExpenseCogs("5030", dailyNaCogs);
      // Inventory credit equal to COGS draw
      await postAsset("1200", dailyFoodCogs + dailyNaCogs, false);
      await postAsset("1210", dailyAlcoholCogs, false);

      // Labor (split FOH/BOH/Mgmt by role mix) — DR expense, CR payroll payable
      const laborFoh = dailyLaborCost * 0.4;
      const laborBoh = dailyLaborCost * 0.45;
      const laborMgmt = dailyLaborCost * 0.15;
      await postExpenseCogs("6010", laborFoh);
      await postExpenseCogs("6020", laborBoh);
      await postExpenseCogs("6030", laborMgmt);
      if (dailyLaborCost > 0) {
        await sql`
          INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
          VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, '2300', 0, ${money(dailyLaborCost)},
                  ${ref}, ${memoTag}, ${postedAt.toISOString()})
        `;
      }

      // Processor fees — DR expense, CR CC Receivable (fees deducted before deposit)
      await postExpenseCogs("6100", processorFees);
      if (processorFees > 0) {
        await sql`
          INSERT INTO gl_entries (outlet_id, business_day, account_code, debit, credit, reference, memo, posted_at)
          VALUES (${outlet.id}, ${bd.toISOString().slice(0, 10)}, '1030', 0, ${money(processorFees)},
                  ${ref}, ${memoTag}, ${postedAt.toISOString()})
        `;
      }
    }
  }

  // Final counts
  const counts = await sql<{ table_name: string; n: string }[]>`
    SELECT 'outlets'         AS table_name, COUNT(*)::text AS n FROM outlets
    UNION ALL SELECT 'menu_items',          COUNT(*)::text FROM menu_items
    UNION ALL SELECT 'ingredients',         COUNT(*)::text FROM ingredients
    UNION ALL SELECT 'employees',           COUNT(*)::text FROM employees
    UNION ALL SELECT 'shifts',              COUNT(*)::text FROM shifts
    UNION ALL SELECT 'time_entries',        COUNT(*)::text FROM time_entries
    UNION ALL SELECT 'purchase_orders',     COUNT(*)::text FROM purchase_orders
    UNION ALL SELECT 'stock_movements',     COUNT(*)::text FROM stock_movements
    UNION ALL SELECT 'tickets',             COUNT(*)::text FROM tickets
    UNION ALL SELECT 'ticket_items',        COUNT(*)::text FROM ticket_items
    UNION ALL SELECT 'tenders',             COUNT(*)::text FROM tenders
    UNION ALL SELECT 'gl_entries',          COUNT(*)::text FROM gl_entries
  `;
  console.log("\n── final counts ──");
  for (const r of counts) console.log(`  ${r.table_name.padEnd(20)} ${r.n}`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
