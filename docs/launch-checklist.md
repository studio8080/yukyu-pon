# 有休ポン 販売開始チェックリスト

作成: 2026-10-06。**運営者の操作が必要なもの**を順番に並べた。コードで済むものは実装済み。

> **2026-10-07 方針: 有料版はコンテンツが完成してからリリースする。** それまで支払いリンク・Webhook・デプロイは作らない（3-1 の商品だけ作成済み。商品だけでは購入できない）。
全銀ポンの `docs/launch-checklist.md` と同じ構成（Stripe サブスク → Webhook → Cloud Functions がキーを発行・メール → ブラウザが定期的に取り直し、解約で 410）。

```
Stripe（支払い成功）──Webhook──▶ yukyuponStripeWebhook（misefits / codebase yukyupon / asia-northeast1）
                                  ├─ 商品で Pro（30人）かビジネス（無制限）かを判定。ほかの商品は素通り
                                  ├─ キーを発行 → Firestore（yukyuponLicenses）に保存 → 購入者にメール
                                  └─ イベントIDで二重処理を防ぐ（yukyuponEvents）。メールを送れなければ 500 で Stripe に再送させる

ブラウザ（期限10日前か、前回確認から7日）──ライセンスIDだけ──▶ yukyuponLicense
                                  └─ Stripe に契約状態を直接照会 → 新しいキー（プラン変更も反映）／ 410（Stripe で解約を確認）
                                     ／ 503（Stripe に照会できず判断できない。ブラウザはキーを消さない）
```

判定とメールの文面は `functions/billing.js`（外部モジュールなし）。テストは `functions/test/functions.test.js`（Webhook・キー更新の全経路）と
`src/lib/license.test.ts`・`src/lib/plan.test.ts`（サーバーのキーをブラウザが読めるか、自動更新の判定）。設定の照合は `tools/preflight.mjs`。

料金（2026-10-06 決定）: 無料（在籍5人まで）／Pro ¥480/月・¥4,800/年（30人まで）／ビジネス ¥980/月・¥9,800/年（無制限）。すべて税込。

---

## 2026-10-15 リリース前の点検

| 項目 | 状態 |
|---|---|
| サイト・法令表示（特商法・プライバシー・規約・料金の確認事項） | 済（2026-10-12 公開）。GA4 も動作確認済み |
| コード（`PRO_ENFORCED=false`・購入ボタン「準備中」・`plans.js` の商品ID・CSP・`#pro` リンク） | 販売前の状態のまま。CI 成功 |
| Stripe の商品・価格（税込） | 済 |
| Stripe の共通設定（再試行失敗→キャンセル、チャージバック→即時キャンセル、既定の税＝内税、最小残高 ¥10,000、決済成功時の領収書メール） | 済 |
| カスタマーポータル | 済（2026-10-15）。有休ポン専用の構成（`bpc_1UQl1d3C6tqke0fyU5cML6J2`）：請求書の履歴・決済手段の更新・解約（請求期間の終了時）・プラン切り替え（有休ポンの4価格、日割り）・戻り先は有休ポン。ログインリンクは `functions/billing.js` の `PORTAL_URL`（関数のデプロイで反映） |
| 秘密鍵のバックアップ（2） | 未確認（運営者） |
| シークレット（4） | 10/07 に登録した記録あり。CLI・gcloud の認証切れで今回は読めず |
| Functions のデプロイ（4） | 未（`yukyuponLicense`・`yukyuponStripeWebhook` とも 404） |
| 課金のコードとテスト（2026-10-15 午後） | 済。テスト購入をしない方針に合わせ、Stripe の実際の形でテストを足し、見つけた不具合を直した（6章）。`tools/preflight.mjs` を追加 |
| 支払いリンク4本（3-2）・Webhook（5）・販売開始（7） | 未。¥0 の通し確認はしない（6章。最初の実購入で見ることは7章） |
| 会社サイトの `https://kokokikaku.com/policies` | **有休ポンが載っていない。** Stripe の決済画面・ポータルの「規約」リンクの先なので、販売前に追加する（kokokikaku-web。公開は手動のワークフロー） |
| 返金時の Stripe のメール | オフ（共用。必要ならオンにする） |

