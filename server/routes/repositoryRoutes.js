
const express = require("express");
const axios = require("axios");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");

const {
  sanitizeLog,
  diagnoseLog,
} = require("../services/failureDiagnosisService");

const {
  calculateRiskScore,
} = require("../services/riskScoringService");

const {
  recommendSequence,
} = require("../services/dependencySequencingService");

const router = express.Router();

router.post("/connect", authenticateToken, async (req, res) => {
  const { owner, repositoryName } = req.body || {};

  if (
    typeof owner !== "string" ||
    typeof repositoryName !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Repository owner and name are required.",
    });
  }

  const cleanOwner = owner.trim();
  const cleanRepo = repositoryName.trim();

  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const validRepo = /^[A-Za-z0-9._-]{1,100}$/;

  if (!validOwner.test(cleanOwner) || !validRepo.test(cleanRepo)) {
    return res.status(400).json({
      success: false,
      message: "Invalid GitHub repository owner or name.",
    });
  }

  // Verify the repository using GitHub's REST API.
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "risk-aware-cicd-project",
  };

  // Optional: use a backend-only token for private repositories.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let githubRepository;

  try {
    const response = await axios.get(
      `https://api.github.com/repos/${encodeURIComponent(cleanOwner)}/${encodeURIComponent(cleanRepo)}`,
      { headers, timeout: 10000 }
    );

    githubRepository = response.data;
  } catch (error) {
    const status = error.response?.status;

    if (status === 404) {
      return res.status(404).json({
        success: false,
        message:
          "Repository not found or the configured credentials cannot access it.",
      });
    }

    if (status === 401) {
      return res.status(502).json({
        success: false,
        message: "GitHub rejected the configured credentials.",
      });
    }

    if (status === 403 || status === 429) {
      return res.status(502).json({
        success: false,
        message:
          "GitHub denied the request or imposed a rate limit. Check access and try again later.",
      });
    }

    if (error.code === "ECONNABORTED") {
      return res.status(504).json({
        success: false,
        message: "GitHub request timed out. Please try again.",
      });
    }

    console.error("GitHub request error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to contact GitHub.",
    });
  }

  try {
    const canonicalOwner = githubRepository.owner.login;
    const canonicalName = githubRepository.name;
    const defaultBranch = githubRepository.default_branch || null;

    // Save the repository for the authenticated user.
    await db.execute(
      `INSERT INTO repositories
         (user_id, owner, repository_name, default_branch)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         default_branch = ?,
         updated_at = CURRENT_TIMESTAMP`,
      [
        req.user.sub,
        canonicalOwner,
        canonicalName,
        defaultBranch,
        defaultBranch,
      ]
    );

    const [rows] = await db.execute(
      `SELECT id, owner,
              repository_name AS repositoryName,
              default_branch AS defaultBranch
       FROM repositories
       WHERE user_id = ?
         AND owner = ?
         AND repository_name = ?
       LIMIT 1`,
      [req.user.sub, canonicalOwner, canonicalName]
    );

    return res.status(200).json({
      success: true,
      message: "GitHub repository connected successfully.",
      repository: {
        ...rows[0],
        githubUrl: githubRepository.html_url,
        private: githubRepository.private,
        description: githubRepository.description,
      },
    });
  } catch (error) {
    console.error("Repository database error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to save the repository.",
    });
  }
});


router.post(
  "/:id/sync-pull-requests",
  authenticateToken,
  async (req, res) => {
    try {
      const repositoryId = Number(req.params.id);

      if (
        !Number.isSafeInteger(repositoryId) ||
        repositoryId < 1
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid repository ID.",
        });
      }

      const state = req.query.state || "open";

      if (!["open", "closed", "all"].includes(state)) {
        return res.status(400).json({
          success: false,
          message: "State must be open, closed, or all.",
        });
      }

      // Verify that this repository belongs to the logged-in user.
      const [repositories] = await db.execute(
        `SELECT id, owner, repository_name
         FROM repositories
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Repository not found in your account.",
        });
      }

      const repository = repositories[0];

      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "risk-aware-cicd-project",
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization =
          `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      // Fetch up to 500 pull requests, handling pagination.
      const pullRequests = [];

      for (let page = 1; page <= 5; page++) {
        const response = await axios.get(
          `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository_name)}/pulls`,
          {
            headers,
            params: {
              state,
              per_page: 100,
              page,
            },
            timeout: 15000,
          }
        );

        const batch = response.data;
        pullRequests.push(...batch);

        if (batch.length < 100) {
          break;
        }
      }

      // Save new pull requests and update existing records.
      for (const pr of pullRequests) {
        await db.execute(
          `INSERT INTO pull_requests (
            repository_id,
            github_pr_number,
            title,
            state,
            author,
            head_branch,
            base_branch,
            additions,
            deletions,
            changed_files_count,
            github_url,
            github_created_at,
            github_updated_at,
            last_synced_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  CURRENT_TIMESTAMP)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            state = VALUES(state),
            author = VALUES(author),
            head_branch = VALUES(head_branch),
            base_branch = VALUES(base_branch),
            additions = VALUES(additions),
            deletions = VALUES(deletions),
            changed_files_count = VALUES(changed_files_count),
            github_url = VALUES(github_url),
            github_created_at = VALUES(github_created_at),
            github_updated_at = VALUES(github_updated_at),
            last_synced_at = CURRENT_TIMESTAMP`,
          [
            repositoryId,
            pr.number,
            pr.title,
            pr.state,
            pr.user?.login || null,
            pr.head?.ref || null,
            pr.base?.ref || null,
            pr.additions ?? 0,
            pr.deletions ?? 0,
            pr.changed_files ?? 0,
            pr.html_url || null,
            pr.created_at ? new Date(pr.created_at) : null,
            pr.updated_at ? new Date(pr.updated_at) : null,
          ]
        );
      }

      // Return the records saved for this repository and state.
      let sql = `
        SELECT
          id,
          github_pr_number AS number,
          title,
          state,
          author,
          head_branch AS headBranch,
          base_branch AS baseBranch,
          additions,
          deletions,
          changed_files_count AS changedFiles,
          github_url AS githubUrl,
          github_created_at AS createdAt
        FROM pull_requests
        WHERE repository_id = ?
      `;

      const params = [repositoryId];

      if (state !== "all") {
        sql += " AND state = ?";
        params.push(state);
      }

      sql += " ORDER BY github_created_at DESC";

      const [savedPullRequests] = await db.execute(sql, params);

      return res.status(200).json({
        success: true,
        message: "Pull requests synchronized successfully.",
        repository: `${repository.owner}/${repository.repository_name}`,
        syncedCount: pullRequests.length,
        pullRequests: savedPullRequests,
      });
    } catch (error) {
      const status = error.response?.status;

      if (status === 404) {
        return res.status(404).json({
          success: false,
          message: "GitHub repository was not found or is inaccessible.",
        });
      }

      if (status === 401 || status === 403 || status === 429) {
        return res.status(502).json({
          success: false,
          message:
            "GitHub denied the request or imposed a rate limit. Check permissions and try again later.",
        });
      }

      if (
        error.code === "ECONNABORTED" ||
        error.code === "ETIMEDOUT"
      ) {
        return res.status(504).json({
          success: false,
          message: "GitHub request timed out.",
        });
      }

      console.error("Pull request sync error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to synchronize pull requests.",
      });
    }
  }
);


