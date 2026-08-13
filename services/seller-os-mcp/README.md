# Seller OS dedicated HTTPS MCP service

This route-only Next.js service is the deployment boundary for the private
Seller OS MCP resource. It imports the canonical OAuth verifier, MCP server,
Assistant Gateway, System Review Bundle, and listing-intelligence read models
from the repository root. It does not contain an admin application or a
second commercial-intelligence implementation.

## Network and authorization boundary

The canonical MCP resource path is:

`/api/seller-os/assistant/mcp`

The service is intentionally safe before activation:

- the MCP route returns a fail-closed service response until
  `SELLER_OS_MCP_DEPLOYMENT_MODE` is exactly
  `DEDICATED_HTTPS_OAUTH_READ_ONLY`;
- `SELLER_OS_MCP_OAUTH_ISSUER` and `SELLER_OS_MCP_OAUTH_RESOURCE` must be
  valid server-only HTTPS values;
- the configured resource path must exactly match the canonical MCP path;
- every MCP request is authenticated before protocol negotiation;
- only `seller_os.read` is accepted, and machine-only tokens are rejected;
- the only other routes are the root and path-specific RFC 9728 Protected
  Resource Metadata documents.

The final resource URI cannot be chosen until the dedicated production host
is assigned. Once assigned, it is exactly:

`https://<dedicated-host>/api/seller-os/assistant/mcp`

That full URI, including its path, is both
`SELLER_OS_MCP_OAUTH_RESOURCE` and the immutable Auth0 API Identifier.

## External activation boundary

Activation is deliberately not performed by this repository change. A human
must create a separate Vercel project rooted at `services/seller-os-mcp`, keep
the existing Seller OS project unchanged, enable the documented monorepo
setting that includes source files outside the project root, assign the final
stable production hostname, and configure only server-side runtime values.

Auth0 must then be configured with:

- API name `IMNOVA Seller OS MCP`;
- Identifier equal to the exact canonical MCP resource URI above;
- RS256 signing;
- Resource Parameter Compatibility Profile enabled;
- scope `seller_os.read` only;
- user access restricted to the approved ChatGPT client registration;
- machine-to-machine access set to `No apps allowed`;
- PKCE S256 and authorization-code flow through Auth0 discovery;
- manual Client ID Metadata Document registration for ChatGPT when available,
  rather than open Dynamic Client Registration.

The dedicated project also needs the existing server-side read configuration
used by the canonical Assistant Gateway. No value belongs in this document,
client code, logs, MCP responses, or version control.

Before Production activation, the read-model credential boundary must also be
reviewed explicitly. This code does not copy or create credentials. A narrowly
scoped read-only data binding is preferred; any reuse of a broader existing
server credential requires separate human approval and must not add a mutation
tool or mutation code path to this service.

The previously created Secure MCP Tunnel remains an alternative/fallback path.
This service does not create a tunnel runtime key and does not start a tunnel.