Webhook を作るときの API バージョンは、全銀ポンの送信先と同じ `2026-08-26.dahlia`。
コードはこの形（期間は `items.data[].current_period_end`、請求書の契約は `parent.subscription_details.subscription`、明細の商品は `pricing.price_details.product`、
期間末の解約は `cancel_at_period_end` か `cancel_at`）と、それより前の形（期間がサブスクリプション直下、`invoice.subscription`、明細の `price.product`）の両方で動くことを
テストで確かめてある（2026-10-15、Stripe の API リファレンスと changelog で照合）。関数の中の照会は stripe-node 18.5 の既定（`2025-08-27.basil`）で、形は Webhook と同じ。

## 1. DNS（サイトを見えるようにする）— **完了（2026-10-07）**

Claude in Chrome で Squarespace に `CNAME yukyu → studio8080.github.io` を追加（運営者が mikan@ で再認証。既存14件は変更なしを確認）。
GitHub Pages の証明書を発行させ（独自ドメインを保存し直すと発行が始まった）、Enforce HTTPS をオン。http は https に301。
Search Console（studio@、URL プレフィックス、HTML ファイルで確認、sitemap 送信、トップのインデックス登録をリクエスト）と
Bing Webmaster Tools（手動追加、msvalidate.01 のメタタグで確認、sitemap 送信）も登録済み。

<details><summary>手順（記録）</summary>


Squarespace（`kokokikaku.com`、ログインは `mikan@kokokikaku.com`）でレコードを1件追加する。**種別は手で選ぶ。**

| ホスト | 種別 | 値 |
|---|---|---|
| `yukyu` | CNAME | `studio8080.github.io` |

既存のレコード（@ の A、MX、www、menufits / misefits / pitch / zenginpon、TXT）には触らない。
反映後: GitHub のリポジトリ設定 → Pages →「Enforce HTTPS」をオン。確認は `nslookup yukyu.kokokikaku.com`。

</details>

## 2. 秘密鍵のバックアップ — 未

`C:\Users\chaha\.yukyu-pon\license-private.pem` をパスワードマネージャーのセキュアメモに保存する。失うと、発行済みのキーを更新できなくなる。
共有ドライブ（H:）にはコピーしない。

## 3. Stripe で商品と支払いリンクを作る — 未

> Stripe アカウントは MiseFits・MenuFits・全銀ポンと共用。**既存の商品・リンク・Webhook・制限付きキーの権限には触らない。**
> この作業は Claude in Chrome で代行できる（作るものを1つずつ確認してから進める）。

### 3-1. 商品と価格 — **完了（2026-10-07、Claude in Chrome で作成）**

| 商品 | 商品ID | 価格 |
|---|---|---|
| 有休ポン Pro | `prod_VOaJ6ZLE0uy9LG` | ¥480/月・¥4,800/年（継続・JPY・税込） |
| 有休ポン ビジネス | `prod_VOaMMPiqQQOP9R` | ¥980/月・¥9,800/年（継続・JPY・税込） |

2026-10-12 確認（API で読み取り）: 4つの価格とも `tax_behavior` は inclusive（税込）。自動税計算は使わない（インボイス未登録。支払いリンクを作るとき「税金を自動で徴収」はオフのまま）。

税コードはどちらも txcd_10103001。`functions/plans.js` に商品IDを入れ済み。

<details><summary>作成の手順（記録）</summary>


商品 → 商品を追加（どちらも **税コード「サービスとしてのソフトウェア (SaaS): 業務使用」**、価格は**継続・JPY・税込**）

| 商品名 | 説明 | 価格 |
|---|---|---|
| 有休ポン Pro | 有給休暇の管理ツール 有休ポンの有料プラン（在籍30人まで） | ¥480 / 月、¥4,800 / 年 |
| 有休ポン ビジネス | 有給休暇の管理ツール 有休ポンの有料プラン（人数無制限） | ¥980 / 月、¥9,800 / 年 |

作ったら、2つの商品ID（`prod_…`）を `functions/plans.js` の `productId` に入れる。

</details>

### 3-2. 支払いリンクを4本

