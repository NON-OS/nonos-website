// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../NOXRewards.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address noxToken = 0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA;
        address signer = 0xa12eCf0CDfC9D53FFafbdef43696cE615E662B33;
        address owner = 0x4b9f1DA55D599e131cC8FBFFa70419A3Bb8543b2;

        vm.startBroadcast(deployerPrivateKey);

        NOXRewards rewards = new NOXRewards(noxToken, signer, owner);

        console.log("NOXRewards deployed at:", address(rewards));

        vm.stopBroadcast();
    }
}
