
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  GitPullRequest,
  Info,
  RefreshCw,
  Route,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import api from "../api/api";

function RiskLabel({ score, level }) {
  if (score == null) {
    return <span className="risk-badge risk-unknown">Not analyzed</span>;
  }

  const normalized = String(level || "unknown").toLowerCase();
  const valid = ["low", "medium", "high"].includes(normalized);

  return (
    <span className={`risk-badge ${valid ? `risk-${normalized}` : "risk-unknown"}`}>
      {level || "Unknown"} · {score}/100
    </span>
  );
}

function PullRequestLabel({ number, title }) {
  return (
    <div className="sequence-pr-title">
      <span>#{number}</span>
      <strong>{title}</strong>
    </div>
  );
}

export default function RecommendedOrder() {
  const [repositories, setRepositories] = useState([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [openPRs, setOpenPRs] = useState([]);
  const [orderData, setOrderData] = useState(null);

  const [prerequisitePr, setPrerequisitePr] = useState("");
  const [dependentPr, setDependentPr] = useState("");

  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [savingDependency, setSavingDependency] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

        // Prefer the current repository selected from the URL, if any.
        const requestedId = new URLSearchParams(
          window.location.search
        ).get("repositoryId");

        const selected = items.find(
          (item) => String(item.id) === requestedId
        );

        setRepositoryId(String((selected || items[0])?.id || ""));
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
  }, []);

  const loadRepositoryData = useCallback(async (id) => {
    if (!id) {
      setOpenPRs([]);
      setOrderData(null);
      return;
    }

    setLoadingData(true);
    setError("");

    try {
      const [prResponse, orderResponse] = await Promise.all([
        api.get(`/api/repositories/${id}/pull-requests`, {
          params: { state: "open" },
        }),
        api.get(`/api/repositories/${id}/recommended-order`),
      ]);

      const prs = prResponse.data.pullRequests || [];

      setOpenPRs(prs);
      setOrderData(orderResponse.data);

      setPrerequisitePr((current) => {
        if (prs.some((pr) => String(pr.number) === current)) {
          return current;
        }

        return String(prs[0]?.number || "");
      });

      setDependentPr((current) => {
        if (prs.some((pr) => String(pr.number) === current)) {
          return current;
        }

        return String(prs[1]?.number || "");
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to load the recommended order."
      );
      setOrderData(null);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (repositoryId) {
      loadRepositoryData(repositoryId);
    }
  }, [repositoryId, loadRepositoryData]);

  async function handleAddDependency(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (
      !repositoryId ||
      !prerequisitePr ||
      !dependentPr ||
      prerequisitePr === dependentPr
    ) {
      setError("Choose two different pull requests.");
      return;
    }

    setSavingDependency(true);

    try {
      const response = await api.post(
        `/api/repositories/${repositoryId}/dependencies`,
        {
          prerequisitePrNumber: Number(prerequisitePr),
          dependentPrNumber: Number(dependentPr),
        }
      );

      setNotice(
        response.data.message ||
          "Dependency recorded. Refreshing the recommended order."
      );

      await loadRepositoryData(repositoryId);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to record this dependency."
      );
    } finally {
      setSavingDependency(false);
    }
  }

  const selectedRepository = repositories.find(
    (repository) => String(repository.id) === repositoryId
  );

  const recommendedOrder = orderData?.recommendedOrder || [];
  const blockedItems = orderData?.blockedItems || [];
  const unsequencedItems = orderData?.unsequencedItems || [];
  const arrivalOrder = orderData?.arrivalOrderBaseline || [];
  const cycleDetected = Boolean(orderData?.cycleDetected);

  return (
    <div className="content-page">
      <div className="page-intro">
        <p className="eyebrow">DEPENDENCY-AWARE VALIDATION</p>
        <h2>Recommended Order</h2>
        <p>
          Prioritize eligible pull requests by saved risk score
          without placing a dependent change before its prerequisite.
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

      <section className="content-card sequence-toolbar">
        <div className="form-field">
          <label htmlFor="sequenceRepository">Repository</label>
          <select
            id="sequenceRepository"
            value={repositoryId}
            onChange={(event) => {
              setRepositoryId(event.target.value);
              setOrderData(null);
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

        <button
          className="secondary-button"
          onClick={() => loadRepositoryData(repositoryId)}
          disabled={!repositoryId || loadingData}
        >
          <RefreshCw
            size={15}
            className={loadingData ? "spin-icon" : ""}
          />
          Refresh order
        </button>
      </section>

      {selectedRepository && (
        <div className="sequence-repository-caption">
          <GitPullRequest size={17} />
          <span>
            {selectedRepository.owner}/{selectedRepository.repositoryName}
          </span>
          <span className="muted-inline">
            {openPRs.length} open pull request(s)
          </span>
        </div>
      )}

      {!loadingRepositories &&
        !loadingData &&
        repositories.length === 0 && (
          <section className="content-card empty-state">
            <h3>No repository connected</h3>
            <p>Connect a repository before calculating an order.</p>
          </section>
        )}

      {loadingRepositories || loadingData ? (
        <section className="content-card empty-state">
          Loading sequencing information...
        </section>
      ) : orderData ? (
        <>
          {cycleDetected && (
            <section className="sequence-warning">
              <TriangleAlert size={23} />
              <div>
                <h3>Dependency cycle detected</h3>
                <p>
                  A complete validation order cannot be produced until
                  the cycle is resolved. Review the unsequenced items below.
                </p>
              </div>
            </section>
          )}

          <section className="sequence-summary-grid">
            <article className="content-card sequence-summary-card">
              <span className="feature-icon">
                <Route size={22} />
              </span>
              <p>Recommended items</p>
              <strong>{recommendedOrder.length}</strong>
              <small>Eligible pull requests in the suggested order</small>
            </article>

            <article className="content-card sequence-summary-card">
              <span className="feature-icon">
                <ShieldAlert size={22} />
              </span>
              <p>Blocked items</p>
              <strong>{blockedItems.length}</strong>
              <small>Pull requests with unresolved prerequisites</small>
            </article>

            <article className="content-card sequence-summary-card">
              <span className="feature-icon">
                <ShieldCheck size={22} />
              </span>
              <p>Cycle status</p>
              <strong className={cycleDetected ? "cycle-text" : "valid-text"}>
                {cycleDetected ? "Detected" : "Clear"}
              </strong>
              <small>
                {cycleDetected
                  ? "Review dependency relationships"
                  : "No cycle detected in the eligible graph"}
              </small>
            </article>
          </section>

          <section className="content-card sequence-list-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">VALIDATION PLAN</p>
                <h2>Suggested sequence</h2>
              </div>

              <span className="factor-count">
                {recommendedOrder.length} items
              </span>
            </div>

            <p className="sequence-explanation">
              Among pull requests whose prerequisites are satisfied,
              higher saved risk scores are prioritized. Missing scores
              are treated as unknown. This is a recommendation for validation,
              not an automatic merge instruction.
            </p>

            {recommendedOrder.length === 0 ? (
              <div className="empty-state">
                <Route size={29} />
                <h3>No items can be sequenced</h3>
                <p>
                  There may be no open pull requests, or all remaining
                  candidates may be blocked by unresolved dependencies or cycles.
                </p>
              </div>
            ) : (
              <div className="sequence-items">
                {recommendedOrder.map((pr, index) => (
                  <article
                    className="sequence-item"
                    key={pr.prNumber}
                  >
                    <div className="sequence-rank">
                      {String(index + 1).padStart(2, "0")}
                    </div>

                    <div className="sequence-item-copy">
                      <PullRequestLabel
                        number={pr.prNumber}
                        title={pr.title}
                      />

                      <div className="sequence-item-meta">
                        <RiskLabel
                          score={pr.riskScore}
                          level={pr.riskLevel}
                        />

                        {pr.dependsOn?.length > 0 ? (
                          <span>
                            Depends on:{" "}
                            {pr.dependsOn.map((number) => `#${number}`).join(", ")}
                          </span>
                        ) : (
                          <span>No recorded prerequisites</span>
                        )}
                      </div>

                      <p>{pr.rationale}</p>
                    </div>

                    <span className="sequence-position">
                      Position {index + 1}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          {blockedItems.length > 0 && (
            <section className="content-card sequence-list-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">REQUIRES ATTENTION</p>
                  <h2>Blocked pull requests</h2>
                </div>
              </div>

              <div className="sequence-items">
                {blockedItems.map((pr) => (
                  <article
                    className="sequence-item blocked-sequence-item"
                    key={pr.prNumber}
                  >
                    <div className="sequence-rank blocked-rank">
                      <AlertCircle size={19} />
                    </div>

                    <div className="sequence-item-copy">
                      <PullRequestLabel
                        number={pr.prNumber}
                        title={pr.title}
                      />

                      {pr.reasons?.map((reason) => (
                        <p className="blocked-reason" key={reason}>
                          {reason}
                        </p>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {unsequencedItems.length > 0 && (
            <section className="content-card sequence-list-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">DEPENDENCY CYCLE</p>
                  <h2>Unsequenced items</h2>
                </div>
              </div>

              {unsequencedItems.map((pr) => (
                <div className="unsequenced-row" key={pr.prNumber}>
                  <div>
                    <strong>
                      #{pr.prNumber} — {pr.title}
                    </strong>
                    <p>{pr.reason}</p>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="content-card sequence-list-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">BASELINE COMPARISON</p>
                <h2>Arrival order</h2>
              </div>
            </div>

            <p className="sequence-explanation">
              This baseline sorts open pull requests by creation time.
              It is a comparison only, not a claim that the recommended order
              performs better in practice.
            </p>

            {arrivalOrder.length === 0 ? (
              <p className="risk-help">
                No open pull requests are available for the baseline.
              </p>
            ) : (
              <div className="baseline-pr-list">
                {arrivalOrder.map((pr, index) => (
                  <div className="baseline-pr-row" key={pr.prNumber}>
                    <span>{index + 1}</span>
                    <PullRequestLabel
                      number={pr.prNumber}
                      title={pr.title}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="content-card empty-state">
          <Info size={28} />
          <h3>Sequencing data isn't available</h3>
          <p>
            Refresh the page or check the backend response. No
            recommendation is being fabricated.
          </p>
          <button
            className="secondary-button"
            onClick={() => loadRepositoryData(repositoryId)}
            disabled={!repositoryId || loadingData}
          >
            <RefreshCw size={15} />
            Try again
          </button>
        </section>
      )}

      <section className="content-card dependency-form-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EXPLICIT DEPENDENCIES</p>
            <h2>Record a prerequisite</h2>
          </div>
        </div>

        <p className="sequence-explanation">
          Use this form only when one pull request genuinely requires
          another. The prerequisite will be placed before the dependent
          change. Don't create artificial relationships except during
          intentional tests, and remove temporary test dependencies afterward.
        </p>

        {openPRs.length < 2 ? (
          <p className="risk-help">
            At least two open pull requests must be synchronized to record
            a dependency.
          </p>
        ) : (
          <form
            className="dependency-form"
            onSubmit={handleAddDependency}
          >
            <div className="form-field">
              <label htmlFor="prerequisitePr">Prerequisite PR</label>
              <select
                id="prerequisitePr"
                value={prerequisitePr}
                onChange={(event) => setPrerequisitePr(event.target.value)}
                required
              >
                <option value="">Choose prerequisite</option>
                {openPRs.map((pr) => (
                  <option key={pr.id} value={String(pr.number)}>
                    #{pr.number} — {pr.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="dependency-arrow">
              <ArrowDown size={21} />
              <span>must come first</span>
            </div>

            <div className="form-field">
              <label htmlFor="dependentPr">Dependent PR</label>
              <select
                id="dependentPr"
                value={dependentPr}
                onChange={(event) => setDependentPr(event.target.value)}
                required
              >
                <option value="">Choose dependent</option>
                {openPRs.map((pr) => (
                  <option key={pr.id} value={String(pr.number)}>
                    #{pr.number} — {pr.title}
                  </option>
                ))}
              </select>
            </div>

            {prerequisitePr && dependentPr &&
              prerequisitePr === dependentPr && (
                <div className="alert alert-error">
                  Choose two different pull requests.
                </div>
              )}

            <button
              className="primary-button"
              type="submit"
              disabled={
                savingDependency ||
                !repositoryId ||
                !prerequisitePr ||
                !dependentPr ||
                prerequisitePr === dependentPr
              }
            >
              {savingDependency
                ? "Saving dependency..."
                : "Record dependency"}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
