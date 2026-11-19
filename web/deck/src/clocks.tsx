import { useEffect, useRef, useState } from 'preact/hooks'
import { getLang } from './i18n'
import { t } from './i18n'
import { timeWords, timeWordsEn } from './clock-words'
import { AnimatedNumber, reducedMotion } from './knowns'
import { tint } from './theme'
import type { ClockOptions } from './types'

/**
 * Clock widget styles: digital (AnimatedNumber rolling digits), flip (split-flap cards), analog (SVG dial + hands),
 * minimal, word (Vietnamese words, see clock-words.ts) and world (local time + up to 4 IANA zones via Intl.DateTimeFormat).
 * Safari 12: no ?. / ??, flex gap, clamp(); keyframes are -webkit- prefixed; the dial hands are HTML elements (CSS transforms on SVG are unreliable).
 */

export interface ClockProps {
  tw: number
  th: number
  scale: number
  showLabel: boolean
  textColor?: string
  color?: string
  opts?: ClockOptions
  /** the deck's own label word for this widget */
  caption: string
}

const WEEKDAY_VI = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number) => (n < 10 ? '0' : '') + n
const fit = (chars: number, avail: number, max: number, min: number) => Math.max(min, Math.min(max, Math.floor(avail / (Math.max(1, chars) * 0.62))))

export interface Parts {
  h: number
  m: number
  s: number
  y: number
  mo: number
  d: number
  wd: number
}

/** Wall-clock parts of `date` in an IANA zone (the phone's zone when tz is empty or unknown). */
export function zoneParts(date: Date, tz?: string): Parts {
  const local = (): Parts => ({ h: date.getHours(), m: date.getMinutes(), s: date.getSeconds(), y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), wd: date.getDay() })
  if (!tz) return local()
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    const o: { [k: string]: number } = {}
    f.formatToParts(date).forEach((p) => {
      if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10)
    })
    if (o.hour === undefined || isNaN(o.hour)) return local()
    const wd = new Date(Date.UTC(o.year, o.month - 1, o.day)).getUTCDay()
    return { h: o.hour % 24, m: o.minute, s: o.second, y: o.year, mo: o.month, d: o.day, wd: wd }
  } catch (e) {
    return local()
  }
}

const dayNum = (p: Parts) => Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 86400000)

const CITY: { [k: string]: string } = {
  Ho_Chi_Minh: 'TP. Hồ Chí Minh',
  Saigon: 'TP. Hồ Chí Minh',
  Hanoi: 'Hà Nội',
  London: 'Luân Đôn',
  Paris: 'Pa-ri',
  Berlin: 'Béc-lin',
  Moscow: 'Mát-xcơ-va',
  Shanghai: 'Thượng Hải',
  Hong_Kong: 'Hồng Kông',
  Beijing: 'Bắc Kinh',
  Tokyo: 'Tokyo',
  Seoul: 'Seoul',
  Bangkok: 'Bangkok',
  Singapore: 'Singapore',
  Sydney: 'Sydney',
  Dubai: 'Dubai',
  Kolkata: 'Kolkata',
  New_York: 'New York',
  Los_Angeles: 'Los Angeles',
  Chicago: 'Chicago',
  Phnom_Penh: 'Phnom Penh',
}

/** "Europe/London" -> "London", "America/New_York" -> "New York". */
export function cityName(tz: string): string {
  const last = tz.split('/').pop() || tz
  return (getLang() === 'vi' && CITY[last]) || last.replace(/_/g, ' ')
}

const hour12Of = (h: number) => h % 12 || 12
const dateText = (p: Parts) => (getLang() === 'vi' ? WEEKDAY_VI[p.wd] + ', ' + p.d + ' tháng ' + p.mo : WEEKDAY_EN[p.wd] + ', ' + MONTH_EN[p.mo - 1] + ' ' + p.d)

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setNow(new Date())
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** An angle that only grows, so a CSS transition never spins backwards across 360 -> 0. */
function useUnwrapped(angle: number): number {
  const last = useRef(angle)
  let a = angle
  while (a < last.current - 180) a += 360
  last.current = a
  return a
}

