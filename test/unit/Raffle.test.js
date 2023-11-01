const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../halper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Uint Tests", async function() {
      let raffle, VRFCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
      const chainId = network.config.chainId;
      beforeEach(async function() {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        raffle = await ethers.getContract("Raffle", deployer);
        raffleEntranceFee = await raffle.getEntranceFee();
        interval = await raffle.getInterval();
        VRFCoordinatorV2Mock = await ethers.getContract(
          "VRFCoordinatorV2Mock",
          deployer
        );
      });

      describe("Constractor", async function() {
        it("Initializes the raffle correctly", async function() {
          const raffleState = await raffle.getRaffleState();
          // const interval = await raffle.getInterval();
          assert.equal(raffleState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });

      describe("enterRaffle", async function() {
        it("reverts when you don't pay enough", async function() {
          await expect(raffle.enterRaffle()).to.be.revertedWith(
            "Raffle__NotEnoughEthEntered"
          );
        });
        it("records players when they enter", async function() {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          const playerFromContract = await raffle.getPlayer(0);
          assert.equal(playerFromContract, deployer);
        });
        it("emits event on enter", async function() {
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.emit(raffle, "RaffleEnter");
        });
        it("doesnt allow entrance when raffle is calculating", async function() {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          //we pretend to be a chainlink keeper
          await raffle.performUpkeep([]);
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.be.revertedWith("Raffle__NotOpen");
        });
      });

      describe("checkUpkeep", async function() {
        it("return false if people haven't send any ETH", async function() {
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });
        it("returns false if raffle isn't open", async function() {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          await raffle.performUpkeep([]);
          const raffleState = await raffle.getRaffleState();
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
          assert.equal(raffleState.toString(), "1");
          assert.equal(upkeepNeeded, false);
        });
        it("returns false if enough time hasn't passed", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() - 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert(!upkeepNeeded);
        });
        it("returns true if enough time has passed, has players, eth, and is open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert(upkeepNeeded);
        });
      });
      describe("performUpkeep", function() {
        it("it can only run if checkupkeep is true", async function() {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const tx = await raffle.performUpkeep([]);
          assert(tx);
        });
        it("reverts when chekupkeep is false", async () => {
          await expect(raffle.performUpkeep([])).to.be.revertedWith(
            "Raffle_UpkeepNotNeeded"
          );
        });
        it("updates the raffle state, emits and calls the vrf coordinator", async function() {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const txResponse = await raffle.performUpkeep([]);
          const txReceipt = await txResponse.wait(1);
          const requestId = txReceipt.events[1].args.requestId;
          raffleState = await raffle.getRaffleState();
          assert(requestId.toNumber() > 0);
          assert(raffleState.toString() == "1");
        });
      });

      describe("fulfillRandomWords", function() {
        beforeEach(async function() {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
        });
        it("can only be called after performUpkeep", async () => {
          await expect(
            VRFCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
          ).to.be.revertedWith("nonexistent request");
          await expect(
            VRFCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
          ).to.be.revertedWith("nonexistent request");
        });
        //     ////////////////////////////////////////////////
        it("pick a winner, resets the lottery, and sends money", async () => {
          const addionalEntrants = 3;
          const startingAccountIndex = 1; //deployer =0
          const accounts = await ethers.getSigners();
          for (
            let i = startingAccountIndex;
            i < startingAccountIndex + addionalEntrants;
            i++
          ) {
            const accountConnectedRaffle = raffle.connect(accounts[i]);
            await accountConnectedRaffle.enterRaffle({
              value: raffleEntranceFee,
            });
          }
          const startingTimeStamp = await raffle.getLatestTimeStamp();

          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("Fund the event!");
              try {
                const recentWinner = await raffle.getRecentWinner();
                console.log(recentWinner);
                console.log(accounts[2].address);
                console.log(accounts[0].address);
                console.log(accounts[1].address);
                console.log(accounts[3].address);

                const raffleState = await raffle.getRaffleState();
                const endingTimeStamp = await raffle.getLatestTimeStamp();
                const numPlayers = await raffle.getNumberOfPlayers();
                const winnerEndingBalance = await accounts[1].getBalance();
                assert.equal(numPlayers.toString(), "0");
                assert.equal(raffleState.toString(), "0");
                assert(endingTimeStamp > startingTimeStamp);

                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(
                    raffleEntranceFee
                      .mul(addionalEntrants)
                      .add(raffleEntranceFee.toString())
                  )
                );
              } catch (e) {
                reject(e);
              }
              resolve();
            });
            const tx = await raffle.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const winnerStartingBalance = await accounts[1].getBalance();
            await VRFCoordinatorV2Mock.fulfillRandomWords(
              txReceipt.events[1].args.requestId,
              raffle.address
            );
          });
        });
      });
    });
