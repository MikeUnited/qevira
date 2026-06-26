# Contributing

## Branching

- Always branch from `main`.
- Do **not** push directly to `main`.

## Pull requests

- At least **one approval** is required before merging.

## Commits

- Use **conclusion-first** messages that state what changed or was added (for example: `Add OTP verification`).
- Avoid vague placeholders such as `WIP` or `fix stuff`.

## Environment setup

Copy `.env.example` to `.env.local` and fill in values for your machine.

- **SUPPLIER_ALIAS_SALT** — Required. 32-byte base64 secret for weekly supplier alias rotation. Generate with: `openssl rand -base64 32`. Never commit the actual value.
