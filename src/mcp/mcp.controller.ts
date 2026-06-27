import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkMcpAuth } from "./mcp-auth";
import { createMcpServer } from "./create-mcp-server";

function jsonRpcError(status: number, message: string) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function readBody(req: ExpressRequest): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(undefined);
  if (req.body !== undefined) {
    return Promise.resolve(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
    );
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function toWebRequest(req: ExpressRequest): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = `https://${host}${req.url ?? "/api/mcp"}`;
  const body = await readBody(req);
  return new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body,
  });
}

async function pipeWebResponse(res: ExpressResponse, webRes: Response) {
  const buffer = Buffer.from(await webRes.arrayBuffer());
  const headers: Record<string, string | number> = {};
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(webRes.status, headers);
  res.end(buffer);
}

@Controller("api")
export class McpController {
  @All("mcp")
  async handle(@Req() req: ExpressRequest, @Res() res: ExpressResponse) {
    try {
      const auth = checkMcpAuth(req);
      if (!auth.ok) {
        await pipeWebResponse(res, jsonRpcError(auth.status, auth.message));
        return;
      }

      const webReq = await toWebRequest(req);
      if (webReq.method !== "POST") {
        await pipeWebResponse(res, jsonRpcError(405, "Method not allowed."));
        return;
      }

      const server = createMcpServer(auth.telegram);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      try {
        await server.connect(transport);
        const response = await transport.handleRequest(webReq);
        await pipeWebResponse(res, response);
      } finally {
        transport.close();
        server.close();
      }
    } catch (error) {
      console.error("MCP error:", error);
      await pipeWebResponse(res, jsonRpcError(500, "Internal server error"));
    }
  }
}
