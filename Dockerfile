# ── 1) build the React site (and the pre-rendered SEO pages) ──
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Your public address, used for canonical links and sitemap.xml.
# On Render: set SITE_URL in the service's Environment tab.
ARG SITE_URL=http://localhost:10000
ENV SITE_URL=$SITE_URL
RUN npm run build

# ── 2) run the Flask backend that also serves the built site ──
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY --from=web /web/dist ./frontend/dist

ENV PORT=10000
EXPOSE 10000
# One worker on purpose: download progress lives in memory, so every request must hit the same process.
CMD gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --threads 16 --timeout 600
