# Tokens

Never commit token values. Store each credential only in the secret system used by its consumer.

## Fly.io deploy token

**Name:** `FLY_API_TOKEN`

**Purpose:** Authorizes deployment of Telugu Now to Fly.io.

**Storage and use:** Store it as a GitHub repository Actions secret named `FLY_API_TOKEN`. The deployment workflow passes it to the Fly deployment step as an environment variable. A Codespaces secret with the same name may also be used for manual deployments from the development environment.

## Tigris access keys

**Names:** `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

**Purpose:** Authenticate the server to the Tigris S3-compatible object store used for corpus and media objects.

**Storage and use:** Store both values as Fly secrets for production. For local development, define them in the Git-ignored `local-machine/dev-secrets.env` file when access to Tigris is required. Treat both values as credentials and never send them to the browser.

## Pollinations token

**Name:** `pollinations_api_key`

**Purpose:** Authorizes server-side Pollinations image-generation requests for word illustrations.

**Storage and use:** Store it as a Fly secret for production. For local development, define it in the Git-ignored `local-machine/dev-secrets.env` file. Only the server reads this token; it must never be sent to the browser.

## Serper token

**Name:** `serper_api_key`

**Purpose:** Authorizes server-side Serper image-search requests used to find licensed word illustrations.

**Storage and use:** Store it as a Fly secret for production. For local development, define it in the Git-ignored `local-machine/dev-secrets.env` file. Only the server reads this token; it must never be sent to the browser.
