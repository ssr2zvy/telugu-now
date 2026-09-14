# Usage and costs

Public pricing reviewed on **2026-09-13**. These are pricing references, not
account balances or an estimate of the total bill. Use the signed-in dashboards
for actual usage, credits, taxes, and current charges.

## Fly.io

**Overall cost:** [Fly organization billing](https://fly.io/dashboard/personal/billing)
shows current-month usage, upcoming invoices, Cost Explorer, and past invoices.
Select the organization that owns `telugu-now` if it is not the personal
organization. Fly-linked Tigris charges appear on the same Fly bill.

| Possible cost | What applies to this app | Pricing / usage links |
|---|---|---|
| Running Machines | `fly.toml` requests one shared CPU and 1 GB RAM in `iad`. Runtime is usage-based; automatic stopping is disabled. | [Compute rates](https://fly.io/docs/about/pricing/#compute), [Machine billing](https://fly.io/docs/about/billing/#machine-billing), [App dashboard](https://fly.io/apps/telugu-now) |
| Stopped Machines | Stopping removes running compute charges, but stored root filesystems remain billable: published rate $0.15/GB per 30 days. | [Stopped Machine rates](https://fly.io/docs/about/pricing/#stopped-fly-machines) |
| Persistent volume | `telugu_now_data`: 3 GB in `iad`, mounted at `/data`. At $0.15 per allocated GB/month, the baseline is about **$0.45/month**, before credits. Charged while the volume exists, even unattached or stopped. | [Volume rates](https://fly.io/docs/about/pricing/#volumes), [Volume billing](https://fly.io/docs/about/billing/#volume-billing) |
| Volume snapshots | Snapshot storage is separate from the 3 GB allocation. Published rate $0.08/GB/month, with the first 10 GB free per month; actual usage depends on stored changes and retention. | [Snapshot rates](https://fly.io/docs/about/pricing/#volume-snapshots), [Retention controls](https://fly.io/docs/volumes/snapshots/) |
| Network transfer | Serving audio and generated images to browsers can incur Fly outbound charges. Cross-region transfers and transfers to external services may also cost money. Rates depend on region and billing scheme. | [Data transfer rates](https://fly.io/docs/about/pricing/#data-transfer-pricing) |
| IP addresses and certificates | Shared IPv4 and IPv6 are included; optional dedicated IPv4 is $2/month. Static outbound IPs and certificates beyond applicable allowances can add charges. These are not all required by this app. | [IP rates](https://fly.io/docs/about/pricing/#anycast-ip-addresses), [Static egress IPs](https://fly.io/docs/about/pricing/#static-egress-ips-for-machines), [Certificate rates](https://fly.io/docs/about/pricing/#managed-ssl-certificates) |
| Remote builds | Manual deploys use `--remote-only`; inspect the selected builder's usage rather than assuming every build is free. Builder Machines or a paid build service may incur charges. | [Fly builders](https://fly.io/docs/reference/builders/), [Fly billing](https://fly.io/dashboard/personal/billing) |
| Tigris object storage | Corpus database and audio objects in `telugu-now-corpus`. Standard global/single-region storage is listed at $0.02/GB/month; location type and storage class affect rates. | [Tigris storage rates](https://www.tigrisdata.com/pricing/), [Detailed rates and allowances](https://www.tigrisdata.com/pricing.md), [Fly-linked billing](https://fly.io/docs/tigris/#pricing-and-billing) |
| Tigris requests | Uploads and inventory listing use Class A requests; reads use Class B. Standard global/single-region rates are $0.005/1,000 Class A and $0.0005/1,000 Class B requests before allowances. Startup availability rebuilds perform inventory listing. | [Request rates and definitions](https://www.tigrisdata.com/pricing.md) |
| Optional Tigris features | Infrequent/archive storage can have retrieval and minimum-retention costs; notifications and additional regional copies can add charges if enabled. Tigris egress is free, but that does not remove Fly's charges for proxying audio to browsers. | [Storage classes, replication, and other rates](https://www.tigrisdata.com/pricing.md) |

For bucket-level usage, open **Tigris Object Storage** in the
[Fly dashboard](https://fly.io/dashboard), or run:

```bash
fly storage dashboard telugu-now-corpus
```

In the [Tigris console](https://console.storage.dev), use **Sign in with Fly.io**
for a Fly-linked bucket. Usage reporting can lag. Tigris currently lists monthly
allowances of 5 GB standard storage, 10,000 Class A requests, and 100,000 Class B
requests; confirm the applicable account allowances rather than assuming all
usage is free.

[Fly cost management](https://fly.io/docs/about/cost-management/) explains why
free allowances are not spending caps. [Legacy plan allowances](https://fly.io/docs/about/discontinued-plans/)
depend on organization eligibility. Stopping the app does not stop storage billing.

## Pollinations.ai

**Overall cost:** use the [Pollen dashboard](https://enter.pollinations.ai/pollen)
for the wallet, purchases, and automatic top-up settings, and the
[account dashboard](https://enter.pollinations.ai) for account usage. Pollinations
is billed separately from Fly. Purchased credit and consumed credit are different:
a top-up is money paid, while generation consumes the wallet balance.

| Possible cost | What applies to this app | Pricing / usage links |
|---|---|---|
| Pollen purchases | Pollen is prepaid API credit, with **$1 approximately equal to 1 Pollen**. Checkout determines available payment methods and local pricing. A monthly subscription is not required. | [Buy/view Pollen](https://enter.pollinations.ai/pollen), [Pollen billing FAQ](https://github.com/pollinations/pollinations/blob/main/enter.pollinations.ai/POLLEN_FAQ.md) |
| Image generation | The app selects `microsoft/mai-image-2.5-flash` in `upa/shared/image-settings.ts`. Its price is usage-based, not a fixed price per image. Prompt tokens and generated image tokens contribute to the charge. | [Model catalog](https://enter.pollinations.ai/models), [Live image pricing JSON](https://gen.pollinations.ai/image/models) |
| Additional catalog images | Each image added to a word's catalog is another provider request and can consume more Pollen. Regeneration no longer replaces an image, so repeatedly pressing Next at the end of a catalog keeps generating new images and keeps consuming credit. Viewing a stored catalog image does not generate anything; its storage and delivery are Fly costs. | [Generation API documentation](https://gen.pollinations.ai/docs), [Application image settings](upa/shared/image-settings.ts) |
| Letter text-to-speech | The individual-letter view generates speech for a Telugu letter through the Pollinations `openai-audio` model on the text endpoint, using the same `pollinations_api_key`. Audio models are priced per token like the image models, so each first-time letter is a billable request. Results are cached in a shared server table and reused for every user, so a given letter is normally generated only once. | [Model catalog](https://enter.pollinations.ai/models), [Live text pricing JSON](https://gen.pollinations.ai/text/models) |
| Automatic top-ups | If enabled in the provider dashboard, a low wallet balance can lead to additional purchases. Review this separately from per-key spending limits. | [Pollen/top-up settings](https://enter.pollinations.ai/pollen), [Payment FAQ](https://github.com/pollinations/pollinations/blob/main/enter.pollinations.ai/POLLEN_FAQ.md#-what-payment-options-are-available) |
| Other models or services | Text, video, and other models have separate usage units and prices if added later. The app's current Pollinations integration is image generation and letter text-to-speech; existing corpus audio is not generated by Pollinations. | [All model prices](https://enter.pollinations.ai/models), [API reference](https://gen.pollinations.ai/docs) |

For the selected MAI Image 2.5 Flash model, the live catalog listed these rates
at review time:

| Usage component | Pollen per token | Pollen per 1 million tokens |
|---|---|---|
| Prompt text | 0.0000013125 | 1.3125 |
| Input image (if supplied) | 0.0000013125 | 1.3125 |
| Output image | 0.000014625 | 14.625 |

The current app sends a text prompt, not an input image. Do not interpret the
output-token rate as a per-image price; total usage varies by request. Consult
the live catalog and actual account usage before estimating a generation budget.

All app users' generation requests use the server's `pollinations_api_key`, so
costs accrue to that key's account, not separately to each app profile.
Use [API key settings](https://enter.pollinations.ai/keys) for budgets, expiry,
and model restrictions. This key is distinct from the deployment `FLY_API_TOKEN`.
Eligible Quest Pollen may offset usage, but rewards and model eligibility can
change; they are not a guaranteed free allowance. The
[wallet FAQ](https://github.com/pollinations/pollinations/blob/main/enter.pollinations.ai/POLLEN_FAQ.md#-how-does-my-pollen-wallet-work)
also warns that final request costs can exceed estimates and make a balance
negative. Do not treat a prepaid balance as a guaranteed hard spending cutoff.

## Serper.dev

**Overall cost:** use the [Serper dashboard](https://serper.dev/dashboard) for the
remaining credit balance, request history, and top-ups, and
[Serper billing](https://serper.dev/billing) for purchases and plans. Serper is
billed separately from Fly and Pollinations.

Serper powers the word view's web image search. Credits are prepaid and consumed
per API request, so this is not a fixed monthly cost.

| Possible cost | What applies to this app | Pricing / usage links |
|---|---|---|
| Image search requests | `GET /api/word-images/search` calls the Serper `images` endpoint once per word that is not already cached, requesting one page of results. Each call consumes credit from the account behind `SERPER_API_KEY`. | [Serper pricing](https://serper.dev/pricing), [Images API reference](https://serper.dev/playground) |
| Repeat searches | Results are stored in the shared `image_search_cache` table keyed by the searched word, so a repeated search for the same word by any user reuses the stored results and makes no new request. Clearing that cache or changing the searched word causes new billable requests. | [Application search service](upa/server/src/services/shared-media-service.ts) |
| Saving a searched image | Saving a result downloads the image from its origin server, not from Serper, so it consumes no Serper credit. The download and the stored bytes are Fly network and volume costs. | [Fly data transfer rates](https://fly.io/docs/about/pricing/#data-transfer-pricing) |
| Prepaid credits and plans | Serper sells credit packs and monthly plans; free introductory credits may apply to new accounts. Confirm the current plan, credit balance, and expiry rather than assuming search is free. | [Serper pricing](https://serper.dev/pricing), [Dashboard](https://serper.dev/dashboard) |

All users' searches use the server's single `SERPER_API_KEY`, so costs accrue to
that key's account rather than to individual app profiles. This key is distinct
from `pollinations_api_key` and from the deployment `FLY_API_TOKEN`.

## GitHub Codespaces

**Overall cost:** use [GitHub billing and plans](https://github.com/settings/billing)
for the account's Codespaces usage, included allowances, and spending limit, and
[Codespaces usage](https://github.com/settings/billing/summary) for current core
hours and storage. Codespaces is billed by GitHub, separately from Fly.

The Codespace matters to this project specifically because it is the machine that
holds the `FLY_API_TOKEN` Codespaces secret and is where `ci-cd/deploy.sh` is run
to deploy the app. Deployments are performed from the Codespace, so keeping it
available has a cost even when no deployment is happening.

| Possible cost | What applies to this app | Pricing / usage links |
|---|---|---|
| Compute (core hours) | Billed per core-hour while the Codespace is running, at a rate that scales with the machine size. Running a deploy, a build, or the dev server keeps the Codespace active and consuming core hours. | [Codespaces pricing](https://docs.github.com/en/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces), [Machine types](https://docs.github.com/en/codespaces/developing-in-a-codespace/changing-the-machine-type-for-your-codespace) |
| Storage | Billed per GB-month for the Codespace's storage, including stopped Codespaces. A stopped Codespace stops core-hour charges but keeps storage charges. | [Codespaces pricing](https://docs.github.com/en/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces) |
| Idle and retention settings | Idle timeout and retention periods determine how long a Codespace keeps running and how long a stopped Codespace is kept before deletion, so they directly affect both charges. | [Timeout settings](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces), [Retention settings](https://docs.github.com/en/codespaces/setting-your-user-preferences/configuring-automatic-deletion-of-your-codespaces) |
| Included allowances | Personal accounts include a monthly allowance of core hours and storage; usage beyond it is charged to the account's payment method up to the spending limit. Confirm the current allowance rather than assuming deployments are free. | [Included storage and core hours](https://docs.github.com/en/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces#monthly-included-storage-and-core-hours-for-personal-accounts), [Spending limit](https://docs.github.com/en/billing/managing-billing-for-github-codespaces/managing-spending-limits-for-github-codespaces) |
| GitHub Actions alternative | `.github/workflows/deploy.yml` is disabled scaffolding. If it is enabled, deployments run on Actions runners and consume Actions minutes instead of Codespaces core hours, which is a separate billing line. | [Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) |

Stopping the Codespace stops compute charges but not its storage charges, in the
same way that stopping the Fly Machines does not stop volume charges.
