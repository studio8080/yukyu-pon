# 有休ポン 販売開始チェックリスト

作成: 2026-10-06。**運営者の操作が必要なもの**を順番に並べた。コードで済むものは実装済み。
全銀ポンの `docs/launch-checklist.md` と同じ構成（Stripe サブスク → Webhook → Cloud Functions がキーを発行・メール → ブラウザが定期的に取り直し、解約で 410）。

```
Stripe（支払い成功）──Webhook──▶ yukyuponStripeWebhook（misefits / codebase yukyupon / asia-northeast1）
                                  ├─ 商品で Pro（30人）かビジネス（無制限）かを判定。ほかの商品は素通り
                                  ├─ キーを発行 → Firestore（yukyuponLicenses）に保存 → 購入者にメール
                                  └─ イベントIDで二重処理を防ぐ（yukyuponEvents）。メールを送れなければ 500 で Stripe に再送させる

ブラウザ（期限10日前か、前回確認から7日）──ライセンスIDだけ──▶ yukyuponLicense
                                  └─ Stripe に契約状態を直接照会 → 新しいキー（プラン変更も反映）／ 410（解約済み）
```

料金（2026-10-06 決定）: 無料（在籍5人まで）／Pro ¥480/月・¥4,800/年（30人まで）／ビジネス ¥980/月・¥9,800/年（無制限）。すべて税込。

---

## 1. DNS（サイトを見えるようにする）— 未

Squarespace（`kokokikaku.com`、ログインは `mikan@kokokikaku.com`）でレコードを1件追加する。**種別は手で選ぶ。**

| ホスト | 種別 | 値 |
|---|---|---|
| `yukyu` | CNAME | `studio8080.github.io` |

既存のレコード（@ の A、MX、www、menufits / misefits / pitch / zenginpon、TXT）には触らない。
反映後: GitHub のリポジトリ設定 → Pages →「Enforce HTTPS」をオン。確認は `nslookup yukyu.kokokikaku.com`。

## 2. 秘密鍵のバックアップ — 未

`C:\Users\chaha\.yukyu-pon\license-private.pem` をパスワードマネージャーのセキュアメモに保存する。失うと、発行済みのキーを更新できなくなる。
共有ドライブ（H:）にはコピーしない。

## 3. Stripe で商品と支払いリンクを作る — 未

> Stripe アカウントは MiseFits・MenuFits・全銀ポンと共用。**既存の商品・リンク・Webhook・制限付きキーの権限には触らない。**
> この作業は Claude in Chrome で代行できる（作るものを1つずつ確認してから進める）。

### 3-1. 商品と価格

商品 → 商品を追加（どちらも **税コード「サービスとしてのソフトウェア (SaaS): 業務使用」**、価格は**継続・JPY・税込**）

| 商品名 | 説明 | 価格 |
|---|---|---|
| 有休ポン Pro | 有給休暇の管理ツール 有休ポンの有料プラン（在籍30人まで） | ¥480 / 月、¥4,800 / 年 |
| 有休ポン ビジネス | 有給休暇の管理ツール 有休ポンの有料プラン（人数無制限） | ¥980 / 月、¥9,800 / 年 |

作ったら、2つの商品ID（`prod_…`）を `functions/plans.js` の `productId` に入れる。

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

4本の URL を `public/pricing.html` の `buy-pro-month` / `buy-pro-year` / `buy-biz-month` / `buy-biz-year` の `href` に入れ、`class="btn off"` の `off` と「（準備中）」を外す。

### 3-3. カスタマーポータル（プランの変更を許可する）

設定 → Billing → カスタマーポータル →「サブスクリプションを更新」で、有休ポン Pro・ビジネスの4つの価格を**相互に切り替え可能**にする（Pro → ビジネスの変更をお客さまが自分でできる）。
全銀ポンの商品の設定は変えない。ログインリンクは全銀ポンと共通（`functions/index.js` の `PORTAL_URL`）。

### 3-4. 制限付きキーの権限

`STRIPE_SECRET_KEY` は共用の制限付きキー（`misefits-functions`）。有休ポンが呼ぶ API は全銀ポンと同じ（Subscriptions の読み取り・Customers の読み取り・Webhook の署名検証）なので、**権限の変更は不要**。
2026-10-02 に Subscriptions・Customers の読み取りを付け足し済み。**外さないこと**（外すと全銀ポンも有休ポンもキーが届かなくなる）。

## 4. シークレットとデプロイ — 未

Firebase プロジェクト `misefits` の Secret Manager。共用の4つ（`STRIPE_SECRET_KEY` `SMTP_USER` `MAIL_FROM` `SMTP_PASS`）は既にある。新しく2つ足す。
リポジトリ（`C:\Users\chaha\repos\yukyu-pon`）で実行する。

