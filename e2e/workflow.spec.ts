import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

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
  await expect(page.getByText("297.0 × 210.0 mm")).toBeVisible();
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
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "新規" }).click();
  await expect(page.locator(".text-object")).toHaveCount(0);
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await page
    .getByRole("button", { name: "ブラウザの保存データを開く" })
    .click();
  await expect(page.locator(".text-object")).toHaveCount(before);
  await page.getByRole("button", { name: "用紙設定" }).click();
  await expect(page.getByText("template.pdf")).toBeVisible();
});
