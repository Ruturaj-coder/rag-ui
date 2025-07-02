# Barclays RAG Chatbot

An intelligent document analysis chatbot built with React frontend and Flask backend, integrated with Azure OpenAI and Azure Search services.

## 🚀 Quick Start

### 1. Backend Setup

First, set up the Flask backend:

```bash
cd backend

# Create environment file
# Create a .env file in the backend directory with your Azure credentials

# Install dependencies
pip install -r requirements.txt

# Run Flask server
python flask_main.py
```

### 2. Frontend Setup

Set up the React frontend:

```bash
# Create frontend environment file
# Create a .env file in the root directory with:
echo "VITE_API_BASE_URL=http://localhost:8000" > .env
echo "VITE_AZURE_STORAGE_ACCOUNT_NAME=your_storage_account_name" >> .env
echo "VITE_AZURE_STORAGE_CONTAINER_NAME=your_container_name" >> .env

# Install dependencies
npm install

# Run development server
npm run dev
```

## 🔧 Configuration

### Frontend Environment Variables

Create a `.env` file in the root directory:

```env
# Backend API URL
VITE_API_BASE_URL=http://localhost:8000

# Azure Storage (for document links)
VITE_AZURE_STORAGE_ACCOUNT_NAME=your_storage_account_name
VITE_AZURE_STORAGE_CONTAINER_NAME=your_container_name
```

### Backend Environment Variables

Create a `.env` file in the `backend` directory:

```env
# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your_openai_api_key_here
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Azure Search Configuration
AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net/
AZURE_SEARCH_API_KEY=your_search_api_key_here
AZURE_SEARCH_INDEX_NAME=documents
```

## 🏗️ Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Flask + Azure OpenAI + Azure Search
- **Communication**: REST API with JSON

## 📚 Features

- **Intelligent RAG**: Retrieval-Augmented Generation with Azure OpenAI
- **Advanced Filtering**: Filter by authors, categories, date ranges, and specific documents
- **Voice Input**: Speech-to-text for hands-free querying
- **Text-to-Speech**: AI responses can be read aloud
- **Dark Mode**: Toggle between light and dark themes
- **Real-time Health Monitoring**: Backend service status monitoring
- **Document Integration**: Direct links to Azure Storage documents

## 🔗 API Endpoints

The backend provides these REST endpoints:

- `GET /health` - Service health check
- `POST /api/rag` - Process RAG queries
- `POST /api/search` - Search documents
- `GET /api/facets` - Get available filter facets
- `GET /api/config` - View configuration status

## 🛠️ Development

### Running in Development

1. **Start Backend**: `cd backend && python flask_main.py`
2. **Start Frontend**: `npm run dev`
3. **Access**: http://localhost:5173

### Building for Production

```bash
# Build frontend
npm run build

# Serve built files
npm run preview
```

### Corporate Environment

If you're in a corporate environment and can't install some packages:

```bash
# Try the simple server (uses only built-in Python libraries)
cd backend
python simple_server.py
```

## 📝 Integration Notes

The frontend automatically connects to the backend via the `apiService`. The integration includes:

- **Automatic Error Handling**: Network and API errors are handled gracefully
- **Type Safety**: Full TypeScript interfaces for all API communications
- **Real-time Status**: Backend health monitoring with visual indicators
- **Fallback Support**: Graceful degradation when services are unavailable

## Original Vite + React + TypeScript Info

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
