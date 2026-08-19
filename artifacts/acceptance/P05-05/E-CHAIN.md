# P05-05 E-CHAIN

`tests/integration/anvil-helper-deployment.integration.ts` executes the real closure against a fresh, non-forked Anvil chainId 31337 and PostgreSQL. It deploys only synthetic ERC-20, WBNB, Permit2, Router, position-manager, and adapter fixtures, then drives API service -> PostgreSQL/Outbox -> Worker -> loopback HTTP Signer -> isolated custody key -> raw broadcast -> receipt observer -> active binding.

The successful wallet reserves nonce 6 after the six fixture deployments. Its Helper transaction is proven to have `to=null`, `value=0`, and input exactly equal to the server plan init code. A newly constructed Worker instance observes the receipt after the broadcast Worker exits. Closure verifies the receipt contract address, runtime hash, `owner()`, `adapter()`, `permit2()`, and active wallet binding.

The failure path removes adapter code only after final Signer verification and before raw broadcast, causing CREATE to revert atomically. The expected Helper address has no code, the operation becomes failed with `HELPER_DEPLOYMENT_REVERTED`, the binding becomes degraded, confirmed nonce is 0, and a clean nonce 1 retry can be queued. No public RPC, forked chain, testnet, production, or real asset is used.

Local Helper deployment signatures: 2. Local Helper broadcasts: 2. Successful Helper deployments: 1. Deliberate Helper deployment reverts: 1. Testnet signatures/broadcasts: 0/0. Production signatures/broadcasts: 0/0. Real-fund operations: 0.
