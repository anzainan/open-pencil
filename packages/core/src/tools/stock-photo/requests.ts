import { safeDestr } from 'destr'

import type { PhotoRequest } from './apply'

export function parsePhotoRequests(value: unknown): PhotoRequest[] {
  let parsed: unknown
  try {
    parsed = safeDestr(String(value))
  } catch {
    throw new Error('Invalid JSON in requests')
  }

  const requests = Array.isArray(parsed) ? parsed : [parsed]
  if (requests.length === 0) throw new Error('Empty requests array')
  return requests as PhotoRequest[]
}
