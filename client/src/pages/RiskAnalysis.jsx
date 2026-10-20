
import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import api from "../api/api";

function RiskBadge({ level }) {
  const normalized = String(level || "unknown").toLowerCase();

  return (
    <span className={`risk-badge risk-${normalized}`}>
      {level || "Unknown"} risk
    </span>
  );
}

export default function RiskAnalysis() {
  const [repositories, setRepositories] = useState([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [pullRequests, setPullRequests] = useState([]);
  const [prNumber, setPrNumber] = useState("");

  const [analysis, setAnalysis] = useState(null);
  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

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
        setRepositoryId(String(items[0]?.id || ""));
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Unable to load repositories."
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

  // Load stored pull requests when the selected repository changes.
  useEffect(() => {
    let cancelled = false;

    async function loadPullRequests() {
      setAnalysis(null);
      setPrNumber("");
      setNotice("");

      if (!repositoryId) {
        setPullRequests([]);
        return;
      }

      setLoadingPRs(true);
      setError("");

      try {
        const response = await api.get(
          `/api/repositories/${repositoryId}/pull-requests`,
          { params: { state: "all" } }
        );

        if (cancelled) return;

        const items = response.data.pullRequests || [];
        setPullRequests(items);

        if (items.length > 0) {
          setPrNumber(String(items[0].number));
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
  }, [repositoryId]);

  const selectedPR = pullRequests.find(
    (pr) => String(pr.number) === prNumber
  );

  const displayedScore =
    analysis?.analysis?.score ?? selectedPR?.riskScore ?? null;

  const displayedLevel =
    analysis?.analysis?.riskLevel ?? selectedPR?.riskLevel ?? null;

  async function handleAnalyze() {
    if (!repositoryId || !prNumber) {
      setError("Select a repository and pull request first.");
      return;
    }

    setError("");
    setNotice("");
    setAnalyzing(true);

    try {
      const response = await api.post(
        `/api/repositories/${repositoryId}/pull-requests/${prNumber}/analyze-risk`
      );

      setAnalysis(response.data);
      setNotice(response.data.message || "Risk analysis completed.");

      // Refresh stored pull-request data so the saved score appears
      // in this page and in the pull-request table.
      const refreshed = await api.get(
        `/api/repositories/${repositoryId}/pull-requests`,
        { params: { state: "all" } }
      );

      setPullRequests(refreshed.data.pullRequests || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to analyze this pull request."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const factors = analysis?.analysis?.factors || [];

  return (
    <div className="content-page">
      <div className="page-intro">
        <p className="eyebrow">CODE CHANGE INTELLIGENCE</p>
        <h2>Risk Analysis</h2>
        <p>
          Calculate an explainable risk score for a synchronized
          GitHub pull request and review its contributing factors.
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

      <section className="content-card risk-selection-card">
        <div className="risk-section-heading">
          <div className="feature-icon">
            <BrainCircuit size={23} />
          </div>
          <div>
            <h3>Choose a pull request</h3>
            <p>Select a repository and one of its stored pull requests.</p>
          </div>
        </div>

        <div className="risk-select-grid">
          <div className="form-field">
            <label htmlFor="riskRepository">Repository</label>
            <select
              id="riskRepository"
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

          <div className="form-field">
            <label htmlFor="riskPR">Pull request</label>
            <select
              id="riskPR"
              value={prNumber}
              onChange={(event) => {
                setPrNumber(event.target.value);
                setAnalysis(null);
                setNotice("");
                setError("");
              }}
              disabled={loadingPRs || pullRequests.length === 0}
            >
              {pullRequests.length === 0 && (
                <option value="">No stored pull requests</option>
              )}

              {pullRequests.map((pr) => (
                <option key={pr.id} value={String(pr.number)}>
                  #{pr.number} — {pr.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {repositories.length === 0 && !loadingRepositories ? (
          <p className="risk-help">
            Connect a repository first.
          </p>
        ) : pullRequests.length === 0 && !loadingPRs ? (
          <p className="risk-help">
            Synchronize pull requests from GitHub before analyzing them.
          </p>
        ) : null}

        <div className="risk-action-row">
          <button
            className="primary-button"
            onClick={handleAnalyze}
            disabled={
              !repositoryId ||
              !prNumber ||
              loadingPRs ||
              analyzing
            }
          >
            {analyzing ? (
              <>
                <RefreshCw size={16} className="spin-icon" />
                Analyzing...
              </>
            ) : (
              <>
                <Activity size={16} />
                Calculate risk score
              </>
            )}
          </button>

          <span className="risk-help">
            Uses your saved pull-request and changed-file records.
          </span>
        </div>
      </section>

      {selectedPR && (
        <section className="content-card selected-pr-card">
          <div className="pr-context-icon">
            <ShieldCheck size={23} />
          </div>

          <div className="selected-pr-info">
            <p className="eyebrow">SELECTED CHANGE</p>
            <h3>
              <span>#{selectedPR.number}</span> {selectedPR.title}
            </h3>
            <p>
              {selectedPR.author || "Unknown author"} ·{" "}
              {selectedPR.state} ·{" "}
              {selectedPR.changedFiles ?? 0} changed file(s)
            </p>
          </div>

          {displayedScore !== null && displayedScore !== undefined && (
            <div className="selected-pr-risk">
              <strong>{displayedScore}/100</strong>
              <RiskBadge level={displayedLevel} />
            </div>
          )}
        </section>
      )}

      {loadingRepositories || loadingPRs ? (
        <div className="content-card empty-state">
          Loading analysis data...
        </div>
      ) : analysis ? (
        <>
          <section className="risk-result-grid">
            <article className="content-card risk-score-card">
              <p className="eyebrow">RULE-BASED SCORE</p>

              <div className="risk-score-number">
                <strong>{analysis.analysis.score}</strong>
                <span>/100</span>
              </div>

              <RiskBadge level={analysis.analysis.riskLevel} />

              <p className="risk-help">
                Method: {analysis.analysis.method}
              </p>

              <p className="risk-help">
                This score is a heuristic, not a failure probability.
              </p>
            </article>

            <article className="content-card risk-summary-card">
              <div className="risk-summary-icon">
                {analysis.analysis.score >= 60 ? (
                  <ShieldAlert size={24} />
                ) : (
                  <ShieldCheck size={24} />
                )}
              </div>

              <h3>What this score means</h3>

              <p>
                {analysis.analysis.score >= 60
                  ? "The configured rules assign this change a high risk score. Review its contributing factors and available checks carefully."
                  : analysis.analysis.score >= 30
                    ? "The configured rules assign this change a medium risk score. Review the factors below before deciding how to validate it."
                    : "The configured rules assign this change a low risk score. This does not guarantee that the code is defect-free."}
              </p>

              <div className="risk-summary-meta">
                <span>Files analyzed</span>
                <strong>
                  {analysis.analysis.analyzedFileCount}
                </strong>
              </div>

              <div className="risk-summary-meta">
                <span>Failure probability</span>
                <strong>Not estimated</strong>
              </div>
            </article>
          </section>

          <section className="content-card risk-factors-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SCORE BREAKDOWN</p>
                <h2>Contributing factors</h2>
              </div>

              <span className="factor-count">
                {factors.length} factors
              </span>
            </div>

            <div className="risk-factor-list">
              {factors.map((factor, index) => (
                <article
                  className="risk-factor-row"
                  key={`${factor.factor}-${index}`}
                >
                  <div className="risk-factor-index">
                    {String(index + 1).padStart(2, "0")}
                  </div>

                  <div className="risk-factor-copy">
                    <h3>{factor.factor}</h3>
                    <p>{factor.reason}</p>
                  </div>

                  <strong
                    className={
                      factor.impact > 0
                        ? "factor-impact"
                        : "factor-neutral"
                    }
                  >
                    +{factor.impact}
                  </strong>
                </article>
              ))}
            </div>
          </section>

          <section className="content-card risk-limitations">
            <h3>Limitations and interpretation</h3>
            <ul>
              {(analysis.analysis.limitations || []).map(
                (limitation) => (
                  <li key={limitation}>{limitation}</li>
                )
              )}
            </ul>
          </section>
        </>
      ) : (
        <section className="content-card empty-state">
          <BrainCircuit size={31} />
          <h3>No new analysis generated yet</h3>
          <p>
            Choose a stored pull request and click Calculate risk score.
            Any existing saved score may appear beside the selection.
          </p>
          <ArrowRight size={19} />
        </section>
      )}
    </div>
  );
}
