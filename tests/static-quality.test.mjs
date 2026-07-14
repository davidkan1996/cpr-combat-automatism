import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const main = readFileSync(new URL("../scripts/main.js", import.meta.url), "utf8");

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test("main script has no debug console logging", () => {
  assert.equal(/\bconsole\.log\s*\(/.test(main), false);
});

test("main script has no dynamic code execution or raw DOM HTML sinks", () => {
  const unsafePatterns = [
    "\\bev" + "al\\s*\\(",
    "\\bFun" + "ction\\s*\\(",
    "\\.inner" + "HTML\\s*=",
    "document\\.wr" + "ite\\s*\\(",
  ];
  assert.equal(new RegExp(unsafePatterns.join("|")).test(main), false);
});

test("simple messages escape content before rendering HTML", () => {
  assert.match(main, /const safeContent = escapeHtml\(content\);/);
  assert.equal(/\$\{content\}/.test(main), false);
});

test("socket receiver validates before dispatching handlers", () => {
  assert.match(main, /const trusted = await validateSocketMessage\(message\);/);
  assert.match(main, /SOCKET_MESSAGE_TYPES\.has\(message\.type\)/);
});

test("defender actions close the dialog directly", () => {
  assert.match(main, /await dialog\.close\(\);\s+await submitDefenderChoice\(data, action\);/);
  assert.equal(main.includes('find(".close").trigger("click")'), false);
});

test("templates do not opt out of Handlebars escaping", () => {
  const templates = filesUnder(join(root, "templates")).filter((path) => path.endsWith(".hbs"));
  for (const template of templates) {
    const source = readFileSync(template, "utf8");
    assert.equal(source.includes("{{{"), false, template);
  }
});
