var NoxStaking = window.NoxStaking || {};

NoxStaking.Staking = {
    lockCountdownInterval: null,
    userBalance: null,
    userStaked: null,
    userAllowance: null,
    userLockEnd: null,
    earlyUnlockPenaltyBps: 0,

    loadUserData: async function() {
        var W = NoxStaking.Wallet;
        if (!W.userAddress || !W.stakingContract) return;
        try {
            var [info, balance, allowance] = await Promise.all([
                W.stakingContract.getStakeInfo(W.userAddress),
                W.noxToken.balanceOf(W.userAddress),
                W.noxToken.allowance(W.userAddress, NoxStaking.CONFIG.STAKING_ADDRESS)
            ]);
            var positions = null, penaltyBps = 0n;
            try { positions = await W.stakingContract.getUserPositions(W.userAddress); } catch(e) {}
            try { penaltyBps = await W.stakingContract.earlyUnlockPenaltyBps(); } catch(e) {}

            var staked = info[0], weighted = info[1], nfts = Number(info[2]);
            var pending = info[3], boost = Number(info[4]);
            var lockPeriod = Number(info[5]), lockEnd = Number(info[6]);
            var UI = NoxStaking.UI, S = NoxStaking.Staking;

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

            S.updateLockDisplay(lockPeriod, lockEnd);
            S.userBalance = balance; S.userStaked = staked; S.userAllowance = allowance;
            S.userLockEnd = lockEnd; S.earlyUnlockPenaltyBps = Number(penaltyBps);
            UI.updatePenaltyBanner(Number(penaltyBps));

            var hasV3 = positions && positions[0] && positions[0].length > 0;
            var hasActiveV3 = false;
            if (hasV3) { for (var i = 0; i < positions[4].length; i++) { if (positions[4][i]) { hasActiveV3 = true; break; } } }
            var stakedNum = Number(ethers.formatEther(staked));

            if (hasActiveV3) NoxStaking.Positions.render(positions);
            else if (stakedNum > 0) NoxStaking.Positions.renderV2(staked, lockPeriod, lockEnd);
            else { var c = document.getElementById('positionsContainer'); if (c) c.innerHTML = '<div class="no-positions">No active positions</div>'; }
        } catch (e) {}
    },

    updateLockDisplay: function(period, endTime) {
        var now = Math.floor(Date.now() / 1000);
        var lockStatus = document.getElementById('lockStatus');
        var lockDays = document.getElementById('lockDaysDisplay');
        var lockMult = document.getElementById('lockMultiplier');
        var unstakeBtn = document.getElementById('unstakeBtn');
        var UI = NoxStaking.UI, S = NoxStaking.Staking;
        document.querySelectorAll('.boost-tier[data-lock]').forEach(function(t) { t.classList.remove('active'); });

        if (endTime > now) {
            if (lockStatus) lockStatus.style.display = 'block';
            var boost = UI.getLockBoost(period), days = Math.ceil(period / 86400);
            if (lockMult) lockMult.textContent = boost.toFixed(2);
            if (lockDays) lockDays.textContent = days + ' Days';
            var badge = document.getElementById('lockBoostBadge');
            if (badge) badge.textContent = '+' + Math.round((boost - 1) * 100) + '%';
            if (unstakeBtn) { unstakeBtn.disabled = true; unstakeBtn.textContent = 'Locked'; }
            S.startCountdown(endTime);
            var t = document.querySelector('.boost-tier[data-lock="' + days + '"]'); if (t) t.classList.add('active');
        } else {
            if (lockStatus) lockStatus.style.display = 'none';
            if (lockMult) lockMult.textContent = '1.00';
            if (lockDays) lockDays.textContent = 'No Lock';
            if (unstakeBtn) { unstakeBtn.disabled = false; unstakeBtn.textContent = 'Unstake'; }
            var t = document.querySelector('.boost-tier[data-lock="0"]'); if (t) t.classList.add('active');
            if (S.lockCountdownInterval) clearInterval(S.lockCountdownInterval);
        }
    },

    startCountdown: function(end) {
        var S = NoxStaking.Staking;
        if (S.lockCountdownInterval) clearInterval(S.lockCountdownInterval);
        var el = document.getElementById('lockCountdown');
        if (!el) return;
        function tick() {
            var left = end - Math.floor(Date.now() / 1000);
            if (left <= 0) { el.textContent = 'Unlocked!'; clearInterval(S.lockCountdownInterval); S.loadUserData(); return; }
            el.textContent = NoxStaking.UI.formatTimeLeft(left);
        }
        tick();
        S.lockCountdownInterval = setInterval(tick, 60000);
    },

    updateLockBoostPreview: function() {
        var select = document.getElementById('lockPeriod');
        var preview = document.getElementById('lockBoostPreview');
        if (!select || !preview) return;
        preview.textContent = NoxStaking.LOCK_BOOSTS[select.value] || '';
    }
};

window.NoxStaking = NoxStaking;