各価格 →「支払いリンクを作成」。必ずこう設定する。

- **Managed Payments はオフ**（作成時にしか切り替えられない。全銀ポンで一度作り直した）
- **顧客のメールアドレスを収集する: オン**（キーの送付先）
- 決済後のページ: カスタムメッセージ
  ```
  お申し込みありがとうございます。
  ライセンスキーをメールでお送りします（通常は数分以内）。
  届いたメールのリンクを開き、キーを貼り付けてください。
  ```
- 請求書（領収書）を顧客に送信: オン
- **カスタムテキスト（送信ボタン付近）: 申込みの最終確認の表示**（特商法12条の6。全銀ポンと同じ方式。`docs/compliance-check.md`）。
  支払い画面が最終確認画面になるので、自動更新・金額・解約方法・返金の条件をここに出す。価格ごとに金額を合わせる。例（Pro 月払い）:
  ```
  有休ポン Pro（在籍30人まで）月額480円（税込）。毎月自動で更新され、解約の手続きをするまで続きます（1年続けると5,760円）。
  解約はいつでも、キーのメールにある契約の管理ページから。次回の決済日の前日までに解約すれば次回分は請求されません。
  返金は初回決済から7日以内のお申し出に限ります。利用規約と確認事項: https://yukyu.kokokikaku.com/pricing.html#confirm
  ```
  年払いは「年額4,800円（税込）。毎年自動で更新…」、ビジネスは ¥980／¥9,800 に置き換える。
  **2026-10-16 時点のダッシュボードには、この欄が作成画面にも編集画面にも無い。Workbench の Shell も本番では読み取り専用。** リンクを4本作ったあと、`tools/set-payment-link-text.mjs` で API から入れる（使い方はファイル冒頭。権限が「Payment Links: 書き込み」だけの制限付きキーを一時的に作り、終わったら削除する）。
  2026-10-16 に4本作成（どれも Managed Payments 無効・税の自動徴収なし・利用規約の同意なし・完了ページはカスタムメッセージ。**作成画面の Managed Payments は既定でオンになっているので、毎回外す**）。確認文は 2026-10-16 にツールで4本とも設定済み（書き込み後に読み直して一致を確認。一時キーは使用後すぐ期限切れにした）:

  | プラン | ID | URL |
  |---|---|---|
  | Pro 月払い | `plink_1UR0Sa3C6tqke0fy1vMxYP6z` | https://buy.stripe.com/aFaeV61pE2bqbXJ6q79R608 |
  | Pro 年払い | `plink_1UR0Z63C6tqke0fy10jtRwvn` | https://buy.stripe.com/4gM4gsc4i8zOd1NdSz9R609 |
  | ビジネス 月払い | `plink_1UR0aa3C6tqke0fyUxTZK1sD` | https://buy.stripe.com/28E28k9Wag2g6Dp15N9R60a |
  | ビジネス 年払い | `plink_1UR0cT3C6tqke0fyEhtPBbVU` | https://buy.stripe.com/8x27sEd8mcQ4f9VbKr9R60b |

  Stripe の「利用規約への同意を求める」は使わない（規約の URL がアカウント共通の設定で、MiseFits・全銀ポンと共用のため）。規約へのリンクは上のテキストで示す。

4本の URL を `public/pricing.html` の `buy-pro-month` / `buy-pro-year` / `buy-biz-month` / `buy-biz-year` の `href` に入れ、`class="btn off"` の `off` と「（準備中）」を「月払いで申し込む」「年払いで申し込む」に直す。

### 3-3. カスタマーポータル（プランの変更を許可する）

設定 → Billing → カスタマーポータル の「ポータル設定」で **「有休ポン」の構成**を選んで設定する（「デフォルト」は全銀ポン用。変えない）。
有休ポン Pro・ビジネスの4つの価格を相互に切り替え可能にし、日割り、解約は請求期間の終了時。
ログインリンクは有休ポン専用（`functions/billing.js` の `PORTAL_URL`）。全銀ポンのリンクを使うと、切り替え先に有休ポンの価格が出ない。

### 3-4. 制限付きキーの権限