router.post(
  "/:repositoryId/pull-requests/:prNumber/sync-files",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const prNumber = Number(req.params.prNumber);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      !Number.isSafeInteger(prNumber) ||
      prNumber < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID or pull-request number.",
      });
    }

    try {
      // Ensure the repository and pull request belong to this user.
      const [rows] = await db.execute(
        `SELECT
           r.id AS repositoryId,
           r.owner,
           r.repository_name AS repositoryName,
           pr.id AS pullRequestId,
           pr.github_pr_number AS prNumber,
           pr.title
         FROM repositories r
         JOIN pull_requests pr
           ON pr.repository_id = r.id
         WHERE r.id = ?
           AND r.user_id = ?
           AND pr.github_pr_number = ?
         LIMIT 1`,
        [repositoryId, req.user.sub, prNumber]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Pull request not found in your connected repository.",
        });
      }

      const record = rows[0];

      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "risk-aware-cicd-project",
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization =
          `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      // Fetch all available changed-file pages before replacing
      // the previously stored file records.
      const files = [];
      let reachedGitHubLimit = false;

      try {
        for (let page = 1; page <= 30; page++) {
          const response = await axios.get(
            `https://api.github.com/repos/${encodeURIComponent(record.owner)}/${encodeURIComponent(record.repositoryName)}/pulls/${prNumber}/files`,
            {
              headers,
              params: {
                per_page: 100,
                page,
              },
              timeout: 15000,
            }
          );

          const batch = response.data;
          files.push(...batch);

          if (batch.length < 100) {
            break;
          }

          if (page === 30) {
            reachedGitHubLimit = true;
          }
        }
      } catch (githubError) {
        const status = githubError.response?.status;

        if (status === 404) {
          return res.status(404).json({
            success: false,
            message:
              "Pull request not found on GitHub or it is not accessible.",
          });
        }

        if (status === 401 || status === 403 || status === 429) {
          return res.status(502).json({
            success: false,
            message:
              "GitHub denied the request or imposed a rate limit. Check permissions and try again later.",
          });
        }

        if (
          githubError.code === "ECONNABORTED" ||
          githubError.code === "ETIMEDOUT"
        ) {
          return res.status(504).json({
            success: false,
            message: "GitHub request timed out.",
          });
        }

        console.error(
          "GitHub changed-file request failed:",
          githubError.message
        );

        return res.status(502).json({
          success: false,
          message: "Unable to retrieve changed files from GitHub.",
        });
      }

      // Replace the stored file records in a transaction so an
      // incomplete database update does not leave partial results.
      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        await connection.execute(
          "DELETE FROM changed_files WHERE pull_request_id = ?",
          [record.pullRequestId]
        );

        for (const file of files) {
          await connection.execute(
            `INSERT INTO changed_files
               (pull_request_id, filename, change_status,
                additions, deletions)
             VALUES (?, ?, ?, ?, ?)`,
            [
              record.pullRequestId,
              file.filename,
              file.status || null,
              file.additions ?? 0,
              file.deletions ?? 0,
            ]
          );
        }

        await connection.commit();
      } catch (databaseError) {
        await connection.rollback();
        throw databaseError;
      } finally {
        connection.release();
      }

      return res.status(200).json({
        success: true,
        message: "Changed files synchronized successfully.",
        repository:
          `${record.owner}/${record.repositoryName}`,
        pullRequestNumber: record.prNumber,
        changedFileCount: files.length,
        reachedGitHubLimit,
        preview: files.slice(0, 20).map((file) => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        })),
      });
    } catch (error) {
      console.error("Changed-file sync error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to save changed-file information.",
      });
    }
  }
);


router.post(
  "/:id/sync-workflows",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.id);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID.",
      });
    }

    try {
      // 1. Verify repository ownership.
      const [repositories] = await db.execute(
        `SELECT id, owner, repository_name
         FROM repositories
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Repository not found in your account.",
        });
      }

      const repository = repositories[0];

      // 2. Prepare GitHub API headers.
      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "risk-aware-cicd-project",
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization =
          `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      // 3. Fetch the latest 30 GitHub Actions workflow runs.
      let runs;

      try {
        const response = await axios.get(
          `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository_name)}/actions/runs`,
          {
            headers,
            params: {
              per_page: 30,
              page: 1,
            },
            timeout: 15000,
          }
        );

        runs = response.data.workflow_runs || [];
      } catch (githubError) {
        const status = githubError.response?.status;

        if (status === 404) {
          return res.status(404).json({
            success: false,
            message:
              "GitHub repository or Actions information was not found or is inaccessible.",
          });
        }

        if (
          status === 401 ||
          status === 403 ||
          status === 429
        ) {
          return res.status(502).json({
            success: false,
            message:
              "GitHub denied the request or imposed a rate limit. Check repository permissions and try again.",
          });
        }

        if (
          githubError.code === "ECONNABORTED" ||
          githubError.code === "ETIMEDOUT"
        ) {
          return res.status(504).json({
            success: false,
            message: "GitHub request timed out.",
          });
        }

        console.error(
          "GitHub workflow request error:",
          githubError.message
        );

        return res.status(502).json({
          success: false,
          message: "Unable to retrieve GitHub workflow runs.",
        });
      }

      // 4. Map pull requests only where GitHub provides
      // exactly one associated PR and that PR is already stored.
      const [savedPullRequests] = await db.execute(
        `SELECT id, github_pr_number
         FROM pull_requests
         WHERE repository_id = ?`,
        [repositoryId]
      );

      const prIdByNumber = new Map(
        savedPullRequests.map((pr) => [
          Number(pr.github_pr_number),
          pr.id,
        ])
      );

      // 5. Save the workflow runs in a transaction.
      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        for (const run of runs) {
          let pullRequestId = null;

          if (
            Array.isArray(run.pull_requests) &&
            run.pull_requests.length === 1
          ) {
            const prNumber = Number(
              run.pull_requests[0].number
            );

            pullRequestId =
              prIdByNumber.get(prNumber) || null;
          }

          const startedAt =
            run.run_started_at || run.created_at;

          const completedAt =
            run.status === "completed"
              ? run.updated_at || null
              : null;

          await connection.execute(
            `INSERT INTO workflow_runs (
              repository_id,
              github_run_id,
              pull_request_id,
              workflow_name,
              event_name,
              status,
              conclusion,
              html_url,
              started_at,
              completed_at,
              last_synced_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
              pull_request_id =
                COALESCE(VALUES(pull_request_id), pull_request_id),
              workflow_name = VALUES(workflow_name),
              event_name = VALUES(event_name),
              status = VALUES(status),
              conclusion = VALUES(conclusion),
              html_url = VALUES(html_url),
              started_at = VALUES(started_at),
              completed_at = VALUES(completed_at),
              last_synced_at = CURRENT_TIMESTAMP`,
            [
              repositoryId,
              run.id,
              pullRequestId,
              run.name || "Unnamed workflow",
              run.event || null,
              run.status || "unknown",
              run.conclusion || null,
              run.html_url || null,
              startedAt ? new Date(startedAt) : null,
              completedAt ? new Date(completedAt) : null,
            ]
          );
        }

        await connection.commit();
      } catch (databaseError) {
        await connection.rollback();
        throw databaseError;
      } finally {
        connection.release();
      }

      // 6. Return the workflow data saved for this repository.
      const [workflowRuns] = await db.execute(
        `SELECT
           id,
           github_run_id AS githubRunId,
           pull_request_id AS pullRequestId,
           workflow_name AS workflowName,
           event_name AS eventName,
           status,
           conclusion,
           html_url AS htmlUrl,
           started_at AS startedAt,
           completed_at AS completedAt
         FROM workflow_runs
         WHERE repository_id = ?
         ORDER BY started_at DESC
         LIMIT 30`,
        [repositoryId]
      );

      return res.status(200).json({
        success: true,
        message: runs.length
          ? "GitHub workflow runs synchronized successfully."
          : "No workflow runs were returned by GitHub.",
        repository:
          `${repository.owner}/${repository.repository_name}`,
        syncedCount: runs.length,
        workflowRuns,
      });
    } catch (error) {
      console.error(
        "Workflow synchronization error:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message: "Unable to save workflow information.",
      });
    }
  }
);


