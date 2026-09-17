import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Every <Collapsible id="x" ... /> needs a matching entry in
 * WORKSPACE_SECTIONS, or its open state is `undefined` rather than
 * true/false. Collapsible reads that as closed (`hidden={!open}`) and never
 * renders its children — the section exists in the bundle, passes every
 * other check, and shows nothing but a header with a MOSTRAR button. That
 * exact bug shipped three panels (INSTITUCIONAL, RESERVAS, LIQUIDACIONES) in
 * a row before anyone caught it, because checking that a panel's own strings
 * are present in the deployed bundle proves it was built, not that it
 * renders. This walks the actual source for every id the page tries to
 * render, the same check a human would have to do by hand otherwise.
 *
 * Both files contain JSX, which plain `node --test` can't parse (nothing in
 * this repo's test setup transforms it), so this reads them as text and
 * regex-matches rather than importing the modules — the same approach the
 * rest of this suite already uses for .tsx source.
 */

async function collapsibleIds(): Promise<string[]> {
  const source = await readFile(new URL("../app/radar-app.tsx", import.meta.url), "utf8");
  return [...source.matchAll(/<Collapsible\s+id="([a-z-]+)"/g)].map((m) => m[1]);
}

async function registeredIds(): Promise<string[]> {
  const source = await readFile(new URL("../app/workspace.tsx", import.meta.url), "utf8");
  const body = source.slice(
    source.indexOf("WORKSPACE_SECTIONS: WorkspaceSection[] = ["),
    source.indexOf("];", source.indexOf("WORKSPACE_SECTIONS: WorkspaceSection[] = [")),
  );
  return [...body.matchAll(/id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
}

test("every Collapsible section id is registered in WORKSPACE_SECTIONS", async () => {
  const ids = await collapsibleIds();
  assert.ok(ids.length >= 10, "se esperaban muchas secciones — algo cambió el marcado");

  const registered = new Set(await registeredIds());
  const missing = ids.filter((id) => !registered.has(id));
  assert.deepEqual(
    missing,
    [],
    `estos <Collapsible id=...> no tienen entrada en WORKSPACE_SECTIONS y van a renderizar vacíos: ${missing.join(", ")}`,
  );
});

test("WORKSPACE_SECTIONS has no id without a matching Collapsible to open", async () => {
  const rendered = new Set(await collapsibleIds());
  const orphaned = (await registeredIds()).filter((id) => !rendered.has(id));
  assert.deepEqual(
    orphaned,
    [],
    `WORKSPACE_SECTIONS registra secciones que ningún <Collapsible> usa: ${orphaned.join(", ")}`,
  );
});
