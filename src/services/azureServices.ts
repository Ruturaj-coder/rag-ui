// Azure Services - Production Ready Implementation
// Following the successful Python pattern: Load env → Initialize clients → Build filters → Hybrid search → Prepare context → Generate response → Get facets

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
  };
}

// Load and validate environment variables (Step 1: Load environment variables)
const loadAzureConfig = (): AzureConfig => {
  const config: AzureConfig = {
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
      containerName: import.meta.env.VITE_AZURE_STORAGE_CONTAINER_NAME || ''
    }
  };

  // Validate required configuration
  if (!config.openai.endpoint || !config.openai.apiKey) {
    throw new AzureServiceError('Azure OpenAI configuration is incomplete. Please check VITE_AZURE_OPENAI_ENDPOINT and VITE_AZURE_OPENAI_API_KEY', 'openai');
  }
  
  if (!config.search.endpoint || !config.search.apiKey) {
    throw new AzureServiceError('Azure Search configuration is incomplete. Please check VITE_AZURE_SEARCH_ENDPOINT and VITE_AZURE_SEARCH_API_KEY', 'search');
  }

  return config;
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
  score?: number;
}

export interface AzureOpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SearchFilters {
  authors?: string[];
  categories?: string[];
  documentTypes?: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
  documentIds?: string[];
}

export interface SearchFacets {
  authors: Array<{ name: string; count: number; expertise?: string }>;
  categories: Array<{ name: string; count: number }>;
  documentTypes: Array<{ name: string; count: number }>;
}

class AzureServiceError extends Error {
  constructor(message: string, public service: string, public statusCode?: number) {
    super(message);
    this.name = 'AzureServiceError';
  }
}

// Step 2: Initialize clients and Step 3: Build filter strings
export class AzureSearchService {
  private config: AzureConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    this.config = loadAzureConfig();
    this.baseUrl = `${this.config.search.endpoint}/indexes/${this.config.search.indexName}`;
    this.headers = {
      'Content-Type': 'application/json',
      'api-key': this.config.search.apiKey
    };
    
