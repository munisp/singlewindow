# Maritime Single Window (FAL/MSW) event fixtures (SYNTHETIC)

One canonical-wire envelope JSON per event type defined in
`proto/blueeconomy/msw/v1/msw.proto` and described in `docs/msw.md`.

All contents are synthetic: identifiers, references, vessel data, agencies,
timestamps and keys are invented for schema illustration only and must never
be treated as real operational data. The fixtures are, however, schema-valid
against the compiled descriptor set and carry genuinely verifiable
JWS-EdDSA signatures (RFC 7515 compact serialization over the RFC 8785
JCS-canonicalized envelope, per `docs/envelope-signature.md`), signed with a
throwaway synthetic key so consumers can exercise their full verification
path:

```
kid:        blueeconomy-singlewindow-msw-0
public key: iWAFxZ7dXCQAa--7-WwPW4TXI2jI4mhphx0CVxN3vW8
```

This key is for fixture verification only and is not a production producer
key; production key directories are distributed per
`docs/envelope-signature.md` §3.

The fixtures narrate one coherent synthetic visit (`mswv-000001`, vessel
IMO 9074729 at NGLOS): agent nominated and visit declared, FAL 1 accepted
and FAL 2 returned, FAL 5 crew list submitted (personal data — envelope
`RESTRICTED`), pratique refused then granted by Port Health, the NPPM 2021
joint boarding (NIS/NCS/NDLEA/NIMASA) scheduled and completed after
pratique, an arrival clearance refused and the departure clearance granted.
Envelope classifications follow the floors in `docs/msw.md` §Classification
floors.
