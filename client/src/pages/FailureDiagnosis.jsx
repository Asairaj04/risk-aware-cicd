
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  FileSearch,
  RefreshCw,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import api from "../api/api";

function JobStatus({ status, conclusion }) {
  const value = String(conclusion || status || "unknown")
    .toLowerCase();

  let className = "workflow-status-unknown";
  let label = conclusion || status || "Unknown";

  if (value === "success") {
    className = "workflow-status-success";
  } else if (
    ["failure", "timed_out", "action_required"].includes(value)
  ) {
    className = "workflow-status-failure";
  } else if (
    ["queued", "in_progress", "requested", "waiting"].includes(value)
  ) {
    className = "workflow-status-running";
  }

  return (
    <span className={`workflow-status ${className}`}>
      {String(label).replaceAll("_", " ")}
    </span>
  );
}

function humanize(value) {
  return String(value || "Unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function FailureDiagnosis() {
  const [repositories, setRepositories] = useState([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [workflowRuns, setWorkflowRuns] = useState([]);
  const [githubRunId, setGithubRunId] = useState("");
  const [jobs, setJobs] = useState([]);

  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [syncingWorkflows, setSyncingWorkflows] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Load repositories belonging to the authenticated user.
  useEffect(() => {
    let cancelled = false;

    async function loadRepositories() {
      try {
        const response = await api.get("/api/repositories");

        if (!cancelled) {
          const items = response.data.repositories || [];
          setRepositories(items);
          setRepositoryId(String(items[0]?.id || ""));
        }
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

  // Load saved workflow runs whenever the repository changes.
  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      setWorkflowRuns([]);
      setGithubRunId("");
      setJobs([]);

      if (!repositoryId) return;

      setLoadingRuns(true);
      setError("");

      try {
        const response = await api.get(
          `/api/repositories/${repositoryId}/workflows`
        );

        if (cancelled) return;

        const items = response.data.workflowRuns || [];
        setWorkflowRuns(items);
        setGithubRunId(String(items[0]?.githubRunId || ""));
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Unable to load saved workflow runs."
          );
        }
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    }

    loadRuns();

    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  async function loadJobs(id = repositoryId, runId = githubRunId) {
    if (!id || !runId) {
      setJobs([]);
      return;
    }

    setLoadingJobs(true);
    setError("");

    try {
      const response = await api.get(
        `/api/repositories/${id}/workflows/${runId}/jobs`
      );

      setJobs(response.data.jobs || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to load saved job information."
      );
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }

  // Load existing job results when a workflow run is selected.
  useEffect(() => {
    if (repositoryId && githubRunId) {
      loadJobs(repositoryId, githubRunId);
    } else {
      setJobs([]);
    }
  }, [repositoryId, githubRunId]);

  async function handleSyncWorkflows() {
    if (!repositoryId) return;

    setError("");
    setNotice("");
    setSyncingWorkflows(true);

    try {
      const syncResponse = await api.post(
        `/api/repositories/${repositoryId}/sync-workflows`
      );

      const listResponse = await api.get(
        `/api/repositories/${repositoryId}/workflows`
      );

      const items = listResponse.data.workflowRuns || [];
      setWorkflowRuns(items);

      const selectedRun = items[0];
      setGithubRunId(String(selectedRun?.githubRunId || ""));

      setNotice(
        `${syncResponse.data.syncedCount} workflow run(s) synchronized.`
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to synchronize workflow runs."
      );
    } finally {
      setSyncingWorkflows(false);
    }
  }

  async function handleDiagnose() {
    if (!repositoryId || !githubRunId) {
      setError("Select a repository and workflow run first.");
      return;
    }

    setError("");
    setNotice("");
    setAnalyzing(true);

    try {
      // Ensure the latest available jobs have been saved first.
      await api.post(
        `/api/repositories/${repositoryId}/workflows/${githubRunId}/sync-jobs`
      );

      // Diagnose failed and timed-out jobs from available logs.
      const diagnosisResponse = await api.post(
        `/api/repositories/${repositoryId}/workflows/${githubRunId}/diagnose-failures`
      );

      // Fetch the saved job/diagnosis details for display.
      const jobResponse = await api.get(
        `/api/repositories/${repositoryId}/workflows/${githubRunId}/jobs`
      );

      setJobs(jobResponse.data.jobs || []);

      setNotice(
        diagnosisResponse.data.message ||
          "Failure diagnosis request completed."
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to diagnose workflow failures."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const selectedRepository = repositories.find(
    (repository) => String(repository.id) === repositoryId
  );

  const selectedRun = workflowRuns.find(
    (run) => String(run.githubRunId) === githubRunId
  );

  const failedJobs = jobs.filter((job) =>
    ["failure", "timed_out"].includes(
      String(job.conclusion || "").toLowerCase()
    )
  );

  const diagnosedJobs = jobs.filter((job) => job.diagnosis);

  return (
    <div className="content-page">
      <div className="page-intro">
        <p className="eyebrow">CI/CD FAILURE INVESTIGATION</p>
        <h2>Failure Diagnosis</h2>
        <p>
          Inspect failed GitHub Actions jobs and review rule-based
          explanations derived from available log evidence.
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

      <section className="content-card diagnosis-toolbar">
        <div className="form-field">
          <label htmlFor="diagnosisRepository">Repository</label>
          <select
            id="diagnosisRepository"
            value={repositoryId}
            onChange={(event) => {
              setRepositoryId(event.target.value);
              setNotice("");
              setError("");
            }}
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

        <div className="form-field">
          <label htmlFor="diagnosisRun">Workflow run</label>
          <select
            id="diagnosisRun"
            value={githubRunId}
            onChange={(event) => {
              setGithubRunId(event.target.value);
              setError("");
              setNotice("");
            }}
            disabled={loadingRuns || workflowRuns.length === 0}
          >
            {workflowRuns.length === 0 && (
              <option value="">No saved workflow runs</option>
            )}

            {workflowRuns.map((run) => (
              <option
                key={run.githubRunId}
                value={String(run.githubRunId)}
              >
                {run.workflowName} · #{run.githubRunId} ·{" "}
                {run.conclusion || run.status}
              </option>
            ))}
          </select>
        </div>

        <div className="diagnosis-toolbar-actions">
          <button
            className="secondary-button"
            onClick={handleSyncWorkflows}
            disabled={!repositoryId || syncingWorkflows || analyzing}
          >
            <RefreshCw
              size={15}
              className={syncingWorkflows ? "spin-icon" : ""}
            />
            {syncingWorkflows ? "Synchronizing..." : "Sync workflows"}
          </button>

          <button
            className="primary-button"
            onClick={handleDiagnose}
            disabled={!repositoryId || !githubRunId || analyzing}
          >
            {analyzing ? (
              <>
                <RefreshCw size={16} className="spin-icon" />
                Diagnosing...
              </>
            ) : (
              <>
                <FileSearch size={16} />
                Diagnose failures
              </>
            )}
          </button>
        </div>
      </section>

      {selectedRepository && (
        <div className="sequence-repository-caption">
          <Terminal size={17} />
          <span>
            {selectedRepository.owner}/{selectedRepository.repositoryName}
          </span>
          <span className="muted-inline">
            {jobs.length} saved job(s)
          </span>
        </div>
      )}

      {loadingRepositories || loadingRuns || loadingJobs ? (
        <section className="content-card empty-state">
          Loading workflow and job data...
        </section>
      ) : repositories.length === 0 ? (
        <section className="content-card empty-state">
          <h3>No connected repositories</h3>
          <p>Connect a repository before investigating workflow failures.</p>
        </section>
      ) : workflowRuns.length === 0 ? (
        <section className="content-card empty-state">
          <FileSearch size={30} />
          <h3>No saved workflow runs</h3>
          <p>
            Click Sync workflows to retrieve the latest workflow runs.
            A repository without accessible runs cannot be diagnosed yet.
          </p>
        </section>
      ) : jobs.length === 0 ? (
        <section className="content-card empty-state">
          <FileSearch size={30} />
          <h3>No jobs saved for this workflow</h3>
          <p>
            Click Diagnose failures to synchronize jobs first.
            If GitHub returns no jobs, select another workflow run.
          </p>
        </section>
      ) : (
        <>
          <section className="diagnosis-summary-grid">
            <article className="content-card diagnosis-stat-card">
              <p>Workflow run</p>
              <strong>#{selectedRun?.githubRunId}</strong>
              <small>{selectedRun?.workflowName || "Unknown workflow"}</small>
            </article>

            <article className="content-card diagnosis-stat-card">
              <p>Jobs saved</p>
              <strong>{jobs.length}</strong>
              <small>From synchronized GitHub job data</small>
            </article>

            <article className="content-card diagnosis-stat-card">
              <p>Failed or timed out</p>
              <strong>{failedJobs.length}</strong>
              <small>Based on stored GitHub conclusions</small>
            </article>

            <article className="content-card diagnosis-stat-card">
              <p>Diagnoses available</p>
              <strong>{diagnosedJobs.length}</strong>
              <small>Saved diagnostic results</small>
            </article>
          </section>

          <section className="diagnosis-results">
            <div className="section-heading">
              <div>
                <p className="eyebrow">JOB-LEVEL RESULTS</p>
                <h2>Workflow jobs</h2>
              </div>

              {selectedRun?.htmlUrl && (
                <a
                  className="external-link"
                  href={selectedRun.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open workflow on GitHub <ExternalLink size={14} />
                </a>
              )}
            </div>

            {jobs.map((job) => (
              <article className="content-card diagnosis-job-card" key={job.id}>
                <div className="diagnosis-job-header">
                  <div className="diagnosis-job-icon">
                    {job.diagnosis ? (
                      <ShieldAlert size={21} />
                    ) : (
                      <Terminal size={21} />
                    )}
                  </div>

                  <div className="diagnosis-job-title">
                    <h3>{job.jobName}</h3>
                    <p>
                      Job ID: {job.githubJobId} ·{" "}
                      {job.status}
                    </p>
                  </div>

                  <JobStatus
                    status={job.status}
                    conclusion={job.conclusion}
                  />
                </div>

                {job.failedStepSummary && (
                  <div className="diagnosis-evidence-block">
                    <h4>Failed step summary</h4>
                    <p>{job.failedStepSummary}</p>
                  </div>
                )}

                {job.diagnosis ? (
                  <div className="diagnosis-detail">
                    <div className="diagnosis-category-row">
                      <span className="eyebrow">DIAGNOSIS CATEGORY</span>
                      <span className="diagnosis-category">
                        {humanize(job.diagnosis.category)}
                      </span>
                      <span className="confidence-label">
                        Confidence: {job.diagnosis.confidence}
                      </span>
                    </div>

                    <h4>Possible explanation</h4>
                    <p>{job.diagnosis.explanation}</p>

                    {job.diagnosis.evidence && (
                      <>
                        <h4>Matched evidence</h4>
                        <pre className="diagnosis-evidence">
                          {job.diagnosis.evidence}
                        </pre>
                      </>
                    )}

                    <h4>Recommended next investigation</h4>
                    <p>{job.diagnosis.recommendedAction}</p>

                    {job.logExcerpt && (
                      <details className="log-details">
                        <summary>View sanitized log excerpt</summary>
                        <pre>{job.logExcerpt}</pre>
                      </details>
                    )}

                    {!job.logAvailable && (
                      <p className="risk-help">
                        A usable sanitized log excerpt is not stored.
                        Check GitHub directly if more evidence is needed.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="diagnosis-not-run">
                    <AlertCircle size={17} />
                    <p>
                      {["failure", "timed_out"].includes(
                        String(job.conclusion || "").toLowerCase()
                      )
                        ? "This failed job has not been diagnosed yet. Click Diagnose failures."
                        : "No failure diagnosis is available for this job."}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
