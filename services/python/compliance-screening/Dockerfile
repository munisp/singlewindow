FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s CMD curl -sf http://localhost:8099/v1/health || exit 1
CMD ["python", "main.py"]
