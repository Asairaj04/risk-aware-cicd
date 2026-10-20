import { useCallback, useEffect, useState } from "react";
import api from "../api/api";

/*
 * Handle different response formats returned by the API.
 */
function getArray(data, keys = []) {
  const sources = [data, data?.data];

  for (const source of sources) {
    if (Array.isArray(source)) {
      return source;
    }

    for (const key of keys) {
      if (Array.isArray(source?.[key])) {
        return source[key];
      }
    }
  }

  return [];
}

/*
 * Find the GitHub PR number without confusing it with
 * the local MySQL pull_requests.id.
 */
function getPullRequestNumber(pr) {
  const possibleKeys = [
    "github_pr_number",
    "githubPrNumber",
    "pr_number",
    "prNumber",
    "pull_request_number",
    "pullRequestNumber",
    "number",
  ];

  for (const key of possibleKeys) {
    const value = pr?.[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== "" &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) > 0
    ) {
      return Number(value);
    }
  }

  // Also handle APIs that use another PR-number field name.
  if (pr && typeof pr === "object") {
    const matchingKey = Object.keys(pr).find((key) => {
      const value = pr[key];

      return (
        /(^number$|pr.*number|number.*pr)/i.test(key) &&
        value !== undefined &&
        value !== null &&
        String(value).trim() !== "" &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) > 0
      );
    });

    if (matchingKey) {
      return Number(pr[matchingKey]);
    }
  }

  // Do not fall back to pr.id: it is usually a local database ID.
  return null;
}

function normalizePullRequest(pr) {
  const number = getPullRequestNumber(pr);

  return {
    number,
    title:
      pr.title ??
      pr.pull_request_title ??
      pr.pullRequestTitle ??
      "Untitled pull request",
  };
}

function getDependencyId(dependency) {
  return (
    dependency.dependency_id ??
    dependency.dependencyId ??
    dependency.id
  );
}

function getErrorMessage(error, fallback) {
  return (
    error.response?.data?.message ||
    error.message ||
    fallback
  );
}

