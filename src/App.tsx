import React, { useState, useRef, useEffect } from 'react';
import { Search, Send, Filter, X, Calendar, User, FileText, ChevronDown, Settings, Sparkles, Bot, Clock, TrendingUp, Database, Mic, MicOff, Copy, ThumbsUp, ThumbsDown, Share2, Download, Bookmark, MessageSquare, Brain, Zap, Shield, Globe, BarChart3, Eye, EyeOff, Moon, Sun, Palette, Volume2, VolumeX, AlertCircle, MapPin, Building, Star, Info } from 'lucide-react';
import { ragService, AzureServiceError, debugAzureConfig, testAzureServices, type AzureSearchDocument, type SearchFilters, type SearchFacets, type FacetItem } from './services/apiService';

// Type definitions
interface Source {
  name: string;
  author: string;
  relevance: number;
  type: string;
  category: string;
  id: string; // Azure Storage path
}

interface Message {
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

interface Author {
  name: string;
  expertise?: string;
  count: number;
}

interface Document {
  id: string;
  name: string;
  author: string;
  date: string;
  type: string;
  size?: string;
  category: string;
  status?: string;
  downloads?: number;
  content?: string;
}

interface DateRange {
  start: string;
  end: string;
}

interface QuickPrompt {
  text: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Model {
  id: string;
  name: string;
  description: string;
}

// Extend window for speech recognition
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

// Helper function to generate Azure Storage URL
const generateAzureStorageUrl = (filePath: string): string => {
  const accountName = import.meta.env.VITE_AZURE_STORAGE_ACCOUNT_NAME;
  const containerName = import.meta.env.VITE_AZURE_STORAGE_CONTAINER_NAME;
  
  if (!accountName || !containerName) {
    console.warn('Azure Storage configuration not found');
    return '#';
  }

  // Extract blob name from full Azure Storage path
  let blobName = filePath;
  
  // If it's a full URL like: https://account.blob.core.windows.net/container/path/file.pdf
  if (filePath.includes('blob.core.windows.net')) {
    const urlParts = filePath.split('/');
    const containerIndex = urlParts.findIndex(part => part === containerName);
    if (containerIndex !== -1 && containerIndex < urlParts.length - 1) {
      // Get everything after the container name and decode any existing encoding
      blobName = urlParts.slice(containerIndex + 1).map(part => decodeURIComponent(part)).join('/');
    }
  }
  
  // If it starts with container name, remove it
  if (blobName.startsWith(`${containerName}/`)) {
    blobName = blobName.substring(containerName.length + 1);
  }
  
  // Remove leading slash if present
  blobName = blobName.startsWith('/') ? blobName.substring(1) : blobName;
  
  // Properly encode the blob name (handles spaces and special characters)
  const encodedBlobName = blobName.split('/').map(part => encodeURIComponent(part)).join('/');
  
  const finalUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${encodedBlobName}`;
  
  console.log('🔗 Generating URL:', {
    originalPath: filePath,
    extractedBlobName: blobName,
    encodedBlobName: encodedBlobName,
    finalUrl: finalUrl
  });
  
  return finalUrl;
};

// Helper function to normalize relevance scores
const normalizeRelevance = (score: number): number => {
  // Azure Search scores can be much higher than 1.0
  // Normalize to 0-1 range using a logarithmic scale for better distribution
  if (score <= 0) return 0;
  if (score >= 10) return 1; // Cap very high scores
  
  // Use a sigmoid-like function to normalize scores between 0-10 to 0-1
  return Math.min(1, score / 10);
};

// Helper function to open file in new tab
const openFile = (source: Source) => {
  console.log('📁 Opening file:', {
    sourceName: source.name,
    sourceId: source.id,
    sourceType: source.type
  });
  
  const url = generateAzureStorageUrl(source.id);
  if (url !== '#') {
    console.log('✅ Opening URL:', url);
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    console.warn('❌ Cannot open file: Azure Storage configuration missing');
    alert('Azure Storage is not configured. Please check your environment variables.');
  }
};

// Enhanced Formatted Response Component
const FormattedResponse: React.FC<{ content: string; darkMode: boolean }> = ({ content, darkMode }) => {
  // Parse the content into structured sections
  const parseContent = (text: string) => {
    const lines = text.split('\n');
    const sections: Array<{
      type: 'header' | 'bullet' | 'text';
      content: string;
      level?: number;
      icon?: React.ComponentType<{ className?: string }>;
    }> = [];

    let currentSection: any = null;

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('###')) {
        // Main section header
        const headerText = trimmedLine.replace(/^#{1,6}\s*/, '').replace(/:\s*$/, '');
        let icon = Info;
        
        // Assign icons based on content
        const lowerContent = headerText.toLowerCase();
        if (lowerContent.includes('location') || lowerContent.includes('dubai') || lowerContent.includes('vegas') || lowerContent.includes('london')) {
          icon = MapPin;
        } else if (lowerContent.includes('accommodation') || lowerContent.includes('hotel')) {
          icon = Building;
        } else if (lowerContent.includes('key') || lowerContent.includes('summary') || lowerContent.includes('overview')) {
          icon = Star;
        } else if (lowerContent.includes('risk') || lowerContent.includes('security') || lowerContent.includes('compliance')) {
          icon = Shield;
        } else if (lowerContent.includes('trend') || lowerContent.includes('market') || lowerContent.includes('analysis')) {
          icon = TrendingUp;
        } else if (lowerContent.includes('data') || lowerContent.includes('report') || lowerContent.includes('document')) {
          icon = FileText;
        } else if (lowerContent.includes('user') || lowerContent.includes('author') || lowerContent.includes('customer')) {
          icon = User;
        } else if (lowerContent.includes('calendar') || lowerContent.includes('date') || lowerContent.includes('time')) {
          icon = Calendar;
        }
        
        sections.push({
          type: 'header',
          content: headerText,
          level: 3,
          icon
        });
      } else if (trimmedLine.startsWith('##')) {
        // Sub-section header
        const headerText = trimmedLine.replace(/^#{1,6}\s*/, '').replace(/:\s*$/, '');
        sections.push({
          type: 'header',
          content: headerText,
          level: 2,
          icon: Info
        });
      } else if (trimmedLine.startsWith('- **') || trimmedLine.startsWith('- ')) {
        // Bullet point
        let bulletContent = trimmedLine.replace(/^-\s*/, '');
        
        // Handle formatting
        if (bulletContent.includes('**')) {
          bulletContent = bulletContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        }
        if (bulletContent.includes('*') && !bulletContent.includes('**')) {
          bulletContent = bulletContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
        }
        
        sections.push({
          type: 'bullet',
          content: bulletContent
        });
      } else if (/^\d+\.\s/.test(trimmedLine)) {
        // Numbered list
        let numberContent = trimmedLine.replace(/^\d+\.\s*/, '');
        
        // Handle formatting
        if (numberContent.includes('**')) {
          numberContent = numberContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        }
        if (numberContent.includes('*') && !numberContent.includes('**')) {
          numberContent = numberContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
        }
        
        sections.push({
          type: 'bullet', // Treat numbered lists similar to bullets for now
          content: numberContent
        });
      } else if (trimmedLine) {
        // Regular text
        let textContent = trimmedLine;
        
        // Handle formatting
        if (textContent.includes('**')) {
          textContent = textContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        }
        if (textContent.includes('*') && !textContent.includes('**')) {
          textContent = textContent.replace(/\*(.*?)\*/g, '<em>$1</em>');
        }
        
        sections.push({
          type: 'text',
          content: textContent
        });
      }
    });

    return sections;
  };

  const sections = parseContent(content);

  return (
    <div className="space-y-4">
      {sections.map((section, index) => {
        if (section.type === 'header') {
          const Icon = section.icon || Info;
          return (
            <div key={index} className={`relative ${section.level === 3 ? 'mb-6' : 'mb-4'}`}>
              {section.level === 3 ? (
                <div className={`relative p-4 rounded-xl border-l-4 ${
                  darkMode 
                    ? 'bg-gradient-to-r from-blue-900/30 to-blue-800/20 border-blue-400 bg-gray-800/50' 
                    : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-500 bg-white/80'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      darkMode 
                        ? 'bg-blue-600/80 text-white' 
                        : 'bg-blue-600 text-white'
                    }`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className={`text-xl font-bold ${
                      darkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                      {section.content}
                    </h3>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                  <h4 className={`text-lg font-semibold ${
                    darkMode ? 'text-gray-200' : 'text-gray-800'
                  }`}>
                    {section.content}
                  </h4>
                </div>
              )}
            </div>
          );
        } else if (section.type === 'bullet') {
          return (
            <div key={index} className={`ml-6 mb-3`}>
              <div className="flex items-start gap-3 group">
                <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 transition-colors ${
                  darkMode ? 'bg-blue-400 group-hover:bg-blue-300' : 'bg-blue-600 group-hover:bg-blue-700'
                }`}></div>
                <div 
                  className={`text-sm leading-relaxed flex-1 ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                  dangerouslySetInnerHTML={{ __html: section.content }}
                  style={{
                    lineHeight: '1.6'
                  }}
                />
              </div>
            </div>
          );
        } else {
          return (
            <div 
              key={index} 
              className={`text-sm leading-relaxed ${
                darkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
              dangerouslySetInnerHTML={{ __html: section.content }}
            />
          );
        }
      })}
    </div>
  );
};

const RAGChatbot = () => {
  // Add custom scrollbar styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* Improved scrollbar for all containers */
      *::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      *::-webkit-scrollbar-track {
        background: transparent;
      }
      *::-webkit-scrollbar-thumb {
        background: rgba(156, 163, 175, 0.4);
        border-radius: 3px;
        transition: background 0.2s ease;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: rgba(156, 163, 175, 0.7);
      }
      .dark *::-webkit-scrollbar-thumb {
        background: rgba(75, 85, 99, 0.5);
      }
      .dark *::-webkit-scrollbar-thumb:hover {
        background: rgba(75, 85, 99, 0.8);
      }
      *::-webkit-scrollbar-corner {
        background: transparent;
      }
      .fade-bottom {
        position: relative;
      }
      .fade-bottom::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 20px;
        background: linear-gradient(to bottom, transparent, currentColor);
        pointer-events: none;
        opacity: 0.1;
      }
      .smooth-scroll {
        scroll-behavior: smooth;
      }
      /* Ensure smooth scrolling for all scroll containers */
      div[style*="overflow-y: auto"] {
        scroll-behavior: smooth;
        scrollbar-width: thin;
        scrollbar-color: rgba(156, 163, 175, 0.4) transparent;
      }
      .custom-checkbox {
        appearance: none;
        width: 16px;
        height: 16px;
        border: 2px solid #d1d5db;
        border-radius: 4px;
        background: white;
        position: relative;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .custom-checkbox:hover {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
      .custom-checkbox:checked {
        background: #3b82f6;
        border-color: #3b82f6;
      }
      .custom-checkbox:checked::after {
        content: '';
        position: absolute;
        left: 3px;
        top: 0px;
        width: 6px;
        height: 10px;
        border: solid white;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .dark .custom-checkbox {
        background: #374151;
        border-color: #4b5563;
      }
      .dark .custom-checkbox:hover {
        border-color: #60a5fa;
      }
      .accordion-content {
        transition: all 0.3s ease;
        overflow: hidden;
      }
      .accordion-content.collapsed {
        max-height: 0;
        opacity: 0;
      }
      .accordion-content.expanded {
        max-height: 500px;
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      type: 'bot',
      content: 'Hello! I\'m your AI-powered RAG assistant with advanced capabilities. I can analyze documents, provide insights, generate summaries, and even speak responses aloud. How can I assist you today?',
      timestamp: new Date(),
      sources: [],
      confidence: 0.95,
      tokens: 1250,
      processingTime: 1.2
    }
  ]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);

  // Error handling
  const [error, setError] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<{
    connected: boolean;
    message?: string;
  }>({ connected: false });

  // Data loading states
  const [isLoadingFilters, setIsLoadingFilters] = useState<boolean>(true);
  const [azureDocuments, setAzureDocuments] = useState<Document[]>([]);
  const [azureFacets, setAzureFacets] = useState<SearchFacets>({
    authors: [],
    categories: [],
    documentTypes: []
  });

  // Advanced states
  const [conversationMode, setConversationMode] = useState<string>('standard'); // standard, creative, analytical
  const [selectedModel, setSelectedModel] = useState<string>('gpt-4');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(2000);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  // Filter states
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '' });
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [documentSearchTerm, setDocumentSearchTerm] = useState<string>('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Show more/less states for lists
  const [showAllAuthors, setShowAllAuthors] = useState<boolean>(false);
  const [showAllDocuments, setShowAllDocuments] = useState<boolean>(false);

  // Filter sidebar state
  const [activeFilterCategory, setActiveFilterCategory] = useState<string>('authors');

  // Search states for each category
  const [authorSearchTerm, setAuthorSearchTerm] = useState<string>('');
  const [categorySearchTerm, setCategorySearchTerm] = useState<string>('');

  // Analytics
  const [queryCount, setQueryCount] = useState<number>(142);
  const [successRate, setSuccessRate] = useState<number>(94.2);
  const [avgResponseTime, setAvgResponseTime] = useState<number>(2.3);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  // Helper functions for filtering and selections
  const selectFilterCategory = (category: string) => {
    setActiveFilterCategory(category);
  };

  const selectAllInCategory = (category: 'authors' | 'categories' | 'documents') => {
    switch (category) {
      case 'authors':
        const filteredAuthors = authors.filter(author =>
          author.name.toLowerCase().includes(authorSearchTerm.toLowerCase()) ||
          (author.expertise && author.expertise.toLowerCase().includes(authorSearchTerm.toLowerCase()))
        );
        setSelectedAuthors(filteredAuthors.map(a => a.name));
        break;
      case 'categories':
        const filteredCategories = categories.filter(cat =>
          cat.toLowerCase().includes(categorySearchTerm.toLowerCase())
        );
        setSelectedCategories(filteredCategories);
        break;
      case 'documents':
        setSelectedDocuments(filteredDocuments.map(d => d.id.toString()));
        break;
    }
  };

  const selectNoneInCategory = (category: 'authors' | 'categories' | 'documents') => {
    switch (category) {
      case 'authors':
        setSelectedAuthors([]);
        break;
      case 'categories':
        setSelectedCategories([]);
        break;
      case 'documents':
        setSelectedDocuments([]);
        break;
    }
  };

  const getFilterChips = () => {
    const chips = [];
    selectedAuthors.forEach(author => chips.push({ type: 'author', value: author, label: author }));
    selectedCategories.forEach(cat => chips.push({ type: 'category', value: cat, label: cat }));
    selectedDocuments.forEach(docId => {
      const doc = documents.find(d => d.id === docId);
      if (doc) chips.push({ type: 'document', value: docId.toString(), label: doc.name });
    });
    if (dateRange.start || dateRange.end) {
      chips.push({ 
        type: 'date', 
        value: 'date', 
        label: `${dateRange.start || 'Start'} - ${dateRange.end || 'End'}` 
      });
    }
    return chips;
  };

  const removeFilterChip = (chip: any) => {
    switch (chip.type) {
      case 'author':
        setSelectedAuthors(prev => prev.filter(a => a !== chip.value));
        break;
      case 'category':
        setSelectedCategories(prev => prev.filter(c => c !== chip.value));
        break;
      case 'document':
        setSelectedDocuments(prev => prev.filter(d => d !== chip.value));
        break;
      case 'date':
        setDateRange({ start: '', end: '' });
        break;
    }
  };

  // Use Azure data when available, fallback to empty arrays
  const authors = azureFacets.authors;
  const categories = azureFacets.categories.map(cat => cat.name);

  // Use Azure documents when available, fallback to empty array
  const documents = azureDocuments;

  const quickPrompts = [
    { text: "Summarize latest risk reports", icon: Shield },
    { text: "What are the key market trends?", icon: TrendingUp },
    { text: "Show compliance requirements", icon: FileText },
    { text: "Analyze customer sentiment", icon: BarChart3 }
  ];

  const models = [
    { id: 'gpt-4', name: 'GPT-4', description: 'Most capable, best for complex analysis' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Faster responses with excellent quality' },
    { id: 'gpt-35-turbo', name: 'GPT-3.5 Turbo', description: 'Cost-effective for simpler queries' }
  ];

  // Enhanced functions and filtered data
  const filteredAuthors = authors.filter(author =>
    author.name.toLowerCase().includes(authorSearchTerm.toLowerCase()) ||
    (author.expertise && author.expertise.toLowerCase().includes(authorSearchTerm.toLowerCase()))
  );

  const filteredCategories = categories.filter(category =>
    category.toLowerCase().includes(categorySearchTerm.toLowerCase())
  );

  const filteredDocuments = documents.filter(doc =>
    (doc.name.toLowerCase().includes(documentSearchTerm.toLowerCase()) ||
      doc.author.toLowerCase().includes(documentSearchTerm.toLowerCase())) &&
    (selectedCategories.length === 0 || selectedCategories.includes(doc.category))
  );

  // Count documents per category
  const getCategoryCount = (category: string) => {
    return documents.filter(doc => doc.category === category).length;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load initial data from Azure services
  useEffect(() => {
    const loadAzureData = async () => {
      try {
        setIsLoadingFilters(true);
        setError(null);
        
        // Debug Azure configuration first
        console.log('🚀 Starting Azure data load...');
        const config = debugAzureConfig();
        
        if (!config) {
          throw new AzureServiceError('Azure configuration is invalid or missing', 'config');
        }
        
        // Test Azure services connection
        const connectionTest = await testAzureServices();
        console.log('🧪 Connection test results:', connectionTest);
        
        if (!connectionTest.search || !connectionTest.openai) {
          throw new AzureServiceError('Service connection failed: ' + connectionTest.errors.join(', '), 'connection');
        }
        
        // Load available filters from Azure Search
        const facets = await ragService.getAvailableFilters();
        setAzureFacets(facets);
        
        // Load initial document list (empty search to get all)
        const searchResult = await ragService.processQuery('*', {}, { topDocuments: 50 });
        
        // Convert search results to Document format
        const docs: Document[] = searchResult.sources.map(source => ({
          id: source.id,
          name: source.name,
          author: source.author,
          date: new Date().toISOString().split('T')[0], // Default to today if no date
          type: source.type,
          category: source.category,
          status: 'active'
        }));
        
        setAzureDocuments(docs);
        setServiceStatus({ connected: true, message: 'Connected to Azure services' });
        
      } catch (err) {
        console.error('Failed to load Azure data:', err);
        if (err instanceof AzureServiceError) {
          setError(`Azure ${err.service} error: ${err.message}`);
        } else {
          setError('Failed to connect to Azure services. Please check your configuration.');
        }
        setServiceStatus({ connected: false, message: 'Azure services unavailable' });
        
        // Set empty fallback data
        setAzureFacets({
          authors: [],
          categories: [],
          documentTypes: []
        });
        setAzureDocuments([]);
      } finally {
        setIsLoadingFilters(false);
      }
    };

    loadAzureData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current &&
        !filterRef.current.contains(event.target as Node) &&
        filterButtonRef.current &&
        !filterButtonRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
      if (settingsRef.current &&
        !settingsRef.current.contains(event.target as Node) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(event.target as Node)) {
        setShowAdvancedSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSendMessage = async (messageText: string = inputMessage) => {
    if (!messageText.trim()) return;

    const userMessage: Message = {
      id: messages.length + 1,
      type: 'user',
      content: messageText,
      timestamp: new Date(),
      sources: []
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);
    setQueryCount(prev => prev + 1);
    setError(null);

    try {
      // Prepare filters for Azure Search using the new SearchFilters interface
      const filters: SearchFilters = {};
      
      if (selectedAuthors.length > 0) {
        filters.authors = selectedAuthors;
      }
      
      if (selectedCategories.length > 0) {
        filters.categories = selectedCategories;
      }
      
      if (dateRange.start || dateRange.end) {
        filters.date_range = {
          start: dateRange.start || undefined,
          end: dateRange.end || undefined
        };
      }
      
      if (selectedDocuments.length > 0) {
        filters.document_ids = selectedDocuments;
      }

      // Use Azure RAG service to process the query
      const ragResult = await ragService.processQuery(
        messageText,
        filters,
        {
          temperature,
          maxTokens,
          topDocuments: 10
        }
      );

              const botResponse: Message = {
          id: messages.length + 2,
          type: 'bot',
          content: ragResult.response,
          timestamp: new Date(),
          sources: ragResult.sources.map(source => ({
            name: source.name,
            author: source.author,
            relevance: source.relevance, // Raw Azure Search score
            type: source.type,
            category: source.category,
            id: source.id // Azure Storage path
          })),
          confidence: ragResult.confidence,
          tokens: ragResult.tokens,
          processingTime: ragResult.processing_time,
          model: ragResult.model,
          temperature: temperature
        };

      setMessages(prev => [...prev, botResponse]);

      // Text-to-speech if enabled
      if (audioEnabled && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(
          ragResult.response.replace(/\*\*/g, '').replace(/•/g, '').replace(/#{1,6}\s/g, '')
        );
        utterance.rate = 0.9;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
      }

    } catch (err) {
      console.error('Failed to process message:', err);
      
      let errorMessage = 'Sorry, I encountered an error processing your request. ';
      
      if (err instanceof AzureServiceError) {
        errorMessage += `Azure ${err.service} error: ${err.message}`;
        setError(`Azure ${err.service} error: ${err.message}`);
      } else {
        errorMessage += 'Please try again or check your connection.';
        setError('Failed to process your request. Please try again.');
      }

      const errorResponse: Message = {
        id: messages.length + 2,
        type: 'bot',
        content: errorMessage,
        timestamp: new Date(),
        sources: [],
        confidence: 0,
        tokens: 0,
        processingTime: 0,
        model: selectedModel,
        temperature: temperature
      };

      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const recognition = new window.webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputMessage(transcript);
    };

    recognition.start();
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    // Could add toast notification here
  };

  const toggleAuthor = (author: string) => {
    setSelectedAuthors(prev =>
      prev.includes(author)
        ? prev.filter(a => a !== author)
        : [...prev, author]
    );
  };

  const toggleDocument = (docId: string) => {
    setSelectedDocuments(prev =>
      prev.includes(docId)
        ? prev.filter(id => id !== docId)
        : [...prev, docId]
    );
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const clearFilters = () => {
    setSelectedAuthors([]);
    setSelectedDocuments([]);
    setSelectedCategories([]);
    setDateRange({ start: '', end: '' });
    setDocumentSearchTerm('');
    setAuthorSearchTerm('');
    setCategorySearchTerm('');
    setShowAllAuthors(false);
    setShowAllDocuments(false);
  };

  const activeFiltersCount = selectedAuthors.length + selectedDocuments.length + selectedCategories.length +
    (dateRange.start || dateRange.end ? 1 : 0);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600 bg-green-50 border-green-200';
    if (confidence >= 0.7) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      'Report': 'bg-blue-100 text-blue-800 border-blue-200',
      'Analysis': 'bg-purple-100 text-purple-800 border-purple-200',
      'Guidelines': 'bg-green-100 text-green-800 border-green-200',
      'Framework': 'bg-orange-100 text-orange-800 border-orange-200',
      'Strategy': 'bg-indigo-100 text-indigo-800 border-indigo-200'
    };
    return colors[type] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getModeColor = (mode: string) => {
    const colors: Record<string, string> = {
      'standard': 'bg-blue-100 text-blue-800',
      'creative': 'bg-purple-100 text-purple-800',
      'analytical': 'bg-green-100 text-green-800'
    };
    return colors[mode];
  };

  return (
    <div className={`flex flex-col h-screen transition-colors duration-300 ${darkMode ? 'bg-gray-900 text-white' : 'bg-gradient-to-br from-slate-50 to-blue-50'
      }`}>
      {/* Enhanced Header */}
      <div className={`relative border-b transition-all duration-300 ${
        darkMode 
          ? 'bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 border-gray-700/50' 
          : 'bg-gradient-to-r from-blue-50 via-white to-blue-50 border-gray-200/80'
      }`}>
        {/* Subtle pattern overlay */}
        <div className={`absolute inset-0 opacity-30 ${
          darkMode 
            ? 'bg-gradient-to-br from-blue-900/20 via-transparent to-purple-900/20' 
            : 'bg-gradient-to-br from-blue-500/5 via-transparent to-indigo-500/5'
        }`}></div>
        
                 <div className="relative px-8 py-4">
          <div className="flex items-center justify-between">
            {/* Enhanced Brand Section */}
            <div className="flex items-center gap-5">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-300"></div>
                <div className="relative w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-xl">
                  <img 
                    src="/Barclays Logo.png" 
                    alt="Barclays Logo" 
                    className="w-10 h-10 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const parent = e.currentTarget.parentElement;
                      if (parent) {
                        parent.classList.remove('bg-white');
                        parent.classList.add('bg-gradient-to-br', 'from-blue-600', 'via-blue-700', 'to-indigo-800');
                        parent.innerHTML = '<svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                      }
                    }}
                  />
                </div>
              </div>
              <div>
                <h1 className={`text-2xl font-bold tracking-tight bg-gradient-to-r ${
                  darkMode 
                    ? 'from-white to-gray-200 bg-clip-text text-transparent' 
                    : 'from-gray-900 via-blue-900 to-indigo-900 bg-clip-text text-transparent'
                }`}>
                  Barclays RAG Assistant
                </h1>
              </div>
            </div>

            {/* Enhanced Controls Section */}
            <div className="flex items-center gap-4">
              {/* Service Status Badge */}
              <div className={`relative px-4 py-2 rounded-full text-sm font-semibold shadow-lg ${
                serviceStatus.connected
                  ? darkMode 
                    ? 'bg-gradient-to-r from-green-600/80 to-emerald-600/80 text-white border border-green-400/30' 
                    : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white border border-green-300/50'
                  : darkMode
                    ? 'bg-gradient-to-r from-red-600/80 to-rose-600/80 text-white border border-red-400/30'
                    : 'bg-gradient-to-r from-red-500 to-rose-600 text-white border border-red-300/50'
              }`}>
                <div className="absolute inset-0 bg-white/20 rounded-full blur"></div>
                <span className="relative flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${serviceStatus.connected ? 'bg-white' : 'bg-white animate-pulse'}`}></div>
                  {serviceStatus.connected ? 'Azure Connected' : 'Azure Offline'}
                </span>
              </div>

              {/* Active Filters Badge */}
              {activeFiltersCount > 0 && (
                <div className={`relative px-4 py-2 rounded-full text-sm font-semibold shadow-lg ${
                  darkMode 
                    ? 'bg-gradient-to-r from-blue-600/80 to-indigo-600/80 text-white border border-blue-400/30' 
                    : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white border border-blue-300/50'
                }`}>
                  <div className="absolute inset-0 bg-white/20 rounded-full blur"></div>
                  <span className="relative">{activeFiltersCount} Filter{activeFiltersCount !== 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Enhanced Control Buttons */}
              <div className={`flex items-center gap-2 p-2 rounded-xl backdrop-blur-sm shadow-lg ${
                darkMode 
                  ? 'bg-gray-800/80 border border-gray-700/50' 
                  : 'bg-white/80 border border-gray-200/50'
              }`}>
                <button
                  onClick={() => {
                    if (audioEnabled && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                    setAudioEnabled(!audioEnabled);
                  }}
                  className={`relative p-2.5 rounded-lg transition-all duration-300 group ${
                    audioEnabled 
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md' 
                      : darkMode
                        ? 'text-gray-400 hover:text-white hover:bg-gradient-to-r hover:from-gray-700 hover:to-gray-600'
                        : 'text-gray-600 hover:text-blue-700 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 hover:shadow-md'
                  }`}
                  title="Toggle Text-to-Speech"
                >
                  {audioEnabled && (
                    <div className="absolute inset-0 bg-blue-400/20 rounded-lg animate-pulse"></div>
                  )}
                  <div className="relative">
                    {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </div>
                </button>

                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className={`relative p-2.5 rounded-lg transition-all duration-300 group ${
                    darkMode
                      ? 'text-gray-400 hover:text-white hover:bg-gradient-to-r hover:from-gray-700 hover:to-gray-600'
                      : 'text-gray-600 hover:text-blue-700 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 hover:shadow-md'
                  }`}
                  title="Toggle Dark Mode"
                >
                  <div className="relative">
                    {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className={`mx-6 mt-4 p-4 rounded-lg border-l-4 ${
          darkMode 
            ? 'bg-red-900/20 border-red-600 text-red-100' 
            : 'bg-red-50 border-red-500 text-red-800'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <div>
                <h4 className="font-semibold">Service Error</h4>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={() => setError(null)}
              className={`p-1 rounded ${
                darkMode ? 'hover:bg-red-800/30' : 'hover:bg-red-100'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map(message => (
          <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-3xl w-full ${message.type === 'user' ? 'ml-16' : 'mr-16'}`}>
              <div className={`${message.type === 'user'
                  ? darkMode 
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white ml-auto shadow-lg' 
                    : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white ml-auto'
                  : darkMode
                    ? 'bg-gray-800/95 border border-gray-700/60 text-white shadow-xl'
                    : 'bg-white/90 backdrop-blur-sm border border-gray-200/60 shadow-lg'
                } rounded-xl p-4 transition-all hover:shadow-xl`}>

                {message.type === 'bot' && (
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 bg-white rounded-lg flex items-center justify-center p-0.5">
                        <img 
                          src="/Barclays Logo.png" 
                          alt="Barclays Logo" 
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const parent = e.currentTarget.parentElement;
                            if (parent) {
                              parent.classList.remove('bg-white', 'p-0.5');
                              parent.classList.add('bg-gradient-to-br', 'from-blue-600', 'to-blue-700');
                              parent.innerHTML = '<svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                            }
                          }}
                        />
                      </div>
                      <span className="text-sm font-semibold">AI Assistant</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyMessage(message.content)}
                        className={`p-1.5 rounded-md transition-colors ${
                          darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
                        }`}
                        title="Copy message"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button className={`p-1.5 rounded-md transition-colors ${
                        darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-green-400' : 'hover:bg-gray-100 text-gray-500 hover:text-green-600'
                      }`}>
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button className={`p-1.5 rounded-md transition-colors ${
                        darkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-500 hover:text-red-600'
                      }`}>
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className={`leading-relaxed ${message.type === 'user' ? 'text-white' : darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {message.type === 'bot' ? (
                    <FormattedResponse content={message.content} darkMode={darkMode} />
                  ) : (
                    message.content
                  )}
                </div>

                {message.sources && message.sources.length > 0 && (
                  <div className={`mt-4 pt-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <FileText className={`w-3.5 h-3.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                        <span className={`text-xs font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Sources ({message.sources.length})
                        </span>
                      </div>
                      <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        Click to open file
                      </span>
                    </div>
                    <div className="space-y-2">
                      {message.sources.map((source, idx) => {
                        const normalizedRelevance = normalizeRelevance(source.relevance);
                        const relevancePercentage = Math.round(normalizedRelevance * 100);
                        
                        return (
                          <button
                            key={idx}
                            onClick={() => openFile(source)}
                            className={`w-full p-3 rounded-lg border transition-all group cursor-pointer text-left ${
                              darkMode 
                                ? 'bg-gray-700/50 border-gray-600/50 hover:bg-gray-700/70 hover:border-gray-500/70' 
                                : 'bg-gray-50/80 border-gray-200/60 hover:bg-gray-100/80 hover:border-gray-300/80'
                            } hover:shadow-md hover:scale-[1.01]`}
                            title="Click to open document"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`font-medium text-sm truncate group-hover:text-blue-600 transition-colors ${
                                    darkMode ? 'text-gray-200 group-hover:text-blue-400' : 'text-gray-900 group-hover:text-blue-600'
                                  }`}>
                                    {source.name}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(source.type)}`}>
                                    {source.type}
                                  </span>
                                </div>
                                <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  <span className="flex items-center gap-1">
                                    <User className="w-3 h-3" />
                                    {source.author}
                                  </span>
                                </div>
                                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                  {source.category}
                                </div>
                              </div>
                              <div className="text-right ml-3 flex flex-col items-end gap-1">
                                <div className={`text-xs font-bold px-2 py-1 rounded-full ${
                                  relevancePercentage >= 80 
                                    ? 'bg-green-100 text-green-800' 
                                    : relevancePercentage >= 60 
                                      ? 'bg-yellow-100 text-yellow-800' 
                                      : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {relevancePercentage}%
                                </div>
                                <div className={`w-12 h-1.5 rounded-full overflow-hidden ${
                                  darkMode ? 'bg-gray-600' : 'bg-gray-200'
                                }`}>
                                  <div 
                                    className={`h-full transition-all ${
                                      relevancePercentage >= 80 
                                        ? 'bg-green-500' 
                                        : relevancePercentage >= 60 
                                          ? 'bg-yellow-500' 
                                          : 'bg-gray-400'
                                    }`}
                                    style={{ width: `${relevancePercentage}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-gray-600/50' : 'border-gray-200/50'}`}>
                              <div className="flex items-center justify-between text-xs">
                                <span className={`flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                  <Database className="w-3 h-3" />
                                  Source Document
                                </span>
                                <span className={`text-blue-600 group-hover:text-blue-700 font-medium ${
                                  darkMode ? 'text-blue-400 group-hover:text-blue-300' : ''
                                }`}>
                                  Open File →
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {message.type === 'bot' && (
                  <div className={`flex items-center justify-between mt-3 pt-2 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className={`flex items-center gap-3 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {message.tokens && <span>{message.tokens} tokens</span>}
                    </div>
                    {message.model && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {message.model}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-4xl w-full mr-12">
              <div className={`rounded-2xl p-6 shadow-sm transition-all ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
                }`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-6 h-6 bg-white rounded-lg flex items-center justify-center p-0.5">
                    <img 
                      src="/Barclays Logo.png" 
                      alt="Barclays Logo" 
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          parent.classList.remove('bg-white', 'p-0.5');
                          parent.classList.add('bg-gradient-to-br', 'from-blue-900', 'to-blue-700');
                          parent.innerHTML = '<svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-900"></div>
                    <span className="text-gray-600">Processing with {selectedModel}...</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Brain className="w-4 h-4" />
                    <span>Analyzing documents and context...</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Search className="w-4 h-4" />
                    <span>Retrieving relevant information...</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Sparkles className="w-4 h-4" />
                    <span>Generating comprehensive response...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className={`relative mx-auto w-1/2 rounded-lg shadow-xl transition-all duration-300 mb-4 ${
        darkMode 
          ? 'backdrop-blur-md bg-gray-800/90 border border-gray-600/50 hover:bg-gray-800/95 hover:shadow-2xl' 
          : 'backdrop-blur-md bg-white/70 border border-white/20 hover:bg-white/80 hover:shadow-2xl'
      }`}>
        {/* Advanced Filters Panel */}
        {showFilters && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
            <div 
              ref={filterRef} 
              className={`w-full max-w-6xl mx-auto max-h-[80vh] overflow-hidden rounded-xl shadow-2xl border ${
                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
              }`}
            >
              {/* Header */}
              <div className={`px-6 py-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Advanced Filters</h3>
                    <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Refine your search with precise filtering options
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={clearFilters}
                      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        activeFiltersCount === 0
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-red-600 hover:bg-red-50 hover:text-red-700'
                      }`}
                      disabled={activeFiltersCount === 0}
                    >
                      Clear All ({activeFiltersCount})
                    </button>
                    <button
                      onClick={() => setShowFilters(false)}
                      className={`p-2 rounded-lg transition-colors ${
                        darkMode 
                          ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' 
                          : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 max-h-[calc(80vh-120px)] overflow-hidden">
                {/* Active Filter Chips */}
                {getFilterChips().length > 0 && (
                  <div className="mb-4">
                    <h4 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Active Filters
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {getFilterChips().map((chip, index) => (
                        <div
                          key={`${chip.type}-${chip.value}-${index}`}
                          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                            darkMode 
                              ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600' 
                              : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          }`}
                        >
                          <span className="truncate max-w-[150px]">{chip.label}</span>
                          <button
                            onClick={() => removeFilterChip(chip)}
                            className="ml-1 hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2-Column Filter Layout */}
                <div className="flex" style={{ height: 'calc(60vh - 200px)', minHeight: '400px' }}>
                  {/* Left Column - Filter Category Buttons */}
                  <div className={`w-48 border-r pr-4 ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                    <h4 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Filter Categories
                    </h4>
                    <div className="space-y-2">
                      <button
                        onClick={() => selectFilterCategory('authors')}
                        className={`w-full px-3 py-2 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                          activeFilterCategory === 'authors'
                            ? darkMode 
                              ? 'bg-blue-900 text-blue-100 border border-blue-700' 
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                            : darkMode 
                              ? 'text-gray-300 hover:bg-gray-700' 
                              : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className="p-1 rounded bg-blue-100 text-blue-600">
                          <User className="w-3 h-3" />
                        </div>
                        <div className="flex-1">
                          <div>Authors</div>
                          {selectedAuthors.length > 0 && (
                            <div className="text-xs opacity-75">{selectedAuthors.length} selected</div>
                          )}
                        </div>
                      </button>

                      <button
                        onClick={() => selectFilterCategory('categories')}
                        className={`w-full px-3 py-2 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                          activeFilterCategory === 'categories'
                            ? darkMode 
                              ? 'bg-green-900 text-green-100 border border-green-700' 
                              : 'bg-green-50 text-green-700 border border-green-200'
                            : darkMode 
                              ? 'text-gray-300 hover:bg-gray-700' 
                              : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className="p-1 rounded bg-green-100 text-green-600">
                          <FileText className="w-3 h-3" />
                        </div>
                        <div className="flex-1">
                          <div>Categories</div>
                          {selectedCategories.length > 0 && (
                            <div className="text-xs opacity-75">{selectedCategories.length} selected</div>
                          )}
                        </div>
                      </button>

                      <button
                        onClick={() => selectFilterCategory('documents')}
                        className={`w-full px-3 py-2 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                          activeFilterCategory === 'documents'
                            ? darkMode 
                              ? 'bg-purple-900 text-purple-100 border border-purple-700' 
                              : 'bg-purple-50 text-purple-700 border border-purple-200'
                            : darkMode 
                              ? 'text-gray-300 hover:bg-gray-700' 
                              : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className="p-1 rounded bg-purple-100 text-purple-600">
                          <Database className="w-3 h-3" />
                        </div>
                        <div className="flex-1">
                          <div>Documents</div>
                          {selectedDocuments.length > 0 && (
                            <div className="text-xs opacity-75">{selectedDocuments.length} selected</div>
                          )}
                        </div>
                      </button>

                      <button
                        onClick={() => selectFilterCategory('dateRange')}
                        className={`w-full px-3 py-2 text-left text-sm font-medium rounded-lg transition-colors flex items-center gap-3 ${
                          activeFilterCategory === 'dateRange'
                            ? darkMode 
                              ? 'bg-orange-900 text-orange-100 border border-orange-700' 
                              : 'bg-orange-50 text-orange-700 border border-orange-200'
                            : darkMode 
                              ? 'text-gray-300 hover:bg-gray-700' 
                              : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className="p-1 rounded bg-orange-100 text-orange-600">
                          <Calendar className="w-3 h-3" />
                        </div>
                        <div className="flex-1">
                          <div>Date Range</div>
                          {(dateRange.start || dateRange.end) && (
                            <div className="text-xs opacity-75">Active</div>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>

                                     {/* Right Column - Filter Options */}
                   <div className="flex-1 pl-4">
                    {/* Authors Panel */}
                    {activeFilterCategory === 'authors' && (
                      <div>
                        <div className="mb-4">
                          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            Authors Filter
                          </h3>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Filter by document authors ({authors.length} total)
                          </p>
                        </div>

                        {/* Search Input */}
                        <div className="mb-4">
                          <input
                            type="text"
                            placeholder="Search authors..."
                            value={authorSearchTerm}
                            onChange={(e) => setAuthorSearchTerm(e.target.value)}
                            className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                              darkMode 
                                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                                : 'bg-gray-50 border-gray-300'
                            }`}
                          />
                        </div>

                        {/* Select All/None */}
                        <div className={`flex items-center justify-between mb-4 pb-2 border-b ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                          <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            {filteredAuthors.length} author{filteredAuthors.length !== 1 ? 's' : ''}
                          </span>
                          <div className="flex gap-3">
                            <button
                              onClick={() => selectAllInCategory('authors')}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-blue-400 hover:text-blue-300' 
                                  : 'text-blue-600 hover:text-blue-700'
                              }`}
                            >
                              Select All
                            </button>
                            <button
                              onClick={() => selectNoneInCategory('authors')}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-gray-400 hover:text-gray-300' 
                                  : 'text-gray-600 hover:text-gray-700'
                              }`}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                                                                         {/* Authors List */}
                        <div className="space-y-2 overflow-y-auto pr-2" style={{ maxHeight: 'calc(50vh - 200px)' }}>
                          {isLoadingFilters ? (
                            <div className="flex items-center justify-center py-8">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                              <span className="ml-2 text-sm text-gray-500">Loading authors from Azure...</span>
                            </div>
                          ) : filteredAuthors.length === 0 ? (
                            <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No authors found</p>
                              <p className="text-xs mt-1">Try adjusting your search terms</p>
                            </div>
                          ) : (
                            filteredAuthors.map(author => (
                            <label key={author.name} className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg transition-colors group border ${
                              darkMode 
                                ? 'hover:bg-gray-700 border-gray-600 hover:border-gray-500' 
                                : 'hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                            }`}>
                              <input
                                type="checkbox"
                                checked={selectedAuthors.includes(author.name)}
                                onChange={() => toggleAuthor(author.name)}
                                className="custom-checkbox mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate group-hover:text-blue-600 transition-colors">
                                  {author.name}
                                </div>
                                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                  {author.expertise || 'No expertise listed'} • {author.count} documents
                                </div>
                              </div>
                            </label>
                          )))}
                        </div>
                      </div>
                    )}

                    {/* Categories Panel */}
                    {activeFilterCategory === 'categories' && (
                      <div>
                        <div className="mb-4">
                          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            Categories Filter
                          </h3>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Filter by document categories ({categories.length} total)
                          </p>
                        </div>

                        {/* Search Input */}
                        <div className="mb-4">
                          <input
                            type="text"
                            placeholder="Search categories..."
                            value={categorySearchTerm}
                            onChange={(e) => setCategorySearchTerm(e.target.value)}
                            className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                              darkMode 
                                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                                : 'bg-gray-50 border-gray-300'
                            }`}
                          />
                        </div>

                        {/* Select All/None */}
                        <div className={`flex items-center justify-between mb-4 pb-2 border-b ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                          <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            {filteredCategories.length} categor{filteredCategories.length !== 1 ? 'ies' : 'y'}
                          </span>
                          <div className="flex gap-3">
                            <button
                              onClick={() => selectAllInCategory('categories')}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-blue-400 hover:text-blue-300' 
                                  : 'text-blue-600 hover:text-blue-700'
                              }`}
                            >
                              Select All
                            </button>
                            <button
                              onClick={() => selectNoneInCategory('categories')}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-gray-400 hover:text-gray-300' 
                                  : 'text-gray-600 hover:text-gray-700'
                              }`}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                                                 {/* Categories List */}
                         <div className="space-y-2 overflow-y-auto pr-2" style={{ maxHeight: 'calc(50vh - 200px)' }}>
                          {filteredCategories.map(category => (
                            <label key={category} className={`flex items-center justify-between gap-3 cursor-pointer p-3 rounded-lg transition-colors group border ${
                              darkMode 
                                ? 'hover:bg-gray-700 border-gray-600 hover:border-gray-500' 
                                : 'hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                            }`}>
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={selectedCategories.includes(category)}
                                  onChange={() => toggleCategory(category)}
                                  className="custom-checkbox"
                                />
                                <span className="text-sm font-semibold group-hover:text-blue-600 transition-colors">
                                  {category}
                                </span>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                darkMode 
                                  ? 'bg-gray-700 text-gray-300' 
                                  : 'bg-gray-100 text-gray-600'
                              }`}>
                                {getCategoryCount(category)}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Documents Panel */}
                    {activeFilterCategory === 'documents' && (
                      <div>
                        <div className="mb-4">
                          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            Documents Filter
                          </h3>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Filter by specific documents ({documents.length} total)
                          </p>
                        </div>

                        {/* Search Input */}
                        <div className="mb-4">
                          <input
                            type="text"
                            placeholder="Search documents..."
                            value={documentSearchTerm}
                            onChange={(e) => setDocumentSearchTerm(e.target.value)}
                            className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                              darkMode 
                                ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                                : 'bg-gray-50 border-gray-300'
                            }`}
                          />
                        </div>

                        {/* Select All/None */}
                        <div className={`flex items-center justify-between mb-4 pb-2 border-b ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                          <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            {filteredDocuments.length} document{filteredDocuments.length !== 1 ? 's' : ''}
                          </span>
                          <div className="flex gap-3">
                            <button
                              onClick={() => selectAllInCategory('documents')}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-blue-400 hover:text-blue-300' 
                                  : 'text-blue-600 hover:text-blue-700'
                              }`}
                            >
                              Select All
                            </button>
                            <button
                              onClick={() => selectNoneInCategory('documents')}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-gray-400 hover:text-gray-300' 
                                  : 'text-gray-600 hover:text-gray-700'
                              }`}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                                                                         {/* Documents List */}
                        <div className="space-y-2 overflow-y-auto pr-2" style={{ maxHeight: 'calc(50vh - 200px)' }}>
                          {filteredDocuments.length === 0 ? (
                            <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No documents found</p>
                              <p className="text-xs mt-1">Try adjusting your search terms</p>
                            </div>
                          ) : (
                            filteredDocuments.map(doc => (
                              <label key={doc.id} className={`flex items-start gap-3 cursor-pointer p-3 rounded-lg transition-colors group border ${
                                darkMode 
                                  ? 'hover:bg-gray-700 border-gray-600 hover:border-gray-500' 
                                  : 'hover:bg-gray-50 border-gray-200 hover:border-gray-300'
                              }`}>
                                <input
                                  type="checkbox"
                                  checked={selectedDocuments.includes(doc.id)}
                                  onChange={() => toggleDocument(doc.id)}
                                  className="custom-checkbox mt-1"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold truncate group-hover:text-blue-600 transition-colors">
                                    {doc.name}
                                  </div>
                                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-2`}>
                                    by {doc.author} • {doc.date}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getTypeColor(doc.type)}`}>
                                      {doc.type}
                                    </span>
                                    <span className={`text-xs px-2 py-1 rounded-full ${
                                      darkMode 
                                        ? 'bg-gray-700 text-gray-300' 
                                        : 'bg-gray-100 text-gray-600'
                                    }`}>
                                      {doc.size}
                                    </span>
                                    <span className={`text-xs px-2 py-1 rounded-full ${
                                      doc.status === 'active' 
                                        ? 'bg-green-100 text-green-800' 
                                        : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {doc.status}
                                    </span>
                                  </div>
                                </div>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Date Range Panel */}
                    {activeFilterCategory === 'dateRange' && (
                      <div>
                        <div className="mb-4">
                          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            Date Range Filter
                          </h3>
                          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Filter by document publication date
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={`block text-sm font-semibold mb-2 ${
                              darkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              From Date
                            </label>
                            <input
                              type="date"
                              value={dateRange.start}
                              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                              className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                                darkMode 
                                  ? 'bg-gray-700 border-gray-600 text-white' 
                                  : 'bg-gray-50 border-gray-300'
                              }`}
                            />
                          </div>
                          <div>
                            <label className={`block text-sm font-semibold mb-2 ${
                              darkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              To Date
                            </label>
                            <input
                              type="date"
                              value={dateRange.end}
                              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                              className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                                darkMode 
                                  ? 'bg-gray-700 border-gray-600 text-white' 
                                  : 'bg-gray-50 border-gray-300'
                              }`}
                            />
                          </div>
                        </div>
                        {(dateRange.start || dateRange.end) && (
                          <div className={`mt-4 pt-3 border-t ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
                            <button
                              onClick={() => setDateRange({ start: '', end: '' })}
                              className={`text-sm font-medium transition-colors ${
                                darkMode 
                                  ? 'text-gray-400 hover:text-gray-300' 
                                  : 'text-gray-600 hover:text-gray-700'
                              }`}
                            >
                              Clear Date Range
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Apply Filters Footer */}
                <div className={`flex items-center justify-between mt-6 pt-4 border-t ${
                  darkMode ? 'border-gray-600' : 'border-gray-200'
                }`}>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {activeFiltersCount > 0 
                      ? `${activeFiltersCount} filter${activeFiltersCount !== 1 ? 's' : ''} applied`
                      : 'No filters applied'
                    }
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={clearFilters}
                      className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                        darkMode 
                          ? 'border-gray-600 text-gray-300 hover:bg-gray-700' 
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Clear All
                    </button>
                    <button
                      onClick={() => setShowFilters(false)}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Advanced Settings Panel */}
        {showAdvancedSettings && (
          <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
            <div 
              ref={settingsRef} 
              className={`w-full max-w-2xl mx-auto rounded-xl shadow-2xl border ${
                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
              }`}
            >
              {/* Header */}
              <div className={`px-6 py-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-semibold">Settings</h3>
                    <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Configure AI model and behavior
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAdvancedSettings(false)}
                    className={`p-2 rounded-lg transition-colors ${
                      darkMode 
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' 
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* AI Model Selection */}
                <div>
                  <label className={`block text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    AI Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
                      darkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300'
                    }`}
                  >
                    {models.map(model => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </select>
                </div>

                {/* Temperature */}
                <div>
                  <label className={`block text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Temperature: {temperature}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Focused</span>
                    <span>Creative</span>
                  </div>
                </div>

                {/* Max Tokens */}
                <div>
                  <label className={`block text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Max Tokens: {maxTokens}
                  </label>
                  <input
                    type="range"
                    min="500"
                    max="4000"
                    step="100"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Short</span>
                    <span>Detailed</span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className={`px-6 py-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Settings are automatically saved
                  </div>
                  <button
                    onClick={() => setShowAdvancedSettings(false)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Input Section */}
        <div className="px-6 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                                 <textarea
                   ref={inputRef}
                   value={inputMessage}
                   onChange={(e) => {
                     setInputMessage(e.target.value);
                     // Auto-resize on change as well
                     e.currentTarget.style.height = 'auto';
                     e.currentTarget.style.height = Math.min(Math.max(e.currentTarget.scrollHeight, 44), 120) + 'px';
                   }}
                   onKeyPress={handleKeyPress}
                   placeholder="Ask me anything about your documents... (Shift+Enter for new line)"
                   className={`w-full px-4 py-3 pr-20 border rounded-lg focus:outline-none transition-all text-sm resize-none ${darkMode 
                     ? 'bg-gray-700/90 border-gray-500/50 text-white placeholder-gray-400 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 focus:bg-gray-700' 
                     : 'bg-white/90 border-gray-300 text-gray-900 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:bg-white'
                   }`}
                   rows={1}
                   style={{ 
                     minHeight: '44px',
                     maxHeight: '120px',
                     overflow: 'hidden'
                   }}
                   onInput={(e) => {
                     // Auto-resize textarea based on content
                     e.currentTarget.style.height = 'auto';
                     e.currentTarget.style.height = Math.min(Math.max(e.currentTarget.scrollHeight, 44), 120) + 'px';
                   }}
                   disabled={isLoading}
                 />
                
                {/* Voice input button inside textarea */}
                <button
                  onClick={toggleVoiceInput}
                  className={`absolute right-12 top-1/2 transform -translate-y-1/2 p-1.5 rounded transition-colors ${isListening
                      ? darkMode 
                        ? 'bg-red-900/30 text-red-400 animate-pulse border border-red-600/50' 
                        : 'bg-red-100 text-red-600 animate-pulse'
                      : darkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-600/50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                  disabled={isLoading}
                  title="Voice Input"
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                {/* Send button inside textarea */}
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim() || isLoading}
                  className={`absolute right-2 top-1/2 transform -translate-y-1/2 p-1.5 rounded transition-colors ${
                    !inputMessage.trim() || isLoading
                      ? darkMode ? 'text-gray-500 cursor-not-allowed' : 'text-gray-400 cursor-not-allowed'
                      : darkMode
                        ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-900/30'
                        : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                  }`}
                  title="Send Message"
                >
                  {isLoading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* External control buttons */}
              <div className="flex items-center gap-1">
                <button
                  ref={filterButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFilters(!showFilters);
                  }}
                  className={`relative p-2 rounded-lg transition-colors ${showFilters
                      ? darkMode 
                        ? 'bg-blue-900/50 text-blue-400 border border-blue-600/50' 
                        : 'bg-blue-100 text-blue-600'
                      : darkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-600/50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                  title="Advanced Filters"
                >
                  <Filter className="w-4 h-4" />
                  {activeFiltersCount > 0 && (
                    <span className={`absolute -top-1 -right-1 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center text-[10px] ${
                      darkMode ? 'bg-blue-500' : 'bg-blue-600'
                    }`}>
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                <button
                  ref={settingsButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAdvancedSettings(!showAdvancedSettings);
                  }}
                  className={`p-2 rounded-lg transition-colors ${showAdvancedSettings
                      ? darkMode 
                        ? 'bg-blue-900/50 text-blue-400 border border-blue-600/50' 
                        : 'bg-blue-100 text-blue-600'
                      : darkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-600/50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                  title="Advanced Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RAGChatbot;