router.post(
  "/:repositoryId/workflows/:githubRunId/sync-jobs",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const githubRunId = Number(req.params.githubRunId);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      !Number.isSafeInteger(githubRunId) ||
      githubRunId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID or GitHub workflow run ID.",
      });
    }

    try {
      // Verify that this workflow run belongs to the
      // repository connected by the authenticated user.
      const [rows] = await db.execute(
        `SELECT
           r.owner,
           r.repository_name AS repositoryName,
           wr.id AS workflowRunId,
           wr.github_run_id AS githubRunId
         FROM repositories r
         JOIN workflow_runs wr
           ON wr.repository_id = r.id
         WHERE r.id = ?
           AND r.user_id = ?
           AND wr.github_run_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub, githubRunId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Workflow run not found in your connected repository. Synchronize workflow runs first.",
        });
      }

      const workflow = rows[0];

      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "risk-aware-cicd-project",
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization =
          `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      // Retrieve job information from GitHub.
      const jobs = [];
      let reachedJobLimit = false;

      try {
        for (let page = 1; page <= 10; page++) {
          const response = await axios.get(
            `https://api.github.com/repos/${encodeURIComponent(workflow.owner)}/${encodeURIComponent(workflow.repositoryName)}/actions/runs/${githubRunId}/jobs`,
            {
              headers,
              params: {
                per_page: 100,
                page,
              },
              timeout: 15000,
            }
          );

          const batch = response.data.jobs || [];
          jobs.push(...batch);

          if (batch.length < 100) {
            break;
          }

          if (page === 10) {
            reachedJobLimit = true;
          }
        }
      } catch (githubError) {
        const status = githubError.response?.status;

        if (status === 404) {
          return res.status(404).json({
            success: false,
            message:
              "GitHub workflow run was not found or is inaccessible.",
          });
        }

        if (
          status === 401 ||
          status === 403 ||
          status === 429
        ) {
          return res.status(502).json({
            success: false,
            message:
              "GitHub denied the request or imposed a rate limit.",
          });
        }

        if (
          githubError.code === "ECONNABORTED" ||
          githubError.code === "ETIMEDOUT"
        ) {
          return res.status(504).json({
            success: false,
            message: "GitHub job request timed out.",
          });
        }

        console.error(
          "GitHub job request error:",
          githubError.message
        );

        return res.status(502).json({
          success: false,
          message: "Unable to retrieve workflow jobs.",
        });
      }

      // Extract failed step names without saving full logs.
      const jobsToSave = jobs.map((job) => {
        const failedSteps = (job.steps || [])
          .filter((step) => step.conclusion === "failure")
          .map((step) => step.name)
          .slice(0, 20);

        return {
          githubJobId: job.id,
          name: job.name || "Unnamed job",
          status: job.status || "unknown",
          conclusion: job.conclusion || null,
          failedStepSummary:
            failedSteps.join("; ").slice(0, 2000) || null,
        };
      });

      // Store jobs using a transaction.
      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        for (const job of jobsToSave) {
          await connection.execute(
            `INSERT INTO workflow_jobs (
               workflow_run_id,
               github_job_id,
               job_name,
               status,
               conclusion,
               failed_step_summary,
               diagnosis_category,
               sanitized_log_excerpt
             )
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
             ON DUPLICATE KEY UPDATE
               workflow_run_id = VALUES(workflow_run_id),
               job_name = VALUES(job_name),
               status = VALUES(status),
               conclusion = VALUES(conclusion),
               failed_step_summary = VALUES(failed_step_summary)`,
            [
              workflow.workflowRunId,
              job.githubJobId,
              job.name,
              job.status,
              job.conclusion,
              job.failedStepSummary,
            ]
          );
        }

        await connection.commit();
      } catch (databaseError) {
        await connection.rollback();
        throw databaseError;
      } finally {
        connection.release();
      }

      return res.status(200).json({
        success: true,
        message: "Workflow jobs synchronized successfully.",
        repository:
          `${workflow.owner}/${workflow.repositoryName}`,
        githubRunId,
        syncedCount: jobsToSave.length,
        reachedJobLimit,
        jobs: jobsToSave.map((job) => ({
          name: job.name,
          status: job.status,
          conclusion: job.conclusion,
          failedStepSummary: job.failedStepSummary,
        })),
      });
    } catch (error) {
      console.error("Workflow job sync error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to save workflow jobs.",
      });
    }
  }
);


