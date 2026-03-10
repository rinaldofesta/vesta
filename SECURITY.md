# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Vesta, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **rinaldo@cosmico.dev** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, but we aim for prompt resolution

## Scope

Since Vesta runs entirely on-device with no network communication, the attack surface is limited to:

- Local data storage (SQLite database, model files)
- Native module interfaces (Kotlin bridge)
- Input handling (prompt injection via chat input)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x (current) | Yes |

## Recognition

We appreciate responsible disclosure and will credit security researchers in our release notes (with your permission).
