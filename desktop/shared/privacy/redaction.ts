const SECRET_PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /sk-[A-Za-z0-9_-]{4,}/gi,
  /api[_-]?key["'=:\s]+[A-Za-z0-9._-]+/gi,
  /token["'=:\s]+[A-Za-z0-9._-]+/gi,
  /(https?:\/\/[^\s?]+)\?[^ \n]*?(sig|signature|token|key)=[^ \n]+/gi,
  /proxy:\/\/[^@\s]+@[^\s]+/gi
];

export function redactSecretText(input: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), input);
}

export function containsSecret(input: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}
