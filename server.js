import http from "node:http";
import { loadDb, saveDb, findCage, createCage, appendCageEvent, appendPigeonEvent, nowIso } from "./src/store.js";
import { CAGE_STATUS, canLoad, ringConflict, evaluateDisinfection, canReview } from "./src/turnover.js";
import { page } from "./src/page.js";

const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }

    // ---- 鸽只档案 ----
    if (req.method === "GET" && url.pathname === "/api/pigeons") return sendJson(res, 200, db.pigeons);
    if (req.method === "POST" && url.pathname === "/api/pigeons") {
      const input = await body(req);
      if (db.pigeons.some(item => item.ringNo === input.ringNo)) return sendJson(res, 409, { error: "ring_exists" });
      const pigeon = { ...input, vaccines: [], transfers: [], races: [], cageHistory: [] };
      db.pigeons.unshift(pigeon);
      await saveDb(db);
      return sendJson(res, 201, pigeon);
    }

    // ---- 每鸽履历 ----
    const historyMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/history$/);
    if (historyMatch && req.method === "GET") {
      const ringNo = decodeURIComponent(historyMatch[1]);
      const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
      if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
      const current = db.cages.find(cage => cage.occupant === ringNo);
      return sendJson(res, 200, {
        pigeon: { ringNo: pigeon.ringNo, owner: pigeon.owner },
        currentCage: current ? current.id : null,
        events: pigeon.cageHistory || []
      });
    }

    const relationMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && req.method === "GET") {
      const data = relation(db, decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
    }
    const actionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && req.method === "POST") {
      const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(actionMatch[1]));
      if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
      const input = await body(req);
      if (actionMatch[2] === "transfers") {
        const transfer = { date: input.date || new Date().toISOString().slice(0, 10), from: pigeon.owner, to: input.to };
        pigeon.owner = input.to;
        pigeon.transfers.push(transfer);
      }
      if (actionMatch[2] === "races") pigeon.races.push({ date: input.date || new Date().toISOString().slice(0, 10), event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
      if (actionMatch[2] === "vaccines") pigeon.vaccines.push({ date: input.date || new Date().toISOString().slice(0, 10), name: input.name });
      await saveDb(db);
      return sendJson(res, 200, pigeon);
    }

    // ---- 运输笼周转 ----
    const cageMatch = url.pathname.match(/^\/api\/cages(?:\/([^/]+)(?:\/(load|unload|move|disinfection|review))?)?$/);
    if (cageMatch) {
      const cageId = cageMatch[1] && decodeURIComponent(cageMatch[1]);
      const action = cageMatch[2];

      if (!cageId && req.method === "GET") return sendJson(res, 200, db.cages);
      if (!cageId && req.method === "POST") {
        const input = await body(req);
        const id = String(input.id || "").trim();
        if (!id) return sendJson(res, 400, { error: "id_required" });
        if (findCage(db, id)) return sendJson(res, 409, { error: "cage_exists" });
        const cage = createCage(db, id);
        await saveDb(db);
        return sendJson(res, 201, cage);
      }

      const cage = findCage(db, cageId);
      if (!cage) return sendJson(res, 404, { error: "cage_not_found" });
      if (req.method !== "POST" || !action) return sendJson(res, 404, { error: "not_found" });
      const input = await body(req);

      // 装鸽：笼位必须可用；同一足环不得同时在别的笼位。
      if (action === "load") {
        if (!canLoad(cage)) return sendJson(res, 409, { error: "cage_not_available" });
        const pigeon = db.pigeons.find(item => item.ringNo === input.ringNo);
        if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
        const conflict = ringConflict(db.cages, input.ringNo);
        if (conflict) return sendJson(res, 409, { error: "ring_already_in_cage", cageId: conflict.id });
        const operator = input.operator || "";
        cage.status = CAGE_STATUS.IN_USE;
        cage.occupant = input.ringNo;
        appendCageEvent(cage, { action: "load", ringNo: input.ringNo, operator });
        appendPigeonEvent(pigeon, { action: "load", cageId: cage.id, operator });
        await saveDb(db);
        return sendJson(res, 200, cage);
      }

      // 卸鸽：笼位进入待消毒。
      if (action === "unload") {
        if (cage.status !== CAGE_STATUS.IN_USE) return sendJson(res, 409, { error: "cage_not_in_use" });
        const ringNo = cage.occupant;
        const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
        const operator = input.operator || "";
        cage.occupant = null;
        cage.status = CAGE_STATUS.PENDING_DISINFECTION;
        appendCageEvent(cage, { action: "unload", ringNo, operator });
        if (pigeon) appendPigeonEvent(pigeon, { action: "unload", cageId: cage.id, operator });
        await saveDb(db);
        return sendJson(res, 200, cage);
      }

      // 换笼：记录时间和经办人；原笼进入待消毒，新笼须可用。
      if (action === "move") {
        if (cage.status !== CAGE_STATUS.IN_USE) return sendJson(res, 409, { error: "cage_not_in_use" });
        const target = findCage(db, input.toCageId);
        if (!target) return sendJson(res, 404, { error: "target_cage_not_found" });
        if (!canLoad(target)) return sendJson(res, 409, { error: "target_cage_not_available" });
        const ringNo = cage.occupant;
        const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
        const operator = input.operator || "";
        cage.occupant = null;
        cage.status = CAGE_STATUS.PENDING_DISINFECTION;
        appendCageEvent(cage, { action: "move_out", ringNo, toCageId: target.id, operator });
        target.occupant = ringNo;
        target.status = CAGE_STATUS.IN_USE;
        appendCageEvent(target, { action: "move_in", ringNo, fromCageId: cage.id, operator });
        if (pigeon) appendPigeonEvent(pigeon, { action: "move", fromCageId: cage.id, toCageId: target.id, operator });
        await saveDb(db);
        return sendJson(res, 200, { from: cage, to: target });
      }

      // 消毒登记：批号、起止时刻、操作人、押运人；判定不合格则继续停用。
      if (action === "disinfection") {
        if (![CAGE_STATUS.PENDING_DISINFECTION, CAGE_STATUS.DISABLED].includes(cage.status)) {
          return sendJson(res, 409, { error: "cage_not_awaiting_disinfection" });
        }
        if (!input.batchNo) return sendJson(res, 400, { error: "batch_no_required" });
        const result = evaluateDisinfection(input);
        cage.disinfection = {
          batchNo: input.batchNo,
          startAt: input.startAt,
          endAt: input.endAt,
          operator: input.operator || "",
          escort: input.escort || "",
          minutes: result.minutes,
          ok: result.ok,
          reasons: result.reasons
        };
        cage.status = result.ok ? CAGE_STATUS.PENDING_REVIEW : CAGE_STATUS.DISABLED;
        cage.lastFail = result.ok ? [] : result.reasons;
        appendCageEvent(cage, {
          action: "disinfection",
          batchNo: input.batchNo,
          startAt: input.startAt,
          endAt: input.endAt,
          operator: cage.disinfection.operator,
          escort: cage.disinfection.escort,
          minutes: result.minutes,
          ok: result.ok,
          reasons: result.reasons
        });
        await saveDb(db);
        return sendJson(res, 200, cage);
      }

      // 次日复核：合格才能重新可用，不合格继续停用。
      if (action === "review") {
        const date = input.date || nowIso().slice(0, 10);
        const check = canReview(cage, date);
        if (!check.ok) return sendJson(res, 409, { error: check.reason });
        const pass = input.result === "pass";
        appendCageEvent(cage, { action: "review", date, reviewer: input.reviewer || "", result: pass ? "pass" : "fail" });
        cage.status = pass ? CAGE_STATUS.AVAILABLE : CAGE_STATUS.DISABLED;
        cage.lastFail = pass ? [] : ["review_failed"];
        cage.disinfection = null;
        cage.review = null;
        await saveDb(db);
        return sendJson(res, 200, cage);
      }
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
