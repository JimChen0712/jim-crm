# Jim CRM 移交手冊

## 專案位置

- 本機 Git 資料夾：`/Users/jimchen/Documents/GitHub/etalking-crm`
- GitHub：<https://github.com/JimChen0712/jim-crm>
- 工作分支：`main`

請讓新的 AI 直接開啟上述本機資料夾，不要重新建立 Git repo。若另一台電腦沒有本機資料夾，請 clone：

```bash
git clone https://github.com/JimChen0712/jim-crm.git
cd jim-crm
npm ci
```

## 這個工具是什麼

這是公司管理後台使用的 JavaScript 書籤工具，功能包含：

- 名單管理、評級、備註、釋出與再次留單
- Google Sheet 的新單／常態單／Demo 資料同步
- 常態名單觸及率同步
- 點擊後才載入的聯繫歷史
- 單筆撥號與自動撥號

正式書籤會從 jsDelivr 載入 GitHub `main` 的 `crm.js`：

```javascript
javascript:(function(){var script=document.createElement('script');script.src='https://cdn.jsdelivr.net/gh/JimChen0712/jim-crm@main/crm.js?v='+Date.now();document.body.appendChild(script);})();
```

## 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `src/main.js` | CRM 面板 UI、名單同步、聯繫歷史與撥號邏輯 |
| `src/api.js` | Google Apps Script API 通訊 |
| `src/config.js` | GAS URL、主管 UID、使用者字典等設定 |
| `crm.js` | 正式書籤載入的建置結果 |
| `dist/crm.js` | Vite 建置結果；需與根目錄 `crm.js` 一起更新 |
| `README.md` | 完整功能與操作說明 |

## 重要設定

- 主管權限 UID：`162`（在 `src/config.js` 的 `MANAGER_UID`）
- 目前 Google Apps Script API：
  `https://script.google.com/macros/s/AKfycbx1lle1kwBDsSBPKBhg9kMa0qzu4i46hG4BkwfQH_-YH5r-1Sw0_uimGB6h97NiJfpH3w/exec`
- 後台實際網域與資料 API 仍是 `etalkingonline.com`；這些是工具運作所需，不可任意改名或移除。

Google Sheet 的用途：

- **工作表1**：新單、再次留單、評級、備註、觸及率
- **Demo名單總表**：Demo 同步資料

## 開發與發布

每次程式修改請依序執行：

```bash
npm run build
git status
git add src crm.js dist/crm.js
git commit -m "說明此次修改"
git push origin main
```

注意事項：

1. 只要修改 `src/*`，就一定要執行 `npm run build`。
2. 建置後的 `crm.js` 和 `dist/crm.js` 都要提交，否則書籤不會取得新版本。
3. push 後，使用者要重新整理後台並重新點書籤；jsDelivr 偶爾有快取延遲。
4. 修改前先看 `git status`。如果有不屬於本次工作的變更，不要覆蓋或還原。

## 既有重要邏輯

- 面板／通道使用過久（約 2 小時）會禁止寫入；需要回到名單頁開啟新的後台通道，再重新點書籤。
- 寫入前會驗證登入 session 和 `crm.js` 是否為最新版本。
- 自動撥號只有在撥號 API 成功接受後才會開始倒數。
- 未接可連續撥兩次；兩次的下次聯繫日期都使用同一個「10 天後」日期，不會累加成 20 天。
- 「語音」代表轉語音後直接下一筆，不應對同一名單重撥。
- 聯繫歷史必須按名單旁按鈕才載入，不能一次預載所有名單。
- 常態觸及率同步只寫入有變化資料，單筆失敗應重試且不中斷其餘名單。

## 給下一位 AI 的起始指令

可直接貼上：

> 請接手 `/Users/jimchen/Documents/GitHub/etalking-crm` 的 Jim CRM 專案。先閱讀 `HANDOVER.md`、`README.md` 與 `src/config.js`，確認 `git status` 後再進行任何修改。此專案的正式發布流程是修改 `src/*`、執行 `npm run build`、確認 `crm.js` 與 `dist/crm.js` 更新，再 commit 並 push 到 `main`。請保留既有後台網域與 GAS 設定，除非我明確要求變更。
