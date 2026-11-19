import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from './i18n'
import type { DeckClient } from './client'
import { BrandIcon, brandOf } from './brand-icons'
import { Icon } from './icon'
import type { PermissionRequest, ProcInfo, QuestionItem, QuestionRequest } from './types'

const toMs = (v: number | string): number => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v))

/** Short beep via WebAudio, only when the browser allows it (needs an earlier tap on the page). */
function beep() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    if (ctx.state === 'suspended') {
      ctx.close()
      return
    }
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.04
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.18)
    window.setTimeout(() => ctx.close(), 400)
  } catch {
    /* sound is optional */
  }
}

const SOURCE_NAME: { [k: string]: string } = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }
const SOURCE_MARK: { [k: string]: string } = { claude: 'C', codex: 'X', opencode: 'O' }
const SOURCE_COLOR: { [k: string]: string } = { claude: '#d97757', codex: '#e5e7eb', opencode: '#38bdf8' }

/** Look ported from Knowns UI Pro permission-request (autonomy/permission-request.tsx + autonomy-utils.ts: RISK_LABEL). The once/session/always scope choice is removed on purpose: only Deny / Allow. */
const RISK_LABEL: { [k: string]: string } = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

/** Full-width sheet above everything: the oldest pending permission request, with a countdown. */
export function PermissionSheet(props: { client: DeckClient; perms: PermissionRequest[] }) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const seen = useRef<{ [id: string]: boolean }>({})
  const req = props.perms[0]

  useEffect(() => {
    if (!req) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [req && req.id])

  // vibrate + subtle sound once per new request
  useEffect(() => {
    props.perms.forEach((p) => {
      if (seen.current[p.id]) return
      seen.current[p.id] = true
      try {
        if (navigator.vibrate) navigator.vibrate([180, 80, 180])
      } catch {
        /* ignore */
      }
      beep()
    })
  }, [props.perms])

  useEffect(() => {
    setBusy('')
    setErr('')
  }, [req && req.id])

  if (!req) return null
  const left = Math.max(0, Math.ceil((toMs(req.expiresAt) - now) / 1000))
  const total = req.createdAt ? Math.max(1, (toMs(req.expiresAt) - toMs(req.createdAt)) / 1000) : 55
  const risk = req.risk === 'low' || req.risk === 'medium' || req.risk === 'high' ? req.risk : ''
  const color = SOURCE_COLOR[req.source] || '#8b8b94'
  const answer = (d: 'allow' | 'deny') => {
    setBusy(d)
    setErr('')
    props.client.answerPermission(req.id, d, 'once').then((r) => {
      if (!r.ok) {
        setBusy('')
        setErr(r.error || t('Could not send'))
      }
    })
  }
  return (
    <div class="pd-modal pd-modal--perm" role="alertdialog" aria-label={t('Permission request')}>
      <div class="pd-modal__panel">
        <div class="pd-perm__top">
          <span class="pd-perm__mark" style={{ color: color, borderColor: 'var(--pd-border-strong)' }}>
            {brandOf(req.source, true) ? <BrandIcon brand={brandOf(req.source, true)} size={22} /> : SOURCE_MARK[req.source] || '?'}
            <i class="pd-perm__tg">
              <Icon name="terminal-2" size={11} />
            </i>
          </span>
          <div class="pd-perm__title">
            <div>
              <b>{SOURCE_NAME[req.source] || req.source}</b> {t('wants to use')} <b>{req.tool}</b>
            </div>
            <div class="pd-perm__sub">
              {req.project}
              {props.perms.length > 1 ? ' · 1/' + props.perms.length : ''}
            </div>
          </div>
          {risk ? <span class={'pd-risk pd-risk--' + risk}>{t(RISK_LABEL[risk])}</span> : null}
          <span class={'pd-perm__cd' + (left <= 10 ? ' pd-perm__cd--low' : '')}>{left}s</span>
        </div>
        <div class="pd-perm__box">
          {req.detail ? <div class="pd-perm__cwd">{req.detail}</div> : null}
          <pre class="pd-perm__sum">{req.summary}</pre>
        </div>
        {req.riskReason ? (
          <div class={'pd-perm__note' + (risk === 'high' ? ' pd-perm__note--high' : '')}>
            <Icon name="alert-triangle" size={15} class="pd-perm__ni" />
            <span>{req.riskReason}</span>
          </div>
        ) : null}
        <div class="pd-perm__time">
          <div style={{ width: Math.min(100, (left / total) * 100) + '%' }} />
        </div>
        {err ? <div class="pd-perm__err">{err}</div> : null}
        <div class="pd-perm__btns">
          <button type="button" class="pd-perm__btn pd-perm__btn--deny" disabled={!!busy} onClick={() => answer('deny')}>
            {t('Deny')}
          </button>
          <button type="button" class="pd-perm__btn pd-perm__btn--allow" disabled={!!busy} onClick={() => answer('allow')}>
            {t('Allow')}
          </button>
        </div>
      </div>
    </div>
  )
}

