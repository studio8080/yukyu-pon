import { GRANT_TABLE, TENURE_LABEL } from '../lib/engine'
import { Card, PageHead } from './ui'

const ROWS: [string, keyof typeof GRANT_TABLE][] = [
  ['週5日以上 または 週30時間以上', 5],
  ['週4日（年169〜216日）', 4],
  ['週3日（年121〜168日）', 3],
  ['週2日（年73〜120日）', 2],
  ['週1日（年48〜72日）', 1],
]

export function GuideView() {
  return (
    <div className="space-y-4">
      <PageHead label="ルール">計算<small>の</small>ルール</PageHead>
      <Card>
        <h2 className="mb-3 font-display text-lg text-ink">法律で決まっていること</h2>
        <div className="space-y-4 text-sm leading-relaxed text-slate-700">
          <section>
            <h3 className="font-bold text-ink">付与する日数（労働基準法39条）</h3>
            <p>入社から6か月続けて働き、出勤率が8割以上なら付与します。その後は1年ごと。日数は、付与する日の時点の契約で決まります。</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-center text-xs">
                <thead className="bg-paper">
                  <tr>
                    <th className="px-2 py-1 text-left">勤続</th>
                    {TENURE_LABEL.map((t) => (
                      <th key={t} className="px-2 py-1">
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular">
                  {ROWS.map(([l, k]) => (
                    <tr key={k}>
                      <td className="px-2 py-1 text-left">{l}</td>
                      {GRANT_TABLE[k].map((d, i) => (
                        <td key={i} className={`px-2 py-1 ${d >= 10 ? 'font-semibold text-brand-800' : ''}`}>
                          {d}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-slate-500">太字は10日以上（年5日の取得義務がかかる回）。</p>
          </section>
          <section>
            <h3 className="font-bold text-ink">年5日の取得義務（39条7項）</h3>
            <p>
              10日以上付与した人には、付与日から1年以内に5日を取ってもらう必要があります。本人が取った日・計画的付与の日も数えます。半休は0.5日で数えます。時間単位の年休は数えません。
              守れなかった場合、対象の1人ごとに30万円以下の罰金の対象になります（120条）。
            </p>
          </section>
          <section>
            <h3 className="font-bold text-ink">半休・時間単位</h3>
            <p>
              半休（半日単位）は、労働者が希望し会社が認めれば使えます。0.5日として残日数から引き、年5日にも0.5日で数えます。
              時間単位の年休は労使協定が必要で、1年に5日分までです（39条4項）。「1日＝何時間」は1日の所定労働時間で、1時間未満は切り上げます（労基則24条の4）。時間単位で取った分は年5日には数えません。
            </p>
          </section>
          <section>
            <h3 className="font-bold text-ink">出勤率8割（39条1項・2項）</h3>
            <p>
              前の期間（初回は入社から6か月、その後は前回の付与から1年）の出勤率が8割未満なら、その回は付与しません。有休ポンは出勤日の記録を持たないので自動では計算しません。
              代わりに、付与日の1か月前からホームに「出勤率の確認」を出し、確認した記録を残します。計算機で「働く予定だった日」と「出勤した日」から出勤率を出せます。
            </p>
          </section>
          <section>
            <h3 className="font-bold text-ink">時効（115条）</h3>
            <p>付与日から2年で消えます。使わなかった分は翌年に繰り越せますが、その次の年には消えます。</p>
          </section>
          <section>
            <h3 className="font-bold text-ink">管理簿（労働基準法施行規則24条の7）</h3>
            <p>労働者ごとに、基準日・日数・時季（取得した日）を記録し、期間の満了後5年間（経過措置で当分の間は3年間）保存します。「管理簿」タブから Excel か PDF で出力できます。</p>
          </section>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-lg text-ink">有休ポンが決めているルール（使う前に就業規則と照らしてください）</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>一斉付与の前倒し:</strong> 前の付与から1年以内に来る「毎年の付与日」へ早めます。早めた回は次の段階の日数（10→11→12日…）を付与し、法律の基準日より遅れることはありません。早めて短くなった期間は、全部出勤したものとみなします。一斉付与に切り替えるときは、この内容を就業規則と照らす確認をしてもらいます。
          </li>
          <li>
            <strong>Excel からの引っ越し:</strong> 「管理開始日」の残日数を出発点にします。残日数は直近の付与から順に割り当て（時効が遅い方に寄せる＝働く人に不利にならない）、各人の「残高・移行」で直せます。管理開始日より前に休んだ日は、残日数から引かず年5日の集計にだけ使います。取り込む前に、Excel と照らす確認をしてもらいます。
          </li>
          <li>
            <strong>どの付与分から引くか:</strong> 既定は古い付与分（繰り越し分）から。法律の決まりはないので、設定で変えられます。
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-lg text-ink">扱っていないこと</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>10日を分けて付与する方法</strong>（例: 入社日に5日、3か月後に残り5日）。入社直後から少しずつ使えるようにする会社向けの方法ですが、小さな会社ではほとんど使われません。必要なら、付与日数の上書きと「会社独自の上乗せ」で近い形にできます。
          </li>
          <li>
            <strong>年5日の期間が重なったときの按分</strong>。一斉付与に切り替えた年などは、2回の付与が1年以内に続き、年5日を数える期間が重なります。法律では、重なった2つの期間をまとめて「月数÷12×5日」を取らせる方法も認められています（労基則24条の5）。有休ポンはまとめず、それぞれの期間で5日を確かめます。こちらの方が厳しい側なので、守れていれば違反にはなりません。
          </li>
          <li>
            <strong>出勤率の自動計算</strong>。上のとおり、付与の前に確認を促して記録する形にしています。
          </li>
          <li>
            <strong>休職・産休育休中の扱い</strong>や、試用期間の扱いなど会社ごとの細かな規定。必要なら付与日数を手で直してください。
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          計算は労働基準法と厚生労働省の解説にもとづいていますが、個別の事情（就業規則・労使協定）までは判断できません。計算結果は、使う前に必ず就業規則・法令と照らして確認してください。判断に迷うときは、社会保険労務士や労働基準監督署に相談できます。
        </p>
      </Card>
    </div>
  )
}
