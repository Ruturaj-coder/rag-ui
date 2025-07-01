// API Service - Frontend to Backend Communication
// Replaces direct Azure service calls with HTTP requests to FastAPI backend

export interface SearchFilters {
  authors?: string[];
  categories?: string[];
  document_types?: string[];
  date_range?: {
    start?: string;
    end?: string;
  };
  document_ids?: string[];
}

export interface FacetItem {
  name: string;
  count: number;
  expertise?: string;
}

export interface SearchFacets {
  authors: FacetItem[];
  categories: FacetItem[];
  documentTypes: FacetItem[];
}

export interface AzureSearchDocument {
  id: string;
  title: string;
  content: string;
  author: string;
  category: string;
  type: string;
  date: string;
  size: string;
  score: number;
}

export interface SourceDocument {
  name: string;
  author: string;
  relevance: number;
  type: string;
  category: string;
  id: string;
}

export interface RAGResponse {
  response: string;
  sources: SourceDocument[];
  confidence: number;
  tokens: number;
  processing_time: number;
  model: string;
}

export interface SearchResponse {
  documents: AzureSearchDocument[];
  total_count: number;
  facets?: {
    authors: FacetItem[];
    categories: FacetItem[];
    document_types: FacetItem[];
  };
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  services: {
    search: boolean;
    openai: boolean;
  };
  errors: string[];
}

export class AzureServiceError extends Error {
  constructor(message: string, public service: string) {
    super(message);
    this.name = 'AzureServiceError';
  }
}

class APIService {
  private baseURL: string;

  constructor() {
    // Use environment variable or default to localhost
    this.baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, defaultOptions);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new AzureServiceError(
          errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
          'api'
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof AzureServiceError) {
        throw error;
      }
      
      // Network or other errors
      console.error('API request failed:', error);
      throw new AzureServiceError(
        `Failed to connect to backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'network'
      );
    }
  }

  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  async searchDocuments(
    query: string,
    filters?: SearchFilters,
    top: number = 10,
    includeFacets: boolean = false
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>('/api/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        filters: filters || {},
        top,
        include_facets: includeFacets,
      }),
    });
  }

  async processQuery(
    query: string,
    filters?: SearchFilters,
    options?: {
      temperature?: number;
      maxTokens?: number;
      topDocuments?: number;
    }
  ): Promise<RAGResponse> {
    return this.request<RAGResponse>('/api/rag', {
      method: 'POST',
      body: JSON.stringify({
        query,
        filters: filters || {},
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 2000,
        top_documents: options?.topDocuments || 10,
      }),
    });
  }

  async getAvailableFilters(): Promise<SearchFacets> {
    const response = await this.request<{ authors: FacetItem[]; categories: FacetItem[]; document_types: FacetItem[] }>('/api/facets');
    return {
      authors: response.authors || [],
      categories: response.categories || [],
      documentTypes: response.document_types || [],
    };
  }

  async getConfiguration(): Promise<any> {
    return this.request<any>('/api/config');
  }
}

// Create singleton instance
export const apiService = new APIService();

// Create ragService alias for backward compatibility
export const ragService = {
  processQuery: (
    query: string,
    filters: SearchFilters,
    options: { temperature?: number; maxTokens?: number; topDocuments?: number }
  ) => apiService.processQuery(query, filters, options),
  
  getAvailableFilters: () => apiService.getAvailableFilters(),
  
  searchDocuments: (query: string, filters?: SearchFilters, top?: number) => 
    apiService.searchDocuments(query, filters, top, false)
};

// Debug and test functions
export const debugAzureConfig = (): boolean => {
  console.log('🔧 Backend API Configuration:');
  console.log(`Base URL: ${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}`);
  return true;
};

export const testAzureServices = async (): Promise<{ search: boolean; openai: boolean; errors: string[] }> => {
  try {
    const health = await apiService.healthCheck();
    return {
      search: health.services.search,
      openai: health.services.openai,
      errors: health.errors || []
    };
  } catch (error) {
    console.error('Backend health check failed:', error);
    return {
      search: false,
      openai: false,
      errors: [error instanceof Error ? error.message : 'Unknown error']
    };
  }
};

// All types are already exported above with their interface declarations 