```bash
firebase functions:secrets:set YP_LICENSE_PRIVATE_KEY --project misefits --data-file "C:\Users\chaha\.yukyu-pon\license-private.pem"
firebase functions:secrets:set YP_STRIPE_WEBHOOK_SECRET --project misefits
```

2つ目は Webhook を作る前なので、いったん仮の値（`whsec_placeholder`）を入れる。そのあとデプロイ:

```bash
firebase deploy --only functions:yukyupon --project misefits
```

**`--only functions:yukyupon` を外さない**（MiseFits・全銀ポンの関数に触れないため）。
デプロイされる URL:
- Webhook: `https://asia-northeast1-misefits.cloudfunctions.net/yukyuponStripeWebhook`
- キー更新: `https://asia-northeast1-misefits.cloudfunctions.net/yukyuponLicense`（`src/config.ts` の `LICENSE_API` と、`vite.config.ts` の CSP に入れてある）

## 5. Stripe の Webhook 送信先 — 未

開発者 → Webhook → 送信先を追加

- URL: 上の Webhook の URL
- イベント4件: `checkout.session.completed` `invoice.paid` `customer.subscription.updated` `customer.subscription.deleted`
- ペイロード: スナップショット。API バージョンは全銀ポンの送信先と同じもの

作ったら署名シークレット（`whsec_…`）を本物に入れ替えて、もう一度デプロイする。

```bash
firebase functions:secrets:set YP_STRIPE_WEBHOOK_SECRET --project misefits
firebase deploy --only functions:yukyupon --project misefits
```

## 6. 本番の経路を ¥0 で通す（共通メモ5章の1）— 未

1回だけ使える100%割引で、本物の決済経路を通す。

| 用意するもの | 内容 |
|---|---|
| クーポン | 「解約テスト用（有休ポン・初月無料）」100%・1回・**有休ポン Pro・ビジネスのみ**・引き換え1回 |
| プロモーションコード | 引き換え1回。コードは公開リポジトリに書かない |
| Pro 月払いの支払いリンク | 「プロモーションコードを許可」を一時的にオン |

手順（★は運営者、ほかは AI が Stripe・Firestore・ログで確かめる）

1. ★ Pro 月払いのリンクから、自分のメール・カード・プロモーションコードで申し込む（請求 ¥0）
2. Webhook の配信が 200、Firestore に契約（plan: Pro, limit: 30）、キーのメールが届く。差出人名が「有休ポン（ここ企画）」
3. ★ メールの `/#pro` リンクを開き、キーを貼って「Pro（在籍30人まで）が有効」になるのを見る
4. ★ メールの契約の管理ページで、ビジネスに変更する → 有休ポンの「更新を確認」で「ビジネス（人数無制限）」になる
5. ★ 契約の管理ページで解約 →「解約を承りました」が1通だけ届く
6. Stripe の画面でサブスクリプションを「今すぐキャンセル」→「契約が終了しました」が届く。猶予（3日）後にキー更新が 410 → ブラウザがキーを外す
7. 片付け: 支払いリンクの「プロモーションコードを許可」をオフに戻す

## 7. 販売を始める — 未（6が通ってから）

1. `src/config.ts` の `PRO_ENFORCED` を `true`
2. `public/pricing.html` の `#status` のお知らせを「在籍6人以上は有料プランが必要です」などに差し替える
3. README 4章・`src/components/SettingsView.tsx` の「公開記念」の文言が出ないことを確かめる（`PRO_ENFORCED` で自動的に消える）
4. push → GitHub Actions が公開する

すでに6人以上で使っている人がいる場合: 利用規約8条のとおり、重要な変更は1か月前に告知する（`pricing.html` の `#status` と、画面のお知らせ）。

## 8. 申し込みが来たとき・キーが届かないとき

- 自動で発行・送信される。届かない問い合わせが来たら、**まず Stripe の Webhook「有休ポン」→「イベントの配信」で失敗を探す**。原因を直してから再送する（同じイベントIDなら二重には送らない）。
- 急ぐときは手動で同じライセンスIDのキーを発行して先に送る:
  ```bash
  node -e "console.log(require('./functions/sign').licenseIdFor('sub_…'))"
  node tools/issue-key.mjs --months 1 --plan pro --id <上のID> --memo "メールアドレス"
  ```
- メールが送れないとき、Webhook は 500 を返して Stripe に再送させ、運営者（MAIL_FROM のアドレス）に「要対応」のメールを送る。
- ログ: Cloud Logging で `resource.labels.service_name="yukyuponstripewebhook"`。
