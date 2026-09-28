import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./src/store.js";
import { listPigeons } from "./src/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// store 抛出的业务冲突统一转 400，规则原因码原样带给页面。
async function runMutation(res, fn) {
  try {
    sendJson(res, 200, await fn());
  } catch (error) {
    if (error instanceof store.StoreError) return sendJson(res, 400, { error: error.reason, message: error.message });
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      const page = await readFile(join(__dirname, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }

    // ---- 运输笼周转台 ----------------------------------------------------
    if (req.method === "GET" && url.pathname === "/api/cages/overview") {
      return sendJson(res, 200, await store.overview());
    }
    if (req.method === "GET" && url.pathname === "/api/cages") {
      return sendJson(res, 200, await store.listCages());
    }
    const cageAction = url.pathname.match(/^\/api\/cages\/([^/]+)\/(load|disinfect|review)$/);
    if (cageAction && req.method === "POST") {
      const input = await body(req);
      const cageId = decodeURIComponent(cageAction[1]);
      if (cageAction[2] === "load") {
        return runMutation(res, () => store.loadPigeon({ cageId, ...input }));
      }
      if (cageAction[2] === "disinfect") {
        return runMutation(res, () => store.disinfectCage({ cageId, ...input }));
      }
      if (cageAction[2] === "review") {
        return runMutation(res, () => store.reviewCage({ cageId, ...input }));
      }
    }
    if (req.method === "POST" && url.pathname === "/api/moves") {
      const input = await body(req);
      return runMutation(res, () => store.movePigeon(input));
    }
    const unloadMatch = url.pathname.match(/^\/api\/cages\/([^/]+)\/slots\/([^/]+)\/unload$/);
    if (unloadMatch && req.method === "POST") {
      const input = await body(req);
      const cageId = decodeURIComponent(unloadMatch[1]);
      const slot = decodeURIComponent(unloadMatch[2]);
      return runMutation(res, () => store.unloadPigeon({ cageId, slot, ...input }));
    }
    const historyMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/history$/);
    if (historyMatch && req.method === "GET") {
      const data = await store.pigeonHistory(decodeURIComponent(historyMatch[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
    }

    // ---- 原有血统档案功能 ------------------------------------------------
    if (req.method === "GET" && url.pathname === "/api/pigeons") {
      return sendJson(res, 200, await listPigeons());
    }
    if (req.method === "POST" && url.pathname === "/api/pigeons") {
      const input = await body(req);
      const pigeons = await listPigeons();
      if (pigeons.some(item => item.ringNo === input.ringNo)) return sendJson(res, 409, { error: "ring_exists" });
      const pigeon = { ...input, vaccines: [], transfers: [], races: [] };
      const { appendPigeon } = await import("./src/pigeons.js");
      await appendPigeon(pigeon);
      return sendJson(res, 201, pigeon);
    }
    const relationMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && req.method === "GET") {
      const { getRelation } = await import("./src/pigeons.js");
      const data = await getRelation(decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
    }
    const actionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && req.method === "POST") {
      const input = await body(req);
      const { appendPigeonEvent } = await import("./src/pigeons.js");
      const pigeon = await appendPigeonEvent(decodeURIComponent(actionMatch[1]), actionMatch[2], input);
      return pigeon ? sendJson(res, 200, pigeon) : sendJson(res, 404, { error: "pigeon_not_found" });
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Pigeon cage turnaround app listening on http://localhost:${port}`));
