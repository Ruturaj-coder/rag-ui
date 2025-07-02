# Flask RAG System Setup Instructions

## 🚀 Quick Setup Guide

### 1. Backend Setup

#### Create Environment File
Create a `.env` file in the `backend/` directory with your Azure credentials:

```bash
# backend/.env

# Azure OpenAI Configuration
AZURE_OPENAI_API_KEY=your_azure_openai_api_key_here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_DEPLOYMENT_NAME=your_gpt_deployment_name

# Azure Cognitive Search Configuration  
AZURE_SEARCH_API_KEY=your_azure_search_api_key_here
AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net
AZURE_SEARCH_INDEX=your_search_index_name

# Flask Configuration
FLASK_ENV=development
FLASK_DEBUG=True
```

#### Install Dependencies
```bash
cd backend
pip install flask flask-cors python-dotenv azure-search-documents openai azure-core
```

#### Start Backend Server
```bash
cd backend
python app.py
```

The backend will start on `http://localhost:5000`

### 2. Frontend Setup

#### Install Dependencies
```bash
npm install
```

#### Start Frontend
```bash
npm run dev
```

The frontend will start on `http://localhost:5173` (or similar)

## 🧪 Testing the Setup

### 1. Test Backend Health
Visit: `http://localhost:5000/health`

Expected response when working:
```json
{
  "status": "healthy",
  "services": {
    "openai": true,
    "search": true
  },
  "missing_env_vars": []
}
```

### 2. Test Filter Endpoint
Visit: `http://localhost:5000/filters`

Expected response:
```json
{
  "authors": ["Author 1", "Author 2"],
  "file_types": ["pdf", "docx", "txt"]
}
```

### 3. Test Chat Endpoint
```bash
curl -X POST http://localhost:5000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?"}'
```

## 🔧 Troubleshooting

### Common Issues

#### 1. "Missing environment variables" error
- Check that your `.env` file exists in the `backend/` directory
- Verify all required variables are set with valid values
- Restart the Flask server after adding variables

#### 2. Azure connection errors
- Verify your Azure OpenAI and Search service credentials
- Check that your Azure resources are properly configured
- Ensure your IP is whitelisted if using restricted access

#### 3. CORS errors in frontend
- Make sure Flask-CORS is installed: `pip install flask-cors`
- Verify the backend is running on port 5000
- Check browser console for specific CORS error messages

#### 4. Frontend connection errors
- Ensure backend is running on `http://localhost:5000`
- Check that both services are running simultaneously
- Verify no firewall is blocking local connections

### Debug Mode

The backend includes extensive logging. Watch the console output for:
- ✅ Success messages (green checkmarks)
- ⚠️ Warnings (yellow triangles)  
- ❌ Error messages (red X marks)

### Mock Data Mode

If Azure services are not configured, the backend will automatically provide mock data to allow frontend testing.

## 📝 Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `AZURE_OPENAI_API_KEY` | Your Azure OpenAI API key | `abc123...` |
| `AZURE_OPENAI_ENDPOINT` | Your Azure OpenAI endpoint URL | `https://myopenai.openai.azure.com/` |
| `AZURE_DEPLOYMENT_NAME` | Your GPT model deployment name | `gpt-4` |
| `AZURE_SEARCH_API_KEY` | Your Azure Search admin key | `def456...` |
| `AZURE_SEARCH_ENDPOINT` | Your Azure Search service URL | `https://mysearch.search.windows.net` |
| `AZURE_SEARCH_INDEX` | Your search index name | `documents-index` |

## 🎯 Next Steps

1. Configure your Azure OpenAI and Cognitive Search services
2. Upload documents to your search index
3. Test the chat functionality with real queries
4. Customize the UI and add additional features as needed

Happy chatting! 🤖 