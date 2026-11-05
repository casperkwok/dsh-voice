#!/usr/bin/env node
/**
 * Fail when a tracked file looks like it contains a live credential.
 *
 * This is deliberately a high-signal check, not a general secret scanner: it
 * reports only values that are long enough to be real keys. Test fixtures such
 * as `test-key` and `volc-secret` are below the length thresholds.
 *
 *   node scripts/check-secrets.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const MAX_BYTES = 1_500_000

const patterns = [
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['long bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
  ['long literal api key', /\bapi[_-]?key\s*[:=]\s*['"][A-Za-z0-9._~+/-]{24,}['"]/i],
  ['long literal secret', /\bsecret\s*[:=]\s*['"][A-Za-z0-9._~+/-]{24,}['"]/i],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
]

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((file) => {
    if (file.endsWith('.lock') || file.endsWith('pnpm-lock.yaml')) return false
    if (/(^|\/)(node_modules|\.models|\.git)\//.test(file)) return false
    try {
      return statSync(file).size > 0 && statSync(file).size <= MAX_BYTES
    } catch {
      return false
    }
  })

const findings = []
for (const file of files) {
  let text
  try {
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    text = buffer.toString('utf8')
  } catch {
    continue
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    for (const [name, regex] of patterns) {
      if (regex.test(line)) {
        findings.push({ file, line: i + 1, name })
      }
    }
  }
}

const envFiles = files.filter((file) => /(^|\/)\.env(?:\.|$)/.test(file))
if (envFiles.length) {
  for (const file of envFiles) findings.push({ file, line: 0, name: '.env tracked by git' })
}

if (findings.length) {
  console.error('Secret scan failed. Values are redacted:')
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line || '-'}  ${finding.name}`)
  }
  process.exit(1)
}

console.log(`secret scan: ${files.length} tracked files, no credential-shaped values`)