const fmtMem = (v: number, percent: boolean) => {
  if (percent) return v.toFixed(1) + '%'
  if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  return Math.round(v / (1024 * 1024)) + ' MB'
}

/** View-only process list, refreshed every 3 s while open. */
export function ProcessSheet(props: { client: DeckClient; initial: 'cpu' | 'mem'; onClose: () => void }) {
  const [sort, setSort] = useState<'cpu' | 'mem'>(props.initial)
  const [list, setList] = useState<ProcInfo[] | null>(null)
  const [err, setErr] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ startY: 0, startTop: 0, dragging: false })

  useEffect(() => {
    let dead = false
    const load = () =>
      props.client.processes(sort, 30).then((r) => {
        if (dead) return
        if (r.ok) {
          setList(r.list)
          setErr('')
        } else setErr(r.error || t('Could not load the list'))
      })
    load()
    const iv = window.setInterval(load, 3000)
    return () => {
      dead = true
      clearInterval(iv)
    }
  }, [sort])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const onTouchStart = (e: TouchEvent) => {
      const listEl = panel.querySelector('.pd-proc__list') as HTMLElement | null
      const atTop = !listEl || listEl.scrollTop <= 0
      if (!atTop) return
      dragRef.current = { startY: e.touches[0].clientY, startTop: 0, dragging: true }
      panel.style.transition = 'none'
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current.dragging) return
      const dy = e.touches[0].clientY - dragRef.current.startY
      if (dy > 0) {
        panel.style.transform = `translateY(${dy}px)`
        e.preventDefault()
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!dragRef.current.dragging) return
      dragRef.current.dragging = false
      panel.style.transition = ''
      const dy = e.changedTouches[0].clientY - dragRef.current.startY
      if (dy > 80) {
        panel.style.transform = `translateY(100%)`
        setTimeout(props.onClose, 150)
      } else {
        panel.style.transform = ''
      }
    }

    panel.addEventListener('touchstart', onTouchStart, { passive: true })
    panel.addEventListener('touchmove', onTouchMove, { passive: false })
    panel.addEventListener('touchend', onTouchEnd, { passive: true })
    panel.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      panel.removeEventListener('touchstart', onTouchStart)
      panel.removeEventListener('touchmove', onTouchMove)
      panel.removeEventListener('touchend', onTouchEnd)
      panel.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [props.onClose])

  // memory as % (small non-integer values) vs bytes: the agent shape is {pid,name,cpu,mem}
  const percent = !!list && list.length > 0 && Math.max.apply(null, list.map((p) => p.mem)) <= 100 && list.some((p) => p.mem % 1 !== 0)
  return (
    <div class="pd-modal" role="dialog" aria-label={t('Processes')} onClick={props.onClose}>
      <div class="pd-modal__panel pd-modal__panel--proc" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div class="pd-proc__drag" />
        <div class="pd-proc__head">
          <b>{t('Processes')}</b>
          <span class="pd-spacer" />
          <div class="pd-toggle" role="tablist">
            <button type="button" class={'pd-toggle__b' + (sort === 'cpu' ? ' pd-toggle__b--on' : '')} onClick={() => setSort('cpu')}>
              CPU
            </button>
            <button type="button" class={'pd-toggle__b' + (sort === 'mem' ? ' pd-toggle__b--on' : '')} onClick={() => setSort('mem')}>
              RAM
            </button>
          </div>
          <button type="button" class="pd-iconbtn" aria-label={t('Close')} onClick={props.onClose}>
            <Icon name="x" size={22} />
          </button>
        </div>
        <div class="pd-proc__list">
          {err ? <div class="pd-proc__msg">{err}</div> : null}
          {!list && !err ? <div class="pd-proc__msg">{t('Loading...')}</div> : null}
          {list && list.length === 0 ? <div class="pd-proc__msg">{t('No data')}</div> : null}
          {list
            ? list.map((p) => (
                <div class="pd-proc" key={p.pid}>
                  <span class="pd-proc__n">{p.name}</span>
                  <span class={'pd-proc__v' + (sort === 'cpu' ? ' pd-proc__v--on' : '')}>{p.cpu.toFixed(1)}%</span>
                  <span class={'pd-proc__v pd-proc__v--mem' + (sort === 'mem' ? ' pd-proc__v--on' : '')}>{fmtMem(p.mem, percent)}</span>
                </div>
              ))
            : null}
        </div>
      </div>
    </div>
  )
}

