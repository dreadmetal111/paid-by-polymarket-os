# MarketEvidenceV1: staged read-only contract

Status: documentation and offline synthetic fixture only. This pass introduces no executable validator, adapter, product feature, endpoint, capture/replay system, storage migration, or runtime activation. It makes no claim that MarketEvidenceV1 capture or replay exists, or that private Trader work is active. Existing production consumers remain unchanged.

Baseline inspected: clean `main`, commit `c1d0913e4211c46e6193e9323c412cf3f5554f3e`, tree `0fa0768579134cc838e4d6c2e3f74ab07b4c1e82`. No `AGENTS.md` was found in this workspace. The previously reported public API read of 198 markets at 01:36 UTC is a point-in-time response count only; it proves neither venue coverage nor historical completeness. No live data was retrieved for this contract.

The normative shape is [the draft 2020-12 schema](contracts/market-evidence-v1.schema.json); [the example](contracts/market-evidence-v1.example.json) is entirely `SYNTHETIC_FIXTURE`. Every identifier, value, version, and timestamp in that example is invented. Its venue label exercises an enum and is not provider evidence. Schema shape validation alone is insufficient for acceptance; the semantic gates below are required before any integration.

## Ownership and scope

This contract follows [the architecture canon](architecture-and-ownership-canon.md), [the operating plan](post-application-operating-plan.md), [the beta checklist](public-beta-launch-checklist.md), and [the event detail v0 spec](event-detail-page-v0-spec.md).

A future private Trader engine may produce a read-only derived public projection that Render validates and serves. Render remains the public application/API owner; browsers never contact private Trader or Acer services. Supabase may become the durable evidence store only after a separate contract and database schema gate covering migrations, retention, deduplication, access policy, and public projection. Acer is a candidate private host consistent with the canon's approved operations-host role; this contract adds no Acer runtime or service setup. Windows is development/manual QA only and must never be required for production availability. GitHub remains the canonical non-secret source after a separate publication step.

This envelope always has `version: "MarketEvidenceV1"`, `researchOnly: true`, and `executionEnabled: false`. It contains no account, positions, balances, PnL, credentials, order, wallet, or execution data. It authorizes no trading, account integration, deployment, or changes to a Trader repository. Future public copy must make no guaranteed-profit, trading-advice, official partnership, or authenticated-receipt claims.

## Identity and source

- `instrument.venue` is exactly `polymarket` or `kalshi`; supporting the enum does not assert a Kalshi adapter exists.
- `stableInstrumentID` identifies the same binary instrument across observations through a future venue-scoped identity registry. It is distinct from `evidenceID`, which identifies one immutable evaluated observation envelope. A new evaluation/cutoff or corrected value creates new content and a new evidence ID. Neither ID is a slug or an outcome/token ID.
- `marketID`, `eventID`, and the YES/NO `outcomeID` and `tokenID` are separate opaque strings, never inferred from each other. Unavailable identities are explicit `null`, never empty strings, zero, or substituted slugs. Slugs and display group/family keys are routing labels outside this envelope and cannot establish identity.
- `yes.label` and `no.label` explicitly map the two sides. `binaryMapping: EXPLICIT_SOURCE` means the adapter verified their mapping against the identified source payload (synthetic payload metadata in the fixture); array position alone is insufficient. `UNKNOWN` requires unresolved outcome/token IDs to remain null. Known YES and NO IDs must be distinct within their respective namespace; outcome and token namespaces need not share identifiers. Never infer a missing NO probability or invent binary identity for a nonbinary market.
- Null identity is structurally permitted for incomplete research evidence. Unresolved non-null IDs must fail the future registry gate; unresolved/null market or stable identity cannot join instruments, calculate cross-observation movement, or enter a publishable derived projection. An unmapped observation may be retained as incomplete research input only.
- `source` records provider/source identities, their versions (null when unavailable), and a required adapter version. `payloadDigest` binds the complete raw source JSON value before normalization using the algorithm below. A future adapter must retain that exact digest input with typed metadata and evidence lineage; a digest alone does not reconstruct it.
- `evidenceBasis` is `PUBLIC_POINT_IN_TIME` for public source observations or `SYNTHETIC_FIXTURE` for invented inputs and all their derivatives. Never mix synthetic evidence into a public observation lineage. Neither value asserts an authenticated receipt, signed provider statement, continuous capture, replay capability, or complete interval coverage. Public derived metrics require public input lineage, independently validated at the same cutoff.

