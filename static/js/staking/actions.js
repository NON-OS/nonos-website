var NoxStaking = window.NoxStaking || {};

NoxStaking.Actions = {
    handleStake: async function() {
        var amt = document.getElementById('stakeAmount').value.trim();
        if (!amt || isNaN(amt) || Number(amt) <= 0) { NoxStaking.UI.showToast('Enter amount', 'error'); return; }
        var lock = parseInt(document.getElementById('lockPeriod').value) || 0;
        var btn = document.getElementById('stakeBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var wei = ethers.parseEther(amt);
            var S = NoxStaking.Staking;
            var W = NoxStaking.Wallet;
            if (S.userBalance < wei) throw new Error('Insufficient balance');
            if (S.userAllowance < wei) {
                NoxStaking.UI.showToast('Approving...');
                var tx = await W.noxToken.approve(NoxStaking.CONFIG.STAKING_ADDRESS, ethers.MaxUint256);
                await tx.wait();
            }
            NoxStaking.UI.showToast('Staking...');
            var tx2 = lock > 0 ? await W.stakingContract.stakeLocked(wei, lock) : await W.stakingContract.stake(wei);
            await tx2.wait();
            NoxStaking.UI.showToast('Staked ' + amt + ' NOX!', 'success');
            document.getElementById('stakeAmount').value = '';
            S.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Stake'; }
    },

    handleUnstake: async function() {
        var S = NoxStaking.Staking;
        if (S.userLockEnd && S.userLockEnd > Math.floor(Date.now() / 1000)) {
            NoxStaking.UI.showToast('Stake is locked', 'error'); return;
        }
        var amt = document.getElementById('unstakeAmount').value.trim();
        if (!amt || isNaN(amt) || Number(amt) <= 0) { NoxStaking.UI.showToast('Enter amount', 'error'); return; }
        var btn = document.getElementById('unstakeBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var wei = ethers.parseEther(amt);
            if (S.userStaked < wei) throw new Error('Insufficient staked');
            NoxStaking.UI.showToast('Unstaking...');
            var tx = await NoxStaking.Wallet.stakingContract.unstake(wei);
            await tx.wait();
            NoxStaking.UI.showToast('Unstaked!', 'success');
            document.getElementById('unstakeAmount').value = '';
            S.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Unstake'; }
    },

    handleClaim: async function() {
        var btn = document.getElementById('claimBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var W = NoxStaking.Wallet;
            var pending = await W.stakingContract.pendingRewards(W.userAddress);
            if (pending === 0n) { NoxStaking.UI.showToast('No rewards', 'error'); return; }
            NoxStaking.UI.showToast('Claiming...');
            var tx = await W.stakingContract.claimRewards();
            await tx.wait();
            NoxStaking.UI.showToast('Claimed!', 'success');
            NoxStaking.Staking.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Claim Rewards'; }
    },

    handleUnstakePosition: async function(positionId) {
        var W = NoxStaking.Wallet;
        if (!W.stakingContract) return;
        var card = document.querySelector('.position-card[data-position-id="' + positionId + '"]');
        var btn = card ? card.querySelector('.position-btn-unstake') : null;
        if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
        try {
            NoxStaking.UI.showToast('Unstaking position #' + (positionId + 1) + '...');
            var tx = await W.stakingContract.unstakePosition(positionId);
            await tx.wait();
            NoxStaking.UI.showToast('Unstaked!', 'success');
            NoxStaking.Staking.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Unstake'; }
        }
    },

    handleEarlyUnlock: async function(positionId) {
        var W = NoxStaking.Wallet;
        var UI = NoxStaking.UI;
        if (!W.stakingContract) return;
        var card = document.querySelector('.position-card[data-position-id="' + positionId + '"]');
        var btn = card ? card.querySelector('.position-btn-early') : null;

        try {
            var pos = await W.stakingContract.getPosition(W.userAddress, positionId);
            var amount = Number(ethers.formatEther(pos[0]));
            var penaltyPct = NoxStaking.Staking.earlyUnlockPenaltyBps / 100;
            var penaltyAmount = amount * (penaltyPct / 100);
            var returnAmount = amount - penaltyAmount;

            var confirmMsg = 'Early unlock position #' + (positionId + 1) + '?\n\n' +
                'Staked: ' + UI.formatNum(amount) + ' NOX\n' +
                'Penalty (' + penaltyPct.toFixed(1) + '%): -' + UI.formatNum(penaltyAmount) + ' NOX\n' +
                'You receive: ' + UI.formatNum(returnAmount) + ' NOX';

            if (!confirm(confirmMsg)) return;

            if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
            UI.showToast('Processing early unlock...');
            var tx = await W.stakingContract.earlyUnlock(positionId);
            await tx.wait();
            UI.showToast('Unlocked! ' + (penaltyAmount > 0 ? UI.formatNum(penaltyAmount) + ' NOX burned' : ''), 'success');
            NoxStaking.Staking.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Early Exit'; }
        }
    }
};

window.NoxStaking = NoxStaking;
