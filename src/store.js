// 笼位档案层：笼子档案、槽位占用与周转流水台账的持久化。
// 规则判定一律委托 turnover.js，本层只负责记账、查档与强制不变量：
//   1. 每只足环同一时刻只能待在一个笼位；
//   2. 每次换笼留下时间、经办人，以及源/目标笼位；
//   3. 笼子卸空即进入待消毒，未经“次日复核合格”不得再装鸽。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUS,
  currentStatus,
  currentEscort,
  disinfectVerdict,
  reviewCheck,
} from "./turnover.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

// 业务冲突：HTTP 层据此返回 400。
export class StoreError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

function seedCages() {
  // 每笼 4 个笼位，编号 1-4；预置两只有鸽笼、一只待消毒笼、一只可用笼。
  const make = id => ({ id, events: [], slots: {} });
  const cages = ["Y-01", "Y-02", "Y-03", "Y-04"].map(make);
  const at = (cageId, slot, ringNo, minutes, escort = "押运员周强") => {
    const cage = cages.find(c => c.id === cageId);
    cage.slots[slot] = ringNo;
    cage.events.push({
      id: `${cageId}-L${slot}`,
      type: "load",
      time: new Date(Date.now() - minutes * 60000).toISOString(),
      slot,
      ringNo,
      escort,
      operator: "登记员李敏",
    });
  };
  at("Y-01", "1", "CHN-2026-001", 95);
  at("Y-01", "2", "CHN-2022-188", 90);
  at("Y-02", "1", "CHN-2023-512", 80);
  // Y-03：上一趟已卸空，处于待消毒（演示“擦一遍就继续装”被系统拦住）。
  cages.find(c => c.id === "Y-03").events.push(
    { id: "Y-03-L1", type: "load", time: new Date(Date.now() - 300 * 60000).toISOString(), slot: "1", ringNo: "CHN-2026-001", escort: "押运员周强", operator: "登记员李敏" },
    { id: "Y-03-U1", type: "unload", time: new Date(Date.now() - 20 * 60000).toISOString(), slot: "1", ringNo: "CHN-2026-001", operator: "登记员李敏" },
  );
  return cages;
}

const seed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
  ],
  cages: seedCages(),
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return structuredClone(seed);
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!Array.isArray(db.cages)) db.cages = seedCages(); // 老数据平滑升级
  for (const cage of db.cages) {
    cage.events ||= [];
    cage.slots ||= {};
  }
  return db;
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

// ---- 查询 ----------------------------------------------------------------

export async function listPigeons() {
  const db = await loadDb();
  return db.pigeons;
}

export async function listCages() {
  const db = await loadDb();
  return db.cages.map(cage => view(db, cage));
}

// 找一只足环当前所在笼位（跨笼扫描，保证“只待在当前一个笼位”）。
function locate(db, ringNo) {
  for (const cage of db.cages) {
    for (const [slot, occupant] of Object.entries(cage.slots)) {
      if (occupant === ringNo) return { cage, slot };
    }
  }
  return null;
}

function slotCapacity(cage) {
  return cage.slotCount || 4;
}

function view(db, cage) {
  const status = currentStatus(cage);
  return {
    id: cage.id,
    status,
    slots: Object.entries(cage.slots).map(([no, ringNo]) => ({ no, ringNo })),
    capacity: slotCapacity(cage),
    escort: currentEscort(cage),
    events: cage.events,
  };
}

// 页面汇总：待消毒笼、可用笼位、使用中/待复核/停用笼。
export async function overview() {
  const db = await loadDb();
  const cages = db.cages.map(cage => view(db, cage));
  const group = status => cages.filter(c => c.status === status);
  return {
    cages,
    pendingDisinfection: group(STATUS.PENDING_DISINFECTION).map(c => c.id),
    stopped: group(STATUS.STOPPED).map(c => c.id),
    pendingReview: group(STATUS.PENDING_REVIEW).map(c => c.id),
    availableSlots: cages
      .filter(c => c.status === STATUS.AVAILABLE)
      .map(c => ({ cageId: c.id, freeSlots: c.capacity - c.slots.length, capacity: c.capacity })),
  };
}

