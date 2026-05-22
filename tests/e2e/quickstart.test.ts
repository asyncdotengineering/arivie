/* SPDX-License-Identifier: Apache-2.0 */
/**
 * RFC §9.3.8 — Puppeteer quickstart: documented UI path returns streamed mock answer.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  QUICKSTART_BASE_URL,
  QUICKSTART_OWNER_ID,
  QUICKSTART_PORT,
  dockerAvailable,
  startQuickstartPostgres,
  stopQuickstartPostgres,
  type QuickstartPostgres,
} from "./quickstart.setup.js";

const MOCK_SUBSTRING = "Example mock response";
const CANNED_QUESTION = "How many customers?";

function bodyContainsMockAnswer(body: string): boolean {
  if (body.includes(MOCK_SUBSTRING)) {
    return true;
  }
  const dataLines = body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"));
  for (const line of dataLines) {
    const payload = line.slice(6);
    try {
      if (JSON.stringify(JSON.parse(payload)).includes(MOCK_SUBSTRING)) {
        return true;
      }
    } catch {
      if (payload.includes(MOCK_SUBSTRING)) {
        return true;
      }
    }
  }
  return body.includes('"modelProvider":"mock"');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = join(__dirname, "../../examples/with-nextjs");

const describeQuickstart = describe.skipIf(!dockerAvailable());

describeQuickstart.sequential("Quickstart e2e (RFC §9.3.8)", () => {
  let pg: QuickstartPostgres | undefined;
  let devProcess: ChildProcess | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  const transcript: string[] = [];

  beforeAll(async () => {
    pg = await startQuickstartPostgres();
    transcript.push(`Postgres: ${pg.databaseUrl}`);

    devProcess = spawn("pnpm", ["exec", "next", "dev", "-p", String(QUICKSTART_PORT)], {
      cwd: EXAMPLE_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: pg.databaseUrl,
        ARIVIE_OWNER_ID: QUICKSTART_OWNER_ID,
        ARIVIE_AUTH_BYPASS: "1",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    devProcess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      if (line.includes("Error") || line.includes("error")) {
        transcript.push(`next stderr: ${line.trim()}`);
      }
    });

    await waitForServerReady();
    transcript.push(`Dev server ready at ${QUICKSTART_BASE_URL}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    page = await browser.newPage();
  }, 600_000);

  afterAll(async () => {
    if (browser != null) {
      await browser.close();
    }
    if (devProcess != null && !devProcess.killed) {
      devProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        devProcess?.on("exit", () => resolve());
        setTimeout(() => {
          if (devProcess != null && !devProcess.killed) {
            devProcess.kill("SIGKILL");
          }
          resolve();
        }, 10_000);
      });
    }
    await stopQuickstartPostgres(pg);
  }, 120_000);

  it(
    "submits a canned question and receives the mock streamed answer",
    async () => {
      if (page == null) {
        throw new Error("Puppeteer page not initialized");
      }

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          transcript.push(`browser console error: ${msg.text()}`);
        }
      });

      await page.goto(QUICKSTART_BASE_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });

      const inputSelector = 'input[placeholder*="Ask a question"]';
      await page.waitForSelector(inputSelector, { timeout: 60_000 });
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('button[aria-label="Send"]');
          return btn instanceof HTMLButtonElement && !btn.disabled;
        },
        { timeout: 60_000 },
      );
      await page.type(inputSelector, CANNED_QUESTION, { delay: 40 });

      const responsePromise = page.waitForResponse(
        (res) =>
          res.url().includes("/api/arivie") && res.request().method() === "POST",
        { timeout: 120_000 },
      );
      await page.keyboard.press("Enter");
      const apiResponse = await responsePromise;
      const responseBody = await apiResponse.text();
      transcript.push(`POST status: ${apiResponse.status()}`);
      expect(apiResponse.status()).toBe(200);
      transcript.push(`Stream body snippet: ${responseBody.slice(0, 240)}`);
      expect(bodyContainsMockAnswer(responseBody)).toBe(true);

      const jsonAnswer = await page.evaluate(async (question) => {
        const res = await fetch("/api/arivie", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ prompt: question }),
        });
        const payload = (await res.json()) as { answer?: string };
        return payload.answer ?? "";
      }, CANNED_QUESTION);
      expect(jsonAnswer).toContain(MOCK_SUBSTRING);

      await page.waitForFunction(
        (question) => document.body.innerText.includes(question),
        { timeout: 30_000 },
        CANNED_QUESTION,
      );

      const logText = await page.evaluate(() => document.body.innerText);
      expect(logText).toContain(CANNED_QUESTION);
      transcript.push(`Question: ${CANNED_QUESTION}`);
      transcript.push(`Mock substring in JSON answer: ${jsonAnswer.includes(MOCK_SUBSTRING)}`);
      transcript.push(
        `Stream matched: ${responseBody.includes(MOCK_SUBSTRING) ? MOCK_SUBSTRING : "modelProvider:mock"}`,
      );
      console.log(transcript.join("\n"));
    },
    600_000,
  );
});

async function waitForServerReady(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(QUICKSTART_BASE_URL, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.status < 500) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Next.js not ready at ${QUICKSTART_BASE_URL}`);
}
