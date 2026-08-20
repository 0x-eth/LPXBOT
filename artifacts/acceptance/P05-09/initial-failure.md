# P05-09 Initial Failure

The first full `pnpm test` run passed 1020 of 1021 tests. `tests/signer-production-config.test.ts` failed because the exact production capability inventory had not yet added `plan-bound-local-helper-upgrade-signing`; adding the new plan-bound capability made its three assertions pass.

The first manual-recovery E2E run also found a strict-locator collision because `getByRole("textbox", { name: "Operation" })` matched both the operation input and the operation query button's accessible name. The locator was made exact, after which all four desktop/mobile P05-09 E2E cases passed.

These failures established the required Signer capability registration and unambiguous operation-query accessibility boundary before acceptance was finalized.
