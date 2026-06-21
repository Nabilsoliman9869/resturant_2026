import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const sessionId = "table-slides-slow";
const port = 7788;
const outDir = ".dbg";
const logFile = `${outDir}/trae-debug-log-${sessionId}.ndjson`;

mkdirSync(outDir, { recursive: true });
writeFileSync(
  `${outDir}/${sessionId}.env`,
  `DEBUG_SERVER_URL=http://127.0.0.1:${port}/event\nDEBUG_SESSION_ID=${sessionId}\n`,
  "utf8",
);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true, sessionId, port }));
    return;
  }
  if (req.method === "POST" && req.url === "/event") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        appendFileSync(logFile, `${JSON.stringify(parsed)}\n`, "utf8");
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ ok: false }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`collector listening http://127.0.0.1:${port}\n`);
});
