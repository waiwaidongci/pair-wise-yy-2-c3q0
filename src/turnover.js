// 周转判定：笼位状态机与消毒/复核规则，纯函数，不碰存储与页面。

export const CAGE_STATUS = {
  AVAILABLE: "available", // 可用
  IN_USE: "in_use", // 使用中（笼内有鸽）
  PENDING_DISINFECTION: "pending_disinfection", // 待消毒
  PENDING_REVIEW: "pending_review", // 待复核
  DISABLED: "disabled" // 停用
};

export const MIN_CONTACT_MINUTES = 10;

export function minutesBetween(startAt, endAt) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return (end - start) / 60000;
}

// 消毒登记判定：接触不足十分钟，或操作人与押运人相同，即不合格（笼位继续停用）。
export function evaluateDisinfection({ startAt, endAt, operator, escort }) {
  const reasons = [];
  const minutes = minutesBetween(startAt, endAt);
  if (minutes === null || minutes < MIN_CONTACT_MINUTES) reasons.push("contact_too_short");
  if (operator && escort && operator === escort) reasons.push("operator_equals_escort");
  return { ok: reasons.length === 0, minutes, reasons };
}

// 只有可用笼位才能装鸽。
export function canLoad(cage) {
  return cage.status === CAGE_STATUS.AVAILABLE;
}

// 每只足环同一时间只能待在一个笼位。
export function ringConflict(cages, ringNo, exceptCageId = null) {
  return cages.find(cage => cage.id !== exceptCageId && cage.occupant === ringNo) || null;
}

// 复核必须发生在消毒结束次日或之后。
export function canReview(cage, reviewDate) {
  if (cage.status !== CAGE_STATUS.PENDING_REVIEW || !cage.disinfection) {
    return { ok: false, reason: "not_pending_review" };
  }
  const disinfectedDay = String(cage.disinfection.endAt).slice(0, 10);
  if (!(reviewDate > disinfectedDay)) return { ok: false, reason: "review_too_early" };
  return { ok: true };
}
