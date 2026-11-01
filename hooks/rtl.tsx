import type { ClientSurface } from 'claude-code'

// VTE-based terminals (Guake, GNOME Terminal) reorder each whole terminal
// row by themselves, with a left-to-right base direction. That is right for
// English rows, but a Persian row then starts on the left, and a row shared
// with a side panel gets mixed up if the whole row is flipped.
//
// So we lay out each right-to-left line ourselves, inside this column only:
// split it into runs, put the runs in right-to-left order, and pad it flush
// right. Each Persian run is left in its logical order, because the terminal
// reverses (and joins) Persian runs itself. A blank braille cell (U+2800,
// a left-to-right letter that draws nothing) sits wherever the terminal
// could otherwise merge two runs into one.

const BLANK = '⠀'
const BOLD = 1
const CODE = 2
const LINK = 4
const DIM = 8

type Cell = { t: string; w: number; s: number }
type Line = Cell[]
type Kind = 'R' | 'L' | 'D' | 'N'

const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
  '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹',
}

function kindOf(t: string): Kind {
  const c = t.codePointAt(0) ?? 0
  if ((c >= 0x30 && c <= 0x39) || (c >= 0x660 && c <= 0x669) || (c >= 0x6f0 && c <= 0x6f9)) return 'D'
  if (c === 0x60c || c === 0x61b || c === 0x61f || c === 0x66a || c === 0x66b || c === 0x66c || c === 0x6d4) return 'N'
  if ((c >= 0x590 && c <= 0x8ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefc)) return 'R'
  if (c >= 0x2800 && c <= 0x28ff) return 'L'
  if (/\p{L}/u.test(t)) return 'L'
  return 'N'
}

function widthOf(c: number): number {
  if (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
  ) return 2
  return 1
}

const isMark = (ch: string) => /\p{M}/u.test(ch) || ch === '‌' || ch === '‍' || ch === '️'

function toCells(text: string, s: number, out: Line) {
  for (const ch of text) {
    if (ch === '\t') { out.push({ t: ' ', w: 1, s }, { t: ' ', w: 1, s }); continue }
    if (isMark(ch) && out.length > 0) { out[out.length - 1]!.t += ch; continue }
    out.push({ t: ch, w: widthOf(ch.codePointAt(0) ?? 0), s })
  }
}

// Inline markdown: `code`, **bold**, __bold__, [text](url), \escapes.
function inline(text: string, base = 0): Line {
  const out: Line = []
  let s = base
  let i = 0
  let plain = ''
  const flush = () => { if (plain) { toCells(plain, s, out); plain = '' } }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#+\-.!|>~]/.test(text[i + 1]!)) {
      plain += text[i + 1]; i += 2; continue
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) { flush(); toCells(text.slice(i + 1, end), s | CODE, out); i = end + 1; continue }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      flush(); s ^= BOLD; i += 2; continue
    }
    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(text.slice(i))
      if (m) { flush(); toCells(m[1]!, s | LINK, out); i += m[0].length; continue }
    }
    plain += ch
    i += 1
  }
  flush()
  return out
}

const width = (l: Line) => l.reduce((n, c) => n + c.w, 0)
const isSpace = (c: Cell) => c.t === ' '

const hasRtl = (l: Line) => l.some(c => kindOf(c.t) === 'R')

// The mod only draws replies that hold Persian, so any line with a Persian
// letter in it reads right to left, even one that opens with a Latin word.
function direction(l: Line): 'rtl' | 'ltr' {
  return hasRtl(l) ? 'rtl' : 'ltr'
}

// Greedy word wrap of logical cells to `w` columns.
function wrap(l: Line, w: number): Line[] {
  if (w < 1) return [l]
  const lines: Line[] = []
  let cur: Line = []
  let curW = 0
  let i = 0
  while (i < l.length) {
    if (isSpace(l[i]!)) {
      if (curW > 0 && curW + 1 <= w) { cur.push(l[i]!); curW += 1 }
      i += 1
      continue
    }
    let j = i
    while (j < l.length && !isSpace(l[j]!)) j += 1
    const word = l.slice(i, j)
    const ww = width(word)
    if (curW + ww > w && curW > 0) {
      while (cur.length && isSpace(cur[cur.length - 1]!)) cur.pop()
      lines.push(cur); cur = []; curW = 0
    }
    if (ww > w) {
      for (const c of word) {
        if (curW + c.w > w) { lines.push(cur); cur = []; curW = 0 }
        cur.push(c); curW += c.w
      }
    } else {
      cur.push(...word); curW += ww
    }
    i = j
  }
  while (cur.length && isSpace(cur[cur.length - 1]!)) cur.pop()
  lines.push(cur)
  return lines
}

type Token = { k: Kind; cells: Line }

