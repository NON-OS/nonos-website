// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../NOXRewardsV2.sol";

contract DeployV2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address noxToken = 0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA;
        address signer = 0xa12eCf0CDfC9D53FFafbdef43696cE615E662B33;
        address owner = 0xa12eCf0CDfC9D53FFafbdef43696cE615E662B33;

        vm.startBroadcast(deployerPrivateKey);

        NOXRewardsV2 implementation = new NOXRewardsV2();

        bytes memory initData = abi.encodeWithSelector(
            NOXRewardsV2.initialize.selector,
            noxToken,
            signer,
            owner
        );

        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            initData
        );

        console.log("Implementation:", address(implementation));
        console.log("Proxy:", address(proxy));

        vm.stopBroadcast();
    }
}
