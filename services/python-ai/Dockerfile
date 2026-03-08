# ── Python AI Service ─────────────────────────────────────────────────────────
# Includes: GNN trainer (PyTorch Geometric), FalkorDB/Neo4j seeder,
#           CocoIndex pipeline, EPR-KGQA, ART reasoning, Ollama bridge
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    wget \
    git \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies in layers for better caching
COPY requirements.txt .

# Install CPU-only PyTorch first (smaller image, no CUDA needed for inference)
RUN pip install --no-cache-dir torch==2.2.0 --index-url https://download.pytorch.org/whl/cpu

# Install torch-geometric dependencies
RUN pip install --no-cache-dir \
    torch-scatter torch-sparse torch-cluster torch-spline-conv \
    -f https://data.pyg.org/whl/torch-2.2.0+cpu.html

# Install torch-geometric
RUN pip install --no-cache-dir torch-geometric

# Install remaining requirements
RUN pip install --no-cache-dir \
    fastapi==0.111.0 \
    uvicorn[standard]==0.29.0 \
    falkordb==1.0.9 \
    neo4j==5.19.0 \
    cocoindex==0.1.14 \
    ollama==0.2.1 \
    numpy==1.26.4 \
    scikit-learn==1.4.2 \
    psycopg2-binary==2.9.9 \
    httpx==0.27.0 \
    pydantic==2.7.1 \
    python-dotenv==1.0.1

# Copy source code
COPY . .

# Create models directory for GNN weights
RUN mkdir -p /app/models

ENV PORT=8099
ENV PYTHONUNBUFFERED=1

EXPOSE 8099

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8099"]
