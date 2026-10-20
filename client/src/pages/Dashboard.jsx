
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  GitBranch,
  GitPullRequest,
  Gauge,
  Route,
  ShieldAlert,
  History,
  Link2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import api from "../api/api";

const features = [
  {
    title: "Repository integration",
    description: "Connect repositories and synchronize GitHub data.",
    path: "/repositories",
    icon: GitBranch,
  },
  {
    title: "Pull-request analysis",
    description: "Inspect pull requests, changed files, additions, and deletions.",
    path: "/pull-requests",
    icon: GitPullRequest,
  },
  {
    title: "CI/CD workflows",
    description: "Review workflow runs, statuses, and job outcomes.",
    path: "/workflows",
    icon: Activity,
  },
  {
    title: "Failure diagnosis",
    description: "Investigate available CI/CD failure logs.",
    path: "/diagnosis",
    icon: ShieldAlert,
  },
  {
    title: "Risk analysis",
    description: "Understand risk scores and contributing factors.",
    path: "/risk-analysis",
    icon: Gauge,
  },
  {
    title: "Recommended order",
    description: "Review risk-aware sequencing recommendations.",
    path: "/sequencing",
    icon: Route,
  },
  {
    title: "Dependency management",
    description: "Define prerequisite relationships between pull requests.",
    path: "/dependencies",
    icon: Link2,
  },
  {
    title: "Analysis history",
    description: "Review previously saved risk assessments.",
    path: "/history",
    icon: History,
  },
];

const emptySummary = {
  repositories: 0,
  pullRequests: 0,
  workflowRuns: 0,
  failedRuns: 0,
  highRiskPRs: 0,
};

/*
 * Handle common API response shapes.
 */
function extractArray(data, keys = []) {
  const candidates = [data, data?.data];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    for (const key of keys) {
      if (Array.isArray(candidate?.[key])) {
        return candidate[key];
      }
    }
  }

  return [];
}

function getRiskLevel(pr) {
  const value =
    pr?.risk_level ??
    pr?.riskLevel ??
    pr?.latest_risk_level ??
    pr?.latestRiskLevel ??
    pr?.latest_risk_analysis?.risk_level ??
    pr?.latestRiskAnalysis?.riskLevel;

  return String(value ?? "").toLowerCase();
}

