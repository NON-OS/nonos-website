# NØNOS Documentation Website

Static documentation site for nonos.software.

## Stack

- **Generator**: Hugo (single Go binary, no Node.js)
- **Styling**: Pure CSS (no frameworks)
- **JavaScript**: None
- **Build**: Make + shell scripts
- **Server**: Nginx (hardened)
- **Privacy**: hidden service

## Security

- No external resources (fonts, scripts, analytics)
- TLS 1.3 only
- HSTS preload enabled
- Strict CSP headers
- Tor hidden service mirror

## License

AGPL-3.0
