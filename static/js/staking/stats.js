var NoxStaking = window.NoxStaking || {};

NoxStaking.Stats = {
    loadGlobal: async function() {
        try {
            var pub = new ethers.JsonRpcProvider(NoxStaking.CONFIG.RPC_URL);
            var contract = new ethers.Contract(NoxStaking.CONFIG.STAKING_ADDRESS, NoxStaking.STAKING_ABI, pub);
            var [totalStaked, emissionRate] = await Promise.all([
                contract.totalStaked(),
                contract.getEmissionRate()
            ]);
            var staked = Number(ethers.formatEther(totalStaked));
            var rate = Number(ethers.formatEther(emissionRate));
            NoxStaking.UI.updateElement('totalStaked', NoxStaking.UI.formatNum(staked));
            if (staked > 0) {
                var yearly = rate > 0 ? rate * 31536000 : 28000000;
                var apy = (yearly / staked) * 100;
                NoxStaking.UI.updateElement('baseApy', NoxStaking.UI.formatNum(Math.min(apy, 99999)));
                NoxStaking.UI.updateElement('maxApy', NoxStaking.UI.formatNum(Math.min(apy * 6.25, 99999)));
            }
            await NoxStaking.Stats.loadTotalDistributed(pub);
            await NoxStaking.Stats.loadLockStats(pub);
        } catch (e) {}
    },

    loadTotalDistributed: async function(pub) {
        try {
            var block = await pub.getBlockNumber();
            var logs = await pub.getLogs({
                address: NoxStaking.CONFIG.STAKING_ADDRESS,
                topics: ['0xfc30cddea38e2bf4d6ea7d3f9ed3b6ad7f176419f4963bd81318067a4aee73fe'],
                fromBlock: block - 45000,
                toBlock: 'latest'
            });
            var total = 0n;
            for (var i = 0; i < logs.length; i++) total += BigInt(logs[i].data);
            NoxStaking.UI.updateElement('totalDistributed', NoxStaking.UI.formatNum(Number(ethers.formatEther(total))));
        } catch (e) {}
    },

    loadLockStats: async function(pub) {
        try {
            var block = await pub.getBlockNumber();
            var stakedV2Topic = '0xc1672060a1dfbc1402fe69eeb5023b934bfcbaabb4eafabfcd875cf591b5d378';
            var lockBuckets = { 0: 0n, 2592000: 0n, 5184000: 0n, 7776000: 0n, 15552000: 0n, 31536000: 0n };
            var chunkSize = 10000;
            var totalBlocks = 50000;

            for (var offset = 0; offset < totalBlocks; offset += chunkSize) {
                try {
                    var fromBlock = block - totalBlocks + offset;
                    var toBlock = fromBlock + chunkSize - 1;
                    if (toBlock > block) toBlock = block;

                    var logs = await pub.getLogs({
                        address: NoxStaking.CONFIG.STAKING_ADDRESS,
                        topics: [stakedV2Topic],
                        fromBlock: fromBlock,
                        toBlock: toBlock
                    });

                    for (var i = 0; i < logs.length; i++) {
                        try {
                            var decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256', 'uint256'], logs[i].data);
                            var amount = decoded[0];
                            var lockPeriod = Number(decoded[2]);
                            var lockKey = 0;
                            if (lockPeriod >= 31536000) lockKey = 31536000;
                            else if (lockPeriod >= 15552000) lockKey = 15552000;
                            else if (lockPeriod >= 7776000) lockKey = 7776000;
                            else if (lockPeriod >= 5184000) lockKey = 5184000;
                            else if (lockPeriod >= 2592000) lockKey = 2592000;
                            lockBuckets[lockKey] += amount;
                        } catch (e) {}
                    }
                } catch (e) {}
            }

            NoxStaking.UI.updateElement('lockStat0', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[0]))));
            NoxStaking.UI.updateElement('lockStat30', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[2592000]))));
            NoxStaking.UI.updateElement('lockStat60', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[5184000]))));
            NoxStaking.UI.updateElement('lockStat90', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[7776000]))));
            NoxStaking.UI.updateElement('lockStat180', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[15552000]))));
            NoxStaking.UI.updateElement('lockStat365', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[31536000]))));
        } catch (e) {}
    }
};

window.NoxStaking = NoxStaking;
