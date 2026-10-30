export type ToolAction = () => void

/** 公開情報・保存済みデータの閲覧と出力は、利用開始の同意で遮らない。 */
export function needsToolConsent(tab: string): boolean {
  return tab === 'leave' || tab === 'import' || tab === 'settings'
}

/** 同意待ちの操作は1件だけ保持し、閉じる・戻るでは破棄する。 */
export function createToolConsent(
  isAccepted: () => boolean,
  accept: () => void,
  onOpenChange: (open: boolean) => void,
) {
  let pending: ToolAction | null = null
  let confirming = false
  return {
    request(action: ToolAction) {
      if (isAccepted()) { action(); return }
      if (confirming) return
      if (pending) return
      pending = action
      onOpenChange(true)
    },
    cancel() {
      pending = null
      onOpenChange(false)
    },
    confirm(agreed: boolean) {
      if (!agreed || !pending || confirming) return false
      confirming = true
      try {
        if (!isAccepted()) accept()
        const action = pending
        pending = null
        onOpenChange(false)
        action()
        return true
      } finally {
        confirming = false
      }
    },
  }
}
