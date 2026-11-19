import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from './i18n'
import { Icon } from './icon'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

interface SliderWidgetProps {
  level: number
  muted: boolean
  label: string
  icon: string
  iconMuted: string
  color?: string
  tw: number
  th: number
  scale: number
  showLabel: boolean
  textColor?: string
  disabled?: boolean
  onLevel: (v: number) => void
  onMute: () => void
}

export function SliderWidget(props: SliderWidgetProps) {
  const { level, muted, label, icon, iconMuted, tw, th, onLevel, onMute } = props
  const [drag, setDrag] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const lastSend = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const INSET = 11
    let on = false
    let val = 0

    const rotated = () => !!el.closest('.pd-root--rot')

    const calc = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      const rot = rotated()
      const w = Math.max(1, (rot ? r.height : r.width) - INSET * 2)
      const pos = (rot ? cy - r.top : cx - r.left) - INSET
      return clamp(Math.round((pos / w) * 100), 0, 100)
    }

    const move = (cx: number, cy: number, final: boolean) => {
      val = calc(cx, cy)
      setDrag(val)
      const now = Date.now()
      if (final || now - lastSend.current > 80) {
        lastSend.current = now
        latest.current.onLevel(val)
      }
    }

    const end = () => {
      if (!on) return
      on = false
      latest.current.onLevel(val)
      window.setTimeout(() => setDrag(null), 400)
    }

    const ts = (e: TouchEvent) => {
      if (latest.current.disabled || !e.touches.length) return
      e.preventDefault()
      e.stopPropagation()
      on = true
      move(e.touches[0].clientX, e.touches[0].clientY, false)
    }

    const tm = (e: TouchEvent) => {
      if (!on || !e.touches.length) return
      e.preventDefault()
      e.stopPropagation()
      move(e.touches[0].clientX, e.touches[0].clientY, false)
    }

    const te = (e: TouchEvent) => {
      e.stopPropagation()
      end()
    }

    const mm = (e: MouseEvent) => on && move(e.clientX, e.clientY, false)

    const mu = () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
      end()
    }

    const md = (e: MouseEvent) => {
      if (latest.current.disabled) return
      e.stopPropagation()
      on = true
      move(e.clientX, e.clientY, false)
      window.addEventListener('mousemove', mm)
      window.addEventListener('mouseup', mu)
    }

    const nopass = { passive: false } as AddEventListenerOptions
    el.addEventListener('touchstart', ts, nopass)
    el.addEventListener('touchmove', tm, nopass)
    el.addEventListener('touchend', te)
    el.addEventListener('touchcancel', te)
    el.addEventListener('mousedown', md)

    return () => {
      el.removeEventListener('touchstart', ts)
      el.removeEventListener('touchmove', tm)
      el.removeEventListener('touchend', te)
      el.removeEventListener('touchcancel', te)
      el.removeEventListener('mousedown', md)
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
    }
  }, [])

  const v = clamp(muted ? 0 : drag !== null ? drag : level, 0, 100)
  const compact = tw < 150 || th < 60
  const tiny = tw < 100 || th < 50
  const pad = compact ? 8 : 12
  const iconSize = tiny ? 18 : compact ? 20 : 24
  const color = props.color || 'var(--pd-accent)'
  const tc = props.textColor || undefined

  const key = (e: KeyboardEvent) => {
    const k = e.key
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return
    e.preventDefault()
    onLevel(clamp(v + (k === 'ArrowLeft' || k === 'ArrowDown' ? -5 : 5), 0, 100))
  }

  if (tiny) {
    return (
      <div class="pd-slider pd-slider--tiny" style={{ padding: pad + 'px', color: tc }}>
        <button type="button" class="pd-slider__btn" onClick={onMute} aria-label={muted ? t('Unmute') : t('Mute')} aria-pressed={muted}>
          <Icon name={muted ? iconMuted : icon} size={iconSize} />
        </button>
        <span class="pd-slider__v">{muted ? '—' : v + '%'}</span>
      </div>
    )
  }

  return (
    <div class={'pd-slider' + (compact ? ' pd-slider--compact' : '')} style={{ padding: pad + 'px', color: tc }} data-noswipe>
      <div class="pd-slider__row">
        <button type="button" class="pd-slider__btn" onClick={onMute} aria-label={muted ? t('Unmute') : t('Mute')} aria-pressed={muted} style={{ color: color }}>
          <Icon name={muted ? iconMuted : icon} size={iconSize} />
        </button>
        {props.showLabel && !compact ? <span class="pd-slider__lb" style={{ color: tc }}>{label}</span> : null}
        <span class="pd-slider__v" style={{ color: tc }}>{muted ? '—' : v + '%'}</span>
      </div>
      <div
        class="pd-slider__track"
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-valuetext={v + '%'}
        aria-disabled={props.disabled}
        onKeyDown={key as any}
        style={{ '--slider-color': color } as any}
      >
        <div class="pd-slider__bg">
          <div class="pd-slider__fill" style={{ width: v + '%', background: color }} />
        </div>
        <span class="pd-slider__thumb" style={{ left: 'calc(' + 11 + 'px + (100% - 22px) * ' + v / 100 + ')', background: '#fff' }} />
      </div>
    </div>
  )
}

