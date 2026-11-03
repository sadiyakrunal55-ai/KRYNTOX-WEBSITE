
const OWNER = "sadiyakrunal55-ai";
const REPO = "KRYNTOX-WEBSITE";
const BRANCH = "command-center-dev";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet({ env }) {
  try {
    const token = env.GITHUB_TOKEN;

    if (!token) {
      return json({
        success: false,
        agent: "SECURITYZ+",
        status: "not-connected",
        message: "GITHUB_TOKEN secret is missing in this environment."
      }, 503);
    }

    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const repoResponse = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}`,
      { headers }
    );

    if (!repoResponse.ok) {
      return json({
        success: false,
        agent: "SECURITYZ+",
        status: "github-connection-failed",
        githubStatus: repoResponse.status,
        message: "GitHub repository access could not be verified."
      }, 502);
    }

    const repo = await repoResponse.json();

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
        message: "Repository connected, but preview branch could not be verified."
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
      permissions: "Read-only",
      commit: branch.commit.sha,
      message: "GitHub read-only connection verified successfully."
    });

  } catch (error) {
    return json({
      success: false,
      agent: "SECURITYZ+",
      status: "connection-error",
      message: error.message || "Unexpected connection error."
    }, 500);
  }
}
