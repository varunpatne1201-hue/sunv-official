# SUNV Website v1

A static, deployment-ready public website and metadata package for SUNV.

## Official token facts used
- Name: Sun
- Symbol: SUNV
- Network: Robinhood Chain mainnet
- Chain ID: 4663
- Contract: `0x22fd16577ba869A7df77F4280ae08c65BB03111d`
- Supply: 100,000,000 SUNV
- Decimals: 18
- Source: verified on Robinhood Chain Blockscout
- DEX pair: SUNV / USDG on Uniswap v4

## Local preview
Open `index.html` directly in a browser, or run a static server from this folder.

## Before public deployment
1. Buy/connect the final domain.
2. Create the official project email and social account.
3. Replace `TO_BE_SET_AFTER_DOMAIN_IS_CONNECTED` in `metadata/token-metadata.json`.
4. Add final social links to the site.
5. Confirm the target token allocation is the allocation you intend to publish.
6. Do not imply endorsement by Robinhood or Uniswap.

## Render deployment
Create a new **Static Site** in Render, connect the GitHub repository containing this folder, leave the build command empty, and publish from the repository root (or this folder if it is the repo root).
