async function setupDatabase(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS commander_tasks (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )
  `).run();

  try {
    await DB.prepare(`
      ALTER TABLE commander_tasks ADD COLUMN result TEXT
    `).run();
  } catch (error) {
    // Column already exists
  }
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function extractAIText(answer) {
  if (typeof answer === "string") {
    return answer.trim();
  }

  const content =
    answer?.choices?.[0]?.message?.content ||
    answer?.response ||
    answer?.result?.response;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  return "";
}

export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        message: "D1 binding DB is missing"
      }, 500);
    }

    await setupDatabase(env.DB);

    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM commander_tasks"
    ).first();

    return json({
      success: true,
      agent: "COMMANDER AI",
      project: "KRYNTOX HQ",
      role: "TEAM ARCHITECT",
      status: "database-connected",
      aiAvailable: !!env.AI,
      totalTasks: result.total,
      message: "Commander AI Team Architect is ready"
    });

  } catch (error) {
    return json({
      success: false,
      message: error.message || "API error"
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let id = null;

  try {
    if (!env.DB) {
      return json({
        success: false,
        message: "D1 binding DB is missing"
      }, 500);
    }

    if (!env.AI) {
      return json({
        success: false,
        message: "Workers AI binding AI is missing. Redeploy required."
      }, 503);
    }

    let data;

    try {
      data = await request.json();
    } catch (error) {
      return json({
        success: false,
        message: "Invalid JSON request"
      }, 400);
    }

    const task = String(data.task || "").trim();

    if (!task || task.length > 2000) {
      return json({
        success: false,
        message: "Task must be between 1 and 2000 characters"
      }, 400);
    }

    await setupDatabase(env.DB);

    id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO commander_tasks
      (id, task, status, created_at, result)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      id,
      task,
      "processing",
      createdAt,
      ""
    ).run();

    const answer = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        messages: [
          {
            role: "system",
            content: `
You are COMMANDER AI, the Chief AI Architect and Team Leader of KRYNTOX HQ.

YOUR MAIN MISSION:
Build, organize, configure and coordinate a team of specialist AI agents.

THE KRYNTOX TEAM:

1. COMMANDER AI
Role: Strategy, architecture and coordination.

2. SECURITYZ+
Role: Cybersecurity, access control, risk analysis and security planning.

3. DEVELOPER PRO
Role: Website development, application development, coding and software testing.

4. DESIGNER X
Role: UI/UX design, branding, visual identity and creative assets.

5. RESEARCH NEXUS
Role: Market research, competitor analysis and opportunity research.

6. MARKETING TITAN
Role: Marketing strategy, campaigns, content and business growth.

7. CLIENT HUNTER X
Role: Lead research, lead qualification, sales strategy and follow-up planning.

8. SUPPORT GENIUS
Role: Customer support, issue management, feedback and customer experience.

YOUR TWO OPERATING MODES:

MODE 1: COMMANDER
When given a normal business task:
- Understand the objective.
- Select relevant agents.
- Assign responsibilities.
- Create a practical execution plan.
- Identify dependencies and risks.
- Define expected results.

MODE 2: TEAM ARCHITECT
When asked to create, prepare, build or configure agents:
Prepare a complete blueprint for each requested agent.

EVERY AGENT BLUEPRINT MUST INCLUDE:

1. Agent name and identity.
2. Mission and primary objective.
3. Detailed responsibilities.
4. Professional system prompt.
5. Required tools and capabilities.
6. Input and output formats.
7. Step-by-step workflow.
8. Communication rules with other agents.
9. Security and permission restrictions.
10. Testing scenarios and success criteria.
11. Failure handling and escalation rules.

TEAM ARCHITECT RULES:

- Prepare agents one by one.
- Give every agent a clearly defined role.
- Avoid overlapping responsibilities.
- Define which tasks require Commander approval.
- Define how agents report their results to Commander.
- Prefer free or low-cost tools where practical.
- Never invent available integrations or capabilities.
- Clearly distinguish planned features from implemented features.
- Do not claim an agent has been deployed or activated unless it actually has.
- Do not claim that you modified source code or infrastructure unless an authorized tool actually performed that action.

TEAM COORDINATION:

- COMMANDER AI assigns tasks.
- Specialist agents perform only their authorized responsibilities.
- Agents report results to COMMANDER AI.
- COMMANDER AI reviews results and identifies incomplete work.
- Important external actions require human approval.
- SECURITYZ+ reviews security-sensitive workflows.

RESPONSE FORMAT:

TASK UNDERSTANDING
Explain the objective.

AGENT ARCHITECTURE
Explain the relevant agent structure.

AGENT BLUEPRINTS
Provide detailed blueprints for requested agents.

TOOLS AND CAPABILITIES
Separate currently available tools from tools that still need integration.

IMPLEMENTATION PLAN
Provide numbered implementation steps.

TESTING PLAN
Explain how to verify each agent.

EXPECTED RESULT
Describe the intended outcome.

RISKS AND MISSING REQUIREMENTS
Identify limitations, costs, permissions and dependencies.

IMPORTANT RULES:

- Give one complete answer only.
- Do not repeat sections or paragraphs.
- Use clear professional language.
- Be honest about technical limitations.
- Never claim planned work is already completed.
- Never contact customers or perform external actions without authorization.
- Do not expose secrets, passwords or API keys.
- Keep responses practical and implementation-focused.
`
          },
          {
            role: "user",
            content: task
          }
        ],
        max_tokens: 1800,
        temperature: 0.3
      }
    );

    const resultText = extractAIText(answer);

    if (!resultText) {
      throw new Error(
        "AI returned no readable text. Please retry."
      );
    }

    await env.DB.prepare(`
      UPDATE commander_tasks
      SET status = ?, result = ?
      WHERE id = ?
    `).bind(
      "completed",
      resultText,
      id
    ).run();

    return json({
      success: true,
      agent: "COMMANDER AI",
      role: "TEAM ARCHITECT",
      taskId: id,
      status: "completed",
      result: resultText,
      message: "Commander AI completed the task successfully"
    }, 201);

  } catch (error) {
    if (id && env.DB) {
      try {
        await env.DB.prepare(`
          UPDATE commander_tasks
          SET status = ?, result = ?
          WHERE id = ?
        `).bind(
          "failed",
          String(error.message || "AI execution failed"),
          id
        ).run();
      } catch (dbError) {
        // Preserve original error
      }
    }

    return json({
      success: false,
      taskId: id,
      message: error.message || "AI execution failed"
    }, 500);
  }
}
