import { describe, expect, it } from "vitest";
import { addAggregateCents, addMoneyCents, ApiError, currentDayISO, formatMoney, isValidISODate, MAX_MONEY_CENTS, moneyToCents, parseMoneyCents, SERVICES } from "./domain";

describe("money and validation domain", () => {
  it("parses decimal currency without floating point drift", () => {
    expect(parseMoneyCents("12.34", "المبلغ")).toBe(1234);
    expect(parseMoneyCents(5, "المبلغ")).toBe(500);
    expect(parseMoneyCents("99999999.99", "المبلغ")).toBe(9_999_999_999);
    expect(formatMoney(999)).toBe("9.99");
    expect(moneyToCents("7.10")).toBe(710);
  });

  it.each(["-1", "1.999", "1,000", "NaN", "100000000"]) ("rejects malformed or unsafe money: %s", value => {
    expect(() => parseMoneyCents(value, "المبلغ")).toThrow(ApiError);
  });

  it("keeps accumulated invoice and shift money inside MySQL DECIMAL limits", () => {
    expect(addMoneyCents(MAX_MONEY_CENTS - 50, 50, "الإجمالي")).toBe(MAX_MONEY_CENTS);
    expect(() => addMoneyCents(MAX_MONEY_CENTS, 1, "الإجمالي")).toThrow(ApiError);
    expect(() => addMoneyCents(0, Number.MAX_SAFE_INTEGER + 1, "الإجمالي")).toThrow(ApiError);
  });

  it("allows multi-invoice reports above one DECIMAL while guarding integer precision", () => {
    expect(addAggregateCents(MAX_MONEY_CENTS, MAX_MONEY_CENTS, "التقرير")).toBe(MAX_MONEY_CENTS * 2);
    expect(() => addAggregateCents(Number.MAX_SAFE_INTEGER, 1, "التقرير")).toThrow(ApiError);
    expect(addAggregateCents(MAX_MONEY_CENTS, 1, "مبيعات النقد")).toBe(MAX_MONEY_CENTS + 1);
    expect(() => addMoneyCents(MAX_MONEY_CENTS, 1, "النقد المتوقع المخزن")).toThrow(ApiError);
  });

  it("validates real ISO calendar dates including leap years", () => {
    expect(isValidISODate("2024-02-29")).toBe(true);
    expect(isValidISODate("2025-02-29")).toBe(false);
    expect(isValidISODate("2025-13-01")).toBe(false);
    expect(isValidISODate("not-a-date")).toBe(false);
    expect(currentDayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps supported quick services explicit and price-controlled", () => {
    expect(SERVICES).toEqual([
      { name: "قياس ضغط الدم", price: "5.00", icon: "heart-pulse" },
      { name: "ضماد", price: "2.00", icon: "bandage" },
    ]);
  });
});
