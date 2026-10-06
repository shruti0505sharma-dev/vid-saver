import os
import re
import shutil
import tempfile
import threading
import time
import urllib.request
import uuid
from urllib.parse import urlparse

from flask import Flask, Response, after_this_request, jsonify, request, send_file
from werkzeug.security import safe_join
import imageio_ffmpeg
import yt_dlp

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, "frontend", "dist")

app = Flask(__name__, static_folder=os.path.join(DIST, "assets"), static_url_path="/assets")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

ALLOWED_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com",
    "instagram.com", "www.instagram.com",
}


def valid_url(url: str) -> bool:
    try:
        p = urlparse(url)
    except ValueError:
        return False
    return p.scheme in ("http", "https") and (p.hostname or "").lower() in ALLOWED_HOSTS


def base_opts():
    return {"quiet": True, "no_warnings": True, "noplaylist": True}


ALLOWED_ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "").split(",") if o.strip()}


@app.after_request
def cors(resp):
    """Only needed when the React site is hosted elsewhere (e.g. Vercel)."""
    origin = request.headers.get("Origin")
    if origin and origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Vary"] = "Origin"
    return resp


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def preflight(_any):
    return "", 204


@app.get("/", defaults={"filename": ""})
@app.get("/<path:filename>")
def site(filename):
    """Serve the pre-rendered pages (dist/<path>/index.html), assets, sitemap, robots."""
    target = safe_join(DIST, filename) if filename else DIST
    if target and os.path.isdir(target):
        target = os.path.join(target, "index.html")
    if filename.startswith("api/") or not target or not os.path.isfile(target):
        page404 = os.path.join(DIST, "404.html")
        if os.path.isfile(page404):
            return send_file(page404), 404
        return "Not found (frontend not built: cd frontend && npm run build)", 404
    return send_file(target)


def format_for(kind: str, height) -> str:
    """The yt-dlp format string for a download request."""
    if kind == "audio":
        return "bestaudio[ext=m4a]/bestaudio/best"
    if str(height).isdigit() and int(height) > 1080:
        # YouTube only offers 1440p/4K as VP9/AV1, never as H.264 mp4, so don't force the mp4 codec.
        # ffmpeg still merges it into an .mp4 file.
        h = f"[height<={int(height)}]"
        return f"bestvideo{h}+bestaudio/best{h}/best"
    h = f"[height<={int(height)}]" if str(height).isdigit() else ""
    return f"bestvideo{h}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{h}+bestaudio/best{h}/best"


def estimate_sizes(ydl, data: dict, heights: list) -> dict:
    """Approximate download size (bytes) per height, using the same format choice the download will make."""
    dur = data.get("duration") or 0
    # YouTube rarely reports a size, so fall back to bitrate (kbit/s) x duration.
    size = lambda f: (f.get("filesize") or f.get("filesize_approx")
                      or int((f.get("tbr") or 0) * 1000 / 8 * dur))
    out = {}
    for h in heights:
        try:
            pick = next(ydl.build_format_selector(format_for("video", h))(
                {"formats": data.get("formats") or [], "incomplete_formats": False}), None)
        except Exception:
            continue
        if pick:
            total = sum(size(f) for f in (pick.get("requested_formats") or [pick]))
            if total:
                out[str(h)] = total
    return out


@app.post("/api/info")
def info():
    url = (request.json or {}).get("url", "").strip()
    if not valid_url(url):
        return jsonify(error="Please paste a valid YouTube or Instagram link."), 400
    try:
        with yt_dlp.YoutubeDL(base_opts()) as ydl:
            data = ydl.extract_info(url, download=False)
            heights = sorted(
                {f["height"] for f in data.get("formats", [])
                 if f.get("height") and f.get("vcodec") not in (None, "none")},
                reverse=True,
            )
            sizes = estimate_sizes(ydl, data, heights)
    except Exception as e:
        return jsonify(error=clean_error(e)), 400

    return jsonify(
        title=data.get("title"),
        uploader=data.get("uploader"),
        duration=data.get("duration"),
        thumbnail=data.get("thumbnail"),
        heights=heights,
        sizes=sizes,
    )


JOBS = {}  # id -> dict(status, percent, speed, eta, dir, file, error, created)
JOB_TTL = 20 * 60  # seconds an unclaimed job (user left or cancelled) is kept


def reap_jobs():
    """Delete temp files of jobs nobody downloaded (the file is prefetched while the ad plays)."""
    while True:
        time.sleep(60)
        now = time.time()
        for job_id, job in list(JOBS.items()):
            if job["status"] != "downloading" and now - job["created"] > JOB_TTL:
                shutil.rmtree(job["dir"], ignore_errors=True)
                JOBS.pop(job_id, None)


threading.Thread(target=reap_jobs, daemon=True).start()