## Time and availability

All timestamps use UTC calendar strings exactly `YYYY-MM-DDTHH:mm:ss.SSSZ`, with millisecond precision; numeric epoch seconds/milliseconds, offsets, local time, leap seconds, and variable precision are forbidden. Units are milliseconds, with no rounding into hourly buckets. Actual calendar validity requires a format-aware validator. Hash timestamp strings literally, without parsing, rewriting, or timezone conversion.

`sourceEventAtUtc` is nullable source-reported event time, never knowledge/availability time. `receivedAtUtc` is the future adapter's local receipt time; it is not an authenticated provider receipt. `availableAtUtc` is the earliest time the entire payload and required metadata were usable by the evaluating system. Neither may be backdated from a provider update or legacy snapshot hour. Derived availability must be no earlier than all required input availability and completion of its calculation. Unknown receipt/availability prevents creating an acceptable V1 envelope; these required timestamps may not be invented.

The optional root `interval` describes the source observation's time support; omission means unknown support. Each present interval/window has `type`, `startUtc`, and `endUtc`. `POINT_IN_TIME` requires equal endpoints; `INTERVAL` requires strictly increasing endpoints and uses half-open `[startUtc, endUtc)` semantics. Metric windows describe the actual measured/calculated period. Gaps and observed coverage intervals use the same representation. No window/interval end may exceed `availableAtUtc` or the cutoff. A source event timestamp alone does not establish interval coverage.

Future acceptance must enforce these relationships, which JSON Schema cannot compare:

```text
receivedAtUtc <= availableAtUtc <= availabilityCutoffUtc <= evaluationAtUtc
availableAtUtc < expiresAtUtc
evaluationAtUtc < expiresAtUtc
```

`evaluationAtUtc` is the research evaluation clock; `availabilityCutoffUtc` is its latest eligible knowledge time. Reject future-available evidence (`availableAtUtc > cutoff` or `> evaluation`), including dependencies. Reject expired evidence at equality (`evaluationAtUtc >= expiresAtUtc`). Expiry is exclusive, chosen by a separately approved per-source/metric freshness policy; the fixture's five-minute lifetime is invented, not a recommended production TTL. That policy must also constrain evidence age at the cutoff and any source-specific event-time freshness rule; a producer cannot extend expiry arbitrarily to evade staleness.

Source event time can be unknown, older, or affected by clock skew. Never substitute it for receipt time; flag suspicious future source events as partial/unusable under a future source policy. A stored envelope is immutable: current-time display must recompute whether it has expired, and future reevaluation produces another evidence ID. A historical fixture valid at its embedded evaluation is stale for present-time consumption. Rejected/stale records may be shown with explicit research status, but their metrics cannot be treated as eligible current evidence.

## Quality, coverage, gaps, and metrics

`quality.status` has stable values `UNKNOWN`, `PARTIAL`, `USABLE`; it is a declared assessment, not a bypass of validator rejection. `quality.coverage` is `UNKNOWN`, `PARTIAL`, or `COMPLETE_PROVEN`. Expected/observed sample counts are nullable nonnegative integers. Count observations for this instrument/source/support period, not the returned market population. Unknown expected count stays null; observed zero means a measured zero count, never missingness.

`observedInterval` and `observedCoverageFraction` are null unless sampling support is actually established. A fractional coverage value requires an actual `INTERVAL` and a documented expected sampling schedule in the retained source/adapter version metadata. Do not infer it from first/last observations, sample count, or a successful response. `COMPLETE_PROVEN` additionally requires verified schedule membership with no missing expected samples, equal positive expected/observed counts, fraction 1, and no gaps. The schema checks some shape conditions; only the future validator can verify that proof.

Every declared gap has a stable reason and nullable interval: `SOURCE_UNAVAILABLE`, `SAMPLE_MISSING`, `METRIC_MISSING`, `IDENTITY_UNAVAILABLE`, `TIMESTAMP_UNKNOWN`, or `INVALID_SOURCE_VALUE`. A null gap interval means its extent is unknown. Empty `gaps` means no declared gaps, not proven complete coverage. Coverage of timestamps does not imply all metrics are present. Missing required metrics or unresolved identity requires `PARTIAL` or `UNKNOWN`, even with a proven sampling schedule.