export function ClockWidget(props: ClockProps) {
  const o = props.opts || {}
  const now = useNow()
  const style = o.style || 'digital'
  const big = props.tw >= 170 && props.th >= 110
  const tc = props.textColor || undefined
  const p = zoneParts(now, o.timeZone)
  // Seconds only need horizontal room (a 3x1 tile is ~93px tall but wide enough), the date needs height too.
  const secs = o.seconds === undefined ? props.tw >= 200 || big : !!o.seconds
  const date = o.showDate === undefined ? big && props.showLabel : !!o.showDate
  const hr = o.hour12 ? hour12Of(p.h) : p.h
  const label = o.label || (props.showLabel ? props.caption : '')
  const common = { p: p, o: o, tw: props.tw, th: props.th, scale: props.scale, secs: secs, date: date, hr: hr, label: label, big: big, color: props.color }
  let body
  if (style === 'flip') body = <Flip {...common} />
  else if (style === 'analog') body = <Analog {...common} />
  else if (style === 'minimal') body = <Minimal {...common} />
  else if (style === 'word') body = <Words {...common} />
  else if (style === 'world') body = <World {...common} now={now} />
  else body = <Digital {...common} />
  return (
    <div class={'pd-clk pd-clk--' + style} style={{ color: tc }}>
      {body}
    </div>
  )
}

interface Sub {
  p: Parts
  o: ClockOptions
  tw: number
  th: number
  scale: number
  secs: boolean
  date: boolean
  hr: number
  label: string
  big: boolean
  color?: string
}

const ampm = (p: Parts) => (getLang() === 'vi' ? (p.h < 12 ? 'SA' : 'CH') : p.h < 12 ? 'AM' : 'PM')
const hm = (s: Sub) => s.hr * 100 + s.p.m
const hmFormat = (n: number) => pad2(Math.floor(n / 100)) + ':' + pad2(n % 100)

function Label(props: { text: string; tw: number; scale: number }) {
  if (!props.text) return null
  return (
    <div class="pd-clk__l" style={{ fontSize: Math.max(9, fit(props.text.length, Math.max(20, props.tw - 28), 12 * Math.min(1.2, props.scale), 9)) + 'px' }}>
      {props.text}
    </div>
  )
}

function DateLine(props: { p: Parts; size: number }) {
  return (
    <div class="pd-clock__d" style={{ fontSize: props.size + 'px' }}>
      {dateText(props.p)}
    </div>
  )
}