def keep_awake(base_url: str):
    """Render's free plan sleeps a web service after ~15 min without incoming requests.
    Calling our own public URL every 10 min counts as incoming traffic, so it never idles."""
    while True:
        time.sleep(10 * 60)
        try:
            urllib.request.urlopen(base_url.rstrip("/") + "/health", timeout=20).read()
        except Exception:
            pass  # next round will try again


# RENDER_EXTERNAL_URL is set by Render itself; locally it is absent, so nothing starts.
_self_url = os.environ.get("RENDER_EXTERNAL_URL")
if _self_url:
    threading.Thread(target=keep_awake, args=(_self_url,), daemon=True).start()


@app.get("/health")
def health():
    return "ok", 200, {"Cache-Control": "no-store"}


def run_job(job_id, url, kind, height):
    job = JOBS[job_id]

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            job["percent"] = round(d["downloaded_bytes"] / total * 100, 1) if total else 0
            job["speed"] = d.get("speed") or 0
            job["eta"] = d.get("eta")

    def pp_hook(d):
        if d["status"] == "started":
            job["status"] = "processing"  # merging video + audio

    opts = base_opts() | {
        "outtmpl": os.path.join(job["dir"], "%(title).80s.%(ext)s"),
        "ffmpeg_location": FFMPEG,
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
        "postprocessor_hooks": [pp_hook],
        "concurrent_fragment_downloads": 8,
    }
    opts["format"] = format_for(kind, height)

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
        files = os.listdir(job["dir"])
        if not files:
            raise RuntimeError("Download failed.")
        job["file"] = files[0]
        job["percent"] = 100
        job["status"] = "done"
    except Exception as e:
        job["error"] = clean_error(e)
        job["status"] = "error"


MAX_THUMB_BYTES = 15 * 1024 * 1024


def best_thumbnail_url(data: dict) -> str | None:
    """Largest thumbnail yt-dlp reports; prefers jpg/png over webp."""
    thumbs = [t for t in data.get("thumbnails") or [] if t.get("url", "").startswith("https://")]
    plain = [t for t in thumbs if not re.search(r"\.webp(\?|$)|/vi_webp/", t["url"])]
    pool = plain or thumbs
    if pool:
        best = max(pool, key=lambda t: ((t.get("width") or 0) * (t.get("height") or 0), t.get("preference") or 0))
        return best["url"]
    t = data.get("thumbnail") or ""
    return t if t.startswith("https://") else None


@app.get("/api/thumbnail")
def thumbnail():
    url = request.args.get("url", "").strip()
    if not valid_url(url):
        return jsonify(error="Invalid link."), 400
    try:
        with yt_dlp.YoutubeDL(base_opts()) as ydl:
            data = ydl.extract_info(url, download=False)
        turl = best_thumbnail_url(data)
        if not turl:
            return jsonify(error="No thumbnail found for this video."), 404
        req = urllib.request.Request(turl, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read(MAX_THUMB_BYTES + 1)
            ctype = r.headers.get_content_type()
    except Exception as e:
        return jsonify(error=clean_error(e)), 400
    if len(body) > MAX_THUMB_BYTES or not ctype.startswith("image/"):
        return jsonify(error="Thumbnail could not be downloaded."), 400

    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(ctype, "jpg")
    name = re.sub(r"[^A-Za-z0-9 _-]+", "", data.get("title") or "")[:60].strip() or "thumbnail"
    return Response(body, mimetype=ctype,
                    headers={"Content-Disposition": f'attachment; filename="{name}-thumbnail.{ext}"'})


@app.post("/api/start")
def start():
    body = request.json or {}
    url = body.get("url", "").strip()
    if not valid_url(url):
        return jsonify(error="Invalid link."), 400
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"status": "downloading", "percent": 0, "speed": 0, "eta": None,
                    "dir": tempfile.mkdtemp(prefix="dl_"), "file": None, "error": None,
                    "created": time.time()}
    threading.Thread(target=run_job, daemon=True,
                     args=(job_id, url, body.get("kind", "video"), body.get("height", ""))).start()
    return jsonify(id=job_id)


@app.get("/api/progress/<job_id>")
def progress(job_id):
    job = JOBS.get(job_id)
    if not job:
        return jsonify(error="Unknown job."), 404
    return jsonify({k: job[k] for k in ("status", "percent", "speed", "eta", "error")})


@app.get("/api/file/<job_id>")
def get_file(job_id):
    job = JOBS.get(job_id)
    if not job or job["status"] != "done":
        return jsonify(error="File not ready."), 404

    @after_this_request
    def cleanup(resp):
        def rm():
            shutil.rmtree(job["dir"], ignore_errors=True)
            JOBS.pop(job_id, None)
        resp.call_on_close(rm)
        return resp

    return send_file(os.path.join(job["dir"], job["file"]), as_attachment=True, download_name=job["file"])


def clean_error(e: Exception) -> str:
    msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e))
    msg = msg.replace("ERROR: ", "")
    return msg[:300]


if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), threaded=True)