/** Claude Code asks a question (AskUserQuestion): answer it from the phone, or hand it back to the terminal. */
export function QuestionSheet(props: { client: DeckClient; qs: QuestionRequest[]; preview?: boolean }) {
  const req = props.qs[0]
  const [now, setNow] = useState(() => Date.now())
  const [sel, setSel] = useState<{ [q: number]: string[] }>({})
  const [otherOn, setOtherOn] = useState<{ [q: number]: boolean }>({})
  const [otherText, setOtherText] = useState<{ [q: number]: string }>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const seen = useRef<{ [id: string]: boolean }>({})

  useEffect(() => {
    if (!req) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [req && req.id])
  useEffect(() => {
    setSel({})
    setOtherOn({})
    setOtherText({})
    setBusy('')
    setErr('')
  }, [req && req.id])
  useEffect(() => {
    props.qs.forEach((q) => {
      if (seen.current[q.id]) return
      seen.current[q.id] = true
      try {
        if (navigator.vibrate) navigator.vibrate([120, 60, 120])
      } catch {
        /* ignore */
      }
    })
  }, [props.qs])

  if (!req) return null
  const left = Math.max(0, Math.ceil((toMs(req.expiresAt) - now) / 1000))
  const mm = Math.floor(left / 60)
  const cd = mm + ':' + (left % 60 < 10 ? '0' : '') + (left % 60)
  const qsrc = req.source || 'claude'
  const color = SOURCE_COLOR[qsrc] || SOURCE_COLOR.claude
  const qname = SOURCE_NAME[qsrc] || 'Claude Code'

  const pick = (qi: number, label: string, multi: boolean) => {
    setErr('')
    const cur = sel[qi] || []
    if (multi) setSel(Object.assign({}, sel, { [qi]: cur.indexOf(label) >= 0 ? cur.filter((x) => x !== label) : cur.concat([label]) }))
    else {
      setSel(Object.assign({}, sel, { [qi]: [label] }))
      setOtherOn(Object.assign({}, otherOn, { [qi]: false }))
    }
  }
  const toggleOther = (qi: number, multi: boolean) => {
    const on = !otherOn[qi]
    setOtherOn(Object.assign({}, otherOn, { [qi]: on }))
    if (on && !multi) setSel(Object.assign({}, sel, { [qi]: [] }))
  }
  const isMulti = (q: QuestionItem) => !!q.multiSelect || !!q.multiple
  const answered = (qi: number, multi: boolean) => {
    const txt = (otherText[qi] || '').trim()
    if (otherOn[qi] && !txt) return false
    return (sel[qi] || []).length > 0 || (!!otherOn[qi] && !!txt && (multi || true))
  }
  const all = req.questions.every((q, i) => answered(i, isMulti(q)))
  const send = () => {
    if (!all || busy || props.preview) return
    const answers: { [q: string]: string } = {}
    const other: { [q: string]: boolean } = {}
    const choices: { [q: string]: string[] } = {}
    const custom: { [q: string]: string } = {}
    req.questions.forEach((q, i) => {
      const parts = (sel[i] || []).slice()
      const txt = (otherText[i] || '').trim()
      if (otherOn[i] && txt) {
        parts.push(txt)
        other[q.question] = true
        custom[q.question] = txt
      }
      answers[q.question] = parts.join(', ')
      choices[q.question] = (sel[i] || []).slice()
    })
    setBusy('send')
    setErr('')
    props.client.answerQuestion(req.id, { answers, other, choices, custom }).then((r) => {
      if (!r.ok) {
        setBusy('')
        setErr(r.error || t('Could not send'))
      }
    })
  }
  const release = () => {
    if (busy || props.preview) return
    setBusy('release')
    setErr('')
    props.client.answerQuestion(req.id, { release: true }).then((r) => {
      if (!r.ok) {
        setBusy('')
        setErr(r.error || t('Could not send'))
      }
    })
  }
  return (
    <div class="pd-modal pd-modal--q" role="dialog" aria-label={t('Question from') + ' ' + qname}>
      <div class="pd-modal__panel pd-q">
        <div class="pd-perm__top">
          <span class="pd-perm__mark" style={{ color: color, borderColor: 'var(--pd-border-strong)' }}>
            {brandOf(qsrc, true) ? <BrandIcon brand={brandOf(qsrc, true)} size={22} /> : 'C'}
          </span>
          <div class="pd-perm__title">
            <div>
              <b>{qname}</b> {t('is asking you')}
            </div>
            <div class="pd-perm__sub">
              {req.project}
              {req.sessionId ? ' · ' + req.sessionId.slice(0, 8) : ''}
              {props.qs.length > 1 ? ' · 1/' + props.qs.length : ''}
            </div>
          </div>
          <span class={'pd-perm__cd' + (left <= 30 ? ' pd-perm__cd--low' : '')}>{cd}</span>
        </div>
        <div class="pd-q__body">
          {req.questions.map((q, qi) => {
            const multi = isMulti(q)
            const canOther = q.custom !== false
            return (
              <div class="pd-q__q" key={qi}>
                <div class="pd-q__qh">
                  {q.header ? <span class="pd-q__chip">{q.header}</span> : null}
                  {multi ? <span class="pd-q__hint">{t('Select multiple')}</span> : null}
                </div>
                <div class="pd-q__t">{q.question}</div>
                <div role={multi ? 'group' : 'radiogroup'}>
                  {q.options.map((o) => {
                    const on = (sel[qi] || []).indexOf(o.label) >= 0
                    return (
                      <button key={o.label} type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={on} class={'pd-q__o' + (on ? ' pd-q__o--on' : '')} onClick={() => pick(qi, o.label, multi)}>
                        <i class={'pd-q__m' + (multi ? ' pd-q__m--box' : '')}>{on ? '✓' : ''}</i>
                        <span class="pd-q__ot">
                          <b>{o.label}</b>
                          {o.description ? <span>{o.description}</span> : null}
                        </span>
                      </button>
                    )
                  })}
                  {canOther ? <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={!!otherOn[qi]} class={'pd-q__o' + (otherOn[qi] ? ' pd-q__o--on' : '')} onClick={() => toggleOther(qi, multi)}>
                    <i class={'pd-q__m' + (multi ? ' pd-q__m--box' : '')}>{otherOn[qi] ? '✓' : ''}</i>
                    <span class="pd-q__ot">
                      <b>{t('Other…')}</b>
                      <span>{t('Type your own answer')}</span>
                    </span>
                  </button> : null}
                  {canOther && otherOn[qi] ? (
                    <input
                      class="pd-q__in"
                      type="text"
                      placeholder={t('Enter your answer')}
                      value={otherText[qi] || ''}
                      autoFocus
                      onInput={(e) => setOtherText(Object.assign({}, otherText, { [qi]: (e.target as HTMLInputElement).value }))}
                    />
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
        {err ? <div class="pd-perm__err">{err}</div> : null}
        <div class="pd-q__ft">
          <button type="button" class="pd-perm__btn pd-perm__btn--deny" disabled={!!busy || left <= 0} onClick={release}>
            {t('Answer on the computer')}
          </button>
          <button type="button" class="pd-perm__btn pd-perm__btn--allow" disabled={!all || !!busy || left <= 0} onClick={send}>
            {t('Send')}
          </button>
        </div>
      </div>
    </div>
  )
}
