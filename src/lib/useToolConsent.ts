import { createContext, useContext } from 'react'
import type { createToolConsent } from './toolConsent'

export const ToolConsentContext = createContext<ReturnType<typeof createToolConsent> | null>(null)

export function useToolConsent() {
  const value = useContext(ToolConsentContext)
  if (!value) throw new Error('ToolConsentProvider is required')
  return value
}
