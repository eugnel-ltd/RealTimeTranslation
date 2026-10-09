# Real-Time Speech Translator

This repository contains two independent applications for real-time speech translation using Azure Cognitive Services:

1. A standalone Python desktop application (`translator_app.py`)
2. A modern web application (in the `client` directory) with React frontend

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
  - Using @vitejs/plugin-react-swc for SWC-based Fast Refresh
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
1. Node.js (v18 or higher recommended)
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

2. Install frontend dependencies:
   ```bash
   cd client
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env` in the root directory
   - Add your Azure Speech Service credentials:
     ```
     SPEECH_KEY=your_azure_speech_key
     SPEECH_REGION=your_azure_region
     ```

## Development

### Python Desktop App
1. Run the application:
   ```bash
   python translator_app.py
   ```

### Web Application
1. Start the frontend development server:
   ```bash
   cd client
   npm run dev
   ```

2. Open `http://localhost:38220` in your browser

### Frontend Development Notes
- The project uses TypeScript with strict type checking
- ESLint is configured for type-aware linting
- React 18.3 is used with modern JSX runtime
- Hot Module Replacement (HMR) is enabled for fast development
- Custom ESLint rules and TypeScript configurations are in place for code quality

## Project Structure

```
RealTimeTranslation/
├── translator_app.py      # Standalone Python desktop application
├── requirements.txt       # Python dependencies for desktop app
├── settings.json         # Settings for Python app
│
├── client/              # Independent web application
│   ├── src/            # Source code
│   ├── public/         # Static assets
│   ├── package.json    # Frontend dependencies
│   └── vite.config.ts  # Vite configuration
│
├── .venv/              # Python virtual environment
└── README.md          # Project documentation
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
