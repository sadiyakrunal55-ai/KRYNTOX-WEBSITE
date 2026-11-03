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
      message: error.message
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

    const data = await request.json();
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
      "@cf/meta/llama-3.1-8b-instruct",
      {
        messages: [
          {
            role: "system",
            content: `
You are COMMANDER AI, the strategy and coordination
assistant for KRYNTOX HQ.

Analyze the user's task and create a practical action plan.

The KRYNTOX team has 8 specialist roles:
1. COMMANDER AI - strategy and coordination
2. SECURITYZ+ - cybersecurity
3. DEVELOPER PRO - software engineering
4. DESIGNER X - creative design
5. RESEARCH NEXUS - research
6. MARKETING TITAN - marketing
7. CLIENT HUNTER X - sales intelligence
8. SUPPORT GENIUS - customer support

Return:
1. Task understanding
2. Recommended agent assignments
3. Step-by-step action plan
4. Expected result
5. Risks or missing information

Be honest. Do not claim that an agent performed an
action unless it actually happened.
Do not contact customers or perform external actions.
Respond clearly and practically.
`
          },
          {
            role: "user",
            content: task
          }
        ],
        max_tokens: 900,
        temperature: 0.4
      }
    );

    const resultText =
      answer.response ||
      answer.result?.response ||
      JSON.stringify(answer);

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
      } catch (dbError) {}
    }

    return json({
      success: false,
      taskId: id,
      message: error.message || "AI execution failed"
    }, 500);
  }
}