/** digital: big thin rolling digits with a small superscript. */
function Digital(s: Sub) {
  const pad = s.tw >= 240 ? 18 : 14
  const inner = s.tw - pad * 2
  const wide = s.secs ? 3.2 : s.o.hour12 ? 3.2 : 2.9
  const size = Math.max(14, Math.floor(Math.min(s.th * (s.date || s.label ? 0.46 : 0.55), inner / wide) * Math.min(1.2, s.scale)))
  return (
    <div class="pd-clk__c" style={{ padding: '0 ' + pad + 'px' }}>
      {s.big ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-clock__t" style={{ fontSize: size + 'px' }}>
        <AnimatedNumber value={hm(s)} format={hmFormat} />
        {s.secs || s.o.hour12 ? (
          <sup class="pd-clock__s" style={{ fontSize: Math.max(10, Math.round(size * 0.3)) + 'px' }}>
            {s.secs ? <AnimatedNumber value={s.p.s} format={pad2} /> : null}
            {s.o.hour12 ? <span class="pd-clk__ap">{ampm(s.p)}</span> : null}
          </sup>
        ) : null}
      </div>
      {s.date ? <DateLine p={s.p} size={Math.max(11, Math.min(16, Math.round(size * 0.22))) * Math.min(1.2, s.scale)} /> : null}
      {!s.big ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
    </div>
  )
}

/** minimal: the time only, as large as the tile allows. */
function Minimal(s: Sub) {
  const chars = s.secs ? 8 : 5
  const size = Math.max(12, Math.floor(Math.min(s.th * 0.7, (s.tw - 16) / (chars * 0.56))))
  const text = pad2(s.hr) + ':' + pad2(s.p.m) + (s.secs ? ':' + pad2(s.p.s) : '')
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      <div class="pd-clk__min" style={{ fontSize: size + 'px' }}>
        {text}
      </div>
    </div>
  )
}

/** word: "half past ten" / "mười giờ rưỡi" (rules in clock-words.ts). */
function Words(s: Sub) {
  const w = getLang() === 'vi' ? timeWords(s.p.h, s.p.m) : timeWordsEn(s.p.h, s.p.m)
  const cap = Math.round(s.th * 0.11)
  const showPart = s.th >= 90
  const areaW = s.tw - 28
  const areaH = s.th - 24 - (showPart ? 18 : 0) - (s.date ? 22 : 0)
  const size = Math.max(11, Math.min(46, Math.floor(Math.sqrt((Math.max(20, areaW) * Math.max(20, areaH) * 0.62) / (w.text.length * 0.62)))))
  return (
    <div class="pd-clk__c pd-clk__c--mid pd-clk__words">
      <div class="pd-clk__w" style={{ fontSize: size + 'px' }}>
        {w.text}
      </div>
      {showPart ? (
        <div class="pd-clk__part" style={{ fontSize: Math.max(10, Math.min(14, cap)) + 'px' }}>
          {w.part}
        </div>
      ) : null}
      {s.date ? <DateLine p={s.p} size={Math.max(11, Math.min(15, Math.round(size * 0.4)))} /> : null}
    </div>
  )
}

/* ---------- flip ---------- */

/** One split-flap card: the old value folds down over the new one. Reduced motion = instant swap. */
function FlapCard(props: { text: string; w: number; h: number; font: number }) {
  const [st, setSt] = useState({ cur: props.text, prev: props.text, k: 0 })
  const timer = useRef(0)
  if (props.text !== st.cur) {
    const next = { cur: props.text, prev: reducedMotion() ? props.text : st.cur, k: st.k + 1 }
    setSt(next)
  }
  useEffect(() => {
    if (st.prev === st.cur) return
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSt({ cur: st.cur, prev: st.cur, k: st.k }), 520)
    return () => clearTimeout(timer.current)
  }, [st.k])
  const dim = { width: props.w + 'px', height: props.h + 'px', fontSize: props.font + 'px', lineHeight: props.h + 'px' }
  const flipping = st.prev !== st.cur
  const half = (cls: string, text: string, extra?: string) => (
    <div class={'pd-fl__h ' + cls + (extra ? ' ' + extra : '')}>
      <span style={dim}>{text}</span>
    </div>
  )
  return (
    <div class="pd-fl" style={{ width: props.w + 'px', height: props.h + 'px' }} aria-hidden="true">
      {half('pd-fl__top', st.cur)}
      {half('pd-fl__bot', flipping ? st.prev : st.cur)}
      {flipping ? (
        <div key={'t' + st.k} class="pd-fl__fold pd-fl__fold--t">
          {half('pd-fl__top', st.prev)}
        </div>
      ) : null}
      {flipping ? (
        <div key={'b' + st.k} class="pd-fl__fold pd-fl__fold--b">
          {half('pd-fl__bot', st.cur)}
        </div>
      ) : null}
      <i class="pd-fl__line" />
    </div>
  )
}

function Flip(s: Sub) {
  const groups = [pad2(s.hr), pad2(s.p.m)]
  if (s.secs) groups.push(pad2(s.p.s))
  const n = groups.length
  const dateH = s.date ? 22 : 0
  const labelH = s.label ? 16 : 0
  const gapW = 8
  const maxW = (s.tw - 20 - gapW * (n - 1)) / n
  const maxH = s.th - 20 - dateH - labelH
  const cw = Math.max(16, Math.floor(Math.min(maxW, maxH * 0.8)))
  const ch = Math.max(20, Math.min(Math.floor(maxH), Math.floor(cw * 1.25)))
  const font = Math.floor(Math.min(ch * 0.7, cw * 0.52))
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      {s.label ? <Label text={s.label} tw={s.tw} scale={s.scale} /> : null}
      <div class="pd-fl__row" role="img" aria-label={groups.join(':')}>
        {groups.map((g, i) => (
          <div key={i} style={{ marginLeft: i ? gapW + 'px' : '0' }}>
            <FlapCard text={g} w={cw} h={ch} font={font} />
          </div>
        ))}
      </div>
      {s.date ? <DateLine p={s.p} size={13} /> : null}
    </div>
  )
}

/* ---------- analog ---------- */

