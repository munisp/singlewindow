# IMO Compendium mapping tables (vendored)

Machine-readable IMO/WCO wire-conformance mapping tables, vendored as JSON
from blueeconomy-contracts `mappings/msw/v1/*.yaml`
(branch `phase10/wp3-conformance`; normative spec:
`docs/imo-wco-conformance.md`). Do NOT hand-edit here — regenerate from the
contracts YAMLs (the YAML is authoritative). `server/imoCompendium.test.ts`
asserts the vendored copies load and stay structurally valid (fail-closed
drift detection).