router.post(
  "/:repositoryId/workflows/:githubRunId/diagnose-failures",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const githubRunId = Number(req.params.githubRunId);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      !Number.isSafeInteger(githubRunId) ||
      githubRunId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository or workflow run ID.",
      });
    }

    try {
      // Confirm the workflow belongs to this user's repository.
      const [runRows] = await db.execute(
        `SELECT
           r.owner,
           r.repository_name AS repositoryName,
           wr.id AS workflowRunDbId,
           wr.github_run_id AS githubRunId
         FROM repositories r
         JOIN workflow_runs wr
           ON wr.repository_id = r.id
         WHERE r.id = ?
           AND r.user_id = ?
           AND wr.github_run_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub, githubRunId]
      );

      if (runRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Workflow run not found in your account.",
        });
      }

      const workflow = runRows[0];

      // Load jobs that were previously synchronized.
      const [allJobs] = await db.execute(
        `SELECT
           id,
           github_job_id AS githubJobId,
           job_name AS jobName,
           status,
           conclusion,
           failed_step_summary AS failedStepSummary,
           sanitized_log_excerpt AS savedLogExcerpt
         FROM workflow_jobs
         WHERE workflow_run_id = ?
         ORDER BY github_job_id`,
        [workflow.workflowRunDbId]
      );

      if (allJobs.length === 0) {
        return res.status(409).json({
          success: false,
          message:
            "No jobs are stored for this workflow. Synchronize the jobs first.",
        });
      }

      const failedJobs = allJobs.filter((job) =>
        ["failure", "timed_out"].includes(
          String(job.conclusion || "").toLowerCase()
        )
      );

      if (failedJobs.length === 0) {
        return res.status(200).json({
          success: true,
          message:
            "No failed or timed-out jobs were found in the stored workflow data.",
          repository:
            `${workflow.owner}/${workflow.repositoryName}`,
          githubRunId,
          diagnosedCount: 0,
          jobs: [],
        });
      }

      // Limit external log downloads per request.
      const jobsToDiagnose = failedJobs.slice(0, 10);

      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "risk-aware-cicd-project",
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization =
          `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const diagnoses = [];

      for (const job of jobsToDiagnose) {
        let sanitizedExcerpt = null;
        let logAvailable = false;
        let logSource = null;
        let diagnosis;

        try {
          // GitHub redirects this request to a temporary plain-text
          // job-log download URL.
          const response = await axios.get(
            `https://api.github.com/repos/${encodeURIComponent(workflow.owner)}/${encodeURIComponent(workflow.repositoryName)}/actions/jobs/${job.githubJobId}/logs`,
            {
              headers,
              responseType: "text",
              timeout: 20000,
              maxRedirects: 5,
              maxContentLength: 2 * 1024 * 1024,
              maxBodyLength: 2 * 1024 * 1024,
            }
          );

          const rawLog = String(response.data || "");

          if (/^\s*(?:<!doctype html|<html)/i.test(rawLog)) {
            throw new Error("Log response was not plain text.");
          }

          sanitizedExcerpt = sanitizeLog(rawLog);

          if (sanitizedExcerpt.trim()) {
            logAvailable = true;
            logSource = "github";
            diagnosis = diagnoseLog(sanitizedExcerpt);
          } else {
            diagnosis = diagnoseLog("");
          }
        } catch (logError) {
          const status = logError.response?.status;

          // Use previously saved sanitized evidence if a fresh download
          // is unavailable.
          if (job.savedLogExcerpt?.trim()) {
            sanitizedExcerpt = job.savedLogExcerpt;
            logAvailable = true;
            logSource = "stored_excerpt";
            diagnosis = diagnoseLog(sanitizedExcerpt);
          } else {
            let explanation =
              "The job logs could not be downloaded. They may be unavailable, expired, or inaccessible.";

            if (status === 401 || status === 403) {
              explanation =
                "GitHub denied access to the job logs.";
            } else if (status === 404) {
              explanation =
                "GitHub could not find accessible logs for this job.";
            } else if (
              logError.code === "ECONNABORTED" ||
              logError.code === "ETIMEDOUT"
            ) {
              explanation =
                "The job-log download timed out.";
            } else if (
              /maxContentLength|maxBodyLength|larger than/i.test(
                logError.message || ""
              )
            ) {
              explanation =
                "The job-log response exceeded the 2 MB download limit.";
            }

            diagnosis = {
              category: "logs_unavailable",
              confidence: "low",
              evidence: null,
              explanation,
              recommendedAction:
                "Open the workflow run in GitHub and check log availability, retention, network access, and Actions read permissions.",
            };
          }
        }

        // Store only sanitized log excerpts and the diagnostic category.
        await db.execute(
          `UPDATE workflow_jobs
           SET sanitized_log_excerpt =
                 COALESCE(?, sanitized_log_excerpt),
               diagnosis_category = ?
           WHERE id = ?
             AND workflow_run_id = ?`,
          [
            sanitizedExcerpt,
            diagnosis.category,
            job.id,
            workflow.workflowRunDbId,
          ]
        );

        diagnoses.push({
          githubJobId: job.githubJobId,
          jobName: job.jobName,
          status: job.status,
          conclusion: job.conclusion,
          failedStepSummary: job.failedStepSummary,
          logAvailable,
          logSource,
          diagnosis,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Failure diagnosis completed.",
        repository:
          `${workflow.owner}/${workflow.repositoryName}`,
        githubRunId,
        diagnosedCount: diagnoses.length,
        additionalFailedJobsNotProcessed:
          Math.max(0, failedJobs.length - jobsToDiagnose.length),
        jobs: diagnoses,
      });
    } catch (error) {
      console.error("Failure diagnosis error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to complete failure diagnosis.",
      });
    }
  }
);


