import { useEffect, useRef, useState } from 'react'
import './App.css'
import SEO from './seoPages.json'
import { AdSlot, AdModal } from './Ads'
import { ADS } from './adConfig'

const API = import.meta.env.VITE_API_BASE || ''
const CURRENT = window.location.pathname.replace(/\/+$/, '') || '/'
const PAGE = SEO.pages.find((p) => p.path === CURRENT) || null
const LEGAL = SEO.pages.filter((p) => p.kind === 'info')
const emailText = (t) => t.replace('{{EMAIL}}', SEO.contactEmail)

function usePageMeta() {
  useEffect(() => {
    if (!PAGE) return
    document.title = PAGE.title
    let m = document.querySelector('meta[name="description"]')
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m) }
    m.content = PAGE.description
  }, [])
}

const formatDuration = (s) =>
  s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }

const Icon = {
  paste: (
    <svg viewBox="0 0 24 24" width="18" height="18" strokeWidth="2" {...stroke}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" width="20" height="20" strokeWidth="2.4" {...stroke}><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" /></svg>
  ),
}

const STEPS = [
  ['01', 'Copy the link', 'From the YouTube or Instagram app, tap Share and Copy link.'],
  ['02', 'Paste it here', 'Hit Download. Pick a different quality afterwards if you like.'],
  ['03', 'Save the file', 'It lands in your Downloads folder, ready to watch offline.'],
]

function Chrome({ children }) {
  return (
    <main>
      <nav className="nav">
        <a href="/" className="logo">vidsaver<i>.</i></a>
        <span className="nav-note">YouTube &amp; Instagram, free</span>
      </nav>

      {children}

      <footer>
        <div className="flinks">
          {LEGAL.map((p) => <a key={p.path} href={p.path}>{p.label}</a>)}
        </div>
        <p>
          Only download content you own or have permission to save. Respect copyright and each
          platform's terms. Private Instagram posts are not supported.
        </p>
      </footer>
    </main>
  )
}

function InfoPage() {
  usePageMeta()
  return (
    <Chrome>
      <header className="hero">
        <h1>{PAGE.h1}</h1>
        <p className="sub">{PAGE.sub}</p>
      </header>
      <article className="prose">
        {PAGE.article.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            <p>{s.p === '{{EMAIL}}' ? <a href={`mailto:${SEO.contactEmail}`}>{SEO.contactEmail}</a> : emailText(s.p)}</p>
          </section>
        ))}
      </article>
    </Chrome>
  )
}

function NotFound() {
  useEffect(() => { document.title = 'Page not found - VidSaver' }, [])
  return (
    <Chrome>
      <header className="hero">
        <h1>Page not found</h1>
        <p className="sub"><a href="/" className="inline">Go to the homepage</a></p>
      </header>
    </Chrome>
  )
}

export default function App() {
  if (!PAGE) return <NotFound />
  if (PAGE.kind === 'info') return <InfoPage />
  return <Tool />
}

