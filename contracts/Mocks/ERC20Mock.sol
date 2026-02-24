// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    // Mint 1 Million POLO to the deployer
    constructor() ERC20("Polonium", "POLO") {
        _mint(msg.sender, 1000000 * 10 ** 18);
    }
}