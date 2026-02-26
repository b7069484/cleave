#!/bin/bash
# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  cleave plugin v4.2 — Setup & Install                                   ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
#
# Installs the cleave plugin for Claude Code. Two modes:
#
#   1. Plugin mode (default):
#      Symlinks the plugin so `claude --plugin cleave` works.
#
#   2. Hooks-direct mode (--install-hooks):
#      Also installs hooks directly into ~/.claude/settings.json
#      for maximum reliability (workaround for Stop hook plugin bugs).
#
# Usage:
#   ./setup.sh                    # Plugin-only install
#   ./setup.sh --install-hooks    # Plugin + direct hooks install
#   ./setup.sh --uninstall        # Remove everything
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
PLUGINS_DIR="$CLAUDE_DIR/plugins"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

ACTION="install"
INSTALL_HOOKS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --install-hooks) INSTALL_HOOKS=true; shift ;;
        --uninstall) ACTION="uninstall"; shift ;;
        -h|--help)
            echo -e "${BOLD}cleave plugin v4.2 — setup${NC}"
            echo ""
            echo "  ./setup.sh                   Install plugin"
            echo "  ./setup.sh --install-hooks   Install plugin + direct hooks"
            echo "  ./setup.sh --uninstall       Remove everything"
            echo ""
            echo "Plugin features:"
            echo "  - Session relay with enforced handoff (Stop hook)"
            echo "  - Slash commands: /handoff, /status, /resume, /continue"
            echo "  - Auto-invoked handoff skill with configurable thresholds"
            echo "  - Relay orchestrator agent for automated mode"
            echo "  - Knowledge compaction and loop detection"
            echo "  - Compatible with cleave-sdk for full orchestration"
            exit 0 ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

# ── Install ───────────────────────────────────────────────────────────────────
if [ "$ACTION" = "install" ]; then
    echo -e "${BOLD}Installing cleave plugin v4.2...${NC}"

    # Create plugins directory
    mkdir -p "$PLUGINS_DIR"

    # Symlink or copy the plugin
    LINK_TARGET="$PLUGINS_DIR/cleave"
    if [ -L "$LINK_TARGET" ] || [ -d "$LINK_TARGET" ]; then
        rm -rf "$LINK_TARGET"
    fi
    ln -sf "$PLUGIN_DIR" "$LINK_TARGET"
    echo -e "  ${GREEN}✓${NC} Plugin linked: $LINK_TARGET → $PLUGIN_DIR"

    # Make scripts executable
    chmod +x "$PLUGIN_DIR/scripts/"*.sh
    echo -e "  ${GREEN}✓${NC} Scripts marked executable"

    # Direct hooks installation
    if [ "$INSTALL_HOOKS" = true ]; then
        echo ""
        echo -e "${BOLD}Installing hooks directly into settings.json...${NC}"
        echo -e "  ${DIM}(Workaround for Claude Code plugin hook bugs)${NC}"

        # Ensure settings.json exists
        mkdir -p "$CLAUDE_DIR"
        if [ ! -f "$SETTINGS_FILE" ]; then
            echo '{}' > "$SETTINGS_FILE"
        fi

        # Use python3 to safely merge hooks into settings
        python3 << PYEOF
import json, sys

settings_path = "$SETTINGS_FILE"
plugin_dir = "$PLUGIN_DIR"

try:
    with open(settings_path) as f:
        settings = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    settings = {}

# Ensure hooks structure exists
if "hooks" not in settings:
    settings["hooks"] = {}

# Add Stop hook
stop_hooks = settings["hooks"].get("Stop", [])
# Check if cleave hook already installed
cleave_stop_exists = any(
    "cleave" in str(h.get("hooks", [{}])[0].get("command", ""))
    for h in stop_hooks
    if isinstance(h, dict) and "hooks" in h
)

if not cleave_stop_exists:
    stop_hooks.append({
        "hooks": [{
            "type": "command",
            "command": f"{plugin_dir}/scripts/stop-check.sh",
            "timeout": 10
        }]
    })
    settings["hooks"]["Stop"] = stop_hooks
    print("  ✓ Stop hook installed")
else:
    print("  ⏭ Stop hook already installed")

# Add SessionStart hook
start_hooks = settings["hooks"].get("SessionStart", [])
cleave_start_exists = any(
    "cleave" in str(h.get("hooks", [{}])[0].get("command", ""))
    for h in start_hooks
    if isinstance(h, dict) and "hooks" in h
)

if not cleave_start_exists:
    start_hooks.append({
        "hooks": [{
            "type": "command",
            "command": f"{plugin_dir}/scripts/session-start.sh",
            "timeout": 5
        }]
    })
    settings["hooks"]["SessionStart"] = start_hooks
    print("  ✓ SessionStart hook installed")
else:
    print("  ⏭ SessionStart hook already installed")

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)

print(f"  ✓ Written to {settings_path}")
PYEOF
    fi

    echo ""
    echo -e "${GREEN}${BOLD}Installation complete!${NC}"
    echo ""
    echo -e "Usage with plugin flag:"
    echo -e "  ${DIM}claude --plugin cleave${NC}"
    echo ""
    echo -e "Slash commands (inside a session):"
    echo -e "  ${DIM}/handoff    — Force immediate handoff${NC}"
    echo -e "  ${DIM}/status     — Show relay progress${NC}"
    echo -e "  ${DIM}/resume     — Continue from last handoff${NC}"
    echo -e "  ${DIM}/continue   — Start new task (preserves knowledge)${NC}"
    echo ""
    echo -e "For automated relay, use the SDK:"
    echo -e "  ${DIM}npx cleave-sdk prompt.md${NC}"

# ── Uninstall ─────────────────────────────────────────────────────────────────
elif [ "$ACTION" = "uninstall" ]; then
    echo -e "${BOLD}Uninstalling cleave plugin...${NC}"

    # Remove symlink
    if [ -L "$PLUGINS_DIR/cleave" ]; then
        rm "$PLUGINS_DIR/cleave"
        echo -e "  ${GREEN}✓${NC} Plugin symlink removed"
    fi

    # Remove hooks from settings.json
    if [ -f "$SETTINGS_FILE" ]; then
        python3 << 'PYEOF'
import json, os

settings_path = os.path.expanduser("~/.claude/settings.json")

try:
    with open(settings_path) as f:
        settings = json.load(f)
except:
    exit(0)

changed = False
for event in ["Stop", "SessionStart"]:
    hooks = settings.get("hooks", {}).get(event, [])
    new_hooks = [
        h for h in hooks
        if not any("cleave" in str(inner.get("command", ""))
                    for inner in h.get("hooks", [])
                    if isinstance(inner, dict))
    ]
    if len(new_hooks) != len(hooks):
        settings.setdefault("hooks", {})[event] = new_hooks
        changed = True
        print(f"  ✓ {event} hook removed")

if changed:
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=2)
PYEOF
    fi

    echo -e "${GREEN}${BOLD}Uninstall complete.${NC}"
fi
