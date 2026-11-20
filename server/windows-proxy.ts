import { execFileSync } from 'node:child_process'

const internetSettings = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

function registryValue(name: string): string {
  try {
    const output = execFileSync('reg.exe', ['query', internetSettings, '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 2000 })
    return output.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'mi'))?.[1]?.trim() ?? ''
  } catch { return '' }
}

export function httpsProxyFromWindowsSettings(enabled: string, server: string): string {
  if (enabled !== '0x1') return ''
  const entry = server.includes('=')
    ? server.split(';').map(part => part.trim()).find(part => /^https=/i.test(part))?.slice(6)
      ?? server.split(';').map(part => part.trim()).find(part => /^http=/i.test(part))?.slice(5)
    : server.trim()
  if (!entry || /[\s\r\n]/.test(entry)) return ''
  const proxy = /^[a-z][a-z\d+.-]*:\/\//i.test(entry) ? entry : `http://${entry}`
  try {
    const parsed = new URL(proxy)
    return ['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) && parsed.hostname && parsed.port && !parsed.username && !parsed.password && !parsed.pathname.replaceAll('/', '') && !parsed.search && !parsed.hash ? proxy : ''
  } catch { return '' }
}

let cached = { at: 0, proxy: '' }
export function windowsHttpsProxy(): string {
  if (process.platform !== 'win32') return ''
  if (Date.now() - cached.at < 10_000) return cached.proxy
  cached = { at: Date.now(), proxy: httpsProxyFromWindowsSettings(registryValue('ProxyEnable'), registryValue('ProxyServer')) }
  return cached.proxy
}
