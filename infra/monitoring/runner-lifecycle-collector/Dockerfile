FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LISTEN_HOST=0.0.0.0 \
    LISTEN_PORT=9090

RUN groupadd --system collector && useradd --system --gid collector --home-dir /nonexistent --shell /usr/sbin/nologin collector
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY collector.py .
RUN chown -R collector:collector /app
USER collector
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9090/healthz', timeout=3)"
ENTRYPOINT ["python", "/app/collector.py"]
