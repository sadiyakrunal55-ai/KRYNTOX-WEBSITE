async function setupDatabase(DB) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS commander_tasks (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )
  `).run();
}

export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return Response.json({
        success: false,
        message: "D1 database binding DB is missing"
      }, { status: 500 });
    }

    await setupDatabase(env.DB);

    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM commander_tasks"
    ).first();

    return Response.json({
      success: true,
      agent: "COMMANDER AI",
      project: "KRYNTOX HQ",
      status: "database-connected",
      totalTasks: result.total,
      message: "Commander API is working"
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Database connection failed"
    }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return Response.json({
        success: false,
        message: "Database binding missing"
      }, { status: 500 });
    }

    const data = await request.json();
    const task = String(data.task || "").trim();

    if (!task || task.length > 2000) {
      return Response.json({
        success: false,
        message: "Task must be between 1 and 2000 characters"
      }, { status: 400 });
    }

    await setupDatabase(env.DB);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO commander_tasks
      (id, task, status, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(id, task, "pending", createdAt).run();

    return Response.json({
      success: true,
      agent: "COMMANDER AI",
      taskId: id,
      status: "pending",
      message: "Task saved successfully"
    }, { status: 201 });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Unable to save task"
    }, { status: 500 });
  }
}
