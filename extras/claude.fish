# Turn off VTE RTL auto-detect while Claude Code runs: its split layout
# (chat + side panel on the same rows) gets mirrored as a whole row otherwise.
function claude --wraps claude
    set -q VTE_VERSION; and printf '\e[?2501l'
    command claude $argv
    set -l s $status
    set -q VTE_VERSION; and printf '\e[?2501h'
    return $s
end