// One logical right-to-left line → cells in the order the terminal should
// receive them, so that its own left-to-right pass shows them right to left.
export function visual(l: Line): Line {
  const kinds: Kind[] = []
  let prevStrong: 'R' | 'L' = 'R'
  for (const c of l) {
    let k = kindOf(c.t)
    if (k === 'R' || k === 'L') prevStrong = k
    else if (k === 'D') k = prevStrong === 'L' ? 'L' : 'D'
    kinds.push(k)
  }
  // Runs: neutrals between two runs of one direction join them.
  const cls = kinds.map(k => (k === 'D' ? 'R' : k))
  const tokens: Token[] = []
  let i = 0
  while (i < l.length) {
    if (cls[i] === 'N') {
      let j = i
      while (j < l.length && cls[j] === 'N') j += 1
      const before = tokens.length ? tokens[tokens.length - 1] : undefined
      const after = j < l.length ? cls[j] : undefined
      if (before && before.k !== 'N' && after === before.k) before.cells.push(...l.slice(i, j))
      else tokens.push({ k: 'N', cells: l.slice(i, j) })
      i = j
      continue
    }
    const k = cls[i] as 'R' | 'L'
    const last = tokens.length ? tokens[tokens.length - 1] : undefined
    if (last && last.k === k) last.cells.push(l[i]!)
    else tokens.push({ k, cells: [l[i]!] })
    i += 1
  }
  // A number that opens a Persian run reads left to right on its own, to the
  // right of the words after it: split it off.
  const split: Token[] = []
  for (const t of tokens) {
    if (t.k !== 'R') { split.push(t); continue }
    let start = 0
    let j = 0
    const base = l.indexOf(t.cells[0]!)
    while (j < t.cells.length && kindOf(t.cells[j]!.t) !== 'R') j += 1
    if (j > 0 && kinds[base] === 'D') {
      let end = j
      while (end > 0 && kindOf(t.cells[end - 1]!.t) === 'N') end -= 1
      split.push({ k: 'D', cells: t.cells.slice(0, end) })
      if (end < j) split.push({ k: 'N', cells: t.cells.slice(end, j) })
      start = j
    }
    if (start < t.cells.length) split.push({ k: 'R', cells: t.cells.slice(start) })
  }
  const order = split.reverse().map(t =>
    t.k === 'N' ? { k: t.k, cells: [...t.cells].reverse().map(c => ({ ...c, t: MIRROR[c.t] ?? c.t })) } : t,
  )
  // Keep a Persian run from merging with a neighbouring number in the
  // terminal's own pass.
  const out: Token[] = []
  for (const t of order) {
    const prev = out[out.length - 1]
    const prevStrongTok = [...out].reverse().find(x => x.k !== 'N')
    if (t.k !== 'N' && prevStrongTok && (t.k === 'R' || t.k === 'D') && (prevStrongTok.k === 'R' || prevStrongTok.k === 'D')) {
      if (prev && prev.k === 'N') {
        const sp = prev.cells.findIndex(isSpace)
        if (sp >= 0) prev.cells[sp] = { ...prev.cells[sp]!, t: BLANK }
        else prev.cells.push({ t: BLANK, w: 1, s: 0 })
      } else {
        out.push({ k: 'N', cells: [{ t: BLANK, w: 1, s: 0 }] })
      }
    }
    out.push(t)
  }
  return out.flatMap(t => t.cells)
}

const pad = (n: number): Line => Array.from({ length: Math.max(0, n) }, () => ({ t: ' ', w: 1, s: 0 }))

// A logical line → the row drawn, `w` columns wide at most.
function place(l: Line, w: number, dir: 'rtl' | 'ltr'): Line {
  if (dir === 'ltr') return hasRtl(l) ? [...l, { t: BLANK, w: 1, s: 0 }] : l
  const v = visual(l)
  return [...pad(w - 1 - width(v)), ...v, { t: BLANK, w: 1, s: 0 }]
}

function paragraph(cells: Line, w: number, first: Line = [], rest: Line = []): Line[] {
  const dir = direction(cells)
  const body = wrap(cells, Math.max(4, w - 1 - width(first)))
  return body.map((b, n) => place([...(n === 0 ? first : rest), ...b], w, dir))
}

function table(rows: string[], w: number): Line[] {
  const cells = rows
    .filter(r => !/^\s*\|?\s*:?-{2,}/.test(r))
    .map(r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inline(c.trim())))
  const cols = Math.max(...cells.map(r => r.length))
  const ws = Array.from({ length: cols }, (_, c) => Math.max(1, ...cells.map(r => width(r[c] ?? []))))
  // Too wide for the column: narrow the widest cell column until it fits;
  // its text wraps onto more lines.
  const room = w - 1 - (3 * cols + 1)
  while (ws.reduce((n, x) => n + x, 0) > room) {
    const i = ws.indexOf(Math.max(...ws))
    if (ws[i]! <= 4) break
    ws[i] = ws[i]! - 1
  }
  const rtl = cells.some(r => r.some(hasRtl))
  const idx = Array.from({ length: cols }, (_, c) => (rtl ? cols - 1 - c : c))
  const flush = (line: Line) => (rtl ? [...pad(w - 1 - width(line)), ...line] : line)
  const edge = (l: string, m: string, r: string) => {
    const line: Line = []
    toCells(l + idx.map(c => '─'.repeat(ws[c]! + 2)).join(m) + r, DIM, line)
    return flush(line)
  }
  const out: Line[] = [edge('┌', '┬', '┐')]
  cells.forEach((r, n) => {
    const parts = idx.map(c => {
      const cell = (r[c] ?? []).map(x => (n === 0 ? { ...x, s: x.s | BOLD } : x))
      return { c, dir: direction(cell), lines: wrap(cell, ws[c]!) }
    })
    const height = Math.max(...parts.map(p => p.lines.length))
    for (let k = 0; k < height; k++) {
      const line: Line = []
      toCells('│' + BLANK, DIM, line)
      parts.forEach((p, m) => {
        const cell = p.lines[k] ?? []
        const gap = ws[p.c]! - width(cell)
        if (p.dir === 'rtl') line.push(...pad(gap), ...visual(cell))
        else line.push(...cell, ...pad(gap))
        toCells(m === cols - 1 ? BLANK + '│' : BLANK + '│' + BLANK, DIM, line)
      })
      out.push(flush(line))
    }
    if (n === 0 && cells.length > 1) out.push(edge('├', '┼', '┤'))
  })
  out.push(edge('└', '┴', '┘'))
  return out
}

