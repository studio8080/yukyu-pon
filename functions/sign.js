/*
 * sign.js — ライセンスキーの署名（Cloud Functions 側）
 * tools/issue-key.mjs と同じ形式のキーを作る。src/lib/license.ts が公開鍵で検証する。
 *
 *   YP1-<base64url(payload JSON)>.<base64url(Ed25519 署名)>
 *   payload = { v:1, p:"pro", e:"YYYY-MM-DD", id:"ライセンスID", n?: 人数の上限（省略 = 無制限） }
 */
const crypto = require('crypto');

/** サブスクリプションIDから安定したライセンスID（更新・プラン変更でも変わらない）を作る */
function licenseIdFor(subscriptionId) {
  return crypto.createHash('sha256').update(String(subscriptionId)).digest('base64url').slice(0, 12);
}

/**
 * @param {string} pem    Ed25519 秘密鍵（PKCS#8 PEM）
 * @param {string} expiry 'YYYY-MM-DD'
 * @param {string} id     ライセンスID
 * @param {number|null} limit 在籍人数の上限（null = 無制限）
 */
function signKey(pem, expiry, id, limit) {
  const payload = { v: 1, p: 'pro', e: expiry, id };
  if (limit) payload.n = limit;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, crypto.createPrivateKey(pem));
  return `YP1-${body.toString('base64url')}.${sig.toString('base64url')}`;
}

/** Unix秒 → 'YYYY-MM-DD'（猶予日数を足す） */
function expiryFromUnix(unixSeconds, graceDays) {
  const d = new Date(Number(unixSeconds) * 1000);
  d.setDate(d.getDate() + (graceDays || 0));
  return d.toISOString().slice(0, 10);
}

/** 今日から n 日後の 'YYYY-MM-DD' */
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 実際に発行する有効期限: min( 契約期間の末日 + 猶予 , 今日 + オフライン上限 )
 * 年払いでもキーは30日ほどしか持たない。ブラウザが定期的に取り直すので利用者は気づかないが、
 * 解約されると「今の期間の末日＋猶予」を超えて延長されないため、放っておいても失効する。
 */
function cappedExpiry(periodEndUnix, graceDays, maxOfflineDays) {
  const hard = expiryFromUnix(periodEndUnix, graceDays);
  const soft = daysFromToday(maxOfflineDays);
  return hard < soft ? hard : soft;
}

module.exports = { licenseIdFor, signKey, expiryFromUnix, daysFromToday, cappedExpiry };
