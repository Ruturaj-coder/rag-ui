// Azure Services - Simple Implementation

interface AzureConfig {
  openai: {
    endpoint: string;
    apiKey: string;
    deploymentName: string;
    apiVersion: string;
  };
  search: {
    endpoint: string;
    apiKey: string;
    indexName: string;
  };
}

const azureConfig: AzureConfig = {
  openai: {
    endpoint: import.meta.env.VITE_AZURE_OPENAI_ENDPOINT || '',
    apiKey: import.meta.env.VITE_AZURE_OPENAI_API_KEY || '',
    deploymentName: import.meta.env.VITE_AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
    apiVersion: import.meta.env.VITE_AZURE_OPENAI_API_VERSION || '2024-02-15-preview'
  },
  search: {
    endpoint: import.meta.env.VITE_AZURE_SEARCH_ENDPOINT || '',
    apiKey: import.meta.env.VITE_AZURE_SEARCH_API_KEY || '',
    indexName: import.meta.env.VITE_AZURE_SEARCH_INDEX_NAME || 'documents'
  }
};

export interface AzureSearchDocument {
  id: string;
  content: string;
  title: string;
  author?: string;
  category?: string;
  type?: string;
  date?: string;
  size?: string;
  status?: string;
  downloads?: number;
  metadata?: Record<string, any>;
}

export interface AzureOpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class AzureServiceError extends Error {
  constructor(message: string, public service: string, public statusCode?: number) {
    super(message);
    this.name = 'AzureServiceError';
  }
}

export class AzureSearchService {
  private baseUrl: string;
  private apiKey: string;
  private indexName: string;

  constructor() {
    this.baseUrl = azureConfig.search.endpoint;
    this.apiKey = azureConfig.search.apiKey;
    this.indexName = azureConfig.search.indexName;

    if (!this.baseUrl || !this.apiKey) {
      throw new AzureServiceError('Azure Search configuration missing', 'search');
    }
  }