router.post(
  "/:repositoryId/pull-requests/:prNumber/analyze-risk",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const prNumber = Number(req.params.prNumber);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      !Number.isSafeInteger(prNumber) ||
      prNumber < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID or pull-request number.",
      });
    }

    try {
      // Verify that the pull request belongs to this user's repository.
      const [rows] = await db.execute(
        `SELECT
           r.id AS repositoryId,
           r.owner,
           r.repository_name AS repositoryName,
           pr.id AS pullRequestId,
           pr.github_pr_number AS prNumber,
           pr.title,
           pr.additions,
           pr.deletions,
           pr.changed_files_count
         FROM repositories r
         JOIN pull_requests pr
           ON pr.repository_id = r.id
         WHERE r.id = ?
           AND r.user_id = ?
           AND pr.github_pr_number = ?
         LIMIT 1`,
        [repositoryId, req.user.sub, prNumber]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Pull request not found in your connected repository.",
        });
      }

      const pullRequest = rows[0];

      // Load the actual changed-file records already synchronized
      // from GitHub. Empty results remain explicitly acknowledged.
      const [files] = await db.execute(
        `SELECT filename, additions, deletions
         FROM changed_files
         WHERE pull_request_id = ?`,
        [pullRequest.pullRequestId]
      );

      const analysis = calculateRiskScore(pullRequest, files);

      // Save the result and its contributing factors.
      const [insertResult] = await db.execute(
        `INSERT INTO risk_analyses (
           pull_request_id,
           score,
           risk_level,
           analysis_method,
           contributing_factors,
           failure_probability
         )
         VALUES (?, ?, ?, ?, ?, NULL)`,
        [
          pullRequest.pullRequestId,
          analysis.score,
          analysis.riskLevel,
          analysis.analysisMethod,
          JSON.stringify(analysis.factors),
        ]
      );

      return res.status(201).json({
        success: true,
        message: "Risk analysis completed and saved.",
        repository:
          `${pullRequest.owner}/${pullRequest.repositoryName}`,
        pullRequest: {
          number: pullRequest.prNumber,
          title: pullRequest.title,
        },
        analysis: {
          id: insertResult.insertId,
          score: analysis.score,
          riskLevel: analysis.riskLevel,
          method: analysis.analysisMethod,
          failureProbability: null,
          analyzedFileCount: files.length,
          factors: analysis.factors,
          limitations: analysis.limitations,
        },
      });
    } catch (error) {
      console.error("Risk analysis error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to calculate or save the risk analysis.",
      });
    }
  }
);


/* Record a dependency between two pull requests. */
// router.post(
//   "/:repositoryId/dependencies",
//   authenticateToken,
//   async (req, res) => {
//     const repositoryId = Number(req.params.repositoryId);
//     const prerequisiteNumber = Number(
//       req.body?.prerequisitePrNumber
//     );
//     const dependentNumber = Number(req.body?.dependentPrNumber);

//     if (
//       !Number.isSafeInteger(repositoryId) ||
//       repositoryId < 1 ||
//       !Number.isSafeInteger(prerequisiteNumber) ||
//       prerequisiteNumber < 1 ||
//       !Number.isSafeInteger(dependentNumber) ||
//       dependentNumber < 1 ||
//       prerequisiteNumber === dependentNumber
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Provide a valid repository ID and two different pull-request numbers.",
//       });
//     }

//     try {
//       const [repositories] = await db.execute(
//         `SELECT id FROM repositories
//          WHERE id = ? AND user_id = ?
//          LIMIT 1`,
//         [repositoryId, req.user.sub]
//       );

//       if (repositories.length === 0) {
//         return res.status(404).json({
//           success: false,
//           message: "Repository not found in your account.",
//         });
//       }

//       const [pullRequests] = await db.execute(
//         `SELECT id, github_pr_number
//          FROM pull_requests
//          WHERE repository_id = ?
//            AND github_pr_number IN (?, ?)`,
//         [repositoryId, prerequisiteNumber, dependentNumber]
//       );

//       const prByNumber = new Map(
//         pullRequests.map((pr) => [
//           Number(pr.github_pr_number),
//           pr,
//         ])
//       );

//       const prerequisite = prByNumber.get(prerequisiteNumber);
//       const dependent = prByNumber.get(dependentNumber);

//       if (!prerequisite || !dependent) {
//         return res.status(404).json({
//           success: false,
//           message:
//             "Both pull requests must exist in this connected repository. Synchronize pull requests first.",
//         });
//       }

//       await db.execute(
//         `INSERT INTO pull_request_dependencies (
//            prerequisite_pull_request_id,
//            dependent_pull_request_id,
//            source
//          )
//          VALUES (?, ?, 'user')`,
//         [prerequisite.id, dependent.id]
//       );

//       return res.status(201).json({
//         success: true,
//         message: "Pull-request dependency recorded.",
//         dependency: {
//           prerequisitePrNumber: prerequisiteNumber,
//           dependentPrNumber: dependentNumber,
//         },
//       });
//     } catch (error) {
//       if (error.code === "ER_DUP_ENTRY") {
//         return res.status(409).json({
//           success: false,
//           message: "This dependency already exists.",
//         });
//       }

//       console.error("Create dependency error:", error.message);

//       return res.status(500).json({
//         success: false,
//         message: "Unable to record dependency.",
//       });
//     }
//   }
// );



