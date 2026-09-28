// 血统档案写入（原登记站功能）：与笼位周转共用 data/pigeons.json。
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

async function openDb() {
  if (!existsSync(dbPath)) return { pigeons: [], cages: [] };
  return JSON.parse(await readFile(dbPath, "utf8"));
}

export async function getRelation(ringNo) {
  const db = await openDb();
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

export async function appendPigeon(pigeon) {
  const db = await openDb();
  db.pigeons.unshift(pigeon);
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export async function appendPigeonEvent(ringNo, kind, input) {
  const db = await openDb();
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (kind === "transfers") {
    pigeon.transfers.push({ date, from: pigeon.owner, to: input.to });
    pigeon.owner = input.to;
  }
  if (kind === "races") {
    pigeon.races.push({ date, event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
  }
  if (kind === "vaccines") pigeon.vaccines.push({ date, name: input.name });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
  return pigeon;
}
