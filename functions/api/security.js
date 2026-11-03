const OWNER = "sadiyakrunal55-ai";
const REPO = "KRYNTOX-WEBSITE";
const BRANCH = "command-center-dev";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ env }) {
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return json({
      success: false,
      agent: "SECURITYZ+",
      status: "secret-missing",
      checks: {
        tokenAvailable: false,
        github: "not-tested",
        repository: "not-tested",
        branch: "not-tested"
      },
      message: "GITHUB_TOKEN is not available to this deployment."
    }, 503);
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}`,
      { headers }
    );

    if (!response.ok) {
      return json({
        success: false,
        agent: "SECURITYZ+",
        status: "github-api-error",
        githubStatus: response.status,
        checks: {
          tokenAvailable: true,
          github: "failed",
          repository: "not-verified",
          branch: "not-tested"
        },
        message: "GitHub API rejected the request."
      }, 502);
    }

    const repo = await response.json();

    const branchResponse = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/branches/${BRANCH}`,
      { headers }
    );

    if (!branchResponse.ok) {
      return json({
        success: false,
        agent: "SECURITYZ+",
        status: "branch-check-failed",
        githubStatus: branchResponse.status,
        checks: {
          tokenAvailable: true,
          github: "connected",
          repository: "verified",
          branch: "failed"
        },
        message: "Repository connected, but preview branch check failed."
      }, 502);
    }

    const branch = await branchResponse.json();

    return json({
      success: true,
      agent: "SECURITYZ+",
      status: "github-connected",
      repository: `${OWNER}/${REPO}`,
      branch: BRANCH,
      branchVerified: true,
      defaultBranch: repo.default_branch,
      commit: branch.commit.sha,
      checks: {
        tokenAvailable: true,
        github: "connected",
        repository: "verified",
        branch: "verified"
      },
      message: "SECURITYZ+ GitHub connection verified."
    });

  } catch (error) {
    return json({
      success: false,
      agent: "SECURITYZ+",
      status: "request-error",
      message: "GitHub verification request failed."
    }, 500);
  }
}