router.post(
  "/:repositoryId/dependencies",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const userId = Number(req.user?.sub);

    const prerequisiteNumber = Number(
      req.body?.prerequisitePrNumber
    );

    const dependentNumber = Number(
      req.body?.dependentPrNumber
    );

    // 1. Validate request data
    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId <= 0 ||
      !Number.isSafeInteger(prerequisiteNumber) ||
      prerequisiteNumber <= 0 ||
      !Number.isSafeInteger(dependentNumber) ||
      dependentNumber <= 0 ||
      prerequisiteNumber === dependentNumber
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provide a valid repository ID and two different pull-request numbers.",
      });
    }

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Valid authenticated user ID was not found.",
      });
    }

    try {
      // 2. Verify repository ownership
      const [repositories] = await db.execute(
        `SELECT id
         FROM repositories
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [repositoryId, userId]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Repository not found in your account.",
        });
      }

      // 3. Find both pull requests using GitHub PR numbers
      const [pullRequests] = await db.execute(
        `SELECT id, github_pr_number
         FROM pull_requests
         WHERE repository_id = ?
           AND github_pr_number IN (?, ?)`,
        [repositoryId, prerequisiteNumber, dependentNumber]
      );

      const prByNumber = new Map(
        pullRequests.map((pr) => [
          Number(pr.github_pr_number),
          pr,
        ])
      );

      const prerequisite = prByNumber.get(prerequisiteNumber);
      const dependent = prByNumber.get(dependentNumber);

      if (!prerequisite || !dependent) {
        return res.status(404).json({
          success: false,
          message:
            "Both pull requests must exist in this connected repository. Synchronize pull requests first.",
        });
      }

      const prerequisiteId = Number(prerequisite.id);
      const dependentId = Number(dependent.id);

      if (prerequisiteId === dependentId) {
        return res.status(400).json({
          success: false,
          message:
            "The prerequisite and dependent pull requests must be different.",
        });
      }

      // 4. Load existing dependency relationships from MySQL
      const [existingEdges] = await db.execute(
        `SELECT
           d.prerequisite_pull_request_id AS prerequisite_id,
           d.dependent_pull_request_id AS dependent_id
         FROM pull_request_dependencies AS d
         INNER JOIN pull_requests AS p1
           ON p1.id = d.prerequisite_pull_request_id
         INNER JOIN pull_requests AS p2
           ON p2.id = d.dependent_pull_request_id
         WHERE p1.repository_id = ?
           AND p2.repository_id = ?`,
        [repositoryId, repositoryId]
      );

      // 5. Build the dependency graph.
      // A -> B means A must come before B.
      const graph = new Map();

      for (const edge of existingEdges) {
        const from = Number(edge.prerequisite_id);
        const to = Number(edge.dependent_id);

        if (!graph.has(from)) {
          graph.set(from, []);
        }

        graph.get(from).push(to);
      }

      // 6. Check whether dependent can already reach prerequisite.
      // If so, adding prerequisite -> dependent would create a cycle.
      const stack = [dependentId];
      const visited = new Set();
      let createsCycle = false;

      while (stack.length > 0) {
        const current = stack.pop();

        if (current === prerequisiteId) {
          createsCycle = true;
          break;
        }

        if (visited.has(current)) {
          continue;
        }

        visited.add(current);

        for (const next of graph.get(current) || []) {
          if (!visited.has(next)) {
            stack.push(next);
          }
        }
      }

      // 7. Reject the cycle BEFORE inserting anything into MySQL.
      if (createsCycle) {
        return res.status(409).json({
          success: false,
          message:
            "This dependency would create a circular dependency. Choose a different relationship.",
        });
      }

      // 8. Save only a valid dependency
      const [result] = await db.execute(
        `INSERT INTO pull_request_dependencies (
           prerequisite_pull_request_id,
           dependent_pull_request_id,
           source
         )
         VALUES (?, ?, 'user')`,
        [prerequisiteId, dependentId]
      );

      return res.status(201).json({
        success: true,
        message: "Pull-request dependency recorded.",
        dependency: {
          id: result.insertId,
          prerequisitePrNumber: prerequisiteNumber,
          dependentPrNumber: dependentNumber,
        },
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "This dependency already exists.",
        });
      }

      console.error("Create dependency error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to record dependency.",
      });
    }
  }
);


/* Remove a dependency recorded for this repository. */
router.delete(
  "/:repositoryId/dependencies/:dependencyId",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const dependencyId = Number(req.params.dependencyId);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      !Number.isSafeInteger(dependencyId) ||
      dependencyId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository or dependency ID.",
      });
    }

    try {
      const [result] = await db.execute(
        `DELETE d
         FROM pull_request_dependencies d
         JOIN pull_requests dependent
           ON dependent.id = d.dependent_pull_request_id
         JOIN repositories r
           ON r.id = dependent.repository_id
         WHERE d.id = ?
           AND r.id = ?
           AND r.user_id = ?`,
        [dependencyId, repositoryId, req.user.sub]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Dependency not found in your repository.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Dependency removed successfully.",
      });
    } catch (error) {
      console.error("Delete dependency error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to remove dependency.",
      });
    }
  }
);


/* Calculate a dependency-aware validation order. */
router.get(
  "/:repositoryId/recommended-order",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID.",
      });
    }

    try {
      const [repositories] = await db.execute(
        `SELECT id, owner, repository_name
         FROM repositories
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Repository not found in your account.",
        });
      }

      // Fetch pull requests with their most recent saved risk analysis.
      const [pullRequests] = await db.execute(
        `SELECT
           pr.id,
           pr.github_pr_number,
           pr.title,
           pr.state,
           pr.github_created_at,
           ra.score AS latest_risk_score,
           ra.risk_level AS latest_risk_level
         FROM pull_requests pr
         LEFT JOIN risk_analyses ra
           ON ra.id = (
             SELECT ra2.id
             FROM risk_analyses ra2
             WHERE ra2.pull_request_id = pr.id
             ORDER BY ra2.created_at DESC, ra2.id DESC
             LIMIT 1
           )
         WHERE pr.repository_id = ?`,
        [repositoryId]
      );

      // Include prerequisite PR numbers for useful blocked-item messages.
      const [dependencies] = await db.execute(
        `SELECT
           d.prerequisite_pull_request_id,
           d.dependent_pull_request_id,
           prerequisite.github_pr_number
             AS prerequisite_pr_number
         FROM pull_request_dependencies d
         JOIN pull_requests dependent
           ON dependent.id = d.dependent_pull_request_id
         LEFT JOIN pull_requests prerequisite
           ON prerequisite.id = d.prerequisite_pull_request_id
         WHERE dependent.repository_id = ?`,
        [repositoryId]
      );

      const result = recommendSequence(
        pullRequests,
        dependencies
      );

      // Baseline: open pull requests sorted by creation time,
      // with PR number as a deterministic tie-breaker.
      const arrivalOrderBaseline = pullRequests
        .filter(
          (pr) => String(pr.state).toLowerCase() === "open"
        )
        .sort((a, b) => {
          const aTime = a.github_created_at
            ? new Date(a.github_created_at).getTime()
            : Number.MAX_SAFE_INTEGER;

          const bTime = b.github_created_at
            ? new Date(b.github_created_at).getTime()
            : Number.MAX_SAFE_INTEGER;

          return (
            aTime - bTime ||
            Number(a.github_pr_number) -
              Number(b.github_pr_number)
          );
        })
        .map((pr) => ({
          prNumber: Number(pr.github_pr_number),
          title: pr.title,
        }));

      return res.status(200).json({
        success: true,
        message: result.message,
        repository:
          `${repositories[0].owner}/${repositories[0].repository_name}`,
        recommendedOrder: result.recommendedOrder,
        blockedItems: result.blockedItems,
        cycleDetected: result.cycleDetected,
        unsequencedItems: result.unsequencedItems,
        arrivalOrderBaseline,
        limitations: [
          "The order is a validation recommendation, not an automatic merge instruction.",
          "Closed prerequisites must be verified before dependent changes proceed.",
          "The baseline compares creation order, not measured development outcomes.",
        ],
      });
    } catch (error) {
      console.error("Recommended-order error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to calculate the recommended order.",
      });
    }
  }
);



