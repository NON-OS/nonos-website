var NoxStaking = window.NoxStaking || {};

NoxStaking.NFT = {
    loadUserNFTs: async function() {
        var W = NoxStaking.Wallet;
        var UI = NoxStaking.UI;
        if (!W.userAddress) return;

        var section = document.getElementById('nftGallerySection');
        var gallery = document.getElementById('nftGallery');
        var countEl = document.getElementById('nftGalleryCount');

        if (!section || !gallery) return;

        section.style.display = 'block';
        gallery.innerHTML = '<div class="nft-gallery-loading">Loading NFTs...</div>';

        try {
            var url = 'https://api.reservoir.tools/users/' + W.userAddress + '/tokens/v10?collection=' + NoxStaking.CONFIG.ZEROSTATE_PASS_ADDRESS + '&limit=10';
            var response = await fetch(url);
            var data = await response.json();

            if (!data.tokens || data.tokens.length === 0) {
                if (countEl) countEl.textContent = '0';
                gallery.innerHTML = '<div class="nft-empty"><div class="nft-empty-icon">&#128302;</div><p>No Zero State Pass NFTs found</p></div>';
                return;
            }

            var count = data.tokens.length;
            if (countEl) countEl.textContent = count;

            var html = '';
            for (var i = 0; i < count; i++) {
                var token = data.tokens[i].token;
                var tid = token.tokenId;
                var name = token.name || ('Zero State Pass #' + tid);
                var imageUrl = token.image || token.imageSmall || ('https://api.reservoir.tools/redirect/tokens/' + NoxStaking.CONFIG.ZEROSTATE_PASS_ADDRESS + ':' + tid + '/image/v1');

                html += '<div class="nft-card"><div class="nft-image-container">' +
                    '<img src="' + imageUrl + '" alt="' + name + '" class="nft-image" loading="lazy" onerror="this.style.display=\'none\'"></div>' +
                    '<div class="nft-info"><span class="nft-name">' + name + '</span>' +
                    '<span class="nft-boost">+' + UI.getBoostForNftPosition(i + 1) + '% boost</span></div></div>';
            }

            gallery.innerHTML = html;
        } catch (e) {
            console.log('NFT load error:', e);
            gallery.innerHTML = '<div class="nft-error">Failed to load NFTs</div>';
        }
    }
};

window.NoxStaking = NoxStaking;
