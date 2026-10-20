
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  GitBranch,
  ExternalLink,
  RefreshCw,
  GitPullRequest,
} from "lucide-react";
import api from "../api/api";

export default function Repositories() {
  const [owner, setOwner] = useState("");
  const [repositoryName, setRepositoryName] = useState("");

  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRepositories() {
    setLoading(true);
    setError("");

    try {
      const response = await api.get("/api/repositories");
      setRepositories(response.data.repositories || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to load repositories. Check your login and backend."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRepositories();
  }, []);

  async function handleConnect(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setConnecting(true);

    try {
      const response = await api.post("/api/repositories/connect", {
        owner: owner.trim(),
        repositoryName: repositoryName.trim(),
      });

      setNotice(
        response.data.message || "Repository connected successfully."
      );

      setOwner("");
      setRepositoryName("");

      await loadRepositories();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to connect this repository."
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync(repository) {
    setError("");
    setNotice("");
    setSyncingId(repository.id);

    try {
      const response = await api.post(
        `/api/repositories/${repository.id}/sync-pull-requests?state=all`
      );

      setNotice(
        `Synchronized ${response.data.syncedCount} pull request(s) from ` +
          `${repository.owner}/${repository.repositoryName}.`
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to synchronize pull requests."
      );
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="content-page">
      <div className="page-intro">
        <p className="eyebrow">GITHUB INTEGRATION</p>
        <h2>Repositories</h2>
        <p>
          Connect repositories and synchronize pull requests
          for risk-aware CI/CD analysis.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      <section className="content-card connect-card">
        <div className="card-heading">
          <div className="feature-icon">
            <GitBranch size={23} />
          </div>
          <div>
            <h3>Connect a repository</h3>
            <p>
              Enter the GitHub owner and repository name.
            </p>
          </div>
        </div>

        <form className="repository-form" onSubmit={handleConnect}>
          <div className="form-field">
            <label htmlFor="owner">Repository owner</label>
            <input
              id="owner"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="e.g. expressjs"
              maxLength={39}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="repositoryName">Repository name</label>
            <input
              id="repositoryName"
              value={repositoryName}
              onChange={(event) =>
                setRepositoryName(event.target.value)
              }
              placeholder="e.g. express"
              maxLength={100}
              required
            />
          </div>

          <button
            className="primary-button"
            type="submit"
            disabled={connecting}
          >
            {connecting ? "Connecting..." : "Connect repository"}
          </button>
        </form>
      </section>

      <section className="repository-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>Saved repositories</h2>
          </div>

          <button
            className="secondary-button"
            onClick={loadRepositories}
            disabled={loading}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="content-card empty-state">
            Loading repositories...
          </div>
        ) : repositories.length === 0 ? (
          <div className="content-card empty-state">
            <h3>No repositories connected yet</h3>
            <p>
              Connect a public repository above to start retrieving
              its pull requests and workflow data.
            </p>
          </div>
        ) : (
          <div className="repository-list">
            {repositories.map((repository) => (
              <article
                className="repository-card"
                key={repository.id}
              >
                <div className="repository-card-top">
                  <div className="feature-icon">
                    <GitBranch size={22} />
                  </div>

                  <span className="repository-status">
                    Connected
                  </span>
                </div>

                <h3>
                  {repository.owner}/{repository.repositoryName}
                </h3>

                <p className="repository-meta">
                  Default branch:{" "}
                  {repository.defaultBranch || "Not provided"}
                </p>

                <div className="repository-actions">
                  <button
                    className="secondary-button"
                    onClick={() => handleSync(repository)}
                    disabled={syncingId !== null}
                  >
                    <RefreshCw size={15} />
                    {syncingId === repository.id
                      ? "Synchronizing..."
                      : "Sync pull requests"}
                  </button>

                  <Link
                    className="secondary-button"
                    to={`/pull-requests?repositoryId=${repository.id}`}
                  >
                    <GitPullRequest size={15} />
                    View pull requests
                  </Link>
                </div>

                <a
                  className="external-link"
                  href={`https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repositoryName)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open GitHub <ExternalLink size={14} />
                </a>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
