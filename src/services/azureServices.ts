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

  private fieldMapping: {
    author?: string;
    contentType?: string;
    extension?: string;
    title?: string;
    lastModified?: string;
    size?: string;
    name?: string;
  } = {};

  private async discoverFieldMapping(): Promise<void> {
    if (Object.keys(this.fieldMapping).length > 0) {
      return; // Already discovered
    }

    try {
      // Get a sample document to discover field names
      const testParams = new URLSearchParams({
        'api-version': '2023-11-01',
        search: '*',
        '$top': '1'
      });

      const testUrl = `${this.baseUrl}/indexes/${this.indexName}/docs?${testParams.toString()}`;
      const testResponse = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        }
      });

      if (testResponse.ok) {
        const testResult = await testResponse.json();
        if (testResult.value && testResult.value.length > 0) {
          const firstDoc = testResult.value[0];
          const availableFields = Object.keys(firstDoc).filter(key => !key.startsWith('@'));
          
          // Map common fields
          this.fieldMapping.author = availableFields.find(f => 
            f.toLowerCase().includes('author') || f.toLowerCase().includes('creator') || f.toLowerCase().includes('writer') || f.toLowerCase().includes('by')
          );
          
          this.fieldMapping.contentType = availableFields.find(f => 
            f.toLowerCase().includes('type') || f.toLowerCase().includes('category') || f.toLowerCase().includes('content_type') || f.toLowerCase().includes('mime')
          );
          
          this.fieldMapping.extension = availableFields.find(f => 
            f.toLowerCase().includes('extension') || f.toLowerCase().includes('ext') || f.toLowerCase().includes('format')
          );
          
          this.fieldMapping.title = availableFields.find(f => 
            f.toLowerCase().includes('title') || f.toLowerCase().includes('name')
          ) || availableFields.find(f => f.toLowerCase().includes('title'));
          
          this.fieldMapping.lastModified = availableFields.find(f => 
            f.toLowerCase().includes('modified') || f.toLowerCase().includes('updated') || f.toLowerCase().includes('date')
          );
          
          this.fieldMapping.size = availableFields.find(f => 
            f.toLowerCase().includes('size') || f.toLowerCase().includes('length')
          );
          
          this.fieldMapping.name = availableFields.find(f => 
            f.toLowerCase().includes('name') && !f.toLowerCase().includes('filename')
          );

          console.log('🗂️ Field mapping discovered:', this.fieldMapping);
        }
      }
    } catch (error) {
      console.log('⚠️ Could not discover field mapping:', error);
    }
  }

  private mapAzureDocumentToFrontend(azureDoc: any): AzureSearchDocument & { '@search.score'?: number } {
    // Determine the best title for the document
    let title = 'Untitled Document';
    
    const titleField = this.fieldMapping.title;
    if (titleField && azureDoc[titleField] && azureDoc[titleField].trim()) {
      title = azureDoc[titleField].trim();
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

    // Use discovered field names or fallback to standard names
    const authorField = this.fieldMapping.author || 'metadata_author';
    const contentTypeField = this.fieldMapping.contentType || 'metadata_storage_content_type';
    const extensionField = this.fieldMapping.extension || 'metadata_storage_file_extension';
    const lastModifiedField = this.fieldMapping.lastModified || 'metadata_storage_last_modified';
    const sizeField = this.fieldMapping.size || 'metadata_storage_size';

    const mapped = {
      id: azureDoc.metadata_storage_path || azureDoc.id || '',
      title,
      content: azureDoc.content || '',
      author: azureDoc[authorField] || 'Unknown Author',
      category: azureDoc[contentTypeField] || 'Unknown Type',
      type: azureDoc[extensionField]?.replace('.', '').toUpperCase() || 'Document',
      date: azureDoc[lastModifiedField] || azureDoc.metadata_creation_date || new Date().toISOString(),
      size: azureDoc[sizeField] ? this.formatBytes(azureDoc[sizeField]) : undefined,
      status: 'active', // Default status
      downloads: 0, // Not available in metadata
      metadata: {
        content_type: azureDoc.metadata_content_type,
        language: azureDoc.metadata_language,
        file_extension: azureDoc[extensionField],
        content_md5: azureDoc.metadata_storage_content_md5
      },
      '@search.score': azureDoc['@search.score'] // Preserve search score
    };

    // Debug logging for title mapping
    console.log('📄 Document mapping:', {
      originalPath: azureDoc.metadata_storage_path,
      originalTitle: titleField ? azureDoc[titleField] : undefined,
      extractedTitle: title,
      usedFields: {
        author: { field: authorField, value: azureDoc[authorField] },
        contentType: { field: contentTypeField, value: azureDoc[contentTypeField] },
        extension: { field: extensionField, value: azureDoc[extensionField] }
      },
      finalMapped: {
        id: mapped.id,
        title: mapped.title,
        author: mapped.author,
        type: mapped.type,
        category: mapped.category
      }
    });

    return mapped;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
      // Discover field mapping if not done yet
      await this.discoverFieldMapping();
  
      // Build URL manually to avoid URLSearchParams encoding issues
      const params = [
        'api-version=2023-11-01',
        `search=${encodeURIComponent(query || '*')}`,
        `$top=${Math.min(top, 50)}`, // Cap at 50 to prevent large requests
        '$count=true',
        'searchMode=any',
      ];
  
      // Add highlight parameter
      if (this.fieldMapping.title) {
        params.push(`highlight=${encodeURIComponent(`content,${this.fieldMapping.title}`)}`);
      } else {
        params.push('highlight=content');
      }
  
      // Add select parameter
      params.push('select=*');
  
      // Build filter string using discovered field names
      const filterConditions = [];
      
      if (filters?.authors && filters.authors.length > 0 && this.fieldMapping.author) {
        const authorFilter = filters.authors.map(author => 
          `${this.fieldMapping.author} eq '${author.replace(/'/g, "''")}'`
        ).join(' or ');
        filterConditions.push(`(${authorFilter})`);
      }
  
      if (filters?.categories && filters.categories.length > 0 && this.fieldMapping.contentType) {
        const categoryFilter = filters.categories.map(cat => 
          `${this.fieldMapping.contentType} eq '${cat.replace(/'/g, "''")}'`
        ).join(' or ');
        filterConditions.push(`(${categoryFilter})`);
      }
  
      if (filters?.documentIds && filters.documentIds.length > 0) {
        const idFilter = filters.documentIds.map(id => 
          `metadata_storage_path eq '${id.replace(/'/g, "''")}'`
        ).join(' or ');
        filterConditions.push(`(${idFilter})`);
      }
  
      if (filters?.dateRange?.start && this.fieldMapping.lastModified) {
        filterConditions.push(`${this.fieldMapping.lastModified} ge ${filters.dateRange.start}T00:00:00Z`);
      }
  
      if (filters?.dateRange?.end && this.fieldMapping.lastModified) {
        filterConditions.push(`${this.fieldMapping.lastModified} le ${filters.dateRange.end}T23:59:59Z`);
      }
  
      if (filterConditions.length > 0) {
        params.push(`$filter=${encodeURIComponent(filterConditions.join(' and '))}`);
      }
  
      const url = `${this.baseUrl}/indexes/${this.indexName}/docs?${params.join('&')}`;
      
      console.log('🔗 Search URL:', url); // Debug log
  
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        }
      });
  
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Search failed:', {
          status: response.status,
          statusText: response.statusText,
          url: url,
          errorText: errorText
        });
        throw new AzureServiceError(
          `Search request failed: ${response.status} ${response.statusText} - ${errorText}`,
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
            author: rawDoc[this.fieldMapping.author || 'metadata_author'],
            contentType: rawDoc[this.fieldMapping.contentType || 'metadata_storage_content_type'],
            content: rawDoc.content ? rawDoc.content.substring(0, 100) + '...' : 'No content',
            '@search.score': rawDoc['@search.score'],
          };
        }));
      }
      
      return {
        documents: (result.value || []).map(doc => this.mapAzureDocumentToFrontend(doc)),
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
      return this.mapAzureDocumentToFrontend(azureDoc);
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
      console.log('🔍 Starting getAvailableFilters...');
      console.log('🔧 Azure Search Config:', {
        endpoint: this.baseUrl,
        indexName: this.indexName,
        hasApiKey: !!this.apiKey
      });

      // First, let's try a simple search without facets to test basic connectivity
      const testParams = new URLSearchParams({
        'api-version': '2023-11-01',
        search: '*',
        '$top': '1'
      });

      const testUrl = `${this.baseUrl}/indexes/${this.indexName}/docs?${testParams.toString()}`;
      console.log('🧪 Testing basic search:', testUrl);

      const testResponse = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        }
      });

      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        console.error('❌ Basic search failed:', {
          status: testResponse.status,
          statusText: testResponse.statusText,
          errorText
        });
        throw new AzureServiceError(
          `Basic search failed: ${testResponse.status} ${testResponse.statusText} - ${errorText}`,
          'search',
          testResponse.status
        );
      }

      const testResult = await testResponse.json();
      console.log('✅ Basic search successful');
      
      // Log available fields from the first document
      if (testResult.value && testResult.value.length > 0) {
        const firstDoc = testResult.value[0];
        const availableFields = Object.keys(firstDoc).filter(key => !key.startsWith('@'));
        console.log('📋 Available fields in index:', availableFields);
        
        // Check for common author fields
        const possibleAuthorFields = availableFields.filter(field => 
          field.toLowerCase().includes('author') || 
          field.toLowerCase().includes('creator') ||
          field.toLowerCase().includes('writer')
        );
        console.log('👤 Possible author fields:', possibleAuthorFields);
        
        // Check for common type/category fields
        const possibleTypeFields = availableFields.filter(field => 
          field.toLowerCase().includes('type') || 
          field.toLowerCase().includes('category') ||
          field.toLowerCase().includes('content_type') ||
          field.toLowerCase().includes('extension')
        );
        console.log('📂 Possible type/category fields:', possibleTypeFields);
      }

      // Now discover what facetable fields actually exist and try those
      let authorField = null;
      let contentTypeField = null;
      let extensionField = null;

      if (testResult.value && testResult.value.length > 0) {
        const firstDoc = testResult.value[0];
        const availableFields = Object.keys(firstDoc).filter(key => !key.startsWith('@'));
        
        // Find the best author field
        const possibleAuthorFields = availableFields.filter(field => 
          field.toLowerCase().includes('author') || 
          field.toLowerCase().includes('creator') ||
          field.toLowerCase().includes('writer') ||
          field.toLowerCase().includes('by')
        );
        authorField = possibleAuthorFields[0] || null;
        
        // Find the best content type field
        const possibleTypeFields = availableFields.filter(field => 
          field.toLowerCase().includes('type') || 
          field.toLowerCase().includes('category') ||
          field.toLowerCase().includes('content_type') ||
          field.toLowerCase().includes('mime')
        );
        contentTypeField = possibleTypeFields[0] || null;
        
        // Find the best extension field
        const possibleExtensionFields = availableFields.filter(field => 
          field.toLowerCase().includes('extension') ||
          field.toLowerCase().includes('ext') ||
          field.toLowerCase().includes('format')
        );
        extensionField = possibleExtensionFields[0] || null;

        console.log('🔍 Field mapping discovered:', {
          authorField,
          contentTypeField,
          extensionField,
          availableFields: availableFields.slice(0, 10) // Show first 10 fields
        });
      }

      // Try to get facets for the fields we found
      const results = {
        authors: [] as Array<{ name: string; count: number }>,
        categories: [] as Array<{ name: string; count: number }>,
        documentTypes: [] as Array<{ name: string; count: number }>
      };

      // Try each facet separately to see which ones work
      const facetAttempts = [
        { field: authorField, type: 'authors' },
        { field: contentTypeField, type: 'categories' },
        { field: extensionField, type: 'documentTypes' }
      ];

      for (const attempt of facetAttempts) {
        if (!attempt.field) {
          console.log(`⚠️ No suitable field found for ${attempt.type}`);
          continue;
        }

        try {
          const facetParams = new URLSearchParams({
            'api-version': '2023-11-01',
            search: '*',
            '$top': '0'
          });
          
          facetParams.append('facet', `${attempt.field},count:50`);
          
          const facetUrl = `${this.baseUrl}/indexes/${this.indexName}/docs?${facetParams.toString()}`;
          console.log(`🎯 Trying facet for ${attempt.type} using field: ${attempt.field}`);

          const facetResponse = await fetch(facetUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'api-key': this.apiKey
            }
          });

          if (facetResponse.ok) {
            const facetResult = await facetResponse.json();
            const facets = facetResult['@search.facets'] || {};
            
            if (facets[attempt.field]) {
              const facetData = facets[attempt.field].map((facet: any) => ({
                name: facet.value || 'Unknown',
                count: facet.count || 0
              }));
              
              if (attempt.type === 'authors') results.authors = facetData;
              else if (attempt.type === 'categories') results.categories = facetData;
              else if (attempt.type === 'documentTypes') results.documentTypes = facetData;
              
              console.log(`✅ Successfully got ${attempt.type} facets:`, facetData.slice(0, 3));
            }
          } else {
            const errorText = await facetResponse.text();
            console.log(`❌ Facet failed for ${attempt.field}:`, errorText);
          }
        } catch (error) {
          console.log(`💥 Error trying facet for ${attempt.field}:`, error);
        }
      }

      console.log('📊 Final facet results:', {
        authors: results.authors.length,
        categories: results.categories.length,
        documentTypes: results.documentTypes.length
      });

      return results;
    } catch (error) {
      console.error('💥 getAvailableFilters error:', error);
      
      if (error instanceof AzureServiceError) {
        throw error;
      }
      
      // For now, return empty results instead of crashing
      console.log('🔄 Returning empty filters due to error');
      return {
        authors: [],
        categories: [],
        documentTypes: []
      };
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

// Debug function to check Azure configuration
export const debugAzureConfig = () => {
  console.log('🔧 Azure Configuration Check:');
  console.log('OpenAI:', {
    endpoint: azureConfig.openai.endpoint ? '✅ Set' : '❌ Missing',
    apiKey: azureConfig.openai.apiKey ? '✅ Set' : '❌ Missing',
    deploymentName: azureConfig.openai.deploymentName,
    apiVersion: azureConfig.openai.apiVersion
  });
  console.log('Search:', {
    endpoint: azureConfig.search.endpoint ? '✅ Set' : '❌ Missing',
    apiKey: azureConfig.search.apiKey ? '✅ Set' : '❌ Missing',
    indexName: azureConfig.search.indexName
  });
  console.log('Storage:', {
    accountName: azureConfig.storage?.accountName ? '✅ Set' : '❌ Missing',
    containerName: azureConfig.storage?.containerName || 'documents',
    accountKey: azureConfig.storage?.accountKey ? '✅ Set' : '❌ Missing'
  });
  
  // Check environment variables directly
  console.log('🌍 Environment Variables:');
  console.log({
    VITE_AZURE_OPENAI_ENDPOINT: import.meta.env.VITE_AZURE_OPENAI_ENDPOINT ? '✅ Set' : '❌ Missing',
    VITE_AZURE_OPENAI_API_KEY: import.meta.env.VITE_AZURE_OPENAI_API_KEY ? '✅ Set' : '❌ Missing',
    VITE_AZURE_SEARCH_ENDPOINT: import.meta.env.VITE_AZURE_SEARCH_ENDPOINT ? '✅ Set' : '❌ Missing',
    VITE_AZURE_SEARCH_API_KEY: import.meta.env.VITE_AZURE_SEARCH_API_KEY ? '✅ Set' : '❌ Missing',
    VITE_AZURE_SEARCH_INDEX_NAME: import.meta.env.VITE_AZURE_SEARCH_INDEX_NAME ? '✅ Set' : '❌ Missing',
    VITE_AZURE_STORAGE_ACCOUNT_NAME: import.meta.env.VITE_AZURE_STORAGE_ACCOUNT_NAME ? '✅ Set' : '❌ Missing',
    VITE_AZURE_STORAGE_CONTAINER_NAME: import.meta.env.VITE_AZURE_STORAGE_CONTAINER_NAME ? '✅ Set' : '❌ Missing'
  });
  
  return azureConfig;
}; 