import { spawn } from "node:child_process";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const env = { ...process.env, DEMO_MODE: "true", NEXT_PUBLIC_DEMO_MODE: "true" };
const next = spawn(process.execPath, ["../../node_modules/next/dist/bin/next", "dev"], {
  cwd: new URL("..", import.meta.url),
  env,
  stdio: ["ignore", "ignore", "ignore"],
  shell: false
});

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    const ok = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:3000", (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await delay(1000);
  }
  throw new Error("Next dev server did not start on http://127.0.0.1:3000");
}

function stopServer() {
  if (next.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(next.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    next.kill("SIGTERM");
  }
}

try {
  await waitForServer();
  const args = ["../../node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)];
  const test = spawn(process.execPath, args, {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: "inherit",
    shell: false
  });
  const code = await new Promise((resolve) => test.on("exit", resolve));
  stopServer();
  process.exit(code ?? 1);
} catch (error) {
  stopServer();
  console.error(error);
  process.exit(1);
}
