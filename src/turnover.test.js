// 周转判定纯逻辑测试：node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS,
  MIN_CONTACT_MS,
  currentStatus,
  currentEscort,
  disinfectVerdict,
  reviewCheck,
} from "./turnover.js";

const t = (mins, mins2) => {
  const end = new Date(Date.now() - (mins2 ?? mins) * 60000).toISOString();
  const start = new Date(end).getTime() - mins * 60000;
  return { startedAt: new Date(start).toISOString(), endedAt: end };
};

const cage = events => ({ id: "X", slots: {}, events });

test("空笼首装后为使用中，押运人以首装登记为准", () => {
  const c = cage([{ type: "load", escort: "周强", ringNo: "R1", slot: "1" }]);
  c.slots = { 1: "R1" };
  assert.equal(currentStatus(c), STATUS.IN_USE);
  assert.equal(currentEscort(c), "周强");
});

test("卸出最后一只进入待消毒", () => {
  const c = cage([
    { type: "load", escort: "周强", ringNo: "R1", slot: "1" },
    { type: "unload", ringNo: "R1", slot: "1", emptied: true },
  ]);
  assert.equal(currentStatus(c), STATUS.PENDING_DISINFECTION);
});

test("接触不足十分钟判停用", () => {
  const v = disinfectVerdict({ ...t(9), operator: "吴九", escort: "周强" });
  assert.equal(v.passed, false);
  assert.equal(v.reason, "contact_too_short");
  assert.ok(MIN_CONTACT_MS === 10 * 60 * 1000);
});

test("操作人与押运人相同判停用，即使时长达标", () => {
  const v = disinfectVerdict({ ...t(15), operator: "周强", escort: "周强" });
  assert.equal(v.passed, false);
  assert.equal(v.reason, "same_as_escort");
});

test("满十分钟且操作人不同 → 待复核；当日复核被拒", () => {
  const times = t(12);
  const v = disinfectVerdict({ ...times, operator: "吴九", escort: "周强" });
  assert.equal(v.passed, true);
  const c = cage([{ type: "disinfect", passed: true, endedAt: times.endedAt, batchNo: "B1" }]);
  assert.equal(currentStatus(c), STATUS.PENDING_REVIEW);
  const sameDay = reviewCheck(c, times.endedAt.slice(0, 10));
  assert.equal(sameDay.ok, false);
  assert.equal(sameDay.reason, "not_next_day");
  const next = new Date(new Date(times.endedAt).getTime() + 86400000).toISOString().slice(0, 10);
  assert.equal(reviewCheck(c, next).ok, true);
});

test("复核不合格继续停用，合格恢复可用", () => {
  const c = cage([
    { type: "disinfect", passed: true, endedAt: new Date().toISOString() },
    { type: "review", result: "fail" },
  ]);
  assert.equal(currentStatus(c), STATUS.STOPPED);
  c.events.push({ type: "review", result: "pass" });
  assert.equal(currentStatus(c), STATUS.AVAILABLE);
});

test("消毒本身不合格直接停用，且不可复核", () => {
  const c = cage([{ type: "disinfect", passed: false, endedAt: new Date().toISOString() }]);
  assert.equal(currentStatus(c), STATUS.STOPPED);
  const next = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(reviewCheck(c, next).reason, "no_disinfection");
});