router.get("/", authenticateToken, async (req, res) => {
  try {
    const [repositories] = await db.execute(
      `SELECT
         id,
         owner,
         repository_name AS repositoryName,
         default_branch AS defaultBranch,
         created_at AS createdAt
       FROM repositories
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.sub]
    );

    return res.status(200).json({
      success: true,
      repositories,
    });
  } catch (error) {
    console.error("List repositories error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve repositories.",
    });
  }
});



router.get(
  "/:id/pull-requests",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.id);
    const state = req.query.state || "all";

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID.",
      });
    }

    if (!["open", "closed", "all"].includes(state)) {
      return res.status(400).json({
        success: false,
        message: "State must be open, closed, or all.",
      });
    }

    try {
      let sql = `
        SELECT
          pr.id,
          pr.github_pr_number AS number,
          pr.title,
          pr.state,
          pr.author,
          pr.head_branch AS headBranch,
          pr.base_branch AS baseBranch,
          pr.additions,
          pr.deletions,
          pr.changed_files_count AS changedFiles,
          pr.github_url AS githubUrl,
          pr.github_created_at AS createdAt,
          ra.score AS riskScore,
          ra.risk_level AS riskLevel
        FROM pull_requests pr
        JOIN repositories r
          ON r.id = pr.repository_id
        LEFT JOIN risk_analyses ra
          ON ra.id = (
            SELECT ra2.id
            FROM risk_analyses ra2
            WHERE ra2.pull_request_id = pr.id
            ORDER BY ra2.created_at DESC, ra2.id DESC
            LIMIT 1
          )
        WHERE r.id = ?
          AND r.user_id = ?
      `;

      const params = [repositoryId, req.user.sub];

      if (state !== "all") {
        sql += " AND pr.state = ?";
        params.push(state);
      }

      sql += " ORDER BY pr.github_created_at DESC LIMIT 100";

      const [pullRequests] = await db.execute(sql, params);

      return res.status(200).json({
        success: true,
        count: pullRequests.length,
        pullRequests,
      });
    } catch (error) {
      console.error("List pull requests error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve pull requests.",
      });
    }
  }
);



router.get(
  "/:id/workflows",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.id);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository ID.",
      });
    }

    try {
      // Verify that the repository belongs to the logged-in user.
      const [repositories] = await db.execute(
        `SELECT id, owner, repository_name
         FROM repositories
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Repository not found in your account.",
        });
      }

      // Retrieve stored workflow runs and their saved job counts.
      const [workflowRuns] = await db.execute(
        `SELECT
           wr.id,
           wr.github_run_id AS githubRunId,
           wr.workflow_name AS workflowName,
           wr.event_name AS eventName,
           wr.status,
           wr.conclusion,
           wr.html_url AS htmlUrl,
           wr.started_at AS startedAt,
           wr.completed_at AS completedAt,
           (
             SELECT COUNT(*)
             FROM workflow_jobs wj
             WHERE wj.workflow_run_id = wr.id
           ) AS jobCount
         FROM workflow_runs wr
         WHERE wr.repository_id = ?
         ORDER BY wr.started_at DESC, wr.id DESC
         LIMIT 100`,
        [repositoryId]
      );

      return res.status(200).json({
        success: true,
        repository:
          `${repositories[0].owner}/${repositories[0].repository_name}`,
        count: workflowRuns.length,
        workflowRuns,
      });
    } catch (error) {
      console.error("List workflow runs error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve workflow runs.",
      });
    }
  }
);


router.get(
  "/:repositoryId/workflows/:githubRunId/jobs",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const githubRunId = Number(req.params.githubRunId);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId < 1 ||
      !Number.isSafeInteger(githubRunId) ||
      githubRunId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid repository or workflow run ID.",
      });
    }

    try {
      // Verify ownership before returning job or log information.
      const [runs] = await db.execute(
        `SELECT
           r.owner,
           r.repository_name AS repositoryName,
           wr.id AS workflowRunDbId,
           wr.github_run_id AS githubRunId,
           wr.workflow_name AS workflowName
         FROM repositories r
         JOIN workflow_runs wr
           ON wr.repository_id = r.id
         WHERE r.id = ?
           AND r.user_id = ?
           AND wr.github_run_id = ?
         LIMIT 1`,
        [repositoryId, req.user.sub, githubRunId]
      );

      if (runs.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Workflow run not found in your account.",
        });
      }

      const workflow = runs[0];

      const [rows] = await db.execute(
        `SELECT
           id,
           github_job_id AS githubJobId,
           job_name AS jobName,
           status,
           conclusion,
           failed_step_summary AS failedStepSummary,
           diagnosis_category AS diagnosisCategory,
           sanitized_log_excerpt AS sanitizedLogExcerpt
         FROM workflow_jobs
         WHERE workflow_run_id = ?
         ORDER BY job_name`,
        [workflow.workflowRunDbId]
      );

      const jobs = rows.map((job) => {
        let diagnosis = null;

        if (job.diagnosisCategory === "logs_unavailable") {
          diagnosis = {
            category: "logs_unavailable",
            confidence: "low",
            evidence: null,
            explanation:
              "Logs could not be retrieved or were inaccessible during diagnosis.",
            recommendedAction:
              "Open the workflow run on GitHub and check log availability, retention, and Actions read permissions.",
          };
        } else if (job.diagnosisCategory) {
          diagnosis = diagnoseLog(job.sanitizedLogExcerpt || "");

          // Preserve the category saved by the diagnosis operation.
          diagnosis.category = job.diagnosisCategory;
        }

        return {
          id: job.id,
          githubJobId: job.githubJobId,
          jobName: job.jobName,
          status: job.status,
          conclusion: job.conclusion,
          failedStepSummary: job.failedStepSummary,
          diagnosis,
          logAvailable: Boolean(job.sanitizedLogExcerpt),
          // Return only a short, already-sanitized display excerpt.
          logExcerpt: job.sanitizedLogExcerpt
            ? job.sanitizedLogExcerpt.slice(-800)
            : null,
        };
      });

      return res.status(200).json({
        success: true,
        repository: `${workflow.owner}/${workflow.repositoryName}`,
        workflow: {
          githubRunId: workflow.githubRunId,
          workflowName: workflow.workflowName,
        },
        count: jobs.length,
        jobs,
      });
    } catch (error) {
      console.error("Read workflow jobs error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve workflow job results.",
      });
    }
  }
);


// Get risk-analysis history for a repository
router.get(
  "/:repositoryId/analysis-history",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);

    const authenticatedUserId = Number(req.user?.sub);
    
    if (
      !Number.isSafeInteger(authenticatedUserId) ||
      authenticatedUserId <= 0
    ) {
      return res.status(401).json({
        message: "Valid authenticated user ID was not found",
      });
    }

    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
      return res.status(400).json({
        message: "Invalid repository ID",
      });
    }

    try {
      // Verify that this repository belongs to the logged-in user
      const [repositories] = await db.execute(
        `SELECT id
         FROM repositories
         WHERE id = ? AND user_id = ?`,
         [repositoryId, authenticatedUserId]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          message: "Repository not found",
        });
      }

      // Retrieve previous risk analyses for this repository
      const [history] = await db.execute(
        `SELECT
           ra.id AS analysis_id,
           ra.pull_request_id,
           ra.score,
           ra.risk_level,
           ra.analysis_method,
           ra.contributing_factors,
           ra.failure_probability,
           ra.created_at,
           pr.github_pr_number,
           pr.title AS pull_request_title,
           pr.state AS pull_request_state,
           pr.github_url
         FROM risk_analyses AS ra
         INNER JOIN pull_requests AS pr
           ON pr.id = ra.pull_request_id
         WHERE pr.repository_id = ?
         ORDER BY ra.created_at DESC, ra.id DESC
         LIMIT 200`,
        [repositoryId]
      );

      return res.json({ history });
    }  catch (error) {
      console.error("Error loading analysis history:", error);
    
      return res.status(500).json({
        message: "Failed to load analysis history",
        detail: error.message,
        code: error.code || null,
      });
    }
  }
);