function isFailedRun(run) {
  const conclusion = String(run?.conclusion ?? "").toLowerCase();
  const status = String(run?.status ?? "").toLowerCase();

  return (
    ["failure", "timed_out", "startup_failure"].includes(conclusion) ||
    status === "failed"
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const [summary, setSummary] = useState(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [partialWarning, setPartialWarning] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError("");
      setPartialWarning("");

      try {
        const repositoryResponse = await api.get("/api/repositories");

        const repositories = extractArray(
          repositoryResponse.data,
          ["repositories", "repos"]
        );

        if (cancelled) return;

        if (repositories.length === 0) {
          setSummary(emptySummary);
          return;
        }

        let failedRequests = 0;
        let totalPullRequests = 0;
        let totalWorkflowRuns = 0;
        let failedWorkflowRuns = 0;
        let highRiskPRs = 0;

        /*
         * Load pull requests and workflows for each repository.
         * One failed endpoint will not prevent the other from loading.
         */
        const repositoryResults = await Promise.all(
          repositories.map(async (repository) => {
            if (!repository.id) {
              return {
                pullRequests: [],
                workflows: [],
                failedRequests: 2,
              };
            }

            const results = await Promise.allSettled([
              api.get(
                `/api/repositories/${repository.id}/pull-requests?state=all`
              ),
              api.get(
                `/api/repositories/${repository.id}/workflows`
              ),
            ]);

            let pullRequests = [];
            let workflows = [];
            let failures = 0;

            if (results[0].status === "fulfilled") {
              pullRequests = extractArray(
                results[0].value.data,
                ["pullRequests", "pull_requests", "items"]
              );
            } else {
              failures += 1;
            }

            if (results[1].status === "fulfilled") {
              workflows = extractArray(
                results[1].value.data,
                ["workflows", "workflowRuns", "workflow_runs", "runs", "items"]
              );
            } else {
              failures += 1;
            }

            return {
              pullRequests,
              workflows,
              failedRequests: failures,
            };
          })
        );

        for (const result of repositoryResults) {
          failedRequests += result.failedRequests;

          totalPullRequests += result.pullRequests.length;
          totalWorkflowRuns += result.workflows.length;

          failedWorkflowRuns += result.workflows.filter(
            isFailedRun
          ).length;

          highRiskPRs += result.pullRequests.filter((pr) =>
            ["high", "critical"].includes(getRiskLevel(pr))
          ).length;
        }

        if (cancelled) return;

        setSummary({
          repositories: repositories.length,
          pullRequests: totalPullRequests,
          workflowRuns: totalWorkflowRuns,
          failedRuns: failedWorkflowRuns,
          highRiskPRs,
        });

        if (failedRequests > 0) {
          setPartialWarning(
            "Some repository data could not be loaded. Check the backend and API responses."
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Unable to load dashboard data. Check your connection and sign-in."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const stats = [
    {
      label: "Connected repositories",
      value: summary.repositories,
      icon: GitBranch,
    },
    {
      label: "Pull requests",
      value: summary.pullRequests,
      icon: GitPullRequest,
    },
    {
      label: "Workflow runs",
      value: summary.workflowRuns,
      icon: Activity,
    },
    {
      label: "Failed workflow runs",
      value: summary.failedRuns,
      icon: ShieldAlert,
    },
    {
      label: "High / critical risk PRs",
      value: summary.highRiskPRs,
      icon: Gauge,
    },
  ];

  return (
    <div className="dashboard-page">
      <section className="welcome-panel">
        <div>
          <p className="eyebrow">RISK-AWARE DEVELOPMENT</p>

          <h2>
            Welcome, {user?.name || "Developer"}.
            <br />
            Understand every change.
          </h2>

          <p>
            Inspect pull requests, investigate CI/CD failures,
            evaluate risk, and prioritize validation while respecting
            dependencies.
          </p>

          <Link
            to="/repositories"
            className="primary-button dashboard-cta"
          >
            Manage repositories <ArrowRight size={17} />
          </Link>
        </div>

        <div className="welcome-graphic" aria-hidden="true">
          <GitBranch size={76} strokeWidth={1.2} />
        </div>
      </section>

      <section className="page-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE BACKEND DATA</p>
            <h2>Workspace overview</h2>
          </div>

          <button
            type="button"
            className="dashboard-refresh"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <p className="dashboard-message dashboard-error" role="alert">
            {error}
          </p>
        )}

        {partialWarning && !error && (
          <p
            className="dashboard-message dashboard-warning"
            role="status"
          >
            {partialWarning}
          </p>
        )}

        <div className="dashboard-stats">
          {stats.map(({ label, value, icon: Icon }) => (
            <article className="dashboard-stat-card" key={label}>
              <div className="dashboard-stat-top">
                <span>{label}</span>
                <Icon size={20} />
              </div>

              <strong>
                {loading ? "—" : value.toLocaleString()}
              </strong>
            </article>
          ))}
        </div>

        {!loading &&
          !error &&
          summary.repositories === 0 && (
            <p className="dashboard-message">
              No connected repositories yet. Connect a GitHub
              repository to start collecting CI/CD data.
            </p>
          )}
      </section>

      <section className="page-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">WORKSPACE TOOLS</p>
            <h2>Analysis modules</h2>
          </div>

          <p>Choose a module to continue.</p>
        </div>

        <div className="feature-grid">
          {features.map(
            ({ title, description, path, icon: Icon }) => (
              <Link
                to={path}
                className="feature-card"
                key={path}
              >
                <div className="feature-icon">
                  <Icon size={22} />
                </div>

                <h3>{title}</h3>
                <p>{description}</p>

                <span className="feature-link">
                  Open module <ArrowRight size={15} />
                </span>
              </Link>
            )
          )}
        </div>
      </section>

      <p className="dashboard-note">
        Metrics are calculated from synchronized repository data.
        Risk counts include pull requests for which a recognized
        high or critical risk level has been saved.
      </p>
    </div>
  );
}
