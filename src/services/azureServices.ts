// Azure Services Integration
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
  storage?: {
    accountName: string;
    containerName: string;
    accountKey?: string;
  };
}

// Configuration from environment variables
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
  },
  storage: {
    accountName: import.meta.env.VITE_AZURE_STORAGE_ACCOUNT_NAME || '',
    containerName: import.meta.env.VITE_AZURE_STORAGE_CONTAINER_NAME || 'documents',
    accountKey: import.meta.env.VITE_AZURE_STORAGE_ACCOUNT_KEY || ''
  }
};

// Types for Azure responses
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

export interface AzureSearchResult {
  value: Array<{
    '@search.score': number;
    '@search.highlights'?: Record<string, string[]>;
  } & AzureSearchDocument>;
  '@odata.count'?: number;
}

export interface AzureOpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AzureOpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: AzureOpenAIMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Error handling
class AzureServiceError extends Error {
  constructor(message: string, public service: string, public statusCode?: number) {
    super(message);
    this.name = 'AzureServiceError';
  }
}

// Azure AI Search Service
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

  async searchDocuments(
    query: string,
    filters?: {
      authors?: string[];
      categories?: string[];
      dateRange?: { start?: string; end?: string };
      documentIds?: string[];
    },
    top: number = 10
  ): Promise<{ documents: AzureSearchDocument[]; totalCount: number }> {
    try {
      const searchParams = new URLSearchParams({
        'api-version': '2023-11-01',
        search: query || '*',
        '$top': top.toString(),
        '$count': 'true',
        'searchMode': 'any',
        'highlight': 'content,metadata_title',
        'select': 'metadata_storage_path,metadata_title,content,metadata_author,metadata_storage_content_type,metadata_storage_last_modified,metadata_storage_size,metadata_storage_file_extension'
      });

      // Build filter string
      const filterConditions = [];
      
      if (filters?.authors && filters.authors.length > 0) {
        const authorFilter = filters.authors.map(author => `metadata_author eq '${author.replace(/'/g, "''")}'`).join(' or ');
        filterConditions.push(`(${authorFilter})`);
      }

      if (filters?.categories && filters.categories.length > 0) {
        const categoryFilter = filters.categories.map(cat => `metadata_storage_content_type eq '${cat.replace(/'/g, "''")}'`).join(' or ');
        filterConditions.push(`(${categoryFilter})`);
      }

      if (filters?.documentIds && filters.documentIds.length > 0) {
        const idFilter = filters.documentIds.map(id => `metadata_storage_path eq '${id.replace(/'/g, "''")}'`).join(' or ');
        filterConditions.push(`(${idFilter})`);
      }

      if (filters?.dateRange?.start) {
        filterConditions.push(`metadata_storage_last_modified ge ${filters.dateRange.start}T00:00:00Z`);
      }

      if (filters?.dateRange?.end) {
        filterConditions.push(`metadata_storage_last_modified le ${filters.dateRange.end}T23:59:59Z`);
      }

      if (filterConditions.length > 0) {
        searchParams.append('$filter', filterConditions.join(' and '));
      }

      const url = `${this.baseUrl}/indexes/${this.indexName}/docs?${searchParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        }
      });

      if (!response.ok) {
        throw new AzureServiceError(
          `Search request failed: ${response.statusText}`,
          'search',
          response.status
        );
      }

      const result: AzureSearchResult = await response.json();
      
      // Add debugging for the first few results
      if (result.value && result.value.length > 0) {
        console.log('🔍 Azure Search Results (first 3):', result.value.slice(0, 3).map(doc => {
          const rawDoc = doc as any;
          return {
            // All metadata fields for debugging
            metadata_storage_path: rawDoc.metadata_storage_path,
            metadata_title: rawDoc.metadata_title,
            metadata_author: rawDoc.metadata_author,
            metadata_storage_content_type: rawDoc.metadata_storage_content_type,
            metadata_storage_file_extension: rawDoc.metadata_storage_file_extension,
            metadata_storage_size: rawDoc.metadata_storage_size,
            content: rawDoc.content ? rawDoc.content.substring(0, 100) + '...' : 'No content',
            '@search.score': rawDoc['@search.score'],
            // Show ALL available fields
            allFields: Object.keys(rawDoc).filter(key => !['content', '@search.score', '@search.highlights'].includes(key))
          };
        }));
      }
      
      return {
        documents: (result.value || []).map(mapAzureDocumentToFrontend),
        totalCount: result['@odata.count'] || 0
      };
    } catch (error) {
      if (error instanceof AzureServiceError) {
        throw error;
      }
      throw new AzureServiceError(
        `Search service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'search'
      );
    }
  }

  async getDocumentById(id: string): Promise<AzureSearchDocument | null> {
    try {
      const url = `${this.baseUrl}/indexes/${this.indexName}/docs('${encodeURIComponent(id)}')?api-version=2023-11-01`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        }
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new AzureServiceError(
          `Document retrieval failed: ${response.statusText}`,
          'search',
          response.status
        );
      }

      const azureDoc = await response.json();
      return mapAzureDocumentToFrontend(azureDoc);
    } catch (error) {
      if (error instanceof AzureServiceError) {
        throw error;
      }
      throw new AzureServiceError(
        `Document retrieval error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'search'
      );
    }
  }

  async getAvailableFilters(): Promise<{
    authors: Array<{ name: string; count: number; expertise?: string }>;
    categories: Array<{ name: string; count: number }>;
    documentTypes: Array<{ name: string; count: number }>;
  }> {
    try {
      // Use facets to get available filter options
      const searchParams = new URLSearchParams({
        'api-version': '2023-11-01',
        search: '*',
        '$top': '0'
      });
      
      // Add facet parameters separately since they can have multiple values
      searchParams.append('facet', 'metadata_author,count:50');
      searchParams.append('facet', 'metadata_storage_content_type,count:50');
      searchParams.append('facet', 'metadata_storage_file_extension,count:20');

      const url = `${this.baseUrl}/indexes/${this.indexName}/docs?${searchParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        }
      });

      if (!response.ok) {
        throw new AzureServiceError(
          `Facets request failed: ${response.statusText}`,
          'search',
          response.status
        );
      }

      const result = await response.json();
      const facets = result['@search.facets'] || {};

      return {
        authors: (facets.metadata_author || []).map((facet: any) => ({
          name: facet.value,
          count: facet.count
        })),
        categories: (facets.metadata_storage_content_type || []).map((facet: any) => ({
          name: facet.value,
          count: facet.count
        })),
        documentTypes: (facets.metadata_storage_file_extension || []).map((facet: any) => ({
          name: facet.value,
          count: facet.count
        }))
      };
    } catch (error) {
      if (error instanceof AzureServiceError) {
        throw error;
      }
      throw new AzureServiceError(
        `Facets retrieval error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'search'
      );
    }
  }
}

// Azure OpenAI Service
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
      model?: string;
    } = {}
  ): Promise<{
    content: string;
    tokens: number;
    model: string;
    finishReason: string;
  }> {
    try {
      const url = `${this.baseUrl}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

      const requestBody = {
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        top_p: 1.0,
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: false
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
        throw new AzureServiceError(
          `OpenAI request failed: ${response.statusText} - ${errorText}`,
          'openai',
          response.status
        );
      }

      const result: AzureOpenAIResponse = await response.json();

      if (!result.choices || result.choices.length === 0) {
        throw new AzureServiceError('No response choices returned', 'openai');
      }

      return {
        content: result.choices[0].message.content,
        tokens: result.usage?.total_tokens || 0,
        model: result.model,
        finishReason: result.choices[0].finish_reason
      };
    } catch (error) {
      if (error instanceof AzureServiceError) {
        throw error;
      }
      throw new AzureServiceError(
        `OpenAI service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'openai'
      );
    }
  }
}

// RAG Service - Combines search and generation
export class RAGService {
  private searchService: AzureSearchService;
  private openAIService: AzureOpenAIService;

  constructor() {
    this.searchService = new AzureSearchService();
    this.openAIService = new AzureOpenAIService();
  }

  async processQuery(
    query: string,
    filters?: {
      authors?: string[];
      categories?: string[];
      dateRange?: { start?: string; end?: string };
      documentIds?: string[];
    },
    options: {
      temperature?: number;
      maxTokens?: number;
      model?: string;
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
      // Step 1: Search for relevant documents
      const searchResult = await this.searchService.searchDocuments(
        query,
        filters,
        options.topDocuments || 5
      );

      // Step 2: Prepare context from search results
      const context = searchResult.documents
        .map(doc => `Document: ${doc.title}\nAuthor: ${doc.author || 'Unknown'}\nContent: ${doc.content || ''}`)
        .join('\n\n---\n\n');

      // Step 3: Create system prompt for RAG
      const systemPrompt = `You are a knowledgeable AI assistant helping with document analysis and information retrieval. You have access to a collection of documents and should provide accurate, helpful responses based on the available information.

Guidelines:
- Use the provided context to answer questions accurately
- If information isn't available in the context, clearly state this
- Cite specific sources when providing information
- Provide comprehensive but concise responses
- Focus on being helpful and informative

Available context:
${context}`;

      // Step 4: Generate response using Azure OpenAI
      const messages: AzureOpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ];

      const aiResponse = await this.openAIService.generateResponse(messages, options);

      // Step 5: Calculate confidence based on search scores and finish reason
      const avgSearchScore = searchResult.documents.length > 0
        ? searchResult.documents.reduce((sum, doc) => sum + ((doc as any)['@search.score'] || 0), 0) / searchResult.documents.length
        : 0;

      const confidence = Math.min(0.95, Math.max(0.3, 
        avgSearchScore * 0.7 + (aiResponse.finishReason === 'stop' ? 0.3 : 0.1)
      ));

      // Step 6: Format sources
      const sources = searchResult.documents.map(doc => ({
        name: doc.title || 'Untitled Document',
        author: doc.author || 'Unknown',
        relevance: (doc as any)['@search.score'] || 0.5,
        type: doc.type || 'Document',
        category: doc.category || 'General',
        id: doc.id
      }));

      const processingTime = (Date.now() - startTime) / 1000;

      return {
        response: aiResponse.content,
        sources,
        confidence,
        tokens: aiResponse.tokens,
        processingTime,
        model: aiResponse.model
      };
    } catch (error) {
      if (error instanceof AzureServiceError) {
        throw error;
      }
      throw new AzureServiceError(
        `RAG processing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'rag'
      );
    }
  }

  async getAvailableFilters() {
    return this.searchService.getAvailableFilters();
  }
}

