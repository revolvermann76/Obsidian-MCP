import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = resolve(__dirname, '..', 'dist', 'index.cjs')
const VAULT = resolve(__dirname, '..', 'test-vault')

function encode(msg: object): string {
  return JSON.stringify(msg) + '\n'
}

function readMessage(proc: ReturnType<typeof spawn>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      proc.stdout!.off('data', onData)
      try {
        resolve(JSON.parse(line))
      } catch (e) {
        reject(e)
      }
    }
    proc.stdout!.on('data', onData)
    proc.once('error', reject)
  })
}

function waitForExit(proc: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    proc.once('close', (code) => resolve(code ?? -1))
    proc.once('error', reject)
  })
}

describe('exit tool — integration', () => {
  it('starts the MCP server and shuts it down cleanly via the exit tool', async () => {
    const proc = spawn('node', [DIST, '--vault', VAULT], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // 1. initialize handshake
    proc.stdin!.write(
      encode({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        },
      }),
    )
    const initResponse = await readMessage(proc)
    expect((initResponse as any).id).toBe(1)
    expect((initResponse as any).error).toBeUndefined()

    // 2. confirm initialization
    proc.stdin!.write(encode({ jsonrpc: '2.0', method: 'notifications/initialized' }))

    // 3. call the exit tool
    proc.stdin!.write(
      encode({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'exit', arguments: {} },
      }),
    )
    const toolResponse = await readMessage(proc)
    expect((toolResponse as any).id).toBe(2)
    expect((toolResponse as any).error).toBeUndefined()
    expect((toolResponse as any).result.content[0].text).toMatch(/shutting down/i)

    // 4. server must exit cleanly
    const code = await waitForExit(proc)
    expect(code).toBe(0)
  }, 15_000)
})
