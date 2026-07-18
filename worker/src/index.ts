export interface Env {
  GITHUB_TOKEN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  ALLOWED_ORIGIN: string
  RATE_LIMIT_KV: KVNamespace
}

type EditableCategoryKey = 'binnen' | 'park' | 'zwembad' | 'buitenwater'
const EDITABLE_CATEGORIES: EditableCategoryKey[] = ['binnen', 'park', 'zwembad', 'buitenwater']

type SubmissionPayload = {
  kind: 'add' | 'edit'
  id?: string
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  website?: string
}

type LocationEntry = {
  id: string
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  address_confirmed?: boolean
  coords_verified?: boolean
}

type LocationOverride = {
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
}

// additions = nieuwe community-locaties; overrides = wijzigingen op een bestaande
// id (zowel op een origineel uit Koeltekaart als op een eigen addition).
type CommunityData = {
  additions: LocationEntry[]
  overrides: Record<string, LocationOverride>
}

// Zelfde grenzen als municipalityBounds in src/main.ts.
const LEIDEN_BOUNDS = { minLat: 52.11, maxLat: 52.28, minLon: 4.33, maxLon: 4.55 }
const NAME_MAX = 100
const ADDR_MAX = 150
const DESC_MAX = 500
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60
const LOCATIONS_PATH = 'locations.json'
// De originele, samengestelde locaties leven in de site-repo zelf (publiek,
// dus zonder token leesbaar) — deze worker schrijft alleen naar GITHUB_REPO.
const BASE_LOCATIONS_URL = 'https://raw.githubusercontent.com/corvanessen/Koeltekaart/main/public/locations.json'

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function jsonResponse(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function randomSuffix(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4)
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function validate(payload: Partial<SubmissionPayload>): string | null {
  if (payload.kind !== 'add' && payload.kind !== 'edit') return 'Ongeldig type inzending.'
  if (payload.kind === 'edit' && !payload.id) return 'Ontbrekende locatie-id voor wijziging.'
  if (!payload.cat || !EDITABLE_CATEGORIES.includes(payload.cat)) return 'Ongeldige categorie.'
  if (!payload.name || payload.name.trim().length === 0 || payload.name.length > NAME_MAX) return 'Ongeldige naam.'
  if (payload.addr && payload.addr.length > ADDR_MAX) return 'Adres is te lang.'
  if (payload.desc && payload.desc.length > DESC_MAX) return 'Beschrijving is te lang.'
  if (typeof payload.lat !== 'number' || typeof payload.lon !== 'number' || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lon))
    return 'Ongeldige coördinaten.'
  if (
    payload.lat < LEIDEN_BOUNDS.minLat ||
    payload.lat > LEIDEN_BOUNDS.maxLat ||
    payload.lon < LEIDEN_BOUNDS.minLon ||
    payload.lon > LEIDEN_BOUNDS.maxLon
  )
    return 'Locatie ligt buiten de regio Leiden.'
  return null
}

async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:${ip}`
  const raw = await env.RATE_LIMIT_KV.get(key)
  const count = raw ? Number(raw) : 0
  if (count >= RATE_LIMIT_MAX) return false
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS })
  return true
}

async function githubRequest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'koeltekaart-submit-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub API ${path} -> ${response.status}: ${body}`)
  }

  return response.json() as Promise<T>
}

async function fetchBaseLocations(): Promise<LocationEntry[]> {
  const response = await fetch(BASE_LOCATIONS_URL)
  if (!response.ok) throw new Error(`Kon originele locaties niet laden: ${response.status}`)
  return response.json() as Promise<LocationEntry[]>
}

