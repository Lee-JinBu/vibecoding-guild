import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const messagesDirectory = fileURLToPath(new URL("../messages/", import.meta.url));
const files = await readdir(messagesDirectory);
const messageFiles = files.filter((file) => file.endsWith(".md") && !file.startsWith("_"));
for (const file of messageFiles) {
  const content = await readFile(join(messagesDirectory, file), "utf8");
  if (!content.trim()) throw new Error(`${file} 不能为空`);
}
console.log(`留言校验通过：${messageFiles.length} 条正式留言。`);
