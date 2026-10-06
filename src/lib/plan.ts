import { useEffect, useState } from 'react'
import { FREE_LIMIT, LICENSE_API, PRO_ENFORCED } from '../config'
import { useStore } from '../store'
import { today } from './dates'
import { renewIfNeeded, verifyLicense, type LicenseResult } from './license'

/** 起動時と「更新を確認」で呼ぶ。契約中ならキーを差し替え、解約済みならキーを外して無料プランに戻す */
export async function renewLicense(force = false): Promise<string> {
  const st = useStore.getState()
  const r = await renewIfNeeded(LICENSE_API, st.licenseKey, st.licenseCheckedAt, today(), force)
  if (r.kind === 'renewed') {
    st.setLicenseKey(r.key)
    st.markLicenseChecked()
    return `キーを更新しました（有効期限 ${r.expiry}）。`
  }
  if (r.kind === 'revoked') {
    st.setLicenseKey('')
    st.markLicenseChecked()
    st.setLicenseNotice('有料プランのご契約が終わったため、無料プランに戻りました。入力したデータはそのまま使えます。')
    return '契約が終わっているため、キーを外しました。'
  }
  if (r.reason === 'offline') return '通信できませんでした。手元のキーの期限までは、そのまま使えます。'
  if (r.reason === 'not-due') return 'まだ確認の時期ではありません。'
  if (r.reason.startsWith('http-404')) return 'このキーは自動更新の対象ではありません（手動で発行したキー）。'
  return `確認できませんでした（${r.reason}）。`
}

export type Plan = {
  pro: boolean
  license: LicenseResult | null
  /** 在籍中の人数の上限（null = 無制限） */
  limit: number | null
  activeCount: number
  /** あと何人追加できるか（null = 無制限） */
  room: number | null
  enforced: boolean
}

export function usePlan(): Plan {
  const key = useStore((s) => s.licenseKey)
  const employees = useStore((s) => s.employees)
  const asOf = useStore((s) => s.asOf)
  const [license, setLicense] = useState<LicenseResult | null>(null)
  useEffect(() => {
    let alive = true
    if (!key) {
      setLicense(null)
      return
    }
    verifyLicense(key, today()).then((r) => alive && setLicense(r))
    return () => {
      alive = false
    }
  }, [key])
  const pro = !!license?.ok
  const activeCount = employees.filter((e) => !e.retireDate || e.retireDate >= asOf).length
  const limit = !PRO_ENFORCED ? null : pro ? (license?.ok && license.payload.n) || null : FREE_LIMIT
  return { pro, license, limit, activeCount, room: limit == null ? null : Math.max(0, limit - activeCount), enforced: PRO_ENFORCED }
}
