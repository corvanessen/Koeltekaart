function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))

  for (let i = 0; i < rows; i++) dp[i][0] = i
  for (let j = 0; j < cols; j++) dp[0][j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }

  return dp[rows - 1][cols - 1]
}

// Kleinste Levenshtein-afstand tussen `query` en elk substring-venster van
// `target` met een lengte rond die van `query` — zo tellen tikfouten ergens
// middenin een nog onafgemaakt getypte naam ook mee (niet alleen als de hele
// naam al getypt is).
function bestPartialDistance(query: string, target: string): number {
  if (query.length >= target.length) return levenshtein(query, target)

  let best = Infinity
  const maxLen = Math.min(target.length, query.length + 2)
  const minLen = Math.max(1, query.length - 1)

  for (let len = minLen; len <= maxLen; len++) {
    for (let start = 0; start <= target.length - len; start++) {
      const distance = levenshtein(query, target.slice(start, start + len))
      if (distance < best) best = distance
    }
  }

  return best
}

// Lagere score = beter match, `null` = geen match. Ondersteunt spelfouten
// (bv. "Leiderdrop" i.p.v. "Leiderdorp", "Sasenheim" i.p.v. "Sassenheim") via
// een op querylengte geschaalde edit-afstand, naast gewone prefix/substring-matching.
export function matchScore(query: string, target: string): number | null {
  const q = normalize(query).trim()
  const t = normalize(target)

  if (q.length === 0) return null
  if (t.startsWith(q)) return 0
  if (t.includes(q)) return 1

  const distance = bestPartialDistance(q, t)
  const maxAllowedTypos = Math.max(1, Math.floor(q.length / 3))

  return distance <= maxAllowedTypos ? 2 + distance : null
}
