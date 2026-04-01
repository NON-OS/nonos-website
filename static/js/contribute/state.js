var NoxContribute = window.NoxContribute || {};

NoxContribute.state = {
  provider: null,
  signer: null,
  walletAddress: null,
  githubToken: null,
  githubUser: null,
  dashboard: null,
  claimData: null
};

NoxContribute.el = {};

NoxContribute.resetState = function() {
  NoxContribute.state = {
    provider: null,
    signer: null,
    walletAddress: null,
    githubToken: null,
    githubUser: null,
    dashboard: null,
    claimData: null
  };
};

window.NoxContribute = NoxContribute;
