# Combined Review: Security and Error Handling

Review the changed code for both security vulnerabilities and error-handling gaps. Report every issue you find across both areas.

---

## 1. Security

Review for security vulnerabilities that could be exploited or expose sensitive data.

### Reasoning Format

For each security issue, structure your analysis as a taint-flow trace:

1. **Source** — identify the untrusted input (user input, HTTP request, query parameter, environment variable, external API response, file contents, deserialized data)
2. **Flow** — trace the data path from source through the changed code to where it is consumed
3. **Sink** — show where the untrusted data reaches a dangerous operation without adequate sanitization or validation, and describe the exploit scenario

### Categories

- **Injection** — SQL injection, command injection, path traversal, XSS, template injection, LDAP injection, header injection
- **Authentication and authorization** — missing or bypassable auth checks, privilege escalation, insecure session management, broken access control
- **Secrets and credential exposure** — hardcoded secrets, credentials in logs, tokens in URLs, sensitive data in error messages, unprotected API keys
- **Input validation** — missing or insufficient validation of user-controlled data, type confusion, integer overflow, buffer issues
- **Unsafe deserialization** — deserializing untrusted data without validation, prototype pollution, object injection
- **SSRF** — server-side request forgery through user-controlled URLs or hostnames, DNS rebinding

---

## 2. Error Handling

Review for error-handling gaps that could cause silent failures or make debugging harder in production.

### Reasoning Format

For each error handling issue, structure your analysis as a counterfactual:

1. **What can fail** — identify the operation that can fail (network call, file I/O, parse operation, database query, external service call, user input processing)
2. **What happens when it fails** — trace the error path through the changed code showing how the failure propagates (or doesn't)
3. **The gap** — show what is lost or hidden (swallowed error, lost stack trace, missing log entry, misleading fallback value, silent retry without observability)

### Categories

- **Swallowed errors** — empty catch blocks, catch-and-return-default without logging, ignored promise rejections, callbacks that discard error arguments
- **Lost error context** — re-throwing without cause chain, generic error messages that discard the original error, catch blocks that log only the message without the stack
- **Missing observability** — error paths with no logging or metrics, failures that propagate silently through return values, operations that can fail without any alerting path
- **Unsafe fallbacks** — fallback values that mask bugs rather than fail visibly (e.g., returning empty array on parse failure), retry logic without backoff or limits, default values that silently change behavior when the real value fails to load

---

## Do NOT Report

- Style, formatting, or naming preferences
- Missing documentation, comments, or type annotations
- Code quality issues (logic errors, performance, resource leaks) that are not security or error-handling related
- Error handling in test code
- Logging style preferences (e.g., log format, log level choice)
- Code not changed in this diff

## Guidelines

- **Threshold**: could this cause a security vulnerability, silent failure, or make debugging harder in production? When uncertain, report it.
- Explain **why** each issue matters with a concrete failure/exploit scenario
- Provide a **concrete fix** with corrected code
