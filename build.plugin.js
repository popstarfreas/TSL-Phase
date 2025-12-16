import fs from "node:fs";
import child_process from "node:child_process";

child_process.execSync("pnpm i", { stdio: "inherit" })
child_process.execSync("pnpm remove terrariaserver-lite", { stdio: "inherit" })
child_process.execSync("pnpm add ../../pluginreference", { stdio: "inherit" })
child_process.execSync("pnpm build", { stdio: "inherit" })
fs.renameSync("./build", "./plugin")
fs.renameSync("./node_modules", "./plugin/node_modules")
