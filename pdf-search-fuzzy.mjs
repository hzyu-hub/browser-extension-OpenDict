// OpenDict PDF Fuzzy Search — O(nm) DP approximate substring matcher
// Zero dependencies. Operates on pre-normalized (lowercase, accent-stripped) text.
// Uses standard Levenshtein DP for substring search — simple, correct, and
// fast enough for our constraints (pattern ≤ 64, page text ≤ ~3000 chars).

/**
 * Find all approximate substring matches of `pattern` in `text`
 * with Levenshtein edit distance <= maxDist.
 *
 * Returns one result per "band entry" — when the edit distance first drops
 * to <= maxDist, and the best (lowest distance) position within that band.
 * Overlapping bands are merged.
 *
 * **Note on match boundaries**: The `start` position is approximate —
 * derived as max(0, end - pattern.length - maxDist). It may include
 * up to `maxDist` extra characters before the actual match start.
 * This is acceptable for v1.
 *
 * @param {string} text - haystack (pre-normalized, lowercase, no accents)
 * @param {string} pattern - needle (pre-normalized, max 64 chars)
 * @param {number} maxDist - max Levenshtein edit distance
 * @returns {Array<{start: number, end: number, editDistance: number}>}
 */
export function fuzzySearch(text, pattern, maxDist) {
  if (!pattern || pattern.length === 0) return [];
  if (pattern.length > 64) return [];
  if (!text) return [];
  if (maxDist < 0) maxDist = 0;

  const m = pattern.length;
  const n = text.length;

  let prev = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  const results = [];
  let inBand = false;
  let bandMinDist = Infinity;
  let bandMinEnd = 0;

  for (let j = 1; j <= n; j++) {
    curr[0] = 0; // Free start for substring search

    for (let i = 1; i <= m; i++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i - 1] + cost,  // match / substitute
        prev[i] + 1,         // delete from text
        curr[i - 1] + 1,     // insert into text
      );
    }

    const dist = curr[m];
    const below = dist <= maxDist;

    if (below && !inBand) {
      // Entering band
      inBand = true;
      bandMinDist = dist;
      bandMinEnd = j;
    } else if (below && inBand) {
      // Still in band — track best
      if (dist < bandMinDist) {
        bandMinDist = dist;
        bandMinEnd = j;
      }
    } else if (!below && inBand) {
      // Leaving band — emit match at best position
      const start = Math.max(0, bandMinEnd - m - maxDist);
      results.push({
        start,
        end: bandMinEnd,
        editDistance: bandMinDist,
      });
      inBand = false;
      bandMinDist = Infinity;
    }

    // Swap rows
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  // Handle band that extends to end of text
  if (inBand) {
    const start = Math.max(0, bandMinEnd - m - maxDist);
    results.push({
      start,
      end: bandMinEnd,
      editDistance: bandMinDist,
    });
  }

  return results;
}

/**
 * Compute match score: 1 - editDistance / queryLength.
 * Returns score in [0, 1]. Caller filters by threshold >= 0.8.
 */
export function fuzzyScore(editDistance, queryLength) {
  if (queryLength <= 0) return 0;
  return 1 - editDistance / queryLength;
}