    console.log('✅ Azure Search Service initialized');
    console.log(`🔍 Search endpoint: ${this.config.search.endpoint}`);
    console.log(`📚 Index: ${this.config.search.indexName}`);
  }

  // Step 3: Build filter string (following Python pattern)
  private buildFilterString(filters?: SearchFilters): string {
    const filterClauses: string[] = [];

    if (filters?.authors && filters.authors.length > 0) {
      const authorFilter = filters.authors
        .map(author => `metadata_author eq '${author.replace(/'/g, "''")}'`)
        .join(' or ');
      filterClauses.push(`(${authorFilter})`);
    }

    if (filters?.categories && filters.categories.length > 0) {
      const categoryFilter = filters.categories
        .map(category => `metadata_storage_content_type eq '${category.replace(/'/g, "''")}'`)
        .join(' or ');
      filterClauses.push(`(${categoryFilter})`);
    }

    if (filters?.documentTypes && filters.documentTypes.length > 0) {
      const typeFilter = filters.documentTypes
        .map(type => `metadata_storage_file_extension eq '.${type.toLowerCase()}'`)
        .join(' or ');
      filterClauses.push(`(${typeFilter})`);
    }

    if (filters?.dateRange) {
      if (filters.dateRange.start) {
        filterClauses.push(`metadata_storage_last_modified ge ${filters.dateRange.start}T00:00:00Z`);
      }
      if (filters.dateRange.end) {
        filterClauses.push(`metadata_storage_last_modified le ${filters.dateRange.end}T23:59:59Z`);
      }
    }

    if (filters?.documentIds && filters.documentIds.length > 0) {
      const idFilter = filters.documentIds
        .map(id => `metadata_storage_path eq '${id.replace(/'/g, "''")}'`)
        .join(' or ');
      filterClauses.push(`(${idFilter})`);
    }

    const result = filterClauses.join(' and ');
    console.log('🔧 Built filter string:', result || 'No filters applied');
    return result;
  }

  // Step 4: Perform hybrid search
  async searchDocuments(
    query: string, 
    filters?: SearchFilters,
    options: {
      top?: number;
      skip?: number;
      includeFacets?: boolean;
    } = {}
  ): Promise<{ 
    documents: AzureSearchDocument[]; 
    totalCount: number;
    facets?: SearchFacets;
  }> {
    try {
      const { top = 10, skip = 0, includeFacets = false } = options;
      const url = `${this.baseUrl}/docs/search?api-version=2023-11-01`;
      
      const filterString = this.buildFilterString(filters);
      
      // Prepare hybrid search request (combining text and semantic search)
      const requestBody: any = {
        search: query || '*',
        top: top,
        skip: skip,
        count: true,
        select: [
          'metadata_storage_path',
          'metadata_storage_name', 
          'metadata_storage_content_type',
          'metadata_storage_last_modified',
          'metadata_storage_size',
          'metadata_storage_file_extension',
          'metadata_author',
          'metadata_title',
          'content',
          'merged_content',
          'text',
          'people',
          'organizations',
          'locations'
        ].join(','),
        searchMode: 'all',
        queryType: 'semantic',
        semanticConfiguration: 'default',
        answers: 'extractive|count-3',
        captions: 'extractive|highlight-true',
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>'
      };

      // Add filter if present
      if (filterString) {
        requestBody.filter = filterString;
      }

      // Add facets if requested (Step 7: Get facets for each filterable field)
      if (includeFacets) {
        requestBody.facets = [
          'metadata_author,count:50',
          'metadata_storage_content_type,count:20',
          'metadata_storage_file_extension,count:20'
        ];
      }

      console.log('🔍 Performing hybrid search:', {
        query: query || '*',
        filters: filterString || 'none',
        top,
        skip
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Search failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new AzureServiceError(
          `Search failed: ${response.status} ${response.statusText} - ${errorText}`, 
          'search', 
          response.status
        );
      }

      const result = await response.json();
      const documents = result.value || [];
      const totalCount = result['@odata.count'] || documents.length;

      console.log(`✅ Search completed: ${documents.length} documents found (${totalCount} total)`);

      // Process facets if available
      let facets: SearchFacets | undefined;
      if (result['@search.facets']) {
        facets = this.processFacets(result['@search.facets']);
      }

      return {
        documents: documents.map((doc: any) => this.mapDocument(doc)),
        totalCount,
        facets
      };

    } catch (error) {
      console.error('💥 Search error:', error);
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(
        `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        'search'
      );
    }
  }

  // Process facets from search results
  private processFacets(searchFacets: any): SearchFacets {
    const facets: SearchFacets = {
      authors: [],
      categories: [],
      documentTypes: []
    };

    // Process author facets
    if (searchFacets.metadata_author) {
      facets.authors = searchFacets.metadata_author.map((facet: any) => ({
        name: facet.value || 'Unknown',
        count: facet.count || 0,
        expertise: undefined // Could be enhanced with additional metadata
      }));
    }

    // Process category facets
    if (searchFacets.metadata_storage_content_type) {
      facets.categories = searchFacets.metadata_storage_content_type.map((facet: any) => ({
        name: facet.value || 'Unknown',
        count: facet.count || 0
      }));
    }

    // Process document type facets
    if (searchFacets.metadata_storage_file_extension) {
      facets.documentTypes = searchFacets.metadata_storage_file_extension.map((facet: any) => ({
        name: (facet.value || '').replace('.', '').toUpperCase() || 'UNKNOWN',
        count: facet.count || 0
      }));
    }

    console.log('📊 Processed facets:', {
      authors: facets.authors.length,
      categories: facets.categories.length,
      documentTypes: facets.documentTypes.length
    });

    return facets;
  }

  // Enhanced document mapping with better content extraction
  private mapDocument(azureDoc: any): AzureSearchDocument {
    // Extract title with multiple fallbacks
    let title = azureDoc.metadata_title || azureDoc.metadata_storage_name || 'Untitled Document';
    
    if (!title || title === 'Untitled Document') {
      const path = azureDoc.metadata_storage_path || azureDoc.metadata_storage_name || '';
      const filename = path.split('/').pop() || '';
      if (filename) {
        title = decodeURIComponent(filename)
          .replace(/\.[^/.]+$/, "")
          .replace(/[_-]/g, ' ')
          .trim();
      }
    }

    // Extract content with priority order
    let content = '';
    const contentFields = [
      'merged_content', 'content', 'text', 'people', 'organizations', 'locations'
    ];
    
    for (const field of contentFields) {
      if (azureDoc[field]) {
        if (typeof azureDoc[field] === 'string' && azureDoc[field].trim()) {
          content = azureDoc[field].trim();
          break;
        } else if (Array.isArray(azureDoc[field]) && azureDoc[field].length > 0) {
          content = azureDoc[field].join(' ').trim();
          break;
        }
      }
    }

    // Extract file extension and format type
    const fileExtension = azureDoc.metadata_storage_file_extension || '';
    const type = fileExtension.replace('.', '').toUpperCase() || 'FILE';

    // Calculate score (from @search.score)
    const score = azureDoc['@search.score'] || 0;

    return {
      id: azureDoc.metadata_storage_path || azureDoc.metadata_storage_name || '',
      title,
      content,
      author: azureDoc.metadata_author || 'Unknown',
      category: azureDoc.metadata_storage_content_type || 'Document',
      type,
      date: azureDoc.metadata_storage_last_modified || new Date().toISOString(),
      size: azureDoc.metadata_storage_size ? this.formatBytes(azureDoc.metadata_storage_size) : undefined,
      status: 'active',
      downloads: 0,
      metadata: azureDoc,
      score
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Get available filters by performing a faceted search
  async getAvailableFilters(): Promise<SearchFacets> {
    try {
      console.log('📊 Loading available filters...');
      
      const result = await this.searchDocuments('*', undefined, { 
        top: 1, 
        includeFacets: true 
      });
      
      return result.facets || {
        authors: [],
        categories: [],
        documentTypes: []
      };
    } catch (error) {
      console.error('❌ Failed to load filters:', error);
      return {
        authors: [],
        categories: [],
        documentTypes: []
      };
    }
  }

  async getDocumentById(id: string): Promise<AzureSearchDocument | null> {
    try {
      const result = await this.searchDocuments('*', { documentIds: [id] }, { top: 1 });
      return result.documents.length > 0 ? result.documents[0] : null;
    } catch (error) {
      console.error('❌ Error getting document by ID:', error);
      return null;
    }
  }
}

// OpenAI Service for response generation
export class AzureOpenAIService {
  private config: AzureConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    this.config = loadAzureConfig();
    this.baseUrl = `${this.config.openai.endpoint}/openai/deployments/${this.config.openai.deploymentName}`;
    this.headers = {
      'Content-Type': 'application/json',
      'api-key': this.config.openai.apiKey
    };
    
    console.log('✅ Azure OpenAI Service initialized');
    console.log(`🤖 Model: ${this.config.openai.deploymentName}`);
  }

  // Step 6: Generate response
  async generateResponse(
    messages: AzureOpenAIMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    } = {}
  ): Promise<{
    content: string;
    tokens: number;
    model: string;
    finishReason: string;
  }> {
    try {
      const url = `${this.baseUrl}/chat/completions?api-version=${this.config.openai.apiVersion}`;

      const requestBody = {
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        stream: options.stream ?? false
      };

      console.log('🤖 Generating response with OpenAI...');

      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ OpenAI request failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new AzureServiceError(
          `OpenAI request failed: ${response.status} ${response.statusText} - ${errorText}`, 
          'openai', 
          response.status
        );
      }

      const result = await response.json();
      
      console.log('✅ Response generated successfully');
      
      return {
        content: result.choices[0]?.message?.content || 'No response generated',
        tokens: result.usage?.total_tokens || 0,
        model: result.model || this.config.openai.deploymentName,
        finishReason: result.choices[0]?.finish_reason || 'unknown'
      };
    } catch (error) {
      console.error('💥 OpenAI error:', error);
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(
        `OpenAI error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        'openai'
      );
    }
  }
}

