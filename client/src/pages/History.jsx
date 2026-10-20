import { useEffect, useMemo, useState } from "react";
import api from "../api/api";

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString();
}

function formatFactors(value) {
  if (!value) return [];

  let parsed = value;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [parsed];
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item) =>
      typeof item === "string"
        ? item
        : JSON.stringify(item)
    );
  }

  if (typeof parsed === "object") {
    return Object.entries(parsed).map(
      ([key, item]) => `${key}: ${
        Array.isArray(item) ? item.join(", ") : item
      }`
    );
  }

  return [String(parsed)];
}

function History() {
  const [repositories, setRepositories] = useState([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [history, setHistory] = useState([]);

  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [repositoryError, setRepositoryError] = useState("");
  const [historyError, setHistoryError] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  // Load repositories belonging to the logged-in user
  useEffect(() => {
    let active = true;

    async function loadRepositories() {
      setLoadingRepositories(true);
      setRepositoryError("");

      try {
        const response = await api.get("/api/repositories");
        const list = response.data?.repositories;

        if (!Array.isArray(list)) {
          throw new Error("Unexpected repository response");
        }

        if (!active) return;

        setRepositories(list);

        if (list.length > 0) {
          setSelectedRepositoryId((currentId) => {
            const existing = list.some(
              (repository) =>
                String(repository.id) === String(currentId)
            );

            return existing ? currentId : String(list[0].id);
          });
        } else {
          setSelectedRepositoryId("");
        }
      } catch (error) {
        if (active) {
          setRepositoryError(
            error.response?.data?.message ||
              error.message ||
              "Unable to load repositories."
          );
        }
      } finally {
        if (active) setLoadingRepositories(false);
      }
    }

    loadRepositories();

    return () => {
      active = false;
    };
  }, []);

  // Load risk-analysis history when the repository changes
  useEffect(() => {
    let active = true;

    async function loadHistory() {
      if (!selectedRepositoryId) {
        setHistory([]);
        setHistoryError("");
        setLoadingHistory(false);
        return;
      }

      setLoadingHistory(true);
      setHistoryError("");

      try {
        const response = await api.get(
          `/api/repositories/${selectedRepositoryId}/analysis-history`
        );

        if (active) {
          const records = response.data?.history;
          setHistory(Array.isArray(records) ? records : []);
        }
      } catch (error) {
        if (active) {
          setHistory([]);

          setHistoryError(
            error.response?.data?.message ||
              "Unable to load risk-analysis history."
          );
        }
      } finally {
        if (active) setLoadingHistory(false);
      }
    }

    loadHistory();

    return () => {
      active = false;
    };
  }, [selectedRepositoryId, refreshKey]);

  const summary = useMemo(() => {
    const scores = history
      .map((item) => Number(item.score))
      .filter((score) => Number.isFinite(score));

    const highRiskCount = history.filter((item) => {
      const level = String(item.risk_level || "").toLowerCase();

      return level === "high" || level === "critical";
    }).length;

    const averageScore =
      scores.length > 0
        ? Math.round(
            scores.reduce((total, score) => total + score, 0) /
              scores.length
          )
        : null;

    return {
      total: history.length,
      highRiskCount,
      averageScore,
    };
  }, [history]);

  return (
    <main className="history-page">
      <div className="history-heading">
        <div>
          <p className="history-eyebrow">RISK-AWARE CI/CD</p>
          <h1>Analysis History</h1>
          <p className="history-description">
            Review previous pull-request risk assessments.
          </p>
        </div>

        <button
          type="button"
          className="history-refresh"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={!selectedRepositoryId || loadingHistory}
        >
          {loadingHistory ? "Loading..." : "Refresh"}
        </button>
      </div>

      <section className="history-filter">
        <label htmlFor="history-repository">
          Select repository
        </label>

        <select
          id="history-repository"
          value={selectedRepositoryId}
          onChange={(event) =>
            setSelectedRepositoryId(event.target.value)
          }
          disabled={loadingRepositories || repositories.length === 0}
        >
          {repositories.length === 0 && (
            <option value="">No repositories available</option>
          )}

          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.owner}/{repository.repository_name}
            </option>
          ))}
        </select>
      </section>

      {loadingRepositories && (
        <p className="history-message">Loading repositories...</p>
      )}

      {repositoryError && (
        <p className="history-error">{repositoryError}</p>
      )}

      {historyError && (
        <p className="history-error">{historyError}</p>
      )}

      <section className="history-stats">
        <article className="history-stat">
          <span>Total analyses</span>
          <strong>{summary.total}</strong>
        </article>

        <article className="history-stat">
          <span>Average risk score</span>
          <strong>
            {summary.averageScore === null
              ? "—"
              : `${summary.averageScore}/100`}
          </strong>
        </article>

        <article className="history-stat">
          <span>High or critical risk</span>
          <strong>{summary.highRiskCount}</strong>
        </article>
      </section>

      <section className="history-card">
        <div className="history-card-heading">
          <h2>Previous assessments</h2>
          <span>{history.length} records</span>
        </div>

        {loadingHistory ? (
          <p className="history-message">
            Loading analysis history...
          </p>
        ) : historyError ? (
          <p className="history-message">
            History could not be loaded.
          </p>
        ) : history.length === 0 ? (
          <div className="history-empty">
            <h3>No analysis history yet</h3>
            <p>
              Run a risk analysis from the Risk Analysis page.
              Its saved results will appear here.
            </p>
          </div>
        ) : (
          <div className="history-table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Pull request</th>
                  <th>Score</th>
                  <th>Risk level</th>
                  <th>Method</th>
                  <th>Date</th>
                  <th>Contributing factors</th>
                </tr>
              </thead>

              <tbody>
                {history.map((item) => {
                  const riskClass = String(
                    item.risk_level || "unknown"
                  )
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "");

                  const factors = formatFactors(
                    item.contributing_factors
                  );

                  return (
                    <tr key={item.analysis_id}>
                      <td>
                        <div className="history-pr">
                          {item.github_url ? (
                            <a
                              href={item.github_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              #{item.github_pr_number}
                            </a>
                          ) : (
                            <span>#{item.github_pr_number}</span>
                          )}

                          <span className="history-pr-title">
                            {item.pull_request_title ||
                              "Untitled pull request"}
                          </span>
                        </div>
                      </td>

                      <td>
                        <strong>
                          {item.score ?? "—"}
                          {item.score !== null &&
                          item.score !== undefined
                            ? "/100"
                            : ""}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={`history-risk history-risk-${riskClass}`}
                        >
                          {item.risk_level || "Unknown"}
                        </span>
                      </td>

                      <td>{item.analysis_method || "—"}</td>

                      <td>{formatDate(item.created_at)}</td>

                      <td>
                        {factors.length > 0 ? (
                          <ul className="history-factors">
                            {factors.slice(0, 3).map((factor, index) => (
                              <li key={`${item.analysis_id}-${index}`}>
                                {factor}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default History;