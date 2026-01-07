#!/bin/bash
# POE2 Temple Solver - Server Setup Script
# Run on fresh Ubuntu 22.04+ DigitalOcean droplet
# Usage: sudo bash setup-server.sh

set -e

echo "=========================================="
echo "POE2 Temple Solver - Server Setup"
echo "=========================================="

# Check root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo bash setup-server.sh)"
    exit 1
fi

# Update system
echo "[1/8] Updating system packages..."
apt update && apt upgrade -y

# Install dependencies
echo "[2/8] Installing dependencies..."
apt install -y python3 python3-pip python3-venv nginx git

# Create directories
echo "[3/8] Creating directories..."
mkdir -p /opt/temple-solver
mkdir -p /var/log/temple-solver
mkdir -p /var/www/temple-solver

# Clone or copy repository
echo "[4/8] Setting up application..."
if [ -d "/tmp/poe2templerobbit" ]; then
    cp -r /tmp/poe2templerobbit/* /opt/temple-solver/
else
    echo "Please copy the repository to /tmp/poe2templerobbit first"
    echo "Or clone it: git clone <your-repo> /opt/temple-solver"
    exit 1
fi

# Setup Python virtual environment
echo "[5/8] Setting up Python environment..."
cd /opt/temple-solver
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install flask flask-cors gunicorn ortools

# Copy frontend build
echo "[6/8] Copying frontend files..."
if [ -d "/opt/temple-solver/web/dist" ]; then
    cp -r /opt/temple-solver/web/dist/* /var/www/temple-solver/
else
    echo "Warning: Frontend not built. Run 'npm run build' in web/ first"
fi

# Setup Nginx
echo "[7/8] Configuring Nginx..."
cp /opt/temple-solver/deploy/nginx.conf /etc/nginx/sites-available/temple-solver
ln -sf /etc/nginx/sites-available/temple-solver /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Setup systemd service
echo "[8/8] Setting up systemd service..."
cp /opt/temple-solver/deploy/temple-solver.service /etc/systemd/system/
chown -R www-data:www-data /opt/temple-solver
chown -R www-data:www-data /var/log/temple-solver
chown -R www-data:www-data /var/www/temple-solver
systemctl daemon-reload
systemctl enable temple-solver
systemctl start temple-solver

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Service status:"
systemctl status temple-solver --no-pager
echo ""
echo "Next steps:"
echo "1. Update nginx.conf with your domain name"
echo "2. Setup SSL: certbot --nginx -d your-domain.com"
echo "3. Configure firewall: ufw allow 'Nginx Full'"
echo ""
echo "Useful commands:"
echo "  systemctl status temple-solver  - Check service status"
echo "  journalctl -u temple-solver -f  - View logs"
echo "  systemctl restart temple-solver - Restart service"
echo ""