// Main RAG Service combining search and generation
export class RAGService {
  private searchService: AzureSearchService;
  private openAIService: AzureOpenAIService;

  constructor() {
    console.log('🚀 Initializing RAG Service...');
    this.searchService = new AzureSearchService();
    this.openAIService = new AzureOpenAIService();
    console.log('✅ RAG Service ready');
  }

  // Step 5: Prepare context and sources, then Step 6: Generate response
  async processQuery(
    query: string,
    filters?: SearchFilters,
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
      console.log(`🔍 Processing RAG query: "${query}"`);
      console.log('🔧 Applied filters:', filters);
      
      // Step 4: Perform hybrid search
      const searchResult = await this.searchService.searchDocuments(
        query, 
        filters, 
        { top: options.topDocuments || 10 }
      );
      
      if (searchResult.documents.length === 0) {
        console.log('⚠️ No documents found for query');
        return {
          response: "I couldn't find any relevant documents for your query. Please try rephrasing your question or adjusting your filters.",
          sources: [],
          confidence: 0.1,
          tokens: 0,
          processingTime: (Date.now() - startTime) / 1000,
          model: 'none'
        };
      }

      // Step 5: Prepare context and sources
      const documentsWithContent = searchResult.documents.filter(doc => 
        doc.content && doc.content.trim().length > 50
      );
      
      console.log(`📚 Found ${searchResult.documents.length} documents, ${documentsWithContent.length} with sufficient content`);

      let contextContent = '';
      let confidence = 0.4;

      if (documentsWithContent.length > 0) {
        // Prepare rich context with document metadata
        contextContent = documentsWithContent
          .map((doc, index) => {
            const preview = doc.content.substring(0, 1000) + (doc.content.length > 1000 ? '...' : '');
            return `[Document ${index + 1}: "${doc.title}"]\nAuthor: ${doc.author}\nType: ${doc.type}\nCategory: ${doc.category}\nContent: ${preview}\n`;
          })
          .join('\n---\n\n');
        confidence = 0.8;
      } else {
        // Fallback: List documents without content
        contextContent = searchResult.documents
          .map((doc, index) => 
            `[Document ${index + 1}: "${doc.title}"]\nAuthor: ${doc.author}\nType: ${doc.type}\nCategory: ${doc.category}\nNote: Text content not accessible for this ${doc.type} file.\n`
          )
          .join('\n---\n\n');
      }

      // Create enhanced system prompt
      const systemPrompt = documentsWithContent.length > 0 ? 
        `You are an expert AI assistant for Barclays. Analyze the provided documents and answer the user's question comprehensively.

Guidelines:
- Use specific information from the documents
- Cite documents when referencing information (e.g., "According to Document 1...")
- Provide detailed, professional responses
- If information is incomplete, mention what additional details might be helpful
- Structure your response clearly with headings when appropriate

Available Documents:
${contextContent}` :
        `You are an expert AI assistant for Barclays. I found these documents related to the user's query, but their text content is not accessible:

Available Documents:
${contextContent}

Please provide helpful guidance about what these documents might contain and suggest how the user might access their content or find related information.`;

      // Step 6: Generate response
      const messages: AzureOpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ];

