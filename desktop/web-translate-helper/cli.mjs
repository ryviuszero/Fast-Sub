import { parseAndTranslate } from "./helper.mjs";

const chunks = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  const response = await parseAndTranslate(chunks.join(""));
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
