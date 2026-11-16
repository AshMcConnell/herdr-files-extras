// fzf-style fuzzy matching for the Files panel's search.
//
// Pure functions, no herdr imports: they run without the app, like
// ./download.js. A query matches a path as a case-insensitive subsequence,
// matched greedily left to right at each character's first remaining
// occurrence. The score favours matches at boundaries (the path's start,
// after / . - _ or a space, a camelCase hump) and consecutive runs, and
// charges a small gap penalty; rank() breaks score ties by the shorter
// path, then alphabetically.

function boundaryAt(path, at) {
  if (at === 0) return true;
  const prev = path[at - 1];
  if (prev === "/" || prev === "." || prev === "-" || prev === "_" || prev === " ") return true;
  return path[at] >= "A" && path[at] <= "Z" && prev >= "a" && prev <= "z";
}

// `match("read", "README.md")` → `{ score, indices }` (indices into the
// original path, for highlighting), or null when the query is not a
// subsequence of the path.
export function match(query, path) {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase(), p = path.toLowerCase();
  const indices = [];
  let score = 0, prev = -1, run = 0, at = 0;
  for (let i = 0; i < q.length; i++) {
    const found = p.indexOf(q[i], at);
    if (found === -1) return null;
    indices.push(found);
    score += 4;
    if (boundaryAt(path, found)) score += 8;
    if (found === prev + 1) score += 8 + Math.min(run++, 6) * 2;
    else if (prev >= 0) score -= Math.min(6, found - prev - 1) * 0.5;
    prev = found;
    at = found + 1;
  }
  return { score, indices };
}

// The best `limit` matches of `query` over `paths`, best first: score
// descending, then shorter paths, then alphabetical. `total` counts every
// match so the panel can say how many it left out.
export function rank(query, paths, limit = 200) {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], total: 0 };
  const results = [];
  for (const path of paths) {
    const m = match(q, path);
    if (m) results.push({ path, score: m.score, indices: m.indices });
  }
  results.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return { results: results.slice(0, limit), total: results.length };
}