function Analog(s: Sub) {
  const showDate = s.date && s.th >= 200
  const dateH = showDate ? 26 : 0
  const d = Math.max(40, Math.floor(Math.min(s.tw - 16, s.th - 16 - dateH)))
  const sec = s.p.s
  const minA = s.p.m * 6 + sec * 0.1
  const hourA = (s.p.h % 12) * 30 + s.p.m * 0.5
  const aS = useUnwrapped(sec * 6)
  const aM = useUnwrapped(minA)
  const aH = useUnwrapped(hourA)
  const accent = s.color || 'var(--pd-accent)'
  const ticks = []
  const showMinorTicks = d >= 90
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0
    if (!major && !showMinorTicks) continue
    const a = (i * Math.PI) / 30
    const r1 = 47
    const r2 = major ? 41 : 44.5
    ticks.push(<line key={i} x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)} x2={50 + r2 * Math.sin(a)} y2={50 - r2 * Math.cos(a)} stroke={major ? 'rgba(139,139,148,0.95)' : 'rgba(139,139,148,0.45)'} stroke-width={major ? 1.6 : 0.7} stroke-linecap="round" />)
  }
  const anim = reducedMotion() ? 'none' : ''
  const hand = (cls: string, angle: number, len: number, w: number, color: string, trans: string, tail: number) => (
    <div class="pd-an__hand" style={{ height: d + 'px', width: w + 'px', marginLeft: -w / 2 + 'px', WebkitTransform: 'rotate(' + angle + 'deg)', transform: 'rotate(' + angle + 'deg)', transition: anim || trans, WebkitTransition: anim || trans }}>
      <i class={cls} style={{ top: (50 - len) + '%', bottom: 50 - tail + '%', background: color, borderRadius: w + 'px' }} />
    </div>
  )
  const secOn = s.secs
  return (
    <div class="pd-clk__c pd-clk__c--mid">
      <div class="pd-an__dial" style={{ width: d + 'px', height: d + 'px' }} role="img" aria-label={pad2(s.p.h) + ':' + pad2(s.p.m)}>
        <svg viewBox="0 0 100 100" width={d} height={d}>
          <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(139,139,148,0.28)" stroke-width="0.8" />
          {ticks}
        </svg>
        {hand('pd-an__h', aH, 26, Math.max(3, d * 0.035), 'var(--pd-text)', 'transform 0.4s ease-out', -6)}
        {hand('pd-an__m', aM, 38, Math.max(2, d * 0.025), 'var(--pd-text)', 'transform 0.4s ease-out', -6)}
        {secOn ? hand('pd-an__s', aS, 42, Math.max(1, d * 0.012), accent, 'transform 1s linear', -10) : null}
        <b class="pd-an__pin" style={{ background: secOn ? accent : 'var(--pd-text)' }} />
      </div>
      {showDate ? <DateLine p={s.p} size={13} /> : null}
    </div>
  )
}

/* ---------- world ---------- */

function World(s: Sub & { now: Date }) {
  const zones = (s.o.zones || []).slice(0, 4)
  const rowsAll: { name: string; p: Parts; tz?: string }[] = [{ name: s.o.label || (s.o.timeZone ? cityName(s.o.timeZone) : t('Local')), p: s.p, tz: s.o.timeZone }]
  zones.forEach((z) => rowsAll.push({ name: cityName(z), p: zoneParts(s.now, z), tz: z }))
  const pad = 10
  const rowMin = 24
  const maxRows = Math.max(1, Math.floor((s.th - pad * 2) / rowMin))
  const rows = rowsAll.slice(0, maxRows)
  const rowH = Math.min(46, Math.floor((s.th - pad * 2) / rows.length))
  const font = Math.max(12, Math.min(26, Math.floor(rowH * 0.5))) * Math.min(1.15, s.scale)
  const nameFont = Math.max(10, Math.min(15, Math.round(font * 0.6)))
  const base = dayNum(s.p)
  const narrow = s.tw < 150
  return (
    <div class="pd-clk__c pd-clk__c--mid pd-wd">
      {rows.map((r, i) => {
        const diff = dayNum(r.p) - base
        return (
          <div class="pd-wd__row" key={i} style={{ height: rowH + 'px' }}>
            <span class="pd-wd__n" style={{ fontSize: nameFont + 'px' }}>
              {r.name}
            </span>
            {diff !== 0 && i > 0 ? (
              <span class="pd-wd__off" style={{ fontSize: Math.max(9, nameFont - 3) + 'px' }}>
                {diff > 0 ? '+' + diff : String(diff)}
              </span>
            ) : null}
            <span class="pd-wd__t" style={{ fontSize: font + 'px', color: i === 0 ? undefined : tint(s.color || '', 0) || undefined }}>
              {pad2(s.o.hour12 ? hour12Of(r.p.h) : r.p.h) + ':' + pad2(r.p.m)}
              {narrow ? '' : s.o.hour12 ? ' ' + ampm(r.p) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
