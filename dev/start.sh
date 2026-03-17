#!/bin/bash
# Start the dev environment for debugging overlay + transaction issues.
#
# Prerequisites:
#   - Regtest node running on localhost:18332
#   - MongoDB running on localhost:27017
#
# Usage:
#   cd dev && ./start.sh              # Check deps + start overlay
#   cd dev && npm test                 # Run pipeline tests (separate terminal)

set -e

DEV_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DEV_DIR/.." && pwd)

RPC_URL=${RPC_URL:-http://localhost:18332}
RPC_USER=${RPC_USER:-bitcoin}
RPC_PASS=${RPC_PASS:-bitcoin}
MONGODB_URI=${MONGODB_URI:-mongodb://localhost:27017}

rpc() {
  curl -s -u "$RPC_USER:$RPC_PASS" \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"dev\",\"method\":\"$1\",\"params\":[$2]}" \
    -H 'Content-Type: application/json' "$RPC_URL" 2>/dev/null
}

echo "=== Tic-Tac-Toe Regtest Dev Environment ==="
echo ""

# Check regtest node
echo -n "Regtest node... "
RESULT=$(rpc getblockcount "")
HEIGHT=$(echo "$RESULT" | grep -o '"result":[0-9]*' | grep -o '[0-9]*')
if [ -z "$HEIGHT" ]; then
  echo "NOT RUNNING"
  echo "  Start with: cd runar/integration && ./regtest.sh start"
  exit 1
fi
echo "OK (height: $HEIGHT)"

# Mine blocks if needed
if [ "$HEIGHT" -lt 101 ]; then
  NEEDED=$((101 - HEIGHT))
  echo "  Mining $NEEDED blocks for coinbase maturity..."
  rpc generate "$NEEDED" > /dev/null
fi

# Check MongoDB
echo -n "MongoDB... "
if mongosh --quiet --eval "db.runCommand({ping:1})" "$MONGODB_URI" > /dev/null 2>&1; then
  echo "OK"
else
  echo "NOT RUNNING"
  echo "  Start with: mongod --dbpath ./data/db"
  exit 1
fi

echo ""

# Install dev test deps if needed
if [ ! -d "$DEV_DIR/node_modules" ]; then
  echo "Installing dev test dependencies..."
  cd "$DEV_DIR" && npm install
fi

# Start overlay in regtest mode
echo "Starting overlay in regtest mode..."
cd "$ROOT/overlay"
if [ ! -d "node_modules" ]; then
  npm install
fi

OVERLAY_PRIVATE_KEY=${OVERLAY_PRIVATE_KEY:-$(openssl rand -hex 32)}

REGTEST=true \
  MONGODB_URI="$MONGODB_URI" \
  OVERLAY_PRIVATE_KEY="$OVERLAY_PRIVATE_KEY" \
  RPC_URL="$RPC_URL" \
  RPC_USER="$RPC_USER" \
  RPC_PASS="$RPC_PASS" \
  npx tsx watch src/index.ts &

OVERLAY_PID=$!

echo ""
echo "Overlay PID: $OVERLAY_PID"
echo "Overlay URL: http://localhost:8081"
echo ""
echo "Run tests in another terminal:"
echo "  cd dev && npm test"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $OVERLAY_PID 2>/dev/null; exit 0" INT TERM
wait $OVERLAY_PID