All four metric objects are required, with explicit nullable `value`; never interpolate, carry forward, coerce null to zero, or supply zero defaults. A real measured zero is allowed with valid units and provenance. If an input is unavailable, invalid, future-available, expired, or lacks required identity/window/unit, its dependent metric stays null. Unknown metrics stay missing; there is no miscellaneous metric bag in V1.

| Metric | Units and support | Source/provenance rules |
|---|---|---|
| `yesProbability` | Value 0..1 or null; `PROBABILITY_FRACTION` (0.62 displays as 62%). Nullable actual support window. | Applies to the explicit YES outcome; mapping must be verified before a value is eligible. No reconstruction of a missing opposite outcome. |
| `volume` | Nonnegative value or null; known `CURRENCY_AMOUNT` or `CONTRACTS`, nullable when unknown; actual `INTERVAL` window required for a usable value. | Currency amount requires a verified ISO 4217 currency code; contracts requires currency null. Identify whether source volume is cumulative or period-specific in its source definition. Never silently label total volume as 24h. |
| `liquidity` | Same nonnegative amount/unit/currency rules; actual `POINT_IN_TIME` window required for a usable value. | Source definition must explain liquidity measurement; no invented book depth or currency conversion. |
| `movement` | Nullable signed change in YES probability; `PROBABILITY_FRACTION` (-1..1) or `PERCENTAGE_POINTS` (-100..100); actual `INTERVAL` window required for a usable value. | 0.02 fraction equals 2 percentage points. Relative percent return is not either unit and is unsupported. Never relabel 24h movement as 6h. |

Every metric's `provenance.kind` is `SOURCE_REPORTED`, `DERIVED`, or `UNAVAILABLE`. Source-reported values name the exact raw `sourceField` and have null calculation identity/version and no input evidence IDs. Unavailable values are null with no fabricated provenance. Derived metrics require `calculationID`, `calculationVersion`, and unique `inputEvidenceIDs` referencing immutable dependency envelopes; sourceField is null. Those calculation versions must resolve to reviewed definitions recording formula, units, window selection, rounding, and missing-input behavior. A derived metric can be null while retaining its intended dependency IDs if any input is missing; it must not become zero.

Future validation must resolve lineage without cycles or self-reference, verify compatible instrument/outcome/source basis and units/windows, enforce cutoff/expiry for every dependency, and reproduce non-null calculations. These provenance declarations are public-safe references, not embedded private engine state. Non-null probability with unknown support is permitted for a source-reported point-in-time quote, but does not prove historical sampling. Non-null volume/liquidity/movement requires the stricter metric-specific support rules above.

## Immutable digest algorithm

`CANONICAL_JSON_UTF8_V1` is fixed for this version. It describes canonical JSON input integrity, not authenticity. SHA-256 proves equality of the selected bytes; it cannot prove provider origin, trustworthy clocks, completeness, or correctness. No signature or authenticated-receipt semantics are implied.

1. Accept only JSON values. Reject duplicate object keys at parse time, undefined values, non-finite numbers/NaN, unpaired Unicode surrogates, and integers outside the exact IEEE-754 safe integer range. Numbers use finite IEEE-754 binary64 and ECMAScript `JSON.stringify` numeric serialization (including negative zero as `0`); original numeric lexemes are not preserved.
2. Recursively serialize objects with keys sorted ascending by UTF-16 code units (ECMAScript default string sort). Emit sorted key/value pairs directly; do not rebuild an object and let integer-like key enumeration reorder them. Preserve array order. Serialize scalar strings/keys using ECMAScript `JSON.stringify` escaping, with no Unicode normalization. Timestamp values remain literal strings.
3. Join keys/values with `:` and items with `,`; include JSON braces/brackets and no extra whitespace or trailing newline. Encode UTF-8 without BOM. Hash those bytes with SHA-256 and emit 64 lowercase hexadecimal characters.
4. For `source.payloadDigest`, hash the entire raw source JSON value, excluding nothing. This is canonical parsed payload integrity, not the wire-body hash. Any provider fields named evidenceID/contentDigest remain included in this raw-payload scope. Non-JSON sources require a separately versioned contract.
5. For `contentDigest`, hash the envelope after omitting exactly the two root properties `evidenceID` and `contentDigest` in their entirety. Omit no other fields: include source.payloadDigest, evaluation/cutoff/expiry, explicit nulls, and empty arrays; absent optional root interval stays absent. Never omit nested properties with matching names.
6. Set `contentDigest.algorithm = "SHA-256"`, `canonicalization = "CANONICAL_JSON_UTF8_V1"`, and `value` to that hash; set `evidenceID = "mev1:sha256:" + value`. Verify both metadata constants even though root contentDigest is excluded from its own hash. Freeze the whole envelope thereafter.

