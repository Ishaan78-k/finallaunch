# Rajneeti 3D — Phase 7

Phase 7 extends the existing Phase 6 project without replacing its simulation architecture.

## Included

- Live coalition management: partners can be removed at any time; seat strength is recalculated and a confidence vote is run when the majority is lost.
- Persistent party-switching requests with politician name, party, constituency, loyalty and reason. The Prime Minister can accept, reject or negotiate, and cabinet members can resign or defect.
- A reusable government-office scene with a conference table, PM chair, 12 minister chairs, windows, lighting, seal and exit interaction. `E` enters from the exterior; `E` near the PM chair opens the cabinet decision office.
- A 12-officer PM escort that follows the player while they are the current Prime Minister and disappears when that role ends.
- Protest security thin-instance caps of 24/54/60 by quality level, with the existing 20 Hz update/culling approach preserved.
- Phase 7 government state is included in browser saves; save version is 7.

## Checks

- Production build: passed.
- Existing Vitest suite: 135 tests passed.
- Changed-file ESLint: passed.
- Full-project ESLint still reports 8 pre-existing unused-variable errors in Phase 1–6 files/tests; no new errors were reported in changed Phase 7 files.
