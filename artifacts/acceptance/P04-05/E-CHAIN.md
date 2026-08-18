# P04-05 Chain Evidence

All server chain reads use `ControlledWalletReadProviderRegistry`; the browser custom RPC URL is not an input to this registry or any server route. The local provider fixture implements only block number, native balance, code, read-only call, and USD-price lookup. Provider chain ID must exactly match the requested allowed chain.

Custom ERC-20 inspection requires non-empty contract code and decodable bounded responses for `name()`, `symbol()`, and `decimals()`. Balance reads use `balanceOf(address)`. The tests reject EOA addresses, malformed hex/ABI, invalid metadata, provider errors, cross-chain providers, duplicate imports, and stored/live metadata conflicts.

The receive model emits canonical EIP-681 content for native assets and `transfer?address=...&uint256=...` for ERC-20 assets. Decimal input is converted exactly to base units and values with excess fractional precision are rejected.

Browser RPC testing used only the injected `https://rpc.fixture` Playwright route. Requests originated from an `about:srcdoc` iframe with opaque `Origin: null`; no public network provider was contacted. The server balances test used only an injected local provider. External/public RPC calls observed: 0.

Transaction signing: 0. Account access: 0. Raw transaction generation: 0. Transaction send/broadcast: 0. Subscription calls: 0. Batch calls: 0.
