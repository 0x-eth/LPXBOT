# Initial failure evidence

- Commit `fd47ee4dc493ace05215cd6f2492537810ef3ff9` added the versioned contract and DEX normalization tests before the contract implementation in `77ae9cd53c1adda1a81647715459147d9ef1edeb`.
- Commit `4b5ae577300150ff08e604bbb0026b59df3262ca` added Golden projection tests before the implementation in `92703b0ef2540eacd37d3a21c4d9f1c57f9a2070`.
- Commit `8e7247173f2d246e7d630651612fc4a93cbf5e35` added PostgreSQL atomicity, dedupe, and reorg recovery tests before the flow migration/store implementation.
- The P02 completion governance assertion was then changed from 4/19 to 7/16 before documentation. Its first run failed with four actual implemented IDs versus the expected seven; the P02-02 ownership subtest remained green.

All fixtures were local. No external RPC or Golden recapture was used.
