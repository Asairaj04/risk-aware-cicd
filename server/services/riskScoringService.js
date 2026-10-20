
function calculateRiskScore(pullRequest, files = []) {
    let score = 10;
  
    const factors = [
      {
        factor: "Baseline",
        impact: 10,
        reason: "Every pull request starts with a baseline score of 10.",
      },
    ];
  
    // Factor 1: Number of changed files.
    const fileCount = Number(pullRequest.changed_files_count);
  
    if (Number.isFinite(fileCount) && fileCount >= 0) {
      let impact = 0;
  
      if (fileCount >= 20) impact = 20;
      else if (fileCount >= 11) impact = 15;
      else if (fileCount >= 6) impact = 10;
      else if (fileCount >= 2) impact = 5;
  
      score += impact;
  
      factors.push({
        factor: "Changed file count",
        impact,
        reason: `${fileCount} file(s) reported as changed.`,
      });
    } else {
      factors.push({
        factor: "Changed file count",
        impact: 0,
        reason: "File-count information is unavailable.",
      });
    }
  
    // Factor 2: Total number of added and deleted lines.
    const additions =
      pullRequest.additions == null
        ? NaN
        : Number(pullRequest.additions);
  
    const deletions =
      pullRequest.deletions == null
        ? NaN
        : Number(pullRequest.deletions);
  
    if (
      Number.isFinite(additions) &&
      additions >= 0 &&
      Number.isFinite(deletions) &&
      deletions >= 0
    ) {
      const totalLines = additions + deletions;
      let impact = 0;
  
      if (totalLines >= 1000) impact = 15;
      else if (totalLines >= 301) impact = 10;
      else if (totalLines >= 101) impact = 5;
  
      score += impact;
  
      factors.push({
        factor: "Change size",
        impact,
        reason:
          `${additions} addition(s) and ${deletions} deletion(s), ` +
          `${totalLines} changed line(s) in total.`,
      });
    } else {
      factors.push({
        factor: "Change size",
        impact: 0,
        reason: "Addition/deletion counts are unavailable.",
      });
    }
  
    // Factor 3: Sensitive or critical files.
    const filenames = Array.isArray(files)
      ? files
          .map((file) => file.filename)
          .filter((filename) => typeof filename === "string")
      : [];
  
    const criticalPattern =
      /(^|\/)\.github\/workflows\/|(^|[/_.-])(auth|security|permissions?|middleware)([/_.-]|$)|(^|\/)\.env(?:\.|$)|(^|\/)config\/|(^|\/)migrations?\/|(^|\/)schema\.sql$/i;
  
    const criticalFiles = filenames.filter((filename) =>
      criticalPattern.test(filename)
    );
  
    if (criticalFiles.length > 0) {
      score += 25;
  
      factors.push({
        factor: "Critical files changed",
        impact: 25,
        reason:
          "Sensitive or critical file(s) changed: " +
          criticalFiles.slice(0, 5).join(", "),
      });
    } else if (filenames.length > 0) {
      factors.push({
        factor: "Critical files changed",
        impact: 0,
        reason:
          "No files matched the configured critical-file patterns.",
      });
    } else {
      factors.push({
        factor: "Critical files changed",
        impact: 0,
        reason:
          "File-level analysis is unavailable; changed-file records " +
          "have not been synchronized or no files were returned.",
      });
    }
  
    // Factor 4: Dependency and build configuration changes.
    const configurationPattern =
      /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle(?:\.kts)?|cargo\.toml|go\.mod|vite\.config\.[^/]+|webpack\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|dockerfile)$/i;
  
    const configurationFiles = filenames.filter((filename) =>
      configurationPattern.test(filename)
    );
  
    if (configurationFiles.length > 0) {
      score += 10;
  
      factors.push({
        factor: "Dependency/build configuration",
        impact: 10,
        reason:
          "Dependency or build configuration changed: " +
          configurationFiles.slice(0, 5).join(", "),
      });
    }
  
    // Ensure scores always remain between 0 and 100.
    score = Math.max(0, Math.min(100, score));
  
    let riskLevel = "low";
  
    if (score >= 60) {
      riskLevel = "high";
    } else if (score >= 30) {
      riskLevel = "medium";
    }
  
    return {
      score,
      riskLevel,
      analysisMethod: "rule-based-v1",
      failureProbability: null,
      factors,
      limitations: [
        "This is a heuristic score, not a failure probability.",
        "A high score does not prove that a bug exists.",
        "A low score does not guarantee that a change is safe.",
        "Historical failure rates are not included in this version.",
      ],
    };
  }
  
  module.exports = { calculateRiskScore };
  