// 每鸽履历：当前笼位 + 与该足环有关的全部流水（装、换、卸、消毒、复核）。
export async function pigeonHistory(ringNo) {
  const db = await loadDb();
  const pigeon = db.pigeons.find(p => p.ringNo === ringNo);
  if (!pigeon) return null;
  const location = locate(db, ringNo);
  const timeline = db.cages
    .flatMap(cage => cage.events
      .filter(e => e.ringNo === ringNo)
      .map(e => ({ ...e, cageId: cage.id })))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  return { pigeon, current: location ? { cageId: location.cage.id, slot: location.slot } : null, timeline };
}

// ---- 变更：全部留痕 ------------------------------------------------------

async function mutate(fn) {
  const db = await loadDb();
  const result = fn(db);
  await saveDb(db);
  return result;
}

function requirePigeon(db, ringNo) {
  if (!db.pigeons.some(p => p.ringNo === ringNo)) {
    throw new StoreError("pigeon_not_found", `足环 ${ringNo} 未建立档案`);
  }
}

// 装鸽：笼位必须可用/使用中；每只足环同时只能占一个笼位；空笼首装登记押运人。
export async function loadPigeon({ cageId, slot, ringNo, operator, escort, time }) {
  return mutate(db => {
    const cage = db.cages.find(c => c.id === cageId);
    if (!cage) throw new StoreError("cage_not_found", `没有笼子 ${cageId}`);
    requirePigeon(db, ringNo);
    if (!operator?.trim()) throw new StoreError("operator_required", "必须登记经办人");
    const status = currentStatus(cage);
    if (status !== STATUS.AVAILABLE && status !== STATUS.IN_USE) {
      throw new StoreError("cage_not_loadable", `笼位状态为${status}，不可装鸽`);
    }
    const slotNo = String(slot);
    const validSlots = Array.from({ length: slotCapacity(cage) }, (_, i) => String(i + 1));
    if (!validSlots.includes(slotNo)) throw new StoreError("bad_slot", `笼位号应在 1-${slotCapacity(cage)} 之间`);
    if (cage.slots[slotNo]) throw new StoreError("slot_occupied", `${cageId} 笼位 ${slotNo} 已被 ${cage.slots[slotNo]} 占用`);
    const occupied = locate(db, ringNo);
    if (occupied) {
      throw new StoreError("pigeon_already_caged", `该足环已在 ${occupied.cage.id} 笼位 ${occupied.slot}，请走“换笼”`);
    }
    let cycleEscort = currentEscort(cage);
    if (Object.keys(cage.slots).length === 0) {
      if (!escort?.trim()) throw new StoreError("escort_required", "空笼首装必须登记押运人");
      cycleEscort = escort.trim();
    }
    const event = {
      id: `${cageId}-${Date.now()}`,
      type: "load",
      time: time ? new Date(time).toISOString() : nowIso(),
      slot: slotNo,
      ringNo,
      escort: cycleEscort,
      operator: operator.trim(),
    };    cage.slots[slotNo] = ringNo;
    cage.events.push(event);
    return view(db, cage);
  });
}

// 换笼：留下时间、经办人及源/目标笼位；源笼清空后自动待消毒。
export async function movePigeon({ ringNo, toCageId, toSlot, operator, time }) {
  return mutate(db => {
    requirePigeon(db, ringNo);
    if (!operator?.trim()) throw new StoreError("operator_required", "必须登记经办人");
    const from = locate(db, ringNo);
    if (!from) throw new StoreError("pigeon_not_caged", "该足环当前不在任何笼位中，不能换笼");
    const target = db.cages.find(c => c.id === toCageId);
    if (!target) throw new StoreError("cage_not_found", `没有笼子 ${toCageId}`);
    if (target.id === from.cage.id) throw new StoreError("same_cage", "换笼目标不能与源笼相同");
    const targetStatus = currentStatus(target);
    if (targetStatus !== STATUS.AVAILABLE && targetStatus !== STATUS.IN_USE) {
      throw new StoreError("cage_not_loadable", `目标笼状态为${targetStatus}，不可装入`);
    }
    const slotNo = String(toSlot);
    const validSlots = Array.from({ length: slotCapacity(target) }, (_, i) => String(i + 1));
    if (!validSlots.includes(slotNo)) throw new StoreError("bad_slot", `笼位号应在 1-${slotCapacity(target)} 之间`);
    if (target.slots[slotNo]) throw new StoreError("slot_occupied", `${toCageId} 笼位 ${slotNo} 已被占用`);
    const ts = time ? new Date(time).toISOString() : nowIso();
    const moveId = `move-${Date.now()}`;
    // 换入空笼即该笼本趟首装，押运人沿用源笼本趟登记，供消毒同人比对。
    const carriedEscort = Object.keys(target.slots).length === 0 ? currentEscort(from.cage) : "";
    from.cage.events.push({
      id: `${moveId}-out`, type: "move_out", time: ts,
      slot: from.slot, ringNo, toCageId: target.id, toSlot: slotNo, operator: operator.trim(),
    });
    delete from.cage.slots[from.slot];
    target.slots[slotNo] = ringNo;
    target.events.push({
      id: `${moveId}-in`, type: "move_in", time: ts,
      slot: slotNo, ringNo, fromCageId: from.cage.id, fromSlot: from.slot,
      escort: carriedEscort, operator: operator.trim(),
    });
    return { from: view(db, from.cage), to: view(db, target) };
  });
}

