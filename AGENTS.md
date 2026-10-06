# AGENTS.md — 有休ポンの作業ルール

計画・設計・法令の根拠は `README.md` が正本。計算は `src/lib/engine.ts` に集約してある。
公開URL: https://yukyu.kokokikaku.com/ （`main` に push すると GitHub Actions がテスト・ビルドして公開する）

## 1. 絶対に守ること

1. **データを外に出さない。** 氏名・入社日・休んだ日を送信する処理、解析タグ、外部フォント・CDN を足さない。
   外へ送ってよいのはライセンスID（英数字12桁）だけ。本番の CSP（`vite.config.ts`）の `connect-src` はキー更新先の
   `https://asia-northeast1-misefits.cloudfunctions.net` だけ。**これを消すとキーの更新が黙って失敗し、有料の人が30日で無料に戻る。**
   許可先を足すときは、理由を README に書き、`public/privacy.html` を先に直す。
2. **計算を確率や推測で決めない。** 付与日数・時効・年5日は条文どおりのルールで書き、迷ったら労働者に不利にならない側に倒す。
   推定したもの（移行残の割り当て、年の無い日付）は画面に「推定」と出す。
3. **法令を直したら、テストを先に書く。** `src/lib/engine.test.ts` に条文の具体例を足してから engine を直す。
4. **画面・ルールのページ・README を一致させる。** 扱えないことや決めたルールを変えたら、`GuideView.tsx` と README の2章を同時に直す。
5. **判断の要る設定は利用者に事前確認させる**（社労士を挟まない前提）。一斉付与への切り替えと Excel からの引っ越しのチェックリストを外さない。
6. **データを人質にしない。** Pro が必要になっても、閲覧・管理簿の出力・バックアップは止めない。
7. **事実でないことを書かない。** 料金を変えたら README 4章の「同時に直すもの」を全部直す。
   条文番号は原文で確かめる。「労基署にそのまま出せる」「必ず適法」のような断定をしない。
8. **秘密鍵はリポジトリに入れない。** `C:\Users\chaha\.yukyu-pon\license-private.pem`（Secret Manager の `YP_LICENSE_PRIVATE_KEY` にも同じもの）。発行台帳 `tools/issued-keys.csv`・`functions/.env` も公開しない。

## 2. 課金（Stripe・Cloud Functions）

全銀ポンと同じ構成。手順は `docs/launch-checklist.md`、設計は README 4章。共通メモ5章（決済の共通チェック）を必ず守る。

- デプロイは `firebase deploy --only functions:yukyupon --project misefits`。**`--only` を外さない**（MiseFits・全銀ポンの関数がある）。
- Stripe アカウントは共用。**`functions/plans.js` の商品IDで絞る。** ほかの製品の商品・リンク・Webhook・制限付きキーの権限に触らない。
- 制限付きキー `STRIPE_SECRET_KEY` には Subscriptions・Customers の読み取りが必須（外すと全銀ポンも止まる）。
- Webhook を変えたら `functions/test/functions.test.js` に経路を足す。メール本文はプレーンテキスト（`**` を書かない）。
- 権限やシークレットを変えたら、Stripe の「イベントの配信」で 200 を確かめる。

## 3. 動かし方

arm64 のネイティブモジュールは Application Control で止められるので、x64 の Node を使う（README 6章）。

```bash
N=/c/Users/chaha/tools/node-v24.14.0-win-x64/node.exe
$N node_modules/vitest/vitest.mjs run && $N functions/test/functions.test.js && $N node_modules/typescript/bin/tsc -b && $N node_modules/vite/bin/vite.js build
```

画面を直したら: 「サンプルで試す」→ 一覧・従業員の編集・取り込み（貼り付け）・管理簿・設定を通し、スマホ幅（375px）で横スクロールが出ないことを見る。
本番相当（CSP 付き）は launch.json の `yukyu-pon-dist`。
`npm install` をやり直すときは `PATH=/c/Users/chaha/tools/node-v24.14.0-win-x64:$PATH npm i --cpu=x64 --os=win32`。
ブラウザのペインが非表示だと、dialog の close イベントやスクリーンショットが止まることがある（コードの不具合と取り違えない）。

## 4. データの互換

localStorage のキーは `yukyu-pon:v1`（`src/store.ts`、persist の version 2）。設定の項目は `merge` で既定値を補うので、足すだけなら移行は要らない。
型を変えるときは `migrate` を足し、バックアップ（`format: yukyu-pon-backup`）の `parseBackup` も古い形を読めるようにする。利用者のデータはブラウザにしか無い。