// Typed text, not markdown: each line its own paragraph, drawn as typed.
function plainLayout(text: string, w: number): Line[] {
  return text.replace(/\r/g, '').split('\n').flatMap(line => {
    const cells: Line = []
    toCells(line, 0, cells)
    return cells.length ? paragraph(cells, w) : [[]]
  })
}

export function layout(text: string, w: number, plain = false): Line[] {
  if (plain) return plainLayout(text, w)
  const src = text.replace(/\r/g, '').split('\n')
  const out: Line[] = []
  let para: string[] = []
  const blank = () => { if (out.length && out[out.length - 1]!.length) out.push([]) }
  const endPara = () => {
    if (para.length) out.push(...paragraph(inline(para.join(' ')), w))
    para = []
  }
  let i = 0
  while (i < src.length) {
    const line = src[i]!
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      endPara()
      i += 1
      while (i < src.length && !src[i]!.trim().startsWith(fence[1]!)) {
        const l: Line = []
        toCells('  ' + src[i], CODE, l)
        out.push(place(l, w, 'ltr'))
        i += 1
      }
      i += 1
      continue
    }
    if (/^\s*\|/.test(line)) {
      endPara()
      const rows: string[] = []
      while (i < src.length && /^\s*\|/.test(src[i]!)) rows.push(src[i++]!)
      out.push(...table(rows, w))
      continue
    }
    if (!line.trim()) { endPara(); blank(); i += 1; continue }
    const head = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (head) { endPara(); out.push(...paragraph(inline(head[1]!, BOLD), w)); i += 1; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endPara()
      const l: Line = []
      toCells('─'.repeat(Math.max(1, w - 1)), DIM, l)
      out.push(l); i += 1; continue
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      endPara()
      const depth = Math.floor(item[1]!.replace(/\t/g, '  ').length / 2)
      const mark = /\d/.test(item[2]!) ? item[2]! + ' ' : '• '
      let body = item[3]!
      i += 1
      while (i < src.length && src[i]!.trim() && /^\s{2,}\S/.test(src[i]!) && !/^\s*([-*+]|\d+[.)])\s+/.test(src[i]!)) {
        body += ' ' + src[i]!.trim(); i += 1
      }
      const first: Line = pad(depth * 2)
      toCells(mark, 0, first)
      out.push(...paragraph(inline(body), w, first, pad(width(first))))
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      endPara()
      const bar: Line = []
      toCells('▎ ', DIM, bar)
      out.push(...paragraph(inline(quote[1]!, DIM), w, bar, bar))
      i += 1
      continue
    }
    para.push(line.trim())
    i += 1
  }
  endPara()
  while (out.length && !out[out.length - 1]!.length) out.pop()
  return out
}

type Props = { text: string; plain?: boolean; max?: number }

export default function Rtl(props: Props, surface: ClientSurface) {
  const { Box, Text } = surface.elements
  // One column short of the region: drawn exactly as wide, the region would
  // keep that width even where the column is narrower, since its width
  // follows what it holds. `max` (the window, less the marker) caps the
  // first draw, before the region is laid out.
  const max = props.max ?? 200
  const w = Math.max(10, Math.min(surface.columns > 0 ? surface.columns : max, max) - 1)
  const rows = layout(props.text, w, props.plain === true)

  return (
    <Box flexDirection="column">
      {rows.map(row => {
        const spans: Line[] = []
        for (const c of row) {
          const last = spans[spans.length - 1]
          if (last && last[0]!.s === c.s) last.push(c)
          else spans.push([c])
        }
        return (
          <Text wrap="truncate">
            {spans.length === 0 ? ' ' : spans.map(sp => (
              <Text
                bold={(sp[0]!.s & BOLD) !== 0}
                underline={(sp[0]!.s & LINK) !== 0}
                dimColor={(sp[0]!.s & DIM) !== 0}
                color={(sp[0]!.s & CODE) !== 0 ? 'permission' : undefined}
              >
                {sp.map(c => c.t).join('')}
              </Text>
            ))}
          </Text>
        )
      })}
    </Box>
  )
}
