# E-SEC

Production OKX egress defaults denied. When explicitly enabled, the connector can issue only `GET https://www.okx.com:443/api/v5/account/config`. The host, port, method, path, headers, and body are not caller inputs. DNS answers are pinned, every answer must pass public-address policy, IPv4-mapped IPv6 and transition ranges are rejected when non-public, redirects are denied, DNS and request work are bounded to 8 seconds, and response bodies are capped at 256 KiB and then zeroed.

Only credentials with `read=true`, `trade=false`, `withdraw=false`, and a positive IP-allowlist policy result activate. Trade or withdraw access is rejected. Unknown permissions become `unknown` and cannot activate. Injected fixtures cover DNS rebinding, private and mapped addresses, redirects, timeouts, status codes, oversized bodies, authentication failure, and permission combinations without relaxing production policy.

Credential secret bytes do not enter logs, queues, audit, telemetry, errors, screenshots, or test reports. Audit columns contain only action, actor, changed, request ID, user ID, version, status, and time. KMS and provider request/response buffers are cleared after use. Full-history Gitleaks and dependency audit results are recorded in `command-output.md`.

Real OKX requests: 0. `GAP-P04-OKX-LIVE`, production KMS/IAM, independent security review, and real read-only sandbox validation remain unresolved.
