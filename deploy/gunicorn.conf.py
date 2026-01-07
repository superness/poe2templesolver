# Gunicorn configuration for POE2 Temple Solver
# Optimized for $12/mo DigitalOcean droplet (1 vCPU, 2GB RAM)

import multiprocessing

# Bind to localhost - nginx will proxy
bind = "127.0.0.1:5000"

# Workers - 1 for single vCPU (CPU-bound solver)
workers = 1

# Threads - allow concurrent requests while solve is running
threads = 4

# Worker class - gthread for threaded workers
worker_class = "gthread"

# Timeout - solver can take up to 120s, give buffer
timeout = 180

# Keep-alive
keepalive = 5

# Logging
# Logging - use /dev/stdout for local testing, files for production
import os
if os.path.exists('/var/log/temple-solver'):
    accesslog = "/var/log/temple-solver/access.log"
    errorlog = "/var/log/temple-solver/error.log"
else:
    accesslog = "-"
    errorlog = "-"
loglevel = "info"

# Process naming
proc_name = "temple-solver"

# Graceful timeout
graceful_timeout = 30

# Max requests per worker before restart (prevents memory leaks)
# Set high to avoid restart mid-solve - solves generate many poll requests
max_requests = 10000
max_requests_jitter = 1000
