#!/bin/bash
# POE2 Temple Solver - Deployment Script
# Run locally to deploy updates to server
# Usage: ./deploy.sh user@server-ip

set -e

if [ -z "$1" ]; then
    echo "Usage: ./deploy.sh user@server-ip"
    exit 1
fi

SERVER=$1

echo "=========================================="
echo "POE2 Temple Solver - Deploy"
echo "=========================================="

# Build frontend
echo "[1/4] Building frontend..."
cd "$(dirname "$0")/../web"
npm run build

# Create deployment package
echo "[2/4] Creating deployment package..."
cd ..
tar -czf /tmp/temple-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='venv' \
    --exclude='.git' \
    --exclude='__pycache__' \
    solver-python/ \
    deploy/ \
    web/dist/

# Upload to server
echo "[3/4] Uploading to server..."
scp /tmp/temple-deploy.tar.gz $SERVER:/tmp/

# Deploy on server
echo "[4/4] Deploying on server..."
ssh $SERVER << 'ENDSSH'
    set -e
    cd /opt/temple-solver
    sudo tar -xzf /tmp/temple-deploy.tar.gz --strip-components=0
    sudo cp -r web/dist/* /var/www/temple-solver/
    sudo chown -R www-data:www-data /opt/temple-solver
    sudo chown -R www-data:www-data /var/www/temple-solver
    sudo systemctl restart temple-solver
    rm /tmp/temple-deploy.tar.gz
    echo "Deployment complete!"
    sudo systemctl status temple-solver --no-pager
ENDSSH

rm /tmp/temple-deploy.tar.gz

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
