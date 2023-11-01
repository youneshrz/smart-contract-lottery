const { network } = require("hardhat");
const { developmentChains } = require("../halper-hardhat-config");
const BASE_FEE = ethers.utils.parseEther("0.25"); // 0.25 is the premuim. it costs 0.25 link per requiest
const gas_PRICE_LINK = 1e9; //link per gas .calculated value  based on the gas price of the chain.

module.exports = async function({ getNamedAccounts, deployments }) {
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();
  const args = [BASE_FEE, gas_PRICE_LINK];

  if (developmentChains.includes(network.name)) {
    log("LocalNetwork detected! Deploy mocks... ");
    //deploy a mock vrfcoordinator../
    await deploy("VRFCoordinatorV2Mock", {
      from: deployer,
      log: true,
      args: args,
    });
    log("Mocks Deployed!");
    log(
      "______________________________________________________________________________"
    );
  }
};
module.exports.tags = ["all", "mocks"];
