import { CheckCircle2, Download, FileUp, Upload, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  EMPLOYEE_FIELDS,
  findHeaderRow,
  guessMapping,
  LEAVE_FIELDS,
  parseText,
  readFile,
  type EmployeeField,
  type LeaveField,
  type Table,
} from '../lib/importer'
import { planEmployees, planLeaves } from '../lib/importPlan'
import { isISODate } from '../lib/dates'
import { usePlan } from '../lib/plan'
import { FREE_LIMIT } from '../config'
import { useStore } from '../store'
import { Badge, Button, Card, download, inputCls, Notice } from './ui'

type Mode = 'employees' | 'leaves'

const TEMPLATES: Record<Mode, string> = {
  employees: '社員番号,氏名,入社日,週の勤務日数,週の労働時間,退職日\n001,佐藤 花子,2019/04/01,5,40,\n002,田中 美咲,2022/10/01,3,18,\n',
  leaves: '社員番号,氏名,取得日,区分\n001,佐藤 花子,2026/05/10,全日\n002,田中 美咲,2026/05/12,午前\n',
}

export function ImportView({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('employees')
  const [table, setTable] = useState<Table>([])
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const [mapping, setMapping] = useState<Partial<Record<string, number>>>({})
  const [headerRow, setHeaderRow] = useState(0)
  const employees = useStore((s) => s.employees)
  const settings = useStore((s) => s.settings)
  const asOf = useStore((s) => s.asOf)
  const fields = mode === 'employees' ? EMPLOYEE_FIELDS : LEAVE_FIELDS
  const [trackStart, setTrackStart] = useState(asOf)
  const [migChecks, setMigChecks] = useState([false, false, false])
  const plan0 = usePlan()

  const load = (t: Table, name: string) => {
    setError('')
    if (t.length < 2) {
      setError('2行以上（見出し＋データ）の表を入れてください。')
      setTable([])
      return
    }
    const keys = fields.map((f) => f.key)
    const h = findHeaderRow(t, keys)
    setHeaderRow(h)
    setMapping(guessMapping(t[h], keys))
    setTable(t)
    setFileName(name)
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      load(await readFile(f), f.name)
    } catch (e) {
      setError(`ファイルを読めませんでした（${(e as Error).message}）。Excel（.xlsx）か CSV を使ってください。`)
    }
  }

  const plan = useMemo(() => {
    if (table.length === 0) return []
    return mode === 'employees'
      ? planEmployees(table, headerRow, mapping as Partial<Record<EmployeeField, number>>, employees, settings, asOf, trackStart)
      : planLeaves(table, headerRow, mapping as Partial<Record<LeaveField, number>>, employees, asOf)
  }, [table, headerRow, mapping, mode, employees, settings, asOf, trackStart])

  const ok = plan.filter((p) => p.status !== 'error')
  const bad = plan.filter((p) => p.status === 'error')
  const missingRequired = fields.filter((f) => f.required && mapping[f.key] == null)
  const leaveNeedsWho = mode === 'leaves' && mapping.name == null && mapping.code == null
  const migrating = mode === 'employees' && mapping.balance != null
  const migOk = !migrating || migChecks.every(Boolean)
  const newCount = ok.filter((p) => p.status === 'new').length
  const overLimit = plan0.room != null && newCount > plan0.room

  const apply = () => {
    const emps = ok.flatMap((p) => (p.employee ? [p.employee] : []))
    const ls = ok.flatMap((p) => p.leaves)
    useStore.getState().mergeImport(emps, ls)
    setTable([])
    setText('')
    setFileName('')
    onDone()
  }

  const headers = table[headerRow] ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ['employees', '従業員の名簿'],
            ['leaves', '休んだ日の記録'],
          ] as [Mode, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            onClick={() => {
              setMode(k)
              setTable([])
              setFileName('')
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${mode === k ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {table.length === 0 ? (
        <Card>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              onFile(e.dataTransfer.files[0])
            }}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}
          >
            <FileUp className="mx-auto mb-2 text-brand-600" size={36} />
            <p className="font-semibold text-slate-800">Excel・CSV ファイルをここに置く</p>
            <p className="mb-3 text-sm text-slate-500">ファイルはこのブラウザの中で読むだけで、どこにも送りません。</p>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
              <Upload size={16} /> ファイルを選ぶ
              <input type="file" accept=".xlsx,.xls,.csv,.txt,.tsv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">または、Excel の表をコピーして貼り付け（見出しの行も含めて）</label>
            <textarea className={`${inputCls} font-mono text-sm`} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={TEMPLATES[mode].replace(/,/g, '\t')} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" disabled={!text.trim()} onClick={() => load(parseText(text), '貼り付け')}>
                読み取る
              </Button>
              <Button onClick={() => download(`有休ポン_${mode === 'employees' ? '名簿' : '取得記録'}_見本.csv`, '﻿' + TEMPLATES[mode], 'text/csv')}>
                <Download size={16} /> 見本の CSV
              </Button>
            </div>
          </div>
          {error && (
            <div className="mt-3">
              <Notice tone="warn">{error}</Notice>
            </div>
          )}
          <div className="mt-4 text-sm text-slate-600">
            {mode === 'employees' ? (
              <p>
                必要な列は<strong>氏名・入社日</strong>だけ。<strong>週の勤務日数</strong>（空なら週5日）と<strong>週の労働時間</strong>があるとパートの比例付与を正しく判定できます。
                Excel から引っ越すときは<strong>今の残日数</strong>の列も入れてください。同じ名前（または社員番号）の人は上書きします。
              </p>
            ) : (
              <p>
                必要な列は<strong>氏名（または社員番号）・取得日</strong>。区分（全日／午前／午後）が無ければ全日として数えます。登録済みの日は二重に入りません。
              </p>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-slate-800">
                列の対応 <span className="text-sm font-normal text-slate-500">（{fileName}・{table.length - headerRow - 1}行）</span>
              </h2>
              <label className="flex items-center gap-2 text-sm">
                見出しの行
                <select className={`${inputCls} !w-auto !py-1`} value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                  {table.slice(0, 10).map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1}行目
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <label key={f.key} className="block text-sm">
                  <span className="font-medium text-slate-700">
                    {f.label}
                    {f.required && <span className="text-red-600"> *</span>}
                  </span>
                  <select
                    className={`${inputCls} mt-1 !py-1.5`}
                    value={mapping[f.key] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                  >
                    <option value="">（使わない）</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {String.fromCharCode(65 + (i % 26))}列: {h || '（見出しなし）'}
                      </option>
                    ))}
                  </select>
                  {f.hint && <span className="mt-0.5 block text-xs text-slate-500">{f.hint}</span>}
                </label>
              ))}
            </div>
          </Card>

          {migrating && (
            <Card className="!border-amber-200">
              <h2 className="mb-1 font-bold text-slate-800">Excel からの引っ越し（今の残日数を引き継ぐ）</h2>
              <p className="mb-3 text-sm text-slate-600">
                「今の残日数」の列があるので、次のルールで引き継ぎます。取り込む前に、Excel・賃金台帳の数字と照らして確認してください。
              </p>
              <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                <li>
                  <strong>管理開始日</strong>より前の付与と取得は計算に入れず、その日の残日数を出発点にします。
                </li>
                <li>
                  残日数は、<strong>直近の付与から順に</strong>割り当てます（例: 残15日、直近の付与が11日なら「直近11日＋前回分4日」）。時効が遅い方に寄せるので、働く人に不利になりません。違うときは、取り込み後に各人の「残高・移行」で直せます。
                </li>
                <li>管理開始日より前に休んだ日を入れた場合は、残日数からは引かず、年5日の集計にだけ使います。管理開始より前に終わった期間は、年5日を判定しません。</li>
              </ol>
              <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                管理開始日（残日数を数えた日）
                <input type="date" className={`${inputCls} !w-auto !py-1`} value={trackStart} onChange={(e) => isISODate(e.target.value) && setTrackStart(e.target.value)} />
              </label>
              <div className="space-y-1.5 rounded-lg bg-amber-50 p-3 text-sm">
                {['残日数は、上の管理開始日の時点の数字である', '下の一覧の割り当て（付与日ごとの日数）を見て、Excel の内容と合っていることを確認した', '今期すでに休んだ日がある人は、取り込み後に「休んだ日」へ入れる（年5日の集計のため）'].map((t, i) => (
                  <label key={i} className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={migChecks[i]} onChange={(e) => setMigChecks(migChecks.map((c, j) => (j === i ? e.target.checked : c)))} />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </Card>
          )}

          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <p className="text-sm">
                <span className="font-semibold text-brand-800">取り込める {ok.length}件</span>
                {bad.length > 0 && <span className="ml-3 font-semibold text-red-700">直してほしい {bad.length}件（取り込みません）</span>}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setTable([])}>
                  やり直す
                </Button>
                <Button size="sm" variant="primary" disabled={ok.length === 0 || missingRequired.length > 0 || leaveNeedsWho || !migOk || overLimit} onClick={apply}>
                  <CheckCircle2 size={16} /> {ok.length}件を取り込む
                </Button>
              </div>
            </div>
            {overLimit && (
              <div className="px-4 pt-3">
                <Notice tone="warn">
                  無料で管理できる在籍中の人数は{FREE_LIMIT}人までです（新しく{newCount}人、あと{plan0.room}人まで追加できます）。設定の「料金プラン」で Pro のキーを入れるか、行を減らしてください。
                </Notice>
              </div>
            )}
            {migrating && !migOk && (
              <div className="px-4 pt-3">
                <Notice tone="warn">「Excel からの引っ越し」の確認にチェックを入れると取り込めます。</Notice>
              </div>
            )}
            {(missingRequired.length > 0 || leaveNeedsWho) && (
              <div className="px-4 pt-3">
                <Notice tone="warn">
                  {leaveNeedsWho ? '「氏名」か「社員番号」の列を選んでください。' : `「${missingRequired.map((f) => f.label).join('」「')}」の列を選んでください。`}
                </Notice>
              </div>
            )}
            <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
              {plan.map((p) => (
                <li key={p.line} className="flex gap-3 px-4 py-2 text-sm">
                  <span className="w-12 shrink-0 text-xs text-slate-400">{p.line}行目</span>
                  <span className="shrink-0">
                    {p.status === 'error' ? (
                      <XCircle size={16} className="text-red-600" />
                    ) : (
                      <Badge level={p.status === 'new' ? 'done' : 'ok'}>{p.status === 'new' ? (mode === 'leaves' ? '追加' : '新規') : '更新'}</Badge>
                    )}
                  </span>
                  <div className="min-w-0">
                    <span className="font-medium">{p.label}</span>
                    {p.leaves.length > 0 && <span className="ml-2 text-slate-500">取得 {p.leaves.length}件</span>}
                    {p.errors.map((e) => (
                      <p key={e} className="text-red-700">
                        {e}
                      </p>
                    ))}
                    {p.notes.map((n) => (
                      <p key={n} className="text-xs text-slate-500">
                        {n}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
              {plan.length === 0 && <li className="px-4 py-6 text-center text-slate-500">データの行がありません。見出しの行を確かめてください。</li>}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
