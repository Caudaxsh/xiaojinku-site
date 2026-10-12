# 小金庫單字

個人專屬的英文單字複習 App（PWA）。純 HTML / CSS / JavaScript，沒有建置步驟，
手機加入主畫面後可全螢幕、離線使用。資料只存在手機本機（IndexedDB），不會上傳。

## 功能

- **卡片正面**：單字 + 兩個英文例句（單字會標色，可點小喇叭朗讀）
- **卡片背面**：中文意思、兩個例句翻譯、多個搭配詞、記憶方式、文法補充
- **第一次複習時分級**：★★★ 最重要 / ★★ 重要 / ★ 艱深少用，之後依星級安排複習
- **間隔複習**
  | 星級 | 複習間隔（天） | 結束條件 |
  |---|---|---|
  | ★★★ | 1 · 3 · 7 · 14 · 30 · 60 · 120 | 不退場，之後每 120 天一次 |
  | ★★ | 3 · 10 · 30 | 三次後視為已掌握 |
  | ★ | 7 | 一次後視為已掌握 |
  
  答「忘了」會隔天重來，當天也會再出現一次；「很熟」會跳過一個間隔。間隔表在 `js/srs.js` 的 `LADDERS`，可自行調整。
- 單字庫搜尋、星級篩選、改星級、刪除；備份匯出 / 還原

## 每天怎麼加新單字

1. 打開 App →「匯入」→ **複製 AI 提示詞**，貼給 ChatGPT，後面接上今天要學的單字。
2. 把 ChatGPT 的回覆整段複製。
3. 回到「匯入」貼上，確認預覽（會標出缺漏與重複），按「匯入」。

同一個單字重複匯入只會更新內容，不會動到複習進度。

### 支援的格式

標準格式（提示詞要求 AI 輸出的格式）：

```
# entail
EN: Starting a business entails taking financial risks.
EN: The job entails working long hours.
ZH: 創業必然涉及承擔財務風險。
ZH: 這份工作需要長時間工作。
意思: 涉及、必然需要
搭配:
- entail risks — 涉及風險
- entail costs — 涉及成本
記憶: 聯想法：en- + tail（尾巴）
---
```

也能讀懂 ChatGPT 常見的排版（單字標題、編號英文例句、「中文翻譯」、「單字：意思」、
「常見搭配」、「記憶方式」、「注意文法」），單字之間用 `---` 分隔即可。
範例見 `samples/sample-words.txt`。

## 發佈到網路（GitHub Pages）

1. 把這個分支合併到 `main`。
2. GitHub 儲存庫 → Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)`。
3. 幾分鐘後網址是 `https://<帳號>.github.io/xiaojinku-site/`。

不需要任何審核。免費帳號的 Pages 通常要求儲存庫為公開，所以**不要把個人資料放進儲存庫**
（單字只存在手機裡，不會被上傳）。

### 裝到 iPhone

用 Safari 開上面的網址 → 分享 → **加入主畫面**。之後從主畫面圖示開啟即可離線使用。
資料存在瀏覽器內，換手機或清除網站資料前請先到「設定」匯出備份。

## 開發

```sh
python3 -m http.server 8000        # 然後開 http://localhost:8000
node --test tests/parser.test.mjs tests/srs.test.mjs
```

改了任何檔案後，若要讓已安裝的手機立即取得新版，把 `sw.js` 裡的 `CACHE` 版本號加一。

| 檔案 | 用途 |
|---|---|
| `js/parser.js` | 解析貼上的文字、AI 提示詞 |
| `js/srs.js` | 星級複習排程 |
| `js/store.js` | 本機儲存（IndexedDB，備援 localStorage） |
| `js/app.js` | 介面與互動 |
| `sw.js` / `manifest.webmanifest` | 離線與加入主畫面 |
