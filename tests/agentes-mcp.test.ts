import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Ruflo (el MCP de los agentes) arranca código de terceros con `npx`. Lo que
 * lo hace aceptable es que esté fijado: una versión exacta, una fecha de corte
 * para todas sus dependencias y sin scripts de instalación. Estas pruebas
 * impiden que alguien lo suelte a `@latest` sin darse cuenta.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mcp = JSON.parse(read(".mcp.json")) as { mcpServers: Record<string, { command: string; args: string[] }> };
const settings = JSON.parse(read(".claude/settings.json")) as { env?: Record<string, string>; enabledMcpjsonServers?: string[] };

test("ruflo is one MCP server run with npx", () => {
  assert.deepEqual(Object.keys(mcp.mcpServers), ["ruflo"]);
  assert.equal(mcp.mcpServers.ruflo.command, "npx");
});

test("ruflo is pinned: exact version, cutoff date for its dependencies, no install scripts", () => {
  const args = mcp.mcpServers.ruflo.args;
  const pkg = args[args.indexOf("-p") + 1];
  assert.match(pkg, /^@claude-flow\/cli@\d+\.\d+\.\d+$/, "an exact version of the package that holds the code, not a range or a tag");
  assert.ok(!args.some((a) => /@latest|@\^|@~|@next|@alpha/.test(a)), "never a moving tag");
  assert.ok(args.includes("--ignore-scripts"), "no postinstall of third parties");
  const before = args.find((a) => a.startsWith("--before="));
  assert.match(before ?? "", /^--before=\d{4}-\d{2}-\d{2}$/, "dependencies only from before a fixed date");
  assert.deepEqual(args.slice(-3), ["claude-flow", "mcp", "start"]);
});

test("the project approves ruflo and gives the cold start time to download", () => {
  assert.deepEqual(settings.enabledMcpjsonServers, ["ruflo"], "approves only the server defined in .mcp.json");
  assert.ok(Number(settings.env?.MCP_TIMEOUT) >= 90_000, "the first start downloads the packages (about a minute)");
});

test("ruflo's local state is not committed and its init is warned against", () => {
  const ignored = read(".gitignore").split("\n");
  for (const dir of ["/.swarm/", "/.claude-flow/", "/ruvector.db*"]) assert.ok(ignored.includes(dir), `${dir} in .gitignore`);
  const rules = read("CLAUDE.md");
  assert.ok(rules.includes("## Agentes: Ruflo (MCP)"));
  assert.match(rules, /No correr `npx ruflo init`/);
});