Compact exact serialization, with input restrictions in step 1 as preconditions (algorithm notation only; no validator is installed):

```javascript
C(v) = v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(C).join(",") + "]"
  : "{" + Object.keys(v).sort()
      .map(k => JSON.stringify(k) + ":" + C(v[k])).join(",") + "}";
D(v) = lowercaseHex(SHA256(UTF8(C(v))));
```

The example's entire raw synthetic payload digest input is `{"eventID":null,"fixtureID":"synthetic-payload-001","marketID":"synthetic-market-001","noOutcomeID":"synthetic-outcome-no-001","noTokenID":"synthetic-token-no-001","yesOutcomeID":"synthetic-outcome-yes-001","yesProbability":0.62,"yesTokenID":"synthetic-token-yes-001"}`; invented adapter metadata assigns its stable synthetic instrument ID, and the payload explicitly supplies its YES/NO mapping. The payload digest is `d195143a931d17f41157698a04d3069117b9e1330c6bf0ca5a0ad8d9e416af50`. The content digest is `9d5d8da5a1d7353253506886aa9e6fd646d66f12f6d59db7c013f18dd4929c9d`. Metadata corrections or a different evaluation change the content digest. Repeated identical evidence IDs are idempotent duplicates, not additional observations; conflicting content under one ID is rejected. JSON Schema cannot compute hashes, compare timestamps, resolve dependencies, verify identity registries, or prove coverage.

## Future Trader mapping (unimplemented)

This V1 projects identified Polymarket/Kalshi binary-market evidence only; it is not a generic asset-bar envelope. Trader's current Coinbase BTC-USD bars remain separate underlying evidence and cannot be mapped into V1 by identity-registry lookup or unit conversion. Never convert a USD asset price into YES probability or invent a Polymarket/Kalshi venue, market, outcome, or token identity for BTC-USD. Before BTC bar lineage can support a binary derived metric, a separate versioned asset/cross-asset dependency projection contract must define that relationship and its identity, time, units, calculation, and provenance rules. The current V1 dependency compatibility gate cannot establish this relationship. The mapping proposals below apply only to otherwise eligible identified binary-market observations; they do not make current Coinbase bars eligible.
The Trader lane's observation contract at baseline `bf0ca939` uses separate `source_timestamp_utc`, `received_at_utc`, and `normalized_at_utc` fields. This V1 envelope is a distinct public projection, not a drop-in replacement for that storage contract. A future reviewed adapter must preserve its source observation identity and timing metadata in retained lineage and map `availableAtUtc` conservatively as `max(received_at_utc, normalized_at_utc)`. Both receipt and normalization timestamps must be known; source timestamp, bar end, or receipt alone cannot establish availability.

For the Trader lane's explicit `as_of_utc` query, eligibility requires source timestamp, receipt, and normalization to be no later than the cutoff. Preserve that stricter source policy when projecting Trader evidence rather than weakening it to the generic nullable-source-time rule above. Bar support maps `interval_start_utc` and `interval_end_utc`; retain its `interval` definition and `complete` flag in lineage. Do not infer complete coverage from a bar being complete.

Mapping proposals: `observation_id` remains a source-lineage identifier, not `evidenceID`; `instrument_id` requires the venue identity registry; `source_provider`, `source_symbol`, `source_identity`, and `schema_version` require explicit provider/source metadata mapping. `quality`, `quality_reasons`, and `quality_policy_version` require a separately reviewed status/reason policy. Preserve optional `source_sequence`, immutable `metadata`, and `supersedes_observation_id` in retained lineage; correction versions must never be flattened into an overwritten observation. Metric `metric_name`, `value`, and `unit` require exact unit/support conversion.

