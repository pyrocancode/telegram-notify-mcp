function jsonRpcError(status, message) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function checkAuth(request) {
  const secret = process.env.MCP_SECRET;
  if (!secret) {
    return { ok: false, status: 503, message: "MCP_SECRET is not configured" };
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}

async function toRequest(req) {
  const host = req.headers.host ?? "localhost";
  const url = `https://${host}${req.url ?? "/api/mcp"}`;
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});
  }
  return new Request(url, { method: req.method, headers: req.headers, body });
}

async function sendResponse(res, response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(buffer);
}

module.exports = async (req, res) => {
  try {
    const { WebStandardStreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
    );
    const { createMcpServer } = await import("../src/server.js");

    async function handleMcp(request) {
      const auth = checkAuth(request);
      if (!auth.ok) return jsonRpcError(auth.status, auth.message);
      if (request.method !== "POST") {
        return jsonRpcError(405, "Method not allowed.");
      }

      const server = createMcpServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      try {
        await server.connect(transport);
        return await transport.handleRequest(request);
      } catch (error) {
        console.error("MCP error:", error);
        return jsonRpcError(500, "Internal server error");
      } finally {
        transport.close();
        server.close();
      }
    }

    const request = req instanceof Request ? req : await toRequest(req);
    await sendResponse(res, await handleMcp(request));
  } catch (error) {
    console.error("Handler error:", error);
    res.status(500).json({ error: String(error) });
  }
};
