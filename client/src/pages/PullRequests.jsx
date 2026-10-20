
import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import {
  GitPullRequest,
  RefreshCw,
  ExternalLink,
  Search,
  AlertCircle,
  FolderGit2,
} from "lucide-react";
import api from "../api/api";

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function RiskBadge({ score, level }) {
  if (score == null) {
    return <span className="risk-badge risk-unknown">Not analyzed</span>;
  }

  const normalizedLevel = String(level || "").toLowerCase();
  const className = ["low", "medium", "high"].includes(normalizedLevel)
    ? `risk-${normalizedLevel}`
    : "risk-unknown";

  return (
    <span className={`risk-badge ${className}`}>
      {level || "Unknown"} · {score}/100
    </span>
  );
}

export default function PullRequests() {
  const location = useLocation();

  const [repositories, setRepositories] = useState([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [pullRequests, setPullRequests] = useState([]);

  const [stateFilter, setStateFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Load repositories belonging to the authenticated user.
  useEffect(() => {
    let cancelled = false;

    async function loadRepositories() {
      setLoadingRepositories(true);
      setError("");

      try {
        const response = await api.get("/api/repositories");
        if (cancelled) return;

        const items = response.data.repositories || [];
        setRepositories(items);

        const requestedId = new URLSearchParams(
          location.search
        ).get("repositoryId");

        const selected = items.find(
          (item) => String(item.id) === requestedId
        );

        setRepositoryId(
          String((selected || items[0])?.id || "")
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Unable to load your repositories."
          );
        }
      } finally {
        if (!cancelled) setLoadingRepositories(false);
      }
    }

    loadRepositories();

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  // Load already-synchronized pull requests from the backend.
  useEffect(() => {
    let cancelled = false;

    async function loadPullRequests() {
      if (!repositoryId) {
        setPullRequests([]);
        return;
      }

      setLoadingPRs(true);
      setError("");

      try {
        const response = await api.get(
          `/api/repositories/${repositoryId}/pull-requests`,
          { params: { state: stateFilter } }
        );

        if (!cancelled) {
          setPullRequests(response.data.pullRequests || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Unable to load pull requests."
          );
          setPullRequests([]);
        }
      } finally {
        if (!cancelled) setLoadingPRs(false);
      }
    }

    loadPullRequests();

    return () => {
      cancelled = true;
    };
  }, [repositoryId, stateFilter]);

 
async function handleSync() {
  if (!repositoryId) {
    setError("Please select a repository first.");
    return;
  }

  setError("");
  setNotice("");
  setSyncing(true);

  try {
    // Synchronize pull requests from GitHub.
    const syncResponse = await api.post(
      `/api/repositories/${repositoryId}/sync-pull-requests`,
      {},
      { params: { state: "all" } }
    );

    const syncData = syncResponse.data || {};

    if (syncData.success === false) {
      throw new Error(
        syncData.message || "The backend reported a synchronization failure."
      );
    }

    // Reload saved pull requests from MySQL.
    const response = await api.get(
      `/api/repositories/${repositoryId}/pull-requests`,
      { params: { state: stateFilter } }
    );

    const data = response.data || {};

    const items = Array.isArray(data.pullRequests)
      ? data.pullRequests
      : Array.isArray(data.pull_requests)
        ? data.pull_requests
        : [];

    setPullRequests(items);

    const syncedCount =
      syncData.syncedCount ??
      syncData.count ??
      (Array.isArray(syncData.pullRequests)
        ? syncData.pullRequests.length
        : items.length);

    setNotice(
      `Synchronization completed. ${syncedCount} pull request(s) synchronized.`
    );
  } catch (err) {
    console.error("Pull request synchronization error:", {
      message: err.message,
      status: err.response?.status,
      response: err.response?.data,
    });

    const status = err.response?.status;
    const serverMessage = err.response?.data?.message;

    setError(
      serverMessage ||
        `Unable to synchronize pull requests${
          status ? ` (HTTP ${status})` : ""
        }. ${err.message || "Check the backend connection."}`
    );
  } finally {
    setSyncing(false);
  }
}


  const filteredPullRequests = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return pullRequests;

    return pullRequests.filter((pr) => {
      return [
        pr.number,
        pr.title,
        pr.author,
        pr.headBranch,
        pr.baseBranch,
      ].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      );
    });
  }, [pullRequests, search]);

  const selectedRepository = repositories.find(
    (item) => String(item.id) === repositoryId
  );

  return (
    <div className="content-page">
      <div className="page-intro">
        <p className="eyebrow">CODE CHANGE ANALYSIS</p>
        <h2>Pull Requests</h2>
        <p>
          Review synchronized changes, identify unanalyzed pull requests,
          and inspect saved risk scores.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      <section className="content-card pr-toolbar">
        <div className="pr-repository-picker">
          <label htmlFor="prRepository">Repository</label>

          <select
            id="prRepository"
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
            disabled={loadingRepositories || repositories.length === 0}
          >
            {repositories.length === 0 && (
              <option value="">No connected repositories</option>
            )}

            {repositories.map((repository) => (
              <option key={repository.id} value={String(repository.id)}>
                {repository.owner}/{repository.repositoryName}
              </option>
            ))}
          </select>
        </div>

        <div className="pr-toolbar-actions">
          <button
            className="secondary-button"
            onClick={handleSync}
            disabled={!repositoryId || syncing || loadingPRs}
          >
            <RefreshCw
              size={15}
              className={syncing ? "spin-icon" : ""}
            />
            {syncing ? "Synchronizing..." : "Sync from GitHub"}
          </button>
        </div>
      </section>

      {selectedRepository && (
        <div className="pr-repository-caption">
          <FolderGit2 size={17} />
          <span>
            {selectedRepository.owner}/
            {selectedRepository.repositoryName}
          </span>
          <span className="muted-inline">
            {filteredPullRequests.length} displayed
          </span>
        </div>
      )}

      <section className="content-card pr-data-card">
        <div className="pr-filter-bar">
          <div className="pr-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, author, PR number..."
              aria-label="Search pull requests"
            />
          </div>

          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            aria-label="Filter by pull-request state"
          >
            <option value="all">All states</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        {loadingRepositories || loadingPRs ? (
          <div className="empty-state">
            Loading pull requests...
          </div>
        ) : repositories.length === 0 ? (
          <div className="empty-state">
            <GitPullRequest size={30} />
            <h3>No connected repository</h3>
            <p>Connect a GitHub repository before loading pull requests.</p>
            <Link to="/repositories" className="text-link">
              Go to repositories
            </Link>
          </div>
        ) : filteredPullRequests.length === 0 ? (
          <div className="empty-state">
            <GitPullRequest size={30} />
            <h3>No pull requests found</h3>
            <p>
              Try another filter or synchronize the repository with GitHub.
            </p>
          </div>
        ) : (
          <div className="pr-table-wrapper">
            <table className="pr-table">
              <thead>
                <tr>
                  <th>Pull request</th>
                  <th>Author</th>
                  <th>State</th>
                  <th>Changed files</th>
                  <th>Changes</th>
                  <th>Risk analysis</th>
                  <th>Created</th>
                  <th>GitHub</th>
                </tr>
              </thead>

              <tbody>
                {filteredPullRequests.map((pr) => (
                  <tr key={pr.id}>
                    <td>
                      <div className="pr-title">
                        <span className="pr-number">#{pr.number}</span>
                        <strong>{pr.title}</strong>
                      </div>
                      <span className="pr-branch">
                        {pr.headBranch || "—"} → {pr.baseBranch || "—"}
                      </span>
                    </td>

                    <td>{pr.author || "Unknown"}</td>

                    <td>
                      <span
                        className={`state-badge ${
                          String(pr.state).toLowerCase() === "open"
                            ? "state-open"
                            : "state-closed"
                        }`}
                      >
                        {pr.state}
                      </span>
                    </td>

                    <td>{pr.changedFiles ?? "—"}</td>

                    <td>
                      <span className="change-positive">
                        +{pr.additions ?? 0}
                      </span>
                      {" / "}
                      <span className="change-negative">
                        −{pr.deletions ?? 0}
                      </span>
                    </td>

                    <td>
                      <RiskBadge
                        score={pr.riskScore}
                        level={pr.riskLevel}
                      />
                    </td>

                    <td>{formatDate(pr.createdAt)}</td>

                    <td>
                      {pr.githubUrl ? (
                        <a
                          className="external-link"
                          href={pr.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open pull request ${pr.number} on GitHub`}
                        >
                          View <ExternalLink size={14} />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="dashboard-note">
        Pull requests are loaded from your application database. Use
        “Sync from GitHub” to retrieve newer information. Risk scores appear
        only after an analysis has been saved.
      </p>
    </div>
  );
}
