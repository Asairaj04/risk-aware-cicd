
function getRiskScore(pr) {
    const value = pr.latest_risk_score;
  
    if (value === null || value === undefined || value === "") {
      return null;
    }
  
    const score = Number(value);
  
    return Number.isFinite(score) ? score : null;
  }
  
  function getPrNumber(pr) {
    return Number(pr.github_pr_number);
  }
  
  function recommendSequence(pullRequests, dependencies) {
    // Only open pull requests are eligible for a new validation order.
    const openPRs = pullRequests.filter(
      (pr) => String(pr.state).toLowerCase() === "open"
    );
  
    const prById = new Map(
      openPRs.map((pr) => [String(pr.id), pr])
    );
  
    const blockedReasons = new Map();
    const edges = [];
  
    function block(prId, reason) {
      const key = String(prId);
  
      if (!blockedReasons.has(key)) {
        blockedReasons.set(key, new Set());
      }
  
      blockedReasons.get(key).add(reason);
    }
  
    // An edge represents:
    // prerequisite pull request -> dependent pull request
    for (const dependency of dependencies) {
      const prerequisiteId = String(
        dependency.prerequisite_pull_request_id
      );
  
      const dependentId = String(
        dependency.dependent_pull_request_id
      );
  
      // Ignore dependencies whose dependent is not an open PR.
      if (!prById.has(dependentId)) {
        continue;
      }
  
      const prerequisite = prById.get(prerequisiteId);
      const dependent = prById.get(dependentId);
  
      // A prerequisite that isn't currently open requires verification.
      // The current database model does not record whether a closed PR
      // was merged, so do not silently assume that the dependency is met.
      if (!prerequisite) {
        const prerequisiteNumber =
          dependency.prerequisite_pr_number ??
          prerequisiteId;
  
        block(
          dependentId,
          `Prerequisite PR #${prerequisiteNumber} is not currently open. Verify whether it was merged or closed before proceeding.`
        );
  
        continue;
      }
  
      edges.push({
        from: prerequisiteId,
        to: dependentId,
      });
    }
  
    // Propagate blocking: a PR is also blocked when one of its
    // prerequisites is blocked.
    let changed = true;
  
    while (changed) {
      changed = false;
  
      for (const edge of edges) {
        if (
          blockedReasons.has(edge.from) &&
          !blockedReasons.has(edge.to)
        ) {
          const prerequisite = prById.get(edge.from);
          const dependent = prById.get(edge.to);
  
          block(
            edge.to,
            `Prerequisite PR #${getPrNumber(prerequisite)} is itself blocked by an unresolved dependency.`
          );
  
          changed = true;
        }
      }
    }
  
    const blockedItems = openPRs
      .filter((pr) => blockedReasons.has(String(pr.id)))
      .map((pr) => ({
        prNumber: getPrNumber(pr),
        title: pr.title,
        reasons: [...blockedReasons.get(String(pr.id))],
      }));
  
    const activePRs = openPRs.filter(
      (pr) => !blockedReasons.has(String(pr.id))
    );
  
    const activeIds = new Set(
      activePRs.map((pr) => String(pr.id))
    );
  
    const inDegree = new Map();
    const outgoing = new Map();
  
    for (const pr of activePRs) {
      const id = String(pr.id);
  
      inDegree.set(id, 0);
      outgoing.set(id, []);
    }
  
    // Build the graph using only eligible pull requests.
    for (const edge of edges) {
      if (
        activeIds.has(edge.from) &&
        activeIds.has(edge.to)
      ) {
        outgoing.get(edge.from).push(edge.to);
  
        inDegree.set(
          edge.to,
          inDegree.get(edge.to) + 1
        );
      }
    }
  
    function compareReadyPRs(a, b) {
      const aScore = getRiskScore(a);
      const bScore = getRiskScore(b);
  
      // Prefer scored PRs over PRs with no saved analysis.
      if (aScore === null && bScore !== null) return 1;
      if (bScore === null && aScore !== null) return -1;
  
      // Higher risk first among currently eligible pull requests.
      if (aScore !== null && bScore !== null) {
        if (aScore !== bScore) {
          return bScore - aScore;
        }
      }
  
      // Deterministic tie-breaker.
      return getPrNumber(a) - getPrNumber(b);
    }
  
    // Kahn's topological sorting algorithm.
    const ready = activePRs.filter(
      (pr) => inDegree.get(String(pr.id)) === 0
    );
  
    const recommendedOrder = [];
    const processedIds = new Set();
  
    while (ready.length > 0) {
      ready.sort(compareReadyPRs);
  
      const current = ready.shift();
      const currentId = String(current.id);
  
      const prerequisiteNumbers = edges
        .filter((edge) => edge.to === currentId)
        .map((edge) => prById.get(edge.from))
        .filter(Boolean)
        .map(getPrNumber)
        .sort((a, b) => a - b);
  
      const score = getRiskScore(current);
  
      let rationale;
  
      if (score === null) {
        rationale =
          "All prerequisites are satisfied. No saved risk score is available, so scored eligible PRs are preferred; PR number breaks ties.";
      } else {
        rationale =
          "All prerequisites are satisfied. Selected by highest saved risk score among currently eligible PRs; PR number breaks ties.";
      }
  
      recommendedOrder.push({
        prNumber: getPrNumber(current),
        title: current.title,
        riskScore: score,
        riskLevel: current.latest_risk_level ?? null,
        dependsOn: prerequisiteNumbers,
        rationale,
      });
  
      processedIds.add(currentId);
  
      for (const nextId of outgoing.get(currentId)) {
        inDegree.set(nextId, inDegree.get(nextId) - 1);
  
        if (inDegree.get(nextId) === 0) {
          ready.push(prById.get(nextId));
        }
      }
    }
  
    // Kahn's algorithm processes every eligible node unless a cycle
    // exists. Remaining nodes may include cycle members and downstream PRs.
    const cycleDetected =
      recommendedOrder.length < activePRs.length;
  
    const unsequencedItems = cycleDetected
      ? activePRs
          .filter((pr) => !processedIds.has(String(pr.id)))
          .map((pr) => ({
            prNumber: getPrNumber(pr),
            title: pr.title,
            reason:
              "Could not be sequenced because of a dependency cycle or an item affected by that cycle.",
          }))
      : [];
  
    return {
      recommendedOrder,
      blockedItems,
      cycleDetected,
      unsequencedItems,
      message: cycleDetected
        ? "A dependency cycle was detected. Resolve the cycle before using a complete recommended order."
        : "Recommended order calculated successfully.",
    };
  }
  
  module.exports = { recommendSequence };
  