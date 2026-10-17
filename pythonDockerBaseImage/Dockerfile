# Python Services Container (analytics + weekly challenge + vocal lesson creator)
FROM python:3.14-alpine

# Create non-root user
RUN addgroup -g 1000 appuser && \
    adduser -u 1000 -G appuser -D appuser

# Set working directory
WORKDIR /app

# Install system dependencies (as root)
RUN apk add --no-cache ffmpeg

# Create virtual environment (as root) and use it
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Disable Python output buffering
ENV PYTHONUNBUFFERED=1

# Copy requirements files
COPY pythonDockerBaseImage/requirements.txt base-requirements.txt


# Install Python dependencies into the venv (as root)
RUN pip install --no-cache-dir -r base-requirements.txt 

# Switch to non-root user
USER appuser

# Copy application code (with correct ownership)
COPY --chown=appuser:appuser analytics/*.py .


# Default command
CMD ["python", "-u", "analyze_weaknesses.py"]