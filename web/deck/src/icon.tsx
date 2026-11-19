import { DEFAULT_STROKE, iconSvg, wrapIcon } from '../../shared/icons'
import type { IconAssets } from './types'

/**
 * Tabler icons (MIT) via web/shared/icons.ts: iconSvg() returns a full svg string, injected as markup (Safari 12 safe).
 * Outline strokes use theme.iconStroke (default DEFAULT_STROKE); Filled only for active / emphasised states. Brand marks (claude, codex, ...)
 * resolve the same way. Decorative: aria-hidden; icon-only buttons carry their aria-label on the button.
 */
/** theme.iconStroke (1-3), set by the Deck on every render before the icons draw. */
let strokeW = DEFAULT_STROKE
export function setIconStroke(v: number | undefined) {
  strokeW = v && v >= 1 && v <= 3 ? v : DEFAULT_STROKE
}

export function Icon(props: { name: string; size?: number; weight?: 'Outline' | 'Filled'; class?: string; style?: { [k: string]: string } }) {
  const size = props.size || 20
  const svg = iconSvg(props.name, { size, weight: props.weight, stroke: strokeW })
  if (!svg) return null
  return <span class={'pd-svg ' + (props.class || '')} style={Object.assign({ width: size + 'px', height: size + 'px' }, props.style || {})} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** Emoji (astral planes, or the BMP symbol/dingbat blocks) read bigger than letters. No \p{} escapes: Safari 12 cannot parse them. */
const EMOJI = /[\u2190-\u2BFF\u3030\u303D\uD83C-\uD83E]/
export const isEmoji = (s: string) => EMOJI.test(s)

/**
 * A tile icon. Order: built-in Tabler icon / brand / alias, then layout.assets (svg: wrapped with wrapIcon in its O/F variant, img: an <img> cropped to a
 * rounded square, never tinted), then emoji / short text. app:/img: values whose asset has not arrived yet show a soft placeholder square.
 */
export function TileIcon(props: { value: string; size: number; assets?: IconAssets; weight?: 'Outline' | 'Filled' }) {
  const v = props.value
  const size = props.size
  const svg = iconSvg(v, { size: size, weight: props.weight, stroke: strokeW })
  if (svg) return <span class="pd-svg" style={{ width: size + 'px', height: size + 'px' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  const a = props.assets && Object.prototype.hasOwnProperty.call(props.assets, v) ? props.assets[v] : null
  const radius = Math.round(size * 0.225) + 'px'
  if (a && a.img) {
    return <img class="pd-ic-img" src={a.img} alt="" width={size} height={size} style={{ width: size + 'px', height: size + 'px', borderRadius: radius }} />
  }
  if (a && a.svg && a.brand) {
    // brand mark (lobe:<name>): its own viewBox and colours, mono ones use currentColor; never tinted
    const bm = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="' + (a.vb || '0 0 24 24') + '" fill="currentColor" aria-hidden="true">' + a.svg + '</svg>'
    return <span class="pd-svg pd-svg--brand" style={{ width: size + 'px', height: size + 'px' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: bm }} />
  }
  if (a && a.svg) {
    const markup = wrapIcon(a.svg, { variant: a.variant === 'F' ? 'F' : 'O', size: size, stroke: strokeW })
    return <span class="pd-svg" style={{ width: size + 'px', height: size + 'px' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
  }
  if (v.indexOf('app:') === 0 || v.indexOf('img:') === 0 || v.indexOf('lobe:') === 0) {
    return <span class="pd-ic-img pd-ic-img--ph" style={{ width: size + 'px', height: size + 'px', borderRadius: radius }} aria-hidden="true" />
  }
  // an icon name that is not built in and has no asset (yet): a neutral glyph, never the raw name as clipped text
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length >= 3) {
    const fb = ['square', 'help', 'question-mark'].filter((n) => iconSvg(n, { size: size, weight: props.weight, stroke: strokeW }))[0]
    if (fb) return <span class="pd-svg pd-svg--fb" style={{ width: size + 'px', height: size + 'px', opacity: 0.55 }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(fb, { size: size, weight: props.weight, stroke: strokeW }) as string }} />
    return <span class="pd-ic-img pd-ic-img--ph" style={{ width: size + 'px', height: size + 'px', borderRadius: radius }} aria-hidden="true" />
  }
  const emoji = isEmoji(v)
  return (
    <span class={'pd-ic-txt' + (emoji ? ' pd-ic-txt--emoji' : '')} style={{ fontSize: Math.round(size * (emoji ? 1.05 : 0.8)) + 'px', lineHeight: 1 }}>
      {v}
    </span>
  )
}
