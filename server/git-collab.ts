export function githubRemote(input: unknown): { url: string; owner: string; repo: string } {
  if (typeof input !== 'string' || input.length > 300 || /[\r\n\x00-\x1f]/.test(input)) throw new Error('GitHub 仓库地址无效')
  const url = input.trim()
  let owner = ''
  let repo = ''
  const ssh = /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(url)
  if (ssh) { owner = ssh[1]; repo = ssh[2] }
  else {
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error('GitHub 仓库地址无效') }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('仅支持不含凭据的 github.com HTTPS 或 SSH 地址')
    const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(parsed.pathname)
    if (!match) throw new Error('GitHub 仓库地址应为 owner/repo')
    owner = match[1]; repo = match[2]
  }
  if (repo === '.' || repo === '..' || repo.startsWith('.')) throw new Error('GitHub 仓库名无效')
  return { url, owner, repo }
}

export function safeBranch(input: unknown): string {
  if (typeof input !== 'string' || input.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input) || input.split('/').some(part => !part || part === '.' || part === '..' || part.endsWith('.lock')) || input.endsWith('.') || input.includes('..') || input.includes('//') || input === 'texloom-reviews') throw new Error('分支名称无效')
  return input
}
