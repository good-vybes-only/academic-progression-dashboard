  // src/main.tsx (or at the top of App.tsx)
  import './theme.css'

  import { useEffect, useMemo, useRef, useState } from "react"
  import cls from "classnames"
  import {
    LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
  } from "recharts"

  type AssessTemplate = { name: string; max: number }
  type Assess = { name: string; max: number; score: number | null }
  type Subject = { name: string; assessments: Assess[] }
  type State = { targetPct: number; template: AssessTemplate[]; subjects: Subject[] }

  const STORAGE_KEY = "acad_progress_v1"

  // Default assessment template (editable)
  const DEFAULT_TEMPLATE: AssessTemplate[] = [
    { name: "CIA 1", max: 15 },
    { name: "CIA 2", max: 25 },
    { name: "CIA 3", max: 15 },
    { name: "CIA 4", max: 30 },
    { name: "CP",    max: 15 },
  ]

  const blankState = (): State => ({
    targetPct: 70,
    template: [...DEFAULT_TEMPLATE],
    subjects: [{
      name: "Subject 1",
      assessments: DEFAULT_TEMPLATE.map(t => ({ ...t, score: null }))
    }]
  })

  // ---------- helpers ----------
  function subjectTotals(s: Subject){
    let earned = 0, max = 0
    s.assessments.forEach(a => {
      max += a.max
      if(a.score !== null && a.score !== undefined) earned += a.score
    })
    return { earned, max }
  }
  function subjectPct(s: Subject){
    const {earned, max} = subjectTotals(s)
    return max ? (earned/max)*100 : 0
  }
  function remainingPoints(s: Subject){
    return s.assessments.reduce((acc,a)=> acc + (a.score==null ? a.max : 0), 0)
  }

  function plannedDistribution(subj: Subject, targetPct: number){
    // totals now
    const earnedNow = subj.assessments.reduce((s,a)=> s + (a.score ?? 0), 0)
    const totalMax  = subj.assessments.reduce((s,a)=> s + a.max, 0)
    const targetPts = (targetPct/100)*totalMax

    // find first pending (the "next")
    const nextIdx = subj.assessments.findIndex(a => a.score == null)
    if (nextIdx < 0) {
      // nothing remaining
      return { rows: [], earned: earnedNow, max: totalMax }
    }

    // compute next needed using the same rule as the blue bar
    const { earned: sofarEarned, max: sofarMax } = totalsSoFar(subj)
    const next = subj.assessments[nextIdx]
    const rawNeedNext = Math.ceil(((targetPct/100) * (sofarMax + next.max)) - sofarEarned)
    const nextNeeded = Math.max(0, Math.min(rawNeedNext, next.max))
    // feasibility for the next one (still show clamped value even if not feasible by formula)
    const nextFeasible = rawNeedNext <= next.max && rawNeedNext >= 0

    // pretend we achieved the next minimum
    const earnedAfterNext = earnedNow + nextNeeded

    // collect the remaining (after next) pending assessments
    const remaining = subj.assessments
      .map((a,i)=> ({...a, idx:i}))
      .filter((a,i)=> a.score == null && i !== nextIdx)

    const remTotalMax = remaining.reduce((s,a)=> s + a.max, 0)
    // marks still needed after achieving the next minimum
    const needAfterNext = Math.max(0, Math.ceil(targetPts - earnedAfterNext))

    // distribute proportionally by max across the remaining
    const restRows = remaining.map(a => {
      const share = remTotalMax > 0 ? Math.ceil((needAfterNext/remTotalMax) * a.max) : 0
      const clamped = Math.max(0, Math.min(share, a.max))
      const feasible = share <= a.max && share >= 0 ? "Yes" : "No"
      return {
        Assessment: a.name,
        "Needed (raw)": clamped,
        Max: a.max,
        "Feasible?": feasible
      }
    })

    // next row first, then the rest
    const rows = [
      {
        Assessment: next.name,
        "Needed (raw)": nextNeeded,
        Max: next.max,
        "Feasible?": nextFeasible ? "Yes" : "No"
      },
      ...restRows
    ]

    return { rows, earned: earnedNow, max: totalMax }
  }

  function overallPct(subjects: Subject[]){
    if(!subjects.length) return 0
    return subjects.reduce((s,x)=>s+subjectPct(x),0)/subjects.length
  }

  // So-far only
  function totalsSoFar(subj: Subject){
    let earned = 0, max = 0
    subj.assessments.forEach(a=>{
      if(a.score!=null){ earned += a.score; max += a.max }
    })
    return { earned, max }
  }
  function totalsSoFarAll(subjects: Subject[]){
    let earned = 0, max = 0
    subjects.forEach(s=>{
      s.assessments.forEach(a=>{
        if(a.score!=null){ earned += a.score; max += a.max }
      })
    })
    return { earned, max }
  }
  function subjectPctSoFar(s: Subject){
    const { earned, max } = totalsSoFar(s)
    return max ? (earned/max)*100 : 0
  }

  // Next remaining
  function nextRemaining(subj: Subject){
    const idx = subj.assessments.findIndex(a=>a.score==null)
    return { idx, a: idx>=0 ? subj.assessments[idx] : null }
  }
  // Needed in the *next* assessment to stay on track
  function neededNextForTarget(subj: Subject, targetPct: number){
    const { idx, a } = nextRemaining(subj)
    if(idx<0 || !a) return null
    const { earned, max } = totalsSoFar(subj)
    const targetPointsAfterNext = (targetPct/100) * (max + a.max)
    const need = Math.ceil(targetPointsAfterNext - earned)
    const neededRaw = Math.max(0, Math.min(need, a.max))
    const feasible = need <= a.max
    return { idx, name: a.name, neededRaw, max: a.max, feasible }
  }
  // Subject shortfall if everything remaining is full marks
  function subjectShortfall(subj: Subject, targetPct: number){
    const earned = subj.assessments.reduce((s,a)=> s + (a.score ?? 0), 0)
    const totalMax = subj.assessments.reduce((s,a)=> s + a.max, 0)
    const remainingMax = subj.assessments.filter(a=>a.score==null).reduce((s,a)=> s + a.max, 0)
    const maxPossible = earned + remainingMax
    const neededTotal = (targetPct/100) * totalMax
    const short = Math.ceil(neededTotal - maxPossible)
    return short > 0 ? short : 0
  }
  function remainingBySubject(subjects: Subject[]){
    return subjects
      .map(s=>({ name: s.name, remaining: s.assessments.filter(a=>a.score==null).reduce((t,a)=>t+a.max,0) }))
      .filter(x=>x.remaining>0)
  }
  function subjectStatus(s: Subject, targetPct: number){
    const short = subjectShortfall(s, targetPct)
    if (short > 0) return {state:"off", label:`Off Track • short by ${short}`, color:"#ef4444"}
    const next = neededNextForTarget(s, targetPct)
    if (!next) return {state:"on", label:"On Track", color:"#16a34a"}
    const needPctOfNext = (next.neededRaw / next.max) * 100
    if (!next.feasible) return {state:"off", label:"Off Track", color:"#ef4444"}
    if (needPctOfNext > 85) return {state:"risk", label:"At Risk", color:"#f59e0b"}
    return {state:"on", label:"On Track", color:"#16a34a"}
  }

  // Chart data: average % per assessment across subjects
  function avgPctPerAssessment(subjects: Subject[], template: AssessTemplate[]){
    return template.map(t => {
      let sum = 0, n = 0
      subjects.forEach(s=>{
        const a = s.assessments.find(x => x.name === t.name)
        if (a && a.score != null) { sum += (a.score / a.max) * 100; n += 1 }
      })
      return { name: t.name, actualPct: n ? +(sum/n).toFixed(2) : 0 }
    })
  }

  // Re-apply template to every subject (preserve existing scores by index)
  function applyTemplateToSubjects(subjects: Subject[], template: AssessTemplate[]): Subject[] {
    return subjects.map(s => ({
      ...s,
      assessments: template.map((t, i) => ({
        name: t.name,
        max: t.max,
        score: s.assessments[i]?.score ?? null
      }))
    }))
  }
  function assessmentSumData(subjects: Subject[], template: {name:string; max:number}[]){
    return template.map(t => {
      let total = 0
      let totalMax = 0
      const row: Record<string, any> = { name: t.name }

      subjects.forEach(s => {
        const a = s.assessments.find(x => x.name === t.name)
        const v = a?.score ?? 0
        row[s.name] = v
        total += v
        totalMax += a?.max ?? 0
      })

      row.total = +total.toFixed(2)
      row.totalMax = totalMax
      return row
    })
  }

  function SumTooltip({ active, payload, label }:{
  active?: boolean,
  payload?: any[],
  label?: string
}){
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload // our row
  const subjectNames = Object.keys(d).filter(k => !["name","total","totalMax"].includes(k))

  return (
    <div
      style={{
        background: "rgba(15,23,42,0.98)",      // deep navy
        border: "1px solid #1f2937",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
        fontSize: 13,
        color: "#e5e7eb",                        // light gray text
        minWidth: 180
      }}
    >
      <div style={{fontWeight: 700, marginBottom: 6, color: "#f9fafb"}}>
        {label}
      </div>
      <div style={{display: "grid", gap: 4}}>
        {subjectNames.map(n => (
          <div
            key={n}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12
            }}
          >
            <span style={{opacity: 0.8}}>{n}</span>
            <span>{d[n]}</span>
          </div>
        ))}
        <div
          style={{
            marginTop: 6,
            borderTop: "1px dashed rgba(148,163,184,0.5)",
            paddingTop: 6,
            display: "flex",
            justifyContent: "space-between"
          }}
        >
          <strong>Total</strong>
          <strong>{d.total} / {d.totalMax}</strong>
        </div>
      </div>
    </div>
  )
}

  // ---------- App ----------
  export default function App(){
    const [state, setState] = useState<State>(() => {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return blankState()
      try {
        const parsed = JSON.parse(saved)
        // migrate old shape that had no template
        if (!parsed.template) {
          const template = [...DEFAULT_TEMPLATE]
          const subjects: Subject[] = (parsed.subjects || []).map((s: any) => ({
            name: s.name ?? "Subject",
            assessments: template.map((t, i) => ({
              name: t.name, max: t.max, score: s.assessments?.[i]?.score ?? null
            }))
          }))
          return { targetPct: parsed.targetPct ?? 70, template, subjects }
        }
        return parsed
      } catch {
        return blankState()
      }
    })
    useEffect(()=>{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) },[state])

    const [tab, setTab] = useState<"Dashboard"|"Subject-wise"|"Setup"|"Instructions">("Dashboard")

    const overall = useMemo(()=> overallPct(state.subjects), [state.subjects])
    const totals = useMemo(()=>{
      const earned = state.subjects.reduce((s,x)=> s+subjectTotals(x).earned,0)
      const max = state.subjects.reduce((s,x)=> s+subjectTotals(x).max,0)
      return {earned, max}
    },[state.subjects])

    // Upload/Download JSON
    const fileRef = useRef<HTMLInputElement>(null)
    const onUpload = (f?: File) => {
      if(!f) return
      const reader = new FileReader()
      reader.onload = () => {
        try{
          const obj = JSON.parse(String(reader.result))
          // if uploaded file is old shape, migrate here too
          if (!obj.template) {
            const template = [...DEFAULT_TEMPLATE]
            const subjects: Subject[] = (obj.subjects || []).map((s: any) => ({
              name: s.name ?? "Subject",
              assessments: template.map((t, i) => ({
                name: t.name, max: t.max, score: s.assessments?.[i]?.score ?? null
              }))
            }))
            setState({ targetPct: obj.targetPct ?? 70, template, subjects })
          } else {
            setState(obj)
          }
        }catch(e){ alert("Invalid JSON") }
      }
      reader.readAsText(f)
    }

    // Setup helpers
    const addSubject = () =>
      setState(s => ({
        ...s,
        subjects: [
          ...s.subjects,
          { name: `Subject ${s.subjects.length+1}`, assessments: s.template.map(t => ({...t, score: null})) }
        ]
      }))

    const resetOne = () =>
      setState(s => ({
        ...s,
        subjects: [{ name: "Subject 1", assessments: s.template.map(t => ({...t, score: null})) }]
      }))

    const deleteSubject = (i:number)=> setState(s=>({...s, subjects: s.subjects.filter((_,idx)=>idx!==i)}))

    // snap to nearest 5, clamp 60–100
    const updateTargetPct = (raw: number) => {
      const n = Number(raw); if (Number.isNaN(n)) return;
      const snapped = Math.round(n / 5) * 5;
      const clamped = Math.min(100, Math.max(60, snapped));
      setState(s => ({ ...s, targetPct: clamped }));
    };

    return (
      <div className="container">
        {/* topbar */}
        <div className="topbar">
          <div>
            <div className="brand">Academic Progression Dashboard</div>
            <div className="badge">Target: {state.targetPct}% overall</div>
          </div>
          <div className="actions">
            <input ref={fileRef} type="file" accept="application/json" style={{display:"none"}} onChange={(e)=>onUpload(e.target.files?.[0] || undefined)} />
            <button className="btn secondary" onClick={()=>fileRef.current?.click()}>Upload Marks JSON</button>
            <button
              className="btn"
              onClick={()=>{
                const blob = new Blob([JSON.stringify(state,null,2)],{type:"application/json"})
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url; a.download = "my_marks_setup.json"; a.click()
                URL.revokeObjectURL(url)
              }}>
              Download / Save Marks
            </button>
          </div>
        </div>

        {/* tabs */}
        <div className="tabs">
          {["Dashboard","Subject-wise","Setup","Instructions"].map(t=>(
            <button key={t} className={cls("tab", {active: tab===t})} onClick={()=>setTab(t as any)}>{t}</button>
          ))}
        </div>

        {/* content */}
        {tab==="Dashboard" && (() => {
          const overallSoFar = state.subjects.length
            ? state.subjects.reduce((sum,s)=> sum + subjectPctSoFar(s), 0) / state.subjects.length
            : 0
          const totalsSoFar = totalsSoFarAll(state.subjects)

          return (
            <div className="grid">
              <div className="grid grid-2">
                <div className="card blue">
                  <h3>Overall Current Percentage</h3>
                  <div style={{fontSize:42,fontWeight:800}}>{overallSoFar.toFixed(1)}%</div>
                  <div style={{opacity:.9}}>{overallSoFar>=state.targetPct ? "Target Achieved! 🎉" : "Keep going!"}</div>
                </div>
                <div className="card green">
                  <h3>Overall Current Marks</h3>
                  <div style={{fontSize:38,fontWeight:800}}>
                    {totalsSoFar.earned.toFixed(1)} / {totalsSoFar.max.toFixed(0)}
                  </div>
                  <div>Total marks scored across completed assessments</div>
                </div>
              </div>

              <div className="card chart">
                <h3>Assessment Totals (Sum across subjects)</h3>
                <p className="badge" style={{background:"transparent",color:"var(--muted)"}}>
                  Hover to see each subject’s marks and the total for that assessment.
                </p>
                <div style={{height:280}}>
                  <ResponsiveContainer width="100%" height="100%">
                    {(() => {
                      const data = assessmentSumData(state.subjects, state.template ?? TEMPLATE.map(a=>({name:a.name, max:a.max})))
                      const maxTotal = Math.max(100, ...data.map(d => d.totalMax || 0)) // keep a sensible floor

                      return (
                        <LineChart data={data}>
                          <CartesianGrid stroke="#eee" />
                          <XAxis dataKey="name" />
                          <YAxis domain={[0, maxTotal]} />
                          <Tooltip content={<SumTooltip />} />
                          <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={3} dot={{r:4}} name="Total scored" />
                        </LineChart>
                      )
                    })()}
                  </ResponsiveContainer>
                </div>
              </div>


              <div className="grid grid-4">
                <div className="kpi">
                  <h4>Progress to Target</h4>
                  <div className="big">{overallSoFar.toFixed(1)}%</div>
                  <div className="badge">Target: {state.targetPct}%</div>
                </div>
                <div className="kpi">
                  <h4>Subjects Tracked</h4>
                  <div className="big">{state.subjects.length}</div>
                  <div className="badge">Active subjects</div>
                </div>
                <div className="kpi">
                  <h4>Assessments Completed</h4>
                  <div className="big">
                    {state.subjects.reduce((sum,s)=> sum + s.assessments.filter(a=>a.score!=null).length,0)}
                  </div>
                  <div className="badge">Marks entered</div>
                </div>
                <div className="kpi">
                  <h4>Assessments Pending</h4>
                  <div className="big">
                    {state.subjects.reduce((sum,s)=> sum + s.assessments.filter(a=>a.score==null).length,0)}
                  </div>
                  <div className="badge">Yet to complete</div>
                </div>
              </div>

              <div className="card card-subjects">
                <h3>Subject-wise Progress</h3>
                <div className="subgrid">
                  {state.subjects.map((s, i) => {
                    const pct = subjectPctSoFar(s)
                    const status = subjectStatus(s, state.targetPct)
                    const chipClass =
                      status.state==="on" ? "badge stat-ok" :
                      status.state==="risk" ? "badge stat-warn" : "badge stat-bad"
                    const next = neededNextForTarget(s, state.targetPct)

                    return (
                      <div key={i} className="subcard">
                        <div className="subhead">
                          <div style={{fontWeight:800}}>{s.name}</div>
                          <div className="badge-chip">{pct.toFixed(1)}%</div>
                        </div>

                        <div style={{marginTop:8, marginBottom:10}}>
                          <div className="progress">
                            <div className="bar" style={{width:`${Math.min(100, Math.max(0, pct))}%`}} />
                          </div>
                        </div>

                        <div className={chipClass} style={{display:"inline-block"}}>
                          {status.label}
                        </div>

                        {next && (
                          <div className="badge" style={{marginLeft:8}}>
                            Next: <b>{next.name}</b> — need <b>{next.neededRaw}/{next.max}</b>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

        {tab==="Subject-wise" && (
          <div className="grid">
            <div className="card subject-shell">
              <h3>Select Subject</h3>
              {state.subjects.length===0 ? (
                <p className="badge">Add a subject in Setup.</p>
              ) : (
                <SubjectEditor
                  state={state}
                  onChange={setState}
                />
              )}
            </div>
          </div>
        )}

        {tab==="Setup" && (
          <div className="grid">
            <div className="card setup-shell">
              {/* top row */}
              <div className="toolbar">
                <h3 className="setup-title">Start Fresh</h3>
                <div className="sliderwrap">
                  <span className="badge">🎯 Target overall %</span>
                  <input
                    className="range"
                    type="range"
                    min={60}
                    max={100}
                    step={5}
                    value={state.targetPct}
                    onChange={(e) => updateTargetPct(Number(e.currentTarget.value))}
                  />
                  <span className="badge-strong">{state.targetPct}%</span>
                </div>
              </div>

              {/* add / reset subjects */}
              <div className="selectrow setup-section" style={{marginTop:12}}>
                <input
                  className="input"
                  placeholder="Enter subject name"
                  id="newsub"
                />
                <button
                  className="btn secondary"
                  onClick={() => {
                    const el = document.getElementById("newsub") as HTMLInputElement
                    const name = (el.value || "").trim()
                    if (!name) return
                    setState(s => ({
                      ...s,
                      subjects: [
                        ...s.subjects,
                        { name, assessments: s.template.map(t => ({ ...t, score: null })) }
                      ]
                    }))
                    el.value = ""
                  }}
                >
                  + Add
                </button>
                <button className="btn secondary" onClick={resetOne}>
                  Reset to 1 Subject
                </button>
              </div>

              {/* subject names list */}
              <div className="setup-section" style={{marginTop:12}}>
                {state.subjects.map((s,i)=>(
                  <div key={i} className="row" style={{gridTemplateColumns:"1fr auto"}}>
                    <input
                      className="input"
                      value={s.name}
                      onChange={e=>{
                        const v = e.target.value
                        setState(st => {
                          const copy = [...st.subjects]
                          copy[i] = { ...copy[i], name: v }
                          return { ...st, subjects: copy }
                        })
                      }}
                    />
                    <button
                      className="btn secondary"
                      onClick={()=>deleteSubject(i)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <hr className="setup-divider" />

              {/* Editable Assessment Template */}
              <h3 className="setup-subtitle">Assessment Structure (applies to all subjects)</h3>

              <table className="table setup-table-head">
                <thead>
                  <tr>
                    <th>Assessment</th>
                    <th>Max Marks</th>
                    <th></th>
                  </tr>
                </thead>
              </table>

              {state.template.map((t, idx) => (
                <div
                  key={idx}
                  className="row"
                  style={{gridTemplateColumns:"1fr 1fr auto"}}
                >
                  <input
                    className="input"
                    value={t.name}
                    onChange={(e) => {
                      const name = e.target.value
                      setState(s => {
                        const template = s.template.map((x,i)=> i===idx ? {...x, name} : x)
                        const subjects = applyTemplateToSubjects(s.subjects, template)
                        return { ...s, template, subjects }
                      })
                    }}
                  />
                  <input
                    className="input"
                    type="number"
                    value={t.max}
                    onChange={(e) => {
                      const max = Math.max(1, +e.target.value || 1)
                      setState(s => {
                        const template = s.template.map((x,i)=> i===idx ? {...x, max} : x)
                        const subjects = applyTemplateToSubjects(s.subjects, template)
                        return { ...s, template, subjects }
                      })
                    }}
                  />
                  <button
                    className="btn secondary"
                    onClick={()=>{
                      setState(s=>{
                        if (s.template.length <= 1) return s
                        const template = s.template.filter((_,i)=> i!==idx)
                        const subjects = applyTemplateToSubjects(s.subjects, template)
                        return { ...s, template, subjects }
                      })
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <div className="setup-actions">
                <button
                  className="btn secondary"
                  onClick={()=>{
                    setState(s=>{
                      const template = [
                        ...s.template,
                        { name:`Assessment ${s.template.length+1}`, max:10 }
                      ]
                      const subjects = applyTemplateToSubjects(s.subjects, template)
                      return { ...s, template, subjects }
                    })
                  }}
                >
                  + Add assessment
                </button>

                <button
                  className="btn secondary"
                  onClick={()=>{
                    setState(s=>{
                      const template = [...DEFAULT_TEMPLATE]
                      const subjects = applyTemplateToSubjects(s.subjects, template)
                      return { ...s, template, subjects }
                    })
                  }}
                >
                  Reset to default
                </button>
              </div>
            </div>
          </div>
        )}

        {tab==="Instructions" && (
          <div className="grid">
            <div className="card instructions-card">
              <h3 className="instructions-title">What does each tab do?</h3>

              <ul className="instructions-list">
                <li>
                  <b>Setup:</b> Edit the assessment structure (add/remove/rename, change max) and add subjects.
                </li>
                <li>
                  <b>Subject-wise:</b> Pick a subject and enter marks as you finish assessments.
                </li>
                <li>
                  <b>Dashboard:</b> See your overall % so far, target vs actual chart, and subject health.
                </li>
                <li>
                  <b>Save/Load:</b> Download your marks JSON and upload it later. Data stays in your browser only.
                </li>
              </ul>

              <h4 className="instructions-subtitle">For new users</h4>
              <ol className="instructions-steps">
                <li>Go to <b>Setup</b> and add all your subjects.</li>
                <li>In the same tab, set up your <b>assessment structure</b> (CIA 1, CIA 2, CIA 3, CIA 4, CP, etc. and their max marks).</li>
                <li>Switch to <b>Subject-wise</b> and start entering marks for each subject as you get them.</li>
                <li>Check the <b>Dashboard</b> to see your progress to target and minimum marks needed in upcoming assessments.</li>
                <li>When you’re done, go back to the top bar and click <b>Download / Save Marks</b> to save your
                  <code> my_marks_setup.json</code> file for next time.</li>
              </ol>

              <h4 className="instructions-subtitle">For returning users</h4>
              <ol className="instructions-steps">
                <li>Click <b>Upload Marks JSON</b> and select your saved
                  <code> my_marks_setup.json</code> file.</li>
                <li>Your subjects, assessment structure, and old marks will load automatically.</li>
                <li>Go to <b>Subject-wise</b> and continue updating marks where you left off.</li>
                <li>Review your updated progress in the <b>Dashboard</b>.</li>
                <li>Download a fresh <code>my_marks_setup.json</code> when you’re done so you can load it again later.</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    )
  } 


  function SubjectEditor({ state, onChange }: { state: State; onChange: (s: State) => void }) {
  const [idx, setIdx] = useState(0)

  const subj = state.subjects[idx] ?? state.subjects[0]

  useEffect(() => {
    if (idx > state.subjects.length - 1) setIdx(0)
  }, [state.subjects.length, idx])

  const { rows } = useMemo(
    () => plannedDistribution(subj, state.targetPct),
    [subj, state.targetPct]
  )

  return (
    <>
      {/* selector + blue info bar */}
      <div className="selectrow">
        <select
          value={idx}
          onChange={(e) => setIdx(+e.target.value)}
          className="input"
          style={{ maxWidth: 300 }}
        >
          {state.subjects.map((s, i) => (
            <option key={i} value={i}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="helper" style={{ flex: 1 }}>
          {(() => {
            const sofar = totalsSoFar(subj)
            const currentPctSoFar = sofar.max ? (sofar.earned / sofar.max) * 100 : 0
            const nextNeed = neededNextForTarget(subj, state.targetPct)
            const short = subjectShortfall(subj, state.targetPct)

            if (remainingPoints(subj) <= 0) {
              return (
                <>
                  Current average: <b>{subjectPct(subj).toFixed(2)}%</b> • No remaining assessments.
                </>
              )
            }

            if (short > 0) {
              const slots = remainingBySubject(state.subjects).filter(
                (x) => x.name !== subj.name
              )
              const where = slots.length
                ? `Make up across: ${slots
                    .map((s) => `${s.name} (${s.remaining})`)
                    .join(', ')}`
                : `No remaining capacity in other subjects.`
              return (
                <>
                  Current average so far: <b>{currentPctSoFar.toFixed(2)}%</b> • Even with full
                  marks in this subject you'll be short by <b>{short}</b> marks for the{' '}
                  {state.targetPct}% target. {where}
                </>
              )
            }

            if (nextNeed) {
              return (
                <>
                  Current average so far: <b>{currentPctSoFar.toFixed(2)}%</b> • Next:{' '}
                  <b>{nextNeed.name}</b> — need at least{' '}
                  <b>
                    {nextNeed.neededRaw}/{nextNeed.max}
                  </b>{' '}
                  to stay on track for <b>{state.targetPct}%</b>.
                </>
              )
            }

            return (
              <>
                Current average so far: <b>{currentPctSoFar.toFixed(2)}%</b>
              </>
            )
          })()}
        </div>
      </div>

      {/* two-column layout */}
      <div className="grid grid-2 subject-shell-grid">
        {/* LEFT: assessment details (Assessment/Max locked; only Score editable) */}
        <div className="card subject-shell-inner">
          <h4>Assessment Details</h4>

          {/* column headers */}
          <div
            className="row"
            style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 0 }}
          >
            <div className="badge" style={{ background: 'transparent' }}>
              Assessment
            </div>
            <div className="badge" style={{ background: 'transparent' }}>
              Max Marks
            </div>
            <div className="badge" style={{ background: 'transparent' }}>
              Marks Scored
            </div>
          </div>

          {subj.assessments.map((a, i) => (
            <div key={i} className="row">
              <input className="input readonly" value={a.name} disabled />
              <input className="input readonly" type="number" value={a.max} disabled />
              <input
                className="input"
                type="number"
                placeholder="(blank = pending)"
                value={a.score ?? ''}
                onChange={(e) => {
                  const val =
                    e.target.value === '' ? null : Math.max(0, +e.target.value)
                  const copy = { ...state }
                  copy.subjects[idx].assessments[i].score = val
                  onChange(copy)
                }}
              />
            </div>
          ))}
        </div>

        {/* RIGHT: minimum marks table */}
        <div className="card subject-shell-inner">
          <h4>Minimum marks needed (remaining)</h4>
          {rows.length === 0 ? (
            <p className="badge">All done ✨</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Assessment</th>
                  <th>Needed (raw)</th>
                  <th>Max</th>
                  <th>Feasible?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.Assessment}</td>
                    <td>{r['Needed (raw)']}</td>
                    <td>{r.Max}</td>
                    <td>{r['Feasible?']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
