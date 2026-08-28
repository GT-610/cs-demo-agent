import { describe, expect, test } from "bun:test";
import { detectLocale, translate } from "./index";

describe("localization", () => {
  test("detects Chinese variants and otherwise falls back to English", () => {
    expect(detectLocale(["zh-Hant-TW", "en-US"])).toBe("zh-CN");
    expect(detectLocale(["en-GB", "fr-FR"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  test("returns English and Simplified Chinese resources", () => {
    expect(translate("en", "action.analyze")).toBe("Analyze");
    expect(translate("zh-CN", "action.analyze")).toBe("开始分析");
  });

  test("interpolates status values", () => {
    expect(
      translate("en", "status.modelPass", { iteration: 3 }),
    ).toBe("Model pass 3…");
    expect(
      translate("zh-CN", "evidence.rows", { count: 24 }),
    ).toBe("24 行");
  });
});
