var NoxStaking = window.NoxStaking || {};

NoxStaking.Positions = {
    renderV2: function(staked, lockPeriod, lockEnd) {
        var container = document.getElementById('positionsContainer');
        if (!container) return;

        var UI = NoxStaking.UI;
        var amt = Number(ethers.formatEther(staked));
        var lockDays = Math.ceil(lockPeriod / 86400);
        var now = Math.floor(Date.now() / 1000);
        var isLocked = lockEnd > now;
        var penaltyPct = NoxStaking.Staking.earlyUnlockPenaltyBps ? (NoxStaking.Staking.earlyUnlockPenaltyBps / 100).toFixed(1) : '0';

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
                '<button class="position-btn position-btn-early" onclick="NoxStaking.Actions.handleEarlyUnlock(0)">' +
                'Early Exit' + (penaltyPct > 0 ? ' (-' + penaltyPct + '%)' : ' (FREE)') + '</button>' +
                '</div>';
        } else {
            html += '<div class="position-unlocked">Unlocked</div>';
            html += '<div class="position-actions">' +
                '<button class="position-btn position-btn-unstake" onclick="NoxStaking.Actions.handleUnstakePosition(0)">Unstake</button>' +
                '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    },

    render: function(positions) {
        var container = document.getElementById('positionsContainer');
        if (!container) return;

        var UI = NoxStaking.UI;
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

        var penaltyPct = NoxStaking.Staking.earlyUnlockPenaltyBps ? (NoxStaking.Staking.earlyUnlockPenaltyBps / 100).toFixed(1) : '0';
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
                    '<button class="position-btn position-btn-early" onclick="NoxStaking.Actions.handleEarlyUnlock(' + id + ')">' +
                    'Early Exit' + (penaltyPct > 0 ? ' (-' + penaltyPct + '%)' : '') + '</button>' +
                    '</div>';
            } else {
                html += '<div class="position-unlocked">Unlocked</div>';
                html += '<div class="position-actions">' +
                    '<button class="position-btn position-btn-unstake" onclick="NoxStaking.Actions.handleUnstakePosition(' + id + ')">Unstake</button>' +
                    '</div>';
            }

            html += '</div>';
        }
        container.innerHTML = html;
    }
};

window.NoxStaking = NoxStaking;