function Tool() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null)
  const [quality, setQuality] = useState('')
  const [job, setJob] = useState(null)
  const [pending, setPending] = useState(null) // {q} while the pre-download ad is open
  const runRef = useRef(null) // the download in flight: {unlocked, cancelled, fileId}

  usePageMeta()

  async function pasteFromClipboard() {
    try {
      setUrl(await navigator.clipboard.readText())
    } catch {
      setError('Clipboard access blocked. Paste manually with Ctrl+V.')
    }
  }

  async function fetchInfo(e) {
    e.preventDefault()
    setError('')
    setInfo(null)
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInfo(data)
      // Start with 720p (small and fast); "Best" can be 4-5x bigger. Falls back to Best if nothing <= 720p.
      const first = String(data.heights.find((h) => h <= 720) ?? '')
      setQuality(first)
      setLoading(false)
      requestDownload(first)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 'premium' = above 1080p (unlock ad), 'hd' = 720p and up, 'normal' = everything else
  const tierOf = (q) => {
    if (q === 'thumb') return 'thumb'
    if (q === 'audio') return 'normal'
    const h = q === '' ? Math.max(0, ...(info?.heights || [])) : Number(q)
    if (h > ADS.premiumMinHeight) return 'premium'
    return q === '' || h >= ADS.hdMinHeight ? 'hd' : 'normal'
  }
  const adSeconds = {
    normal: ADS.preDownloadSeconds, hd: ADS.hdSeconds, premium: ADS.premiumSeconds, thumb: ADS.thumbnailSeconds,
  }

  function saveThumbnail() {
    window.location = `${API}/api/thumbnail?url=${encodeURIComponent(url.trim())}`
  }

  // The file is prepared on the server WHILE the ad plays; it is only handed to the
  // browser once the ad is finished (run.unlocked), so the wait is hidden but the ad still counts.
  function requestDownload(q = quality) {
    if (ADS.enabled) setPending({ q })
    beginDownload(q)
  }

  function saveFile(id) {
    window.location = `${API}/api/file/${id}`
    setTimeout(() => setJob(null), 2500)
  }

  function unlock() {
    const run = runRef.current
    if (!run) return
    run.unlocked = true
    if (run.fileId) saveFile(run.fileId)
  }

  function cancelDownload() {
    if (runRef.current) runRef.current.cancelled = true
    setJob(null)
  }

  async function beginDownload(q) {
    const run = { unlocked: !ADS.enabled, cancelled: false, fileId: null }
    runRef.current = run
    setError('')
    setJob({ status: 'downloading', percent: 0, speed: 0, eta: null })
    const body = { url: url.trim() }
    if (q === 'audio') body.kind = 'audio'
    else if (q) body.height = q
    try {
      const res = await fetch(`${API}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const { id, error: err } = await res.json()
      if (!res.ok) throw new Error(err)
      while (!run.cancelled) {
        await new Promise((r) => setTimeout(r, 500))
        if (run.cancelled) return
        const p = await (await fetch(`${API}/api/progress/${id}`)).json()
        if (p.error && p.status !== 'error') throw new Error(p.error)
        setJob(p)
        if (p.status === 'error') throw new Error(p.error)
        if (p.status === 'done') {
          run.fileId = id
          if (run.unlocked) saveFile(id)
          return
        }
      }
    } catch (err) {
      if (run.cancelled) return
      setPending(null)
      setError(err.message)
      setTimeout(() => setJob(null), 2500)
    }
  }

  const busy = job && job.status !== 'error'
  // shown inside the ad popup while the file is being prepared in the background
  const prep = !pending || pending.q === 'thumb' || !job ? '' :
    job.status === 'done' ? 'Your file is ready.' :
    job.status === 'processing' ? 'Almost ready, finishing up…' :
    `Preparing your file… ${Math.round(job.percent)}%`
  const mb = (b) => (b / 1048576).toFixed(1)
  const label = !job ? '' :
    job.status === 'processing' ? 'Merging video & audio…' :
    job.status === 'done' ? 'Done! Saving file…' :
    `${job.percent}%${job.speed ? ` · ${mb(job.speed)} MB/s` : ''}${job.eta ? ` · ${job.eta}s left` : ''}`

  const options = [
    { v: '', t: 'Best' },
    ...(info?.heights || []).map((h) => ({
      v: String(h), t: `${h}p`, ad: h > ADS.premiumMinHeight, size: info.sizes?.[h],
    })),
    { v: 'audio', t: 'Audio only' },
  ]

  return (
    <>
      <Chrome>
        <header className="hero">
          <h1>{PAGE.h1}{PAGE.h1grad && <> <mark>{PAGE.h1grad}</mark></>}</h1>
          <p className="sub">{PAGE.sub}</p>
        </header>

        <AdSlot slot="top" />

        <section className="panel">
          <form className="field" onSubmit={fetchInfo}>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={PAGE.placeholder}
              required
              autoFocus
            />
            <button type="button" className="ghost" onClick={pasteFromClipboard} title="Paste from clipboard">
              {Icon.paste}<span>Paste</span>
            </button>
            <button className="primary" disabled={loading || busy}>
              {loading || busy ? <span className="spinner" /> : null}
              <span>{loading ? 'Fetching' : busy ? 'Working' : 'Download'}</span>
            </button>
          </form>

          {error && <div className="err" role="alert">{error}</div>}

          {info && (
            <div className="result">
              <div className="thumb">
                {info.thumbnail && <img src={info.thumbnail} alt="" />}
                {info.duration ? <span className="dur">{formatDuration(info.duration)}</span> : null}
              </div>
              <div className="details">
                <div className="title">{info.title || 'Untitled'}</div>
                <div className="by">{info.uploader}</div>

                <div className="label">Quality</div>
                <div className="chips">
                  {options.map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      className={'chip' + (quality === o.v ? ' on' : '')}
                      onClick={() => setQuality(o.v)}
                    >
                      {o.t}
                      {o.size ? <small className="size">~{o.size >= 1e9 ? (o.size / 1e9).toFixed(1) + ' GB' : Math.round(o.size / 1e6) + ' MB'}</small> : null}
                      {o.ad && <small className="tag">Ad</small>}
                    </button>
                  ))}
                </div>

                <button className="primary big" onClick={() => requestDownload()} disabled={busy}>
                  {Icon.download}<span>{busy ? 'Working…' : 'Download again'}</span>
                </button>
                <button type="button" className="thumb-btn" onClick={() => (ADS.enabled ? setPending({ q: 'thumb' }) : saveThumbnail())}>
                  Download thumbnail<small className="tag">Ad</small>
                </button>

                {job && (
                  <div className="progress">
                    <div className="bar">
                      <div
                        className={'fill' + (job.status === 'processing' ? ' pulse' : '')}
                        style={{ width: `${job.status === 'processing' ? 100 : job.percent}%` }}
                      />
                    </div>
                    <div className="plabel">{label}</div>
                  </div>
                )}
                {job && <AdSlot slot="progress" />}
              </div>
            </div>
          )}
        </section>

        <AdSlot slot="middle" />

        <ol className="steps">
          {STEPS.map(([n, t, d]) => (
            <li key={n}>
              <b>{n}</b>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ol>

        <article className="prose">
          {PAGE.article.map((s) => (
            <section key={s.h}>
              <h2>{s.h}</h2>
              <p>{s.p}</p>
            </section>
          ))}
        </article>

        <section className="tools" aria-label="More downloaders">
          <h2>Other downloaders</h2>
          <div className="links">
            {SEO.pages.filter((p) => p.nav).map((p) => (
              <a key={p.path} href={p.path} className={p.path === PAGE.path ? 'on' : ''}>{p.label}</a>
            ))}
          </div>
        </section>

        <section className="faq">
          <h2>Frequently asked questions</h2>
          {SEO.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>

        <AdSlot slot="bottom" />

      </Chrome>

      <AdModal
        open={!!pending}
        tier={pending ? tierOf(pending.q) : 'normal'}
        seconds={pending ? adSeconds[tierOf(pending.q)] : ADS.preDownloadSeconds}
        onContinue={() => {
          const q = pending.q
          setPending(null)
          if (q === 'thumb') saveThumbnail()
          else unlock()
        }}
        onCancel={() => {
          if (pending.q !== 'thumb') cancelDownload()
          setPending(null)
        }}
        prep={prep}
      />
    </>
  )
}
