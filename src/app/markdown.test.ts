import { expect, test } from "bun:test";
import { markdownUrlTransform } from "./markdown";

test("markdown URLs reject executable protocols", () => {
  expect(markdownUrlTransform("https://example.com/report")).toBe(
    "https://example.com/report",
  );
  expect(markdownUrlTransform("javascript:alert(1)")).toBe("");
});
