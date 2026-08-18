# Initial Failure

The first API boundary run returned 500 for an 8,193-byte secret body. Fastify's body-limit error is now mapped before connector invocation to a no-store 413 response.

The first Playwright run had six failures from non-exact locators and a synthetic copy event that did not bubble through React. Locators now bind exact credential labels and the clipboard assertion dispatches the bubbling event used by the control; the final desktop/mobile run passed 6/6.

The closure audit added failing regression cases for four uncovered boundaries: abandoned `testing` recovery, revocation during an in-flight test, IPv4-mapped IPv6 private addresses, and KMS request-buffer clearing. The connector now advances capability epochs on every status transition, recovers `testing` to `unknown`, classifies mapped/special IPv6 with `ipaddr.js`, and clears serialized KMS bodies. A further timeout test showed the socket-only timer did not cover DNS; the final implementation enforces the eight-second bound across both phases.
