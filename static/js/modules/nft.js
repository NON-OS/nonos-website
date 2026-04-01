var NFT = {
    loadUserNFTs: async function() {
        if (!Wallet.userAddress) return;

        var section = document.getElementById('nftGallerySection');
        var gallery = document.getElementById('nftGallery');
        var countEl = document.getElementById('nftGalleryCount');

        if (!section || !gallery) return;

        try {
            var pub = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
            var nftContract = new ethers.Contract(CONFIG.ZEROSTATE_PASS_ADDRESS, ERC721_ABI, pub);
            var balance = await nftContract.balanceOf(Wallet.userAddress);
            var count = Number(balance);

            if (countEl) countEl.textContent = count;

            if (count === 0) {
                section.style.display = 'block';
                gallery.innerHTML = '<div class="nft-empty">' +
                    '<div class="nft-empty-icon">&#128302;</div>' +
                    '<p>No ZeroState Pass NFTs found</p>' +
                    '<a href="https://opensea.io/collection/zerostate-pass" target="_blank" rel="noopener" class="btn btn-secondary btn-small">Get on OpenSea</a>' +
                    '</div>';
                return;
            }

            section.style.display = 'block';
            gallery.innerHTML = '<div class="nft-gallery-loading">Loading ' + count + ' NFT' + (count > 1 ? 's' : '') + '...</div>';

            var nfts = [];
            for (var i = 0; i < count && i < 10; i++) {
                try {
                    var tokenId = await nftContract.tokenOfOwnerByIndex(Wallet.userAddress, i);
                    var tokenURI = await nftContract.tokenURI(tokenId);

                    if (tokenURI.startsWith('ipfs://')) {
                        tokenURI = tokenURI.replace('ipfs://', 'https://ipfs.io/ipfs/');
                    }

                    nfts.push({
                        tokenId: Number(tokenId),
                        tokenURI: tokenURI
                    });
                } catch (e) {}
            }

            var html = '';
            for (var j = 0; j < nfts.length; j++) {
                var nft = nfts[j];
                var imageUrl = '';
                var name = 'ZeroState Pass #' + nft.tokenId;

                try {
                    var response = await fetch(nft.tokenURI, { timeout: 10000 });
                    if (response.ok) {
                        var metadata = await response.json();
                        if (metadata.image) {
                            imageUrl = metadata.image;
                            if (imageUrl.startsWith('ipfs://')) {
                                imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
                            }
                        }
                        if (metadata.name) {
                            name = metadata.name;
                        }
                    } else {
                        imageUrl = NFT.getPlaceholderSvg(nft.tokenId);
                    }
                } catch (e) {
                    imageUrl = NFT.getPlaceholderSvg(nft.tokenId);
                }

                if (!imageUrl) {
                    imageUrl = NFT.getPlaceholderSvg(nft.tokenId);
                }

                html += '<div class="nft-card">' +
                    '<div class="nft-image-container">' +
                    '<img src="' + imageUrl + '" alt="' + name + '" class="nft-image" loading="lazy" onerror="this.src=\'' + NFT.getPlaceholderSvg(nft.tokenId) + '\'">' +
                    '</div>' +
                    '<div class="nft-info">' +
                    '<span class="nft-name">' + name + '</span>' +
                    '<span class="nft-boost">+' + UI.getBoostForNftPosition(j + 1) + '% boost</span>' +
                    '</div>' +
                    '</div>';
            }

            gallery.innerHTML = html;

        } catch (e) {
            gallery.innerHTML = '<div class="nft-error">Failed to load NFTs</div>';
        }
    },

    getPlaceholderSvg: function(tokenId) {
        return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#1a1a1a" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="#66ffff" font-family="sans-serif" font-size="12">#' + tokenId + '</text></svg>');
    }
};
