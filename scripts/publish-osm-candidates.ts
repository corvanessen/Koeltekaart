// Neemt het (door jou nagelopen en zo nodig ingekorte) osm-candidates.json
// bestand van scripts/import-osm.ts en opent er één PR mee op KoelteKaartData,
// op dezelfde manier als de submit-worker dat per losse inzending doet
// (worker/src/index.ts:createSubmissionPR). Verwijder eerst uit
// osm-candidates.json wat je niet wilt overnemen — alles wat er nog in staat
// als je dit script draait, wordt voorgesteld.
//
// Vereist: env var GITHUB_TOKEN — fine-grained PAT met alléén toegang tot
// KoelteKaartData, rechten Contents: Read and write + Pull requests: Read and
// write (zelfde soort token/scopes als in README.md beschreven voor de worker,
// maar niet dezelfde — de worker-secret is niet uitleesbaar).
//
// Gebruik (PowerShell):
//   $env:GITHUB_TOKEN = "github_pat_..."
//   npm run publish:osm
//
// Gebruik (bash):
//   GITHUB_TOKEN=github_pat_... npm run publish:osm

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MunicipalityId } from '../shared/municipalities'

type EditableCategoryKey = 'binnen' | 'park' | 'zwembad' | 'buitenwater'
const EDITABLE_CATEGORIES: EditableCategoryKey[] = ['binnen', 'park', 'zwembad', 'buitenwater']

type LocationEntry = {
  id: string
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  municipality?: MunicipalityId
  address_confirmed?: boolean
  coords_verified?: boolean
}

type CommunityData = {
  additions: LocationEntry[]
  overrides: Record<string, unknown>
}

const GITHUB_OWNER = 'corvanessen'
const GITHUB_REPO = 'KoelteKaartData'
const LOCATIONS_PATH = 'locations.json'
const BASE_LOCATIONS_URL = 'https://raw.githubusercontent.com/corvanessen/Koeltekaart/main/public/locations.json'

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64')
}

async function githubRequest<T>(token: string, apiPath: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'koeltekaart-publish-osm-candidates',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`GitHub API ${apiPath} -> ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('Zet GITHUB_TOKEN (fine-grained PAT met schrijftoegang tot KoelteKaartData).')

  const candidatesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../osm-candidates.json')
  const candidatesRaw = JSON.parse(await fs.readFile(candidatesPath, 'utf-8')) as { additions: LocationEntry[] }
  const candidates = candidatesRaw.additions

  if (candidates.length === 0) {
    console.log('osm-candidates.json bevat geen additions meer — niets te publiceren.')
    return
  }

  for (const candidate of candidates) {
    if (!EDITABLE_CATEGORIES.includes(candidate.cat)) {
      throw new Error(`Ongeldige categorie "${candidate.cat}" bij "${candidate.name}".`)
    }
  }

  const repoPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}`

  const [baseLocations, communityFile] = await Promise.all([
    fetch(BASE_LOCATIONS_URL).then((r) => (r.ok ? r.json() : [])) as Promise<LocationEntry[]>,
    githubRequest<{ content: string; sha: string }>(token, `${repoPath}/contents/${LOCATIONS_PATH}?ref=main`).catch(
      (error: unknown) => {
        if (error instanceof Error && error.message.includes('-> 404')) return undefined
        throw error
      },
    ),
  ])

  const community: CommunityData = communityFile
    ? (JSON.parse(Buffer.from(communityFile.content, 'base64').toString('utf-8')) as CommunityData)
    : { additions: [], overrides: {} }

  const existingIds = new Set([...baseLocations.map((loc) => loc.id), ...community.additions.map((loc) => loc.id)])

  // Her-checken op id-botsingen: er kan tijd verstreken zijn sinds
  // import-osm.ts dit bestand genereerde, dus community-data kan intussen zijn
  // aangevuld.
  for (const candidate of candidates) {
    if (existingIds.has(candidate.id)) {
      const base = slugify(candidate.name)
      let id = base
      let suffix = 2
      while (existingIds.has(id)) id = `${base}-${suffix++}`
      console.log(`Id "${candidate.id}" bestaat al, hernoemd naar "${id}".`)
      candidate.id = id
    }
    existingIds.add(candidate.id)
    community.additions.push(candidate)
  }

  const mainRef = await githubRequest<{ object: { sha: string } }>(token, `${repoPath}/git/refs/heads/main`)
  const branch = `osm-import/${Date.now()}`

  await githubRequest(token, `${repoPath}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainRef.object.sha }),
  })

  await githubRequest(token, `${repoPath}/contents/${LOCATIONS_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `OSM-import: ${candidates.length} kandidaten (bibliotheken, gemeentehuizen, zwembaden)`,
      content: toBase64(`${JSON.stringify(community, null, 2)}\n`),
      ...(communityFile ? { sha: communityFile.sha } : {}),
      branch,
    }),
  })

  const body = [
    `Batch-import uit OpenStreetMap (bibliotheken, gemeentehuizen, zwembaden) via scripts/import-osm.ts.`,
    'Nog niet handmatig geverifieerd — controleer per locatie vrije toegankelijkheid, zitplekken en openingstijden tijdens hitte voordat je goedkeurt.',
    '',
    ...candidates.map((c) => `- **${c.name}** (${c.cat}, ${c.municipality}) — ${c.addr || 'geen adres'}`),
    '',
    'Samenvoegen = goedkeuren en publiceren. Sluiten = afwijzen. Individuele regels kun je ook los uit de diff verwijderen vóór het mergen.',
  ].join('\n')

  const pr = await githubRequest<{ html_url: string }>(token, `${repoPath}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `OSM-import: ${candidates.length} kandidaten`,
      head: branch,
      base: 'main',
      body,
    }),
  })

  console.log(`PR aangemaakt: ${pr.html_url}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
