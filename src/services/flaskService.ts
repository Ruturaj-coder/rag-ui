// Simple Flask Backend Service
// Matches the Flask backend endpoints in app.py

export interface ChatFilters {
  author?: string;
  file_type?: string;
}

export interface ChatRequest {
  query: string;
  filters?: ChatFilters;
}

export interface ChatResponse {
  answer: string;
}

export interface FilterOptions {
  authors: string[];
  file_types: string[];
}

export interface Source {
  name: string;
  author: string;
  relevance: number;
  type: string;
  category: string;
  id: string;
}

export interface Message {
  id: number;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  sources: Source[];
  confidence?: number;
  tokens?: number;
  processingTime?: number;
  model?: string;
  temperature?: number;
}

export class FlaskServiceError extends Error {
  constructor(message: string, public service: string) {
    super(message);
    this.name = 'FlaskServiceError';
  }
}

class FlaskService {
  private baseURL: string;

  constructor() {
    // Use environment variable or default to localhost:5000 (Flask default)
    this.baseURL = 'http://localhost:5000';
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
        throw new FlaskServiceError(
          errorData.detail || errorData.error || `HTTP ${response.status}: ${response.statusText}`,
          'api'
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof FlaskServiceError) {
        throw error;
      }
      
      // Network or other errors
      console.error('API request failed:', error);
      throw new FlaskServiceError(
        `Failed to connect to backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'network'
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getFilterOptions(): Promise<FilterOptions> {
    return this.request<FilterOptions>('/filters');
  }

  // Health check method (basic connectivity test)
  async healthCheck(): Promise<{ status: string }> {
    try {
      // Try to get filters as a simple health check
      await this.getFilterOptions();
      return { status: 'connected' };
    } catch (error) {
      throw new FlaskServiceError(
        'Backend health check failed',
        'health'
      );
    }
  }
}

// Create singleton instance
export const flaskService = new FlaskService();

// Debug function
export const debugFlaskConfig = (): boolean => {
  console.log('🔧 Flask Backend Configuration:');
  console.log(`Base URL: ${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}`);
  return true;
};

// Test function
export const testFlaskConnection = async (): Promise<{ connected: boolean; error?: string }> => {
  try {
    await flaskService.healthCheck();
    return { connected: true };
  } catch (error) {
    console.error('Flask connection test failed:', error);
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}; 