`STRIPE_SECRET_KEY` は共用の制限付きキー（`misefits-functions`）。有休ポンが呼ぶ API は全銀ポンと同じ（Subscriptions の読み取り・Customers の読み取り・Webhook の署名検証）なので、**権限の変更は不要**。
2026-10-02 に Subscriptions・Customers の読み取りを付け足し済み。**外さないこと**（外すと全銀ポンも有休ポンもキーが届かなくなる）。

### 3-5. 支払いに失敗したときの設定（確かめるだけ。共用なので変えるときは全製品で相談）

**確認済み（2026-10-12、ダッシュボードで読み取り）: 「支払いのリトライがすべて失敗した場合」＝サブスクリプションをキャンセル、「カード決済が失敗した場合にメールを送信」＝オン。** 変える必要なし。

設定 → Billing → サブスクリプションとメール →「再試行がすべて失敗した場合」。
`functions/billing.js` の `entitledUntilOf` で、`past_due`（再請求中）は**今の期間の初日から30日（＋猶予3日）まで**キーを出す（2026-10-15 に上限を追加。全銀ポンは上限なし）。
`unpaid`・`paused` は支払い済みの期間（今の期間の初日＋3日）まで、`incomplete`・`incomplete_expired` は出さない。
Stripe は更新の請求書を作った時点で期間を次へ進めるので、上限が無いと、ここが「未払いのままにする」「期日超過のままにする」のとき払われていない契約にもキーが出続ける（年払いなら約1年）。
**再試行の期間（スマートリトライ）は1か月以内にしておく**（それより長いと、再請求中の人のキーが先に切れる。支払いのあと、キーのメールのキーを貼り直せば戻る）。
**「サブスクリプションをキャンセルする」になっていることを確かめる。** 違っていたら、全銀ポン・MiseFits への影響を確かめてから変える。
あわせて「支払いに失敗したときに顧客へメールを送る」がオンか確かめる（共通メモ5章の5）。

## 4. シークレットとデプロイ — 関数は済（2026-10-15 初回デプロイ）

2026-10-15 に運営者が `firebase deploy --only functions:yukyupon --project misefits` で2つの関数を作成。外から確認: 署名なしの Webhook 400、キー更新は不正な ID 400・未発行の ID 404・OPTIONS 204・`Access-Control-Allow-Origin: https://yukyu.kokokikaku.com`。`YP_STRIPE_WEBHOOK_SECRET` はまだ仮の値（5章で入れ替える）。

Firebase プロジェクト `misefits` の Secret Manager。共用の4つ（`STRIPE_SECRET_KEY` `SMTP_USER` `MAIL_FROM` `SMTP_PASS`）は既にある。新しく2つ足す。

- `YP_LICENSE_PRIVATE_KEY` — **登録済み（2026-10-07、バージョン1）**。手元の PEM・アプリの公開鍵（`src/lib/license.ts`）と一致することを確認済み。
- `YP_STRIPE_WEBHOOK_SECRET` — **仮の値（`whsec_placeholder`）で登録済み（2026-10-07、バージョン1）**。リリース時に Webhook を作ったら本物に入れ替える（5章）
- 置き場所は `misefits` のまま（2026-10-07 に運営者が決定。課金専用プロジェクトへの分離はしない）
リポジトリ（`C:\Users\chaha\repos\yukyu-pon`）で実行する。

```bash
firebase functions:secrets:set YP_LICENSE_PRIVATE_KEY --project misefits --data-file "C:\Users\chaha\.yukyu-pon\license-private.pem"
firebase functions:secrets:set YP_STRIPE_WEBHOOK_SECRET --project misefits
```

2つ目は Webhook を作る前なので、いったん仮の値（`whsec_placeholder`）を入れる。

### デプロイ前（毎回）

ネットワーク・秘密情報なしで実行できる。**NG が1つでもあればデプロイしない。**

```bash
N=/c/Users/chaha/tools/node-v24.14.0-win-x64/node.exe
$N functions/test/functions.test.js     # Webhook・キー更新の全経路（Stripe・Firestore・メールは差し替え）
$N node_modules/vitest/vitest.mjs run   # サーバーのキーをブラウザが読めるか、自動更新の判定
$N tools/preflight.mjs                  # 商品ID・URL・CSP・CORS・ポータル・差出人・メール文・料金・キーの形式・購入リンクの状態・秘密情報
```

