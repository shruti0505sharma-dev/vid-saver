import { useEffect, useState } from 'react'
import { ADS } from './adConfig'

function useIsMobile() {
  const query = '(max-width: 680px)'
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = (e) => setMobile(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}

export function AdSlot({ slot }) {
  const isMobile = useIsMobile()
  const base = ADS.slots[slot]
  if (!ADS.enabled || !base) return null

  const cfg = isMobile && base.mobile ? base.mobile : base
  const { width, height, code } = cfg
  if (!code && !ADS.showPlaceholders) return null // nothing to show yet

  // Ad code runs inside an isolated iframe so it can't touch the page.
  const doc = `<!doctype html><html><body style="margin:0;display:flex;justify-content:center;background:transparent">${code}</body></html>`

  return (
    <div className={`ad ad-${slot}`}>
      <span className="ad-tag">Advertisement</span>
      {code ? (
        <iframe
          title={`ad-${slot}`}
          srcDoc={doc}
          width={width}
          height={height}
          scrolling="no"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        />
      ) : (
        <div className="ad-ph" style={{ width, height }}>Ad space {width}×{height}</div>
      )}
    </div>
  )
}

const COPY = {
  normal: ['Your download is almost ready', 'A short ad keeps this tool free.'],
  hd: ['Preparing your HD download', 'HD is free. A short ad keeps the site running.'],
  premium: ['Watch an ad to unlock this quality', 'Qualities above 1080p (2K / 4K) need one ad to be watched first.'],
  thumb: ['Watch an ad to get the thumbnail', 'One short ad, then the full-size thumbnail is yours.'],
}
const UNLOCK_TIERS = ['premium', 'thumb']

// The body mounts fresh on every open, so the countdown always starts from `seconds`.
export function AdModal({ open, ...rest }) {
  return open ? <ModalBody {...rest} /> : null
}

function ModalBody({ seconds, tier, prep, onContinue, onCancel }) {
  const [left, setLeft] = useState(seconds)

  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const pct = seconds ? ((seconds - left) / seconds) * 100 : 100

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{COPY[tier][0]}</h3>
        <p>{COPY[tier][1]}</p>
        <AdSlot slot="interstitial" />
        <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
        <button className="primary big" disabled={left > 0} onClick={onContinue}>
          {left > 0
            ? `${UNLOCK_TIERS.includes(tier) ? 'Unlocks' : 'Continue'} in ${left}s`
            : UNLOCK_TIERS.includes(tier) ? 'Unlock & download' : 'Continue to download'}
        </button>
        {prep && <p className="prep">{prep}</p>}
        <button type="button" className="linkbtn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
