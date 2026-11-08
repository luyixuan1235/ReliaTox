const log = []

const wait = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms))

function pushLog(name, payload, result) {
  log.unshift({
    id: crypto.randomUUID(),
    name,
    payload,
    result,
    at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  })
  if (log.length > 48) log.pop()
}

export function getBackendLog() {
  return log
}

export async function callBackend(name, payload = {}) {
  await wait(name === 'simulateDisconnect' ? 420 : 240)
  const result = {
    ok: true,
    hooked: true,
    note: `前端已发出，等待接入：${name}`,
  }
  pushLog(name, payload, result)
  return result
}