  async searchDocuments(query: string, top: number = 5): Promise<{ documents: AzureSearchDocument[]; totalCount: number }> {
    try {
      const url = `${this.baseUrl}/indexes/${this.indexName}/docs/search?api-version=2023-11-01`;
      
      const requestBody = {
        search: query,
        top: top,
        count: true,
        select: "*",
        searchMode: "all"
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Search failed:', errorText);
        throw new AzureServiceError(`Search failed: ${response.statusText}`, 'search', response.status);
      }

      const result = await response.json();
      const documents = result.value || [];

      console.log(`✅ Found ${documents.length} documents for query: "${query}"`);
      
      // First document debugging - see what fields are available
      if (documents.length > 0) {
        const firstDoc = documents[0];
        console.log('📋 Available fields in first document:', Object.keys(firstDoc));
        console.log('🔍 First document sample:', {
          id: firstDoc.id,
          metadata_storage_path: firstDoc.metadata_storage_path,
          content: firstDoc.content ? `${firstDoc.content.substring(0, 100)}...` : 'NO CONTENT FIELD',
          text: firstDoc.text ? `${firstDoc.text.substring(0, 100)}...` : 'NO TEXT FIELD',
          merged_content: firstDoc.merged_content ? `${firstDoc.merged_content.substring(0, 100)}...` : 'NO MERGED_CONTENT FIELD'
        });
      }

      return {
        documents: documents.map((doc: any) => this.mapDocument(doc)),
        totalCount: result['@odata.count'] || documents.length
      };
    } catch (error) {
      console.error('💥 Search error:', error);
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(`Search error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'search');
    }
  }

  private mapDocument(azureDoc: any): AzureSearchDocument {
    // Extract title
    let title = azureDoc.title || azureDoc.metadata_title || 'Untitled Document';
    
    if (!title || title === 'Untitled Document') {
      const path = azureDoc.metadata_storage_path || azureDoc.id || '';
      const filename = path.split('/').pop() || '';
      if (filename) {
        title = decodeURIComponent(filename).replace(/\.[^/.]+$/, "").replace(/[_-]/g, ' ');
      }
    }

    // Extract content - try multiple field names
    let content = '';
    const contentFields = [
      'content', 'merged_content', 'text', 'body', 'description', 
      'summary', 'extractedText', 'textContent', 'people', 'organizations', 'locations'
    ];
    
    for (const field of contentFields) {
      if (azureDoc[field]) {
        if (typeof azureDoc[field] === 'string' && azureDoc[field].trim()) {
          content = azureDoc[field].trim();
          console.log(`✅ Found content in field: ${field} (${content.length} chars)`);
          break;
        }
        // Handle array fields (some indexes store content as arrays)
        else if (Array.isArray(azureDoc[field]) && azureDoc[field].length > 0) {
          content = azureDoc[field].join(' ').trim();
          console.log(`✅ Found content in array field: ${field} (${content.length} chars)`);
          break;
        }
      }
    }

    if (!content) {
      console.log('⚠️ No content found in any field for document:', title);
    }

    return {
      id: azureDoc.metadata_storage_path || azureDoc.id || '',
      title,
      content,
      author: azureDoc.author || azureDoc.metadata_author || 'Unknown',
      category: azureDoc.category || azureDoc.metadata_storage_content_type || 'Document',
      type: azureDoc.metadata_storage_file_extension?.replace('.', '').toUpperCase() || 'FILE',
      date: azureDoc.metadata_storage_last_modified || new Date().toISOString(),
      size: azureDoc.metadata_storage_size ? this.formatBytes(azureDoc.metadata_storage_size) : undefined,
      status: 'active',
      downloads: 0,
      metadata: azureDoc
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async getDocumentById(id: string): Promise<AzureSearchDocument | null> {
    try {
      const result = await this.searchDocuments(`metadata_storage_path:"${id}"`, 1);
      return result.documents.length > 0 ? result.documents[0] : null;
    } catch (error) {
      console.error('Error getting document by ID:', error);
      return null;
    }
  }

  async getAvailableFilters(): Promise<{
    authors: Array<{ name: string; count: number; expertise?: string }>;
    categories: Array<{ name: string; count: number }>;
    documentTypes: Array<{ name: string; count: number }>;
  }> {
    return {
      authors: [],
      categories: [],
      documentTypes: []
    };
  }
}

export class AzureOpenAIService {
  private baseUrl: string;
  private apiKey: string;
  private deploymentName: string;
  private apiVersion: string;

  constructor() {
    this.baseUrl = azureConfig.openai.endpoint;
    this.apiKey = azureConfig.openai.apiKey;
    this.deploymentName = azureConfig.openai.deploymentName;
    this.apiVersion = azureConfig.openai.apiVersion;

    if (!this.baseUrl || !this.apiKey) {
      throw new AzureServiceError('Azure OpenAI configuration missing', 'openai');
    }
  }

  async generateResponse(
    messages: AzureOpenAIMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<{
    content: string;
    tokens: number;
    model: string;
    finishReason: string;
  }> {
    try {
      const url = `${this.baseUrl}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify({
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AzureServiceError(`OpenAI request failed: ${errorText}`, 'openai', response.status);
      }

      const result = await response.json();
      
      return {
        content: result.choices[0]?.message?.content || 'No response generated',
        tokens: result.usage?.total_tokens || 0,
        model: result.model || this.deploymentName,
        finishReason: result.choices[0]?.finish_reason || 'unknown'
      };
    } catch (error) {
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(`OpenAI error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'openai');
    }
  }
}

export class RAGService {
  private searchService: AzureSearchService;
  private openAIService: AzureOpenAIService;

  constructor() {
    this.searchService = new AzureSearchService();
    this.openAIService = new AzureOpenAIService();
  }

  async processQuery(
    query: string,
    filters?: any,
    options: {
      temperature?: number;
      maxTokens?: number;
      topDocuments?: number;
    } = {}
  ): Promise<{
    response: string;
    sources: Array<{
      name: string;
      author: string;
      relevance: number;
      type: string;
      category: string;
      id: string;
    }>;
    confidence: number;
    tokens: number;
    processingTime: number;
    model: string;
  }> {
    const startTime = Date.now();

    try {
      console.log(`🔍 Processing query: "${query}"`);
      
      // Step 1: Search for documents
      const searchResult = await this.searchService.searchDocuments(query, options.topDocuments || 5);
      
      if (searchResult.documents.length === 0) {
        return {
          response: "I couldn't find any relevant documents for your query. Please try rephrasing your question.",
          sources: [],
          confidence: 0.1,
          tokens: 0,
          processingTime: (Date.now() - startTime) / 1000,
          model: 'none'
        };
      }

      // Step 2: Prepare context
      const documentsWithContent = searchResult.documents.filter(doc => doc.content && doc.content.trim());
      
      console.log(`📚 Found ${searchResult.documents.length} documents, ${documentsWithContent.length} with content`);

      let contextContent = '';
      if (documentsWithContent.length > 0) {
        contextContent = documentsWithContent
          .map((doc, index) => `[Document ${index + 1}: ${doc.title}]\n${doc.content}\n`)
          .join('\n---\n\n');
      } else {
        // If no content available, list the documents found
        contextContent = searchResult.documents
          .map((doc, index) => `[Document ${index + 1}: ${doc.title}]\nType: ${doc.type}\nAuthor: ${doc.author}\nNo text content available for this ${doc.type} file.\n`)
          .join('\n---\n\n');
      }

      // Step 3: Create system prompt
      const systemPrompt = documentsWithContent.length > 0 ? 
        `You are a helpful assistant that answers questions based on document content. Use the following documents to answer the user's question. Cite specific documents when referencing information.

Documents:
${contextContent}` :
        `You are a helpful assistant. I found these documents related to the user's query, but their text content is not accessible (they may be binary files like PDFs, Word docs, etc.):

Documents found:
${contextContent}

Provide helpful guidance about what these documents might contain and suggest how the user might access their content.`;

      // Step 4: Generate response
      const messages: AzureOpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ];

      const aiResponse = await this.openAIService.generateResponse(messages, options);

      // Step 5: Format response
      const sources = searchResult.documents.map(doc => ({
        name: doc.title,
        author: doc.author || 'Unknown',
        relevance: 0.8, // Simplified
        type: doc.type || 'Document',
        category: doc.category || 'General',
        id: doc.id
      }));

      return {
        response: aiResponse.content,
        sources,
        confidence: documentsWithContent.length > 0 ? 0.8 : 0.4,
        tokens: aiResponse.tokens,
        processingTime: (Date.now() - startTime) / 1000,
        model: aiResponse.model
      };
    } catch (error) {
      console.error('💥 RAG processing error:', error);
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(`RAG error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'rag');
    }
  }

  async getAvailableFilters() {
    return this.searchService.getAvailableFilters();
  }
}

// Export instances
export const ragService = new RAGService();
export const searchService = new AzureSearchService();
export const openAIService = new AzureOpenAIService();
export { AzureServiceError };

// Debug function
export const debugAzureConfig = () => {
  console.log('🔧 Azure Configuration:');
  console.log('OpenAI Endpoint:', azureConfig.openai.endpoint ? '✅ Set' : '❌ Missing');
  console.log('Search Endpoint:', azureConfig.search.endpoint ? '✅ Set' : '❌ Missing');
  console.log('Index Name:', azureConfig.search.indexName);
  return azureConfig;
}; 