// List dependencies for a repository
router.post(
  "/:repositoryId/dependencies",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const userId = Number(req.user?.sub);

    const prerequisitePrNumber = Number(
      req.body?.prerequisitePrNumber
    );

    const dependentPrNumber = Number(
      req.body?.dependentPrNumber
    );

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId <= 0 ||
      !Number.isSafeInteger(prerequisitePrNumber) ||
      prerequisitePrNumber <= 0 ||
      !Number.isSafeInteger(dependentPrNumber) ||
      dependentPrNumber <= 0 ||
      prerequisitePrNumber === dependentPrNumber
    ) {
      return res.status(400).json({
        message:
          "Provide a valid repository ID and two different pull-request numbers.",
      });
    }

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        message: "Valid authenticated user ID was not found.",
      });
    }

    try {
      // Verify the repository belongs to the authenticated user.
      const [repositories] = await db.execute(
        `SELECT id
         FROM repositories
         WHERE id = ? AND user_id = ?`,
        [repositoryId, userId]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          message: "Repository not found.",
        });
      }

      // Convert GitHub PR numbers to local MySQL pull-request IDs.
      const [pullRequests] = await db.execute(
        `SELECT id, github_pr_number
         FROM pull_requests
         WHERE repository_id = ?
           AND github_pr_number IN (?, ?)`,
        [
          repositoryId,
          prerequisitePrNumber,
          dependentPrNumber,
        ]
      );

      const prerequisitePR = pullRequests.find(
        (pr) =>
          Number(pr.github_pr_number) === prerequisitePrNumber
      );

      const dependentPR = pullRequests.find(
        (pr) =>
          Number(pr.github_pr_number) === dependentPrNumber
      );

      if (!prerequisitePR || !dependentPR) {
        return res.status(404).json({
          message:
            "Both pull requests must exist in the selected repository. Sync pull requests and try again.",
        });
      }

      if (prerequisitePR.id === dependentPR.id) {
        return res.status(400).json({
          message:
            "The prerequisite and dependent pull requests must be different.",
        });
      }

// Prevent circular dependencies
// An edge A -> B means A must come before B.
const [existingEdges] = await db.execute(
  `SELECT
     d.prerequisite_pull_request_id AS prerequisite_id,
     d.dependent_pull_request_id AS dependent_id
   FROM pull_request_dependencies AS d
   INNER JOIN pull_requests AS p1
     ON p1.id = d.prerequisite_pull_request_id
   INNER JOIN pull_requests AS p2
     ON p2.id = d.dependent_pull_request_id
   WHERE p1.repository_id = ?
     AND p2.repository_id = ?`,
  [repositoryId, repositoryId]
);

// Build a graph from dependencies already saved in MySQL.
const graph = new Map();

for (const edge of existingEdges) {
  const from = Number(edge.prerequisite_id);
  const to = Number(edge.dependent_id);

  if (!graph.has(from)) {
    graph.set(from, []);
  }

  graph.get(from).push(to);
}

// Before adding prerequisite -> dependent,
// check whether dependent can already reach prerequisite.
const stack = [Number(dependentPR.id)];
const visited = new Set();
let createsCycle = false;

while (stack.length > 0) {
  const current = stack.pop();

  if (current === Number(prerequisitePR.id)) {
    createsCycle = true;
    break;
  }

  if (visited.has(current)) {
    continue;
  }

  visited.add(current);

  for (const next of graph.get(current) || []) {
    if (!visited.has(next)) {
      stack.push(next);
    }
  }
}

if (createsCycle) {
  return res.status(409).json({
    message:
      "This dependency would create a circular dependency. Choose a different relationship.",
  });
}      

      // Store the local pull_requests.id foreign keys.
      const [result] = await db.execute(
        `INSERT INTO pull_request_dependencies
           (prerequisite_pull_request_id,
            dependent_pull_request_id,
            source)
         VALUES (?, ?, ?)`,
        [
          prerequisitePR.id,
          dependentPR.id,
          "manual",
        ]
      );

      return res.status(201).json({
        message: "Dependency created successfully.",
        dependencyId: result.insertId,
        prerequisitePrNumber,
        dependentPrNumber,
      });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "This dependency already exists.",
        });
      }

      console.error("Error creating dependency:", error);

      return res.status(500).json({
        message: "Failed to create dependency.",
      });
    }
  }
);


// Get dependencies for a repository
router.get(
  "/:repositoryId/dependencies",
  authenticateToken,
  async (req, res) => {
    const repositoryId = Number(req.params.repositoryId);
    const userId = Number(req.user?.sub);

    if (
      !Number.isSafeInteger(repositoryId) ||
      repositoryId <= 0 ||
      !Number.isSafeInteger(userId) ||
      userId <= 0
    ) {
      return res.status(400).json({
        message: "Invalid repository or user ID.",
      });
    }

    try {
      // Confirm the repository belongs to the logged-in user
      const [repositories] = await db.execute(
        `SELECT id
         FROM repositories
         WHERE id = ? AND user_id = ?`,
        [repositoryId, userId]
      );

      if (repositories.length === 0) {
        return res.status(404).json({
          message: "Repository not found.",
        });
      }

      // Retrieve saved dependency relationships
      const [dependencies] = await db.execute(
        `SELECT
           d.id AS dependency_id,
           d.source,
           d.created_at,
           prerequisite.id AS prerequisite_pull_request_id,
           prerequisite.github_pr_number AS prerequisite_pr_number,
           prerequisite.title AS prerequisite_title,
           dependent.id AS dependent_pull_request_id,
           dependent.github_pr_number AS dependent_pr_number,
           dependent.title AS dependent_title
         FROM pull_request_dependencies AS d
         INNER JOIN pull_requests AS prerequisite
           ON prerequisite.id = d.prerequisite_pull_request_id
         INNER JOIN pull_requests AS dependent
           ON dependent.id = d.dependent_pull_request_id
         WHERE prerequisite.repository_id = ?
           AND dependent.repository_id = ?
         ORDER BY d.created_at DESC, d.id DESC`,
        [repositoryId, repositoryId]
      );

      return res.json({
        success: true,
        dependencies,
      });
    } catch (error) {
      console.error("Error loading dependencies:", error);

      return res.status(500).json({
        message: "Failed to load dependencies.",
      });
    }
  }
);

module.exports = router;