// 卸鸽：笼位释放；卸出最后一只后笼子自动进入待消毒。
export async function unloadPigeon({ cageId, slot, operator, time }) {
  return mutate(db => {
    const cage = db.cages.find(c => c.id === cageId);
    if (!cage) throw new StoreError("cage_not_found", `没有笼子 ${cageId}`);
    if (!operator?.trim()) throw new StoreError("operator_required", "必须登记经办人");
    const slotNo = String(slot);
    const ringNo = cage.slots[slotNo];
    if (!ringNo) throw new StoreError("slot_empty", `${cageId} 笼位 ${slotNo} 没有鸽`);
    const ts = time ? new Date(time).toISOString() : nowIso();
    delete cage.slots[slotNo];
    cage.events.push({
      id: `${cageId}-${Date.now()}`,
      type: "unload",
      time: ts,
      slot: slotNo,
      ringNo,
      operator: operator.trim(),
      emptied: Object.keys(cage.slots).length === 0,
    });
    return view(db, cage);
  });
}

// 登记消毒：药液批号、起止时刻、操作人；不足十分钟或与押运人同人则继续停用。
export async function disinfectCage({ cageId, batchNo, startedAt, endedAt, operator }) {
  return mutate(db => {
    const cage = db.cages.find(c => c.id === cageId);
    if (!cage) throw new StoreError("cage_not_found", `没有笼子 ${cageId}`);
    if (!batchNo?.trim()) throw new StoreError("batch_required", "必须登记药液批号");
    const status = currentStatus(cage);
    // 待消毒可首次登记；停用笼（消毒不达标/复核不合格）允许整改后重新消毒。
    if (status !== STATUS.PENDING_DISINFECTION && status !== STATUS.STOPPED) {
      throw new StoreError("not_pending_disinfection", "当前状态不能登记消毒");
    }
    if (Object.keys(cage.slots).length > 0) throw new StoreError("cage_occupied", "笼内仍有鸽，不能消毒");
    const escort = currentEscort(cage);
    const verdict = disinfectVerdict({ startedAt, endedAt, operator, escort });
    const event = {
      id: `${cageId}-D${Date.now()}`,
      type: "disinfect",
      time: nowIso(),
      batchNo: batchNo.trim(),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      operator: operator?.trim() || "",
      escort,
      passed: verdict.passed,
      failReason: verdict.passed ? "" : verdict.reason,
      message: verdict.passed ? "" : verdict.message,
    };
    cage.events.push(event);
    return { ...view(db, cage), verdict };
  });
}

// 次日复核：合格才可再装鸽，不合格继续停用。
export async function reviewCage({ cageId, date, result, reviewer, note }) {
  return mutate(db => {
    const cage = db.cages.find(c => c.id === cageId);
    if (!cage) throw new StoreError("cage_not_found", `没有笼子 ${cageId}`);
    const check = reviewCheck(cage, date);
    if (!check.ok) throw new StoreError(check.reason, check.message);
    if (!reviewer?.trim()) throw new StoreError("reviewer_required", "必须登记复核人");
    const outcome = result === "fail" ? "fail" : "pass";
    cage.events.push({
      id: `${cageId}-R${Date.now()}`,
      type: "review",
      time: nowIso(),
      date,
      result: outcome,
      reviewer: reviewer.trim(),
      note: note?.trim() || "",
      batchNo: check.disinfect.batchNo,
    });
    return view(db, cage);
  });
}
