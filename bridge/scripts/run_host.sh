#!/bin/bash
# UnderPixel Bridge — Native Messaging host wrapper for Unix/macOS
# Discovers Node.js and launches the bridge entry point

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRY="$SCRIPT_DIR/../dist/index.js"

# Priority 1: UNDERPIXEL_NODE_PATH environment variable
if [ -n "$UNDERPIXEL_NODE_PATH" ] && [ -x "$UNDERPIXEL_NODE_PATH" ]; then
    exec "$UNDERPIXEL_NODE_PATH" "$ENTRY"
fi

# Priority 2: Volta
if [ -n "$VOLTA_HOME" ] && [ -x "$VOLTA_HOME/bin/node" ]; then
    exec "$VOLTA_HOME/bin/node" "$ENTRY"
fi

# Priority 3: NVM
if [ -n "$NVM_DIR" ]; then
    LATEST_NODE=$(ls -d "$NVM_DIR/versions/node/"v* 2>/dev/null | sort -V | tail -1)
    if [ -n "$LATEST_NODE" ] && [ -x "$LATEST_NODE/bin/node" ]; then
        exec "$LATEST_NODE/bin/node" "$ENTRY"
    fi
fi

# Priority 4: fnm
if [ -d "$HOME/.fnm/node-versions" ]; then
    LATEST_NODE=$(ls -d "$HOME/.fnm/node-versions/"v* 2>/dev/null | sort -V | tail -1)
    if [ -n "$LATEST_NODE" ] && [ -x "$LATEST_NODE/installation/bin/node" ]; then
        exec "$LATEST_NODE/installation/bin/node" "$ENTRY"
    fi
fi

# Priority 5: asdf
if [ -d "$HOME/.asdf/installs/nodejs" ]; then
    LATEST_NODE=$(ls -d "$HOME/.asdf/installs/nodejs/"[0-9]* 2>/dev/null | sort -V | tail -1)
    if [ -n "$LATEST_NODE" ] && [ -x "$LATEST_NODE/bin/node" ]; then
        exec "$LATEST_NODE/bin/node" "$ENTRY"
    fi
fi

# Priority 6: Common system paths
for NODE_PATH in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$NODE_PATH" ]; then
        exec "$NODE_PATH" "$ENTRY"
    fi
done

# Priority 7: PATH lookup
if command -v node >/dev/null 2>&1; then
    exec node "$ENTRY"
fi

echo "ERROR: Node.js not found. Install Node.js 20+ and try again." >&2
exit 1
