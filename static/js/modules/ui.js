var UI = {
    toastTimeout: null,

    showToast: function(msg, type) {
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast show' + (type ? ' ' + type : '');
        clearTimeout(UI.toastTimeout);
        UI.toastTimeout = setTimeout(function() { t.classList.remove('show'); }, 4000);
    },

    formatNum: function(n) {
        if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n/1e3).toFixed(2) + 'K';
        if (n >= 1) return n.toFixed(2);
        return n > 0 ? n.toFixed(4) : '0.00';
    },

    getNftBoost: function(n) {
        return [1, 1.25, 1.5, 1.75, 2, 2.5][Math.min(n, 5)];
    },

    getLockBoost: function(p) {
        if (p >= 31536000) return 2.5;
        if (p >= 15552000) return 1.8;
        if (p >= 7776000) return 1.6;
        if (p >= 5184000) return 1.4;
        if (p >= 2592000) return 1.2;
        return 1;
    },

    getBoostForNftPosition: function(position) {
        var boosts = [25, 25, 25, 25, 50];
        if (position <= 5) return boosts[position - 1];
        return 0;
    },

    formatTimeLeft: function(seconds) {
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds % 86400) / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        return d > 0 ? d + 'd ' + h + 'h' : (h > 0 ? h + 'h ' + m + 'm' : m + 'm');
    },

    updateElement: function(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    setDisplay: function(id, display) {
        var el = document.getElementById(id);
        if (el) el.style.display = display;
    },

    updatePenaltyBanner: function(penaltyBps) {
        var valueEl = document.getElementById('penaltyValue');
        var statusEl = document.querySelector('.penalty-status');
        if (!valueEl) return;

        var pct = (penaltyBps / 100).toFixed(1);
        valueEl.textContent = pct + '%';

        if (statusEl) {
            if (penaltyBps === 0) {
                statusEl.textContent = 'GRACE PERIOD - Exit locked positions FREE';
                statusEl.classList.remove('active');
                statusEl.classList.add('grace');
            } else {
                statusEl.textContent = 'ACTIVE - ' + pct + '% burned on early exit';
                statusEl.classList.remove('grace');
                statusEl.classList.add('active');
            }
        }
    }
};
