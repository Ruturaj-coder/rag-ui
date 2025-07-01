# Azure RAG Chatbot Setup Guide

This guide will help you configure your Azure services to work with the RAG chatbot.

## Prerequisites

You need the following Azure services set up:

- ✅ **Azure AI Search** (Required - for document search)
- ✅ **Azure OpenAI** (Required - for AI responses)
- ✅ **Azure Storage Account** (Required - for clickable source file access)

> **Note**: For the RAG workflow, documents are retrieved through Azure AI Search. Azure Storage Account configuration is needed to enable clickable source files that open the original documents.

## Environment Configuration

Create a `.env` file in your project root with the following variables:

```env
# Azure OpenAI Configuration
VITE_AZURE_OPENAI_ENDPOINT=https://your-openai-service.openai.azure.com/
VITE_AZURE_OPENAI_API_KEY=your-openai-api-key
VITE_AZURE_OPENAI_DEPLOYMENT_NAME=your-model-deployment-name
VITE_AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Azure AI Search Configuration
VITE_AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net
VITE_AZURE_SEARCH_API_KEY=your-search-admin-key
VITE_AZURE_SEARCH_INDEX_NAME=your-document-index-name

# Azure Storage Configuration (Required for clickable source files)
VITE_AZURE_STORAGE_ACCOUNT_NAME=your-storage-account
VITE_AZURE_STORAGE_CONTAINER_NAME=documents
VITE_AZURE_STORAGE_ACCOUNT_KEY=your-storage-account-key
```

## Azure AI Search Index Schema

Your Azure AI Search index should have the following fields:

### Required Field Configuration

Configure your fields exactly as shown below:

| Field                               | Type               | Key | Retrievable | Filterable | Sortable | Facetable | Searchable | Analyzer        |
| ----------------------------------- | ------------------ | --- | ----------- | ---------- | -------- | --------- | ---------- | --------------- |
| `metadata_storage_path`           | Edm.String         | ✅  | ✅          | ❌         | ❌       | ❌        | ❌         | -               |
| `content`                         | Edm.String         | ❌  | ✅          | ❌         | ❌       | ❌        | ✅         | Standard-Lucene |
| `metadata_title`                  | Edm.String         | ❌  | ✅          | ❌         | ✅       | ❌        | ✅         | Standard-Lucene |
| `metadata_author`                 | Edm.String         | ❌  | ✅          | ✅         | ✅       | ✅        | ✅         | Standard-Lucene |
| `metadata_storage_content_type`   | Edm.String         | ❌  | ✅          | ✅         | ❌       | ✅        | ❌         | -               |
| `metadata_storage_size`           | Edm.Int64          | ❌  | ✅          | ✅         | ✅       | ✅        | ❌         | -               |
| `metadata_storage_last_modified`  | Edm.DateTimeOffset | ❌  | ✅          | ✅         | ✅       | ✅        | ❌         | -               |
| `metadata_storage_name`           | Edm.String         | ❌  | ✅          | ✅         | ✅       | ✅        | ✅         | Standard-Lucene |
| `metadata_storage_file_extension` | Edm.String         | ❌  | ✅          | ✅         | ❌       | ✅        | ❌         | -               |

### Optional Fields (Configure as desired)

- `metadata_storage_content_md5` - ✅ Retrievable only
- `metadata_content_type` - ✅ Retrievable, ✅ Filterable, ✅ Facetable
- `metadata_language` - ✅ Retrievable, ✅ Filterable, ✅ Facetable
- `metadata_creation_date` - ✅ Retrievable, ✅ Filterable, ✅ Sortable, ✅ Facetable

### Index Configuration

#### 1. **Key Field**

- Set `metadata_storage_path` as your **Key field** (unique identifier)

#### 2. **Semantic Search** (REQUIRED)

1. Go to your Azure AI Search index settings
2. Navigate to **Semantic Search** tab
3. Create a new semantic configuration named `default`
4. Configure fields:
   - **Title field**: `metadata_title`
   - **Content fields**: `content`
   - **Keywords fields**: `metadata_author` (optional)

#### 3. **Suggester** (Optional)

- Field: `metadata_title`
- Name: `sg`

#### 4. **CORS Settings** (REQUIRED for frontend)

In your Azure AI Search service settings:

- Go to **CORS** tab
- Add your domain (e.g., `http://localhost:5173` for development)
- Or use `*` for testing (not recommended for production)

## Azure OpenAI Model Deployment

Deploy one of the following models in your Azure OpenAI service:

- **gpt-4** (recommended for best quality)
- **gpt-4-turbo** (faster responses)
- **gpt-35-turbo** (cost-effective option)

## Document Upload Process

1. **Upload documents** to your Azure Storage container
2. **Process and index** documents in Azure AI Search using your preferred method:
   - Azure AI Search Indexer (recommended - automatically indexes from Storage)
   - Custom indexing pipeline
   - Manual document upload via REST API

> **Note**: Once documents are indexed in Azure AI Search, the RAG chatbot accesses them directly through the Search service, not the Storage account.

## Quick Setup Checklist

