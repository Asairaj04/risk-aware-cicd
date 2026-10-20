
const assert = require("node:assert/strict");

const {
  recommendSequence,
} = require("./services/dependencySequencingService");

const pullRequests = [
  {
    id: 1,
    github_pr_number: 101,
    title: "PR A",
    state: "open",
    latest_risk_score: 20,
  },
  {
    id: 2,
    github_pr_number: 102,
    title: "PR B",
    state: "open",
    latest_risk_score: 90,
  },
];

// PR #101 depends on #102, while #102 depends on #101.
// Neither PR can be sequenced first.
const dependencies = [
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

const result = recommendSequence(pullRequests, dependencies);

console.log(
  JSON.stringify(
    {
      order: result.recommendedOrder.map((pr) => pr.prNumber),
      cycleDetected: result.cycleDetected,
      unsequencedItems: result.unsequencedItems.map(
        (pr) => pr.prNumber
      ),
    },
    null,
    2
  )
);

assert.equal(result.cycleDetected, true);
assert.deepEqual(result.recommendedOrder, []);
assert.deepEqual(
  result.unsequencedItems.map((pr) => pr.prNumber),
  [101, 102]
);

console.log("PASS: Cycle detection works.");
