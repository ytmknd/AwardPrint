# AwardPrint

[Open AwardPrint on GitHub Pages](https://ytmknd.github.io/AwardPrint/) · [Source repository](https://github.com/ytmknd/AwardPrint)

AwardPrint is a browser-based mail merge application for certificates, awards, and recognition documents. Place text over a PDF template, import recipients from CSV or Excel, preview each result, and generate print-ready PDFs. **The normal print PDF contains only the added text; it never includes the PDF template.** This lets you print onto certificate paper that already has a border or design.

The app runs entirely in the browser. It requires no account, API key, or backend, and it does not upload imported personal information to an application server.

## Run locally

Node.js 22 or later is recommended.

```sh
npm install
npm run dev
```

Open the local URL shown by Vite in Chrome or Edge on Windows 11. To build and preview the static production site:

```sh
npm run build
npm run preview
```

Run the tests with:

```sh
npm test
npx playwright install chromium # first time only
npm run test:e2e
```

## How to use

1. The app opens with an A4 portrait sample layout for certificate paper that already has "school, grade, date" printed on it: school name and grade number, recipient name, era year / month / day as separate fields, and a placeholder signer name (`○○　○○`). Three sample recipients are loaded. Choose **新規** (New) to start with an empty layout.
2. Choose **用紙設定** (Paper settings) to select A3, A4, A5, JIS B4, JIS B5, postcard, or a custom size in millimetres. Set orientation and printer X/Y offsets there.
3. Choose **PDF下絵** (PDF template), or drop a PDF onto the editor. Select the template page and adjust its visibility and opacity. The app warns when the PDF size differs from the paper size.
4. Choose **CSV / Excel** to import a `.csv` or `.xlsx` file. CSV supports UTF-8 and Shift_JIS/Windows-31J. Excel imports support sheet selection, header-row selection, and date formatting.
5. Click or drag a column name from the left panel onto the page. Edit its text and placement in the right panel. A text box can combine fixed text and fields, for example `{氏名}　殿`. Hold Shift while clicking to select multiple objects. Arrow keys move a selection by 0.1 mm; Shift + arrow keys move it by 1 mm.
   - To place parts of a date separately, add `:part` to the field: `{日付:年}`, `{日付:月}`, `{日付:日}`, `{日付:曜日}`, `{日付:元号}`, `{日付:和暦}`, `{日付:西暦}`. Date columns show these parts as chips under the column name in the left panel. Both Japanese-era dates (`令和8年3月15日`, `R8.3.15`) and Western dates (`2026/3/15`, `2026年3月15日`) are recognized; `年` keeps the style of the source, and the first year of an era is shown as `元`.
   - To insert only the number from a value such as `６年` or `6年生`, use `{学年:数字}` (keeps the original width), `{学年:半角数字}`, or `{学年:全角数字}`. Columns with such values show a **数字** chip in the left panel.
   - To insert only the `○○` of `○○小学校` or `○○中学校`, use `{学校名:校名}`; `{学校名:種別}` gives the school type (`小学校`, `中学校`, `高等学校`, `特別支援学校`, and so on), and `{学校名:種別略}` gives its short form (`小`, `中`, `高`, `義`, `中等`, `特支`, `高専`, `幼`, `保`, `こ`). Values without a recognized school type are inserted unchanged by `校名` and left blank by `種別` and `種別略`. Columns with school names show **校名**, **種別**, and **種別略** chips in the left panel.
   - Drag items in the **レイアウト** (Layout) list to reorder them. Items lower in the list are drawn on top.
6. Choose **プレビュー** (Preview) to step through recipients. The eye button switches the template display on or off. You can still select, move, resize, and edit objects while previewing.
7. Choose **印刷** (Print) to generate a text-only PDF and open the browser's print dialog. You can print the current record, all records, a range, or rows selected in the data table. **PDF出力** (PDF export) offers a separate confirmation PDF that includes the template.
8. Choose **レイアウト保存** (Save layout) to download a `.json` project file and **レイアウトを開く** (Open layout) to restore it. The app can also import older `.awardprint` files. Recipient rows are excluded from the saved file by default; you can opt to include them. Project data is not saved to browser storage.

The **?** button offers a downloadable sample CSV. You can try the sample layout without importing a PDF.

## Installed fonts

The bundled Noto Serif CJK JP and Noto Sans CJK JP fonts support Japanese text in the editor and are embedded in exported PDFs. Select a text object, then choose **PCにインストール済みのフォントから選ぶ** to list and search every font available through the browser's Local Font Access API. When a font provides a Japanese name in its font metadata, the picker displays and searches that name alongside its other names. Chrome or Edge may ask for permission to access installed fonts. You can also load a TTF or OTF file directly.

Selected custom fonts are included in the project JSON and embedded in output PDFs. Fonts whose OS/2 metadata restricts embedding are rejected. The bundled fonts are distributed under the [SIL Open Font License 1.1 (Serif)](public/fonts/OFL-Serif.txt) and [SIL Open Font License 1.1 (Sans)](public/fonts/OFL-Sans.txt). See the [Local Font Access API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts) for browser availability and permission requirements.

## Print accurately

- Confirm the paper size in both AwardPrint and the printer settings.
- Print at **Actual size** or **100%**. Do not use **Fit to page**.
- Check your printer's printable area. Browsers cannot select a printer or paper tray automatically or skip the print dialog.
- Use ordinary paper for the position-check test print. Adjust the X/Y print offsets in Paper settings if needed.
- Use the text-only **print PDF** for preprinted certificate paper. The **confirmation PDF** includes the template and is intended for review or sharing.

Layout coordinates are stored in millimetres from the paper's top-left corner. PDF output converts them using `1 inch = 25.4 mm = 72 pt`; changing the editor zoom does not change print coordinates.

## Project JSON format

The UTF-8 JSON file has a root `version` value of `1`. It stores `paper`, `objects`, `background`, `fonts`, `columns`, `rows`, print offsets, and merge settings. PDF templates and selected fonts are stored as base64 data. When `includePersonalData` is false, `rows` is saved as an empty array. The importer accepts version 1; incompatible future changes will require a version increment and an explicit migration. Handle files containing recipient data or installed fonts according to your organisation's policies.

## GitHub Pages deployment

This repository includes [a GitHub Actions workflow](.github/workflows/pages.yml) that runs the tests, builds `dist/`, and deploys it on pushes to `main`.

1. Push `main` to `https://github.com/ytmknd/AwardPrint.git`.
2. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. Open the **Actions** tab and wait for **Publish AwardPrint** to finish successfully.
4. Visit **[https://ytmknd.github.io/AwardPrint/](https://ytmknd.github.io/AwardPrint/)**. Publishing may take a few minutes after deployment.

Vite uses relative asset paths, so the app works under the `/AwardPrint/` project path. The GitHub Pages address above becomes live after the workflow deploys successfully.

## Known limitations

- Vertical PDF text is positioned glyph by glyph. Common vertical punctuation and rotated Latin characters are supported, but full Japanese typesetting rules are not. Inspect the generated PDF before printing.
- Text overflow warnings in the editor are estimates. Browser and PDF text layout can wrap long lines differently; use the generated PDF for final proofing.
- A custom font file without a bold face cannot reproduce a bold setting in the PDF. Load and select the font's bold face separately.
- If Excel has already converted an identifier to a number and discarded leading zeros, AwardPrint cannot recover them. Excel display formats such as `0000` are read as displayed text.
- Large PDF templates, fonts, and hundreds of output pages can use substantial device memory. The data table displays its first 200 rows, while PDF generation can use all rows.
