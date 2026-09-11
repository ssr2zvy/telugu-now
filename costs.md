# Usage and costs

## Billing and usage dashboards

- [Fly organization billing](https://fly.io/dashboard/personal/billing): current-month usage, upcoming invoices, Cost Explorer, and past invoices. Charges for Fly-linked Tigris storage appear on the same Fly bill.
- [Fly dashboard](https://fly.io/dashboard): open **Tigris Object Storage** to inspect bucket storage and request usage.
- [Tigris console](https://console.storage.dev): use **Sign in with Fly.io** for Fly-linked buckets, not a separate standalone account. Usage reporting may lag.

Open this application's bucket directly:

```bash
fly storage dashboard telugu-now-corpus
```

## Selected volume

`telugu_now_data`: **3 GB in `iad` (Ashburn, Virginia)**, mounted at `/data`.
At the published rate of $0.15 per allocated GB/month, its storage baseline is
approximately **$0.45/month**, before applicable credits or allowances.
Billing is prorated hourly while the volume exists, even when unattached or its
Machine is stopped. Machine runtime, snapshots, network traffic, Tigris, and
image-generation charges are separate.

## Pricing and billing references

- [Fly resource pricing](https://fly.io/docs/about/pricing/)
- [Fly billing details](https://fly.io/docs/about/billing/)
- [Fly cost management](https://fly.io/docs/about/cost-management/): free allowances are not spending caps; do not assume an automatic budget cutoff.
- [Fly legacy allowances](https://fly.io/docs/about/discontinued-plans/): eligibility depends on the organization's plan.
- [Tigris pricing](https://www.tigrisdata.com/pricing/)
- [Tigris detailed rates and free allowances](https://www.tigrisdata.com/pricing.md)
- [Fly-linked Tigris billing](https://fly.io/docs/tigris/#pricing-and-billing)

Rates were reviewed on 2026-09-11. Use the live dashboards and pricing pages for
current charges. Tigris's free egress does not remove Fly's outbound bandwidth
charges when the application proxies audio to browsers.