// Export singleton instances
export const ragService = new RAGService();
export const searchService = new AzureSearchService();
export const openAIService = new AzureOpenAIService();

// Helper function to map Azure metadata fields to frontend format
const mapAzureDocumentToFrontend = (azureDoc: any): AzureSearchDocument & { '@search.score'?: number } => {
  // Determine the best title for the document
  let title = 'Untitled Document';
  
  if (azureDoc.metadata_title && azureDoc.metadata_title.trim()) {
    title = azureDoc.metadata_title.trim();
  } else if (azureDoc.metadata_storage_path) {
    // Extract filename from storage path
    const pathParts = azureDoc.metadata_storage_path.split('/');
    let filename = pathParts[pathParts.length - 1];
    
    if (filename) {
      // Decode URL encoding (handles spaces like %20)
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {
        // If decoding fails, use as-is
      }
      
      // Remove file extension for cleaner display
      const lastDotIndex = filename.lastIndexOf('.');
      if (lastDotIndex > 0) {
        title = filename.substring(0, lastDotIndex);
      } else {
        title = filename;
      }
      
      // Clean up the title (replace underscores, handle camelCase, etc.)
      title = title
        .replace(/[_-]/g, ' ')  // Replace underscores and dashes with spaces
        .replace(/([a-z])([A-Z])/g, '$1 $2')  // Add space between camelCase
        .replace(/\s+/g, ' ')  // Normalize multiple spaces
        .trim();
      
      // Capitalize first letter of each word
      title = title.replace(/\b\w/g, l => l.toUpperCase());
    }
  }

  const mapped = {
    id: azureDoc.metadata_storage_path || azureDoc.id || '',
    title,
    content: azureDoc.content || '',
    author: azureDoc.metadata_author || 'Unknown Author',
    category: azureDoc.metadata_storage_content_type || 'Unknown Type',
    type: azureDoc.metadata_storage_file_extension?.replace('.', '').toUpperCase() || 'Document',
    date: azureDoc.metadata_storage_last_modified || azureDoc.metadata_creation_date || new Date().toISOString(),
    size: azureDoc.metadata_storage_size ? formatBytes(azureDoc.metadata_storage_size) : undefined,
    status: 'active', // Default status
    downloads: 0, // Not available in metadata
    metadata: {
      content_type: azureDoc.metadata_content_type,
      language: azureDoc.metadata_language,
      file_extension: azureDoc.metadata_storage_file_extension,
      content_md5: azureDoc.metadata_storage_content_md5
    },
    '@search.score': azureDoc['@search.score'] // Preserve search score
  };

  // Debug logging for title mapping
  console.log('📄 Document mapping:', {
    originalPath: azureDoc.metadata_storage_path,
    originalTitle: azureDoc.metadata_title,
    extractedTitle: title,
    finalMapped: {
      id: mapped.id,
      title: mapped.title,
      author: mapped.author,
      type: mapped.type,
      category: mapped.category
    }
  });

  return mapped;
};

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Export error class
export { AzureServiceError }; 