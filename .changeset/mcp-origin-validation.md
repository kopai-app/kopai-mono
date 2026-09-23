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
