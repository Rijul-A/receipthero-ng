# 🧾 ReceiptHero

[![GitHub Stars](https://img.shields.io/github/stars/smashah/receipthero-ng)](https://github.com/smashah/receipthero-ng)
[![License](https://img.shields.io/github/license/smashah/receipthero-ng)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-blue?logo=docker)](docker-compose.yml)

---

**ReceiptHero** is an AI-powered receipt management companion for [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) that automatically extracts, organizes, and converts your receipts using advanced vision AI.

It transforms your chaotic receipt archive into a **searchable, structured database** with automatic vendor detection, item extraction, and **multi-currency conversion** — all through a beautiful real-time dashboard.

> 💡 Just upload a receipt and let AI do the rest:
>
> - Vendor name, date, and total amount extracted automatically
> - Line items parsed with individual prices
> - Currency converted to your preferred currencies
> - Paperless-ngx updated with structured metadata

Powered by **TanStack AI** with support for multiple LLM providers — Together AI, Ollama, OpenRouter, and any OpenAI-compatible endpoint.

---

## 🎬 See It In Action

[![Watch the tutorial](docs/images/dashboard.png)](https://youtu.be/LNlUDtD3og0)

> 👆 **Click to watch the tutorial video**

---

## ✨ Features

### 🤖 AI-Powered Receipt Extraction

- Multi-provider AI support via TanStack AI (Together AI, Ollama, OpenRouter, any OpenAI-compatible API)
- Extracts vendor, amount, currency, date, payment method
- Parses individual line items with prices
- Handles receipts in any language
- Smart retry with exponential backoff for reliability

<!-- TODO: Add screenshot of processed receipt in Paperless -->

![Receipt Extraction Demo](docs/images/receipt-extraction.png)

### 💱 Automatic Currency Conversion

- Convert receipt amounts to multiple target currencies
- Uses fawazahmed0 exchange-api with dual CDN fallback
- Weekly average exchange rates for accuracy
- Source currency always preserved alongside conversions
- Configure your preferred currencies (GBP, USD, EUR, SAR, etc.)

<!-- TODO: Add screenshot of currency totals card -->

![Currency Conversion](docs/images/currency-conversion.png)

### 💰 Cross-Vendor Price Comparison

- Search item names seen across your processed receipts and compare prices across stores
- AI-powered canonicalization automatically groups the same product across differently-worded
  receipts (e.g. "Almarai Milk 1L" vs. "Al Marai Fresh Milk 1L"), one batched call per receipt —
  browsing the comparison page never triggers an AI request
- Compares by unit price (not raw total), so different pack sizes/quantities don't skew results
- Falls back gracefully to raw item names if the AI provider is unavailable

### 📊 Real-Time Dashboard

- **System Health**: Live status of all integrations
- **Currency Totals**: Aggregated spending in all your currencies
- **Integration Stats**: Documents detected, processed, failed, queued
- **Worker Control**: Pause, resume, retry all, clear queue
- **Live Logs**: Real-time processing updates via WebSocket

<!-- TODO: Add dashboard screenshot -->

![Dashboard](docs/images/dashboard.png)

### ⚙️ Easy Configuration

- Web-based settings page for all options
- Test connections before saving
- Dynamic currency list from live exchange rates
- No config files needed (but supported)

<!-- TODO: Add settings page screenshot -->

![Settings](docs/images/settings.png)

### 🔗 Seamless Paperless-ngx Integration

- Automatic document title: `{Vendor} - {Amount} {Currency}`
- Creates correspondents for vendors
- Applies category tags automatically
- Stores full receipt JSON in custom fields
- Tags processed/failed documents for tracking

---

## 🚀 Quick Start

### Docker (Recommended)

**Option A: Clone the repo**

```bash
git clone https://github.com/smashah/receipthero-ng.git
cd receipthero-ng
docker compose up -d
open http://localhost:3000
```

**Option B: Deploy from pre-built image (fastest)**

```bash
# Create the directory structure in your services folder
mkdir -p ~/services/receipthero/data

# Create a minimal config file
cat > ~/services/receipthero/data/config.json << 'EOF'
{
  "paperless": {
    "host": "http://YOUR_PAPERLESS_IP:8000",
    "apiKey": "YOUR_PAPERLESS_API_KEY"
  }
}
EOF

# Create docker-compose.yaml
cat > ~/services/receipthero/docker-compose.yaml << 'EOF'
services:
  receipthero:
    image: ghcr.io/smashah/receipthero-ng:latest
    environment:
      - DATABASE_PATH=/app/data/receipthero.db
      - CONFIG_PATH=/app/data/config.json
      - BUN_DEV_SERVER_PORT=3099
    volumes:
      - ./data:/app/data
    ports:
      - "3000:3000" #Change the first number because most likely the 3000 port is already taken on your machine!
    restart: unless-stopped
EOF

# Start the container
cd ~/services/receipthero
docker compose up -d

# Open the dashboard
open http://localhost:3000
```

> 📁 **Directory Structure:**
>
> ```
> ~/services/receipthero/
> ├── docker-compose.yaml
> └── data/
>     ├── config.json          # Your configuration
>     └── receipthero.db       # Created automatically
> ```

### First-Time Setup

1. Open the webapp at `http://localhost:3000`
2. Click **Configure** to open settings
3. Enter your Paperless-ngx host and API key
4. Select your AI provider and enter credentials:
   - **Together AI** (default): Enter your API key
   - **Ollama**: Set the base URL to your Ollama instance
   - **OpenRouter**: Enter your API key
   - **Custom OpenAI-compatible**: Enter API key and base URL
5. (Optional) Enable currency conversion and select target currencies
6. Click **Save** and you're ready!

> 💡 **Tip**: Click "Test Connection" buttons to verify your setup before saving.

---

## ⚙️ Configuration: how the pieces fit together

There are three ways to configure ReceiptHero, and it's worth knowing how they interact:

1. **The Settings page** (`http://localhost:3000/settings`) — the recommended way for most options. Saving here writes straight to `config.json` on disk.
2. **`config.json`** (at `CONFIG_PATH`, `/app/data/config.json` by default) — hand-edit this directly if you prefer config-as-code, or if you're bootstrapping a fresh deploy (see the Quick Start example above). A default template is created automatically on first run if the file doesn't exist yet.
3. **Environment variables** (`PAPERLESS_HOST`, `AI_API_KEY`, `AI_MODEL`, `AI_TEMPERATURE`, `AI_MAX_TOKENS`, `SCAN_INTERVAL`, etc.) — useful for container-native deploys (e.g. injecting secrets via your orchestrator instead of a mounted file).

**Precedence**: for any given setting, `config.json` wins if it has that key set; otherwise the environment variable is used; otherwise a built-in default. In other words, editing something in the Settings page (which writes to `config.json`) will always override an env var for that same field — so if a setting isn't updating the way you expect, check whether `config.json` already has an explicit value for it.

**Workflows are separate from all of this.** The AI provider/model/temperature/token-limit settings above are global — they apply to every workflow's extraction call. What varies _per workflow_ (see [Workflows](#-workflows) below) is the trigger tag, the extraction schema, and the prompt instructions — not which model or provider is used.

---

## 🐳 Docker Support

- Health monitoring with auto-restart
- Persistent SQLite database
- Graceful shutdown handling
- Single container for API + Worker + Webapp
- Works out of the box with minimal configuration

Every release also publishes a `:debug`-suffixed image (e.g. `ghcr.io/smashah/receipthero-ng:latest-debug`) alongside the normal one — same code, but unminified, for when a webapp error needs a readable stack trace instead of a minified one.

---

## 💱 Currency Conversion

Enable automatic conversion to track spending in your preferred currencies:

```json
{
  "processing": {
    "currencyConversion": {
      "enabled": true,
      "targetCurrencies": ["GBP", "USD", "SAR"]
    }
  }
}
```

Your receipts will include converted amounts:

```json
{
  "amount": 10,
  "currency": "AED",
  "conversions": {
    "AED": 10.0,
    "GBP": 2.15,
    "USD": 2.72,
    "SAR": 10.22
  }
}
```

The dashboard displays aggregated totals for each currency, giving you instant visibility into your spending across currencies.

---

## 🤖 AI Provider Configuration

ReceiptHero supports multiple AI providers via [TanStack AI](https://tanstack.com/ai). Configure your preferred provider in the settings page or via `config.json`:

### Together AI (Default)

```json
{
  "ai": {
    "provider": "openai-compat",
    "apiKey": "YOUR_TOGETHER_API_KEY",
    "model": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"
  }
}
```

### Ollama (Local/Self-Hosted)

```json
{
  "ai": {
    "provider": "ollama",
    "baseURL": "http://localhost:11434",
    "model": "qwen2.5vl:7b"
  }
}
```

> **Local model tip**: extraction quality scales heavily with model size on dense/long receipts (many line items). A 7B-class model is a reasonable starting point, but if you're seeing missed or duplicated line items, a bigger model (VRAM permitting) or a document-OCR-focused model (e.g. `benhaotang/Nanonets-OCR-s`) is often a bigger lever than prompt tweaking.

### OpenRouter

```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "YOUR_OPENROUTER_KEY",
    "model": "meta-llama/llama-4-maverick"
  }
}
```

### Any OpenAI-Compatible API

```json
{
  "ai": {
    "provider": "openai-compat",
    "apiKey": "YOUR_API_KEY",
    "baseURL": "https://your-api-host/v1",
    "model": "your-model-name"
  }
}
```

> **Note**: The model must support vision/image input for receipt extraction to work.

### Advanced: Temperature & Max Output Tokens

These apply globally, regardless of provider:

```json
{
  "ai": {
    "temperature": 0,
    "maxTokens": 8192
  }
}
```

- **`temperature`** (default `0`): controls randomness. `0` gives the most consistent, repeatable extraction for the same image — there's rarely a good reason to raise this for structured data extraction.
- **`maxTokens`** (default `8192`): the output length cap. If a dense receipt (lots of line items) gets cut off mid-response — visible in the logs as invalid/truncated JSON — raise this.

---

## 🧩 Workflows

Workflows define _what_ gets extracted and _when_, separately from _which model_ does the extracting (that's the AI provider config above). A default "Receipt" workflow is seeded automatically on first run.

Each workflow has:

- **Trigger tag**: the Paperless-ngx tag that queues a document for this workflow (default: `receipt`)
- **Zod schema**: the shape of the data to extract (vendor, amount, line items, etc.) — edited as Zod source in the workflow editor, converted to a JSON Schema for the AI's structured-output call
- **Prompt instructions**: extra guidance appended to the extraction prompt (e.g. how to distinguish pre-tax vs. post-tax amounts, how to handle duplicate line items)
- **Output mapping**: which extracted fields become the Paperless correspondent, document date, tags, and custom fields
- **Include Paperless OCR text** (opt-in, off by default): sends Paperless's own OCR pass alongside the image as extra reference context. Can help on documents where Paperless's OCR is more reliable than the vision model's own reading — but also adds to the prompt length, so on a smaller/weaker local model it can push a dense receipt past `maxTokens` and cause truncation. Worth A/B testing rather than assuming it helps.

Use **Test Extraction** in the workflow editor to try a schema/prompt change against an uploaded image without touching any real Paperless documents — it calls the same extraction code path as real processing, just without downloading from or writing back to Paperless.

You can create additional workflows for other document types (e.g. invoices, warranties) triggered by different tags — each with its own schema and prompt, all still using the single globally-configured AI provider/model.

---

## 📁 Document Type Detection

By default, ReceiptHero looks for documents tagged with `receipt`. If you already have document types set up in Paperless-ngx, you can detect receipts by `document_type` instead:

```json
{
  "processing": {
    "useDocumentType": true,
    "documentTypeName": "receipt"
  }
}
```

When enabled:

- Documents with `document_type = "receipt"` are automatically processed
- No need to manually tag receipts
- Works with your existing Paperless-ngx document type workflow

---

## 🧭 Roadmap

- [x] AI-powered receipt extraction
- [x] Multi-provider AI support (Together AI, Ollama, OpenRouter)
- [x] Multi-currency conversion
- [x] Real-time dashboard with live logs
- [x] Worker pause/resume controls
- [x] Web-based configuration
- [x] Document type detection (alternative to tag-based)
- [x] Cross-vendor price comparison with AI-powered item matching
- [ ] Receipt analytics and charts
- [ ] Monthly/weekly spending reports
- [ ] Export to CSV/Excel
- [ ] Mobile-responsive design improvements
- [ ] Batch reprocessing of old receipts

---

## 🔧 Development

### Local Setup

```bash
# Install dependencies
pnpm install

# Start all services (API + Worker + Webapp)
pnpm run dev

# API: http://localhost:3001
# Webapp: http://localhost:3000
```

### Commands

```bash
pnpm run dev        # Start development servers
pnpm run build      # Build for production
pnpm run test       # Run tests
pnpm turbo typecheck # Type check all packages
```

### Architecture

This is a Turborepo monorepo:

| Package         | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `@sm-rn/api`    | Hono API backend (Bun runtime)                                |
| `@sm-rn/webapp` | TanStack Start frontend                                       |
| `@sm-rn/worker` | Background processing worker                                  |
| `@sm-rn/core`   | Core services (Paperless, OCR, currency, AI adapter, logging) |
| `@sm-rn/shared` | Shared types and schemas                                      |

### Tech Stack

**Backend:** Hono, Bun, Drizzle ORM, SQLite, TanStack AI  
**Frontend:** React 19, TanStack Start/Router, TypeScript  
**Infrastructure:** Turborepo, pnpm, Docker

---

## 📖 API Reference

<details>
<summary>Click to expand API endpoints</summary>

### Health & Configuration

- `GET /api/health` - Health check with stats
- `GET /api/config` - Get configuration (masked keys)
- `POST /api/config` - Save configuration
- `GET /api/config/currencies` - Get available currencies
- `POST /api/config/test-paperless` - Test Paperless connection
- `POST /api/config/test-ai` - Test AI provider connection

### Processing

- `POST /api/ocr` - Extract receipt data from image
- `GET /api/processing/logs` - Get processing logs
- `GET /api/processing/logs/:documentId` - Get document-specific logs

### Worker Control

- `GET /api/worker/status` - Get worker status
- `POST /api/worker/pause` - Pause worker
- `POST /api/worker/resume` - Resume worker
- `POST /api/worker/trigger-scan` - Trigger immediate scan

### Queue Management

- `GET /api/queue/status` - Get queue status
- `POST /api/queue/retry-all` - Retry all failed items
- `POST /api/queue/clear` - Clear the queue

### Statistics

- `GET /api/stats/currency-totals` - Get aggregated currency totals

### Price Comparison

- `GET /api/items/search?q=` - Search canonical item names from processed receipts
- `GET /api/items/history?names=` - Price history for one or more item names, newest first

</details>

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit PRs.

```bash
# Fork, clone, then:
git checkout -b feature/YourFeature
# After changes:
git commit -m "Add YourFeature"
git push origin feature/YourFeature
```

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## 🙏 Support

If ReceiptHero helps you manage your receipts, consider:

- ⭐ Starring the repository
- 🐛 Reporting bugs and suggesting features
- 🤝 Contributing code or documentation

---

<p align="center">
  Made with ❤️ for the Paperless-ngx community
</p>