`functions/node_modules` があれば、署名の検証は本物の stripe SDK でも確かめる（`cd functions && npm ci` のあと）。

そのあとデプロイ:

```bash
firebase deploy --only functions:yukyupon --project misefits
```

**`--only functions:yukyupon` を外さない**（MiseFits・全銀ポンの関数に触れないため）。
デプロイされる URL:
- Webhook: `https://asia-northeast1-misefits.cloudfunctions.net/yukyuponStripeWebhook`
- キー更新: `https://asia-northeast1-misefits.cloudfunctions.net/yukyuponLicense`（`src/config.ts` の `LICENSE_API` と、`vite.config.ts` の CSP に入れてある）

## 5. Stripe の Webhook 送信先 — 送信先は作成済み（2026-10-16）。署名シークレットの登録と再デプロイが未

送信先 `yukyupon-license`（`we_1UR0fG3C6tqke0fyAW6tmoUp`）：お客様のアカウント・スナップショット・`2026-08-26.dahlia`・イベント4件・URL は下のとおり。署名シークレットは運営者が画面で表示して `firebase functions:secrets:set` に貼る（AI は読まない）。

開発者 → Webhook → 送信先を追加

- URL: 上の Webhook の URL
- イベント4件: `checkout.session.completed` `invoice.paid` `customer.subscription.updated` `customer.subscription.deleted`
- ペイロード: スナップショット。API バージョンは全銀ポンの送信先と同じもの

作ったら署名シークレット（`whsec_…`）を本物に入れ替えて、もう一度デプロイする。

```bash
firebase functions:secrets:set YP_STRIPE_WEBHOOK_SECRET --project misefits
firebase deploy --only functions:yukyupon --project misefits
```

デプロイしたら、外から次の3つだけ確かめる（どれも何も書き込まない）。

| 確かめること | 期待する結果 |
|---|---|
| 署名なしで Webhook の URL に POST | 400（署名の検証が動いている） |
| `…/yukyuponLicense?id=unknown123` を開く | 404（Firestore に届いている） |
| Stripe の Webhook「有休ポン」の画面 | 送信先が有効、イベント4件、API バージョン `2026-08-26.dahlia` |

## 6. テスト購入はしない — 代わりに何で保証したか（2026-10-15 運営者の方針）

**運営者の方針: 本番のテスト購入（¥0 クーポンでの通し確認）はしない。** 共通メモ5章の1「本番の経路を一度は通す」は、
次の3つで置き換え、最初の実購入を「通し確認」として扱う（7章の「最初の購入で見ること」）。

| 保証の手段 | 何を確かめているか |
|---|---|
| `functions/test/functions.test.js` | Webhook・キー更新の全経路。イベントは Stripe の実際の形（dahlia、使わない項目も含む）と古い形の両方。新規（Pro・ビジネス・年払い）、プラン変更、解約予約（`cancel_at_period_end` と `cancel_at`）と取り消し、即時解約、状態ごと（past_due / unpaid / incomplete / incomplete_expired / paused / canceled）、二重配信・同時到着・途中で落ちた再送、メール・SMTP・Stripe 照会・Firestore の失敗、メールアドレスが無いとき、ほかの製品のイベント、署名の検証（`functions/node_modules` があれば本物の SDK でも） |
| `src/lib/license.test.ts`・`plan.test.ts` | `functions/sign.js` のキーをブラウザの検証が通す、本番の公開鍵と形式・アルゴリズムが一致、自動更新の判定（期限10日前・7日ごと・410 でだけキーを外す・404/503/オフラインは何もしない） |
| `tools/preflight.mjs` | 商品ID・更新先の URL・CSP・CORS・ポータル・差出人・メール文・料金・キーの形式・購入リンクの状態・秘密情報 |
| 全銀ポンの実地の結果（2026-10-02〜06） | 同じ構成（共用の制限付きキー・SMTP・`MAIL_FROM`・ポータル・Webhook の形）で、購入 → キー → 解約受付 → 即時キャンセル → 終了 → 猶予後の 410 まで本番で通過。共用部分（制限付きキーの権限、SMTP、ポータルのリンク）は有休ポンも同じものを使う |

