import { expect, test } from 'claude-code/testing'

import { layout, visual } from '../hooks/rtl'

// What the terminal is sent for one right-to-left line. VTE reverses each
// Persian run itself, so runs come out in right-to-left order with each one
// still in logical order. U+2800 (a blank, left-to-right cell) keeps a number
// from merging with the Persian run beside it. These match what a reference
// bidi engine shows for the line as a right-to-left paragraph.
const sent = (s: string) => visual([...s].map(t => ({ t, w: 1, s: 0 }))).map(c => c.t).join('')
const rows = (text: string, w: number, plain = false) => layout(text, w, plain).map(l => l.map(c => c.t).join(''))

test('runs of a right-to-left line, in the order the terminal needs', () => {
  expect(sent("سلام دنیا")).toBe("سلام دنیا")
  expect(sent("فونت Vazir Code را نصب کردم.")).toBe(".را نصب کردم Vazir Code فونت")
  expect(sent("نسخهٔ 2.1.316 نصب شد و 24 فایل تغییر کرد.")).toBe(".نسخهٔ 2.1.316 نصب شد و 24 فایل تغییر کرد")
  expect(sent("24 فایل تغییر کرد")).toBe("فایل تغییر کرد\u280024")
  expect(sent("1. فایل را باز کنید")).toBe("فایل را باز کنید\u2800.1")
  expect(sent("ترمینال روی VTE 0.76 کار می‌کند.")).toBe(".کار می‌کند VTE 0.76 ترمینال روی")
})

test('brackets between runs are mirrored, the ones inside a Persian run left to the terminal', () => {
  expect(sent('این (English) هم')).toBe('هم (English) این')
  // One Persian run, brackets and all: sent as written, the terminal turns it.
  expect(sent('یک (پرانتز) است')).toBe('یک (پرانتز) است')
})

test('Persian lines are flush right, with a blank cell closing them', () => {
  const [first] = rows('سلام', 20)
  expect(first).toBe(' '.repeat(15) + 'سلام⠀')
})

test('a line with Persian reads right to left even when it opens with a Latin word', () => {
  const [line] = rows('VTE هر خط را مرتب می‌کند', 40)
  expect(line?.startsWith(' ')).toBe(true)
  expect(line?.trimStart()).toBe('هر خط را مرتب می‌کند VTE\u2800')
})

test('English paragraphs and code blocks stay left to right', () => {
  expect(rows('Hello there', 40)).toEqual(['Hello there'])
  expect(rows('سلام\n\n```sh\nls -la\n```', 20)).toEqual([' '.repeat(15) + 'سلام⠀', '', '  ls -la'])
})

test('a Persian table lists its columns from the right', () => {
  const t = rows('| نام | سن |\n|---|---|\n| علی | 30 |', 30)
  expect(t[1]?.trim()).toBe('│⠀سن⠀│⠀نام⠀│')
})

test('typed prompts are drawn as typed, markdown marks kept', () => {
  const [line] = rows('فونت **Vazir** درست', 40, true)
  expect(line?.includes('**Vazir**')).toBe(true)
})
