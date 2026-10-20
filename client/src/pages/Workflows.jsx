
import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  GitBranch,
  CircleCheck,
  CircleX,
  Clock3,
  LoaderCircle,
} from "lucide-react";
import api from "../api/api";

function StatusBadge({ status, conclusion }) {
  const effectiveStatus =
    String(conclusion || status || "unknown").toLowerCase();

  let className = "workflow-status-unknown";
  let label = conclusion || status || "Unknown";
  let Icon = Clock3;

  if (effectiveStatus === "success") {
    className = "workflow-status-success";
    label = "Success";
    Icon = CircleCheck;
  } else if (
    ["failure", "timed_out", "action_required"].includes(
      effectiveStatus
    )
  ) {
    className = "workflow-status-failure";
    label = effectiveStatus.replaceAll("_", " ");
    Icon = CircleX;
  } else if (
    ["in_progress", "queued", "requested", "waiting"].includes(
      effectiveStatus
    )
  ) {
    className = "workflow-status-running";
    label = effectiveStatus.replaceAll("_", " ");
    Icon = LoaderCircle;
  } else if (effectiveStatus === "cancelled") {
    className = "workflow-status-unknown";
    label = "Cancelled";
  }

  return (
    <span className={`workflow-status ${className}`}>
      <Icon size={14} />
      {label}
    </span>
  );
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString();
}

