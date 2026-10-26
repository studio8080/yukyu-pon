# 更新情報の追加手順と初期内容の根拠

`src/lib/updates.ts` がホームの最新1件と `/#updates` の一覧の唯一の情報源です。公開を確認した後、新しい順で先頭へ追加します。日付はリリース日とし、作業日やPR作成日で代用しません。同日の項目は既存の順序を保持します。未公開のPR・効果未検証の数字は載せません。今回の表示追加そのものとPR5の月次機能は未公開なので未掲載です。

見出しや文言を追加したら、AGENTS.mdに従い `tools/subset-font.py` でローカルフォントも更新します。最新枠・一覧は印刷対象外で、計算・保存領域・広告・課金を使いません。重要なバックアップ・料金案内は既存の位置を維持しています。

2026-10-26にGitHubのmain `0d1c95dfc9a58725d85a80ec9ad04bb20e7f21ef` と以下の配備記録・PRを照合しました。公開画面の直接取得による再確認とは区別しています。

| 履歴ID | 公開済み内容の根拠 | 成功したmain配備 |
|---|---|---|
| 2026-10-18-privacy | [PR4](https://github.com/studio8080/yukyu-pon/pull/4)、main 0d1c95d。料金ページの申込計測とプライバシー説明の追記。申込先URL・決済完了・ライセンス・入力データを送らないことを照合 | [39123709272](https://github.com/studio8080/yukyu-pon/actions/runs/39123709272)、2026-10-18 20:33 JST、success |
| 2026-10-16-ad-check | [PR3](https://github.com/studio8080/yukyu-pon/pull/3)、main bca29c7。キー確認中の広告を抑止、有料判定後も非表示 | [38862131857](https://github.com/studio8080/yukyu-pon/actions/runs/38862131857)、2026-10-16 15:36 JST、success |
| 2026-10-16-sales | [PR2](https://github.com/studio8080/yukyu-pon/pull/2)、main cf3b550。10月16日の有料申込受付開始と人数制限開始日の表示を照合。料金ページと受付開始実装5e11084を含むmain履歴も確認 | [38853631266](https://github.com/studio8080/yukyu-pon/actions/runs/38853631266)、2026-10-16 14:01 JST、success |

料金条件を履歴内で再定義しないため、受付開始のお知らせから既存の料金ページへ案内します。契約・法務・価格変更は本作業の対象外です。