### ✅ **Azure AI Search Configuration**

- [ ] Set `metadata_storage_path` as **Key field**
- [ ] Configure required fields as shown in the table above
- [ ] Enable **Semantic Search** with `default` configuration
- [ ] Set up **CORS** with your frontend domain
- [ ] Upload and index some test documents

### ✅ **Environment Variables**

- [ ] Create `.env` file with all required variables
- [ ] Verify Azure AI Search endpoint and API key
- [ ] Verify Azure OpenAI endpoint and API key
- [ ] Confirm model deployment name

### ✅ **Testing the Setup**

1. Start the development server:

   ```bash
   npm run dev
   ```
2. Check the service status badge in the header:

   - 🟢 **Azure Connected** = All services working
   - 🔴 **Azure Offline** = Configuration issues
3. Look for error messages in the error banner if connection fails

## Common Issues

### Authentication Errors

- Verify your API keys are correct
- Check that keys have proper permissions
- Ensure endpoints URLs are correct

### Search Errors

- Verify your index name exists
- Check that your index has documents
- Ensure semantic search is enabled

### OpenAI Errors

- Confirm your model deployment name
- Check deployment status in Azure portal
- Verify API version compatibility

### Field Configuration Errors

- Ensure `metadata_storage_path` is set as the **Key field**
- Verify `content` field is **Searchable**
- Check that `metadata_author` is **Filterable** and **Facetable**
- Confirm semantic search configuration uses correct field names

### CORS Errors

- Add your frontend domain to CORS settings in Azure AI Search
- For development, add `http://localhost:5173`
- Check browser console for specific CORS error messages

## Features Enabled

Once configured, you'll have access to:

- 🔍 **Semantic document search** with Azure AI Search
- 🤖 **AI-powered responses** with Azure OpenAI
- 🏷️ **Dynamic filtering** by authors, categories, dates
- 📊 **Source citations** with normalized relevance scores (0-100%)
- 📁 **Clickable source files** that open original documents from Azure Storage
- 🎛️ **Model configuration** (temperature, max tokens)
- 🎙️ **Voice input/output** capabilities

## Sample Query

Try asking:

> "What are the latest risk management recommendations?"

The system will:

1. Search your documents using Azure AI Search
2. Retrieve relevant content
3. Generate a response using Azure OpenAI
4. Provide source citations with relevance scores

## Troubleshooting 400 Bad Request Errors

If you're seeing **400 Bad Request** errors when loading filters, follow these debugging steps:

### 1. Check Browser Console

Open browser dev tools (F12) and look for debug messages starting with:

- 🔧 **Azure Configuration Check** - Shows which environment variables are set
- 🧪 **Testing basic search** - Tests connectivity to your search index
- 📋 **Available fields in index** - Shows what fields exist in your index
- 👤 **Possible author fields** - Identifies author-related fields
- 📂 **Possible type/category fields** - Identifies type/category fields

### 2. Common Causes & Fixes

**Missing Environment Variables:**

- Verify your `.env` file exists and has all required variables
- Check that `VITE_AZURE_SEARCH_ENDPOINT` and `VITE_AZURE_SEARCH_API_KEY` are set
- Restart your dev server after updating `.env`

**Wrong Index Name:**

- Verify `VITE_AZURE_SEARCH_INDEX_NAME` matches your actual index name
- Check your Azure Search service to confirm the index exists

**Field Names Don't Match:**

- The app expects fields like `metadata_author`, `metadata_storage_content_type`
- Check console logs for "📋 Available fields" to see what's actually in your index
- Update field names in the code if they differ

**Fields Not Facetable:**

- In Azure portal, go to your Search service → Indexes → [Your Index] → Fields
- Ensure these fields are marked as **Facetable**:
  - `metadata_author` (or your author field)
  - `metadata_storage_content_type` (or your content type field)
  - `metadata_storage_file_extension` (or your file extension field)

### 3. Emergency Fix

The updated code now provides fallback behavior:

- Returns empty filters instead of crashing if facets fail
- Shows detailed error information in console
- Continues to work even if filtering is unavailable

### 4. Testing Steps

1. Open browser dev tools (F12) → Console tab
2. Restart the app: `npm run dev`
3. Look for the debug output starting with 🔧
4. Check for any red error messages
5. Verify the "Azure Connected" status in the header

### 5. Index Field Requirements

Your search index MUST have these **Facetable** fields configured:

| Field Name                          | Required | Alternative Names                         |
| ----------------------------------- | -------- | ----------------------------------------- |
| `metadata_author`                 | ✅       | `author`, `created_by`, `writer`    |
| `metadata_storage_content_type`   | ✅       | `content_type`, `file_type`, `type` |
| `metadata_storage_file_extension` | ✅       | `file_extension`, `extension`         |

## Support

If you encounter issues:

1. Check the browser console for detailed error messages
2. Run the debug configuration checker (logs appear automatically)
3. Verify your Azure service status in the Azure portal
4. Test API connectivity using Azure REST APIs directly
5. Check that your index fields are configured as **Facetable** where required
