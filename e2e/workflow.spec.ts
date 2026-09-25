import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";

test("sample layout, merge preview, paper settings and print PDF download", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("AwardPrint").first()).toBeVisible();
  await page.getByRole("button", { name: "プレビュー" }).click();
  await expect(page.locator(".paper")).toContainText("西条小学校");
  await expect(page.locator(".paper")).toContainText("山田太郎");
  await page.screenshot({
    path: "test-results/sample-layout.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "用紙設定" }).click();
  await expect(page.getByText("210.0 × 297.0 mm")).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "PDF出力" }).click();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "PDFを保存" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^AwardPrint_印刷用_\d{8}\.pdf$/,
  );
});

test("background import, undo, save and restore layout", async ({ page }) => {
  await page.goto("/");
  const document = await PDFDocument.create();
  document.addPage([600, 400]);
  const bytes = await document.save();
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles({
      name: "template.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    });
  await expect(page.getByRole("status")).toContainText("下絵は");
  await page.getByRole("button", { name: "用紙設定" }).click();
  await expect(page.getByText("template.pdf")).toBeVisible();
  await page.getByRole("button", { name: "PDFのサイズを用紙に設定" }).click();
  await page.getByRole("button", { name: "閉じる" }).click();
  const before = await page.locator(".text-object").count();
  await page.getByRole("button", { name: "＋ 固定文字" }).click();
  await expect(page.locator(".text-object")).toHaveCount(before + 1);
  await page.getByTitle("元に戻す Ctrl+Z").click();
  await expect(page.locator(".text-object")).toHaveCount(before);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "レイアウト保存" }).click();
  const jsonPath = await (await saved).path();
  const projectJson = JSON.parse(await readFile(jsonPath, "utf-8"));
  expect(projectJson.background.name).toBe("template.pdf");
  expect(projectJson.rows).toEqual([]);
  await page.getByRole("button", { name: "新規" }).click();
  await expect(page.locator(".text-object")).toHaveCount(0);
  await page.getByRole("button", { name: "レイアウトを開く" }).first().click();
  await page
    .locator('input[type=file][accept=".json,.awardprint,application/json"]')
    .setInputFiles(jsonPath);
  await expect(page.locator(".text-object")).toHaveCount(before);
  await page.getByRole("button", { name: "用紙設定" }).click();
  await expect(page.getByText("template.pdf")).toBeVisible();
});

test("lists every PC font and finds a Japanese font name", async ({ page }) => {
  await page.addInitScript(() => {
    const jpName = "游明朝";
    const textBytes = [...jpName].flatMap((char) => [
      char.charCodeAt(0) >> 8,
      char.charCodeAt(0) & 255,
    ]);
    const bytes = new Uint8Array(46 + textBytes.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x4f54544f);
    view.setUint16(4, 1);
    bytes.set([110, 97, 109, 101], 12);
    view.setUint32(20, 28);
    view.setUint32(24, 18 + textBytes.length);
    view.setUint16(30, 1);
    view.setUint16(32, 18);
    view.setUint16(34, 3);
    view.setUint16(36, 1);
    view.setUint16(38, 0x0411);
    view.setUint16(40, 4);
    view.setUint16(42, textBytes.length);
    bytes.set(textBytes, 46);
    Object.defineProperty(window, "queryLocalFonts", {
      value: async () =>
        Array.from({ length: 120 }, (_, i) => ({
          family: `MockFamily ${i}`,
          fullName: `MockFont ${i}`,
          postscriptName: `MockFont-${i}`,
          style: "Regular",
          blob: async () => new Blob([i === 0 ? bytes : new Uint8Array(0)]),
        })),
    });
  });
  await page.goto("/");
  await page.locator(".text-object").first().click();
  await page
    .getByRole("button", { name: "＋ PCにインストール済みのフォントから選ぶ" })
    .click();
  await expect(page.locator(".local-font-list button")).toHaveCount(120);
  await expect(page.getByText("游明朝", { exact: true })).toBeVisible();
  await page.getByPlaceholder("例: 游明朝、IPA、Noto").fill("游明朝");
  await expect(page.locator(".local-font-list button")).toHaveCount(1);
});

test("embeds a selected PC font in the print PDF", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      value: async () => [
        {
          family: "Local Sample",
          fullName: "Local Sample Regular",
          postscriptName: "LocalSample-Regular",
          style: "Regular",
          blob: async () =>
            (await fetch("/fonts/NotoSansCJKjp-Regular.otf")).blob(),
        },
      ],
    });
  });
  await page.goto("/");
  await page.locator(".text-object").first().click();
  await page
    .getByRole("button", { name: "＋ PCにインストール済みのフォントから選ぶ" })
    .click();
  await page.locator(".local-font-list button").first().click();
  await expect(page.getByRole("combobox", { name: "フォント" }).locator("option:checked")).toContainText("Local Sample Regular", { timeout: 20_000 });
  await page.getByRole("button", { name: "PDF出力" }).click();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "PDFを保存" }).click();
  const pdfBytes = await readFile(await (await download).path());
  expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);
});
