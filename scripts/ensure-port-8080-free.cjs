const { execFileSync } = require('node:child_process')

const PORT = 8080
const isDryRun = process.argv.includes('--dry-run')

function getListeningPids(port) {
  if (process.platform !== 'win32') {
    console.warn(`[ensure-port-${port}] Skipping port cleanup on unsupported platform: ${process.platform}`)
    return []
  }

  const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const seenPids = new Set()
  const pids = []

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue

    const [protocol, localAddress, , state, pid] = parts
    if (protocol !== 'TCP' || state !== 'LISTENING') continue

    const localPort = localAddress.split(':').at(-1)
    if (localPort !== String(port) || !pid || seenPids.has(pid)) continue

    seenPids.add(pid)
    pids.push(pid)
  }

  return pids
}

function stopPid(pid, port) {
  execFileSync('taskkill.exe', ['/PID', pid, '/F'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(`[ensure-port-${port}] Stopped PID ${pid}.`)
}

function main() {
  const pids = getListeningPids(PORT)

  if (pids.length === 0) {
    console.log(`[ensure-port-${PORT}] Port ${PORT} is already free.`)
    return
  }

  if (isDryRun) {
    console.log(`[ensure-port-${PORT}] Would stop PID(s): ${pids.join(', ')}`)
    return
  }

  console.log(`[ensure-port-${PORT}] Found PID(s) on port ${PORT}: ${pids.join(', ')}`)
  for (const pid of pids) {
    stopPid(pid, PORT)
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[ensure-port-${PORT}] Failed: ${message}`)
  process.exit(1)
}
