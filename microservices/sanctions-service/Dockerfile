# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM python:3.11-slim
RUN useradd -r -s /bin/false appuser
WORKDIR /app
COPY --from=builder /root/.local /home/appuser/.local
COPY . .
RUN chown -R appuser:appuser /app
USER appuser
ENV PATH=/home/appuser/.local/bin:$PATH
EXPOSE 8088 9088
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8088/health')" || exit 1
ENV PORT=8088 \
    METRICS_PORT=9088 \
    OFAC_LIST_URL=https://www.treasury.gov/ofac/downloads/sdn.xml \
    LOG_LEVEL=info
CMD ["python3", "main.py"]
