var Staking = {
    lockCountdownInterval: null,
    userBalance: null,
    userStaked: null,
    userAllowance: null,
    userLockEnd: null,
    earlyUnlockPenaltyBps: 0,

    loadGlobalStats: async function() {
        try {
            var pub = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
            var contract = new ethers.Contract(CONFIG.STAKING_ADDRESS, STAKING_ABI, pub);
            var [totalStaked, emissionRate] = await Promise.all([
                contract.totalStaked(),
                contract.getEmissionRate()
            ]);
            var staked = Number(ethers.formatEther(totalStaked));
            var rate = Number(ethers.formatEther(emissionRate));
            UI.updateElement('totalStaked', UI.formatNum(staked));
            if (staked > 0) {
                var yearly = rate > 0 ? rate * 31536000 : 28000000;
                var apy = (yearly / staked) * 100;
                UI.updateElement('baseApy', UI.formatNum(Math.min(apy, 99999)));
                UI.updateElement('maxApy', UI.formatNum(Math.min(apy * 6.25, 99999)));
            }
            await Staking.loadTotalDistributed(pub);
            await Staking.loadLockStats(pub);
        } catch (e) {}
    },

    loadTotalDistributed: async function(pub) {
        try {
            var block = await pub.getBlockNumber();
            var logs = await pub.getLogs({
                address: CONFIG.STAKING_ADDRESS,
                topics: ['0xfc30cddea38e2bf4d6ea7d3f9ed3b6ad7f176419f4963bd81318067a4aee73fe'],
                fromBlock: block - 45000,
                toBlock: 'latest'
            });
            var total = 0n;
            for (var i = 0; i < logs.length; i++) total += BigInt(logs[i].data);
            UI.updateElement('totalDistributed', UI.formatNum(Number(ethers.formatEther(total))));
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
                        address: CONFIG.STAKING_ADDRESS,
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

            UI.updateElement('lockStat0', UI.formatNum(Number(ethers.formatEther(lockBuckets[0]))));
            UI.updateElement('lockStat30', UI.formatNum(Number(ethers.formatEther(lockBuckets[2592000]))));
            UI.updateElement('lockStat60', UI.formatNum(Number(ethers.formatEther(lockBuckets[5184000]))));
            UI.updateElement('lockStat90', UI.formatNum(Number(ethers.formatEther(lockBuckets[7776000]))));
            UI.updateElement('lockStat180', UI.formatNum(Number(ethers.formatEther(lockBuckets[15552000]))));
            UI.updateElement('lockStat365', UI.formatNum(Number(ethers.formatEther(lockBuckets[31536000]))));
        } catch (e) {}
    },

    loadUserData: async function() {
        if (!Wallet.userAddress || !Wallet.stakingContract) return;
        try {
            var [info, balance, allowance] = await Promise.all([
                Wallet.stakingContract.getStakeInfo(Wallet.userAddress),
                Wallet.noxToken.balanceOf(Wallet.userAddress),
                Wallet.noxToken.allowance(Wallet.userAddress, CONFIG.STAKING_ADDRESS)
            ]);

            var positions = null;
            var penaltyBps = 0n;
            try {
                positions = await Wallet.stakingContract.getUserPositions(Wallet.userAddress);
            } catch(e) {}
            try {
                penaltyBps = await Wallet.stakingContract.earlyUnlockPenaltyBps();
            } catch(e) {}

            var staked = info[0], weighted = info[1], nfts = Number(info[2]);
            var pending = info[3], boost = Number(info[4]);
            var lockPeriod = Number(info[5]), lockEnd = Number(info[6]);

            UI.updateElement('userStake', UI.formatNum(Number(ethers.formatEther(staked))));
            UI.updateElement('userWeighted', UI.formatNum(Number(ethers.formatEther(weighted))));
            UI.updateElement('userPending', UI.formatNum(Number(ethers.formatEther(pending))));
            UI.updateElement('userBoost', (boost / 10000).toFixed(2));
            UI.updateElement('nftCount', nfts);
            UI.updateElement('boostMultiplier', UI.getNftBoost(nfts).toFixed(2));
            UI.updateElement('walletBalance', UI.formatNum(Number(ethers.formatEther(balance))));
            UI.updateElement('stakedBalance', UI.formatNum(Number(ethers.formatEther(staked))));
            UI.updateElement('claimableRewards', UI.formatNum(Number(ethers.formatEther(pending))));

            document.querySelectorAll('.boost-tier[data-tier]').forEach(function(t) { t.classList.remove('active'); });
            var tier = document.querySelector('.boost-tier[data-tier="' + Math.min(nfts, 5) + '"]');
            if (tier) tier.classList.add('active');

            Staking.updateLockDisplay(lockPeriod, lockEnd);

            Staking.userBalance = balance;
            Staking.userStaked = staked;
            Staking.userAllowance = allowance;
            Staking.userLockEnd = lockEnd;
            Staking.earlyUnlockPenaltyBps = Number(penaltyBps);

            UI.updatePenaltyBanner(Number(penaltyBps));

            var hasV3Positions = positions && positions[0] && positions[0].length > 0;
            var hasActiveV3 = false;
            if (hasV3Positions) {
                for (var i = 0; i < positions[4].length; i++) {
                    if (positions[4][i]) { hasActiveV3 = true; break; }
                }
            }

            var stakedNum = Number(ethers.formatEther(staked));

            if (hasActiveV3) {
                Staking.renderPositions(positions);
            } else if (stakedNum > 0) {
                Staking.renderV2Position(staked, lockPeriod, lockEnd);
            } else {
                var container = document.getElementById('positionsContainer');
                if (container) container.innerHTML = '<div class="no-positions">No active positions</div>';
            }
        } catch (e) {}
    },

    updateLockDisplay: function(period, endTime) {
        var now = Math.floor(Date.now() / 1000);
        var lockStatus = document.getElementById('lockStatus');
        var lockDays = document.getElementById('lockDaysDisplay');
        var lockMult = document.getElementById('lockMultiplier');
        var unstakeBtn = document.getElementById('unstakeBtn');

        document.querySelectorAll('.boost-tier[data-lock]').forEach(function(t) { t.classList.remove('active'); });

        if (endTime > now) {
            if (lockStatus) lockStatus.style.display = 'block';
            var boost = UI.getLockBoost(period);
            if (lockMult) lockMult.textContent = boost.toFixed(2);
            var days = Math.ceil(period / 86400);
            if (lockDays) lockDays.textContent = days + ' Days';
            var badge = document.getElementById('lockBoostBadge');
            if (badge) badge.textContent = '+' + Math.round((boost - 1) * 100) + '%';
            if (unstakeBtn) { unstakeBtn.disabled = true; unstakeBtn.textContent = 'Locked'; }
            Staking.startCountdown(endTime);
            var t = document.querySelector('.boost-tier[data-lock="' + days + '"]');
            if (t) t.classList.add('active');
        } else {
            if (lockStatus) lockStatus.style.display = 'none';
            if (lockMult) lockMult.textContent = '1.00';
            if (lockDays) lockDays.textContent = 'No Lock';
            if (unstakeBtn) { unstakeBtn.disabled = false; unstakeBtn.textContent = 'Unstake'; }
            var t = document.querySelector('.boost-tier[data-lock="0"]');
            if (t) t.classList.add('active');
            if (Staking.lockCountdownInterval) clearInterval(Staking.lockCountdownInterval);
        }
    },

    startCountdown: function(end) {
        if (Staking.lockCountdownInterval) clearInterval(Staking.lockCountdownInterval);
        var el = document.getElementById('lockCountdown');
        if (!el) return;
        function tick() {
            var left = end - Math.floor(Date.now() / 1000);
            if (left <= 0) { el.textContent = 'Unlocked!'; clearInterval(Staking.lockCountdownInterval); Staking.loadUserData(); return; }
            el.textContent = UI.formatTimeLeft(left);
        }
        tick();
        Staking.lockCountdownInterval = setInterval(tick, 60000);
    },

    renderV2Position: function(staked, lockPeriod, lockEnd) {
        var container = document.getElementById('positionsContainer');
        if (!container) return;

        var amt = Number(ethers.formatEther(staked));
        var lockDays = Math.ceil(lockPeriod / 86400);
        var now = Math.floor(Date.now() / 1000);
        var isLocked = lockEnd > now;
        var penaltyPct = Staking.earlyUnlockPenaltyBps ? (Staking.earlyUnlockPenaltyBps / 100).toFixed(1) : '0';

        var lockLabel = lockDays > 0 ? lockDays + ' days' : 'No lock';
        var lockBoost = UI.getLockBoost(lockPeriod);
        var timeLeft = isLocked ? UI.formatTimeLeft(lockEnd - now) : '';

        var html = '<div class="position-card position-card-v2" data-position-id="0">' +
            '<div class="position-badge">Active Position</div>' +
            '<div class="position-header">' +
            '<span class="position-id">Position #1</span>' +
            '<span class="position-lock">' + lockLabel + (lockBoost > 1 ? ' (' + lockBoost.toFixed(1) + 'x)' : '') + '</span>' +
            '</div>' +
            '<div class="position-amount">' + UI.formatNum(amt) + ' NOX</div>';

        if (isLocked) {
            html += '<div class="position-countdown"><span class="lock-icon">&#128274;</span> ' + timeLeft + ' remaining</div>';
            html += '<div class="position-actions">' +
                '<button class="position-btn position-btn-early" onclick="Staking.handleEarlyUnlock(0)">' +
                'Early Exit' + (penaltyPct > 0 ? ' (-' + penaltyPct + '%)' : ' (FREE)') + '</button>' +
                '</div>';
        } else {
            html += '<div class="position-unlocked">Unlocked</div>';
            html += '<div class="position-actions">' +
                '<button class="position-btn position-btn-unstake" onclick="Staking.handleUnstakePosition(0)">Unstake</button>' +
                '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    },

    renderPositions: function(positions) {
        var container = document.getElementById('positionsContainer');
        if (!container) return;

        var ids = positions[0], amounts = positions[1];
        var lockPeriods = positions[2], lockEndTimes = positions[3];
        var activeFlags = positions[4];

        var activeCount = 0;
        for (var i = 0; i < ids.length; i++) {
            if (activeFlags[i]) activeCount++;
        }

        if (activeCount === 0) {
            container.innerHTML = '<div class="no-positions">No active positions</div>';
            return;
        }

        var penaltyPct = Staking.earlyUnlockPenaltyBps ? (Staking.earlyUnlockPenaltyBps / 100).toFixed(1) : '0';
        var now = Math.floor(Date.now() / 1000);
        var html = '';

        for (var i = 0; i < ids.length; i++) {
            if (!activeFlags[i]) continue;

            var id = Number(ids[i]);
            var amt = Number(ethers.formatEther(amounts[i]));
            var lockDays = Math.ceil(Number(lockPeriods[i]) / 86400);
            var lockEnd = Number(lockEndTimes[i]);
            var isLocked = lockEnd > now;

            var lockLabel = lockDays > 0 ? lockDays + ' days' : 'No lock';
            var lockBoost = UI.getLockBoost(Number(lockPeriods[i]));
            var timeLeft = isLocked ? UI.formatTimeLeft(lockEnd - now) : '';

            html += '<div class="position-card" data-position-id="' + id + '">' +
                '<div class="position-header">' +
                '<span class="position-id">Position #' + (id + 1) + '</span>' +
                '<span class="position-lock">' + lockLabel + (lockBoost > 1 ? ' (' + lockBoost.toFixed(1) + 'x)' : '') + '</span>' +
                '</div>' +
                '<div class="position-amount">' + UI.formatNum(amt) + ' NOX</div>';

            if (isLocked) {
                html += '<div class="position-countdown"><span class="lock-icon">&#128274;</span> ' + timeLeft + ' remaining</div>';
                html += '<div class="position-actions">' +
                    '<button class="position-btn position-btn-early" onclick="Staking.handleEarlyUnlock(' + id + ')">' +
                    'Early Exit' + (penaltyPct > 0 ? ' (-' + penaltyPct + '%)' : '') + '</button>' +
                    '</div>';
            } else {
                html += '<div class="position-unlocked">Unlocked</div>';
                html += '<div class="position-actions">' +
                    '<button class="position-btn position-btn-unstake" onclick="Staking.handleUnstakePosition(' + id + ')">Unstake</button>' +
                    '</div>';
            }

            html += '</div>';
        }
        container.innerHTML = html;
    },

    handleStake: async function() {
        var amt = document.getElementById('stakeAmount').value.trim();
        if (!amt || isNaN(amt) || Number(amt) <= 0) { UI.showToast('Enter amount', 'error'); return; }
        var lock = parseInt(document.getElementById('lockPeriod').value) || 0;
        var btn = document.getElementById('stakeBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var wei = ethers.parseEther(amt);
            if (Staking.userBalance < wei) throw new Error('Insufficient balance');
            if (Staking.userAllowance < wei) {
                UI.showToast('Approving...');
                var tx = await Wallet.noxToken.approve(CONFIG.STAKING_ADDRESS, ethers.MaxUint256);
                await tx.wait();
            }
            UI.showToast('Staking...');
            var tx2 = lock > 0 ? await Wallet.stakingContract.stakeLocked(wei, lock) : await Wallet.stakingContract.stake(wei);
            await tx2.wait();
            UI.showToast('Staked ' + amt + ' NOX!', 'success');
            document.getElementById('stakeAmount').value = '';
            Staking.loadUserData(); Staking.loadGlobalStats();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Stake'; }
    },

    handleUnstake: async function() {
        if (Staking.userLockEnd && Staking.userLockEnd > Math.floor(Date.now() / 1000)) {
            UI.showToast('Stake is locked', 'error'); return;
        }
        var amt = document.getElementById('unstakeAmount').value.trim();
        if (!amt || isNaN(amt) || Number(amt) <= 0) { UI.showToast('Enter amount', 'error'); return; }
        var btn = document.getElementById('unstakeBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var wei = ethers.parseEther(amt);
            if (Staking.userStaked < wei) throw new Error('Insufficient staked');
            UI.showToast('Unstaking...');
            var tx = await Wallet.stakingContract.unstake(wei);
            await tx.wait();
            UI.showToast('Unstaked!', 'success');
            document.getElementById('unstakeAmount').value = '';
            Staking.loadUserData(); Staking.loadGlobalStats();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Unstake'; }
    },

    handleClaim: async function() {
        var btn = document.getElementById('claimBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var pending = await Wallet.stakingContract.pendingRewards(Wallet.userAddress);
            if (pending === 0n) { UI.showToast('No rewards', 'error'); return; }
            UI.showToast('Claiming...');
            var tx = await Wallet.stakingContract.claimRewards();
            await tx.wait();
            UI.showToast('Claimed!', 'success');
            Staking.loadUserData(); Staking.loadGlobalStats();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Claim Rewards'; }
    },

    handleUnstakePosition: async function(positionId) {
        if (!Wallet.stakingContract) return;
        var card = document.querySelector('.position-card[data-position-id="' + positionId + '"]');
        var btn = card ? card.querySelector('.position-btn-unstake') : null;
        if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
        try {
            UI.showToast('Unstaking position #' + (positionId + 1) + '...');
            var tx = await Wallet.stakingContract.unstakePosition(positionId);
            await tx.wait();
            UI.showToast('Unstaked!', 'success');
            Staking.loadUserData(); Staking.loadGlobalStats();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Unstake'; }
        }
    },

    handleEarlyUnlock: async function(positionId) {
        if (!Wallet.stakingContract) return;
        var card = document.querySelector('.position-card[data-position-id="' + positionId + '"]');
        var btn = card ? card.querySelector('.position-btn-early') : null;

        try {
            var pos = await Wallet.stakingContract.getPosition(Wallet.userAddress, positionId);
            var amount = Number(ethers.formatEther(pos[0]));
            var penaltyPct = Staking.earlyUnlockPenaltyBps / 100;
            var penaltyAmount = amount * (penaltyPct / 100);
            var returnAmount = amount - penaltyAmount;

            var confirmMsg = 'Early unlock position #' + (positionId + 1) + '?\n\n' +
                'Staked: ' + UI.formatNum(amount) + ' NOX\n' +
                'Penalty (' + penaltyPct.toFixed(1) + '%): -' + UI.formatNum(penaltyAmount) + ' NOX\n' +
                'You receive: ' + UI.formatNum(returnAmount) + ' NOX';

            if (!confirm(confirmMsg)) return;

            if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
            UI.showToast('Processing early unlock...');
            var tx = await Wallet.stakingContract.earlyUnlock(positionId);
            await tx.wait();
            UI.showToast('Unlocked! ' + (penaltyAmount > 0 ? UI.formatNum(penaltyAmount) + ' NOX burned' : ''), 'success');
            Staking.loadUserData(); Staking.loadGlobalStats();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Early Exit'; }
        }
    },

    updateLockBoostPreview: function() {
        var select = document.getElementById('lockPeriod');
        var preview = document.getElementById('lockBoostPreview');
        if (!select || !preview) return;
        preview.textContent = LOCK_BOOSTS[select.value] || '';
    }
};
