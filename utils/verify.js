const { run } = require("hardhat");
async function verify(contractAddress, args) {
  console.log("Verifying contract...");
  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: args,
    });
  } catch (e) {
    if (e.message.toLowerCase().includes("aleardy verified")) {
      console.log("Already Verfied !");
    } else {
      console.log(e);
    }
  }
}
module.exports = { verify };
