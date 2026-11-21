export const highlightColors = [
  { latex: 'yellow!25', label: '柔和黄', css: '#fff2b8' },
  { latex: 'cyan!20', label: '浅青', css: '#d4f2f4' },
  { latex: 'green!20', label: '浅绿', css: '#dcefd7' },
  { latex: 'red!15', label: '浅粉', css: '#f8dfe1' },
  { latex: 'gray!18', label: '浅灰', css: '#e7e9ec' },
] as const

export function highlightCss(latex?: string): string {
  return highlightColors.find(color => color.latex === latex)?.css ?? highlightColors[0].css
}
