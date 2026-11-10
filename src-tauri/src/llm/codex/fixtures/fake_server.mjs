import readline from "node:readline";
let sequence = 0;
let activeConfig = {};
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const event = (method, params) => send({ method, params });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params } = request;
  const reply = (result) => send({ id, result });
  if (method === "initialize") {
    reply({ userAgent: "Fake Codex" });
  } else if (method === "mcpServerStatus/list") {
    reply({ data: [{ name: "fake_server", tools: params.threadId && process.env.NEXQ_FAKE_MCP_LEAK ? { leaked: {} } : {} }], nextCursor: null });
  } else if (method === "thread/start") {
    if (process.env.NEXQ_FAKE_STOP_DURING_PREPARATION) {
      process.exit(0);
    }
    if (!params.ephemeral || params.sandbox !== "read-only" || params.approvalPolicy !== "never" || params.config?.mcp_servers?.fake_server?.enabled !== false) {
      send({ id, error: { message: "unsafe thread parameters" } });
      return;
    }
    activeConfig = params.config;
    reply({ thread: { id: `thread-${++sequence}` } });
  } else if (method === "turn/start") {
    if (params.serviceTierForTurn === "priority" && activeConfig["features.fast_mode"] !== true) {
      send({ id, error: { message: "Fast feature was not enabled for this explicit boost request" } });
      return;
    }
    const threadId = params.threadId;
    const turnId = `turn-${sequence}`;
    const text = params.input[0].text;
    reply({ turn: { id: turnId, status: "inProgress" } });
    if (text.includes("HANG")) {
      return;
    }
    if (text.includes("MALFORMED")) {
      process.stdout.write("invalid-json\n");
      return;
    }
    if (text.includes("EOF")) {
      process.exit(0);
    }
    if (text.includes("RECONNECT_UPSTREAM")) {
      event("error", { threadId, turnId, willRetry: true, error: { message: "upstream connection lost" } });
    }
    if (text.includes("TOOL")) {
      event("item/started", { threadId, turnId, item: { type: "commandExecution" } });
      return;
    }
    if (text.includes("FAIL")) {
      event("turn/completed", { threadId, turn: { id: turnId, status: "failed", error: { message: "private-image-data", codexErrorInfo: "usageLimitExceeded" } } });
      return;
    }
    event("item/agentMessage/delta", { threadId: "other", turnId, delta: "wrong thread" });
    event("item/agentMessage/delta", { threadId, turnId: "old", delta: "late old answer" });
    if (!text.includes("EMPTY")) {
      event("item/agentMessage/delta", { threadId, turnId, delta: `answer-${sequence}` });
    }
    event("thread/tokenUsage/updated", { threadId, tokenUsage: { last: { inputTokens: 10, outputTokens: 3, totalTokens: 13 } } });
    event("turn/completed", { threadId, turn: { id: turnId, status: "completed", error: null } });
  } else if (method === "thread/unsubscribe") {
    reply({});
  } else if (id !== undefined) {
    send({ id, error: { message: "unsupported fake request" } });
  }
});