export interface VolumeWidgetProps {
  stats: { volume?: { level: number; muted: boolean } | null } | null
  tw: number
  th: number
  scale: number
  showLabel: boolean
  color?: string
  textColor?: string
  onVolume: (v: { level: number } | { muted: boolean }) => Promise<unknown> | void
}

export function VolumeWidget(props: VolumeWidgetProps) {
  const vol = props.stats?.volume
  if (!vol) {
    return (
      <div class="pd-slider pd-slider--empty" style={{ padding: '12px' }}>
        <span class="pd-slider__none">{t('No volume data')}</span>
      </div>
    )
  }

  const [pending, setPending] = useState(false)
  const pendTimer = useRef(0)

  const run = (p: Promise<unknown> | void) => {
    setPending(true)
    clearTimeout(pendTimer.current)
    const end = () => {
      clearTimeout(pendTimer.current)
      setPending(false)
    }
    pendTimer.current = window.setTimeout(end, 2000)
    if (p && typeof (p as Promise<unknown>).then === 'function') (p as Promise<unknown>).then(end, end)
  }

  useEffect(() => () => clearTimeout(pendTimer.current), [])

  return (
    <SliderWidget
      level={vol.level}
      muted={vol.muted}
      label={t('Volume')}
      icon="volume"
      iconMuted="volume-3"
      color={props.color}
      tw={props.tw}
      th={props.th}
      scale={props.scale}
      showLabel={props.showLabel}
      textColor={props.textColor}
      disabled={pending}
      onLevel={(v) => run(props.onVolume({ level: v }))}
      onMute={() => run(props.onVolume({ muted: !vol.muted }))}
    />
  )
}

export interface MicWidgetProps {
  stats: { mic?: { level: number; muted: boolean } | null } | null
  tw: number
  th: number
  scale: number
  showLabel: boolean
  color?: string
  textColor?: string
  onMic: (v: { level: number } | { muted: boolean }) => Promise<unknown> | void
}

export function MicWidget(props: MicWidgetProps) {
  const mic = props.stats?.mic
  if (!mic) {
    return (
      <div class="pd-slider pd-slider--empty" style={{ padding: '12px' }}>
        <span class="pd-slider__none">{t('No mic data')}</span>
      </div>
    )
  }

  const [pending, setPending] = useState(false)
  const pendTimer = useRef(0)

  const run = (p: Promise<unknown> | void) => {
    setPending(true)
    clearTimeout(pendTimer.current)
    const end = () => {
      clearTimeout(pendTimer.current)
      setPending(false)
    }
    pendTimer.current = window.setTimeout(end, 2000)
    if (p && typeof (p as Promise<unknown>).then === 'function') (p as Promise<unknown>).then(end, end)
  }

  useEffect(() => () => clearTimeout(pendTimer.current), [])

  return (
    <SliderWidget
      level={mic.level}
      muted={mic.muted}
      label={t('Microphone')}
      icon="microphone"
      iconMuted="microphone-off"
      color={props.color || '#dc2626'}
      tw={props.tw}
      th={props.th}
      scale={props.scale}
      showLabel={props.showLabel}
      textColor={props.textColor}
      disabled={pending}
      onLevel={(v) => run(props.onMic({ level: v }))}
      onMute={() => run(props.onMic({ muted: !mic.muted }))}
    />
  )
}
