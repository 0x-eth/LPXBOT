// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract TestOnlyWBNB {
    string public constant name = "Wrapped BNB Fixture";
    string public constant symbol = "WBNB";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed account, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Withdrawal(address indexed account, uint256 value);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        totalSupply += msg.value;
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        uint256 balance = balanceOf[msg.sender];
        require(balance >= amount, "insufficient balance");
        unchecked {
            balanceOf[msg.sender] = balance - amount;
            totalSupply -= amount;
        }
        emit Transfer(msg.sender, address(0), amount);
        emit Withdrawal(msg.sender, amount);
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "native transfer failed");
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "insufficient allowance");
        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "zero recipient");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "insufficient balance");
        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
