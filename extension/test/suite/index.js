const path = require("path");
const Mocha = require("mocha");
const fs = require("fs");

function run() {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 60000 });
  const suiteDir = __dirname;
  for (const file of fs.readdirSync(suiteDir)) {
    if (file.endsWith(".test.js")) {
      mocha.addFile(path.join(suiteDir, file));
    }
  }
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { run };
