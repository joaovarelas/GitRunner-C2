// Small localStorage-backed cache of facts we learn about an endpoint by
// running jobs -- currently its real IP, which GitLab.com's runner API does not
// expose. Keyed by runner id. This is our "database"; there isn't one.

const KEY = 'gl_endpoint_facts'

export interface EndpointFacts {
  ip?: string
}

function readAll(): Record<string, EndpointFacts> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function getFacts(id: number): EndpointFacts {
  return readAll()[id] || {}
}

export function setFacts(id: number, facts: EndpointFacts): void {
  const all = readAll()
  all[id] = { ...all[id], ...facts }
  localStorage.setItem(KEY, JSON.stringify(all))
}
