# PDF Reader Search Optimization — Development Progress

**Project scale:** small (≤30 tasks)
**Current phase:** ✅ ALL COMPLETE — 27/27 tasks done

---

## Task List

- [x] T01 Add `isCombiningMark()` function to `pdf-text-index-core.mjs` [simple] (depends on: -)
- [x] T02 Add `reverseOffsets` and `forwardOffsets` construction to `buildTextIndexFromRuns()` (includes code-point-aware iteration) [medium] (depends on: T01)
- [x] T03 Replace NFKC with NFKD in `normalizeRawChar()` and `normalizeSearchQuery()` [simple] (depends on: T01)
- [x] T05 Update `normalizeSearchQuery()` pipeline order (NFKD → strip Mn/Mc → strip soft-hyphens → collapse ws → trim → lowercase) [simple] (depends on: T03)
- [x] T06 Add `resolveCanonicalToRaw()` guard function [simple] (depends on: T02)
- [x] T07 Add `buildWhitespaceSkipTable()` to `pdf-text-index-core.mjs` [simple] (depends on: T02)
- [x] T08 Add `findMatchesWhitespaceTolerant()` to `pdf-text-index-core.mjs` [medium] (depends on: T07, T03)
- [x] T09 Create `pdf-feature-flags.mjs` with load/cache/watch [simple] (depends on: -)
- [x] T10 Create `pdf-search-fuzzy.mjs` with Myers bit-parallel matcher [complex] (depends on: -)
- [x] T11 Add `findMatchesFuzzy()` to `pdf-text-index-core.mjs` (imports from fuzzy, uses skip-table) [medium] (depends on: T08, T10)
- [x] T12 Refactor `runSearch()` to 3-tier pipeline with match-type tagging [medium] (depends on: T08, T11)
- [x] T13 Rewrite `buildTokens()` with script-aware word boundaries + number-unit regex [medium] (depends on: T02, T03)
- [x] T14 Add `applyHyphenJoinHeuristic()` post-processing pass [simple] (depends on: T13)
- [x] T15 Replace `extractAllPageTexts()` with `progressiveSearch()` async generator [complex] (depends on: T12)
- [x] T16 Add `runSearchProgressive()` consumer + `searchSinglePage`/`searchCoarsePage` generators [medium] (depends on: T15)
- [x] T17 Add match identity tracking (`currentMatchId`, `findMatchByIdentity`) [simple] (depends on: T12)
- [x] T18 Add `onPageTextLayerRendered` re-search with match disappearance flow [medium] (depends on: T17)
- [x] T19 Add approximate-match dashed-border CSS + current-match flash animation [simple] (depends on: -)
- [x] T20 Update `applyHighlightsToPage()` for match-type styling + ARIA labels [simple] (depends on: T19, T12)
- [x] T21 Update `updateSearchCount()` for differentiated match counts [simple] (depends on: T12)
- [x] T22 Wire feature flags into `pdf-viewer.js` init + pass as options to core [simple] (depends on: T09, T12)
- [x] T23 Write NFKD + offset mapping unit tests [medium] (depends on: T02, T05, T06)
- [x] T24 Write whitespace-tolerant + skip-table unit tests [simple] (depends on: T08)
- [x] T25 Write Myers matcher unit tests in `tests/pdf-search-fuzzy.test.mjs` [medium] (depends on: T10)
- [x] T26 Write feature-flags unit tests in `tests/pdf-feature-flags.test.mjs` [simple] (depends on: T09)
- [x] T27 Write tokenization v2 + hyphen-join unit tests [medium] (depends on: T13, T14)
- [x] T28 Run all existing tests — verify zero regression [simple] (depends on: T23, T24, T25, T26, T27)

## Status Legend

- `[ ]` pending
- `[x]` done
- `[!]` needs rework
- `[?]` blocked

## Complexity Budget

| Scale | Max tasks | Actual |
|-------|-----------|--------|
| simple (<30min) | — | 11 |
| medium (30-120min) | — | 12 |
| complex (>120min) | — | 4 |
| **Total** | ≤ 30 | **27** |

## Review Notes

Architect peer review changes applied:

1. **T04 merged into T02**: Code-point-aware iteration (`codePointAt` + `String.fromCodePoint` + `rawCharLen` tracking) is now part of T02 from the start, since it is a prerequisite for correct `globalRawPos` tracking — not a separate patch. T04 removed as standalone task. T13 and T23 dependencies updated from T04 to T02.

2. **T02 forwardOffsets construction fixed to O(n)**: Replaced the `forwardMapEntries` + `canonicalRawMap.indexOf()` approach (which was O(n²) worst-case) with a direct O(n) inversion of `reverseOffsets`: build reverseOffsets first, then set `forwardOffsets[reverseOffsets[ci]] = ci` for each non-synthetic canonical char.

3. **T10 cleaned up**: Removed draft/broken `fuzzySearch` and `fuzzySearchClean` implementations. Kept only the final clean `fuzzySearch` version. Added documentation note on approximate match boundaries (start position may over-cover by up to `maxDist` chars; acceptable for v1).

4. **T08 dependency updated**: Now depends on T07 and T03 (NFKD normalization needed for whitespace-tolerant search on canonical text).

5. **T12 coarse-text fallback added**: Tier 2 and Tier 3 now also search coarse (non-indexed) page text — whitespace-tolerant via stripped indexOf, and fuzzy via `fuzzySearch` on stripped haystacks. Import of `fuzzySearch`/`fuzzyScore` added to T12.

6. **T15 clarified**: Added design decision note (per-page tier fallback, not global-tier). Added step to delete old sync `runSearch()` after `runSearchProgressive` is complete.