export default function Workflows() {
  const [repositories, setRepositories] = useState([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [workflowRuns, setWorkflowRuns] = useState([]);

  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [syncingWorkflows, setSyncingWorkflows] = useState(false);
  const [syncingRun, setSyncingRun] = useState(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadWorkflowRuns(id) {
    if (!id) {
      setWorkflowRuns([]);
      return;
    }

    setLoadingRuns(true);
    setError("");

    try {
      const response = await api.get(
        `/api/repositories/${id}/workflows`
      );

      setWorkflowRuns(response.data.workflowRuns || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to load saved workflow runs."
      );
      setWorkflowRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }

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
        setRepositoryId(String(items[0]?.id || ""));
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Unable to load connected repositories."
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
  }, []);

  useEffect(() => {
    if (repositoryId) {
      loadWorkflowRuns(repositoryId);
    } else {
      setWorkflowRuns([]);
    }
  }, [repositoryId]);

  async function handleSyncWorkflows() {
    if (!repositoryId) return;

    setError("");
    setNotice("");
    setSyncingWorkflows(true);

    try {
      const response = await api.post(
        `/api/repositories/${repositoryId}/sync-workflows`
      );

      setNotice(
        `${response.data.syncedCount} workflow run(s) synchronized from GitHub.`
      );

      await loadWorkflowRuns(repositoryId);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to synchronize GitHub Actions runs."
      );
    } finally {
      setSyncingWorkflows(false);
    }
  }

  async function handleSyncJobs(run) {
    setError("");
    setNotice("");
    setSyncingRun(run.githubRunId);

    try {
      const response = await api.post(
        `/api/repositories/${repositoryId}/workflows/${run.githubRunId}/sync-jobs`
      );

      setNotice(
        `${response.data.syncedCount} job(s) synchronized for workflow run ${run.githubRunId}.`
      );

      await loadWorkflowRuns(repositoryId);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to synchronize workflow jobs."
      );
    } finally {
      setSyncingRun(null);
    }
  }

  const selectedRepository = repositories.find(
    (repository) => String(repository.id) === repositoryId
  );

  const successfulRuns = workflowRuns.filter(
    (run) => run.conclusion === "success"
  ).length;

  const failedRuns = workflowRuns.filter(
    (run) =>
      ["failure", "timed_out"].includes(
        String(run.conclusion || "").toLowerCase()
      )
  ).length;

  const activeRuns = workflowRuns.filter(
    (run) =>
      ["queued", "in_progress", "requested", "waiting"].includes(
        String(run.status || "").toLowerCase()
      )
  ).length;

  return (
    <div className="content-page">
      <div className="page-intro">
        <p className="eyebrow">CONTINUOUS INTEGRATION</p>
        <h2>CI/CD Workflows</h2>
        <p>
          Inspect GitHub Actions runs, review their outcomes, and
          synchronize individual jobs for further diagnosis.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <AlertCircle size={17} />
          {error}
        </div>
      )}

      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      <section className="content-card workflow-toolbar">
        <div className="form-field">
          <label htmlFor="workflowRepository">
            Connected repository
          </label>

          <select
            id="workflowRepository"
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
            disabled={
              loadingRepositories || repositories.length === 0
            }
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

        <button
          className="secondary-button"
          onClick={handleSyncWorkflows}
          disabled={
            !repositoryId ||
            syncingWorkflows ||
            loadingRuns
          }
        >
          <RefreshCw
            size={15}
            className={syncingWorkflows ? "spin-icon" : ""}
          />
          {syncingWorkflows
            ? "Synchronizing..."
            : "Sync from GitHub"}
        </button>
      </section>

      {selectedRepository && (
        <div className="sequence-repository-caption">
          <GitBranch size={17} />
          <span>
            {selectedRepository.owner}/{selectedRepository.repositoryName}
          </span>
          <span className="muted-inline">
            {workflowRuns.length} saved run(s)
          </span>
        </div>
      )}

      <section className="workflow-summary-grid">
        <article className="content-card workflow-summary-card">
          <span className="feature-icon">
            <Activity size={21} />
          </span>
          <p>Saved runs</p>
          <strong>{workflowRuns.length}</strong>
        </article>

        <article className="content-card workflow-summary-card">
          <span className="feature-icon">
            <CircleCheck size={21} />
          </span>
          <p>Successful runs</p>
          <strong>{successfulRuns}</strong>
        </article>

        <article className="content-card workflow-summary-card">
          <span className="feature-icon">
            <CircleX size={21} />
          </span>
          <p>Failed or timed out</p>
          <strong>{failedRuns}</strong>
        </article>

        <article className="content-card workflow-summary-card">
          <span className="feature-icon">
            <Clock3 size={21} />
          </span>
          <p>Active runs</p>
          <strong>{activeRuns}</strong>
        </article>
      </section>

      <section className="content-card workflow-table-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GITHUB ACTIONS</p>
            <h2>Workflow runs</h2>
          </div>
        </div>

        {loadingRepositories || loadingRuns ? (
          <div className="empty-state">
            Loading workflow runs...
          </div>
        ) : repositories.length === 0 ? (
          <div className="empty-state">
            <GitBranch size={29} />
            <h3>No repository connected</h3>
            <p>Connect a repository before synchronizing workflows.</p>
          </div>
        ) : workflowRuns.length === 0 ? (
          <div className="empty-state">
            <Activity size={30} />
            <h3>No saved workflow runs</h3>
            <p>
              Select a repository and click Sync from GitHub.
              If GitHub returns no runs, the repository may not have
              workflows configured or accessible to this account.
            </p>
          </div>
        ) : (
          <div className="workflow-table-wrapper">
            <table className="workflow-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Conclusion</th>
                  <th>Jobs saved</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {workflowRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <div className="workflow-name">
                        <strong>{run.workflowName}</strong>
                        <small>
                          Run ID: {run.githubRunId}
                          {run.eventName
                            ? ` · Event: ${run.eventName}`
                            : ""}
                        </small>
                      </div>
                    </td>

                    <td>
                      <StatusBadge status={run.status} />
                    </td>

                    <td>
                      {run.conclusion ? (
                        <StatusBadge conclusion={run.conclusion} />
                      ) : (
                        <span className="muted-inline">
                          Not completed
                        </span>
                      )}
                    </td>

                    <td>{Number(run.jobCount || 0)}</td>

                    <td>{formatDate(run.startedAt)}</td>

                    <td>
                      <div className="workflow-actions">
                        <button
                          className="secondary-button"
                          onClick={() => handleSyncJobs(run)}
                          disabled={
                            syncingRun !== null ||
                            loadingRuns
                          }
                        >
                          <RefreshCw
                            size={14}
                            className={
                              syncingRun === run.githubRunId
                                ? "spin-icon"
                                : ""
                            }
                          />
                          {syncingRun === run.githubRunId
                            ? "Syncing..."
                            : "Sync jobs"}
                        </button>

                        {run.htmlUrl && (
                          <a
                            className="external-link"
                            href={run.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            GitHub <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="dashboard-note">
        Workflow statistics are calculated from synchronized database
        records. Job details must be synchronized before the failure
        diagnosis endpoint can analyze a failed run.
      </p>
    </div>
  );
}
