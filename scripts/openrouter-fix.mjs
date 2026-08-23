#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const exec = promisify(execFile);
const envFile = await readFile(".env", "utf8").catch(() => "");
for (const line of envFile.split("\n")) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?(.*?)["']?\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
const apiKey = process.env.OPENROUTER_API_KEY;
const maxRounds = Number(process.env.AI_FIX_ROUNDS || 3);
const model = process.env.OPENROUTER_MODEL || "stealth/ox-alpha";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const nextVersion = packageJson.dependencies?.next || "unknown";

const log = (message) => console.log(`[ai-repair] ${message}`);

if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY. Export it before running this script.");
  process.exit(1);
}

async function run(command, args) {
  try {
    const result = await exec(command, args, { maxBuffer: 8 * 1024 * 1024 });
    return `${result.stdout}\n${result.stderr}`.trim();
  } catch (error) {
    return `${error.stdout || ""}\n${error.stderr || error.message}`.trim();
  }
}

const projectFiles = (await run("git", ["ls-files", "--cached", "--others", "--exclude-standard"]))
  .split("\n")
  .filter(Boolean)
  .filter((file) => !/(^|\/)(node_modules|\.next|dist|build|\.git)(\/|$)/.test(file))
  .filter((file) => !/(^|\/)(\.env|\.env\.|.*\.pem$|.*\.key$)/.test(file));

log(`Found ${projectFiles.length} safe project files to inspect.`);

const files = [];
let totalChars = 0;
for (const file of projectFiles) {
  if (totalChars > 120000) break;
  if (!/\.(tsx?|jsx?|css|json|mjs|cjs)$/.test(file) || /package-lock\.json$/.test(file)) continue;
  try {
    const content = await readFile(file, "utf8");
    if (/\x00/.test(content)) continue;
    files.push({ file, content: content.slice(0, 30000) });
    totalChars += content.length;
  } catch {}
}

const issue = await readFile("openrouter-issue.txt", "utf8").catch(() => "Perform a broad UI and functionality audit of this project.");

const projectContext = files
  .map(({ file, content }) => `\n### ${file}\n\`\`\`\n${content}\n\`\`\``)
  .join("\n");

log(`Prepared ${files.length} files (${Math.round(totalChars / 1000)}k characters).`);

const prompt = `Act as the primary engineer for this Next.js project using React, TypeScript, Tailwind, and React Three Fiber.

The installed Next.js dependency is ${nextVersion}. Do not assume a different framework version.

Review the entire supplied project and fix the highest-impact UI and functionality problems. Focus on broken interactions, runtime errors, empty states, navigation, form behavior, responsiveness, accessibility, and visual consistency. Preserve the existing product direction and avoid unnecessary rewrites.

Issue and command output:
${issue}

Relevant source files:
${projectContext}

Instructions:
1. Inspect the source code and check output carefully.
2. Fix concrete problems, prioritizing the most important ones.
3. Preserve the existing visual style and public APIs.
4. Do not change package versions, add dependencies, or expose secrets.
5. Return ONLY a unified git diff, with no Markdown fences or explanation.
6. Every changed file must have a complete, syntactically valid patch. Never stop in the middle of a hunk or file.
7. If no safe improvement is justified, return NO_CHANGES.`;

for (let round = 1; round <= maxRounds; round += 1) {
  log(`Round ${round}/${maxRounds}: running local typecheck...`);
  const checks = await run("npm", ["run", "typecheck"]);
  log(`Round ${round}/${maxRounds}: running local production build...`);
  const build = await run("npm", ["run", "build"]);
  const currentDiff = await run("git", ["diff", "--stat"]);
  const roundPrompt = `${prompt}\n\nRound ${round}/${maxRounds}.\nTypecheck/build output:\n${checks}\n${build}\nCurrent changes:\n${currentDiff}`;

  log(`Round ${round}/${maxRounds}: sending project context to OpenRouter using ${model}...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost",
        "X-Title": process.env.OPENROUTER_TITLE || "Local Next.js repair assistant",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 12000,
        reasoning: { enabled: true, effort: "low", exclude: true },
        messages: [
          {
            role: "system",
            content: "You are a careful senior Next.js debugging engineer. Never make unrelated changes.",
          },
          { role: "user", content: roundPrompt },
        ],
      }),
    });
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? "request timed out after 120 seconds"
      : error?.message || String(error);
    console.error(`OpenRouter request failed: ${reason}`);
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }

  log(`Round ${round}/${maxRounds}: OpenRouter responded; processing proposal...`);
  let data;
  try {
    data = await response.json();
  } catch {
    console.error(`OpenRouter returned a non-JSON response (HTTP ${response.status}).`);
    process.exit(1);
  }
  await writeFile("openrouter-last-response.json", JSON.stringify(data, null, 2));
  if (!response.ok) {
    console.error(`OpenRouter request failed with HTTP ${response.status}.`);
    console.error(data?.error?.message || JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const choice = data.choices?.[0];
  const rawContent = choice?.message?.content;
  const rawAnswer = Array.isArray(rawContent)
    ? rawContent.map((part) => typeof part === "string" ? part : part?.text || "").join("").trim()
    : String(rawContent || "").trim();
  const answer = rawAnswer
    .replace(/^```(?:diff|patch)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  log(`Model finish reason: ${choice?.finish_reason || "unknown"}. Response length: ${answer.length} characters.`);
  if (answer === "NO_CHANGES") break;
  if (!answer.startsWith("diff --git") && !answer.startsWith("--- ")) {
    console.error("Model did not return a valid patch. Raw response saved to openrouter-last-response.json");
    console.error(answer || "(empty response)");
    process.exit(1);
  }
  if (/\.env(?:\.|$)|package-lock\.json|(^|\s)\.git\//.test(answer)) {
    console.error("Refusing a patch that touches environment, lockfile, or git metadata files.");
    process.exit(1);
  }
  await writeFile("openrouter-fix.patch", answer + "\n");
  log(`Round ${round}/${maxRounds}: validating patch locally...`);
  const check = await run("git", ["apply", "--check", "openrouter-fix.patch"]);
  if (check) {
    console.error("Patch validation failed:\n" + check);
    process.exit(1);
  }
  const applied = await run("git", ["apply", "openrouter-fix.patch"]);
  if (applied) {
    console.error("Patch application failed:\n" + applied);
    process.exit(1);
  }
  log(`Round ${round}/${maxRounds}: patch applied successfully.`);
}

log("Autonomous repair loop finished. Final verification is running now...");
log("Final typecheck: " + (await run("npm", ["run", "typecheck"])));
log("Final build: " + (await run("npm", ["run", "build"])));
log("Done. Review changes with: git diff");