async function fetchCommunityData(env: Env): Promise<{ data: CommunityData; sha?: string }> {
  const repoPath = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`
  try {
    const file = await githubRequest<{ content: string; sha: string }>(
      env,
      `${repoPath}/contents/${LOCATIONS_PATH}?ref=main`,
    )
    const data = JSON.parse(fromBase64(file.content)) as CommunityData
    return { data, sha: file.sha }
  } catch (error) {
    if (error instanceof Error && error.message.includes('-> 404')) {
      return { data: { additions: [], overrides: {} } }
    }
    throw error
  }
}

function applyEdit(payload: SubmissionPayload, community: CommunityData, baseLocations: LocationEntry[]): string {
  const additionIndex = community.additions.findIndex((loc) => loc.id === payload.id)

  if (additionIndex !== -1) {
    community.additions[additionIndex] = {
      ...community.additions[additionIndex],
      cat: payload.cat,
      name: payload.name,
      addr: payload.addr,
      desc: payload.desc,
      lat: payload.lat,
      lon: payload.lon,
    }
    return `Wijziging: ${payload.name}`
  }

  const existsInBase = baseLocations.some((loc) => loc.id === payload.id)
  const existsAsOverride = Boolean(payload.id && community.overrides[payload.id])
  if (!existsInBase && !existsAsOverride) throw new Error(`Onbekende locatie-id: ${payload.id}`)

  community.overrides[payload.id as string] = {
    cat: payload.cat,
    name: payload.name,
    addr: payload.addr,
    desc: payload.desc,
    lat: payload.lat,
    lon: payload.lon,
  }
  return `Wijziging: ${payload.name}`
}

function applyAdd(payload: SubmissionPayload, community: CommunityData, baseLocations: LocationEntry[]): string {
  const existingIds = new Set([...baseLocations.map((loc) => loc.id), ...community.additions.map((loc) => loc.id)])
  const base = slugify(payload.name)
  let id = base
  while (existingIds.has(id)) id = `${base}-${randomSuffix()}`

  community.additions.push({
    id,
    cat: payload.cat,
    name: payload.name,
    addr: payload.addr,
    desc: payload.desc,
    lat: payload.lat,
    lon: payload.lon,
    address_confirmed: false,
    coords_verified: false,
  })
  return `Nieuwe locatie: ${payload.name}`
}

async function createSubmissionPR(env: Env, payload: SubmissionPayload): Promise<void> {
  const repoPath = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`

  const baseLocations = await fetchBaseLocations()
  const { data: community, sha } = await fetchCommunityData(env)

  const label = payload.kind === 'edit' ? applyEdit(payload, community, baseLocations) : applyAdd(payload, community, baseLocations)

  const mainRef = await githubRequest<{ object: { sha: string } }>(env, `${repoPath}/git/refs/heads/main`)
  const branch = `submission/${Date.now()}-${slugify(payload.name)}`

  await githubRequest(env, `${repoPath}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainRef.object.sha }),
  })

  await githubRequest(env, `${repoPath}/contents/${LOCATIONS_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: label,
      content: toBase64(JSON.stringify(community, null, 2) + '\n'),
      ...(sha ? { sha } : {}),
      branch,
    }),
  })

  const body = [
    `Nieuwe inzending via de koeltekaart (${payload.kind === 'edit' ? 'wijzigingsvoorstel' : 'nieuwe locatie'}).`,
    '',
    `- **Categorie**: ${payload.cat}`,
    `- **Naam**: ${payload.name}`,
    `- **Adres**: ${payload.addr || '(geen)'}`,
    `- **Beschrijving**: ${payload.desc || '(geen)'}`,
    `- **Coördinaten**: ${payload.lat}, ${payload.lon}`,
    '',
    'Samenvoegen = goedkeuren en publiceren. Sluiten = afwijzen.',
  ].join('\n')

  await githubRequest(env, `${repoPath}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title: label, head: branch, base: 'main', body }),
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    const url = new URL(request.url)
    if (url.pathname !== '/submit') {
      return jsonResponse({ error: 'Niet gevonden.' }, 404, origin)
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Methode niet toegestaan.' }, 405, origin)
    }

    let payload: Partial<SubmissionPayload>
    try {
      payload = await request.json()
    } catch {
      return jsonResponse({ error: 'Ongeldige JSON.' }, 400, origin)
    }

    // Honeypot: alleen bots vullen dit veld in. Doe alsof het gelukt is, zonder iets te versturen.
    if (payload.website && payload.website.trim() !== '') {
      return jsonResponse({ ok: true }, 202, origin)
    }

    const validationError = validate(payload)
    if (validationError) {
      return jsonResponse({ error: validationError }, 400, origin)
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const allowed = await checkRateLimit(env, ip)
    if (!allowed) {
      return jsonResponse(
        { error: 'Te veel voorstellen vanaf dit IP-adres, probeer het later opnieuw.' },
        429,
        origin,
      )
    }

    try {
      await createSubmissionPR(env, payload as SubmissionPayload)
      return jsonResponse({ ok: true }, 201, origin)
    } catch (error) {
      console.error(error)
      return jsonResponse({ error: 'Versturen naar GitHub is mislukt.' }, 502, origin)
    }
  },
}
