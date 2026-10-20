
const MAX_LOG_CHARS = 12000;

// Remove common secret formats and keep only a small log excerpt.
function sanitizeLog(rawLog) {
  return String(rawLog || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]"
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(
      /(authorization\s*:\s*bearer)\s+\S+/gi,
      "$1 [REDACTED]"
    )
    .replace(
      /\b(password|passwd|token|secret|api[_-]?key)\b(\s*[:=]\s*)["']?[^\s"'&,;]+/gi,
      "$1$2[REDACTED]"
    )
    .replace(
      /(https?:\/\/[^:\s/@]+:)[^@\s/]+@/gi,
      "$1[REDACTED]@"
    )
    .slice(-MAX_LOG_CHARS);
}

const rules = [
  {
    category: "missing_dependency",
    pattern:
      /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|No module named|Cannot resolve module|Can't resolve/i,
    explanation:
      "The log suggests that a required module or package could not be located.",
    recommendedAction:
      "Check imports, package.json, the lockfile, and whether dependency installation completed successfully.",
  },
  {
    category: "dependency_installation",
    pattern:
      /ERESOLVE|unable to resolve dependency tree|No matching distribution found|Could not find a version that satisfies the requirement|npm ci.*(?:error|failed)|npm install.*(?:error|failed)|pip install.*(?:error|failed)/i,
    explanation:
      "The log suggests a dependency-resolution or package-installation problem.",
    recommendedAction:
      "Review the package manager's complete error output, compatible package versions, and lockfile consistency.",
  },
  {
    category: "syntax_or_compilation",
    pattern:
      /SyntaxError|Unexpected token|TS\d{4}:|Compilation failed|CompileError|Parsing error:|build failed with errors/i,
    explanation:
      "The log contains a syntax, parsing, or compilation error.",
    recommendedAction:
      "Inspect the indicated file and line, then rerun the build or compiler after correcting the issue.",
  },
  {
    category: "test_failure",
    pattern:
      /AssertionError|Test Suites?:.*\bfailed\b|Tests?:\s*\d+\s+failed|^\s*FAIL\s+.*\.(?:test|spec)\.|Assertion failed|Expected .{0,150}\b(?:to equal|to be|to contain)\b/i,
    explanation:
      "The log contains evidence of a failed test or assertion.",
    recommendedAction:
      "Review the failing test, its expected and actual values, and any recent code changes affecting that behavior.",
  },
  {
    category: "environment_configuration",
    pattern:
      /missing required environment variable|environment variable.{0,80}(?:not set|missing|undefined)|(?:not set|missing|undefined).{0,80}environment variable|process\.env\.[A-Z0-9_]+.{0,80}undefined|secret .{0,60}not found/i,
    explanation:
      "The log suggests that required environment configuration or a secret may be unavailable.",
    recommendedAction:
      "Check required variable names and configure the necessary values in the appropriate GitHub Actions settings. Never print secret values into logs.",
  },
  {
    category: "permission_error",
    pattern:
      /EACCES|EPERM|Permission denied|Resource not accessible by integration|403 Forbidden|not authorized to perform|access denied/i,
    explanation:
      "The log suggests an access-control or file-permission problem.",
    recommendedAction:
      "Check the file permissions and the minimum permissions required by the workflow or integration.",
  },
  {
    category: "timeout",
    pattern:
      /ETIMEDOUT|TimeoutError|timed out|execution timed out|deadline exceeded|maximum execution time/i,
    explanation:
      "The log indicates that an operation may have exceeded its time limit.",
    recommendedAction:
      "Identify the operation that stalled and investigate its duration, dependency services, network calls, or configured timeout.",
  },
  {
    category: "network_or_resource_error",
    pattern:
      /ECONNREFUSED|ENOTFOUND|getaddrinfo|ECONNRESET|network is unreachable|fetch failed|ECONNABORTED/i,
    explanation:
      "The log suggests a network, connection, or remote-service problem.",
    recommendedAction:
      "Check the target service, endpoint, DNS resolution, connectivity, and availability before rerunning the workflow.",
  },
];

function diagnoseLog(logText) {
  const text = String(logText || "");

  if (!text.trim()) {
    return {
      category: "insufficient_evidence",
      confidence: "low",
      evidence: null,
      explanation: "No usable log output is available for diagnosis.",
      recommendedAction:
        "Check whether GitHub logs are accessible and inspect the workflow run manually.",
    };
  }

  const lines = text.split(/\r?\n/);

  for (const rule of rules) {
    const matchedLine = lines.find((line) =>
      rule.pattern.test(line)
    );

    if (matchedLine) {
      return {
        category: rule.category,
        confidence: "medium",
        evidence: matchedLine.trim().slice(0, 400),
        explanation: rule.explanation,
        recommendedAction: rule.recommendedAction,
      };
    }
  }

  return {
    category: "insufficient_evidence",
    confidence: "low",
    evidence: null,
    explanation:
      "No supported diagnostic pattern was found in the available log excerpt.",
    recommendedAction:
      "Review the complete workflow and nearby log lines. Do not assume the cause or treat this result as proof that the build is healthy.",
  };
}

module.exports = {
  sanitizeLog,
  diagnoseLog,
};