### サンドボックスでの通し確認（2026-10-16、運営者の依頼で実施）

本番と同じ関数のコードを、Stripe の「ここ企画サンドボックス」につないだテスト環境の関数（`yukyuponSandboxWebhook` / `yukyuponSandboxLicense`）で通した。
キー・署名シークレットは `YP_SANDBOX_STRIPE_KEY`・`YP_SANDBOX_WEBHOOK_SECRET`、商品は `functions/plans.js` の `SANDBOX_PLANS`（有休ポン Pro・ビジネス（テスト））、Firestore は `yukyuponSandbox*`、キーは2日で切れる。

| 手順 | 結果 |
|---|---|
| テスト用リンク（buy.stripe.com/test_…）でテストカード 4242 で申し込み | Webhook 配信 成功（失敗0）、キーのメールが届いた（差出人「有休ポン（ここ企画）」、本文・ポータルのリンク・ライセンスIDを確認） |
| 届いたキーを本番のアプリ（yukyu.kokokikaku.com/#pro）に貼る | 「Pro（在籍30人まで）が有効（キーの期限 2026/10/18）」 |
| ダッシュボードで契約をビジネス（テスト）に変更 | キー更新が人数無制限のキーを返した（`customer.subscription.updated` を処理） |
| 即時キャンセル | 状態 `canceled`。猶予3日（終了日＋3日）まではキーを出し、そのあと 410 の設計どおり。「有料プランのご契約が終了しました」のメールが届いた |
| 配信の合計 | 4件・失敗0 |

本番のアプリはキー更新を本番の関数に問い合わせるので、テスト環境のキーの更新は本番では 404（何もしない）。2日で切れる。
テスト環境の関数を消すときは、`SANDBOX_PLANS` の商品IDを空にしてデプロイする（削除の確認が出る）。

本番の設定のうち、サンドボックスでは確かめられないもの（本番の署名シークレット・本番の支払いリンク）は、最初の実購入で見る（7章）。

- `YP_STRIPE_WEBHOOK_SECRET` が送信先「有休ポン」の署名シークレットと一致しているか（違えば Webhook が 400）
- 送信先のイベント4件・API バージョン・URL
- `YP_LICENSE_PRIVATE_KEY` が `src/lib/license.ts` の公開鍵と対になっているか（2026-10-07 に一致を確認済み。入れ替えたら要確認）
- 支払いリンクの設定（メール収集オン・Managed Payments オフ・カスタムテキスト）とポータルで有休ポンの4価格を切り替えられるか

## 7. 販売を始める — 2026-10-16 に申し込みの受け付けを開始。人数の制限は 2026-11-16 から

2026-10-16 運営者の決定: 申し込みは今日から受け付け、人数の制限（在籍6人以上は有料）は利用規約8条の1か月前の告知をはさんで `src/config.ts` の `ENFORCE_FROM`（2026-11-16）から自動で始める。告知は `pricing.html` の `#status`、`llms.txt`、設定の料金の欄、在籍6人以上で無料の人の画面上部のお知らせ。`PRO_ENFORCED` はこの日付から決まるので、11/16 に作業は要らない（その日に画面を開いた人から制限が効く）。

販売開始前に、デプロイ前のテスト（4章）に加えて次を実行し、**NG が無いこと**を確かめる。

```bash
$N tools/preflight.mjs --sale   # 購入リンク4本が buy.stripe.com、PRO_ENFORCED=true まで見る
```

1. 支払いリンク4本（3-2）を `public/pricing.html` に入れる
2. `src/config.ts` の `PRO_ENFORCED` を `true`
3. `public/pricing.html` の `#status` のお知らせを「在籍6人以上は有料プランが必要です」などに差し替える
4. README 4章・`src/components/SettingsView.tsx` の「公開記念」の文言が出ないことを確かめる（`PRO_ENFORCED` で自動的に消える）
5. push → GitHub Actions が公開する