export default function DependencyManagement() {
  const [repositories, setRepositories] = useState([]);
  const [repositoryId, setRepositoryId] = useState("");

  const [pullRequests, setPullRequests] = useState([]);
  const [dependencies, setDependencies] = useState([]);

  const [prerequisiteNumber, setPrerequisiteNumber] = useState("");
  const [dependentNumber, setDependentNumber] = useState("");

  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /*
   * Load repositories available to the logged-in user.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadRepositories() {
      setLoadingRepositories(true);
      setError("");

      try {
        const response = await api.get("/api/repositories");

        const list = getArray(response.data, [
          "repositories",
          "repos",
        ]);

        if (cancelled) return;

        setRepositories(list);

        setRepositoryId((currentId) => {
          const stillExists = list.some(
            (repo) => String(repo.id) === String(currentId)
          );

          if (stillExists) return currentId;

          return list.length ? String(list[0].id) : "";
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            getErrorMessage(
              err,
              "Could not load repositories."
            )
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRepositories(false);
        }
      }
    }

    loadRepositories();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Load pull requests and saved dependencies for the selected repo.
   */
  const loadRepositoryData = useCallback(async () => {
    if (!repositoryId) {
      setPullRequests([]);
      setDependencies([]);
      setPrerequisiteNumber("");
      setDependentNumber("");
      return;
    }

    setLoadingData(true);
    setError("");
    setNotice("");

    try {
      const [prResponse, dependencyResponse] = await Promise.all([
        api.get(
          `/api/repositories/${repositoryId}/pull-requests?state=all`
        ),
        api.get(
          `/api/repositories/${repositoryId}/dependencies`
        ),
      ]);

      const rawPullRequests = getArray(prResponse.data, [
        "pullRequests",
        "pull_requests",
        "items",
      ]);

      const normalizedPRs = rawPullRequests
        .map(normalizePullRequest)
        .filter(
          (pr) =>
            Number.isSafeInteger(pr.number) &&
            pr.number > 0
        );

      const savedDependencies = getArray(
        dependencyResponse.data,
        ["dependencies", "items"]
      );

      setPullRequests(normalizedPRs);
      setDependencies(savedDependencies);
      setPrerequisiteNumber("");
      setDependentNumber("");

      if (
        rawPullRequests.length > 0 &&
        normalizedPRs.length === 0
      ) {
        const fields = Object.keys(rawPullRequests[0]).join(", ");

        setError(
          "The pull-request API returned records but no recognized " +
            `GitHub PR number. Returned fields: ${fields || "none"}.`
        );
      }
    } catch (err) {
      setPullRequests([]);
      setDependencies([]);

      setError(
        getErrorMessage(
          err,
          "Could not load pull requests or dependencies."
        )
      );
    } finally {
      setLoadingData(false);
    }
  }, [repositoryId]);

  useEffect(() => {
    loadRepositoryData();
  }, [loadRepositoryData]);

  /*
   * Create a prerequisite relationship.
   * These values must be GitHub PR numbers, not MySQL row IDs.
   */
  async function handleAddDependency(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const repoId = Number(repositoryId);
    const prerequisite = Number(prerequisiteNumber);
    const dependent = Number(dependentNumber);

    if (!Number.isSafeInteger(repoId) || repoId <= 0) {
      setError("Please select a valid repository.");
      return;
    }

    if (
      !Number.isSafeInteger(prerequisite) ||
      prerequisite <= 0 ||
      !Number.isSafeInteger(dependent) ||
      dependent <= 0
    ) {
      setError(
        "Select two valid pull requests with actual GitHub PR numbers."
      );
      return;
    }

    if (prerequisite === dependent) {
      setError(
        "The prerequisite and dependent pull requests must be different."
      );
      return;
    }

    setSaving(true);

    try {
      await api.post(
        `/api/repositories/${repoId}/dependencies`,
        {
          prerequisitePrNumber: prerequisite,
          dependentPrNumber: dependent,
          source: "manual",
        }
      );

      setNotice(
        `Dependency saved: PR #${prerequisite} must come before PR #${dependent}.`
      );

      setPrerequisiteNumber("");
      setDependentNumber("");

      await loadRepositoryData();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not create the dependency."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * Remove an existing relationship.
   */
  async function handleDeleteDependency(dependency) {
    const dependencyId = getDependencyId(dependency);

    if (
      dependencyId === undefined ||
      dependencyId === null
    ) {
      setError("The dependency record has no valid ID.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to remove this dependency?"
    );

    if (!confirmed) return;

    setError("");
    setNotice("");
    setDeletingId(dependencyId);

    try {
      await api.delete(
        `/api/repositories/${repositoryId}/dependencies/${dependencyId}`
      );

      setNotice("Dependency removed successfully.");

      await loadRepositoryData();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not remove the dependency."
        )
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="dependency-page">
      <header className="dependency-heading">
        <div>
          <p className="dependency-eyebrow">
            RISK-AWARE CI/CD
          </p>

          <h1>Dependency Management</h1>

          <p>
            Define which pull requests must be completed before others.
          </p>
        </div>

        <button
          type="button"
          className="dependency-refresh"
          onClick={loadRepositoryData}
          disabled={!repositoryId || loadingData}
        >
          {loadingData ? "Loading..." : "Refresh"}
        </button>
      </header>

      <section className="dependency-panel">
        <label htmlFor="dependency-repository">
          Select repository
        </label>

        <select
          id="dependency-repository"
          value={repositoryId}
          onChange={(event) =>
            setRepositoryId(event.target.value)
          }
          disabled={
            loadingRepositories || repositories.length === 0
          }
        >
          {repositories.length === 0 && (
            <option value="">
              No repositories available
            </option>
          )}

          {repositories.map((repo) => (
            <option key={repo.id} value={String(repo.id)}>
              {repo.owner}/{repo.repository_name}
            </option>
          ))}
        </select>
      </section>

      {error && (
        <div
          className="dependency-alert dependency-alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="dependency-alert dependency-alert-success"
          role="status"
        >
          {notice}
        </div>
      )}

      <section className="dependency-panel">
        <h2>Add a dependency</h2>

        <p className="dependency-muted">
          If PR A is a prerequisite for PR B, PR A should come first
          in the recommended order.
        </p>

        <form onSubmit={handleAddDependency}>
          <div className="dependency-form-grid">
            <div>
              <label htmlFor="dependency-prerequisite">
                Prerequisite pull request
              </label>

              <select
                id="dependency-prerequisite"
                value={prerequisiteNumber}
                onChange={(event) => {
                  setPrerequisiteNumber(event.target.value);

                  if (
                    event.target.value === dependentNumber
                  ) {
                    setDependentNumber("");
                  }
                }}
                disabled={loadingData || !pullRequests.length}
                required
              >
                <option value="">
                  Select prerequisite
                </option>

                {pullRequests.map((pr) => (
                  <option
                    key={pr.number}
                    value={String(pr.number)}
                  >
                    #{pr.number} — {pr.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dependency-dependent">
                Dependent pull request
              </label>

              <select
                id="dependency-dependent"
                value={dependentNumber}
                onChange={(event) =>
                  setDependentNumber(event.target.value)
                }
                disabled={loadingData || !pullRequests.length}
                required
              >
                <option value="">
                  Select dependent pull request
                </option>

                {pullRequests.map((pr) => (
                  <option
                    key={pr.number}
                    value={String(pr.number)}
                    disabled={
                      String(pr.number) === prerequisiteNumber
                    }
                  >
                    #{pr.number} — {pr.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="dependency-primary"
            type="submit"
            disabled={
              saving ||
              loadingData ||
              !repositoryId ||
              !prerequisiteNumber ||
              !dependentNumber
            }
          >
            {saving ? "Saving..." : "Add dependency"}
          </button>
        </form>

        {!loadingRepositories &&
          !loadingData &&
          repositories.length === 0 && (
            <p className="dependency-muted">
              Connect a GitHub repository before adding dependencies.
            </p>
          )}

        {!loadingData &&
          repositoryId &&
          pullRequests.length === 0 && (
            <p className="dependency-muted">
              No usable pull requests were found. Sync pull requests
              on the Pull Requests page, then refresh this page.
            </p>
          )}
      </section>

      <section className="dependency-panel">
        <div className="dependency-list-heading">
          <h2>Saved dependencies</h2>
          <span>{dependencies.length} total</span>
        </div>

        {loadingRepositories || loadingData ? (
          <p className="dependency-muted">
            Loading dependency data...
          </p>
        ) : dependencies.length === 0 ? (
          <div className="dependency-empty">
            <h3>No dependencies yet</h3>
            <p>
              Create a relationship above to define the order of
              two pull requests.
            </p>
          </div>
        ) : (
          <div className="dependency-list">
            {dependencies.map((dependency) => {
              const id = getDependencyId(dependency);

              const prerequisitePR =
                dependency.prerequisite_pr_number ??
                dependency.prerequisitePrNumber ??
                dependency.prerequisite_pr_number;

              const dependentPR =
                dependency.dependent_pr_number ??
                dependency.dependentPrNumber;

              const prerequisiteTitle =
                dependency.prerequisite_title ??
                dependency.prerequisiteTitle ??
                "Untitled pull request";

              const dependentTitle =
                dependency.dependent_title ??
                dependency.dependentTitle ??
                "Untitled pull request";

              return (
                <article
                  className="dependency-item"
                  key={id}
                >
                  <div className="dependency-relation">
                    <div className="dependency-pr">
                      <span>Prerequisite PR #{prerequisitePR ?? "?"}</span>
                      <strong>{prerequisiteTitle}</strong>
                    </div>

                    <div className="dependency-arrow">
                      <span>Must come before</span>
                      <span aria-hidden="true">→</span>
                    </div>

                    <div className="dependency-pr">
                      <span>Dependent PR #{dependentPR ?? "?"}</span>
                      <strong>{dependentTitle}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="dependency-delete"
                    onClick={() =>
                      handleDeleteDependency(dependency)
                    }
                    disabled={deletingId === id}
                  >
                    {deletingId === id
                      ? "Removing..."
                      : "Remove"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}