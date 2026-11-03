
export async function onRequestGet() {
  return Response.json({
    agent: "COMMANDER AI",
    project: "KRYNTOX HQ",
    status: "backend-online",
    mode: "test",
    message: "Commander API is responding.",
    agentsConnected: 0
  });
}
