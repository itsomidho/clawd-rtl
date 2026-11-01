#!/usr/bin/env bash
# Sets up clawd-rtl on this machine: the plugin, the Vazir Code font as the
# fallback for your terminal's font, and (for fish) the `claude` wrapper and
# the terminal's direction detection in the shell.
#
#   bash setup.sh            # everything
#   bash setup.sh --no-shell # leave fish alone
#
# Safe to run again: each step checks first and backs up a file before
# changing it (<file>.bak-clawd-rtl).
set -euo pipefail

SHELL_STEP=1
[[ ${1:-} == --no-shell ]] && SHELL_STEP=0
RAW=https://raw.githubusercontent.com/itsomidho/clawd-rtl/main
say() { printf '\033[1m%s\033[0m %s\n' "$1" "$2"; }
backup() { [[ -f $1 && ! -f $1.bak-clawd-rtl ]] && cp "$1" "$1.bak-clawd-rtl" || true; }

# 1. The plugin.
if command -v claude >/dev/null; then
  markets=$(claude plugin marketplace list 2>/dev/null || true)
  plugins=$(claude plugin list 2>/dev/null || true)
  if ! grep -q itsomidho <<<"$markets"; then
    claude plugin marketplace add itsomidho/claude-plugins >/dev/null
  else
    claude plugin marketplace update itsomidho >/dev/null
  fi
  if grep -q 'clawd-rtl@itsomidho' <<<"$plugins"; then
    claude plugin update clawd-rtl@itsomidho >/dev/null && say plugin "clawd-rtl updated"
  else
    claude plugin install clawd-rtl@itsomidho >/dev/null && say plugin "clawd-rtl installed"
  fi
else
  say plugin "skipped: claude is not on PATH"
fi

# 2. The font.
FONT_DIR=$HOME/.local/share/fonts/VazirCode
fonts=$(fc-list 2>/dev/null || true)
if grep -q 'Vazir Code' <<<"$fonts"; then
  say font "Vazir Code already installed"
else
  tmp=$(mktemp -d)
  url=$(curl -fsSL https://api.github.com/repos/rastikerdar/vazir-code-font/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*\.zip"' | head -1 | cut -d'"' -f4)
  curl -fsSL -o "$tmp/v.zip" "$url"
  unzip -oq "$tmp/v.zip" -d "$tmp/x"
  mkdir -p "$FONT_DIR"
  cp "$(find "$tmp/x" -name 'Vazir-Code.ttf' | head -1)" "$FONT_DIR/"
  rm -rf "$tmp"
  say font "Vazir Code installed"
fi

# The terminal's font: Guake's, else GNOME Terminal's, else the desktop's monospace.
family=""
if command -v dconf >/dev/null; then
  if [[ $(dconf read /org/guake/general/use-default-font 2>/dev/null) == false ]]; then
    family=$(dconf read /org/guake/style/font/style 2>/dev/null | tr -d "'")
  fi
  if [[ -z $family ]] && command -v gsettings >/dev/null; then
    profile=$(gsettings get org.gnome.Terminal.ProfilesList default 2>/dev/null | tr -d "'" || true)
    if [[ -n $profile ]]; then
      path="org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:$profile/"
      if [[ $(gsettings get "$path" use-system-font 2>/dev/null) == false ]]; then
        family=$(gsettings get "$path" font 2>/dev/null | tr -d "'")
      fi
    fi
  fi
fi
if [[ -z $family ]] && command -v gsettings >/dev/null; then
  family=$(gsettings get org.gnome.desktop.interface monospace-font-name 2>/dev/null | tr -d "'" || true)
fi
family=$(sed -E 's/ +[0-9.]+$//' <<<"$family")   # "FiraCode Nerd Font 10" → "FiraCode Nerd Font"
[[ -z $family ]] && family=monospace

CONF=$HOME/.config/fontconfig/fonts.conf
alias_xml="  <!-- clawd-rtl: Persian falls back to Vazir Code -->
  <alias binding=\"strong\">
    <family>$family</family>
    <prefer>
      <family>$family</family>
      <family>Vazir Code</family>
    </prefer>
  </alias>"
mkdir -p "$(dirname "$CONF")"
if [[ $family == "Vazir Code"* ]]; then
  say fontconfig "not needed: the terminal already uses Vazir Code"
elif [[ -f $CONF ]] && grep -q "<family>$family</family>" "$CONF" && grep -q 'Vazir Code' "$CONF"; then
  say fontconfig "already set for \"$family\""
elif [[ -f $CONF ]] && grep -q '</fontconfig>' "$CONF"; then
  backup "$CONF"
  python3 - "$CONF" "$alias_xml" <<'PY'
import sys
p, block = sys.argv[1], sys.argv[2]
s = open(p).read()
i = s.rindex('</fontconfig>')
open(p, 'w').write(s[:i] + block + '\n' + s[i:])
PY
  say fontconfig "Vazir Code added as the fallback for \"$family\""
else
  backup "$CONF"
  printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n%s\n</fontconfig>\n' "$alias_xml" > "$CONF"
  say fontconfig "written for \"$family\""
fi
fc-cache -f >/dev/null

# 3. fish: the claude wrapper, and direction detection in the shell.
if [[ $SHELL_STEP == 1 ]] && command -v fish >/dev/null; then
  FN=$HOME/.config/fish/functions/claude.fish
  mkdir -p "$(dirname "$FN")"
  new=$(curl -fsSL "$RAW/extras/claude.fish")
  if [[ -f $FN ]] && [[ $(cat "$FN") == "$new" ]]; then
    say fish "claude wrapper already in place"
  else
    backup "$FN"
    printf '%s\n' "$new" > "$FN"
    say fish "claude wrapper installed"
  fi
  CFG=$HOME/.config/fish/config.fish
  if [[ -f $CFG ]] && grep -q '2501h' "$CFG"; then
    say fish "direction detection already on in config.fish"
  else
    backup "$CFG"
    printf '\n# VTE (Guake): auto-detect RTL/LTR direction per line\nif status is-interactive; and set -q VTE_VERSION\n    printf "\\e[?2501h"\nend\n' >> "$CFG"
    say fish "direction detection added to config.fish"
  fi
fi

echo
say done "Quit your terminal fully and open it again, then start claude."
