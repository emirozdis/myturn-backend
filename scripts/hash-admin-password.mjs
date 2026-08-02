import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 310_000;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error("Run this script in an interactive terminal."));
      return;
    }

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";

    const onData = (character) => {
      if (character === "\u0003") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        reject(new Error("Cancelled."));
        return;
      }
      if (character === "\r" || character === "\n") {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (character === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += character;
    };
    process.stdin.on("data", onData);
  });
}

try {
  const password = await readHidden("Admin password: ");
  if (password.length < 14) throw new Error("Use an admin password with at least 14 characters.");
  const salt = randomBytes(24);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 64, "sha512");
  process.stdout.write(`ADMIN_PASSWORD_HASH="pbkdf2_sha512:${ITERATIONS}:${salt.toString("base64url")}:${hash.toString("base64url")}"\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unable to hash password."}\n`);
  process.exitCode = 1;
}
