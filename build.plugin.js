var fs = require("fs");
var child_process = require("child_process");

child_process.execSync("npm i ../../pluginreference")
child_process.execSync("npm run build")
fs.renameSync("./build", "./plugin")
