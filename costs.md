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
| Regeneration and additional requests | Regenerating an image makes another provider request and can consume more Pollen. Viewing a stored image does not itself generate a new image; its storage and delivery are Fly costs. | [Generation API documentation](https://gen.pollinations.ai/docs), [Application image settings](upa/shared/image-settings.ts) |
| Automatic top-ups | If enabled in the provider dashboard, a low wallet balance can lead to additional purchases. Review this separately from per-key spending limits. | [Pollen/top-up settings](https://enter.pollinations.ai/pollen), [Payment FAQ](https://github.com/pollinations/pollinations/blob/main/enter.pollinations.ai/POLLEN_FAQ.md#-what-payment-options-are-available) |
| Other models or services | Text, video, audio, and other models have separate usage units and prices if added later. The app's current Pollinations integration is image generation; existing corpus audio is not generated by Pollinations. | [All model prices](https://enter.pollinations.ai/models), [API reference](https://gen.pollinations.ai/docs) |

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
