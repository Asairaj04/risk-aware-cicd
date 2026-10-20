
const assert = require("node:assert/strict");

const {
  recommendSequence,
} = require("./services/dependencySequencingService");

// Test 1: A prerequisite must appear before its dependent PR.
const pullRequests = [
  {
    id: 1,
    github_pr_number: 101,
    title: "Prerequisite",
    state: "open",
    latest_risk_score: 20,
    latest_risk_level: "low",
  },
  {
    id: 2,
    github_pr_number: 102,
    title: "High-risk dependent",
    state: "open",
    latest_risk_score: 90,
    latest_risk_level: "high",
  },
];

const dependencies = [
  {
    prerequisite_pull_request_id: 1,
    dependent_pull_request_id: 2,
    prerequisite_pr_number: 101,
  },
];

const result = recommendSequence(pullRequests, dependencies);

assert.deepEqual(
  result.recommendedOrder.map((pr) => pr.prNumber),
  [101, 102]
);

assert.equal(result.cycleDetected, false);

console.log("PASS: Prerequisite ordering");

// Test 2: A circular dependency must be detected.
const circularDependencies = [
  {
    prerequisite_pull_request_id: 1,
    dependent_pull_request_id: 2,
    prerequisite_pr_number: 101,
  },
  {
    prerequisite_pull_request_id: 2,
    dependent_pull_request_id: 1,
    prerequisite_pr_number: 102,
  },
];

const cycleResult = recommendSequence(
  pullRequests,
  circularDependencies
);

assert.equal(cycleResult.cycleDetected, true);

assert.deepEqual(
  cycleResult.unsequencedItems.map((pr) => pr.prNumber),
  [101, 102]
);

console.log("PASS: Circular dependency detection");
console.log("All sequencing tests passed.");
