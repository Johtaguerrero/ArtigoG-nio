import { ArticleData, Author, AppSettings } from '../types';

const STORAGE_KEY = 'artigo_genio_articles';
const AUTHORS_KEY = 'artigo_genio_authors';
const SETTINGS_KEY = 'artigo_genio_settings';
const API_KEY_STORAGE = 'artigo_genio_api_key'; // Nova chave para armazenar API Key localmente

// PLACEHOLDER: Substitua pelo seu Client ID real do Google Cloud Console
export const GOOGLE_CLIENT_ID = "SEU_CLIENT_ID_DO_GOOGLE.apps.googleusercontent.com"; 

export const parseJwt = (token: string) => {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
};

// --- API Key Management (Browser Side) ---

export const getBrowserApiKey = (): string => {
  return localStorage.getItem(API_KEY_STORAGE) || '';
};

export const saveBrowserApiKey = (key: string): void => {
  if (!key) {
    localStorage.removeItem(API_KEY_STORAGE);
  } else {
    localStorage.setItem(API_KEY_STORAGE, key.trim());
  }
};

// --- Articles ---

export const getArticles = (): ArticleData[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error reading articles from storage", error);
    return [];
  }
};

export const getArticle = (id: string): ArticleData | undefined => {
  const articles = getArticles();
  return articles.find(a => a.id === id);
};

export const saveArticle = (article: ArticleData): void => {
  const articles = getArticles();
  const index = articles.findIndex(a => a.id === article.id);
  
  if (index >= 0) {
    articles[index] = { ...articles[index], ...article };
  } else {
    articles.unshift(article);
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
};

export const deleteArticle = (id: string): void => {
  const articles = getArticles().filter(a => a.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
};

// --- Authors ---

export const getAuthors = (): Author[] => {
  try {
    const data = localStorage.getItem(AUTHORS_KEY);
    if (data) return JSON.parse(data);

    // Seed default authors if empty
    const defaultAuthors: Author[] = [
      { 
        id: '1', 
        name: 'Dra. Ana Silva', 
        bio: 'Especialista em Tecnologia e IA com 10 anos de experiência.', 
        photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026024d', 
        expertise: ['Tech', 'AI'] 
      },
      { 
        id: '2', 
        name: 'Carlos Mendes', 
        bio: 'Jornalista sênior focado em Economia Digital.', 
        photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026704d', 
        expertise: ['Finance', 'Crypto'] 
      },
    ];
    localStorage.setItem(AUTHORS_KEY, JSON.stringify(defaultAuthors));
    return defaultAuthors;
  } catch (error) {
    console.error("Error reading authors from storage", error);
    return [];
  }
};

export const saveAuthor = (author: Author): void => {
  const authors = getAuthors();
  const index = authors.findIndex(a => a.id === author.id);
  
  if (index >= 0) {
    authors[index] = { ...authors[index], ...author };
  } else {
    authors.push(author);
  }
  
  localStorage.setItem(AUTHORS_KEY, JSON.stringify(authors));
};

export const deleteAuthor = (id: string): void => {
  const authors = getAuthors().filter(a => a.id !== id);
  localStorage.setItem(AUTHORS_KEY, JSON.stringify(authors));
};

// --- Settings (Admin, Keys, WP) ---

export const getSettings = (): AppSettings => {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
        const parsed = JSON.parse(data);
        return {
            ...parsed,
            defaultSiteUrl: parsed.defaultSiteUrl || ''
        };
    }
    
    // Default settings
    return {
      adminProfile: {
        name: 'Administrador',
        role: 'Editor Chefe',
        photoUrl: ''
      },
      wordpress: {
        endpoint: '',
        username: '',
        applicationPassword: ''
      },
      defaultSiteUrl: ''
    };
  } catch (error) {
    console.error("Error reading settings", error);
    return {
      adminProfile: { name: 'Admin', role: 'Editor', photoUrl: '' },
      wordpress: { endpoint: '', username: '', applicationPassword: '' },
      defaultSiteUrl: ''
    };
  }
};

export const saveSettings = (settings: AppSettings): void => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

// --- Stats ---

export const calculateStats = () => {
  const articles = getArticles();
  const total = articles.length;
  const completed = articles.filter(a => a.status === 'completed' || a.status === 'published').length;
  
  // Calculate average SEO score
  const seoScores = articles
    .map(a => a.seoScore || (a.status === 'completed' ? 90 : 0))
    .filter(s => s > 0);
    
  const avgSeo = seoScores.length > 0 
    ? Math.round(seoScores.reduce((a, b) => a + b, 0) / seoScores.length) 
    : 0;

  // Estimate hours saved: 4 hours per article
  const hoursSaved = completed * 4;

  return { total, avgSeo, hoursSaved };
};