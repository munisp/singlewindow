FROM python:3.12-slim

WORKDIR /app

# System dependencies for OpenCV and Tesseract
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libzbar0 \
    tesseract-ocr \
    tesseract-ocr-eng \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download YOLOv8n base model (will be replaced by custom cargo model in production)
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" || true

# Create model directory
RUN mkdir -p /app/models

COPY main.py .

HEALTHCHECK --interval=30s --timeout=15s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8092}/health || exit 1

EXPOSE 8092

ENV PORT=8092 \
    DEVICE=cpu \
    OLLAMA_BASE_URL=http://ollama:11434

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8092", "--workers", "2"]
