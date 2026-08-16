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

await check('NO_PROXY 前导星号 *.domain 通配 (H4)', () => {
  process.env.NO_PROXY = '*.opencode.ai'
  if (api.isNoProxy('opencode.ai') !== true) throw new Error('bare host should match *.opencode.ai')
  if (api.isNoProxy('api.opencode.ai') !== true) throw new Error('subdomain should match *.opencode.ai')
  if (api.isNoProxy('example.com') === true) throw new Error('unrelated host over-matched')
  delete process.env.NO_PROXY
})

await check('proxyFromEnv 保留 user:pass@ 认证凭据 (H3)', () => {
  process.env.HTTPS_PROXY = 'http://user:pa%40ss@127.0.0.1:8080'
  const p = api.proxyFromEnv('opencode.ai')
  if (!p || !p.auth) throw new Error('auth not preserved: ' + JSON.stringify(p))
  const decoded = Buffer.from(p.auth, 'base64').toString('utf8')
  if (decoded !== 'user:pa@ss') throw new Error('auth decode mismatch: ' + decoded)
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

// ── 官方明细通道 (parseServerText + runOfficialHttp) ──────────────────────
const start2 = src.indexOf('function parseServerText')
const end2 = src.indexOf('async function collectOfficial')
if (start2 < 0 || end2 < 0) throw new Error('could not locate official block in lib/index.js')
const block2 = src.slice(start2, end2)
const factory2 = new Function(
  '_ocgoHttpsRequest', '_ocgoNetConnect', '_ocgoTlsConnect', '_ocgoExecFile',
  '_ocgoJoin', '_ocgoHomedir', '_ocgoReadFileSync', '_ocgoMkdirSync', '_ocgoWriteFileSync',
  'httpRequest', 'mapLimit', 'process', 'URL', 'Promise',
  block2 + '; return { parseServerText, runOfficialHttp }',
)
const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length)
  let i = 0
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
const api2 = factory2(_ocgoHttpsRequest, _ocgoNetConnect, _ocgoTlsConnect, _ocgoExecFile, _ocgoJoin, _ocgoHomedir, _ocgoReadFileSync, (await import('node:fs')).mkdirSync, (await import('node:fs')).writeFileSync, api.httpRequest, mapLimit, process, URL, Promise)

await check('usage.list 第一页: 真实拉取 + server-fn 解析', async () => {
  const cfg = JSON.parse(readFileSync(process.env.USERPROFILE + '\\.config\\dsh-opencode-go-usage.json', 'utf8'))
  const FID = 'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c'
  const argsEnc = encodeURIComponent(JSON.stringify([cfg.workspaceId, 0]))
  const r = await api.httpRequest('https://opencode.ai/_server?id=' + FID + '&args=' + argsEnc, {
    headers: { Cookie: 'auth=' + cfg.authCookie, 'X-Server-Id': FID, 'X-Server-Instance': 'server-fn:ocgo-0' },
  })
  if (r.status !== 200) throw new Error('status ' + r.status)
  const rows = api2.parseServerText(r.text)
  if (rows.length === 0) throw new Error('no usg_ records parsed')
  const first = rows[0]
  if (!first.ts || !first.model || typeof first.cost !== 'number') throw new Error('bad record: ' + JSON.stringify(first))
  console.log(`   page0: ${rows.length} records; first: ${first.model} ts=${first.ts} cost=${first.cost}`)
})

await check('runOfficialHttp 增量模式 (LAST=最新 ts) 只拉新增', async () => {
  const cfg = JSON.parse(readFileSync(process.env.USERPROFILE + '\\.config\\dsh-opencode-go-usage.json', 'utf8'))
  const FID = 'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c'
  const argsEnc = encodeURIComponent(JSON.stringify([cfg.workspaceId, 0]))
  const r = await api.httpRequest('https://opencode.ai/_server?id=' + FID + '&args=' + argsEnc, {
    headers: { Cookie: 'auth=' + cfg.authCookie, 'X-Server-Id': FID, 'X-Server-Instance': 'server-fn:ocgo-0' },
  })
  const latest = api2.parseServerText(r.text)[0].ts
  const p = await api2.runOfficialHttp([['OCGO_LAST_TS', latest]])
  if (!p.ok) throw new Error('incremental failed: ' + JSON.stringify(p).slice(0, 200))
  console.log(`   incremental returned ${p.records.length} new record(s)`)
})

await check('代理 accept 后挂起 → 15s 超时 reject (C1)', async () => {
  const net = await import('node:net')
  const server = net.createServer(() => { /* accept 后挂起,不回 CONNECT */ })
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  const port = server.address().port
  const start = Date.now()
  let outcome = 'no-settle'
  try {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:' + port
    await api.httpRequest('https://opencode.ai/zen/go/v1/usage', { headers: { Authorization: 'Bearer x' } })
    outcome = 'resolved'
  } catch (e) {
    outcome = 'rejected: ' + e.message
  }
  delete process.env.HTTPS_PROXY
  server.close()
  const elapsed = Date.now() - start
  if (!outcome.startsWith('rejected')) throw new Error('expected timeout reject, got: ' + outcome)
  if (elapsed > 25000) throw new Error('timeout took too long: ' + elapsed + 'ms')
  if (elapsed < 10000) throw new Error('rejected too early (not the 15s timer): ' + elapsed + 'ms')
  console.log(`   rejected after ${elapsed}ms (timer OK)`)
})

console.log(failures === 0 ? '\nALL HTTP-BACKEND CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
