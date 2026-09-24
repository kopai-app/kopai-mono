---
"@kopai/mcp": minor
---

Add opt-in origin validation, via a new `allowedOriginHostnames` option.

Host validation alone does not stop a page that simply fetches
`http://127.0.0.1:<port>/mcp` — there the `Host` header genuinely is loopback,
and only `Origin` says who asked. That such a request fails today is
incidental: it needs a CORS preflight, `OPTIONS` is unrouted, and the local app
registers no CORS. Any one of those changing removes the protection.

It is opt-in rather than always-on because the two mounts have different threat
models. An unauthenticated local app has nothing but these headers between a
web page and the data, and there the host and origin lists genuinely coincide —
both are loopback. A deployed, authenticated mount has the credential as its
boundary and usually already runs a CORS policy; a second, independently
configured origin list there buys little and strands a future browser client
behind a validator nobody remembers configuring.

The option takes **hostnames**, deliberately not origins, and is named to say
so. The underlying validator compares hostnames port-agnostically: passing
`"https://app.example.com"` refuses that very origin, and passing `"*"` refuses
everything, both silently, since either is a valid `string[]`. Two tests pin
that trap. A request with no `Origin` passes by design, so non-browser clients
are unaffected.

A value that is not an array of strings is refused at registration rather than
mounted. `null` — what a config read from JSON or an env var yields where the
list is missing — used to count as configured, and the validator then called
`.includes` on it inside an `onRequest` hook. Measured: a request carrying an
`Origin` got `500 Cannot read properties of null (reading 'includes')`, while a
request without one passed, so the endpoint looked healthy to every MCP client
and was broken only for pages. A bare string was worse than broken:
`String.prototype.includes` matches substrings, so `"localhost"` would have
admitted an origin whose hostname is `"host"`. Both now throw at boot, naming
the option and saying how to ask for no validation.

An empty list stays mounted, and refuses every browser origin. It is a coherent
thing to ask for, it is the safe reading of an ambiguous config, and treating it
as "not configured" would drop a security control precisely when its list came
back empty — leaving the caller who set the option unprotected and unaware. The
option's documentation now says so, because non-browser clients pass either way,
which makes an accidental `[]` present as "works from my MCP client, broken from
every page".
