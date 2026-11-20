import type * as Monaco from 'monaco-editor'
import type { ThemeId } from './appearance'

export const latexLanguageId = 'texloom-latex'

const palettes: Record<ThemeId, { command: string; environment: string; heading: string; format: string; reference: string; key: string; comment: string; math: string; number: string; text: string; background?: string; line?: string }> = {
  academic: { command: '1556A1', environment: '713BA6', heading: '0E6791', format: '167783', reference: '934281', key: 'A94B60', comment: '6B896D', math: '8056B1', number: '986119', text: '23354A' },
  ocean: { command: '087F8C', environment: '5F5AA0', heading: '11718A', format: '137D79', reference: '876097', key: 'A44F68', comment: '5D8578', math: '6C62A9', number: '986119', text: '233A45' },
  violet: { command: '6753A3', environment: '8A4E9B', heading: '5E5AA0', format: '336C91', reference: '9A4D84', key: 'A24C6A', comment: '6E8870', math: '775AB2', number: '91621C', text: '302F49' },
  forest: { command: '29755A', environment: '67599A', heading: '33745E', format: '167885', reference: '92577C', key: '9B5860', comment: '648064', math: '7560A7', number: '91621C', text: '293C36' },
  night: { command: '82BEFF', environment: 'D2A5F3', heading: '75D1E6', format: '73D8CB', reference: 'F2A3CF', key: 'F7B6B0', comment: '8CA995', math: 'C9AEF7', number: 'E5C582', text: 'E5EDF7', background: '1E1E1E', line: '292D34' },
  eye: { command: '286D53', environment: '765393', heading: '216F74', format: '277B68', reference: '925176', key: '9A5A5B', comment: '65806D', math: '745AA4', number: '89651F', text: '263F33', background: 'E3F3E5', line: 'D6EBDA' },
}

export function latexThemeName(theme: ThemeId): string { return `texloom-${theme}` }

export function registerLatexLanguage(monaco: typeof Monaco): void {
  monaco.languages.register({ id: latexLanguageId, extensions: ['.tex', '.sty', '.cls'], aliases: ['LaTeX', 'TeX'] })
  monaco.languages.setMonarchTokensProvider(latexLanguageId, {
    defaultToken: '',
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/(\\(?:begin|end))(\{)([^}]*)(\})/, ['keyword.environment', 'delimiter.brace', 'type.environment', 'delimiter.brace']],
        [/(\\(?:cite|citep|citet|ref|eqref|autoref|pageref|label|bibliography|bibliographystyle))(\{)([^}]*)(\})/, ['keyword.reference', 'delimiter.brace', 'string.key', 'delimiter.brace']],
        [/\\(?:section|subsection|subsubsection|paragraph|subparagraph|chapter|part|title|author|date)\*?(?![a-zA-Z@])/, 'keyword.heading'],
        [/\\(?:textbf|textit|emph|underline|texttt|mathbf|mathit|mathrm|operatorname)\b/, 'keyword.format'],
        [/\$\$/, { token: 'delimiter.math', next: '@displayDollar' }],
        [/\$/, { token: 'delimiter.math', next: '@inlineDollar' }],
        [/\\\[/, { token: 'delimiter.math', next: '@displayBracket' }],
        [/\\\(/, { token: 'delimiter.math', next: '@inlineBracket' }],
        [/\\[a-zA-Z@]+\*?/, 'keyword.command'],
        [/\\./, 'keyword.command'],
        [/[{}\[\]]/, 'delimiter.brace'],
      ],
      math: [
        [/%.*$/, 'comment'],
        [/\\[a-zA-Z@]+/, 'keyword.command'],
        [/\\./, 'keyword.command'],
        [/\d+(?:\.\d+)?/, 'number'],
        [/[{}_^=+\-*/<>|]/, 'operator.math'],
        [/[^\\$%{}_^=+\-*/<>|\d]+/, 'text.math'],
      ],
      inlineDollar: [[/\$/, { token: 'delimiter.math', next: '@pop' }], { include: '@math' }],
      displayDollar: [[/\$\$/, { token: 'delimiter.math', next: '@pop' }], { include: '@math' }],
      inlineBracket: [[/\\\)/, { token: 'delimiter.math', next: '@pop' }], { include: '@math' }],
      displayBracket: [[/\\\]/, { token: 'delimiter.math', next: '@pop' }], { include: '@math' }],
    },
  })
  monaco.languages.setLanguageConfiguration(latexLanguageId, {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }],
  })
  for (const [theme, palette] of Object.entries(palettes) as [ThemeId, typeof palettes[ThemeId]][]) {
    monaco.editor.defineTheme(latexThemeName(theme), {
      base: theme === 'night' ? 'vs-dark' : 'vs', inherit: true,
      rules: [
        { token: '', foreground: palette.text },
        { token: 'comment', foreground: palette.comment, fontStyle: 'italic' },
        { token: 'keyword.command', foreground: palette.command },
        { token: 'keyword.environment', foreground: palette.environment, fontStyle: 'bold' },
        { token: 'type.environment', foreground: palette.environment },
        { token: 'keyword.heading', foreground: palette.heading, fontStyle: 'bold' },
        { token: 'keyword.format', foreground: palette.format },
        { token: 'keyword.reference', foreground: palette.reference },
        { token: 'string.key', foreground: palette.key },
        { token: 'delimiter.brace', foreground: palette.command },
        { token: 'delimiter.math', foreground: palette.math, fontStyle: 'bold' },
        { token: 'operator.math', foreground: palette.math },
        { token: 'number', foreground: palette.number },
        { token: 'text.math', foreground: palette.text },
      ],
      colors: {
        ...(palette.background ? { 'editor.background': `#${palette.background}` } : {}),
        ...(palette.line ? { 'editor.lineHighlightBackground': `#${palette.line}` } : {}),
        ...(theme === 'eye' ? { 'editorLineNumber.foreground': '#658373', 'editor.selectionBackground': '#B8DFC0' } : {}),
      },
    })
  }
}
