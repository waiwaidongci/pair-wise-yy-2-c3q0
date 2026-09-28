// 运输笼周转判定层：只负责状态机与规则，不读写档案。
//
// 笼位生命周期（状态由台账流水与当前占用推导，不另行落库）：
//   available 可用（空笼、可装鸽）
//     └─ 装入第一只 → in_use 使用中（同笼可继续装入，押运人以首装登记为准）
//          ├─ 换笼（目标笼必须 available；源笼清空后自动落到 pending_disinfection）
//          └─ 卸出最后一只 → pending_disinfection 待消毒
//               └─ 登记消毒
//                    ├─ 药液接触 < 10 分钟，或操作人 == 押运人 → stopped 继续停用
//                    └─ 合格 → pending_review 待次日复核
//                         ├─ 复核日晚于消毒日且合格 → available（次日才可再装鸽）
//                         └─ 复核不合格 → stopped 继续停用

export const STATUS = {
  AVAILABLE: "available",
  IN_USE: "in_use",
  PENDING_DISINFECTION: "pending_disinfection",
  PENDING_REVIEW: "pending_review",
  STOPPED: "stopped",
};

export const STATUS_TEXT = {
  available: "可用",
  in_use: "使用中",
  pending_disinfection: "待消毒",
  pending_review: "待复核",
  stopped: "停用中",
};

export const MIN_CONTACT_MS = 10 * 60 * 1000; // 药液接触不足十分钟即判停用

// 统一成本地 YYYY-MM-DD，兼容带时区 ISO 串与 datetime-local 值。
export function localDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function slotCount(slots) {
  return slots ? Object.keys(slots).length : 0;
}

// 笼位当前结论状态：消毒/复核事件决定停用与复核态；
// 装卸流水期间，有鸽即使用中，空笼即待消毒。
export function currentStatus(cage) {
  for (let i = cage.events.length - 1; i >= 0; i--) {
    const event = cage.events[i];
    if (event.type === "review") return event.result === "pass" ? STATUS.AVAILABLE : STATUS.STOPPED;
    if (event.type === "disinfect") return event.passed ? STATUS.PENDING_REVIEW : STATUS.STOPPED;
    if (event.type === "load" || event.type === "unload" || event.type === "move_out" || event.type === "move_in") {
      return slotCount(cage.slots) > 0 ? STATUS.IN_USE : STATUS.PENDING_DISINFECTION;
    }
  }
  return STATUS.AVAILABLE;
}

// 装鸽判定：空可用笼可首装（须登记押运人）；使用中笼可续装（目标必须是同一只当前笼）。
export function canLoad(cage) {
  const status = currentStatus(cage);
  return status === STATUS.AVAILABLE || status === STATUS.IN_USE;
}

// 当前使用周期登记的押运人：取最近一次复核之后的首装押运人，
// 复核通过即视为上一运输周期结束（含换入空笼时随鸽延续的押运人）。
export function currentEscort(cage) {
  let cycleStart = 0;
  for (let i = 0; i < cage.events.length; i++) {
    if (cage.events[i].type === "review") cycleStart = i + 1;
  }
  for (let i = cycleStart; i < cage.events.length; i++) {
    const event = cage.events[i];
    if ((event.type === "load" || event.type === "move_in") && event.escort) return event.escort;
  }
  return "";
}

// 消毒是否合格：接触时长满十分钟，且消毒操作人与押运人不是同一人。
export function disinfectVerdict({ startedAt, endedAt, operator, escort }) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { passed: false, reason: "bad_time", message: "起止时刻不完整或无法识别" };
  }
  if (end.getTime() <= start.getTime()) {
    return { passed: false, reason: "bad_time", message: "结束时刻必须晚于开始时刻" };
  }
  if (end.getTime() - start.getTime() < MIN_CONTACT_MS) {
    return { passed: false, reason: "contact_too_short", message: "药液接触不足十分钟，笼位继续停用" };
  }
  if (!operator || !operator.trim()) {
    return { passed: false, reason: "operator_required", message: "必须登记消毒操作人" };
  }
  if (escort && operator.trim() === escort.trim()) {
    return { passed: false, reason: "same_as_escort", message: "消毒操作人与押运人相同，笼位继续停用" };
  }
  return { passed: true };
}

// 次日复核判定：复核日期必须严格晚于消毒当天。
export function reviewCheck(cage, reviewDate) {
  const disinfect = [...cage.events].reverse().find(e => e.type === "disinfect" && e.passed);
  if (!disinfect) return { ok: false, reason: "no_disinfection", message: "该笼没有合格消毒记录，不能复核" };
  const day = localDate(reviewDate);
  if (!day) return { ok: false, reason: "date_required", message: "必须填写复核日期" };
  if (day <= localDate(disinfect.endedAt)) {
    return { ok: false, reason: "not_next_day", message: "须次日复核合格后才可再装鸽（当日复核无效）" };
  }
  return { ok: true, disinfect };
}
