import { useEffect, useState } from 'react'
import { FREE_LIMIT, PRO_ENFORCED } from '../config'
import { useStore } from '../store'
import { today } from './dates'
import { verifyLicense, type LicenseResult } from './license'

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