すでに6人以上で使っている人がいる場合: 利用規約8条のとおり、重要な変更は1か月前に告知する（`pricing.html` の `#status` と、画面のお知らせ）。

### 最初の実購入で見ること（通し確認の代わり。AI が Stripe・Firestore・ログで確かめる）

購入の通知が来たら、その日のうちに次を見る。1つでも違えば8章の手動発行で先にキーを送り、原因を直してから Stripe でイベントを再送する（同じイベントIDなら二重には送らない）。

1. Stripe → Webhook「有休ポン」→「イベントの配信」: `checkout.session.completed` と `invoice.paid` が **200**（400 は署名シークレット、500 は権限・SMTP。本文の `skipped` が `other product` なら `plans.js` の商品ID）
2. Firestore `yukyuponLicenses/<ライセンスID>`: `status: active`、`plan`・`limit`（Pro は 30、ビジネスは null）、`email`、`entitledUntil` が期間の末日＋3日、`stripeCheckedAt` あり
3. Firestore `yukyuponEvents/<イベントID>`: `doneAt` と `mailedAt` がある（`lastError` が無い）
4. 購入者にキーのメールが届いている（差出人「有休ポン（ここ企画）」。届いていなければ「要対応」のメールが運営者に来ているはず）
5. ブラウザ: 購入者から「有効にならない」と言われたら、`/#pro` に貼ったキーで「Pro（在籍30人まで）が有効」になるか、`…/yukyuponLicense?id=<ライセンスID>` が 200 を返すかを見る
6. 最初の解約・プラン変更・更新の請求が来たときも、同じく「イベントの配信」が 200 かを見る（`customer.subscription.updated`・`deleted`、2回目の `invoice.paid`）

## 8. 申し込みが来たとき・キーが届かないとき

- 自動で発行・送信される。届かない問い合わせが来たら、**まず Stripe の Webhook「有休ポン」→「イベントの配信」で失敗を探す**。原因を直してから再送する（同じイベントIDなら二重には送らない）。
- 急ぐときは手動で同じライセンスIDのキーを発行して先に送る:
  ```bash
  node -e "console.log(require('./functions/sign').licenseIdFor('sub_…'))"
  node tools/issue-key.mjs --months 1 --plan pro --id <上のID> --memo "メールアドレス"
  ```
- メールが送れないとき、Webhook は 500 を返して Stripe に再送させ、運営者（MAIL_FROM のアドレス）に「要対応」のメールを送る。
- 購入者のメールアドレスが分からないとき・支払いが済んでいない契約（incomplete）のときも、運営者に「【要対応】有休ポン: …」が届く（前者はキーつき。購入者に転送する）。
- Stripe の照会が権限不足で失敗したら 500（黙って諦めない）。Stripe が再送し、失敗が続けば運営者に知らせる。
- 同じイベントが同時に届いたら、後の方は 409（Stripe が後で再送する。異常ではない）。
- キー更新が 503 を返すのは、Stripe に照会できず手元の記録でも判断できないとき。ブラウザはキーを消さず、次に開いたときに取り直す。
- ログ: Cloud Logging で `resource.labels.service_name="yukyuponstripewebhook"`。

### 最小残高（2026-10-15 設定。共用アカウント）

設定 → 銀行口座と通貨 →「最小残高」＝**決済残高で ¥10,000 を維持**。毎週の入金からこの額を残し、返金（初回7日以内。最大はビジネス年払い ¥9,800）と不審請求の手数料をすぐ処理できるようにする。
残高が足りないと返金は「保留」になり、マイナスが続くと Stripe が銀行口座から引き落とす（2026-10-15 時点の −¥334 は Radar・Billing・Managed Payments の手数料によるもので、返金ではない）。

### 返金するとき（初回決済から7日以内）

Stripe は返金しても契約を止めない。返金だけすると、次回も請求され、キーも延び続ける。
1. Stripe の画面でそのサブスクリプションを**「今すぐキャンセル」**（「期間の終了時」ではない）
2. 支払いを返金する（全額）
3. 「契約が終了しました」のメールが届き、猶予（3日）後にキー更新が 410 になる