This pass implements no cross-repository adapter or stored available-at column. The Trader lane's staged immutable correction/as-of/restart foundation does not establish live capture, transport, House of Markets integration, or end-to-end replay readiness. Cross-contract compatibility remains a gate before product wiring.

## Exact existing seams and adapter cautions

Line anchors below refer to the inspected baseline; no listed consumer is modified or wired to this contract.

| Existing seam | Current behavior and future boundary |
|---|---|
| [server normalizeMarket](../server.js#L4348) | Parses outcomes/prices/token IDs and produces discovery data. `id` can fall back from raw ID to condition ID to slug (4417); volume/liquidity fallbacks become zero (4356, 4434). Future adapter must map raw source plus typed identity/time/unit/provenance metadata before these lossy defaults. |
| [server refreshLiveMarkets](../server.js#L5080) | Fetches raw Gamma markets, normalizes, filters, sorts, caches, then updates existing internal state. Cache `lastFetchedAt` is response refresh metadata, not a per-observation evidence receipt/availability pair. |
| [server /api/liveMarkets](../server.js#L5125) | Returns `count`, `lastRefreshedAt`, source `gamma`, and normalized markets. Response population is filtered discovery data, not a coverage denominator or new evidence endpoint. |
| [server toPublicMarketHistoryPoint](../server.js#L2697) | Exposes snapshotHour/probability/movement/volume/liquidity, omitting source and capturedAt. It does not carry V1 evidence lineage. |
| [server /api/market-history](../server.js#L5783) | Reads/sorts snapshots and projects those history points. Existing probability is 0..100 percentage points, unlike V1's 0..1. A chart response cannot establish receipt availability provenance. |
| [frontend loadHomepageDiscoveryData](../public/app.js#L2924) | Actual live-market loader (there is no `loadLiveMarkets` function here): fetches /api/liveMarkets at 2929, fills caches, and invokes market/event rendering. |
| [frontend normalizeMarketHistoryPoint](../public/app.js#L4698) | Accepts legacy 0..100 probability and coerces metric numbers through helpers. It is a chart adapter, not an evidence validator. |
| [frontend fetchMarketHistoryPoints](../public/app.js#L4712) | Fetches /api/market-history, normalizes/filters/sorts points, and caches results. No independent source/availability proof is added. |
| [frontend renderMarketPageView](../public/app.js#L5193) | Renders cached discovery probabilities, volume/liquidity, movement, update label, and history UI. Future research projection would require explicit availability/cutoff/missing/stale display after a separate gate. |
| [frontend renderEventDetailView](../public/app.js#L5670) | Groups cached markets and renders summary/child comparisons. Event/family route slugs are not venue event IDs; aggregate defaults cannot be promoted to evidence. |

Critical legacy warnings:

- [computeMoverForMarket](../server.js#L4517) targets a six-hour comparison, but its fallback at 4528 reconstructs a past price by subtracting `oneDayPriceChange` (24h) and clamping it. This is unsafe as observed evidence or six-hour source movement. Do not upgrade the reconstructed pastPrice to an observed sample.
- [normalizeMarketSnapshotHour](../server.js#L764) floors time to an hour. [mapMarketToSnapshot](../server.js#L2441) and [getNonNegativeSnapshotNumber](../server.js#L2459) can coerce null through `Number(null)` to zero; capturedAt may also be defaulted by the snapshot normalizer (781). Snapshot hours, capturedAt, and legacy nullable-metric coercion do not satisfy V1 receipt/availability provenance.
- [frontend getFiniteNumber](../public/app.js#L150) also converts null to zero. [getEventSummary](../public/app.js#L2289) sums with zero fallbacks; [getMarketMovementValue](../public/app.js#L2306) mixes priceChange, oneDayPriceChange, and relative percentChange and defaults to zero. A future adapter must use raw source plus typed metadata and verified input evidence, never promote frontend derived fallbacks, summary totals, or display transformations into source observations.

Future frontend display must label research-only, basis (synthetic/public), as-of availability time, evaluation time and cutoff; show missing values as unavailable, stale values as stale, and partial/unknown coverage explicitly. An empty gap list must not show a complete-coverage badge. At display time, expiry must be checked against the display clock. No account/positions/balances/PnL views or execution controls belong in this projection. All of this remains a future display contract; current production views and API responses are unchanged.

## Staged gates and offline fixture plan

- [ ] Contract review: approve identity namespaces, source definitions, metric units/support, and freshness/coverage policies; retain closed objects and the read-only constants.
- [ ] Implement a separately scoped offline draft 2020-12 validator with calendar/format enforcement plus the semantic gates above: identity, clocks, intervals, expiry, complete coverage proof, lineage, unit conversion, duplicate handling, and both digests. No executable validator is created by this pass.
- [ ] Run the fixture plan against that implementation with an injected evaluation clock and no network. Mutations below must recompute contentDigest/evidenceID unless testing integrity; dependency cases need independent synthetic input envelopes. Test actual accept/reject behavior, not documentation text or mirrored assertions.
- [ ] Separately approve a raw-source adapter and private Trader public projection contract; do not presume any active Trader implementation. Prove missingness and source metadata survive normalization; compare source and derived units/windows explicitly.
- [ ] Separately approve Supabase evidence schema/migrations, immutable storage/deduplication, lineage retention, retention policy, access controls, and public-safe projection before any durable writes.
- [ ] Separately approve Render API/frontend integration and research-status QA at the listed seams, with compatibility review for current consumers and no execution activation.
- [ ] Separately decide private host/runtime operations under the canon (Acer candidate; Windows dev only), then deployment/publication gates. No new services, capture, replay, endpoint, credentials, accounts, orders, deployment, push, or PR in this pass.

| Offline good/bad case | Expected future result and gate |
|---|---|
| Unchanged synthetic fixture at embedded evaluation | Accept as partial, unknown coverage, synthetic research evidence; three missing metric values stay null. |
| Fixture evaluated at/after expiry, including present time | Reject eligibility as stale; expiry equality rejects. |
| availableAtUtc later than cutoff/evaluation | Reject future-available data even when source event is old. |
| Cutoff after evaluation or receipt after availability | Reject semantic timestamp ordering. |
| INTERVAL end before/equal start; POINT_IN_TIME unequal endpoints | Reject inversion/invalid support; interval endpoints are compared semantically. |
| Missing metric represented by null vs fabricated zero | Accept null as missing/partial; zero requires measured source evidence and complete unit/provenance, otherwise reject semantic eligibility. |
| Null identity vs non-null unregistered identity | Preserve null as incomplete research input; block joins/projection. Reject unregistered non-null IDs and conflated slug/market/outcome IDs. |
| Wrong probability/unit range, USD used as amount unit, or currency on CONTRACTS | Reject schema or semantic unit gate; currency code validity needs a registry/policy. |
| Volume/liquidity with wrong window type; movement mixing 24h and 6h | Reject metric support/calculation gate, despite structurally valid timestamp objects. |
| Same evidence ID/content delivered twice | Idempotent deduplication, not two samples. Same ID with different content rejects. |
| Tampered value or raw payload, unchanged digest | Reject content/payload hash mismatch; never treat a matching hash as authenticity. |
| Empty gaps with UNKNOWN coverage | Accept declaration only; show unknown coverage, not complete. |
| COMPLETE_PROVEN with count/fraction shape but no retained schedule proof | Reject completeness claim; only verified sample membership/schedule can pass. |
| Actually verified complete synthetic schedule vs explicit missing-sample gap | Accept proven schedule as synthetic complete coverage; gap remains partial coverage with its known interval. |
| Coinbase BTC-USD bar, including invented binary IDs or USD price used as YES probability | Reject V1 mapping. Retain separate asset evidence; a separately versioned asset/cross-asset projection contract is required before any binary derived-metric dependency. The existing dependency compatibility gate cannot establish that relationship. |
| Derived input missing, stale, future-available, or incompatible | Dependent metric null/ineligible; reject any fabricated non-null result. Reject circular/self lineage. |
| Extra root/nested property, executionEnabled true, or different version | Reject closed-object/constant schema gate. |
| Duplicate JSON keys, NaN, unsafe integer, or invalid calendar timestamp | Reject parser/canonicalization/format gate before digest verification. |

Validation for this bounded pass: parse both JSON files offline and validate the example against the schema only if an existing offline validator is available. The inspected Python environment has no jsonschema package; repository dependencies have no JSON Schema validator. Do not install/download dependencies, create a validator, or claim schema/semantic acceptance tests passed. A one-off digest recomputation and focused source/hash/diff review can verify the fixture's integrity and edit scope, but do not replace the remaining gates.
