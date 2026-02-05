
export interface Author {
  id: string;
  name: string;
  bio: string;
  photoUrl: string;
  expertise: string[];
}

export interface AdvancedOptions {
  includeToc: boolean;
  includeGlossary: boolean;
  includeTables: boolean;
  includeLists: boolean;
  secureSources: boolean; // .gov, .edu
  authorCredits: boolean;
}

export interface YoutubePayload {
  search_query: string;
  criteria: {
    language: string;
    min_views: number;
    max_duration: string;
  };
  embed_template: string;
}

export interface VideoData {
  query: string;
  title: string;
  channel: string;
  url: string;
  embedHtml: string;
  thumbnailUrl?: string; // New: Para preview e SEO
  caption?: string;      // New: Legenda jornalística
  altText?: string;      // New: Acessibilidade
  strategyPayload?: YoutubePayload; // The raw strategy from AI
}

export type ImageModelType = 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';
export type ImageResolution = '1K' | '2K' | '4K';
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9';

export interface ImageSpec {
  role: string; // e.g., 'hero', 'social_16x9'
  aspectRatio: AspectRatio;
  prompt: string;
  alt: string;
  title: string;
  caption: string;
  filename: string;
  url: string; // Empty by default
  // Config used for generation
  generatedWith?: ImageModelType;
  resolution?: ImageResolution;
}

export interface SeoOpportunities {
  featuredSnippet: string; // Sugestão para ganhar o snippet zero
  paa: string[]; // People Also Ask (estratégia)
  googleNews: string; // Ângulo para Google News
}

export interface SeoData {
  seoTitle: string; // ≤ 60 chars, keyword no início
  metaDescription: string; // ≤ 156 chars
  slug: string; 
  targetKeyword: string;
  synonyms: string[]; // Exatamente 4
  relatedKeyphrase: string;
  tags: string[]; // 10 items
  lsiKeywords: string[]; // Mantido para compatibilidade
  opportunities: SeoOpportunities;
  wordpressExcerpt?: string; // New: Resumo Viral (180 chars)
}

export interface ArticleData {
  id: string;
  topic: string;
  targetKeyword: string;
  language: string; 
  wordCount: '800' | '1500' | '3000';
  siteUrl?: string;
  authorId?: string;
  advancedOptions: AdvancedOptions;
  
  // Generated Content
  title?: string;
  subtitle?: string;
  htmlContent?: string;
  metaDescription?: string; // Kept for backward compatibility
  metaKeywords?: string[]; // Kept for backward compatibility
  
  // New specific SEO Data
  seoData?: SeoData;
  schemaJsonLd?: string;     // New: Technical SEO JSON-LD
  wordpressPostJson?: string; // New: WP REST API Payload

  // Media
  videoData?: VideoData;
  imageSpecs?: ImageSpec[];
  imageSettings?: {
    model: ImageModelType;
    resolution: ImageResolution;
  };

  // Analysis
  serpAnalysis?: SerpAnalysisResult;
  seoScore?: number;
  eeatScore?: number;
  
  // Status
  status: 'draft' | 'generating' | 'completed' | 'published';
  createdAt: string;
}

export interface SerpAnalysisResult {
  competitorTitles: string[];
  contentGaps: string[];
  strategy: string; // Estratégia para superar concorrentes
  questions: string[]; // PAA
  lsiKeywords: string[];
}

export interface GenerationProgress {
  step: string;
  percentage: number;
}

// --- Settings Interfaces ---

export interface AdminProfile {
  name: string;
  role: string;
  photoUrl: string;
  email?: string; // Google Email
  googleId?: string; // Google Sub ID
}

export interface WordPressConfig {
  endpoint: string; // e.g., https://mysite.com/wp-json
  username: string;
  applicationPassword: string; // Generated in WP Admin > Users
}

export interface AppSettings {
  adminProfile: AdminProfile;
  // googleApiKey removed
  wordpress: WordPressConfig;
  defaultSiteUrl?: string; // Field for persisting the last used Site URL
}
