
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
      status: "database-connected",
      aiAvailable: !!env.AI,
      totalTasks: result.total,
      message: "Commander AI API is ready"
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
        message: "Database binding DB is missing"
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
You are COMMANDER AI, the strategy and coordination leader of KRYNTOX HQ.

Your team has 8 specialist agents:

1. COMMANDER AI - Strategy and coordination
2. SECURITYZ+ - Cybersecurity
3. DEVELOPER PRO - Software engineering
4. DESIGNER X - Creative design
5. RESEARCH NEXUS - Market research
6. MARKETING TITAN - Marketing
7. CLIENT HUNTER X - Sales intelligence
8. SUPPORT GENIUS - Customer support

YOUR RESPONSIBILITIES:

- Understand the task carefully.
- Select only the relevant specialist agents.
- Give each selected agent a clear responsibility.
- Create a practical step-by-step execution plan.
- Identify risks and missing information.
- Define the expected result.

RESPONSE FORMAT:

TASK UNDERSTANDING
Explain the task in 2-3 sentences.

AGENT ASSIGNMENTS
List the relevant agents and their responsibilities.

ACTION PLAN
Give numbered practical steps.

EXPECTED RESULT
Explain the intended outcome.

RISKS AND MISSING INFORMATION
List important risks and unknowns.

IMPORTANT RULES:

- Give one complete answer only.
- Do not repeat sections or paragraphs.
- Be concise, professional and practical.
- Never invent completed actions or results.
- Do not claim another agent has executed a task.
- You can plan and assign work, but cannot independently execute external actions.
- Do not contact customers or make commitments.
- If information is missing, clearly state what is needed.
- Return readable text, not JSON.
`
          },
          {
            role: "user",
            content: task
          }
        ],
        max_tokens: 1200,
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
      taskId: id,
      status: "completed",
      result: resultText,
      message: "AI analyzed the task successfully"
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
        // Preserve the original error
      }
    }

    return json({
      success: false,
      taskId: id,
      message: error.message || "AI execution failed"
    }, 500);
  }
}
