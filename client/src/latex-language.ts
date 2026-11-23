import type * as Monaco from 'monaco-editor'
import type { ThemeId } from './appearance'

export const latexLanguageId = 'texloom-latex'

const palettes: Record<ThemeId, { command: string; environment: string; heading: string; format: string; reference: string; key: string; comment: string; math: string; number: string; text: string; background?: string; line?: string }> = {
  academic: { command: '1556A1', environment: '713BA6', heading: '0E6791', format: '167783', reference: '934281', key: 'A94B60', comment: '6B896D', math: '8056B1', number: '986119', text: '23354A' },
  ocean: { command: '087F8C', environment: '5F5AA0', heading: '11718A', format: '137D79', reference: '876097', key: 'A44F68', comment: '5D8578', math: '6C62A9', number: '986119', text: '233A45' },
  violet: { command: '6753A3', environment: '8A4E9B', heading: '5E5AA0', format: '336C91', reference: '9A4D84', key: 'A24C6A', comment: '6E8870', math: '775AB2', number: '91621C', text: '302F49' },
  forest: { command: '29755A', environment: '67599A', heading: '33745E', format: '167885', reference: '92577C', key: '9B5860', comment: '648064', math: '7560A7', number: '91621C', text: '293C36' },
  night: { command: 'A3D6EC', environment: 'CCB8F3', heading: 'F5D5A0', format: '9BD9CA', reference: 'EAB1CA', key: 'F5BDAA', comment: 'A5B3AD', math: 'ECC285', number: 'ECC285', text: 'EEE9F0', background: '14151F', line: '211F2D' },
  miku: { command: '78E7E4', environment: 'B1C7FF', heading: '83F4D8', format: 'B6E2A9', reference: 'F6AACD', key: 'F5C6D8', comment: '91ACA9', math: 'B4CBFF', number: 'F2CB9B', text: 'DBEFED', background: '0B171B', line: '10252A' },
  vermilion: { command: '8A302B', environment: '754462', heading: '792821', format: '396752', reference: '804464', key: '904338', comment: '6E6355', math: '885044', number: '88521B', text: '342620', background: 'FFFBF4', line: 'F7ECE2' },
  cobalt: { command: '2148A0', environment: '654794', heading: '173779', format: '216A79', reference: '884473', key: '9B4559', comment: '536783', math: '4A569F', number: '86531E', text: '1B2E53', background: 'FBFDFF', line: 'EEF3FC' },
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
      base: theme === 'night' || theme === 'miku' ? 'vs-dark' : 'vs', inherit: true,
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
        ...(theme === 'vermilion' ? {
          'editorLineNumber.foreground': '#786258',
          'editorLineNumber.activeForeground': '#792821',
          'editorCursor.foreground': '#9E342D',
          'editor.selectionBackground': '#F0D8CF',
          'editorWidget.background': '#FFF8EF',
          'editorWidget.border': '#D6B7A4',
          'editorSuggestWidget.selectedBackground': '#F4DFD6',
          'editorSuggestWidget.highlightForeground': '#792821',
        } : {}),
        ...(theme === 'cobalt' ? {
          'editorLineNumber.foreground': '#536783',
          'editorLineNumber.activeForeground': '#173779',
          'editorCursor.foreground': '#2148A0',
          'editor.selectionBackground': '#D7E5FF',
          'editorWidget.background': '#F9FBFF',
          'editorWidget.border': '#B2C4E3',
          'editorSuggestWidget.selectedBackground': '#E0EAFF',
          'editorSuggestWidget.highlightForeground': '#173779',
        } : {}),
        ...(theme === 'night' ? {
          'editorLineNumber.foreground': '#9C94A8',
          'editorLineNumber.activeForeground': '#F5D5A0',
          'editorCursor.foreground': '#E5B975',
          'editor.selectionBackground': '#55415E',
          'editor.inactiveSelectionBackground': '#392D44',
          'editorWidget.background': '#1E1E2B',
          'editorWidget.border': '#595269',
          'editorSuggestWidget.selectedBackground': '#3C2E2A',
          'editorSuggestWidget.highlightForeground': '#F5D5A0',
          'editorGutter.background': '#14151F',
          'diffEditor.insertedLineBackground': '#487E6B3A',
          'diffEditor.insertedTextBackground': '#6EC3A84C',
          'diffEditor.removedLineBackground': '#AC626B33',
          'diffEditor.removedTextBackground': '#D1838C50',
        } : {}),
        ...(theme === 'miku' ? {
          'editorLineNumber.foreground': '#829B9F',
          'editorLineNumber.activeForeground': '#83F4D8',
          'editorCursor.foreground': '#72EADB',
          'editor.selectionBackground': '#24494C',
          'editor.inactiveSelectionBackground': '#1B353A',
          'editorWidget.background': '#112227',
          'editorWidget.border': '#355960',
          'editorSuggestWidget.selectedBackground': '#18363B',
          'editorSuggestWidget.highlightForeground': '#83F4D8',
          'editorGutter.background': '#0B171B',
          'diffEditor.insertedLineBackground': '#46A68F32',
          'diffEditor.removedLineBackground': '#E375A238',
        } : {}),
      },
    })
  }
}
