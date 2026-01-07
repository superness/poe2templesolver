# Gunicorn configuration for POE2 Temple Solver
# Optimized for $12/mo DigitalOcean droplet (1 vCPU, 2GB RAM)

import multiprocessing

# Bind to localhost - nginx will proxy
bind = "127.0.0.1:5000"

# Workers - 1 for single vCPU (CPU-bound solver)
workers = 1

# Worker class - sync is fine for long-running CPU tasks
worker_class = "sync"

# Timeout - solver can take up to 60s, give buffer
timeout = 120

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
max_requests = 100
max_requests_jitter = 20
