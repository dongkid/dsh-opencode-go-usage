// Verify the HTTP backend extracted from the REAL built lib/index.js:
// key resolution priority, proxy env parsing, Windows registry proxy, direct
// request, and proxy-failure fallback to direct. Run: node tests/verify-http.mjs
import { readFileSync } from 'node:fs'
import { request as _ocgoHttpsRequest } from 'node:https'
import { connect as _ocgoNetConnect } from 'node:net'
import { connect as _ocgoTlsConnect } from 'node:tls'
import { execFile as _ocgoExecFile } from 'node:child_process'
import { join as _ocgoJoin } from 'node:path'
import { homedir as _ocgoHomedir } from 'node:os'
import { readFileSync as _ocgoReadFileSync } from 'node:fs'

const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const start = src.indexOf('function resolveGoKey')
const end = src.indexOf('async function collectQuota')
if (start < 0 || end < 0) throw new Error('could not locate helper block in lib/index.js')
const block = src.slice(start, end)
const factory = new Function(
  '_ocgoHttpsRequest', '_ocgoNetConnect', '_ocgoTlsConnect', '_ocgoExecFile',
  '_ocgoJoin', '_ocgoHomedir', '_ocgoReadFileSync', 'process', 'URL', 'Promise',
  block + '; return { resolveGoKey, isNoProxy, proxyFromEnv, readWindowsProxy, httpRequest }',
)
const api = factory(_ocgoHttpsRequest, _ocgoNetConnect, _ocgoTlsConnect, _ocgoExecFile, _ocgoJoin, _ocgoHomedir, _ocgoReadFileSync, process, URL, Promise)

let failures = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`) } catch (e) { failures++; console.error(`FAIL - ${name}: ${e.message}`) }
}

await check('resolveGoKey 优先 .credentials.yaml 的 OPENCODE_GO_API_KEY', () => {
  const k = api.resolveGoKey()
  if (!k) throw new Error('no key resolved')
  if (k.startsWith('sk-uyOOL')) throw new Error('resolved the WRONG (auth.json) key: ' + k.slice(0, 12))
  console.log(`   key: ${k.slice(0, 10)}...(${k.length})`)
})

await check('proxyFromEnv 解析 HTTPS_PROXY + NO_PROXY 直连', () => {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7890'
  const p1 = api.proxyFromEnv('opencode.ai')
  if (!p1 || p1.port !== 7890) throw new Error('env proxy not parsed: ' + JSON.stringify(p1))
  process.env.NO_PROXY = 'localhost,opencode.ai'
  if (api.proxyFromEnv('opencode.ai') !== null) throw new Error('NO_PROXY not honored')
  if (api.proxyFromEnv('example.com') === null) throw new Error('NO_PROXY over-matched')
  if (api.isNoProxy('api.opencode.ai') !== true) throw new Error('subdomain NO_PROXY miss')
  delete process.env.NO_PROXY
  delete process.env.HTTPS_PROXY
})

await check('readWindowsProxy 读到系统代理', async () => {
  const p = await api.readWindowsProxy()
  if (!p) throw new Error('no windows system proxy found')
  console.log(`   system proxy: ${p.host}:${p.port}`)
})

await check('直连: 配额接口 200 + usage 解析', async () => {
  process.env.NO_PROXY = 'opencode.ai'
  const k = api.resolveGoKey()
  const r = await api.httpRequest('https://opencode.ai/zen/go/v1/usage', { headers: { Authorization: 'Bearer ' + k } })
  if (r.status !== 200) throw new Error('status ' + r.status + ': ' + r.text.slice(0, 120))
  const j = JSON.parse(r.text)
  if (!j.usage || !j.usage.rolling || typeof j.usage.rolling.percent !== 'number') throw new Error('unexpected body: ' + r.text.slice(0, 200))
  console.log(`   rolling=${j.usage.rolling.percent}% weekly=${j.usage.weekly.percent}% monthly=${j.usage.monthly.percent}%`)
  delete process.env.NO_PROXY
})

await check('代理不可达自动回退直连 (HTTPS_PROXY=127.0.0.1:9)', async () => {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:9'
  const k = api.resolveGoKey()
  const r = await api.httpRequest('https://opencode.ai/zen/go/v1/usage', { headers: { Authorization: 'Bearer ' + k } })
  if (r.status !== 200) throw new Error('fallback failed: status ' + r.status + ': ' + r.text.slice(0, 120))
  delete process.env.HTTPS_PROXY
  console.log('   fallback direct OK')
})

console.log(failures === 0 ? '\nALL HTTP-BACKEND CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
