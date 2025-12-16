import fs from "node:fs";
import child_process from "node:child_process";

console.log("Running `pnpm i`")
child_process.execSync("pnpm i", { stdio: "inherit" })
console.log("Running `pnpm remove terrariaserver-lite`")
child_process.execSync("pnpm remove terrariaserver-lite", { stdio: "inherit" })
console.log("Running `pnpm add ../../pluginreference`")
child_process.execSync("pnpm add ../../pluginreference", { stdio: "inherit" })
console.log("Running `pnpm build`")
child_process.execSync("pnpm build", { stdio: "inherit" })
console.log("Running `bash ./deploy.sh`")
child_process.execSync("bash ./deploy.sh", { stdio: "inherit" })
console.log("Renaming build to plugin")
fs.renameSync("./build", "./plugin")
console.log("Renaming node_modules to plugin/node_modules")
fs.renameSync("./out/node_modules", "./plugin/node_modules")
