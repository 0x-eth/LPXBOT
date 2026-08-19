# P05-04 Initial Failure

The initial P05-04 state had no candidate local Registry, typed operation plans, local Helper build, Anvil recovery fixture, or acceptance directory. The first observed creation capture also rejected Blast RPC's empty-string contract-creation `to` representation; the capture now accepts only `null` or the equivalent empty string and still verifies sender, nonce, receipt, owner(), address, and runtime hash.

Security review then exposed that the first Helper draft declared exact-amount allowance policy but accepted oversized direct ERC-20 approval. A failing boundary case was added and the Helper now rejects any direct allowance not exactly equal to the planned pull amount before asset movement. All frozen Helper and Registry hashes were recomputed from the corrected bytecode.
