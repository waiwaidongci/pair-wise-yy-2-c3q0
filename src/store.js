// 笼位档案：数据加载、保存、笼位/鸽只履历追加。只负责档案，不做周转判定。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

export const nowIso = () => new Date().toISOString();

const seedPigeons = [
  { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
  { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
  { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
];

function blankCage(id) {
  return { id, status: "available", occupant: null, disinfection: null, review: null, lastFail: [], history: [] };
}

function seedCages() {
  const at = nowIso();
  const ready = id => ({ ...blankCage(id), history: [{ at, action: "create" }] });
  const cages = ["C-01", "C-02", "C-03", "C-04"].map(ready);
  cages.push({
    ...blankCage("C-05"),
    status: "in_use",
    occupant: "CHN-2026-001",
    history: [
      { at, action: "create" },
      { at, action: "load", ringNo: "CHN-2026-001", operator: "老周" }
    ]
  });
  cages.push({
    ...blankCage("C-06"),
    status: "pending_disinfection",
    history: [
      { at, action: "create" },
      { at, action: "unload", ringNo: "CHN-2026-001", operator: "老周" }
    ]
  });
  return cages;
}

const seed = () => ({ pigeons: seedPigeons, cages: seedCages() });

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed(), null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  let migrated = false;
  if (!Array.isArray(db.cages)) { db.cages = seedCages(); migrated = true; }
  for (const pigeon of db.pigeons) {
    if (!Array.isArray(pigeon.cageHistory)) { pigeon.cageHistory = []; migrated = true; }
  }
  if (migrated) await writeFile(dbPath, JSON.stringify(db, null, 2));
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function findCage(db, id) {
  return db.cages.find(cage => cage.id === id) || null;
}

export function createCage(db, id) {
  const cage = blankCage(id);
  appendCageEvent(cage, { action: "create" });
  db.cages.push(cage);
  return cage;
}

// 笼位档案：任何状态变化都留痕。
export function appendCageEvent(cage, event) {
  cage.history.push({ at: nowIso(), ...event });
}

// 每鸽履历：装鸽、卸鸽、换笼（时间与经办人）。
export function appendPigeonEvent(pigeon, event) {
  if (!Array.isArray(pigeon.cageHistory)) pigeon.cageHistory = [];
  pigeon.cageHistory.push({ at: nowIso(), ...event });
}
