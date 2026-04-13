# Security Review

Review the changed code for security vulnerabilities that could be exploited or expose sensitive data.

## Reasoning Format

For each issue you find, structure your analysis as a taint-flow trace:

1. **Source** — identify the untrusted input (user input, HTTP request, query parameter, environment variable, external API response, file contents, deserialized data)
2. **Flow** — trace the data path from source through the changed code to where it is consumed
3. **Sink** — show where the untrusted data reaches a dangerous operation without adequate sanitization or validation, and describe the exploit scenario

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Injection** — SQL injection, command injection, path traversal, XSS, template injection, LDAP injection, header injection
- **Authentication and authorization** — missing or bypassable auth checks, privilege escalation, insecure session management, broken access control
- **Secrets and credential exposure** — hardcoded secrets, credentials in logs, tokens in URLs, sensitive data in error messages, unprotected API keys
- **Input validation** — missing or insufficient validation of user-controlled data, type confusion, integer overflow, buffer issues
- **Unsafe deserialization** — deserializing untrusted data without validation, prototype pollution, object injection
- **SSRF** — server-side request forgery through user-controlled URLs or hostnames, DNS rebinding

## Do NOT Report

- Style preferences for security patterns (e.g., preferring one crypto library over another when both are safe)
- Code not changed in this diff

## Guidelines

- **Threshold**: could an attacker exploit this with a realistic attack vector? Only report issues where you can describe a concrete exploit scenario using inputs the attacker actually controls. Do not report theoretical vulnerabilities that require multiple simultaneous faults or access the attacker would not plausibly have.
- Explain **why** each issue matters with a concrete exploit scenario
- Provide a **concrete fix** with corrected code
