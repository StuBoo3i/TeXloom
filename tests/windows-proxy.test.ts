import assert from 'node:assert/strict'
import test from 'node:test'
import { httpsProxyFromWindowsSettings } from '../server/windows-proxy.js'

test('Windows HTTPS proxy uses enabled system proxy settings', () => {
  assert.equal(httpsProxyFromWindowsSettings('0x1', '127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(httpsProxyFromWindowsSettings('0x1', 'http=127.0.0.1:8080;https=127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(httpsProxyFromWindowsSettings('0x0', '127.0.0.1:7890'), '')
  assert.equal(httpsProxyFromWindowsSettings('0x1', 'https=proxy.example'), '')
  assert.equal(httpsProxyFromWindowsSettings('0x1', 'https=user:password@proxy.example:7890'), '')
})
