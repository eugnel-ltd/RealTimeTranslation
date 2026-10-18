# Real-Time Speech Translator

This repository contains two independent applications for real-time speech translation using Azure Cognitive Services:

1. A standalone Python desktop application (`translator_app.py`)
2. A web application with a React frontend (`client/`), a Cloudflare Worker API (`worker/`), and shared logic (`shared/`)

Both applications provide real-time speech translation capabilities but are completely independent of each other. The Python app was the initial implementation, while the web application is a more feature-rich, full-stack solution developed later.

The web app deploys as a single Cloudflare Worker (`rtt`, custom domain `rtt.eugnel.com`). See [DEPLOY.md](DEPLOY.md) for secrets, vars, and smoke tests. API keys must not be placed in `VITE_*` client env vars.

## Features

### Common Features
- Real-time speech recognition and translation
- Support for multiple languages
- Bilingual output capability
- Lightweight and easy to use

### Python Desktop App (`translator_app.py`)
- Simple desktop interface using tkinter
- Semi-transparent, always-on-top window mode
- Easy to run locally

### Web Application (`client`)
- Modern, responsive web interface
- Dark/light theme support
- Type-safe frontend implementation
- Session type templates (screening, AI/timed, competency, one-way AI video, meeting) from `shared/sessionTemplates.ts`
- AI Answer: auto-detect toggle (hotkey D), typed questions (Enter / hotkey Q), generous manual question extract, optional prep + speak timers
- Keyboard shortcuts overlay (`?`) including the new auto-detect and question-input keys

## Tech Stack

The repository contains two separate applications with different tech stacks:

### Python Desktop App
- Python
- Azure Cognitive Services Speech SDK
- tkinter for GUI
- python-dotenv for environment management

### Web Application
- React 18 with TypeScript
- Vite for build tooling and HMR (Hot Module Replacement)
  - Using @vitejs/plugin-react for Babel-based Fast Refresh
- TailwindCSS for styling
- Framer Motion for animations
- Microsoft Cognitive Services Speech SDK
- Heroicons for UI icons
- ESLint with TypeScript-aware configuration

## Prerequisites

### For Python Desktop App
1. Python 3.11 or higher
2. Azure Cognitive Services Speech account
3. Required Python packages (see requirements.txt)

### For Web Application
1. Node.js 22 or 24 and later (the package engine ranges exclude Node.js 23)
2. npm or yarn package manager
3. Azure Cognitive Services Speech account

## Setup

### Python Desktop App
1. Set up the Python environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Add your Azure Speech Service credentials:
     ```
     SPEECH_KEY=your_azure_speech_key
     SPEECH_REGION=your_azure_region
     ```

3. Run the application:
   ```bash
   python translator_app.py
   ```

### Web Application
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd RealTimeTranslation
   ```

2. Install the Worker and client dependencies:
   ```bash
   npm ci
   npm --prefix client ci
   ```

3. Configure the Worker's local variables (the browser never holds a provider key; it gets a short-lived speech token from `/api/speech-token`):
   ```bash
   cp .dev.vars.example .dev.vars
   # fill the keys in .dev.vars; keep SKIP_ACCESS_CHECK=true for local work
   ```
   See [DEPLOY.md](DEPLOY.md) for each secret and variable.

## Development

### Python Desktop App
1. Run the application:
   ```bash
   python translator_app.py
   ```

### Web Application
1. Start the Worker (port 8787) and, in a second terminal, the client (Vite proxies `/api` to the Worker):
   ```bash
   npm run dev:worker
   npm run dev:client
   ```

2. Open `http://localhost:38220` in your browser

### Frontend Development Notes
- The project uses TypeScript with strict type checking
- ESLint checks JavaScript/TypeScript correctness and React hook usage; TypeScript checks types separately
- React 18.3 is used with modern JSX runtime
- Hot Module Replacement (HMR) is enabled for fast development
- Worker, browser and browser-aware test code use separate TypeScript configurations

### Verification

From the repository root, after installing both dependency trees:

```bash
npm test              # regression suite; provider calls are mocked
npm run typecheck     # Worker, tests, browser app and Vite config
npm run lint          # client, Worker, shared code, tests and scripts
npm run build         # production client build and provider-key pattern scan
```

The browser answer client accepts LF/CRLF SSE and final unterminated events. Cancelling an answer or translation propagates to its provider request. Transcript replay with `--answer` exits nonzero on an SSE error or a stream that ends before `done`.

## Project Structure

```
RealTimeTranslation/
├── translator_app.py       # Standalone Python desktop application
├── requirements.txt        # Python desktop dependencies
├── client/                 # React/Vite frontend and its dependencies
├── worker/src/             # Access-protected API and provider integrations
├── shared/                 # Session templates, language and transcript logic
├── tests/                  # Node regression suite, including browser service tests
├── scripts/                # Bundle scan, smoke and transcript replay tools
├── wrangler.jsonc          # Worker deployment configuration
└── readme.md
```

## Key Features

### Python Desktop App
1. **Speech Recognition**
   - Real-time speech capture and recognition
   - Support for multiple input languages
   - Configurable speech recognition settings

2. **Translation**
   - Simultaneous translation to multiple languages
   - Support for bilingual output
   - High-accuracy Azure-powered translation

3. **User Interface**
   - Simple desktop interface using tkinter
   - Easy to use and navigate

### Web Application
1. **Speech Recognition**
   - Real-time speech capture and recognition
   - Support for multiple input languages
   - Configurable speech recognition settings

2. **Translation**
   - Simultaneous translation to multiple languages
   - Support for bilingual output
   - High-accuracy Azure-powered translation

3. **User Interface**
   - Modern, responsive design
   - Dark/light theme support
   - Semi-transparent window mode
   - Always-on-top functionality

4. **Performance**
   - Efficient real-time processing
   - Optimized memory usage
   - Smooth user experience

## Available Languages

The application supports translation between multiple languages, including:
- English (US)
- Cantonese
- Chinese (Simplified)
- Chinese (Traditional)
- Japanese
- Korean

Additional languages can be configured through the settings interface.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Azure Cognitive Services team
- React and TypeScript communities
- Python community