      const aiResponse = await this.openAIService.generateResponse(messages, options);

      // Format sources for frontend
      const sources = searchResult.documents.map(doc => ({
        name: doc.title,
        author: doc.author || 'Unknown',
        relevance: doc.score || 0.5,
        type: doc.type || 'Document',
        category: doc.category || 'General',
        id: doc.id
      }));

      const processingTime = (Date.now() - startTime) / 1000;
      
      console.log(`✅ RAG processing completed in ${processingTime.toFixed(2)}s`);
      console.log(`📊 Result: ${sources.length} sources, ${aiResponse.tokens} tokens, ${confidence} confidence`);

      return {
        response: aiResponse.content,
        sources,
        confidence,
        tokens: aiResponse.tokens,
        processingTime,
        model: aiResponse.model
      };
    } catch (error) {
      console.error('💥 RAG processing error:', error);
      if (error instanceof AzureServiceError) throw error;
      throw new AzureServiceError(
        `RAG error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        'rag'
      );
    }
  }

  async getAvailableFilters(): Promise<SearchFacets> {
    return this.searchService.getAvailableFilters();
  }

  // Test connection to all services
  async testConnection(): Promise<{
    search: boolean;
    openai: boolean;
    errors: string[];
  }> {
    const result = {
      search: false,
      openai: false,
      errors: [] as string[]
    };

    // Test search service
    try {
      await this.searchService.searchDocuments('test', undefined, { top: 1 });
      result.search = true;
      console.log('✅ Search service connection successful');
    } catch (error) {
      result.errors.push(`Search: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error('❌ Search service connection failed:', error);
    }

    // Test OpenAI service
    try {
      await this.openAIService.generateResponse([
        { role: 'user', content: 'Hello' }
      ], { maxTokens: 10 });
      result.openai = true;
      console.log('✅ OpenAI service connection successful');
    } catch (error) {
      result.errors.push(`OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error('❌ OpenAI service connection failed:', error);
    }

    return result;
  }
}

// Export instances and classes
export const ragService = new RAGService();
export const searchService = new AzureSearchService();
export const openAIService = new AzureOpenAIService();
export { AzureServiceError };

// Debug and utility functions
export const debugAzureConfig = () => {
  try {
    const config = loadAzureConfig();
    console.log('🔧 Azure Configuration Status:');
    console.log('OpenAI Endpoint:', config.openai.endpoint ? '✅ Set' : '❌ Missing');
    console.log('OpenAI API Key:', config.openai.apiKey ? '✅ Set' : '❌ Missing');
    console.log('Search Endpoint:', config.search.endpoint ? '✅ Set' : '❌ Missing');
    console.log('Search API Key:', config.search.apiKey ? '✅ Set' : '❌ Missing');
    console.log('Index Name:', config.search.indexName);
    console.log('Storage Account:', config.storage?.accountName || 'Not configured');
    console.log('Storage Container:', config.storage?.containerName || 'Not configured');
    return config;
  } catch (error) {
    console.error('❌ Configuration error:', error);
    return null;
  }
};

// Test all services
export const testAzureServices = async () => {
  try {
    console.log('🧪 Testing Azure Services...');
    const result = await ragService.testConnection();
    console.log('🧪 Test Results:', result);
    return result;
  } catch (error) {
    console.error('❌ Service test failed:', error);
    return { search: false, openai: false, errors: [error instanceof Error ? error.message : 'Unknown error'] };
  }
}; 